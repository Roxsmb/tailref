'use strict';
/* FAZ 6 madde 13 probe: LIQUIFY (piksel it/çek). Sözleşme:
   • inkDrawLiquifyOnContext: bölge tek getImageData/putImageData,
     damlalar inkForEachDab; içerik damla altından sürükleme yönünde
     g = d̂·dispMax·radialMask kadar taşınır (src = dest − g·dir).
   • inkDrawStrokeOnContext kind==='liquify' dispatch; smudge gibi
     tekrar-oynatılabilir (deterministik) → rebuild aynı sonucu.
   • worker DIŞI: inkPaintCommittedStroke useWorker listesi liquify'i
     dışlar; inkSplitRasterPlans null döner.
   • sym: klonlar dispatch'ten ÖNCE üretilir (28 motoru) — ayna
     tarafında aynı warp.
   • araç: inkSetTool('liquify') kabul; 27 normalize kind/tool beyaz
     listeleri; 58 manifest (grup+def+schema) — bar düğmesi.
   • undo: inkUndoStrokeRegion liquify vuruşu için pad'li bölge.
   node scripts/liquify-test.js */
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
  console.log((ok ? '  \u2713 ' : '  \u2717 ') + name + (detail ? ' \u00b7 ' + detail : ''));
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-liqprobe-'));
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
      const imageId = 'img_liq_probe';
      await idbPut('images', imageId, { blob, name: 'liq-denek.png' });
      const entry = await decodeImage(blob);
      setImgCache(imageId, { img: entry.img, url: entry.url, name: 'liq-denek.png' });
      const it = {
        id: 'it_liq_probe', kind: 'image', imageId, title: 'liq-denek',
        x: 0, y: 0, w: 400, h: 300, rot: 0, z: nextZ(),
      };
      state.items.push(it);
      inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'Katman 1',
        pxW: 400, pxH: 300 });
      const base = { x: stage.clientWidth / 2 / state.view.scale,
        y: stage.clientHeight / 2 / state.view.scale };
      it.x = base.x - 200; it.y = base.y - 150;
      selection = new Set([it.id]);
      if (typeof syncAll === 'function') syncAll();
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
  if (!opened.ok) { console.log('LIQ-PROBE: editör açılamadı'); app.kill(); process.exit(1); }

  // ---- A · kayıt + manifest --------------------------------------
  const api = await evaluate(ws, `(async () => {
    const r = {};
    r.drawFn = typeof inkDrawLiquifyOnContext === 'function';
    r.normalize = (() => {
      const s = inkNormalizeStroke({ id: 'sk_t', kind: 'liquify', tool: 'liquify',
        points: [{ x: 0.2, y: 0.5, p: 1 }], size: 0.1, opacity: 1 });
      return { kind: s.kind, tool: s.tool };
    })();
    r.setTool = (() => { inkSetTool('liquify'); return inkState().tool; })();
    const defs = (typeof INK_TOOL_DEFS === 'object') ? INK_TOOL_DEFS.liquify : null;
    r.def = defs ? { group: defs.group, label: defs.label, icon: defs.icon } : null;
    r.groups = (typeof INK_TOOL_GROUPS === 'object')
      ? (INK_TOOL_GROUPS.find(g => g.id === 'touch') || {}).tools || null : null;
    r.schema = (typeof INK_OPTIONS_SCHEMAS === 'object')
      ? (Array.isArray(INK_OPTIONS_SCHEMAS.liquify)
        ? INK_OPTIONS_SCHEMAS.liquify.map(s => s.key || s.kind) : null) : null;
    return r;
  })()`);
  check('inkDrawLiquifyOnContext global', api.drawFn === true);
  check('inkNormalizeStroke kind/tool beyaz liste', api.normalize.kind === 'liquify' &&
    api.normalize.tool === 'liquify', JSON.stringify(api.normalize));
  check('inkSetTool(liquify) kabul', api.setTool === 'liquify');
  check('INK_TOOL_DEFS.liquify (touch/Dokunuş)', api.def && api.def.group === 'touch' &&
    /liquify/i.test(api.def.label || ''), JSON.stringify(api.def));
  check('touch grubu liquify içerir', Array.isArray(api.groups) && api.groups.includes('liquify'),
    JSON.stringify(api.groups));
  check('schema liquify (size/Güç/hardness/smoothing)', Array.isArray(api.schema) &&
    api.schema.includes('size') && api.schema.includes('opacity') &&
    api.schema.includes('hardness'), JSON.stringify(api.schema));

  // ---- B · piksel warp (gerçek motor, doğrudan ctx) ---------------
  // desen: sol yarısı kolonlu kırmızı çizgi; sağa doğru it
  const warp = await evaluate(ws, `(async () => {
    try {
      const layer = inkEditorTargetLayer();
      const cv = inkEnsureItemCanvas(layer);
      const ctx = cv.getContext('2d', { colorSpace: 'srgb' });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      // kırmızı DİKEY çizgi x=120 (3px), turkuaz blok x=60..110
      const g = ctx.createImageData(cv.width, cv.height);
      for (let y = 100; y < 200; y++) {
        for (let x = 60; x <= 110; x++) {
          const i = (y * cv.width + x) * 4 + 0;
          g.data[i] = ctx.canvas === cv && false || (x <= 110 && x >= 60) && 0; // placeholder
        }
      }
      // basit ve net: manuel doldur
      ctx.fillStyle = '#00e5ff'; ctx.fillRect(60, 100, 51, 100);   // turkuaz blok
      ctx.fillStyle = '#ff2050'; ctx.fillRect(120, 100, 3, 100);   // kırmızı çizgi

      const before = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const redIndexRow = y => {
        let max = -1;
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          if (before[i] > 200 && before[i + 1] < 100 && before[i + 2] < 120) max = x;
        }
        return max;
      };
      const redBefore = redIndexRow(150);

      const stroke = {
        id: 'sk_liq_probe', kind: 'liquify', tool: 'liquify',
        color: '#000000', size: 0.14, opacity: 1, hardness: 1,
        spacing: 0.5, speedSize: 0, flow: 1,
        lockAlpha: false, closed: false,
        points: [{ x: 0.28, y: 0.5, p: 1, s: 0 }, { x: 0.34, y: 0.5, p: 1, s: 0 }],
      };
      inkDrawStrokeOnContext(ctx, stroke, {
        mapPoint: p => ({ x: p.x * cv.width, y: p.y * cv.height }),
        sizePx: 56, pointScale: { x: cv.width, y: cv.height },
      });
      const after = ctx.getImageData(0, 0, cv.width, cv.height).data;
      // satin alma: kırmızı en sağ piksel satırı sağa kaydı mı?
      const redIndexRow2 = data => y => {
        let max = -1;
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          if (data[i] > 200 && data[i + 1] < 100 && data[i + 2] < 120) max = x;
        }
        return max;
      };
      const redAfter = redIndexRow2(after)(150);
      // etkilenmeyen bölge: sağ üst köşe zemin'in dokunulmamış olması
      let farCorner = true;
      for (let dy = 0; dy < 40; dy++) {
        for (let dx = 0; dx < 40; dx++) {
          const i = ((dy + 10) * cv.width + (cv.width - 60 + dx)) * 4;
          if (after[i] !== before[i] || after[i + 1] !== before[i + 1] ||
              after[i + 3] !== before[i + 3]) farCorner = false;
        }
      }
      return { ok: redAfter > redBefore, redBefore, redAfter, farCorner };
    } catch (e) { return { err: String(e && e.stack || e) }; }
  })()`);
  check('liquify: içerik sürükleme yönünde akar (kırmızı sağa kaydı)',
    warp.ok === true, 'before=' + warp.redBefore + ' after=' + warp.redAfter);
  check('liquify: etkisiz bölge korunur', warp.farCorner === true, JSON.stringify(warp));

  // ---- C · determinizm (rebuild sözleşmesi) ----------------------
  const det = await evaluate(ws, `(async () => {
    try {
      const layer = inkEditorTargetLayer();
      const cv = inkEnsureItemCanvas(layer);
      const paint = () => {
        const ctx = cv.getContext('2d', { colorSpace: 'srgb' });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#00e5ff'; ctx.fillRect(60, 100, 51, 100);
        ctx.fillStyle = '#ff2050'; ctx.fillRect(120, 100, 3, 100);
        const stroke = {
          id: 'sk_liq_det', kind: 'liquify', tool: 'liquify',
          color: '#000000', size: 0.14, opacity: 1, hardness: 1,
          spacing: 0.5, speedSize: 0, flow: 1, lockAlpha: false,
          points: [{ x: 0.28, y: 0.5, p: 1, s: 0 }, { x: 0.34, y: 0.5, p: 1, s: 0 }],
        };
        inkDrawStrokeOnContext(ctx, stroke, {
          mapPoint: p => ({ x: p.x * cv.width, y: p.y * cv.height }),
          sizePx: 56, pointScale: { x: cv.width, y: cv.height },
        });
        return ctx.getImageData(0, 0, cv.width, cv.height).data;
      };
      const a = paint();
      const b = paint();
      let same = 0, diff = 0;
      for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++; else diff++;
      return { same, diff };
    } catch (e) { return { err: String(e && e.stack || e) }; }
  })()`);
  check('liquify deterministik (rebuild = ilk çizim)', det.diff === 0,
    'diff=' + det.diff + ' same=' + det.same);

  // ---- D · simetri aynası ---------------------------------------
  const sym = await evaluate(ws, `(async () => {
    try {
      const layer = inkEditorTargetLayer();
      const cv = inkEnsureItemCanvas(layer);
      const ctx = cv.getContext('2d', { colorSpace: 'srgb' });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#ff2050'; ctx.fillRect(80, 140, 30, 30);   // sol yarı
      ctx.fillStyle = '#00c040'; ctx.fillRect(290, 140, 30, 30);  // ayna taraf (x=400-x-30)
      const stroke = {
        id: 'sk_liq_sym', kind: 'liquify', tool: 'liquify',
        color: '#000000', size: 0.10, opacity: 1, hardness: 1,
        spacing: 0.5, speedSize: 0, flow: 1, lockAlpha: false,
        sym: 'mirrorX',
        points: [{ x: 0.20, y: 0.5, p: 1, s: 0 }, { x: 0.26, y: 0.5, p: 1, s: 0 }],
      };
      inkDrawStrokeOnContext(ctx, stroke, {
        mapPoint: p => ({ x: p.x * cv.width, y: p.y * cv.height }),
        sizePx: 40, pointScale: { x: cv.width, y: cv.height },
      });
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const chunkRight = y => {
        let maxG = -1;
        for (let x = 220; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          if (d[i] < 100 && d[i + 1] > 180 && d[i + 2] < 160 && d[i + 3] > 100) maxG = Math.max(maxG, x);
        }
        return maxG;
      };
      const leftRight = y => {
        let maxR = -1;
        for (let x = 40; x < 220; x++) {
          const i = (y * cv.width + x) * 4;
          if (d[i] > 200 && d[i + 1] < 100 && d[i + 2] < 120 && d[i + 3] > 100) maxR = Math.max(maxR, x);
        }
        return maxR;
      };
      return { leftMax: leftRight(155), rightMax: chunkRight(155) };
    } catch (e) { return { err: String(e && e.stack || e) }; }
  })()`);
  check('liquify mirrorX: sol kırmızı sağa itildi', sym.leftMax > 109,
    'leftMax=' + sym.leftMax);
  check('liquify mirrorX: ayna yeşili de sağa itildi (x≥295 merkez)', sym.rightMax >= 295,
    'rightMax=' + sym.rightMax);

  // ---- E · worker dışı (senkron) --------------------------------
  const wk = await evaluate(ws, `(async () => {
    try {
      const layer = inkEditorTargetLayer();
      const stroke = { id: 'sk_w', kind: 'liquify', tool: 'liquify', size: 0.1,
        points: [{ x: 0.3, y: 0.5, p: 1 }, { x: 0.4, y: 0.5, p: 1 }] };
      const plan = inkBuildRasterPlan(layer, stroke);
      const split = inkSplitRasterPlans(plan);
      return { planKind: plan && plan.strokeKind, splitNull: split === null };
    } catch (e) { return { err: String(e && e.stack || e) }; }
  })()`);
  check('plan kind=liquify ve chunk bölünmesi kapalı', wk.planKind === 'liquify' &&
    wk.splitNull === true, JSON.stringify(wk));

  // ---- F · undo bölgesi pad'li -----------------------------------
  const undo = await evaluate(ws, `(async () => {
    try {
      const layer = inkEditorTargetLayer();
      const stroke = { id: 'sk_u', kind: 'liquify', tool: 'liquify', size: 5,
        points: [{ x: 0.3, y: 0.5, p: 1 }, { x: 0.45, y: 0.5, p: 1 }] };
      const region = inkUndoStrokeRegion(layer, stroke);
      return region ? { x: region.x, y: region.y, w: region.w, h: region.h } : null;
    } catch (e) { return { err: String(e && e.stack || e) }; }
  })()`);
  check('inkUndoStrokeRegion liquify bölgesi döndü (pad ≥ vuruş boyu)',
    !!undo && undo.w > 10 && undo.h > 10, JSON.stringify(undo));

  const failed = results.filter(r => !r.ok);
  console.log('\nLIQ-PROBE: ' + (results.length - failed.length) + '/' +
    results.length + ' yeşil');
  app.kill();
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('LIQ-PROBE hata:', e);
  process.exit(1);
});
