'use strict';
/* FAZ 7.S doğruluk kapısı: undo bölgesel fallback bit-paritesi
   =========================================================
   FAST raster kaydı YOK (trim/kirli senaryosu) iken undo artık
   inkUndoRegionRebuild (clip'siz scratch, tam sayı öteleme) kullanır.
   Bölgesel sonuç == TAM vektör kurulum referansı (0 px) olmak zorunda.
   Kancalar function-binding olduğu için monkey-patch'e kapalı; yol
   doğrulaması inkUndoRaster.stats (fallbacks/regionTrials/regionRebuilds)
   üzerinden yapılır.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9350;
const APP_PORT = 5217;
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

let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
  if (!ok) failures += 1;
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-undoreg-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let rep = null;
  try {
    const page = await waitForTarget();
    const ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await send(ws, 'Page.enable');
    let ready = false;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    await evaluate(ws, `(async () => {
      const w = document.getElementById('persistenceWelcome');
      if (w && !w.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
      }
      return 'ok';
    })()`);

    rep = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      /* FAZ 7.U: bölgesel undo fallback'ı işi worker'a devredebiliyor.
         Sabit gecikmeyle örneklemek yarış üretiyordu (worker uygulaması
         160 ms'lik pencereye bazen yetişiyor, bazen yetişmiyordu). Burada
         yayınlanan tüm worker işleri kapanana kadar bekliyoruz; sonra
         "durgunluk" ölçümü gerçekten tembel üst-yazımayı arıyor. Üst sınır
         aşılırsa kapı kırmızı kalır. */
      const waitUndoWorkerIdle = async (timeoutMs = 5000) => {
        const t0 = Date.now();
        for (;;) {
          const s = inkUndoRaster.stats;
          if (s.workerPosted - s.workerApplied - s.workerCancelled <= 0) {
            return { idle: true, ms: Date.now() - t0 };
          }
          if (Date.now() - t0 > timeoutMs) {
            return { idle: false, ms: Date.now() - t0 };
          }
          await wait(20);
        }
      };
      if (inkEditorIsOpen()) { inkEditorClose(); await wait(400); }
      document.getElementById('modeDrawBtn').click();
      await wait(240);
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 120 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(400);

      const canvasEl = inkEditorUi.canvas;
      const rect0 = canvasEl.getBoundingClientRect();
      const fit = inkEditorUi.fit;
      const fire = (type, p, press) => canvasEl.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 91, pointerType: 'pen', isPrimary: true,
        pressure: press, clientX: p.clientX, clientY: p.clientY,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      }));
      const P = (fx, fy) => ({ clientX: rect0.left + fit.x + fx * fit.w, clientY: rect0.top + fit.y + fy * fit.h });
      const ciz = async (tool, brushId, size, color, pts, ms) => {
        inkSetTool(tool, { brushId: tool === 'brush' ? brushId : undefined });
        const ink = inkState();
        ink.size = size; ink.opacity = 1; ink.color = color; ink.smoothing = 0.2;
        await wait(50);
        fire('pointerdown', pts[0], 0.45);
        for (let i = 1; i < pts.length; i += 1) {
          fire('pointermove', pts[i], 0.5);
          await wait(ms);
        }
        fire('pointerup', pts[pts.length - 1], 0);
        await new Promise(r => requestAnimationFrame(r));
        await wait(90);
      };
      const grab = id => {
        const c = inkRuntime.itemCanvases.get(id);
        const g = c.getContext('2d', { colorSpace: 'srgb' });
        return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data.slice(0) };
      };
      let W_ = 1920, H_ = 1080;
      const cmp = (d1, d2) => {
        let n = 0, max = 0;
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        for (let i = 0; i < d1.length; i += 4) {
          let cmax = 0;
          for (let k = 0; k < 4; k++) cmax = Math.max(cmax, Math.abs(d1[i+k] - d2[i+k]));
          if (cmax > 0) {
            n++;
            const px = (i >> 2) % W_, py = (i >> 2) / W_ | 0;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
          if (cmax > max) max = cmax;
        }
        return { n, max, bbox: maxX >= 0 ? [minX, minY, maxX - minX, maxY - minY] : null };
      };
      const cmpIn = (d1, d2, reg) => {
        let rin = 0, rout = 0, mxIn = 0, mxOut = 0;
        for (let i = 0; i < d1.length; i += 4) {
          let cmax = 0;
          for (let k = 0; k < 4; k++) cmax = Math.max(cmax, Math.abs(d1[i+k] - d2[i+k]));
          if (cmax > 0) {
            const px = (i >> 2) % W_, py = (i >> 2) / W_ | 0;
            const ins = reg && px >= reg.x && px < reg.x + reg.w && py >= reg.y && py < reg.y + reg.h;
            if (ins) { rin++; if (cmax > mxIn) mxIn = cmax; }
            else { rout++; if (cmax > mxOut) mxOut = cmax; }
          }
        }
        return { rin, rout, mxIn, mxOut };
      };
      const sliceReg = (c, reg) => c.getContext('2d').getImageData(
        Math.max(0, reg.x | 0), Math.max(0, reg.y | 0),
        Math.min(c.width - Math.max(0, reg.x | 0), reg.w | 0),
        Math.min(c.height - Math.max(0, reg.y | 0), reg.h | 0));
      const bytesCmp = (a, b) => {
        let n = 0, max = 0;
        for (let i = 0; i < a.length; i += 1) {
          const d = Math.abs(a[i] - b[i]);
          if (d > 0) n++;
          if (d > max) max = d;
        }
        return { n, max };
      };

      const layerId = inkState().activeLayerId;
      const layer = inkLayerById(layerId);
      if (!layer || layer.kind !== 'attached') return JSON.stringify({ err: 'attached katman yok' });

      /* --- S0: shape çizgisi (vektör; inkRerenderLayer ile kur) --- */
      layer.strokes.push({
        kind: 'shape', tool: 'shape', shapeType: 'rect', id: 'u-reg-s0',
        points: [{ x: 0.22, y: 0.24, p: 1, a: 0, s: 0 }, { x: 0.56, y: 0.74, p: 1, a: 0, s: 0 }],
        size: 0.03, opacity: 1, color: '#2f6fdc', sym: 'off',
      });
      inkRerenderLayer(layerId);
      await wait(120);
      const S0 = grab(layerId);
      W_ = S0.w; H_ = S0.h;

      /* --- S1: silgi vuruşu (canlı ekleme; dual olmayan eraser yolu) --- */
      await ciz('eraser', undefined, 34, '#000000',
        [P(0.24, 0.30), P(0.30, 0.34), P(0.36, 0.40), P(0.40, 0.52), P(0.38, 0.64)], 20);
      const S1 = grab(layerId);
      const entryRaw = undoStack[undoStack.length - 1];
      const entryObj = (() => { try { return JSON.parse(entryRaw).__inkStroke || null; } catch { return null; } })();
      const eraseStroke = entryObj && entryObj.stroke;
      const regErase = eraseStroke ? inkUndoStrokeRegion(layer, eraseStroke) : null;
      const regEraseArr = regErase ? [regErase.x | 0, regErase.y | 0, regErase.w | 0, regErase.h | 0] : null;

      /* --- fallback zorla: raster kayıtlarını at --- */
      inkUndoRaster.entries.clear();
      const undo = () => window.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));

      undo();
      const undoWorkerIdle = await waitUndoWorkerIdle();
      await wait(160);
      const U0 = grab(layerId);
      await wait(400);
      const U1 = grab(layerId);
      const dirtyAfterUndo = {
        runtime: [...(inkRuntime.dirtyLayers || [])].map(s => s.slice(-8)),
        inkDirty: [...(typeof inkDirty !== 'undefined' && inkDirty.layers ? inkDirty.layers.keys() : [])].map(s => s.slice(-8)),
      };
      /* referans: tam vektör kurulum */
      inkRerenderLayer(layerId);
      await wait(120);
      const R0 = grab(layerId);
      /* --- GERÇEK A/B tam bu anda: strokes=[shape] (undo sonrası),
         kanvas = R0, bölge = regErase; pre vs post dilim karşılaştırma --- */
      const cAB = inkRuntime.itemCanvases.get(layerId);
      const preABf = sliceReg(cAB, regErase);
      const okABf = inkUndoRegionRebuild(layer, regErase, cAB);
      const postABf = sliceReg(cAB, regErase);
      const abFlow = (() => {
        if (!okABf) return { ok: false };
        let n = 0, max = 0;
        for (let i = 0; i < preABf.data.length; i += 1) {
          const d = Math.abs(preABf.data[i] - postABf.data[i]);
          if (d > 0) n++;
          if (d > max) max = d;
        }
        return { ok: true, n, max, reg: [regErase.x | 0, regErase.y | 0, regErase.w | 0, regErase.h | 0] };
      })();

      /* --- redo fallback --- */
      inkUndoRaster.entries.clear();
      redo();
      await wait(160);
      const RD = grab(layerId);

      /* --- ph2: smudge undo fallback (ctx.canvas piksel okumalı) --- */
      await ciz('smudge', undefined, 46, '#000000',
        [P(0.60, 0.30), P(0.55, 0.40), P(0.50, 0.50), P(0.47, 0.62), P(0.46, 0.70)], 20);
      const C1 = grab(layerId);
      inkUndoRaster.entries.clear();
      undo();
      await wait(160);
      const US = grab(layerId);
      inkRerenderLayer(layerId);
      await wait(120);
      const RS = grab(layerId);

      /* --- izole A/B: tam kurulmuş tuvalde bölgeyi scratch ile tekrar kur --- */
      let abErase = { ok: false }, abSmudge = { ok: false };
      try {
        /* smudge UNDO akışını birebir izole: bölgeyi RS (tam kurulum
           [shape,eraser] hali) üzerinden kur; önce-kurulum dilimi vs. */
        const regS = regErase;
        const canvasNow = inkRuntime.itemCanvases.get(layerId);
        const pre = sliceReg(canvasNow, regS);
        const okp = inkUndoRegionRebuild(inkLayerById(layerId), regS, canvasNow);
        const post = sliceReg(canvasNow, regS);
        if (okp) {
          let n = 0, max = 0;
          for (let i = 0; i < pre.data.length; i += 1) {
            const d = Math.abs(pre.data[i] - post.data[i]);
            if (d > 0) n++;
            if (d > max) max = d;
          }
          abSmudge = { ok: true, n, max, reg: [regS.x | 0, regS.y | 0, regS.w | 0, regS.h | 0] };
        }
      } catch (e2) { abSmudge = { ok: false, err: String(e2).slice(0, 100) }; }
      try {
        /* undo akışını birebir izole: [shape] hali (R0) üzerinden
           silgi bölgesini scratch ile kur ve dilimi karşılaştır */
        const regE2 = regErase;
        const canvasNow = inkRuntime.itemCanvases.get(layerId);
        const pre2 = sliceReg(canvasNow, regE2);
        const okp2 = inkUndoRegionRebuild(inkLayerById(layerId), regE2, canvasNow);
        const post2 = sliceReg(canvasNow, regE2);
        if (okp2) {
          let n = 0, max = 0;
          for (let i = 0; i < pre2.data.length; i += 1) {
            const d = Math.abs(pre2.data[i] - post2.data[i]);
            if (d > 0) n++;
            if (d > max) max = d;
          }
          abErase = { ok: true, n, max, reg: [regE2.x | 0, regE2.y | 0, regE2.w | 0, regE2.h | 0] };
        }
      } catch (e3) { abErase = { ok: false, err: String(e3).slice(0, 100) }; }

      /* --- Saf rasterizasyon deneyi (uygulama gürültüsüz): iki yalın
         tuval; A tam boy, B bölge boyutlu; aynı çizgi; A-dilimi == B? --- */
      const pureTest = (() => {
        try {
          const cA = document.createElement('canvas');
          cA.width = 1920; cA.height = 1080;
          const gA = cA.getContext('2d', { colorSpace: 'srgb' });
          const cB = document.createElement('canvas');
          cB.width = regErase.w; cB.height = regErase.h;
          const gB = cB.getContext('2d', { colorSpace: 'srgb' });
          const drawLine = (g, ox, oy) => {
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.globalAlpha = 1;
            g.globalCompositeOperation = 'source-over';
            g.strokeStyle = '#2f6fdc';
            g.lineWidth = Math.max(1, 0.03 * 1920 * 0.22);
            g.lineCap = 'round';
            g.lineJoin = 'round';
            g.beginPath();
            g.moveTo(0.22 * 1920 - ox, 0.24 * 1080 - oy);
            g.lineTo(0.56 * 1920 - ox, 0.74 * 1080 - oy);
            g.stroke();
          };
          drawLine(gA, 0, 0);
          drawLine(gB, regErase.x, regErase.y);
          const sA = gA.getImageData(regErase.x, regErase.y, regErase.w, regErase.h).data;
          const sB = gB.getImageData(0, 0, regErase.w, regErase.h).data;
          let n = 0, max = 0;
          for (let i = 0; i < sA.length; i += 1) {
            const d = Math.abs(sA[i] - sB[i]);
            if (d > 0) n++;
            if (d > max) max = d;
          }
          /* ikinci varyant: ctx.translate ile kaydırma */
          const cC = document.createElement('canvas');
          cC.width = regErase.w; cC.height = regErase.h;
          const gC = cC.getContext('2d', { colorSpace: 'srgb' });
          gC.translate(-regErase.x, -regErase.y);
          drawLine(gC, 0, 0);
          const sC = gC.getImageData(regErase.x, regErase.y, regErase.w, regErase.h).data;
          let nC = 0, maxC = 0;
          for (let i = 0; i < sA.length; i += 1) {
            const d = Math.abs(sA[i] - sC[i]);
            if (d > 0) nC++;
            if (d > maxC) maxC = d;
          }
          return { n, max, nC, maxC };
        } catch (e) { return { err: String(e).slice(0, 120) }; }
      })();
      const diffPng = (d1, d2, w, h) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = '#101010';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < d1.length; i += 4) {
          let cmax = 0;
          for (let k = 0; k < 4; k++) cmax = Math.max(cmax, Math.abs(d1[i+k] - d2[i+k]));
          if (cmax > 0) {
            const px = (i >> 2) % w, py = (i >> 2) / w | 0;
            g.fillStyle = cmax > 64 ? '#ff2020' : '#ffe040';
            g.fillRect(px, py, 1, 1);
          }
        }
        return c.toDataURL('image/png');
      };

      return JSON.stringify({
        S0w: S0.w, S0h: S0.h,
        regErase: regEraseArr,
        undoSteady: cmp(U0.d, U1.d),
        undoWorkerIdle,
        refVsS0: cmp(R0.d, S0.d),
        undoIn: cmpIn(U1.d, R0.d, { x: regEraseArr[0], y: regEraseArr[1], w: regEraseArr[2], h: regEraseArr[3] }),
        undoAll: cmp(U1.d, R0.d),
        redoVsS1: cmp(RD.d, S1.d),
        smudgeUndoAll: cmp(US.d, RS.d),
        abErase, abSmudge, abFlow,
        dirtyAfterUndo, pureTest,
        strokes: layer.strokes.length,
        kinds: layer.strokes.map(s => s.kind + (s.strokeType ? ':' + s.strokeType : '') + (s.shape ? ':' + s.shape : '')),
        stats: Object.assign({}, inkUndoRaster.stats),
        pngUndoVsRef: diffPng(U1.d, R0.d, W_, H_),
        pngSmudge: diffPng(US.d, RS.d, W_, H_),
      });
    })()`));
    app.kill();
  } catch (e) {
    try { app.kill(); } catch { /* */ }
    console.error('PROBE HATASI: ' + (e && e.stack ? e.stack.slice(0, 700) : String(e)));
    process.exit(1);
  }

  const fsx = require('fs');
  const t1 = path.join(os.tmpdir(), 'undo-vref.png');
  const t2 = path.join(os.tmpdir(), 'undo-smudge.png');
  fsx.writeFileSync(t1, Buffer.from(rep.pngUndoVsRef.split(',')[1], 'base64'));
  fsx.writeFileSync(t2, Buffer.from(rep.pngSmudge.split(',')[1], 'base64'));
  const summary = Object.assign({}, rep, { pngUndoVsRef: '<png>', pngSmudge: '<png>' });
  console.log(JSON.stringify(summary, null, 1));
  console.log('görseller: ' + t1 + ' ; ' + t2);

  check('fallback scratch yolu çalıştı (fallbacks>0, regionRebuilds>0)',
    rep.stats.fallbacks > 0 && rep.stats.regionRebuilds > 0,
    'fallbacks=' + rep.stats.fallbacks + ' regionRebuilds=' + rep.stats.regionRebuilds);

  check('tam kurulum referansı deterministik (R0==S0 · 0 px)',
    rep.refVsS0.n === 0, 'diffPx=' + rep.refVsS0.n + ' maxΔ=' + rep.refVsS0.max);

  check('undo worker işleri üst sınırda kapandı (yarışsız ölçüm)',
    rep.undoWorkerIdle && rep.undoWorkerIdle.idle === true,
    'idle=' + (rep.undoWorkerIdle && rep.undoWorkerIdle.idle) +
    ' süre=' + (rep.undoWorkerIdle && rep.undoWorkerIdle.ms) + ' ms' +
    ' stats=' + JSON.stringify(rep.stats));

  check('undo sonrası pikseller durgun (worker kapandıktan sonra U0==U1 · 0 px; tembel üst-yazım yok)',
    rep.undoSteady.n === 0,
    'diffPx=' + rep.undoSteady.n + ' maxΔ=' + rep.undoSteady.max +
    ' dirty=' + JSON.stringify(rep.dirtyAfterUndo));

  check('undo (scratch bölgesel) == tam vektör referans (0 px)',
    rep.undoAll.n === 0 && rep.undoAll.max === 0,
    'diffPx=' + rep.undoAll.n + ' maxΔ=' + rep.undoAll.max +
    ' bölgeİçi=' + rep.undoIn.rin + (rep.undoIn.rout ? ' bölgeDIŞI=' + rep.undoIn.rout : ''));

  check('redo (scratch bölgesel) == vuruş sonrası tam kurulum (0 px)',
    rep.redoVsS1.n === 0 && rep.redoVsS1.max === 0,
    'diffPx=' + rep.redoVsS1.n + ' maxΔ=' + rep.redoVsS1.max);

  check('smudge undo (scratch piksel-okumalı) == tam vektör referans (0 px)',
    rep.smudgeUndoAll.n === 0 && rep.smudgeUndoAll.max === 0,
    'diffPx=' + rep.smudgeUndoAll.n + ' maxΔ=' + rep.smudgeUndoAll.max);

  check('izole A/B (flow-R0 anı): R0 üstünde bölge scratch kurulumu dilim-birebir',
    rep.abFlow.ok && rep.abFlow.n === 0,
    'AB-flow diff=' + (rep.abFlow.ok ? rep.abFlow.n : 'hata') +
    ' maxΔ=' + (rep.abFlow.ok ? rep.abFlow.max : '-'));

  check('izole A/B: tam kurulumdan sonra bölge scratch kurulumu dilim-birebir',
    rep.abErase.ok && rep.abErase.n === 0 && rep.abSmudge.ok && rep.abSmudge.n === 0,
    'AB-erazer diff=' + (rep.abErase.ok ? rep.abErase.n : 'hata') +
    ' AB-smudge diff=' + (rep.abSmudge.ok ? rep.abSmudge.n : 'hata'));

  console.log('\nUNDO-REGION: ' + (failures ? failures + ' FAIL' : 'TÜMÜ GEÇTİ'));
  process.exit(failures ? 1 : 0);
})();
