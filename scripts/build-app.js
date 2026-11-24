'use strict';

/* app.js üreticisi.

   Kaynak dosyalar: src/renderer/core/*.js (isim sırasına göre birleştirilir).
   Çıktı: src/renderer/app.js — index.html ve paketlenmiş uygulama bunu yükler.

   Kullanım:
     node scripts/build-app.js
     node scripts/build-app.js --check   (yazmadan yalnızca doğrula)

   Not: app.js'i elle düzenlemeyin; değişiklikleri src/renderer/core/ altında yapın. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'renderer', 'core');
const OUT = path.join(ROOT, 'src', 'renderer', 'app.js');
const CHECK_ONLY = process.argv.includes('--check');

const BANNER = `/* =========================================================
   TailRef Studio — app bundle (OTOMATİK ÜRETİLDİ)
   Kaynak: src/renderer/core/*.js
   Düzenlemek için kaynak dosyaları değiştirip şunu çalıştırın:
     node scripts/build-app.js
   ========================================================= */
`;

function listSources() {
  if (!fs.existsSync(SRC)) throw new Error(`Kaynak klasörü yok: ${SRC}`);
  const files = fs.readdirSync(SRC)
    .filter(name => /^\d\d[a-z]?-.*\.js$/.test(name))
    .sort();
  if (!files.length) throw new Error(`Kaynak dosya bulunamadı: ${SRC}`);
  return files;
}

function build() {
  const files = listSources();
  const chunks = files.map(name => {
    const file = path.join(SRC, name);
    const code = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '\n');
    if (!code.trim()) throw new Error(`Boş kaynak dosya: ${name}`);
    return code;
  });

  const output = `${BANNER}\n${chunks.join('\n')}`;
  if (CHECK_ONLY) {
    /* Yalnızca kaynakların sözdizimini değil, üretilmiş app.js'in gerçekten
       bu kaynaklardan üretilmiş olduğunu da doğrula. Önceden --check hiçbir
       şeyi karşılaştırmıyordu: bir kaynak değişip yeniden üretim unutulsa
       bile kapı yeşil kalıyor, paket eski kodla çıkıyordu. */
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current.replace(/\r\n/g, '\n') !== output) {
      throw new Error(!current
        ? 'app.js yok — node scripts/build-app.js ile üretin.'
        : 'app.js kaynaklarla güncel değil — node scripts/build-app.js ile yeniden üretin.');
    }
    console.log(`OK   app.js ${files.length} kaynakla güncel (${(output.length / 1024).toFixed(1)} KB).`);
    return;
  }

  const previous = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  fs.writeFileSync(OUT, output, 'utf8');

  // Sözdizimi hatasını erken yakala.
  try {
    execFileSync(process.execPath, ['--check', OUT], { stdio: 'pipe' });
  } catch (e) {
    // Hatalı çıktıyı bırakma: önceki sürümü geri koy.
    if (previous) fs.writeFileSync(OUT, previous, 'utf8');
    else fs.rmSync(OUT, { force: true });
    const detail = (e.stderr || e.stdout || '').toString().trim();
    throw new Error(`app.js sözdizimi hatası:\n${detail}`);
  }

  const kb = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1);
  const lines = output.split('\n').length - 1;
  console.log(`OK   app.js üretildi · ${files.length} kaynak · ${lines} satır · ${kb} KB`);
  console.log(`     ${files.join(', ')}`);
}

try {
  build();
} catch (e) {
  console.error('HATA:', e.message);
  process.exit(1);
}
