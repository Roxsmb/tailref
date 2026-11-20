'use strict';

/* Paket uygulama undo sonda:
   win-unpacked exe'yi remote debugging ile açar; ağır vuruş boyar,
   doc sayımını izler, Ctrl+Z gönderir ve undoStack/token durumunu
   + çalışma zamanı hatalarını toplar.
   Kullanım: node tests/ink-packaged-undo-probe.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'win-unpacked', 'TailRef Studio.exe');
const PORT = 9381;
const APP_PORT = 5241;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (m.error) return reject(new Error(JSON.stringify(m.error)));
    if (m.result.exceptionDetails) {
      return reject(new Error(m.result.exceptionDetails.exception?.description || 'eval'));
    }
    resolve(m.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-undop-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, [`--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  try {
    let page = null;
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && (t.url.includes(`:${APP_PORT}`) || t.url.includes('app.asar')));
        if (page) break;
      } catch { /* yok */ }
      await sleep(500);
    }
    if (!page) { console.error('sayfa bulunamadı'); app.kill(); process.exit(2); }
    const ws = new WebSocket(page.webSocketDebuggerUrl.replace('ws://127.0.0.1', 'ws://localhost'));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    // hata kapanı + sahnenin kurulumu
    const setup = JSON.parse(await evaluate(ws, `(async () => {
      window.__err = [];
      window.addEventListener('error', e => window.__err.push(String(e.message)));
      window.addEventListener('unhandledrejection', e => window.__err.push('P: ' + String(e.reason)));
      const wait = ms => new Promise(r => setTimeout(r, ms));
      /* UI hazır olana dek bekle (paket exe ilk boyu soğuk açılıyor) */
      for (let i = 0; i < 120 && !document.getElementById('modeDrawBtn'); i += 1) await wait(250);
      if (!document.getElementById('modeDrawBtn')) return JSON.stringify({ fail: 2, href: location.href });
      const pw = document.getElementById('persistenceWelcome');
      if (pw && !pw.hidden) {
        const opt = pw.querySelector('.pwOption');
        if (opt) opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const cont = document.getElementById('pwContinue');
        if (cont && !cont.disabled) cont.click(); await wait(300);
        if (!pw.hidden) pw.hidden = true;
      }
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1400';
      document.getElementById('newCanvasName').value = 'Undo Sonda';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      if (!inkEditorIsOpen()) { return JSON.stringify({ fail: 1 }); }
      const s = inkState();
      s.size = 22; s.color = '#f0c98d';
      const cv = document.getElementById('inkEditorCanvas');
      const rr = cv.getBoundingClientRect();
      window.__res = { l: rr.left, t: rr.top, w: rr.width, h: rr.height };
      window.__draw = async (spec) => {
        const fire = (type, x, y, press) => cv.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
          clientX: rr.left + x, clientY: rr.top + y, button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: type === 'pointerup' ? 0 : press, tiltX: 0, tiltY: 0, twist: 0,
        }));
        fire('pointerdown', spec.x0, spec.y0, 0.3);
        for (let i = 1; i <= 24; i += 1) {
          fire('pointermove', spec.x0 + (spec.x1 - spec.x0) * i / 24, spec.y0, 0.4);
          if (i % 4 === 0) await new Promise(r => setTimeout(r, 2));
        }
        fire('pointerup', spec.x1, spec.y0, 0);
        await new Promise(r => requestAnimationFrame(r));
      };
      return JSON.stringify({ ok: 1 });
    })()`));
    if (!setup.ok) { console.log('HATA: sahne kurulamadı'); app.kill(); return; }

    // 5 ağır vuruş boy
    const pre = JSON.parse(await evaluate(ws, `(async () => {
      const owner = inkDocOwnerId() || '';
      const layer0 = inkDocLayersTopFirst(owner)[0];
      inkDocSelectLayer(layer0.id);
      for (let k = 0; k < 5; k += 1) {
        const y = 80 + k * 60;
        await window.__draw({ x0: 120, x1: 900, y0: y, y1: y });
        await new Promise(r => setTimeout(r, 60));
      }
      const rec = inkDocLayersTopFirst(owner).find(l => l.id === layer0.id);
      return JSON.stringify({
        commits: (rec.strokes || []).length,
        undoStack: undoStack.length,
        redoStack: redoStack.length,
        rasterTokens: typeof inkUndoRaster !== 'undefined' ? inkUndoRaster.entries.size : -1,
        errs: window.__err.slice(0, 5),
      });
    })()`));
    console.log('vuruş sonrası:', JSON.stringify(pre));

    // Ctrl+Z × 3
    for (let i = 0; i < 3; i += 1) {
      await evaluate(ws, `(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(r2 => requestAnimationFrame(r2));
        await new Promise(r => setTimeout(r, 120));
        return JSON.stringify({
          undoStack: undoStack.length,
          rasterTokens: typeof inkUndoRaster !== 'undefined' ? inkUndoRaster.entries.size : -1,
          errs: window.__err.slice(0, 5),
        });
      })()`);
    }
    const after = JSON.parse(await evaluate(ws, `(() => {
      const owner = inkDocOwnerId() || '';
      const layer0 = inkDocLayersTopFirst(owner)[0];
      return JSON.stringify({
        commitAfter: layer0 ? (layer0.strokes || []).length : -1,
        redoStack: redoStack.length,
        rasterTokens: typeof inkUndoRaster !== 'undefined' ? inkUndoRaster.entries.size : -1,
        errs: window.__err.slice(0, 8),
      });
    })()`));
    console.log('undo sonrası:', after);
    console.log('SONUÇ: vuruş=' + pre.commits + ' → undo sonrası=' + after.commitAfter +
      ' (beklenen ' + (pre.commits - 3) + ') · hata=' + (after.errs ? after.errs.length : 'yok'));
    app.kill();
    process.exit(after.commitAfter === pre.commits - 3 ? 0 : 3);
  } catch (e) {
    console.error('SONDA HATASI: ' + e);
    try { app.kill(); } catch { /* */ }
    process.exit(3);
  }
})();
