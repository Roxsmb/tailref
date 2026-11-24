'use strict';
/* ======================================================================
   TailRef kapısı — test sayısı dokümantasyonu (saf Node)
   ======================================================================
   README/ARCHITECTURE/ROADMAP'teki "N kapı" sayıları scripts/run-gates.js
   listeleriyle karşılaştırılır. Bir kapı eklenip belge güncellenmezse ya da
   belge gerçeği abartırsa bu kapı kırmızıya düşer (P2 tutarsızlık).

   Sayım yalnız GERÇEK dosya adlarını sayar: liste bloklarındaki yorumlar
   önce soyulur. (Türkçe yorumlardaki "Windows'ta" gibi kesme işaretleri
   naive sayımda sahte dosya adı üretiyordu — bu kapı o tuzağı da kapatır.)
   ====================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
  ok ? pass++ : fail++;
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

/** Bir `const NAME = [ ... ];` bloğunu yorumlardan arındırıp dosya adlarını
    döndürür. Blok bulunamazsa null. */
function gateFiles(source, name) {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!match) return null;
  const body = match[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const names = [];
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) names.push(m[1]);
  return names;
}

const gates = read('scripts/run-gates.js');
const pureList = gateFiles(gates, 'PURE');
const extraList = gateFiles(gates, 'FULL_EXTRA');
const pure = pureList ? pureList.length : -1;
const extra = extraList ? extraList.length : -1;
const total = pure + extra;
check('run-gates: PURE listesi okunur', pure > 0, String(pure));
check('run-gates: FULL_EXTRA listesi okunur', extra > 0, String(extra));

/* Her giriş gerçek bir test dosyası olmalı (yazım hatası sessizce kapı
   düşürmesin) ve tekrar etmemeli. */
/* run-gates.js önce scripts/ sonra tests/ altında arar (gatePath). */
function gateExists(name) {
  return fs.existsSync(path.join(ROOT, 'scripts', name)) ||
    fs.existsSync(path.join(ROOT, 'tests', name));
}

for (const [label, list] of [['PURE', pureList], ['FULL_EXTRA', extraList]]) {
  const missing = list.filter((name) => !gateExists(name));
  const dupes = list.filter((name, i) => list.indexOf(name) !== i);
  check(`${label}: tüm kapı dosyaları var`, missing.length === 0, missing.join(', '));
  check(`${label}: tekrarlanan giriş yok`, dupes.length === 0, dupes.join(', '));
}

const readme = read('README.md');
check(`README: ${pure} pure gates`, new RegExp(`fast chain:\\s*${pure} pure gates`).test(readme));
check(`README: ${total} gates`, new RegExp(`full chain:\\s*${total} gates`).test(readme));

const arch = read('docs/ARCHITECTURE.md');
check(`ARCHITECTURE: PURE ${pure}`, new RegExp(`\\*\\*PURE\\*\\* \\(${pure} gates\\)`).test(arch));
check(`ARCHITECTURE: toplam ${total}`, new RegExp(`\\*\\*FULL\\*\\* \\([^)]*${total} gates total\\)`).test(arch));

const roadmap = read('docs/ROADMAP.md');
check(`ROADMAP: ${total}-gate quality chain`, new RegExp(`${total}-gate quality chain`).test(roadmap));

/* Geliştirici rehberi de aynı sayıları göstermeli: yeni kapı eklenince
   burada kalan eski sayı kullanıcıyı yanıltır. */
const dev = read('docs/DEVELOPMENT.md');
check(`DEVELOPMENT: ${pure} pure gates`, new RegExp(`fast chain:\\s*${pure} pure gates`).test(dev));
check(`DEVELOPMENT: ${total} gates`, new RegExp(`full chain:\\s*${total} gates`).test(dev));

console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
