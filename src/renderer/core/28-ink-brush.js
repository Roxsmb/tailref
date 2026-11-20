'use strict';

const INK_TIP_SIZE = 128;
// Büyük fırçalarda 128 px uç 1024 px'e kadar büyütülünce kenar bulanıklaşıyordu.
// Prosedürel uçlar vektör olduğu için doğrudan hedef çözünürlükte üretilir.
const INK_TIP_MAX = 1024;
const INK_TIP_LIMIT = 12;
const INK_TINT_LIMIT = 110;
/* Profiler bulgusu: tint önbelleği de varyant sıkığına gömülüydü -
   48 kalemdede vuruş ortasında renklendirilmiş uç yeniden üretiliyordu.
   110 = varyant×kova uzayı (105) + pay. */
const INK_DYNAMIC_TINT_LIMIT = 6;
const INK_ABR_SOURCE_LIMIT = 6;

const inkRuntimeBrushes = {
  tintCache: new Map(),     // "brushId|color|hardness|kaynak" -> canvas
  dynamicTintCanvases: new Map(),
  abrImages: new Map(),     // tipId -> HTMLImageElement
  abrSourceCanvases: new Map(),
  proceduralTips: new Map(),// "hardness|res" -> canvas
  loadingTips: new Set(),
};

/** Prosedürel ucun üretileceği çözünürlük: 128'in 2'nin kuvveti katları. */
function inkTipRes(sizePx) {
  const need = Math.max(1, sizePx || 0);
  if (need <= INK_TIP_SIZE) return INK_TIP_SIZE;
  let res = INK_TIP_SIZE;
  while (res < need && res < INK_TIP_MAX) res *= 2;
  return Math.min(INK_TIP_MAX, res);
}

/* =========================================================
   fırça uçları
   ========================================================= */
function inkGetBrush(id) {
  const ink = inkState();
  const wanted = typeof inkResolveBrushId === 'function' ? inkResolveBrushId(id) : id;
  return ink.brushes.find(b => b.id === wanted) || ink.brushes[0] || inkDefaultBrushes()[0];
}

function inkProceduralTip(hardness, sizePx) {
  const key = Math.round(clamp(hardness, 0, 1) * 100);
  const res = inkTipRes(sizePx);
  const cacheKey = key + '@' + res;
  const cached = inkRuntimeBrushes.proceduralTips.get(cacheKey);
  if (cached) {
    // LRU: son kullanılanı sona taşı.
    inkRuntimeBrushes.proceduralTips.delete(cacheKey);
    inkRuntimeBrushes.proceduralTips.set(cacheKey, cached);
    return cached;
  }

  const size = res;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { colorSpace: 'srgb' });
  const r = size / 2 - 1;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, r);
  const h = key / 100;
  const solid = clamp(h * 0.88, 0.01, 0.98);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(solid, 'rgba(255,255,255,' + (h >= 0.99 ? 1 : 0.94) + ')');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fill();
  inkRuntimeBrushes.proceduralTips.set(cacheKey, c);
  while (inkRuntimeBrushes.proceduralTips.size > INK_TIP_LIMIT) {
    const first = inkRuntimeBrushes.proceduralTips.keys().next().value;
    inkRuntimeBrushes.proceduralTips.delete(first);
  }
  if (typeof inkPerfCount === 'function') inkPerfCount('tipBuilds');
  return c;
}

function inkTrimTintCache() {
  const cache = inkRuntimeBrushes.tintCache;
  while (cache.size > INK_TINT_LIMIT) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

function inkTrimDynamicTintCache() {
  const cache = inkRuntimeBrushes.dynamicTintCanvases;
  while (cache.size > INK_DYNAMIC_TINT_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
}

/** Fırça ucunu verilen renge boyar; aynı renk tekrar istendiğinde kopya döner.
    `variant` 0'dan büyükse uç yığınındaki (tipVariants) farklı tohumlu uç seçilir. */
function inkTintedTip(brush, color, hardness, sizePx, reusable = false, variant = 0) {
  const src = inkBrushSourceCanvas(brush, hardness, sizePx, variant);
  if (reusable) {
    const key = (brush ? brush.id : 'x') + '|' +
      inkStampTipFingerprint(brush) + '|' +
      Math.round(hardness * 100) + '|' + src.width + 'x' + src.height +
      (variant > 0 ? '|v' + variant : '');
    let c = inkRuntimeBrushes.dynamicTintCanvases.get(key);
    if (c) {
      inkRuntimeBrushes.dynamicTintCanvases.delete(key);
      inkRuntimeBrushes.dynamicTintCanvases.set(key, c);
    } else {
      c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      inkRuntimeBrushes.dynamicTintCanvases.set(key, c);
      inkTrimDynamicTintCache();
    }
    const ctx = c.getContext('2d', { colorSpace: 'srgb' });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-over';
    return c;
  }
  const key = (brush ? brush.id : 'x') + '|' + inkStampTipFingerprint(brush) + '|' + color + '|' +
    Math.round(hardness * 100) + '|' + src.width + 'x' + src.height +
    (variant > 0 ? '|v' + variant : '');
  const cached = inkRuntimeBrushes.tintCache.get(key);
  if (cached) {
    // LRU: son kullanılanı sona taşı.
    inkRuntimeBrushes.tintCache.delete(key);
    inkRuntimeBrushes.tintCache.set(key, cached);
    if (typeof inkPerfCount === 'function') inkPerfCount('tintHits');
    return cached;
  }

  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d', { colorSpace: 'srgb' });
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  inkRuntimeBrushes.tintCache.set(key, c);
  inkTrimTintCache();
  if (typeof inkPerfCount === 'function') inkPerfCount('tintMisses');
  return c;
}

function inkBrushSourceCanvas(brush, hardness, sizePx, variant = 0) {
  if (brush && brush.kind === 'abr' && brush.tipId) {
    const img = inkRuntimeBrushes.abrImages.get(brush.tipId);
    if (img && img.complete && img.naturalWidth) {
      const cached = inkRuntimeBrushes.abrSourceCanvases.get(brush.tipId);
      if (cached) {
        inkRuntimeBrushes.abrSourceCanvases.delete(brush.tipId);
        inkRuntimeBrushes.abrSourceCanvases.set(brush.tipId, cached);
        return cached;
      }
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d', { colorSpace: 'srgb' }).drawImage(img, 0, 0);
      inkRuntimeBrushes.abrSourceCanvases.set(brush.tipId, c);
      while (inkRuntimeBrushes.abrSourceCanvases.size > INK_ABR_SOURCE_LIMIT) {
        inkRuntimeBrushes.abrSourceCanvases.delete(
          inkRuntimeBrushes.abrSourceCanvases.keys().next().value
        );
      }
      return c;
    }
    inkLoadAbrTip(brush.tipId);
  }
  // Yerel kütüphane uçları prosedürel üreticiden gelir (kare, oval, tırmık,
  // gürültü, sulu boya...). Radyal maske yalnızca tipsiz fırçalarda kalır.
  if (brush && brush.tip && typeof inkNativeTipFor === 'function') {
    return inkNativeTipFor(brush, sizePx, hardness, variant);
  }
  return inkProceduralTip(hardness, sizePx);
}

function inkLoadAbrTip(tipId) {
  if (!tipId || inkRuntimeBrushes.loadingTips.has(tipId)) return;
  const url = inkRuntime.importedTips.get(tipId);
  if (!url) return;
  inkRuntimeBrushes.loadingTips.add(tipId);
  const img = new Image();
  img.onload = () => {
    inkRuntimeBrushes.abrImages.set(tipId, img);
    inkRuntimeBrushes.loadingTips.delete(tipId);
    // Yüklenince katmanları tazele (uç artık gerçek dokusunu kullanır).
    if (typeof inkRerenderAllLayers === 'function') inkRerenderAllLayers();
  };
  img.onerror = () => { inkRuntimeBrushes.loadingTips.delete(tipId); };
  img.src = url;
}

/* =========================================================
   damla üretimi
   ========================================================= */
/* Eski EMA tabanlı `inkSmoothPoints` silindi (FAZ 2, madde 6):
   ölü koddan arındırıldı — yumuşatma artık 54-ink-stabilizer.js
   üzerindeki One-Euro Filter'ın kendisi olup vuruş girişinde
   canlı çalışır (tüketicilerin ikisini birden çalıştırmaması için
   çift yumuşatma da önlenmiş olur). */

/** Açıları [-PI, PI] aralığında en kısa yoldan harmanlar. */
function inkLerpAngle(a, b, t) {
  let d = (b || 0) - (a || 0);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return (a || 0) + d * t;
}

/**
 * Damgayı çizer. Eğim varsa damga eğim yönünde döndürülür ve eğime dik
 * eksende yassılaştırılır (referans uygulamanın açı/yuvarlaklık dinamiği).
 * `roundness` fırçanın kendi yuvarlaklığıdır (1 = daire, küçük = yassı uç);
 * `angle` açı titreşimi/jitter için dönüş açısıdır. Eğim, yuvarlaklık ve açı
 * yokken düz drawImage ile birebir aynı sonucu verir.
 */
function inkDrawTiltedStamp(ctx, image, x, y, radius, tilt, angle, roundness,
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

/* K17 · centripetal Catmull-Rom (PS-parite): knot aralığı komşu nokta
   mesafesinin kareköküdür (α=0.5); seyrek/yoğun karışık girdide uniform
   parametrenin aşırı salması (overshoot) ve tepe-döngüsü (cusp/loop)
   olmaz. Bezier formu: b0=p1, b3=p2; teğet katsayısı komşu yaylarla
   orantılı — k1 = d12/((d01+d12)·3), k2 = d12/((d12+d23)·3). Düğümler
   anizotropik uzayda (sx, sy) ölçülür; sonuç ham doküman uzayında döner.
   Dejenere komşu (p0===p1 / p2===p3) teğeti orta yaya eşit bölümle
   besler; bozuk eğri/NaN asla üretilmez. Uçlar garanti: q(0)=p1, q(1)=p2. */
function inkCatmull(p0, p1, p2, p3, t, sx, sy) {
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

/* K18 · sigmoid basınç: S eğrisi σ(6·(t−0.5)), uçlarına normalize
   (s(0)=0, s(1)=1 tam). Doğrusal ara değerlemedeki ani uç geçişleri
   yerine yumuşak açılış/kapanış; worker birebir aynı. */
const INK_SIGMOID_LO = 1 / (1 + Math.exp(3));   // s(0) ham
const INK_SIGMOID_SPAN = 1 / (1 + Math.exp(-3)) - INK_SIGMOID_LO;
function inkSigmoid01(t) {
  return (1 / (1 + Math.exp(-6 * (t - 0.5))) - INK_SIGMOID_LO) / INK_SIGMOID_SPAN;
}

/**
 * Nokta zincirini yay-uzunluğu damlalarına böler (K16).
 *
 * K16 · PS damla emisyonu: damlalar girdi olay sayısından BAĞIMSIZ,
 * sabit `ds = spacingPx` yay mesafesiyle çıkar; `carry` kalan mesafe
 * segmentler arasında taşınır. 2px'lik yoğun girdi de 30px'lik seyrek
 * girdi de aynı fiziksel uzunlukta aynı damla sayısını üretir
 * (önceki segment-başına `steps = ceil(dist/spacing)` modeli 71 damla
 * üretiyordu; yerel: ~19). Catmull-Rom eğrisi köşeli girdiyi de
 * akıcı iz yapar.
 *
 * Hitabet sözleşmeleri (ink-smoke):
 *  • stableOnly ön-geçiş: k carry dizisi yalnızca geçmiş segmentlere
 *    bağımlı → önek dablari uzayan dizide birebir eşleşir; kuyruk
 *    nokta-bitişi damlası stableOnly'de eklenmez.
 *  • spacingJitter slot sayısını değiştirmez; damla kendi segmenti
 *    boyunca ±jitter·spacing/2 kayar (kanal 6, worker birebir aynı).
 *
 * Üretilen her damla `p`, varsa `t`/`a` (eğim) taşır; `k` taper faktörü.
 * @param {Array} points
 * @param {number} spacingPx damlalar arası mesafe (px)
 * @param {(pt:object, pressure:number, index:number)=>void} cb
 */
function inkForEachDab(points, spacingPx, cb, scale, options = {}) {
  if (!points || !points.length) return;
  const spacing = Math.max(0.6, spacingPx || 1);
  // Nokta uzayı her zaman piksel değil: bağlı katmanlarda 0..1 yerel uzay.
  // Aralık piksel cinsinden olduğu için segment uzunluğunu aynı uzaya
  // çevir; aksi halde uzun segmentlere tek damla düşüp çizgi noktalanır.
  let sx = 1, sy = 1;
  if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) {
    sx = sy = scale;
  } else if (scale && typeof scale === 'object') {
    const kx = Number(scale.x), ky = Number(scale.y);
    if (Number.isFinite(kx) && kx > 0) sx = kx;
    if (Number.isFinite(ky) && ky > 0) sy = ky;
  }
  // `br` işaretli nokta, tuval dışına çıkıp geri dönüldüğünü gösterir.
  // Kopukluktan önceki noktayı ve aradaki boşluğu çizmeyiz.
  const stableOnly = !!options.stableOnly;
  const segmentLimit = stableOnly
    ? Math.max(0, points.length - 2)
    : points.length - 1;
  const spacingJitter = clamp(Number(options.spacingJitter) || 0, 0, 1);
  const taperStartPx = Math.max(0, Number(options.taperStartPx) || 0);
  const taperEndPx = stableOnly ? 0 : Math.max(0, Number(options.taperEndPx) || 0);
  const progressOffsetPx = Math.max(0, Number(options.progressOffsetPx) || 0);
  let spacingRemainder = spacing;
  const cumulative = new Float64Array(points.length);
  let totalLengthPx = 0;
  for (let i = 1; i < points.length; i++) {
    if (!points[i].br) {
      totalLengthPx += Math.hypot((points[i].x - points[i - 1].x) * sx, (points[i].y - points[i - 1].y) * sy);
    }
    cumulative[i] = totalLengthPx;
  }
  if (Number.isFinite(options.totalLengthPx)) totalLengthPx = Math.max(totalLengthPx, options.totalLengthPx);
  /* K16.d · tap muafiyeti: PS'te tek tıklama tam boyutlu damga bırakır;
     taper yalnızca İLERİYEN vuruşa uygulanır. Muafiyet dizinin KENDİSİNE
     bakar: baştan AfEt (tap varsay), ≥ 1px segment görülünce kes —
     tek tıklama 2 nokta üretir (p0≈p1) ve segmentler < 1px kalır.
     Commit ve canlı önizleme aynı diziyi işlerken aynı kararı verir,
     böylece K15 canlı==commit paritesi korunur. Gerçek vuruşlarda
     segmentler aralık (≥spacing) kadar açıldığından muafiyet kapalıdır
     ve taper incelmesi düzgün sürer. */
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
  const randomStroke = { id: options.strokeId || '' };
  let lastContinuousPoint = points[0];
  if (!points[0].br) {
    const first = Object.assign({}, points[0]);
    first.k = taper(0);
    cb(first, first.p, 0);
    lastContinuousPoint = first;
  }
  let index = 1;
  if (points.length === 1) return;
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
    // K16 · yay-uzunluğu emisyon: carry segmentler arasında yaşar.
    let traveled = spacingRemainder;
    while (traveled <= dist) {
      // spacingJitter: slot konumu sabit (damla sayısı girdi
      // frekansından bağımsız kalır); damla ±jitter·spacing/2
      // kayar (kanal 6 — ink-worker birebir aynı).
      let t = traveled / dist;
      if (spacingJitter > 0) {
        t = clamp(t + (inkStrokeRandom(randomStroke, index, 6) - 0.5) *
          spacingJitter * spacing / dist, 0.001, 0.999);
      }
      const q = inkCatmull(p0, p1, p2, p3, t, sx, sy);
      q.k = taper(cumulative[i] + dist * t);
      // K18 · sigmoid basınç: segment içinde doğrusal değil, uçları
      // koruyan S eğrisiyle (k=6) değerlenir — PS graduated-pressure
      // eşleniği; düşük basınçta damla boyutu yumuşak geçer.
      q.p = pa + (pb - pa) * inkSigmoid01(t);
      q.s = sa + (sb - sa) * t;
      if (tilted) {
        q.t = ta + (tb - ta) * t;
        q.a = inkLerpAngle(p1.a || 0, p2.a || 0, t);
      }
      cb(q, q.p, index++);
      lastContinuousPoint = q;
      traveled += spacing;
    }
    spacingRemainder = traveled - dist;
  }
  // Kuyruk: tam vuruşta bitiş noktası damlası garanti (eski modelde
  // segment sonları t=1 ile örnekleniyordu). stableOnly (artımlı
  // önizleme) kuyruk eklemez: dambalar sonraki karede carry ile gelir.
  const lastPoint = points[points.length - 1];
  if (!stableOnly && !lastPoint.br &&
      (!lastContinuousPoint ||
       Math.hypot((lastPoint.x - lastContinuousPoint.x) * sx,
         (lastPoint.y - lastContinuousPoint.y) * sy) > 0.001)) {
    const last = Object.assign({}, lastPoint);
    last.k = taper(totalLengthPx);
    cb(last, last.p, index);
  }
}

const INK_FILL_MAX_PIXELS = 8000000;

function inkFloodFillContext(ctx, point, color, opacity, tolerance = 24, lockAlpha = false) {
  if (!ctx || !ctx.canvas || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const pixelCount = width * height;
  if (!width || !height || pixelCount > INK_FILL_MAX_PIXELS) return false;
  const sx = Math.floor(point.x);
  const sy = Math.floor(point.y);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return false;

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const seed = (sy * width + sx) * 4;
  const target = [data[seed], data[seed + 1], data[seed + 2], data[seed + 3]];
  // Alfa kilidi: şeffaf pikseller boyanamaz; tohum şeffafsa dolgu no-op.
  if (lockAlpha && data[seed + 3] === 0) return false;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = 1;
  const colorCtx = colorCanvas.getContext('2d', { colorSpace: 'srgb' });
  if (!colorCtx) return false;
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = color || '#ffffff';
  colorCtx.globalAlpha = clamp(Number.isFinite(opacity) ? opacity : 1, 0, 1);
  colorCtx.fillRect(0, 0, 1, 1);
  const replacement = colorCtx.getImageData(0, 0, 1, 1).data;
  const range = clamp(Number(tolerance) || 0, 0, 255);
  /* Eşleştirme HAM RGBA (eski davranış — sızdırmaz): solgun AA kenardan
     dışarı geçişi ham test engeller. Beyaz kalıntıları iki ek adım
     temizler: 2px gömme + kapalı delik geçişi (aşağıda). */
  const matches = index => Math.abs(data[index] - target[0]) <= range &&
    Math.abs(data[index + 1] - target[1]) <= range &&
    Math.abs(data[index + 2] - target[2]) <= range &&
    Math.abs(data[index + 3] - target[3]) <= range;
  if (!matches(seed) || matchesColor(target, replacement, 0)) return false;

  const queue = new Int32Array(pixelCount);
  const filled = new Uint8Array(pixelCount);
  let head = 0, tail = 0;
  const paint = index => {
    if (lockAlpha && data[index + 3] === 0) return false;
    data[index] = replacement[0];
    data[index + 1] = replacement[1];
    data[index + 2] = replacement[2];
    data[index + 3] = replacement[3];
    queue[tail++] = index >> 2;
    filled[index >> 2] = 1;
    return true;
  };
  paint(seed);
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) {
      const next = pixel * 4 - 4;
      if (matches(next)) paint(next);
    }
    if (x + 1 < width) {
      const next = pixel * 4 + 4;
      if (matches(next)) paint(next);
    }
    if (y > 0) {
      const next = (pixel - width) * 4;
      if (matches(next)) paint(next);
    }
    if (y + 1 < height) {
      const next = (pixel + width) * 4;
      if (matches(next)) paint(next);
    }
  }
  /* FAZ 7.X: 2px GÖMME — sel boya vuruşun AA halkasının dışında durur;
     halka beyaza karışık yarı-ton olduğu için içeride beyazımsı bir ring
     kalıyordu (kullanıcı bildirimi). Dolgu maskesini 2 tur genişleteerek
     dolguyu halkanın altına yatır. Kural: yalnız YARI ŞEFFAF piksellere
     (0 < alfa < 255) genişler — opak sınır çekirdeği asla boyanmaz
     (test: boundaryKept), boş zemine halo yazılmaz. lockAlpha aynen. */
  for (let ring = 0; ring < 2; ring += 1) {
    const adds = [];
    for (let p = 0; p < pixelCount; p += 1) {
      if (!filled[p]) continue;
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0 && !filled[p - 1] && data[(p - 1) * 4 + 3] !== 0 && data[(p - 1) * 4 + 3] !== 255) adds.push(p - 1);
      if (x + 1 < width && !filled[p + 1] && data[(p + 1) * 4 + 3] !== 0 && data[(p + 1) * 4 + 3] !== 255) adds.push(p + 1);
      if (y > 0 && !filled[p - width] && data[(p - width) * 4 + 3] !== 0 && data[(p - width) * 4 + 3] !== 255) adds.push(p - width);
      if (y + 1 < height && !filled[p + width] && data[(p + width) * 4 + 3] !== 0 && data[(p + width) * 4 + 3] !== 255) adds.push(p + width);
    }
    if (!adds.length) break;
    for (const q of adds) {
      const i = q * 4;
      if (lockAlpha && data[i + 3] === 0) continue;
      data[i] = replacement[0];
      data[i + 1] = replacement[1];
      data[i + 2] = replacement[2];
      data[i + 3] = replacement[3];
      filled[q] = 1;
    }
  }
  /* FAZ 7.X: KAPALI DELİK geçişi — dolgu bölgesiyle çevrili ama sel
     boyanın giremediği pikseller (vuruş grain'i/nokta aralığı yarattığı
     şeffaf benek-kanallar; ham alfa testi girişi engelliyordu) burada
     boyanır. Kural: kenardan dışarıya bağlantısı YOK (kapalı) VE tam
     opak DEĞİL (alfa < 255 — opak vuruş çekirdeği/başka renkli opak
     öge korunur). Böylece çizgi yollarındaki beyaz benek/kanallar biter,
     dışarısı ve opak içerik dokunulmaz kalır. */
  {
    const outside = new Uint8Array(pixelCount);
    const bfs = new Int32Array(pixelCount);
    let bh = 0, bt = 0;
    const seedOut = p => {
      if (!outside[p] && !filled[p]) { outside[p] = 1; bfs[bt++] = p; }
    };
    for (let x = 0; x < width; x += 1) { seedOut(x); seedOut((height - 1) * width + x); }
    for (let y = 0; y < height; y += 1) { seedOut(y * width); seedOut(y * width + width - 1); }
    while (bh < bt) {
      const p = bfs[bh++];
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0) seedOut(p - 1);
      if (x + 1 < width) seedOut(p + 1);
      if (y > 0) seedOut(p - width);
      if (y + 1 < height) seedOut(p + width);
    }
    for (let p = 0; p < pixelCount; p += 1) {
      if (filled[p] || outside[p]) continue;
      const i = p * 4;
      if (data[i + 3] === 255) continue; /* opak içerik korunur */
      if (lockAlpha && data[i + 3] === 0) continue;
      data[i] = replacement[0];
      data[i + 1] = replacement[1];
      data[i + 2] = replacement[2];
      data[i + 3] = replacement[3];
    }
  }
  ctx.putImageData(image, 0, 0);
  return true;
}

