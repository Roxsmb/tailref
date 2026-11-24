'use strict';

/* Tarayıcı sürümü kapısı — `node src/main/server.js` gerçekten çalışıyor mu?
   ------------------------------------------------------------------
   Neden: server.js `path.join` çağırıyordu ama `path` modülünü hiç
   require etmiyordu. Dosya ilk satırda `ReferenceError: path is not
   defined` ile çöküyordu, yani ARCHITECTURE.md'de belgelenen tarayıcı
   girişi tamamen ölüydü. Bu kapı:

     1. Sunucuyu gerçekten başlatır ve `/` üzerinden index.html servis
        edildiğini doğrular (200 + <title>).
     2. Statik sunucunun güvenlik sınırlarını HTTP üzerinden sınar:
        klasör dışına çıkma, gizli dosyalar, node_modules → 403.
     3. Olmayan dosya → 404.
     4. Süreç çökerse bunu yakalar (stderr ReferenceError vb.).

   Kullanım: node tests/browser-server-test.js */

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { resolvePath } = require('../src/main/static-server');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PORT = 5399;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass += 1; else fail += 1;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
};

function get(rawPath) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: rawPath, method: 'GET' }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', error => resolve({ status: 0, body: '', error: error.message }));
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForServer(deadlineMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    const res = await get('/');
    if (res.status === 200) return res;
    await sleep(250);
  }
  return null;
}

(async () => {
  /* --- resolvePath birim kontrolleri --- */
  ok('kök dosya çözülür', resolvePath(RENDERER, '/index.html') !== null);
  /* `path.normalize` kökün üstünü kırpar: `/../../x` → `<root>/x`. Yani
     dışarı çıkılamaz; sonuç ya null ya da kökün içinde olmalı. */
  const traversalTarget = resolvePath(RENDERER, '/../../package.json');
  ok('klasör dışına çıkma kök içinde tutulur',
    traversalTarget === null || traversalTarget.startsWith(RENDERER + path.sep),
    String(traversalTarget));
  ok('kodlanmış çıkış reddedilir', resolvePath(RENDERER, '/..%2f..%2fpackage.json') === null);
  ok('gizli dosya reddedilir', resolvePath(RENDERER, '/.gitignore') === null);
  ok('node_modules reddedilir', resolvePath(RENDERER, '/node_modules/electron/package.json') === null);
  ok('null baytlı yol reddedilir', resolvePath(RENDERER, '/index\u0000.html') === null);

  /* --- gerçek süreç --- */
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'main', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', () => { /* tüket */ });

  try {
    const home = await waitForServer();
    ok('sunucu başladı ve / 200 döndü', !!home,
      child.exitCode !== null ? `süreç exit ${child.exitCode}: ${stderr.trim().split('\n')[0] || ''}` : '');
    ok('index.html servis edildi', !!home && /<title>[^<]*TailRef/i.test(home.body),
      home ? `${home.body.length} bayt` : '');
    ok('süreç çökmedi (path is not defined yok)', !/is not defined/.test(stderr),
      stderr.trim().split('\n')[0] || '');

    const traversal = await get('/..%2f..%2fpackage.json');
    ok('HTTP klasör dışına çıkma gerçek dosyayı sızdırmaz',
      traversal.status !== 200 && !traversal.body.includes('electron-updater'),
      `status ${traversal.status}`);

    const dotfile = await get('/.gitignore');
    ok('HTTP gizli dosya 403', dotfile.status === 403, String(dotfile.status));

    const deps = await get('/node_modules/electron/package.json');
    ok('HTTP node_modules 403', deps.status === 403, String(deps.status));

    const missing = await get('/definitely-missing.png');
    ok('olmayan dosya 404', missing.status === 404, String(missing.status));
  } finally {
    try { child.kill(); } catch { /* zaten kapandı */ }
    await sleep(300);
  }

  console.log(fail === 0
    ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
    : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(error => {
  console.error('TEST HATASI:', error && error.stack || error);
  process.exit(1);
});
