'use strict';

/* TailRef — GitHub Release notes generator (plain Node, no dependencies).
   ------------------------------------------------------------------
   Produces one English release-note document per tagged release. CI feeds
   this file to `gh release create --notes-file`; locally:

     node scripts/release-notes.js                 # stdout
     node scripts/release-notes.js --out dist/RELEASE_NOTES.md
     node scripts/release-notes.js --version 1.4.3

   Release notes are ALWAYS English. The changelog section is taken verbatim
   from CHANGELOG.en.md, never from the Turkish CHANGELOG.md. A missing English
   section, or a Turkish character in the result, is a hard error so a release
   can never publish mixed-language notes. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readVersion(argv) {
  const i = argv.indexOf('--version');
  if (i > -1 && argv[i + 1]) return argv[i + 1].replace(/^v/, '');
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

/* Release notes are English-only by policy. These letters do not occur in
   English text and their presence means the Turkish changelog leaked in. */
const TURKISH_LETTERS = /[çğışöüÇĞİŞÖÜ]/;

function changelogSection(version) {
  const file = path.join(ROOT, 'CHANGELOG.en.md');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const heading = new RegExp(
    `^##\\s*\\[?${version.replace(/\./g, '\\.')}\\]?(?:\\s|$).*$`, 'm');
  const match = heading.exec(text);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function assertEnglish(notes) {
  const lines = notes.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = TURKISH_LETTERS.exec(lines[i]);
    if (match) {
      throw new Error(
        `Release notes must be English, but line ${i + 1} contains "${match[0]}": ${lines[i].trim()}`);
    }
  }
}

