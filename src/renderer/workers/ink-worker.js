'use strict';

/* TailRef Studio — çizim raster worker'ı
   ------------------------------------------------------------------
   Ana iş parçacığı bir vuruşun etkilediği bölgenin mevcut pikselini
   `ImageBitmap` olarak gönderir; worker aynı fırça matematiğiyle vuruşu
   bu bitmap'in üzerine çizer ve sonucu geri yollar. Böylece ağır
   damla (dab) döngüsü UI iş parçacığını kilitlemez.

   Önemli: kompozisyon mevcut pikseller üzerinde yapılır. Yarı saydam
   vuruşlarda "önce katmana, sonra bitmap'e" çift karışma olmaz; sonuç
   doğrudan katmana çizmekle aynıdır. Silgi `destination-out` uygular.

   Mesaj sözleşmesi (ana iş parçacığı → worker):
     { id, stroke, width, height, mode, canvasW, canvasH,
       regionX, regionY, sizePx, pathEligible, erase,
       existing: ImageBitmap, tip?: ImageBitmap }
   Yanıt: { id, bitmap } veya { id, error }
   ========================================================= */

const TIP_SIZE = 128;
const TIP_MAX = 1024;
const PATH_MIN_HARDNESS = 0.85;
const PATH_MAX_PRESSURE_SPREAD = 0.12;

/** Prosedürel ucun üretileceği çözünürlük (ana iş parçacığıyla aynı kural). */
function tipRes(sizePx) {
  const need = Math.max(1, sizePx || 0);
  if (need <= TIP_SIZE) return TIP_SIZE;
  let res = TIP_SIZE;
  while (res < need && res < TIP_MAX) res *= 2;
  return Math.min(TIP_MAX, res);
}

function clamp(v, a, b) {
  return v < a ? a : (v > b ? b : v);
}

function strokeRandom(stroke, dabIndex, channel = 0) {
  let hash = 2166136261;
  const id = String(stroke && stroke.id || '');
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  }
  hash ^= Math.imul((dabIndex | 0) + 1, 0x9e3779b1);
  hash ^= Math.imul((channel | 0) + 1, 0x85ebca6b);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function hexToRgb(hex) {
  const s = String(hex || '').replace('#', '').trim();
  if (s.length === 3) {
    return [
      parseInt(s[0] + s[0], 16) || 255,
      parseInt(s[1] + s[1], 16) || 255,
      parseInt(s[2] + s[2], 16) || 255,
    ];
  }
  if (s.length === 6) {
    return [
      parseInt(s.slice(0, 2), 16) || 255,
      parseInt(s.slice(2, 4), 16) || 255,
      parseInt(s.slice(4, 6), 16) || 255,
    ];
  }
  return [255, 255, 255];
}

/** Ana iş parçacığındaki `inkProceduralTip` ile aynı radyal maske. */
function makeProceduralTip(hardness, color, erase, sizePx) {
  const size = tipRes(sizePx);
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d');
  const key = Math.round(clamp(hardness, 0, 1) * 100);
  const h = key / 100;
  const r = size / 2 - 1;
  const rgb = erase ? [255, 255, 255] : hexToRgb(color);
  const rgba = a => 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, r);
  const solid = clamp(h * 0.88, 0.01, 0.98);
  g.addColorStop(0, rgba(1));
  g.addColorStop(solid, rgba(h >= 0.99 ? 1 : 0.94));
  g.addColorStop(1, rgba(0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/* =========================================================
   yerel kütüphane uçları (ana thread 52-native-brush-library ile birebir)
   Uç üretimi worker'da da yapılır: böylece suluboya/tırmık/gürültü gibi
   dokulu uçlar worker'a taşınabilirken görsel kaybolmaz. Deterministik
   gürültü ana thread'deki inkNativeNoise ile aynıdır.
   ========================================================= */
function nativeNoise(x, y, salt) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^
    Math.imul((salt | 0), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  /* Bölen ana thread `inkNativeNoise` birebir: 4294967295 (2^32-1).
     4294967296 idi; her gürültü değerinde ~1/2^32 sapma üretip
     gürültü/tane eşiklerini (n > density) sınır piksellerinde ters
     çeviriyordu → worker ↔ senkron px sayısı farkı (probe: 208088 ↔
     220623). */
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function nativeTipCanvas(size) {
  const c = new OffscreenCanvas(size, size);
  return { canvas: c, ctx: c.getContext('2d'), size: size };
}

function makeCircleTip(sizePx, options, res) {
  const { canvas, ctx, size } = nativeTipCanvas(res);
  /* Ana thread `createCircleTip` birebir: boyut = çap (endüstri kuralı),
     varsayılan iç pay 0 — eski sabit `size/2 - 1` kenarda 1px şeffaf
     şerit bırakıp damga kenarını soluklatıyordu (diag9 V-tap kanıtı). */
  const inset = clamp(Number(options.inset) || 0, 0, 0.25) * size;
  const r = Math.max(1, size / 2 - inset);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fill();
  const edge = clamp(Number(options.edge) || 0, 0, 1);
  if (edge > 0) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, size * 0.02 * edge);
    ctx.strokeStyle = 'rgba(0,0,0,' + (0.35 * edge) + ')';
    ctx.stroke();
  }
  return canvas;
}

function makeSoftNativeTip(sizePx, options, res, hardness) {
  const { canvas, ctx, size } = nativeTipCanvas(res);
  const h = clamp(Number.isFinite(hardness) ? hardness : 0.28, 0, 1);
  const r = size / 2 - 1;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, r);
  const solid = clamp(h * 0.88, 0.01, 0.98);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(solid, 'rgba(255,255,255,' + (h >= 0.99 ? 1 : 0.94) + ')');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

function makeSquareTip(sizePx, options, res) {
  const { canvas, ctx, size } = nativeTipCanvas(res);
  const inset = clamp(Number(options.inset) || 0.06, 0, 0.25) * size;
  const radius = clamp(Number(options.radius) || 0, 0, 0.2) * size;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  if (radius > 0 && typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, radius);
    ctx.fill();
  } else {
    ctx.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  }
  return canvas;
}

function makeOvalTip(sizePx, options, res) {
  const { canvas, ctx, size } = nativeTipCanvas(res);
  const ratio = clamp(Number(options.ratio) || 0.3, 0.08, 1);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.ellipse(size / 2, size / 2, size * 0.46, size * 0.46 * ratio, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

function makeRakeTip(sizePx, options, res) {
  const { canvas, ctx, size } = nativeTipCanvas(res);
  const count = Math.round(clamp(Number(options.bristles) || 7, 3, 15));
  const spread = clamp(Number(options.spread) || 0.62, 0.25, 0.95);
  const barW = Math.max(1, size * 0.034);
  const step = count > 1 ? (size * spread) / (count - 1) : 0;
  const start = size / 2 - (size * spread) / 2;
  for (let i = 0; i < count; i++) {
    const wobble = 0.84 + 0.16 * nativeNoise(i, count, 17);
    const len = size * (0.55 + 0.2 * wobble);
    const x = start + step * i - barW / 2;
    const y = size / 2 - len / 2;
    ctx.fillStyle = 'rgba(255,255,255,' + (0.72 + 0.28 * wobble) + ')';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, barW, len, barW / 2);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, barW, len);
    }
  }
  return canvas;
}

function makeNoiseTip(sizePx, options, res) {
  const { canvas, ctx, size } = nativeTipCanvas(res);
  const density = clamp(Number(options.density) || 0.55, 0.05, 1);
  const edge = clamp(Number(options.edge) || 0.94, 0.45, 1);
  // Tohum: uç yığını varyantları farklı tane yerleşimi üretir.
  const salt = (Number.isFinite(options.seed) ? Math.round(options.seed) : 0) | 0;
  const r = size * 0.5 * edge;
  const cx = size / 2, cy = size / 2;
  const step = size > 320 ? 2 : 1;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const dx = x + step / 2 - cx;
      const dy = y + step / 2 - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const n = nativeNoise(x, y, 31 + salt);
      if (n > density) continue;
      const feather = clamp((r - d) / Math.max(1, size * 0.09), 0, 1);
      const alpha = (0.25 + 0.75 * nativeNoise(y, x, 73 + salt)) * feather;
      if (alpha <= 0.01) continue;
      ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
      ctx.fillRect(x, y, step, step);
    }
  }
  return canvas;
}