function matchesColor(a, b, tolerance) {
  return Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance &&
    Math.abs(a[3] - b[3]) <= tolerance;
}

function inkDrawGradientOnContext(ctx, stroke, map, lockAlpha = false) {
  if (!ctx || !stroke.points || stroke.points.length < 2) return;
  const start = map(stroke.points[0]);
  const end = map(stroke.points[stroke.points.length - 1]);
  if (!start || !end || Math.hypot(end.x - start.x, end.y - start.y) < 1) return;
  const sample = document.createElement('canvas');
  sample.width = sample.height = 1;
  const sampleCtx = sample.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!sampleCtx) return;
  sampleCtx.fillStyle = stroke.color || '#ffffff';
  sampleCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = sampleCtx.getImageData(0, 0, 1, 1).data;
  const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  /* FAZ 7.W · çok-duraklı gradyan: stroke.stops = [{ pos 0..1, color hex,
     alpha 0..1 }, ...] sıralı ≥2 durak. Durağı olmayan (eski kayıt /
     replay) vuruşlarda mevcut iki-durak soluklaşma AYNEN korunur —
     rgba(color,1) → rgba(color,0): geriye dönük uyumluluk bit-birebir. */
  const stops = Array.isArray(stroke.stops) && stroke.stops.length >= 2 ? stroke.stops : null;
  if (stops) {
    let lastPos = -0.000001;
    for (const s of stops) {
      const pos = clamp(Number(s && s.pos), 0, 1);
      /* Canvas addColorStop artan pos ister: sıralı gelmezse kelepçele
         (biraz ileri it) — sıralı geliyor ama savunmacı kal. */
      const p = Math.max(pos, lastPos);
      lastPos = p;
      sampleCtx.fillStyle = s.color || '#ffffff';
      sampleCtx.fillRect(0, 0, 1, 1);
      const [sr, sg, sb] = sampleCtx.getImageData(0, 0, 1, 1).data;
      const sa = clamp(Number.isFinite(s && s.alpha) ? Number(s.alpha) : 1, 0, 1);
      gradient.addColorStop(p, `rgba(${sr},${sg},${sb},${sa})`);
    }
  } else {
    gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  }
  ctx.save();
  // Alfa kilidi: gradyan yalnızca mevcut piksellerin üzerine basar.
  ctx.globalCompositeOperation = lockAlpha ? 'source-atop' : 'source-over';
  ctx.globalAlpha = clamp(stroke.opacity, 0, 1);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

