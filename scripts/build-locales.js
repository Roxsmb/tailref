'use strict';

/* locales/*.json → src/renderer/core/01c-locale-data.js üreticisi.
 *
 * Sözlük kuralı: anahtar = İngilizce metin (identity), değer = o dilin
 * karşılığı. en.json yalnız çoğul çiftlerini (…_one/…_other) taşır;
 * düz anahtarlar EN'de identity düştüğü için yazılmaz.
 *
 * Kullanım:
 *   node scripts/build-locales.js          (üret)
 *   node scripts/build-locales.js --check  (yazmadan doğrula)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCALES = path.join(ROOT, 'locales');
const OUT = path.join(ROOT, 'src', 'renderer', 'core', '01c-locale-data.js');
const CHECK_ONLY = process.argv.includes('--check');

const BANNER = `/* =========================================================
   01c-locale-data.js — yerelleştirme sözlükleri (OTOMATİK ÜRETİLDİ)
   Kaynak: locales/*.json → node scripts/build-locales.js
   Elle düzenlemeyin; locales/*.json'u değiştirip yeniden üretin.
   ========================================================= */
window.TailRefLocales = {
`;

function main() {
  if (!fs.existsSync(LOCALES)) {
    console.error('locales/ klasörü yok — hiçbir şey üretilmedi.');
    process.exit(CHECK_ONLY ? 0 : 1);
  }
  const files = fs.readdirSync(LOCALES).filter(f => f.endsWith('.json')).sort();
  const blocks = [];
  let keyTotal = 0;
  for (const f of files) {
    const code = f.slice(0, -5);
    const raw = fs.readFileSync(path.join(LOCALES, f), 'utf8');
    let dict;
    try {
      dict = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${f} çözülemedi: ${e.message}`);
    }
    const entries = Object.entries(dict)
      .filter(([, v]) => typeof v === 'string')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    keyTotal += entries.length;
    const lines = entries.map(([k, v]) =>
      `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    blocks.push(`  /* ${code} — ${entries.length} anahtar */\n  ${JSON.stringify(code)}: {\n${lines.join('\n')}\n  },`);
  }
  const out = BANNER +
    blocks.join('\n') +
    `\n};\n`;

  if (CHECK_ONLY) {
    console.log(`OK   locales doğrulandı · ${files.length} dil · ${keyTotal} anahtar (yazma yok)`);
    return;
  }
  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`OK   01c-locale-data.js üretildi · ${files.length} dil · ${keyTotal} anahtar · ${(out.length / 1024).toFixed(1)} KB`);
}

try {
  main();
} catch (e) {
  console.error('HATA:', e.message);
  process.exit(1);
}
