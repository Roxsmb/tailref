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
'use strict';

const inkDom = {
  host: null,
  gizmo: null,
};

/* =========================================================
   DOM iskeleti
   ========================================================= */
function inkEnsureHost() {
  if (inkDom.host && inkDom.host.isConnected) return inkDom.host;
  let host = document.getElementById('inkWorld');
  if (!host) {
    host = document.createElement('div');
    host.id = 'inkWorld';
    world.appendChild(host);
  }
  inkDom.host = host;
  return host;
}

function inkEnsureGizmo() {
  if (inkDom.gizmo && inkDom.gizmo.isConnected) return inkDom.gizmo;
  let g = document.getElementById('inkGizmo');
  if (!g) {
    g = document.createElement('div');
    g.id = 'inkGizmo';
    g.hidden = true;
    g.innerHTML = [
      '<i class="inkGizmoBox" data-ink-gizmo-body="1"></i>',
      '<i class="inkGizmoHandle" data-ink-handle="nw"></i>',
      '<i class="inkGizmoHandle" data-ink-handle="n"></i>',
      '<i class="inkGizmoHandle" data-ink-handle="ne"></i>',
      '<i class="inkGizmoHandle" data-ink-handle="e"></i>',
      '<i class="inkGizmoHandle" data-ink-handle="se"></i>',
      '<i class="inkGizmoHandle" data-ink-handle="s"></i>',
      '<i class="inkGizmoHandle" data-ink-handle="sw"></i>',
      '<i class="inkGizmoHandle" data-ink-handle="w"></i>',
      '<i class="inkGizmoRot" data-ink-handle="rot"></i>',
    ].join('');
    world.appendChild(g);
  }
  inkDom.gizmo = g;
  return g;
}

/* =========================================================
   görsele bağlı katman tuvalleri
   ========================================================= */
function inkPickAttachedBitmapSize(it) {
  const w = Math.max(1, it.w || 1);
  const h = Math.max(1, (it.h || 1));
  /* Tavan DPR'ye bağlı: 100% yakınlaştırmada katman pikseli ekrandaki
     fiziksel pikseli karşılasın (FAZ1-6). Eski sabit 2048 tavanı büyük
     pencerelerde keskinliği kaybediyordu. Bellek koruması: üst tavan
     2800px (2800² ≈ 7,9MP ≈ 32MB RGBA) ve k ≤ 2,5·dpr. */
  const dpr = clamp(Math.min(window.devicePixelRatio || 1, 2), 1, 2);
  const wantSide = Math.round(Math.max(w, h) * dpr);
  const maxSide = Math.min(2800, Math.max(1800, wantSide));
  let k = Math.min(2.5 * dpr, maxSide / Math.max(w, h));
  k = Math.max(0.4, k);
  return {
    w: clamp(Math.round(w * k), 64, maxSide),
    h: clamp(Math.round(h * k), 64, maxSide),
  };
}

function inkEnsureItemCanvas(layer) {
  if (!layer || layer.kind !== 'attached') return null;
  const it = getItem(layer.ownerId);
  if (!it) return null;
  const el = elMap.get(it.id);
  if (!el) return null;

  let canvas = inkRuntime.itemCanvases.get(layer.id);
  if (canvas && canvas.parentNode !== el) {
    canvas.remove();
    canvas = null;
  }
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'inkLayerCanvas';
    canvas.dataset.inkLayer = layer.id;
    canvas.setAttribute('aria-hidden', 'true');
    if (!layer.pxW || !layer.pxH) {
      const size = inkPickAttachedBitmapSize(it);
      layer.pxW = size.w;
      layer.pxH = size.h;
    }
    canvas.width = layer.pxW;
    canvas.height = layer.pxH;
    /* DÜZELTME (profiler bulgusu): bu kanvastan undo capture + küçük resim
       düzeltmeleri için düzenli getImageData okunuyor; GPU-bereketli
       kanvasta büyük okumalar okuma başına ~150-250 ms tutuyordu (bütün
       texture geri okuma senkonu). willReadFrequently kanıvası
       yazılım-hafızaya alır: okumalar ~10× ucuz, commit bake'i de
       paylaşılan yazılım rasterında çalışır. İlk getContext bu kanvastan
       yapılır; sonraki getContext çağrıları aynı bağlamı döndürür. */
    canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    inkRuntime.itemCanvases.set(layer.id, canvas);
    inkRuntime.dirtyLayers.add(layer.id);
    // media'dan sonra, tutamaçlardan önce: çizim görselin üstünde kalsın.
    const handles = el.querySelector(':scope > .handles');
    if (handles) el.insertBefore(canvas, handles);
    else el.appendChild(canvas);
  }

  const attached = inkState().layers.filter(l => l.kind === 'attached' && l.ownerId === layer.ownerId);
  const idx = Math.max(0, attached.findIndex(l => l.id === layer.id));
  canvas.style.zIndex = String(2 + idx);
  canvas.style.opacity = layer.visible ? String(layer.opacity) : '0';
  canvas.style.mixBlendMode = layer.blend === 'normal' ? 'normal' : layer.blend;
  canvas.style.display = layer.visible && layer.opacity > 0.001 ? 'block' : 'none';
  return canvas;
}

/* =========================================================
   pişmiş raster (merge-down / flatten bake) önbelleği
   ========================================================= */
/** Katmana pişirilmiş rasterın çözülmüş tuvali. dataURL gözden Image'a
 *  çözülür; cache katman id'sine bağlanır, src uzunluğu belirteç olarak
 *  kullanılır. Çözüm tamamlanana dek null döner (ilk kurulum bir kare
 *  vuruşları oynatır, hazır olunca kire-geçiştirilir). */
const inkBakedRasterCache = new Map();

function inkBakedRasterSource(layer) {
  if (!layer || !layer.baked || !layer.baked.src) return null;
  const baked = layer.baked;
  const hit = inkBakedRasterCache.get(layer.id);
  if (hit && hit.len === baked.src.length
      && hit.w === baked.w && hit.h === baked.h) {
    return hit.canvas;
  }
  const holder = {
    len: baked.src.length, w: baked.w, h: baked.h, canvas: null,
  };
  inkBakedRasterCache.set(layer.id, holder);
  const img = new Image();
  img.onload = () => {
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, baked.w);
    tmp.height = Math.max(1, baked.h);
    tmp.getContext('2d', { colorSpace: 'srgb' }).drawImage(img, 0, 0);
    holder.canvas = tmp;
    // Çözüm bitti: katmanı yeniden kur (pişmiş iş sayılandan mı üstün).
    if (inkRuntime && inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.add(layer.id);
    if (typeof inkRerenderLayer === 'function') {
      requestAnimationFrame(() => {
        if (typeof inkLayerById === 'function' && inkLayerById(layer.id)) {
          inkRerenderLayer(layer.id);
        }
      });
    }
  };
  img.src = baked.src;
  return null;
}

