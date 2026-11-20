'use strict';

/* Odaklı sonda 7: contenteditable → model metin çevirisinde boş satırlar. */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9497, appPort: 5363, prefix: 'tailref-probe7-' });
  const { json, evaluate, check } = h;

  const r = await json(`(() => {
    const box = document.createElement('div');
    box.contentEditable = 'true';
    box.style.whiteSpace = 'pre-wrap';
    const conv = html => { box.innerHTML = html; return editableTextValue(box); };
    return JSON.stringify({
      br: conv('HELLO<br>WORLD'),
      div: conv('ONE<div>TWO</div>'),
      blankMid: conv('A<div><br></div><div>B</div>'),
      blankMid2: conv('<div>A</div><div><br></div><div>B</div>'),
      blankMid3: conv('A<div>B</div><div><br></div><div>C</div>'),
      blankStart: conv('<div><br></div><div>X</div>'),
      doubleBr: conv('A<br><br>B'),
      trailing: conv('<div>A</div><div><br></div>'),
    });
  })()`);
  console.log(JSON.stringify(r, null, 2));

  check('P7 · <br> yeni satır', r.br === 'HELLO\nWORLD', JSON.stringify(r.br));
  check('P7 · blok div yeni satır', r.div === 'ONE\nTWO', JSON.stringify(r.div));
  check('P7 · aradaki boş satır tek satır', r.blankMid === 'A\n\nB', JSON.stringify(r.blankMid));
  check('P7 · div ile aradaki boş satır tek satır', r.blankMid2 === 'A\n\nB', JSON.stringify(r.blankMid2));
  check('P7 · iki satır arası boş satır', r.blankMid3 === 'A\nB\n\nC', JSON.stringify(r.blankMid3));
  check('P7 · baştaki boş satır korunuyor', r.blankStart === '\nX', JSON.stringify(r.blankStart));
  check('P7 · çift <br> tek boş satır', r.doubleBr === 'A\n\nB', JSON.stringify(r.doubleBr));
  check('P7 · sondaki boş satır kırpılıyor', r.trailing === 'A', JSON.stringify(r.trailing));

  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('P7 · sayfada hata yok', errs === '[]', errs);

  await h.finish();
})();
