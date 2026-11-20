'use strict';
/* =========================================================
   mask-snap-dedupe-check.js — undo snapshot mask src tokenize (probe)
   ---------------------------------------------------------
   Maske ekle + vuruş + undo ×4; pushUndo snapshot boyutlarını
   (undoSnapBytes sayaç) ve state'te maskenin canlılığını ölçer.
   NOT: sentetik pointerType=pen — SÖZDE-SÜRET uyarısı geçerli.
   Kullanım: node tests/mask-snap-dedupe-check.js  (kapı DEĞİL)
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9344;
const APP_PORT = 5211;
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
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});
async function waitForTarget(deadlineMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz hazır değil */ }
    await sleep(400);
  }
  throw new Error('debug portu açılmadı');
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-mdedupe-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=9344', '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');
    await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (w && !w.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
      }
      return 'ok';
    })()`);

    const res = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '1600';
      document.getElementById('newCanvasH').value = '1200';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 150 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      const fire = (type, x, y, press) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
        clientX: rect.left + fit.x + x * fit.w,
        clientY: rect.top + fit.y + y * fit.h,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : press }));
      const ciz = async (color, y0, steps) => {
        inkSetTool('brush', { brushId: 'ink-hard' });
        const ink = inkState();
        ink.size = 30; ink.opacity = 1; ink.smoothing = 0.2; ink.color = color;
        await wait(40);
        fire('pointerdown', 0.15, y0, 0.4);
        for (let k = 1; k <= steps; k += 1) {
          fire('pointermove', 0.15 + 0.6 * k / steps, y0, 0.5);
          await wait(5);
        }
        fire('pointerup', 0.75, y0, 0);
        await new Promise(r => requestAnimationFrame(r));
        await wait(120);
      };

      /* taban vuruş + maske ekleyip 3 vuruş */
      await ciz('#2244aa', 0.35, 20);
      const L0 = inkState().layers[0];
      inkDocAddMask(L0.id, 'reveal');
      inkState().maskEditId = L0.id;
      await wait(150);
      for (let i = 0; i < 3; i += 1) {
        await ciz('#ffffff', 0.5 + i * 0.1, 18);
        await wait(80);
      }
      /* enough idle 400ms → pending flush */
      await wait(500);
      const srcLenFull = inkState().layers[0].mask.src.length;
      const undoFall = undoStack.length;
      const before = {
        srcLenFull, undoFall,
        snapSample: undoStack.length ? undoStack[undoStack.length - 1].length : -1,
        redo: redoStack.length,
        refCounts: Object.fromEntries([...(maskSnap.refs || [])]),
        tokens: (maskSnap.to || new Map()).size,
      };
      /* snapshot'ta srcRef var mı? */
      const last = undoStack[undoStack.length - 1] || '';
      before.hasSrcRef = last.indexOf('"srcRef"') >= 0;
      before.hasBigSrc = last.indexOf('data:image/png;base64,') >= 0 &&
        last.length > srcLenFull;

      /* undo ×3 → mask gitti mi? redo ×3 → mask geri mi? */
      const cni = inkState().layers[0].mask ? inkState().layers[0].mask.src.length : 0;
      for (let i = 0; i < 3; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(150);
      }
      const maskUndoState = (() => {
        const m = inkState().layers[0].mask;
        return m ? { len: m.src.length, tokens: (maskSnap || { to: new Map() }).to.size } : { gone: true };
      })();
      const afterUndo = { maskSrcLen: maskUndoState.len || 0, maskGone: !!maskUndoState.gone,
        tokens: (maskSnap || { to: new Map() }).to.size };

      for (let i = 0; i < 3; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(150);
      }
      const m2 = inkState().layers[0].mask;
      const afterRedo = { maskBack: !!m2, len: m2 ? m2.src.length : 0,
        sameAsFull: m2 ? m2.src.length === srcLenFull : false,
        tokens: maskSnap.to.size };

      /* maskesiz mutasyon göstergesi: taşırım AI değiştir yok → snapshot küçük kalmalı */
      const moves = [];
      for (let i = 0; i < 3; i += 1) {
        pushUndo();
        moves.push(undoStack[undoStack.length - 1].length);
      }
      const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
      return JSON.stringify({ before, cni, afterUndo, afterRedo, moves, heap,
        afUndo: undoStack.length, afRedo: redoStack.length });
    })()`));
    console.log(JSON.stringify(res, null, 1));
    app.kill();
  } catch (e) {
    try { app.kill(); } catch { /* */ }
    console.error('PROBE HATASI: ' + (e && e.stack ? e.stack.slice(0, 600) : String(e)));
    process.exitCode = 1;
  }
})();
