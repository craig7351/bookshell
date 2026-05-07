import { createSignal } from "solid-js";
import { api, type Connection } from "../ipc/api";

const [connections, setConnections] = createSignal<Connection[]>([]);

export { connections };

export async function loadConnections() {
  try {
    setConnections(await api.listConnections());
  } catch (e) {
    console.error("loadConnections failed", e);
    setConnections([]);
  }
}

export async function upsertConnection(c: Connection) {
  await api.saveConnection(c);
  await loadConnections();
}

export async function deleteConnection(id: string) {
  await api.deleteConnection(id);
  await loadConnections();
}

export function newConnectionId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isWindows(): boolean {
  return /win/i.test(navigator.platform);
}

export function defaultLocalShell(): string {
  return isWindows() ? "powershell.exe" : "/bin/bash";
}
