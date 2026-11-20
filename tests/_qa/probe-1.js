'use strict';

/* Odaklı sonda: A turundaki şüpheli bulguları ayıklamak için. */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9483, appPort: 5345, prefix: 'tailref-probe1-' });
  const { json, evaluate, check } = h;

  /* 1 · bağlam menüsü Escape */
  const menu = await json(`(async () => {
    __qa.reset();
    const a = await __qa.image('#c33', 420, 360);
    __qa.select([a]);
    const el = elMap.get(a);
    const rc = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: rc.left + 20, clientY: rc.top + 20, button: 2 }));
    await new Promise(r => setTimeout(r, 150));
    const menuEl = document.getElementById('contextMenu');
    const out = { openHidden: menuEl.hidden, openVisible: isPanelVisible(menuEl),
      active: document.activeElement && (document.activeElement.id || document.activeElement.tagName) };
    menuEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 150));
    out.afterMenuEsc = menuEl.hidden;
    if (!menuEl.hidden) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      out.afterDocEsc = menuEl.hidden;
    }
    if (!menuEl.hidden) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      out.afterWinEsc = menuEl.hidden;
    }
    return JSON.stringify(out);
  })()`);
  console.log('menü Escape:', JSON.stringify(menu));

  /* 2 · kilitli silme: düğme ve sağ tık yolu */
  const lock = await json(`(async () => {
    __qa.reset();
    const a = await __qa.image('#9c3', 420, 360);
    __qa.select([a]);
    toggleLockSelection();
    __qa.notices.length = 0;
    document.getElementById('btnItemDel').click();
    await new Promise(r => setTimeout(r, 200));
    const aliveBtn = !!getItem(a);
    const noticesBtn = __qa.notices.slice();
    if (!aliveBtn) { undo(); __qa.select([a]); }
    return JSON.stringify({ aliveBtn, noticesBtn, trash: state.trash.length, aliveNow: !!getItem(a) });
  })()`);
  console.log('kilitli silme:', JSON.stringify(lock));

  /* 3 · çok satırlı metin gerçek akışı */
  const text = await json(`(async () => {
    __qa.reset();
    const id = __qa.text('HELLO', 420, 320);
    startEdit(getItem(id));
    const el = elMap.get(id).querySelector('.text');
    el.focus();
    el.innerHTML = 'A<br>B';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    commitEdit();
    return JSON.stringify({ text: getItem(id).text, lines: String(getItem(id).text).split('\\n').length });
  })()`);
  console.log('metin satır:', JSON.stringify(text));

  /* 4 · filtre ve kırpma hangi DOM düğümünde */
  const media = await json(`(async () => {
    __qa.reset();
    const a = await __qa.image('#48c', 420, 360);
    __qa.select([a]);
    document.getElementById('btnEditImage').click();
    await new Promise(r => setTimeout(r, 250));
    const bright = document.getElementById('fBright');
    bright.value = '150';
    bright.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const root = elMap.get(a);
    const info = {
      fBright: getItem(a).fBright,
      rootFilter: root.style.filter || '',
      mediaFilter: root.querySelector('.media')?.style.filter || '',
      imgFilter: root.querySelector('img')?.style.filter || '',
    };
    document.getElementById('cropTop').value = '10';
    document.getElementById('cropTop').dispatchEvent(new Event('input', { bubbles: true }));
    applyCrop();
    info.clipMedia = root.querySelector('.media')?.style.clipPath || '';
    info.clipImg = root.querySelector('img')?.style.clipPath || '';
    return JSON.stringify(info);
  })()`);
  console.log('filtre/kırpma:', JSON.stringify(media));

  /* 5 · bağlantı çizimi hangi düğümde */
  const link = await json(`(async () => {
    __qa.reset();
    const a = await __qa.image('#c33', 300, 300);
    const b = await __qa.image('#3c3', 700, 300);
    __qa.select([a, b]);
    toggleLink();
    const layer = document.getElementById('linkLayer');
    const kids = [...layer.children].map(n => n.tagName + (n.getAttribute('class') ? '.' + n.getAttribute('class') : ''));
    const line = layer.querySelector('line');
    const before = line ? [line.getAttribute('x2'), line.getAttribute('y2')] : null;
    __qa.select([b]);
    __qa.dragItem(b, 0, 120);
    await new Promise(r => setTimeout(r, 400));
    const after = line ? [line.getAttribute('x2'), line.getAttribute('y2')] : null;
    return JSON.stringify({ kids, before, after, changed: JSON.stringify(before) !== JSON.stringify(after) });
  })()`);
  console.log('bağlantı:', JSON.stringify(link));

  /* 6 · ok tuşu normal/shift */
  const arrows = await json(`(async () => {
    __qa.reset();
    const a = await __qa.image('#c33', 380, 320);
    __qa.select([a]);
    const k = (extra) => document.body.dispatchEvent(new KeyboardEvent('keydown',
      Object.assign({ key: 'ArrowRight', bubbles: true, cancelable: true }, extra)));
    const x0 = getItem(a).x;
    k({});
    const plain = getItem(a).x - x0;
    k({ shiftKey: true });
    const shifted = getItem(a).x - x0;
    return JSON.stringify({ plain, shifted });
  })()`);
  console.log('ok tuşu:', JSON.stringify(arrows));

  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('sonda sayfasında hata yok', errs === '[]', errs);
  await h.finish();
})();