/** Bake anında çözülmüş tuvali önbelleğe koy: merge-down / flatten aynı
 *  karede rebuild tetikler; pişmiş görüntü o karede hazır olmalıdır. */
function inkBakedRasterPrime(layerId, src, w, h, canvas) {
  if (!layerId || !src || !canvas) return;
  inkBakedRasterCache.set(layerId, {
    len: src.length, w, h, canvas,
  });
}

/* =========================================================
   FAZ 1B — katman maskesi raster önbelleği
   (baked düzleminin birebir kopyası; ayrı ömür: mask, baked olmayan
   katmanda da var olabilir)
   ========================================================= */
const inkMaskRasterCache = new Map();

/** Katman maskesinin çözülmüş tuvali. Baked yoluyla aynı desen: dataURL
 *  Image'a çözülür, cache katman id'sine + src uzunluğuna bağlanır;
 *  çözüm bitince katman yeniden rasterlanır. */
function inkMaskRasterSource(layer) {
  if (!layer || !layer.mask || !layer.mask.src) return null;
  const mask = layer.mask;
  const hit = inkMaskRasterCache.get(layer.id);
  if (hit && hit.len === mask.src.length
      && hit.w === mask.w && hit.h === mask.h) {
    return hit.canvas;
  }
  const holder = {
    len: mask.src.length, w: mask.w, h: mask.h, canvas: null,
  };
  inkMaskRasterCache.set(layer.id, holder);
  const img = new Image();
  img.onload = () => {
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, mask.w);
    tmp.height = Math.max(1, mask.h);
    tmp.getContext('2d', { colorSpace: 'srgb' }).drawImage(img, 0, 0, tmp.width, tmp.height);
    holder.canvas = tmp;
    // Maske çözüldü: katmanı yeniden kur (görünür raster maskeyi taşısın).
    if (inkRuntime && inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.add(layer.id);
    if (typeof inkRerenderLayer === 'function') {
      requestAnimationFrame(() => {
        if (typeof inkLayerById === 'function' && inkLayerById(layer.id)) {
          inkRerenderLayer(layer.id);
        }
      });
    }
  };
  img.src = mask.src;
  return null;
}

/** Maske değişiminde cache'i aynı karede doldur (senkron görünüm). */
function inkMaskRasterPrime(layerId, src, w, h, canvas) {
  if (!layerId || !src || !canvas) return;
  inkMaskRasterCache.set(layerId, {
    len: src.length, w, h, canvas,
  });
}

/** Rebuild hattında maskenin TAM tuval uygulaması: destination-in —
 *  katman alfa × maske alfa (a_o = a_d × a_mask). */
function inkApplyMaskToItemContext(layer, ctx, canvas) {
  const mask = inkMaskRasterSource(layer);
  if (!mask) return false;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  return true;
}

/** Kısmi (bölge) boyama hattında maskenin yalnızca kutu içindeki
 *  uygulaması. Kutu {x,y,w,h} tuval pikselinde; maskenin boyanı ile
 *  birebir piksel çarpımı eşdeğerdir. Maske çözümsüzse false döner →
 *  çağıran tam katman yeniden rasterı tetikler. */
function inkApplyMaskRectToItemContext(layer, ctx, canvas, box) {
  const mask = inkMaskRasterSource(layer);
  if (!mask) return false;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  return true;
}

/* =========================================================
   OPT (torture-max bulgusu): vuruş-baza cache
   ---------------------------------------------------------
   undo/redo 'rebuild' bir katmanın TÜM vuruşlarını her kez
   sıfırdan damgalar; smudge/airbrush dab üretimi pahalıdır
   (8K'da tek rebuild 974 ms ölçüldü). Vuruşlar committed'legi
   değişmez: baked raster + vuruşlar (MASKESİZ) bir kez tuvale
   damgalanıp önbelleğe alınır; sonraki rebuild'ler bunu blit
   edip yalnız maske alfa'yı uygular. Parmak izi: tuval boyu +
   baked src uzunluğu + vuruş adedi + pozisyon-duyarlı hash
   toplamı. LRU; toplam alan bütçesi aşılırsa en yaşlı düşer.
   ========================================================= */
const inkStrokeBase = { map: new Map(), max: 4, areaMax: 96000000 };

/* Tek vuruşun sıra-duyarlı katkısı: hash'i × (i+1). */
function inkStrokeBaseVal(stroke, i) {
  if (!stroke) return 0;
  const h = Number(inkHashStroke(stroke).split(':')[0]) || 0;
  return (h * (i + 1)) % 1073741824;
}

/* Tek geçişte toplam toplam + ulaşıldıysa lieste (prefix) toplamı. */
function inkStrokeBaseScan(layer, eLen) {
  const strokes = layer.strokes;
  let total = 0, prefix = null;
  for (let i = 0; i < strokes.length; i++) {
    total = (total + inkStrokeBaseVal(strokes[i], i)) % 1073741824;
    if (eLen != null && i + 1 === eLen) prefix = total;
  }
  return { total, prefix };
}

/* Cache girdisi: { canvas, w, h, sum, len, bakedKey }.
   Baked anahtarı çözülmüş tuvalin NİTELİĞİNDEN gelir: inkBakedRasterCache
   aynı src'de AYNI tuvali döndürür; bake değişince yeni tuval doğar →
   anahtar değişir → cache dürüstçe düşer. */
const inkStrokeBaseBakedIds = new WeakMap();
let inkStrokeBaseBakedSeq = 0;
function inkStrokeBaseKey(baked) {
  if (!baked) return 'n';
  let id = inkStrokeBaseBakedIds.get(baked);
  if (!id) {
    id = ++inkStrokeBaseBakedSeq;
    inkStrokeBaseBakedIds.set(baked, id);
  }
  return 'b' + id;
}

function inkStrokeBaseEvict() {
  let total = 0;
  for (const e of inkStrokeBase.map.values()) total += e.w * e.h;
  while (inkStrokeBase.map.size > inkStrokeBase.max ||
         (inkStrokeBase.map.size > 1 && total > inkStrokeBase.areaMax)) {
    /* Map ekleme sırası = yaşlılık; hit yeniden eklenerek tazelenir. */
    const oldest = inkStrokeBase.map.keys().next().value;
    const e = inkStrokeBase.map.get(oldest);
    total -= e.w * e.h;
    inkStrokeBase.map.delete(oldest);
  }
}

