'use strict';
/* QA: boşta kare maliyeti. Editör açıkken rAF aralığını ve her karede
   rAF geri çağrılarında harcanan toplam süreyi ölçer; hangi döngünün
   yediğini isimle raporlar. */
const { start, sleep } = require('./harness');

const APP_PORT = 5387;
const userDataDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tailref-idle-'));

(async () => {
  const app = await start({ port: 9527, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-idle-' });
  try {
    const before = await app.json(`(async () => {
      const sample = async frames => {
        const stats = { deltas: [], busy: [], names: {} };
        const orig = window.requestAnimationFrame;
        let depth = 0;
        window.requestAnimationFrame = function (cb) {
          const wrapped = function (ts) {
            const t0 = performance.now();
            try { return cb(ts); }
            finally {
              const d = performance.now() - t0;
              stats.busy.push(d);
              const n = cb.name || 'anon';
              stats.names[n] = (stats.names[n] || 0) + d;
            }
          };
          return orig.call(window, wrapped);
        };
        await new Promise(res => {
          let last = 0, n = 0;
          const tick = t => {
            if (last) stats.deltas.push(t - last);
            last = t;
            if (++n < frames) orig.call(window, tick); else res();
          };
          orig.call(window, tick);
        });
        window.requestAnimationFrame = orig;
        const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
        const sorted = stats.deltas.slice().sort((a, b) => a - b);
        const top = Object.entries(stats.names).sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map(([k, v]) => k + '=' + Math.round(v) + 'ms');
        return {
          deltaAvg: Math.round(avg(stats.deltas) * 10) / 10,
          deltaP50: Math.round((sorted[Math.floor(sorted.length / 2)] || 0) * 10) / 10,
          deltaP95: Math.round((sorted[Math.floor(sorted.length * 0.95)] || 0) * 10) / 10,
          busyPerFrame: Math.round(avg(stats.busy) * 10) / 10,
          busyTotalMs: Math.round(stats.busy.reduce((a, b) => a + b, 0)),
          frames: stats.deltas.length,
          top,
        };
      };
      const out = {};
      out.board = await sample(90);
      document.getElementById('modeDrawBtn').click();
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1600';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => setTimeout(r, 900));
      const layers = inkDocLayers(inkDocOwnerId() || '');
      for (let i = layers.length; i < 25; i += 1) inkDocAddLayer();
      await new Promise(r => setTimeout(r, 600));
      out.editorIdle = await sample(120);
      /* imleç görünürken */
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 3,
        pointerType: 'pen', clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
      out.cursorIdle = await sample(90);
      return JSON.stringify(out);
    })()`);
    console.log(JSON.stringify(before, null, 2));
  } finally {
    await app.stop();
  }
  require('fs').rmSync(userDataDir, { recursive: true, force: true });
})();
