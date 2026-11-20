'use strict';
/* 0.5 ölçüm probe — tahta kayıt payload boyutu.
   ------------------------------------------------------------------
   auto-backup / .tail payload'unun bellek profili ölçülür:
     • boş tahta · tipik tahta (1 görsel) · ölçekleme senaryoları
       (20/100 görsel öğe · büyük görsel dataUrl enflasyonu)
   Kayıt yolu main.js auto-backup'a giden JSON dizgesinin uzunluğudur
   (src/app/04-persistence-view.js autoBackup kurgusu birebir).
   node scripts/save-size-probe.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9386;
const APP_PORT = 5244;
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
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    const desc = d.exception && d.exception.description || d.text || 'eval';
    throw new Error(desc + '  [@ ' + (d.scriptId || '?') + ' satır ' + d.lineNumber + ':' + d.columnNumber + ']');
  }
  return r.result.value;
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-savesize-'));
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
  await evaluate(ws, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 24; i++) {
      const w = document.getElementById('persistenceWelcome');
      if (w && !w.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
        await sleep(300);
        const w2 = document.getElementById('persistenceWelcome');
        if (!w2 || w2.hidden) return true;
        await sleep(400);
        continue;
      }
      await sleep(400);
    }
    return false;
  })()`);
  await sleep(600);

  const sizes = await evaluate(ws, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // 640×480 test PNG — tipik görsel ölçeği
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 640, 480);
    grad.addColorStop(0, '#26415f'); grad.addColorStop(1, '#5f2640');
    g.fillStyle = grad; g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#f0c060'; g.beginPath(); g.arc(320, 240, 90, 0, Math.PI * 2); g.fill();
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    const baseDoc = dataUrl.length; // 1 görselin dataUrl enflasyonu

    const buildPayload = (items, nImages) => {
      const images = [];
      for (let i = 0; i < nImages; i++) {
        images.push({ id: 'img_probe_' + i, name: 'probe-' + i + '.png', dataUrl });
      }
      const snap = createStateSnapshot();
      snap.items = items;
      const ws2 = workspaceManager && workspaceManager.ready ? workspaceManager.serializeWorkspace() : null;
      return JSON.stringify({
        version: 2, createdAt: new Date().toISOString(),
        state: snap, workspace: ws2, images,
      }).length;
    };
    const emptyState = createStateSnapshot();
    const emptyStateLen = JSON.stringify(emptyState).length;
    const mkItem = (i, w, h) => ({
      id: 'it_' + i, kind: 'image', x: 100 + (i % 8) * 90, y: 90 + Math.floor(i / 8) * 70,
      w: w || 360, h: h || 270, rot: 0, name: 'probe-' + i + '.png',
    });
    const empty = buildPayload([], 0);
    const one = buildPayload([mkItem(0)], 1);
    const twenty = buildPayload(Array.from({ length: 20 }, (_, i) => mkItem(i)), 20);
    const hundred = buildPayload(Array.from({ length: 100 }, (_, i) => mkItem(i)), 100);
    return JSON.stringify({
      emptyStateLen, pngDataUrl: baseDoc, empty, one, twenty, hundred,
    });
  })()`);
  const m = JSON.parse(sizes);

  const check = (name, ok, detail = '') =>
    console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
  check('boş tahta state küçük', m.emptyStateLen < 128 * 1024, m.emptyStateLen + ' B');
  check('1 görsel payload makul (< 1 MB)', m.one < 1024 * 1024, m.one + ' B · dataUrl ' + m.pngDataUrl + ' B');
  check('20 görsel payload ölçekli', m.twenty > m.one * 10 && m.twenty < m.one * 40,
    m.twenty + ' B ~ ' + (m.twenty / 1048576).toFixed(2) + ' MB');
  check('100 görsel payload ölçekli', m.hundred > m.twenty * 3,
    m.hundred + ' B ~ ' + (m.hundred / 1048576).toFixed(1) + ' MB');
  console.log('');
  console.log('ÖLÇÜM · boş state=' + m.emptyStateLen + ' B · PNG dataUrl=' + m.pngDataUrl +
    ' B · boş payload=' + m.empty + ' B · 1G=' + m.one + ' B · 20G=' + m.twenty +
    ' B (' + (m.twenty / 1048576).toFixed(2) + ' MB) · 100G=' + (m.hundred / 1048576).toFixed(1) + ' MB');

  try { await evaluate(ws, 'window.close()'); } catch { }
  app.kill();
  setTimeout(() => process.exit(0), 400);
})().catch(e => { console.error('HATA:', e.message); process.exit(1); });
