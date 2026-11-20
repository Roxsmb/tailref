/* TailRef app · ink raster core · stamp atlas, path strokes, dirty rects
   ------------------------------------------------------------------
   Faz 2 — raster çekirdeği.

   • `inkStampFor()`        (fırça, renk, sertlik, boyut kovası) anahtarıyla
                            önceden renklendirilmiş ve önceden ölçeklenmiş
                            damga atlası + LRU. Damla başına "128 px ucu
                            yeniden ölçekle" maliyeti kalkar.
   • `inkDrawStrokeAsPath()` sabit basınçlı sert fırçalarda damla yerine tek
                            yollu (quadratic) çizim; damla sayısı 5–10× azalır.
   • `inkMarkLayerDirty()`  vuruşun dünya sınırından etkilenen karo/dikdörtgeni
     / `inkFlushDirtyLayers()` işaretle ve yalnızca orayı yeniden birleştir.

   Not: damga atlası ve kirli dikdörtgen defteri yalnızca çalışma zamanıdır;
   duruma (JSON) girmez.
   ========================================================= */
'use strict';

/* =========================================================
   damga atlası (stamp cache)
   ========================================================= */
const INK_STAMP_BUCKETS = [16, 32, 64, 128, 256, 512, 1024];
const INK_STAMP_LIMIT = 160;
/* Profiler bulgusu: damga önbelleği 96'daydı; varyant×kova uzayı
   sıkığa girip vuruş ortasında damga yeniden envanterliyordu. */
// Büyük kovalar hızla bellek yer: LRU hem adet hem toplam baytla sınırlanır.
const INK_STAMP_BYTES = 32 * 1024 * 1024;

const inkStampCache = {
  map: new Map(),   // "b|brushId|color|hardness|bucket" -> { canvas, size, key, bytes }
  hits: 0,
  misses: 0,
  evictions: 0,
  built: 0,
  bytes: 0,
};

/** Fırça çapını en yakın atlas kovasına yuvarlar (yukarı). */
function inkStampBucket(sizePx) {
  const need = Math.max(1, sizePx || 1);
  for (let i = 0; i < INK_STAMP_BUCKETS.length; i++) {
    if (INK_STAMP_BUCKETS[i] >= need) return INK_STAMP_BUCKETS[i];
  }
  return INK_STAMP_BUCKETS[INK_STAMP_BUCKETS.length - 1];
}

/** Damga/tonlama önbellek anahtarları için uç parmak izi.
    Damganın byte'ları yalnızca uç kaynağına bağlıdır: .abr dokusu ya da
    yerel uç türü+seçenekleri. Anahtar bu parmak izini içermiyordu;
    aynı fırça kimliği farklı uçla yeniden yaratıldığında (kütüphane
    düzenlemesi, test/probe senaryoları) senkron yol BAYAT damgayı
    basıyordu — worker ise iş başına taze damga ürettiği için
    worker ↔ senkron byte paritesi kırılıyordu (probe-parity: noise/
    scatter/dyndyn/full varyantlarının tamamı bu yüzdendi). */
function inkStampTipFingerprint(brush) {
  if (!brush) return '';
  if (brush.kind === 'abr') return 'a' + (brush.tipId || '');
  if (!brush.tip) return '';
  const opts = brush.tipOptions && typeof brush.tipOptions === 'object'
    ? brush.tipOptions : {};
  let fp = brush.tip + '|' + JSON.stringify(opts);
  if (Number.isFinite(brush.tipSeed) && brush.tipSeed) fp += '|' + Math.round(brush.tipSeed);
  return fp;
}

function inkStampKey(brush, color, hardness, bucket, erase, variant = 0) {
  const brushId = brush ? (brush.id || 'x') : 'x';
  return (erase ? 'e|' : 'b|') + brushId + '|' + inkStampTipFingerprint(brush) +
    '|' + (color || '#ffffff') + '|' +
    Math.round(clamp(hardness, 0, 1) * 100) + '|' + bucket +
    (variant > 0 ? '|v' + variant : '');
}

function inkStampEvict() {
  const map = inkStampCache.map;
  while (map.size > INK_STAMP_LIMIT || inkStampCache.bytes > INK_STAMP_BYTES) {
    if (!map.size) break;
    const first = map.keys().next().value;
    const stamp = map.get(first);
    map.delete(first);
    inkStampCache.bytes -= stamp ? stamp.bytes : 0;
    inkStampCache.evictions++;
  }
}

