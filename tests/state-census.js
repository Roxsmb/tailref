'use strict';
/* =========================================================
   state-census.js — byte-pool FAZ 7.T duran-varlık sayımı (probe)
   ---------------------------------------------------------
   Heap snapshot almadan uygulama durumundan muhasebe:
   undo kayıtları (geri/ileri stack JSON + raster kayıt tablosu),
   katman vuruş verisi, item tuvalleri, editör önbellekleri
   (pyramid/möbil/karo), scratch, wheel önbellekleri.
   Çıktı: toplam bellek hesabı + en büyük kalemler.
   Kullanım: node tests/state-census.js
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9346;
const APP_PORT = 5213;
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
const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) reject(new Error(method + ': ' + msg.error.message));
    else resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-census-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await send(ws, 'Page.enable');
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
      return 'welcome';
    })()`);

    const censusJS = `(() => {
      const MB = b => +(b / 1048576).toFixed(2);
      const cvMB = c => c && c.width ? (c.width * c.height * 4 / 1048576) : 0;
      const out = { heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, undo: {}, layers: {}, editor: {}, canvases: {} };
      /* --- undo --- */
      const u = out.undo;
      u.stackLen = undoStack.length;
      u.stackJSON = MB(undoStack.reduce((n, s) => n + (typeof s === 'string' ? s.length * 2 : 0), 0));
      u.redoStackLen = redoStack.length;
      u.redoStackJSON = MB(redoStack.reduce((n, s) => n + (typeof s === 'string' ? s.length * 2 : 0), 0));
      const tab = inkUndoRaster;
      let holdCount = 0, holdMB = 0, imgCount = 0, imgMB = 0, tileCount = 0, tileMB = 0, dataMB = 0;
      tab.entries.forEach((e, token) => {
        ['before', 'after'].forEach(ph => {
          const s = e && e[ph];
          if (!s) return;
          if (s.hold) { holdCount++; holdMB += cvMB(s.hold); }
          if (s.image) { imgCount++; imgMB += (s.image.data ? s.image.data.byteLength : 0) / 1048576; }
          if (s.tiles) for (const t of s.tiles) { tileCount++; if (t.data) { tileMB += t.data.byteLength / 1048576; } }
          dataMB += (s.bytes || 0) / 1048576;
        });
      });
      u.entries = tab.entries.size;
      u.bytes = MB(tab.bytes);
      u.maxBytes = MB(tab.maxBytes);
      u.maxSnapBytes = MB(tab.maxSnapBytes);
      u.holdCount = holdCount; u.holdMB = +holdMB.toFixed(2);
      u.imgCount = imgCount; u.imgMB = +imgMB.toFixed(2);
      u.tileCount = tileCount; u.tileMB = +tileMB.toFixed(2);
      u.tileBytesTotal = MB(tab.bytes);
      u.rangeScratch = (() => { const rc = (typeof inkUndoScratchCtx !== 'undefined') && inkUndoScratchCtx && inkUndoScratchCtx.canvas; return rc ? MB(cvMB(rc)) : 0; })();
      /* --- katman veriler --- */
      const L = inkState().layers;
      out.layers.count = L.length;
      out.layers.strokes = L.reduce((n, l) => n + (l.strokes || []).length, 0);
      out.layers.points = L.reduce((n, l) => (l.strokes || []).reduce((m, s) => m + (s.points || []).length, n), 0);
      out.layers.pointsMB = +(out.layers.points * 6 * 8 / 1048576).toFixed(2);
      /* --- item tuvalleri --- */
      const ic = [...inkRuntime.itemCanvases.values()];
      out.canvases.itemCount = ic.length;
      out.canvases.itemMB = +ic.reduce((n, c) => n + cvMB(c), 0).toFixed(2);
      /* --- editör önbellek --- */
      const ui = inkEditorUi;
      out.editor.scaledCount = ui.scaledCache ? ui.scaledCache.size : -1;
      out.editor.scaledMB = ui.scaledCache ? +[...ui.scaledCache.values()].reduce((n, c) => n + cvMB(c.canvas || c), 0).toFixed(2) : -1;
      let pyrMB = 0, pyrC = 0;
      if (ui.pyramid) ui.pyramid.forEach(p => {
        if (p && p.levels) p.levels.forEach(lv => { pyrMB += cvMB(lv.canvas); pyrC++; });
      });
      let lvMB = 0, lvC = 0;
      if (ui.tileView && ui.tileView.tiles) ui.tileView.tiles.forEach(t => { if (t && t.canvas) { lvMB += cvMB(t.canvas); lvC++; } });
      out.editor.pyramidCount = pyrC; out.editor.pyramidMB = +pyrMB.toFixed(2);
      out.editor.tileViewCount = lvC; out.editor.tileViewMB = +lvMB.toFixed(2);
      out.editor.baseMB = ui.baseCanvas ? cvMB(ui.baseCanvas).toFixed(2) : 0;
      out.editor.tileBufMB = ui.tileBuf ? cvMB(ui.tileBuf).toFixed(2) : 0;
      /* --- simetri/diğer modüller --- */
      out.dual = (() => {
        if (typeof inkBrushDualScratch !== 'undefined' && inkBrushDualScratch) return MB(cvMB(inkBrushDualScratch));
        return null;
      })();
      out.dualPool = (() => {
        if (typeof inkDualScratchStats === 'function') return inkDualScratchStats();
        return null;
      })();
      out.snapTokens = (() => {
        if (typeof maskSnap === 'undefined' || !maskSnap) return null;
        let refs = 0;
        maskSnap.refs.forEach(n => { refs += n; });
        return { tokens: maskSnap.to.size, refs,
          bytes: [...maskSnap.to.values()].reduce((n, s) => n + s.length * 2, 0) };
      })();
      return JSON.stringify(out);
    })()`;

    /* iş yükü: S2 benzeri */
    const openRes = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '3840';
      document.getElementById('newCanvasH').value = '2160';
      document.getElementById('newCanvasName').value = 'Census';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 150 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      const fire = (type, x, y, press) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
        clientX: rect.left + fit.x + x * fit.w,
        clientY: rect.top + fit.y + y * fit.h,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : press }));
      const ciz = async (brushId, size, color, y0, steps) => {
        inkSetTool('brush', { brushId });
        const ink = inkState();
        ink.size = size; ink.opacity = 1; ink.smoothing = 0.2; ink.color = color;
        await wait(50);
        fire('pointerdown', 0.1, y0, 0.4);
        for (let i = 1; i <= steps; i += 1) {
          fire('pointermove', 0.1 + 0.8 * i / steps, y0, 0.5);
          await wait(6);
        }
        fire('pointerup', 0.9, y0, 0);
        await new Promise(r => requestAnimationFrame(r));
        await wait(120);
      };
      for (let i = 0; i < 4; i += 1) await ciz('ink-hard', 60, '#12343a', 0.1 + i * 0.2, 36);
      for (let i = 0; i < 2; i += 1) await ciz('ink-air', 110, '#7a1414', 0.25 + i * 0.3, 30);
      for (let i = 0; i < 6; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(130);
      }
      await wait(1500);
      return 'ok';
    })()`);
    console.log('iş yükü: ' + openRes);

    const c1 = JSON.parse(await evaluate(ws, censusJS));
    console.log('== SAYIM (Vuruş undo sonrası; hold idle döküm akabilir) ==');
    console.log(JSON.stringify(c1, null, 1));
    app.kill();
  } catch (e) {
    try { app.kill(); } catch { /* */ }
    console.error('PROBE HATASI: ' + (e && e.stack ? e.stack.slice(0, 600) : String(e)));
    process.exitCode = 1;
  }
})();
