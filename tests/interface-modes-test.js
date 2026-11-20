'use strict';
/* ======================================================================
   TailRef · mod × arayüz matrisi + odak + kalıcılık (irix sürümü)
   ======================================================================
   NOT: win98 arayüzü proje'den tamamen kaldırıldı (skin dosyası + registry
   girdisi silindi; 02c-interface-registry.js yalnız classic + irix).
   Bu kapı win98 yerine SAHİP OLUNAN tek preset 'irix' (SGI IRIX 4Dwm)
   üzerinden aynı zinciri kanıtlar:
   1. IRIX aç: data-interface + skin link AÇIK + yüzey rengi --irix-face
   2. Odak dışı (gerçek window blur): .irix-window-inactive + başlık
      grisi --irix-title-inactive; odak geri: yüzey rengi
   3. Mod turu @irix: reference → 3D → draw (yeni tuval formu) →
      reference: her adımda dataset.mode + skin link açık kalıyor
   4. Classic'e dönüş: skin link KAPANIR; mod turu classic'te
      tekrarlanır (kabuk yok, çökme yok)
   5. Kalıcılık: irix + reload → dataset + skin link yeniden açık
   Renk kıyası Chrome sürümünden bağımsızdır: beklenen renk gizli bir
   sonda elemana CSS değişkeniyle yazılıp computed değeriyle kıyaslanır
   (rgb()/color(srgb ...) format farkı sorun olmaz).
   ====================================================================== */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const PORT = 9417;
const APP_PORT = 5279;
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

