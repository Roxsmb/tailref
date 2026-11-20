/* TailRef app · ink fx efekt seti III · Faz 3 (master spec Bölüm 12/13/15/17/19/20)
   ------------------------------------------------------------------
   Çekirdek motor: 64-ink-fx.js · yardımcılar: 65/66 modülleri
   (inkFxSrcData, inkFxLumOf, inkFxSample, inkFxCoarseNoise, inkFxNoiseTile,
   inkFxCanvas, inkFxPutImageData, inkFxHexToRgb, inkFxSmoothstep,
   inkFxBoxBlurF32, INK_DITHER_BAYER8 — aynı bundle scope).
   Tüm efektler DETERMİNİSTİKTİR: rastgelelik yalnız inkFxRng(fx.seed).
   ========================================================= */
'use strict';

/* =========================================================
   12. STIPPLING (master spec Bölüm 12)
   ---------------------------------------------------------
   Tonlu nokta illüstrasyonu: önem örneklemeli dart atışı —
   kabul olasılığı koyulukla artar, kümeleme kaba gürültüyle
   yoğunluğu oynatır, mesafe ızgarası dağılımı kontrol eder,
   kenar koruması gradiyente yarıçapı küçültür.
   ========================================================= */

inkFxRegister({
  id: 'stippling',
  label: 'Stippling',
  category: 'traditional',
  params: [
    { key: 'dotDensity', label: 'Dot Density', type: 'slider', min: 0.05, max: 1, step: 0.05, default: 0.5 },
    { key: 'minDotSize', label: 'Minimum Dot Size', type: 'slider', min: 0.3, max: 6, step: 0.1, default: 1 },
    { key: 'maxDotSize', label: 'Maximum Dot Size', type: 'slider', min: 2, max: 16, step: 0.5, default: 4 },
    { key: 'dotSizeVariation', label: 'Dot Size Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'distributionRandomness', label: 'Distribution Randomness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'toneSensitivity', label: 'Tone Sensitivity', type: 'slider', min: 0.5, max: 2.5, step: 0.05, default: 1 },
    { key: 'clustering', label: 'Clustering', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'edgePreservation', label: 'Edge Preservation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'dotColor', label: 'Dot Color', type: 'color', default: '#151312' },
    { key: 'bgColor', label: 'Background Color', type: 'color', default: 'none' },
    { key: 'distributionScale', label: 'Distribution Scale', type: 'slider', min: 0.5, max: 3, step: 0.1, default: 1 },
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
    const step = Math.max(2, Math.round(3 * P.distributionScale));
    const attempts = Math.round(w * h / (step * step) * 4 * P.dotDensity);
    const clusterN = inkFxCoarseNoise(w, h, Math.max(4, Math.round(10 * P.distributionScale)), rng);
    const cell = Math.max(2, Math.round(step / 2));
    const gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1;
    const occ = new Int32Array(gw * gh);
    outCtx.fillStyle = P.dotColor;
    for (let a = 0; a < attempts; a++) {
      const x = rng() * w, y = rng() * h;
      const xi = Math.min(w - 1, x | 0), yi = Math.min(h - 1, y | 0);
      const i = yi * w + xi;
      const l = lum[i];
      const dark = Math.min(1, Math.max(0, (1 - l) * P.toneSensitivity));
      if (rng() > dark * P.dotDensity * 2) continue;
      if (rng() > (1 - P.clustering * 0.5) + P.clustering * clusterN.at(xi, yi)) continue;
      const cx = (x / cell) | 0, cy = (y / cell) | 0;
      if (occ[cy * gw + cx] && rng() > P.distributionRandomness) continue;
      occ[cy * gw + cx] = 1;
      let r = P.minDotSize + (P.maxDotSize - P.minDotSize) * Math.pow(dark, 1.2);
      r *= 1 + P.dotSizeVariation * (rng() - 0.5) * 0.9;
      if (P.edgePreservation > 0.01) {
        const gx2 = Math.min(w - 1, xi + 1), gy2 = Math.min(h - 1, yi + 1);
        const grad = Math.abs(lum[yi * w + gx2] - l) + Math.abs(lum[gy2 * w + xi] - l);
        r *= 1 - P.edgePreservation * Math.min(1, grad * 2);
      }
      if (r < 0.25) continue;
      outCtx.globalAlpha = Math.min(1, 0.4 + dark * 0.6);
      outCtx.beginPath();
      outCtx.arc(x, y, r, 0, Math.PI * 2);
      outCtx.fill();
    }
    outCtx.globalAlpha = 1;
  },
});

/* =========================================================
   13. DRY BRUSH (master spec Bölüm 13)
   ---------------------------------------------------------
   Kuru fırça: paralel kıl çizgileri — kıl profili (sinüs)
   alfa verir, kıl dokusu boşluk kırar, kırık kaplama
   darbeleri aralar, yüzey dokusu multiply.
   ========================================================= */

inkFxRegister({
  id: 'dry-brush',
  label: 'Dry Brush',
  category: 'traditional',
  params: [
    { key: 'brushSize', label: 'Brush Size', type: 'slider', min: 2, max: 40, step: 1, default: 14 },
    { key: 'brushDirection', label: 'Brush Direction', type: 'angle', min: 0, max: 360, step: 1, default: 45 },
    { key: 'strokeLength', label: 'Stroke Length', type: 'slider', min: 6, max: 100, step: 2, default: 40 },
    { key: 'brokenCoverage', label: 'Broken Coverage', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'bristleTexture', label: 'Bristle Texture', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'edgeRoughness', label: 'Edge Roughness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'paintDensity', label: 'Paint Density', type: 'slider', min: 0.2, max: 1, step: 0.05, default: 0.8 },
    { key: 'grainIntensity', label: 'Grain Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'colorVariation', label: 'Color Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.25 },
    { key: 'textureScale', label: 'Texture Scale', type: 'slider', min: 0.5, max: 3, step: 0.1, default: 1 },
    { key: 'strokeIrregularity', label: 'Stroke Irregularity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'surfaceTexture', label: 'Surface Texture', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const lum = inkFxLumOf(img);
    const ang = (P.brushDirection % 360) * Math.PI / 180;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const spacing = Math.max(3, P.brushSize * (1.5 - P.edgeRoughness * 0.4));
    const span = Math.ceil(Math.sqrt(w * w + h * h) / 2) + spacing * 2;
    const rows = Math.ceil(span * 2 / spacing);
    const bristles = Math.max(2, Math.round(P.brushSize / 3));
    outCtx.save();
    outCtx.translate(w / 2, h / 2);
    outCtx.rotate(-ang);
    outCtx.lineCap = 'butt';
    for (let ri = 0; ri < rows; ri++) {
      const gy = -span + ri * spacing + (rng() - 0.5) * spacing * P.strokeIrregularity;
      let s = -span + rng() * P.strokeLength * 0.5 * P.strokeIrregularity;
      while (s < span) {
        const len = P.strokeLength * (0.35 + rng() * 0.75);
        const mid = s + len / 2;
        const sx = Math.round(w / 2 + mid * cosA - gy * sinA);
        const sy = Math.round(h / 2 + mid * sinA + gy * cosA);
        const si = Math.min(lum.length - 1, Math.max(0, sy * w + sx));
        const l = lum[si];
        s += len * (1 + P.brokenCoverage * (0.4 + rng() * 0.9));
        if (l > 0.93 || rng() < P.brokenCoverage * 0.35) continue;
        const p4 = inkFxSample(data, w, h, sx, sy);
        const jitter = (rng() - 0.5) * P.colorVariation * 55;
        for (let b = 0; b < bristles; b++) {
          if (rng() < P.bristleTexture * 0.4) continue;
          const off = (b / (bristles - 1) - 0.5) * P.brushSize
            * (0.85 + (rng() - 0.5) * 0.3 * P.edgeRoughness);
          const a = P.paintDensity
            * (0.35 + 0.65 * Math.sin(Math.PI * (b + 0.5) / bristles))
            * (1 - P.bristleTexture * 0.5 * rng())
            * (1 - P.grainIntensity * 0.4 * rng());
          if (a < 0.03) continue;
          outCtx.save();
          outCtx.translate(s, gy + off);
          outCtx.rotate((rng() - 0.5) * 0.15 * P.edgeRoughness);
          outCtx.strokeStyle = 'rgba('
            + inkFxClamp255(data[p4] + jitter) + ','
            + inkFxClamp255(data[p4 + 1] + jitter * 0.7) + ','
            + inkFxClamp255(data[p4 + 2] + jitter * 0.5) + ','
            + Math.min(1, a) + ')';
          outCtx.lineWidth = Math.max(0.6, P.brushSize / bristles * 0.55);
          outCtx.beginPath();
          outCtx.moveTo(0, 0);
          outCtx.lineTo(len, 0);
          outCtx.stroke();
          outCtx.restore();
        }
      }
    }
    outCtx.restore();
    if (P.surfaceTexture > 0.01) {
      const nz = inkFxNoiseTile(224, rng, r => 0.86 + r * 0.3 / Math.max(0.5, P.textureScale));
      outCtx.save();
      outCtx.globalAlpha = P.surfaceTexture * 0.35;
      outCtx.globalCompositeOperation = 'multiply';
      outCtx.fillStyle = outCtx.createPattern(nz, 'repeat');
      outCtx.fillRect(0, 0, w, h);
      outCtx.restore();
    }
  },
});

/* =========================================================
   15. GLITCH ART (master spec Bölüm 15)
   ---------------------------------------------------------
   Kontrollü dijital bozulma: yatay/dikey blok kaymaları
   (blok sıklığı + kanal başına RGB displacement), tarama
   çizgileri, spekülatif gürültü, renk kayması.
   ========================================================= */

inkFxRegister({
  id: 'glitch-art',
  label: 'Glitch Art',
  category: 'experimental',
  params: [
    { key: 'rgbDisplacement', label: 'RGB Displacement', type: 'slider', min: 0, max: 40, step: 1, default: 6 },
    { key: 'horizontalDisplacement', label: 'Horizontal Displacement', type: 'slider', min: -80, max: 80, step: 1, default: 12,
      when: { key: 'distortionDirection', neq: 'vertical' } },
    { key: 'verticalDisplacement', label: 'Vertical Displacement', type: 'slider', min: -80, max: 80, step: 1, default: 0,
      when: { key: 'distortionDirection', neq: 'horizontal' } },
    { key: 'blockSize', label: 'Block Size', type: 'slider', min: 2, max: 120, step: 1, default: 24 },
    { key: 'blockFrequency', label: 'Block Frequency', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'scanlineIntensity', label: 'Scanline Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'noiseAmount', label: 'Noise Amount', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.25 },
    { key: 'distortionStrength', label: 'Distortion Strength', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'channelSeparation', label: 'Channel Separation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'distortionDirection', label: 'Distortion Direction', type: 'dropdown', default: 'both',
      options: ['horizontal', 'vertical', 'both'] },
    { key: 'colorShift', label: 'Color Shift', type: 'slider', min: -100, max: 100, step: 1, default: 0 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const n = w * h;
    const out = new Uint8ClampedArray(img.data);
    const bs = Math.max(2, Math.round(P.blockSize));
    const rgbD = Math.round(P.rgbDisplacement * P.channelSeparation);
    const clampX = v => Math.min(w - 1, Math.max(0, v));
    const clampY = v => Math.min(h - 1, Math.max(0, v));
    const doH = P.distortionDirection !== 'vertical';
    const doV = P.distortionDirection !== 'horizontal';
    if (doH) {
      for (let y0 = 0; y0 < h; y0 += bs) {
        if (rng() >= P.blockFrequency) continue;
        const shift = Math.round(P.horizontalDisplacement * P.distortionStrength
          * (rng() - 0.5) * 2);
        const y1 = Math.min(h, y0 + bs);
        const band = new Uint8ClampedArray(out.slice(y0 * w * 4, y1 * w * 4));
        for (let y = y0; y < y1; y++) {
          for (let x = 0; x < w; x++) {
            const p = (y * w + x) * 4, b = ((y - y0) * w) * 4;
            out[p] = band[b + clampX(x - shift - rgbD) * 4];
            out[p + 1] = band[b + clampX(x - shift) * 4 + 1];
            out[p + 2] = band[b + clampX(x - shift + rgbD) * 4 + 2];
          }
        }
      }
    }
    if (doV && P.verticalDisplacement !== 0) {
      for (let x0 = 0; x0 < w; x0 += bs) {
        if (rng() >= P.blockFrequency) continue;
        const shift = Math.round(P.verticalDisplacement * P.distortionStrength
          * (rng() - 0.5) * 2);
        const x1 = Math.min(w, x0 + bs);
        const bw = x1 - x0;
        const band = new Uint8ClampedArray(bw * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = x0; x < x1; x++) {
            const sp = (y * w + x) * 4, dp = (y * bw + x - x0) * 4;
            band[dp] = out[sp]; band[dp + 1] = out[sp + 1];
            band[dp + 2] = out[sp + 2]; band[dp + 3] = out[sp + 3];
          }
        }
        for (let y = 0; y < h; y++) {
          for (let x = x0; x < x1; x++) {
            const p = (y * w + x) * 4;
            const sp = (clampY(y - shift) * bw + x - x0) * 4;
            out[p] = band[sp]; out[p + 1] = band[sp + 1]; out[p + 2] = band[sp + 2];
          }
        }
      }
    }
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const y = (i / w) | 0;
      if (P.scanlineIntensity > 0.01 && y % 2 === 0) {
        const f = 1 - P.scanlineIntensity * 0.45;
        out[p] *= f; out[p + 1] *= f; out[p + 2] *= f;
      }
      if (P.noiseAmount > 0.001 && rng() < P.noiseAmount * 0.02) {
        const v = rng() * 255;
        out[p] = out[p + 1] = out[p + 2] = v;
      }
      if (P.colorShift !== 0) {
        out[p] = out[p] + P.colorShift * 0.5;
        out[p + 2] = out[p + 2] - P.colorShift * 0.5;
      }
    }
    inkFxPutImageData(outCtx, { width: w, height: h, data: out });
  },
});

/* =========================================================
   17. CONTOUR EXTRACTION (master spec Bölüm 17)
   ---------------------------------------------------------
   Kontur: Sobel / Laplacian / gerçek Canny (gradien + yön
   nicemleme + non-maximum suppression + histerezis), eşik
   hassasiyeti, detay, gürültü azaltma, kalınlık genişletme,
   invert + şeffaf/renkli zemin.
   ========================================================= */

inkFxRegister({
  id: 'contour',
  label: 'Contour Extraction',
  category: 'experimental',
  params: [
    { key: 'algorithm', label: 'Edge Detection Algorithm', type: 'dropdown', default: 'sobel',
      options: ['sobel', 'canny', 'laplacian'] },
    { key: 'edgeThreshold', label: 'Edge Threshold', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: 'edgeThickness', label: 'Edge Thickness', type: 'slider', min: 0.5, max: 6, step: 0.5, default: 1 },
    { key: 'edgeSensitivity', label: 'Edge Sensitivity', type: 'slider', min: 0.5, max: 3, step: 0.05, default: 1 },
    { key: 'detailLevel', label: 'Detail Level', type: 'slider', min: 1, max: 10, step: 1, default: 5 },
    { key: 'smoothing', label: 'Smoothing', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'lineColor', label: 'Line Color', type: 'color', default: '#1a1a1a' },
    { key: 'bgColor', label: 'Background Color', type: 'color', default: 'none',
      when: { key: 'transparentBackground', is: false } },
    { key: 'invert', label: 'Invert', type: 'toggle', default: false },
    { key: 'transparentBackground', label: 'Transparent Background', type: 'toggle', default: true },
    { key: 'noiseReduction', label: 'Noise Reduction', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
  ],
  apply(outCtx, src, P, size) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const n = w * h;
    let lum = inkFxLumOf(img);
    const pre = Math.round(P.noiseReduction * 2 + P.smoothing * 2);
    if (pre > 0) { lum = lum.slice(); inkFxBoxBlurF32(lum, w, h, 1, pre); }
    const mag = new Float32Array(n);
    const dir = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const a = lum[i - w - 1], b = lum[i - w], c = lum[i - w + 1];
        const d = lum[i - 1], f = lum[i + 1];
        const g = lum[i + w - 1], hh = lum[i + w], k = lum[i + w + 1];
        if (P.algorithm === 'laplacian') {
          mag[i] = Math.min(1, Math.abs(4 * lum[i] - b - d - f - hh) / 2);
        } else {
          const gx = (c + 2 * f + k) - (a + 2 * d + g);
          const gy = (g + 2 * hh + k) - (a + 2 * b + c);
          mag[i] = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 4);
          const ax = Math.abs(gx), ay = Math.abs(gy);
          dir[i] = ax > ay * 2 ? 0 : ay > ax * 2 ? 1 : (gx * gy >= 0 ? 2 : 3);
        }
      }
    }
    /* adaptif eşik referansı: raw mag'ın sağlam tepe değeri (p98,
       64 kova histogramla O(n)). Yumuşak görsellerde eşik otomatik
       yumuşar, keskin çizimlerde sabit davranış korunur.
       Edge Sensitivity sens'i raw mag'ı ölçeklediği için anlamlı
       kalır — referans sens'siz hesaplanır (dekoratif parametre yok). */
    const bins = new Int32Array(64);
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      if (mag[i] > 0.004) { bins[Math.min(63, (mag[i] * 64) | 0)]++; cnt++; }
    }
    let ref = 0.12;
    if (cnt > 0) {
      let acc = 0;
      const target = Math.max(1, Math.ceil(cnt * 0.02));
      for (let b = 63; b >= 0; b--) {
        acc += bins[b];
        if (acc >= target) { ref = Math.max(0.12, (b + 1) / 64); break; }
      }
    }
    const sens = P.edgeSensitivity * (0.7 + P.detailLevel / 10);
    const thrA = Math.min(0.95, P.edgeThreshold) * ref;
    const respW = Math.max(0.06, ref * 0.7);
    let edge = mag;
    if (P.algorithm === 'canny') {
      /* non-maximum suppression */
      const nms = new Float32Array(n);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const m = mag[i];
          if (!m) continue;
          let n1, n2;
          if (dir[i] === 0) { n1 = mag[i + 1]; n2 = mag[i - 1]; }
          else if (dir[i] === 1) { n1 = mag[i + w]; n2 = mag[i - w]; }
          else if (dir[i] === 2) { n1 = mag[i + w + 1]; n2 = mag[i - w - 1]; }
          else { n1 = mag[i + w - 1]; n2 = mag[i - w + 1]; }
          if (m >= n1 && m >= n2) nms[i] = m;
        }
      }
      /* histerezis: zayıf kenar güçlüye bitişikse yaşar */
      const lo = thrA * 0.5, hi = thrA;
      const res = new Float32Array(n);
      for (let i = 0; i < n; i++) if (nms[i] * sens >= hi) res[i] = 1;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (nms[i] * sens >= lo && !res[i]
            && (res[i - 1] || res[i + 1] || res[i - w] || res[i + w]
              || res[i - w - 1] || res[i - w + 1] || res[i + w - 1] || res[i + w + 1])) {
            res[i] = 0.7;
          }
        }
      }
      edge = res;
    } else {
      for (let i = 0; i < n; i++) {
        const ms = Math.min(1, mag[i] * sens);
        edge[i] = ms > thrA ? Math.min(1, (ms - thrA) / respW) : 0;
      }
    }
    /* kalınlık: maksimum genişletme */
    const th = Math.round(P.edgeThickness);
    for (let k = 1; k < th; k++) {
      const snap = edge.slice();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          edge[i] = Math.max(snap[i],
            x > 0 ? snap[i - 1] : 0, x < w - 1 ? snap[i + 1] : 0,
            y > 0 ? snap[i - w] : 0, y < h - 1 ? snap[i + w] : 0);
        }
      }
    }
    const lc = inkFxHexToRgb(P.lineColor);
    const out = inkFxScratch(w, h, 'contour.out', n * 4);
    const inv = !!P.invert;
    /* Saydam arka plan KAPALI ise zemin daima opaktır; renk 'none' ise
       kâğıt beyazı kullanılır (eski sürümde toggle tek başına etkisizdi). */
    const solid = !P.transparentBackground;
    const bgc = solid
      ? inkFxHexToRgb(P.bgColor === 'none' ? '#ffffff' : P.bgColor)
      : [255, 255, 255];
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      let a = edge[i];
      if (inv) a = 1 - a;
      if (inv || solid) {
        const top = inv ? bgc : lc;
        const bot = inv ? lc : bgc;
        out[p] = bot[0] * (1 - a) + top[0] * a;
        out[p + 1] = bot[1] * (1 - a) + top[1] * a;
        out[p + 2] = bot[2] * (1 - a) + top[2] * a;
        out[p + 3] = 255;
      } else {
        out[p] = lc[0]; out[p + 1] = lc[1]; out[p + 2] = lc[2];
        out[p + 3] = Math.round(a * 255);
      }
    }
    inkFxPutImageData(outCtx, { width: w, height: h, data: out });
  },
});

