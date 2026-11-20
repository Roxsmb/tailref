'use strict';
/* QA: Ctrl+Z senkron maliyeti (rAF beklemesi hariç) + sonraki kare. */
const { start } = require('./harness');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_PORT = 5389;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-undo-cost-'));

(async () => {
  const app = await start({ port: 9529, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-undo-cost-' });
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
      for (let i = layers0.length; i < 10; i += 1) inkDocAddLayer();
      await wait(300);
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      const layers = inkDocLayers(inkDocOwnerId() || '');
      inkSetTool('brush', { brushId: 'ink-soft' });
      inkState().size = 14;
      const opts = { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'pen', button: 0, buttons: 1, pressure: 0.6 };
      for (let li = 0; li < layers.length; li += 1) {
        inkDocSelectLayer(layers[li].id);
        for (let k = 0; k < 2; k += 1) {
          const x0 = rect.left + 80 + Math.random() * 300;
          const y0 = rect.top + 80 + Math.random() * 300;
          canvas.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x0, clientY: y0 }));
          for (let m = 1; m <= 14; m += 1) {
            canvas.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: x0 + m * 8, clientY: y0 + m * 4 }));
          }
          canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0, clientX: x0 + 112, clientY: y0 + 56 }));
          await wait(25);
        }
      }
      await wait(500);

      const sync = [];
      const frame = [];
      for (let i = 0; i < 6; i += 1) {
        const t0 = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        sync.push(Math.round((performance.now() - t0) * 10) / 10);
        const f0 = performance.now();
        await new Promise(r => requestAnimationFrame(r));
        frame.push(Math.round((performance.now() - f0) * 10) / 10);
        await wait(50);
      }
      /* redo */
      const redoSync = [];
      for (let i = 0; i < 3; i += 1) {
        const t0 = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
        redoSync.push(Math.round((performance.now() - t0) * 10) / 10);
        await wait(40);
      }
      return JSON.stringify({ layers: layers.length, sync, frame, redoSync,
        undoDepth: typeof undoStack !== 'undefined' ? undoStack.length : -1 });
    })()`);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
