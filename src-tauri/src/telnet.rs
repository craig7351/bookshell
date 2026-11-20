use crate::ssh::{spawn_output_coalescer_with_completion, Cmd, SessionHandle, Transport};
use crate::AppState;
use dashmap::mapref::entry::Entry;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{tcp::OwnedWriteHalf, TcpStream};
use tokio::sync::{mpsc, oneshot};

const IO_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSED: &str = "Telnet session closed";

#[tauri::command]
pub async fn telnet_open(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&session_id).map_err(|_| "Invalid Telnet session ID.")?;
    let host = host.trim();
    // Host and port are passed separately to allow both IPv4 and IPv6.
    let host = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);
    if host.is_empty() || port == 0 {
        return Err("Enter a Telnet host and a valid port.".into());
    }

    let (tx, mut commands) = mpsc::channel(64);
    let (stop, mut stopped) = oneshot::channel();
    let sessions = state.sessions.clone();
    let Entry::Vacant(entry) = sessions.entry(session_id.clone()) else {
        return Err("Telnet session already exists.".into());
    };
    entry.insert(SessionHandle {
        tx,
        transport: Transport::Telnet(stop),
        session: None,
        is_primary: false,
    });

    let stream = tokio::select! {
        result = tokio::time::timeout(IO_TIMEOUT, TcpStream::connect((host, port))) => match result {
            Ok(Ok(stream)) => Ok(stream),
            Ok(Err(error)) => Err(format!("Could not connect to {host} on port {port}: {error}")),
            Err(_) => Err(format!("Telnet connection to {host} on port {port} timed out.")),
        },
        _ = &mut stopped => Err(CLOSED.into()),
    };
    let stream = match stream {
        Ok(stream) => stream,
        Err(error) => {
            sessions.remove(&session_id);
            return Err(error);
        }
    };
    let _ = stream.set_nodelay(true);

    tokio::spawn(async move {
        let (output, finished) =
            spawn_output_coalescer_with_completion(app.clone(), format!("ssh://data/{session_id}"));
        let reason = tokio::select! {
            reason = run_session(stream, &mut commands, &output) => reason,
            _ = &mut stopped => CLOSED.into(),
        };
        drop(commands);
        drop(output);
        let _ = finished.await;
        sessions.remove(&session_id);
        let _ = app.emit(&format!("ssh://close/{session_id}"), reason);
    });
    Ok(())
}

async fn send(writer: &mut OwnedWriteHalf, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Ok(());
    }
    tokio::time::timeout(IO_TIMEOUT, writer.write_all(bytes))
        .await
        .map_err(|_| "Telnet write timed out.".to_string())?
        .map_err(|error| format!("Telnet write failed: {error}"))
}

async fn run_session(
    stream: TcpStream,
    commands: &mut mpsc::Receiver<Cmd>,
    output: &mpsc::UnboundedSender<Vec<u8>>,
) -> String {
    let (mut reader, mut writer) = stream.into_split();
    let mut codec = TelnetCodec::new();
    if let Err(error) = send(&mut writer, &codec.start()).await {
        return error;
    }

    let mut buffer = [0; 8192];
    loop {
        let outgoing = tokio::select! {
            read = reader.read(&mut buffer) => {
                let count = match read {
                    Ok(0) => return "The remote host closed the Telnet session.".into(),
                    Ok(count) => count,
                    Err(error) => return format!("Telnet read failed: {error}"),
                };
                let mut data = Vec::with_capacity(count);
                let mut replies = Vec::new();
                codec.receive(&buffer[..count], &mut data, &mut replies);
                if !data.is_empty() && output.send(data).is_err() {
                    return CLOSED.into();
                }
                replies
            }
            command = commands.recv() => match command {
                Some(Cmd::Write(data)) => codec.encode_input(&data),
                Some(Cmd::Resize(cols, rows)) => codec.resize(cols, rows),
                Some(Cmd::Close) | None => return CLOSED.into(),
            }
        };
        if let Err(error) = send(&mut writer, &outgoing).await {
            return error;
        }
    }
}

