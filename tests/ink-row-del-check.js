'use strict';

/* Kontrol: katman SATIRINDAKI Sil düğmesi (.inkLayerDel)
   1) çok katmanda: tıklanan satır katmanını siler (diğerleri kalır)
   2) son katmanda: katman kalır, vuruşlar temizlenir
   3) son katmanda boş: "Katman zaten boş" uyarısı
   4) Ctrl+Z temizliği geri alır
   5) satır düğmesi tüm satırlarda mevcut */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9341;
const APP_PORT = 5214;
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
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

async function waitForTarget(deadlineMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* daha hazır değil */ }
    await sleep(400);
  }
  throw new Error('hata ayıklama portu açılmadı');
}

const opens = async (ws) => {
  await evaluate(ws, `
    const modal = document.getElementById('newCanvasModal');
    if (typeof inkCloseTransientUi === 'function') inkCloseTransientUi();
    modal.hidden = true;
    document.getElementById('modeDrawBtn').click();
    setTimeout(() => {
      document.getElementById('newCanvasW').value = '400';
      document.getElementById('newCanvasH').value = '300';
      document.getElementById('newCanvasName').value = 'RowSilTesti';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
    }, 280);
    true;
  `);
  for (let i = 0; i < 100; i++) {
    if (await evaluate(ws, 'typeof inkEditorIsOpen === "function" && inkEditorIsOpen()')) return true;
    await sleep(120);
  }
  return false;
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-rowsil-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  const results = {};
  let ws = null;
  try {
    const page = await waitForTarget();
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      try { ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'"); if (ready) break; } catch { }
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');
    /* Uygulama varsayılan dili İngilizce; uyarı metnini Türkçe sına. */
    await evaluate(ws, "window.L10N ? window.L10N.setLang('tr') : 'no-l10n'");

    await evaluate(ws, 'window.__checkErrs = []; window.addEventListener("error", e => window.__checkErrs.push(String(e.message || e))); window.__notices = []; window.__origN = window.showProjectNotice; window.showProjectNotice = m => window.__notices.push(String(m)); true');
    results.editorOpen = await opens(ws);
    if (!results.editorOpen) throw new Error('editör açılamadı');

    // 1 · 3 katman kur: her birine ayırt edici vuruş
    await evaluate(ws, `
      (function () {
        const item = state.items.find(it => it.title === 'RowSilTesti');
        window.__it = item;
        inkDocAddLayer(); inkDocAddLayer();
        const layers = inkLayersForOwner(item.id);
        window.__ids = layers.map(l => l.id);
        layers.forEach((l, i) => {
          l.strokes = [{
            id: 'sk_r' + i, kind: 'stroke', tool: 'brush',
            color: ['#e05a3a', '#3aa0e0', '#39c463'][i],
            size: 10 / item.w, opacity: 1, hardness: 0.6, spacing: 0.05,
            points: [{ x: 0.15 + 0.05 * i, y: 0.3 + 0.08 * i, p: 1 }, { x: 0.5, y: 0.35 + 0.08 * i, p: 1 }],
          }];
          inkBumpPaintEpoch(l.id, 'mutation');
        });
        window.__ids.forEach(id => { const l = inkLayerById(id); if (typeof inkRebuildItemLayer === 'function') inkRebuildItemLayer(l); });
        inkEditorInvalidate();
        inkSyncLayersPanel();
        return true;
      })()
    `);
    await sleep(500);
    results.layersStart = await evaluate(ws, 'inkLayersForOwner(window.__it.id).length');
    results.rowBtns = await evaluate(ws, 'document.querySelectorAll(".inkLayerRow .inkLayerDel").length');

    // 2 · ortadaki satırın Sil'ine tıkla → o katman gider
    await evaluate(ws, `
      (function () {
        const row = document.querySelector('.inkLayerRow[data-layer-id="' + window.__ids[1] + '"]');
        const del = row && row.querySelector('.inkLayerDel');
        if (del) del.click();
        return true;
      })()
    `);
    await sleep(500);
    results.layersAfterMidDel = await evaluate(ws, 'inkLayersForOwner(window.__it.id).length');
    results.midIdGone = await evaluate(ws, '!inkLayersForOwner(window.__it.id).some(l => l.id === window.__ids[1])');

    // 3 · kalan diğer(++strokeslu) katmanı da satırdan sil → tek katman
    await evaluate(ws, `
      (function () {
        const other = inkLayersForOwner(window.__it.id).find(l => l.id !== window.__ids[2]);
        const row = document.querySelector('.inkLayerRow[data-layer-id="' + other.id + '"]');
        const del = row && row.querySelector('.inkLayerDel');
        if (del) del.click();
        return true;
      })()
    `);
    await sleep(500);
    results.layersDownToOne = await evaluate(ws, 'inkLayersForOwner(window.__it.id).length');

    // 4 · TEK katmanda (vuruşlu) Sil → içeriği temizlenecek, katman kalacak
    await evaluate(ws, `
      (function () {
        const live = inkLayersForOwner(window.__it.id).at(-1);
        window.__lastId = live.id;
        return true;
      })()
    `);
    results.strokesLast = await evaluate(ws, 'inkLayersForOwner(window.__it.id).at(-1).strokes.length');
    await evaluate(ws, `
      (function () {
        const row = document.querySelector('.inkLayerRow[data-layer-id="' + window.__lastId + '"]');
        const del = row && row.querySelector('.inkLayerDel');
        if (del) del.click();
        return true;
      })()
    `);
    await sleep(500);
    results.layersAfterClear = await evaluate(ws, 'inkLayersForOwner(window.__it.id).length');
    results.strokesAfterClear = await evaluate(ws, 'inkLayersForOwner(window.__it.id).at(-1).strokes.length');
    results.lastIdKept = await evaluate(ws, 'inkLayersForOwner(window.__it.id).at(-1).id === window.__lastId');
    results.notices = await evaluate(ws, 'JSON.stringify(window.__notices)');

    // 5 · boş son katmanda tekrar Sil → uyarı
    await evaluate(ws, 'window.__notices.length = 0; true');
    await evaluate(ws, `
      (function () {
        const row = document.querySelector('.inkLayerRow[data-layer-id="' + inkState().activeLayerId + '"]')
          || document.querySelector('.inkLayerRow .inkLayerDel');
        const del = row && row.querySelector('.inkLayerDel');
        if (del) del.click();
        return true;
      })()
    `);
    await sleep(400);
    results.layersAfterEmpty = await evaluate(ws, 'inkLayersForOwner(window.__it.id).length');
    results.notices2 = await evaluate(ws, 'JSON.stringify(window.__notices)');

    // 6 · Ctrl+Z temizliği geri alır
    await evaluate(ws, 'window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true })); true');
    await sleep(500);
    results.strokesAfterUndo = await evaluate(ws, 'inkLayersForOwner(window.__it.id).at(-1).strokes.length');

    results.errs = await evaluate(ws, 'JSON.stringify(window.__checkErrs)');
  } catch (e) {
    results.error = e.message;
  } finally {
    try { ws && ws.close(); } catch { }
    try { app.kill(); } catch { }
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { }
  }

  const ok = (name, cond, detail) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}  ${detail == null ? '' : '→ ' + detail}`);
  ok('3 katman kuruldu', results.layersStart === 3, `katman=${results.layersStart}`);
  ok('her satırda Sil düğmesi var', results.rowBtns >= 3, `düğme=${results.rowBtns}`);
  ok('satır Sil → orta katman gitti', results.layersAfterMidDel === 2 && results.midIdGone === true,
    `katman=${results.layersAfterMidDel} hedefGitti=${results.midIdGone}`);
  ok('satır Sil → tek katmana düştü', results.layersDownToOne === 1, `katman=${results.layersDownToOne}`);
  ok('son katmanda Sil → katman KALDI, vuruş temizlendi',
    results.layersAfterClear === 1 && results.strokesAfterClear === 0 && results.lastIdKept === true,
    `katman=${results.layersAfterClear} vuruş=${results.strokesAfterClear} aynıId=${results.lastIdKept}`);
  ok('boş katmanda Sil → "zaten boş"',
    results.layersAfterEmpty === 1 && (results.notices2 || '[]').includes('zaten boş'), results.notices2);
  ok('Ctrl+Z temizliği geri aldı', results.strokesAfterUndo > 0, `vuruş=${results.strokesAfterUndo}`);
  ok('sayfada hata yok', results.errs === '[]', results.errs);
  if (results.error) { console.log('HATA: ' + results.error); console.log(JSON.stringify(results, null, 1)); process.exit(1); }
  process.exit(0);
})();
