use crate::{config::SerialSettings, AppState};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn serial_list_ports() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(windows::list_ports)
            .await
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    Err("Serial connections require BOOKSHELL to run on Windows.".into())
}

#[tauri::command]
pub async fn serial_open(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    settings: SerialSettings,
) -> Result<(), String> {
    #[cfg(windows)]
    return windows::open(app, &state, session_id, settings).await;

    #[cfg(not(windows))]
    {
        let _ = (app, state, session_id, settings);
        Err("Serial connections require BOOKSHELL to run on Windows.".into())
    }
}

#[cfg(any(windows, test))]
fn com_number(name: &str) -> Option<u32> {
    let suffix = name.get(3..)?;
    if !name.get(..3)?.eq_ignore_ascii_case("COM")
        || !suffix.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    suffix.parse().ok().filter(|number| *number > 0)
}

#[cfg(windows)]
pub use windows::SerialShutdown;

#[cfg(windows)]
mod windows {
    use super::*;
    use crate::ssh::{emit_b64, Cmd, SessionHandle, Transport};
    use dashmap::mapref::entry::Entry;
    use serialport::{DataBits, FlowControl, Parity, SerialPort, StopBits};
    use std::io::{ErrorKind, Read, Write};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::time::{Duration, Instant};
    use tauri::Emitter;
    use tokio::sync::{mpsc, oneshot};

    const IO_TIMEOUT: Duration = Duration::from_millis(30);
    const OUTPUT_INTERVAL: Duration = Duration::from_millis(16);

    pub struct SerialShutdown {
        stop: Arc<AtomicBool>,
        released: oneshot::Receiver<()>,
    }

    impl SerialShutdown {
        pub async fn close(self) {
            self.stop.store(true, Ordering::Release);
            let _ = self.released.await;
        }
    }

    pub fn list_ports() -> Result<Vec<String>, String> {
        let mut ports: Vec<_> = serialport::available_ports()
            .map_err(|error| format!("Could not list COM ports: {error}"))?
            .into_iter()
            .filter_map(|port| com_number(&port.port_name))
            .collect();
        ports.sort_unstable();
        ports.dedup();
        Ok(ports
            .into_iter()
            .map(|number| format!("COM{number}"))
            .collect())
    }

    fn open_port(settings: &SerialSettings) -> Result<Box<dyn SerialPort>, String> {
        let number = com_number(&settings.port).ok_or("Choose a valid COM port.")?;
        if settings.baud_rate == 0 {
            return Err("Baud rate must be greater than zero.".into());
        }
        let data_bits = match settings.data_bits {
            5 => DataBits::Five,
            6 => DataBits::Six,
            7 => DataBits::Seven,
            8 => DataBits::Eight,
            _ => return Err("Data bits must be between 5 and 8.".into()),
        };
        let parity = match settings.parity.as_str() {
            "none" => Parity::None,
            "even" => Parity::Even,
            "odd" => Parity::Odd,
            _ => return Err("Unsupported parity.".into()),
        };
        let stop_bits = match settings.stop_bits {
            1 => StopBits::One,
            2 if settings.data_bits != 5 => StopBits::Two,
            _ => return Err("Unsupported stop bits for this data width.".into()),
        };
        let flow_control = match settings.flow_control.as_str() {
            "none" => FlowControl::None,
            "hardware" => FlowControl::Hardware,
            "software" => FlowControl::Software,
            _ => return Err("Unsupported flow control.".into()),
        };
        let name = format!("COM{number}");
        serialport::new(&name, settings.baud_rate)
            .data_bits(data_bits)
            .parity(parity)
            .stop_bits(stop_bits)
            .flow_control(flow_control)
            .timeout(IO_TIMEOUT)
            .open()
            .map_err(|error| format!("Could not open {name}: {error}. Check that the device is connected and the port is free."))
    }

    pub async fn open(
        app: AppHandle,
        state: &AppState,
        session_id: String,
        settings: SerialSettings,
    ) -> Result<(), String> {
        uuid::Uuid::parse_str(&session_id).map_err(|_| "Invalid serial session ID")?;
        let write_chunk = (settings.baud_rate / 500).clamp(1, 1024) as usize;
        let port = tauri::async_runtime::spawn_blocking(move || open_port(&settings))
            .await
            .map_err(|error| error.to_string())??;
        let (tx, mut rx) = mpsc::channel(64);
        let (released_tx, released) = oneshot::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let sessions = state.sessions.clone();
        let Entry::Vacant(entry) = sessions.entry(session_id.clone()) else {
            return Err("Serial session already exists.".into());
        };
        entry.insert(SessionHandle {
            tx,
            transport: Transport::Serial(SerialShutdown {
                stop: stop.clone(),
                released,
            }),
            session: None,
            is_primary: false,
        });
        let worker_id = session_id.clone();
        let worker_sessions = sessions.clone();
        let worker = std::thread::Builder::new()
            .name("bookshell-serial".into())
            .spawn(move || {
                let mut port = port;
                let event = format!("ssh://data/{worker_id}");
                let reason = run_port(
                    &mut *port,
                    &mut rx,
                    &stop,
                    write_chunk,
                    |port| port.bytes_to_read().map_err(|error| error.to_string()),
                    |bytes| emit_b64(&app, &event, bytes),
                );
                drop(port);
                let _ = released_tx.send(());
                worker_sessions.remove(&worker_id);
                let _ = app.emit(&format!("ssh://close/{worker_id}"), reason);
            });
        if let Err(error) = worker {
            sessions.remove(&session_id);
            return Err(format!("Could not start serial I/O: {error}"));
        }
        Ok(())
    }

