'use strict';
/* =========================================================
   ink-torture-max.js — AŞIRI limit-aşımı probe (kapı DEĞİL)
   ---------------------------------------------------------
   ink-torture.js'in katlanmış hâli:
     F1  8K tuval (8192×4320) + 20 katman
     F2  100 vuruş (12 renk, 20 katmanda 5'er)
     F3  smudge fırtınası ×2 (120 dev atış)
     F4  katman churn ×15 (ekle → çiz → birleştir/ sil)
     F5  maske ×36 + undo/redo spam ZEÇ ZAMANLI
     F6  zoom ×300 + pan ×100
     F7  kaydet spam ×10
     F8  muhasebe (span/heap/pool/token)
     F9  kapat → yeniden aç (kurtarma paritesi)
   Kullanım: node tests/ink-torture-max.js
   NOT: sentetik pointerType=pen — süreler SÖZDE-SÜRETTİR.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9342;
const APP_PORT = 5209;
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
  throw new Error('debug portu açılmadı (9342)');
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
  /* karşılama diyaloğu: görünene kadar bekle, Otomatik + Devam et */
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

const HELPERS = `
  var wait = ms => new Promise(r => setTimeout(r, ms));
  var canvas = document.getElementById('inkEditorCanvas');
  var fit = inkEditorUi.fit;
  var rect = canvas.getBoundingClientRect();
  var fire = (type, x, y, press) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
    clientX: rect.left + fit.x + x * fit.w,
    clientY: rect.top + fit.y + y * fit.h,
    button: 0, buttons: type === 'pointerup' ? 0 : 1,
    pressure: type === 'pointerup' ? 0 : press }));
  var ciz = async (brush, size, color, y0, y1, steps) => {
    inkSetTool(brush === 'smudge' ? 'smudge' : 'brush', brush === 'smudge' ? undefined : { brushId: brush });
    const ink = inkState();
    ink.size = size; ink.opacity = 1; ink.smoothing = 0.2; ink.color = color;
    await wait(30);
    fire('pointerdown', 0.08, y0, 0.4);
    for (let k = 1; k <= steps; k += 1) {
      fire('pointermove', 0.08 + 0.84 * k / steps, y0 + (y1 - y0) * k / steps, 0.5);
      await wait(4);
    }
    fire('pointerup', 0.92, y1, 0);
    await new Promise(r => requestAnimationFrame(r));
    await wait(80);
  };
`;

