'use strict';
/* Paketlenmiş uygulamadaki app.asar'ı yerel kaynaklarla karşılaştırır
   (Windows, Linux ve macOS paketleri). Uygulamayı başlatmadan, derlemenin
   güncel kodu içerdiğini doğrular.
   Kullanım: node scripts/verify-package.js [app.asar | *-unpacked dizini] */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
/* Build çıktısı: package.json `build.directories.output` = dist
   Platforma göre paketlenmemiş dizin: Windows, Linux veya macOS.
   İsteğe bağlı ilk argüman: app.asar ya da *-unpacked / mac* dizini.

   Windows ve Linux arşivi `<dizin>/resources/app.asar` altındadır. macOS'ta
   electron-builder bir uygulama paketi üretir:
   `<dizin>/TailRef Studio.app/Contents/Resources/app.asar`. Bu farkı
   gözetmezsek yalnızca macOS'ta "app.asar bulunamadı" hatası çıkar. */
const UNPACKED_DIRS = ['win-unpacked', 'linux-unpacked', 'mac', 'mac-arm64'];
function archiveIn(dir) {
  const direct = path.join(dir, 'resources', 'app.asar');
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return direct;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.app')) continue;
    const bundled = path.join(dir, entry.name, 'Contents', 'Resources', 'app.asar');
    if (fs.existsSync(bundled)) return bundled;
  }
  return direct;
}
function candidateArchives() {
  const explicit = process.argv[2];
  if (explicit) {
    const resolved = path.resolve(explicit);
    const isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
    return [isDir ? archiveIn(resolved) : resolved];
  }
  return UNPACKED_DIRS
    .map(dir => archiveIn(path.join(ROOT, 'dist', dir)))
    .filter(f => fs.existsSync(f));
}
const archiveCandidates = candidateArchives();
if (!archiveCandidates.length) {
  throw new Error('app.asar bulunamadi (dist/win-unpacked, dist/linux-unpacked, '
    + 'dist/mac/ *.app/Contents/Resources veya dist/mac-arm64)');
}
const ARCHIVE = archiveCandidates[0];
console.log('paket: ' + path.relative(ROOT, ARCHIVE));
// package.json electron-builder tarafından sadeleştirilir; ayrı doğrulanır.
const FILES = [
  'src/renderer/app.js',
  'src/renderer/canvas/draw-v5.js',
  'src/renderer/draw-v5.css',
  'src/renderer/index.html',
  'src/renderer/style.css',
  'src/main/main.js',
  'src/main/update-manager.js',
  'src/main/update-policy.js',
  'src/renderer/workers/ink-worker.js',
  'src/preload/preload.js',
];

/* Ana süreç modülleri yerel `require('./x')` ile birbirine bağlıdır. Yalnız
   main.js doğrulansaydı, pakete girmeyen bir yardımcı modül (ör.
   atomic-write.js veya backup-health.js) denetimden geçip çalışma anında
   "Cannot find module" ile uygulamayı açılışta çökertirdi. Bu yüzden
   bağımlılık grafiği kapatılır: her yerel require hedefi de arşivde
   bayt-bayt aynı olmak zorunda. */
function localRequires(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const out = [];
  for (const match of source.matchAll(/require\('(\.[^']*)'\)/g)) {
    let resolved = path.normalize(path.join(path.dirname(file), match[1]));
    if (!resolved.endsWith('.js')) resolved += '.js';
    out.push(resolved.split(path.sep).join('/'));
  }
  return out;
}

const packedFiles = [];
const seen = new Set();
const queue = [...FILES];
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  packedFiles.push(file);
  for (const dep of localRequires(file)) {
    if (!seen.has(dep) && fs.existsSync(path.join(ROOT, dep))) queue.push(dep);
  }
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const read = file => fs.readFileSync(path.join(ROOT, file));
/* @electron/asar Windows'ta ters eğik çizgili yollar ister */
const archivePath = f => f.split('/').join(path.sep);

/* Paket dizininden hedef platformun ikili biçimini çıkar. macOS'ta arşiv
   `dist/mac-arm64/*.app/Contents/Resources` içinde olduğu için iki üst
   dizine bakmak yanıltıcıdır; platformu `dist/` altındaki çıktı dizininden
   okuruz. */
function expectedFormat(archive) {
  const parts = path.resolve(archive).split(path.sep);
  const distIndex = parts.lastIndexOf('dist');
  const dirName = distIndex >= 0 ? String(parts[distIndex + 1] || '').toLowerCase() : '';
  if (dirName.startsWith('win')) return 'pe';
  if (dirName.startsWith('linux')) return 'elf';
  if (dirName.startsWith('mac')) return 'macho';
  return null;
}

/* İlk baytlardan ikili biçim: PE (MZ), ELF, Mach-O. */
function binaryFormat(head) {
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return 'pe';
  if (head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 &&
      head[2] === 0x4c && head[3] === 0x46) return 'elf';
  const magic = head.length >= 4 ? head.readUInt32BE(0) : 0;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) {
    return 'macho';
  }
  return null;
}

(async () => {
  if (!fs.existsSync(ARCHIVE)) throw new Error('app.asar bulunamadı: ' + ARCHIVE);
  const pkg = JSON.parse(asar.extractFile(ARCHIVE, 'package.json').toString('utf8'));
  const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  console.log(`paket sürümü: ${pkg.version}`);

  let fail = 0;
  if (pkg.version !== local.version || pkg.main !== local.main) {
    console.log(`FAIL package.json · sürüm ${pkg.version} / beklenen ${local.version}`);
    fail += 1;
  } else {
    console.log(`OK   package.json · sürüm ${pkg.version} · main ${pkg.main}`);
  }
  for (const file of packedFiles) {
    let packed;
    try {
      packed = asar.extractFile(ARCHIVE, archivePath(file));
    } catch {
      console.log(`FAIL ${file} arşivde yok`);
      fail += 1;
      continue;
    }
    const same = sha(packed) === sha(read(file));
    console.log(`${same ? 'OK  ' : 'FAIL'} ${file} · ${(packed.length / 1024).toFixed(1)} KB`);
    if (!same) fail += 1;
  }

  /* Yerel modül hedef platformun ikilisi mi?
     Windows'ta üretilmiş bir inkcore.node Linux paketine girerse uygulama
     sessizce JS yoluna düşer; bu kontrol onu paket hatası sayar.
     Modül yoksa sorun değil: JS yedeği zaten desteklenen yol.
     `app.asar.unpacked` her platformda arşivin yanındaki Resources
     dizinindedir (macOS'ta `*.app/Contents/Resources`). */
  const resourcesDir = path.dirname(ARCHIVE);
  const nativePath = path.join(resourcesDir, 'app.asar.unpacked',
    'native', 'inkcore', 'build', 'Release', 'inkcore.node');
  const expected = expectedFormat(ARCHIVE);
  if (!fs.existsSync(nativePath)) {
    console.log('OK   native/inkcore · yok (JS yedeği kullanılır)');
  } else if (!expected) {
    console.log('OK   native/inkcore · platform tanınmadı, biçim denetlenmedi');
  } else {
    const actual = binaryFormat(fs.readFileSync(nativePath).subarray(0, 8));
    const same = actual === expected;
    console.log(`${same ? 'OK  ' : 'FAIL'} native/inkcore · ${actual || 'bilinmeyen'}`
      + ` (beklenen ${expected})`);
    if (!same) fail += 1;
  }

  console.log(fail === 0 ? '\nPAKET GÜNCEL' : `\n${fail} DOSYA EŞLEŞMİYOR`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('DOĞRULAMA HATASI:', err.message); process.exit(1); });
