#!/usr/bin/env node
/**
 * lint-tokens — the regression guard for the BOOKSHELL design system.
 *
 * Scans the component layer (src/components/**, src/App.tsx) for the four
 * things that let the old ad-hoc styling back in:
 *
 *   hex        bare #rrggbb literals — colour belongs in RAW / C, never inline
 *   mono       the bare word `monospace` — font stacks come from FONT.mono
 *   radius     a border-radius outside R  (4 / 6 / 8 / 10 / 14 / 999px)
 *   fontsize   a font-size outside T      (10 / 11 / 12 / 13 / 15 / 20px)
 *   blur       backdrop-filter / filter: blur — banned app-wide (xterm rule 1)
 *
 * Exempt by design: src/theme.ts and src/themes/** (the single source of raw
 * colour), src/icons.tsx (SVG source), src/styles/*.css (tokens.css IS the
 * literal definition of every token).
 *
 * Node only, no dependencies, cross-platform (paths are normalised to "/").
 * Run via `npm run check`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Files scanned. Directories are walked recursively for .ts/.tsx. */
const TARGETS = ["src/components", "src/App.tsx"];

/** Never scanned: these files are where the literals legitimately live. */
const EXEMPT_FILES = new Set(["src/theme.ts", "src/icons.tsx"]);
const EXEMPT_DIRS = ["src/themes/", "src/styles/"];

/** Colour literals allowed anywhere: pure white is a real design decision
 *  (foreground on a filled accent / danger button), not a stray palette. */
const HEX_ALLOW = new Set(["#fff", "#ffffff"]);

/** Values a border-radius / font-size may take besides a var() or a keyword. */
const RADIUS_OK = new Set(["0", "4px", "6px", "8px", "10px", "14px", "999px", "50%", "100%"]);
const FONTSIZE_OK = new Set(["10px", "11px", "12px", "13px", "15px", "20px"]);

/**
 * Per-file rule waivers. Every entry MUST carry a TODO naming the phase that
 * removes it — an entry without a phase is a bug, not a waiver.
 * Shape: "<repo-relative path>": ["rule", …]
 */
const PENDING = {
  // (empty — the tree is clean as of Phase 1b)
};

const RULES = [
  {
    id: "hex",
    re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g,
    ok: (m) => HEX_ALLOW.has(m[0].toLowerCase()),
    msg: (m) => `bare colour literal ${m[0]} — use a token from C (inline styles) or RAW (JS colour APIs)`,
  },
  {
    id: "mono",
    re: /\bui-monospace\b|\bmonospace\b/g,
    ok: () => false,
    msg: () => `bare monospace font stack — use FONT.mono (UI chrome) or FONT.term (xterm only)`,
  },
  {
    id: "radius",
    re: /"border-radius"\s*:\s*"([^"]+)"/g,
    ok: (m) => RADIUS_OK.has(m[1].trim()),
    msg: (m) => `border-radius "${m[1]}" is off the R scale — use R.xs/sm/md/lg/xl/full`,
  },
  {
    id: "fontsize",
    re: /"font-size"\s*:\s*"([^"]+)"/g,
    ok: (m) => FONTSIZE_OK.has(m[1].trim()) || /^(var\(|inherit$|\d*\.?\d+e[m|x]$|\d+%$)/.test(m[1].trim()),
    msg: (m) => `font-size "${m[1]}" is off the T scale — use 10 / 11 / 12 / 13 / 15 / 20px`,
  },
  {
    id: "blur",
    re: /backdrop-filter|filter"\s*:\s*"[^"]*blur\(/g,
    ok: () => false,
    msg: () => `backdrop-filter / blur filter is banned app-wide — opaque var(--bg-3) + var(--sh-2), var(--hl-top)`,
  },
];

function walk(abs, out) {
  if (statSync(abs).isFile()) {
    if (/\.tsx?$/.test(abs)) out.push(abs);
    return out;
  }
  for (const name of readdirSync(abs)) walk(join(abs, name), out);
  return out;
}

const files = [];
for (const t of TARGETS) walk(resolve(ROOT, t), files);

const findings = [];
for (const abs of files.sort()) {
  const rel = relative(ROOT, abs).split("\\").join("/");
  if (EXEMPT_FILES.has(rel) || EXEMPT_DIRS.some((d) => rel.startsWith(d))) continue;
  const waived = new Set(PENDING[rel] ?? []);
  const lines = readFileSync(abs, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (waived.has(rule.id)) continue;
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.ok(m)) continue;
        findings.push(`${rel}:${i + 1}  [${rule.id}] ${rule.msg(m)}`);
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`lint-tokens: ${findings.length} finding(s)\n`);
  for (const f of findings) console.error("  " + f);
  console.error("\nSee DESIGN.md for the rules. Waivers go in PENDING in scripts/lint-tokens.mjs.");
  process.exit(1);
}

console.log(`lint-tokens: ${files.length} file(s) clean`);
