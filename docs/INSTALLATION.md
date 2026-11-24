# Installation

## For users (Windows)

TailRef ships as a portable executable and as a standard Windows installer.
Both are built from the same source.

> **Linux?** See [`LINUX_INSTALLATION.md`](LINUX_INSTALLATION.md) for AppImage,
> deb and rpm instructions, `.tail` file associations and data locations.
>
> **macOS?** See [`MACOS.md`](MACOS.md) for the disk images, the Gatekeeper
> first launch and data locations.

### Portable build (recommended)

1. Download `Windows-TailRef-<version>-Portable.exe` from the release page.
2. Move it to a folder you control (for example `C:\Tools\TailRef\`).
3. Run it. No installation, no admin rights.

Settings and projects are **not** stored next to the executable by default; they
live in `%APPDATA%\TailRef\`. Copying the `.exe` to another machine does not
copy your projects.

### Installer

Download `Windows-TailRef-<version>-Setup.exe`, run it and choose an install directory.
The installer can create desktop and Start Menu shortcuts. Uninstalling does
**not** delete your project data by default.

### Updating

The installed (NSIS) build updates itself from GitHub Releases:

- TailRef checks 25 seconds after startup and every 4 hours; you can also press
  **Check for updates** in Settings → About.
- Nothing is downloaded until you press **Download update**.
- Before restarting, TailRef saves your work. In manual save mode it asks
  whether to save, restart without saving, or cancel.
- You can turn automatic checks off in Settings → About.

The portable `Windows-TailRef-<version>-Portable.exe` cannot replace itself. When an update exists,
TailRef shows **Open download page**; download the new `.exe` and replace the
old file. Your projects and preferences are kept.

Stable builds ignore pre-releases. A release tagged `vX.Y.Z-beta.N` is published
as a GitHub prerelease and is never offered to a stable installation.

### SmartScreen

Builds are not code-signed yet. Windows SmartScreen may show "Windows protected
your PC" or "unknown publisher". This is expected for unsigned independent
builds; the signing status and policy are in
[`CODE_SIGNING.md`](CODE_SIGNING.md).

To verify a download:

1. Open the release page and copy the published SHA-256 for the file.
2. In PowerShell:

   ```powershell
   Get-FileHash .\Windows-TailRef-<version>-Portable.exe -Algorithm SHA256
   ```

3. Compare the two values. If they differ, do not run the file.

### Requirements

- Windows 10 or 11, 64-bit.
- A GPU/driver that supports the Chromium version bundled with Electron 45.
- No internet connection is required. Panels (Pinterest, ArtStation, YouTube
  Music) need internet only when you open them.

### Where your data lives

| Data | Location |
|---|---|
| Settings, projects, brushes | `%APPDATA%\TailRef\` |
| Automatic backups | `%APPDATA%\TailRef\Backups\` |
| Known-good backup copy | `%APPDATA%\TailRef\Backups\good\` |
| Manual project files | wherever you save `.tail` files |

To start completely fresh, close TailRef and rename or remove
`%APPDATA%\TailRef\`. Back up the folder first if you want to keep your work.

## For developers (from source)

### Prerequisites

- **Node.js 22 LTS** (required; CI uses 22 and the CDP tests use the global `WebSocket`).
- **npm** (ships with Node).
- Windows 10/11 or Linux x64 for packaging. Windows produces the NSIS installer
  and the portable executable; Linux produces the AppImage, deb and rpm. The
  Linux build must run on Linux (see [`LINUX_BUILD.md`](LINUX_BUILD.md)).
- Optional: **Visual Studio Build Tools** with the C++ workload (Windows) or
  `build-essential`/`make`/`python3` (Linux), only if you want to build the
  optional `native/inkcore` kernel. The app runs without it.

### Steps

```bash
# from a clone of this repository
cd tailref
npm install
npm start
```

`npm start` regenerates `src/renderer/app.js` and launches Electron.

### Build a portable executable

```bash
npm run build:portable
# → dist/Windows-TailRef-<version>-Portable.exe
```

### Build the installer

```bash
npm run build:setup
# → dist/Windows-TailRef-<version>-Setup.exe
```

### Verify a build

```bash
npm run build:dir      # unpacked build in dist/win-unpacked
npm run test:package   # compares app.asar against the working tree
```

Expected last line: `PAKET GÜNCEL`.

## Troubleshooting

**`listen EACCES 127.0.0.1:5194`** — another TailRef instance (or a test) is
already using the app's local port. Close the other instance. If you are
running the test suite at the same time, note that the gates use their own
ports.

**SmartScreen blocks the file** — see the checksum steps above. Do not disable
SmartScreen globally.

**The app opens but the canvas is blank** — update your GPU driver, then try
again. If it persists, open an issue with your Windows version and GPU model.

**Nothing is saved** — check that `%APPDATA%\TailRef\` is writable and that you
are not running from a read-only location with a locked-down profile.
