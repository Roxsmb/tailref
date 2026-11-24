/* TailRef app · native brush library · procedural tips, presets, browser UI
   ------------------------------------------------------------------
   Fırça uçları artık dışarıdan görsel yüklenmeden, tarayıcı belleğinde
   prosedürel olarak üretilir. Her uç beyaz bir alfa maskesidir; çizim
   sırasında `inkTintedTip()` tarafından aktif renge boyanır.

   • create*Tip()          : farklı fırça profilleri (yuvarlak, yumuşak,
                             kare, oval, tırmık, gürültü, sulu boya)
   • NativeBrushLibrary    : kategorilere ayrılmış referans uygulama tarzı presetler
   • renderStrokePreview() : kartlardaki S eğrisi önizlemesi
   • setActiveBrush()      : seçilen preseti çizim motoruna uygular
   • ink*NativeBrush*()    : iki sütunlu kütüphane panelinin DOM işleri

   Veri ile arayüz bilinçli olarak ayrı tutulur.
   ========================================================= */
'use strict';

/* =========================================================
   prosedürel fırça uçları
   ========================================================= */
function inkNativeTipSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return 256;
  return Math.round(clamp(n, 16, INK_TIP_MAX || 1024));
}

function inkNativeTipCanvas(size) {
  const px = inkNativeTipSize(size);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx, size: px };
}

/** Deterministik gürültü: her uç üretiminde aynı profili verir. */
function inkNativeNoise(x, y, seed = 0) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^
    Math.imul(seed | 0, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Standart sert yuvarlak uç. */
function createCircleTip(size = 256, options = {}) {
  const { canvas, ctx, size: px } = inkNativeTipCanvas(size);
  // Boyut = çap (endüstri kuralı): yuvarlak ucu kabın tamamını doldurur.
  // Varsayılan 0.055 iç payı çizilen çapı 75px istenirken ~68px'e düşürüyordu.
  const inset = clamp(Number(options.inset) || 0, 0, 0.25) * px;
  const r = Math.max(1, px / 2 - inset);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2);
  ctx.fill();
  const edge = clamp(Number(options.edge) || 0, 0, 1);
  if (edge > 0) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, px * 0.02 * edge);
    ctx.strokeStyle = 'rgba(0,0,0,' + (0.35 * edge) + ')';
    ctx.stroke();
  }
  return canvas;
}

/** Ortası opak, kenara doğru yumuşayan hava fırçası ucu. */
function createSoftTip(size = 256, options = {}) {
  const { canvas, ctx, size: px } = inkNativeTipCanvas(size);
  const hardness = clamp(
    Number.isFinite(options.hardness) ? options.hardness : 0.28, 0, 1
  );
  const r = Math.max(1, px / 2 - 1);
  const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, r);
  const solid = clamp(hardness * 0.88, 0.01, 0.98);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(solid, 'rgba(255,255,255,' + (hardness >= 0.99 ? 1 : 0.94) + ')');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

/** Block-in fırçaları için köşeli kare uç. */
function createSquareTip(size = 256, options = {}) {
  const { canvas, ctx, size: px } = inkNativeTipCanvas(size);
  const inset = clamp(Number(options.inset) || 0.06, 0, 0.25) * px;
  const radius = clamp(Number(options.radius) || 0, 0, 0.2) * px;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  if (radius > 0 && typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(inset, inset, px - inset * 2, px - inset * 2, radius);
    ctx.fill();
  } else {
    ctx.fillRect(inset, inset, px - inset * 2, px - inset * 2);
  }
  return canvas;
}

