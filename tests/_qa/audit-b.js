'use strict';

/* Tur B — Çizim çalışma alanı: gerçek kullanıcı oturumu (yeni tuval →
   çiz → katmanlar → zoom → kapat → yeniden yükle → geri aç). */

const { start } = require('./harness');

const OPEN_CANVAS = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  if (typeof inkEditorIsOpen === 'function' && inkEditorIsOpen()) {
    if (typeof inkExitImageScope === 'function') inkExitImageScope();
  }
  if (typeof modeExitDraw === 'function') modeExitDraw();
  if (typeof inkCloseTransientUi === 'function') inkCloseTransientUi();
  selection.clear(); selectionOrder = []; syncSelection();
  const modal = document.getElementById('newCanvasModal');
  modal.hidden = true;
  await wait(320);
  document.getElementById('modeDrawBtn').click();
  await wait(420);
  const opened = !modal.hidden;
  document.getElementById('newCanvasW').value = '400';
  document.getElementById('newCanvasH').value = '300';
  document.getElementById('newCanvasName').value = 'QA Cizim';
  const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
  if (bg) bg.checked = true;
  document.getElementById('newCanvasForm').requestSubmit();
  for (let i = 0; i < 80 && !inkEditorIsOpen(); i++) await wait(120);
  await wait(500);
  const ui = inkEditorUi;
  const docId = typeof inkDocOwnerId === 'function' ? inkDocOwnerId() : null;
  return JSON.stringify({ opened, open: inkEditorIsOpen(), itemId: ui.itemId || null,
    docId, layers: docId ? inkDocLayers(docId).length : 0,
    itemKind: ui.itemId ? (getItem(ui.itemId) || {}).kind : null,
    w: ui.itemId ? Math.round((getItem(ui.itemId) || {}).w || 0) : 0 });
})()`;

(async () => {
  const h = await start({ port: 9487, appPort: 5349, prefix: 'tailref-audit-b-' });
  const { json, evaluate, check, scenario } = h;

  let itemId = null;

  /* ---------- B1 · yeni tuval ---------- */
  await scenario('B1 yeni tuval', async () => {
    const r = await json(OPEN_CANVAS);
    itemId = r.itemId;
    check('B1 · yeni tuval sihirbazı editörü açıyor, katman hazır',
      r.opened === true && r.open === true && !!r.itemId && r.layers >= 1 && r.itemKind === 'image',
      JSON.stringify(r));
    check('B1 · tuval 400×300 boyutunda', Math.abs(r.w - 400) < 2, String(r.w));
  });

  /* ---------- B2 · vuruş + geri al/yinele ---------- */
  await scenario('B2 vuruş', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ui = inkEditorUi, f = ui.fit;
      const cx = Math.round(f.x + f.w * 0.5), cy = Math.round(f.y + f.h * 0.5);
      const ink = inkState(); ink.color = '#22cc44'; ink.size = 34; ink.opacity = 1;
      inkSetTool('brush');
      if (typeof inkSyncUI === 'function') inkSyncUI();
      const surf = document.getElementById('inkEditorCanvas');
      const mk = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 8801,
        pointerType: 'pen', isPrimary: true, pressure: 0.9,
        clientX: x, clientY: y, button: 0, buttons,
      });
      const layer = inkActiveLayer();
      const n0 = (layer.strokes || []).length;
      surf.dispatchEvent(mk('pointerdown', cx - 40, cy, 1));
      for (let i = 1; i <= 8; i++) surf.dispatchEvent(mk('pointermove', cx - 40 + i * 10, cy + (i % 2 ? 6 : -6), 1));
      surf.dispatchEvent(mk('pointerup', cx + 40, cy, 0));
      await wait(1100);
      const n1 = (inkActiveLayer().strokes || []).length;
      const peek = typeof inkEditorEyePeek === 'function' ? inkEditorEyePeek(cx, cy) : null;
      undo();
      await wait(700);
      const n2 = (inkActiveLayer().strokes || []).length;
      redo();
      await wait(700);
      const n3 = (inkActiveLayer().strokes || []).length;
      return JSON.stringify({ n0, n1, n2, n3, peek });
    })()`);
    check('B2 · fırça vuruşu katmana yazılıyor ve görünür',
      r.n1 === r.n0 + 1 && /^#[0-9a-f]{6}$/i.test(r.peek || ''), JSON.stringify(r));
    check('B2 · Ctrl+Z vuruşu geri alıyor, Ctrl+Shift+Z yineliyor',
      r.n2 === r.n0 && r.n3 === r.n0 + 1, JSON.stringify({ n0: r.n0, undo: r.n2, redo: r.n3 }));
  });

  /* ---------- B3 · silgi ---------- */
  await scenario('B3 silgi', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ui = inkEditorUi, f = ui.fit;
      const cx = Math.round(f.x + f.w * 0.5), cy = Math.round(f.y + f.h * 0.5);
      const layer = inkActiveLayer();
      const before = inkEditorEyePeek(cx, cy);
      inkSetTool('eraser');
      const ink = inkState(); ink.size = 40;
      if (typeof inkSyncUI === 'function') inkSyncUI();
      const surf = document.getElementById('inkEditorCanvas');
      const mk = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 8802,
        pointerType: 'pen', isPrimary: true, pressure: 0.9,
        clientX: x, clientY: y, button: 0, buttons,
      });
      surf.dispatchEvent(mk('pointerdown', cx - 30, cy, 1));
      surf.dispatchEvent(mk('pointermove', cx, cy, 1));
      surf.dispatchEvent(mk('pointerup', cx + 30, cy, 0));
      await wait(1100);
      const erased = inkEditorEyePeek(cx, cy);
      undo();
      await wait(700);
      const restored = inkEditorEyePeek(cx, cy);
      inkSetTool('brush');
      return JSON.stringify({ before, erased, restored });
    })()`);
    check('B3 · silgi pikselleri siliyor',
      /^#[0-9a-f]{6}$/i.test(r.before || '') && r.erased !== r.before,
      JSON.stringify({ before: r.before, erased: r.erased }));
    check('B3 · undo silinen pikselleri geri getiriyor',
      r.restored === r.before, JSON.stringify({ restored: r.restored, before: r.before }));
  });

  /* ---------- B4 · katman ekle / gizle / sil ---------- */
  await scenario('B4 katman', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const docId = inkDocOwnerId();
      const n0 = inkDocLayers(docId).length;
      document.getElementById('btnInkAddLayer').click();
      await wait(350);
      const n1 = inkDocLayers(docId).length;
      const layer = inkActiveLayer();
      /* yeni katmana kırmızı vuruş */
      const ui = inkEditorUi, f = ui.fit;
      const cx = Math.round(f.x + f.w * 0.35), cy = Math.round(f.y + f.h * 0.35);
      const ink = inkState(); ink.color = '#cc2222'; ink.size = 36; ink.opacity = 1;
      inkSetTool('brush'); if (typeof inkSyncUI === 'function') inkSyncUI();
      const surf = document.getElementById('inkEditorCanvas');
      const mk = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 8803,
        pointerType: 'pen', isPrimary: true, pressure: 0.9,
        clientX: x, clientY: y, button: 0, buttons });
      surf.dispatchEvent(mk('pointerdown', cx - 30, cy, 1));
      surf.dispatchEvent(mk('pointermove', cx, cy, 1));
      surf.dispatchEvent(mk('pointerup', cx + 30, cy, 0));
      await wait(1000);
      const drawn = (layer.strokes || []).length;
      const peekOn = inkEditorEyePeek(cx, cy);
      /* göz düğmesiyle gizle */
      const row = document.querySelector('.inkLayerRow[data-layer-id="' + layer.id + '"]');
      const eye = row && row.querySelector('.inkLayerEye');
      if (eye) eye.click();
      await wait(600);
      const peekOff = inkEditorEyePeek(cx, cy);
      const hidden = inkLayerById(layer.id).visible === false;
      /* geri aç ve katmanı sil */
      if (eye) eye.click();
      await wait(400);
      inkSetActiveLayer(layer.id);
      document.getElementById('btnInkDeleteLayer').click();
      await wait(450);
      const n2 = inkDocLayers(docId).length;
      undo();
      await wait(450);
      const n3 = inkDocLayers(docId).length;
      return JSON.stringify({ n0, n1, drawn, peekOn, peekOff, hidden, n2, n3 });
    })()`);
    check('B4 · katman ekleme çalışıyor', r.n1 === r.n0 + 1, JSON.stringify({ n0: r.n0, n1: r.n1 }));
    check('B4 · katman gizleme kompoziti değiştiriyor',
      r.hidden === true && r.peekOn !== r.peekOff, JSON.stringify({ on: r.peekOn, off: r.peekOff, hidden: r.hidden }));
    check('B4 · katman silme ve undo sayıyı geri getiriyor',
      r.n2 === r.n1 - 1 && r.n3 === r.n1, JSON.stringify({ n1: r.n1, del: r.n2, undo: r.n3 }));
  });

  /* ---------- B5 · araç kısayolları ---------- */
  await scenario('B5 araç tuşları', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const press = (key, code) => document.body.dispatchEvent(new KeyboardEvent('keydown',
        { key, code, bubbles: true, cancelable: true }));
      press('e', 'KeyE');
      await wait(120);
      const eraser = inkState().tool;
      press('b', 'KeyB');
      await wait(120);
      const brush = inkState().tool;
      press('i', 'KeyI');
      await wait(120);
      const eyedrop = inkState().tool;
      press('b', 'KeyB');
      await wait(120);
      return JSON.stringify({ eraser, brush, eyedrop, back: inkState().tool });
    })()`);
    check('B5 · çizimde E/B/I araç kısayolları çalışıyor',
      r.eraser === 'eraser' && r.brush === 'brush' && r.eyedrop === 'eyedropper' && r.back === 'brush',
      JSON.stringify(r));
  });

  /* ---------- B6 · zoom ve sığdır ---------- */
  await scenario('B6 zoom', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ui = inkEditorUi;
      const z0 = ui.view.zoom;
      const surf = document.getElementById('inkEditorCanvas');
      surf.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
        ctrlKey: true, deltaY: -120, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
      await wait(250);
      const z1 = ui.view.zoom;
      if (typeof inkEditorZoomFit === 'function') inkEditorZoomFit();
      await wait(250);
      const z2 = ui.view.zoom;
      /* sığdırdıktan sonra merkez hâlâ tuval ortasına denk gelmeli */
      const f = ui.fit;
      const cx = Math.round(f.x + f.w * 0.5), cy = Math.round(f.y + f.h * 0.5);
      const g = inkEditorGatePoint(cx, cy);
      const size = inkEditorItemSize();
      const nx = (g.x - f.x) / f.w, ny = (g.y - f.y) / f.h;
      return JSON.stringify({ z0, z1, z2, cx, cy, g, nx, ny, docW: size.w, docH: size.h });
    })()`);
    check('B6 · tekerlek zoom yapıyor, sığdır gerçek ölçek veriyor',
      r.z1 !== r.z0 && r.z2 > 0, JSON.stringify({ z0: r.z0, wheel: r.z1, fit: r.z2 }));
    check('B6 · zoom sonrası ekran→tuval eşlemesi merkezde',
      Math.abs(r.nx - 0.5) < 0.02 && Math.abs(r.ny - 0.5) < 0.02,
      JSON.stringify({ nx: r.nx, ny: r.ny, g: r.g, doc: [r.docW, r.docH] }));
  });

  /* ---------- B7 · kapat → tahtada görünüm ---------- */
  await scenario('B7 kapat', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const id = inkEditorUi.itemId;
      document.getElementById('btnInkScopeExit').click();
      await wait(500);
      if (typeof modeExitDraw === 'function') modeExitDraw();
      await wait(600);
      const it = getItem(id);
      const el = elMap.get(id);
      const composite = typeof inkCompositePaintPlanToContext === 'function';
      return JSON.stringify({ closed: !inkEditorIsOpen(), alive: !!it, kind: it && it.kind,
        mode: document.getElementById('appModeBar').dataset.mode,
        elChildren: el ? [...el.querySelectorAll('canvas')].length : 0, composite });
    })()`);
    check('B7 · editör kapanıyor, öğe tahtada kalıyor',
      r.closed === true && r.alive === true && r.mode !== 'draw', JSON.stringify(r));
  });

  /* ---------- B8 · yeniden yükleme sonrası çizim kalıcı ---------- */
  await scenario('B8 kalıcılık', async () => {
    await evaluate(`(async () => { await new Promise(r => setTimeout(r, 2200)); return true; })()`);
    await h.reload();
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const id = ${JSON.stringify(itemId)};
      const it = getItem(id);
      if (!it) return JSON.stringify({ alive: false });
      if (typeof modeEnterDraw === 'function') modeEnterDraw(id);
      for (let i = 0; i < 80 && !inkEditorIsOpen(); i++) await wait(120);
      await wait(700);
      const docId = inkDocOwnerId();
      const layers = inkDocLayers(docId);
      const strokes = layers.reduce((s, l) => s + (l.strokes || []).length, 0);
      const f = inkEditorUi.fit;
      const cx = Math.round(f.x + f.w * 0.5), cy = Math.round(f.y + f.h * 0.5);
      const peek = typeof inkEditorEyePeek === 'function' ? inkEditorEyePeek(cx, cy) : null;
      return JSON.stringify({ alive: true, open: inkEditorIsOpen(), layers: layers.length, strokes, peek });
    })()`);
    check('B8 · çizim yeniden yüklemede katman/vuruş olarak korunuyor',
      r.alive === true && r.open === true && r.strokes >= 1, JSON.stringify(r));
    check('B8 · yeniden açılan çizimde piksel görünür',
      /^#[0-9a-f]{6}$/i.test(r.peek || '') && r.peek !== '#000000', String(r.peek));
  });

  /* ---------- B9 · çizimden çıkış temizliği ---------- */
  await scenario('B9 çıkış', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('btnInkScopeExit').click();
      await wait(400);
      if (typeof modeExitDraw === 'function') modeExitDraw();
      await wait(500);
      return JSON.stringify({ closed: !inkEditorIsOpen(),
        scope: typeof inkRuntime !== 'undefined' ? inkRuntime.imageScopeId : null,
        bodyClass: document.body.classList.contains('ink-editor-open'),
        tool: inkState().tool });
    })()`);
    check('B9 · çıkışta editör kapanıyor, kapsam ve gövde sınıfı temizleniyor',
      r.closed === true && r.scope === null && r.bodyClass === false, JSON.stringify(r));
  });

  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('B10 · sayfada hata yok', errs === '[]', errs);

  await h.shot(require('path').join(require('os').tmpdir(), 'opencode', 'audit-b.png'));
  await h.finish();
})();
