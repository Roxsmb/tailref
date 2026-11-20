'use strict';

/* KULLANICISureli undoktörü (*undo döngüsü ölçümü).
   Ken vurgusu:  Kullanıcı normal çizip test eder; benakan ( ben
   uzaktan ölçü alırız: tuşlar, undo çağrısı, piksel değerleri).
   Kullanıcıющиеся бы d о Mayer maзаром:
   node tests/ink-user-session-probe.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'win-unpacked', 'TailRef Studio.exe');
const PORT = 9396;
const APP_PORT = 5241;
const SESSION_MS = 6 * 60 * 1000; // 6 dakika ölçüm penceresi
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-user-session-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, [`--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  console.log('[ölçüm] uygulama açılıyor — pencere göründüğünde seni test etmeye başlabilirsin.');

  try {
    let page = null;
    for (let i = 0; i < 180; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && (t.url.includes(`:${APP_PORT}`) || t.url.includes('app.asar')));
        if (page) break;
      } catch { /* yok */ }
      await sleep(500);
    }
    if (!page) { console.error('[ölçüm] sayfa bulunamadı'); app.kill(); process.exit(2); }
    const ws = new WebSocket(page.webSocketDebuggerUrl.replace('ws://127.0.0.1', 'ws://localhost'));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    console.log('[ölçüm] bağlandı');

    // UI hazır olana kadar bekle
    await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 120 && !document.getElementById('modeDrawBtn'); i += 1) await wait(250);
      return document.getElementById('modeDrawBtn') ? 'ok' : 'ui never';
    })()`).then(v => console.log('[ölçüm] UI hazır: ' + v)).catch(e => console.log('[ölçüm] UI bekleme hatası: ' + e));

    // Ölçüm çatıları: tuş kaydı + undo/redo sarıcıları + piksel ölçen yardımcı
    await evaluate(ws, `(() => {
      window.__undoLog = [];
      window.addEventListener('keydown', e => {
        window.__undoLog.push({ at: Date.now(), evt: 'keydown', key: e.key, code: e.code,
          ctrl: !!e.ctrlKey, shift: !!e.shiftKey, trust: e.isTrusted,
          target: (e.target && e.target.tagName) || '' });
      }, true);
      const wrap = (name, evt) => {
        const base = window[name];
        if (typeof base !== 'function' || base.__probeWrapped) return;
        window[name] = function () {
          window.__undoLog.push({ at: Date.now(), evt: 'call:' + evt });
          try { return base.apply(this, arguments); } finally {
            window.__undoLog.push({ at: Date.now(), evt: 'done:' + evt,
              undoStack: undoStack.length, redoStack: redoStack.length });
          }
        };
        window[name].__probeWrapped = true;
      };
      wrap('undo', 'undo'); wrap('redo', 'redo');
      window.__pixStat = () => {
        const c = document.getElementById('inkEditorCanvas');
        if (!c || !c.width) return null;
        const img = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let total = 0, left = 0, right = 0;
        for (let y = 0; y < c.height; y += 3) {
          for (let x = 0; x < c.width; x += 3) {
            if (img[(y * c.width + x) * 4 + 3] > 12) {
              total += 1; if (x < c.width / 2) left += 1; else right += 1;
            }
          }
        }
        return { total, left, right };
      };
      return 'kurulu';
    })()`).then(v => console.log('[ölçüm] çatı: ' + v)).catch(e => console.log('[ölçüm] çatı hatası: ' + e));

    const kind1 = JSON.parse(await evaluate(ws, `JSON.stringify({screen: (typeof modeIsDraw === 'function' ? modeIsDraw() : 'fonk yok')})`));
    console.log('[ölçüm] başlangıç durumu:', JSON.stringify(kind1));

    // 6 dakikada bir 2 saniyede bir durum örnekle
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < SESSION_MS) {
      await sleep(2000);
      i += 1;
      try {
        const snap = JSON.parse(await evaluate(ws, `(async () => {
          const owner = (typeof inkDocOwnerId === 'function') ? (inkDocOwnerId() || '') : '';
          const layers = (typeof inkDocLayersTopFirst === 'function') ? inkDocLayersTopFirst(owner) : null;
          const rec = layers ? layers[0] : null;
          const jank = Array.isArray(window.__inkFrameJank) ? window.__inkFrameJank.slice(-12) : undefined;
          return JSON.stringify({ n: ${(i)}, unix: Date.now(),
            undoStack: undoStack.length, redoStack: redoStack.length,
            commit: rec ? (rec.strokes || []).length : -1,
            pix: window.__pixStat ? window.__pixStat() : null,
            editorOpen: (typeof inkEditorIsOpen === 'function') ? !!inkEditorIsOpen() : '?',
            jankTail: jank,
            logTail: window.__undoLog.slice(-24),
          });
        })()`));
        console.log('[örnek ' + i + ']', JSON.stringify(snap));
      } catch (e) {
        console.log('[örnek ' + i + '] hatası: ' + String(e).slice(0, 120));
      }
    }
    console.log('[ölçüm] bitti');
    try { app.kill(); } catch { /* */ }
    process.exit(0);
  } catch (e) {
    console.error('[ölçüm] HATA: ' + e);
    try { app.kill(); } catch { /* */ }
    process.exit(3);
  }
})();
