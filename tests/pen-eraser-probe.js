'use strict';
/* =========================================================
   pen-eraser-probe.js — Wacom kalem arkası silgi (buttons bit 32 /
   button 5) geçici araç değişimi fonksiyonel testi. Kapı değil,
   tanısal probe. Kullanım: node tests/pen-eraser-probe.js
   ========================================================= */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9363;
const APP_PORT = 5233;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const electronPath = () => path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) {
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatasi'));
    }
    const v = msg.result.result.value;
    resolve(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

async function waitForTarget(deadlineMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henuz degil */ }
    await sleep(400);
  }
  throw new Error('debug portu acilmadi');
}
function connect(page) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}
async function hazirla(ws) {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  const dk = Date.now() + 60000;
  let ready = false;
  while (Date.now() < dk) {
    ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth");
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('renderer hazir olmad');
  let kapandi = false;
  for (let i = 0; i < 60 && !kapandi; i += 1) {
    kapandi = await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (!w || w.hidden) return true;
      if (!document.querySelector('.pwOption.is-selected')) {
        const opt = document.querySelector('.pwOption[data-mode="auto"]');
        if (opt) opt.click();
      }
      const btn = document.getElementById('pwContinue');
      if (btn && !btn.disabled) btn.click();
      return !!w.hidden;
    })()`);
    if (!kapandi) await sleep(500);
  }
}

const TEST = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const waitDraw = async () => {
    if (typeof inkPaintIdle === 'function') await inkPaintIdle();
  };
  const sonuc = {};
  /* Not: inkEnsureState state.ink'i değiştirebilir → her okuma taze
     inkState() üzerinden yapılır; yakalanan referans bayatıyor. */
  const I = () => inkState();
  /* Çizim moduna geç + editör aç */
  document.getElementById('modeDrawBtn').click();
  await wait(300);
  if (typeof inkSetTool === 'function') inkSetTool('brush');
  await wait(100);
  document.getElementById('newCanvasW').value = '1200';
  document.getElementById('newCanvasH').value = '800';
  document.getElementById('newCanvasName').value = 'PEN-ERASER-TEST';
  document.getElementById('newCanvasForm').requestSubmit();
  for (let i = 0; i < 200 && !inkEditorIsOpen(); i += 1) await wait(100);
  sonuc.editorAcik = inkEditorIsOpen();
  if (!sonuc.editorAcik) return sonuc;
  await wait(400);
  sonuc.baslangicAraci = I().tool;
  sonuc.ayarFirca = { size: I().size, hardness: I().hardness, spacing: I().spacing };

  const cv = document.getElementById('inkEditorCanvas');
  const rc = cv.getBoundingClientRect();
  const cx = Math.round(rc.left + rc.width / 2);
  const cy = Math.round(rc.top + rc.height / 2);
  const ui = inkEditorUi;
  /* 1) Kalem arkası (buttons 32, button 5) pointerdown */
  cv.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 7, isPrimary: true, pointerType: 'pen', button: 5, buttons: 32,
    clientX: cx, clientY: cy, pressure: 0.7, tiltX: 0, tiltY: 0,
    bubbles: true, cancelable: true,
  }));
  sonuc.vurusAraci = ui.stroke ? ui.stroke.tool : null;
  sonuc.geciciArac = I().tool;
  sonuc.ayarSilgi = { size: I().size, hardness: I().hardness, spacing: I().spacing };
  /* kısa sürükleme */
  cv.dispatchEvent(new PointerEvent('pointermove', {
    pointerId: 7, pointerType: 'pen', button: -1, buttons: 32,
    clientX: cx + 60, clientY: cy + 30, pressure: 0.6, bubbles: true, cancelable: true,
  }));
  await wait(50);
  cv.dispatchEvent(new PointerEvent('pointermove', {
    pointerId: 7, pointerType: 'pen', button: -1, buttons: 32,
    clientX: cx + 130, clientY: cy + 60, pressure: 0.5, bubbles: true, cancelable: true,
  }));
  await wait(50);
  /* 2) pointerup — normal uç */
  cv.dispatchEvent(new PointerEvent('pointerup', {
    pointerId: 7, pointerType: 'pen', button: 0, buttons: 0,
    clientX: cx + 130, clientY: cy + 60, pressure: 0.5, bubbles: true, cancelable: true,
  }));
  await wait(150);
  sonuc.birakmaAraci = I().tool;
  sonuc.geriAyar = { size: I().size, hardness: I().hardness, spacing: I().spacing };
  await waitDraw();
  /* 3) normal kalem ucu hâlâ fırça mı */
  cv.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 8, isPrimary: true, pointerType: 'pen', button: 0, buttons: 1,
    clientX: cx - 200, clientY: cy, pressure: 0.8, bubbles: true, cancelable: true,
  }));
  sonuc.ikinciVurusAraci = ui.stroke ? ui.stroke.tool : null;
  cv.dispatchEvent(new PointerEvent('pointerup', {
    pointerId: 8, pointerType: 'pen', button: 0, buttons: 0,
    clientX: cx - 180, clientY: cy, pressure: 0.8, bubbles: true, cancelable: true,
  }));
  await wait(150);
  await waitDraw();
  sonuc.ikinciBirakmaAraci = I().tool;
  return sonuc;
})()`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-pep2-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);
    const r = JSON.parse(await evaluate(ws, TEST, 60000));
    console.log('SONUC: ' + JSON.stringify(r, null, 1));
    /* kabaca yargı */
    const ok = r.baslangicAraci === 'brush' && r.vurusAraci === 'eraser' &&
      r.geciciArac === 'eraser' && r.birakmaAraci === 'brush' &&
      r.ikinciVurusAraci === 'brush' && r.ikinciBirakmaAraci === 'brush';
    console.log(ok ? 'PEN-ERASER: GECTI' : 'PEN-ERASER: KIRIK');
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.error('PEP2 HATASI: ' + (e && e.message ? e.message.slice(0, 400) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* son nefes */ }
    await sleep(300);
  }
})();
