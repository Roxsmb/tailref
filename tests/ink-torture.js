'use strict';
/* =========================================================
   ink-torture.js — limit-aşımı probe (kapı DEĞİL)
   ---------------------------------------------------------
   Amaç: uygulamayı :) gerçek kullanıcının yapmayacağı kadar
   zorlamak; ilk çöken/boğulan yeri ve darboğaz sırasını
   çıkarmak. Her faz: heap + en kötü span + çökme yakalık.
   Kullanım: node tests/ink-torture.js
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
    /* Nesne dönen eval'lü fazlar string beklediği için: yalnız nesne dizileştirilir. */
    resolve(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});
async function waitForTarget(deadlineMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* hazır değil */ }
    await sleep(400);
  }
  throw new Error('debug portu açılmadı (9342)');
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-torture-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  app.on('exit', code => { if (!process.exitCode) { console.log('!! UYGULAMA SÜRECİ ÇIKTI: code=' + code); process.exitCode = 3; } });

  const phaseReport = [];
  let lastPhase = 'başlangıç';
  let ws = null;
  const report = phase => phaseReport.push(phase);
  /* Faz-bazlı rebuild sayaç dökümü: hangi fazın hit/append/miss'i
     ürettiğini kaynak dokunmadan ANLAMAK için her faz sonrası
     inkPerf.counters'taki rebuild ve undoSnap/undoChip anahtarlarını
     delta olarak yazar. */
  let rbOnce = null;
  const rbDagilim = async tag => {
    try {
      const c = JSON.parse(await evaluate(ws, `(() => {
        const c = (typeof inkPerf !== 'undefined' && inkPerf.counters) || {};
        const out = {};
        for (const k of Object.keys(c)) {
          if (k.indexOf('rebuild') === 0 || k.indexOf('undoSnap') === 0 ||
              k.indexOf('undoChip') === 0) {
            out[k] = (typeof c[k] === 'number') ? Math.round(c[k] * 100) / 100 : c[k];
          }
        }
        /* baza cache muhasebesi: entry boyu bütçe kararına girdi */
        try {
          if (typeof inkStrokeBase !== 'undefined') {
            let px = 0;
            for (const e of inkStrokeBase.map.values()) px += e.w * e.h;
            out.cache = { size: inkStrokeBase.map.size, px,
              mb: Math.round(px * 4 / 1048576) };
          }
        } catch { /* yok say */ }
        return out;
      })()`));
      const delta = {};
      for (const k of Object.keys(c)) {
        delta[k] = (typeof c[k] === 'number' && rbOnce && typeof rbOnce[k] === 'number')
          ? Math.round((c[k] - rbOnce[k]) * 100) / 100 : c[k];
      }
      rbOnce = c;
      report({ p: 'rebuild-dagilim ' + tag, ...delta });
    } catch (e) {
      report({ p: 'rebuild-dagilim ' + tag, err: String(e).slice(0, 120) });
    }
  };
  try {
    const page = await waitForTarget();
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(400);
    }
    if (!ready) throw new Error('renderer hazır olmadı');
    /* Karşılama diyaloğu init'te GEÇ gösterilebiliyor: görünene kadar bekle,
       sonra Otomatik seç + Devam et; kapanmadıysa tekrar dene. */
    let welcomeClosed = false;
    for (let i = 0; i < 60 && !welcomeClosed; i += 1) {
      welcomeClosed = await evaluate(ws, `(() => {
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
      if (!welcomeClosed) await sleep(500);
    }

    const COMMON = `
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

    /* ==== F1: 4K tuval + 10 katman ==== */
    lastPhase = 'F1 kurulum';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, COMMON + ` (async () => {
        document.getElementById('modeDrawBtn').click();
        await wait(260);
        document.getElementById('newCanvasW').value = '3840';
        document.getElementById('newCanvasH').value = '2160';
        document.getElementById('newCanvasName').value = 'Zorlama';
        document.getElementById('newCanvasForm').requestSubmit();
        for (let i = 0; i < 200 && !inkEditorIsOpen(); i += 1) await wait(100);
        await wait(600);
        const ids = [];
        for (let i = 0; i < 9; i += 1) { inkDocAddLayer({}); ids.push(1); }
        return { layers: inkState().layers.length };
      })()`));
      report({ p: 'F1 kurulum 4K+10L', ms: Date.now() - wall0, ...r });
      await rbDagilim('F1 kurulum');
    }

    /* ==== F2: tüm renkler — palet çaprazlama çizim ==== */
    lastPhase = 'F2 renk çaprazlama';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, COMMON + ` (async () => {
        const RENK = ['#e6194b', '#f58231', '#ffe119', '#bfef45', '#3cb44b',
          '#42d4f4', '#4363d8', '#911eb4', '#f032e6', '#9a6324',
          '#800000', '#469990'];
        const L = inkState().layers.filter(l => l.kind === 'attached');
        let vurus = 0;
        for (let i = 0; i < L.length; i += 1) {
          inkState().activeLayerId = L[i].id;
          /* her katmanda 4 renk, geniş fırçalar, çakışan bölgeler */
          for (let k = 0; k < 4; k += 1) {
            const renk = RENK[(i * 4 + k) % RENK.length];
            await ciz(k % 2 ? 'ink-air' : 'ink-hard', k % 2 ? 110 : 55, renk,
              0.06 + i * 0.05, 0.3 + i * 0.05, 55);
            vurus++;
          }
        }
        for (let i = 0; i < 250 && inkEditorUi.strokeInFlight; i += 1) await wait(100);
        return { vurus, renkSayisi: RENK.length,
          strokes: inkState().layers.reduce((n, l) => n + (l.strokes || []).length, 0) };
      })()`));
      report({ p: 'F2 renk çaprazlama', ms: Date.now() - wall0, ...r });
      await rbDagilim('F2 çaprazlama');
    }

    /* ==== F3: SMUDGE KARIŞTIRMA FIRTINASI ==== */
    lastPhase = 'F3 smudge karıştırma';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, COMMON + ` (async () => {
        /* karıştıracak renklerin çakıştığı orta bantta dev smudge vuruşları:
           uzun çapraz geçişler + zigzag, hepsi tüm renk şeritlerinin üstünden */
        const L = inkState().layers.filter(l => l.kind === 'attached');
        let atis = 0;
        const t0 = Date.now();
        for (let i = 0; i < L.length; i += 1) {
          inkState().activeLayerId = L[i].id;
          for (let k = 0; k < 6; k += 1) {
            /* ciz y0→y1: yatay çapraz smudge; boy 160 = renk şeritlerini kapatır */
            await ciz('smudge', 160, '#000000',
              0.05 + (k % 3) * 0.15, 0.85 - (k % 3) * 0.15, 70);
            atis++;
          }
        }
        const smudgeMs = Date.now() - t0;
        for (let i = 0; i < 250 && inkEditorUi.strokeInFlight; i += 1) await wait(100);
        return { atis, smudgeMs,
          heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 };
      })()`));
      report({ p: 'F3 smudge karıştırma', ms: Date.now() - wall0, ...r });
      await rbDagilim('F3 smudge');
    }

    /* ==== F3.2: maske fırtınası (karışmış tuvalin üstüne maske ×12/3 katman) ==== */
    lastPhase = 'F3.2 maske fırtınası';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, COMMON + ` (async () => {
        const L = inkState().layers.filter(l => l.kind === 'attached');
        const masked = [L[0], L[2], L[4]];
        for (const ml of masked) {
          inkDocAddMask(ml.id, 'reveal');
          inkState().maskEditId = ml.id;
          await wait(120);
          for (let i = 0; i < 12; i += 1) {
            await ciz('ink-hard', 30, i % 2 ? '#ffffff' : '#000000', 0.15 + (i % 8) * 0.06, 0.22 + (i % 8) * 0.06, 20);
            await wait(60);
          }
          inkState().maskEditId = null;
        }
        await wait(500);
        return { maskedLayers: inkState().layers.filter(l => l.mask).length,
          srcLens: inkState().layers.filter(l => l.mask).map(l => l.mask.src.length) };
      })()`));
      report({ p: 'F3.2 maske ×36 vuruş/3L', ms: Date.now() - wall0, ...r });
      await rbDagilim('F3.2 maske');
    }

    /* ==== snapshot durumu ==== */
    lastPhase = 'F3.5 muhasebe';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `(() => {
        const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
        let snapKB = 0;
        for (const s of undoStack) snapKB += Math.round(s.length / 1024);
        return { heap, undoStack: undoStack.length, snapshotToplamKB: snapKB,
          undoBytes: inkUndoRaster.bytes,
          pool: typeof inkDualScratchStats === 'function' ? inkDualScratchStats() : null,
          snapTokens: { tokens: maskSnap.to.size,
            bytes: [...maskSnap.to.values()].reduce((n, s) => n + s.length * 2, 0) } };
      })()`));
      report({ p: 'F3.5 muhasebe', ms: Date.now() - wall0, ...r });
    }

    /* ==== F4: undo/redo SPAM 30 ms aralıklarla ~60 tur ==== */
    lastPhase = 'F4 undo/redo spam';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, COMMON + ` (async () => {
        const t0 = Date.now();
        let u = 0, rr = 0;
        for (let i = 0; i < 60 && (undoStack.length || redoStack.length); i += 1) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
          await wait(30); u++;
          if (i % 3 === 0) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
            await wait(30); rr++;
          }
        }
        return { u, rr, ms: Date.now() - t0,
          heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 };
      })()`));
      report({ p: 'F4 undo/redo spam', ms: Date.now() - wall0, ...r });
      await rbDagilim('F4 undo/redo');
    }

    /* ==== F5: zoom fırtınası (240 wheel) ==== */
    lastPhase = 'F5 zoom fırtınası';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, COMMON + ` (async () => {
        const t0 = Date.now();
        for (let i = 0; i < 120; i += 1) {
          canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 400, clientY: 300, deltaY: i % 2 ? 200 : -200 }));
          await wait(8);
        }
        return { ms: Date.now() - t0, zoom: Math.round(clamp(Number(inkEditorUi.view.zoom) || 1, 0, 99) * 100) / 100 };
      })()`));
      report({ p: 'F5 zoom ×120', ms: Date.now() - wall0, ...r });
      await rbDagilim('F5 zoom');
    }

    /* ==== F6: rAF jank + span muhasebesi ==== */
    lastPhase = 'F6 ölçüm';
    {
      const r = JSON.parse(await evaluate(ws, `(() => {
        const s = inkPerfSnapshot();
        const c = s.counters;
        const span = n => ({ n: c[n + 'Count'] || 0, avg: Math.round(((c[n + 'Ms'] || 0) / (c[n + 'Count'] || 1)) * 100) / 100, max: Math.round((c[n + 'MaxMs'] || 0) * 100) / 100 });
        return { heap: s.heap,
          commit: span('commit'), rebuild: span('rebuild'), undoSnap: span('undoSnap'),
          maskCommit: span('maskCommit'), maskEncode: span('maskEncode'),
          render: span('render'), tileFrm: span('tileFrame'), pyrSync: span('pyrSync'),
          scaledB: span('scaledBuild'), dirty: span('dirty'),
          dabs: c.dabs || 0 };
      })()`));
      report({ p: 'F6 span muhasebesi', ms: 0, ...r });
    }

    /* ==== F7: kapanma düzenliliği (editör kapat → havuz boşalt) ==== */
    lastPhase = 'F7 kapanış';
    {
      const wall0 = Date.now();
      const r = JSON.parse(await evaluate(ws, `( () => {
        if (typeof inkEditorClose === 'function') inkEditorClose();
        const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
        return { heap, pool: typeof inkDualScratchStats === 'function' ? inkDualScratchStats() : null,
          itemCanvases: inkRuntime.itemCanvases.size };
      })()`));
      report({ p: 'F7 kapanış düzenliliği', ms: Date.now() - wall0, ...r });
    }

    console.log('== ZORLAMA RAPORU ==');
    for (const p of phaseReport) console.log(JSON.stringify(p));
  } catch (e) {
    console.error('ZORLAMA: "' + lastPhase + '" fazında durdu: ' +
      (e && e.message ? e.message.slice(0, 300) : String(e)));
    try {
      if (ws) {
        const heap = await evaluate(ws, "performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1");
        console.log('çökme anında heap: ' + heap + ' MB');
      }
    } catch { /* son nefes ver alınamadı */ }
    console.error((e && e.stack ? e.stack : String(e)).slice(0, 400));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* son nefes */ }
  }
})();