/** Editör kapanışında tüm baza cache serbest kalır. */
function inkStrokeBasePoolClear() {
  inkStrokeBase.map.clear();
  inkStrokeStamp.map.clear();   // Tur 5p-A: vuruş damga önbelleği de
  inkStrokeStampPool.length = 0;
  inkStrokeStampWarm.pending.clear();
}

/** Seciyonel dab üretimi: vuruşları verilen index'ten başı tam boyar. */
function inkStrokeBaseDrawRange(ctx, layer, from, w, h) {
  const strokes = layer.strokes;
  for (let i = from; i < strokes.length; i++) {
    inkDrawStrokeOnContext(ctx, strokes[i], {
      mapPoint: p => ({ x: p.x * w, y: p.y * h }),
      sizePx: Math.max(0.5, strokes[i].size * w),
      pointScale: { x: w, y: h },
    });
  }
}

function inkRebuildItemLayer(layer) {
  const __t0 = performance.now();
  const t0 = performance.now();
  if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(layer.id, 'rebuild');
  const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // FAZ 1 (piksel-gerçek merge-down): katsa önce pişmiş raster birebir
  // ölçeklenerek basılır; yeni vuruşlar üstüne normal akışta eklenir.
  const baked = inkBakedRasterSource(layer);
  // OPT: baza cache — baked+vuruşlar maskesiz tek tuvalde.
  // ÜÇ yol: (1) tam hit → blit; (2) ekleme → blit + yalnız YENİ
  // vuruşları damga (undo/redo + commit sonrası rebuild);
  // (3) miss → tam damga + cache yenile.
  const bKey = inkStrokeBaseKey(baked);
  const e = inkStrokeBase.map.get(layer.id);
  const boyutUyum = e && e.w === canvas.width && e.h === canvas.height &&
    e.bakedKey === bKey;
  const scan = boyutUyum ? inkStrokeBaseScan(layer, e.len) : null;
  const tamHit = boyutUyum && scan.total === e.sum &&
    layer.strokes.length === e.len;
  const ekleme = !tamHit && boyutUyum && scan.prefix === e.sum &&
    layer.strokes.length > e.len;
  if (tamHit) {
    if (typeof inkPerfCount === 'function') inkPerfCount('rebuildHit');
    inkStrokeBase.map.delete(layer.id);
    inkStrokeBase.map.set(layer.id, e);   // LRU tazele
    ctx.drawImage(e.canvas, 0, 0, canvas.width, canvas.height);
  } else if (ekleme) {
    if (typeof inkPerfCount === 'function') inkPerfCount('rebuildAppend');
    inkStrokeBase.map.delete(layer.id);
    inkStrokeBase.map.set(layer.id, e);
    const ectx = e.canvas.getContext('2d', { colorSpace: 'srgb' });
    ctx.drawImage(e.canvas, 0, 0, canvas.width, canvas.height);
    /* Ekleme anındaki YENİ vuruşlar: yalnızca onları damgala (tek dab
       geçişi), sonra piksel kutusunu ana tuvalden cache'e kopyala. */
    let bx = canvas.width, by = canvas.height, bx1 = 0, by1 = 0;
    for (let i = e.len; i < layer.strokes.length; i++) {
      const b = inkStrokePixelBox(layer.strokes[i], canvas, 2);
      if (!b) continue;
      bx = Math.min(bx, b.x); by = Math.min(by, b.y);
      bx1 = Math.max(bx1, b.x + b.w); by1 = Math.max(by1, b.y + b.h);
    }
    inkStrokeBaseDrawRange(ctx, layer, e.len, canvas.width, canvas.height);
    if (bx1 > bx && by1 > by) {
      const cx = Math.max(0, Math.floor(bx)), cy = Math.max(0, Math.floor(by));
      const cw = Math.min(canvas.width, Math.ceil(bx1)) - cx;
      const chh = Math.min(canvas.height, Math.ceil(by1)) - cy;
      if (cw > 0 && chh > 0) {
        ectx.save();
        ectx.setTransform(1, 0, 0, 1, 0, 0);
        ectx.drawImage(canvas, cx, cy, cw, chh, cx, cy, cw, chh);
        ectx.restore();
      }
    }
    e.sum = scan.total;
    e.len = layer.strokes.length;
  } else {
    if (typeof inkPerfCount === 'function') {
      inkPerfCount('rebuildMiss');
      if (!e) inkPerfCount('rebuildMissNew');
    }
    const cache = (e && e.w === canvas.width && e.h === canvas.height)
      ? e.canvas : document.createElement('canvas');
    cache.width = canvas.width;
    cache.height = canvas.height;
    const cctx = cache.getContext('2d', { colorSpace: 'srgb' });
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, cache.width, cache.height);
    if (baked) cctx.drawImage(baked, 0, 0, canvas.width, canvas.height);
    for (const stroke of layer.strokes) {
      inkDrawStrokeOnContext(cctx, stroke, {
        mapPoint: p => ({ x: p.x * canvas.width, y: p.y * canvas.height }),
        sizePx: Math.max(0.5, stroke.size * canvas.width),
        pointScale: { x: canvas.width, y: canvas.height },
      });
    }
    inkStrokeBase.map.set(layer.id,
      { canvas: cache, w: canvas.width, h: canvas.height,
        bakedKey: bKey, sum: scan ? scan.total : inkStrokeBaseScan(layer, null).total,
        len: layer.strokes.length });
    inkStrokeBaseEvict();
    ctx.drawImage(cache, 0, 0, canvas.width, canvas.height);
  }
  // FAZ 1B (Layer Mask): raster hazır; maske alfa'sıyla destination-in.
  // Klip zinciri/grup rasterı bu tuvali okuduğu için maske tüm
  // ekran/export/önbellek yollarına tek noktadan girer.
  if (layer.mask) inkApplyMaskToItemContext(layer, ctx, canvas);
  inkRuntime.dirtyLayers.delete(layer.id);
  // Kırpma grubu önbellekleri bu raster sürümüne bağlı (gen sayacı).
  if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
  // Açık çizim editörü varsa katman rasterı değişti: bir sonraki karede çiz.
  if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
  if (typeof inkPerfSpan === 'function') inkPerfSpan('rebuild', performance.now() - t0);
}

