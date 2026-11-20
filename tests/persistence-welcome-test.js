'use strict';
/* ======================================================================
   TailRef kapısı — "kaydetme modu" karşılama diyaloğu: iki seçenek de
   uçtan uca çalışıyor mu?
   ======================================================================
   Üç izole Electron profili, CDP:
   A) AUTO: diyalog görünür → Continue kilitli → seçim açar → auto
      modu yazılır → görsel eklenir → RELOAD'da görsel GERİ GELİR +
      diyalog bir daha sorulmaz (seçim hatırlanır).
   B) MANUAL: diyalog görünür → manual seçilir → görsel eklenir →
      RELOAD'da tahta BOŞ (26-projects _load sözleşmesi: manual modda
      açılışta hiçbir şey yüklenmez; .tail kaydetmeden çıkınca gider)
      + diyalog bir daha sorulmaz.
   C) ESCAPE: seçim yapmadan Escape → varsayılan auto ile kapanır.
   ====================================================================== */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** İzole örnek açar, hazır olunca { ws, kill } döner. */
async function boot(port, appPort) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-pw-'));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${port}`, '--no-sandbox'],
    { cwd: ROOT, env: { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(appPort), TailRef_TEST_SCREEN: '3' }, stdio: 'ignore' });
  let page = null;
  const t0 = Date.now();
  /* Yük altında pencere 30 sn'de açılmayabiliyor (gözlenen flaka); bu bir
     bekleme, iddia değil. */
  while (Date.now() - t0 < 60000 && !page) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = list.find(t => t.type === 'page' && t.url.includes(`:${appPort}`));
    } catch { /* henüz hazır değil */ }
    if (!page) await sleep(400);
  }
  if (!page) { try { app.kill(); } catch {} throw new Error('pencere açılmadı (port ' + port + ')'); }
  const ws = await connect(page.webSocketDebuggerUrl);
  await send(ws, 'Page.enable', {});
  for (let i = 0; i < 40; i++) { try { if (await evaluate(ws, "typeof state !== 'undefined'")) break; } catch {} await sleep(400); }
  /* ÖNEMLİ: bu kapı diyalogun KENDİNİ test eder — setPersistenceMode
     burada ÇAĞRILMAZ (diğer kapıların aksine). */
  return { ws, kill: () => { try { app.kill(); } catch {} } };
}

/** Karşılama diyaloğunun görünmesini bekler (taze profilde açılır). */
async function waitWelcome(ws) {
  for (let i = 0; i < 30; i++) {
    try {
      if (await evaluate(ws, "(function(){const e=document.getElementById('persistenceWelcome');return e&&!e.hidden;})()")) return true;
    } catch { /* pencere henüz kurulmadı */ }
    await sleep(400);
  }
  return false;
}

async function addTestImage(ws) {
  await evaluate(ws, `(async () => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#4da3ff'; g.fillRect(0, 0, 160, 120);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await addFiles([new File([blob], 'pw.png', { type: 'image/png' })], null);
  })()`);
  await sleep(1000);
}

const reload = async ws => {
  await send(ws, 'Page.reload', {});
  await sleep(2500);
  for (let i = 0; i < 10; i++) { try { if (await evaluate(ws, "typeof state !== 'undefined'")) break; } catch {} await sleep(500); }
};

