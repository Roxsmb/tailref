'use strict';

/* drawImage/yeniden boyama atıf tanısı: ağır vuruş + undo sırasında
   drawImage çağrılarının hangi yollardan geldiğini sayar ve toplam
   kesik (stack) sayar. Kirli-bölge işinin hedefini ikna eder.
   Kullanım: node tests/ink-drawimage-attrib.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9357;
const APP_PORT = 5241;
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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawimg-attrib-'));
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
      } catch { /* */ }
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

    /* kurulum: hotpath sonda'sı ile aynı sahne (2560×1400, 20 katman) */
    let setupRaw = 'kurulus-yok';
    try {
      setupRaw = await evaluate(ws, `(async () => {
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
      document.getElementById('newCanvasName').value = 'Atıf Tanı';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !(typeof inkEditorIsOpen === 'function' && inkEditorIsOpen()); i += 1) await wait(100);
      await wait(500);
      const open = inkDocOwnerId() || '';
      const base = inkDocLayers(open).length;
      for (let i = base; i < 20; i += 1) inkDocAddLayer();
      await wait(300);
      window.__attr = {
        n: 0, bytes: 0,
        oylar: new Map(),
        stage: null,
      };
      const proto = CanvasRenderingContext2D.prototype;
      const orig = proto.drawImage;
      proto.drawImage = function (...args) {
        const g = window.__attr;
        g.n += 1;
        const a = args[0];
        const aw = a && (a.width || 0) * (a.height || 0) * 4;
        g.bytes += aw || 0;
        let head = '(canvas)';
        try {
          const st = (new Error()).stack.split('\\n').slice(2, 5);
          head = st.map(s => (s.trim().replace(/^at\\s+/, '').split(' (')[0] || '').replace('@chrome-extension:///#', '@'))
            .filter(Boolean).slice(0, 3).join(' <- ');
        } catch { /* */ }
        // hangi tuvale basıyor — hedef tuvalin kimliğini bilmez; sadece
        // kaynak tuvalin adından yürüyelim.
        const srcName = a && a.dataset && (a.dataset.inkLayer ? ('layer:' + a.dataset.inkLayer.slice(-6))
          : a.className ? String(a.className).slice(0, 24) : (a.id || 'anon'));
        const key = head + ' · src=' + srcName;
        g.oylar.set(key, (g.oylar.get(key) || 0) + 1);
        return orig.apply(this, args);
      };
      return JSON.stringify({ open: inkEditorIsOpen(), katman: inkDocLayers(open).length, gl: !!(inkEditorUi && inkEditorUi.previewGl) || 'kapali-baslangic' });
    })()`);
    } catch (e) { setupRaw = 'kurulum-hata: ' + e.message; }
    console.log('kuruluş: ' + setupRaw);

    /* A) 60 ağır vuruş (vuruş anlı kare akışındaki drawImage dağılımı) */
    let strokes = 'vurus-yok';
    try {
      strokes = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const open = inkDocOwnerId() || '';
      const layerId = inkDocLayersTopFirst(open).map(l => l.id)[0];
      inkDocSelectLayer(layerId);
      const ink = inkState();
      ink.size = 28; ink.color = '#e8c060';
      setActiveBrush && setActiveBrush('native-studio-pen');
      const cv = document.getElementById('inkEditorCanvas');
      const rr = cv.getBoundingClientRect();
      const fit = (inkEditorUi && inkEditorUi.fit) || inkEditorComputeFit();
      const fire = (type, x, y, press) => {
        cv.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 77, pointerType: 'pen',
          clientX: x, clientY: y, button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: press, tiltX: 0, tiltY: 0, twist: 0,
        }));
      };
      const t0 = performance.now();
      const basla = (window.__attr.n);
      for (let k = 0; k < 60; k += 1) {
        const x0 = fit.x + fit.w * 0.1, y0 = fit.y + fit.h * (0.2 + (k % 8) * 0.07);
        fire('pointerdown', x0, y0, 0.3);
        const md = 16;
        for (let i = 1; i <= md; i += 1) {
          const t = i / md;
          fire('pointermove', x0 + fit.w * 0.55 * t, y0 + Math.sin(t * 6.3) * 8, 0.35 + 0.5 * Math.sin(t * Math.PI));
          if (i % 4 === 0) await wait(2);
        }
        fire('pointerup', x0 + fit.w * 0.55, y0, 0);
        await new Promise(r => requestAnimationFrame(r));
        await wait(25);
      }
      return JSON.stringify({ ms: Math.round(performance.now() - t0), veN: window.__attr.n - basla });
    })()`, 120000);
    } catch (e) { strokes = 'vurus-hata: ' + e.message; }
    console.log('A) 60 vuruş: ' + strokes);

    /* B) 3 undo (undo sırasında drawImage dağılımı) */
    let undoRes = 'undo-yok';
    try {
      undoRes = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const basla = window.__attr.n;
      const t0 = performance.now();
      for (let i = 0; i < 3; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(r => requestAnimationFrame(r));
        await wait(60);
      }
      return JSON.stringify({ ms: Math.round(performance.now() - t0), veN: window.__attr.n - basla });
    })()`, 60000);
    } catch (e) { undoRes = 'undo-hata: ' + e.message; }
    console.log('B) 3 undo: ' + undoRes);

    /* C) dağılım raporu */
    let report = 'rapor-yok';
    try {
      report = await evaluate(ws, `(() => {
      const g = window.__attr;
      const list = [...g.oylar.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)
        .map(([k, n]) => n + ' × ' + k);
      return JSON.stringify({ toplam: g.n, MB: Math.round(g.bytes / 1048576), list });
    })()`);
    } catch (e) { report = 'rapor-hata: ' + e.message; }
    console.log('C) dağılım: ' + report);
  } catch (e) {
    console.error('HATA:', e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(200);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
