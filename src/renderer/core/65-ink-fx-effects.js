/* TailRef app · ink fx efekt seti · Faz 2 (master spec Bölüm 1)
   ------------------------------------------------------------------------
   Çekirdek motor: 64-ink-fx.js (inkFxRegister + zincir). Bu dosya yalnızca
   efekt tanımlarını kaydeder. Tüm efektler DETERMİNİSTİKTİR: rastgelelik
   yalnız zincirin verdiği inkFxRng(fx.seed) üzerinden; aynı girdi + aynı
   parametre + aynı seed → aynı pikseller (master spec Bölüm 11 ✓).

   Ortak sözleşme: apply(outCtx, src, P, size, rng) — src GİRDİDİR,
   outCtx ŞEFFAF tuvaldir ve efekt TAM çıktısını basar.
   Not: spec'teki "Random Seed" parametreleri efekt kaydındaki fx.seed
   ile karşılanır (çift parametre olmasın diye şemaya konulmadı).
   ========================================================= */
'use strict';

/* =========================================================
   ortak yardımcılar
   ========================================================= */

/** src'nin ImageData'sı (efekt içinde tek okuma). */
function inkFxSrcData(src, w, h) {
  if (!src || !w || !h) return null;
  const ctx = src.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
  if (!ctx) return null;
  try { return ctx.getImageData(0, 0, w, h); } catch { return null; }
}

/** Alfa-ağırlıklı luminance haritası (0=siyah..1=kâğıt; şeffaf=beyaz). */
function inkFxLumOf(img) {
  const { width: w, height: h, data } = img;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const a = data[p + 3] / 255;
    lum[i] = a * (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255 + (1 - a);
  }
  return lum;
}

/** Koordinatları kelepçeli doku örneği. */
function inkFxSample(data, w, h, x, y) {
  const xi = Math.min(w - 1, Math.max(0, x | 0));
  const yi = Math.min(h - 1, Math.max(0, y | 0));
  return (yi * w + xi) * 4;
}

/** Kaba (hücreli) deterministik gürültü alanı — lekeli/organik doku için. */
function inkFxCoarseNoise(w, h, cell, rng) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return { gw, gh, cell, g, at(x, y) {
    const gx = Math.min(this.gw - 1, Math.max(0, Math.floor(x / this.cell)));
    const gy = Math.min(this.gh - 1, Math.max(0, Math.floor(y / this.cell)));
    return this.g[gy * this.gw + gx];
  } };
}

/** RGBA Uint8 dizisini kanvasa yazar. Normalde `createImageData` + `.set`
 *  tam kare kopya yapıyordu (4K'da ~33 MB / efekt). Tampon doğrudan
 *  `ImageData` ile sarılınca kopya ortadan kalkar (putImageData zaten
 *  kanvasa kopyalar). */
function inkFxPutImageData(ctx, img) {
  if (img && img.data instanceof Uint8ClampedArray
    && img.data.length === img.width * img.height * 4) {
    try {
      ctx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
      return;
    } catch { /* ImageData kurulamazsa aşağıdaki güvenli yol */ }
  }
  const out = ctx.createImageData(img.width, img.height);
  out.data.set(img.data);
  ctx.putImageData(out, 0, 0);
}

/* ---------- efekt scratch tampon havuzu ----------
   Su lekesi/mürekkep yayılması 4K karede çağrı başına ~300 MB typed array
   ayırıyordu (ölçüm: heap +127 MB, sürekli GC). Havuz tamponları (w,h)
   kuşağına bağlar: boyut değişince tümü bırakılır (bellek geri verilir).
   `inkFxScratch` YENİ DİZİ sözleşmesini korur: dönen tampon her zaman
   sıfır doludur — efektler bunu varsayar, parite bozulmaz. */
const INK_FX_SCRATCH = { key: '', map: new Map(), bytes: 0, tick: 0 };
/* Ağır zincirlerde (su lekesi + mürekkep yayılması + CMYK) 4K çalışma
   kümesi ~660 MB'a çıkabilir; tüm havuzu silmek her karede yeniden
   ayırmaya yol açar. Bu yüzden tam sıfırlama yerine en eski (LRU)
   tamponlar tek tek bırakılır. */
const INK_FX_SCRATCH_MAX_BYTES = 768 * 1024 * 1024;

function inkFxScratchEvict(need) {
  while (INK_FX_SCRATCH.bytes + need > INK_FX_SCRATCH_MAX_BYTES
    && INK_FX_SCRATCH.map.size) {
    let oldest = null, oldestTick = Infinity;
    for (const [k, rec] of INK_FX_SCRATCH.map) {
      if (rec.tick < oldestTick) { oldestTick = rec.tick; oldest = k; }
    }
    if (oldest === null) break;
    INK_FX_SCRATCH.bytes -= INK_FX_SCRATCH.map.get(oldest).buf.byteLength;
    INK_FX_SCRATCH.map.delete(oldest);
  }
}

function inkFxScratch(w, h, slot, len, Type) {
  const T = Type || Uint8ClampedArray;
  const key = w + 'x' + h;
  if (INK_FX_SCRATCH.key !== key) {
    INK_FX_SCRATCH.key = key;
    INK_FX_SCRATCH.map.clear();
    INK_FX_SCRATCH.bytes = 0;
  }
  let rec = INK_FX_SCRATCH.map.get(slot);
  const need = len * T.BYTES_PER_ELEMENT;
  if (!rec || !(rec.buf instanceof T) || rec.buf.length !== len) {
    inkFxScratchEvict(need);
    const buf = new T(len);
    rec = { buf, tick: 0 };
    INK_FX_SCRATCH.map.set(slot, rec);
    INK_FX_SCRATCH.bytes += need;
  } else {
    /* Yeni dizi sözleşmesi: içerik her zaman sıfırdan başlar. */
    rec.buf.fill(0);
  }
  rec.tick = ++INK_FX_SCRATCH.tick;
  return rec.buf;
}

/** Yeni şeffaf kanvas + ctx. */
function inkFxCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { colorSpace: 'srgb' });
  return { canvas: c, ctx };
}

/** Deterministik gri gürültü karosu (createPattern dokusu için).
 *  map: rng() → 0..1 yoğunluk (ör. 0.8+r*0.4 ≈ ortalama 1.0 gri). */
function inkFxNoiseTile(size, rng, map) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { colorSpace: 'srgb' });
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const v = Math.min(255, Math.max(0, Math.round(map(rng()) * 255)));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* =========================================================
   2. RISOGRAPH (master spec Bölüm 1.2)
   ---------------------------------------------------------
   Gerçek riso benzetimi: kaynak, mürekkep renklerine göre renk
   ayrıştırılır (hue yakınlık maskesi); her mürekkep katmanı kendi
   tescil (registration) sapmasıyla beyaz kâğıda MULTIPLY basılır —
   çakışan mürekkepler gerçek overprint gibi karışır.
   ========================================================= */

const INK_RISO_INKS = ['#ff48b0', '#0078bf', '#ffe800', '#00a95c']; /* klasik riso mürekkepleri */

