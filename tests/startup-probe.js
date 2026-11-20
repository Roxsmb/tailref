'use strict';

/* Açılış hattı sonda:
   1) süreç başlatma → yerel sunucu + CDP hazır
   2) sayfa kaynağı (app.js) indirme/çözümleme süreleri (Resource Timing)
   3) DOMContentLoaded / load.
   4) uygulama etkileşime hazır: ilk inkState + tahta DOM'u kurulu.
   5) DOM ağırlığı + IndexedDB kayıt sayısı (geri yükleme maliyeti ipucu)
   Kullanım: node tests/startup-probe.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9350;
const APP_PORT = 5238;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (m.error) return reject(new Error(JSON.stringify(m.error)));
    if (m.result.exceptionDetails) return reject(new Error(m.result.exceptionDetails.exception?.description || 'eval'));
    resolve(m.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

(async () => {
  /* TailRef_PROBE_DIR verilirse aynı dizide yeniden çalışılır: disk
     önizleme önbelleğinin ("nbprev|") kalıcılığı bu devrede doğrulanır. */
  const userDataDir = process.env.TailRef_PROBE_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'startup-probe-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const t0 = performance.now ? process.hrtime.bigint() : 0n;
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  const anchors = { spawn: 0 };
  const stamp = k => {
    anchors[k] = Number(process.hrtime.bigint() - t0) / 1e6;
  };

  try {
    // 1) CDP + sayfa hazır oluncaya kadar
    let page = null;
    for (let i = 0; i < 120; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
        if (page) break;
      } catch { /* */ }
      await sleep(100);
    }
    stamp('cdpPage');
    if (!page) { console.log('HATA: sayfa bulunamadı'); app.kill(); return; }

    const ws = await new Promise((resolve, reject) => {
      const s = new WebSocket(page.webSocketDebuggerUrl);
      s.onopen = () => resolve(s);
      s.onerror = reject;
    });
    stamp('wsOpen');

    // 2) Navigation + Resource Timing
    const nav = JSON.parse(await evaluate(ws, `(() => {
      const n = performance.getEntriesByType('navigation')[0] || null;
      const resources = (performance.getEntriesByType('resource') || [])
        .filter(r => (r.name || '').includes('app.js') || (r.name || '').endsWith('.css'))
        .map(r => ({ dosya: (r.name || '').split('/').pop(), ms: Math.round(r.duration), boyut: r.encodedBodySize || 0 }));
      return JSON.stringify({
        ilkSunucuYanit: n ? Math.round(n.responseStart) : null,
        domContentLoaded: n ? Math.round(n.domContentLoadedEventEnd) : null,
        load: n ? Math.round(n.loadEventEnd) : null,
        kaynaklar: resources,
      });
    })()`));
    stamp('navOkundu');

    // 3) uygulama etkileşime hazır: ilk inkState + tahta satır kırmızıenciası
    const tInk = Date.now();
    let inkOk = false;
    for (let i = 0; i < 150; i += 1) {
      const ok = await evaluate(ws, "typeof inkState === 'function' && typeof inkDocLayers === 'function'").catch(() => false);
      if (ok) { inkOk = true; break; }
      await sleep(100);
    }
    stamp('inkMotor');
    const inkNum = Date.now() - tInk;

    const board = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 40; i += 1) await wait(50); /* boardun ilk karesine zaman */
      const o = {};
      o.domNodes = document.querySelectorAll('*').length;
      o.katmanKanvas = document.querySelectorAll('.inkLayerCanvas').length;
      o.tabloOgeleri = document.querySelectorAll('[data-item-id], .item').length;
      o.iconsSvg = document.querySelectorAll('svg use').length;
      try {
        const db = await new Promise((res, rej) => {
          const rq = indexedDB.open('tailref');
          rq.onsuccess = () => res(rq.result);
          rq.onerror = () => rej(rq.error);
        });
        const okunan = [];
        const adlar = Array.from(db.objectStoreNames || []);
        for (const ad of adlar) {
          await new Promise((res) => {
            const tx = db.transaction(ad, 'readonly');
            const st = tx.objectStore(ad);
            const cr = st.count();
            cr.onsuccess = () => { okunan.push(ad + '=' + cr.result); res(); };
            cr.onerror = () => res();
          });
        }
        o.idb = okunan.join(', ') || 'boş';
      } catch (e) { o.idb = 'okunamadı: ' + e.message; }
      return JSON.stringify(o);
    })()`));
    stamp('boardOkuldu');

    const ms = v => Math.round(anchors[v] || 0);
    console.log('=== AÇILIŞ AŞAMALARI (süreç başlangıcından itibaren ms) ===');
    for (const [k, v] of Object.entries(anchors)) {
      console.log('  ' + k.padEnd(14) + ': ' + String(Math.round(v)).padStart(6) + ' ms');
    }
    console.log('');
    console.log('=== SAYFA KRİTİK YOL (renderer içi ms) ===');
    console.log('  ilkSunucuYanit=' + nav.ilkSunucuYanit
      + ' · domContentLoaded=' + nav.domContentLoaded
      + ' · load=' + nav.load);
    for (const r of nav.kaynaklar) {
      console.log('  kaynak ' + r.dosya + ': ' + r.ms + ' ms, ' + r.boyut + ' bayt');
    }
    console.log('  inkMotor=' + inkOk + ' (' + inkNum + ' ms bek funnelleme)');
    console.log('');
    console.log('=== DOM & DEPO ===');
    console.log('  DOM düğümleri=' + board.domNodes
      + ' · katman kanvas=' + board.katmanKanvas
      + ' · iconsUSE=' + board.iconsSvg);
    console.log('  IndexedDB: ' + board.idb);
    const marks = await evaluate(ws, '(window.__bootMarks || []).join(" | ")').catch(() => 'okunamadı');
    const onbellek = await evaluate(ws,
      '(typeof inkPreviewBakeCache === "object" ? inkPreviewBakeCache.size : -1)').catch(() => -2);
    console.log('');
    console.log('=== RENDERER AÇILIŞ DAMGALARI ===');
    console.log((marks || '').split(' | ').map(s => '  ' + s).join('\n'));
    console.log('  bake-önbellek-öge=' + onbellek);
    const regen = await evaluate(ws, '(window.__previewRegen || 0)').catch(() => -1);
    console.log('  yeniden-boyama-sayisi=' + regen);
    const regenFrom = await evaluate(ws,
      'JSON.stringify((window.__previewRegenFrom || []).slice(0, 6), null, 1)').catch(() => '[]');
    for (const satir of JSON.parse(regenFrom || '[]')) console.log('  regen→ ' + satir.replace(/\n/g, ' '));
    const karsilastir = await evaluate(ws, `(() => {
      const s = window.__previewDiskDebug || (typeof inkPreviewDiskState !== 'undefined' ? inkPreviewDiskState : null);
      if (!s || !s.diskBlobs) return JSON.stringify({ hata: 'diskBlobs yok' });
      const ornek = Array.from(s.diskBlobs.keys()).slice(0, 2);
      const brush = (typeof inkGetBrush === 'function' && (inkGetBrush(inkState().brushId) || (inkState().brushes || [])[0])) || null;
      if (!brush) return JSON.stringify({ hata: 'brush yok', ornek });
      const info = inkPreviewBakeKey(brush, 72, 38, {});
      const komsu = Array.from(s.diskBlobs.keys())
        .filter(k => k.startsWith('nbprev|' + brush.id + '|72x38|'))
        .slice(0, 3);
      return JSON.stringify({ ornek, hesap: info.key, komsu, eslesme: s.diskBlobs.has(info.key) });
    })()`).catch(() => '{}');
    console.log('  anahtar-karsilastirma: ' + karsilastir);
  } catch (e) {
    console.error('HATA:', e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(200);
    if (!process.env.TailRef_PROBE_DIR) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
    }
  }
})();
