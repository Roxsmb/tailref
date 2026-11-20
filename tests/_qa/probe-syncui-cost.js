'use strict';
/* QA: inkSyncUI içinde hangi alt çağrı ne kadar yiyor? */
const { start } = require('./harness');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_PORT = 5393;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-sync-cost-'));

(async () => {
  const app = await start({ port: 9533, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-sync-cost-' });
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
      for (let i = layers0.length; i < 20; i += 1) inkDocAddLayer();
      await wait(400);

      const acc = {};
      const names = ['inkSyncNativeBrushLibrary', 'inkRenderPresets', 'inkPreviewBrush',
        'inkUpdateHud', 'inkSyncLayersPanel', 'inkWorkspaceSync', 'inkLayoutDock',
        'inkEditorSyncStatus', 'inkEditorInvalidate', '__v5OptSync',
        'inkSyncBrushPanelState', 'inkSyncColorSwatch', 'inkSyncColorWheel',
        'inkSyncScopeVisual', 'inkGetBrush', 'isPanelVisible', 'inkCloseColorWheel'];
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
      const runs = [];
      for (let i = 0; i < 6; i += 1) {
        for (const k of Object.keys(acc)) delete acc[k];
        const t0 = performance.now();
        inkSyncUI({ invalidateEditor: false });
        runs.push(Math.round((performance.now() - t0) * 10) / 10);
        await wait(60);
      }
      const parts = Object.fromEntries(Object.entries(acc)
        .map(([k, v]) => [k, Math.round(v / 6 * 10) / 10]));
      for (const n of Object.keys(origs)) window[n] = origs[n];
      return JSON.stringify({ runs, partsPerCall: parts,
        brushes: inkState().brushes.length, layers: inkDocLayers(inkDocOwnerId() || '').length });
    })()`);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