const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;

const BINARY: u8 = 0;
const ECHO: u8 = 1;
const SGA: u8 = 3;
const TTYPE: u8 = 24;
const NAWS: u8 = 31;
const TTYPE_IS: u8 = 0;
const TTYPE_SEND: u8 = 1;

#[derive(Clone, Copy, PartialEq, Eq)]
enum OptionState {
    Disabled,
    Offered,
    Enabled,
}

#[derive(Clone, Copy)]
enum ReadState {
    Data,
    Command,
    Option(u8),
    SubOption,
    SubData {
        option: u8,
        payload: SubPayload,
        escaped: bool,
    },
}

// Only the single-byte TTYPE SEND request is needed. Keep fixed parser
// state even if a peer sends a long or incomplete subnegotiation.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SubPayload {
    Empty,
    SendTerminalType,
    Other,
}

struct TelnetCodec {
    read: ReadState,
    local: [OptionState; 256],
    remote: [OptionState; 256],
    received_cr: bool,
    cols: u16,
    rows: u16,
}

impl TelnetCodec {
    fn new() -> Self {
        Self {
            read: ReadState::Data,
            local: [OptionState::Disabled; 256],
            remote: [OptionState::Disabled; 256],
            received_cr: false,
            cols: 80,
            rows: 24,
        }
    }

    fn start(&mut self) -> [u8; 6] {
        self.local[TTYPE as usize] = OptionState::Offered;
        self.local[NAWS as usize] = OptionState::Offered;
        [IAC, WILL, TTYPE, IAC, WILL, NAWS]
    }

    fn receive(&mut self, bytes: &[u8], output: &mut Vec<u8>, replies: &mut Vec<u8>) {
        for &byte in bytes {
            self.read = match self.read {
                ReadState::Data if byte == IAC => ReadState::Command,
                ReadState::Data => {
                    self.push_data(byte, output);
                    ReadState::Data
                }
                ReadState::Command => match byte {
                    IAC => {
                        self.push_data(IAC, output);
                        ReadState::Data
                    }
                    DO | DONT | WILL | WONT => ReadState::Option(byte),
                    SB => ReadState::SubOption,
                    _ => ReadState::Data,
                },
                ReadState::Option(verb) => {
                    self.negotiate(verb, byte, replies);
                    ReadState::Data
                }
                ReadState::SubOption => ReadState::SubData {
                    option: byte,
                    payload: SubPayload::Empty,
                    escaped: false,
                },
                ReadState::SubData {
                    option,
                    payload,
                    escaped: true,
                } if byte == SE => {
                    if option == TTYPE
                        && payload == SubPayload::SendTerminalType
                        && self.local[TTYPE as usize] == OptionState::Enabled
                    {
                        replies.extend([IAC, SB, TTYPE, TTYPE_IS]);
                        replies.extend(b"XTERM");
                        replies.extend([IAC, SE]);
                    }
                    ReadState::Data
                }
                ReadState::SubData {
                    option,
                    payload,
                    escaped: false,
                } if byte == IAC => ReadState::SubData {
                    option,
                    payload,
                    escaped: true,
                },
                ReadState::SubData {
                    option,
                    payload,
                    escaped,
                } => {
                    let payload = if !escaped && payload == SubPayload::Empty && byte == TTYPE_SEND
                    {
                        SubPayload::SendTerminalType
                    } else {
                        SubPayload::Other
                    };
                    ReadState::SubData {
                        option,
                        payload,
                        escaped: false,
                    }
                }
            };
        }
    }

    fn push_data(&mut self, byte: u8, output: &mut Vec<u8>) {
        if self.remote[BINARY as usize] != OptionState::Enabled {
            let padding = self.received_cr && byte == 0;
            self.received_cr = byte == b'\r';
            if padding {
                return;
            }
        }
        output.push(byte);
    }

