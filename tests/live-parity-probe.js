'use strict';
/* K20 · modal editör canlı görünüm ↔ commit parite probe
   ------------------------------------------------------------
   Kullanıcı imzası: "çizerken farklı / soluk / hiç görünmüyor;
   bırakınca başka şekil". Ölçüm:
     • drag boyunca her adımda ui.previewCanvas piksel sayımı
       (GL etkinse readPixels ile — canlı görünümün kullandığı yol),
     • pointerup sonrası katman raster'ı sayımı (commit),
     • K20 referans: rebuildPreview(true) tam raster sayımı.
   GL durumu (inkDabGl) raporlanır. node scripts/live-parity-probe.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9397;
const APP_PORT = 5257;
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-liveparity-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let mainPage = null; let deadline = Date.now() + 70000;
  while (Date.now() < deadline && !mainPage) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      mainPage = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (!mainPage && Date.now() - (this._warn || 0) > 20000 && list.length) {
        this._warn = Date.now();
        console.log('· bekleme: sayfalar = ' + list.map(t => t.url).join(' | '));
      }
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
    await addFiles([new File([blob], 'live-parity.png', { type: 'image/png' })], null);
    for (let i = 0; i < 40; i++) {
      if (state.items.some(it => it.kind === 'image')) break;
      await wait(150);
    }
    const item = state.items.find(it => it.kind === 'image');
    if (!item) throw new Error('görsel yok');
    modeEnterDraw(item.id);
    for (let i = 0; i < 40 && !inkEditorIsOpen(); i += 1) await wait(100);
    if (!inkEditorIsOpen()) throw new Error('editör açılamadı');
    return true;
  })()`, 60000);

  const glState = JSON.parse(await evaluate(ws, `JSON.stringify({
    gl: typeof inkDabGl === 'object' && inkDabGl !== null
      ? { tried: !!inkDabGl.tried, ok: !!inkDabGl.ok, disabled: !!inkDabGl.disabled }
      : null,
  })`));
  console.log('inkDabGl: ' + JSON.stringify(glState.gl));

  for (const brushId of ['native-studio-pen', 'native-watercolor', 'native-airbrush-soft', 'native-chalk-hard', 'native-charcoal-willow']) {
    let rep;
    try {
      rep = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ink = inkState();
      const it = state.items.find(x => x.kind === 'image');
      const ui = inkEditorUi;
      const layer = inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'lp' });
      ink.activeLayerId = layer.id;
      inkSetTool('brush', { brushId: ${JSON.stringify(brushId)} });
      ink.tool = 'brush';
      ink.color = '#ff2000';
      const b = NativeBrushLibrary.find(x => x.id === ${JSON.stringify(brushId)}) || {};
      ink.size = Math.round(b.size) || 14;
      ink.opacity = Number.isFinite(b.opacity) ? b.opacity : 1;
      const rect = ui.canvas.getBoundingClientRect();
      const pt = p => ({ x: rect.left + ui.fit.x + ui.fit.w * p[0], y: rect.top + ui.fit.y + ui.fit.h * p[1] });
      const ev = (type, p, pr) => new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 900, pointerType: 'pen',
        isPrimary: true, pressure: pr, clientX: p.x, clientY: p.y,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      });
      // canlı piksel sayacı: 2D scratch veya GL canvas fark etmeksizin
      const liveCount = () => {
        const cv = ui.previewCanvas;
        if (!cv) return -1;
        const isGl = !cv.getContext('2d');
        if (isGl) {
          const gl = cv.getContext('webgl2') || cv.getContext('webgl');
          if (!gl) return -2;
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
          const px = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let n = 0;
          for (let j = 3; j < px.length; j += 4) if (px[j] > 8) n++;
          return n;
        }
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let j = 3; j < d.length; j += 4) if (d[j] > 8) n++;
        return n;
      };
      const seg = [[0.22, 0.30], [0.34, 0.24], [0.46, 0.34], [0.58, 0.24], [0.70, 0.32], [0.80, 0.28]];
      const alphaStats = cv2 => {
        const d = cv2.getContext('2d').getImageData(0, 0, cv2.width, cv2.height).data;
        let n = 0, maxA = 0, midA = 0;
        for (let j = 3; j < d.length; j += 4) {
          const a = d[j];
          if (a > 8) n++;
          if (a > maxA) maxA = a;
          if (a > 1 && a <= 8) midA++;
        }
        return { n, maxA, midA };
      };
      const samples = [];
      ui.canvas.dispatchEvent(ev('pointerdown', pt(seg[0]), 0.55));
      for (let i = 1; i < seg.length; i++) {
        ui.canvas.dispatchEvent(ev('pointermove', pt(seg[i]), 0.55 + i * 0.08));
        await wait(70);
        const st = alphaStats(ui.previewCanvas);
        samples.push({ c: st.n, maxA: st.maxA, mid: st.midA });
      }
      // ayrım ölçümü: artımlı çağrı dab yayımlıyor mu?
      ui.canvas.dispatchEvent(ev('pointermove', pt(seg[5]), 0.75));
      await wait(40);
      const incCall = (() => {
        const before = ui.previewSkip;
        const processed = typeof inkDrawStrokeOnContext === 'function'
          ? (() => {
            const cv2 = ui.previewCanvas || ui.scratch;
            if (!cv2) return null;
            const ctx2 = cv2.getContext('2d', { colorSpace: 'srgb' });
            return inkDrawStrokeOnContext(ctx2, ui.stroke, {
              mapPoint: p => ({ x: p.x * cv2.width, y: p.y * cv2.height }),
              sizePx: Math.max(0.5, ui.stroke.size * cv2.width),
              pointScale: { x: cv2.width, y: cv2.height },
              stableOnly: true,
              skipDabs: ui.previewSkip || 0,
            });
          })()
          : null;
        return { before, processed, after: ui.previewSkip };
      })();
      const glFlag = ui.previewGl === true;
      const finalCount = (() => {
        const p = inkEditorRebuildPreview(true);
        return p ? liveCount() : -1;
      })();
      ui.canvas.dispatchEvent(ev('pointerup', pt(seg[5]), 0.75));
      // commit sabitlenene kadar bekle
      const cv = inkRuntime.itemCanvases.get(layer.id);
      let last = -1, steady = 0, commit = 0;
      for (let k = 0; k < 60; k++) {
        await wait(50);
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let c = 0;
        for (let j = 3; j < d.length; j += 4) if (d[j] > 8) c++;
        if (c === last && c > 0) steady++; else steady = 0;
        last = c;
        if (steady >= 3) break;
      }
      commit = last;
      try { inkRemoveLayer(layer.id); } catch { }
      await wait(30);
      return JSON.stringify({ samples, glFlag, finalCount, commit, incCall });
    })()`, 120000);
    } catch (e) {
      console.log('=== ' + brushId + ' ===\n  PROBE HATASI: ' + e.message);
      continue;
    }
    const r = typeof rep === 'object' && rep !== null ? rep : JSON.parse(rep);
    console.log('\n=== ' + brushId + ' ===');
    console.log('  live adımları : ' + r.samples.map(s => s.c + '(mA' + s.maxA + ')' ).join(' → ') + (r.glFlag ? '  [GL canlı]' : '  [2D canlı]'));
    console.log('  inc çağrısı   : skip ' + r.incCall.before + ' → yazılan ' +
      (r.incCall.processed === null ? 'yok' : r.incCall.processed) + ' · yeni skip ' + r.incCall.after);
    console.log('  rebuild(true) : ' + r.finalCount);
    console.log('  commit        : ' + r.commit);
    const live = Math.max(...r.samples.map(s => typeof s === 'number' ? s : s.c));
    console.log('  LIVE GÖRÜNÜR mü: ' + (live > 0 ? 'evet' : 'HAYIR (0)') +
      (r.commit > 0 && live === 0 ? '  ← kullanıcının imzası' : '') +
      (r.commit > 0 ? '  canlı/commit oranı: ' + (live / r.commit).toFixed(2) : ''));
    if (r.commit > 0 && live > 0 && r.finalCount > 0) {
      console.log('  final/commit oranı: ' + (r.finalCount / r.commit).toFixed(2));
    }
  }

  try { await evaluate(ws, 'window.close()'); } catch { }
  app.kill();
  setTimeout(() => process.exit(0), 400);
})().catch(e => {
  console.error('HATA:', e.message);
  if (typeof app !== 'undefined' && app) { try { app.kill(); } catch { } }
  process.exit(1);
});