/** Vuruşun piksel sınırları (box {x,y,w,h}). Noktalar normalize [0..1];
 *  boyut tuvalse piksele ölçeklenir. Negatif/taşanlar daha sonra kırpılır. */
function inkStrokePixelBox(stroke, canvas, padFactor = 2) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of stroke.points) {
    const x = p.x * canvas.width, y = p.y * canvas.height;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  const pad = Math.max(4, Math.max(0.5, stroke.size * canvas.width) * padFactor);
  return {
    x: minX - pad, y: minY - pad,
    w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2,
  };
}

/** Kutuların kesişimi (kesişme 0'sa false). */
function inkBoxIntersectsBox(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w
    && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* =========================================================
   Tur 5p-A: vuruş-başı damga önbelleği (bölgesel kurulum için)
   ÖLÇÜM (A3 solo koşum): maskeli commit'te inkRebuildItemLayerRegion
   ~9-12 ms/vuruş; maliyetin %97'si KESİŞEN vuruşların yeniden
   damgalanması (rcStamp ailesi — FAZ 7.U ölçümüyle aynı pay).
   DOĞRULUK: K15 dual-buffer her vuruşu izole scratch'te üretip TEK
   geçişte stroke.opacity ile kompozitler → vuruşun raster'ı hedef
   içerikten bağımsızdır. source-over birleşmeliği (associativity)
   gereği izole ön-render + tek blit == doğrudan damgalama (FAZ 7.M'nin
   "noktasal kompozisyon" gerekçesinin aynı sonucu). Taşınamayanlar
   önbellek dışı: smudge (hedef içeriği okur), erase (destination-out),
   lockAlpha (source-atop), fill/gradient/liquify (tam-tuval etkisi).
   Geçersizlik: vuruş künyesi (inkHashStroke) + tuval boyutu + sym;
   vuruşlar commit sonrası değişmez (inkStrokeBase'in dayandığı sözleşme).
   ========================================================= */
const inkStrokeStamp = { map: new Map(), max: 6, areaMax: 96000000 };

function inkStrokeStampCacheable(stroke) {
  if (!stroke || !stroke.id || typeof inkHashStroke !== 'function') return false;
  if (stroke.tool === 'eraser' || stroke.lockAlpha) return false;
  const k = stroke.kind;
  return k !== 'fill' && k !== 'gradient' && k !== 'smudge' && k !== 'liquify';
}

function inkStrokeStampEvict() {
  let total = 0;
  for (const e of inkStrokeStamp.map.values()) total += e.w * e.h;
  while (inkStrokeStamp.map.size > inkStrokeStamp.max ||
         (inkStrokeStamp.map.size > 1 && total > inkStrokeStamp.areaMax)) {
    /* Map ekleme sırası = yaşlılık; hit yeniden eklenerek tazelenir. */
    const oldest = inkStrokeStamp.map.keys().next().value;
    const e = inkStrokeStamp.map.get(oldest);
    total -= e.w * e.h;
    inkStrokeStamp.map.delete(oldest);
    /* Tur 5p-A: tahsil maliyeti büyük — kovulan tuval havuza döner. */
    if (inkStrokeStampPool.length < 3) inkStrokeStampPool.push(e.canvas);
  }
}

const inkStrokeStampPool = [];

/** Vuruşun izole raster'ı: bölge kurulumunda damga yerine tek blit.
 *  Kutu padFactor 4 (dinamik/scatter taşması payı) + tuval sınırına
 *  kırpılır — kanvas dışı mürekkep zaten görünmez. */
function inkStrokeStampEntry(stroke, canvas, sb) {
  const key = stroke.id;
  const hash = inkHashStroke(stroke);
  const sym = stroke.sym || 'off';
  let e = inkStrokeStamp.map.get(key);
  if (e && e.cw === canvas.width && e.ch === canvas.height &&
      e.hash === hash && e.sym === sym) {
    inkStrokeStamp.map.delete(key);
    inkStrokeStamp.map.set(key, e);   // LRU tazele
    return e;
  }
  if (e) inkStrokeStamp.map.delete(key);
  const big = inkStrokePixelBox(stroke, canvas, 4);
  let x = Math.max(0, Math.floor(big.x));
  let y = Math.max(0, Math.floor(big.y));
  let w = Math.min(canvas.width, Math.ceil(big.x + big.w)) - x;
  let h = Math.min(canvas.height, Math.ceil(big.y + big.h)) - y;
  if (w <= 0 || h <= 0) return null;
  /* Tur 5p-A: büyük tahsisten kaçın — havuzdaki tuvali yeniden
     boyutlandır (width/height ataması içeriği temizler). */
  let cache = inkStrokeStampPool.pop() || null;
  if (!cache) cache = document.createElement('canvas');
  if (cache.width !== w || cache.height !== h) {
    cache.width = w;
    cache.height = h;
  }
  const cctx = cache.getContext('2d', { colorSpace: 'srgb' });
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.globalAlpha = 1;
  cctx.globalCompositeOperation = 'source-over';
  inkDrawStrokeOnContext(cctx, stroke, {
    mapPoint: p => ({ x: p.x * canvas.width - x, y: p.y * canvas.height - y }),
    sizePx: Math.max(0.5, stroke.size * canvas.width),
    pointScale: { x: canvas.width, y: canvas.height },
  });
  e = { canvas: cache, x, y, w, h, cw: canvas.width, ch: canvas.height,
        hash, sym };
  inkStrokeStamp.map.set(key, e);
  inkStrokeStampEvict();
  return e;
}

/* Tur 5p-A: commit'in doğrudan damgaladığı yeni vuruşun önbellek
   girişi idle'da kurulur — aynı damga işi, kritik yol dışında.
   Sonraki bölge kurulumları blit eder. Aktif çizim varsa ertelenir
   (idle damgası kare düşürmesin). */
const inkStrokeStampWarm = { pending: new Set() };

function inkStrokeStampRunWarm(layerId, strokeId) {
  if (!inkStrokeStampWarm.pending.delete(strokeId)) return;
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId) : null;
  const stroke = layer && Array.isArray(layer.strokes)
    ? layer.strokes.find(s => s && s.id === strokeId) : null;
  if (!stroke || !inkStrokeStampCacheable(stroke)) return;
  if (inkStrokeStamp.map.has(strokeId)) return;
  /* Aktif çizim sürüyorsa yeniden planla — 9-10 ms'lik damga bir
     kareyi düşürmesin. */
  if (typeof inkEditorUi !== 'undefined' && inkEditorUi && inkEditorUi.stroke) {
    inkStrokeStampScheduleWarm(layer, stroke);
    return;
  }
  const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
  if (!canvas) return;
  const sb = inkStrokePixelBox(stroke, canvas);
  if (sb) inkStrokeStampEntry(stroke, canvas, sb);
}

function inkStrokeStampScheduleWarm(layer, stroke) {
  if (!stroke || !stroke.id || inkStrokeStampWarm.pending.has(stroke.id)) return;
  inkStrokeStampWarm.pending.add(stroke.id);
  const calistir = () => inkStrokeStampRunWarm(layer.id, stroke.id);
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(calistir, { timeout: 1500 });
  } else {
    setTimeout(calistir, 150);
  }
}

