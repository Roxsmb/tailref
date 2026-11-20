'use strict';

/* Kontrol: Sil düğmesi iki yüzü
   • çok katmanda: aktif katmanı siler (önceki davranış)
   • TEK çizim katmanı: İÇERİĞİNİ temizler (katman kalır, vuruşlar gider)
   • boş tek katmanda: "Katman zaten boş" uyarısı
   • Ctrl+Z temizliği geri alır */

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
      document.getElementById('newCanvasName').value = 'SonKatmanTesti';
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-lastlayer-'));
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

    // tek katmana vuruşlar koy
    await evaluate(ws, `
      (function () {
        const item = state.items.find(it => it.title === 'SonKatmanTesti');
        window.__it = item;
        const layers = inkLayersForOwner(item.id);
        window.__layer0 = layers[layers.length - 1];
        window.__layer0.strokes = [{
          id: 'sk_l0', kind: 'stroke', tool: 'brush', color: '#e05a3a',
          size: 10 / item.w, opacity: 1, hardness: 0.6, spacing: 0.05,
          points: [{ x: 0.2, y: 0.4, p: 1 }, { x: 0.5, y: 0.4, p: 1 }, { x: 0.7, y: 0.45, p: 1 }],
        }];
        inkBumpPaintEpoch(window.__layer0.id, 'mutation');
        inkRebuildItemLayer(window.__layer0);
        inkEditorInvalidate();
        return true;
      })()
    `);
    await sleep(300);

    results.layersStart = await evaluate(ws, 'inkLayersForOwner(window.__it.id).length');
    results.strokesStart = await evaluate(ws, 'window.__layer0.strokes.length');

    // hazır-sözillerini temizle; artık yalnız Sil davranışına ilgin
    await evaluate(ws, 'window.__notices.length = 0; true');

    // TEK katmanda Sil → içerik temizlenecek
    await evaluate(ws, '(function(){ const h = document.querySelector("#inkLayersPanel .psPanelHead"); (h && h.querySelector(".dpPanelDelete") || { click(){} }).click(); return true; })()');
    await sleep(500);
    results.layerCountAfterClear = await evaluate(ws, 'inkLayersForOwner(window.__it.id).length');
    results.strokesAfterClear = await evaluate(ws, '(inkLayersForOwner(window.__it.id).at(-1)).strokes.length');
    results.layerIdSame = await evaluate(ws, '(inkLayersForOwner(window.__it.id).at(-1)).id === window.__layer0.id');
    results.notices1 = await evaluate(ws, 'JSON.stringify(window.__notices)');

    // boş katmanda tekrar Sil → uyarı, katman azalmaz
    await evaluate(ws, 'window.__notices.length = 0; true');
    await evaluate(ws, '(function(){ const h = document.querySelector("#inkLayersPanel .psPanelHead"); (h && h.querySelector(".dpPanelDelete")).click(); return true; })()');
    await sleep(400);
    results.layerCountAfterEmptyClick = await evaluate(ws, 'inkLayersForOwner(window.__it.id).length');
    results.notices2 = await evaluate(ws, 'JSON.stringify(window.__notices)');

    // Ctrl+Z temizliği geri alır
    await evaluate(ws, 'window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true })); true');
    await sleep(500);
    const live = await evaluate(ws, '(function(){ const l = inkLayersForOwner(window.__it.id).at(-1); return l.strokes.length; })()');
    results.strokesAfterUndo = live;

    // çok katman senaryosu: ekle + Sil → katman silinir (eski davranış)
    await evaluate(ws, 'inkDocAddLayer(); true');
    await sleep(450);
    results.layersMulti = await evaluate(ws, 'inkLayersForOwner(window.__it.id).length');
    await evaluate(ws, '(function(){ const h = document.querySelector("#inkLayersPanel .psPanelHead"); (h && h.querySelector(".dpPanelDelete")).click(); return true; })()');
    await sleep(450);
    results.layersAfterDelete = await evaluate(ws, 'inkLayersForOwner(window.__it.id).length');

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
  ok('tek katman + vuruş kuruldu', results.layersStart === 1 && results.strokesStart === 1,
    `katman=${results.layersStart} vuruş=${results.strokesStart}`);
  ok('TEK katmanda Sil → katman KALDI, vuruşlar temizlendi',
    results.layerCountAfterClear === 1 && results.strokesAfterClear === 0 && results.layerIdSame === true,
    `vuruş=${results.strokesAfterClear} katmanAynı=${results.layerIdSame}`);
  ok('temizlik uyarısı çıkmadı (beşeremez)',
    results.notices1 === '[]', results.notices1);
  ok('boş katmanda Sil → "zaten boş" uyarısı',
    results.layerCountAfterEmptyClick === 1 && (results.notices2 || '[]').includes('zaten boş'),
    results.notices2);
  ok('Ctrl+Z temizliği geri aldı', results.strokesAfterUndo === 1,
    `vuruş=${results.strokesAfterUndo}`);
  ok('çok katmanda Sil katman sildi', results.layersMulti === 2 && results.layersAfterDelete === 1,
    `${results.layersMulti} → ${results.layersAfterDelete}`);
  ok('sayfada hata yok', results.errs === '[]', results.errs);
  if (results.error) { console.log('HATA: ' + results.error); process.exit(1); }
  process.exit(0);
})();
