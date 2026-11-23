'use strict';

/* TailRef — GitHub Release notes üreticisi (saf Node, bağımlılık yok).
   ------------------------------------------------------------------
   Etiketli bir sürüm için tek biçimli, platforma göre ayrılmış sürüm notu
   üretir. CI bu dosyayı `gh release create --notes-file` ile kullanır;
   yerelde de aynı metni görebilirsiniz:

     node scripts/release-notes.js                 # stdout
     node scripts/release-notes.js --out dist/RELEASE_NOTES.md
     node scripts/release-notes.js --version 1.4.3

   Sürüm notu uydurmaz: "Changelog" bölümü CHANGELOG.md'deki ilgili
   sürüm başlığından aynen alınır. Başlık yoksa bunu açıkça söyler. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readVersion(argv) {
  const i = argv.indexOf('--version');
  if (i > -1 && argv[i + 1]) return argv[i + 1].replace(/^v/, '');
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function changelogSection(version) {
  const file = path.join(ROOT, 'CHANGELOG.md');
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
  lines.push('## Windows');
  lines.push('');
  lines.push('| File | What it is |');
  lines.push('|---|---|');
  lines.push('| `TailRef_Studio_Setup.exe` | Installer. Recommended: it updates itself from GitHub Releases. |');
  lines.push('| `TailRef_Studio.exe` | Portable. No installation; run it from any folder. |');
  lines.push('');
  lines.push('Windows 10 or 11, 64-bit.');
  lines.push('');
  lines.push('## Linux');
  lines.push('');
  lines.push('| File | Best for |');
  lines.push('|---|---|');
  lines.push(`| \`TailRef-${version}.AppImage\` | Most distributions. One file, no installation. |`);
  lines.push(`| \`tailref_${version}_amd64.deb\` | Ubuntu, Debian, Linux Mint and derivatives. |`);
  lines.push(`| \`tailref-${version}.x86_64.rpm\` | Fedora, openSUSE and derivatives. |`);
  lines.push('');
  lines.push('x86_64 (amd64). The deb and rpm packages add the menu entry, the icon');
  lines.push('and the `.tail` file association. AppImage users can integrate it with');
  lines.push('AppImageLauncher or follow `docs/LINUX_INSTALLATION.md`.');
  lines.push('');
  lines.push('Flatpak: the manifest is in `flatpak/` for Flathub submission. TailRef is');
  lines.push('**not** published on Flathub yet; no Flatpak bundle is attached here.');
  lines.push('');
  lines.push('## Installation');
  lines.push('');
  lines.push('**Windows** — run the installer, or the portable `.exe`. Uninstalling does');
  lines.push('not delete your projects.');
  lines.push('');
  lines.push('**Linux (AppImage)**');
  lines.push('');
  lines.push('```bash');
  lines.push(`chmod +x TailRef-${version}.AppImage`);
  lines.push(`./TailRef-${version}.AppImage`);
  lines.push('```');
  lines.push('');
  lines.push('If FUSE is unavailable: `./TailRef-' + version + '.AppImage --appimage-extract-and-run`.');
  lines.push('');
  lines.push('**Linux (deb)**');
  lines.push('');
  lines.push('```bash');
  lines.push(`sudo apt install ./tailref_${version}_amd64.deb`);
  lines.push('```');
  lines.push('');
  lines.push('**Linux (rpm)**');
  lines.push('');
  lines.push('```bash');
  lines.push(`sudo dnf install ./tailref-${version}.x86_64.rpm      # Fedora`);
  lines.push(`sudo zypper install ./tailref-${version}.x86_64.rpm   # openSUSE`);
  lines.push('```');
  lines.push('');
  lines.push('Full instructions: `docs/LINUX_INSTALLATION.md` and `docs/INSTALLATION.md`.');
  lines.push('');
  lines.push('## Requirements');
  lines.push('');
  lines.push('- **Windows:** Windows 10 or 11, 64-bit.');
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
  lines.push('Get-FileHash .\\TailRef_Studio.exe -Algorithm SHA256   # Windows PowerShell');
  lines.push('```');
  lines.push('');
  lines.push('Builds are **not code-signed**. Windows SmartScreen and some Linux package');
  lines.push('managers may warn about an unknown publisher. Verify the checksum first.');
  lines.push('');
  lines.push('## Known limitations');
  lines.push('');
  lines.push('- Automatic in-app updates are Windows-only (NSIS build). Linux builds');
  lines.push('  update through the package manager, AppImageLauncher or a fresh download;');
  lines.push('  the updater is disabled on Linux instead of installing a Windows package.');
  lines.push('- Only x86_64/amd64 is built. ARM64 is not published.');
  lines.push('- The deb and rpm packages are not signed with a distribution repository key.');
  lines.push('- Flatpak is prepared for Flathub but not yet submitted or accepted.');
  lines.push('');
  lines.push('## Upgrading');
  lines.push('');
  lines.push('- **Windows installer:** in-app update, or install the new release over the old one.');
  lines.push('- **Windows portable:** replace the `.exe`; projects and settings stay in `%APPDATA%\\TailRef`.');
  lines.push('- **Linux deb/rpm:** install the new package; settings stay in `~/.config/TailRef`.');
  lines.push('- **Linux AppImage:** replace the file. Projects and `.tail` files are unchanged.');
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
  lines.push('');
  lines.push('## Changelog');
  lines.push('');
  if (changelog) {
    lines.push(changelog);
  } else {
    lines.push(`No CHANGELOG.md section was found for ${version}.`);
  }
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
  const outIndex = argv.indexOf('--out');
  if (outIndex > -1 && argv[outIndex + 1]) {
    const target = path.resolve(argv[outIndex + 1]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, notes, 'utf8');
    console.log(`[release-notes] yazıldı: ${path.relative(ROOT, target)} (${Buffer.byteLength(notes, 'utf8')} bayt)`);
  } else {
    process.stdout.write(notes);
  }
}

try {
  main();
} catch (error) {
  console.error('[release-notes] hata:', error && error.message || error);
  process.exit(1);
}
