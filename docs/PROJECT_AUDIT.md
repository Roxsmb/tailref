# Project Audit

This is the pre-change audit of the TailRef repository, performed before the
GitHub publication cleanup. It records what the project is, what was found, and
what was intentionally left alone.

> **License note (2026-11-21).** This audit records the repository as it was
> before the original GitHub publication. The project has since been relicensed
> from PolyForm Noncommercial 1.0.0 to GPL-3.0-or-later. The licensing findings
> below are kept as history; see [`LICENSE_MIGRATION.md`](LICENSE_MIGRATION.md)
> for the current state.

## 1. Method

- Read every top-level directory, the package configuration, the build scripts,
  the Electron main/preload code, the renderer entry points and the test runner.
- Inspected the Electron security settings, the CSP, the guest-panel guards and
  the preload surface.
- Scanned source, docs and scripts for secrets, tokens and absolute local paths.
- Inventoried dependencies from `package.json` and `package-lock.json`.
- Checked every documentation link that pointed at a file in the repository.
- Did **not** modify any file during this phase.

## 2. Verified technology stack

| Layer | Technology |
|---|---|
| Shell | Electron 45.0.0 |
| Language | Plain JavaScript (no TypeScript files, no `tsconfig.json`) |
| Renderer | Vanilla DOM + CSS, Canvas2D, optional WebGL dabs, Web Workers |
| 3D | three.js r170, vendored under `src/renderer/vendor/` |
| Compression | fflate 0.8.2, vendored |
| Native (optional) | C++ N-API kernel in `native/inkcore` |
| Storage | IndexedDB, `localStorage`, `.tail` files (deflate + JSON) |
| Build | Custom `scripts/build-app.js` concatenation + electron-builder 26.18.0 |
| Tests | Standalone Node gates + Electron/CDP channels |
| Runtime npm dependencies | **0** |
| Dev dependencies | `electron`, `electron-builder` (plus an unused `typescript`) |

The old README described the app as "Electron + TypeScript" and mentioned a
`canvas-editor.js` bundle. Both were inaccurate.

## 3. Inventory

```
src/main              10 files   188 KB
src/preload            4 files    32 KB
src/renderer          15 files   4.4 MB
src/renderer/core     73 files   3.3 MB   → concatenated into app.js (3.3 MB)
src/renderer/pose3d   22 files   243 KB
src/renderer/vendor   28 files   1.8 MB   (three.js + examples)
tests                164 files   3.6 MB   (69 gates + QA probes)
scripts               19 files   145 KB
docs                  36 files   4.3 MB
locales               23 files   973 KB
assets                10 files   6.3 MB
build                  9 files   188 KB
```

There is no Git repository in the working copy (`git status` is unavailable),
so history-preservation rules apply to the future repository, not to this
folder.

## 4. Findings

