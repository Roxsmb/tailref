'use strict';
/* =========================================================
   rebuild-cache-check.js — vuruş-baza cache isabet ölçümü (probe)
   ---------------------------------------------------------
   8K + 10 katman; taban vuruş + smudge; sonrasında maske
   ekle/undo/redo ping-pong → inkStrokeBase hit/miss dağılımı
   ve rebuild span raporu. Kapı DEĞİL.
   Kullanım: node tests/rebuild-cache-check.js
   NOT: sentetik pointerType=pen — süreler SÖZDE-SÜRETTİR.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9341;
const APP_PORT = 5208;
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
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
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
    } catch { /* henüz değil */ }
    await sleep(400);
  }
  throw new Error('debug portu açılmadı (9341)');
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
    ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('renderer hazır olmadı');
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

const HELPERS = `
  var wait = ms => new Promise(r => setTimeout(r, ms));
  var canvas = document.getElementById('inkEditorCanvas');
  var fit = inkEditorUi.fit;
  var rect = canvas.getBoundingClientRect();
  var fire = (type, x, y, press) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
    clientX: rect.left + fit.x + x * fit.w,
    clientY: rect.top + fit.y + y * fit.h,
    button: 0, buttons: type === 'pointerup' ? 0 : 1,
    pressure: type === 'pointerup' ? 0 : press }));
  var ciz = async (brush, size, color, y0, y1, steps) => {
    inkSetTool(brush === 'smudge' ? 'smudge' : 'brush', brush === 'smudge' ? undefined : { brushId: brush });
    const ink = inkState();
    ink.size = size; ink.opacity = 1; ink.smoothing = 0.2; ink.color = color;
    await wait(30);
    fire('pointerdown', 0.08, y0, 0.4);
    for (let k = 1; k <= steps; k += 1) {
      fire('pointermove', 0.08 + 0.84 * k / steps, y0 + (y1 - y0) * k / steps, 0.5);
      await wait(4);
    }
    fire('pointerup', 0.92, y1, 0);
    await new Promise(r => requestAnimationFrame(r));
    await wait(80);
  };
`;

const HEAP = `performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-rchk-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);

    const r = JSON.parse(await evaluate(ws, HELPERS + ` (async () => {
      /* 8K + 10 katman */
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '8192';
      document.getElementById('newCanvasH').value = '4320';
      document.getElementById('newCanvasName').value = 'RCheck';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 300 && !inkEditorIsOpen(); i += 1) await wait(100);
      if (!inkEditorIsOpen()) return { hata: 'editör açılmadı' };
      await wait(600);
      for (let i = 0; i < 9; i += 1) inkDocAddLayer({});
      const L = inkState().layers.filter(l => l.kind === 'attached');

      /* taban: her katmana 2 normal + 2 smudge vuruş */
      for (let i = 0; i < L.length; i += 1) {
        inkState().activeLayerId = L[i].id;
        await ciz('ink-hard', 60, '#3366cc', 0.1 + i * 0.05, 0.3, 40);
        await ciz('ink-air', 120, '#cc3344', 0.3, 0.5, 40);
        await ciz('smudge', 200, '#000000', 0.2, 0.7, 50);
        await ciz('smudge', 200, '#000000', 0.35, 0.6, 50);
      }

      /* maske ekle ×3 katman, ping-pong undo/redo */
      for (const ml of [L[0], L[2], L[4]]) {
        inkDocAddMask(ml.id, 'reveal');
        inkState().maskEditId = ml.id;
        await wait(100);
        await ciz('ink-hard', 34, '#ffffff', 0.25, 0.45, 16);
        inkState().maskEditId = null;
      }
      await wait(500);

      /* ping-pong ×30: undo 3 + redo 2 ritmi */
      for (let i = 0; i < 30; i += 1) {
        for (let k = 0; k < 3; k += 1) {
          window.dispatchEvent(new KeyboardEvent('keydown',
            { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
          await wait(60);
        }
        for (let k = 0; k < 2; k += 1) {
          window.dispatchEvent(new KeyboardEvent('keydown',
            { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
          await wait(60);
        }
      }
      await wait(400);

      const s = inkPerfSnapshot();
      const c = s.counters;
      const span = n => ({ n: c[n + 'Count'] || 0, avg: Math.round(((c[n + 'Ms'] || 0) / (c[n + 'Count'] || 1)) * 100) / 100, max: Math.round((c[n + 'MaxMs'] || 0) * 100) / 100 });
      /* stroke-base önbellek doğrudan bakım: erişilebilir mi? */
      let sb = null;
      try { sb = { mapSize: inkStrokeBase.map.size }; } catch { sb = null; }
      return {
        maske: inkState().layers.filter(l => l.mask).length,
        undoCak: undoStack.length,
        rebuild: span('rebuild'),
        hit: c.rebuildHit || 0, miss: c.rebuildMiss || 0, missNew: c.rebuildMissNew || 0,
        sb, heap: ${HEAP} };
    })()`));
    console.log(JSON.stringify(r, null, 1));
  } catch (e) {
    console.error('RCHK HATASI: ' + (e && e.message ? e.message.slice(0, 240) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* */ }
  }
})();