function inkDrawSmudgeOnContext(ctx, stroke, opts, brush) {
  const canvas = ctx && ctx.canvas;
  if (!canvas || !stroke.points || !stroke.points.length) return;
  const map = opts.mapPoint;
  const sizePx = Math.max(1, opts.sizePx || 1);
  const radiusMax = sizePx / 2;
  /* FAZ 7.R · canlı artımlı smudge (opts.skipDabs):
     - pass 1 saf yürüyüş: dab konumları toplanır, çizim/IO yok.
       dabIndex < skipDabs: yalnız 'previous' izi GIYDIR — rezervuar
       evrimi atlanır (kare sınırı görsel yakınlığı; finalize tam
       yeniden çizimle birebir commit sonucu verir).
     - dabIndex >= skipDabs: çizilecek YENİ dablar.
     - IO kutusu yalnız yeni dabların (ve pickup örnek noktalarının)
       çevresidir → her canlı kare maliyeti O(yeni dablar).
     - Dönüş = yürüyüş dab sayısı (processedDabs sözleşmesi). */
  const skipDabs = Math.max(0, opts.skipDabs | 0);
  const spacing = Math.max(0.8, sizePx * clamp(stroke.spacing || 0.12, 0.01, 2));
  let previous = null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = [];
  let walkTotal = 0;
  inkForEachDab(stroke.points, spacing, (pt, _pressure, dabIndex) => {
    walkTotal = dabIndex + 1;
    const p = map(pt);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (dabIndex < skipDabs) {
      // Pas geçen dab: konum izi yalnız pickup sürekliliği içindir.
      previous = p;
      return;
    }
    // Pickup noktası (önceki dab merkezi → bu dab'a %25): birincisi
    // pas kümesine uzanabilir → kutuya katılır ki ilk yeni dab
    // gerçek scratch içeriğini örnekleyebilsin.
    const pickup = previous
      ? { x: previous.x + (p.x - previous.x) * 0.25,
          y: previous.y + (p.y - previous.y) * 0.25 }
      : p;
    minX = Math.min(minX, p.x, pickup.x);
    minY = Math.min(minY, p.y, pickup.y);
    maxX = Math.max(maxX, p.x, pickup.x);
    maxY = Math.max(maxY, p.y, pickup.y);
    walk.push({ pt, p, dabIndex, pickup });
    previous = p;
  }, opts.pointScale, {
    strokeId: stroke.id,
    spacingJitter: clamp(Number(stroke.spacingJitter) || 0, 0, 1),
    taperStartPx: (stroke.taperStart || 0) * sizePx,
    taperEndPx: (stroke.taperEnd || 0) * sizePx,
    stableOnly: !!opts.stableOnly,
  });
  if (!Number.isFinite(minX)) return Math.max(skipDabs, walkTotal);
  const x0 = Math.max(0, Math.floor(minX - radiusMax - 2));
  const y0 = Math.max(0, Math.floor(minY - radiusMax - 2));
  const x1 = Math.min(canvas.width, Math.ceil(maxX + radiusMax + 2));
  const y1 = Math.min(canvas.height, Math.ceil(maxY + radiusMax + 2));
  if (x1 <= x0 || y1 <= y0) return Math.max(skipDabs, walkTotal);
  if (!walk.length) return Math.max(skipDabs, walkTotal);

  const image = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const data = image.data;
  const width = image.width;
  const height = image.height;
  const flow = clamp(Number.isFinite(stroke.flow) ? stroke.flow : 0.32, 0.01, 1);
  const flowJitter = clamp(Number.isFinite(stroke.flowJitter) ? stroke.flowJitter : 0, 0, 1);
  const hardness = clamp(Number.isFinite(stroke.hardness)
    ? stroke.hardness : (brush && brush.hardness) || 0.72, 0, 1);
  const strength = clamp(stroke.opacity, 0, 1) * flow;
  const maskResolution = 1024;
  const radialMask = new Float32Array(maskResolution + 1);
  const softEdgeWidth = Math.max(0.001, 1 - hardness);
  for (let i = 0; i <= maskResolution; i++) {
    const distance = Math.sqrt(i / maskResolution);
    const edge = hardness >= 0.999 ? 1 :
      clamp((1 - distance) / softEdgeWidth, 0, 1);
    radialMask[i] = edge * edge * (3 - 2 * edge);
  }
  const sampleColor = (cx, cy, sampleRadius) => {
    /* FAZ 3-2: doğrudan LINEER örnekleme — 9 örneklik ağırlıklı
       ortalama lineer uzamda toplanır (gamma'da ortalama murky'dır). */
    let red = 0, green = 0, blue = 0, alpha = 0, count = 0;
    const offsets = [-0.5, 0, 0.5];
    for (const oy of offsets) {
      for (const ox of offsets) {
        const x = clamp(Math.round(cx + ox * sampleRadius), 0, width - 1);
        const y = clamp(Math.round(cy + oy * sampleRadius), 0, height - 1);
        const i = (y * width + x) * 4;
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
  /* FAZ 7.S · rezervuar kalıcılığı (canlı == commit): canlı artımlı
     karelerde (skipDabs>0) rezervuar zinciri vuruş üzerinde taşınır;
     her kare sıfırdan başlamaz. Böylece canlı zincir, finalize/replay'in
     tek geçişlik (skipDabs=0) zinciriyle bit-birebir aynıdır — indüksiyon:
     n. dab zincirin (n−1). adımdaki durumuyla basıldığı sürece scratch
     ara durumu da kanonik yürüyüşle aynı ilerler, dolayısıyla pickup
     örnekleri ve birikim karışımı dab dab eşittir. Eski davranışta her
     kare rezervuarı ilk yeni dabın pickup'ıyla yeniden köklendiriyordu;
     finalize ise tüm dablar boyunca sürekli evriliyordu → bırakışta
     renkler "yikanmış" dönüyordu (kullanıcı raporu: çizerken güzel,
     bırakınca farklı). skipDabs=0 çağrıları (ilk canlı kare, finalize,
     replay/worker) daima taze zincirle başlar: kanonik. */
  const smudgeHost = opts.__smudgeHost || stroke;
  const smudgeChan = Math.max(0, opts.__smudgeChan | 0);
  /* smudgeLive: editör canlı-artımlı protokolü bayrakla bildirir
     (opts.smudgeLiveChain). İlk canlı kare dahil TÜM karelerde zincir
     okunur/kaydedilir — skipDabs=0 ilk karede zincirin İLK yarısı
     basılır ve saklanması gerekir; aksi hâlde 2. kare yeniden
     köklenir ve canlı sonuç kanonik redo'dan ayrışır (maxD 255 ile
     ölçüldü). Bayraksız çağrılar (replay/worker/undo) daima kanonik
     taze zincir kullanır. */
  const smudgeLive = opts.smudgeLiveChain === true;
  let smudgeChains = null;
  let reservoir = null;
  if (smudgeLive) {
    smudgeChains = smudgeHost.__smudgeRes || (smudgeHost.__smudgeRes = []);
    const saved = smudgeChains[smudgeChan];
    if (saved && saved.length === 4) reservoir = saved.slice();
  }
  /* FAZ 7.R pass 2: yalnız YENİ dablar boyanır; pickup noktaları pass 1'de
     hesaplanıp yürüyüş girdisinde taşındığından rezervuar zinciri aynı
     deterministiktir (inkStrokeRandom dabIndex anahtarlı). */
  for (const entry of walk) {
    const pt = entry.pt;
    const p = entry.p;
    const dabIndex = entry.dabIndex;
    {
      const radius = Math.max(0.5, Math.min(radiusMax,
        inkDabRadius(sizePx, brush, clamp(pt.p, 0.02, 1), clamp(pt.s || 0, 0, 1),
          stroke.speedSize || 0, Math.min(sizePx / 2, spacing * 0.62)) *
        (Number.isFinite(pt.k) ? clamp(pt.k, 0, 1) : 1)));
      const cx = p.x - x0, cy = p.y - y0;
      const pickup = sampleColor(entry.pickup.x - x0, entry.pickup.y - y0,
        Math.max(1, radius * 0.22));
      if (pickup) {
        /* reservoir ARTIK LINEER uzamdadır (FAZ 3-2): pickup [r,g,b 0..1
           lineer, a]; karışım oranı aynı, uzay lineer → reçervuar rengi
           boyunca gerçek ortalamalar alır. */
        if (!reservoir) reservoir = pickup;
        else {
          const mix = clamp(0.08 + flow * 0.12, 0.08, 0.2);
          for (let c = 0; c < 4; c++) reservoir[c] += (pickup[c] - reservoir[c]) * mix;
        }
      }
      if (!reservoir) continue;

      const left = Math.max(0, Math.floor(cx - radius));
      const right = Math.min(width - 1, Math.ceil(cx + radius));
      const top = Math.max(0, Math.floor(cy - radius));
      const bottom = Math.min(height - 1, Math.ceil(cy + radius));
      const pressure = clamp(pt.p, 0.02, 1);
      const dabStrength = clamp(strength * pressure *
        (1 - inkStrokeRandom(stroke, dabIndex, 2) * flowJitter) *
        (Number.isFinite(pt.k) ? clamp(pt.k, 0, 1) : 1), 0, 1);
      const sourceAlpha = clamp(reservoir[3], 0, 1);
      /* FAZ 3-2: reservoir [0]..[2] lineer (0..1); hedef gamma 8-bit,
         karışım inkDabOverChannel içinde LINEER uzayda yapılır. */
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
          const i = (y * width + x) * 4;
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
    }
  }
  ctx.putImageData(image, x0, y0);
  /* FAZ 7.S: canlı kare sonunda zinciri sakla — sonraki kare kaldığı
     yerden sürer (commit/finalize sonrası zincir silinir; replay daima
     kanonik taze zincirle yeniden kurar). */
  if (smudgeLive) smudgeChains[smudgeChan] = reservoir ? reservoir.slice() : null;
  return Math.max(skipDabs, walkTotal);
}

/* =========================================================
   FAZ 6 madde 13 · LIQUIFY (piksel it/çek)
   ---------------------------------------------------------
   smudge ile aynı formül ailesi: bölge tek getImageData/putImageData,
   damlalar inkForEachDab ile, kenar yumuşatma radial maskesi. Fark:
   renk karışımı yerine İÇERİK YER DEĞİŞİMİ —

   • her damla yönlü yer değiştirme alanıdır: içerik, sürükleme
     yönünde damla merkezi altından displacement kadar öne taşınır
     (out[dest] = sample(src), src = dest − g·dir).
   • damlalar SEKANSEL işlenir (dab n, dab n−1 sonucu üstüne biner)
     → sıvı hissi; smudge rezervuarı gibi deterministiktir: rebuild
     (29-ink-render) aynı sonucu tekrar üretir.
   • g = d̂ · dispMax · radialMask; dispMax = min(dragLength,
     radius×1.15) × güç (opacity) × basınç.
   • in-place yazım güvenli: her damlada damla kutusu (±displacement
     payı) snapshot'a kopyalanır; okumalar snapshot'tan yapılır.
   • canlı önizleme damla hayaleti (inkDrawLiveDab); gerçek warp
     commit'te inkDrawStrokeOnContext ile, worker DIŞI senkron.
   ========================================================= */
function inkDrawLiquifyOnContext(ctx, stroke, opts, brush) {
  const canvas = ctx && ctx.canvas;
  if (!canvas || !stroke.points || !stroke.points.length) return;
  const map = opts.mapPoint;
  const sizePx = Math.max(1, opts.sizePx || 1);
  const radiusMax = sizePx / 2;
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
  const x0 = Math.max(0, Math.floor(minX - radiusMax - 2));
  const y0 = Math.max(0, Math.floor(minY - radiusMax - 2));
  const x1 = Math.min(canvas.width, Math.ceil(maxX + radiusMax + 2));
  const y1 = Math.min(canvas.height, Math.ceil(maxY + radiusMax + 2));
  if (x1 <= x0 || y1 <= y0) return;

  const image = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const data = image.data;
  const width = image.width;
  const height = image.height;
  const strength = clamp(Number.isFinite(stroke.opacity) ? stroke.opacity : 0.5, 0.01, 1);
  const hardness = clamp(Number.isFinite(stroke.hardness)
    ? stroke.hardness : (brush && brush.hardness) || 0.72, 0, 1);
  const maskResolution = 1024;
  const radialMask = new Float32Array(maskResolution + 1);
  const softEdgeWidth = Math.max(0.001, 1 - hardness);
  for (let i = 0; i <= maskResolution; i++) {
    const distance = Math.sqrt(i / maskResolution);
    const edge = hardness >= 0.999 ? 1 :
      clamp((1 - distance) / softEdgeWidth, 0, 1);
    radialMask[i] = edge * edge * (3 - 2 * edge);
  }
  /* 4 komşu bilinear, LINEER premul uzayda; snapshot γ byte'larından okur. */
  const sampleLinPatch = (buf, w, h, fx, fy) => {
    const sx = clamp(fx, 0, w - 1);
    const sy = clamp(fy, 0, h - 1);
    const bx = Math.floor(sx), by = Math.floor(sy);
    const tx = sx - bx, ty = sy - by;
    const bx1 = Math.min(w - 1, bx + 1), by1 = Math.min(h - 1, by + 1);
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty, w11 = tx * ty;
    const p00 = (by * w + bx) * 4, p10 = (by * w + bx1) * 4;
    const p01 = (by1 * w + bx) * 4, p11 = (by1 * w + bx1) * 4;
    const out = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const s = (buf[p00 + c] * w00 + buf[p10 + c] * w10 +
        buf[p01 + c] * w01 + buf[p11 + c] * w11) / 255;
      out[c] = c < 3 ? inkCanonSRGBToLin01(clamp(s, 0, 1)) : clamp(s, 0, 1);
    }
    return out;
  };
  let snapshot = null;
  let snapX = 0, snapY = 0, snapW = 0, snapH = 0;
  /* damla kutusu (±displacement payı) snapshot'a kopyala: kaynaklar
     damla dairesinin DIŞINA taşabilir. */
  const refreshSnapshot = (left, top, right, bottom) => {
    snapX = left; snapY = top;
    snapW = right - left + 1; snapH = bottom - top + 1;
    const need = snapW * snapH * 4;
    if (!snapshot || snapshot.length < need) snapshot = new Uint8ClampedArray(need);
    for (let row = 0; row < snapH; row++) {
      const from = ((top + row) * width + left) * 4;
      snapshot.set(data.subarray(from, from + snapW * 4), row * snapW * 4);
    }
  };
  const spacing = Math.max(0.8, sizePx * clamp(stroke.spacing || 0.12, 0.01, 2));
  let prev = null; /* önceki map'lenen damla (yön kaynağı) */
  inkForEachDab(stroke.points, spacing, (pt, _pressure, dabIndex) => {
    const p = map(pt);
    if (!p) return;
    if (prev) {
      const dLen = Math.hypot(p.x - prev.x, p.y - prev.y);
      if (dLen >= 0.75) {
        const radius = Math.max(0.5, Math.min(radiusMax,
          inkDabRadius(sizePx, brush, clamp(pt.p, 0.02, 1), clamp(pt.s || 0, 0, 1),
            stroke.speedSize || 0, Math.min(sizePx / 2, spacing * 0.62)) *
          (Number.isFinite(pt.k) ? clamp(pt.k, 0, 1) : 1)));
        const cx = p.x - x0, cy = p.y - y0;
        const dabStrength = clamp(strength * clamp(pt.p, 0.02, 1) *
          (Number.isFinite(pt.k) ? clamp(pt.k, 0, 1) : 1), 0, 1);
        const dispMax = Math.min(dLen, radius * 1.15) * dabStrength;
        if (dispMax > 0.01) {
          const ux = (p.x - prev.x) / dLen;
          const uy = (p.y - prev.y) / dLen;
          const left = Math.max(0, Math.floor(cx - radius));
          const right = Math.min(width - 1, Math.ceil(cx + radius));
          const top = Math.max(0, Math.floor(cy - radius));
          const bottom = Math.min(height - 1, Math.ceil(cy + radius));
          refreshSnapshot(
            Math.max(0, Math.floor(cx - radius - dispMax)),
            Math.max(0, Math.floor(cy - radius - dispMax)),
            Math.min(width - 1, Math.ceil(cx + radius + dispMax)),
            Math.min(height - 1, Math.ceil(cy + radius + dispMax)));
          const radiusSquared = radius * radius;
          const maskMax = radialMask.length - 1;
          for (let y = top; y <= bottom; y++) {
            for (let x = left; x <= right; x++) {
              const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
              const distanceSquared = dx * dx + dy * dy;
              if (distanceSquared > radiusSquared) continue;
              const maskIndex = Math.min(maskMax,
                Math.round(distanceSquared / radiusSquared * maskMax));
              const g = dispMax * radialMask[maskIndex];
              if (g <= 0.001) continue;
              /* içerik +dir yönünde g kadar akar: kaynak = hedef − g */
              const s = sampleLinPatch(snapshot, snapW, snapH,
                (x - snapX) + 0.5 - ux * g, (y - snapY) + 0.5 - uy * g);
              const i = (y * width + x) * 4;
              const a = s[3];
              if (a <= 0) {
                data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
                continue;
              }
              data[i] = Math.round(inkCanonLin01ToSRGB(clamp(s[0] / a, 0, 1)) * 255);
              data[i + 1] = Math.round(inkCanonLin01ToSRGB(clamp(s[1] / a, 0, 1)) * 255);
              data[i + 2] = Math.round(inkCanonLin01ToSRGB(clamp(s[2] / a, 0, 1)) * 255);
              data[i + 3] = Math.round(a * 255);
            }
          }
        }
      }
    }
    prev = p;
  }, opts.pointScale, {
    strokeId: stroke.id,
    spacingJitter: clamp(Number(stroke.spacingJitter) || 0, 0, 1),
    taperStartPx: (stroke.taperStart || 0) * sizePx,
    taperEndPx: (stroke.taperEnd || 0) * sizePx,
  });
  ctx.putImageData(image, x0, y0);
}

/* =========================================================
   vuruş çizimi
   ========================================================= */
/**
 * Bir vuruşu verilen 2B bağlama çizer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} stroke
 * @param {object} opts
 *   mapPoint(point) -> {x,y}      vuruş uzayından hedef px uzayına
 *   sizePx(stroke) -> number      fırça çapı (hedef px)
 *   scale?                        dünya→px ölçeği (şekiller için)
 */
/* =========================================================
   FAZ 6 madde 11 · SİMETRİ MOTORU
   ---------------------------------------------------------
   Tek ek noktası: inkDrawStrokeOnContext girişinde stroke.sym !=
   'off' ise vuruş noktaları dönüştürülmüş klonlara açılır ve her
   klon sym'siz (tek örnek, yeniden giriş yok) AYNI opts ile
   inkDrawStrokeOnContext'a verilir.

   - opts aynen geçer: skipDabs her örnekte aynı damla alt kümesini
     işler (canlı önizleme artımlısı kanallarda örnek bijeksiyonu
     korunur); GL yolu (inkDabGlApply → inkDrawStrokeOnContext)
     otomatik kapsanır.
   - inkStrokeRandom deterministiktir (id + dabIndex): kanallar aynı
     rastgeleliği paylaşır — ayna tarafları birebir eşlenir.
   - Dönüşüm: mirrorX/Y/XY normalize 0..1 nokta uzayında (x'=1-x);
     radialN piksel uzayında opts.pointScale {x:W,y:H} üzerinden
     tuval merkezinden döner (ölçekçe doğrusal hatasız).
   - smudge benzeri ctx-okuyan kanallar aynada mevcut boyaya basar
     (klonlar sırayla çizilir → ayna tarafı öncesi içerik görür).
   - Kimlik klonu ilk sırada: kök vuruş her zaman tam çizer.
   ========================================================= */
const INK_SYM_MODES = ['off', 'mirrorX', 'mirrorY', 'mirrorXY', 'radial4', 'radial8'];

function inkSymMirrorPoints(points, axis) {
  const flipX = axis === 'x' || axis === 'xy';
  const flipY = axis === 'y' || axis === 'xy';
  return points.map(p => {
    const q = { ...p };
    if (flipX) {
      q.x = 1 - p.x;
      if (typeof p.a === 'number') q.a = Math.PI - p.a;
    }
    if (flipY) {
      q.y = 1 - p.y;
      if (typeof p.a === 'number') q.a = flipX ? p.a + Math.PI : -p.a;
    }
    return q;
  });
}

function inkSymRadialPoints(points, n, scale) {
  const out = [];
  for (let i = 1; i < n; i++) {
    const th = (Math.PI * 2 * i) / n;
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const cx = scale ? scale.x / 2 : 0.5;
    const cy = scale ? scale.y / 2 : 0.5;
    const sx = scale ? scale.x : 1;
    const sy = scale ? scale.y : 1;
    const thDeg = th;
    out.push(points.map(p => {
      const px = scale ? p.x * sx : p.x;
      const py = scale ? p.y * sy : p.y;
      const dx = px - cx;
      const dy = py - cy;
      const nx = cx + dx * cos - dy * sin;
      const ny = cy + dx * sin + dy * cos;
      return {
        ...p,
        x: nx / sx,
        y: ny / sy,
        // dönme: imleç açısı da kanalla döner (damga hizası korunur)
        a: typeof p.a === 'number' ? p.a + thDeg : p.a,
      };
    }));
  }
  return out;
}

/** Sert klonlar: [kimlik, ...dönüşümler]. sym alanı klonlardan SİLİNİR
    (tekrar-kanal açılımı yok). Mod bilinmiyorsa yalnızca kimlik döner —
    kirli kayıtta vuruş ayna-görsünde yanlış çizmez. */
function inkSymmetryStrokeClones(stroke, opts) {
  const pts = stroke.points;
  const mode = String(stroke.sym || 'off');
  let extra = null;
  if (pts && pts.length) {
    if (mode === 'mirrorX') extra = [inkSymMirrorPoints(pts, 'x')];
    else if (mode === 'mirrorY') extra = [inkSymMirrorPoints(pts, 'y')];
    else if (mode === 'mirrorXY') extra = [
      inkSymMirrorPoints(pts, 'x'),
      inkSymMirrorPoints(pts, 'y'),
      inkSymMirrorPoints(pts, 'xy'),
    ];
    else {
      const m = /^radial([0-9]+)$/.exec(mode);
      if (m) {
        const n = clamp(Math.round(Number(m[1])), 2, 48);
        if (n > 1) {
          extra = inkSymRadialPoints(pts, n, opts.pointScale || null);
        }
      }
    }
  }
  if (!extra || !extra.length) {
    return [{ ...stroke, sym: undefined }];
  }
  return [{ ...stroke, sym: undefined }].concat(
    extra.map(points => ({ ...stroke, sym: undefined, points })));
}

/** Sınır hesabı için: klonların TÜM noktaları (sym==off iken yalnız
    kimlik). FullRasterRect + tile/dirty aralıkları bunu union'lar;
    ayna içeriği tuval dışına taşmadığı için drawImage kırpma
    birleşik kutu dışı pikselli kaybı yaratmaz. */
function inkSymmetryAllPoints(stroke, opts) {
  return inkSymmetryStrokeClones(stroke, opts)
    .reduce((acc, clone) => acc.concat(clone.points), []);
}

function inkDrawStrokeOnContext(ctx, stroke, opts) {
  if (!stroke || !stroke.points.length || !opts) return;
  // FAZ 6 madde 11: kanal açılımı — vuruş transformilmiş klonlara
  // aynı opts'la (skipDabs dahil) tekrar girer. Klonlarda sym yok.
  // FAZ 6 madde 11: kanal açılımı — vuruş transformilmiş klonlara
  // aynı opts'la (skipDabs dahil) tekrar girer. Klonlarda sym yok.
  /* FAZ 7.Q: processedDabs klonlar ARASINDAKİ BİLDİĞİM hizaya dayanır:
     klon noktaları kök noktalarının ÖLÜRÜM koruyan (ayna/dönüş) dönüşleridir →
     inkForEachDab yürüyüşünün dab indeksleri kök klon arasında birebir
     hizalıdır; inkStrokeRandom(stroke.id + dabIndex + kanal) da aynıdır.
     Bu sayede çağıran artımlı hattan (skipDabs) her karede yalnız YENİ
     dab indeksleri tüm klonlar üzerinden geçebilir ve dönüş sayımı
     kök yürüyüşüyle aynıdır — M5'teki "artımlı olamaz" kuralı biter. */
  const symMode = stroke.sym || 'off';
  if (symMode !== 'off') {
    const symClones = inkSymmetryStrokeClones(stroke, opts);
    let symProcessed = 0;
    let symIndex = 0;
    for (const symClone of symClones) {
      /* FAZ 7.S: her klonun KENDİ rezervuar zinciri vardır; klon nesneleri
         kare başına yeniden kurulduğu için kalıcılık kök vuruşta kanal
         başına saklanır (__smudgeRes[chan]). Zincirler dab indeksine
         anahtarlı random'la aynı deterministik sırayı izler. */
      const cloneOpts = Object.assign({}, opts, {
        __smudgeHost: stroke,
        __smudgeChan: symIndex + 1,
      });
      symProcessed = Math.max(symProcessed,
        inkDrawStrokeOnContext(ctx, symClone, cloneOpts) | 0);
      symIndex += 1;
    }
    return symProcessed;
  }
  const brush = opts.brush || inkGetBrush(stroke.brushId);
  const erase = stroke.tool === 'eraser';
  const map = opts.mapPoint;
  const sizePx = Math.max(0.5, opts.sizePx || 1);

  if (stroke.kind === 'fill') {
    const point = map(stroke.points[0]);
    inkFloodFillContext(ctx, point, stroke.color, stroke.opacity, stroke.fillTolerance,
      !!stroke.lockAlpha);
    return;
  }
  if (stroke.kind === 'gradient') {
    inkDrawGradientOnContext(ctx, stroke, map, !!stroke.lockAlpha);
    return;
  }
  if (stroke.kind === 'smudge') {
    /* FAZ 7.R: yürüyüş dab sayısı döner — çağıran artımlı hattın
       (previewSkip) dab indeks sözleşmesi smudge'i de kapsar. */
    return inkDrawSmudgeOnContext(ctx, stroke, opts, brush) || 0;
  }
  if (stroke.kind === 'liquify') {
    inkDrawLiquifyOnContext(ctx, stroke, opts, brush);
    return;
  }

  ctx.save();
  // Alfa kilidi: yalnızca mevcut alfanın üzerine bas (Porter-Duff ATOP).
  // Silgi kilitten bağımsızdır: destination-out zaten yalnızca mevcut
  // piksellere dokunur (kilitli şeffaf alan silgiyle tahtaya boyanamaz).
  ctx.globalCompositeOperation = erase
    ? 'destination-out'
    : (stroke.lockAlpha ? 'source-atop' : 'source-over');
  ctx.globalAlpha = clamp(stroke.opacity, 0, 1);

  /* Serbest elle oturtulan vuruşlar (snapFree) düz yol DEĞİL, normal
     fırça damgalarıyla yazılır: kullanıcı çizerken gördüğü fırça
     dokusu/kalınlığı/ağı korunur. Şekil aracının ince konturu (0.22×)
     yalnızca araçla çizilen shape turlerine uygulanır. */
  if (stroke.kind === 'shape' && !stroke.snapFree) {
    inkDrawShape(ctx, stroke, map, sizePx, erase);
    ctx.restore();
    return;
  }

  // Sert ve sabit basınçlı fırçalarda damla yerine tek quadratic yol:
  // 4000 noktalı bir vuruş yüzlerce damla yerine tek stroke() olur.
  if (typeof inkStrokePathEligible === 'function' &&
      inkStrokePathEligible(stroke, brush, sizePx)) {
    const used = inkDrawStrokeAsPath(ctx, stroke, map, sizePx, brush);
    if (used && typeof inkPerfCount === 'function') {
      inkPerfCount('pathStrokes');
      inkPerfCount('pathPoints', used);
    }
    ctx.restore();
    return;
  }

  const baseAlpha = clamp(stroke.opacity, 0, 1);
  const flow = Number.isFinite(stroke.flow)
    ? clamp(stroke.flow, 0.01, 1)
    : (brush && Number.isFinite(brush.flow) ? clamp(brush.flow, 0.01, 1) : 1);
  const flowJitter = Number.isFinite(stroke.flowJitter)
    ? clamp(stroke.flowJitter, 0, 1)
    : (brush && Number.isFinite(brush.flowJitter) ? clamp(brush.flowJitter, 0, 1) : 0);
  const textured = !!(brush && brush.texture);
  const textureDepth = brush && Number.isFinite(brush.textureDepth)
    ? clamp(brush.textureDepth, 0, 1) : 0.26;
  const textureScale = brush && Number.isFinite(brush.textureScale)
    ? clamp(brush.textureScale, 0.1, 8) : 1;
  const dyn = inkBrushDynamics(brush);
  const colorDynamics = inkPrepareStrokeColor(stroke, brush);
  const scatterX = Math.max(0, Number(brush && brush.scatterX) || 0, stroke.scatter || 0);
  const scatterY = Math.max(0, Number(brush && brush.scatterY) || 0, stroke.scatter || 0);
  const scatterCount = Math.round(clamp(Number(brush && brush.scatterCount) || 1, 1, 16));
  const scatterCountJitter = clamp(Number(brush && brush.scatterCountJitter) || 0, 0, 1);
  const roundness = brush && Number.isFinite(brush.roundness) ? brush.roundness : 1;
  const spacingPx = Math.max(0.8, sizePx * clamp(stroke.spacing || 0.1, 0.01, 2));
  // Dinamik boyut/hız incelmesi yarıçapı küçültürken damla aralığı sabit
  // kalırsa hızlı vuruşlar noktalı görünür. Yarıçapa, aralığın en az
  // ~%62'si kadar taban koyarak zincirin kopmamasını sağla.
  const minRadius = Math.min(sizePx / 2, spacingPx * 0.62);
  let dabs = 0;
  let tip = null;
  // Uç yığını: damla başına rastgele varyant (referans uygulama `Tips` stack). Sabit
  // varyant sayısı ve tohumla uçlar önceden önbelleklenir.
  const tipVariantCount = Math.max(1, Math.round(Number(brush && brush.tipVariants) || 1));
  const tipFlipX = clamp(Number(brush && brush.stampFlipX) || 0, 0, 1);
  const tipFlipY = clamp(Number(brush && brush.stampFlipY) || 0, 0, 1);
  const tipRotRandom = clamp(Number(brush && brush.tipRotation) || 0, 0, 1);
  let tipVariant = 0;
  // Damga kovası ve alfa çoğu damlada değişmez; anahtar kurup LRU'yu
  // güncellemek yerine son sonucu yeniden kullan.
  let lastBucket = -1;
  let lastStamp = null;
  let lastColor = '';
  let lastVariant = -1;
  let lastTipVariant = -1;
  let lastAlpha = -1;
  // `angleFollow` fırçalarında damga açısı vuruş yönünü izler; önceki
  // eşlenmiş nokta bu yüzden saklanır.
  let prevMapped = null;
  /* K14 · önceki çıkarılmış damlanın konumu: örtüşme (overlap)
     tahmini gerçek damla aralığından gelir. */
  let prevDab = null;
  /* K15 · PS çift tampon (dual-buffer): damlalar vuruş-scratch'e TAM
     boyut ağırlığıyla (diyametik × akış × doku — stroke.opacity HARİÇ)
     birikir; scratch hedefe TEK geçişte stroke ile kompozitlenir.
     PS kuralı: "opaklık bir vuruşta birikmez" — iç dolgu, zincir
     uzunluğu ya da damla sayısına bakmaksızın tam vuruş opaklığıdır;
     tek yalıtık damla da %8 opaklıksa %8 görünür (n-root seyreltme bu
     ikisini ancak yaklaşık asla tutturamaz). Gerçek 2D hedeflerde
     (commit / worker raster / test kanalları) etkin; GPU sink ve silgi
     hattı kendi parite turunda (K15.5/K15.6) hizalanır. Yalıtık alan
     üst sınırı aşılırsa (aşırı extreme vuruş) eski yola düşer. */
  let dualX0 = 0, dualY0 = 0, dualBw = 0, dualBh = 0;
  let dualScratch = null, dctx = null;        // dctx boşsa: eski yol
  /* Artımlı önizleme çağrıları (skipDabs > 0) K20'ye dek birikimsiz
     eski yolda dönebilirdi: ayrı kompozit "opaklık çarpanını katlar".
     K20 dualDirect bu kuralı bitirir: artımlı çağrı birikimli
     raster'a doğrudan dual ağırlık yazar (aşağıda). */
  /* K20 · dualDirect — canlı artımlı görünüm, commit'in dual modelinin
     BİREBİR birikimidir: damlalar dual ağırlığıyla (n-root seyreltme
     yok) çağıranın BİRİKİMLİ raster'ına doğrudan yazılır.
     stroke.opacity burada katlanmaz; görüntü/commit tek geçişte taşır
     (referans uygulama: canlı çizim device'a basılan aynı damla dizisidir; ayrı
     önizleme raster'ı yok). skipDabs → her kare yalnızca YENİ dab
     indeksleri; birikim çerçeve sınırlarından bağımsız. */
  /* Tur 4c · serbest elden oturtulan şekiller (snapFree) de PS kuralına
     tabidir: kullanıcı çizerken gördüğü opaklık KORUNMALI. Eski kapı
     (yalnızca kind 'stroke') oturtulan şekli n-root seyreltmeli eski
     yola düşürüyor; şekil, aynı fırçayla çizilen serbest elin ~yarısı
     saydamda kalıyordu ("şekil oturtunca opaklık azalıyor" bug'ının
     kökü). Araç şekilleri (snapFree'siz) inkDrawShape dalına girer,
     buraya hiç ulaşmaz. */
  const strokeLikeKind = stroke.kind === 'stroke' || !stroke.kind ||
    (stroke.kind === 'shape' && stroke.snapFree);
  const dualDirect = !erase && opts.dualDirect === true &&
    typeof ctx.getTransform === 'function' && strokeLikeKind;
  const dualCandidate = dualDirect || (!erase && opts.dualBuffer !== false &&
    !(opts.skipDabs > 0) && typeof ctx.getTransform === 'function' &&
    strokeLikeKind);
  /* K20: çağıraya tek kanal — scratch birikimi gerçekten dual ağırlıkta
     mi çalıştı? Görüntü/commit stroke.opacity çarpanını yalnız o zaman
     tek geçişte uygular. */
  opts.__dualDirect = dualDirect;
  if (dualDirect) {
    // K20: dual tampon OLMUŞ GİBİ davranılmaz — damlalar çağıranın
    // birikimli raster'ına birebir dual ağırlıkla yazılır.
    dctx = ctx;
  } else if (dualCandidate) {
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity, bSeen = 0;
    for (const pt of stroke.points) {
      const mp = map(pt);
      if (!mp) continue;
      if (mp.x < bMinX) bMinX = mp.x;
      if (mp.y < bMinY) bMinY = mp.y;
      if (mp.x > bMaxX) bMaxX = mp.x;
      if (mp.y > bMaxY) bMaxY = mp.y;
      bSeen++;
    }
    if (bSeen > 0) {
      const dualPad = sizePx * 0.62 +
        sizePx * 0.55 * Math.max(scatterX, scatterY) + 2;
      dualX0 = Math.max(0, Math.floor(bMinX - dualPad));
      dualY0 = Math.max(0, Math.floor(bMinY - dualPad));
      dualBw = Math.ceil(bMaxX + dualPad) - dualX0;
      dualBh = Math.ceil(bMaxY + dualPad) - dualY0;
      if (dualBw * dualBh <= 67108864) {         // ≤ 256 MB RGBA güvenlik
        /* FAZ 7.T (byte-pool): vuruş başına geçici tuval üretimi yerine
           aynı (w,h) boyutun serbest listesinden ÖDÜNÇ. Alım anında
           bölge tek seferde clearRect — taze-tuval birebir parite.
           Offscreen/DOM anahtarı ayrı (carışım yok). */
        const OffscreenCtor = typeof OffscreenCanvas === 'function' ? OffscreenCanvas : null;
        const dualWantOff = !!(OffscreenCtor && typeof document === 'undefined');
        dualScratch = inkDualScratchTake(dualBw, dualBh, dualWantOff);
        if (!dualScratch) {
          if (dualWantOff) {
            dualScratch = new OffscreenCtor(dualBw, dualBh);
          } else if (typeof document !== 'undefined') {
            dualScratch = document.createElement('canvas');
            dualScratch.width = dualBw;
            dualScratch.height = dualBh;
          }
        }
        if (dualScratch) {
          dualScratch.__inkDualOff = dualWantOff;
          dualScratch.__inkDualW = dualBw;
          dualScratch.__inkDualH = dualBh;
          dctx = dualScratch.getContext('2d', { colorSpace: 'srgb' });
          dctx.imageSmoothingEnabled = true;
          dctx.imageSmoothingQuality = 'high';
          const DT = ctx.getTransform();
          dctx.setTransform(DT.a, DT.b, DT.c, DT.d, DT.e, DT.f);
          dctx.translate(-dualX0, -dualY0);
        }
      }
    }
  }

  // Önizleme artımlıdır: önceki karede çizilmiş damlalar bu karede
  // yeniden hesaplanmaz; yalnızca son eşlenmiş nokta (açı takibi için)
  // güncellenir. Görsel sonuç birebir aynıdır.
  const skipDabs = Math.max(0, opts.skipDabs | 0);

  inkForEachDab(stroke.points, spacingPx, (pt, _pressure, dabIndex) => {
    const p = map(pt);
    if (!p) return;
    dabs++;
    if (dabIndex < skipDabs) {
      prevMapped = { x: p.x, y: p.y };
      prevDab = { x: p.x, y: p.y };
      return;
    }
    const pressure = clamp(pt.p, 0.02, 1);
    const speed = clamp(pt.s || 0, 0, 1);
    // Basınç hem boyutu hem akışı etkiler; fare basıncı 1'dir. Fırça
    // dinamiği (min/maks boyut) varsa çarpan oradan gelir. `velocity`
    // dinamiğinde boyut sürate bağlıdır: hızlı = ince.
    const driver = dyn.src === 'velocity' ? 1 - speed :
      dyn.src === 'random' ? inkStrokeRandom(stroke, dabIndex, 8) : pressure;
    const sizeJitter = clamp(Number(dyn.sizeJitter) || 0, 0, 1);
    const sizeFactor = 1 - sizeJitter / 2 + sizeJitter * inkStrokeRandom(stroke, dabIndex, 9);
    const radius = Math.max(0.35,
      inkDabRadius(sizePx, brush, driver, speed, stroke.speedSize, minRadius) *
      (Number.isFinite(pt.k) ? clamp(pt.k, 0, 1) : 1) * sizeFactor);
    let angle;
    if (brush && brush.angleFollow && prevMapped &&
        (Math.abs(p.x - prevMapped.x) > 0.001 || Math.abs(p.y - prevMapped.y) > 0.001)) {
      angle = Math.atan2(p.y - prevMapped.y, p.x - prevMapped.x) + (brush.angle || 0);
    } else if (pt.t > 0.02) {
      angle = (pt.a || 0) + ((brush && brush.angle) || 0);
    } else {
      angle = (brush && brush.angle) || 0;
    }
    const roundJitter = clamp(Number(dyn.roundnessJitter) || 0, 0, 1);
    const minRound = clamp(Number(dyn.roundnessMin) || 0.05, 0.05, roundness);
    const pressureRound = minRound + (clamp(roundness, minRound, 1) - minRound) * pressure;
    const dabRound = clamp(pressureRound *
      (1 - roundJitter / 2 + roundJitter * inkStrokeRandom(stroke, dabIndex, 10)), minRound, 1);
    if (dyn.angleJitter > 0) {
      angle += (inkStrokeRandom(stroke, dabIndex, 3) * 2 - 1) * Math.PI * dyn.angleJitter;
    }
    // referans tarzı rastgele döndürme + uç varyantı + aynalama. Kanallar
    // worker'la aynı olmak zorunda (15 varyant, 16/17 flip, 18 dönme).
    if (tipRotRandom > 0) {
      angle += inkStrokeRandom(stroke, dabIndex, 18) * Math.PI * 2 * tipRotRandom;
    }
    if (tipVariantCount > 1) {
      tipVariant = Math.min(tipVariantCount - 1,
        Math.floor(inkStrokeRandom(stroke, dabIndex, 15) * tipVariantCount));
    } else {
      tipVariant = 0;
    }
    const dabFlipX = tipFlipX > 0 && inkStrokeRandom(stroke, dabIndex, 16) < tipFlipX;
    const dabFlipY = tipFlipY > 0 && inkStrokeRandom(stroke, dabIndex, 17) < tipFlipY;
    const countOffset = Math.round((inkStrokeRandom(stroke, dabIndex, 11) * 2 - 1) *
      scatterCount * scatterCountJitter);
    const count = clamp(scatterCount + countOffset, 1, 16);
    const scatterJitter = clamp(Number(dyn.scatterJitter) || 0, 0, 1);
    const scatterScale = 1 - scatterJitter * inkStrokeRandom(stroke, dabIndex, 14);
    const dabScatterX = scatterX * scatterScale;
    const dabScatterY = scatterY * scatterScale;
    for (let stampIndex = 0; stampIndex < count; stampIndex++) {
      const randomIndex = dabIndex * 16 + stampIndex;
      let x = p.x, y = p.y;
      if (dabScatterX > 0 || dabScatterY > 0) {
        const angle = inkStrokeRandom(stroke, randomIndex, 0) * Math.PI * 2;
        if (Math.abs(dabScatterX - dabScatterY) < 0.0001 &&
            dabScatterX === (stroke.scatter || 0)) {
          const distance = inkStrokeRandom(stroke, randomIndex, 1) * radius * dabScatterX;
          x += Math.cos(angle) * distance;
          y += Math.sin(angle) * distance;
        } else {
          const distance = Math.sqrt(inkStrokeRandom(stroke, randomIndex, 1));
          x += Math.cos(angle) * distance * radius * dabScatterX;
          y += Math.sin(angle) * distance * radius * dabScatterY;
        }
      }
      let dabFlow = flow;
      if (!erase && flowJitter > 0) {
        dabFlow *= 1 - inkStrokeRandom(stroke, randomIndex, 2) * flowJitter;
      }
      if (brush && brush.airbrush) dabFlow *= 0.14;
      const opacityJitter = clamp(Number(dyn.opacityJitter) || 0, 0, 1);
      const opacitySource = dyn.opacitySrc === 'random'
        ? 1 - opacityJitter * inkStrokeRandom(stroke, randomIndex, 12)
        : (1 - opacityJitter) + opacityJitter * pressure;
      const minOpacity = clamp(Number.isFinite(dyn.opacityMin) ? dyn.opacityMin : 0.35, 0, 1);
      /* K14 · endüstriyel opaklık (PS kuralı: "opaklık bir vuruşta
         birikmez"): bitişik damlalar gerçek çıkarım aralığında üst
         üste biner; damla alfası n-köklü seyreltilir ki örtüşen
         zincirin doygunluğu aynen αsat olsun. Yoğun segment girdisi
         damlayı her segment başına bıraktığı için tahmin KAYIT
         dab-dab mesafesinden gelir — spacingPx'e theorems değil.
         Silgi istişare: silgi vuruş içinde birikir (PS davranışı). */
      /* K14 · damla alfası. K15 çift tampon etkinse damla TAM boyut
         ağırlığıdır (opacity HARİÇ — kompozit tek geçişte uygulanır);
         eski yolda n-root seyreltme sürer. */
      const dabDist = prevDab
        ? Math.max(0.8, Math.hypot(p.x - prevDab.x, p.y - prevDab.y))
        : Math.max(0.8, spacingPx);
      const overlapN = Math.max(1, Math.ceil((radius * 2) / dabDist));
      const dynAlpha = Math.min(1, Math.max(0,
        (minOpacity + (1 - minOpacity) * pressure) * dabFlow * opacitySource));
      const satAlpha = baseAlpha * dynAlpha;
      let alpha = erase ? baseAlpha
        : dctx ? dynAlpha
        : 1 - Math.pow(1 - satAlpha, 1 / overlapN);
      const color = erase ? stroke.color :
        inkStrokeColor(stroke, brush, randomIndex, colorDynamics);
      if (!erase && textured) {
        alpha *= inkTextureGrain(
          brush.textureEachTip ? 0 : x,
          brush.textureEachTip ? 0 : y,
          sizePx, textureDepth, textureScale, brush.textureId,
          brush.textureBrightness, brush.textureContrast,
          brush.textureEachTip, inkStrokeRandom(stroke, randomIndex, 13)
        );
      }
      if (!erase && brush && brush.noise > 0) {
        const noise = inkTextureNoise(x * 0.73 + randomIndex, y * 0.73 - randomIndex);
        alpha *= 1 - brush.noise * (0.25 + 0.55 * noise);
      }
      if (alpha !== lastAlpha) {
        (dctx || ctx).globalAlpha = alpha;
        lastAlpha = alpha;
      }
      let stamp = null;
      if (typeof inkStampFor === 'function') {
        const bucket = typeof inkStampBucket === 'function' ? inkStampBucket(radius * 2) : 0;
        if (lastStamp && bucket === lastBucket && color === lastColor &&
            tipVariant === lastVariant) {
          stamp = lastStamp;
          if (typeof inkPerfCount === 'function') inkPerfCount('stampHits');
        } else {
          stamp = inkStampFor(brush, color, stroke.hardness, radius * 2, erase,
            !!colorDynamics, tipVariant);
          lastBucket = bucket;
          lastStamp = stamp;
          lastColor = color;
          lastVariant = tipVariant;
        }
      }
      let src = stamp ? stamp.canvas : null;
      if (!src) {
        // Damga atlası yoksa (fallback) uç doğrudan seçilir; varyant
        // değişmişse önbellekteki uç yenilenir.
        if (!tip || tipVariant !== lastTipVariant) tip = erase
          ? inkProceduralTip(1, sizePx)
          : inkTintedTip(brush, color, stroke.hardness, sizePx, !!colorDynamics, tipVariant);
        lastTipVariant = tipVariant;
        src = tip;
      }
      inkDrawTiltedStamp(dctx || ctx, src, x, y, radius, pt.t, angle, dabRound,
        dabFlipX, dabFlipY);
      if (!erase && brush && brush.wetEdges > 0) {
        inkWetEdge(dctx || ctx, x, y, radius, dabRound, angle, color, brush.wetEdges, alpha);
      }
      if (!erase && brush && brush.dual) {
        const dualSpacing = clamp(Number(brush.dual.spacing) || 1, 0.25, 3);
        if (dualSpacing > 1) {
          const dualEvery = Math.max(1, Math.round(dualSpacing));
          if (randomIndex % dualEvery === 0) {
            inkDrawDualDab(dctx || ctx, brush, stroke, radius, alpha, erase, x, y,
              pt.t, angle, randomIndex, color, !!colorDynamics);
          }
        } else if (prevMapped) {
          const steps = Math.max(1, Math.round(1 / dualSpacing));
          for (let step = 1; step <= steps; step++) {
            const t = step / steps;
            const dualX = prevMapped.x + (p.x - prevMapped.x) * t;
            const dualY = prevMapped.y + (p.y - prevMapped.y) * t;
            inkDrawDualDab(dctx || ctx, brush, stroke, radius, alpha, erase,
              dualX, dualY, pt.t, angle, randomIndex * 16 + step, color,
              !!colorDynamics);
          }
        } else {
          inkDrawDualDab(dctx || ctx, brush, stroke, radius, alpha, erase, x, y,
            pt.t, angle, randomIndex, color, !!colorDynamics);
        }
      }
    }
    prevMapped = { x: p.x, y: p.y };
    prevDab = { x: p.x, y: p.y };
  }, opts.pointScale, {
    stableOnly: !!opts.stableOnly,
    spacingJitter: dyn.spacingJitter,
    strokeId: stroke.id,
    taperStartPx: (stroke.taperStart || 0) * sizePx,
    taperEndPx: (stroke.taperEnd || 0) * sizePx,
  });
  if (dabs && typeof inkPerfCount === 'function') inkPerfCount('dabs', dabs);
  /* K15 · çift tampon: scratch'i TEK geçişte stroke.opacity ile hedefe
     kompozitle. lockAlpha katmanı boş piksellere taşmaması için ATOP
     olarak kompozitlenir (damlalar scratch içinde zaten source-over). */
  if (dctx && !dualDirect) {
    if (dabs > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = baseAlpha;
      ctx.globalCompositeOperation = stroke.lockAlpha ? 'source-atop' : 'source-over';
      ctx.drawImage(dualScratch, dualX0, dualY0, dualBw, dualBh);
      ctx.restore();
    }
    /* FAZ 7.T (byte-pool): scratch iade — yeni vuruş aynı boyutta
       yeniden üretim yapmaz. dualDirect ve eski yol iade etmez. */
    inkDualScratchGive(dualScratch);
    dualScratch = null;
    dctx = null;
  }
  ctx.restore();
  // Çağıranlar artımlı önizlemede kaç damla işlendiğini bilmek ister;
  // tek damla birden fazla damga çizebildiği için `drawImage` sayısı
  // güvenilir bir indeks değildir.
  return dabs;
}

/** Fırçanın damla dinamiği; tanımsızsa eski doğrusal davranış. */
/* FAZ 7.T (byte-pool): dual scratch havuzu — vuruş sonunda iade edilen
   geçici tuval, aynı (w,h,tip) boyutta bir sonraki vuruşa ÖDÜNÇ verilir.
   Kazanç: vuruş başına createElement/new OffscreenCanvas + Skia backing
   tahsis/el_tempo maliyeti gider; GC baskısı düşer. Alım anında TÜM
   alan clearRect — taze canvas'la birebir parite (içerik sızıntısı yok).
   Kapak: 24 kanıt; 32 MB üstünde en eski iade edilir. tip anahtarı
   yok — hedef dctx tip uyumsuzluklarını da önler. */
const inkDualScratchPool = [];
const INK_DUAL_POOL_MAX_BYTES = 32 * 1024 * 1024;
let inkDualScratchPoolBytes = 0;
function inkDualScratchTake(w, h, off) {
  const w2 = w | 0, h2 = h | 0;
  if (!w2 || !h2) return null;
  for (let i = inkDualScratchPool.length - 1; i >= 0; i -= 1) {
    const e = inkDualScratchPool[i];
    if (e.w === w2 && e.h === h2 && e.off === off) {
      inkDualScratchPool.splice(i, 1);
      inkDualScratchPoolBytes -= w2 * h2 * 4;
      const g = e.c.getContext('2d', { colorSpace: 'srgb' });
      if (g) {
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, w2, h2);
        g.restore();
      }
      return e.c;
    }
  }
  return null;
}
function inkDualScratchGive(c) {
  if (!c || !c.__inkDualW) return;
  const w = c.__inkDualW | 0, h = c.__inkDualH | 0;
  const off = !!c.__inkDualOff;
  const bytes = w * h * 4;
  if (inkDualScratchPoolBytes + bytes > INK_DUAL_POOL_MAX_BYTES) return; /* kapak: bırak (GC'ye) */
  inkDualScratchPool.push({ c, w, h, off });
  inkDualScratchPoolBytes += bytes;
  while (inkDualScratchPool.length > 24) {
    const drop = inkDualScratchPool.shift();
    inkDualScratchPoolBytes -= drop.w * drop.h * 4;
  }
}
/** Tüm havuzu boşaltır (editör kapanışı çağırır). */
function inkDualScratchPoolClear() {
  inkDualScratchPool.length = 0;
  inkDualScratchPoolBytes = 0;
}
function inkDualScratchStats() {
  return { entries: inkDualScratchPool.length,
    mb: Math.round(inkDualScratchPoolBytes / 1048576 * 100) / 100 };
}

const INK_DEFAULT_DYNAMICS = {
  sizeMin: 0.18, sizeMax: 1, src: 'pressure',
  angleJitter: 0, scatterJitter: 0, spacingJitter: 0, opacityMin: 0.35,
};

/* ---------------- P3: basınç eğrisi + hız ---------------- */
/** Tablet basınç profili (aday 5): 'soft' → 0.55, 'hard' → 1.8;
    yok/'linear'/bozuk → 1 (parite: davranış bit bit korunur).
    Seçenek eğriyi ÇARPAR: options bar'daki fırça eğrisi ayrı kalır,
    ikisi birlikte etki eder. */
let inkPressureProfileExp = 1;
try {
  const v = localStorage.getItem('tailref-pressure-profile');
  if (v === 'soft') inkPressureProfileExp = 0.55;
  else if (v === 'hard') inkPressureProfileExp = 1.8;
} catch { /* sessiz */ }
function inkPressureProfileSet(name) {
  inkPressureProfileExp = name === 'soft' ? 0.55 : name === 'hard' ? 1.8 : 1;
}
try { window.tailrefPressureProfileSet = inkPressureProfileSet; } catch { /* sessiz */ }

/** Ham basıncı kullanıcı eğrisinden geçirir (1 = doğrusal). */
function inkCurvePressure(raw, curve) {
  const c = clamp(Number.isFinite(curve) ? curve : 1, 0.2, 3) * inkPressureProfileExp;
  const p = clamp(Number.isFinite(raw) ? raw : 1, 0.02, 1);
  return c === 1 ? p : clamp(Math.pow(p, c), 0.02, 1);
}

/**
 * Ekran hızı (CSS px / ms) 0..1'e eşler — FİZİKSEL uzayda (FAZ2-2).
 * Eski kalibrasyon 96-dpi pikseline gömülüydü (0.15..2.35 px/ms);
 * DPR veya OS ölçekleme değişince aynı el hareketi farklı hız
 * görünüyor ve tapered çizgi kalınlığı pencereyle değişiyordu.
 * Artık mm/ms üzerinden: 0.15 px/ms == 0.0397 mm/ms (96 dpi
 * referansıyla aynı 1:1 davranış), 2.35 px/ms == 0.622 mm/ms.
 */
const INK_MM_SLOW = 0.15 * 25.4 / 96;
const INK_MM_FAST = 2.35 * 25.4 / 96;
function inkSpeedInfluence(px, dtMs) {
  const dt = Math.max(1, Number.isFinite(dtMs) ? dtMs : 16.7);
  const pxPerMs = Math.max(0, Number.isFinite(px) ? px : 0) / dt;
  const mmPerMs = pxPerMs * INK_MM_PER_CSS_PX;
  return clamp((mmPerMs - INK_MM_SLOW) / (INK_MM_FAST - INK_MM_SLOW), 0, 1);
}

/* ---------------- P2: doku (texture) gürültüsü ---------------- */
/**
 * Deterministik 2B değer gürültüsü (0..1). Hücre köşeleri sabit bir hash'ten
 * gelir; iki eksende smoothstep ile harmanlanır. Sinüs tabanlı eski sürüm
 * çizgisel tekrarlar bırakıyordu.
 */
function inkTextureNoise(x, y) {
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

/**
 * Doku fırçaları için konuma bağlı deterministik grain.
 * @param {number} x hedef uzayda x
 * @param {number} y hedef uzayda y
 * @param {number} [sizePx] fırça çapı; tane boyu çapa bağlıdır
 * @param {number} [depth] doku derinliği (0 = düz, 1 = tam)
 * @param {number} [scale] doku ölçeği (1 = varsayılan)
 * @returns {number} 0..1 arası alfa çarpanı
 */
function inkTextureGrain(x, y, sizePx, depth, scale, textureId, brightness, contrast, eachTip, seed) {
  const size = Math.max(1, Number.isFinite(sizePx) ? sizePx : 1);
  const s = clamp(Number.isFinite(scale) ? scale : 1, 0.05, 16);
  const localScale = eachTip ? Math.max(1, size * 0.5) : Math.max(2.5, size * 0.14);
  const px = (x || 0) / localScale * s + (eachTip ? seed * 31.7 : 0);
  const py = (y || 0) / localScale * s + (eachTip ? seed * 17.3 : 0);
  let n;
  if (textureId === 'canvas') {
    const warp = Math.sin(px * 2.4) * Math.sin(py * 2.4);
    n = 0.52 + warp * 0.3 + (inkTextureNoise(px * 3, py * 3) - 0.5) * 0.36;
  } else if (textureId === 'sand') {
    n = inkTextureNoise(px * 6.5, py * 6.5) * 0.72 +
      inkTextureNoise(px * 2, py * 2) * 0.28;
  } else {
    n = inkTextureNoise(px, py) * 0.68 +
      inkTextureNoise(px * 2.7 + 11, py * 2.7 - 7) * 0.32;
  }
  const c = clamp(Number.isFinite(contrast) ? contrast : 1, 0.25, 3);
  n = clamp((n - 0.5) * c + 0.5 + clamp(Number(brightness) || 0, -1, 1), 0, 1);
  const d = clamp(Number.isFinite(depth) ? depth : 0.26, 0, 1);
  return 1 - d * (1 - n);
}

/** Damla yarıçapı: boyut dinamiği + hız incelmesi tek yerde. */
function inkDabRadius(sizePx, brush, driver, speed, speedSize, minRadius) {
  const dyn = inkBrushDynamics(brush);
  const spread = Math.max(0, dyn.sizeMax - dyn.sizeMin);
  let factor = dyn.sizeMin + spread * clamp(Number.isFinite(driver) ? driver : 1, 0, 1);
  const s = clamp(Number.isFinite(speed) ? speed : 0, 0, 1);
  const amount = clamp(Number.isFinite(speedSize) ? speedSize : 0, 0, 0.8);
  if (amount > 0) factor *= Math.max(0.2, 1 - amount * s);
  const floor = Number.isFinite(minRadius) ? Math.max(0.35, minRadius) : 0.35;
  return Math.max(floor, (sizePx / 2) * factor);
}

/* Vuruş kimliği sabittir; FNV tabanını damla başına yeniden hesaplamak
   yerine önbelleğe al. Çıktı birebir aynı kalır. */
const inkStrokeHashCache = new Map();

function inkStrokeIdHash(id) {
  let hash = inkStrokeHashCache.get(id);
  if (hash !== undefined) return hash;
  hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  }
  if (inkStrokeHashCache.size > 512) inkStrokeHashCache.clear();
  inkStrokeHashCache.set(id, hash);
  return hash;
}

function inkStrokeRandom(stroke, dabIndex, channel = 0) {
  let hash = inkStrokeIdHash(String(stroke && stroke.id || ''));
  hash ^= Math.imul((dabIndex | 0) + 1, 0x9e3779b1);
  hash ^= Math.imul((channel | 0) + 1, 0x85ebca6b);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function inkBrushDynamics(brush) {
  const d = brush && brush.dynamics;
  if (!d || !Number.isFinite(d.sizeMin) || !Number.isFinite(d.sizeMax)) {
    return INK_DEFAULT_DYNAMICS;
  }
  return d;
}

/* =========================================================
   FAZ 3-2: HSL renk üçlüsü (inkColorToHsl / inkHslToColor /
   inkHslChannelsToColor) SİLİNDİ — kötü karışım uzamıydı ("ölü kod
   kalmaz", FAZ 2-6 aynı kural). Renk hattının yeni kaynağı:
   56-ink-color.js (linear-light sRGB ↔ Ottosson OKLab/OKLCH).
   ========================================================= */

function inkColorToOkLch(hex) {
  /* FAZ 3-2: renk dinamikleri OKLCH uzayında — hue dönüşünde L-chroma
     korunumu (eski HSL hâlât doygunluk/karışım sıkışması üretirdi). */
  const value = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!value) return { l: 1, c: 0, h: 0 };
  return inkHexToOkLch('#' + value[1]);
}

function inkPrepareStrokeColor(stroke, brush) {
  const dynamics = brush && brush.colorDynamics;
  if (!dynamics) return null;
  if (!(dynamics.foregroundBackground || dynamics.hueJitter ||
      dynamics.saturationJitter || dynamics.brightnessJitter || dynamics.purity)) {
    return null;
  }
  const foreground = inkColorToOkLch(stroke.color || '#ffffff');
  const background = inkColorToOkLch(dynamics.background || '#ffffff');
  return {
    dynamics,
    foreground,
    hueDelta: (background.h - foreground.h + 540) % 360 - 180,
    /* FAZ 3-2 adlandırma: saturation→chroma, lightness→OKLCH l (0..1).
       Kalan alan adları eski sesmelerle eş (prepared.tüketicilerine
       görünür desen aynı). */
    chromaDelta: background.c - foreground.c,
    lightnessDelta: background.l - foreground.l,
  };
}

function inkStrokeColor(stroke, brush, dabIndex, prepared) {
  const dynamics = prepared ? prepared.dynamics : brush && brush.colorDynamics;
  if (!dynamics || !(dynamics.foregroundBackground || dynamics.hueJitter ||
      dynamics.saturationJitter || dynamics.brightnessJitter || dynamics.purity)) {
    return stroke.color || '#ffffff';
  }
  /* FAZ 3-2: tamamı OKLCH uzayında. saturationJitter artık chroma
     çarpanı (mutlak doygunluk salınımı salonda L'den bağımsız davranır);
     purity chroma'yı sabit tavan hedefine çekerek doygunlaştırır —
     gamut-dışı taşma hex sıkıştırmasında kalır (FAZ4 gamut-mapping). */
  const foreground = prepared ? prepared.foreground : inkColorToOkLch(stroke.color || '#ffffff');
  const background = prepared ? null : inkColorToOkLch(dynamics.background || '#ffffff');
  const hueDelta = prepared ? prepared.hueDelta :
    (background.h - foreground.h + 540) % 360 - 180;
  const chromaDelta = prepared ? prepared.chromaDelta : background.c - foreground.c;
  const lightnessDelta = prepared ? prepared.lightnessDelta : background.l - foreground.l;
  const mix = inkStrokeRandom(stroke, dabIndex, 32) *
    clamp(dynamics.foregroundBackground || 0, 0, 1);
  const hue = foreground.h + hueDelta * mix +
    (inkStrokeRandom(stroke, dabIndex, 33) * 2 - 1) *
      (dynamics.hueJitter || 0) * 180;
  let chroma = (foreground.c + chromaDelta * mix) *
    (1 + (inkStrokeRandom(stroke, dabIndex, 34) * 2 - 1) *
      (dynamics.saturationJitter || 0));
  let lightness = (foreground.l + lightnessDelta * mix) *
    (1 + (inkStrokeRandom(stroke, dabIndex, 35) * 2 - 1) *
      (dynamics.brightnessJitter || 0));
  chroma = chroma * (1 - (dynamics.purity || 0)) +
    (dynamics.purity || 0) * 0.27;   /* sRGB ortalama chroma tavanı */
  return inkOkLchToHex(clamp(lightness, 0, 1), clamp(chroma, 0, 0.35),
    (hue % 360 + 360) % 360);
}

function inkWetEdge(ctx, x, y, radius, roundness, angle, color, strength, alpha) {
  const amount = clamp(Number(strength) || 0, 0, 1);
  if (!amount) return;
  /* FAZ 3-2: kenar koyulaştırma OKLCH'de — eski HSL `rgb.l *= 0.48`
     doymuş renklerde chroma'yı da çökertiyor (canlı sarı → kirli haki);
     OKLCH'de yalnız L düşürüp chroma/hue korumak aynı "siyah karışımı"
     hissini düzgün doygunlukla verir. */
  const lch = inkColorToOkLch(color);
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

/**
 * Çift fırça damlası (`.abr` dual brush). Ana damlanın altına doku serper.
 *
 * Saçılma yarıçapı `sqrt(random)` ile seçilir: düz `random` daire içinde
 * merkeze yığılıyordu (alan yoğunluğu 1/r), bu yüzden ikinci uç neredeyse
 * tamamen ana damlanın altında kalıp görünmüyordu. Karekök dağılımı diski
 * alan-uniform doldurur; doku kenarlara taşar.
 */
const INK_DUAL_FLOW = 0.72;

function inkDrawDualDab(ctx, brush, stroke, radius, alpha, erase, x, y,
  tilt, angle, dabIndex, color, reusableColor) {
  const dual = brush.dual;
  const dr = Math.max(0.35, radius * clamp(dual.scale || 1, 0.1, 4));
  let dx = x, dy = y;
  const sc = Math.max(0, dual.scatter || 0);
  if (sc > 0) {
    const a = inkStrokeRandom(stroke, dabIndex, 4) * Math.PI * 2;
    const d = Math.sqrt(inkStrokeRandom(stroke, dabIndex, 5)) * dr * sc;
    dx += Math.cos(a) * d;
    dy += Math.sin(a) * d;
  }
  // İkinci uç: `.abr` gerçek sampled tip taşıyorsa (dual.tipId) o bitmap
  // kullanılır; yoksa kendi sertlik/yuvarlaklık/açısıyla prosedürel uç
  // üretilir. Böylece `.abr` dual tip gerçekten ayrı bir doku verir ve
  // worker yoluyla eşleşir.
  const selected = dual.brushId && typeof inkGetBrush === 'function'
    ? inkGetBrush(dual.brushId) : null;
  const dualBrush = selected || {
    id: 'dual:' + ((brush && brush.id) || 'x'),
    kind: dual.tipId ? 'abr' : 'procedural',
    tip: '',
    tipId: dual.tipId || '',
    hardness: dual.hardness,
  };
  const src = inkTintedTip(dualBrush, color || inkStrokeColor(stroke, brush, dabIndex),
    dual.hardness, dr * 2, !!reusableColor);
  const rot = angle + (Number.isFinite(dual.angle) ? dual.angle : 0);
  const round = Number.isFinite(dual.roundness) ? clamp(dual.roundness, 0.05, 1) : 1;
  const prev = ctx.globalAlpha;
  const dualFlow = Number.isFinite(dual.flow) ? clamp(dual.flow, 0.01, 1) : INK_DUAL_FLOW;
  const prevOp = ctx.globalCompositeOperation;
  /* FAZ 3-2 notu: ikinci ucun RENGİ artık inkStrokeColor üzerinden
     linear-light/OKLCH hattından gelir. `dual.blend` composite op'u
     (multiply) Canvas2D preset'i olduğundan gamma uzamda kalır —
     raster(worker) bayt paritesi FAZ 4 tile engine'ine (lineer Float32
     ram) ertelendi. */
  ctx.globalCompositeOperation = dual.blend || 'multiply';
  ctx.globalAlpha = Math.min(1, alpha * dualFlow);
  inkDrawTiltedStamp(ctx, src, dx, dy, dr, tilt, rot, round);
  ctx.globalAlpha = prev;
  ctx.globalCompositeOperation = prevOp;
  if (typeof inkPerfCount === 'function') inkPerfCount('dualDabs');
}

function inkDrawShape(ctx, stroke, map, sizePx, erase) {
  const pts = stroke.points;
  const a = map(pts[0]);
  const b = map(pts[pts.length - 1]);
  if (!a || !b) return;
  const color = stroke.color || '#fff';
  const lw = Math.max(1, sizePx * (stroke.shape === 'highlight' ? 2.5 : 0.22));

  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = stroke.shape === 'highlight' ? 'butt' : 'round';
  ctx.lineJoin = 'round';

  if (stroke.shape === 'highlight') {
    /* Tur 4c: fosforlu kendi taban yumuşaklığına SAHİP; kullanıcı
       opaklığıyla çarpılır — vuruş opaklığı yok sayılmaz. */
    ctx.globalAlpha = 0.32 * clamp(stroke.opacity, 0, 1);
    ctx.lineWidth = Math.max(6, sizePx * 2.2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    return;
  }

  /* Tur 4c: vuruş opaklığına saygı — araç şekilleri artık %100'e
     zorlanmıyor (var olan opaklık neyse şekil ona göre oluşur). */
  ctx.globalAlpha = clamp(stroke.opacity, 0, 1);
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

  // Şekil oturtma türleri: line (2 nokta) ve arc/circle/poly
  // (nokta listesi poliline; circle ve KAPALI poly kapatılır —
  // açık poly (V/Z/L, closed=false) kapanış segmenti almaz).
  if (stroke.shape === 'line') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    return;
  }
  if (stroke.shape === 'arc' || stroke.shape === 'circle' || stroke.shape === 'poly') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (let i = 1; i < pts.length; i++) {
      const q = map(pts[i]);
      if (!q) continue;
      ctx.lineTo(q.x, q.y);
    }
    if (stroke.shape === 'circle' ||
        (stroke.shape === 'poly' && stroke.closed)) ctx.closePath();
    ctx.stroke();
    return;
  }

  // ok
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
   .abr (referans uygulama fırça) ayrıştırıcı
   Format özeti (big-endian):
     u16 major, u16 minor
     v6/v7/v9/v10: "8BIM" + 4 karakter anahtar + u32 uzunluk + veri
                   (4 bayt hizalı). "samp" bloğu uç bitmap'lerini taşır.
     v1/v2      : minor = fırça sayısı; her giriş u32 uzunluk + gövde.
   Bitmap başlığı: i32 top,left,bottom,right + u16 depth + u8 compression
   Peşinden ham veya PackBits RLE satırları gelir.
   ========================================================= */
function inkParseAbr(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!bytes || bytes.length < 6) return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = dv.getUint16(0);
  const minor = dv.getUint16(2);
  const tips = [];
  inkRuntime.lastAbrError = '';
  try {
    if (major >= 6) inkParseAbrBlocks(bytes, dv, major, tips);
    else inkParseAbrLegacy(bytes, dv, minor, tips);
  } catch (err) {
    inkRuntime.lastAbrError = String((err && err.message) || err);
    console.warn('ABR parse error', err);
  }
  return tips.slice(0, 64);
}

function inkAbrTag(bytes, at) {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function inkParseAbrBlocks(bytes, dv, major, tips) {
  const len = bytes.length;
  let pos = 4;
  let guard = 0;
  let descName = '';
  // Bir fırça preset'i `desc` + `cbsh` + `samp` bloklarından oluşur. `samp`
  // bloğu çift fırçada iki uç taşır: birincisi ana uç, ikincisi `Dual`
  // bloğunun gerçek ikinci ucudur. Blok sırası dosyadan dosyaya değiştiği
  // için ikisini de (önce/sonra) eşleştiririz.
  let lastComputed = null;
  let pendingSamp = [];
  while (pos + 12 <= len && guard++ < 512 && tips.length < 64) {
    if (inkAbrTag(bytes, pos) !== '8BIM') { pos++; continue; }
    const key = inkAbrTag(bytes, pos + 4);
    let size = dv.getUint32(pos + 8);
    const start = pos + 12;
    if (start + size > len) size = len - start;
    const end = start + size;
    if (key === 'desc') {
      // `samp` bazı dosyalarda `desc`'ten ÖNCE gelir (yalnızca örneklenmiş
      // fırça kümeleri: samp + desc + phry, hiç `cbsh` yok). Bu durumda
      // uçlar bekleyen listede kalır ve eski kod onları sıfırlayıp dosyayı
      // "Tip not found" ile bitiriyordu. Sahipsiz uçları burada bırak.
      if (pendingSamp.length) {
        for (const tip of pendingSamp) tips.push(tip);
        pendingSamp = [];
      }
      const info = inkAbrReadDescBlock(bytes, dv, start, end);
      if (info && info.name) descName = info.name;
      lastComputed = null;
    } else if (key === 'cbsh') {
      const computed = inkAbrReadComputedBrush(bytes, dv, start, end);
      if (computed) {
        computed.name = descName || computed.name;
        if (pendingSamp.length) {
          const leftover = inkAbrAttachSamples(computed, pendingSamp);
          pendingSamp = [];
          for (const tip of leftover) tips.push(tip);
        }
        tips.push(computed);
        lastComputed = computed;
        descName = '';
      }
    } else if (key === 'samp') {
      const sampled = inkParseAbrSamp(bytes, dv, start, end, major, descName);
      descName = '';
      if (lastComputed) {
        const leftover = inkAbrAttachSamples(lastComputed, sampled);
        for (const tip of leftover) tips.push(tip);
      } else {
        pendingSamp = sampled;
      }
    }
    pos = start + size;
    pos = Math.min(len, (pos + 3) & ~3);
  }
  for (const tip of pendingSamp) tips.push(tip);
}

/**
 * Örneklenmiş (`samp`) uçları en son computed fırçaya bağlar. İlk uç ana
 * uç, ikinci uç `.abr` çift fırçasının gerçek ikinci ucudur.
 * @returns {object[]} bağlanamayan (fazla) uçlar
 */
function inkAbrAttachSamples(computed, sampled) {
  if (!computed || !Array.isArray(sampled)) return sampled || [];
  const leftover = [];
  for (const tip of sampled) {
    if (!tip || tip.kind !== 'samp') { leftover.push(tip); continue; }
    if (!computed.dataUrl) {
      computed.dataUrl = tip.dataUrl;
      computed.sampledWidth = tip.width;
      computed.sampledHeight = tip.height;
    } else if (computed.dual && !computed.dual.tipDataUrl) {
      computed.dual.tipDataUrl = tip.dataUrl;
      computed.dual.tipWidth = tip.width;
      computed.dual.tipHeight = tip.height;
    } else {
      leftover.push(tip);
    }
  }
  return leftover;
}

function inkParseAbrLegacy(bytes, dv, count, tips) {
  const len = bytes.length;
  let pos = 4;
  let guard = 0;
  const total = clamp(count || 1, 1, 512);
  while (pos + 4 <= len && guard++ < total && tips.length < 64) {
    let size = dv.getUint32(pos);
    pos += 4;
    if (!size || pos + size > len) break;
    const tip = inkParseAbrTipEntry(bytes, dv, pos, pos + size, 1);
    if (tip) tips.push(tip);
    pos += size;
  }
}

/** `samp` gövdesindeki uç girişlerini sırayla okur. */
function inkParseAbrSampEntries(bytes, dv, start, end, major, name) {
  const tips = [];
  let pos = start;
  let guard = 0;
  while (pos + 4 <= end && guard++ < 512 && tips.length < 64) {
    let size = dv.getUint32(pos);
    pos += 4;
    if (!size || pos + size > end) break;
    const tip = inkParseAbrTipEntry(bytes, dv, pos, pos + size, major);
    if (tip) {
      if (name) tip.name = name;
      tips.push(tip);
    }
    pos += size;
    // referans uygulama v6.2+ uç girişleri 4 bayt hizalıdır. Bazı üreticiler
    // (ve test dosyaları) hizasız yazar; hangisi geçerli bir sonraki
    // uzunluk veriyorsa onu seç. Hizalama atlanınca gerçek dosyalarda
    // ikinci uç 0 uzunluk sanılıp dosya tek uçta kesiliyordu.
    const plausible = p => p + 4 <= end && (() => {
      const s = dv.getUint32(p);
      return s > 0 && p + 4 + s <= end;
    })();
    const aligned = (pos + 3) & ~3;
    if (!plausible(pos) && plausible(aligned)) pos = aligned;
  }
  return { tips, pos };
}

function inkParseAbrSamp(bytes, dv, start, end, major, name) {
  // referans uygulama v6.2 standardı: u16 sürüm + u16 uç sayısı + girişler.
  // Eski/sentetik dosyalar doğrudan giriş uzunluğuyla başlar. İki
  // yorumu da dene; uç sayısına tam oturan ya da bloğu sonuna kadar
  // tüketen yorumu seç. Böylece hem gerçek .abr hem test dosyaları
  // aynı ayrıştırıcıyla çalışır.
  const direct = inkParseAbrSampEntries(bytes, dv, start, end, major, name);
  if (start + 4 <= end) {
    const version = dv.getUint16(start);
    const count = dv.getUint16(start + 2);
    if ((version === 1 || version === 2) && count > 0 && count <= 64) {
      const withHeader = inkParseAbrSampEntries(bytes, dv, start + 4, end, major, name);
      if (withHeader.tips.length === count || withHeader.pos >= end - 3) {
        return withHeader.tips;
      }
    }
  }
  return direct.tips;
}

/* =========================================================
   .abr tanımlayıcıları (desc / cbsh)
   referans uygulama v6+ fırçaları, uç bitmi yerine bir "descriptor" taşır:
   çap, sertlik, aralık, açı, yuvarlaklık ve dinamiği alanları.
   Tanımlayıcı biçimi: classID (unicode) + u32 alan sayısı + alanlar.
   Her alan: anahtar (unicode) + 4 karakter tür + değer.
   ========================================================= */
function inkAbrUnicode(bytes, dv, pos, end) {
  if (pos + 4 > end) return null;
  const n = dv.getUint32(pos);
  pos += 4;
  const units = Math.min(n, Math.floor((end - pos) / 2));
  let s = '';
  for (let i = 0; i < units; i++) {
    const code = dv.getUint16(pos + i * 2);
    if (code) s += String.fromCharCode(code);
  }
  pos += units * 2;
  if (pos % 2) pos += 1;
  return { value: s, next: pos };
}

const INK_ABR_TYPES = new Set([
  'TEXT', 'enum', 'long', 'doub', 'UntF', 'UnFl', 'bool', 'Objc', 'GlbO',
  'VlLs', 'type', 'GlbC', 'alis', 'tdta', 'comp', 'obj ', 'ObAr', 'Pth ',
]);

/**
 * referans uygulama `readAsciiStringOrClassId`: u32 uzunluk; 0 ise 4 karakterlik
 * sınıf kimliği, değilse o kadar ASCII bayt. Gerçek `.abr` dosyaları
 * anahtarları ve sınıf kimliklerini böyle yazar.
 */
function inkAbrReadAsciiOrClass(bytes, dv, pos, end) {
  if (pos + 4 > end) return null;
  const n = dv.getInt32(pos);
  pos += 4;
  if (n === 0) {
    if (pos + 4 > end) return null;
    return { value: inkAbrTag(bytes, pos), next: pos + 4 };
  }
  if (n < 0 || n > 512 || pos + n > end) return null;
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[pos + i]);
  return { value: s, next: pos + n };
}

/**
 * Descriptor anahtarı. Gerçek biçim ASCII/sınıf kimliği, sentetik eski
 * biçim UTF-16'dır. Anahtardan sonra gelen 4 baytlık OSType türüne bakarak
 * hangi yorumun tuttuğunu anlarız.
 */
function inkAbrReadKey(bytes, dv, pos, end, layout) {
  if (layout === 'flat') return inkAbrUnicode(bytes, dv, pos, end);
  if (pos + 4 > end) return null;
  const n = dv.getInt32(pos);
  if (n === 0) return inkAbrReadAsciiOrClass(bytes, dv, pos, end);
  if (n < 0) return null;
  const asciiNext = pos + 4 + n;
  if (asciiNext + 4 <= end && INK_ABR_TYPES.has(inkAbrTag(bytes, asciiNext))) {
    return inkAbrReadAsciiOrClass(bytes, dv, pos, end);
  }
  const uniNext = pos + 4 + n * 2;
  if (uniNext + 4 <= end && INK_ABR_TYPES.has(inkAbrTag(bytes, uniNext))) {
    return inkAbrUnicode(bytes, dv, pos, end);
  }
  return inkAbrReadAsciiOrClass(bytes, dv, pos, end);
}

/** Tek bir descriptor değerini okur; { value, next } döndürür. */
function inkAbrReadValue(bytes, dv, pos, end, layout, depth) {
  if (pos + 4 > end) return null;
  const type = inkAbrTag(bytes, pos);
  pos += 4;
  switch (type) {
    case 'TEXT':
      return inkAbrUnicode(bytes, dv, pos, end);
    case 'enum': {
      const readId = layout === 'flat'
        ? (p => inkAbrUnicode(bytes, dv, p, end))
        : (p => inkAbrReadAsciiOrClass(bytes, dv, p, end));
      const t = readId(pos);
      if (!t) return null;
      const v = readId(t.next);
      if (!v) return null;
      return { value: { type: t.value, value: v.value }, next: v.next };
    }
    case 'long':
      if (pos + 4 > end) return null;
      return { value: dv.getInt32(pos), next: pos + 4 };
    case 'doub':
      if (pos + 8 > end) return null;
      return { value: dv.getFloat64(pos), next: pos + 8 };
    case 'UntF':
    case 'UnFl': {
      if (pos + 12 > end) return null;
      const unit = inkAbrTag(bytes, pos);
      return { value: { unit, value: dv.getFloat64(pos + 4) }, next: pos + 12 };
    }
    case 'bool':
      if (pos + 1 > end) return null;
      return { value: !!bytes[pos], next: pos + 1 };
    case 'Objc':
    case 'GlbO':
      return inkAbrReadDescriptorStructure(bytes, dv, pos, end, layout, (depth || 0) + 1);
    case 'VlLs': {
      if (pos + 4 > end) return null;
      const n = Math.min(dv.getUint32(pos), 256);
      pos += 4;
      const list = [];
      for (let i = 0; i < n; i++) {
        const item = inkAbrReadValue(bytes, dv, pos, end, layout, depth);
        if (!item) return null;
        list.push(item.value);
        pos = item.next;
      }
      return { value: list, next: pos };
    }
    case 'type':
    case 'GlbC':
      if (layout === 'flat') return inkAbrUnicode(bytes, dv, pos, end);
      return inkAbrReadClass(bytes, dv, pos, end);
    case 'alis': {
      if (pos + 4 > end) return null;
      const n = dv.getUint32(pos);
      return { value: { length: n }, next: Math.min(end, pos + 4 + n) };
    }
    case 'tdta': {
      if (pos + 4 > end) return null;
      const n = dv.getUint32(pos);
      return { value: { length: n }, next: Math.min(end, pos + 4 + n) };
    }
    case 'comp': {
      if (pos + 8 > end) return null;
      return { value: { low: dv.getUint32(pos), high: dv.getUint32(pos + 4) }, next: pos + 8 };
    }
    default:
      return null;
  }
}

/** Sınıf yapısı: unicode ad + ASCII/sınıf kimliği (gerçek biçim). */
function inkAbrReadClass(bytes, dv, pos, end) {
  const name = inkAbrUnicode(bytes, dv, pos, end);
  if (!name) return null;
  const cid = inkAbrReadAsciiOrClass(bytes, dv, name.next, end);
  if (!cid) return null;
  return { value: { class: cid.value || name.value, name: name.value }, next: cid.next };
}

/** Descriptor gövdesi; `layout` = 'real' (referans uygulama) veya 'flat' (eski). */
function inkAbrReadDescriptorStructure(bytes, dv, pos, end, layout, depth) {
  if ((depth || 0) > 16) return null;
  const name = inkAbrUnicode(bytes, dv, pos, end);
  if (!name) return null;
  pos = name.next;
  let cls = name.value;
  if (layout === 'real') {
    const cid = inkAbrReadAsciiOrClass(bytes, dv, pos, end);
    if (!cid) return null;
    cls = cid.value || name.value;
    pos = cid.next;
  }
  if (pos + 4 > end) return null;
  const count = dv.getUint32(pos);
  pos += 4;
  if (count > 400) return null;
  const items = {};
  for (let i = 0; i < count; i++) {
    const key = inkAbrReadKey(bytes, dv, pos, end, layout);
    if (!key) return null;
    pos = key.next;
    const item = inkAbrReadValue(bytes, dv, pos, end, layout, depth || 0);
    if (!item) return null;
    items[key.value] = item.value;
    pos = item.next;
  }
  return { value: { class: cls, name: name.value, items }, next: pos };
}

function inkAbrClassLooksReal(desc) {
  const cls = String((desc && desc.class) || '');
  if (!cls || cls.length > 64) return false;
  // Gerçek sınıf kimlikleri yazdırılabilir ASCII. Düz biçimde alan sayısı
  // yanlışlıkla sınıf sanıldığında baytlar arasında 0 bulunur.
  return /^[\x20-\x7e]+$/.test(cls);
}

/** Descriptor: gerçek biçimi dene, olmazsa eski düz biçime düş. */
function inkAbrReadDescriptor(bytes, dv, pos, end) {
  const real = inkAbrReadDescriptorStructure(bytes, dv, pos, end, 'real', 0);
  if (real && inkAbrClassLooksReal(real.value)) return real;
  const flat = inkAbrReadDescriptorStructure(bytes, dv, pos, end, 'flat', 0);
  if (flat) return flat;
  return real;
}

/** `desc` bloğu: u32 sürüm + descriptor; fırça adı `Nm  ` alanında. */
function inkAbrReadDescBlock(bytes, dv, start, end) {
  if (start + 4 > end) return null;
  const d = inkAbrReadDescriptor(bytes, dv, start + 4, end);
  if (!d || !d.value) return null;
  const items = d.value.items || {};
  const name = items['Nm  '] || items['Nm'] || items['N m '] || '';
  return { class: d.value.class, name: String(name || ''), items };
}

function inkAbrNum(v, fallback) {
  if (v && typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return Number.isFinite(v) ? v : fallback;
}

/** Yüzde alanı: hem 0..1 hem 0..100 (ünite #Prc) kabul edilir. */
function inkAbrPct(v, fallback) {
  const n = inkAbrNum(v, NaN);
  if (!Number.isFinite(n)) return fallback;
  const pct = v && typeof v === 'object' && v.unit === '#Prc';
  const base = (pct || n > 1.5) ? n / 100 : n;
  return clamp(base, 0, 1);
}

function inkAbrDeg(v, fallback) {
  const n = inkAbrNum(v, NaN);
  if (!Number.isFinite(n)) return fallback;
  // referans uygulama açıyı 0..360 derece tutar; radyana çevir.
  return (n % 360) * Math.PI / 180;
}

/** `cbsh` bloğu: u32 sürüm + fırça descriptor'ı → uç olmadan fırça modeli. */
function inkAbrReadComputedBrush(bytes, dv, start, end) {
  if (start + 4 > end) return null;
  const d = inkAbrReadDescriptor(bytes, dv, start + 4, end);
  if (!d || !d.value) return null;
  const items = d.value.items || {};
  const get = (...keys) => {
    for (const k of keys) {
      if (items[k] !== undefined && items[k] !== null) return items[k];
    }
    return undefined;
  };

  const diameter = inkAbrNum(get('Dmtr', 'diam'), 30);
  if (!(diameter > 0)) return null;
  const hardness = inkAbrPct(get('Hrdn', 'hard'), 0.6);
  const spacing = inkAbrPct(get('Spcn', 'spac'), 0.1);
  const scatter = inkAbrPct(get('Sctr', 'ScTr'), 0);
  const roundness = inkAbrPct(get('Rndn'), 1);
  const angle = inkAbrDeg(get('Angl'), 0);
  const flow = inkAbrPct(get('Flw', 'flow'), 1);
  const textureRaw = get('Txtr', 'texture');
  const texture = !!textureRaw && (typeof textureRaw !== 'object' || Object.keys(textureRaw).length > 0);

  // Dinamik: varyans alanları 0..1; boyut varyansı en küçük boyutu belirler.
  const sizeVar = inkAbrPct(get('SzVr'), 0);
  const angleVar = inkAbrPct(get('AnVr'), 0);
  const scatterVar = inkAbrPct(get('ScVr'), 0);
  const input = get('Inpt');
  const inputVal = input && typeof input === 'object' ? String(input.value || '') : '';
  const src = /vel/i.test(inputVal) ? 'velocity' : 'pressure';

  const dualRaw = get('Dual');
  let dual = null;
  if (dualRaw && typeof dualRaw === 'object' && dualRaw.items) {
    const dItems = dualRaw.items;
    const dGet = (...keys) => {
      for (const k of keys) {
        if (dItems[k] !== undefined && dItems[k] !== null) return dItems[k];
      }
      return undefined;
    };
    const dDia = inkAbrNum(dGet('Dmtr', 'diam'), 0);
    if (dDia > 0) {
      dual = {
        diameter: dDia,
        scale: clamp(dDia / diameter, 0.1, 4),
        spacing: inkAbrPct(dGet('Spcn', 'spac'), 0.1),
        scatter: inkAbrPct(dGet('Sctr', 'ScTr'), 0),
        hardness: inkAbrPct(dGet('Hrdn', 'hard'), 0.6),
        roundness: inkAbrPct(dGet('Rndn'), 1),
        angle: inkAbrDeg(dGet('Angl'), 0),
        flow: inkAbrPct(dGet('Flw', 'flow'), 0.72),
      };
    }
  }

  return {
    kind: 'cbsh',
    name: '',
    dataUrl: '',
    width: Math.round(diameter),
    height: Math.round(diameter),
    diameter,
    hardness,
    spacing,
    scatter,
    angle,
    roundness,
    flow,
    texture,
    dynamics: {
      sizeMin: clamp(1 - sizeVar, 0.02, 1),
      sizeMax: 1,
      src,
      angleJitter: angleVar,
      scatterJitter: scatterVar,
    },
    dual,
  };
}

function inkParseAbrTipEntry(bytes, dv, start, end, major) {
  const len = end - start;
  if (len < 40) return null;

  // Bilinen yerleşimler önce denenir; ardından güvenli tarama yapılır.
  const candidates = major >= 6 ? [47, 301] : [39, 47, 301];
  let header = null;
  for (const off of candidates) {
    header = inkAbrReadHeader(bytes, dv, start + off, end);
    if (header) break;
  }
  if (!header) {
    const limit = Math.min(len - 19, 1400);
    for (let off = 16; off <= limit; off++) {
      header = inkAbrReadHeader(bytes, dv, start + off, end);
      if (header) break;
    }
  }
  if (!header) return null;

  const pixels = inkAbrDecodePixels(bytes, dv, header, end);
  if (!pixels) return null;
  const dataUrl = inkAbrPixelsToDataUrl(pixels, header.w, header.h);
  if (!dataUrl) return null;
  return { kind: 'samp', dataUrl, width: header.w, height: header.h };
}

function inkAbrReadHeader(bytes, dv, offset, end) {
  if (offset < 0 || offset + 19 > end) return null;
  const top = dv.getInt32(offset);
  const left = dv.getInt32(offset + 4);
  const bottom = dv.getInt32(offset + 8);
  const right = dv.getInt32(offset + 12);
  const depth = dv.getUint16(offset + 16);
  const compression = bytes[offset + 18];
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0 || w > 4096 || h > 4096) return null;
  if (depth !== 8 && depth !== 16) return null;
  if (compression !== 0 && compression !== 1) return null;
  return {
    w, h, depth, compression,
    pixelStart: offset + 19,
  };
}

function inkAbrDecodePixels(bytes, dv, header, end) {
  const { w, h, depth, compression, pixelStart } = header;
  const bpp = depth === 16 ? 2 : 1;
  const rowBytes = w * bpp;
  const alpha = new Uint8ClampedArray(w * h);

  if (compression === 0) {
    const need = rowBytes * h;
    if (pixelStart + need > end + 4) return null;
    for (let y = 0; y < h; y++) {
      const rowStart = pixelStart + y * rowBytes;
      for (let x = 0; x < w; x++) {
        alpha[y * w + x] = bytes[rowStart + x * bpp] || 0;
      }
    }
    return { w, h, alpha };
  }

  let pos = pixelStart;
  const rows = [];
  let total = 0;
  let rowOk = pos + h * 2 <= end;
  for (let y = 0; rowOk && y < h; y++) {
    const n = dv.getUint16(pos);
    pos += 2;
    if (pos + n > end) { rowOk = false; break; }
    rows.push({ at: pos, len: n });
    pos += n;
    total += n;
  }

  const takeAlpha = buf => {
    let inkPx = 0;
    for (let y = 0; y < h; y++) {
      const row = y * rowBytes;
      for (let x = 0; x < w; x++) {
        const v = buf[row + x * bpp] || 0;
        alpha[y * w + x] = v;
        if (v) inkPx++;
      }
    }
    return inkPx;
  };

  // 1) PSD tarzı satır uzunluğu tablosu (bazı üreticiler).
  if (rowOk && total > 0) {
    const rowOut = new Uint8Array(rowBytes);
    let inkPx = 0;
    for (let y = 0; y < h; y++) {
      rowOut.fill(0);
      inkPackBitsDecode(bytes, rows[y].at, rows[y].len, rowOut, rowBytes);
      for (let x = 0; x < w; x++) {
        const v = rowOut[x * bpp] || 0;
        alpha[y * w + x] = v;
        if (v) inkPx++;
      }
    }
    if (inkPx) return { w, h, alpha };
  }

  // 2) Gerçek referans uygulama .abr: satır tablosu yok, tek PackBits akışı.
  //    (Bu yol olmadan 01.ABR gibi v6.2 dosyaları "uç bulunamadı" veriyordu.)
  const flat = new Uint8Array(rowBytes * h);
  inkPackBitsDecode(bytes, pixelStart, end - pixelStart, flat, flat.length);
  if (takeAlpha(flat)) return { w, h, alpha };
  return null;
}

/** PackBits / RLE çözücü. Taşan satırlar kırpılır, eksikler 0 ile doldurulur. */
function inkPackBitsDecode(src, start, len, out, outLen) {
  let i = start;
  const end = start + len;
  let o = 0;
  while (i < end && o < outLen) {
    let n = src[i++];
    if (n > 127) n -= 256;
    if (n >= 0) {
      const count = n + 1;
      for (let k = 0; k < count && i < end && o < outLen; k++) out[o++] = src[i++];
    } else if (n !== -128) {
      const count = 1 - n;
      const val = i < end ? src[i++] : 0;
      for (let k = 0; k < count && o < outLen; k++) out[o++] = val;
    }
  }
}

function inkAbrPixelsToDataUrl(pixels, w, h) {
  const { alpha } = pixels;
  let cw = w, ch = h;
  const maxSide = 512;
  if (Math.max(w, h) > maxSide) {
    const k = maxSide / Math.max(w, h);
    cw = Math.max(1, Math.round(w * k));
    ch = Math.max(1, Math.round(h * k));
  }
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d', { colorSpace: 'srgb' });
  const img = sctx.createImageData(w, h);
  for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
    img.data[j] = 255;
    img.data[j + 1] = 255;
    img.data[j + 2] = 255;
    img.data[j + 3] = alpha[i];
  }
  sctx.putImageData(img, 0, 0);
  if (cw === w && ch === h) return src.toDataURL('image/png');

  const dst = document.createElement('canvas');
  dst.width = cw;
  dst.height = ch;
  dst.getContext('2d', { colorSpace: 'srgb' }).drawImage(src, 0, 0, cw, ch);
  return dst.toDataURL('image/png');
}

