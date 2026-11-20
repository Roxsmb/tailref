'use strict';

/* Çizim motoru performans sondası:
   • 25 katmanlı doküman açar
   • İnsan gibi çizer: rastgele fırça/renk/boyut, kısa detay çizgileri + uzun süpürmeler
   • Her noktanın motor işleme süresi (dispatchEvent senkron ölçümü)
   • Sonra: zoom, pan, undo, katman geçişi maliyetleri + bellek
   Kullanım: node tests/ink-perf-probe.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9343;
const APP_PORT = 5233;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-perf-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

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
      const ok = await evaluate(ws, "typeof inkState === 'function' && typeof inkDocAddLayer === 'function'");
      if (ok) break;
      await sleep(400);
    }

    /* ---- sahne kurulumu: büyük tuval + çizim kolu ---- */
    const setup = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const o = {};
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1600';
      document.getElementById('newCanvasName').value = 'Performans Sondası';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(600);
      o.editor = inkEditorIsOpen();
      if (!o.editor) return JSON.stringify(o);
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      o.rect = { l: Math.round(rect.left), t: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) };

      /* 25 katman */
      const startLayers = inkDocLayers(inkDocOwnerId() || '').length;
      for (let i = startLayers; i < 25; i += 1) inkDocAddLayer();
      await wait(400);
      o.layerCount = inkDocLayers(inkDocOwnerId() || '').length;

      /* fırça listesi */
      o.brushes = inkState().brushes.map(b => ({ id: b.id, name: b.name, size: b.size }));

      /* çizim kolu: insanımsı vuruş + motor süresi ölçümü */
      window.__cv = canvas;
      window.__rect = o.rect;
      window.__draw = async (spec) => {
        const cv = window.__cv;
        const r = window.__rect;
        const t0 = performance.now();
        let workMs = 0;
        const fire = (type, x, y, pressure, tilt) => {
          const t = performance.now();
          cv.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
            clientX: r.l + x, clientY: r.t + y, button: 0,
            buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
            pressure: type === 'pointerup' ? 0 : pressure,
            tiltX: 0, tiltY: 0, twist: 0,
          }));
          workMs += performance.now() - t;
        };
        /* ana vuruş: yumuşak yay eğrisi + ince titreme (insan eli gürültüsü) */
        const { x0, y0, x1, y1, bow, moves } = spec;
        fire('pointerdown', x0, y0, 0.1);
        const mx = (x0 + x1) / 2 + bow;
        const my = (y0 + y1) / 2 + bow * 0.6;
        for (let i = 1; i <= moves; i += 1) {
          const t = i / moves;
          const ease = t * t * (3 - 2 * t);
          const px = (1 - ease) * (1 - ease) * x0 + 2 * (1 - ease) * ease * mx + ease * ease * x1;
          const py = (1 - ease) * (1 - ease) * y0 + 2 * (1 - ease) * ease * my + ease * ease * y1;
          const press = 0.25 + 0.75 * Math.sin(t * Math.PI);
          fire('pointermove', px + (Math.random() - 0.5) * 1.6,
            py + (Math.random() - 0.5) * 1.6, press);
          if (i % 3 === 0) await new Promise(r => setTimeout(r, 4));
        }
        fire('pointerup', x1, y1, 0);
        await new Promise(r => requestAnimationFrame(r));
        return JSON.stringify({
          wall: Math.round(performance.now() - t0),
          work: Math.round(workMs * 10) / 10,
        });
      };
      return JSON.stringify(o);
    })()`);
    const scene = JSON.parse(setup);
    if (!scene.editor) {
      console.log('HATA: editör açılmadı', setup);
      return;
    }
    console.log('sahne: katman=' + scene.layerCount + ' fırça=' + scene.brushes.length
      + ' tuval=2560x1600 ekranRect=' + JSON.stringify(scene.rect));

    /* ---- insan gibi çizim: katman başına ~7 vuruş, fırça/renk/boyut çeşitli ---- */
    const brushIds = scene.brushes.filter(b => /ink|native|grain|soft|hard|hatch|scatter|texture/i.test(b.id))
      .map(b => b.id).slice(0, 20);
    const totalStrokes = scene.layerCount * 7;
    let sumWork = 0, maxWork = 0, sumWall = 0;
    const lat = [];
    for (let i = 0; i < totalStrokes; i += 1) {
      const layerIdx = Math.floor(i / 7);
      const r = scene.rect;
      const sx = 40 + Math.random() * (r.w - 120);
      const sy = 40 + Math.random() * (r.h - 120);
      const len = 60 + Math.random() * 340;
      const ang = Math.random() * Math.PI * 2;
      const specJson = JSON.stringify({
        x0: sx, y0: sy,
        x1: Math.min(r.w - 20, Math.max(20, sx + Math.cos(ang) * len)),
        y1: Math.min(r.h - 20, Math.max(20, sy + Math.sin(ang) * len)),
        bow: (Math.random() - 0.5) * 140,
        moves: 26 + Math.floor(Math.random() * 44),
        brush: brushIds[(i + layerIdx) % brushIds.length],
        size: (i % 4 === 0) ? 1 + Math.random() * 2 : 3 + Math.random() * 26,
        color: 'hsl(' + Math.floor(Math.random() * 360) + ' ' + (25 + Math.random() * 55) + '% ' + (28 + Math.random() * 45) + '%)',
      });
      const res = JSON.parse(await evaluate(ws, `(async () => {
        const spec = ${specJson};
        const s = inkState();
        if (!window.__rect || !Number.isFinite(window.__rect.l)) {
          return JSON.stringify({ wall: 0, work: 0, err: 'rect yok', rect: window.__rect });
        }
        if (!Number.isFinite(spec.x0) || !Number.isFinite(spec.x1)) {
          return JSON.stringify({ wall: 0, work: 0, err: 'spec nan',
            x0: String(spec.x0), x1: String(spec.x1), rect: window.__rect });
        }
        /* katman değiştir — insan insabetli olarak katlı çalışır */
        const layers = inkDocLayers(inkDocOwnerId() || '');
        if (layers[${layerIdx}]) inkDocSelectLayer(layers[${layerIdx}].id);
        if (typeof setActiveBrush === 'function') {
          try { setActiveBrush(spec.brush); } catch { inkSetTool('brush', { brushId: spec.brush }); }
        }
        if (spec.size) s.size = spec.size;
        if (spec.color) { try { inkSetColor(spec.color, false); } catch { s.color = spec.color; } }
        return await window.__draw(spec);
      })()`));
      if (res.err) {
        console.log('HATA: vuruş kurulamadı →', JSON.stringify(res));
        break;
      }
      sumWork += res.work;
      sumWall += res.wall;
      maxWork = Math.max(maxWork, res.work);
      lat.push(res.work);
      if ((i + 1) % 35 === 0) {
        console.log('  ilerleme: ' + (i + 1) + '/' + totalStrokes + ' vuruş · ortalama motor=' + Math.round(sumWork / (i + 1) * 100) / 100 + 'ms/vuruş');
      }
    }
    lat.sort((a, b) => a - b);
    const p = q => round1(lat[Math.floor((lat.length - 1) * q)]);

    /* ---- dolu doküman üzerinde etkileşim maliyetleri ---- */
    const inter = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const cv = window.__cv;
      const r = window.__rect;
      const o = {};
      const cx = r.l + r.w / 2;
      const cy = r.t + r.h / 2;
      /* zoom-in derin: 12 tekerlek adımı, son adımın işleme süresi */
      for (let i = 0; i < 12; i += 1) {
        const t = performance.now();
        cv.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: cx, clientY: cy, deltaY: -240, deltaMode: 0 }));
        o.zoomWork = Math.round((performance.now() - t) * 10) / 10;
        await new Promise(res => requestAnimationFrame(res));
      }
      /* undo maliyeti: 3 ardışık Ctrl+Z */
      const uds = [];
      for (let i = 0; i < 3; i += 1) {
        const t = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true,
        }));
        await new Promise(res => requestAnimationFrame(res));
        uds.push(Math.round(performance.now() - t));
        await wait(60);
      }
      o.undo = uds;
      /* katman geçişi: 10 hızlı geçiş ortalama */
      const ls = [];
      const layers = inkDocLayers(inkDocOwnerId() || '');
      for (let i = 0; i < 10 && i < layers.length; i += 1) {
        const t = performance.now();
        inkDocSelectLayer(layers[i].id);
        await new Promise(res => requestAnimationFrame(res));
        ls.push(Math.round((performance.now() - t) * 10) / 10);
        await wait(30);
      }
      o.layerSwitch = ls;
      /* bellek */
      o.mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
      return JSON.stringify(o);
    })()`));

    function round1(v) { return Math.round(v * 10) / 10; }

    const avgWork = Math.round(sumWork / totalStrokes * 100) / 100;
    const avgWall = Math.round(sumWall / totalStrokes * 10) / 10;
    console.log('');
    console.log('=== VURUŞ MOTOR SÜRESİ (work = senkron işleme ms) ===');
    console.log('ortalama=' + avgWork + 'ms  p50=' + p(0.5) + 'ms  p95=' + p(0.95) + 'ms  max=' + round1(maxWork) + 'ms');
    console.log('duvar süresi ortalama=' + avgWall + 'ms/vuruş → gerçek insan hızı saniyede ' + round1(1000 / avgWall) + ' vuruş');
    console.log('');
    console.log('=== DOLU DOKÜMAN (25 katman, ' + totalStrokes + ' vuruş) ===');
    console.log('zoom derleme süresi=' + inter.zoomWork + 'ms');
    console.log('undo (3 adım)=' + JSON.stringify(inter.undo) + 'ms');
    console.log('katman geçişi ortalama=' + round1(inter.layerSwitch.reduce((a, b) => a + b, 0) / Math.max(1, inter.layerSwitch.length)) + 'ms  max=' + Math.max(...inter.layerSwitch) + 'ms');
    console.log('JS heap=' + inter.mem + ' MB');
  } catch (e) {
    console.error('HATA:', e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
