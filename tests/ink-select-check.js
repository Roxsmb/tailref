'use strict';

/* Seçim ve dönüştürme araçları için odaklı davranış testi.

   Kapsam:
   • Yeni tuval açıp çizim editörüne girmek
   • Dikdörtgen seçim (marquee) vuruşları seçiyor mu?
   • Taşı / Dönüştür ile seçim sürüklenince vuruşlar taşınıyor mu?
   • Ctrl+Z taşımayı geri alıyor mu?
   • Kement seçim vuruşları seçiyor mu?

   Uygulamayı kendisi başlatır ve kapatır:
     node scripts/ink-select-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9336;
const APP_PORT = 5199;
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

async function waitForTarget(deadlineMs = 25000) {
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-select-'));
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

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
        if (ready) break;
      } catch { /* henüz değil */ }
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    await evaluate(ws, "window.__checkErrs = []; window.addEventListener('error', e => window.__checkErrs.push(String(e.message || e))); true");

    const result = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const modal = document.getElementById('newCanvasModal');
      const form = document.getElementById('newCanvasForm');
      const drawBtn = document.getElementById('modeDrawBtn');
      const canvas = document.getElementById('inkEditorCanvas');

      // Temiz başlangıç
      if (typeof inkCloseTransientUi === 'function') inkCloseTransientUi();
      modal.hidden = true;

      // Yeni tuval aç
      drawBtn.click();
      await wait(260);
      out.modalOpened = !modal.hidden;
      document.getElementById('newCanvasW').value = '400';
      document.getElementById('newCanvasH').value = '300';
      document.getElementById('newCanvasName').value = 'Secim Testi';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      form.requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      out.editorOpen = inkEditorIsOpen();
      if (!out.editorOpen) return JSON.stringify(out);

      const item = state.items.find(it => it.title === 'Secim Testi');
      out.item = !!item;
      if (!item) return JSON.stringify(out);
      const layers = inkLayersForOwner(item.id);
      const layer = layers[layers.length - 1];
      out.layers = layers.length;

      // İki yatay vuruş yerleştir
      const stroke = (id, y) => ({
        id, kind: 'stroke', tool: 'brush', color: '#e05a3a',
        size: 10 / item.w, opacity: 1, hardness: 0.6, spacing: 0.09,
        points: [
          { x: 0.15, y, p: 1 },
          { x: 0.35, y, p: 1 },
          { x: 0.55, y, p: 1 },
        ],
      });
      layer.strokes = [stroke('sk_sel_a', 0.45), stroke('sk_sel_b', 0.62)];
      if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(layer.id, 'mutation');
      if (typeof inkRerenderLayer === 'function') inkRerenderLayer(layer.id);
      inkEditorInvalidate();
      await wait(200);

      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      out.fit = { x: Math.round(fit.x), y: Math.round(fit.y), w: Math.round(fit.w), h: Math.round(fit.h) };
      const pt = (lx, ly) => ({
        clientX: rect.left + fit.x + lx * fit.w,
        clientY: rect.top + fit.y + ly * fit.h,
      });
      const fire = (type, p) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 77, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: p.clientX, clientY: p.clientY,
      }));

      // 1) Dikdörtgen seçim
      inkSetTool('marquee');
      let a = pt(0.05, 0.33);
      let b = pt(0.72, 0.72);
      fire('pointerdown', a);
      fire('pointermove', b);
      fire('pointerup', b);
      await wait(150);
      out.marqueeSelected = (inkState().selection || []).length;

      // 2) Taşı / Dönüştür ile sürükle
      inkSetTool('transform');
      out.modeDraw = typeof modeIsDraw === 'function' ? modeIsDraw() : null;
      out.undoLenBeforeMove = undoStack.length;
      const before = layer.strokes.map(s => s.points.map(p => ({ x: p.x, y: p.y })));
      const start = pt(0.35, 0.525);
      fire('pointerdown', start);
      fire('pointermove', pt(0.45, 0.525));
      fire('pointerup', pt(0.45, 0.525));
      await wait(200);
      out.moveDx = Math.round((layer.strokes[0].points[0].x - before[0][0].x) * 400);
      out.moveDy = Math.round((layer.strokes[0].points[0].y - before[0][0].y) * 300);
      out.selectionAfterMove = (inkState().selection || []).length;
      out.gizmoAfterMove = !!inkEditorUi.gizmoDrag;
      out.undoLenAfterMove = undoStack.length;

      // 3) Ctrl+Z taşımayı geri almalı
      out.keySeen = '';
      const probe = e => { out.keySeen = String(e.key) + ':' + (e.ctrlKey ? 'ctrl' : '') + ':' + (e.defaultPrevented ? 'prevented' : 'open'); };
      window.addEventListener('keydown', probe, true);
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      window.removeEventListener('keydown', probe, true);
      await wait(450);
      // Geri alma durumu yeniden kurar; eski katman nesnesi bayat olabilir.
      const liveStroke = () => {
        const l = (inkState().layers || []).find(x => x.id === layer.id) || layer;
        return (l.strokes || []).find(s => s.id === 'sk_sel_a') || layer.strokes[0];
      };
      out.undoLenAfterKey = undoStack.length;
      out.undoDx = Math.round((liveStroke().points[0].x - before[0][0].x) * 400);
      out.undoDy = Math.round((liveStroke().points[0].y - before[0][0].y) * 300);
      if (out.undoDx !== 0) {
        if (typeof undo === 'function') undo();
        await wait(350);
        out.directUndoDx = Math.round((liveStroke().points[0].x - before[0][0].x) * 400);
      }

      // 4) Kement seçimi (ikinci vuruşun çevresi)
      inkSetTool('lasso');
      const poly = [pt(0.08, 0.5), pt(0.68, 0.5), pt(0.68, 0.74), pt(0.08, 0.74)];
      fire('pointerdown', poly[0]);
      for (let i = 1; i < poly.length; i += 1) fire('pointermove', poly[i]);
      fire('pointerup', poly[poly.length - 1]);
      await wait(150);
      out.lassoSelected = (inkState().selection || []).length;
      out.lassoHasB = (inkState().selection || []).includes('sk_sel_b');

      // 5) Fırça vuruşu çiz ve Ctrl+Z ile geri al
      inkSetTool('brush');
      const countStrokes = () => inkLayersForOwner(item.id)
        .reduce((n, l) => n + (l.strokes || []).length, 0);
      const beforeBrush = countStrokes();
      const bp0 = pt(0.2, 0.2);
      const bp1 = pt(0.45, 0.26);
      fire('pointerdown', bp0);
      for (let i = 1; i <= 6; i += 1) {
        fire('pointermove', pt(0.2 + (0.25 * i) / 6, 0.2 + (0.06 * i) / 6));
      }
      fire('pointerup', bp1);
      await wait(500);
      out.brushAdded = countStrokes() - beforeBrush;
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      await wait(500);
      out.brushAfterUndo = countStrokes() - beforeBrush;

      out.errors = window.__checkErrs || [];
      return JSON.stringify(out);
    })()`));

    check('yeni tuval penceresi açıldı', result.modalOpened === true, '');
    check('çizim editörü açıldı', result.editorOpen === true, '');
    check('belge katmanı hazır', result.layers >= 1, `${result.layers || 0} katman`);
    check('dikdörtgen seçim vuruşları seçti', result.marqueeSelected === 2, `${result.marqueeSelected || 0} seçili`);
    check('taşı / dönüştür seçimi yatay taşıdı',
      Math.abs(result.moveDx - 40) <= 3 && Math.abs(result.moveDy) <= 2,
      `dx=${result.moveDx}px dy=${result.moveDy}px`);
    check('taşımadan sonra seçim korunuyor', result.selectionAfterMove === 2, `${result.selectionAfterMove || 0} seçili`);
    check('Ctrl+Z taşımayı geri aldı',
      Math.abs(result.undoDx) <= 2 && Math.abs(result.undoDy) <= 2,
      `dx=${result.undoDx}px dy=${result.undoDy}px · tuş=${result.keySeen} · yığın ${result.undoLenBeforeMove}→${result.undoLenAfterMove}→${result.undoLenAfterKey} · doğrudan=${result.directUndoDx}`);
    check('kement seçim vuruşu seçti', result.lassoSelected >= 1 && result.lassoHasB === true,
      `${result.lassoSelected || 0} seçili · b=${result.lassoHasB}`);
    check('fırça vuruşu eklendi', result.brushAdded === 1, `${result.brushAdded || 0} vuruş`);
    check('Ctrl+Z fırça vuruşunu geri aldı', result.brushAfterUndo === 0,
      `kalan=${result.brushAfterUndo}`);
    check('sayfada çalışma zamanı hatası yok',
      Array.isArray(result.errors) && result.errors.length === 0 && errors.length === 0,
      [...(result.errors || []), ...errors].join(' | ') || '');
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
