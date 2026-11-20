'use strict';
/* K20 · vuruş kaybolma probe — video kayıt 01-33-23'te görülen:
   kalemi bırakınca çizim ~0.5–1 sn SONRA kendi kendine kayboluyor,
   bazen geri geliyor. Bu probe aynı akışı sürer ve katman raster'ını
   50 ms örneklemeyle izler; kaybolma/geri gelme anları, paint epoch
   değişimleri ve worker discard/error istatistikleri birlikte raporlanır.
   node scripts/stroke-vanish-probe.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9395;
const APP_PORT = 5251;
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
    throw new Error((d.exception && d.exception.description || d.text || 'eval').slice(0, 500));
  }
  return r.result.value;
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-vanish-'));
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
  })()`, 60000);

  await evaluate(ws, `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 640, 480);
    grad.addColorStop(0, '#26415f'); grad.addColorStop(1, '#5f2640');
    g.fillStyle = grad; g.fillRect(0, 0, 640, 480);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await addFiles([new File([blob], 'vanish-probe.png', { type: 'image/png' })], null);
    for (let i = 0; i < 40; i++) {
      if (state.items.some(it => it.kind === 'image')) break;
      await wait(150);
    }
    const item = state.items.find(it => it.kind === 'image');
    if (!item) throw new Error('görsel yok');
    modeEnterDraw(item.id);
    for (let i = 0; i < 40 && !inkEditorIsOpen(); i += 1) await wait(100);
    if (!inkEditorIsOpen()) throw new Error('editör açılamadı');
    return item.id;
  })()`, 60000);

  for (const brushId of ['native-studio-pen', 'native-watercolor', 'native-airbrush-soft']) {
    const repRaw = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const it = state.items.find(x => x.kind === 'image');
      const ink = inkState();
      const ui = inkEditorUi;
      const layer = inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'vanish' });
      ink.activeLayerId = layer.id;
      inkSetTool('brush', { brushId: ${JSON.stringify(brushId)} });
      ink.tool = 'brush';
      ink.color = '#ff2000';
      ink.size = Math.max(24, Math.round((NativeBrushLibrary.find(b => b.id === ${JSON.stringify(brushId)}) || {}).size) || 14);
      ink.opacity = 1;
      const rect = ui.canvas.getBoundingClientRect();
      const pt = p => ({ x: rect.left + ui.fit.x + ui.fit.w * p[0], y: rect.top + ui.fit.y + ui.fit.h * p[1] });
      const ev = (type, p, pr) => new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 777, pointerType: 'pen',
        isPrimary: true, pressure: pr, clientX: p.x, clientY: p.y,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      });
      const count = () => {
        const cvc = inkRuntime.itemCanvases.get(layer.id);
        if (!cvc) return 0;
        const d = cvc.getContext('2d').getImageData(0, 0, cvc.width, cvc.height).data;
        let n = 0;
        for (let j = 3; j < d.length; j += 4) if (d[j] > 8) n++;
        return n;
      };
      const before0 = { strokes: layer.strokes.length, epoch: inkPaintEpoch(layer.id), ws: inkWorkerStats() };
      const seg = [[0.22, 0.30], [0.34, 0.24], [0.46, 0.34], [0.58, 0.24], [0.70, 0.32], [0.80, 0.28]];
      const upTs = performance.now();
      ui.canvas.dispatchEvent(ev('pointerdown', pt(seg[0]), 0.55));
      for (let i = 1; i < seg.length; i++) {
        ui.canvas.dispatchEvent(ev('pointermove', pt(seg[i]), 0.55 + i * 0.08));
        await wait(24);
      }
      ui.canvas.dispatchEvent(ev('pointerup', pt(seg[5]), 0.75));
      // 4 saniye boyunca 50ms örnekle
      const series = [];
      for (let k = 0; k < 80; k++) {
        await wait(50);
        series.push({ t: Math.round(performance.now() - upTs), c: count(),
          e: inkPaintEpoch(layer.id), m: inkPaintMutations(layer.id) });
      }
      const after = { strokes: layer.strokes.length, epoch: inkPaintEpoch(layer.id), ws: inkWorkerStats() };
      layer.strokes = [];
      try { inkRemoveLayer(layer.id); } catch { }
      await wait(30);
      return JSON.stringify({ before0, after, series });
    })()`, 120000);
    console.log('\n=== ' + brushId + ' ===');
    const r = typeof repRaw === 'object' && repRaw !== null ? repRaw : JSON.parse(repRaw);
    console.log('strokes: ' + r.before0.strokes + ' → ' + r.after.strokes +
      ' · epoch: ' + r.before0.epoch + ' → ' + r.after.epoch +
      ' · worker: applied ' + (r.after.ws.applied - r.before0.ws.applied) +
      ' · discarded ' + (r.after.ws.discarded - r.before0.ws.discarded) +
      ' · errors ' + (r.after.ws.errors - r.before0.ws.errors) +
      ' · fallbacks ' + (r.after.ws.fallbacks - r.before0.ws.fallbacks));
    // özet serisi: yalnızca count VEYA epoch değiştiğinde satır bas
    let line = '';
    let lastC = null; let lastE = null;
    const marks = [];
    for (const s of r.series) {
      if (s.c !== lastC || s.e !== lastE) {
        marks.push(s.t + 'ms:' + s.c + (s.e !== lastE && lastE !== null ? '(e' + s.e + ')' : ''));
        lastC = s.c; lastE = s.e;
      }
    }
    console.log('değişim zinciri: ' + marks.join(' → '));
    const emptyAfterPaint = r.series.some(s => s.c > 0) && r.series[r.series.length - 1].c === 0;
    const vanish = (() => {
      for (let i = 1; i < r.series.length; i++) {
        if (r.series[i - 1].c > 200 && r.series[i].c === 0) return r.series[i].t + 'ms';
      }
      return null;
    })();
    console.log('KAYBOLMA: ' + (vanish ? 'VAR · ' + vanish : 'yok') + ' · ' +
      (emptyAfterPaint ? 'SON: BOŞ (kalıcı kayıp)' : 'SON: dolu ' + r.series[r.series.length - 1].c + ' px'));
  }

  try { await evaluate(ws, 'window.close()'); } catch { }
  app.kill();
  setTimeout(() => process.exit(0), 400);
})().catch(e => { console.error('HATA:', e.message); process.exit(1); });
