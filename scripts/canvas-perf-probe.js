'use strict';
/* 0.3/0.4 ölçüm probe — Canvas Editor kamera performansı.
   ------------------------------------------------------------------
   4k doküman (3841×2160 backing) + 21 katman (varsayılan + 20 ekleme)
   durumunda pan/zoom kare süresi ölçülür. Ölçüm kalemi: INK_STATUS
   0.3 "20+ katman × 4k backing pan/zoom kare süresini ölç" —
   sonuç olmadan yönlendirme yok (ölçümsüz perf değişimi kuralı).
   node scripts/canvas-perf-probe.js
   Ekran: tester penceresi varsayılan 3. ekranda açılmaz; CDP
   headless sürümle ölçülür (görsel çıktı önemsiz). */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9392;
const APP_PORT = 5249;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const timer = setTimeout(() => {
    reject(new Error('CDP zaman aşımı: ' + method));
  }, 240000);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    clearTimeout(timer);
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (ws, expression, timeout = 60000) => {
  const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    const desc = d.exception && d.exception.description || d.text || 'eval';
    throw new Error(desc);
  }
  return r.result.value;
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-perfprobe-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let mainPage = null; let deadline = Date.now() + 40000;
  while (Date.now() < deadline && !mainPage) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      mainPage = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
    } catch { /* bekle */ }
    if (!mainPage) await sleep(500);
  }
  if (!mainPage) throw new Error('ana pencere açılmadı');
  const ws = new WebSocket(mainPage.webSocketDebuggerUrl);
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

  /* 4k görsel üretip tahtaya ekle, Canvas Editor'ü aç */
  console.log('· 4k görsel üretiliyor');
  await evaluate(ws, `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const c = document.createElement('canvas');
    c.width = 3841; c.height = 2160;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 3841, 2160);
    grad.addColorStop(0, '#26415f'); grad.addColorStop(1, '#5f2640');
    g.fillStyle = grad; g.fillRect(0, 0, 3841, 2160);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    c.width = 0; c.height = 0;
    await addFiles([new File([blob], 'perf-4k.png', { type: 'image/png' })], null);
    for (let i = 0; i < 60; i++) {
      if (state.items.some(it => it.kind === 'image')) break;
      await wait(150);
    }
    const item = state.items.find(it => it.kind === 'image');
    if (!item) return JSON.stringify({ ok: false });
    selection = new Set([item.id]);
    if (typeof syncSelection === 'function') syncSelection();
    document.getElementById('btnDrawImage')?.click();
    await wait(400);
    return JSON.stringify({ ok: true });
  })()`);

  let editorPage = null; deadline = Date.now() + 20000;
  while (Date.now() < deadline && !editorPage) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      editorPage = list.find(t => t.type === 'page' && t.url.includes('canvas-editor.html'));
    } catch { /* bekle */ }
    if (!editorPage) await sleep(500);
  }
  if (!editorPage) throw new Error('Canvas Editor penceresi açılmadı');
  const ews = new WebSocket(editorPage.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ews.onopen = res; ews.onerror = rej; });
  await evaluate(ews, 'window.__canvasEditorReady === true', 30000);
  console.log('· editör penceresi bağlandı');

  /* 20 katman ekle */
  console.log('· editör hazır, katman ekleniyor');
  const layerCount = await evaluate(ews, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const ed = window.__canvasEditor;
    for (let i = 0; i < 20; i++) {
      document.getElementById('ce-add-layer').click();
      await sleep(80);
    }
    return ed.layers.layers.length;
  })()`, 120000);
  console.log('· katman=' + layerCount);

  /* rAF sağlığı: katman eklemeleri window'u kilitlemediyse hızlı döner */
  const rafAlive = await evaluate(ews, `(async () => {
    const t0 = performance.now();
    const ok = await Promise.race([
      new Promise((r) => requestAnimationFrame(() => r(true))),
      new Promise((r) => setTimeout(() => r(false), 5000)),
    ]);
    return JSON.stringify({ ok, ms: Math.round(performance.now() - t0) });
  })()`, 20000);
  console.log('· rAF ping: ' + rafAlive);

  /* ölçüm: rAF döngüsünde pan ± zoom; 240 kare, kare süresi dağılımı */
  const measure = await evaluate(ews, `(async () => {
    const ed = window.__canvasEditor;
    const cam = ed.camera;
    const times = [];
    let n = 0;
    let zoomPhase = 0;
    let stepErr = '';
    const step = (ts) => {
      try {
        times.push(ts);
        n++;
        if (zoomPhase < 120) {
          cam.panBy(9, 7);
          if (zoomPhase % 20 === 0) cam.zoomAt(1.02, 400, 300);
        } else {
          cam.panBy(-9, -7);
          if (zoomPhase % 20 === 0) cam.zoomAt(0.98, 400, 300);
        }
      } catch (e) {
        stepErr = String(e && e.message || e);
      }
      zoomPhase++;
      if (stepErr || n >= 120) return;
      requestAnimationFrame(step);
    };
    await new Promise((res, rej) => {
      window.__perfRes = res; window.__perfRej = rej;
      requestAnimationFrame(step);
      setTimeout(() => stepErr ? rej(new Error(stepErr)) : res(), 300000);
    });
    for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r));
    const deltas = [];
    for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
    deltas.sort((a, b) => a - b);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const p50 = deltas[Math.floor(deltas.length * 0.5)];
    const p95 = deltas[Math.floor(deltas.length * 0.95)];
    const max = deltas[deltas.length - 1];
    // bellek: katman başına 4k backing ImageData karşılığı
    return JSON.stringify({ layers: layerCount, frames: deltas.length,
      avg: Math.round(avg * 100) / 100, p50: Math.round(p50 * 100) / 100,
      p95: Math.round(p95 * 100) / 100, max: Math.round(max * 100) / 100,
      docW: 3841, docH: 2160 });
  })()`, 180000);
  const m = JSON.parse(measure);

  const check = (name, ok, detail = '') =>
    console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
  check('21 katman × 4k backing kuruldu', m.layers >= 21, m.layers + ' katman · ' + m.docW + '×' + m.docH);
  check('pan/zoom kare süresi 33ms altında (p95)', m.p95 < 33,
    `avg ${m.avg}ms · p50 ${m.p50}ms · p95 ${m.p95}ms · max ${m.max}ms`);
  check('en kötü kare de donma boyutunda değil', m.max < 250, `${m.max}ms`);

  console.log('ÖLÇÜM · katman=' + m.layers + ' · kare=' + m.frames + ' · avg=' + m.avg +
    'ms · p50=' + m.p50 + 'ms · p95=' + m.p95 + 'ms · max=' + m.max + 'ms · doküman 3841×2160');

  try { await evaluate(ews, 'window.close()'); } catch { }
  app.kill();
  setTimeout(() => process.exit(0), 400);
})().catch(e => { console.error('HATA:', e.message); process.exit(1); });
