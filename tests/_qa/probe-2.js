'use strict';

/* Odaklı sonda 2: satır sonu, kilitli silme, Escape hedefi. */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9484, appPort: 5346, prefix: 'tailref-probe2-' });
  const { json, evaluate, check } = h;

  /* 1 · Escape hangi hedefte çalışıyor? */
  const esc = await json(`(async () => {
    __qa.reset();
    const a = await __qa.image('#c33', 420, 360);
    const openMenu = () => {
      __qa.select([a]);
      const el = elMap.get(a);
      const rc = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
        clientX: rc.left + 20, clientY: rc.top + 20, button: 2 }));
    };
    const out = {};
    for (const target of ['body', 'stage', 'document', 'window']) {
      openMenu();
      await new Promise(r => setTimeout(r, 100));
      const menuEl = document.getElementById('contextMenu');
      const before = menuEl.hidden;
      const t = target === 'body' ? document.body : target === 'stage' ? stage
        : target === 'document' ? document : window;
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 120));
      out[target] = { before, closed: menuEl.hidden };
      if (!menuEl.hidden) hideContextMenu();
    }
    return JSON.stringify(out);
  })()`);
  console.log('Escape hedefleri:', JSON.stringify(esc));

  /* 2 · Shift+Enter ile gerçek satır sonu (execCommand) */
  const lines = await json(`(async () => {
    __qa.reset();
    const id = __qa.text('HELLO', 420, 320);
    startEdit(getItem(id));
    const el = elMap.get(id).querySelector('.text');
    el.focus();
    el.textContent = 'A';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const okExec = document.execCommand('insertLineBreak');
    const html = el.innerHTML;
    const tc = el.textContent;
    const it2 = el.innerText;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const model = getItem(id).text;
    commitEdit();
    return JSON.stringify({ okExec, html, textContent: tc, innerText: it2,
      model, afterCommit: getItem(id).text, h: getItem(id).h });
  })()`);
  console.log('satır sonu:', JSON.stringify(lines));

  /* 3 · kilitli silme: üç ayrı yol */
  const lock = await json(`(async () => {
    __qa.reset();
    const a = await __qa.image('#9c3', 420, 360);
    __qa.select([a]);
    toggleLockSelection();
    __qa.notices.length = 0;
    deleteSelection();
    const afterFn = { alive: !!getItem(a), trash: state.trash.length, notices: __qa.notices.slice() };
    undo();
    __qa.select([a]);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    const afterKey = { alive: !!getItem(a), trash: state.trash.length };
    undo();
    __qa.select([a]);
    document.getElementById('btnItemDel').click();
    const afterBtn = { alive: !!getItem(a), trash: state.trash.length };
    undo();
    return JSON.stringify({ afterFn, afterKey, afterBtn, aliveEnd: !!getItem(a),
      lockedEnd: getItem(a) ? !!getItem(a).locked : null });
  })()`);
  console.log('kilitli silme yolları:', JSON.stringify(lock));

  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('sonda sayfasında hata yok', errs === '[]', errs);
  await h.finish();
})();
