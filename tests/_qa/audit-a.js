'use strict';

/* Tur A — Referans tahtası kapsamlı kullanıcı akışı denetimi. */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9481, appPort: 5343, prefix: 'tailref-audit-a-' });
  const { json, evaluate, check, scenario } = h;

  /* ---------- A1 · çoklu seçim sürükleme + tek undo ---------- */
  await scenario('A1 çoklu sürükleme', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#c33', 300, 300);
      const b = await __qa.image('#3c3', 640, 300);
      const c = await __qa.image('#33c', 470, 540);
      __qa.select([a, b, c]);
      const x0 = [a, b, c].map(id => getItem(id).x);
      __qa.dragItem(a, 60, 40);
      const x1 = [a, b, c].map(id => getItem(id).x);
      undo();
      const x2 = [a, b, c].map(id => getItem(id).x);
      return JSON.stringify({ n: state.items.length, x0, x1, x2 });
    })()`);
    check('A1 · sürükleme seçimin tamamını taşıyor',
      r.x1.every((v, i) => Math.abs(v - r.x0[i] - 60) < 2), JSON.stringify(r.x1.map((v, i) => Math.round(v - r.x0[i]))));
    check('A1 · tek Ctrl+Z hepsini geri alıyor',
      r.x2.every((v, i) => Math.abs(v - r.x0[i]) < 1), JSON.stringify(r.x2.map((v, i) => Math.round(v - r.x0[i]))));
  });

  /* ---------- A2 · grup taşıma / çözme / undo ---------- */
  await scenario('A2 grup', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#c33', 320, 320);
      const b = await __qa.image('#3c3', 700, 320);
      __qa.select([a, b]);
      groupSelection();
      const gid = getItem(a).groupId;
      const x0 = [getItem(a).x, getItem(b).x];
      __qa.dragItem(a, 50, 30);
      const x1 = [getItem(a).x, getItem(b).x];
      __qa.select([a, b]);
      groupSelection();            // tek grup seçili → çöz
      const dissolved = !getItem(a).groupId && !getItem(b).groupId;
      undo();
      const regrouped = getItem(a).groupId === gid && getItem(b).groupId === gid;
      return JSON.stringify({ gid, x0, x1, dissolved, regrouped, z: state.items.length });
    })()`);
    check('A2 · grup üyeleri birlikte taşınıyor',
      Math.abs(r.x1[0] - r.x0[0] - 50) < 2 && Math.abs(r.x1[1] - r.x0[1] - 50) < 2, JSON.stringify(r.x1.map((v, i) => Math.round(v - r.x0[i]))));
    check('A2 · grup çözülüyor ve undo grubu geri kuruyor',
      r.dissolved === true && r.regrouped === true, JSON.stringify({ dissolved: r.dissolved, regrouped: r.regrouped }));
  });

  /* ---------- A3 · çoğalt / sil / çöpten geri al ---------- */
  await scenario('A3 çöp', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#c93', 420, 360);
      __qa.select([a]);
      duplicateSelection();
      const afterDup = state.items.length;
      deleteSelection();
      const trash = state.trash.length;
      const afterDel = state.items.length;
      await restoreAllTrash();
      await new Promise(r => setTimeout(r, 400));
      return JSON.stringify({ afterDup, trash, afterDel,
        restored: state.items.length, trashAfter: state.trash.length });
    })()`);
    check('A3 · çoğalt + sil + çöpten geri yükleme tutarlı',
      r.afterDup === 2 && r.trash === 1 && r.afterDel === 1 && r.restored === 2 && r.trashAfter === 0,
      JSON.stringify(r));
  });

  /* ---------- A4 · metin biçimlendirme ve iptal ---------- */
  await scenario('A4 metin', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const id = __qa.text('HELLO', 420, 300);
      __qa.select([id]);
      document.getElementById('btnBold').click();
      const bold = !!getItem(id).bold;
      const fw = getComputedStyle(elMap.get(id).querySelector('.text')).fontWeight;
      undo();
      const boldAfterUndo = !!getItem(id).bold;
      const textAfterUndo = getItem(id).text;
      /* çok satırlı düzenleme: Chromium Shift+Enter'ın ürettiği <br> yolu */
      startEdit(getItem(id));
      const el = elMap.get(id).querySelector('.text');
      el.focus();
      el.innerHTML = 'HELLO<br>WORLD';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      commitEdit();
      const multi = getItem(id).text;
      const lines = String(multi).split('\\n').length;
      const h0 = getItem(id).h;
      /* Escape düzenlemeyi bitirmeli (keymap sözleşmesi: commit) */
      startEdit(getItem(id));
      const el2 = elMap.get(id).querySelector('.text');
      el2.textContent = 'ZZZ';
      el2.dispatchEvent(new Event('input', { bubbles: true }));
      el2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const afterEsc = getItem(id).text;
      return JSON.stringify({ bold, fw, boldAfterUndo, textAfterUndo, multi, lines, h0, afterEsc });
    })()`);
    check('A4 · kalınlaştırma uygulanıyor ve tek undo ile geri alınıyor',
      r.bold === true && r.boldAfterUndo === false && r.textAfterUndo === 'HELLO', JSON.stringify(r));
    check('A4 · çok satırlı metin modelde korunuyor, Escape düzenlemeyi bitiriyor',
      r.multi === 'HELLO\nWORLD' && r.lines === 2 && r.afterEsc === 'ZZZ',
      JSON.stringify({ multi: r.multi, lines: r.lines, afterEsc: r.afterEsc }));
  });

  /* ---------- A5 · görsel filtreleri ---------- */
  await scenario('A5 filtre', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#48c', 420, 360);
      __qa.select([a]);
      document.getElementById('btnEditImage').click();
      await new Promise(r => setTimeout(r, 300));
      const ed = document.getElementById('imageEditor');
      const open = !ed.hidden;
      const bright = document.getElementById('fBright');
      bright.value = '150';
      bright.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      const f = getItem(a).fBright;
      const css = elMap.get(a).querySelector('.media')?.style.filter || '';
      const steps0 = undoStack.length;
      undo();
      return JSON.stringify({ open, f, css, steps0, after: getItem(a).fBright,
        closed: document.getElementById('imageEditor').hidden });
    })()`);
    check('A5 · parlaklık kaydırıcısı öğeye işliyor ve undo geri alıyor',
      r.open === true && r.f === 150 && /brightness/.test(r.css) && (r.after === undefined || r.after === 100),
      JSON.stringify(r));
    await evaluate(`document.getElementById('btnImageEditorClose').click(); true`);
  });

  /* ---------- A6 · kırpma ---------- */
  await scenario('A6 kırpma', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#c48', 420, 360);
      __qa.select([a]);
      document.getElementById('btnEditImage').click();
      await new Promise(r => setTimeout(r, 300));
      const top = document.getElementById('cropTop');
      top.value = '12';
      top.dispatchEvent(new Event('input', { bubbles: true }));
      applyCrop();
      const crop = getItem(a).cropTop;
      const clip = elMap.get(a).querySelector('.media')?.style.clipPath || '';
      undo();
      return JSON.stringify({ crop, clip, after: getItem(a).cropTop || 0 });
    })()`);
    check('A6 · kırpma uygulanıyor (clip-path) ve undo geri alıyor',
      r.crop === 12 && /inset/.test(r.clip) && r.after === 0, JSON.stringify(r));
    await evaluate(`document.getElementById('btnImageEditorClose').click(); true`);
  });

  /* ---------- A7 · katman sırası ---------- */
  await scenario('A7 sıra', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#c33', 300, 300);
      const b = await __qa.image('#3c3', 520, 300);
      const c = await __qa.image('#33c', 740, 300);
      __qa.select([a, b]);
      bringToFront();
      const zFront = [a, b].every(id => getItem(id).z > getItem(c).z);
      __qa.select([a, b]);
      sendToBack();
      const zBack = [a, b].every(id => getItem(id).z < getItem(c).z);
      const domOrder = [...document.getElementById('world').children]
        .filter(el => el.dataset && el.dataset.id)
        .map(el => el.dataset.id);
      return JSON.stringify({ zFront, zBack, domOrder, order: state.items.map(i => i.id) });
    })()`);
    check('A7 · çoklu seçimde öne/arkaya gönder tüm seçimi kapsıyor',
      r.zFront === true && r.zBack === true, JSON.stringify({ zFront: r.zFront, zBack: r.zBack }));
  });

  /* ---------- A8 · kilitli öğe silinmiyor ---------- */
  await scenario('A8 kilit', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#9c3', 420, 360);
      const b = await __qa.image('#3c9', 760, 360);
      __qa.select([a]);
      toggleLockSelection();
      __qa.select([a, b]);
      __qa.notices.length = 0;
      deleteSelection();
      await new Promise(r => setTimeout(r, 300));
      const lockedAlive = !!getItem(a);
      const freeGone = !getItem(b);
      const notices = JSON.stringify(__qa.notices);
      /* tek başına kilitli: hiçbir şey silinmemeli */
      __qa.select([a]);
      __qa.notices.length = 0;
      deleteSelection();
      await new Promise(r => setTimeout(r, 200));
      const soloAlive = !!getItem(a);
      const soloNotices = JSON.stringify(__qa.notices);
      undo();
      return JSON.stringify({ lockedAlive, freeGone, notices, soloAlive, soloNotices,
        trash: state.trash.length, alive: !!getItem(a) });
    })()`);
    check('A8 · kilitli öğe silinmiyor, serbest öğe siliniyor, uyarı veriliyor',
      r.lockedAlive === true && r.freeGone === true && /lock/i.test(r.notices) &&
      r.soloAlive === true && /lock/i.test(r.soloNotices), JSON.stringify(r));
  });

  /* ---------- A9 · zoom sınırları + sığdır ---------- */
  await scenario('A9 zoom', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      await __qa.image('#48c', 400, 300);
      const w = (dy, n) => { for (let i = 0; i < n; i++) stage.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY: dy, clientX: 500, clientY: 300, ctrlKey: true })); };
      w(-120, 80);
      const hi = state.view.scale;
      w(120, 200);
      const lo = state.view.scale;
      fitAll();
      const fit = state.view.scale;
      return JSON.stringify({ hi, lo, fit });
    })()`);
    check('A9 · tekerlek zoom üst sınırda kırpılıyor', Math.abs(r.hi - 40) < 0.001, String(r.hi));
    check('A9 · tekerlek zoom alt sınırda kırpılıyor', Math.abs(r.lo - 0.02) < 0.0005, String(r.lo));
    check('A9 · sığdır görünümü makul ölçek veriyor', r.fit > 0.02 && r.fit <= 40, String(r.fit));
  });

  /* ---------- A10 · bağlantı oku ---------- */
  await scenario('A10 bağlantı', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#c33', 300, 300);
      const b = await __qa.image('#3c3', 700, 300);
      __qa.select([a, b]);
      toggleLink();
      const n0 = state.links.length;
      const lineEl = document.querySelector('#linkLayer line');
      const path0 = lineEl ? lineEl.getAttribute('x2') + ',' + lineEl.getAttribute('y2') : '';
      __qa.select([b]);
      __qa.dragItem(b, 0, 120);
      await new Promise(r => setTimeout(r, 300));
      const path1 = lineEl ? lineEl.getAttribute('x2') + ',' + lineEl.getAttribute('y2') : '';
      deleteSelection();
      await new Promise(r => setTimeout(r, 500));
      return JSON.stringify({ n0, changed: path0 !== path1, path0, path1,
        pathsAfter: document.querySelectorAll('#linkLayer line').length,
        linksAfter: state.links.length });
    })()`);
    check('A10 · bağlantı oluşuyor ve öğeyle birlikte güncelleniyor',
      r.n0 === 1 && r.changed === true, JSON.stringify({ n0: r.n0, changed: r.changed }));
    check('A10 · hedef silinince bağlantı çizilmiyor',
      r.pathsAfter === 0, JSON.stringify({ paths: r.pathsAfter, links: r.linksAfter }));
  });

  /* ---------- A11 · sağ tık menüsü ---------- */
  await scenario('A11 menü', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#c33', 420, 360);
      __qa.select([a]);
      const el = elMap.get(a);
      const rc = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
        clientX: rc.left + 20, clientY: rc.top + 20, button: 2 }));
      await new Promise(r => setTimeout(r, 120));
      const menu = document.getElementById('contextMenu');
      const visible = !menu.hidden;
      const items = [...menu.querySelectorAll('.menuItem')].map(b => b.textContent.trim());
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      return JSON.stringify({ visible, count: items.length, items,
        closed: document.getElementById('contextMenu').hidden });
    })()`);
    check('A11 · sağ tık menüsü açılıyor, girdiler var, Escape kapatıyor',
      r.visible === true && r.count >= 5 && r.closed === true, JSON.stringify({ visible: r.visible, count: r.count, closed: r.closed }));
  });

  /* ---------- A12 · klavye kısayolları ---------- */
  await scenario('A12 kısayol', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#c33', 380, 320);
      const b = await __qa.image('#3c3', 700, 320);
      const key = (k, extra) => document.body.dispatchEvent(new KeyboardEvent('keydown',
        Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})));
      __qa.select([a]);
      const x0 = getItem(a).x;
      key('ArrowRight');
      const moved = getItem(a).x - x0;
      key('ArrowRight', { shiftKey: true });
      const movedShift = getItem(a).x - x0;
      key('d', { ctrlKey: true });
      const dup = state.items.length;
      __qa.select([a, b]);
      key('g', { ctrlKey: true });
      const grouped = !!getItem(a).groupId && getItem(a).groupId === getItem(b).groupId;
      __qa.select([a]);
      key('Delete');
      const afterDel = state.items.length;
      return JSON.stringify({ moved, movedShift, dup, grouped, afterDel });
    })()`);
    check('A12 · ok tuşu 1px, Shift+ok 10px kaydırıyor',
      Math.abs(r.moved - 1) < 0.001 && Math.abs(r.movedShift - r.moved - 10) < 0.001,
      JSON.stringify({ moved: r.moved, shift: r.movedShift }));
    check('A12 · Ctrl+D çoğaltıyor', r.dup === 3, String(r.dup));
    check('A12 · Ctrl+G grupluyor', r.grouped === true, String(r.grouped));
    check('A12 · Delete siliyor', r.afterDel === 2, String(r.afterDel));
  });

  /* ---------- A13 · geçersiz dosya içe aktarma ---------- */
  await scenario('A13 geçersiz dosya', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      __qa.notices.length = 0;
      const before = state.items.length;
      await addFiles([new File(['merhaba'], 'notlar.txt', { type: 'text/plain' })], screenToWorld({ x: 400, y: 300 }));
      await new Promise(r => setTimeout(r, 400));
      return JSON.stringify({ before, after: state.items.length, notices: __qa.notices.slice() });
    })()`);
    check('A13 · metin dosyası içe aktarımı öğe üretmiyor, uyarı veriyor',
      r.after === r.before && r.notices.length > 0, JSON.stringify(r));
  });

  /* ---------- A14 · undo/redo zinciri ---------- */
  await scenario('A14 zincir', async () => {
    const r = await json(`(async () => {
      __qa.reset();
      for (let i = 0; i < 8; i++) await __qa.image('#48c', 200 + (i % 4) * 180, 260 + Math.floor(i / 4) * 180);
      const n = state.items.length;
      for (let i = 0; i < 10; i++) undo();
      const afterUndo = state.items.length;
      for (let i = 0; i < 10; i++) redo();
      return JSON.stringify({ n, afterUndo, afterRedo: state.items.length });
    })()`);
    check('A14 · 8 ekleme → tümü geri → tümü yinele',
      r.n === 8 && r.afterUndo === 0 && r.afterRedo === 8, JSON.stringify(r));
  });

  /* ---------- A15 · kalıcılık (yeniden yükleme) ---------- */
  await scenario('A15 kalıcılık', async () => {
    const before = await json(`(async () => {
      __qa.reset();
      const a = await __qa.image('#c33', 300, 300);
      const b = await __qa.image('#3c3', 700, 300);
      __qa.text('KALICI', 460, 520);
      __qa.select([a, b]);
      groupSelection();
      await new Promise(r => setTimeout(r, 2200));
      return JSON.stringify({ n: state.items.length, gid: getItem(a).groupId,
        pos: [Math.round(getItem(a).x), Math.round(getItem(a).y)],
        texts: state.items.filter(i => i.kind === 'text').map(i => i.text) });
    })()`);
    await h.reload();
    const after = await json(`(() => JSON.stringify({
      n: state.items.length,
      gid: state.items.find(i => i.kind === 'image')?.groupId || null,
      pos: (() => { const i = state.items.find(x => x.kind === 'image'); return i ? [Math.round(i.x), Math.round(i.y)] : null; })(),
      texts: state.items.filter(i => i.kind === 'text').map(i => i.text),
    }))()`);
    check('A15 · pano yeniden yüklemede öğe/grup/konum/metni koruyor',
      after.n === before.n && after.gid === before.gid && after.texts.includes('KALICI') &&
      after.pos && Math.abs(after.pos[0] - before.pos[0]) < 2,
      JSON.stringify({ before, after }));
  });

  /* ---------- A16 · sayfa hatası ---------- */
  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('A16 · sayfada hata yok', errs === '[]', errs);

  await h.finish();
})();
