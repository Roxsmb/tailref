'use strict';

/* FAZ 7.M · maskeli katman commit'i — bölgesel rebuild doğruluk kapısı.

   Arkaplan: profiler A3 fazı maskeli katmana vuruş tamamının inkRerenderLayer
   (TAM kurulum: tüm tuval + tüm vuruş tekrarı) ~177 ms/devre tuttuğunu
   gösterdi. 36-ink-editor.js commit'i artık inkRebuildItemLayerRegion
   (bölgesel) yoluna düşer: baked bölge kesiti + kesişen vuruşların sıralı
   tekrarı + bölge maskesi.
   Doğruluk isnadı: source-over kompozisyon PİKSEL NOKTASALDIR — bölge dışı
   piksellere bağlı değildir. Bu kapı iki denetim yapar:

   1. Bölgesel yol sayılır: commit sonrası counters.rebuildRectCount artar.
   2. BİREBİR piksellik: bölgesel sonuçla TAM inkRerenderLayer sonucu
      aynı pikselleri vermeli (kanal farkı 0).

   Ayrıca undo (Ctrl+Z) vuruşu sökerken bölgelerin uyumlu kaldığını görür.
   Kullanım: node tests/ink-mask-region-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9359;
const APP_PORT = 5211;
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
    if (msg.error) reject(new Error(method + ': ' + msg.error.message));
    else resolve(msg.result);
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-mask-region-'));
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

      /* karşılama kapısı: zincir ortamında bazen modal açık gelir */
      const welcome = document.getElementById('persistenceWelcome');
      if (welcome && !welcome.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
        await wait(200);
      }

      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '1200';
      document.getElementById('newCanvasH').value = '900';
      document.getElementById('newCanvasName').value = 'Maske Bölge';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 120 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(600);
      out.editorOpen = inkEditorIsOpen();
      if (!out.editorOpen) return JSON.stringify(out);

      const layerId = inkState().activeLayerId;
      out.layerId = layerId;
      const layerCanvas = inkRuntime.itemCanvases.get(layerId) || inkEnsureItemCanvas(inkLayerById(layerId));
      out.layer = layerCanvas ? { w: layerCanvas.width, h: layerCanvas.height } : null;
      if (!layerCanvas) return JSON.stringify(out);

      /* —— maske ekle (reveal = beyaz düzlem) + düzenleme modundan EN ——
         (strokes katmana gitsin: commit'in bölgesel yolu deneme kılıfı) */
      const mLayer = inkDocAddMask(layerId, 'reveal');
      out.maskAdded = !!(mLayer && mLayer.mask);
      if (!out.maskAdded) return JSON.stringify(out);
      if (inkState().maskEditId === layerId) inkDocToggleMaskEdit(layerId);
      out.maskEditOff = inkState().maskEditId !== layerId;

      /* vuruş: iki renkli band (kesişen olarak her ikisi de bölge içinde) */
      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      const toClient = (nx, ny) => ({
        clientX: rect.left + fit.x + nx * fit.w,
        clientY: rect.top + fit.y + ny * fit.h,
      });
      const cizVurus = async (renk, y0, y1) => {
        inkSetTool('brush', { brushId: 'ink-hard' });
        const ink = inkState();
        ink.size = 30; ink.opacity = 1; ink.smoothing = 0.2; ink.color = renk;
        await wait(100);
        const a = toClient(0.18, y0), b = toClient(0.82, y1);
        const ev = (type, p) => new PointerEvent(type, {
          bubbles: true, composed: true, cancelable: true,
          pointerId: 21, pointerType: 'mouse', isPrimary: true,
          clientX: p.clientX, clientY: p.clientY, button: 0, buttons: 1,
        });
        canvas.dispatchEvent(ev('pointerdown', a));
        for (let i = 1; i <= 20; i += 1) {
          const t = i / 20;
          canvas.dispatchEvent(ev('pointermove', {
            clientX: a.clientX + (b.clientX - a.clientX) * t,
            clientY: a.clientY + (b.clientY - a.clientY) * t,
          }));
          await wait(7);
        }
        await wait(120);
        canvas.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, composed: true, cancelable: true,
          pointerId: 21, pointerType: 'mouse', isPrimary: true,
          clientX: b.clientX, clientY: b.clientY, button: 0, buttons: 0,
        }));
        await wait(160);
      };
      window.__inkPerf.reset();
      await cizVurus('#e04040', 0.42, 0.44);
      await cizVurus('#2867c8', 0.58, 0.60);
      out.strokesKesit = inkLayerById(layerId).strokes.length;

      /* —— denetim 1: commits bölgesel yoldan geçti mi? —— */
      const counters = window.__inkPerf.snapshot().counters;
      out.region = {
        count: counters.rebuildRectCount || 0,
        msTotal: Math.round((counters.rebuildRectMs || 0) * 10) / 10,
        skipt: counters.rebuildRectSkips || 0,
      };

      /* —— denetim 2: bölgesel sonuç == tam kursettiğimiz piksel birebir —— */
      const ctx = layerCanvas.getContext('2d', { colorSpace: 'srgb' });
      const al = () => ctx.getImageData(0, 0, layerCanvas.width, layerCanvas.height).data;
      const a1 = al();
      inkRerenderLayer(layerId);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const a2 = al();
      let diffPix = 0, maxDiff = 0;
      for (let i = 0; i < a1.length; i += 4) {
        const d = Math.max(
          Math.abs(a1[i] - a2[i]),
          Math.abs(a1[i + 1] - a2[i + 1]),
          Math.abs(a1[i + 2] - a2[i + 2]),
          Math.abs(a1[i + 3] - a2[i + 3]));
        if (d > 0) { diffPix++; if (d > maxDiff) maxDiff = d; }
      }
      out.parite = { diffPix, maxDiff };

      /* —— denetim 3: undo vuruşu söker + bölge yeniden uyum —— */
      const sarıKatman = layerCanvas;
      const ysaArr = () => Array.from(sarıKatman.getContext('2d', { colorSpace: 'srgb' })
        .getImageData(0, 0, sarıKatman.width, sarıKatman.height).data);
      const renkSay = (d, hangi) => {
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (hangi === 'kizil' && d[i] > 150 && d[i + 1] < 110 && d[i + 2] < 110) n += 1;
          if (hangi === 'mavi' && d[i + 2] > 150 && d[i] < 110 && d[i + 1] < 110) n += 1;
        }
        return n;
      };
      out.kırmızıOnce = renkSay(ysaArr(), 'kizil');
      out.maviOnce = renkSay(ysaArr(), 'mavi');
      window.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      await wait(220);
      out.kırmızıUndo = renkSay(ysaArr(), 'kizil');
      out.maviUndo = renkSay(ysaArr(), 'mavi');
      window.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
      await wait(220);
      out.kırmızıRedo = renkSay(ysaArr(), 'kizil');
      out.maviRedo = renkSay(ysaArr(), 'mavi');

      /* —— denetim 4: maske düzenleme modu da kırmızıyordu (commit ile
         maskerci yolu hâlâ erken dönemden geçiyor) —— */
      inkDocToggleMaskEdit(layerId);
      out.maskEditOn = inkState().maskEditId === layerId;
      inkDocRemoveMask(layerId);
      out.maskRemoved = !inkLayerById(layerId).mask;
      return JSON.stringify(out);
    })()`));

    check('çizim editörü açıldı', result.editorOpen === true, 'editör=' + result.editorOpen);
    check('maske eklendi (reveal)', result.maskAdded === true, 'mask=' + result.maskAdded);
    check('maske düzenleme modu kapatıldı', result.maskEditOff === true, 'edit=' + result.maskEditOff);
    check('iki vuruş katmana işlendi', (result.strokesKesit | 0) >= 2,
      'strokes=' + result.strokesKesit);
    check('B1 commit bölgesel rebuild düştü', (result.region?.count || 0) >= 1 &&
      !(result.region?.skipt > 0),
      'count=' + (result.region?.count) + ' msTop=' + (result.region?.msTotal) +
      ' skip=' + (result.region?.skipt));
    check('B2 bölgesel == tam kursettiğimiz (piksel birebir)',
      (result.parite?.diffPix || 0) === 0,
      'diffPix=' + (result.parite?.diffPix) + ' maxDiff=' + (result.parite?.maxDiff));
    /* tek Ctrl+Z SON vuruşu söker (mavi) — her iki bant da izlenir */
    check('C1 undo son vuruşu söktü (mavi)', (result.maviUndo | 0) < (result.maviOnce | 0),
      'mavi ' + result.maviOnce + ' → ' + (result.maviUndo));
    check('C2 undo kırmızıyı korudu (sıra doğru)',
      (result.kırmızıUndo | 0) === (result.kırmızıOnce | 0) &&
      (result.kırmızıOnce | 0) > 0,
      'kızıl ' + result.kırmızıOnce + ' → ' + (result.kırmızıUndo));
    check('C3 redo maviyi geri getirdi',
      (result.maviRedo | 0) >= (result.maviOnce | 0),
      'mavi redo=' + (result.maviRedo) + ' kırmızı redo=' + (result.kırmızıRedo));
    check('D1 maske düzenleme modu açılabilir', result.maskEditOn === true,
      'edit=' + result.maskEditOn);
    check('D2 maske silindi (tam kursettiğimiz maskesiz döndü)', result.maskRemoved === true,
      'mask yok=' + result.maskRemoved);

    if (errors.length) {
      console.log('HATALAR:\n' + errors.join('\n---\n'));
    } else {
      console.log('sayfada çalışma zamanı hatası yok');
    }

    console.log('\nSONUÇ: ' + pass + ' OK · ' + fail + ' FAIL');
    if (fail > 0 || errors.length) {
      try { app.kill(); } catch { /* */ }
      process.exit(1);
    }
    try { app.kill(); } catch { /* */ }
    process.exit(0);
  } catch (e) {
    try { app.kill(); } catch { /* */ }
    console.error('KAPI HATASI: ' + (e && e.stack ? e.stack : String(e)));
    process.exit(1);
  }
})();
