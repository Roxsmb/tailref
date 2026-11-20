'use strict';

/* Odaklı sonda 6: geri alma sonrası DOM dinleyicileri güncel modele bağlı mı? */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9493, appPort: 5355, prefix: 'tailref-probe6-' });
  const { json, evaluate, check } = h;

  const drag = await json(`(async () => {
    __qa.reset();
    const a = await __qa.image('#c33', 300, 300);
    __qa.select([a]);
    __qa.dragItem(a, 40, 0);
    const x1 = getItem(a).x;
    undo();
    const x2 = getItem(a).x;
    /* undo sonrası tekrar sürükle */
    __qa.select([a]);
    __qa.dragItem(a, 70, 0);
    const x3 = getItem(a).x;
    return JSON.stringify({ x1: Math.round(x1), x2: Math.round(x2), x3: Math.round(x3) });
  })()`);
  console.log('undo sonrası sürükleme:', JSON.stringify(drag));

  const text = await json(`(async () => {
    __qa.reset();
    const a = await __qa.image('#3c3', 300, 300);
    const id = __qa.text('ONE', 500, 300);
    __qa.select([id]);
    document.getElementById('btnBold').click();
    undo();
    startEdit(getItem(id));
    const t = elMap.get(id).querySelector('.text');
    t.focus();
    t.textContent = 'TWO';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    commitEdit();
    const model = getItem(id).text;
    const dom = elMap.get(id).querySelector('.text').textContent;
    updateItemEl(getItem(id), elMap.get(id));
    const domAfterSync = elMap.get(id).querySelector('.text').textContent;
    return JSON.stringify({ model, dom, domAfterSync });
  })()`);
  console.log('undo sonrası metin düzenleme:', JSON.stringify(text));

  const resize = await json(`(async () => {
    __qa.reset();
    const a = await __qa.image('#48c', 320, 320);
    __qa.select([a]);
    const w0 = getItem(a).w;
    __qa.dragHandle(elMap.get(a).querySelector('.handle.se'), 60, 0);
    const w1 = getItem(a).w;
    undo();
    const w2 = getItem(a).w;
    __qa.select([a]);
    __qa.dragHandle(elMap.get(a).querySelector('.handle.se'), 90, 0);
    const w3 = getItem(a).w;
    return JSON.stringify({ w0: Math.round(w0), w1: Math.round(w1), w2: Math.round(w2), w3: Math.round(w3) });
  })()`);
  console.log('undo sonrası boyutlandırma:', JSON.stringify(resize));

  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('sonda sayfasında hata yok', errs === '[]', errs);
  await h.finish();
})();