/**
 * Bir damla için hazır damga döndürür. Dönen nesne { canvas, size }:
 * `canvas` kova boyutunda (16…1024 px) önceden renklendirilmiş uçtur; çizim
 * sırasında yalnızca drawImage ölçeklemesi kalır. Uç, kova çözünürlüğünde
 * üretildiği için büyük fırçalarda kenar bulanıklaşmaz.
 */
function inkStampFor(brush, color, hardness, sizePx, erase, reusable = false, variant = 0) {
  const bucket = inkStampBucket(sizePx);
  if (reusable && !erase) {
    return {
      canvas: inkTintedTip(brush, color, hardness, bucket, true, variant),
      size: bucket,
      bytes: bucket * bucket * 4,
    };
  }
  const key = inkStampKey(brush, color, hardness, bucket, erase, variant);
  const map = inkStampCache.map;
  const cached = map.get(key);
  if (cached) {
    // LRU: son kullanılanı sona taşı.
    map.delete(key);
    map.set(key, cached);
    inkStampCache.hits++;
    if (typeof inkPerfCount === 'function') inkPerfCount('stampHits');
    return cached;
  }

  const src = erase
    ? inkProceduralTip(1, bucket)
    : inkTintedTip(brush, color, hardness, bucket, false, variant);
  const canvas = document.createElement('canvas');
  canvas.width = bucket;
  canvas.height = bucket;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, bucket, bucket);

  const stamp = { key, canvas, size: bucket, bytes: bucket * bucket * 4 };
  map.set(key, stamp);
  inkStampCache.bytes += stamp.bytes;
  inkStampCache.misses++;
  inkStampCache.built++;
  if (typeof inkPerfCount === 'function') inkPerfCount('stampMisses');
  inkStampEvict();
  return stamp;
}

function inkStampCacheInfo() {
  const total = inkStampCache.hits + inkStampCache.misses;
  return {
    size: inkStampCache.map.size,
    hits: inkStampCache.hits,
    misses: inkStampCache.misses,
    evictions: inkStampCache.evictions,
    built: inkStampCache.built,
    bytes: inkStampCache.bytes,
    mb: Math.round(inkStampCache.bytes / (1024 * 1024) * 10) / 10,
    hitRate: total ? inkStampCache.hits / total : 0,
  };
}

/** Bellek testleri ve profil sıfırlama için atlası boşaltır. */
function inkStampClear() {
  inkStampCache.map.clear();
  inkStampCache.hits = 0;
  inkStampCache.misses = 0;
  inkStampCache.evictions = 0;
  inkStampCache.built = 0;
  inkStampCache.bytes = 0;
}

/* =========================================================
   sert fırçalarda yol (path) çizimi
   ========================================================= */
const INK_PATH_MIN_HARDNESS = 0.85;
const INK_PATH_MAX_PRESSURE_SPREAD = 0.12;

/**
 * Vuruş yol olarak çizilebilir mi?
 * Yalnızca sabit basınçlı, dağıtmasız (scatter yok), sert ve prosedürel
 * fırçalarda. Basınç değişiyorsa incelme (taper) kaybolmasın diye damla
 * yoluna düşülür.
 */
