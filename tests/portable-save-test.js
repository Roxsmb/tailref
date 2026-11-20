/* TailRef · paketlenmiş uygulamada kayıt/açma duman testi.
   ------------------------------------------------------------------
   `dist/win-unpacked/TailRef Studio.exe` (electron-builder çıktısı) izole
   bir userData klasörüyle başlatılır (TailRef_E2E=1 kaçış kapağı) ve gerçek
   IPC yolları sınanır:

     1) Otomatik mod: tahtaya öğe ekle → saveNow → uygulamayı kapat →
        yeniden aç → içerik geri geldi mi?
     2) Ctrl+S görünür geri bildirim veriyor mu? (projectNotice)
     3) save-emergency atomik JSON yazıyor mu? (dosya Node'dan okunur)
     4) auto-backup sayılarıyla yedek yazıyor mu? list-backups sağlıklı mı?
     5) Node'da üretilen .tail open-tail-path ile açılıyor mu?
     6) Bozuk .tail çökmeden reddediliyor mu?

   Kullanım: node tests/portable-save-test.js
   (önce `npm run build:portable` veya `build:dir` çalıştırılmış olmalı)
   ================================================================== */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'win-unpacked', 'TailRef Studio.exe');
const APP_PORT = 5299;
const DEBUG_PORT = 9401;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
  ok ? pass++ : fail++;
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
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 30000);
});

async function waitForTarget(deadlineMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz hazır değil */ }
    await sleep(300);
  }
  throw new Error('paketlenmiş uygulama hata ayıklama portu açılmadı');
}

async function launch(userDataDir) {
  const app = spawn(EXE,
    [`--remote-debugging-port=${DEBUG_PORT}`, '--no-sandbox', '--disable-gpu'],
    {
      cwd: path.dirname(EXE),
      env: {
        ...process.env,
        TailRef_E2E: '1',
        TailRef_USER_DATA: userDataDir,
        TailRef_PORT: String(APP_PORT),
        TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
      },
      stdio: 'ignore',
    });
  const page = await waitForTarget();
  const ws = await connect(page.webSocketDebuggerUrl);
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const ready = await evaluate(ws,
        `(typeof appReady !== 'undefined' && appReady === true) && document.readyState === 'complete'`);
      if (ready) return { app, ws };
    } catch { /* henüz değil */ }
    await sleep(300);
  }
  throw new Error('paketlenmiş uygulama hazır olmadı (appReady)');
}

