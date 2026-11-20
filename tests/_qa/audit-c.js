'use strict';

/* Tur C — Kabuk: mod geçişleri, paneller, çöp, ayarlar, tema kalıcılığı,
   dışa aktarma penceresi, yardım, kısayollar. */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9495, appPort: 5361, prefix: 'tailref-audit-c-' });
  const { json, evaluate, check, scenario } = h;

  /* ---------- C1 · mod geçişleri ---------- */
  await scenario('C1 modlar', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      __qa.reset();
      const mode = () => document.getElementById('appModeBar').dataset.mode;
      const ref0 = mode();
      document.getElementById('mode3dBtn').click();
      await wait(500);
      const threeD = { mode: mode(),
        panel: !document.getElementById('pose3dPanel').hidden };
      document.getElementById('modeRefBtn').click();
      await wait(500);
      const back = { mode: mode(),
        panel: !document.getElementById('pose3dPanel').hidden };
      return JSON.stringify({ ref0, threeD, back });
    })()`);
    check('C1 · 3D moduna geçiş paneli açıyor', r.threeD.mode === '3d' && r.threeD.panel === true,
      JSON.stringify(r.threeD));
    check('C1 · referans moduna dönüş 3D panelini kapatıyor', r.back.mode === 'reference' && r.back.panel === false,
      JSON.stringify(r.back));
  });

  /* ---------- C2 · paneller menüsü ---------- */
  await scenario('C2 panel menüsü', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const menu = document.getElementById('overflowMenu');
      document.getElementById('btnPanelsBar').click();
      await wait(300);
      const open = !menu.hidden;
      const count = menu.querySelectorAll('button').length;
      const labels = [...menu.querySelectorAll('button')].slice(0, 6)
        .map(b => b.textContent.trim()).filter(Boolean);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(300);
      return JSON.stringify({ open, count, labels, closed: menu.hidden });
    })()`);
    check('C2 · paneller menüsü açılıyor, girdiler var, Escape kapatıyor',
      r.open === true && r.count >= 3 && r.closed === true,
      JSON.stringify({ open: r.open, count: r.count, closed: r.closed }));
  });

  /* ---------- C3 · çöp kutusu ---------- */
  await scenario('C3 çöp', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      __qa.reset();
      const a = await __qa.image('#c93', 420, 360);
      __qa.select([a]);
      deleteSelection();
      await wait(700);
      const count1 = document.getElementById('trashCount').textContent.trim();
      document.getElementById('btnTrashDock').click();
      await wait(350);
      const panelOpen = !document.getElementById('trashPanel').hidden;
      const rows = document.querySelectorAll('#trashList .trashItem').length;
      document.getElementById('btnTrashRestoreAll').click();
      await wait(900);
      const restored = !!getItem(a);
      const trashAfter = state.trash.length;
      document.getElementById('btnTrashClose').click();
      await wait(250);
      return JSON.stringify({ count1, panelOpen, rows, restored, trashAfter,
        items: state.items.length, closed: document.getElementById('trashPanel').hidden });
    })()`);
    check('C3 · silme çöpe düşüyor, panelde satır görünüyor',
      r.count1 === '1' && r.panelOpen === true && r.rows >= 1, JSON.stringify(r));
    check('C3 · "tümünü geri al" öğeyi panoya döndürüyor, çöp boşalıyor',
      r.restored === true && r.trashAfter === 0 && r.items === 1 && r.closed === true,
      JSON.stringify({ restored: r.restored, trash: r.trashAfter, items: r.items }));
  });

  /* ---------- C4 · ayarlar merkezi + arama ---------- */
  await scenario('C4 ayarlar', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('btnOverflow').click();
      await wait(450);
      const hub = document.getElementById('settings');
      const open = !hub.hidden;
      const search = document.getElementById('settingsSearch');
      search.value = 'theme';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(400);
      const hits = document.querySelectorAll('#settingsSearchResults .settingsSearchResult').length;
      const box = document.getElementById('settingsSearchResults');
      const boxVisible = !box.hidden;
      document.getElementById('settingsNav-about').click();
      await wait(250);
      const aboutOpen = !document.getElementById('settingsPage-about').hidden;
      document.getElementById('btnSettingsClose').click();
      await wait(300);
      return JSON.stringify({ open, hits, boxVisible, aboutOpen, closed: hub.hidden });
    })()`);
    check('C4 · ayarlar açılıyor, arama sonuç veriyor, bölüm gezintisi çalışıyor',
      r.open === true && r.hits >= 1 && r.boxVisible === true && r.aboutOpen === true,
      JSON.stringify(r));
    check('C4 · ayarlar kapatılabiliyor', r.closed === true, String(r.closed));
  });

  /* ---------- C5 · tema seçimi + yeniden yükleme kalıcılığı ---------- */
  await scenario('C5 tema', async () => {
    const before = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const sel = document.getElementById('themeSelect');
      sel.value = 'midnight';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(350);
      return JSON.stringify({ theme: document.documentElement.dataset.theme || 'classic',
        stored: localStorage.getItem('tailref-theme'), sel: sel.value });
    })()`);
    check('C5 · tema seçimi uygulanıyor ve saklanıyor',
      before.theme === 'midnight' && before.stored === 'midnight' && before.sel === 'midnight',
      JSON.stringify(before));
    await h.reload();
    const after = await json(`JSON.stringify({
      theme: document.documentElement.dataset.theme || 'classic',
      sel: document.getElementById('themeSelect').value,
      body: getComputedStyle(document.body).backgroundColor,
    })`);
    check('C5 · tema yeniden yüklemede korunuyor',
      after.theme === 'midnight' && after.sel === 'midnight', JSON.stringify(after));
    await evaluate(`(async () => {
      const sel = document.getElementById('themeSelect');
      sel.value = 'classic';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      return true;
    })()`);
  });

  /* ---------- C6 · dışa aktarma penceresi ---------- */
  await scenario('C6 dışa aktarma', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      __qa.reset();
      await __qa.image('#48c', 420, 340);
      document.getElementById('btnExport').click();
      await wait(700);
      const modal = document.getElementById('exportModal');
      const open = !modal.hidden;
      const opts = modal.querySelectorAll('select, input, button').length;
      const title = document.getElementById('exportTitle').textContent.trim();
      document.getElementById('exportForm').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait(400);
      return JSON.stringify({ open, opts, title, closed: modal.hidden });
    })()`);
    check('C6 · dışa aktarma penceresi açılıyor, seçenekler var, Escape kapatıyor',
      r.open === true && r.opts >= 6 && r.closed === true, JSON.stringify(r));
  });

  /* ---------- C7 · yardım ---------- */
  await scenario('C7 yardım', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: '?', bubbles: true, cancelable: true }));
      await wait(350);
      const help = document.getElementById('help');
      const open = !help.hidden;
      const text = help.textContent.replace(/\\s+/g, ' ').trim().length;
      document.getElementById('btnHelpClose').click();
      await wait(250);
      return JSON.stringify({ open, text, closed: help.hidden });
    })()`);
    check('C7 · yardım penceresi açılıyor ve kapanıyor', r.open === true && r.text > 200 && r.closed === true,
      JSON.stringify({ open: r.open, text: r.text, closed: r.closed }));
  });

  /* ---------- C8 · pano kısayolları ---------- */
  await scenario('C8 kısayollar', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      __qa.reset();
      const a = await __qa.image('#c33', 320, 320);
      const b = await __qa.image('#3c3', 700, 320);
      const key = (k, extra) => document.body.dispatchEvent(new KeyboardEvent('keydown',
        Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})));
      __qa.select([a]);
      key('a', { ctrlKey: true });
      const all = selection.size;
      zoomAt({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, 3);
      const z0 = state.view.scale;
      key('0', { ctrlKey: true });
      await wait(250);
      const z100 = state.view.scale;
      __qa.select([a]);
      __qa.dragItem(a, 50, 0);
      key('z', { ctrlKey: true });
      const xUndo = getItem(a).x;
      key('y', { ctrlKey: true });
      const xRedo = getItem(a).x;
      return JSON.stringify({ all, z0, z100, xUndo, xRedo, n: state.items.length });
    })()`);
    check('C8 · Ctrl+A tüm öğeleri seçiyor', r.all === 2, String(r.all));
    check('C8 · Ctrl+0 görünümü %100\'e döndürüyor', r.z0 !== 1 && Math.abs(r.z100 - 1) < 0.001,
      JSON.stringify({ z0: r.z0, zoom100: r.z100 }));
    check('C8 · Ctrl+Z / Ctrl+Y taşımayı geri alıp yineliyor',
      Math.abs(r.xUndo - 200) < 2 && Math.abs(r.xRedo - 250) < 2,
      JSON.stringify({ undo: r.xUndo, redo: r.xRedo }));
  });

  /* ---------- C9 · arka plan opaklığı ---------- */
  await scenario('C9 arka plan', async () => {
    const r = await json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const s = document.getElementById('bgOpacity');
      s.value = '40';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(200);
      const label = document.getElementById('bgOpacityVal').textContent.trim();
      const bg = state.bg;
      s.value = '100';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(200);
      return JSON.stringify({ label, bg, back: state.bg });
    })()`);
    check('C9 · arka plan opaklığı kaydırıcısı durumu ve etiketi güncelliyor',
      Math.abs(r.bg - 0.4) < 0.02 && /40/.test(r.label) && Math.abs(r.back - 1) < 0.01,
      JSON.stringify(r));
  });

  /* ---------- C10 · sayfa hatası ---------- */
  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('C10 · sayfada hata yok', errs === '[]', errs);

  await h.finish();
})();
