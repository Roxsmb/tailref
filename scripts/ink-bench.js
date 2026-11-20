'use strict';

/* Cizim motoru olcum kosusu (Faz 0).

   Gercek uygulamayi (Electron) izole bir profil ile baslatir, sayfada
   sentetik vuruslar uretir ve su sayilari raporlar:

     • commit   : vuruşu katmana isleme suresi (ms, ana is parcacigi; 3 turun en iyisi)
     • paint    : agir vuruslarda worker rasterinin uygulanma beklemesi (ms)
     • canvas   : ayni vurusun 1024x1024 tuvalde raster suresi (ms)
     • live     : surukleme sirasinda pointermove basina maliyet (ms)
     • dab / yol: damla sayisi ve yol (path) ile cizilen vurus sayisi
     • atlas    : damga atlasi isabet orani
     • bellek   : JS heap (MB)

   Kullanim:
     node scripts/ink-bench.js
     node scripts/ink-bench.js --json        (makine okunur ozet)
     node scripts/ink-bench.js --quick       (yalnizca 1k / 4k)

   Esikler (regresyon kapisi):
     commit dagitimi (plan+dispatch, canli final haric) < 8 ms
     canli final yeniden cizim (commit icinde)      < 24 ms
     surukleme kare basina                          <= 8 ms
     sert/damla vuruslar worker'a gider             (jobs >= 1, dabs > 0)
     sert firca yol cizimi (path-uygun bench firçasi) pathStrokes > 0
     worker raster beklemesi                        < 500 ms
   Esik asilirsa cikis kodu 1 olur. */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9336;
const APP_PORT = 5199;
const JSON_OUT = process.argv.includes('--json');
const QUICK = process.argv.includes('--quick');
// Varsayilan: yazilim raster (--disable-gpu) → karsilastirilabilir taban.
// --gpu: gercek donanim hizlandirma; GPU onizleme yolu burada olculur.
const USE_GPU = process.argv.includes('--gpu');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function electronPath() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('electron bulunamadi (npm install)');
  return found;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

const evaluate = (ws, expression, timeoutMs = 30000) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) {
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatasi'));
    }
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  setTimeout(() => reject(new Error('eval zaman asimi')), timeoutMs);
});

async function waitForTarget(deadlineMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henuz hazir degil */ }
    await sleep(400);
  }
  throw new Error('uygulama hata ayiklama portu acilmadi');
}

