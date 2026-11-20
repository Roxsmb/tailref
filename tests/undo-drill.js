'use strict';
/* =========================================================
   undo-drill.js — fallback bölgesel undo kurulumunun alt faz denetimi
   ---------------------------------------------------------
   inkUndoRegionRebuild içindeki rcClearBake / rcStamp / rcBlit
   sub-span'ini mini F4 eşleniği altında okur. Kapı DEĞİL.
   Kullanım: node tests/undo-drill.js
   NOT: sentetik pointerType=pen — sureler SOZDE-SURETTTIR.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9352;
const APP_PORT = 5222;
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
  throw new Error('debug portu acilmadi (9352)');
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

const COMMON = `
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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-ud-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);

    const kur = JSON.parse(await evaluate(ws, COMMON + `(async () => {
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '3840';
      document.getElementById('newCanvasH').value = '2160';
      document.getElementById('newCanvasName').value = 'UD';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 200 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      for (let i = 0; i < 3; i += 1) inkDocAddLayer({});
      return { layers: inkState().layers.length };
    })()`));
    console.log('kurulum: ' + JSON.stringify(kur));

    /* ==== çiz: 3 katman × (6 vuruş + 6 smudge çapraz) ==== */
    const cizim = JSON.parse(await evaluate(ws, COMMON + `(async () => {
      const L = inkState().layers.filter(l => l.kind === 'attached');
      let n = 0;
      for (let i = 0; i < L.length; i += 1) {
        inkState().activeLayerId = L[i].id;
        for (let k = 0; k < 6; k += 1) {
          await ciz(k % 2 ? 'ink-air' : 'ink-hard', k % 2 ? 90 : 45, '#3366ff',
            0.1 + i * 0.08, 0.5 + i * 0.08 + (k % 3) * 0.1, 50);
          n++;
        }
        for (let k = 0; k < 6; k += 1) {
          await ciz('smudge', 150, '#000000',
            0.05 + (k % 3) * 0.15, 0.85 - (k % 3) * 0.15, 60);
          n++;
        }
        pushUndo();
      }
      for (let i = 0; i < 250 && inkEditorUi.strokeInFlight; i += 1) await wait(100);
      return { n, vos: inkState().layers.reduce((a, l) => a + (l.strokes || []).length, 0) };
    })()`));
    console.log('çizim: ' + JSON.stringify(cizim));

    const NOFIL = `(() => { if (typeof inkPerfReset === 'function') inkPerfReset(); return true; })()`;
    await evaluate(ws, NOFIL);

    /* ==== undo döngüsü ×30, tek tek undo sekron maliyeti ==== */
    const undoSonuc = JSON.parse(await evaluate(ws, COMMON + `(async () => {
      const imza = typeof inkPerf !== 'undefined' ? inkPerf.counters : {};
      const bas = JSON.parse(JSON.stringify(imza));
      const undoMs = [];
      for (let i = 0; i < 30 && undoStack.length; i += 1) {
        const t = performance.now();
        undo();
        undoMs.push(Math.round(performance.now() - t));
        await wait(24);
      }
      const simdi = inkPerf.counters;
      const sec = name => ({ n: (simdi[name + 'Count'] || 0) - (bas[name + 'Count'] || 0),
        ms: Math.round(((simdi[name + 'Ms'] || 0) - (bas[name + 'Ms'] || 0)) * 10) / 10,
        max: Math.round((simdi[name + 'MaxMs'] || 0) * 10) / 10 });
      return { undoMs: undoMs.slice(0, 12),
        rect: sec('rebuildRect'), rcClearBake: sec('rcClearBake'),
        rcStamp: sec('rcStamp'), rcBlit: sec('rcBlit'), rcStrokes: simdi.rcStrokes || 0,
        stats: inkUndoRaster.stats ? JSON.parse(JSON.stringify(inkUndoRaster.stats)) : null,
        wstats: (typeof inkWorkerStats === 'function') ? inkWorkerStats() : null,
        undoStack: undoStack.length };
    })()`));
    console.log('UNDO: ' + JSON.stringify(undoSonuc));

    const ort = (s, d) => (d > 0 ? Math.round(s / d * 100) / 100 : 0);
    console.log('HUKM: rect ort=' + ort(undoSonuc.rect.ms, undoSonuc.rect.n) + 'ms (' + undoSonuc.rect.n + ' çağrı)' +
      ' | clearBake ort=' + ort(undoSonuc.rcClearBake.ms, undoSonuc.rcClearBake.n) + 'ms' +
      ' | stamp ort=' + ort(undoSonuc.rcStamp.ms, undoSonuc.rcStamp.n) + 'ms' +
      ' | blit ort=' + ort(undoSonuc.rcBlit.ms, undoSonuc.rcBlit.n) + 'ms' +
      ' | pay=' + (undoSonuc.rect.n ? Math.round(undoSonuc.rcStamp.ms / undoSonuc.rect.ms * 100) : 0) + '% stamp');

    /* ==== maske fazı: tam rebuild'ı KİM tetikliyor? (stack kanıtı) ==== */
    await evaluate(ws, `(() => {
      if (window.__rbTraces) return true;
      window.__rbTraces = [];
      const sel = window.inkRebuildItemLayer;
      window.inkRebuildItemLayer = function (layer) {
        const stack = (new Error().stack || '').split('\\n').slice(2, 8).join(' | ');
        window.__rbTraces.push({ id: layer && layer.id,
          len: layer && layer.strokes ? layer.strokes.length : -1,
          kontur: stack.replace(/\\s+/g, ' ').slice(0, 380) });
        return sel.apply(this, arguments);
      };
      return true;
    })()`);
    const maskeFaz = JSON.parse(await evaluate(ws, COMMON + `(async () => {
      const L = inkState().layers.filter(l => l.kind === 'attached');
      if (!L.length) return { hata: 'katman yok' };
      inkDocAddMask(L[1].id, 'reveal');
      inkState().maskEditId = L[1].id;
      await wait(150);
      for (let k = 0; k < 4; k += 1) {
        await ciz('ink-hard', 30, k % 2 ? '#000000' : '#ffffff',
          0.25 + k * 0.06, 0.34 + k * 0.06, 18);
        await wait(140);
      }
      inkState().maskEditId = null;
      await wait(400);
      const c = (typeof inkPerf !== 'undefined' && inkPerf.counters) || {};
      return { traces: window.__rbTraces ? window.__rbTraces.slice(0, 12) : [] };
    })()`));
    console.log('MASKE-IK(faz): ' + JSON.stringify(maskeFaz));
    const ozet = JSON.parse(await evaluate(ws, `(() => {
      const t = window.__rbTraces || [];
      const katkitor = t.map(x => (x.kontur || '').indexOf('inkMaskCommitStrokeFor') >= 0 ? 'commit' :
        (x.kontur || '').indexOf('inkDocAddMask') >= 0 ? 'add' :
        (x.kontur || '').indexOf('inkMaskRasterSource') >= 0 ? 'cozum' : 'diger');
      const ozetim = {};
      for (const k of katkitor) ozetim[k] = (ozetim[k] || 0) + 1;
      return { toplam: t.length, ozetim, ilk: t.length ? t[0].kontur : '' };
    })()`));
    console.log('MASKE-OZET: ' + JSON.stringify(ozet, null, 1));

  } catch (e) {
    console.error('UD HATASI: ' + (e && e.message ? e.message.slice(0, 300) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* son nefes */ }
    await sleep(300);
  }
})();
