'use strict';

/* Yerelleştirme kapısı — `locales/*.json` ile üretilen sözlük dosyası.
   ------------------------------------------------------------------
   Neden: `scripts/build-locales.js --check` bir zamanlar hiçbir şeyi
   karşılaştırmıyordu; kaynak JSON değişip yeniden üretim unutulsa bile
   "OK" yazıyordu. Bu kapı üç şeyi gerçekten denetler:

     1. `01c-locale-data.js` kaynaklardan üretilebilen içerikle aynı mı?
     2. Hiçbir dilde anahtar kaybı / fazlalığı (orphan) var mı?
     3. Çevrilmemiş metin sayısı kayıtlı üst sınırı aşıyor mu?
        (ratchet: yeni metin 8 dile çevrilmeden eklenirse kapı kırmızı)

   Ayrıca yer tutucu ({n}, {name}) tutarlılığını ve boş değerleri denetler;
   bunlar sessizce bozulan ama gözle fark edilmeyen gerçek hatalardır.

   Kullanım: node tests/locale-data-test.js */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');
const GENERATED = path.join(ROOT, 'src', 'renderer', 'core', '01c-locale-data.js');
const SOURCE = 'tr';

/* Kaynak dil dışındaki her dil için kabul edilen çevrilmemiş metin sayısı.
   Bugünkü durum: 0 — 24 Kasım 2026'da 275 eksik metin (tema stüdyosu, arayüz
   paketleri, güncelleme paneli, katman uyarıları, board/katman/geçmiş/fırça
   kütüphanesi metinleri) sekiz dile de çevrildi. Sınır sıfırda kilitli:
   yeni metin çevrilmeden eklenirse kapı kırmızı olur.
   Bu bilinçli bir "ratchet": eksik çeviri sessizce büyüyemez. */
const MAX_UNTRANSLATED = 0;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass += 1; else fail += 1;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
};

/* --- 1. Üretilen dosya güncel mi? --- */
const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-locales.js'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8',
});
ok('build-locales --check güncel dosyayı doğrular',
  check.status === 0,
  (check.stdout + check.stderr).trim().split('\n').pop());

