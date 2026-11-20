'use strict';
/* K20 · vanish-ayırım probe — videodaki "bırakınca çizip sonra kaybolan
   vuruş" ekran kaybı mı veri kaybı mı?
   Eş zamanlı ölçüm:
     • backing: item canvas getImageData alfa sayısı (veri)
     • ekran  : Page.captureScreenshot JPEG dizisi (sunum)
   Senaryo videoya birebir: (A ince vuruş + 1.5 sn bekleme) →
   (sağ tık radyal fırça seçimi) → (B kalın vuruş) → 3 sn bekleme.
   Ekran kareleri temp'e yazılır; montajı vidcap driver'ı gibi okuruz.
   node scripts/vanish-divide-probe.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9396;
const APP_PORT = 5253;
const OUT = path.join(os.tmpdir(), 'opencode', 'vanish-shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const send = (ws, method, params = {}, timeout = 240000) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), timeout);
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
const evaluate = async (ws, expression, timeout) => {
  const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && d.exception.description || d.text || 'eval').slice(0, 400));
  }
  return r.result.value;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-vanish2-'));
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
  await send(ws2 = mkWs(mainPage), 'Page.enable');

  function mkWs(page) {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    return ws;
  }
  const ws = ws2;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await sleep(4000);
  await evaluate(ws, welcomeOnce, 60000);
  await evaluate(ws, `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 640, 480);
    grad.addColorStop(0, '#26415f'); grad.addColorStop(1, '#5f2640');
    g.fillStyle = grad; g.fillRect(0, 0, 640, 480);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await addFiles([new File([blob], 'vd.png', { type: 'image/png' })], null);
    for (let i = 0; i < 40; i++) {
      if (state.items.some(it => it.kind === 'image')) break;
      await wait(150);
    }
    const item = state.items.find(it => it.kind === 'image');
    if (!item) throw new Error('görsel yok');
    modeEnterDraw(item.id);
    for (let i = 0; i < 40 && !inkEditorIsOpen(); i += 1) await wait(100);
    if (!inkEditorIsOpen()) throw new Error('editör açılamadı');
    return JSON.stringify({ id: item.id, fit: inkEditorUi.fit });
  })()`, 60000);

  // vuruş sürücüsü — sayfa içinde zamanlarla gerçekçi
  const drawInPage = (brushId, color, size, t0, t1, pressure) => `
    (async () => {
      const ink = inkState();
      const ui = inkEditorUi;
      const rect = ui.canvas.getBoundingClientRect();
      const pt = p => ({ x: rect.left + ui.fit.x + ui.fit.w * p[0], y: rect.top + ui.fit.y + ui.fit.h * p[1] });
      const ev = (type, p, pr) => new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 888, pointerType: 'pen',
        isPrimary: true, pressure: pr, clientX: p.x, clientY: p.y,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      });
      const seg = [[0.20, 0.34], [0.30, 0.22], [0.40, 0.36], [0.52, 0.22], [0.62, 0.34], [0.74, 0.26]];
      inkSetTool('brush', { brushId: ${JSON.stringify(brushId)} });
      ink.tool = 'brush';
      ink.color = ${JSON.stringify(color)};
      ink.size = ${size};
      ink.opacity = 1;
      ui.canvas.dispatchEvent(ev('pointerdown', pt(seg[0]), ${pressure}));
      for (let i = 1; i < seg.length; i++) {
        ui.canvas.dispatchEvent(ev('pointermove', pt(seg[i]), ${pressure}));
        await new Promise(r => setTimeout(r, Math.round(${Math.round(((t1 - t0) / 5) * 100) / 1000} * 1000)));
      }
      ui.canvas.dispatchEvent(ev('pointerup', pt(seg[5]), ${pressure}));
      return true;
    })()`;

  // senaryo adımları: t(ms) → iş + ekran/backing örnekleme
  const plan = [];
  plan.push({ at: 0, run: drawInPage('native-studio-pen', '#ff2000', 8, 0, 900, 0.6) });
  plan.push({ at: 3200, run: `(async () => { if (inkEditorIsOpen()) { /* sağ tık radyal simülasyonu */ const ev0 = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 889, pointerType: 'mouse', isPrimary: true, clientX: 240, clientY: 240 }); const ev1 = new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 2, buttons: 0, pointerId: 889, pointerType: 'mouse', isPrimary: true, clientX: 240, clientY: 240 }); inkEditorUi.canvas.dispatchEvent(ev0); await new Promise(r => setTimeout(r, 250)); inkEditorUi.canvas.dispatchEvent(ev1); return !!document.getElementById('inkRadial'); } })()` });
  plan.push({ at: 5000, run: drawInPage('native-chalk-hard', '#ff7a00', 40, 5000, 6200, 0.8) });
  plan.push({ at: 7200, watch: true });

  // backing örnekleme fonksiyonu (sayfada): aktif katman item canvas alfa sayısı
  const sampleFn = `(() => {
    const ink = inkState();
    const ui = inkEditorUi;
    const layer = inkEditorUi.layerId ? inkLayerById(inkEditorUi.layerId) : null;
    if (!layer) return -1;
    const cv = inkRuntime.itemCanvases.get(layer.id);
    if (!cv) return 0;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let j = 3; j < d.length; j += 4) if (d[j] > 8) n++;
    return n;
  })()`;

  const timeline = [];
  let pending = null;
  const t0 = Date.now();
  plan.forEach(step => { pending = plan.shift(); });
  for (let i = 0; i < 60; i++) {
    const tms = Date.now() - t0;
    // vuruş adımı vakti geldiyse çalıştır
    const todo = plan.find(s => s.at >= 0 && s.at <= tms && !s.done);
    if (todo) {
      todo.done = true;
      await evaluate(ws, todo.run, 20000);
    }
    const backing = await evaluate(ws, sampleFn, 20000);
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'jpeg', quality: 62 }, 20000);
    fs.writeFileSync(path.join(OUT, 's' + String(i).padStart(3, '0') + '.jpg'), Buffer.from(shot.data, 'base64'));
    timeline.push({ t: Math.round(tms), backing });
    await sleep(300);
  }
  const series = timeline.filter((v, i) => i === 0 || v.backing !== timeline[i - 1].backing);
  console.log('backing değişim zinciri:');
  for (const s of series) console.log('  ' + s.t + 'ms → ' + s.backing);
  // Screen görsel değerlendirmesi node tarafında yapılmaz; kareler temp'te.
  try { await evaluate(ws, 'window.close()'); } catch { }
  app.kill();
  setTimeout(() => process.exit(0), 400);
})().catch(e => { console.error('HATA:', e.message); process.exit(1); });
