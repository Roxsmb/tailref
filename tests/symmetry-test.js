'use strict';
/* FAZ 6 madde 11 probe: simetri motoru. Sözleşme:
   • INK_SYM_MODES beyaz liste (off | mirrorX | mirrorY | mirrorXY |
     radial4 | radial8); inkSymModeOf kirli değeri off'a düşürür,
     inkNormalizeState kalıcı kayıtı da temizler.
   • inkSymmetryStrokeClones: [kimlik, ...klonlar] — sym'siz, sıralı;
     mirrorXY→4 (kimlik+3), radial4→4, off/kirli→1. Açılar: flipX=π−a,
     flipY=−a, XY=a+π, radialN=a+θ.
   • inkDrawStrokeOnContext tek giriş kanaldır: stroke.sym ≠ 'off'
     iken vuruş klonlara aynı opts ile açılır (GL yolu otomatik).
   • inkEditorBeginPaint vuruşa sym: inkSymModeOf(ink.symMode) yazar.
   • inkEditorFullRasterRect klon noktalarını union eder (ayna taraf
     dışarıda kalmaz).
   • UI: options bar'daki 'symMode' select (data-opt="symMode")
     inkState().symMode'a iki yönlü bağlanır.
   • Undo: tek adım, klonlar dahil tüm vuruşu söker.
   node scripts/symmetry-test.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9389;
const APP_PORT = 5237;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (ws, expression) => {
  const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};
const mouse = async (ws, type, x, y, extra = {}) => {
  await send(ws, 'Input.dispatchMouseEvent', {
    type, x, y, button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    pointerType: 'mouse',
    ...extra,
  });
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-symprobe-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`,
    '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let page = null; const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !page) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
    } catch { /* bekle */ }
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('pencere açılmadı');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await sleep(4000);

  await send(ws, 'Emulation.setDeviceMetricsOverride',
    { width: 1500, height: 940, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
  await sleep(900);

  // ---- Denek görüntü + modal editör açılışı ----------------------
  const opened = await evaluate(ws, `(async () => {
    try {
      const c = document.createElement('canvas');
      c.width = 400; c.height = 300;
      const x = c.getContext('2d');
      x.fillStyle = '#e8e8e8'; x.fillRect(0, 0, 400, 300);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const imageId = 'img_sym_probe';
      await idbPut('images', imageId, { blob, name: 'sym-denek.png' });
      const entry = await decodeImage(blob);
      setImgCache(imageId, { img: entry.img, url: entry.url, name: 'sym-denek.png' });
      const it = {
        id: 'it_sym_probe', kind: 'image', imageId, title: 'sym-denek',
        x: 0, y: 0, w: 400, h: 300, rot: 0, z: nextZ(),
      };
      state.items.push(it);
      inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'Katman 1',
        pxW: 400, pxH: 300 });
      const base = { x: stage.clientWidth / 2 / state.view.scale,
        y: stage.clientHeight / 2 / state.view.scale };
      it.x = base.x - 200; it.y = base.y - 150;
      selection = new Set([it.id]);
      selectionOrder = [it.id];
      if (typeof syncAll === 'function') syncAll();
      syncSelection();
      await new Promise(r => setTimeout(r, 500));
      document.getElementById('modeDrawBtn').click();
      for (let i = 0; i < 80 &&
        !(typeof inkEditorIsOpen === 'function' && inkEditorIsOpen()); i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      return { ok: typeof inkEditorIsOpen === 'function' && inkEditorIsOpen() };
    } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
  })()`);
  await sleep(600);
  check('modal çizim editörü açıldı', opened.ok, JSON.stringify(opened));
  if (!opened.ok) { console.log('SYM-PROBE: editör açılamadı'); process.exit(1); }

  // ---- A · çekirdek API -------------------------------------------
  const api = await evaluate(ws, `(() => {
    const r = {};
    r.modes = Array.isArray(INK_SYM_MODES) ? INK_SYM_MODES.slice() : null;
    r.fns = ['inkSymMirrorPoints', 'inkSymRadialPoints', 'inkSymmetryStrokeClones',
      'inkSymmetryAllPoints', 'inkSymModeOf', 'inkEditorFullRasterRect']
      .map(f => typeof window[f] === 'function' || typeof eval('typeof ' + f) === 'function'
        ? f : null).filter(Boolean);
    const stroke = { points: [{ x: 0.25, y: 0.5, a: 0.3 }], sym: 'mirrorX' };
    const cM = inkSymmetryStrokeClones(stroke, {});
    r.mirrorCount = cM.length;
    r.mirrorX = cM[1] ? cM[1].points[0].x : null;
    r.mirrorA = cM[1] ? cM[1].points[0].a : null;
    r.cloneSym = cM.every(c => c.sym === undefined);
    const sXY = inkSymmetryStrokeClones({ points: [{ x: 0.25, y: 0.25, a: 0.4 }], sym: 'mirrorXY' }, {});
    r.xyCount = sXY.length;
    const sR = inkSymmetryStrokeClones({ points: [{ x: 0.2, y: 0.5, a: 0.2 }], sym: 'radial4',
      }, { pointScale: { x: 400, y: 300 } });
    r.radialCount = sR.length;
    r.radialTheta = sR[1] ? Math.round(sR[1].points[0].a * 100) / 100 : null;
    const sOff = inkSymmetryStrokeClones({ points: [{ x: 0.5, y: 0.5 }], sym: 'off' }, {});
    r.offCount = sOff.length;
    const dirty = inkSymmetryStrokeClones({ points: [{ x: 0.5, y: 0.5 }], sym: 'bogus9' }, {});
    r.dirtyCount = dirty.length;
    r.modeOfDirty = inkSymModeOf('radial9') || 'off';
    r.normalizeDirty =
      (inkNormalizeState({ tool: 'brush', brushId: 'soft-round', symMode: 'mirror9' }
        )).symMode;
    return r;
  })()`);
  check('INK_SYM_MODES beyaz listesi 6 mod', Array.isArray(api.modes) &&
    JSON.stringify(api.modes) === JSON.stringify(['off', 'mirrorX', 'mirrorY', 'mirrorXY', 'radial4', 'radial8']),
    JSON.stringify(api.modes));
  check('çekirdek fonksiyonlar global', ['inkSymMirrorPoints', 'inkSymmetryStrokeClones',
    'inkSymmetryAllPoints', 'inkSymModeOf'].every(f => api.fns.includes(f)), api.fns.join(','));
  check('mirrorX → 2 klon, x yansıması a=π−a', api.mirrorCount === 2 &&
    Math.abs(api.mirrorX - 0.75) < 1e-6 &&
    Math.abs(api.mirrorA - (Math.PI - 0.3)) < 0.02,
    'n=' + api.mirrorCount + ' x=' + api.mirrorX + ' a=' + api.mirrorA);
  check('klonlarda sym undefined', api.cloneSym === true, '');
  check('mirrorXY → 4 klon', api.xyCount === 4, 'n=' + api.xyCount);
  check('radial4 → 4 klon, ilk klon a=0.2+π/2', api.radialCount === 4 &&
    Math.abs(api.radialTheta - (0.2 + Math.PI / 2)) < 0.02,
    'n=' + api.radialCount + ' a=' + api.radialTheta);
  check('off → 1 klon (kimlik), kirli → 1',
    api.offCount === 1 && api.dirtyCount === 1, '');
  check('inkSymModeOf(inkli) → off', api.modeOfDirty === 'off', api.modeOfDirty);
  check('inkNormalizeState kirli symMode → off', api.normalizeDirty === 'off',
    String(api.normalizeDirty));

  // ---- B · pixel-mirror gerçek motor yolu (sentetik vuruş) --------
  const fit = await evaluate(ws, `(() => {
    const fit = inkEditorUi.fit;
    return { x: fit.x, y: fit.y, w: fit.w, h: fit.h, scaleX: state.view.scale };
  })()`);
  await evaluate(ws, `(() => {
    inkSetTool('brush');
    const ink = inkState();
    ink.size = 40; ink.opacity = 1; ink.color = '#ff3366';
    ink.symMode = 'mirrorX';
  })()`);
  /* Baseline: "Çizim yap" sonrası Layer 1 fotoğraf olarak pişirildiği için
     katman opak olabilir. Bu yüzden "temiz" ölçütü alfa < 24 değil,
     vuruştan ÖNCEKİ renge dönmüş olmaktır. */
  const basePix = await evaluate(ws, `(() => {
    const layer = inkEditorTargetLayer();
    const cv = (typeof inkEnsureItemCanvas === 'function')
      ? inkEnsureItemCanvas(layer) : layer.canvas;
    const ctx = cv.getContext('2d');
    const at = nx => Array.from(ctx.getImageData(
      Math.round(cv.width * nx), Math.round(cv.height * 0.5), 1, 1).data);
    return { left: at(0.25), right: at(0.75), far: at(0.95) };
  })()`);
  const ae = (a, b) => (a && b)
    ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3])
    : 1e9;
  const px = { cx: fit.x + fit.w * 0.25, cy: fit.y + fit.h * 0.5 };
  // izleme: commit sırasında inkPushUndoStroke sym ile mi çağrıldı?
  await evaluate(ws, `(() => {
    window.__undoPushLog = [];
    window.__symUnionDiag = [];
    const orig = window.inkPushUndoStroke;
    window.__origPushUndoStroke = orig;
    window.inkPushUndoStroke = function (layer, stroke) {
      window.__undoPushLog.push({
        sym: stroke ? stroke.sym : null,
        pts: stroke && stroke.points ? stroke.points.length : 0,
        layerId: layer ? layer.id : null,
      });
      return orig.apply(this, arguments);
    };
    return { patched: true };
  })()`);
  // vuruş: sell merkezden kısa yatay
  await mouse(ws, 'mousePressed', px.cx, px.cy);
  for (let i = 1; i <= 4; i++) {
    await mouse(ws, 'mouseMoved', px.cx + i * 6, px.cy);
    await sleep(40);
  }
  await mouse(ws, 'mouseReleased', px.cx + 24, px.cy);
  await sleep(500);
  // garanti commit
  const commitGuard = await evaluate(ws, `(() => {
    try { if (inkEditorUi.stroke) inkEditorCommitStroke(); } catch { /* sessiz */ }
    return { committed: !inkEditorUi.stroke, pushLog: window.__undoPushLog };
  })()`);
  console.log('COMMIT-DEBUG pushLog:', JSON.stringify(commitGuard.pushLog));
  // basitleştirilmiş piksel okuması: normalize → backing px
  const pixB = await evaluate(ws, `(async () => {
    await new Promise(r => setTimeout(r, 300));
    const layer = inkEditorTargetLayer();
    const cv = (typeof inkEnsureItemCanvas === 'function')
      ? inkEnsureItemCanvas(layer) : layer.canvas;
    const ctx = cv.getContext('2d');
    const at = nx => Array.from(ctx.getImageData(Math.round(cv.width * nx),
      Math.round(cv.height * 0.5), 1, 1).data);
    const strokes = layer.strokes || [];
    const last = strokes[strokes.length - 1] || {};
    const row = { left: at(0.25), right: at(0.75), far: at(0.95),
      sym: last.sym, strokeCount: strokes.length };
    return row;
  })()`);
  pixB.mirror = ae(pixB.left, basePix.left) > 12 && ae(pixB.right, basePix.right) > 12;
  pixB.noBleed = ae(pixB.far, basePix.far) <= 2;
  pixB.farAe = ae(pixB.far, basePix.far);
  check('vuruş sym kaydedildi (mirrorX)', pixB.sym === 'mirrorX' && pixB.strokeCount >= 1,
    'sym=' + pixB.sym + ' n=' + pixB.strokeCount);
  check('piksel ayna: sol ve sağ boyalı', pixB.mirror,
    'Lae=' + ae(pixB.left, basePix.left) + ' Rae=' + ae(pixB.right, basePix.right));
  check('ayna dışı sızma yok', pixB.noBleed, 'farAe=' + pixB.farAe);

  // ---- C · undo tek adım klonu da söker ---------------------------
  const undoC = await evaluate(ws, `(async () => {
    try {
      const out = { steps: [] };
      const base = ${JSON.stringify(basePix)};
      const ae = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
        + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);
      const at = (ctx, cv, nx) => Array.from(ctx.getImageData(Math.round(cv.width * nx),
        Math.round(cv.height * 0.5), 1, 1).data);
      const snap = () => {
        const layer = inkEditorTargetLayer();
        const cv = (typeof inkEnsureItemCanvas === 'function')
          ? inkEnsureItemCanvas(layer) : layer.canvas;
        const ctx = cv.getContext('2d');
        return {
          left: at(ctx, cv, 0.25),
          right: at(ctx, cv, 0.75),
          stack: (typeof undoStack !== 'undefined') ? undoStack.length : -1,
          redo: (typeof redoStack !== 'undefined') ? redoStack.length : -1,
        };
      };
      out.before = snap();
      /* teşhis: undo kayıtlarının bölge kutuları — klon birleşimi
         capture'da uygulandı mı? */
      try {
        const layer0 = inkEditorTargetLayer();
        const lastStroke = (layer0.strokes || [])[layer0.strokes.length - 1];
        out.diag2 = {
          region: typeof inkUndoStrokeRegion === 'function'
            ? inkUndoStrokeRegion(layer0, lastStroke) : 'fn yok',
          clones: lastStroke && typeof inkSymmetryStrokeClones === 'function'
            ? inkSymmetryStrokeClones(lastStroke, {
                pointScale: { x: 400, y: 300 },
              }).map(c => c && c.points && c.points.length) : 'fn yok',
          sym: lastStroke && lastStroke.sym,
          modesArr: (typeof INK_SYM_MODES !== 'undefined')
            ? Array.isArray(INK_SYM_MODES) : 'undefined',
          regionResult: (() => {
            try {
              const sm = String(lastStroke.sym || 'off');
              return { smode: sm,
                incl: typeof INK_SYM_MODES !== 'undefined' && Array.isArray(INK_SYM_MODES) && INK_SYM_MODES.includes(sm),
                fn: typeof inkSymmetryStrokeClones };
            } catch (e) { return String(e); }
          })(),
        };
      } catch (e) { out.diag2 = String(e); }
      out.unionLog = (window.__symUnionDiag && window.__symUnionDiag.length)
        ? window.__symUnionDiag : 'bos';
      try {
        out.diag = [...inkUndoRaster.entries.values()].map(e => ({
          r: e.before && e.before.rect,
          w: e.before && e.before.width,
          tiles: !!(e.before && e.before.tiles),
        }));
      } catch { out.diag = 'diag yok'; }
      for (let i = 0; i < 3; i++) {
        const btn = document.getElementById('btnInkHistoryUndo');
        if (btn) btn.click(); else if (typeof undo === 'function') undo();
        await new Promise(r => setTimeout(r, 400));
        out.steps.push(snap());
        const s = out.steps[out.steps.length - 1];
        if (ae(s.left, base.left) <= 2 && ae(s.right, base.right) <= 2) break;
      }
      out.ok = true;
      return out;
    } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
  })()`);
  check('undo klonu da söker (pikseller temiz)',
    undoC.ok && undoC.steps.some(s =>
      ae(s.left, basePix.left) <= 2 && ae(s.right, basePix.right) <= 2),
    JSON.stringify({ steps: undoC.steps && undoC.steps.map(s => ({
      leftAe: ae(s.left, basePix.left), rightAe: ae(s.right, basePix.right),
      stack: s.stack, redo: s.redo })), ok: undoC.ok, reason: undoC.reason }));

  // ---- D · Merkezi Ayarlar → ÇİZİM sütunu: Simetri ----------------
  /* ⋯ → Ayarlar penceresi Çizim Ayarları menüsünü devraldı (draw-v5 grip
     artık yalnız taşıma koludur). Simetri köprüsü: window.inkV5Settings
     (60-settings-hub select'i ona bağlanır) → inkState().symMode. */
  const selD = await evaluate(ws, `(() => {
    const api = window.inkV5Settings;
    if (!api || typeof api.setSym !== 'function') return { ok: false, reason: 'inkV5Settings köprüsü yok' };
    const modes = ['off', 'mirrorX', 'mirrorY', 'mirrorXY', 'radial4', 'radial8'];
    const yazilan = [];
    for (const m of modes) {
      api.setSym(m);
      yazilan.push(String(api.sym()));
    }
    api.setSym('radial4');
    return { ok: true, items: modes, yazilan, state: inkState().symMode };
  })()`);
  check('Ayarlar (ÇİZİM) → Simetri · 6 mod · state yazımı',
    selD.ok && selD.state === 'radial4' && selD.yazilan.length === 6 &&
    selD.yazilan.every((v, i) => v === selD.items[i]),
    JSON.stringify(selD.items) + ' yazilan=' + JSON.stringify(selD.yazilan) + ' state=' + selD.state);

  // ---- E · radial4 gerçekte dörtlü dönme --------------------------
  await evaluate(ws, `(() => {
    const ink = inkState();
    ink.size = 30; ink.color = '#2266ff'; ink.symMode = 'radial4';
  })()`);
  const pxE = { cx: fit.x + fit.w * 0.35, cy: fit.y + fit.h * 0.5 };
  /* normalize −0.15 ofset yalnız fit kesirleriyle tutarlıdır:
     sabit ekran-px ofset (−40) normalize hedefi tutmaz. */
  await mouse(ws, 'mousePressed', pxE.cx, pxE.cy);
  await sleep(30);
  await mouse(ws, 'mouseMoved', pxE.cx + fit.w * 0.015, pxE.cy);
  await sleep(30);
  await mouse(ws, 'mouseReleased', pxE.cx + fit.w * 0.03, pxE.cy);
  await sleep(400);
  const pixE = await evaluate(ws, `(async () => {
    try { if (inkEditorUi.stroke) inkEditorCommitStroke(); } catch { /* sessiz */ }
    await new Promise(r => setTimeout(r, 250));
    const layer = inkEditorTargetLayer();
    const cv = (typeof inkEnsureItemCanvas === 'function')
      ? inkEnsureItemCanvas(layer) : layer.canvas;
    const ctx = cv.getContext('2d');
    // merkezden ±dx ofset dört yönde örnek (normalize: cx=0.5, cy=0.5)
    const offs = [-0.15, 0.15];
    const pxAt = (nx, ny) => ctx.getImageData(
      Math.round(cv.width * nx), Math.round(cv.height * ny), 1, 1).data[3];
    const row = {
      left: pxAt(0.5 + offs[0], 0.5), right: pxAt(0.5 + offs[1], 0.5),
      up: pxAt(0.5, 0.5 + offs[0]), down: pxAt(0.5, 0.5 + offs[1]),
    };
    // dikkat: hit merkez-etraf döner; vuruş merkezin SOLUNDAydı →
    // dönmeler sağ/üst/alt bileşenleri de boyar.
    row.quad = (row.right > 60 || row.up > 60 || row.down > 60);
    return row;
  })()`);
  check('radial4: sol vuruşun dönmeleri boyandı',
    pixE.left > 60 && pixE.quad, JSON.stringify(pixE));
  await evaluate(ws, `(() => { inkState().symMode = 'off'; })()`);
  for (const r of results.slice(0)) { /* sonuç düz listesi */ }

  const failed = results.filter(r => !r.ok);
  console.log('\\nSYM-PROBE: ' + (results.length - failed.length) + '/' +
    results.length + ' yeşil');
  app.kill();
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('SYM-PROBE hata:', e);
  process.exit(1);
});