const HEAP = `performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-tmax-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const spawnApp = () => spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let app = spawnApp();
  app.on('exit', code => { if (!process.exitCode) { console.log('!! UYGULAMA SÜRECİ ÇIKTI: code=' + code); process.exitCode = 3; } });

  const phaseReport = [];
  let lastPhase = 'başlangıç';
  const report = phase => { phaseReport.push(phase); console.log(JSON.stringify(phase)); };

  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);

    /* ==== F1: 8K tuval + 20 katman ==== */
    lastPhase = 'F1 8K+20L kurulum';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, HELPERS + ` (async () => {
        document.getElementById('modeDrawBtn').click();
        await wait(260);
        document.getElementById('newCanvasW').value = '8192';
        document.getElementById('newCanvasH').value = '4320';
        document.getElementById('newCanvasName').value = 'AsiriZorlama';
        document.getElementById('newCanvasForm').requestSubmit();
        for (let i = 0; i < 300 && !inkEditorIsOpen(); i += 1) await wait(100);
        if (!inkEditorIsOpen()) return { hata: 'editör açılmadı (8K reddedildi?)' };
        await wait(800);
        for (let i = 0; i < 19; i += 1) inkDocAddLayer({});
        return { layers: inkState().layers.length,
          canvasBoy: [document.getElementById('inkEditorCanvas').width, document.getElementById('inkEditorCanvas').height],
          heap: ${HEAP} };
      })()`));
      report({ p: 'F1 8K+20L', ms: Date.now() - wall0, ...r });
      if (r.hata) throw new Error('F1: ' + r.hata);
    }

    /* ==== F2: 100 vuruş — 20 katmanda 5'er ==== */
    lastPhase = 'F2 100 vuruş';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, HELPERS + ` (async () => {
        const RENK = ['#e6194b', '#f58231', '#ffe119', '#bfef45', '#3cb44b',
          '#42d4f4', '#4363d8', '#911eb4', '#f032e6', '#9a6324',
          '#800000', '#469990'];
        const L = inkState().layers.filter(l => l.kind === 'attached');
        for (let i = 0; i < L.length; i += 1) {
          inkState().activeLayerId = L[i].id;
          for (let k = 0; k < 5; k += 1) {
            await ciz(k % 2 ? 'ink-air' : 'ink-hard', k % 2 ? 120 : 60, RENK[(i * 5 + k) % RENK.length],
              0.05 + i * 0.04, 0.3 + i * 0.04, 50);
          }
        }
        for (let i = 0; i < 300 && inkEditorUi.strokeInFlight; i += 1) await wait(100);
        return { strokes: inkState().layers.reduce((n, l) => n + (l.strokes || []).length, 0), heap: ${HEAP} };
      })()`));
      report({ p: 'F2 100 vuruş', ms: Date.now() - wall0, ...r });
    }

    /* ==== F3: smudge fırtınası ×2 (120 dev atış) ==== */
    lastPhase = 'F3 smudge ×120';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, HELPERS + ` (async () => {
        const L = inkState().layers.filter(l => l.kind === 'attached');
        let atis = 0;
        const t0 = Date.now();
        for (let i = 0; i < L.length; i += 1) {
          inkState().activeLayerId = L[i].id;
          for (let k = 0; k < 6; k += 1) {
            await ciz('smudge', 200, '#000000',
              0.05 + (k % 3) * 0.16, 0.85 - (k % 3) * 0.16, 60);
            atis++;
          }
        }
        const smudgeMs = Date.now() - t0;
        for (let i = 0; i < 300 && inkEditorUi.strokeInFlight; i += 1) await wait(100);
        return { atis, smudgeMs, heap: ${HEAP} };
      })()`));
      report({ p: 'F3 smudge ×120', ms: Date.now() - wall0, ...r });
    }

    /* ==== F4: katman churn ×15 (ekle→çiz→birleştir) ==== */
    lastPhase = 'F4 katman churn';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, HELPERS + ` (async () => {
        const t0 = Date.now();
        let eklenen = 0, silinen = 0, birlestirilen = 0, hata = null;
        try {
          for (let i = 0; i < 15; i += 1) {
            const nl = inkDocAddLayer({});
            eklenen++;
            inkState().activeLayerId = nl.id;
            await ciz('ink-hard', 80, i % 2 ? '#111111' : '#eeeeee', 0.2 + (i % 5) * 0.1, 0.6, 30);
            const L = inkState().layers.filter(l => l.kind === 'attached');
            if (L.length > 12) {
              if (i % 2 === 0 && typeof inkDocMergeDownLayer === 'function') {
                inkDocMergeDownLayer(L[0].id); birlestirilen++;
              } else {
                inkDocDeleteLayer(L[L.length - 1].id); silinen++;
              }
            }
            await wait(120);
          }
        } catch (err) { hata = String(err && err.message || err).slice(0, 120); }
        return { eklenen, silinen, birlestirilen, hata, katman: inkState().layers.filter(l => l.kind === 'attached').length,
          heap: ${HEAP} };
      })()`));
      report({ p: 'F4 katman churn', ms: Date.now() - wall0, ...r });
    }

    /* ==== F5: maske ×36 + undo/redo spam EŞZAMANLI ==== */
    lastPhase = 'F5 maske+spam';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, HELPERS + ` (async () => {
        const t0 = Date.now();
        let u = 0, rr = 0, hata = null;
        const maskFaz = (async () => {
          const L = inkState().layers.filter(l => l.kind === 'attached');
          for (const ml of [L[0], L[2], L[4]]) {
            inkDocAddMask(ml.id, 'reveal');
            inkState().maskEditId = ml.id;
            await wait(100);
            for (let i = 0; i < 12; i += 1) {
              await ciz('ink-hard', 34, i % 2 ? '#ffffff' : '#202020', 0.15 + (i % 8) * 0.06, 0.24, 18);
              /* her maske vuruşu arasında 2 tuşla spam */
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })); u++;
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true })); rr++;
              await wait(45);
            }
            inkState().maskEditId = null;
          }
        })();
        const spamFaz = (async () => {
          for (let i = 0; i < 40; i += 1) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })); u++;
            await wait(30);
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true })); rr++;
            await wait(30);
          }
        })();
        try { await Promise.all([maskFaz, spamFaz]); } catch (err) { hata = String(err && err.message || err).slice(0, 120); }
        return { u, rr, hata, ms: Date.now() - t0, maske: inkState().layers.filter(l => l.mask).length,
          undoDoluluk: undoStack.length, redoDoluluk: redoStack.length, heap: ${HEAP} };
      })()`));
      report({ p: 'F5 maske+spam', ms: Date.now() - wall0, ...r });
    }

    /* ==== F6: zoom ×300 + pan ×100 ==== */
    lastPhase = 'F6 zoom+pan';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, HELPERS + ` (async () => {
        const t0 = Date.now();
        for (let i = 0; i < 300; i += 1) {
          canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
            clientX: rect.left + 200, clientY: rect.top + 200,
            deltaY: i % 2 ? 260 : -260, ctrlKey: i % 7 === 0 }));
          await wait(6);
        }
        for (let i = 0; i < 100; i += 1) {
          fire('pointerdown', 0.3, 0.3, 0.5);
          fire('pointermove', 0.3 + (i % 10) * 0.03, 0.3 + (i % 7) * 0.05, 0.5);
          fire('pointerup', 0.33 + (i % 10) * 0.03, 0.35 + (i % 7) * 0.05, 0);
          await wait(10);
        }
        return { ms: Date.now() - t0, heap: ${HEAP} };
      })()`));
      report({ p: 'F6 zoom+pan', ms: Date.now() - wall0, ...r });
    }

    /* ==== F7: kaydet spam ×10 ==== */
    lastPhase = 'F7 kaydet spam';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(() => {
        const t0 = Date.now();
        let n = 0;
        for (let i = 0; i < 10; i += 1) { scheduleSave(); n++; }
        return { n, ms: Date.now() - t0, heap: ${HEAP} };
      })()`));
      report({ p: 'F7 kaydet spam', ms: Date.now() - wall0, ...r });
      await sleep(2500);
    }

    /* ==== F8: muhasebe ==== */
    lastPhase = 'F8 muhasebe';
    {
      const r = JSON.parse(await evaluate(ws, `(() => {
        const s = inkPerfSnapshot();
        const c = s.counters;
        const span = n => ({ n: c[n + 'Count'] || 0, avg: Math.round(((c[n + 'Ms'] || 0) / (c[n + 'Count'] || 1)) * 100) / 100, max: Math.round((c[n + 'MaxMs'] || 0) * 100) / 100 });
        let snapKB = 0;
        for (const t of undoStack) snapKB += Math.round(t.length / 1024);
        return { heap: s.heap, undoStack: undoStack.length, snapKB,
          rebuildHit: c.rebuildHit || 0, rebuildAppend: c.rebuildAppend || 0,
          rebuildMiss: c.rebuildMiss || 0, rebuildMissNew: c.rebuildMissNew || 0,
          commit: span('commit'), rebuild: span('rebuild'), undoSnap: span('undoSnap'),
          maskEncode: span('maskEncode'), scaledB: span('scaledBuild'), pyrSync: span('pyrSync'),
          dabs: c.dabs || 0,
          pool: typeof inkDualScratchStats === 'function' ? inkDualScratchStats() : null,
          snapTokens: { tokens: maskSnap.to.size, refsAll: [...maskSnap.refs.values()].reduce((a, b) => a + b, 0),
            bytes: [...maskSnap.to.values()].reduce((n, x) => n + x.length * 2, 0) } };
      })()`));
      report({ p: 'F8 muhasebe', ms: 0, ...r });
    }

    /* ==== F9: kapat → yeniden aç (kurtarma) ==== */
    lastPhase = 'F9 yeniden açılış';
    {
      const wall0 = Date.now();
      const r1 = JSON.parse(await evaluate(ws, `(() => {
        if (typeof inkEditorClose === 'function') inkEditorClose();
        return { pool: typeof inkDualScratchStats === 'function' ? inkDualScratchStats() : null,
          itemCanvases: inkRuntime.itemCanvases.size, heap: ${HEAP} };
      })()`));
      report({ p: 'F9a kapanış', ms: Date.now() - wall0, ...r1 });
      app.kill();
      await sleep(1500);
      app = spawnApp();
      app.on('exit', code => { if (!process.exitCode) { console.log('!! YENİDEN AÇILIM SÜRECİ ÇIKTI: code=' + code); } });
      const page2 = await waitForTarget();
      const ws2 = await connect(page2);
      await hazirla(ws2);
      await sleep(1200);
      const r2 = JSON.parse(await evaluate(ws2, `(() => {
        const L = (inkState().layers || []).filter(l => l.kind === 'attached');
        const masked = L.filter(l => l.mask);
        return { katman: L.length, maske: masked.length,
          maskeSrcOk: masked.every(l => l.mask && l.mask.src && l.mask.src.length > 120),
          heap: ${HEAP} };
      })()`));
      report({ p: 'F9b kurtarma', ms: Date.now() - wall0, ...r2 });
    }

    console.log('== AŞIRI ZORLAMA BİTTİ ==');
  } catch (e) {
    console.error('ZORLAMA-MAX: "' + lastPhase + '" fazında durdu: ' +
      (e && e.message ? e.message.slice(0, 300) : String(e)));
    try {
      if (ws) console.log('çökme anında heap: ' + await evaluate(ws, HEAP) + ' MB');
    } catch { /* son nefes alınamadı */ }
    console.error((e && e.stack ? e.stack : String(e)).slice(0, 400));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* */ }
  }
})();
