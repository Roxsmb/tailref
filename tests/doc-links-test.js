'use strict';

/* Belgeler kapısı — markdown içindeki yerel bağlantılar gerçekten var mı?

   Neden: README ekran görüntülerine, lisans dosyalarına ve mimari belgelere
   bağlantı veriyor. Bir dosya taşındığında veya silindiğinde bağlantı sessizce
   kırılıyordu (ör. docs/screenshots/*.png hiç yokken README'de duruyordu).
   Bu kapı yalnızca depo içi yolları denetler; dış URL'lere ağ erişimi yapmaz.

   Kullanım: node tests/doc-links-test.js */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.tmp-ref']);

function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
}

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const files = [];
collect(ROOT, files);

let bad = 0;
let checked = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = LINK.exec(text))) {
    let target = match[1];
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    target = target.split('#')[0];
    if (!target) continue;
    checked++;
    let abs;
    try {
      abs = path.resolve(path.dirname(file), decodeURI(target));
    } catch {
      abs = path.resolve(path.dirname(file), target);
    }
    if (!fs.existsSync(abs)) {
      console.log(`FAIL ${path.relative(ROOT, file)} → ${match[1]}`);
      bad++;
    }
  }
}

if (bad) {
  console.log(`\n${bad} kırık yerel bağlantı (${checked} bağlantı denetlendi)`);
  process.exit(1);
}
console.log(`OK   ${checked} yerel bağlantı · ${files.length} markdown dosyası`);
console.log('\nTÜM TESTLER GEÇTİ (1/1)');
