'use strict';

/* FX pipeline testi (Faz 1) — gerçek Electron penceresinde.
   Master spec: docs/fx-motoru-spec.md · Bölüm 12 raporu: docs/fx-bolum12-inceleme.md

   Kapsam:
   • inkFxEnsure normalize: bozuk/bilinmeyen stack düşer, params kelepçelenir.
   • Halftone kayıtlı + şema tam.
   • Girdi rasterı: üretim + önbellek + gen bump tazeleme (inkBumpLayerGen).
   • Determinizm: aynı girdi + parametre + seed → piksel birebir.
   • Aşama önbelleği: cache hit aynı canvas; parametre değişimi yeni aşama.
   • Pass-through: visible=false / opacity=0 → zincir null (hesap yok).
   • Ekran senkronu: .inkFxCanvas var, katman/grup tuvalleri gizli;
     fx kapanınca kanvas kaldırılır, normal yol geri döner.
   • Export parity: inkDrawAttachedForExport == inkFxApplyChain (piksel birebir).
   • Undo kapsamı: item.fx pushUndo/undo/redo ile taşınır.
   • Snapshot: fx verisi createStateSnapshot JSON'una girer.

   Kullanım: node tests/fx-pipeline-test.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9347;
const APP_PORT = 5251;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const evaluate = (ws, expression, timeout = 15000) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const timer = setTimeout(() => {
    ws.removeEventListener('message', onMsg);
    reject(new Error('eval zaman aşımı'));
  }, timeout);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    clearTimeout(timer);
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result && msg.result.exceptionDetails) {
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    }
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

async function waitReady(ws, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const ok = await evaluate(ws, '!!(window.__tailrefWorkspace && window.__tailrefWorkspace.ready)', 3000);
      if (ok) return true;
    } catch { /* bağlam yeniden yükleniyor olabilir */ }
    await sleep(350);
  }
  return false;
}