/* =========================================================
   içe aktarma / kalıcılık
   ========================================================= */
async function inkImportAbrFile(file) {
  if (!file) return { added: 0, error: 'No file' };
  const buf = await file.arrayBuffer();
  const parsed = inkParseAbr(buf);
  if (!parsed.length) return { added: 0, error: 'Tip not found' };

  const ink = inkState();
  const base = String(file.name || 'ABR').replace(/\.abr$/i, '').slice(0, 28);
  const added = [];
  let computedCount = 0;
  parsed.forEach((tip, i) => {
    const id = 'abr_' + newId();
    if (tip.kind === 'cbsh') {
      // Computed fırça: uç bitmi yok; prosedürel uç + descriptor dinamiği.
      // `samp` bloğu eşleştiyse ana uç ve çift fırçanın ikinci ucu gerçek
      // bitmap olarak yüklenir.
      let tipId = '';
      if (tip.dataUrl) {
        tipId = 'tip_' + newId();
        inkRuntime.importedTips.set(tipId, tip.dataUrl);
      }
      let dual = tip.dual;
      if (dual && dual.tipDataUrl) {
        const dualTipId = 'tip_' + newId();
        inkRuntime.importedTips.set(dualTipId, dual.tipDataUrl);
        dual = Object.assign({}, dual, { tipId: dualTipId });
      }
      const brush = {
        id,
        name: tip.name || (base + ' ' + (i + 1)),
        kind: 'abr',
        /* Kütüphane listeleri kategori eşitliğiyle süzülür; kategori boş
           kalırsa fırça hiçbir kategoride görünmüyordu. */
        category: 'custom',
        badge: 'Custom',
        hardness: tip.hardness,
        spacing: tip.spacing,
        scatter: tip.scatter,
        tipId,
        width: tip.width,
        height: tip.height,
        angle: tip.angle,
        roundness: tip.roundness,
        flow: tip.flow,
        texture: !!tip.texture,
        dynamics: tip.dynamics,
        dual,
      };
      ink.brushes.push(inkNormalizeBrush(brush));
      if (tipId) inkLoadAbrTip(tipId);
      if (dual && dual.tipId) inkLoadAbrTip(dual.tipId);
      computedCount++;
      added.push(brush);
      return;
    }
    const tipId = 'tip_' + newId();
    inkRuntime.importedTips.set(tipId, tip.dataUrl);
    const brush = {
      id,
      name: tip.name || (base + ' ' + (i + 1)),
      kind: 'abr',
      /* Aynı neden: kategori olmadan kart hiçbir listede çizilmiyor. */
      category: 'custom',
      badge: 'Custom',
      hardness: 1,
      spacing: 0.12,
      scatter: 0,
      tipId,
      width: tip.width,
      height: tip.height,
    };
    ink.brushes.push(inkNormalizeBrush(brush));
    inkLoadAbrTip(tipId);
    added.push(brush);
  });
  if (added.length) {
    inkState().brushId = added[0].id;
    await inkPersistImportedBrushes();
    if (typeof inkRerenderAllLayers === 'function') inkRerenderAllLayers();
    if (typeof inkSyncUI === 'function') inkSyncUI();
  }
  return { added: added.length, computed: computedCount };
}

