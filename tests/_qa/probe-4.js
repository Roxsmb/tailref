'use strict';

/* Odaklı sonda 4: satır sonu modeli (Shift+Enter <br> / Enter <div>). */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9489, appPort: 5351, prefix: 'tailref-probe4-' });
  const { json, evaluate, check } = h;

  const r = await json(`(async () => {
    __qa.reset();
    const id = __qa.text('HELLO', 420, 320);
    startEdit(getItem(id));
    const t = elMap.get(id).querySelector('.text');
    t.focus();
    const h1 = getItem(id).h;
    /* Chromium Shift+Enter çıktısı: <br> */
    t.innerHTML = 'A<br>B';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    const brModel = getItem(id).text;
    const hBr = getItem(id).h;
    /* Chromium Enter çıktısı: blok div */
    t.innerHTML = '<div>A</div><div>B</div>';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    const divModel = getItem(id).text;
    commitEdit();
    const committed = getItem(id).text;
    /* model -> DOM yeniden çizimi satırları koruyor mu? */
    updateItemEl(getItem(id), elMap.get(id));
    const domText = elMap.get(id).querySelector('.text').textContent;
    return JSON.stringify({ h1, brModel, hBr, divModel, committed, domText,
      lines: String(committed).split('\\n').length });
  })()`);
  console.log('satır modeli:', JSON.stringify(r));

  check('sonda · <br> yeni satır olarak modele yazılıyor', r.brModel === 'A\nB', JSON.stringify(r.brModel));
  check('sonda · blok div yeni satır olarak modele yazılıyor', r.divModel === 'A\nB', JSON.stringify(r.divModel));
  check('sonda · iki satır modelde ve DOM\'da korunuyor',
    r.lines === 2 && r.domText === 'A\nB', JSON.stringify({ lines: r.lines, dom: r.domText }));

  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('sonda sayfasında hata yok', errs === '[]', errs);
  await h.finish();
})();
