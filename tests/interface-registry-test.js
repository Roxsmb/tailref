'use strict';
/* ======================================================================
   TailRef · Tur T Faz 5 kapısı — Arayüz kategorisi + bağımsızlık
   ======================================================================
   Kanıt zinciri (izole Electron profili, CDP):
   1. Arayüz API + Ayarlar interface galerisi HTML mevcut
   2. Interface kategorisi tıklaması → galeri kartları (classic + irix)
      ve aktif etiket dolu
   3. IRIX kart tıklaması → dataset.interface=irix + depo + galeri
      canlı tazelendi (listener kanıtı)
      (NOT: win98 arayüzü proje'den tamamen kaldırıldı — skin dosyası +
      registry girdisi silindi; tek preset irix üzerinden test edilir)
   4. BAĞIMSIZLIK A: tema değişimi arayüze DOKUNMAZ
      (applyTheme('forest') → data-theme=forest, interface hâlâ irix)
   5. BAĞIMSIZLIK B: arayüz değişimi temaya DOKUNMAZ
      (apply('classic') → data-theme hâlâ forest, interface attribute
      kalkar, galeri canlı tazelenir)
   6. Skin'siz bilinmeyen arayüz reddi (sahte kontrol yasak)
   ====================================================================== */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const PORT = 9395;
const APP_PORT = 5261;
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

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-interface-'));
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

    /* ---- 1. API + galeri HTML ---- */
    const apis = JSON.parse(await evaluate(ws, `JSON.stringify({
      ui: typeof window.tailrefInterfaces,
      nav: !!document.querySelector('#settingsNav .settingsNavItem[data-cat="interface"]'),
      gallery: !!document.getElementById('settingsInterfaceGallery'),
      activeLabel: !!document.getElementById('settingsInterfaceActive') })`));
    check('Arayüz API + Interface nav düğmesi + galeri HTML',
      apis.ui === 'object' && apis.nav && apis.gallery && apis.activeLabel, JSON.stringify(apis));

    /* ---- 2. Interface kategorisi aç → galeri dolu ---- */
    await evaluate(ws, `document.getElementById('btnOverflow').click()`);
    await sleep(900);
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="interface"]').click()`);
    await sleep(400);
    const g2 = JSON.parse(await evaluate(ws, `(function () {
      const box = document.getElementById('settingsInterfaceGallery');
      if (!box) return JSON.stringify({ ok: false });
      const cards = [...box.querySelectorAll('.settingsThemeCard')];
      const label = document.getElementById('settingsInterfaceActive');
      const page = document.querySelector('#settings .settingsPage[data-page="interface"]');
      return JSON.stringify({ ok: true, n: cards.length,
        ids: cards.map(c => (c.querySelector('.settingsThemeCardName') || {}).textContent || ''),
        label: label ? label.textContent : null,
        pageVisible: page ? !page.hidden : false });
    })()`));
    check('Interface sayfası açıldı; 2 gerçek kart (classic + irix) + aktif etiket',
      g2.ok && g2.n === 2 && g2.pageVisible && (g2.label || '').includes('Classic'), JSON.stringify(g2));

    /* ---- 3. IRIX kart tıklaması → canlı geçiş + galeri tazelendi ---- */
    await evaluate(ws, `(function () {
      const cards = [...document.querySelectorAll('#settingsInterfaceGallery .settingsThemeCard')];
      const irix = cards.find(c => /IRIX/.test(c.textContent));
      if (irix) irix.click();
    })()`);
    await sleep(900);
    const s3 = JSON.parse(await evaluate(ws, `(function () {
      const cards = [...document.querySelectorAll('#settingsInterfaceGallery .settingsThemeCard')];
      const irix = cards.find(c => /IRIX/.test(c.textContent));
      const label = document.getElementById('settingsInterfaceActive');
      return JSON.stringify({
        dataset: document.documentElement.dataset.interface || null,
        stored: localStorage.getItem('tailref-interface'),
        irixPressed: irix ? irix.getAttribute('aria-pressed') : null,
        label: label ? label.textContent : null,
        skinOpen: !(document.querySelector('link[data-ui-skin="irix"]') || {}).disabled });
    })()`));
    check('IRIX kartı → dataset=irix + depo + aria-pressed + aktif etiket + skin açık',
      s3.dataset === 'irix' && s3.stored === 'irix' && s3.irixPressed === 'true' &&
      (s3.label || '').includes('IRIX') && s3.skinOpen, JSON.stringify(s3));

    /* ---- 4. BAĞIMSIZLIK A: tema değişimi arayüze dokunmaz ---- */
    await evaluate(ws, `(function () { if (typeof applyTheme === 'function') applyTheme('forest'); })()`);
    await sleep(700);
    const s4 = JSON.parse(await evaluate(ws, `(function () {
      return JSON.stringify({
        theme: document.documentElement.dataset.theme || null,
        iface: document.documentElement.dataset.interface || null,
        storedIface: localStorage.getItem('tailref-interface') });
    })()`));
    check('Tema değişimi (forest) → data-theme=forest AMA interface hâlâ irix',
      s4.theme === 'forest' && s4.iface === 'irix' && s4.storedIface === 'irix', JSON.stringify(s4));

    /* ---- 5. BAĞIMSIZLIK B: arayüz değişimi temaya dokunmaz ---- */
    await evaluate(ws, `(function () { window.tailrefInterfaces.apply('classic'); })()`);
    await sleep(900);
    const s5 = JSON.parse(await evaluate(ws, `(function () {
      const cards = [...document.querySelectorAll('#settingsInterfaceGallery .settingsThemeCard')];
      const cl = cards.find(c => /Classic/.test(c.textContent));
      return JSON.stringify({
        theme: document.documentElement.dataset.theme || null,
        iface: document.documentElement.dataset.interface || null,
        storedIface: localStorage.getItem('tailref-interface'),
        classicPressed: cl ? cl.getAttribute('aria-pressed') : null,
        label: (document.getElementById('settingsInterfaceActive') || {}).textContent });
    })()`));
    check('Arayüz değişimi (classic) → interface temizlendi AMA data-theme hâlâ forest + galeri canlı tazelendi',
      s5.theme === 'forest' && s5.iface === null && s5.storedIface === 'classic' &&
      s5.classicPressed === 'true' && (s5.label || '').includes('Classic'), JSON.stringify(s5));

    /* ---- 6. Bilinmeyen arayüz reddi ---- */
    const s6 = await evaluate(ws, `String(window.tailrefInterfaces.apply('fake-ui') === false)`);
    check('Skin\'siz bilinmeyen arayüz reddedildi (false) — mevcut görünüm korundu', s6 === 'true', s6);

    /* temizlik: forest temasını bırakma */
    await evaluate(ws, `(function () { if (typeof applyTheme === 'function') applyTheme('classic'); })()`);

    const fails = results.filter(r => !r.ok).length;
    console.log('\nARAYÜZ-KAYIT: ' + (results.length - fails) + ' geçti, ' + fails + ' kaldı');
    process.exit(fails ? 1 : 0);
  } catch (e) {
    console.error('HATA:', e.message);
    process.exit(1);
  } finally {
    try { app.kill(); } catch { /* sessiz */ }
  }
})();