inkFxRegister({
  id: 'risograph',
  label: 'Risograph',
  category: 'printmaking',
  params: [
    { key: 'inkCount', label: 'Number of Ink Layers', type: 'slider', min: 1, max: 4, step: 1, default: 2 },
    { key: 'ink1Color', label: 'Ink 1 Color', type: 'color', default: INK_RISO_INKS[0] },
    { key: 'ink2Color', label: 'Ink 2 Color', type: 'color', default: INK_RISO_INKS[1] },
    { key: 'ink3Color', label: 'Ink 3 Color', type: 'color', default: INK_RISO_INKS[2],
      when: { key: 'inkCount', gte: 3 } },
    { key: 'ink4Color', label: 'Ink 4 Color', type: 'color', default: INK_RISO_INKS[3],
      when: { key: 'inkCount', gte: 4 } },
    { key: 'inkDensity', label: 'Ink Density', type: 'slider', min: 0.2, max: 1.4, step: 0.05, default: 1 },
    { key: 'inkOpacity', label: 'Ink Opacity', type: 'slider', min: 0.2, max: 1, step: 0.05, default: 0.9 },
    { key: 'inkSaturation', label: 'Ink Saturation', type: 'slider', min: 0.3, max: 2, step: 0.05, default: 1.15 },
    { key: 'inkAbsorption', label: 'Ink Absorption', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'regOffsetX', label: 'Registration Offset X', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'regOffsetY', label: 'Registration Offset Y', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'channelOffset', label: 'Independent Channel Offset', type: 'slider', min: -20, max: 20, step: 1, default: 0 },
    { key: 'regIrregularity', label: 'Registration Irregularity', type: 'slider', min: 0, max: 12, step: 0.5, default: 2.5 },
    { key: 'paperGrain', label: 'Paper Grain', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'inkGrain', label: 'Ink Grain', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'printImperfections', label: 'Print Imperfections', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'inkBleeding', label: 'Ink Bleeding', type: 'slider', min: 0, max: 6, step: 0.5, default: 1.5 },
    { key: 'textureIntensity', label: 'Texture Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 1 },
    { key: 'colorSeparation', label: 'Color Separation', type: 'slider', min: 0.25, max: 1.5, step: 0.05, default: 0.85 },
    { key: 'colorMixing', label: 'Color Mixing', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'colorOverlap', label: 'Color Overlap', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'contrast', label: 'Contrast', type: 'slider', min: 0.5, max: 2, step: 0.05, default: 1.05 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const n = w * h;
    const count = Math.round(P.inkCount);
    const inks = [];
    for (let k = 0; k < count; k++) inks.push(P['ink' + (k + 1) + 'Color']);

    /* maskeler: her mürekkep için renk yakınlık ağırlığı (0..1) */
    const masks = inks.map(() => new Float32Array(n));
    const inkRgb = inks.map(hex => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex);
      const v = m ? parseInt(m[1], 16) : 0;
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    });
    const sep = Math.max(0.05, P.colorSeparation);
    const mixW = 1.25 - P.colorMixing * 0.5;
    const overlapCnt = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const a = data[p + 3] / 255;
      if (a < 0.02) continue;
      const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;
      let hits = 0;
      for (let k = 0; k < inks.length; k++) {
        const ik = inkRgb[k];
        const dr = r * 255 - ik[0], dg = g * 255 - ik[1], db = b * 255 - ik[2];
        const d = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67;
        const t = Math.min(1, Math.max(0, 1 - d / sep)) * mixW;
        if (t > 0.03) { masks[k][i] = Math.min(1, t); hits++; }
      }
      overlapCnt[i] = hits;
    }
    /* çakışmada mürekkep incelmesi (gerçek overprint davranışı) */
    if (P.colorOverlap > 0.01) {
      for (let k = 0; k < masks.length; k++) {
        const m = masks[k];
        for (let i = 0; i < n; i++) {
          const extra = overlapCnt[i] - 1;
          if (extra > 0) m[i] *= 1 - P.colorOverlap * 0.22 * extra;
        }
      }
    }

    const { canvas: tmp, ctx: tctx } = inkFxCanvas(w, h);
    /* beyaz kâğıt */
    tctx.fillStyle = '#fdfbf7';
    tctx.fillRect(0, 0, w, h);

    /* her mürekkep katmanı: maske → kanvas → offset ile MULTIPLY */
    const pxOffsets = [];
    for (let k = 0; k < inks.length; k++) {
      const jx = (rng() - 0.5) * 2 * P.regIrregularity;
      const jy = (rng() - 0.5) * 2 * P.regIrregularity;
      const spread = (k - (inks.length - 1) / 2) * P.channelOffset;
      pxOffsets.push({
        x: P.regOffsetX + jx + spread,
        y: P.regOffsetY + jy - spread * 0.4,
      });
    }
    for (let k = 0; k < inks.length; k++) {
      const ik = inkRgb[k];
      const { canvas: mcv, ctx: mctx } = inkFxCanvas(w, h);
      const mimg = mctx.createImageData(w, h);
      const md = mimg.data;
      const abs = 1 - P.inkAbsorption * 0.35;
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        md[p] = ik[0]; md[p + 1] = ik[1]; md[p + 2] = ik[2];
        md[p + 3] = Math.round(Math.min(1, masks[k][i] * P.inkDensity * P.inkOpacity * abs) * 255);
      }
      inkFxPutImageData(mctx, mimg);
      const bleed = P.inkBleeding > 0.05 ? P.inkBleeding : 0;
      tctx.save();
      if (bleed) tctx.filter = 'blur(' + bleed + 'px)';
      tctx.globalCompositeOperation = 'multiply';
      tctx.drawImage(mcv, pxOffsets[k].x, pxOffsets[k].y);
      tctx.restore();
    }

    /* doku: mürekkep tanesi + kâğıt tanesi + baskı kusurları */
    const texI = P.textureIntensity;
    if (texI > 0.01 && P.inkGrain > 0.01) {
      const nz = inkFxNoiseTile(192, rng, r => 0.8 + r * 0.4);
      tctx.save();
      tctx.globalAlpha = texI * P.inkGrain * 0.4;
      tctx.globalCompositeOperation = 'multiply';
      tctx.fillStyle = tctx.createPattern(nz, 'repeat');
      tctx.fillRect(0, 0, w, h);
      tctx.restore();
    }
    if (texI > 0.01 && P.paperGrain > 0.01) {
      const nz = inkFxNoiseTile(256, rng, r => 0.72 + r * 0.56);
      tctx.save();
      tctx.globalAlpha = texI * P.paperGrain * 0.45;
      tctx.globalCompositeOperation = 'overlay';
      tctx.fillStyle = tctx.createPattern(nz, 'repeat');
      tctx.fillRect(0, 0, w, h);
      tctx.restore();
    }
    if (texI > 0.01 && P.printImperfections > 0.01) {
      const bands = Math.round(2 + P.printImperfections * 6);
      tctx.save();
      for (let i = 0; i < bands; i++) {
        const y = rng() * h;
        const bh = 2 + rng() * 10 * P.printImperfections;
        tctx.globalAlpha = 0.05 + rng() * 0.07 * P.printImperfections * texI;
        tctx.globalCompositeOperation = 'screen';
        tctx.fillStyle = '#ffffff';
        tctx.fillRect(0, y, w, bh);
      }
      tctx.restore();
    }

    /* renk son işlemi: kontrast + doygunluk (ctx.filter — GPU destekli) */
    outCtx.save();
    outCtx.filter = 'contrast(' + P.contrast.toFixed(2) + ') saturate('
      + P.inkSaturation.toFixed(2) + ')';
    outCtx.drawImage(tmp, 0, 0);
    outCtx.restore();
  },
});

