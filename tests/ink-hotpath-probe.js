'use strict';

/* Sıcak yol kanıt sonda:
   A) Fırça geçişinin alt bileşenlerini tek tek zamansal ayır
   B) V8 örnekleme profileri açıkken 50 ağır vuruş boyala + her vuruş için
      katman vuruş sayısını izle (vanishing-vuruş kanıtı)
   C) AsyncStorage yok — clean CDP
   Kullanım: node tests/ink-hotpath-probe.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9348;
const APP_PORT = 5238;
/* SMUDGE=1 → smudge aracıyla (worker yolu) örnek; yoksa fırça. */
const TOOL_MODE = process.env.SMUDGE ? 'smudge' : 'brush';
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

const cdp = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = 900000 + Math.floor(Math.random() * 90000);
  const onMsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (m.error) reject(new Error(method + ': ' + m.error.message));
    else resolve(m.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-hotpath-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  try {
    let page = null;
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
        if (page) break;
      } catch { /* */ }
      await sleep(400);
    }
    const ws = await new Promise((resolve, reject) => {
      const s = new WebSocket(page.webSocketDebuggerUrl);
      s.onopen = () => resolve(s);
      s.onerror = reject;
    });
    for (let i = 0; i < 40; i += 1) {
      const ok = await evaluate(ws, "typeof inkState === 'function' && typeof inkDocAddLayer === 'function'");
      if (ok) break;
      await sleep(400);
    }

    /* ---- sahne ---- */
    const setup = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const o = {};
      try { localStorage.setItem('tailref-persistence', 'auto'); } catch { /* */ }
      const pw = document.getElementById('persistenceWelcome');
      if (pw && !pw.hidden) {
        const opt = pw.querySelector('.pwOption');
        if (opt) opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const cont = document.getElementById('pwContinue');
        await wait(120);
        if (cont && !cont.disabled) cont.click();
        await wait(300);
        if (!pw.hidden) pw.hidden = true;
      }
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1400';
      document.getElementById('newCanvasName').value = 'Sıcak Yönelim';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      o.editor = inkEditorIsOpen();
      if (!o.editor) { o.fail = 1; return JSON.stringify(o); }
      const base = inkDocLayers(inkDocOwnerId() || '').length;
      for (let i = base; i < 20; i += 1) inkDocAddLayer();
      await wait(300);
      o.order = inkDocLayersTopFirst(inkDocOwnerId() || '').map(l => l.id).reverse();
      window.__order = o.order;
      window.__owner = inkDocOwnerId() || '';
      const cv = document.getElementById('inkEditorCanvas');
      const rect = cv.getBoundingClientRect();
      o.rect = { l: rect.left, t: rect.top, w: rect.width, h: rect.height };
      window.__res = { rect: o.rect };
      window.__draw = async (spec) => {
        const rr = window.__res.rect;
        const cv2 = document.getElementById('inkEditorCanvas');
        const t0 = performance.now();
        let work = 0;
        const fire = (type, x, y, press) => {
          const t = performance.now();
          cv2.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
            clientX: rr.l + x, clientY: rr.t + y, button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pressure: type === 'pointerup' ? 0 : press, tiltX: 0, tiltY: 0, twist: 0,
          }));
          work += performance.now() - t;
        };
        const X = v => v * rr.w;
        const Y = v => v * rr.h;
        fire('pointerdown', X(spec.x0), Y(spec.y0), 0.12);
        const mx = X((spec.x0 + spec.x1) / 2) + X(spec.bow || 0);
        const my = Y((spec.y0 + spec.y1) / 2) + Y((spec.bow || 0) * 0.6);
        const x1 = X(spec.x1), y1 = Y(spec.y1);
        const moves = spec.moves || 20;
        for (let i = 1; i <= moves; i += 1) {
          const t = i / moves;
          const e = t * t * (3 - 2 * t);
          const px = (1 - e) * (1 - e) * X(spec.x0) + 2 * (1 - e) * e * mx + e * e * x1;
          const py = (1 - e) * (1 - e) * Y(spec.y0) + 2 * (1 - e) * e * my + e * e * y1;
          fire('pointermove', px + (Math.random() - 0.5) * 1.8,
            py + (Math.random() - 0.5) * 1.8, 0.22 + 0.7 * Math.sin(t * Math.PI));
          if (i % 4 === 0) await new Promise(r2 => setTimeout(r2, 2));
        }
        fire('pointerup', x1, y1, 0);
        await new Promise(r2 => requestAnimationFrame(r2));
        return { work: Math.round(work * 10) / 10, wall: Math.round(performance.now() - t0) };
      };
      return JSON.stringify(o);
    })()`));
    if (!setup.editor) { console.log('HATA: editör açılmadı'); app.kill(); return; }
    console.log('sahne: ' + setup.order.length + ' katman');

    /* ---- A) fırça geçişi bileşen zamanları ---- */
    const timing = JSON.parse(await evaluate(ws, `(async () => {
      const o = {};
      const t = (k, f) => {
        const a = performance.now();
        try { f(); } catch (e) { o[k] = 'HATA:' + e.message; return; }
        o[k] = Math.round((performance.now() - a) * 10) / 10;
      };
      const brushes = (inkState().brushes || []).map(x => x.id).filter(id => !/eraser|silgi/i.test(id));
      setActiveBrush(brushes[3]);
      const bid = brushes[41];
      /* 1) tam setActiveBrush */
      t('totSetActiveBrush', () => setActiveBrush(bid));
      /* 2) alt bileşenler tek tek (fırça zaten seçili — tekrarı da ölçer) */
      t('inkSetTool', () => inkSetTool('brush', { brushId: bid }));
      t('inkPreviewBrush', () => inkPreviewBrush());
      t('inkSyncNativeBrushLibrary', () => inkSyncNativeBrushLibrary());
      t('inkNativeRenderQuickBrushes', () => inkNativeRenderQuickBrushes());
      t('inkSyncLayersPanel', () => inkSyncLayersPanel());
      t('inkWorkspaceSync', () => { if (typeof inkWorkspaceSync === 'function') inkWorkspaceSync(); });
      t('inkLayoutDock', () => inkLayoutDock());
      t('inkEditorInvalidate', () => inkEditorInvalidate());
      t('inkSyncColorWheel', () => inkSyncColorWheel(true));
      t('inkSyncBrushPanelState', () => inkSyncBrushPanelState());
      t('inkSyncColorSwatch', () => inkSyncColorSwatch());
      t('inkSyncScopeVisual', () => inkSyncScopeVisual());
      t('inkUpdateHud', () => inkUpdateHud());
      t('dpSyncToolbar', () => { if (typeof dpSyncToolbar === 'function') dpSyncToolbar(); });
      t('inkRadialTouch', () => { if (typeof inkRadialTouch === 'function') inkRadialTouch(bid); });
      t('optSync', () => { if (window.__v5OptSync) window.__v5OptSync(); });
      t('totInkSyncUI', () => inkSyncUI());
      /* GERÇEK değişim anında sarmalayıcı zamanlama: bileşenler değişen
         fırçada farklı yoldan geçiyor olabilir (tekrar = ucuz yol) */
      const wraps = [
        ['inkSetTool', inkSetTool], ['inkPreviewBrush', inkPreviewBrush],
        ['inkSyncUI', inkSyncUI], ['dpSyncToolbar', dpSyncToolbar],
        ['scheduleSave', scheduleSave], ['inkRadialTouch', inkRadialTouch],
      ];
      const wTimes = {};
      for (const [name, fn] of wraps) {
        if (typeof fn !== 'function') continue;
        window[name] = function (...args) {
          const a = performance.now();
          const r = fn.apply(this, args);
          wTimes[name] = (wTimes[name] || 0) + (performance.now() - a);
          return r;
        };
      }
      setActiveBrush(brushes[7]); /* gerçek fırça değişimi 1 */
      wTimes.total = Math.round(0);
      setActiveBrush(brushes[80]); /* gerçek fırça değişimi 2 */
      for (const [name] of wraps) { /* sarmaları geri al: orijinale dön */
        try { /* kütüphaneye zarar yok; orijinal referanslar hâlâ kapalı */
        } catch { /* */ }
      }
      o.changeCost = Object.fromEntries(Object.entries(wTimes).map(([k, v]) => [k, Math.round(v * 10) / 10]));
      /* tekrar ölçüm: 2. çağrı (cache etkisi) */
      const o2 = {};
      const t2 = (k, f) => { const a = performance.now(); try { f(); } catch (e) { o2[k] = 'HATA'; return; } o2[k] = Math.round((performance.now() - a) * 10) / 10; };
      t2('inkSyncNativeBrushLibrary_2', () => inkSyncNativeBrushLibrary());
      t2('totSetActiveBrush_2', () => setActiveBrush(brushes[3]));
      o.second = o2;
      return JSON.stringify(o);
    })()`));
    console.log('=== A) FIRÇA GEÇİŞİ BİLEŞEN ZAMANLARI (ms) ===');
    let row = '';
    for (const [k, v] of Object.entries(timing)) {
      if (k === 'second') continue;
      row += k + '=' + v + '  ';
      if (row.length > 96) { console.log(row); row = ''; }
    }
    if (row) console.log(row);
    console.log('2. çağrılar: ' + timing.second.inkSyncNativeBrushLibrary_2 + 'ms kitaplık · '
      + timing.second.totSetActiveBrush_2 + 'ms tam setActiveBrush');
    if (timing.changeCost) {
      console.log('GERÇEK 2 geçişlik sarma suyunda bileşenler (ms):');
      for (const [k, v] of Object.entries(timing.changeCost)) console.log('  ' + k + '=' + v);
    }

    /* ---- B) profiler + ağırlı vuruşlar + vanishing takip ---- */
    await cdp(ws, 'Profiler.enable', {});
    await cdp(ws, 'Profiler.setSamplingInterval', { interval: 200 });
    await cdp(ws, 'Profiler.start', {});

    /* getImageData enstrümanı: çağrı sayısı + boyut + örnek çağrı yığınları */
    const instru = await evaluate(ws, `(() => {
      window.__gid = { n: 0, bytes: 0, stacks: [], heads: {}, big: { count: 0, ms: 0, max: 0 } };
      const proto = CanvasRenderingContext2D.prototype;
      const orig = proto.getImageData;
      proto.getImageData = function (...args) {
        const w = args[2] | 0, h = args[3] | 0;
        const g = window.__gid;
        g.n += 1; g.bytes += w * h * 4;
        const t0 = performance.now();
        const result = orig.apply(this, args);
        const dt = performance.now() - t0;
        try {
          const lines = (new Error()).stack.split('\\n').slice(2, 5);
          const head = (lines[1] || lines[0] || '').replace(/^\\s*at\\s+/, '').split(' (')[0];
          const agg = g.heads[head] || (g.heads[head] = { count: 0, bytes: 0, ms: 0, dims: {} });
          agg.count += 1; agg.bytes += w * h * 4; agg.ms = (agg.ms || 0) + dt;
          const dim = w + 'x' + h;
          agg.dims[dim] = (agg.dims[dim] || 0) + 1;
          if (w * h > 300000) {
            g.big.count += 1; g.big.ms += dt; g.big.max = Math.max(g.big.max, dt);
          }
          if (g.stacks.length < 30 && w * h > 4096) {
            g.stacks.push({ n: g.n, dim: w + 'x' + h, at: lines.slice(0, 3).join(' ~ ') });
          }
        } catch { /* */ }
        return result;
      };
      return 'enstrümantasyon açık';
    })()`);
    console.log('enstrümantasyon: ' + instru);

    /* toBlob enstrümanı: sıcak olan PNG kodlama kaynağını stack ile bul */
    const blobInstru = await evaluate(ws, `(() => {
      window.__tob = { n: 0, ms: 0, stacks: [] };
      const orig = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (...args) {
        const g = window.__tob;
        const t0 = performance.now();
        orig.apply(this, args);
        g.ms += performance.now() - t0;
        g.n += 1;
        try {
          if (g.stacks.length < 24) {
            const lines = (new Error()).stack.split('\\n').slice(2, 5);
            g.stacks.push(lines.join(' ~ '));
          }
        } catch { /* */ }
      };
      /* getBoundingClientRect enstrümanı: çağrıyı yığın başına topla */
      window.__gbrn = 0, window.__gbrms = 0, window.__gbr = { heads: {} };
      const origGbr = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        const g = window;
        g.__gbrn += 1;
        const t0 = performance.now();
        const r = origGbr.apply(this, arguments);
        g.__gbrms += performance.now() - t0;
        try {
          if (g.__gbr.heads && (g.__gbrms < 9999)) {
            const line = (new Error()).stack.split('\\n')[2] || '';
            const head = line.replace(/^\\s*at\\s+/, '').split(' (')[0];
            const agg = g.__gbr.heads[head] ||
              (g.__gbr.heads[head] = { count: 0, ms: 0 });
            agg.count += 1; agg.ms += 0;
          }
        } catch { /* */ }
        return r;
      };
      return 'gBCR enstrümanı açık';
    })()`);
    console.log(blobInstru);

    /* drawImage enstrümanı: her çağrıda yalnız ucuz sayaç + boyut;
       stack örnekleme 64'te bir (drawImage sıcak yolu çarpıtmasın). */
    const diInstru = await evaluate(ws, `(() => {
      window.__di = { n: 0, px: 0, stacks: [], heads: {} };
      const proto = CanvasRenderingContext2D.prototype;
      const origDi = proto.drawImage;
      proto.drawImage = function (...args) {
        const g = window.__di;
        g.n += 1;
        try {
          const img = args[0];
          const iw = (img && (img.naturalWidth || img.videoWidth || img.width)) || 0;
          const ih = (img && (img.naturalHeight || img.videoHeight || img.height)) || 0;
          let dw = 0, dh = 0;
          if (args.length >= 9) { dw = args[7]; dh = args[8]; }
          else if (args.length === 5) { dw = args[3]; dh = args[4]; }
          else { dw = iw; dh = ih; }
          const area = (dw | 0) * (dh | 0);
          g.px += area;
          if (g.force) { g.undoHeads = g.undoHeads || {}; g.undoPx = (g.undoPx || 0) + area; }
          if (((g.n & 63) === 0 || g.force) && g.stacks.length < 160) {
            const lines = (new Error()).stack.split('\\n').slice(2, 6);
            if (((g.n & 63) === 0) || (g.stacks.length & 3) === 0) g.stacks.push(lines.join(' ~ '));
            const head = (lines[1] || lines[0] || '').replace(/^\\s*at\\s+/, '').split(' (')[0];
            g.heads[head] = (g.heads[head] || 0) + 1;
            if (g.force) g.undoHeads[head] = (g.undoHeads[head] || 0) + 1;
          }
        } catch { /* */ }
        return origDi.apply(this, args);
      };
      return 'drawImage enstrümanı açık';
    })()`);
    console.log(diInstru);

    /* undo penceresi içi işlev-başı süre toplama: undo(ms) toplamından
       hangi parçanın ne kadar yediğini ayırt eder. Yalnız cur pencer
       açıkken toplanır (cur + bekleme doldurulurken kapalı). */
    const udInstru = await evaluate(ws, `(() => {
      window.__ud = { undo: [], cur: null };
      const rec = (name, ms) => {
        const c = window.__ud.cur;
        if (c) c.parts[name] = (c.parts[name] || 0) + ms;
      };
      const wrapAll = (names) => {
        for (const name of names) {
          const f = window[name];
          if (typeof f !== 'function') continue;
          window[name] = function (...a) {
            if (window.__ud.cur) {
              const t = performance.now();
              const r = f.apply(this, a);
              rec(name, performance.now() - t);
              return r;
            }
            return f.apply(this, a);
          };
        }
      };
      wrapAll(['undo', 'inkStrokeEntry', 'inkApplyStrokeEntry', 'inkUndoApplyRaster',
        'inkEditorAfterRestore', 'inkEditorRender', 'inkEditorRebuildPreview',
        'inkEditorFrameChipPaint', 'inkSyncDom', 'inkUpdateGizmo',
        'inkEditorTileSync', 'inkLayerStoreEmit', 'scheduleSave']);
      return 'undo profili açık';
    })()`);
    console.log(udInstru);

    const paintRes = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const s = inkState();
      const owner = window.__owner;
      const layerId = window.__order[0];
      inkDocSelectLayer(layerId);
      s.size = ${TOOL_MODE === 'smudge' ? 48 : 22};
      s.color = '#f0c98d';
      s.tool = '${TOOL_MODE}';
      const o = { rows: [], vanished: [] };
      let prevIds = new Set();
      const readCount = () => {
        const rec = inkDocLayersTopFirst(owner).find(x => x.id === layerId);
        return { n: rec ? (rec.strokes || []).length : -1,
          ids: rec ? rec.strokes.map(x => x.id) : [] };
      };
      for (let k = 0; k < 50; k += 1) {
        const spec = { x0: Math.random() * 0.2, y0: 0.04 + 0.016 * k, x1: 0.95 - Math.random() * 0.2, y1: 0.05 + 0.016 * k, bow: 0.004 * (Math.random() - 0.5), moves: 30 };
        const r = await window.__draw(spec);
        const gidN = window.__gid.n;
        const now = readCount();
        /* vanishing analizi */
        if (now.n >= 0) {
          const cur = new Set(now.ids);
          for (const id of prevIds) if (!cur.has(id)) o.vanished.push({ at: k, id: id.slice(0, 14) });
          prevIds = new Set(now.ids);
        }
        o.rows.push({ k, work: r.work, wall: r.wall, doc: now.n, gid: gidN, di: window.__di.n });
      }
      /* undo penceresinde drawImage sayacı */
      const diBeforeUndo = window.__di.n;
      const uds = [];
      for (let i = 0; i < 3; i += 1) {
        window.__di.force = true;
        window.__di.undoHeads = {};
        window.__di.undoPx = 0;
        window.__ud.cur = { parts: {} };
        const t = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(res => requestAnimationFrame(res));
        const msTaken = Math.round(performance.now() - t);
        await wait(260);
        window.__di.force = false;
        /* boyama undo'dan sonraki karelerde asenkron işler; pencere
           bekleme boyunca açık kaldı — şimdi sayıları kaydet. */
        uds.push({ ms: msTaken, n: Object.values(window.__di.undoHeads || {}).reduce((a, b) => a + b, 0), heads: window.__di.undoHeads || {}, parts: window.__ud.cur.parts });
        window.__ud.cur = null;
        await wait(40);
      }
      o.undo = uds;
      o.docAfterUndo = readCount().n;
      o.diUndo = window.__di.n - diBeforeUndo;
      return JSON.stringify(o);
    })()`));
    await cdp(ws, 'Profiler.stop', {})
      .then(res => {
        const prof = res.profile;
        /* aggrege et: nodeName → selfHits */
        const agg = new Map();
        for (const n of prof.nodes) {
          const f = n.callFrame;
          if (!f || !f.functionName) continue;
          const key = f.functionName + ' @' + (f.url || '').split('/').pop() + ':' + f.lineNumber;
          agg.set(key, (agg.get(key) || 0) + (n.hitCount || 0));
        }
        const sorted = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28);
        console.log('=== C) ÖRNEKLEME PROFİLERİ · en sıcak 28 işlev ===');
        console.log('(sayaç = örnek vuruş sayısı; toplara göre ağırlıklı)');
        for (const [fn, hits] of sorted) console.log('  ' + String(hits).padStart(6) + '  ' + fn);
      })
      .catch(e => console.log('profiler hatası: ' + e.message));

    console.log('');
    console.log('=== B) 50 AĞIR VURUŞ ===');
    const hot = paintRes.rows.filter(r => r.work > 10).length;
    console.log('vuruş içinde >10ms: ' + hot + '/50 · vanishing sayısı: ' + paintRes.vanished.length);
    if (paintRes.vanished.length) console.log('vanishing kimlikleri: ' + JSON.stringify(paintRes.vanished.slice(0, 8)));
    const docSeq = paintRes.rows.map(r => r.doc);
    console.log('doc sayım dizisi: ' + docSeq.join(','));
    const gids = paintRes.rows.map(r => r.gid).map((v, i, a) => i ? v - a[i - 1] : v);
    console.log('vuruş başına getImageData: ' + gids.join(','));
    const works = paintRes.rows.map(r => r.work).sort((a, b) => a - b);
    console.log('work ort=' + Math.round(works.reduce((a, b2) => a + b2, 0) / works.length) + 'ms p50='
      + works[Math.floor(works.length * 0.5)] + ' ms p95=' + works[Math.floor(works.length * 0.95)]);
    console.log('undo(ms)=' + (paintRes.undo[0] && paintRes.undo[0].ms != null ? paintRes.undo.map(u => u.ms).join(',') : paintRes.undo.join(',')) +
      ' · undo sonrası doc=' + paintRes.docAfterUndo +
      ' · undo penceresi drawImage=' + (paintRes.undo.map(u => u.n).join(',') || (paintRes.diUndo != null ? paintRes.diUndo : '?')));
    for (const u of (paintRes.undo || []).filter(u => u.parts)) {
      console.log('undo parçası (ms=' + u.ms + ' · drawImage=' + u.n + '):');
      const entries2 = Object.entries(u.parts).map(([k, v]) => ({ k, ms: Math.round(v * 10) / 10 }))
        .sort((a, b) => b.ms - a.ms).slice(0, 8);
      for (const p of entries2) console.log('  ' + String(p.ms).padStart(7) + ' ms  ' + p.k);
      const uh = Object.entries(u.heads || {}).map(([k, v]) => ({ k, c: v })).sort((a, b) => b.c - a.c).slice(0, 4);
      if (uh.length) {
        console.log('  drawImage ağırlığı: ' + uh.map(h => h.k + '×' + h.c).join(' · '));
      }
    }
    const dis = paintRes.rows.map(r => r.di).map((v, i, a) => i ? v - a[i - 1] : v).sort((x, y) => x - y);
    if (dis.length) {
      const diFirst = paintRes.rows[0].di, diLast = paintRes.rows[paintRes.rows.length - 1].di;
      console.log('vuruş başına drawImage: min=' + dis[0] + ' p50=' + dis[Math.floor(dis.length * 0.5)] +
        ' p95=' + dis[Math.floor(dis.length * 0.95)] + ' max=' + dis[dis.length - 1] +
        ' · sayaç toplamı=' + diLast + ' (ilk ' + diFirst + ')');
    }

    /* getImageData dökümü */
    const gid = JSON.parse(await evaluate(ws, `JSON.stringify({ n: window.__gid.n, mb: Math.round(window.__gid.bytes / 1048576 * 10) / 10, stacks: window.__gid.stacks, heads: window.__gid.heads, big: window.__gid.big || { count: 0, ms: 0, max: 0 }, tob: window.__tob || { n: 0, ms: 0, stacks: [] }, gbrn: window.__gbrn, gbrms: window.__gbrms, gbr: window.__gbr })`));
    console.log('');
    console.log('=== D) getImageData İZLEDİKÇESİ ===');
    console.log('çağrı=' + gid.n + ' · okunan toplam=' + gid.mb + ' MB');
    console.log('--- yığın başına toplama (üst 10) ---');
    const heads = Object.entries(gid.heads || {})
      .map(([k, v]) => ({ k, c: v.count, mb: Math.round(v.bytes / 1048576 * 10) / 10,
        mso: Math.round(v.ms || 0),
        dims: Object.entries(v.dims).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([d, n]) => d + '×' + n).join(' ') }))
      .sort((a, b) => b.c - a.c).slice(0, 10);
    for (const h of heads) console.log('  ' + String(h.c).padStart(5) + ' kez ' + String(h.mb).padStart(6) + 'MB ' + (h.mso ? (h.mso + 'ms') : '') + '  ' + h.k + '   [' + h.dims + ']');
    console.log(' >BÜYÜK okuma (>300k px): ' + gid.big.count + ' kez · toplam ' + Math.round(gid.big.ms) + ' ms · en yavaş ' + Math.round(gid.big.max) + ' ms');
    console.log('--- ilk 8 örnek tam yığın ---');
    for (const s of (gid.stacks || []).slice(0, 8)) console.log('  #' + s.n + ' ' + s.dim + '  ←  ' + s.at);
    const tob = gid.tob || { n: 0, ms: 0, stacks: [] };
    console.log('');
    console.log('=== E) toBlob İZLEDİKÇESİ ===');
    console.log('çağrı=' + tob.n + ' · toplam ' + Math.round(tob.ms) + ' ms');
    for (const at of (tob.stacks || []).slice(0, 8)) console.log('  ←  ' + at);
    const gbr = gid.gbr || { heads: {} };
    console.log('');
    console.log('=== F) getBoundingClientRect İZLEDİKÇESİ ===');
    const gbrHeads = Object.entries(gbr.heads || {})
      .map(([k, v]) => ({ k, c: v.count, ms: Math.round(v.ms || 0) }))
      .sort((a, b) => b.c - a.c).slice(0, 10);
    console.log('çağrı=' + gid.gbrn + ' · toplam ' + Math.round(gid.gbrms || 0) + ' ms');
    for (const h of gbrHeads) console.log('  ' + String(h.c).padStart(5) + ' kez ' + (h.ms ? (h.ms + 'ms') : '') + '  ' + h.k);

    /* G) drawImage izledikcesi: toplam + yığın örnekleri */
    const di = JSON.parse(await evaluate(ws, `JSON.stringify(window.__di || { n: 0, px: 0, stacks: [], heads: {} })`));
    console.log('');
    console.log('=== G) drawImage İZLEDİKÇESİ ===');
    console.log('çağrı=' + di.n + ' · boyanan piksel≈' + (Math.round(di.px / 1048576 * 10) / 10) + ' MB-piksel (örneklenmiş yığın başına sayaç exemplar)');
    const diHeads = Object.entries(di.heads || {})
      .map(([k, v]) => ({ k, c: v }))
      .sort((a, b) => b.c - a.c).slice(0, 12);
    for (const h of diHeads) console.log('  ~' + (h.c * 64).toString().padStart(6) + ' kez  ' + h.k);
    console.log('--- örnek tam yığınlar (ilk 14) ---');
    for (const s of (di.stacks || []).slice(0, 14)) console.log('  ←  ' + s);
  } catch (e) {
    console.error('HATA:', e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
