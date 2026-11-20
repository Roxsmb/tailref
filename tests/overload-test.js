'use strict';

/* Aşırı yük dedektörü testi — gerçek Electron penceresinde.

   Kapsam:
   • Renderer SAĞLIKLIYKEN ana süreç yanlış alarm vermemeli.
   • Renderer senkron bir işle donduğunda ana süreç bunu yoklamalarla
     fark etmeli ve yerel "son kayda dön" kutusunu açmalı.
   • Kullanıcı onaylamadığı sürece kurtarma işareti yazılmamalı
     (otomatik geri dönme yok).

   Kullanım: node scripts/overload-test.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9352;
/* Üretim varsayılanı 5194 ile ÇAKIŞMASIN: kullanıcı uygulamayı açıkken bu
   kapı koşunca iki taraf da "listen EACCES 127.0.0.1:5194" alıyordu
   (uygulama açılamıyor, kapı da yalancı kırmızıya düşüyordu). */
const APP_PORT = 5411;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function electronPath() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('electron bulunamadı (npm install)');
  return found;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result && msg.result.exceptionDetails) {
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    }
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
});

/** Yanıtı beklenmeyen değerlendirme (renderer'ı bilerek kilitlemek için). */
const fire = (ws, expression) => ws.send(JSON.stringify({
  id: Math.floor(Math.random() * 1e6),
  method: 'Runtime.evaluate',
  params: { expression, returnByValue: true, awaitPromise: false },
}));

async function waitForTarget(deadlineMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz hazır değil */ }
    await sleep(400);
  }
  throw new Error('uygulama hata ayıklama portu açılmadı');
}

async function waitReady(ws, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const ok = await evaluate(ws, '!!(window.__tailrefWorkspace && window.__tailrefWorkspace.ready)');
      if (ok) return true;
    } catch { /* bağlam yenileniyor olabilir */ }
    await sleep(350);
  }
  return false;
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-overload-'));
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  app.stdout.on('data', chunk => { log += chunk.toString('utf8'); });
  app.stderr.on('data', chunk => { log += chunk.toString('utf8'); });

  let ws = null;
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await connect(page.webSocketDebuggerUrl);
    if (!await waitReady(ws)) throw new Error('pano yöneticisi hazır olmadı');
    await sleep(1000);

    /* 1 · Sağlıklı renderer yanlış alarm üretmemeli (yoklama aralığı 3 sn). */
    await sleep(9000);
    check('sağlıklı arayüzde kurtarma kutusu açılmıyor',
      !log.includes('[kurtarma]'), 'yanlış alarm yok');

    /* 2 · Renderer'ı 35 sn boyunca senkron olarak kilitle. */
    const blockedAt = Date.now();
    fire(ws, `(() => { const end = Date.now() + 35000; while (Date.now() < end) { /* meşgul */ } return true; })()`);

    /* 3 · Ana süreç yoklamalarla donmayı fark edip kutuyu açmalı (~17 sn). */
    let detected = false;
    const deadline = Date.now() + 32000;
    while (Date.now() < deadline) {
      if (log.includes('[kurtarma] renderer yanıt vermiyor')) { detected = true; break; }
      await sleep(500);
    }
    check('donan renderer fark edildi ve yerel kurtarma kutusu açıldı', detected,
      `${Math.round((Date.now() - blockedAt) / 1000)} sn`);

    /* 4 · Kullanıcı onaylamadan otomatik geri dönülmemeli. */
    const marker = path.join(userDataDir, 'recovery.json');
    check('onay olmadan kurtarma işareti yazılmıyor', !fs.existsSync(marker));
  } finally {
    app.kill();
    if (ws) ws.close();
    await sleep(600);
    try { process.kill(app.pid); } catch { /* zaten kapandı */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli olabilir */ }
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(error => {
  console.error('TEST HATASI:', error && error.message ? error.message : error);
  process.exit(1);
});