const results = [];
function ok(name, detail) { results.push(true); console.log('OK  ', name, detail ? '→ ' + detail : ''); }
function fail(name, detail) { results.push(false); console.log('FAIL', name, '→', detail); }

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-fxpipeline-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--disable-gpu'], { cwd: ROOT, env, stdio: 'ignore' });

  try {
    const page = await waitForTarget();
    const ws = await connect(page.webSocketDebuggerUrl);
    await sleep(2500);
    await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
    if (!await waitReady(ws)) throw new Error('uygulama hazır olmadı');

    /* --- test görseli + dolu katman kur --- */
    const seed = await evaluate(ws, `(async () => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 120;
      const g = c.getContext('2d');
      g.fillStyle = '#4da3ff'; g.fillRect(0, 0, 160, 120);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await addFiles([new File([blob], 'fx-test.png', { type: 'image/png' })], null);
      await new Promise(r => setTimeout(r, 700));
      const it = state.items[state.items.length - 1];
      selection.clear(); selection.add(it.id);
      const layer = inkEnsureAttachedLayer(it.id, { name: 'Taban' });
      /* gerçek katman tuvali: DOM'a bağlı olmalı, aksi halde sonraki
         inkSyncDom inkEnsureItemCanvas çağrısı boş tuvalle değiştirir.
         Boyut sabit 2× taban: test örnekleme noktaları çözünürlüğe bağlı kalmasın. */
      const W = Math.max(64, Math.round(it.w * 2));
      const H = Math.max(64, Math.round(it.h * 2));
      layer.pxW = W; layer.pxH = H;
      const cv = inkEnsureItemCanvas(layer) || inkRuntime.itemCanvases.get(layer.id);
      const gc = cv.getContext('2d');
      gc.clearRect(0, 0, W, H);
      /* koyu-sol / açık-sağ: halftone dot boyutları farklı olmalı */
      gc.fillStyle = 'rgba(20,20,20,1)'; gc.fillRect(0, 0, Math.floor(W / 2), H);
      gc.fillStyle = 'rgba(235,235,235,1)'; gc.fillRect(Math.floor(W / 2), 0, W - Math.floor(W / 2), H);
      inkBumpLayerGen(layer.id);
      /* yeni katman "dirty" doğar: ilk inkSyncDom katmanı boş stroke
         listesinden yeniden kurup doldurduğumuz pikseli siler */
      inkRuntime.dirtyLayers.delete(layer.id);
      return JSON.stringify({ it: it.id, layer: layer.id, W, H });
    })()`).then(JSON.parse);
    ok('test görseli + dolu attached katman kuruldu', JSON.stringify(seed));

    /* --- 1. normalize: bozuk stack temizlenir --- */
    const norm = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      it.fx = { stack: [
        null,
        { type: 'bilinmeyen-efekt', params: {} },
        { type: 'halftone', params: { dotSpacing: 9999, dotShape: 'yildiz', colorMode: 'color' },
          opacity: 7, visible: 0, blend: 'screen', seed: 424242 },
      ] };
      inkFxEnsure(it);
      const fx = it.fx.stack;
      return JSON.stringify({
        len: fx.length,
        paramsSpacing: fx[0] && fx[0].params.dotSpacing,
        shape: fx[0] && fx[0].params.dotShape,
        mode: fx[0] && fx[0].params.colorMode,
        opacity: fx[0] && fx[0].opacity,
        visible: fx[0] && fx[0].visible,
        blend: fx[0] && fx[0].blend,
        seed: fx[0] && fx[0].seed,
      });
    })()`);
    const n = JSON.parse(norm);
    if (n.len === 1 && n.paramsSpacing === 128 && n.shape === 'circle'
        && n.mode === 'color' && n.opacity === 1 && n.visible === false
        && n.blend === 'screen' && n.seed === 424242) {
      ok('inkFxEnsure: bilinmeyen düşer, params kelepçelenir, alanlar onarılır', JSON.stringify(n));
    } else {
      fail('inkFxEnsure: bilinmeyen düşer, params kelepçelenir, alanlar onarılır', JSON.stringify(n));
    }

    /* --- 2. Halftone kayıtlı + şema tam --- */
    const def = await evaluate(ws, `(() => {
      const d = INK_FX_EFFECTS.get('halftone');
      if (!d) return JSON.stringify({ has: false });
      return JSON.stringify({
        has: true, paramCount: d.params.length,
        hasApply: typeof d.apply === 'function',
        groups: d.params.filter(p => ['dotSize','dotSpacing','dotAngle','dotShape'].includes(p.key)).length
          + d.params.filter(p => ['contrast','threshold'].includes(p.key)).length
          + d.params.filter(p => ['colorMode','dotColor','invertPattern'].includes(p.key)).length,
      });
    })()`);
    const d = JSON.parse(def);
    if (d.has && d.hasApply && d.paramCount >= 14 && d.groups === 9) {
      ok('halftone kayıtlı + şema tam (dot/image/appearance grupları)', JSON.stringify(d));
    } else {
      fail('halftone kayıtlı + şema tam (dot/image/appearance grupları)', JSON.stringify(d));
    }

    /* --- 3. girdi rasterı + önbellek --- */
    const input1 = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const r1 = inkFxInputRaster(it);
      const s1 = r1.sig;
      const r2 = inkFxInputRaster(it);
      return JSON.stringify({
        w: r1.w, h: r1.h, sameCanvas: r1.canvas === r2.canvas,
        sigLen: s1.length,
      });
    })()`);
    const i1 = JSON.parse(input1);
    if (i1.w > 0 && i1.h > 0 && i1.sameCanvas) {
      ok('inkFxInputRaster: üretilir + önbellek (aynı canvas)', JSON.stringify(i1));
    } else {
      fail('inkFxInputRaster: üretilir + önbellek (aynı canvas)', JSON.stringify(i1));
    }

    /* --- 4. gen bump → girdi rasterı tazelenir ---
       Not: tuval geri dönüşümü nedeniyle tuval KİMLİĞİ değişmez (aynı
       boyutta clearRect + yeniden çizim). Sözleşme: önbellek KAYDI ve
       imza değişir, içerik tazelenir. */
    const input2 = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const before = inkFxInputRaster(it);
      inkBumpLayerGen(${JSON.stringify(seed.layer)});
      const after = inkFxInputRaster(it);
      return JSON.stringify({
        sigChanged: before.sig !== after.sig,
        newRecord: before !== after,
        filled: after.canvas.getContext('2d').getImageData(
          Math.floor(after.w / 4), Math.floor(after.h / 2), 1, 1).data[0] === 20,
      });
    })()`);
    const i2 = JSON.parse(input2);
    if (i2.sigChanged && i2.newRecord && i2.filled) {
      ok('gen sayacı girdi rasterını tazeliyor (vuruş commit deseninin aynısı)', JSON.stringify(i2));
    } else {
      fail('gen sayacı girdi rasterını tazeliyor (vuruş commit deseninin aynısı)', JSON.stringify(i2));
    }

    /* --- 5. zincir: halftone uygulanır (koyu tarafta büyük dot, açıkta küçük/yok) --- */
    const chain = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      it.fx = { stack: [{ id: 'fx_t1', type: 'halftone',
        params: { dotSpacing: 16, dotSize: 14, dotAngle: 45, colorMode: 'mono',
          threshold: 0.97, bgColor: 'none' },
        opacity: 1, visible: true, blend: 'normal', seed: 12345 }] };
      const input = inkFxInputRaster(it);
      const out1 = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      const out2 = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      const g = out1.getContext('2d');
      const px = g.getImageData(0, 0, out1.width, out1.height).data;
      /* koyu yarı merkez örnek vs açık yarı merkez örnek */
      const li = (Math.floor(out1.height / 2) * out1.width + Math.floor(out1.width / 4)) * 4;
      const ri = (Math.floor(out1.height / 2) * out1.width + Math.floor(out1.width * 3 / 4)) * 4;
      return JSON.stringify({
        has: !!out1, sameRef: out1 === out2,
        darkA: px[li + 3], lightA: px[ri + 3],
        darkCovered: px[li] < 200, lightMostlyPaper: px[ri] > 180,
      });
    })()`);
    const c1 = JSON.parse(chain);
    if (c1.has && c1.sameRef && c1.darkCovered && c1.lightMostlyPaper) {
      ok('halftone aşaması: koyu→yoğun dot, açık→kâğıt; cache hit aynı canvas', JSON.stringify(c1));
    } else {
      fail('halftone aşaması: koyu→yoğun dot, açık→kâğıt; cache hit aynı canvas', JSON.stringify(c1));
    }

    /* --- 6. determinizm: invalidate sonrası tam recompute piksel birebir --- */
    const det = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const input = inkFxInputRaster(it);
      const a = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
      inkFxInvalidate(it.id);
      const b = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      let diff = 0;
      for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++;
      return JSON.stringify({ diff, px: da.length / 4 });
    })()`);
    const d1 = JSON.parse(det);
    if (d1.diff === 0) {
      ok('determinizm: önbelleksiz yeniden hesap piksel birebir (seed sabit)', JSON.stringify(d1));
    } else {
      fail('determinizm: önbelleksiz yeniden hesap piksel birebir (seed sabit)', JSON.stringify(d1));
    }

    /* --- 7. parametre değişimi → aşama yeniden hesaplanır ---
       Tuval geri dönüşümü nedeniyle nesne kimliği sabit kalabilir; kanıt
       piksel farkıdır (dotSpacing 16→9 çıktıyı değiştirmeli). */
    const pchange = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const input = inkFxInputRaster(it);
      const a = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
      it.fx.stack[0].params.dotSpacing = 9;
      const b = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      let diff = 0;
      for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++;
      return JSON.stringify({ changed: a !== b, diff });
    })()`);
    const pc = JSON.parse(pchange);
    if (pc.changed || pc.diff > 0) {
      ok('parametre değişimi aşamayı yeniden hesaplar (sig değişimi)', pc);
    } else {
      fail('parametre değişimi aşamayı yeniden hesaplar (sig değişimi)', pc);
    }

    /* --- 8. pass-through: visible=false / opacity=0 → null --- */
    const pass = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const input = inkFxInputRaster(it);
      it.fx.stack[0].visible = false;
      const r1 = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      it.fx.stack[0].visible = true;
      it.fx.stack[0].opacity = 0;
      const r2 = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      return JSON.stringify({ hiddenNull: r1 === null, zeroNull: r2 === null });
    })()`);
    const p1 = JSON.parse(pass);
    if (p1.hiddenNull && p1.zeroNull) {
      ok('pass-through: gizli/sıfır opaklık aşama HESAPSIZ geçer', JSON.stringify(p1));
    } else {
      fail('pass-through: gizli/sıfır opaklık aşama HESAPSIZ geçer', JSON.stringify(p1));
    }

    /* --- 9. opacity karışımı: 0.5 aşama girdiyle farklı, 1.0 ile de farklı --- */
    const opac = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const input = inkFxInputRaster(it);
      it.fx.stack[0].opacity = 0.5;
      const half = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      const dh = half.getContext('2d').getImageData(0, 0, half.width, half.height).data;
      it.fx.stack[0].opacity = 1;
      const full = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      const df = full.getContext('2d').getImageData(0, 0, full.width, full.height).data;
      let diff = 0;
      for (let i = 0; i < dh.length; i++) if (dh[i] !== df[i]) diff++;
      return JSON.stringify({ diff, px: dh.length / 4 });
    })()`);
    const o1 = JSON.parse(opac);
    if (o1.diff > 0) {
      ok('efekt opaklığı aşama karışımına girer (0.5 ≠ 1.0)', JSON.stringify(o1));
    } else {
      fail('efekt opaklığı aşama karışımına girer (0.5 ≠ 1.0)', JSON.stringify(o1));
    }

    /* --- 10. ekran senkronu: fx kanvası taşır, tuvaller gizli --- */
    const sync = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const el = document.createElement('div');
      const handled = inkFxSyncItem(it, el);
      const fxc = el.querySelector(':scope > .inkFxCanvas');
      const layerCanvas = inkRuntime.itemCanvases.get(${JSON.stringify(seed.layer)});
      return JSON.stringify({
        handled, hasFxCanvas: !!fxc,
        fxcSize: fxc ? fxc.width + 'x' + fxc.height : '',
        layerHidden: layerCanvas.style.display === 'none',
      });
    })()`);
    const s1 = JSON.parse(sync);
    if (s1.handled && s1.hasFxCanvas && s1.layerHidden) {
      ok('ekran senkronu: tek inkFxCanvas + katman tuvalleri gizli', JSON.stringify(s1));
    } else {
      fail('ekran senkronu: tek inkFxCanvas + katman tuvalleri gizli', JSON.stringify(s1));
    }

    /* --- 11. fx kapanınca normal yola geri --- */
    const unsync = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const el = document.createElement('div');
      /* önce fx kur (kanvas oluşsun), sonra kapat */
      inkFxSyncItem(it, el);
      it.fx.stack[0].visible = false;
      const handled = inkFxSyncItem(it, el);
      const gone = !el.querySelector(':scope > .inkFxCanvas');
      const layerCanvas = inkRuntime.itemCanvases.get(${JSON.stringify(seed.layer)});
      inkCompositeSyncItem(it, el);
      const restored = layerCanvas.style.display === '';
      it.fx.stack[0].visible = true;
      return JSON.stringify({ handledFalse: handled === false, gone, restored });
    })()`);
    const u1 = JSON.parse(unsync);
    if (u1.handledFalse && u1.gone && u1.restored) {
      ok('fx kapanınca kanvas kaldırılır + normal ekran yolu geri döner', JSON.stringify(u1));
    } else {
      fail('fx kapanınca kanvas kaldırılır + normal ekran yolu geri döner', JSON.stringify(u1));
    }

    /* --- 12. export parity: export çizimi == zincir nihai rasterı --- */
    const parity = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const input = inkFxInputRaster(it);
      const final = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      /* export yolu: item yerel uzayı (merkez 0,0) */
      const e = document.createElement('canvas');
      e.width = Math.round(it.w); e.height = Math.round(it.h);
      const ectx = e.getContext('2d');
      ectx.translate(e.width / 2, e.height / 2);
      inkDrawAttachedForExport(ectx, it);
      /* karşılaştırma: final → aynı ölçek */
      const c = document.createElement('canvas');
      c.width = e.width; c.height = e.height;
      const cctx = c.getContext('2d');
      cctx.drawImage(final, 0, 0, c.width, c.height);
      const a = ectx.getImageData(0, 0, e.width, e.height).data;
      const b = cctx.getImageData(0, 0, c.width, c.height).data;
      let diff = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      return JSON.stringify({ diff, px: a.length / 4 });
    })()`);
    const par = JSON.parse(parity);
    if (par.diff === 0) {
      ok('export == ekran zinciri (piksel birebir, tek kaynak inkFxApplyChain)', JSON.stringify(par));
    } else {
      fail('export == ekran zinciri (piksel birebir, tek kaynak inkFxApplyChain)', JSON.stringify(par));
    }

    /* --- 13. undo kapsamı: item.fx pushUndo/undo/redo --- */
    const undo = await evaluate(ws, `(async () => {
      const it = getItem(${JSON.stringify(seed.it)});
      const before = JSON.stringify(it.fx.stack.map(f => f.type));
      pushUndo();
      it.fx.stack[0].type = 'halftone';
      it.fx.stack.push({ id: 'fx_t2', type: 'halftone', params: {}, opacity: 1,
        visible: true, blend: 'normal', seed: 99 });
      inkFxInvalidate(it.id);
      await new Promise(r => setTimeout(r, 50));
      undo();
      await new Promise(r => setTimeout(r, 150));
      const after = getItem(${JSON.stringify(seed.it)});
      const back = JSON.stringify(after.fx.stack.map(f => f.type));
      redo();
      await new Promise(r => setTimeout(r, 150));
      const redone = getItem(${JSON.stringify(seed.it)});
      return JSON.stringify({
        before, back, stackLenRedo: redone.fx.stack.length,
        ok: back === before,
      });
    })()`);
    const un = JSON.parse(undo);
    if (un.ok && un.stackLenRedo === 2) {
      ok('item.fx undo/redo ile taşınır (snapshot JSON kapsamı)', JSON.stringify(un));
    } else {
      fail('item.fx undo/redo ile taşınır (snapshot JSON kapsamı)', JSON.stringify(un));
    }

    /* --- 14. snapshot fx'i içerir --- */
    const snap = await evaluate(ws, `(() => {
      const s = JSON.stringify(createStateSnapshot());
      return JSON.stringify({ hasHalftone: s.includes('"halftone"'), hasFx: s.includes('"fx"') });
    })()`);
    const sn = JSON.parse(snap);
    if (sn.hasHalftone && sn.hasFx) {
      ok('createStateSnapshot fx verisini kapsar (kayit/reload hazır)', JSON.stringify(sn));
    } else {
      fail('createStateSnapshot fx verisini kapsar (kayit/reload hazır)', JSON.stringify(sn));
    }

    /* =========================================================
       FAZ 2 — ilk dalga 8 efekt (65-ink-fx-effects.js)
       ========================================================= */

    /* --- 15. registry tamlığı: 20 efekt, şema + apply tam --- */
    const reg = await evaluate(ws, `(() => {
      const ids = ['halftone','risograph','watercolor','colored-pencil',
        'crosshatching','dithering','chromatic-aberration','ink-bleed',
        'cmyk','linocut','woodcut','paper-grain','oil-paint','charcoal',
        'stippling','dry-brush','glitch-art','contour','posterization','color-halation'];
      const missing = ids.filter(id => !INK_FX_EFFECTS.has(id));
      const bad = ids.filter(id => {
        const d = INK_FX_EFFECTS.get(id);
        return !d || !Array.isArray(d.params) || !d.params.length
          || typeof d.apply !== 'function' || !d.label || !d.category;
      });
      return JSON.stringify({ size: INK_FX_EFFECTS.size, missing, bad });
    })()`);
    const rg = JSON.parse(reg);
    if (rg.size === 20 && !rg.missing.length && !rg.bad.length) {
      ok('registry: 20/20 efekt kayıtlı, params + apply + label + category tam', JSON.stringify(rg));
    } else {
      fail('registry: 20/20 efekt kayıtlı, params + apply + label + category tam', JSON.stringify(rg));
    }

    /* --- 16. smoke apply: her efekt piksel basar + deterministik --- */
    const smoke = await evaluate(ws, `(() => {
      const w = 96, h = 72;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, '#c0392b'); grd.addColorStop(0.5, '#f1c40f');
      grd.addColorStop(1, '#2c3e50');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath(); g.arc(w * 0.7, h * 0.35, 12, 0, Math.PI * 2); g.fill();
      const ids = ['risograph','watercolor','colored-pencil','crosshatching',
        'dithering','chromatic-aberration','ink-bleed',
        'cmyk','linocut','woodcut','paper-grain','oil-paint','charcoal',
        'stippling','dry-brush','glitch-art','contour','posterization','color-halation'];
      const out = {};
      for (const id of ids) {
        const def = INK_FX_EFFECTS.get(id);
        if (!def) { out[id] = 'yok'; continue; }
        const params = {};
        for (const p of def.params) params[p.key] = p.default;
        const o = document.createElement('canvas'); o.width = w; o.height = h;
        const octx = o.getContext('2d');
        def.apply(octx, c, params, { w, h }, inkFxRng(12345));
        const d = octx.getImageData(0, 0, w, h).data;
        let cov = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) cov++;
        /* determinizm: bağımsız ikinci uygulama aynı pikseller */
        const o2 = document.createElement('canvas'); o2.width = w; o2.height = h;
        def.apply(o2.getContext('2d'), c, params, { w, h }, inkFxRng(12345));
        const d2 = o2.getContext('2d').getImageData(0, 0, w, h).data;
        let diff = 0;
        for (let i = 0; i < d.length; i++) if (d[i] !== d2[i]) diff++;
        out[id] = { cov, diff };
      }
      return JSON.stringify(out);
    })()`);
    const sm = JSON.parse(smoke);
    const smokeBad = Object.entries(sm)
      .filter(([, v]) => typeof v !== 'object' || v.cov === 0 || v.diff !== 0)
      .map(([k, v]) => k + '=' + JSON.stringify(v));
    if (!smokeBad.length) {
      ok('19 efekt smoke apply: piksel basıyor + determinizm (diff 0)', smoke);
    } else {
      fail('19 efekt smoke apply: piksel basıyor + determinizm (diff 0)', smokeBad.join(' · '));
    }

    /* --- 17. Dithering paletleri: gameboy çıktısı paletten şaşmaz --- */
    const dith = await evaluate(ws, `(() => {
      const P0 = INK_DITHER_PALETTES;
      const def = INK_FX_EFFECTS.get('dithering');
      const params = {};
      for (const q of def.params) params[q.key] = q.default;
      params.palette = 'gameboy'; params.colorMode = 'color';
      const w = 64, h = 48;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#e74c3c'; g.fillRect(0, 0, w, h);
      const o = document.createElement('canvas'); o.width = w; o.height = h;
      def.apply(o.getContext('2d'), c, params, { w, h }, inkFxRng(7));
      const d = o.getContext('2d').getImageData(0, 0, w, h).data;
      const okPal = new Set(P0.gameboy.map(c2 => c2.join(',')));
      let off = 0, cov = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue; cov++;
        if (!okPal.has(d[i] + ',' + d[i + 1] + ',' + d[i + 2])) off++;
      }
      return JSON.stringify({ palCount: P0.gameboy.length, cov, off });
    })()`);
    const dt = JSON.parse(dith);
    if (dt.palCount === 4 && dt.cov > 0 && dt.off === 0) {
      ok('dithering: gameboy paleti (4 renk) çıktı paletten şaşmaz', JSON.stringify(dt));
    } else {
      fail('dithering: gameboy paleti (4 renk) çıktı paletten şaşmaz', JSON.stringify(dt));
    }

    /* --- 18. CA kanal kayması: kırmızı doku ofset yönünde taşar --- */
    const ca = await evaluate(ws, `(() => {
      const def = INK_FX_EFFECTS.get('chromatic-aberration');
      const params = {};
      for (const q of def.params) params[q.key] = q.default;
      params.separationDistance = 0; /* yalnız sabit kanal offsetleri */
      const w = 64, h = 48;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 32, h);
      const o = document.createElement('canvas'); o.width = w; o.height = h;
      def.apply(o.getContext('2d'), c, params, { w, h }, inkFxRng(7));
      const d = o.getContext('2d').getImageData(0, 0, w, h).data;
      const at = x => { const i = (24 * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
      const mid = at(30);    /* kaynak kırmızı: r=255 kalır */
      const fringe = at(34); /* kaynak boş: redOffsetX=+6 → kırmızı sızması */
      return JSON.stringify({
        midRed: mid[0] === 255 && mid[1] === 0 && mid[2] === 0,
        fringeRed: fringe[0] > 200 && fringe[1] < 100 && fringe[3] > 200,
      });
    })()`);
    const cav = JSON.parse(ca);
    if (cav.midRed && cav.fringeRed) {
      ok('chromatic aberration: red kanal +6 kaydı kenar taşması üretir', JSON.stringify(cav));
    } else {
      fail('chromatic aberration: red kanal +6 kaydı kenar taşması üretir', JSON.stringify(cav));
    }

    /* =========================================================
       FAZ 4 — panel + inspector + preset sistemi (68/69 modülleri)
       ========================================================= */

    /* --- 19. FX paneli + Effect Browser: + FX butonu, 3 kategori, 20 hücre,
              GERÇEK önizlemeler, arama --- */
    const browser = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      /* Faz 4 testleri temiz stack ile başlar */
      it.fx = { stack: [] };
      inkFxInvalidate(it.id);
      selection.clear();
      selection.add(it.id);
      try { if (typeof inkUpdateGizmo === 'function') inkUpdateGizmo(); } catch { }
      inkSyncLayersPanel();
      const out = {};
      out.hasBtn = !!document.getElementById('btnInkAddFx');
      out.hasSection = !!document.getElementById('inkFxSection');
      out.sectionVisible = !document.getElementById('inkFxSection').hidden;
      document.getElementById('btnInkAddFx').click();
      out.browserOpen = !document.getElementById('inkFxBrowser').hidden;
      out.cellCount = document.querySelectorAll('#inkFxGrid .inkFxCell').length;
      out.catCount = document.querySelectorAll('#inkFxGrid .inkFxGridHead').length;
      let painted = 0;
      for (const c of document.querySelectorAll('#inkFxGrid .inkFxThumb')) {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - 246) > 24 || Math.abs(d[i + 1] - 243) > 24
            || Math.abs(d[i + 2] - 234) > 24) n++;
        }
        if (n > c.width * c.height * 0.05) painted++;
      }
      out.paintedThumbs = painted;
      const search = document.getElementById('inkFxSearch');
      search.value = 'water';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      out.filtered = [...document.querySelectorAll('#inkFxGrid .inkFxCell')]
        .filter(c => !c.hidden).length;
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      return JSON.stringify(out);
    })()`);
    const br = JSON.parse(browser);
    if (br.hasBtn && br.hasSection && br.sectionVisible && br.browserOpen
      && br.cellCount === 20 && br.catCount === 3 && br.paintedThumbs === 20
      && br.filtered === 1) {
      ok('browser: + FX butonu, 3 kategori, 20 hücre, gerçek önizleme, arama', JSON.stringify(br));
    } else {
      fail('browser: + FX butonu, 3 kategori, 20 hücre, gerçek önizleme, arama', JSON.stringify(br));
    }

    /* --- 20. hücre tıklaması efekt ekler + inspector dinamik kontroller --- */
    const addFx = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const cell = document.querySelector('#inkFxGrid .inkFxCell[data-type="watercolor"]');
      cell.click();
      const stack = it.fx.stack;
      const rows = document.querySelectorAll('#inkFxStack .inkFxRow').length;
      const insp = document.getElementById('inkFxInspector');
      const def = INK_FX_EFFECTS.get('watercolor');
      return JSON.stringify({
        len: stack.length, type: stack[0] && stack[0].type,
        rows, title: insp.querySelector('.inkFxTitle') &&
          insp.querySelector('.inkFxTitle').textContent,
        sliders: insp.querySelectorAll('input[type="range"][data-param]').length,
        nums: insp.querySelectorAll('input.inkFxNum').length,
        defParams: def.params.length,
        groups: insp.querySelectorAll('details.inkFxGroup').length,
        opOut: !!document.getElementById('inkFxOpacity'),
        blend: !!document.getElementById('inkFxBlend'),
        visible: !!insp.querySelector('[data-role="fx-visible"]'),
        presetSel: !!insp.querySelector('[data-role="fx-preset"]'),
      });
    })()`);
    const af = JSON.parse(addFx);
    if (af.len === 1 && af.type === 'watercolor' && af.rows === 1 && af.title === 'Watercolor'
      && af.sliders === af.defParams && af.nums === af.defParams && af.groups === 3
      && af.opOut && af.blend && af.visible && af.presetSel) {
      ok('hücre → efekt ekler; inspector ' + af.defParams + ' slider+number, 3 bölüm, ortak kontroller', JSON.stringify(af));
    } else {
      fail('hücre → efekt ekler; inspector dinamik kontroller', JSON.stringify(af));
    }

    /* --- 21. slider kontrolü parametreyi yazar + render gerçekten değişir --- */
    const slider = await evaluate(ws, `(async () => {
      const it = getItem(${JSON.stringify(seed.it)});
      const el = document.createElement('div');
      const snap = () => {
        el.replaceChildren();
        inkFxSyncItem(it, el);
        const fxc = el.querySelector(':scope > .inkFxCanvas');
        if (!fxc) return '';
        const d = fxc.getContext('2d').getImageData(0, 0, fxc.width, fxc.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] * 7 + d[i + 1] * 11 + d[i + 2] * 13 + d[i + 3];
        return String(sum);
      };
      const before = snap();
      const range = document.querySelector('#inkFxInspector input[type="range"][data-param="waterSpread"]');
      range.value = '0.9';
      range.dispatchEvent(new Event('input', { bubbles: true }));
      const paramSet = it.fx.stack[0].params.waterSpread === 0.9;
      const numSync = document.querySelector('#inkFxInspector input.inkFxNum[data-param="waterSpread"]').value;
      const after = snap();
      return JSON.stringify({ paramSet, numSync, renderChanged: before !== after, before, after });
    })()`);
    const sl = JSON.parse(slider);
    if (sl.paramSet && sl.numSync === '0.9' && sl.renderChanged) {
      ok('slider → parametre yazılır + ekran renderı değişir + number eşzamanlanır', JSON.stringify(sl));
    } else {
      fail('slider → parametre yazılır + ekran renderı değişir + number eşzamanlanır', JSON.stringify(sl));
    }

    /* --- 22. built-in presetler: her efekt ≥3, tam konfigürasyon,
              varsayılan çıktıdan GÖRÜNÜR farklı --- */
    const presets = await evaluate(ws, `(() => {
      const ids = [...INK_FX_EFFECTS.keys()];
      const missing = ids.filter(id => !(INK_FX_PRESETS[id] || []).length);
      let minCount = Infinity;
      const baseOut = new Map();
      const w = 64, h = 48;
      const sample = document.createElement('canvas');
      sample.width = w; sample.height = h;
      const sg = sample.getContext('2d');
      const grd = sg.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, '#c0392b'); grd.addColorStop(0.5, '#f1c40f');
      grd.addColorStop(1, '#2c3e50');
      sg.fillStyle = grd; sg.fillRect(0, 0, w, h);
      sg.fillStyle = 'rgba(255,255,255,0.5)';
      sg.beginPath(); sg.arc(w * 0.7, h * 0.35, 9, 0, Math.PI * 2); sg.fill();
      const render = (id, params) => {
        const o = document.createElement('canvas'); o.width = w; o.height = h;
        INK_FX_EFFECTS.get(id).apply(o.getContext('2d'), sample, params, { w, h }, inkFxRng(0x5eed));
        return o.getContext('2d').getImageData(0, 0, w, h).data.join(',');
      };
      const identical = [];
      for (const id of ids) {
        minCount = Math.min(minCount, (INK_FX_PRESETS[id] || []).length);
        const defParams = inkFxUiResolvePreset(id, null);
        baseOut.set(id, render(id, defParams));
        for (const pr of INK_FX_PRESETS[id]) {
          const resolved = inkFxUiResolvePreset(id, pr.p);
          const sig = JSON.stringify(resolved);
          if (!sig.includes('"')) { /* yok */ }
          if (render(id, resolved) === baseOut.get(id)) {
            identical.push(id + '/' + pr.name);
          }
        }
      }
      return JSON.stringify({ missing, minCount, identical });
    })()`);
    const pr0 = JSON.parse(presets);
    if (!pr0.missing.length && pr0.minCount >= 3 && !pr0.identical.length) {
      ok('preset: 20/20 efekt ≥3 built-in, çıktı varsayılandan görünür farklı', JSON.stringify({ minCount: pr0.minCount }));
    } else {
      fail('preset: 20/20 efekt ≥3 built-in, çıktı varsayılandan görünür farklı',
        JSON.stringify(pr0));
    }

    /* --- 23. preset select'ten uygulanır: parametreler tam gelir --- */
    const presetApply = await evaluate(ws, `(() => {
      const sel = document.querySelector('#inkFxInspector [data-role="fx-preset"]');
      sel.value = 'b:Heavy Pigment';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const it = getItem(${JSON.stringify(seed.it)});
      const fx = it.fx.stack[0];
      const sel2 = document.querySelector('#inkFxInspector [data-role="fx-preset"]');
      return JSON.stringify({
        density: fx.params.pigmentDensity,
        transparency: fx.params.transparency,
        marked: sel2.value,
        complete: Object.keys(fx.params).length
          === INK_FX_EFFECTS.get('watercolor').params.length,
      });
    })()`);
    const pa = JSON.parse(presetApply);
    if (pa.density === 0.95 && pa.transparency === 0.25 && pa.marked === 'b:Heavy Pigment' && pa.complete) {
      ok('preset apply: Heavy Pigment → parametreler tam konfigürasyon + select işaretli', JSON.stringify(pa));
    } else {
      fail('preset apply: Heavy Pigment → parametreler tam konfigürasyon + select işaretli', JSON.stringify(pa));
    }

    /* --- 24. kullanıcı preseti: Save → Load → Delete + IndexedDB kalıcılık --- */
    const custom = await evaluate(ws, `(async () => {
      const it = getItem(${JSON.stringify(seed.it)});
      const fx = it.fx.stack[0];
      fx.params.pigmentDensity = 0.7;
      let nameInput = document.querySelector('#inkFxInspector [data-role="fx-preset-name"]');
      nameInput.value = 'Test Preseti';
      document.querySelector('#inkFxInspector [data-act="preset-save"]').click();
      await new Promise(r => setTimeout(r, 80));
      const names = (inkFxUi.custom.get('watercolor') || []).map(p => p.name);
      const stored1 = await idbGet('meta', 'ink:fx-presets');
      fx.params.pigmentDensity = 0.2;
      let sel = document.querySelector('#inkFxInspector [data-role="fx-preset"]');
      const hasOption = [...sel.options].some(o => o.value === 'c:Test Preseti');
      sel.value = 'c:Test Preseti';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const restored = it.fx.stack[0].params.pigmentDensity === 0.7;
      document.querySelector('#inkFxInspector [data-act="preset-delete"]').click();
      await new Promise(r => setTimeout(r, 80));
      const afterDel = (inkFxUi.custom.get('watercolor') || []).length;
      const stored2 = await idbGet('meta', 'ink:fx-presets');
      return JSON.stringify({
        names, hasOption, restored, afterDel,
        storedSaved: !!stored1 && (stored1.watercolor || []).some(p => p.name === 'Test Preseti'),
        storedAfterDel: !!stored2 ? (stored2.watercolor || []).length : -1,
      });
    })()`);
    const cu = JSON.parse(custom);
    if (cu.names.includes('Test Preseti') && cu.hasOption && cu.restored
      && cu.afterDel === 0 && cu.storedSaved && cu.storedAfterDel === 0) {
      ok('kullanıcı preseti: Save→Load→Delete + IndexedDB kalıcılık', JSON.stringify(cu));
    } else {
      fail('kullanıcı preseti: Save→Load→Delete + IndexedDB kalıcılık', JSON.stringify(cu));
    }

    /* --- 25. paylaşılan kontroller + stack işlemleri + undo --- */
    const stackOps = await evaluate(ws, `(async () => {
      const it = getItem(${JSON.stringify(seed.it)});
      document.querySelector('#inkFxGrid .inkFxCell[data-type="halftone"]').click();
      await new Promise(r => setTimeout(r, 60));
      const order1 = it.fx.stack.map(f => f.type).join(',');
      let rows = document.querySelectorAll('#inkFxStack .inkFxRow');
      /* satır tıklaması aç/kapa: yeni eklenen efekt zaten seçili */
      if (!rows[1].classList.contains('active')) rows[1].click();
      const title = document.querySelector('#inkFxInspector .inkFxTitle').textContent;
      const op = document.getElementById('inkFxOpacity');
      op.value = '40';
      op.dispatchEvent(new Event('input', { bubbles: true }));
      const opSet = it.fx.stack[1].opacity === 0.4;
      const blend = document.getElementById('inkFxBlend');
      blend.value = 'multiply';
      blend.dispatchEvent(new Event('change', { bubbles: true }));
      const blendSet = it.fx.stack[1].blend === 'multiply';
      rows = document.querySelectorAll('#inkFxStack .inkFxRow');
      rows[1].querySelector('[data-act="eye"]').click();
      const hidden = it.fx.stack[1].visible === false;
      rows = document.querySelectorAll('#inkFxStack .inkFxRow');
      rows[1].querySelector('[data-act="eye"]').click();
      rows = document.querySelectorAll('#inkFxStack .inkFxRow');
      rows[1].querySelector('[data-act="up"]').click();
      const order2 = it.fx.stack.map(f => f.type).join(',');
      undo();
      await new Promise(r => setTimeout(r, 200));
      const it2 = getItem(${JSON.stringify(seed.it)});
      const order3 = it2.fx.stack.map(f => f.type).join(',');
      rows = document.querySelectorAll('#inkFxStack .inkFxRow');
      rows[0].querySelector('[data-act="del"]').click();
      await new Promise(r => setTimeout(r, 60));
      const it3 = getItem(${JSON.stringify(seed.it)});
      return JSON.stringify({
        order1, title, opSet, blendSet, hidden, order2, order3,
        afterDelLen: it3.fx.stack.length,
      });
    })()`);
    const so = JSON.parse(stackOps);
    if (so.order1 === 'watercolor,halftone' && so.title === 'Halftone' && so.opSet
      && so.blendSet && so.hidden && so.order2 === 'halftone,watercolor'
      && so.order3 === 'watercolor,halftone' && so.afterDelLen === 1) {
      ok('paylaşılan kontroller + sıralama + undo + silme', JSON.stringify(so));
    } else {
      fail('paylaşılan kontroller + sıralama + undo + silme', JSON.stringify(so));
    }

    /* --- 26. Reset Parameters: şema varsayılanlarına döner --- */
    const resetP = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const rp0 = document.querySelectorAll('#inkFxStack .inkFxRow')[0];
      if (!rp0.classList.contains('active')) rp0.click();
      document.querySelector('#inkFxInspector [data-act="reset"]').click();
      const fx = it.fx.stack[0];
      const defaults = inkFxUiDefaults(fx.type);
      const same = Object.keys(defaults).every(k => fx.params[k] === defaults[k]);
      return JSON.stringify({ same, n: Object.keys(defaults).length });
    })()`);
    const rp = JSON.parse(resetP);
    if (rp.same && rp.n > 0) {
      ok('Reset Parameters: tam şema varsayılanına döner', JSON.stringify(rp));
    } else {
      fail('Reset Parameters: tam şema varsayılanına döner', JSON.stringify(rp));
    }

    /* --- 27. kayıt → yükleme: state snapshot fx'i birebir taşır --- */
    const reload = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      const fx = it.fx.stack[0];
      fx.opacity = 0.8;
      fx.seed = 4242;
      fx.params.dotSpacing = 30;
      const beforeSig = JSON.stringify(it.fx.stack);
      /* kayıt: snapshot referans döndürür → hemen serileştir (disk hattı) */
      const json = JSON.stringify(createStateSnapshot());
      const disk = JSON.parse(json);
      const diskItem = disk.items.find(i => i.id === ${JSON.stringify(seed.it)});
      /* canlı durumu boz (kayıt sonrası değişiklikler) */
      fx.opacity = 0.1;
      fx.params.dotSpacing = 99;
      it.fx.stack.push({ id: 'fx_extra', type: 'watercolor', params: {},
        opacity: 1, visible: true, blend: 'normal', seed: 7 });
      inkFxEnsure(it);
      /* yükleme */
      restoreSnapshot(JSON.parse(json));
      const it2 = getItem(${JSON.stringify(seed.it)});
      return JSON.stringify({
        same: beforeSig === JSON.stringify(it2.fx.stack),
        diskHasFx: !!(diskItem && diskItem.fx && Array.isArray(diskItem.fx.stack)
          && diskItem.fx.stack.length === 1),
        diskType: diskItem && diskItem.fx && diskItem.fx.stack[0]
          ? diskItem.fx.stack[0].type : '',
        len: it2.fx.stack.length,
        spacing: it2.fx.stack[0] && it2.fx.stack[0].params.dotSpacing,
        opacity: it2.fx.stack[0] && it2.fx.stack[0].opacity,
        seed: it2.fx.stack[0] && it2.fx.stack[0].seed,
      });
    })()`);
    const rl = JSON.parse(reload);
    if (rl.same && rl.diskHasFx && rl.diskType === 'halftone' && rl.len === 1
      && rl.spacing === 30 && rl.opacity === 0.8 && rl.seed === 4242) {
      ok('kayıt → yükleme: item.fx (tür/params/opaklık/seed) birebir geri gelir', JSON.stringify(rl));
    } else {
      fail('kayıt → yükleme: item.fx birebir geri gelir', JSON.stringify(rl));
    }

    /* --- 29. tüm parametreler çıktıyı gerçekten değiştirir (dekoratif kontrol yok) --- */
    const sweep = await evaluate(ws, `(() => {
      const w = 96, h = 72;
      const sample = document.createElement('canvas');
      sample.width = w; sample.height = h;
      const sg = sample.getContext('2d');
      const grd = sg.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, '#c0392b'); grd.addColorStop(0.33, '#f1c40f');
      grd.addColorStop(0.66, '#27ae60'); grd.addColorStop(1, '#2c3e50');
      sg.fillStyle = grd; sg.fillRect(0, 0, w, h);
      const rg = sg.createRadialGradient(w * 0.66, h * 0.34, 2, w * 0.66, h * 0.34, 26);
      rg.addColorStop(0, 'rgba(255,255,255,0.95)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      sg.fillStyle = rg; sg.fillRect(0, 0, w, h);
      sg.fillStyle = 'rgba(0,0,0,0.55)';
      sg.beginPath(); sg.ellipse(w * 0.24, h * 0.7, 18, 12, 0.4, 0, Math.PI * 2); sg.fill();
      for (let x = 0; x < w; x += 4) {
        sg.fillStyle = x % 8 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)';
        sg.fillRect(x, 0, 2, h);
      }
      sg.globalCompositeOperation = 'destination-out';
      const hole = sg.createRadialGradient(w * 0.5, h * 0.8, 2, w * 0.5, h * 0.8, 24);
      hole.addColorStop(0, 'rgba(0,0,0,1)'); hole.addColorStop(1, 'rgba(0,0,0,0)');
      sg.fillStyle = hole; sg.fillRect(0, 0, w, h);
      sg.globalCompositeOperation = 'source-over';
      const render = (id, params) => {
        const o = document.createElement('canvas'); o.width = w; o.height = h;
        const ctx = o.getContext('2d', { colorSpace: 'srgb' });
        try { INK_FX_EFFECTS.get(id).apply(ctx, sample, params, { w, h }, inkFxRng(0x5eed)); }
        catch (e) { return 'ERR:' + (e && e.message); }
        const d = ctx.getImageData(0, 0, w, h).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          sum = (sum * 31 + d[i] * 7 + d[i + 1] * 11 + d[i + 2] * 13 + d[i + 3] * 17) >>> 0;
        }
        return sum;
      };
      const candsOf = (p, cur) => {
        if (p.type === 'slider' || p.type === 'angle') {
          const out = [Number(p.min), Number(p.max)].filter(v => Math.abs(v - cur) > 1e-9);
          if (p.type === 'angle') {
            for (const d of [90, 180]) {
              const v = Math.min(Number(p.max), Math.max(Number(p.min), ((cur + d + 180) % 360) - 180));
              if (Math.abs(v - cur) > 1e-9) out.push(v);
            }
          }
          return out;
        }
        if (p.type === 'dropdown') return (p.options || []).filter(o => o !== cur);
        if (p.type === 'toggle') return [!cur];
        if (p.type === 'color') return ['#ff00ff', '#00ffff'].filter(v => v !== cur);
        return [];
      };
      const satisfy = (params, when, def) => {
        const out = Object.assign({}, params);
        const walk = c => {
          if (!c) return;
          if (Array.isArray(c.all)) { c.all.forEach(walk); return; }
          if (Array.isArray(c.any)) { walk(c.any[0]); return; }
          const d = def.params.find(x => x.key === c.key);
          if (!d) return;
          if (Array.isArray(c.in) && !c.in.includes(out[c.key])) out[c.key] = c.in[0];
          if (c.is !== undefined) out[c.key] = c.is;
          if (c.neq !== undefined && out[c.key] === c.neq) {
            if (Array.isArray(d.options)) out[c.key] = d.options.find(o => o !== c.neq) ?? out[c.key];
            else if (d.type === 'toggle') out[c.key] = !c.neq;
            else out[c.key] = Number(out[c.key]) === Number(d.min) ? d.max : d.min;
          }
          if (c.gte !== undefined && !(Number(out[c.key]) >= c.gte)) out[c.key] = Math.min(Number(d.max), c.gte);
          if (c.lte !== undefined && !(Number(out[c.key]) <= c.lte)) out[c.key] = Math.max(Number(d.min), c.lte);
        };
        walk(when);
        return out;
      };
      const dead = [];
      for (const [id, def] of INK_FX_EFFECTS) {
        const base = inkFxUiResolvePreset(id, null);
        for (const p of def.params) {
          const ctx = satisfy(base, p.when, def);
          const out0 = render(id, ctx);
          const cs = candsOf(p, ctx[p.key]);
          if (!cs.length) continue;
          let differs = false;
          for (const c of cs) {
            if (render(id, Object.assign({}, ctx, { [p.key]: c })) !== out0) { differs = true; break; }
          }
          if (!differs) dead.push(id + '.' + p.key);
        }
      }
      return JSON.stringify({ dead, effects: INK_FX_EFFECTS.size });
    })()`);
    const sw = JSON.parse(sweep);
    if (sw.effects === 20 && sw.dead.length === 0) {
      ok('20 efektin TÜM parametreleri çıktıyı değiştirir (dekoratif kontrol yok)', JSON.stringify(sw));
    } else {
      fail('tüm parametreler işlevsel', JSON.stringify(sw));
    }

    /* --- 30. bağımlı kontroller: when koşulu inspector'da gizler/gösterir --- */
    const whenVis = await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      it.fx.stack = [];
      const fx = { id: 'fx_when', type: 'halftone', params: inkFxUiDefaults('halftone'),
        opacity: 1, visible: true, blend: 'normal', seed: 1 };
      it.fx.stack.push(fx);
      inkFxUi.selFxId = fx.id;
      inkFxChanged(it);
      inkSyncFxPanel();
      const rowOf = key => document.querySelector('#inkFxInspector [data-param-row="' + key + '"]');
      const hidden = () => { const r = rowOf('dotRotation'); return r ? !!r.hidden : null; };
      const before = hidden();
      const sel = document.querySelector('#inkFxInspector [data-param="dotShape"]');
      sel.value = 'square'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const after = hidden();
      sel.value = 'circle'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const back = hidden();
      return JSON.stringify({ before, after, back, exists: !!rowOf('dotRotation'),
        scoped: !!inkFxUiScopedItem(), stackLen: it.fx.stack.length,
        sel: inkFxUi.selFxId,
        rows: document.querySelectorAll('#inkFxInspector [data-param-row]').length,
        inspLen: document.getElementById('inkFxInspector').innerHTML.length });
    })()`);
    const wv = JSON.parse(whenVis);
    if (wv.exists && wv.before === true && wv.after === false && wv.back === true) {
      ok('bağımlı parametre: when koşulu sağlanınca görünür, bozulunca gizlenir', JSON.stringify(wv));
    } else {
      fail('when bağımlı kontrol görünürlüğü', JSON.stringify(wv));
    }

    /* --- 31. sürükleme önizlemesi: TAM çözünürlük + piksel paritesi ---
       Eski davranış 0.35 ölçekli raster kullanıyordu; piksel tabanlı
       parametreler ve deterministik gürültü ölçekle değiştiği için
       bırakınca sonuç bambaşka görünüyordu. Yeni sözleşme: önizleme de
       tam çözünürlükte hesaplanır, yalnız kare sıklığı sınırlanır. */
    const previewTest = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const it = getItem(${JSON.stringify(seed.it)});
      it.fx.stack = [{ id: 'fx_prev', type: 'watercolor', params: inkFxUiDefaults('watercolor'),
        opacity: 1, visible: true, blend: 'normal', seed: 3 }];
      inkFxUi.selFxId = 'fx_prev';
      inkFxChanged(it);
      inkSyncFxPanel();
      const el = document.createElement('div');
      const pixels = cv => Array.from(cv.getContext('2d')
        .getImageData(0, 0, cv.width, cv.height).data);
      const readCanvas = () => el.querySelector(':scope > .inkFxCanvas');

      inkFxPreviewBegin(it.id);
      inkFxSyncItem(it, el);
      const keys1 = [...(inkFxRuntime.stages.get(it.id) || new Map()).keys()];
      const cv1 = readCanvas();
      const size1 = cv1 ? [cv1.width, cv1.height] : null;
      const px1 = cv1 ? pixels(cv1) : null;

      /* Aynı karede ikinci istek sıklık sınırına takılmalı (ara değer
         hesaplanmaz) — ama görüntü bozulmaz, aynı kalır. */
      const fx = it.fx.stack[0];
      fx.params.pigmentDensity = 1.35;
      inkFxSyncItem(it, el);
      const cvThrottled = readCanvas();
      const sameBytes = (a, b) => {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      };
      const throttledSame = !!(px1 && cvThrottled)
        && sameBytes(px1, pixels(cvThrottled));
      await sleep(200);
      inkFxSyncItem(it, el);
      /* Gecikmeli kare yeni parametreyi boyamış olmalı. */
      const cvPreview = readCanvas();
      const pxPreview = cvPreview ? pixels(cvPreview) : null;
      const updatedAfterThrottle = sameBytes(px1, pxPreview) === false;

      /* Bırakış: önizleme kapanır; kare önbelleği temizlenip sıfırdan
         tam çözünürlüklü hesaplanır (deterministik → piksel birebir). */
      inkFxPreviewEnd(it.id);
      inkFxRuntime.stages.delete(it.id);
      inkFxSyncItem(it, el);
      const keys2 = [...(inkFxRuntime.stages.get(it.id) || new Map()).keys()];
      const cv2 = readCanvas();
      const size2 = cv2 ? [cv2.width, cv2.height] : null;
      let diff = -1;
      if (pxPreview && cv2) {
        const b = pixels(cv2);
        if (pxPreview.length !== b.length) diff = Math.abs(pxPreview.length - b.length);
        else {
          diff = 0;
          for (let i = 0; i < pxPreview.length; i++) if (pxPreview[i] !== b[i]) diff++;
        }
      }
      return JSON.stringify({
        hasFullPreview: keys1.includes('fx_prev@320x240'),
        hasLowPreview: keys1.some(k => k !== 'fx_prev@320x240'),
        hasFullAfter: keys2.includes('fx_prev@320x240'),
        size1, size2, throttledSame, updatedAfterThrottle, diff,
      });
    })()`);
    const pt = JSON.parse(previewTest);
    if (pt.hasFullPreview && !pt.hasLowPreview && pt.hasFullAfter
      && pt.size1 && pt.size1[0] === 320 && pt.size1[1] === 240
      && pt.size2 && pt.size2[0] === 320 && pt.size2[1] === 240
      && pt.throttledSame && pt.updatedAfterThrottle && pt.diff === 0) {
      ok('sürükleme önizlemesi: tam çözünürlük, bırakınca piksel birebir aynı', JSON.stringify(pt));
    } else {
      fail('sürükleme önizleme paritesi', JSON.stringify(pt));
    }

    /* --- 32. efekt sırası sürükle-bırak (gerçek DragEvent + undo) --- */
    const dragTest = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const it = getItem(${JSON.stringify(seed.it)});
      /* Çizim modunda Katmanlar paneli gövdesine v5 katman-sürükleme
         dinleyicisi bağlanır; FX satırlarının olayının oraya takılmadan
         bölüme ulaştığını da bu test dolaylı olarak doğrular. */
      if (typeof modeEnterDraw === 'function'
        && !document.body.classList.contains('mode-draw')) {
        modeEnterDraw(it.id);
        await sleep(700);
      }
      const panel = document.getElementById('inkLayersPanel');
      const sec = document.getElementById('inkFxSection');
      const list = document.getElementById('inkFxStack');
      panel.hidden = false;
      sec.hidden = false;
      sec.open = true;
      const mk = (id, type, seedN) => ({ id, type, params: inkFxUiDefaults(type),
        opacity: 1, visible: true, blend: 'normal', seed: seedN });
      it.fx = { stack: [mk('fx_d1', 'halftone', 1), mk('fx_d2', 'watercolor', 2),
        mk('fx_d3', 'paper-grain', 3)] };
      inkFxUi.selFxId = null;
      inkFxChanged(it);
      inkSyncFxPanel();

      const rowOf = id => document.querySelector('#inkFxStack .inkFxRow[data-fx="' + id + '"]');
      /* Panel yerleşimi (draw dock) gizli olabilir; bırakma yarısı yalnızca
         dikey konuma bakar. Satırlara ölçülebilir dikdörtgen veriyoruz:
         1. satır 100-140, 2. satır 140-180, 3. satır 180-220. */
      const stubRects = () => {
        [...document.querySelectorAll('#inkFxStack .inkFxRow')].forEach((row, i) => {
          const top = 100 + i * 40;
          row.getBoundingClientRect = () => ({ top, bottom: top + 40, height: 40,
            left: 0, right: 0, width: 0, x: 0, y: top });
        });
      };
      const fireOn = (dt, el, type, extra) => el.dispatchEvent(new DragEvent(type,
        Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, extra || {})));
      const orderNow = () => getItem(${JSON.stringify(seed.it)}).fx.stack.map(f => f.id).join(',');
      const domOrder = () => [...document.querySelectorAll('#inkFxStack .inkFxRow')]
        .map(r => r.dataset.fx).join(',');
      const undoLen = () => (typeof undoStack !== 'undefined' && Array.isArray(undoStack))
        ? undoStack.length : -1;
      const marks = () => document.querySelectorAll(
        '#inkFxStack .is-drop-above, #inkFxStack .is-drop-below, #inkFxStack .is-dragging').length;

      stubRects();
      if (!rowOf('fx_d1') || !rowOf('fx_d3')) {
        return JSON.stringify({ stage: 'setup',
          rows: document.querySelectorAll('#inkFxStack .inkFxRow').length });
      }

      /* A) ilk satırı son satırın ALTINA bırak: d1 → d3 altı */
      let dt = new DataTransfer();
      const undoA0 = undoLen();
      fireOn(dt, rowOf('fx_d1'), 'dragstart');
      const draggingMark = rowOf('fx_d1').classList.contains('is-dragging');
      fireOn(dt, rowOf('fx_d3'), 'dragover', { clientY: 235 });
      const belowMark = rowOf('fx_d3').classList.contains('is-drop-below');
      fireOn(dt, rowOf('fx_d3'), 'drop', { clientY: 235 });
      const orderA = orderNow();
      const domA = domOrder();
      const leftoversA = marks();
      const selected = inkFxUi.selFxId;
      const undoA1 = undoLen();
      let topOrder = '';
      try {
        const snap = JSON.parse(undoStack[undoA1 - 1]);
        const si = (snap.items || []).find(x => x.id === ${JSON.stringify(seed.it)});
        topOrder = si && si.fx ? si.fx.stack.map(f => f.id).join(',') : '';
      } catch { topOrder = 'parse-error'; }

      /* B) son satırı ikinci satırın ÜSTÜNE bırak: d3 → d2 önü */
      stubRects();
      dt = new DataTransfer();
      fireOn(dt, rowOf('fx_d3'), 'dragstart');
      fireOn(dt, rowOf('fx_d2'), 'dragover', { clientY: 105 });
      const aboveMark = rowOf('fx_d2').classList.contains('is-drop-above');
      fireOn(dt, rowOf('fx_d2'), 'drop', { clientY: 105 });
      const orderB = orderNow();
      const domB = domOrder();

      /* C) efekti kendi üstüne bırakmak sırayı bozmaz, undo üretmez */
      stubRects();
      const undoB = undoLen();
      dt = new DataTransfer();
      fireOn(dt, rowOf('fx_d2'), 'dragstart');
      fireOn(dt, rowOf('fx_d2'), 'drop', { clientY: 145 });
      const orderC = orderNow();
      const undoC = undoLen();
      const leftoversC = marks();

      /* D) listenin boş alanına bırak: en sona taşınır */
      stubRects();
      dt = new DataTransfer();
      fireOn(dt, rowOf('fx_d3'), 'dragstart');
      fireOn(dt, list, 'dragover', { clientY: 0 });
      fireOn(dt, list, 'drop', {});
      const orderD = orderNow();
      const domD = domOrder();
      const undoD = undoLen();

      /* E) tek undo son işlemi geri alır */
      undo();
      await sleep(320);
      const orderE = orderNow();
      return JSON.stringify({ draggingMark, belowMark, aboveMark,
        orderA, domA, leftoversA, selected, undoA0, undoA1, topOrder,
        orderB, domB, orderC, undoC, undoB, leftoversC, orderD, domD, undoD, orderE });
    })()`);
    const dt1 = JSON.parse(dragTest);
    if (dt1.draggingMark && dt1.belowMark && dt1.aboveMark
      && dt1.orderA === 'fx_d2,fx_d3,fx_d1' && dt1.domA === 'fx_d2,fx_d3,fx_d1'
      && dt1.leftoversA === 0 && dt1.selected === 'fx_d1'
      && dt1.undoA1 === dt1.undoA0 + 1 && dt1.topOrder === 'fx_d1,fx_d2,fx_d3'
      && dt1.orderB === 'fx_d3,fx_d2,fx_d1' && dt1.domB === 'fx_d3,fx_d2,fx_d1'
      && dt1.orderC === 'fx_d3,fx_d2,fx_d1' && dt1.undoC === dt1.undoB
      && dt1.leftoversC === 0
      && dt1.orderD === 'fx_d2,fx_d1,fx_d3' && dt1.domD === 'fx_d2,fx_d1,fx_d3'
      && dt1.undoD === dt1.undoB + 1 && dt1.orderE === 'fx_d3,fx_d2,fx_d1') {
      ok('efekt sırası sürükle-bırak: alt/üst/boşluk bırakma, DOM eşleşmesi, tek undo, kendi üstüne no-op', JSON.stringify(dt1));
    } else {
      fail('efekt sırası sürükle-bırak', JSON.stringify(dt1));
    }
    /* --- 33. Layers / FX sekmeleri (çizim modundaki gerçek panel) ---
       Kullanıcı akışı: aynı panelde "Layers" ve "FX" sekmesi. FX sekmesi
       katman listesinin yerine efekt yığınını gösterir; eski ayrı
       EFFECTS bölümü/başlık düğmesi yoktur. */
    const v5Test = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const it = getItem(${JSON.stringify(seed.it)});
      if (typeof modeEnterDraw === 'function'
        && !document.body.classList.contains('mode-draw')) {
        modeEnterDraw(it.id);
        await sleep(900);
      }
      selection.clear();
      selection.add(it.id);
      it.fx = { stack: [] };
      inkFxChanged(it);
      if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
      inkSyncFxPanel();
      await sleep(250);

      const sec = document.getElementById('inkFxSection');
      const tabs = [...document.querySelectorAll('.v5-layer-tab')];
      const tabLabels = tabs.map(t => t.textContent.trim());
      const layersView = document.getElementById('v5LayersView');
      const fxView = document.getElementById('v5FxView');
      const fxHost = document.getElementById('v5FxHost');
      const legacyBtn = document.getElementById('btnInkAddFx');
      const summary = sec ? sec.querySelector('summary') : null;

      const ini = {
        draw: document.body.classList.contains('mode-draw'),
        tabLabels,
        inFxHost: !!(fxHost && sec && sec.parentElement === fxHost),
        layersVisible: !!layersView && !layersView.hidden,
        fxHidden: !!fxView && fxView.hidden,
        legacyH: legacyBtn ? Math.round(legacyBtn.getBoundingClientRect().height) : -1,
        layerRows: document.querySelectorAll('#inkLayerList .inkLayerRow').length
      };

      /* FX sekmesine geç: efekt yığını + tarayıcı görünmeli. */
      const tabFx = document.querySelector('.v5-layer-tab[data-tab="fx"]');
      if (tabFx) tabFx.click();
      await sleep(450);
      const browser = document.getElementById('inkFxBrowser');
      const fxOn = {
        layersHidden: !!layersView && layersView.hidden,
        fxVisible: !!fxView && !fxView.hidden,
        active: (() => { const b = document.querySelector('.v5-layer-tab[data-tab="fx"]'); return !!b && b.classList.contains('is-active'); })(),
        secHidden: sec ? sec.hidden : null,
        summaryShown: summary ? getComputedStyle(summary).display !== 'none' : null,
        browserVisible: !!browser && !browser.hidden,
        cells: document.querySelectorAll('#inkFxGrid .inkFxCell').length,
        tabH: Math.round((tabFx ? tabFx.getBoundingClientRect() : { height: 0 }).height)
      };

      /* Tarayıcıdan efekt ekle → yığın + sayaç + inspector. */
      const cell = document.querySelector('#inkFxGrid .inkFxCell');
      if (cell) cell.click();
      await sleep(500);
      const added = {
        rows: document.querySelectorAll('#inkFxStack .inkFxRow').length,
        count: (() => { const n = document.getElementById('inkFxCount'); return n ? n.textContent : '?'; })(),
        stackLen: it.fx ? it.fx.stack.length : -1,
        inspectorH: (() => { const i = document.getElementById('inkFxInspector'); return i ? Math.round(i.getBoundingClientRect().height) : -1; })(),
        stackH: (() => { const s = document.getElementById('inkFxStack'); return s ? Math.round(s.getBoundingClientRect().height) : -1; })()
      };

      /* Layers sekmesine dön: liste geri gelir. */
      const tabLayers = document.querySelector('.v5-layer-tab[data-tab="layers"]');
      if (tabLayers) tabLayers.click();
      await sleep(200);
      const back = {
        layersVisible: !!layersView && !layersView.hidden,
        fxHidden: !!fxView && fxView.hidden,
        layerRows: document.querySelectorAll('#inkLayerList .inkLayerRow').length
      };

      return JSON.stringify({ ini, fxOn, added, back });
    })()`);
    const v5r = JSON.parse(v5Test);
    const tabOK = v5r.ini.tabLabels.length === 2
      && v5r.ini.tabLabels[0] === 'Layers' && v5r.ini.tabLabels[1] === 'FX';
    if (v5r.ini.draw && tabOK && v5r.ini.inFxHost
      && v5r.ini.layersVisible && v5r.ini.fxHidden
      && v5r.ini.legacyH === 0 && v5r.ini.layerRows >= 1
      && v5r.fxOn.layersHidden && v5r.fxOn.fxVisible && v5r.fxOn.active
      && v5r.fxOn.secHidden === false && v5r.fxOn.summaryShown === false
      && v5r.fxOn.browserVisible && v5r.fxOn.cells === 20 && v5r.fxOn.tabH > 0
      && v5r.added.rows === 1 && v5r.added.stackLen === 1
      && v5r.added.count === '1' && v5r.added.inspectorH > 0
      && v5r.added.stackH > 0
      && v5r.back.layersVisible && v5r.back.fxHidden && v5r.back.layerRows >= 1) {
      ok('Layers / FX sekmeleri: FX sekmesi efekt yığını + 20 kart + inspector, Layers geri dönüşü liste', v5Test);
    } else {
      fail('Layers / FX sekmeleri', v5Test);
    }

    /* --- 34. çizim tuvali efekti GERÇEKTEN gösteriyor ---
       GERÇEK HATA: efekt eklendiğinde tahta (referans) katmanı değişiyordu
       ama çizim editörü taban + katmanları çiziyordu; FX zinciri hiç
       uygulanmıyordu. Artık editör de inkFxInputRaster + inkFxApplyChain
       sonucunu basar. Ölçüm: editör kanvasının gri ortalaması ve imzası
       efekt öncesi/sonrası farklı olmalı. */
    const drawFx = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const it = getItem(${JSON.stringify(seed.it)});
      selection.clear();
      selection.add(it.id);
      it.fx = { stack: [] };
      inkFxChanged(it);
      await sleep(650);

      const sample = () => {
        const ui = inkEditorUi;
        const c = ui.canvas;
        const t = document.createElement('canvas');
        t.width = 24; t.height = 18;
        const g = t.getContext('2d');
        g.drawImage(c, 0, 0, 24, 18);
        const d = g.getImageData(0, 0, 24, 18).data;
        let sum = 0;
        const px = [];
        for (let i = 0; i < d.length; i += 4) {
          const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
          sum += v; px.push(Math.round(v));
        }
        return { mean: sum / px.length, sig: px.join(',') };
      };
      const before = sample();

      inkFxUiAdd('posterization');
      await sleep(900);
      const after = sample();

      /* Ekran yolunun kullandığı aynı zincir: doğrudan da doğrula. */
      const raster = inkFxEditorRaster(it);
      const direct = raster ? { w: raster.width, h: raster.height } : null;

      const diff = Math.abs(after.mean - before.mean);
      const bSig = before.sig.split(','), aSig = after.sig.split(',');
      let maxDelta = 0;
      const changedPixels = bSig.reduce((n, v, i) => {
        const d = Math.abs(Number(v) - Number(aSig[i]));
        if (d > maxDelta) maxDelta = d;
        return n + (d > 6 ? 1 : 0);
      }, 0);
      return JSON.stringify({
        editorOpen: !!inkEditorUi.open,
        editorItem: inkEditorUi.itemId === it.id,
        canvas: [inkEditorUi.canvas.width, inkEditorUi.canvas.height],
        beforeMean: Math.round(before.mean * 10) / 10,
        afterMean: Math.round(after.mean * 10) / 10,
        diff: Math.round(diff * 10) / 10,
        maxDelta,
        changedPixels,
        totalSamples: bSig.length,
        direct,
        stackLen: it.fx.stack.length,
        tileSuspended: !!inkEditorUi.tileFxSuspended
      });
    })()`);
    const fxr = JSON.parse(drawFx);
    /* FX girdisi artık fotoğrafı da taşıdığı için ortalama pek kaymaz;
       ölçüt piksel-bazlı değişim (maxDelta + değişen örnek sayısı). */
    if (fxr.editorOpen && fxr.editorItem && fxr.stackLen === 1
      && fxr.direct && fxr.direct.w > 0 && fxr.changedPixels >= 60
      && fxr.maxDelta >= 12) {
      ok('çizim tuvali efektli nihai rasterı gösteriyor (FX öncesi/sonrası piksel farkı)', drawFx);
    } else {
      fail('çizim tuvali efekti gösteriyor', drawFx);
    }
    /* --- 35. referans fotoğraf FX girdisinin parçası ---
       Kullanıcı isteği: "sadece çizime değil, referans fotoğrafa da efekt".
       Katmanı olmayan yeni bir görselde girdi rasterı fotoğrafın kendisi
       olmalı (opak, baskın renk korunur). */
    const photoFx = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const pc = document.createElement('canvas');
      pc.width = 200; pc.height = 150;
      const pg = pc.getContext('2d');
      pg.fillStyle = '#1f8f6a'; pg.fillRect(0, 0, 200, 150);
      const pblob = await new Promise(r => pc.toBlob(r, 'image/png'));
      await addFiles([new File([pblob], 'fx-photo.png', { type: 'image/png' })], null);
      await sleep(900);
      const pit = state.items[state.items.length - 1];
      selection.clear(); selection.add(pit.id);
      const inp = inkFxInputRaster(pit);
      if (!inp) return JSON.stringify({ error: 'girdi yok' });
      const t = document.createElement('canvas');
      t.width = 40; t.height = 30;
      const tg = t.getContext('2d');
      tg.drawImage(inp.canvas, 0, 0, 40, 30);
      const d = tg.getImageData(0, 0, 40, 30).data;
      let cover = 0, green = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 250) cover++;
        if (d[i + 3] > 250 && d[i] < 80 && d[i + 1] > 110 && d[i + 1] < 180
          && d[i + 2] > 70 && d[i + 2] < 160) green++;
      }
      const n = d.length / 4;
      return JSON.stringify({
        photoSig: inkFxPhotoSig(pit),
        layers: inkLayersForOwner(pit.id).length,
        size: [inp.w, inp.h],
        coverPct: Math.round(cover / n * 100),
        greenPct: Math.round(green / n * 100),
        sigHasPhoto: inkFxInputSig(pit, inkAttachedDisplayPlan(pit.id)).indexOf('foto|') >= 0
      });
    })()`);
    const pr = JSON.parse(photoFx);
    if (!pr.error && pr.photoSig !== 'foto|yok' && pr.sigHasPhoto
      && pr.size[0] === 200 && pr.size[1] === 150
      && pr.coverPct >= 95 && pr.greenPct >= 85) {
      ok('FX girdisi referans fotoğrafı içeriyor (fotoğraf opak, baskın renk korunur)', photoFx);
    } else {
      fail('FX girdisi referans fotoğrafı içeriyor', photoFx);
    }

    /* --- 36. posterization koyu mürekkebi silmiyor ---
       GERÇEK HATA: eşik formülündeki kelepçe 0.5 altındaki her değeri tam
       0.5'e (orta gri) yükseltiyordu → siyah çizgiler açık griye dönüp
       "kayboluyordu". Siyah giriş siyah kalmalı, beyaz beyaz. */
    const postTest = await evaluate(ws, `(() => {
      const def = INK_FX_EFFECTS.get('posterization');
      const params = { tonalLevels: 5, colorReduction: 0.5, contrast: 1.05, brightness: 0,
        saturation: 1, threshold: 0.5, colorPalette: 'original', edgePreservation: 0.3,
        ditherIntegration: 0, colorMode: 'color', highlightControl: 0.05, shadowControl: 0.05 };
      const src = document.createElement('canvas'); src.width = 3; src.height = 1;
      const sg = src.getContext('2d');
      sg.fillStyle = '#111111'; sg.fillRect(0, 0, 1, 1);
      sg.fillStyle = '#808080'; sg.fillRect(1, 0, 1, 1);
      sg.fillStyle = '#eeeeee'; sg.fillRect(2, 0, 1, 1);
      const out = document.createElement('canvas'); out.width = 3; out.height = 1;
      def.apply(out.getContext('2d'), src, params, { w: 3, h: 1 }, inkFxRng(7));
      const d = out.getContext('2d').getImageData(0, 0, 3, 1).data;
      return JSON.stringify({
        dark: [d[0], d[1], d[2]], mid: [d[4], d[5], d[6]], light: [d[8], d[9], d[10]]
      });
    })()`);
    const postParsed = JSON.parse(postTest);
    const lum = p => Math.round((p[0] + p[1] + p[2]) / 3);
    if (lum(postParsed.dark) <= 60 && lum(postParsed.mid) > lum(postParsed.dark)
      && lum(postParsed.mid) < lum(postParsed.light)
      && lum(postParsed.light) >= 200) {
      ok('posterization koyu mürekkebi korur (siyah siyah, beyaz beyaz kalır)', postTest);
    } else {
      fail('posterization koyu mürekkebi korur', postTest);
    }

    /* --- 37. FX AÇIKKEN ÇİZİM (en kritik etkileşim) ---
       Kullanıcı: "çizince geri geliyor, bırakınca kayboluyor". Efektli
       tuvalde kalem kalkınca vuruş FX girdisine girmeli, girdi/FX/editör
       birlikte güncellenmeli ve undo hepsini geri almalı. */
    const strokeFx = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const it = getItem(${JSON.stringify(seed.it)});
      if (!document.body.classList.contains('mode-draw')) {
        modeEnterDraw(it.id);
        await sleep(900);
      }
      selection.clear(); selection.add(it.id);
      it.fx = { stack: [] };
      inkFxInvalidate(it.id);
      inkFxChanged(it);
      await sleep(600);

      const sig = cv => {
        if (!cv) return '';
        const t = document.createElement('canvas');
        t.width = 160; t.height = 120;
        const g = t.getContext('2d');
        g.drawImage(cv, 0, 0, 160, 120);
        const d = g.getImageData(0, 0, 160, 120).data;
        const out = new Array(d.length);
        for (let i = 0; i < d.length; i++) out[i] = d[i];
        return out.join(',');
      };
      const diff = (a, b) => {
        if (!a || !b) return -1;
        const A = a.split(','), B = b.split(',');
        let n = 0;
        for (let i = 0; i < A.length; i += 4) {
          if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1])
            + Math.abs(A[i + 2] - B[i + 2]) + Math.abs(A[i + 3] - B[i + 3]) > 12) n++;
        }
        return n;
      };

      inkFxUiAdd('halftone');
      await sleep(900);
      const layer = inkLayersForOwner(it.id).pop();
      const fx0 = sig(inkFxEditorRaster(it));
      const ed0 = sig(inkEditorUi.canvas);
      const in0 = sig((inkFxInputRaster(it) || {}).canvas);
      const strokes0 = layer.strokes.length;
      const gen0 = inkLayerGen(layer.id);

      const ui = inkEditorUi, cv = ui.canvas;
      const box = cv.getBoundingClientRect(), fit = ui.fit;
      const at = (u, v) => ({
        x: box.left + (fit.x + u * fit.w) * box.width / cv.width,
        y: box.top + (fit.y + v * fit.h) * box.height / cv.height
      });
      const pid = 9001;
      const mk = (type, u, v) => {
        const p = at(u, v);
        return new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true, pointerId: pid,
          pointerType: 'pen', isPrimary: true, pressure: 0.9,
          clientX: p.x, clientY: p.y, button: 0,
          buttons: type === 'pointerup' ? 0 : 1
        });
      };
      const surface = document.getElementById('inkEditorCanvas') || cv;
      const p0 = at(0.3, 0.45);
      (document.elementFromPoint(p0.x, p0.y) || cv).dispatchEvent(mk('pointerdown', 0.3, 0.45));
      for (let i = 1; i <= 18; i++) {
        surface.dispatchEvent(mk('pointermove', 0.3 + i * 0.02, 0.45));
      }
      await sleep(220);
      const duringSig = sig(ui.canvas);
      const strokeLive = !!ui.stroke;
      surface.dispatchEvent(mk('pointerup', 0.66, 0.45));
      await sleep(1400);

      const fx1 = sig(inkFxEditorRaster(it));
      const ed1 = sig(ui.canvas);
      const in1 = sig((inkFxInputRaster(it) || {}).canvas);
      const strokes1 = layer.strokes.length;
      const diag = {
        lens: [in0.length, in1.length, fx0.length, fx1.length, ed0.length, ed1.length],
        rasterNull: !inkFxEditorRaster(it),
        inputNull: !inkFxInputRaster(it),
        editorOpen: !!ui.open,
        editorItem: ui.itemId,
        canvasSize: [ui.canvas.width, ui.canvas.height],
        layerId: layer.id,
        uiLayerId: ui.layerId,
        activeLayerId: inkState().activeLayerId,
        gens: [gen0, inkLayerGen(layer.id), inkLayerGen(ui.layerId)],
        bumpFn: typeof inkAfterCommitRaster,
        ownerLayers: inkLayersForOwner(it.id).map(l => l.id)
      };

      undo();
      await sleep(1000);
      const it2 = getItem(${JSON.stringify(seed.it)});
      const layer2 = inkLayersForOwner(it2.id).pop();
      const fx2 = sig(inkFxEditorRaster(it2));
      const strokes2 = layer2 ? layer2.strokes.length : -1;
      const fxKept = it2.fx && it2.fx.stack.length;

      return JSON.stringify({
        fxStack: it.fx.stack.length,
        strokeLive,
        strokes: [strokes0, strokes1, strokes2],
        inputChanged: diff(in0, in1),
        fxChanged: diff(fx0, fx1),
        editorChanged: diff(ed0, ed1),
        duringVsBefore: diff(ed0, duringSig),
        undoRestored: diff(fx0, fx2),
        fxKept,
        diag
      });
    })()`);
    const sf = JSON.parse(strokeFx);
    if (sf.fxStack === 1 && sf.strokeLive
      && sf.strokes[1] === sf.strokes[0] + 1 && sf.strokes[2] === sf.strokes[0]
      && sf.inputChanged >= 20 && sf.fxChanged >= 10 && sf.editorChanged >= 20
      && sf.duringVsBefore >= 10 && sf.undoRestored <= 6 && sf.fxKept === 1) {
      ok('FX açıkken çizim: canlı vuruş görünür, commit FX girdisini/FX rasterını/editörü güncelller, undo geri alır', strokeFx);
    } else {
      fail('FX açıkken çizim (vuruş → commit → undo)', strokeFx);
    }

    /* --- 38. FX kapatma: overlay gider, katman tuvali geri görünür --- */
    const offFx = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const it = getItem(${JSON.stringify(seed.it)});
      selection.clear(); selection.add(it.id);
      it.fx = { stack: [] };
      inkFxInvalidate(it.id);
      inkFxChanged(it);
      if (typeof inkSyncDom === 'function') inkSyncDom(it);
      await sleep(900);
      const el = elMap.get(it.id);
      const overlay = el ? el.querySelector(':scope > .inkFxCanvas') : null;
      const layer = inkLayersForOwner(it.id).pop();
      const lc = layer ? inkRuntime.itemCanvases.get(layer.id) : null;
      return JSON.stringify({
        overlay: !!overlay,
        layerVisible: !lc || lc.style.display !== 'none',
        fxActive: inkFxItemHasActiveFx(it),
        editorOpen: !!inkEditorUi.open
      });
    })()`);
    const of = JSON.parse(offFx);
    if (of.overlay === false && of.layerVisible && of.fxActive === false && of.editorOpen) {
      ok('FX kapatma: FX kanvası kaldırılır, katman tuvali yeniden görünür', offFx);
    } else {
      fail('FX kapatma (overlay + katman görünürlüğü)', offFx);
    }

    /* --- 39. FX açıkken ART ARDA iki vuruş + tahta katmanı ---
       Kullanıcı: "efekt sonrası çizimler kayboluyor". Her yeni vuruş FX
       girdisine girmeli, tahtadaki FX kanvası tazelenmeli. */
    const twoStrokes = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const it = getItem(${JSON.stringify(seed.it)});
      selection.clear(); selection.add(it.id);
      it.fx = { stack: [] };
      inkFxInvalidate(it.id);
      inkFxChanged(it);
      await sleep(600);
      inkFxUiAdd('halftone');
      await sleep(900);

      const sig = cv => {
        if (!cv) return '';
        const t = document.createElement('canvas');
        t.width = 160; t.height = 120;
        const g = t.getContext('2d');
        g.drawImage(cv, 0, 0, 160, 120);
        const d = g.getImageData(0, 0, 160, 120).data;
        const out = new Array(d.length);
        for (let i = 0; i < d.length; i++) out[i] = d[i];
        return out.join(',');
      };
      const diff = (a, b) => {
        if (!a || !b) return -1;
        const A = a.split(','), B = b.split(',');
        let n = 0;
        for (let i = 0; i < A.length; i += 4) {
          if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1])
            + Math.abs(A[i + 2] - B[i + 2]) + Math.abs(A[i + 3] - B[i + 3]) > 12) n++;
        }
        return n;
      };
      const ui = inkEditorUi, cv = ui.canvas;
      const box = cv.getBoundingClientRect(), fit = ui.fit;
      const surface = document.getElementById('inkEditorCanvas') || cv;
      const at = (u, v) => ({
        x: box.left + (fit.x + u * fit.w) * box.width / cv.width,
        y: box.top + (fit.y + v * fit.h) * box.height / cv.height
      });
      const stroke = async (v, pid) => {
        const mk = (type, u) => {
          const p = at(u, v);
          return new PointerEvent(type, {
            bubbles: true, cancelable: true, composed: true, pointerId: pid,
            pointerType: 'pen', isPrimary: true, pressure: 0.9,
            clientX: p.x, clientY: p.y, button: 0,
            buttons: type === 'pointerup' ? 0 : 1
          });
        };
        const p0 = at(0.35, v);
        (document.elementFromPoint(p0.x, p0.y) || cv).dispatchEvent(mk('pointerdown', 0.35));
        for (let i = 1; i <= 14; i++) surface.dispatchEvent(mk('pointermove', 0.35 + i * 0.02));
        await sleep(160);
        surface.dispatchEvent(mk('pointerup', 0.63));
        await sleep(1200);
      };
      const layer = inkLayersForOwner(it.id).pop();
      const in0 = sig((inkFxInputRaster(it) || {}).canvas);
      await stroke(0.40, 8101);
      const in1 = sig((inkFxInputRaster(it) || {}).canvas);
      const s1 = layer.strokes.length;
      await stroke(0.62, 8102);
      const in2 = sig((inkFxInputRaster(it) || {}).canvas);
      const s2 = layer.strokes.length;
      /* Tahtaya dön: FX kanvası item üzerinde oluşmalı ve vuruşları taşımalı. */
      let boardOverlay = false, boardCover = 0, boardStrokes = -1;
      if (document.body.classList.contains('mode-draw')) {
        modeExitDraw();
        await sleep(1200);
      }
      if (typeof inkSyncDom === 'function') inkSyncDom(it);
      await sleep(500);
      const elB = elMap.get(it.id);
      const ovB = elB ? elB.querySelector(':scope > .inkFxCanvas') : null;
      const diagB = {
        el: !!elB, kind: it.kind, fxActive: inkFxItemHasActiveFx(it),
        planLen: inkAttachedDisplayPlan(it.id).length,
        mode: document.body.className,
        syncFn: typeof inkSyncDom
      };
      if (ovB) {
        boardOverlay = true;
        const t = document.createElement('canvas');
        t.width = 40; t.height = 30;
        const g = t.getContext('2d');
        g.drawImage(ovB, 0, 0, 40, 30);
        const d = g.getImageData(0, 0, 40, 30).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
        boardCover = Math.round(n / (d.length / 4) * 100);
      }
      boardStrokes = inkLayersForOwner(it.id).pop().strokes.length;
      if (!document.body.classList.contains('mode-draw')) {
        modeEnterDraw(it.id);
        await sleep(1000);
      }
      const fxFinal = inkFxEditorRaster(it);
      return JSON.stringify({
        strokes: [s1, s2],
        d1: diff(in0, in1),
        d2: diff(in1, in2),
        boardOverlay,
        boardCover,
        boardStrokes,
        diagB,
        fxSize: fxFinal ? [fxFinal.width, fxFinal.height] : null,
        inputSize: (() => { const i = inkFxInputRaster(it); return i ? [i.w, i.h] : null; })(),
        stackLen: it.fx.stack.length
      });
    })()`);
    const ts = JSON.parse(twoStrokes);
    if (ts.strokes[0] === 1 && ts.strokes[1] === 2
      && ts.d1 >= 20 && ts.d2 >= 20 && ts.boardOverlay && ts.boardCover >= 20
      && ts.boardStrokes === 2
      && ts.fxSize && ts.inputSize
      && ts.fxSize[0] === ts.inputSize[0] && ts.fxSize[1] === ts.inputSize[1]
      && ts.stackLen === 1) {
      ok('FX açıkken art arda iki vuruş: her vuruş FX girdisine girer, tahtadaki FX kanvası vuruşları taşır', twoStrokes);
    } else {
      fail('FX açıkken art arda iki vuruş + tahta FX kanvası', twoStrokes);
    }

    /* --- 40. FX açıkken undo → redo: vuruş efektten çıkar ve birebir geri döner --- */
    const undoRedoFx = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const it = getItem(${JSON.stringify(seed.it)});
      const layer = inkLayersForOwner(it.id).pop();
      const sig = cv => {
        if (!cv) return '';
        const t = document.createElement('canvas');
        t.width = 160; t.height = 120;
        const g = t.getContext('2d');
        g.drawImage(cv, 0, 0, 160, 120);
        const d = g.getImageData(0, 0, 160, 120).data;
        const out = new Array(d.length);
        for (let i = 0; i < d.length; i++) out[i] = d[i];
        return out.join(',');
      };
      const diff = (a, b) => {
        if (!a || !b) return -1;
        const A = a.split(','), B = b.split(',');
        let n = 0;
        for (let i = 0; i < A.length; i += 4) {
          if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1])
            + Math.abs(A[i + 2] - B[i + 2]) + Math.abs(A[i + 3] - B[i + 3]) > 12) n++;
        }
        return n;
      };
      const before = sig(inkFxEditorRaster(it));
      const s2 = layer.strokes.length;
      undo();
      await sleep(1200);
      const itU = getItem(${JSON.stringify(seed.it)});
      const lU = inkLayersForOwner(itU.id).pop();
      const afterUndo = sig(inkFxEditorRaster(itU));
      const sUndo = lU.strokes.length;
      redo();
      await sleep(1200);
      const itR = getItem(${JSON.stringify(seed.it)});
      const lR = inkLayersForOwner(itR.id).pop();
      const afterRedo = sig(inkFxEditorRaster(itR));
      const sRedo = lR.strokes.length;
      return JSON.stringify({
        strokes: [s2, sUndo, sRedo],
        undoDiff: diff(before, afterUndo),
        redoDiff: diff(before, afterRedo),
        fxStack: itR.fx && itR.fx.stack.length
      });
    })()`);
    const ur = JSON.parse(undoRedoFx);
    if (ur.strokes[1] === ur.strokes[0] - 1 && ur.strokes[2] === ur.strokes[0]
      && ur.undoDiff >= 20 && ur.redoDiff <= 6 && ur.fxStack === 1) {
      ok('FX açıkken undo vuruşu efektten çıkarır, redo birebir geri getirir', undoRedoFx);
    } else {
      fail('FX açıkken undo → redo (efektli raster)', undoRedoFx);
    }

    /* --- 41. \"Çizim yap\" → Layer 1 = referans fotoğraf ---
       Kullanıcı isteği: \"sağdaki Layer 1 aslında o fotoğraf olmalı\".
       Çizim moduna girince fotoğraf bağlı katmana pişirilmeli; FX girdisi
       ve efekt sonucu fotoğrafı işlemeli, katman vuruş listesi boş kalmalı. */
    const photoLayer = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const pc = document.createElement('canvas');
      pc.width = 180; pc.height = 120;
      const pg = pc.getContext('2d');
      pg.fillStyle = '#b03020'; pg.fillRect(0, 0, 180, 120);
      const pblob = await new Promise(r => pc.toBlob(r, 'image/png'));
      await addFiles([new File([pblob], 'fx-photo-layer.png', { type: 'image/png' })], null);
      await sleep(900);
      const pit = state.items[state.items.length - 1];
      selection.clear(); selection.add(pit.id);
      const before = inkLayersForOwner(pit.id).length;
      modeEnterDraw(pit.id);
      await sleep(1600);

      const layers = inkLayersForOwner(pit.id);
      const layer = layers[layers.length - 1];
      const canvas = layer ? inkRuntime.itemCanvases.get(layer.id) : null;
      const sample = cv => {
        if (!cv) return null;
        const t = document.createElement('canvas');
        t.width = 30; t.height = 20;
        const g = t.getContext('2d');
        g.drawImage(cv, 0, 0, 30, 20);
        const d = g.getImageData(0, 0, 30, 20).data;
        let r = 0, gg = 0, b = 0, n = 0, op = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 200) {
            r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
          }
          if (d[i + 3] > 20) op++;
        }
        return n ? [Math.round(r / n), Math.round(gg / n), Math.round(b / n),
          Math.round(op / (d.length / 4) * 100)] : [0, 0, 0, 0];
      };
      const input = inkFxInputRaster(pit);
      const inSig = input ? sample(input.canvas) : null;
      const layerSig = sample(canvas);
      const baked = !!(layer && layer.baked && layer.baked.src);
      const strokes = layer ? layer.strokes.length : -1;

      inkFxUiAdd('woodcut');
      await sleep(1000);
      const fx = inkFxEditorRaster(pit);
      const fxSig = sample(fx);
      /* FX kapat → ham katman fotoğrafı korunur */
      pit.fx = { stack: [] };
      inkFxChanged(pit);
      await sleep(700);
      const rawSig = sample(inkRuntime.itemCanvases.get(layer.id));

      if (document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(600);
      selection.clear();
      selection.add(getItem(${JSON.stringify(seed.it)}).id);
      modeEnterDraw(${JSON.stringify(seed.it)});
      await sleep(1000);

      return JSON.stringify({
        layersBefore: before,
        layersAfter: layers.length,
        baked,
        hasPhotoSig: !!(layer && layer.photoBakeSig),
        strokes,
        layerSig,
        inSig,
        fxSig,
        rawSig,
        pxSize: canvas ? [canvas.width, canvas.height] : null,
        editorItem: inkEditorUi.itemId
      });
    })()`);
    const pl = JSON.parse(photoLayer);
    const close = (a, b, tol) => a && b && Math.abs(a[0] - b[0]) <= tol
      && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
    if (pl.layersAfter === 1 && pl.baked && pl.hasPhotoSig && pl.strokes === 0
      && close(pl.layerSig, [176, 48, 32], 24)
      && close(pl.inSig, pl.layerSig, 6)
      && close(pl.rawSig, pl.layerSig, 6)
      && pl.fxSig && pl.layerSig && Math.abs(pl.fxSig[0] - pl.layerSig[0]) >= 6
      && pl.pxSize && pl.pxSize[0] >= 180 && pl.pxSize[1] >= 120) {
      ok('\"Çizim yap\" sonrası Layer 1 = referans fotoğraf; FX fotoğrafı işler, FX kapanınca ham fotoğraf korunur', photoLayer);
    } else {
      fail('Layer 1 = referans fotoğraf (bake + FX girdisi)', photoLayer);
    }

    /* --- 42. Yeni efekt eklemek önceki aşamaları YENİDEN HESAPLAMAZ ---
       GERÇEK DARBOĞAZ: inkFxInvalidate aşama önbelleğini tamamen siliyordu;
       5 efektli 4K görselde her "efekt ekle" tüm zinciri baştan kuruyordu.
       İmza (sig) mimarisi zaten değişen aşamayı ayırt ediyor. */
    const stageReuse = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const id = ${JSON.stringify(seed.it)};
      let it = getItem(id);
      it.fx = { stack: [] };
      inkFxChanged(it);
      if (typeof inkSyncFxPanel === 'function') inkSyncFxPanel();
      await sleep(500);

      inkFxUiAdd('stippling');
      await sleep(900);
      inkFxUiAdd('crosshatching');
      await sleep(900);
      inkFxUiAdd('posterization');
      await sleep(1200);

      const calls = {};
      const spies = [];
      for (const [type, def] of INK_FX_EFFECTS) {
        const orig = def.apply;
        def.apply = function (...a) {
          calls[type] = (calls[type] || 0) + 1;
          return orig.apply(this, a);
        };
        spies.push([def, orig]);
      }
      inkFxUiAdd('ink-bleed');
      await sleep(1300);
      const appendCalls = { ...calls };
      for (const [def, orig] of spies) def.apply = orig;

      it = getItem(id);
      const input = inkFxInputRaster(it);
      const a = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
      const sig = c => {
        const t = document.createElement('canvas');
        t.width = 90; t.height = 70;
        const g = t.getContext('2d');
        g.drawImage(c, 0, 0, 90, 70);
        return Array.from(g.getImageData(0, 0, 90, 70).data).join(',');
      };
      const before = sig(a);
      /* önbelleği zorla boşalt: aynı girdi/parametre aynı pikseli vermeli */
      inkFxRuntime.stages.delete(it.id);
      const input2 = inkFxInputRaster(it);
      const b = inkFxApplyChain(it.id, input2.canvas, input2.w, input2.h, it);
      const A = before.split(','), B = sig(b).split(',');
      let diff = 0;
      for (let i = 0; i < A.length; i += 4) {
        if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1])
          + Math.abs(A[i + 2] - B[i + 2]) + Math.abs(A[i + 3] - B[i + 3]) > 10) diff++;
      }
      return JSON.stringify({
        appendCalls,
        stack: it.fx.stack.map(f => f.type),
        cachePixelDiff: diff,
        fxSize: a ? [a.width, a.height] : null
      });
    })()`);
    const sr = JSON.parse(stageReuse);
    const others = Object.keys(sr.appendCalls).filter(t => t !== 'ink-bleed'
      && sr.appendCalls[t] > 0);
    if (sr.stack.length === 4 && sr.appendCalls['ink-bleed'] >= 1
      && others.length === 0 && sr.cachePixelDiff === 0) {
      ok('Yeni efekt eklemek önceki aşamaları yeniden hesaplamaz (aşama önbelleği) ve önbellek piksel birebir', stageReuse);
    } else {
      fail('Aşama önbelleği: append yalnız yeni efekti hesaplar', stageReuse);
    }

    /* --- 43. FX panel UX: parametreler listenin altında ve görünür,
       etiketler ayırt edilebilir, arama boş durumu bilgilendirir.
       Kullanıcı: "ilk kez fx kullanmaya çalışan bir insan gibi". */
    const panelUx = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const id = ${JSON.stringify(seed.it)};
      const it = getItem(id);
      if (!document.body.classList.contains('mode-draw')) {
        selection.clear(); selection.add(id);
        modeEnterDraw(id);
        await sleep(1600);
      }
      if (typeof window.__v5LayersSetTab === 'function') window.__v5LayersSetTab('fx');
      await sleep(500);
      it.fx = { stack: [] };
      inkFxChanged(it);
      if (typeof inkSyncFxPanel === 'function') inkSyncFxPanel();
      await sleep(400);

      const cell = [...document.querySelectorAll('#inkFxGrid .inkFxCell')]
        .find(c => /Watercolor/i.test(c.textContent));
      cell.click();
      await sleep(1300);

      const body = document.querySelector('.v5-layers-body');
      const section = document.getElementById('inkFxSection');
      const order = [...section.children].map(c => c.id || c.tagName.toLowerCase());
      const br = body.getBoundingClientRect();
      const tabs = document.querySelector('.v5-layer-tabs').getBoundingClientRect();
      const insp = document.querySelector('#inkFxInspector').getBoundingClientRect();
      const rows = document.querySelectorAll('#inkFxStack .inkFxRow').length;

      const labels = [...document.querySelectorAll('#inkFxInspector .inkSliderRow label')]
        .map(l => l.textContent.trim()).filter(Boolean);
      const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);

      const search = document.querySelector('#inkFxSearch');
      search.value = 'zzzz';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);
      const empty = document.querySelector('#inkFxGrid .inkFxGridEmpty');
      const emptyVisible = !!(empty && empty.offsetParent !== null);
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);
      const allCells = [...document.querySelectorAll('#inkFxGrid .inkFxCell')]
        .filter(c => c.offsetParent !== null).length;

      if (document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(500);
      selection.clear(); selection.add(id);
      modeEnterDraw(id);
      await sleep(1000);

      return JSON.stringify({
        order,
        scroll: body.scrollTop,
        tabsVisible: tabs.top >= br.top - 1 && tabs.bottom <= br.top + 60,
        inspectorVisible: insp.top >= br.top && insp.top < br.bottom,
        rows,
        labels: labels.length,
        dupes,
        emptyVisible,
        emptyText: empty ? empty.textContent : '',
        allCells
      });
    })()`);
    const pu = JSON.parse(panelUx);
    if (pu.order[1] === 'inkFxStack' && pu.order[2] === 'inkFxInspector'
      && pu.order[3] === 'inkFxBrowser'
      && pu.scroll === 0 && pu.tabsVisible && pu.inspectorVisible
      && pu.rows === 1 && pu.labels >= 8 && pu.dupes.length === 0
      && pu.emptyVisible && pu.allCells === 20) {
      ok('FX paneli ilk kullanım: parametreler listenin altında görünür, etiketler benzersiz, arama boş durumu görünür', panelUx);
    } else {
      fail('FX paneli ilk kullanım UX (görünürlük/etiket/arama)', panelUx);
    }

    /* --- 44. FX listesi kaydırma: 8+ efektde yeni eklenen satır görünür
       kalmalı, kullanıcı listeyi kaydırdıysa panel yenilenince konum
       korunmalı (seçili satıra geri zıplamamalı). */
    const listScroll = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const id = ${JSON.stringify(seed.it)};
      const it = getItem(id);
      if (!document.body.classList.contains('mode-draw')) {
        selection.clear(); selection.add(id);
        modeEnterDraw(id);
        await sleep(1600);
      }
      if (typeof window.__v5LayersSetTab === 'function') window.__v5LayersSetTab('fx');
      await sleep(400);
      it.fx = { stack: [] };
      inkFxChanged(it); inkSyncFxPanel(); await sleep(400);

      const types = ['posterization', 'crosshatching', 'halftone', 'stippling',
        'dithering', 'woodcut', 'linocut', 'cmyk'];
      for (const t of types) { inkFxUiAdd(t); await sleep(650); }
      await sleep(500);

      const list = document.getElementById('inkFxStack');
      const state = () => {
        const lr = list.getBoundingClientRect();
        const rows = [...list.querySelectorAll('.inkFxRow')];
        const act = list.querySelector('.inkFxRow.active');
        const ar = act.getBoundingClientRect();
        return {
          scrollTop: list.scrollTop,
          listH: Math.round(lr.height),
          scrollH: list.scrollHeight,
          activeIdx: rows.indexOf(act),
          activeVisible: ar.top >= lr.top - 1 && ar.bottom <= lr.bottom + 1,
        };
      };
      const afterAdd = state();

      /* kullanıcı yukarı kaydırıp başka bir efektin gözünü kapatır */
      list.scrollTop = 0;
      await sleep(150);
      list.querySelector('.inkFxRow [data-act="eye"]').click();
      await sleep(600);
      const afterEye = state();

      /* başka bir satıra tıklamak onu görünür alana getirir. Satır tıklaması
         aç/kapa olduğu için aktif satır (ekran dışında) iki kez tıklanır:
         ilki seçimi kaldırır, ikincisi seçip görünür alana kaydırır. */
      const rows = [...list.querySelectorAll('.inkFxRow')];
      const actIdx = rows.findIndex(r => r.classList.contains('active'));
      rows[actIdx].click();
      await sleep(250);
      [...list.querySelectorAll('.inkFxRow')][actIdx].click();
      await sleep(700);
      const afterClick = state();

      if (document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(400);
      return JSON.stringify({ afterAdd, afterEye, afterClick, stack: getItem(id).fx.stack.length });
    })()`);
    const ls = JSON.parse(listScroll);
    if (ls.stack === 8
      && ls.afterAdd.listH <= 221 && ls.afterAdd.scrollH > ls.afterAdd.listH
      && ls.afterAdd.activeIdx === 7 && ls.afterAdd.activeVisible
      && ls.afterAdd.scrollTop > 0
      && ls.afterEye.scrollTop === 0
      && ls.afterClick.activeVisible && ls.afterClick.scrollTop > 0) {
      ok('FX listesi kaydırma: yeni efekt görünür alana gelir, kullanıcı kaydırması korunur', listScroll);
    } else {
      fail('FX listesi kaydırma (yeni satır görünürlüğü / konum koruma)', listScroll);
    }

    /* --- 45. Slider sürüklemesi TEK geri-al adımı olmalı. Eski davranış
       700 ms'lik zaman penceresiydi: uzun bir sürükleme geçmişe 4-5 kayıt
       bırakıyor, tek hareketi geri almak için Ctrl+Z'ye defalarca basmak
       gerekiyordu. */
    const dragUndo = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const id = ${JSON.stringify(seed.it)};
      const it = getItem(id);
      if (!document.body.classList.contains('mode-draw')) {
        selection.clear(); selection.add(id);
        modeEnterDraw(id);
        await sleep(1600);
      }
      if (typeof window.__v5LayersSetTab === 'function') window.__v5LayersSetTab('fx');
      await sleep(400);
      it.fx = { stack: [] };
      inkFxChanged(it); inkSyncFxPanel(); await sleep(400);
      inkFxUiAdd('posterization'); await sleep(900);
      /* satır tıklaması artık aç/kapa: eklenen efekt zaten seçili geldiği
         için ikinci tıklama seçimi kaldırırdı */
      const rowP = document.querySelector('#inkFxStack .inkFxRow');
      if (rowP && !rowP.classList.contains('active')) { rowP.click(); await sleep(500); }
      await sleep(400);

      const range = document.querySelector('#inkFxInspector input[type="range"]:not(#inkFxOpacity)');
      const key = range.dataset.param;
      const val = () => getItem(id).fx.stack[0].params[key];
      const depth = () => (typeof undoStack !== 'undefined' ? undoStack.length : -1);
      const before = val();
      const d0 = depth();

      range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true }));
      let v = Number(range.value);
      for (let i = 0; i < 10; i++) {
        v += Number(range.step || 1);
        if (v > Number(range.max)) v = Number(range.min) + Number(range.step || 1);
        range.value = String(v);
        range.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(100);
      }
      range.dispatchEvent(new Event('change', { bubbles: true }));
      range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true }));
      await sleep(500);
      const afterDrag = val();
      const d1 = depth();
      undo();
      await sleep(900);
      const afterUndo = getItem(id).fx.stack[0].params[key];

      if (document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(400);
      return JSON.stringify({ before, afterDrag, afterUndo, added: d1 - d0, changed: before !== afterDrag, undoOk: afterUndo === before, stack: 1 });
    })()`);
    const du = JSON.parse(dragUndo);
    if (du.added === 1 && du.changed && du.undoOk && du.stack === 1) {
      ok('FX slider sürüklemesi tek geri-al adımı: uzun sürükleme tek Ctrl+Z ile geri döner', dragUndo);
    } else {
      fail('FX slider sürüklemesi geri-al adımı (tek adım / tam geri dönüş)', dragUndo);
    }

    /* --- 46. Hazır ayar etiketi efekt ÖRNEĞİNE bağlı olmalı: aynı türden
       iki efektten birine preset uygulanınca diğeri de o preset'i
       "uygulanmış" gibi göstermemeli. */
    const presetScope = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const id = ${JSON.stringify(seed.it)};
      const it = getItem(id);
      if (!document.body.classList.contains('mode-draw')) {
        selection.clear(); selection.add(id);
        modeEnterDraw(id);
        await sleep(1600);
      }
      if (typeof window.__v5LayersSetTab === 'function') window.__v5LayersSetTab('fx');
      await sleep(400);
      it.fx = { stack: [] };
      inkFxChanged(it); inkSyncFxPanel(); await sleep(400);
      inkFxUiAdd('halftone'); await sleep(800);
      inkFxUiAdd('halftone'); await sleep(800);
      const rows = () => [...document.querySelectorAll('#inkFxStack .inkFxRow')];
      const presetValue = () => { const s = document.querySelector('[data-role="fx-preset"]'); return s ? s.value : null; };

      rows()[0].click(); await sleep(500);
      const sel = document.querySelector('[data-role="fx-preset"]');
      const opt = [...sel.options].find(o => o.value.startsWith('b:'));
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(1000);
      const onA = presetValue();

      rows()[1].click(); await sleep(600);
      const onB = presetValue();
      const bParams = getItem(id).fx.stack[1].params;

      if (document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(400);
      return JSON.stringify({ applied: opt.value, onA, onB, bDotSize: bParams.dotSize });
    })()`);
    const ps = JSON.parse(presetScope);
    if (ps.onA === ps.applied && ps.onB !== ps.applied) {
      ok('FX preset etiketi efekt örneğine bağlı (aynı türden diğer efekt yanlış preset göstermez)', presetScope);
    } else {
      fail('FX preset etiketi efekt örneği kapsamı', presetScope);
    }

    /* --- 47. Sayı girişi kırpılınca (clamp) girdiye geri yazılmalı:
       min altına değer yazan kullanıcı ekranda yazdığı değeri değil,
       gerçekten uygulanan değeri görmeli; range partneri de eşzamanlı. */
    const numClamp = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const id = ${JSON.stringify(seed.it)};
      const it = getItem(id);
      if (!document.body.classList.contains('mode-draw')) {
        selection.clear(); selection.add(id);
        modeEnterDraw(id);
        await sleep(1600);
      }
      if (typeof window.__v5LayersSetTab === 'function') window.__v5LayersSetTab('fx');
      await sleep(400);
      it.fx = { stack: [] };
      inkFxChanged(it); inkSyncFxPanel(); await sleep(400);
      inkFxUiAdd('halftone'); await sleep(900);
      const rowN = document.querySelector('#inkFxStack .inkFxRow');
      if (rowN && !rowN.classList.contains('active')) { rowN.click(); await sleep(500); }

      const num = document.querySelector('#inkFxInspector input[type="number"]');
      const key = num.dataset.param;
      const aria = num.getAttribute('aria-label') || '';
      const min = Number(num.min);
      const bad = min - 5;
      num.value = String(bad);
      num.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500);
      const model = getItem(id).fx.stack[0].params[key];
      const shown = num.value;
      const range = document.querySelector('#inkFxInspector input[type="range"][data-param="' + key + '"]');
      const rangeShown = range ? range.value : null;

      if (document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(400);
      return JSON.stringify({ key, min, bad, model, shown, rangeShown, aria });
    })()`);
    const nc = JSON.parse(numClamp);
    if (nc.model >= nc.min && Number(nc.shown) === nc.model
      && (nc.rangeShown === null || Number(nc.rangeShown) === nc.model)
      && nc.aria.length > 0) {
      ok('FX sayı girişi: kırpılan değer modele ve girdiye birlikte yazılır (girdi modelden ayrışmaz)', numClamp);
    } else {
      fail('FX sayı girişi kırpma geri yazımı', numClamp);
    }

    /* --- 48. Geri-al (undo) adımı sayısı: opaklık sürüklemesi, sayı girişi,
       renk seçici ve onay kutusu kullanıcı başına TEK adım bırakmalı.
       Eski davranış: opaklık slider'ının kendi pointerdown'ı + ilk input
       iki kayıt; sayı/ok tuşları her basışta bir kayıt; renk seçicide
       canlı input akışı onlarca kayıt; onay kutusu input+change ile iki
       kayıt bırakıyordu (boşa giden "ölü" Ctrl+Z adımları). */
    const undoSteps = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const id = ${JSON.stringify(seed.it)};
      const it = getItem(id);
      if (!document.body.classList.contains('mode-draw')) {
        selection.clear(); selection.add(id);
        modeEnterDraw(id);
        await sleep(1600);
      }
      if (typeof window.__v5LayersSetTab === 'function') window.__v5LayersSetTab('fx');
      await sleep(400);
      it.fx = { stack: [] };
      inkFxChanged(it); inkSyncFxPanel(); await sleep(400);
      inkFxUiAdd('halftone'); await sleep(900);

      const row = () => document.querySelector('#inkFxStack .inkFxRow');
      const stackFx = () => getItem(id).fx.stack;
      const depth = () => (typeof undoStack !== 'undefined' ? undoStack.length : -1);
      const pd = el => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true }));
      const inp = el => el.dispatchEvent(new Event('input', { bubbles: true }));
      const chg = el => el.dispatchEvent(new Event('change', { bubbles: true }));
      const out = { steps: {} };

      /* satır tıklaması aç/kapa olduğu için yalnız seçili değilse tıkla */
      if (!row().classList.contains('active')) row().click();
      await sleep(400);

      /* 1) opaklık sürüklemesi */
      const op = document.getElementById('inkFxOpacity');
      const opBefore = stackFx()[0].opacity;
      let d0 = depth();
      pd(op); inp(op);
      op.value = '80'; inp(op);
      op.value = '55'; inp(op);
      chg(op);
      await sleep(300);
      out.opacity = { added: depth() - d0, before: opBefore, after: stackFx()[0].opacity };
      undo(); await sleep(800);
      out.opacity.undoValue = getItem(id).fx.stack[0].opacity;

      /* 2) sayı girişi: hızlı art arda değişiklikler (ok tuşu gibi) */
      if (!row().classList.contains('active')) row().click();
      await sleep(300);
      const num = document.querySelector('#inkFxInspector input[type="number"]');
      const nKey = num.dataset.param;
      const nBefore = getItem(id).fx.stack[0].params[nKey];
      d0 = depth();
      for (let i = 0; i < 3; i++) {
        num.value = String(Number(num.value) + 1);
        chg(num);
        await sleep(60);
      }
      await sleep(300);
      out.number = { added: depth() - d0, key: nKey, before: nBefore, after: getItem(id).fx.stack[0].params[nKey] };
      undo(); await sleep(800);
      out.number.undoValue = getItem(id).fx.stack[0].params[nKey];

      /* aynı (kırpılmış) değere dönüş boş undo adımı bırakmamalı */
      const num2 = document.querySelector('#inkFxInspector input[type="number"]');
      num2.value = '0';
      chg(num2);
      await sleep(900);
      const dNoop = depth();
      const num3 = document.querySelector('#inkFxInspector input[type="number"]');
      num3.value = '1';
      chg(num3);
      await sleep(400);
      out.clampNoop = { key: nKey, value: getItem(id).fx.stack[0].params[nKey],
        shown: num3.value, noopDelta: depth() - dNoop };
      undo(); await sleep(800);
      out.clampNoop.undoValue = getItem(id).fx.stack[0].params[nKey];

      /* 3) renk seçici: canlı input akışı tek adım */
      inkFxUiAdd('contour'); await sleep(1200);
      const col = document.querySelector('#inkFxInspector input[type="color"][data-param]');
      const cKey = col.dataset.param;
      const cBefore = getItem(id).fx.stack[1].params[cKey];
      d0 = depth();
      col.value = '#ff0000'; inp(col);
      col.value = '#00ff00'; inp(col);
      col.value = '#0000ff'; inp(col);
      chg(col);
      await sleep(300);
      out.color = { added: depth() - d0, key: cKey, before: cBefore, after: getItem(id).fx.stack[1].params[cKey] };
      undo(); await sleep(800);
      out.color.undoValue = getItem(id).fx.stack[1].params[cKey];

      /* 4) onay kutusu (toggle) tek adım */
      const tog = [...document.querySelectorAll('#inkFxInspector input[type="checkbox"][data-param]')][0];
      const tKey = tog.dataset.param;
      const tBefore = getItem(id).fx.stack[1].params[tKey];
      d0 = depth();
      tog.checked = !tog.checked;
      inp(tog); chg(tog);
      await sleep(300);
      out.toggle = { added: depth() - d0, key: tKey, before: tBefore, after: getItem(id).fx.stack[1].params[tKey] };
      undo(); await sleep(800);
      out.toggle.undoValue = getItem(id).fx.stack[1].params[tKey];

      if (document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(400);
      return JSON.stringify(out);
    })()`);
    const us = JSON.parse(undoSteps);
    const usOk = us.opacity.added === 1 && us.opacity.undoValue === us.opacity.before
      && us.number.added === 1 && us.number.undoValue === us.number.before
      && us.clampNoop.value === 2 && Number(us.clampNoop.shown) === 2
      && us.clampNoop.noopDelta === 0 && us.clampNoop.undoValue === us.number.before
      && us.color.added === 1 && us.color.undoValue === us.color.before
      && us.toggle.added === 1 && us.toggle.undoValue === us.toggle.before
      && us.opacity.after !== us.opacity.before && us.color.after !== us.color.before;
    if (usOk) {
      ok('FX geri-al adımları: opaklık/sayı/renk/onay kutusu başına tek Ctrl+Z (ölü adım yok)', undoSteps);
    } else {
      fail('FX geri-al adım sayısı (tek adım / tam geri dönüş)', undoSteps);
    }

    /* --- 49. Açılır liste (dropdown) değişikliği modele uygulanmalı ve
       koşullu parametre satırları gerçekten GİZLENMELİ. Eski davranış:
       satır `hidden` olsa da kendi display kuralı (grid) UA'nın
       [hidden]{display:none} talimatını eziyor, "Dot Shape = circle" iken
       uygulanmayan "Dot Rotation" görünür kalıyordu. */
    const dropdownCond = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const id = ${JSON.stringify(seed.it)};
      const it = getItem(id);
      if (!document.body.classList.contains('mode-draw')) {
        selection.clear(); selection.add(id);
        modeEnterDraw(id);
        await sleep(1600);
      }
      if (typeof window.__v5LayersSetTab === 'function') window.__v5LayersSetTab('fx');
      await sleep(400);
      it.fx = { stack: [] };
      inkFxChanged(it); inkSyncFxPanel(); await sleep(400);
      inkFxUiAdd('halftone'); await sleep(900);
      it.fx.stack[0].params.dotShape = 'circle';
      inkSyncFxPanel(); await sleep(400);
      const rowC = document.querySelector('#inkFxStack .inkFxRow');
      if (rowC && !rowC.classList.contains('active')) { rowC.click(); await sleep(400); }

      const rowOf = k => {
        const i = document.querySelector('#inkFxInspector [data-param="' + k + '"]');
        const r = i && i.closest('[data-param-row]');
        return r ? { hidden: r.hidden, display: getComputedStyle(r).display } : null;
      };
      const sel = () => document.querySelector('#inkFxInspector select[data-param="dotShape"]');
      const out = { circle: { rot: rowOf('dotRotation'), shape: getItem(id).fx.stack[0].params.dotShape } };

      sel().value = 'square';
      sel().dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(600);
      out.square = { rot: rowOf('dotRotation'), shape: getItem(id).fx.stack[0].params.dotShape, dom: sel().value };

      sel().value = 'circle';
      sel().dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(600);
      out.back = { rot: rowOf('dotRotation'), shape: getItem(id).fx.stack[0].params.dotShape };

      /* preset uygula → elle parametre değiştir: "uygulanmış preset" etiketi
         temizlenmeli (aksi halde select, artık geçerli olmayan adı gösterir). */
      const ps = document.querySelector('[data-role="fx-preset"]');
      const built = [...ps.options].find(o => o.value.startsWith('b:'));
      let tagged = null, afterEdit = null;
      if (built) {
        ps.value = built.value;
        ps.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(700);
        tagged = document.querySelector('[data-role="fx-preset"]').value;
        const s3 = document.querySelector('#inkFxInspector select[data-param="dotShape"]');
        s3.value = 'diamond';
        s3.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(600);
        afterEdit = document.querySelector('[data-role="fx-preset"]').value;
      }
      out.presetTag = { applied: tagged, afterEdit, built: !!built };

      /* preset uygula → Sıfırla: parametreler varsayılana döner, etiket temizlenir */
      const ps2 = document.querySelector('[data-role="fx-preset"]');
      const built2 = [...ps2.options].find(o => o.value.startsWith('b:'));
      ps2.value = built2.value;
      ps2.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(800);
      const resetBtn = document.querySelector('#inkFxInspector [data-act="reset"]');
      if (resetBtn) resetBtn.click();
      await sleep(800);
      let resetTag = null, resetDefault = null;
      try {
        resetTag = document.querySelector('[data-role="fx-preset"]').value;
        resetDefault = JSON.stringify(getItem(id).fx.stack[0].params)
          === JSON.stringify(inkFxUiDefaults('halftone'));
      } catch { /* sessiz */ }
      out.resetTag = { tag: resetTag, defaults: resetDefault, hasBtn: !!resetBtn };

      /* preset uygula → Ctrl+Z: parametreler eski değere döner, select etiketi
         "uygulanmış preset" göstermeye devam etmemeli */
      const ps3 = document.querySelector('[data-role="fx-preset"]');
      const built3 = [...ps3.options].find(o => o.value.startsWith('b:'));
      ps3.value = built3.value;
      ps3.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(800);
      const tagBeforeUndo = document.querySelector('[data-role="fx-preset"]').value;
      undo();
      await sleep(900);
      out.undoTag = { before: tagBeforeUndo,
        after: document.querySelector('[data-role="fx-preset"]').value };

      /* klavye: satırlar odaklanabilir, Enter seçer (fare olmadan düzenleme) */
      inkFxUiAdd('posterization'); await sleep(900);
      const rowsAt = () => [...document.querySelectorAll('#inkFxStack .inkFxRow')];
      const r1 = rowsAt()[1];
      if (!r1.classList.contains('active')) { r1.click(); await sleep(400); }
      const kbBefore = inkFxUi.selFxId;
      const r0 = rowsAt()[0];
      r0.focus();
      r0.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(500);
      out.keyboard = {
        before: kbBefore,
        after: inkFxUi.selFxId,
        row0: rowsAt()[0].dataset.fx,
        focusedRow: !!(document.activeElement && document.activeElement.classList.contains('inkFxRow')),
      };

      /* aynı satıra ikinci tıklama seçimi kaldırır: satır vurgusu gider,
         parametre paneli kapanır, ipucu metni gelir; üçüncü tıklama
         yeniden seçer (aç/kapa). */
      rowsAt()[0].click();
      await sleep(500);
      out.toggleSel = {
        activeAfterClick: document.querySelectorAll('#inkFxStack .inkFxRow.active').length,
        selFx: inkFxUi.selFxId,
        hasControls: !!document.querySelector('#inkFxInspector input[data-role="fx-opacity"]'),
        hint: (document.querySelector('#inkFxInspector .inkHint') || {}).textContent || '',
      };
      rowsAt()[0].click();
      await sleep(500);
      out.toggleSel.activeAfterSecondClick = document.querySelectorAll('#inkFxStack .inkFxRow.active').length;
      out.toggleSel.controlsBack = !!document.querySelector('#inkFxInspector input[data-role="fx-opacity"]');
      out.toggleSel.selFxBack = inkFxUi.selFxId;

      /* silme sonrası odak: panel yeniden kurulur, odak gövdeye düşmemeli */
      const lenBeforeDel = getItem(id).fx.stack.length;
      const delBtn = rowsAt()[0].querySelector('[data-act="del"]');
      delBtn.focus();
      delBtn.click();
      await sleep(600);
      out.deleteFocus = {
        lenBefore: lenBeforeDel,
        lenAfter: getItem(id).fx.stack.length,
        focusAct: document.activeElement && document.activeElement.dataset
          ? document.activeElement.dataset.act || '' : '',
        focusInStack: !!(document.activeElement && document.activeElement.closest
          && document.activeElement.closest('#inkFxStack')),
      };

      /* çift tıklama iki efekti silmemeli: ikinci tık (detail=2) yok sayılır */
      inkFxUiAdd('halftone'); await sleep(1200);
      inkFxUiAdd('contour'); await sleep(1400);
      const delA = rowsAt()[0].querySelector('[data-act="del"]');
      const delRect = delA.getBoundingClientRect();
      const lenDbl = getItem(id).fx.stack.length;
      delA.click();
      await sleep(500);
      const cx = delRect.left + delRect.width / 2, cy = delRect.top + delRect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      out.dblDel = { before: lenDbl, hitAct: hit && hit.dataset ? hit.dataset.act || '' : '',
        hitExists: !!hit };
      if (hit) hit.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2, clientX: cx, clientY: cy }));
      await sleep(500);
      out.dblDel.afterDouble = getItem(id).fx.stack.length;
      if (hit) hit.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: cx, clientY: cy }));
      await sleep(500);
      out.dblDel.afterSingle = getItem(id).fx.stack.length;

      /* parametre grubu kapalıysa panel yeniden kurulunca açılmamalı */
      if (!rowsAt()[0].classList.contains('active')) { rowsAt()[0].click(); await sleep(500); }
      const grp = document.querySelector('#inkFxInspector details.inkFxGroup');
      const grpKey = grp ? grp.dataset.group : null;
      if (grp) { grp.open = false; grp.dispatchEvent(new Event('toggle')); }
      const eye2 = rowsAt()[0].querySelector('[data-act="eye"]');
      eye2.click();
      await sleep(700);
      const grp2 = [...document.querySelectorAll('#inkFxInspector details.inkFxGroup')]
        .find(d => d.dataset.group === grpKey);
      out.groupState = { key: grpKey, closed: grp2 ? grp2.open === false : null };
      const eye3 = rowsAt()[0].querySelector('[data-act="eye"]');
      if (eye3) { eye3.click(); await sleep(600); }

      if (document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(400);
      return JSON.stringify(out);
    })()`, 45000);
    const dc = JSON.parse(dropdownCond);
    if (dc.circle.shape === 'circle' && dc.circle.rot && dc.circle.rot.hidden === true
      && dc.circle.rot.display === 'none'
      && dc.square.shape === 'square' && dc.square.dom === 'square'
      && dc.square.rot && dc.square.rot.hidden === false
      && dc.back.shape === 'circle' && dc.back.rot && dc.back.rot.hidden === true
      && dc.presetTag && dc.presetTag.built === true
      && dc.presetTag.applied && dc.presetTag.applied.indexOf('b:') === 0
      && dc.presetTag.afterEdit === ''
      && dc.resetTag && dc.resetTag.hasBtn === true && dc.resetTag.tag === ''
      && dc.resetTag.defaults === true
      && dc.undoTag && dc.undoTag.before.indexOf('b:') === 0 && dc.undoTag.after === ''
      && dc.keyboard && dc.keyboard.after === dc.keyboard.row0
      && dc.keyboard.after !== dc.keyboard.before && dc.keyboard.focusedRow === true
      && dc.deleteFocus && dc.deleteFocus.lenAfter === dc.deleteFocus.lenBefore - 1
      && dc.deleteFocus.focusAct === 'del' && dc.deleteFocus.focusInStack === true
      && dc.dblDel && dc.dblDel.before === 3 && dc.dblDel.hitAct === 'del'
      && dc.dblDel.afterDouble === 2 && dc.dblDel.afterSingle === 1
      && dc.toggleSel && dc.toggleSel.activeAfterClick === 0 && dc.toggleSel.selFx === null
      && dc.toggleSel.hasControls === false
      && dc.toggleSel.hint.indexOf('Select an effect row') === 0
      && dc.toggleSel.activeAfterSecondClick === 1 && dc.toggleSel.controlsBack === true
      && !!dc.toggleSel.selFxBack
      && dc.groupState && dc.groupState.key && dc.groupState.closed === true) {
      ok('FX açılır liste modele uygulanır; koşullu satır gizlenir; preset etiketi temizlenir; satır Enter ile seçilir; aynı satıra ikinci tıklama seçimi kaldırır; silme sonrası odak korunur; çift tık tek efekt siler', dropdownCond);
    } else {
      fail('FX dropdown uygulama / koşullu parametre görünürlüğü / klavye odağı', dropdownCond);
    }

    /* --- 50. Öğe silinince FX önbellekleri bırakılır (bellek sızıntısı).
       Girdi/aşama tuvalleri öğe kimliğiyle Map'te tutuluyordu ve silmede
       hiç temizlenmiyordu: 4K bir FX öğesi ~100 MB'ı oturum boyunca
       bellekte bırakıyordu. --- */
    const fxDispose = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const c = document.createElement('canvas');
      c.width = 96; c.height = 72;
      const g = c.getContext('2d');
      g.fillStyle = '#c04020'; g.fillRect(0, 0, 96, 72);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await addFiles([new File([blob], 'fx-dispose.png', { type: 'image/png' })], null);
      await sleep(700);
      const it = state.items[state.items.length - 1];
      it.fx = { stack: [] };
      inkFxEnsure(it);
      it.fx.stack.push({ id: 'fx_dispose_test', type: 'posterization',
        params: inkFxUiDefaults('posterization'), opacity: 1, visible: true,
        blend: 'normal', seed: 7 });
      inkFxChanged(it);
      inkSyncDom(it);
      const inp = inkFxInputRaster(it);
      if (inp) inkFxApplyChain(it.id, inp.canvas, inp.w, inp.h, it);
      await sleep(300);
      const stages = inkFxRuntime.stages.get(it.id);
      const populated = inkFxRuntime.inputs.has(it.id) && !!stages && stages.size > 0;
      const ids = { id: it.id, input: inkFxRuntime.inputs.size, stages: inkFxRuntime.stages.size };
      removeItems([it.id], false, { toTrash: false });
      await sleep(300);
      return JSON.stringify({
        populated,
        inputBefore: ids.input,
        stagesBefore: ids.stages,
        gone: !getItem(it.id),
        inputAfter: inkFxRuntime.inputs.has(it.id),
        stagesAfter: inkFxRuntime.stages.has(it.id),
        previewAfter: inkFxRuntime.preview.itId === it.id,
      });
    })()`);
    const fd = JSON.parse(fxDispose);
    if (fd.populated === true && fd.gone === true
      && fd.inputAfter === false && fd.stagesAfter === false && fd.previewAfter === false) {
      ok('Öğe silinince FX girdi/aşama önbellekleri bırakılır (bellek sızıntısı yok)', fxDispose);
    } else {
      fail('FX önbelleği silmede temizlenmiyor (bellek sızıntısı)', fxDispose);
    }

    /* --- 51. Görsel kapsamı değişince FX paneli tazelenir: B görselinde
       A'nın efekt listesi görünmüyordu (panel yeniden kurulmuyordu). --- */
    const scopeFx = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const A = getItem(${JSON.stringify(seed.it)});
      selection.clear(); selection.add(A.id);
      if (typeof syncSelection === 'function') syncSelection();
      if (document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(400);
      modeEnterDraw(A.id); await sleep(2400);
      __v5LayersSetTab('fx'); await sleep(400);
      A.fx = { stack: [] }; inkFxChanged(A); inkSyncFxPanel(); await sleep(250);
      inkFxUiAdd('halftone'); await sleep(1400);
      const rowsA = document.querySelectorAll('#inkFxStack .inkFxRow').length;
      const idA = A.fx.stack[0] && A.fx.stack[0].id;
      modeExitDraw(); await sleep(700);

      selection.clear(); selection.add(A.id);
      if (typeof syncSelection === 'function') syncSelection();
      duplicateSelection(); await sleep(900);
      const B = state.items[state.items.length - 1];
      B.fx = { stack: [] };
      selection.clear(); selection.add(B.id);
      if (typeof syncSelection === 'function') syncSelection();
      await sleep(300);
      modeEnterDraw(B.id); await sleep(2400);
      const rows = [...document.querySelectorAll('#inkFxStack .inkFxRow')];
      const out = { rowsA, idA, same: B.id === A.id,
        rowsB: rows.length,
        staleRow: rows.some(r => r.dataset.fx === idA),
        ownerOk: rows.every(r => B.fx.stack.some(f => f.id === r.dataset.fx)),
        inspB: document.querySelectorAll('#inkFxInspector [data-param-row]').length,
        scoped: inkFxUiScopedItem() && inkFxUiScopedItem().id,
        count: (document.getElementById('inkFxCount') || {}).textContent,
        emptyText: (document.querySelector('#inkFxStack .inkLayersEmpty') || {}).textContent || '' };
      modeExitDraw(); await sleep(500);
      removeItems([B.id], false, { toTrash: false });
      A.fx = { stack: [] };
      inkFxInvalidate(A.id);
      await sleep(300);
      return JSON.stringify(out);
    })()`, 40000);
    const scopeRes = JSON.parse(scopeFx);
    if (scopeRes.same === false && scopeRes.rowsA === 1 && scopeRes.rowsB === 0 && scopeRes.staleRow === false
      && scopeRes.ownerOk === true && scopeRes.inspB === 0 && scopeRes.scoped && scopeRes.count === '0'
      && scopeRes.emptyText.indexOf('No effects yet') === 0) {
      ok('Görsel değişince FX paneli o görselin yığınını gösterir (önceki görselin efektleri kalmaz)', scopeFx);
    } else {
      fail('FX paneli görsel kapsamı değişince tazelenmiyor', scopeFx);
    }

    /* --- 52. FX paneli ince ayrıntılar: çift tıklamayla iki efekt ekleme,
       sıra uçlarındaki ↑/↓ düğmeleri, Enter ile seçimi kaldırma, panel
       metinlerinin dili ve preset adı alanının erişilebilir adı. --- */
    const fxPolish = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const it = getItem(${JSON.stringify(seed.it)});
      selection.clear(); selection.add(it.id);
      if (typeof syncSelection === 'function') syncSelection();
      if (!document.body.classList.contains('mode-draw')) { modeEnterDraw(it.id); await sleep(2200); }
      __v5LayersSetTab('fx'); await sleep(400);
      it.fx = { stack: [] }; inkFxChanged(it); inkSyncFxPanel(); await sleep(250);
      inkFxUiAdd('halftone'); await sleep(1100);

      const out = {};
      /* çift tıklama: ikinci tık (detail=2) yok sayılmalı */
      const cell = document.querySelector('#inkFxGrid .inkFxCell[data-type="stippling"]');
      const n0 = it.fx.stack.length;
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      await sleep(1400);
      out.dblCell = { before: n0, after: it.fx.stack.length };

      const rowsAt = () => [...document.querySelectorAll('#inkFxStack .inkFxRow')];
      out.edges = {
        n: rowsAt().length,
        firstUp: rowsAt()[0].querySelector('[data-act="up"]').disabled,
        firstUpAria: rowsAt()[0].querySelector('[data-act="up"]').getAttribute('aria-disabled'),
        lastDown: rowsAt()[rowsAt().length - 1].querySelector('[data-act="down"]').disabled,
        lastDownAria: rowsAt()[rowsAt().length - 1].querySelector('[data-act="down"]').getAttribute('aria-disabled'),
      };

      /* satır çift tıklaması: ikinci tık seçimi hemen kaldırmamalı.
         (Satır önce seçiliyse ilk tık zaten kaldırır → önce seçimi bırak.) */
      const lastR = rowsAt()[rowsAt().length - 1];
      if (lastR.classList.contains('active')) { lastR.click(); await sleep(350); }
      const targetRow = rowsAt()[rowsAt().length - 1];
      targetRow.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      targetRow.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      await sleep(500);
      out.dblRow = { active: document.querySelectorAll('#inkFxStack .inkFxRow.active').length,
        sel: !!inkFxUi.selFxId };

      /* Enter: seçili satırda seçimi kaldırır */
      if (!rowsAt()[rowsAt().length - 1].classList.contains('active')) {
        rowsAt()[rowsAt().length - 1].click(); await sleep(400);
      }
      const selBefore = inkFxUi.selFxId;
      const rowActive = rowsAt().find(r => r.classList.contains('active'));
      rowActive.focus();
      rowActive.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(500);
      out.enterToggle = { selBefore: !!selBefore, selAfter: inkFxUi.selFxId,
        active: document.querySelectorAll('#inkFxStack .inkFxRow.active').length,
        hint: (document.querySelector('#inkFxInspector .inkHint') || {}).textContent || '' };

      /* dil tutarlılığı + erişilebilir adlar */
      inkFxUiAdd('contour'); await sleep(1500);
      const bgRow = [...document.querySelectorAll('#inkFxInspector [data-param-row]')]
        .find(r => r.querySelector('input[data-param-none]'));
      const noneLabel = bgRow ? bgRow.querySelector('.inkFxNone span') : null;
      const nameInput = document.querySelector('[data-role="fx-preset-name"]');
      out.text = {
        noneLabel: noneLabel ? noneLabel.textContent : null,
        turkishLeft: !!document.querySelector('#inkFxInspector .inkFxNone')
          && noneLabel !== null && /Şeffaf/.test(document.querySelector('#inkFxInspector').textContent),
        presetAria: nameInput ? nameInput.getAttribute('aria-label') : null,
        searchAria: (document.getElementById('inkFxSearch') || {}).getAttribute
          ? document.getElementById('inkFxSearch').getAttribute('aria-label') : null,
        rowRole: rowsAt()[0] ? rowsAt()[0].getAttribute('role') : null,
        delDisabled: (() => {
          const d = document.querySelector('[data-act="preset-delete"]');
          return d ? d.disabled : null;
        })(),
      };
      if (document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(400);
      it.fx = { stack: [] };
      inkFxInvalidate(it.id);
      await sleep(200);
      return JSON.stringify(out);
    })()`, 40000);
    const fp = JSON.parse(fxPolish);
    if (fp.dblCell && fp.dblCell.before === 1 && fp.dblCell.after === 2
      && fp.edges && fp.edges.n === 2 && fp.edges.firstUp === true
      && fp.edges.firstUpAria === 'true' && fp.edges.lastDown === true
      && fp.edges.lastDownAria === 'true'
      && fp.dblRow && fp.dblRow.active === 1 && fp.dblRow.sel === true
      && fp.enterToggle && fp.enterToggle.selBefore === true && fp.enterToggle.selAfter === null
      && fp.enterToggle.active === 0 && fp.enterToggle.hint.indexOf('Select an effect row') === 0
      && fp.text && fp.text.noneLabel === 'Transparent' && fp.text.turkishLeft === false
      && fp.text.presetAria === 'Preset name' && fp.text.delDisabled === true
      && fp.text.searchAria === 'Search effects' && fp.text.rowRole === 'listitem') {
      ok('FX paneli: çift tık tek efekt ekler; sıra uçlarında ↑/↓ devre dışı; Enter seçimi kaldırır; panel metinleri İngilizce ve erişilebilir', fxPolish);
    } else {
      fail('FX paneli ince ayrıntıları (çift tıklama / uç düğmeleri / Enter / dil / aria)', fxPolish);
    }

    /* --- 53. Bir efekt silinince aşama tuvali bırakılır: son efekt de
       silindiğinde zincir hesabı hiç koşmadığı için temizlik yapılmıyor,
       silinen 4K efektin aşama tuvali (~17 MB) bellekte kalıyordu. --- */
    const fxStagePrune = await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const c = document.createElement('canvas');
      c.width = 96; c.height = 72;
      const g = c.getContext('2d');
      g.fillStyle = '#3a6ea5'; g.fillRect(0, 0, 96, 72);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await addFiles([new File([blob], 'fx-prune.png', { type: 'image/png' })], null);
      await sleep(700);
      const it = state.items[state.items.length - 1];
      const mk = id => ({ id, type: 'posterization', params: inkFxUiDefaults('posterization'),
        opacity: 1, visible: true, blend: 'normal', seed: 3 });
      it.fx = { stack: [mk('fx_prune_a'), mk('fx_prune_b')] };
      inkFxChanged(it); inkSyncDom(it);
      const inp = inkFxInputRaster(it);
      if (inp) inkFxApplyChain(it.id, inp.canvas, inp.w, inp.h, it);
      await sleep(250);
      const st = () => inkFxRuntime.stages.get(it.id);
      const populated = !!st() && st().size === 2;
      it.fx.stack = it.fx.stack.filter(f => f.id !== 'fx_prune_a');
      inkFxChanged(it);
      await sleep(200);
      const afterOne = st() ? [...st().keys()] : [];
      it.fx.stack = [];
      inkFxChanged(it);
      await sleep(200);
      const afterAll = st() ? st().size : 0;
      /* undo yolu: geri alma yığını boşaltıp tahtayı yeniden çizer
         (06-render → inkSyncItem); aşama tuvali orada da bırakılmalı.
         Gerçek uygulamada syncAll → 06-render → inkSyncItem koşar; burada
         katman gerektiği için önce çizim katmanı oluşturulur. */
      selection.clear(); selection.add(it.id);
      if (typeof syncSelection === 'function') syncSelection();
      modeEnterDraw(it.id);
      await sleep(2400);
      const layerCount = inkLayersForOwner(it.id).length;
      it.fx.stack = [mk('fx_prune_c')];
      inkFxChanged(it);
      await sleep(600);
      const beforeUndo = st() ? st().size : 0;
      it.fx.stack = [];
      if (typeof syncAll === 'function') syncAll(); else inkSyncDom(it);
      await sleep(500);
      if (typeof modeExitDraw === 'function' && document.body.classList.contains('mode-draw')) modeExitDraw();
      await sleep(500);
      const afterUndo = st() ? st().size : 0;
      removeItems([it.id], false, { toTrash: false });
      await sleep(200);
      return JSON.stringify({ populated, afterOne, afterAll, layerCount,
        keptRemaining: afterOne.length === 1 && afterOne[0].indexOf('fx_prune_b@') === 0,
        beforeUndo, afterUndo });
    })()`);
    const sp = JSON.parse(fxStagePrune);
    if (sp.populated === true && sp.keptRemaining === true && sp.afterAll === 0
      && sp.beforeUndo === 1 && sp.afterUndo === 0) {
      ok('Efekt silinince aşama tuvali bırakılır (kalan efektin önbelleği korunur)', fxStagePrune);
    } else {
      fail('Silinen efektin aşama tuvali bellekte kalıyor', fxStagePrune);
    }

    /* --- temizlik: fx'i kapat (kalan testler için) --- */
    await evaluate(ws, `(() => {
      const it = getItem(${JSON.stringify(seed.it)});
      it.fx = { stack: [] };
      inkFxInvalidate(it.id);
    })()`);
  } finally {
    try { app.kill(); } catch { }
  }

  const allOk = results.every(Boolean);
  console.log(allOk ? 'TÜM TESTLER GEÇTİ (' + results.length + '/' + results.length + ')' : 'BAŞARISIZ (' + results.filter(r => !r).length + ' hata)');
  process.exit(allOk ? 0 : 1);
})().catch(e => {
  console.error('HATA:', e.message);
  process.exit(1);
});
