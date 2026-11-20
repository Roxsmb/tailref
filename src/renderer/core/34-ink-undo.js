/* TailRef app · ink undo · vuruş bazlı delta geri al
   ------------------------------------------------------------------
   Her vuruş commit'inde tüm panonun JSON anlık görüntüsünü almak,
   binlerce vuruşlu tahtalarda onlarca MB kopya üretiyordu. Artık yalnızca
   eklenen vuruş kaydedilir: geri al onu katmandan çıkarır, yinele geri
   koyar. Diğer işlemler (öğe taşıma, silme, katman ayarı...) tam anlık
   görüntü kullanmaya devam eder; iki tür aynı yığında karışık durabilir.

   Kayıtlar JSON dizesi olarak tutulur; böylece pano kaydı ve görsel
   çöp toplama kodları (undoStack/redoStack üzerinde JSON.parse yapanlar)
   değişmeden çalışır. Delta kaydı `items` alanı taşımadığı için bu
   taramalarda zararsızdır.
   ========================================================= */
'use strict';

const INK_UNDO_STROKE_KEY = '__inkStroke';

/* =========================================================
   vuruş bölgesi raster anlık görüntüsü (hızlı geri al)
   ---------------------------------------------------------
   Vuruş commit'inde, boyanmadan ÖNCE yalnızca vuruşun kapladığı
   dikdörtgenin pikselleri saklanır. Ctrl+Z bu görüntüyü tuvalin ilgili
   bölgesine `putImageData` ile geri yazar; tüm katman yeniden rasterlenmez.
   Yineleme, tüm katman yerine yalnızca o vuruşu yeniden boyar.

   Görüntüler JSON'a yazılamaz (undoStack kalıcıdır); bu yüzden bellek
   içinde token ile eşlenir. Kayıt yoksa (ağır vuruş, bellek sınırı, sayfa
   yenileme) güvenli yol olan vektör tabanlı tam kurulum devreye girer.
   ========================================================= */
const inkUndoRaster = {
  entries: new Map(),
  bytes: 0,
  seq: 0,
  maxBytes: 128 * 1024 * 1024,
  /* FAZ 7.T (byte-pool): fast-path snapshot'ı yalnız KÜÇÜK bölgeye
     verilirdi (>1.5 MB bölge undo karo baytları 55+ MB JS heap
     biriktiriyordu; envanter muhasebesi). Ancak gradyan/boya vuruşunun
     bölgesi TÜM ÖĞE ALANIDIR (inkStrokeWorldBounds köşe kutusu döner);
     800×600 tuvalde bile 1.92 MB olan bu anlık görüntü bütçeye
     sığmayınca capture atlanıyor, geri al tam vektör yeniden kurulumuna
     düşüyor ve worker ile pişmiş fırça pikselleri ana iş parçacığı
     damgasıyla değişiyordu (geri alda mevcut vuruşların görünümü
     bozuluyor). Bütçe tamamı 16 MB (maxBytes) + trim ile sınırlı:
     tek anlık görüntü tavanı 4 MB'a çıkarıldı; toplam bellek hâlâ
     aynı üst sınıra bağlı. */
  /* FAZ 7.V · smudge-ölçekli bütçe: smudge bölgeleri (bbox + fırça payı)
     büyük tuvallerde 4-8 MB'a kolayca çıkıyor; 4 MB tavan capture'ı
     hep atlatıyor, 16 MB havuz da 4-6 kayıt tutup gerisini evict
     ediyordu. Sonuç: her undo ANA-THREAD bölgesel yeniden kurulumuna
     düşüyor → ağır board'da vuruş başına 1.2-1.6 sn frame cut
     (ölçüm: undo3 jank 1581 ms, undo4 1205 ms) → üst üste Ctrl+Z'de
     5+ sn donma → aşırı-yükleme watchdog'u. Tavan 32 MB, havuz
     128 MB: ~30 smudge adımı hızlı yolda kalır; hold-kopya
     (premultiplied memcpy) maliyeti bölge başına ~1-4 ms. */
  maxSnapBytes: 32 * 1024 * 1024,
  maxEntries: 60,
  stats: { captures: 0, applied: 0, repaints: 0, fallbacks: 0, evictions: 0,
    workerPosted: 0, workerApplied: 0, workerCancelled: 0, workerSkips: 0 },
};

function inkUndoRasterToken() {
  return 'r' + (++inkUndoRaster.seq).toString(36);
}

function inkUndoRasterEntry(token) {
  return token ? inkUndoRaster.entries.get(token) || null : null;
}

function inkUndoRasterDrop(token) {
  const entry = inkUndoRaster.entries.get(token);
  if (!entry) return;
  inkUndoRaster.bytes -= entry.bytes || 0;
  if (inkUndoRaster.bytes < 0) inkUndoRaster.bytes = 0;
  inkUndoRaster.entries.delete(token);
}

/** Yığından düşen kaydın raster kopyasını da bırak. */
function inkUndoRasterDropRaw(raw) {
  if (typeof raw !== 'string') return;
  // Tam pano anlık görüntüleri büyük olabilir: token yoksa hiç ayrıştırma.
  if (raw.indexOf(INK_UNDO_STROKE_KEY) < 0) return;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return; }
  const entry = parsed && parsed[INK_UNDO_STROKE_KEY];
  if (entry && entry.token) inkUndoRasterDrop(entry.token);
}

function inkUndoRasterDropStack(stack) {
  if (!Array.isArray(stack)) return;
  for (const raw of stack) inkUndoRasterDropRaw(raw);
}

function inkUndoRasterDropAll() {
  inkUndoRaster.entries.clear();
  inkUndoRaster.bytes = 0;
}

function inkUndoRasterTrim() {
  while (inkUndoRaster.entries.size > inkUndoRaster.maxEntries ||
         inkUndoRaster.bytes > inkUndoRaster.maxBytes) {
    const first = inkUndoRaster.entries.keys().next();
    if (first.done) break;
    inkUndoRasterDrop(first.value);
    inkUndoRaster.stats.evictions++;
  }
}

