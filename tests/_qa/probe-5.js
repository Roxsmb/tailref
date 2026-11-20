'use strict';

/* Odaklı sonda 5: bold + undo sonrası çok satırlı düzenleme. */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9491, appPort: 5353, prefix: 'tailref-probe5-' });
  const { json, evaluate, check } = h;

  const r = await json(`(async () => {
    __qa.reset();
    const id = __qa.text('HELLO', 420, 300);
    __qa.select([id]);
    document.getElementById('btnBold').click();
    const bold = !!getItem(id).bold;
    undo();
    const out = { bold, boldAfterUndo: !!getItem(id).bold, text: getItem(id).text };
    startEdit(getItem(id));
    out.editingId = editingId;
    const el = elMap.get(id).querySelector('.text');
    out.editable = el.contentEditable;
    el.focus();
    el.innerHTML = 'HELLO<br>WORLD';
    out.htmlAfter = el.innerHTML;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    out.modelAfterInput = getItem(id).text;
    commitEdit();
    out.modelAfterCommit = getItem(id).text;
    out.domAfterCommit = elMap.get(id).querySelector('.text').innerHTML;
    return JSON.stringify(out);
  })()`);
  console.log('bold+undo sonrası:', JSON.stringify(r));

  const r2 = await json(`(async () => {
    __qa.reset();
    const id = __qa.text('HELLO', 420, 300);
    startEdit(getItem(id));
    const el = elMap.get(id).querySelector('.text');
    el.focus();
    el.innerHTML = 'HELLO<br>WORLD';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const modelAfterInput = getItem(id).text;
    commitEdit();
    return JSON.stringify({ modelAfterInput, after: getItem(id).text });
  })()`);
  console.log('bold olmadan:', JSON.stringify(r2));

  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('sonda sayfasında hata yok', errs === '[]', errs);
  await h.finish();
})();