/* =========================================================
   7. WATERCOLOR (master spec Bölüm 1.7)
   ---------------------------------------------------------
   Pigment yayılımı: premultiplied alfa+renk alanının çok geçişli
   kutu bulanıklığı (su yayılması), kenar koyulaşması (orijinal−yayılan
   alfa farkı halkası), granülasyon (kaba gürültüyle yoğunluk oynaması),
   göllenme (yayılan−orijinal farkı koyulaştırması).
   ========================================================= */

inkFxRegister({
  id: 'watercolor',
  label: 'Watercolor',
  category: 'traditional',
  params: [
    { key: 'pigmentDiffusion', label: 'Pigment Diffusion', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.45 },
    { key: 'pigmentDensity', label: 'Pigment Density', type: 'slider', min: 0.2, max: 1.4, step: 0.05, default: 1 },
    { key: 'pigmentGranulation', label: 'Pigment Granulation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'pigmentPooling', label: 'Pigment Pooling', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'pigmentVariation', label: 'Pigment Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'waterSpread', label: 'Water Spread', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'absorption', label: 'Absorption', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'edgeDiffusion', label: 'Edge Diffusion', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'wetness', label: 'Wetness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'bleeding', label: 'Bleeding', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'edgeDarkening', label: 'Edge Darkening', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.55 },
    { key: 'paperTexture', label: 'Paper Texture', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'paperAbsorption', label: 'Paper Absorption', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'colorVariation', label: 'Color Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.25 },
    { key: 'transparency', label: 'Transparency', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'textureIntensity', label: 'Texture Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 1 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const n = w * h;
    const spreadR = Math.max(1, Math.round(P.waterSpread * 0.09 * Math.max(w, h) * 0.06) + 1);
    const passes = 1 + Math.round(P.pigmentDiffusion * 3 + P.wetness * 2 + P.edgeDiffusion * 2);

    /* premultiplied kopya (havuzdan: 4K'da ~33 MB) */
    const pr = inkFxScratch(w, h, 'wc.pr', n), pg = inkFxScratch(w, h, 'wc.pg', n),
      pb = inkFxScratch(w, h, 'wc.pb', n), pa = inkFxScratch(w, h, 'wc.pa', n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const a = data[p + 3] / 255;
      pr[i] = data[p] * a; pg[i] = data[p + 1] * a; pb[i] = data[p + 2] * a; pa[i] = data[p + 3];
    }
    /* DÖRT KANAL TEK TARAMADA: eskiden her kanal için ayrı H+V taraması
       yapılıyordu (4× döngü kurulumu, 4× indeks hesabı, 4× bellek yolu).
       Şimdi aynı indekslerle 4 kanal birlikte işlenir; her kanalın aritmetiği
       ve toplama sırası BİREBİR aynıdır (çıktı pikseli değişmez, sadece
       döngü/memory maliyeti düşer). Ara sonuç tmp'de RGBA interleaved. */
    const prB = inkFxScratch(w, h, 'wc.prB', n), pgB = inkFxScratch(w, h, 'wc.pgB', n),
      pbB = inkFxScratch(w, h, 'wc.pbB', n), paB = inkFxScratch(w, h, 'wc.paB', n);
    prB.set(pr); pgB.set(pg); pbB.set(pb); paB.set(pa);
    const tmp = inkFxScratch(w, h, 'wc.tmp', n * 4);
    const div = spreadR * 2 + 1;
    const blurPass = () => {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let ar = 0, ag = 0, ab = 0, aa = 0;
        for (let k = -spreadR; k <= spreadR; k++) {
          const idx = row + Math.min(w - 1, Math.max(0, k));
          ar += prB[idx]; ag += pgB[idx]; ab += pbB[idx]; aa += paB[idx];
        }
        for (let x = 0; x < w; x++) {
          const p = (row + x) << 2;
          tmp[p] = ar / div; tmp[p + 1] = ag / div;
          tmp[p + 2] = ab / div; tmp[p + 3] = aa / div;
          const ai = row + Math.min(w - 1, x + spreadR + 1);
          const si = row + Math.max(0, x - spreadR);
          ar += prB[ai] - prB[si]; ag += pgB[ai] - pgB[si];
          ab += pbB[ai] - pbB[si]; aa += paB[ai] - paB[si];
        }
      }
      for (let x = 0; x < w; x++) {
        let ar = 0, ag = 0, ab = 0, aa = 0;
        for (let k = -spreadR; k <= spreadR; k++) {
          const p = (Math.min(h - 1, Math.max(0, k)) * w + x) << 2;
          ar += tmp[p]; ag += tmp[p + 1]; ab += tmp[p + 2]; aa += tmp[p + 3];
        }
        for (let y = 0; y < h; y++) {
          const idx = y * w + x;
          prB[idx] = ar / div; pgB[idx] = ag / div;
          pbB[idx] = ab / div; paB[idx] = aa / div;
          const ap = (Math.min(h - 1, y + spreadR + 1) * w + x) << 2;
          const sp = (Math.max(0, y - spreadR) * w + x) << 2;
          ar += tmp[ap] - tmp[sp]; ag += tmp[ap + 1] - tmp[sp + 1];
          ab += tmp[ap + 2] - tmp[sp + 2]; aa += tmp[ap + 3] - tmp[sp + 3];
        }
      }
    };
    for (let pass = 0; pass < passes; pass++) blurPass();
    if (P.bleeding > 0.05) { /* ek kenar yayılması: yalnız alfa, 2 tur */
      const spreadR2 = Math.max(2, Math.round(P.bleeding * 5));
      const div2 = spreadR2 * 2 + 1;
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < h; y++) {
          const row = y * w;
          let acc = 0;
          for (let k = -spreadR2; k <= spreadR2; k++) acc += paB[row + Math.min(w - 1, Math.max(0, k))];
          for (let x = 0; x < w; x++) {
            tmp[(row + x) << 2] = acc / div2;
            acc += paB[row + Math.min(w - 1, x + spreadR2 + 1)] - paB[row + Math.max(0, x - spreadR2)];
          }
        }
        for (let x = 0; x < w; x++) {
          let acc = 0;
          for (let k = -spreadR2; k <= spreadR2; k++) {
            acc += tmp[((Math.min(h - 1, Math.max(0, k)) * w + x) << 2)];
          }
          for (let y = 0; y < h; y++) {
            paB[y * w + x] = acc / div2;
            acc += tmp[((Math.min(h - 1, y + spreadR2 + 1) * w + x) << 2)]
              - tmp[((Math.max(0, y - spreadR2) * w + x) << 2)];
          }
        }
      }
    }

    const noise = inkFxCoarseNoise(w, h, 9, rng);
    const out = inkFxScratch(w, h, 'wc.out', n * 4);
    const granN = inkFxCoarseNoise(w, h, 5, rng);
    /* noise.at(x,y) piksel başına floor+clamp yapıyordu; indeks tabloları
       aynı değeri üretir (tek sefer hesaplanır). */
    const noiseX = new Int32Array(w), granX = new Int32Array(w);
    const noiseY = new Int32Array(h), granY = new Int32Array(h);
    for (let x = 0; x < w; x++) {
      noiseX[x] = Math.min(noise.gw - 1, Math.max(0, Math.floor(x / noise.cell)));
      granX[x] = Math.min(granN.gw - 1, Math.max(0, Math.floor(x / granN.cell)));
    }
    for (let y = 0; y < h; y++) {
      noiseY[y] = Math.min(noise.gh - 1, Math.max(0, Math.floor(y / noise.cell))) * noise.gw;
      granY[y] = Math.min(granN.gh - 1, Math.max(0, Math.floor(y / granN.cell))) * granN.gw;
    }
    for (let y = 0, i = 0, p = 0; y < h; y++) {
      const nRow = noiseY[y], gRow = granY[y];
      for (let x = 0; x < w; x++, i++, p += 4) {
        const a0 = pa[i] / 255, aB = paB[i] / 255;
        let a = Math.max(a0, aB);
        /* kâğıt emilimi: zayıf alanları yut (absorption + paperAbsorption) */
        a *= 1 - (P.absorption * 0.6 + P.paperAbsorption) * (1 - a) * 0.7;
        if (a < 0.015) { out[p + 3] = 0; continue; }
        /* kenar koyulaşması: yayılma kenarında (a0 > aB) koyu halka */
        const ring = a0 > aB ? Math.min(1, (a0 - aB) / Math.max(0.15, a0)) : 0;
        /* göllenme: yayılma merkezi (aB > a0) koyulaştırır */
        const pool = aB > a0 ? Math.min(1, (aB - a0) / Math.max(0.2, aB)) : 0;
        const darken = 1 - P.edgeDarkening * ring * 0.55 - P.pigmentPooling * pool * 0.35;
        /* granülasyon */
        const gran = 1 - P.pigmentGranulation * granN.g[gRow + granX[x]] * (1 - a) * 0.6;
        /* pigment renk */
        const shade = darken * gran;
        let r = prB[i] / Math.max(1, paB[i]) * 255, g = pgB[i] / Math.max(1, paB[i]) * 255,
          b = pbB[i] / Math.max(1, paB[i]) * 255;
        /* renk oynaması: kaba gürültüyle kanal kayması */
        const nz = (noise.g[nRow + noiseX[x]] - 0.5) * P.colorVariation * 46;
        r = Math.min(255, Math.max(0, r + nz));
        g = Math.min(255, Math.max(0, g + nz * 0.6));
        b = Math.min(255, Math.max(0, b - nz * 0.4));
        const alphaOut = Math.min(1, a * P.pigmentDensity * (1 - P.transparency * 0.65)
          * (1 - P.pigmentVariation * 0.3 * granN.g[gRow + granX[x]]));
        out[p] = r * shade; out[p + 1] = g * shade; out[p + 2] = b * shade;
        out[p + 3] = alphaOut * 255;
      }
    }
    const { canvas: paperCanvas, ctx: paperCtx } = inkFxCanvas(w, h);
    paperCtx.fillStyle = '#fdfcf8'; /* kâğıt */
    paperCtx.fillRect(0, 0, w, h);
    inkFxPutImageData(paperCtx, { width: w, height: h, data: out });
    if (P.textureIntensity > 0.01 && P.paperTexture > 0.01) {
      const nz = inkFxNoiseTile(256, rng, r => 0.78 + r * 0.5);
      paperCtx.save();
      paperCtx.globalAlpha = P.textureIntensity * P.paperTexture * 0.5;
      paperCtx.globalCompositeOperation = 'overlay';
      paperCtx.fillStyle = paperCtx.createPattern(nz, 'repeat');
      paperCtx.fillRect(0, 0, w, h);
      paperCtx.restore();
    }
    outCtx.drawImage(paperCanvas, 0, 0);
  },
});

