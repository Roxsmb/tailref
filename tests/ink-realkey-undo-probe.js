'use strict';

/* GERÇEK TUŞ undo sonda (CDP Input.dispatchKeyEvent — trusted klavye yolu).
   Paket exe'yi uzaktan hata ayıklamayla açar; vuruş boya, RAW Ctrl+Z
   gönderir; katman commit sayısını VE GÖRÜNÜR KANVAS piksellerini ölçer.
   AMAÇ: "çalışmıyor" ile "ekran tazelenmiyor" ayrımını bitirmek.
   Kullanım: node tests/ink-realkey-undo-probe.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'win-unpacked', 'TailRef Studio.exe');
const PORT = 9393;
const APP_PORT = 5241;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const withTimeout = (p, label, ms = 110000) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('AŞIM: ' + label)), ms)),
]);

const evaluate = (ws, expression, ms) => withTimeout(new Promise((resolve, reject) => {
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
}), 'evaluate', ms || 110000);

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-realkey-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, [`--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  try {
    let page = null;
    console.log('adım: exe açıldı, debug hattı bekleniyor...');
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && (t.url.includes(`:${APP_PORT}`) || t.url.includes('app.asar')));
        if (page) break;
      } catch { /* yok */ }
      await sleep(500);
    }
    if (!page) { console.error('sayfa bulunamadı'); app.kill(); process.exit(2); }
    console.log('adım: sayfa bulundu → ws bağlanıyor');
    const ws = new WebSocket(page.webSocketDebuggerUrl.replace('ws://127.0.0.1', 'ws://localhost'));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    console.log('adım: ws açıldı');

    console.log('adım: sahne kuruluyor (UI bekleme + kanva önişlem)...');
    const setup = JSON.parse(await evaluate(ws, `(async () => {
      window.__err = [];
      window.addEventListener('error', e => window.__err.push(String(e.message)));
      window.addEventListener('unhandledrejection', e => window.__err.push('P: ' + String(e.reason)));
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 120 && !document.getElementById('modeDrawBtn'); i += 1) await wait(250);
      if (!document.getElementById('modeDrawBtn')) return JSON.stringify({ fail: 2, stamp: (window.tailref && window.tailref.getBuildStamp) ? await window.tailref.getBuildStamp() : '' });
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
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1400';
      document.getElementById('newCanvasName').value = 'Gerçek Tuş Sonda';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      if (!inkEditorIsOpen()) return JSON.stringify({ fail: 1, stamp: '' });
      const s = inkState();
      s.size = 22; s.color = '#f0871d';
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
      window.__pixStat = () => {
        const c = document.getElementById('inkEditorCanvas');
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(0, 0, c.width, c.height).data;
        let total = 0, left = 0, right = 0, top = 0, bot = 0;
        const W = c.width, H = c.height;
        for (let y = 0; y < H; y += 3) {
          for (let x = 0; x < W; x += 3) {
            const a = img[(y * W + x) * 4 + 3];
            if (a > 12) {
              total += 1;
              if (x < W / 2) left += 1; else right += 1;
              if (y < H / 2) top += 1; else bot += 1;
            }
          }
        }
        return { total, left, right, top, bot, W, H };
      };
      const stamp = (window.tailref && window.tailref.getBuildStamp) ? await window.tailref.getBuildStamp() : '';
      return JSON.stringify({ ok: 1, stamp });
    })()`, 240000));
    if (!setup.ok) { console.log('HATA: sahne kurulamadı', JSON.stringify(setup)); app.kill(); return; }
    console.log('yapı damgası:', setup.stamp);

    const pre = JSON.parse(await evaluate(ws, `(async () => {
      const owner = inkDocOwnerId() || '';
      const layer0 = inkDocLayersTopFirst(owner)[0];
      const base = window.__pixStat();
      for (let k = 0; k < 5; k += 1) {
        const y = 80 + k * 60;
        await window.__draw({ x0: 40, x1: 2300, y0: y, y1: y });
        await new Promise(r => setTimeout(r, 60));
      }
      const after = window.__pixStat();
      const rec = inkDocLayersTopFirst(owner).find(l => l.id === layer0.id);
      return JSON.stringify({
        commits: (rec.strokes || []).length,
        undoStack: undoStack.length,
        base, after,
        errs: window.__err.slice(0, 5),
      });
    })()`));
    console.log('vuruş sonrası:', JSON.stringify(pre));

    for (let i = 1; i <= 3; i += 1) {
      await cdp(ws, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown', modifiers: 2, key: 'z', code: 'KeyZ',
        windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90,
      });
      await cdp(ws, 'Input.dispatchKeyEvent', {
        type: 'keyUp', modifiers: 2, key: 'z', code: 'KeyZ',
        windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90,
      });
      await sleep(350);
      const st = JSON.parse(await evaluate(ws, `(async () => {
        const owner = inkDocOwnerId() || '';
        const layer0 = inkDocLayersTopFirst(owner)[0];
        const pix = window.__pixStat();
        const notice = document.getElementById('projectNotice');
        return JSON.stringify({
          commits: layer0 ? (layer0.strokes || []).length : -1,
          undoStack: undoStack.length,
          redoStack: redoStack.length,
          pix,
          notice: notice ? notice.textContent : '',
          noticeVisible: !!(notice && notice.classList.contains('is-visible')),
          errs: window.__err.slice(0, 5),
        });
      })()`));
      console.log(`RAW Ctrl+Z #${i}:`, JSON.stringify(st));
      if (i === 1) console.log('  ↓ beklenen: commits ' + pre.commits + ' → ' + (pre.commits - 1) +
        ' · pix.total azalmalı (son vuruş bölgesi 40-2300 arası tüm genişlik)');
    }

    console.log('SONUÇ ÖZETİ: vuruş=' + pre.commits +
      ' · pix vuruşsonu=' + pre.after.total);
    app.kill();
    process.exit(0);
  } catch (e) {
    console.error('SONDA HATASI: ' + e);
    try { app.kill(); } catch { /* */ }
    process.exit(3);
  }
})();
