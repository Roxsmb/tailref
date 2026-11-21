# Architecture

This document explains how TailRef is put together, where each responsibility
lives, and how to add code without breaking the build. It is written for a
developer who has never seen the project.

## At a glance

TailRef is an **Electron desktop application** written in **plain JavaScript**.
There is no framework, no bundler and no runtime npm dependency. The renderer is
served from local files, the drawing engine is custom Canvas2D/WebGL code, and
the optional 3D module uses a vendored copy of three.js.

```
┌─────────────────────────────────────────────────────────────┐
│ Main process (Node.js)                                      │
│  main.js · windows · IPC · .tail files · static server      │
│  panel-window-manager · guest guards · native ink host      │
└───────────────▲──────────────────────────────┬──────────────┘
                │ contextBridge (preload)      │ IPC
┌───────────────┴──────────────────────────────▼──────────────┐
│ Renderer (Chromium, sandboxed, no Node)                     │
│  index.html · app.js (73 core modules) · draw-v5.js         │
│  board · ink editor · layers · brushes · colors · settings  │
│  pose3d/ (ES modules, lazy loaded)                          │
└─────────────────────────────────────────────────────────────┘
```

Security posture (see [`SECURITY.md`](../SECURITY.md)):

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- a narrow API exposed through `contextBridge`
- a strict CSP on the main document
- guest panels (Pinterest, ArtStation) run in separate sessions with their own
  preload and navigation guards

## Directory map

```
tailref/
├── src/
│   ├── main/                  Electron main process
│   │   ├── main.js            app lifecycle, windows, IPC, .tail read/write
│   │   ├── static-server.js   tiny dependency-free static file server
│   │   ├── server.js          browser-only dev entry (node server.js)
│   │   ├── panel-window-manager.js  detached panel windows
│   │   ├── pinterest.js       Pinterest panel: session, allow-list, auth popups
│   │   ├── artstation.js      ArtStation panel: same pattern
│   │   ├── guest-guards.js    shared navigation/popup guards for guest panels
│   │   ├── dialog-l10n.js     native dialog translations (10 languages)
│   │   ├── external-links.js  allow-listed external link opening
│   │   └── ink-engine-host.js optional N-API ink kernel host
│   ├── preload/               contextBridge surfaces
│   │   ├── preload.js         main window API
│   │   ├── panel-preload.js   detached panel bridge
│   │   ├── pinterest-preload.js
│   │   └── artstation-preload.js
│   └── renderer/
│       ├── index.html         single-page shell (board, ink, settings, panels)
│       ├── app.js             GENERATED bundle — do not edit
│       ├── core/              73 numbered modules, concatenated into app.js
│       ├── canvas/draw-v5.js  canvas editor (tools, layers, compositor, FX)
│       ├── workers/           Web Workers (ink tiles, region processing)
│       ├── pose3d/            3D posing module (ES modules, lazy loaded)
│       ├── vendor/            three.js + examples (MIT)
│       ├── assets/            fonts, models, icons, brand files
│       └── *.css              base, editor, brushes, interface skins
├── native/inkcore/            optional C++ N-API ink kernel
├── scripts/                   build, gates, probes, packaging helpers
├── tests/                     gate chain + QA probes (not shipped)
├── locales/                   generated locale JSON (build-locales.js)
├── docs/                      architecture, format, licensing docs
├── build/                     electron-builder resources (icons, NSIS)
└── demos/                     standalone experiments (not shipped)
```

## Renderer module system

`src/renderer/app.js` is **generated** by `scripts/build-app.js`. It reads every
file in `src/renderer/core/` matching `^\d\d[a-z]?-.*\.js$`, sorts them by file
name, and concatenates them into one classic script.

Consequences:

- **File-name prefixes are load order.** `27-ink-core.js` runs before
  `28-ink-brush.js`. Renaming or renumbering a file changes execution order.
- Modules are plain script scopes, not ES modules. They share globals by design
  (`inkState`, `inkRuntime`, …) and rely on hoisted function declarations.
- `app.js` is committed so a fresh clone can be verified, but it is still
  generated. Never edit it by hand. Run `node scripts/build-app.js` after
  changing anything in `core/`.