function makeWatercolorTip(sizePx, options, res) {
  const { canvas, ctx, size } = nativeTipCanvas(res);
  const core = clamp(Number.isFinite(options.core) ? options.core : 0.22, 0.02, 0.55);
  const ring = clamp(Number.isFinite(options.ring) ? options.ring : 0.76, 0.5, 0.94);
  const edge = clamp(Number.isFinite(options.edge) ? options.edge : 0.42, 0.08, 0.8);
  const seed = Number.isFinite(options.seed) ? Math.round(options.seed) : 0;
  const phaseA = seed * 0.71, phaseB = seed * 1.31 + 0.9, phaseC = seed * 2.17;
  const radius = Math.max(1, size / 2 - 1);
  const image = ctx.createImageData(size, size);
  const smooth = v => {
    const t = clamp(v, 0, 1);
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - size / 2) / radius;
      const dy = (y + 0.5 - size / 2) / radius;
      const angle = Math.atan2(dy, dx);
      const roughness =
        0.025 * Math.sin(angle * 4 + 0.7 + phaseA) +
        0.016 * Math.sin(angle * 9 - 1.3 + phaseB) +
        0.01 * (nativeNoise((x / 5) | 0, (y / 5) | 0, 53 + (seed % 97)) - 0.5);
      const boundary = 0.95 + roughness;
      const distance = Math.hypot(dx, dy) / boundary;
      let alpha = 0;
      if (distance < 1) {
        const wash = core * (0.62 + 0.7 * smooth(distance / 0.9));
        const pigmentRim = edge *
          smooth((distance - ring) / Math.max(0.02, 0.92 - ring)) *
          (1 - smooth((distance - 0.92) / 0.08));
        const grain = 0.86 + 0.14 * nativeNoise(
          (x >> 2) + phaseC, (y >> 2) + phaseC, 97);
        alpha = Math.max(wash, pigmentRim) * grain;
      }
      const i = (y * size + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function makeHalftoneTip(sizePx, options, res) {
  const { canvas, ctx, size } = nativeTipCanvas(res);
  const dot = clamp(Number(options.dot) || 0.055, 0.015, 0.2) * size;
  const gap = clamp(Number(options.gap) || 0.13, 0.05, 0.4);
  const r = size * 0.46;
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  let row = 0;
  for (let y = size * 0.06; y <= size * 0.94; y += gap * size) {
    const offset = row % 2 ? gap * size / 2 : 0;
    for (let x = size * 0.06 + offset; x <= size * 0.94; x += gap * size) {
      const dx = x - size / 2, dy = y - size / 2;
      if (Math.hypot(dx, dy) > r) continue;
      ctx.beginPath();
      ctx.arc(x, y, dot, 0, Math.PI * 2);
      ctx.fill();
    }
    row++;
  }
  ctx.restore();
  return canvas;
}

/* Worker tarafı uç önbelleği: anahtar tür+seçenekler+sertlik+varyant. */
const nativeTipWorkerCache = new Map();
const NATIVE_TIP_WORKER_LIMIT = 48;

function makeNativeTip(kind, options, res, hardness, variant, tipSeed) {
  const opts = options && typeof options === 'object' ? options : {};
  let key = kind + '@' + res + '|' + JSON.stringify(opts);
  if (kind === 'soft') key += '|h' + Math.round(clamp(hardness, 0, 1) * 100);
  if (variant > 0) key += '|v' + variant;
  const cached = nativeTipWorkerCache.get(key);
  if (cached) {
    nativeTipWorkerCache.delete(key);
    nativeTipWorkerCache.set(key, cached);
    return cached;
  }
  const optsWithSeed = Object.assign({}, opts);
  if (variant > 0 && (kind === 'watercolor' || kind === 'noise')) {
    optsWithSeed.seed = (Number.isFinite(tipSeed) ? tipSeed : 0) + variant * 7919;
  }
  let canvas;
  switch (kind) {
    case 'soft': canvas = makeSoftNativeTip(res, optsWithSeed, res, hardness); break;
    case 'square': canvas = makeSquareTip(res, optsWithSeed, res); break;
    case 'oval': canvas = makeOvalTip(res, optsWithSeed, res); break;
    case 'rake': canvas = makeRakeTip(res, optsWithSeed, res); break;
    case 'noise': canvas = makeNoiseTip(res, optsWithSeed, res); break;
    case 'watercolor': canvas = makeWatercolorTip(res, optsWithSeed, res); break;
    case 'halftone': canvas = makeHalftoneTip(res, optsWithSeed, res); break;
    case 'circle':
    default: canvas = makeCircleTip(res, optsWithSeed, res); break;
  }
  nativeTipWorkerCache.set(key, canvas);
  while (nativeTipWorkerCache.size > NATIVE_TIP_WORKER_LIMIT) {
    nativeTipWorkerCache.delete(nativeTipWorkerCache.keys().next().value);
  }
  return canvas;
}

function lerpAngle(a, b, t) {
  let d = (b || 0) - (a || 0);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return (a || 0) + d * t;
}

/* K17 · centripetal Catmull-Rom: ana iş parçacığı inkCatmull birebir
   (mirror). knot aralığı komşu mesafenin karekökü (α=0.5); Bezier
   formu b0=p1, b3=p2 — k1 = d12/((d01+d12)·3), k2 = d12/((d12+d23)·3).
   Uçlar garanti: q(0)=p1, q(1)=p2; NaN asla. */
function catmull(p0, p1, p2, p3, t, sx, sy) {
  const gx = typeof sx === 'number' && Number.isFinite(sx) && sx > 0 ? sx : 1;
  const gy = typeof sy === 'number' && Number.isFinite(sy) && sy > 0 ? sy : 1;
  const d01 = Math.max(1e-6, Math.sqrt(Math.hypot((p1.x - p0.x) * gx, (p1.y - p0.y) * gy)));
  const d12 = Math.max(1e-6, Math.sqrt(Math.hypot((p2.x - p1.x) * gx, (p2.y - p1.y) * gy)));
  const d23 = Math.max(1e-6, Math.sqrt(Math.hypot((p3.x - p2.x) * gx, (p3.y - p2.y) * gy)));
  const w1 = d12 / ((d01 + d12) * 3);
  const w2 = d12 / ((d12 + d23) * 3);
  const tx = (1 - t) * (1 - t) * (1 - t);
  const ty = 3 * (1 - t) * (1 - t) * t;
  const tz = 3 * (1 - t) * t * t;
  const tw = t * t * t;
  return {
    x: p1.x * tx + (p1.x + (p2.x - p0.x) * w1) * ty + (p2.x - (p3.x - p1.x) * w2) * tz + p2.x * tw,
    y: p1.y * tx + (p1.y + (p2.y - p0.y) * w1) * ty + (p2.y - (p3.y - p1.y) * w2) * tz + p2.y * tw,
  };
}

/* K18 · sigmoid basınç: ana iş parçacığı inkSigmoid01 birebir (mirror). */
const SIGMOID_LO = 1 / (1 + Math.exp(3));
const SIGMOID_SPAN = 1 / (1 + Math.exp(-3)) - SIGMOID_LO;
function sigmoid01(t) {
  return (1 / (1 + Math.exp(-6 * (t - 0.5))) - SIGMOID_LO) / SIGMOID_SPAN;
}

function forEachDab(points, spacingPx, cb, scale, options = {}) {
  if (!points || !points.length) return;
  const spacing = Math.max(0.6, spacingPx || 1);
  // Yerel (0..1) nokta uzayını piksel aralığıyla eşleştir; aksi halde uzun
  // segmentlere tek damla düşer ve hızlı/ince vuruş noktalanır.
  let sx = 1, sy = 1;
  if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) {
    sx = sy = scale;
  } else if (scale && typeof scale === 'object') {
    const kx = Number(scale.x), ky = Number(scale.y);
    if (Number.isFinite(kx) && kx > 0) sx = kx;
    if (Number.isFinite(ky) && ky > 0) sy = ky;
  }
  const spacingJitter = clamp(Number(options.spacingJitter) || 0, 0, 1);
  const taperStartPx = Math.max(0, Number(options.taperStartPx) || 0);
  const taperEndPx = options.stableOnly ? 0 : Math.max(0, Number(options.taperEndPx) || 0);
  const progressOffsetPx = Math.max(0, Number(options.progressOffsetPx) || 0);
  /* K16 · yay-uzunluğu emisyon: ana iş parçacığı `inkForEachDab` birebir.
     Damlalar sabit ds=spacing mesafesiyle çıkar; carry segmentler
     arası taşınır (girdi frekansından bağımsız). Kuyruk bitiş damlası
     stableOnly'de eklenmez. */
  let spacingRemainder = spacing;
  let lastContinuousPoint = points[0];
  const cumulative = new Float64Array(points.length);
  let totalLengthPx = 0;
  for (let i = 1; i < points.length; i++) {
    if (!points[i].br) {
      totalLengthPx += Math.hypot((points[i].x - points[i - 1].x) * sx, (points[i].y - points[i - 1].y) * sy);
    }
    cumulative[i] = totalLengthPx;
  }
  if (Number.isFinite(options.totalLengthPx)) totalLengthPx = Math.max(totalLengthPx, options.totalLengthPx);
  /* K16.d · tap muafiyeti: ana iş parçacığı birebir — baştan etkin,
     ≥ 1px segment görülünce kesilir (K15 paritesi). */
  let tapLike = true;
  for (let i = 1; i < points.length; i++) {
    if (!points[i].br && cumulative[i] - cumulative[i - 1] >= 1) {
      tapLike = false;
      break;
    }
  }
  const tStartPx = tapLike ? 0 : taperStartPx;
  const tEndPx = tapLike ? 0 : taperEndPx;
  const taper = progressPx => {
    let factor = 1;
    if (tStartPx > 0) {
      const t = clamp((progressOffsetPx + progressPx) / tStartPx, 0, 1);
      factor = Math.min(factor, t * t * (3 - 2 * t));
    }
    if (tEndPx > 0) {
      const t = clamp((totalLengthPx - progressOffsetPx - progressPx) / tEndPx, 0, 1);
      factor = Math.min(factor, t * t * (3 - 2 * t));
    }
    return factor;
  };
  if (!points[0].br) {
    const first = Object.assign({}, points[0]);
    first.k = taper(0);
    cb(first, first.p, 0);
    lastContinuousPoint = first;
  }
  if (points.length === 1) return;
  let index = 1;
  const segmentLimit = options.stableOnly
    ? Math.max(0, points.length - 2)
    : points.length - 1;
  for (let i = 0; i < segmentLimit; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (p2.br) {
      const broken = Object.assign({}, p2);
      broken.k = taper(cumulative[i + 1]);
      cb(broken, broken.p, index++);
      lastContinuousPoint = broken;
      spacingRemainder = spacing;
      continue;
    }
    const p0 = p1.br ? p1 : points[Math.max(0, i - 1)];
    const after = points[i + 2];
    const p3 = after && !after.br ? after : p2;
    const dist = Math.hypot((p2.x - p1.x) * sx, (p2.y - p1.y) * sy);
    if (dist <= 0) continue;
    const pa = Number.isFinite(p1.p) ? p1.p : 1;
    const pb = Number.isFinite(p2.p) ? p2.p : 1;
    const sa = Number.isFinite(p1.s) ? p1.s : 0;
    const sb = Number.isFinite(p2.s) ? p2.s : 0;
    const ta = p1.t || 0;
    const tb = p2.t || 0;
    const tilted = ta > 0 || tb > 0;
    let traveled = spacingRemainder;
    while (traveled <= dist) {
      // spacingJitter: slot konumu sabit; damla ±jitter·spacing/2
      // kayar (kanal 6 — ana iş parçacığı birebir aynı).
      let t = traveled / dist;
      if (spacingJitter > 0) {
        t = clamp(t + (strokeRandom(options.stroke || {}, index, 6) - 0.5) *
          spacingJitter * spacing / dist, 0.001, 0.999);
      }
      const q = catmull(p0, p1, p2, p3, t, sx, sy);
      q.k = taper(cumulative[i] + dist * t);
      // K18 · sigmoid basınç (ana iş parçacığı birebir).
      q.p = pa + (pb - pa) * sigmoid01(t);
      q.s = sa + (sb - sa) * t;
      if (tilted) {
        q.t = ta + (tb - ta) * t;
        q.a = lerpAngle(p1.a || 0, p2.a || 0, t);
      }
      cb(q, q.p, index++);
      lastContinuousPoint = q;
      traveled += spacing;
    }
    spacingRemainder = traveled - dist;
  }
  const lastPoint = points[points.length - 1];
  if (!options.stableOnly && !lastPoint.br &&
      (!lastContinuousPoint ||
       Math.hypot((lastPoint.x - lastContinuousPoint.x) * sx,
         (lastPoint.y - lastContinuousPoint.y) * sy) > 0.001)) {
    const last = Object.assign({}, lastPoint);
    last.k = taper(totalLengthPx);
    cb(last, last.p, index);
  }
}

/* EVRE 2 · native damla tüketicisi: ana süreçteki C++ çekirdeği
   (inkcore dabList) stride 9 kayıt üretir: [x, y, k, p, s, t, a, br,
   tilted]. JS'teki yokluk semantiği korunur: p/s/t/a NaN ise undefined,
   br 0 ise undefined — böylece pas-geç dablarda Object.assign({}, nokta)
   davranışı birebir eşleşir. cb'nin ikinci argümanı ham p (JS emitter
   ile aynı: cb(q, q.p, index)). */
function forEachRecordDab(records, count, cb) {
  if (!records || !(count > 0)) return;
  for (let i = 0; i < count; i++) {
    const b = i * 9;
    const p = records[b + 3], s = records[b + 4],
      t = records[b + 5], a = records[b + 6];
    cb({
      x: records[b],
      y: records[b + 1],
      k: records[b + 2],
      p: Number.isFinite(p) ? p : undefined,
      s: Number.isFinite(s) ? s : undefined,
      t: Number.isFinite(t) ? t : undefined,
      a: Number.isFinite(a) ? a : undefined,
      br: records[b + 7] !== 0 ? true : undefined,
    }, Number.isFinite(p) ? p : undefined, i);
  }
}

function drawTiltedStamp(ctx, image, x, y, radius, tilt, angle, roundness,
  flipX = false, flipY = false) {
  const round = Number.isFinite(roundness) ? clamp(roundness, 0.05, 1) : 1;
  const squash = round * (tilt > 0.02 ? 1 - 0.55 * clamp(tilt, 0, 1) : 1);
  const rot = Number.isFinite(angle) ? angle : 0;
  const fx = flipX ? -1 : 1;
  const fy = flipY ? -1 : 1;
  if (squash >= 0.995 && Math.abs(rot) < 0.004 && fx === 1 && fy === 1) {
    ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(fx, fy * squash);
  ctx.drawImage(image, -radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}

/* Ana iş parçacığındaki damga atlasıyla aynı kovalar: uç, kova boyutunda
   bir kez önceden ölçeklenir, sonra damla başına yalnızca drawImage kalır.
   Bu, worker çıktısının senkron yolla (geri al sonrası kısmi tazeleme)
   birebir aynı görünmesini sağlar. */
const STAMP_BUCKETS = [16, 32, 64, 128, 256, 512, 1024];

function stampBucket(sizePx) {
  const need = Math.max(1, sizePx || 1);
  for (let i = 0; i < STAMP_BUCKETS.length; i++) {
    if (STAMP_BUCKETS[i] >= need) return STAMP_BUCKETS[i];
  }
  return STAMP_BUCKETS[STAMP_BUCKETS.length - 1];
}

function makeStamp(tip, bucket) {
  const c = new OffscreenCanvas(bucket, bucket);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tip, 0, 0, bucket, bucket);
  return c;
}

/* Ana thread `inkTintedTip` ile birebir: beyaz maske ucunu vuruş rengiyle
   boyar (source-in). Native/prosedürel uç beyaz üretildiği için tonlama
   yapılmazsa worker vuruşları BEYAZ basıyordu (sync renkli basarken). */
const tintedTipWorkerCache = new Map();
const TINTED_TIP_WORKER_LIMIT = 64;

function tintedTip(whiteTip, color, cacheKey) {
  const key = (cacheKey || '') + '@' + String(color || '#ffffff');
  const cached = tintedTipWorkerCache.get(key);
  if (cached) {
    tintedTipWorkerCache.delete(key);
    tintedTipWorkerCache.set(key, cached);
    return cached;
  }
  const c = new OffscreenCanvas(whiteTip.width, whiteTip.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(whiteTip, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = String(color || '#ffffff');
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-over';
  tintedTipWorkerCache.set(key, c);
  while (tintedTipWorkerCache.size > TINTED_TIP_WORKER_LIMIT) {
    tintedTipWorkerCache.delete(tintedTipWorkerCache.keys().next().value);
  }
  return c;
}

/* Ana iş parçacığındaki `inkTextureGrain` ile aynı deterministik gürültü.
   Doku fırçalarında worker ve senkron raster aynı pikseli üretmeli. */
function textureNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const hash = (ix, iy) => {
    let n = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/* Ana thread'deki inkTextureGrain ile birebir: doku gürültüsü türü
   ('canvas'/'sand'/'paper') ve parlaklık/kontrast dahil. */
function grainFor(x, y, sizePx, depth, scale, textureId, brightness, contrast, eachTip, seed) {
  const size = Math.max(1, Number.isFinite(sizePx) ? sizePx : 1);
  const s = clamp(Number.isFinite(scale) ? scale : 1, 0.05, 16);
  const localScale = eachTip ? Math.max(1, size * 0.5) : Math.max(2.5, size * 0.14);
  const px = (x || 0) / localScale * s + (eachTip ? seed * 31.7 : 0);
  const py = (y || 0) / localScale * s + (eachTip ? seed * 17.3 : 0);
  let n;
  if (textureId === 'canvas') {
    const warp = Math.sin(px * 2.4) * Math.sin(py * 2.4);
    n = 0.52 + warp * 0.3 + (textureNoise(px * 3, py * 3) - 0.5) * 0.36;
  } else if (textureId === 'sand') {
    n = textureNoise(px * 6.5, py * 6.5) * 0.72 +
      textureNoise(px * 2, py * 2) * 0.28;
  } else {
    n = textureNoise(px, py) * 0.68 +
      textureNoise(px * 2.7 + 11, py * 2.7 - 7) * 0.32;
  }
  const c = clamp(Number.isFinite(contrast) ? contrast : 1, 0.25, 3);
  n = clamp((n - 0.5) * c + 0.5 + clamp(Number(brightness) || 0, -1, 1), 0, 1);
  const d = clamp(Number.isFinite(depth) ? depth : 0.26, 0, 1);
  return 1 - d * (1 - n);
}

function textureGrain(x, y, sizePx, depth, scale) {
  const size = Math.max(1, Number.isFinite(sizePx) ? sizePx : 1);
  const s = clamp(Number.isFinite(scale) ? scale : 1, 0.05, 16);
  const freq = s / Math.max(2.5, size * 0.14);
  const n = textureNoise((x || 0) * freq, (y || 0) * freq);
  const d = clamp(Number.isFinite(depth) ? depth : 0.26, 0, 1);
  return 1 - d * (1 - n);
}

function pathEligible(job) {
  if (job.pathEligible === undefined) return false;
  return !!job.pathEligible;
}

function drawStrokeAsPath(ctx, job, map, sizePx) {
  const stroke = job.stroke;
  const pts = [];
  for (let i = 0; i < stroke.points.length; i++) {
    const q = map(stroke.points[i]);
    if (!q) continue;
    pts.push({ x: q.x, y: q.y, p: clamp(stroke.points[i].p, 0.02, 1) });
  }
  if (!pts.length) return;

  const baseAlpha = clamp(stroke.opacity, 0, 1);
  ctx.globalAlpha = baseAlpha >= 0.999 ? 1 : 1 - Math.pow(1 - baseAlpha, 3);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pts.length === 1) {
    const radius = Math.max(0.35, (sizePx / 2) * (0.18 + 0.82 * pts[0].p));
    const bucket = stampBucket(radius * 2);
    const tip = job.tip || makeProceduralTip(1, stroke.color, job.erase, bucket);
    const stamp = makeStamp(tip, bucket);
    ctx.drawImage(stamp, pts[0].x - radius, pts[0].y - radius, radius * 2, radius * 2);
    return;
  }

  let sum = 0;
  for (let i = 0; i < pts.length; i++) sum += pts[i].p;
  const mean = sum / pts.length;
  ctx.lineWidth = Math.max(0.5, sizePx * (0.18 + 0.82 * mean));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(
        pts[i].x, pts[i].y,
        (pts[i].x + pts[i + 1].x) / 2,
        (pts[i].y + pts[i + 1].y) / 2
      );
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
}

function drawShape(ctx, job, map, sizePx) {
  const stroke = job.stroke;
  const pts = stroke.points;
  const a = map(pts[0]);
  const b = map(pts[pts.length - 1]);
  if (!a || !b) return;
  const color = stroke.color || '#fff';
  const lw = Math.max(1, sizePx * (stroke.shape === 'highlight' ? 2.5 : 0.22));

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = stroke.shape === 'highlight' ? 'butt' : 'round';
  ctx.lineJoin = 'round';

  if (stroke.shape === 'highlight') {
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = Math.max(6, sizePx * 2.2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    return;
  }

  ctx.globalAlpha = 1;
  if (stroke.shape === 'rect') {
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    return;
  }
  if (stroke.shape === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      (a.x + b.x) / 2, (a.y + b.y) / 2,
      Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2,
      0, 0, Math.PI * 2
    );
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.max(9, lw * 4.2);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - Math.cos(ang - 0.45) * head, b.y - Math.sin(ang - 0.45) * head);
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - Math.cos(ang + 0.45) * head, b.y - Math.sin(ang + 0.45) * head);
  ctx.stroke();
}

/* =========================================================
   OKLCH renk hattı (FAZ4-2/6) — src/app/56-ink-color.js birebir.
   Renk dinamikleri ve ıslak kenar worker'da da aynı per-damla
   rengi üretmeli; senkron yol (28 + 56) davranış kaynağıdır.
   ========================================================= */

/** Gamma 8-bit (0..255) → lineer (0..1). */
function inkSrgbToLin(c255) {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

var inkLinTable = null;
var inkGamutTable = null;

function inkLinLut() {
  if (!inkLinTable) {
    inkLinTable = new Float64Array(256);
    for (let i = 0; i < 256; i++) inkLinTable[i] = inkSrgbToLin(i);
  }
  return inkLinTable;
}

/** Lineer (0..1) → gamma 8-bit (0..255, yuvarlanmış, sıkıştırılmış). */
function inkLinToSrgb(lin) {
  const c = inkGamutClamp01(lin);
  const g = c <= 0.0031308
    ? c * 12.92
    : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(g * 255);
}

function inkLinToSrgbLut() {
  if (!inkGamutTable) {
    /* 65536 adım: karanlık teede lin-grid adımı γ-birimi kapsamaz. */
    const N = 65536;
    inkGamutTable = new Uint8Array(N + 1);
    for (let j = 0; j <= N; j++) inkGamutTable[j] = inkLinToSrgb(j / N);
  }
  return inkGamutTable;
}

/* Gamut sıkıştırma: gerçek sınır değerler (negatif/NaN → 0, taşma → 1). */
function inkGamutClamp01(v) {
  if (!(v > 0)) return 0;   /* NaN dahil → 0 */
  if (v >= 1) return 1;
  return v;
}

/** '#rrggbb' → lineer {r,g,b} (0..1). Hatalı girdi → beyaz. */
function inkHexToLinear(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return { r: 1, g: 1, b: 1 };
  const n = parseInt(m[1], 16);
  return {
    r: inkLinLut()[(n >> 16) & 255],
    g: inkLinLut()[(n >> 8) & 255],
    b: inkLinLut()[n & 255],
  };
}

/** lineer {r,g,b} → '#rrggbb' (8-bit, sıkıştırılmış). */
function inkLinearToHex(c) {
  const t = inkLinToSrgbLut();
  const to = v => {
    const j = Math.round(inkGamutClamp01(v) * 65535);
    return t[j > 65535 ? 65535 : j < 0 ? 0 : j]
      .toString(16).padStart(2, '0');
  };
  return '#' + to(c.r) + to(c.g) + to(c.b);
}

/** Doğrusal sRGB (0..1) → OKLab {L,a,b}. */
function inkLinearToOkLab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

/** OKLab {L,a,b} → doğrusal sRGB {r,g,b}. */
function inkOkLabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  };
}

function inkHexToOkLab(hex) {
  const c = inkHexToLinear(hex);
  return inkLinearToOkLab(c.r, c.g, c.b);
}

function inkOkLabToHex(L, a, b) {
  return inkLinearToHex(inkOkLabToLinear(L, a, b));
}

function inkOkLabToOkLch(L, a, b) {
  const c = Math.hypot(a, b);
  let h = Math.atan2(b, a) * 180 / Math.PI;
  if (!(h >= 0)) h += 360;              /* -0°-ları 360'a sar */
  if (h >= 360) h -= 360;
  return { l: L, c, h };
}

function inkOkLchToOkLab(l, c, h) {
  const rad = h * Math.PI / 180;
  return { L: l, a: Math.cos(rad) * c, b: Math.sin(rad) * c };
}

function inkHexToOkLch(hex) {
  const lab = inkHexToOkLab(hex);
  return inkOkLabToOkLch(lab.L, lab.a, lab.b);
}

/** OKLCH → sRGB baytları {r,g,b} (56-ink-color.js inkOkLchToBytes birebir). */
function inkOkLchToBytes(l, c, h) {
  const lab = inkOkLchToOkLab(
    inkGamutClamp01(l),
    Math.min(0.35, Math.max(0, c)),
    h);
  const lin = inkOkLabToLinear(lab.L, lab.a, lab.b);
  const t = inkLinToSrgbLut();
  const to = v => {
    const j = Math.round(inkGamutClamp01(v) * 65535);
    return t[j > 65535 ? 65535 : j < 0 ? 0 : j];
  };
  return { r: to(lin.r), g: to(lin.g), b: to(lin.b) };
}

/* 56'daki ikinci (etkin) inkOkLchToHex tanımı: bayt hattından hex. */
function inkOkLchToHex(l, c, h) {
  const b = inkOkLchToBytes(l, c, h);
  return '#' + [b.r, b.g, b.b].map(n => n.toString(16).padStart(2, '0')).join('');
}

/* Ana thread inkColorToOkLch birebir. */
function colorToOkLch(hex) {
  const value = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!value) return { l: 1, c: 0, h: 0 };
  return inkHexToOkLch('#' + value[1]);
}

/* Ana thread inkPrepareStrokeColor birebir (dynamics = brush.colorDynamics). */
function prepareStrokeColor(stroke, dynamics) {
  if (!dynamics) return null;
  if (!(dynamics.foregroundBackground || dynamics.hueJitter ||
      dynamics.saturationJitter || dynamics.brightnessJitter || dynamics.purity)) {
    return null;
  }
  const foreground = colorToOkLch(stroke.color || '#ffffff');
  const background = colorToOkLch(dynamics.background || '#ffffff');
  return {
    dynamics,
    foreground,
    hueDelta: (background.h - foreground.h + 540) % 360 - 180,
    chromaDelta: background.c - foreground.c,
    lightnessDelta: background.l - foreground.l,
  };
}

/* Ana thread inkStrokeColor birebir (randomIndex = dabIndex*16 + stampIndex).
   Kanallar: 32 mix, 33 hue, 34 chroma, 35 lightness (sync davranışı). */
function dabStrokeColor(stroke, dynamics, dabIndex, prepared) {
  dynamics = prepared ? prepared.dynamics : dynamics;
  if (!dynamics || !(dynamics.foregroundBackground || dynamics.hueJitter ||
      dynamics.saturationJitter || dynamics.brightnessJitter || dynamics.purity)) {
    return stroke.color || '#ffffff';
  }
  const foreground = prepared ? prepared.foreground :
    colorToOkLch(stroke.color || '#ffffff');
  const background = prepared ? null : colorToOkLch(dynamics.background || '#ffffff');
  const hueDelta = prepared ? prepared.hueDelta :
    (background.h - foreground.h + 540) % 360 - 180;
  const chromaDelta = prepared ? prepared.chromaDelta : background.c - foreground.c;
  const lightnessDelta = prepared ? prepared.lightnessDelta : background.l - foreground.l;
  const mix = strokeRandom(stroke, dabIndex, 32) *
    clamp(dynamics.foregroundBackground || 0, 0, 1);
  const hue = foreground.h + hueDelta * mix +
    (strokeRandom(stroke, dabIndex, 33) * 2 - 1) *
      (dynamics.hueJitter || 0) * 180;
  let chroma = (foreground.c + chromaDelta * mix) *
    (1 + (strokeRandom(stroke, dabIndex, 34) * 2 - 1) *
      (dynamics.saturationJitter || 0));
  let lightness = (foreground.l + lightnessDelta * mix) *
    (1 + (strokeRandom(stroke, dabIndex, 35) * 2 - 1) *
      (dynamics.brightnessJitter || 0));
  chroma = chroma * (1 - (dynamics.purity || 0)) +
    (dynamics.purity || 0) * 0.27;   /* sRGB ortalama chroma tavanı */
  return inkOkLchToHex(clamp(lightness, 0, 1), clamp(chroma, 0, 0.35),
    (hue % 360 + 360) % 360);
}

/* Ana thread inkWetEdge birebir: kenar koyulaştırma OKLCH'de L*0.48,
   chroma/hue korunur; gövde ctx.ellipse stroke (alpha = a*strength*0.55). */
function wetEdge(ctx, x, y, radius, roundness, angle, color, strength, alpha) {
  const amount = clamp(Number(strength) || 0, 0, 1);
  if (!amount) return;
  const lch = colorToOkLch(color);
  const edge = inkOkLchToHex(clamp(lch.l * 0.48, 0, 1), lch.c, lch.h);
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = clamp(alpha * amount * 0.55, 0, 1);
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(0.65, radius * 0.12 * amount);
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(0.5, radius * 0.94),
    Math.max(0.5, radius * clamp(roundness, 0.05, 1) * 0.94), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* Ana thread inkLinData birebir: tamsayı girdi LUT değeri, kesirli
   girdi bitişik iki LUT girişi arasında doğrusal ara (smudge pickup). */
function inkLinData(c255) {
  const t = inkLinLut();
  const x = c255 >= 255 ? 255 : c255 <= 0 ? 0 : c255;
  const i0 = Math.floor(x), f = x - i0;
  if (!f) return t[i0];
  const i1 = Math.min(255, i0 + 1);
  return t[i0] + (t[i1] - t[i0]) * f;
}

/** Piksel döngüsü hız yolu: lineer → gamma 8-bit (yakın indeks).
 *  (56-ink-color.js inkGamutData birebir — smudge inkDabOverChannel.) */
function inkGamutData(lin) {
  const t = inkLinToSrgbLut();
  const j = Math.round(inkGamutClamp01(lin) * 65535);
  return t[j > 65535 ? 65535 : j < 0 ? 0 : j];
}

/** source-over tek piksel (56-ink-color.js inkDabOverChannel birebir):
 *  hedef gamma 8-bit + düz alfa; kaynak lineer + düz alfa; karışım
 *  LINEER uzamda (muddy yok). */
function inkDabOverChannel(bgByte, bgA, srcLin, srcA, amount) {
  const keep = bgA * (1 - amount);
  const add = srcA * amount;
  const outA = keep + add;
  if (!(outA > 0)) return 0;
  const out = (inkLinData(bgByte) * keep + srcLin * add) / outA;
  return inkGamutData(out);
}

/** Damla yarıçapı (28-ink-brush.js inkDabRadius birebir — smudge paying
 *  aynı matematiği kullanır). */
function dabRadius(dyn, sizePx, driver, speed, speedSize, minRadius) {
  const spread = Math.max(0, dyn.sizeMax - dyn.sizeMin);
  let factor = dyn.sizeMin + spread * clamp(Number.isFinite(driver) ? driver : 1, 0, 1);
  const s = clamp(Number.isFinite(speed) ? speed : 0, 0, 1);
  const amount = clamp(Number.isFinite(speedSize) ? speedSize : 0, 0, 0.8);
  if (amount > 0) factor *= Math.max(0.2, 1 - amount * s);
  const floor = Number.isFinite(minRadius) ? Math.max(0.35, minRadius) : 0.35;
  return Math.max(floor, (sizePx / 2) * factor);
}

/* =========================================================
   smudge — ana thread inkDrawSmudgeOnContext birebir
   (FAZ4-3: worker taşınması; bölge == senkron smudge kutusu olduğundan
   region-local koordinatlar birebir eşleşir)
   ========================================================= */
function drawSmudge(ctx, job) {
  const stroke = job.stroke;
  if (!stroke || !stroke.points || !stroke.points.length) return;
  const sizePx = Math.max(1, job.sizePx || 1);
  const radiusMax = sizePx / 2;
  const map = job.mode === 'attached'
    ? (p => ({ x: p.x * job.canvasW - job.regionX, y: p.y * job.canvasH - job.regionY }))
    : (p => ({ x: p.x - job.regionX, y: p.y - job.regionY }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of stroke.points) {
    const mapped = map(point);
    if (!mapped || !Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) continue;
    minX = Math.min(minX, mapped.x);
    minY = Math.min(minY, mapped.y);
    maxX = Math.max(maxX, mapped.x);
    maxY = Math.max(maxY, mapped.y);
  }
  if (!Number.isFinite(minX)) return;
  const width = Math.max(1, Math.round(job.width || 1));
  const height = Math.max(1, Math.round(job.height || 1));
  const x0 = Math.max(0, Math.floor(minX - radiusMax - 2));
  const y0 = Math.max(0, Math.floor(minY - radiusMax - 2));
  const x1 = Math.min(width, Math.ceil(maxX + radiusMax + 2));
  const y1 = Math.min(height, Math.ceil(maxY + radiusMax + 2));
  if (x1 <= x0 || y1 <= y0) return;

  const image = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const data = image.data;
  const bw = image.width;
  const bh = image.height;
  const dyn = job.dyn && Number.isFinite(job.dyn.sizeMin) && Number.isFinite(job.dyn.sizeMax)
    ? job.dyn
    : { sizeMin: 0.18, sizeMax: 1, src: 'pressure', angleJitter: 0, scatterJitter: 0,
        spacingJitter: 0, opacityMin: 0.35, opacityJitter: 0, opacitySrc: '',
        sizeJitter: 0, roundnessJitter: 0, roundnessMin: 0.05 };
  const flow = clamp(Number.isFinite(stroke.flow) ? stroke.flow : 0.32, 0.01, 1);
  const flowJitter = clamp(Number.isFinite(stroke.flowJitter) ? stroke.flowJitter : 0, 0, 1);
  const strength = clamp(stroke.opacity, 0, 1) * flow;
  const maskResolution = 1024;
  const radialMask = new Float32Array(maskResolution + 1);
  // Sertlik: vuruş sertliği yoksa fırça sertliği (job'dan, 28 sömantüği:
  // (brush && brush.hardness) || 0.72; 35'te job.brushHardness önceden
  // hesaplanır), o da yoksa 0.72.
  const hardness = clamp(Number.isFinite(stroke.hardness)
    ? stroke.hardness : (Number.isFinite(job.brushHardness) ? job.brushHardness : 0.72), 0, 1);
  const softEdgeWidth = Math.max(0.001, 1 - hardness);
  for (let i = 0; i <= maskResolution; i++) {
    const distance = Math.sqrt(i / maskResolution);
    const edge = hardness >= 0.999 ? 1 :
      clamp((1 - distance) / softEdgeWidth, 0, 1);
    radialMask[i] = edge * edge * (3 - 2 * edge);
  }
  const sampleColor = (cx, cy, sampleRadius) => {
    /* FAZ 3-2: doğrudan LINEER örnekleme (gamma'da ortalama murky'dır). */
    let red = 0, green = 0, blue = 0, alpha = 0, count = 0;
    const offsets = [-0.5, 0, 0.5];
    for (const oy of offsets) {
      for (const ox of offsets) {
        const x = clamp(Math.round(cx + ox * sampleRadius), 0, bw - 1);
        const y = clamp(Math.round(cy + oy * sampleRadius), 0, bh - 1);
        const i = (y * bw + x) * 4;
        const a = data[i + 3] / 255;
        red += inkLinData(data[i]) * a;
        green += inkLinData(data[i + 1]) * a;
        blue += inkLinData(data[i + 2]) * a;
        alpha += a;
        count++;
      }
    }
    if (!count || alpha <= 0) return null;
    return [red / alpha, green / alpha, blue / alpha, alpha / count];
  };
  let reservoir = null;
  let previous = null;
  const spacing = Math.max(0.8, sizePx * clamp(stroke.spacing || 0.12, 0.01, 2));
  forEachDab(stroke.points, spacing, (pt, _pressure, dabIndex) => {
    const p = map(pt);
    if (!p) return;
    const radius = Math.max(0.5, Math.min(radiusMax,
      dabRadius(dyn, sizePx, clamp(pt.p, 0.02, 1), clamp(pt.s || 0, 0, 1),
        stroke.speedSize || 0, Math.min(sizePx / 2, spacing * 0.62)) *
      (Number.isFinite(pt.k) ? clamp(pt.k, 0, 1) : 1)));
    const cx = p.x - x0, cy = p.y - y0;
    const pickup = sampleColor(previous
      ? previous.x + (cx - previous.x) * 0.25
      : cx, previous
      ? previous.y + (cy - previous.y) * 0.25
      : cy, Math.max(1, radius * 0.22));
    if (pickup) {
      /* reservoir LINEER uzamda (FAZ 3-2): pickup [r,g,b 0..1 lineer, a];
         karışım oranı aynı, lineer uzay → gerçek ortalamalar. */
      if (!reservoir) reservoir = pickup;
      else {
        const mix = clamp(0.08 + flow * 0.12, 0.08, 0.2);
        for (let c = 0; c < 4; c++) reservoir[c] += (pickup[c] - reservoir[c]) * mix;
      }
    }
    previous = p;
    if (!reservoir) return;

    const left = Math.max(0, Math.floor(cx - radius));
    const right = Math.min(bw - 1, Math.ceil(cx + radius));
    const top = Math.max(0, Math.floor(cy - radius));
    const bottom = Math.min(bh - 1, Math.ceil(cy + radius));
    const pressure = clamp(pt.p, 0.02, 1);
    const dabStrength = clamp(strength * pressure *
      (1 - strokeRandom(stroke, dabIndex, 2) * flowJitter) *
      (Number.isFinite(pt.k) ? clamp(pt.k, 0, 1) : 1), 0, 1);
    const sourceAlpha = clamp(reservoir[3], 0, 1);
    const sourceRed = reservoir[0], sourceGreen = reservoir[1], sourceBlue = reservoir[2];
    const radiusSquared = radius * radius;
    const maskMax = radialMask.length - 1;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > radiusSquared) continue;
        const maskIndex = Math.min(maskMax,
          Math.round(distanceSquared / radiusSquared * maskMax));
        const amount = dabStrength * radialMask[maskIndex];
        if (amount <= 0) continue;
        const i = (y * bw + x) * 4;
        const destAlpha = data[i + 3] / 255;
        const keep = destAlpha * (1 - amount);
        const add = sourceAlpha * amount;
        const outAlpha = keep + add;
        if (outAlpha <= 0) continue;
        data[i] = inkDabOverChannel(data[i], destAlpha, sourceRed, sourceAlpha, amount);
        data[i + 1] = inkDabOverChannel(data[i + 1], destAlpha, sourceGreen, sourceAlpha, amount);
        data[i + 2] = inkDabOverChannel(data[i + 2], destAlpha, sourceBlue, sourceAlpha, amount);
        data[i + 3] = Math.round(outAlpha * 255);
      }
    }
  }, job.mode === 'attached'
    ? { x: Math.max(1, job.canvasW || 1), y: Math.max(1, job.canvasH || 1) }
    : 1, {
    strokeId: stroke.id,
    spacingJitter: clamp(Number(stroke.spacingJitter) || 0, 0, 1),
    taperStartPx: (stroke.taperStart || 0) * sizePx,
    taperEndPx: (stroke.taperEnd || 0) * sizePx,
    stroke,
  });
  ctx.putImageData(image, x0, y0);
}

