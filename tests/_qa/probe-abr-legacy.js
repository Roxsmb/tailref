'use strict';
/* QA: eski (v1/v2, 39 baytlık başlık) ve 16-bit .abr dosyaları ayrıştırılıyor mu?
   Bizim yazıcımız yalnızca v6.2 + 8-bit üretiyor; sahada dolaşan dosyaların
   bir kısmı bu iki varyantta. Ayrıştırıcı iddiasını burada sınıyoruz. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('./harness');

const APP_PORT = 5377;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-abr-legacy-'));

const PAD = 39; // legacy kayıtta başlığın beklenen ofseti

function alphaMask(size) {
  const a = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2 + 0.5, dy = y - size / 2 + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      a[y * size + x] = Math.max(0, Math.min(255, Math.round((1 - d / (size / 2 - 1)) * 255)));
    }
  }
  return a;
}

/* 39 bayt dolgu + PSD başlığı + piksel. depth=8/16, compression=0/1. */
function tipEntry(size, { depth = 8, rle = false } = {}) {
  const a = alphaMask(size);
  const bpp = depth === 16 ? 2 : 1;
  const out = [];
  for (let i = 0; i < PAD; i++) out.push(0);
  const hdr = new DataView(new ArrayBuffer(19));
  hdr.setInt32(0, 0);
  hdr.setInt32(4, 0);
  hdr.setInt32(8, size);
  hdr.setInt32(12, size);
  hdr.setUint16(16, depth);
  hdr.setUint8(18, rle ? 1 : 0);
  for (const b of new Uint8Array(hdr.buffer)) out.push(b);

  const pushPixel = (v, hi) => {
    if (depth === 8) out.push(v);
    else out.push(hi ? v : 0, hi ? 0 : v);
  };
  if (!rle) {
    for (let i = 0; i < a.length; i++) pushPixel(a[i], true);
    return Buffer.from(out);
  }
  /* tek düz PackBits akışı: her satır literal run */
  const rowBytes = size * bpp;
  for (let y = 0; y < size; y++) {
    const bytes = [];
    for (let x = 0; x < size; x++) {
      if (depth === 8) bytes.push(a[y * size + x]);
      else { bytes.push(a[y * size + x], 0); }
    }
    out.push(rowBytes - 1);
    for (const b of bytes) out.push(b);
  }
  return Buffer.from(out);
}

function legacyAbr(name, entries) {
  const out = [];
  out.push(0, 1);                 // major = 1
  out.push(0, entries.length);    // minor = kayıt sayısı
  for (const entry of entries) {
    const n = entry.length;
    out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    for (const b of entry) out.push(b);
  }
  return Buffer.from(out);
}

function v6Abr(name, entry) {
  const out = [];
  const u16 = n => out.push((n >> 8) & 255, n & 255);
  const u32 = n => out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  const patch32 = (pos, n) => { out[pos] = (n >>> 24) & 255; out[pos + 1] = (n >>> 16) & 255; out[pos + 2] = (n >>> 8) & 255; out[pos + 3] = n & 255; };
  const uni = s => { u32(s.length); for (let i = 0; i < s.length; i++) u16(s.charCodeAt(i)); };
  const id = s => { u32(s.length); for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
  const block = (tag, payload) => {
    for (const ch of '8BIM' + tag) out.push(ch.charCodeAt(0));
    const sizePos = out.length; u32(0);
    const start = out.length; payload();
    patch32(sizePos, out.length - start);
    while (out.length % 4) out.push(0);
  };
  const f64 = n => { const t = new Uint8Array(8); new DataView(t.buffer).setFloat64(0, n); for (const b of t) out.push(b); };
  const num = (key, unit, value) => { id(key); for (const ch of 'UntF') out.push(ch.charCodeAt(0)); for (const ch of unit) out.push(ch.charCodeAt(0)); f64(value); };
  u16(6); u16(2);
  block('desc', () => {
    u32(1);
    uni('brushPreset'); id('brushPreset'); u32(1);
    id('Nm  '); for (const ch of 'TEXT') out.push(ch.charCodeAt(0)); uni(name);
  });
  block('cbsh', () => {
    u32(16);
    uni('computedBrush'); id('computedBrush'); u32(1);
    num('Dmtr', '#Pxl', 64);
  });
  block('samp', () => {
    u16(1); u16(1);
    u32(entry.length);
    for (const b of entry) out.push(b);
    while (out.length % 4) out.push(0);
  });
  return Buffer.from(out);
}

const cases = {
  'legacy-8bit-raw.abr': legacyAbr('Legacy 8bit', [tipEntry(24)]),
  'legacy-8bit-rle.abr': legacyAbr('Legacy RLE', [tipEntry(24, { rle: true })]),
  'legacy-16bit-raw.abr': legacyAbr('Legacy 16bit', [tipEntry(24, { depth: 16 })]),
  'v6-16bit-rle.abr': v6Abr('V6 16bit RLE', tipEntry(24, { depth: 16, rle: true })),
};

(async () => {
  for (const [name, buf] of Object.entries(cases)) {
    fs.writeFileSync(path.join(os.tmpdir(), 'tailref-' + name), buf);
    console.log(name, buf.length, 'bayt');
  }
  const app = await start({ port: 9515, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-abr-legacy-' });
  try {
    for (const [name, buf] of Object.entries(cases)) {
      const b64 = buf.toString('base64');
      const res = await app.json(`(async () => {
        const raw = atob(${JSON.stringify(b64)});
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        const parsed = inkParseAbr(arr);
        const input = document.getElementById('inkAbrInput');
        const before = inkState().brushes.length;
        const dt = new DataTransfer();
        dt.items.add(new File([arr], ${JSON.stringify(name)}, { type: 'application/octet-stream' }));
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
          file: ${JSON.stringify(name)},
          parsed: parsed.map(t => ({ kind: t.kind, name: t.name || '', w: t.width, h: t.height, data: !!t.dataUrl })),
          added: added.length,
          category: b && b.category,
          tip: !!(b && b.tipId && inkRuntime.importedTips.has(b.tipId)),
          img: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
          error: inkRuntime.lastAbrError || '',
          notice: (window.__qaNotices || []).slice(-1),
        });
      })()`);
      console.log(JSON.stringify(res));
    }
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
