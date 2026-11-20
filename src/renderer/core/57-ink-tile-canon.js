/* TailRef app · ink tile canon · FAZ 4 — Kas (plan madde 1)
   ------------------------------------------------------------------
   Kanon: 256×256 px karolar; ekran/yalın depo RGBA8'de kalır (tuval /
   tile canvas), RAM aynası **premultplied lineer Float32** uzamdadır.
   Tüm tüketiciler (tile-diff undo, smudge advected field, editor
   dirty-tile önizleme) bu aynadan okur; tuvale geri yazma tek kapıda.

   LRU: dokunulan tile sona taşınır; kapasite aşımında en eskisi
   (temiz/iç sıra) düşer. Kanon bir *aynadır* — display tuvaline çöp
   yazmaz; `flush` yalnızca çağıran ona hedef gösterirse yazar.

   Saf mantıktır: IO iki kapıyla gelir (readVolume / writeImageData),
   böylece tarayıcı olmadan da (node) altın örneklerle test edilir.
   ========================================================= */
'use strict';

var INK_CANON_TILE = 256;                 // px kenar (plan: 256×256)
var INK_CANON_PIXELS = INK_CANON_TILE * INK_CANON_TILE;
var INK_CANON_DEFAULT_MAX_TILES = 64;     // ≈64 MB lin ayna üst sınırı

var inkCanon = {
  tiles: new Map(),       // key -> { layerId, tx, ty, lin, stamp }
  maxTiles: INK_CANON_DEFAULT_MAX_TILES,
  stats: { mirrors: 0, flushes: 0, evictions: 0, hits: 0, misses: 0, diffs: 0 },
};

/* =========================================================
   lineer uzay çifti (56-ink-color ile birebir aynı inkâr yok:
   kanon modülü kendi minimal çiftini taşır — worker'da da kullanılır)
   ========================================================= */
function inkCanonSRGBToLin01(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function inkCanonLin01ToSRGB(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** RGBA8 bytes (0..255, premul DEĞİL) → premul lineer Float32 karoya. */
function inkCanonPatchToLin(patch /* Uint8ClampedArray RGBA */) {
  const n = patch.length >> 2;
  const lin = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const a = patch[j + 3] / 255;
    lin[j] = inkCanonSRGBToLin01(patch[j] / 255) * a;
    lin[j + 1] = inkCanonSRGBToLin01(patch[j + 1] / 255) * a;
    lin[j + 2] = inkCanonSRGBToLin01(patch[j + 2] / 255) * a;
    lin[j + 3] = a;
  }
  return lin;
}

/** Premul lineer karoya → RGBA8 bytes (0..255, premul değil). */
function inkCanonLinToPatch(lin) {
  const n = lin.length >> 2;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const a = lin[j + 3];
    if (a <= 0) { out[j + 3] = 0; continue; }
    out[j] = Math.round(inkCanonLin01ToSRGB(lin[j] / a) * 255);
    out[j + 1] = Math.round(inkCanonLin01ToSRGB(lin[j + 1] / a) * 255);
    out[j + 2] = Math.round(inkCanonLin01ToSRGB(lin[j + 2] / a) * 255);
    out[j + 3] = Math.round(a * 255);
  }
  return out;
}

/* =========================================================
   karo anahtar / kaplama listesi
   ========================================================= */
function inkCanonTileKey(layerId, tx, ty) {
  return layerId + ':' + tx + ',' + ty;
}

/** Dikdörtgenin (px) kapladığı karolar; kenar taşmaları tam karo okunur. */
function inkCanonTilesForRect(rect) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) return [];
  const tx0 = Math.floor(rect.x / INK_CANON_TILE);
  const ty0 = Math.floor(rect.y / INK_CANON_TILE);
  const tx1 = Math.floor((rect.x + rect.w - 1) / INK_CANON_TILE);
  const ty1 = Math.floor((rect.y + rect.h - 1) / INK_CANON_TILE);
  const out = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) out.push({ tx, ty });
  }
  return out;
}

