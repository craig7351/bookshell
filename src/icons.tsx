/** BOOKSHELL icon set — hand-embedded Lucide-style geometry (MIT).
 *
 * Zero npm dependency on purpose: an icon font or an SVG sprite package would
 * add a network/asset hop and a second visual language. Every glyph here is
 * drawn on the same 24x24 grid with `stroke="currentColor"`, stroke-width
 * 1.75 and round caps/joins, so an icon always inherits the colour of the text
 * it sits next to (including the accent colour a toggle takes when pressed).
 *
 * RULES
 *  - Sizes are 12 / 14 / 16 (see IconSize). 12 = footer / badge, 14 = toolbar
 *    and rows, 16 = brand glyph. 40 is the one hero size, reserved for the
 *    illustration in an empty state — never for a control.
 *  - Never give a glyph its own colour inline; set `color` on the parent so
 *    hover / aria-pressed states carry the icon with them.
 *  - Emoji are for user content only (custom tab icons, command buttons).
 *
 * The values below are SVG child markup rather than a single `d` string
 * because several glyphs need <circle> / <rect>; they are static, authored
 * here, and never derived from user input.
 */

import type { JSX } from "solid-js";

const PATHS = {
  // --- shell / app ---------------------------------------------------------
  terminal: '<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>',
  "git-branch":
    '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  "folder-open":
    '<path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H22l-3.2 6.4A2 2 0 0 1 17 18H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
  file:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h6"/>',
  "file-code":
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h6"/><path d="m10 13-2 2 2 2"/><path d="m14 13 2 2-2 2"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  /* Not in the section 3.7 list: an upload target that is unmistakably a
     folder. "upload" alone cannot tell the two FileBrowser actions apart. */
  "folder-up":
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="m9 13 3-3 3 3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  "sliders-horizontal":
    '<path d="M21 4H14"/><path d="M10 4H3"/><path d="M21 12H12"/><path d="M8 12H3"/><path d="M21 20H16"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',

  // --- actions -------------------------------------------------------------
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "refresh-cw":
    '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  "arrow-up": '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  "arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  upload:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 9 5-5 5 5"/><path d="M12 4v12"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off":
    '<path d="M10.7 6.2A9 9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-2.66 3.35"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9 9 0 0 0 4.3-1.06"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m2 2 20 20"/>',

  // --- status / meta -------------------------------------------------------
  "map-pin":
    '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  bot:
    '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  plug:
    '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  cpu:
    '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v2"/><path d="M15 2v2"/><path d="M9 20v2"/><path d="M15 20v2"/><path d="M2 9h2"/><path d="M2 15h2"/><path d="M20 9h2"/><path d="M20 15h2"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  "alert-triangle":
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',

  // --- layout --------------------------------------------------------------
  "columns-2": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
  "rows-2": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/>',
  "panel-right": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** 12 = footer / badge · 14 = toolbar, rows · 16 = brand and PanelHeader ·
 *  28 = panel EmptyState · 40 = app-shell hero glyph. 28 and 40 are
 *  illustration sizes: they may never appear on a control. */
export type IconSize = 12 | 14 | 16 | 28 | 40;

interface IconProps {
  name: IconName;
  /** 12 / 14 / 16, or 28 / 40 for an empty-state glyph. Defaults to 14. */
  size?: IconSize;
  /** Stroke width. Defaults to 1.75; 2 reads better at 12px on a light glyph. */
  stroke?: number;
  class?: string;
  style?: JSX.CSSProperties;
}

/**
 * The one icon renderer. Inherits `currentColor`, so colour lives on the
 * parent button / row and hover + aria-pressed states come along for free.
 */
export function Icon(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size ?? 14}
      height={props.size ?? 14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.stroke ?? 1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={props.class}
      style={{ display: "block", "flex-shrink": 0, ...(props.style ?? {}) }}
      innerHTML={PATHS[props.name]}
    />
  );
}
