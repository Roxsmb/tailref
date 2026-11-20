'use strict';
/* A11 probe: R tuval döndürme (PS Rotate View) sözleşmesini gerçek
   Electron penceresinde doğrular. Uygulama kanalıdır — plan 7b
   protokolü: yeşile yaslanmadan rot uygulaması genişletilmez.
   Sözleşme:
   • ui.view.rot: ui.view'un AYRI alanı (derece, saat yönü pozitif;
     zoom/pan'den bağımsız). Sıfırlama (Reset View) yalnız açıyı
     temizler, zoom/pan'e dokunmaz.
   • Görüntü dönüşümü yalnızca CSS transform (canvas element, merkez
     origin) — v2: RENDER rotasyonu (bitmap dik); CSS transform yal sürükleme hız yolu.
   • ui.rect rot altında LAYOUT dikdörtgeni kalmalıdır (transform
     ezikliği AABB yapmamalı) — offsetLeft tabanlı ölçüm.
   • Ekran→tuval yerel kapıları (inkEditorLocal/Sample/SyncCoords)
     rotu tersine çevirir: aynı tuval noktası, rot 15° ve 90° altında
     da aynı yerel koordinata iner (±0.5px).
   • R alt tuş: basılıyken merkez-etraf-yancı sürükleme döndürür;
     bırakınca araca döner; single tık (dokunuş) 0°'ye sıfırlar ve
     vuruş üretmez. Rot araca değildir — pushUndo / yeni vuruş yok.
   • Options bar: "Görünüm <açı°>" bilgi + "Görünümü sıfırla" düğmesi
     — ≠0° iken görünür, 0° iken gizli.
   node scripts/ink-rotate-probe.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9392;
const APP_PORT = 5231;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rad = deg => deg * Math.PI / 180;
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
// CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8.
const SHIFT = { modifiers: 8 };
const pressKey = (ws, key, code, vk, type = 'keyDown') =>
  send(ws, 'Input.dispatchKeyEvent', {
    type, key, code,
    windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    ...(type === 'keyDown' && key.length === 1 ? { text: key } : {}),
  });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-rotprobe-'));
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

  // ---- Denek görüntü + modal editör açılışı (ink-smoke yolu) -----
  const opened = await evaluate(ws, `(async () => {
    try {
      const c = document.createElement('canvas');
      c.width = 300; c.height = 300;
      const x = c.getContext('2d');
      x.fillStyle = '#cccccc'; x.fillRect(0, 0, 300, 300);
      x.fillStyle = '#222222'; x.fillRect(140, 140, 20, 20);
      // ink-smoke "panel-export" kalıbı: idbPut → decodeImage → setImgCache
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const imageId = 'img_rot_probe';
      await idbPut('images', imageId, { blob, name: 'rot-denek.png' });
      const entry = await decodeImage(blob);
      setImgCache(imageId, { img: entry.img, url: entry.url, name: 'rot-denek.png' });
      const it = {
        id: 'it_rot_probe', kind: 'image', imageId, title: 'rot-denek',
        x: 0, y: 0, w: 300, h: 300, rot: 0, z: nextZ(),
      };
      state.items.push(it);
      inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'Katman 1',
        pxW: 300, pxH: 300 });
      // Varken görüntüyü ortala (layoutAdded tek-öğe dalı manuel).
      const base = { x: stage.clientWidth / 2 / state.view.scale,
        y: stage.clientHeight / 2 / state.view.scale };
      it.x = base.x - 150; it.y = base.y - 150;
      selection = new Set([it.id]);
      selectionOrder = [it.id];
      // Tahta DOM öğesini (elMap + .media img) üret — editör render'ı bunu
      // bekler: inkEditorRender önce elMap.get(itemId) kontrol eder.
      if (typeof syncAll === 'function') syncAll();
      syncSelection();
      await new Promise(r => setTimeout(r, 500));
      const drawBtn = document.getElementById('modeDrawBtn');
      if (!drawBtn) return { ok: false, reason: 'modeDrawBtn yok' };
      drawBtn.click();
      for (let i = 0; i < 80 &&
        !(typeof inkEditorIsOpen === 'function' && inkEditorIsOpen()); i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      return { ok: typeof inkEditorIsOpen === 'function' && inkEditorIsOpen(),
        itemId: it.id };
    } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
  })()`);
  await sleep(600);
  check('modal çizim editörü açıldı', opened.ok, JSON.stringify(opened));
  if (!opened.ok) { console.log('ROT-PROBE: editör açılamadı'); process.exit(1); }

  // ---- Sayfa-içi ölçüm yardımcıları -------------------------------
  await evaluate(ws, `(() => {
    window.__rotTrace = [];
    window.addEventListener('pointerdown', e =>
      window.__rotTrace.push({ t: 'down', x: e.clientX, y: e.clientY }), true);
    window.addEventListener('pointerup', e =>
      window.__rotTrace.push({ t: 'up', x: e.clientX, y: e.clientY }), true);
    window.addEventListener('pointermove', e =>
      window.__rotTrace.push({ t: 'move', x: e.clientX, y: e.clientY,
        rot: Number.isFinite(inkEditorUi.view.rot) ? Math.round(inkEditorUi.view.rot) : null }), true);
    try {
      window.__bp = [];
      if (typeof inkEditorBeginPaint === 'function') {
        const orig = window.inkEditorBeginPaint;
        window.inkEditorBeginPaint = function (ev, local, pending) {
          const r = orig.call(this, ev, local, pending);
          window.__bp.push({
            r: !!r,
            tool: inkState().tool,
            size: inkState().size,
            local: local ? { x: +local.x.toFixed(3), y: +local.y.toFixed(3) } : null,
            layerId: inkEditorUi.layerId,
          });
          if (!r) window.__rotTrace.push({ t: 'bpReject' });
          return r;
        };
      }
    } catch { /* sessiz */ }
    window.__rotProbe = {
      geo() {
        const ui = inkEditorUi;
        const rect = ui.rect || ui.canvas.getBoundingClientRect();
        const fit = ui.fit || inkEditorComputeFit();
        return {
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          fit: { x: fit.x, y: fit.y, w: fit.w, h: fit.h },
          dpr: ui.dpr,
          rot: ui.view && Number.isFinite(ui.view.rot) ? ui.view.rot : null,
          canvasTransform: getComputedStyle(ui.canvas).transform,
        };
      },
      // Yerel (fr) hedefin tuval üstünde beklenen MEDIATEK noktası:
      // rot dönerken fr aynı tuval-yerel noktayı taşımalı.
      screenPointOf(fx, fy, rotDeg, g) {
        // g.rect LAYOUT rect. Tuval-px noktası:
        const px = g.rect.left + fx, py = g.rect.top + fy;
        /* A11 v3: pivot KÂĞIT MERKEZİ — render pivotuyla (fit merkez)
           birebir aynı. Eski pencere/rect merkezi kâğıdı sapıttığı için
           değiştirildi (kullanıcı raporu: "kâğıt ekranda geziyor"). */
        const cx = g.fit.x + g.fit.w / 2;
        const cy = g.fit.y + g.fit.h / 2;
        const dx = px - cx, dy = py - cy;
        return {
          x: cx + dx * Math.cos(rotDeg * Math.PI / 180) - dy * Math.sin(rotDeg * Math.PI / 180),
          y: cy + dx * Math.sin(rotDeg * Math.PI / 180) + dy * Math.cos(rotDeg * Math.PI / 180),
        };
      },
      /* Bitmap taraması: kind='red' → commit olmuş vuruş pigmanı
         (glued-pan kanıtı), 'dark' → denekteki #222 karo (off-center
         zoom-anchor kanıtı). Koordinat dönüşü: bitmap CSS px. */
      scanPx(kind) {
        const ui = inkEditorUi;
        if (!ui.ctx) return null;
        const W = ui.canvas.width, H = ui.canvas.height, dr = ui.dpr || 1;
        const d = ui.ctx.getImageData(0, 0, W, H).data;
        let n = 0, sx = 0, sy = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const hit = kind === 'red'
            ? (d[i + 3] > 200 && d[i] > 150 && d[i + 1] < 80 && d[i + 2] < 80)
            : (d[i + 3] > 200 && d[i] < 70 && d[i + 1] < 70 && d[i + 2] < 70);
          if (hit) { n++; sx += x; sy += y; }
        }
        return n ? { n, cx: sx / n / dr, cy: sy / n / dr } : null;
      },
      localAt(clientX, clientY) {
        const p = inkEditorLocal({ clientX, clientY, pointerId: 1, pointerType: 'mouse' });
        return p;
      },
      setRot(deg) {
        inkEditorRotate(deg);
        return {
          rot: inkEditorUi.view.rot,
          zoom: inkEditorUi.view.zoom,
          panX: inkEditorUi.view.panX,
          panY: inkEditorUi.view.panY,
        };
      },
      resetRot() {
        inkEditorResetRot();
        return { rot: inkEditorUi.view.rot, zoom: inkEditorUi.view.zoom,
          panX: inkEditorUi.view.panX, panY: inkEditorUi.view.panY };
      },
      sizeAndStrokes() {
        const ink = inkState();
        const layer = inkLayerById(inkEditorUi.layerId)
          || (ink.layers ? ink.layers[ink.layers.length - 1] : null);
        const strokes = layer && layer.strokes ? layer.strokes.length : -1;
        return { size: ink.size, strokes,
          color: ink.color, tool: ink.tool };
      },
    };
    // Denek fr noktaları (fit-fraksiyonu; analizleri Node'da kurarız)
    return true;
  })()`);

  const geo0 = await evaluate(ws, `window.__rotProbe.geo()`);
  check('ui.view.rot alanı var ve başlangıç 0', geo0.rot === 0,
    `rot=${geo0.rot}`);
  check("rot=0'da canvas transform nötr",
    geo0.canvasTransform === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(geo0.canvasTransform),
    geo0.canvasTransform.slice(0, 40));

  // fr→yerel kapı çevirisi: fr | fit fraksiyonu
  const frExpect = (g, fx, fy) => ({
    x: (fx - g.fit.x) / g.fit.w,
    y: (fy - g.fit.y) / g.fit.h,
  });
  const roundLocal = async (g, fr, deg, tol = 0.5) => {
    const s = await evaluate(ws,
      `window.__rotProbe.screenPointOf(${g.fit.x + fr.x * g.fit.w}, ` +
      `${g.fit.y + fr.y * g.fit.h}, ${deg}, window.__rotProbe.geo())`);
    const p = await evaluate(ws, `window.__rotProbe.localAt(${s.x}, ${s.y})`);
    const exp = frExpect(g, g.fit.x + fr.x * g.fit.w, g.fit.y + fr.y * g.fit.h);
    const errX = p ? Math.abs(p.x - exp.x) * g.fit.w : Infinity;
    const errY = p ? Math.abs(p.y - exp.y) * g.fit.h : Infinity;
    return { errX, errY, exp, p: p, s };
  };

  // ---- rot=0 kapı değişmezliği (baseline) -------------------------
  const base = await roundLocal(geo0, { x: 0.3, y: 0.4 }, 0);
  check('rot=0 kapı' + 'değişmezliği',
    base.errX <= 0.5 && base.errY <= 0.5,
    `err=${base.errX.toFixed(2)},${base.errY.toFixed(2)} px`);

  // ---- rot=15: rot alanı + LAYOUT rect stabil + kapı gidiş-dönüş --
  const st15 = await evaluate(ws, `window.__rotProbe.setRot(15)`);
  const geo15 = await evaluate(ws, `window.__rotProbe.geo()`);
  check('inkEditorRotate(15) .rot yazıyor, zoom/pan dokunulmaz',
    Math.abs(st15.rot - 15) < 0.01 &&
    Math.abs(st15.zoom - 1) < 0.001 && st15.panX === 0 && st15.panY === 0,
    JSON.stringify(st15));
  const rotStyle = await evaluate(ws, `(() => ({
    cssTf: inkEditorUi.canvas.style.transform,
    rotated: document.getElementById('inkEditor').classList.contains('ink-rotated'),
  }))()`);
  const frameHiddenNow = await evaluate(ws,
    `document.getElementById('inkCanvasFrame').hidden`);
  check("rot≠0'da canvas CSS transform boş (render rotasyonu devrede) + desk sınıfı",
    (rotStyle.cssTf === '' || rotStyle.cssTf === 'none') && rotStyle.rotated &&
    frameHiddenNow === true,
    JSON.stringify({ ...rotStyle, frameHiddenNow }));
  // Piksel kanıtı: kağıt köşe ekran noktası rot=0'da opak; rot=15'te
  // içerik o noktadan döner (bitmap dik kalır, kağıt kenarı itilir).
  const sampleAlpha = async () => evaluate(ws, `(() => {
    const cv = document.getElementById('inkEditorCanvas');
    const g = window.__rotProbe.geo();
    const s = { x: g.fit.x + 0.05 * g.fit.w, y: g.fit.y + 0.05 * g.fit.h };
    const pr = (g.dpr || 1);
    const d = cv.getContext('2d').getImageData(
      Math.round(s.x * pr), Math.round(s.y * pr), 1, 1).data;
    return { a: d[3], s: { x: Math.round(s.x), y: Math.round(s.y) } };
  })()`);
  await evaluate(ws, `window.__rotProbe.setRot(0)`);
  await sleep(320);
  const px0 = await sampleAlpha();
  await evaluate(ws, `window.__rotProbe.setRot(15)`);
  await sleep(350);
  const px15 = await sampleAlpha();
  check('rot=0→15 kağıt köşesindeki içerik döner (opak→saydam)',
    px0.a > 200 && px15.a < 30,
    `rot0 a=${px0.a} · rot15 a=${px15.a} @(${px0.s.x},${px0.s.y})`);
  check('ui.rect rot-altında LAYOUT kalır (AABB büyümez)',
    Math.abs(geo15.rect.width - geo0.rect.width) < 1 &&
    Math.abs(geo15.rect.height - geo0.rect.height) < 1 &&
    Math.abs(geo15.rect.left - geo0.rect.left) < 1,
    `${geo0.rect.width.toFixed(1)}→${geo15.rect.width.toFixed(1)}`);
  const g15a = await roundLocal(geo15, { x: 0.25, y: 0.3 }, 15);
  const g15b = await roundLocal(geo15, { x: 0.8, y: 0.6 }, 15);
  check('rot=15 kapı gidiş-dönüş ±0.5px',
    g15a.errX <= 0.5 && g15a.errY <= 0.5 &&
    g15b.errX <= 0.5 && g15b.errY <= 0.5,
    `a=${g15a.errX.toFixed(2)},${g15a.errY.toFixed(2)} ` +
    `b=${g15b.errX.toFixed(2)},${g15b.errY.toFixed(2)}`);

  // ---- rot=90 ve rot=-45 uçları -----------------------------------
  const st90 = await evaluate(ws, `window.__rotProbe.setRot(90)`);
  const geo90 = await evaluate(ws, `window.__rotProbe.geo()`);
  check('inkEditorRotate(90).rot = 90', Math.abs(st90.rot - 90) < 0.01,
    `rot=${st90.rot}`);
  const g90 = await roundLocal(geo90, { x: 0.75, y: 0.3 }, 90);
  check('rot=90 uç kapı gidiş-dönüş ±0.5px',
    g90.errX <= 0.5 && g90.errY <= 0.5,
    `err=${g90.errX.toFixed(2)},${g90.errY.toFixed(2)}`);
  await evaluate(ws, `window.__rotProbe.setRot(-45)`);
  const geoM = await evaluate(ws, `window.__rotProbe.geo()`);
  const gM = await roundLocal(geoM, { x: 0.6, y: 0.5 }, -45);
  check('rot=-45 kapı gidiş-dönüş ±0.5px',
    gM.errX <= 0.5 && gM.errY <= 0.5,
    `err=${gM.errX.toFixed(2)},${gM.errY.toFixed(2)}`);

  // ---- Çizim zinciri rot-altında: dab hedefe iner ------------------
  await evaluate(ws, `(() => { window.__rotProbe.setRot(30); })()`);
  const geoPaint = await evaluate(ws, `window.__rotProbe.geo()`);
  const frPaint = { x: 0.35, y: 0.35 };
  const paintS = await evaluate(ws,
    `window.__rotProbe.screenPointOf(${geoPaint.fit.x + frPaint.x * geoPaint.fit.w}, ` +
    `${geoPaint.fit.y + frPaint.y * geoPaint.fit.h}, 30, window.__rotProbe.geo())`);
  // CDP flake önlemi: hedefe bir önce pointermove + kısa oturma.
  const beforePaint = await evaluate(ws, `window.__rotProbe.sizeAndStrokes()`);
  await evaluate(ws, `(() => { inkState().color = '#ff0000'; })()`);
  await mouse(ws, 'mouseMoved', paintS.x, paintS.y);
  await sleep(150);
  await mouse(ws, 'mousePressed', paintS.x, paintS.y);
  await sleep(250);
  const strokeLive = await evaluate(ws, `(() => ({
    stroke: !!(inkEditorUi.stroke || inkEditorUi.pendingStroke),
    layerId: inkEditorUi.layerId,
    active: inkState().activeLayerId,
    tool: inkState().tool,
    locked: !!(inkEditorUi.layerId && inkLayerById(inkEditorUi.layerId) &&
      inkLayerById(inkEditorUi.layerId).locked),
    downs: (window.__rotTrace || []).filter(t => t.t === 'down').length,
    bp: (window.__bp || []).slice(-3),
  }))()`);
  await mouse(ws, 'mouseReleased', paintS.x, paintS.y);
  await sleep(600);
  // Committed dab'ın tuval pikseli: gate ters dönme ile aynı nokta.
  // setRot(0) rAF ile render'ı commit'ler; bitmap okuması ÖNCE bekler,
  // yoksa eldeki kare hâlâ rot=30'dur ve örneklem gri kağıda düşer.
  await evaluate(ws, `window.__rotProbe.setRot(0)`);
  await sleep(380);
  const geoAfter = await evaluate(ws, `window.__rotProbe.geo()`);
  const readback = await evaluate(ws, `(function readback() {
    const g = window.__rotProbe.geo();
    const ui = inkEditorUi;
    const px = Math.round((${geoAfter.rect.left} + (${geoAfter.fit.x} + ${frPaint.x * geoAfter.fit.w})) * g.dpr);
    const py = Math.round((${geoAfter.rect.top} + (${geoAfter.fit.y} + ${frPaint.y * geoAfter.fit.h})) * g.dpr);
    const d = ui.ctx.getImageData(px, py, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  })()`);
  const afterPaint = await evaluate(ws, `window.__rotProbe.sizeAndStrokes()`);
  const dabOk = readback.a > 40 && readback.r > 140 && readback.g < 70 && readback.b < 70;
  const noNewStroke = afterPaint.strokes === beforePaint.strokes || dabOk;
  check('rot=30 altında vuruş hedef piksele iner', dabOk,
    `rgb=${readback.r},${readback.g},${readback.b},${readback.a} ` +
    `strokes=${beforePaint.strokes}→${afterPaint.strokes} live=${JSON.stringify(strokeLive)}`);

  // ---- R geçici mod: yay sürükleme + tek tık sıfırlama -------------
  await evaluate(ws, `window.__rotProbe.setRot(0)`);
  const gR = await evaluate(ws, `window.__rotProbe.geo()`);
  /* A11 v3: ark da KÂĞIT MERKEZİ etrafında çizilir — uygulama açıyı
     fit merkezinden ölçer (pivot = render pivots). Eski rect merkezli
     ark artık farklı açı ölçüyordu. */
  const cR = { x: gR.fit.x + gR.fit.w / 2, y: gR.fit.y + gR.fit.h / 2 };
  // Ark: basılı nokta merkez-sol (-120,0); +30° döndürülmüş noktaya
  // sürükle. CSS rotate (+) saat yönü (y aşağı): üstten-sol nokta
  // yukarı doğru hareket eder → a1 dy NEGATİF.
  const arm = 120;
  const a0 = { x: cR.x - arm, y: cR.y };
  const arc = (t) => ({
    x: cR.x - arm * Math.cos(rad(30 * t)),
    y: cR.y - arm * Math.sin(rad(30 * t)),
  });
  const a1 = arc(1);
  await pressKey(ws, 'r', 'KeyR', 82);
  await mouse(ws, 'mousePressed', a0.x, a0.y);
  for (let i = 1; i <= 8; i++) {
    const p = arc(i / 8);
    await mouse(ws, 'mouseMoved', p.x, p.y);
    await sleep(35);
  }
  const rotDrag = await evaluate(ws,
    `Number.isFinite(inkEditorUi.view.rot) ? inkEditorUi.view.rot : null`);
  await mouse(ws, 'mouseReleased', a1.x, a1.y);
  const fruitAfterDragUp = await evaluate(ws,
    `Number.isFinite(inkEditorUi.view.rot) ? inkEditorUi.view.rot : null`);
  await sleep(120);
  const strokesAfterDrag = await evaluate(ws, `window.__rotProbe.sizeAndStrokes()`);
  check('R+sürükleme +30° arc → rot ≈ +30° (±2°)',
    rotDrag !== null && Math.abs(rotDrag - 30) <= 2,
    `rot=${rotDrag}`,
  );
  check('sürükleme bırakınca rot kalıcı + araca döner (rot bozulmaz)',
    Math.abs(fruitAfterDragUp - rotDrag) < 0.01, `rot=${fruitAfterDragUp}`);
  // Kullanıcı akışı: R BASILI KEN ikinci tut-çevir-bırak — açı birikmeli,
  // sıfırlamamalı/dışarı savurmamalı (rapor: "tut bırak tut bırak
  // yapınca aşırı bozuluyor").
  await sleep(80);
  await mouse(ws, 'mousePressed', a0.x, a0.y);
  for (let i = 1; i <= 8; i++) {
    const p2 = arc(i / 8);
    await mouse(ws, 'mouseMoved', p2.x, p2.y);
    await sleep(35);
  }
  const b1 = arc(1);
  await mouse(ws, 'mouseReleased', b1.x, b1.y);
  await sleep(150);
  const rotCycle2 = await evaluate(ws,
    `Number.isFinite(inkEditorUi.view.rot) ? inkEditorUi.view.rot : null`);
  check('R basılıyken 2. tut-çevir-bırak çevrimi açıyı +30° birikimli ekler',
    rotCycle2 !== null && Math.abs(rotCycle2 - 60) <= 3, `rot=${rotCycle2}`);
  await pressKey(ws, 'r', 'KeyR', 82, 'keyUp');
  await sleep(120);
  check('R modu vuruş üretmez (stroke sayısı sabit)',
    strokesAfterDrag.strokes === afterPaint.strokes,
    `strokes=${strokesAfterDrag.strokes}`);

  // ---- Tek tık sıfırlama: 25° kur, R basılıyken tek tık → 0. -------
  // Görsel kanıt: döndürme anı ve sıfırlama sonrası köşe bölgesi.
  const shot = async name => {
    const data = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name),
      Buffer.from(data.data, 'base64'));
  };
  await evaluate(ws, `window.__rotProbe.setRot(20)`);
  await sleep(250);
  await shot('_shot-rot-20.png');
  check('rot=20 ekran görüntüsü alındı (köşe görsel denetimi)', true,
    'scripts/_shot-rot-20.png');
  await pressKey(ws, 'r', 'KeyR', 82);
  await mouse(ws, 'mousePressed', cR.x, cR.y);
  await sleep(50);
  await mouse(ws, 'mouseReleased', cR.x, cR.y);
  await pressKey(ws, 'r', 'KeyR', 82, 'keyUp');
  await sleep(120);
  const rotAfterTap = await evaluate(ws, `inkEditorUi.view.rot`);
  check('R modunda tek tık → 0° sıfırlama', Math.abs(rotAfterTap) < 0.01,
    `rot=${rotAfterTap}`);
  await sleep(250);
  await shot('_shot-rot-reset.png');
  check('sıfırlama-sonrası ekran görüntüsü alındı (iz denetimi)', true,
    'scripts/_shot-rot-reset.png');

  // ---- Zoom anchor + pan rot-altında -------------------------------
  await evaluate(ws, `window.__rotProbe.setRot(30)`);
  const geoZ = await evaluate(ws, `window.__rotProbe.geo()`);
  const frZ = { x: 0.5, y: 0.5 };
  const szBefore = await roundLocal(geoZ, frZ, 30);
  const szS = await evaluate(ws,
    `window.__rotProbe.screenPointOf(${geoZ.fit.x + frZ.x * geoZ.fit.w}, ` +
    `${geoZ.fit.y + frZ.y * geoZ.fit.h}, 30, window.__rotProbe.geo())`);
  await evaluate(ws, `inkEditorZoomBy(1.25, { x: ${szS.x}, y: ${szS.y} })`);
  await sleep(300);
  const geoZ2 = await evaluate(ws, `window.__rotProbe.geo()`);
  const szAfter = await roundLocal(geoZ2, frZ, 30);
  check('rot=30 Alt+tekerlek zoom anchor stabil',
    szAfter.errX <= 0.5 && szAfter.errY <= 0.5,
    `err=${szAfter.errX.toFixed(2)},${szAfter.errY.toFixed(2)}`);

  // ---- Off-center zoom anchor: merkezde duran #222 karo fit-pan ile
  // (200, 80) çıkarılır; imleç karonun EKRAN noktasına kilitlenip 1.5×
  // zoom — karo aynı ekran noktasında kalmalı (yoksa kullanıcı raporu:
  // "yaklaşınca kanvas dikdörtgen oluyor, yanlardan kesiyor").
  await evaluate(ws, `(() => {
    inkEditorUi.view.panX += 200; inkEditorUi.view.panY += 80;
    inkEditorInvalidate();
  })()`);
  await sleep(350);
  const sqA = await evaluate(ws, `window.__rotProbe.scanPx('dark')`);
  // Bitmap = dönmüş render'in kendisi: karonun EKRAN noktası doğrudan
  // tarama koordinatıdır (ekstra R(+θ) projeksiyonu çift-döndürme olur).
  const sqA_S = { x: sqA.cx, y: sqA.cy };
  await evaluate(ws, `inkEditorZoomBy(1.5, { x: ${sqA_S.x}, y: ${sqA_S.y} })`);
  await sleep(400);
  const sqB = await evaluate(ws, `window.__rotProbe.scanPx('dark')`);
  const sqB_S = { x: sqB.cx, y: sqB.cy };
  check('rot=30 off-center zoom anchor: karo İMLEÇ ALTINDA kalır (savurma yok)',
    !!sqA && !!sqB &&
    Math.abs(sqB_S.x - sqA_S.x) <= 3 && Math.abs(sqB_S.y - sqA_S.y) <= 3,
    `Δ=(${(sqB_S.x - sqA_S.x).toFixed(1)},${(sqB_S.y - sqA_S.y).toFixed(1)}) ` +
    `karo n=${sqA ? sqA.n : 0}→${sqB ? sqB.n : 0}`);

  // Space + pan: sürükleme EKRANDA düz hareket eder (rot filtrelidir).
  // fit yanıtı R(−30) gömülür; ekran izdüşümü tam (40, 25) dönmekzor.
  await pressKey(ws, ' ', 'Space', 32);
  const geoP0 = await evaluate(ws, `window.__rotProbe.geo()`);
  const dabA = await evaluate(ws, `window.__rotProbe.scanPx('red')`);
  await mouse(ws, 'mousePressed', cR.x, cR.y);
  await mouse(ws, 'mouseMoved', cR.x + 40, cR.y + 25);
  await sleep(80);
  await mouse(ws, 'mouseReleased', cR.x + 40, cR.y + 25);
  await pressKey(ws, ' ', 'Space', 32, 'keyUp');
  await sleep(400);
  const geoP = await evaluate(ws, `(() => {
    const g = window.__rotProbe.geo();
    const dx = g.fit.x - ${geoP0.fit.x}, dy = g.fit.y - ${geoP0.fit.y};
    /* A11 v3: pivot=fit merkez → fit deltası EKRAN deltasıdır birebir
       (eski R(+θ) projeksiyonu pencere-merkez pivotuna aitti). */
    return { dF: { x: dx, y: dy }, onScreen: { x: dx, y: dy } };
  })()`);
  check('rot=30 Space+pan sürükleme EKRANDA düz hareket eder (40,25)',
    Math.abs(geoP.dF.x - 40) <= 2 && Math.abs(geoP.dF.y - 25) <= 2,
    `dF=(${geoP.dF.x.toFixed(1)},${geoP.dF.y.toFixed(1)}) ` +
    `onScreen=(${geoP.onScreen.x.toFixed(1)},${geoP.onScreen.y.toFixed(1)})`);
  // Glued-pan: COMMIT EDİLMİŞ vuruş (kırmızı dab) da tam aynı ekran
  // vektörüyle taşınır — kullanıcı raporu "tuval yok oluyor ama çizim
  // duruyor" kanıt kanalı (taban-katman ayrışması imkânsız olmalı).
  const dabB = await evaluate(ws, `window.__rotProbe.scanPx('red')`);
  check('rot=30 pan: commit çizim kâğıtla BİRLİKTE taşınır (aynı vektör)',
    !!dabA && !!dabB &&
    Math.abs((dabB.cx - dabA.cx) - 40) <= 3 &&
    Math.abs((dabB.cy - dabA.cy) - 25) <= 3,
    `dab Δ=(${(dabB && dabA ? dabB.cx - dabA.cx : NaN).toFixed(1)},` +
    `${(dabB && dabA ? dabB.cy - dabA.cy : NaN).toFixed(1)})`);

  // A11: masa fonu rot'ta DEĞİŞMEZ (kullanıcı: "arkaplan siyah, bir anda
  // gri oluyordu") — .ink-rotated arka plan override'ı kaldırıldı.
  const bgRot = await evaluate(ws,
    `getComputedStyle(document.getElementById('inkEditor')).backgroundColor`);
  await evaluate(ws, `window.__rotProbe.setRot(0)`);
  await sleep(300);
  const bgZero = await evaluate(ws,
    `getComputedStyle(document.getElementById('inkEditor')).backgroundColor`);
  await evaluate(ws, `window.__rotProbe.setRot(30)`);
  await sleep(300);
  check("masa fonu rot ≠ 0'da birebir aynı kalır (gri flaş yok)",
    bgRot === bgZero, `rot0=${bgZero} · rot30=${bgRot}`);

  // ---- Options bar widget: açı oku + sıfırla ------------------------
  await evaluate(ws, `window.__rotProbe.setRot(30)`);
  await evaluate(ws, `(() => { if (window.__v5OptSync) window.__v5OptSync(); })()`);
  const wdg = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const info = bar && bar.querySelector('.v5-opt-view-deg');
    const btn = bar && bar.querySelector('.v5-opt-view-reset');
    const rotBtns = bar ? bar.querySelectorAll('.v5-opt-view-rot') : null;
    return {
      infoTxt: info ? info.textContent.trim() : null,
      infoOn: info ? !info.hidden : false,
      /* NOT: ⟲ düğmesi layout rezervasyonu için hidden DEĞİL
         style.visibility ile söner (draw-v5 FAZ 6 A11 yorumu);
         test bu yüzden computed style okur. */
      btnOn: btn ? getComputedStyle(btn).visibility !== 'hidden' : false,
      rotGone: !rotBtns || rotBtns.length === 0,
    };
  })()`);
  check('options bar derece çipi "30°" + sıfırla "⟲" yanar, ±90 düğmeleri yok',
    wdg.infoOn && /^-?30°$/.test(wdg.infoTxt || '') && wdg.btnOn && wdg.rotGone,
    JSON.stringify(wdg));
  check("rot ≠ 0'da root desk sınıfı yanar (karanlık grid değil)",
    await evaluate(ws,
      `document.getElementById('inkEditor').classList.contains('ink-rotated')`));
  // Reset: yalnız açı — zoom/pan değeri taze öncesiyle birebir korunur.
  const preRot = await evaluate(ws, `(() => ({
    rot: inkEditorUi.view.rot, zoom: inkEditorUi.view.zoom,
    panX: inkEditorUi.view.panX, panY: inkEditorUi.view.panY }))()`);
  const resetClick = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const btn = bar.querySelector('.v5-opt-view-reset');
    if (btn) btn.click();
    if (window.__v5OptSync) window.__v5OptSync();
    return { rot: inkEditorUi.view.rot,
      zoom: inkEditorUi.view.zoom,
      panX: inkEditorUi.view.panX,
      panY: inkEditorUi.view.panY,
      btnOn: getComputedStyle(bar.querySelector('.v5-opt-view-reset'))
        .visibility !== 'hidden' };
  })()`);
  check('"Görünümü sıfırla" → rot 0, zoom/pan birebir korunur, düğme söner',
    Math.abs(resetClick.rot) < 0.01 &&
    resetClick.zoom === preRot.zoom && resetClick.panX === preRot.panX &&
    resetClick.panY === preRot.panY && resetClick.btnOn === false,
    `pre=${JSON.stringify(preRot)} post=${JSON.stringify(resetClick)}`);
  check("rot=0'da derece çipi görünür, Reset gizli",
    await evaluate(ws,
      `(() => { const bar = document.getElementById('v5OptionsBar');
        const info = bar.querySelector('.v5-opt-view-deg');
        const reset = bar.querySelector('.v5-opt-view-reset');
        return info && !info.hidden && info.textContent.trim() === '0°' &&
          reset && getComputedStyle(reset).visibility === 'hidden'; })()`));
  await evaluate(ws, `window.__rotProbe.setRot(0)`);
  check('rot=0 iken desk sınıfı söner',
    await evaluate(ws,
      `!document.getElementById('inkEditor').classList.contains('ink-rotated')`));

  // ---- Shift = 15° snap + HUD çipi ---------------------------------
  // Not: yukarıdaki zoom/pan testleri fit'i değiştirdi; ark merkezini
  // GÜNCEL fit'ten yeniden kur — uygulama açıyı fit merkezinden ölçer.
  await pressKey(ws, 'r', 'KeyR', 82);
  const gSnap = await evaluate(ws, `window.__rotProbe.geo()`);
  const cSnap = {
    x: gSnap.fit.x + gSnap.fit.w / 2,
    y: gSnap.fit.y + gSnap.fit.h / 2 };
  const arm0 = { x: cSnap.x - arm, y: cSnap.y };
  await mouse(ws, 'mousePressed', arm0.x, arm0.y);
  // 27°'ye arc sürükle (Shift ile) → 30'a kenetlenir.
  for (let i = 1; i <= 9; i++) {
    const p = {
      x: cSnap.x - arm * Math.cos(rad(27 * (i / 9))),
      y: cSnap.y - arm * Math.sin(rad(27 * (i / 9))),
    };
    await mouse(ws, 'mouseMoved', p.x, p.y, SHIFT);
    await sleep(30);
  }
  const snapRot = await evaluate(ws, `inkEditorUi.view.rot`);
  const hudNow = await evaluate(ws, `(() => {
    const hud = document.getElementById('inkRotHud');
    return hud ? { hidden: !!hud.hidden, txt: hud.textContent,
      onscreen: hud.hidden === false && hud.textContent.endsWith('°') } : null;
  })()`);
  await mouse(ws, 'mouseReleased', cSnap.x - arm * Math.cos(rad(27)),
    cSnap.y - arm * Math.sin(rad(27)));
  await pressKey(ws, 'r', 'KeyR', 82, 'keyUp');
  await sleep(150);
  const hudGone = await evaluate(ws, `(() => {
    const hud = document.getElementById('inkRotHud');
    return !hud || hud.hidden === true;
  })()`);
  check('Shift ile sürükleme 15° ızgaraya kenetlenir (27° → 30°)',
    snapRot !== null && Math.abs(snapRot - 30) < 0.5, `rot=${snapRot}`);
  check('sürükleme sırasında imleç dibi HUD çipi canlı derece gösterir',
    !!hudNow && hudNow.onscreen, JSON.stringify(hudNow));
  check('bırakınca HUD çipi gizlenir', hudGone === true);

  // ---- Perf: sürükleme sırasında rAF kare sayısı --------------------
  // Not: önceki testlerde rot değişmiş olabilir; 60° hedefi saf ölçüm
  // için sıfırdan başlar.
  await evaluate(ws, `window.__rotProbe.setRot(0)`);
  await evaluate(ws, `(() => {
    window.__rotFrames = 0;
    window.__rotRaf = () => { window.__rotFrames++; requestAnimationFrame(window.__rotRaf); };
    requestAnimationFrame(window.__rotRaf);
  })()`);
  await pressKey(ws, 'r', 'KeyR', 82);
  /* A11 v3: perf arkı da GÜNCEL fit merkezinde (snap testinde fit
     pan/zoomla kaydı) — açı ölçümü pivotla eşleşmeli. */
  const gPerf = await evaluate(ws, `window.__rotProbe.geo()`);
  const cPerf = {
    x: gPerf.fit.x + gPerf.fit.w / 2,
    y: gPerf.fit.y + gPerf.fit.h / 2 };
  const armP = { x: cPerf.x - arm, y: cPerf.y };
  await mouse(ws, 'mousePressed', armP.x, armP.y);
  const perfT0 = Date.now();
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    await mouse(ws, 'mouseMoved',
      cPerf.x - arm * Math.cos(rad(60 * t)), cPerf.y - arm * Math.sin(rad(60 * t)));
    await sleep(25);
  }
  const perfMs = Date.now() - perfT0;
  await mouse(ws, 'mouseReleased',
    cPerf.x - arm * Math.cos(rad(60)), cPerf.y - arm * Math.sin(rad(60)));
  await pressKey(ws, 'r', 'KeyR', 82, 'keyUp');
  const frames = await evaluate(ws, `window.__rotFrames`);
  const fps = frames / (perfMs / 1000);
  const perfRot = await evaluate(ws, `inkEditorUi.view.rot`);
  check('45 derece civarı sürükleme 60fps hedefi (≥30fps)',
    Math.abs(perfRot - 60) <= 3 && fps >= 30,
    `rot=${perfRot} · ${fps.toFixed(0)} fps · ${frames} kare / ${perfMs} ms`);

  // ---- keyup sonrası çizim zinciri sağlamlık -----------------------
  const stampe = await evaluate(ws, `(function postR() {
    const ink = inkState();
    return { tool: ink.tool };
  })()`);
  const toolAfterR = await evaluate(ws, `inkState().tool`);
  check('R keyup sonrası araç korunur (araç-atlama yok)',
    !!toolAfterR && beforePaint.tool === toolAfterR,
    `${beforePaint.tool}→${toolAfterR}`);

  app.kill();
  console.log('ROT-PROBE: ' + results.filter(r => r.ok).length + '/' + results.length);
  process.exit(results.every(r => r.ok) ? 0 : 2);
})().catch(e => {
  console.error('ROT-PROBE HATA:', e.message);
  process.exit(1);
});
