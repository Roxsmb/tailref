'use strict';
/* =========================================================
   commit-split-probe.js — ink-bench commit regresyonu (~10 ms
   sabit ek yük) ayrıştırması: inkCommitFreehand alt adımlarını
   monkey-patch ile tek tek ölçer. Tanısal probe, kapı değil.
   Kullanım: node tests/commit-split-probe.js
   ========================================================= */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9362;
const APP_PORT = 5232;
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

/* Bench ile birebir vuruş + alt adım ölçümü */
const PROBE = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ink = inkState();
  if (!ink.brushes || !ink.brushes.length) {
    if (typeof inkDefaultBrushes === 'function') ink.brushes = inkDefaultBrushes();
  }
  function makePoints(n, kind) {
    const pts = []; const turns = 5;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const a = t * Math.PI * 2 * turns;
      const r = 60 + 640 * t;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.75,
        p: kind === 'soft' ? 0.55 + 0.35 * Math.sin(t * Math.PI) : 1 });
    }
    return pts;
  }
  function makeStroke(n, kind) {
    const hard = kind !== 'soft';
    return { id: 'sk_split_' + Math.random().toString(36).slice(2),
      kind: 'stroke', tool: 'brush', shape: '', color: '#2f7bff',
      size: 24, opacity: 1, hardness: hard ? 1 : 0.4, spacing: hard ? 0.07 : 0.09,
      brushId: hard ? 'ink-hard' : 'ink-soft', scatter: 0, closed: false,
      points: makePoints(n, kind) };
  }
  const layer = inkMakeLayer({ kind: 'global', plane: 'below', name: 'split' });
  ink.layers.push(layer); ink.activeLayerId = layer.id;

  /* Alt adım sarma */
  const m = { undo: [], paint: [], emit: [], clear: [], panel: [], save: [], after: [] };
  const w = (name, fn) => (...a) => { const t = performance.now(); const r = fn(...a); m[name].push(performance.now() - t); return r; };
  const PU = inkPushUndoStroke, PC = inkPaintCommittedStroke, EM = inkEmitLiveSegment,
        CL = inkClearLive, SP = inkSyncLayersPanel, SV = scheduleSave, AC = inkAfterCommitPaint;
  inkPushUndoStroke = w('undo', PU);
  inkPaintCommittedStroke = w('paint', PC);
  inkEmitLiveSegment = w('emit', EM);
  inkClearLive = w('clear', CL);
  inkSyncLayersPanel = w('panel', SP);
  scheduleSave = w('save', SV);
  inkAfterCommitPaint = w('after', AC);

  async function olc(n, kind) {
    for (const k in m) m[k] = [];
    inkPerfReset();
    const stroke = makeStroke(n, kind);
    const t0 = performance.now();
    inkPointer = { mode: 'freehand', tool: 'brush', layer, stroke,
      smoothX: 0, smoothY: 0, startWorld: { x: 0, y: 0 }, startLocal: { x: 0, y: 0 },
      lastPressure: 1, lastScreen: null, collected: stroke.points.length };
    inkCommitFreehand();
    const commitMs = performance.now() - t0;
    const t1 = performance.now();
    await inkPaintIdle();
    const paintMs = performance.now() - t1;
    const snap = inkPerfSnapshot();
    const ozet = {};
    for (const k in m) ozet[k] = m[k].length ? Math.round(100 * m[k].reduce((x, y) => x + y, 0) / m[k].length) / 100 : 0;
    /* katmanı temizle (sonraki ölçüm kirli raster şişirmesin) */
    layer.strokes = layer.strokes.filter(s => s.id !== stroke.id);
    return { n, kind, commitMs: Math.round(commitMs), paintMs: Math.round(paintMs),
      alt: ozet, spans: { commit: snap.commit || null, undoSnap: snap.undoSnap || null,
        plan: snap.plan || null, dispatch: snap.dispatch || null },
      counters: { dabs: snap.dabs || 0, workerJobs: snap.workerJobs || 0 } };
  }
  const out = [];
  out.push(await olc(4000, 'hard'));
  out.push(await olc(4000, 'soft'));
  out.push(await olc(4000, 'hard'));
  out.push(await olc(4000, 'soft'));
  await wait(100);
  return out;
})()`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-csp-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);
    const r = JSON.parse(await evaluate(ws, PROBE));
    for (const row of r) console.log(JSON.stringify(row));
  } catch (e) {
    console.error('CSP HATASI: ' + (e && e.message ? e.message.slice(0, 400) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* son nefes */ }
    await sleep(300);
  }
})();