/** Vuruşun etkilediği tuval piksel dikdörtgeni (kırpılmış). */
function inkUndoStrokeRegion(layer, stroke) {
  if (!layer || layer.kind !== 'attached' || !stroke) return null;
  const canvas = inkRuntime.itemCanvases.get(layer.id);
  if (!canvas || !canvas.width || !canvas.height) return null;
  const bounds = typeof inkStrokeWorldBounds === 'function'
    ? inkStrokeWorldBounds(layer, stroke) : null;
  if (!bounds) return null;
  // Fırça etkileri nominal sınırı aşabilir: en az bir fırça çapı pay bırak.
  const brushWorld = typeof inkLocalSizeToWorld === 'function'
    ? inkLocalSizeToWorld(layer, stroke.size || 0) : 0;
  const pad = Math.max(2, brushWorld * 1.5);
  const padded = {
    x: bounds.x - pad, y: bounds.y - pad,
    w: bounds.w + pad * 2, h: bounds.h + pad * 2,
  };
  const box = typeof inkWorldRectToLocalPixels === 'function'
    ? inkWorldRectToLocalPixels(layer, padded, canvas) : null;
  if (!box) return null;
  /* x/y let: union döngüsü genişletir (const idi — "Assignment to
     constant variable" sessiz throw edip union'u öldürüyordu). */
  let x = Math.max(0, Math.floor(box.x) - 2);
  let y = Math.max(0, Math.floor(box.y) - 2);
  let w = Math.min(canvas.width, Math.ceil(box.x + box.w) + 2) - x;
  let h = Math.min(canvas.height, Math.ceil(box.y + box.h) + 2) - y;
  /* FAZ 6 madde 11: simetri klonları da bölgede. Klonsuz bölge
     geri alanda ayna/ışınsal pikselleri SOKUK bırakır (klon,
     vuruşun kendi rect'inden uzak çizilir). Klon noktalarının
     0..1 normalize kutusu → kanvas px, vuruş bölgesiyle
     birleştirilir (radial'da tüm klonlar zaten daireye yayılır). */
  const smode = String(stroke.sym || 'off');
  if (smode !== 'off' &&
      typeof INK_SYM_MODES !== 'undefined' &&
      Array.isArray(INK_SYM_MODES) && INK_SYM_MODES.includes(smode) &&
      typeof inkSymmetryStrokeClones === 'function') {
    try {
      /* klonlar 0..1 normalize döner (pointScale yalnız radial
         dönüş merkezi için; sonuç nx/sx ile normalize'a döner) */
      const clones = inkSymmetryStrokeClones(stroke, {
        pointScale: { x: canvas.width, y: canvas.height },
      });
      /* fırça davranışı nokta kutusunu aşar: vuruş pad'iyle aynı
         pay (nominal yarıçap ×1.5 + kenar payı) klon kutusuna da */
      const cPad = Math.max(4, (stroke.size || 0) * 1.5 + 2);
      for (const c of clones) {
        if (!c || !Array.isArray(c.points) || !c.points.length) continue;
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        for (const p of c.points) {
          if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        if (!(minX <= maxX) || !(minY <= maxY)) continue;
        const px0 = Math.max(0, Math.floor(minX * canvas.width - cPad));
        const py0 = Math.max(0, Math.floor(minY * canvas.height - cPad));
        const px1 = Math.min(canvas.width, Math.ceil(maxX * canvas.width + cPad));
        const py1 = Math.min(canvas.height, Math.ceil(maxY * canvas.height + cPad));
        const ux = Math.min(x, px0);
        const uy = Math.min(y, py0);
        const ur = Math.min(canvas.width, Math.max(x + w, px1));
        const ub = Math.min(canvas.height, Math.max(y + h, py1));
        x = ux; y = uy; w = ur - x; h = ub - y;
      }
    } catch { /* sessiz: union başarısızsa baz bölge yeterli */ }
  }
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function inkUndoSnapPixels(layer, rect) {
  const canvas = inkRuntime.itemCanvases.get(layer.id);
  if (!canvas) return null;
  const bytes = rect.w * rect.h * 4;
  if (bytes > inkUndoRaster.maxSnapBytes) return null;
  /* FAZ 4-6: hold-kopya — senkron unpremultiply okuması yerine
     premultiplied memcpy; bayt okuması boş-zamanda (ScheduleHoldFill). */
  if (INK_UNDO_HOLD_CAPTURE) {
    const hold = inkUndoHoldCopy(canvas, rect);
    if (hold) {
      return { rect, image: null, hold, width: canvas.width, height: canvas.height, bytes };
    }
    /* kopya kurulamadıysa klasik senkron okuma devrede. */
  }
  try {
    const image = canvas.getContext('2d', { colorSpace: 'srgb' }).getImageData(rect.x, rect.y, rect.w, rect.h);
    return { rect, image, width: canvas.width, height: canvas.height, bytes };
  } catch {
    return null;
  }
}

var INK_UNDO_TILE_SLICES_ENABLED = true; /* FAZ 4-5: karo dilimli kayıt */

/* FAZ 4-6 (hold-kopya): commit/undo anındaki getImageData unpremultiply
   dönüşümü 2560×126 bantta ~14 ms'ydi (profiler: 50 vuruşta 403 ms
   yalnız inkUndoCaptureBefore). drawImage kopyası premultiplied
   memcpy'dir (~1 ms); bayt okuması boş-zamana savrulur. Undo/redo
   uygulaması da kopyayı drawImage ile geri yazar — putImageData
   dönüşümünün bile ötesinde bit-parite. */
var INK_UNDO_HOLD_CAPTURE = true;
var inkUndoHoldIdle = typeof requestIdleCallback === 'function'
  ? requestIdleCallback : (fn) => setTimeout(fn, 12);

/** Bölgeyi premultiplied hâlde kopya kanvasa dondurur. Pikseller bu
 *  andan itibaren değişmez; bayt okuması (unpremultiply) sonradan
 *  boş-zamanda yapılırsa da bileşik doğruluğu bozmaz. */
function inkUndoHoldCopy(canvas, rect) {
  if (typeof document === 'undefined') return null;
  try {
    const hold = document.createElement('canvas');
    hold.width = rect.w;
    hold.height = rect.h;
    const hctx = hold.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!hctx) return null;
    hctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    return hold;
  } catch {
    return null;
  }
}

/** hold-kopyadan bayt okunur; karo dilimleri boş-zamanda doldurulur.
 *  Yarış koruması marker karşılaştırmasıdır (native fill ile aynı kalıp):
 *  araya re-capture/trim/drop girerse iş bırakılır — hold drawImage
 *  uygulama yolu zaten doğruluğu tek başına taşır. */
function inkUndoScheduleHoldFill(token, entry, snapObj) {
  if (!snapObj || !snapObj.hold) return;
  const marker = snapObj.pending;
  inkUndoHoldIdle(() => {
    if (inkUndoRaster.entries.get(token) !== entry ||
        !snapObj.pending || snapObj.pending !== marker) {
      return; // araya undo/trim/re-capture girdi → hold yeterli
    }
    const hold = snapObj.hold;
    const rect = snapObj.rect;
    let image = null;
    try {
      image = hold.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
        .getImageData(0, 0, hold.width, hold.height);
    } catch {
      snapObj.pending = null;
      return; // hold drawImage yolu uygulanabilir kalmaya devam eder
    }
    const canvas = inkRuntime.itemCanvases.get(entry.layerId);
    /* Kino aynası: commit anında ertelenen patch burada tamamlanır.
       Kısa pencere (commit → idle) kabul edilir; undo uygulaması
       hold kopyasından yapıldığından ayna bu pencerede yeniden oyna. */
    if (typeof inkCanonPatchFromRegion === 'function') {
      try {
        inkCanonPatchFromRegion(entry.layerId, rect, {
          width: image.width, height: image.height, data: image.data,
          modelX: rect.x, modelY: rect.y,
        }, (x, y, w, h) => {
          const rx = x - rect.x, ry = y - rect.y;
          if (rx >= 0 && ry >= 0 && rx + w <= rect.w && ry + h <= rect.h) {
            const out = new Uint8ClampedArray(w * h * 4);
            for (let row = 0; row < h; row += 1) {
              const from = ((ry + row) * rect.w + rx) * 4;
              out.set(image.data.subarray(from, from + w * 4), row * w * 4);
            }
            return out;
          }
          try {
            return canvas.getContext('2d', { colorSpace: 'srgb' }).getImageData(x, y, w, h).data;
          } catch { return null; }
        });
      } catch { /* ayna eksik kalabilir; hold yeterli */ }
    }
    /* karo baytları: geometry dilimlere böl (senkron JS yolu) */
    if (Array.isArray(snapObj.tiles) && snapObj.tiles.length) {
      let off = 0;
      for (const t of snapObj.tiles) {
        const relX = t.x - rect.x, relY = t.y - rect.y;
        if (relX < 0 || relY < 0 || relX + t.w > rect.w || relY + t.h > rect.h) return;
        const data = new Uint8ClampedArray(t.w * t.h * 4);
        for (let row = 0; row < t.h; row += 1) {
          const from = ((relY + row) * rect.w + relX) * 4;
          data.set(image.data.subarray(from, from + t.w * 4), row * t.w * 4);
        }
        t.data = data;
        t.bytes = data.length;
        off += data.length;
      }
      inkUndoRaster.bytes += off - snapObj.bytes;
      entry.bytes += off - snapObj.bytes;
      snapObj.bytes = off;
      snapObj.pending = null;
      /* FAZ 7.T (byte-pool): bayt dökümü OLUŞTU — hold canvas'ı bırak.
         Karo baytları bölgeyi birebir kapsadığından hold tuvali (Skia
         backing; 4K airbrush vuruşunda 7-8 MB/alan) yedek depo
         olmaktan çıkar. Apply yolu artık putImageData karolarını
         yürütür; bozuk/pending dökümde hold'=null atanmaz ve hold
         yolu davranışını korur. */
      snapObj.hold = null;
    }
  });
}

/* FAZ 4-5 (tile-diff): bölge tek okuma; kayıt karo sınırlarına dilimlenir. */
function inkUndoRegionTileSlices(L, rect, image, canvas, opts = {}) {
  if (!INK_UNDO_TILE_SLICES_ENABLED) return [];
  // ImageData üzerinde expando atamasına güvenme: sarıcı ile mutlak kon.
  const region = {
    width: image.width, height: image.height, data: image.data,
    modelX: rect.x, modelY: rect.y,
  };
  const patchCanon = opts.patchCanon !== false;
  const readVolume = (x, y, w, h) => {
    /* Profiler bulgusu Canal: bölge snapshot'ı ALINMIŞKEN her karo için
       256×256 getImageData tekrar kanvas okuması yapılıyordu — vuruş
       başına 20-78 okuma, tuval başına onca MB (ilk kare donması).
       Kanvas yeniden okumak yerine anlık görüntüden dilimle; yalnız
       bölgenin dışına taşan isteklerde kanvasa düş. */
    const rx = x - rect.x;
    const ry = y - rect.y;
    if (rx >= 0 && ry >= 0 && rx + w <= rect.w && ry + h <= rect.h) {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row += 1) {
        const from = ((ry + row) * rect.w + rx) * 4;
        out.set(image.data.subarray(from, from + w * 4), row * w * 4);
      }
      return out;
    }
    try {
      return canvas.getContext('2d', { colorSpace: 'srgb' }).getImageData(x, y, w, h).data;
    } catch {
      return null;
    }
  };
  const slices = (!patchCanon && typeof inkCanonRegionSlices === 'function')
    ? inkCanonRegionSlices(rect)
    : (typeof inkCanonPatchFromRegion === 'function')
      ? inkCanonPatchFromRegion(L, rect, region, readVolume)
      : (typeof inkCanonRegionSlices === 'function' ? inkCanonRegionSlices(rect) : []);
  const out = [];
  for (const s of slices) {
    // dilim: orijinal imageData'dan kopya — paint'ten ÖNCEKİ hal.
    // EVRE 4 (deferData): native yolda yalnız geometri döner; byte
    // band kopyası ana süreç çekirdeğine (tileSlice) boş-zamanda
    // devredilir. Aynaya dokunma (patchCanon) senkron kalır.
    if (opts.deferData) {
      out.push({ x: s.x, y: s.y, w: s.w, h: s.h, tx: s.tx, ty: s.ty, data: null, bytes: 0 });
      continue;
    }
    const relX = s.x - rect.x;
    const relY = s.y - rect.y;
    const data = new Uint8ClampedArray(s.w * s.h * 4);
    for (let row = 0; row < s.h; row++) {
      const from = ((relY + row) * rect.w + relX) * 4;
      const to = row * s.w * 4;
      data.set(image.data.subarray(from, from + s.w * 4), to);
    }
    out.push({ x: s.x, y: s.y, w: s.w, h: s.h, tx: s.tx, ty: s.ty, data, bytes: s.w * s.h * 4 });
  }
  return out;
}

