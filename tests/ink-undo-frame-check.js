'use strict';
/* =========================================================
   ink-undo-frame-check.js — GÖRSEL undo kapı denetimi (v2)
   ---------------------------------------------------------
   KULLANICI RAPORU: "sarı çizdim → siyah çizdim → Ctrl+Z →
   siyah sarının arkasına geçti"
   Kök neden zinciri: undo çip yolu taban çerçeveyi taşıyordu;
   silme yönünde source-over silemez. Düzeltme: undo'da tam
   reset; commit/redo'da çip.

   v2 ÖLÇÜM DERSİ (10.11): koyu damalı arka plan 'siyah'
   sayacını şişiriyordu (32267 = arka plan!). Artık:
     • yalnızca KAĞIT BÖLGESİ (fit dikdörtgeni) içinde örneklenir
     • boş tuval TEMEL sayımı düşülür (delta)
     • her aşamada PNG ekran görüntüsü alınır (gözle kanıt)

   Denetimler:
   A1 iki vuruş commit · A2 sarı görünüyor · A3 siyah görünüyor
   B1 TEK undo: siyah bant kaybolur · B2 sarı yerinde kalır
   B3 commit geri alındı · C1 undo'da frameChip yok (tam reset)
   D1 UZUN BASIŞ (6 undo): tüm vuruşlar pikselde silinir
   D2 kayıtlar tükendi · E1 REDO: son silinen (siyah) döner
   F1 katman rasterında silme artığı yok (veri temiz)

   Kullanım: node tests/ink-undo-frame-check.js
   Kapı zinciri: scripts/run-gates.js
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9352;
const APP_PORT = 5208;
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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-undo-frame-'));
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
  const shot = async name => {
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    const dir = path.join(os.tmpdir(), 'ink-undo-frame');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
    fs.writeFileSync(path.join(dir, name), Buffer.from(s.data, 'base64'));
    return path.join(dir, name);
  };
  const saveDataURL = (dataURL, name) => {
    if (!dataURL || dataURL.startsWith('hata')) return;
    try {
      const dir = path.join(os.tmpdir(), 'ink-undo-frame');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), Buffer.from(dataURL.split(',')[1], 'base64'));
    } catch { /* görsel yazılamadı — kritik değil */ }
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

    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    // Karşılama diyaloğu: taze user-data'da ilk açılışta modal açılır;
    // kapatılmazsa ekran görüntüleri modale kaplı (çizim modal arkasında
    // yine de çalışır ama görsel kanıt boşa gider).
    await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (w && !w.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
      }
      return 'karşılama kapandı';
    })()`);

    // ---- sahne kurulumu + ölçüm altyapısı (TEK eval'de) ----
    const setup = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '1600';
      document.getElementById('newCanvasH').value = '1200';
      document.getElementById('newCanvasName').value = 'Undo Çerçeve Testi';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 150 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      if (!inkEditorIsOpen()) return JSON.stringify({ fail: 'editor-open' });

      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();

      /* Komposit: ana tuval + kiremit host karoları (varsa). */
      const komposit = () => {
        const cp = document.createElement('canvas');
        cp.width = canvas.width; cp.height = canvas.height;
        const c2 = cp.getContext('2d');
        c2.setTransform(1, 0, 0, 1, 0, 0);
        c2.drawImage(canvas, 0, 0);
        const dprC = canvas.width / Math.max(1, rect.width);
        for (const host of document.querySelectorAll('[data-ink-tile-view]')) {
          for (const t of host.querySelectorAll('canvas')) {
            const left = parseFloat(t.style.left) || 0;
            const top = parseFloat(t.style.top) || 0;
            const w = parseFloat(t.style.width) || t.width;
            const h = parseFloat(t.style.height) || t.height;
            c2.drawImage(t, left * dprC, top * dprC, w * dprC, h * dprC);
          }
        }
        return cp;
      };

      /* Yalnız KAĞIT (fit dikdörtgeni) içinde örnekler — arka plan
         koyu damalı deseni sayaçları şişirmesin (v2 ölçüm dersi). */
      const sample = () => {
        const cp = komposit();
        const g = cp.getContext('2d');
        const dpr = inkEditorUi.dpr || 1;
        const f = inkEditorUi.fit;
        const x0 = Math.max(0, Math.floor(f.x * dpr));
        const y0 = Math.max(0, Math.floor(f.y * dpr));
        const w = Math.floor(f.w * dpr);
        const h = Math.floor(f.h * dpr);
        const img = g.getImageData(x0, y0, Math.min(w, cp.width - x0),
          Math.min(h, cp.height - y0)).data;
        let yellow = 0, dark = 0, darkStrip = 0, coreDark = 0;
        const strip0 = Math.floor(h * 0.24), strip1 = Math.floor(h * 0.40);
        for (let y = 0; y < h; y += 3) {
          const inStrip = y >= strip0 && y < strip1;
          for (let x = 0; x < w; x += 3) {
            const i = (y * w + x) * 4;
            if (img[i + 3] < 40) continue;
            const r = img[i], gg = img[i + 1], b = img[i + 2];
            if (r < 70 && gg < 70 && b < 90) { dark += 1; if (inStrip) darkStrip += 1; }
            else if (r > 190 && gg > 160 && b < 140) yellow += 1;
            /* ÇEKİRDEK siyah: damalı arka planın her iki karesi de
               koyu sayıldığından sıradan dark sayacı doyar (5200/5200)
               — siyah vuruş çekirdeği (12,12,16) yaln burada ayrışır. */
            if (img[i + 3] > 240 && r < 25 && gg < 25 && b < 40) coreDark += 1;
          }
        }
        return { yellow, dark, darkStrip, coreDark };
      };
      window.__sample = sample;

      /* Karem sabitlenene dek bekle (bütçeli boyamalar otursun). */
      window.__settle = async () => {
        let prev = null, stable = 0;
        for (let i = 0; i < 60 && stable < 3; i += 1) {
          await wait(110);
          const s = JSON.stringify(sample());
          if (s === prev) stable += 1; else { stable = 0; prev = s; }
        }
      };

      /*                   vuruş çizici                    */
      const draw = async (color, y0, y1) => {
        inkSetTool('brush', { brushId: 'ink-hard' });
        const ink = inkState();
        ink.size = 64; ink.opacity = 1; ink.smoothing = 0.2; ink.color = color;
        await wait(120);
        const fire = (type, x, y, press) => canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
          clientX: rect.left + fit.x + x * fit.w,
          clientY: rect.top + fit.y + y * fit.h,
          button: 0, buttons: type === 'pointerup' ? 0 : 1,
          pressure: type === 'pointerup' ? 0 : press, tiltX: 0, tiltY: 0, twist: 0,
        }));
        fire('pointerdown', 0.15, y0, 0.4);
        for (let i = 1; i <= 20; i += 1) {
          fire('pointermove', 0.15 + 0.7 * i / 20, y0 + (y1 - y0) * i / 20, 0.5);
          if (i % 5 === 0) await new Promise(r => setTimeout(r, 3));
        }
        fire('pointerup', 0.85, y1, 0);
        await new Promise(r => requestAnimationFrame(r));
      };
      window.__draw = draw;

      window.__settle && await window.__settle();
      const base = sample();           // BOŞ tuval temel sayımı
      window.__base = base;

      /* UNDO İÇ-DURUM SONDASI: capture/apply sarıcıları (hold içeriğini
         piksel olarak ölçer — "before" anlık görüntüsünde vuruş var mı?) */
      const quickStats = src => {
        try {
          const pr = document.createElement('canvas');
          pr.width = Math.min(src.width, 500);
          pr.height = Math.min(src.height, 300);
          const pg = pr.getContext('2d', { colorSpace: 'srgb' });
          pg.drawImage(src, 0, 0, pr.width, pr.height);
          const pd = pg.getImageData(0, 0, pr.width, pr.height).data;
          let dark = 0, yellow = 0;
          for (let y = 0; y < pr.height; y += 2) {
            for (let x = 0; x < pr.width; x += 2) {
              const i = (y * pr.width + x) * 4;
              if (pd[i + 3] < 40) continue;
              if (pd[i] < 70 && pd[i + 1] < 70 && pd[i + 2] < 90) dark += 1;
              else if (pd[i] > 190 && pd[i + 1] > 160 && pd[i + 2] < 140) yellow += 1;
            }
          }
          return { dark, yellow, w: src.width, h: src.height };
        } catch (e) { return { hata: String(e) }; };
      };
      window.__undoLog = [];
      try {
        const origCapBefore = inkUndoCaptureBefore;
        inkUndoCaptureBefore = function (token, layer, stroke) {
          origCapBefore.apply(this, arguments);
          try {
            const entry = inkUndoRasterEntry(token);
            const b = entry && entry.before;
            window.__undoLog.push({ t: 'capBefore', token,
              layerId: layer && layer.id,
              rect: b && b.rect,
              hold: b && b.hold ? quickStats(b.hold) : null,
              hasImage: !!(b && b.image),
              tiles: b && b.tiles ? b.tiles.length : -1,
              pending: !!(b && b.pending) });
          } catch (e) { window.__undoLog.push({ t: 'capBeforeHata', hata: String(e) }); }
        };
        const origApply = inkUndoApplyRaster;
        inkUndoApplyRaster = function (layer, token, phase) {
          const out = origApply.apply(this, arguments);
          try {
            const entry = inkUndoRasterEntry(token);
            const snap = entry && entry[phase];
            window.__undoLog.push({ t: 'apply', phase, ok: out,
              layerId: layer.id, strokes: (layer.strokes || []).length,
              rect: snap && snap.rect,
              hold: snap && snap.hold ? quickStats(snap.hold) : null,
              hasImage: !!(snap && snap.image),
              tiles: snap && snap.tiles ? snap.tiles.length : -1 });
          } catch (e) { window.__undoLog.push({ t: 'applyHata', hata: String(e) }); }
          return out;
        };
      } catch (e) { window.__undoLog = [{ hata: 'patch başarısız: ' + String(e) }]; }

      await draw('#ffe066', 0.60, 0.72);   // SARI (altta)
      await window.__settle();
      await draw('#0c0c10', 0.26, 0.38);   // SİYAH (üstte)
      await window.__settle();

      const stats = sample();
      const delta = { yellow: stats.yellow - base.yellow,
        dark: stats.dark - base.dark,
        darkStrip: stats.darkStrip - base.darkStrip,
        coreDark: stats.coreDark - base.coreDark };
      const owner = inkDocOwnerId() || '';
      const layer0 = inkDocLayersTopFirst(owner)[0];
      /* katman rasterı artığını da ölç (F1 için): karartıklar */
      const layerInfo = (inkDocLayersTopFirst(owner) || []).map(L => {
        const src = inkRuntime.itemCanvases.get(L.id);
        if (!src) return { id: L.id, strokes: (L.strokes || []).length, dark: -2 };
        const probe = document.createElement('canvas');
        probe.width = src.width; probe.height = src.height;
        const pg = probe.getContext('2d');
        pg.drawImage(src, 0, 0);
        const pd = pg.getImageData(0, 0, probe.width, probe.height).data;
        let dark = 0, yellow = 0;
        for (let y = 0; y < probe.height; y += 3) {
          for (let x = 0; x < probe.width; x += 3) {
            const i = (y * probe.width + x) * 4;
            if (pd[i + 3] < 40) continue;
            if (pd[i] < 70 && pd[i + 1] < 70 && pd[i + 2] < 90) dark += 1;
            else if (pd[i] > 190 && pd[i + 1] > 160 && pd[i + 2] < 140) yellow += 1;
          }
        }
        return { id: L.id, strokes: (L.strokes || []).length, dark, yellow };
      });
      return JSON.stringify({ commits: (layer0.strokes || []).length,
        undoStack: undoStack.length, base, stats, delta, layerInfo,
        stripData: (() => {
          try {
            const dpr = inkEditorUi.dpr || 1;
            const f = inkEditorUi.fit;
            const cp = komposit();
            const crop = document.createElement('canvas');
            const sh = Math.floor(f.h * dpr);
            const y0 = Math.floor(f.y * dpr) + Math.floor(sh * 0.20);
            const hh = Math.floor(sh * 0.24);
            crop.width = 900;
            crop.height = Math.max(1, Math.round(900 * hh / Math.floor(f.w * dpr)));
            crop.getContext('2d').drawImage(cp,
              Math.floor(f.x * dpr), y0,
              Math.floor(f.w * dpr), hh,
              0, 0, crop.width, crop.height);
            return crop.toDataURL('image/png');
          } catch (e) { return 'hata: ' + e; }
        })(),
        fitProbe: { f: inkEditorUi.fit, dpr: inkEditorUi.dpr,
          cw: canvas.width, ch: canvas.height, rect: { l: rect.left, t: rect.top, w: rect.width, h: rect.height } },
        paperData: (() => {
          try {
            const dpr = inkEditorUi.dpr || 1;
            const f = inkEditorUi.fit;
            const cp = komposit();
            const crop = document.createElement('canvas');
            crop.width = 800;
            crop.height = Math.max(1, Math.round(800 * f.h / f.w));
            const cg = crop.getContext('2d');
            cg.drawImage(cp,
              Math.floor(f.x * dpr), Math.floor(f.y * dpr),
              Math.floor(f.w * dpr), Math.floor(f.h * dpr),
              0, 0, crop.width, crop.height);
            return crop.toDataURL('image/png');
          } catch (e) { return 'hata: ' + e; }
        })() });
    })()`));
    if (setup.fail) throw new Error('sahne: ' + setup.fail);
    console.log(`TEMEL: boşTuval dark=${setup.base.dark} yellow=${setup.base.yellow}`);
    console.log(`KURULUM: darkStrip=${setup.stats.darkStrip} (+${setup.delta.darkStrip}) yellow=${setup.stats.yellow} (+${setup.delta.yellow})`);
    await shot('a_setup.png');
    saveDataURL(setup.paperData, 'a_setup_paper.png');
    saveDataURL(setup.stripData, 'a_setup_strip.png');
    console.log('FIT: ' + JSON.stringify(setup.fitProbe));
    check('A1 iki vuruş commit edildi', setup.commits === 2, 'commits=' + setup.commits);
    check('A2 sarı bant görünüyor (delta)', setup.delta.yellow > 150,
      'sarı delta=' + setup.delta.yellow);
    check('A3 siyah bant çekirdeği görünüyor', setup.delta.coreDark > 40,
      'çekirdek siyah delta=' + setup.delta.coreDark);

    // ---- denetim B/C: TEK undo (Ctrl+Z) ----
    const after1b = JSON.parse(await evaluate(ws, `(async () => {
      await window.__settle();
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      // kareler sabitleşene kadar bekle (silme boyaması otursun)
      await window.__settle();
      const base = window.__base;
      const stats = window.__sample();
      const delta = { yellow: stats.yellow - base.yellow,
        dark: stats.dark - base.dark,
        darkStrip: stats.darkStrip - base.darkStrip,
        coreDark: stats.coreDark - base.coreDark };
      const owner = inkDocOwnerId() || '';
      const layer0 = inkDocLayersTopFirst(owner)[0];
      const layerInfo = (inkDocLayersTopFirst(owner) || []).map(L => {
        const src = inkRuntime.itemCanvases.get(L.id);
        if (!src) return { id: L.id, strokes: (L.strokes || []).length, dark: -2 };
        const probe = document.createElement('canvas');
        probe.width = src.width; probe.height = src.height;
        const pg = probe.getContext('2d');
        pg.drawImage(src, 0, 0);
        const pd = pg.getImageData(0, 0, probe.width, probe.height).data;
        let dark = 0, yellow = 0;
        for (let y = 0; y < probe.height; y += 3) {
          for (let x = 0; x < probe.width; x += 3) {
            const i = (y * probe.width + x) * 4;
            if (pd[i + 3] < 40) continue;
            if (pd[i] < 70 && pd[i + 1] < 70 && pd[i + 2] < 90) dark += 1;
            else if (pd[i] > 190 && pd[i + 1] > 160 && pd[i + 2] < 140) yellow += 1;
          }
        }
        return { id: L.id, strokes: (L.strokes || []).length, dark, yellow };
      });
      return JSON.stringify({ commits: layer0 ? (layer0.strokes || []).length : -1,
        stats, delta, layerInfo,
        undoProbe: (() => {
          try {
            const lr = inkRuntime.dirtyLayers;
            const kind = layerInfo.map(l => l.id);
            const probe0 = undoStack.length ? undoStack[undoStack.length - 1] : 'bos';
            const isDelta = probe0.includes('INK_UNDO_STROKE_KEY');
            const rasterStats = (typeof inkUndoRaster !== 'undefined') ?
              JSON.parse(JSON.stringify(inkUndoRaster.stats || {})) : null;
            const entries = (typeof inkUndoRaster !== 'undefined' && inkUndoRaster.entries) ?
              inkUndoRaster.entries.size : -1;
            const cLayer = inkLayerById(kind[0]);
            return {
              lastUndoEntryDelta: isDelta,
              lastUndoEntryHead: String(probe0).slice(0, 60),
              rasterStats, entries,
              undoLog: (window.__undoLog || []).slice(-6),
              layerKind: cLayer ? cLayer.kind : 'yok',
              dirtyHas: !!(lr && lr.has && kind[0] && lr.has(kind[0])),
              rerenderType: typeof inkRerenderLayer,
              flushType: typeof inkFlushDirtyLayers,
              nativeHost: typeof inkNativeCanvas,
            };
          } catch (e) { return { hata: String(e) }; }
        })(),
        paperData: (() => {
          try {
            const dpr = inkEditorUi.dpr || 1;
            const f = inkEditorUi.fit;
            const cvs = document.getElementById('inkEditorCanvas');
            const dprC = cvs.width / Math.max(1, cvs.getBoundingClientRect().width);
            const tiles = [];
            for (const host of document.querySelectorAll('[data-ink-tile-view]')) {
              for (const t of host.querySelectorAll('canvas')) tiles.push(t);
            }
            const komp = document.createElement('canvas');
            komp.width = cvs.width; komp.height = cvs.height;
            const kg = komp.getContext('2d');
            kg.drawImage(cvs, 0, 0);
            for (const t of tiles) {
              const left = parseFloat(t.style.left) || 0;
              const top = parseFloat(t.style.top) || 0;
              kg.drawImage(t, left * dprC, top * dprC,
                (parseFloat(t.style.width) || t.width) * dprC,
                (parseFloat(t.style.height) || t.height) * dprC);
            }
            const crop = document.createElement('canvas');
            crop.width = 800;
            crop.height = Math.max(1, Math.round(800 * f.h / f.w));
            const cg = crop.getContext('2d');
            cg.drawImage(komp,
              Math.floor(f.x * dpr), Math.floor(f.y * dpr),
              Math.floor(f.w * dpr), Math.floor(f.h * dpr),
              0, 0, crop.width, crop.height);
            return crop.toDataURL('image/png');
          } catch (e) { return 'hata: ' + e; }
        })(),
        layerData: (() => {
          try {
            const owner = inkDocOwnerId() || '';
            const L0 = inkDocLayersTopFirst(owner)[0];
            const src = inkRuntime.itemCanvases.get(L0.id);
            if (!src) return null;
            const thumb = document.createElement('canvas');
            thumb.width = 800;
            thumb.height = Math.max(1, Math.round(800 * src.height / src.width));
            thumb.getContext('2d').drawImage(src, 0, 0, thumb.width, thumb.height);
            return thumb.toDataURL('image/png');
          } catch (e) { return 'hata: ' + e; }
        })(),
        frameChip: inkEditorUi.frameChip ? inkEditorUi.frameChip : null });
    })()`));
    console.log(`UNDO-1: çekirdekSiyah delta=${after1b.delta.coreDark} · yellow delta=${after1b.delta.yellow} · frameChip=${JSON.stringify(after1b.frameChip)}`);
    console.log('UNDO-PATLAMA: ' + JSON.stringify(after1b.undoProbe));
    await shot('b_after_undo.png');
    saveDataURL(after1b.paperData, 'b_after_undo_paper.png');
    saveDataURL(after1b.layerData, 'b_after_undo_layer.png');
    check('B1 siyah bant kayboldu (çip hayaleti yasak)',
      after1b.delta.coreDark < Math.max(12, setup.delta.coreDark * 0.06) &&
        after1b.delta.yellow > setup.delta.yellow * 0.9,
      `çekirdek siyah delta ${setup.delta.coreDark} → ${after1b.delta.coreDark}`);
    check('B2 sarı bant yerinde', after1b.delta.yellow > setup.delta.yellow * 0.9,
      `sarı delta ${setup.delta.yellow} → ${after1b.delta.yellow}`);
    check('B3 commit geri alındı', after1b.commits === 1, 'commits=' + after1b.commits);
    check('C1 undo için frameChip kullanılmadı (yapısal reset)',
      after1b.frameChip === null, 'frameChip=' + JSON.stringify(after1b.frameChip));
    check('F1 katman rasterında silme artığı yok (veri temiz)',
      after1b.layerInfo.every(l => l.dark < 30),
      JSON.stringify(after1b.layerInfo));

    // ---- denetim D: uzun basış (kayıt tükene dek udp) ----
    const afterHold = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      // yığında kalan tüm kayıtları boşalt (üst sınır 10)
      for (let i = 0; i < 10 && i < undoStack.length; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(70);
      }
      await window.__settle();
      const base = window.__base;
      const stats = window.__sample();
      const delta = { yellow: stats.yellow - base.yellow,
        dark: stats.dark - base.dark,
        darkStrip: stats.darkStrip - base.darkStrip,
        coreDark: stats.coreDark - base.coreDark };
      const owner = inkDocOwnerId() || '';
      const layer0 = inkDocLayersTopFirst(owner)[0];
      return JSON.stringify({ commits: layer0 ? (layer0.strokes || []).length : -1,
        stats, delta,
        frameChip: inkEditorUi.frameChip ? inkEditorUi.frameChip : null });
    })()`));
    console.log(`UNDO-TÜM: çekirdekSiyah delta=${afterHold.delta.coreDark} yellow delta=${afterHold.delta.yellow}`);
    await shot('c_after_hold.png');
    check('D1 uzun basış: tüm vuruşlar pikselde silindi',
      afterHold.delta.coreDark <= 12 && afterHold.delta.yellow <= 25,
      `sarı delta=${afterHold.delta.yellow} çekirdek siyah delta=${afterHold.delta.coreDark}`);
    check('D2 uzun basış: kayıtlar tükendi',
      afterHold.commits === 0 && afterHold.frameChip === null,
      'commits=' + afterHold.commits);

    // ---- denetim E: redo geri getirir (son silinen = siyah) ----
    const afterRedo = JSON.parse(await evaluate(ws, `(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
      await window.__settle();
      const base = window.__base;
      const stats = window.__sample();
      const delta = { yellow: stats.yellow - base.yellow,
        dark: stats.dark - base.dark,
        coreDark: stats.coreDark - base.coreDark };
      const owner = inkDocOwnerId() || '';
      const layer0 = inkDocLayersTopFirst(owner)[0];
      return JSON.stringify({ commits: layer0 ? (layer0.strokes || []).length : -1,
        stats, delta });
    })()`));
    console.log(`REDO: yellow delta=${afterRedo.delta.yellow} · çekirdekSiyah=${afterRedo.delta.coreDark}`);
    await shot('d_after_redo.png');
    check('E1 redo son geri alınan vuruşu (sarı) geri getirdi',
      afterRedo.commits === 1 && afterRedo.delta.yellow > setup.delta.yellow * 0.8,
      `commits=${afterRedo.commits} sarı delta=${afterRedo.delta.yellow}`);
    check('E2 redo sonrası siyah vuruş geri gelmedi (doğru sıra)',
      afterRedo.delta.coreDark <= 12,
      `çekirdek siyah delta=${afterRedo.delta.coreDark}`);

    if (errors.length) check('Z0 çalışma zamanı hatası yok', false, errors.slice(0, 3).join(' | '));
    else check('Z0 çalışma zamanı hatası yok', true);

    console.log(`\\nSONUÇ: ${pass} OK · ${fail} FAIL`);
    console.log('GÖRSELLER: ' + path.join(os.tmpdir(), 'ink-undo-frame'));
    try { app.kill(); } catch { /* */ }
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('DENETİM HATASI: ' + e);
    try { app.kill(); } catch { /* */ }
    process.exit(3);
  }
})();