/* FAZ 7.M (profiler bulgusu): maskeli katman commit'i TAM rebuild yerine
   artık bölgesel kurulum kullanır:
     • A3 ölçümü: maskeli vuruş başına inkRerenderLayer ~177 ms (tam tuval +
       tüm vuruş tekrarı) — 4K maskede çizim saniyenin yarısını dondurur.
     • Doğru yarıda kesme mümkün: source-over kompozisyon NOKTASALDIR —
       bir pikselin son değeri yalnız aynı pikseli boyayan vuruşlara ve
       SIRALARI bağlı ama komşu piksellere değil. Bu nedenle "baked bölge
       kesiti + kesişen vuruşların sıralı tekrarı + bölge maskesi" tam
       kurulumun o bölgeyle BİREBİR piksel eşidir.
     • Maske çözümsüzse (yükleniyor) false döner → çağıran tam kurulum
       tetikler (worker hattındaki desenin aynısı). */
function inkRebuildItemLayerRegion(layer, box, skipStrokeId) {
  const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
  if (!canvas || !layer) return false;
  // kutuyu tuvale kırp
  const bx = Math.max(0, Math.floor(box.x));
  const by = Math.max(0, Math.floor(box.y));
  const bw = Math.min(canvas.width, Math.ceil(box.x + box.w)) - bx;
  const bh = Math.min(canvas.height, Math.ceil(box.y + box.h)) - by;
  if (bw <= 0 || bh <= 0) return true;
  /* NOT: epoch bump'i çağıran yönetir (commit hattı bölgeyi taşır). */
  const t0 = performance.now();
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  ctx.clip();
  ctx.clearRect(bx, by, bw, bh);
  const baked = inkBakedRasterSource(layer);
  // baked tanımlı ama henüz çözülmedi (async Image): bölgeyi eksik bırakmayız.
  if (layer.baked && layer.baked.src && !baked) {
    ctx.restore();
    inkRuntime.dirtyLayers.add(layer.id);
    return false;
  }
  if (baked) ctx.drawImage(baked, bx, by, bw, bh, bx, by, bw, bh);
  const region = { x: bx, y: by, w: bw, h: bh };
  for (const stroke of layer.strokes) {
    const sb = inkStrokePixelBox(stroke, canvas);
    if (!sb || !inkBoxIntersectsBox(sb, region)) continue;
    /* Tur 5p-A: önbellekli vuruş tek blit (kaynak/hedef bölge
       kesişimiyle sınırlı); taşınamayanlar doğrudan damga.
       skipStrokeId (commit): yeni vuruş bu kurulumda ister istemez
       kaçırır (taze tuval tahsisi saf kayıp) — doğrudan damgalanır ve
       girişi idle'da kurulur (aşağıda); sonraki kurulumlar blit eder. */
    if (stroke.id !== skipStrokeId && inkStrokeStampCacheable(stroke)) {
      const ce = inkStrokeStampEntry(stroke, canvas, sb);
      if (ce) {
        const sx = Math.max(ce.x, bx), sy = Math.max(ce.y, by);
        const sw = Math.min(ce.x + ce.w, bx + bw) - sx;
        const sh = Math.min(ce.y + ce.h, by + bh) - sy;
        if (sw > 0 && sh > 0) ctx.drawImage(ce.canvas, sx - ce.x, sy - ce.y,
          sw, sh, sx, sy, sw, sh);
        continue;
      }
    }
    if (stroke.id === skipStrokeId) inkStrokeStampScheduleWarm(layer, stroke);
    inkDrawStrokeOnContext(ctx, stroke, {
      mapPoint: p => ({ x: p.x * canvas.width, y: p.y * canvas.height }),
      sizePx: Math.max(0.5, stroke.size * canvas.width),
      pointScale: { x: canvas.width, y: canvas.height },
    });
  }
  ctx.restore();
  // Bölge unmasked yeniden kuruldu: maske çarpımı yalnız bu kutuya.
  let ok = true;
  if (layer.mask) {
    ok = inkApplyMaskRectToItemContext(layer, ctx, canvas, region);
  }
  inkRuntime.dirtyLayers.delete(layer.id);
  if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
  /* NOT: epoch bump'i çağıran yönetir — commit hattı bölgeyi taşır. */
  if (typeof inkPerfSpan === 'function') {
    if (ok) inkPerfSpan('rebuildRect', performance.now() - t0);
    else inkPerfCount('rebuildRectSkips');
  }
  return ok;
}

/* =========================================================
   global katman karoları
   ========================================================= */
function inkTileKey(layerId, tx, ty) {
  return layerId + ':' + tx + ',' + ty;
}

function inkEnsureTile(layer, tx, ty) {
  const key = inkTileKey(layer.id, tx, ty);
  let tile = inkRuntime.tiles.get(key);
  if (tile && tile.canvas.isConnected) return tile;

  const canvas = document.createElement('canvas');
  canvas.className = 'inkTile';
  canvas.width = INK_TILE_SIZE;
  canvas.height = INK_TILE_SIZE;
  canvas.dataset.inkLayer = layer.id;
  canvas.setAttribute('aria-hidden', 'true');
  tile = { key, layerId: layer.id, tx, ty, canvas };
  canvas.style.left = (tx * INK_TILE_SIZE) + 'px';
  canvas.style.top = (ty * INK_TILE_SIZE) + 'px';
  inkRuntime.tiles.set(key, tile);
  inkEnsureHost().appendChild(canvas);
  if (typeof inkPerfCount === 'function') inkPerfCount('tileCreates');
  return tile;
}

function inkTileZ(layer) {
  const globals = inkState().layers.filter(l => l.kind === 'global');
  const idx = Math.max(0, globals.findIndex(l => l.id === layer.id));
  return layer.plane === 'above'
    ? 200000 + idx
    : Math.min(9, 2 + idx);
}