/** Commit öncesi pikselleri kayda bağlar. */
function inkUndoCaptureBefore(token, layer, stroke) {
  // Tuval bekleyen bir tam kurulumdaysa mevcut pikseller güvenilir değil.
  if (inkRuntime.dirtyLayers && inkRuntime.dirtyLayers.has(layer.id)) return;
  const rect = inkUndoStrokeRegion(layer, stroke);
  if (!rect) return;
  /* DÜZELTME (profiler bulgusu): canon karo dilimleri (256×256) vuruş
     bölgesinden geniştilir; eski akış her karo için TEK TEK getImageData
     yapıyordu (vuruş başına 20-78 okuma). Bölgeyi karo sınırlarına
     hizalayıp TEK okumayla alırız; karo dilimleri tamamen bu
     anlık görüntünün içinden kesilir. Sınır aşarsa eski davranışa düş. */
  let snapRect = rect;
  /* NOT: eski denemede bölgeyi karo sınırlarına hizaliyorduk; her vuruşta
     2560×512 (5.2 MB) tek okuma yapmak omurgayı şişiriyordu. Dar bölge
     anlık görüntüsü + hibrit karo okuma (aşağıda readVolume) 5-8× daha
     az byte'u aynı doğrulukla verir. */
  const snap = inkUndoSnapPixels(layer, snapRect);
  if (!snap) return;
  let entry = inkUndoRaster.entries.get(token);
  if (!entry) {
    entry = { before: null, bytes: 0 };
    inkUndoRaster.entries.set(token, entry);
  }
  // FAZ 4-5: aynayı öncesi durumla güncelle; kaydı karo dilimlerine böl.
  const canvas = inkRuntime.itemCanvases.get(layer.id);
  /* EVRE 4 KARARI (2026-11-09, dürüst sonda tests/ink-tilespeed-check.js):
     tileSlice çekirdeği yalnız kılıf altında 1.9× hızlarken GERÇEK
     kanal JS döngüsünü geçemez: invoke (çift klon) 30-50× yavaş;
     EVRE 5.1 transferable PORT (sıfır-kopya) bile 1280 KB'de 58.6 ms
     vs JS 0.84 ms — asıl maliyet kopya değil, asenkron gidiş-dönüş
     olay gideri. Çekirdeği senkron çağırabilen bir yol gelmeden
     JS döngüsü YÜRÜRLÜKTE. */
  const nativeSlicing = false
    && typeof inkEngineTileSliceRequest === 'function'
    && typeof window !== 'undefined'
    && !!(window.tailref && window.tailref.engineTiles)
    && snapRect.w * snapRect.h >= 64 * 1024;
  const holdMode = !!snap.hold;
  /* hold modunda dilimler salt geometri (bayt okuması boş-zamanda);
     klasik modda JS dilimleme anında (image.data zaten okundu). */
  let tiles;
  if (holdMode) {
    const geo = (typeof inkCanonRegionSlices === 'function')
      ? inkCanonRegionSlices(snapRect) : [];
    tiles = geo.map(s => ({
      x: s.x, y: s.y, w: s.w, h: s.h, tx: s.tx, ty: s.ty,
      data: null, bytes: 0,
    }));
  } else {
    tiles = inkUndoRegionTileSlices(layer.id, snapRect, snap.image, canvas,
      { deferData: nativeSlicing }) || [];
  }
  const tileBytes = tiles.reduce((sum, t) => sum + (t.bytes || 0), 0);
  if (entry.before) {
    // EVRE 4: eski anlık görüntüde bekleyen native dilim işi varsa
    // kopart — döküm eski (kopsa bile) nesneye yazmasın.
    entry.before.pending = null;
    inkUndoRaster.bytes -= entry.before.bytes;
    entry.bytes -= entry.before.bytes;
  }
  entry.before = {
    rect: snap.rect,
    width: snap.width,
    height: snap.height,
    tiles: tiles.length ? tiles : null,
    // klasik: tam bölge yedeği; hold: bayt okuması boş-zamanda.
    image: holdMode ? null : ((tiles.length && !nativeSlicing) ? null : snap.image),
    hold: holdMode ? snap.hold : null,
    bytes: tileBytes || snap.bytes,
    pending: (holdMode || nativeSlicing) && tiles.length ? {} : null,
  };
  entry.bytes += entry.before.bytes;
  inkUndoRaster.bytes += entry.before.bytes;
  inkUndoRaster.stats.captures++;
  if (entry.before.pending) {
    if (holdMode) {
      inkUndoScheduleHoldFill(token, entry, entry.before);
    } else {
      inkUndoScheduleTileFill(token, entry, entry.before, snapRect,
        snap.image.data, tiles);
    }
  }
  inkUndoRasterTrim();
}