/* =========================================================
   LRU havuz
   ========================================================= */
function inkCanonTouch(key) {
  // Map ekleme sırası = L least-recent: dokunulan yeniden takılır.
  const t = inkCanon.tiles.get(key);
  if (!t) return t;
  inkCanon.tiles.delete(key);
  inkCanon.tiles.set(key, t);
  return t;
}

function inkCanonEvictOne() {
  const first = inkCanon.tiles.keys().next();
  if (first.done) return false;
  inkCanon.tiles.delete(first.value);
  inkCanon.stats.evictions++;
  return true;
}

function inkCanonEnsureCapacityOrEvict(reserve = 0) {
  while (inkCanon.tiles.size + reserve >= inkCanon.maxTiles) {
    if (!inkCanonEvictOne()) break;
  }
}

function inkCanonSetTile(layerId, tx, ty, lin) {
  const key = inkCanonTileKey(layerId, tx, ty);
  const had = inkCanon.tiles.has(key);
  inkCanonEnsureCapacityOrEvict();
  // had ise sadece değeri yenile (sıra bozulmaz); yeniyse en sona ekle.
  inkCanon.tiles.set(key, { layerId, tx, ty, lin, stamp: 0 });
  if (!had) inkCanon.stats.misses++;
  else inkCanon.stats.hits++;
  return inkCanon.tiles.get(key);
}

/* =========================================================
   aynala / karşılaştır / akıt
   ========================================================= */

/** `readVolume(x, y, w, h) -> Uint8ClampedArray` ile karoları aynala. */
function inkCanonMirrorTiles(layerId, tiles, readVolume, out = null) {
  const mirrored = out || [];
  for (const t of tiles) {
    const x = t.tx * INK_CANON_TILE, y = t.ty * INK_CANON_TILE;
    const vol = readVolume(x, y, INK_CANON_TILE, INK_CANON_TILE);
    if (!vol) continue;
    const lin = inkCanonPatchToLin(vol);
    inkCanonSetTile(layerId, t.tx, t.ty, lin);
    inkCanonTouch(inkCanonTileKey(layerId, t.tx, t.ty));
    mirrored.push({ tx: t.tx, ty: t.ty, lin });
  }
  return mirrored;
}

/** Kannona dışarıdan (undo 'before' kuyruğu gibi) ikinci bir harita
 *  ağırlığı olmadan aynı istemci için ayrı madde gerekmez: diff, aynadaki
 *  lin ile YENİyeninin karşılaştırmasıdır.
 *  `readVolume` aynısı; dönüş: değişen tile listesi
 *  [{tx,ty, beforeLin, afterLin}], commit=true iken ayna yeniye taşınır. */
function inkCanonDiffTiles(layerId, tiles, readVolume, opts = {}) {
  const commit = opts.commit !== false;
  const tol = Number.isFinite(opts.tolerance) ? opts.tolerance : 1 / 255;
  const changed = [];
  for (const t of tiles) {
    const key = inkCanonTileKey(layerId, t.tx, t.ty);
    const cur = inkCanon.tiles.get(key);
    if (!cur) continue; // aynalanmamış karoda diff yapılmaz (mirror önce)
    const x = t.tx * INK_CANON_TILE, y = t.ty * INK_CANON_TILE;
    const vol = readVolume(x, y, INK_CANON_TILE, INK_CANON_TILE);
    if (!vol) continue;
    const after = inkCanonPatchToLin(vol);
    const before = cur.lin;
    let diff = false;
    const n = after.length;
    for (let i = 0; i < n; i++) {
      if (Math.abs(after[i] - before[i]) > tol) { diff = true; break; }
    }
    inkCanon.stats.diffs++;
    if (diff) {
    changed.push({ tx: t.tx, ty: t.ty, beforeLin: before, afterLin: after });
      if (commit) {
      // Ayna yeniye taşınır (before aynanın kendisidir; korunur).
      cur.lin = after;
      cur.stamp++;
      inkCanonTouch(key);
      }
    }
  }
  return changed;
}