/** Kaligrafi için yatay elips uç. Açı, motor tarafından döndürülür. */
function createOvalTip(size = 256, options = {}) {
  const { canvas, ctx, size: px } = inkNativeTipCanvas(size);
  const ratio = clamp(Number(options.ratio) || 0.3, 0.08, 1);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.ellipse(px / 2, px / 2, px * 0.46, px * 0.46 * ratio, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

/** Yan yana birkaç kıl demeti: tarama / tırmık ucu. */
function createRakeTip(size = 256, options = {}) {
  const { canvas, ctx, size: px } = inkNativeTipCanvas(size);
  const count = Math.round(clamp(Number(options.bristles) || 7, 3, 15));
  const spread = clamp(Number(options.spread) || 0.62, 0.25, 0.95);
  const barW = Math.max(1, px * 0.034);
  const step = count > 1 ? (px * spread) / (count - 1) : 0;
  const start = px / 2 - (px * spread) / 2;
  for (let i = 0; i < count; i++) {
    const wobble = 0.84 + 0.16 * inkNativeNoise(i, count, 17);
    const len = px * (0.55 + 0.2 * wobble);
    const x = start + step * i - barW / 2;
    const y = px / 2 - len / 2;
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

/** Rastgele piksellerden oluşan kir / pas / kömür ucu. */
function createNoiseTip(size = 256, options = {}) {
  const { canvas, ctx, size: px } = inkNativeTipCanvas(size);
  const density = clamp(Number(options.density) || 0.55, 0.05, 1);
  const edge = clamp(Number(options.edge) || 0.94, 0.45, 1);
  // Tohum: uç yığını varyantları farklı tane yerleşimi üretir.
  const salt = (Number.isFinite(options.seed) ? Math.round(options.seed) : 0) | 0;
  const r = px * 0.5 * edge;
  const cx = px / 2, cy = px / 2;
  const step = px > 320 ? 2 : 1;
  for (let y = 0; y < px; y += step) {
    for (let x = 0; x < px; x += step) {
      const dx = x + step / 2 - cx;
      const dy = y + step / 2 - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const n = inkNativeNoise(x, y, 31 + salt);
      if (n > density) continue;
      const feather = clamp((r - d) / Math.max(1, px * 0.09), 0, 1);
      const alpha = (0.25 + 0.75 * inkNativeNoise(y, x, 73 + salt)) * feather;
      if (alpha <= 0.01) continue;
      ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
      ctx.fillRect(x, y, step, step);
    }
  }
  return canvas;
}

/** Kenarları koyu, ortası görece transparan ıslak boya ucu. `options.seed`
    kenar fazını ve granülasyon yerini değiştirir: aynı fırçadan üretilen
    farklı tohumlu uçlar birbirinden farklı düzensiz kenarlar taşır. */
function createWatercolorTip(size = 256, options = {}) {
  const { canvas, ctx, size: px } = inkNativeTipCanvas(size);
  const core = clamp(Number.isFinite(options.core) ? options.core : 0.22, 0.02, 0.55);
  const ring = clamp(Number.isFinite(options.ring) ? options.ring : 0.76, 0.5, 0.94);
  const edge = clamp(Number.isFinite(options.edge) ? options.edge : 0.42, 0.08, 0.8);
  const seed = Number.isFinite(options.seed) ? Math.round(options.seed) : 0;
  const phaseA = seed * 0.71, phaseB = seed * 1.31 + 0.9, phaseC = seed * 2.17;
  const radius = Math.max(1, px / 2 - 1);
  const image = ctx.createImageData(px, px);
  const smooth = value => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = (x + 0.5 - px / 2) / radius;
      const dy = (y + 0.5 - px / 2) / radius;
      const angle = Math.atan2(dy, dx);
      const roughness =
        0.025 * Math.sin(angle * 4 + 0.7 + phaseA) +
        0.016 * Math.sin(angle * 9 - 1.3 + phaseB) +
        0.01 * (inkNativeNoise((x / 5) | 0, (y / 5) | 0, 53 + (seed % 97)) - 0.5);
      const boundary = 0.95 + roughness;
      const distance = Math.hypot(dx, dy) / boundary;
      let alpha = 0;
      if (distance < 1) {
        const wash = core * (0.62 + 0.7 * smooth(distance / 0.9));
        const pigmentRim = edge *
          smooth((distance - ring) / Math.max(0.02, 0.92 - ring)) *
          (1 - smooth((distance - 0.92) / 0.08));
        const grain = 0.86 + 0.14 * inkNativeNoise(
          (x >> 2) + phaseC, (y >> 2) + phaseC, 97);
        alpha = Math.max(wash, pigmentRim) * grain;
      }
      const i = (y * px + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** FX fırçaları için noktalı tram (halftone) ucu. */
function createHalftoneTip(size = 256, options = {}) {
  const { canvas, ctx, size: px } = inkNativeTipCanvas(size);
  const dot = clamp(Number(options.dot) || 0.055, 0.015, 0.2) * px;
  const gap = clamp(Number(options.gap) || 0.13, 0.05, 0.4) * px;
  const r = px * 0.46;
  ctx.save();
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  let row = 0;
  for (let y = px * 0.06; y <= px * 0.94; y += gap) {
    const offset = row % 2 ? gap / 2 : 0;
    for (let x = px * 0.06 + offset; x <= px * 0.94; x += gap) {
      const dx = x - px / 2, dy = y - px / 2;
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

function inkCreateNativeTip(kind, size, options = {}) {
  switch (kind) {
    case 'soft': return createSoftTip(size, options);
    case 'square': return createSquareTip(size, options);
    case 'oval': return createOvalTip(size, options);
    case 'rake': return createRakeTip(size, options);
    case 'noise': return createNoiseTip(size, options);
    case 'watercolor': return createWatercolorTip(size, options);
    case 'halftone': return createHalftoneTip(size, options);
    case 'circle':
    default: return createCircleTip(size, options);
  }
}

const inkNativeTipCache = new Map();
/* Profiler bulgusu: varyant(15) x kova(7) alt kümesi 105 kaleme
   kadar genişler; LRU 80'de olanda sıkışma vuruş ortasında ucun
   yeniden üretmesini zorluyordu (createNoiseTip 138 ornek + GC 120).
   204 sınırı tüm uzayı kapsar; uç vuruş boyunca kesin durur. */
const INK_NATIVE_TIP_LIMIT = 204;

function inkNativeTipKey(brush, sizePx, hardness, variant = 0) {
  const res = typeof inkTipRes === 'function' ? inkTipRes(sizePx) : inkNativeTipSize(sizePx);
  const tip = (brush && brush.tip) || 'circle';
  const opts = brush && brush.tipOptions && typeof brush.tipOptions === 'object'
    ? brush.tipOptions : {};
  let key = tip + '@' + res + '|' + JSON.stringify(opts);
  if (tip === 'soft') key += '|h' + Math.round(clamp(hardness, 0, 1) * 100);
  if (variant > 0) key += '|v' + variant;
  return key;
}

function inkNativeTipFor(brush, sizePx, hardness, variant = 0) {
  const key = inkNativeTipKey(brush, sizePx, hardness, variant);
  const cached = inkNativeTipCache.get(key);
  if (cached) {
    inkNativeTipCache.delete(key);
    inkNativeTipCache.set(key, cached);
    return cached;
  }
  const tip = (brush && brush.tip) || 'circle';
  const res = typeof inkTipRes === 'function' ? inkTipRes(sizePx) : inkNativeTipSize(sizePx);
  const options = Object.assign({}, brush && brush.tipOptions);
  if (tip === 'soft' && Number.isFinite(hardness)) options.hardness = hardness;
  // Uç yığını varyantı: suluboya/gürültü uçları tohumdan farklı kenar üretir.
  if (variant > 0 && (tip === 'watercolor' || tip === 'noise')) {
    options.seed = ((brush && brush.tipSeed) || 0) + variant * 7919;
  }
  const canvas = inkCreateNativeTip(tip, res, options);
  inkNativeTipCache.set(key, canvas);
  while (inkNativeTipCache.size > INK_NATIVE_TIP_LIMIT) {
    inkNativeTipCache.delete(inkNativeTipCache.keys().next().value);
  }
  /* C++ çekirdek geçişi (evre 1): gürültü ve sulu boya uçları için
     ana süreçteki derleyiciye istek ilet ve sonuç gelince önbellek
     girdisini tazele. Senkron akış bozulmaz: JS canvas'ı hâlâ aynı
     karede döner; C++ canvas'ı sonraki kullanımları devralır.
     Vuruş içinde ucu değiştirme riski yok - damlalar halihazırda
     aldığı canvas referansını kullanmaya devam eder. */
  if (tip === 'noise' || tip === 'watercolor') {
    inkEngineTipRequest(tip, key, res, options, variant);
  }
  return canvas;
}

/* --- C++ uç üretimi isteği (ateş unut, varınca önbelleği tazele) ---
   JS yolu bayat kalmaz: köprü yoksa / iş başarısızsa dokunma yok.
   Önbellek girdisi yalnızca aynı anahtar hâlâ varsa değiştirilir. */
function inkEngineTipRequest(tip, key, res, options, variant) {
  try {
    const bridge = (typeof window !== 'undefined' &&
      window.tailref && typeof window.tailref.engineTip === 'function')
      ? window.tailref : null;
    if (!bridge) return;
    const build = async () => {
      let nums = null;
      if (tip === 'noise') {
        nums = [
          res,
          clamp(Number(options.density) || 0.55, 0.05, 1),
          clamp(Number(options.edge) || 0.94, 0.45, 1),
          (Number.isFinite(options.seed) ? Math.round(options.seed) : 0) | 0,
          res > 320 ? 2 : 1,
        ];
      } else {
        nums = [
          res,
          clamp(Number.isFinite(options.core) ? options.core : 0.22, 0.02, 0.55),
          clamp(Number.isFinite(options.ring) ? options.ring : 0.76, 0.5, 0.94),
          clamp(Number.isFinite(options.edge) ? options.edge : 0.42, 0.08, 0.8),
          Number.isFinite(options.seed) ? Math.round(options.seed) : 0,
        ];
      }
      const reply = await bridge.engineTip.call(null, tip, ...nums);
      if (!reply || !reply.ok || !reply.data ||
          reply.data.length !== res * res * 4) return;
      /* Önbellekteki anahtar eskiyse (aynı uç başka çekirdekle
         yeniden üretilmişse) elleme - tazelik kazanıyor. */
      const fresh = document.createElement('canvas');
      fresh.width = res;
      fresh.height = res;
      const fctx = fresh.getContext('2d', { colorSpace: 'srgb' });
      fctx.putImageData(new ImageData(new Uint8ClampedArray(reply.data), res, res), 0, 0);
      if (inkNativeTipCache.has(key)) {
        inkNativeTipCache.delete(key);
        inkNativeTipCache.set(key, fresh);
      }
    };
    build().catch(() => { /* sessiz: JS canvas zaten geçerli */ });
  } catch { /* sessiz */ }
}

/* --- EVRE 2: C++ damla emisyonu isteği -------------------------
   JS inkForEachDab dizinin birebir karşılığı ana süreçte koşar
   (parite: 9 senaryo ≤1e-9, hız 1,9×). Çağıran senkron JS yolu
   dokunmaz: bu istek asenkrondur ve commit/arka plan yollarına
   yöneliktir. Dönüş null'a düşerse JS emisyonyKaynak geçerli kalır.
   -------------------------------------------------------------- */
function inkEngineDabsRequest(points, scale, options = {}) {
  return new Promise(resolve => {
    try {
      const bridge = (typeof window !== 'undefined' &&
        window.tailref && typeof window.tailref.engineDabs === 'function')
        ? window.tailref : null;
      if (!bridge || !points || !points.length) { resolve(null); return; }
      const spacingPx = Number(options.spacingPx);
      if (!(spacingPx >= 0.6)) { resolve(null); return; }
      /* nokta dizisi → stride 7: x,y,p,s,t,a,br (yokluk = NaN) */
      const n = points.length;
      const flat = new Float64Array(n * 7);
      let sx = 1, sy = 1;
      if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) {
        sx = sy = scale;
      } else if (scale && typeof scale === 'object') {
        const kx = Number(scale.x), ky = Number(scale.y);
        if (Number.isFinite(kx) && kx > 0) sx = kx;
        if (Number.isFinite(ky) && ky > 0) sy = ky;
      }
      for (let i = 0; i < n; i++) {
        const pt = points[i];
        const b = i * 7;
        flat[b] = pt.x; flat[b + 1] = pt.y;
        flat[b + 2] = Number.isFinite(pt.p) ? pt.p : NaN;
        flat[b + 3] = Number.isFinite(pt.s) ? pt.s : NaN;
        flat[b + 4] = pt.t > 0 ? pt.t : NaN;
        flat[b + 5] = Number.isFinite(pt.a) ? pt.a : NaN;
        flat[b + 6] = pt.br ? 1 : 0;
      }
      const totalLengthPx = Number.isFinite(options.totalLengthPx)
        ? options.totalLengthPx : NaN;
      bridge.engineDabs.call(null, flat, spacingPx, sx, sy,
        options.stableOnly ? 1 : 0,
        clamp(Number(options.spacingJitter) || 0, 0, 1),
        Math.max(0, Number(options.taperStartPx) || 0),
        Math.max(0, Number(options.taperEndPx) || 0),
        Math.max(0, Number(options.progressOffsetPx) || 0),
        totalLengthPx, String(options.strokeId || ''),
      ).then(reply => {
        if (!reply || !reply.ok || !reply.data || !(reply.count > 0)) {
          resolve(null);
          return;
        }
        resolve({
          records: new Float64Array(reply.data, 0, reply.count * 9),
          count: reply.count,
        });
      }).catch(() => resolve(null));
    } catch { resolve(null); }
  });
}

/* --- EVRE 4: C++ undo karo dilimleme isteği --------------------
   inkUndoRegionTileSlices dilim döngüsünün birebir karşılığı ana
   süreçte koşar: bölge anlık görüntüsünden satır bandı kopyası.
   ASYNC ONLY sözleşmesi: çağıran senkron JS yolunu bloklamaz;
   snapshot hemen kaydedilir (yedek), dilimler boş-zamanda devirir.
   src: Uint8ClampedArray (satır adımı w*4); slices: [[x,y,w,h],...]
   bölge-relative. Dönüş null = JS döngüsü geçerli kalır. ------- */
function inkEngineTileSliceRequest(src, srcW, srcH, slices) {
  return new Promise(resolve => {
    try {
      const bridge = (typeof window !== 'undefined' &&
        ((window.tailref && typeof window.tailref.enginePortTiles === 'function') ||
         (window.tailref && typeof window.tailref.engineTiles === 'function')))
        ? window.tailref : null;
      if (!bridge || !src || !src.length || !(srcW > 0) || !(srcH > 0) ||
        !Array.isArray(slices) || !slices.length || slices.length > 4096) {
        resolve(null); return;
      }
      const flat = new Int32Array(slices.length * 4);
      for (let i = 0; i < slices.length; i++) {
        const s = slices[i];
        const b = i * 4;
        flat[b] = Math.trunc(s[0]); flat[b + 1] = Math.trunc(s[1]);
        flat[b + 2] = Math.trunc(s[2]); flat[b + 3] = Math.trunc(s[3]);
      }
      /* EVRE 5.1: transferable port yolu yeğlenir (sıfır-kopya);
         yoksa invoke yedeği (yapısal klonlu ama doğruluk aynı). */
      const callFn = typeof bridge.enginePortTiles === 'function'
        ? bridge.enginePortTiles : bridge.engineTiles;
      callFn.call(null, src, Math.trunc(srcW), Math.trunc(srcH),
        flat).then(reply => {
        if (!reply || !reply.ok || !reply.data || !(reply.count > 0)) {
          resolve(null); return;
        }
        resolve({ data: new Uint8Array(reply.data), count: reply.count });
      }).catch(() => resolve(null));
    } catch { resolve(null); }
  });
}

/* =========================================================
   veri mimarisi
   ========================================================= */
const NativeBrushCategories = [
  { id: 'inking', name: 'Ink Pack', title: 'INK PACK · INK BRUSHES', hint: 'G-Pen, Maru Pen, mapping and technical pens; crisp, controlled line' },
  { id: 'sketch', name: 'Graphite Pack', title: 'GRAPHITE PACK · SKETCH BRUSHES', hint: 'Pencils from HB to 6B, graphite powder and mechanical tips' },
  { id: 'charcoal', name: 'Charcoal Pack', title: 'CHARCOAL PACK · CHARCOAL BRUSHES', hint: 'Willow, compressed and powder charcoal; soft, grainy, high contrast' },
  { id: 'chalk', name: 'Chalk Pack', title: 'CHALK PACK · CHALK BRUSHES', hint: 'Dry chalk, pastel and Conté; dusty, matte, textured marks' },
  { id: 'airbrush', name: 'Airbrush Pack', title: 'AIRBRUSH PACK · AIRBRUSHES', hint: 'Soft transitions, spray, fog and fine-detail spray tips' },
  { id: 'wet', name: 'Watercolor Pack', title: 'WATERCOLOR PACK · WATERCOLOR BRUSHES', hint: 'Transparent washes, pigment edge, granulation and wet on wet' },
  { id: 'concept', name: 'Concept Pack', title: 'CONCEPT PACK · CONCEPT ART BRUSHES', hint: 'Block-in, values, clouds, rocks and quick environment masses' },
  { id: 'calligraphy', name: 'Calligraphy Pack', title: 'CALLIGRAPHY PACK · CALLIGRAPHY BRUSHES', hint: 'Nib pen, broad nib, brush lettering and fixed-angle chisel tips' },
  { id: 'texture', name: 'Texture FX Pack', title: 'TEXTURE FX PACK · TEXTURE AND FX BRUSHES', hint: 'Spray, splatter, feathers, grass, smoke and halftone patterns' },
  { id: 'custom', name: 'Custom Brushes', title: 'YOUR CUSTOM BRUSHES', hint: 'Brushes you created and tuned' },
];

/* Kullanıcıya ait, kalıcı kütüphane verisi. Proje kaydından bağımsız
   olarak IndexedDB `meta` deposunda tutulur: kategoriler, sıralama ve
   yıldızlar böylece "Save" alınmasa da korunur. */
const NativeBrushVirtualCategories = [
  {
    id: 'favorites', name: 'Favorites', title: 'FAVORITES',
    hint: 'Starred brushes are collected in one place',
    virtual: true,
  },
];
const INK_NATIVE_LIBRARY_META_KEY = 'ink:library';
const inkNativeLibrary = {
  loaded: false,
  customCategories: [],
  categoryOrder: [],
  favorites: [],
  deletedCategories: [],
  deletedBrushIds: [],
  brushRecords: [],
};

function nativeBrushPreset(def) {
  const dynamics = Object.assign({
    sizeMin: 0.18, sizeMax: 1, src: 'pressure',
    angleJitter: 0, scatterJitter: 0, spacingJitter: 0, opacityMin: 0.35,
  }, def.dynamics || {});
  return Object.assign({
    kind: 'procedural',
    tip: 'circle',
    tipOptions: {},
    category: 'sketch',
    badge: 'Brush',
    description: '',
    size: 24,
    opacity: 1,
    hardness: 0.8,
    spacing: 0.08,
    smoothing: 0.45,
    pressureCurve: 1,
    speedSize: 0,
    flow: 1,
    flowJitter: 0,
    scatter: 0,
    taperStart: 0,
    taperEnd: 0,
    texture: false,
    textureDepth: 0.26,
    textureScale: 1,
    roundness: 1,
    angle: 0,
    angleFollow: false,
  }, def, {
    dynamics,
    tipOptions: Object.assign({}, def.tipOptions || {}),
  });
}

const NativeBrushLibrary = [
  /* Mürekkep · varsayılan fırça (listenin ilk öğesi fallback'tir). */
  nativeBrushPreset({
    id: 'native-studio-pen', name: 'Studio Pen', category: 'inking', badge: 'Ink',
    tip: 'circle', size: 12, opacity: 1, hardness: 0.98, spacing: 0.085,
    smoothing: 0.56, pressureCurve: 1.12, speedSize: 0.04,
    flow: 0.96, taperStart: 0.06, taperEnd: 0.12,
    dynamics: { sizeMin: 0.22, sizeMax: 1, opacityMin: 0.18 },
    description: 'Sharp, controlled and pressure-sensitive main line tip',
  }),
  nativeBrushPreset({
    id: 'native-fine-liner', name: 'Fine Liner', category: 'inking', badge: 'Ink',
    tip: 'circle', size: 5, opacity: 1, hardness: 1, spacing: 0.07,
    smoothing: 0.62, pressureCurve: 1.2, speedSize: 0.1,
    flow: 0.98, taperEnd: 0.05,
    dynamics: { sizeMin: 0.32, sizeMax: 1, opacityMin: 0.2 },
    description: 'Very fine tip for detail, hatching and technical drawing',
  }),
  nativeBrushPreset({
    id: 'native-dry-ink', name: 'Dry Ink', category: 'inking', badge: 'Ink',
    tip: 'noise', tipOptions: { density: 0.9, edge: 0.98 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
    size: 18, opacity: 0.92, hardness: 0.86, spacing: 0.085,
    smoothing: 0.3, pressureCurve: 1.15, speedSize: 0.08,
    flow: 0.84, flowJitter: 0.08, scatter: 0.015,
    taperStart: 0.04, taperEnd: 0.08,
    texture: true, textureDepth: 0.2, textureScale: 1.4,
    dynamics: { sizeMin: 0.2, sizeMax: 1, scatterJitter: 0.035, opacityMin: 0.16 },
    description: 'Ink line that dries with a slightly broken edge',
  }),
  nativeBrushPreset({
    id: 'native-hb-pencil', name: 'HB Pencil', category: 'sketch', badge: 'Sketch',
    tip: 'noise', tipOptions: { density: 0.52, edge: 0.96 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
    size: 7, opacity: 0.82, hardness: 0.82, spacing: 0.055,
    smoothing: 0.32, pressureCurve: 1.25, speedSize: 0.08,
    flow: 0.58, flowJitter: 0.12, scatter: 0.06,
    taperStart: 0.035, taperEnd: 0.06,
    texture: true, textureDepth: 0.34, textureScale: 1.8,
    dynamics: { sizeMin: 0.14, sizeMax: 1, scatterJitter: 0.08, spacingJitter: 0.035, opacityMin: 0.08 },
    description: 'Graphite-grained, light and natural sketch pencil',
  }),
  nativeBrushPreset({
    id: 'native-charcoal', name: 'Charcoal', category: 'charcoal', badge: 'Charcoal',
    tip: 'noise', tipOptions: { density: 0.48, edge: 0.9 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
    size: 34, opacity: 0.76, hardness: 0.32, spacing: 0.12,
    smoothing: 0.24, pressureCurve: 1.35, speedSize: 0.12,
    flow: 0.44, flowJitter: 0.28, scatter: 0.38,
    texture: true, textureDepth: 0.48, textureScale: 1.6,
    dynamics: { sizeMin: 0.1, sizeMax: 1, scatterJitter: 0.2, angleJitter: 0.2, opacityMin: 0.08 },
    description: 'Clumping, coarse, high-contrast charcoal texture',
  }),
  nativeBrushPreset({
    id: 'native-soft-pastel', name: 'Soft Pastel', category: 'chalk', badge: 'Chalk',
    tip: 'soft', tipOptions: { hardness: 0.42 },
    size: 46, opacity: 0.62, hardness: 0.16, spacing: 0.13,
    smoothing: 0.38, pressureCurve: 1.1, speedSize: 0.06,
    flow: 0.32, flowJitter: 0.12, scatter: 0.14,
    texture: true, textureDepth: 0.28, textureScale: 1.3,
    dynamics: { sizeMin: 0.2, sizeMax: 1, scatterJitter: 0.1, opacityMin: 0.08 },
    description: 'Dusty, soft and layerable pastel',
  }),
  nativeBrushPreset({
    id: 'native-block-in', name: 'Block-in', category: 'concept', badge: 'Concept',
    tip: 'square', tipOptions: { inset: 0.06, radius: 0.01 }, tipRotation: 0.08,
    size: 48, opacity: 0.94, hardness: 0.84, spacing: 0.055,
    smoothing: 0.28, pressureCurve: 1.05, speedSize: 0.04,
    flow: 0.9, flowJitter: 0.025, scatter: 0,
    dynamics: { sizeMin: 0.38, sizeMax: 1, opacityMin: 0.24 },
    description: 'Square tip for blocking in large masses quickly',
  }),
  nativeBrushPreset({
    id: 'native-rake', name: 'Rake', category: 'concept', badge: 'Concept',
    tip: 'rake', tipOptions: { bristles: 7, spread: 0.62 }, stampFlipX: 0.5, tipRotation: 0.15,
    size: 30, opacity: 0.82, hardness: 0.8, spacing: 0.04,
    smoothing: 0.2, pressureCurve: 1.08, speedSize: 0.08,
    flow: 0.8, flowJitter: 0.04, scatter: 0.02,
    roundness: 1, angleFollow: true, angle: 0,
    dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.015, opacityMin: 0.18 },
    description: 'Hatching tip with hair bundles following the direction',
  }),
  nativeBrushPreset({
    id: 'native-foliage', name: 'Foliage / Environment', category: 'concept', badge: 'Concept',
    tip: 'noise', tipOptions: { density: 0.36, edge: 0.82 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
    size: 64, opacity: 0.72, hardness: 0.24, spacing: 0.2,
    smoothing: 0.18, pressureCurve: 1.18, speedSize: 0.1,
    flow: 0.5, flowJitter: 0.32, scatter: 1.05,
    texture: true, textureDepth: 0.46, textureScale: 0.9,
    dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.42, scatterJitter: 0.34, opacityMin: 0.14 },
    description: 'Loose texture for leaves, bushes and environment masses',
  }),
  nativeBrushPreset({
    id: 'native-watercolor', name: 'Watercolor', category: 'wet', badge: 'Wet',
    tip: 'watercolor', tipOptions: { core: 0.2, ring: 0.76, edge: 0.4 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
    // Uç yığını: 5 tohum + aynalama + rastgele dönüş → tekrar eden halka yok.
    // Seyrek damla + yüksek akış: aynı örtü, 3-4 kat daha az damga.
    tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.35,
    size: 56, opacity: 0.5, hardness: 0.1, spacing: 0.11,
    smoothing: 0.56, pressureCurve: 1.12, speedSize: 0.04,
    flow: 0.3, flowJitter: 0.1, scatter: 0.03,
    taperStart: 0.18, taperEnd: 0.24,
    texture: true, textureDepth: 0.12, textureScale: 1.25,
    dynamics: { sizeMin: 0.3, sizeMax: 1, scatterJitter: 0.06, spacingJitter: 0.2, opacityMin: 0.1 },
    description: 'Irregular pigment edge, paper texture and lively variation',
  }),
  nativeBrushPreset({
    id: 'native-wet-sponge', name: 'Wet Sponge', category: 'wet', badge: 'Wet',
    tip: 'watercolor', tipOptions: { core: 0.24, ring: 0.72, edge: 0.46 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
    size: 82, opacity: 0.44, hardness: 0.08, spacing: 0.065,
    smoothing: 0.48, pressureCurve: 1.2, speedSize: 0.04,
    flow: 0.1, flowJitter: 0.12, scatter: 0.12,
    texture: true, textureDepth: 0.24, textureScale: 1.2,
    dynamics: { sizeMin: 0.32, sizeMax: 1, scatterJitter: 0.1, angleJitter: 0.1, opacityMin: 0.06 },
    description: 'Broad, damp sponge leaving irregular stains',
  }),
  nativeBrushPreset({
    id: 'native-calligraphy', name: 'Classic Calligraphy', category: 'calligraphy', badge: 'Calligraphy',
    tip: 'oval', tipOptions: { ratio: 0.28 }, stampFlipX: 0.5, tipRotation: 0.6,
    size: 28, opacity: 1, hardness: 0.96, spacing: 0.025,
    smoothing: 0.64, pressureCurve: 1.02, speedSize: 0.04,
    flow: 0.96, taperStart: 0.1, taperEnd: 0.2,
    angle: -Math.PI / 4, angleFollow: false,
    dynamics: { sizeMin: 0.2, sizeMax: 1, opacityMin: 0.16 },
    description: 'Classic pencil tip with fixed angle and sharp edge',
  }),
  nativeBrushPreset({
    id: 'native-speed-brush', name: 'Speed Brush', category: 'calligraphy', badge: 'Calligraphy',
    tip: 'oval', tipOptions: { ratio: 0.36 }, stampFlipX: 0.5, tipRotation: 0.6,
    size: 22, opacity: 0.98, hardness: 0.9, spacing: 0.03,
    smoothing: 0.5, pressureCurve: 0.92, speedSize: 0.64,
    flow: 0.94, taperEnd: 0.12, angleFollow: true, angle: 0,
    dynamics: { sizeMin: 0.36, sizeMax: 1, opacityMin: 0.18 },
    description: 'Calligraphy line that thins as speed increases',
  }),
  nativeBrushPreset({
    id: 'native-grit-spray', name: 'Grit / Noise Spray', category: 'texture', badge: 'Texture',
    tip: 'noise', tipOptions: { density: 0.3, edge: 0.78 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
    size: 46, opacity: 0.62, hardness: 0.28, spacing: 0.22,
    smoothing: 0.16, pressureCurve: 1.25, speedSize: 0.08,
    flow: 0.32, flowJitter: 0.42, scatter: 1.3,
    texture: true, textureDepth: 0.54, textureScale: 1.4,
    dynamics: { sizeMin: 0.2, sizeMax: 1, angleJitter: 0.85, scatterJitter: 0.48, opacityMin: 0.08 },
    description: 'Sparse noise for sand, rust and spray effects',
  }),
  nativeBrushPreset({
    id: 'native-halftone', name: 'Halftone', category: 'texture', badge: 'Texture',
    tip: 'halftone', tipOptions: { dot: 0.055, gap: 0.13 }, stampFlipX: 0.5, tipRotation: 0.45,
    size: 40, opacity: 0.78, hardness: 0.7, spacing: 0.14,
    smoothing: 0.35, pressureCurve: 1.08, speedSize: 0.04,
    flow: 0.68, flowJitter: 0.08, scatter: 0.015,
    dynamics: { sizeMin: 0.38, sizeMax: 1, opacityMin: 0.18 },
    description: 'Graphic texture with dotted halftone pattern',
  }),
];

/* =========================================================
   PAKETLER · genişletilmiş yerel fırça kütüphanesi
   ---------------------------------------------------------
   Her paket en az 10 fırça içerir. Presetler yalnızca veridir;
   uçlar çalışma anında prosedürel olarak üretilir.
   ========================================================= */
function nativeBrushPack(category, badge, defs) {
  return defs.map(def => nativeBrushPreset(Object.assign({ category, badge }, def)));
}

NativeBrushLibrary.push(
  /* ---------------- INK PACK · mürekkep ve çizgi kalemleri ---------------- */
  ...nativeBrushPack('inking', 'Ink', [
    {
      id: 'native-g-pen', name: 'G-Pen', tip: 'oval', tipOptions: { ratio: 0.42 }, stampFlipX: 0.5, tipRotation: 0.6,
      size: 16, opacity: 1, hardness: 0.97, spacing: 0.028, smoothing: 0.5,
      pressureCurve: 1.15, speedSize: 0.18, flow: 0.98, taperStart: 0.04, taperEnd: 0.18,
      angleFollow: true, angle: 0,
      dynamics: { sizeMin: 0.15, sizeMax: 1, opacityMin: 0.2 },
      description: 'Classic manga G-Pen: sharp, juicy line that opens with pressure',
    },
    {
      id: 'native-maru-pen', name: 'Maru Pen', tip: 'oval', tipOptions: { ratio: 0.55 }, stampFlipX: 0.5, tipRotation: 0.6,
      size: 9, opacity: 1, hardness: 1, spacing: 0.02, smoothing: 0.6,
      pressureCurve: 1.25, speedSize: 0.1, flow: 1, taperStart: 0.02, taperEnd: 0.08,
      angleFollow: true,
      dynamics: { sizeMin: 0.12, sizeMax: 1, opacityMin: 0.24 },
      description: 'Maru tip for fine, flexible and very clean contours',
    },
    {
      id: 'native-mapping-pen', name: 'Mapping Pen', tip: 'oval', tipOptions: { ratio: 0.18 }, stampFlipX: 0.5, tipRotation: 0.6,
      size: 6, opacity: 1, hardness: 1, spacing: 0.018, smoothing: 0.66,
      pressureCurve: 1.3, speedSize: 0.05, flow: 1, taperEnd: 0.03,
      angle: -0.6,
      dynamics: { sizeMin: 0.2, sizeMax: 1, opacityMin: 0.3 },
      description: 'Fixed-angle very fine tip for maps and technical drawing',
    },
    {
      id: 'native-crowquill', name: 'Crowquill', tip: 'oval', tipOptions: { ratio: 0.12 }, stampFlipX: 0.5, tipRotation: 0.6,
      size: 4, opacity: 1, hardness: 1, spacing: 0.016, smoothing: 0.55,
      pressureCurve: 1.45, speedSize: 0.2, flow: 1, taperStart: 0.05, taperEnd: 0.3,
      angleFollow: true,
      dynamics: { sizeMin: 0.08, sizeMax: 1, opacityMin: 0.18 },
      description: 'Flexible crowquill tip for fast, very fine hatching',
    },
    {
      id: 'native-brush-pen', name: 'Brush Pen', tip: 'oval', tipOptions: { ratio: 0.62 }, stampFlipX: 0.5, tipRotation: 0.6,
      size: 22, opacity: 0.98, hardness: 0.9, spacing: 0.03, smoothing: 0.58,
      pressureCurve: 1.05, speedSize: 0.15, flow: 0.92, taperStart: 0.12, taperEnd: 0.3,
      angleFollow: true,
      dynamics: { sizeMin: 0.16, sizeMax: 1, opacityMin: 0.16 },
      description: 'Brush pen: soft entry, full body and fine exit',
    },
    {
      id: 'native-technical-pen', name: 'Technical Pencil 0.1', tip: 'circle',
      size: 3, opacity: 1, hardness: 1, spacing: 0.02, smoothing: 0.3,
      pressureCurve: 1, speedSize: 0, flow: 1,
      dynamics: { sizeMin: 0.9, sizeMax: 1, opacityMin: 0.95 },
      description: 'Crisp line of constant thickness like a Rapido/technical pen',
    },
    {
      id: 'native-boro-pen', name: 'Boro Pencil', tip: 'circle',
      size: 10, opacity: 1, hardness: 0.96, spacing: 0.025, smoothing: 0.54,
      pressureCurve: 1.18, speedSize: 0.14, flow: 0.9, taperStart: 0.04, taperEnd: 0.12,
      dynamics: { sizeMin: 0.22, sizeMax: 1, opacityMin: 0.22 },
      description: 'Round-tipped, flowing and slightly thinning ink pen',
    },
    {
      id: 'native-ink-splatter', name: 'Ink Splatter', tip: 'noise', tipOptions: { density: 0.28, edge: 0.9 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 30, opacity: 0.78, hardness: 0.4, spacing: 0.16, smoothing: 0.2,
      pressureCurve: 1.2, speedSize: 0.1, flow: 0.55, scatter: 1.1,
      scatterCount: 3, scatterCountJitter: 0.6, texture: true, textureDepth: 0.35,
      dynamics: { sizeMin: 0.2, sizeMax: 1, scatterJitter: 0.3, opacityMin: 0.1 },
      description: 'Controlled ink splatters and speckled texture',
    },
    {
      id: 'native-ink-dry-brush', name: 'Dry Ink Brush', tip: 'rake', tipOptions: { bristles: 12, spread: 0.8 }, stampFlipX: 0.5, tipRotation: 0.15,
      size: 28, opacity: 0.85, hardness: 0.7, spacing: 0.05, smoothing: 0.25,
      pressureCurve: 1.25, speedSize: 0.18, flow: 0.65, flowJitter: 0.18,
      texture: true, textureDepth: 0.3, textureScale: 1.8, textureId: 'paper',
      angleFollow: true,
      dynamics: { sizeMin: 0.18, sizeMax: 1, angleJitter: 0.05, opacityMin: 0.14 },
      description: 'Dry-brush ink texture with separated hair marks',
    },
  ]),

  /* ---------------- GRAFİT PACK · kurşun kalemler ---------------- */
  ...nativeBrushPack('sketch', 'Graphite', [
    {
      id: 'native-2b-pencil', name: '2B Pencil', tip: 'noise', tipOptions: { density: 0.5, edge: 0.95 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 8, opacity: 0.85, hardness: 0.8, spacing: 0.05, smoothing: 0.3,
      pressureCurve: 1.3, speedSize: 0.06, flow: 0.62, flowJitter: 0.1, scatter: 0.05,
      texture: true, textureDepth: 0.36, textureScale: 1.8,
      dynamics: { sizeMin: 0.15, sizeMax: 1, scatterJitter: 0.06, spacingJitter: 0.03, opacityMin: 0.1 },
      description: 'Medium-soft, grainy and reliable 2B sketch pencil',
    },
    {
      id: 'native-4b-pencil', name: '4B Pencil', tip: 'noise', tipOptions: { density: 0.56, edge: 0.94 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 10, opacity: 0.9, hardness: 0.72, spacing: 0.055, smoothing: 0.28,
      pressureCurve: 1.32, speedSize: 0.07, flow: 0.66, flowJitter: 0.12, scatter: 0.06,
      texture: true, textureDepth: 0.42, textureScale: 1.7,
      dynamics: { sizeMin: 0.14, sizeMax: 1, scatterJitter: 0.08, spacingJitter: 0.04, opacityMin: 0.1 },
      description: 'Soft 4B for dark tones and shadow hatching',
    },
    {
      id: 'native-6b-pencil', name: '6B Pencil', tip: 'noise', tipOptions: { density: 0.62, edge: 0.92 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 14, opacity: 0.92, hardness: 0.62, spacing: 0.065, smoothing: 0.26,
      pressureCurve: 1.35, speedSize: 0.08, flow: 0.7, flowJitter: 0.14, scatter: 0.08,
      texture: true, textureDepth: 0.5, textureScale: 1.6,
      dynamics: { sizeMin: 0.12, sizeMax: 1, scatterJitter: 0.1, spacingJitter: 0.05, opacityMin: 0.08 },
      description: 'Very soft 6B for deep blacks and textured shading',
    },
    {
      id: 'native-mechanical-pencil', name: 'Mechanical Pencil', tip: 'circle',
      size: 4, opacity: 0.92, hardness: 0.95, spacing: 0.022, smoothing: 0.35,
      pressureCurve: 1.35, speedSize: 0.04, flow: 0.9, taperEnd: 0.03,
      dynamics: { sizeMin: 0.3, sizeMax: 1, opacityMin: 0.25 },
      description: 'Crisp, clean, controlled line like a fixed 0.5 mm tip',
    },
    {
      id: 'native-blue-pencil', name: 'Blue Pencil', tip: 'noise', tipOptions: { density: 0.45, edge: 0.94 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 7, opacity: 0.7, hardness: 0.75, spacing: 0.05, smoothing: 0.34,
      pressureCurve: 1.22, speedSize: 0.05, flow: 0.55, flowJitter: 0.08, scatter: 0.04,
      texture: true, textureDepth: 0.3, textureScale: 1.6,
      dynamics: { sizeMin: 0.2, sizeMax: 1, scatterJitter: 0.05, opacityMin: 0.12 },
      description: 'Light blue pencil for underdrawing and sketch planning',
    },
    {
      id: 'native-sepia-pencil', name: 'Sepia Pencil', tip: 'noise', tipOptions: { density: 0.48, edge: 0.94 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 8, opacity: 0.78, hardness: 0.78, spacing: 0.05, smoothing: 0.3,
      pressureCurve: 1.28, speedSize: 0.06, flow: 0.58, flowJitter: 0.09, scatter: 0.05,
      texture: true, textureDepth: 0.34, textureScale: 1.75,
      dynamics: { sizeMin: 0.16, sizeMax: 1, scatterJitter: 0.06, spacingJitter: 0.03, opacityMin: 0.1 },
      description: 'Warm-toned sepia pencil: classic sketch and anatomy studies',
    },
    {
      id: 'native-graphite-stick', name: 'Graphite Stick', tip: 'square', tipOptions: { inset: 0.08, radius: 0.02 }, tipRotation: 0.08,
      size: 18, opacity: 0.8, hardness: 0.55, spacing: 0.07, smoothing: 0.25,
      pressureCurve: 1.2, speedSize: 0.05, flow: 0.7, scatter: 0.06,
      texture: true, textureDepth: 0.42, textureScale: 1.4, angleFollow: true,
      dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.04, opacityMin: 0.16 },
      description: 'Angular graphite stick: broad, textured, directional mark',
    },
    {
      id: 'native-graphite-powder', name: 'Graphite Powder', tip: 'noise', tipOptions: { density: 0.3, edge: 0.8 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 30, opacity: 0.55, hardness: 0.2, spacing: 0.18, smoothing: 0.2,
      pressureCurve: 1.2, speedSize: 0.06, flow: 0.35, scatter: 1.2,
      scatterCount: 3, scatterCountJitter: 0.5, texture: true, textureDepth: 0.4,
      dynamics: { sizeMin: 0.2, sizeMax: 1, scatterJitter: 0.3, opacityMin: 0.06 },
      description: 'Soft graphite powder like smudged with a finger',
    },
    {
      id: 'native-rough-sketch', name: 'Rough Sketch', tip: 'noise', tipOptions: { density: 0.42, edge: 0.94 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 12, opacity: 0.68, hardness: 0.5, spacing: 0.08, smoothing: 0.18,
      pressureCurve: 1.28, speedSize: 0.1, flow: 0.45, flowJitter: 0.22, scatter: 0.2,
      texture: true, textureDepth: 0.38, textureScale: 1.9,
      dynamics: { sizeMin: 0.15, sizeMax: 1, angleJitter: 0.15, scatterJitter: 0.15, opacityMin: 0.08 },
      description: 'Fast, loose and energetic idea sketches',
    },
  ]),

  /* ---------------- CHARCOAL PACK · kömür ---------------- */
  ...nativeBrushPack('charcoal', 'Charcoal', [
    {
      id: 'native-charcoal-vine', name: 'Vine Charcoal', tip: 'noise', tipOptions: { density: 0.38, edge: 0.88 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 26, opacity: 0.62, hardness: 0.2, spacing: 0.1, smoothing: 0.24,
      pressureCurve: 1.3, speedSize: 0.12, flow: 0.35, flowJitter: 0.22, scatter: 0.35,
      texture: true, textureDepth: 0.45, textureScale: 1.5, textureId: 'paper',
      dynamics: { sizeMin: 0.15, sizeMax: 1, angleJitter: 0.15, scatterJitter: 0.2, opacityMin: 0.08 },
      description: 'Light, dusty vine charcoal that spreads easily',
    },
    {
      id: 'native-charcoal-compressed', name: 'Compressed Charcoal', tip: 'noise', tipOptions: { density: 0.62, edge: 0.93 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 20, opacity: 0.9, hardness: 0.55, spacing: 0.07, smoothing: 0.28,
      pressureCurve: 1.2, speedSize: 0.1, flow: 0.6, flowJitter: 0.1, scatter: 0.12,
      texture: true, textureDepth: 0.38, textureScale: 1.7,
      dynamics: { sizeMin: 0.2, sizeMax: 1, angleJitter: 0.08, opacityMin: 0.14 },
      description: 'Dense, dark, high-contrast compressed charcoal',
    },
    {
      id: 'native-charcoal-willow', name: 'Willow Charcoal', tip: 'noise', tipOptions: { density: 0.28, edge: 0.82 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 34, opacity: 0.55, hardness: 0.12, spacing: 0.11, smoothing: 0.2,
      pressureCurve: 1.35, speedSize: 0.14, flow: 0.3, flowJitter: 0.28, scatter: 0.45,
      texture: true, textureDepth: 0.5, textureScale: 1.3,
      dynamics: { sizeMin: 0.12, sizeMax: 1, angleJitter: 0.25, scatterJitter: 0.25, opacityMin: 0.06 },
      description: 'Very soft willow charcoal covering wide areas',
    },
    {
      id: 'native-charcoal-smudge', name: 'Charcoal Blender', tip: 'soft', tipOptions: { hardness: 0.08 },
      size: 48, opacity: 0.4, hardness: 0.05, spacing: 0.09, smoothing: 0.35,
      pressureCurve: 1.15, speedSize: 0.04, flow: 0.2, scatter: 0.08,
      texture: true, textureDepth: 0.3, textureScale: 1.1,
      dynamics: { sizeMin: 0.35, sizeMax: 1, scatterJitter: 0.08, opacityMin: 0.04 },
      description: 'Broad blender tip that softens charcoal gently',
    },
    {
      id: 'native-charcoal-block', name: 'Charcoal Block', tip: 'square', tipOptions: { inset: 0.04, radius: 0.03 }, tipRotation: 0.08,
      size: 40, opacity: 0.78, hardness: 0.45, spacing: 0.08, smoothing: 0.26,
      pressureCurve: 1.18, speedSize: 0.06, flow: 0.5, scatter: 0.1,
      texture: true, textureDepth: 0.35, textureScale: 1.6, angleFollow: true,
      dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.05, opacityMin: 0.14 },
      description: 'Angled charcoal block for closing large surfaces fast',
    },
    {
      id: 'native-charcoal-powder', name: 'Charcoal Powder', tip: 'noise', tipOptions: { density: 0.22, edge: 0.78 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 46, opacity: 0.48, hardness: 0.1, spacing: 0.2, smoothing: 0.18,
      pressureCurve: 1.22, speedSize: 0.08, flow: 0.28, scatter: 1.35,
      scatterCount: 4, scatterCountJitter: 0.6, texture: true, textureDepth: 0.5, textureScale: 1.2,
      dynamics: { sizeMin: 0.2, sizeMax: 1, angleJitter: 0.5, scatterJitter: 0.4, opacityMin: 0.05 },
      description: 'Charcoal powder scattering in the air like sprinkled on paper',
    },
    {
      id: 'native-charcoal-pencil', name: 'Charcoal Pencil', tip: 'circle',
      size: 6, opacity: 0.75, hardness: 0.6, spacing: 0.04, smoothing: 0.3,
      pressureCurve: 1.25, speedSize: 0.06, flow: 0.55, scatter: 0.03,
      texture: true, textureDepth: 0.3, textureScale: 2, taperStart: 0.04, taperEnd: 0.08,
      dynamics: { sizeMin: 0.2, sizeMax: 1, opacityMin: 0.1 },
      description: 'Fine, textured and sharp detail with charcoal pencil',
    },
    {
      id: 'native-charcoal-soft-stick', name: 'Soft Charcoal Stick', tip: 'noise', tipOptions: { density: 0.34, edge: 0.9 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 30, opacity: 0.7, hardness: 0.25, spacing: 0.09, smoothing: 0.22,
      pressureCurve: 1.25, speedSize: 0.1, flow: 0.42, scatter: 0.25,
      texture: true, textureDepth: 0.45, textureScale: 1.5, angleFollow: true,
      dynamics: { sizeMin: 0.2, sizeMax: 1, angleJitter: 0.12, opacityMin: 0.1 },
      description: 'Broad, grainy mark of the soft charcoal stick',
    },
    {
      id: 'native-charcoal-hard-stick', name: 'Hard Charcoal Stick', tip: 'square', tipOptions: { inset: 0.1, radius: 0.05 }, tipRotation: 0.08,
      size: 16, opacity: 0.92, hardness: 0.8, spacing: 0.05, smoothing: 0.3,
      pressureCurve: 1.15, speedSize: 0.06, flow: 0.72, scatter: 0.05,
      texture: true, textureDepth: 0.25, textureScale: 1.8, angleFollow: true,
      dynamics: { sizeMin: 0.35, sizeMax: 1, angleJitter: 0.03, opacityMin: 0.24 },
      description: 'Hard charcoal for sharp edges and controlled detail',
    },
    {
      id: 'native-charcoal-paper', name: 'Paper-Textured Charcoal', tip: 'noise', tipOptions: { density: 0.4, edge: 0.92 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 24, opacity: 0.68, hardness: 0.3, spacing: 0.12, smoothing: 0.24,
      pressureCurve: 1.28, speedSize: 0.08, flow: 0.38, scatter: 0.3,
      texture: true, textureDepth: 0.58, textureScale: 2.2, textureId: 'canvas',
      dynamics: { sizeMin: 0.18, sizeMax: 1, angleJitter: 0.3, scatterJitter: 0.2, opacityMin: 0.08 },
      description: 'Charcoal texture breaking on rough paper',
    },
    {
      id: 'native-charcoal-cloud', name: 'Charcoal Cloud', tip: 'soft', tipOptions: { hardness: 0.35 },
      size: 60, opacity: 0.35, hardness: 0.2, spacing: 0.1, smoothing: 0.2,
      pressureCurve: 1.1, speedSize: 0.04, flow: 0.18, scatter: 1.6,
      scatterCount: 4, scatterCountJitter: 0.7, texture: true, textureDepth: 0.2,
      dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.4, scatterJitter: 0.4, opacityMin: 0.04 },
      description: 'Soft, loose charcoal clouds and atmosphere',
    },
  ]),

  /* ---------------- CHALK PACK · tebeşir ve kuru pastel ---------------- */
  ...nativeBrushPack('chalk', 'Chalk', [
    {
      id: 'native-chalk-soft', name: 'Soft Chalk', tip: 'noise', tipOptions: { density: 0.34, edge: 0.9 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 32, opacity: 0.72, hardness: 0.2, spacing: 0.12, smoothing: 0.26,
      pressureCurve: 1.2, speedSize: 0.06, flow: 0.4, scatter: 0.2,
      texture: true, textureDepth: 0.42, textureScale: 1.8, textureId: 'sand',
      dynamics: { sizeMin: 0.25, sizeMax: 1, angleJitter: 0.2, opacityMin: 0.1 },
      description: 'Dusty, matte, broad soft chalk',
    },
    {
      id: 'native-chalk-hard', name: 'Hard Chalk', tip: 'noise', tipOptions: { density: 0.58, edge: 0.95 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 14, opacity: 0.9, hardness: 0.7, spacing: 0.06, smoothing: 0.32,
      pressureCurve: 1.12, speedSize: 0.04, flow: 0.66, scatter: 0.05,
      texture: true, textureDepth: 0.28, textureScale: 1.4,
      dynamics: { sizeMin: 0.4, sizeMax: 1, angleJitter: 0.05, opacityMin: 0.24 },
      description: 'Crisp-edged, bright and controlled hard chalk',
    },
    {
      id: 'native-chalk-pastel', name: 'Dry Pastel', tip: 'soft', tipOptions: { hardness: 0.35 },
      size: 38, opacity: 0.62, hardness: 0.16, spacing: 0.1, smoothing: 0.34,
      pressureCurve: 1.2, speedSize: 0.05, flow: 0.3, scatter: 0.15,
      texture: true, textureDepth: 0.34, textureScale: 1.5,
      dynamics: { sizeMin: 0.28, sizeMax: 1, angleJitter: 0.12, opacityMin: 0.08 },
      description: 'Softly transitioning, velvety dry pastel',
    },
    {
      id: 'native-chalk-board', name: 'Blackboard Chalk', tip: 'noise', tipOptions: { density: 0.45, edge: 0.9 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 20, opacity: 0.8, hardness: 0.3, spacing: 0.1, smoothing: 0.28,
      pressureCurve: 1.18, speedSize: 0.06, flow: 0.5, flowJitter: 0.15, scatter: 0.25,
      texture: true, textureDepth: 0.5, textureScale: 2.4, textureId: 'canvas',
      dynamics: { sizeMin: 0.2, sizeMax: 1, angleJitter: 0.25, scatterJitter: 0.15, opacityMin: 0.1 },
      description: 'Gritty chalk mark breaking on a blackboard',
    },
    {
      id: 'native-chalk-grain', name: 'Gritty Chalk', tip: 'noise', tipOptions: { density: 0.55, edge: 0.92 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 24, opacity: 0.78, hardness: 0.35, spacing: 0.09, smoothing: 0.24,
      pressureCurve: 1.25, speedSize: 0.08, flow: 0.55, scatter: 0.3,
      texture: true, textureDepth: 0.6, textureScale: 2.8, textureId: 'sand',
      dynamics: { sizeMin: 0.18, sizeMax: 1, angleJitter: 0.3, scatterJitter: 0.2, opacityMin: 0.08 },
      description: 'Chalk leaving coarse grain and sand texture',
    },
    {
      id: 'native-chalk-side', name: 'Sideways Chalk', tip: 'square', tipOptions: { inset: 0.02, radius: 0.02 }, tipRotation: 0.08,
      size: 30, opacity: 0.68, hardness: 0.25, spacing: 0.1, smoothing: 0.2,
      pressureCurve: 1.15, speedSize: 0.05, flow: 0.38, scatter: 0.1,
      texture: true, textureDepth: 0.45, textureScale: 2, roundness: 0.35, angleFollow: true,
      dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.04, opacityMin: 0.14 },
      description: 'Broad, rough hatching with the side of the chalk',
    },
    {
      id: 'native-chalk-dust', name: 'Chalk Powder', tip: 'noise', tipOptions: { density: 0.2, edge: 0.75 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 52, opacity: 0.42, hardness: 0.08, spacing: 0.2, smoothing: 0.16,
      pressureCurve: 1.2, speedSize: 0.05, flow: 0.22, scatter: 1.4,
      scatterCount: 5, scatterCountJitter: 0.7, texture: true, textureDepth: 0.3,
      dynamics: { sizeMin: 0.2, sizeMax: 1, angleJitter: 0.6, scatterJitter: 0.45, opacityMin: 0.04 },
      description: 'Chalk dust hanging in the air and soft stains',
    },
    {
      id: 'native-chalk-softmix', name: 'Chalk Blender', tip: 'soft', tipOptions: { hardness: 0.02 },
      size: 60, opacity: 0.3, hardness: 0.02, spacing: 0.08, smoothing: 0.4,
      pressureCurve: 1.1, speedSize: 0.03, flow: 0.12, scatter: 0.1,
      texture: true, textureDepth: 0.18, textureScale: 1.2,
      dynamics: { sizeMin: 0.4, sizeMax: 1, scatterJitter: 0.08, opacityMin: 0.03 },
      description: 'Broad blender softening chalk and pastel tones',
    },
    {
      id: 'native-chalk-conte', name: 'Conté Pencil', tip: 'square', tipOptions: { inset: 0.06, radius: 0.08 }, tipRotation: 0.08,
      size: 14, opacity: 0.88, hardness: 0.6, spacing: 0.06, smoothing: 0.3,
      pressureCurve: 1.2, speedSize: 0.05, flow: 0.6, scatter: 0.06,
      texture: true, textureDepth: 0.4, textureScale: 1.7, textureId: 'sand', angleFollow: true,
      dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.05, opacityMin: 0.18 },
      description: 'Conté crayon: dense, matte line with defined edge',
    },
    {
      id: 'native-chalk-sanguine', name: 'Sanguine', tip: 'noise', tipOptions: { density: 0.4, edge: 0.9 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 18, opacity: 0.74, hardness: 0.3, spacing: 0.08, smoothing: 0.32,
      pressureCurve: 1.22, speedSize: 0.06, flow: 0.45, scatter: 0.18,
      texture: true, textureDepth: 0.46, textureScale: 1.9,
      dynamics: { sizeMin: 0.22, sizeMax: 1, angleJitter: 0.18, opacityMin: 0.1 },
      description: 'Reddish, warm-toned classic sanguine pencil',
    },
  ]),

  /* ---------------- AIRBRUSH PACK · hava fırçası ---------------- */
  ...nativeBrushPack('airbrush', 'Airbrush', [
    {
      id: 'native-airbrush-soft', name: 'Soft Airbrush', tip: 'soft', tipOptions: { hardness: 0.12 },
      size: 70, opacity: 0.5, hardness: 0.12, spacing: 0.06, smoothing: 0.45,
      pressureCurve: 1.05, speedSize: 0.04, flow: 0.5, airbrush: true,
      dynamics: { sizeMin: 0.5, sizeMax: 1, opacityMin: 0.12 },
      description: 'Wide and soft airbrush for velvety transitions',
    },
    {
      id: 'native-airbrush-hard', name: 'Hard Airbrush', tip: 'soft', tipOptions: { hardness: 0.72 },
      size: 40, opacity: 0.7, hardness: 0.72, spacing: 0.04, smoothing: 0.4,
      pressureCurve: 1, speedSize: 0.03, flow: 0.6, airbrush: true,
      dynamics: { sizeMin: 0.6, sizeMax: 1, opacityMin: 0.24 },
      description: 'More defined-edged, controlled airbrush',
    },
    {
      id: 'native-airbrush-fine', name: 'Fine Airbrush', tip: 'soft', tipOptions: { hardness: 0.5 },
      size: 10, opacity: 0.75, hardness: 0.5, spacing: 0.03, smoothing: 0.55,
      pressureCurve: 1.1, speedSize: 0.1, flow: 0.55, airbrush: true,
      dynamics: { sizeMin: 0.35, sizeMax: 1, opacityMin: 0.2 },
      description: 'Fine detail and soft edge transitions',
    },
    {
      id: 'native-airbrush-spray', name: 'Spray', tip: 'soft', tipOptions: { hardness: 0.2 },
      size: 60, opacity: 0.45, hardness: 0.2, spacing: 0.12, smoothing: 0.3,
      pressureCurve: 1.15, speedSize: 0.06, flow: 0.4, scatter: 1,
      scatterCount: 2, scatterCountJitter: 0.4, airbrush: true,
      texture: true, textureDepth: 0.2, textureScale: 1.5,
      dynamics: { sizeMin: 0.4, sizeMax: 1, scatterJitter: 0.3, opacityMin: 0.08 },
      description: 'Loose, soft spraying like a classic spray can',
    },
    {
      id: 'native-airbrush-wide', name: 'Wide Airbrush', tip: 'soft', tipOptions: { hardness: 0.08 },
      size: 140, opacity: 0.38, hardness: 0.08, spacing: 0.08, smoothing: 0.5,
      pressureCurve: 1, speedSize: 0.02, flow: 0.45, airbrush: true,
      dynamics: { sizeMin: 0.55, sizeMax: 1, opacityMin: 0.1 },
      description: 'Atmosphere and color transitions on large surfaces',
    },
    {
      id: 'native-airbrush-detail', name: 'Detail Airbrush', tip: 'soft', tipOptions: { hardness: 0.4 },
      size: 6, opacity: 0.8, hardness: 0.4, spacing: 0.025, smoothing: 0.6,
      pressureCurve: 1.1, speedSize: 0.12, flow: 0.5, airbrush: true,
      dynamics: { sizeMin: 0.3, sizeMax: 1, opacityMin: 0.22 },
      description: 'Small-scale soft detail and light spots',
    },
    {
      id: 'native-airbrush-taper', name: 'Tapered Airbrush', tip: 'soft', tipOptions: { hardness: 0.25 },
      size: 30, opacity: 0.6, hardness: 0.25, spacing: 0.04, smoothing: 0.45,
      pressureCurve: 0.9, speedSize: 0.3, flow: 0.55, airbrush: true,
      dynamics: { sizeMin: 0.2, sizeMax: 1, opacityMin: 0.16 },
      description: 'Conical, flowing spray trail that thins with speed',
    },
    {
      id: 'native-airbrush-grain', name: 'Grainy Airbrush', tip: 'soft', tipOptions: { hardness: 0.3 },
      size: 50, opacity: 0.5, hardness: 0.3, spacing: 0.1, smoothing: 0.3,
      pressureCurve: 1.12, speedSize: 0.05, flow: 0.4, airbrush: true,
      texture: true, textureDepth: 0.4, textureScale: 2, textureId: 'sand',
      dynamics: { sizeMin: 0.4, sizeMax: 1, opacityMin: 0.08 },
      description: 'Soft spray texture carrying sand grain',
    },
    {
      id: 'native-airbrush-speckle', name: 'Speckle Spray', tip: 'noise', tipOptions: { density: 0.4, edge: 0.85 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 40, opacity: 0.6, hardness: 0.4, spacing: 0.18, smoothing: 0.2,
      pressureCurve: 1.2, speedSize: 0.05, flow: 0.5, scatter: 1.3,
      scatterCount: 3, scatterCountJitter: 0.8, airbrush: true,
      dynamics: { sizeMin: 0.25, sizeMax: 1, scatterJitter: 0.4, opacityMin: 0.06 },
      description: 'Individual speckles and a spray of grit',
    },
    {
      id: 'native-airbrush-haze', name: 'Haze', tip: 'soft', tipOptions: { hardness: 0.02 },
      size: 180, opacity: 0.4, hardness: 0.02, spacing: 0.09, smoothing: 0.55,
      pressureCurve: 1, speedSize: 0.02, flow: 0.5, airbrush: true,
      texture: true, textureDepth: 0.1, textureScale: 1,
      dynamics: { sizeMin: 0.6, sizeMax: 1, opacityMin: 0.08 },
      description: 'Almost invisible, multi-layer atmospheric haze',
    },
    {
      id: 'native-airbrush-stencil', name: 'Template Airbrush', tip: 'square', tipOptions: { inset: 0.02, radius: 0.04 }, tipRotation: 0.08,
      size: 60, opacity: 0.55, hardness: 0.6, spacing: 0.05, smoothing: 0.2,
      pressureCurve: 1.05, speedSize: 0.03, flow: 0.5, airbrush: true,
      dynamics: { sizeMin: 0.5, sizeMax: 1, opacityMin: 0.15 },
      description: 'Spraying sharp like a stencil edge but soft',
    },
    {
      id: 'native-airbrush-glow', name: 'Glow', tip: 'soft', tipOptions: { hardness: 0.05 },
      size: 90, opacity: 0.4, hardness: 0.05, spacing: 0.05, smoothing: 0.5,
      pressureCurve: 0.95, speedSize: 0.02, flow: 0.5, airbrush: true,
      dynamics: { sizeMin: 0.45, sizeMax: 1, opacityMin: 0.08 },
      description: 'Soft halo for light sources and glows',
    },
  ]),

  /* ---------------- WATERCOLOR PACK · sulu boya ---------------- */
  ...nativeBrushPack('wet', 'Watercolor', [
    {
      id: 'native-watercolor-round', name: 'Round Watercolor', tip: 'watercolor', tipOptions: { core: 0.3, ring: 0.8, edge: 0.5 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
      size: 40, opacity: 0.45, hardness: 0.12, spacing: 0.035, smoothing: 0.56,
      pressureCurve: 1.1, speedSize: 0.04, flow: 0.12, wetEdges: 0.35,
      texture: true, textureDepth: 0.18, textureScale: 1.3,
      dynamics: { sizeMin: 0.3, sizeMax: 1, spacingJitter: 0.05, opacityMin: 0.08 },
      description: 'Classic round watercolor: soft body, pigment edge',
    },
    {
      id: 'native-watercolor-flat', name: 'Flat Watercolor', tip: 'watercolor', tipOptions: { core: 0.28, ring: 0.78, edge: 0.55 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
      size: 46, opacity: 0.42, hardness: 0.1, spacing: 0.04, smoothing: 0.5,
      pressureCurve: 1.12, speedSize: 0.06, flow: 0.1, wetEdges: 0.3,
      roundness: 0.45, angleFollow: true, texture: true, textureDepth: 0.16, textureScale: 1.2,
      dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.02, opacityMin: 0.07 },
      description: 'Broad, one-directional watercolor washes with a flat brush',
    },
    {
      id: 'native-watercolor-wash', name: 'Broad Wash', tip: 'watercolor', tipOptions: { core: 0.16, ring: 0.72, edge: 0.34 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
      size: 120, opacity: 0.36, hardness: 0.06, spacing: 0.03, smoothing: 0.6,
      pressureCurve: 1.05, speedSize: 0.02, flow: 0.18, scatter: 0.04, wetEdges: 0.45,
      texture: true, textureDepth: 0.12, textureScale: 1.1,
      dynamics: { sizeMin: 0.5, sizeMax: 1, opacityMin: 0.04 },
      description: 'Transparent wash for skies and large backgrounds',
    },
    {
      id: 'native-watercolor-edge', name: 'Edge Watercolor', tip: 'watercolor', tipOptions: { core: 0.14, ring: 0.86, edge: 0.68 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
      size: 36, opacity: 0.5, hardness: 0.12, spacing: 0.03, smoothing: 0.54,
      pressureCurve: 1.12, speedSize: 0.04, flow: 0.1, wetEdges: 0.7,
      texture: true, textureDepth: 0.14, textureScale: 1.2,
      dynamics: { sizeMin: 0.3, sizeMax: 1, spacingJitter: 0.06, opacityMin: 0.09 },
      description: 'Pronounced pigment pooling and wet edge line',
    },
    {
      id: 'native-watercolor-granulation', name: 'Granulation', tip: 'watercolor', tipOptions: { core: 0.24, ring: 0.8, edge: 0.5 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
      size: 55, opacity: 0.38, hardness: 0.1, spacing: 0.05, smoothing: 0.48,
      pressureCurve: 1.15, speedSize: 0.03, flow: 0.08, wetEdges: 0.4,
      texture: true, textureDepth: 0.55, textureScale: 2.6, textureId: 'sand',
      dual: { brushId: 'native-halftone', diameter: 22, scale: 0.4, spacing: 1, scatter: 0.7, blend: 'multiply', hardness: 0.7 },
      dynamics: { sizeMin: 0.35, sizeMax: 1, spacingJitter: 0.1, opacityMin: 0.05 },
      description: 'Pigment granules sinking like sand and speckled texture',
    },
    {
      id: 'native-watercolor-dry', name: 'Dry Watercolor', tip: 'watercolor', tipOptions: { core: 0.3, ring: 0.82, edge: 0.6 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
      size: 44, opacity: 0.35, hardness: 0.14, spacing: 0.08, smoothing: 0.3,
      pressureCurve: 1.2, speedSize: 0.08, flow: 0.14, flowJitter: 0.2, scatter: 0.15, wetEdges: 0.25,
      texture: true, textureDepth: 0.6, textureScale: 2.2, textureId: 'canvas',
      dynamics: { sizeMin: 0.25, sizeMax: 1, angleJitter: 0.2, opacityMin: 0.05 },
      description: 'Paint worked with little water, catching paper texture',
    },
    {
      id: 'native-watercolor-wet-on-wet', name: 'Wet on Wet', tip: 'watercolor', tipOptions: { core: 0.14, ring: 0.95, edge: 0.25 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
      size: 80, opacity: 0.36, hardness: 0.04, spacing: 0.03, smoothing: 0.62,
      pressureCurve: 1, speedSize: 0.02, flow: 0.16, wetEdges: 0.6,
      texture: true, textureDepth: 0.08, textureScale: 1,
      dynamics: { sizeMin: 0.45, sizeMax: 1, spacingJitter: 0.12, opacityMin: 0.03 },
      description: 'Very soft stains blending into wet paper',
    },
    {
      id: 'native-watercolor-detail', name: 'Watercolor Detail', tip: 'watercolor', tipOptions: { core: 0.34, ring: 0.7, edge: 0.45 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
      size: 10, opacity: 0.6, hardness: 0.2, spacing: 0.03, smoothing: 0.6,
      pressureCurve: 1.18, speedSize: 0.06, flow: 0.18, wetEdges: 0.3,
      texture: true, textureDepth: 0.12, textureScale: 1.4,
      dynamics: { sizeMin: 0.3, sizeMax: 1, spacingJitter: 0.04, opacityMin: 0.12 },
      description: 'Fine details and thin watercolor lines',
    },
    {
      id: 'native-watercolor-liner', name: 'Watercolor Pen', tip: 'watercolor', tipOptions: { core: 0.4, ring: 0.66, edge: 0.4 }, tipVariants: 5, tipSeed: 17, stampFlipX: 0.5, tipRotation: 0.3,
      size: 4, opacity: 0.7, hardness: 0.3, spacing: 0.025, smoothing: 0.64,
      pressureCurve: 1.25, speedSize: 0.05, flow: 0.25, wetEdges: 0.2,
      dynamics: { sizeMin: 0.25, sizeMax: 1, opacityMin: 0.16 },
      description: 'Thin, slightly scattered contour with a watercolor pencil',
    },
    {
      id: 'native-watercolor-salt', name: 'Salt Texture', tip: 'noise', tipOptions: { density: 0.3, edge: 0.9 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 50, opacity: 0.4, hardness: 0.14, spacing: 0.14, smoothing: 0.3,
      pressureCurve: 1.15, speedSize: 0.03, flow: 0.16, scatter: 1.1,
      scatterCount: 4, scatterCountJitter: 0.8, wetEdges: 0.35,
      texture: true, textureDepth: 0.5, textureScale: 1.5,
      dynamics: { sizeMin: 0.25, sizeMax: 1, scatterJitter: 0.35, opacityMin: 0.04 },
      description: 'Salt-sprinkled watercolor stains opening in speckles',
    },
  ]),

  /* ---------------- CONCEPT PACK · konsept sanatı ---------------- */
  ...nativeBrushPack('concept', 'Concept', [
    {
      id: 'native-concept-hard-round', name: 'Hard Round', tip: 'circle',
      size: 36, opacity: 0.95, hardness: 0.9, spacing: 0.04, smoothing: 0.28,
      pressureCurve: 1.08, speedSize: 0.04, flow: 0.9,
      dynamics: { sizeMin: 0.7, sizeMax: 1, opacityMin: 0.6 },
      description: 'Stiff, hard round brush for fast block-in',
    },
    {
      id: 'native-concept-soft-round', name: 'Soft Round', tip: 'soft', tipOptions: { hardness: 0.3 },
      size: 50, opacity: 0.8, hardness: 0.3, spacing: 0.05, smoothing: 0.4,
      pressureCurve: 1.05, speedSize: 0.04, flow: 0.6,
      dynamics: { sizeMin: 0.45, sizeMax: 1, opacityMin: 0.3 },
      description: 'Soft, covering round for values and volume',
    },
    {
      id: 'native-concept-chisel', name: 'Chisel', tip: 'square', tipOptions: { inset: 0.02, radius: 0.04 }, tipRotation: 0.08,
      size: 40, opacity: 0.9, hardness: 0.8, spacing: 0.04, smoothing: 0.3,
      pressureCurve: 1.05, speedSize: 0.05, flow: 0.8, roundness: 0.6,
      angleFollow: true,
      dynamics: { sizeMin: 0.45, sizeMax: 1, angleJitter: 0.02, opacityMin: 0.35 },
      description: 'Directional, sharp-edged chisel: architecture and hard surfaces',
    },
    {
      id: 'native-concept-cloud', name: 'Cloud', tip: 'soft', tipOptions: { hardness: 0.1 },
      size: 90, opacity: 0.35, hardness: 0.1, spacing: 0.1, smoothing: 0.35,
      pressureCurve: 1, speedSize: 0.02, flow: 0.25, scatter: 0.6,
      texture: true, textureDepth: 0.2, textureScale: 0.9,
      dynamics: { sizeMin: 0.4, sizeMax: 1, angleJitter: 0.3, scatterJitter: 0.3, opacityMin: 0.05 },
      description: 'Soft cloud masses and atmospheric transitions',
    },
    {
      id: 'native-concept-rock', name: 'Rock Texture', tip: 'noise', tipOptions: { density: 0.5, edge: 0.9 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 60, opacity: 0.6, hardness: 0.3, spacing: 0.12, smoothing: 0.22,
      pressureCurve: 1.2, speedSize: 0.06, flow: 0.35, scatter: 0.5,
      texture: true, textureDepth: 0.55, textureScale: 1.4, textureId: 'sand', angleFollow: true,
      dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.2, scatterJitter: 0.2, opacityMin: 0.1 },
      description: 'Crumbling rock, stone and rough surface texture',
    },
    {
      id: 'native-concept-speedpaint', name: 'Fast Paint', tip: 'rake', tipOptions: { bristles: 9, spread: 0.7 }, stampFlipX: 0.5, tipRotation: 0.15,
      size: 55, opacity: 0.7, hardness: 0.5, spacing: 0.06, smoothing: 0.25,
      pressureCurve: 1.1, speedSize: 0.12, flow: 0.55, angleFollow: true,
      texture: true, textureDepth: 0.3, textureScale: 1.3,
      dynamics: { sizeMin: 0.35, sizeMax: 1, angleJitter: 0.03, opacityMin: 0.2 },
      description: 'Broad, directional paint for fast concept studies',
    },
    {
      id: 'native-concept-lineart', name: 'Lineart', tip: 'circle',
      size: 8, opacity: 1, hardness: 0.95, spacing: 0.025, smoothing: 0.55,
      pressureCurve: 1.15, speedSize: 0.05, flow: 0.95,
      taperStart: 0.04, taperEnd: 0.12,
      dynamics: { sizeMin: 0.25, sizeMax: 1, opacityMin: 0.25 },
      description: 'Controlled line for clean concept lineart',
    },
    {
      id: 'native-concept-value', name: 'Value Block', tip: 'soft', tipOptions: { hardness: 0.2 },
      size: 70, opacity: 0.4, hardness: 0.2, spacing: 0.07, smoothing: 0.45,
      pressureCurve: 1, speedSize: 0.02, flow: 0.18,
      texture: true, textureDepth: 0.15, textureScale: 1.1,
      dynamics: { sizeMin: 0.5, sizeMax: 1, opacityMin: 0.06 },
      description: 'Large value masses and soft shadow blocks',
    },
    {
      id: 'native-concept-rim', name: 'Rim Light', tip: 'soft', tipOptions: { hardness: 0.45 },
      size: 24, opacity: 0.55, hardness: 0.45, spacing: 0.04, smoothing: 0.5,
      pressureCurve: 1.1, speedSize: 0.06, flow: 0.4,
      dynamics: { sizeMin: 0.3, sizeMax: 1, opacityMin: 0.2 },
      description: 'Thin light and rim light on silhouette edges',
    },
  ]),

  /* ---------------- CALLIGRAPHY PACK · kaligrafi ---------------- */
  ...nativeBrushPack('calligraphy', 'Calligraphy', [
    {
      id: 'native-pointed-pen', name: 'Nib Pen', tip: 'oval', tipOptions: { ratio: 0.14 }, stampFlipX: 0.5, tipRotation: 0.6,
      size: 7, opacity: 1, hardness: 1, spacing: 0.022, smoothing: 0.58,
      pressureCurve: 1.3, speedSize: 0.1, flow: 0.95, taperStart: 0.03, taperEnd: 0.25,
      angle: -0.7,
      dynamics: { sizeMin: 0.08, sizeMax: 1, opacityMin: 0.2 },
      description: 'Pointed pen: fine, elegant line that opens with pressure',
    },
    {
      id: 'native-broad-nib', name: 'Broad Nib', tip: 'oval', tipOptions: { ratio: 0.18 }, stampFlipX: 0.5, tipRotation: 0.6,
      size: 24, opacity: 1, hardness: 0.98, spacing: 0.03, smoothing: 0.5,
      pressureCurve: 0.95, speedSize: 0.04, flow: 0.98, taperStart: 0.04, taperEnd: 0.1,
      angle: -Math.PI / 4,
      dynamics: { sizeMin: 0.3, sizeMax: 1, opacityMin: 0.3 },
      description: 'Classic broad nib: thick-thin contrasted gothic letters',
    },
    {
      id: 'native-italic-nib', name: 'Italic Nib', tip: 'oval', tipOptions: { ratio: 0.22 }, stampFlipX: 0.5, tipRotation: 0.6,
      size: 26, opacity: 1, hardness: 0.98, spacing: 0.03, smoothing: 0.55,
      pressureCurve: 1, speedSize: 0.04, flow: 0.98, taperEnd: 0.08,
      angle: -0.5,
      dynamics: { sizeMin: 0.35, sizeMax: 1, opacityMin: 0.32 },
      description: 'Chiseled tip for italic handwriting',
    },
    {
      id: 'native-fraktur-nib', name: 'Fraktur Nib', tip: 'square', tipOptions: { inset: 0.02, radius: 0.02 }, tipRotation: 0.08,
      size: 22, opacity: 1, hardness: 0.98, spacing: 0.025, smoothing: 0.5,
      pressureCurve: 1, speedSize: 0.03, flow: 0.98, roundness: 0.5,
      angle: -0.3,
      dynamics: { sizeMin: 0.35, sizeMax: 1, opacityMin: 0.4 },
      description: 'Broad, angular tip for Fraktur and blackletter',
    },
    {
      id: 'native-copperplate', name: 'Copperplate', tip: 'oval', tipOptions: { ratio: 0.1 }, stampFlipX: 0.5, tipRotation: 0.6,
      size: 5, opacity: 1, hardness: 1, spacing: 0.02, smoothing: 0.6,
      pressureCurve: 1.35, speedSize: 0.08, flow: 0.92, taperStart: 0.05, taperEnd: 0.3,
      angle: -0.65,
      dynamics: { sizeMin: 0.05, sizeMax: 1, opacityMin: 0.16 },
      description: 'Copperplate: fine entries, full press and elegant curves',
    },
    {
      id: 'native-sumi-brush', name: 'Sumi Brush', tip: 'circle',
      size: 26, opacity: 0.95, hardness: 0.85, spacing: 0.03, smoothing: 0.5,
      pressureCurve: 1.1, speedSize: 0.12, flow: 0.85, taperStart: 0.15, taperEnd: 0.4,
      dynamics: { sizeMin: 0.08, sizeMax: 1, opacityMin: 0.14 },
      description: 'Sumi-e brush: bold entry, flowing body, fine exit',
    },
    {
      id: 'native-dry-script', name: 'Dry Lettering Brush', tip: 'rake', tipOptions: { bristles: 12, spread: 0.78 }, stampFlipX: 0.5, tipRotation: 0.15,
      size: 20, opacity: 0.85, hardness: 0.7, spacing: 0.045, smoothing: 0.3,
      pressureCurve: 1.15, speedSize: 0.1, flow: 0.6, flowJitter: 0.2,
      texture: true, textureDepth: 0.3, textureScale: 1.6, angleFollow: true,
      dynamics: { sizeMin: 0.2, sizeMax: 1, angleJitter: 0.04, opacityMin: 0.16 },
      description: 'Dry-brush calligraphy with separated hair marks',
    },
    {
      id: 'native-marker-chisel', name: 'Marker Chisel', tip: 'square', tipOptions: { inset: 0.03, radius: 0.1 }, tipRotation: 0.08,
      size: 18, opacity: 0.9, hardness: 0.85, spacing: 0.03, smoothing: 0.4,
      pressureCurve: 1, speedSize: 0.03, flow: 0.85, roundness: 0.5,
      angle: -0.6,
      dynamics: { sizeMin: 0.5, sizeMax: 1, opacityMin: 0.45 },
      description: 'Chisel-marker: graphic lettering of even thickness',
    },
  ]),

  /* ---------------- TEXTURE FX PACK · doku ve efektler ---------------- */
  ...nativeBrushPack('texture', 'Texture', [
    {
      id: 'native-fx-sponge', name: 'Sponge', tip: 'noise', tipOptions: { density: 0.25, edge: 0.82 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 60, opacity: 0.5, hardness: 0.1, spacing: 0.16, smoothing: 0.2,
      pressureCurve: 1.15, speedSize: 0.05, flow: 0.3, scatter: 1.2,
      scatterCount: 4, scatterCountJitter: 0.6, texture: true, textureDepth: 0.4, textureScale: 1.3,
      dynamics: { sizeMin: 0.2, sizeMax: 1, angleJitter: 0.4, scatterJitter: 0.35, opacityMin: 0.06 },
      description: 'Porous sponge texture and scattered paint stains',
    },
    {
      id: 'native-fx-splatter', name: 'Splatter', tip: 'noise', tipOptions: { density: 0.3, edge: 0.9 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 26, opacity: 0.8, hardness: 0.4, spacing: 0.25, smoothing: 0.15,
      pressureCurve: 1.2, speedSize: 0.05, flow: 0.6, scatter: 1.6,
      scatterCount: 6, scatterCountJitter: 0.9,
      dynamics: { sizeMin: 0.15, sizeMax: 1, angleJitter: 0.8, scatterJitter: 0.5, opacityMin: 0.05 },
      description: 'Organic splashes like paint thrown from the canvas',
    },
    {
      id: 'native-fx-rain', name: 'Rain', tip: 'rake', tipOptions: { bristles: 6, spread: 0.9 }, stampFlipX: 0.5, tipRotation: 0.15,
      size: 40, opacity: 0.5, hardness: 0.6, spacing: 0.18, smoothing: 0.2,
      pressureCurve: 1.1, speedSize: 0.08, flow: 0.4, scatter: 0.4,
      roundness: 0.25, angleFollow: true, texture: true, textureDepth: 0.2, textureScale: 1,
      dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.05, scatterJitter: 0.2, opacityMin: 0.08 },
      description: 'Fine, vertical and sparse rain lines',
    },
    {
      id: 'native-fx-scratches', name: 'Scratches', tip: 'rake', tipOptions: { bristles: 3, spread: 0.95 }, stampFlipX: 0.5, tipRotation: 0.15,
      size: 30, opacity: 0.7, hardness: 0.9, spacing: 0.12, smoothing: 0.18,
      pressureCurve: 1.15, speedSize: 0.06, flow: 0.5, scatter: 0.3,
      roundness: 0.15, angleFollow: true,
      dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.08, scatterJitter: 0.2, opacityMin: 0.1 },
      description: 'Fine scratches on metal and wood surfaces',
    },
    {
      id: 'native-fx-fur', name: 'Feather', tip: 'rake', tipOptions: { bristles: 14, spread: 0.85 }, stampFlipX: 0.5, tipRotation: 0.15,
      size: 30, opacity: 0.7, hardness: 0.5, spacing: 0.05, smoothing: 0.22,
      pressureCurve: 1.2, speedSize: 0.1, flow: 0.5, scatter: 0.25,
      texture: true, textureDepth: 0.35, textureScale: 1.6, angleFollow: true,
      dynamics: { sizeMin: 0.2, sizeMax: 1, angleJitter: 0.05, scatterJitter: 0.15, opacityMin: 0.1 },
      description: 'Directional, dense texture for fur and hair',
    },
    {
      id: 'native-fx-grass', name: 'Grass', tip: 'rake', tipOptions: { bristles: 10, spread: 0.9 }, stampFlipX: 0.5, tipRotation: 0.15,
      size: 34, opacity: 0.75, hardness: 0.6, spacing: 0.06, smoothing: 0.2,
      pressureCurve: 1.15, speedSize: 0.08, flow: 0.55, scatter: 0.5,
      texture: true, textureDepth: 0.25, textureScale: 1.2, angleFollow: true,
      dynamics: { sizeMin: 0.2, sizeMax: 1, angleJitter: 0.12, scatterJitter: 0.25, opacityMin: 0.12 },
      description: 'Grass, bushes and fine plant clusters',
    },
    {
      id: 'native-fx-smoke', name: 'Smoke', tip: 'soft', tipOptions: { hardness: 0.02 },
      size: 100, opacity: 0.25, hardness: 0.02, spacing: 0.1, smoothing: 0.4,
      pressureCurve: 1, speedSize: 0.02, flow: 0.18, scatter: 0.9,
      scatterCount: 3, scatterCountJitter: 0.5, texture: true, textureDepth: 0.15, textureScale: 0.9,
      dynamics: { sizeMin: 0.3, sizeMax: 1, angleJitter: 0.5, scatterJitter: 0.4, opacityMin: 0.03 },
      description: 'Rising, scattering smoke and steam',
    },
    {
      id: 'native-fx-bokeh', name: 'Bokeh', tip: 'soft', tipOptions: { hardness: 0.4 },
      size: 50, opacity: 0.35, hardness: 0.4, spacing: 0.2, smoothing: 0.2,
      pressureCurve: 1.1, speedSize: 0.02, flow: 0.25, scatter: 1.4,
      scatterCount: 3, scatterCountJitter: 0.6,
      dynamics: { sizeMin: 0.25, sizeMax: 1, scatterJitter: 0.4, opacityMin: 0.06 },
      description: 'Soft, round light spots and bokeh',
    },
    {
      id: 'native-fx-grunge', name: 'Grunge', tip: 'noise', tipOptions: { density: 0.45, edge: 0.9 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 70, opacity: 0.5, hardness: 0.2, spacing: 0.2, smoothing: 0.15,
      pressureCurve: 1.15, speedSize: 0.04, flow: 0.25, scatter: 1.2,
      texture: true, textureDepth: 0.7, textureScale: 2.6, textureId: 'canvas',
      dynamics: { sizeMin: 0.25, sizeMax: 1, angleJitter: 0.6, scatterJitter: 0.4, opacityMin: 0.04 },
      description: 'Weathered wall, rust and dirty surface texture',
    },
    {
      id: 'native-fx-stars', name: 'Stars', tip: 'noise', tipOptions: { density: 0.18, edge: 0.8 }, tipVariants: 6, tipSeed: 41, stampFlipX: 0.5, stampFlipY: 0.35, tipRotation: 0.5,
      size: 12, opacity: 0.8, hardness: 0.7, spacing: 0.3, smoothing: 0.1,
      pressureCurve: 1.1, speedSize: 0.02, flow: 0.6, scatter: 1.6,
      scatterCount: 4, scatterCountJitter: 0.8,
      dynamics: { sizeMin: 0.15, sizeMax: 1, angleJitter: 0.9, scatterJitter: 0.5, opacityMin: 0.05 },
      description: 'Small star specks for night skies and glimmer',
    },
  ])
);


if (typeof window !== 'undefined') {
  window.NativeBrushLibrary = NativeBrushLibrary;
  window.NativeBrushCategories = NativeBrushCategories;
}

function inkNativeBrushDefaults() {
  return NativeBrushLibrary.map(brush => {
    const copy = Object.assign({}, brush);
    copy.tipOptions = Object.assign({}, brush.tipOptions || {});
    copy.dynamics = Object.assign({}, brush.dynamics || {});
    return copy;
  });
}

/* =========================================================
   önizleme · S eğrisi
   ========================================================= */
/**
 * Fırça kartlarında kullanılan S eğrisi önizlemesi. Motorun gerçek
 * damla üretimini kullanır; böylece uç, akış ve basınç karakteri
 * kartta da görünür.
 */
/** Kart önizlemesinde kullanılacak mürekkep rengi: tema metin rengi.
    Sabit krem renk, açık temalarda krem kart üzerinde görünmez kalıyordu. */
function inkPreviewInkColor() {
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--text').trim();
    if (value) return value;
  } catch { /* sessiz */ }
  return '#ece6da';
}

/* Tek kaynak anahtar üretici: bake önbelleği, disk katmanı ve
   asenkron boya yardımcısı AYNI anahtarı kullanmak zorunda. */
function inkPreviewBakeKey(target, cssW, cssH, options = {}) {
  const dpr = Math.min(2, Number(options.dpr) || window.devicePixelRatio || 1);
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));
  let sig = '';
  try {
    const raw = JSON.stringify(target);
    let h = 0;
    for (let i = 0; i < raw.length; i += 1) h = (h * 31 + raw.charCodeAt(i)) & 0x7fffffff;
    sig = h;
  } catch { sig = 0; }
  const color = options.color || inkPreviewInkColor();
  return { key: target.id + '|' + pxW + 'x' + pxH + '|' + sig + '|' + color, pxW, pxH, dpr, color, sig };
}

function renderStrokePreview(canvas, brush, options = {}) {
  if (!canvas || !canvas.getContext) return;
  let target = brush || null;
  try {
    if (!target && typeof inkGetBrush === 'function') {
      target = inkGetBrush(inkState().brushId);
    }
  } catch { /* durum henüz hazır değilse sessiz */ }
  if (!target) return;

  const dpr = Math.min(2, Number(options.dpr) || window.devicePixelRatio || 1);
  const cssW = Math.max(1, Number(options.width) || canvas.clientWidth || 280);
  const cssH = Math.max(1, Number(options.height) || canvas.clientHeight || 72);
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== pxW) canvas.width = pxW;
  if (canvas.height !== pxH) canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  /* DÜZELTME (profiler bulgusu): kategori kartları her yeniden kurulumda
     54-noktalık S eğrisini damban damga boyuyordu; 40 kartlık listede
     ~50-60 ms. Fırça imzası değişmediyse biten bitmapi önbellekten
     basar; imza değişirse yeniden boyar. */
  const info = inkPreviewBakeKey(target, cssW, cssH, options);
  const previewColor = info.color;
  const cacheKey = info.key;
  const hit = inkPreviewBakeCache.get(cacheKey);
  if (hit && hit.width === info.pxW && hit.height === info.pxH) {
    ctx.drawImage(hit, 0, 0, cssW, cssH);
    return;
  }
  /* tanı: kaç resim diske rağmen yeniden boyandı (regen) — sondada okunur */
  try {
    window.__previewRegen = (window.__previewRegen || 0) + 1;
    window.__previewRegenFrom = window.__previewRegenFrom || [];
    if (window.__previewRegenFrom.length < 40) {
      window.__previewRegenFrom.push(
        new Error('regen').stack.split('\n').filter(Boolean).slice(1, 4).join(' « '));
    }
  } catch { /* sessiz */ }

  const inset = Math.max(7, cssW * 0.085);
  const amp = Math.max(3, cssH * 0.26);
  const points = [];
  const count = 54;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const angle = t * Math.PI * 2;
    points.push({
      x: inset + t * (cssW - inset * 2),
      // S profili: kartın solundan sağına uzanan tek nefeslik eğri.
      y: cssH * 0.5 + Math.sin(angle) * amp,
      p: 0.2 + 0.8 * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.62),
      s: t,
    });
  }

  const brushSize = Number.isFinite(target.size) ? target.size : 24;
  const previewSize = clamp(
    Number(options.sizePx) || (2 + brushSize * 0.2),
    2,
    cssH * 0.5
  );
  const opacity = clamp(
    Number(options.opacity) ||
      Math.max(0.45, Number.isFinite(target.opacity) ? target.opacity : 1),
    0.08, 1
  );
  // Çok düşük akışlı fırçalar (ıslak üstü ıslak gibi) kart önizlemesinde
  // neredeyse görünmez kalıyordu. Önizleme akışına taban koyuyoruz; bu
  // yalnızca karttaki S eğrisini etkiler, fırçanın kendi ayarını değiştirmez.
  const previewFlow = Math.max(0.22, Number.isFinite(target.flow) ? target.flow : 1);
  const preview = {
    id: 'preview:' + target.id,
    kind: 'stroke',
    tool: 'brush',
    color: previewColor,
    size: 1,
    opacity,
    hardness: Number.isFinite(target.hardness) ? target.hardness : 0.8,
    spacing: Number.isFinite(target.spacing) ? target.spacing : 0.08,
    speedSize: Number.isFinite(target.speedSize) ? target.speedSize : 0,
    flow: previewFlow,
    flowJitter: Number.isFinite(target.flowJitter) ? target.flowJitter : 0,
    taperStart: Number.isFinite(target.taperStart) ? target.taperStart : 0,
    taperEnd: Number.isFinite(target.taperEnd) ? target.taperEnd : 0,
    brushId: target.id,
    scatter: Number.isFinite(target.scatter) ? target.scatter : 0,
    points,
  };
  if (typeof inkDrawStrokeOnContext === 'function') {
    // Yol tabanlı fırçalar ctx.strokeStyle'ı kullanır; kart önizlemesinde
    // tema metin rengini açıkça uygula (varsayılan beyaz kalmasın).
    ctx.strokeStyle = preview.color;
    ctx.fillStyle = preview.color;
    inkDrawStrokeOnContext(ctx, preview, {
      mapPoint: p => ({ x: p.x, y: p.y }),
      sizePx: previewSize,
      brush: target,
    });
  }
  /* Önbelleğe yaz: sonraki kurulumlar drawImage ile basar. */
  try {
    const copy = document.createElement('canvas');
    copy.width = pxW;
    copy.height = pxH;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    inkPreviewBakeCache.set(cacheKey, copy);
    const LIMIT = 320;
    if (inkPreviewBakeCache.size > LIMIT) {
      inkPreviewBakeCache.delete(inkPreviewBakeCache.keys().next().value);
    }
    /* Aynı bitmapi diske kalıcı yaz: sonraki açılışlar yeniden
       boyamadan okur (bkz. aşağıdaki disk katmanı). LAG DÜZELTMESI:
       geçici önizlemeler (disk:false — oluşturucu canlı önizlemesi
       gibi) her ara durumda diske yazılıp IndexedDB'yi dolduruyordu. */
    if (options.disk !== false) inkPreviewDiskQueueWrite(cacheKey, copy);
  } catch { /* önbellek yazılamazsa sessiz */ }
}

/* =========================================================
   AÇILIŞ hızlandırma: boş-zaman kuyruğu
   ---------------------------------------------------------
   Kart önizlemede bake-cache olmasına rağmen ilk açılışta
   önbellek boştur; her kart ~30-50 ms senkron boyama açılışı
   bloklar (startup-probe: presets=1.35 s + kütüphane=0.47 s).
   UI-DOM'u hemen kurarız; kanva boyamalarını boş zamana
   erteleriz. Kullanıcı araya girerse (kütüphane açarsa) o
   güncelleme zaten senkron yeniden kurar; boyamalar UI'ı hiçbir
   zaman engellemez.
   ========================================================= */
const inkNativeIdleQueue = [];
let inkNativeIdleScheduled = false;

function inkNativeIdleDrain(deadline) {
  while (inkNativeIdleQueue.length && (!deadline || deadline.timeRemaining() > 12)) {
    const fn = inkNativeIdleQueue.shift();
    try { fn(); } catch { /* tek iş başarısızsa kuyruğun geri kalanı koşar */ }
  }
  if (inkNativeIdleQueue.length) inkNativeIdleSchedule();
  else inkNativeIdleScheduled = false;
}

function inkNativeIdleSchedule() {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(inkNativeIdleDrain, { timeout: 1000 });
  } else {
    setTimeout(() => inkNativeIdleDrain(null), 40);
  }
}

function inkNativeWhenIdle(fn) {
  inkNativeIdleQueue.push(fn);
  if (!inkNativeIdleScheduled) {
    inkNativeIdleScheduled = true;
    inkNativeIdleSchedule();
  }
}

/** Kart önizleme bitmap önbelleği (renderStrokePreview tüketir). */
const inkPreviewBakeCache = new Map();

/* =========================================================
   DISKE KALICI ÖNİZLEME ÖNBELLEĞİ
   ---------------------------------------------------------
   Bake önbelleği RAM'dedir; her açılışta boş başlar ve 40
   fırçanın kartı yeniden boyanır (boş-zamanda, ama zayıf
   makinelerde yine de harcanan iştir). Windows Gezgini'nin
   thumbcache'i ve tarayıcıların favicon depoları gibi: bir
   kez üret, diske yaz (IndexedDB 'meta', 'nbprev|' öneki),
   sonraki açılışlarda okuyup bellek önbelleğini doldur.

   GÜVENCE: önbellek yalnız TÜRETİLMİŞ görüntüdür, fırça
   verisinin kendisi değildir. Anahtar = fırça özellik
   özeti + piksel boyutu + tema rengi; bunlardan biri
   değişirse disk kaydı eşleşmez ve normal yoldan yeniden
   üretilir. Kayıt bozuksa/eksikse ilk açılıştaki davranış
   (yeniden boyama) hiçbir performansı garantiye almadan
   aynen devam eder.

   BAKIM: kayıt sayısı 400'ü aşarsa en eski %25 kademeyle
   temizlenir (silinen/düzenlenen fırçaların ölü kayıtları
   böylece kendi kendine düşer).
   ========================================================= */
const INK_PREVIEWS_DB_PREFIX = 'nbprev|';
const inkPreviewDiskState = {
  warmed: false, failing: false, written: null, queue: [], busy: false,
  diskBlobs: null, inflight: null, readPromise: null, deferTimer: 0,
};

/* Boya yolları disk okumayı beklerken UI'ı kısıklamak için:
   okuma bitince ya da timeout'ta çözülür (bozuk/eksik veritabanı
   durumu = normal regen yolu). */
function inkPreviewDiskReady(timeoutMs = 400) {
  const s = inkPreviewDiskState;
  if (!s.readPromise || s.warmed) return Promise.resolve(null);
  return Promise.race([
    s.readPromise,
    new Promise(res => setTimeout(res, timeoutMs)),
  ]);
}

/* Açılışta: diskteki 'nbprev|*' kayıtlarını oku, anahtarları
   bilinen/yazılmış olarak işaretle, sonra boş-zamanda teker
   teker decode edip bellek önbelleğini doldur. Decode adımlıdır
   (tick başına bir resim): bellek/enerji ani yüklenmez. */
async function inkPreviewDiskWarm() {
  const s = inkPreviewDiskState;
  if (s.warmed || s.failing) return;
  if (typeof db === 'undefined' || !db || typeof idbEntries !== 'function') { s.failing = true; return; }
  if (!s.readPromise) {
    s.readPromise = new Promise(res => { s.readResolve = res; });
  }
  let entries;
  try {
    entries = await idbEntries('meta');
  } catch {
    s.failing = true;
    try { if (s.readResolve) s.readResolve(null); } catch { /* sessiz */ }
    return;
  }
  let hits = entries.filter(([k, v]) =>
    typeof k === 'string' && k.startsWith(INK_PREVIEWS_DB_PREFIX) &&
    v && (v.png instanceof Blob));
  /* bakım: çöp birikimini sınırla (silinen fırçaların kayıtları) */
  try {
    if (hits.length > 400) {
      const taktir = hits
        .map(h => h)
        .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))
        .slice(0, Math.ceil(hits.length * 0.25));
      for (const [k] of taktir) { try { await idbDel('meta', k); } catch { /* sessiz */ } }
      const silinen = new Set(taktir.map(([k]) => k));
      hits = hits.filter(([k]) => !silinen.has(k));
    }
  } catch { /* bakım başarısızsa sessiz */ }
  /* DB anahtarları 'nbprev|' ÖNEKLİ; bellek önbelleği ve boya yolları
     HAM cacheKey kullanır → öneki burada sıyır. */
  const ham = k => k.slice(INK_PREVIEWS_DB_PREFIX.length);
  s.written = new Set(hits.map(([k]) => ham(k)));
  /* boya yollarının birebir bekleyip decode edebileceği blob haritası */
  s.diskBlobs = new Map(hits.map(([k, v]) => [ham(k), v.png]));
  s.warmed = true;
  try {
    if (window.__bootMark) {
      window.__bootMark('preview-disk:' + hits.length + ' record');
    }
  } catch { /* sessiz */ }
  try { if (s.readResolve) s.readResolve(null); } catch { /* sessiz */ }

  /* Decode sırası önemli: şerit resimleri (72×38) açılışın kritik
     yolu — önce onlar, tek idare. Büyük kartlar sonra, boş zamanla.
     Anahtarın 2. parçası 'PxWxPxH'; ondan şerit tanınır. */
  const kayitBoyutu = key => {
    const m = /^(\d+)x(\d+)$/.exec((key.split('|')[1] || ''));
    return m ? { w: +m[1], h: +m[2] } : { w: 0, h: 0 };
  };
  const minik = [], buyuk = [];
  for (const kayit of hits) {
    const d = kayitBoyutu(ham(kayit[0]));
    (d.w > 0 && d.w <= 160 && d.h <= 80 ? minik : buyuk).push(kayit);
  }
  const sirada = minik.concat(buyuk);
  let idx = 0;
  const decodeBurst = deadline => {
    while (idx < sirada.length && (!deadline || deadline.timeRemaining() > 10)) {
      const [dbKey, val] = sirada[idx++];
      inkPreviewDiskDecodeOne(ham(dbKey), val);
    }
    if (idx < sirada.length) {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(decodeBurst, { timeout: 1500 });
      } else {
        setTimeout(() => decodeBurst(null), 20);
      }
    }
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(decodeBurst, { timeout: 500 });
  } else {
    setTimeout(() => decodeBurst(null), 40);
  }
}

/* Tek kaydı dekode edip bellek önbelleğine koy. Kayıt bozuksa
   düşürülür; sonsuz retry olmadan normal yoldan yeniden üretilir. */
function inkPreviewDiskDecodeOne(key, val) {
  let bmp = null;
  try { bmp = createImageBitmap(val.png); } catch { bmp = null; }
  const yerlestir = bitmap => {
    if (bitmap && bitmap.width > 0 && inkPreviewBakeCache.size <= 260) {
      inkPreviewBakeCache.set(key, bitmap);
    } else if (bitmap) {
      bitmap.close ? bitmap.close() : null;
    }
  };
  if (bmp && typeof bmp.then === 'function') {
    bmp.then(yerlestir).catch(() => {
      try { idbDel('meta', INK_PREVIEWS_DB_PREFIX + key); } catch { /* sessiz */ }
      if (inkPreviewDiskState.written) inkPreviewDiskState.written.delete(key);
    });
  } else {
    yerlestir(null); /* senkron desteklenmiyorsa sessizce geç */
  }
}

/* "decode-inflight": aynı anahtara denk gelen birden fazla boya
   isteği tek decode paylaşır. */
function inkPreviewDecodeStored(key) {
  const s = inkPreviewDiskState;
  if (!s.inflight) s.inflight = new Map();
  if (s.inflight.has(key)) return s.inflight.get(key);
  const blob = s.diskBlobs && s.diskBlobs.get(key);
  if (!blob) return Promise.resolve(null);
  const konus = createImageBitmap(blob).then(bmp => {
    if (!bmp || !(bmp.width > 0)) return null;
    if (inkPreviewBakeCache.size <= 300) inkPreviewBakeCache.set(key, bmp);
    return bmp;
  }).catch(() => {
    try { idbDel('meta', INK_PREVIEWS_DB_PREFIX + key); } catch { /* sessiz */ }
    if (s.written) s.written.delete(key);
    return null;
  });
  s.inflight.set(key, konus);
  konus.finally(() => { try { s.inflight.delete(key); } catch { /* sessiz */ } });
  return konus;
}

/* Asenkron boya yolu: bellek önbelleğine bakar → yoksa diski bekler
   (kısa timeout) → decode edip basar → o da yoksa normal regen yolu.
   UI'ı hiçbir yerde engellemez; boya işi tabii idle'tadır. */
function inkPaintPreviewAsync(canvas, brush, options = {}) {
  const fallback = () => renderStrokePreview(canvas, brush, options);
  if (!canvas || !canvas.getContext || !brush) return fallback();
  const dpr = Math.min(2, Number(options.dpr) || window.devicePixelRatio || 1);
  const cssW = Math.max(1, Number(options.width) || canvas.clientWidth || 280);
  const cssH = Math.max(1, Number(options.height) || canvas.clientHeight || 72);
  const info = inkPreviewBakeKey(brush, cssW, cssH, options);
  const hit = inkPreviewBakeCache.get(info.key);
  if (hit && hit.width === info.pxW && hit.height === info.pxH) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.drawImage(hit, 0, 0, cssW, cssH);
      return;
    }
  }
  return inkPreviewDiskReady(300).then(() => {
    if (!canvas.isConnected) return null;
    return inkPreviewDecodeStored(info.key);
  }).then(bmp => {
    if (!canvas.isConnected) return null;
    if (bmp && bmp.width === info.pxW && bmp.height === info.pxH) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.drawImage(bmp, 0, 0, cssW, cssH);
        return bmp;
      }
    }
    return fallback();
  }).catch(() => { try { if (canvas.isConnected) fallback(); } catch { /* sessiz */ } });
}

/* renderStrokePreview bake'i disk yazım kuyruğuna alır; aynı
   anahtar bir kez yazılır (zaten dispte olan pas geçilir). */
function inkPreviewDiskQueueWrite(cacheKey, canvas) {
  const s = inkPreviewDiskState;
  if (s.failing) return;
  if (s.written && s.written.has(cacheKey)) return; // dispte var, dokunma
  if (s.queue.some(w => w.key === cacheKey)) return;
  s.queue.push({ key: cacheKey, canvas });
  inkPreviewDiskFlush();
}

/* DÜZELTME (profiler bulgusu): toBlob PNG kodlaması ana iş teknikte
   senkron sayılır — sıcak vuruş akışında 94 çağrı / 274 ms örneklendi
   (probe E bölümü). Düzeltmeler: canlı vuruş aktifken hiç kodlama
   yapılmaz; kalem araları boş-zamana (requestIdleCallback) dilimlenir
   ve döngü başına 8 blob bütçe uygulanır — kalan bir sonraki boş çevrede. */
async function inkPreviewDiskFlush() {
  const s = inkPreviewDiskState;
  if (s.busy || s.failing) return;
  if (typeof db === 'undefined' || !db) return; // veritabanı açılmadan yazılmaz
  const cUi = (typeof inkEditorUi !== 'undefined' && inkEditorUi) ? inkEditorUi : null;
  if (cUi && cUi.stroke) {
    /* Canlı vuruş varken PNG kodlama ertelenir; bırakınca boş çevrede. */
    if (!s.deferTimer) {
      s.deferTimer = setTimeout(() => { s.deferTimer = 0; inkPreviewDiskFlush(); }, 300);
    }
    return;
  }
  s.busy = true;
  const idleStep = () => new Promise(resolve => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(resolve, { timeout: 120 });
    } else {
      setTimeout(resolve, 12);
    }
  });
  try {
    let budget = 8;
    while (s.queue.length && budget > 0) {
      const item = s.queue.shift();
      if (s.written && s.written.has(item.key)) continue; // warm arada diski okudu, gereksiz
      if (!(item.canvas && item.canvas.width > 0)) continue;
      /* Kodlamayı boş-zamana bırak: vuruş rasterı önceliği kalsın. */
      await idleStep();
      let blob = null;
      try {
        blob = await new Promise(res => {
          try { item.canvas.toBlob(b => res(b), 'image/png'); }
          catch { res(null); }
        });
      } catch { blob = null; }
      if (!blob) continue;
      try { await idbPut('meta', INK_PREVIEWS_DB_PREFIX + item.key, { png: blob, ts: Date.now() }); }
      catch { s.failing = true; break; }
      if (s.written) s.written.add(item.key);
      budget -= 1;
    }
  } finally {
    s.busy = false;
  }
  /* Bütçe bitti, kuyruk kalan: bir sonraki boş çevreye planla. */
  if (s.queue.length && !s.failing && !s.deferTimer) {
    s.deferTimer = setTimeout(() => { s.deferTimer = 0; inkPreviewDiskFlush(); }, 200);
  }
}

/* DÜZELTME (profiler bulgusu): fırça geçişinde soğuk kategori 40-60 kartın
   önizlemesini ~1.5-3 ms/kart boyuyordu → geçiş ~100 ms boğuluyordu.
   Prewarm: boşta (requestIdleCallback) kart boyutlarında boş kanvalara
   aynı seçeneklerle önizleme boyar; inkPreviewBakeCache dolunca gerçek
   kart kurulumu drawImage ile basar. ~150-250 ms iş arka planda
   dilimlere bölünür; ilk gerçek geçiş sonrası geçişler anlık olur. */
const inkNativePrewarmState = { queue: null, throttle: 0 };

async function inkNativePrewarmStep(deadline) {
  const state = inkNativePrewarmState;
  if (!state.queue) return;
  while (state.queue.length && (!deadline || deadline.timeRemaining() > 8)) {
    const brush = state.queue.pop();
    try {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const compactOps = {
        width: 150, height: 46,
        sizePx: Math.max(2, Math.min(16, (brush.size || 8) * 0.22 + 2)),
      };
      const largeOps = {
        width: 620, height: 78,
        sizePx: Math.max(3, Math.min(24, (brush.size || 8) * 0.32 + 2)),
      };
      /* büyük kart + kompakt kart: kart kurulsumları birebir aynı
         seçenekler olmalı ki önbellek anahtarı vursun (pxW×pxH dahil). */
      const sizler = [
        dpr === 1 ? compactOps : { ...compactOps, dpr },
        dpr === 1 ? largeOps : { ...largeOps, dpr },
        dpr === 1 ? { width: 72, height: 38 } : { width: 72, height: 38, dpr },
      ];
      for (const ops of sizler) {
        const info = inkPreviewBakeKey(brush, ops.width, ops.height, ops);
        const hit = inkPreviewBakeCache.get(info.key);
        if (hit && hit.width === info.pxW && hit.height === info.pxH) continue;
        /* DISK KATMANI AWARE: kayıt diskte varsa decode et — yeniden
           boyamak yerine ucuza ısıt. Kayıt hiç yoksa üret. */
        try { await inkPreviewDiskReady(300); } catch { /* sessiz */ }
        const bmp = await inkPreviewDecodeStored(info.key);
        if (bmp) continue;
        const off = document.createElement('canvas'); // çöp: yalnız önbelleği ısıtır
        renderStrokePreview(off, brush, ops);
      }
    } catch { /* tek fırça başarısızsa kuyruktan çıkar */ }
  }
  if (state.queue.length) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(inkNativePrewarmStep, { timeout: 1200 });
    } else {
      setTimeout(() => inkNativePrewarmStep(null), 40);
    }
  }
}

function inkNativePrewarmStrokePreviews() {
  const now = performance.now();
  if (now - inkNativePrewarmState.throttle < 2500) return; // önceden sırada/ısıtılmış
  inkNativePrewarmState.throttle = now;
  const brushes = (typeof inkState === 'function' ? (inkState().brushes || []) : [])
    .filter(b => b && !/eraser|silgi/i.test(b.id || ''));
  if (!brushes.length) return;
  inkNativePrewarmState.queue = brushes.slice();
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(inkNativePrewarmStep, { timeout: 1200 });
  } else {
    setTimeout(() => inkNativePrewarmStep(null), 60);
  }
}

/* =========================================================
   motor entegrasyonu
   ========================================================= */
function setActiveBrush(brushId, options = {}) {
  if (typeof inkState !== 'function') return null;
  /* Vuruş koruması: canlı vuruşta fırça yuvasına gelen dokunuş vuruşu
     iptal edip fırçayı değiştiriyordu (inkSetTool → inkCancelStroke).
     Kalemle çizerken avuç kütüphaneye değerse vuruş ayakta kalır. */
  if (typeof inkPointer !== 'undefined' && (inkPointer || inkTransform)) return null;
  const ink = inkState();
  let brush = ink.brushes.find(b => b.id === brushId) || null;
  if (!brush && typeof inkGetBrush === 'function') brush = inkGetBrush(brushId);
  if (!brush) return null;

  const tool = options.tool || (brush.tool === 'pencil' ? 'pencil' : 'brush');
  if (typeof inkSetTool === 'function') {
    /* deferUi: defaults uygulanıp sıralar oturduktan sonra setActiveBrush
       TEK bir inkSyncUI çağırır (çifte senkron kaldırıldı). */
    inkSetTool(tool, { brushId: brush.id, deferUi: true });
  } else {
    ink.tool = tool;
    ink.brushId = brush.id;
  }
  ink.brushId = brush.id;

  if (options.applyDefaults !== false) {
    const defaults = {
      size: brush.size,
      opacity: brush.opacity,
      hardness: brush.hardness,
      spacing: brush.spacing,
      /* Kullanıcı tercihi: fırça seçimi yumuşatmayı her zaman %5'e
         getirir. Önceki davranış kütüphane ön ayarındaki değeri
         (%50-58) basıyordu; yüksek yumuşatma çizgiyi gecikmeli
         takip ettirdiği için el hissi yorucuydu. Smoothing, One-Euro
         gecikme parametresidir: 0.05 = anlık takip. */
      smoothing: 0.05,
      pressureCurve: brush.pressureCurve,
      speedSize: brush.speedSize,
      flow: brush.flow,
      flowJitter: brush.flowJitter,
      scatter: brush.scatter,
      taperStart: brush.taperStart,
      taperEnd: brush.taperEnd,
    };
    for (const key of Object.keys(defaults)) {
      const value = defaults[key];
      if (Number.isFinite(value)) ink[key] = value;
    }
  }

  if (typeof inkPreviewBrush === 'function') inkPreviewBrush();
  if (typeof inkSyncUI === 'function') inkSyncUI();
  if (typeof dpSyncToolbar === 'function') dpSyncToolbar();
  if (typeof inkRadialTouch === 'function') inkRadialTouch(brush.id);
  if (typeof scheduleSave === 'function') scheduleSave();
  // Arka planda kart önizlemlerini ısıt: sonraki geçişler anlık olsun.
  if (typeof inkNativePrewarmStrokePreviews === 'function') {
    try { inkNativePrewarmStrokePreviews(); } catch { /* sessiz */ }
  }
  return brush;
}

/* =========================================================
   arayüz · iki sütunlu kütüphane + hızlı fırça şeridi
   ========================================================= */
const inkNativeBrushUi = {
  bound: false,
  activeCategory: 'sketch',
  creatorOnly: false,
  creatorBaseId: '',
  lastFocus: null,
  contextMenu: null,
  dragCategory: '',
  els: {},
  testStrokes: [],
  testRedoStrokes: [],
  testActiveStroke: null,
  testStrokeSeq: 0,
  testResizeObserver: null,
  /* Canlı vuruşun TAM ağırlıklı birikim tamponu (opaklık hariç). */
  testWeights: null,
  testWeightsValid: false,
  uploadedTip: null,
};

async function inkNativeBrushTipFromPng(file) {
  if (!file || (file.type !== 'image/png' && !/\.png$/i.test(file.name || ''))) {
    throw new Error('Only PNG images are supported.');
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('PNG file cannot exceed the 20 MB limit.');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This environment cannot open this PNG image.');
  }

  const image = await createImageBitmap(file);
  try {
    if (!image.width || !image.height) throw new Error('PNG image is empty.');
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('PNG image could not be processed.');
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    const data = pixels.data;
    let hasTransparency = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) {
        hasTransparency = true;
        break;
      }
    }

    let edgeLuminance = 0;
    let edgeCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
        const i = (y * width + x) * 4;
        edgeLuminance += data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        edgeCount++;
      }
    }
    const invertLuminance = !hasTransparency && edgeLuminance / edgeCount >= 127.5;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      const alpha = hasTransparency
        ? data[i + 3]
        : (invertLuminance ? 255 - luminance : luminance);
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(alpha);
    }
    ctx.putImageData(pixels, 0, 0);

    const tipId = 'tip_' + newId();
    inkRuntime.importedTips.set(tipId, canvas.toDataURL('image/png'));
    return {
      tipId,
      width,
      height,
      name: String(file.name || 'PNG brush tip').replace(/\.png$/i, '').slice(0, 40),
    };
  } finally {
    image.close();
  }
}

function inkNativeCustomBrushFromForm() {
  const field = id => document.getElementById('nativeBrushCustom' + id);
  const value = (id, fallback = 0) => {
    const raw = Number(field(id)?.value);
    return Number.isFinite(raw) ? raw : fallback;
  };
  const scatterX = value('ScatterX') / 100;
  const scatterY = value('ScatterY') / 100;
  const textureId = field('Texture')?.value || 'none';
  const dualBrushId = field('DualBrush')?.value || '';
  const dualScale = value('DualScale', 100) / 100;
  const categoryId = document.getElementById('nativeBrushCustomCategory')?.value || 'custom';
  const category = inkNativeCategoryById(categoryId);
  const categoryVisible = category && !category.virtual &&
    !(inkState().deletedCategories || []).includes(categoryId);
  return inkNormalizeBrush({
    id: 'custom-brush-' + newId(),
    name: (document.getElementById('nativeBrushCustomName')?.value || '').trim(),
    kind: inkNativeBrushUi.uploadedTip ? 'abr' : 'procedural',
    tip: document.getElementById('nativeBrushCustomTip')?.value || 'circle',
    tipId: inkNativeBrushUi.uploadedTip ? inkNativeBrushUi.uploadedTip.tipId : '',
    width: inkNativeBrushUi.uploadedTip ? inkNativeBrushUi.uploadedTip.width : undefined,
    height: inkNativeBrushUi.uploadedTip ? inkNativeBrushUi.uploadedTip.height : undefined,
    tipOptions: {},
    category: categoryVisible ? categoryId : 'custom',
    badge: categoryVisible && categoryId !== 'custom' ? category.name : 'Custom',
    description: inkNativeBrushUi.uploadedTip
      ? 'Custom brush tip created from a PNG image'
      : 'Custom brush created by the user',
    size: value('Size', 24),
    opacity: value('Opacity', 100) / 100,
    hardness: value('Hardness', 80) / 100,
    angle: value('Angle') * Math.PI / 180,
    roundness: value('Roundness', 100) / 100,
    spacing: value('Spacing', 8) / 100,
    flow: value('Flow', 100) / 100,
    flowJitter: value('FlowJitter') / 100,
    scatter: 0,
    scatterX,
    scatterY,
    scatterCount: value('Count', 1),
    scatterCountJitter: value('CountJitter') / 100,
    smoothing: value('Smoothing', 45) / 100,
    taperStart: value('TaperStart') / 100,
    taperEnd: value('TaperEnd') / 100,
    tipVariants: Math.round(clamp(value('TipVariants', 1), 1, 8)),
    tipSeed: Math.round(value('TipSeed', 0)),
    stampFlipX: value('FlipX', 0) / 100,
    stampFlipY: value('FlipY', 0) / 100,
    tipRotation: value('TipRotation', 0) / 100,
    texture: textureId !== 'none',
    textureId,
    textureDepth: value('TextureDepth', 26) / 100,
    textureScale: value('TextureScale', 100) / 100,
    textureBrightness: value('TextureBrightness') / 100,
    textureContrast: value('TextureContrast', 100) / 100,
    textureEachTip: !!field('TextureEachTip')?.checked,
    noise: value('Noise') / 100,
    wetEdges: value('WetEdges') / 100,
    airbrush: !!field('Airbrush')?.checked,
    dual: dualBrushId ? {
      brushId: dualBrushId,
      diameter: Math.max(1, value('Size', 24) * dualScale),
      scale: dualScale,
      spacing: value('DualSpacing', 100) / 100,
      scatter: value('DualScatter') / 100,
      blend: field('DualBlend')?.value || 'source-over',
      hardness: 0.6,
      roundness: 1,
      angle: 0,
      flow: 0.72,
    } : null,
    colorDynamics: {
      background: field('Background')?.value || '#ffffff',
      foregroundBackground: value('ColorMix') / 100,
      hueJitter: value('HueJitter') / 100,
      saturationJitter: value('SaturationJitter') / 100,
      brightnessJitter: value('BrightnessJitter') / 100,
      purity: value('Purity') / 100,
    },
    dynamics: {
      sizeMin: value('SizeMin') / 100,
      sizeMax: value('SizeMax', 100) / 100,
      src: field('SizeSource')?.value || 'pressure',
      sizeJitter: value('SizeJitter') / 100,
      angleJitter: value('AngleJitter') / 100,
      roundnessMin: value('RoundnessMin', 100) / 100,
      roundnessJitter: value('RoundnessJitter') / 100,
      scatterJitter: value('ScatterJitter') / 100,
      spacingJitter: value('SpacingJitter') / 100,
      opacityMin: value('OpacityMin') / 100,
      opacityJitter: value('OpacityJitter') / 100,
      opacitySrc: field('OpacitySource')?.value || 'pressure',
    },
  });
}

/* Seçilen fırçanın ayarlarını oluşturucu formuna taşır. Yalnızca form
   alanları doldurulur; kaynak fırça nesnesi asla değiştirilmez. Böylece
   hazır fırçalar "base" olarak kullanılıp üzerine yeni bir özel fırça
   oluşturulabilir. */
function inkNativeLoadBrushIntoCreator(brush) {
  if (!brush || typeof brush !== 'object') return false;
  const field = id => document.getElementById('nativeBrushCustom' + id);
  const num = (value, fallback) => Number.isFinite(Number(value))
    ? Number(value) : fallback;
  const setRange = (id, value, fallback) => {
    const el = field(id);
    if (!el) return;
    el.value = String(Math.round(num(value, fallback)));
  };
  const setSelect = (id, value, fallback) => {
    const el = field(id);
    if (!el) return;
    const next = value == null ? '' : String(value);
    el.value = Array.from(el.options || []).some(option => option.value === next)
      ? next : (fallback == null ? '' : String(fallback));
  };
  const setCheck = (id, value) => {
    const el = field(id);
    if (el) el.checked = !!value;
  };

  const dyn = brush.dynamics || {};
  const color = brush.colorDynamics || {};
  const dual = brush.dual || null;
  const name = document.getElementById('nativeBrushCustomName');
  if (name) name.value = (brush.name || 'Brush') + ' Copy';

  inkNativeSyncCreatorCategoryOptions(brush.category);
  const categorySelect = document.getElementById('nativeBrushCustomCategory');
  if (categorySelect && brush.category &&
      Array.from(categorySelect.options || []).some(option => option.value === brush.category)) {
    categorySelect.value = brush.category;
  }

  setSelect('Tip', brush.tip || 'circle', 'circle');
  setRange('Size', num(brush.size, 24), 24);
  setRange('Hardness', num(brush.hardness, 0.6) * 100, 60);
  setRange('Angle', num(brush.angle, 0) * 180 / Math.PI, 0);
  setRange('Roundness', num(brush.roundness, 1) * 100, 100);
  setRange('Spacing', num(brush.spacing, 0.1) * 100, 10);
  setRange('SpacingJitter', num(dyn.spacingJitter, 0) * 100, 0);
  setRange('Opacity', num(brush.opacity, 1) * 100, 100);
  setRange('Flow', num(brush.flow, 1) * 100, 100);
  setRange('FlowJitter', num(brush.flowJitter, 0) * 100, 0);
  setRange('TipVariants', num(brush.tipVariants, 1), 1);
  setRange('TipSeed', num(brush.tipSeed, 0), 0);
  setRange('FlipX', num(brush.stampFlipX, 0) * 100, 0);
  setRange('FlipY', num(brush.stampFlipY, 0) * 100, 0);
  setRange('TipRotation', num(brush.tipRotation, 0) * 100, 0);

  setSelect('SizeSource', dyn.src || 'pressure', 'pressure');
  setRange('SizeMin', num(dyn.sizeMin, 0.18) * 100, 18);
  setRange('SizeMax', num(dyn.sizeMax, 1) * 100, 100);
  setRange('SizeJitter', num(dyn.sizeJitter, 0) * 100, 0);
  setRange('AngleJitter', num(dyn.angleJitter, 0) * 100, 0);
  setRange('RoundnessMin', num(dyn.roundnessMin, 1) * 100, 100);
  setRange('RoundnessJitter', num(dyn.roundnessJitter, 0) * 100, 0);

  setRange('ScatterX', num(brush.scatterX, 0) * 100, 0);
  setRange('ScatterY', num(brush.scatterY, 0) * 100, 0);
  setRange('ScatterJitter', num(dyn.scatterJitter, 0) * 100, 0);
  setRange('Count', num(brush.scatterCount, 1), 1);
  setRange('CountJitter', num(brush.scatterCountJitter, 0) * 100, 0);

  setSelect('Texture', brush.textureId || (brush.texture ? 'paper' : 'none'), 'none');
  setRange('TextureScale', num(brush.textureScale, 1) * 100, 100);
  setRange('TextureDepth', num(brush.textureDepth, 0.26) * 100, 26);
  setRange('TextureBrightness', num(brush.textureBrightness, 0) * 100, 0);
  setRange('TextureContrast', num(brush.textureContrast, 1) * 100, 100);
  setCheck('TextureEachTip', brush.textureEachTip);

  setSelect('DualBrush', dual && dual.brushId ? dual.brushId : '', '');
  setSelect('DualBlend', dual && dual.blend ? dual.blend : 'source-over', 'source-over');
  setRange('DualScale', num(dual && dual.scale, 1) * 100, 100);
  setRange('DualSpacing', num(dual && dual.spacing, 1) * 100, 100);
  setRange('DualScatter', num(dual && dual.scatter, 0) * 100, 0);

  const background = field('Background');
  if (background) {
    background.value = /^#[0-9a-f]{6}$/i.test(color.background || '')
      ? color.background : '#ffffff';
  }
  setRange('ColorMix', num(color.foregroundBackground, 0) * 100, 0);
  setRange('HueJitter', num(color.hueJitter, 0) * 100, 0);
  setRange('SaturationJitter', num(color.saturationJitter, 0) * 100, 0);
  setRange('BrightnessJitter', num(color.brightnessJitter, 0) * 100, 0);
  setRange('Purity', num(color.purity, 0) * 100, 0);

  setSelect('OpacitySource', dyn.opacitySrc || 'pressure', 'pressure');
  setRange('OpacityMin', num(dyn.opacityMin, 0.35) * 100, 35);
  setRange('OpacityJitter', num(dyn.opacityJitter, 0) * 100, 0);
  setRange('Noise', num(brush.noise, 0) * 100, 0);
  setRange('WetEdges', num(brush.wetEdges, 0) * 100, 0);
  setCheck('Airbrush', brush.airbrush);
  setRange('Smoothing', num(brush.smoothing, 0.45) * 100, 45);
  setRange('TaperStart', num(brush.taperStart, 0) * 100, 0);
  setRange('TaperEnd', num(brush.taperEnd, 0) * 100, 0);

  // İçe aktarılmış uç varsa formun PNG ucu olarak taşınır; orijinal
  // fırçanın tipId'si paylaşılır, silinmez/değiştirilmez.
  const hasTip = brush.kind === 'abr' && brush.tipId &&
    typeof inkRuntime !== 'undefined' && inkRuntime.importedTips.has(brush.tipId);
  inkNativeBrushUi.uploadedTip = hasTip ? {
    tipId: brush.tipId,
    width: brush.width || 0,
    height: brush.height || 0,
    name: (brush.name || 'Brush') + ' ucu',
  } : null;
  if (hasTip) inkLoadAbrTip(brush.tipId);
  const status = document.getElementById('nativeBrushCustomPngStatus');
  if (status) {
    status.textContent = hasTip
      ? (brush.name || 'Brush') + ' tip taken as the base. Change the name and settings before saving.'
      : 'Transparent PNG recommended; a white background is converted to a mask automatically.';
  }
  inkNativeSyncCustomCreator();
  return true;
}

/* Aynı ayarlarla ikinci bir özel fırça oluşmasını engeller. "Create"
   butonuna basılı tutulan Enter/Space ya da üst üste tıklama, listede
   görünmeyen kopyalar biriktiriyordu (206 adet "Yeni Fırça" bu yüzden).
   `id` dışındaki tüm alanlar aynıysa yeni kayıt eklenmez, mevcut seçilir. */
function inkNativeBrushSignature(brush) {
  return inkBrushSignature(brush);
}

function inkNativeFindSameCustomBrush(brushes, brush) {
  const signature = inkNativeBrushSignature(brush);
  if (!signature) return null;
  return (Array.isArray(brushes) ? brushes : []).find(item =>
    item && !inkNativeIsDefaultBrush(item) &&
    inkNativeBrushSignature(item) === signature) || null;
}

function inkNativeCreatorTestEnsureSize() {
  const { testCanvas, testLive } = inkNativeBrushUi.els;
  if (!testCanvas || !testLive) return null;
  const rect = testCanvas.getBoundingClientRect();
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  if (!width || !height) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  const resized = testCanvas.width !== pixelWidth || testCanvas.height !== pixelHeight ||
    testLive.width !== pixelWidth || testLive.height !== pixelHeight;
  if (resized) {
    testCanvas.width = testLive.width = pixelWidth;
    testCanvas.height = testLive.height = pixelHeight;
    /* Boyut değişince ağırlık tamponu yeniden kurulmalı. */
    inkNativeBrushUi.testWeightsValid = false;
  }
  return { width, height, dpr, pixelWidth, pixelHeight, resized };
}

/* Vuruş CİHAZ PİKSELİ uzayında, kimlik dönüşümüyle çizilir. Çift tampon
   (dual scratch) kutusunu transform'dan bağımsız piksel hesabıyla kurar;
   DPR'li transform + CSS koordinatı birleşimi kutuyu kırpıyor, bırakınca
   vuruşun bir kısmı eksik/kaydırılmış görünüyordu (canlı ≠ final). */
function inkNativeCreatorTestDrawStroke(ctx, entry, size, extra) {
  if (!ctx || !entry || !entry.stroke || !entry.brush) return 0;
  const brush = entry.brush;
  const pw = size.pixelWidth;
  const ph = size.pixelHeight;
  const opts = Object.assign({
    mapPoint: point => ({ x: point.x * pw, y: point.y * ph }),
    /* Fırça çapı CSS px → cihaz px (önceden DPR transform'u yapıyordu). */
    sizePx: brush.size * size.dpr,
    pointScale: { x: pw, y: ph },
    brush,
  }, extra || {});
  return inkDrawStrokeOnContext(ctx, entry.stroke, opts) | 0;
}

/* Canlı katmanın ağırlık tamponu: damlalar TAM ağırlıkla (opaklık hariç)
   birikir. Canlı görüntü = tampon × stroke.opacity; commit de tek geçişte
   aynı kompoziti üretir → çizerken görünen ile bırakınca çıkan birebir. */
function inkNativeCreatorTestWeights(size) {
  let canvas = inkNativeBrushUi.testWeights;
  if (!canvas) {
    canvas = document.createElement('canvas');
    inkNativeBrushUi.testWeights = canvas;
    inkNativeBrushUi.testWeightsValid = false;
  }
  if (canvas.width !== size.pixelWidth || canvas.height !== size.pixelHeight) {
    canvas.width = size.pixelWidth;
    canvas.height = size.pixelHeight;
    inkNativeBrushUi.testWeightsValid = false;
  }
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  /* Çift tampon (commit) yolu damga örneklemesini 'high' kalitede yapar;
     canlı birikim de aynı kaliteyi kullanmalı (piksel paritesi). */
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function inkNativeCreatorTestResetWeights(size) {
  const w = inkNativeCreatorTestWeights(size);
  if (!w) return null;
  w.ctx.globalCompositeOperation = 'source-over';
  w.ctx.clearRect(0, 0, size.pixelWidth, size.pixelHeight);
  inkNativeBrushUi.testWeightsValid = true;
  return w;
}

function inkNativeCreatorTestCompositeLive(entry, size) {
  const live = inkNativeBrushUi.els.testLive;
  const weights = inkNativeBrushUi.testWeights;
  if (!live || !weights || !entry) return;
  const ctx = live.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size.pixelWidth, size.pixelHeight);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = clamp(
    entry.stroke.opacity === undefined ? 1 : entry.stroke.opacity, 0, 1);
  ctx.drawImage(weights, 0, 0);
  ctx.globalAlpha = 1;
}

function inkNativeCreatorTestSyncButtons() {
  const undo = inkNativeBrushUi.els.testUndo;
  if (undo) undo.disabled = !inkNativeBrushUi.testStrokes.length;
}

function inkNativeCreatorTestRender() {
  const size = inkNativeCreatorTestEnsureSize();
  if (!size) return;
  const { testCanvas, testLive } = inkNativeBrushUi.els;
  const ctx = testCanvas.getContext('2d', { colorSpace: 'srgb' });
  const liveCtx = testLive.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx || !liveCtx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size.pixelWidth, size.pixelHeight);
  for (const entry of inkNativeBrushUi.testStrokes) {
    inkNativeCreatorTestDrawStroke(ctx, entry, size);
  }
  liveCtx.setTransform(1, 0, 0, 1, 0, 0);
  liveCtx.clearRect(0, 0, size.pixelWidth, size.pixelHeight);
  const active = inkNativeBrushUi.testActiveStroke;
  if (active) {
    if (active.pathMode) {
      inkNativeCreatorTestDrawStroke(liveCtx, active, size);
    } else {
      /* Boyut değiştiyse tampon geçersizdir: vuruşu yeniden biriktir.
         stableOnly: sayaç sözleşmesi artımlı çizerken ile aynı kalsın
         (uçtaki 2 segment ertelenir; bırakışta tam çizim yapılır). */
      if (!inkNativeBrushUi.testWeightsValid) {
        const w = inkNativeCreatorTestResetWeights(size);
        if (w) {
          active.drawnDabs = inkNativeCreatorTestDrawStroke(w.ctx, active, size, {
            skipDabs: 0, dualDirect: true, stableOnly: true,
          });
        }
      }
      inkNativeCreatorTestCompositeLive(active, size);
    }
  }
  inkNativeCreatorTestSyncButtons();
}

function inkNativeCreatorTestAddPoint(event, force = false) {
  const entry = inkNativeBrushUi.testActiveStroke;
  const canvas = inkNativeBrushUi.els.testCanvas;
  if (!entry || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const rawX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const rawY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  const points = entry.stroke.points;
  const previous = points[points.length - 1];
  if (previous && !force && Math.hypot(rawX - previous.x, rawY - previous.y) < 0.001) return;
  const brush = entry.brush;
  const smoothing = clamp(brush.smoothing || 0, 0, 0.95) * 0.7;
  const x = previous ? previous.x + (rawX - previous.x) * (1 - smoothing) : rawX;
  const y = previous ? previous.y + (rawY - previous.y) * (1 - smoothing) : rawY;
  const elapsed = previous ? Math.max(1, event.timeStamp - (previous.time || event.timeStamp)) : 1;
  const distance = previous
    ? Math.hypot((x - previous.x) * rect.width, (y - previous.y) * rect.height)
    : 0;
  const rawPressure = event.pointerType === 'pen' && event.pressure > 0
    ? event.pressure : 0.65;
  const pressureCurve = Number.isFinite(brush.pressureCurve) ? brush.pressureCurve : 1;
  points.push({
    x,
    y,
    /* Profil (aday 5): test tuvali de ana çizimle aynı basınç haritasını
       izler (inkCurvePressure = fırça eğrisi × tablet profili). */
    p: inkCurvePressure(rawPressure, pressureCurve),
    s: Math.min(1, distance / (elapsed * 0.8)),
    time: event.timeStamp,
  });
}

function inkNativeCreatorTestUndo() {
  if (!inkNativeBrushUi.testStrokes.length) return false;
  inkNativeBrushUi.testRedoStrokes.push(inkNativeBrushUi.testStrokes.pop());
  inkNativeCreatorTestRender();
  inkNativeCreatorTestSyncButtons();
  return true;
}

function inkNativeCreatorTestRedo() {
  if (!inkNativeBrushUi.testRedoStrokes.length) return false;
  inkNativeBrushUi.testStrokes.push(inkNativeBrushUi.testRedoStrokes.pop());
  inkNativeCreatorTestRender();
  inkNativeCreatorTestSyncButtons();
  return true;
}

function inkNativeCreatorIsTextEntry(node) {
  if (!node) return false;
  if (node.isContentEditable) return true;
  if (node.tagName === 'TEXTAREA') return true;
  if (node.tagName === 'INPUT') {
    const type = String(node.type || 'text').toLowerCase();
    return !/^(range|checkbox|radio|button|submit|reset|color|file)$/.test(type);
  }
  return false;
}

function inkNativeCreatorTestBind() {
  const canvas = inkNativeBrushUi.els.testCanvas;
  const color = inkNativeBrushUi.els.testColor;
  const clear = inkNativeBrushUi.els.testClear;
  const undo = inkNativeBrushUi.els.testUndo;
  if (!canvas || canvas.dataset.bound === 'true') return;
  canvas.dataset.bound = 'true';
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || inkNativeBrushUi.testActiveStroke) return;
    event.preventDefault();
    canvas.focus();
    /* LAG DÜZELTMESİ: kayıtlı vuruşları AKTİF vuruş yokken tazele;
       aktif vuruş canlı katmanda yaşayacak (aşağıda). */
    inkNativeCreatorTestRender();
    const brush = inkNativeCustomBrushFromForm();
    inkNativeBrushUi.testActiveStroke = {
      brush,
      drawnDabs: 0,
      stroke: {
        id: 'brush-test-' + (++inkNativeBrushUi.testStrokeSeq),
        kind: 'stroke',
        tool: 'brush',
        color: color ? color.value : '#d4a24a',
        size: 1,
        opacity: brush.opacity,
        hardness: brush.hardness,
        spacing: brush.spacing,
        speedSize: brush.speedSize,
        flow: brush.flow,
        flowJitter: brush.flowJitter,
        scatter: brush.scatter,
        taperStart: brush.taperStart,
        taperEnd: brush.taperEnd,
        brushId: brush.id,
        points: [],
      },
    };
    inkNativeCreatorTestAddPoint(event, true);
    try { canvas.setPointerCapture(event.pointerId); } catch { /* sentetik olay */ }
    /* İlk dabları TAM ağırlıkla birikim tamponuna yaz; canlı katman
       tamponun opaklıkla tek geçişli kompozitidir (commit ile aynı). */
    const startSize = inkNativeCreatorTestEnsureSize();
    if (!startSize) return;
    const weights = inkNativeCreatorTestResetWeights(startSize);
    if (!weights) return;
    const entry = inkNativeBrushUi.testActiveStroke;
    /* stableOnly: canlı çizerken uçtaki 2 segment ve bitiş incelmesi
       ertelenir (editörün referans modeli). Böylece büyüyen vuruşta
       erken damlalara yanlış taper uygulanmaz; bırakışta kuyruk aynı
       birikime eklenir → canlı kompozit = tek geçişli commit. */
    entry.drawnDabs = inkNativeCreatorTestDrawStroke(weights.ctx, entry, startSize, {
      skipDabs: 0,
      dualDirect: true,
      stableOnly: true,
    });
    inkNativeCreatorTestCompositeLive(entry, startSize);
  });
  canvas.addEventListener('pointermove', event => {
    if (!inkNativeBrushUi.testActiveStroke) return;
    event.preventDefault();
    const coalesced = typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents() : [];
    const samples = coalesced.length ? coalesced : [event];
    for (const sample of samples) inkNativeCreatorTestAddPoint(sample);
    /* LAG DÜZELTMESİ: her pointermove TÜM kayıtlı vuruşları + aktif
       vuruşu sıfırdan boyuyordu (uzun vuruşta O(n²)). Kayıtlı kanvas
       canlı vuruş sırasında DEĞİŞMEZ — dokunulmaz. Canlı katmanda
       yalnız YENİ dablar çizilir (inkDrawStrokeOnContext skipDabs
       sözleşmesi, dönüş = işlenen dab sayısı). Yol-modu (sert/sabit
       basınç) fırçada skipDabs işlemez → o modda canlı temizlenip
       tam çizim yapılır; mod yükseltmesi (dab→yol) güvenlidir. */
    const size = inkNativeCreatorTestEnsureSize();
    if (!size) return;
    const liveCtx = inkNativeBrushUi.els.testLive.getContext('2d', { colorSpace: 'srgb' });
    if (!liveCtx) return;
    const entry = inkNativeBrushUi.testActiveStroke;
    liveCtx.setTransform(1, 0, 0, 1, 0, 0);
    const eligible = !entry.pathMode &&
      typeof inkStrokePathEligible === 'function' &&
      inkStrokePathEligible(entry.stroke, entry.brush, entry.brush.size * size.dpr);
    if (eligible) {
      entry.pathMode = true;
      /* Yol modu damla birikimi kullanmaz: canlı katman tam çizilir. */
      const w = inkNativeCreatorTestWeights(size);
      if (w) w.ctx.clearRect(0, 0, size.pixelWidth, size.pixelHeight);
      inkNativeBrushUi.testWeightsValid = false;
      liveCtx.clearRect(0, 0, size.pixelWidth, size.pixelHeight);
      inkNativeCreatorTestDrawStroke(liveCtx, entry, size);
    } else if (entry.pathMode) {
      /* Yol moduna yükselmiş vuruş dab moduna DÖNMEZ; tam çizim
         (içeride artık dab yolu kullanılsa da) eski davranış kadar
         doğrudur, bozulma olmaz. */
      liveCtx.clearRect(0, 0, size.pixelWidth, size.pixelHeight);
      inkNativeCreatorTestDrawStroke(liveCtx, entry, size);
    } else {
      const weights = inkNativeCreatorTestWeights(size);
      if (!weights) return;
      if (!inkNativeBrushUi.testWeightsValid) {
        /* Boyut değişti: birikimi sıfırdan kur. stableOnly burada da
           açık olmalı; yoksa büyümekte olan vuruşun sonuna erken taper
           uygulanır ve tampon ile commit uyuşmaz. */
        weights.ctx.clearRect(0, 0, size.pixelWidth, size.pixelHeight);
        inkNativeBrushUi.testWeightsValid = true;
        entry.drawnDabs = inkNativeCreatorTestDrawStroke(weights.ctx, entry, size, {
          skipDabs: 0, dualDirect: true, stableOnly: true,
        });
      } else {
        const drawn = inkNativeCreatorTestDrawStroke(weights.ctx, entry, size, {
          skipDabs: entry.drawnDabs | 0, dualDirect: true, stableOnly: true,
        });
        /* dab sayısı monoton büyür; beklenmedik düşüşte sayacı koru. */
        entry.drawnDabs = Math.max(entry.drawnDabs | 0, drawn);
      }
      inkNativeCreatorTestCompositeLive(entry, size);
    }
  });
  const finish = event => {
    const entry = inkNativeBrushUi.testActiveStroke;
    if (!entry) return;
    if (event && Number.isFinite(event.clientX)) inkNativeCreatorTestAddPoint(event, true);
    /* LAG DÜZELTMESİ: bırakışta TAM yeniden boyama yerine vuruşu
       kayıtlı kanvasa BİR kez boya (vuruş rasterı vuruş kimliğine
       göre deterministik — tam render ile birebir). Canlı temizlenir. */
    const size = inkNativeCreatorTestEnsureSize();
    if (size && entry.stroke.points.length > 1) {
      const ctx = inkNativeBrushUi.els.testCanvas.getContext('2d', { colorSpace: 'srgb' });
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        /* Tek geçişli tam çizim = canlı kompozitin aynısı (parite). */
        inkNativeCreatorTestDrawStroke(ctx, entry, size);
      }
    }
    const liveCtx = inkNativeBrushUi.els.testLive.getContext('2d', { colorSpace: 'srgb' });
    if (liveCtx && size) {
      liveCtx.setTransform(1, 0, 0, 1, 0, 0);
      liveCtx.clearRect(0, 0, size.pixelWidth, size.pixelHeight);
    }
    if (size) {
      const w = inkNativeCreatorTestWeights(size);
      if (w) {
        w.ctx.clearRect(0, 0, size.pixelWidth, size.pixelHeight);
        inkNativeBrushUi.testWeightsValid = false;
      }
    }
    if (entry.stroke.points.length > 1) {
      inkNativeBrushUi.testStrokes.push(entry);
      inkNativeBrushUi.testRedoStrokes.length = 0;
    }
    inkNativeBrushUi.testActiveStroke = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* capture bırakılmış olabilir */ }
    inkNativeCreatorTestSyncButtons();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => {
    inkNativeBrushUi.testActiveStroke = null;
    inkNativeBrushUi.testWeightsValid = false;
    inkNativeCreatorTestRender();
  });
  clear?.addEventListener('click', () => {
    inkNativeBrushUi.testStrokes.length = 0;
    inkNativeBrushUi.testRedoStrokes.length = 0;
    inkNativeBrushUi.testActiveStroke = null;
    inkNativeBrushUi.testWeightsValid = false;
    inkNativeCreatorTestRender();
    inkNativeCreatorTestSyncButtons();
  });
  undo?.addEventListener('click', () => {
    inkNativeCreatorTestUndo();
    canvas.focus();
  });
  // Ctrl/Cmd+Z, tuval odakta olmasa da (ör. bir kaydırıcıyken) test
  // çizimlerini geri alır. Metin alanlarında yerel geri almayı bozmayız.
  window.addEventListener('keydown', event => {
    const root = inkNativeBrushUi.els.root;
    if (!root || root.hidden) return;
    const target = event.target instanceof Element ? event.target : null;
    const focused = document.activeElement instanceof Element ? document.activeElement : null;
    const inCreator = node => !!(node && node.closest && node.closest('.nbCreator'));
    if (!inkNativeBrushUi.creatorOnly && !inCreator(target) && !inCreator(focused)) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = String(event.key || '').toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    if (inkNativeCreatorIsTextEntry(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === 'y' || event.shiftKey) inkNativeCreatorTestRedo();
    else inkNativeCreatorTestUndo();
  }, true);
  if (typeof ResizeObserver === 'function') {
    inkNativeBrushUi.testResizeObserver = new ResizeObserver(inkNativeCreatorTestRender);
    inkNativeBrushUi.testResizeObserver.observe(canvas.parentElement);
  }
}

function inkNativeSyncCreatorCategoryOptions(preferred) {
  const select = document.getElementById('nativeBrushCustomCategory');
  if (!select) return;
  const categories = inkNativeAssignableCategories();
  const signature = categories.map(category => category.id + '\u0000' + category.name).join('|');
  const wanted = preferred || select.value;
  if (select.dataset.signature !== signature) {
    select.replaceChildren();
    for (const category of categories) {
      select.add(new Option(category.name, category.id));
    }
    select.dataset.signature = signature;
  }
  if (wanted && categories.some(category => category.id === wanted)) {
    select.value = wanted;
  } else if (categories.some(category => category.id === 'custom')) {
    select.value = 'custom';
  } else if (categories.length) {
    select.value = categories[0].id;
  }
}

function inkNativeSyncCustomCreator() {
  const brush = inkNativeCustomBrushFromForm();
  inkNativeSyncCreatorCategoryOptions();
  const preview = inkNativeBrushUi.els.creatorPreview;
  if (preview) {
    /* Oluşturucu paneli gizliyse boyamayı atla (darbokaz düzeltmesi);
       panel açıldığında inkPreviewFlushStale → refreshPreviews zinciri
       inkNativeSyncCustomCreator'i yeniden çağırıp görünürken boyar. */
    if (inkPreviewCanvasVisible(preview)) {
      /* LAG DÜZELTMESI: form okunuşu HER ÇAĞRIDA rastgele id üretiyordu
         ('custom-brush-' + newId()) — bake önbellek anahtarı tüm fırça
         JSON'unun hash'i + id içerdiğinden önbellek asla tutmuyor, her
         slider tığı tam pişirme + diske PNG kuyruğu demekti (ölçüm:
         20 adımlık sürükleme = 21 regen, disk kuyruğu 123). Önizlemede
         KARARLI kimlik kullan: aynı parametreler = aynı anahtar = cache
         vuruşu. name/description boyamada etkisiz — onlar da sabit. */
      const previewBrush = Object.assign({}, brush, {
        id: 'custom-brush-preview',
        name: '',
        description: '',
      });
      renderStrokePreview(preview, previewBrush, {
        width: 440, height: 120, sizePx: 42, disk: false,
      });
    } else {
      inkNativeBrushUi.previewDirty = true;
    }
  }
  const selected = inkGetBrush(inkState().brushId);
  const remove = inkNativeBrushUi.els.creatorDelete;
  if (remove) remove.disabled = !selected || inkNativeIsDefaultBrush(selected);
  const tipSelect = document.getElementById('nativeBrushCustomTip');
  if (tipSelect) tipSelect.disabled = !!inkNativeBrushUi.uploadedTip;
  const clearTip = document.getElementById('nativeBrushCustomPngClear');
  if (clearTip) clearTip.hidden = !inkNativeBrushUi.uploadedTip;
  for (const input of document.querySelectorAll('#nativeBrushCustomControls input[type="range"]')) {
    const id = input.id.replace(/^nativeBrushCustom/, '');
    const output = document.getElementById(input.id + 'Val');
    if (!input || !output) continue;
    output.textContent = id === 'Size' ? input.value + ' px' :
      id === 'Angle' ? input.value + '°' :
        id === 'Count' || id === 'TipVariants' || id === 'TipSeed' ? input.value :
          id === 'TextureBrightness' ? (Number(input.value) > 0 ? '+' : '') + input.value + '%' :
            input.value + '%';
  }
}

function inkNativeNormalizeCategoryRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!id || !name) return null;
  if (id === 'favorites' || NativeBrushCategories.some(cat => cat.id === id)) return null;
  let title = String(raw.title || '').trim();
  if (!title) title = name.toLocaleUpperCase('tr-TR');
  const hint = String(raw.hint || '').trim() || (name + ' brushes in category');
  return { id, name, title, hint, custom: true };
}

function inkNativeAllCategories() {
  const list = [NativeBrushVirtualCategories[0], ...NativeBrushCategories];
  const seen = new Set(list.map(cat => cat.id));
  for (const category of inkNativeLibrary.customCategories) {
    if (!category || !category.id || seen.has(category.id)) continue;
    seen.add(category.id);
    list.push(category);
  }
  return list;
}

function inkNativeEffectiveCategoryOrder(ids) {
  const available = new Set(ids);
  const out = [];
  const seen = new Set();
  for (const id of inkNativeLibrary.categoryOrder) {
    if (typeof id !== 'string' || !available.has(id) || seen.has(id)) continue;
    out.push(id);
    seen.add(id);
  }
  for (const id of ids) {
    if (seen.has(id)) continue;
    out.push(id);
    seen.add(id);
  }
  return out;
}

function inkNativeCategoryById(id) {
  return inkNativeAllCategories().find(cat => cat.id === id) || null;
}

function inkNativeBrushCategoryName(id) {
  const cat = inkNativeCategoryById(id);
  return cat ? __t(cat.name) : __t('Brush');
}

function inkNativeVisibleCategories() {
  const deleted = new Set(inkState().deletedCategories || []);
  const all = inkNativeAllCategories();
  const byId = new Map(all.map(cat => [cat.id, cat]));
  return inkNativeEffectiveCategoryOrder(all.map(cat => cat.id))
    .map(id => byId.get(id))
    .filter(cat => cat && !deleted.has(cat.id));
}

/** Oluşturucuda ve "kategoriye taşı" menüsünde seçilebilecek gerçek
    kategoriler. "Favorites" sanal bir filtredir; hedef olamaz. */
function inkNativeAssignableCategories() {
  return inkNativeVisibleCategories().filter(cat => !cat.virtual);
}

function inkNativeVisibleBrushes() {
  const ink = inkState();
  const deletedBrushes = new Set(ink.deletedBrushIds || []);
  const deletedCategories = new Set(ink.deletedCategories || []);
  return (ink.brushes || []).filter(brush =>
    !deletedBrushes.has(brush.id) && !deletedCategories.has(brush.category));
}

function inkNativeFavoriteSet() {
  return new Set(Array.isArray(inkNativeLibrary.favorites)
    ? inkNativeLibrary.favorites : []);
}

function inkNativeIsFavorite(brushId) {
  return inkNativeFavoriteSet().has(brushId);
}

/** Bir kategorinin görünen fırçaları. "favorites" sanal kategorisi
    yıldızlanan tüm fırçaları döndürür. */
function inkNativeBrushesForCategory(categoryId) {
  const brushes = inkNativeVisibleBrushes();
  if (categoryId === 'favorites') {
    const favorites = inkNativeFavoriteSet();
    return brushes.filter(brush => favorites.has(brush.id));
  }
  return brushes.filter(brush => brush.category === categoryId);
}

function inkNativeCurrentBrushRecords() {
  const defaults = new Set(
    (typeof inkDefaultBrushes === 'function' ? inkDefaultBrushes() : [])
      .map(brush => brush && brush.id)
      .filter(Boolean)
  );
  return (inkState().brushes || [])
    .filter(brush => brush && brush.id && !defaults.has(brush.id))
    .map(brush => ({
      version: 2,
      brush,
      tipDataUrl: brush.tipId
        ? (inkRuntime.importedTips.get(brush.tipId) || '') : '',
      dualTipDataUrl: brush.dual && brush.dual.tipId
        ? (inkRuntime.importedTips.get(brush.dual.tipId) || '') : '',
    }));
}

function inkNativeMergePersistedBrushes(records) {
  if (!Array.isArray(records) || !records.length) return;
  const ink = inkState();
  const defaults = new Set(
    (typeof inkDefaultBrushes === 'function' ? inkDefaultBrushes() : [])
      .map(brush => brush && brush.id)
      .filter(Boolean)
  );
  for (const rec of records) {
    const source = rec && rec.brush && typeof rec.brush === 'object'
      ? rec.brush : rec;
    if (!source || !source.id || defaults.has(source.id)) continue;
    const tipDataUrl = rec.tipDataUrl || rec.dataUrl || '';
    const dualDataUrl = rec.dualTipDataUrl || rec.dualDataUrl || '';
    if (tipDataUrl && source.tipId) {
      if (!inkRuntime.importedTips.has(source.tipId)) {
        inkRuntime.importedTips.set(source.tipId, tipDataUrl);
        inkLoadAbrTip(source.tipId);
      }
    }
    if (dualDataUrl && source.dual && source.dual.tipId) {
      if (!inkRuntime.importedTips.has(source.dual.tipId)) {
        inkRuntime.importedTips.set(source.dual.tipId, dualDataUrl);
        inkLoadAbrTip(source.dual.tipId);
      }
    }
    if (!ink.brushes.some(brush => brush.id === source.id)) {
      const kind = source.kind === 'abr' || source.kind === 'procedural'
        ? source.kind : (tipDataUrl ? 'abr' : 'procedural');
      ink.brushes.push(inkNormalizeBrush(Object.assign({}, source, {
        kind,
        tipId: source.tipId || '',
      })));
    }
  }
}

/** Global kütüphane kaydını canlı çizim durumuna uygular. Proje
    değişiminde de çağrılır; böylece kaydedilmemiş fırçalar ve özel
    kategoriler kaybolmaz. */
/* Eski sürümlerde içe aktarılan .abr fırçaları `category: ''` ile
   kaydediliyordu; kütüphane kategori filtresi bu kayıtları hiçbir
   listede göstermiyordu. Proje kaydından gelen eski fırçaları da
   burada onar (kütüphane yüklenmeden önce bile). */
function inkNativeRepairBrushCategories() {
  const ink = inkState();
  const defaults = new Set(
    (typeof inkDefaultBrushes === 'function' ? inkDefaultBrushes() : [])
      .map(brush => brush && brush.id)
      .filter(Boolean)
  );
  for (const brush of ink.brushes || []) {
    if (!brush || defaults.has(brush.id) || brush.category) continue;
    brush.category = 'custom';
    if (!brush.badge) brush.badge = 'Custom';
  }
}

function inkNativeApplyLibraryState() {
  inkNativeRepairBrushCategories();
  if (!inkNativeLibrary.loaded) return;
  const ink = inkState();
  const union = (current, persisted) => [...new Set([
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(persisted) ? persisted : []),
  ])];
  ink.deletedCategories = union(ink.deletedCategories, inkNativeLibrary.deletedCategories)
    /* yıldız kategorisi asla silinemeyen sanal filtredir; eski kayıtlardan
       sızmışsa burada da temizlenir */
    .filter(id => id !== 'favorites');
  ink.deletedBrushIds = union(ink.deletedBrushIds, inkNativeLibrary.deletedBrushIds);
  inkNativeMergePersistedBrushes(inkNativeLibrary.brushRecords);
}

function inkNativePruneFavorites() {
  try {
    const visible = new Set(inkNativeVisibleBrushes().map(brush => brush.id));
    inkNativeLibrary.favorites = inkNativeLibrary.favorites
      .filter(id => typeof id === 'string' && visible.has(id));
  } catch { /* sessiz */ }
}

function inkNativeLibrarySnapshot() {
  return {
    version: 1,
    customCategories: inkNativeLibrary.customCategories.map(category => ({
      id: category.id,
      name: category.name,
      title: category.title,
      hint: category.hint,
    })),
    categoryOrder: [...inkNativeLibrary.categoryOrder],
    favorites: [...inkNativeLibrary.favorites],
    deletedCategories: [...(inkNativeLibrary.deletedCategories || [])],
    deletedBrushIds: [...(inkNativeLibrary.deletedBrushIds || [])],
  };
}

async function inkNativePersistLibraryMeta() {
  try {
    if (!db) return;
    await idbPut('meta', INK_NATIVE_LIBRARY_META_KEY, inkNativeLibrarySnapshot());
  } catch (err) {
    console.warn('brush library settings could not be saved', err);
  }
}

/** Fırçaları ve kütüphane ayarlarını birlikte, proje kaydından bağımsız
    olarak hemen diske yazar.
    @param {object} [options]
    @param {boolean} [options.brushes=true] false ise fırça kayıtları
      (uç PNG'leri dahil) yeniden yazılmaz. Favori yıldızı, kategori
      sırası gibi fırça listesini DEĞİŞTİRMEYEN işlemler bunu kullanır:
      aksi hâlde her yıldız tıklaması tüm uç verisini yeniden serileştirip
      diske yazıyordu (çok fırçalı kütüphanede hissedilir takılma). */
async function inkNativePersistLibraryAll(options = {}) {
  try {
    const writeBrushes = options.brushes !== false;
    const ink = inkState();
    inkNativeLibrary.deletedCategories = [...new Set(ink.deletedCategories || [])];
    inkNativeLibrary.deletedBrushIds = [...new Set(ink.deletedBrushIds || [])];
    inkNativePruneFavorites();
    if (writeBrushes && typeof inkPersistImportedBrushes === 'function') {
      await inkPersistImportedBrushes();
    }
    inkNativeLibrary.brushRecords = inkNativeCurrentBrushRecords();
    await inkNativePersistLibraryMeta();
  } catch (err) {
    console.warn('brush library could not be saved', err);
  }
}

async function inkNativeLoadBrushLibrary() {
  try {
    if (!db) return;
    const raw = await idbGet('meta', INK_NATIVE_LIBRARY_META_KEY);
    if (raw && typeof raw === 'object') {
      const seen = new Set();
      inkNativeLibrary.customCategories = (Array.isArray(raw.customCategories)
        ? raw.customCategories : [])
        .map(inkNativeNormalizeCategoryRecord)
        .filter(category => {
          if (!category || seen.has(category.id)) return false;
          seen.add(category.id);
          return true;
        });
      inkNativeLibrary.categoryOrder = Array.isArray(raw.categoryOrder)
        ? raw.categoryOrder.filter(id => typeof id === 'string' && id) : [];
      inkNativeLibrary.favorites = Array.isArray(raw.favorites)
        ? [...new Set(raw.favorites.filter(id => typeof id === 'string' && id))] : [];
      inkNativeLibrary.deletedCategories = Array.isArray(raw.deletedCategories)
        ? [...new Set(raw.deletedCategories.filter(id =>
            typeof id === 'string' && id && id !== 'favorites' && id !== NativeBrushVirtualCategories[0].id))] : [];
      inkNativeLibrary.deletedBrushIds = Array.isArray(raw.deletedBrushIds)
        ? [...new Set(raw.deletedBrushIds.filter(id => typeof id === 'string' && id))] : [];
    }
    const records = await idbGet('meta', 'ink:brushes');
    inkNativeLibrary.brushRecords = Array.isArray(records) ? records : [];
    inkNativeLibrary.loaded = true;
    inkNativeApplyLibraryState();
  } catch (err) {
    console.warn('brush library could not be loaded', err);
  }
}

async function inkNativeToggleFavorite(brushId) {
  if (!brushId) return false;
  const favorites = inkNativeLibrary.favorites;
  const index = favorites.indexOf(brushId);
  if (index >= 0) favorites.splice(index, 1);
  else favorites.push(brushId);
  await inkNativePersistLibraryAll({ brushes: false });
  inkNativeRenderCategories();
  inkNativeRenderBrushList();
  inkNativeSyncMeta();
  return index < 0;
}

async function inkNativeClearFavorites() {
  if (!inkNativeLibrary.favorites.length) return;
  if (!(await appConfirm('Remove all stars from the favorites list?'))) return;
  inkNativeLibrary.favorites = [];
  await inkNativePersistLibraryAll({ brushes: false });
  inkNativeRenderAll();
  inkNativeRenderQuickBrushes();
}

async function inkNativeCreateCategory(rawName) {
  const name = String(rawName || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) return { ok: false, error: 'Category name cannot be empty.' };
  const lower = name.toLocaleLowerCase('tr-TR');
  if (inkNativeAllCategories().some(category =>
    category.name.toLocaleLowerCase('tr-TR') === lower)) {
    return { ok: false, error: 'Bu adla bir kategori zaten var.' };
  }
  const base = 'cat_' + String(newId()).replace(/[^a-z0-9_-]/gi, '').slice(0, 28);
  let id = base;
  let suffix = 2;
  while (inkNativeAllCategories().some(category => category.id === id)) {
    id = base + '_' + suffix;
    suffix += 1;
  }
  const category = {
    id,
    name,
    title: name.toLocaleUpperCase('tr-TR'),
    hint: name + ' brushes in category',
    custom: true,
  };
  inkNativeLibrary.customCategories.push(category);
  const allIds = inkNativeAllCategories().map(item => item.id);
  const order = inkNativeEffectiveCategoryOrder(allIds);
  const activeIndex = order.indexOf(inkNativeBrushUi.activeCategory);
  order.splice(activeIndex >= 0 ? activeIndex + 1 : order.length, 0, id);
  inkNativeLibrary.categoryOrder = order;
  inkNativeBrushUi.activeCategory = id;
  await inkNativePersistLibraryAll({ brushes: false });
  // Yeni kategori seçili kalsın: inkNativeRenderAll() içindeki sync,
  // aktif fırçanın kategorisine geri dönebiliyor.
  inkNativeRenderCategories();
  inkNativeRenderBrushList();
  inkNativeSyncMeta();
  inkNativeSyncDualBrushOptions();
  inkNativeSyncCustomCreator();
  return { ok: true, category };
}

async function inkNativeReorderCategory(fromId, toId, before) {
  if (!fromId || !toId || fromId === toId) return;
  const allIds = inkNativeAllCategories().map(category => category.id);
  if (!allIds.includes(fromId) || !allIds.includes(toId)) return;
  const order = inkNativeEffectiveCategoryOrder(allIds);
  const fromIndex = order.indexOf(fromId);
  if (fromIndex < 0) return;
  order.splice(fromIndex, 1);
  let target = order.indexOf(toId);
  if (target < 0) return;
  if (!before) target += 1;
  order.splice(target, 0, fromId);
  inkNativeLibrary.categoryOrder = order;
  await inkNativePersistLibraryAll({ brushes: false });
  inkNativeRenderCategories();
}

async function inkNativeMoveBrushToCategory(brushId, categoryId) {
  const brush = inkState().brushes.find(item => item.id === brushId);
  if (!brush || inkNativeIsDefaultBrush(brush)) return false;
  if (!inkNativeAssignableCategories().some(category => category.id === categoryId)) {
    return false;
  }
  if (brush.category === categoryId) return false;
  const category = inkNativeCategoryById(categoryId);
  brush.category = categoryId;
  brush.badge = categoryId === 'custom' ? 'Custom' : (category ? category.name : '');
  inkNativeBrushUi.activeCategory = categoryId;
  await inkNativePersistLibraryAll();
  inkNativeRenderAll();
  inkNativeRenderQuickBrushes();
  /* Proje kaydı da tazelensin: aksi hâlde eski pano anlık görüntüsü
     yeniden açılışta fırçayı eski kategorisiyle geri getiriyordu
     (kütüphane kaydı doğru olsa bile). */
  if (typeof scheduleSave === 'function') scheduleSave();
  return true;
}

function inkNativeCloseContextMenu() {
  if (!inkNativeBrushUi.contextMenu) return;
  inkNativeBrushUi.contextMenu.remove();
  inkNativeBrushUi.contextMenu = null;
}

function inkNativeShowContextMenuAt(clientX, clientY, actions) {
  inkNativeCloseContextMenu();
  const menu = document.createElement('div');
  menu.className = 'nbContextMenu';
  menu.setAttribute('role', 'menu');
  for (const action of actions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'nbContextMenu__item';
    item.setAttribute('role', 'menuitem');
    item.textContent = action.label;
    item.disabled = !!action.disabled;
    if (!item.disabled) {
      item.addEventListener('click', () => {
        inkNativeCloseContextMenu();
        action.run();
      });
    }
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  inkNativeBrushUi.contextMenu = menu;
  const x = Math.min(clientX, window.innerWidth - menu.offsetWidth - 8);
  const y = Math.min(clientY, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = Math.max(8, x) + 'px';
  menu.style.top = Math.max(8, y) + 'px';
  menu.querySelector('button:not(:disabled)')?.focus();
}

function inkNativeShowContextMenu(event, actions) {
  event.preventDefault();
  inkNativeShowContextMenuAt(event.clientX, event.clientY, actions);
}

function inkNativeShowMoveCategoryMenu(brush, clientX, clientY) {
  if (!brush || inkNativeIsDefaultBrush(brush)) return;
  const actions = inkNativeAssignableCategories()
    .filter(category => category.id !== brush.category)
    .map(category => ({
      label: __t(category.name),
      run: () => inkNativeMoveBrushToCategory(brush.id, category.id),
    }));
  if (!actions.length) {
    actions.push({ label: __t('No other category'), disabled: true });
  }
  inkNativeShowContextMenuAt(clientX, clientY, actions);
}

function inkNativeIsDefaultBrush(brush) {
  return NativeBrushLibrary.some(item => item.id === brush.id);
}

function inkNativeFallbackBrush() {
  const available = inkNativeVisibleBrushes();
  return available.find(brush => !inkNativeIsDefaultBrush(brush)) ||
    available[0] || null;
}

/* =========================================================
   .abr dışa aktarma
   Fırçanın gerçek ucunu 8 bit gri maske olarak yazar. referans uygulama
   v6.2 düzeni kullanılır: desc (ad) + cbsh (ayarlar) + samp (uç).
   Uygulamanın kendi ayrıştırıcısı bu dosyayı geri okuyabilir.
   ========================================================= */
function inkNativeBrushAbrSample(brush) {
  if (!brush || typeof brush !== 'object') return null;
  const hardness = clamp(Number(brush.hardness) || 0.6, 0, 1);
  let source = null;
  try {
    source = inkBrushSourceCanvas(brush, hardness, 256);
  } catch { source = null; }
  if (!source || !source.width || !source.height) return null;

  // Dosya boyutu için uç en fazla 256 px'e indirilir; en-boy korunur.
  const maxSide = 256;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const tip = document.createElement('canvas');
  tip.width = w;
  tip.height = h;
  const tctx = tip.getContext('2d');
  if (!tctx) return null;
  tctx.drawImage(source, 0, 0, w, h);
  const pixels = tctx.getImageData(0, 0, w, h).data;

  // 47 baytlık örneklenmiş uç başlığı + 19 baytlık bitmap başlığı.
  const entry = new Uint8Array(47 + 19 + w * h);
  const ev = new DataView(entry.buffer);
  ev.setUint32(0, 2); // örneklenmiş uç
  ev.setUint32(4, Math.max(1, Math.round(Number(brush.size) || w)));
  ev.setUint32(8, Math.round(clamp(Number(brush.spacing) || 0.1, 0.01, 2) * 100));
  ev.setUint32(12, Math.round((((Number(brush.angle) || 0) * 180 / Math.PI) % 360 + 360) % 360));
  ev.setUint32(16, Math.round(clamp(Number(brush.roundness) || 1, 0.05, 1) * 100));
  ev.setUint32(20, Math.round(hardness * 100));
  ev.setUint32(24, Math.round(clamp(Number(brush.flow) || 1, 0.01, 1) * 100));
  ev.setInt32(47, 0);
  ev.setInt32(51, 0);
  ev.setInt32(55, h);
  ev.setInt32(59, w);
  ev.setUint16(63, 8);
  entry[65] = 0; // sıkıştırmasız
  for (let i = 0; i < w * h; i++) entry[66 + i] = pixels[i * 4 + 3];
  return { entry, w, h, hardness };
}

/** Birden çok fırçayı tek referans uygulama .abr dosyasında yazar. Her fırça
    kendi `desc` + `cbsh` + `samp` üçlüsüyle eklenir. */
function inkNativeBrushesAbrBytes(brushes) {
  const list = (Array.isArray(brushes) ? brushes : [brushes]).filter(Boolean);
  if (!list.length) return null;

  const out = [];
  const u16 = n => { out.push((n >> 8) & 255, n & 255); };
  const u32 = n => {
    out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  };
  const f64 = n => {
    const t = new Uint8Array(8);
    new DataView(t.buffer).setFloat64(0, n);
    for (let i = 0; i < 8; i++) out.push(t[i]);
  };
  const ascii = s => {
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255);
  };
  const uni = s => {
    const text = String(s || '');
    u32(text.length);
    for (let i = 0; i < text.length; i++) u16(text.charCodeAt(i));
  };
  const id = s => { u32(s.length); ascii(s); };
  const patch32 = (pos, n) => {
    out[pos] = (n >>> 24) & 255;
    out[pos + 1] = (n >>> 16) & 255;
    out[pos + 2] = (n >>> 8) & 255;
    out[pos + 3] = n & 255;
  };
  const descriptor = (cls, fields) => {
    uni(cls);
    id(cls);
    u32(fields.length);
    fields.forEach(fn => fn());
  };
  const numField = (key, unit, value) => {
    id(key);
    ascii('UntF');
    ascii(unit);
    f64(value);
  };
  const textField = (key, value) => {
    id(key);
    ascii('TEXT');
    uni(value);
  };
  const objField = (key, cls, fields) => {
    id(key);
    ascii('Objc');
    descriptor(cls, fields);
  };
  const block = (tag, payload) => {
    ascii('8BIM');
    ascii(tag);
    const sizePos = out.length;
    u32(0);
    const start = out.length;
    payload();
    patch32(sizePos, out.length - start);
    while (out.length % 4) out.push(0);
  };

  u16(6); u16(2);
  let written = 0;
  for (const brush of list) {
    const sample = inkNativeBrushAbrSample(brush);
    if (!sample) continue;
    written += 1;
    const { entry, w, hardness } = sample;
    block('desc', () => {
      u32(1);
      descriptor('brushPreset', [
        () => textField('Nm  ', brush.name || 'Brush'),
      ]);
    });
    block('cbsh', () => {
      u32(16);
      const dyn = brush.dynamics || {};
      const fields = [
        () => numField('Dmtr', '#Pxl', Math.max(1, Number(brush.size) || w)),
        () => numField('Hrdn', '#Prc', hardness * 100),
        () => numField('Spcn', '#Prc', clamp(Number(brush.spacing) || 0.1, 0.01, 2) * 100),
        () => numField('Angl', '#Ang', (((Number(brush.angle) || 0) * 180 / Math.PI) % 360 + 360) % 360),
        () => numField('Rndn', '#Prc', clamp(Number(brush.roundness) || 1, 0.05, 1) * 100),
        () => numField('Flw ', '#Prc', clamp(Number(brush.flow) || 1, 0.01, 1) * 100),
        () => numField('Sctr', '#Prc', clamp(Number(brush.scatter) || 0, 0, 2) * 100),
        () => numField('SzVr', '#Prc', clamp(1 - Number(dyn.sizeMin ?? 0.18), 0, 1) * 100),
        () => numField('AnVr', '#Prc', clamp(Number(dyn.angleJitter) || 0, 0, 1) * 100),
        () => numField('ScVr', '#Prc', clamp(Number(dyn.scatterJitter) || 0, 0, 1) * 100),
      ];
      if (brush.dual && Number(brush.dual.scale)) {
        fields.push(() => objField('Dual', 'dualBrush', [
          () => numField('Dmtr', '#Pxl',
            Math.max(1, (Number(brush.size) || w) * clamp(Number(brush.dual.scale) || 1, 0.1, 4))),
          () => numField('Hrdn', '#Prc', clamp(Number(brush.dual.hardness ?? 0.6), 0, 1) * 100),
          () => numField('Spcn', '#Prc', clamp(Number(brush.dual.spacing ?? 0.1), 0.01, 2) * 100),
          () => numField('Sctr', '#Prc', clamp(Number(brush.dual.scatter) || 0, 0, 2) * 100),
        ]));
      }
      descriptor('computedBrush', fields);
    });
    block('samp', () => {
      u16(1);
      u16(1);
      u32(entry.length);
      for (let i = 0; i < entry.length; i++) out.push(entry[i]);
      while (out.length % 4) out.push(0);
    });
  }
  if (!written) return null;
  return new Uint8Array(out);
}

function inkNativeBrushAbrBytes(brush) {
  return inkNativeBrushesAbrBytes([brush]);
}

function inkNativeSafeFileName(value, fallback = 'firca') {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 80) || fallback;
}

async function inkNativeSaveAbrFile(bytes, fileName, label) {
  if (!bytes || !bytes.length) {
    window.alert(__t('{label} could not be prepared as .abr.', { label }));
    return false;
  }
  try {
    if (window.tailref && typeof window.tailref.exportAbr === 'function') {
      const res = await window.tailref.exportAbr(bytes, fileName);
      if (res && res.ok) {
        if (typeof showProjectNotice === 'function') {
          showProjectNotice(__t('{label} exported: {file}', { label, file: res.file }), 4200);
        }
        return true;
      }
      if (res && res.canceled) return false;
      window.alert(__t('{label} export failed: {error}', { label, error: res && res.error ? res.error : __t('unknown error') }));
      return false;
    }
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  } catch (error) {
    window.alert(label + ' export failed: ' +
      (error && error.message ? error.message : error));
    return false;
  }
}

async function inkNativeExportBrushAbr(brush) {
  if (!brush) return false;
  let bytes = null;
  try {
    bytes = inkNativeBrushAbrBytes(brush);
  } catch { bytes = null; }
  return inkNativeSaveAbrFile(
    bytes,
    inkNativeSafeFileName(brush.name) + '.abr',
    'Brush'
  );
}

async function inkNativeExportCategoryAbr(categoryId) {
  const category = inkNativeCategoryById(categoryId);
  const brushes = inkNativeBrushesForCategory(categoryId);
  if (!brushes.length) {
    window.alert(__t('No brushes to export in this category.'));
    return false;
  }
  let bytes = null;
  try {
    bytes = inkNativeBrushesAbrBytes(brushes);
  } catch { bytes = null; }
  return inkNativeSaveAbrFile(
    bytes,
    inkNativeSafeFileName(category ? category.name : 'kategori') + '.abr',
    category ? __t('“{name}” category', { name: __t(category.name) }) : __t('Category')
  );
}

async function inkNativeDeleteBrush(brushId) {
  const ink = inkState();
  const brush = ink.brushes.find(item => item.id === brushId);
  if (!brush || inkNativeIsDefaultBrush(brush)) return false;
  if (!(await appConfirm(__t('“{name}” — remove this brush from the library?', { name: brush.name })))) return false;
  if (!ink.deletedBrushIds.includes(brush.id)) ink.deletedBrushIds.push(brush.id);
  if (ink.brushId === brush.id) {
    const fallback = inkNativeFallbackBrush();
    if (fallback) setActiveBrush(fallback.id);
  }
  inkNativeRenderAll();
  inkNativeRenderQuickBrushes();
  if (typeof inkSyncUI === 'function') inkSyncUI();
  await inkNativePersistLibraryAll({ brushes: false });
  if (typeof scheduleSave === 'function') scheduleSave();
  return true;
}

async function inkNativeDeleteCategory(categoryId) {
  const ink = inkState();
  const category = inkNativeCategoryById(categoryId);
  if (!category || category.virtual) {
    if (category && category.virtual) {
      window.alert(__t('Favorites is a virtual category; it cannot be deleted. You can remove stars one by one.'));
    }
    return;
  }
  if (ink.deletedCategories.includes(categoryId)) return;
  const categories = inkNativeVisibleCategories().filter(item => !item.virtual);
  if (categories.length <= 1 && categories.some(item => item.id === categoryId)) {
    window.alert(__t('At least one category must remain in the library.'));
    return;
  }
  const contents = inkNativeBrushesForCategory(categoryId);
  /* Onay metni yanlış birleştirilmişti: "… category and its 3 — remove this
     brush …" gibi yarım bir cümle çıkıyordu. Sayıya göre tekil/çoğul kur. */
  const confirmText = contents.length === 1
    ? __t('“{name}” category and its 1 brush will be removed from the library.', { name: __t(category.name) })
    : contents.length
      ? __t('“{name}” category and its {n} brushes will be removed from the library.', { name: __t(category.name), n: contents.length })
      : __t('“{name}” category will be removed from the library.', { name: __t(category.name) });
  if (!(await appConfirm(confirmText))) return;

  if (!ink.deletedCategories.includes(categoryId)) ink.deletedCategories.push(categoryId);
  for (const brush of contents) {
    if (!inkNativeIsDefaultBrush(brush) && !ink.deletedBrushIds.includes(brush.id)) {
      ink.deletedBrushIds.push(brush.id);
    }
  }
  // Özel kategori kaydını ve sıralamadaki yerini de temizle.
  inkNativeLibrary.customCategories = inkNativeLibrary.customCategories
    .filter(item => item.id !== categoryId);
  inkNativeLibrary.categoryOrder = inkNativeLibrary.categoryOrder
    .filter(id => id !== categoryId);
  if (ink.brushId && contents.some(brush => brush.id === ink.brushId)) {
    const fallback = inkNativeFallbackBrush();
    if (fallback) setActiveBrush(fallback.id);
  }
  inkNativeBrushUi.activeCategory =
    inkNativeVisibleCategories()[0]?.id || '';
  inkNativeRenderAll();
  inkNativeRenderQuickBrushes();
  if (typeof inkSyncUI === 'function') inkSyncUI();
  await inkNativePersistLibraryAll({ brushes: false });
  if (typeof scheduleSave === 'function') scheduleSave();
}

function inkNativeRenderQuickBrushes() {
  const list = document.getElementById('inkPresetList') ||
    (typeof inkUi !== 'undefined' && inkUi.els ? inkUi.els.presetList : null);
  if (!list) return;
  let brushes = [];
  try { brushes = inkNativeVisibleBrushes(); } catch { /* sessiz */ }
  const ink = inkState();
  const signature = brushes.map(b => b.id).join('|');
  if (list.dataset.nbSignature === signature && list.children.length) {
    list.querySelectorAll('.inkPreset').forEach(btn => {
      const on = btn.dataset.brushId === ink.brushId;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    return;
  }
  list.dataset.nbSignature = signature;
  list.replaceChildren();
  for (const brush of brushes) {
    if (!brush || !brush.id) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inkPreset' + (brush.id === ink.brushId ? ' active' : '');
    btn.dataset.brushId = brush.id;
    btn.title = brush.name;
    btn.setAttribute('aria-label', brush.name);
    btn.setAttribute('aria-pressed', brush.id === ink.brushId ? 'true' : 'false');
    const canvas = document.createElement('canvas');
    canvas.className = 'inkPresetPreview';
    canvas.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'inkPresetName';
    label.textContent = brush.name;
    btn.append(canvas, label);
    btn.addEventListener('click', () => {
      if (typeof setActiveBrush === 'function') setActiveBrush(brush.id);
    });
    list.appendChild(btn);
    // Şerit önizlemeleri boş-zamanda boyanır (açılışta senkron boyama
    // ~30-50 ms/kart — startup-probe bulgusu). Disk önbelleği varsa
    // kısa bir beklemeden decode edilip basılır; yoksa normal regen.
    // UI kurulumu bu sözleşmeyle asla engellenmez.
    const stripOps = { width: 72, height: 38 };
    inkNativeWhenIdle(() => {
      if (!canvas.isConnected) return; // kart arada kuruludan çıkarıldıysa
      /* Boşaltma anında görünürlük (darbokaz düzeltmesi): panel hâlâ
         gizliyse boyamayı atla, bayat işaretle; panel görünür olduğunda
         inkPreviewFlushStale() bir kez boyar. Kuyruğa bırakma anı ile
         boşaltma anı arasında tema/mod değişebilir. */
      if (!inkPreviewCanvasVisible(canvas)) {
        btn.dataset.nbPreviewStale = '1';
        inkNativeBrushUi.previewDirty = true;
        return;
      }
      if (btn.dataset.nbPreviewStale) delete btn.dataset.nbPreviewStale;
      inkPaintPreviewAsync(canvas, brush, stripOps);
    });
  }
}

function inkNativeRenderCategories() {
  const nav = inkNativeBrushUi.els.categories;
  if (!nav) return;
  nav.replaceChildren();
  const categories = inkNativeVisibleCategories();
  for (const cat of categories) {
    const count = inkNativeBrushesForCategory(cat.id).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nbCategory' +
      (cat.id === inkNativeBrushUi.activeCategory ? ' is-active' : '') +
      (cat.virtual ? ' nbCategory--virtual' : '');
    btn.dataset.category = cat.id;
    btn.draggable = true;
    btn.title = __t(cat.hint || cat.name) + ' · ' + __t('Drag to reorder');
    btn.setAttribute('aria-pressed', cat.id === inkNativeBrushUi.activeCategory ? 'true' : 'false');
    const name = document.createElement('span');
    name.className = 'nbCategory__name';
    name.textContent = __t(cat.name);
    const meta = document.createElement('span');
    meta.className = 'nbCategory__count';
    meta.textContent = String(count);
    btn.append(name, meta);
    btn.addEventListener('click', () => {
      inkNativeBrushUi.activeCategory = cat.id;
      inkNativeRenderCategories();
      inkNativeRenderBrushList();
      inkNativeSyncMeta();
      inkNativeSyncCustomCreator();
    });
    btn.addEventListener('dragstart', event => {
      inkNativeBrushUi.dragCategory = cat.id;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData('text/plain', cat.id); } catch { /* sessiz */ }
      }
      btn.classList.add('is-dragging');
    });
    btn.addEventListener('dragend', () => {
      inkNativeBrushUi.dragCategory = '';
      nav.querySelectorAll('.nbCategory').forEach(item => {
        item.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
      });
    });
    btn.addEventListener('dragover', event => {
      const from = inkNativeBrushUi.dragCategory;
      if (!from || from === cat.id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const rect = btn.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      nav.querySelectorAll('.nbCategory').forEach(item => {
        item.classList.remove('is-drop-before', 'is-drop-after');
      });
      btn.classList.add(before ? 'is-drop-before' : 'is-drop-after');
    });
    btn.addEventListener('dragleave', event => {
      if (event.relatedTarget && btn.contains(event.relatedTarget)) return;
      btn.classList.remove('is-drop-before', 'is-drop-after');
    });
    btn.addEventListener('drop', event => {
      event.preventDefault();
      const from = inkNativeBrushUi.dragCategory;
      const before = btn.classList.contains('is-drop-before');
      inkNativeBrushUi.dragCategory = '';
      if (from && from !== cat.id) {
        inkNativeReorderCategory(from, cat.id, before);
      }
    });
    nav.appendChild(btn);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'nbCategory nbCategory--add';
  const addName = document.createElement('span');
  addName.className = 'nbCategory__name';
  addName.textContent = '+ New category';
  add.appendChild(addName);
  add.addEventListener('click', () => inkNativeBeginCreateCategory(add));
  nav.appendChild(add);

  if (!categories.length) {
    const empty = document.createElement('p');
    empty.className = 'nbEmpty';
    empty.textContent = 'No category to show.';
    nav.insertBefore(empty, add);
  }
}

/** Kategori rayında satır içi "yeni kategori" formu açar. Electron
    `window.prompt` desteklemediği için kendi küçük formumuzu kullanıyoruz. */
function inkNativeBeginCreateCategory(anchor) {
  if (!inkNativeBrushUi.els.categories || !anchor) return;
  const form = document.createElement('form');
  form.className = 'nbCategoryCreate';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = 'Category name';
  input.setAttribute('aria-label', 'New category name');
  const actions = document.createElement('div');
  actions.className = 'nbCategoryCreate__actions';
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.textContent = 'Add';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const status = document.createElement('span');
  status.className = 'nbCategoryCreate__status';
  status.setAttribute('role', 'status');
  actions.append(ok, cancel);
  form.append(input, actions, status);
  anchor.replaceWith(form);
  input.focus();

  let busy = false;
  cancel.addEventListener('click', () => {
    if (busy) return;
    inkNativeRenderCategories();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    status.textContent = 'Creating…';
    const result = await inkNativeCreateCategory(input.value);
    if (!result.ok) {
      busy = false;
      status.textContent = result.error || 'Category could not be created.';
      input.focus();
      input.select();
      return;
    }
    // Başarılıysa render zaten formu kaldırır.
  });
  form.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel.click();
    }
  });
}

function inkNativeBrushCard(brush, ink, options = {}) {
  const compact = !!options.compact;
  const isActive = options.active !== undefined
    ? !!options.active : brush.id === ink.brushId;
  const favorite = inkNativeIsFavorite(brush.id);
  // Kart bir <div>: içine yıldız düğmesi yerleştirebilmek için <button>
  // kullanmıyoruz. Klavye erişimi role/tabindex ile korunuyor.
  const card = document.createElement('div');
  card.className = 'nbBrushCard' + (isActive ? ' is-active' : '') +
    (favorite ? ' is-favorite' : '');
  card.dataset.brushId = brush.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'option');
  card.setAttribute('aria-selected', isActive ? 'true' : 'false');
  card.title = brush.description || brush.name;

  const canvas = document.createElement('canvas');
  canvas.className = 'nbBrushCard__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const meta = document.createElement('span');
  meta.className = 'nbBrushCard__meta';
  const name = document.createElement('span');
  name.className = 'nbBrushCard__name';
  name.textContent = brush.name;
  const size = document.createElement('span');
  size.className = 'nbBrushCard__size';
  size.textContent = (brush.size ? Math.round(brush.size) + ' px' : '');
  meta.append(name, size);

  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'nbBrushCard__star' + (favorite ? ' is-on' : '');
  star.setAttribute('aria-pressed', favorite ? 'true' : 'false');
  star.setAttribute('aria-label', favorite
    ? brush.name + ' — remove from favorites'
    : brush.name + ' — add to favorites');
  star.title = favorite ? 'Remove from favorites' : 'Add to favorites';
  star.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9z"/>' +
    '</svg>';
  star.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    inkNativeToggleFavorite(brush.id);
  });
  star.addEventListener('pointerdown', event => event.stopPropagation());

  card.append(canvas, meta, star);

  const activate = () => {
    if (inkNativeBrushUi.creatorOnly) {
      // Oluşturucuda fırça seçmek onu boyamak için aktif yapmaz; yalnızca
      // ayarlarını forma "taban" olarak taşır. Orijinal fırça değişmez.
      inkNativeBrushUi.creatorBaseId = brush.id;
      inkNativeLoadBrushIntoCreator(brush);
      inkNativeSync();
      return;
    }
    setActiveBrush(brush.id);
    inkNativeSync();
  };
  card.addEventListener('click', activate);
  card.addEventListener('keydown', event => {
    if (event.target !== card) return;
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    activate();
  });
  /* Kart boyaması boş-zamana ertelenir (darbokaz düzeltmesi): senkron
     boyama gizli panelde boşa iş olurdu; boşaltma anında panel gizliyse
     bayat işaretlenir, panel görünür olduğunda bir kez boyanır. */
  const cardOps = compact ? {
    width: 150,
    height: 46,
    sizePx: Math.max(2, Math.min(16, brush.size * 0.22 + 2)),
  } : {
    width: 620,
    height: 78,
    sizePx: Math.max(3, Math.min(24, brush.size * 0.32 + 2)),
  };
  inkNativeWhenIdle(() => {
    if (!canvas.isConnected) return;
    if (!inkPreviewCanvasVisible(canvas)) {
      card.dataset.nbPreviewStale = '1';
      inkNativeBrushUi.previewDirty = true;
      return;
    }
    if (card.dataset.nbPreviewStale) delete card.dataset.nbPreviewStale;
    inkPaintPreviewAsync(canvas, brush, cardOps);
  });
  return card;
}

/* Liste her yeniden çizimde replaceChildren() ile baştan kurulur. Aynı
   kategori içinde yapılan işlemlerde (favori yıldızı, fırça silme, isim
   değişimi) bu, kaydırma konumunu sıfırlıyordu: uzun listede aşağıdaki
   bir fırçayı yıldızlayan kullanıcı listenin başına fırlıyordu. Kategori
   değişiminde ise başa dönmek doğru davranış. */
function inkNativeRenderBrushList() {
  const list = inkNativeBrushUi.els.list;
  const previous = list ? list.dataset.category : '';
  const top = list ? list.scrollTop : 0;
  inkNativeRenderBrushListInner();
  if (!list) return;
  if (previous && list.dataset.category === previous) {
    /* Aynı kategori: kullanıcı nerede baktıysa orada kalsın. */
    if (top > 0) list.scrollTop = top;
  } else {
    /* Kategori değişti: yeni liste baştan görünsün. (replaceChildren
       kaydırmayı kendiliğinden sıfırlamıyor; içerik aynı görevde yeniden
       dolduğu için tarayıcı eski kaydırma konumunu koruyor.) */
    list.scrollTop = 0;
  }
}

function inkNativeRenderBrushListInner() {
  const list = inkNativeBrushUi.els.list;
  if (!list) return;
  const categories = inkNativeVisibleCategories();
  const ink = inkState();
  list.replaceChildren();

  // Oluşturucu ekranı: referans tasarımdaki gibi solda tüm kitaplık,
  // ortada ayarlar, sağda önizleme/test alanı.
  if (inkNativeBrushUi.creatorOnly) {
    list.dataset.category = '__creator__';
    let shown = 0;
    for (const category of categories) {
      if (category.virtual) continue;
      const items = inkNativeBrushesForCategory(category.id);
      if (!items.length && category.id !== 'custom') continue;
      const group = document.createElement('div');
      group.className = 'nbBrushGroup';
      const title = document.createElement('div');
      title.className = 'nbBrushGroup__title';
      title.textContent = __t(category.name);
      group.appendChild(title);
      for (const brush of items) {
        group.appendChild(inkNativeBrushCard(brush, ink, {
          compact: true,
          active: brush.id === inkNativeBrushUi.creatorBaseId,
        }));
        shown += 1;
      }
      if (!items.length && category.id === 'custom') {
        const empty = document.createElement('p');
        empty.className = 'nbEmpty nbEmpty--compact';
        empty.textContent = __t('You have no custom brushes yet.');
        group.appendChild(empty);
      }
      list.appendChild(group);
    }
    if (!shown) {
      const empty = document.createElement('p');
      empty.className = 'nbEmpty';
      empty.textContent = __t('No brushes to show.');
      list.appendChild(empty);
    }
    return;
  }

  const cat = categories.find(item => item.id === inkNativeBrushUi.activeCategory) || categories[0];
  if (!cat) {
    list.dataset.category = '';
    return;
  }
  list.dataset.category = cat.id;
  const items = inkNativeBrushesForCategory(cat.id);
  for (const brush of items) {
    list.appendChild(inkNativeBrushCard(brush, ink));
  }
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'nbEmpty';
    empty.textContent = cat.id === 'favorites'
      ? 'No starred brushes yet. Tap the star at the top right of the cards.'
      : cat.id === 'custom'
        ? 'You have no custom brushes yet. Save your first brush with "Create your own brush" in the brush panel.'
        : cat.virtual
          ? 'No brushes in this category yet.'
          : 'No brushes in this category yet. You can add brushes from the creator.';
    list.appendChild(empty);
  }
}

function inkNativeSyncMeta() {
  const title = inkNativeBrushUi.els.categoryTitle;
  const hint = inkNativeBrushUi.els.categoryHint;
  const count = inkNativeBrushUi.els.count;

  if (inkNativeBrushUi.creatorOnly) {
    let total = 0;
    try { total = inkNativeVisibleBrushes().length; } catch { total = 0; }
    if (title) title.textContent = __t('MY LIBRARY');
    if (hint) hint.textContent = __t('All brushes by category');
    if (count) count.textContent = total + ' ' + __tp('brush', total);
    return;
  }

  const cat = inkNativeVisibleCategories().find(item =>
    item.id === inkNativeBrushUi.activeCategory) || inkNativeVisibleCategories()[0];
  if (title) title.textContent = cat ? __t(cat.title) : __t('BRUSH LIBRARY');
  if (hint) hint.textContent = cat ? __t(cat.hint) : '';
  if (count) {
    let n = 0;
    try {
      n = cat ? inkNativeBrushesForCategory(cat.id).length : 0;
    } catch { n = 0; }
    count.textContent = n + ' ' + __tp('brush', n);
  }
}

/* Tema değişince fırça önizlemelerini yeniden boyar. Kartlar ve hazır
   şerit bir kez üretilir; mürekkep rengi `--text` değişkeninden geldiği
   için piksel yenilemesi gerekir (DOM'u yeniden kurmadan).

   DARBOKAZ DÜZELTMESİ (16 Kasım 2026 CPU-profiler bulgusu): bake
   anahtarı tema mürekkep rengini içerir; tema her değiştiğinde
   GÖRÜNMEYEN panellerdeki 100+ kart da damla damla yeniden
   damgalanıyordu (createNoiseTip tek başına ~350 ms örneklendi) ve
   tema değişimi ~1,2-2 s ana iş parçacığı duraklamasına dönüşüyordu.
   Şimdi yalnızca görünür önizlemeler boyanır; gizliler "bayat"
   işaretlenir ve panel görünür olduğunda bir kez boyanır. */
function inkPreviewCanvasVisible(canvas) {
  if (!canvas || !canvas.isConnected) return false;
  /* offsetParent, bir ata display:none iken null olur. Önizleme
     kanallarındaki tuvallerin kendisi position:fixed değil; sabit
     konumlu ata içindekilerde de null dönmez. */
  return canvas.offsetParent !== null;
}

/** Bayat önizlemeleri boşa boyamayı önle: gizli kartları atla, iz bırak. */
function inkNativeRefreshPreviews() {
  let stale = 0;
  const list = inkNativeBrushUi.els.list;
  if (list) {
    const compact = !!inkNativeBrushUi.creatorOnly;
    list.querySelectorAll('.nbBrushCard').forEach(card => {
      const brush = typeof inkGetBrush === 'function' ? inkGetBrush(card.dataset.brushId) : null;
      const canvas = card.querySelector('.nbBrushCard__canvas');
      if (!brush || !canvas) return;
      if (!inkPreviewCanvasVisible(canvas)) {
        card.dataset.nbPreviewStale = '1';
        stale++;
        return;
      }
      if (card.dataset.nbPreviewStale) delete card.dataset.nbPreviewStale;
      inkPaintPreviewAsync(canvas, brush, compact ? {
        width: 150,
        height: 46,
        sizePx: Math.max(2, Math.min(16, brush.size * 0.22 + 2)),
      } : {
        width: 620,
        height: 78,
        sizePx: Math.max(3, Math.min(24, brush.size * 0.32 + 2)),
      });
    });
  }
  document.querySelectorAll('#inkPresetList .inkPreset').forEach(btn => {
    const brush = typeof inkGetBrush === 'function' ? inkGetBrush(btn.dataset.brushId) : null;
    const canvas = btn.querySelector('.inkPresetPreview');
    if (!brush || !canvas) return;
    if (!inkPreviewCanvasVisible(canvas)) {
      btn.dataset.nbPreviewStale = '1';
      stale++;
      return;
    }
    if (btn.dataset.nbPreviewStale) delete btn.dataset.nbPreviewStale;
    inkPaintPreviewAsync(canvas, brush, { width: 72, height: 38 });
  });
  /* En az bir gizli kart atlandıysa bayatlık işareti konur; panel
     görünür olduğunda inkPreviewFlushStale() bir kez boyar. */
  if (stale) inkNativeBrushUi.previewDirty = true;
  if (typeof inkPreviewBrush === 'function') inkPreviewBrush();
  if (typeof inkNativeSyncCustomCreator === 'function') inkNativeSyncCustomCreator();
}

/** Panellerin görünür olduğu anlarda çağrılır: tema değişimi sırada
    gizli kalan önizlemeleri şimdi boyar (boş çağrı ~0 maliyet). */
function inkPreviewFlushStale() {
  if (!inkNativeBrushUi.previewDirty) return;
  inkNativeBrushUi.previewDirty = false;
  inkNativeRefreshPreviews();
}

function inkNativeSync() {
  /* Tema değişimi sırada gizli kalan önizlemeleri boşalt (boş çağrı ~0 ms). */
  if (inkNativeBrushUi.previewDirty && typeof inkPreviewFlushStale === 'function') {
    try { inkPreviewFlushStale(); } catch { /* sessiz */ }
  }
  if (!inkNativeBrushUi.els.root) return;
  const ink = inkState();
  const active = inkGetBrush(ink.brushId);
  const visibleCategories = inkNativeVisibleCategories();
  if (active && active.category &&
      visibleCategories.some(category => category.id === active.category)) {
    inkNativeBrushUi.activeCategory = active.category;
  } else if (!visibleCategories.some(category => category.id === inkNativeBrushUi.activeCategory)) {
    inkNativeBrushUi.activeCategory = visibleCategories[0]?.id || '';
  }

  const nav = inkNativeBrushUi.els.categories;
  if (nav) {
    nav.querySelectorAll('.nbCategory').forEach(btn => {
      const on = btn.dataset.category === inkNativeBrushUi.activeCategory;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  const list = inkNativeBrushUi.els.list;
  const listKey = inkNativeBrushUi.creatorOnly ? '__creator__' : inkNativeBrushUi.activeCategory;
  if (list && list.dataset.category !== listKey) {
    inkNativeRenderBrushList();
  } else if (list) {
    const selectedId = inkNativeBrushUi.creatorOnly
      ? inkNativeBrushUi.creatorBaseId : active.id;
    list.querySelectorAll('.nbBrushCard').forEach(card => {
      const on = card.dataset.brushId === selectedId;
      card.classList.toggle('is-active', on);
      card.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  inkNativeSyncMeta();
  inkNativeSyncCustomCreator();

  document.querySelectorAll('#inkPresetList .inkPreset').forEach(btn => {
    const on = btn.dataset.brushId === active.id;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function inkNativeRenderAll() {
  inkNativeRenderCategories();
  inkNativeRenderBrushList();
  inkNativeSyncMeta();
  inkNativeSyncDualBrushOptions();
  inkNativeSync();
}

function inkNativeSyncDualBrushOptions() {
  const select = document.getElementById('nativeBrushCustomDualBrush');
  if (!select) return;
  const selected = select.value;
  const brushes = inkNativeVisibleBrushes();
  select.replaceChildren(new Option('Off', ''));
  for (const brush of brushes) {
    select.add(new Option(brush.name, brush.id));
  }
  select.value = brushes.some(brush => brush.id === selected) ? selected : '';
}

function inkOpenNativeBrushLibrary(anchor, categoryId, options = {}) {
  const root = inkNativeBrushUi.els.root;
  if (!root) return;
  const creatorOnly = !!options.creatorOnly;
  inkNativeBrushUi.lastFocus = anchor || document.activeElement;
  inkNativeBrushUi.creatorOnly = creatorOnly;
  if (inkNativeVisibleCategories().some(cat => cat.id === categoryId)) {
    inkNativeBrushUi.activeCategory = categoryId;
  } else {
    try {
      const active = inkGetBrush(inkState().brushId);
      if (active && inkNativeVisibleCategories().some(cat => cat.id === active.category)) {
        inkNativeBrushUi.activeCategory = active.category;
      }
    } catch { /* sessiz */ }
  }
  root.classList.toggle('nbOverlay--creator-only', creatorOnly);
  if (creatorOnly) {
    inkNativeSyncCreatorCategoryOptions(inkNativeBrushUi.activeCategory);
  }
  inkNativeRenderAll();
  if (inkNativeVisibleCategories().some(cat => cat.id === categoryId)) {
    inkNativeBrushUi.activeCategory = categoryId;
    inkNativeRenderCategories();
    inkNativeRenderBrushList();
    inkNativeSyncMeta();
  }
  root.setAttribute('aria-label', __t(creatorOnly ? 'Brush creator' : 'Brush library'));
  const title = root.querySelector('.nbHead h2');
  if (title) title.textContent = __t(creatorOnly ? 'CREATE YOUR OWN BRUSH' : 'BRUSH LIBRARY');
  if (inkNativeBrushUi.els.close) {
    inkNativeBrushUi.els.close.setAttribute(
      'aria-label', __t(creatorOnly ? 'Close the brush creator' : 'Close library')
    );
  }
  root.hidden = false;
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('native-brush-open');
  requestAnimationFrame(() => {
    const close = inkNativeBrushUi.els.close;
    if (close) close.focus();
  });
}

function inkCloseNativeBrushLibrary() {
  const root = inkNativeBrushUi.els.root;
  if (!root || root.hidden) return;
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  root.classList.remove('nbOverlay--creator-only');
  inkNativeBrushUi.creatorOnly = false;
  root.setAttribute('aria-label', 'Brush library');
  const title = root.querySelector('.nbHead h2');
  if (title) title.textContent = 'BRUSH LIBRARY';
  if (inkNativeBrushUi.els.close) {
    inkNativeBrushUi.els.close.setAttribute('aria-label', 'Close library');
  }
  document.body.classList.remove('native-brush-open');
  const focus = inkNativeBrushUi.lastFocus;
  if (focus && focus.isConnected && typeof focus.focus === 'function') {
    try { focus.focus(); } catch { /* sessiz */ }
  }
}

function inkInitNativeBrushLibrary() {
  const els = inkNativeBrushUi.els;
  els.root = document.getElementById('nativeBrushLibrary');
  if (!els.root) return;
  els.close = document.getElementById('nativeBrushClose');
  els.categories = document.getElementById('nativeBrushCategories');
  els.list = document.getElementById('nativeBrushList');
  els.categoryTitle = document.getElementById('nativeBrushCategoryTitle');
  els.categoryHint = document.getElementById('nativeBrushCategoryHint');
  els.count = document.getElementById('nativeBrushCount');
  els.creatorPreview = document.getElementById('nativeBrushCreatorPreview');
  els.creatorControls = document.getElementById('nativeBrushCustomControls');
  els.creatorDelete = document.getElementById('nativeBrushCustomDelete');
  els.creatorPng = document.getElementById('nativeBrushCustomPng');
  els.creatorPngButton = document.getElementById('nativeBrushCustomPngButton');
  els.creatorPngClear = document.getElementById('nativeBrushCustomPngClear');
  els.creatorPngStatus = document.getElementById('nativeBrushCustomPngStatus');
  els.testCanvas = document.getElementById('nativeBrushCreatorTestCanvas');
  els.testLive = document.getElementById('nativeBrushCreatorTestLive');
  els.testColor = document.getElementById('nativeBrushCreatorTestColor');
  els.testClear = document.getElementById('nativeBrushCreatorTestClear');
  els.testUndo = document.getElementById('nativeBrushCreatorTestUndo');

  if (!inkNativeBrushUi.bound) {
    inkNativeBrushUi.bound = true;
    inkNativeCreatorTestBind();
    document.addEventListener('pointerdown', event => {
      if (inkNativeBrushUi.contextMenu &&
          !inkNativeBrushUi.contextMenu.contains(event.target)) {
        inkNativeCloseContextMenu();
      }
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !inkNativeBrushUi.contextMenu) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      inkNativeCloseContextMenu();
    }, true);
    els.close?.addEventListener('click', () => inkCloseNativeBrushLibrary());
    els.categories?.addEventListener('contextmenu', event => {
      const target = event.target instanceof Element
        ? event.target.closest('.nbCategory') : null;
      if (!target) return;
      const category = inkNativeCategoryById(target.dataset.category);
      if (!category) return;
      const count = inkNativeBrushesForCategory(category.id).length;
      const actions = [{
        label: count
          ? 'Export as .abr (' + count + ' brush)'
          : 'Export as .abr',
        disabled: count === 0,
        run: () => inkNativeExportCategoryAbr(category.id),
      }];
      if (category.virtual) {
        actions.push({
          label: 'Clear favorites',
          disabled: count === 0,
          run: () => inkNativeClearFavorites(),
        });
      } else {
        actions.push({
          label: 'Delete the category and its brushes',
          run: () => inkNativeDeleteCategory(category.id),
        });
      }
      inkNativeShowContextMenu(event, actions);
    });
    els.list?.addEventListener('contextmenu', event => {
      const target = event.target instanceof Element
        ? event.target.closest('.nbBrushCard') : null;
      if (!target) return;
      const brush = inkState().brushes.find(item => item.id === target.dataset.brushId);
      if (!brush) return;
      const isDefault = inkNativeIsDefaultBrush(brush);
      const favorite = inkNativeIsFavorite(brush.id);
      const x = event.clientX;
      const y = event.clientY;
      inkNativeShowContextMenu(event, [{
        label: favorite ? 'Remove from favorites' : 'Add to favorites',
        run: () => inkNativeToggleFavorite(brush.id),
      }, {
        label: 'Export as .abr',
        run: () => inkNativeExportBrushAbr(brush),
      }, {
        label: 'Move to category…',
        disabled: isDefault,
        run: () => inkNativeShowMoveCategoryMenu(brush, x, y),
      }, {
        label: isDefault ? 'Preset brushes cannot be deleted' : 'Delete brush',
        disabled: isDefault,
        run: () => inkNativeDeleteBrush(brush.id),
      }]);
    });
    els.root.addEventListener('pointerdown', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest('[data-nb-close]')) inkCloseNativeBrushLibrary();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || els.root.hidden) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      inkCloseNativeBrushLibrary();
    }, true);
    document.getElementById('btnOpenBrushLibrary')?.addEventListener('click', event => {
      event.preventDefault();
      inkOpenNativeBrushLibrary(event.currentTarget);
    });
    /* LAG DÜZELTMESI: slider 'input' sürükleme boyunca kare başına
       çok kez yanar; senkronu rAF ile kare başına BİR kez indirger
       (aradaki olaylar birleşir — son durum boyanır). */
    let creatorSyncQueued = 0;
    const updateCreator = () => {
      if (creatorSyncQueued) return;
      creatorSyncQueued = requestAnimationFrame(() => {
        creatorSyncQueued = 0;
        inkNativeSyncCustomCreator();
      });
    };
    document.getElementById('nativeBrushCustomName')?.addEventListener('input', updateCreator);
    els.creatorControls?.addEventListener('input', updateCreator);
    els.creatorControls?.addEventListener('change', updateCreator);
    els.creatorPngButton?.addEventListener('click', () => els.creatorPng?.click());
    els.creatorPng?.addEventListener('change', async () => {
      const file = els.creatorPng.files && els.creatorPng.files[0];
      els.creatorPng.value = '';
      if (!file) return;
      try {
        const uploaded = await inkNativeBrushTipFromPng(file);
        inkNativeBrushUi.uploadedTip = uploaded;
        if (els.creatorPngStatus) {
          els.creatorPngStatus.textContent =
            uploaded.name + ' · ' + uploaded.width + '×' + uploaded.height + ' PNG tip ready.';
        }
        inkLoadAbrTip(uploaded.tipId);
        updateCreator();
      } catch (error) {
        if (els.creatorPngStatus) {
          els.creatorPngStatus.textContent = error && error.message
            ? error.message : 'PNG image could not be imported.';
        }
      }
    });
    els.creatorPngClear?.addEventListener('click', () => {
      const uploaded = inkNativeBrushUi.uploadedTip;
      inkNativeBrushUi.uploadedTip = null;
      if (uploaded && !inkState().brushes.some(brush => brush.tipId === uploaded.tipId)) {
        inkRuntime.importedTips.delete(uploaded.tipId);
        inkRuntimeBrushes.abrImages.delete(uploaded.tipId);
      }
      if (els.creatorPngStatus) {
        els.creatorPngStatus.textContent =
          __t('Transparent PNG recommended; a white background is converted to a mask automatically.');
      }
      updateCreator();
    });
    document.getElementById('nativeBrushCustomCreate')?.addEventListener('click', async () => {
      const brush = inkNativeCustomBrushFromForm();
      const status = document.getElementById('nativeBrushCreatorStatus');
      if (!brush.name) {
        if (status) status.textContent = __t('Give the brush a name.');
        document.getElementById('nativeBrushCustomName')?.focus();
        return;
      }
      const ink = inkState();
      ink.deletedCategories = (ink.deletedCategories || [])
        .filter(id => id !== brush.category);
      const duplicate = inkNativeFindSameCustomBrush(ink.brushes, brush);
      if (duplicate) {
        inkNativeBrushUi.activeCategory = duplicate.category || 'custom';
        setActiveBrush(duplicate.id);
        inkNativeRenderAll();
        if (status) {
          status.textContent = __t('These settings already have “{name}”; no new copy was created, the existing brush was selected.',
            { name: duplicate.name });
        }
        return;
      }
      ink.brushes.push(brush);
      inkNativeBrushUi.activeCategory = brush.category;
      setActiveBrush(brush.id);
      inkNativeRenderAll();
      if (status) status.textContent = __t('“{name}” created and saved.', { name: brush.name });
      if (brush.kind === 'abr' && brush.tipId) inkLoadAbrTip(brush.tipId);
      // Proje kaydı manuel modda olsa bile fırça kütüphanesi hemen
      // IndexedDB'ye yazılır; "Save" alınmasa da fırça kaybolmaz.
      await inkNativePersistLibraryAll();
      if (typeof scheduleSave === 'function') scheduleSave();
    });
    els.creatorDelete?.addEventListener('click', async () => {
      const ink = inkState();
      const brush = inkGetBrush(ink.brushId);
      if (!brush || inkNativeIsDefaultBrush(brush)) return;
      const deleted = await inkNativeDeleteBrush(brush.id);
      if (deleted) {
        const status = document.getElementById('nativeBrushCreatorStatus');
        if (status) status.textContent = __t('Custom brush deleted.');
      }
    });
  }
  /* AÇILIŞ: gizli kütüphane panelinin tam kurulumu (kategoriler +
     ~40 kart önizlemesi) boş-zamanda koşar. Kullanıcı paneli açarsa
     inkOpenNativeBrushLibrary senkron yeniden kurar; kurulum
     daha önce yapılmamış olsa bile sonuç aynıdır. */
  inkNativeWhenIdle(inkNativeRenderAll);
  inkNativeCreatorTestSyncButtons();
  requestAnimationFrame(inkNativeCreatorTestRender);
}

/* 31-ink-ui.js içindeki eski fırça şeridi bu iki köprüyü kullanır. */
function inkRenderNativeQuickBrushes() {
  inkNativeRenderQuickBrushes();
}

function inkSyncNativeBrushLibrary() {
  inkNativeSync();
}
