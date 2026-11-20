'use strict';
/* FX görsel kabul turu: 20 efektin varsayılan + tüm built-in preset
   çıktılarını GERÇEK motorla (def.apply) kontakt sayfasına basar.

   Çıktı: docs/fx-qa/fx-<kategori>.png (3 sayfa)
   Kontroller: boş çıktı, aynı preset (varsayılanla birebir), determinizm.
   Kullanım: node tests/fx-visual-qa.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'fx-qa');
const PORT = 9361;
const APP_PORT = 5271;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const evaluate = (ws, expression, timeout = 180000) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const timer = setTimeout(() => reject(new Error('eval timeout')), timeout);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    clearTimeout(timer);
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result && msg.result.exceptionDetails) {
      return reject(new Error((msg.result.exceptionDetails.exception || {}).description || 'eval err'));
    }
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-fxqa-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--disable-gpu'],
    { cwd: ROOT, env, stdio: 'ignore' });

  try {
    let page = null;
    const end = Date.now() + 25000;
    while (Date.now() < end && !page) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`)) || null;
      } catch { /* uygulama henüz açılmadı */ }
      if (!page) await sleep(400);
    }
    if (!page) throw new Error('Electron sayfası bulunamadı');
    const ws = await new Promise((res, rej) => {
      const w = new WebSocket(page.webSocketDebuggerUrl);
      w.onopen = () => res(w); w.onerror = rej;
    });
    await sleep(2600);
    await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (w && !w.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
      }
    })()`);
    for (let i = 0; i < 40; i++) {
      const ok = await evaluate(ws, '!!(window.__tailrefWorkspace && window.__tailrefWorkspace.ready)').catch(() => false);
      if (ok) break;
      await sleep(400);
    }

    const raw = await evaluate(ws, `(() => {
      const CW = 192, CH = 144, GAP = 10, LABEL = 154, TOP = 40, CAP = 26;
      const PAPER = '#f6f3ea', INK = '#1d1b18', MUTED = '#6d6a63', LINE = '#d8d2c4';
      const sample = (() => {
        const c = document.createElement('canvas');
        const w = CW, h = CH;
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        const grd = g.createLinearGradient(0, 0, w, h);
        grd.addColorStop(0, '#c0392b'); grd.addColorStop(0.35, '#f1c40f');
        grd.addColorStop(0.68, '#27ae60'); grd.addColorStop(1, '#2c3e50');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        const rg = g.createRadialGradient(w * 0.7, h * 0.3, 3, w * 0.7, h * 0.3, 52);
        rg.addColorStop(0, 'rgba(255,255,255,0.95)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.beginPath(); g.ellipse(w * 0.24, h * 0.72, 34, 22, 0.4, 0, Math.PI * 2); g.fill();
        for (let x = 0; x < w; x += 6) {
          g.fillStyle = x % 12 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.16)';
          g.fillRect(x, 0, 3, h);
        }
        g.globalCompositeOperation = 'destination-out';
        const hole = g.createRadialGradient(w * 0.52, h * 0.82, 2, w * 0.52, h * 0.82, 38);
        hole.addColorStop(0, 'rgba(0,0,0,1)'); hole.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = hole; g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
        return c;
      })();

      const hashOf = ctx => {
        const d = ctx.getImageData(0, 0, CW, CH).data;
        let sum = 0, cov = 0;
        for (let i = 0; i < d.length; i += 4) {
          sum = (sum * 31 + d[i] * 7 + d[i + 1] * 11 + d[i + 2] * 13 + d[i + 3] * 17) >>> 0;
          if (d[i + 3] > 8) cov++;
        }
        return { hash: String(sum), cov };
      };
      const render = (def, params) => {
        const c = document.createElement('canvas');
        c.width = CW; c.height = CH;
        const g = c.getContext('2d', { colorSpace: 'srgb' });
        def.apply(g, sample, params, { w: CW, h: CH }, inkFxRng(def.seed || 0x5eed));
        return hashOf(g);
      };

      const cats = [
        ['printmaking', 'Printmaking / Baskı'],
        ['traditional', 'Traditional Media / Geleneksel'],
        ['experimental', 'Experimental Illustration / Deneysel'],
      ];
      const out = { sheets: {}, report: [], errors: [] };

      for (const [cat, catLabel] of cats) {
        const defs = [...INK_FX_EFFECTS.values()].filter(d => d.category === cat);
        let maxP = 0;
        for (const d of defs) maxP = Math.max(maxP, (INK_FX_PRESETS[d.id] || []).length);
        const cols = maxP + 1;
        const W = LABEL + cols * (CW + GAP) + GAP;
        const H = TOP + defs.length * (CH + CAP + GAP) + GAP;
        const sheet = document.createElement('canvas');
        sheet.width = W; sheet.height = H;
        const g = sheet.getContext('2d', { colorSpace: 'srgb' });
        g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
        g.fillStyle = INK;
        g.font = '600 18px Segoe UI, system-ui, sans-serif';
        g.fillText(catLabel, GAP, 26);
        g.fillStyle = MUTED;
        g.font = '11px Segoe UI, system-ui, sans-serif';
        g.fillText('TailRef Studio · FX visual QA · gerçek motor çıktısı (varsayılan + built-in presetler)', GAP, H - 6);

        defs.forEach((def, row) => {
          const y = TOP + row * (CH + CAP + GAP);
          const presets = INK_FX_PRESETS[def.id] || [];
          const base = inkFxUiResolvePreset(def.id, null);
          const h0 = render(def, base);
          const h0b = render(def, base);
          if (h0.cov === 0) out.errors.push(def.id + ': varsayılan çıktı boş');
          if (h0.hash !== h0b.hash) out.errors.push(def.id + ': determinizm farkı');

          /* sol etiket */
          g.fillStyle = INK;
          g.font = '600 13px Segoe UI, system-ui, sans-serif';
          const words = def.label.split(' ');
          let line = '', ly = y + CH / 2 - 8;
          for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (g.measureText(test).width > LABEL - GAP * 2 && line) {
              g.fillText(line, GAP, ly); ly += 16; line = w;
            } else line = test;
          }
          g.fillText(line, GAP, ly);
          g.fillStyle = MUTED;
          g.font = '10px Segoe UI, system-ui, sans-serif';
          g.fillText(def.params.length + ' parametre', GAP, ly + 16);

          const cells = [{ name: 'Default', params: base, rec: h0 }];
          for (const pr of presets) {
            const params = inkFxUiResolvePreset(def.id, pr.p);
            cells.push({ name: pr.name, params, rec: render(def, params) });
          }
          const rowReport = { id: def.id, label: def.label, defaultCov: h0.cov, presets: [] };
          cells.forEach((cell, col) => {
            const x = LABEL + col * (CW + GAP);
            /* hücre zemini + kenar */
            g.fillStyle = '#ffffff';
            g.fillRect(x - 1, y - 1, CW + 2, CH + 2);
            const cg = g;
            cg.save();
            cg.beginPath(); cg.rect(x, y, CW, CH); cg.clip();
            const tmp = document.createElement('canvas');
            tmp.width = CW; tmp.height = CH;
            const tctx = tmp.getContext('2d', { colorSpace: 'srgb' });
            def.apply(tctx, sample, cell.params, { w: CW, h: CH }, inkFxRng(def.seed || 0x5eed));
            cg.drawImage(tmp, x, y);
            cg.restore();
            g.strokeStyle = LINE;
            g.lineWidth = 1;
            g.strokeRect(x - 0.5, y - 0.5, CW + 1, CH + 1);
            if (col > 0) {
              const diff = cell.rec.hash !== h0.hash;
              if (!diff) out.errors.push(def.id + ' · ' + cell.name + ': varsayılanla birebir aynı');
              if (cell.rec.cov === 0) out.errors.push(def.id + ' · ' + cell.name + ': çıktı boş');
              rowReport.presets.push({ name: cell.name, cov: cell.rec.cov, diff });
            }
            /* hücre başlığı */
            g.fillStyle = col === 0 ? INK : MUTED;
            g.font = (col === 0 ? '600 ' : '') + '10px Segoe UI, system-ui, sans-serif';
            const label = cell.name.length > 30 ? cell.name.slice(0, 29) + '…' : cell.name;
            g.fillText(label, x, y + CH + 15);
          });
          out.report.push(rowReport);
        });

        out.sheets[cat] = sheet.toDataURL('image/png');
      }
      return JSON.stringify(out);
    })()`, 300000);

    const data = JSON.parse(raw);
    for (const [cat, url] of Object.entries(data.sheets)) {
      const b64 = url.slice(url.indexOf(',') + 1);
      const file = path.join(OUT_DIR, 'fx-' + cat + '.png');
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      console.log('YAZILDI ' + path.relative(ROOT, file) + ' (' + Math.round(b64.length * 0.75 / 1024) + ' KB)');
    }

    console.log('');
    for (const row of data.report) {
      const ok = row.presets.every(p => p.diff && p.cov > 0);
      console.log((ok ? 'OK   ' : 'FAIL ') + row.id
        + ' · default cov ' + row.defaultCov
        + ' · presetler ' + row.presets.map(p => p.name + (p.diff ? '≠' : '=') + p.cov).join(', '));
    }
    if (data.errors.length) {
      console.log('\nHATALAR:');
      for (const e of data.errors) console.log(' - ' + e);
    }
    const presetCount = data.report.reduce((n, r) => n + r.presets.length, 0);
    console.log('\nFX QA: ' + data.report.length + ' efekt · ' + presetCount + ' preset · '
      + (data.errors.length ? data.errors.length + ' hata' : 'hata yok'));
    app.kill();
    process.exit(data.errors.length ? 1 : 0);
  } catch (e) {
    console.error('FX QA HATA:', e.message);
    try { app.kill(); } catch { /* zaten kapalı */ }
    process.exit(1);
  }
})();