/** Aynadaki karoları sRGB'ye çevirip `writeImageData(x, y, patch, w, h)` ile
 *  yazar — undo restore / editor dirty-tile birleştirici kullanır. */
function inkCanonFlushTiles(layerId, tiles, writeImageData) {
  for (const t of tiles) {
    const key = inkCanonTileKey(layerId, t.tx, t.ty);
    const cur = inkCanon.tiles.get(key);
    if (!cur) continue;
    const patch = inkCanonLinToPatch(cur.lin);
    writeImageData(
      t.tx * INK_CANON_TILE, t.ty * INK_CANON_TILE,
      patch, INK_CANON_TILE, INK_CANON_TILE
    );
    inkCanon.stats.flushes++;
    inkCanonTouch(key);
  }
}

/* =========================================================
   bölge katmanı — tek okuma karolara dilimlenir
   (undo capture'ı tuvale TEK getImageData yapıp bize region uzatır;
   kilitleme ve dizilim burada çözülür)
   ========================================================= */

/** Dikdörtgeni karo sınırlarına kırpılmış dilimlere ayırır. */
function inkCanonRegionSlices(rect) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) return [];
  const out = [];
  for (const t of inkCanonTilesForRect(rect)) {
    const x0 = t.tx * INK_CANON_TILE, y0 = t.ty * INK_CANON_TILE;
    const x = Math.max(rect.x, x0);
    const y = Math.max(rect.y, y0);
    const w = Math.min(rect.x + rect.w, x0 + INK_CANON_TILE) - x;
    const h = Math.min(rect.y + rect.h, y0 + INK_CANON_TILE) - y;
    if (w > 0 && h > 0) out.push({ tx: t.tx, ty: t.ty, x, y, w, h });
  }
  return out;
}

/** region içinden (offsetli) piksel dilimini lineere çevirir. */
function inkCanonRegionSliceToLin(region, slice) {
  const data = region && region.data;
  if (!data) return null;
  const lin = new Float32Array(slice.w * slice.h * 4);
  for (let row = 0; row < slice.h; row++) {
    const sy = slice.y - (region.modelY || 0) + row;
    for (let col = 0; col < slice.w; col++) {
      const sx = slice.x - (region.modelX || 0) + col;
      const o = (sy * region.width + sx) * 4;
      const d = (row * slice.w + col) * 4;
      lin[d] = data[o];
      lin[d + 1] = data[o + 1];
      lin[d + 2] = data[o + 2];
      lin[d + 3] = data[o + 3];
    }
  }
  return inkCanonPatchToLin(lin);
}

function inkCanonSliceIntoLin(lin /* tile lin */, sliceLin, slice) {
  const lx = slice.x - slice.tx * INK_CANON_TILE;
  const ly = slice.y - slice.ty * INK_CANON_TILE;
  for (let row = 0; row < slice.h; row++) {
    for (let col = 0; col < slice.w; col++) {
      const d = (row * slice.w + col) * 4;
      const j = ((ly + row) * INK_CANON_TILE + lx + col) * 4;
      lin[j] = sliceLin[d];
      lin[j + 1] = sliceLin[d + 1];
      lin[j + 2] = sliceLin[d + 2];
      lin[j + 3] = sliceLin[d + 3];
    }
  }
}

/** `region` (tek ImageData benzeri {width,height,data}; data bölge köşesinden
 *  başlar — mutlak koordinat için region.modelX/modelY verilebilir) karoları
 *  aynaya yazar. Karonun aynası yoksa ÖNCE tam karo okunur (`readVolume`) —
 *  bölge dışı içerik yanlış sıfırlanmaz. Döner: dilim listesi. */