function inkApplyTileStyle(tile, layer) {
  const c = tile.canvas;
  const z = inkTileZ(layer);
  if (c.style.zIndex !== String(z)) c.style.zIndex = String(z);
  c.style.opacity = layer.visible ? String(layer.opacity) : '0';
  c.style.mixBlendMode = layer.blend === 'normal' ? 'normal' : layer.blend;
  c.style.display = layer.visible && layer.opacity > 0.001 ? 'block' : 'none';
}

function inkStrokeTileRange(stroke) {
  const r = Math.max(1, stroke.size || 1);
  const pad = Math.max(4, r * 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of stroke.points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    x0: Math.floor((minX - pad) / INK_TILE_SIZE),
    y0: Math.floor((minY - pad) / INK_TILE_SIZE),
    x1: Math.floor((maxX + pad) / INK_TILE_SIZE),
    y1: Math.floor((maxY + pad) / INK_TILE_SIZE),
  };
}

/* Global vuruşlar için tek seferlik ara tuval. Uzun bir vuruş birkaç karoya
   yayıldığında damla/yol üretimi karo başına değil, bir kez yapılır; sonuç
   dilimlenerek karolara aktarılır. Silgi (destination-out) ara tuvale
   aktarılamadığı için doğrudan karo üzerine çizilir. */
const inkGlobalStage = { canvas: null, ctx: null, w: 0, h: 0 };

function inkEnsureGlobalStage(w, h) {
  if (!inkGlobalStage.canvas) {
    inkGlobalStage.canvas = document.createElement('canvas');
    inkGlobalStage.ctx = inkGlobalStage.canvas.getContext('2d', { colorSpace: 'srgb' });
  }
  const c = inkGlobalStage.canvas;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
    inkGlobalStage.w = w;
    inkGlobalStage.h = h;
    return inkGlobalStage.ctx;
  }
  const ctx = inkGlobalStage.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

function inkRasterizeGlobalStroke(layer, stroke) {
  const range = inkStrokeTileRange(stroke);
  if (!range) return;
  const cols = range.x1 - range.x0 + 1;
  const rows = range.y1 - range.y0 + 1;
  const tiles = cols * rows;
  const staged = stroke.tool !== 'eraser' && tiles > 1 && tiles <= 16 &&
    tiles * INK_TILE_SIZE * INK_TILE_SIZE <= 4194304;

  if (staged) {
    const w = cols * INK_TILE_SIZE;
    const h = rows * INK_TILE_SIZE;
    const sctx = inkEnsureGlobalStage(w, h);
    inkDrawStrokeOnContext(sctx, stroke, {
      mapPoint: p => ({
        x: p.x - range.x0 * INK_TILE_SIZE,
        y: p.y - range.y0 * INK_TILE_SIZE,
      }),
      sizePx: Math.max(0.5, stroke.size),
    });
    if (typeof inkPerfCount === 'function') inkPerfCount('stagedStrokes');
    for (let ty = range.y0; ty <= range.y1; ty++) {
      for (let tx = range.x0; tx <= range.x1; tx++) {
        const tile = inkEnsureTile(layer, tx, ty);
        // Alfa kilidi: sahne tamamı kendi içinde birikmiş olsa bile karoya
        // ATOP ile basılır; yalnızca mevcut karoya bulaşır (staged yolu
        // zaten silgi dışı vuruşlarda çalışır).
        const tctx = tile.canvas.getContext('2d', { colorSpace: 'srgb' });
        tctx.save();
        if (stroke.lockAlpha) tctx.globalCompositeOperation = 'source-atop';
        tctx.drawImage(
          inkGlobalStage.canvas,
          (tx - range.x0) * INK_TILE_SIZE, (ty - range.y0) * INK_TILE_SIZE,
          INK_TILE_SIZE, INK_TILE_SIZE,
          0, 0, INK_TILE_SIZE, INK_TILE_SIZE
        );
        tctx.restore();
        inkApplyTileStyle(tile, layer);
      }
    }
    return;
  }

  for (let ty = range.y0; ty <= range.y1; ty++) {
    for (let tx = range.x0; tx <= range.x1; tx++) {
      const tile = inkEnsureTile(layer, tx, ty);
      const ctx = tile.canvas.getContext('2d', { colorSpace: 'srgb' });
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, INK_TILE_SIZE, INK_TILE_SIZE);
      ctx.clip();
      inkDrawStrokeOnContext(ctx, stroke, {
        mapPoint: p => ({
          x: p.x - tx * INK_TILE_SIZE,
          y: p.y - ty * INK_TILE_SIZE,
        }),
        sizePx: Math.max(0.5, stroke.size),
      });
      ctx.restore();
      inkApplyTileStyle(tile, layer);
    }
  }
}

function inkRebuildGlobalLayer(layer) {
  const t0 = performance.now();
  if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(layer.id, 'rebuild');
  for (const [key, tile] of [...inkRuntime.tiles]) {
    if (tile.layerId !== layer.id) continue;
    tile.canvas.remove();
    inkRuntime.tiles.delete(key);
  }
  for (const stroke of layer.strokes) inkRasterizeGlobalStroke(layer, stroke);
  if (typeof inkPerfSpan === 'function') inkPerfSpan('rebuild', performance.now() - t0);
}

/* =========================================================
   katman / sahne senkronizasyonu
   ========================================================= */
function inkRerenderLayer(layerId) {
  const layer = inkLayerById(layerId);
  if (!layer) return;
  if (layer.kind === 'attached') inkRebuildItemLayer(layer);
  else inkRebuildGlobalLayer(layer);
  // Katman rasterı değişti; açık çizim editörü önbelleğini tazele.
  if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
}

function inkRerenderAllLayers() {
  const ink = inkState();
  for (const layer of ink.layers) inkRerenderLayer(layer.id);
  inkSyncDom();
}

