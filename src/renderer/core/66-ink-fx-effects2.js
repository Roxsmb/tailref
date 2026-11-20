/* TailRef app · ink fx efekt seti II · Faz 3 (master spec Bölüm 3/4/8)
   ------------------------------------------------------------------
   Çekirdek motor: 64-ink-fx.js · ortak yardımcılar: 65-ink-fx-effects.js
   (inkFxSrcData, inkFxLumOf, inkFxSample, inkFxCoarseNoise, inkFxNoiseTile,
   inkFxCanvas, inkFxPutImageData, INK_DITHER_BAYER8 — aynı bundle scope).
   Tüm efektler DETERMİNİSTİKTİR: rastgelelik yalnız inkFxRng(fx.seed).
   Ortak sözleşme: apply(outCtx, src, P, size, rng) — outCtx şeffaf tuval,
   efekt TAM çıktısını basar. "Random Seed" parametreleri fx.seed ile.
   ========================================================= */
'use strict';

/* =========================================================
   ortak yardımcılar (Faz 3)
   ========================================================= */

/** hex → [r,g,b]. */
function inkFxHexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  const v = m ? parseInt(m[1], 16) : 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** smoothstep(a, b, x). */
function inkFxSmoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
}

/** Float32 alanına ayrılabilir kutu bulanıklığı (yerinde, çok geçişli). */
function inkFxBoxBlurF32(arr, w, h, r, passes) {
  if (r < 1 || passes < 1) return;
  const tmp = new Float32Array(arr.length);
  const win = r * 2 + 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += arr[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / win;
        acc += arr[row + Math.min(w - 1, x + r + 1)] - arr[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        arr[y * w + x] = acc / win;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
}

const inkFxClamp255 = v => Math.min(255, Math.max(0, Math.round(v)));

/* =========================================================
   3. CMYK COLOR SEPARATION (master spec Bölüm 3)
   ---------------------------------------------------------
   Kâğıt üstünde gerçek CMYK ayrıştırma: K = 1−max(RGB);
   C/M/Y gerçek formül; her plaka kendi offset + tescil sapması
   + kanal bulanıklığıyla MULTIPLY basılır (gerçek overprint).
   ========================================================= */

inkFxRegister({
  id: 'cmyk',
  label: 'CMYK Color Separation',
  category: 'printmaking',
  params: [
    { key: 'cyanOffsetX', label: 'Cyan Offset X', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'cyanOffsetY', label: 'Cyan Offset Y', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'magentaOffsetX', label: 'Magenta Offset X', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'magentaOffsetY', label: 'Magenta Offset Y', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'yellowOffsetX', label: 'Yellow Offset X', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'yellowOffsetY', label: 'Yellow Offset Y', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'blackOffsetX', label: 'Black Offset X', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'blackOffsetY', label: 'Black Offset Y', type: 'slider', min: -40, max: 40, step: 1, default: 0 },
    { key: 'channelIntensity', label: 'Channel Intensity', type: 'slider', min: 0.2, max: 1.4, step: 0.05, default: 1 },
    { key: 'registrationError', label: 'Registration Error', type: 'slider', min: 0, max: 20, step: 0.5, default: 2 },
    { key: 'channelBlur', label: 'Channel Blur', type: 'slider', min: 0, max: 8, step: 0.5, default: 1 },
    { key: 'inkDensity', label: 'Ink Density', type: 'slider', min: 0.3, max: 1.4, step: 0.05, default: 1 },
    { key: 'colorSeparationStrength', label: 'Color Separation Strength', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.8 },
    { key: 'bgColor', label: 'Background Color', type: 'color', default: 'none' },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const n = w * h;
    const C = inkFxScratch(w, h, 'cmyk.C', n, Float32Array),
      M = inkFxScratch(w, h, 'cmyk.M', n, Float32Array),
      Y = inkFxScratch(w, h, 'cmyk.Y', n, Float32Array),
      K = inkFxScratch(w, h, 'cmyk.K', n, Float32Array);
    const s = P.colorSeparationStrength;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const a = data[p + 3] / 255;
      const r = a * data[p] / 255 + (1 - a);      /* kâğıt üstünde renk */
      const g = a * data[p + 1] / 255 + (1 - a);
      const b = a * data[p + 2] / 255 + (1 - a);
      const k = Math.max(0, 1 - Math.max(r, g, b));
      const denom = Math.max(0.05, 1 - k);
      const cT = Math.min(1, Math.max(0, (1 - r - k) / denom));
      const mT = Math.min(1, Math.max(0, (1 - g - k) / denom));
      const yT = Math.min(1, Math.max(0, (1 - b - k) / denom));
      C[i] = (1 - r) * (1 - s) + cT * s;
      M[i] = (1 - g) * (1 - s) + mT * s;
      Y[i] = (1 - b) * (1 - s) + yT * s;
      K[i] = Math.min(1, k * (0.35 + 0.65 * s) * 1.25);
    }
    const { canvas: tmp, ctx: tctx } = inkFxCanvas(w, h);
    tctx.fillStyle = (P.bgColor && P.bgColor !== 'none') ? P.bgColor : '#ffffff';
    tctx.fillRect(0, 0, w, h);
    const plates = [
      { ch: C, col: [0, 158, 224], ox: P.cyanOffsetX, oy: P.cyanOffsetY },
      { ch: M, col: [227, 6, 141], ox: P.magentaOffsetX, oy: P.magentaOffsetY },
      { ch: Y, col: [255, 233, 0], ox: P.yellowOffsetX, oy: P.yellowOffsetY },
      { ch: K, col: [28, 26, 24], ox: P.blackOffsetX, oy: P.blackOffsetY },
    ];
    for (const pl of plates) {
      const { canvas: pc, ctx: pctx } = inkFxCanvas(w, h);
      /* Plaka tamponu havuzdan: 4K'da plaka başına 33 MB ayırmak yerine
         tek tampon yeniden doldurulur (putImageData anında kopyalar). */
      const pd = inkFxScratch(w, h, 'cmyk.plate', n * 4);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        pd[p] = pl.col[0]; pd[p + 1] = pl.col[1]; pd[p + 2] = pl.col[2];
        pd[p + 3] = Math.round(Math.min(1, pl.ch[i] * P.inkDensity * P.channelIntensity) * 255);
      }
      inkFxPutImageData(pctx, { width: w, height: h, data: pd });
      const jx = (rng() - 0.5) * 2 * P.registrationError;
      const jy = (rng() - 0.5) * 2 * P.registrationError;
      tctx.save();
      if (P.channelBlur > 0.05) tctx.filter = 'blur(' + P.channelBlur + 'px)';
      tctx.globalCompositeOperation = 'multiply';
      tctx.drawImage(pc, pl.ox + jx, pl.oy + jy);
      tctx.restore();
    }
    outCtx.drawImage(tmp, 0, 0);
  },
});

