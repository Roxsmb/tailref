'use strict';
/* =========================================================
   ref-board-torture.js — REFERANS TAHTASI limit-aşımı (kapı DEĞİL)
   ---------------------------------------------------------
   Çizim kısmı zaten zorlandı (ink-torture-max); bu probe tahtayı
   kırar: 60 görsel + zoom/pan fırtınası + grup/çöp/link churn +
   tahta undo/redo spam + imgCache evict baskısı + kapat/aç.
   Muhasebe: heap, elMap/imgCache boyu, jank halkası.
   Kullanım: node tests/ref-board-torture.js
   NOT: sentetik pointerType=pen — süreler SÖZDE-SÜRETTİR.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9345;
const APP_PORT = 5212;
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
  throw new Error('debug portu açılmadı (9345)');
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

const HEAP = `performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1`;

/* Tahta muhasebesi — ortak satır */
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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-rb torture-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const spawnApp = () => spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let app = spawnApp();

  let lastPhase = 'başlangıç';
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);

    /* ==== F1: 60 görsel partisi ==== */
    lastPhase = 'F1 görsel partisi';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        let eklenen = 0, hata = null;
        try {
          for (let b = 0; b < 6; b += 1) {
            const items = [];
            for (let k = 0; k < 10; k += 1) {
              const c = document.createElement('canvas');
              c.width = 400; c.height = 300;
              const cx = c.getContext('2d');
              const hue = (b * 10 + k) * 6;
              cx.fillStyle = 'hsl(' + hue + ',70%,55%)';
              cx.fillRect(0, 0, 400, 300);
              cx.fillStyle = 'hsl(' + (hue + 40) + ',80%,35%)';
              for (let q = 0; q < 8; q += 1) {
                cx.fillRect(q * 48, k * 37 % 260, 30, 20);
              }
              const blob = await new Promise(r2 => c.toBlob(r2, 'image/png'));
              if (!blob) throw new Error('toBlob boş');
              const name = 'TR-' + b + '-' + k + '.png';
              const imageId = 'img_' + newId();
              await idbPut('images', imageId, { blob, name });
              const entry = await decodeImage(blob);
              setImgCache(imageId, { img: entry.img, url: entry.url, name });
              const gx = (k % 6) * 420, gy = Math.floor(k / 6) * 330;
              const it = { id: 'it_' + newId(), kind: 'image', imageId,
                title: name, name, x: gx, y: gy, w: 400, h: 300, rot: 0, z: nextZ() };
              state.items.push(it);
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
      console.log('F1: ' + JSON.stringify({ ms: Date.now() - wall0, ...r }));
      console.log('SAYIM: ' + await evaluate(ws, SAYIM));
    }

    /* ==== F2: zoom + pan fırtınası ==== */
    lastPhase = 'F2 zoom+pan';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        for (let i = 0; i < 400; i += 1) {
          stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
            clientX: 200 + (i % 500), clientY: 150 + (i % 400),
            deltaY: i % 2 ? 200 : -200, ctrlKey: i % 5 !== 0 }));
          await wait(6);
        }
        for (let i = 0; i < 80; i += 1) {
          stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
            pointerId: 7, pointerType: 'pen', button: 0, buttons: 1,
            clientX: 400 + (i % 60), clientY: 300 + (i % 40) }));
          stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true,
            pointerId: 7, pointerType: 'pen', button: 0, buttons: 1,
            clientX: 400 + (i % 60) + 180, clientY: 300 + (i % 40) - 90 }));
          stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
            pointerId: 7, pointerType: 'pen', button: 0, buttons: 0,
            clientX: 400 + (i % 60) + 180, clientY: 300 + (i % 40) - 90 }));
          await wait(8);
        }
        fitAll();
        return { ms: Date.now() - t0 };
      })()`));
      console.log('F2: ' + JSON.stringify({ ms: Date.now() - wall0, ...r }));
      console.log('SAYIM: ' + await evaluate(ws, SAYIM));
    }

    /* ==== F3: grup churn ×20 ==== */
    lastPhase = 'F3 grup churn';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        let kurulan = 0, cozulen = 0, hata = null;
        try {
          for (let i = 0; i < 20; i += 1) {
            const ids = state.items.slice(i * 2, i * 2 + 6).map(x => x.id);
            if (ids.length < 3) break;
            selection = new Set(ids);
            selectionOrder = ids.slice();
            if (typeof groupSelection === 'function') { groupSelection(); kurulan++; }
            await wait(40);
            const gid = typeof selectedGroupId === 'function' ? selectedGroupId() : null;
            pushUndo();
            if (gid && typeof dissolveGroup === 'function') { dissolveGroup(gid); cozulen++; }
            else if (ids.includes) selection = new Set();
            await wait(40);
          }
        } catch (err) { hata = String(err && err.message || err).slice(0, 140); }
        selection = new Set();
        return { kurulan, cozulen, hata };
      })()`));
      console.log('F3: ' + JSON.stringify({ ms: Date.now() - wall0, ...r }));
      console.log('SAYIM: ' + await evaluate(ws, SAYIM));
    }

    /* ==== F4: çöp churn (sil → geri yükle) ×25 ==== */
    lastPhase = 'F4 çöp churn';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        let silinen = 0, donen = 0, hata = null;
        try {
          for (let i = 0; i < 25; i += 1) {
            const ids = state.items.slice(i % 4, (i % 4) + 4).map(x => x.id);
            if (!ids.length) break;
            removeItems(ids, false);
            silinen += ids.length;
            await wait(50);
            const tomb = state.trash.map(e => e.id).slice(0, ids.length);
            if (tomb.length && typeof restoreTrashEntries === 'function') {
              await restoreTrashEntries(tomb);
              donen += tomb.length;
            }
            await wait(50);
          }
          pushUndo();
          fitAll();
        } catch (err) { hata = String(err && err.message || err).slice(0, 140); }
        return { silinen, donen, hata };
      })()`));
      console.log('F4: ' + JSON.stringify({ ms: Date.now() - wall0, ...r }));
      console.log('SAYIM: ' + await evaluate(ws, SAYIM));
    }

    /* ==== F5: link spam ==== */
    lastPhase = 'F5 link spam';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        let sayi = 0, hata = null;
        try {
          for (let i = 0; i < 30; i += 1) {
            const ids = state.items.slice(i, i + 2);
            if (ids.length < 2) break;
            selection = new Set([ids[0].id, ids[1].id]);
            selectionOrder = [ids[0].id, ids[1].id];
            if (typeof toggleLink === 'function') { toggleLink(); sayi++; }
            await wait(30);
          }
        } catch (err) { hata = String(err && err.message || err).slice(0, 140); }
        selection = new Set();
        return { sayi, hata };
      })()`));
      console.log('F5: ' + JSON.stringify({ ms: Date.now() - wall0, ...r }));
      console.log('SAYIM: ' + await evaluate(ws, SAYIM));
    }

    /* ==== F6: imgCache evict baskısı (70 görsel daha → 130 item, cache 50) ==== */
    lastPhase = 'F6 evict baskısı';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        let eklenen = 0, hata = null;
        try {
          for (let b = 0; b < 7; b += 1) {
            for (let k = 0; k < 10; k += 1) {
              const c = document.createElement('canvas');
              c.width = 400; c.height = 300;
              const cx = c.getContext('2d');
              const hue = (70 + b * 10 + k) * 6;
              cx.fillStyle = 'hsl(' + hue + ',72%,48%)';
              cx.fillRect(0, 0, 400, 300);
              const blob = await new Promise(r2 => c.toBlob(r2, 'image/png'));
              const name = 'EV-' + b + '-' + k + '.png';
              const imageId = 'img_' + newId();
              await idbPut('images', imageId, { blob, name });
              const entry = await decodeImage(blob);
              setImgCache(imageId, { img: entry.img, url: entry.url, name });
              const it = { id: 'it_' + newId(), kind: 'image', imageId,
                title: name, name, x: 3000 + k * 420, y: b * 330, w: 400, h: 300, rot: 0, z: nextZ() };
              state.items.push(it);
              eklenen++;
            }
            pushUndo();
            await wait(100);
          }
          syncAll();
          fitAll();
        } catch (err) { hata = String(err && err.message || err).slice(0, 140); }
        return { eklenen, hata };
      })()`));
      console.log('F6: ' + JSON.stringify({ ms: Date.now() - wall0, ...r }));
      console.log('SAYIM: ' + await evaluate(ws, SAYIM));
    }

    /* ==== F7: tahta undo/redo SPAM ×70 ==== */
    lastPhase = 'F7 tahta undo/redo';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        let u = 0, rr = 0;
        for (let i = 0; i < 70 && undoStack.length; i += 1) { undo(); u++; await wait(25); }
        for (let i = 0; i < 40 && redoStack.length; i += 1) { redo(); rr++; await wait(25); }
        return { u, rr, ms: Date.now() - t0 };
      })()`));
      console.log('F7: ' + JSON.stringify({ ms: Date.now() - wall0, ...r }));
      console.log('SAYIM: ' + await evaluate(ws, SAYIM));
    }

    /* ==== F8: zoom yeniden + fitAll spam ==== */
    lastPhase = 'F8 fit spam';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        for (let i = 0; i < 100; i += 1) {
          fitAll();
          zoomTo100();
          await wait(10);
        }
        fitAll();
        return { ms: Date.now() - t0 };
      })()`));
      console.log('F8: ' + JSON.stringify({ ms: Date.now() - wall0, ...r }));
      console.log('SAYIM: ' + await evaluate(ws, SAYIM));
    }

    /* ==== F9: kaydet → kapat → yeniden aç ==== */
    lastPhase = 'F9 yeniden açılış';
    {
      let wall0 = Date.now();
      const created = JSON.parse(await evaluate(ws, `(() => {
        scheduleSave();
        return { items: state.items.length, trash: state.trash.length, links: state.links.length };
      })()`));
      console.log('F9a ket: ' + JSON.stringify({ ms: Date.now() - wall0, ...created }));
      try { app.kill(); } catch { /* */ }
      await sleep(1600);
      wall0 = Date.now();
      app = spawnApp();
      const page2 = await waitForTarget();
      const ws2 = await connect(page2);
      await hazirla(ws2);
      await sleep(1500);
      const r2 = JSON.parse(await evaluate(ws2, `(() => {
        const items = state.items.filter(x => x && x.kind === 'image');
        let gorselYuk = 0;
        for (const it of items.slice(0, 20)) {
          const el = elMap.get(it.id);
          if (el && el.querySelector('img') && el.querySelector('img').src) gorselYuk++;
        }
        return { items: state.items.length, imgItems: items.length,
          trash: state.trash.length, links: state.links.length,
          gorselYuk, cache: imgCache.size,
          heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 };
      })()`));
      console.log('F9b kurtarma: ' + JSON.stringify({ ms: Date.now() - wall0, ...r2 }));
    }

    console.log('== TAHTA ZORLAMA BİTTİ ==');
  } catch (e) {
    console.error('TAHTA-ZORLAMA: "' + lastPhase + '" fazında durdu: ' +
      (e && e.message ? e.message.slice(0, 300) : String(e)));
    console.error((e && e.stack ? e.stack : String(e)).slice(0, 420));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* */ }
  }
})();
