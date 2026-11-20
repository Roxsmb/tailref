'use strict';
/* =========================================================
   heap-canvas-inventory.js — byte-pool FAZ 6.S tepki öncesi
   heap muhasebesi (probe — kapı DEĞİL)
   ---------------------------------------------------------
   Yöntem: Page.addScriptToEvaluateOnNewDocument ile
   document.createElement('canvas') erken sarmalanır; WeakRef+stack
   kaydı tutulur. İş yükü (S2 benzeri) sonunda window.__cvInv()
   canlı tuvalleri boyut+rol+yığınıyla listeler.
   Kullanım: node tests/heap-canvas-inventory.js
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9349;
const APP_PORT = 5216;
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
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    }
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});
const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) reject(new Error(method + ': ' + msg.error.message));
    else resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
async function waitForTarget(deadlineMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz hazır değil */ }
    await sleep(400);
  }
  throw new Error('uygulama hata ayıklama portu açılmadı');
}

/* erken sarmalayıcı: createElement + adjacency işaretlemesi */
const HOOK_JS = `(() => {
  if (window.__cvInst) return;
  const reg = new Map(); // WeakRef -> { src, stack }
  window.__cvInst = reg;
  const capStack = () => {
    try {
      const st = new Error().stack || '';
      return st.split('\\n').slice(2, 6)
        .map(l => l.replace(/^\\s*at\\s+/, '').trim())
        .map(l => { const i = l.indexOf('/app.js:'); return i >= 0 ? 'app.js@' + l.slice(i + 8) : l.slice(0, 60); })
        .filter(l => l.indexOf('__cvHook') < 0).slice(0, 3);
    } catch { return []; }
  };
  const origCreate = document.createElement.bind(document);
  const hookCreate = (tag, opts) => {
    const el = origCreate(tag, opts);
    if (tag && String(tag).toLowerCase() === 'canvas') {
      reg.set(new WeakRef(el), { src: 'create', stack: capStack() });
    }
    return el;
  };
  document.createElement = hookCreate;
  window.__cvInv = () => {
    const alive = [];
    reg.forEach((info, r) => {
      const c = r.deref();
      if (c) {
        alive.push({ w: c.width, h: c.height,
          mb: +(c.width * c.height * 4 / 1048576).toFixed(2),
          dom: !!c.isConnected, cls: (c.className || '').slice(0, 28),
          up: info.stack });
      }
    });
    alive.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const domMB = alive.filter(c => c.dom).reduce((n, c) => n + c.mb, 0);
    return { tracked: reg.size, alive: alive.length,
      approxAllMB: +alive.reduce((n, c) => n + c.mb, 0).toFixed(1),
      approxDOMMB: +domMB.toFixed(1),
      list: alive.slice(0, 60) };
  };
})()`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-heapi-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await send(ws, 'Page.enable');
    await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: HOOK_JS });
    await send(ws, 'Page.navigate', { url: page.url });
    await sleep(2500);

    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (w && !w.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
      }
      return 'welcome';
    })()`);

    const inv = () => evaluate(ws, `(() => JSON.stringify(window.__cvInv()))()`)
      .then(JSON.parse);

    const base = await inv();
    console.log('== TABAN (editör kapalı) == canlı ' + base.alive + '/' + base.tracked + ' ≈' + base.approxAllMB + ' MB (DOM ' + base.approxDOMMB + ' MB)');

    /* S2 editörü aç (3840×2160) ve iş yükü koş */
    const openRes = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '3840';
      document.getElementById('newCanvasH').value = '2160';
      document.getElementById('newCanvasName').value = 'Heap I';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 150 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      return 'açık';
    })()`);
    console.log('editör: ' + openRes);

    const afterOpen = await inv();
    console.log('\n== EDİTÖR AÇIK (çizim yok) == canlı ' + afterOpen.alive + ' ≈' + afterOpen.approxAllMB + ' MB (DOM ' + afterOpen.approxDOMMB + ' MB)');
    for (const c of afterOpen.list.slice(0, 18)) {
      console.log('  ' + c.w + '×' + c.h + ' · ' + c.mb + ' MB · ' + (c.dom ? 'DOM' : 'off') + ' · ' + (c.up && c.up.join(' | ') || '?'));
    }

    /* iş yükü: 4 uzun sert + 2 uzun airbrush + undo×6 + pan/zoom×10 */
    await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      const fire = (type, x, y, press) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
        clientX: rect.left + fit.x + x * fit.w,
        clientY: rect.top + fit.y + y * fit.h,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : press }));
      const ciz = async (brushId, size, color, y0, steps) => {
        inkSetTool('brush', { brushId });
        const ink = inkState();
        ink.size = size; ink.opacity = 1; ink.smoothing = 0.2; ink.color = color;
        await wait(50);
        fire('pointerdown', 0.1, y0, 0.4);
        for (let i = 1; i <= steps; i += 1) {
          fire('pointermove', 0.1 + 0.8 * i / steps, y0, 0.5);
          await wait(6);
        }
        fire('pointerup', 0.9, y0, 0);
        await new Promise(r => requestAnimationFrame(r));
        await wait(120);
      };
      for (let i = 0; i < 4; i += 1) await ciz('ink-hard', 60, '#' + (i % 5 + 1) + '1243a', 0.1 + i * 0.2, 36);
      for (let i = 0; i < 2; i += 1) await ciz('ink-air', 110, '#7a1414', 0.25 + i * 0.3, 30);
      for (let i = 0; i < 6; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(120);
      }
      for (let i = 0; i < 10; i += 1) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 300, clientY: 300, deltaY: 120 }));
        await wait(60);
      }
      return 'iş-yükü-ok';
    })()`);
    await sleep(1200);

    const afterWork = JSON.parse(await evaluate(ws, `(() => {
      const inv = window.__cvInv();
      return JSON.stringify({ inv,
        heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        layers: inkState().layers.length,
        strokes: inkState().layers.reduce((n, l) => n + (l.strokes || []).length, 0) });
    })()`));
    const i3 = afterWork.inv;
    console.log('\n== İŞ YÜKÜ SONRASI == canlı ' + i3.alive + ' ≈' + i3.approxAllMB + ' MB (DOM ' + i3.approxDOMMB + ' MB) · heap ' + afterWork.heap + ' MB · stroke ' + afterWork.strokes);
    for (const c of i3.list) {
      console.log('  ' + c.w + '×' + c.h + ' · ' + c.mb + ' MB · ' + (c.dom ? 'DOM' : 'off') + ' · ' + (c.up && c.up.join(' | ') || '?'));
    }

    /* GC'yi dış求精: birkaç kez heap'i zorlama (perf GC kontrol) —
       yaln ölçüm; temp canvas'ların düşüp düşmediğini izle */
    await sleep(2500);
    const late = JSON.parse(await evaluate(ws, `(() => JSON.stringify({
      inv: window.__cvInv(),
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }))()`));
    console.log('\n== 2.5sn SONRA == canlı ' + late.inv.alive + ' ≈' + late.inv.approxAllMB + ' MB · heap ' + late.heap);
    app.kill();
  } catch (e) {
    try { app.kill(); } catch { /* */ }
    console.error('PROBE HATASI: ' + (e && e.stack ? e.stack.slice(0, 600) : String(e)));
    process.exitCode = 1;
  }
})();
