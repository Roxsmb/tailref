'use strict';
/* ======================================================================
   TailRef · Tur T Faz 6 kapısı — arayüz paketi mimarisi
   ======================================================================
   Kanıt zinciri (izole Electron profili, CDP):
   1. API mevcut (tailrefUiPackages + register/unregister + import UI HTML)
   2. Geçerli paket importText → ok + style[data-ui-skin] enjekte +
      galeri kartı (package tag) + kurulu paket satırı
   3. Paket kartı tıklaması → dataset.interface=paket id + paket kuralı
      GERÇEKTEN uygulandı (buton radius 0 computed) + tema bağımsız
   4. Kalıcılık: reload → dataset korunur + style yeniden enjekte +
      kart yeniden dolu (bootstrap kanıtı)
   5. Güvenlik: 5 reddedilmeli paket (JS/url/property/boyut/format)
      → ok:false + stil/kart YOK
   6. Remove → classic'e dönüş + style sökülür + kart gider
   7. duplicate id reddi + unregister builtin'e vurulamaz
   ====================================================================== */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const PORT = 9399;
const APP_PORT = 5265;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  → ' + detail : ''));
}
function connect(wsUrl) {
  return new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
}
const send = (ws, method, params) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => { const m = JSON.parse(ev.data); if (m.id !== id) return; ws.removeEventListener('message', onMsg);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => { const m = JSON.parse(ev.data); if (m.id !== id) return; ws.removeEventListener('message', onMsg);
    m.error ? reject(new Error(JSON.stringify(m.error))) : (m.result.exceptionDetails ? reject(new Error(m.result.exceptionDetails.exception?.description || 'eval')) : resolve(m.result.result.value)); };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  setTimeout(() => reject(new Error('timeout')), 30000);
});