Severity: **H** = blocks publication / legal risk, **M** = broken workflow or
inaccurate documentation, **L** = cleanliness.

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | H | `LICENSE` was MIT, while the intended distribution model is free, source-available, noncommercial. `package.json` and the README also said MIT. | Replaced with the unmodified PolyForm Noncommercial 1.0.0 text and a Required Notice; package metadata and docs updated. Third-party MIT components keep their own licenses. |
| 2 | H | The brand raster inside the logo files was suspected to derive from removed AI-generated art; provenance was unverified. | Author confirmed the mark is original hand-drawn artwork; provenance is now recorded in `THIRD_PARTY_NOTICES.md`, and no AI-generated asset is distributed. |
| 3 | H | README claimed "open-source" and "MIT". | Corrected to "free and source-available, noncommercial". |
| 4 | M | `.gitignore` contained `app.js`, a pattern that also matches `src/renderer/app.js`, which the app needs. A fresh clone would be missing the bundle. | Replaced with `/app.js` (root only) and explicit build/temp rules. |
| 5 | M | CI ran `scripts/build-canvas-editor.js`, which does not exist, so CI could never be green. | Workflow rewritten to use the real build. |
| 6 | M | CI ran `run-gates.js`, which includes `verify-package.js`; that gate requires `dist/win-unpacked`, so a fresh clone/CI always failed. | The runner now skips the package gate with an explicit message when no build exists. |
| 7 | M | `tests/overload-test.js` and `tests/pinterest-test.js` bound local servers to port **5194**, the production app port. Running tests while the app was open caused `listen EACCES 127.0.0.1:5194` for the user. | Moved to 5411 and 5412. |
| 8 | M | README referenced `docs/screenshots/board.png`, `ink.png`, `pose3d.png`; the directory did not exist. | Screenshot section rewritten; only real files are linked. |
| 9 | M | `typescript` was a dev dependency with no TypeScript sources. | Removed; lockfile updated. |
| 10 | M | `package.json` author was `"TailRef"`, not the developer. | Set to `Emre Melik Nameli`; brand is expressed via `productName` and `build.copyright`. |
| 11 | M | In-app About text said "open-source". | Corrected to "free, source-available". |
| 12 | M | No copyright/credits line existed in About or Settings. | Added a Credits block and a settings-footer line (see the branding section below). |
| 13 | M | Inter font files were shipped without a third-party notice; the fflate version in the notices was wrong (0.6.9 vs 0.8.2). | Notices rewritten; OFL and MIT texts added under `docs/licenses/`. |
| 14 | L | `ink-native-parity-check.js` was listed twice in the gate chain, inflating the count. | Duplicate removed; a documentation link gate was added. The chain is 69 gates. |
| 15 | L | `.tmp-ref/` held 20.8 MB of scratch files, backups and one-off scripts (303 files). | Deleted after verifying no code referenced it. |
| 16 | L | Four log files in the repository root. | Deleted; `*.log` is ignored. |
| 17 | L | Four `TODO-*.md` planning files in the root. | Moved to `docs/todo/`. |
| 18 | L | `tests/tmp-settings-shots/` held 2.8 MB of generated screenshots. | Deleted (regenerable test output). |
| 19 | L | Two docs and several test/probe scripts contained absolute `C:\Users\namel\...` paths; three FX/compositor gates hard-coded a user-specific temp directory and could not run on any other machine. | Docs use `<Desktop>`; tests use `os.tmpdir()`; probe defaults were made portable. |
| 20 | L | No `.gitattributes`, `.editorconfig`, issue templates, funding file or release docs. | Added. |

## 5. Security posture (verified, not changed)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webSecurity: true`, `allowRunningInsecureContent: false` on the main window.
- Strict CSP: `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`,
  `form-action 'none'`, scripts limited to `'self'`, frames limited to the known
  panel providers.
- Guest panels run in separate sessions with navigation and popup guards.
- No telemetry, no auto-update, no background network calls.
- No API keys, tokens or passwords found in the tree.
- No runtime npm dependency, so the runtime supply chain is limited to vendored
  code and Electron.

`webviewTag: true` is enabled on the main window because the panel architecture
uses `<webview>` with a dedicated, restricted preload. It is not exposed to
arbitrary remote content.

## 6. Intentionally not changed

- The license text as it stood during that audit (PolyForm Noncommercial 1.0.0,
  apart from the Required Notice line). It was replaced by GPL-3.0-or-later on
  2026-11-21; see [`LICENSE_MIGRATION.md`](LICENSE_MIGRATION.md).
- Third-party licenses and copyright notices (three.js, fflate, Electron,
  Chromium, fonts).
- The drawing engine, persistence formats, IPC surface and UI behaviour.
- The `.tail` format and its version byte.
- Existing Turkish architecture documents, except for local-path redaction.

## 7. Open blockers

1. **Code signing** — not available; release notes must keep the SmartScreen and
   checksum guidance.

The screenshot blocker is closed: the public README now embeds six real captures
from the application in `docs/screenshots/`.

The SimplexNoise licensing question is closed: the vendored file is byte-for-byte
the three.js r170 example module `examples/jsm/math/SimplexNoise.js` (apart from
a local SPDX header and the export line), so it is MIT under the three.js
license.