(async () => {
  /* ---------- A) AUTO ---------- */
  try {
    const a = await boot(9419, 5281);
    try {
      const shown = await waitWelcome(a.ws);
      const gate = JSON.parse(await evaluate(a.ws, `JSON.stringify({
        continueDisabled: document.getElementById('pwContinue').disabled })`));
      check('A · taze profilde diyalog açılır + Continue kilitli (seçimsiz)', shown && gate.continueDisabled, JSON.stringify(gate));
      await evaluate(a.ws, `(function () {
        document.querySelector('#pwOptions .pwOption[data-mode="auto"]').click();
        document.getElementById('pwContinue').click();
      })()`);
      await sleep(500);
      const a1 = JSON.parse(await evaluate(a.ws, `JSON.stringify({
        hidden: document.getElementById('persistenceWelcome').hidden,
        mode: typeof getPersistenceMode === 'function' ? getPersistenceMode() : localStorage.getItem('tailref-persistence') })`));
      check('A · auto seçimi → diyalog kapanır + mod auto', a1.hidden && a1.mode === 'auto', JSON.stringify(a1));
      await addTestImage(a.ws);
      const n1 = await evaluate(a.ws, 'state.items.length');
      await reload(a.ws);
      const a2 = JSON.parse(await evaluate(a.ws, `JSON.stringify({
        items: state.items.length,
        welcome: !document.getElementById('persistenceWelcome').hidden,
        mode: typeof getPersistenceMode === 'function' ? getPersistenceMode() : localStorage.getItem('tailref-persistence') })`));
      check('A · reload → görsel geri geldi (auto kayıt) + diyalog YENİDEN sorulmaz',
        a2.items === n1 && a2.items >= 1 && !a2.welcome && a2.mode === 'auto', JSON.stringify(a2));
    } finally { a.kill(); }
  } catch (e) { check('A · auto senaryosu', false, e.message); }

  /* ---------- B) MANUAL ---------- */
  try {
    const b = await boot(9421, 5283);
    try {
      const shown = await waitWelcome(b.ws);
      check('B · diyalog açılır', shown, '');
      await evaluate(b.ws, `(function () {
        document.querySelector('#pwOptions .pwOption[data-mode="manual"]').click();
        document.getElementById('pwContinue').click();
      })()`);
      await sleep(500);
      const b1 = JSON.parse(await evaluate(b.ws, `JSON.stringify({
        hidden: document.getElementById('persistenceWelcome').hidden,
        mode: typeof getPersistenceMode === 'function' ? getPersistenceMode() : localStorage.getItem('tailref-persistence'),
        empty: state.items.length })`));
      check('B · manual seçimi → diyalog kapanır + mod manual + tahta boş',
        b1.hidden && b1.mode === 'manual' && b1.empty === 0, JSON.stringify(b1));
      await addTestImage(b.ws);
      const n1 = await evaluate(b.ws, 'state.items.length');
      await reload(b.ws);
      const b2 = JSON.parse(await evaluate(b.ws, `JSON.stringify({
        items: state.items.length,
        welcome: !document.getElementById('persistenceWelcome').hidden,
        mode: typeof getPersistenceMode === 'function' ? getPersistenceMode() : localStorage.getItem('tailref-persistence') })`));
      check('B · reload → tahta BOŞ (manual sözleşme: otomatik yükleme yok) + seçim hatırlanır',
        b2.items === 0 && !b2.welcome && b2.mode === 'manual', JSON.stringify(b2) + ' (eklenen=' + n1 + ')');
    } finally { b.kill(); }
  } catch (e) { check('B · manual senaryosu', false, e.message); }

  /* ---------- C) ESCAPE varsayılanı ---------- */
  try {
    const c = await boot(9423, 5285);
    try {
      const shown = await waitWelcome(c.ws);
      /* Escape dinleyicisi diyalog elemanının kendisinde — gerçek kullanıcı
         yolu: odak diyalogdayken Escape. */
      await evaluate(c.ws, `document.getElementById('persistenceWelcome').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await sleep(400);
      const c1 = JSON.parse(await evaluate(c.ws, `JSON.stringify({
        hidden: document.getElementById('persistenceWelcome').hidden,
        mode: typeof getPersistenceMode === 'function' ? getPersistenceMode() : localStorage.getItem('tailref-persistence') })`));
      check('C · Escape → diyalog kapanır + varsayılan auto', shown && c1.hidden && c1.mode === 'auto', JSON.stringify(c1));
    } finally { c.kill(); }
  } catch (e) { check('C · escape senaryosu', false, e.message); }

  const fails = results.filter(r => !r.ok).length;
  console.log('\nKAYIT-DIYALOG: ' + (results.length - fails) + ' geçti, ' + fails + ' kaldı');
  process.exit(fails ? 1 : 0);
})();