/* =========================================================
   19. POSTERIZATION (master spec Bölüm 19)
   ---------------------------------------------------------
   Kontrollü ton/renk kısıtlama: ton seviyeleri (luma) +
   kroma seviyeleri (colorReduction), kontrast/parlaklık/
   doygunluk, vurgu/gölge klipsi, kenar koruması (gradien
   karışımı), Bayer dither karışımı, palet tonlaması.
   ========================================================= */

inkFxRegister({
  id: 'posterization',
  label: 'Posterization',
  category: 'experimental',
  params: [
    { key: 'tonalLevels', label: 'Number of Tonal Levels', type: 'slider', min: 2, max: 16, step: 1, default: 5 },
    { key: 'colorReduction', label: 'Color Reduction', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'contrast', label: 'Contrast', type: 'slider', min: 0.5, max: 2, step: 0.05, default: 1.05 },
    { key: 'brightness', label: 'Brightness', type: 'slider', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { key: 'saturation', label: 'Saturation', type: 'slider', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'colorPalette', label: 'Color Palette', type: 'dropdown', default: 'original',
      options: ['original', 'warm', 'cool', 'grayscale'] },
    { key: 'edgePreservation', label: 'Edge Preservation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'ditherIntegration', label: 'Dither Integration', type: 'slider', min: 0, max: 1, step: 0.05, default: 0 },
    { key: 'colorMode', label: 'Color Mode', type: 'dropdown', default: 'color',
      options: ['color', 'mono'] },
    { key: 'highlightControl', label: 'Highlight Control', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.05 },
    { key: 'shadowControl', label: 'Shadow Control', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.05 },
  ],
  apply(outCtx, src, P, size) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const n = w * h;
    const stepsL = Math.max(1, Math.round(P.tonalLevels) - 1);
    const stepsC = Math.max(1, Math.round(stepsL * (1 - P.colorReduction * 0.7)));
    const mono = P.colorMode === 'mono' || P.colorPalette === 'grayscale';
    let edgeM = null;
    if (P.edgePreservation > 0.01) {
      const lum = inkFxLumOf(img);
      edgeM = new Float32Array(n);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          edgeM[i] = Math.min(1, (Math.abs(lum[i + 1] - lum[i - 1])
            + Math.abs(lum[i + w] - lum[i - w])) * 2);
        }
      }
    }
    const out = inkFxScratch(w, h, 'poster.out', n * 4);
    /* Sıcak döngü: fonksiyon çağrısı ve Math.min/max yerine satır içi
       kelepçe. Aritmetik birebir aynı (aynı çarpma/bölme sırası) →
       piksel çıktısı değişmez. */
    const contrast = P.contrast, brightness = P.brightness, sat = P.saturation;
    const hi = P.highlightControl, sh = P.shadowControl;
    const midShift = P.threshold - 0.5;
    const warm = P.colorPalette === 'warm', cool = P.colorPalette === 'cool';
    const ditherOn = P.ditherIntegration > 0.01;
    const ditherAmt = P.ditherIntegration;
    const edgeP = P.edgePreservation;
    for (let y = 0, i = 0, p = 0; y < h; y++) {
      const bayerRow = INK_DITHER_BAYER8[y % 8];
      for (let x = 0; x < w; x++, i++, p += 4) {
        const r0 = data[p] / 255, g0 = data[p + 1] / 255, b0 = data[p + 2] / 255;
        let r = (r0 - 0.5) * contrast + 0.5 + brightness;
        let g = (g0 - 0.5) * contrast + 0.5 + brightness;
        let b = (b0 - 0.5) * contrast + 0.5 + brightness;
        const lum0 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = lum0 + (r - lum0) * sat;
        g = lum0 + (g - lum0) * sat;
        b = lum0 + (b - lum0) * sat;
        /* mid-tone eşik kayması + vurgu/gölge klipsi (nötr pivot 0.5). */
        r = Math.min(1, Math.max(0, r + midShift));
        g = Math.min(1, Math.max(0, g + midShift));
        b = Math.min(1, Math.max(0, b + midShift));
        r = r > 1 - hi ? 1 : r < sh ? 0 : r;
        g = g > 1 - hi ? 1 : g < sh ? 0 : g;
        b = b > 1 - hi ? 1 : b < sh ? 0 : b;
        if (warm) { r = Math.min(1, r * 1.06); b *= 0.92; }
        else if (cool) { b = Math.min(1, b * 1.06); r *= 0.92; }
        /* Bayer dither karışımı */
        let dth = 0;
        if (ditherOn) {
          dth = (bayerRow[x % 8] / 64 - 0.5) * (0.8 / stepsL) * ditherAmt;
        }
        const lum1 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let t = lum1 + dth;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const lq = Math.round(t * stepsL) / stepsL;
        let qr, qg, qb;
        if (mono) { qr = qg = qb = lq; }
        else {
          const sc = lq / Math.max(0.02, lum1);
          t = r * sc + dth; if (t < 0) t = 0; else if (t > 1) t = 1;
          qr = Math.round(t * stepsC) / stepsC;
          t = g * sc + dth; if (t < 0) t = 0; else if (t > 1) t = 1;
          qg = Math.round(t * stepsC) / stepsC;
          t = b * sc + dth; if (t < 0) t = 0; else if (t > 1) t = 1;
          qb = Math.round(t * stepsC) / stepsC;
        }
        if (edgeM) {
          const ep = edgeP * edgeM[i];
          qr = qr * (1 - ep) + r0 * ep;
          qg = qg * (1 - ep) + g0 * ep;
          qb = qb * (1 - ep) + b0 * ep;
        }
        out[p] = qr * 255; out[p + 1] = qg * 255; out[p + 2] = qb * 255;
        out[p + 3] = data[p + 3];
      }
    }
    inkFxPutImageData(outCtx, { width: w, height: h, data: out });
  },
});

