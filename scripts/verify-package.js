'use strict';
/* Paketlenmiş .exe içindeki app.asar'ı yerel kaynaklarla karşılaştırır.
   Uygulamayı başlatmadan, derlemenin güncel kodu içerdiğini doğrular.
   Kullanım: node scripts/verify-package.js */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
// Build dizin çıktısı: package.json `build.directories.output` = dist
const archiveCandidates = ['dist']
  .map(dir => path.join(ROOT, dir, 'win-unpacked', 'resources', 'app.asar'))
  .filter(f => fs.existsSync(f));
if (!archiveCandidates.length) {
  throw new Error('app.asar bulunamadi (dist)');
}
const ARCHIVE = archiveCandidates[0];
// package.json electron-builder tarafından sadeleştirilir; ayrı doğrulanır.
const FILES = [
  'src/renderer/app.js',
  'src/renderer/canvas/draw-v5.js',
  'src/renderer/draw-v5.css',
  'src/renderer/index.html',
  'src/renderer/style.css',
  'src/main/main.js',
  'src/renderer/workers/ink-worker.js',
  'src/preload/preload.js',
];

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const read = file => fs.readFileSync(path.join(ROOT, file));
/* @electron/asar Windows'ta ters eğik çizgili yollar ister */
const archivePath = f => f.split('/').join(path.sep);

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
  for (const file of FILES) {
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

  console.log(fail === 0 ? '\nPAKET GÜNCEL' : `\n${fail} DOSYA EŞLEŞMİYOR`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('DOĞRULAMA HATASI:', err.message); process.exit(1); });