/* =========================================================
   9. COLORED PENCIL (master spec Bölüm 1.9)
   ---------------------------------------------------------
   Ton bantları → paralel kalem vuruşları: döner ızgara satırlarında
   yürüyen kesik çizgiler; kâğıt dişisi çizgi kırar, kalem tanesi
   alfa oynatır, baskı değişkenliği vuruş genişliğini taşıır.
   ========================================================= */

inkFxRegister({
  id: 'colored-pencil',
  label: 'Colored Pencil',
  category: 'traditional',
  params: [
    { key: 'pencilGrain', label: 'Pencil Grain Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'paperTooth', label: 'Paper Tooth', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'strokeDensity', label: 'Stroke Density', type: 'slider', min: 1, max: 6, step: 1, default: 3 },
    { key: 'strokeDirection', label: 'Stroke Direction', type: 'angle', min: 0, max: 360, step: 1, default: 45 },
    { key: 'strokeLength', label: 'Stroke Length', type: 'slider', min: 6, max: 90, step: 2, default: 26 },
    { key: 'pressureVariation', label: 'Pressure Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'pigmentCoverage', label: 'Pigment Coverage', type: 'slider', min: 0.1, max: 1, step: 0.05, default: 0.7 },
    { key: 'colorVariation', label: 'Color Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.25 },
    { key: 'pencilHardness', label: 'Pencil Hardness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'textureScale', label: 'Texture Scale', type: 'slider', min: 0.5, max: 3, step: 0.1, default: 1 },
    { key: 'strokeIrregularity', label: 'Stroke Irregularity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'layeredPigment', label: 'Layered Pigment Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const lum = inkFxLumOf(img);
    const bands = Math.round(P.strokeDensity);
    const spacing = Math.max(3, (3 + P.textureScale * 7) | 0);
    const ang = (P.strokeDirection % 360) * Math.PI / 180;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const cx = w / 2, cy = h / 2;
    const span = Math.ceil(Math.sqrt(w * w + h * h) / 2) + spacing;
    const rows = Math.ceil(span * 2 / spacing);

    const octx = outCtx;
    octx.save();
    octx.translate(cx, cy);
    octx.rotate(-ang);
    octx.lineCap = 'round';
    for (let k = 0; k < bands; k++) {
      const Tk = 1 - (k + 1) / (bands + 1);
      /* katmanlı pigment: derin bantlar daha soluk basılır */
      const deep = layeredAlpha(k, bands, P.layeredPigment);
      for (let ri = 0; ri < rows; ri++) {
          const rowJit = (rng() - 0.5) * spacing * P.strokeIrregularity;
          const gy = -span + ri * spacing + rowJit;
          let s = -span + rng() * P.strokeLength * P.strokeIrregularity;
          while (s < span) {
            const len = P.strokeLength * (0.7 + rng() * 0.6);
            /* çizgi örnekle: orta noktada ton kontrolü */
            const midU = s + len / 2;
            const sx = Math.round(cx + midU * cosA - gy * sinA);
            const sy = Math.round(cy + midU * sinA + gy * cosA);
            const si = Math.min(lum.length - 1, Math.max(0, sy * w + sx));
            const l = lum[si];
            if (l >= Tk || rng() < P.paperTooth * 0.35) { s += len + rng() * spacing * 0.4; continue; }
            const p4 = inkFxSample(data, w, h, sx, sy);
            const jitter = (rng() - 0.5) * P.colorVariation * 60;
            const pressure = 1 - P.pressureVariation * rng();
            const width = Math.max(1, spacing * 0.32) * (0.6 + 0.5 * P.pencilHardness) * pressure;
            octx.save();
            octx.translate(s, gy);
            octx.rotate((rng() - 0.5) * 0.12 * P.strokeIrregularity);
            octx.strokeStyle = 'rgba('
              + Math.min(255, Math.max(0, data[p4] + jitter)) + ','
              + Math.min(255, Math.max(0, data[p4 + 1] + jitter * 0.7)) + ','
              + Math.min(255, Math.max(0, data[p4 + 2] + jitter * 0.5)) + ','
              + Math.min(1, P.pigmentCoverage * pressure * deep
                * (1 - P.pencilGrain * 0.5 * rng())) + ')';
            octx.lineWidth = width;
            octx.beginPath();
            octx.moveTo(0, 0);
            octx.lineTo(len, 0);
            octx.stroke();
            if (P.pencilHardness < 0.5) { /* yumuşak kalem: ikinci soluk geçiş */
              octx.globalAlpha = 0.35;
              octx.lineWidth = width * 1.7;
              octx.beginPath();
              octx.moveTo(-len * 0.1, width * 0.8);
              octx.lineTo(len * 1.1, width * 0.8);
              octx.stroke();
            }
            octx.restore();
            s += len + spacing * (0.35 + rng() * 0.5);
          }
        }
      }
      octx.restore();

    function layeredAlpha(k, bands, amount) {
      return k === 0 ? 1 : 1 - amount * 0.45 * (k / Math.max(1, bands - 1));
    }
  },
});

/* =========================================================
   11. CROSSHATCHING (master spec Bölüm 1.11)
   ---------------------------------------------------------
   Ton → yön sayısı: koyu bölge 4 yönün hepsini, açık bölge yalnız
   birincil yönü alır; çizgi alfa karanlıkla artar, kenarda kesilir.
   ========================================================= */

inkFxRegister({
  id: 'crosshatching',
  label: 'Crosshatching',
  category: 'traditional',
  params: [
    { key: 'primaryAngle', label: 'Primary Angle', type: 'angle', min: 0, max: 360, step: 1, default: 0 },
    { key: 'secondaryAngle', label: 'Secondary Angle', type: 'angle', min: 0, max: 360, step: 1, default: 90 },
    { key: 'thirdAngle', label: 'Third Angle', type: 'angle', min: 0, max: 360, step: 1, default: 45 },
    { key: 'fourthAngle', label: 'Fourth Angle', type: 'angle', min: 0, max: 360, step: 1, default: 135 },
    { key: 'lineThickness', label: 'Line Thickness', type: 'slider', min: 0.5, max: 8, step: 0.25, default: 1.4 },
    { key: 'lineSpacing', label: 'Line Spacing', type: 'slider', min: 4, max: 64, step: 1, default: 14 },
    { key: 'hatchDensity', label: 'Hatch Density', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'directionalVariation', label: 'Directional Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'toneSensitivity', label: 'Tone Sensitivity', type: 'slider', min: 0.5, max: 2.5, step: 0.05, default: 1 },
    { key: 'lineColor', label: 'Line Color', type: 'color', default: '#1a1a1a' },
    { key: 'bgColor', label: 'Background Color', type: 'color', default: 'none' },
    { key: 'edgePreservation', label: 'Edge Preservation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const lum = inkFxLumOf(img);
    if (P.bgColor && P.bgColor !== 'none') {
      outCtx.save(); outCtx.globalAlpha = 1;
      outCtx.fillStyle = P.bgColor; outCtx.fillRect(0, 0, w, h);
      outCtx.restore();
    }
    const angles = [P.primaryAngle, P.secondaryAngle, P.thirdAngle, P.fourthAngle];
    const span = Math.ceil(Math.sqrt(w * w + h * h) / 2) + P.lineSpacing;
    const spacing = Math.max(3, P.lineSpacing);
    const rows = Math.ceil(span * 2 / spacing);
    outCtx.save();
    outCtx.lineCap = 'round';
    outCtx.strokeStyle = P.lineColor;
    for (let k = 0; k < 4; k++) {
      const Tk = Math.min(1, Math.max(0, 1 - (k + 1) / 5 * (1.25 - P.hatchDensity)));
      const ang = (angles[k] % 360) * Math.PI / 180;
      const cosA = Math.cos(ang), sinA = Math.sin(ang);
      outCtx.save();
      outCtx.translate(w / 2, h / 2);
      outCtx.rotate(-ang);
      for (let ri = 0; ri < rows; ri++) {
        const gy = -span + ri * spacing + (rng() - 0.5) * spacing * P.directionalVariation;
        let s = -span;
        let runStart = null;
        const step = 2;
        for (; s <= span; s += step) {
          const sx = Math.round(w / 2 + s * cosA - gy * sinA);
          const sy = Math.round(h / 2 + s * sinA + gy * cosA);
          const si = Math.min(lum.length - 1, Math.max(0, sy * w + sx));
          const l = lum[si];
          const inHatch = l < Tk;
          if (inHatch && runStart === null) runStart = s;
          if ((!inHatch || s + step > span) && runStart !== null) {
            /* kenar koruma: geçişte segmenti kısalt */
            let end = s;
            if (P.edgePreservation > 0.01 && !inHatch) {
              end = s - step * P.edgePreservation * 0.8;
            }
            if (end - runStart > 1) {
              const alpha = Math.min(1, (Tk - l * 0.4) * P.toneSensitivity * 0.9 + 0.15);
              outCtx.globalAlpha = Math.max(0.08, alpha);
              outCtx.lineWidth = P.lineThickness * (0.7 + (1 - l) * 0.7);
              outCtx.beginPath();
              outCtx.moveTo(runStart, gy);
              outCtx.lineTo(end, gy);
              outCtx.stroke();
            }
            runStart = null;
          }
        }
      }
      outCtx.restore();
    }
    outCtx.restore();
  },
});

/* =========================================================
   14. DITHERING (master spec Bölüm 1.14)
   ---------------------------------------------------------
   Gerçek hata yayılımı çekirdekleri (FS/Atkinson/Jarvis/Stucki) ve
   8×8 Bayer düzenli dithering. Palet: mono / gameboy / cga / gri +
   numColors seviye nicemlemesi. Kaynak alfası korunur.
   ========================================================= */

const INK_DITHER_PALETTES = {
  mono: [[0, 0, 0], [255, 255, 255]],
  gameboy: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]],
  cga: [
    [0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170], [170, 0, 0], [170, 0, 170],
    [170, 85, 0], [170, 170, 170], [85, 85, 85], [85, 85, 255], [85, 255, 85],
    [85, 255, 255], [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255]],
  gray4: [[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]],
};
const INK_DITHER_KERNELS = {
  'floyd-steinberg': { div: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { div: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  'jarvis-judice-ninke': { div: 48, k: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
  stucki: { div: 42, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
};
const INK_DITHER_BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]];

inkFxRegister({
  id: 'dithering',
  label: 'Dithering',
  category: 'experimental',
  params: [
    { key: 'algorithm', label: 'Dithering Algorithm', type: 'dropdown', default: 'floyd-steinberg',
      options: ['bayer', 'floyd-steinberg', 'atkinson', 'jarvis-judice-ninke', 'stucki'] },
    { key: 'cellSize', label: 'Pixel / Cell Size', type: 'slider', min: 1, max: 16, step: 1, default: 2 },
    { key: 'palette', label: 'Color Palette', type: 'dropdown', default: 'mono',
      options: ['mono', 'gameboy', 'cga', 'gray4', 'levels'] },
    { key: 'numColors', label: 'Number of Colors', type: 'slider', min: 2, max: 32, step: 1, default: 4,
      when: { key: 'palette', is: 'levels' } },
    { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5,
      when: { all: [{ key: 'palette', in: ['mono', 'levels'] }, { key: 'colorMode', is: 'mono' }] } },
    { key: 'contrast', label: 'Contrast', type: 'slider', min: 0.4, max: 2.4, step: 0.05, default: 1.1 },
    { key: 'brightness', label: 'Brightness', type: 'slider', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { key: 'ditherIntensity', label: 'Dither Intensity', type: 'slider', min: 0, max: 1.5, step: 0.05, default: 1 },
    { key: 'patternScale', label: 'Pattern Scale', type: 'slider', min: 0.2, max: 3, step: 0.1, default: 1,
      when: { key: 'algorithm', in: ['bayer'] } },
    { key: 'colorMode', label: 'Monochrome / Color Mode', type: 'dropdown', default: 'mono',
      options: ['mono', 'color'], when: { key: 'palette', in: ['mono', 'levels'] } },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const cell = Math.max(1, Math.round(P.cellSize));
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    /* hücre-ortalama girdi: [r,g,b,a] float */
    const grid = new Float32Array(gw * gh * 4);
    const cnt = new Float32Array(gw * gh);
    for (let y = 0; y < h; y++) {
      const gy = (y / cell) | 0;
      for (let x = 0; x < w; x++) {
        const gx = (x / cell) | 0;
        const gi = (gy * gw + gx) * 4, p = (y * w + x) * 4;
        grid[gi] += data[p]; grid[gi + 1] += data[p + 1];
        grid[gi + 2] += data[p + 2]; grid[gi + 3] += data[p + 3];
        cnt[gy * gw + gx]++;
      }
    }
    for (let i = 0; i < gw * gh; i++) {
      const c = Math.max(1, cnt[i]);
      grid[i * 4] /= c; grid[i * 4 + 1] /= c; grid[i * 4 + 2] /= c; grid[i * 4 + 3] /= c;
    }
    /* hata tamponları */
    const err = [new Float32Array(gw * gh), new Float32Array(gw * gh), new Float32Array(gw * gh)];
    const out = new Uint8ClampedArray(w * h * 4);
    const pal = P.palette === 'levels' ? null : (INK_DITHER_PALETTES[P.palette] || INK_DITHER_PALETTES.mono);
    const levels = Math.max(1, Math.round(P.numColors) - 1);
    /* Sabit paletler (gameboy/cga/gray4) kendi renklerini dayatır; mono/renk
       seçimi yalnız mono ve levels paletlerinde anlamlıdır. Aksi halde
       palette=gameboy seçimi colorMode=mono yüzünden sessizce yok sayılıyordu. */
    const mono = (P.palette === 'mono' || P.palette === 'levels') && P.colorMode === 'mono';
    const kern = INK_DITHER_KERNELS[P.algorithm];
    const isOrdered = P.algorithm === 'bayer';

    const nearest = (r, g, b) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < pal.length; i++) {
        const dr = r - pal[i][0], dg = g - pal[i][1], db = b - pal[i][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = i; }
      }
      return pal[best];
    };
    const quantize = (v, e) => {
      const q = Math.min(255, Math.max(0, Math.round((v + e) / 255 * levels) * (255 / levels)));
      return q;
    };

    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const gi = gy * gw + gx;
        const a = grid[gi * 4 + 3];
        if (a < 12) continue;
        /* kontrast/parlaklık uygulanmış değer */
        const ch = [];
        for (let c = 0; c < 3; c++) {
          let v = grid[gi * 4 + c] / 255;
          v = (v - 0.5) * P.contrast + 0.5 + P.brightness;
          ch[c] = Math.min(1, Math.max(0, v)) * 255;
        }
        let nr, ng, nb;
        if (isOrdered) {
          const bv = INK_DITHER_BAYER8[gy % 8][gx % 8] / 64 - 0.5;
          if (mono) {
            let l = (0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]) / 255;
            l = Math.min(1, Math.max(0, l + bv * P.patternScale * P.ditherIntensity));
            /* levels paletinde mono da nicemlenir → Number of Colors etkili */
            const white = P.palette === 'levels'
              ? quantize(l * 255, bv * P.patternScale * P.ditherIntensity * 255)
              : (l > P.threshold ? 255 : 0);
            nr = ng = nb = white;
          } else if (pal) {
            const cc = ch.map((v, ci) => Math.min(255, Math.max(0, v + bv * P.patternScale * P.ditherIntensity * 255)));
            const pk = nearest(cc[0], cc[1], cc[2]);
            nr = pk[0]; ng = pk[1]; nb = pk[2];
          } else {
            nr = quantize(ch[0], bv * P.patternScale * P.ditherIntensity * 255);
            ng = quantize(ch[1], bv * P.patternScale * P.ditherIntensity * 255);
            nb = quantize(ch[2], bv * P.patternScale * P.ditherIntensity * 255);
          }
        } else if (kern && P.ditherIntensity > 0.01) {
          if (mono) {
            let l = (0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]) + err[0][gi] * 255 * P.ditherIntensity;
            const target = P.palette === 'levels'
              ? quantize(l, 0)
              : (l / 255 > P.threshold ? 255 : 0);
            nr = ng = nb = target;
            const e = (l - target) / 255; /* yoğunluk okurken çarpılır (tek kez) */
            for (const [dx, dy, wt] of kern.k) {
              const nx = gx + dx, ny = gy + dy;
              if (nx < 0 || nx >= gw || ny >= gh) continue;
              err[0][ny * gw + nx] += e * wt / kern.div;
            }
          } else if (pal) {
            /* Renk modu: palet üyesi kanal bazında seçilir ve hata her
               kanalda ayrı yayılır (mono'ya düşüp rengi yok etmez). */
            const cand = [0, 1, 2].map(c => ch[c] + err[c][gi] * 255 * P.ditherIntensity);
            const pk = nearest(cand[0], cand[1], cand[2]);
            nr = pk[0]; ng = pk[1]; nb = pk[2];
            const q = [nr, ng, nb];
            for (let c = 0; c < 3; c++) {
              const e = (cand[c] - q[c]) / 255;
              for (const [dx, dy, wt] of kern.k) {
                const nx = gx + dx, ny = gy + dy;
                if (nx < 0 || nx >= gw || ny >= gh) continue;
                err[c][ny * gw + nx] += e * wt / kern.div;
              }
            }
          } else {
            const vals = [0, 1, 2].map(c => ch[c] + err[c][gi] * 255 * P.ditherIntensity);
            nr = quantize(vals[0], 0); ng = quantize(vals[1], 0); nb = quantize(vals[2], 0);
            for (let c = 0; c < 3; c++) {
              const vq = c === 0 ? nr : c === 1 ? ng : nb;
              const e = (vals[c] - vq) / 255; /* yoğunluk okurken çarpılır */
              for (const [dx, dy, wt] of kern.k) {
                const nx = gx + dx, ny = gy + dy;
                if (nx < 0 || nx >= gw || ny >= gh) continue;
                err[c][ny * gw + nx] += e * wt / kern.div;
              }
            }
          }
        } else {
          /* dither yok: yalnız nicemleme */
          if (mono) {
            const l = (0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]) / 255;
            const v = P.palette === 'levels'
              ? quantize(l * 255, 0)
              : (l > P.threshold ? 255 : 0);
            nr = ng = nb = v;
          } else if (pal) {
            const pk = nearest(ch[0], ch[1], ch[2]);
            nr = pk[0]; ng = pk[1]; nb = pk[2];
          } else {
            nr = quantize(ch[0], 0); ng = quantize(ch[1], 0); nb = quantize(ch[2], 0);
          }
        }
        /* hücre bloğunu boya (kaynak alfa korunur) */
        for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++) {
          for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
            const p = (y * w + x) * 4;
            out[p] = nr; out[p + 1] = ng; out[p + 2] = nb;
            out[p + 3] = data[p + 3];
          }
        }
      }
    }
    inkFxPutImageData(outCtx, { width: w, height: h, data: out });
  },
});

