'use strict';

/* TailRef — macOS packaging and release pipeline checks (plain Node).
   Guards the pieces that must stay in place for the macOS release:
   • electron-builder macOS targets, entitlements and artifact names,
   • the .tail document type and the app.on('open-file') handler,
   • the arch switch in build-native.js (arm64 + Intel from one runner),
   • the macOS job in the tag-driven release workflow,
   • the macOS section of the release-notes generator.

   Nothing here builds a package; the workflow job does that on macOS. These
   checks catch configuration regressions on any platform, including Windows. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
const mac = build.mac || {};

/* --- electron-builder macOS configuration --- */
ok('macOS target is configured', !!build.mac);
ok('macOS icon is the shared PNG', mac.icon === 'build/icon.png', mac.icon);
ok('macOS category is graphics-design',
  mac.category === 'public.app-category.graphics-design', mac.category);
ok('macOS uses ad-hoc signing (no Developer ID required)',
  mac.identity === '-', JSON.stringify(mac.identity));
ok('macOS hardened runtime is enabled', mac.hardenedRuntime === true);
ok('macOS gatekeeper assessment is skipped for ad-hoc builds',
  mac.gatekeeperAssess === false);
ok('macOS entitlements are wired to both entries',
  mac.entitlements === 'build/entitlements.mac.plist' &&
  mac.entitlementsInherit === 'build/entitlements.mac.plist',
  `${mac.entitlements} / ${mac.entitlementsInherit}`);

const macTargets = Array.isArray(mac.target) ? mac.target : [];
const macTargetNames = macTargets.map((t) => (typeof t === 'string' ? t : t.target));
ok('dmg target configured', macTargetNames.includes('dmg'));
const macArches = macTargets.flatMap((t) => (Array.isArray(t.arch) ? t.arch : []));
ok('both Apple silicon and Intel are built',
  macArches.includes('arm64') && macArches.includes('x64'), macArches.join(','));
ok('no zip target (macOS has no in-app updater)',
  !macTargetNames.includes('zip'), macTargetNames.join(','));
ok('dmg artifact name carries the architecture',
  build.dmg && build.dmg.artifactName === 'TailRef-${version}-${arch}.${ext}',
  build.dmg && build.dmg.artifactName);

const macIcons = (mac.extraResources || []).map((r) => r.to);
ok('macOS package ships only the PNG icon',
  macIcons.includes('icon.png') && !macIcons.includes('icon.ico'), macIcons.join(','));

ok('macOS build scripts exist',
  typeof pkg.scripts['build:mac'] === 'string' &&
  /electron-builder --mac/.test(pkg.scripts['build:mac']));

/* --- entitlements --- */
let entitlements = '';
if (exists('build/entitlements.mac.plist')) {
  entitlements = read('build/entitlements.mac.plist');
}
for (const key of ['com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation']) {
  ok(`entitlements declare ${key}`, entitlements.includes(key));
}
ok('entitlements stay a valid plist skeleton',
  /<plist version="1\.0">/.test(entitlements) && /<\/plist>/.test(entitlements));

/* --- .tail association feeds CFBundleDocumentTypes --- */
const assoc = (build.fileAssociations || [])[0] || {};
ok('file association is macOS-ready (ext + role)',
  assoc.ext === 'tail' && assoc.role === 'Editor', `${assoc.ext} / ${assoc.role}`);

