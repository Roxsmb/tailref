'use strict';
/* =========================================================
   tile-stale-check.js — karo bayat/parça-kayma zaman serisi (probe)
   ---------------------------------------------------------
   Kullanıcı raporu: vuruş bırakışında bazı karolar bozuk çıkıyor
   (dikdörtgen blok kesikler + 2-4 px kayma); zoom ya da yakın
   çizim düzeltiyor. Bu probe her karo baytını bağımsız referans
   kompozit ile kıyaslar: vuruş boyunca + bırakış sonrası 1.5 sn
   örneklemede fark hangi anda doğar, kaç örneklemede silinir.
   KOŞUMLAR: yerel dpr + CDP taklidi 1.25 ve 1.5 (kullanıcı
   Windows ölçek farkı senaryosu — markDirtyRect dpr şüphesi).
   Kullanım: node tests/tile-stale-check.js   (kapı DEĞİL)
   NOT: sentetik pointerType=pen — süreler SÖZDE-SÜRETTİR.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9371;   // 9347 Electron bind erişim engeli yedi (Hyper-V rezervi) → 9371
const APP_PORT = 5215;
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
    const v = msg.result.result.value;
    resolve(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

const cdp = (ws, method, params) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    resolve(msg);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params: params || {} }));
});

async function waitForTarget(deadlineMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz değil */ }
    await sleep(400);
  }
  throw new Error('debug portu açılmadı (9371)');
}
function connect(page) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}
async function hazirla(ws) {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  const dk = Date.now() + 60000;
  let ready = false;
  while (Date.now() < dk) {
    ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('renderer hazır olmadı');
  let kapandi = false;
  for (let i = 0; i < 60 && !kapandi; i += 1) {
    kapandi = await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (!w || w.hidden) return true;
      if (!document.querySelector('.pwOption.is-selected')) {
        const opt = document.querySelector('.pwOption[data-mode="auto"]');
        if (opt) opt.click();
      }
      const btn = document.getElementById('pwContinue');
      if (btn && !btn.disabled) btn.click();
      return !!w.hidden;
    })()`);
    if (!kapandi) await sleep(500);
  }
}

/* ---- page-side yardımcılar (window.__tsc içine asılır) ---- */
const KURULUM = `(() => {
  const ui = inkEditorUi;
  const refTile = (t) => {
    const dpr = ui.dpr || 1;
    const f2 = ui.fit;
    const off = ui.baseOffset || { x: 0, y: 0 };
    const dev = t.dev;
    const ref = document.createElement('canvas');
    ref.width = dev; ref.height = dev;
    const rctx = ref.getContext('2d', { colorSpace: 'srgb' });
    const bx = Math.round(t.cssX * dpr), by = Math.round(t.cssY * dpr);
    rctx.setTransform(1, 0, 0, 1, -bx, -by);
    rctx.drawImage(ui.baseCanvas, off.x, off.y);
    rctx.setTransform(dpr, 0, 0, dpr, -bx, -by);
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = 'medium';
    const layers2 = inkLayersForOwner(ui.itemId);
    for (const layer of layers2) {
      if (!layer.visible || layer.opacity <= 0.001) continue;
      const src = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
      if (!src) continue;
      rctx.save();
      rctx.globalAlpha = clamp(layer.opacity, 0, 1);
      rctx.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
      const drawSrc = inkEditorScaledSource(layer, src);
      rctx.drawImage(drawSrc, f2.x, f2.y, f2.w, f2.h);
      rctx.restore();
    }
    rctx.strokeStyle = 'rgba(255,255,255,.2)';
    rctx.lineWidth = 1;
    rctx.strokeRect(f2.x + 0.5, f2.y + 0.5, Math.max(0, f2.w - 1), Math.max(0, f2.h - 1));
    return rctx.getImageData(0, 0, dev, dev).data;
  };
  /* karo farkları: [[karoKey, farkPx, maxD, kutu], ...]; kutu =
     karo-içi cihaz-px kara kutu — blok kaymaları bunun boyutuyla
     yorumlanır */
  const karolar = (istatistik) => {
    const tv = ui.tileView;
    if (!tv) return null;
    const out = [];
    for (const [k, t] of tv.tiles) {
      if (!t.canvas || !t.ctx) continue;
      const dev = t.dev;
      const a = t.ctx.getImageData(0, 0, dev, dev).data;
      const b = refTile(t);
      let fark = 0, maxD = 0;
      let fMinX = dev, fMinY = dev, fMaxX = -1, fMaxY = -1;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) +
          Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
        if (d > 8) {
          fark++;
          if (d > maxD) maxD = d;
          const px = (i >> 2) % dev, py = (i >> 2) / dev | 0;
          if (px < fMinX) fMinX = px;
          if (py < fMinY) fMinY = py;
          if (px > fMaxX) fMaxX = px;
          if (py > fMaxY) fMaxY = py;
        }
      }
      out.push(istatistik ? [k, fark, maxD, [fMinX, fMinY, fMaxX, fMaxY]] : [k, fark]);
    }
    return out;
  };
  /* probe ölçüm penceresi: defter sıfırlamalarını durdur (yalnız
     probe süresi; uygulama mantığına dokunulmaz) */
  let keepTv = false;
  const svim = (tv) => {
    if (!tv || tv.__tscKeepHooked) return;
    tv.__tscKeepHooked = true;
    tv.__tscDispose = tv.disposeAll.bind(tv);
    tv.disposeAll = () => { if (!keepTv) tv.__tscDispose(); };
  };
  const tut = (star) => { keepTv = !!star; svim(ui.tileView); };
  /* görsel kanıt: [karoda görünen | referans | fark-maskesi] montajı
     — arıza 'önizleme kalıntısı' mı 'blok kayması' mı, gözle görünür */
  const montaj = (t) => {
    const dev = t.dev;
    const dpr2 = ui.dpr || 1;
    const f2 = ui.fit;
    const off = ui.baseOffset || { x: 0, y: 0 };
    const refc = document.createElement('canvas');
    refc.width = dev; refc.height = dev;
    const rctx2 = refc.getContext('2d', { colorSpace: 'srgb' });
    const bx2 = Math.round(t.cssX * dpr2), by2 = Math.round(t.cssY * dpr2);
    rctx2.setTransform(1, 0, 0, 1, -bx2, -by2);
    rctx2.drawImage(ui.baseCanvas, off.x, off.y);
    rctx2.setTransform(dpr2, 0, 0, dpr2, -bx2, -by2);
    rctx2.imageSmoothingEnabled = true;
    rctx2.imageSmoothingQuality = 'medium';
    const layers2 = inkLayersForOwner(ui.itemId);
    for (const layer of layers2) {
      if (!layer.visible || layer.opacity <= 0.001) continue;
      const src = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
      if (!src) continue;
      rctx2.save();
      rctx2.globalAlpha = clamp(layer.opacity, 0, 1);
      rctx2.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
      const drawSrc = inkEditorScaledSource(layer, src);
      rctx2.drawImage(drawSrc, f2.x, f2.y, f2.w, f2.h);
      rctx2.restore();
    }
    const gorunen = t.ctx.getImageData(0, 0, dev, dev).data;
    const beklenen = rctx2.getImageData(0, 0, dev, dev).data;
    const harec = document.createElement('canvas');
    harec.width = dev; harec.height = dev;
    const hctx = harec.getContext('2d');
    hctx.fillStyle = '#ffffff';
    hctx.fillRect(0, 0, dev, dev);
    const hs = hctx.getImageData(0, 0, dev, dev);
    let farkN = 0;
    for (let i = 0; i < gorunen.length; i += 4) {
      const d2 = Math.abs(gorunen[i] - beklenen[i]) + Math.abs(gorunen[i + 1] - beklenen[i + 1]) +
        Math.abs(gorunen[i + 2] - beklenen[i + 2]) + Math.abs(gorunen[i + 3] - beklenen[i + 3]);
      if (d2 > 8) {
        farkN++;
        hs.data[i] = 220; hs.data[i + 1] = 0; hs.data[i + 2] = 0; hs.data[i + 3] = 255;
      }
    }
    hctx.putImageData(hs, 0, 0);
    const out = document.createElement('canvas');
    const bosluk = 14;
    out.width = dev * 3 + bosluk * 2;
    out.height = dev + 22;
    const o = out.getContext('2d');
    o.fillStyle = '#ffffff';
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(t.canvas, 0, 22);
    o.drawImage(refc, dev + bosluk, 22);
    o.drawImage(harec, (dev + bosluk) * 2, 22);
    o.fillStyle = '#111111';
    o.font = '13px sans-serif';
    o.fillText('karo ' + (t.tx + ',' + t.ty) + ' gorunen fark=' + farkN + ' px', 6, 15);
    o.fillText('referans (dogrusu buydu)', dev + bosluk + 6, 15);
    o.fillText('fark maskesi (kirmizi=bozuk)', (dev + bosluk) * 2 + 6, 15);
    return out.toDataURL('image/png');
  };
  /* sayac muhasebesi: markDirtyRect + painter kesimleri asılır */
  let tv = ui.tileView;
  if (!tv) { try { tv = inkEditorTileView(); } catch (e3) { /* sessiz */ } }
  const sayaclar = { md: 0, mdSon: null, pTrue: 0, pFalse: 0 };
  if (tv && !tv.__tscWrapped) {
    tv.__tscWrapped = true;
  const origMd = tv.markDirtyRect.bind(tv);
  tv.markDirtyRect = (x, y, w, h) => {
    const n = origMd(x, y, w, h);
    sayaclar.md++;
    if (n > 0) {
      sayaclar.mdSon = [x, y, w, h, n];
      (sayaclar.log || (sayaclar.log = []));
      if (sayaclar.log.length < 40) sayaclar.log.push([Math.round(x), Math.round(y), Math.round(w), Math.round(h), n]);
    }
    return n;
  };
  const origP = tv.painter;
  tv.painter = (t) => {
    const ok = origP ? origP(t) : false;
    if (ok) sayaclar.pTrue++; else sayaclar.pFalse++;
    return ok;
  };
  }
  window.__tsc = { refTile, karolar, sayaclar, tut, montaj };
  return true;
})()`;

/* her koşum için aynı vuruş dizilimi */
async function kosum(dprTaklid) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-tstale-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    if (dprTaklid) {
      await cdp(ws, 'Emulation.setDeviceMetricsOverride',
        { width: 1280, height: 900, deviceScaleFactor: dprTaklid, mobile: false });
      await sleep(600);
    }
    await hazirla(ws);

    /* A: editörü aç, karo ızgarayı zorla */
    await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '2600';
      document.getElementById('newCanvasH').value = '1700';
      document.getElementById('newCanvasName').value = 'TStale' + ${dprTaklid ? Math.round(dprTaklid * 100) : 100};
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 200 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      const ui = inkEditorUi;
      ui.tileViewOn = true;
      try { localStorage.setItem('tailref-tile-size', '256'); } catch (e2) { /* sessiz */ }
      inkEditorInvalidate();
      await wait(300);
      if (!ui.tileView) { try { inkEditorTileView(); } catch (e2) { /* sessiz */ } }
      return { acik: inkEditorIsOpen(), tileBagli: !!ui.tileView };
    })()`);
    await evaluate(ws, KURULUM);

    /* B: senaryo koşumu — her senaryo sonrası settle + at-rest parite */
    const seri = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ui = inkEditorUi;
      const tsc = window.__tsc;
      const canvas = document.getElementById('inkEditorCanvas');
      const fire = (type, x, y, press, pid, but0) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: pid || 42, pointerType: 'pen',
        clientX: rect.left + inkEditorUi.fit.x + x * inkEditorUi.fit.w,
        clientY: rect.top + inkEditorUi.fit.y + y * inkEditorUi.fit.h,
        button: but0 || 0, buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : press }));
      const ciz = async (x0, y0, x1, y1, adim, pid, beklex) => {
        await wait(beklex || 24);
        fire('pointerdown', x0, y0, 0.4, pid);
        for (let k = 1; k <= adim; k += 1) {
          fire('pointermove', x0 + (x1 - x0) * k / adim, y0 + (y1 - y0) * k / adim, 0.5, pid);
          await wait(6);
        }
        fire('pointerup', x1, y1, 0, pid);
      };
      const coklu = async (n, x0f, y0f, dx, dy) => {
        for (let i = 0; i < n; i += 1) {
          await ciz(x0f + (i % 4) * 0.05, y0f + (i % 3) * 0.06,
            x0f + (i % 4) * 0.05 + dx, y0f + (i % 3) * 0.06 + dy, 18, 44 + i);
        }
      };
      const zoomla = (dn, x, y) => {
        const rect2 = canvas.getBoundingClientRect();
        for (let i = 0; i < dn; i += 1) {
          canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
            clientX: rect2.left + rect2.width * (x || 0.5), clientY: rect2.top + rect2.height * (y || 0.5),
            deltaY: dn < 0 ? -120 : 120, ctrlKey: true }));
        }
      };
      const panla = (dx, dy) => {
        const rect2 = canvas.getBoundingClientRect();
        const px = rect2.left + rect2.width * 0.5, py = rect2.top + rect2.height * 0.5;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
          pointerId: 91, pointerType: 'mouse', button: 1, buttons: 4, clientX: px, clientY: py }));
        for (let k = 1; k <= 6; k += 1) {
          canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true,
            pointerId: 91, pointerType: 'mouse', button: 1, buttons: 4,
            clientX: px + dx * k / 6, clientY: py + dy * k / 6 }));
        }
        canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
          pointerId: 91, pointerType: 'mouse', button: 1, buttons: 4, clientX: px + dx, clientY: py + dy }));
      };
      const ölçeKur = () => {
        inkSetTool('brush', { brushId: 'ink-hard' });
        const ink = inkState();
        ink.activeLayerId = ink.layers.filter(l => l.kind === 'attached')[0].id;
        ink.size = 90; ink.opacity = 1; ink.smoothing = 0.2; ink.color = '#101010';
      };
      /* settle: bake/live/dirty ergimiş + 600 ms boş nefes */
      /* settle: bake/live/dirty ergimiş; İLK yakınsama anında parite
         karesi YIKILIP saklanır — idampeter karelerde defter
         topyekûn sıfırlandığından (ui.tileView.disposeAll) son gelen
         örnekte karo defteri boşdor çıkabilir (boş teselli önlenir) */
      const settle = async (ceiling) => {
        const t0 = Date.now();
        let stash = null;
        for (let i = 0; i < 500; i += 1) {
          const tv = ui.tileView;
          const temiz = !ui.tvBakeLeft && !(ui.tvLive && ui.tvLive.size) &&
            tv && tv.dirty && tv.dirty.size === 0;
          if (temiz && !stash && tv.tiles.size) stash = tsc.karolar(true);
          if (temiz && stash && Date.now() - t0 > 600) break;
          if (Date.now() - t0 > ceiling) break;
          await wait(20);
        }
        return stash;
      };
      const parite = (istatistik) => {
        const d = tsc.karolar(istatistik);
        return d ? d.filter(x => x[1] > 0) : null;
      };
      const coz = (stash) => {
        if (!stash) return null;
        const bozuk = stash.filter(x => x[1] > 0).slice(0, 10).map(x => [x[0], x[1], x[2], x[3]]);
        return { top: stash.length, bozuk };
      };
      const rect = canvas.getBoundingClientRect();
      const md0 = tsc.sayaclar.md;
      const sen = [];
      ölçeKur();
      /* ölçüm penceresi: defter sıfırlamaları tutulur; karo içerikleri
         yakınsamadan sonra da okunabilir kalır (yalnız probe süresi) */
      tsc.tut(true);

      /* S1: 12 hızlı zigzag vuruş */
      {
        const S1t = Date.now();
        await coklu(12, 0.08, 0.2, 0.16, 0.22);
        const S1s = await settle(8000);
        sen.push({ ad: 'S1-coklu12', ms: Math.round(Date.now() - S1t), bozuk: coz(S1s) });
      }
      /* S2: vuruş ortasında zoom fırtınası */
      {
        const v1 = ciz(0.15, 0.3, 0.7, 0.62, 46, 70);
        await wait(150);
        zoomla(6, 0.6, 0.4);
        await wait(90);
        zoomla(-3, 0.4, 0.6);
        await v1;
        const S2s = await settle(9000);
        sen.push({ ad: 'S2-vurusluZoom', bozuk: coz(S2s) });
      }
      /* S3: vuruş ortasında pan; farklı fit */
      {
        const v2 = ciz(0.2, 0.25, 0.62, 0.7, 46, 71);
        await wait(140);
        panla(90, -60);
        await wait(100);
        panla(-70, 40);
        await v2;
        const S3s = await settle(9000);
        sen.push({ ad: 'S3-vurusluPan', bozuk: coz(S3s) });
      }
      /* S4: undo/redo spam arada */
      {
        await coklu(6, 0.35, 0.3, 0.2, 0.25);
        for (let i = 0; i < 5 && typeof undo === 'function'; i += 1) { undo(); await wait(60); }
        for (let i = 0; i < 5 && typeof redo === 'function'; i += 1) { redo(); await wait(60); }
        const S4s = await settle(9000);
        sen.push({ ad: 'S4-undoRedo', bozuk: coz(S4s) });
      }
      /* S5: smudge + püskürtü üst üste */
      {
        inkSetTool('brush', { brushId: 'ink-hard' });
        const ink = inkState();
        ink.size = 140; ink.opacity = 0.7; ink.color = '#2a4d33';
        await ciz(0.3, 0.45, 0.55, 0.55, 30, 80);
        const S5s = await settle(8000);
        sen.push({ ad: 'S5-buyukOpak', bozuk: coz(S5s) });
      }
      /* S6: katman gizle/göster üstüne vuruş */
      {
        const katmanlar = inkState().layers.filter(l => l.kind === 'attached');
        if (katmanlar.length > 1) {
          katmanlar[0].visible = false;
          await ciz(0.25, 0.35, 0.6, 0.5, 26, 90);
          katmanlar[0].visible = true;
          await wait(120);
        }
        const S6s = await settle(8000);
        sen.push({ ad: 'S6-gizleGoster', bozuk: coz(S6s) });
      }
      /* ilk bozuk senaryonun ilk bozuk karosundan görsel kanıt */
      let montaj = null;
      const ilkBozuk = sen.find(s => s.bozuk && s.bozuk.bozuk.length);
      if (ilkBozuk && ilkBozuk.bozuk.bozuk[0]) {
        const tvI = ui.tileView;
        const tI = tvI ? tvI.tiles.get(ilkBozuk.bozuk.bozuk[0][0]) : null;
        if (tI) { montaj = tsc.montaj(tI); }
      }
      return {
        montaj,
        ortam: { dpr: ui.dpr, view: ui.tileView ? [ui.tileView.viewW, ui.tileView.viewH, ui.tileView.tileSize] : null,
          stats: ui.tileView ? ui.tileView.stats() : null },
        senaryolar: sen,
        muhasebe: { md: tsc.sayaclar.md - md0, pTrue: tsc.sayaclar.pTrue, pFalse: tsc.sayaclar.pFalse,
          mdSon: tsc.sayaclar.mdSon } };
    })()`));
    /* ölçüm penceresi kapanır (uygulama davranışı eski haline döner) */
    await evaluate(ws, `window.__tsc && window.__tsc.tut(false)`);

    console.log('\\n== KOŞUM dpr=' + (dprTaklid || 'yerel') + ' ==');
    console.log('ORTAM: ' + JSON.stringify(seri.ortam));
    console.log('MUHASEBE: ' + JSON.stringify(seri.muhasebe));
    let kopuk = 0;
    for (const s of seri.senaryolar) {
      const b = !s.bozuk ? 'YIKILAMADI/BOŞ' :
        (s.bozuk.bozuk.length ? s.bozuk.bozuk : 'temiz(' + s.bozuk.top + ' karo)');
      console.log(s.ad + ': ' + JSON.stringify(b));
      if (s.bozuk && s.bozuk.bozuk.length) kopuk += 1;
    }
    if (kopuk) {
      const boxed = seri.senaryolar.filter(x => x.bozuk && x.bozuk.bozuk.length).map(x => x.bozuk.bozuk[0]);
      console.log('KUTULAR (ilk bozuk karo): ' + JSON.stringify(boxed));
      if (seri.montaj) {
        const pngYol = path.join(__dirname, 'tile-stale-montaj.png');
        try {
          fs.writeFileSync(pngYol, Buffer.from(seri.montaj.split(',')[1], 'base64'));
          console.log('MONTAJ yazıldı: ' + pngYol);
        } catch (eY) {
          console.error('MONT yazma hatası: ' + (eY && eY.message));
        }
      } else if (!dprTaklid) {
        console.log('MONTAJ: çekilemedi');
      }
    }
  } catch (e) {
    console.error('TSTALE HATASI(dpr=' + (dprTaklid || 'yerel') + '): ' +
      (e && e.message ? e.message.slice(0, 300) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(300);
  }
}

(async () => {
  for (const v of [null, 1.25, 1.5]) {
    await kosum(v);
  }
  console.log('\\n== TSTALE BİTTİ ==');
})();
