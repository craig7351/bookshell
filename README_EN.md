# BOOKSHELL

SSH terminal for AI agents — a Tauri 2 + SolidJS desktop app with multi-tab xterm sessions.

**English** | [中文](README.md)

![BOOKSHELL screenshot](bookshell.png)

## Features

- Multi-tab SSH and local shell sessions (xterm.js + WebGL renderer)
- Side terminal panel with independent font size
- Clickable URLs, middle-click paste, scrollback search
- Persistent SSH sessions with keepalive past server idle timeouts
- Transcript export and in-app log viewer with ANSI replay
- Tab cycling via `Shift+Up` / `Shift+Down` from anywhere

## Screenshots

**Pin a tab's working directory** — right-click a tab and set `cwd`. The path is remembered, so next time you launch BOOKSHELL the tab opens directly in that folder.

![Pin tab cwd](docs/image1.jpg)

**Logs panel** — the top-right Logs view automatically records every tab's content, including conversations with your AI agent.

![Logs panel](docs/image2.jpg)

**Git view** — inspect the changes inside any commit by SHA.

![Git view by SHA](docs/image3.jpg)

## Development

```bash
npm install
npm run tauri dev
```

## Building

```bash
npm run tauri build
```

Output goes to `src-tauri/target/release/bundle/`.

## Releases

Push a tag matching `v*` to trigger a multi-platform GitHub Actions release build:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds installers for Windows, macOS (Apple Silicon and Intel), and Linux, then uploads them to a draft release on GitHub.

## License

See `LICENSE`.
