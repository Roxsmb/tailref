'use strict';

/* Şekil oturtma · uçtan uca etkileşim QC (gerçek uygulama + sentetik kalem).

   Kapsam:
   A · temel daire: kalem BASILIYKEN bekletince dönüşür (canlı görünür),
       kalem bırakınca canlı raster == commit birebir, kalınlık normal
       vuruşla aynı (0.22× ince kontur YOK).
   B · kapsam: hızlı daire, 300° boşluklu, geçmeli 1.15×, küçük (r≈40),
       büyük (r≈280), düz çizgi — hepsi oturtulur.
   C · yanlış pozitif koruması: karalama oturtulmaz; duraksamada
       oturtulan vuruş hareketle ESKİ HALİNE DÖNER (snapRevert) ve
       normal vuruş olarak commit edilir.

   Kullanım: node tests/ink-quickshape-qc.js
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9357;
const APP_PORT = 5233;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-quickshape-qc-'));
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

    const res = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '1400';
      document.getElementById('newCanvasH').value = '1000';
      document.getElementById('newCanvasName').value = 'QuickShape QC';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 120 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      out.editorOpen = inkEditorIsOpen();
      if (!out.editorOpen) return JSON.stringify(out);

      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      const toClient = (nx, ny) => ({
        clientX: rect.left + fit.x + nx * fit.w,
        clientY: rect.top + fit.y + ny * fit.h,
      });

      inkSetTool('brush', { brushId: 'ink-hard' });
      const ink = inkState();
      ink.size = 48;
      ink.opacity = 1;
      ink.smoothing = 0.2;
      ink.color = '#ffffff';
      await wait(120);

      const dprC = canvas.width / Math.max(1, rect.width);
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
          return c2.getImageData(0, 0, cp.width, cp.height).data;
        } catch { return null; }
      };
      const diffPix = (a, b) => {
        if (!a || !b || a.length !== b.length) return -1;
        let n = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i] - b[i]) > 12 || Math.abs(a[i+1] - b[i+1]) > 12 ||
              Math.abs(a[i+2] - b[i+2]) > 12 || Math.abs(a[i+3] - b[i+3]) > 12) n += 1;
        }
        return n;
      };
      const ev = (type, p, extra) => new PointerEvent(type, Object.assign({
        bubbles: true, composed: true, cancelable: true,
        pointerId: 11, pointerType: 'mouse', isPrimary: true,
        clientX: p.clientX, clientY: p.clientY,
      }, extra));

      /* Doküm uzayında daire çiz: merkez (nx,ny), yarıçap rn (fit
         normalizasyonu; wobble = yarıçap sapması, overshoot = kapanış
         ötesi derece). steps adım × 12 ms. */
      const drawCircle = async (nx, ny, rn, steps, wobble, overshoot, jseed) => {
        let js = jseed;
        const jig = () => {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          return (js / 0x7fffffff - 0.5) * 0.004;
        };
        const cx = nx, cy = ny;
        const total = (1 + overshoot) * Math.PI * 2;
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          const ang = -Math.PI / 2 + total * t;
          const r = rn * (1 + wobble * Math.sin(t * Math.PI * 3)) + jig() * rn;
          canvas.dispatchEvent(ev(i === 0 ? 'pointerdown' : 'pointermove', {
            clientX: rect.left + fit.x + (cx + Math.cos(ang) * r) * fit.w,
            clientY: rect.top + fit.y + (cy + Math.sin(ang) * r) * fit.h,
          }, { button: 0, buttons: 1 }));
          await wait(12);
        }
      };
      const drawLine = async (a, b, steps, jseed) => {
        let js = jseed;
        const jig = () => {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          return (js / 0x7fffffff - 0.5) * 0.003;
        };
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          canvas.dispatchEvent(ev(i === 0 ? 'pointerdown' : 'pointermove', {
            clientX: rect.left + fit.x + (a.nx + (b.nx - a.nx) * t + jig()) * fit.w,
            clientY: rect.top + fit.y + (a.ny + (b.ny - a.ny) * t + jig()) * fit.h,
          }, { button: 0, buttons: 1 }));
          await wait(12);
        }
      };
      const lift = async () => {
        const ui = inkEditorUi;
        inkEditorRebuildPreview(true);
        out._lastPreview = ui.previewCanvas
          ? Array.from(new Uint8ClampedArray(ui.previewCanvas.getContext('2d').getImageData(0, 0, ui.previewCanvas.width, ui.previewCanvas.height).data))
          : null;
        canvas.dispatchEvent(ev('pointerup', {
          clientX: rect.left + fit.x + ui.stroke.points[ui.stroke.points.length-1].x * fit.w,
          clientY: rect.top + fit.y + ui.stroke.points[ui.stroke.points.length-1].y * fit.h,
        }, { button: 0, buttons: 0 }));
        await wait(600);
      };
      const lastStroke = () => {
        const layer = inkState().layers.find(l => l.id === inkEditorUi.layerId);
        const s = layer && layer.strokes.length ? layer.strokes[layer.strokes.length - 1] : null;
        return s ? { kind: s.kind, shape: s.shape, snapFree: s.snapFree || 0, points: s.points.length } : null;
      };
      const undoOnce = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown',
          { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(260);
      };
      /* Katman ysa: yatay taramada alfa>0 koşu uzunlukları (piksel). */
      const runsAt = (ysa, rowFx) => {
        const d = ysa.getContext('2d').getImageData(0, 0, ysa.width, ysa.height).data;
        const y = Math.round(ysa.height * rowFx);
        const runs = [];
        let w = 0;
        for (let x = 0; x < ysa.width; x++) {
          if (d[(y * ysa.width + x) * 4 + 3] > 0) { w += 1; }
          else if (w) { runs.push(w); w = 0; }
        }
        if (w) runs.push(w);
        return runs;
      };
      const layerYsa = () => inkRuntime.itemCanvases.get(inkEditorUi.layerId);

      /* ——— A · temel daire: canlı + parite + kalınlık ——— */
      // önce REFERANS: normal DİKEY vuruş (bekletmeden) — yatay kesit
      // kalınlık ölçüsü verir (yatay çizgi tüm satırı kaplardı).
      await drawLine({ nx: 0.2, ny: 0.12 }, { nx: 0.2, ny: 0.34 }, 20, 91);
      inkEditorRebuildPreview(true);
      canvas.dispatchEvent(ev('pointerup', toClient(0.2, 0.34), { button: 0, buttons: 0 }));
      await wait(600);
      out.refRuns = runsAt(layerYsa(), 0.16);
      await undoOnce();

      await drawCircle(0.5, 0.55, 0.22, 40, 0.05, 0.03, 101);
      out.holdStrokeKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
      const beforeHold = komposit();
      await wait(860); // bekleme 550 ms + render payı — kalem HÂLÂ BASILI
      out.duringHoldKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind + '/' + inkEditorUi.stroke.shape : null;
      out.liveDiff = diffPix(beforeHold, komposit());
      await lift();
      out.committed = lastStroke();
      const lc = layerYsa();
      const preview = out._lastPreview;
      out.previewMismatch = -1;
      if (preview && lc && preview.length === lc.width * lc.height * 4) {
        const ld = Array.from(new Uint8ClampedArray(lc.getContext('2d').getImageData(0, 0, lc.width, lc.height).data));
        let m = 0;
        for (let i = 0; i < ld.length; i++) if (ld[i] !== preview[i]) m++;
        out.previewMismatch = m;
      }
      out.circleRuns = runsAt(layerYsa(), 0.55);
      const maxRun = a => a.reduce((m, r) => Math.max(m, r), 0);
      out.refW = maxRun(out.refRuns);
      out.circleW = maxRun(out.circleRuns.filter(r => r < 400));
      await undoOnce();
      await wait(200);

      /* ——— B · kapsam ——— */
      out.variants = {};
      // hızlı daire (~200 ms çizim)
      await drawCircle(0.25, 0.25, 0.10, 16, 0.06, 0.02, 201);
      await wait(860);
      out.variants['hizli'] = inkEditorUi.stroke.kind + '/' + inkEditorUi.stroke.shape;
      await lift(); await undoOnce();
      // 300° boşluklu (gerçekçi hız: 48 adım ≈ 576 ms; açık kapanış,
      // overshoot YOK — uçlar açıkta kalır)
      {
        let js = 206;
        const jig = () => {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          return (js / 0x7fffffff - 0.5) * 0.002;
        };
        const steps = 48;
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          const ang = -Math.PI / 2 + Math.PI * 2 * (300 / 360) * t;
          canvas.dispatchEvent(ev(i === 0 ? 'pointerdown' : 'pointermove', {
            clientX: rect.left + fit.x + (0.72 + (Math.cos(ang) + jig()) * 0.16) * fit.w,
            clientY: rect.top + fit.y + (0.28 + (Math.sin(ang) + jig()) * 0.16) * fit.h,
          }, { button: 0, buttons: 1 }));
          await wait(12);
        }
        await wait(860);
        out.variants['bosuklu300'] = inkEditorUi.stroke.kind + '/' + inkEditorUi.stroke.shape;
        // Teşhis: yakalanan noktalar saf tanıyıcıda ne diyor?
        const itD = getItem(inkEditorUi.itemId) || {};
        const pr = inkShapeSnapRecognize(
          inkEditorUi.stroke.points.map(p => ({ x: p.x * (itD.w || 1400), y: p.y * (itD.h || 1000) })));
        out.b2diag = {
          snapped: !!inkEditorUi.snapped,
          saved: !!inkEditorUi.snapSaved,
          n: inkEditorUi.stroke.points.length,
          probe: pr ? pr.type : null,
        };
        await lift(); await undoOnce();
      }
      // geçmeli 1.15×
      await drawCircle(0.3, 0.75, 0.14, 44, 0.04, 0.15, 202);
      await wait(860);
      out.variants['gecmeli'] = inkEditorUi.stroke.kind + '/' + inkEditorUi.stroke.shape;
      await lift(); await undoOnce();
      // küçük (r ≈ 40 doc px)
      await drawCircle(0.75, 0.75, 40 / Math.max(1, fit.w), 18, 0.05, 0.02, 203);
      await wait(860);
      out.variants['kucuk'] = inkEditorUi.stroke.kind + '/' + inkEditorUi.stroke.shape;
      await lift(); await undoOnce();
      // büyük (r ≈ 280 doc px)
      await drawCircle(0.5, 0.5, 280 / Math.max(1, fit.w), 40, 0.03, 0.02, 204);
      await wait(860);
      out.variants['buyuk'] = inkEditorUi.stroke.kind + '/' + inkEditorUi.stroke.shape;
      await lift(); await undoOnce();
      // düz çizgi
      await drawLine({ nx: 0.15, ny: 0.9 }, { nx: 0.85, ny: 0.9 }, 24, 205);
      await wait(860);
      out.variants['cizgi'] = inkEditorUi.stroke.kind + '/' + inkEditorUi.stroke.shape;
      await lift(); await undoOnce();
      await wait(200);

      /* ——— C · yanlış pozitif koruması ——— */
      // C1 · karalama: bekletince de vuruş vuruş kalır
      {
        let js = 301;
        const jig = () => {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          return (js / 0x7fffffff - 0.5) * 0.05;
        };
        let x = 0.2, y = 0.35;
        for (let i = 0; i < 40; i += 1) {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          x += (js / 0x7fffffff - 0.5) * 0.04 + jig();
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          y += (js / 0x7fffffff - 0.5) * 0.04 + jig();
          x = Math.max(0.05, Math.min(0.9, x));
          y = Math.max(0.1, Math.min(0.9, y));
          canvas.dispatchEvent(ev(i === 0 ? 'pointerdown' : 'pointermove',
            { clientX: rect.left + fit.x + x * fit.w, clientY: rect.top + fit.y + y * fit.h },
            { button: 0, buttons: 1 }));
          await wait(10);
        }
        await wait(900);
        out.scribble = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        await lift(); await undoOnce();
      }
      // C2 · duraksama-geri-dönüş: doğru parçasında bekle → line'a oturur,
      //      hareket sürünce ham izine DÖNER, vuruş 'stroke' olarak biter
      {
        canvas.dispatchEvent(ev('pointerdown', toClient(0.1, 0.05), { button: 0, buttons: 1 }));
        for (let i = 1; i <= 12; i += 1) {
          const t = i / 12;
          canvas.dispatchEvent(ev('pointermove', toClient(0.1 + t * 0.25, 0.05 + Math.sin(t * 6) * 0.01),
            { button: 0, buttons: 1 }));
          await wait(12);
        }
        await wait(860);
        out.pauseSnapped = inkEditorUi.stroke ? inkEditorUi.stroke.kind + '/' + inkEditorUi.stroke.shape : null;
        for (let i = 13; i <= 26; i += 1) {
          const t = i / 26;
          canvas.dispatchEvent(ev('pointermove', toClient(0.1 + t * 0.5, 0.05 + Math.sin(t * 9) * 0.05),
            { button: 0, buttons: 1 }));
          await wait(12);
        }
        out.afterMoveKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        canvas.dispatchEvent(ev('pointerup', toClient(0.6, 0.1), { button: 0, buttons: 0 }));
        await wait(500);
        out.revertCommitted = lastStroke();
        await undoOnce();
      }

      out.runtimeErrors = 0;
      return JSON.stringify(out);
    })()`));

    const o = res;
    check('çizim editörü açıldı', o.editorOpen === true, 'editör=' + o.editorOpen);
    if (!o.editorOpen) throw new Error('editör açılmadı');

    check('A1 canlı: kalem basılı bekleyince vuruş shape oldu',
      String(o.duringHoldKind || '').startsWith('shape/'), o.duringHoldKind);
    check('A2 canlı görüntü değişti (kalem basılıyken)',
      (o.liveDiff | 0) > 300, 'diff=' + o.liveDiff);
    check('A3 commit shape vuruşu (snapFree)', o.committed &&
      o.committed.kind === 'shape' && o.committed.shape === 'circle' && o.committed.snapFree === 1,
      JSON.stringify(o.committed));
    check('A4 canlı == commit (piksel birebir)', o.previewMismatch === 0,
      'mismatch=' + o.previewMismatch);
    check('A5 kalınlık normal vuruşla aynı (±%25)', o.refW > 0 && o.circleW > 0 &&
      Math.abs(o.circleW - o.refW) <= Math.max(6, o.refW * 0.25),
      'ref=' + o.refW + ' circle=' + o.circleW);

    const isCircle = v => String(v || '').indexOf('circle') >= 0;
    const isArc = v => String(v || '').indexOf('arc') >= 0;
    const isLine = v => String(v || '').indexOf('line') >= 0;
    check('B1 hızlı daire → circle', isCircle(o.variants['hizli']), o.variants['hizli']);
    /* Tur 4k sözleşmesi: 300° boşluklu halka bilinçli AÇIK kıvrımdır —
       yay kalır, boşluk KORUNUR (daireye kapatmak boşluğu siler). */
    check('B2 300° boşluklu → yay (arc, boşluk korunur — 4k)',
      isArc(o.variants['bosuklu300']), o.variants['bosuklu300'] +
      ' | b2diag=' + JSON.stringify(o.b2diag || null));
    check('B3 geçmeli 1.15× → circle', isCircle(o.variants['gecmeli']), o.variants['gecmeli']);
    check('B4 küçük daire → circle', isCircle(o.variants['kucuk']), o.variants['kucuk']);
    check('B5 büyük daire → circle', isCircle(o.variants['buyuk']), o.variants['buyuk']);
    check('B6 düz çizgi → line', isLine(o.variants['cizgi']), o.variants['cizgi']);

    check('C1 karalama oturtulmaz (stroke kalır)', o.scribble === 'stroke', o.scribble);
    check('C2 duraksama line oturdu', String(o.pauseSnapped || '').startsWith('shape/line'),
      o.pauseSnapped);
    /* Tur 4: revert kalktı — oturtma sonrası hareket şekli CANLI ayarlar
       (Procreate gibi); vuruş shape kalır ve o haliyle commit edilir. */
    check('C3 hareketle şekil canlı ayarlandı (revert kalktı)',
      o.afterMoveKind === 'shape', o.afterMoveKind);
    check('C4 ayar sonrası commit shape vuruşu (snapFree)', o.revertCommitted &&
      o.revertCommitted.kind === 'shape' && o.revertCommitted.snapFree === 1,
      JSON.stringify(o.revertCommitted));

    check('Z sayfada çalışma zamanı hatası yok', errors.length === 0,
      errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail++;
    console.log('HATA ' + (e && e.message));
  } finally {
    try { if (app && !app.killed) app.kill(); } catch { /* sessiz */ }
    try { if (ws) ws.close(); } catch { /* sessiz */ }
  }
  console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
  process.exit(fail ? 1 : 0);
})();