function buildNotes(version) {
  const changelog = changelogSection(version);
  const lines = [];
  lines.push(`# TailRef Studio ${version}`);
  lines.push('');
  lines.push('A free, open-source workspace for artists who work from references:');
  lines.push('collect references, draw over them and pose 3D models in one window.');
  lines.push('');
  lines.push('Every build below is version **' + version + '** and comes from the same source tree.');
  lines.push('');
  lines.push('The download list is grouped by platform: asset names start with **Windows-**, **Linux-** or **macOS-**.');
  lines.push('');
  lines.push('## Windows');
  lines.push('');
  lines.push('| File | What it is |');
  lines.push('|---|---|');
  lines.push(`| \`Windows-TailRef-${version}-Setup.exe\` | Installer. Recommended: it updates itself from GitHub Releases. |`);
  lines.push(`| \`Windows-TailRef-${version}-Portable.exe\` | Portable. No installation; run it from any folder. |`);
  lines.push('');
  lines.push('Windows 10 or 11, 64-bit.');
  lines.push('');
  lines.push('## Linux');
  lines.push('');
  lines.push('| File | Best for |');
  lines.push('|---|---|');
  lines.push(`| \`Linux-TailRef-${version}-x86_64.AppImage\` | Most distributions. One file, no installation. |`);
  lines.push(`| \`Linux-TailRef-${version}-amd64.deb\` | Ubuntu, Debian, Linux Mint and derivatives. |`);
  lines.push(`| \`Linux-TailRef-${version}-x86_64.rpm\` | Fedora, openSUSE and derivatives. |`);
  lines.push('');
  lines.push('x86_64 (amd64). The deb and rpm packages add the menu entry, the icon');
  lines.push('and the `.tail` file association. AppImage users can integrate it with');
  lines.push('AppImageLauncher or follow `docs/LINUX_INSTALLATION.md`.');
  lines.push('');
  lines.push('Flatpak: the manifest is in `flatpak/` for Flathub submission. TailRef is');
  lines.push('**not** published on Flathub yet; no Flatpak bundle is attached here.');
  lines.push('');
  lines.push('## macOS');
  lines.push('');
  lines.push('| File | Best for |');
  lines.push('|---|---|');
  lines.push(`| \`macOS-TailRef-${version}-arm64.dmg\` | Apple silicon (M1 and later). |`);
  lines.push(`| \`macOS-TailRef-${version}-x64.dmg\` | Intel Macs. |`);
  lines.push('');
  lines.push('Open the disk image, drag **TailRef Studio** into `Applications`, then launch');
  lines.push('it from there.');
  lines.push('');
  lines.push('The macOS builds are ad-hoc signed but **not notarized** (the project has no');
  lines.push('Apple Developer ID). Gatekeeper therefore blocks the first launch:');
  lines.push('right-click the app, choose **Open**, and confirm. If macOS still refuses,');
  lines.push('clear the quarantine flag once:');
  lines.push('');
  lines.push('```bash');
  lines.push('xattr -dr com.apple.quarantine "/Applications/TailRef Studio.app"');
  lines.push('```');
  lines.push('');
  lines.push('macOS builds do not update themselves; download the new disk image.');
  lines.push('');
  lines.push('## Installation');
  lines.push('');
  lines.push('**Windows** — run the installer, or the portable `.exe`. Uninstalling does');
  lines.push('not delete your projects.');
  lines.push('');
  lines.push('**Linux (AppImage)**');
  lines.push('');
  lines.push('```bash');
  lines.push(`chmod +x Linux-TailRef-${version}-x86_64.AppImage`);
  lines.push(`./Linux-TailRef-${version}-x86_64.AppImage`);
  lines.push('```');
  lines.push('');
  lines.push('If FUSE is unavailable: `./Linux-TailRef-' + version + '-x86_64.AppImage --appimage-extract-and-run`.');
  lines.push('');
  lines.push('**Linux (deb)**');
  lines.push('');
  lines.push('```bash');
  lines.push(`sudo apt install ./Linux-TailRef-${version}-amd64.deb`);
  lines.push('```');
  lines.push('');
  lines.push('**Linux (rpm)**');
  lines.push('');
  lines.push('```bash');
  lines.push(`sudo dnf install ./Linux-TailRef-${version}-x86_64.rpm      # Fedora`);
  lines.push(`sudo zypper install ./Linux-TailRef-${version}-x86_64.rpm   # openSUSE`);
  lines.push('```');
  lines.push('');
  lines.push('Full instructions: `docs/LINUX_INSTALLATION.md` and `docs/INSTALLATION.md`.');
  lines.push('');
  lines.push('**macOS** — open the `.dmg` for your architecture, drag the app into');
  lines.push('`Applications` and launch it. The first launch needs right-click → **Open**');
  lines.push('(see the macOS section above); full instructions: `docs/MACOS.md`.');
  lines.push('');
  lines.push('## Requirements');
  lines.push('');
  lines.push('- **Windows:** Windows 10 or 11, 64-bit.');
  lines.push('- **macOS:** macOS 12 (Monterey) or newer, Apple silicon or Intel.');
  lines.push('- **Linux:** x86_64, glibc 2.25 or newer (Ubuntu 20.04+, Debian 11+,');
  lines.push('  Fedora 32+; Ubuntu 22.04 and 24.04 tested), GTK 3 and a working');
  lines.push('  OpenGL driver. The optional native ink module needs glibc 2.35 and');
  lines.push('  is skipped on older systems; drawing then uses the JavaScript path.');
  lines.push('- No internet connection is required. The Pinterest, ArtStation and');
  lines.push('  YouTube Music panels need internet only while you use them.');
  lines.push('');
  lines.push('## Checksums');
  lines.push('');
  lines.push('`SHA256SUMS.txt` is attached to this release and covers every binary asset.');
  lines.push('');
  lines.push('```bash');
  lines.push('sha256sum -c SHA256SUMS.txt --ignore-missing   # Linux, files you downloaded');
  lines.push('shasum -a 256 macOS-TailRef-' + version + '-arm64.dmg    # macOS, Apple silicon');
  lines.push('Get-FileHash .\\Windows-TailRef-' + version + '-Portable.exe -Algorithm SHA256   # Windows PowerShell');
  lines.push('```');
  lines.push('');
  lines.push('Builds are **not code-signed**. Windows SmartScreen and some Linux package');
  lines.push('managers may warn about an unknown publisher. Verify the checksum first.');
  lines.push('');
  lines.push('## Known limitations');
  lines.push('');
  lines.push('- Automatic in-app updates are Windows-only (NSIS build). Linux builds');
  lines.push('  update through the package manager, AppImageLauncher or a fresh download;');
  lines.push('  macOS builds update by downloading the new disk image. The updater is');
  lines.push('  disabled off Windows instead of installing a Windows package.');
  lines.push('- Only x86_64/amd64 is built for Windows and Linux. macOS is built for');
  lines.push('  Apple silicon and Intel; other architectures are not published.');
  lines.push('- The macOS builds are ad-hoc signed and not notarized, so Gatekeeper');
  lines.push('  asks for a right-click → Open on first launch.');
  lines.push('- The deb and rpm packages are not signed with a distribution repository key.');
  lines.push('- Flatpak is prepared for Flathub but not yet submitted or accepted.');
  lines.push('');
  lines.push('## Upgrading');
  lines.push('');
  lines.push('- **Windows installer:** in-app update, or install the new release over the old one.');
  lines.push('- **Windows portable:** replace the `.exe`; projects and settings stay in `%APPDATA%\\TailRef`.');
  lines.push('- **Linux deb/rpm:** install the new package; settings stay in `~/.config/TailRef`.');
  lines.push('- **Linux AppImage:** replace the file. Projects and `.tail` files are unchanged.');
  lines.push('- **macOS:** open the new disk image and replace the app in `Applications`.');
  lines.push('  Projects and `.tail` files are unchanged.');
  lines.push('');
  lines.push('The `.tail` project format is unchanged across platforms and versions.');
  lines.push('');
  lines.push('## Troubleshooting');
  lines.push('');
  lines.push('- **Blank canvas or GPU crash on Linux:** try `LIBGL_ALWAYS_SOFTWARE=1` or');
  lines.push('  launch with `--disable-gpu`. Update Mesa/NVIDIA drivers first.');
  lines.push('- **Wayland window or input problems:** launch with `--ozone-platform=x11`.');
  lines.push('- **"Port 5178 is already in use":** close the other TailRef instance.');
  lines.push('- **AppImage will not start:** install `libfuse2`, or use');
  lines.push('  `--appimage-extract-and-run`.');
  lines.push('- **macOS: "TailRef Studio is damaged" or "unidentified developer":** the');
  lines.push('  build is not notarized. Right-click → **Open**, or clear the quarantine');
  lines.push('  flag with `xattr -dr com.apple.quarantine "/Applications/TailRef Studio.app"`.');
  lines.push('');
  lines.push('## Changelog');
  lines.push('');
  if (!changelog) {
    throw new Error(
      `No English changelog section for ${version} in CHANGELOG.en.md. ` +
      'Add one before releasing: release notes are always English.');
  }
  lines.push(changelog);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('TailRef is free software under **GPL-3.0-or-later**. Source, issues and');
  lines.push('documentation: <https://github.com/Roxsmb/tailref>.');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const version = readVersion(argv);
  const notes = buildNotes(version);
  assertEnglish(notes);
  const outIndex = argv.indexOf('--out');
  if (outIndex > -1 && argv[outIndex + 1]) {
    const target = path.resolve(argv[outIndex + 1]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, notes, 'utf8');
    console.log(`[release-notes] wrote ${path.relative(ROOT, target)} (${Buffer.byteLength(notes, 'utf8')} bytes)`);
  } else {
    process.stdout.write(notes);
  }
}

try {
  main();
} catch (error) {
  console.error('[release-notes] error:', error && error.message || error);
  process.exit(1);
}
