'use strict';

/* GÖRSEL undo sonda — kullanıcının raporunu birebir kopyalar:
   sarı vuruş → siyah vuruş (kesişen) → Ctrl+Z → ekran farkı.
   Çıktı: ekran görüntüleri (before/after PNG) + piksel bölge sayıları
   + undo yolu kanıtı (commit sayısı, çip çağrısı).
   Kullanım: node tests/ink-undo-visual-probe.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'win-unpacked', 'TailRef Studio.exe');
const PORT = 9398;
const APP_PORT = 5241;
const OUT_DIR = path.join(os.tmpdir(), 'ink-undo-visual');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const withTimeout = (p, label, ms = 240000) => Promise.race([
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
}), 'evaluate', ms || 240000);

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
  try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch { /* */ }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-visual-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, [`--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  try {
    let page = null;
    console.log('adım 1: debug hattı bekleniyor');
    for (let i = 0; i < 180; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && (t.url.includes(`:${APP_PORT}`) || t.url.includes('app.asar')));
        if (page) break;
      } catch { /* yok */ }
      await sleep(500);
    }
    if (!page) { console.error('sayfa bulunamadı'); app.kill(); process.exit(2); }
    console.log('adım 2: sayfa bulundu, ws bağlanıyor');
    const ws = new WebSocket(page.webSocketDebuggerUrl.replace('ws://127.0.0.1', 'ws://localhost'));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    console.log('adım 3: ws açıldı');

    // AŞAMA A — UI hazır mı (kaba bekleyiş, kayıtsız)
    await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 240 && !document.getElementById('modeDrawBtn'); i += 1) await wait(250);
      return document.getElementById('modeDrawBtn') ? 'ui-ok' : 'ui-yok';
    })()`).then(v => console.log('adım 4: UI = ' + v));

    // AŞAMA B — hoş karşılama pencerelerini geç
    await evaluate(ws, `[...document.querySelectorAll('#persistenceWelcome')].forEach(pw => {
      if (pw && !pw.hidden) {
        const opt = pw.querySelector('.pwOption');
        if (opt) opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const cont = document.getElementById('pwContinue');
        if (cont && !cont.disabled) cont.click();
        pw.hidden = true;
      }
    }); 'karşılama geçildi'`).then(v => console.log('adım 5: ' + v));

    // AŞAMA C — çizim editörünü aç (ayrı değerlendirme → tıkanırsa burada bilinir)
    const open = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      const modal = document.getElementById('newCanvasModal');
      if (!modal) return 'modal yillk';
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1400';
      document.getElementById('newCanvasName').value = 'Görsel Sonda';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 200 && !inkEditorIsOpen(); i += 1) await wait(100);
      return inkEditorIsOpen() ? 'editör-open' : 'editör-açılmadı';
    })()`));
    console.log('adım 6: ' + open);
    if (!open.includes('open')) { console.log('ÇIKIŞ: editör açılamadı'); app.kill(); process.exit(4); }

    // şemik kurulum: sarı/siyah fırça + çip yazıcıları
    await evaluate(ws, `(() => {
      window.__err = [];
      window.addEventListener('error', e => window.__err.push(String(e.message)));
      const s = inkState();
      s.size = 30;
      const cv = document.getElementById('inkEditorCanvas');
      const rr = cv.getBoundingClientRect();
      window.__res = { l: rr.left, t: rr.top, w: rr.width, h: rr.height };
      window.__draw = async (color, x0, y0, x1, y1) => {
        s.color = color;
        const fire = (type, x, y, press) => cv.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
          clientX: rr.left + x, clientY: rr.top + y, button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: type === 'pointerup' ? 0 : press, tiltX: 0, tiltY: 0, twist: 0,
        }));
        fire('pointerdown', x0, y0, 0.35);
        for (let i = 1; i <= 20; i += 1) {
          fire('pointermove', x0 + (x1 - x0) * i / 20, y0 + (y1 - y0) * i / 20, 0.45);
          if (i % 5 === 0) await new Promise(r => setTimeout(r, 4));
        }
        fire('pointerup', x1, y1, 0);
        await new Promise(r => requestAnimationFrame(r));
      };
      window.__chipLog = [];
      const origAfter = inkEditorAfterRestore;
      inkEditorAfterRestore = function (chip) {
        window.__chipLog.push(chip ? { x: chip.x, y: chip.y, w: chip.w, h: chip.h,
          spaceW: chip.spaceW, spaceH: chip.spaceH, owner: chip.ownerId } : null);
        return origAfter.apply(this, arguments);
      };
      return 'kurulu';
    })()`);
    console.log('adım 7: sonda kurulu');

    // SARI vuruş (geniş, sol-orta) + SİYAH vuruş (kesişen sağ)
    await evaluate(ws, `(async () => {
      await window.__draw('#ffe066', 200, 200, 1800, 500);
      await new Promise(r => setTimeout(r, 300));
      await window.__draw('#101014', 1200, 350, 2300, 900);
      await new Promise(r => setTimeout(r, 400));
      const owner = inkDocOwnerId() || '';
      const layer0 = inkDocLayersTopFirst(owner)[0];
      return JSON.stringify({ commits: (layer0.strokes || []).length,
        undoStack: undoStack.length, chipLog: window.__chipLog });
    })()`, 120000).then(v => console.log('adım 8 (iki vuruş): ' + v));

    const shot1 = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, 'before_undo.png'), Buffer.from(shot1.data, 'base64'));
    console.log('adım 9: önce ekran görüntüsü kaydedildi');

    // RAW Ctrl+Z (klavye hattı)
    await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
    await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
    await sleep(700);

    const shot2 = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, 'after_undo.png'), Buffer.from(shot2.data, 'base64'));
    console.log('adım 10: sonra ekran görüntüsü kaydedildi');

    const final = JSON.parse(await evaluate(ws, `(() => {
      const owner = inkDocOwnerId() || '';
      const layer0 = inkDocLayersTopFirst(owner)[0];
      return JSON.stringify({ commits: layer0 ? (layer0.strokes || []).length : -1,
        undoStack: undoStack.length, redoStack: redoStack.length,
        chipLog: window.__chipLog, errs: window.__err.slice(0, 5) });
    })()`));
    console.log('SONUÇ:', JSON.stringify(final));
    console.log('GÖRSELLER: ' + OUT_DIR + ' (before_undo.png / after_undo.png)');
    app.kill();
    process.exit(0);
  } catch (e) {
    console.error('SONDA HATASI: ' + e);
    try { app.kill(); } catch { /* */ }
    process.exit(3);
  }
})();
