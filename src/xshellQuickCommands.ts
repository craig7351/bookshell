import type { ImportedCommandButton } from "./ipc/api";

export interface XshellQuickCommand extends ImportedCommandButton {
  index: number;
  visible: boolean;
}

const fieldName = /^(label|text|cr|visible|type)_(\d+)$/;

export function parseXshellQuickCommands(bytes: ArrayBuffer) {
  const prefix = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
  let encoding = "utf-8";
  if (prefix[0] === 0xff && prefix[1] === 0xfe) encoding = "utf-16le";
  if (prefix[0] === 0xfe && prefix[1] === 0xff) encoding = "utf-16be";

  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error("This file could not be decoded. Save the .qbl file as UTF-8 or UTF-16 with a BOM.");
  }
  if (text.includes("\0")) throw new Error("This is not a supported Xshell .qbl text file.");

  const rows = new Map<number, Map<string, string>>();
  let foundSection = false;
  let inQuickButton = false;
  let count: number | undefined;

  for (const line of text.split(/\r\n|\n|\r/)) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) {
      inQuickButton = section[1].trim().toLowerCase() === "quickbutton";
      if (inQuickButton && foundSection) throw new Error("This file has more than one [QuickButton] section.");
      foundSection ||= inQuickButton;
      continue;
    }
    if (!inQuickButton) continue;

    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1);
    if (key === "count") {
      const parsed = value.trim();
      if (count !== undefined || !/^\d+$/.test(parsed) || !Number.isSafeInteger(Number(parsed))) {
        throw new Error("This file has an invalid Quick Command count.");
      }
      count = Number(parsed);
      continue;
    }

    const field = fieldName.exec(key);
    if (!field) continue;
    const index = Number(field[2]);
    if (!Number.isSafeInteger(index)) throw new Error("This file contains an invalid button index.");
    let row = rows.get(index);
    if (!row) rows.set(index, row = new Map());
    if (row.has(field[1])) throw new Error(`Button ${index + 1} has a duplicate field.`);
    row.set(field[1], value);
  }

  if (!foundSection) throw new Error("This file has no Xshell [QuickButton] section.");

  const buttons: XshellQuickCommand[] = [];
  let skipped = 0;
  for (const [index, row] of [...rows].sort(([a], [b]) => a - b)) {
    const label = row.get("label") ?? "";
    const command = row.get("text") ?? "";
    const cr = row.get("cr")?.trim() ?? "0";
    const visible = row.get("visible")?.trim() ?? "1";
    if ((count !== undefined && index >= count) || !label.trim() || !command.trim()
      || row.get("type")?.trim() !== "0"
      || !/^[01]$/.test(cr) || !/^[01]$/.test(visible)) {
      skipped++;
      continue;
    }
    buttons.push({ index, label, command, send_enter: cr === "1", visible: visible === "1" });
  }

  return { buttons, skipped };
}
