'use strict';
/* =========================================================
   heap-alloc-sample.js — byte-pool FAZ 7.T tahsis ölçümü (probe)
   ---------------------------------------------------------
   DONDIRMAZ yöntem: HeapProfiler.startSampling (örselörnekleme,
   çalışırken uygulama normal yaşar) + iş yükü + stopSampling.
   Çıktı: tahsis sendika özetleri (fonksiyon ağaç self-size) —
   büyük UKalloc dizileri ve üretim yerine; sonda canvas envanteri
   ve heap metric'i.
   Kullanım: node tests/heap-alloc-sample.js
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9347;
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
  throw new Error('debug portu açılmadı');
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-alloc-'));
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

    /* örselörnekleme başlat (64 KB adım) */
    await send(ws, 'HeapProfiler.enable');
    await send(ws, 'HeapProfiler.startSampling', { samplingInterval: 8192 });

    /* S2 editörü + iş yükü */
    const openRes = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '3840';
      document.getElementById('newCanvasH').value = '2160';
      document.getElementById('newCanvasName').value = 'Heap Alloc';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 150 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
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
      for (let i = 0; i < 4; i += 1) await ciz('ink-hard', 60, '#12343a', 0.1 + i * 0.2, 36);
      for (let i = 0; i < 2; i += 1) await ciz('ink-air', 110, '#7a1414', 0.25 + i * 0.3, 30);
      for (let i = 0; i < 6; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(130);
      }
      await wait(900);
      return 'ok';
    })()`);
    console.log('iş yükü: ' + openRes);

    const prof = (await send(ws, 'HeapProfiler.stopSampling', {})).profile;
    console.log('örneklem yanıtı alındı');
    console.log('head keys: ' + Object.keys(prof.head).join(','));
    console.log('head self=' + prof.head.self_size + ' total=' + prof.head.total_serial_size);
    if (prof.head.children && prof.head.children.length) {
      console.log('ilk çocuk örneği: ' + JSON.stringify(prof.head.children[0]).slice(0, 220));
    }

    /* envanter + heap */
    const tail = JSON.parse(await evaluate(ws, `(() => JSON.stringify({
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      inv: window.__cvInv ? window.__cvInv() : null }))()`));
    console.log('heap: ' + tail.heap + ' MB');
    if (tail.inv) console.log('canvas envanteri: canlı ' + tail.inv.alive + ' ≈' + tail.inv.approxAllMB + ' MB (DOM ' + tail.inv.approxDOMMB + ' MB)');
    app.kill();

    /* --- örselörnekleme ağaç analizi --- */
    const self_size = prof.head.self_size;
    const strings = prof.strings || [];
    const callFrame = n => prof.head.callFrame;
    const nodes = [];
    const walk = (node, depth, parent) => {
      nodes.push({ depth, parent,
        fn: node.callFrame && node.callFrame.functionName || '',
        url: node.callFrame && node.callFrame.url || '',
        line: node.callFrame && node.callFrame.lineNumber >= 0 ? node.callFrame.lineNumber : -1,
        self: node.selfSize || 0,
        children: node.children ? node.children.length : 0 });
      if (node.children && depth < 26) for (const c of node.children) walk(c, depth + 1, node);
    };
    walk(prof.head, 0, null);
    console.log('ağaç düğüm sayısı: ' + nodes.length);

    /* self-size'a göre en büyük 26 fonksiyon-tepesi */
    const top = nodes.slice().filter(n => n.self > 20000).sort((a, b) => b.self - a.self);
    console.log('\n== TAHSİŞ TEPESİ (self-size, ≥20 KB ayrım) ==');
    for (const n of top.slice(0, 26)) {
      const cf = n.parent ? (n.parent.fn || '').slice(0, 26) : '';
      const url = (n.url || '').slice(-26);
      console.log('  ' + (n.self / 1048576).toFixed(2) + ' MB · ' + (n.fn || '(anon)') + ' @' + url + ':' + n.line + ' · der' + n.depth + (cf ? ' ←(' + cf + ')' : ''));
    }

    /* zincir özetleri: ana hatların altında name-node' yapı olarak
       '-' ile; basit etken: büyük ana cadde'lerin en kapsamlı kaynak
       znaczenie satırı basit */
    const keys = nodes.filter(n => n.self > 300000).map(n => n.url + ':' + n.line + ':' + n.fn);
    const countMap = new Map();
    for (const k of keys) countMap.set(k, (countMap.get(k) || 0) + 1);
    process.exitCode = 0;
  } catch (e) {
    try { app.kill(); } catch { /* */ }
    console.error('PROBE HATASI: ' + (e && e.stack ? e.stack.slice(0, 600) : String(e)));
    process.exitCode = 1;
  }
})();