function inkStrokePathEligible(stroke, brush, sizePx) {
  /* Tur 4c: serbest elden oturtulan şekiller (kind='shape' + snapFree)
     yol dalına GİREBİLİR — bunlar kullanıcının çizdiği vuruşun
     dönüştürülmüş hâlidir ve fırça görünümü korunmalı. Reddedilirse
     damla yolu n-root seyreltmesiyle şekli, aynı fırçayla çizilen
     serbest elin (yol dalı, effAlpha = opacity×flow) yarısı saydamda
     bırakıyordu — "şekil oturtunca opaklık azalıyor" bug'ının kökü.
     Araç şekilleri (snapFree'siz) zaten inkDrawShape dalına girer;
     bu değişken onlara dokunmaz. */
  if (!stroke || (stroke.kind !== 'stroke' &&
      !(stroke.kind === 'shape' && stroke.snapFree))) return false;
  if (!(sizePx >= 2)) return false;
  // Yerel uçlar ve vuruş yönünü izleyen damgalar tek quadratic yol ile
  // birebir çizilemez; damla yoluna düşülür. 'circle' (keskin daire) ucu
  // tek stroke() ile birebir çizildiği için yola izin verilir.
  if (brush && brush.tip && brush.tip !== 'circle') return false;
  if (brush && brush.angleFollow) return false;
  if ((stroke.scatter || 0) > 0) return false;
  if ((stroke.flowJitter || 0) > 0) return false;
  if ((stroke.taperStart || 0) > 0 || (stroke.taperEnd || 0) > 0) return false;
  if (brush && brush.kind === 'abr') return false;
  // Dinamik (jitter/yuvarlaklık/çift fırça) tek quadratic yol ile ifade edilemez.
  if (brush) {
    if (brush.dual) return false;
    if (brush.scatterCount > 1 || brush.scatterCountJitter > 0 ||
        brush.noise > 0 || brush.wetEdges > 0 || brush.airbrush ||
        brush.buildUp === false) return false;
    if ((brush.scatterX != null && brush.scatterX !== brush.scatter) ||
        (brush.scatterY != null && brush.scatterY !== brush.scatter)) return false;
    const colorDynamics = brush.colorDynamics || {};
    if (colorDynamics.foregroundBackground || colorDynamics.hueJitter ||
        colorDynamics.saturationJitter || colorDynamics.brightnessJitter ||
        colorDynamics.purity) return false;
    if (Number.isFinite(brush.roundness) && brush.roundness < 0.98) return false;
    const dyn = brush.dynamics;
    if (dyn && (dyn.angleJitter > 0 || dyn.scatterJitter > 0 ||
        dyn.spacingJitter > 0 || dyn.sizeJitter > 0 ||
        dyn.roundnessJitter > 0 || dyn.roundnessMin < 1 ||
        dyn.opacityJitter > 0 || dyn.src === 'random')) return false;
    // flow (doluluk) path'te globalAlpha olarak uygulandığı için yola izin
    // verilir; yalnızca çok düşük flow (neredeyse görünmez) damla yoluna düşer.
    if (Number.isFinite(brush.flow) && brush.flow < 0.08) return false;
    if (Number.isFinite(brush.flowJitter) && brush.flowJitter > 0) return false;
    if (brush.texture) return false;
  }
  // Hız incelmesi veya `velocity` dinamiği varsa boyut yol boyunca değişir;
  // tek sabit lineWidth'li yol bunu ifade edemez → damla yoluna düşülür.
  if ((stroke.speedSize || 0) > 0 || (brush && brush.speedSize > 0)) return false;
  const brushDyn = inkBrushDynamics(brush);
  if (brushDyn.src === 'velocity') return false;
  // Basınç dinamiği (src === 'pressure') path'te ortalama basınçla uygulanır:
  // tek stroke() sabit lineWidth kullanır, bu yüzden birebir değil ama akıcı.
  // Yalnızca boyut aralığı çok genişse (neredeyse 0'dan çok büyüğe) damla yoluna düş.
  if (brushDyn.src === 'pressure' && brushDyn.sizeMin < 0.05) return false;
  const hardness = stroke.tool === 'eraser' ? 1 : Number(stroke.hardness);
  if (!(hardness >= INK_PATH_MIN_HARDNESS)) return false;
  const pts = stroke.points;
  if (!pts || pts.length < 2) return false;
  let min = 1, max = 0;
  for (let i = 0; i < pts.length; i++) {
    // Tuval dışına çıkıp dönülen vuruşta parçalar arasına çizgi çekilmez;
    // tek yol bunu ifade edemez, damla yoluna düşülür.
    if (pts[i].br) return false;
    // Eğimli kalemde damga yassılaşır; tek quadratic yol bunu ifade
    // edemeyeceği için damla yoluna düşülür.
    if ((pts[i].t || 0) > 0.02) return false;
    const p = clamp(pts[i].p, 0, 1);
    if (p < min) min = p;
    if (p > max) max = p;
    if (max - min > INK_PATH_MAX_PRESSURE_SPREAD) return false;
  }
  return true;
}

/**
 * Vuruşu tek bir quadratic yol olarak çizer.
 * @returns {number} işlenen nokta sayısı (damla sayısı yerine)
 */
