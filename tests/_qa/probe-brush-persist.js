'use strict';
/* QA: özel fırça gerçekten uygulama yeniden açılınca duruyor mu? */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { start, sleep } = require('./harness');

const APP_PORT = 5363;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-brush-persist-'));
const BRUSH_NAME = 'QA Kalıcı Fırça ' + Date.now();

async function readBrushes(app) {
  return app.json(`JSON.stringify((() => {
    const ink = inkState();
    return {
      names: (ink.brushes || []).map(b => b.name),
      custom: (ink.brushes || []).filter(b => /^custom-brush-/.test(b.id)).map(b => ({ id: b.id, name: b.name, category: b.category })),
      activeId: ink.brushId,
    };
  })())`);
}

async function readDb(app) {
  return app.json(`(async () => {
    const records = await idbGet('meta', 'ink:brushes');
    const lib = await idbGet('meta', 'ink:library');
    return JSON.stringify({
      recordCount: Array.isArray(records) ? records.length : -1,
      recordNames: Array.isArray(records) ? records.map(r => r && r.brush ? r.brush.name : null) : [],
      libCategories: lib && lib.customCategories ? lib.customCategories.map(c => c.name) : [],
    });
  })()`);
}

(async () => {
  let app = await start({ port: 9497, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-brush-a-' });
  try {
    const created = await app.json(`(() => {
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: true });
      const name = document.getElementById('nativeBrushCustomName');
      name.value = ${JSON.stringify(BRUSH_NAME)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = document.getElementById('nativeBrushCustomCreate');
      btn.click();
      return JSON.stringify({
        open: !document.getElementById('nativeBrushLibrary').hidden,
        hasName: !!name,
        hasBtn: !!btn,
      });
    })()`);
    console.log('open/creator:', created);
    await sleep(1200);
    const status = await app.evaluate(`document.getElementById('nativeBrushCreatorStatus')?.textContent || ''`);
    console.log('status:', status);
    const before = await readBrushes(app);
    console.log('brushes after create:', JSON.stringify(before));
    console.log('db after create:', JSON.stringify(await readDb(app)));
    const hasBefore = before.names.includes(BRUSH_NAME);
    console.log(hasBefore ? 'PASS create' : 'FAIL create');
  } finally {
    await app.stop();
  }

  console.log('--- yeniden açılış ---');
  app = await start({ port: 9499, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-brush-b-' });
  try {
    const after = await readBrushes(app);
    console.log('brushes after restart:', JSON.stringify(after));
    console.log('db after restart:', JSON.stringify(await readDb(app)));
    const hasAfter = after.names.includes(BRUSH_NAME);
    console.log(hasAfter ? 'PASS restart' : 'FAIL restart (fırça kayboldu)');
    const ui = await app.json(`(() => {
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: true });
      const cards = [...document.querySelectorAll('#nativeBrushList .nbBrushCard')]
        .map(c => (c.querySelector('.nbBrushName') || {}).textContent || '');
      return JSON.stringify({ count: cards.length, match: cards.some(t => t.includes(${JSON.stringify(BRUSH_NAME)})) });
    })()`);
    console.log('ui after restart:', JSON.stringify(ui));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
