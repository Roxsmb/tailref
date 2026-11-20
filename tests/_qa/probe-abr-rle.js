'use strict';
/* QA: gerçek .abr dosyalarındaki gibi PackBits/RLE sıkıştırmalı uç. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start, sleep } = require('./harness');

const APP_PORT = 5375;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-abr-rle-'));

function buildRleAbr(name, size) {
  const out = [];
  const u16 = n => out.push((n >> 8) & 255, n & 255);
  const u32 = n => out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  const i32 = n => u32(n >>> 0);
  const f64 = n => { const t = new Uint8Array(8); new DataView(t.buffer).setFloat64(0, n); for (const b of t) out.push(b); };
  const ascii = s => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255); };
  const uni = s => { u32(s.length); for (let i = 0; i < s.length; i++) u16(s.charCodeAt(i)); };
  const id = s => { u32(s.length); ascii(s); };
  const numField = (key, unit, value) => { id(key); ascii('UntF'); ascii(unit); f64(value); };
  const textField = (key, value) => { id(key); ascii('TEXT'); uni(value); };
  const descriptor = (cls, fields) => { uni(cls); id(cls); u32(fields.length); for (const f of fields) f(); };
  const patch32 = (pos, n) => { out[pos] = (n >>> 24) & 255; out[pos + 1] = (n >>> 16) & 255; out[pos + 2] = (n >>> 8) & 255; out[pos + 3] = n & 255; };
  const block = (tag, payload) => {
    ascii('8BIM'); ascii(tag);
    const sizePos = out.length; u32(0);
    const start = out.length; payload();
    patch32(sizePos, out.length - start);
    while (out.length % 4) out.push(0);
  };

  /* 32×32 yumuşak daire maskesi */
  const w = size, h = size;
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - w / 2 + 0.5, dy = y - h / 2 + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      alpha[y * w + x] = Math.max(0, Math.min(255, Math.round((1 - d / (w / 2 - 1)) * 255)));
    }
  }
  /* düz PackBits akışı: her satır için tek literal run */
  const rle = [];
  for (let y = 0; y < h; y++) {
    rle.push(w - 1);
    for (let x = 0; x < w; x++) rle.push(alpha[y * w + x]);
  }

  const entry = [];
  const ev = new DataView(new ArrayBuffer(66));
  ev.setUint32(0, 2);
  ev.setUint32(4, size);
  ev.setUint32(8, 10);
  ev.setUint32(12, 0);
  ev.setUint32(16, 100);
  ev.setUint32(20, 80);
  ev.setUint32(24, 100);
  ev.setInt32(47, 0); ev.setInt32(51, 0);
  ev.setInt32(55, h); ev.setInt32(59, w);
  ev.setUint16(63, 8);
  ev.setUint8(65, 1); // PackBits
  for (const b of new Uint8Array(ev.buffer)) entry.push(b);
  for (const b of rle) entry.push(b);

  u16(6); u16(2);
  block('desc', () => {
    u32(1);
    descriptor('brushPreset', [() => textField('Nm  ', name)]);
  });
  block('cbsh', () => {
    u32(16);
    descriptor('computedBrush', [
      () => numField('Dmtr', '#Pxl', size),
      () => numField('Hrdn', '#Prc', 80),
      () => numField('Spcn', '#Prc', 10),
      () => numField('Angl', '#Ang', 0),
      () => numField('Rndn', '#Prc', 100),
      () => numField('Flw ', '#Prc', 100),
      () => numField('Sctr', '#Prc', 0),
      () => numField('SzVr', '#Prc', 82),
      () => numField('AnVr', '#Prc', 0),
      () => numField('ScVr', '#Prc', 0),
    ]);
  });
  block('samp', () => {
    u16(1); u16(1);
    u32(entry.length);
    for (const b of entry) out.push(b);
    while (out.length % 4) out.push(0);
  });
  return Buffer.from(out);
}

(async () => {
  const file = buildRleAbr('QA RLE Uç ' + Date.now(), 32);
  const outPath = path.join(os.tmpdir(), 'tailref-qa-rle.abr');
  fs.writeFileSync(outPath, file);
  console.log('RLE .abr:', outPath, file.length, 'bayt');

  const app = await start({ port: 9513, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-abr-rle-' });
  try {
    const b64 = file.toString('base64');
    const res = await app.json(`(async () => {
      const raw = atob(${JSON.stringify(b64)});
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      const parsed = inkParseAbr(arr);
      const input = document.getElementById('inkAbrInput');
      const before = inkState().brushes.length;
      const dt = new DataTransfer();
      dt.items.add(new File([arr], 'rle.abr', { type: 'application/octet-stream' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (inkState().brushes.length > before) break;
      }
      await new Promise(r => setTimeout(r, 800));
      const added = inkState().brushes.slice(before);
      const b = added[0];
      const img = b && b.tipId && inkRuntimeBrushes.abrImages.get(b.tipId);
      return JSON.stringify({
        parsed: parsed.map(t => ({ kind: t.kind, name: t.name, w: t.width, h: t.height, data: !!t.dataUrl })),
        added: added.length,
        brush: b && { name: b.name, category: b.category, tipId: b.tipId, tipData: inkRuntime.importedTips.has(b.tipId) },
        img: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
        notice: (window.__qaNotices || []).slice(-1),
      });
    })()`);
    console.log(JSON.stringify(res, null, 2));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
