# Development

This guide is for people changing TailRef's code. For the big picture, read
[`ARCHITECTURE.md`](ARCHITECTURE.md) first.

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22 LTS (required: the CDP tests use the global `WebSocket`) | everything |
| npm | bundled with Node | dependencies, scripts |
| Windows 10/11 x64 | — | Windows packaging and the Electron gates |
| Linux x64 | glibc 2.25+ | Linux packaging, AppImage/deb/rpm gates |
| macOS 12+ (Apple silicon or Intel) | Xcode command line tools | macOS packaging (dmg), see `docs/MACOS.md` |
| Visual Studio Build Tools (C++) | optional | building `native/inkcore` |
| Python + Pillow/NumPy | optional | regenerating brand assets |

Runtime dependencies: **none**. Everything the app needs at runtime is either in
`src/` or vendored under `src/renderer/vendor/`.

## First run

```bash
npm install
npm start
```

`npm start` runs `scripts/build-app.js` and then launches Electron.

## Everyday commands

```bash
npm run bundle        # regenerate src/renderer/app.js only
npm start             # bundle + launch the app
npm run gates         # fast chain: 31 pure gates
npm run gates:full    # full chain: 86 gates (Electron + CDP, slow)
npm run build:dir     # unpacked Windows build in dist/win-unpacked
npm run build:linux   # AppImage + deb + rpm (Linux host)
npm run build:mac     # dmg for the host architecture (macOS host)
npm run test:package  # verify app.asar matches the working tree
node scripts/launch-smoke.js --exe="dist/win-unpacked/TailRef Studio.exe"  # launch the packaged app
npm run build:portable
npm run build:setup
```

Useful individual gates:

```bash
node tests/brush-library-test.js   # brush persistence + .abr round-trip
node tests/ink-smoke.js            # drawing engine
node tests/compositor-test.js      # layers/compositor
node tests/desktop-smoke.js        # window, menus, startup
node tests/update-policy-test.js   # SemVer, sanitising, error mapping
node tests/update-manager-test.js  # update state machine + save handshake
node tests/update-static-test.js   # updater IPC/preload/security invariants
```

## The bundle rule

`src/renderer/app.js` is generated from `src/renderer/core/*.js`:

- files must match `^\d\d[a-z]?-.*\.js$`;
- they are concatenated in **file-name order**;
- the build runs `node --check` and rolls back on syntax errors.

If you edit `core/`, always run `npm run bundle` (or `npm start`). A stale
`app.js` is the most common cause of "my change does nothing" and of
`verify-package` failures.

## Testing

The project uses a gate chain instead of a single test runner:

- `scripts/run-gates.js` contains the ordered list.
- Every gate is a standalone Node script in `tests/`.
- A gate exits non-zero on failure; a failing gate is retried once, then the
  chain stops if it fails again (a real regression fails both runs; a one-off
  GPU/timing flake does not block the chain).
- Gates that need the real app launch Electron and drive it over the Chrome
  DevTools Protocol (CDP).
- `verify-package.js` is skipped automatically when `dist/win-unpacked` does not
  exist (fresh clone, CI), and runs when a build is present.

Rules:

1. Every real bug fix gets a regression check in the relevant gate.
2. Never claim a gate passed unless you ran it.
3. Gates must be deterministic; no sleeps that hide races, no network access.
4. Test ports must not collide with the production port (`5194`) or with each
   other. See the `APP_PORT` / `DEBUG_PORT` constants at the top of each test.

QA probes in `tests/_qa/` and `tests/_bug-hunt/` are investigation helpers. They
are not part of the chain and may require a running app.

## Debugging

- **Renderer:** `Ctrl+Shift+I` opens DevTools (development builds).
- **CDP:** gates connect to a debug port and evaluate expressions in the page.
  Copy the pattern from an existing gate when writing a new one.
- **Main process:** add temporary `console.log` calls and watch the terminal.
- **Performance:** `scripts/ink-bench.js` and the probes under `tests/_qa/`
  measure stroke, slider, undo, layer-switch and idle-frame cost. Measure before
  and after a change; do not guess.
- **Native kernel:** `npm run build:native`; if it fails, the app falls back to
  the JS path and still works.

## Native kernel (optional)

```bash
npm run build:native
# → native/inkcore/build/Release/inkcore.node
```

Requires Python and the MSVC C++ toolchain. The build is allowed to fail: the
app detects the missing `.node` file and uses JavaScript instead.

## Dependencies

- **Runtime:** keep it at zero. Do not add an npm package that ships in the app.
  If you need a library, vendor it with its license and add it to
  [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
- **Build-time:** `electron`, `electron-builder`. Update deliberately:

  ```bash
  npm outdated
  npm update electron electron-builder
  npm run gates:full
  npm run build:portable
  npm run test:package
  ```

- Electron upgrades can change Chromium behaviour. Re-run the full chain and
  check the drawing gates specifically.
- `npm audit --omit=dev` is informational; there are no runtime dependencies.

## Code style

- Plain JavaScript, `'use strict'`, two-space indentation, single quotes.
- Small functions with a short comment explaining *why*, not *what*.
- No new frameworks, no build step beyond `build-app.js`.
- Match the naming of the area you touch (`ink*`, `settings*`, `panel*`).
- User-facing strings go through the localization layer when the surrounding
  code does; do not hard-code a new language in only one place.
- New source files start with an SPDX header:
  `// SPDX-License-Identifier: GPL-3.0-or-later` and
  `// Copyright (C) 2026 Emre Melik Nameli`. Do not add license headers to
  vendored third-party files; they keep their own notices.

## Common problems

| Symptom | Cause | Fix |
|---|---|---|
| Change has no effect | stale `app.js` | `npm run bundle` |
| `verify-package` FAIL | build older than source | rebuild, then verify |
| `listen EACCES 127.0.0.1:5194` | another instance or test uses the port | close it |
| Gate hangs at launch | a stale Electron process | kill `TailRef Studio` processes, rerun |
| Native build fails | missing MSVC/Python | ignore; JS fallback is used |
| `npm` not found in PowerShell | PATH issue | use the full path to `npm.cmd` |

## Where to start reading

1. `src/main/main.js` — lifecycle, windows, IPC.
2. `src/preload/preload.js` — the renderer's only door to the system.
3. `src/renderer/core/01-bootstrap.js` — DOM and shared helpers.
4. `src/renderer/core/27-ink-core.js` — drawing state.
5. `src/renderer/canvas/draw-v5.js` — the editor itself.
6. `docs/ARCHITECTURE.md` — how the pieces fit.