/* EVRE 4: native tileSlice sonucunu kayda devirir (yarış korumalı).
   Gecikme penceresinde undo/apply/trim gelirse anlık görüntü yedeği
   yürürlükte kalır; sonuç ancak kayıt hâlâ aynıysa benimsenir ve
   byte sayacı tam bölge → dilim toplamına düzeltilir. */
function inkUndoScheduleTileFill(token, entry, snapObj, snapRect,
                                 regionData, tiles) {
  const marker = snapObj.pending;
  const rel = tiles.map(t => [t.x - snapRect.x, t.y - snapRect.y, t.w, t.h]);
  inkEngineTileSliceRequest(regionData, snapRect.w, snapRect.h, rel)
    .then(reply => {
      const cur = inkUndoRaster.entries.get(token);
      if (cur !== entry || !snapObj.pending || snapObj.pending !== marker) {
        return; // araya undo/trim/re-capture girdi → yedek yeterli
      }
      if (!reply || !reply.data || !(reply.count > 0) || !snapObj.image ||
          !regionData) {
        return; // bozuk döküm → yedek kalsın
      }
      let off = 0;
      for (const t of tiles) {
        const len = t.w * t.h * 4;
        if (off + len > reply.count) return; // bozuk döküm → yedek kalsın
        t.data = new Uint8ClampedArray(reply.data.buffer, off, len);
        t.bytes = len;
        off += len;
      }
      const newBytes = off;
      inkUndoRaster.bytes += newBytes - snapObj.bytes;
      entry.bytes += newBytes - snapObj.bytes;
      snapObj.bytes = newBytes;
      snapObj.tiles = tiles;
      snapObj.image = null;
      snapObj.pending = null;
    })
    .catch(() => { /* sessiz: anlık görüntü yedeği geçerli kalır */ });
}