/* --- macOS branches in the application code --- */
const main = read('src/main/main.js');
ok('main.js handles the macOS open-file event',
  /process\.platform === 'darwin'/.test(main) && /app\.on\('open-file'/.test(main));
ok('open-file handler resolves a .tail path and prevents the default',
  /app\.on\('open-file'[\s\S]{0,400}?extractBoardPath\(\[filePath\]\)/.test(main) &&
  /event\.preventDefault\(\)/.test(main));
ok('open-file handler forwards the board to open windows',
  /tailref:open-board-file/.test(main));
ok('main.js uses the PNG icon off Windows', /process\.platform === 'win32' \? 'icon\.ico' : 'icon\.png'/.test(main));

/* --- build-native.js architecture switch --- */
const native = read('scripts/build-native.js');
ok('build-native.js exposes an --arch switch', /--arch=/.test(native) && /function targetArch/.test(native));
ok('build-native.js defaults to the running architecture', /return process\.arch;/.test(native));
ok('build-native.js passes the selected architecture to node-gyp',
  /--arch=\$\{arch\}/.test(native) && !/--arch=x64/.test(native));
ok('build-native.js accepts x86_64 and aarch64 aliases',
  /x86_64/.test(native) && /aarch64/.test(native));

/* --- release pipeline --- */
const release = read('.github/workflows/release.yml');
ok('release workflow has the macos job', /^  macos:/m.test(release));
/* macos-14 arm64 imajı GitHub tarafından kaldırıldı ("configuration
   'macos-14-arm64-us-default' is not supported"). Desteklenen arm64
   etiketleri: macos-15, macos-26, macos-latest. */
ok('macos job runs on a supported Apple silicon runner',
  /runs-on: macos-(15|26|latest)\b/.test(release) && !/runs-on: macos-14\b/.test(release));
ok('macos job builds the native module for both architectures',
  /build-native\.js --arch=arm64/.test(release) && /build-native\.js --arch=x64/.test(release));
ok('macos job packages both disk images',
  /electron-builder --mac dmg --arm64/.test(release) &&
  /electron-builder --mac dmg --x64/.test(release));
ok('macos job verifies both unpacked payloads',
  /verify-package\.js dist\/mac-arm64/.test(release) &&
  /verify-package\.js dist\/mac\b/.test(release));
/* macOS arşivi .app paketinin içindedir; verify-package.js bu düzeni
   çözmezse iş "app.asar bulunamadı" ile düşer (2026-11-24 koşusu). */
const verifyPackage = read('scripts/verify-package.js');
ok('verify-package.js resolves the macOS .app bundle layout',
  /Contents', 'Resources', 'app\.asar'/.test(verifyPackage) &&
  /endsWith\('\.app'\)/.test(verifyPackage));
ok('verify-package.js derives the platform from the dist output folder',
  /lastIndexOf\('dist'\)/.test(verifyPackage));
ok('macos job validates the Mach-O architecture', /lipo -archs/.test(release));
ok('macos job validates the .tail document type',
  /CFBundleDocumentTypes:0:CFBundleTypeExtensions:0/.test(release) &&
  /CFBundleDocumentTypes:0:CFBundleTypeRole/.test(release));
ok('macos job requires an ad-hoc signature', /Signature=adhoc/.test(release));
ok('macos job mounts the produced images', /hdiutil attach/.test(release));
ok('macos job rejects Windows binaries in the payload',
  /Windows binaries found in the macOS package/.test(release));
ok('macos job uploads its artifacts',
  /name: macos-release/.test(release) && /TailRef-\*-arm64\.dmg/.test(release));
ok('release job waits for the macos job',
  /needs: \[prepare, test, windows, linux, macos\]/.test(release));
ok('macos job drops the update feed', /rm -f dist\/latest-mac\.yml/.test(release));
ok('macos job rejects a zip payload', /A zip payload was produced/.test(release));
ok('macos job launches the packaged app from the dmg',
  /Launch the Apple silicon build \(smoke\)/.test(release) &&
  /scripts\/launch-smoke\.js/.test(release) &&
  /Contents\/MacOS\/TailRef Studio/.test(release));
const smoke = read('scripts/launch-smoke.js');
ok('launch-smoke.js isolates its data folder and port',
  /TailRef_E2E: '1'/.test(smoke) && /TailRef_USER_DATA/.test(smoke) && /TailRef_PORT/.test(smoke));
ok('launch-smoke.js waits for the renderer and checks the scene',
  /appReady === true/.test(smoke) && /#stage/.test(smoke));
ok('launch-smoke.js cleans up its process tree',
  /taskkill/.test(smoke) && /SIGTERM/.test(smoke));
ok('release job rejects latest-mac.yml',
  /if \[ -e latest-mac\.yml \]; then/.test(release));
ok('checksums cover both macOS images',
  /TailRef-\$\{VERSION\}-arm64\.dmg/.test(release) &&
  /TailRef-\$\{VERSION\}-x64\.dmg/.test(release));
ok('release publishes both macOS images',
  /"dist\/TailRef-\$\{VERSION\}-arm64\.dmg"/.test(release) &&
  /"dist\/TailRef-\$\{VERSION\}-x64\.dmg"/.test(release));
ok('release verification expects both macOS images',
  /"TailRef-\$\{VERSION\}-arm64\.dmg"/.test(release) &&
  /"TailRef-\$\{VERSION\}-x64\.dmg"/.test(release));

/* --- release notes generator --- */
const notes = read('scripts/release-notes.js');
ok('release notes include a macOS section', notes.includes("lines.push('## macOS')"));
ok('release notes name both macOS images',
  /TailRef-\$\{version\}-arm64\.dmg/.test(notes) && /TailRef-\$\{version\}-x64\.dmg/.test(notes));
ok('release notes explain the missing notarization', /not notarized/.test(notes));
ok('release notes give the quarantine command',
  /xattr -dr com\.apple\.quarantine/.test(notes));
ok('release notes state macOS has no in-app updater',
  /macOS builds do not update themselves/.test(notes));
ok('release notes require macOS 12 or newer', /macOS 12 \(Monterey\) or newer/.test(notes));

/* Üretici, geçerli sürüm için macOS bölümünü gerçekten yazmalı. */
let notesText = '';
let notesError = '';
try {
  notesText = execFileSync(process.execPath,
    ['scripts/release-notes.js', '--version', pkg.version],
    { cwd: ROOT, encoding: 'utf8' });
} catch (err) {
  notesError = String(err && err.message || err);
}
ok('release notes generate for the current version', notesText.length > 0, notesError || undefined);
ok('generated notes carry the macOS section',
  notesText.includes('## macOS') && notesText.includes('not notarized'));
ok('generated notes use the current version in the macOS file names',
  notesText.includes(`TailRef-${pkg.version}-arm64.dmg`) &&
  notesText.includes(`TailRef-${pkg.version}-x64.dmg`));

/* --- documentation --- */
ok('docs/MACOS.md exists', exists('docs/MACOS.md'));
const macDoc = exists('docs/MACOS.md') ? read('docs/MACOS.md') : '';
ok('docs/MACOS.md explains signing and notarization',
  /notariz/i.test(macDoc) && /Developer ID/.test(macDoc));
ok('docs/MACOS.md explains the Gatekeeper first launch',
  /Gatekeeper/.test(macDoc) && /xattr -dr com\.apple\.quarantine/.test(macDoc));
ok('docs/MACOS.md documents both architectures',
  /arm64/.test(macDoc) && /x64/.test(macDoc));
ok('README mentions the macOS build', /macOS/.test(read('README.md')));

/* --- güncelleme paneli macOS'u doğru anlatıyor --- */
const updatesUi = read('src/renderer/core/62b-updates.js');
ok('the update panel has a macOS-specific message',
  updatesUi.includes('On macOS, download the new disk image.') &&
  /macintosh|mac os x/i.test(updatesUi));
ok('every locale translates the macOS update message', (() => {
  const locales = fs.readdirSync(path.join(ROOT, 'locales'))
    .filter(name => name.endsWith('.json') && name !== 'en.json');
  return locales.length >= 9 && locales.every((name) => {
    const data = JSON.parse(read('locales/' + name));
    return typeof data['Automatic updates are Windows-only. On macOS, download the new disk image.'] === 'string';
  });
})());

console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
