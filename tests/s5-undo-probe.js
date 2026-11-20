'use strict';
/* =========================================================
   s5-undo-probe.js — ref-stress-audit S5 (tahta undo/redo)
   darboğaz ayrıştırma: restoreSnapshot / syncAll / applyView
   / applyBackdrop süre bölünmesi + createItemEl sayacı.
   KAPI DEĞİL — tanısal probe.
   Kullanım: node tests/s5-undo-probe.js
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9354;
const APP_PORT = 5224;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const electronPath = () => path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) {
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatasi'));
    }
    const v = msg.result.result.value;
    resolve(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

async function waitForTarget(deadlineMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henuz degil */ }
    await sleep(400);
  }
  throw new Error('debug portu acilmadi (9354)');
}
function connect(page) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}
async function hazirla(ws) {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  const dk = Date.now() + 60000;
  let ready = false;
  while (Date.now() < dk) {
    ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth");
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('renderer hazir olmad');

  await evaluate(ws, `(() => {
    if (window.__lt) return true;
    window.__lt = { n: 0, ms: 0, max: 0 };
    try {
      window.__ltObs = new PerformanceObserver(l => {
        for (const e of l.getEntries()) {
          window.__lt.n++;
          window.__lt.ms += e.duration;
          if (e.duration > window.__lt.max) window.__lt.max = e.duration;
        }
      });
      window.__ltObs.observe({ entryTypes: ['longtask'] });
    } catch { /* longtask desteklenmiyor */ }
    return true;
  })()`);

  let kapandi = false;
  for (let i = 0; i < 60 && !kapandi; i += 1) {
    kapandi = await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (!w || w.hidden) return true;
      if (!document.querySelector('.pwOption.is-selected')) {
        const opt = document.querySelector('.pwOption[data-mode="auto"]');
        if (opt) opt.click();
      }
      const btn = document.getElementById('pwContinue');
      if (btn && !btn.disabled) btn.click();
      return !!w.hidden;
    })()`);
    if (!kapandi) await sleep(500);
  }
}

/* Sahnede: 10 büyük görsel + aralarında pushUndo → ~8-10 kayıt derinlik */
const KUR = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let eklenen = 0;
  for (let b = 0; b < 2; b += 1) {
    for (let k = 0; k < 5; k += 1) {
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 900;
      const cx = c.getContext('2d');
      const g = cx.createLinearGradient(0, 0, 1200, 900);
      const hue = (b * 5 + k) * 25;
      g.addColorStop(0, 'hsl(' + hue + ',75%,55%)');
      g.addColorStop(1, 'hsl(' + (hue + 60) + ',80%,30%)');
      cx.fillStyle = g;
      cx.fillRect(0, 0, 1200, 900);
      for (let q = 0; q < 30; q += 1) {
        cx.fillStyle = 'rgba(255,255,255,' + (q % 3 ? 0.2 : 0.5) + ')';
        cx.fillRect((q * 97) % 1150, (q * 61) % 850, 80, 50);
      }
      const blob = await new Promise(r2 => c.toBlob(r2, 'image/png'));
      if (!blob) throw new Error('toBlob bos');
      const name = 'S5P-' + b + '-' + k + '.png';
      const imageId = 'img_' + newId();
      state.items.push({ id: newId(), kind: 'image', name, imageId,
        src: URL.createObjectURL(blob), x: 40 + eklenen * 30, y: 40 + (eklenen % 5) * 60,
        w: 420, h: 315, rot: 0, alpha: 1, gray: 0, bright: 1, locked: false });
      eklenen++;
      await wait(60);
    }
    pushUndo();
    await wait(80);
  }
  /* birkaç taşıma kaydı (snapshot-entry undo yolu) */
  for (let m = 0; m < 4; m += 1) {
    for (const it of state.items) { it.x += 14; it.y += 9; }
    pushUndo();
    await wait(50);
  }
  return { items: state.items.length, undo: undoStack.length };
})()`;

/* Ölçüm montajı: global fonksiyon bildirimleri üzerine sarım */
const MONTAJ = `(() => {
  if (window.__m) return true;
  window.__m = { rs: [], sa: [], av: [], ab: [], create: [], n: 0, tot: [] };
  const RS = restoreSnapshot, SA = syncAll, AV = applyView, AB = applyBackdrop, CE = createItemEl;
  restoreSnapshot = s => { const t = performance.now(); RS(s); __m.rs.push(Math.round(performance.now() - t)); };
  syncAll = () => { const t = performance.now(); SA(); __m.sa.push(Math.round(performance.now() - t)); };
  applyView = () => { const t = performance.now(); AV(); __m.av.push(Math.round(performance.now() - t)); };
  applyBackdrop = () => { const t = performance.now(); AB(); __m.ab.push(Math.round(performance.now() - t)); };
  createItemEl = it => { const t = performance.now(); const el = CE(it); __m.create.push(Math.round(performance.now() - t)); return el; };
  const _undo = undo, _redo = redo;
  undo = () => { const t = performance.now(); _undo(); __m.tot.push(Math.round(performance.now() - t)); __m.n++; };
  redo = () => { const t = performance.now(); _redo(); __m.tot.push(Math.round(performance.now() - t)); __m.n++; };
  return true;
})()`;

const OKU = `(() => {
  const ist = a => a.length ? { n: a.length, ort: Math.round(a.reduce((x, y) => x + y, 0) / a.length),
    max: Math.max(...a), top: a.reduce((x, y) => x + y, 0) } : { n: 0 };
  const m = window.__m || {};
  const o = { undo: ist(m.tot || []), restore: ist(m.rs || []), syncAll: ist(m.sa || []),
    applyView: ist(m.av || []), backdrop: ist(m.ab || []), createEl: ist(m.create || []) };
  if (window.__m) { window.__m.rs = []; window.__m.sa = []; window.__m.av = [];
    window.__m.ab = []; window.__m.create = []; window.__m.tot = []; }
  const lt = window.__lt || { n: 0, ms: 0, max: 0 };
  window.__lt = { n: 0, ms: 0, max: 0 };
  o.lt = { n: lt.n, ms: Math.round(lt.ms), max: Math.round(lt.max) };
  return o;
})()`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-s5p-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);

    const kur = JSON.parse(await evaluate(ws, KUR));
    console.log('kurulum: ' + JSON.stringify(kur));
    await evaluate(ws, MONTAJ);

    /* S5 benzeri spam: 30 undo + 20 redo */
    const spam = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      let u = 0, rr = 0;
      for (let i = 0; i < 30 && undoStack.length; i += 1) { undo(); u++; await wait(20); }
      for (let i = 0; i < 20 && redoStack.length; i += 1) { redo(); rr++; await wait(20); }
      return { u, rr };
    })()`));
    console.log('spam: ' + JSON.stringify(spam));
    console.log('OLCUM: ' + JSON.stringify(JSON.parse(await evaluate(ws, OKU))));

    /* ikinci tur — cache ısınmış halde (ilk tur DOM/cache doldurdu) */
    const spam2 = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      let u = 0, rr = 0;
      for (let i = 0; i < 20 && undoStack.length; i += 1) { undo(); u++; await wait(20); }
      for (let i = 0; i < 20 && redoStack.length; i += 1) { redo(); rr++; await wait(20); }
      return { u, rr };
    })()`));
    console.log('spam2: ' + JSON.stringify(spam2));
    console.log('OLCUM2: ' + JSON.stringify(JSON.parse(await evaluate(ws, OKU))));

  } catch (e) {
    console.error('S5P HATASI: ' + (e && e.message ? e.message.slice(0, 300) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* son nefes */ }
    await sleep(300);
  }
})();
