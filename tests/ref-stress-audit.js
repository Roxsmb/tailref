'use strict';
/* =========================================================
   ref-stress-audit.js — REFERANS TAHTASI agir zorlama + darbogaz denetimi
   ---------------------------------------------------------
   ref-board-torture'dan daha agir senaryolar; her fazda
   longtask (PerformanceObserver) + jank + heap muhasebesi,
   sonda darbogaz siralamasi (HUKM) yazar.
   Senaryolar:
     S1: 24 buyuk gorsel (1200x900) partisi
     S2: zoom+pan firtinasi (500 wheel + 100 drag)
     S3: rotasyon + tasiona firtinasi
     S4: grup+link churn (100+ uzerinde)
     S5: tahta undo/redo spam
     S6: snapshot stringify dogrusallik + save ket
   Kullanim: node tests/ref-stress-audit.js   (kapi DEGIL)
   NOT: sentetik olaylar — sureler SOZDE-SURETTIR.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9350;
const APP_PORT = 5220;
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
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatasi'));
    }
    const v = msg.result.result.value;
    resolve(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

async function waitForTarget(deadlineMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henuz degil */ }
    await sleep(400);
  }
  throw new Error('debug portu acilmadi (9350)');
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
    ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth");
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('renderer hazir olmad');

  /* longtask observer'i bir kez kur (per-faz sifirlanarak okunur) */
  await evaluate(ws, `(() => {
    if (window.__lt) return true;
    window.__lt = { n: 0, ms: 0, max: 0 };
    try {
      window.__ltObs = new PerformanceObserver(l => {
        for (const e of l.getEntries()) {
          window.__lt.n++;
          window.__lt.ms += e.duration;
          if (e.duration > window.__lt.max) window.__lt.max = e.duration;
        }
      });
      window.__ltObs.observe({ entryTypes: ['longtask'] });
    } catch { /* longtask desteklenmiyor */ }
    return true;
  })()`);

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

const HEAP = `performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1`;

const SAYIM = `(() => {
  const jank = window.__inkFrameJank;
  let jankMax = null, jankAvg = null, jankN = 0;
  if (jank && jank.ring) {
    const r = jank.ring.filter(x => x > 25);
    jankN = r.length;
    jankMax = r.length ? Math.max(...r) : 0;
    jankAvg = r.length ? Math.round(r.reduce((a,b)=>a+b,0) / r.length) : 0;
  }
  return { items: state.items.length, trash: state.trash ? state.trash.length : -1,
    links: state.links.length,
    elDom: (typeof elMap !== 'undefined') ? elMap.size : -1,
    cache: (typeof imgCache !== 'undefined') ? imgCache.size : -1,
    undo: undoStack.length, redo: redoStack.length,
    jankN, jankAvg, jankMax, heap: ${HEAP} };
})()`;

