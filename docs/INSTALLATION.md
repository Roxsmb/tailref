# Installation

## For users (Windows)

TailRef ships as a portable executable and as a standard Windows installer.
Both are built from the same source.

### Portable build (recommended)

1. Download `TailRef_Studio.exe` from the release page.
2. Move it to a folder you control (for example `C:\Tools\TailRef\`).
3. Run it. No installation, no admin rights.

Settings and projects are **not** stored next to the executable by default; they
live in `%APPDATA%\TailRef\`. Copying the `.exe` to another machine does not
copy your projects.

### Installer

Download `TailRef_Studio_Setup.exe`, run it and choose an install directory.
The installer can create desktop and Start Menu shortcuts. Uninstalling does
**not** delete your project data by default.

### SmartScreen

Builds are not code-signed. Windows SmartScreen may show "Windows protected your
PC" or "unknown publisher". This is expected for unsigned independent builds.

To verify a download:

1. Open the release page and copy the published SHA-256 for the file.
2. In PowerShell:

   ```powershell
   Get-FileHash .\TailRef_Studio.exe -Algorithm SHA256
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

- **Node.js 20 LTS** (18+ should work; CI uses 20).
- **npm** (ships with Node).
- Windows for packaging. The app itself can be developed on other platforms,
  but the release targets and packaging scripts are Windows-only.
- Optional: **Visual Studio Build Tools** with the C++ workload, only if you
  want to build the optional `native/inkcore` kernel. The app runs without it.

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
# → dist/TailRef_Studio.exe
```

### Build the installer

```bash
npm run build:setup
# → dist/TailRef_Studio_Setup.exe
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