ok('üretilen sözlük dosyası var', fs.existsSync(GENERATED));
const generated = fs.existsSync(GENERATED) ? fs.readFileSync(GENERATED, 'utf8') : '';
ok('üretilen dosya TailRefLocales tanımlar', /window\.TailRefLocales\s*=\s*\{/.test(generated));

/* --- 2. Kaynak sözlükleri oku --- */
const locales = {};
for (const file of fs.readdirSync(LOCALES_DIR).filter(name => name.endsWith('.json')).sort()) {
  const code = file.slice(0, -5);
  try {
    locales[code] = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
  } catch (error) {
    ok(`${file} geçerli JSON`, false, error.message);
  }
}
const codes = Object.keys(locales);
ok('en az 10 dil yüklendi', codes.length >= 10, `${codes.length} dil: ${codes.join(', ')}`);
ok('kaynak dil (tr) var', !!locales[SOURCE]);

const sourceKeys = new Set(Object.keys(locales[SOURCE] || {}));
ok('kaynak dil boş değil', sourceKeys.size > 1000, `${sourceKeys.size} anahtar`);

/* --- 3. Hiçbir dilde kaynakta olmayan anahtar (orphan) olmasın --- */
let orphans = 0;
for (const code of codes) {
  if (code === SOURCE) continue;
  for (const key of Object.keys(locales[code])) {
    if (!sourceKeys.has(key)) {
      orphans += 1;
      if (orphans <= 5) console.log(`     orphan ${code}: ${JSON.stringify(key).slice(0, 90)}`);
    }
  }
}
ok('kaynakta olmayan anahtar yok', orphans === 0, `${orphans} orphan`);

/* --- 4. Boş değer ve yer tutucu tutarlılığı --- */
let empty = 0;
let placeholders = 0;
for (const code of codes) {
  for (const [key, value] of Object.entries(locales[code])) {
    if (typeof value !== 'string') {
      ok(`${code}: tüm değerler metin`, false, JSON.stringify(key).slice(0, 80));
      continue;
    }
    if (value.trim() === '') {
      empty += 1;
      if (empty <= 5) console.log(`     boş ${code}: ${JSON.stringify(key).slice(0, 90)}`);
    }
    const want = [...key.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
    const got = [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
    if (want !== got) {
      placeholders += 1;
      if (placeholders <= 5) {
        console.log(`     yer tutucu ${code}: ${JSON.stringify(key).slice(0, 80)} [{${want}}] → [{${got}}]`);
      }
    }
  }
}
ok('boş çeviri değeri yok', empty === 0, `${empty} boş`);
ok('yer tutucular kaynakla aynı', placeholders === 0, `${placeholders} uyuşmazlık`);

/* --- 5. Çevrilmemiş metin ratchet'i --- */
const untranslated = [];
for (const code of codes) {
  if (code === SOURCE || code === 'en') continue;
  const missing = [...sourceKeys].filter(key => !(key in locales[code]));
  untranslated.push([code, missing.length]);
  ok(`${code}: çevrilmemiş metin ≤ ${MAX_UNTRANSLATED}`, missing.length <= MAX_UNTRANSLATED,
    `${missing.length} eksik`);
}
const counts = untranslated.map(([, count]) => count);
ok('diller arasında çeviri kapsamı eşit',
  counts.length > 0 && counts.every(count => count === counts[0]),
  untranslated.map(([code, count]) => `${code}=${count}`).join(' '));

/* --- 6. Üretilen dosya tüm anahtarları taşıyor mu? --- */
const expectedTotal = codes.reduce((sum, code) => sum + Object.keys(locales[code]).length, 0);
const blockCounts = [...generated.matchAll(/\/\* ([\w-]+) — (\d+) anahtar \*\//g)]
  .map(match => [match[1], Number(match[2])]);
const generatedTotal = blockCounts.reduce((sum, [, count]) => sum + count, 0);
ok('üretilen dosya anahtar sayısı kaynaklarla aynı', generatedTotal === expectedTotal,
  `${generatedTotal} / ${expectedTotal}`);
ok('üretilen dosyada her dil bloğu var', blockCounts.length === codes.length,
  `${blockCounts.length} / ${codes.length}`);

/* --- 7. L10N kapsamı: çıplak tPlural çağrısı yasak ---
   01b-l10n.js çekirdeği bir IIFE içinde; tPlural yalnız window.L10N ve
   window.__tp üzerinden erişilebilir. Başka bir dosyada çıplak tPlural(...)
   çağrısı çalışma anında ReferenceError üretir (canlı regresyon: 23 Kasım
   2026 compositor testi). Bu kapı aynı hatanın tekrar girmesini engeller. */
const RENDERER = path.join(ROOT, 'src', 'renderer');
function walkJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(full));
    else if (entry.name.endsWith('.js') && entry.name !== 'app.js') out.push(full);
  }
  return out;
}
const rendererFiles = walkJs(RENDERER);
const l10nPath = path.join(RENDERER, 'core', '01b-l10n.js');
const bareCalls = [];
for (const file of rendererFiles) {
  if (file === l10nPath) continue; // çekirdeğin kendi tanımı
  const text = fs.readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    if (/(?<![\w.$])tPlural\s*\(/.test(line)) {
      bareCalls.push(`${path.relative(ROOT, file)}:${index + 1}`);
    }
  });
}
ok('çıplak tPlural çağrısı yok (IIFE kapsamı)', bareCalls.length === 0,
  bareCalls.slice(0, 5).join(', '));
const l10nSource = fs.readFileSync(l10nPath, 'utf8');
ok('window.__tp çoğul köprüsü tanımlı', /window\.__tp\s*=/.test(l10nSource));
ok('window.__t tekil köprüsü tanımlı', /window\.__t\s*=/.test(l10nSource));

console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