/* FAZ 7.U: silgi tam-tuval scratch'i (işler arasında yeniden kullanılır). */
let eraseScratch = null;
/* İş başına raster sayacı: applied mesajıyla ana tarafa taşınır. Ana
   thread'in inkPerf sayaçları worker'ı izleyemez; bench/HUD buradan okur. */
let jobDabs = 0, jobPath = 0;

function drawStroke(ctx, job) {
  const stroke = job.stroke;
  if (!stroke || !stroke.points || !stroke.points.length) return;
  const sizePx = Math.max(0.5, job.sizePx || 1);
  const erase = !!job.erase;

  const map = job.mode === 'attached'
    ? (p => ({ x: p.x * job.canvasW - job.regionX, y: p.y * job.canvasH - job.regionY }))
    : (p => ({ x: p.x - job.regionX, y: p.y - job.regionY }));

  ctx.save();
  /* Ana thread birebir: hedef ctx'in smoothing'ine DOKUNULMAZ (default
     enabled + 'low'; 28-ink-brush yalnız dual-scratch'e 'high' verir).
     Eskiden burada 'high' set ediliyordu; küçük kovalarda (p<1, kova
     ölçeklemesi büyük) silgi/fırça kenar profili yumuşayıp ana
     raster'dan sapıyordu (diag15: p=0.2 max=95, kenar 227/69 ↔ 132/82). */
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.globalAlpha = clamp(stroke.opacity, 0, 1);

  /* FAZ 7.U tam-tuval scratch (silgi + shape + smudge): bu vuruş türleri
     bölge tuvalinde lokal koordinatla basılamaz — ana thread undo bölge
     yeniden kurulumunda TÜM vuruşları tam tuval scratch'inde
     identity+mutlak basar (inkUndoRegionRebuild). Skia CTM f32 olduğu
     için kırpılmış bölge tuvalinde bu device semantiği hiçbir translate
     ifadesiyle birebir üretilemez (diag32: fround (587,333)'ü, düz
     (650,347)'yi tutuyordu; silgide çözülmüştü — shape/smudge'da aynı
     yapısal sorun). Çözüm: mevcut bölge içeriği tam tuval scratch'ine
     mutlak konuma kopyalanır, vuruş orada identity+mutlak basılır, bölge
     tam-sayı blit ile geri alınır. */
  let eCtx = null;
  const tamTuval = erase || stroke.kind === 'shape' || stroke.kind === 'smudge';
  /* FAZ 7.U hız (abs): batch-toplu tam-tuval yolunda ctx ZATEN tam tuvaldir
     (onmessage'ta tek scratch kurulur) — vuruş başına scratch dansı yok. */
  if (tamTuval && !job.abs && job.regionX != null && job.regionY != null &&
      Number(job.canvasW) > 0 && Number(job.canvasH) > 0) {
    try {
      const cw = Math.round(Number(job.canvasW));
      const chh = Math.round(Number(job.canvasH));
      if (cw > 0 && chh > 0 && cw * chh <= 33554432) {
        if (!eraseScratch || eraseScratch.width !== cw ||
            eraseScratch.height !== chh) {
          eraseScratch = new OffscreenCanvas(cw, chh);
        }
        eCtx = eraseScratch.getContext('2d', { colorSpace: 'srgb' });
        eCtx.setTransform(1, 0, 0, 1, 0, 0);
        eCtx.globalCompositeOperation = 'source-over';
        eCtx.globalAlpha = 1;
        eCtx.imageSmoothingEnabled = true;
        eCtx.imageSmoothingQuality = 'low';
        eCtx.clearRect(0, 0, cw, chh);
        /* mevcut bölge içeriği → scratch'te mutlak konuma (1:1) */
        eCtx.drawImage(ctx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height,
          job.regionX, job.regionY, ctx.canvas.width, ctx.canvas.height);
        /* silgi: birikimli destination-out; shape/smudge: kendi
           yazımları source-over (ana inkDrawShape semantiği). */
        eCtx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      }
    } catch { eCtx = null; }
  }
  /* geri blit: scratch'teki tam tuvalden bölge, tam-sayı 1:1 kopya
     (clearRect + drawImage — bit-bitar). */
  const tamTuvalBlit = () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(eraseScratch, job.regionX, job.regionY,
      ctx.canvas.width, ctx.canvas.height, 0, 0,
      ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  };

  if (stroke.kind === 'smudge') {
    /* FAZ 4-3 batch yolu: smudge piksel-okumalıdır; damla yoluna
       düşmemeli (eskiden batch'te drawStroke'un damla dalına giriyordu).
       Scratch'te MUTLAK koordinatla çalıştır: region 0,0 + tam tuval
       ölçüleri → drawSmudge'in map'i mutlak uzayı üretir. */
    if (eCtx) {
      drawSmudge(eCtx, { ...job, regionX: 0, regionY: 0,
        width: Math.round(Number(job.canvasW)),
        height: Math.round(Number(job.canvasH)) });
      tamTuvalBlit();
    } else {
      drawSmudge(ctx, job);
    }
    ctx.restore();
    return;
  }
  if (stroke.kind === 'shape') {
    if (eCtx) {
      /* identity+mutlak: ana inkDrawShape device semantiği birebir. */
      drawShape(eCtx, job, job.mode === 'attached'
        ? (p => ({ x: p.x * job.canvasW, y: p.y * job.canvasH }))
        : (p => ({ x: p.x, y: p.y })), sizePx);
      tamTuvalBlit();
    } else {
      drawShape(ctx, job, map, sizePx);
    }
    ctx.restore();
    return;
  }

  if (pathEligible(job)) {
    jobPath += 1;
    drawStrokeAsPath(ctx, job, map, sizePx);
    ctx.restore();
    return;
  }

  // Damla yolu — ana iş parçacığındaki `inkDrawStrokeOnContext` ile aynı
  // basınç/eğim/aralık/dinamik matematiği. Prosedürel uç, damganın
  // çözünürlüğünde üretilir; büyük fırçalarda (kova > 128) uç büyütülmez.
  const baseAlpha = clamp(stroke.opacity, 0, 1);
  /* K15 · çift tampon (sync `inkDrawStrokeOnContext` birebir): damlalar
     vuruş-scratch'e TAM boyut ağırlığıyla (opacity HARİÇ) birikir ve
     scratch TEK geçişte baseAlpha ile kompozitlenir. Aksi hâlde worker
     bölge tuvalinde bir hâlde birikir (önceden var olan sapma): örtüşen
     damlalar iç dolguyu baseAlpha ÜZERİNE taşırdı. Silgi hattı
     değişmez (birikimli destination-out, PS uyumlu). */
  let sctx = null, scratch = null, dabCount = 0;
  const dyn = job.dyn && Number.isFinite(job.dyn.sizeMin) && Number.isFinite(job.dyn.sizeMax)
    ? job.dyn
    : { sizeMin: 0.18, sizeMax: 1, src: 'pressure', angleJitter: 0, scatterJitter: 0,
        spacingJitter: 0, opacityMin: 0.35, opacityJitter: 0, opacitySrc: '',
        sizeJitter: 0, roundnessJitter: 0, roundnessMin: 0.05 };
  const spread = Math.max(0, dyn.sizeMax - dyn.sizeMin);
  const speedSize = clamp(Number.isFinite(job.speedSize) ? job.speedSize : 0, 0, 0.8);
  const flow = clamp(Number.isFinite(job.flow) ? job.flow : 1, 0.01, 1);
  const flowJitter = clamp(Number.isFinite(job.flowJitter) ? job.flowJitter : 0, 0, 1);
  const textured = !!job.texture;
  const textureDepth = clamp(Number.isFinite(job.textureDepth) ? job.textureDepth : 0.26, 0, 1);
  const textureScale = clamp(Number.isFinite(job.textureScale) ? job.textureScale : 1, 0.1, 8);
  const roundness = Number.isFinite(job.round) ? job.round : 1;
  const baseAngle = Number.isFinite(job.angle) ? job.angle : 0;
  const dual = !erase && job.dual ? job.dual : null;
  const dualFlow = dual ? clamp(Number.isFinite(dual.flow) ? dual.flow : 0.72, 0.01, 1) : 1;
  // Saçılma: fırçanın eksenli scatterX/Y saçılması vuruş scatter'ının
  // ÜZERİNDEN büyür (ana thread Math.max birebir).
  const scatterX = Math.max(0, Number(job.scatterX) || 0, stroke.scatter || 0);
  const scatterY = Math.max(0, Number(job.scatterY) || 0, stroke.scatter || 0);
  const scatterCount = Math.round(clamp(Number(job.scatterCount) || 1, 1, 16));
  const scatterCountJitter = clamp(Number(job.scatterCountJitter) || 0, 0, 1);
  /* FAZ 7.U parite: scratch boyutu ana thread'in dual-scratch formülüyle
     birebir (28-ink-brush.js: nokta bbox + pad). Tüm bölge boyutunda
     scratch, aynı damlaları farklı yüzey geometrisiyle rasterlayıp
     ±1 RGB kaydırıyordu (diag17). */
  if (!erase) {
    try {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, seen = 0;
      for (const pt of stroke.points) {
        const mp = map(pt);
        if (!mp) continue;
        if (mp.x < minX) minX = mp.x;
        if (mp.y < minY) minY = mp.y;
        if (mp.x > maxX) maxX = mp.x;
        if (mp.y > maxY) maxY = mp.y;
        seen++;
      }
      if (seen > 0) {
        const pad = sizePx * 0.62 + sizePx * 0.55 * Math.max(scatterX, scatterY) + 2;
        /* Kestirme sınırı ANA birebir: tuvalin mutlak 0'ı (= bölge-lokal
           -regionX/-regionY). Bölge kenarına (0) kırpılıyorsa scratch'in
           piksel ızgarası bölge kökenine göre kayıyor, damlaların kesirli
           konumları farklı rasterleniyordu (diag23: d4=23 bayt/max 51;
           ana scratch 251,160 ↔ worker 0,0). */
        const sx0 = Math.max(-job.regionX, Math.floor(minX - pad));
        const sy0 = Math.max(-job.regionY, Math.floor(minY - pad));
        const sw = Math.ceil(maxX + pad) - sx0;
        const sh = Math.ceil(maxY + pad) - sy0;
        if (sw > 0 && sh > 0 && sw * sh <= 67108864) {
          scratch = new OffscreenCanvas(sw, sh);
          sctx = scratch.getContext('2d', { colorSpace: 'srgb' });
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'high';
          sctx.globalCompositeOperation = 'source-over';
          /* Mutlak origin translate: damla konumları MUTLAK uzayda tutulur
             (ana birebir float ifadesi: konum − mutlakOrigin). Lokal konum
             + translate(+sx0) yolu float yuvarlamasında farklı sonuç
             veriyordu (diag26: 109 damlada 23 bayt/max 5 —
             (a−262)+11 ≠ a−251). */
          sctx.translate(-(sx0 + (job.regionX || 0)), -(sy0 + (job.regionY || 0)));
          scratch.__inkX0 = sx0;
          scratch.__inkY0 = sy0;
        }
      }
    } catch { scratch = null; sctx = null; }
  }
  /* tam-tuval scratch kurulumu yukarıda (shape/smudge/erase ortak). */
  const dc = sctx || eCtx || ctx;
  const noiseAmount = Number(job.noise) || 0;
  const wetEdgesAmount = Number(job.wetEdges) || 0;
  // Renk dinamikleri: hex→OKLCH hazırlığı vuruş başına bir kez.
  const preparedColor = prepareStrokeColor(stroke, job.colorDyn);
  const spacingPx = Math.max(0.8, sizePx * clamp(stroke.spacing || 0.1, 0.01, 2));
  const minRadius = Math.min(sizePx / 2, spacingPx * 0.62);
  // Uç yığını + çevirme/dönme (ana thread ile aynı kanallar: 15/16/17/18).
  const tipVariantCount = Math.max(1, Math.round(Number(job.tipVariants) || 1));
  const tipFlipX = clamp(Number(job.stampFlipX) || 0, 0, 1);
  const tipFlipY = clamp(Number(job.stampFlipY) || 0, 0, 1);
  const tipRotRandom = clamp(Number(job.tipRotation) || 0, 0, 1);
  let lastAlpha = -1;
  let prevMapped = null;   // dual spacing < 1 ara damlaları için (28 birebir)
  const tips = new Map();     // res|color -> OffscreenCanvas
  const variantStamps = new Map(); // variant|bucket|color -> OffscreenCanvas
  const dualStamps = new Map(); // "res|color|hardness" -> OffscreenCanvas

  // Çift fırça damlası — ana thread `inkDrawDualDab` birebir: saçılma
  // ch4/ch5 alan-uniform, composite op `dual.blend || 'multiply'`, akış
  // INK_DUAL_FLOW 0.72. Uç kaynağı: aktarılan .abr bitmap > dual fırçanın
  // yerel kütüphane ucu > prosedürel sertlik ucu. Ölçek yolu sync'le aynı:
  // uç doğrudan 2*dr büyüklüğe çizilir (damga kovası normalizasyonu yok).
  const paintDualDab = (radius, alpha, x, y, tilt, angle, dabIndex, color) => {
    const dr = Math.max(0.35, radius * clamp(dual.scale || 1, 0.1, 4));
    let dx = x, dy = y;
    const sc = Math.max(0, dual.scatter || 0);
    if (sc > 0) {
      const a = strokeRandom(stroke, dabIndex, 4) * Math.PI * 2;
      const dist = Math.sqrt(strokeRandom(stroke, dabIndex, 5)) * dr * sc;
      dx += Math.cos(a) * dist;
      dy += Math.sin(a) * dist;
    }
    const hardness = Number.isFinite(dual.hardness) ? dual.hardness : 0.6;
    const res = tipRes(dr * 2);
    const hardKey = Math.round(clamp(hardness, 0, 1) * 100);
    const key = res + '|' + color + '|' + hardKey;
    let ds = dualStamps.get(key);
    if (!ds) {
      const db = job.dualBrush;
      if (job.dualTip) {
        ds = job.dualTip;
      } else if (db && db.tip && db.kind !== 'abr') {
        const white = makeNativeTip(db.tip, db.tipOptions, res, hardness, 0,
          db.tipSeed);
        ds = tintedTip(white, color, 'dual|' + db.tip + '|' + res + '|' + hardKey);
      } else {
        /* Ana thread `inkDrawDualDab` birebir: prosedürel dal da BEYAZ uç +
           source-in tonlama üretir (renkli uç gradyan/yuvarlamada farklı
           byte veriyordu — probe5 kanıtı 8488 byte, maxDelta 255). */
        const whiteKey = 'dw' + res + '|' + hardKey;
        let white = tips.get(whiteKey);
        if (!white) {
          white = makeProceduralTip(hardness, '#ffffff', false, res);
          tips.set(whiteKey, white);
        }
        ds = tintedTip(white, color, 'dualp|' + res + '|' + hardKey);
      }
      dualStamps.set(key, ds);
    }
    const rot = angle + (Number.isFinite(dual.angle) ? dual.angle : 0);
    const round = Number.isFinite(dual.roundness) ? clamp(dual.roundness, 0.05, 1) : 1;
    const prevAlpha = dc.globalAlpha;
    const prevOp = dc.globalCompositeOperation;
    dc.globalCompositeOperation = dual.blend || 'multiply';
    dc.globalAlpha = Math.min(1, alpha * dualFlow);
    drawTiltedStamp(dc, ds, dx, dy, dr, tilt, rot, round);
    dc.globalAlpha = prevAlpha;
    dc.globalCompositeOperation = prevOp;
  };

  const paintDab = (pt, _pressure, dabIndex) => {
    /* Scratch birikiminde VE silgide (tam-tuval eScratch) damla konumu
       MUTLAK uzayda (ana birebir float yolu; diag26/diag35). fround
       bölge-ifadesi kaldırıldı: silgi artık eCtx'te identity+mutlak. */
    const p = (sctx || eCtx)
      ? (job.mode === 'attached'
        ? { x: pt.x * job.canvasW, y: pt.y * job.canvasH }
        : { x: pt.x, y: pt.y })
      : map(pt);
    if (!p) return;
    const pressure = clamp(pt.p, 0.02, 1);
    const speed = clamp(pt.s || 0, 0, 1);
    // Boyut dinamiği: pressure / velocity / random (kanal 8) + sizeJitter
    // (kanal 9) + hız incelmesi — ana thread `inkDabRadius` birebir
    // (spread + factor + minRadius tabanı, sonra pt.k ve sizeFactor).
    const driver = dyn.src === 'velocity' ? 1 - speed :
      dyn.src === 'random' ? strokeRandom(stroke, dabIndex, 8) : pressure;
    const sizeJitter = clamp(Number(dyn.sizeJitter) || 0, 0, 1);
    const sizeFactor = 1 - sizeJitter / 2 + sizeJitter * strokeRandom(stroke, dabIndex, 9);
    let factor = dyn.sizeMin + spread * clamp(Number.isFinite(driver) ? driver : 1, 0, 1);
    const s = clamp(Number.isFinite(speed) ? speed : 0, 0, 1);
    const amount = clamp(Number.isFinite(speedSize) ? speedSize : 0, 0, 0.8);
    if (amount > 0) factor *= Math.max(0.2, 1 - amount * s);
    const radiusFloor = Math.max(0.35, minRadius);
    const radius = Math.max(0.35,
      Math.max(radiusFloor, (sizePx / 2) * factor) *
      (Number.isFinite(pt.k) ? clamp(pt.k, 0, 1) : 1) * sizeFactor);
    let angle;
    if (pt.t > 0.02) {
      angle = (pt.a || 0) + baseAngle;
    } else {
      angle = baseAngle;
    }
    // Yuvarlaklık: ana iş parçacığıyla birebir — basınç, fırça yuvarlaklığını
    // minRound..1 aralığında harmanlar ve damga eksende yassılaşır
    // (28-ink-brush.js `dabRound`). Aksi hâlde worker tam daire çizerken
    // senkron raster elips basıyor: ekran geride, commit önde kalıyor.
    const roundnessJitter = clamp(Number(dyn.roundnessJitter) || 0, 0, 1);
    const minRound = clamp(Number(dyn.roundnessMin) || 0.05, 0.05, roundness);
    const pressureRound = minRound + (clamp(roundness, minRound, 1) - minRound) * pressure;
    const dabRound = clamp(pressureRound *
      (1 - roundnessJitter / 2 + roundnessJitter * strokeRandom(stroke, dabIndex, 10)),
      minRound, 1);
    if (dyn.angleJitter > 0) {
      angle += (strokeRandom(stroke, dabIndex, 3) * 2 - 1) * Math.PI * dyn.angleJitter;
    }
    if (tipRotRandom > 0) {
      angle += strokeRandom(stroke, dabIndex, 18) * Math.PI * 2 * tipRotRandom;
    }
    let tipVariant = 0;
    if (tipVariantCount > 1) {
      tipVariant = Math.min(tipVariantCount - 1,
        Math.floor(strokeRandom(stroke, dabIndex, 15) * tipVariantCount));
    }
    const dabFlipX = tipFlipX > 0 && strokeRandom(stroke, dabIndex, 16) < tipFlipX;
    const dabFlipY = tipFlipY > 0 && strokeRandom(stroke, dabIndex, 17) < tipFlipY;
    // Saçılma damlası sayısı (kanal 11) + damla başına saçılma ölçeği (14).
    const countOffset = Math.round((strokeRandom(stroke, dabIndex, 11) * 2 - 1) *
      scatterCount * scatterCountJitter);
    const count = clamp(scatterCount + countOffset, 1, 16);
    const scatterJitter = clamp(Number(dyn.scatterJitter) || 0, 0, 1);
    const scatterScale = 1 - scatterJitter * strokeRandom(stroke, dabIndex, 14);
    const dabScatterX = scatterX * scatterScale;
    const dabScatterY = scatterY * scatterScale;
    for (let stampIndex = 0; stampIndex < count; stampIndex++) {
      const randomIndex = dabIndex * 16 + stampIndex;
      let x = p.x, y = p.y;
      if (dabScatterX > 0 || dabScatterY > 0) {
        const a = strokeRandom(stroke, randomIndex, 0) * Math.PI * 2;
        if (Math.abs(dabScatterX - dabScatterY) < 0.0001 &&
            dabScatterX === (stroke.scatter || 0)) {
          // Alan-uniform halka: mesafe sqrt(concat) yerine r*scatter.
          const d = strokeRandom(stroke, randomIndex, 1) * radius * dabScatterX;
          x += Math.cos(a) * d;
          y += Math.sin(a) * d;
        } else {
          // Alan-uniform: sqrt(orijin) diskte merkeze yığılmayı önler.
          const d = Math.sqrt(strokeRandom(stroke, randomIndex, 1));
          x += Math.cos(a) * d * radius * dabScatterX;
          y += Math.sin(a) * d * radius * dabScatterY;
        }
      }
      let dabFlow = flow;
      if (!erase && flowJitter > 0) {
        dabFlow *= 1 - strokeRandom(stroke, randomIndex, 2) * flowJitter;
      }
      if (job.airbrush) dabFlow *= 0.14;
      const opacityJitter = clamp(Number(dyn.opacityJitter) || 0, 0, 1);
      const opacitySource = dyn.opacitySrc === 'random'
        ? 1 - opacityJitter * strokeRandom(stroke, randomIndex, 12)
        : (1 - opacityJitter) + opacityJitter * pressure;
      const minOpacity = clamp(Number.isFinite(dyn.opacityMin) ? dyn.opacityMin : 0.35, 0, 1);
      /* K15 · çift tampon etkin: damla TAM boyut ağırlığı (opacity
         HARİÇ — kompozit tek geçişte baseAlpha taşır). Eski yolda
         (sctx yok) birikimli baseAlpha×dyn sürer. */
      let alpha = erase ? baseAlpha : (sctx
        ? Math.min(1, Math.max(0,
          (minOpacity + (1 - minOpacity) * pressure) * dabFlow * opacitySource))
        : Math.min(1,
          baseAlpha * (minOpacity + (1 - minOpacity) * pressure) * dabFlow * opacitySource));
      dabCount++;
      const color = erase ? stroke.color :
        dabStrokeColor(stroke, job.colorDyn, randomIndex, preparedColor);
      if (!erase && textured) {
        alpha *= grainFor(
          job.textureEachTip ? 0 : x,
          job.textureEachTip ? 0 : y,
          sizePx, textureDepth, textureScale,
          job.textureId, job.textureBrightness, job.textureContrast,
          job.textureEachTip, strokeRandom(stroke, randomIndex, 13));
      }
      if (!erase && noiseAmount > 0) {
        // brush.noise: damla alfa çarpanı — kanal şeması ana thread ile aynı.
        const noise = textureNoise(x * 0.73 + randomIndex, y * 0.73 - randomIndex);
        alpha *= 1 - noiseAmount * (0.25 + 0.55 * noise);
      }
      if (alpha !== lastAlpha) {
        dc.globalAlpha = alpha;
        lastAlpha = alpha;
      }
      const bucket = stampBucket(radius * 2);
      // Renk damla başına değişebilir (renk dinamikleri): önbellek anahtarı
      // damla rengini içerir (sync atlası renkli, worker bunu yansıtır).
      const stampKey = tipVariant + '|' + bucket + '|' + color;
      let stamp = variantStamps.get(stampKey);
      if (!stamp) {
        let tip = job.tip;
        if (!tip) {
          const res = tipRes(bucket);
          const hardnessIn = stroke.tool === 'eraser' ? 1 : stroke.hardness;
          if (erase) {
            /* Ana thread `inkStampFor` erase kolu birebir: silgi damgası
               daima PROSEDÜREL radyal gradyan (hardness 1) — fırçanın
               native ucu DEĞİL. Sert circle ucu kenarda fazla siler
               (diag10 cift-b1e1 kanıtı: n=519 max=217). */
            const tipKey = 'erase|' + res;
            tip = tips.get(tipKey);
            if (!tip) {
              tip = makeProceduralTip(1, color, true, res);
              tips.set(tipKey, tip);
            }
          } else if (job.tipKind) {
            // Yerel kütüphane ucu: worker kendisi üretir (beyaz maske),
            // sonra sync'teki inkTintedTip gibi damla rengiyle tonlanır —
            // aksi hâlde worker vuruşu beyaz basardı.
            const white = makeNativeTip(job.tipKind, job.tipOptions, res,
              hardnessIn, tipVariant, job.tipSeed);
            tip = erase ? white
              : tintedTip(white, color,
                job.tipKind + '|' + tipVariant + '|' + res + '|' +
                Math.round(hardnessIn * 100));
          } else {
            /* Ana thread `inkStampFor` birebir: BEYAZ prosedürel uç +
               source-in tonlama. Ucu doğrudan renkli üretmek (eski yol)
               gradyan aradeğerleme/yuvarlamasında farklı byte üretiyordu
               (probe5: 8488 byte, maxDelta 255 — probe-parity plain/wet/
               airbrush/colordyn/dual varyantlarının tamamı bu tek
               farktan kaynaklanıyordu). */
            const whiteKey = 'pw' + res + '|' + Math.round(hardnessIn * 100);
            let white = tips.get(whiteKey);
            if (!white) {
              white = makeProceduralTip(hardnessIn, '#ffffff', false, res);
              tips.set(whiteKey, white);
            }
            tip = tintedTip(white, color,
              'p' + res + '|' + Math.round(hardnessIn * 100));
          }
        }
        /* PARİTE (probe-trace bulgusu): renk dinamiklerinde senkron yol
           `inkStampFor` REUSABLE daldır — damga, uç çözünürlüğünde
           (tipRes: bucket ≤ 128 → 128) tonlanmış ucun KENDİSİDİR, kova
           boyutuna küçültülmez. Worker makeStamp her zaman bucket'a
           indirgiyordu → çift küçültme (128→64→2r) ↔ tek küçültme
           (128→2r) farklı yuvarlama üretiyordu (cd+d_size: ±1; full:
           maxDelta 13). Silgi hariç renk dinamiklerinde uç doğrudan
           damga olur (sync `reusable && !erase` birebir). */
        stamp = (job.colorDyn && !erase) ? tip : makeStamp(tip, bucket);
        variantStamps.set(stampKey, stamp);
      }
      drawTiltedStamp(dc, stamp, x, y, radius, pt.t, angle, dabRound,
        dabFlipX, dabFlipY);
      if (!erase && wetEdgesAmount > 0) {
        wetEdge(dc, x, y, radius, dabRound, angle, color, wetEdgesAmount, alpha);
      }
      if (dual) {
        // Çift fırça yerleşimi — sync `inkDrawStrokeOnContext` birebir:
        // spacing > 1 → her N damlada biri; spacing < 1 → önceki eşlenmiş
        // noktaya kadar interpolasyonlu ara damlalar; yoksa damla yeri.
        const dualSpacing = clamp(Number(dual.spacing) || 1, 0.25, 3);
        if (dualSpacing > 1) {
          const dualEvery = Math.max(1, Math.round(dualSpacing));
          if (randomIndex % dualEvery === 0) {
            paintDualDab(radius, alpha, x, y, pt.t, angle, randomIndex, color);
          }
        } else if (prevMapped) {
          const steps = Math.max(1, Math.round(1 / dualSpacing));
          for (let step = 1; step <= steps; step++) {
            const t = step / steps;
            const dualX = prevMapped.x + (p.x - prevMapped.x) * t;
            const dualY = prevMapped.y + (p.y - prevMapped.y) * t;
            paintDualDab(radius, alpha, dualX, dualY, pt.t, angle,
              randomIndex * 16 + step, color);
          }
        } else {
          paintDualDab(radius, alpha, x, y, pt.t, angle, randomIndex, color);
        }
      }
    }
    prevMapped = { x: p.x, y: p.y };
  };
  /* EVRE 2: native kayıtlar varsa emisyonu JS'te tekrar hesaplamadan
     tüket (parite: 9 senaryo ≤1e-9; kayıt yoksa/bozuksa JS emitter). */
  if (job.dabRecs && job.dabRecsCount > 0) {
    forEachRecordDab(job.dabRecs, job.dabRecsCount, paintDab);
  } else {
    forEachDab(stroke.points, spacingPx, paintDab, job.mode === 'attached'
      ? { x: Math.max(1, job.canvasW || 1), y: Math.max(1, job.canvasH || 1) }
      : 1, {
      spacingJitter: dyn.spacingJitter,
      taperStartPx: (stroke.taperStart || 0) * sizePx,
      taperEndPx: (stroke.taperEnd || 0) * sizePx,
      stroke,
    });
  }
  /* K15 · çift tampon kompozit: scratch'i TEK geçişte baseAlpha ile
     bölge tuvaline bas. lockAlpha katmanı boş piksellere taşmaması
     için ATOP olarak kompozitlenir (sync ana çizim birebir; K19
     worker kanalı kapandı). */
  if (sctx) {
    jobDabs += dabCount;
    if (dabCount > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = baseAlpha;
      ctx.globalCompositeOperation = stroke.lockAlpha ? 'source-atop' : 'source-over';
      ctx.drawImage(scratch, scratch.__inkX0 || 0, scratch.__inkY0 || 0,
        scratch.width, scratch.height);
      ctx.restore();
    }
    scratch = null;
    sctx = null;
  }
  /* FAZ 7.U silgi: tam-tuval scratch'teki bölgeyi geri blit (tam sayı,
     1:1 — bit-bitar kopya). */
  if (eCtx) tamTuvalBlit();
  ctx.restore();
}

