'use strict';

/* Tur 2 madde 5 · kare çip parite doğrulaması: bir vuruşun commit karesi
   bölgesel boyandıktan SONRA sahne tam yola zorlanır ve aynı bölgedeki
   pikseller karşılaştırılır. Bölge EŞİT çıkmalı (kutu içi byte-parite),
   bölge dışı da EŞİT çıkmalı (bölgesel boya dışarıya dokunmuyor).
   Kullanım: node tests/ink-framechip-parity.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9358;
const APP_PORT = 5241;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const evaluate = (ws, expression, timeoutMs = 60000) => new Promise((resolve, reject) => {
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    ws.removeEventListener('message', onMsg);
    reject(new Error('zaman aşımı'));
  }, timeoutMs);
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    clearTimeout(timer);
    done = true;
    ws.removeEventListener('message', onMsg);
    if (m.error) return reject(new Error(JSON.stringify(m.error)));
    if (m.result.exceptionDetails) {
      return reject(new Error(m.result.exceptionDetails.exception?.description || 'eval'));
    }
    resolve(m.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true } }));
});

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'framechip-parity-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    let page = null;
    for (let i = 0; i < 120; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
        if (page) break;
      } catch { /* yok */ }
      await sleep(100);
    }
    if (!page) { console.log('HATA: sayfa yok'); return; }
    const ws = await new Promise((res, rej) => {
      const s = new WebSocket(page.webSocketDebuggerUrl);
      s.onopen = () => res(s);
      s.onerror = rej;
    });
    for (let i = 0; i < 40; i += 1) {
      const ok = await evaluate(ws, "typeof inkState === 'function' && typeof inkDocAddLayer === 'function'").catch(() => false);
      if (ok) break;
      await sleep(400);
    }

    /* Kurulum: hotpath sondasıyla aynı sahne (2560×1400, 20 katman).
       Bu kurulumda karo ızgarası varsayılan AÇIK gelir — asıl senaryo. */
    const setup = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
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
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1400';
      document.getElementById('newCanvasName').value = 'Parite Deney';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !(typeof inkEditorIsOpen === 'function' && inkEditorIsOpen()); i += 1) await wait(100);
      await wait(500);
      const open = inkDocOwnerId() || '';
      const base = inkDocLayers(open).length;
      for (let i = base; i < 20; i += 1) inkDocAddLayer();
      await wait(300);
      return JSON.stringify({
        open: inkEditorIsOpen(),
        katman: inkDocLayers(open).length,
        tiles: !!(inkEditorUi && inkEditorUi.tileViewOn),
      });
    })()`);
    console.log('kuruluş: ' + setup);

    /* Senaryo: vuruş çiz → commit karesi bitince bölge pikselini al →
       tam yola zorla → yeniden al → karşılaştır. Bölge ekran CSS px; okuma
       cihaz px'e dpr ile taşınır. */
    const result = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const raf = async (n) => { for (let i = 0; i < n; i += 1) await new Promise(r => requestAnimationFrame(r)); };
      const open = inkDocOwnerId() || '';
      inkDocSelectLayer(inkDocLayersTopFirst(open).map(l => l.id)[0]);
      const ink = inkState();
      ink.size = 28; ink.color = '#e8c060';
      setActiveBrush && setActiveBrush('native-studio-pen');
      const cv = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const dpr = inkEditorUi.dpr || 1;
      const fire = (type, x, y, press) => {
        cv.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 91, pointerType: 'pen',
          clientX: x, clientY: y, button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: press, tiltX: 0, tiltY: 0, twist: 0,
        }));
      };
      const x0 = fit.x + fit.w * 0.12, y0 = fit.y + fit.h * 0.3;
      fire('pointerdown', x0, y0, 0.3);
      const md = 14;
      for (let i = 1; i <= md; i += 1) {
        const t = i / md;
        fire('pointermove', x0 + fit.w * 0.5 * t, y0 + Math.sin(t * 6.3) * 12, 0.3 + 0.5 * Math.sin(t * Math.PI));
        if (i % 4 === 0) await raf(1);
      }
      fire('pointerup', x0 + fit.w * 0.5, y0, 0);
      await raf(5);           // commit karesi + karo yakınsaması bitmeli
      await wait(120);
      const ui = inkEditorUi;
      // Bölge: vuruş bandını kaplayan ekran kutusu (fit tabanlı).
      const bx0 = fit.x + fit.w * 0.08, by0 = fit.y + fit.h * 0.24;
      const bw0 = fit.w * 0.60, bh0 = fit.h * 0.16;
      const fnv = (d) => {
        let h = 0x811c9dc5;
        for (let i = 0; i < d.length; i += 1) {
          h ^= d[i]; h = (h * 0x01000193) >>> 0;
        }
        return h >>> 0;
      };
      const dig = (box) => {
        const dx = Math.round(box.x * dpr), dy = Math.round(box.y * dpr);
        const dw = Math.round(box.w * dpr), dh = Math.round(box.h * dpr);
        const g = ui.canvas.getContext('2d');
        const data = g.getImageData(dx, dy, dw, dh).data;
        return fnv(data) + ':' + dw + 'x' + dh;
      };
      const bölge1 = dig({ x: bx0, y: by0, w: bw0, h: bh0 });
      const ref = ui.canvas.getContext('2d')
        .getImageData(Math.round(bx0 * dpr), Math.round(by0 * dpr),
          Math.round(bw0 * dpr), Math.round(bh0 * dpr)).data;
      const üst1 = dig({ x: fit.x, y: fit.y, w: fit.w, h: 10 });           // bölge dışı üst şerit
      const üst2 = dig({ x: fit.x, y: fit.y + fit.h - 10, w: fit.w, h: 10 }); // bölge dışı alt şerit
      // tam yola zorla: anahtarları bayatla → sonraki kare tam yol + karo reset
      ui.sceneFitKey = 'zorla';
      ui.sceneLayersKey = 'zorla';
      inkEditorInvalidate();
      await raf(5);
      await wait(120);
      const bölge2 = dig({ x: bx0, y: by0, w: bw0, h: bh0 });
      const üst1b = dig({ x: fit.x, y: fit.y, w: fit.w, h: 10 });
      const üst2b = dig({ x: fit.x, y: fit.y + fit.h - 10, w: fit.w, h: 10 });
      // tanı: bölge içi hangi pikseller farklı? satır başına fark sayısı
      // + en büyük kanal farkı — kenar bandı (çip ±2px) mi, iç mi?
      const dx = Math.round(bx0 * dpr), dy = Math.round(by0 * dpr);
      const dw = Math.round(bw0 * dpr), dh = Math.round(bh0 * dpr);
      const g = ui.canvas.getContext('2d');
      const d1 = g.getImageData(dx, dy, dw, dh).data;
      const rowY = []; let maxChan = 0, diffCount = 0;
      for (let yy = 0; yy < dh; yy += 1) {
        let c = 0;
        for (let xx = 0; xx < dw; xx += 1) {
          for (let cc = 0; cc < 4; cc += 1) {
            const a = d1[(yy * dw + xx) * 4 + cc];
            if (a !== ref[(yy * dw + xx) * 4 + cc]) {
              c += 1; diffCount += 1;
              maxChan = Math.max(maxChan, Math.abs(a - ref[(yy * dw + xx) * 4 + cc]));
            }
          }
        }
        if (c) rowY.push(yy);
      }
      return JSON.stringify({
        tiles: !!ui.tileViewOn,
        bölgeEşit: bölge1 === bölge2,
        üstEşit: üst1 === üst1b,
        altEşit: üst2 === üst2b,
        farkPiksel: diffCount, maxFark: maxChan,
        satırİlk: rowY.slice(0, 6), satırSon: rowY.slice(-6),
        satırSayısı: rowY.length, bölgeH: dh,
      });
    })()`, 120000));
    console.log('parite: ' + JSON.stringify(result));
  } catch (e) {
    console.error('HATA:', e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(200);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
