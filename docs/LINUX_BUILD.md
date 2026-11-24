# Building TailRef Studio for Linux

This document describes how the Linux artifacts are produced and how to
reproduce them locally. It covers the AppImage, deb and rpm builds; the Flatpak
build has its own document, [`FLATPAK.md`](FLATPAK.md).

## Artifacts

Every Linux build produces three files with fixed names:

| File | Target | Package manager |
|---|---|---|
| `Linux-TailRef-<version>-x86_64.AppImage` | AppImage, x86_64 | none |
| `Linux-TailRef-<version>-amd64.deb` | deb, amd64 | `apt`, `dpkg` |
| `Linux-TailRef-<version>-x86_64.rpm` | rpm, x86_64 | `dnf`, `zypper`, `rpm` |

`<version>` is the `version` field in `package.json` (for example `1.4.4`).
The names are pinned in `package.json` under `build.appImage`, `build.deb` and
`build.rpm`, so a build from a clean checkout always produces exactly these
names.

Only x86_64 is built. ARM64 Linux is not published.

## Why the build runs on Linux

electron-builder can *cross-compile* the unpacked Linux directory on Windows,
but it cannot reliably produce an AppImage, deb or rpm there:

- `fpm` (used by the deb and rpm targets) is a Ruby tool that expects a Unix
  environment and Unix file permissions.
- The AppImage tooling creates symlinks, sets executable bits and builds a
  squashfs image.
