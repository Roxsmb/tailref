'use strict';
/* QA: kategori + PNG uçlu fırça + favori + silme kalıcılığı. */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { start, sleep } = require('./harness');

const APP_PORT = 5365;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-brush-persist2-'));
const stamp = Date.now();
const CAT_NAME = 'QA Kategori ' + stamp;
const BRUSH_A = 'QA Prosedürel ' + stamp;
const BRUSH_B = 'QA PNG Uçlu ' + stamp;
const BRUSH_C = 'QA Silinecek ' + stamp;

async function createProcedural(app, name, categoryId) {
  return app.json(`(() => {
    inkOpenNativeBrushLibrary(null, ${JSON.stringify(categoryId)}, { creatorOnly: true });
    const nameEl = document.getElementById('nativeBrushCustomName');
    nameEl.value = ${JSON.stringify(name)};
    nameEl.dispatchEvent(new Event('input', { bubbles: true }));
    const cat = document.getElementById('nativeBrushCustomCategory');
    cat.value = ${JSON.stringify(categoryId)};
    cat.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('nativeBrushCustomCreate').click();
    return JSON.stringify({ categoryValue: cat.value, name: nameEl.value });
  })()`);
}

async function createPngBrush(app, name) {
  const uploaded = await app.evaluate(`(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = '#000000'; x.beginPath(); x.arc(32, 32, 22, 0, Math.PI * 2); x.fill();
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'qa-tip.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById('nativeBrushCustomPng');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (inkNativeBrushUi.uploadedTip) break;
    }
    return JSON.stringify({ hasTip: !!inkNativeBrushUi.uploadedTip,
      tipId: inkNativeBrushUi.uploadedTip && inkNativeBrushUi.uploadedTip.tipId,
      size: inkNativeBrushUi.uploadedTip ? [inkNativeBrushUi.uploadedTip.width, inkNativeBrushUi.uploadedTip.height] : null });
  })()`);
  console.log('png upload:', uploaded);
  const r = await app.json(`(() => {
    const nameEl = document.getElementById('nativeBrushCustomName');
    nameEl.value = ${JSON.stringify(name)};
    nameEl.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('nativeBrushCustomCreate').click();
    return JSON.stringify({ name: nameEl.value });
  })()`);
  console.log('png create:', r);
}

async function snapshot(app) {
  return app.json(`(async () => {
    const ink = inkState();
    const custom = (ink.brushes || []).filter(b => /^custom-brush-/.test(b.id));
    const db = await idbGet('meta', 'ink:brushes');
    const lib = await idbGet('meta', 'ink:library');
    return JSON.stringify({
      custom: custom.map(b => ({ id: b.id, name: b.name, category: b.category, kind: b.kind, tipId: b.tipId || '' })),
      tips: custom.filter(b => b.tipId).map(b => ({ tipId: b.tipId, hasData: inkRuntime.importedTips.has(b.tipId) })),
      favorites: inkNativeLibrary.favorites.slice(),
      visibleCategories: inkNativeVisibleCategories().map(c => c.name),
      dbNames: Array.isArray(db) ? db.map(r => r && r.brush ? r.brush.name : null) : null,
      libCategories: lib && lib.customCategories ? lib.customCategories.map(c => c.name) : null,
    });
  })()`);
}

(async () => {
  let app = await start({ port: 9501, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-brush2-a-' });
  let ids = null;
  try {
    const cat = await app.json(`(async () => {
      const r = await inkNativeCreateCategory(${JSON.stringify(CAT_NAME)});
      inkNativeSyncCustomCreator();
      return JSON.stringify(r);
    })()`);
    console.log('category:', JSON.stringify(cat));
    const catId = cat.category && cat.category.id;

    console.log('create A:', await createProcedural(app, BRUSH_A, catId));
    await sleep(900);
    await createPngBrush(app, BRUSH_B);
    await sleep(900);
    await createProcedural(app, BRUSH_C, 'custom');
    await sleep(900);

    ids = await app.json(`(() => {
      const ink = inkState();
      const by = n => (ink.brushes || []).find(b => b.name === n) || null;
      return JSON.stringify({
        a: by(${JSON.stringify(BRUSH_A)}) && by(${JSON.stringify(BRUSH_A)}).id,
        b: by(${JSON.stringify(BRUSH_B)}) && by(${JSON.stringify(BRUSH_B)}).id,
        c: by(${JSON.stringify(BRUSH_C)}) && by(${JSON.stringify(BRUSH_C)}).id,
      });
    })()`);
    console.log('ids:', JSON.stringify(ids));

    const fav = await app.evaluate(`(async () => { await inkNativeToggleFavorite(${JSON.stringify(ids.a)}); return true; })()`);
    console.log('favorite A:', fav);

    const del = await app.evaluate(`(async () => {
      window.appConfirm = async () => true;
      return await inkNativeDeleteBrush(${JSON.stringify(ids.c)});
    })()`);
    console.log('delete C:', del);
    await sleep(900);
    console.log('before restart:', JSON.stringify(await snapshot(app)));
  } finally {
    await app.stop();
  }

  console.log('--- yeniden açılış ---');
  app = await start({ port: 9503, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-brush2-b-' });
  try {
    await sleep(1500);
    const snap = await snapshot(app);
    console.log('after restart:', JSON.stringify(snap));
    const names = snap.custom.map(b => b.name);
    console.log('A var:', names.includes(BRUSH_A));
    console.log('B var:', names.includes(BRUSH_B));
    console.log('C yok:', !names.includes(BRUSH_C));
    console.log('kategori var:', snap.visibleCategories.includes(CAT_NAME));
    console.log('favori korundu:', snap.favorites.includes(ids.a));
    const bRec = snap.custom.find(b => b.name === BRUSH_B);
    console.log('PNG ucu korundu:', !!(bRec && bRec.tipId && snap.tips.some(t => t.tipId === bRec.tipId && t.hasData)));
    const ui = await app.json(`(() => {
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: true });
      const cards = [...document.querySelectorAll('#nativeBrushList .nbBrushCard')].map(c => ({
        id: c.dataset.brushId,
        name: (c.querySelector('.nbBrushCard__name') || {}).textContent || '',
      }));
      return JSON.stringify({ count: cards.length, matchA: cards.some(c => c.name.includes(${JSON.stringify(BRUSH_A)})), matchB: cards.some(c => c.name.includes(${JSON.stringify(BRUSH_B)})) });
    })()`);
    console.log('ui:', JSON.stringify(ui));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
