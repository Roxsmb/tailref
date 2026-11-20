'use strict';

/* Tekil vuruş (tek nokta) eğim damgası teşhis probe — ink-smoke yardımcılarını
   yeniden kullanır. Amaç: "eğim damgayı yassılaştırdı → 2×2" kırmızısının
   kökünü ayırt etmek:
     A) commit/worker hattı damlayı hiç boyamadı mı?
     B) emit (inkForEachDab) damla üretmiyor/yanlış yarıçap mı?
     C) stamp çizimi (inkDrawTiltedStamp) bu bağlamda çalışıyor mu?
   Kullanım: node scripts/tilt-probe.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9336;
const APP_PORT = 5199;
const PROBE_MODE = process.env.TILT_PROBE_MODE === 'board' ? 'board' : 'editor';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function electronPath() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('electron bulunamadı');
  return found;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 15000);
});

async function waitForTarget(deadlineMs = 20000) {
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

const PEN_HELPER = `
window.__inkPen = function (pts) {
  // Modal düzenleme açıkken girdi ana tahtaya değil editör tuvaline gider.
  // Testler tahta ekran koordinatı verdiği için dünya → görsel yereli →
  // editör ekranı dönüşümü burada yapılır (ink-smoke ile birebir).
  const editor = typeof inkEditorIsOpen === 'function' && inkEditorIsOpen();
  const editorLayer = editor ? inkLayerById(inkEditorUi.layerId) : null;
  const fit = editor ? inkEditorUi.fit : null;
  const mapPoint = p => {
    if (!editor || !editorLayer || !fit || !fit.w || !fit.h) return p;
    const world = screenToWorld({ x: p.x, y: p.y });
    const local = inkWorldToLocal(editorLayer, world);
    return Object.assign({}, p, {
      x: fit.x + local.x * fit.w,
      y: fit.y + local.y * fit.h,
    });
  };
  const mapped = pts.map(mapPoint);
  const first = mapped[0];
  const target = document.elementFromPoint(first.x, first.y) || stage;
  const surface = editor ? document.getElementById('inkEditorCanvas') : window;
  const pid = 4000 + Math.floor(Math.random() * 500);
  const mk = (type, p, pressure) => new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerId: pid, pointerType: 'pen', isPrimary: true,
    pressure, clientX: p.x, clientY: p.y,
    tiltX: p.tx || 0, tiltY: p.ty || 0,
    button: 0, buttons: type === 'pointerup' ? 0 : 1,
  });
  target.dispatchEvent(mk('pointerdown', first, first.p));
  for (let i = 1; i < mapped.length; i += 1) {
    surface.dispatchEvent(mk('pointermove', mapped[i], mapped[i].p));
  }
  surface.dispatchEvent(mk('pointerup', mapped[mapped.length - 1], mapped[mapped.length - 1].p));
  return true;
};
`;

const MEASURE_FN = `
window.__measureCanvas = function (canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, painted = 0;
  for (let yy = 0; yy < canvas.height; yy++) {
    for (let xx = 0; xx < canvas.width; xx++) {
      if (d[(yy * canvas.width + xx) * 4 + 3] > 8) {
        painted += 1;
        if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
        if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
      }
    }
  }
  return painted ? { painted, w: maxX - minX + 1, h: maxY - minY + 1, x: minX, y: minY } : { painted: 0 };
};
`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-tilt-'));
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  try {
    const page = await waitForTarget();
    const ws = await connect(page.webSocketDebuggerUrl);

    const deadline = Date.now() + 25000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
        if (ready) break;
      } catch { /* henüz değil */ }
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');
    await sleep(800);
    /* ink-smoke ile aynı sözleşme: önce katmanlar tohumlanıp (init'te
       çizim çekirdeği kurulur) karşılama diyaloğu kapatılır; erken kapatma
       init'in diyaloğu yeniden göstermesine yol açar. */
    let seeding = false;
    const seedStart = Date.now();
    while (Date.now() - seedStart < 8000) {
      try {
        seeding = await evaluate(ws, "typeof inkState === 'function' && !!state.ink");
        if (seeding) break;
      } catch { /* henüz hazır değil */ }
      await sleep(300);
    }
    if (!seeding) throw new Error('ink durumu başlamadı');
    await evaluate(ws, `(() => {
      const ink = inkState();
      const has = plane => ink.layers.some(l => l.kind === 'global' && l.plane === plane);
      if (!has('below')) inkAddLayer({ kind: 'global', plane: 'below', name: 'Eskiz' });
      if (!has('above')) inkAddLayer({ kind: 'global', plane: 'above', name: 'Notlar' });
      return ink.layers.length;
    })()`);
    await sleep(400);
    const canvasesStart = Date.now();
    let canvasesOk = false;
    while (Date.now() - canvasesStart < 8000) {
      try {
        canvasesOk = await evaluate(ws, "typeof inkState === 'function' && !!state.ink && state.ink.layers.length >= 2 && !!document.getElementById('inkToolbox')");
        if (canvasesOk) break;
      } catch { /* henüz hazır değil */ }
      await sleep(300);
    }
    if (!canvasesOk) throw new Error('çizim sistemi başlamadı');
    const welcome = await evaluate(ws, `(() => {
      const el = document.getElementById('persistenceWelcome');
      if (!el) return JSON.stringify({ present: false });
      if (!el.hidden && typeof closePersistenceWelcome === 'function') closePersistenceWelcome('auto');
      if (!el.hidden) el.hidden = true;               // son çare: direkt gizle
      return JSON.stringify({ present: true, hidden: !!el.hidden, fn: typeof closePersistenceWelcome });
    })()`);
    console.log('karşılama:', welcome);
    await evaluate(ws, PEN_HELPER);
    await evaluate(ws, MEASURE_FN);
    await evaluate(ws, 'window.__TailRef_INK_LEGACY_TEST__ = true; true');

    const setup = JSON.parse(await evaluate(ws, `(async () => {
      // Test görseli yoksa ekle.
      if (!state.items.some(i => i.kind === 'image')) {
        const c = document.createElement('canvas');
        c.width = 320; c.height = 240;
        const g = c.getContext('2d');
        g.fillStyle = '#4da3ff'; g.fillRect(0, 0, 320, 240);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        await addFiles([new File([blob], 'tilt.png', { type: 'image/png' })], null);
        await new Promise(r => setTimeout(r, 1200));
      }
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      selection.clear(); syncSelection(); fitAll(120);
      await new Promise(r => setTimeout(r, 400));
      const layer = inkEnsureAttachedLayer(it.id);
      // BOARD modu: smoke ortamı gibi editörü KAPAT (tahtadan çiz).
      // EDITÖR modu: modal açık, __inkPen haritalaması devrede.
      const mode = '${PROBE_MODE}';
      if (mode === 'board') {
        if (typeof inkScopeActiveFor === 'function' && inkScopeActiveFor(it.id)) inkExitImageScope();
        inkSetTool('brush'); inkState().activeLayerId = layer.id;
      } else if (typeof inkScopeActiveFor === 'function' && !inkScopeActiveFor(it.id)) {
        inkEnterImageScope(it.id);
        inkSetTool('brush'); inkState().activeLayerId = layer.id;
      }
      const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
      const saved = {
        hardness: state.ink.hardness, size: state.ink.size,
        brushId: state.ink.brushId, spacing: state.ink.spacing,
      };
      state.ink.hardness = 0.5; state.ink.size = 56;
      state.ink.spacing = 0.1; state.ink.brushId = 'ink-soft';
      inkSetTool('brush');
      const r = el.getBoundingClientRect();
      return JSON.stringify({
        mode,
        cx: Math.round(r.left + r.width / 2),
        cy: Math.round(r.top + r.height / 2),
        screenX: window.screen.availLeft || 0,
        screenW: window.screen.availWidth,
        itemW: it.w, itemH: it.h,
        canvasW: canvas.width, canvasH: canvas.height,
        layerKind: layer.kind, layerId: layer.id,
      });
    })()`));
    console.log('kurulum:', setup);

    // 1) Tek nokta eğimli vuruş — gerçek girdi hattı.
      const run = JSON.parse(await evaluate(ws, `(async () => {      const wait = ms => new Promise(r => setTimeout(r, ms));
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      selection.clear(); syncSelection(); fitAll(120);
      await new Promise(r => setTimeout(r, 300));
      // Düzenleyici modalı açıksa girdi ona gider: katmanı onun üzerinden al.
      const editorOpen = typeof inkEditorIsOpen === 'function' && inkEditorIsOpen();
      const layer = editorOpen && inkEditorUi.layerId
        ? inkLayerById(inkEditorUi.layerId)
        : inkEnsureAttachedLayer(it.id);
      inkState().activeLayerId = layer.id;
      const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
      const ctx = canvas.getContext('2d');
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      window.__inkPen([{ x: cx, y: cy, p: 1, tx: 60, ty: 0 }]);
      await wait(600);
      const tilted = window.__measureCanvas(canvas);
      const stroke = layer.strokes[layer.strokes.length - 1] || null;
      const hitAt = document.elementFromPoint(cx, cy);
      const hit = hitAt === el ? 'image' : (hitAt && (hitAt.id || hitAt.className || hitAt.tagName) || '?');
      const pw = document.getElementById('persistenceWelcome');
      const pwDiag = pw ? {
        hidden: !!pw.hidden, style: pw.style.display || '',
        rect: (() => { const rr = pw.getBoundingClientRect(); return [rr.left, rr.top, rr.width, rr.height].map(v => Math.round(v)); })(),
      } : null;

      // 2) Aynı vuruşu senkron yoldan (inkPaintStrokeSync) temiz tuvale çiz.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let syncErr = '';
      let syncM = { painted: 0 };
      if (stroke) {
        try {
          if (typeof inkClearTransientStrokes === 'function') { /* iz yok */ }
          inkPaintStrokeSync(layer, stroke);
          syncM = window.__measureCanvas(canvas);
        } catch (e) { syncErr = String(e && e.message || e); }
      }

      // 2b) Açık parametreli commit çağrısı: sizePx'ı hem hesapla hem sabit dene.
      let diag2 = '';
      let diag2M = { painted: 0 }, diag2bM = { painted: 0 };
      let diag2bM2 = { painted: 0 };
      let diagDbg = [];
      let diagTaplog = [];
      if (stroke) {
        try {
          const sizePxCalc = Math.max(0.5, stroke.size * canvas.width);
          const dbg = { dabs: [] };
          window.__inkForEachDabTapLog = [];
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          inkDrawStrokeOnContext(ctx, stroke, {
            mapPoint: pt => ({ x: pt.x * canvas.width, y: pt.y * canvas.height }),
            sizePx: sizePxCalc,
            pointScale: { x: canvas.width, y: canvas.height },
            __debug: dbg,
          });
          diagDbg = dbg.dabs;
          diagTaplog = window.__inkForEachDabTapLog;
          diag2M = window.__measureCanvas(canvas);
          const s2 = Object.assign({}, stroke, { size: 140 / canvas.width });
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          inkDrawStrokeOnContext(ctx, s2, {
            mapPoint: pt => ({ x: pt.x * canvas.width, y: pt.y * canvas.height }),
            sizePx: 140,
            pointScale: { x: canvas.width, y: canvas.height },
          });
          diag2bM = window.__measureCanvas(canvas);
          diag2 = JSON.stringify({
            canvasW: canvas.width, canvasH: canvas.height,
            strokeSize: stroke.size, sizePxCalc,
            stroke: JSON.parse(JSON.stringify(stroke, (k, v) =>
              k === 'points' ? undefined : v)),
            transform: (() => { const dt = ctx.getTransform();
              return [dt.a, dt.b, dt.c, dt.d, dt.e, dt.f].map(n => +n.toFixed(3)); })(),
          });
          /* diag3 · yarıçap zincirini açıkölç: k, dyn, minRadius, mesafe. */
          const br = inkGetBrush('ink-soft');
          const dynD = inkBrushDynamics(br);
          const spPx = Math.max(0.8, 140 * clamp(stroke.spacing || 0.1, 0.01, 2));
          const minR = Math.min(140 / 2, spPx * 0.62);
          const pt0 = stroke.points[0] || {};
          const dr = dynD.src === 'velocity' ? 1 - clamp(pt0.s || 0, 0, 1) :
            dynD.src === 'random' ? inkStrokeRandom(stroke, 0, 8) : clamp(pt0.p, 0.02, 1);
          const szJ = clamp(Number(dynD.sizeJitter) || 0, 0, 1);
          const szF = 1 - szJ / 2 + szJ * inkStrokeRandom(stroke, 0, 9);
          /* K16.d ara: aynı diziyi options'sız inkForEachDab'la manuel
             döndür — k'ler muafiyetten 1 olmalı; 0 gelirse dizi farklı. */
          let manualKs = [];
          try {
            inkForEachDab(stroke.points, spPx, (pt, _p, ix) => manualKs.push({ ix, k: pt.k }));
          } catch (e) { manualKs = ['ERR:' + e.message]; }
          diag3 = JSON.stringify({
            src: dynD.src, sizeMin: dynD.sizeMin, sizeMax: dynD.sizeMax, spread: dynD.sizeMax - dynD.sizeMin,
            speedSize: stroke.speedSize, driver: dr, sizeFactor: szF, k: pt0.k,
            spacingPx: spPx, minRadius: minR,
            radiusRaw: inkDabRadius(140, br, dr, clamp(pt0.s || 0, 0, 1), stroke.speedSize, minR),
            radiusFull: Math.max(0.35, inkDabRadius(140, br, dr, 0, stroke.speedSize, minR) *
              (Number.isFinite(pt0.k) ? clamp(pt0.k, 0, 1) : 1) * szF),
            roundness: br && Number.isFinite(br.roundness) ? br.roundness : 1,
            roundnessMin: clamp(Number(dynD.roundnessMin) || 0.05, 0.05, 1),
            pointCount: stroke.points.length,
            p0: JSON.parse(JSON.stringify(pt0)),
            p1: JSON.parse(JSON.stringify(stroke.points[1] || {})),
            manualKs,
          });
        } catch (e) { diag2 = 'diagErr:' + String(e && e.message || e); }
      }

      // 3) Damga bağımsızlık: direkt inkDrawTiltedStamp (ya da drawImage).
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let stampM = { painted: 0 }, stampErr = '';
      try {
        const brush = typeof inkBrushById === 'function' ? inkBrushById('ink-soft') : null;
        const stamp = (typeof inkStampFor === 'function')
          ? inkStampFor(brush, '#ff5577', 0.5, 56, false, false, 0) : null;
        const tip = stamp && stamp.canvas ? stamp.canvas : inkProceduralTip(0.5, 56);
        inkDrawTiltedStamp(ctx, tip, canvas.width / 2, canvas.height / 2, 28, 0.667, 0, 1, false, false);
        stampM = window.__measureCanvas(canvas);
      } catch (e) { stampErr = String(e && e.message || e); }

      // 4) inkForEachDab emisyon raporu (aynı noktalar).
      let emit = '';
      try {
        if (stroke) {
          const pts = stroke.points.slice();
          const spacingPx = Math.max(0.8, 56 * Math.max(0.01, Math.min(2, (stroke.spacing || 0.1))));
          const dabs = [];
          inkForEachDab(pts, spacingPx, (pt, pres, idx) => dabs.push({
            idx, x: +pt.x.toFixed(5), y: +pt.y.toFixed(5),
            p: +(pres || 0).toFixed(3), k: +(pt.k == null ? NaN : pt.k).toFixed(3),
            t: +(pt.t || 0).toFixed(3),
          }), { x: canvas.width, y: canvas.height }, {
            strokeId: stroke.id,
            spacingJitter: 0,
          });
          emit = JSON.stringify({ spacingPx, n: dabs.length, dabs });
        }
      } catch (e) { emit = 'emitErr:' + String(e && e.message || e); }

      return JSON.stringify({
        strokes: layer.strokes.length,
        hit,
        pwDiag,
        editorOpen, editorLayerId: editorOpen ? inkEditorUi.layerId : null,
        layerId: layer.id, canvasIsEditorCanvas: editorOpen &&
          document.getElementById('inkEditorCanvas') === null ? false : undefined,
        strokeRec: stroke ? {
          tool: stroke.tool, kind: stroke.kind || '', size: stroke.size,
          spacing: stroke.spacing, nPoint: stroke.points.length,
          p0: stroke.points[0], hardness: stroke.hardness,
          brushId: stroke.brushId,
        } : null,
        tilted, syncM, syncErr, diag2M, diag2, diag2bM, diag3, diagDbg, diagTaplog, stampM, stampErr, emit,
      });
    })()`));
    console.log('ham türü:', typeof run);
    console.log('ham:', require('util').inspect(run, { depth: 6 }).slice(0, 2000));
    const runStr = typeof run === 'string' ? run : JSON.stringify(run);
    console.log('sonuç:', JSON.stringify(JSON.parse(runStr), null, 1));

    ws.close();
  } finally {
    try { app.kill(); } catch { /* sessiz */ }
  }
})().catch(err => { console.error('PROBE HATASI:', err.message); process.exit(1); });