- The native `inkcore` module must be compiled against the Linux Electron
  headers with a Linux C++ toolchain. A Linux directory built on Windows would
  embed the Windows `inkcore.node`; `scripts/verify-package.js` detects that
  mismatch and fails the build (see [Verify a build](#verify-a-build)).

Use one of these instead:

1. The GitHub Actions release workflow (`.github/workflows/release.yml`), which
   builds on `ubuntu-22.04`. This is the supported path.
2. A native Linux machine or VM.
3. A Linux container on any host.

## Prerequisites

The reference environment is Ubuntu 22.04 (glibc 2.35). The bundled Electron
45.4.1 binaries reference at most `GLIBC_2.25` (`tailref`, the main executable,
needs 2.25; the bundled libraries stop at 2.17), so the runtime floor is lower
than the build host. The optional `inkcore` module is compiled on the Ubuntu
22.04 runner and therefore needs glibc 2.35; on an older system it fails to load
and the app uses the JavaScript path, which is a supported configuration.

In practice the supported targets are Ubuntu 20.04+ (22.04 and 24.04 are the
tested LTS releases), Debian 11+, Linux Mint 20+, Fedora 32+ and current
Arch/CachyOS/openSUSE releases. Older distributions are not tested.

Install the build dependencies:

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential python3 make rpm xvfb libfuse2 \
  libgtk-3-0 libnss3 libasound2 libgbm1 libatk-bridge2.0-0 \
  libxss1 libxtst6 xdg-utils
```

`rpm` is only needed for the rpm target. `xvfb` and `libfuse2` are only needed
for the smoke test.

You also need Node.js 22 or newer (`node --version`) and npm.

## Build

From the repository root:

```bash
npm ci
node scripts/build-app.js        # bundles the renderer into src/renderer/app.js
node scripts/build-native.js     # compiles native/inkcore (optional, see below)
npx electron-builder --linux AppImage deb rpm --publish never
```

The files land in `dist/`:

```
dist/Linux-TailRef-1.4.4-x86_64.AppImage
dist/Linux-TailRef-1.4.4-amd64.deb
dist/Linux-TailRef-1.4.4-x86_64.rpm
dist/linux-unpacked/          # unpacked application used by the packages
dist/latest-linux.yml         # update metadata; deliberately not published
```

Convenience scripts exist for local use:

```bash
npm run build:linux        # AppImage + deb + rpm
npm run build:linux:dir    # only dist/linux-unpacked (fastest)
```

`--publish never` matters: without it electron-builder may try to contact the
GitHub publisher configured in `package.json`.

### Native `inkcore` module

`native/inkcore` is a small N-API addon (see `native/inkcore/src`). It is
optional: when the compiled module is missing or fails to load, the renderer
falls back to the JavaScript implementation and the app still works.

`scripts/build-native.js`:

- detects the toolchain (`cc`/`gcc`/`clang`, `make`, `python3`) on Linux and
  macOS, and Visual Studio on Windows;
- builds for `process.arch` instead of a hard-coded `x64`;
- targets the Electron ABI declared in `node_modules/electron/package.json`;
- supports `TAILREF_NODEDIR` for offline builds (used by the Flatpak manifest),
  in which case node-gyp reads the headers from that directory instead of
  downloading them.

If the toolchain is missing, the script prints a warning and exits successfully
so a JavaScript-only build is still possible. Check the log for
`[inkcore] derleme:` to confirm the module was compiled.

Never copy a Windows `inkcore.node` into a Linux build. electron-builder only
includes `native/inkcore/build/Release/inkcore.node`, so build on the target
platform and let the script place it there.

## Verify a build

```bash
# app.asar contains the current sources, and the native module matches the
# target platform (ELF on Linux, PE on Windows, Mach-O on macOS)
node scripts/verify-package.js dist/linux-unpacked

# package names and contents
ls -l dist/Linux-TailRef-*.AppImage dist/Linux-TailRef-*.deb dist/Linux-TailRef-*.rpm
dpkg-deb -I dist/Linux-TailRef-1.4.4-amd64.deb
dpkg-deb -c dist/Linux-TailRef-1.4.4-amd64.deb | grep -E 'tailref$|tailref\.desktop|tailref\.xml|512x512'
rpm -qip dist/Linux-TailRef-1.4.4-x86_64.rpm
rpm -qlp dist/Linux-TailRef-1.4.4-x86_64.rpm | grep -E 'tailref$|tailref\.desktop|tailref\.xml|512x512'

# AppImage payload
./dist/Linux-TailRef-1.4.4-x86_64.AppImage --appimage-extract >/dev/null
ls squashfs-root/*.desktop
grep -E '^(Exec|MimeType|Icon)=' squashfs-root/*.desktop
rm -rf squashfs-root
```

A quick smoke test on a headless machine:

```bash
chmod +x dist/Linux-TailRef-1.4.4-x86_64.AppImage
xvfb-run -a --server-args="-screen 0 1280x800x24" \
  timeout 25s ./dist/Linux-TailRef-1.4.4-x86_64.AppImage --appimage-extract-and-run --no-sandbox --disable-gpu
```

`timeout` exits with status 124 when the app is still running after 25 seconds;
that is the expected result. Any other exit status means the app crashed.

The CI and release workflows run the same checks automatically.

## What the Linux package installs

| Path | Contents |
|---|---|
| `/opt/TailRef Studio/` | Application, `resources/app.asar`, native module |
| `/usr/share/applications/tailref.desktop` | Menu entry, `MimeType=application/x-tailref-board;` |
| `/usr/share/icons/hicolor/<size>x<size>/apps/tailref.png` | Icon set generated from the 512×512 PNG |
| `/usr/share/mime/packages/tailref.xml` | `.tail` MIME type |

The `shared-mime-info` and `desktop-file-utils` packages register the MIME type
and the menu entry through their package triggers. That is why the deb/rpm do
not ship custom post-install scripts.

Inside the AppImage nothing is installed: the application sits at the image
root (`tailref`, `resources/`, `AppRun`), the desktop entry is `tailref.desktop`
at the root, and the icon and MIME XML are under `usr/share/`.

The `.desktop` file is generated by electron-builder from `build.linux.desktop`
in `package.json`. `desktopName` in `package.json` is `tailref.desktop`, which
Electron uses as its `app_id`/`WM_CLASS`, so the running window is associated
with the menu entry.

## Linux-specific code changes

These are the only platform branches added to the application code:

- `src/main/main.js` uses `build/icon.png` on Linux (Electron cannot read
  `.ico` on Linux) and `build/icon.ico` on Windows. Each platform's icon is
  copied to `resources/` through `build.win.extraResources` and
  `build.linux.extraResources`, so a Linux package never contains a Windows
  icon and vice versa.
- `src/main/main.js` adds `--ozone-platform-hint=auto` on Linux so Wayland
  sessions use the native backend and X11 sessions keep working.
- `src/main/main.js` calls `app.setDesktopName('com.tailref.studio.desktop')`
  when `FLATPAK_ID` is set, so the Flatpak window's app_id/WM_CLASS matches the
  desktop file installed by the manifest. The variable only exists inside the
  Flatpak sandbox, so deb/rpm/AppImage windows keep `tailref.desktop`.
- `extractBoardPath()` accepts `file://` URIs in addition to plain paths,
  because the desktop entry is started with `%U`.
- `src/main/update-manager.js` already disables the updater when
  `process.platform !== 'win32'`; nothing else was needed.

The `.tail` format, settings, autosave, recovery, import/export, the Windows
targets and artifact names, and the Windows update path are unchanged. The only
Windows-visible difference is the registered file-type description for `.tail`,
which is now filled in (`TailRef Studio document`) instead of empty; the open
command, icon and extension registration are the same.

## Troubleshooting

**`Cannot find module 'app-builder-bin'`** — run `npm ci` again; the dev
dependencies include electron-builder and its binaries.

**AppImage fails with `dlopen(): error loading libfuse.so.2`** — install
`libfuse2` (Ubuntu 22.04+) or run with `--appimage-extract-and-run`.

**`fpm` fails with a Ruby error** — install `rpm` and make sure `ruby` is
available (`fpm` is bundled with electron-builder and runs under its own Ruby
on most images; on minimal containers install `ruby` and `ruby-dev`).

**Native module is missing from the package** — check the
`node scripts/build-native.js` output. If the toolchain is absent the build is
still valid, but the app uses the JavaScript fallback.

**AppImage does not start on Wayland** — try
`./Linux-TailRef-1.4.4-x86_64.AppImage --ozone-platform=x11` to isolate the compositor.

## Related documents

- [`LINUX_INSTALLATION.md`](LINUX_INSTALLATION.md) — installing the artifacts
- [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md) — the tagged release pipeline
- [`FLATPAK.md`](FLATPAK.md) — the Flathub-ready manifest