self.onmessage = function (ev) {
  const job = ev.data || {};
  jobDabs = 0; jobPath = 0;
  try {
    const width = Math.max(1, Math.round(job.width || 1));
    const height = Math.max(1, Math.round(job.height || 1));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (job.batch && job.batch.length) {
      /* FAZ 7.U: bölge yeniden kurulumundaki damga döngüsü tek işte
         toplanır: baked dilim + kesişen vuruşlar sıralı basılır.
         Kompozit kuralları drawStroke içindedir (erase = destination-out,
         lockAlpha = source-atop); source-over sıralı kompozit ana
         inkUndoRegionRebuild'in scratch dizimiyle birebir birleşir. */
      if (job.baked) { ctx.drawImage(job.baked, 0, 0); job.baked.close(); }
      /* FAZ 7.U hız (abs-toplu): tam-tuval vuruşu (erase/shape/smudge)
         batch'te varsa TEK tam-tuval scratch kur — ana
         inkUndoRegionRebuild dizimi birebir (baked+vuruşlar → scratch,
         TEK bölge bliti). Eskiden vuruş başına clear+copy+blit: 4K
         bölgede ~350-1000 ms/iş → bekçi telafiyi senkrona itiyordu. */
      const tamVurus = job.batch.some(f => f.erase ||
        (f.stroke && (f.stroke.kind === 'shape' || f.stroke.kind === 'smudge')));
      let bctx = null;
      const bcw = Math.round(Number(job.canvasW));
      const bch = Math.round(Number(job.canvasH));
      if (tamVurus && job.regionX != null && job.regionY != null &&
          bcw > 0 && bch > 0 && bcw * bch <= 33554432) {
        try {
          if (!eraseScratch || eraseScratch.width !== bcw ||
              eraseScratch.height !== bch) {
            eraseScratch = new OffscreenCanvas(bcw, bch);
          }
          bctx = eraseScratch.getContext('2d', { colorSpace: 'srgb' });
          bctx.setTransform(1, 0, 0, 1, 0, 0);
          bctx.globalAlpha = 1;
          bctx.globalCompositeOperation = 'source-over';
          bctx.imageSmoothingEnabled = true;
          bctx.imageSmoothingQuality = 'low';
          bctx.clearRect(0, 0, bcw, bch);
          /* bölge tuvali (baked dahil) → scratch'te mutlak konum (1:1) */
          bctx.drawImage(ctx.canvas, job.regionX, job.regionY);
        } catch { bctx = null; }
      }
      const hedefCtx = bctx || ctx;
      for (const f of job.batch) {
        drawStroke(hedefCtx, bctx
          ? { ...f, abs: true, regionX: 0, regionY: 0 }
          : f);
        if (f.tip && f.tip.close) f.tip.close();
        if (f.dualTip && f.dualTip.close) f.dualTip.close();
      }
      if (bctx) {
        /* geri blit: tam-tuval scratch → bölge, tam-sayı 1:1 kopya */
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.drawImage(eraseScratch, job.regionX, job.regionY,
          ctx.canvas.width, ctx.canvas.height, 0, 0,
          ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
      }
    } else if (job.baked) {
      /* FAZ 7.U: kesişen vuruş kalmamış bölge — içerik yalnız baked
         dilimidir (kalan vuruşlar bölgeye dokunmuyor) ya da boş (temizlik;
         baked yokken canvas şeffaf kalır). */
      ctx.drawImage(job.baked, 0, 0);
      job.baked.close();
    } else {
      if (job.existing) {
        ctx.drawImage(job.existing, 0, 0);
        job.existing.close();
      }
      if (job.stroke && job.stroke.kind === 'smudge') {
        // FAZ4-3: smudge advected alan artık worker'a taşınıyor.
        drawSmudge(ctx, job);
      } else {
        drawStroke(ctx, job);
      }
    }
    const bitmap = canvas.transferToImageBitmap();
    const out = { id: job.id, bitmap, stats: { dabs: jobDabs, path: jobPath } };
    self.postMessage(out, [bitmap]);
  } catch (err) {
    // hata yolu: taşınan uçları da bırak (bellek sızıntısı olmasın)
    try { if (job.baked && job.baked.close) job.baked.close(); } catch { /* sessiz */ }
    if (job.batch) for (const f of job.batch) {
      try { if (f.tip && f.tip.close) f.tip.close(); } catch { /* sessiz */ }
      try { if (f.dualTip && f.dualTip.close) f.dualTip.close(); } catch { /* sessiz */ }
    }
    self.postMessage({ id: job.id, error: String((err && (err.stack || err.message)) || err) });
  }
};
