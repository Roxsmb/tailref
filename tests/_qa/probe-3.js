'use strict';

/* Sonda 3: menü Escape gecikmesi. */

const { start } = require('./harness');

(async () => {
  const h = await start({ port: 9485, appPort: 5347, prefix: 'tailref-probe3-' });
  const { json, evaluate, check } = h;

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
      await new Promise(r => setTimeout(r, 120));
      const menuEl = document.getElementById('contextMenu');
      const t = target === 'body' ? document.body : target === 'stage' ? stage
        : target === 'document' ? document : window;
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const samples = [];
      for (const ms of [50, 100, 200, 400, 700]) {
        await new Promise(r => setTimeout(r, ms - (samples.length ? [50, 100, 200, 400][samples.length - 1] : 0)));
        samples.push([ms, menuEl.hidden]);
      }
      out[target] = samples;
      if (!menuEl.hidden) hideContextMenu();
      await new Promise(r => setTimeout(r, 100));
    }
    return JSON.stringify(out);
  })()`);
  console.log('Escape zaman çizelgesi:', JSON.stringify(esc));

  const errs = await evaluate('JSON.stringify(window.__qaErrs || [])');
  check('sonda sayfasında hata yok', errs === '[]', errs);
  await h.finish();
})();
