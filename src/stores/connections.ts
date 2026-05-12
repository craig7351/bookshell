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

export async function reorderConnections(sourceId: string, targetId: string | null) {
  if (sourceId === targetId) return;
  const arr = [...connections()];
  const fromIdx = arr.findIndex((c) => c.id === sourceId);
  if (fromIdx < 0) return;
  const [moved] = arr.splice(fromIdx, 1);
  if (targetId === null) {
    arr.push(moved);
  } else {
    const toIdx = arr.findIndex((c) => c.id === targetId);
    if (toIdx < 0) arr.push(moved);
    else arr.splice(toIdx, 0, moved);
  }
  setConnections(arr);
  await api.reorderConnections(arr.map((c) => c.id)).catch((e) => {
    console.error("reorderConnections persist failed", e);
    loadConnections();
  });
}

export async function moveConnection(id: string, delta: -1 | 1) {
  const arr = connections();
  const idx = arr.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= arr.length) return;
  const targetId = delta < 0 ? arr[newIdx].id : (newIdx + 1 < arr.length ? arr[newIdx + 1].id : null);
  await reorderConnections(id, targetId);
}

export function newConnectionId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isWindows(): boolean {
  return /win/i.test(navigator.platform);
}

export function isLinux(): boolean {
  return /linux/i.test(navigator.platform);
}

export function defaultLocalShell(): string {
  return isWindows() ? "powershell.exe" : "/bin/bash";
}
