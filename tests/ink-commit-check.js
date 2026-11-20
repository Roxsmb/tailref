'use strict';

/* Vuruş commit görünürlüğü testi (zoom-out regresyonu).

   Büyük tuval küçültülerek gösterildiğinde katman rasterı önbelleğe
   alınır. Vuruş pointerup'ta katman tuvaline pişirildiğinde boya dönemi
   artırılmazsa eski (vuruşsuz) önbellek yeniden kullanılıyor ve çizgi
   ekrandan kayboluyordu; referans minyatürü ise doğru kalıyordu.

   Bu test büyük bir tuvalde vuruş çizer, pointerup sonrası yeniden
   çizimi bekler ve ekran tuvalinde vuruş piksellerinin durduğunu
   doğrular.

   Kullanım: node scripts/ink-commit-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9341;
const APP_PORT = 5204;
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
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
});

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

async function waitForTarget(deadlineMs = 30000) {
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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-commit-check-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3' };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  const errors = [];
  let ws = null;
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(d.exception?.description || d.text || 'bilinmeyen hata');
      }
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await send(ws, 'Page.enable');

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    const result = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      // Büyük tuval: görünüm alanına sığdırılınca katman küçültme
      // önbelleği devreye girer.
      document.getElementById('newCanvasW').value = '1600';
      document.getElementById('newCanvasH').value = '1200';
      document.getElementById('newCanvasName').value = 'Commit Testi';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 120 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      out.editorOpen = inkEditorIsOpen();
      if (!out.editorOpen) return JSON.stringify(out);

      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      out.fit = { w: Math.round(fit.w), h: Math.round(fit.h) };
      const layerCanvas = inkRuntime.itemCanvases.get(inkEditorUi.layerId) ||
        (typeof inkEnsureItemCanvas === 'function' ? inkEnsureItemCanvas(inkLayerById(inkEditorUi.layerId)) : null);
      out.layer = layerCanvas ? { w: layerCanvas.width, h: layerCanvas.height } : null;
      // Küçültme önbelleği gerçekten devrede mi? (tw < src*0.8)
      const dpr = inkEditorUi.dpr || 1;
      out.downscaled = !!layerCanvas &&
        Math.round(fit.w * dpr) < layerCanvas.width * 0.8;

      const rect = canvas.getBoundingClientRect();
      const toClient = (nx, ny) => ({
        clientX: rect.left + fit.x + nx * fit.w,
        clientY: rect.top + fit.y + ny * fit.h,
      });

      // Fırça: parlak, kalın, hızlı kurumayan.
      inkSetTool('brush', { brushId: 'ink-hard' });
      const ink = inkState();
      ink.size = 48;
      ink.opacity = 1;
      ink.smoothing = 0.2;
      ink.color = '#ffffff';
      /* Tur 4h: bu test commit hattını (bake/epoch/undo) doğrular, şekil
         oturtmayı değil. Kalkış oturtması düz izi line'a çevirip canlı
         önizleme rasterını değiştireceğinden parite kanıtı deterministik
         kalmalı — oturtma bu testte kapalı. */
      ink.shapeSnap = false;
      await wait(120);

      const ctx = canvas.getContext('2d');
      const dprC = canvas.width / Math.max(1, rect.width);
      // Vuruş bandı: fit içinde ortada yatay şerit (CSS koordinatı).
      const band = {
        x: Math.round((fit.x + fit.w * 0.1) * dprC),
        y: Math.round((fit.y + fit.h * 0.42) * dprC),
        w: Math.round(fit.w * 0.8 * dprC),
        h: Math.round(fit.h * 0.16 * dprC),
      };
      /* Görünür kompozit: ana tuval + karo örtüsü (kiremit aşaması).
         Vuruş çip/karo yoluna düşünce önizleme KARO tuvallerine basılır;
         ana tuval bölge bayat kalır — oysa kullanıcı örtüyü GÖRÜR.
         Prob görünen gerçeği örnekler: kopya tuval + örtü karoları. */
      const komposit = () => {
        try {
          const cp = document.createElement('canvas');
          cp.width = canvas.width;
          cp.height = canvas.height;
          const c2 = cp.getContext('2d');
          c2.setTransform(1, 0, 0, 1, 0, 0);
          c2.drawImage(canvas, 0, 0);
          const host = document.querySelector('[data-ink-tile-view]');
          if (host) {
            for (const t of host.querySelectorAll('canvas')) {
              const left = parseFloat(t.style.left) || 0;
              const top = parseFloat(t.style.top) || 0;
              const w = parseFloat(t.style.width) || t.width;
              const h = parseFloat(t.style.height) || t.height;
              c2.drawImage(t, left * dprC, top * dprC, w * dprC, h * dprC);
            }
          }
          return c2.getImageData(band.x, band.y, Math.max(1, band.w), Math.max(1, band.h)).data;
        } catch { return null; }
      };
      const baseline = komposit();
      // Vuruş farkı: taban (damalı zemin) ile karşılaştır. Renk ne olursa
      // olsun yalnızca yeni boyanmış pikseller sayılır.
      const diffCount = () => {
        const d = komposit();
        if (!d || !baseline || d.length !== baseline.length) return -1;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - baseline[i]) > 12 ||
              Math.abs(d[i + 1] - baseline[i + 1]) > 12 ||
              Math.abs(d[i + 2] - baseline[i + 2]) > 12 ||
              Math.abs(d[i + 3] - baseline[i + 3]) > 12) n += 1;
        }
        return n;
      };
      out.before = diffCount();
      const bandStats = () => {
        try {
          const d = komposit();
          let maxA = 0, maxR = 0, maxG = 0, maxB = 0, opaque = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > maxA) maxA = d[i + 3];
            if (d[i] > maxR) maxR = d[i];
            if (d[i + 1] > maxG) maxG = d[i + 1];
            if (d[i + 2] > maxB) maxB = d[i + 2];
            if (d[i + 3] > 128) opaque += 1;
          }
          return { maxA, maxR, maxG, maxB, opaque };
        } catch { return null; }
      };
      out.beforeStats = bandStats();

      const a = toClient(0.15, 0.5);
      const b = toClient(0.85, 0.5);
      const ev = (type, p, extra) => new PointerEvent(type, Object.assign({
        bubbles: true, composed: true, cancelable: true,
        pointerId: 11, pointerType: 'mouse', isPrimary: true,
        clientX: p.clientX, clientY: p.clientY,
      }, extra));
      canvas.dispatchEvent(ev('pointerdown', a, { button: 0, buttons: 1 }));
      // Yumuşak hareket: birden fazla ara nokta.
      for (let i = 1; i <= 24; i += 1) {
        const t = i / 24;
        canvas.dispatchEvent(ev('pointermove', {
          clientX: a.clientX + (b.clientX - a.clientX) * t,
          clientY: a.clientY + (b.clientY - a.clientY) * t + Math.sin(t * Math.PI) * 6,
        }, { button: 0, buttons: 1 }));
        await wait(8);
      }
      await wait(150);
      /* Zincir ortamında ilk canlı kare bazen çok sonra düşer
         (çok kapı arka arkaya koşarken kare üretimi gecikir; kapı
         birkaç kez bu yüzden kırmızıya düştü — 9-10 Kasım; tek
         başına koşum hep yeşil). Kare gelene dek yeniden ölç:
         amacı korur, kareleme yarışını eler. 60 rAF karesi +
         3 sn duvar-saati üst sınırı. */
      out.duringPress = 0;
      out.duringFrames = 0;
      { let s = null;
        const t0 = Date.now();
        for (let k = 0; k < 60; k += 1) {
          await new Promise(r => requestAnimationFrame(r));
          out.duringFrames += 1;
          const n = diffCount();
          if (n > out.duringPress) { out.duringPress = n; s = bandStats(); }
          if (out.duringPress > 200 || Date.now() - t0 > 3000) break;
        }
        out.duringStats = s || bandStats();
      }
      out.band = band;
      inkEditorRebuildPreview(true);
      const livePreview = inkEditorUi.previewCanvas;
      out.previewPixels = livePreview
        ? new Uint8ClampedArray(livePreview.getContext('2d').getImageData(
          0, 0, livePreview.width, livePreview.height
        ).data)
        : null;
      canvas.dispatchEvent(ev('pointerup', b, { button: 0, buttons: 0 }));

      // Commit sonrası yeniden çizim birkaç karede oturur.
      await wait(600);
      out.afterRelease = diffCount();
      out.afterStats = bandStats();
      const layerId = inkEditorUi.layerId;
      const lc = inkRuntime.itemCanvases.get(layerId);
      out.layerCanvas = lc ? { w: lc.width, h: lc.height } : null;
      if (lc) {
        const ld = lc.getContext('2d').getImageData(0, 0, lc.width, lc.height).data;
        if (out.previewPixels && out.previewPixels.length === ld.length) {
          let mismatch = 0;
          for (let i = 0; i < ld.length; i++) {
            if (out.previewPixels[i] !== ld[i]) mismatch++;
          }
          out.previewMismatch = mismatch;
        } else {
          out.previewMismatch = -1;
        }
        let n = 0;
        for (let i = 0; i < ld.length; i += 4) {
          if (ld[i] > 190 && ld[i + 1] > 190 && ld[i + 2] > 190 && ld[i + 3] > 190) n += 1;
        }
        out.layerBright = n;
        const lb = lc.getContext('2d').getImageData(
          Math.round(lc.width * 0.1), Math.round(lc.height * 0.44),
          Math.round(lc.width * 0.8), Math.round(lc.height * 0.12)).data;
        let la = 0, lmaxA = 0, lmaxR = 0, lmaxG = 0, lmaxB = 0;
        for (let i = 0; i < lb.length; i += 4) {
          if (lb[i + 3] > 0) la += 1;
          if (lb[i + 3] > lmaxA) lmaxA = lb[i + 3];
          if (lb[i] > lmaxR) lmaxR = lb[i];
          if (lb[i + 1] > lmaxG) lmaxG = lb[i + 1];
          if (lb[i + 2] > lmaxB) lmaxB = lb[i + 2];
        }
        out.layerBand = { over0: la, maxA: lmaxA, maxR: lmaxR, maxG: lmaxG, maxB: lmaxB };
      }
      const vd = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let cn = 0;
      for (let i = 0; i < vd.length; i += 4) {
        if (vd[i] > 190 && vd[i + 1] > 190 && vd[i + 2] > 190 && vd[i + 3] > 190) cn += 1;
      }
      out.canvasBrightFull = cn;
      const inkLayer = inkState().layers.find(l => l.id === layerId);
      const lastStroke = inkLayer && inkLayer.strokes.length ? inkLayer.strokes[inkLayer.strokes.length - 1] : null;
      out.stroke = lastStroke ? {
        size: lastStroke.size,
        color: lastStroke.color,
        opacity: lastStroke.opacity,
        points: lastStroke.points.length,
      } : null;
      out.strokeCount = (inkLayer || { strokes: [] }).strokes.length;
      if (lastStroke) {
        const dbg = document.createElement('canvas');
        dbg.width = 1600;
        dbg.height = 1200;
        inkDrawStrokeOnContext(dbg.getContext('2d'), lastStroke, {
          mapPoint: p => ({ x: p.x * 1600, y: p.y * 1200 }),
          sizePx: Math.max(0.5, lastStroke.size * 1600),
          pointScale: { x: 1600, y: 1200 },
        });
        const dd = dbg.getContext('2d').getImageData(0, 0, 1600, 1200).data;
        let dn = 0;
        for (let i = 0; i < dd.length; i += 4) {
          if (dd[i] > 190 && dd[i + 1] > 190 && dd[i + 2] > 190 && dd[i + 3] > 190) dn += 1;
        }
        out.redraw = dn;
      }
      out.epoch = typeof inkPaintEpoch === 'function' ? inkPaintEpoch(inkEditorUi.layerId) : -1;
      return JSON.stringify(out);
    })()`));

    check('çizim editörü açıldı', result.editorOpen === true, '');
    check('katman küçültme önbelleği devrede (zoom-out)',
      result.downscaled === true,
      `fit=${result.fit?.w}×${result.fit?.h} · katman=${result.layer?.w}×${result.layer?.h}`);
    check('basılı tutarken vuruş görünür',
      result.duringPress > 200,
      `değişen piksel=${result.duringPress} · istatistik=${JSON.stringify(result.duringStats)} · bant=${JSON.stringify(result.band)}`);
    check('vuruş modele işlendi', result.strokeCount >= 1,
      `vuruş=${result.strokeCount} · ${JSON.stringify(result.stroke)} · yeniden=${result.redraw} · katman-parlak=${result.layerBright} · katman-bant=${JSON.stringify(result.layerBand)} · tuval-parlak=${result.canvasBrightFull}`);
    check('bırakınca çizgi ekranda kalıyor',
      result.afterRelease > 200 && result.afterRelease >= Math.round((result.duringPress || 0) * 0.5),
      `bırakınca=${result.afterRelease} · basılıyken=${result.duringPress}`);
    check('canlı önizleme bırakılan rasterla piksel piksel aynı',
      result.previewMismatch === 0,
      `${result.previewMismatch} farklı kanal`);
    check('sayfada çalışma zamanı hatası yok',
      errors.length === 0, errors.join(' | ') || '');
  } catch (err) {
    console.error('TEST HATASI:', err.message);
    fail += 1;
  } finally {
    try { ws && ws.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* sessiz */ }
  }

  console.log(`\n${fail === 0 ? 'TÜMÜ GEÇTİ' : 'BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
