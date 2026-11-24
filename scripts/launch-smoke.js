'use strict';

/* Paketlenmiş uygulamayı gerçekten başlatıp arayüzün çizildiğini doğrular.
   ------------------------------------------------------------------------
   Neden: `verify-package.js` ve dosya/imza kontrolleri "paket doğru" der,
   ama "uygulama açılıyor mu" demez. macOS DMG'si bu makinede derlenemediği
   için ilk gerçek açılış CI'da olur; bu script o boşluğu kapatır.

   Kullanım:
     node scripts/launch-smoke.js --exe="/yol/TailRef Studio[.exe]" \
       [--port=9931] [--app-port=5179] [--timeout=90000] [--keep-log]

   Yaptıkları:
     1. Geçici bir veri klasöründe, izole portta (TailRef_E2E=1) uygulamayı
        başlatır — kullanıcının gerçek TailRef verisine dokunmaz.
     2. Uygulamanın yerel sunucusunu ve DevTools hedefini bekler.
     3. CDP üzerinden `appReady === true`, pencerenin görünür ölçüsü ve
        sayfada çizilmiş bir tahta kabuğu olup olmadığını doğrular.
     4. Süreci (ve alt süreçlerini) kapatır; başarısızlıkta günlüğü basar.

   Çıkış kodu 0 = uygulama açıldı ve arayüz hazır; 1 = açılmadı/çökdü. */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const exe = argValue('exe', '');
const DEBUG_PORT = Number(argValue('port', '9931'));
const APP_PORT = Number(argValue('app-port', '5179'));
const TIMEOUT = Number(argValue('timeout', '90000'));
const KEEP_LOG = process.argv.includes('--keep-log');

if (!exe) {
  console.error('kullanım: node scripts/launch-smoke.js --exe=<uygulama ikilisi>');
  process.exit(2);
}
const exePath = path.resolve(exe);
if (!fs.existsSync(exePath)) {
  console.error(`FAIL uygulama ikilisi yok: ${exePath}`);
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-launch-smoke-'));
const userData = path.join(workDir, 'data');
const logFile = path.join(workDir, 'app.log');
fs.mkdirSync(userData, { recursive: true });
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

let app = null;
let ws = null;
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
  ok ? passed++ : failed++;
};

async function fetchTargets() {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* Uygulamanın ana sayfası: panel/DevTools hedeflerini ayıkla. */
function isAppPage(target) {
  return target.type === 'page' &&
    typeof target.url === 'string' &&
    target.url.startsWith('http://127.0.0.1:') &&
    !target.url.includes('/panel.html') &&
    !!target.webSocketDebuggerUrl;
}

const evaluate = (socket, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMessage = event => {
    const message = JSON.parse(event.data);
    if (message.id !== id) return;
    socket.removeEventListener('message', onMessage);
    if (message.error) return reject(new Error(JSON.stringify(message.error)));
    if (message.result.exceptionDetails) {
      return reject(new Error(message.result.exceptionDetails.exception?.description || 'eval hatası'));
    }
    resolve(message.result.result.value);
  };
  socket.addEventListener('message', onMessage);
  socket.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 15000);
});

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = () => reject(new Error('CDP bağlantısı kurulamadı'));
  });
}

function killApp() {
  if (!app || app.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  try { app.kill('SIGTERM'); } catch { /* süreç zaten gitmiş olabilir */ }
  setTimeout(() => { try { app.kill('SIGKILL'); } catch { /* sessiz */ } }, 3000).unref();
}

function tailLog(lines = 40) {
  try {
    const text = fs.readFileSync(logFile, 'utf8').trimEnd().split('\n');
    return text.slice(-lines).join('\n');
  } catch { return ''; }
}

(async () => {
  const env = {
    ...process.env,
    /* Paketlenmiş uygulamada da izole port/veri klasörü (E2E kapı kapağı). */
    TailRef_E2E: '1',
    TailRef_PORT: String(APP_PORT),
    TailRef_USER_DATA: userData,
    TailRef_NO_RECOVERY: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  app = spawn(exePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--disable-gpu',
    ...(process.platform === 'win32' ? ['--no-sandbox'] : []),
  ], { cwd: path.dirname(exePath), env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.pipe(logStream);
  app.stderr.pipe(logStream);

  let exited = null;
  app.on('exit', (code, signal) => { exited = { code, signal }; });

  /* 1. DevTools hedefi (uygulama ayakta ve sayfa yüklendi) */
  const targetDeadline = Date.now() + TIMEOUT;
  let target = null;
  while (Date.now() < targetDeadline) {
    if (exited) break;
    try {
      target = (await fetchTargets()).find(isAppPage) || null;
      if (target) break;
    } catch { /* sunucu henüz açılmamış olabilir */ }
    await sleep(500);
  }
  if (!target) {
    check('uygulama bir sayfa hedefi açtı', false,
      exited ? `süreç çıktı (code=${exited.code}, signal=${exited.signal})` : `${TIMEOUT} ms içinde hedef yok`);
    throw new Error('sayfa hedefi yok');
  }
  check('uygulama bir sayfa hedefi açtı', true, `${target.url} · ${Date.now() - (targetDeadline - TIMEOUT)} ms`);

  /* 2. Renderer hazır (arayüz gerçekten çizildi) */
  ws = await connect(target.webSocketDebuggerUrl);
  const readyDeadline = Date.now() + Math.min(TIMEOUT, 60000);
  let ready = false;
  while (Date.now() < readyDeadline) {
    try {
      ready = await evaluate(ws,
        "typeof appReady !== 'undefined' && appReady === true && typeof state !== 'undefined'");
      if (ready) break;
    } catch { /* renderer henüz yükleniyor */ }
    await sleep(500);
  }
  check('renderer appReady durumuna ulaştı', ready === true);
  if (!ready) throw new Error('renderer hazır olmadı');

  /* 3. Pencere ve tahta kabuğu gerçekten var */
  const size = JSON.parse(await evaluate(ws,
    'JSON.stringify({ w: innerWidth, h: innerHeight })'));
  check('pencere görünür ölçüde', size.w > 200 && size.h > 200, `${size.w}×${size.h}`);
  const stage = await evaluate(ws,
    "(() => { const el = document.querySelector('#stage'); return el ? el.childElementCount : -1; })()");
  check('tahta sahnesi DOM içinde ve dolu', Number(stage) > 0, `${stage} alt öğe`);
  const loaded = await evaluate(ws, "document.readyState === 'complete'");
  check('sayfa yüklemesi tamamlandı', loaded === true, String(loaded));

  check('süreç hâlâ ayakta', !exited, exited ? `code=${exited.code}` : 'çalışıyor');
})().catch((error) => {
  console.error('SMOKE HATASI: ' + error.message);
  const log = tailLog();
  if (log) {
    console.error('--- uygulama günlüğü (son satırlar) ---');
    console.error(log);
    console.error(`--- tam günlük: ${logFile} ---`);
  }
}).finally(async () => {
  try { if (ws) ws.close(); } catch { /* sessiz */ }
  killApp();
  logStream.end();
  await sleep(500);
  if (!KEEP_LOG && failed === 0) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* sessiz */ }
  }
  console.log(failed === 0
    ? `\nAÇILIŞ SMOKE GEÇTİ (${passed}/${passed})`
    : `\nAÇILIŞ SMOKE BAŞARISIZ (${passed}/${passed + failed})`);
  process.exit(failed === 0 ? 0 : 1);
});
