'use strict';

/* TailRef — Linux packaging and release pipeline checks (plain Node).
   Guards the pieces that must stay in place for the Linux release:
   • electron-builder Linux targets, artifact names and desktop integration,
   • the 512×512 PNG icon and the .tail MIME definition,
   • Linux branches in main.js and build-native.js,
   • the Flatpak manifest and its pinned sources,
   • the tag-driven release workflow and the release-notes generator.

   Nothing here builds a package; the workflow jobs do that on Linux. These
   checks catch configuration regressions on any platform, including Windows. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(ROOT, file));

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
};

const pkg = JSON.parse(read('package.json'));
const build = pkg.build || {};
const linux = build.linux || {};

/* --- electron-builder Linux configuration --- */
ok('package.json has a version', /^\d+\.\d+\.\d+/.test(pkg.version || ''), pkg.version);
ok('desktopName is set for Electron WM_CLASS', pkg.desktopName === 'tailref.desktop', pkg.desktopName);
ok('linux.executableName is tailref', linux.executableName === 'tailref', linux.executableName);
ok('linux icon is a PNG', linux.icon === 'build/icon.png', linux.icon);
ok('linux.syncDesktopName is enabled', linux.syncDesktopName === true);
ok('linux category is Graphics', linux.category === 'Graphics', linux.category);

const linuxTargets = Array.isArray(linux.target) ? linux.target : [];
const targetNames = linuxTargets.map((t) => (typeof t === 'string' ? t : t.target));
ok('AppImage target configured', targetNames.includes('AppImage'));
ok('deb target configured', targetNames.includes('deb'));
ok('rpm target configured', targetNames.includes('rpm'));
ok('all Linux targets are x64',
  linuxTargets.every((t) => !t.arch || (Array.isArray(t.arch) && t.arch.length === 1 && t.arch[0] === 'x64')));

ok('AppImage artifact name',
  build.appImage && build.appImage.artifactName === 'TailRef-${version}.${ext}',
  build.appImage && build.appImage.artifactName);
ok('deb artifact name',
  build.deb && build.deb.artifactName === 'tailref_${version}_${arch}.${ext}',
  build.deb && build.deb.artifactName);
ok('rpm artifact name',
  build.rpm && build.rpm.artifactName === 'tailref-${version}.${arch}.${ext}',
  build.rpm && build.rpm.artifactName);

const assoc = (build.fileAssociations || [])[0] || {};
ok('file association declares the MIME type',
  assoc.ext === 'tail' && assoc.mimeType === 'application/x-tailref-board', assoc.mimeType);
/* electron-builder concatenates linux.mimeTypes and fileAssociations[].mimeType
   without de-duplicating, so the MIME type must be declared in one place only.
   The generated entry is checked for real below. */
ok('MIME type is declared once, by the file association',
  !linux.mimeTypes && !(linux.desktop && linux.desktop.entry && linux.desktop.entry.MimeType),
  JSON.stringify({ mimeTypes: linux.mimeTypes, entry: linux.desktop && linux.desktop.entry.MimeType }));
ok('desktop entry has keywords',
  /drawing/.test(linux.desktop.entry.Keywords));

/* Build the desktop entry and the MIME XML with electron-builder's own code.
   A duplicate MimeType line, a wrong Exec/StartupWMClass or a missing MIME
   comment would only show up after installation on Linux, never in CI logs.
   The helper is async, so it runs in a child process to keep this file sync. */
