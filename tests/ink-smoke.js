'use strict';

/* Çizim (ink) sistemi davranış testi — gerçek Electron + CDP.

   Kapsam:
   • Başlatma: araç kutusu, canlı tuval, varsayılan katmanlar
   • Kalem basıncı: görsele bağlı katman otomatik açılıyor mu?
   • Vuruş pişirme (bake), geri al / yinele
   • Silgi (destination-out) pikselleri gerçekten siliyor mu?
   • �?ekil aracı + global katman karoları (tile)
   • Kement seçimi + dönüştürme gizmo'su (taşıma)
   • Sentetik .abr ayrıştırma (v6 / samp bloğu)
   • P1 worker raster: ağır vuruş offload, piksel paritesi, geç sonuç atma

   Uygulamayı kendisi başlatır ve kapatır. Kullanım:
     node scripts/ink-smoke.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9334;
const APP_PORT = 5199;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Port kirliyse eski örnek yanlış sayfaya bağlanır (stale renderer
 *  tuzağı). Başlamadan önce sadece bu port'u kullanan electron'u öldür. */
async function killStaleSmokeApp() {
  const { execSync } = require('child_process');
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      try {
        execSync(
          `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='electron.exe'\\" | ` +
          `Where-Object { $_.CommandLine -match 'remote-debugging-port=${PORT}' } | ` +
          `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
          { stdio: 'ignore' });
        console.log('UYARI: eski smoke örnekleri kapatıldı (port ' + PORT + ' doluydu).');
        await sleep(1200);
      } catch { /* öldürme başarısız — devam, waitForTarget eskiye bağlanabilir */ }
    }
  } catch { /* port boş — sorun yok */ }
}

function electronPath() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('electron bulunamadı (npm install)');
  return found;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

const evaluate = (ws, expression, ms = 30000) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    ws.removeEventListener('message', onMsg);
    reject(new Error('eval zaman aşımı'));
  }, ms);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    settled = true;
    clearTimeout(timer);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
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

/* Basınçlı kalem olaylarını sayfada sentetik olarak üretir.
   Gerçek CDP fare olayları basınç taşımadığı için pointerType:'pen'
   kullanıyoruz; dinleyiciler capture fazında olduğundan öğe üzerinde
   gönderim yeterli. */
const PEN_HELPER = `
window.__inkPen = function (pts) {
  // Modal düzenleme açıkken girdi ana tahtaya değil editör tuvaline gider.
  // Testler tahta ekran koordinatı verdiği için dünya → görsel yereli →
  // editör ekranı dönüşümü burada yapılır.
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
window.__inkPenLine = function (x0, y0, x1, y1, n, tiltX, tiltY) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    pts.push({
      x: Math.round(x0 + (x1 - x0) * t),
      y: Math.round(y0 + (y1 - y0) * t),
      p: 0.15 + 0.85 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))),
      tx: tiltX || 0,
      ty: tiltY || 0,
    });
  }
  return window.__inkPen(pts);
};
window.__inkPenPath = function (pts) { return window.__inkPen(pts); };
`;

async function canvasesReady(ws) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const ok = await evaluate(ws, "typeof inkState === 'function' && !!state.ink && state.ink.layers.length >= 2 && !!document.getElementById('inkToolbox')");
      if (ok) return true;
    } catch { /* hazır değil */ }
    await sleep(300);
  }
  return false;
}

(async () => {
  await killStaleSmokeApp();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-ink-'));
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

  let ws = null;
  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await connect(page.webSocketDebuggerUrl);

    const deadline = Date.now() + 25000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
        if (ready) break;
      } catch { /* henüz değil */ }
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');
    await sleep(800);

    /* Arabirim kaplaması: TailRef_INTERFACE=irix → tüm koşum IRIX skin'iyle
       çalışır (ce-skin.js ile aynı anahtar: tailref-interface). Tohumlama
       sonrası sayfa yeniden yüklenir ki kaplama boot'tan itibaren aktif olsun. */
    const smokeInterface = process.env.TailRef_INTERFACE === 'irix' ? 'irix' : 'classic';
    console.log(`ARAYÜZ: ${smokeInterface}`);
    if (smokeInterface === 'irix') {
      try {
        await evaluate(ws,
          "localStorage.setItem('tailref-interface','irix'); location.reload(); true");
      } catch { /* reload bağlamı yok eder — beklenebilir */ }
      const dl2 = Date.now() + 25000;
      let ready2 = false;
      while (Date.now() < dl2) {
        try {
          ready2 = await evaluate(ws,
            "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth && " +
            "document.documentElement.dataset.interface === 'irix'");
          if (ready2) break;
        } catch { /* reload sürüyor */ }
        await sleep(500);
      }
      if (!ready2) throw new Error('IRIX kaplamasıyla renderer hazır olmadı');
      await sleep(800);
    }

    /* Temiz profilde açılışta "kalıcılık modu" karşılama diyaloğu gelir ve
       tüm işaretçi girdisini yakalar. Gerçek kullanıcı gibi bir mod seçilip
       kapatılmazsa tahtaya gönderilen sentetik kalem olayları
       elementFromPoint üzerinden modale gider ve vuruş hiç başlamaz. */
    const welcomeClosed = await evaluate(ws, `(() => {
      const el = document.getElementById('persistenceWelcome');
      if (!el || el.hidden) return true;
      if (typeof closePersistenceWelcome === 'function') closePersistenceWelcome('auto');
      return !!el.hidden;
    })()`);
    if (!welcomeClosed) throw new Error('kalıcılık karşılama diyaloğu kapatılamadı');
    await evaluate(ws, PEN_HELPER);

    // Kurulum: uygulama artık açılışta "Eskiz"/"Notlar" şablon katmanlarını
    // üretmiyor (bkz. inkNormalizeState: "Hayalet/şablon katman ÜRETİLMEZ").
    // Belge katmanları çizim belgesi açılınca kuruluyor; bu test ise eski
    // normalize davranışını (iki küresel katman) varsayıyor. Beklentiyi
    // uygulamaya değil, kurulumu teste taşıyoruz.
    const seededLayers = await evaluate(ws, `(() => {
      const ink = inkState();
      const has = plane => ink.layers.some(l => l.kind === 'global' && l.plane === plane);
      if (!has('below')) inkAddLayer({ kind: 'global', plane: 'below', name: 'Eskiz' });
      if (!has('above')) inkAddLayer({ kind: 'global', plane: 'above', name: 'Notlar' });
      return ink.layers.length;
    })()`);
    if (seededLayers < 2) throw new Error('test katmanları kurulamadı');

    if (!(await canvasesReady(ws))) throw new Error('çizim sistemi başlamadı');

    // Eski tahta-içi çizim testleri doğrudan pointer üretir; üretimde bu
    // yol kapalı olduğu için yalnızca test koşumunda kapı açılır.
    await evaluate(ws, 'window.__TailRef_INK_LEGACY_TEST__ = true; true');

    // ---------------------------------------------------------------
    // 0) Başlatma
    // ---------------------------------------------------------------
    const init = JSON.parse(await evaluate(ws, `JSON.stringify({
      layers: state.ink.layers.length,
      globalLayers: state.ink.layers.filter(l => l.kind === 'global').length,
      tool: state.ink.tool,
      toolboxW: Math.round((document.getElementById('inkToolbox')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width),
      live: !!document.getElementById('inkLive'),
      resizable: !!document.getElementById('inkLive') && document.getElementById('inkLive').width > 0,
    })`));
    check('çizim durumu normalize edildi', init.layers >= 2 && init.globalLayers >= 2, `${init.layers} katman`);
    check('araç kutusu çizim modu dışında gizli', init.toolboxW === 0, `genişlik ${init.toolboxW}px`);
    // v5 çizim arayüzünde varsayılan araç fırça (eski beklenti taşı/dönüştür idi).
    check('varsayılan araç fırça', init.tool === 'brush', init.tool);
    check('canlı önizleme tuvali hazır', init.live && init.resizable, '');
    const fillRaster = JSON.parse(await evaluate(ws, `(() => {
      const makeCanvas = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 7;
        const x = c.getContext('2d');
        x.fillStyle = '#111111';
        x.fillRect(1, 1, 5, 1);
        x.fillRect(1, 5, 5, 1);
        x.fillRect(1, 2, 1, 3);
        x.fillRect(5, 2, 1, 3);
        return { c, x };
      };
      const stroke = inkNormalizeStroke({
        kind: 'fill', tool: 'fill', color: '#ff0000', opacity: 1,
        fillTolerance: 17, points: [{ x: 3, y: 3, p: 1 }],
      });
      const { c, x } = makeCanvas();
      inkDrawStrokeOnContext(x, stroke, {
        mapPoint: p => ({ x: p.x, y: p.y }), sizePx: 1,
      });
      const px = (ctx, xx, yy) => [...ctx.getImageData(xx, yy, 1, 1).data];
      const live = px(x, 3, 3);
      const edge = px(x, 1, 3);
      const outside = px(x, 0, 0);
      const tooLarge = inkFloodFillContext({
        canvas: { width: 3000, height: 3000 },
      }, { x: 0, y: 0 }, '#ffffff', 1, 24);
      return JSON.stringify({
        storedTolerance: stroke.fillTolerance,
        centerRed: live[0] === 255 && live[1] === 0 && live[2] === 0 && live[3] === 255,
        boundaryKept: edge[0] === 17 && edge[1] === 17 && edge[2] === 17 && edge[3] === 255,
        outsideKept: outside[3] === 0,
        oversizedRejected: tooLarge === false,
      });
    })()`));
    check('boya kovası dolu alanı sınır içinde dolduruyor',
      fillRaster.centerRed && fillRaster.boundaryKept && fillRaster.outsideKept,
      JSON.stringify(fillRaster));
    check('boya kovası tolerans kaydı korunuyor ve büyük rasterı reddediyor',
      fillRaster.storedTolerance === 17 && fillRaster.oversizedRejected,
      JSON.stringify(fillRaster));
    const newToolRaster = JSON.parse(await evaluate(ws, `(() => {
      const makeCanvas = () => {
        const c = document.createElement('canvas');
        c.width = 100; c.height = 24;
        const x = c.getContext('2d');
        x.fillStyle = '#ff0000'; x.fillRect(0, 0, 50, 24);
        x.fillStyle = '#0000ff'; x.fillRect(50, 0, 50, 24);
        return c;
      };
      const smudge = inkNormalizeStroke({
        id: 'smudge-raster-test', kind: 'smudge', tool: 'smudge',
        color: '#ffffff', size: 14, opacity: 1, hardness: 1, flow: 0.32, spacing: 0.1,
        points: [{ x: 37, y: 12, p: 1 }, { x: 70, y: 12, p: 1 }],
      });
      const a = makeCanvas(), b = makeCanvas();
      const opts = { mapPoint: p => ({ x: p.x, y: p.y }), sizePx: 14, pointScale: { x: 1, y: 1 } };
      inkDrawStrokeOnContext(a.getContext('2d'), smudge, opts);
      inkDrawStrokeOnContext(b.getContext('2d'), smudge, opts);
      const aData = a.getContext('2d').getImageData(0, 0, 100, 24).data;
      const bData = b.getContext('2d').getImageData(0, 0, 100, 24).data;
      const moved = [...a.getContext('2d').getImageData(58, 12, 1, 1).data];
      const originalMoved = [...b.getContext('2d').getImageData(58, 12, 1, 1).data];
      const blueSide = a.getContext('2d').getImageData(50, 5, 20, 14).data;
      let blueSideMaxRed = 0;
      for (let i = 0; i < blueSide.length; i += 4) {
        if (blueSide[i + 2] > 100 && blueSide[i + 3] > 200) {
          blueSideMaxRed = Math.max(blueSideMaxRed, blueSide[i]);
        }
      }
      const gradientCanvas = document.createElement('canvas');
      gradientCanvas.width = 100; gradientCanvas.height = 20;
      const gradient = inkNormalizeStroke({
        id: 'gradient-raster-test', kind: 'gradient', tool: 'gradient',
        color: '#ff0000', opacity: 1,
        points: [{ x: 10, y: 10, p: 1 }, { x: 90, y: 10, p: 1 }],
      });
      inkDrawStrokeOnContext(gradientCanvas.getContext('2d'), gradient, {
        mapPoint: p => ({ x: p.x, y: p.y }), sizePx: 1,
      });
      const gradientCtx = gradientCanvas.getContext('2d');
      const start = [...gradientCtx.getImageData(10, 10, 1, 1).data];
      const end = [...gradientCtx.getImageData(90, 10, 1, 1).data];
      const smudgeStressCanvas = document.createElement('canvas');
      smudgeStressCanvas.width = 512;
      smudgeStressCanvas.height = 256;
      const smudgeStressCtx = smudgeStressCanvas.getContext('2d');
      const colorField = smudgeStressCtx.createLinearGradient(0, 0, 512, 0);
      colorField.addColorStop(0, '#ff0000');
      colorField.addColorStop(1, '#0000ff');
      smudgeStressCtx.fillStyle = colorField;
      smudgeStressCtx.fillRect(0, 0, 512, 256);
      const smudgeStressBefore = smudgeStressCtx.getImageData(0, 0, 512, 256).data;
      const smudgeStress = inkNormalizeStroke({
        id: 'smudge-performance-test', kind: 'smudge', tool: 'smudge',
        color: '#ffffff', size: 180, opacity: 1, hardness: 0.72,
        flow: 0.32, spacing: 0.08,
        points: Array.from({ length: 1200 }, (_, i) => {
          const t = i / 1199;
          return { x: 8 + t * 496, y: 128 + Math.sin(t * Math.PI * 8) * 28, p: 1 };
        }),
      });
      const smudgeStressStarted = performance.now();
      inkDrawStrokeOnContext(smudgeStressCtx, smudgeStress, {
        mapPoint: p => ({ x: p.x, y: p.y }), sizePx: 180,
      });
      const smudgeStressMs = performance.now() - smudgeStressStarted;
      const smudgeStressPixels = smudgeStressCtx.getImageData(0, 0, 512, 256).data;
      let smudgeStressChanged = false;
      for (let i = 0; i < smudgeStressPixels.length; i += 4) {
        if (Math.abs(smudgeStressPixels[i] - smudgeStressBefore[i]) > 8 ||
            Math.abs(smudgeStressPixels[i + 2] - smudgeStressBefore[i + 2]) > 8) {
          smudgeStressChanged = true;
          break;
        }
      }
      return JSON.stringify({
        kindsPreserved: smudge.kind === 'smudge' && gradient.kind === 'gradient',
        smudgeMovesColor: blueSideMaxRed > 20,
        smudgeDoesNotPaintForeground: moved[1] < 10,
        smudgeBlueSideMaxRed: blueSideMaxRed,
        smudgeMovedPixel: moved, smudgeOriginalPixel: originalMoved,
        smudgeDeterministic: aData.every((value, i) => value === bData[i]),
        smudgeStressResponsive: smudgeStressMs < 500 && smudgeStressChanged,
        smudgeStressMs,
        gradientStartsOpaqueRed: start[0] > 245 && start[1] < 10 && start[3] > 245,
        gradientEndsTransparent: end[3] < 10,
      });
    })()`));
    check('parmak aracı renkleri sürüklüyor ve tekrarlanabilir raster üretiyor',
      newToolRaster.smudgeMovesColor && newToolRaster.smudgeDoesNotPaintForeground &&
      newToolRaster.smudgeDeterministic,
      JSON.stringify(newToolRaster));
    check('büyük parmak vuruşu hızlı biçimde renkleri karıştırıyor',
      newToolRaster.smudgeStressResponsive,
      `${newToolRaster.smudgeStressMs} ms`);
    check('gradyan aracı ön plan renginden saydama geçiyor',
      newToolRaster.gradientStartsOpaqueRed && newToolRaster.gradientEndsTransparent &&
      newToolRaster.kindsPreserved, JSON.stringify(newToolRaster));
    const brushSettings = JSON.parse(await evaluate(ws, `(() => {
      const watercolor = NativeBrushLibrary.find(b => b.id === 'native-watercolor');
      const tip = createWatercolorTip(128, watercolor.tipOptions);
      const ctx = tip.getContext('2d');
      const image = ctx.getImageData(0, 0, tip.width, tip.height).data;
      const alphaAt = (x, y) => image[(y * tip.width + x) * 4 + 3];
      const pen = inkGetBrush('native-studio-pen');
      const oldMinOpacity = pen.dynamics.opacityMin;
      const samplePressure = minOpacity => {
        pen.dynamics.opacityMin = minOpacity;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        inkDrawStrokeOnContext(canvas.getContext('2d'), {
          id: 'pressure-opacity-' + minOpacity,
          kind: 'stroke', tool: 'brush', color: '#ffffff',
          size: 40, opacity: 1, hardness: 1, spacing: 0.04,
          brushId: pen.id, flow: 1, flowJitter: 0, scatter: 0,
          points: [{ x: 0.5, y: 0.5, p: 0.2 }],
        }, { mapPoint: p => ({ x: p.x * 64, y: p.y * 64 }), sizePx: 40 });
        return canvas.getContext('2d').getImageData(32, 32, 1, 1).data[3];
      };
      const lowPressureAlpha = samplePressure(0);
      const highMinimumAlpha = samplePressure(0.8);
      pen.dynamics.opacityMin = oldMinOpacity;
      const presetRenderCounts = NativeBrushLibrary.map(brush => {
        const canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 96;
        inkDrawStrokeOnContext(canvas.getContext('2d'), {
          id: 'preset-render-' + brush.id,
          kind: 'stroke', tool: 'brush', color: '#ffffff',
          size: brush.size, opacity: brush.opacity, hardness: brush.hardness,
          spacing: brush.spacing, speedSize: brush.speedSize, flow: brush.flow,
          flowJitter: brush.flowJitter, scatter: brush.scatter,
          taperStart: brush.taperStart, taperEnd: brush.taperEnd,
          brushId: brush.id,
          points: [
            { x: 16, y: 58, p: 0.3 }, { x: 82, y: 30, p: 0.75 },
            { x: 150, y: 66, p: 1 }, { x: 224, y: 38, p: 0.55 },
          ],
        }, { mapPoint: p => ({ x: p.x, y: p.y }), sizePx: brush.size, brush });
        const pixels = canvas.getContext('2d').getImageData(0, 0, 240, 96).data;
        let count = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 8) count++;
        return count;
      });
      const blendSelect = document.getElementById('inkLayerBlend');
      const expectedBlendModes = [
        'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
        'color-dodge', 'color-burn', 'hard-light', 'soft-light',
        'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
      ];
      const blendCanvas = document.createElement('canvas');
      blendCanvas.width = blendCanvas.height = 1;
      const blendCtx = blendCanvas.getContext('2d');
      const blendPixels = {};
      for (const mode of expectedBlendModes) {
        blendCtx.globalCompositeOperation = 'source-over';
        blendCtx.fillStyle = 'rgb(65,125,190)';
        blendCtx.fillRect(0, 0, 1, 1);
        blendCtx.globalCompositeOperation = mode === 'normal' ? 'source-over' : mode;
        const supported = mode === 'normal' || blendCtx.globalCompositeOperation === mode;
        blendCtx.fillStyle = 'rgb(210,85,45)';
        blendCtx.fillRect(0, 0, 1, 1);
        blendPixels[mode] = { supported, pixel: Array.from(blendCtx.getImageData(0, 0, 1, 1).data) };
      }
      const normalPixel = blendPixels.normal.pixel;
      const blendModesWork = expectedBlendModes.every(mode =>
        blendPixels[mode].supported &&
        (mode === 'normal' || blendPixels[mode].pixel.some((channel, i) => channel !== normalPixel[i]))
      );
      return JSON.stringify({
        controls: ['inkFlow', 'inkFlowJitter', 'inkScatter', 'inkSpacingJitter', 'inkPressureSize',
          'inkPressureOpacity', 'inkAngleJitter', 'inkTaperStart', 'inkTaperEnd']
          .every(id => !!document.getElementById(id)),
        creatorControls: ['nativeBrushCustomName', 'nativeBrushCustomTip', 'nativeBrushCustomCreate',
          'nativeBrushCustomPng', 'nativeBrushCustomPngButton', 'nativeBrushCustomPngClear',
          'nativeBrushCustomDelete', 'nativeBrushCreatorPreview', 'nativeBrushCreatorTestCanvas',
          'nativeBrushCreatorTestLive', 'nativeBrushCreatorTestColor',
          'nativeBrushCreatorTestClear'].every(id => !!document.getElementById(id)),
        presetsArtistic: NativeBrushLibrary.length >= 15 &&
          NativeBrushLibrary.every(brush => Number.isFinite(brush.flow) &&
            Number.isFinite(brush.spacing) && Number.isFinite(brush.hardness) &&
            brush.tip && brush.dynamics && Number.isFinite(brush.dynamics.sizeMin)),
        presetCount: NativeBrushLibrary.length,
        presetRenderCoverage: presetRenderCounts.every(count => count > 0),
        presetRenderVariations: new Set(presetRenderCounts).size,
        presetRenderCounts,
        presetPacks: (() => {
          const counts = {};
          for (const brush of NativeBrushLibrary) {
            counts[brush.category] = (counts[brush.category] || 0) + 1;
          }
          const packs = NativeBrushCategories
            .filter(category => category.id !== 'custom')
            .map(category => ({ id: category.id, name: category.name, count: counts[category.id] || 0 }));
          return {
            packs,
            ok: packs.length >= 9 && packs.every(pack => pack.count >= 10),
          };
        })(),
        preset: !!watercolor && watercolor.spacing >= 0.08 && watercolor.flow >= 0.2 &&
          watercolor.tipVariants >= 3 && watercolor.stampFlipX > 0 &&
          watercolor.tipRotation > 0 && watercolor.dynamics.spacingJitter > 0,
        centerAlpha: alphaAt(64, 64),
        rimAlpha: alphaAt(120, 64),
        rimIsPigmented: alphaAt(120, 64) > alphaAt(64, 64),
        watercolorOpacityMin: watercolor.dynamics.opacityMin,
        lowPressureAlpha,
        highMinimumAlpha,
        blendModeOptions: Array.from(blendSelect.options).map(option => option.value),
        expectedBlendModes,
        blendModesWork,
        blendModesCssSupported: expectedBlendModes.every(mode =>
          mode === 'normal' || CSS.supports('mix-blend-mode', mode)),
        blendModesPersist: expectedBlendModes.every(mode =>
          inkNormalizeLayer({ id: 'blend-' + mode, blend: mode }).blend === mode),
      });
    })()`));
    check('profesyonel akış ve saçılma kontrolleri mevcut', brushSettings.controls);
    check('hazır fırçalar ayrı uç ve basınç karakterleriyle tanımlı',
      brushSettings.presetsArtistic, `${brushSettings.presetCount} hazır fırça`);
    check('her fırça paketi en az 10 fırça içeriyor',
      brushSettings.presetPacks.ok,
      brushSettings.presetPacks.packs.map(pack => `${pack.name} ${pack.count}`).join(' · '));
    check('tüm hazır fırçalar farklı raster izleri üretiyor',
      brushSettings.presetRenderCoverage && brushSettings.presetRenderVariations >= 8,
      `${brushSettings.presetRenderCoverage ? 'tamamı çizdi' : 'boş raster var'} · ` +
      `${brushSettings.presetRenderVariations} farklı sonuç`);
    check('suluboya presetinde uç yığını ve seyrek damla kullanılıyor', brushSettings.preset);
    check('suluboya ucu yumuşak merkez ve kontrollü pigment kenarı üretiyor',
      brushSettings.centerAlpha > 0 && brushSettings.rimIsPigmented && brushSettings.rimAlpha < 180,
      `merkez ${brushSettings.centerAlpha} · kenar ${brushSettings.rimAlpha}`);
    check('suluboya düşük basınçta daha hafif boya bırakıyor',
      brushSettings.watercolorOpacityMin < 0.35 &&
        brushSettings.highMinimumAlpha > brushSettings.lowPressureAlpha,
      `min. opaklık ${brushSettings.watercolorOpacityMin} · piksel alfa ${brushSettings.lowPressureAlpha}→${brushSettings.highMinimumAlpha}`);
    check('referans uygulama tarzı 16 karışım modu menüde ve kayıtta mevcut',
      JSON.stringify(brushSettings.blendModeOptions.slice().sort()) ===
        JSON.stringify(brushSettings.expectedBlendModes.slice().sort()) &&
      brushSettings.blendModesPersist,
      `${brushSettings.blendModeOptions.length} mod · kayıt=${brushSettings.blendModesPersist}`);
    check('karışım modları canvas ve katman compositing tarafından destekleniyor',
      brushSettings.blendModesWork && brushSettings.blendModesCssSupported,
      `canvas=${brushSettings.blendModesWork} · CSS=${brushSettings.blendModesCssSupported}`);
    const customBrushResult = JSON.parse(await evaluate(ws, `(async () => {
      const ink = inkState();
      const originalId = ink.brushId;
      const oldDeletedBrushIds = [...(ink.deletedBrushIds || [])];
      const oldDeletedCategories = [...(ink.deletedCategories || [])];
      const oldCategoryOrder = [...inkNativeLibrary.categoryOrder];
      const oldName = document.getElementById('nativeBrushCustomName').value;
      document.getElementById('nativeBrushCustomName').value = 'Test Özel Fırça';
      document.getElementById('nativeBrushCustomTip').value = 'watercolor';
      document.getElementById('nativeBrushCustomTaperStart').value = '40';
      const setCustomRange = (id, value) => {
        document.getElementById('nativeBrushCustom' + id).value = String(value);
      };
      const standardForm = Array.from(document.querySelectorAll(
        '#nativeBrushCustomControls input, #nativeBrushCustomControls select'
      )).map(input => ({ input, value: input.value, checked: input.checked }));
      setCustomRange('Angle', 90);
      setCustomRange('Roundness', 50);
      setCustomRange('SizeJitter', 30);
      setCustomRange('AngleJitter', 25);
      setCustomRange('RoundnessMin', 30);
      setCustomRange('RoundnessJitter', 20);
      setCustomRange('ScatterX', 100);
      setCustomRange('ScatterY', 50);
      setCustomRange('ScatterJitter', 35);
      setCustomRange('SpacingJitter', 40);
      setCustomRange('Count', 3);
      setCustomRange('CountJitter', 20);
      setCustomRange('Texture', 0);
      document.getElementById('nativeBrushCustomTexture').value = 'canvas';
      setCustomRange('TextureScale', 150);
      setCustomRange('TextureDepth', 40);
      setCustomRange('TextureBrightness', -20);
      setCustomRange('TextureContrast', 150);
      document.getElementById('nativeBrushCustomTextureEachTip').checked = true;
      // İkili fırça seçimi kütüphane ilk açıldığında dolduruluyor; test
      // kütüphaneyi açmadan önce değeri yazar — option'ları önce senkronla.
      inkNativeSyncDualBrushOptions();
      document.getElementById('nativeBrushCustomDualBrush').value = 'native-studio-pen';
      document.getElementById('nativeBrushCustomDualBlend').value = 'screen';
      setCustomRange('DualScale', 125);
      setCustomRange('DualSpacing', 75);
      setCustomRange('DualScatter', 30);
      document.getElementById('nativeBrushCustomBackground').value = '#112233';
      setCustomRange('ColorMix', 25);
      setCustomRange('HueJitter', 10);
      setCustomRange('SaturationJitter', 20);
      setCustomRange('BrightnessJitter', 15);
      setCustomRange('Purity', 10);
      setCustomRange('FlowJitter', 20);
      setCustomRange('OpacityJitter', 25);
      setCustomRange('Noise', 10);
      setCustomRange('WetEdges', 30);
      document.getElementById('nativeBrushCustomAirbrush').checked = true;
      document.getElementById('nativeBrushCustomSizeSource').value = 'random';
      document.getElementById('nativeBrushCustomOpacitySource').value = 'random';
      const advancedBrush = inkNativeCustomBrushFromForm();
      const advancedSettingsMapped =
        Math.abs(advancedBrush.angle - Math.PI / 2) < 0.001 &&
        advancedBrush.roundness === 0.5 && advancedBrush.scatter === 0 &&
        advancedBrush.scatterX === 1 && advancedBrush.scatterY === 0.5 &&
        advancedBrush.scatterCount === 3 && advancedBrush.scatterCountJitter === 0.2 &&
        advancedBrush.texture && advancedBrush.textureId === 'canvas' &&
        advancedBrush.textureScale === 1.5 && advancedBrush.textureDepth === 0.4 &&
        advancedBrush.textureBrightness === -0.2 && advancedBrush.textureContrast === 1.5 &&
        advancedBrush.textureEachTip &&
        advancedBrush.dual?.brushId === 'native-studio-pen' &&
        advancedBrush.dual.blend === 'screen' && advancedBrush.dual.scale === 1.25 &&
        advancedBrush.dual.spacing === 0.75 && advancedBrush.dual.scatter === 0.3 &&
        advancedBrush.colorDynamics.background === '#112233' &&
        advancedBrush.colorDynamics.foregroundBackground === 0.25 &&
        advancedBrush.colorDynamics.hueJitter === 0.1 &&
        advancedBrush.colorDynamics.saturationJitter === 0.2 &&
        advancedBrush.colorDynamics.brightnessJitter === 0.15 &&
        advancedBrush.colorDynamics.purity === 0.1 &&
        advancedBrush.flowJitter === 0.2 && advancedBrush.airbrush &&
        advancedBrush.noise === 0.1 && advancedBrush.wetEdges === 0.3 &&
        advancedBrush.dynamics.src === 'random' &&
        advancedBrush.dynamics.sizeJitter === 0.3 &&
        advancedBrush.dynamics.scatterJitter === 0.35 &&
        advancedBrush.dynamics.spacingJitter === 0.4 &&
        advancedBrush.dynamics.opacityJitter === 0.25 &&
        advancedBrush.dynamics.opacitySrc === 'random';
      for (const saved of standardForm) {
        saved.input.value = saved.value;
        if (saved.input.type === 'checkbox') saved.input.checked = saved.checked;
      }
      document.getElementById('nativeBrushCustomCreate').click();
      const created = ink.brushes.find(b => b.id === ink.brushId);
      const persisted = inkNormalizeState(JSON.parse(JSON.stringify(ink)))
        .brushes.find(b => b.id === (created && created.id));
      const listed = !!document.querySelector('#nativeBrushList [data-brush-id="' +
        (created && created.id) + '"]');
      const createOk = !!created && created.name === 'Test Özel Fırça' &&
        created.category === 'custom' && created.tip === 'watercolor' &&
        Math.abs(created.taperStart - 0.4) < 0.001 && !!persisted && listed;
      // Aynı ayarlarla ikinci kez "Oluştur"a basmak kopya eklememeli.
      const brushCountAfterCreate = ink.brushes.length;
      document.getElementById('nativeBrushCustomCreate').click();
      const duplicateGuard = ink.brushes.length === brushCountAfterCreate &&
        ink.brushId === created.id &&
        ink.brushes.filter(b => b.name === 'Test Özel Fırça').length === 1;
      const libraryRoot = document.getElementById('nativeBrushLibrary');
      const libraryWasOpen = libraryRoot && !libraryRoot.hidden;
      const brushesBeforePreview = ink.brushes.length;
      inkNativeSyncCustomCreator();
      const previewDoesNotSaveBrush = ink.brushes.length === brushesBeforePreview;
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: true });
      inkNativeCreatorTestRender();
      const testCanvas = document.getElementById('nativeBrushCreatorTestCanvas');
      const testRect = testCanvas.getBoundingClientRect();
      const px = ratio => testRect.left + testRect.width * ratio;
      const py = ratio => testRect.top + testRect.height * ratio;
      const sendPointer = (type, x, y, pressure) => testCanvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 17, pointerType: 'pen', pressure, button: type === 'pointerup' ? 0 : 0,
        clientX: x, clientY: y,
      }));
      if (testRect.width > 0 && testRect.height > 0) {
        sendPointer('pointerdown', px(0.1), py(0.55), 0.45);
        sendPointer('pointermove', px(0.42), py(0.3), 0.7);
        sendPointer('pointermove', px(0.72), py(0.7), 0.9);
        sendPointer('pointerup', px(0.9), py(0.45), 0.65);
      }
      const testPixels = testCanvas.getContext('2d').getImageData(0, 0, testCanvas.width, testCanvas.height).data;
      let testInkPixels = 0;
      for (let i = 3; i < testPixels.length; i += 4) if (testPixels[i] > 8) testInkPixels++;
      const lastTestStroke = inkNativeBrushUi.testStrokes[inkNativeBrushUi.testStrokes.length - 1];
      const testDrewStroke = testInkPixels > 20 && !!lastTestStroke &&
        lastTestStroke.brush.tip === 'watercolor';
      const testUndoButton = document.getElementById('nativeBrushCreatorTestUndo');
      const undoEnabledAfterDraw = !!testUndoButton && !testUndoButton.disabled;
      // Kaydırıcı odaktayken de Ctrl+Z oluşturucunun test çizimlerini geri almalı.
      const sizeSlider = document.getElementById('nativeBrushCustomSize');
      if (sizeSlider) sizeSlider.focus();
      const undoEvent = new KeyboardEvent('keydown', {
        key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
      });
      (sizeSlider || document).dispatchEvent(undoEvent);
      const testUndoWorks = inkNativeBrushUi.testStrokes.length === 0 &&
        inkNativeBrushUi.testRedoStrokes.length === 1 && undoEvent.defaultPrevented &&
        !!testUndoButton && testUndoButton.disabled;
      const redoEvent = new KeyboardEvent('keydown', {
        key: 'y', ctrlKey: true, bubbles: true, cancelable: true,
      });
      (sizeSlider || document).dispatchEvent(redoEvent);
      const testRedoWorks = inkNativeBrushUi.testStrokes.length === 1 &&
        inkNativeBrushUi.testRedoStrokes.length === 0 && redoEvent.defaultPrevented &&
        !!testUndoButton && !testUndoButton.disabled;
      const testCanvasSize = testCanvas.width + 'x' + testCanvas.height +
        ' css=' + Math.round(testRect.width) + 'x' + Math.round(testRect.height) +
        ' strokes=' + inkNativeBrushUi.testStrokes.length +
        ' points=' + (lastTestStroke ? lastTestStroke.stroke.points.length : 0);
      document.getElementById('nativeBrushCreatorTestClear').click();
      const testClears = inkNativeBrushUi.testStrokes.length === 0;
      /* Canlı test paneli paritesi (A): bırakıştan ÖNCEKİ canlı katman ile
         bırakınca commitleşen iz aynı koyulukta olmalı. Eski hata: canlı
         katman her karede n-root seyreltmeyle boyanıyordu → bırakınca iz
         belirgin şekilde koyulaşıyordu. */
      const liveCanvas = document.getElementById('nativeBrushCreatorTestLive');
      const uiParity = (() => {
        if (!liveCanvas || testRect.width <= 0) return null;
        const sendUi = (type, x, y, pressure) => testCanvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true, pointerId: 19, pointerType: 'pen', pressure,
          button: 0, clientX: x, clientY: y,
        }));
        sendUi('pointerdown', px(0.12), py(0.6), 0.5);
        sendUi('pointermove', px(0.22), py(0.42), 0.62);
        sendUi('pointermove', px(0.32), py(0.6), 0.72);
        sendUi('pointermove', px(0.42), py(0.4), 0.85);
        sendUi('pointermove', px(0.52), py(0.58), 0.75);
        sendUi('pointermove', px(0.62), py(0.45), 0.65);
        const lctx = liveCanvas.getContext('2d');
        const livePx = lctx.getImageData(0, 0, liveCanvas.width, liveCanvas.height).data;
        /* Aynı noktada bırak: commit ile canlı aynı bölgeyi kapsasın. */
        sendUi('pointerup', px(0.62), py(0.45), 0.65);
        const commitPx = testCanvas.getContext('2d')
          .getImageData(0, 0, testCanvas.width, testCanvas.height).data;
        let liveSum = 0, commitSum = 0, inked = 0, inkCommit = 0;
        const n = Math.min(livePx.length, commitPx.length);
        for (let i = 3; i < n; i += 4) {
          if (commitPx[i] > 8) inkCommit++;
          if (livePx[i] > 8) { liveSum += livePx[i]; commitSum += commitPx[i]; inked++; }
        }
        return {
          liveMean: inked ? liveSum / inked : 0,
          commitMean: inked ? commitSum / inked : 0,
          inkCommit, inked,
        };
      })();
      const testLiveParity = !!uiParity && uiParity.inkCommit > 40 &&
        uiParity.inked > 40 && uiParity.commitMean > 4 &&
        uiParity.liveMean > uiParity.commitMean * 0.9 &&
        uiParity.liveMean < uiParity.commitMean * 1.1 &&
        uiParity.inkCommit < uiParity.inked * 1.6;
      const testLiveParityDetail = uiParity
        ? (Math.round(uiParity.liveMean * 100) / 100) + '/' +
          (Math.round(uiParity.commitMean * 100) / 100) +
          ' ink=' + uiParity.inked + '/' + uiParity.inkCommit
        : 'yok';
      document.getElementById('nativeBrushCreatorTestClear').click();
      /* Canlı test paneli paritesi (B): artımlı dual birikim + tek geçişli
         opaklık kompoziti, tek geçişli commit rasterıyla piksel eşit. */
      const modelParity = (() => {
        const brush = inkGetBrush(created.id);
        if (!brush || brush.size <= 0) return null;
        const PW = 260, PH = 150;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const sizePx = brush.size * dpr;
        const mk = () => {
          const c = document.createElement('canvas');
          c.width = PW; c.height = PH;
          return c;
        };
        const points = [
          { x: 24, y: 112, p: 0.4 }, { x: 72, y: 78, p: 0.65 },
          { x: 122, y: 42, p: 0.9 }, { x: 172, y: 72, p: 0.7 },
          { x: 222, y: 38, p: 0.55 },
        ];
        const stroke = {
          id: 'creator-live-model-parity', kind: 'stroke', tool: 'brush',
          color: '#ffffff', size: 1, opacity: 0.55,
          hardness: brush.hardness, spacing: brush.spacing,
          flow: brush.flow, flowJitter: brush.flowJitter || 0,
          scatter: brush.scatter || 0,
          taperStart: brush.taperStart || 0,
          taperEnd: brush.taperEnd || 0,
          brushId: brush.id, points: [],
        };
        const opts = extra => Object.assign({
          mapPoint: p => ({ x: p.x, y: p.y }),
          sizePx,
          pointScale: { x: PW, y: PH },
          brush,
        }, extra || {});
        const wts = mk();
        const wctx = wts.getContext('2d', { colorSpace: 'srgb' });
        wctx.imageSmoothingEnabled = true;
        wctx.imageSmoothingQuality = 'high';
        let drawn = 0;
        for (let i = 0; i < points.length; i++) {
          stroke.points.push(points[i]);
          drawn = Math.max(drawn, inkDrawStrokeOnContext(wctx, stroke,
            opts({ skipDabs: drawn, dualDirect: true, stableOnly: true })) | 0);
        }
        /* Bırakış: kuyruk + uç incelmesi aynı birikime eklenir. */
        inkDrawStrokeOnContext(wctx, stroke, opts({ skipDabs: drawn, dualDirect: true }));
        const live = mk();
        const lctx = live.getContext('2d', { colorSpace: 'srgb' });
        lctx.globalAlpha = stroke.opacity;
        lctx.drawImage(wts, 0, 0);
        lctx.globalAlpha = 1;
        const commit = mk();
        inkDrawStrokeOnContext(commit.getContext('2d', { colorSpace: 'srgb' }), stroke, opts());
        const livePx = lctx.getImageData(0, 0, PW, PH).data;
        const commitPx = commit.getContext('2d', { colorSpace: 'srgb' })
          .getImageData(0, 0, PW, PH).data;
        let diffPixels = 0, maxDelta = 0, liveSum = 0;
        for (let i = 3; i < livePx.length; i += 4) {
          liveSum += livePx[i];
          const d = Math.abs(livePx[i] - commitPx[i]);
          if (d > 2) diffPixels++;
          if (d > maxDelta) maxDelta = d;
        }
        return {
          dabs: drawn, diffPixels, maxDelta,
          mean: Math.round(liveSum / (PW * PH) / 255 * 1000) / 1000,
          total: PW * PH,
        };
      })();
      const testModelParity = !!modelParity && modelParity.dabs > 3 &&
        modelParity.mean > 0.01 &&
        modelParity.diffPixels < modelParity.total * 0.01 &&
        modelParity.maxDelta <= 6;
      const testModelParityDetail = modelParity
        ? 'dabs=' + modelParity.dabs + ' diff=' + modelParity.diffPixels +
          ' max=' + modelParity.maxDelta + ' mean=' + modelParity.mean
        : 'yok';
      if (!libraryWasOpen) inkCloseNativeBrushLibrary();
      const cv = document.createElement('canvas');
      cv.width = cv.height = 512;
      const stroke = {
        id: 'custom-brush-render-test', kind: 'stroke', tool: 'brush',
        color: '#ffffff', size: 48, opacity: 1, hardness: created.hardness,
        spacing: created.spacing, flow: created.flow, flowJitter: 0,
        scatter: 0, taperStart: created.taperStart, taperEnd: 0,
        brushId: created.id,
        points: [
          { x: 80, y: 256, p: 1 }, { x: 160, y: 256, p: 1 },
          { x: 240, y: 256, p: 1 }, { x: 320, y: 256, p: 1 },
          { x: 400, y: 256, p: 1 },
        ],
      };
      inkDrawStrokeOnContext(cv.getContext('2d'), stroke, {
        mapPoint: p => ({ x: p.x, y: p.y }), sizePx: 48,
      });
      const pixels = cv.getContext('2d').getImageData(0, 0, 512, 512).data;
      const alphaCount = () => {
        let count = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 8) count++;
        return count;
      };
      const alphaWidth = x => {
        let count = 0;
        for (let y = 0; y < 512; y++) if (pixels[(y * 512 + x) * 4 + 3] > 8) count++;
        return count;
      };
      const renderedPixels = alphaCount();
      const startWidth = alphaWidth(84);
      const middleWidth = alphaWidth(240);
      const noTaperCanvas = document.createElement('canvas');
      noTaperCanvas.width = noTaperCanvas.height = 512;
      inkDrawStrokeOnContext(noTaperCanvas.getContext('2d'),
        Object.assign({}, stroke, { taperStart: 0 }), {
          mapPoint: p => ({ x: p.x, y: p.y }), sizePx: 48,
        });
      const noTaperPixels = noTaperCanvas.getContext('2d').getImageData(0, 0, 512, 512).data;
      let taperChangedPixels = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (Math.abs(pixels[i] - noTaperPixels[i]) > 8) taperChangedPixels++;
      }
      const rendersAsConfigured = renderedPixels > 500 && taperChangedPixels > 100;
      const renderWithDynamics = jitter => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        const brush = Object.assign({}, created, {
          scatterX: 1, scatterY: 0.5, scatterCount: 3,
          dynamics: Object.assign({}, created.dynamics, {
            scatterJitter: jitter, spacingJitter: jitter,
          }),
        });
        inkDrawStrokeOnContext(canvas.getContext('2d'), stroke, {
          mapPoint: p => ({ x: p.x, y: p.y }), sizePx: 48, brush,
        });
        return canvas.getContext('2d').getImageData(0, 0, 512, 512).data;
      };
      const stableDynamicsPixels = renderWithDynamics(0);
      const jitteredDynamicsPixels = renderWithDynamics(1);
      let dynamicPixelChanges = 0;
      for (let i = 3; i < stableDynamicsPixels.length; i += 4) {
        if (stableDynamicsPixels[i] !== jitteredDynamicsPixels[i]) dynamicPixelChanges++;
      }
      const jitterAffectsRaster = dynamicPixelChanges > 100;
      const stressCanvas = document.createElement('canvas');
      stressCanvas.width = 128;
      stressCanvas.height = 96;
      const stressBrush = Object.assign({}, created, {
        size: 400, spacing: 0.01, scatterX: 2, scatterY: 2, scatterCount: 16,
        texture: true, textureId: 'canvas', textureDepth: 1, noise: 1,
        wetEdges: 1, airbrush: true, dual: null,
        colorDynamics: Object.assign({}, created.colorDynamics, {
          background: '#1765cc', foregroundBackground: 1,
          hueJitter: 1, saturationJitter: 1, brightnessJitter: 1, purity: 1,
        }),
        dynamics: Object.assign({}, created.dynamics, {
          scatterJitter: 1, spacingJitter: 1,
        }),
      });
      const stressStroke = Object.assign({}, stroke, {
        id: 'creator-settings-stress-test',
        spacing: 0.01,
        points: [{ x: 20, y: 48, p: 0.7 }, { x: 60, y: 48, p: 0.8 },
          { x: 100, y: 48, p: 0.9 }],
      });
      const tintCacheBeforeStress = inkRuntimeBrushes.tintCache.size;
      const stressStarted = performance.now();
      inkDrawStrokeOnContext(stressCanvas.getContext('2d'), stressStroke, {
        mapPoint: p => ({ x: p.x, y: p.y }), sizePx: 400, brush: stressBrush,
      });
      const stressDuration = performance.now() - stressStarted;
      const stressPixels = stressCanvas.getContext('2d')
        .getImageData(0, 0, stressCanvas.width, stressCanvas.height).data;
      let stressInkPixels = 0;
      const stressColors = new Set();
      for (let i = 3; i < stressPixels.length; i += 4) {
        if (stressPixels[i] > 8) {
          stressInkPixels++;
          if (stressPixels[i] > 80) {
            stressColors.add(stressPixels[i - 3] + ',' +
              stressPixels[i - 2] + ',' + stressPixels[i - 1]);
          }
        }
      }
      const maxSettingsRenderSafe = stressInkPixels > 20 &&
        stressColors.size > 2 && stressDuration < 2000 &&
        inkRuntimeBrushes.tintCache.size === tintCacheBeforeStress &&
        inkRuntimeBrushes.dynamicTintCanvases.size <= INK_DYNAMIC_TINT_LIMIT;
      const confirm = window.confirm;
      window.confirm = () => true;
      window.__tailrefConfirmBypass = true; /* appConfirm stub yoluna düşsün */
      const card = document.querySelector('#nativeBrushList [data-brush-id="' + created.id + '"]');
      card.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX: 80, clientY: 80,
      }));
      const brushMenu = document.querySelector('.nbContextMenu');
      /* Menü etiketleri kaynakta İngilizce (l10n veri katmanı ayrı). */
      const brushMenuOpen = !!brushMenu && brushMenu.textContent.includes('Delete brush');
      const deleteBrushButton = brushMenu
        ? Array.from(brushMenu.querySelectorAll('button:not(:disabled)'))
          .find(btn => /delete/i.test(btn.textContent)) : null;
      deleteBrushButton?.click();
      /* appConfirm artık async (ana süreç diyaloğu / stub mikro-görevi):
         silmenin bitmesini beklemeden kontrol etmek yanlış 'false' üretir. */
      await new Promise(r => setTimeout(r, 80));
      window.confirm = confirm;
      const deleted = !!created && ink.deletedBrushIds.includes(created.id) &&
        !document.querySelector('#nativeBrushList [data-brush-id="' + created.id + '"]');
      const brushDeletionPersists = !!created &&
        inkNormalizeState(JSON.parse(JSON.stringify(ink))).deletedBrushIds.includes(created.id);
      const categoryButton = document.querySelector('#nativeBrushCategories [data-category="concept"]');
      categoryButton.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX: 80, clientY: 80,
      }));
      const categoryMenu = document.querySelector('.nbContextMenu');
      const categoryMenuOpen = !!categoryMenu &&
        categoryMenu.textContent.includes('Delete the category and its brushes');
      window.confirm = () => true;
      window.__tailrefConfirmBypass = true; /* appConfirm stub yoluna düşsün */
      const categoryDeleteButton = categoryMenu
        ? Array.from(categoryMenu.querySelectorAll('button:not(:disabled)'))
          .find(btn => /delete/i.test(btn.textContent)) : null;
      categoryDeleteButton?.click();
      await new Promise(r => setTimeout(r, 80)); /* async silme bitsin */
      window.confirm = confirm;
      const categoryDeleted = ink.deletedCategories.includes('concept') &&
        !document.querySelector('#nativeBrushCategories [data-category="concept"]');
      const categoryDeletionPersists =
        inkNormalizeState(JSON.parse(JSON.stringify(ink))).deletedCategories.includes('concept');
      ink.deletedBrushIds = oldDeletedBrushIds;
      ink.deletedCategories = oldDeletedCategories;
      inkNativeLibrary.categoryOrder = oldCategoryOrder;
      inkNativeRenderAll();
      document.getElementById('nativeBrushCustomName').value = oldName;
      setActiveBrush(originalId);
      inkNativeSync();
      return JSON.stringify({
        createOk, duplicateGuard, advancedSettingsMapped, previewDoesNotSaveBrush, testDrewStroke,
        undoEnabledAfterDraw, testUndoWorks, testRedoWorks, testInkPixels, testCanvasSize, testClears,
        testLiveParity, testLiveParityDetail, testModelParity, testModelParityDetail,
        rendersAsConfigured, renderedPixels, startWidth, middleWidth,
        jitterAffectsRaster, dynamicPixelChanges,
        maxSettingsRenderSafe, stressDuration, stressInkPixels,
        stressColorCount: stressColors.size,
        stressTintCacheDelta: inkRuntimeBrushes.tintCache.size - tintCacheBeforeStress,
        dynamicTintEntries: inkRuntimeBrushes.dynamicTintCanvases.size,
        taperChangedPixels, deleted, brushMenuOpen, categoryMenuOpen, categoryDeleted,
        brushDeletionPersists, categoryDeletionPersists,
      });
    })()`));
    check('özel fırça oluşturuluyor, kaydediliyor ve listeleniyor',
      customBrushResult.createOk, `oluşturma ve kayıt ${customBrushResult.createOk}`);
    check('aynı ayarlarla ikinci fırça kopyalanmıyor',
      customBrushResult.duplicateGuard, `kopya koruması ${customBrushResult.duplicateGuard}`);
    const libraryUiResult = JSON.parse(await evaluate(ws, `(async () => {
      const waitFor = async (fn, tries = 60) => {
        for (let i = 0; i < tries; i++) {
          if (fn()) return true;
          await new Promise(r => setTimeout(r, 20));
        }
        return false;
      };
      const oldFavorites = [...inkNativeLibrary.favorites];
      const oldCustomCategories = inkNativeLibrary.customCategories.map(c => ({ ...c }));
      const oldOrder = [...inkNativeLibrary.categoryOrder];
      const oldActive = inkNativeBrushUi.activeCategory;
      inkOpenNativeBrushLibrary(null, 'concept');
      const brush = inkNativeBrushesForCategory('concept')[0] ||
        inkNativeVisibleBrushes()[0];
      const card = document.querySelector('#nativeBrushList [data-brush-id="' +
        brush.id + '"]');
      const star = card && card.querySelector('.nbBrushCard__star');
      const starExists = !!star;
      star?.click();
      const favorited = await waitFor(() => inkNativeLibrary.favorites.includes(brush.id));
      const favoritesButton = document.querySelector(
        '#nativeBrushCategories [data-category="favorites"]');
      favoritesButton?.click();
      const inFavorites = !!document.querySelector(
        '#nativeBrushList [data-brush-id="' + brush.id + '"]');
      const favoritesCount = favoritesButton
        ? favoritesButton.querySelector('.nbCategory__count')?.textContent : '';
      document.querySelector('#nativeBrushList [data-brush-id="' + brush.id + '"]')
        ?.querySelector('.nbBrushCard__star')?.click();
      const unfavorited = await waitFor(() => !inkNativeLibrary.favorites.includes(brush.id));
      const create = await inkNativeCreateCategory('Smoke Kategori');
      const createdButton = create.ok
        ? document.querySelector('#nativeBrushCategories [data-category="' +
          create.category.id + '"]') : null;
      const createdSelected = !!create.ok && inkNativeBrushUi.activeCategory ===
        create.category.id && !!createdButton && createdButton.classList.contains('is-active');
      const saved = await idbGet('meta', 'ink:library');
      const createdPersisted = !!(saved && Array.isArray(saved.customCategories) &&
        saved.customCategories.some(c => c.id === create.category.id));
      const nav = document.getElementById('nativeBrushCategories');
      const fromBtn = nav.querySelector('[data-category="concept"]');
      const toBtn = nav.querySelector('[data-category="inking"]');
      let dragged = false;
      if (fromBtn && toBtn) {
        const dt = new DataTransfer();
        const rect = toBtn.getBoundingClientRect();
        fromBtn.dispatchEvent(new DragEvent('dragstart', {
          bubbles: true, cancelable: true, dataTransfer: dt,
        }));
        toBtn.dispatchEvent(new DragEvent('dragover', {
          bubbles: true, cancelable: true, dataTransfer: dt, clientY: rect.top + 1,
        }));
        toBtn.dispatchEvent(new DragEvent('drop', {
          bubbles: true, cancelable: true, dataTransfer: dt, clientY: rect.top + 1,
        }));
        dragged = await waitFor(() => {
          const order = inkNativeEffectiveCategoryOrder(
            inkNativeAllCategories().map(c => c.id));
          return order.indexOf('concept') < order.indexOf('inking');
        });
      }
      const confirm = window.confirm;
      window.confirm = () => true;
      window.__tailrefConfirmBypass = true; /* appConfirm stub yoluna düşsün */
      if (create.ok) await inkNativeDeleteCategory(create.category.id);
      window.confirm = confirm;
      inkNativeLibrary.favorites = oldFavorites;
      inkNativeLibrary.customCategories = oldCustomCategories;
      inkNativeLibrary.categoryOrder = oldOrder;
      inkNativeBrushUi.activeCategory = oldActive;
      await inkNativePersistLibraryAll();
      inkNativeRenderAll();
      inkCloseNativeBrushLibrary();
      return JSON.stringify({
        starExists, favorited, inFavorites, favoritesCount, unfavorited,
        createdSelected, createdPersisted, dragged,
      });
    })()`));
    check('fırça kartındaki yıldız beğenilenlere ekliyor ve oradan kaldırıyor',
      libraryUiResult.starExists && libraryUiResult.favorited &&
        libraryUiResult.inFavorites && libraryUiResult.unfavorited,
      `yıldız=${libraryUiResult.starExists} · ekleme=${libraryUiResult.favorited} · ` +
        `beğenilenler=${libraryUiResult.inFavorites} (${libraryUiResult.favoritesCount}) · ` +
        `kaldırma=${libraryUiResult.unfavorited}`);
    check('yeni kategori oluşturuluyor, seçiliyor ve kayıt almadan saklanıyor',
      libraryUiResult.createdSelected && libraryUiResult.createdPersisted,
      `seçili=${libraryUiResult.createdSelected} · kayıtlı=${libraryUiResult.createdPersisted}`);
    check('kategori fare ile sürüklenip yeniden sıralanıyor',
      libraryUiResult.dragged, `sıralama=${libraryUiResult.dragged}`);
    const pngTipResult = JSON.parse(await evaluate(ws, `(async () => {
      const source = document.createElement('canvas');
      source.width = source.height = 32;
      const sourceCtx = source.getContext('2d');
      sourceCtx.fillStyle = '#ffffff';
      sourceCtx.fillRect(0, 0, 32, 32);
      sourceCtx.fillStyle = '#000000';
      sourceCtx.beginPath();
      sourceCtx.arc(16, 16, 8, 0, Math.PI * 2);
      sourceCtx.fill();
      const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'tip-test.png', { type: 'image/png' });
      const tip = await inkNativeBrushTipFromPng(file);
      const url = inkRuntime.importedTips.get(tip.tipId);
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      const mask = document.createElement('canvas');
      mask.width = image.naturalWidth;
      mask.height = image.naturalHeight;
      const maskCtx = mask.getContext('2d');
      maskCtx.drawImage(image, 0, 0);
      const pixels = maskCtx.getImageData(0, 0, mask.width, mask.height).data;
      const centerAlpha = pixels[(16 * 32 + 16) * 4 + 3];
      const cornerAlpha = pixels[3];
      const previousTip = inkNativeBrushUi.uploadedTip;
      inkNativeBrushUi.uploadedTip = tip;
      const oldName = document.getElementById('nativeBrushCustomName').value;
      document.getElementById('nativeBrushCustomName').value = 'PNG Test Ucu';
      const brush = inkNativeCustomBrushFromForm();
      const modelUsesPng = brush.kind === 'abr' && brush.tipId === tip.tipId &&
        !!inkRuntime.importedTips.get(brush.tipId);
      inkNativeBrushUi.uploadedTip = previousTip;
      document.getElementById('nativeBrushCustomName').value = oldName;
      inkRuntime.importedTips.delete(tip.tipId);
      inkRuntimeBrushes.abrImages.delete(tip.tipId);
      return JSON.stringify({
        decoded: image.naturalWidth === 32 && image.naturalHeight === 32,
        centerAlpha, cornerAlpha, modelUsesPng,
      });
    })()`));
    check('PNG fırça ucu maskeye çevrilip özel fırça modeline bağlanıyor',
      pngTipResult.decoded && pngTipResult.centerAlpha > 220 &&
        pngTipResult.cornerAlpha < 20 && pngTipResult.modelUsesPng,
      `merkez alfa=${pngTipResult.centerAlpha} · köşe alfa=${pngTipResult.cornerAlpha} · ` +
      `model=${pngTipResult.modelUsesPng}`);
    check('oluşturucu gelişmiş ayarları fırça modeline aktarıyor',
      customBrushResult.advancedSettingsMapped,
      `ayar modeli=${customBrushResult.advancedSettingsMapped}`);
    check('oluşturucu test alanı ayarlı fırçayla çiziyor ve temizleniyor',
      customBrushResult.testDrewStroke && customBrushResult.testClears,
      `${customBrushResult.testInkPixels}px çizildi · ${customBrushResult.testCanvasSize} · ` +
      `temizlendi=${customBrushResult.testClears}`);
    check('test alanında Ctrl+Z ve Ctrl+Y yalnızca test çizgisini geri alıp yineliyor',
      customBrushResult.undoEnabledAfterDraw &&
      customBrushResult.testUndoWorks && customBrushResult.testRedoWorks,
      `geri düğmesi=${customBrushResult.undoEnabledAfterDraw} · ` +
      `undo=${customBrushResult.testUndoWorks} · redo=${customBrushResult.testRedoWorks}`);
    check('önizleme ayar değiştirirken fırça kütüphanesine geçici kayıt eklemiyor',
      customBrushResult.previewDoesNotSaveBrush,
      `önizleme kaydı yok=${customBrushResult.previewDoesNotSaveBrush}`);
    check('test alanında çizerken görünen iz ile bırakınca oluşan iz aynı koyulukta',
      customBrushResult.testLiveParity,
      `canlı/commit ortalama alfa = ${customBrushResult.testLiveParityDetail}`);
    check('canlı damla birikimi + tek geçişli opaklık, commit rasterıyla piksel eşit',
      customBrushResult.testModelParity,
      customBrushResult.testModelParityDetail);
    check('özel fırça gerçek raster üretiyor ve taper ayarı çizgiye yansıyor',
      customBrushResult.rendersAsConfigured,
      `${customBrushResult.renderedPixels}px · taper farkı ${customBrushResult.taperChangedPixels}px · ` +
      `başlangıç ${customBrushResult.startWidth}px / orta ${customBrushResult.middleWidth}px`);
    check('saçılma ve aralık titreşimi gerçek rasterı değiştiriyor',
      customBrushResult.jitterAffectsRaster,
      `${customBrushResult.dynamicPixelChanges} alfa pikseli değişti`);
    check('yüksek yoğunluklu fırça ayarları uygulamayı kilitlemeden raster üretiyor',
      customBrushResult.maxSettingsRenderSafe,
      `${customBrushResult.stressInkPixels}px · ${customBrushResult.stressColorCount} renk · ` +
      `${customBrushResult.stressDuration.toFixed(1)} ms · ` +
      `renk önbelleği +${customBrushResult.stressTintCacheDelta} · ` +
      `${customBrushResult.dynamicTintEntries} tekrar kullanılabilir uç`);
    check('seçili özel fırça kütüphaneden silinebiliyor',
      customBrushResult.deleted, `silindi ${customBrushResult.deleted}`);
    check('sağ tık özel fırça menüsü silme işlemini sunuyor',
      customBrushResult.brushMenuOpen && customBrushResult.deleted,
      `menü=${customBrushResult.brushMenuOpen} silindi=${customBrushResult.deleted}`);
    check('sağ tık kategori menüsü kategoriyi ve içeriğini kaldırıyor',
      customBrushResult.categoryMenuOpen && customBrushResult.categoryDeleted,
      `menü=${customBrushResult.categoryMenuOpen} silindi=${customBrushResult.categoryDeleted}`);
    check('fırça ve kategori silme durumu kayıtta korunuyor',
      customBrushResult.brushDeletionPersists && customBrushResult.categoryDeletionPersists,
      `fırça=${customBrushResult.brushDeletionPersists} kategori=${customBrushResult.categoryDeletionPersists}`);
    const editableBrushSettings = JSON.parse(await evaluate(ws, `(() => {
      const originalId = inkState().brushId;
      setActiveBrush('native-watercolor');
      const flow = document.getElementById('inkFlow');
      const jitter = document.getElementById('inkFlowJitter');
      const scatter = document.getElementById('inkScatter');
      const spacingJitter = document.getElementById('inkSpacingJitter');
      const pressureSize = document.getElementById('inkPressureSize');
      const angleJitter = document.getElementById('inkAngleJitter');
      const pressureOpacity = document.getElementById('inkPressureOpacity');
      const taperStart = document.getElementById('inkTaperStart');
      const taperEnd = document.getElementById('inkTaperEnd');
      flow.value = '37';
      flow.dispatchEvent(new Event('input', { bubbles: true }));
      jitter.value = '23';
      jitter.dispatchEvent(new Event('input', { bubbles: true }));
      scatter.value = '41';
      scatter.dispatchEvent(new Event('input', { bubbles: true }));
      spacingJitter.value = '31';
      spacingJitter.dispatchEvent(new Event('input', { bubbles: true }));
      pressureSize.value = '22';
      pressureSize.dispatchEvent(new Event('input', { bubbles: true }));
      angleJitter.value = '14';
      angleJitter.dispatchEvent(new Event('input', { bubbles: true }));
      pressureOpacity.value = '12';
      pressureOpacity.dispatchEvent(new Event('input', { bubbles: true }));
      taperStart.value = '35';
      taperStart.dispatchEvent(new Event('input', { bubbles: true }));
      taperEnd.value = '48';
      taperEnd.dispatchEvent(new Event('input', { bubbles: true }));
      const edited = [inkState().flow, inkState().flowJitter, inkState().scatter];
      const saved = inkGetBrush('native-watercolor');
      setActiveBrush('native-studio-pen');
      const isolated = inkState().flow === inkGetBrush('native-studio-pen').flow;
      setActiveBrush('native-watercolor');
      const restored = [inkState().flow, inkState().flowJitter, inkState().scatter];
      setActiveBrush(originalId);
      const reloaded = inkNormalizeState(JSON.parse(JSON.stringify(inkState())));
      const persisted = reloaded.brushes.find(b => b.id === 'native-watercolor');
      return JSON.stringify({
        stored: Math.abs(saved.flow - 0.37) < 0.001 &&
          Math.abs(saved.flowJitter - 0.23) < 0.001 &&
          Math.abs(saved.scatter - 0.41) < 0.001 &&
          Math.abs(saved.dynamics.spacingJitter - 0.31) < 0.001 &&
          Math.abs(saved.dynamics.sizeMin - 0.22) < 0.001 &&
          Math.abs(saved.dynamics.opacityMin - 0.12) < 0.001 &&
          Math.abs(saved.dynamics.angleJitter - 0.14) < 0.001 &&
          Math.abs(saved.taperStart - 0.35) < 0.001 &&
          Math.abs(saved.taperEnd - 0.48) < 0.001,
        isolated,
        restored: edited.every((v, i) => Math.abs(v - restored[i]) < 0.001),
        persisted: !!persisted && Math.abs(persisted.flow - 0.37) < 0.001 &&
          Math.abs(persisted.dynamics.spacingJitter - 0.31) < 0.001 &&
          Math.abs(persisted.taperStart - 0.35) < 0.001 &&
          Math.abs(persisted.taperEnd - 0.48) < 0.001 &&
          Math.abs(persisted.dynamics.sizeMin - 0.22) < 0.001 &&
          Math.abs(persisted.dynamics.opacityMin - 0.12) < 0.001,
        edited, saved: [saved.flow, saved.flowJitter, saved.scatter],
      });
    })()`));
    check('akış ve saçılma ayarları seçili fırçaya kaydediliyor',
      editableBrushSettings.stored, `${editableBrushSettings.saved.join('/')} · ${editableBrushSettings.edited.join('/')}`);
    check('fırça ayarları diğer presetlere taşmıyor', editableBrushSettings.isolated);
    check('fırçaya dönünce özel ayarları geri yükleniyor', editableBrushSettings.restored);
    check('yerleşik fırça özelleştirmesi yeniden yüklemede korunuyor', editableBrushSettings.persisted);

    // ---------------------------------------------------------------
    // 1) Test görseli
    // ---------------------------------------------------------------
    const imageCount = await evaluate(ws, "state.items.filter(i => i.kind === 'image').length");
    if (!imageCount) {
      await evaluate(ws, `(async () => {
        const c = document.createElement('canvas');
        c.width = 320; c.height = 240;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 320, 240);
        grad.addColorStop(0, '#4da3ff'); grad.addColorStop(1, '#7bd88f');
        g.fillStyle = grad; g.fillRect(0, 0, 320, 240);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        await addFiles([new File([blob], 'ink.png', { type: 'image/png' })], null);
        return state.items.length;
      })()`);
      await sleep(1400);
    }
    await evaluate(ws, '(() => { selection.clear(); syncSelection(); fitAll(120); return true; })()');
    await sleep(500);

    const target = JSON.parse(await evaluate(ws, `(() => {
      for (const it of state.items) {
        if (it.kind !== 'image') continue;
        const el = elMap.get(it.id); if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.height < 80) continue;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx < 220 || cy < 220 || cx > innerWidth - 220 || cy > innerHeight - 220) continue;
        return JSON.stringify({
          id: it.id, cx: Math.round(cx), cy: Math.round(cy),
          left: Math.round(r.left), top: Math.round(r.top),
          right: Math.round(r.right), bottom: Math.round(r.bottom),
        });
      }
      return 'null';
    })()`));
    if (!target) throw new Error('test görseli ekran içinde değil');

    // Aktif katmanı "altta" global yap: görsel üstüne çizim otomatik bağlanmalı.
    await evaluate(ws, `(() => {
      const below = state.ink.layers.find(l => l.kind === 'global' && l.plane === 'below');
      inkSetActiveLayer(below.id);
      const ink = inkState();
      ink.autoAttach = true;
      ink.size = 26;
      ink.opacity = 1;
      ink.hardness = 0.6;
      ink.spacing = 0.08;
      ink.smoothing = 0.15;
      ink.color = '#ff3355';
      inkSetTool('brush');
      return below.id;
    })()`);

    await evaluate(ws, `(() => {
      const el = document.getElementById('persistenceWelcome');
      if (el && !el.hidden) {
        if (typeof closePersistenceWelcome === 'function') closePersistenceWelcome('auto');
        else el.hidden = true;
      }
      return !el || el.hidden;
    })()`);

    const halfW = Math.round((target.right - target.left) * 0.3);
    await evaluate(ws, `window.__inkPenLine(${target.cx - halfW}, ${target.cy - 20}, ${target.cx + halfW}, ${target.cy + 20}, 26)`);
    await sleep(350);

    const strokeState = JSON.parse(await evaluate(ws, `(() => {
      const it = state.items.find(i => i.kind === 'image');
      const layers = inkLayersForOwner(it.id);
      const layer = layers[layers.length - 1];
      const canvas = layer ? inkRuntime.itemCanvases.get(layer.id) : null;
      let alpha = 0;
      if (canvas) {
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) alpha += 1;
      }
      const strokes = layer ? layer.strokes : [];
      const ps = strokes[0] ? strokes[0].points.map(p => Math.round(p.p * 100) / 100) : [];
      const root = document.getElementById('nativeBrushLibrary');
      const hit = document.elementFromPoint(${target.cx}, ${target.cy});
      return JSON.stringify({
        layerId: layer ? layer.id : '',
        layers: layers.length,
        strokes: strokes.length,
        kinds: strokes.map(s => s.kind),
        pMin: ps.length ? Math.min(...ps) : -1,
        pMax: ps.length ? Math.max(...ps) : -1,
        canvasW: canvas ? canvas.width : 0,
        paintedPx: alpha,
        onItem: !!(canvas && canvas.closest('.item')),
        libraryOpen: !!(root && !root.hidden),
        bodyLocked: document.body.classList.contains('native-brush-open'),
        hit: hit ? (hit.id || String(hit.className)) : '',
        brushId: inkState().brushId,
        autoAttach: inkState().autoAttach,
      });
    })()`));

    check('görsel üstüne çizim bağlı katman açtı', strokeState.layers === 1, `${strokeState.layers} katman · kitaplık=${strokeState.libraryOpen} · kilit=${strokeState.bodyLocked} · isabet=${strokeState.hit} · fırça=${strokeState.brushId} · auto=${strokeState.autoAttach}`);
    check('vuruş kaydedildi (vektör)', strokeState.strokes === 1 && strokeState.kinds[0] === 'stroke', `${strokeState.strokes} vuruş`);
    check('basınç noktalara işlendi', strokeState.pMin >= 0.1 && strokeState.pMax > strokeState.pMin + 0.2, `${strokeState.pMin}–${strokeState.pMax}`);
    check('bağlı tuval görselin içinde', strokeState.onItem, `tuval ${strokeState.canvasW}px`);
    check('vuruş tuvale pişirildi', strokeState.paintedPx > 120, `${strokeState.paintedPx} piksel`);

    const paintedBefore = strokeState.paintedPx;

    // ---------------------------------------------------------------
    // 2) Geri al / yinele
    // ---------------------------------------------------------------
    await evaluate(ws, 'undo()');
    await sleep(500);
    const afterUndo = JSON.parse(await evaluate(ws, `(() => {
      const it = state.items.find(i => i.kind === 'image');
      const layers = inkLayersForOwner(it.id);
      return JSON.stringify({ strokes: layers.reduce((n, l) => n + l.strokes.length, 0) });
    })()`));
    check('geri al vuruşu kaldırdı', afterUndo.strokes === 0, `${afterUndo.strokes} vuruş`);

    await evaluate(ws, 'redo()');
    await sleep(500);
    const afterRedo = JSON.parse(await evaluate(ws, `(() => {
      const it = state.items.find(i => i.kind === 'image');
      const layer = inkLayersForOwner(it.id).slice(-1)[0];
      const canvas = layer ? inkRuntime.itemCanvases.get(layer.id) : null;
      let alpha = 0;
      if (canvas) {
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) alpha += 1;
      }
      return JSON.stringify({ strokes: layer ? layer.strokes.length : 0, paintedPx: alpha });
    })()`));
    check('yinele vuruşu geri getirdi', afterRedo.strokes === 1 && afterRedo.paintedPx > 120, `${afterRedo.strokes} vuruş · ${afterRedo.paintedPx}px`);

    // ---------------------------------------------------------------
    // 3) Silgi
    // ---------------------------------------------------------------
    await evaluate(ws, `(() => { inkSetTool('eraser'); inkState().size = 30; return true; })()`);
    await evaluate(ws, `window.__inkPenLine(${target.cx - halfW}, ${target.cy - 20}, ${target.cx + halfW}, ${target.cy + 20}, 26)`);
    await sleep(350);
    const eraseState = JSON.parse(await evaluate(ws, `(() => {
      const it = state.items.find(i => i.kind === 'image');
      const layer = inkLayersForOwner(it.id).slice(-1)[0];
      const canvas = layer ? inkRuntime.itemCanvases.get(layer.id) : null;
      let alpha = 0;
      if (canvas) {
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) alpha += 1;
      }
      return JSON.stringify({
        strokes: layer ? layer.strokes.length : 0,
        tools: layer ? layer.strokes.map(s => s.tool) : [],
        paintedPx: alpha,
      });
    })()`));
    check('silgi vuruşu kaydedildi', eraseState.strokes === 2 && eraseState.tools[1] === 'eraser', eraseState.tools.join(','));
    check('silgi pikselleri azalttı', eraseState.paintedPx < paintedBefore, `${paintedBefore} → ${eraseState.paintedPx} px`);

    // ---------------------------------------------------------------
    // 4) �?ekil + global karo
    // ---------------------------------------------------------------
    const empty = JSON.parse(await evaluate(ws, `(() => {
      const w = stage.clientWidth, h = stage.clientHeight;
      for (let gy = 0.62; gy < 0.9; gy += 0.04) {
        for (let gx = 0.3; gx < 0.9; gx += 0.04) {
          const x = Math.round(w * gx), y = Math.round(h * gy);
          const el = document.elementFromPoint(x, y);
          if (el && (el.id === 'stage' || el.id === 'world')) return JSON.stringify({ x, y });
        }
      }
      return 'null';
    })()`));
    if (!empty) throw new Error('boş alan bulunamadı');

    await evaluate(ws, `(() => {
      inkSetTool('shape', { shape: 'arrow' });
      inkState().size = 22;
      inkState().color = '#ffd166';
      return true;
    })()`);
    await evaluate(ws, `window.__inkPenLine(${empty.x}, ${empty.y}, ${empty.x + 180}, ${empty.y - 90}, 8)`);
    await sleep(350);

    const globalState = JSON.parse(await evaluate(ws, `(() => {
      const layer = state.ink.layers.find(l => l.kind === 'global' && l.plane === 'below');
      const tiles = [...inkRuntime.tiles.values()].filter(t => t.layerId === layer.id);
      let painted = 0;
      for (const t of tiles) {
        const d = t.canvas.getContext('2d').getImageData(0, 0, t.canvas.width, t.canvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted += 1;
      }
      return JSON.stringify({
        strokes: layer.strokes.length,
        kinds: layer.strokes.map(s => s.kind),
        shapes: layer.strokes.map(s => s.shape),
        tiles: tiles.length,
        painted,
        z: tiles.length ? Number(tiles[0].canvas.style.zIndex) : -1,
      });
    })()`));
    check('şekil aracı vuruşu kaydetti', globalState.strokes >= 1 && globalState.kinds.includes('shape') && globalState.shapes.includes('arrow'), `${globalState.strokes} vuruş`);
    check('global katman karolara bölündü', globalState.tiles >= 1 && globalState.painted > 60, `${globalState.tiles} karo · ${globalState.painted}px`);
    check('alt katman karoları görsellerin altında', globalState.z > 0 && globalState.z < 10, `z=${globalState.z}`);

    // Üst düzlem katmanı
    const aboveId = await evaluate(ws, `(() => {
      const ink = inkState();
      let above = ink.layers.find(l => l.kind === 'global' && l.plane === 'above');
      if (!above) above = inkAddLayer({ kind: 'global', plane: 'above' });
      ink.activeLayerId = above.id;
      inkSetTool('brush');
      inkState().size = 18;
      inkState().color = '#4dd0ff';
      return above.id;
    })()`);
    await evaluate(ws, `(() => {
      const pts = [];
      for (let i = 0; i <= 24; i += 1) {
        const t = i / 24;
        pts.push({
          x: Math.round(${empty.x} + 40 + t * 220),
          y: Math.round(${empty.y} + 70 + Math.sin(t * Math.PI * 2) * 26),
          p: 1,
        });
      }
      return window.__inkPenPath(pts);
    })()`);
    await sleep(350);

    const aboveInfo = JSON.parse(await evaluate(ws, `(() => {
      const layer = inkLayerById(${JSON.stringify(aboveId)});
      const tiles = [...inkRuntime.tiles.values()].filter(t => t.layerId === layer.id);
      let painted = 0;
      for (const t of tiles) {
        const d = t.canvas.getContext('2d').getImageData(0, 0, t.canvas.width, t.canvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted += 1;
      }
      return JSON.stringify({ strokes: layer.strokes.length, tiles: tiles.length, painted, z: tiles.length ? Number(tiles[0].canvas.style.zIndex) : -1, id: layer.id, detail: layer.strokes.map(s => (s.tool || '?') + ':' + (s.kind || '?') + ':' + s.id) });
    })()`));
    check('üst düzlem katmanı çizildi', aboveInfo.strokes === 1 && aboveInfo.painted > 60, `${aboveInfo.strokes} vuruş · ${aboveInfo.painted}px · ${aboveInfo.id} · ${JSON.stringify(aboveInfo.detail)}`);
    check('üst katman karoları görsellerin üstünde', aboveInfo.z >= 200000, `z=${aboveInfo.z}`);

    // ---------------------------------------------------------------
    // 5) Kement seçimi + gizmo taşıma
    // ---------------------------------------------------------------
    const arrowBox = JSON.parse(await evaluate(ws, `(() => {
      const layer = state.ink.layers.find(l => l.kind === 'global' && l.plane === 'below');
      const stroke = layer.strokes.find(s => s.kind === 'shape');
      const b = inkStrokeWorldBounds(layer, stroke);
      const screen = worldToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      return JSON.stringify({ cx: Math.round(screen.x), cy: Math.round(screen.y), w: b.w, h: b.h });
    })()`));

    // Kement: seçilecek vuruşun çevresini dolaş.
    await evaluate(ws, `(() => { inkSetActiveLayer(state.ink.layers.find(l => l.kind === 'global' && l.plane === 'below').id); inkSetTool('lasso'); return true; })()`);
    // Ekran yarıçapı: dünya kutusunun ekran boyutu + pay.
    const loopRadius = await evaluate(ws, `(() => {
      const b = inkSelectionBounds ? null : null;
      const stageW = stage.clientWidth;
      const scale = state.view.scale;
      const layer = state.ink.layers.find(l => l.kind === 'global' && l.plane === 'below');
      const stroke = layer.strokes.find(s => s.kind === 'shape');
      const bb = inkStrokeWorldBounds(layer, stroke);
      return Math.round(Math.max(bb.w, bb.h) * scale * 0.75 + 40);
    })()`);
    await evaluate(ws, `(() => {
      const pts = [];
      const n = 28;
      for (let i = 0; i <= n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        pts.push({
          x: Math.round(${arrowBox.cx} + Math.cos(a) * ${loopRadius}),
          y: Math.round(${arrowBox.cy} + Math.sin(a) * ${loopRadius}),
          p: 1,
        });
      }
      return window.__inkPenPath(pts);
    })()`);
    await sleep(350);

    const lassoInfo = JSON.parse(await evaluate(ws, `JSON.stringify({
      selected: state.ink.selection.length,
      gizmo: !document.getElementById('inkGizmo').hidden,
      gx: Math.round(parseFloat(document.getElementById('inkGizmo').style.left) || 0),
    })`));
    check('kement vuruşları seçti', lassoInfo.selected >= 1, `${lassoInfo.selected} seçili`);
    check('seçim gizmo\'su göründü', lassoInfo.gizmo, '');

    // Önceki zoom/pan kontrolleri seçimi ekran dışında bırakabilir;
    // gizmo'nun tıklanabilirliği için görünümü seçim sınırlarına ortala.
    await evaluate(ws, `(() => {
      const b = inkSelectionBounds();
      if (!b) return false;
      const pad = 80;
      const s = Math.max(0.05, Math.min(4,
        (stage.clientWidth - pad * 2) / Math.max(b.w, 1),
        (stage.clientHeight - pad * 2) / Math.max(b.h, 1)));
      state.view.scale = s;
      state.view.x = stage.clientWidth / 2 - (b.x + b.w / 2) * s;
      state.view.y = stage.clientHeight / 2 - (b.y + b.h / 2) * s;
      applyView();
      inkUpdateGizmo();
      return true;
    })()`);
    await sleep(420);

    const beforeMove = JSON.parse(await evaluate(ws, `(() => {
      const layer = state.ink.layers.find(l => l.kind === 'global' && l.plane === 'below');
      const b = inkSelectionBounds();
      return JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y) });
    })()`));

    await evaluate(ws, `(() => { inkSetTool('transform'); inkUpdateGizmo(); return true; })()`);
    await sleep(150);
    const gizmoCenter = JSON.parse(await evaluate(ws, `(() => {
      const g = document.getElementById('inkGizmo');
      const r = g.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`));
    const hitGizmo = JSON.parse(await evaluate(ws, `(() => {
      const g = document.getElementById('inkGizmo');
      const r = g.getBoundingClientRect();
      const el = document.elementFromPoint(${gizmoCenter.x}, ${gizmoCenter.y});
      return JSON.stringify({
        hit: !!(el && el.closest && el.closest('#inkGizmo')),
        top: el ? (el.id || el.className || el.tagName) : 'yok',
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        style: [g.style.left, g.style.top, g.style.width, g.style.height],
        view: [Math.round(state.view.x), Math.round(state.view.y), +state.view.scale.toFixed(3)],
        win: [innerWidth, innerHeight],
        parent: g.parentElement ? (g.parentElement.id || g.parentElement.className) : 'yok',
      });
    })()`));
    check('gizmo gövdesi işaretlenebilir', hitGizmo.hit === true,
      `üst:${hitGizmo.top} rect:${hitGizmo.rect.join(',')} stil:${hitGizmo.style.join(',')} ` +
      `view:${hitGizmo.view.join(',')} pencere:${hitGizmo.win.join(',')} ebeveyn:${hitGizmo.parent}`);
    if (hitGizmo.hit !== true) {
      // Gizmo tıklanamıyorsa sürükleme adımı anlamsız; paket çökmesin,
      // kalan kontroller koşmaya devam etsin.
      check('gizmo taşıma seçimi kaydırdı', false, 'gizmo bulunamadı');
    } else {
    await evaluate(ws, `(() => {
      const g = document.getElementById('inkGizmo').getBoundingClientRect();
      const x = Math.round(g.left + g.width / 2), y = Math.round(g.top + g.height / 2);
      const pid = 7001;
      const mk = (type, cx, cy) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: pid, pointerType: 'pen', isPrimary: true,
        pressure: 1, clientX: cx, clientY: cy,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      });
      const box = document.elementFromPoint(x, y);
      box.dispatchEvent(mk('pointerdown', x, y));
      window.dispatchEvent(mk('pointermove', x + 50, y + 26));
      window.dispatchEvent(mk('pointermove', x + 74, y + 38));
      window.dispatchEvent(mk('pointerup', x + 74, y + 38));
      return true;
    })()`);
    await sleep(300);

    const afterMove = JSON.parse(await evaluate(ws, `(() => {
      const b = inkSelectionBounds();
      return JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y), sel: state.ink.selection.length });
    })()`));
    const expected = JSON.parse(await evaluate(ws, 'JSON.stringify({ scale: state.view.scale })'));
    const wantDx = Math.round(74 / expected.scale);
    const wantDy = Math.round(38 / expected.scale);
    const gotDx = afterMove.x - beforeMove.x;
    const gotDy = afterMove.y - beforeMove.y;
    check('gizmo taşıma seçimi kaydırdı',
      Math.abs(gotDx - wantDx) <= 3 && Math.abs(gotDy - wantDy) <= 3,
      `istenen ${wantDx},${wantDy} · olan ${gotDx},${gotDy}`);
    }

    // ---------------------------------------------------------------
    // 5b) Katman görünürlük / opaklık / karışım
    // ---------------------------------------------------------------
    const layerCtl = JSON.parse(await evaluate(ws, `(() => {
      const globalLayer = state.ink.layers.find(l => l.kind === 'global' && l.plane === 'below');
      const attachedLayer = inkLayersForOwner(state.items.find(i => i.kind === 'image').id)[0];
      const tile = [...inkRuntime.tiles.values()].find(t => t.layerId === globalLayer.id);
      const aCanvas = attachedLayer ? inkRuntime.itemCanvases.get(attachedLayer.id) : null;

      globalLayer.opacity = 0.4;
      globalLayer.blend = 'multiply';
      if (attachedLayer) { attachedLayer.opacity = 0.5; attachedLayer.blend = 'screen'; }
      inkSyncDom();
      const styled = {
        tileOpacity: tile ? tile.canvas.style.opacity : '',
        tileBlend: tile ? tile.canvas.style.mixBlendMode : '',
        canvasOpacity: aCanvas ? aCanvas.style.opacity : '',
        canvasBlend: aCanvas ? aCanvas.style.mixBlendMode : '',
      };

      globalLayer.visible = false;
      if (attachedLayer) attachedLayer.visible = false;
      inkSyncDom();
      const hidden = {
        tile: tile ? tile.canvas.style.display : '',
        canvas: aCanvas ? aCanvas.style.display : '',
      };

      globalLayer.visible = true; globalLayer.opacity = 1; globalLayer.blend = 'normal';
      if (attachedLayer) { attachedLayer.visible = true; attachedLayer.opacity = 1; attachedLayer.blend = 'normal'; }
      inkSyncDom();
      return JSON.stringify({ styled, hidden, restored: tile ? tile.canvas.style.display : '' });
    })()`));
    check('katman opaklığı ve karışımı uygulandı',
      layerCtl.styled.tileOpacity === '0.4' && layerCtl.styled.tileBlend === 'multiply' &&
      layerCtl.styled.canvasOpacity === '0.5' && layerCtl.styled.canvasBlend === 'screen',
      `${layerCtl.styled.tileOpacity}/${layerCtl.styled.tileBlend} · ${layerCtl.styled.canvasOpacity}/${layerCtl.styled.canvasBlend}`);
    check('gizlenen katman DOM tuvali kapanıyor',
      layerCtl.hidden.tile === 'none' && layerCtl.hidden.canvas === 'none' && layerCtl.restored === 'block',
      `karo ${layerCtl.hidden.tile} · tuval ${layerCtl.hidden.canvas}`);

    const layerPreview = JSON.parse(await evaluate(ws, `(() => {
      const owner = state.items.find(i => i.kind === 'image');
      const layer = owner ? inkLayersForOwner(owner.id)[0] : null;
      const blend = document.getElementById('inkLayerBlend');
      const opacity = document.getElementById('inkLayerOpacity');
      if (!layer || !blend || !opacity) return JSON.stringify({ available: false });

      const oldActiveId = state.ink.activeLayerId;
      const oldBlend = layer.blend;
      const oldOpacity = layer.opacity;
      const originalInvalidate = window.inkEditorInvalidate;
      let invalidations = 0;
      inkDocSelectLayer(layer.id);
      window.inkEditorInvalidate = function () {
        invalidations++;
        return originalInvalidate.apply(this, arguments);
      };
      blend.value = 'multiply';
      blend.dispatchEvent(new Event('change', { bubbles: true }));
      opacity.value = '35';
      opacity.dispatchEvent(new Event('input', { bubbles: true }));
      const canvas = inkRuntime.itemCanvases.get(layer.id);
      const result = {
        available: true,
        blend: layer.blend,
        opacity: layer.opacity,
        invalidations,
        canvasBlend: canvas ? canvas.style.mixBlendMode : '',
      };
      window.inkEditorInvalidate = originalInvalidate;
      layer.blend = oldBlend;
      layer.opacity = oldOpacity;
      inkLayerRefreshPreview();
      inkDocSelectLayer(oldActiveId);
      return JSON.stringify(result);
    })()`));
    check('katman opaklığı ve karışımı değişince editör anında yenileniyor',
      layerPreview.available && layerPreview.blend === 'multiply' &&
      layerPreview.opacity === 0.35 && layerPreview.invalidations >= 2 &&
      layerPreview.canvasBlend === 'multiply',
      `blend=${layerPreview.blend} opacity=${layerPreview.opacity} ` +
      `yenileme=${layerPreview.invalidations} canvas=${layerPreview.canvasBlend}`);

    // ---------------------------------------------------------------
    // 5c) Pano değişimi çizimi koruyor
    // ---------------------------------------------------------------
    const beforeProject = JSON.parse(await evaluate(ws, `JSON.stringify({
      id: workspaceManager.activeId,
      layers: state.ink.layers.length,
      strokes: state.ink.layers.reduce((n, l) => n + l.strokes.length, 0),
    })`));
    const projectSwitch = JSON.parse(await evaluate(ws, `(async () => {
      const oldId = workspaceManager.activeId;
      const created = await workspaceManager.createProject('Ink Smoke');
      const freshLayers = state.ink ? state.ink.layers.length : -1;
      const freshStrokes = state.ink ? state.ink.layers.reduce((n, l) => n + l.strokes.length, 0) : -1;
      await workspaceManager.switchTo(oldId);
      return JSON.stringify({
        created: !!created,
        freshLayers, freshStrokes,
        backLayers: state.ink ? state.ink.layers.length : -1,
        backStrokes: state.ink ? state.ink.layers.reduce((n, l) => n + l.strokes.length, 0) : -1,
      });
    })()`));
    check('yeni pano boş çizim durumuyla açıldı',
      projectSwitch.created && projectSwitch.freshLayers === 0 && projectSwitch.freshStrokes === 0,
      `${projectSwitch.freshLayers} katman · ${projectSwitch.freshStrokes} vuruş`);
    check('pano değişiminden dönünce çizim korunuyor',
      projectSwitch.backLayers === beforeProject.layers && projectSwitch.backStrokes === beforeProject.strokes,
      `${beforeProject.layers}/${beforeProject.strokes} → ${projectSwitch.backLayers}/${projectSwitch.backStrokes}`);

    // ---------------------------------------------------------------
    // 5d) Görsel çoğaltma / silme ve bağlı katmanlar
    // ---------------------------------------------------------------
    const dupInfo = JSON.parse(await evaluate(ws, `(() => {
      const it = state.items.find(i => i.kind === 'image');
      selection = new Set([it.id]); syncSelection();
      const before = new Set(state.items.map(i => i.id));
      duplicateSelection();
      const copy = state.items.find(i => i.kind === 'image' && !before.has(i.id));
      const srcLayers = inkLayersForOwner(it.id);
      const dstLayers = copy ? inkLayersForOwner(copy.id) : [];
      const srcIds = srcLayers.flatMap(l => l.strokes.map(s => s.id));
      const dstIds = dstLayers.flatMap(l => l.strokes.map(s => s.id));
      const canvas = dstLayers[0] ? inkRuntime.itemCanvases.get(dstLayers[0].id) : null;
      return JSON.stringify({
        copyId: copy ? copy.id : '',
        srcStrokes: srcLayers.reduce((n, l) => n + l.strokes.length, 0),
        dstStrokes: dstLayers.reduce((n, l) => n + l.strokes.length, 0),
        dstLayers: dstLayers.length,
        hasCanvas: !!(canvas && canvas.closest('.item')),
        uniqueIds: dstIds.length > 0 && dstIds.every(id => !srcIds.includes(id)),
      });
    })()`));
    check('görsel çoğaltılınca çizim de kopyalandı',
      dupInfo.dstLayers === 1 && dupInfo.dstStrokes === dupInfo.srcStrokes && dupInfo.dstStrokes > 0,
      `${dupInfo.dstStrokes}/${dupInfo.srcStrokes} vuruş`);
    check('kopya katmanın kendi tuvali ve kimlikleri var',
      dupInfo.hasCanvas && dupInfo.uniqueIds, '');

    if (dupInfo.copyId) {
      const removeInfo = JSON.parse(await evaluate(ws, `(() => {
        const copy = getItem(${JSON.stringify(dupInfo.copyId)});
        const layers = inkLayersForOwner(copy.id);
        const canvas = layers[0] ? inkRuntime.itemCanvases.get(layers[0].id) : null;
        const beforeInDom = !!(canvas && canvas.isConnected);
        removeItems([copy.id]);
        return JSON.stringify({
          beforeInDom,
          canvasGone: !(canvas && canvas.isConnected),
          runtimeGone: !inkRuntime.itemCanvases.has(layers[0] ? layers[0].id : ''),
          layersKept: inkLayersForOwner(copy.id).length,
          itemGone: !getItem(copy.id),
        });
      })()`));
      check('görsel silinince bağlı tuval DOM\'dan kalktı',
        removeInfo.beforeInDom && removeInfo.canvasGone && removeInfo.runtimeGone && removeInfo.itemGone,
        '');
      check('çöp kutusu geri getirmesi için vuruş verisi korundu',
        removeInfo.layersKept >= 1, `${removeInfo.layersKept} katman`);
    }

    // Kalıcı çöp temizliği öksüz katmanları siler, kalanlara dokunmaz.
    const pruneInfo = JSON.parse(await evaluate(ws, `(() => {
      const trashIds = new Set(state.trash.map(e => e.item.id));
      const orphanIds = [...trashIds];
      const beforeLayers = state.ink.layers.length;
      const beforeOrphans = state.ink.layers.filter(l => l.kind === 'attached' && trashIds.has(l.ownerId)).length;
      const keepStrokes = state.ink.layers
        .filter(l => !(l.kind === 'attached' && trashIds.has(l.ownerId)))
        .reduce((n, l) => n + l.strokes.length, 0);
      state.trash.forEach(entry => { entry.expiresAt = 0; });
      purgeExpiredTrash({ render: false });
      const survivors = state.ink.layers
        .filter(l => !(l.kind === 'attached' && trashIds.has(l.ownerId)))
        .reduce((n, l) => n + l.strokes.length, 0);
      return JSON.stringify({
        orphans: beforeOrphans,
        beforeLayers,
        afterLayers: state.ink.layers.length,
        stillOrphan: state.ink.layers.some(l => l.kind === 'attached' && trashIds.has(l.ownerId)),
        keepStrokes, survivors,
        activeAlive: state.ink.layers.some(l => l.id === state.ink.activeLayerId),
        orphanIds,
      });
    })()`));
    check('kalıcı çöp temizliği bağlı katmanları siliyor',
      pruneInfo.orphans >= 1 && !pruneInfo.stillOrphan && pruneInfo.afterLayers === pruneInfo.beforeLayers - pruneInfo.orphans,
      `${pruneInfo.beforeLayers} → ${pruneInfo.afterLayers} katman`);
    check('çöp temizliği diğer çizimleri koruyor',
      pruneInfo.keepStrokes === pruneInfo.survivors && pruneInfo.activeAlive,
      `${pruneInfo.survivors}/${pruneInfo.keepStrokes} vuruş`);

    // ---------------------------------------------------------------
    // 5e) PNG dışa aktarma çizimi birleştiriyor
    // ---------------------------------------------------------------
    await evaluate(ws, `(() => {
      window.__inkExportCap = null;
      if (!window.__inkOrigToBlob) {
        window.__inkOrigToBlob = HTMLCanvasElement.prototype.toBlob;
        window.__inkOrigClick = HTMLAnchorElement.prototype.click;
        HTMLCanvasElement.prototype.toBlob = function (cb, type, q) {
          window.__inkExportCap = this;
          return window.__inkOrigToBlob.call(this, cb, type, q);
        };
        HTMLAnchorElement.prototype.click = function () { /* indirmeyi engelle */ };
      }
      selection.clear(); syncSelection();
      return true;
    })()`);
    /* Export içeriğini öngörülebilir yapmak için taze bir sarı vuruş çiz:
       üst düzlem global katmanına fırça bandı (testin önceki bölümlerinin
       tablo durumuna bağımlılığı kaldırıldı). */
    await evaluate(ws, `(() => {
      const ink = inkState();
      let above = ink.layers.find(l => l.kind === 'global' && l.plane === 'above');
      if (!above) above = inkAddLayer({ kind: 'global', plane: 'above', name: 'Notlar' });
      ink.activeLayerId = above.id;
      inkSetTool('brush');
      ink.size = 24;
      ink.color = '#ffd166';
      return above.id;
    })()`);
    await evaluate(ws, 'window.__inkPenLine(300, 380, 620, 380, 30)');
    await sleep(400);
    await evaluate(ws, 'exportPNG().then(() => true)');
    await sleep(300);
    const exportInfo = JSON.parse(await evaluate(ws, `(() => {
      const c = window.__inkExportCap;
      if (!c) return JSON.stringify({ ok: false });
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let yellow = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 230 && d[i + 1] > 170 && d[i + 2] < 150 && d[i + 3] > 8) yellow += 1;
      }
      return JSON.stringify({ ok: true, w: c.width, h: c.height, yellow });
    })()`));
    check('PNG dışa aktarımı global çizimi birleştirdi',
      exportInfo.ok && exportInfo.yellow > 20,
      `${exportInfo.w}×${exportInfo.h} · ${exportInfo.yellow}px`);

    // ---------------------------------------------------------------
    // 5e-2) Seçim paneli "Dışa Aktar" görünen sonucu düzleştiriyor
    //      (beyaz tuval + çizim = boş sayfa değil)
    // ---------------------------------------------------------------
    const itemExport = JSON.parse(await evaluate(ws, `(async () => {
      const surface = document.createElement('canvas');
      surface.width = 160;
      surface.height = 120;
      const sctx = surface.getContext('2d');
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(0, 0, 160, 120);
      const blob = await new Promise(r => surface.toBlob(r, 'image/png'));
      const imageId = 'img_panel_export_test';
      await idbPut('images', imageId, { blob, name: 'panel-export.png' });
      const entry = await decodeImage(blob);
      setImgCache(imageId, { img: entry.img, url: entry.url, name: 'panel-export.png' });
      const it = {
        id: 'it_panel_export_test', kind: 'image', imageId, title: 'panel-export',
        x: 0, y: 0, w: 160, h: 120, rot: 0, z: nextZ(),
      };
      state.items.push(it);
      const beforeInk = imageItemNeedsComposite(it);
      const layer = inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'Katman 1', pxW: 160, pxH: 120 });
      layer.strokes.push(inkNormalizeStroke({
        id: 'panel-export-stroke', kind: 'stroke', tool: 'brush',
        color: '#000000', opacity: 1, size: 0.09, hardness: 1,
        spacing: 0.05, brushId: 'ink-hard',
        points: [
          { x: 0.15, y: 0.5, p: 1 },
          { x: 0.5, y: 0.5, p: 1 },
          { x: 0.85, y: 0.5, p: 1 },
        ],
      }));
      /* Öğenin DOM'u olmadan da katman rasterını üret (gerçek akışta
         inkRebuildItemLayer aynı işi yapar). */
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = 160;
      layerCanvas.height = 120;
      inkDrawStrokeOnContext(layerCanvas.getContext('2d'), layer.strokes[0], {
        mapPoint: p => ({ x: p.x * layerCanvas.width, y: p.y * layerCanvas.height }),
        sizePx: Math.max(0.5, layer.strokes[0].size * layerCanvas.width),
        pointScale: { x: layerCanvas.width, y: layerCanvas.height },
      });
      inkRuntime.itemCanvases.set(layer.id, layerCanvas);
      const afterInk = imageItemNeedsComposite(it);
      const canvas = renderImageItemForExport(it);
      const out = { beforeInk, afterInk, hasCanvas: !!canvas };
      if (canvas) {
        out.w = canvas.width;
        out.h = canvas.height;
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let white = 0, dark = 0, transparent = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 8) transparent += 1;
          else if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white += 1;
          else if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) dark += 1;
        }
        out.white = white;
        out.dark = dark;
        out.transparent = transparent;
      }
      /* Kırpma görünür alanı daraltmalı: %20 + %20 → genişliğin %60'ı. */
      it.cropLeft = 20;
      it.cropRight = 20;
      const cropped = renderImageItemForExport(it);
      out.cropW = cropped ? cropped.width : 0;
      it.cropLeft = 0;
      it.cropRight = 0;
      /* 90° döndürme: genişlik/yükseklik yer değiştirmeli. */
      it.rot = 90;
      const rotated90 = renderImageItemForExport(it);
      out.rotW = rotated90 ? rotated90.width : 0;
      out.rotH = rotated90 ? rotated90.height : 0;
      it.rot = 0;
      state.items = state.items.filter(x => x.id !== it.id);
      inkRemoveLayer(layer.id);
      inkRuntime.itemCanvases.delete(layer.id);
      layerCanvas.width = 0;
      layerCanvas.height = 0;
      selection.clear();
      syncSelection();
      return JSON.stringify(out);
    })()`, 60000));
    check('seçim paneli dışa aktarımı çizimi birleştirdi',
      itemExport.beforeInk === false && itemExport.afterInk === true &&
      itemExport.hasCanvas === true && itemExport.dark > 100 &&
      itemExport.white > 1000 && itemExport.transparent === 0 &&
      Math.abs(itemExport.cropW - Math.round(itemExport.w * 0.6)) <= 1 &&
      itemExport.rotW === itemExport.h && itemExport.rotH === itemExport.w,
      `katman=${itemExport.beforeInk}→${itemExport.afterInk} · ${itemExport.w}×${itemExport.h} · ` +
      `beyaz=${itemExport.white} koyu=${itemExport.dark} saydam=${itemExport.transparent} · ` +
      `kırpma=${itemExport.cropW}px · döndürme=${itemExport.rotW}×${itemExport.rotH}`);

    // ---------------------------------------------------------------
    // 5f) Dönüştürme aracı normal öğe seçimini engellemiyor
    // ---------------------------------------------------------------
    const itemClick = JSON.parse(await evaluate(ws, `(() => {
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      const r = el.getBoundingClientRect();
      // Öğe içinde ama aktif katman vuruşunun bulunmadığı nokta: üst katman
      // önceki bölümde çizildi; merkez tıklama ink-vuruş seçimini tetikler
      // ve tahta seçimine akış engellenir. Test niyeti boş noktadır.
      const above = state.ink.layers.find(l => l.kind === 'global' && l.plane === 'above');
      const blank = (() => {
        for (let gy = 1; gy < 8; gy++) {
          for (let gx = 1; gx < 8; gx++) {
            const px = r.left + r.width * gx / 8;
            const py = r.top + r.height * gy / 8;
            const w = screenToWorld({ x: px, y: py });
            if (!inkStrokeHit(above, w)) return { x: px, y: py };
          }
        }
        return null;
      })();
      const x = Math.round(blank ? blank.x : r.left + r.width / 2);
      const y = Math.round(blank ? blank.y : r.top + r.height / 2);
      inkSetActiveLayer(above.id);
      inkSetTool('transform');
      selection.clear(); selectionOrder = []; syncSelection();
      const before = state.ink.layers.reduce((n, l) => n + l.strokes.length, 0);
      const target = document.elementFromPoint(x, y) || el;
      const pid = 9100;
      const mk = type => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: pid, pointerType: 'mouse', isPrimary: true,
        pressure: 0.5, clientX: x, clientY: y,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      });
      target.dispatchEvent(mk('pointerdown'));
      window.dispatchEvent(mk('pointerup'));
      return JSON.stringify({
        selected: selection.has(it.id),
        before,
        after: state.ink.layers.reduce((n, l) => n + l.strokes.length, 0),
        tool: state.ink.tool,
        editingId: typeof editingId !== 'undefined' ? (editingId || '') : '(yok)',
        pending: typeof pendingMove !== 'undefined' ? !!pendingMove : null,
        dragging: typeof drag !== 'undefined' ? (drag ? drag.mode : '') : null,
        spaceDown: typeof spaceDown !== 'undefined' ? !!spaceDown : null,
        hit: target === el ? 'image'
          : (target && (target.id || target.className || target.tagName) || '?'),
        hitRect: target && (() => { const rr = target.getBoundingClientRect();
          return [rr.left, rr.top, rr.width, rr.height].map(v => Math.round(v)); })(),
      });
    })()`));
    check('dönüştürme aracı görsel seçimini engellemiyor',
      itemClick.tool === 'transform' && itemClick.selected === true && itemClick.after === itemClick.before,
      `seçili=${itemClick.selected} · vuruş ${itemClick.before}→${itemClick.after}` +
      ` · hedef=${itemClick.hit} ${JSON.stringify(itemClick.hitRect)} · editingId=${itemClick.editingId}` +
      ` · pending=${itemClick.pending} · dragging=${itemClick.dragging} · spaceDown=${itemClick.spaceDown}`);

    // Fırça tıklaması yalnızca çizim yapmalı; alttaki öğe seçimi değişmemeli.
    const brushClick = JSON.parse(await evaluate(ws, `(() => {
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const attached = inkLayersForOwner(it.id)[0];
      inkSetActiveLayer(attached.id);
      inkSetTool('brush');
      selection.clear(); selectionOrder = []; syncSelection();
      const before = state.ink.layers.reduce((n, l) => n + l.strokes.length, 0);
      const target = document.elementFromPoint(x, y) || el;
      const pid = 9200;
      const mk = type => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: pid, pointerType: 'pen', isPrimary: true,
        pressure: 0.8, clientX: x, clientY: y,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      });
      target.dispatchEvent(mk('pointerdown'));
      window.dispatchEvent(mk('pointerup'));
      return JSON.stringify({
        selected: selection.has(it.id),
        before,
        after: state.ink.layers.reduce((n, l) => n + l.strokes.length, 0),
      });
    })()`));
    check('fırça tıklaması öğe seçimini değiştirmiyor',
      brushClick.selected === false && brushClick.after === brushClick.before + 1,
      `seçili=${brushClick.selected} · vuruş ${brushClick.before}→${brushClick.after}`);

    // ---------------------------------------------------------------
    // 6) Sentetik .abr ayrıştırma (v6, samp, ham 8-bit)
    // ---------------------------------------------------------------
    const abr = JSON.parse(await evaluate(ws, `(() => {
      const w = 8, h = 8;
      const entry = new Uint8Array(47 + 19 + w * h);
      const edv = new DataView(entry.buffer);
      edv.setInt32(47, 0);
      edv.setInt32(51, 0);
      edv.setInt32(55, h);
      edv.setInt32(59, w);
      edv.setUint16(63, 8);
      entry[65] = 0;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) entry[66 + y * w + x] = (x + y) * 16;
      }
      const samp = new Uint8Array(4 + entry.length);
      new DataView(samp.buffer).setUint32(0, entry.length);
      samp.set(entry, 4);
      const out = new Uint8Array(16 + samp.length);
      const odv = new DataView(out.buffer);
      odv.setUint16(0, 6);
      odv.setUint16(2, 1);
      out.set([0x38, 0x42, 0x49, 0x4d], 4);
      out.set([0x73, 0x61, 0x6d, 0x70], 8);
      odv.setUint32(12, samp.length);
      out.set(samp, 16);
      const tips = inkParseAbr(out.buffer);
      return JSON.stringify({
        count: tips.length,
        w: tips[0] ? tips[0].width : 0,
        h: tips[0] ? tips[0].height : 0,
        isPng: !!(tips[0] && tips[0].dataUrl.startsWith('data:image/png;base64,')),
      });
    })()`));
    check('.abr v6 samp bloğu ayrıştırıldı', abr.count === 1 && abr.w === 8 && abr.h === 8, `${abr.count} uç · ${abr.w}×${abr.h}`);
    check('.abr ucu PNG verisine çevrildi', abr.isPng, '');

    // ---------------------------------------------------------------
    // 6b) Gerçek referans uygulama v6.2 biçimi: hizalı girişler, tek PackBits
    //     akışı (satır tablosu yok), `samp` bloğu `desc`'ten ÖNCE.
    //     01.ABR bu sırayla geldiği için "Uç bulunamadı" veriyordu.
    // ---------------------------------------------------------------
    const abrReal = JSON.parse(await evaluate(ws, `(() => {
      const packBits = arr => {
        const out = [];
        for (let i = 0; i < arr.length; i += 128) {
          const chunk = arr.slice(i, i + 128);
          out.push(chunk.length - 1, ...chunk);
        }
        return out;
      };
      const makeEntry = (w, h) => {
        const pixels = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.push(((x + y) % 4) * 60 + 1);
        const stream = packBits(pixels);
        const entry = new Uint8Array(301 + 19 + stream.length);
        const edv = new DataView(entry.buffer);
        edv.setInt32(301, 0);
        edv.setInt32(305, 0);
        edv.setInt32(309, h);
        edv.setInt32(313, w);
        edv.setUint16(317, 8);
        entry[319] = 1;
        entry.set(stream, 320);
        return entry;
      };
      const pad4 = n => (n + 3) & ~3;
      const entries = [makeEntry(4, 4), makeEntry(8, 8)];
      const sampBytes = [];
      for (const entry of entries) {
        const head = new Uint8Array(4);
        new DataView(head.buffer).setUint32(0, entry.length);
        sampBytes.push(...head, ...entry);
        while (sampBytes.length % 4) sampBytes.push(0);
      }
      const blocks = [];
      const block = (key, data) => {
        const head = new Uint8Array(12);
        head.set([0x38, 0x42, 0x49, 0x4d], 0);
        head.set([key.charCodeAt(0), key.charCodeAt(1), key.charCodeAt(2), key.charCodeAt(3)], 4);
        new DataView(head.buffer).setUint32(8, data.length);
        blocks.push(...head, ...data);
        while (blocks.length % 4) blocks.push(0);
      };
      block('samp', new Uint8Array(sampBytes));
      const descHead = new Uint8Array(4);
      new DataView(descHead.buffer).setUint32(0, 3);
      block('desc', descHead);
      block('phry', new Uint8Array(0));
      const out = new Uint8Array(4 + blocks.length);
      const odv = new DataView(out.buffer);
      odv.setUint16(0, 6);
      odv.setUint16(2, 2);
      out.set(blocks, 4);
      const tips = inkParseAbr(out.buffer);
      return JSON.stringify({
        count: tips.length,
        dims: tips.map(t => t.width + 'x' + t.height),
        png: tips.every(t => (t.dataUrl || '').startsWith('data:image/png;base64,')),
        err: inkRuntime.lastAbrError || '',
      });
    })()`));
    check('.abr v6.2 hizalı girişler + tek PackBits akışı',
      abrReal.count === 2 && abrReal.dims[0] === '4x4' && abrReal.dims[1] === '8x8' && abrReal.png,
      `${abrReal.count} uç · ${abrReal.dims.join(' / ')}${abrReal.err ? ' · hata: ' + abrReal.err : ''}`);
    check('.abr samp→desc sırasında uçlar korunuyor',
      abrReal.count === 2 && !abrReal.err, abrReal.err ? abrReal.err : 'samp önce, desc sonra');

    // ---------------------------------------------------------------
    // 7) Anlık görüntü çizimi taşıyor
    // ---------------------------------------------------------------
    const snapInfo = JSON.parse(await evaluate(ws, `(() => {
      const snap = createStateSnapshot();
      return JSON.stringify({
        hasInk: !!snap.ink,
        layers: snap.ink ? snap.ink.layers.length : 0,
        strokes: snap.ink ? snap.ink.layers.reduce((n, l) => n + l.strokes.length, 0) : 0,
      });
    })()`));
    check('geri al anlık görüntüsü çizimi içeriyor', snapInfo.hasInk && snapInfo.layers >= 3 && snapInfo.strokes >= 3, `${snapInfo.layers} katman · ${snapInfo.strokes} vuruş`);

    // ---------------------------------------------------------------
    // 8) Acil UX: araç çubuğu, renk çarkı, sağ tık, odak, kilit
    // ---------------------------------------------------------------
    const ui = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const vis = el => !!el && !el.hidden && getComputedStyle(el).visibility !== 'hidden';
      // Çizim kabuğu (v5) yalnızca çizim modunda kurulur; panel ve renk
      // çarkı kontrolleri gerçek kullanıcı akışındaki gibi bu modda sınanır.
      if (!document.body.classList.contains('mode-draw')) {
        const imageItem = state.items.find(i => i.kind === 'image');
        if (imageItem && typeof modeEnterDraw === 'function') modeEnterDraw(imageItem.id);
        await wait(900);
      }
      const brushPanel = document.getElementById('inkBrushPanel');
      const layersPanel = document.getElementById('inkLayersPanel');
      const v5Brush = document.querySelector('.v5-panel--brush');
      const v5BrushButtons = v5Brush ? [...v5Brush.querySelectorAll('.v5-head-extra')] : [];
      const collapse = v5BrushButtons.find(b => /collapse|katla|daralt/i.test(b.title || '')) || null;
      const v5Close = v5BrushButtons.find(b => /close|kapat/i.test(b.title || '')) || null;
      const actionCount = document.querySelectorAll('#inkToolbox [data-ink-action]').length;
      const layersCloseGone = !document.getElementById('btnInkLayersClose');
      const brushCloseGone = !document.getElementById('btnInkBrushClose');
      const collapseExists = !!collapse;
      const v5CloseExists = !!v5Close;
      const stripGone = !document.getElementById('inkBrushStrip');
      const layersPermanent = !!layersPanel && !layersPanel.querySelector('.inkPanelHead button');

      // Katman paneli açık kalır; Esc yalnızca geçici fırça panelini kapatır.
      brushPanel.hidden = false;
      layersPanel.hidden = false;
      stage.focus();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(260);
      const escBrushClosed = !vis(brushPanel);
      const escLayersOpen = vis(layersPanel);

      const well = document.getElementById('inkColorWell');
      well.click();
      await wait(320);
      const wheelEl = document.getElementById('inkColorWheel');
      const wheelOpen = vis(wheelEl);
      const canvas = document.getElementById('inkWheelCanvas');
      const cr = canvas.getBoundingClientRect();
      const cx = cr.left + cr.width / 2;
      const cy = cr.top + cr.height / 2;
      const ptr = (type, x, y, id) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id || 91, pointerType: 'pen', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: x, clientY: y,
      }));

      // Halka: 120° (yeşil) yönüne bas.
      const beforeColor = state.ink.color;
      const hr = cr.width * 0.43;
      const ringA = 120 * Math.PI / 180;
      ptr('pointerdown', cx + Math.cos(ringA) * hr, cy + Math.sin(ringA) * hr);
      await wait(120);
      const colorChanged = state.ink.color !== beforeColor;
      const hueAfterRing = inkHexToWheelState(state.ink.color).h;

      // Üçgen: merkezde s≈1/3, v≈2/3; sonra beyaza doğru sürükle.
      ptr('pointerup', cx + Math.cos(ringA) * hr, cy + Math.sin(ringA) * hr);
      ptr('pointerdown', cx, cy, 92);
      await wait(120);
      const centerSv = inkHexToWheelState(state.ink.color);
      ptr('pointermove', cx - cr.width * 0.08, cy - cr.height * 0.1, 92);
      await wait(120);
      const draggedSv = inkHexToWheelState(state.ink.color);
      ptr('pointerup', cx - cr.width * 0.08, cy - cr.height * 0.1, 92);

      // HEX girişi.
      const hexInput = document.getElementById('inkWheelHexInput');
      hexInput.value = '#3366CC';
      hexInput.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(120);
      const hexApplied = state.ink.color === '#3366cc';

      // RGB kaydırıcıları (pro seçici: Sliders modu, RGB boşluğu).
      // Eski inkWheelR/G/B girişleri pro seçiciyle kaydırıcı moduna taşındı.
      const cpMenu = document.getElementById('inkCpModeMenu');
      const cpModeBtn = document.getElementById('inkCpModeBtn');
      const cpPickMode = mode => {
        if (cpMenu.hidden) cpModeBtn.click();
        cpMenu.querySelector('button[data-mode="' + mode + '"]').click();
      };
      cpPickMode('sliders');
      document.querySelector('#inkCpSpaceSeg button[data-space="rgb"]').click();
      const cpRow = ch =>
        document.querySelector('#inkCpSliders .inkCpSliderRow[data-ch="' + ch + '"]');
      const rgbSet = (ch, v) => {
        const range = cpRow(ch).querySelector('input[type=range]');
        range.value = String(v);
        range.dispatchEvent(new Event('input', { bubbles: true }));
      };
      rgbSet('r', 255);
      rgbSet('g', 0);
      rgbSet('bl', 0);
      cpRow('r').querySelector('input[type=range]')
        .dispatchEvent(new Event('change', { bubbles: true }));
      await wait(120);
      const rgbApplied = state.ink.color === '#ff0000';
      const hexSynced = hexInput.value === '#FF0000';
      // Eski duruma dön: HSB boşluğu + üçgen modu.
      document.querySelector('#inkCpSpaceSeg button[data-space="hsb"]').click();
      cpPickMode('triangle');

      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 93 }));
      await wait(260);
      // Çizim kabuğunda çark sağdaki renk kartının kalıcı parçasıdır;
      // dışarı tıklama onu kapatmaz.
      const wheelStaysInline = vis(wheelEl);

      // Flyout: araç kutusunun sağında açılmalı, kırpılmamalı, tekrar
      // tıklamada kapanmalı.
      const flyTrigger = document.querySelector('#inkToolbox [data-ink-flyout]');
      let flyoutOpen = false, flyoutItems = 0, flyoutRight = false, flyoutHit = false, flyoutClosed = false;
      if (flyTrigger) {
        flyTrigger.click();
        await wait(260);
        const fly = document.getElementById('inkFlyout');
        const boxR = document.getElementById('inkToolbox').getBoundingClientRect();
        const flyR = fly ? fly.getBoundingClientRect() : null;
        flyoutOpen = !!fly && vis(fly) && flyR.width > 40;
        flyoutItems = fly ? fly.querySelectorAll('.inkFlyoutItem').length : 0;
        flyoutRight = !!flyR && flyR.left >= boxR.right;
        if (flyR) {
          const hit = document.elementFromPoint(flyR.left + flyR.width / 2, flyR.top + 12);
          flyoutHit = !!hit && !!hit.closest('#inkFlyout');
        }
        flyTrigger.click();
        await wait(260);
        flyoutClosed = !document.getElementById('inkFlyout');
      }

      // Bağlam menüsü referans modunda sınanır; çizim girişi tek noktadan
      // (üst mod düğmesi) yapılır, menüde ikinci bir giriş tutulmaz.
      if (typeof modeExitDraw === 'function') modeExitDraw();
      await wait(500);
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
      }));
      await wait(240);
      const menu = document.getElementById('contextMenu');
      const imageMenuItems = [...menu.querySelectorAll('.menuItem')];
      const imageDrawEntry = imageMenuItems.find(b => /Çizim Yap/i.test(b.textContent));
      hideContextMenu();
      await wait(220);
      stage.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 12, clientY: innerHeight - 12,
      }));
      await wait(240);
      const emptyMenuItems = [...menu.querySelectorAll('.menuItem')];
      const emptyDrawEntry = emptyMenuItems.find(b => /Çizim Yap/i.test(b.textContent));
      hideContextMenu();
      const drawEntryGone = !imageDrawEntry && !emptyDrawEntry &&
        imageMenuItems.length > 0 && emptyMenuItems.length > 0;

      return JSON.stringify({
        actionCount, layersCloseGone, brushCloseGone, collapseExists, v5CloseExists, stripGone,
        layersPermanent, escBrushClosed, escLayersOpen,
        wheelOpen, colorChanged, wheelStaysInline, drawEntryGone,
        imageMenuItems: imageMenuItems.length, emptyMenuItems: emptyMenuItems.length,
        hueAfterRing, centerSv, draggedSv, hexApplied, rgbApplied, hexSynced,
        flyoutOpen, flyoutItems, flyoutRight, flyoutHit, flyoutClosed,
      });
    })()`));

    check('araç çubuğunda gereksiz panel düğmeleri kaldırıldı',
      ui.actionCount === 0, `${ui.actionCount} düğme`);
    check('katman paneli kalıcı ve kapatma düğmesi yok',
      ui.layersCloseGone && ui.layersPermanent, '');
    check('fırça paneli v5 katlama ve kapatma düğmeleriyle yönetiliyor',
      ui.brushCloseGone && ui.collapseExists && ui.v5CloseExists, '');
    check('alt fırça şeridi kaldırıldı', ui.stripGone, '');
    check('Esc fırça panelini kapatıyor, katman paneli açık kalıyor',
      ui.escBrushClosed && ui.escLayersOpen,
      `fırçaKapalı=${ui.escBrushClosed} katmanAçık=${ui.escLayersOpen}`);
    check('renk çarkı açılıyor', ui.wheelOpen, '');
    check('renk çarkı rengi değiştiriyor', ui.colorChanged, '');
    check('halka tıklaması tonu seçiyor',
      Math.abs(ui.hueAfterRing - 120) < 3, `ton ${ui.hueAfterRing.toFixed(1)}°`);
    check('üçgen tıklaması doygunluk/parlaklık veriyor',
      ui.centerSv.s > 0.25 && ui.centerSv.s < 0.42 &&
      ui.centerSv.v > 0.58 && ui.centerSv.v < 0.75,
      `s ${ui.centerSv.s.toFixed(2)} · v ${ui.centerSv.v.toFixed(2)}`);
    check('üçgen sürüklemesi doygunluğu düşürüyor',
      ui.draggedSv.s < ui.centerSv.s - 0.03 && ui.draggedSv.v > ui.centerSv.v,
      `s ${ui.centerSv.s.toFixed(2)}→${ui.draggedSv.s.toFixed(2)} · ` +
      `v ${ui.centerSv.v.toFixed(2)}→${ui.draggedSv.v.toFixed(2)}`);
    check('HEX girişi rengi uyguluyor', ui.hexApplied, '');
    check('RGB girişi rengi uyguluyor', ui.rgbApplied, '');
    check('RGB girişi HEX alanını eşitliyor', ui.hexSynced, '');
    check('renk çarkı çizim kabuğunda kalıcı, dışarı tıklamada kapanmıyor', ui.wheelStaysInline, '');
    check('araç çubuğu flyout açılıyor', ui.flyoutOpen && ui.flyoutItems > 1, `${ui.flyoutItems} alt araç`);
    check('flyout araç kutusunun sağında ve kırpılmıyor', ui.flyoutRight && ui.flyoutHit, `sağ=${ui.flyoutRight} tıklanabilir=${ui.flyoutHit}`);
    check('flyout tekrar tıklamada kapanıyor', ui.flyoutClosed, '');
    check('bağlam menüsünde ikinci çizim girişi yok',
      ui.drawEntryGone, `görsel=${ui.imageMenuItems} öğe · boş=${ui.emptyMenuItems} öğe`);

    const panelScale = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const v5Brush = document.querySelector('.v5-panel--brush');
      const v5Layers = document.querySelector('.v5-panel--layers');
      const v5BrushButtons = v5Brush ? [...v5Brush.querySelectorAll('.v5-head-extra')] : [];
      const collapse = v5BrushButtons.find(b => /collapse|katla|daralt/i.test(b.title || '')) || null;
      const panelVisible = el => !!el && getComputedStyle(el).display !== 'none' &&
        !el.classList.contains('is-collapsed');
      if (!document.body.classList.contains('mode-draw')) {
        const item = state.items.find(i => i.kind === 'image');
        if (item && typeof modeEnterDraw === 'function') modeEnterDraw(item.id);
        await wait(700);
      }
      if (collapse && v5Brush.classList.contains('is-collapsed')) {
        collapse.click();
        await wait(320);
      }
      const toolbar = document.getElementById('v5Toolbar');
      const smudgeButton = toolbar && toolbar.querySelector('[data-tool="smudge"]');
      const gradientButton = toolbar && toolbar.querySelector('[data-tool="gradient"]');
      const oldTool = inkState().tool;
      const toolbarTools = { buttonsExist: !!smudgeButton && !!gradientButton };
      if (smudgeButton && gradientButton) {
        smudgeButton.click();
        toolbarTools.smudgeSelects = inkState().tool === 'smudge' &&
          smudgeButton.getAttribute('aria-pressed') === 'true';
        toolbarTools.smudgeFlowDefault = inkState().toolSettings.smudge.flow === 0.32;
        gradientButton.click();
        toolbarTools.gradientSelects = inkState().tool === 'gradient' &&
          gradientButton.getAttribute('aria-pressed') === 'true';
        const restoreButton = toolbar.querySelector('[data-tool="' + oldTool + '"]');
        if (restoreButton) restoreButton.click();
        else inkSetTool(oldTool);
      }
      const panelState = {
        brushOpen: panelVisible(v5Brush),
        layersOpen: panelVisible(v5Layers),
        toolbarTools,
      };
      const customCreate = document.querySelector('.v5-brush-settings .v5-brush-custom-create');
      panelState.customCreateExists = !!customCreate;
      if (customCreate) {
        customCreate.click();
        await wait(80);
        const creatorRoot = document.getElementById('nativeBrushLibrary');
        const creatorListEl = document.getElementById('nativeBrushList');
        panelState.customCreatorOpens = !!creatorRoot && !creatorRoot.hidden &&
          inkNativeBrushUi.activeCategory === 'custom' &&
          !!document.getElementById('nativeBrushCustomName') &&
          creatorRoot.classList.contains('nbOverlay--creator-only') &&
          getComputedStyle(document.getElementById('nativeBrushCategories')).display === 'none' &&
          !!creatorListEl && getComputedStyle(creatorListEl).display !== 'none';
        panelState.creatorLibraryList = !!creatorListEl &&
          creatorListEl.dataset.category === '__creator__' &&
          creatorListEl.querySelectorAll('.nbBrushGroup').length > 0 &&
          creatorListEl.querySelectorAll('.nbBrushCard').length > 0;
        const creatorPreview = document.getElementById('nativeBrushCreatorPreview');
        const creatorSettings = document.querySelector('.nbCreator__settings');
        const creatorPreviewColumn = document.querySelector('.nbCreator__previewColumn');
        const creatorTest = document.querySelector('.nbCreator__testCanvas');
        const creatorControls = document.getElementById('nativeBrushCustomControls');
        const settingsRect = creatorSettings && creatorSettings.getBoundingClientRect();
        const previewRect = creatorPreview && creatorPreview.getBoundingClientRect();
        const listRect = creatorListEl && creatorListEl.getBoundingClientRect();
        const previewColumnRect = creatorPreviewColumn && creatorPreviewColumn.getBoundingClientRect();
        const testRect = creatorTest && creatorTest.getBoundingClientRect();
        panelState.creatorSplitLayout = !!settingsRect && !!previewRect &&
          !!previewColumnRect && !!testRect && !!listRect &&
          listRect.width > 150 && settingsRect.left >= listRect.right - 1 &&
          settingsRect.width > 300 && previewRect.width > 300 &&
          previewRect.left >= settingsRect.right - 1 &&
          testRect.left >= settingsRect.right - 1 &&
          Math.abs(previewColumnRect.left - settingsRect.right) < 2 &&
          testRect.right <= previewColumnRect.right + 1;
        panelState.creatorPreviewLarge = !!creatorPreview &&
          creatorPreview.getBoundingClientRect().width >= 300 &&
          creatorPreview.getBoundingClientRect().height >= 100;
        panelState.creatorControlColumns = !!creatorControls &&
          getComputedStyle(creatorControls).columnCount === 'auto';
        panelState.creatorUndoButton = !!document.getElementById('nativeBrushCreatorTestUndo');
        panelState.creatorOnlyTitle = !!creatorRoot &&
          /^(fırça oluşturucu|brush creator)$/i.test(creatorRoot.getAttribute('aria-label') || '');
        panelState.creatorRootFound = !!creatorRoot;
        panelState.creatorCategory = inkNativeBrushUi.activeCategory;
        inkCloseNativeBrushLibrary();
      } else {
        panelState.customCreatorOpens = false;
      }
      if (collapse) {
        collapse.click();
        await wait(320);
        panelState.brushClosed = v5Brush.classList.contains('is-collapsed');
        panelState.layersStillOpen = panelVisible(v5Layers);
        collapse.click();
        await wait(320);
        panelState.brushReopened = !v5Brush.classList.contains('is-collapsed');
      }
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const label = id => {
        const el = document.getElementById(id);
        return el ? el.textContent : '';
      };
      const preview = () => {
        const c = document.getElementById('inkBrushPreview');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0, s = 0;
        for (let i = 3; i < d.length; i += 4) { if (d[i] > 8) n++; s += d[i]; }
        return { n, s };
      };

      const legacy = inkNormalizeState({
        opacity: 50, hardness: 60, spacing: 8, smoothing: 15,
      });

      set('inkSize', 120);
      set('inkOpacity', 20);
      set('inkHardness', 20);
      set('inkSpacing', 40);
      set('inkSmoothing', 75);
      await wait(100);
      const lowOpacity = preview();
      const scaled = {
        size: state.ink.size,
        opacity: state.ink.opacity,
        hardness: state.ink.hardness,
        spacing: state.ink.spacing,
        smoothing: state.ink.smoothing,
      };
      const labels = {
        opacity: label('inkOpacityVal'),
        hardness: label('inkHardnessVal'),
        spacing: label('inkSpacingVal'),
        smoothing: label('inkSmoothingVal'),
      };

      set('inkOpacity', 100);
      await wait(100);
      const fullOpacity = preview();

      set('inkSize', 4);
      await wait(100);
      const tiny = preview();
      set('inkSize', 240);
      await wait(100);
      const big = preview();

      // Test sonrası varsayılanlara dön.
      set('inkSize', 22);
      set('inkOpacity', 100);
      set('inkHardness', 45);
      set('inkSpacing', 9);
      set('inkSmoothing', 45);

      return JSON.stringify({
        scaled, labels, legacy: {
          opacity: legacy.opacity, hardness: legacy.hardness,
          spacing: legacy.spacing, smoothing: legacy.smoothing,
        },
        lowSum: lowOpacity.s, fullSum: fullOpacity.s,
        tinyPx: tiny.n, bigPx: big.n,
        panelState,
      });
    })()`));

    check('fırça paneli değerleri 0–1 ölçeğine çeviriyor',
      Math.abs(panelScale.scaled.opacity - 0.2) < 1e-9 &&
      Math.abs(panelScale.scaled.hardness - 0.2) < 1e-9 &&
      Math.abs(panelScale.scaled.spacing - 0.4) < 1e-9 &&
      Math.abs(panelScale.scaled.smoothing - 0.75) < 1e-9 &&
      Math.abs(panelScale.legacy.opacity - 0.5) < 1e-9 &&
      Math.abs(panelScale.legacy.hardness - 0.6) < 1e-9 &&
      Math.abs(panelScale.legacy.spacing - 0.08) < 1e-9 &&
      Math.abs(panelScale.legacy.smoothing - 0.15) < 1e-9,
      `opaklık ${panelScale.scaled.opacity} · sertlik ${panelScale.scaled.hardness} · ` +
      `aralık ${panelScale.scaled.spacing} · yumuşatma ${panelScale.scaled.smoothing}`);
    check('fırça paneli etiketleri yüzde gösteriyor',
      panelScale.labels.opacity === '20%' && panelScale.labels.hardness === '20%' &&
      panelScale.labels.spacing === '40%' && panelScale.labels.smoothing === '75%',
      `${panelScale.labels.opacity} / ${panelScale.labels.hardness} / ` +
      `${panelScale.labels.spacing} / ${panelScale.labels.smoothing}`);
    check('opaklık önizlemeyi etkiliyor',
      panelScale.fullSum > panelScale.lowSum * 2,
      `alfa toplamı ${panelScale.lowSum} → ${panelScale.fullSum}`);
    check('boyut kaydırıcısı önizlemeyi büyütüyor',
      panelScale.bigPx > panelScale.tinyPx * 4,
      `boyanan ${panelScale.tinyPx}px → ${panelScale.bigPx}px`);
    check('fırça paneli daraltma düğmesiyle kapanıp açılıyor',
      panelScale.panelState.brushOpen && panelScale.panelState.brushClosed &&
      panelScale.panelState.brushReopened,
      `açık=${panelScale.panelState.brushOpen} kapalı=${panelScale.panelState.brushClosed} ` +
      `yeniden=${panelScale.panelState.brushReopened}`);
    check('parmak ve gradyan araçları araç çubuğundan seçilebiliyor',
      panelScale.panelState.toolbarTools.buttonsExist &&
      panelScale.panelState.toolbarTools.smudgeSelects &&
      panelScale.panelState.toolbarTools.gradientSelects,
      JSON.stringify(panelScale.panelState.toolbarTools));
    check('parmak aracının varsayılan akışı yumuşak karışım sağlıyor',
      panelScale.panelState.toolbarTools.smudgeFlowDefault,
      JSON.stringify(panelScale.panelState.toolbarTools));
    check('özel fırça oluştur düğmesi fırça ayarlarından oluşturucuyu açıyor',
      panelScale.panelState.customCreatorOpens,
      `düğme=${panelScale.panelState.customCreateExists} root=${panelScale.panelState.creatorRootFound} ` +
      `kategori=${panelScale.panelState.creatorCategory} açık=${panelScale.panelState.customCreatorOpens}`);
    check('oluşturucu tek başına açılıyor ve büyük önizleme gösteriyor',
      panelScale.panelState.creatorPreviewLarge && panelScale.panelState.creatorOnlyTitle,
      `önizlemeBüyük=${panelScale.panelState.creatorPreviewLarge} başlık=${panelScale.panelState.creatorOnlyTitle}`);
    check('fırça oluşturucuda kitaplık solda, ayarlar ortada, önizleme ve test sağda',
      panelScale.panelState.creatorSplitLayout &&
      panelScale.panelState.creatorLibraryList,
      `üç kolon=${panelScale.panelState.creatorSplitLayout} ` +
      `kitaplık=${panelScale.panelState.creatorLibraryList}`);
    check('fırça ayar kartları tek sütun akordeonda ve geri düğmesi var',
      panelScale.panelState.creatorControlColumns &&
      panelScale.panelState.creatorUndoButton,
      `tek sütun=${panelScale.panelState.creatorControlColumns} ` +
      `geri düğmesi=${panelScale.panelState.creatorUndoButton}`);
    check('fırça paneli kapanırken katman paneli açık kalıyor',
      panelScale.panelState.layersOpen && panelScale.panelState.layersStillOpen,
      `başta=${panelScale.panelState.layersOpen} sonra=${panelScale.panelState.layersStillOpen}`);

    const scope = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      // Üretim davranışını ölç: eski tahta çizim kapısı bu kontrol
      // boyunca kapalı olmalı, sonra eski testler için geri açılır.
      const legacyTest = window.__TailRef_INK_LEGACY_TEST__ === true;
      window.__TailRef_INK_LEGACY_TEST__ = false;
      if (typeof modeExitDraw === 'function') modeExitDraw();
      if (inkRuntime.imageScopeId) inkExitImageScope();
      if (typeof inkApplyToolCursor === 'function') inkApplyToolCursor();
      await wait(260);
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      // Çizim girişi tek noktadan yapılır: görseli seçip üstteki mod
      // düğmesine basmak, tam ekran çizim kapsamını açar.
      selection = new Set([it.id]);
      selectionOrder = [it.id];
      syncSelection();
      await wait(180);
      const drawBtn = document.getElementById('modeDrawBtn');
      if (!drawBtn) {
        window.__TailRef_INK_LEGACY_TEST__ = legacyTest;
        if (typeof inkApplyToolCursor === 'function') inkApplyToolCursor();
        return JSON.stringify({ ok: false });
      }
      drawBtn.click();
      for (let i = 0; i < 80 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      const styleOf = id => {
        const node = document.getElementById(id);
        return node ? getComputedStyle(node).display : 'missing';
      };
      const rr = el.getBoundingClientRect();
      const opened = {
        draw: document.body.classList.contains('mode-draw'),
        reference: document.body.classList.contains('mode-reference'),
        active: inkScopeActiveFor(it.id),
        bar: !document.getElementById('inkScopeBar').hidden,
        editor: inkEditorIsOpen(),
        toolbox: !document.getElementById('inkToolbox').hidden,
        inkActive: document.body.classList.contains('ink-active'),
        modeBar: document.getElementById('appModeBar') ? document.getElementById('appModeBar').dataset.mode : '',
        drawBtn: document.getElementById('modeDrawBtn')
          ? document.getElementById('modeDrawBtn').classList.contains('is-active') : false,
        chrome: styleOf('projectBar') === 'none' && styleOf('barDock') === 'none' &&
                styleOf('brand') !== 'none',
        fits: rr.left >= 0 && rr.top >= 0 && rr.right <= innerWidth && rr.bottom <= innerHeight,
        rect: { x: Math.round(rr.x), y: Math.round(rr.y), w: Math.round(rr.width), h: Math.round(rr.height) },
      };
      // Çizim modundan çık (Esc / Çizimi Bitir): tahta arayüzü geri gelmeli.
      if (typeof modeExitDraw === 'function') modeExitDraw();
      else if (typeof inkExitImageScope === 'function') inkExitImageScope();
      await wait(380);
      const closed = {
        draw: document.body.classList.contains('mode-draw'),
        reference: document.body.classList.contains('mode-reference'),
        editor: inkEditorIsOpen(),
        toolbox: !document.getElementById('inkToolbox').hidden,
        modeBar: document.getElementById('appModeBar') ? document.getElementById('appModeBar').dataset.mode : '',
        chrome: styleOf('projectBar') !== 'none' && styleOf('barDock') !== 'none',
      };
      window.__TailRef_INK_LEGACY_TEST__ = legacyTest;
      if (typeof inkApplyToolCursor === 'function') inkApplyToolCursor();
      return JSON.stringify({ ok: true, opened, closed });
    })()`));

    check('çizim düğmesi tam ekran çizim modunu açıyor',
      scope.ok && scope.opened.draw && scope.opened.editor && scope.opened.toolbox &&
      scope.opened.bar && scope.opened.active && scope.opened.inkActive &&
      scope.opened.modeBar === 'draw' && scope.opened.drawBtn,
      scope.ok
        ? `mod=${scope.opened.modeBar} editör=${scope.opened.editor} araç=${scope.opened.toolbox} bar=${scope.opened.bar}`
        : 'çizim düğmesi yok');
    check('çizim modunda referans tahtası arayüzü tamamen gizli',
      scope.ok && scope.opened.draw && !scope.opened.reference && scope.opened.chrome,
      scope.ok ? `tahtaGizli=${scope.opened.chrome}` : '');
    check('çizim modundan çıkınca referans tahtası geri geliyor',
      scope.ok && scope.closed.reference && !scope.closed.draw && !scope.closed.editor &&
      !scope.closed.toolbox && scope.closed.chrome && scope.closed.modeBar === 'reference',
      scope.ok
        ? `referans=${scope.closed.reference} editör=${scope.closed.editor} tahta=${scope.closed.chrome}`
        : '');
    check('çizim kapsamı görseli ekrana sığdırıyor',
      scope.ok && scope.opened.fits,
      scope.ok ? `x=${scope.opened.rect.x} y=${scope.opened.rect.y}` : '');

    const clip = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      if (!inkScopeActiveFor(it.id)) inkEnterImageScope(it.id);
      // Çizim moduna girişte referans tahtası 650 ms sonra yeniden
      // çerçevelenir; ekran koordinatları ancak ondan sonra sabitlenir.
      await wait(850);
      inkSetTool('brush');
      const r = el.getBoundingClientRect();
      const y = Math.round(r.top + r.height / 2);
      const insideX = Math.round(r.left + r.width * 0.25);
      const outsideX = Math.min(innerWidth - 24, Math.round(r.right + 100));
      const layer = inkLayersForOwner(it.id).slice(-1)[0];
      const before = layer.strokes.length;
      window.__inkPenLine(Math.min(innerWidth - 12, Math.round(r.right + 50)), y, Math.min(innerWidth - 4, Math.round(r.right + 110)), y, 6);
      await wait(280);
      const outsideBlocked = layer.strokes.length === before;
      window.__inkPenLine(insideX, y, outsideX, y, 48);
      await wait(360);
      const stroke = layer.strokes[layer.strokes.length - 1];
      const xs = stroke ? stroke.points.map(p => p.x) : [];
      const ys = stroke ? stroke.points.map(p => p.y) : [];
      const inBounds = xs.length > 1 && xs.every(v => v >= 0 && v <= 1) && ys.every(v => v >= 0 && v <= 1);
      const canvas = inkRuntime.itemCanvases.get(layer.id);
      let painted = 0;
      if (canvas) {
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted += 1;
      }
      inkExitImageScope();
      return JSON.stringify({
        outsideBlocked, inBounds, painted,
        canvasW: canvas ? canvas.width : 0,
        strokes: layer.strokes.length,
        before,
        layerId: layer.id,
        active: inkState().activeLayerId,
        editorLayer: typeof inkEditorUi !== 'undefined' && inkEditorUi ? inkEditorUi.layerId : null,
        tool: inkState().tool,
        hit: (() => {
          const el = document.elementFromPoint(insideX, y);
          return el ? (el.id || String(el.className)) : '';
        })(),
        insideX, y,
      });
    })()`));

    check('görsel dışında başlayan vuruş engelleniyor', clip.outsideBlocked, '');
    check('görsel dışına taşan noktalar 0..1 içinde', clip.inBounds, '');
    check('vuruş görsel tuvaline işlendi', clip.painted > 60 && clip.canvasW > 0, `${clip.painted}px · tuval ${clip.canvasW}px · vuruş ${clip.before}→${clip.strokes} · araç=${clip.tool} · katman=${clip.active === clip.layerId ? 'hedef' : clip.active} · editörKatman=${clip.editorLayer} · hedef=${clip.hit}@${clip.insideX},${clip.y}`);

    // Döndürülmüş görselde de kelepçeleme yerel uzayda çalışmalı; silgi de
    // aynı sınırı kullanmalı.
    const rotClip = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      const prevRot = it.rot || 0;
      it.rot = 32;
      updateItemEl(it, el);
      if (!inkScopeActiveFor(it.id)) inkEnterImageScope(it.id);
      // Çizim moduna girişte referans tahtası 650 ms sonra yeniden
      // çerçevelenir; ekran koordinatları ancak ondan sonra sabitlenir.
      await wait(850);
      const layer = inkLayersForOwner(it.id).slice(-1)[0];
      const start = inkLocalToScreen(layer, { x: 0.3, y: 0.5 });

      const diagPoint = (local) => {
        const board = inkLocalToScreen(layer, local);
        let mapped = board;
        if (typeof inkEditorIsOpen === 'function' && inkEditorIsOpen() && inkEditorUi.fit) {
          const world = screenToWorld({ x: board.x, y: board.y });
          const l = inkWorldToLocal(inkLayerById(inkEditorUi.layerId), world);
          mapped = {
            x: inkEditorUi.fit.x + l.x * inkEditorUi.fit.w,
            y: inkEditorUi.fit.y + l.y * inkEditorUi.fit.h,
          };
        }
        const el = document.elementFromPoint(mapped.x, mapped.y);
        return {
          board, mapped,
          hit: el ? (el.id || String(el.className)) : '',
          editorOpen: typeof inkEditorIsOpen === 'function' && inkEditorIsOpen(),
        };
      };

      inkSetTool('brush');
      const beforeBrush = layer.strokes.length;
      const brushDiag = diagPoint({ x: 0.3, y: 0.5 });
      window.__inkPenLine(start.x, start.y, start.x + 1400, start.y, 40);
      await wait(360);
      const brushStroke = layer.strokes[layer.strokes.length - 1];
      const brushAdded = layer.strokes.length === beforeBrush + 1;
      const bxs = brushStroke ? brushStroke.points.map(p => p.x) : [];
      const bys = brushStroke ? brushStroke.points.map(p => p.y) : [];
      const brushClamped = bxs.length > 1
        && bxs.every(v => v >= 0 && v <= 1) && bys.every(v => v >= 0 && v <= 1)
        && (Math.max(...bxs) > 0.97 || Math.max(...bys) > 0.97 || Math.min(...bys) < 0.03);

      inkSetTool('eraser');
      const eraserDiag = diagPoint({ x: 0.3, y: 0.5 });
      const activeBeforeEraser = inkState().activeLayerId;
      const uiLayerBeforeEraser = typeof inkEditorUi !== 'undefined' && inkEditorUi
        ? inkEditorUi.layerId : null;
      const beforeEraser = layer.strokes.length;
      window.__inkPenLine(start.x, start.y, start.x + 1400, start.y, 40);
      await wait(360);
      const eraserStroke = layer.strokes[layer.strokes.length - 1];
      const exs = eraserStroke ? eraserStroke.points.map(p => p.x) : [];
      const eys = eraserStroke ? eraserStroke.points.map(p => p.y) : [];
      const ownerLayers = inkLayersForOwner(it.id).map(l => ({
        id: l.id, strokes: l.strokes.length,
        tools: l.strokes.map(s => s.tool || '?'),
      }));
      const eraserClamped = layer.strokes.length === beforeEraser + 1
        && eraserStroke.tool === 'eraser'
        && exs.length > 1 && exs.every(v => v >= 0 && v <= 1) && eys.every(v => v >= 0 && v <= 1);

      inkSetTool('brush');
      inkExitImageScope();
      it.rot = prevRot;
      updateItemEl(it, el);
      return JSON.stringify({
        brushAdded, brushClamped, eraserClamped,
        maxX: bxs.length ? Math.max(...bxs) : 0,
        maxY: bys.length ? Math.max(...bys) : 0,
        minY: bys.length ? Math.min(...bys) : 0,
        beforeEraser,
        eraserAdded: layer.strokes.length === beforeEraser + 1,
        eraserTool: eraserStroke ? eraserStroke.tool : '(yok)',
        eraserPoints: exs.length,
        exMin: exs.length ? Math.min(...exs) : null,
        exMax: exs.length ? Math.max(...exs) : null,
        eyMin: eys.length ? Math.min(...eys) : null,
        eyMax: eys.length ? Math.max(...eys) : null,
        strokesNow: layer.strokes.length,
        scopeActive: inkScopeActiveFor(it.id),
        toolAfterEraser: inkState().tool,
        activeLayer: inkState().activeLayerId,
        targetLayer: layer.id,
        activeBeforeEraser,
        uiLayerBeforeEraser,
        ownerLayers,
        brushDiag,
        eraserDiag,
      });
    })()`));

    check('döndürülmüş görselde vuruş ekleniyor', rotClip.brushAdded, '');
    check('döndürülmüş görselde noktalar 0..1 içinde', rotClip.brushClamped,
      `xMax=${Number(rotClip.maxX).toFixed(3)} y=${Number(rotClip.minY).toFixed(3)}..${Number(rotClip.maxY).toFixed(3)}`);
    check('silgi de görsel sınırına kelepçeleniyor', rotClip.eraserClamped,
      `eklendi=${rotClip.eraserAdded} (${rotClip.beforeEraser}→${rotClip.strokesNow}) · ` +
      `araç=${rotClip.eraserTool}/${rotClip.toolAfterEraser} · nokta=${rotClip.eraserPoints} · ` +
      `x=${rotClip.exMin}..${rotClip.exMax} y=${rotClip.eyMin}..${rotClip.eyMax} · ` +
      `katman=${rotClip.activeLayer === rotClip.targetLayer ? 'hedef' : rotClip.activeLayer} · ` +
      `fırçaHedef=${rotClip.brushDiag.hit}@${Math.round(rotClip.brushDiag.mapped.x)},${Math.round(rotClip.brushDiag.mapped.y)} ` +
      `silgiHedef=${rotClip.eraserDiag.hit}@${Math.round(rotClip.eraserDiag.mapped.x)},${Math.round(rotClip.eraserDiag.mapped.y)} · ` +
      `aktif=${rotClip.activeBeforeEraser === rotClip.targetLayer ? 'hedef' : rotClip.activeBeforeEraser} ` +
      `ui=${rotClip.uiLayerBeforeEraser === rotClip.targetLayer ? 'hedef' : rotClip.uiLayerBeforeEraser} · ` +
      `katmanlar=${JSON.stringify(rotClip.ownerLayers)}`);

    // Yumuşak fırça damlaları vuruş boyunca çizilmeli. (Regresyon: interpolasyon
    // noktaları basınç taşımadığında yalnızca ilk damla çiziliyordu.)
    const soft = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      const layer = inkEnsureAttachedLayer(it.id);
      const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const saved = {
        hardness: state.ink.hardness, size: state.ink.size,
        brushId: state.ink.brushId, spacing: state.ink.spacing,
      };
      state.ink.hardness = 0.45; state.ink.size = 26;
      state.ink.spacing = 0.1; state.ink.brushId = 'ink-soft';
      inkSetTool('brush');
      const r = el.getBoundingClientRect();
      const y = Math.round(r.top + r.height / 2);
      const x0 = Math.round(r.left + r.width * 0.2);
      const x1 = Math.round(r.left + r.width * 0.8);
      const before = layer.strokes.length;
      window.__inkPenLine(x0, y, x1, y, 40);
      await wait(500);
      const added = layer.strokes.length === before + 1;
      const stroke = layer.strokes[layer.strokes.length - 1];
      const noTiltField = !stroke || !('t' in stroke.points[0]);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = 1e9, maxX = -1, painted = 0;
      for (let yy = 0; yy < canvas.height; yy++) {
        for (let xx = 0; xx < canvas.width; xx++) {
          if (d[(yy * canvas.width + xx) * 4 + 3] > 8) {
            painted += 1;
            if (xx < minX) minX = xx;
            if (xx > maxX) maxX = xx;
          }
        }
      }
      const expected = (x1 - x0) / Math.max(1, r.width) * canvas.width;
      state.ink.hardness = saved.hardness; state.ink.size = saved.size;
      state.ink.brushId = saved.brushId; state.ink.spacing = saved.spacing;
      inkSetTool('transform');
      return JSON.stringify({
        added, noTiltField, painted,
        span: maxX - minX, expected: Math.round(expected),
      });
    })()`));

    check('yumuşak fırça vuruşu kaydedildi', soft.added, '');
    check('yumuşak fırça vuruş boyunca boyanıyor',
      soft.span > soft.expected * 0.8,
      `boyanan ${soft.span}px / beklenen ${soft.expected}px`);
    check('eğimsiz kalem eğim alanı taşımıyor', soft.noTiltField, '');

    // Eğim: damga eğim yönünde yassılaşmalı ve eğim verisi kalıcı olmalı.
    // Üç parça eval verici: hangi adımın tahikkür ettiği net olsun (kilit
    // çalışması önce eval sayfasında, sonra adımda saptanır).
    const tiltA = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      const layer = inkEnsureAttachedLayer(it.id);
      const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
      const ctx = canvas.getContext('2d');
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const saved = {
        hardness: state.ink.hardness, size: state.ink.size,
        brushId: state.ink.brushId, spacing: state.ink.spacing,
      };
      state.ink.hardness = 0.5; state.ink.size = 56;
      state.ink.spacing = 0.1; state.ink.brushId = 'ink-soft';
      inkSetTool('brush');

      const measure = () => {
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, painted = 0;
        for (let yy = 0; yy < canvas.height; yy++) {
          for (let xx = 0; xx < canvas.width; xx++) {
            if (d[(yy * canvas.width + xx) * 4 + 3] > 8) {
              painted += 1;
              if (xx < minX) minX = xx;
              if (xx > maxX) maxX = xx;
              if (yy < minY) minY = yy;
              if (yy > maxY) maxY = yy;
            }
          }
        }
        return { painted, w: maxX - minX + 1, h: maxY - minY + 1 };
      };

      // 1) Eğimli tek damla: tiltX=60 -> büyüklük 0.667, yön 0 rad.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      window.__inkPen([{ x: cx, y: cy, p: 1, tx: 60, ty: 0 }]);
      await wait(340);
      const tilted = measure();
      const tiltedStroke = layer.strokes[layer.strokes.length - 1];
      const tp = tiltedStroke ? tiltedStroke.points[0] : null;
      const storedT = tp && Number.isFinite(tp.t) ? tp.t : 0;
      const storedA = tp && Number.isFinite(tp.a) ? tp.a : 0;
      window.__smokeTiltCtx = { canvas, cx, cy, layerId: layer.id,
        hardness: saved.hardness, size: saved.size,
        brushId: saved.brushId, spacing: saved.spacing,
        tiltedStrokeId: tiltedStroke ? tiltedStroke.id : '' };
      return JSON.stringify({
        storedT, storedA,
        tiltedW: tilted.w, tiltedH: tilted.h,
      });
    })()`, 120000));

    const tiltB = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const st = window.__smokeTiltCtx;
      if (!st) return JSON.stringify({ ok: false });
      const canvas = st.canvas;
      const ctx = canvas.getContext('2d');
      const measure = () => {
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, painted = 0;
        for (let yy = 0; yy < canvas.height; yy++) {
          for (let xx = 0; xx < canvas.width; xx++) {
            if (d[(yy * canvas.width + xx) * 4 + 3] > 8) {
              painted += 1;
              if (xx < minX) minX = xx;
              if (xx > maxX) maxX = xx;
              if (yy < minY) minY = yy;
              if (yy > maxY) maxY = yy;
            }
          }
        }
        return { painted, w: maxX - minX + 1, h: maxY - minY + 1 };
      };
      // 2) Eğimsiz kontrol damlası.
      const layer2 = state.ink.layers.find(l => l.id === st.layerId);
      const strokesBeforeB = layer2.strokes.length;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      window.__inkPen([{ x: st.cx, y: st.cy, p: 1 }]);
      await wait(340);
      const plain = measure();
      const plainStroke = layer2.strokes[layer2.strokes.length - 1];
      return JSON.stringify({
        ok: true,
        strokesBeforeB, strokesAfterB: layer2.strokes.length,
        plainW: plain.w, plainH: plain.h,
        plainHasTilt: !!plainStroke && 't' in plainStroke.points[0],
      });
    })()`, 120000));

    const tiltC = JSON.parse(await evaluate(ws, `(() => {
      const st = window.__smokeTiltCtx;
      if (!st) return JSON.stringify({ ok: false });
      // 3) Normalleştirme (geri al / yükleme) eğimi koruymalı.
      const round = inkNormalizeState(JSON.parse(JSON.stringify(state.ink)));
      const roundLayer = round.layers.find(l => l.id === st.layerId);
      const roundStroke = roundLayer && roundLayer.strokes.find(s => s.id === st.tiltedStrokeId);
      const keptT = roundStroke && roundStroke.points[0] && Number.isFinite(roundStroke.points[0].t)
        ? roundStroke.points[0].t : 0;
      const plainKept = inkNormalizeStroke({ points: [{ x: 0, y: 0, p: 1 }] });
      state.ink.hardness = st.hardness; state.ink.size = st.size;
      state.ink.brushId = st.brushId; state.ink.spacing = st.spacing;
      inkSetTool('transform');
      delete window.__smokeTiltCtx;
      return JSON.stringify({
        ok: true, keptT,
        normPlainClean: !('t' in plainKept.points[0]),
      });
    })()`));

    check('eğim noktaya yazıldı', Math.abs(tiltA.storedT - 0.667) < 0.02, `t=${Number(tiltA.storedT).toFixed(3)} a=${Number(tiltA.storedA).toFixed(2)}`);
    check('eğim damgayı yassılaştırdı',
      tiltA.tiltedH < tiltA.tiltedW * 0.85,
      `${tiltA.tiltedW}×${tiltA.tiltedH} (eğimsiz ${tiltB.plainW}×${tiltB.plainH})`);
    check('eğimsiz damga yuvarlak kalıyor',
      Math.abs(tiltB.plainW - tiltB.plainH) <= Math.max(3, tiltB.plainW * 0.12),
      `${tiltB.plainW}×${tiltB.plainH} · vuruş ${tiltB.strokesBeforeB}→${tiltB.strokesAfterB}`);
    check('eğim geri al/yükleme turunda korunuyor', Math.abs(tiltC.keptT - tiltA.storedT) < 0.001, `t=${Number(tiltC.keptT).toFixed(3)}`);
    check('eğimsiz vuruşta eğim alanı yok', !tiltB.plainHasTilt && tiltC.normPlainClean, '');

    // Delta geri al: vuruş commit'i tam pano anlık görüntüsü almamalı;
    // geri al/yinele hem vuruşu hem de karışık yığındaki tam kayıtları
    // doğru uygulamalı.
    const deltaD1 = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const it = state.items.find(i => i.kind === 'image');
      const el = elMap.get(it.id);
      // Ölçüm için temiz, kendine ait katman: diğer testlerin vuruşları
      // yeniden çizilirken piksel sayımını bozmasın.
      const layer = inkMakeLayer({ kind: 'attached', ownerId: it.id, name: 'Delta testi' });
      inkState().layers.push(layer);
      inkState().activeLayerId = layer.id;
      const canvas = inkEnsureItemCanvas(layer);
      // Boş katman tuvali oluşturulunca "tam kurulum" bayrağı set edilir;
      // commit'in raster anlık görüntüsü alabilmesi için önce senkronla.
      if (typeof inkSyncDom === 'function') inkSyncDom();
      const ctx = canvas.getContext('2d');
      const paintedPixels = () => {
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1;
        return n;
      };
      const totalStrokes = () => inkLayersForOwner(it.id).reduce((n, l) => n + l.strokes.length, 0);

      inkSetTool('brush');
      const r = el.getBoundingClientRect();
      const y = Math.round(r.top + r.height * 0.45);
      const x0 = Math.round(r.left + r.width * 0.3);
      const x1 = Math.round(r.left + r.width * 0.6);
      const before = totalStrokes();
      const capturesBefore = inkUndoRaster.stats.captures;
      window.__inkPenLine(x0, y, x1, y, 20);
      await wait(380);
      // Gerçek uygulamada katman senkronu commit sonrası tamamlanır; test
      // katmanı elle kurulduğu için bekleyen "tam kurulum" bayrağını temizle.
      if (typeof inkSyncDom === 'function') inkSyncDom();
      const added = totalStrokes() === before + 1 && layer.strokes.length === 1;
      const rasterCaptured = inkUndoRaster.stats.captures > capturesBefore;

      const topRaw = undoStack[undoStack.length - 1] || '';
      let top = null;
      try { top = JSON.parse(topRaw); } catch { /* bozuk */ }
      const isDelta = !!(top && top.__inkStroke);
      const hasToken = !!(top && top.__inkStroke && top.__inkStroke.token);
      const fullBytes = JSON.stringify(createStateSnapshot()).length;
      const deltaBytes = topRaw.length;
      const paintedBefore = paintedPixels();
      /* Delta eval'i dört yarıçıkışa bölündü: render sapması hangi adımda
         kilitleniyor saptansın; önce satır. */
      window.__smokeDeltaCtx = { layer, canvas, it, el, x0, x1, y, before, paintedBefore };
      return JSON.stringify({
        added, isDelta, hasToken, rasterCaptured, fullBytes, deltaBytes, paintedBefore,
        before, after: inkUndoRaster.stats.captures,
      });
    })()`, 120000));

    const deltaD2 = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const st = window.__smokeDeltaCtx;
      if (!st) return JSON.stringify({ ok: false });
      const canvas = st.canvas;
      const ctx = canvas.getContext('2d');
      const paintedPixels = () => {
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1;
        return n;
      };
      const totalStrokes = () => inkLayersForOwner(st.it.id).reduce((n, l) => n + l.strokes.length, 0);

      const appliedBeforeUndo = inkUndoRaster.stats.applied;
      undo();
      await wait(420);
      const rasterUndoFast = inkUndoRaster.stats.applied > appliedBeforeUndo;
      const strokesAfterUndo = totalStrokes();
      const paintedAfterUndo = paintedPixels();

      /* Yinele iki hızlı yoldan birini kullanır: undo anındaki 'after'
         anlık görüntüsü varsa putImageData (stats.applied), yoksa senkron
         damga (stats.repaints). İkisi de kırpılmış bölge yazımıdır. */
      const redoCounters = {
        applied: inkUndoRaster.stats.applied,
        repaints: inkUndoRaster.stats.repaints,
      };
      redo();
      await wait(420);
      const rasterRedoFast = inkUndoRaster.stats.repaints > redoCounters.repaints ||
        inkUndoRaster.stats.applied > redoCounters.applied;
      const strokesAfterRedo = totalStrokes();
      const paintedAfterRedo = paintedPixels();
      st.paintedAfterRedo = paintedAfterRedo;
      return JSON.stringify({
        rasterUndoFast, strokesAfterUndo, paintedAfterUndo,
        rasterRedoFast, strokesAfterRedo, paintedAfterRedo,
      });
    })()`, 120000));

    const deltaD3 = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const st = window.__smokeDeltaCtx;
      if (!st) return JSON.stringify({ ok: false });
      const layer = st.layer;
      const canvas = st.canvas;
      const ctx = canvas.getContext('2d');
      const paintedPixels = () => {
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1;
        return n;
      };

      const scatterBrushId = 'undo-scatter-regression';
      inkState().brushes.push(inkNormalizeBrush({
        id: scatterBrushId, name: 'Undo scatter regression', kind: 'procedural',
        category: 'test', hardness: 0.35, scatterX: 2, scatterY: 2,
        scatterCount: 3,
        dynamics: { sizeMin: 0.7, sizeMax: 1, sizeJitter: 0.6 },
      }));
      const beforeScatter = new Uint8ClampedArray(ctx.getImageData(
        0, 0, canvas.width, canvas.height
      ).data);
      const scatterStroke = inkNormalizeStroke({
        id: 'undo-scatter-stroke', kind: 'stroke', tool: 'brush',
        color: '#ff00ff', opacity: 1, size: 0.08, hardness: 0.35,
        spacing: 0.1, brushId: scatterBrushId,
        points: [{ x: 0.48, y: 0.46, p: 1 }, { x: 0.53, y: 0.54, p: 1 }],
      });
      inkPushUndoStroke(layer, scatterStroke);
      layer.strokes.push(scatterStroke);
      inkDrawStrokeOnContext(ctx, scatterStroke, {
        mapPoint: p => ({ x: p.x * canvas.width, y: p.y * canvas.height }),
        sizePx: Math.max(0.5, scatterStroke.size * canvas.width),
        pointScale: { x: canvas.width, y: canvas.height },
      });
      const scatterPainted = paintedPixels() > st.paintedAfterRedo;
      undo();
      await wait(420);
      const afterScatterUndo = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const scatterUndoRestored = beforeScatter.every((value, i) => value === afterScatterUndo[i]);
      inkState().brushes = inkState().brushes.filter(brush => brush.id !== scatterBrushId);
      return JSON.stringify({ scatterPainted, scatterUndoRestored });
    })()`, 120000));

    const deltaD4 = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const st = window.__smokeDeltaCtx;
      if (!st) return JSON.stringify({ ok: false });
      const layer = st.layer;
      const canvas = st.canvas;
      const x0 = st.x0, x1 = st.x1, y = st.y;
      const totalStrokes = () => inkLayersForOwner(st.it.id).reduce((n, l) => n + l.strokes.length, 0);
      delete window.__smokeDeltaCtx;

      // Karışık yığın: vuruş (delta) + öğe taşıma (tam anlık görüntü).
      window.__inkPenLine(x0, y + 12, x1, y + 12, 20);
      await wait(360);
      const afterSecond = totalStrokes();
      const originalX = st.it.x;
      pushUndo();
      st.it.x = st.it.x + 48;
      updateItemEl(st.it, st.el);

      undo();
      await wait(420);
      const restoredX = getItem(st.it.id).x;
      const strokesAfterFullUndo = totalStrokes();

      undo();
      await wait(420);
      const strokesAfterDeltaUndo = totalStrokes();

      redo();
      await wait(400);
      redo();
      await wait(400);
      const strokesAfterBothRedo = totalStrokes();
      const xAfterBothRedo = getItem(st.it.id).x;

      inkSetTool('transform');
      return JSON.stringify({
        afterSecond, strokesAfterFullUndo, strokesAfterDeltaUndo,
        strokesAfterBothRedo, restoredX, originalX, xAfterBothRedo,
        beforeAdd: st.before,
      });
    })()`, 120000));

    const delta = Object.assign({}, deltaD1, deltaD2, deltaD3, deltaD4);

    check('vuruş commit\'i delta geri al kaydı üretiyor', delta.added && delta.isDelta, '');
    check('vuruş undo kaydı kırpılmış raster bölgesi taşıyor',
      delta.hasToken && delta.rasterCaptured, `token=${delta.hasToken} · yakalama=${delta.rasterCaptured}`);
    check('geri al yalnızca kırpılmış bölgeyi yazıyor (tam raster yok)',
      delta.rasterUndoFast, 'putImageData');
    check('yinele de kırpılmış bölgeyi yazıyor', delta.rasterRedoFast, 'putImageData');
    check('delta kayıt tam anlık görüntüden küçük',
      delta.deltaBytes > 0 && delta.deltaBytes < delta.fullBytes * 0.5,
      `${Math.round(delta.deltaBytes / 1024)} KB / ${Math.round(delta.fullBytes / 1024)} KB`);
    check('delta geri al vuruşu kaldırdı', delta.strokesAfterUndo === delta.before, `${delta.strokesAfterUndo}/${delta.before}`);
    check('delta geri al tuvali yeniden çizdi', delta.paintedAfterUndo < delta.paintedBefore, `${delta.paintedBefore} → ${delta.paintedAfterUndo}`);
    check('delta yinele vuruşu geri getirdi', delta.strokesAfterRedo === delta.before + 1, `${delta.strokesAfterRedo}/${delta.before + 1}`);
    check('delta yinele tuvali yeniden çizdi', delta.paintedAfterRedo >= delta.paintedBefore * 0.9, `${delta.paintedAfterRedo}px`);
    check('saçılmalı fırça Ctrl+Z sonrası katman rasterını aynen geri yüklüyor',
      delta.scatterPainted && delta.scatterUndoRestored,
      `boyama=${delta.scatterPainted} · raster=${delta.scatterUndoRestored}`);
    check('karışık yığında tam kayıt geri alındı',
      Math.abs(delta.restoredX - delta.originalX) < 0.001 && delta.strokesAfterFullUndo === delta.afterSecond,
      `x ${delta.originalX} → ${delta.restoredX}`);
    check('karışık yığında delta kayıt geri alındı',
      delta.strokesAfterDeltaUndo === delta.afterSecond - 1,
      `${delta.strokesAfterDeltaUndo}/${delta.afterSecond - 1}`);
    check('karışık yığında yinele ikisini de geri getirdi',
      delta.strokesAfterBothRedo === delta.afterSecond &&
      Math.abs(delta.xAfterBothRedo - (delta.originalX + 48)) < 0.001,
      `${delta.strokesAfterBothRedo}/${delta.afterSecond} · x=${delta.xAfterBothRedo}`);

    // Global katmanda delta geri al: karolar yeniden kurulmalı.
    const gDelta = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const layer = state.ink.layers.find(l => l.kind === 'global' && l.plane === 'above');
      // Açık paneller tıklamayı yutmasın.
      if (typeof inkCloseTransientUi === 'function') inkCloseTransientUi();
      await wait(260);
      state.ink.activeLayerId = layer.id;
      inkSetTool('brush');
      const tilesFor = () => [...inkRuntime.tiles.values()]
        .filter(t => t.layerId === layer.id && t.canvas.isConnected).length;
      const before = layer.strokes.length;
      const beforeTiles = tilesFor();
      window.__inkPenLine(700, 300, 980, 360, 24);
      await wait(400);
      const added = layer.strokes.length === before + 1;
      const afterTiles = tilesFor();
      undo();
      await wait(440);
      const afterUndoStrokes = layer.strokes.length;
      const afterUndoTiles = tilesFor();
      redo();
      await wait(440);
      const afterRedoStrokes = layer.strokes.length;
      const afterRedoTiles = tilesFor();
      inkSetTool('transform');
      return JSON.stringify({
        added, before, beforeTiles, afterTiles,
        afterUndoStrokes, afterUndoTiles, afterRedoStrokes, afterRedoTiles,
      });
    })()`));

    check('global katmanda vuruş eklendi', gDelta.added, `${gDelta.before} → ${gDelta.before + 1}`);
    check('global katman delta geri alındı', gDelta.afterUndoStrokes === gDelta.before, `${gDelta.afterUndoStrokes}/${gDelta.before}`);
    check('global katman karoları yeniden kuruldu', gDelta.afterRedoTiles >= 1 && gDelta.afterRedoStrokes === gDelta.before + 1, `${gDelta.afterRedoTiles} karo`);

    const globalRasterUndo = JSON.parse(await evaluate(ws, `(async () => {
      const layer = state.ink.layers.find(item => item.kind === 'global' && item.plane === 'above');
      const raster = () => [...inkRuntime.tiles.values()]
        .filter(tile => tile.layerId === layer.id && tile.canvas.isConnected)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(tile => ({
          key: tile.key,
          data: tile.canvas.getContext('2d').getImageData(
            0, 0, tile.canvas.width, tile.canvas.height
          ).data,
        }));
      const sameRaster = (a, b) => a.length === b.length &&
        a.every((tile, index) => tile.key === b[index].key &&
          tile.data.length === b[index].data.length &&
          tile.data.every((value, pixel) => value === b[index].data[pixel]));
      const brushId = 'global-scatter-undo-regression';
      state.ink.brushes.push(inkNormalizeBrush({
        id: brushId, name: 'Global scatter undo regression',
        kind: 'procedural', category: 'test', hardness: 0.3,
        scatterX: 1.8, scatterY: 1.8, scatterCount: 4,
        dynamics: { sizeMin: 0.6, sizeMax: 1, sizeJitter: 0.7 },
      }));
      const before = raster();
      const stroke = inkNormalizeStroke({
        id: 'global-scatter-undo-stroke', kind: 'stroke', tool: 'brush',
        color: '#ff00ff', opacity: 1, size: 44, hardness: 0.3,
        spacing: 0.08, brushId,
        points: [{ x: 760, y: 380, p: 1 }, { x: 795, y: 405, p: 1 }],
      });
      inkPushUndoStroke(layer, stroke);
      layer.strokes.push(stroke);
      inkRasterizeGlobalStroke(layer, stroke);
      const painted = raster();
      undo();
      const undoRestored = sameRaster(before, raster());
      redo();
      const redoRestored = sameRaster(painted, raster());
      undo();
      const finalUndoRestored = sameRaster(before, raster());
      state.ink.brushes = state.ink.brushes.filter(brush => brush.id !== brushId);
      return JSON.stringify({
        beforeTiles: before.length, paintedTiles: painted.length,
        undoRestored, redoRestored, finalUndoRestored,
      });
    })()`));
    check('saçılmalı fırça Ctrl+Z global katmandaki eski pikselleri tamamen temizliyor',
      globalRasterUndo.undoRestored && globalRasterUndo.redoRestored &&
      globalRasterUndo.finalUndoRestored,
      JSON.stringify(globalRasterUndo));

    // Kısmi geri al: yalnızca vuruşun bölgesi tazelenmeli, aynı katmandaki
    // komşu vuruşlar ve karonun geri kalanı silinmemeli.
    const partial = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const it = state.items.find(i => i.kind === 'image');
      if (!inkScopeActiveFor(it.id)) inkEnterImageScope(it.id);
      // Çizim moduna girişte referans tahtası 650 ms sonra yeniden
      // çerçevelenir; ekran koordinatları ancak ondan sonra sabitlenir.
      await wait(850);
      inkSetTool('brush');

      const paintedOn = c => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1;
        return n;
      };

      // Bağlı katman: iki ayrı vuruş, biri geri alınınca diğeri kalmalı.
      const layer = inkMakeLayer({ kind: 'attached', ownerId: it.id, name: 'Kısmi geri al' });
      state.ink.layers.push(layer);
      inkSetActiveLayer(layer.id);
      const canvas = inkEnsureItemCanvas(layer);
      const p1 = inkLocalToScreen(layer, { x: 0.2, y: 0.3 });
      const p2 = inkLocalToScreen(layer, { x: 0.2, y: 0.7 });
      const probe = (board) => {
        let mapped = board;
        if (typeof inkEditorIsOpen === 'function' && inkEditorIsOpen() && inkEditorUi.fit) {
          const world = screenToWorld({ x: board.x, y: board.y });
          const l = inkWorldToLocal(inkLayerById(inkEditorUi.layerId), world);
          mapped = {
            x: inkEditorUi.fit.x + l.x * inkEditorUi.fit.w,
            y: inkEditorUi.fit.y + l.y * inkEditorUi.fit.h,
          };
        }
        const el = document.elementFromPoint(mapped.x, mapped.y);
        return {
          hit: el ? (el.id || String(el.className)) : '',
          mapped: { x: Math.round(mapped.x), y: Math.round(mapped.y) },
          editorOpen: typeof inkEditorIsOpen === 'function' && inkEditorIsOpen(),
          tool: inkState().tool,
          active: inkState().activeLayerId,
          uiLayer: typeof inkEditorUi !== 'undefined' && inkEditorUi ? inkEditorUi.layerId : null,
        };
      };
      const probe1 = probe(p1);
      const probe2 = probe(p2);
      window.__inkPenLine(p1.x, p1.y, p1.x + 90, p1.y, 18);
      await wait(300);
      const firstPainted = paintedOn(canvas);
      const firstStrokes = layer.strokes.length;
      const firstUi = typeof inkEditorUi !== 'undefined' && inkEditorUi
        ? { stroke: !!inkEditorUi.stroke, open: inkEditorUi.open, pointerId: inkEditorUi.pointerId }
        : null;
      const activeBeforeSecond = inkState().activeLayerId;
      const uiLayerBeforeSecond = typeof inkEditorUi !== 'undefined' && inkEditorUi
        ? inkEditorUi.layerId : null;
      const ownerBeforeSecond = inkLayersForOwner(it.id).map(l => ({ id: l.id, n: l.strokes.length }));
      window.__inkPenLine(p2.x, p2.y, p2.x + 90, p2.y, 18);
      await wait(300);
      const bothPainted = paintedOn(canvas);
      const bothStrokes = layer.strokes.length;
      const ownerAfterSecond = inkLayersForOwner(it.id).map(l => ({ id: l.id, n: l.strokes.length }));
      const secondUi = typeof inkEditorUi !== 'undefined' && inkEditorUi
        ? { stroke: !!inkEditorUi.stroke, open: inkEditorUi.open, pointerId: inkEditorUi.pointerId }
        : null;
      const totalStrokes = state.ink.layers.reduce((n, l) => n + (l.strokes ? l.strokes.length : 0), 0);
      const canvasSameBeforeUndo = inkRuntime.itemCanvases.get(layer.id) === canvas;
      undo();
      await wait(340);
      const afterUndo = paintedOn(canvas);
      const afterStrokes = layer.strokes.length;
      const current = inkRuntime.itemCanvases.get(layer.id);
      const afterUndoCurrent = current ? paintedOn(current) : -1;
      const canvasSameAfterUndo = current === canvas;

      // Global katman: aynı karo içinde iki vuruş; geri alınan silinmeli,
      // diğeri ve karonun kalanı korunmalı.
      inkExitImageScope();
      await wait(260);
      const g = inkMakeLayer({ kind: 'global', plane: 'above', name: 'Kısmi geri al' });
      state.ink.layers.push(g);
      inkSetActiveLayer(g.id);
      const wc = screenToWorld({ x: innerWidth / 2, y: innerHeight / 2 });
      const tx = Math.floor(wc.x / INK_TILE_SIZE), ty = Math.floor(wc.y / INK_TILE_SIZE);
      const cx = tx * INK_TILE_SIZE + 128, cy = ty * INK_TILE_SIZE + 128;
      const s1 = worldToScreen({ x: cx, y: cy });
      const s2 = worldToScreen({ x: cx, y: cy + 120 });
      const paintedGlobal = () => [...inkRuntime.tiles.values()]
        .filter(t => t.layerId === g.id)
        .reduce((n, t) => n + paintedOn(t.canvas), 0);
      window.__inkPenLine(s1.x, s1.y, s1.x + 110, s1.y, 16);
      await wait(340);
      const gFirst = paintedGlobal();
      const gFirstStrokes = g.strokes.length;
      const gDiag1 = {
        tool: inkState().tool,
        active: inkState().activeLayerId === g.id ? 'g' : inkState().activeLayerId,
        hit: (() => {
          const el = document.elementFromPoint(s1.x, s1.y);
          return el ? (el.id || String(el.className)) : '';
        })(),
        total: state.ink.layers.reduce((n, l) => n + (l.strokes ? l.strokes.length : 0), 0),
      };
      window.__inkPenLine(s2.x, s2.y, s2.x + 110, s2.y, 16);
      await wait(340);
      const gBoth = paintedGlobal();
      const gBothStrokes = g.strokes.length;
      undo();
      await wait(340);
      const gAfterUndo = paintedGlobal();

      inkSetTool('transform');
      return JSON.stringify({
        firstPainted, bothPainted, afterUndo,
        firstStrokes, bothStrokes, afterStrokes,
        canvasSameBeforeUndo, canvasSameAfterUndo, afterUndoCurrent,
        probe1, probe2, firstUi, secondUi, totalStrokes,
        activeBeforeSecond, uiLayerBeforeSecond, ownerBeforeSecond, ownerAfterSecond,
        gFirst, gBoth, gAfterUndo, gFirstStrokes, gBothStrokes, gDiag1,
      });
    })()`));

    check('kısmi geri al komşu bağlı vuruşu koruyor',
      partial.afterUndo >= partial.firstPainted * 0.85,
      `${partial.bothPainted} → ${partial.afterUndo}px (ilk ${partial.firstPainted}) · ` +
      `vuruş ${partial.firstStrokes}→${partial.bothStrokes}→${partial.afterStrokes} (toplam ${partial.totalStrokes}) · ` +
      `tuval aynı=${partial.canvasSameBeforeUndo}/${partial.canvasSameAfterUndo} · ` +
      `güncel=${partial.afterUndoCurrent}px · ` +
      `p1=${partial.probe1.hit}@${partial.probe1.mapped.x},${partial.probe1.mapped.y} ` +
      `p2=${partial.probe2.hit}@${partial.probe2.mapped.x},${partial.probe2.mapped.y} · ` +
      `ui1=${JSON.stringify(partial.firstUi)} ui2=${JSON.stringify(partial.secondUi)} · ` +
      `ikinciAktif=${partial.activeBeforeSecond} ikinciUi=${partial.uiLayerBeforeSecond} · ` +
      `önce=${JSON.stringify(partial.ownerBeforeSecond)} sonra=${JSON.stringify(partial.ownerAfterSecond)}`);
    check('kısmi geri al kaldırılan vuruşu siliyor',
      partial.afterUndo < partial.bothPainted * 0.95,
      `${partial.bothPainted} → ${partial.afterUndo}px`);
    check('global kısmi geri al komşu vuruşu koruyor',
      partial.gAfterUndo >= partial.gFirst * 0.85,
      `${partial.gBoth} → ${partial.gAfterUndo}px (ilk ${partial.gFirst}) · ` +
      `vuruş ${partial.gFirstStrokes}→${partial.gBothStrokes} · ` +
      `araç=${partial.gDiag1.tool} katman=${partial.gDiag1.active} ` +
      `hedef=${partial.gDiag1.hit} toplam=${partial.gDiag1.total}`);

    // ---------------------------------------------------------------
    // 12) P1: worker raster — ağır vuruş ana iş parçacığını kilitlememeli
    // ---------------------------------------------------------------
    const worker = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      if (typeof inkCloseTransientUi === 'function') inkCloseTransientUi();
      const it = state.items.find(i => i.kind === 'image');
      // Worker raster motoru UI'dan bağımsız test edilir: modal editör
      // açıksa kapat, doğrudan katman üzerinde çalış.
      if (inkEditorIsOpen()) inkExitImageScope();
      await wait(220);
      inkWorkerEnable(true);
      inkWorkerForce(false);

      // Worker yalnızca yumuşak uçlu ve sade dinamikli fırçaları
      // rasterleyebilir. Yerleşik fırçaların çoğunda saçılma/titreşim
      // olduğu için test, gereksinimi karşılayan geçici bir fırça kurar.
      const inkS = inkState();
      const previousBrushId = inkS.brushId;
      if (!inkS.brushes.some(b => b.id === 'test-worker-soft')) {
        inkS.brushes.push({
          id: 'test-worker-soft', name: 'Worker Soft', category: 'custom',
          kind: 'procedural', tip: 'soft', size: 44, opacity: 1,
          hardness: 0.4, spacing: 0.08, smoothing: 0.1, flow: 1,
          scatter: 0, dynamics: { sizeMin: 0.3, sizeMax: 1, opacityMin: 0.2 },
        });
      }

      const layer = inkMakeLayer({ kind: 'attached', ownerId: it.id, name: 'Worker' });
      state.ink.layers.push(layer);
      inkSetActiveLayer(layer.id);
      const canvas = inkEnsureItemCanvas(layer);
      const ctx = canvas.getContext('2d');
      const painted = () => {
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1;
        return n;
      };

      const supported = inkWorkerSupported();
      const s0 = inkWorkerStats();

      inkSetTool('brush');
      state.ink.hardness = 0.4;
      state.ink.size = 44;
      state.ink.spacing = 0.08;
      state.ink.brushId = 'test-worker-soft';
      state.ink.opacity = 1;
      state.ink.smoothing = 0.1;
      state.ink.color = '#33ccff';

      const p = inkLocalToScreen(layer, { x: 0.12, y: 0.3 });

      // 1) Eşik altı vuruş senkron kalmalı (worker'a gitmemeli).
      window.__inkPenLine(p.x, p.y, p.x + 60, p.y, 12);
      await wait(140);
      const sSmall = inkWorkerStats();
      const smallSync = sSmall.jobs === s0.jobs && painted() > 0;
      const smallPainted = painted();
      undo();
      await wait(240);

      // 2) Zorlanmış worker vuruşu: iş kuyruğa girmeli, bitmap uygulanmalı.
      inkWorkerForce(true);
      const sBefore = inkWorkerStats();
      window.__inkPenLine(p.x, p.y, p.x + 250, p.y + 50, 150);
      const strokeCount = layer.strokes.length;
      await inkPaintIdle();
      const sAfter = inkWorkerStats();
      const workerPainted = painted();
      const workerStroke = layer.strokes[layer.strokes.length - 1];
      const jobsDelta = sAfter.jobs - sBefore.jobs;
      const appliedDelta = sAfter.applied - sBefore.applied;

      // 3) Worker rasterı ile senkron raster birebir olmalı: geri al/yinele
      //    yolu (kısmi tazeleme) senkron çizer, piksel sayısı eşleşmeli.
      inkWorkerEnable(false);
      undo();
      await wait(320);
      const afterUndoPx = painted();
      redo();
      await wait(380);
      const syncPainted = painted();
      inkWorkerEnable(true);

      // 4) Silgi worker üzerinden de pikselleri silmeli.
      inkWorkerForce(true);
      const sEraseBefore = inkWorkerStats();
      const beforeErasePx = painted();
      const ep = inkLocalToScreen(layer, { x: 0.14, y: 0.3 });
      state.ink.size = 64;
      inkSetTool('eraser');
      state.ink.brushId = 'test-worker-soft';
      state.ink.opacity = 1;
      window.__inkPenLine(ep.x, ep.y, ep.x + 250, ep.y + 50, 110);
      await inkPaintIdle();
      const sEraseAfter = inkWorkerStats();
      const eraserPainted = painted();

      // Silgi worker rasterı ile tam senkron yeniden çizim arasında küçük
      // piksel farkları olabilir. Aşağıdaki geç sonuç testi geri alırken
      // bölgeyi kaynaktan tazelediği için taban çizgisini senkron hâle
      // getir; böylece ölçüm yalnızca geç worker sonucunu sınar.
      inkWorkerEnable(false);
      inkRerenderLayer(layer.id);
      inkWorkerEnable(true);
      await wait(140);

      // 5) Worker dönerken geri al: geç sonuç ekrana dönmemeli.
      inkSetTool('brush');
      state.ink.size = 40;
      inkWorkerForce(true);
      const capture = inkCaptureRegion;
      window.inkCaptureRegion = async (l, plan) => {
        const b = await capture(l, plan);
        await new Promise(r => setTimeout(r, 360));
        return b;
      };
      const sStaleBefore = inkWorkerStats();
      const baselinePx = painted();
      const baselineStrokes = layer.strokes.length;
      window.__inkPenLine(p.x, p.y + 120, p.x + 200, p.y + 190, 90);
      undo();
      const justAfterUndoPx = painted();
      await inkPaintIdle();
      window.inkCaptureRegion = capture;
      const sStaleAfter = inkWorkerStats();
      const stalePx = painted();
      const staleStrokes = layer.strokes.length;

      // 6) Global katman: karo birleştirme yolu da worker'ı kullanmalı.
      inkExitImageScope();
      await wait(300);
      const g = inkMakeLayer({ kind: 'global', plane: 'above', name: 'Worker global' });
      state.ink.layers.push(g);
      inkSetActiveLayer(g.id);
      const tilePainted = () => [...inkRuntime.tiles.values()]
        .filter(t => t.layerId === g.id)
        .reduce((n, t) => {
          const d = t.canvas.getContext('2d').getImageData(0, 0, t.canvas.width, t.canvas.height).data;
          let c = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) c += 1;
          return n + c;
        }, 0);
      inkWorkerForce(true);
      inkSetTool('brush');
      // Görünür ve panelin kapatmadığı bir sahne noktası seç: dünya katmanı
      // için ekran konumu önemsiz, vuruşun gerçekten sahneye düşmesi önemli.
      let sp = null;
      for (const cand of [[0.5, 0.25], [0.35, 0.5], [0.6, 0.45], [0.5, 0.75], [0.25, 0.65], [0.75, 0.65]]) {
        const x = Math.round(innerWidth * cand[0]);
        const y = Math.round(innerHeight * cand[1]);
        const el2 = document.elementFromPoint(x, y);
        if (el2 && (el2 === stage || stage.contains(el2))) { sp = { x, y }; break; }
      }
      if (!sp) sp = { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) };
      const s1 = sp;
      const sG = inkWorkerStats();
      window.__inkPenLine(s1.x, s1.y, s1.x + 90, s1.y + 30, 130);
      await inkPaintIdle();
      const sGAfter = inkWorkerStats();
      const gTiles = [...inkRuntime.tiles.values()].filter(t => t.layerId === g.id).length;
      const globalPx = tilePainted();

      // 7) 2048² üstü bölge parçalara bölünüp worker'a gitmeli.
      inkWorkerForce(true);
      const sChunk0 = inkWorkerStats();
      const chunkBefore = tilePainted();
      const far = {
        id: 'sk_chunk', kind: 'stroke', tool: 'brush', color: '#22ddaa', size: 120,
        opacity: 1, hardness: 0.4, spacing: 0.1, brushId: 'test-worker-soft',
        points: [{ x: 700, y: 900, p: 1 }, { x: 4300, y: 3300, p: 1 }],
      };
      g.strokes.push(far);
      inkSetActiveLayer(g.id);
      await inkPaintCommittedStroke(g, far);
      await inkPaintIdle();
      const sChunk1 = inkWorkerStats();
      const chunkAfter = tilePainted();
      const sample = (tx, ty) => {
        const key = inkTileKey(g.id, tx, ty);
        const tile = inkRuntime.tiles.get(key);
        if (!tile) return 0;
        const d = tile.canvas.getContext('2d').getImageData(0, 0, INK_TILE_SIZE, INK_TILE_SIZE).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1;
        return n;
      };
      const chunkSample = sample(1, 1);
      // Parçalar doğru dikilmeli: aynı karo senkron çizimle eşleşmeli.
      g.strokes = g.strokes.filter(s => s.id !== far.id);
      inkRepaintStrokeRegion(g, far);
      inkDirtyReset();
      const chunkCleared = sample(1, 1);
      g.strokes.push(far);
      inkPaintStrokeSync(g, far);
      const chunkSync = sample(1, 1);

      // 8) P3/P2: hız incelmesi + akış + doku worker ile senkron eşleşmeli.
      const parityBrush = inkNormalizeBrush({
        id: 'parity_brush', name: 'Parity', kind: 'procedural',
        hardness: 0.6, spacing: 0.05, scatter: 0.3, flow: 0.8, flowJitter: 0.35,
        texture: true, textureDepth: 0.5, textureScale: 1.4,
        dynamics: { sizeMin: 0.25, sizeMax: 1, src: 'velocity', angleJitter: 0.2, scatterJitter: 0.15, spacingJitter: 0.35 },
      });
      state.ink.brushes.push(parityBrush);
      const parityPoints = [];      for (let i = 0; i <= 160; i++) {
        const t = i / 160;
        parityPoints.push({
          x: 0.1 + 0.8 * t,
          y: 0.36 + Math.sin(t * Math.PI) * 0.12,
          p: 0.4 + Math.sin(t * Math.PI) * 0.6,
          s: t,
        });
      }
      const mkParityStroke = color => ({
        id: 'sk_parity_' + color.slice(1), kind: 'stroke', tool: 'brush', color,
        size: 0.09, opacity: 1, hardness: 0.6, spacing: 0.05,
        speedSize: 0.6, brushId: parityBrush.id, flow: 0.52,
        flowJitter: 0.18, scatter: 0.2,
        taperStart: 0.35, taperEnd: 0.4,
        points: parityPoints.map(q => Object.assign({}, q)),
      });
      const countCanvas = canvas => {
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0, sum = 0;
        for (let i = 3; i < d.length; i += 4) { if (d[i] > 8) n += 1; sum += d[i]; }
        return { n, sum };
      };
      const checksumCanvas = canvas => {
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (let i = 0; i < d.length; i++) hash = Math.imul(hash ^ d[i], 16777619);
        return hash >>> 0;
      };
      const repeatStroke = mkParityStroke('#66ddff');
      const repeatCanvases = [document.createElement('canvas'), document.createElement('canvas')];
      for (const canvas of repeatCanvases) {
        canvas.width = canvas.height = 512;
        inkDrawStrokeOnContext(canvas.getContext('2d'), repeatStroke, {
          mapPoint: p => ({ x: p.x * 512, y: p.y * 512 }),
          sizePx: repeatStroke.size * 512,
          pointScale: { x: 512, y: 512 },
        });
      }
      const repeatHashA = checksumCanvas(repeatCanvases[0]);
      const repeatHashB = checksumCanvas(repeatCanvases[1]);
      const stablePoints = [
        { x: 0.1, y: 0.2, p: 0.8 }, { x: 0.3, y: 0.4, p: 0.9 },
        { x: 0.5, y: 0.25, p: 0.7 }, { x: 0.7, y: 0.6, p: 1 },
        { x: 0.9, y: 0.3, p: 0.8 },
      ];
      const collectStableDabs = length => {
        const dabs = [];
        inkForEachDab(stablePoints.slice(0, length), 5, p => dabs.push([p.x, p.y, p.p]), 512, {
          stableOnly: true,
          spacingJitter: 0.4,
          strokeId: 'stable-preview-test',
        });
        return dabs;
      };
      const stableBefore = collectStableDabs(4);
      const stableAfter = collectStableDabs(5);
      const stablePrefixMatches = stableBefore.length > 0 &&
        stableBefore.every((p, i) => p[0] === stableAfter[i][0] && p[1] === stableAfter[i][1] && p[2] === stableAfter[i][2]);
      const unjitteredDabs = [];
      inkForEachDab(stablePoints, 5, p => unjitteredDabs.push(p.x), 512, { strokeId: 'spacing-jitter-test' });
      const jitteredDabs = [];
      inkForEachDab(stablePoints, 5, p => jitteredDabs.push(p.x), 512, {
        strokeId: 'spacing-jitter-test',
        spacingJitter: 0.6,
      });
      const jitterRepeat = [];
      inkForEachDab(stablePoints, 5, p => jitterRepeat.push(p.x), 512, {
        strokeId: 'spacing-jitter-test',
        spacingJitter: 0.6,
      });
      const spacingJitterWorks = jitteredDabs.length === unjitteredDabs.length &&
        jitteredDabs.some((x, i) => Math.abs(x - unjitteredDabs[i]) > 1e-6) &&
        jitteredDabs.every((x, i) => x === jitterRepeat[i]);
      const lw = inkMakeLayer({ kind: 'attached', ownerId: it.id, name: 'Parity worker' });
      state.ink.layers.push(lw);
      const lwCanvas = inkEnsureItemCanvas(lw);
      inkWorkerForce(true);
      const strokeW = mkParityStroke('#66ddff');
      lw.strokes.push(strokeW);
      inkPaintCommittedStroke(lw, strokeW);
      await inkPaintIdle();
      const parityWorkerPx = countCanvas(lwCanvas);

      const ls = inkMakeLayer({ kind: 'attached', ownerId: it.id, name: 'Parity sync' });
      state.ink.layers.push(ls);
      const lsCanvas = inkEnsureItemCanvas(ls);
      inkWorkerForce(false);
      const strokeS = mkParityStroke('#66ddff');
      ls.strokes.push(strokeS);
      inkPaintCommittedStroke(ls, strokeS);
      await inkPaintIdle();
      const paritySyncPx = countCanvas(lsCanvas);
      // 9) FAZ4-2/6: dinamik yüklü fırça worker ↔ senkron — gürültü, ıslak
      // kenar, airbrush, eksenli saçılma, saçılma sayısı, renk dinamikleri,
      // rastgele boyut/yuvarlaklık/opaklık, uç yığını + çevirme/dönme ve
      // yerel dual uç aynı baytları üretmeli (hash eşitliği).
      const dualSrcBrush = inkNormalizeBrush({
        id: 'dyn_parity_dual_src', name: 'Dyn Dual Src', kind: 'procedural',
        hardness: 0.4, tip: 'noise', tipOptions: { seed: 11 }, spacing: 0.1,
      });
      state.ink.brushes.push(dualSrcBrush);
      const dynParityBrush = inkNormalizeBrush({
        id: 'dyn_parity_brush', name: 'Dyn Parity', kind: 'procedural',
        hardness: 0.55, spacing: 0.06, flow: 0.85,
        noise: 0.5, wetEdges: 0.7, airbrush: true,
        scatter: 0.05, scatterX: 0.35, scatterY: 0.15,
        scatterCount: 3, scatterCountJitter: 0.4,
        tipVariants: 2, stampFlipX: 0.5, tipRotation: 0.3,
        colorDynamics: { hueJitter: 0.04, saturationJitter: 0.2,
          brightnessJitter: 0.25, purity: 0.12 },
        dynamics: { sizeMin: 0.3, sizeMax: 1, src: 'random', sizeJitter: 0.3,
          roundnessJitter: 0.25, roundnessMin: 0.2, opacityJitter: 0.45,
          opacitySrc: 'random', opacityMin: 0.2, angleJitter: 0.15,
          scatterJitter: 0.2, spacingJitter: 0 },
        dual: { brushId: 'dyn_parity_dual_src', diameter: 30, scale: 0.8,
          spacing: 1, scatter: 0.3, blend: 'multiply', hardness: 0.35 },
      });
      state.ink.brushes.push(dynParityBrush);
      const dynPoints = [];
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        dynPoints.push({
          x: 0.08 + 0.84 * t,
          y: 0.62 + Math.sin(t * Math.PI) * 0.08,
          p: 0.35 + Math.sin(t * Math.PI) * 0.65,
          s: t,
        });
      }
      const mkDynStroke = () => ({
        id: 'sk_dyn_parity', kind: 'stroke', tool: 'brush', color: '#33ccff',
        size: 0.1, opacity: 1, hardness: 0.55, spacing: 0.06,
        brushId: dynParityBrush.id, flow: 0.85,
        points: dynPoints.map(q => Object.assign({}, q)),
      });
      const lwd = inkMakeLayer({ kind: 'attached', ownerId: it.id, name: 'Dyn parity worker' });
      state.ink.layers.push(lwd);
      inkWorkerForce(true);
      const strokeWD = mkDynStroke();
      lwd.strokes.push(strokeWD);
      inkPaintCommittedStroke(lwd, strokeWD);
      await inkPaintIdle();
      const dynWorkerCanvas = inkEnsureItemCanvas(lwd);
      const dynWorkerHash = checksumCanvas(dynWorkerCanvas);
      const dynWorkerPx = countCanvas(dynWorkerCanvas);
      const lsd = inkMakeLayer({ kind: 'attached', ownerId: it.id, name: 'Dyn parity sync' });
      state.ink.layers.push(lsd);
      inkWorkerForce(false);
      const strokeSD = mkDynStroke();
      lsd.strokes.push(strokeSD);
      inkPaintCommittedStroke(lsd, strokeSD);
      await inkPaintIdle();
      const dynSyncCanvas = inkEnsureItemCanvas(lsd);
      const dynSyncHash = checksumCanvas(dynSyncCanvas);
      const dynSyncPx = countCanvas(dynSyncCanvas);
      inkRemoveLayer(lwd.id);
      inkRemoveLayer(lsd.id);
      state.ink.brushes = state.ink.brushes.filter(b =>
        b.id !== dynParityBrush.id && b.id !== dualSrcBrush.id);
      inkWorkerForce(true);
      inkRemoveLayer(lw.id);
      inkRemoveLayer(ls.id);
      state.ink.brushes = state.ink.brushes.filter(b => b.id !== parityBrush.id);

      /* FAZ4-3: smudge advected alanı paritesi — worker IL bölgesi
         senkron smudge kutusuna birebir eş olduğundan reservoir/akık
         taşması bölge-local koordinatlarda bayt birebir olmalı. */
      const paintSmudgeBackground = canvas => {
        const sctx = canvas.getContext('2d', { colorSpace: 'srgb' });
        sctx.clearRect(0, 0, canvas.width, canvas.height);
        sctx.fillStyle = '#2060a0';
        sctx.fillRect(0, 0, Math.floor(canvas.width / 3) + 1, canvas.height);
        sctx.fillStyle = '#d06030';
        sctx.fillRect(Math.floor(canvas.width / 3), 0,
          Math.floor(canvas.width / 3) + 1, Math.floor(canvas.height * 0.62));
        sctx.fillStyle = '#40b070';
        sctx.fillRect(Math.floor(canvas.width * 2 / 3), Math.floor(canvas.height * 0.38),
          canvas.width, Math.ceil(canvas.height * 0.62));
        sctx.globalAlpha = 0.5;
        sctx.fillStyle = '#ffffff';
        sctx.fillRect(0, Math.floor(canvas.height * 0.7), canvas.width, 5);
        sctx.globalAlpha = 1;
      };
      const smudgePoints = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        smudgePoints.push({
          x: 0.15 + 0.7 * t,
          y: 0.5 + Math.sin(t * Math.PI) * 0.4,
          p: 0.45 + Math.sin(t * Math.PI) * 0.55,
          s: t,
        });
      }
      const mkSmudgeStroke = () => ({
        id: 'sk_smudge_parity', kind: 'smudge', tool: 'smudge',
        color: '#000000', size: 0.08, opacity: 0.9, hardness: 0.4,
        spacing: 0.2, flow: 0.5, brushId: 'ink-soft',
        points: smudgePoints.map(q => Object.assign({}, q)),
      });
      const lsw = inkMakeLayer({ kind: 'attached', ownerId: it.id, name: 'Smudge parity worker' });
      state.ink.layers.push(lsw);
      paintSmudgeBackground(inkEnsureItemCanvas(lsw));
      inkWorkerForce(true);
      const strokeSW = mkSmudgeStroke();
      lsw.strokes.push(strokeSW);
      inkPaintCommittedStroke(lsw, strokeSW);
      await inkPaintIdle();
      const smudgeWorkerCanvas = inkEnsureItemCanvas(lsw);
      const smudgeWorkerHash = checksumCanvas(smudgeWorkerCanvas);
      const smudgeWorkerPx = countCanvas(smudgeWorkerCanvas);
      const lss = inkMakeLayer({ kind: 'attached', ownerId: it.id, name: 'Smudge parity sync' });
      state.ink.layers.push(lss);
      paintSmudgeBackground(inkEnsureItemCanvas(lss));
      inkWorkerForce(false);
      const strokeSS = mkSmudgeStroke();
      lss.strokes.push(strokeSS);
      inkPaintCommittedStroke(lss, strokeSS);
      await inkPaintIdle();
      const smudgeSyncCanvas = inkEnsureItemCanvas(lss);
      const smudgeSyncHash = checksumCanvas(smudgeSyncCanvas);
      const smudgeSyncPx = countCanvas(smudgeSyncCanvas);
      inkRemoveLayer(lsw.id);
      inkRemoveLayer(lss.id);
      inkWorkerForce(true);

      inkWorkerForce(false);
      inkWorkerEnable(true);
      inkSetTool('transform');
      // Geçici test fırçasını ve seçili fırçayı eski hâline döndür.
      inkS.brushes = inkS.brushes.filter(b => b.id !== 'test-worker-soft');
      inkS.brushId = previousBrushId;
      return JSON.stringify({
        supported, smallSync, smallPainted, strokeCount,
        deterministicRepeat: repeatHashA === repeatHashB,
        stablePreviewPrefix: stablePrefixMatches,
        spacingJitterWorks,
        jobsDelta, appliedDelta, workerPainted, pendingAfter: sAfter.pending,
        workerStrokeColor: workerStroke ? workerStroke.color : '',
        afterUndoPx, syncPainted,
        eraserPainted, eraserApplied: sEraseAfter.applied - sEraseBefore.applied,
        beforeErasePx,
        staleDiscarded: sStaleAfter.discarded - sStaleBefore.discarded,
        staleApplied: sStaleAfter.applied - sStaleBefore.applied,
        stalePx, baselinePx, staleStrokes, baselineStrokes,
        justAfterUndoPx, undoRasterStats: Object.assign({}, inkUndoRaster.stats),
        undoDirtyAfter: !!(inkRuntime.dirtyLayers && inkRuntime.dirtyLayers.has(layer.id)),
        globalApplied: sGAfter.applied - sG.applied,
        globalJobs: sGAfter.jobs - sG.jobs,
        globalDiscarded: sGAfter.discarded - sG.discarded,
        globalPx, globalPending: sGAfter.pending,
        gTiles, gStrokes: g.strokes.length,
        chunkJobs: sChunk1.jobs - sChunk0.jobs,
        chunkApplied: sChunk1.applied - sChunk0.applied,
        chunkPending: sChunk1.pending,
        chunkBefore, chunkAfter, chunkSample, chunkCleared, chunkSync,
        parityWorkerPx, paritySyncPx,
        dynWorkerPx, dynSyncPx, dynWorkerHash, dynSyncHash,
        smudgeWorkerPx, smudgeSyncPx, smudgeWorkerHash, smudgeSyncHash,
      });
    })()`));

    check('worker raster destekleniyor', worker.supported, worker.supported ? 'OffscreenCanvas + worker' : 'desteklenmiyor');
    check('eşik altı vuruş worker\'a gitmiyor', worker.smallSync && worker.smallPainted > 0, `${worker.smallPainted}px · ${worker.jobsDelta} iş`);
    check('ağır vuruş worker kuyruğuna giriyor', worker.jobsDelta >= 1 && worker.appliedDelta >= 1, `${worker.jobsDelta} iş · ${worker.appliedDelta} uygulandı`);
    check('worker bitmap\'i katmana uygulandı', worker.workerPainted > 200 && worker.pendingAfter === 0, `${worker.workerPainted}px`);
    check('worker rasterı senkron rasterla taper dahil eşleşiyor',
      worker.syncPainted > 200 && Math.abs(worker.syncPainted - worker.workerPainted) <= worker.syncPainted * 0.2,
      `${worker.workerPainted}px / senkron ${worker.syncPainted}px`);
    check('worker sonrası geri al pikselleri kaldırıyor', worker.afterUndoPx < worker.workerPainted * 0.5, `${worker.workerPainted} → ${worker.afterUndoPx}px`);
    check('worker silgi pikselleri siliyor', worker.eraserApplied >= 1 && worker.eraserPainted < worker.beforeErasePx * 0.95, `${worker.beforeErasePx} → ${worker.eraserPainted}px`);
    check('worker dönerken geri al geç sonucu atıyor',
      worker.staleDiscarded >= 1 && worker.staleStrokes === worker.baselineStrokes && worker.stalePx <= worker.baselinePx * 1.05,
      `atılan ${worker.staleDiscarded} · uygulanan ${worker.staleApplied} · ${worker.baselinePx} → ${worker.stalePx}px ` +
      `(undo ${worker.justAfterUndoPx} · kirli=${worker.undoDirtyAfter} · ${JSON.stringify(worker.undoRasterStats)})`);
    check('global katman karoları worker ile birleşiyor',
      worker.globalApplied >= 1 && worker.globalPx > 200 && worker.globalPending === 0,
      `${worker.globalPx}px · karo ${worker.gTiles} · vuruş ${worker.gStrokes} · iş ${worker.globalJobs} · atılan ${worker.globalDiscarded}`);
    check('2048² üstü bölge worker parçalarına bölünüyor',
      worker.chunkJobs >= 2 && worker.chunkApplied >= 2 && worker.chunkPending === 0,
      `${worker.chunkJobs} iş · ${worker.chunkApplied} uygulandı`);
    check('parçalı worker rasterı dikiliyor ve mevcut karoyu koruyor',
      worker.chunkAfter >= worker.chunkBefore &&
      worker.chunkSample > 0 && worker.chunkCleared === 0 &&
      Math.abs(worker.chunkSample - worker.chunkSync) <= Math.max(40, worker.chunkSync * 0.2),
      `${worker.chunkBefore} → ${worker.chunkAfter}px · örnek ${worker.chunkSample} / senkron ${worker.chunkSync} · silinen ${worker.chunkCleared}`);
    check('worker hız/akış/doku rasterı senkronla eşleşiyor',
      worker.paritySyncPx.n > 1000 &&
      Math.abs(worker.parityWorkerPx.n - worker.paritySyncPx.n) <= worker.paritySyncPx.n * 0.12,
      `${worker.parityWorkerPx.n}px/${worker.parityWorkerPx.sum} · senkron ${worker.paritySyncPx.n}px/${worker.paritySyncPx.sum}`);
    check('worker dinamik fırça rasterı senkronla bayt birebir eşleşiyor',
      worker.dynWorkerHash === worker.dynSyncHash &&
      worker.dynWorkerPx.n > 1000 && worker.dynSyncPx.n > 1000,
      `${worker.dynWorkerPx.n}px ↔ ${worker.dynSyncPx.n}px · hash ${worker.dynWorkerHash} / ${worker.dynSyncHash}`);
    check('worker smudge advected alanı senkronla bayt birebir eşleşiyor',
      worker.smudgeWorkerHash === worker.smudgeSyncHash &&
      worker.smudgeWorkerPx.n > 1000 && worker.smudgeSyncPx.n > 1000,
      `${worker.smudgeWorkerPx.n}px ↔ ${worker.smudgeSyncPx.n}px · hash ${worker.smudgeWorkerHash} / ${worker.smudgeSyncHash}`);
    check('aynı fırça vuruşu tekrarlı rasterda aynı sonucu veriyor',
      worker.deterministicRepeat, `deterministik: ${worker.deterministicRepeat}`);
    check('yeni nokta önceki kararlı önizleme damlalarını değiştirmiyor',
      worker.stablePreviewPrefix, `ön ek sabit: ${worker.stablePreviewPrefix}`);
    check('damla aralığı jitter ile değişiyor ve tekrar rasterda aynı kalıyor',
      worker.spacingJitterWorks, `deterministik aralık jitter: ${worker.spacingJitterWorks}`);

    // ---------------------------------------------------------------
    // 13) P1: tam anlık görüntü geri alması artımlı tazeliyor
    // ---------------------------------------------------------------
    // Not: alt eval'ler tamamen senkron; ağır undo tazeliği 30 sn'yi aşabilir.
    // Gerçek sonsuz döngü ile yavaşlığı ayırt etmek için deadline 120 sn.
    // Prep üç mikro eval'e bölündü: hangi tek çağrının yumruyor netlik kazanır.
    const restoreA = JSON.parse(await evaluate(ws, `(() => {
      const it = state.items.find(i => i.kind === 'image');
      if (!it) return JSON.stringify({ found: false });
      if (typeof inkCloseTransientUi === 'function') inkCloseTransientUi();
      if (!inkScopeActiveFor(it.id)) inkEnterImageScope(it.id);
      window.__smokeRestoreCtx = { itemId: it.id };
      return JSON.stringify({ found: true, prepOk: true });
    })()`, 120000));
    await evaluate(ws, `inkWorkerEnable(false); 'ok'`, 120000);
    await evaluate(ws, `inkCancelStroke(); 'ok'`, 120000);
    // 13b) Katman kurulumu: iki vuruş + tuval + tam rebuild (senkron).
    const restoreA2 = JSON.parse(await evaluate(ws, `(() => {
      const st = window.__smokeRestoreCtx;
      if (!st) return JSON.stringify({ ok: false });
      const it = state.items.find(i => i.id === st.itemId);
      const mkLayer = (name, kind) => {
        const l = inkMakeLayer({ kind, ownerId: kind === 'attached' ? it.id : null, name });
        state.ink.layers.push(l);
        inkSetActiveLayer(l.id);
        return l;
      };
      let rl = mkLayer('Restore', 'attached');
      st.layerId = rl.id;
      rl.strokes.push({
        id: 'sk_restore_a', kind: 'stroke', tool: 'brush', color: '#44dd88', size: 0.02,
        opacity: 1, hardness: 1, spacing: 0.1, brushId: 'ink-hard',
        points: [{ x: 0.18, y: 0.5, p: 1 }, { x: 0.24, y: 0.52, p: 1 }, { x: 0.3, y: 0.5, p: 1 }],
      });
      rl.strokes.push({
        id: 'sk_restore_b', kind: 'stroke', tool: 'brush', color: '#44dd88', size: 0.02,
        opacity: 1, hardness: 1, spacing: 0.1, brushId: 'ink-hard',
        points: [{ x: 0.66, y: 0.5, p: 1 }, { x: 0.72, y: 0.52, p: 1 }, { x: 0.78, y: 0.5, p: 1 }],
      });
      inkEnsureItemCanvas(rl);
      inkRebuildItemLayer(rl);
      inkRuntime.dirtyLayers.delete(rl.id);
      return JSON.stringify({ ok: true, setupOk: true, layerId: rl.id });
    })()`, 120000));

    const restoreA3 = JSON.parse(await evaluate(ws, `(() => {
      const st = window.__smokeRestoreCtx;
      if (!st) return JSON.stringify({ ok: false });
      const it = state.items.find(i => i.id === st.itemId);
      const canvas = inkRuntime.itemCanvases.get(st.layerId);
      const ctx = canvas.getContext('2d');
      const alphaAt = (xr0, xr1) => {
        const px = Math.max(0, Math.floor(xr0 * canvas.width));
        const pw = Math.max(1, Math.min(canvas.width - px, Math.ceil((xr1 - xr0) * canvas.width)));
        const py = Math.floor(0.4 * canvas.height);
        const ph = Math.max(1, Math.min(canvas.height - py, Math.ceil(0.2 * canvas.height)));
        const d = ctx.getImageData(px, py, pw, ph).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1;
        return n;
      };
      const counters = () => {
        const c = inkPerfSnapshot().counters;
        return {
          rebuild: c.rebuildCount || 0,
          dirty: c.dirtyFlushes || 0,
          redraws: c.dirtyRedraws || 0,
          touched: c.restoreTouchedLayers || 0,
          incremental: c.incrementalRestores || 0,
          full: c.fullRestores || 0,
        };
      };

      // 1) Öğe taşıma: vuruş verisi değişmez → raster maliyeti sıfır olmalı.
      const aBefore = alphaAt(0.16, 0.32);
      const bBefore = alphaAt(0.64, 0.8);
      const c0 = counters();
      pushUndo();
      const ox = it.x;
      it.x += 96;
      syncAll();
      const t0 = performance.now();
      undo();
      const moveMs = performance.now() - t0;
      const c1 = counters();
      const sameCanvas = inkRuntime.itemCanvases.get(st.layerId) === canvas;
      const moveOk = Math.abs(getItem(it.id).x - ox) < 0.001;
      const aAfterMove = alphaAt(0.16, 0.32);
      const bAfterMove = alphaAt(0.64, 0.8);

      window.__smokeRestoreCtx = { layerId: st.layerId, itemId: st.itemId };
      return JSON.stringify({
        ok: true,
        moveMs: Math.round(moveMs * 10) / 10,
        moveOk, sameCanvas,
        aBefore, bBefore, aAfterMove, bAfterMove,
        restoreRebuild: c1.rebuild - c0.rebuild,
        restoreIncremental: c1.incremental - c0.incremental,
        restoreFull: c1.full - c0.full,
      });
    })()`, 120000));

    const restoreB = JSON.parse(await evaluate(ws, `(() => {
      const st = window.__smokeRestoreCtx;
      if (!st) return JSON.stringify({ ok: false });
      const it = state.items.find(i => i.id === st.itemId);
      let rl = inkLayerById(st.layerId);
      const canvas = inkRuntime.itemCanvases.get(st.layerId);
      const ctx = canvas.getContext('2d');
      const alphaAt = (x0, x1) => {
        const px = Math.max(0, Math.floor(x0 * canvas.width));
        const pw = Math.max(1, Math.min(canvas.width - px, Math.ceil((x1 - x0) * canvas.width)));
        const py = Math.floor(0.4 * canvas.height);
        const ph = Math.max(1, Math.min(canvas.height - py, Math.ceil(0.2 * canvas.height)));
        const d = ctx.getImageData(px, py, pw, ph).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1;
        return n;
      };
      const counters = () => {
        const c = inkPerfSnapshot().counters;
        return {
          rebuild: c.rebuildCount || 0,
          dirty: c.dirtyFlushes || 0,
          redraws: c.dirtyRedraws || 0,
          touched: c.restoreTouchedLayers || 0,
          incremental: c.incrementalRestores || 0,
          full: c.fullRestores || 0,
        };
      };

      // 2) Vuruş taşıma (kement/gizmo): yalnızca değişen bölge tazelensin.
      const oldX = rl.strokes[0].points[0].x;
      const c2 = counters();
      pushUndo();
      const beforeBounds = inkStrokeWorldBounds(rl, rl.strokes[0]);
      rl.strokes[0].points = rl.strokes[0].points.map(p => ({ ...p, x: p.x + 0.09 }));
      const afterBounds = inkStrokeWorldBounds(rl, rl.strokes[0]);
      inkMarkLayerDirty(rl, inkUnionRect(beforeBounds, afterBounds));
      inkFlushDirtyLayers();
      const aMoved = alphaAt(0.27, 0.41);
      const t1 = performance.now();
      undo();
      const strokeMs = performance.now() - t1;
      const c3 = counters();
      rl = inkLayerById(st.layerId);
      const restored = Math.abs(rl.strokes[0].points[0].x - oldX) < 0.0005;
      const aRestored = alphaAt(0.16, 0.32);
      const bKept = alphaAt(0.64, 0.8);
      const overlapping = alphaAt(0.27, 0.41);

      return JSON.stringify({
        ok: true,
        strokeMs: Math.round(strokeMs * 10) / 10,
        strokeRebuild: c3.rebuild - c2.rebuild,
        strokeRedraws: c3.redraws - c2.redraws,
        strokeTouched: c3.touched - c2.touched,
        restored, aRestored, bKept, aMoved, overlapping,
      });
    })()`, 120000));

    const restoreC = JSON.parse(await evaluate(ws, `(() => {
      const st = window.__smokeRestoreCtx;
      if (!st) return JSON.stringify({ ok: false });
      const it = state.items.find(i => i.id === st.itemId);
      const mkLayer = (name, kind) => {
        const l = inkMakeLayer({ kind, ownerId: kind === 'attached' ? it.id : null, name });
        state.ink.layers.push(l);
        inkSetActiveLayer(l.id);
        return l;
      };
      const counters = () => {
        const c = inkPerfSnapshot().counters;
        return {
          rebuild: c.rebuildCount || 0,
          dirty: c.dirtyFlushes || 0,
          redraws: c.dirtyRedraws || 0,
          touched: c.restoreTouchedLayers || 0,
          incremental: c.incrementalRestores || 0,
          full: c.fullRestores || 0,
        };
      };

      // 3) Silinen global katman geri gelince yalnızca o katman kurulsun.
      const g = mkLayer('Restore global', 'global');
      g.strokes.push({
        id: 'sk_restore_g', kind: 'stroke', tool: 'brush', color: '#ffaa33', size: 24,
        opacity: 1, hardness: 1, spacing: 0.1, brushId: 'ink-hard',
        points: [{ x: 40, y: 40, p: 1 }, { x: 180, y: 90, p: 1 }],
      });
      inkRebuildGlobalLayer(g);
      const gBefore = [...inkRuntime.tiles.values()].filter(t => t.layerId === g.id).length;
      const c4 = counters();
      pushUndo();
      state.ink.layers = state.ink.layers.filter(l => l.id !== g.id);
      inkSyncDom();
      inkDirtyReset();
      const gGone = [...inkRuntime.tiles.values()].filter(t => t.layerId === g.id).length;
      const t2 = performance.now();
      undo();
      const layerMs = performance.now() - t2;
      const c5 = counters();
      const gTiles = [...inkRuntime.tiles.values()].filter(t => t.layerId === g.id).length;
      const gBack = !!inkLayerById(g.id);

      return JSON.stringify({
        ok: true,
        layerMs: Math.round(layerMs * 10) / 10,
        layerTouched: c5.touched - c4.touched,
        layerRebuild: c5.rebuild - c4.rebuild,
        gBefore, gGone, gTiles, gBack,
      });
    })()`, 120000));

    // 4) Bulk üç eval'e bölündü: kurum / taşıma-undo / temizlik.
    // Ayrıca eski tekil gövdedeki `g.id` kapsam dışı hatası düzeltildi
    // (g yalnızca restoreC'de tanımlıydı; bırakma seti stash kullanır).
    const restoreD1 = JSON.parse(await evaluate(ws, `(() => {
      const st = window.__smokeRestoreCtx;
      if (!st) return JSON.stringify({ ok: false });
      const it = state.items.find(i => i.id === st.itemId);
      const mkLayer = (name, kind) => {
        const l = inkMakeLayer({ kind, ownerId: kind === 'attached' ? it.id : null, name });
        state.ink.layers.push(l);
        inkSetActiveLayer(l.id);
        return l;
      };

      // 4a) 3000 vuruşlu Bulk katmanı kur.
      const t0 = performance.now();
      const bulk = mkLayer('Bulk', 'attached');
      st.bulkId = bulk.id;
      for (let i = 0; i < 3000; i++) {
        const x = 0.04 + (i % 100) * 0.009;
        const y = 0.06 + Math.floor(i / 100) * 0.028;
        bulk.strokes.push({
          // Doküman birimi: 0.00625 ≈ 5 px (800 px tuval referansı).
          // Eski 'size: 5' doküman biriminde 4000 px damga üretiyordu:
          // 3000 vuruş × ~120 ms senkron rebuild → renderer ~6 dk bloke
          // (%100 CPU, RAM şişmesi) — smoke'un "meşgul döngü" kök nedeni.
          id: 'sk_bulk_' + i, kind: 'stroke', tool: 'brush', color: '#8899ff', size: 0.00625,
          opacity: 1, hardness: 1, spacing: 0.1, brushId: 'ink-hard',
          points: [{ x, y, p: 1 }, { x: x + 0.004, y: y + 0.004, p: 1 }],
        });
      }
      inkEnsureItemCanvas(bulk);
      const ensureMs = Math.round((performance.now() - t0) * 10) / 10;
      return JSON.stringify({ ok: true, bulkBuilt: true, ensureMs });
    })()`, 120000));

    // Tam rebuild: kalıcı katman rasterına 3000 vuruş yazılır.
    const restoreD1r = JSON.parse(await evaluate(ws, `(() => {
      const st = window.__smokeRestoreCtx;
      if (!st) return JSON.stringify({ ok: false });
      const bulk = inkLayerById(st.bulkId);
      const t1 = performance.now();
      inkRebuildItemLayer(bulk);
      const rebuildMs = Math.round((performance.now() - t1) * 10) / 10;
      return JSON.stringify({ ok: true, rebuildMs });
    })()`, 600000));

    const restoreD2 = JSON.parse(await evaluate(ws, `(() => {
      const st = window.__smokeRestoreCtx;
      if (!st) return JSON.stringify({ ok: false });
      const it = state.items.find(i => i.id === st.itemId);
      const counters = () => {
        const c = inkPerfSnapshot().counters;
        return {
          rebuild: c.rebuildCount || 0,
          touched: c.restoreTouchedLayers || 0,
        };
      };

      // 4b) Öğe taşıma geri alması (P1 kabul ölçütü).
      const cB = counters();
      pushUndo();
      getItem(it.id).x += 12;
      syncAll();
      const tb = performance.now();
      undo();
      const bulkMs = performance.now() - tb;
      const cB2 = counters();
      return JSON.stringify({
        ok: true,
        bulkMs: Math.round(bulkMs * 10) / 10,
        bulkRebuild: cB2.rebuild - cB.rebuild,
        bulkTouched: cB2.touched - cB.touched,
      });
    })()`, 120000));

    const restoreD3 = JSON.parse(await evaluate(ws, `(() => {
      const st = window.__smokeRestoreCtx;
      if (!st) return JSON.stringify({ ok: false });

      // 4c) Test katmanlarını bırak.
      const drop = new Set([st.layerId, st.bulkId]);
      state.ink.layers = state.ink.layers.filter(l => !drop.has(l.id));
      inkSyncDom();
      inkDirtyReset();
      undoStack.length = 0;
      redoStack.length = 0;
      inkWorkerEnable(true);
      delete window.__smokeRestoreCtx;
      return JSON.stringify({ ok: true });
    })()`, 120000));

    const restore = Object.assign({}, restoreA, restoreA2, restoreA3, restoreB, restoreC, restoreD1, restoreD1r, restoreD2, restoreD3);

    check('tam geri alma testi görsel buldu', restore.found, restore.found ? '' : 'görsel yok');
    check('öğe taşıma geri alması katmanı yeniden rasterlemiyor',
      restore.moveOk && restore.restoreRebuild === 0 && restore.restoreIncremental >= 1 && restore.restoreFull === 0,
      `raster ${restore.restoreRebuild} · artımlı ${restore.restoreIncremental} · ${restore.moveMs} ms`);
    check('öğe taşıma geri alması tuvali ve pikselleri koruyor',
      restore.sameCanvas && restore.aAfterMove === restore.aBefore && restore.bAfterMove === restore.bBefore,
      `tuval ${restore.sameCanvas ? 'aynı' : 'yeni'} · ${restore.aBefore}/${restore.bBefore} → ${restore.aAfterMove}/${restore.bAfterMove}px`);
    check('vuruş taşıma geri alması yalnızca değişen bölgeyi tazeliyor',
      restore.strokeTouched === 1 && restore.strokeRedraws >= 1 && restore.strokeRebuild === 0,
      `dokunulan ${restore.strokeTouched} · kısmi ${restore.strokeRedraws} · raster ${restore.strokeRebuild} · ${restore.strokeMs} ms`);
    check('vuruş taşıma geri alması komşu vuruşu koruyor',
      restore.restored && restore.aRestored >= restore.aBefore * 0.9 && restore.bKept === restore.bBefore && restore.overlapping < restore.aMoved,
      `eski x ${restore.aBefore} → ${restore.aRestored}px · komşu ${restore.bBefore} → ${restore.bKept}px · taşan ${restore.aMoved} → ${restore.overlapping}px`);
    check('silinen katman geri gelince yalnızca o katman kuruluyor',
      restore.gGone === 0 && restore.gTiles > 0 && restore.gBack && restore.layerTouched === 1 && restore.layerRebuild >= 1,
      `karo ${restore.gBefore} → ${restore.gGone} → ${restore.gTiles} · dokunulan ${restore.layerTouched} · raster ${restore.layerRebuild} · geri ${restore.gBack} · ${restore.layerMs} ms`);
    // Süre eşiği duvar saati ölçümü: boşta ~20-25 ms; yüklü makinelerde
    // (OneDrive/kaynak taraması/arka plan probe'ları) 120 ms'ye sallanıyor
    // (61.4 ms gözlenir). KABUL ÖLÇÜTÜ: 3000 vuruş undo'da raster işi
    // sıfır — dokunulan=0, rebuild=0 (bunlar sert eşik, süre toleranslı).
    check('3000 vuruşta öğe taşıma geri alması raster işlemeden tamamlanıyor',
      restore.bulkTouched === 0 && restore.bulkRebuild === 0 && restore.bulkMs < 150,
      `dokunulan ${restore.bulkTouched} · raster ${restore.bulkRebuild} · ${restore.bulkMs} ms`);

    // ---------------------------------------------------------------
    // 14) P2: damlalık örnekleme önbelleği (görsel başına LRU)
    // ---------------------------------------------------------------
    const sample = JSON.parse(await evaluate(ws, `(() => {
      const it = state.items.filter(i => i.kind === 'image').slice(-1)[0];
      if (!it) return JSON.stringify({ found: false });
      if (typeof inkCloseTransientUi === 'function') inkCloseTransientUi();
      if (!inkScopeActiveFor(it.id)) inkEnterImageScope(it.id);

      // Yalnızca görselin kendi pikselini örnekle: çizim katmanlarını geçici gizle.
      const ink = inkState();
      const vis = ink.layers.map(l => l.visible);
      ink.layers.forEach(l => { l.visible = false; });
      inkSampleCacheClear();

      const spot = inkLocalToScreen({ kind: 'attached', ownerId: it.id }, { x: 0.5, y: 0.5 });
      const c1 = inkSampleColor(spot.x, spot.y);
      const s1 = inkSampleCacheInfo();
      const c2 = inkSampleColor(spot.x, spot.y);
      const s2 = inkSampleCacheInfo();

      ink.layers.forEach((l, i) => { l.visible = vis[i]; });

      // Referans: tam boy görseldeki aynı piksel.
      const cached = imgCache.get(it.imageId);
      let ref = '';
      let near = false;
      if (cached && cached.img && cached.img.naturalWidth) {
        const tmp = document.createElement('canvas');
        tmp.width = cached.img.naturalWidth;
        tmp.height = cached.img.naturalHeight;
        tmp.getContext('2d').drawImage(cached.img, 0, 0);
        ref = inkReadCanvasPixel(tmp, Math.floor(tmp.width * 0.5), Math.floor(tmp.height * 0.5)) || '';
        const rgb = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0);
        const a = rgb(c1), b = rgb(ref);
        near = !!ref && a.every((v, i) => Math.abs(v - b[i]) <= 8);
      }
      return JSON.stringify({ found: true, c1, c2, ref, near, s1, s2, size: inkSampleCacheInfo().size });
    })()`));

    check('damlalık görsel pikselini örnekliyor',
      sample.found && sample.c2 === sample.c1 && sample.near,
      `${sample.c1} / referans ${sample.ref}`);
    check('damlalık örnekleme tuvali önbelleğe alınıyor',
      sample.s1 && sample.s1.misses === 1 && sample.s1.hits === 0 &&
      sample.s2 && sample.s2.hits === 1 && sample.s2.misses === 1 && sample.size === 1,
      `ilk ${sample.s1 && sample.s1.hits}/${sample.s1 && sample.s1.misses} · sonra ${sample.s2 && sample.s2.hits}/${sample.s2 && sample.s2.misses} · boyut ${sample.size}`);

    // ---------------------------------------------------------------
    // 15) P2: büyük fırçalarda (128 px üstü) damga kalitesi
    // ---------------------------------------------------------------
    const big = JSON.parse(await evaluate(ws, `(() => {
      const brush = inkGetBrush('ink-soft');
      inkStampClear();
      const res = [90, 200, 700, 1600].map(inkTipRes);

      const s700 = inkStampFor(brush, '#ff3366', 0.55, 700, false);

      // Damga tuvalini oku: kenar geçişi ve yuvarlaklık.
      const W = s700.canvas.width;
      const ctx = s700.canvas.getContext('2d');
      const d = ctx.getImageData(0, 0, W, W).data;
      const alphaAt = (x, y) => d[(y * W + x) * 4 + 3];
      const mid = (W / 2) | 0;

      // Alfa 200 → 20 arasındaki geçiş genişliği.
      let r200 = 0, r20 = 0;
      for (let x = mid; x < W; x++) {
        const a = alphaAt(x, mid);
        if (!r200 && a < 200) r200 = x - mid;
        if (!r20 && a < 20) { r20 = x - mid; break; }
      }

      // 72 açıda alfa 128 eşiğinin yarıçapı: kenar ne kadar düzgün?
      const radii = [];
      for (let i = 0; i < 72; i++) {
        const ang = i / 72 * Math.PI * 2;
        let last = 0;
        for (let r = W * 0.35; r < W * 0.55; r += 0.5) {
          const x = Math.round(mid + Math.cos(ang) * r);
          const y = Math.round(mid + Math.sin(ang) * r);
          if (x < 0 || y < 0 || x >= W || y >= W) break;
          if (alphaAt(x, y) < 128) break;
          last = r;
        }
        radii.push(last);
      }
      const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
      const sd = Math.sqrt(radii.reduce((a, b) => a + (b - mean) * (b - mean), 0) / radii.length);

      // Aynı damga 700 px çapa çizildiğinde kenar yarıçapı doğru mu?
      const shot = document.createElement('canvas');
      shot.width = shot.height = 800;
      const sx = shot.getContext('2d');
      const sizeBrush = Object.assign({}, brush, {
        texture: false, textureDepth: 0, scatter: 0, scatterX: 0, scatterY: 0,
      });
      const direct = document.createElement('canvas');
      direct.width = direct.height = 800;
      inkDrawTiltedStamp(direct.getContext('2d'), s700.canvas, 400, 400, 350, 0, 0, 1);
      const directPixels = direct.getContext('2d').getImageData(0, 0, 800, 800).data;
      let directEdge = 0;
      for (let x = 400; x < 800; x++) {
        if (directPixels[(400 * 800 + x) * 4 + 3] < 128) { directEdge = x - 400; break; }
      }
      inkDrawStrokeOnContext(sx, {
        id: 'big', kind: 'stroke', tool: 'brush', color: '#ff3366',
        size: 700, opacity: 1, hardness: 0.55, spacing: 1,
        flow: 1, brushId: brush.id, points: [{ x: 400, y: 400, p: 1 }],
      }, {
        mapPoint: p => ({ x: p.x, y: p.y }),
        sizePx: 700,
        brush: sizeBrush,
      });
      const sd2 = sx.getImageData(0, 0, 800, 800).data;
      let edge = 0;
      for (let x = 400; x < 800; x++) {
        if (sd2[(400 * 800 + x) * 4 + 3] < 128) { edge = x - 400; break; }
      }

      // Bellek bütçesi: çok sayıda 1024² damga LRU ile sınırlanmalı.
      for (let i = 0; i < 10; i++) inkStampFor(brush, '#00ff' + (16 + i), 0.55, 900, false);
      const mem = inkStampCacheInfo();

      return JSON.stringify({
        res, size: s700.size, bytes: s700.bytes,
        r200, r20, sd: Math.round(sd * 100) / 100,
        mean: Math.round(mean * 10) / 10, edge, directEdge,
        calculatedRadius: inkDabRadius(700, sizeBrush, 1, 0, 0, 350), mem,
      });
    })()`));

    check('büyük fırçada uç hedef çözünürlükte üretiliyor',
      big.res[0] === 128 && big.res[1] === 256 && big.res[2] === 1024 && big.res[3] === 1024 &&
      big.size === 1024 && big.bytes === 1024 * 1024 * 4,
      `uç ${big.res.join('/')} · damga ${big.size} · ${Math.round(big.bytes / 1048576 * 10) / 10} MB`);
    check('büyük damga kenarı yuvarlak ve geçişli',
      big.sd > 0 && big.sd <= 1.2 && big.r200 > 0 && big.r20 > big.r200 &&
      big.mean > 340 && big.mean < 400,
      `yarıçap ${big.mean} · sapma ${big.sd} px · geçiş ${big.r200}→${big.r20}`);
    check('700 px damga doğru çapta çiziliyor',
      Math.abs(big.edge - big.mean * (350 / 512)) <= Math.max(3, big.mean * (350 / 512) * 0.03),
      `kenar ${big.edge} px (beklenen ~${Math.round(big.mean * (350 / 512))} · direkt ${big.directEdge} · r ${big.calculatedRadius})`);
    check('damga atlası bayt bütçesini aşmıyor',
      big.mem.bytes <= 32 * 1024 * 1024 && big.mem.evictions >= 1 && big.mem.size <= 96,
      `${big.mem.mb} MB · ${big.mem.size} damga · ${big.mem.evictions} atılan`);

    // ---------------------------------------------------------------
    // 16) P2: .abr dinamikleri (desc/cbsh, computed fırça, çift fırça)
    // ---------------------------------------------------------------
    const abrDyn = JSON.parse(await evaluate(ws, `(() => {
      const buf = [];
      const u16 = n => buf.push((n >> 8) & 255, n & 255);
      const u32 = n => buf.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      const patch32 = (pos, n) => {
        buf[pos] = (n >>> 24) & 255; buf[pos + 1] = (n >>> 16) & 255;
        buf[pos + 2] = (n >>> 8) & 255; buf[pos + 3] = n & 255;
      };
      const ascii = s => { for (let i = 0; i < s.length; i++) buf.push(s.charCodeAt(i) & 255); };
      const uni = s => {
        u32(s.length);
        for (let i = 0; i < s.length; i++) u16(s.charCodeAt(i));
      };
      const f64 = n => {
        const t = new Uint8Array(8);
        new DataView(t.buffer).setFloat64(0, n);
        for (let i = 0; i < 8; i++) buf.push(t[i]);
      };
      const key4 = k => uni(k);
      const num = (k, unit, v) => { key4(k); ascii('UntF'); ascii(unit); f64(v); };
      const descriptor = (cls, fields) => {
        uni(cls);
        const countPos = buf.length;
        u32(0);
        fields.forEach(f => f());
        patch32(countPos, fields.length);
      };
      const obj = (k, cls, fields) => { key4(k); ascii('Objc'); descriptor(cls, fields); };
      const block = (tag, payload) => {
        ascii('8BIM'); ascii(tag);
        const sizePos = buf.length;
        u32(0);
        const start = buf.length;
        payload();
        patch32(sizePos, buf.length - start);
        while (buf.length % 4) buf.push(0);
      };

      u16(6); u16(1);
      block('desc', () => {
        u32(1);
        descriptor('brushPreset', [
          () => { key4('Nm  '); ascii('TEXT'); uni('Test Fırça'); },
        ]);
      });
      block('cbsh', () => {
        u32(16);
        descriptor('computedBrush', [
          () => num('Dmtr', '#Pxl', 200),
          () => num('Hrdn', '#Prc', 80),
          () => num('Spcn', '#Prc', 25),
        ]);
      });
      block('cbsh', () => {
        u32(16);
        descriptor('computedBrush', [
          () => num('Dmtr', '#Pxl', 200),
          () => num('Hrdn', '#Prc', 60),
          () => num('Spcn', '#Prc', 10),
          () => num('SzVr', '#Prc', 60),
          () => num('AnVr', '#Prc', 40),
          () => num('ScVr', '#Prc', 20),
          () => obj('Dual', 'dualBrush', [
            () => num('Dmtr', '#Pxl', 80),
            () => num('Hrdn', '#Prc', 50),
          ]),
        ]);
      });

      window.__abrTest = buf;
      const tips = inkParseAbr(new Uint8Array(buf).buffer);
      return JSON.stringify({ tips, err: inkRuntime.lastAbrError || '' });
    })()`));


    const t0 = abrDyn.tips[0] || {};
    const t1 = abrDyn.tips[1] || {};
    check('.abr desc + cbsh blokları ayrıştırıldı',
      abrDyn.tips.length === 2 && t0.kind === 'cbsh' && t0.name === 'Test Fırça' &&
      t0.width === 200 && Math.abs(t0.hardness - 0.8) < 0.01 && Math.abs(t0.spacing - 0.25) < 0.01,
      `${abrDyn.tips.length} fırça · "${t0.name}" ${t0.width} px · sertlik ${t0.hardness} · aralık ${t0.spacing}${abrDyn.err ? ' · hata: ' + abrDyn.err : ''}`);
    check('.abr dinamiği ve çift fırçası okunuyor',
      t1.kind === 'cbsh' && Math.abs(t1.dynamics.sizeMin - 0.4) < 0.01 &&
      Math.abs(t1.dynamics.angleJitter - 0.4) < 0.01 &&
      Math.abs(t1.dynamics.scatterJitter - 0.2) < 0.01 &&
      t1.dual && Math.abs(t1.dual.scale - 0.4) < 0.01 && Math.abs(t1.dual.hardness - 0.5) < 0.01,
      `boyut ${t1.dynamics && t1.dynamics.sizeMin} · açı ${t1.dynamics && t1.dynamics.angleJitter} · saçılma ${t1.dynamics && t1.dynamics.scatterJitter} · çift ${t1.dual && t1.dual.scale}`);

    const dynDraw = JSON.parse(await evaluate(ws, `(() => {
      const ink = inkState();
      const make = (id, extra) => inkNormalizeBrush(Object.assign({
        id, name: id, kind: 'procedural', hardness: 0.9, spacing: 0.1, scatter: 0,
      }, extra));
      const draw = (brush, points, sizePx) => {
        ink.brushes.push(brush);
        const cv = document.createElement('canvas');
        cv.width = cv.height = 500;
        inkDrawStrokeOnContext(cv.getContext('2d'), {
          id: 'd_' + brush.id, kind: 'stroke', tool: 'brush', color: '#ffffff',
          size: sizePx, opacity: 1, hardness: 0.9, spacing: 0.1,
          brushId: brush.id, points,
        }, { mapPoint: p => ({ x: p.x, y: p.y }), sizePx });
        ink.brushes = ink.brushes.filter(b => b.id !== brush.id);
        return cv;
      };
      const data = cv => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const area = cv => {
        const d = data(cv); let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return n;
      };
      const inkSum = cv => {
        const d = data(cv); let s = 0;
        for (let i = 3; i < d.length; i += 4) s += d[i];
        return s;
      };
      const bbox = (cv, thr) => {
        const w = cv.width, h = cv.height, d = data(cv);
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] > thr) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
      };
      const changed = (a, b, thr) => {
        const da = data(a), db = data(b); let n = 0;
        for (let i = 3; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > thr) n++;
        return n;
      };

      inkStampClear();
      const sizeBrush = make('dyn_size', {
        dynamics: { sizeMin: 0.3, sizeMax: 1, src: 'pressure', angleJitter: 0, scatterJitter: 0 },
      });
      const areaHi = area(draw(sizeBrush, [{ x: 250, y: 250, p: 1 }], 200));
      const areaLo = area(draw(sizeBrush, [{ x: 250, y: 250, p: 0.2 }], 200));

      const flat = make('dyn_flat', { roundness: 0.35, angle: 0 });
      const vb = bbox(draw(flat, [{ x: 250, y: 250, p: 1 }], 200), 8);
      const flat2 = make('dyn_flat2', { roundness: 0.35, angle: Math.PI / 2 });
      const hb = bbox(draw(flat2, [{ x: 250, y: 250, p: 1 }], 200), 8);

      const noDual = make('dyn_single', { scatter: 0 });
      const withDual = make('dyn_dual', {
        scatter: 0,
        dual: { diameter: 90, scale: 0.9, spacing: 0.1, scatter: 0.8, hardness: 0.85 },
      });
      const line = [];
      for (let i = 0; i < 14; i++) line.push({ x: 70 + i * 26, y: 250 + (i % 3) * 4, p: 1 });
      const singleCv = draw(noDual, line, 90);
      const dualCv = draw(withDual, line, 90);
      const sumSingle = inkSum(singleCv);
      const sumDual = inkSum(dualCv);
      const dualPixels = changed(singleCv, dualCv, 8);
      const singleBox = bbox(singleCv, 8);
      const dualBox = bbox(dualCv, 8);

      return JSON.stringify({
        areaHi, areaLo, vb, hb, sumSingle, sumDual, dualPixels,
        singleBox, dualBox,
      });
    })()`));

    check('basınç dinamiği damla boyutunu değiştiriyor',
      dynDraw.areaHi > dynDraw.areaLo * 2,
      `${dynDraw.areaLo}px → ${dynDraw.areaHi}px (×${Math.round(dynDraw.areaHi / dynDraw.areaLo * 10) / 10})`);
    check('yuvarlaklık ve açı damgayı yassılaştırıyor',
      dynDraw.vb.w > 150 && dynDraw.vb.h < 110 &&
      dynDraw.hb.h > 150 && dynDraw.hb.w < 110,
      `0° ${dynDraw.vb.w}×${dynDraw.vb.h} · 90° ${dynDraw.hb.w}×${dynDraw.hb.h}`);
    check('çift fırça doku katıyor',
      dynDraw.sumDual > dynDraw.sumSingle &&
      dynDraw.dualPixels > 1500 &&
      (dynDraw.dualBox.w > dynDraw.singleBox.w || dynDraw.dualBox.h > dynDraw.singleBox.h),
      `tek ${Math.round(dynDraw.sumSingle / 1000)}k · çift ${Math.round(dynDraw.sumDual / 1000)}k · ` +
      `değişen ${dynDraw.dualPixels}px · kutu ${dynDraw.singleBox.w}×${dynDraw.singleBox.h} → ` +
      `${dynDraw.dualBox.w}×${dynDraw.dualBox.h}`);

    // ---------------------------------------------------------------
    // 17) P3: basınç eğrisi + hız dinamiği · P2: flow / texture
    // ---------------------------------------------------------------
    const p3 = JSON.parse(await evaluate(ws, `(() => {
      const ink = inkState();
      const make = (id, extra) => inkNormalizeBrush(Object.assign({
        id, name: id, kind: 'procedural', hardness: 0.6, spacing: 0.06, scatter: 0,
      }, extra));
      const draw = (brush, points, sizePx, speedSize, taperStart = 0, taperEnd = 0) => {
        ink.brushes.push(brush);
        const cv = document.createElement('canvas');
        cv.width = cv.height = 500;
        inkDrawStrokeOnContext(cv.getContext('2d'), {
          id: 'p3_' + brush.id, kind: 'stroke', tool: 'brush', color: '#ffffff',
          size: sizePx, opacity: 1, hardness: brush.hardness, spacing: brush.spacing,
          speedSize: speedSize || 0, taperStart, taperEnd, brushId: brush.id, points,
        }, { mapPoint: p => ({ x: p.x, y: p.y }), sizePx });
        ink.brushes = ink.brushes.filter(b => b.id !== brush.id);
        return cv;
      };
      const data = cv => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const area = cv => {
        const d = data(cv); let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return n;
      };
      const inkSum = cv => {
        const d = data(cv); let s = 0;
        for (let i = 3; i < d.length; i += 4) s += d[i];
        return s;
      };
      const changed = (a, b, thr) => {
        const da = data(a), db = data(b); let n = 0;
        for (let i = 3; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > thr) n++;
        return n;
      };

      // Panel bağlantısı
      const curveEl = document.getElementById('inkPressureCurve');
      const speedEl = document.getElementById('inkSpeedSize');
      curveEl.value = '200';
      curveEl.dispatchEvent(new Event('input', { bubbles: true }));
      speedEl.value = '60';
      speedEl.dispatchEvent(new Event('input', { bubbles: true }));
      const uiCurve = ink.pressureCurve;
      const uiSpeed = ink.speedSize;
      const uiCurveLabel = document.getElementById('inkPressureCurveVal').textContent;
      const uiSpeedLabel = document.getElementById('inkSpeedSizeVal').textContent;
      ink.pressureCurve = 1;
      ink.speedSize = 0;
      inkSyncUI();

      // Eğri matematiği
      const curveMath = {
        lin: inkCurvePressure(0.5, 1),
        hard: inkCurvePressure(0.5, 2),
        soft: inkCurvePressure(0.5, 0.5),
      };

      // Girdi yolu: kalem basıncı eğriden geçip noktaya yazılmalı.
      const prevActive = ink.activeLayerId;
      const prevTool = ink.tool;
      const prevAuto = ink.autoAttach;
      if (inkRuntime.imageScopeId) inkExitImageScope();
      ink.autoAttach = false;
      const testLayer = inkMakeLayer({ kind: 'global', plane: 'above', name: 'P3 test' });
      ink.layers.push(testLayer);
      ink.activeLayerId = testLayer.id;
      ink.tool = 'brush';
      ink.pressureCurve = 2;
      ink.speedSize = 0.6;
      const rect = stage.getBoundingClientRect();
      const ev = {
        pointerType: 'pen', pressure: 0.5,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        timeStamp: performance.now(), tiltX: 0, tiltY: 0,
      };
      const began = inkBeginFreehand(ev, 'brush', screenToWorld({ x: ev.clientX, y: ev.clientY }));
      const pointP = began && inkPointer && inkPointer.stroke ? inkPointer.stroke.points[0].p : -1;
      const strokeSpeed = began && inkPointer && inkPointer.stroke ? inkPointer.stroke.speedSize : -1;
      inkCancelStroke();
      inkRemoveLayer(testLayer.id);
      ink.activeLayerId = prevActive;
      ink.tool = prevTool;
      ink.autoAttach = prevAuto;
      ink.pressureCurve = 1;
      ink.speedSize = 0;

      // Normalize / kayıt turu
      const normStroke = inkNormalizeStroke({
        id: 'p3_norm', points: [{ x: 0.2, y: 0.2, p: 1, s: 0.75 }],
      });
      const normState = inkNormalizeState({ pressureCurve: 2.4, speedSize: 0.5, brushes: [], layers: [] });

      // Yol çizimi: hız/dinamik varken taper korunmalı (damla yoluna düşmeli).
      const hard = make('p3_hard', { hardness: 1, spacing: 0.07 });
      const hardStroke = {
        kind: 'stroke', tool: 'brush', hardness: 1, scatter: 0, speedSize: 0,
        points: [{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 0, p: 0.5 }],
      };
      const pathPlain = inkStrokePathEligible(hardStroke, hard, 40);
      hardStroke.speedSize = 0.6;
      const pathSpeed = inkStrokePathEligible(hardStroke, hard, 40);
      ink.brushes = ink.brushes.filter(b => b.id !== hard.id);

      // Hız incelmesi: aynı çizgi, s 0→1.
      const base = make('p3_base', {});
      const line = [];
      for (let i = 0; i <= 40; i++) {
        line.push({ x: 50 + i * 10, y: 250, p: 1, s: i / 40 });
      }
      const steadyArea = area(draw(base, line, 120, 0));
      const taperedArea = area(draw(base, line, 120, 0.7));

      const taperLine = [
        { x: 60, y: 180, p: 1 }, { x: 160, y: 180, p: 1 },
        { x: 260, y: 180, p: 1 }, { x: 360, y: 180, p: 1 },
        { x: 440, y: 180, p: 1 },
      ];
      const taperCanvas = draw(base, taperLine, 80, 0, 0.8, 0.8);
      const taperColumn = (canvas, x) => {
        const d = data(canvas); let count = 0;
        for (let y = 0; y < canvas.height; y++) if (d[(y * canvas.width + x) * 4 + 3] > 8) count++;
        return count;
      };
      const taperStartWidth = taperColumn(taperCanvas, 65);
      const taperMiddleWidth = taperColumn(taperCanvas, 250);
      const taperEndWidth = taperColumn(taperCanvas, 435);

      // Akış: tek damlada farkı ölç (çizgide üst üste binme farkı kapatıyor).
      const flowFull = make('p3_flow_full', { flow: 1 });
      const flowLow = make('p3_flow_low', { flow: 0.35 });
      const flowDot = [{ x: 250, y: 250, p: 1, s: 0 }];
      const sumFlowFull = inkSum(draw(flowFull, flowDot, 100, 0));
      const sumFlowLow = inkSum(draw(flowLow, flowDot, 100, 0));

      // Doku: aynı çizgi, grain açık/kapalı.
      const texOff = make('p3_tex_off', { texture: false });
      const texOn = make('p3_tex_on', {
        texture: true, textureDepth: 0.55, textureScale: 1.6,
      });
      const flowPts = [];
      for (let i = 0; i <= 30; i++) flowPts.push({ x: 60 + i * 12, y: 260, p: 1, s: 0 });
      const texOffCv = draw(texOff, flowPts, 90, 0);
      const texOnCv = draw(texOn, flowPts, 90, 0);
      const texPixels = changed(texOffCv, texOnCv, 8);
      const sumTexOff = inkSum(texOffCv);
      const sumTexOn = inkSum(texOnCv);

      ink.brushes = ink.brushes.filter(b => !b.id.startsWith('p3_'));

      return JSON.stringify({
        uiCurve, uiSpeed, uiCurveLabel, uiSpeedLabel, curveMath,
        began, pointP, strokeSpeed,
        normS: normStroke.points[0].s,
        normCurve: normState.pressureCurve, normSpeed: normState.speedSize,
        pathPlain, pathSpeed,
        steadyArea, taperedArea,
        taperStartWidth, taperMiddleWidth, taperEndWidth,
        sumFlowFull, sumFlowLow,
        texPixels, sumTexOff, sumTexOn,
      });
    })()`));

    check('fırça paneli basınç eğrisi ve hız ayarını bağlıyor',
      Math.abs(p3.uiCurve - 2) < 0.001 && Math.abs(p3.uiSpeed - 0.6) < 0.001 &&
      p3.uiCurveLabel === '2.00×' && p3.uiSpeedLabel === '60%',
      `eğri ${p3.uiCurveLabel} · hız ${p3.uiSpeedLabel}`);
    check('fırça kütüphanesinde özel fırça oluşturucu var', brushSettings.creatorControls);
    check('basınç eğrisi vuruş basıncını yeniden eğiyor',
      Math.abs(p3.curveMath.lin - 0.5) < 0.001 &&
      Math.abs(p3.curveMath.hard - 0.25) < 0.001 &&
      Math.abs(p3.curveMath.soft - 0.7071) < 0.002 &&
      p3.began && Math.abs(p3.pointP - 0.25) < 0.001,
      `0.5 @1=${p3.curveMath.lin} · @2=${p3.curveMath.hard} · @0.5=${p3.curveMath.soft} · nokta ${p3.pointP}`);
    check('hız incelmesi hızlı vuruşu inceltiyor',
      p3.taperedArea < p3.steadyArea * 0.8 && p3.taperedArea > 200,
      `${p3.steadyArea}px → ${p3.taperedArea}px`);
    check('başlangıç ve bitiş taper çizgiyi iki uçtan inceltiyor',
      p3.taperStartWidth < p3.taperMiddleWidth * 0.55 &&
      p3.taperEndWidth < p3.taperMiddleWidth * 0.55 &&
      p3.taperMiddleWidth > 10,
      `${p3.taperStartWidth}px / ${p3.taperMiddleWidth}px / ${p3.taperEndWidth}px`);
    check('akış (flow) damla opaklığını düşürüyor',
      p3.sumFlowLow < p3.sumFlowFull * 0.55,
      `toplam ${Math.round(p3.sumFlowFull / 1000)}k → ${Math.round(p3.sumFlowLow / 1000)}k`);
    check('doku (texture) vuruşa grain katıyor',
      p3.texPixels > 800 && p3.sumTexOn < p3.sumTexOff,
      `değişen ${p3.texPixels}px · toplam ${Math.round(p3.sumTexOff / 1000)}k → ${Math.round(p3.sumTexOn / 1000)}k`);
    check('hız alanı kayıt turunda korunuyor',
      Math.abs(p3.normS - 0.75) < 0.001 && Math.abs(p3.normCurve - 2.4) < 0.001 &&
      Math.abs(p3.normSpeed - 0.5) < 0.001 && Math.abs(p3.strokeSpeed - 0.6) < 0.001,
      `s ${p3.normS} · eğri ${p3.normCurve} · hız ${p3.normSpeed} · vuruş ${p3.strokeSpeed}`);
    check('hız/dinamik varken yol çizimi kullanılmıyor',
      p3.pathPlain === true && p3.pathSpeed === false,
      `yol ${p3.pathPlain} → ${p3.pathSpeed}`);

    // ---------------------------------------------------------------
    // 18) P2: gerçek çift fırça ucu (ikinci `samp` bitmap'i)
    // ---------------------------------------------------------------
    const dualAbr = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const buf = [];
      const u16 = n => buf.push((n >> 8) & 255, n & 255);
      const u32 = n => buf.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      const patch32 = (pos, n) => {
        buf[pos] = (n >>> 24) & 255; buf[pos + 1] = (n >>> 16) & 255;
        buf[pos + 2] = (n >>> 8) & 255; buf[pos + 3] = n & 255;
      };
      const ascii = s => { for (let i = 0; i < s.length; i++) buf.push(s.charCodeAt(i) & 255); };
      const uni = s => {
        u32(s.length);
        for (let i = 0; i < s.length; i++) u16(s.charCodeAt(i));
      };
      const f64 = n => {
        const t = new Uint8Array(8);
        new DataView(t.buffer).setFloat64(0, n);
        for (let i = 0; i < 8; i++) buf.push(t[i]);
      };
      const key4 = k => uni(k);
      const num = (k, unit, v) => { key4(k); ascii('UntF'); ascii(unit); f64(v); };
      const descriptor = (cls, fields) => {
        uni(cls);
        const countPos = buf.length;
        u32(0);
        fields.forEach(f => f());
        patch32(countPos, fields.length);
      };
      const obj = (k, cls, fields) => { key4(k); ascii('Objc'); descriptor(cls, fields); };
      const block = (tag, payload) => {
        ascii('8BIM'); ascii(tag);
        const sizePos = buf.length;
        u32(0);
        const start = buf.length;
        payload();
        patch32(sizePos, buf.length - start);
        while (buf.length % 4) buf.push(0);
      };
      const tipEntry = variant => {
        const w = 8, h = 8;
        const e = new Uint8Array(47 + 19 + w * h);
        const dv = new DataView(e.buffer);
        dv.setInt32(47, 0); dv.setInt32(51, 0); dv.setInt32(55, h); dv.setInt32(59, w);
        dv.setUint16(63, 8); e[65] = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            e[66 + y * w + x] = variant === 1 ? (x + y) * 15 : (x === y ? 255 : 32);
          }
        }
        u32(e.length);
        for (let i = 0; i < e.length; i++) buf.push(e[i]);
      };

      u16(6); u16(1);
      block('desc', () => {
        u32(1);
        descriptor('brushPreset', [
          () => { key4('Nm  '); ascii('TEXT'); uni('Çift Uç'); },
        ]);
      });
      block('cbsh', () => {
        u32(16);
        descriptor('computedBrush', [
          () => num('Dmtr', '#Pxl', 200),
          () => num('Hrdn', '#Prc', 70),
          () => num('Spcn', '#Prc', 12),
          () => num('Flw', '#Prc', 80),
          () => obj('Dual', 'dualBrush', [
            () => num('Dmtr', '#Pxl', 80),
            () => num('Hrdn', '#Prc', 55),
            () => num('ScTr', '#Prc', 30),
          ]),
        ]);
      });
      block('samp', () => { tipEntry(1); tipEntry(2); });

      const parsed = inkParseAbr(new Uint8Array(buf).buffer);
      const tip = parsed[0] || {};
      const parse = {
        count: parsed.length,
        main: !!(tip.dataUrl && tip.dataUrl.startsWith('data:image/png')),
        dual: !!(tip.dual && tip.dual.tipDataUrl && tip.dual.tipDataUrl.startsWith('data:image/png')),
        distinct: !!(tip.dual && tip.dual.tipDataUrl !== tip.dataUrl),
      };

      const ink = inkState();
      const before = ink.brushes.length;
      const prevId = ink.brushId;
      const res = await inkImportAbrFile(new File([new Uint8Array(buf)], 'dual.abr'));
      const added = ink.brushes.slice(before);
      const brush = added.find(b => b.kind === 'abr') || null;
      let ready = false;
      for (let i = 0; i < 80; i++) {
        if (brush && brush.tipId && brush.dual && brush.dual.tipId &&
            inkRuntimeBrushes.abrImages.has(brush.tipId) &&
            inkRuntimeBrushes.abrImages.has(brush.dual.tipId)) { ready = true; break; }
        await wait(25);
      }
      const dualSrc = brush && brush.dual && brush.dual.tipId
        ? inkBrushSourceCanvas({ kind: 'abr', tipId: brush.dual.tipId }, brush.dual.hardness, 64)
        : null;
      const out = {
        parse,
        added: res.added, computed: res.computed,
        mainTip: !!(brush && brush.tipId && inkRuntime.importedTips.has(brush.tipId)),
        dualTip: !!(brush && brush.dual && brush.dual.tipId &&
          inkRuntime.importedTips.has(brush.dual.tipId)),
        ready,
        dualW: dualSrc ? dualSrc.width : 0,
        dualH: dualSrc ? dualSrc.height : 0,
      };
      if (brush) {
        if (brush.tipId) inkRuntime.importedTips.delete(brush.tipId);
        if (brush.dual && brush.dual.tipId) inkRuntime.importedTips.delete(brush.dual.tipId);
      }
      ink.brushes = ink.brushes.filter(b => !added.some(a => a.id === b.id));
      ink.brushId = prevId;
      await inkPersistImportedBrushes();
      if (typeof inkSyncUI === 'function') inkSyncUI();
      return JSON.stringify(out);
    })()`));

    check('gerçek çift fırça ucu .abr içinden ayrıştırılıyor',
      dualAbr.parse.count === 1 && dualAbr.parse.main && dualAbr.parse.dual && dualAbr.parse.distinct,
      `${dualAbr.parse.count} fırça · ana uç ${dualAbr.parse.main} · ikinci uç ${dualAbr.parse.dual}`);
    check('gerçek çift fırça ucu içe aktarılıyor ve yükleniyor',
      dualAbr.added === 1 && dualAbr.computed === 1 && dualAbr.mainTip && dualAbr.dualTip &&
      dualAbr.ready && dualAbr.dualW === 8 && dualAbr.dualH === 8,
      `uçlar ${dualAbr.mainTip}/${dualAbr.dualTip} · hazır ${dualAbr.ready} · ${dualAbr.dualW}×${dualAbr.dualH}`);

    const abrImport = JSON.parse(await evaluate(ws, `(async () => {
      const ink = inkState();
      const before = ink.brushes.length;
      const prevId = ink.brushId;
      const res = await inkImportAbrFile(new File([new Uint8Array(window.__abrTest)], 'test.abr'));
      const added = ink.brushes.slice(before);
      const c = added.filter(b => b.kind === 'abr');
      const out = {
        added: res.added, computed: res.computed, count: c.length,
        name: c[0] ? c[0].name : '',
        tipId: c[0] ? c[0].tipId : 'x',
        sizeMin: c[1] && c[1].dynamics ? c[1].dynamics.sizeMin : -1,
        dualScale: c[1] && c[1].dual ? Math.round(c[1].dual.scale * 100) / 100 : -1,
      };
      ink.brushes = ink.brushes.filter(b => !added.some(a => a.id === b.id));
      ink.brushId = prevId;
      await inkPersistImportedBrushes();
      if (typeof inkSyncUI === 'function') inkSyncUI();
      return JSON.stringify(out);
    })()`));

    check('computed .abr fırçası uç olmadan içe aktarılıyor',
      abrImport.added === 2 && abrImport.computed === 2 && abrImport.count === 2 &&
      abrImport.name === 'Test Fırça' && abrImport.tipId === '' &&
      Math.abs(abrImport.sizeMin - 0.4) < 0.01 && Math.abs(abrImport.dualScale - 0.4) < 0.01,
      `${abrImport.added} fırça · "${abrImport.name}" · uç "${abrImport.tipId}" · boyut ${abrImport.sizeMin} · çift ${abrImport.dualScale}`);


    // ---------------------------------------------------------------
    // 14) Modal görsel düzenleme (overlay) — girdi, silgi, Alt damlalık
    // ---------------------------------------------------------------
    const editor = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const it = state.items.find(i => i.kind === 'image');
      if (!it) return JSON.stringify({ ok: false });
      if (!inkEditorIsOpen()) inkEnterImageScope(it.id);
      await wait(420);

      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      const layer = inkActiveLayer();
      const strokesBefore = layer.strokes.length;

      state.ink.color = '#2e7d32';
      state.ink.opacity = 1;
      state.ink.size = 64;
      state.ink.brushId = 'ink-soft';
      inkSetTool('brush');

      const send = (type, x, y, extra) => canvas.dispatchEvent(new PointerEvent(type, Object.assign({
        bubbles: true, cancelable: true, composed: true,
        pointerId: 77, pointerType: 'pen', isPrimary: true,
        pressure: 0.9, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: rect.left + x, clientY: rect.top + y,
      }, extra || {})));

      // Satır profili testi için vuruş merkezden uzakta (üst bölge) çizilir;
      // böylece dikey çevirme hatası profilde hemen görülür.
      const y = fit.y + fit.h * 0.2;
      const x0 = fit.x + fit.w * 0.28;
      const x1 = fit.x + fit.w * 0.72;
      // Satır bazlı alfa profili: önizleme yönü pişen katmanla aynı mı?
      const rowProfile = target => {
        const w = target.width, h = target.height;
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(target, 0, 0);
        const d = tctx.getImageData(0, 0, w, h).data;
        const out = new Array(8).fill(0);
        for (let yy = 0; yy < h; yy++) {
          let row = 0;
          for (let xx = 0; xx < w; xx++) row += d[(yy * w + xx) * 4 + 3];
          out[Math.min(7, Math.floor(yy * 8 / h))] += row;
        }
        const total = out.reduce((a, b) => a + b, 0) || 1;
        return out.map(v => Math.round((v / total) * 1000) / 1000);
      };
      send('pointerdown', x0, y);
      for (let i = 1; i <= 8; i++) send('pointermove', x0 + (x1 - x0) * i / 8, y);
      await wait(160);
      const glStats = () => (typeof inkDabGlStats === 'function'
        ? inkDabGlStats() : { dabs: 0, frames: 0, textures: 0 });
      const statA = glStats();
      const skipA = inkEditorUi.previewSkip;
      const readPreview = () => {
        const target = inkEditorUi.previewCanvas;
        return target ? new Uint8ClampedArray(target.getContext('2d').getImageData(
          0, 0, target.width, target.height
        ).data) : null;
      };
      const pixelsA = readPreview();
      // Aynı vuruşu yeniden kur: mevcut damlalar aynı pikselleri korumalı.
      inkEditorUi.previewDirty = true;
      inkEditorRebuildPreview();
      inkEditorUi.previewDirty = true;
      inkEditorRebuildPreview();
      const statB = glStats();
      const pixelsB = readPreview();
      const identical = !!pixelsA && !!pixelsB && pixelsA.length === pixelsB.length &&
        pixelsA.every((value, index) => value === pixelsB[index]);
      const previewProfile = inkEditorUi.previewCanvas
        ? rowProfile(inkEditorUi.previewCanvas) : null;
      const preview = {
        gl: !!inkEditorUi.previewGl,
        skip: skipA,
        dabs: statA.dabs,
        frames: statA.frames,
        textures: statA.textures,
        canvasOk: !!inkEditorUi.previewCanvas && inkEditorUi.previewCanvas.width > 1,
        stable: identical && statB.dabs >= statA.dabs && inkEditorUi.previewSkip === skipA,
        texCap: 0,
        texCapOk: true,
      };
      // Uç dokusu önbelleği LRU sınırı: vuruş başına GPU sızıntısı olmasın.
      if (preview.gl && typeof inkDabGlTextureFor === 'function') {
        for (let i = 0; i < 20; i++) {
          const c = document.createElement('canvas');
          c.width = 4;
          c.height = 4;
          c.getContext('2d').fillRect(0, 0, 4, 4);
          inkDabGlTextureFor(c);
        }
        preview.texCap = glStats().textures;
        preview.texCapOk = preview.texCap <= 12;
      }
      send('pointerup', x1, y);
      await wait(260);

      const stroke = layer.strokes[layer.strokes.length - 1];
      const brushAdded = layer.strokes.length - strokesBefore;
      const painted = (cv => {
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return n;
      })(inkRuntime.itemCanvases.get(layer.id));
      const layerProfile = rowProfile(inkRuntime.itemCanvases.get(layer.id));

      // Alt = geçici damlalık.
      // Önceki bloklardan kalan modifier/vuruş durumu olabilir: sıfırla ki
      // ölçüm yalnızca bu adımın davranışını görsün.
      inkEditorUi.alt = false;
      inkEditorUi.toolBeforeAlt = '';
      inkSetTool('brush');
      // Örnekleme renginden farklı bir mevcut renk seç: Alt damlalık
      // incelenen pikseli (#2e7d32, kendi yeşil vuruşu) örnekler; mevcut
      // renk aynıysa colorChanged her koşumda yanlış olur.
      state.ink.color = '#7c4dff';
      for (let i = 0; i < 20 && inkEditorUi.stroke; i += 1) await wait(50);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }));
      for (let i = 0; i < 20 && state.ink.tool !== 'eyedropper'; i += 1) await wait(25);
      const altTool = state.ink.tool;
      const beforeColor = state.ink.color;
      send('pointerdown', (x0 + x1) / 2, y, { altKey: true });
      send('pointerup', (x0 + x1) / 2, y, { altKey: true });
      await wait(120);
      const sampled = state.ink.color;
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false, bubbles: true }));
      for (let i = 0; i < 20 && state.ink.tool === 'eyedropper'; i += 1) await wait(25);
      const restoredTool = state.ink.tool;

      // Gerçek silgi: destination-out, beyaz boya değil.
      inkSetTool('eraser');
      send('pointerdown', x0, y);
      for (let i = 1; i <= 8; i++) send('pointermove', x0 + (x1 - x0) * i / 8, y);
      send('pointerup', x1, y);
      await wait(260);

      const cv = inkRuntime.itemCanvases.get(layer.id);
      const after = (() => {
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return n;
      })();
      const centerAlpha = (() => {
        const px = Math.round(((x0 + x1) / 2 - fit.x) / fit.w * cv.width);
        const py = Math.round((y - fit.y) / fit.h * cv.height);
        return cv.getContext('2d').getImageData(px, py, 1, 1).data[3];
      })();

      // pointerup pişirmesi yeniden çizimde korunuyor mu?
      inkRebuildItemLayer(layer);
      const rebuilt = (() => {
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return n;
      })();

      inkExitImageScope();
      await wait(120);
      return JSON.stringify({
        ok: true,
        added: layer.strokes.length - strokesBefore,
        brushAdded,
        layerId: layer.id,
        activeId: state.ink.activeLayerId,
        editorLayerId: inkEditorUi.layerId,
        layerStrokes: layer.strokes.length,
        strokesBefore,
        strokeKind: stroke ? (stroke.tool + '/' + stroke.kind) : '',
        pointCount: stroke ? stroke.points.length : 0,
        painted, after, centerAlpha, rebuilt,
        preview, previewProfile, layerProfile,
        altTool, sampled, restoredTool,
        colorChanged: sampled.toLowerCase() !== beforeColor.toLowerCase(),
        closed: !inkEditorIsOpen(),
        toolboxHidden: document.getElementById('inkToolbox').hidden,
        scopeOff: inkRuntime.imageScopeId === null,
      });
    })()`));

    check('modal editör vuruşu katmana pişiriyor',
      editor.ok && editor.brushAdded === 1 && editor.painted > 0 && editor.pointCount > 8,
      editor.ok ? `${editor.painted}px · ${editor.pointCount} nokta · +${editor.brushAdded} (${editor.layerId}/${editor.editorLayerId}/${editor.activeId})` : 'görsel yok');
    check('canlı önizleme kararlı damlaları artımlı ve aynı rasterla çiziyor',
      editor.ok && editor.preview.canvasOk && editor.preview.stable &&
      !editor.preview.gl && editor.preview.skip > 0,
      editor.ok
        ? `2B raster · ${editor.preview.skip} kararlı damla · tekrar aynı=${editor.preview.stable}`
        : '');
    check('GPU uç dokusu önbelleği sınırlı',
      editor.ok && editor.preview.texCapOk,
      editor.ok
        ? (editor.preview.gl ? `doku ${editor.preview.texCap} ≤ 12` : 'GPU yok · atlandı')
        : '');
    const profileDiff = (a, b) => (a && b
      ? a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) : 99);
    const upright = editor.ok &&
      profileDiff(editor.previewProfile, editor.layerProfile) <
      profileDiff(editor.previewProfile, (editor.layerProfile || []).slice().reverse());
    check('önizleme yönü pişen katmanla aynı', upright,
      editor.ok
        ? `önizleme ${JSON.stringify(editor.previewProfile)} · katman ${JSON.stringify(editor.layerProfile)}`
        : '');
    check('modal silgi destination-out ile siliyor',
      editor.ok && editor.centerAlpha < 8 && editor.after < editor.painted,
      editor.ok ? `${editor.painted} → ${editor.after}px · merkez alfa ${editor.centerAlpha}` : '');
    check('modal vuruşu yeniden çizimde korunuyor',
      editor.ok && editor.rebuilt > 0 && editor.brushAdded === 1,
      editor.ok ? `${editor.rebuilt}px` : '');
    check('Alt geçici damlalık rengi örnekliyor ve aracı geri veriyor',
      editor.ok && editor.altTool === 'eyedropper' && editor.restoredTool === 'brush' &&
      editor.colorChanged && /^#[0-9a-f]{6}$/.test(editor.sampled),
      editor.ok ? `${editor.sampled} · ${editor.altTool} → ${editor.restoredTool}` : '');
    check('modal kapanınca araç çubuğu gizleniyor',
      editor.ok && editor.closed && editor.toolboxHidden && editor.scopeOff, '');

    // ---------------------------------------------------------------
    // 15) Mod anahtarı, yeni tuval penceresi, çizim zoom'u / pan
    // ---------------------------------------------------------------
    // Üretim kapısı: referans tahtasında satır içi çizim yok.
    await evaluate(ws, 'window.__TailRef_INK_LEGACY_TEST__ = false; true');

    const canvasUi = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const modal = document.getElementById('newCanvasModal');
      const drawBtn = document.getElementById('modeDrawBtn');
      const newBtn = document.getElementById('modeNewBtn');
      const form = document.getElementById('newCanvasForm');
      const wEl = document.getElementById('newCanvasW');
      const hEl = document.getElementById('newCanvasH');
      const nameEl = document.getElementById('newCanvasName');
      const infoEl = document.getElementById('newCanvasInfo');
      const presets = document.getElementById('newCanvasPresets');
      const mode = () => document.getElementById('appModeBar').dataset.mode;
      const pickRadio = value => {
        const r = modal.querySelector('input[name="ncBg"][value="' + value + '"]');
        if (r) r.checked = true;
      };

      // Temiz referans durumu: modal kapalı, seçim yok, çizim kapalı.
      if (typeof modeExitDraw === 'function') modeExitDraw();
      if (typeof inkExitImageScope === 'function' && inkRuntime.imageScopeId) inkExitImageScope();
      if (typeof inkCloseTransientUi === 'function') inkCloseTransientUi();
      selection.clear(); selectionOrder = []; syncSelection();
      modal.hidden = true;
      await wait(320);

      const start = {
        disabled: drawBtn ? drawBtn.disabled : true,
        modalHidden: modal.hidden,
        mode: mode(),
      };

      // Seçim yokken "Çizim": piksel boyutu, ad ve arka planı soran
      // yeni tuval penceresi açılmalı; mod referansta kalmalı.
      drawBtn.click();
      await wait(320);
      const drawPanel = {
        modal: !modal.hidden,
        mode: mode(),
        editor: inkEditorIsOpen(),
        itemId: inkEditorUi.itemId || '',
        name: (document.getElementById('modeDrawName') || {}).textContent || '',
      };

      // Pencereyi kapat; boyut testleri aşağıda yeniden açılan
      // ayrıntılı pencere üzerinde yapılır.
      document.getElementById('newCanvasCancel').click();
      await wait(180);
      if (newBtn) {
        newBtn.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true,
        }));
      } else if (typeof modeOpenNewCanvas === 'function') {
        modeOpenNewCanvas();
      }
      await wait(260);
      const opened = {
        modal: !modal.hidden,
        mode: mode(),
        presets: presets ? presets.querySelectorAll('.ncPreset').length : 0,
        name: nameEl ? nameEl.value : '',
        w: wEl ? wEl.value : '',
        h: hEl ? hEl.value : '',
        info: infoEl ? infoEl.textContent : '',
      };

      // Hazır boyut düğmesi girişleri doldurmalı.
      const preset4k = [...(presets ? presets.querySelectorAll('.ncPreset') : [])]
        .find(b => /4K/.test(b.textContent));
      if (preset4k) preset4k.click();
      await wait(120);
      const presetPick = {
        w: wEl.value,
        h: hEl.value,
        active: preset4k ? preset4k.classList.contains('is-active') : false,
      };
      const presetButtons = [...(presets ? presets.querySelectorAll('.ncPreset') : [])];
      const preset169 = presetButtons.find(b => /16:9/.test(b.textContent));
      const preset1080 = presetButtons.find(b => /1080p/.test(b.textContent));
      if (preset169) preset169.click();
      const size169 = { w: wEl.value, h: hEl.value };
      if (preset1080) preset1080.click();
      const size1080 = {
        w: wEl.value, h: hEl.value,
        active: preset1080 ? preset1080.classList.contains('is-active') : false,
      };

      // Doğrulama: alt/üst sınır ve toplam piksel.
      const val = (w, h) => {
        wEl.value = String(w); hEl.value = String(h);
        // Doğrulama hata metnini yazar; geçerli boyutta metni boşalttığı
        // için bilgi satırı (MP/bellek) sonradan yeniden hesaplanır.
        const ok = !!newCanvasValidate(true);
        const error = infoEl.classList.contains('is-error');
        newCanvasUpdateInfo();
        return { ok, error, text: infoEl.textContent };
      };
      const tooSmall = val(8, 8);
      const tooBig = val(9000, 1080);
      const tooManyPixels = val(8000, 7000);
      const valid = val(320, 240);

      // İptal pencereyi kapatmalı; mod referansta kalmalı.
      document.getElementById('newCanvasCancel').click();
      await wait(180);
      const cancelled = { modal: modal.hidden, mode: mode() };

      // "+" düğmesi aynı ayrıntılı pencereyi açmalı.
      if (newBtn) {
        newBtn.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, shiftKey: true,
        }));
      }
      await wait(260);
      const plusOpened = !modal.hidden;

      // Gerçekten oluştur: 320 × 240 saydam tuval.
      wEl.value = '320'; hEl.value = '240';
      if (nameEl) nameEl.value = 'Test Tuvali';
      pickRadio('transparent');
      newCanvasUpdateInfo();
      const beforeItems = state.items.length;
      form.requestSubmit();

      // Oluşturma zinciri: rAF + toBlob + IndexedDB + decode.
      for (let i = 0; i < 80 && !modal.hidden; i += 1) await wait(100);
      for (let i = 0; i < 80 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(650);

      const made = state.items.find(it => it.title === 'Test Tuvali');
      const layers = made ? inkLayersForOwner(made.id) : [];
      const layer = layers[layers.length - 1] || null;
      const stored = made ? await idbGet('images', made.imageId) : null;
      const created = {
        ok: !!made && state.items.length === beforeItems + 1,
        added: state.items.length - beforeItems,
        w: made ? made.w : 0,
        h: made ? made.h : 0,
        name: made ? (made.title || made.name || '') : '',
        layers: layers.length,
        pxW: layer ? layer.pxW : 0,
        pxH: layer ? layer.pxH : 0,
        owner: layer ? layer.ownerId === made.id : false,
        stored: !!(stored && stored.blob && stored.blob.size > 0),
        storedName: stored ? stored.name : '',
        mode: mode(),
        drawBtn: drawBtn.classList.contains('is-active') &&
          drawBtn.getAttribute('aria-selected') === 'true',
        modeName: (document.getElementById('modeDrawName') || {}).textContent || '',
        editor: inkEditorIsOpen(),
        scope: !!made && inkScopeActiveFor(made.id),
        scopeBar: !document.getElementById('inkScopeBar').hidden,
        scopeName: (document.getElementById('inkScopeName') || {}).textContent || '',
        scopeSize: (document.getElementById('inkScopeSize') || {}).textContent || '',
        scopeInfo: (document.getElementById('inkScopeInfo') || {}).textContent || '',
        brushPanelVisible: (() => {
          const p = document.querySelector('.v5-panel--brush');
          return !!p && getComputedStyle(p).display !== 'none' &&
            !p.classList.contains('is-collapsed') && p.getBoundingClientRect().width > 0;
        })(),
        stripGone: !document.getElementById('inkBrushStrip'),
        id: made ? made.id : '',
      };

      return JSON.stringify({
        start, drawPanel, opened, presetPick, size169, size1080, tooSmall, tooBig, tooManyPixels, valid,
        cancelled, plusOpened, created,
      });
    })()`));

    check('seçim yokken Çizim düğmesi pasif değil',
      canvasUi.start.disabled === false && canvasUi.start.mode === 'reference',
      `pasif=${canvasUi.start.disabled} mod=${canvasUi.start.mode}`);
    check('seçim yokken Çizim düğmesi piksel boyutu penceresini açıyor',
      canvasUi.drawPanel.modal && canvasUi.drawPanel.mode === 'reference' &&
      !canvasUi.drawPanel.editor,
      `pencere=${canvasUi.drawPanel.modal} mod=${canvasUi.drawPanel.mode} ` +
      `editör=${canvasUi.drawPanel.editor}`);
    check('yeni tuval penceresi boyut, ad ve hazır ayarlarla açılıyor',
      canvasUi.opened.modal && canvasUi.opened.presets === 8,
      `pencere=${canvasUi.opened.modal} mod=${canvasUi.opened.mode} hazır=${canvasUi.opened.presets}`);
    check('16:9 ve 1080p hazır ayarları ayrı ayrı seçilebiliyor',
      canvasUi.size169.w === '1600' && canvasUi.size169.h === '900' &&
      canvasUi.size1080.w === '1920' && canvasUi.size1080.h === '1080' &&
      canvasUi.size1080.active,
      `16:9 ${canvasUi.size169.w}×${canvasUi.size169.h} · 1080p ${canvasUi.size1080.w}×${canvasUi.size1080.h}`);
    check('hazır boyut düğmesi genişlik ve yüksekliği dolduruyor',
      canvasUi.presetPick.w === '3840' && canvasUi.presetPick.h === '2160' && canvasUi.presetPick.active,
      `${canvasUi.presetPick.w} × ${canvasUi.presetPick.h} aktif=${canvasUi.presetPick.active}`);
    check('geçersiz tuval boyutları hata veriyor',
      !canvasUi.tooSmall.ok && canvasUi.tooSmall.error &&
      !canvasUi.tooBig.ok && canvasUi.tooBig.error &&
      !canvasUi.tooManyPixels.ok && canvasUi.tooManyPixels.error,
      `${canvasUi.tooSmall.text} | ${canvasUi.tooBig.text} | ${canvasUi.tooManyPixels.text}`);
    check('geçerli tuval boyutu bilgi metnini güncelliyor',
      canvasUi.valid.ok && !canvasUi.valid.error && /320 × 240/.test(canvasUi.valid.text),
      canvasUi.valid.text);
    check('İptal yeni tuval penceresini kapatıyor',
      canvasUi.cancelled.modal,
      `pencere=${canvasUi.cancelled.modal} mod=${canvasUi.cancelled.mode}`);
    check('"+" düğmesi yeni tuval penceresini açıyor',
      canvasUi.plusOpened === true, '');
    check('yeni tuval seçilen piksel boyutunda oluşturuluyor',
      canvasUi.created.ok && canvasUi.created.w === 320 && canvasUi.created.h === 240 &&
      canvasUi.created.name === 'Test Tuvali',
      `${canvasUi.created.w} × ${canvasUi.created.h} · ${canvasUi.created.name}`);
    check('yeni tuval bağlı çizim katmanıyla açılıyor',
      canvasUi.created.layers === 1 && canvasUi.created.pxW === 320 &&
      canvasUi.created.pxH === 240 && canvasUi.created.owner,
      `${canvasUi.created.layers} katman · ${canvasUi.created.pxW} × ${canvasUi.created.pxH}`);
    check('yeni tuval görseli depoya yazılıyor',
      canvasUi.created.stored && canvasUi.created.storedName === 'Test Tuvali.png',
      canvasUi.created.storedName || 'kayıt yok');
    check('yeni tuval doğrudan çizim modunu açıyor',
      canvasUi.created.mode === 'draw' && canvasUi.created.drawBtn &&
      canvasUi.created.editor && canvasUi.created.scope && canvasUi.created.scopeBar,
      `mod=${canvasUi.created.mode} editör=${canvasUi.created.editor} kapsam=${canvasUi.created.scope}`);
    check('çizim modu başlığı tuval adını gösteriyor',
      canvasUi.created.modeName === 'Test Tuvali',
      canvasUi.created.modeName);
    check('durum çubuğu belge boyutunu, katmanı ve aracı gösteriyor',
      /320 × 240 px/.test(canvasUi.created.scopeSize) &&
      canvasUi.created.scopeName === 'Test Tuvali' &&
      canvasUi.created.scopeInfo.length > 0,
      `${canvasUi.created.scopeSize} · ${canvasUi.created.scopeInfo}`);
    check('fırça paneli çizim modunda görünüyor, alt şerit kaldırıldı',
      canvasUi.created.brushPanelVisible && canvasUi.created.stripGone,
      `panel=${canvasUi.created.brushPanelVisible} şeritYok=${canvasUi.created.stripGone}`);

    const fillUi = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const layer = inkLayerById(inkEditorUi.layerId);
      const canvas = document.getElementById('inkEditorCanvas');
      if (!layer || !canvas || layer.kind !== 'attached') return JSON.stringify({ available: false });
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const pointer = (type, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 9876, pointerType: 'pen', isPrimary: true,
        pressure: type === 'pointerup' ? 0 : 1,
        clientX: x, clientY: y, button: 0, buttons,
      });
      inkState().color = '#22aa55';
      inkSetTool('fill');
      canvas.dispatchEvent(pointer('pointerdown', 1));
      canvas.dispatchEvent(pointer('pointerup', 0));
      const raster = inkEnsureItemCanvas(layer);
      const read = () => [...raster.getContext('2d').getImageData(
        Math.floor(raster.width / 2), Math.floor(raster.height / 2), 1, 1
      ).data];
      await wait(120);
      const filled = read();
      const fillCommitted = layer.strokes.length > 0 &&
        layer.strokes[layer.strokes.length - 1].kind === 'fill' &&
        filled[1] > 120 && filled[3] > 200;
      undo();
      await wait(120);
      const undone = read()[3] === 0 && !layer.strokes.some(s => s.kind === 'fill');
      redo();
      await wait(120);
      const redone = read()[1] > 120 && layer.strokes.some(s => s.kind === 'fill');
      return JSON.stringify({ available: true, fillCommitted, undone, redone });
    })()`));
    check('seçili katman boya kovasıyla tıklamada dolguyu kaydediyor ve geri/yineleme çalışıyor',
      fillUi.available && fillUi.fillCommitted && fillUi.undone && fillUi.redone,
      JSON.stringify(fillUi));

    const zoomUi = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ui = inkEditorUi;
      const item = state.items.find(it => it.title === 'Test Tuvali');
      if (!item) return JSON.stringify({ ok: false });
      if (!inkEditorIsOpen()) modeEnterDraw(item.id);
      for (let i = 0; i < 40 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

      const fit = () => inkEditorComputeFit();
      const label = () => (document.getElementById('inkZoomValue') || {}).textContent || '';
      const near = (a, b, eps) => Math.abs(a - b) <= (eps || 0.75);

      // 1) Ekrana sığdır → %125 zoom: kutu tam 1.25 katına çıkmalı.
      inkEditorZoomFit();
      await wait(140);
      const f0 = fit();
      const labelFit = label();
      inkEditorZoomBy(1.25);
      await wait(140);
      const f1 = fit();
      const labelZoom = label();

      // 2) Çapa noktası: zoom öncesi ve sonrası aynı ekran noktasında kalmalı.
      inkEditorZoomFit();
      await wait(100);
      const a0 = fit();
      const anchor = { x: a0.x + a0.w * 0.3, y: a0.y + a0.h * 0.55 };
      inkEditorSetZoom(2.5, anchor);
      await wait(100);
      const a1 = fit();
      const anchorAfter = { x: a1.x + a1.w * 0.3, y: a1.y + a1.h * 0.55 };
      const anchorDx = Math.abs(anchorAfter.x - anchor.x);
      const anchorDy = Math.abs(anchorAfter.y - anchor.y);

      // 3) Sınırlar.
      inkEditorSetZoom(999);
      const maxZoom = ui.view.zoom;
      inkEditorSetZoom(0.0001);
      const minZoom = ui.view.zoom;
      inkEditorZoomFit();

      // 4) %100: bir görsel pikseli = bir ekran pikseli.
      inkEditorZoomActual();
      await wait(140);
      const actualFit = fit();
      const actualZoom = ui.view.zoom;
      const actualLabel = label();

      // 5) Klavye: +, 0, 1.
      inkEditorZoomFit();
      const key = k => window.dispatchEvent(new KeyboardEvent('keydown', {
        key: k, bubbles: true, cancelable: true,
      }));
      key('+');
      await wait(100);
      const keyZoom = ui.view.zoom;
      key('0');
      await wait(100);
      const keyFit = ui.view.zoom === 1 && ui.view.panX === 0 && ui.view.panY === 0;
      key('1');
      await wait(100);
      const keyActual = Math.abs(ui.view.zoom - actualZoom) < 1e-6;

      // 6) Ctrl + tekerlek: yakınlaştırmalı.
      inkEditorZoomFit();
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const wheelBefore = fit();
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -240, clientX: center.x, clientY: center.y,
        ctrlKey: true, bubbles: true, cancelable: true,
      }));
      await wait(140);
      const wheelAfter = fit();

      // 7) Space + sürükle: kaydırma; çizim başlatmamalı.
      inkEditorZoomFit();
      const panStartX = ui.view.panX;
      const panStartY = ui.view.panY;
      const strokesBeforePan = inkLayersForOwner(item.id)
        .reduce((sum, layer) => sum + layer.strokes.length, 0);
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
      }));
      const spaceOn = ui.space === true;
      const mk = (type, x, y) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 9100, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: x, clientY: y,
      });
      canvas.dispatchEvent(mk('pointerdown', center.x, center.y));
      const panning = !!ui.panning;
      canvas.dispatchEvent(mk('pointermove', center.x + 60, center.y + 34));
      canvas.dispatchEvent(mk('pointerup', center.x + 60, center.y + 34));
      window.dispatchEvent(new KeyboardEvent('keyup', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
      }));
      await wait(140);
      const panDx = ui.view.panX - panStartX;
      const panDy = ui.view.panY - panStartY;
      const panEnded = ui.panning === null && ui.space === false;
      const strokesAfterPan = inkLayersForOwner(item.id)
        .reduce((sum, layer) => sum + layer.strokes.length, 0);
      const noStroke = strokesAfterPan === strokesBeforePan;

      // 8) Durum çubuğu zoom yüzdesi hesapla aynı olmalı.
      const f = fit();
      const statusPct = Math.max(1, Math.round((f.w / Math.max(1, item.w)) * 100)) + '%';
      const status = {
        label: label(),
        size: (document.getElementById('inkScopeSize') || {}).textContent || '',
        info: (document.getElementById('inkScopeInfo') || {}).textContent || '',
        dpr: (document.getElementById('inkScopeDpr') || {}).textContent || '',
      };

      inkEditorZoomFit();
      return JSON.stringify({
        ok: true, labelFit, labelZoom,
        zoomRatio: f0.w > 0 ? f1.w / f0.w : 0,
        anchorDx, anchorDy, maxZoom, minZoom,
        actualZoom, actualLabel,
        actualPxDelta: Math.abs(actualFit.w - item.w),
        keyZoom, keyFit, keyActual,
        wheelGrew: wheelBefore.w > 0 && wheelAfter.w > wheelBefore.w * 1.1,
        wheelZoom: ui.view.zoom,
        spaceOn, panning, panDx, panDy, panEnded, noStroke,
        statusPct, status,
      });
    })()`));

    check('zoom oranı ve etiketi birlikte güncelleniyor',
      zoomUi.ok && Math.abs(zoomUi.zoomRatio - 1.25) < 0.01 &&
      zoomUi.labelFit !== zoomUi.labelZoom,
      `oran=${zoomUi.zoomRatio} ${zoomUi.labelFit} → ${zoomUi.labelZoom}`);
    check('zoom çapa noktasını sabit tutuyor',
      zoomUi.ok && zoomUi.anchorDx < 1.5 && zoomUi.anchorDy < 1.5,
      `sapma ${zoomUi.anchorDx.toFixed(2)} / ${zoomUi.anchorDy.toFixed(2)} px`);
    check('zoom sınırları kelepçeleniyor',
      Math.abs(zoomUi.maxZoom - 16) < 1e-6 && Math.abs(zoomUi.minZoom - 0.05) < 1e-6,
      `${zoomUi.minZoom}–${zoomUi.maxZoom}`);
    check('%100 zoom bir görsel pikselini bir ekran pikseline eşitliyor',
      zoomUi.ok && zoomUi.actualPxDelta <= 1.5 && zoomUi.actualLabel === '100%',
      `fark=${zoomUi.actualPxDelta.toFixed(2)}px etiket=${zoomUi.actualLabel}`);
    check('klavye +, 0 ve 1 zoom kısayolları çalışıyor',
      zoomUi.ok && Math.abs(zoomUi.keyZoom - 1.25) < 0.01 && zoomUi.keyFit && zoomUi.keyActual,
      `+→${zoomUi.keyZoom} 0→${zoomUi.keyFit} 1→${zoomUi.keyActual}`);
    check('Ctrl + tekerlek yakınlaştırıyor',
      zoomUi.ok && zoomUi.wheelGrew,
      `zoom ${zoomUi.wheelZoom.toFixed(2)}×`);
    check('Space + sürükle kaydırıyor, çizim başlatmıyor',
      zoomUi.ok && zoomUi.spaceOn && zoomUi.panning &&
      Math.abs(zoomUi.panDx - 60) < 1.5 && Math.abs(zoomUi.panDy - 34) < 1.5 &&
      zoomUi.panEnded && zoomUi.noStroke,
      `Δ ${zoomUi.panDx.toFixed(1)} / ${zoomUi.panDy.toFixed(1)} px · vuruş=${zoomUi.noStroke} ` +
      `space=${zoomUi.spaceOn} pan=${zoomUi.panning} bitti=${zoomUi.panEnded}`);
    check('durum çubuğu zoom yüzdesini ve belge bilgisini gösteriyor',
      zoomUi.ok && zoomUi.status.label === zoomUi.statusPct &&
      /320 × 240 px/.test(zoomUi.status.size) &&
      /px/.test(zoomUi.status.info) && /DPR/.test(zoomUi.status.dpr),
      `${zoomUi.status.label} (${zoomUi.statusPct}) · ${zoomUi.status.size} · ${zoomUi.status.dpr}`);

    const modeSel = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      if (modeIsDraw()) modeExitDraw();
      await wait(380);
      const it = state.items.find(x => x.title === 'Test Tuvali');
      const drawBtn = document.getElementById('modeDrawBtn');
      const modal = document.getElementById('newCanvasModal');
      selection.clear(); selectionOrder = []; syncSelection();
      await wait(140);
      drawBtn.click();
      await wait(320);
      const noSelection = {
        modal: !modal.hidden,
        mode: appModeUi.mode,
        itemId: appModeUi.itemId,
        editor: inkEditorIsOpen(),
        name: (document.getElementById('modeDrawName') || {}).textContent || '',
      };
      // Boyut penceresini kapat; seçili görsel akışı ayrıca sınanır.
      document.getElementById('newCanvasCancel').click();
      await wait(180);
      selection = new Set([it.id]);
      selectionOrder = [it.id];
      syncSelection();
      await wait(120);
      drawBtn.click();
      for (let i = 0; i < 40 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(320);
      const withSelection = {
        mode: appModeUi.mode,
        itemId: appModeUi.itemId,
        editor: inkEditorIsOpen(),
        sameId: appModeUi.itemId === it.id,
        name: (document.getElementById('modeDrawName') || {}).textContent || '',
      };
      const panel = document.querySelector('.v5-panel--brush');
      const head = panel && panel.querySelector('.v5-panel-head');
      const originalDock = panel && panel.parentElement;
      const originalSide = originalDock && originalDock.id === 'v5LeftDock' ? 'left' : 'right';
      let panelLayout = { available: false, crossedDock: false, panelResized: false, nextPanelMoved: false };
      if (panel && head && originalDock && panel.getBoundingClientRect().width > 0) {
        const pointer = (type, x, y, pointerId) => new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId, pointerType: 'mouse',
          isPrimary: true, clientX: x, clientY: y,
          button: 0, buttons: type === 'pointerup' ? 0 : 1,
        });
        const targetSide = originalSide === 'left' ? 'right' : 'left';
        const targetDock = document.getElementById(targetSide === 'left' ? 'v5LeftDock' : 'v5RightDock');
        const targetRect = targetDock.getBoundingClientRect();
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + Math.min(140, targetRect.height / 2);
        const panelRect = panel.getBoundingClientRect();
        head.dispatchEvent(pointer('pointerdown', panelRect.left + 50, panelRect.top + 20, 9881));
        window.dispatchEvent(pointer('pointermove', targetX, targetY, 9881));
        window.dispatchEvent(pointer('pointerup', targetX, targetY, 9881));
        await wait(80);
        const crossedDock = panel.parentElement === targetDock;
        if (crossedDock) {
          const movedRect = panel.getBoundingClientRect();
          const returnDock = originalDock;
          const returnRect = returnDock.getBoundingClientRect();
          const returnX = returnRect.left + returnRect.width / 2;
          const returnY = returnRect.top + Math.min(140, returnRect.height / 2);
          head.dispatchEvent(pointer('pointerdown', movedRect.left + 50, movedRect.top + 20, 9882));
          window.dispatchEvent(pointer('pointermove', returnX, returnY, 9882));
          window.dispatchEvent(pointer('pointerup', returnX, returnY, 9882));
          await wait(80);
        }

        const resizable = [...document.querySelectorAll('.v5-dock > .v5-panel')]
          .find(item => !item.classList.contains('is-collapsed') &&
            item.nextElementSibling && item.nextElementSibling.classList.contains('v5-panel'));
        let panelResized = false;
        let nextPanelMoved = false;
        if (resizable) {
          const resize = resizable.querySelector('.v5-resize-s');
          const neighbor = resizable.nextElementSibling;
          const beforeHeight = resizable.getBoundingClientRect().height;
          const beforeY = neighbor.getBoundingClientRect().top;
          const handleRect = resize.getBoundingClientRect();
          const x = handleRect.left + handleRect.width / 2;
          const y = handleRect.top + handleRect.height / 2;
          resize.dispatchEvent(pointer('pointerdown', x, y, 9883));
          window.dispatchEvent(pointer('pointermove', x, y - 40, 9883));
          window.dispatchEvent(pointer('pointerup', x, y - 40, 9883));
          await wait(80);
          panelResized = resizable.getBoundingClientRect().height < beforeHeight - 20;
          nextPanelMoved = neighbor.getBoundingClientRect().top < beforeY - 20;
        }
        panelLayout = { available: true, crossedDock, panelResized, nextPanelMoved };
      }
      modeExitDraw();
      await wait(340);
      const after = {
        mode: appModeUi.mode,
        editor: inkEditorIsOpen(),
        reference: document.body.classList.contains('mode-reference'),
        toolbox: document.getElementById('inkToolbox').hidden,
        scopeBar: document.getElementById('inkScopeBar').hidden,
      };
      return JSON.stringify({ noSelection, withSelection, panelLayout, after, id: it.id });
    })()`));

    check('seçim yokken Çizim düğmesi piksel boyutu penceresini açıyor',
      modeSel.noSelection.modal && modeSel.noSelection.mode === 'reference' &&
      !modeSel.noSelection.editor && !modeSel.noSelection.itemId,
      `pencere=${modeSel.noSelection.modal} mod=${modeSel.noSelection.mode} ` +
      `editör=${modeSel.noSelection.editor} ad=${modeSel.noSelection.name}`);
    check('seçili görselle Çizim düğmesi o görseli açıyor',
      modeSel.withSelection.mode === 'draw' && modeSel.withSelection.editor &&
      modeSel.withSelection.sameId && modeSel.withSelection.name === 'Test Tuvali',
      `mod=${modeSel.withSelection.mode} aynı=${modeSel.withSelection.sameId}`);
    check('referansa dönünce mod, editör ve araç kutusu kapanıyor',
      modeSel.after.mode === 'reference' && !modeSel.after.editor &&
      modeSel.after.reference && modeSel.after.toolbox && modeSel.after.scopeBar,
      `mod=${modeSel.after.mode} editör=${modeSel.after.editor}`);
    check('paneller görünür çizim modunda docklar arasında taşınıp dikey boyutlandırılıyor',
      modeSel.panelLayout.available && modeSel.panelLayout.crossedDock &&
      modeSel.panelLayout.panelResized && modeSel.panelLayout.nextPanelMoved,
      JSON.stringify(modeSel.panelLayout));

    const newToolEditor = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const it = getItem(${JSON.stringify(modeSel.id)});
      if (!it || it.kind !== 'image') return JSON.stringify({ available: false });
      const ink = inkState();
      const previousLayerId = ink.activeLayerId;
      const layer = inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'Araç doğrulama' });
      if (!layer) return JSON.stringify({ available: false });
      ink.activeLayerId = layer.id;
      if (typeof modeEnterDraw === 'function') modeEnterDraw(it.id);
      for (let i = 0; i < 40 && !inkEditorIsOpen(); i += 1) await wait(100);
      if (!inkEditorIsOpen()) return JSON.stringify({ available: false, reason: 'editör açılamadı' });
      inkSetTool('brush');
      const cursorUi = inkEditorUi;
      const previousCursorPoint = cursorUi.lastClient;
      const outsidePoint = cursorUi.fit.x > 24
        ? { x: cursorUi.fit.x - 12, y: cursorUi.fit.y + cursorUi.fit.h / 2 }
        : { x: cursorUi.fit.x + cursorUi.fit.w + 12, y: cursorUi.fit.y + cursorUi.fit.h / 2 };
      cursorUi.lastClient = outsidePoint;
      inkEditorDrawCursor();
      const brushCursorOutsideCanvas = !!cursorUi.cursorRect &&
        (outsidePoint.x < cursorUi.fit.x || outsidePoint.x > cursorUi.fit.x + cursorUi.fit.w);
      cursorUi.lastClient = previousCursorPoint;
      inkEditorDrawCursor();

      const draw = async (tool, from, to, color) => {
        inkSetTool(tool);
        ink.color = color;
        ink.size = 18;
        ink.opacity = 1;
        ink.hardness = 1;
        ink.spacing = 0.1;
        ink.smoothing = 0;
        if (tool === 'smudge') ink.flow = 0.32;
        const ui = inkEditorUi;
        const rect = ui.canvas.getBoundingClientRect();
        const point = p => ({
          x: rect.left + ui.fit.x + ui.fit.w * p.x,
          y: rect.top + ui.fit.y + ui.fit.h * p.y,
        });
        const start = point(from), end = point(to);
        const pointerId = 9876;
        const event = (type, p) => new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId, pointerType: 'pen',
          isPrimary: true, pressure: 1, clientX: p.x, clientY: p.y,
          button: 0, buttons: type === 'pointerup' ? 0 : 1,
        });
        ui.canvas.dispatchEvent(event('pointerdown', start));
        ui.canvas.dispatchEvent(event('pointermove', point({
          x: from.x + (to.x - from.x) / 2,
          y: from.y + (to.y - from.y) / 2,
        })));
        ui.canvas.dispatchEvent(event('pointermove', end));
        await wait(60);
        const preview = inkEditorRebuildPreview(true);
        const previewData = preview.getContext('2d').getImageData(
          0, 0, preview.width, preview.height
        ).data;
        ui.canvas.dispatchEvent(event('pointerup', end));
        await wait(60);
        const canvas = inkRuntime.itemCanvases.get(layer.id);
        const committed = canvas.getContext('2d').getImageData(
          0, 0, canvas.width, canvas.height
        ).data;
        return {
          kind: layer.strokes[layer.strokes.length - 1].kind,
          previewMatches: previewData.length === committed.length &&
            previewData.every((value, i) => value === committed[i]),
          canvas,
        };
      };

      const brush = await draw('brush', { x: 0.2, y: 0.5 }, { x: 0.42, y: 0.5 }, '#ff0000');
      const brushCount = layer.strokes.length;
      const brushStrokeId = layer.strokes[layer.strokes.length - 1].id;
      const smudge = await draw('smudge', { x: 0.38, y: 0.5 }, { x: 0.68, y: 0.5 }, '#00ff00');
      const smudgeStrokeId = layer.strokes[layer.strokes.length - 1].id;
      const readPixel = x => {
        const canvas = inkRuntime.itemCanvases.get(layer.id) || smudge.canvas;
        return [...canvas.getContext('2d').getImageData(
          Math.round(canvas.width * x), Math.round(canvas.height * 0.5), 1, 1
        ).data];
      };
      const smearedPixel = readPixel(0.58);
      const smudgedPixels = new Uint8ClampedArray(
        inkRuntime.itemCanvases.get(layer.id).getContext('2d').getImageData(
          0, 0, smudge.canvas.width, smudge.canvas.height
        ).data
      );
      const smudgeCount = layer.strokes.length;
      const smudgeCommitted = smudge.kind === 'smudge' && smudgeCount === brushCount + 1;
      undo();
      await inkPaintIdle();
      await wait(120);
      const smudgeUndone = layer.strokes.length === smudgeCount - 1 &&
        !layer.strokes.some(stroke => stroke.id === smudgeStrokeId) &&
        layer.strokes.some(stroke => stroke.id === brushStrokeId) && readPixel(0.58)[3] === 0;
      const smudgeCountAfterUndo = layer.strokes.length;
      redo();
      await inkPaintIdle();
      await wait(120);
      const smudgePixelAfterRedo = readPixel(0.58);
      const smudgeRasterRestored = smudgePixelAfterRedo.every((value, i) => value === smearedPixel[i]) &&
        [...inkRuntime.itemCanvases.get(layer.id).getContext('2d').getImageData(
          0, 0, smudge.canvas.width, smudge.canvas.height
        ).data].every((value, i) => value === smudgedPixels[i]);
      const smudgeCountAfterRedo = layer.strokes.length;
      const smudgeRedone = layer.strokes.length === smudgeCount &&
        layer.strokes.some(stroke => stroke.id === smudgeStrokeId) && smudgePixelAfterRedo[3] > 0;

      const beforeGradientCount = layer.strokes.length;
      const beforeGradientPixels = new Uint8ClampedArray(
        inkRuntime.itemCanvases.get(layer.id).getContext('2d').getImageData(
          0, 0, smudge.canvas.width, smudge.canvas.height
        ).data
      );
      const gradient = await draw('gradient', { x: 0.1, y: 0.75 }, { x: 0.9, y: 0.75 }, '#0000ff');
      const gradientStrokeId = layer.strokes[layer.strokes.length - 1].id;
      const gradientCount = layer.strokes.length;
      const gradientCommitted = gradient.kind === 'gradient' &&
        gradientCount === beforeGradientCount + 1;
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      await inkPaintIdle();
      await wait(120);
      if (layer.strokes.length !== gradientCount - 1) {
        /* Teşhis: Ctrl+Z neden işlemiyor? */
        const top = undoStack[undoStack.length - 1] || '';
        let t = null; try { t = JSON.parse(top); } catch { /* bozuk */ }
        window.__smokeGradDiag = {
          stackLen: undoStack.length,
          topKind: t ? (t.__inkStroke ? 'stroke:' + t.__inkStroke.stroke.kind : Object.keys(t).join(',')) : 'bos',
          ae: document.activeElement
            ? document.activeElement.tagName + '#' + (document.activeElement.id || '') +
              (document.activeElement.isContentEditable ? '[ce]' : '')
            : 'null',
          menuOpen: typeof inkWorkspaceUi !== 'undefined' ? inkWorkspaceUi.menuOpen : 'yok',
          draw: document.body.classList.contains('mode-draw'),
        };
      } else {
        /* Teşhis: geri al vuruşu kaldırdı ama raster mı bozuk kaldı? */
        const cv = inkRuntime.itemCanvases.get(layer.id);
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let diff = 0, maxDelta = 0;
        let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
        for (let i = 0; i < d.length; i += 1) {
          const delta = Math.abs(d[i] - beforeGradientPixels[i]);
          if (delta > 0) {
            diff += 1;
            if (delta > maxDelta) maxDelta = delta;
            const px = (i / 4) % cv.width, py = Math.floor(i / 4 / cv.width);
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
          }
        }
        window.__smokeGradDiag = {
          cvW: cv.width, cvH: cv.height,
          diff, maxDelta,
          bbox: diff ? [minX, minY, maxX, maxY] : null,
        };
      }
      const gradientRasterRestored = [...inkRuntime.itemCanvases.get(layer.id).getContext('2d').getImageData(
        0, 0, smudge.canvas.width, smudge.canvas.height
      ).data].every((value, i) => value === beforeGradientPixels[i]);
      const gradientUndone = layer.strokes.length === gradientCount - 1 &&
        !layer.strokes.some(stroke => stroke.id === gradientStrokeId) && gradientRasterRestored;
      const gradientCountAfterUndo = layer.strokes.length;
      redo();
      await inkPaintIdle();
      await wait(120);
      const gradientRedone = layer.strokes.length === gradientCount &&
        layer.strokes.some(stroke => stroke.id === gradientStrokeId);

      if (typeof modeExitDraw === 'function') modeExitDraw();
      await wait(160);
      inkRemoveLayer(layer.id);
      ink.activeLayerId = previousLayerId;
      inkSyncLayersPanel();
      return JSON.stringify({
        available: true, brushKind: brush.kind, smudgeKind: smudge.kind,
        brushCursorOutsideCanvas,
        gradientKind: gradient.kind, smudgedPixel: smearedPixel,
        smudgeCount, smudgeCountAfterUndo, smudgeCountAfterRedo,
        smudgePixelAfterRedo, smudgeRasterRestored, gradientCount, gradientCountAfterUndo,
        smudgeCommitted, smudgePreviewMatches: smudge.previewMatches,
        smudgeUndone, smudgeRedone, gradientCommitted,
        gradientRasterRestored,
        gradDiag: window.__smokeGradDiag || null,
        gradientPreviewMatches: gradient.previewMatches,
        gradientUndone, gradientRedone,
        gradientCtrlZHandled: gradientUndone,
      });
    })()`));
    check('editörde parmak gerçek pikselleri sürüklüyor ve önizleme commit ile aynı',
      newToolEditor.available && newToolEditor.brushKind === 'stroke' &&
      newToolEditor.smudgeCommitted && newToolEditor.smudgedPixel[0] > newToolEditor.smudgedPixel[1] + 30 &&
      newToolEditor.smudgedPixel[3] > 0 &&
      newToolEditor.smudgePreviewMatches,
      JSON.stringify(newToolEditor));
    check('parmak vuruşu geri alınıp yine çizilebiliyor',
      newToolEditor.smudgeUndone && newToolEditor.smudgeRedone &&
      newToolEditor.smudgeRasterRestored,
      JSON.stringify(newToolEditor));
    check('fırça imleci tuval sınırının dışında da görünür kalıyor',
      newToolEditor.brushCursorOutsideCanvas,
      `dışarı=${newToolEditor.brushCursorOutsideCanvas}`);
    check('editörde gradyan önizlemesi commit ile aynı ve geri alınabiliyor',
      newToolEditor.gradientCommitted && newToolEditor.gradientPreviewMatches &&
      newToolEditor.gradientCtrlZHandled && newToolEditor.gradientRedone &&
      newToolEditor.gradientRasterRestored,
      JSON.stringify(newToolEditor));

  } catch (err) {
    console.error('TEST HATASI:', err && err.message ? err.message : err);
    fail += 1;
  } finally {
    try { ws && ws.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
    await sleep(300);
    console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BA�?ARISIZ'} (${pass}/${pass + fail})`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
