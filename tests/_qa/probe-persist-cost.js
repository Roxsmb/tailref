'use strict';
/* QA: fırça kütüphanesi yazma maliyeti.
   Gerçek 22 MB Photoshop setini içe aktarıp (4 uç) favori yıldızı ile
   tam fırça kaydının süresini ve yazılan veri boyutunu ölçer. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('./harness');

const APP_PORT = 5383;
const FILE = process.argv[2] ||
  path.join(os.tmpdir(), 'tailref-real-abr', '20 Smoke PS Brushes abr. Vol.6', '20 Smoke Brushes.abr');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-persist-cost-'));
const bytes = fs.readFileSync(FILE);

(async () => {
  const app = await start({ port: 9523, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-persist-cost-' });
  try {
    const CHUNK = 3 * 1024 * 1024;
    await app.evaluate(`window.__abrChunks = []; true`);
    for (let at = 0; at < bytes.length; at += CHUNK) {
      const part = bytes.subarray(at, Math.min(bytes.length, at + CHUNK)).toString('base64');
      await app.evaluate(`window.__abrChunks.push(${JSON.stringify(part)}); true`);
    }
    const out = await app.json(`(async () => {
      const bin = atob(window.__abrChunks.join(''));
      window.__abrChunks = null;
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([arr], '20 Smoke Brushes.abr', { type: 'application/octet-stream' }));
      const input = document.getElementById('inkAbrInput');
      const before = inkState().brushes.length;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (inkState().brushes.length >= before + 4) break;
      }
      await new Promise(r => setTimeout(r, 1200));
      const added = inkState().brushes.slice(before);
      const tipChars = added.reduce((n, b) => n + (inkRuntime.importedTips.get(b.tipId) || '').length, 0);

      /* favori: yalnız meta yazmalı */
      const t0 = performance.now();
      await inkNativeToggleFavorite(added[0].id);
      const favMs = performance.now() - t0;

      /* tam fırça kaydı (kendi yazıcımız): uç verisi de serileşir */
      const t1 = performance.now();
      await inkPersistImportedBrushes();
      const fullMs = performance.now() - t1;

      /* kayıt boyutu */
      const recs = await idbGet('meta', 'ink:brushes');
      const storedChars = Array.isArray(recs)
        ? recs.reduce((n, r) => n + String(r.tipDataUrl || '').length + String(r.dualTipDataUrl || '').length, 0) : 0;

      return JSON.stringify({
        brushes: added.length,
        tipChars, storedChars,
        favoriteMs: Math.round(favMs),
        fullPersistMs: Math.round(fullMs),
        records: Array.isArray(recs) ? recs.length : 0,
      });
    })()`);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
