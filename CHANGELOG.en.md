# CHANGELOG (English)

This file feeds the GitHub release notes. `scripts/release-notes.js` reads the
section for the version being released from here and refuses to generate notes
when the section is missing. Release notes are **always English**, even though
the project changelog in [`CHANGELOG.md`](CHANGELOG.md) is kept in Turkish.

Add a `## [X.Y.Z] — YYYY-MM-DD` section here for every release.

## [1.4.4] — 2026-11-24

### Added — macOS support

- **macOS builds:** disk images for Apple silicon (`macOS-TailRef-1.4.4-arm64.dmg`)
  and Intel (`macOS-TailRef-1.4.4-x64.dmg`). The configuration lives under
  `build.mac`; the release pipeline builds the native module for both
  architectures and produces one image per architecture.
- **`.tail` file association:** a `CFBundleDocumentTypes` entry plus an
  `app.on('open-file')` handler. Double-clicking a board in Finder now behaves
  like Windows and Linux: the path is forwarded to a running window, or
  consumed by the renderer on a cold start.
- **Ad-hoc signing:** `mac.identity: "-"`, hardened runtime and
  `build/entitlements.mac.plist`. Without an Apple Developer ID the images are
  not notarized, so Gatekeeper asks for confirmation on the first launch
  (see `docs/MACOS.md`).
- **`build-native.js --arch=`:** cross-architecture builds from a single
  runner (x64 `inkcore.node` on an arm64 runner).
- **A real launch check in CI:** `scripts/launch-smoke.js` starts the `.app`
  copied out of the disk image in a temporary data folder and on an isolated
  port, then verifies `appReady` and the board scene. A package that does not
  start cannot be released.

### Changed - platform-prefixed release assets

Release assets are now named after the platform first, so the download list
groups itself: `Windows-TailRef-<version>-Setup.exe` and
`Windows-TailRef-<version>-Portable.exe`, `Linux-TailRef-<version>-x86_64.AppImage`,
`Linux-TailRef-<version>-amd64.deb` and `Linux-TailRef-<version>-x86_64.rpm`,
`macOS-TailRef-<version>-arm64.dmg` and `macOS-TailRef-<version>-x64.dmg`.
`latest.yml` keeps its name because the Windows updater requires it; it points
at the renamed installer, so in-app updates keep working.

### Fixed - settings and interface audit

- **High contrast never applied.** Its selector had the same specificity as the
  theme selector, so the colors were silently overridden.
- **Rain and snow were invisible in custom themes.** A custom theme saved from
  Rain/Snow lost both the effect and the backdrop gradient; the theme model now
  stores `effect` and `backdropCss`, and canvas visibility is driven by
  `html[data-ambient]`.
- **The theme reverted on a mode switch.** A gallery pick is now written to the
  active mode key (`tailref-theme-draw` / `tailref-theme-reference`).
- **"Cursor-anchored zoom" was a dead setting.** It now zooms around the
  pointer; the default is on, which preserves the old behavior.
- **"Editor grid step" was a dead setting.** It now drives the `#gridOverlay`
  background size; the default is 32 px.
- **The settings footer was clipped.** The e-mail and copyright lines moved to
  a CSS grid; the copyright sits under the e-mail and the buttons span both
  lines.
- **Narrowing the panel collapsed the settings text to one letter per line.**
  `#settings` is a container query now: below 560 px the navigation becomes a
  horizontal strip, the footer text takes the full width and Save/Reset move to
  their own row.
- **Empty-board hint:** the logo and wordmark were removed.
- **Mode order:** identical in every panel (`3D Pose → Reference → Drawing`).
- **The update panel now describes macOS correctly.** With the updater
  disabled it said "On Linux…" on every platform; macOS has its own sentence,
  translated into all nine languages.
- **Drawing-mode top bar:** buttons are pinned to 30 px, and the bar no longer
  stretches; the collapse/expand animation is back.

### Localization

- The remaining 275 translation keys were closed in 8 languages: 10 languages,
  15087 keys, no key falls back to English (`MAX_UNTRANSLATED = 0`).

## [1.4.3] — 2026-11-23

### Added — Linux support

- **Linux packages:** AppImage, deb and rpm targets for x86_64
  (`TailRef-<version>.AppImage`, `tailref_<version>_amd64.deb`,
  `tailref-<version>.x86_64.rpm`). The electron-builder configuration lives
  under `build.linux`, `build.appImage`, `build.deb` and `build.rpm`.
- **Desktop integration:** menu entry, 512×512 icon, the `Graphics` category
  and the `application/x-tailref-board` MIME type. Installing the deb or rpm
  makes `.tail` files open on double-click; the `shared-mime-info` and
  `desktop-file-utils` package triggers register them automatically.
- **Window and file handling:** Linux uses the PNG icon, enables
  `--ozone-platform-hint=auto` for Wayland, and resolves the `file://` URIs
  passed by the desktop entry as `.tail` paths.
- **Native module:** `scripts/build-native.js` detects the Linux/macOS
  toolchain (cc/gcc/clang, make, python3), builds for `process.arch` and
  supports offline headers through `TAILREF_NODEDIR`. If the module cannot be
  built, the JavaScript fallback takes over.
- **Update policy:** in-app updates are disabled on Linux
  (`reason = 'platform'`); a Windows installer is never downloaded on Linux.
  Updates come from the package manager or a new AppImage.
- **Release pipeline:** `release.yml` is now split into the `prepare`, `test`,
  `windows`, `linux` and `release` jobs. Windows and Linux build on separate
  runners, package contents are verified, `SHA256SUMS.txt` is generated, and
  the GitHub Release is created only when every job is green.
  `latest-linux.yml` is deliberately not published.
- **Release notes:** `scripts/release-notes.js` generates
  `dist/RELEASE_NOTES.md` with per-platform downloads, requirements,
  checksums, known limitations, upgrading and troubleshooting sections.
- **Flatpak preparation:** a Flathub manifest, AppStream metadata, desktop
  entry, `zypak` launcher and pinned npm/Electron sources under `flatpak/`.
  No submission has been made to Flathub; it must not be presented as
  published.
- **Documentation:** `docs/LINUX_BUILD.md`, `docs/LINUX_INSTALLATION.md`,
  `docs/RELEASE_PROCESS.md` and `docs/FLATPAK.md`; the README download table
  and FAQ now cover Linux.
- **CI:** pure gates on Ubuntu, Linux packaging and an AppImage/Xvfb smoke
  test were added.

### Changed

- **`.tail` file type description:** the file association now carries the
  "TailRef Studio document" description. The Windows Explorer "Type" column
  and the Linux "Open with" list show this name. The open command, icon and
  extension registration are unchanged.