function generatedLinuxIntegration() {
  const script = `
    const path = require('path');
    const fs = require('fs');
    const root = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const { LinuxTargetHelper } = require(path.join(root, 'node_modules',
      'app-builder-lib', 'out', 'targets', 'LinuxTargetHelper'));
    const linux = pkg.build.linux;
    const appInfo = {
      name: 'tailref',
      productName: 'TailRef Studio',
      sanitizedProductName: 'TailRef Studio',
      productFilename: 'TailRef Studio',
      version: pkg.version,
      buildVersion: pkg.version,
      sanitizedVersion: pkg.version,
      description: linux.description,
      linuxPackageName: 'tailref',
    };
    const packager = {
      appInfo,
      executableName: 'tailref',
      platformSpecificBuildOptions: linux,
      config: pkg.build,
      metadata: pkg,
      info: { metadata: pkg },
      fileAssociations: pkg.build.fileAssociations || [],
      getTempFile: (suffix) => path.join(require('os').tmpdir(),
        'tailref-test-' + process.pid + suffix),
    };
    const helper = new LinuxTargetHelper(packager);
    Promise.all([helper.computeDesktopEntry(linux, null, {}), helper.mimeTypeFiles])
      .then(([desktop, mimeFile]) => {
        const mime = mimeFile ? fs.readFileSync(mimeFile, 'utf8') : '';
        if (mimeFile) fs.unlinkSync(mimeFile);
        process.stdout.write(JSON.stringify({ desktop, mime }));
      })
      .catch((err) => { console.error(err.message); process.exit(1); });
  `;
  const out = require('child_process').execFileSync(process.execPath,
    ['-e', script, ROOT], { encoding: 'utf8' });
  return JSON.parse(out);
}

let integration = { desktop: '', mime: '' };
let integrationError = '';
const builderAvailable = exists('node_modules/app-builder-lib/out/targets/LinuxTargetHelper.js');
if (!builderAvailable) {
  console.log('SKIP electron-builder is not installed; generated entry/MIME checks skipped');
}
const okIfBuilder = (name, cond, detail) => {
  if (builderAvailable) ok(name, cond, detail);
};
if (builderAvailable) {
  try {
    integration = generatedLinuxIntegration();
  } catch (err) {
    integrationError = err.message;
  }
}
const desktopEntry = integration.desktop;
okIfBuilder('electron-builder generates the deb/rpm desktop entry',
  desktopEntry.includes('[Desktop Entry]'), integrationError || undefined);

const desktopLines = desktopEntry.split('\n');
const mimeLines = desktopLines.filter((line) => line.startsWith('MimeType='));
okIfBuilder('generated desktop entry declares the MIME type exactly once',
  mimeLines.length === 1 && mimeLines[0] === 'MimeType=application/x-tailref-board;',
  mimeLines.join(' | ') || 'no MimeType line');
okIfBuilder('generated desktop entry runs the installed executable',
  desktopLines.includes('Exec="/opt/TailRef Studio/tailref" %U'));
okIfBuilder('generated desktop entry matches the Electron WM_CLASS',
  desktopLines.includes('StartupWMClass=tailref'));
okIfBuilder('generated desktop entry uses the tailref icon',
  desktopLines.includes('Icon=tailref'));
okIfBuilder('generated desktop entry keeps the Graphics category',
  desktopLines.includes('Categories=Graphics;'));

const mimeXml = integration.mime;
okIfBuilder('electron-builder generates the .tail MIME definition',
  /<mime-type type="application\/x-tailref-board">/.test(mimeXml) &&
  /<glob pattern="\*\.tail"\/>/.test(mimeXml), mimeXml.replace(/\s+/g, ' ').trim() || undefined);
okIfBuilder('MIME definition carries a human-readable comment',
  /<comment>TailRef Studio document<\/comment>/.test(mimeXml));

ok('deb depends on shared-mime-info and desktop-file-utils',
  ['shared-mime-info', 'desktop-file-utils'].every((d) => (build.deb.depends || []).includes(d)));
ok('rpm depends on shared-mime-info and desktop-file-utils',
  ['shared-mime-info', 'desktop-file-utils'].every((d) => (build.rpm.depends || []).includes(d)));
ok('no dangling afterInstall/afterRemove scripts',
  !build.deb.afterInstall && !build.deb.afterRemove &&
  !build.rpm.afterInstall && !build.rpm.afterRemove);

/* --- Windows release surface is unchanged --- */
const winTargets = (build.win.target || []).map((t) => t.target);
ok('Windows NSIS target kept', winTargets.includes('nsis'));
ok('Windows portable target kept', winTargets.includes('portable'));
ok('Windows artifact names unchanged',
  build.nsis.artifactName === 'TailRef_Studio_Setup.exe' &&
  build.portable.artifactName === 'TailRef_Studio.exe');
ok('GitHub publisher unchanged',
  build.publish && build.publish[0].provider === 'github' &&
  build.publish[0].owner === 'Roxsmb' && build.publish[0].repo === 'tailref');