/* Per-faz longtask okuma + sifirlama */
const LT_OKU = `(() => {
  const o = window.__lt || { n: -1, ms: -1, max: -1 };
  window.__lt = { n: 0, ms: 0, max: 0 };
  return { n: o.n, ms: Math.round(o.ms), max: Math.round(o.max) };
})()`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-rsa-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  const phases = [];
  let lastPhase = 'baslangic';
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);

    const fazKapat = async (ad, wall0, r) => {
      const lt = JSON.parse(await evaluate(ws, LT_OKU));
      const sayim = JSON.parse(await evaluate(ws, SAYIM));
      phases.push({ p: ad, ms: Date.now() - wall0, lt, ...r, sayim });
      console.log(JSON.stringify({ p: ad, ms: Date.now() - wall0, lt, ...r }));
      console.log('SAYIM: ' + JSON.stringify(sayim));
    };

    /* ==== S1: 24 buyuk gorsel (1200x900) partisi ==== */
    lastPhase = 'S1 buyuk gorsel';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        let eklenen = 0, hata = null;
        try {
          for (let b = 0; b < 4; b += 1) {
            const bloblar = [];
            for (let k = 0; k < 6; k += 1) {
              const c = document.createElement('canvas');
              c.width = 1200; c.height = 900;
              const cx = c.getContext('2d');
              const g = cx.createLinearGradient(0, 0, 1200, 900);
              const hue = (b * 6 + k) * 15;
              g.addColorStop(0, 'hsl(' + hue + ',75%,55%)');
              g.addColorStop(1, 'hsl(' + (hue + 60) + ',80%,30%)');
              cx.fillStyle = g;
              cx.fillRect(0, 0, 1200, 900);
              for (let q = 0; q < 40; q += 1) {
                cx.fillStyle = 'rgba(255,255,255,' + (q % 3 ? 0.2 : 0.5) + ')';
                cx.fillRect((q * 97) % 1150, (q * 61) % 850, 80, 50);
              }
              bloblar.push(await new Promise(r2 => c.toBlob(r2, 'image/png')));
            }
            for (let k = 0; k < bloblar.length; k += 1) {
              const blob = bloblar[k];
              if (!blob) throw new Error('toBlob bos');
              const name = 'BS-' + b + '-' + k + '.png';
              const imageId = 'img_' + newId();
              await idbPut('images', imageId, { blob, name });
              const entry = await decodeImage(blob);
              setImgCache(imageId, { img: entry.img, url: entry.url, name });
              const gx = (k % 4) * 1220, gy = Math.floor(k / 4) * 920;
              state.items.push({ id: 'it_' + newId(), kind: 'image', imageId,
                title: name, name, x: gx, y: gy, w: 1200, h: 900, rot: 0, z: nextZ() });
              eklenen++;
            }
            pushUndo();
            syncAll();
            await wait(150);
          }
        } catch (err) { hata = String(err && err.message || err).slice(0, 140); }
        fitAll();
        return { eklenen, hata };
      })()`));
      await fazKapat('S1 buyuk gorsel', wall0, r);
    }

    /* ==== S2: zoom+pan firtinasi (buyuk ogeler uzerinde) ==== */
    lastPhase = 'S2 zoom+pan';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        for (let i = 0; i < 500; i += 1) {
          stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
            clientX: 200 + (i % 500), clientY: 150 + (i % 400),
            deltaY: i % 2 ? 200 : -200, ctrlKey: i % 5 !== 0 }));
          if (i % 25 === 0) await wait(5);
        }
        for (let i = 0; i < 100; i += 1) {
          stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
            pointerId: 7, pointerType: 'pen', button: 0, buttons: 1,
            clientX: 400 + (i % 60), clientY: 300 + (i % 40) }));
          stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true,
            pointerId: 7, pointerType: 'pen', button: 0, buttons: 1,
            clientX: 400 + (i % 60) + 220, clientY: 300 + (i % 40) - 110 }));
          stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
            pointerId: 7, pointerType: 'pen', button: 0, buttons: 0,
            clientX: 400 + (i % 60) + 220, clientY: 300 + (i % 40) - 110 }));
          await wait(8);
        }
        fitAll();
        return { ms: Date.now() - t0 };
      })()`));
      await fazKapat('S2 zoom+pan', wall0, r);
    }

    /* ==== S3: rotasyon + tasiona firtinasi ==== */
    lastPhase = 'S3 rot+taskinasi';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        let tur = 0;
        for (let i = 0; i < 50; i += 1) {
          const hb = state.items.slice(2, 14);
          for (const it of hb) {
            it.x += (i % 2 ? 1 : -1) * 3;
            it.y += (i % 2 ? -1 : 1) * 2;
            it.rot = ((it.rot || 0) + 4) % 360;
          }
          if (i % 10 === 0) pushUndo();
          syncAll();
          await wait(6);
          tur++;
        }
        for (let i = 0; i < 6; i += 1) {
          fitAll();
          zoomTo100();
          await wait(12);
        }
        return { tur, ms: Date.now() - t0 };
      })()`));
      await fazKapat('S3 rot+taskinasi', wall0, r);
    }

    /* ==== S4: grup + link churn ==== */
    lastPhase = 'S4 grup+link churn';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        let kurulan = 0, cozulen = 0, linkler = 0, hata = null;
        try {
          for (let i = 0; i < 15; i += 1) {
            const ids = state.items.slice(i * 3, i * 3 + 6).map(x => x.id);
            if (ids.length < 3) break;
            selection = new Set(ids);
            selectionOrder = ids.slice();
            if (typeof groupSelection === 'function') { groupSelection(); kurulan++; }
            await wait(35);
            const gid = typeof selectedGroupId === 'function' ? selectedGroupId() : null;
            pushUndo();
            if (gid && typeof dissolveGroup === 'function') { dissolveGroup(gid); cozulen++; }
            await wait(35);
            if (i % 2 === 0) {
              const iki = state.items.slice(i, i + 2).map(x => x.id);
              if (iki.length === 2) {
                selection = new Set(iki);
                selectionOrder = iki;
                if (typeof toggleLink === 'function') { toggleLink(); linkler++; }
                await wait(25);
                if (typeof toggleLink === 'function') { toggleLink(); linkler--; }
                await wait(25);
              }
            }
          }
        } catch (err) { hata = String(err && err.message || err).slice(0, 140); }
        selection = new Set();
        return { kurulan, cozulen, linkler, hata };
      })()`));
      await fazKapat('S4 grup+link churn', wall0, r);
    }

    /* ==== S5: tahta undo/redo SPAM ==== */
    lastPhase = 'S5 undo/redo';
    {
      /* REFSTRESS_S5_PROBE=1: undo iç ayrıştırma (restore/sync/view) — tanısal */
      if (process.env.REFSTRESS_S5_PROBE === '1') {
        await evaluate(ws, `(() => {
          if (window.__m) return true;
          window.__m = { rs: [], sa: [], av: [], ab: [], create: [], tot: [] };
          const RS = restoreSnapshot, SA = syncAll, AV = applyView, AB = applyBackdrop, CE = createItemEl;
          restoreSnapshot = s => { const t = performance.now(); RS(s); __m.rs.push(Math.round(performance.now() - t)); };
          syncAll = () => { const t = performance.now(); SA(); __m.sa.push(Math.round(performance.now() - t)); };
          applyView = () => { const t = performance.now(); AV(); __m.av.push(Math.round(performance.now() - t)); };
          applyBackdrop = () => { const t = performance.now(); AB(); __m.ab.push(Math.round(performance.now() - t)); };
          createItemEl = it => { const t = performance.now(); const el = CE(it); __m.create.push(Math.round(performance.now() - t)); return el; };
          const U = undo, R = redo;
          undo = () => { const t = performance.now(); U(); __m.tot.push(Math.round(performance.now() - t)); };
          redo = () => { const t = performance.now(); R(); __m.tot.push(Math.round(performance.now() - t)); };
          return true;
        })()`);
      }
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        let u = 0, rr = 0;
        for (let i = 0; i < 80 && undoStack.length; i += 1) { undo(); u++; await wait(20); }
        for (let i = 0; i < 50 && redoStack.length; i += 1) { redo(); rr++; await wait(20); }
        return { u, rr, ms: Date.now() - t0 };
      })()`));
      await fazKapat('S5 undo/redo', wall0, r);
      if (process.env.REFSTRESS_S5_PROBE === '1') {
        const olc = JSON.parse(await evaluate(ws, `(() => {
          const m = window.__m || {};
          const ist = a => a.length ? { n: a.length, ort: Math.round(a.reduce((x, y) => x + y, 0) / a.length),
            max: Math.max(...a), top: a.reduce((x, y) => x + y, 0) } : { n: 0 };
          return { undo: ist(m.tot || []), restore: ist(m.rs || []), syncAll: ist(m.sa || []),
            applyView: ist(m.av || []), backdrop: ist(m.ab || []), createEl: ist(m.create || []) };
        })()`));
        console.log('S5-OLCUM: ' + JSON.stringify(olc));
      }
    }

    /* ==== S6: snapshot stringify dogrusallik + save ket ==== */
    lastPhase = 'S6 snapshot/save';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const olc = [];
        for (let i = 0; i < 5; i += 1) {
          const t = performance.now();
          const s = JSON.stringify(createStateSnapshot());
          olc.push({ ms: Math.round(performance.now() - t), kb: Math.round(s.length / 1024) });
          await wait(30);
        }
        const saveT = performance.now();
        scheduleSave();
        await wait(1200);
        return { olc, saveKet: Math.round(performance.now() - saveT),
          undoKB: Math.round(undoStack.reduce((n, s) => n + s.length, 0) / 1024),
          heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 };
      })()`));
      await fazKapat('S6 snapshot/save', wall0, r);
    }

    /* ==== S7: 96 oge DAHA (1200x900, toplam 120) ==== */
    lastPhase = 'S7 gorsel yigin';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        let eklenen = 0, hata = null;
        try {
          for (let b = 0; b < 8; b += 1) {
            const bloblar = [];
            for (let k = 0; k < 12; k += 1) {
              const c = document.createElement('canvas');
              c.width = 900; c.height = 700;
              const cx = c.getContext('2d');
              const hue = (24 + b * 12 + k) * 30 % 360;
              cx.fillStyle = 'hsl(' + hue + ',70%,50%)';
              cx.fillRect(0, 0, 900, 700);
              cx.fillStyle = 'rgba(0,0,0,0.25)';
              for (let q = 0; q < 20; q += 1) cx.fillRect((q * 173) % 850, (q * 97) % 650, 60, 40);
              bloblar.push(await new Promise(r2 => c.toBlob(r2, 'image/png')));
            }
            for (let k = 0; k < bloblar.length; k += 1) {
              const name = 'YG-' + b + '-' + k + '.png';
              const imageId = 'img_' + newId();
              await idbPut('images', imageId, { blob: bloblar[k], name });
              const entry = await decodeImage(bloblar[k]);
              setImgCache(imageId, { img: entry.img, url: entry.url, name });
              state.items.push({ id: 'it_' + newId(), kind: 'image', imageId,
                title: name, name, x: 2600 + (k % 4) * 940, y: 2000 + Math.floor(k / 4) * 720,
                w: 900, h: 700, rot: 0, z: nextZ() });
              eklenen++;
            }
            pushUndo();
            syncAll();
            await wait(120);
          }
        } catch (err) { hata = String(err && err.message || err).slice(0, 140); }
        fitAll();
        return { eklenen, hata };
      })()`));
      await fazKapat('S7 gorsel yigin', wall0, r);
    }

    /* ==== S8: zoom+pan firtinasi 120 oge uzerinde ==== */
    lastPhase = 'S8 zoom+pan 120';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        for (let i = 0; i < 600; i += 1) {
          stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
            clientX: 200 + (i % 500), clientY: 150 + (i % 400),
            deltaY: i % 2 ? 200 : -200, ctrlKey: i % 5 !== 0 }));
          if (i % 20 === 0) await wait(5);
        }
        for (let i = 0; i < 80; i += 1) {
          stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
            pointerId: 7, pointerType: 'pen', button: 0, buttons: 1,
            clientX: 400 + (i % 60), clientY: 300 + (i % 40) }));
          stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true,
            pointerId: 7, pointerType: 'pen', button: 0, buttons: 1,
            clientX: 400 + (i % 60) + 240, clientY: 300 + (i % 40) - 120 }));
          stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
            pointerId: 7, pointerType: 'pen', button: 0, buttons: 0,
            clientX: 400 + (i % 60) + 240, clientY: 300 + (i % 40) - 120 }));
          await wait(8);
        }
        fitAll();
        return { ms: Date.now() - t0 };
      })()`));
      await fazKapat('S8 zoom+pan 120', wall0, r);
    }

    /* ==== S9: undo/redo 120 ogede + undo() senkron maliyeti ==== */
    lastPhase = 'S9 undo/redo 120';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        let u = 0, rr = 0, undoSenk = [], redoSenk = [];
        for (let i = 0; i < 60 && undoStack.length; i += 1) {
          const t = performance.now();
          undo();
          if (undoSenk.length < 10) undoSenk.push(Math.round(performance.now() - t));
          u++;
          await wait(20);
        }
        for (let i = 0; i < 40 && redoStack.length; i += 1) {
          const t = performance.now();
          redo();
          if (redoSenk.length < 10) redoSenk.push(Math.round(performance.now() - t));
          rr++;
          await wait(20);
        }
        return { u, rr, undoSenk, redoSenk, ms: Date.now() - t0 };
      })()`));
      await fazKapat('S9 undo/redo 120', wall0, r);
    }

    /* ==== S10: dolu tahta uzerinde ink editor caprazi ==== */
    lastPhase = 'S10 ink caprazi';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        if (typeof inkPerfReset === 'function') inkPerfReset();
        document.getElementById('modeDrawBtn').click();
        await wait(300);
        document.getElementById('newCanvasW').value = '2600';
        document.getElementById('newCanvasH').value = '1700';
        document.getElementById('newCanvasName').value = 'RSA-CAPRAZ';
        document.getElementById('newCanvasForm').requestSubmit();
        for (let i = 0; i < 200 && !inkEditorIsOpen(); i += 1) await wait(100);
        await wait(600);
        const CAN = document.getElementById('inkEditorCanvas');
        const fit = inkEditorUi.fit;
        const rc = CAN.getBoundingClientRect();
        const fire = (type, x, y) => CAN.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
          clientX: rc.left + fit.x + x * fit.w,
          clientY: rc.top + fit.y + y * fit.h,
          button: 0, buttons: type === 'pointerup' ? 0 : 1,
          pressure: type === 'pointerup' ? 0 : 0.6 }));
        const t0 = Date.now();
        for (let i = 0; i < 20; i += 1) {
          const y = 0.2 + (i % 4) * 0.16;
          fire('pointerdown', 0.15, y);
          for (let s = 1; s <= 12; s += 1) {
            fire('pointermove', 0.15 + s * 0.06, y + Math.sin(s) * 0.02);
            await wait(6);
          }
          fire('pointerup', 0.9, y);
          await wait(24);
        }
        for (let i = 0; i < 200 && inkEditorUi.strokeInFlight; i += 1) await wait(100);
        const c = (typeof inkPerf !== 'undefined' && inkPerf.counters) || {};
        const sec = name => ({ n: c[name + 'Count'] || 0,
          avg: c[name + 'Count'] ? Math.round(c[name + 'Ms'] / c[name + 'Count'] * 100) / 100 : 0,
          max: Math.round((c[name + 'MaxMs'] || 0) * 100) / 100 });
        const editors = { commit: sec('commit'), pyrSync: sec('pyrSync'),
          scaledB: sec('scaledBuild'), rebuild: sec('rebuild'),
          undoSnap: sec('undoSnap'), dabs: c.dabs || 0 };
        return { ms: Date.now() - t0, acik: inkEditorIsOpen(), editors };
      })()`));
      await fazKapat('S10 ink caprazi', wall0, r);
    }

    /* ==== S11: editor kapat -> tahta toparlanmasi ==== */
    lastPhase = 'S11 kapat+toparla';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        if (typeof inkEditorClose === 'function') inkEditorClose();
        await wait(400);
        for (let i = 0; i < 20; i += 1) { fitAll(); await wait(10); }
        zoomTo100();
        return { ms: Date.now() - t0, acik: inkEditorIsOpen(),
          heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 };
      })()`));
      await fazKapat('S11 kapat+toparla', wall0, r);
    }

    /* ==== HUKM: darbogaz siralamasi (lt.ms payi) ==== */
    const toplamLt = phases.reduce((n, p) => n + (p.lt && p.lt.ms > 0 ? p.lt.ms : 0), 0);
    const sirali = phases.slice().sort((a, b) => (b.lt.ms || 0) - (a.lt.ms || 0));
    console.log('== DARBOLGAZ SIRALAMASI (longtask toplam ' + Math.round(toplamLt) + ' ms) ==');
    for (const p of sirali) {
      const pay = toplamLt ? Math.round((p.lt.ms || 0) / toplamLt * 100) : 0;
      console.log(p.p + ': lt=' + p.lt.ms + 'ms (n=' + p.lt.n + ', max=' + p.lt.max + 'ms) payi %' + pay +
        ' | faz=' + p.ms + 'ms | heap=' + p.sayim.heap + 'MB' +
        (p.sayim.jankMax !== null ? ' | jank>25ms=' + p.sayim.jankN + ' max=' + p.sayim.jankMax : ''));
    }
    const hukum = 'HUKM: en-agir=' + sirali[0].p + ' (' + (sirali[0].lt.ms || 0) + 'ms lt)' +
      ' | ikinci=' + (sirali[1] ? sirali[1].p + ' (' + (sirali[1].lt.ms || 0) + 'ms)' : 'yok') +
      ' | longtask-eclen-fazlar=' + (phases.filter(p => p.lt.max > 100).map(p => p.p).join(',') || 'yok');
    console.log(hukum);

  } catch (e) {
    console.error('RSA HATASI: "' + lastPhase + '" fazinda durdu: ' +
      (e && e.message ? e.message.slice(0, 300) : String(e)));
    console.error((e && e.stack ? e.stack : String(e)).slice(0, 400));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* son nefes */ }
    await sleep(300);
  }
})();