- The build runs `node --check` on the result and restores the previous file if
  the output has a syntax error.

`canvas/draw-v5.js` and `pose3d/` are loaded separately. `pose3d.js` is an ES
module and boots lazily the first time the 3D view is used, so the app does not
pay the three.js cost at startup.

## Main areas of the renderer

| Prefix range | Area |
|---|---|
| `01`–`09` | bootstrap, l10n, state/IndexedDB, theme + interface registries, UI package format, geometry, persistence view, links/zoom |
| `10`–`19` | items, trash, interaction, menus/export, toolbar, floating panels + docking, themes/effects |
| `20`–`26` | settings/pomodoro/YouTube, brand bar, init, keymap, Pinterest, ArtStation, arrange, projects |
| `27`–`38` | ink core, brushes, rendering, tools, shape snap, UI, perf, stamps, undo, worker, editor |
| `39`–`44` | mode switching, GL dabs, canvas workspace, ink workspace + menus/controls |
| `48`–`55` | shell, draw prototype, layer stack, radial menu, native brush library, compositor, stabilizer |
| `56`–`69` | color, color picker, tile canon, tool manifest, tile view, settings hub, perf diagnostics, extended settings, theme studio, FX |

## State and persistence

There is no Redux-style store. State is split by lifetime:

- **Board state** (`state`): items, groups, view, trash. Persisted to IndexedDB.
- **Ink state** (`inkState()`): documents, layers, brushes, tool settings.
  Persisted inside the project snapshot and in dedicated library records.
- **Preferences**: `localStorage` keys such as `tailref-theme`,
  `tailref-interface`, keymap and drawing settings.
- **Brush library**: IndexedDB `meta` store, keys `ink:library` (categories,
  favorites, active brush) and `ink:brushes` (brush records + tip data URLs).
  This is intentionally independent of the project file so brushes survive
  project changes.
- **Project files** (`.tail`): `TAIL` magic + version byte + deflate-compressed
  JSON payload. See [`TAIL_FORMAT.md`](TAIL_FORMAT.md).

Two save modes exist, chosen in the first-run welcome dialog:

- **Automatic** — IndexedDB plus rotating JSON backups in
  `%APPDATA%\TailRef\Backups\`.
- **Manual** — only `Ctrl+S` writes a `.tail` file; a pending file is previewed
  and confirmed on the next launch.

Rules for persistence code:

- A library operation that changes what the project snapshot contains must call
  `scheduleSave()`; otherwise the next launch can restore a stale snapshot.
- Never delete or overwrite user data without an explicit user action.
- Keep the `.tail` version byte and reader backward compatible.

## Drawing engine

The ink engine is layered:

1. **Input/stabilizer** (`54-ink-stabilizer.js`, tool code in `30-ink-tools.js`)
2. **Stamp generation** (`33-ink-stamp.js`, optional GL path `40-ink-dab-gl.js`)
3. **Tile/region processing** (`35-ink-worker.js`, `workers/*`) — dirty regions
   are processed off the main thread where possible
4. **Compositor** (`53-ink-compositor.js`) — layers, masks, blend modes
5. **Presentation** (`29-ink-render.js`, `57-ink-tile-canon.js`,
   `59-ink-tile-view.js`)

The parity rule is: **what you see while drawing must equal what is committed to
the layer**. Tests such as `live-parity-probe.js` and
`ink-native-parity-check.js` exist to protect that.

`native/inkcore` is an optional C++ N-API kernel. If it is not built, the app
falls back to the JavaScript path with no functional loss.

## Panels (Pinterest, ArtStation)

Guest sites are loaded in a separate `session` partition and restricted by
`guest-guards.js`:

- navigation is limited to the provider's own domains;
- new windows are allowed only for the provider's auth flow;
- login popups close when authentication finishes;
- the guest preload exposes only the small bridge the panel needs;
- the guest has no Node access.

A panel can be docked in the main window or detached into its own always-on-top
window (`panel-window-manager.js` + `17b-panel-dock.js`). The detached window
mirrors the panel DOM and forwards interaction through IPC.

## Automatic updates

`src/main/update-manager.js` owns the update state machine: startup check
(25 s delay), periodic checks (4 h), manual checks, download, install and the
save handshake. `src/main/update-policy.js` holds the pure parts (SemVer
ordering, release-note sanitising, error mapping, preference validation) so they
can be tested without Electron.

`electron-updater` is pinned to the GitHub provider (`Roxsmb/tailref`) and is
configured with `autoDownload = false`, `autoInstallOnAppQuit = false`,
`allowDowngrade = false` and `allowPrerelease = false` on the stable channel.
The renderer talks to it only through the narrow `update:*` preload bridge; the
main process verifies the sender of every call.

The installed NSIS build updates in place. Portable builds (`PORTABLE_EXECUTABLE_*`
environment variables) and development runs report a disabled state and offer a
manual download page instead.

## Build and packaging

```
scripts/build-app.js      core/*.js  →  src/renderer/app.js
scripts/build-native.js   native/inkcore → .node (optional, falls back)
scripts/build-locales.js  locale sources → locales/*.json
electron-builder          src/** + native/** + LICENSE + NOTICE + notices
                          → dist/TailRef_Studio.exe (portable)
                          → dist/TailRef_Studio_Setup.exe (NSIS)
```

`scripts/verify-package.js` opens `dist/win-unpacked/resources/app.asar` and
compares the packaged copies of the critical files against the working tree, and
checks that the packaged `package.json` version matches. It prints
`PAKET GÜNCEL` on success.

## Tests and gates

`scripts/run-gates.js` runs the quality gates:

- **PURE** (14 gates): pure Node checks - unit tests, format validators, color
  math, static analysis, package verification.
- **FULL** (`--full`, 69 gates total): adds Electron + CDP channels that drive
  the real app — drawing parity, undo, layers, panels, persistence, themes,
  smoke tests.

Each gate is a standalone script in `tests/`. A gate exits non-zero on failure
and is retried once before the chain stops, so a one-off GPU/timing flake does
not look like a regression (a real regression fails both runs).

`tests/_qa/` and `tests/_bug-hunt/` contain one-off probes used during
investigations. They are development tools, not part of the chain.

## How to add things

### A renderer feature

1. Pick the right prefix range and create `src/renderer/core/NN-name.js`.
2. Write plain script code; rely on hoisted functions and shared globals.
3. Add UI to `index.html` and styles to the matching CSS file.
4. Run `node scripts/build-app.js`.
5. Add a gate in `tests/` and register it in `scripts/run-gates.js`.

### A main-process service

1. Add `src/main/my-service.js` exporting a small API.
2. Wire it in `main.js` and register IPC handlers there.
3. Expose only what the renderer needs in `src/preload/preload.js` via
   `contextBridge`.
4. Validate every argument that crosses the IPC boundary; never pass file paths
   or URLs through unchecked.
5. Add a gate that drives the real IPC path.

### A guest panel

1. Create `src/main/<site>.js` using `registerGuestSite()`.
2. Add a dedicated preload with a minimal bridge.
3. Add the domain to the CSP `frame-src` list and to the link allow-list.
4. Add tests for navigation, popup and blocked-domain behaviour.

### A theme or interface

Themes and interface skins are data, not code: see
`02b-theme-registry.js`, `02c-interface-registry.js` and
`02d-ui-package-format.js`. UI packages are validated by
`scripts/ui-package-validate.js` before they can be applied.

### A translation

Add or edit keys in `src/renderer/core/01c-locale-data.js` (renderer) and
`src/main/dialog-l10n.js` (native dialogs), then rebuild. Keep placeholders such
as `{n}` intact.

## Pitfalls

- Editing `app.js` directly — the next build overwrites it.
- Renaming `core/*.js` without checking load order.
- Forgetting `scheduleSave()` after a library or settings mutation that is part
  of the project snapshot.
- Adding a runtime npm dependency — the app is deliberately dependency-free.
- Using absolute local paths or personal data in source, tests or docs.
- Assuming a UI update implies a repaint: `inkSyncUI()` is not a compositor
  call. Use the explicit invalidate path when the canvas content changes.