function inkDrawStrokeAsPath(ctx, stroke, map, sizePx, brush) {
  const pts = [];
  for (let i = 0; i < stroke.points.length; i++) {
    const p = stroke.points[i];
    const q = map(p);
    if (!q) continue;
    pts.push({ x: q.x, y: q.y, p: clamp(p.p, 0.02, 1) });
  }
  if (!pts.length) return 0;

  const erase = stroke.tool === 'eraser';
  const baseAlpha = clamp(stroke.opacity, 0, 1);
  // flow (doluluk) path'te globalAlpha olarak uygulanır; dab yolundaki
  // üst üste binen damlaların oluşturduğu doluluğa yakın görünüm için
  // flow'un küpü alınır (damlı yol ~ flow^1 görsel doluluk üretir).
  const flow = Number.isFinite(stroke.flow) ? stroke.flow
    : (brush && Number.isFinite(brush.flow) ? brush.flow : 1);
  const effAlpha = clamp(baseAlpha * clamp(flow, 0, 1), 0, 1);
  /* K14 · tek geçişte (quadratic yol) üst üste binen damla YOKTUR;
     opaklık doğrusal uygulanır. Önceki `1-(1-α)³` kazancı, damlalı
     yoldaki birikim derdini yola taşımıştı — %8 → ~%22 görürdü. */
  ctx.globalAlpha = effAlpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pts.length === 1) {
    const radius = Math.max(0.35, (sizePx / 2) * (0.18 + 0.82 * pts[0].p));
    const stamp = inkStampFor(brush, stroke.color, stroke.hardness, radius * 2, erase);
    ctx.drawImage(stamp.canvas, pts[0].x - radius, pts[0].y - radius, radius * 2, radius * 2);
    return 1;
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
    // Orta noktalardan geçen quadratic zincir: köşeli girdi bile akıcı kalır.
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
  return pts.length;
}

/* =========================================================
   kirli dikdörtgen defteri (dirty rect)
   ========================================================= */
const inkDirty = {
  layers: new Map(),   // layerId -> { full, rect }
  raf: 0,
  flushes: 0,
  marks: 0,
};