    fn run_port<Port: Read + Write + ?Sized>(
        port: &mut Port,
        rx: &mut mpsc::Receiver<Cmd>,
        stop: &AtomicBool,
        write_chunk: usize,
        queued_input: impl Fn(&Port) -> Result<u32, String>,
        mut emit: impl FnMut(&[u8]),
    ) -> String {
        use mpsc::error::TryRecvError;

        let mut buffer = [0; 4096];
        let mut output = Vec::with_capacity(buffer.len());
        let mut last_output = Instant::now();
        let mut write: Option<(Vec<u8>, usize)> = None;
        let reason = loop {
            if stop.load(Ordering::Acquire) {
                break "Serial port closed".into();
            }
            if write.is_none() {
                match rx.try_recv() {
                    Ok(Cmd::Write(data)) if !data.is_empty() => write = Some((data, 0)),
                    Ok(Cmd::Close) | Err(TryRecvError::Disconnected) => {
                        break "Serial port closed".into()
                    }
                    _ => {}
                }
            }
            let mut wrote = false;
            if let Some((data, offset)) = &mut write {
                let chunk = &data[*offset..(*offset + write_chunk).min(data.len())];
                match port.write(chunk) {
                    Ok(written) => {
                        *offset += written;
                        wrote = written != 0;
                    }
                    Err(error) if is_retryable(&error) => {}
                    Err(error) => break format!("Serial write failed: {error}"),
                }
                if *offset == data.len() {
                    write = None;
                }
            }
            // During a paste, keep queuing writes instead of waiting for an
            // idle read timeout after every chunk. Still service incoming bytes.
            let read_size = if wrote {
                match queued_input(port) {
                    Ok(count) => (count as usize).min(buffer.len()),
                    Err(error) => break format!("Serial read failed: {error}"),
                }
            } else {
                buffer.len()
            };
            if read_size > 0 {
                match port.read(&mut buffer[..read_size]) {
                    Ok(count) => output.extend_from_slice(&buffer[..count]),
                    Err(error) if is_retryable(&error) => {}
                    Err(error) => break format!("Serial read failed: {error}"),
                }
            }
            if !output.is_empty()
                && (output.len() >= buffer.len() || last_output.elapsed() >= OUTPUT_INTERVAL)
            {
                emit(&output);
                output.clear();
                last_output = Instant::now();
            }
        };
        if !output.is_empty() {
            emit(&output);
        }
        reason
    }

    fn is_retryable(error: &std::io::Error) -> bool {
        matches!(
            error.kind(),
            ErrorKind::TimedOut | ErrorKind::Interrupted | ErrorKind::WouldBlock
        )
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn enumerates_windows_com_ports() {
            let ports = list_ports().unwrap();
            eprintln!("Windows COM ports: {ports:?}");
            assert!(ports.iter().all(|port| com_number(port).is_some()));
        }

        #[derive(Default)]
        struct TestPort {
            writes: Vec<u8>,
            sent_prompt: bool,
            retry_write: bool,
        }

        impl Read for TestPort {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                if !self.sent_prompt {
                    self.sent_prompt = true;
                    output[..6].copy_from_slice(b"ready>");
                    return Ok(6);
                }
                if self.writes.len() == 6 {
                    return Err(std::io::Error::new(ErrorKind::NotConnected, "unplugged"));
                }
                Err(ErrorKind::TimedOut.into())
            }
        }

        impl Write for TestPort {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                if !self.retry_write {
                    self.retry_write = true;
                    return Err(ErrorKind::TimedOut.into());
                }
                let count = bytes.len().min(2);
                self.writes.extend_from_slice(&bytes[..count]);
                Ok(count)
            }

            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        #[test]
        fn keeps_partial_writes_and_flushes_prompt_on_unplug() {
            let (tx, mut rx) = mpsc::channel(4);
            tx.try_send(Cmd::Write(b"hello\r".to_vec())).ok().unwrap();
            let mut port = TestPort::default();
            let mut output = Vec::new();
            let reason = run_port(
                &mut port,
                &mut rx,
                &AtomicBool::new(false),
                4,
                |_| Ok(4096),
                |bytes| {
                    output.extend_from_slice(bytes);
                },
            );
            assert_eq!(port.writes, b"hello\r");
            assert_eq!(output, b"ready>");
            assert!(reason.contains("unplugged"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::com_number;

    #[test]
    fn accepts_windows_com_numbers_only() {
        assert_eq!(com_number("COM10"), Some(10));
        assert_eq!(com_number("com3"), Some(3));
        for invalid in ["COM", "COM0", "COM+1", "COM1:5", "C:/file", "端口3"] {
            assert_eq!(com_number(invalid), None);
        }
    }

    #[test]
    fn serial_profiles_survive_backup_and_config_round_trip() {
        use crate::config::{Connection, ConnectionKind, ConnectionsFile};

        let serial = serde_json::from_str::<Connection>(
            r#"{
            "id":"serial", "name":"Console", "kind":"serial",
            "serial":{"port":"COM10","baud_rate":9600,"data_bits":7,"parity":"even",
                "stop_bits":1,"flow_control":"software","line_ending":"crlf"}
        }"#,
        )
        .unwrap();
        let legacy: Connection =
            toml::from_str("id = 'ssh'\nname = 'Host'\nhost = 'example.test'").unwrap();
        let config = ConnectionsFile {
            connections: vec![legacy, serial],
        };
        let restored: ConnectionsFile = toml::from_str(&toml::to_string(&config).unwrap()).unwrap();
        assert_eq!(restored.connections[0].kind, ConnectionKind::Ssh);
        assert_eq!(restored.connections[1].kind, ConnectionKind::Serial);
        assert_eq!(
            serde_json::to_value(&restored.connections[1]).unwrap(),
            serde_json::to_value(&config.connections[1]).unwrap()
        );
    }
}
