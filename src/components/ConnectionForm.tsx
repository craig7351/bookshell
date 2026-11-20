import { createResource, createSignal, createUniqueId, For, Show } from "solid-js";
import { api, type Connection, type ConnectionKind, type SerialSettings } from "../ipc/api";
import { defaultLocalShell, defaultSerialSettings, isWindows, serialWindowsOnly, upsertConnection } from "../stores/connections";
import { button, S } from "../theme";
import { Notice } from "./ui/Notice";
import { settingsField, SettingsGroup, SettingsRow } from "./ui/SettingsGroup";

const serialChoices = [
  { key: "data_bits", label: "Data bits", options: [[5, "5"], [6, "6"], [7, "7"], [8, "8"]] },
  { key: "parity", label: "Parity", options: [["none", "None"], ["even", "Even"], ["odd", "Odd"]] },
  { key: "stop_bits", label: "Stop bits", options: [[1, "1"], [2, "2"]] },
  { key: "flow_control", label: "Flow control", options: [["none", "None"], ["hardware", "RTS/CTS"], ["software", "XON/XOFF"]] },
  { key: "line_ending", label: "Enter sends", options: [["cr", "CR"], ["lf", "LF"], ["crlf", "CRLF"]] },
] as const;

export function ConnectionForm(props: { initial: Connection; onClose: () => void }) {
  const prefix = createUniqueId();
  const [draft, setDraft] = createSignal({ ...props.initial });
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const serial = () => draft().serial ?? defaultSerialSettings;
  const canUseSerial = isWindows();
  const [ports, { refetch }] = createResource(
    () => canUseSerial && draft().kind === "serial",
    async (): Promise<{ names: string[]; error?: string }> => {
      try {
        return { names: await api.serialListPorts() };
      } catch (error) {
        return { names: [], error: String(error) };
      }
    },
  );

  const update = (patch: Partial<Connection>) => setDraft((connection) => ({ ...connection, ...patch }));
  const updateSerial = (patch: Partial<SerialSettings>) => update({ serial: { ...serial(), ...patch } });

  function chooseKind(kind: ConnectionKind) {
    setError(null);
    update({ kind });
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving()) return;
    const connection = { ...draft() };
    if (connection.kind === "serial") {
      const settings = serial();
      if (canUseSerial && (!settings.port || !Number.isInteger(settings.baud_rate) || settings.baud_rate < 1)) {
        setError("Choose a COM port and enter a valid baud rate.");
        return;
      }
      if (canUseSerial && settings.data_bits === 5 && settings.stop_bits === 2) {
        setError("Choose one stop bit when using five data bits.");
        return;
      }
      connection.serial = settings;
      connection.host = "";
      connection.user = "";
      connection.password = null;
      connection.shell = null;
      connection.cwd = null;
    } else {
      connection.serial = null;
    }
    connection.name = connection.name.trim() || (connection.kind === "serial"
      ? connection.serial?.port || "Serial (COM)"
      : connection.kind === "local" ? "Local" : connection.host);
    setError(null);
    setSaving(true);
    try {
      await upsertConnection(connection);
      props.onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <SettingsGroup label="Connection">
        <SettingsRow label="Type" hint={canUseSerial ? undefined : serialWindowsOnly}>
          <div role="group" aria-label="Connection type" style={{ display: "flex", gap: S[2], "flex-wrap": "wrap" }}>
            <For each={[["ssh", "SSH"], ["local", "Local"], ["serial", canUseSerial ? "Serial (COM)" : "Serial (COM) · Windows only"]] as const}>
              {([kind, label]) => (
                <label style={{ display: "inline-flex", gap: S[1], "align-items": "center" }}>
                  <input
                    type="radio"
                    name={`${prefix}-kind`}
                    checked={draft().kind === kind}
                    disabled={kind === "serial" && !canUseSerial}
                    onChange={() => chooseKind(kind)}
                  />
                  {label}
                </label>
              )}
            </For>
          </div>
        </SettingsRow>
        <SettingsRow label={<label for={`${prefix}-name`}>Name</label>}>
          <input id={`${prefix}-name`} class="bs-input" style={settingsField()} value={draft().name} onInput={(e) => update({ name: e.currentTarget.value })} />
        </SettingsRow>

        <Show when={draft().kind === "ssh"}>
          <SettingsRow label={<label for={`${prefix}-host`}>Host</label>}>
            <input id={`${prefix}-host`} class="bs-input" style={settingsField()} value={draft().host} onInput={(e) => update({ host: e.currentTarget.value })} />
          </SettingsRow>
          <SettingsRow label={<label for={`${prefix}-port`}>Port</label>}>
            <input id={`${prefix}-port`} class="bs-input" type="number" style={settingsField("100px")} value={draft().port} onInput={(e) => update({ port: parseInt(e.currentTarget.value) || 22 })} />
          </SettingsRow>
          <SettingsRow label={<label for={`${prefix}-user`}>User</label>}>
            <input id={`${prefix}-user`} class="bs-input" style={settingsField()} value={draft().user} onInput={(e) => update({ user: e.currentTarget.value })} />
          </SettingsRow>
          <SettingsRow label={<label for={`${prefix}-password`}>Password</label>}>
            <input id={`${prefix}-password`} class="bs-input" type="password" style={settingsField()} placeholder="Leave empty to prompt each time" value={draft().password ?? ""} onInput={(e) => update({ password: e.currentTarget.value })} />
          </SettingsRow>
        </Show>

        <Show when={draft().kind === "local"}>
          <SettingsRow label={<label for={`${prefix}-shell`}>Shell</label>}>
            <input id={`${prefix}-shell`} class="bs-input" style={settingsField()} placeholder={defaultLocalShell()} value={draft().shell ?? ""} onInput={(e) => update({ shell: e.currentTarget.value || null })} />
          </SettingsRow>
          <SettingsRow label={<label for={`${prefix}-cwd`}>Working dir</label>}>
            <input id={`${prefix}-cwd`} class="bs-input" style={settingsField()} placeholder="Default: home directory" value={draft().cwd ?? ""} onInput={(e) => update({ cwd: e.currentTarget.value || null })} />
          </SettingsRow>
        </Show>

        <Show when={draft().kind === "serial" && canUseSerial}>
          <SettingsRow label={<label for={`${prefix}-com`}>COM port</label>} hint={ports.loading ? "Scanning…" : ports()?.error ?? (ports()?.names.length === 0 ? "No COM ports found." : undefined)}>
            <select id={`${prefix}-com`} class="bs-input" style={settingsField("160px")} required onChange={(e) => updateSerial({ port: e.currentTarget.value })}>
              <option value="" disabled selected={!serial().port}>Choose a COM port</option>
              <For each={ports()?.names}>
                {(name) => <option value={name} selected={serial().port === name}>{name}</option>}
              </For>
              <Show when={serial().port && !ports()?.names.includes(serial().port)}>
                <option value={serial().port} selected>{serial().port} (saved)</option>
              </Show>
            </select>
            <button type="button" class="bs-btn" style={button("secondary", "default")} disabled={ports.loading} onClick={() => void refetch()}>Refresh</button>
          </SettingsRow>
          <SettingsRow label={<label for={`${prefix}-baud`}>Baud rate</label>}>
            <input id={`${prefix}-baud`} class="bs-input" type="number" min={1} max={4294967295} required style={settingsField("140px")} value={serial().baud_rate || ""} onInput={(e) => updateSerial({ baud_rate: e.currentTarget.valueAsNumber || 0 })} />
          </SettingsRow>
          <For each={serialChoices}>
            {(field) => (
              <SettingsRow label={<label for={`${prefix}-${field.key}`}>{field.label}</label>}>
                <select id={`${prefix}-${field.key}`} class="bs-input" style={settingsField("140px")} onChange={(e) => {
                  const option = field.options.find(([value]) => String(value) === e.currentTarget.value);
                  if (option) updateSerial({ [field.key]: option[0] });
                }}>
                  <For each={field.options}>
                    {([value, label]) => <option value={String(value)} selected={serial()[field.key] === value}>{label}</option>}
                  </For>
                </select>
              </SettingsRow>
            )}
          </For>
        </Show>

        <SettingsRow>
          <button type="button" class="bs-btn" disabled={saving()} onClick={props.onClose} style={button("secondary", "roomy")}>Cancel</button>
          <button type="submit" class="bs-btn" disabled={saving()} style={button("primary", "roomy")}>{saving() ? "Saving…" : "Save"}</button>
        </SettingsRow>
        <Show when={error()}>{(message) => <div role="alert"><Notice tone="error">{message()}</Notice></div>}</Show>
      </SettingsGroup>
    </form>
  );
}