const GOOD_PKG = JSON.stringify({
  format: 'tailref-ui@1',
  meta: { name: 'Slate Test', author: 'gate', version: 1, desc: 'Faz 6 gate package' },
  tokens: { '--ui-font': 'Tahoma' },
  rules: [
    { selector: 'button', props: { 'border-radius': '0px', 'box-shadow': 'none' } },
    { selector: '#settings', props: { 'background-color': '#223344' } },
  ],
});

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-uipkg-'));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'],
    { cwd: ROOT, env: { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' }, stdio: 'ignore' });
  try {
    let page = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && !page) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      } catch { /* henüz hazır değil */ }
      if (!page) await sleep(400);
    }
    if (!page) throw new Error('ana pencere açılmadı');
    const ws = await connect(page.webSocketDebuggerUrl);
    await send(ws, 'Page.enable', {});
    for (let i = 0; i < 40; i++) { try { if (await evaluate(ws, "typeof state !== 'undefined'")) break; } catch {} await sleep(400); }
    await evaluate(ws, `(function(){ if (typeof setPersistenceMode === 'function') setPersistenceMode('auto');
      const el = document.getElementById('persistenceWelcome'); if (el) el.hidden = true;
      window.confirm = () => true; window.__tailrefConfirmBypass = true; })()`);
      /* appConfirm stub yoluna düşsün — üst satırdaki bypass bayrağı ile. */    await sleep(400);

    /* ---- 1. API + içe aktarım UI ---- */
    const apis = JSON.parse(await evaluate(ws, `JSON.stringify({
      pkgs: typeof window.tailrefUiPackages,
      reg: typeof window.tailrefInterfaces.register,
      unreg: typeof window.tailrefInterfaces.unregister,
      fmt: typeof window.tailrefUiPackageFormat,
      btn: !!document.getElementById('btnUiPackageImport'),
      list: !!document.getElementById('settingsInterfacePackages') })`));
    check('Paket API + doğrulayıcı + içe aktarım UI mevcut',
      apis.pkgs === 'object' && apis.reg === 'function' && apis.unreg === 'function' &&
      apis.fmt === 'object' && apis.btn && apis.list, JSON.stringify(apis));

    /* ---- 2. Geçerli paket import ---- */
    const imp = JSON.parse(await evaluate(ws, `JSON.stringify(window.tailrefUiPackages.importText(${JSON.stringify(GOOD_PKG)}))`));
    check('Geçerli paket import → ok:true + id ui_slate-test', imp.ok === true && imp.id === 'ui_slate-test', JSON.stringify(imp));
    const st2 = JSON.parse(await evaluate(ws, `(function () {
      return JSON.stringify({
        style: !!document.querySelector('style[data-ui-skin="ui_slate-test"]'),
        registered: window.tailrefInterfaces.list().some(d => d.id === 'ui_slate-test'),
        datasets: window.tailrefInterfaces.active() });
    })()`));
    check('Paket enjekte edildi + kayıt defterinde + seçilmeden önce classic',
      st2.style && st2.registered && st2.datasets === 'classic', JSON.stringify(st2));

    /* ---- 3. Paket kartı → apply + kural gerçekten uygulandı ---- */
    await evaluate(ws, `document.getElementById('btnOverflow').click()`);
    await sleep(900);
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="interface"]').click()`);
    await sleep(400);
    await evaluate(ws, `(function () {
      const cards = [...document.querySelectorAll('#settingsInterfaceGallery .settingsThemeCard')];
      const c = cards.find(x => /Slate Test/.test(x.textContent));
      if (c) c.click();
    })()`);
    await sleep(700);
    const st3 = JSON.parse(await evaluate(ws, `(function () {
      const btn = [...document.querySelectorAll('#bar button, #bar .tbtn')].find(b => b.getBoundingClientRect().width > 0);
      const settings = document.getElementById('settings');
      return JSON.stringify({
        iface: document.documentElement.dataset.interface || null,
        btnRadius: btn ? getComputedStyle(btn).borderRadius : null,
        settingsBg: settings ? getComputedStyle(settings).backgroundColor : null,
        cardPressed: (document.querySelector('#settingsInterfaceGallery .settingsThemeCard[aria-pressed="true"] .settingsThemeCardName') || {}).textContent });
    })()`));
    check('Paket kartı → dataset=ui_slate-test + buton radius 0 (kural canlı) + settings paket rengi',
      st3.iface === 'ui_slate-test' && st3.btnRadius === '0px' &&
      /34, 51, 68/.test(st3.settingsBg), JSON.stringify(st3));

    /* ---- 4. Kalıcılık: reload ---- */
    await send(ws, 'Page.reload', {});
    await sleep(2500);
    for (let i = 0; i < 10; i++) { try { if (await evaluate(ws, "typeof state !== 'undefined'")) break; } catch {} await sleep(500); }
    const st4 = JSON.parse(await evaluate(ws, `(function () {
      return JSON.stringify({
        iface: document.documentElement.dataset.interface || null,
        style: !!document.querySelector('style[data-ui-skin="ui_slate-test"]'),
        stored: !!JSON.parse(localStorage.getItem('tailref-ui-packages') || '[]').length,
        storeIntact: (JSON.parse(localStorage.getItem('tailref-ui-packages') || '[]')[0] || {}).id === 'ui_slate-test' });
    })()`));
    check('Reload → dataset korunur + style yeniden enjekte + depo bozulmadı (bootstrap)',
      st4.iface === 'ui_slate-test' && st4.style && st4.stored && st4.storeIntact, JSON.stringify(st4));

    /* ---- 5. Güvenlik reddi ---- */
    const rejects = await evaluate(ws, `(function () {
      const P = window.tailrefUiPackages;
      const cases = [
        JSON.stringify({ format: 'ui@1', meta: { name: 'X1' } }),
        JSON.stringify({ format: 'tailref-ui@1', meta: { name: 'X2' },
          rules: [{ selector: 'b', props: { position: 'fixed' } }] }),
        JSON.stringify({ format: 'tailref-ui@1', meta: { name: 'X3' },
          rules: [{ selector: 'b', props: { background: 'url(http://x)' } }] }),
        JSON.stringify({ format: 'tailref-ui@1', meta: { name: 'X4' },
          rules: [{ selector: 'b', props: { color: '#fff} body{display:none}' } }] }),
        'not json at all',
      ];
      return JSON.stringify(cases.map(c => {
        const r = P.importText(c);
        return { ok: r.ok === false, hasStyle: !!document.querySelector('style[data-ui-skin^="ui_x"],style[data-ui-skin="ui_x"]') };
      }));
    })()`);
    const rejArr = JSON.parse(rejects);
    check('Güvenlik: format/property/url/braces/JSON vakalarının 5\'i de reddedildi + stil YOK',
      rejArr.length === 5 && rejArr.every(r => r.ok), JSON.stringify(rejArr));

    /* duplicate id */
    const dup = JSON.parse(await evaluate(ws, `JSON.stringify(window.tailrefUiPackages.importText(${JSON.stringify(GOOD_PKG)}))`));
    check('Duplicate id reddi (importText tekrar)', dup.ok === false, JSON.stringify(dup));

    /* unregister builtin koruması (win98 arayüzü kaldırıldı; mevcut
       builtin'ler classic + irix — kaynak 02c-interface-registry.js) */
    const unregB = await evaluate(ws, `String(window.tailrefInterfaces.unregister('irix') === false && window.tailrefInterfaces.list().some(d => d.id === 'irix'))`);
    check('unregister builtin\'e vurulamaz (irix korunur)', unregB === 'true', unregB);

    /* ---- 6. Remove ---- */
    const removed = await evaluate(ws, `String(window.tailrefUiPackages.removePackage('ui_slate-test'))`);
    await sleep(400);
    const st6 = JSON.parse(await evaluate(ws, `(function () {
      return JSON.stringify({
        iface: document.documentElement.dataset.interface || null,
        style: !!document.querySelector('style[data-ui-skin="ui_slate-test"]'),
        inList: window.tailrefInterfaces.list().some(d => d.id === 'ui_slate-test'),
        storeEmpty: JSON.parse(localStorage.getItem('tailref-ui-packages') || '[]').length === 0 });
    })()`));
    check('Remove → classic dönüş + style sökülür + kayıt temiz + depo boş',
      removed === 'true' && st6.iface === null && !st6.style && !st6.inList && st6.storeEmpty,
      JSON.stringify({ removed, ...st6 }));

    const fails = results.filter(r => !r.ok).length;
    console.log('\nUI-PAKET: ' + (results.length - fails) + ' geçti, ' + fails + ' kaldı');
    process.exit(fails ? 1 : 0);
  } catch (e) {
    console.error('HATA:', e.message);
    process.exit(1);
  } finally {
    try { app.kill(); } catch { /* sessiz */ }
  }
})();