/* --- icon: real 512×512 RGBA PNG --- */
let iconOk = false;
let iconDetail = 'missing';
if (exists('build/icon.png')) {
  const png = fs.readFileSync(path.join(ROOT, 'build/icon.png'));
  const signature = png.slice(0, 8).toString('hex');
  const isPng = signature === '89504e470d0a1a0a';
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colorType = png[25];
  iconOk = isPng && width === 512 && height === 512 && (colorType === 6 || colorType === 4);
  iconDetail = `${width}×${height}, colorType ${colorType}`;
}
ok('build/icon.png is a 512×512 PNG with alpha', iconOk, iconDetail);
ok('Windows .ico is still present', exists('build/icon.ico'));
const winIcons = (build.win.extraResources || []).map((r) => r.to);
const linuxIcons = (linux.extraResources || []).map((r) => r.to);
ok('Windows package ships only the .ico', winIcons.includes('icon.ico') && !winIcons.includes('icon.png'));
ok('Linux package ships only the .png', linuxIcons.includes('icon.png') && !linuxIcons.includes('icon.ico'));

/* --- Linux branches in the application code --- */
const main = read('src/main/main.js');
ok('main.js selects a PNG icon on Linux', /process\.platform === 'linux'/.test(main) && /icon\.png/.test(main));
ok('main.js resolves file:// board arguments', /fileURLToPath/.test(main) && main.includes('/^file:'));
ok('main.js enables the Wayland ozone hint on Linux', /ozone-platform-hint/.test(main));
ok('main.js adopts the Flatpak desktop id inside the sandbox',
  /FLATPAK_ID/.test(main) && /setDesktopName/.test(main));
ok('main.js still consumes a .tail argument', /extractBoardPath/.test(main));

const updateManager = read('src/main/update-manager.js');
ok('updater is disabled off Windows', /platform !== 'win32'\) reason = 'platform'/.test(updateManager));
const updateUi = read('src/renderer/core/62b-updates.js');
ok('update UI explains the Linux update path',
  /Windows-only\. On Linux, update through your package manager or download the new AppImage\./.test(updateUi));

const native = read('scripts/build-native.js');
ok('build-native.js takes the architecture from --arch (default process.arch)',
  /--arch=\$\{arch\}/.test(native) && /return process\.arch;/.test(native));