/* =========================================================
   4. LINOCUT (master spec Bölüm 4)
   ---------------------------------------------------------
   Linolyum baskı: parlaklık → kontrast/eşik → döner ızgarada
   oyma kalınlığı tonla değişen guaj segmentleri; kenar
   pürüzlüğü satır jitterı, doku kırılmaları boşluk açar.
   ========================================================= */

inkFxRegister({
  id: 'linocut',
  label: 'Linocut',
  category: 'printmaking',
  params: [
    { key: 'carvingDensity', label: 'Carving Density', type: 'slider', min: 1, max: 8, step: 1, default: 4 },
    { key: 'lineThickness', label: 'Line Thickness', type: 'slider', min: 0.5, max: 8, step: 0.25, default: 1.6 },
    { key: 'carvingDirection', label: 'Carving Direction', type: 'angle', min: 0, max: 360, step: 1, default: 0 },
    { key: 'edgeRoughness', label: 'Edge Roughness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'contrast', label: 'Contrast', type: 'slider', min: 0.5, max: 2, step: 0.05, default: 1.2 },
    { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: 'mode', label: 'Negative / Positive Mode', type: 'dropdown', default: 'positive',
      options: ['positive', 'negative'] },
    { key: 'inkColor', label: 'Ink Color', type: 'color', default: '#141210' },
    { key: 'paperColor', label: 'Paper Color', type: 'color', default: '#f3ecdd' },
    { key: 'textureIntensity', label: 'Texture Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'carvingDetail', label: 'Carving Detail', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const lum = inkFxLumOf(img);
    outCtx.save(); outCtx.globalAlpha = 1;
    outCtx.fillStyle = P.paperColor; outCtx.fillRect(0, 0, w, h);
    outCtx.restore();
    const neg = P.mode === 'negative';
    const thr = Math.min(0.99, Math.max(0.01, P.threshold));
    const ang = (P.carvingDirection % 360) * Math.PI / 180;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const spacing = Math.max(2.5, (P.lineThickness + 2) * (9 - P.carvingDensity) / 3);
    const span = Math.ceil(Math.sqrt(w * w + h * h) / 2) + spacing;
    const rows = Math.ceil(span * 2 / spacing);
    outCtx.save();
    outCtx.lineCap = 'round';
    outCtx.strokeStyle = P.inkColor;
    outCtx.translate(w / 2, h / 2);
    outCtx.rotate(-ang);
    for (let ri = 0; ri < rows; ri++) {
      const gy = -span + ri * spacing + (rng() - 0.5) * spacing * 0.35 * P.edgeRoughness;
      let runStart = null;
      const step = 2;
      for (let s = -span; s <= span; s += step) {
        const sx = Math.round(w / 2 + s * cosA - gy * sinA);
        const sy = Math.round(h / 2 + s * sinA + gy * cosA);
        const si = Math.min(lum.length - 1, Math.max(0, sy * w + sx));
        let t = Math.min(1, Math.max(0, (lum[si] - 0.5) * P.contrast + 0.5));
        if (neg) t = 1 - t;
        const inInk = t < thr;
        if (inInk && runStart === null) runStart = s;
        if ((!inInk || s + step > span) && runStart !== null) {
          const segL = s - runStart;
          /* doku kırılmaları: yoğunlukla orantılı boşluklar */
          if (segL > 1 && !(P.textureIntensity > 0.01
            && rng() < P.textureIntensity * 0.18)) {
            const depth = 1 - t / thr;
            outCtx.globalAlpha = Math.min(1, 0.55 + depth * 0.45);
            outCtx.lineWidth = Math.max(0.4, P.lineThickness
              * (0.35 + 0.65 * depth) * (0.7 + 0.6 * P.carvingDetail));
            outCtx.beginPath();
            outCtx.moveTo(runStart, gy);
            outCtx.lineTo(s, gy);
            outCtx.stroke();
          }
          runStart = null;
        }
      }
    }
    outCtx.restore();
  },
});

/* =========================================================
   5. WOODCUT (master spec Bölüm 5)
   ---------------------------------------------------------
   Oyma baskı: damak yönünde uzayıp enine hızlı değişen kaba
   gürültü (ağaç damarı) çizgi kalınlığını kısıtlar; ton
   koyulukla genişleyen oyma çizgileri, kenar pürüzlülüğü.
   ========================================================= */

inkFxRegister({
  id: 'woodcut',
  label: 'Woodcut',
  category: 'printmaking',
  params: [
    { key: 'woodGrainDirection', label: 'Wood Grain Direction', type: 'angle', min: 0, max: 360, step: 1, default: 0 },
    { key: 'grainScale', label: 'Grain Scale', type: 'slider', min: 0.5, max: 4, step: 0.1, default: 1 },
    { key: 'engravingDensity', label: 'Engraving Density', type: 'slider', min: 1, max: 8, step: 1, default: 5 },
    { key: 'lineThickness', label: 'Line Thickness', type: 'slider', min: 0.5, max: 6, step: 0.25, default: 1.2 },
    { key: 'lineSpacing', label: 'Line Spacing', type: 'slider', min: 3, max: 40, step: 1, default: 8 },
    { key: 'directionalVariation', label: 'Directional Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.25 },
    { key: 'contrast', label: 'Contrast', type: 'slider', min: 0.5, max: 2, step: 0.05, default: 1.15 },
    { key: 'edgeIrregularity', label: 'Edge Irregularity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'inkColor', label: 'Ink Color', type: 'color', default: '#1a1a1a' },
    { key: 'bgColor', label: 'Background Color', type: 'color', default: 'none' },
    { key: 'carvingDepth', label: 'Carving Depth Simulation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const lum = inkFxLumOf(img);
    if (P.bgColor && P.bgColor !== 'none') {
      outCtx.save(); outCtx.globalAlpha = 1;
      outCtx.fillStyle = P.bgColor; outCtx.fillRect(0, 0, w, h);
      outCtx.restore();
    }
    const ang = (P.woodGrainDirection % 360) * Math.PI / 180;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const spacing = Math.max(3, P.lineSpacing * (9 - P.engravingDensity) / 4);
    const span = Math.ceil(Math.sqrt(w * w + h * h) / 2) + spacing;
    const rows = Math.ceil(span * 2 / spacing);
    /* anizotropik damar gürültüsü: damak yönünde uzun, enine kısa hücre */
    const cellA = Math.max(6, 26 / P.grainScale);
    const cellB = Math.max(2, 5 / P.grainScale);
    const gu = Math.ceil(span * 2 / cellA) + 2;
    const gv = Math.ceil(span * 2 / cellB) + 2;
    const gvals = new Float32Array(gu * gv);
    for (let i = 0; i < gvals.length; i++) gvals[i] = rng();
    const grainAt = (u, v) => {
      const a = Math.min(gu - 1, Math.max(0, (u / cellA) | 0));
      const b = Math.min(gv - 1, Math.max(0, (v / cellB) | 0));
      return gvals[b * gu + a];
    };
    outCtx.save();
    outCtx.strokeStyle = P.inkColor;
    outCtx.lineCap = 'round';
    outCtx.translate(w / 2, h / 2);
    outCtx.rotate(-ang);
    for (let ri = 0; ri < rows; ri++) {
      const gy = -span + ri * spacing + (rng() - 0.5) * spacing * P.directionalVariation;
      const step = 3;
      for (let s = -span; s < span; s += step) {
        const sx = Math.round(w / 2 + s * cosA - gy * sinA);
        const sy = Math.round(h / 2 + s * sinA + gy * cosA);
        const si = Math.min(lum.length - 1, Math.max(0, sy * w + sx));
        const t = Math.min(1, Math.max(0, (lum[si] - 0.5) * P.contrast + 0.5));
        const dark = 1 - t;
        if (dark < 0.04) continue;
        const grainMod = 0.45 + 0.55 * grainAt(s + span, gy + span);
        const jit = (rng() - 0.5) * step * P.edgeIrregularity;
        const wid = P.lineThickness * dark * grainMod * (0.7 + 0.6 * P.carvingDepth);
        if (wid < 0.3) continue;
        outCtx.globalAlpha = Math.min(1, 0.35 + dark * 0.65);
        outCtx.lineWidth = wid;
        outCtx.beginPath();
        outCtx.moveTo(s, gy + jit);
        outCtx.lineTo(s + step, gy + jit);
        outCtx.stroke();
      }
    }
    outCtx.restore();
  },
});

/* =========================================================
   6. PAPER GRAIN / DISTRESS (master spec Bölüm 6)
   ---------------------------------------------------------
   Kâğıt yüzeyi: iki ölçekli tane + pürüzlü benekler, lif
   çizgileri, eskime tonlaması (vinyet), lekeler, çizikler,
   kenar yıpranması; kaynak kâğıda multiply basılır.
   ========================================================= */

inkFxRegister({
  id: 'paper-grain',
  label: 'Paper Grain / Distress',
  category: 'printmaking',
  params: [
    { key: 'grainIntensity', label: 'Grain Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.45 },
    { key: 'grainScale', label: 'Grain Scale', type: 'slider', min: 0.5, max: 4, step: 0.1, default: 1 },
    { key: 'paperRoughness', label: 'Paper Roughness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'fiberDensity', label: 'Fiber Density', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'surfaceVariation', label: 'Surface Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'paperAging', label: 'Paper Aging', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.25 },
    { key: 'stains', label: 'Stains', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.2 },
    { key: 'scratches', label: 'Scratches', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.2 },
    { key: 'edgeWear', label: 'Edge Wear', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'paperColor', label: 'Paper Color', type: 'color', default: '#f6f1e3' },
    { key: 'textureContrast', label: 'Texture Contrast', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const paper = inkFxHexToRgb(P.paperColor);
    const fine = inkFxCoarseNoise(w, h, Math.max(1, Math.round(2 * P.grainScale)), rng);
    const rough = inkFxCoarseNoise(w, h, Math.max(3, Math.round(9 * P.grainScale)), rng);
    const wearN = inkFxCoarseNoise(w, h, 3, rng);
    const con = 0.5 + P.textureContrast * 1.2;
    const tex = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const x = i % w, y = (i / w) | 0;
      const n1 = fine.at(x, y);
      const n2 = rough.at(x, y);
      let m = 1 + (n1 - 0.5) * P.grainIntensity * con * 0.5
        + (n2 - 0.5) * P.surfaceVariation * con * 0.35;
      m *= 1 - P.paperRoughness * 0.15 * (n1 > 0.72 ? 1 : 0);
      /* kenar yıpranması: kenara yaklaşan bandda koyulaşma + tırtıklı eşik */
      const dEdge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const bw = 3 + P.edgeWear * 14;
      if (P.edgeWear > 0.01 && dEdge < bw) {
        const f = 1 - dEdge / bw;
        if (wearN.at(x, y) > 1 - f * (0.5 + P.edgeWear)) {
          m *= 0.82 - f * 0.12;
        }
      }
      tex[p] = inkFxClamp255(paper[0] * m);
      tex[p + 1] = inkFxClamp255(paper[1] * m);
      tex[p + 2] = inkFxClamp255(paper[2] * m);
      tex[p + 3] = 255;
    }
    const { canvas: texC, ctx: tctx } = inkFxCanvas(w, h);
    inkFxPutImageData(tctx, { width: w, height: h, data: tex });
    /* lifler */
    const fibers = Math.round(P.fiberDensity * w * h / 420);
    tctx.save();
    for (let k = 0; k < fibers; k++) {
      const x = rng() * w, y = rng() * h;
      const len = 5 + rng() * 22;
      const a2 = (rng() - 0.5) * 0.5;
      tctx.globalAlpha = 0.05 + rng() * 0.08;
      tctx.strokeStyle = rng() > 0.5 ? '#d9cfb8' : '#b9ac8e';
      tctx.lineWidth = 1;
      tctx.beginPath();
      tctx.moveTo(x, y);
      tctx.lineTo(x + Math.cos(a2) * len, y + Math.sin(a2) * len);
      tctx.stroke();
    }
    tctx.restore();
    /* eskime: ısı tonlaması + vinyet */
    if (P.paperAging > 0.01) {
      const grad = tctx.createRadialGradient(w / 2, h / 2,
        Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.72);
      grad.addColorStop(0, 'rgba(216,199,160,0)');
      grad.addColorStop(1, 'rgba(190,168,124,' + (P.paperAging * 0.4).toFixed(3) + ')');
      tctx.fillStyle = grad;
      tctx.fillRect(0, 0, w, h);
    }
    /* lekeler */
    const stains = Math.round(P.stains * 7);
    for (let k = 0; k < stains; k++) {
      const cx = rng() * w, cy = rng() * h;
      const rad = Math.max(w, h) * (0.06 + rng() * 0.16);
      const g2 = tctx.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad);
      g2.addColorStop(0, 'rgba(150,118,76,' + (0.10 + rng() * 0.12 * P.stains).toFixed(3) + ')');
      g2.addColorStop(1, 'rgba(150,118,76,0)');
      tctx.fillStyle = g2;
      tctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    /* çizikler */
    const scratches = Math.round(P.scratches * 12);
    tctx.save();
    for (let k = 0; k < scratches; k++) {
      const x = rng() * w, y = rng() * h;
      const len = 8 + rng() * (Math.max(w, h) * 0.3);
      const a2 = rng() * Math.PI;
      tctx.globalAlpha = 0.06 + rng() * 0.1;
      tctx.strokeStyle = rng() > 0.4 ? '#fffdf6' : '#8f8471';
      tctx.lineWidth = rng() > 0.8 ? 2 : 1;
      tctx.beginPath();
      tctx.moveTo(x, y);
      tctx.lineTo(x + Math.cos(a2) * len, y + Math.sin(a2) * len);
      tctx.stroke();
    }
    tctx.restore();
    /* kâğıt zemine mürekkep multiply */
    outCtx.save();
    outCtx.drawImage(texC, 0, 0);
    outCtx.globalCompositeOperation = 'multiply';
    outCtx.drawImage(src, 0, 0, w, h);
    outCtx.restore();
  },
});

/* =========================================================
   8. OIL PAINT / IMPASTO (master spec Bölüm 8)
   ---------------------------------------------------------
   Yağlı boya: döner ızgarada eğri fırça darbeleri; kalın
   boya için darbe üstüne ışık/gölge kenarı (impasto),
   gradien büyüklüğü kabartmayı sürer; tuval dokusu multiply.
   ========================================================= */

inkFxRegister({
  id: 'oil-paint',
  label: 'Oil Paint / Impasto',
  category: 'traditional',
  params: [
    { key: 'brushstrokeSize', label: 'Brushstroke Size', type: 'slider', min: 2, max: 40, step: 1, default: 10 },
    { key: 'brushstrokeDirection', label: 'Brushstroke Direction', type: 'angle', min: 0, max: 360, step: 1, default: 0 },
    { key: 'strokeLength', label: 'Stroke Length', type: 'slider', min: 4, max: 80, step: 1, default: 24 },
    { key: 'paintThickness', label: 'Paint Thickness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'impastoDepth', label: 'Impasto Depth', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'surfaceRoughness', label: 'Surface Roughness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'canvasTexture', label: 'Canvas Texture', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'colorVariation', label: 'Color Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.2 },
    { key: 'lightingIntensity', label: 'Lighting Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'textureScale', label: 'Texture Scale', type: 'slider', min: 0.5, max: 3, step: 0.1, default: 1 },
    { key: 'brushstrokeDensity', label: 'Brushstroke Density', type: 'slider', min: 1, max: 8, step: 1, default: 4 },
    { key: 'surfaceRelief', label: 'Surface Relief', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const lum = inkFxLumOf(img);
    const ang = (P.brushstrokeDirection % 360) * Math.PI / 180;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const spacing = Math.max(3, P.brushstrokeSize * 0.55 * (1.7 - P.brushstrokeDensity * 0.15));
    const span = Math.ceil(Math.sqrt(w * w + h * h) / 2) + spacing * 2;
    const rows = Math.ceil(span * 2 / spacing);
    outCtx.save();
    outCtx.translate(w / 2, h / 2);
    outCtx.rotate(-ang);
    outCtx.lineCap = 'round';
    for (let ri = 0; ri < rows; ri++) {
      const gy = -span + ri * spacing + (rng() - 0.5) * spacing * 0.4 * P.surfaceRoughness;
      for (let s = -span; s < span; s += P.strokeLength * (0.55 + rng() * 0.5)) {
        const len = P.strokeLength * (0.7 + rng() * 0.6);
        const sx = Math.round(w / 2 + (s + len / 2) * cosA - gy * sinA);
        const sy = Math.round(h / 2 + (s + len / 2) * sinA + gy * cosA);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const p4 = (sy * w + sx) * 4;
        const jitter = (rng() - 0.5) * P.colorVariation * 50;
        const width = Math.max(2, P.brushstrokeSize * (0.5 + rng() * 0.35));
        const thick = P.paintThickness * (0.6 + rng() * 0.5);
        outCtx.save();
        outCtx.translate(s, gy);
        outCtx.rotate((rng() - 0.5) * 0.2 * P.surfaceRoughness);
        /* gövde darbesi (hafif eğri) */
        outCtx.strokeStyle = 'rgba('
          + inkFxClamp255(data[p4] + jitter) + ','
          + inkFxClamp255(data[p4 + 1] + jitter * 0.7) + ','
          + inkFxClamp255(data[p4 + 2] + jitter * 0.5) + ','
          + (0.82 + 0.15 * thick) + ')';
        outCtx.lineWidth = width;
        outCtx.beginPath();
        outCtx.moveTo(-len / 2, 0);
        outCtx.quadraticCurveTo(0, (rng() - 0.5) * width * 0.3, len / 2, 0);
        outCtx.stroke();
        /* impasto: gradien büyüklüğü kabartmayı ölçekler */
        const gl = Math.abs(lum[sy * w + Math.min(w - 1, sx + 1)] - lum[sy * w + sx]);
        const relief = P.impastoDepth * (0.5 + Math.min(1, gl * 2) * P.surfaceRelief);
        if (P.lightingIntensity > 0.01) {
          outCtx.globalAlpha = Math.min(1, P.lightingIntensity * 0.4 * (0.5 + thick));
          outCtx.strokeStyle = 'rgba(255,255,255,0.9)';
          outCtx.lineWidth = Math.max(1, width * 0.3);
          outCtx.beginPath();
          outCtx.moveTo(-len / 2, -width * 0.32);
          outCtx.lineTo(len / 2, -width * 0.32);
          outCtx.stroke();
          outCtx.globalAlpha = Math.min(1, P.lightingIntensity * 0.3 * (0.5 + relief));
          outCtx.strokeStyle = 'rgba(0,0,0,0.85)';
          outCtx.beginPath();
          outCtx.moveTo(-len / 2, width * 0.34);
          outCtx.lineTo(len / 2, width * 0.34);
          outCtx.stroke();
        }
        outCtx.restore();
      }
    }
    outCtx.restore();
    if (P.canvasTexture > 0.01) {
      const nz = inkFxNoiseTile(256, rng, r => 0.82 + r * 0.36 / Math.max(0.5, P.textureScale));
      outCtx.save();
      outCtx.globalAlpha = P.canvasTexture * 0.4;
      outCtx.globalCompositeOperation = 'multiply';
      outCtx.fillStyle = outCtx.createPattern(nz, 'repeat');
      outCtx.fillRect(0, 0, w, h);
      outCtx.restore();
    }
  },
});

/* =========================================================
   10. CHARCOAL (master spec Bölüm 10)
   ---------------------------------------------------------
   Kömür: koyuluk kaplama alanı (sertlik üssü + vurgu
   koruması), pus (alanın bulanıkla karışımı), iki ölçekli
   tane + kenar pürüzü eşiği, vuruş varyasyonu, toz benekleri,
   dokulu kâğıt zemin.
   ========================================================= */

inkFxRegister({
  id: 'charcoal',
  label: 'Charcoal',
  category: 'traditional',
  params: [
    { key: 'charcoalGrain', label: 'Charcoal Grain', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'smudgeIntensity', label: 'Smudge Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'smudgeRadius', label: 'Smudge Radius', type: 'slider', min: 1, max: 30, step: 1, default: 8 },
    { key: 'softness', label: 'Softness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'edgeRoughness', label: 'Edge Roughness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.45 },
    { key: 'powderDensity', label: 'Powder Density', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'contrast', label: 'Contrast', type: 'slider', min: 0.5, max: 2, step: 0.05, default: 1.15 },
    { key: 'paperTexture', label: 'Paper Texture', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'blackIntensity', label: 'Black Intensity', type: 'slider', min: 0.2, max: 1, step: 0.05, default: 0.7 },
    { key: 'grainScale', label: 'Grain Scale', type: 'slider', min: 0.5, max: 3, step: 0.1, default: 1 },
    { key: 'strokeVariation', label: 'Charcoal Stroke Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'highlightPreservation', label: 'Highlight Preservation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const n = w * h;
    const lum = inkFxLumOf(img);
    const cov = inkFxScratch(w, h, 'char.cov', n, Float32Array);
    for (let i = 0; i < n; i++) {
      const v = Math.min(1, Math.max(0, (lum[i] - 0.5) * P.contrast + 0.5));
      let d0 = 1 - v;
      d0 = Math.pow(d0, 1 + (1 - P.softness) * 0.8);
      d0 *= 1 - P.highlightPreservation * inkFxSmoothstep(0.72, 0.97, lum[i]);
      cov[i] = d0;
    }
    if (P.smudgeIntensity > 0.01) {
      const blurC = inkFxScratch(w, h, 'char.blur', n, Float32Array);
      blurC.set(cov);
      inkFxBoxBlurF32(blurC, w, h, Math.max(1, Math.round(P.smudgeRadius * P.smudgeIntensity)), 1);
      for (let i = 0; i < n; i++) {
        cov[i] = cov[i] * (1 - P.smudgeIntensity) + blurC[i] * P.smudgeIntensity;
      }
    }
    const grain = inkFxCoarseNoise(w, h, Math.max(1, Math.round(2 * P.grainScale)), rng);
    const rough = inkFxCoarseNoise(w, h, Math.max(2, Math.round(4 * P.grainScale)), rng);
    const strokeN = inkFxCoarseNoise(w, h, Math.max(4, Math.round(10 * P.grainScale)), rng);
    const out = inkFxScratch(w, h, 'char.out', n * 4);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const x = i % w, y = (i / w) | 0;
      let c = cov[i];
      c *= 1 - P.charcoalGrain * 0.55 * grain.at(x, y);
      c *= 1 - P.strokeVariation * 0.4 * strokeN.at(x, y);
      c += (rough.at(x, y) - 0.5) * P.edgeRoughness * 0.4;
      c = Math.min(1, Math.max(0, c));
      if (P.powderDensity > 0.01 && c > 0.15 && c < 0.75
        && grain.at(x + 31, y + 17) > 1 - P.powderDensity * 0.12) {
        c *= 0.45; /* toz: orta tonlarda açık benekler */
      }
      const pn = 1 - P.paperTexture * 0.18 * grain.at(x + 7, y + 3);
      let r = 248 * pn, g = 246 * pn, b = 240 * pn;
      const a = c * P.blackIntensity;
      out[p] = r * (1 - a) + 24 * a;
      out[p + 1] = g * (1 - a) + 22 * a;
      out[p + 2] = b * (1 - a) + 20 * a;
      out[p + 3] = 255;
    }
    inkFxPutImageData(outCtx, { width: w, height: h, data: out });
  },
});