/* Elementin arka plan rengi, CSS değişkeninin sonda değeriyle aynı mı? */
const sameColorFn = (elSel, varName) => `(() => {
  const el = document.querySelector(${JSON.stringify(elSel)});
  if (!el) return false;
  const probe = document.createElement('div');
  probe.style.display = 'none';
  probe.style.backgroundColor = 'var(${varName})';
  document.body.appendChild(probe);
  const beklenen = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return getComputedStyle(el).backgroundColor === beklenen;
})()`;

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-ifacemodes-'));
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
    await sleep(400);

    /* ---- 1. IRIX aç ---- */
    await evaluate(ws, `window.dispatchEvent(new Event('focus'))`);
    await evaluate(ws, `window.tailrefInterfaces.apply('irix')`);
    await sleep(400);
    const s1 = JSON.parse(await evaluate(ws, `(function () {
      const link = document.querySelector('link[data-ui-skin="irix"]');
      return JSON.stringify({ iface: document.documentElement.dataset.interface,
        skinAcik: !!link && link.disabled === false });
    })()`));
    const s1bg = await evaluate(ws, sameColorFn('#appModeBar', '--irix-face'));
    check('IRIX → data-interface + skin link açık + yüzey rengi --irix-face',
      s1.iface === 'irix' && s1.skinAcik && s1bg === true,
      JSON.stringify(s1) + ' yüzey=' + s1bg);

    /* ---- 2. Odak dışı gri (gerçek window blur/focus) ---- */
    await evaluate(ws, `window.dispatchEvent(new Event('blur'))`);
    await sleep(200);
    const s2 = JSON.parse(await evaluate(ws, `(function () {
      return JSON.stringify({
        cls: document.documentElement.classList.contains('irix-window-inactive') });
    })()`));
    const s2bg = await evaluate(ws, sameColorFn('#appModeBar', '--irix-title-inactive'));
    check('Blur → inactive class + başlık grisi --irix-title-inactive',
      s2.cls && s2bg === true, JSON.stringify(s2) + ' gri=' + s2bg);
    await evaluate(ws, `window.dispatchEvent(new Event('focus'))`);
    await sleep(200);
    const s2b = JSON.parse(await evaluate(ws, `JSON.stringify({
      cls: document.documentElement.classList.contains('irix-window-inactive') })`));
    const s2bbg = await evaluate(ws, sameColorFn('#appModeBar', '--irix-face'));
    check('Focus → class kalktı + yüzey rengi geri',
      !s2b.cls && s2bbg === true, JSON.stringify(s2b) + ' yüzey=' + s2bbg);

    /* ---- 3. Mod turu @irix: reference → 3D → draw → reference ---- */
    /* NOT: tam zincirde pencere gerçekten odak kaybedebilir (önceki
       kapıların pencere kalıntıları) — odak gerektiren doğrulamalardan
       önce taban durumu focus event ile normalleştirilir. */
    await evaluate(ws, `window.dispatchEvent(new Event('focus'))`);
    await evaluate(ws, `document.getElementById('mode3dBtn').click()`);
    await sleep(700);
    const s3a = JSON.parse(await evaluate(ws, `(function () {
      const link = document.querySelector('link[data-ui-skin="irix"]');
      return JSON.stringify({
        mode: document.getElementById('appModeBar').dataset.mode,
        skinAcik: !!link && link.disabled === false }) } )()`));
    check('IRIX 3D modu → dataset.mode=3d + skin link açık',
      s3a.mode === '3d' && s3a.skinAcik, JSON.stringify(s3a));

    await evaluate(ws, `document.getElementById('modeDrawBtn').click()`);
    await sleep(400);
    await evaluate(ws, `(function () {
      document.getElementById('newCanvasW').value = '800';
      document.getElementById('newCanvasH').value = '600';
      document.getElementById('newCanvasName').value = 'Faz7';
      const f = document.getElementById('newCanvasForm'); if (f) f.requestSubmit();
    })()`);
    await sleep(1500);
    const s3b = JSON.parse(await evaluate(ws, `(function () {
      const link = document.querySelector('link[data-ui-skin="irix"]');
      return JSON.stringify({
        mode: document.getElementById('appModeBar').dataset.mode,
        skinAcik: !!link && link.disabled === false }) } )()`));
    check('IRIX draw modu (yeni tuval formu) → dataset.mode=draw + skin link açık',
      s3b.mode === 'draw' && s3b.skinAcik, JSON.stringify(s3b));

    await evaluate(ws, `document.getElementById('modeRefBtn').click()`);
    await sleep(700);
    const s3c = JSON.parse(await evaluate(ws, `(function () {
      const link = document.querySelector('link[data-ui-skin="irix"]');
      return JSON.stringify({
        mode: document.getElementById('appModeBar').dataset.mode,
        iface: document.documentElement.dataset.interface,
        skinAcik: !!link && link.disabled === false }) } )()`));
    check('IRIX reference dönüşü → dataset.mode=reference + skin link açık',
      s3c.mode === 'reference' && s3c.iface === 'irix' && s3c.skinAcik, JSON.stringify(s3c));

    /* ---- 4. Classic: kabuk sökülür, mod turu çökmesiz ---- */
    await evaluate(ws, `window.tailrefInterfaces.apply('classic')`);
    await sleep(300);
    await evaluate(ws, `document.getElementById('mode3dBtn').click()`);
    await sleep(600);
    await evaluate(ws, `document.getElementById('modeRefBtn').click()`);
    await sleep(600);
    const s4 = JSON.parse(await evaluate(ws, `(function () {
      const link = document.querySelector('link[data-ui-skin="irix"]');
      return JSON.stringify({
        iface: document.documentElement.dataset.interface || null,
        mode: document.getElementById('appModeBar').dataset.mode,
        skinKapali: !!link && link.disabled === true }) } )()`));
    check('Classic → skin link kapanır + mod turu çökmesiz (reference)',
      s4.iface === null && s4.mode === 'reference' && s4.skinKapali, JSON.stringify(s4));

    /* ---- 5. Kalıcılık: irix + reload ---- */
    await evaluate(ws, `window.dispatchEvent(new Event('focus'))`);
    await evaluate(ws, `window.tailrefInterfaces.apply('irix')`);
    await sleep(300);
    await send(ws, 'Page.reload', {});
    await sleep(2500);
    for (let i = 0; i < 10; i++) { try { if (await evaluate(ws, "typeof state !== 'undefined'")) break; } catch {} await sleep(500); }
    await evaluate(ws, `window.dispatchEvent(new Event('focus'))`);
    await sleep(200);
    const s5 = JSON.parse(await evaluate(ws, `(function () {
      const link = document.querySelector('link[data-ui-skin="irix"]');
      return JSON.stringify({
        iface: document.documentElement.dataset.interface || null,
        skinAcik: !!link && link.disabled === false,
        mode: document.getElementById('appModeBar').dataset.mode }) } )()`));
    const s5bg = await evaluate(ws, sameColorFn('#appModeBar', '--irix-face'));
    check('Reload → irix korunur + skin link yeniden açık + yüzey rengi',
      s5.iface === 'irix' && s5.skinAcik && s5bg === true, JSON.stringify(s5) + ' yüzey=' + s5bg);

    const fails = results.filter(r => !r.ok).length;
    console.log('\nARAYUZ-MOD: ' + (results.length - fails) + ' geçti, ' + fails + ' kaldı');
    process.exit(fails ? 1 : 0);
  } catch (e) {
    console.error('HATA:', e.message);
    process.exit(1);
  } finally {
    try { app.kill(); } catch { /* sessiz */ }
  }
})();
