'use strict';
/* QA: fırça boyutu kaydırıcısı editörü yeniden kompozit ediyor mu? */
const { start } = require('./harness');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_PORT = 5391;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-slider-cost-'));

(async () => {
  const app = await start({ port: 9531, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-slider-cost-' });
  try {
    const out = await app.json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1600';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      if (!inkEditorIsOpen()) return JSON.stringify({ error: 'editör açılmadı' });
      const layers0 = inkDocLayers(inkDocOwnerId() || '');
      for (let i = layers0.length; i < 15; i += 1) inkDocAddLayer();
      await wait(300);
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      const layers = inkDocLayers(inkDocOwnerId() || '');
      const opts = { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'pen', button: 0, buttons: 1, pressure: 0.6 };
      for (let li = 0; li < layers.length; li += 1) {
        inkDocSelectLayer(layers[li].id);
        const x0 = rect.left + 100 + Math.random() * 200;
        const y0 = rect.top + 100 + Math.random() * 200;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x0, clientY: y0 }));
        for (let m = 1; m <= 10; m += 1) {
          canvas.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: x0 + m * 9, clientY: y0 + m * 5 }));
        }
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0, clientX: x0 + 90, clientY: y0 + 50 }));
        await wait(25);
      }
      await wait(600);

      let renders = 0;
      let renderMs = 0;
      const orig = inkEditorRender;
      inkEditorRender = function () {
        const t = performance.now();
        try { return orig.apply(this, arguments); }
        finally { renders += 1; renderMs += performance.now() - t; }
      };
      inkEditorRender = orig;
      /* Alt çağrıları ayrı ayrı ölç: kaydırıcı sürüklemesi neden
         18 ms/olay yiyor? */
      const acc = {};
      const names = ['inkSaveBrushOverride', 'inkPreviewBrush', 'inkUpdateHud',
        '__v5OptSync', 'inkNormalizeBrush'];
      const origs = {};
      for (const n of names) {
        if (typeof window[n] !== 'function') continue;
        origs[n] = window[n];
        window[n] = function () {
          const t = performance.now();
          try { return origs[n].apply(this, arguments); }
          finally { acc[n] = (acc[n] || 0) + (performance.now() - t); }
        };
      }
      const slider = document.getElementById('inkSize');
      const eventTimes = [];
      const t0 = performance.now();
      for (let i = 0; i < 24; i += 1) {
        slider.value = String(4 + i * 2);
        const e0 = performance.now();
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        eventTimes.push(performance.now() - e0);
        await wait(16);
      }
      const syncMs = performance.now() - t0;
      for (const n of Object.keys(origs)) window[n] = origs[n];
      await new Promise(r => requestAnimationFrame(r));
      await wait(300);
      const per = (v) => Math.round(v / 24 * 100) / 100;
      return JSON.stringify({
        events: 24,
        renders, renderMs: Math.round(renderMs),
        totalMs: Math.round(syncMs),
        perInput: Math.round(syncMs / 24 * 10) / 10,
        handlerMs: per(eventTimes.reduce((a, b) => a + b, 0)),
        handlerMax: Math.round(Math.max.apply(null, eventTimes) * 10) / 10,
        parts: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, per(v)])),
        size: inkState().size,
      });
    })()`);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
