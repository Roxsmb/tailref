'use strict';
/* =========================================================
   heap-snapshot-top.js — JS heap tutucu muhasebesi (probe)
   ---------------------------------------------------------
   İş yükü sonrası HeapProfiler.takeHeapSnapshot alır; bayt
   türündeki düğümleri (typed array/ImageData kaynağı) büyüklüğe
   göre sıralar ve her büyük düğüm için 2 adıma kadar retainer
   (hakim/zinc ГОД kin) zincirini çözer.
   Kullanım: node tests/heap-snapshot-top.js
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9348;
const APP_PORT = 5215;
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

const takeHeapSnapshot = ws => new Promise((resolve, reject) => {
  const chunks = [];
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.method !== 'HeapProfiler.addHeapSnapshotChunk') return;
    chunks.push(msg.params.chunk);
  };
  ws.addEventListener('message', onMsg);
  const onResult = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== 'snap') return;
    ws.removeEventListener('message', onMsg);
    ws.removeEventListener('message', onResult);
    if (msg.error) return reject(new Error(msg.error.message));
    resolve(chunks.join(''));
  };
  ws.addEventListener('message', onResult);
  ws.send(JSON.stringify({ id: 'snap', method: 'HeapProfiler.takeHeapSnapshot', params: {} }));
});

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-heap-'));
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

    /* S2 editörü + iş yükü (profil ile aynı) */
    const openRes = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '3840';
      document.getElementById('newCanvasH').value = '2160';
      document.getElementById('newCanvasName').value = 'Heap II';
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
      await wait(800);
      return 'ok';
    })()`);
    console.log('iş yükü: ' + openRes);

    const snapRaw = await takeHeapSnapshot(ws);
    console.log('snapshot: ' + Math.round(snapRaw.length / 1048576) + ' MB ham)');
    app.kill();
    fs.writeFileSync(path.join(os.tmpdir(), 'tailref-heap.heapsnapshot'), snapRaw);

    /* --- snapshot analizi --- */
    const snap = JSON.parse(snapRaw);
    const meta = snap.snapshot.meta;
    const nodeFields = meta.node_fields;
    const NI = {}; nodeFields.forEach((f, i) => { NI[f] = i; });
    const nodeTypeIx = NI.type;
    const nameIx = NI.name;
    const sizeIx = NI.self_size;
    const edgeCountIx = NI.edge_count;
    // edge fields
    const edgeFields = meta.edge_fields;
    const EI = {}; edgeFields.forEach((f, i) => { EI[f] = i; });
    const edgeTypeIx = EI.type;
    const edgeNameIx = EI.name_or_index;
    const edgeToIx = EI.to_node;

    const strings = snap.strings;
    const nodes = snap.nodes;
    const edges = snap.edges;
    const nodeCount = snap.snapshot.node_count || (nodes.length / nodeFields.length);
    const stride = nodeFields.length;
    const estep = edgeFields.length;

    const typeName = t => strings[meta.node_types[t]] || ('t' + t);
    const edgeName = t => strings[meta.edge_types[t]] || ('e' + t);

    /* ilk geçiş: ByteArray/ArrayBuffer/WebAssembly vb. büyüklükleri */
    const agg = new Map();
    let total = 0;
    for (let n = 0; n < nodeCount; n++) {
      const base = n * stride;
      const t = nodes[base + nodeTypeIx];
      const sz = nodes[base + sizeIx];
      total += sz;
      const nm = typeName(t);
      const cur = agg.get(nm) || [0, 0];
      cur[0] += sz; cur[1] += 1;
      agg.set(nm, cur);
    }
    console.log('toplam self size: ' + (total / 1048576).toFixed(1) + ' MB');
    const aggArr = [...agg.entries()].sort((a, b) => b[1][0] - a[1][0]);
    for (const [nm, [sz, c]] of aggArr.slice(0, 12)) {
      console.log('  ' + nm + ': ' + (sz / 1048576).toFixed(1) + ' MB ×' + c);
    }

    /* büyük düğümler (>1.5MB) hazırla */
    const big = [];
    for (let n = 0; n < nodeCount; n++) {
      const base = n * stride;
      const sz = nodes[base + sizeIx];
      if (sz > 1500000) big.push(n);
    }
    /* to_node indeksleme: edge dizisi sıralı; her düğümün ilk edge indeksi
       = önceki düğümlerin edge toplamı. */
    const firstEdge = new Int32Array(nodeCount);
    let acc = 0;
    for (let n = 0; n < nodeCount; n++) {
      firstEdge[n] = acc;
      acc += nodes[n * stride + edgeCountIx];
    }
    /* retainer haritası: hedef düğümü tutan kenarlar (bir kez kur) */
    const idStr = n => {
      const base = n * stride;
      const t = typeName(nodes[base + nodeTypeIx]);
      let nm = nodes[base + nameIx] >= 0 ? strings[nodes[base + nameIx]] : '<?>';
      nm = nm.length > 48 ? nm.slice(0, 48) + '…' : nm;
      return t + ' ' + (nm || '(anon)');
    };
    const retainers = new Map(); // n -> [[fromN, edgeNameStr]]
    /* her büyük düğüm için tam tarama yapma: tek taramada tüm büyükler */
    const bigSet = new Set(big);
    for (let n = 0; n < nodeCount; n++) {
      const e0 = firstEdge[n];
      const eCnt = nodes[n * stride + edgeCountIx];
      for (let e = e0; e < e0 + eCnt; e++) {
        const to = edges[e * estep + edgeToIx] / stride;
        if (bigSet.has(to)) {
          let list = retainers.get(to);
          if (!list) { list = []; retainers.set(to, list); }
          const en = edges[e * estep + edgeNameIx];
          const nm = typeof en === 'number' ? strings[en] : String(en);
          if (list.length < 4) list.push(idStr(n) + ' ←·' + (nm || '') + '·');
        }
      }
    }
    console.log('\n== BÜYÜK DÜĞÜMLER (self >1.5 MB) ==');
    const bigS = big.slice().sort((a, b) =>
      nodes[b * stride + sizeIx] - nodes[a * stride + sizeIx]);
    for (const n of bigS.slice(0, 30)) {
      const base = n * stride;
      const nv = strings[nodes[base + nameIx]] || '';
      console.log('  ' + (nodes[base + sizeIx] / 1048576).toFixed(2) + ' MB · ' + typeName(nodes[base + nodeTypeIx]) +
        ' · "' + (nv.length > 40 ? nv.slice(0, 40) : nv) + '"' +
        (retainers.get(n) ? '\n        ↾ ' + retainers.get(n).join('\n        ↾ ') : ' · (tutan yok)'));
    }
    process.exitCode = 0;
  } catch (e) {
    try { app.kill(); } catch { /* */ }
    console.error('PROBE HATASI: ' + (e && e.stack ? e.stack.slice(0, 600) : String(e)));
    process.exitCode = 1;
  }
})();
