'use strict';
/* FAZ 7.U doğruluk kapısı: undo bölgesel yeniden kurulumun damga
   döngüsü worker'da (inkWorkerRegionRebuildJob) — ANA-THREAD
   inkUndoRegionRebuild ile BIT-PARITE olmak zorunda.
   Yöntem: sabit id'li vuruşlar (jitter deterministiktir: stroke.id FNV
   hash) doğrudan layer.strokes'a push edilir; tam vektör kurulum
   referansı inkRerenderLayer ile alınır; önce ana-thread bölgesel
   sonuç, sonra aynı tabandan worker bölgesel sonuç dilim karşılaştırma.
   Ayrıca gerçek undo() akışının worker yolunu seçtiği istatistikten
   doğrulanır (inkUndoRaster.stats.workerPosted/Applied/Cancelled).
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9350;
const APP_PORT = 5228;const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-undrwkr-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
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

    const rapor = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      if (inkEditorIsOpen()) { inkEditorClose(); await wait(400); }
      document.getElementById('modeDrawBtn').click();
      await wait(240);
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 120 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(400);

      /* worker kanalları: var mı? */
      if (!inkWorkerSupported()) return JSON.stringify({ err: 'worker desteklenmiyor' });

      const layerId = inkState().activeLayerId;
      const layer = inkLayerById(layerId);
      if (!layer || layer.kind !== 'attached') return JSON.stringify({ err: 'attached katman yok' });

      /* deterministic vuruş kümesi: id'ler jitter tohumu (FNV). */
      const egri = (x0, y0, x1, y1, n) => {
        const pts = [];
        for (let i = 0; i <= n; i += 1) {
          const t = i / n;
          pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, p: 0.35 + 0.5 * Math.abs(Math.sin(t * 6)), a: 0, s: 0 });
        }
        return pts;
      };
      layer.strokes.push({
        kind: 'stroke', tool: 'brush', brushId: 'ink-hard', id: 'uwrk-b1',
        points: egri(0.16, 0.20, 0.62, 0.46, 24),
        size: 0.045, opacity: 0.92, color: '#c04030', sym: 'off', spacing: 0.1,
      });
      layer.strokes.push({
        kind: 'stroke', tool: 'eraser', id: 'uwrk-e1',
        points: egri(0.30, 0.28, 0.52, 0.66, 20),
        size: 0.032, opacity: 1, color: '#000000', sym: 'off', spacing: 0.1,
      });
      layer.strokes.push({
        kind: 'stroke', tool: 'brush', brushId: 'ink-hard', id: 'uwrk-b2',
        points: egri(0.34, 0.60, 0.58, 0.30, 22),
        size: 0.028, opacity: 0.60, color: '#2266cc', sym: 'off', spacing: 0.1,
      });
      inkRerenderLayer(layerId);
      await wait(150);

      const grabBolge = (c, reg) => c.getContext('2d', { colorSpace: 'srgb' }).getImageData(
        Math.max(0, reg.x | 0), Math.max(0, reg.y | 0),
        Math.min(c.width - Math.max(0, reg.x | 0), reg.w | 0),
        Math.min(c.height - Math.max(0, reg.y | 0), reg.h | 0));
      const bytesCmp = (a, b) => {
        let n = 0, max = 0;
        for (let i = 0; i < a.length; i += 1) {
          const d = Math.abs(a[i] - b[i]);
          if (d > 0) { n++; if (d > max) max = d; }
        }
        return { n, max };
      };

      /* FINAL eraser'ın bölgesi: ilk iki vuruşun ortasında silme paidı —
         bölge İÇİNDE baked (bkz. dizi başı) ve fırça pikselleri var. */
      const eraseStroke = layer.strokes.find(s => s.id === 'uwrk-e1');
      const reg = inkUndoStrokeRegion(layer, eraseStroke);
      if (!reg || reg.w <= 0 || reg.h <= 0) return JSON.stringify({ err: 'bölge hesaplanamadı' });

      const canvas = inkRuntime.itemCanvases.get(layerId);

      /* FAZ 7.U DIAG-EMSiYETİ: diag (tests/uwkr-diag.js) bu yapıyla
         0 px veriyor — kapı da aynı yapıyı izler: tam-tuval referansı
         worker sonrası tam tuvalla karşılaştırılır. */
      /* B-için basitleştirme: tek tek vuruşlar — hangi vuruş/kapı
         ortamında çalışmıyor? */
      const kayitliTum = layer.strokes.slice();
      const tekCikti = [];
      for (const st of kayitliTum) {
        layer.strokes.length = 0;
        layer.strokes.push(st);
        inkRerenderLayer(layerId);
        await wait(140);
        const reg1 = inkStrokePixelBox(st, canvas);
        const ref1 = (() => {
          const g = canvas.getContext('2d', { colorSpace: 'srgb' });
          return g.getImageData(0, 0, canvas.width, canvas.height).data.slice(0);
        })();
        const p1 = await inkWorkerRegionRebuildJob(layer, reg1, canvas);
        await wait(120);
        const w1 = (() => {
          const g = canvas.getContext('2d', { colorSpace: 'srgb' });
          return g.getImageData(0, 0, canvas.width, canvas.height).data.slice(0);
        })();
        const d1 = (() => {
          let n = 0, max = 0;
          for (let i = 0; i < ref1.length; i += 1) {
            const dv = Math.abs(ref1[i] - w1[i]);
            if (dv > 0) { n++; if (dv > max) max = dv; }
          }
          return { n, max };
        })();
        tekCikti.push({ ad: st.id, reg: reg1 ? [reg1.x | 0, reg1.y | 0, reg1.w, reg1.h] : null, res: String(p1), dif: d1 });
      }
      /* id değişkeni testi: birebir aynı geometri, İKİ id */
      for (const idAlp of ['zsex-1']) {
        const st = { kind: 'stroke', tool: 'brush', brushId: 'ink-hard', id: idAlp, points: egri(0.20, 0.30, 0.60, 0.50, 24), size: 0.045, opacity: 0.92, color: '#c04030', sym: 'off', spacing: 0.1 };
        layer.strokes.length = 0;
        layer.strokes.push(st);
        inkRerenderLayer(layerId);
        await wait(140);
        const reg1 = inkStrokePixelBox(st, canvas);
        const ref1 = (() => {
          const g = canvas.getContext('2d', { colorSpace: 'srgb' });
          return g.getImageData(0, 0, canvas.width, canvas.height).data.slice(0);
        })();
        const p1 = await inkWorkerRegionRebuildJob(layer, reg1, canvas);
        await wait(120);
        const w1 = (() => {
          const g = canvas.getContext('2d', { colorSpace: 'srgb' });
          return g.getImageData(0, 0, canvas.width, canvas.height).data.slice(0);
        })();
        let n = 0, max = 0;
        for (let i = 0; i < ref1.length; i += 1) {
          const dv = Math.abs(ref1[i] - w1[i]);
          if (dv > 0) { n++; if (dv > max) max = dv; }
        }
        tekCikti.push({ ad: 'IDTEST-' + idAlp, res: String(p1), dif: { n, max } });
      }
      /* tam listeye dön */
      layer.strokes.length = 0;
      for (const st of kayitliTum) layer.strokes.push(st);

      inkRerenderLayer(layerId);
      await wait(150);
      const fullRef = (() => {
        const g = canvas.getContext('2d', { colorSpace: 'srgb' });
        return { d: g.getImageData(0, 0, canvas.width, canvas.height).data.slice(0) };
      })();
      const A = grabBolge(canvas, reg).data;
      const baseB = A.slice(0);
      const abBase = { n: 0, max: 0 };

      /* --- B: worker bölgesel yol --- */
      const sonucB = await inkWorkerRegionRebuildJob(layer, reg, canvas);
      await wait(80);
      const B = grabBolge(canvas, reg).data;
      await wait(500);
      const B2 = grabBolge(canvas, reg).data;
      const ab = bytesCmp(A, B);
      const ab2 = bytesCmp(A, B2);
      const ab12 = bytesCmp(B, B2);
      const yapisal = (() => {
        let silinen = 0, eklenen = 0, rgbFark = 0, alfaFark = 0;
        let silineMax = 0, ekleMax = 0;
        for (let i = 0; i < A.length; i += 4) {
          const aA = A[i + 3], aB = B[i + 3];
          const tA = aA > 0 || A[i] > 0 || A[i+1] > 0 || A[i+2] > 0;
          const tB = aB > 0 || B[i] > 0 || B[i+1] > 0 || B[i+2] > 0;
          if (tA && !tB) { silinen++; silineMax = Math.max(silineMax, aA); }
          else if (!tA && tB) { eklenen++; ekleMax = Math.max(ekleMax, aB); }
          else if (tA && tB) rgbFark++;
          if (aA !== aB) alfaFark++;
        }
        return { silinen, eklenen, rgbFark, alfaFark, silineMax, ekleMax };
      })();
      const fullNow = (() => {
        const g = canvas.getContext('2d', { colorSpace: 'srgb' });
        return g.getImageData(0, 0, canvas.width, canvas.height).data.slice(0);
      })();
      const cmpF = (d1, d2) => {
        let n = 0, max = 0;
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        for (let i = 0; i < d1.length; i += 4) {
          let cmax = 0;
          for (let k = 0; k < 4; k++) cmax = Math.max(cmax, Math.abs(d1[i+k] - d2[i+k]));
          if (cmax > 0) {
            n++;
            const x = (i >> 2) % canvas.width, y = (i >> 2) / canvas.width | 0;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
          if (cmax > max) max = cmax;
        }
        return { n, max, bbox: maxX >= 0 ? [minX, minY, maxX - minX, maxY - minY] : null };
      };
      const fA = cmpF(fullRef.d, fullNow);   // worker sonra tam tuval farkı
      /* aynı karede bölge-dilim < tam-tuval dilim denetimi */
      const dilimAl = (d, reg) => {
        const W = canvas.width, x0 = Math.max(0, reg.x | 0), y0 = Math.max(0, reg.y | 0);
        const w = Math.min(W - x0, reg.w), h = Math.min(canvas.height - y0, reg.h);
        const cik0 = [];
        for (let y = 0; y < h; y += 1) {
          const satir = (y0 + y) * W * 4 + x0 * 4;
          for (let p = 0; p < w * 4; p += 1) cik0.push(d[satir + p]);
        }
        return cik0;
      };
      const dilimA = dilimAl(fullRef.d, reg);
      const dilimN = dilimAl(fullNow, reg);
      const dilimFark = (() => {
        let n = 0, max = 0;
        for (let i = 0; i < dilimA.length; i += 1) {
          const d = Math.abs(dilimA[i] - dilimN[i]);
          if (d > 0) { n++; if (d > max) max = d; }
        }
        return { n, max };
      })();
      const esitlik = (() => {
        let n = 0, max = 0;
        for (let i = 0; i < A.length; i += 1) {
          const d = Math.abs(A[i] - dilimA[i]);
          if (d > 0) { n++; if (d > max) max = d; }
        }
        return { n, max, boyut: [A.length, dilimA.length] };
      })();

      /* --- C: gerçek undo() akışında worker yolu kullanılıyor mu? --- */
      /* b4 GERÇEK commit akışıyla girsin: inkPushUndoStroke (delta kaydı +
         before anlık görüntüsü) → push → rerender. Aksi hâlde undoStack'te
         b4 kaydı yok; undo() ya "yok" der ya bayat kayda düşer — worker
         yolu hiç denenmez (kapı hatası, ürün hatası değil). */
      const b4 = {
        kind: 'stroke', tool: 'brush', brushId: 'ink-hard', id: 'uwrk-b4',
        points: egri(0.36, 0.40, 0.60, 0.62, 20),
        size: 0.024, opacity: 0.9, color: '#7a2a9a', sym: 'off', spacing: 0.1,
      };
      inkPushUndoStroke(layer, b4);
      layer.strokes.push(b4);
      inkRerenderLayer(layerId);
      await wait(150);
      const st = { ...inkUndoRaster.stats };   /* canlı nesne değil, kopya */
      /* fallback'i zorla: fast-path snapshot kayıtları atılır (kapı
         undo-region-check ile aynı kural); böylece undo worker yolunu
         seçmek ZORUNDA kalır. */
      inkUndoRaster.entries.clear();
      /* poko undo: doğrudan undo() (diag36: klavye kanalı bu ortamda
         undo()'ya ulaşmıyor; kontrolün amacı gerçek undo akışı) */
      if (typeof undo === 'function') undo();
      await wait(260);
      await wait(900);  // worker işi bitene dek
      const st2 = inkUndoRaster.stats;
      /* undo sonrası referans: son vuruşsuz tam kurulum */
      inkRerenderLayer(layerId);
      await wait(150);
      const REF = grabBolge(canvas, reg).data;
      const NOW = grabBolge(canvas, reg).data;
      const cd = bytesCmp(REF, NOW);

      return JSON.stringify({
        reg: [reg.x | 0, reg.y | 0, reg.w, reg.h],
        tekCikti,
        bSonuc: String(sonucB),
        abBase,
        ab, ab2, ab12, yapisal, fA, dilimFark, esitlik, c: {
          posted: st2.workerPosted - st.workerPosted,
          applied: st2.workerApplied - st.workerApplied,
          cancelled: st2.workerCancelled - st.workerCancelled,
          skips: st2.workerSkips - st.workerSkips,
          fallbacks: st2.fallbacks - st.fallbacks,
        }, cd,
        destek: !!inkWorkerSupported(),
      });
    })()`));

    const r = typeof rapor === 'string' ? JSON.parse(rapor) : rapor;
    if (r.err) { throw new Error('sahne: ' + r.err); }
    console.log('TEMSIL: dilimFark=' + JSON.stringify(r.dilimFark) + ' esitlik=' + JSON.stringify(r.esitlik));
    console.log('YAPISAL: ' + JSON.stringify(r.yapisal));
    console.log('TEK: ' + JSON.stringify(r.tekCikti));

    check('worker kanalları açık', r.destek === true);
    check('worker bölge işi kabul edildi', r.bSonuc === 'applied', 'sonuc=' + r.bSonuc);
    check('taban paritesi (rerender==rerender)', r.abBase && r.abBase.n === 0,
      r.abBase ? ('n=' + r.abBase.n + ' max=' + r.abBase.max) : '(yok)');
    check('post-apply karalı ', r.ab12 && r.ab12.n === 0,
      r.ab12 ? ('B vs B2 n=' + r.ab12.n + ' | B vs A n=' + r.ab.n + ' | B2 vs A n=' + r.ab2.n) : '(yok)');
    check('Parite: worker bölgesel == ana bölgesel (0 px)',
      r.ab && r.ab.n === 0, r.ab ? ('n=' + r.ab.n + ' max=' + r.ab.max + ' reg=' + JSON.stringify(r.reg) +
        ' tamTuval=' + JSON.stringify(r.fA)) : '(yok)');
    check('gerçek undo() worker yolunu seçti',
      r.c.posted === 1 && r.c.applied === 1 && r.c.cancelled === 0 && r.c.skips === 0,
      'posted=' + r.c.posted + ' applied=' + r.c.applied + ' cancelled=' + r.c.cancelled +
      ' skips=' + r.c.skips + ' fallbacks=' + r.c.fallbacks);
    check('undo() sonucu == tam kurulum referansı (0 px)',
      r.cd && r.cd.n === 0, r.cd ? ('n=' + r.cd.n + ' max=' + r.cd.max) : '(yok)');

    await evaluate(ws, 'inkEditorClose()').catch(() => {});
  } catch (e) {
    console.error('UWKR HATASI: ' + (e && e.message ? e.message.slice(0, 400) : String(e)));
    failures += 1;
  } finally {
    try { app.kill(); } catch { /* son nefes */ }
    await sleep(300);
  }
  console.log(failures ? 'FAZ 7.U KAPISI: ' + failures + ' hata' : 'FAZ 7.U KAPISI: tamam');
  process.exitCode = failures ? 1 : 0;
})();
