# CHANGELOG (English)

This file feeds the GitHub release notes. `scripts/release-notes.js` reads the
section for the version being released from here and refuses to generate notes
when the section is missing. Release notes are **always English**, even though
the project changelog in [`CHANGELOG.md`](CHANGELOG.md) is kept in Turkish.

Add a `## [X.Y.Z] — YYYY-MM-DD` section here for every release.

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
