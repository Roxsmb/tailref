'use strict';
/* ======================================================================
   TailRef kapısı — build-app güncellik doğrulaması
   ======================================================================
   `src/renderer/app.js` üretilmiş bir dosyadır; kaynaklar değişip yeniden
   üretim unutulursa paket eski kodla çıkar. Bu kapı gerçek üreticiyi
   --check modunda koşar ve app.js'in birebir güncel olduğunu doğrular.
   ====================================================================== */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'renderer', 'app.js');
const CORE = path.join(ROOT, 'src', 'renderer', 'core');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
  ok ? pass++ : fail++;
}

const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-app.js'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
check('build-app --check başarılı', result.status === 0, output.split('\n')[0] || '');
check('build-app --check app.js güncel der', /app\.js .*güncel/.test(output));

const exists = fs.existsSync(OUT);
check('üretilen app.js var', exists);
if (exists) {
  const data = fs.readFileSync(OUT, 'utf8');
  check('app.js otomatik üretim banneri taşır', data.startsWith('/* ====') && /OTOMATİK ÜRETİLDİ/.test(data.slice(0, 400)));
  const sources = fs.readdirSync(CORE).filter(name => /^\d\d[a-z]?-.*\.js$/.test(name));
  /* Kaynaklardan en az birinin benzersiz bir işareti çıktıda olmalı: bayat
     paket sessizce geçmesin. (Tam eşitlik zaten --check ile doğrulanıyor.) */
  const probe = sources.includes('01b-l10n.js') ? 'function tPlural(' : null;
  check('kaynak sayısı makul', sources.length >= 60, String(sources.length));
  check('app.js kaynak içeriğini taşır', !probe || data.includes(probe));
}

console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