/* =========================================================
   16. CHROMATIC ABERRATION (master spec Bölüm 1.16)
   ---------------------------------------------------------
   R/G/B kanalları ayrı tuvallere ayrılır; her kanal kendi sabit
   ofseti + radyal alan ofsetiyle (edge falloff ile) basılır ve
   'lighter' ile geri birleştirilir. blendIntensity orijinalle karıştırır.
   ========================================================= */

inkFxRegister({
  id: 'chromatic-aberration',
  label: 'Chromatic Aberration',
  category: 'experimental',
  params: [
    { key: 'redOffsetX', label: 'Red Offset X', type: 'slider', min: -40, max: 40, step: 1, default: 6 },
    { key: 'redOffsetY', label: 'Red Offset Y', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'greenOffsetX', label: 'Green Offset X', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'greenOffsetY', label: 'Green Offset Y', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'blueOffsetX', label: 'Blue Offset X', type: 'slider', min: -40, max: 40, step: 1, default: -6 },
    { key: 'blueOffsetY', label: 'Blue Offset Y', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'separationDistance', label: 'Separation Distance', type: 'slider', min: 0, max: 60, step: 1, default: 10 },
    { key: 'radialIntensity', label: 'Radial Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'direction', label: 'Direction', type: 'angle', min: 0, max: 360, step: 1, default: 0 },
    { key: 'centerX', label: 'Center Position X', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'centerY', label: 'Center Position Y', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'edgeFalloff', label: 'Edge Falloff', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'blendIntensity', label: 'Blend Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 1 },
    { key: 'radius', label: 'Radius', type: 'slider', min: 0.1, max: 2, step: 0.05, default: 1 },
  ],
  apply(outCtx, src, P, size) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const cxp = P.centerX * w, cyp = P.centerY * h;
    const radiusPx = Math.max(16, P.radius * Math.max(w, h) * 0.5);
    const dirAng = (P.direction % 360) * Math.PI / 180;
    const dirX = Math.cos(dirAng), dirY = Math.sin(dirAng);
    const chanSign = [1, 0, -1];
    const chanBase = [[P.redOffsetX, P.redOffsetY], [P.greenOffsetX, P.greenOffsetY],
      [P.blueOffsetX, P.blueOffsetY]];
    const sep = P.separationDistance;
    const radial = sep * P.radialIntensity;
    const linear = sep * (1 - P.radialIntensity);
    const clampI = (v, lim) => Math.min(lim - 1, Math.max(0, Math.round(v)));
    /* blendIntensity karışımı: 1 = tam kaymış, 0 = orijinal */
    const mix = Math.min(1, Math.max(0, P.blendIntensity));

    const out = new Uint8ClampedArray(w * h * 4);
    const useDir = sep > 0.01; /* yönsel/radyal ayrım; sabit offsetler daima etkin */
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (mix < 0.999) {
          out[i] = data[i]; out[i + 1] = data[i + 1];
          out[i + 2] = data[i + 2]; out[i + 3] = data[i + 3];
        }
        if (mix < 0.001) continue;
        const dx = x - cxp, dy = y - cyp;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = Math.min(1, dist / radiusPx);
        /* kenar sönümü SÜREKLİ: 0 = yumuşak yayılım, 1 = merkeze yakın
           keskin ayrım (eski sürüm yalnız boolean kapıydı → değer işlevsizdi) */
        const fall = Math.pow(f, 0.5 + P.edgeFalloff * 2.5);
        const ux = dx / dist, uy = dy / dist;
        const ch = [0, 0, 0];
        let alpha = 0;
        for (let c = 0; c < 3; c++) {
          const sign = chanSign[c];
          const m = useDir ? (dirX * linear + ux * radial * fall) * sign : 0;
          const n = useDir ? (dirY * linear + uy * radial * fall) * sign : 0;
          /* kaynakta TERS yönde örnekle: kanal ofsele taşınır */
          const sx = clampI(x - chanBase[c][0] - m, w);
          const sy = clampI(y - chanBase[c][1] - n, h);
          const sp = (sy * w + sx) * 4;
          ch[c] = data[sp + c];
          alpha = Math.max(alpha, data[sp + 3]);
        }
        out[i] = out[i] * (1 - mix) + ch[0] * mix;
        out[i + 1] = out[i + 1] * (1 - mix) + ch[1] * mix;
        out[i + 2] = out[i + 2] * (1 - mix) + ch[2] * mix;
        out[i + 3] = Math.max(data[i + 3], alpha);
      }
    }
    inkFxPutImageData(outCtx, { width: w, height: h, data: out });
  },
});

