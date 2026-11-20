'use strict';

/* Kontrol: üst araç çubuğu katlanınca SEÇİM ÖZELLİKLERİ paneli de
   "çubuğun altına tucker" (kullanıcı isteği: onla beraber gizlensin,
   oraya doğru gidip blendlenip yok olsun; bar açılınca geri gelsin).
   1) Görsel seçiliyken panel açık → setBarCollapsed(true)
      → panel .fold-toward-bar alır, sonra gizlenir + dataset.tucked='1'
   2) Bar katlıyken seçim yapılsa da panel GİZLİ kalır
   3) setBarCollapsed(false) → panel .unfold-from-bar ile geri gelir
   4) CSS: itemBarTuck/itemBarUnfold keyframes + tuck kuralı CSSOM'da */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9341;
const APP_PORT = 5214;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const electronPath = () => path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

async function waitForTarget(deadlineMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { }
    await sleep(400);
  }
  throw new Error('hata ayıklama portu açılmadı');
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-bartuck-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  const results = {};
  let ws = null;
  try {
    const page = await waitForTarget();
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

    let ready = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try { ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth"); if (ready) break; } catch { }
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');
    await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
    await sleep(700);
    await evaluate(ws, 'window.__errs = []; window.addEventListener("error", e => window.__errs.push(String(e.message || e))); true');

    /* 1 · Denek görsel ekle + seç → panel açık olmalı */
    const added = await evaluate(ws, `(async () => {
      try {
        const c = document.createElement('canvas');
        c.width = 400; c.height = 300;
        const x = c.getContext('2d');
        x.fillStyle = '#4a7fb0'; x.fillRect(0, 0, 400, 300);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const imageId = 'img_tuck_probe';
        await idbPut('images', imageId, { blob, name: 'tuck-denek.png' });
        const entry = await decodeImage(blob);
        setImgCache(imageId, { img: entry.img, url: entry.url, name: 'tuck-denek.png' });
        const it = { id: 'it_tuck_probe', kind: 'image', imageId, title: 'tuck-denek', x: 0, y: 0, w: 400, h: 300, rot: 0, z: nextZ() };
        state.items.push(it);
        selection = new Set([it.id]);
        selectionOrder = [it.id];
        syncAll();
        syncSelection();
        await new Promise(r => setTimeout(r, 300));
        const ib = document.getElementById('itemBar');
        return { added: true, barHidden: ib.hidden };
      } catch (err) { return { added: false, err: String(err && err.message || err) }; }
    })()`);
    results.add = added;

    /* 2 · Bar'ı katla: panel fold sınıfı alır, sonra gizlenir + tucked.
       30ms örneklem: fold sonunda panelleaving'e geri dönüş ZIPLAMASI
       yok olmalı (kullanıcı: "bi geliyo bi gidiyo"). */
    results.collapseNow = await evaluate(ws, `(() => {
      try {
        const ib = document.getElementById('itemBar');
        setBarCollapsed(true);
        return { bodyCollapsed: document.body.classList.contains('bar-collapsed-ui'), foldClass: ib.classList.contains('fold-toward-bar') };
      } catch (err) { return { err: String(err && err.message || err) }; }
    })()`);
    results.foldSamples = await evaluate(ws, `(async () => {
      const ib = document.getElementById('itemBar');
      const samples = [];
      for (let i = 0; i < 28; i++) {
        const cs = getComputedStyle(ib);
        samples.push((ib.hidden ? 'H' : 'V') + '|' + Math.round(Number(cs.opacity) * 100) + '|' + ib.className.replace(/\\s+/g, '.'));
        await new Promise(r => setTimeout(r, 30));
      }
      return samples;
    })()`);
    await sleep(700);
    results.afterCollapse = await evaluate(ws, `(() => {
      const ib = document.getElementById('itemBar');
      return { hidden: ib.hidden, tucked: ib.dataset.tucked || null,
               foldClass: ib.classList.contains('fold-toward-bar'),
               tuckVar: ib.style.getPropertyValue('--tuck-up') || null };
    })()`);

    /* 3 · Bar katlıyken seçimi tazele: panel GİZLİ kalmalı */
    results.reselectWhileCollapsed = await evaluate(ws, `(async () => {
      try {
        selection = new Set(['it_tuck_probe']);
        selectionOrder = ['it_tuck_probe'];
        syncSelection();
        updateItemBar();
        await new Promise(r => setTimeout(r, 250));
        const ib = document.getElementById('itemBar');
        return { hidden: ib.hidden, tucked: ib.dataset.tucked || null };
      } catch (err) { return { err: String(err && err.message || err) }; }
    })()`);

    /* 4 · Bar'ı aç: panel unfold ile geri gelir */
    results.expandNow = await evaluate(ws, `(() => {
      try {
        const ib = document.getElementById('itemBar');
        setBarCollapsed(false);
        return { bodyCollapsed: document.body.classList.contains('bar-collapsed-ui'), unfoldClass: ib.classList.contains('unfold-from-bar') };
      } catch (err) { return { err: String(err && err.message || err) }; }
    })()`);
    await sleep(700);
    results.afterExpand = await evaluate(ws, `(() => {
      const ib = document.getElementById('itemBar');
      return { hidden: ib.hidden, tucked: ib.dataset.tucked || null,
               unfoldClass: ib.classList.contains('unfold-from-bar') };
    })()`);

    /* 5 · CSS var mı */
    results.css = await evaluate(ws, `(() => {
      let animRule = false, unfoldRule = false, kfTuck = false, kfUnfold = false;
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const r of rules) {
          const t = r.cssText || '';
          if (t.includes('#itemBar.fold-toward-bar') && t.includes('animation')) animRule = true;
          if (t.includes('#itemBar.unfold-from-bar') && t.includes('animation')) unfoldRule = true;
          if (t.startsWith('@keyframes itemBarTuck')) kfTuck = true;
          if (t.startsWith('@keyframes itemBarUnfold')) kfUnfold = true;
        }
      }
      return JSON.stringify({ animRule, unfoldRule, kfTuck, kfUnfold });
    })()`);

    results.errs = await evaluate(ws, 'JSON.stringify(window.__errs)');

    /* 6 · Yeni istek: bar KAPALIYKEN (seçimsiz) seçim yapılsa da panel
       tucked'a kaydolur; bar açılınca panel gelir. Bar kapalı başlat. */
    await evaluate(ws, `(function() {
      selection = new Set(); selectionOrder = [];
      syncSelection(); updateItemBar();
      setBarCollapsed(true);
      return true;
    })()`);
    await sleep(650);
    results.expandAfterDarkSelect = await evaluate(ws, `(async () => {
      const ib = document.getElementById('itemBar');
      selection = new Set(['it_tuck_probe']);
      selectionOrder = ['it_tuck_probe'];
      syncSelection(); updateItemBar();
      await new Promise(r => setTimeout(r, 200));
      return { hiddenWhileCollapsed: ib.hidden, tucked: ib.dataset.tucked || null };
    })()`);
    const expandOut = await evaluate(ws, `(function() {
      try {
        setBarCollapsed(false);
        return { unfold: document.getElementById('itemBar').classList.contains('unfold-from-bar') };
      } catch (err) { return { err: String(err && err.message || err) }; }
    })()`);
    await sleep(700);
    results.expandAfterDarkSelectOut = { ...expandOut, ...(await evaluate(ws, `(() => { const ib = document.getElementById('itemBar'); return { hidden: ib.hidden, tucked: ib.dataset.tucked || null }; })()`)) };

    /* Daima bar açık bırak (temiz kapanış) */
    await evaluate(ws, 'try { setBarCollapsed(false); } catch { } true');
  } catch (e) {
    results.error = e.message;
  } finally {
    try { ws && ws.close(); } catch { }
    try { app.kill(); } catch { }
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { }
  }

  const ok = (name, cond, detail) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}  ${detail == null ? '' : '→ ' + detail}`);
  const num = v => (v && typeof v === 'object') ? v : {};

  ok('denek görsel eklendi, panel açık', num(results.add).added === true, JSON.stringify(results.add));
  ok('katlırken panel fold sınıfı aldı', num(results.collapseNow).foldClass === true && num(results.collapseNow).bodyCollapsed === true, JSON.stringify(results.collapseNow));
  ok('katlanınca panel gizlendi + tucked işareti', num(results.afterCollapse).hidden === true && num(results.afterCollapse).tucked === '1', JSON.stringify(results.afterCollapse));
  ok('bar katlıyken seçim paneli açmıyor (gizli kalır)', num(results.reselectWhileCollapsed).hidden === true && num(results.reselectWhileCollapsed).tucked === '1', JSON.stringify(results.reselectWhileCollapsed));
  ok('bar açılırken unfold sınıfı geldi', num(results.expandNow).unfoldClass === true && num(results.expandNow).bodyCollapsed === false, JSON.stringify(results.expandNow));
  ok('bar açılınca panel geri geldi', num(results.afterExpand).hidden === false && num(results.afterExpand).tucked === null, JSON.stringify(results.afterExpand));
  {
    const s = Array.isArray(results.foldSamples) ? results.foldSamples : [];
    const geri = s.filter(t => t.includes('panel-leaving') || (t.startsWith('V|9') && !t.includes('fold')));
    ok('fold sonrası görünürlük zıplaması yok (akıcı kayboluş)', s.length === 28 && geri.length === 0, geri.length ? geri.join(' ; ') : s.join(' '));
  }
  ok('bar kapalı başlarken seçim → tucked (gizli kalır)', num(results.expandAfterDarkSelect).hiddenWhileCollapsed === true && num(results.expandAfterDarkSelect).tucked === '1', JSON.stringify(results.expandAfterDarkSelect));
  ok('bar açılınca seçimden sonra panel gelir', num(results.expandAfterDarkSelectOut).hidden === false && num(results.expandAfterDarkSelectOut).tucked === null, JSON.stringify(results.expandAfterDarkSelectOut));
  const css = (() => { try { return JSON.parse(results.css || '{}') } catch { return {} } })();
  ok('tuck CSS var (kural + keyframes)', css.animRule && css.unfoldRule && css.kfTuck && css.kfUnfold, results.css);
  ok('sayfada hata yok', results.errs === '[]', results.errs);

  if (results.error) {
    console.log('HATA: ' + results.error);
    console.log(JSON.stringify(results, null, 1));
    process.exit(1);
  }
  process.exit(0);
})();