async function inkPersistImportedBrushes() {
  try {
    if (!db) return;
    // Yerleşik fırçalar kütüphanede her zaman vardır. Kullanıcının
    // oluşturduğu prosedürel fırçalar da .abr uçları gibi proje
    // kaydından bağımsız saklanır; böylece "Save" alınmasa bile
    // uygulama yeniden açıldığında kaybolmazlar.
    const defaults = new Set(
      (typeof inkDefaultBrushes === 'function' ? inkDefaultBrushes() : [])
        .map(brush => brush && brush.id)
        .filter(Boolean)
    );
    const list = inkState().brushes
      .filter(b => b && b.id && !defaults.has(b.id))
      .map(b => ({
        version: 2,
        brush: b,
        tipDataUrl: b.tipId ? (inkRuntime.importedTips.get(b.tipId) || '') : '',
        dualTipDataUrl: b.dual && b.dual.tipId
          ? (inkRuntime.importedTips.get(b.dual.tipId) || '') : '',
      }));
    await idbPut('meta', 'ink:brushes', list);
  } catch (err) {
    console.warn('brushes could not be saved', err);
  }
}

async function inkLoadImportedBrushes() {
  try {
    if (!db) return;
    const list = await idbGet('meta', 'ink:brushes');
    if (!Array.isArray(list) || !list.length) return;
    const ink = inkState();
    for (const rec of list) {
      // Yeni kayıt biçimi: { brush, tipDataUrl, dualTipDataUrl }.
      // Eski kayıtlar doğrudan fırça alanlarını taşır; ikisini de oku.
      const source = rec && rec.brush && typeof rec.brush === 'object'
        ? rec.brush : rec;
      if (!source || !source.id) continue;
      const tipDataUrl = rec.tipDataUrl || rec.dataUrl || '';
      const dualDataUrl = rec.dualTipDataUrl || rec.dualDataUrl || '';
      if (tipDataUrl && source.tipId) {
        inkRuntime.importedTips.set(source.tipId, tipDataUrl);
        inkLoadAbrTip(source.tipId);
      }
      if (dualDataUrl && source.dual && source.dual.tipId) {
        inkRuntime.importedTips.set(source.dual.tipId, dualDataUrl);
        inkLoadAbrTip(source.dual.tipId);
      }
      if (!ink.brushes.some(b => b.id === source.id)) {
        const kind = source.kind === 'abr' || source.kind === 'procedural'
          ? source.kind : (tipDataUrl ? 'abr' : 'procedural');
        ink.brushes.push(inkNormalizeBrush(Object.assign({}, source, {
          kind,
          tipId: source.tipId || '',
        })));
      }
    }
  } catch (err) {
    console.warn('brushes could not be loaded', err);
  }
}

/* TailRef app · ink renderer · attached canvases, world tiles, gizmo
   ------------------------------------------------------------------
   Katman verisi (stroke listesi) kaynak gerçeğidir. Bu modül onu iki
   farklı önbelleğe raster eder:

   • Görsele bağlı katman  → öğenin içinde tek bir <canvas>. Öğenin
     CSS transformu ile birlikte taşınır/döner/ölçeklenir.
   • Global katman        → dünya uzayında 512 birimlik karolar. Yalnızca
     çizilen karolar için tuval ayrılır; görünmeyen karolar culling ile
     gizlenir. Böylece sonsuz tuvalde bellek sınırlı kalır.

   Bu modül aynı zamanda seçim/transform gizmo'sunu ve PNG dışa aktarma
   yardımcılarını barındırır.
   ========================================================= */
