'use strict';

/* Odaklı sonda 8: tekrarlı kullanım (dinleyici/DOM birikmesi) ve
   mod-başına tema yalıtımı + kalıcılığı. */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9499, appPort: 5365, prefix: 'tailref-probe8-' });
  const { json, evaluate, check } = h;

  /* 1 · 25 tur ayarlar aç/kapat + arama; düğüm sayısı şişmemeli. */
  const stress = await json(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const open = () => document.getElementById('btnOverflow').click();
    const hub = document.getElementById('settings');
    const search = document.getElementById('settingsSearch');
    const box = document.getElementById('settingsSearchResults');
    for (let i = 0; i < 25; i++) {
      open();
      await wait(80);
      search.value = 'theme';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(80);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(260);
      if (!hub.hidden) document.getElementById('btnSettingsClose').click();
      await wait(240);
    }
    const results = box.querySelectorAll('.settingsSearchResult').length;
    const hubs = document.querySelectorAll('#settings').length;
    return JSON.stringify({ results, hubs, closed: hub.hidden,
      hits: box.hidden ? 0 : results });
  })()`);
  check('S1 · 25 tur ayarlar aç/kapat sonrası tek merkez, kapalı',
    stress.hubs === 1 && stress.closed === true, JSON.stringify(stress));
  check('S1 · arama sonuçları birikmiyor (son turda makul sayı)',
    stress.results <= 40, String(stress.results));

  /* 2 · 25 tur sil → tümünü geri al; öğe/çöp sayısı sabit kalmalı. */
  const trash = await json(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    __qa.reset();
    const a = await __qa.image('#3ac', 420, 340);
    for (let i = 0; i < 25; i++) {
      __qa.select([a]);
      deleteSelection();
      await wait(30);
      document.getElementById('btnTrashDock').click();
      await wait(30);
      document.getElementById('btnTrashRestoreAll').click();
      await wait(60);
      document.getElementById('btnTrashClose').click();
      await wait(20);
    }
    return JSON.stringify({ items: state.items.length, trash: state.trash.length,
      alive: !!getItem(a), rows: document.querySelectorAll('#trashList .trashItem').length });
  })()`);
  check('S2 · 25 tur sil/geri al sonrası öğe ve çöp tutarlı',
    trash.items === 1 && trash.trash === 0 && trash.alive === true && trash.rows === 0,
    JSON.stringify(trash));

  /* 3 · 20 tur metin yaz → geri al → yinele. */
  const textCycle = await json(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    __qa.reset();
    const id = __qa.text('BASE', 360, 340);
    for (let i = 0; i < 20; i++) {
      startEdit(getItem(id));
      const t = elMap.get(id).querySelector('.text');
      t.focus();
      t.textContent = 'T' + i;
      t.dispatchEvent(new Event('input', { bubbles: true }));
      commitEdit();
      undo();
      __qa.key(document.body, 'y', { ctrlKey: true });
      await wait(15);
    }
    return JSON.stringify({ text: getItem(id).text, items: state.items.length,
      undo: undoStack.length, redo: redoStack.length });
  })()`);
  check('S3 · 20 tur yaz/geri al/yinele sonrası metin ve yığın tutarlı',
    textCycle.items === 1 && /^T\d+$/.test(textCycle.text || ''),
    JSON.stringify(textCycle));

  /* 4 · mod-başına tema yalıtımı + yeniden yükleme. */
  const theme1 = await json(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const set = name => {
      const sel = document.getElementById('themeSelect');
      sel.value = name;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    __qa.reset();
    const img = await __qa.image('#3ac', 420, 340);
    __qa.select([img]);
    document.getElementById('modeRefBtn').click();
    await wait(350);
    set('midnight');
    await wait(250);
    const refTheme = document.documentElement.dataset.theme;
    document.getElementById('modeDrawBtn').click();
    await wait(900);
    const drawMode = document.body.classList.contains('mode-draw');
    const drawBefore = document.documentElement.dataset.theme;
    set('forest');
    await wait(300);
    const drawTheme = document.documentElement.dataset.theme;
    document.getElementById('modeRefBtn').click();
    await wait(400);
    const refBack = document.documentElement.dataset.theme;
    return JSON.stringify({ refTheme, drawMode, drawBefore, drawTheme, refBack,
      keys: {
        ref: localStorage.getItem('tailref-theme-reference'),
        draw: localStorage.getItem('tailref-theme-draw'),
      } });
  })()`);
  check('S4 · çizim moduna gerçekten girildi', theme1.drawMode === true, JSON.stringify(theme1));
  check('S4 · referans teması midnight, çizim teması forest',
    theme1.refTheme === 'midnight' && theme1.drawTheme === 'forest' &&
    theme1.keys.ref === 'midnight' && theme1.keys.draw === 'forest',
    JSON.stringify(theme1));
  check('S4 · referansa dönünce kendi teması geri geliyor',
    theme1.refBack === 'midnight', String(theme1.refBack));

  await h.reload();
  const theme2 = await json(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('modeRefBtn').click();
    await wait(350);
    const ref = document.documentElement.dataset.theme;
    const first = state.items.find(i => i.kind === 'image');
    if (first) __qa.select([first.id]);
    document.getElementById('modeDrawBtn').click();
    await wait(900);
    const drawMode = document.body.classList.contains('mode-draw');
    const draw = document.documentElement.dataset.theme;
    document.getElementById('modeRefBtn').click();
    await wait(400);
    return JSON.stringify({ ref, draw, drawMode, items: state.items.length });
  })()`);
  check('S4 · yeniden yüklemede iki mod da kendi temasını koruyor',
    theme2.ref === 'midnight' && theme2.draw === 'forest' && theme2.drawMode === true,
    JSON.stringify(theme2));

  /* profili kirletme: iki modu da classic'e döndür */
  await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const set = name => {
      const sel = document.getElementById('themeSelect');
      sel.value = name;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.getElementById('modeRefBtn').click();
    await wait(250);
    set('classic');
    await wait(200);
    document.getElementById('modeDrawBtn').click();
    await wait(300);
    set('classic');
    await wait(200);
    document.getElementById('modeRefBtn').click();
    await wait(200);
    return true;
  })()`);

  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('S5 · sayfada hata yok', errs === '[]', errs);

  await h.finish();
})();
