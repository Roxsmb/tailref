'use strict';

/* Kapanışta kayıt testi.

   Senaryo: tahtaya bir metin ekle, kayıt debounce'u (400 ms) dolmadan
   pencereyi kapat, uygulamayı aynı veri klasörüyle yeniden aç ve metnin
   hâlâ orada olduğunu doğrula.

   Uygulama izole bir geçici klasörde ve ayrı portta çalışır; gerçek
   tahtaya dokunmaz. Kullanım: node scripts/save-on-close-test.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 5199;
const DEBUG_PORT = 9334;
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
    if (msg.result.exceptionDetails) {
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    }
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 8000);
});

async function waitForTarget(deadlineMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz hazır değil */ }
    await sleep(300);
  }
  throw new Error('uygulama hata ayıklama portu açılmadı');
}

function launch(userDataDir) {
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(electronPath(), ['.', `--remote-debugging-port=${DEBUG_PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });
}

async function openReady() {
  const page = await waitForTarget();
  const ws = await connect(page.webSocketDebuggerUrl);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const ready = await evaluate(ws,
        "typeof state !== 'undefined' && typeof appReady !== 'undefined' && appReady === true");
      if (ready) return ws;
    } catch { /* henüz değil */ }
    await sleep(300);
  }
  ws.close();
  throw new Error('renderer hazır olmadı');
}

function waitExit(app, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (app.exitCode !== null) return resolve(app.exitCode);
    const timer = setTimeout(() => reject(new Error('uygulama zamanında kapanmadı')), timeoutMs);
    app.once('exit', code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-close-'));
  const probeId = 'close-probe-' + Date.now();
  let app = null;
  let ws = null;
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    // 1) Aç, tahtaya işaretçi metin ekle, debounce dolmadan kapat.
    app = launch(userDataDir);
    ws = await openReady();
    await evaluate(ws, `(() => {
      state.items.push({
        id: ${JSON.stringify(probeId)},
        kind: 'text',
        text: 'kapanis-kayit-testi',
        x: 120, y: 90, w: 260, h: 42,
        z: nextZ(), fontSize: 34
      });
      syncAll();
      scheduleSave();
      return true;
    })()`);
    // Kayıt 400 ms sonra yapılacaktı; hemen kapatıyoruz.
    try { await evaluate(ws, 'window.tailref.close()'); } catch { /* pencere kapanırken bağlantı düşebilir */ }
    const code = await waitExit(app);
    check('pencere kapandı', code === 0, `çıkış kodu ${code}`);

    // 2) Aynı veri klasörüyle yeniden aç, işaretçi duruyor mu?
    app = launch(userDataDir);
    ws = await openReady();
    const found = await evaluate(ws, `(() => {
      const it = state.items.find(i => i.id === ${JSON.stringify(probeId)});
      return it ? it.text : '';
    })()`);
    check('debounce dolmadan kapanan değişiklik kaydedildi', found === 'kapanis-kayit-testi', found || '(bulunamadı)');
  } catch (e) {
    console.error('TEST HATASI:', e.message);
    fail++;
  } finally {
    if (ws) { try { ws.close(); } catch { /* sessiz */ } }
    if (app && app.exitCode === null) {
      app.kill();
      await sleep(500);
      try { process.kill(app.pid); } catch { /* zaten kapandı */ }
    }
    await sleep(500);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli olabilir */ }
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