ok('build-native.js has no hard-coded x64', !/--arch=x64/.test(native));
ok('build-native.js detects a POSIX toolchain', /hasPosixToolchain/.test(native) && /command -v/.test(native));
ok('build-native.js supports offline headers', /TAILREF_NODEDIR/.test(native));
ok('build-native.js prefers the project-local node-gyp',
  /const cands = \[\s*path\.join\(ROOT, 'node_modules', 'node-gyp'/.test(native));
ok('build-native.js knows the Visual Studio 2026 layout',
  native.includes('Microsoft Visual Studio\\\\18'));
const pkgJson = JSON.parse(read('package.json'));
ok('node-gyp is pinned in devDependencies', pkgJson.devDependencies['node-gyp'] === '12.4.0');
ok('the pinned node-gyp supports Visual Studio 2026',
  /^(1[2-9]|[2-9][0-9])\./.test(pkgJson.devDependencies['node-gyp']));

/* verify-package hedef platformun ikilisini bekler: Windows .node Linux
   paketine sızarsa kapı kırmızı olur. */
const verify = read('scripts/verify-package.js');
ok('verify-package.js checks the native module format',
  /expectedFormat/.test(verify) && /binaryFormat/.test(verify) &&
  /'elf'/.test(verify) && /'pe'/.test(verify));

/* --- MIME definition --- */
const mime = read('build/linux/tailref-mime.xml');
ok('MIME XML declares the board type', /<mime-type type="application\/x-tailref-board">/.test(mime));
ok('MIME XML maps *.tail', /<glob pattern="\*\.tail"\/>/.test(mime));

/* --- Flatpak preparation --- */
ok('Flatpak manifest exists', exists('flatpak/com.tailref.studio.yml'));
const manifest = read('flatpak/com.tailref.studio.yml');
ok('Flatpak app id is com.tailref.studio', /^app-id: com\.tailref\.studio$/m.test(manifest));
ok('Flatpak uses the Electron base app', /base: org\.electronjs\.Electron2\.BaseApp/.test(manifest));
ok('Flatpak manifest uses the pinned sources', /- generated-sources\.json/.test(manifest));
ok('Flatpak manifest pins a release tag', /^        tag: v\d+\.\d+\.\d+/m.test(manifest));
ok('Flatpak build is offline', /npm_config_offline: 'true'/.test(manifest) &&
  /ELECTRON_CACHE:/.test(manifest) && /TAILREF_NODEDIR:/.test(manifest));
ok('Flatpak installs the launcher and metadata',
  /flatpak\/tailref\.sh/.test(manifest) &&
  /com\.tailref\.studio\.desktop/.test(manifest) &&
  /com\.tailref\.studio\.metainfo\.xml/.test(manifest) &&
  /build\/linux\/tailref-mime\.xml/.test(manifest));
ok('Flatpak targets the current Freedesktop runtime',
  /^runtime-version: '26\.08'$/m.test(manifest) && /^base-version: '26\.08'$/m.test(manifest));
ok('Flatpak uses the node22 SDK extension',
  /- org\.freedesktop\.Sdk\.Extension\.node22/.test(manifest));
ok('Flatpak uses the file chooser portal instead of home access',
  /--env=GTK_USE_PORTAL=1/.test(manifest) && !/--filesystem=/.test(manifest));
ok('Flatpak installs the license', /share\/licenses\/\$FLATPAK_ID/.test(manifest));
ok('Flatpak extracts the pinned Electron headers', /--strip-components=1/.test(manifest));

const flathubJson = JSON.parse(read('flatpak/flathub.json'));
ok('Flathub build is limited to x86_64', flathubJson['only-arches'].join(',') === 'x86_64');
const sources = JSON.parse(read('flatpak/generated-sources.json'));
const electronZip = sources.find((s) => s['dest-filename'] === 'electron-v45.4.1-linux-x64.zip');
ok('pinned sources include the Electron x64 zip',
  !!electronZip && electronZip.url.includes('/electron/releases/download/v45.4.1/') &&
  /^[a-f0-9]{64}$/.test(electronZip.sha256 || ''));
ok('pinned sources include Electron headers',
  sources.some((s) => s.type === 'archive' && /headers\.tar\.gz$/.test(s.url || '')));
ok('pinned sources use POSIX paths only',
  sources.every((s) => !JSON.stringify(s).includes('\\\\')));

const flatpakDesktop = read('flatpak/com.tailref.studio.desktop');
ok('Flatpak desktop entry runs the launcher', /^Exec=tailref %U$/m.test(flatpakDesktop));
ok('Flatpak desktop entry uses the app-id icon', /^Icon=com\.tailref\.studio$/m.test(flatpakDesktop));
ok('Flatpak desktop entry declares the MIME type',
  /^MimeType=application\/x-tailref-board;$/m.test(flatpakDesktop));
ok('Flatpak desktop entry matches the sandbox window class',
  /^StartupWMClass=com\.tailref\.studio$/m.test(flatpakDesktop));
ok('Flatpak launcher uses zypak', /exec zypak-wrapper \/app\/tailref\/tailref/.test(read('flatpak/tailref.sh')));

const metainfo = read('flatpak/com.tailref.studio.metainfo.xml');
ok('AppStream id and launchable are set',
  /<id>com\.tailref\.studio<\/id>/.test(metainfo) &&
  /<launchable type="desktop-id">com\.tailref\.studio\.desktop<\/launchable>/.test(metainfo));
ok('AppStream licenses are declared',
  /<metadata_license>CC0-1\.0<\/metadata_license>/.test(metainfo) &&
  /<project_license>GPL-3\.0-or-later<\/project_license>/.test(metainfo));
ok('AppStream has screenshots and a release',
  /<screenshot type="default">/.test(metainfo) && /<release version="\d+\.\d+\.\d+"/.test(metainfo));

/* --- release pipeline --- */
const release = read('.github/workflows/release.yml');
for (const job of ['prepare', 'test', 'windows', 'linux', 'release']) {
  ok(`release workflow has the ${job} job`, new RegExp(`^  ${job}:`, 'm').test(release));
}
ok('release workflow builds all three Linux targets',
  /--linux AppImage deb rpm/.test(release));
ok('release workflow validates Linux package contents',
  /dpkg-deb -c/.test(release) && /rpm -qlp/.test(release) && /--appimage-extract/.test(release));
ok('release workflow smoke-launches the AppImage', /xvfb-run/.test(release));
ok('release workflow writes SHA256SUMS.txt', /sha256sum \\/.test(release) && /SHA256SUMS\.txt/.test(release));
ok('release workflow generates release notes', /release-notes\.js --version/.test(release));
ok('release workflow publishes only from the release job',
  /gh release create/.test(release) && /--verify-tag/.test(release));
ok('release workflow does not pipe dpkg-deb or rpm listings into grep -q',
  !/dpkg-deb -c "\$DEB" \| grep/.test(release) && !/rpm -qlp "\$RPM" \| grep/.test(release));
ok('release workflow runs on Node 22', /NODE_VERSION: "22"/.test(release));
ok('release workflow rejects latest-linux.yml instead of uploading it',
  /if \[ -e latest-linux\.yml \]; then/.test(release) &&
  !/dist\/latest-linux\.yml/.test(release));

const ci = read('.github/workflows/ci.yml');
ok('CI runs gates on Linux', /ubuntu-22\.04/.test(ci) && /windows-latest/.test(ci));
ok('CI builds and smoke-tests Linux packages',
  /--linux AppImage deb rpm/.test(ci) && /xvfb-run/.test(ci));
ok('release workflow installs gio for MIME resolution', /libglib2\.0-bin/.test(release));
ok('release workflow verifies the .tail association with gio',
  /gio info -a standard::content-type/.test(release));
ok('CI installs the deb and verifies the .tail association',
  /libglib2\.0-bin/.test(ci) && /gio info -a standard::content-type/.test(ci));

/* --- release notes generator --- */
const notes = read('scripts/release-notes.js');
for (const heading of ['## Windows', '## Linux', '## Requirements', '## Checksums',
  '## Known limitations', '## Upgrading', '## Troubleshooting', '## Changelog']) {
  ok(`release notes include "${heading}"`, notes.includes(heading));
}
ok('release notes name the Linux artifacts',
  /TailRef-\$\{version\}\.AppImage/.test(notes) &&
  /tailref_\$\{version\}_amd64\.deb/.test(notes) &&
  /tailref-\$\{version\}\.x86_64\.rpm/.test(notes));
ok('release notes state Linux auto-update is unavailable',
  /Automatic in-app updates are Windows-only/.test(notes));
ok('release notes read the English changelog only',
  notes.includes("'CHANGELOG.en.md'") && !notes.includes("'CHANGELOG.md'"));
ok('release notes reject a missing English section',
  /No English changelog section/.test(notes));
ok('release notes reject Turkish letters', /TURKISH_LETTERS/.test(notes));

/* Üretici, geçerli sürümün İngilizce CHANGELOG bölümünü bulmalı ve
   sonuçta tek bir Türkçe harf bile kalmamalı. */
const { execFileSync } = require('child_process');
const notesText = execFileSync(process.execPath,
  ['scripts/release-notes.js', '--version', pkg.version],
  { cwd: ROOT, encoding: 'utf8' });
ok('release notes embed the English changelog section for the current version',
  notesText.includes(`# TailRef Studio ${pkg.version}`) &&
  notesText.includes('## Changelog') &&
  !notesText.includes('No English changelog section'));
ok('release notes are English-only',
  !/[çğışöüÇĞİŞÖÜ]/.test(notesText), 'no Turkish letters');
ok('release notes use the current version in the Linux file names',
  notesText.includes(`TailRef-${pkg.version}.AppImage`) &&
  notesText.includes(`tailref_${pkg.version}_amd64.deb`));

let missingSectionFailed = false;
try {
  execFileSync(process.execPath,
    ['scripts/release-notes.js', '--version', '0.0.0'],
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
} catch {
  missingSectionFailed = true;
}
ok('release notes fail instead of publishing untranslated notes',
  missingSectionFailed);
ok('release workflow requires an English changelog section',
  /CHANGELOG\.en\.md has no English section/.test(release));

/* --- required documentation --- */
for (const doc of ['docs/LINUX_BUILD.md', 'docs/LINUX_INSTALLATION.md',
  'docs/RELEASE_PROCESS.md', 'docs/FLATPAK.md']) {
  ok(`documentation exists: ${doc}`, exists(doc));
}

console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
