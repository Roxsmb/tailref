'use strict';
/* QA: fırçayı sağ tık menüsündeki "kategoriye taşı" akışı kalıcı mı? */
const { start } = require('./harness');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_PORT = 5407;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-brush-move-'));

(async () => {
  let app = await start({ port: 9545, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-brush-move-' });
  let brushId = '';
  let catId = '';
  try {
    const first = await app.json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: true });
      await wait(300);
      const name = document.getElementById('nativeBrushCustomName');
      name.value = 'QA Taşınan Fırça';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('nativeBrushCustomCreate').click();
      await wait(900);
      const brush = inkState().brushes.find(b => b.name === 'QA Taşınan Fırça');
      if (!brush) return JSON.stringify({ error: 'fırça oluşmadı' });
      const res = await inkNativeCreateCategory('QA Taşıma Kategorisi');
      if (!res || !res.ok) return JSON.stringify({ error: 'kategori oluşmadı' });
      const moved = await inkNativeMoveBrushToCategory(brush.id, res.category.id);
      await wait(900);
      inkNativeBrushUi.activeCategory = res.category.id;
      inkNativeRenderBrushList();
      const card = [...document.querySelectorAll('#nativeBrushList .nbBrushCard')]
        .some(c => c.dataset.brushId === brush.id);
      return JSON.stringify({ brushId: brush.id, catId: res.category.id, moved,
        category: brush.category, badge: brush.badge, card });
    })()`);
    console.log('· 1. oturum:', JSON.stringify(first));
    brushId = first.brushId || '';
    catId = first.catId || '';
  } finally {
    await app.stop();
  }

  app = await start({ port: 9547, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-brush-move-b-' });
  try {
    const second = await app.json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 40 && !(typeof inkState === 'function' && inkState().brushes.length); i += 1) await wait(150);
      await wait(600);
      const brush = inkState().brushes.find(b => b.id === ${JSON.stringify(brushId)});
      inkOpenNativeBrushLibrary(null, ${JSON.stringify(catId)}, { creatorOnly: false });
      await wait(300);
      const card = [...document.querySelectorAll('#nativeBrushList .nbBrushCard')]
        .some(c => c.dataset.brushId === ${JSON.stringify(brushId)});
      return JSON.stringify({ found: !!brush, category: brush && brush.category,
        badge: brush && brush.badge, card,
        catVisible: inkNativeVisibleCategories().some(c => c.id === ${JSON.stringify(catId)}) });
    })()`);
    console.log('· 2. oturum:', JSON.stringify(second));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
