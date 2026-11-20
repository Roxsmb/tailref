'use strict';

/* Odaklı sonda 9: kaplama panellerinde Escape sözleşmesi. */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9501, appPort: 5367, prefix: 'tailref-probe9-' });
  const { json, check } = h;

  const r = await json(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const esc = (target) => (target || document.body)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    /* ayarlar */
    document.getElementById('btnOverflow').click();
    await wait(400);
    const settingsOpen = !document.getElementById('settings').hidden;
    const search = document.getElementById('settingsSearch');
    search.focus();
    search.value = 'theme';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(250);
    esc(search);
    await wait(120);
    const afterSearchEsc = { open: !document.getElementById('settings').hidden,
      query: search.value, results: document.querySelectorAll('.settingsSearchResult').length };
    esc(document.activeElement || document.body);
    await wait(300);
    const afterEsc = !document.getElementById('settings').hidden;
    if (afterEsc) document.getElementById('btnSettingsClose').click();
    await wait(250);
    const closeBtnWorks = document.getElementById('settings').hidden;

    /* çöp */
    __qa.reset();
    const a = await __qa.image('#3ac', 420, 340);
    __qa.select([a]);
    deleteSelection();
    await wait(300);
    document.getElementById('btnTrashDock').click();
    await wait(350);
    const trashOpen = !document.getElementById('trashPanel').hidden;
    esc();
    await wait(250);
    const trashAfterEsc = !document.getElementById('trashPanel').hidden;
    if (trashAfterEsc) document.getElementById('btnTrashClose').click();
    await wait(200);
    const trashCloseWorks = document.getElementById('trashPanel').hidden;

    /* yardım */
    esc();
    __qa.key(document.body, '?');
    await wait(350);
    const helpOpen = !document.getElementById('help').hidden;
    esc();
    await wait(300);
    const helpAfterEsc = !document.getElementById('help').hidden;
    if (helpAfterEsc) document.getElementById('btnHelpClose').click();
    await wait(200);
    const helpCloseWorks = document.getElementById('help').hidden;

    return JSON.stringify({ settingsOpen, afterSearchEsc, afterEsc, closeBtnWorks,
      trashOpen, trashAfterEsc, trashCloseWorks,
      helpOpen, helpAfterEsc, helpCloseWorks });
  })()`);
  console.log(JSON.stringify(r, null, 2));

  check('P9 · ayarlar açılıyor', r.settingsOpen === true);
  check('P9 · arama alanında Esc yalnız sorguyu temizliyor, pencere açık kalıyor',
    r.afterSearchEsc.open === true && r.afterSearchEsc.query === '' && r.afterSearchEsc.results === 0,
    JSON.stringify(r.afterSearchEsc));
  check('P9 · Esc ayarları kapatıyor', r.afterEsc === false, 'açık=' + r.afterEsc);
  check('P9 · ayarlar X düğmesiyle kapanıyor', r.closeBtnWorks === true);
  check('P9 · çöp paneli açılıyor', r.trashOpen === true);
  check('P9 · Esc çöp panelini kapatıyor', r.trashAfterEsc === false, 'açık=' + r.trashAfterEsc);
  check('P9 · çöp X düğmesiyle kapanıyor', r.trashCloseWorks === true);
  check('P9 · yardım açılıyor', r.helpOpen === true);
  check('P9 · Esc yardımı kapatıyor', r.helpAfterEsc === false, 'açık=' + r.helpAfterEsc);
  check('P9 · yardım X düğmesiyle kapanıyor', r.helpCloseWorks === true);

  await h.finish();
})();