/* =========================================================
   18. INK BLEED (master spec Bölüm 1.18)
   ---------------------------------------------------------
   Mürekkep kağıt liflerinde yayılır: premultiplied bulanıklık
   (yayılma yarıçapı + difüzyon geçişi), yönsel bozulma (anizotropik
   yarıçap), organik kenar (kaba gürültü eşiği), kenar koyulaşması.
   ========================================================= */

inkFxRegister({
  id: 'ink-bleed',
  label: 'Ink Bleed',
  category: 'experimental',
  params: [
    { key: 'bleedAmount', label: 'Bleed Amount', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'spreadRadius', label: 'Spread Radius', type: 'slider', min: 1, max: 40, step: 1, default: 8 },
    { key: 'diffusionStrength', label: 'Diffusion Strength', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'edgeExpansion', label: 'Edge Expansion', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'directionalDistortion', label: 'Directional Distortion', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'pigmentDensity', label: 'Pigment Density', type: 'slider', min: 0.2, max: 1.4, step: 0.05, default: 1 },
    { key: 'paperAbsorption', label: 'Paper Absorption', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'organicVariation', label: 'Organic Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'edgeDarkening', label: 'Edge Darkening', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.45 },
    { key: 'fiberInfluence', label: 'Fiber Influence', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'colorBleeding', label: 'Color Bleeding', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const n = w * h;
    const baseR = Math.max(1, Math.round(P.spreadRadius * (0.4 + P.bleedAmount)));
    const rH = Math.round(baseR * (1 + P.directionalDistortion * 0.8));
    const rV = Math.max(1, Math.round(baseR * (1 - P.directionalDistortion * 0.4)));
    const passes = 1 + Math.round(P.diffusionStrength * 4);

    /* premultiplied (havuzdan) */
    let pr = inkFxScratch(w, h, 'ib.pr', n), pg = inkFxScratch(w, h, 'ib.pg', n),
      pb = inkFxScratch(w, h, 'ib.pb', n), pa = inkFxScratch(w, h, 'ib.pa', n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const a = data[p + 3] / 255;
      pr[i] = data[p] * a; pg[i] = data[p + 1] * a; pb[i] = data[p + 2] * a; pa[i] = data[p + 3];
    }
    /* Kanalları tek taramada döndür (4 ayrı H+V taraması yerine): aynı
       indeks hesabı ve bellek yolu paylaşılır. Her kanalın aritmetiği ve
       toplama sırası birebir aynıdır → piksel çıktısı değişmez. */
    const tmp = inkFxScratch(w, h, 'ib.tmp', n * 4);
    const hBlur = (sr, sg, sb, sa, radius) => {
      const div = radius * 2 + 1;
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let ar = 0, ag = 0, ab = 0, aa = 0;
        for (let k = -radius; k <= radius; k++) {
          const idx = row + Math.min(w - 1, Math.max(0, k));
          ar += sr[idx]; ag += sg[idx]; ab += sb[idx]; aa += sa[idx];
        }
        for (let x = 0; x < w; x++) {
          const p = (row + x) << 2;
          tmp[p] = ar / div; tmp[p + 1] = ag / div;
          tmp[p + 2] = ab / div; tmp[p + 3] = aa / div;
          const ai = row + Math.min(w - 1, x + radius + 1);
          const si = row + Math.max(0, x - radius);
          ar += sr[ai] - sr[si]; ag += sg[ai] - sg[si];
          ab += sb[ai] - sb[si]; aa += sa[ai] - sa[si];
        }
      }
    };
    const vBlur = (dr, dg, db, da, radius) => {
      const div = radius * 2 + 1;
      for (let x = 0; x < w; x++) {
        let ar = 0, ag = 0, ab = 0, aa = 0;
        for (let k = -radius; k <= radius; k++) {
          const p = (Math.min(h - 1, Math.max(0, k)) * w + x) << 2;
          ar += tmp[p]; ag += tmp[p + 1]; ab += tmp[p + 2]; aa += tmp[p + 3];
        }
        for (let y = 0; y < h; y++) {
          const idx = y * w + x;
          dr[idx] = ar / div; dg[idx] = ag / div;
          db[idx] = ab / div; da[idx] = aa / div;
          const ap = (Math.min(h - 1, y + radius + 1) * w + x) << 2;
          const sp = (Math.max(0, y - radius) * w + x) << 2;
          ar += tmp[ap] - tmp[sp]; ag += tmp[ap + 1] - tmp[sp + 1];
          ab += tmp[ap + 2] - tmp[sp + 2]; aa += tmp[ap + 3] - tmp[sp + 3];
        }
      }
    };
    /* Ping-pong: H cur → tmp, V tmp → next; sonuç cur'da kalır. */
    let ar0 = pr, ag0 = pg, ab0 = pb, aa0 = pa;
    let br0 = inkFxScratch(w, h, 'ib.br', n), bg0 = inkFxScratch(w, h, 'ib.bg', n),
      bb0 = inkFxScratch(w, h, 'ib.bb', n), ba0 = inkFxScratch(w, h, 'ib.ba', n);
    for (let i = 0; i < passes; i++) {
      hBlur(ar0, ag0, ab0, aa0, rH);
      vBlur(br0, bg0, bb0, ba0, rV);
      let t = ar0; ar0 = br0; br0 = t;
      t = ag0; ag0 = bg0; bg0 = t;
      t = ab0; ab0 = bb0; bb0 = t;
      t = aa0; aa0 = ba0; ba0 = t;
    }
    pr = ar0; pg = ag0; pb = ab0; pa = aa0;

    /* organik kenar + lif dokusu */
    const noise = inkFxCoarseNoise(w, h, Math.max(3, 10 - P.fiberInfluence * 6), rng);
    /* noise.at(x,y) yerine önceden hesaplanmış indeks tabloları (aynı değer). */
    const noiseX = new Int32Array(w), noiseY = new Int32Array(h);
    for (let x = 0; x < w; x++) {
      noiseX[x] = Math.min(noise.gw - 1, Math.max(0, Math.floor(x / noise.cell)));
    }
    for (let y = 0; y < h; y++) {
      noiseY[y] = Math.min(noise.gh - 1, Math.max(0, Math.floor(y / noise.cell))) * noise.gw;
    }
    const out = inkFxScratch(w, h, 'ib.out', n * 4);
    for (let y = 0, i = 0, p = 0; y < h; y++) {
      const nRow = noiseY[y];
      for (let x = 0; x < w; x++, i++, p += 4) {
        let a = pa[i] / 255;
        /* organik değişkenlik: kenar bölgesinde lekeli eşik */
        const nz = noise.g[nRow + noiseX[x]];
        a = Math.min(1, Math.max(0, a + (nz - 0.5) * P.organicVariation * 0.5 * (a > 0.05 && a < 0.95 ? 1 : 0.25)));
        /* kenar genişletme: orta alfayı büyüt */
        a = Math.min(1, a * (1 + P.edgeExpansion * 0.6));
        /* kâğıt emilimi: zayıf uçları yut */
        a *= 1 - P.paperAbsorption * (1 - a) * 0.7;
        if (a < 0.015) { out[p + 3] = 0; continue; }
        /* kenar koyulaşması: halka = yayılan alfa, orijinalden düşük */
        const ring = Math.min(1, Math.max(0, (a - data[p + 3] / 255 * 0.9)));
        const darken = 1 - P.edgeDarkening * ring * 0.4;
        let r = pr[i] / Math.max(1, pa[i]) * 255, g = pg[i] / Math.max(1, pa[i]) * 255,
          b = pb[i] / Math.max(1, pa[i]) * 255;
        /* renk kanaması: bulanık renkte kanal kayması */
        const shift = P.colorBleeding * 24;
        r = Math.min(255, r + shift * 0.4); g = Math.min(255, g + shift * 0.2); b = Math.min(255, b + shift * 0.55);
        out[p] = r * darken; out[p + 1] = g * darken; out[p + 2] = b * darken;
        out[p + 3] = Math.min(1, a * P.pigmentDensity) * 255;
      }
    }
    const { canvas: bleedC, ctx: bctx } = inkFxCanvas(w, h);
    inkFxPutImageData(bctx, { width: w, height: h, data: out });
    /* önce kanama, üstüne keskin orijinal — orijinal TAM OPAK çizilirse
       kanama ve tüm parametreler görünmez kalır; bleedAmount arttıkça
       keskin katmanın opaklığı düşer, kanama halkası ortaya çıkar. */
    outCtx.drawImage(bleedC, 0, 0);
    const { canvas: sharpC, ctx: sctx } = inkFxCanvas(w, h);
    sctx.drawImage(src, 0, 0, w, h);
    const sharpAlpha = Math.min(1, Math.max(0.2,
      1 - P.bleedAmount * 0.6 - P.paperAbsorption * 0.1));
    outCtx.save();
    outCtx.globalAlpha = sharpAlpha;
    outCtx.drawImage(sharpC, 0, 0);
    outCtx.restore();
  },
});
