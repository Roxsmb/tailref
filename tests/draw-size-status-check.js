'use strict';

/* Kontrol: çizim modunun sol-alt durum çubuğunda o anki tuvalin /
   referans görselin piksel boyutu görünür (kullanıcı isteği).
   inkRuntime.imageScopeId ile bağlamsal çizim kapsamı simüle edilir. */

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-drawsize-'));
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
    /* Uygulama varsayılan dili İngilizce; Türkçe metinleri sınamak için geç. */
    await evaluate(ws, "window.L10N ? window.L10N.setLang('tr') : 'no-l10n'");
    await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
    await sleep(700);
    await evaluate(ws, 'window.__errs = []; window.addEventListener("error", e => window.__errs.push(String(e.message || e))); true');

    results.scoped = await evaluate(ws, `(async () => {
      try {
        const c = document.createElement('canvas');
        c.width = 1234; c.height = 567;
        const x = c.getContext('2d');
        x.fillStyle = '#4a7fb0'; x.fillRect(0, 0, 1234, 567);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const imageId = 'img_size_probe';
        await idbPut('images', imageId, { blob, name: 'boyut-denek.png' });
        const entry = await decodeImage(blob);
        setImgCache(imageId, { img: entry.img, url: entry.url, name: 'boyut-denek.png' });
        const it = { id: 'it_size_probe', kind: 'image', imageId, title: 'Boyut Denek', x: 0, y: 0, w: 1234, h: 567, rot: 0, z: nextZ() };
        state.items.push(it);
        inkRuntime.imageScopeId = it.id;
        inkSyncScopeVisual();
        await new Promise(r => setTimeout(r, 150));
        const bar = document.getElementById('inkScopeBar');
        const size = document.getElementById('inkScopeSize');
        const name = document.getElementById('inkScopeName');
        const chip = document.getElementById('inkDocSize');
        /* Konum ölçümü çizim modu şerit CSS'iyle (body.mode-draw) yapılır:
           gerçek mod anahtarına geçmeden aynı kuralı doğrular. */
        document.body.classList.add('mode-draw');
        const r = chip.getBoundingClientRect();
        const posLeft = Math.round(r.left);
        const bottomGap = Math.round(innerHeight - r.bottom);
        document.body.classList.remove('mode-draw');
        return {
          barVisible: !bar.hidden,
          sizeText: size.textContent,
          sizeTitle: size.title,
          nameText: name.textContent,
          chipVisible: !chip.hidden,
          chipText: chip.textContent,
          chipTitle: chip.title,
          left: posLeft,
          bottomGap,
        };
      } catch (err) { return { err: String(err && err.message || err) }; }
    })()`);

    /* Dil değişimi ipucunu anında yenilemeli (eski dilde kalmamalı). */
    results.langSwitch = await evaluate(ws, `(function () {
      try {
        window.L10N.setLang('en');
        const size = document.getElementById('inkScopeSize');
        const en = size.title;
        window.L10N.setLang('tr');
        return { en, tr: size.title };
      } catch (err) { return { err: String(err && err.message || err) }; }
    })()`);

    results.unscoped = await evaluate(ws, `(function () {
      try {
        inkRuntime.imageScopeId = null;
        inkSyncScopeVisual();
        const chip = document.getElementById('inkDocSize');
        return { chipHidden: chip.hidden, chipText: chip.textContent };
      } catch (err) { return { err: String(err && err.message || err) }; }
    })()`);

    results.errs = await evaluate(ws, 'JSON.stringify(window.__errs)');
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

  const sc = num(results.scoped);
  ok('kapsam açık: çip görünür', sc.chipVisible === true, JSON.stringify(results.scoped));
  ok('çipte piksel boyutu (1234 × 567 px)', sc.chipText === '1234 × 567 px', sc.chipText);
  ok('çip sol-alt konumda', (sc.left || 999) <= 30 && (sc.bottomGap || 999) <= 16, `left=${sc.left} bottomGap=${sc.bottomGap}`);
  ok('durum çubuğu adı + ipucu dolu', sc.nameText === 'Boyut Denek' && String(sc.sizeTitle || '').includes('Çözünürlük'), `${sc.nameText} / ${sc.sizeTitle}`);
  const ls = num(results.langSwitch);
  ok('dil değişince ipucu yenilendi', String(ls.en || '').includes('Resolution') && String(ls.tr || '').includes('Çözünürlük'), JSON.stringify(results.langSwitch));
  const un = num(results.unscoped);
  ok('kapsam kapalı: çip gizli', un.chipHidden === true && un.chipText === '', JSON.stringify(results.unscoped));
  ok('sayfada hata yok', results.errs === '[]', results.errs);

  if (results.error) {
    console.log('HATA: ' + results.error);
    console.log(JSON.stringify(results, null, 1));
    process.exit(1);
  }
  process.exit(0);
})();