function inkSyncItem(it, el) {
  if (!it || !el || it.kind !== 'image') return;
  const layers = inkLayersForOwner(it.id);
  if (!layers.length) return;
  for (const layer of layers) {
    const canvas = inkEnsureItemCanvas(layer);
    if (!canvas) continue;
    if (inkRuntime.dirtyLayers.has(layer.id)) inkRebuildItemLayer(layer);
    canvas.style.opacity = layer.visible ? String(layer.opacity) : '0';
    canvas.style.mixBlendMode = layer.blend === 'normal' ? 'normal' : layer.blend;
    canvas.style.display = layer.visible && layer.opacity > 0.001 ? 'block' : 'none';
  }
  // Kırpma (clip) grupları varsa: grup düzlemini ekranda birleştir.
  // FX (Efektler) etkinken de birleşik düzlem gerekir: efektli raster
  // tek .inkFxCanvas olarak basılır. GERÇEK HATA: burada yalnız clip
  // koşuluna bakılıyordu; tahtada efekt katmanı hiç oluşmuyordu.
  const fxOn = typeof inkFxItemHasActiveFx === 'function' && inkFxItemHasActiveFx(it);
  if (typeof inkCompositeSyncItem === 'function' && (fxOn || layers.some(l => l.clip))) {
    inkCompositeSyncItem(it, el);
  } else if (!fxOn) {
    /* FX kapandı (tüm efektler silindi/gizlendi ya da undo): aşama
       tuvalleri de bırakılır, yoksa silinen efektin 4K aşama tuvali
       (~17 MB) bir sonraki yapısal değişikliğe kadar bellekte kalıyordu. */
    if (typeof inkFxPruneStages === 'function') inkFxPruneStages(it);
    const stale = el.querySelector(':scope > .inkFxCanvas');
    if (stale) stale.remove();
  }
}

/** syncAll() sonunda çağrılır: tuvalleri ve gizmo'yu güncel tutar. */
function inkSyncDom() {
  if (!state || !state.ink) return;
  inkEnsureHost();
  const ink = inkEnsureState();

  for (const layer of ink.layers) {
    if (layer.kind === 'attached') {
      const it = getItem(layer.ownerId);
      const el = it ? elMap.get(it.id) : null;
      if (!el) continue;
      const canvas = inkEnsureItemCanvas(layer);
      if (canvas && inkRuntime.dirtyLayers.has(layer.id)) inkRebuildItemLayer(layer);
      if (canvas) {
        canvas.style.opacity = layer.visible ? String(layer.opacity) : '0';
        canvas.style.mixBlendMode = layer.blend === 'normal' ? 'normal' : layer.blend;
        canvas.style.display = layer.visible && layer.opacity > 0.001 ? 'block' : 'none';
      }
      // Aynı görselin kırpma grubunu bir kez birleştirmek yeter.
      const fxOn = it && typeof inkFxItemHasActiveFx === 'function'
        && inkFxItemHasActiveFx(it);
      if (typeof inkCompositeSyncItem === 'function' && (fxOn || layer.clip)) {
        inkCompositeSyncItem(it, el);
      } else if (!fxOn && !layer.clip) {
        if (typeof inkFxPruneStages === 'function') inkFxPruneStages(it);
        const stale = el.querySelector(':scope > .inkFxCanvas');
        if (stale) stale.remove();
      }
    } else {
      // Mevcut karoların stilini güncelle; çizim yoksa karo oluşturma.
      for (const tile of inkRuntime.tiles.values()) {
        if (tile.layerId === layer.id) inkApplyTileStyle(tile, layer);
      }
    }
  }

  // Artık var olmayan katmanların DOM tuvallerini temizle.
  for (const [layerId, canvas] of [...inkRuntime.itemCanvases]) {
    if (!inkLayerById(layerId)) {
      canvas.remove();
      inkRuntime.itemCanvases.delete(layerId);
    }
  }
  for (const [key, tile] of [...inkRuntime.tiles]) {
    if (!inkLayerById(tile.layerId)) {
      tile.canvas.remove();
      inkRuntime.tiles.delete(key);
    }
  }

  inkCullTiles();
  inkUpdateGizmo();
}

function inkRebuildAll() {
  inkEnsureHost();
  const ink = inkEnsureState();
  // Bağlı tuval boyutları görsel boyutuna göre yeniden seçilir.
  for (const layer of ink.layers) {
    if (layer.kind !== 'attached') continue;
    const it = getItem(layer.ownerId);
    if (!it) continue;
    if (!layer.pxW || !layer.pxH) {
      const size = inkPickAttachedBitmapSize(it);
      layer.pxW = size.w;
      layer.pxH = size.h;
    }
    const canvas = inkRuntime.itemCanvases.get(layer.id);
    if (canvas) {
      if (canvas.width !== layer.pxW) canvas.width = layer.pxW;
      if (canvas.height !== layer.pxH) canvas.height = layer.pxH;
    }
  }
  /* AÇILIŞ analiz: hangi katman ne kadar sürüyor? (__bootMarks'a yazılır,
     davranış değişmez). */
  const __t0 = performance.now();
  const __perLayer = [];
  for (const layer of ink.layers) {
    const __lt = performance.now();
    if (layer.kind === 'attached') inkRebuildItemLayer(layer);
    else inkRebuildGlobalLayer(layer);
    __perLayer.push(layer.kind + ':' + layer.id.slice(0, 8) + '=' + (performance.now() - __lt).toFixed(1) + 'ms');
  }
  inkSyncDom();
  const __all = performance.now() - __t0;
  try {
    (window.__bootMarks = window.__bootMarks || []).push(
      'rebuildAll=' + __all.toFixed(0) + 'ms [' + __perLayer.join(', ') + ']');
  } catch { /* sessiz */ }
}

/* =========================================================
   görünür alan culling
   ========================================================= */
function inkCullTiles() {
  if (!inkRuntime.tiles.size) return;
  const vw = stage.clientWidth, vh = stage.clientHeight;
  const s = state.view.scale;
  const margin = INK_TILE_SIZE * s * 1.5;
  for (const tile of inkRuntime.tiles.values()) {
    const layer = inkLayerById(tile.layerId);
    if (!layer) continue;
    if (!layer.visible || layer.opacity <= 0.001) {
      tile.canvas.style.display = 'none';
      continue;
    }
    const x = tile.tx * INK_TILE_SIZE * s + state.view.x;
    const y = tile.ty * INK_TILE_SIZE * s + state.view.y;
    const size = INK_TILE_SIZE * s;
    const visible = x + size > -margin && x < vw + margin && y + size > -margin && y < vh + margin;
    tile.canvas.style.display = visible ? 'block' : 'none';
  }
}

function inkViewChanged() {
  inkCullTiles();
  inkUpdateGizmo();
}

/* =========================================================
   seçim gizmo'su
   ========================================================= */
function inkClearGizmo() {
  inkRuntime.gizmoBounds = null;
  const g = document.getElementById('inkGizmo');
  if (g) g.hidden = true;
}

