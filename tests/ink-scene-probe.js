'use strict';

/* Manzara resmi + motor sınırları sondası:
   • 22+ katmanlı doküman (2560×1400)
   • Katman katman gerçek manzara: gökyüzü, güneş, bulutlar, dağlar,
     göl, yansımalar, çamlar, tepeler, çim dokusu (yüzlerce mikro vuruş),
     kayalar, kuşlar
   • Her vuruşun motor işleme süresi + katman bazlı tablo
   • Son: zoom / undo / katman geçişi / bellek ölçümü
   Kullanım: node tests/ink-scene-probe.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9344;
const APP_PORT = 5234;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-scene-'));
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

    /* ---- sahne: tuval + 22 katman + ressam kolu + vuruş planı ---- */
    const setup = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const o = {};
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1400';
      document.getElementById('newCanvasName').value = 'Manzara Sondası';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(600);
      o.editor = inkEditorIsOpen();
      if (!o.editor) { o.fail = 1; return JSON.stringify(o); }

      const base = inkDocLayers(inkDocOwnerId() || '').length;
      for (let i = base; i < 24; i += 1) inkDocAddLayer();
      await wait(300);

      /* alt → üst sıralı liste (top-first listeyi çeviriyoruz) */
      o.order = inkDocLayersTopFirst(inkDocOwnerId() || '').map(l => l.id).reverse();
      o.layerCount = o.order.length;
      window.__order = o.order;   /* ressam katman seçerken bunu kullanır */

      const cv = document.getElementById('inkEditorCanvas');
      const rect = cv.getBoundingClientRect();
      o.rect = { l: rect.left, t: rect.top, w: rect.width, h: rect.height };

      window.__res = { rect: o.rect };

      /* --- ressam kolu: insanımsı yay + el titreşimi, senkron motor süresi --- */
      window.__draw = async (spec) => {
        const rr = window.__res.rect;
        const t0 = performance.now();
        let work = 0;
        const fire = (type, x, y, press) => {
          const t = performance.now();
          cv.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
            clientX: rr.l + x, clientY: rr.t + y, button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pressure: type === 'pointerup' ? 0 : press, tiltX: 0, tiltY: 0, twist: 0,
          }));
          work += performance.now() - t;
        };
        const X = v => v * rr.w;
        const Y = v => v * rr.h;
        fire('pointerdown', X(spec.x0), Y(spec.y0), 0.12);
        const mx = X((spec.x0 + spec.x1) / 2) + X(spec.bow || 0);
        const my = Y((spec.y0 + spec.y1) / 2) + Y((spec.bow || 0) * 0.6);
        const x1 = X(spec.x1), y1 = Y(spec.y1);
        const moves = spec.moves || 24;
        for (let i = 1; i <= moves; i += 1) {
          const t = i / moves;
          const e = t * t * (3 - 2 * t);
          const px = (1 - e) * (1 - e) * X(spec.x0) + 2 * (1 - e) * e * mx + e * e * x1;
          const py = (1 - e) * (1 - e) * Y(spec.y0) + 2 * (1 - e) * e * my + e * e * y1;
          fire('pointermove', px + (Math.random() - 0.5) * 1.8,
            py + (Math.random() - 0.5) * 1.8, 0.22 + 0.72 * Math.sin(t * Math.PI));
          if (i % 4 === 0) await new Promise(r2 => setTimeout(r2, 3));
        }
        fire('pointerup', x1, y1, 0);
        await new Promise(r2 => requestAnimationFrame(r2));
        return { work: Math.round(work * 10) / 10, wall: Math.round(performance.now() - t0) };
      };
      return JSON.stringify(o);
    })()`));
    if (!setup.editor) { console.log('HATA: editör açılmadı'); app.kill(); return; }
    console.log('sahne hazır: katman=' + setup.layerCount + ' tuval=2560x1400');

    /* ---- ressam: vuruş planı (rel koordinatlar) ---- */
    const plan = JSON.parse(await evaluate(ws, `(async () => {
      const o = { layers: [] };
      const add = (name) => { const L = { name, strokes: [], stats: null }; o.layers.push(L); return L; };
      const mix = (a, b, t) => {
        const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
        const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
        const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
        return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
      };
      const rr = window.__res.rect;
      const rnd = (a, b) => a + Math.random() * (b - a);

      add('Gökyüzü geçişi');      // 0 uzak
      o.layers[0].strokes = (() => {
        const rows = [];
        for (let i = 0; i < 30; i += 1) {
          const t = i / 29;
          const y = 0.03 + 0.58 * t;
          rows.push({ x0: -0.02 + rnd(0, 0.01), y0: y + rnd(-0.004, 0.004),
            x1: 1.02 - rnd(0, 0.01), y1: y + rnd(-0.004, 0.004),
            bow: 0.006 * (Math.random() - 0.5), moves: 30,
            size: 12 + 10 * Math.random(),
            /* mavi ufka doğru açık, ufukta sıcak alt tonu */
            color: t < 0.55 ? mix('#35659c', '#72a4cd', t / 0.55)
              : t < 0.85 ? mix('#72a4cd', '#cfe0ea', (t - 0.55) / 0.3)
                : mix('#cfe0ea', '#f6cf9a', (t - 0.85) / 0.15) });
        }
        return rows;
      })();

      {
        const L = add('Uzak dağlar');   // 1
        const H = 0.63, PEAK = 0.415;
        // 3 tepe: sol geniş, orta yüksek, sağ alçak
        const peaks = [[0.16, 0.44], [0.42, 0.365], [0.72, 0.47]];
        for (const [pxx, ppeak] of peaks) {
          for (let i = 0; i < 26; i += 1) {
            const t = i / 25;
            const yy = ppeak + (H - ppeak) * t;
            const half = (1 - t) * 0.16 + 0.02;
            L.strokes.push({ x0: Math.max(0.01, pxx - half), y0: yy + rnd(-0.006, 0.006),
              x1: Math.min(0.99, pxx + half), y1: yy + rnd(-0.006, 0.006),
              bow: -0.012, moves: 22, size: 9 + 10 * Math.random(),
              color: mix('#a9b6da', '#6d7ba6', rnd(0, 1)) });
          }
        }
      }
      {
        const L = add('Uzak karlı zirve detayı'); // 2
        for (let i = 0; i < 16; i += 1) {
          const y = 0.4 + rnd(0, 0.03);
          L.strokes.push({ x0: 0.36 + rnd(0, 0.12), y0: y, x1: 0.44 + rnd(0, 0.1), y1: y + rnd(0, 0.012),
            bow: 0.004, moves: 12, size: 3 + 3 * Math.random(), color: rnd(0, 1) > 0.5 ? '#e9edf4' : '#c6cede' });
        }
      }
      {
        const L = add('Güneş glöbu');  // 3
        const SX = 0.68, SY = 0.245;
        for (let i = 0; i < 22; i += 1) {
          const a = rnd(0, Math.PI * 2);
          const rr2 = rnd(0.012, 0.05);
          L.strokes.push({ x0: SX + Math.cos(a) * rr2 * 1.6, y0: SY + Math.sin(a) * rr2,
            x1: SX + Math.cos(a) * rr2 * 1.62, y1: SY + Math.sin(a) * rr2,
            bow: 0, moves: 8, size: 16 + 22 * Math.random(),
            color: mix('#fff6cf', '#ffdf9a', Math.random()) });
        }
        for (let i = 0; i < 10; i += 1) {
          const t = i / 9;
          L.strokes.push({ x0: SX - 0.028 + rnd(-0.01, 0.01), y0: SY - 0.028 + t * 0.056 + rnd(-0.004, 0.004),
            x1: SX + 0.028 + rnd(-0.01, 0.01), y1: SY - 0.028 + t * 0.056 + rnd(-0.004, 0.004),
            bow: 0, moves: 8, size: 7 + 8 * Math.random(), color: t > 0.5 ? '#fffbe0' : '#ffe9a8' });
        }
      }
      {
        const L = add('Bulut katmanı üst');  // 4
        for (let c = 0; c < 5; c += 1) {
          const cx = rnd(0.1, 0.9), cy = rnd(0.1, 0.32), wdt = rnd(0.05, 0.13);
          for (let i = 0; i < 9; i += 1) {
            const t = i / 8;
            L.strokes.push({ x0: cx - wdt * 0.5 + t * wdt, y0: cy + Math.sin(t * 5) * 0.008 + rnd(-0.003, 0.003),
              x1: cx - wdt * 0.5 + t * wdt + 0.02, y1: cy + Math.sin(t * 5) * 0.008 + rnd(-0.004, 0.004),
              bow: 0.007, moves: 10, size: 10 + 14 * Math.random(),
              color: mix('#f2f7fb', '#dde8f2', Math.random()) });
          }
        }
      }
      {
        const L = add('Bulut katmanı alt');  // 5  sıcak renkli alçak bulutlar
        for (let c = 0; c < 4; c += 1) {
          const cx = rnd(0.12, 0.88), cy = rnd(0.3, 0.44), wdt = rnd(0.06, 0.16);
          for (let i = 0; i < 11; i += 1) {
            const t = i / 10;
            L.strokes.push({ x0: cx - wdt * 0.5 + t * wdt, y0: cy + Math.cos(t * 4) * 0.006,
              x1: cx - wdt * 0.5 + t * wdt + 0.018, y1: cy + Math.cos(t * 4) * 0.006 + rnd(-0.003, 0.003),
              bow: -0.005, moves: 10, size: 9 + 16 * Math.random(),
              color: mix('#f7e8d8', '#ffdfb8', rnd(0.2, 0.9)) });
          }
        }
      }
      {
        const L = add('Orta dağlar');  // 6
        const H = 0.72;
        for (let k = 0; k < 2; k += 1) {
          const pxx = 0.3 + k * 0.42, ppeak = k === 0 ? 0.52 : 0.56;
          for (let i = 0; i < 30; i += 1) {
            const t = i / 29;
            const yy = ppeak + (H - ppeak) * t;
            const half = (1 - t) * 0.2 + 0.02;
            L.strokes.push({ x0: Math.max(0.01, pxx - half), y0: yy + rnd(-0.005, 0.005),
              x1: Math.min(0.99, pxx + half), y1: yy + rnd(-0.005, 0.005),
              bow: -0.008, moves: 24, size: 12 + 16 * Math.random(),
              color: mix('#5d6f92', '#3d4d6e', rnd(0, 0.8)) });
          }
        }
      }
      {
        const L = add('Göl tabanı');  // 7
        for (let r = 0; r < 20; r += 1) {
          const t = r / 19;
          const y = 0.74 + 0.245 * t;
          L.strokes.push({ x0: rnd(-0.01, 0.02), y0: y, x1: 1 - rnd(0, 0.02), y1: y + rnd(-0.002, 0.002),
            bow: 0.004, moves: 34, size: 14 + 12 * Math.random(),
            color: mix('#a3c4dd', '#5f8db3', t) });
        }
      }
      {
        const L = add('Güneş yansıması');  // 8
        for (let i = 0; i < 24; i += 1) {
          const y = 0.75 + Math.random() * 0.23;
          const wdt = 0.05 + Math.random() * 0.07;
          L.strokes.push({ x0: 0.68 - wdt + rnd(-0.02, 0.02), y0: y,
            x1: 0.68 + wdt + rnd(-0.02, 0.02), y1: y + rnd(-0.002, 0.002),
            bow: 0, moves: 10, size: 3 + 5 * Math.random(),
            color: mix('#ffe9b0', '#fff6d8', Math.random()) });
        }
      }
      {
        const L = add('Göl dalga parıltısı');  // 9
        for (let i = 0; i < 40; i += 1) {
          const y = 0.75 + Math.random() * 0.235;
          const xx = Math.random();
          L.strokes.push({ x0: xx, y0: y, x1: xx + rnd(0.01, 0.05), y1: y + rnd(-0.001, 0.001),
            bow: 0, moves: 8, size: 1.4 + 2.4 * Math.random(),
            color: Math.random() > 0.4 ? '#d6ecf6' : '#9ec9e2' });
        }
      }
      {
        const L = add('Ön çam ormanı');  // 10
        for (let tr = 0; tr < 6; tr += 1) {
          const trunkX = 0.05 + tr * 0.052 + rnd(-0.008, 0.008);
          const topY = 0.52 + tr * 0.018 + rnd(0, 0.02);
          const botY = 0.78 + rnd(0, 0.04);
          // gövde
          L.strokes.push({ x0: trunkX, y0: botY, x1: trunkX + rnd(-0.004, 0.004), y1: topY + 0.03,
            bow: 0.003, moves: 14, size: 4 + 3 * Math.random(), color: '#2c2318' });
          // yapraklar yukarı incelen sırtlar
          const steps = 12;
          for (let i = 0; i < steps; i += 1) {
            const t = i / (steps - 1);
            const yy = topY + (botY - topY) * t;
            const half = (1 - t) * 0.028 + 0.004;
            for (const sgn of [-1, 1]) {
              L.strokes.push({ x0: trunkX, y0: yy - 0.004, x1: trunkX + sgn * half * rnd(0.8, 1.2), y1: yy + 0.006,
                bow: sgn * 0.004, moves: 9, size: 2.5 + 3.4 * Math.random(),
                color: mix('#33503c', '#22362a', Math.random()) });
            }
          }
        }
      }
      {
        const L = add('Orta çalılık tepe');  // 11
        for (let i = 0; i < 34; i += 1) {
          const y = 0.8 + rnd(0, 0.05);
          L.strokes.push({ x0: rnd(0.05, 0.5), y0: y, x1: 0.9 + rnd(0, 0.08), y1: y + rnd(-0.004, 0.004),
            bow: 0.006, moves: 22, size: 10 + 18 * Math.random(),
            color: mix('#42582f', '#2c3b20', Math.random()) });
        }
      }
      {
        const L = add('Çim dokusu I');   // 12  mikro dokunuş yükü
        for (let i = 0; i < 70; i += 1) {
          const xx = rnd(0.02, 0.55), yy = rnd(0.8, 0.99);
          L.strokes.push({ x0: xx, y0: yy, x1: xx + rnd(0.004, 0.014), y1: yy - rnd(0.004, 0.012),
            bow: 0.002, moves: 7, size: 1 + 1.6 * Math.random(),
            color: mix('#5d7f3e', '#8fae5a', Math.random()) });
        }
      }
      {
        const L = add('Çim dokusu II');  // 13
        for (let i = 0; i < 70; i += 1) {
          const xx = rnd(0.5, 0.99), yy = rnd(0.8, 0.99);
          L.strokes.push({ x0: xx, y0: yy, x1: xx + rnd(0.004, 0.013), y1: yy - rnd(0.004, 0.011),
            bow: -0.002, moves: 7, size: 1 + 1.6 * Math.random(),
            color: mix('#48632f', '#6e8f44', Math.random()) });
        }
      }
      {
        const L = add('Kıyı kayaları');  // 14
        for (let k = 0; k < 7; k += 1) {
          const cx = rnd(0.05, 0.95), cy = 0.805 + rnd(0, 0.05), wdt = rnd(0.02, 0.06);
          for (let i = 0; i < 6; i += 1) {
            const t = i / 5;
            L.strokes.push({ x0: cx - wdt * 0.5 + t * wdt, y0: cy + Math.sin(t * 6) * 0.004,
              x1: cx - wdt * 0.5 + t * wdt, y1: cy + Math.sin(t * 6) * 0.004 + 0.004,
              bow: 0.002, moves: 9, size: 6 + 9 * Math.random(),
              color: mix('#5e5a52', '#3f3c37', Math.random()) });
          }
        }
      }
      {
        const L = add('Uçuşan kuşlar');  // 15
        for (let b = 0; b < 4; b += 1) {
          const bx = rnd(0.2, 0.75), by = rnd(0.2, 0.38), s = rnd(0.008, 0.014);
          L.strokes.push({ x0: bx - s, y0: by, x1: bx, y1: by - s * 0.5, bow: -0.003, moves: 6, size: 1.6, color: '#2b3540' });
          L.strokes.push({ x0: bx, y0: by - s * 0.5, x1: bx + s, y1: by, bow: -0.003, moves: 6, size: 1.6, color: '#2b3540' });
        }
      }
      {
        const L = add('Ön plan karanlık çerçeve');  // 16
        for (let i = 0; i < 26; i += 1) {
          const t = i / 25;
          const y = 0.955 + 0.03 * t;
          L.strokes.push({ x0: rnd(-0.02, 0.1), y0: y, x1: 0.9 + rnd(0, 0.12), y1: y + rnd(-0.002, 0.002),
            bow: 0.003, moves: 26, size: 16 + 26 * Math.random(),
            color: mix('#1f2a18', '#141d10', Math.random()) });
        }
      }
      /* sahne vuruş listesi hazır; kullanılabilir fırça listesi ekle */
      o.brushes = (typeof inkState === 'function' ? inkState().brushes : [])
        .map(b => b.id)
        .filter(id => !/eraser|silgi/i.test(id));
      o.totalStrokes = o.layers.reduce((a, L) => a + L.strokes.length, 0);
      o.totalMoves = o.layers.reduce((a, L) => a + L.strokes.reduce((b, s) => b + s.moves, 0), 0);
      return JSON.stringify(o);
    })()`));
    console.log('plan: ' + plan.layers.length + ' katman · ' + plan.totalStrokes + ' vuruş · '
      + plan.totalMoves + ' motor noktası · ' + plan.brushes.length + ' fırça adayı');

    /* ---- ressam çiziyor: katman katman ---- */
    const layerResults = [];
    const R = JSON.stringify(plan);
    const painting = JSON.parse(await evaluate(ws, `(async () => {
      const plan = ${R};
      const brushes = plan.brushes;
      const s = inkState();
      const rows = [];
      for (let i = 0; i < plan.layers.length; i += 1) {
        const L = plan.layers[i];
        const layerId = window.__order && window.__order[i];
        if (!layerId) { rows.push({ name: L.name, error: 'katman yok' }); continue; }
        inkDocSelectLayer(layerId);
        let work = 0, wall = 0, maxWork = 0;
        for (let k = 0; k < L.strokes.length; k += 1) {
          const spec = L.strokes[k];
          if (brushes.length) {
            const bid = brushes[(i + k * 3) % brushes.length];
            try { if (typeof setActiveBrush === 'function') setActiveBrush(bid); else inkSetTool('brush', { brushId: bid }); } catch { /* kalsın */ }
          }
          s.size = Math.max(1, Math.min(400, spec.size));
          try { inkSetColor(spec.color, false); } catch { s.color = spec.color; }
          const r = await window.__draw(spec);
          work += r.work; wall += r.wall; maxWork = Math.max(maxWork, r.work);
        }
        rows.push({ name: L.name, strokes: L.strokes.length,
          avg: Math.round(work / L.strokes.length * 100) / 100,
          max: Math.round(maxWork * 10) / 10,
          wall: Math.round(wall / L.strokes.length * 10) / 10 });
      }
      return JSON.stringify(rows);
    })()`));
    for (const r of painting) {
      layerResults.push(r);
      console.log('  ▸ ' + r.name.padEnd(24) + ' vuruş=' + r.strokes
        + ' ort=' + r.avg + 'ms/furuş  max=' + r.max + 'ms  duvar=' + r.wall + 'ms');
    }

    /* ---- dolu doküman etkileşim ölçümleri ---- */
    const inter = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const cv = document.getElementById('inkEditorCanvas');
      const rr = window.__res.rect;
      const o = {};

      /* DOĞRULAMA: vuruşlar gerçekten katmanlara yazıldı mı? */
      const owner = inkDocOwnerId() || '';
      o.layerStrokes = inkDocLayers(owner).map(l => ({
        id: (l.name || '').slice(0, 16), n: (l.strokes || []).length, pts: (l.strokes || []).reduce((a, s) => a + (s.points || []).length, 0),
      }));
      o.totalPts = o.layerStrokes.reduce((a, x) => a + x.pts, 0);

      /* GERÇEK KARE SÜRESİ: çizim sürerken rAF deltası ölçümü (çizim motoru
         işini rAF karesinde yapar; dispatchEvent süresi onu göstermez) */
      const s = inkState();
      s.size = 22;
      const deltas = [];
      const strokes = [];
      for (let k = 0; k < 22; k += 1) {
        const sy = 0.06 + 0.026 * k;
        strokes.push({ x0: 0.03, y0: sy, x1: 0.97, y1: sy + 0.004, bow: 0.004, moves: 18 });
      }
      for (const sp of strokes) {
        cv.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
          clientX: rr.l + sp.x0 * rr.w, clientY: rr.t + sp.y0 * rr.h,
          button: 0, buttons: 1, pressure: 0.3, tiltX: 0, tiltY: 0, twist: 0,
        }));
        let prev = performance.now();
        for (let i = 1; i <= sp.moves; i += 1) {
          const x = sp.x0 + (sp.x1 - sp.x0) * (i / sp.moves);
          cv.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
            clientX: rr.l + x * rr.w, clientY: rr.t + (sp.y0 + (sp.y1 - sp.y0) * (i / sp.moves)) * rr.h,
            button: 0, buttons: 1, pressure: 0.3 + 0.6 * Math.sin(i / sp.moves * Math.PI),
            tiltX: 0, tiltY: 0, twist: 0,
          }));
          /* kare venda: motor bu karede çizimi bitirir; delta = gerçek kare süresi */
          await new Promise(r => requestAnimationFrame(() => r()));
          const now = performance.now();
          deltas.push(Math.round((now - prev) * 10) / 10);
          prev = now;
          if (i % 3 === 0) await new Promise(r => setTimeout(r, 4));
        }
        cv.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
          clientX: rr.l + sp.x1 * rr.w, clientY: rr.t + sp.y1 * rr.h,
          button: 0, buttons: 0, pressure: 0, tiltX: 0, tiltY: 0, twist: 0,
        }));
        await new Promise(r => requestAnimationFrame(() => r()));
      }
      deltas.sort((a, b) => a - b);
      o.frameAvg = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length * 10) / 10;
      o.frameP50 = deltas[Math.floor(deltas.length * 0.5)];
      o.frameP95 = deltas[Math.floor(deltas.length * 0.95)];
      o.frameMax = deltas[deltas.length - 1];
      o.fps = Math.round(1000 / Math.max(1, o.frameP50));

      const cx = rr.l + rr.w / 2;
      const cy = rr.t + rr.h / 2;
      /* pan karesi: 8 hızlı imleç hareketi döngüsü dolu dokümanda */
      cv.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
        clientX: cx, clientY: cy, button: 0, buttons: 1, pressure: 0, tiltX: 0, tiltY: 0, twist: 0,
      }));
      const panDeltas = [];
      let pprev = performance.now();
      for (let i = 0; i < 60; i += 1) {
        cv.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
          clientX: cx + (i % 2 ? 90 : 110), clientY: cy + i, button: 0, buttons: 0,
          pressure: 0, tiltX: 0, tiltY: 0, twist: 0,
        }));
        await new Promise(r => requestAnimationFrame(() => r()));
        const now = performance.now();
        panDeltas.push(Math.round(now - pprev));
        pprev = now;
      }
      panDeltas.sort((a, b) => a - b);
      o.panP50 = panDeltas[Math.floor(panDeltas.length * 0.5)];
      o.panMax = panDeltas[panDeltas.length - 1];

      const uds = [];
      for (let i = 0; i < 4; i += 1) {
        const t = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true,
        }));
        await new Promise(res => requestAnimationFrame(res));
        uds.push(Math.round(performance.now() - t));
        await wait(50);
      }
      o.undo = uds;

      const ls = [];
      const ids = inkDocLayersTopFirst(owner).map(l => l.id);
      for (let i = 0; i < 12 && i < ids.length; i += 1) {
        const t = performance.now();
        inkDocSelectLayer(ids[i]);
        await new Promise(res => requestAnimationFrame(res));
        ls.push(Math.round((performance.now() - t) * 10) / 10);
        await wait(20);
      }
      o.layerSwitch = ls;
      o.mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
      return JSON.stringify(o);
    })()`));

    console.log('');
    console.log('=== DOĞRULAMA ===');
    console.log('katman vuruş toplamı=' + inter.layerStrokes.reduce((a, x) => a + x.n, 0)
      + ' · motor nokta toplamı=' + inter.totalPts);
    console.log('boş kalan katman: ' + inter.layerStrokes.filter(x => x.n === 0).length + ' adet');
    console.log('');
    console.log('=== ÇİZİM SIRASINDA GERÇEK KARE SÜRESİ (dolu 24 katman + ' 
      + inter.totalPts + ' nokta) ===');
    console.log('ortalama=' + inter.frameAvg + 'ms  p50=' + inter.frameP50 + 'ms  p95=' + inter.frameP95
      + 'ms  max=' + inter.frameMax + 'ms  →  FPS≈' + inter.fps);
    console.log('pan karesi p50=' + inter.panP50 + 'ms  max=' + inter.panMax + 'ms');
    console.log('undo=', inter.undo.join(','), 'ms · katman geçişi ort='
      + Math.round(inter.layerSwitch.reduce((a, b) => a + b, 0) / inter.layerSwitch.length * 10) / 10 + 'ms · heap=' + inter.mem + ' MB');

    /* ---- ekran görüntüsü ---- */
    const shot = await new Promise(res => {
      const idm = Math.floor(Math.random() * 1e6);
      const f = ev => {
        const m = JSON.parse(ev.data);
        if (m.id !== idm) return;
        ws.removeEventListener('message', f);
        res(m.result && m.result.result ? m.result.result.data : null);
      };
      ws.addEventListener('message', f);
      ws.send(JSON.stringify({ id: idm, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });
    if (shot) {
      const p = path.join(os.tmpdir(), 'tailref-radial', 'manzara.png');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from(shot, 'base64'));
      console.log('ekran görüntüsü: ' + p + ' (--disable-gpu ile bayat kare olabilir)');
    }
  } catch (e) {
    console.error('HATA:', e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