    fn negotiate(&mut self, verb: u8, option: u8, replies: &mut Vec<u8>) {
        let index = option as usize;
        let (state, supported, yes, no) = if matches!(verb, DO | DONT) {
            (
                &mut self.local[index],
                matches!(option, BINARY | SGA | TTYPE | NAWS),
                WILL,
                WONT,
            )
        } else {
            (
                &mut self.remote[index],
                matches!(option, BINARY | ECHO | SGA),
                DO,
                DONT,
            )
        };
        let previous = *state;
        if matches!(verb, DO | WILL) {
            if !supported {
                replies.extend([IAC, no, option]);
                return;
            }
            if previous == OptionState::Disabled {
                replies.extend([IAC, yes, option]);
            }
            *state = OptionState::Enabled;
        } else {
            if previous == OptionState::Enabled {
                replies.extend([IAC, no, option]);
            }
            *state = OptionState::Disabled;
        }

        if option == BINARY && matches!(verb, WILL | WONT) && previous != *state {
            self.received_cr = false;
        }
        if verb == DO && option == NAWS && previous != OptionState::Enabled {
            self.push_window_size(replies);
        }
    }

    fn encode_input(&self, input: &[u8]) -> Vec<u8> {
        let binary = self.local[BINARY as usize] == OptionState::Enabled;
        let mut encoded = Vec::with_capacity(input.len());
        let mut bytes = input.iter().copied().peekable();
        while let Some(byte) = bytes.next() {
            match byte {
                b'\r' | b'\n' if !binary => {
                    // xterm sends CR for Enter. A pasted CRLF also represents
                    // a single line ending in the default NVT mode.
                    if byte == b'\r' && bytes.peek() == Some(&b'\n') {
                        bytes.next();
                    }
                    encoded.extend(b"\r\n");
                }
                _ => push_escaped(&mut encoded, byte),
            }
        }
        encoded
    }

    fn resize(&mut self, cols: u32, rows: u32) -> Vec<u8> {
        let (Ok(cols), Ok(rows)) = (u16::try_from(cols), u16::try_from(rows)) else {
            return Vec::new();
        };
        if cols == 0 || rows == 0 || (cols, rows) == (self.cols, self.rows) {
            return Vec::new();
        }
        (self.cols, self.rows) = (cols, rows);
        let mut bytes = Vec::new();
        if self.local[NAWS as usize] == OptionState::Enabled {
            self.push_window_size(&mut bytes);
        }
        bytes
    }

    fn push_window_size(&self, bytes: &mut Vec<u8>) {
        bytes.extend([IAC, SB, NAWS]);
        for byte in self
            .cols
            .to_be_bytes()
            .into_iter()
            .chain(self.rows.to_be_bytes())
        {
            push_escaped(bytes, byte);
        }
        bytes.extend([IAC, SE]);
    }
}

