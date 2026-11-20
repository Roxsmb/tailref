'use strict';
/* QA: gerçek dünyadan indirilmiş 22 MB'lık Photoshop fırça seti.
   Dosya v6.2 ve tek dev `samp` bloğuyla başlıyor (samp + desc + phry;
   hiç cbsh yok). Ayrıştırıcının bu düzeni ve büyük dosyayı kaldırması
   sınanıyor. Baytlar CDP mesajını şişirmemek için parça parça geçilir. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('./harness');

const APP_PORT = 5379;
const FILE = process.argv[2] ||
  path.join(os.tmpdir(), 'tailref-real-abr', '20 Smoke PS Brushes abr. Vol.6', '20 Smoke Brushes.abr');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-abr-real-'));

(async () => {
  const bytes = fs.readFileSync(FILE);
  console.log('dosya:', path.basename(FILE), bytes.length, 'bayt');
  const app = await start({ port: 9517, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-abr-real-' });
  try {
    const CHUNK = 3 * 1024 * 1024;
    await app.evaluate(`window.__abrChunks = []; true`);
    for (let at = 0; at < bytes.length; at += CHUNK) {
      const part = bytes.subarray(at, Math.min(bytes.length, at + CHUNK)).toString('base64');
      await app.evaluate(`window.__abrChunks.push(${JSON.stringify(part)}); true`);
    }
    const parsed = await app.json(`(() => {
      const t0 = performance.now();
      const raw = window.__abrChunks.join('');
      window.__abrChunks = null;
      const bin = atob(raw);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const msRead = Math.round(performance.now() - t0);
      const t1 = performance.now();
      const tips = inkParseAbr(arr);
      const msParse = Math.round(performance.now() - t1);
      window.__qaAbr = arr;
      return JSON.stringify({
        bytes: arr.length, msRead, msParse,
        error: inkRuntime.lastAbrError || '',
        count: tips.length,
        kinds: tips.reduce((m, t) => { m[t.kind] = (m[t.kind] || 0) + 1; return m; }, {}),
        tips: tips.map(t => ({
          kind: t.kind, name: t.name || '',
          w: t.width || t.sampledWidth || 0, h: t.height || t.sampledHeight || 0,
          data: !!t.dataUrl, dual: !!(t.dual && t.dual.tipDataUrl),
          hardness: t.hardness, spacing: t.spacing,
        })),
      });
    })()`);
    console.log('ayrıştırma:', JSON.stringify(parsed, null, 2));

    /* Gerçek dosyayı dosya girişinden içe aktar: ilk 64 fırça kütüphaneye düşmeli. */
    const imported = await app.json(`(async () => {
      const input = document.getElementById('inkAbrInput');
      const before = inkState().brushes.length;
      const dt = new DataTransfer();
      dt.items.add(new File([window.__qaAbr], '20 Smoke Brushes.abr', { type: 'application/octet-stream' }));
      input.files = dt.files;
      const t0 = performance.now();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (inkState().brushes.length > before) break;
      }
      await new Promise(r => setTimeout(r, 1500));
      const ms = Math.round(performance.now() - t0);
      const added = inkState().brushes.slice(before);
      const inCustom = added.filter(b => inkNativeBrushesForCategory('custom').some(x => x.id === b.id)).length;
      const withTip = added.filter(b => b.tipId && inkRuntime.importedTips.has(b.tipId)).length;
      return JSON.stringify({
        ms, added: added.length, inCustom, withTip,
        sample: added.slice(0, 6).map(b => ({ name: b.name, category: b.category, tipId: b.tipId })),
        errors: (window.__qaErrs || []).slice(0, 5),
        notice: (window.__qaNotices || []).slice(-1),
      });
    })()`);
    console.log('içe aktarma:', JSON.stringify(imported, null, 2));

    const lib = await app.json(`(async () => {
      const db = await idbGet('meta', 'ink:brushes');
      const total = Array.isArray(db) ? db.length : 0;
      const bytes = Array.isArray(db)
        ? db.reduce((n, r) => n + (r && r.brush && r.brush.tipData ? String(r.brush.tipData).length : 0), 0) : 0;
      return JSON.stringify({ stored: total, tipChars: bytes });
    })()`);
    console.log('kayıt:', JSON.stringify(lib));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
