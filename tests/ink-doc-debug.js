'use strict';

/* Doc/bake semantiği + ekran görüntüsü hatası mini sonda:
   • 3 katman, her katmana ayrı sayıda vuruş
   • Her vuruş sonrası doc sayımını yaz
   • inkDocLayersTopFirst çıktısının gerçek şeklini yaz
   • captureScreenshot hatasının ham cevabını yaz
   Kullanım: node tests/ink-doc-debug.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9346;
const APP_PORT = 5236;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-docdbg-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  try {
    let page = null;
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
        if (page) break;
      } catch { /* */ }
      await sleep(400);
    }
    const ws = await new Promise((resolve, reject) => {
      const s = new WebSocket(page.webSocketDebuggerUrl);
      s.onopen = () => resolve(s);
      s.onerror = reject;
    });
    for (let i = 0; i < 40; i += 1) {
      const ok = await evaluate(ws, "typeof inkDocAddLayer === 'function'");
      if (ok) break;
      await sleep(400);
    }

    const setup = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      /* İlk açılış "Kayıt modunu seç" perdesini kökten çöz */
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
      document.getElementById('newCanvasW').value = '1280';
      document.getElementById('newCanvasH').value = '800';
      document.getElementById('newCanvasName').value = 'Doc Debug';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(400);
      const o = { owner: inkDocOwnerId() || '' };
      window.__owner = o.owner;
      window.__order = inkDocLayersTopFirst(o.owner).map(l => l.id).reverse();
      const cv = document.getElementById('inkEditorCanvas');
      const rect = cv.getBoundingClientRect();
      o.rect = { l: rect.left, t: rect.top, w: rect.width, h: rect.height };
      window.__res = { rect: o.rect };
      window.__draw = async (moves) => {
        const rr = window.__res.rect;
        let work = 0;
        const fire = (type, x, y) => {
          const t = performance.now();
          cv.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
            clientX: rr.l + x, clientY: rr.t + y, button: 0,
            buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5,
            tiltX: 0, tiltY: 0, twist: 0,
          }));
          work += performance.now() - t;
        };
        fire('pointerdown', rr.w * 0.2, rr.h * (0.2 + Math.random() * 0.6));
        for (let i = 1; i <= moves; i += 1) {
          fire('pointermove', rr.w * (0.2 + 0.6 * i / moves), rr.h * (0.2 + Math.random() * 0.6));
          if (i % 4 === 0) await new Promise(r => setTimeout(r, 2));
        }
        fire('pointerup', rr.w * 0.8, rr.h * (0.2 + Math.random() * 0.6));
        await new Promise(r => requestAnimationFrame(r));
        return work;
      };
      return JSON.stringify(o);
    })()`));
    console.log('sahne:', setup);

    const out = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const o = { owner: window.__owner };
      o.orderCollection = {
        keys: Object.keys(inkDocLayersTopFirst(window.__owner)[0] || {}),
        ids: inkDocLayersTopFirst(window.__owner).map(l => l.id),
        order: window.__order,
      };
      const lines = [];
      const perLayer = [[10, 0, 0], [6, 0, 0], [0, 4, 0], [0, 0, 9]];
      for (let li = 0; li < 3; li += 1) {
        const layerId = window.__order[li];
        inkDocSelectLayer(layerId);
        const counts = perLayer.map(_ => null);
        for (let s = 0; s < perLayer[li].length; s += 1) {
          const target = perLayer[li][s];
          for (let k = 0; k < target; k += 1) await window.__draw(8);
          await wait(150);
          const rec = inkDocLayersTopFirst(window.__owner).find(x => x.id === layerId);
          counts[s] = rec ? (rec.strokes || []).length : 'bulunamadı';
        }
        lines.push('katman[' + li + '] id=' + layerId + ' → docSayımAşamalı=' + JSON.stringify(counts));
        const sel = inkDocSelectedLayer(window.__owner);
        lines.push('  seçili=' + (sel ? sel.id + (sel.strokes ? ' sayaç=' + sel.strokes.length : '') : 'null'));
      }
      o.lines = lines;
      /* bake görünümü: son durum bütün katmanlar */
      o.final = inkDocLayersTopFirst(window.__owner).map(l =>
        ({ id: l.id, n: (l.strokes || []).length, pts: (l.strokes || []).reduce((a, s2) => a + (s2.points || []).length, 0) }));
      return JSON.stringify(o);
    })()`));
    console.log('sahne vuruşları anlık durum:', JSON.stringify(out.orderCollection));
    (out.lines || []).forEach(x => console.log(x));
    console.log('final:', JSON.stringify(out.final));

    /* screenshot ham hata gösterimi */
    const shotRes = await new Promise(res => {
      const idm = Math.floor(Math.random() * 1e6);
      const f = ev => {
        const m = JSON.parse(ev.data);
        if (m.id !== idm) return;
        ws.removeEventListener('message', f);
        res({ hasError: !!m.error, error: m.error || null,
          hasException: !!(m.result && m.result.exceptionDetails),
          exception: m.result && m.result.exceptionDetails || null,
          hasData: !!(m.result && m.result.result && m.result.result.data),
          dataLen: m.result && m.result.result && m.result.result.data ? m.result.result.data.length : 0,
        });
      };
      ws.addEventListener('message', f);
      ws.send(JSON.stringify({ id: idm, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });
    console.log('screenshot cevabı:', JSON.stringify(shotRes));
    if (shotRes.hasData) {
      // veri geldi; tekrar sayım: bake görüntüsü sonrası
      const after = JSON.parse(await evaluate(ws, `(async () => {
        await new Promise(r => requestAnimationFrame(r));
        return JSON.stringify(inkDocLayersTopFirst(window.__owner).map(l =>
          ({ id: l.id, n: (l.strokes || []).length })));
      })()`));
      console.log('screenshot sonrası final:', JSON.stringify(after));
    }
  } catch (e) {
    console.error('HATA:', e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