fn push_escaped(output: &mut Vec<u8>, byte: u8) {
    output.push(byte);
    if byte == IAC {
        output.push(IAC);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separates_fragmented_commands_and_terminal_data() {
        let mut codec = TelnetCodec::new();
        let mut output = Vec::new();
        let mut replies = Vec::new();
        for part in [
            b"Login:\r".as_slice(),
            &[IAC, WILL],
            &[ECHO, 0, IAC, WILL, ECHO],
            &[IAC, WILL, 42, IAC, DO, 39, IAC],
            &[IAC, IAC, WONT, ECHO, IAC, WONT, ECHO],
        ] {
            codec.receive(part, &mut output, &mut replies);
        }
        assert_eq!(output, [b"Login:\r".as_slice(), &[IAC]].concat());
        assert_eq!(
            replies,
            [IAC, DO, ECHO, IAC, DONT, 42, IAC, WONT, 39, IAC, DONT, ECHO]
        );
    }

    #[test]
    fn reports_terminal_type_and_only_sends_window_size_when_enabled() {
        let mut codec = TelnetCodec::new();
        let mut output = Vec::new();
        let mut replies = Vec::new();
        assert_eq!(codec.start(), [IAC, WILL, TTYPE, IAC, WILL, NAWS]);
        assert!(codec.resize(255, 40).is_empty());
        let negotiation = [
            IAC, DO, NAWS, IAC, DO, TTYPE, IAC, SB, TTYPE, TTYPE_SEND, IAC, SE,
        ];
        for byte in negotiation {
            codec.receive(&[byte], &mut output, &mut replies);
        }
        let mut expected = vec![
            IAC, SB, NAWS, 0, IAC, IAC, 0, 40, IAC, SE, IAC, SB, TTYPE, TTYPE_IS,
        ];
        expected.extend(b"XTERM");
        expected.extend([IAC, SE]);
        assert!(output.is_empty());
        assert_eq!(replies, expected);
        assert_eq!(
            codec.resize(120, 42),
            [IAC, SB, NAWS, 0, 120, 0, 42, IAC, SE]
        );
        replies.clear();
        codec.receive(&[IAC, DONT, NAWS], &mut output, &mut replies);
        assert_eq!(replies, [IAC, WONT, NAWS]);
        assert!(codec.resize(80, 24).is_empty());
    }

    #[test]
    fn normalizes_enter_and_respects_directional_binary_negotiation() {
        let mut codec = TelnetCodec::new();
        assert_eq!(
            codec.encode_input(b"a\r\nb\nc\r\xff"),
            b"a\r\nb\r\nc\r\n\xff\xff"
        );
        let mut output = Vec::new();
        let mut replies = Vec::new();
        codec.receive(&[IAC, DO, BINARY, b'\r', 0], &mut output, &mut replies);
        assert_eq!(codec.encode_input(b"a\r\xff"), b"a\r\xff\xff");
        assert_eq!(output, b"\r");
        codec.receive(&[IAC, WILL, BINARY, b'\r', 0], &mut output, &mut replies);
        assert_eq!(output, b"\r\r\0");
        assert_eq!(replies, [IAC, WILL, BINARY, IAC, DO, BINARY]);
    }

    #[tokio::test]
    async fn exchanges_terminal_input_and_reports_eof_over_tcp() {
        tokio::time::timeout(Duration::from_secs(3), async {
            use tokio::net::TcpListener;

            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .unwrap();
            let address = listener.local_addr().unwrap();
            let client = TcpStream::connect(address).await.unwrap();
            let (mut server, _) = listener.accept().await.unwrap();
            let (send_command, mut commands) = mpsc::channel(4);
            let (output, mut read_output) = mpsc::unbounded_channel();
            let worker =
                tokio::spawn(async move { run_session(client, &mut commands, &output).await });

            let mut offer = [0; 6];
            server.read_exact(&mut offer).await.unwrap();
            assert_eq!(offer, [IAC, WILL, TTYPE, IAC, WILL, NAWS]);
            server.write_all(&[IAC, WILL]).await.unwrap();
            server.write_all(&[ECHO]).await.unwrap();
            server.write_all(b"Login: ").await.unwrap();
            let mut echo = [0; 3];
            server.read_exact(&mut echo).await.unwrap();
            assert_eq!(echo, [IAC, DO, ECHO]);
            let mut prompt = Vec::new();
            while prompt.len() < 7 {
                prompt.extend(read_output.recv().await.unwrap());
            }
            assert_eq!(prompt, b"Login: ");
            assert!(send_command
                .send(Cmd::Write(b"user\r".to_vec()))
                .await
                .is_ok());
            let mut login = [0; 6];
            server.read_exact(&mut login).await.unwrap();
            assert_eq!(login, *b"user\r\n");
            server.shutdown().await.unwrap();
            assert_eq!(
                worker.await.unwrap(),
                "The remote host closed the Telnet session."
            );
        })
        .await
        .expect("Telnet loopback session timed out");
    }
}