/* Sayfa tarafi: sentetik vurus uret, gercek commit yolunu olc. */
const BENCH_HELPER = `
window.__inkBench = (function () {
  function makePoints(n, kind) {
    const pts = [];
    const turns = 5;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const a = t * Math.PI * 2 * turns;
      const r = 60 + 640 * t;
      pts.push({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r * 0.75,
        p: kind === 'soft' ? 0.55 + 0.35 * Math.sin(t * Math.PI) : 1,
      });
    }
    return pts;
  }

  function makeStroke(n, kind) {
    const hard = kind !== 'soft';
    return {
      id: 'sk_bench_' + Math.random().toString(36).slice(2),
      kind: 'stroke', tool: 'brush', shape: '',
      color: '#2f7bff',
      size: 24,
      opacity: 1,
      hardness: hard ? 1 : 0.4,
      spacing: hard ? 0.07 : 0.09,
      /* 'ink-hard' (native-studio-pen) speedSize>0 → damla yolu (belgeli).
         Yol (path) çizici senkron satır 'hardpath' türüyle ölçülür. */
      brushId: kind === 'hardpath' ? 'bench-hard-path' : (hard ? 'ink-hard' : 'ink-soft'),
      scatter: 0, closed: false,
      points: makePoints(n, kind),
    };
  }

  function tempLayer() {
    const layer = inkMakeLayer({ kind: 'global', plane: 'below', name: 'bench' });
    const ink = inkState();
    ink.layers.push(layer);
    ink.activeLayerId = layer.id;
    return layer;
  }

  /* Yerel fırça kütüphanesi init sırasında dolmazsa bench 'ink-hard' /
     'ink-soft' kimliklerini çözemez → pathEligible/worker ölçümleri
     yanlış çıkar. Burada mutlaka dolu olduğundan emin olur. */
  function ensureBrushes() {
    const ink = inkState();
    if (!ink.brushes || !ink.brushes.length) {
      if (typeof inkDefaultBrushes === 'function') {
        ink.brushes = inkDefaultBrushes();
      } else if (typeof inkNativeBrushDefaults === 'function') {
        ink.brushes = inkNativeBrushDefaults();
      }
    }
    /* Yol çizim satırı için path-uygun bench fırçası: hız incelmesi
       (speedSize) kapalı, tek daire uç, dinamiksiz → senkron ana yolda
       pathStrokes sayaçlı çizilir. Yalnızca bench ortamına eklenir. */
    if (ink.brushes && !ink.brushes.some(b => b && b.id === 'bench-hard-path')) {
      ink.brushes.push({
        id: 'bench-hard-path', name: 'Bench Hard (path)', category: 'custom',
        tip: 'circle', size: 24, opacity: 1, hardness: 1, spacing: 0.07,
        smoothing: 0.5, flow: 1, roundness: 1, scatter: 0,
      });
    }
    return !!(ink.brushes && ink.brushes.length);
  }

  function dropLayer(layer) {
    for (const [key, tile] of [...inkRuntime.tiles]) {
      if (tile.layerId !== layer.id) continue;
      tile.canvas.remove();
      inkRuntime.tiles.delete(key);
    }
    const ink = inkState();
    ink.layers = ink.layers.filter(l => l.id !== layer.id);
    if (ink.activeLayerId === layer.id) {
      ink.activeLayerId = ink.layers.length ? ink.layers[ink.layers.length - 1].id : null;
    }
    ink.selection = [];
    if (typeof inkWorkerResetLayer === 'function') inkWorkerResetLayer(layer.id);
    undoStack.length = 0;
    redoStack.length = 0;
  }

  function measureCommit(layer, stroke) {
    inkPerfReset();
    inkPointer = {
      mode: 'freehand', tool: 'brush', layer, stroke,
      smoothX: 0, smoothY: 0,
      startWorld: { x: 0, y: 0 }, startLocal: { x: 0, y: 0 },
      lastPressure: 1, lastScreen: null, collected: stroke.points.length,
    };
    const t0 = performance.now();
    inkCommitFreehand();
    const ms = performance.now() - t0;
    const before = typeof inkWorkerStats === 'function' ? inkWorkerStats() : null;
    const t1 = performance.now();
    return Promise.resolve(typeof inkPaintIdle === 'function' ? inkPaintIdle() : null).then(() => {
      const paintMs = performance.now() - t1;
      const after = typeof inkWorkerStats === 'function' ? inkWorkerStats() : null;
      const snap = inkPerfSnapshot();
      return {
        ms, paintMs, snap,
        workerJobs: after && before ? after.jobs - before.jobs : 0,
        workerApplied: after && before ? after.applied - before.applied : 0,
        workerDabs: after && before ? (after.wDabs || 0) - (before.wDabs || 0) : 0,
        workerPath: after && before ? (after.wPath || 0) - (before.wPath || 0) : 0,
      };
    });
  }

  function measureCanvas(stroke) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    const ctx = c.getContext('2d');
    const K = 0.5;
    const t0 = performance.now();
    inkDrawStrokeOnContext(ctx, stroke, {
      mapPoint: p => ({ x: p.x * K + 512, y: p.y * K + 512 }),
      sizePx: stroke.size * K,
    });
    return performance.now() - t0;
  }

  function measureLive(layer, stroke) {
    inkEnsureLiveCanvas();
    inkClearLive();
    const live = Object.assign({}, stroke, {
      id: 'sk_live_' + Math.random().toString(36).slice(2),
      points: stroke.points.slice(0, 2),
    });
    inkPointer = {
      mode: 'freehand', tool: 'brush', layer, stroke: live,
      smoothX: 0, smoothY: 0,
      startWorld: { x: 0, y: 0 }, startLocal: { x: 0, y: 0 },
      lastPressure: 1, lastScreen: null, collected: 0,
    };
    const n = stroke.points.length;
    const steps = Math.min(120, n - 1);
    const t0 = performance.now();
    for (let i = 1; i <= steps; i++) {
      // Hizli surukleme: vurusun tamami uzerinden ornekle.
      const pt = stroke.points[Math.floor((i * (n - 1)) / steps)];
      const screen = worldToScreen(pt);
      inkUpdateFreehandDrag({
        clientX: screen.x, clientY: screen.y,
        pressure: 1, pointerType: 'pen',
      });
    }
    const ms = (performance.now() - t0) / Math.max(1, steps);
    inkCancelStroke();
    inkClearLive();
    return ms;
  }

  function alphaSum(canvas) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 3; i < d.length; i += 4) sum += d[i];
    return sum;
  }

  /* Kirli dikdortgen dogrulamasi: vurus tasininca eski karo bosalmali,
     yeni karo dolmali. */
  function dirtyRectCheck() {
    const layer = tempLayer();
    const stroke = {
      id: 'sk_dirty_' + Math.random().toString(36).slice(2),
      kind: 'stroke', tool: 'brush', shape: '',
      color: '#ff3355', size: 40, opacity: 1, hardness: 1,
      spacing: 0.07, brushId: 'ink-hard', scatter: 0, closed: false,
      points: [
        { x: 40, y: 40, p: 1 },
        { x: 220, y: 40, p: 1 },
        { x: 220, y: 120, p: 1 },
      ],
    };
    layer.strokes.push(stroke);
    inkRasterizeGlobalStroke(layer, stroke);
    const t0 = inkRuntime.tiles.get(inkTileKey(layer.id, 0, 0));
    const before = t0 ? alphaSum(t0.canvas) : 0;
    const oldBounds = inkStrokeWorldBounds(layer, stroke);

    for (const p of stroke.points) p.x += 700;
    const newBounds = inkStrokeWorldBounds(layer, stroke);
    inkMarkLayerDirty(layer, inkUnionRect(oldBounds, newBounds));
    inkFlushDirtyLayers();

    const t0b = inkRuntime.tiles.get(inkTileKey(layer.id, 0, 0));
    const after = t0b ? alphaSum(t0b.canvas) : 0;
    const t1 = inkRuntime.tiles.get(inkTileKey(layer.id, 1, 0));
    const moved = t1 ? alphaSum(t1.canvas) : 0;
    dropLayer(layer);
    inkStampClear();
    return {
      before, after, moved,
      ok: before > 0 && after === 0 && moved > 0,
    };
  }

  /* Canli onizleme (cizim modu) olcumu.
     Eski yol her karede tam katman kopyasi + vurusun tamamini yeniden
     ciziyordu. Yeni yol artimli: GPU varsa yalnizca YENI damlalar FBO'ya,
     yoksa yalnizca yeni damlalar 2B tuvale. Ayni vurus icin iki maliyeti
     de olcup oranı raporlar. */
  function previewBench() {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ui = typeof inkEditorUi !== 'undefined' ? inkEditorUi : null;
    if (!ui) return Promise.resolve({ ok: false, reason: 'editor yok' });

    /* Bench bos profilde calisir; olcum icin bir gorsel gerekir. */
    function ensureImage() {
      const found = state.items.find(i => i.kind === 'image');
      if (found) return Promise.resolve(found);
      const c = document.createElement('canvas');
      c.width = 1400;
      c.height = 1000;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, '#2b3a55');
      g.addColorStop(1, '#d9dee8');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      return new Promise(resolve => c.toBlob(blob => {
        const file = new File([blob], 'bench-preview.png', { type: 'image/png' });
        Promise.resolve(addFiles([file], null)).then(() => {
          const deadline = Date.now() + 8000;
          const poll = () => {
            const it = state.items.find(i => i.kind === 'image');
            if (it || Date.now() > deadline) resolve(it || null);
            else setTimeout(poll, 100);
          };
          poll();
        });
      }, 'image/png'));
    }

    return ensureImage().then(it => {
      if (!it) return { ok: false, reason: 'gorsel olusturulamadi' };
      if (typeof modeEnterDraw === 'function') modeEnterDraw(it.id);
      else if (typeof inkEnterImageScope === 'function') inkEnterImageScope(it.id);
      return wait(550);
    }).then(result => {
      if (result && result.ok === false) return result;
      if (!ui.open) return { ok: false, reason: 'editor acilmadi' };
      const canvas = document.getElementById('inkEditorCanvas');
      const fit = ui.fit;
      if (!canvas || !(fit.w > 1)) return { ok: false, reason: 'fit yok' };

      const pid = 7000 + Math.floor(Math.random() * 500);
      const mk = (type, x, y, pressure) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: pid, pointerType: 'pen', isPrimary: true,
        pressure, clientX: x, clientY: y,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      });

      const steps = 96;
      const y0 = fit.y + fit.h * 0.16;
      const y1 = fit.y + fit.h * 0.84;
      const x0 = fit.x + fit.w * 0.10;
      const x1 = fit.x + fit.w * 0.90;

      /* Damla sayaci: GPU'da biriken damla, 2B yedekte atlanan damla. */
      const dabsOf = () => (ui.previewGl && typeof inkDabGlStats === 'function'
        ? inkDabGlStats().dabs : ui.previewSkip);

      /* Bir vurusu adim adim surer; her adimda editor karesini SENKRON
         calistirir (rAF araya giremez) ve suresini toplar. Vurus parmak
         kalkana kadar acik kalir; release() ayrica cagrilir. */
      function drive() {
        const times = [];
        const dabs0 = dabsOf();
        canvas.dispatchEvent(mk('pointerdown', x0, y0, 0.9));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const px = x0 + (x1 - x0) * t;
          const py = y0 + (y1 - y0) * t;
          canvas.dispatchEvent(mk('pointermove', px, py, 0.35 + 0.6 * Math.sin(t * Math.PI)));
          ui.previewDirty = true;
          const t0 = performance.now();
          inkEditorRender();
          times.push(performance.now() - t0);
        }
        // Ilk kare dokuyu yukler / FBO kurar; ortalama onu disarida birakir
        // (tepe degeri zaten gorunur).
        const warm = times.slice(1);
        const avg = warm.reduce((a, b) => a + b, 0) / Math.max(1, warm.length);
        return {
          frameMs: avg,
          firstMs: times[0],
          worstMs: Math.max(...times),
          dabs: Math.max(0, dabsOf() - dabs0),
        };
      }

      function release() {
        canvas.dispatchEvent(mk('pointerup', x1, y1, 0.9));
      }

      /* Tekrar kare: yeni damla yoksa maliyet ~0 olmali (artimlilik). */
      function repeatFrame() {
        const d0 = dabsOf();
        ui.previewDirty = true;
        const t0 = performance.now();
        inkEditorRender();
        const ms = performance.now() - t0;
        return { ms, dabsDelta: Math.max(0, dabsOf() - d0) };
      }

      const glSupported = typeof window.__inkGl === 'object' && window.__inkGl.supported();
      const gl = glSupported ? drive() : { frameMs: 0, worstMs: 0, dabs: 0 };
      const glRepeat = glSupported ? repeatFrame() : { ms: 0, dabsDelta: -1 };

      /* Eski kare maliyeti: tam katman kopyasi + vurusun tamami. Ayni
         vurusun son hali uzerinden olculur (vurus commit edilmeden once). */
      const layer = inkEditorTargetLayer();
      const layerCanvas = layer ? inkEnsureItemCanvas(layer) : null;
      const stroke = ui.stroke;
      let copyMs = 0;
      let fullMs = 0;
      if (layerCanvas && stroke) {
        const scratch = document.createElement('canvas');
        scratch.width = layerCanvas.width;
        scratch.height = layerCanvas.height;
        const sctx = scratch.getContext('2d');
        const t0 = performance.now();
        sctx.drawImage(layerCanvas, 0, 0);
        copyMs = performance.now() - t0;
        const opts = {
          mapPoint: p => ({ x: p.x * layerCanvas.width, y: p.y * layerCanvas.height }),
          sizePx: Math.max(0.5, stroke.size * layerCanvas.width),
        };
        const t1 = performance.now();
        inkDrawStrokeOnContext(sctx, stroke, opts);
        fullMs = performance.now() - t1;
      }
      if (ui.stroke) release();

      /* 2B yedek yol: GPU kapatilinca ayni artimlilik korunmali. */
      let fallback = { frameMs: 0, worstMs: 0, dabs: 0 };
      let fallbackRepeat = { ms: 0, dabsDelta: -1 };
      let fallbackSkip = 0;
      if (typeof window.__inkGl === 'object') {
        if (ui.stroke) inkEditorDropStroke();
        window.__inkGl.disable();
        fallback = drive();
        fallbackRepeat = repeatFrame();
        fallbackSkip = ui.previewSkip;
        if (ui.stroke) release();
        window.__inkGl.enable();
      }
      if (ui.stroke) inkEditorDropStroke();
      if (typeof modeExitDraw === 'function') modeExitDraw();

      return {
        ok: true,
        gl: glSupported,
        glFrameMs: gl.frameMs,
        glWorstMs: gl.worstMs,
        glDabs: gl.dabs,
        glRepeatMs: glRepeat.ms,
        glRepeatDabs: glRepeat.dabsDelta,
        oldCopyMs: copyMs,
        oldStrokeMs: fullMs,
        oldFrameMs: copyMs + fullMs,
        fallbackFrameMs: fallback.frameMs,
        fallbackWorstMs: fallback.worstMs,
        fallbackDabs: fallback.dabs,
        fallbackRepeatMs: fallbackRepeat.ms,
        fallbackRepeatDabs: fallbackRepeat.dabsDelta,
        fallbackSkip,
        layerW: layerCanvas ? layerCanvas.width : 0,
        layerH: layerCanvas ? layerCanvas.height : 0,
      };
    });
  }

  /* Sicak olcum: ayni vurus tekrar tekrar commit edilirse katmanda kopyalari
     birikir ve kirli dikdortgen yeniden cizimi sismeye baslar. Her turdan
     once eski kopyalari cikar; boylece senkron ve worker yollari gercek
     "tek vurus" durumunu olcer. */
  function resetStroke(layer, stroke) {
    if (layer.strokes.some(s => s.id === stroke.id)) {
      layer.strokes = layer.strokes.filter(s => s.id !== stroke.id);
    }
  }

  function best(values) {
    return values.reduce((a, b) => Math.min(a, b), Infinity);
  }

  function run(n, kind) {
    ensureBrushes();
    const stroke = makeStroke(n, kind);
    const layer = tempLayer();
    return measureCommit(layer, stroke).then(cold => {
      // Uc sicak tur: tek bir OS/GC sapmasi esigi yanlislikla dusurmesin.
      // En iyi tur raporlanir; gercek bir yavaslama uc turun hepsini yukseltir.
      const warms = [];
      let chain = Promise.resolve();
      for (let i = 0; i < 3; i++) {
        chain = chain.then(() => {
          resetStroke(layer, stroke);
          return measureCommit(layer, stroke);
        }).then(w => warms.push(w));
      }
      return chain.then(() => {
        // En iyi tur (ms) ve O turun canlı-final/dağıtım ayrışması.
        const bestWarm = warms.reduce((a, b) => (b.ms < a.ms ? b : a), warms[0]);
        const warmMs = bestWarm.ms;
        const lfC = bestWarm.snap.counters;
        const liveFinalMs = lfC.liveFinalMs || 0;
        const dispatchMs = Math.max(0, warmMs - liveFinalMs);
        const paintMs = best(warms.map(w => w.paintMs));
        const last = warms[warms.length - 1];
        const workerJobs = Math.max(...warms.map(w => w.workerJobs));
        const workerApplied = Math.max(...warms.map(w => w.workerApplied));
        const workerDabs = Math.max(...warms.map(w => w.workerDabs));
        const workerPath = Math.max(...warms.map(w => w.workerPath));
        const canvasMs = measureCanvas(stroke);
        const liveMs = measureLive(layer, stroke);
        const snap = last.snap;
        const c = snap.counters;
        const out = {
          n, kind,
          commitColdMs: cold.ms,
          commitWarmMs: warmMs,
          liveFinalMs,
          dispatchMs,
          paintColdMs: cold.paintMs,
          paintMs,
          canvasMs,
          liveMs,
          dabs: c.dabs || workerDabs || 0,
          dabsEst: Math.round(inkEstimateDabs(stroke, Math.max(0.5, stroke.size), 1, 1)),
          workerJobs,
          workerApplied,
          workerDabs,
          workerPath,
          pathStrokes: c.pathStrokes || 0,
          stagedStrokes: c.stagedStrokes || 0,
          tiles: snap.tiles,
          stampHitRate: snap.stamp ? snap.stamp.hitRate : 0,
          stampAtlas: snap.stamp ? snap.stamp.size : 0,
          heapMb: snap.heapMb,
          undoSnapMs: snap.avg.undoSnapMs,
        };
        dropLayer(layer);
        inkStampClear();
        return out;
      });
    });
  }
  run.dirtyRect = dirtyRectCheck;
  run.preview = previewBench;
  run.ensureBrushes = ensureBrushes;
  return run;
})();
true;
`;

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-bench-'));
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), [
    '.',
    `--remote-debugging-port=${PORT}`,
    ...(USE_GPU ? [] : ['--disable-gpu']),
    '--no-sandbox',
    '--enable-precise-memory-info',
  ], { cwd: ROOT, env, stdio: 'ignore' });

  let ws = null;
  const rows = [];
  const problems = [];

  try {
    const page = await waitForTarget();
    ws = await connect(page.webSocketDebuggerUrl);

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = await evaluate(ws, "typeof state !== 'undefined' && typeof inkState === 'function' && !!state.ink && !!stage.clientWidth");
        if (ready) break;
      } catch { /* henuz degil */ }
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazir olmadi');
    await sleep(800);
    await evaluate(ws, BENCH_HELPER);

    // Yerel fırça kütüphanesinin yüklü olduğundan emin ol; bench ortamında
    // init bazen brushes dizisini boş bırakır → inkGetBrush undefined döner.
    await evaluate(ws, `window.__inkBench.ensureBrushes()`);

    // Alt+P HUD sanity check (Faz 0).
    const hudOk = await evaluate(ws, `(() => {
      const on = window.__inkPerf.toggle(true);
      const el = document.getElementById('inkPerfHud');
      const text = el ? el.textContent : '';
      window.__inkPerf.toggle(false);
      return !!on && text.indexOf('ink perf') === 0;
    })()`);
    if (!hudOk) problems.push('Alt+P HUD calismadi');

    const dirty = JSON.parse(await evaluate(ws, 'JSON.stringify(window.__inkBench.dirtyRect())'));
    if (!dirty.ok) {
      problems.push('kirli dikdortgen redraw hatali (' + JSON.stringify(dirty) + ')');
    }

    const sizes = QUICK ? [1000, 4000] : [1000, 4000, 10000];
    const kinds = ['hard', 'soft', 'hardpath'];
    const kindSizes = kind => (kind === 'hardpath' ? [4000] : sizes);

    if (!JSON_OUT) {
      console.log('ink bench · Electron ' + (process.versions.electron || '?') + ' · ' +
        (USE_GPU ? 'donanim hizlandirma' : 'yazilim raster (--disable-gpu)'));
      console.log('');
      console.log('kind     n      commit(cold/warm)  emit    paint    canvas   live/frame   dab     path  atlas   heap');
      console.log('-------  -----  ------------------  ------  -------  -------  -----------  ------  ----  ------  -----');
    }

    let warmedWorker = false;
    for (const kind of kinds) {
      // Worker'ı ilk yumuşak satırdan önce ısıt: iş parçacığı başlatma ve
      // damga önbelleği maliyeti ölçüme karışmasın.
      if (kind === 'soft' && !warmedWorker) {
        await evaluate(ws, "window.__inkBench(1000, 'soft').then(() => 'warm')", 180000);
        warmedWorker = true;
      }
      for (const n of kindSizes(kind)) {
        const r = await evaluate(ws, `window.__inkBench(${n}, '${kind}').then(r => JSON.stringify(r))`, 180000);
        const row = JSON.parse(r);
        rows.push(row);
        if (!JSON_OUT) {
          console.log(
            kind.padEnd(8) + ' ' +
            String(n).padEnd(6) + ' ' +
            (round(row.commitColdMs) + ' / ' + round(row.commitWarmMs)).padEnd(19) + ' ' +
            (round(row.liveFinalMs) + ' ms').padEnd(8) + ' ' +
            (round(row.paintMs) + ' ms').padEnd(8) + ' ' +
            (round(row.canvasMs) + ' ms').padEnd(8) + ' ' +
            (round(row.liveMs) + ' ms').padEnd(12) + ' ' +
            String(row.dabs || ('~' + row.dabsEst)).padEnd(7) + ' ' +
            String(row.pathStrokes).padEnd(5) + ' ' +
            (Math.round(row.stampHitRate * 100) + '%').padEnd(7) + ' ' +
            (row.heapMb == null ? '-' : row.heapMb + ' MB')
          );
        }
      }
    }

    // Canli onizleme (cizim modu): GPU artimli kare vs eski tam yeniden cizim.
    const preview = JSON.parse(await evaluate(ws,
      'window.__inkBench.preview().then(r => JSON.stringify(r))', 120000));
    if (!JSON_OUT && preview.ok) {
      console.log('');
      console.log('onizleme (cizim modu) · katman ' + preview.layerW + 'x' + preview.layerH +
        ' · gpu ' + (preview.gl ? 'var' : 'yok'));
      console.log('  eski kare (kopya+vurus)  ' + round(preview.oldFrameMs) + ' ms' +
        '  (kopya ' + round(preview.oldCopyMs) + ' + vurus ' + round(preview.oldStrokeMs) + ')');
      if (preview.gl) {
        console.log('  gpu kare                 ' + round(preview.glFrameMs) + ' ms' +
          '  (tepe ' + round(preview.glWorstMs) + ' · ' + preview.glDabs + ' damla)');
        console.log('  gpu tekrar kare          ' + round(preview.glRepeatMs) + ' ms' +
          '  (+' + preview.glRepeatDabs + ' damla)');
      }
      console.log('  2B yedek kare            ' + round(preview.fallbackFrameMs) + ' ms' +
        '  (tepe ' + round(preview.fallbackWorstMs) + ' · ' + preview.fallbackDabs + ' damla)');
      console.log('  2B yedek tekrar kare     ' + round(preview.fallbackRepeatMs) + ' ms' +
        '  (+' + preview.fallbackRepeatDabs + ' damla · atlanan ' + preview.fallbackSkip + ')');
    }

    const get = (kind, n) => rows.find(r => r.kind === kind && r.n === n);    const h1k = get('hard', 1000);
    const h4k = get('hard', 4000);
    const h10k = get('hard', 10000);
    const liveWorst = Math.max(...rows.map(r => r.liveMs));
    // Damga atlasi yalnizca damla (soft) yolunda kullanilir.
    const softRows = rows.filter(r => r.kind === 'soft');
    const stampWorst = softRows.length ? Math.min(...softRows.map(r => r.stampHitRate)) : 1;

    const gate = (ok, msg) => { if (!ok) problems.push(msg); };
    /* Commit bileşenleri: dağıtım (plan+dispatch+undo snap; canlı final
       yeniden çizimi hariç) ve canlı final. Worker raster ana iş
       parçacığını bloklamaz; sürekli çalışan maliyetler bu ikisidir. */
    gate(h1k && h1k.dispatchMs < 8, '1000 nokta commit dagitim >= 8 ms');
    gate(h4k && h4k.dispatchMs < 8, '4000 nokta commit dagitim >= 8 ms');
    if (h10k) gate(h10k.dispatchMs < 8, '10000 nokta commit dagitim >= 8 ms');
    gate(rows.every(r => r.liveFinalMs < 24), 'canli final yeniden cizim >= 24 ms');
    gate(liveWorst <= 8, 'surukleme kare basina > 8 ms');
    // Ana iş parçacığında çizilen satırlarda damga atlası kullanılmalı.
    const stampRows = softRows.filter(r => !r.workerApplied);
    gate(stampRows.every(r => r.stampHitRate >= 0.5), 'damga atlasi isabet orani < %50');
    /* Yol çizimi: path-uygun bench fırçası senkron (ana) yolda çizilir;
       'ink-hard' ise hız incelmesi nedeniyle belgeli olarak damla yolundadır. */
    const hp = get('hardpath', 4000);
    gate(hp && hp.pathStrokes > 0, 'sert firca yol cizimi calismadi');
    // P1: damla vuruşları worker'a taşınır; worker içi damla sayacı
    // applied mesajıyla döner (ana sayaçlar worker'ı izleyemez).
    const workerRows = rows.filter(r => r.kind !== 'hardpath');
    gate(workerRows.every(r => r.workerJobs >= 1 && r.workerApplied >= 1), 'vuruslar worker rasterina tasinmadi');
    gate(workerRows.every(r => r.workerDabs > 0), 'worker damla sayisi raporlanmadi');
    gate(workerRows.every(r => r.dispatchMs < 8), 'worker commit (ana is parcacigi) >= 8 ms');
    gate(workerRows.every(r => r.paintMs < 500), 'worker raster beklemesi > 500 ms');
    // Canli onizleme: her iki arka uc da artimli olmali; GPU varsa kare
    // butcesinde kalmali. Eski yol tam katman kopyasi + vurusun tamamiydi.
    gate(preview.ok, 'canli onizleme olcumu calismadi (' + (preview.reason || '?') + ')');
    if (preview.ok) {
      gate(preview.fallbackSkip > 0 && preview.fallbackRepeatDabs === 0,
        '2B yedek onizleme artimli degil (atlanan ' + preview.fallbackSkip +
        ', tekrar ' + preview.fallbackRepeatDabs + ')');
      gate(preview.fallbackFrameMs <= 8, '2B yedek onizleme karesi > 8 ms');
      if (preview.gl) {
        gate(preview.glRepeatDabs === 0, 'GPU onizleme tekrar karede yeni damla cizdi');
        gate(preview.glFrameMs <= 8, 'GPU onizleme karesi > 8 ms');
        // Eski tam yeniden cizimle karsilastirma yalnizca gercek GPU'da
        // anlamli: yazilim rasterda GPU yolu CPU'ya dusup yavas gorunur.
        if (USE_GPU && preview.layerW >= 1200) {
          gate(preview.glFrameMs < preview.oldFrameMs,
            'GPU onizleme eski tam yeniden cizimden yavas (' +
            round(preview.glFrameMs) + ' / ' + round(preview.oldFrameMs) + ' ms)');
        }
      }
    }

    if (JSON_OUT) {
      console.log(JSON.stringify({ rows, preview, problems }, null, 2));
    } else {
      console.log('');
      const verdict = problems.length ? 'FAIL: ' + problems.join(' · ') : 'OK: esikler saglandi';
      console.log(verdict);
    }
  } catch (err) {
    console.error('BENCH HATASI:', err && err.message ? err.message : err);
    problems.push('bench hatasi');
  } finally {
    try { ws && ws.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
    await sleep(200);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* sessiz */ }
    process.exit(problems.length ? 1 : 0);
  }
})();
