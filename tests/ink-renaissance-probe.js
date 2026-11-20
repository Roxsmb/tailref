'use strict';

/* Rönesans manzarası + motor sınırları v3:
   • 18 planlı katman (alt → üst), 2560×1400 tuval
   • Altın ışık paleti: chiaroscuro — derin kahve/yeşil gölgeler,
     sıcak gökyüzü, selvi ormanı, gölde altın yansıma, vinyet
   • Vuruş başına brush değişimi ölçülür (round 2 bulgusu: pahalı)
   • DOĞRULAMA: planlanan vs gerçekten katmana yazılan vuruşlar
     (round 2 gizemi: 789 plan → 203 doc — kim kayboldu?)
   • Gerçek kare süresi (rAF delta), undo, katman geçişi, bellek
   • Ekran görüntüsü: kare tazeleme nudge + gecikmeden sonra
   Kullanım: node tests/ink-renaissance-probe.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9345;
const APP_PORT = 5235;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-rene-'));
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
      const ok = await evaluate(ws, "typeof inkState === 'function' && typeof inkDocAddLayer === 'function'");
      if (ok) break;
      await sleep(400);
    }

    const setup = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const o = {};
      /* İlk açılış "Kayıt modunu seç" perdesini kökten çöz:
         1) mod anahtarını önceden yaz (karşılama bir daha gelmesin)
         2) perde açıksa seçimi birebir taklit et
         3) yine de açıksa doğrudan gizle */
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
      o.welcomeClosed = !pw || pw.hidden;
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('newCanvasW').value = '2560';
      document.getElementById('newCanvasH').value = '1400';
      document.getElementById('newCanvasName').value = 'Rönesans Sondası';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(600);
      o.editor = inkEditorIsOpen();
      if (!o.editor) { o.fail = 1; return JSON.stringify(o); }
      const base = inkDocLayers(inkDocOwnerId() || '').length;
      for (let i = base; i < 20; i += 1) inkDocAddLayer();
      await wait(300);
      o.order = inkDocLayersTopFirst(inkDocOwnerId() || '').map(l => l.id).reverse();
      window.__order = o.order;
      window.__owner = inkDocOwnerId() || '';
      const cv = document.getElementById('inkEditorCanvas');
      const rect = cv.getBoundingClientRect();
      o.rect = { l: rect.left, t: rect.top, w: rect.width, h: rect.height };
      window.__res = { rect: o.rect };
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
        const moves = spec.moves || 20;
        for (let i = 1; i <= moves; i += 1) {
          const t = i / moves;
          const e = t * t * (3 - 2 * t);
          const px = (1 - e) * (1 - e) * X(spec.x0) + 2 * (1 - e) * e * mx + e * e * x1;
          const py = (1 - e) * (1 - e) * Y(spec.y0) + 2 * (1 - e) * e * my + e * e * y1;
          fire('pointermove', px + (Math.random() - 0.5) * 1.8,
            py + (Math.random() - 0.5) * 1.8, 0.22 + 0.7 * Math.sin(t * Math.PI));
          if (i % 4 === 0) await new Promise(r2 => setTimeout(r2, 2));
        }
        fire('pointerup', x1, y1, 0);
        await new Promise(r2 => requestAnimationFrame(r2));
        return { work: Math.round(work * 10) / 10, wall: Math.round(performance.now() - t0) };
      };
      return JSON.stringify(o);
    })()`));
    if (!setup.editor) { console.log('HATA: editör açılmadı'); app.kill(); return; }
    console.log('sahne: ' + setup.order.length + ' katman · 2560x1400');

    /* ---- RÖNESANS PLANI ---- */
    const plan = JSON.parse(await evaluate(ws, `(async () => {
      const o = { layers: [] };
      const add = (name) => { const L = { name, strokes: [] }; o.layers.push(L); return L; };
      const mix = (a, b, t) => {
        const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
        const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
        return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
      };
      const rnd = (a, b) => a + Math.random() * (b - a);

      /* 0 · altın gökyüzü — yüksek sebattan ufka sıcak geçiş */
      {
        const L = add('Altın gökyüzü');
        for (let i = 0; i < 32; i += 1) {
          const t = i / 31;
          const y = 0.02 + 0.56 * t;
          L.strokes.push({ x0: -0.02 + rnd(0, 0.01), y0: y + rnd(-0.004, 0.004),
            x1: 1.02 - rnd(0, 0.01), y1: y + rnd(-0.004, 0.004),
            bow: 0.005 * (Math.random() - 0.5), moves: 30, size: 14 + 10 * Math.random(),
            color: t < 0.45 ? mix('#5b7fa8', '#c8a97c', t / 0.45)
              : t < 0.78 ? mix('#c8a97c', '#f0c98d', (t - 0.45) / 0.33)
                : mix('#f0c98d', '#f8dfa8', (t - 0.78) / 0.22) });
        }
      }
      /* 1 · uzak dağ silüeti — mor-kahve atmoferik专利 */
      {
        const L = add('Atmosferik dağlar');
        const peaks = [[0.12, 0.47], [0.34, 0.43], [0.58, 0.46], [0.84, 0.5]];
        for (const [pxx, py0] of peaks) {
          for (let i = 0; i < 22; i += 1) {
            const t = i / 21;
            const yy = py0 + (0.62 - py0) * t;
            const half = (1 - t) * 0.14 + 0.02;
            L.strokes.push({ x0: Math.max(0.01, pxx - half), y0: yy + rnd(-0.005, 0.005),
              x1: Math.min(0.99, pxx + half), y1: yy + rnd(-0.005, 0.005),
              bow: -0.01, moves: 20, size: 8 + 12 * Math.random(),
              color: mix('#9a8a76', '#6d5f50', rnd(0.1, 0.95)) });
          }
        }
      }
      /* 2 · پی güneş + hale — Consul ile sahte altın discar */
      {
        const L = add('Güneş halesi');
        const SX = 0.63, SY = 0.3;
        for (let i = 0; i < 18; i += 1) {
          const a = rnd(0, Math.PI * 2);
          const rr2 = rnd(0.02, 0.075);
          L.strokes.push({ x0: SX + Math.cos(a) * rr2 * 1.5, y0: SY + Math.sin(a) * rr2,
            x1: SX + Math.cos(a) * rr2 * 1.52, y1: SY + Math.sin(a) * rr2,
            bow: 0, moves: 8, size: 18 + 26 * Math.random(),
            color: mix('#ffedbd', '#f9d78d', Math.random()) });
        }
        for (let i = 0; i < 9; i += 1) {
          const t = i / 8;
          L.strokes.push({ x0: SX - 0.024 + rnd(-0.006, 0.006), y0: SY - 0.024 + t * 0.048,
            x1: SX + 0.024 + rnd(-0.006, 0.006), y1: SY - 0.024 + t * 0.048,
            bow: 0, moves: 7, size: 8 + 9 * Math.random(),
            color: t > 0.55 ? '#fffbe7' : '#ffe9b0' });
        }
      }
      /* 3 · altın bulutlar — açık tepeler + karanlık karınlar ayrı katmanlar */
      {
        const L = add('Bulut altın tepeler');
        for (let c = 0; c < 6; c += 1) {
          const cx = rnd(0.08, 0.92), cy = rnd(0.1, 0.36), wdt = rnd(0.05, 0.15);
          for (let i = 0; i < 8; i += 1) {
            const t = i / 7;
            L.strokes.push({ x0: cx - wdt * 0.5 + t * wdt, y0: cy + Math.sin(t * 5) * 0.007,
              x1: cx - wdt * 0.5 + t * wdt + 0.02, y1: cy + Math.sin(t * 5) * 0.007 + rnd(-0.003, 0.003),
              bow: 0.006, moves: 10, size: 12 + 16 * Math.random(),
              color: mix('#fdf2da', '#f8dcae', Math.random()) });
          }
        }
      }
      {
        const L = add('Bulut karanlık karınları');
        for (let c = 0; c < 6; c += 1) {
          const cx = rnd(0.08, 0.92), cy = rnd(0.13, 0.4), wdt = rnd(0.04, 0.12);
          for (let i = 0; i < 7; i += 1) {
            const t = i / 6;
            L.strokes.push({ x0: cx - wdt * 0.4 + t * wdt * 0.8, y0: cy + 0.014 + Math.cos(t * 4) * 0.004,
              x1: cx - wdt * 0.4 + t * wdt * 0.8 + 0.016, y1: cy + 0.014 + Math.cos(t * 4) * 0.004 + rnd(-0.002, 0.002),
              bow: -0.004, moves: 9, size: 9 + 14 * Math.random(),
              color: mix('#8a7059', '#6b5643', rnd(0.2, 0.9)) });
          }
        }
      }
      /* 4 · orta tepeler — umber/kahve kütleler */
      {
        const L = add('Umber tepeler');
        for (let k = 0; k < 3; k += 1) {
          const pxx = 0.16 + k * 0.34, py0 = k === 1 ? 0.56 : 0.6;
          for (let i = 0; i < 18; i += 1) {
            const t = i / 17;
            const yy = py0 + (0.72 - py0) * t;
            const half = (1 - t) * 0.21 + 0.02;
            L.strokes.push({ x0: Math.max(0.01, pxx - half), y0: yy + rnd(-0.004, 0.004),
              x1: Math.min(0.99, pxx + half), y1: yy + rnd(-0.004, 0.004),
              bow: -0.006, moves: 22, size: 12 + 16 * Math.random(),
              color: mix('#6b5741', '#4a3c2d', rnd(0.1, 0.85)) });
          }
        }
      }
      /* 5 · göl tabanı — huzurlu, hafif dalgalanma */
      {
        const L = add('Göl aynası');
        for (let r = 0; r < 18; r += 1) {
          const t = r / 17;
          const y = 0.745 + 0.24 * t;
          L.strokes.push({ x0: rnd(-0.01, 0.01), y0: y, x1: 1 - rnd(0, 0.01), y1: y + rnd(-0.002, 0.002),
            bow: 0.003, moves: 32, size: 14 + 12 * Math.random(),
            color: mix('#c9b08a', '#8e9a7b', t) });
        }
      }
      /* 6 · altın yansıma yolu */
      {
        const L = add('Altın yansıma yolu');
        for (let i = 0; i < 26; i += 1) {
          const y = 0.75 + Math.random() * 0.225;
          const wdt = 0.03 + Math.random() * 0.075;
          L.strokes.push({ x0: 0.63 - wdt + rnd(-0.015, 0.015), y0: y,
            x1: 0.63 + wdt + rnd(-0.015, 0.015), y1: y + rnd(-0.001, 0.001),
            bow: 0, moves: 9, size: 3 + 6 * Math.random(),
            color: mix('#ffe9ae', '#fff5d4', Math.random()) });
        }
      }
      /* 7 · yansıma ışık pırıltıları */
      {
        const L = add('Su parıltısı');
        for (let i = 0; i < 44; i += 1) {
          const y = 0.75 + Math.random() * 0.235;
          L.strokes.push({ x0: rnd(0.1, 0.9), y0: y, x1: rnd(0.1, 0.9), y1: y + rnd(-0.001, 0.001),
            bow: 0, moves: 7, size: 1.2 + 2.6 * Math.random(),
            color: Math.random() > 0.35 ? '#f2e0c0' : '#a8b394' });
        }
      }
      /* 8 · selvi ormanı — koyu yeşil alevler (alanın ana aksanı) */
      {
        const L = add('Selvi ormanı');
        for (let tr = 0; tr < 7; tr += 1) {
          const trunkX = 0.035 + tr * 0.058 + rnd(-0.006, 0.006);
          const topY = 0.47 + tr * 0.02 + rnd(0, 0.024);
          const botY = 0.78 + rnd(0, 0.03);
          L.strokes.push({ x0: trunkX, y0: botY, x1: trunkX + rnd(-0.002, 0.002), y1: topY + 0.045,
            bow: 0.002, moves: 14, size: 4 + 2 * Math.random(), color: '#231d12' });
          const steps = 14;
          for (let i = 0; i < steps; i += 1) {
            const t = i / (steps - 1);
            const yy = topY + (botY - topY) * t;
            const half = (1 - t) * 0.019 + 0.003;
            for (const sgn of [-1, 1]) {
              L.strokes.push({ x0: trunkX, y0: yy - 0.003, x1: trunkX + sgn * half * rnd(0.85, 1.15), y1: yy + 0.004,
                bow: sgn * 0.003, moves: 8, size: 2.2 + 3 * Math.random(),
                color: mix('#31452a', '#1e2c18', Math.random()) });
            }
          }
        }
      }
      /* 9 · zeytinlik — görüntü yanlarına yumuşak hale kümenler */
      {
        const L = add('Zeytinlik kümenleri');
        for (let c = 0; c < 10; c += 1) {
          const cx = Math.random() > 0.5 ? rnd(0.08, 0.3) : rnd(0.68, 0.95);
          const cy = rnd(0.6, 0.75), wdt = rnd(0.02, 0.05);
          for (let i = 0; i < 6; i += 1) {
            const t = i / 5;
            L.strokes.push({ x0: cx - wdt * 0.5 + t * wdt, y0: cy + Math.sin(t * 6) * 0.005,
              x1: cx - wdt * 0.5 + t * wdt + 0.013, y1: cy + Math.sin(t * 6) * 0.005 + rnd(-0.002, 0.002),
              bow: 0.003, moves: 9, size: 5 + 9 * Math.random(),
              color: mix('#576139', '#3f4a2b', Math.random()) });
          }
        }
      }
      /* 10 · ön teraslar — sıcak toprak */
      {
        const L = add('Ön toprak terasları');
        for (let i = 0; i < 28; i += 1) {
          const y = 0.855 + rnd(0, 0.045);
          L.strokes.push({ x0: rnd(0.02, 0.24), y0: y, x1: 0.85 + rnd(0, 0.14), y1: y + rnd(-0.003, 0.003),
            bow: 0.005, moves: 22, size: 11 + 17 * Math.random(),
            color: mix('#7a644c', '#57452f', Math.random()) });
        }
      }
      /* 11 · toprakta altın ışık çizgileri — chiaroscuro highlight'ları */
      {
        const L = add('Toprak ışık kanalları');
        for (let i = 0; i < 20; i += 1) {
          const y = rnd(0.86, 0.96);
          L.strokes.push({ x0: rnd(0.05, 0.4), y0: y, x1: rnd(0.5, 0.95), y1: y + rnd(-0.002, 0.002),
            bow: 0.002, moves: 10, size: 1.4 + 2.8 * Math.random(),
            color: mix('#d8b880', '#f0d9a4', Math.random()) });
        }
      }
      /* 12 · köşe vinyet — chiaroscuro karanlık çerçeve */
      {
        const L = add('Chiaroscuro vinyet');
        const corners = [[0, 0, 1, 0], [1, 0, -1, 0], [0, 1, 1, 0], [1, 1, -1, 0]];
        for (const [ccx, ccy, sxx, syy0] of corners) {
          for (let i = 0; i < 9; i += 1) {
            const t = i / 8;
            const y0 = ccy * 0.98 + (ccy ? -t * 0.1 : t * 0.02);
            L.strokes.push({ x0: ccx - sxx * t * 0.12, y0: y0 + syy0 * t * 0.1,
              x1: ccx + sxx * (0.03 + t * 0.1), y1: y0 + 0.012 + syy0 * t * 0.1,
              bow: 0.004, moves: 18, size: 30 + 36 * Math.random(),
              color: mix('#2e241a', '#1a140d', Math.random()) });
          }
        }
        for (let i = 0; i < 10; i += 1) {
          const t = i / 9;
          L.strokes.push({ x0: -0.02, y0: 0.02 + t * 0.95, x1: 0.09, y1: 0.02 + t * 0.95, bow: 0.004, moves: 14, size: 26 + 30 * Math.random(), color: mix('#2e241a', '#1a140d', Math.random()) });
          L.strokes.push({ x0: 0.91, y0: 0.02 + t * 0.95, x1: 1.02, y1: 0.02 + t * 0.95, bow: 0.004, moves: 14, size: 26 + 30 * Math.random(), color: mix('#2e241a', '#1a140d', Math.random()) });
        }
      }
      /* 13 · bulutlarda ışık kenarları — son parlama */
      {
        const L = add('Bulut ışık kenarları');
        for (let i = 0; i < 22; i += 1) {
          const cx = rnd(0.1, 0.9), cy = rnd(0.1, 0.4);
          L.strokes.push({ x0: cx, y0: cy, x1: cx + rnd(0.02, 0.06), y1: cy + rnd(-0.004, 0.004),
            bow: 0.004, moves: 9, size: 2 + 4 * Math.random(),
            color: '#fff8e2' });
        }
      }
      /* 14 · kuşlar */
      {
        const L = add('Kuşlar');
        for (let b = 0; b < 3; b += 1) {
          const bx = rnd(0.2, 0.75), by = rnd(0.2, 0.36), s = rnd(0.007, 0.011);
          L.strokes.push({ x0: bx - s, y0: by, x1: bx, y1: by - s * 0.5, bow: -0.0024, moves: 5, size: 1.5, color: '#33291d' });
          L.strokes.push({ x0: bx, y0: by - s * 0.5, x1: bx + s, y1: by, bow: -0.0024, moves: 5, size: 1.5, color: '#33291d' });
        }
      }
      o.brushes = (typeof inkState === 'function' ? inkState().brushes : [])
        .map(b => b.id).filter(id => !/eraser|silgi/i.test(id));
      o.totalStrokes = o.layers.reduce((a, L) => a + L.strokes.length, 0);
      o.planPerLayer = o.layers.map(L => L.strokes.length);
      return JSON.stringify(o);
    })()`));
    console.log('plan: ' + plan.layers.length + ' katman · ' + plan.totalStrokes + ' vuruş · '
      + plan.brushes.length + ' fırça adayı');

    /* ---- ressam: katman katman; fırça değişimi maliyeti ölçülür ---- */
    const painting = JSON.parse(await evaluate(ws, `(async () => {
      const plan = ${JSON.stringify(plan)};
      const brushes = plan.brushes;
      const s = inkState();
      const rows = [];
      let switchCount = 0;
      for (let i = 0; i < plan.layers.length; i += 1) {
        const L = plan.layers[i];
        const layerId = (window.__order || [])[i];
        if (!layerId) { rows.push({ name: L.name, planned: L.strokes.length, painted: 0, err: 'katman yok' }); continue; }
        inkDocSelectLayer(layerId);
        let work = 0, wall = 0, maxWork = 0, switchWork = 0;
        for (let k = 0; k < L.strokes.length; k += 1) {
          const spec = L.strokes[k];
          if (brushes.length && (k % 5 === 0 || L.strokes.length < 4)) {
            const bid = brushes[(i * 7 + k) % brushes.length];
            const t = performance.now();
            try { if (typeof setActiveBrush === 'function') setActiveBrush(bid); else inkSetTool('brush', { brushId: bid }); } catch { /* */ }
            switchWork += performance.now() - t;
            switchCount += 1;
          }
          s.size = Math.max(1, Math.min(400, spec.size));
          try { inkSetColor(spec.color, false); } catch { s.color = spec.color; }
          const r = await window.__draw(spec);
          work += r.work; wall += r.wall; maxWork = Math.max(maxWork, r.work);
        }
        rows.push({ name: L.name, planned: L.strokes.length, painted: L.strokes.length,
          avg: Math.round(work / Math.max(1, L.strokes.length) * 100) / 100,
          max: Math.round(maxWork * 10) / 10,
          wall: Math.round(wall / Math.max(1, L.strokes.length) * 10) / 10,
          switch: Math.round(switchWork * 10) / 10 });
        /* katman biter bitmez doc'ta kalan vuruş sayısı — bake semantiği */
        const rec = inkDocLayersTopFirst(window.__owner || inkDocOwnerId() || '')
          .find(x => x.id === layerId);
        rows[rows.length - 1].doc = rec ? (rec.strokes || []).length : -1;
        rows[rows.length - 1].docPts = rec ? (rec.strokes || []).reduce((a, s2) => a + (s2.points || []).length, 0) : -1;
      }
      return JSON.stringify({ rows, switchCount });
    })()`));
    console.log('fırça değişim sayısı=' + painting.switchCount);
    for (const r of painting.rows) {
      if (r.err) { console.log('  ⚠ ' + r.name + ': ' + r.err); continue; }
      console.log('  ▸ ' + r.name.padEnd(24) + ' vuruş=' + r.planned
        + '  ort=' + r.avg + 'ms  max=' + r.max + 'ms  duvar=' + r.wall + 'ms  fırçaGeçiş=' + r.switch + 'ms');
    }

    /* ---- FİDANLIK: her katman çizilirken bitiminde doc sayısı zaten alındı ---- */
    console.log('');
    console.log('=== PLAN → DOC (katman bitiminde bake göstergesi) ===');
    for (const r of painting.rows) {
      if (r.err) continue;
      const flag = r.doc === r.painted ? '✓ tam' : r.doc === 0 ? '⟲ bake: hepsi raster\'e' : '◇ kısmi';
      console.log('  ' + r.name.padEnd(24) + ' plan=' + r.painted + ' doc=' + r.doc
        + ' pts=' + r.docPts + '  ' + flag);
    }

    /* ---- gerçek kare süresi + undo + katman geçişi + bellek ---- */
    const inter = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const cv = document.getElementById('inkEditorCanvas');
      const rr = window.__res.rect;
      const o = {};
      const s = inkState();
      s.size = 22;
      const deltas = [];
      for (let k = 0; k < 14; k += 1) {
        const sy = 0.04 + 0.032 * k;
        cv.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
          clientX: rr.l + 0.03 * rr.w, clientY: rr.t + sy * rr.h,
          button: 0, buttons: 1, pressure: 0.35, tiltX: 0, tiltY: 0, twist: 0,
        }));
        let prev = performance.now();
        for (let i = 1; i <= 18; i += 1) {
          const x = 0.03 + 0.94 * (i / 18);
          cv.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
            clientX: rr.l + x * rr.w, clientY: rr.t + (sy + 0.004 * i / 18) * rr.h,
            button: 0, buttons: 1, pressure: 0.3 + 0.6 * Math.sin(i / 18 * Math.PI),
            tiltX: 0, tiltY: 0, twist: 0,
          }));
          await new Promise(r => requestAnimationFrame(() => r()));
          const now = performance.now();
          deltas.push(Math.round((now - prev) * 10) / 10);
          prev = now;
          if (i % 3 === 0) await new Promise(r => setTimeout(r, 3));
        }
        cv.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
          clientX: rr.l + 0.97 * rr.w, clientY: rr.t + (sy + 0.004) * rr.h,
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
      const ids = inkDocLayersTopFirst(inkDocOwnerId() || '').map(l => l.id);
      const ls = [];
      for (let i = 0; i < 10 && i < ids.length; i += 1) {
        const t = performance.now();
        inkDocSelectLayer(ids[i]);
        await new Promise(res => requestAnimationFrame(res));
        ls.push(Math.round((performance.now() - t) * 10) / 10);
        await wait(20);
      }
      o.layerSwitch = Math.round(ls.reduce((a, b) => a + b, 0) / Math.max(1, ls.length) * 10) / 10;
      o.mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
      return JSON.stringify(o);
    })()`));

    /* ---- özet ---- */
    console.log('');
    console.log('=== CANLI ÇİZİM KARE SÜRESİ (doc dolu) ===');
    console.log('ortalama=' + inter.frameAvg + 'ms · p50=' + inter.frameP50 + 'ms · p95=' + inter.frameP95
      + 'ms · max=' + inter.frameMax + 'ms · FPS≈' + inter.fps);
    console.log('undo=' + inter.undo.join(',') + 'ms · katman geçişi=' + inter.layerSwitch
      + 'ms · heap=' + inter.mem + ' MB');

    /* ---- ekran görüntüsü: editör tuvali 2D bağlam — canvas.toDataURL her
       koşulda çalışır (CDP Page.captureScreenshot bu uygulamada boş döner) ---- */
    const shots = JSON.parse(await evaluate(ws, `(async () => {
      const cv = document.getElementById('inkEditorCanvas');
      const rr = window.__res.rect;
      cv.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse',
        clientX: rr.l + rr.w * 0.5, clientY: rr.t + rr.h * 0.5, button: 0, buttons: 0,
      }));
      for (let i = 0; i < 6; i += 1) await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => setTimeout(r, 400));
      const o = {};
      o.canvasLen = (cv.toDataURL('image/png') || '').length;
      o.canvas = cv.toDataURL('image/png');
      return JSON.stringify(o);
    })()`));
    const outDir = path.join(os.tmpdir(), 'tailref-probe-out');
    fs.mkdirSync(outDir, { recursive: true });
    if (shots.canvasLen > 1000) {
      const p = path.join(outDir, 'ronesans-manzara.png');
      fs.writeFileSync(p, Buffer.from(shots.canvas.replace(/^data:image\/png;base64,/, ''), 'base64'));
      console.log('TUVAL GÖRÜNTÜSÜ: ' + p + ' (' + Math.round(shots.canvasLen / 1024) + ' KB)');
    } else {
      console.log('tuval toDataURL de boş döndü (uzunluk=' + shots.canvasLen + ')');
    }

    /* ---- SÖZ: tabloyu ekranda göstermek için uygulamayı açık bırak ---- */
    console.log('uygulama 40 sn açık kalıyor — tabloyu masada görebilirsin');
    await sleep(40000);
  } catch (e) {
    console.error('HATA:', e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
