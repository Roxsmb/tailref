'use strict';
/* QA: katman geçişi neden ~50 ms? Alt adımları tek tek ölçer. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9525;
const APP_PORT = 5385;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-layer-cost-'));

function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6);
    const timer = setTimeout(() => reject(new Error('eval zaman aşımı')), 60000);
    const onMsg = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMsg);
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      if (msg.result.exceptionDetails) {
        return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
      }
      resolve(msg.result.result.value);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true } }));
  });
}

(async () => {
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'],
    { cwd: ROOT, env, stdio: 'ignore' });
  let ws = null;
  try {
    let page = null;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && !page) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      } catch { /* bekle */ }
      if (!page) await sleep(400);
    }
    if (!page) throw new Error('ana pencere açılmadı');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

    for (let i = 0; i < 100; i++) {
      const ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined'");
      if (ready) break;
      await sleep(400);
    }

    const out = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1600';
      document.getElementById('newCanvasName').value = 'Katman Maliyeti';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(600);
      if (!inkEditorIsOpen()) return JSON.stringify({ error: 'editör açılmadı' });

      const startLayers = inkDocLayers(inkDocOwnerId() || '').length;
      for (let i = startLayers; i < 25; i += 1) inkDocAddLayer();
      await wait(400);

      /* her katmana birkaç vuruş: dolu belge */
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      const layers = inkDocLayers(inkDocOwnerId() || '');
      for (let li = 0; li < layers.length; li += 1) {
        inkDocSelectLayer(layers[li].id);
        inkSetTool('brush', { brushId: 'ink-soft' });
        inkState().size = 12;
        const opts = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'pen',
          button: 0, buttons: 1, pressure: 0.6 };
        for (let k = 0; k < 2; k += 1) {
          const x0 = rect.left + 60 + Math.random() * 400;
          const y0 = rect.top + 60 + Math.random() * 400;
          canvas.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x0, clientY: y0 }));
          for (let m = 1; m <= 12; m += 1) {
            canvas.dispatchEvent(new PointerEvent('pointermove', { ...opts,
              clientX: x0 + m * 9, clientY: y0 + m * 5 }));
          }
          canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0,
            clientX: x0 + 110, clientY: y0 + 60 }));
          await wait(30);
        }
      }
      await wait(500);

      /* alt adım sayaçları */
      const acc = {};
      const wrap = (name, fn) => {
        if (typeof window[name] !== 'function') return;
        const orig = window[name];
        window[name] = function (...args) {
          const t = performance.now();
          try { return orig.apply(this, args); }
          finally { acc[name] = (acc[name] || 0) + (performance.now() - t); }
        };
      };
      ['inkSyncUI', 'dpSyncToolbar', 'inkLayerStoreEmit', 'inkEditorInvalidate',
        'inkEditorRender', 'inkSyncLayersPanel', 'inkFlushLayerThumbs',
        'inkPaintLayerThumb', 'inkPaintMaskThumb', 'inkPaintPreviewAsync',
        'inkEditorResize', 'inkEditorSyncStatus', 'inkEditorComputeFit',
        'inkEditorOpen'].forEach(n => wrap(n, null));

      const list = inkDocLayers(inkDocOwnerId() || '');
      const stateAt = () => ({
        needsRender: !!inkEditorUi.needsRender,
        renderQueued: !!inkEditorUi.renderQueued,
        previewDirty: !!inkEditorUi.previewDirty,
        sameRef: inkEditorInvalidate === window.inkEditorInvalidate,
      });
      const idleState = stateAt();
      await wait(1000);
      const idleState2 = stateAt();
      const samples = [];
      /* kontrol: hiçbir işlem yapmadan bir kare bekle */
      const control = [];
      for (let i = 0; i < 3; i += 1) {
        const c0 = performance.now();
        await new Promise(r => requestAnimationFrame(r));
        control.push(Math.round((performance.now() - c0) * 10) / 10);
        await wait(40);
      }
      for (let i = 0; i < 8; i += 1) {
        const target = list[i % list.length];
        for (const k of Object.keys(acc)) delete acc[k];
        const t0 = performance.now();
        inkDocSelectLayer(target.id);
        const syncMs = performance.now() - t0;
        const afterSelect = stateAt();
        await new Promise(r => requestAnimationFrame(r));
        const frameMs = performance.now() - t0;
        await wait(40);
        samples.push({ sync: Math.round(syncMs * 10) / 10, frame: Math.round(frameMs * 10) / 10,
          afterSelect,
          parts: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, Math.round(v * 10) / 10])) });
      }
      return JSON.stringify({ layers: list.length, control, idleState, idleState2, samples });
    })()`);
    console.log(JSON.stringify(JSON.parse(out), null, 2));
  } finally {
    try { ws?.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
    await sleep(800);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli */ }
  }
})().catch(err => { console.error('HATA:', err.message); process.exit(1); });