/* =========================================================
   20. COLOR HALATION (master spec Bölüm 20)
   ---------------------------------------------------------
   Analog ışıma: parlak alan maskesi (eşik + omuz +
   yumuşaklık) → çok geçişli bulanıklık (yayılma) → halo
   rengiyle screen karışımı (falloff profili), vurgu
   çekirdeği koruması, blendIntensity.
   ========================================================= */

inkFxRegister({
  id: 'color-halation',
  label: 'Color Halation',
  category: 'experimental',
  params: [
    { key: 'highlightThreshold', label: 'Highlight Threshold', type: 'slider', min: 0.4, max: 1, step: 0.01, default: 0.72 },
    { key: 'glowRadius', label: 'Glow Radius', type: 'slider', min: 1, max: 60, step: 1, default: 18 },
    { key: 'spreadAmount', label: 'Spread Amount', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'glowIntensity', label: 'Glow Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'halationColor', label: 'Halation Color', type: 'color', default: '#ff5a3c' },
    { key: 'colorSaturation', label: 'Color Saturation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'edgeSoftness', label: 'Edge Softness', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'highlightPreservation', label: 'Highlight Preservation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'blendIntensity', label: 'Blend Intensity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.8 },
    { key: 'falloff', label: 'Falloff', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'colorVariation', label: 'Color Variation', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'highlightMask', label: 'Highlight Mask', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  apply(outCtx, src, P, size, rng) {
    const w = size.w, h = size.h;
    const img = inkFxSrcData(src, w, h);
    if (!img) return;
    const data = img.data;
    const n = w * h;
    const lum = inkFxLumOf(img);
    const shoulder = 0.04 + P.highlightMask * 0.2 + P.edgeSoftness * 0.08;
    const mask = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      mask[i] = inkFxSmoothstep(P.highlightThreshold - shoulder,
        P.highlightThreshold + shoulder, lum[i]);
    }
    const passes = 1 + Math.round(P.spreadAmount * 3);
    const rad = Math.max(1, Math.round(P.glowRadius * (0.35 + P.spreadAmount * 0.5) / passes));
    const blurred = mask.slice();
    inkFxBoxBlurF32(blurred, w, h, rad, passes);
    for (let i = 0; i < n; i++) {
      blurred[i] = blurred[i] * (1 - P.falloff) + Math.sqrt(blurred[i]) * P.falloff;
    }
    const hc = inkFxHexToRgb(P.halationColor);
    const cellN = inkFxCoarseNoise(w, h, 12, rng);
    const out = inkFxScratch(w, h, 'halation.out', n * 4);
    const mix = Math.min(1, Math.max(0, P.blendIntensity));
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      let g = blurred[i] * P.glowIntensity;
      g *= 1 - P.highlightPreservation * inkFxSmoothstep(0.88, 1.0, lum[i]);
      const y = (i / w) | 0, x = i % w;
      const jx = (cellN.at(x, y) - 0.5) * P.colorVariation * 40;
      const sat = P.colorSaturation;
      const tr = (hc[0] + jx) * sat + data[p] * (1 - sat);
      const tg = (hc[1] + jx * 0.6) * sat + data[p + 1] * (1 - sat);
      const tb = (hc[2] - jx * 0.4) * sat + data[p + 2] * (1 - sat);
      /* screen: 1 − (1−src)(1−glow) */
      const aR = tr / 255 * g, aG = tg / 255 * g, aB = tb / 255 * g;
      const sr = 1 - (1 - data[p] / 255) * (1 - aR);
      const sg = 1 - (1 - data[p + 1] / 255) * (1 - aG);
      const sb = 1 - (1 - data[p + 2] / 255) * (1 - aB);
      out[p] = (data[p] / 255 * (1 - mix) + sr * mix) * 255;
      out[p + 1] = (data[p + 1] / 255 * (1 - mix) + sg * mix) * 255;
      out[p + 2] = (data[p + 2] / 255 * (1 - mix) + sb * mix) * 255;
      out[p + 3] = Math.min(255, data[p + 3] + g * 255 * 0.8);
    }
    inkFxPutImageData(outCtx, { width: w, height: h, data: out });
  },
});
