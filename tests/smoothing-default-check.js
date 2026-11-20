'use strict';

/* Yumuşatma varsayılan doğrulaması: setActiveBrush her fırça için
   yumuşatmayı %5'e (0.05) getirmeli; kütüphane ön ayarındaki %50-58
   değerleri artık uygulanmamalı. Sürgü etiketi de %5 göstermeli.
   Kullanım: node tests/smoothing-default-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9359;
const APP_PORT = 5241;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (m.error) return reject(new Error(JSON.stringify(m.error)));
    if (m.result.exceptionDetails) {
      return reject(new Error(m.result.exceptionDetails.exception?.description || 'eval'));
    }
    resolve(m.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true } }));
});

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoothing-check-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let bad = 0;
  try {
    let page = null;
    for (let i = 0; i < 120; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
        if (page) break;
      } catch { /* yok */ }
      await sleep(100);
    }
    if (!page) { console.log('HATA: sayfa yok'); return; }
    const ws = await new Promise((res, rej) => {
      const s = new WebSocket(page.webSocketDebuggerUrl);
      s.onopen = () => res(s);
      s.onerror = rej;
    });
    for (let i = 0; i < 40; i += 1) {
      const ok = await evaluate(ws, "typeof inkState === 'function' && typeof setActiveBrush === 'function'").catch(() => false);
      if (ok) break;
      await sleep(400);
    }

    const report = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      await wait(400);
      const out = { brushes: [] };
      const ink = inkState();
      const ids = ink.brushes.map(b => b.id).slice(0, 8);
      for (const id of ids) {
        const b = setActiveBrush(id);
        await wait(20);
        const val = inkState().smoothing;
        const label = document.getElementById('inkSmoothingVal');
        out.brushes.push({
          id, onAyarY: b ? Math.round((b.smoothing || 0) * 100) : null,
          uygulanan: Math.round(val * 100),
          etiket: label ? label.textContent : '',
        });
      }
      const slider = document.getElementById('inkSmoothing');
      out.surgu = slider ? slider.value : '';
      return JSON.stringify(out);
    })()`));
    console.log('rapor: ' + JSON.stringify(report));
    for (const b of report.brushes) {
      const good = b.uygulanan === 5 && b.etiket === '5%';
      if (!good) bad += 1;
      console.log((good ? 'OK  ' : 'HATA') + '  ' + b.id +
        ' · ön ayar=' + b.onAyarY + '% · uygulanan=' + b.uygulanan +
        '% · etiket=' + b.etiket);
    }
    console.log(bad === 0 ? 'TÜM FIRÇALAR %5' : (bad + ' FIRÇA BOZUK'));
  } catch (e) {
    console.error('HATA:', e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(200);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
