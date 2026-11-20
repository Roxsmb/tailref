'use strict';

/* Kontrol: üç ayrı kullanıcı raporunun canlı doğrulaması.
   1) impWheel (Önemli renk çarkı) itemBar öne alındığında ALTINDA kalmıyordu:
      "altta kalıyor renk seçilmiyor" → çark host'unun z'sinin üstünde olmalı.
   2) inkHud referans moduna sızması: mod-draw dışında asla görünmez + show
      sınıfı anında kalkar; mode-draw'da yine gösterilir.
   3) #poseFrameAll ("Tümünü sığdır") UA beyaz görünümünden panel koyu stiline. */

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-panelmode-'));
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

    /* 1 · impWheel z-index: itemBar simüle-raised (utu örnek bandın tepesi) */
    results.wheelZ = await evaluate(ws, `(async () => {
      try {
        const c = document.createElement('canvas');
        c.width = 100; c.height = 100;
        const x = c.getContext('2d');
        x.fillStyle = '#4a7fb0'; x.fillRect(0, 0, 100, 100);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const imageId = 'img_z_probe';
        await idbPut('images', imageId, { blob, name: 'z.png' });
        const entry = await decodeImage(blob);
        setImgCache(imageId, { img: entry.img, url: entry.url, name: 'z.png' });
        const it = { id: 'it_z_probe', kind: 'image', imageId, title: 'z', x: 0, y: 0, w: 100, h: 100, rot: 0, z: nextZ() };
        state.items.push(it);
        selection = new Set([it.id]);
        selectionOrder = [it.id];
        syncAll(); syncSelection();
        const ib = document.getElementById('itemBar');
        ib.style.zIndex = '2860'; /* yüzen bandın en tepesi (140 x 4 + 2300) */
        positionImpWheel();
        await new Promise(r => setTimeout(r, 50));
        hideImpWheel();
        showImpWheel();
        positionImpWheel();
        const iw = document.getElementById('impWheel');
        return { itemZ: ib.style.zIndex, wheelZ: iw.style.zIndex, wheelHidden: iw.hidden };
      } catch (err) { return { err: String(err && err.message || err) }; }
    })()`);
    await evaluate(ws, `try { document.getElementById('itemBar').style.removeProperty('z-index'); } catch {} true`);

    /* 2 · inkHud: referans modunda çağrılmasa bir şey göstermemeli */
    results.hudReference = await evaluate(ws, `(function () {
      try {
        const hud = document.getElementById('inkHud');
        document.body.classList.remove('mode-draw');
        hud.classList.add('show'); /* bozuk durumu taklit et */
        inkUpdateHud();
        const afterRef = { show: hud.classList.contains('show') };
        document.body.classList.add('mode-draw');
        inkUpdateHud();
        const afterDraw = { show: hud.classList.contains('show') };
        document.body.classList.remove('mode-draw');
        return { afterRef, afterDraw };
      } catch (err) { return { err: String(err && err.message || err) }; }
    })()`);

    /* 3 · poseFrameAll teması: UA ButtonFace değil panel stili */
    results.fitStyle = await evaluate(ws, `(function () {
      try {
        const b = document.getElementById('poseFrameAll');
        if (!b) return 'düğme yok';
        const cs = getComputedStyle(b);
        return {
          background: cs.backgroundColor,
          borderColor: cs.borderColor,
          borderRadius: cs.borderRadius,
          cursor: cs.cursor,
        };
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

  const wz = num(results.wheelZ);
  ok('renk çarkı itemBar üstünde kalıyor', Number(wz.wheelZ) > Number(wz.itemZ) && wz.wheelHidden === false, JSON.stringify(results.wheelZ));
  const hr = num(results.hudReference).afterRef || {}, hd = num(results.hudReference).afterDraw || {};
  ok('inkHud referans modunda gizli', hr.show === false, JSON.stringify(results.hudReference));
  ok('inkHud çizim modunda gösterir', hd.show === true, null);
  const fs2 = num(results.fitStyle);
  ok('Tümünü sığdır panel stili (UA beyaz değil)', fs2.background && fs2.background.includes('rgba(255, 255, 255, 0.03)') && fs2.cursor === 'pointer', JSON.stringify(results.fitStyle));
  ok('sayfada hata yok', results.errs === '[]', results.errs);

  if (results.error) {
    console.log('HATA: ' + results.error);
    console.log(JSON.stringify(results, null, 1));
    process.exit(1);
  }
  process.exit(0);
})();