async function shutdown(app, ws) {
  try {
    await evaluate(ws, `(async () => {
      try { if (typeof flushSave === 'function') await flushSave(); } catch {}
      try { window.close(); } catch {}
      return true;
    })()`);
  } catch { /* pencere kapanmış olabilir */ }
  try { ws.close(); } catch { /* sessiz */ }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) return true;
    await sleep(250);
  }
  try { app.kill(); } catch { /* sessiz */ }
  return false;
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error('Paket bulunamadı: ' + EXE + '\nÖnce `npm run build:portable` çalıştırın.');
    process.exit(1);
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-portable-'));
  let app = null;
  let ws = null;
  try {
    ({ app, ws } = await launch(userDataDir));
    check('paket: uygulama açıldı', true);

    /* Otomatik moda geç ve bilinen bir öğe ekle. */
    const seeded = await evaluate(ws, `(async () => {
      setPersistenceMode('auto');
      const item = {
        id: 'e2e-portable-text', kind: 'text', text: 'PORTABLE-E2E',
        x: 40, y: 40, w: 240, h: 80, rot: 0, z: nextZ(),
      };
      state.items.push(item);
      syncAll();
      if (typeof scheduleSave === 'function') scheduleSave();
      await saveNow();
      const rec = await idbGet('meta', 'workspace');
      return { mode: getPersistenceMode(), count: state.items.length, indexed: !!rec };
    })()`);
    check('paket: otomatik mod etkin', seeded.mode === 'auto');
    check('paket: tahta IndexedDB\'ye yazıldı', seeded.indexed === true);

    /* Ctrl+S görünür geri bildirim. */
    const ctrlS = await evaluate(ws, `(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      await new Promise(r => setTimeout(r, 900));
      const el = document.getElementById('projectNotice');
      return { text: el ? el.textContent : '', visible: !!(el && el.classList.contains('is-visible')) };
    })()`);
    check('paket: Ctrl+S bildirimi görünür', ctrlS.visible === true, ctrlS.text);

    /* Acil kopya (atomik yazım) — dosyayı Node tarafında doğrula. */
    const emergency = await evaluate(ws, `(async () => {
      const res = await window.tailref.saveEmergency(JSON.stringify({
        version: 2, kind: 'e2e', state: createStateSnapshot(),
      }));
      return res;
    })()`);
    const emergencyDir = path.join(userDataDir, 'Backups');
    const emergencyFiles = fs.existsSync(emergencyDir)
      ? fs.readdirSync(emergencyDir).filter(n => /^emergency-.*\.json$/.test(n))
      : [];
    let emergencyValid = false;
    if (emergencyFiles.length) {
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(emergencyDir, emergencyFiles[0]), 'utf8'));
        emergencyValid = doc && doc.kind === 'e2e';
      } catch { emergencyValid = false; }
    }
    check('paket: acil kopya yazıldı', emergency && emergency.ok === true && emergencyFiles.length > 0);
    check('paket: acil kopya geçerli JSON', emergencyValid === true);

    /* Otomatik yedek — sağlık bilgisi sayılarla gelir. */
    const backup = await evaluate(ws, `(async () => {
      const payload = await buildBoardPayload();
      const res = await window.tailref.autoBackup(
        JSON.stringify(payload), undefined,
        { items: boardItemCount(payload), images: payload.images.length });
      const list = await window.tailref.listBackups();
      const auto = list.filter(entry => /^tailref-/.test(entry.name));
      return { ok: !!(res && res.ok), count: auto.length, healthy: auto.some(e => e.healthy) };
    })()`);
    check('paket: otomatik yedek yazıldı', backup.ok === true && backup.count > 0,
      `adet=${backup.count}`);
    check('paket: yedek sağlıklı işaretlendi', backup.healthy === true);

    /* Node'da üretilen .tail paketli uygulamada açılıyor. */
    const tailPath = path.join(userDataDir, 'portable-roundtrip.tail');
    const tailPayload = {
      version: 2, createdAt: new Date().toISOString(), imagesComplete: true,
      state: { items: [{ id: 'e2e-tail-text', kind: 'text', text: 'TAIL-E2E' }] },
      workspace: null, images: [],
    };
    fs.writeFileSync(tailPath, Buffer.concat([
      Buffer.from('TAIL', 'ascii'), Buffer.from([1]),
      zlib.deflateSync(Buffer.from(JSON.stringify(tailPayload), 'utf8')),
    ]));
    const opened = await evaluate(ws, `(async () => {
      const res = await window.tailref.openBoardFileAtPath(${JSON.stringify(tailPath)});
      const payload = (res && res.payload) || {};
      const items = (payload.state && payload.state.items) || [];
      return {
        ok: !!(res && res.ok),
        marker: Array.isArray(items) && items.some(it => it.id === 'e2e-tail-text'),
      };
    })()`);
    check('paket: .tail dosyası açıldı', opened.ok === true);
    check('paket: .tail içeriği doğru', opened.marker === true);

    const corruptPath = path.join(userDataDir, 'portable-corrupt.tail');
    fs.writeFileSync(corruptPath, Buffer.concat([
      Buffer.from('TAIL', 'ascii'), Buffer.from([1]), Buffer.from('bozuk'),
    ]));
    const corrupt = await evaluate(ws, `(async () => {
      const res = await window.tailref.openBoardFileAtPath(${JSON.stringify(corruptPath)});
      return { ok: !!(res && res.ok), error: !!((res || {}).error) };
    })()`);
    check('paket: bozuk .tail reddedildi', corrupt.ok === false && corrupt.error === true);

    /* Kapat → yeniden aç: otomatik kayıt geri gelmeli. */
    await evaluate(ws, `(async () => { await saveNow(); return true; })()`);
    const cleanExit = await shutdown(app, ws);
    check('paket: uygulama temiz kapandı', cleanExit === true);
    app = null; ws = null;

    ({ app, ws } = await launch(userDataDir));
    const restored = await evaluate(ws, `(async () => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (state.items.some(it => it.id === 'e2e-portable-text')) break;
        await new Promise(r => setTimeout(r, 250));
      }
      return {
        mode: getPersistenceMode(),
        restored: state.items.some(it => it.id === 'e2e-portable-text'),
        count: state.items.length,
      };
    })()`);
    check('paket: yeniden açılışta otomatik mod', restored.mode === 'auto');
    check('paket: yeniden açılışta tahta geri geldi', restored.restored === true,
      `öğe=${restored.count}`);
  } catch (e) {
    console.error('TEST HATASI:', e.message);
    fail++;
  } finally {
    if (ws) { try { ws.close(); } catch { /* sessiz */ } }
    if (app) {
      if (app.exitCode === null) { try { app.kill(); } catch { /* sessiz */ } }
      await sleep(700);
    }
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli olabilir */ }
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