/** Vuruş bölgesi karolarını ImageData'ya yüzeyden geri yazar; başarılıysa true. */
function inkUndoApplyRaster(layer, token, phase) {
  const entry = inkUndoRasterEntry(token);
  const snap = entry && entry[phase];
  if (!snap) return false;
  // Tuval boş/eski olabilir: bekleyen tam kurulum varsa kısmi yazma yanlış olur.
  if (inkRuntime.dirtyLayers && inkRuntime.dirtyLayers.has(layer.id)) return false;
  const canvas = inkRuntime.itemCanvases.get(layer.id);
  if (!canvas || canvas.width !== snap.width || canvas.height !== snap.height) return false;
  try {
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    // AĞUSTOS DÜZELTME (10.11 kapı testi bulgusu): apply öncesi ctx durumu
    // kimileştirilmezse commit boyamasından kalan transform/alfa/karışım
    // kalıntısı bölgeyi FARKLI yere basıyordu — "undo sonrası vuruş
    // ekranda kalıyor" tam bu yüzden (applied=1 ama piksel değişmez).
    // putImageData transformu yok sayar; hold drawImage yolu saymaz —
    // o yüzden yalnız bu yolda yanlış davranış: birebir kullanıcının
    // "siyah sarının arkasına geçti" vakası.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    // FAZ 4-5: kayıt karo dilimleri — tek büyük blok yerine parça yüzey.
    // EVRE 4: dilim verisi hâlâ boş-zamanda taşınıyor olabilir (pending);
    // eksik dilim varsa tam bölge yedeği (image) geçerli yoldur.
    /* FAZ 4-6: hold-kopya en güvenli ve en hızlı uygulama yoludur:
       premultiplied → premultiplied drawImage, bit-parite memkopya.
       Yayılma tamamlanmış olmasa bile (pending bayt) hold yönetir. */
    if (snap.hold) {
      /* SİLME YAKA DÜZELTMESİ (10.11 kapı testi): hold drawImage
         source-over'dır — şeffaf hold pikselleri hedef pikselleri
         SLEMEZ, bunun üstüne binmeye çalışır. Undo = içerik silme:
         şeffaf bölgedeki vuruş pikselleri tavanda kalıyordu
         ("Ctrl+Z sonrası vuruş hâlâ görünüyor" — kullanıcının
         "C++ yaptıktan sonra oldu" tespiti FAZ 4-6 hold-kopya
         elefiyle birebir örtüşüyor). putImageData yolları ham
         yazdığından zaten doğru; hold yolu önce BÖLGEYİ TEMİZLER. */
      ctx.clearRect(snap.rect.x, snap.rect.y, snap.rect.w, snap.rect.h);
      ctx.drawImage(snap.hold, 0, 0, snap.hold.width, snap.hold.height,
        snap.rect.x, snap.rect.y, snap.rect.w, snap.rect.h);
    } else if (Array.isArray(snap.tiles) && snap.tiles.length) {
      let allReady = true;
      for (const t of snap.tiles) {
        if (!t.data) { allReady = false; break; }
      }
      if (allReady) {
        for (const t of snap.tiles) {
          try {
            ctx.putImageData(new ImageData(t.data, t.w, t.h), t.x, t.y);
          } catch {
            return false;
          }
        }
      } else if (snap.image) {
        ctx.putImageData(snap.image, snap.rect.x, snap.rect.y);
      } else {
        return false;
      }
    } else {
      ctx.putImageData(snap.image, snap.rect.x, snap.rect.y);
    }
  } catch {
    return false;
  }
  if (inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.delete(layer.id);
  // Bu katman için bekleyen kirli bölge varsa rasterı ezmesin.
  if (typeof inkDirty !== 'undefined' && inkDirty && inkDirty.layers) {
    inkDirty.layers.delete(layer.id);
  }
  inkUndoRaster.stats.applied++;
  return true;
}

/** Vuruş commit'i için hafif geri al kaydı. */
function inkPushUndoStroke(layer, stroke) {
  if (!layer || !stroke) {
    pushUndo();
    return;
  }
  const t0 = performance.now();
  const token = inkUndoRasterToken();
  // Vuruş henüz boyanmadı: yalnızca etkilenecek bölgenin eski hâli saklanır.
  inkUndoCaptureBefore(token, layer, stroke);
  const json = JSON.stringify({
    [INK_UNDO_STROKE_KEY]: {
      layerId: layer.id,
      kind: layer.kind,
      ownerId: layer.ownerId || null,
      token,
      stroke,
    },
  });
  undoStack.push(json);
  /* Adım sınırı kullanıcı ayarından (tailref-undo-steps); boşsa mevcut 60. */
  const undoLimit = (typeof tailrefUndoLimit === 'function') ? tailrefUndoLimit(60) : 60;
  while (undoStack.length > undoLimit) inkUndoRasterDropRaw(undoStack.shift());
  if (redoStack.length) {
    inkUndoRasterDropStack(redoStack);
    redoStack.length = 0;
  }
  if (typeof inkPerfSpan === 'function') inkPerfSpan('undoSnap', performance.now() - t0);
  if (typeof inkPerfCount === 'function') inkPerfCount('undoSnapBytes', json.length);
}

/** Ayrıştırılmış kayıt delta mı? Değilse null. */
function inkStrokeEntry(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const entry = parsed[INK_UNDO_STROKE_KEY];
  if (!entry || !entry.layerId || !entry.stroke) return null;
  return entry;
}

function inkLayerForUndoEntry(entry, direction) {
  const direct = typeof inkLayerById === 'function' ? inkLayerById(entry.layerId) : null;
  if (direct && Array.isArray(direct.strokes)) {
    const hasStroke = direct.strokes.some(s => s && s.id === entry.stroke.id);
    if (hasStroke || (direction === 'redo' &&
        direct.kind === entry.kind && (direct.ownerId || null) === (entry.ownerId || null))) {
      return direct;
    }
  }
  // Katman kimliği yeniden kurulumda değişmiş olabilir; sahibine bak.
  if (entry.ownerId && typeof inkLayersForOwner === 'function') {
    const list = inkLayersForOwner(entry.ownerId);
    const owner = list.find(l => Array.isArray(l.strokes) &&
      l.strokes.some(s => s && s.id === entry.stroke.id));
    if (owner) return owner;
    if (list.length) return list[0];
  }
  // Son çare: vuruş kimliğini tüm katmanlarda ara. Vuruş başka bir katmana
  // taşınmışsa geri al sessizce başarısız olmasın.
  if (typeof inkState === 'function') {
    const ink = inkState();
    const layers = ink && Array.isArray(ink.layers) ? ink.layers : [];
    for (const layer of layers) {
      if (Array.isArray(layer.strokes) &&
          layer.strokes.some(s => s && s.id === entry.stroke.id)) {
        return layer;
      }
    }
  }
  return direct || null;
}

/** Yinele (redo) sonrası vuruş bölgesini kanon aynasına yansıtır:
 *  ayna, katman tuvalindeki yeninin birebir karosu olur. */
function inkUndoReflectRedo(layer, entry) {
  const snap = entry && entry.before;
  if (!snap || !snap.rect) return;
  if (inkRuntime.dirtyLayers && inkRuntime.dirtyLayers.has(layer.id)) return;
  if (typeof inkCanonPatchFromRegion !== 'function') return;
  const canvas = inkRuntime.itemCanvases.get(layer.id);
  if (!canvas) return;
  try {
    const rect = snap.rect;
    const src = canvas.getContext('2d', { colorSpace: 'srgb' })
      .getImageData(rect.x, rect.y, rect.w, rect.h);
    const image = {
      width: src.width, height: src.height, data: src.data,
      modelX: rect.x, modelY: rect.y,
    };
    inkCanonPatchFromRegion(layer.id, rect, image, (x, y, w, h) => {
      try {
        return canvas.getContext('2d', { colorSpace: 'srgb' }).getImageData(x, y, w, h).data;
      } catch {
        return null;
      }
    });
  } catch {
    /* sessiz — ayna eksik kalabilir; fallback bunu göze alır */
  }
}

/** Geri al anındaki PIKSELLERİ "after" olarak kaydeder: yinele bu
    anlık görüntüyü birebir geri yazar (vektör repaint'in saçılma/
    tarakım randomize piksel kayması yok olur — undo/redo/kaydın üçü
    bit-dozücü doğ doğrulukta). */
function inkUndoCaptureAfter(token, layer, phase) {
  const entry = inkUndoRasterEntry(token);
  const before = entry && entry.before;
  if (!entry || !before || !before.rect) return;
  if (entry[phase]) return; // zaten yakalandı
  if (inkRuntime.dirtyLayers && inkRuntime.dirtyLayers.has(layer.id)) return;
  const canvas = inkRuntime.itemCanvases.get(layer.id);
  if (!canvas || canvas.width !== before.width || canvas.height !== before.height) return;
  try {
    const rect = before.rect;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    /* FAZ 4-6: hold-kopya — undo anındaki senkron unpremultiply okuması
       (~14 ms) premultiplied memcpy'ye iner; bayt okuması boş-zamanda. */
    const hold = INK_UNDO_HOLD_CAPTURE ? inkUndoHoldCopy(canvas, rect) : null;
    let image = null;
    if (!hold) {
      image = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    }
    /* karo dilimleme: undo KATMANINDA aynaya dokunma — undo kanvası x0'a
       döner, ayna x0'dan (commit anındaki patch) beri zaten o durumda;
       yanlışlık preparing x1 yaması kanvas/ayna uyumsuzluğu doğururdu. */
    /* EVRE 4: dilim kopyası native'a boş-zamanda; anlık görüntü yedek
       kalır (redo penceresinde karo-ready değilse image yolu çalışır).
       KARAR: sonda (tilespeed-check) invoke workload'u da PORT yolu da
       JS döngüsünü geçemedi — before tarafıyla aynı şekilde kapalı. */
    const nativeSlicing = false
      && typeof inkEngineTileSliceRequest === 'function'
      && typeof window !== 'undefined'
      && !!(window.tailref && window.tailref.engineTiles)
      && rect.w * rect.h >= 64 * 1024;
    const holdMode = !!hold;
    let tiles;
    if (holdMode) {
      const geo = (typeof inkCanonRegionSlices === 'function')
        ? inkCanonRegionSlices(rect) : [];
      tiles = geo.map(s => ({
        x: s.x, y: s.y, w: s.w, h: s.h, tx: s.tx, ty: s.ty,
        data: null, bytes: 0,
      }));
    } else {
      tiles = inkUndoRegionTileSlices(layer.id, rect, image, canvas,
        { patchCanon: false, deferData: nativeSlicing }) || [];
    }
    const tileBytes = tiles.reduce((sum, t) => sum + (t.bytes || 0), 0);
    entry[phase] = {
      rect,
      width: canvas.width,
      height: canvas.height,
      tiles: tiles.length ? tiles : null,
      image: holdMode ? null : ((tiles.length && !nativeSlicing) ? null : image),
      hold: holdMode ? hold : null,
      bytes: tileBytes || (image ? image.data.length : rect.w * rect.h * 4),
      pending: (holdMode || nativeSlicing) && tiles.length ? {} : null,
    };
    entry.bytes += entry[phase].bytes;
    inkUndoRaster.bytes += entry[phase].bytes;
    if (entry[phase].pending) {
      if (holdMode) {
        inkUndoScheduleHoldFill(token, entry, entry[phase]);
      } else {
        inkUndoScheduleTileFill(token, entry, entry[phase], rect,
          image.data, tiles);
      }
    }
    /* BELLEK BÜTÇESİ: after anlık görüntüsü yalnız SON 10 kayıtta
       tutulur. Daha eskilerde redo vektör repaint yoluyla döner
       (çalışan ama ~%0.4 piksel kaymalı yol). Undo'yu kullanıcı
       çoğunlukla son basamaklarda yapar; on taneden eski kaydın
       after'ı neredeyse hiç kullanılmaz. */
    inkUndoTrimAfterScopes();
  } catch {
    /* sessiz: after yoksa redo mevcut repaint yolunu kullanır */
  }
}

/** Son KEEP kayıt dışındaki entry'lerin after anlık görüntüsünü bırak. */
function inkUndoTrimAfterScopes() {
  const KEEP = 10;
  const entries = inkUndoRaster.entries;
  const trimEnd = entries.size - KEEP;
  if (trimEnd <= 0) return;
  let i = 0;
  for (const entry of entries.values()) {
    if (i >= trimEnd) break;
    i++;
    if (!entry || !entry.after) continue;
    // EVRE 4: bekleyen native dökümü kopart — nesne artık kayıt dışı.
    entry.after.pending = null;
    inkUndoRaster.bytes -= entry.after.bytes || 0;
    entry.bytes = Math.max(0, entry.bytes - (entry.after.bytes || 0));
    entry.after = null;
  }
  if (inkUndoRaster.bytes < 0) inkUndoRaster.bytes = 0;
}

/**
 * Delta kaydı uygular.
 * @param {object} entry inkStrokeEntry() sonucu
 * @param {'undo'|'redo'} direction
 * @returns {boolean} uygulandı mı
 */
/* =========================================================
   FAZ 7.S: bölgesel vektör yeniden kurulum (katman-boyutlu scratch)
   ---------------------------------------------------------
   Bölge-bölük scratch KAPANMAZ: tuval sınırı öteye taşırdığı ilkelin
   AA kenarlarını rasterlama sırasında TÜM ilkel boyunca değiştirir
   (history'nin saf deneyi: 2907 px · maxΔ 255 — çizgi kenarları
   noktalı). Undo fallback'i parite ister: katmanla AYNI boyutta
   scratch tuval, bölgeyle kesişen vuruşlar UNCLIP tam çizgide çizilir
   (koordinatlar tam kurulumla birebir) → rasterizasyon cebiri aynı
   tuval sınırlarında olduğundan birebir aynı. Sonra yalnız bölge
   geri kopyalanır. fill/gradient/liquify tuval-piksel okumalarını
   yapar; bu türlerde tam yola düş.
   ========================================================= */
let inkUndoScratchCtx = null;
/* FAZ 7.T (byte-pool): katman-boyutlu scratch 4K'da 33 MB Skia
   backing tutar. Fallback seyrek olduğu için boşta bekletmeyi 20 sn
   ile sınırla: her rebuild zamanlayıcıyı tazeler, süresi dolan
   tuvali serbest bırakır (sonraki rebuild yeniden konumlar). */
let inkUndoScratchReleaseT = 0;
function inkUndoScratchArmRelease() {
  if (inkUndoScratchReleaseT) clearTimeout(inkUndoScratchReleaseT);
  inkUndoScratchReleaseT = setTimeout(() => {
    inkUndoScratchCtx = null;
    inkUndoScratchReleaseT = 0;
  }, 20000);
}
/** Anında serbest bırakma (editör kapanışı çağırır). */
function inkUndoScratchReleaseNow() {
  if (inkUndoScratchReleaseT) { clearTimeout(inkUndoScratchReleaseT); inkUndoScratchReleaseT = 0; }
  inkUndoScratchCtx = null;
}
function inkUndoRegionRebuild(layer, region, canvas) {
  const __t0 = performance.now();
  const bx = Math.max(0, region.x | 0);
  const by = Math.max(0, region.y | 0);
  const bw = Math.min(canvas.width, Math.ceil(region.x + region.w)) - bx;
  const bh = Math.min(canvas.height, Math.ceil(region.y + region.h)) - by;
  if (bw <= 0 || bh <= 0) return false;
  if (inkUndoRaster.stats) inkUndoRaster.stats.regionTrials = (inkUndoRaster.stats.regionTrials || 0) + 1;
  /* fill/gradient/liquify: tam tuval üstü okuma/piksel etkiler — bölge
     paritesi garanti edilemez; güvenli yola düş (tam kurulum). */
  for (const st of layer.strokes) {
    const k = st && st.kind;
    if (k === 'fill' || k === 'gradient' || k === 'liquify') return false;
  }
  const cw = canvas.width, chh = canvas.height;
  let sctx = inkUndoScratchCtx;
  if (!sctx) {
    const scratch = document.createElement('canvas');
    scratch.width = cw; scratch.height = chh;
    sctx = scratch.getContext('2d', { colorSpace: 'srgb' });
    inkUndoScratchCtx = sctx;
  } else {
    const c = sctx.canvas;
    if (c.width !== cw || c.height !== chh) { c.width = cw; c.height = chh; }
  }
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalAlpha = 1;
  sctx.globalCompositeOperation = 'source-over';
  let __t1 = performance.now();
  sctx.clearRect(0, 0, cw, chh);
  /* baked: tam yol tümünü tek ölçekte basar; ölçek uyuşmazsa düş. */
  const baked = typeof inkBakedRasterSource === 'function'
    ? inkBakedRasterSource(layer) : null;
  if (layer.baked && layer.baked.src && !baked) return false;
  if (baked && (baked.width !== cw || baked.height !== chh)) return false;
  if (baked) sctx.drawImage(baked, 0, 0);
  if (typeof inkPerfSpan === 'function') {
    inkPerfSpan('rcClearBake', performance.now() - __t1);
    __t1 = performance.now();
  }
  const regionPx = { x: bx, y: by, w: bw, h: bh };
  if (typeof inkPerfSpan === 'function') {
    inkPerfCount('rcStrokes', 1); __t1 = performance.now();
  }
  for (const st of layer.strokes) {
    const sb = typeof inkStrokePixelBox === 'function'
      ? inkStrokePixelBox(st, canvas) : null;
    if (typeof inkBoxIntersectsBox === 'function') {
      if (!sb || !inkBoxIntersectsBox(sb, regionPx)) continue;
    } else if (!sb) continue;
    inkDrawStrokeOnContext(sctx, st, {
      mapPoint: p => ({ x: p.x * canvas.width, y: p.y * canvas.height }),
      sizePx: Math.max(0.5, st.size * canvas.width),
      pointScale: { x: canvas.width, y: canvas.height },
    });
  }
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (typeof inkPerfSpan === 'function') {
    inkPerfSpan('rcStamp', performance.now() - __t1);
    __t1 = performance.now();
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(bx, by, bw, bh);
  ctx.drawImage(sctx.canvas, bx, by, bw, bh, bx, by, bw, bh);
  ctx.restore();
  if (typeof inkPerfSpan === 'function') {
    inkPerfSpan('rcBlit', performance.now() - __t1);
  }
  if (layer.mask && typeof inkApplyMaskRectToItemContext === 'function') {
    return inkApplyMaskRectToItemContext(layer, ctx, canvas, regionPx);
  }
  if (inkUndoRaster.stats) {
    inkUndoRaster.stats.regionRebuilds = (inkUndoRaster.stats.regionRebuilds || 0) + 1;
  }
  if (typeof inkPerfSpan === 'function') inkPerfSpan('rebuildRect', performance.now() - __t0);
  inkUndoScratchArmRelease();
  if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
  return true;
}

function inkApplyStrokeEntry(entry, direction) {
  const layer = inkLayerForUndoEntry(entry, direction);
  if (!layer || !Array.isArray(layer.strokes)) return false;
  const stroke = entry.stroke;
  const index = layer.strokes.findIndex(s => s.id === stroke.id);
  const token = entry.token || null;
  const canFast = layer.kind === 'attached' && !!inkUndoRasterEntry(token);

  if (direction === 'undo') {
    if (index < 0) return false;
    layer.strokes.splice(index, 1);
  } else {
    if (index >= 0) return false;
    layer.strokes.push(stroke);
  }

  // Invalidate pending worker output before rebuilding from source strokes.
  // Tur 5p: bump mümkünse BÖLGEYLE atılır — rect'siz bump pyramitte
  // "bekleyen full" bayrağı açar (35-ink-worker: rect'li bump bile
  // carry.full korunur) ve sonraki hızlı-raster bölge bump'ına RAĞMEN
  // her undo/redo'da TAM piramit kursetliği tetiklenirdi
  // (4K'da +~20 ms/adım, tepe 156 ms — AB-probe pyrFull=1/adım kanıtı).
  // Bölge kaynağı: hızlı-raster anlık görüntüsünün kendi rect'i.
  let rasterEntry = canFast ? inkUndoRasterEntry(token) : null;
  let bolgeliErken = false;
  if (typeof inkBumpPaintEpoch === 'function') {
    const snapRect = rasterEntry && (direction === 'undo'
      ? rasterEntry.before : rasterEntry.after);
    const r0 = snapRect && snapRect.rect;
    /* Tur 5p: raster kaydı yoksa (maxSnapBytes aşımı — ağır/geniş vuruş)
       bölgeyi vuruş bölgesinden türet: fallback yolu zaten aynı bölgede
       çalışıyor (aşağıda inkUndoStrokeRegion). Rect'siz bump pyramitte
       "bekleyen full" açıyordu → her undo/redo'da tam kursetlik
       (iz: bump YOK → pyrFull=1, 4K ~20 ms/adım, tepe 156 ms). */
    const reg = (r0 && r0.w > 0 && r0.h > 0 &&
        r0.w < (snapRect.width || 1e9) && r0.h < (snapRect.height || 1e9))
      ? r0
      : (typeof inkUndoStrokeRegion === 'function'
        ? inkUndoStrokeRegion(layer, stroke) : null);
    if (reg && reg.w > 0 && reg.h > 0) {
      inkBumpPaintEpoch(layer.id, 'mutation', reg);
      bolgeliErken = true;
    } else {
      inkBumpPaintEpoch(layer.id, 'mutation');
    }
  }

  // Geri al: yalnızca kırpılmış bölgenin eski piksellerini birebir geri yaz.
  // Yinele: tüm katmanı kurmak yerine yalnızca bu vuruşu yeniden boya.
  let rasterDone = false;
  if (direction === 'undo' && canFast) {
    /* DÜZELTME: yinele birebirlirği — undo anındaki (redo hedefi)
       pikselleri "after" olarak anlık al; redo'da vektör repaint'in
       rastgele piksel kayması olmadan birebir geri koyulur. */
    inkUndoCaptureAfter(token, layer, 'after');
    rasterDone = inkUndoApplyRaster(layer, token, 'before');
  } else if (direction === 'redo' && rasterEntry && rasterEntry.after) {
    /* ÖNCE after anlık görüntüsü: redo = undo öncesi birebir geri. */
    rasterDone = inkUndoApplyRaster(layer, token, 'after');
    // Aynayı redo sonrası kanvastaki (after) durumla eşle.
    inkUndoReflectRedo(layer, entry);
    if (inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.delete(layer.id);
  } else if (direction === 'redo' && canFast && layer.kind === 'attached' &&
             typeof inkPaintStrokeSync === 'function') {
    inkPaintStrokeSync(layer, stroke);
    // FAZ 4-5: yinele sonrası karoların aynasını yeniyle eşle (kanon canlı kalır).
    inkUndoReflectRedo(layer, entry);
    if (inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.delete(layer.id);
    inkUndoRaster.stats.repaints++;
    rasterDone = true;
  }

  if (!rasterDone) {
    inkUndoRaster.stats.fallbacks++;
    // Kayıt yoksa (trim bütçesine takılan büyük anlık görüntü, kirli
    // katman, bellek sınırı) güvenli yol. FAZ 7.S: fallback artık
    // BÖLGESEL — kompozisyon noktasaldır; undo "vuruşu listeden çıkar"
    // olduğundan etkilenen alan yalnızca vuruşun bölgisidir (bölge
    // inkUndoStrokeRegion: fırça pad + simetri klonları dahil).
    // Bölgesel yeniden birleşim (7.M aracı), tam katman kurulumuna
    // bit-parite eşidir (11/11 kapı) ve bölge > %60 tuvalse tam yol
    // yürürlükte kalır (undoChip eşiği ile aynı tutarlılık).
    let regionDone = false;
    if (layer.kind === 'attached' &&
        typeof inkUndoRegionRebuild === 'function') {
      const region = typeof inkUndoStrokeRegion === 'function'
        ? inkUndoStrokeRegion(layer, stroke) : null;
      if (region && region.w > 0 && region.h > 0) {
        const canvas0 = inkRuntime.itemCanvases.get(layer.id);
        const cW = canvas0 ? canvas0.width : 0;
        const cH = canvas0 ? canvas0.height : 0;
        const snap = (rasterEntry && (direction === 'undo'
          ? rasterEntry.before : rasterEntry.after)) || null;
        const tw = snap && snap.width ? snap.width : cW;
        const th = snap && snap.height ? snap.height : cH;
        if (tw > 0 && region.w * region.h < tw * th * 0.6) {
          /* FAZ 7.U: rcStamp damga döngüsünü worker'a taşı. Kabul
             edildiyse uzun-vuruş kare kaybı önemsizleşir; uygulanma ya
             telafi worker kotaran fonksiyonda. Kabul edilmeyen durumlar
             (fill/gradient/liquify içeren kurulum, zincir işleniyor,
             baked çözülmedi …) sessizce ana-thread bölgesel yola düşer
             (davranış değişmez). smudge FAZ 7.U ile batch'te taşınıyor
             (tam-tuval scratch advected okuma birebir). */
          const wjob = typeof inkWorkerRegionRebuildJob === 'function'
            ? inkWorkerRegionRebuildJob(layer, region, canvas0) : null;
          if (wjob) {
            regionDone = true;   // bump/gen/invalidate apply/telafi'de
            inkUndoRaster.stats.workerPosted++;
            wjob.then(res => {
              if (res === 'applied') inkUndoRaster.stats.workerApplied++;
              else if (res === 'cancelled') inkUndoRaster.stats.workerCancelled++;
            }).catch(() => { /* yok say */ });
          } else {
            inkUndoRaster.stats.workerSkips++;
          }
          if (!regionDone) {
            regionDone = inkUndoRegionRebuild(layer, region, canvas0);
            if (regionDone) {
              if (typeof inkBumpPaintEpoch === 'function') {
                inkBumpPaintEpoch(layer.id, 'mutation', region);
              }
              if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
            }
          }
        }
      }
    }
    if (!regionDone) {
      if (typeof inkRerenderLayer === 'function') {
        inkRerenderLayer(layer.id);
      } else {
        const bounds = typeof inkStrokeWorldBounds === 'function'
          ? inkStrokeWorldBounds(layer, stroke) : null;
        if (bounds && typeof inkMarkLayerDirty === 'function') {
          inkMarkLayerDirty(layer, bounds);
          if (typeof inkFlushDirtyLayers === 'function') inkFlushDirtyLayers();
        }
      }
    }
  } else {
    /* FAZ 7.P: undo/redo bölgesi birebridir (snapshot rect) — pyramit
       tam kurulum yerine yalnız bu bölgeyi yamar (S2 undo'da 6×41 ms
       → bölge büyüklüğüne düşer). Fallbacksiz yolda row rect=x.
       Tur 5p: erken bump zaten aynı rect'i taşıdıysa ikinci bump
       atlanır (bump başına yeni epoch + piramit yaması boşa). */
    if (rasterEntry && typeof inkBumpPaintEpoch === 'function') {
      const snapSrc = direction === 'undo'
        ? rasterEntry.before : rasterEntry.after;
      const r = snapSrc && snapSrc.rect;
      const bolgeli = r && r.w > 0 && r.h > 0 &&
        r.w < (snapSrc.width || 1e9) && r.h < (snapSrc.height || 1e9);
      if (!bolgeliErken) {
        if (bolgeli) inkBumpPaintEpoch(layer.id, 'mutation', r);
        else inkBumpPaintEpoch(layer.id, 'mutation');
      }
    }
  }
  // EVRE 4-C: delta undo/redo tek bölgede etki — açık editörde tam kare
  // yeniden kompozit yerine bölgesel kare çipi besle. Bölge ≥ %60 tuval
  // ya da zincir bozuksa çip üretilmez (tam yol güvendiği yolda kalır).
  let undoChip = null;
  if (rasterDone && rasterEntry) {
    const snapSrc = direction === 'undo'
      ? rasterEntry.before : rasterEntry.after;
    const rectSrc = snapSrc && snapSrc.rect;
    if (rectSrc && snapSrc.width > 0) {
      const area = rectSrc.w * rectSrc.h;
      const total = snapSrc.width * snapSrc.height;
      if (area > 0 && area < total * 0.6) {
        undoChip = {
          x: rectSrc.x, y: rectSrc.y, w: rectSrc.w, h: rectSrc.h,
          spaceW: snapSrc.width, spaceH: snapSrc.height,
          // Sahip kilidi: bağımsız öğe/belge undo'su editör tuvalini
          // etkilemez; çip (yanlış renk uzayı) yerinde uygulanmasın.
          ownerId: layer.ownerId || null,
        };
      }
    }
  }
  if (typeof inkSyncDom === 'function') inkSyncDom();
  if (typeof inkUpdateGizmo === 'function') inkUpdateGizmo();
  // FAZ 8.B öte: vuruş delta undo/redo satır görünümünü 'property'
  // olayıyla duyurur (vuruş sayısı + boyama epoch'u değişir →
  // imza-diff satırı taze kurar, minyatür güncellenir). Elle panel
  // sync çağrısına bu yolda gerek kalmadı.
  if (typeof inkLayerStoreEmit === 'function') {
    inkLayerStoreEmit('property', {
      ownerId: layer.ownerId || null, layerId: layer.id, field: 'raster',
    });
  }
  // Açık editör kendi tuvalini ayrı çiziyor; veri değişse bile taban
  // önbelleği tazelenmezse geri al ekranda görünmüyordu ("Ctrl+Z bazen
  // çalışmıyor" hissinin ana nedeni).
  // DÜZELTME (10.11 kanıt): undo = İÇERİK SİLME. Çip yolu undo'da yarsız:
  // taban çerçevesi silinen vuruşun piksellerini hâlâ taşır ve bölgesel
  // source-over boyama şeffaf bölgede o pikselleri SİLEMEZ — "siyah
  // sarının arkasına geçti" illüzyonu (panel kanıtı: tuş ✓, undo ✓,
  // yığın dolu, görsel hatalı). Silme yönünde tam reset (öncü yol);
  // ekleme yönünde (commit/redo) çip doğru olduğu için kalır.
  if (typeof inkEditorAfterRestore === 'function') {
    inkEditorAfterRestore(direction === 'undo' ? null : undoChip);
  }
  scheduleSave();
  return true;
}