function inkCanonPatchFromRegion(layerId, rect, region, readVolume) {
  const slices = inkCanonRegionSlices(rect);
  if (!slices.length) return slices;
  for (const slice of slices) {
    const key = inkCanonTileKey(layerId, slice.tx, slice.ty);
    /* DÜZELTME (profiler bulgusu): soğuk karoyu TAM 256×256 okuyarak
       aynalamak her vuruşta 10-20 getImageData üretiyordu (LRU=64;
       2560 basamaklı tuvalde bant değişince trash). Ayna yalnız zaten
       sıcak karolara güncellenir; soğuk karoda undo kaydı yalnız bölge
       dilimlerinden kurulur. Ayna tüketen yollar (diff/flush) karosuz
       durumda fail-soft davranır. */
    const tile = inkCanon.tiles.get(key);
    if (!tile) continue;
    const sliceLin = inkCanonRegionSliceToLin(region, slice);
    inkCanonSliceIntoLin(tile.lin, sliceLin, slice);
    tile.stamp++;
    inkCanonTouch(key);
  }
  return slices;
}

/** Aynı bölge aynadaki (öncesi) değerle karşılaştırılır; dönüş: değişen
 *  dilim listesi [{tx,ty,x,y,w,h}] (post-paint diff). commit iken ayna
 *  yalnız slice alanında yeniye taşınır. */
function inkCanonDiffFromRegion(layerId, rect, region, opts = {}) {
  const commit = opts.commit !== false;
  const tol = Number.isFinite(opts.tolerance) ? opts.tolerance : 1 / 255;
  const changed = [];
  for (const slice of inkCanonRegionSlices(rect)) {
    const key = inkCanonTileKey(layerId, slice.tx, slice.ty);
    const tile = inkCanon.tiles.get(key);
    if (!tile) continue;
    const sliceLin = inkCanonRegionSliceToLin(region, slice);
    if (!sliceLin) continue;
    const lx = slice.x - slice.tx * INK_CANON_TILE;
    const ly = slice.y - slice.ty * INK_CANON_TILE;
    let differs = false;
    for (let row = 0; row < slice.h && !differs; row++) {
      for (let col = 0; col < slice.w; col++) {
        const d = (row * slice.w + col) * 4;
        const j = ((ly + row) * INK_CANON_TILE + lx + col) * 4;
        if (Math.abs(sliceLin[d] - tile.lin[j]) > tol ||
            Math.abs(sliceLin[d + 1] - tile.lin[j + 1]) > tol ||
            Math.abs(sliceLin[d + 2] - tile.lin[j + 2]) > tol ||
            Math.abs(sliceLin[d + 3] - tile.lin[j + 3]) > tol) {
          differs = true;
          break;
        }
      }
    }
    inkCanon.stats.diffs++;
    if (!differs) continue;
    changed.push({ tx: slice.tx, ty: slice.ty, x: slice.x, y: slice.y, w: slice.w, h: slice.h });
    if (commit) {
      inkCanonSliceIntoLin(tile.lin, sliceLin, slice);
      tile.stamp++;
      inkCanonTouch(key);
    }
  }
  return changed;
}

/* =========================================================
   ömür
   ========================================================= */
function inkCanonInvalidate(layerId) {
  if (!layerId) { inkCanonClear(); return; }
  const prefix = layerId + ':';
  for (const key of Array.from(inkCanon.tiles.keys())) {
    if (key.startsWith(prefix)) inkCanon.tiles.delete(key);
  }
}

function inkCanonClear() {
  inkCanon.tiles.clear();
  inkCanon.stats = { mirrors: 0, flushes: 0, evictions: 0, hits: 0, misses: 0, diffs: 0 };
}

function inkCanonStats() {
  return {
    tiles: inkCanon.tiles.size,
    maxTiles: inkCanon.maxTiles,
    mb: +(inkCanon.tiles.size * INK_CANON_PIXELS * 4 * 4 / (1024 * 1024)).toFixed(2),
    evictions: inkCanon.stats.evictions,
    mirrors: inkCanon.stats.mirrors,
    flushes: inkCanon.stats.flushes,
    diffs: inkCanon.stats.diffs,
  };
}
