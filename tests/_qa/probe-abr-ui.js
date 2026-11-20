'use strict';
/* QA: içe aktarılan .abr fırçası kütüphane kategorilerinde görünüyor mu? */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { start, sleep } = require('./harness');

const APP_PORT = 5369;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-abr-ui-'));
const abrPath = process.argv[2] || path.join(os.tmpdir(), 'tailref-abr-out', 'builtin.abr');
const bytes = fs.readFileSync(abrPath);

(async () => {
  const app = await start({ port: 9509, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-abr-ui-' });
  try {
    const b64 = bytes.toString('base64');
    const imported = await app.json(`(async () => {
      const raw = atob(${JSON.stringify(b64)});
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      const file = new File([arr], 'builtin.abr', { type: 'application/octet-stream' });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById('inkAbrInput');
      const before = inkState().brushes.length;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (inkState().brushes.length > before) break;
      }
      await new Promise(r => setTimeout(r, 700));
      const added = inkState().brushes.slice(before);
      return JSON.stringify(added.map(b => ({ id: b.id, name: b.name, category: b.category, badge: b.badge })));
    })()`);
    console.log('imported:', JSON.stringify(imported));

    const info = await app.json(`(() => {
      const target = inkState().brushes.find(b => /^abr_/.test(b.id));
      if (!target) return JSON.stringify({ error: 'abr fırça yok' });
      const cats = inkNativeVisibleCategories().map(c => ({
        id: c.id, name: c.name,
        total: inkNativeBrushesForCategory(c.id).length,
        has: inkNativeBrushesForCategory(c.id).some(b => b.id === target.id),
      }));
      const inVisible = inkNativeVisibleBrushes().some(b => b.id === target.id);
      /* kütüphaneyi her kategori için çiz, kart var mı bak */
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: false });
      const cardByCat = {};
      for (const c of inkNativeVisibleCategories()) {
        inkNativeBrushUi.activeCategory = c.id;
        inkNativeRenderBrushList();
        cardByCat[c.id] = [...document.querySelectorAll('#nativeBrushList .nbBrushCard')]
          .some(card => card.dataset.brushId === target.id);
      }
      return JSON.stringify({
        target: { id: target.id, name: target.name, category: target.category, badge: target.badge },
        inVisible,
        cats,
        cardByCat,
        activeCategory: inkNativeBrushUi.activeCategory,
      });
    })()`);
    console.log('library:', JSON.stringify(info, null, 2));

    const quick = await app.json(`(() => {
      const target = inkState().brushes.find(b => /^abr_/.test(b.id));
      const ids = [...document.querySelectorAll('#inkPresetList .inkPreset')].map(b => b.dataset.brushId);
      return JSON.stringify({ quickCount: ids.length, quickHas: target ? ids.includes(target.id) : false });
    })()`);
    console.log('quick strip:', JSON.stringify(quick));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
