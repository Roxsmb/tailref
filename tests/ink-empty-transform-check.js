'use strict';

/* Ctrl+T boş katman koruması + gerçek piksel taraması + imleç davranışı.

   Kapsam (kullanıcı raporları):
   • Silgi pikselleri ERİTİP katmanı boşaltınca Ctrl+T "yokluğu" SEÇMEMELİ:
     dönüşüm açılmaz, yerinde Türkçe uyarı çıkar.
   • inkCanvasAlphaRect: boyalı piksellerin en dar sınır kutusu; boşsa null.
   • Görünen içerik geri gelince Ctrl+T yine çalışır.
   • Seçim/dönüştürme araçlarında imleç hiç kaybolmaz ('default'),
     fırça aracında halka 'none' ile devam eder.

   Uygulamayı kendisi başlatır ve kapatır:
     node tests/ink-empty-transform-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9338;
const APP_PORT = 5212;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-emptytf-'));
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

      // Yeni tuval aç (şeffaf zemin: yalnızca bizim vuruşlar görünsün)
      drawBtn.click();
      await wait(260);
      out.modalOpened = !modal.hidden;
      document.getElementById('newCanvasW').value = '400';
      document.getElementById('newCanvasH').value = '300';
      document.getElementById('newCanvasName').value = 'BosT Secim Testi';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      form.requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      out.editorOpen = inkEditorIsOpen();
      if (!out.editorOpen) return JSON.stringify(out);

      const item = state.items.find(it => it.title === 'BosT Secim Testi');
      out.item = !!item;
      if (!item) return JSON.stringify(out);
      const layers = inkLayersForOwner(item.id);
      const layer = layers[layers.length - 1];
      out.layers = layers.length;

      // Uyarı yakalayıcı: showProjectNotice çağrılarını kaydet
      window.__notices = [];
      window.__origShowNotice = window.showProjectNotice;
      window.showProjectNotice = (msg, ms) => { window.__notices.push(String(msg)); };

      const rebuild = () => {
        if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(layer.id, 'mutation');
        if (typeof inkRebuildItemLayer === 'function') inkRebuildItemLayer(layer);
        if (typeof inkRerenderLayer === 'function') inkRerenderLayer(layer.id);
        inkEditorInvalidate();
      };
      const stroke = (id, tool, size, pts) => ({
        id, kind: 'stroke', tool, color: '#e05a3a',
        size, opacity: 1, hardness: 0.6, spacing: 0.05, points: pts,
      });
      const brushPts = [
        { x: 0.15, y: 0.45, p: 1 },
        { x: 0.35, y: 0.45, p: 1 },
        { x: 0.55, y: 0.45, p: 1 },
      ];
      const ctrlT = () => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 't', code: 'KeyT', ctrlKey: true, bubbles: true, cancelable: true,
        }));
        return wait(250);
      };

      // Tentatif imleç sıfırla
      inkState().selection = [];

      // 1) inkCanvasAlphaRect ünitesi: nokta → dar kutu; temizlenmiş → null
      if (typeof inkCanvasAlphaRect === 'function') {
        const c = document.createElement('canvas');
        c.width = 50; c.height = 40;
        const g = c.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(10, 5, 20, 7);
        out.unitRect = inkCanvasAlphaRect(c);
        g.clearRect(0, 0, 50, 40);
        out.unitEmpty = inkCanvasAlphaRect(c);
      } else {
        out.unitRect = 'no-fn';
      }

      // 2) Vuruş çiz → silgiyle TAMAMINI erit → katman rasterı boş
      layer.strokes = [
        stroke('sk_t1', 'brush', 10 / item.w, brushPts),
        stroke('sk_e1', 'eraser', 90 / item.w, brushPts),
        stroke('sk_e2', 'eraser', 90 / item.w, [
          { x: 0.05, y: 0.38, p: 1 }, { x: 0.65, y: 0.38, p: 1 },
          { x: 0.65, y: 0.52, p: 1 }, { x: 0.05, y: 0.52, p: 1 },
          { x: 0.05, y: 0.38, p: 1 },
        ]),
      ];
      rebuild();
      await wait(250);
      out.pixelRectAfterErase = typeof inkLayerVisiblePixelRect === 'function'
        ? inkLayerVisiblePixelRect(layer) : 'no-fn';
      out.strokesStillListed = layer.strokes.length; // vuruş listesi boşalmaz (silgi yalnız piksel eritir)

      // 3) Ctrl+T boş katmanda dönüşüm AÇMAMALI + uyarı
      inkEditorUi.freeTransform = false;
      inkState().selection = [];
      window.__notices = [];
      await ctrlT();
      out.blocked = !inkEditorUi.freeTransform;
      out.toolAfterBlocked = inkState().tool;
      out.selectionAfterBlocked = (inkState().selection || []).length;
      out.notices = window.__notices.slice();

      // 4) Görünen içerik geri gelince Ctrl+T yine çalışmalı
      layer.strokes = [stroke('sk_t1', 'brush', 10 / item.w, brushPts)];
      rebuild();
      await wait(250);
      out.pixelRectRestored = typeof inkLayerVisiblePixelRect === 'function'
        ? inkLayerVisiblePixelRect(layer) : 'no-fn';
      window.__notices = [];
      await ctrlT();
      out.opened = !!inkEditorUi.freeTransform;
      out.toolAfterOpen = inkState().tool;
      out.noticesOnOpen = window.__notices.slice();

      // 5) İmleç: seçim aracında 'default', fırçada halka ('none')
      if (typeof inkEditorSyncCursorStyle === 'function') inkEditorSyncCursorStyle();
      out.cursorTransform = inkEditorUi.canvas.style.cursor;
      inkEditorUi.freeTransform = false;
      inkSetTool('brush');
      if (typeof inkEditorSyncCursorStyle === 'function') inkEditorSyncCursorStyle();
      out.cursorBrush = inkEditorUi.canvas.style.cursor;

      if (window.__origShowNotice) window.showProjectNotice = window.__origShowNotice;
      out.errors = window.__checkErrs || [];
      return JSON.stringify(out);
    })()`));

    check('yeni tuval penceresi açıldı', result.modalOpened === true, '');
    check('çizim editörü açıldı', result.editorOpen === true, '');
    check('belge katmanı hazır', result.layers >= 1, `${result.layers || 0} katman`);
    check('inkCanvasAlphaRect nokta kutusu doğru',
      result.unitRect && result.unitRect.x === 10 && result.unitRect.y === 5
      && result.unitRect.w === 20 && result.unitRect.h === 7,
      JSON.stringify(result.unitRect));
    check('inkCanvasAlphaRect boş kanvas null döndü', result.unitEmpty === null,
      JSON.stringify(result.unitEmpty));
    check('silgi vuruş listesini boşaltmadı',
      result.strokesStillListed === 3, `${result.strokesStillListed} vuruş`);
    check('silgi sonrası görünen piksel yok (tight rect = null)',
      result.pixelRectAfterErase === null, JSON.stringify(result.pixelRectAfterErase));
    check('boş katmanda Ctrl+T dönüşüm başlatmadı', result.blocked === true,
      `tf=${result.blocked} · araç=${result.toolAfterBlocked} · seçim=${result.selectionAfterBlocked}`);
    check('boş katmanda uyarı çıktı (TR/EN)',
      Array.isArray(result.notices) && result.notices.some(n =>
        n.includes('dönüştürülecek görünür içerik yok') ||
        n.includes('No visible content to transform')),
      (result.notices || []).join(' | '));
    check('içerik geri gelince tight rect yeniden var',
      !!result.pixelRectRestored, JSON.stringify(result.pixelRectRestored));
    check('dolu katmanda Ctrl+T dönüşümü açtı', result.opened === true,
      `tf=${result.opened} · araç=${result.toolAfterOpen}`);
    check('dolu katmanda uyarı çıkmadı',
      Array.isArray(result.noticesOnOpen) && result.noticesOnOpen.length === 0,
      (result.noticesOnOpen || []).join(' | '));
    check('dönüştürme aracında imleç görünür (default)',
      result.cursorTransform === 'default', result.cursorTransform);
    check('fırça aracında halka imleci korunuyor (none)',
      result.cursorBrush === 'none', result.cursorBrush);
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