function inkGizmoToolActive() {
  const tool = inkState().tool;
  return tool === 'transform' || tool === 'lasso' || tool === 'marquee';
}

function inkUpdateGizmo() {
  const g = inkEnsureGizmo();
  const ink = inkState();
  const b = inkSelectionBounds();
  if (!b || !inkGizmoToolActive()) {
    inkClearGizmo();
    /* FAZ 6 A4: widget senkronu gizli dalında da koşar (seçim
       bırakıldığında action/info anında güncellensin). */
    try { if (window.__v5OptSync) window.__v5OptSync({ measure: false }); } catch { /* sessiz */ }
    return;
  }
  inkRuntime.gizmoBounds = b;
  g.hidden = false;
  g.style.left = b.x + 'px';
  g.style.top = b.y + 'px';
  g.style.width = Math.max(1, b.w) + 'px';
  g.style.height = Math.max(1, b.h) + 'px';
  /* FAZ 6 A4: options bar info/eylem widget'ları (gizmo değer satırı,
     "Deselect" görünürlüğü) bununla senkron; ölçüm atlanır —
     overflow ölçümü yalnız gerçek araç senkronlarında koşar. */
  try { if (window.__v5OptSync) window.__v5OptSync({ measure: false }); } catch { /* sessiz */ }
}

/* =========================================================
   PNG dışa aktarma yardımcıları
   ========================================================= */
/** Öğe yerel uzayında (merkez 0,0) bağlı katmanları çizer.
 *  Ekranın kullandığı AYNI display planı ve AYNI kırpma-grup rasterını
 *  kullanır; ayrı bir gCO matematği yoktur. */
function inkDrawAttachedForExport(ctx, it) {
  if (!state || !state.ink) return;
  /* FX dalı (Faz 1): etkin efekt varsa nihai rasterı tek drawImage basar;
     ekran ile AYNI zincir (inkFxApplyChain) — ekran=export birebir. */
  if (typeof inkFxExportDraw === 'function' && inkFxExportDraw(ctx, it)) return;
  const usePlan = typeof inkCompositeHasClips === 'function' && inkCompositeHasClips(it.id);
  const layers = typeof inkOwnerStackLayers === 'function'
    ? inkOwnerStackLayers(it.id)
    : inkLayersForOwner(it.id);
  if (!layers.length) return;
  if (!usePlan) {
    for (const layer of layers) {
      if (!layer.visible || layer.opacity <= 0.001) continue;
      const canvas = inkRuntime.itemCanvases.get(layer.id);
      if (!canvas) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      if (layer.blend !== 'normal') ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(canvas, -it.w / 2, -it.h / 2, it.w, it.h);
      ctx.restore();
    }
    return;
  }
  inkCompositePaintPlanToContext(ctx, it.id, null, (c, entry, raster) => {
    c.save();
    c.globalAlpha = inkCompositeEntryOpacity(entry);
    const blend = inkCompositeEntryBlend(entry);
    if (blend) c.globalCompositeOperation = blend;
    c.drawImage(raster, -it.w / 2, -it.h / 2, it.w, it.h);
    c.restore();
  });
}

/** Global katman karolarını dışa aktarım tuvaline basar. */
function inkDrawGlobalForExport(ctx, boardBounds, pad, plane) {
  if (!state || !state.ink) return;
  const ink = inkState();
  for (const layer of ink.layers) {
    if (layer.kind !== 'global' || !layer.visible || layer.opacity <= 0.001) continue;
    if ((layer.plane === 'above' ? 'above' : 'below') !== plane) continue;
    for (const tile of inkRuntime.tiles.values()) {
      if (tile.layerId !== layer.id) continue;
      const x = tile.tx * INK_TILE_SIZE - boardBounds.x + pad;
      const y = tile.ty * INK_TILE_SIZE - boardBounds.y + pad;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      if (layer.blend !== 'normal') ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(tile.canvas, x, y, INK_TILE_SIZE, INK_TILE_SIZE);
      ctx.restore();
    }
  }
}

/* =========================================================
   görsel öğe kopyalama / boyut değişimi
   ========================================================= */
function inkRelayoutAttached(layer) {
  const it = inkItemForLayer(layer);
  if (!it) return;
  const size = inkPickAttachedBitmapSize(it);
  if (size.w !== layer.pxW || size.h !== layer.pxH) {
    layer.pxW = size.w;
    layer.pxH = size.h;
    // Tuvali fiziksel olarak da yeniden boyutlandır (içeriği temizlenir);
    // dirty işaretçisi yeniden kurulumu üstlenir. Vuruşlar 0..1 uzayında
    // normalize olduğu için çözünürlük değişimi kayıpsız.
    const c = inkRuntime.itemCanvases.get(layer.id);
    if (c) {
      c.width = layer.pxW;
      c.height = layer.pxH;
    }
    if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(layer.id, 'rebuild');
    inkRuntime.dirtyLayers.add(layer.id);
    if (typeof inkScheduleDirtyFlush === 'function') inkScheduleDirtyFlush();
  }
}

/** Boyut değişimi bittiğinde ilgili öğelerin bağlı katman tavanlarını
    günceller. `startResize/startGroupResize` sonrası çağrılır (FAZ1-6). */
function inkRelayoutItemsForResize(ids) {
  if (!ids || !ids.length || typeof inkLayersForOwner !== 'function') return;
  for (const id of ids) {
    const it = typeof getItem === 'function' ? getItem(id) : null;
    if (!it || it.kind !== 'image') continue;
    for (const layer of inkLayersForOwner(id)) inkRelayoutAttached(layer);
  }
}

function inkViewportStrokeCount() {
  let total = 0;
  for (const layer of inkState().layers) total += layer.strokes.length;
  return total;
}

/** Görünür global katmanların dünya uzayındaki toplam sınırları. */
function inkGlobalWorldBounds() {
  if (!state || !state.ink) return null;
  let b = null;
  for (const layer of inkState().layers) {
    if (layer.kind !== 'global' || !layer.visible || layer.opacity <= 0.001) continue;
    const lb = inkLayerWorldBounds(layer);
    if (!lb) continue;
    if (!b) { b = { ...lb }; continue; }
    const right = Math.max(b.x + b.w, lb.x + lb.w);
    const bottom = Math.max(b.y + b.h, lb.y + lb.h);
    b.x = Math.min(b.x, lb.x);
    b.y = Math.min(b.y, lb.y);
    b.w = right - b.x;
    b.h = bottom - b.y;
  }
  return b;
}
