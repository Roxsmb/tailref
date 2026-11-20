'use strict';
/* =========================================================
   mask-encode-profile.js — A3 maske toDataURL darboğazı (probe)
   ---------------------------------------------------------
   A3 fazının gerçek yolu: inkDocAddMask + 3 maske vuruşu.
   Span'lar: maskEncode (toDataURL self), maskCommit (vuruş
   commit toplamı). Ayrıca saf toDataURL/toBlob kıyaslaması.
   NOT: sentetik pointerType=pen — SÖZDE-SÜRET uyarısı geçerli.
   Kullanım: node tests/mask-encode-profile.js   (kapı DEĞİL)
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9345;
const APP_PORT = 5212;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-maskenc-'));
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

    /* editörü aç: tuval yarat (varsayılan S0 1600×1200) */
    const open = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '1600';
      document.getElementById('newCanvasH').value = '1200';
      document.getElementById('newCanvasName').value = 'Maske Ölçüm';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 150 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(600);
      return inkEditorIsOpen() ? 'açık' : 'AÇILMADI';
    })()`);
    console.log('editör: ' + open);

    /* --- saf kıyaslama: toDataURL vs toBlob (2K ve 4K) --- */
    const pure = JSON.parse(await evaluate(ws, `(async () => {
      const out = {};
      for (const [tag, w, h] of [['1600x1200', 1600, 1200], ['3840x2160', 3840, 2160]]) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d', { colorSpace: 'srgb' });
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#333'; g.lineWidth = 8;
        for (let i = 0; i < 24; i += 1) { g.beginPath(); g.moveTo(i * w / 24, 0); g.lineTo(w - i * w / 24, h); g.stroke(); }
        const t0 = performance.now();
        const url = c.toDataURL('image/png');
        out[tag + '-dataURL'] = Math.round((performance.now() - t0) * 100) / 100;
        out[tag + '-urlLen'] = Math.round(url.length / 1024) + 'KB';
        const t1 = performance.now();
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        out[tag + '-toBlobWall'] = Math.round((performance.now() - t1) * 100) / 100;
        const t2 = performance.now();
        await new Promise(r => { const fr = new FileReader(); fr.onload = r; fr.readAsDataURL(blob); });
        out[tag + '-fileReader'] = Math.round((performance.now() - t2) * 100) / 100;
        out[tag + '-blobKB'] = Math.round(blob.size / 1024) + 'KB';
        c.width = c.height = 1;
      }
      return JSON.stringify(out);
    })()`));
    console.log('\n== SAF KIYAS ==');
    for (const [k, v] of Object.entries(pure)) console.log('  ' + k + ': ' + v);

    /* --- gerçek A3 yolu --- */
    const flow = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const perfCounters = () => {
        const s = inkPerfSnapshot();
        const c = s.counters;
        return {
          encN: c.maskEncodeCount || 0, encAvg: (c.maskEncodeMs || 0) / (c.maskEncodeCount || 1),
          encMax: c.maskEncodeMaxMs || 0,
          comN: c.maskCommitCount || 0, comAvg: (c.maskCommitMs || 0) / (c.maskCommitCount || 1),
          comMax: c.maskCommitMaxMs || 0,
          txN: c.maskEncodeNx || 0,
        };
      };
      const t0 = performance.now();
      const L0 = inkState().layers[0];
      inkDocAddMask(L0.id, 'reveal');
      const addMs = Math.round((performance.now() - t0) * 100) / 100;
      inkState().maskEditId = L0.id;
      await wait(180);

      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      const fire = (type, x, y, press) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
        clientX: rect.left + fit.x + x * fit.w,
        clientY: rect.top + fit.y + y * fit.h,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : press }));
      const strokeMs = [];
      for (let i = 0; i < 3; i += 1) {
        inkSetTool('brush', { brushId: 'ink-hard' });
        const ink = inkState();
        ink.size = 26; ink.opacity = 1; ink.smoothing = 0.2; ink.color = '#ffffff';
        await wait(40);
        const ts = performance.now();
        fire('pointerdown', 0.3, 0.3 + i * 0.12, 0.4);
        for (let k = 1; k <= 20; k += 1) {
          fire('pointermove', 0.3 + 0.4 * k / 20, 0.3 + i * 0.12, 0.5);
          await wait(5);
        }
        fire('pointerup', 0.7, 0.3 + i * 0.12, 0);
        await new Promise(r => requestAnimationFrame(r));
        await wait(140);
        strokeMs.push(Math.round((performance.now() - ts) * 100) / 100);
      }
      const st = perfCounters();
      inkState().maskEditId = null;
      return JSON.stringify({ addMs, strokeMs, st,
        srcLenK: Math.round((inkState().layers[0].mask ? inkState().layers[0].mask.src.length : 0) / 1024) });
    })()`);
    console.log('\n== A3 YOLU (editör açık, 1600×1200) ==');
    const fl = JSON.parse(flow);
    console.log('  inkDocAddMask: ' + fl.addMs + ' ms');
    console.log('  vuruş commit duvarı: ' + fl.strokeMs.join(' / ') + ' ms');
    console.log('  maskEncode: n=' + fl.st.encN + ' avg=' + fl.st.encAvg.toFixed(2) + ' max=' + fl.st.encMax.toFixed(2) + ' ms');
    console.log('  maskCommit: n=' + fl.st.comN + ' avg=' + fl.st.comAvg.toFixed(2) + ' max=' + fl.st.comMax.toFixed(2) + ' ms');
    console.log('  mask src len: ' + fl.srcLenK + ' KB');

    /* --- flush paritesi: 4. vuruş + ANINDA serialize --- */
    const flushCheck = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const L0 = inkState().layers[0];
      const before = L0.mask.src;
      inkState().maskEditId = L0.id;
      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      const fire = (type, x, y, press) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
        clientX: rect.left + fit.x + x * fit.w,
        clientY: rect.top + fit.y + y * fit.h,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : press }));
      inkSetTool('brush', { brushId: 'ink-hard' });
      const ink = inkState();
      ink.size = 30; ink.opacity = 1; ink.smoothing = 0.2; ink.color = '#22aaff';
      await wait(40);
      fire('pointerdown', 0.15, 0.85, 0.4);
      for (let k = 1; k <= 16; k += 1) {
        fire('pointermove', 0.15 + 0.5 * k / 16, 0.85, 0.5);
        await wait(5);
      }
      fire('pointerup', 0.65, 0.85, 0);
      await new Promise(r => requestAnimationFrame(r));
      /* ANINDA serialize — pending flush tetiklenmeli */
      const snap = JSON.stringify(createStateSnapshot());
      const after = inkState().layers[0].mask.src;
      /* decode paritesi: src'i Image'a çöz, primer tuvalla köşe+vuruş samplə */
      const raster = inkMaskRasterSource(inkState().layers[0]);
      if (!raster) return { error: 'raster yok' };
      const img = new Image();
      await new Promise(r => { img.onload = r; img.onerror = r; img.src = after; });
      const g = document.createElement('canvas');
      g.width = raster.width; g.height = raster.height;
      g.getContext('2d', { colorSpace: 'srgb' }).drawImage(img, 0, 0, g.width, g.height);
      const a = raster.getContext('2d', { colorSpace: 'srgb' });
      const bg = g.getContext('2d', { colorSpace: 'srgb' });
      let diff = 0, bad = [];
      const pts = [[4, 4], [988, 596], [1091, 1030], [1104, 1040], [700, 300]];
      for (const [px, py] of pts) {
        const va = a.getImageData(px, py, 1, 1).data;
        const vb = bg.getImageData(px, py, 1, 1).data;
        for (let ch = 0; ch < 4; ch += 1) {
          if (Math.abs(va[ch] - vb[ch]) > 2) { diff += 1; bad.push(px + ',' + py + ' ch' + ch); break; }
        }
      }
      return JSON.stringify({ beforeLen: before.length, afterLen: after.length,
        flushed: after !== before || inkMaskPending.size === 0,
        pendingLeft: (typeof inkMaskPending !== 'undefined') ? inkMaskPending.size : -1,
        snapHasUpdatedSrc: snap.includes(after.slice(0, 64)),
        decodeDiff: diff, bad: bad.slice(0, 3) });
    })()`));
    console.log('\n== FLUSH PARİTESİ ==');
    console.log(JSON.stringify(flushCheck));

    app.kill();
  } catch (e) {
    try { app.kill(); } catch { /* */ }
    console.error('PROBE HATASI: ' + (e && e.stack ? e.stack.slice(0, 600) : String(e)));
    process.exitCode = 1;
  }
})();