function inkUnionRect(a, b) {
  if (!a) return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

function inkRectOverlaps(a, b) {
  return !!a && !!b &&
    !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

/**
 * Bir katmanın şu dünya dikdörtgenini yeniden birleştirmesini ister.
 * `full` verilirse katmanın tamamı yeniden raster edilir.
 */
function inkMarkLayerDirty(layerOrId, rect, full = false) {
  const id = typeof layerOrId === 'string' ? layerOrId : (layerOrId && layerOrId.id);
  if (!id) return;
  let entry = inkDirty.layers.get(id);
  if (!entry) {
    entry = { full: false, rect: null };
    inkDirty.layers.set(id, entry);
  }
  if (full) entry.full = true;
  else if (rect && rect.w > 0 && rect.h > 0) entry.rect = inkUnionRect(entry.rect, rect);
  inkDirty.marks++;
  inkScheduleDirtyFlush();
}

function inkScheduleDirtyFlush() {
  if (inkDirty.raf) return;
  inkDirty.raf = requestAnimationFrame(() => {
    inkDirty.raf = 0;
    inkFlushDirtyLayers();
  });
}

/** Bekleyen kirli bölgeleri iptal eder (geri al / pano değişimi). */
function inkDirtyReset() {
  if (inkDirty.raf) {
    cancelAnimationFrame(inkDirty.raf);
    inkDirty.raf = 0;
  }
  inkDirty.layers.clear();
}

/** Bekleyen kirli bölgeleri hemen işler (rAF beklemeden). */
function inkFlushDirtyLayers() {
  if (inkDirty.raf) {
    cancelAnimationFrame(inkDirty.raf);
    inkDirty.raf = 0;
  }
  if (!inkDirty.layers.size) return;
  const pending = [...inkDirty.layers];
  inkDirty.layers.clear();
  inkDirty.flushes++;
  if (typeof inkPerfCount === 'function') inkPerfCount('dirtyFlushes');
  const t0 = performance.now();
  for (const [id, entry] of pending) {
    const layer = inkLayerById(id);
    if (!layer) continue;
    if (entry.full || !entry.rect) {
      inkRerenderLayer(id);
      continue;
    }
    inkRedrawLayerRect(layer, entry.rect);
  }
  if (typeof inkPerfSpan === 'function') inkPerfSpan('dirty', performance.now() - t0);
  // Kirli bölgeler işlendi: editör açıksa görünümü tazele.
  if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
}

/** Bir katmanda yalnızca verilen dünya dikdörtgenini yeniden çizer. */
function inkRedrawLayerRect(layer, rect) {
  if (!layer || !rect || rect.w <= 0 || rect.h <= 0) return;
  if (layer.kind === 'attached') inkRedrawAttachedRect(layer, rect);
  else inkRedrawGlobalRect(layer, rect);
  // Pikseller doğrudan tazelendi: kırpma grubu raster önbelleği üye
  // izelesini sürümü (gen) değişmeden yeniden kullanmasın.
  if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
  if (typeof inkPerfCount === 'function') inkPerfCount('dirtyRedraws');
}

/** Dünya dikdörtgenini, döndürülmüş olabilecek görselin piksel kutusuna çevirir.
    Ölçek `it.w/h` değil, gerçek tuval çözünürlüğüdür: bağlı katman tuvali
    görselin ekran boyutundan farklı (genelde daha yüksek) çözünürlükte olabilir. */
function inkWorldRectToLocalPixels(layer, rect, canvas) {
  const it = inkItemForLayer(layer);
  if (!it || !it.w || !it.h) return null;
  const c = canvas || inkRuntime.itemCanvases.get(layer.id);
  if (!c) return null;
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of corners) {
    const local = inkWorldToLocal(layer, { x, y });
    if (!local) return null;
    minX = Math.min(minX, local.x); minY = Math.min(minY, local.y);
    maxX = Math.max(maxX, local.x); maxY = Math.max(maxY, local.y);
  }
  return {
    x: minX * c.width, y: minY * c.height,
    w: (maxX - minX) * c.width, h: (maxY - minY) * c.height,
  };
}

function inkRedrawAttachedRect(layer, rect) {
  const existed = inkRuntime.itemCanvases.has(layer.id);
  const pendingRebuild = inkRuntime.dirtyLayers.has(layer.id);
  const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
  if (!canvas) return;
  // Tuval yeni oluşturulduysa veya tam yeniden kurulum bekliyorsa kısmi
  // çizim eksik kalır: katmanı bir kez bütünüyle rasterle.
  if (!existed || pendingRebuild) {
    if (typeof inkRebuildItemLayer === 'function') inkRebuildItemLayer(layer);
    return;
  }
  const box = inkWorldRectToLocalPixels(layer, rect, canvas);
  if (!box) return;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  const x = Math.max(0, Math.floor(box.x) - 1);
  const y = Math.max(0, Math.floor(box.y) - 1);
  const w = Math.min(canvas.width, Math.ceil(box.x + box.w) + 1) - x;
  const h = Math.min(canvas.height, Math.ceil(box.y + box.h) + 1) - y;
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.clearRect(x, y, w, h);
  // Kısmi redraw bake'lenmiş rasterı (merge-down / flatten katmanı) ve
  // maskeyi hiç işlemiyordu: bake'li katmandaki kısmi tazelme dikdörtgeni
  // silip vuruşsuz boş bırakıyordu. Bake önce, vuruşlar üstüne, maske en
  // sonda (rebuild hattındaki sıra birebir aynıdır).
  const baked = inkBakedRasterSource(layer);
  if (baked) ctx.drawImage(baked, 0, 0, canvas.width, canvas.height);
  for (const stroke of layer.strokes) {
    const b = inkStrokeWorldBounds(layer, stroke);
    if (!b || !inkRectOverlaps(b, rect)) continue;
    inkDrawStrokeOnContext(ctx, stroke, {
      mapPoint: p => ({ x: p.x * canvas.width, y: p.y * canvas.height }),
      sizePx: Math.max(0.5, stroke.size * canvas.width),
      pointScale: { x: canvas.width, y: canvas.height },
    });
  }
  // FAZ 1B (Layer Mask): kısmi kutu içinde maske çarpımı.
  if (layer.mask && typeof inkApplyMaskRectToItemContext === 'function') {
    if (!inkApplyMaskRectToItemContext(layer, ctx, canvas, { x, y, w, h })) {
      // Maske henüz çözülmedi: kısmi kutu yerine tam kurulum.
      ctx.restore();
      if (typeof inkRebuildItemLayer === 'function') inkRebuildItemLayer(layer);
      return;
    }
  }
  ctx.restore();
  inkRuntime.dirtyLayers.delete(layer.id);
}

function inkRedrawGlobalRect(layer, rect) {
  // Katmanın hiç karosu yoksa (yükleme sonrası ilk çizim) kısmi çizim
  // diğer vuruşları atlar; bir kez tam kurulum yap.
  let hasTiles = false;
  for (const tile of inkRuntime.tiles.values()) {
    if (tile.layerId === layer.id) { hasTiles = true; break; }
  }
  if (!hasTiles && typeof inkRebuildGlobalLayer === 'function') {
    inkRebuildGlobalLayer(layer);
    return;
  }

  const x0 = Math.floor(rect.x / INK_TILE_SIZE);
  const y0 = Math.floor(rect.y / INK_TILE_SIZE);
  const x1 = Math.floor((rect.x + rect.w) / INK_TILE_SIZE);
  const y1 = Math.floor((rect.y + rect.h) / INK_TILE_SIZE);

  // Aday vuruşları bir kez süz: karo başına tüm listeyi taramayalım.
  // Yalnızca kirli dikdörtgenle kesişen vuruşlar o bölgedeki pikselleri
  // etkileyebilir; dışarıdaki vuruşların piksellerine dokunulmaz.
  const candidates = [];
  for (const stroke of layer.strokes) {
    const b = inkStrokeWorldBounds(layer, stroke);
    if (!b || !inkRectOverlaps(b, rect)) continue;
    candidates.push({ stroke, bounds: b });
  }

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const tileRect = {
        x: tx * INK_TILE_SIZE, y: ty * INK_TILE_SIZE,
        w: INK_TILE_SIZE, h: INK_TILE_SIZE,
      };
      // Karonun tamamı kirli bölgenin içindeyse tüm karoyu tazeleyebiliriz;
      // aksi hâlde yalnızca kesişimi temizle, karonun geri kalanına dokunma.
      const clipped = {
        x: Math.max(rect.x, tileRect.x),
        y: Math.max(rect.y, tileRect.y),
        right: Math.min(rect.x + rect.w, tileRect.x + tileRect.w),
        bottom: Math.min(rect.y + rect.h, tileRect.y + tileRect.h),
      };
      if (clipped.right <= clipped.x || clipped.bottom <= clipped.y) continue;
      const coversTile = clipped.x === tileRect.x && clipped.y === tileRect.y
        && clipped.right === tileRect.x + tileRect.w
        && clipped.bottom === tileRect.y + tileRect.h;

      const hits = candidates.filter(c => inkRectOverlaps(c.bounds, tileRect));
      if (!hits.length && coversTile) {
        // Vuruş bu karodan çıkmış: eski pikselleri bırakma.
        const key = inkTileKey(layer.id, tx, ty);
        const stale = inkRuntime.tiles.get(key);
        if (stale) {
          stale.canvas.remove();
          inkRuntime.tiles.delete(key);
        }
        continue;
      }
      if (!hits.length && !inkRuntime.tiles.get(inkTileKey(layer.id, tx, ty))) continue;

      const tile = inkEnsureTile(layer, tx, ty);
      const ctx = tile.canvas.getContext('2d', { colorSpace: 'srgb' });
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        clipped.x - tileRect.x, clipped.y - tileRect.y,
        clipped.right - clipped.x, clipped.bottom - clipped.y,
      );
      ctx.clip();
      ctx.clearRect(
        clipped.x - tileRect.x, clipped.y - tileRect.y,
        clipped.right - clipped.x, clipped.bottom - clipped.y,
      );
      for (const entry of hits) {
        inkDrawStrokeOnContext(ctx, entry.stroke, {
          mapPoint: p => ({
            x: p.x - tx * INK_TILE_SIZE,
            y: p.y - ty * INK_TILE_SIZE,
          }),
          sizePx: Math.max(0.5, entry.stroke.size),
        });
      }
      ctx.restore();
      inkApplyTileStyle(tile, layer);
    }
  }
}
