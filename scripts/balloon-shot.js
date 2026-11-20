'use strict';
/* Geçici probe: K9 canlı balonun görsel kanıtı — options bar'daki Boyut
   kaydırıcısına input dispatch, balon açılırken ekran görüntüsü.
   node scripts/balloon-shot.js  (çıktı: tmp\balloon.png) */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9377;
const APP_PORT = 5239;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (ws, expression) => {
  const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-balloon-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let page = null; const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !page) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
    } catch { /* bekle */ }
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('pencere açılmadı');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await sleep(4000);

  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1500, height: 940, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
  await sleep(900);
  await evaluate(ws, `document.getElementById('modeDrawBtn')?.click()`);
  await sleep(1200);
  let bodyCls = await evaluate(ws, `document.body.className`);
  if (!bodyCls.includes('mode-draw')) {
    await evaluate(ws, `(() => {
      const c = [...document.querySelectorAll('#appModeBar .modeBtn[data-mode="draw"], #modeDrawBtn, .modeBtn[data-mode="draw"]')];
      for (const b of c) { try { b.click(); } catch { } }
      return c.length;
    })()`);
    await sleep(1500);
    await evaluate(ws, `(() => {
      const ok = [...document.querySelectorAll('#newCanvasModal button')].find(b => (b.textContent || '').includes('Oluştur'));
      if (ok) ok.click();
    })()`);
    await sleep(1800);
    bodyCls = await evaluate(ws, `document.body.className`);
  }
  await sleep(600);
  await evaluate(ws, `(() => {
    const nc = document.getElementById('newCanvasModal'); if (nc) nc.hidden = true;
    const input = document.getElementById('v5opt_size');
    if (!input) throw new Error('v5opt_size yok');
    input.value = '52';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(420);
  const info = await evaluate(ws, `(() => {
    const box = document.getElementById('v5LivePreview');
    const r = box.getBoundingClientRect();
    const input = document.getElementById('v5opt_size');
    const ir = input.getBoundingClientRect();
    return { visible: !box.hidden, box: { x: r.x, y: r.y, w: r.width, h: r.height },
      input: { x: ir.x, y: ir.y, w: ir.width, h: ir.height },
      text: document.getElementById('v5LivePreviewVal').textContent };
  })()`);
  console.log('balon:', JSON.stringify(info));
  await send(ws, 'Page.captureScreenshot', { format: 'png' }).then(shot => {
    const out = path.join(ROOT, 'tmp-balloon-shot.png');
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('shot →', out);
  });
  app.kill();
  ws.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
