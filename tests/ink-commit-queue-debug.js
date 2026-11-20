'use strict';

/* Commit kuyruğu tanısı: vuruş bırakıldıktan sonra katmana (strokes)
   kaç kare sonra düştüğü ölçülür.
   Kullanım: node tests/ink-commit-queue-debug.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9355;
const APP_PORT = 5238;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-debug-'));
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

    /* kayıt modu penceresini geç + yeni tuval belgesiyle editörü aç
       (hotpath sonda'sının kurulumını birebir taklit eder) */
    /* ink motoru hazır olana kadar bekle, sonra kurulum */
    for (let i = 0; i < 40; i += 1) {
      const ok = await evaluate(ws, "typeof inkState === 'function' && typeof inkDocAddLayer === 'function'").catch(() => false);
      if (ok) break;
      await sleep(400);
    }
    await evaluate(ws, `(async () => {
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
      document.getElementById('newCanvasName').value = 'Commit Tanı';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !(typeof inkEditorIsOpen === 'function' && inkEditorIsOpen()); i += 1) await wait(100);
      await wait(500);
      return 'editor=' + (typeof inkEditorIsOpen === 'function' ? inkEditorIsOpen() : 'yok');
    })()`).catch(() => 'kurulum-hata');
    await sleep(700);

    let planRaw = 'cikti-yok';
    try {
      planRaw = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const open = inkDocOwnerId() || '';
      /* en ÜSTTTEKİ katmana çiz */
      const layerId = inkDocLayersTopFirst(open).map(l => l.id)[0];
      inkDocSelectLayer(layerId);
      const ink = inkState();
      ink.size = 22;
      ink.color = '#f0c98d';
      const cv = document.getElementById('inkEditorCanvas');
      if (!cv) return JSON.stringify([{ hata: 'editör kanvas yok' }]);
      /* tanı: olay kimdyere gidiyor + handler hatası var mı */
      window.__evLog = [];
      window.__hata = [];
      window.__bpLog = [];
      window.__pushLog = [];
      window.addEventListener('error', e => window.__hata.push(String(e.message || e.error)), true);
      cv.addEventListener('pointerdown', e => window.__evLog.push('down:' + e.pointerId + ':' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ':btn' + e.button), true);
      cv.addEventListener('pointermove', e => window.__evLog.push('mv'), true);
      cv.addEventListener('pointerup', e => window.__evLog.push('up'), true);
      /* motor bantları: local/targetLayer/beginPaint/push */
      const oLocal = inkEditorLocal;
      inkEditorLocal = function (e2) { const r = oLocal(e2); window.__bpLog.push('local:' + (r ? ('x' + Math.round(r.x) + ',y' + Math.round(r.y)) : 'null')); return r; };
      const oTarget = inkEditorTargetLayer;
      inkEditorTargetLayer = function () { const r = oTarget(); window.__bpLog.push('target:' + (r ? (r.id + ':' + (r.locked ? 'kilitli' : 'ozgur')) : 'null')); return r; };
      const oBegin = inkEditorBeginPaint;
      inkEditorBeginPaint = function (e2, loc, pending) {
        window.__bpLog.push('begin{ayr' + (pending ? 'P' : 'R') + '};t' + Math.round(performance.now()));
        const r = oBegin(e2, loc, pending);
        window.__bpLog.push('begin->' + r);
        return r;
      };
      for (const L of (inkState().layers || []).filter(l => l.kind === 'attached')) {
        const op = L.strokes.push.bind(L.strokes);
        L.strokes.push = function (...a) {
          window.__pushLog.push('push@' + Math.round(performance.now()) + ':' + L.name + ':t' + a[0].points.length);
          return op(...a);
        };
      }
      const rr = cv.getBoundingClientRect();
      const out = [];
      const fire = (type, x, y) => {
        cv.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
          clientX: rr.left + x, clientY: rr.top + y, button: 0,
          buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5,
          tiltX: 0, tiltY: 0, twist: 0,
        }));
      };
      const oku = () => {
        const rec = inkDocLayersTopFirst(open).find(l => l.id === layerId);
        return rec ? rec.strokes.length : -1;
      };
      const fit = (inkEditorUi && inkEditorUi.fit) || inkEditorComputeFit();
      for (let k = 0; k < 5; k += 1) {
        /* kâğıt (fit) içinde: sığdırma kenar boşluklarının iyide */
        const x0 = fit.x + fit.w * (0.15 + k * 0.04), y0 = fit.y + fit.h * (0.25 + k * 0.08);
        fire('pointerdown', x0, y0);
        const inisStroke = !!(inkEditorUi && inkEditorUi.stroke);
        for (let i = 1; i <= 12; i += 1) {
          fire('pointermove', x0 + i * fit.w * 0.04, y0 + Math.sin(i) * 6);
          await wait(2);
        }
        const hamN = (typeof inkState === 'function' ? inkState() : { layers: [] })
          .layers.filter(l => l.kind === 'attached').map(l => ({ ad: (l.name || '').slice(0, 8), n: l.strokes.length, sel: l.id === layerId }));
        const nUp0 = oku();
        fire('pointerup', fit.x + fit.w * 0.6, y0 + Math.sin(13) * 6);
        const n0 = oku();
        const n1 = await new Promise(r => requestAnimationFrame(() => r(oku())));
        await wait(16);
        const n2 = oku();
        await wait(120);
        const n3 = oku();
        out.push({
          k,
          inisStroke,
          hamN,
          vurusIcinde: nUp0,
          upAninda: n0,
          rafSonrasi: n1,
          '16ms': n2,
          '136ms': n3,
        });
      }
      /* son durumu da ver: katman başına vuruş sayısı + etkin katman */
      const sonDurum = inkDocLayersTopFirst(open).map(l =>
        ({ id: l.id.slice(0, 10), ad: l.name, n: l.strokes.length }));
      return JSON.stringify({ plan: out, sonDurum, etkin: (typeof inkActiveLayer === 'function' && inkActiveLayer() || {}).id,
        actOpen: !!(inkEditorUi && inkEditorUi.open), arac: ink.tool,
        evLog: (window.__evLog || []).slice(0, 24),
        hata: (window.__hata || []).slice(0, 4),
        bpLog: (window.__bpLog || []).slice(0, 90),
        pushLog: (window.__pushLog || []).slice(0, 20),
        rect: rr && { l: Math.round(rr.left), t: Math.round(rr.top), w: Math.round(rr.width), h: Math.round(rr.height) },
        uiRect: (typeof inkEditorUi !== 'undefined' && inkEditorUi && inkEditorUi.rect) ? { x: inkEditorUi.rect.x, y: inkEditorUi.rect.y, w: inkEditorUi.rect.w, h: inkEditorUi.rect.h } : null,
        fit: (inkEditorUi && inkEditorUi.fit) ? { x: Math.round(inkEditorUi.fit.x), y: Math.round(inkEditorUi.fit.y), w: Math.round(inkEditorUi.fit.w), h: Math.round(inkEditorUi.fit.h) } : null,
        gate: (() => { try { const g = inkEditorGatePoint(216, 230); return { x: Math.round(g.x), y: Math.round(g.y) }; } catch (e) { return 'hata: ' + e.message; } })(),
        view: (() => { try { const v = inkEditorUi.view || {}; return { zoom: Math.round((v.zoom || 0) * 1000) / 1000, panX: Math.round(v.x || 0), panY: Math.round(v.y || 0), rot: Math.round((v.rot || 0) * 1000) / 1000 }; } catch { return null; } })(),
        oil: (() => { try { const it = getItem(inkEditorUi.itemId); return it ? { w: it.w, h: it.h } : null; } catch { return null; } })() });
    })()`, 30000);
    } catch (e) { planRaw = 'plan-hata: ' + e.message; }
    console.log(planRaw);
  } catch (e) {
    console.error('HATA:', e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(200);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
