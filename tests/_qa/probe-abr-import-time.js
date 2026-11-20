'use strict';
/* QA: büyük .abr içe aktarma ne kadar sürüyor, arayüz donuyor mu?
   Gerçek 22 MB Photoshop seti ile ölçer (dosya repoda yok). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('./harness');

const APP_PORT = 5401;
const FILE = process.argv[2] ||
  path.join(os.tmpdir(), 'tailref-real-abr', '20 Smoke PS Brushes abr. Vol.6', '20 Smoke Brushes.abr');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-abr-time-'));
const bytes = fs.readFileSync(FILE);

async function pushBytes(app) {
  const CHUNK = 3 * 1024 * 1024;
  await app.evaluate(`window.__abrChunks = []; true`);
  for (let at = 0; at < bytes.length; at += CHUNK) {
    const part = bytes.subarray(at, Math.min(bytes.length, at + CHUNK)).toString('base64');
    await app.evaluate(`window.__abrChunks.push(${JSON.stringify(part)}); true`);
  }
  await app.evaluate(`(() => {
    const bin = atob(window.__abrChunks.join(''));
    window.__abrChunks = null;
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    window.__qaAbr = arr;
    return true;
  })()`);
}

(async () => {
  const app = await start({ port: 9535, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-abr-time-' });
  try {
    await pushBytes(app);
    const out = await app.json(`(async () => {
      const before = inkState().brushes.length;
      /* Arayüz donmasını yakala: rAF aralıklarını kaydet. */
      const gaps = [];
      let last = performance.now();
      let running = true;
      const tick = () => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 300));
      gaps.length = 0;
      last = performance.now();

      /* Ayrıştırma ve kayıt ayrı ayrı ölçülsün. */
      const t0 = performance.now();
      const parsed = inkParseAbr(window.__qaAbr);
      const parseMs = performance.now() - t0;

      const t1 = performance.now();
      const dt = new DataTransfer();
      dt.items.add(new File([window.__qaAbr], '20 Smoke Brushes.abr', { type: 'application/octet-stream' }));
      const input = document.getElementById('inkAbrInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 600; i++) {
        await new Promise(r => setTimeout(r, 50));
        if (inkState().brushes.length >= before + 4) break;
      }
      const importMs = performance.now() - t1;
      await new Promise(r => setTimeout(r, 1200));
      running = false;

      const sorted = gaps.slice().sort((a, b) => a - b);
      const maxGap = sorted.length ? sorted[sorted.length - 1] : 0;
      const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
      const over100 = gaps.filter(g => g > 100).length;
      return JSON.stringify({
        fileBytes: window.__qaAbr.length,
        parsedCount: parsed.length,
        parseMs: Math.round(parseMs),
        importMs: Math.round(importMs),
        added: inkState().brushes.length - before,
        frames: gaps.length,
        maxGapMs: Math.round(maxGap),
        p95GapMs: Math.round(p95),
        framesOver100ms: over100,
      });
    })()`);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
