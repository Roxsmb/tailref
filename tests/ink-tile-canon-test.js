'use strict';

/* Ink tile canon (FAZ 4, madde 1) birim testi — saf Node, tarayıcı gerekmez.

   Kapsam (docs/ARCH-RESCUE-PLAN.md FAZ 4):
   • Tile kanonu: 256×256 px karo, RAM aynası premul lineer Float32.
   • Lineer uzay çifti: sRGB↔lin gidiş-dönüş, premul çarpımı doğru.
   • Aynala → karşılaştır (diff) → commit: değişmeden 0, değişen tile'dan
     sonra ayna tazelenir (ikinci diff 0).
   • Akıt (flush): lin aynasından sRGB'ye ≤1 LSB.
   • LRU dokunuş + kapasite aşımında en eski düşer.
   • Ömür: katman bazlı geçersizleme yabancı katmana dokunmaz.

   Kullanım: node scripts/ink-tile-canon-test.js */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'core', '57-ink-tile-canon.js');
const sandbox = { Math, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);

const {
  INK_CANON_TILE, inkCanon,
  inkCanonTilesForRect, inkCanonPatchToLin, inkCanonLinToPatch,
  inkCanonMirrorTiles, inkCanonDiffTiles, inkCanonFlushTiles,
  inkCanonInvalidate, inkCanonClear, inkCanonStats,
  inkCanonSRGBToLin01, inkCanonLin01ToSRGB, inkCanonTileKey,
  inkCanonTouch, inkCanonSetTile, inkCanonEvictOne,
  inkCanonRegionSlices, inkCanonPatchFromRegion, inkCanonDiffFromRegion,
} = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const info = detail === undefined ? '' : ' → ' + JSON.stringify(detail);
  if (cond) { pass++; console.log('OK   ' + name + info); }
  else { fail++; console.log('HATA ' + name + info); }
}

/* Sahte tuval: RGBA8 bytes dizisi; sınıra taşan okuma şeffaf siyah döndürür. */
function makeSurface(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  return {
    width: w, height: h, data,
    read(x, y, w2, h2) {
      const out = new Uint8ClampedArray(w2 * h2 * 4);
      for (let r = 0; r < h2; r++) {
        const yy = y + r;
        if (yy < 0 || yy >= this.height) continue;
        for (let c = 0; c < w2; c++) {
          const xx = x + c;
          if (xx < 0 || xx >= this.width) continue;
          const s = (yy * this.width + xx) * 4;
          const d = (r * w2 + c) * 4;
          out[d] = this.data[s];
          out[d + 1] = this.data[s + 1];
          out[d + 2] = this.data[s + 2];
          out[d + 3] = this.data[s + 3];
        }
      }
      return out;
    },
    write(x, y, patch, w2, h2) {
      for (let r = 0; r < h2; r++) {
        const yy = y + r;
        if (yy < 0 || yy >= this.height) continue;
        for (let c = 0; c < w2; c++) {
          const xx = x + c;
          if (xx < 0 || xx >= this.width) continue;
          const s = (r * w2 + c) * 4;
          const d = (yy * this.width + xx) * 4;
          this.data[d] = patch[s];
          this.data[d + 1] = patch[s + 1];
          this.data[d + 2] = patch[s + 2];
          this.data[d + 3] = patch[s + 3];
        }
      }
    },
  };
}

/* ---- 1 · sabitler ve karo kaplaması ---- */
ok('karo kenarı 256 px', INK_CANON_TILE === 256, INK_CANON_TILE);
ok('küçük dikdörtgen 4 komşu karoyu kaplar',
  inkCanonTilesForRect({ x: 255, y: 255, w: 2, h: 2 }).length === 4,
  inkCanonTilesForRect({ x: 255, y: 255, w: 2, h: 2 }));
ok('tam iki karo dikdörtgen',
  JSON.stringify(inkCanonTilesForRect({ x: 0, y: 0, w: 512, h: 512 })) ===
  JSON.stringify([{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }, { tx: 0, ty: 1 }, { tx: 1, ty: 1 }]));
ok('bos dikdörtgen karosuz',
  inkCanonTilesForRect(null).length === 0 && inkCanonTilesForRect({ x: 4, y: 4, w: 0, h: 0 }).length === 0);
ok('tek karo hizalı dikdörtgen',
  JSON.stringify(inkCanonTilesForRect({ x: 256, y: 512, w: 256, h: 256 })) === JSON.stringify([{ tx: 1, ty: 2 }]));

/* ---- 2 · lineer uzay çifti ---- */
{
  const e = 2e-3;
  ok('0 → 0, 1 → 1 lineer',
    inkCanonSRGBToLin01(0) === 0 && Math.abs(inkCanonSRGBToLin01(1) - 1) < 1e-12);
  ok('0.04045 kırılmasında süreklilik',
    Math.abs(inkCanonSRGBToLin01(0.04044) - inkCanonSRGBToLin01(0.04045)) < e,
    { lo: inkCanonSRGBToLin01(0.04044), hi: inkCanonSRGBToLin01(0.04045) });
  const back = inkCanonLin01ToSRGB(inkCanonSRGBToLin01(0.5));
  ok('sRGB→lin→sRGB gidiş-dönüş (±2e-3)', Math.abs(back - 0.5) < e, { back: +back.toFixed(5) });
}

/* ---- 3 · premul lineer patch ---- */
{
  // Tam opak kırmızı
  const op = inkCanonPatchToLin(new Uint8ClampedArray([255, 0, 0, 255]));
  ok('opak kırmızı lin (1,0,0,1)',
    Math.abs(op[0] - 1) < 1e-9 && op[1] === 0 && op[2] === 0 && op[3] === 1);
  // Yarı şeffaf yeşil: lin = SRGB_TO_LIN(.5) * .5
  const se = inkCanonPatchToLin(new Uint8ClampedArray([0, 128, 0, 128]));
  const linHalf = inkCanonSRGBToLin01(128 / 255) * (128 / 255);
  ok('premul: a×c lineerde saklanır',
    Math.abs(se[1] - linHalf) < 1e-6 && Math.abs(se[3] - 128 / 255) < 1e-6,
    { lin: +se[1].toFixed(6), want: +linHalf.toFixed(6) });
  // Şeffaf piksel tüm kanallar 0
  const tp = inkCanonPatchToLin(new Uint8ClampedArray([255, 255, 255, 0]));
  ok('şeffaf piksel linde tamamen 0', tp.every(v => v === 0));
}

/* ---- 4 · aynala → akıt birebir (dama örgüsü dağıtımlı) ---- */
{
  inkCanon.maxTiles = 8;
  const SW = 640, SH = 384;
  const s = makeSurface(SW, SH);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4;
      const on = ((x >> 3) + (y >> 3)) % 2 === 0;
      s.data[i] = on ? 240 : 12;
      s.data[i + 1] = on ? 100 : 60;
      s.data[i + 2] = 90;
      // Sağ etek yarım şeffaftır (kenar karo kaybı eğilsin).
      s.data[i + 3] = (x >= 600) ? Math.round(255 * (x - 600 + 20) / 40) : (y % 2 ? 255 : 90);
    }
  }
  const L = 'ly_canon-test';
  inkCanonClear();
  const tiles = inkCanonTilesForRect({ x: 0, y: 0, w: SW, h: SH });
  ok('640×384 → 6 karo', tiles.length === 6, tiles.length);
  inkCanonMirrorTiles(L, tiles, (x, y, w, h) => s.read(x, y, w, h));
  ok('ayna havuzunu doldurdu', inkCanon.tiles.size === tiles.length, inkCanon.tiles.size);
  // Akıt: yeni temiz yüzeye tam kontrollülükle taşınmalı.
  const t2 = makeSurface(SW, SH);
  inkCanonFlushTiles(L, tiles,
    (x, y, patch, w, h) => t2.write(x, y, patch, w, h));
  let off = 0, maxOff = 0;
  for (let i = 0; i < s.data.length; i++) {
    const d = Math.abs(s.data[i] - t2.data[i]);
    if (d > maxOff) maxOff = d;
    if (d > 1) off++;
  }
  ok('akıt ≤1 LSB (640×384 kaplama)', off === 0 && maxOff <= 1, { off, maxOff });
}

/* ---- 5 · diff: zmian algılanır, commit ayna tazeler ---- */
{
  inkCanon.maxTiles = 64;
  inkCanonClear();
  const SW = 512, SH = 256;
  const a = makeSurface(SW, SH);
  for (let i = 3; i < a.data.length; i += 4) a.data[i] = 200;
  a.data[0] = 30; a.data[1] = 200; a.data[2] = 120; a.data[3] = 255;
  const L = 'ly_diff';
  const tiles = inkCanonTilesForRect({ x: 0, y: 0, w: SW, h: SH });
  inkCanonMirrorTiles(L, tiles, (x, y, w, h) => a.read(x, y, w, h));
  // Değişiklik yok
  const d0 = inkCanonDiffTiles(L, tiles, (x, y, w, h) => a.read(x, y, w, h), { commit: true });
  ok('değişimsiz difften tile çıkmaz', d0.length === 0, d0.length);
  // Bir tile'da tek piksel değiş (tile[2,1] = x∈[512..767]… 512 genişlik → tx1: x≥256)
  const x2 = 300, y2 = 100;
  const idx = (y2 * SW + x2) * 4;
  const before = Array.from(a.data.slice(idx, idx + 4));
  a.data[idx] = 200; a.data[idx + 1] = 40; a.data[idx + 2] = 9;
  const d1 = inkCanonDiffTiles(L, tiles, (x, y, w, h) => a.read(x, y, w, h), { commit: true });
  ok('tek piksel değişimi doğru tileyi işaretler',
    d1.length === 1 && d1[0].tx === 1 && d1[0].ty === 0, d1.map(t => t.tx + ',' + t.ty));
  ok('diff sonrası ayna yeniye taşındı (ikinci diff 0)',
    inkCanonDiffTiles(L, tiles, (x, y, w, h) => a.read(x, y, w, h)).length === 0);
  // commit=false yapılmış diff yapısı: ayna sabit kalır
  const x3 = 100, y3 = 50, idx3 = (y3 * SW + x3) * 4;
  a.data[idx3] = 250; a.data[idx3 + 3] = 30;
  const d2 = inkCanonDiffTiles(L, tiles, (x, y, w, h) => a.read(x, y, w, h), { commit: false });
  ok('commit=false diff ayna bozmaz',
    d2.length === 1 &&
    inkCanonDiffTiles(L, tiles, (x, y, w, h) => a.read(x, y, w, h), { commit: false }).length === 1,
    d2.length && { kept: inkCanonDiffTiles(L, tiles, (x, y, w, h) => a.read(x, y, w, h), { commit: false }).length });
  ok('beforeLin korunuyor (non-commit)', !!d2[0].beforeLin);
  // Aynalanmamış tile'da diff oluşmaz
  const d3 = inkCanonDiffTiles('ly yok', tiles, (x, y, w, h) => a.read(x, y, w, h));
  ok('aynalanmamış katmanda diff teessüb etmiyor', d3.length === 0, { d3 });
}

/* ---- 6 · LRU dokunuşça en eski düşer ---- */
{
  inkCanonClear();
  inkCanon.maxTiles = 3;
  const sk = () => makeSurface(256, 256);
  const vol = () => new Uint8ClampedArray(256 * 256 * 4);
  inkCanonSetTile('L', 0, 0, new Float32Array(256 * 256 * 4));
  inkCanonSetTile('L', 1, 0, new Float32Array(256 * 256 * 4));
  inkCanonSetTile('L', 2, 0, new Float32Array(256 * 256 * 4));
  inkCanonTouch(inkCanonTileKey('L', 0, 0));        // t0 → en yeni
  inkCanonSetTile('L', 3, 0, new Float32Array(256 * 256 * 4)); // kapasite aşımı
  ok('kapasite aşımında evict', inkCanon.stats.evictions >= 1, inkCanon.stats.evictions);
  ok('dokunulan (0,0) hala yaşıyor', !!inkCanon.tiles.get(inkCanonTileKey('L', 0, 0)));
  ok('en eskiler düşmüş (1,0 ve 2,0 gitti)',
    !inkCanon.tiles.get(inkCanonTileKey('L', 1, 0)) &&
    inkCanon.tiles.get(inkCanonTileKey('L', 3, 0)) != null,
    Array.from(inkCanon.tiles.keys()));
  // havuz stat: mb doğru tahmini
  const st = inkCanonStats();
  ok('stats mb tutarlı', st.tiles === 3 && Math.abs(st.mb - (3 * 256 * 256 * 4 * 4 / 1048576)) < 0.01, st);
}

/* ---- 7 · katman bazlı ömür ---- */
{
  inkCanonClear();
  inkCanon.maxTiles = 16;
  const vol = () => new Uint8ClampedArray(256 * 256 * 4);
  inkCanonSetTile('A', 0, 0, new Float32Array(4));
  inkCanonSetTile('A', 1, 0, new Float32Array(4));
  inkCanonSetTile('B', 0, 0, new Float32Array(4));
  inkCanonInvalidate('A');
  ok('katman geçersizlenince yabancı katman durur',
    !inkCanon.tiles.get(inkCanonTileKey('A', 0, 0)) &&
    !inkCanon.tiles.get(inkCanonTileKey('A', 1, 0)) &&
    !!inkCanon.tiles.get(inkCanonTileKey('B', 0, 0)));
  inkCanonInvalidate(null);
  ok('tam temizleme', inkCanon.tiles.size === 0 && inkCanon.stats.diffs === 0);
}

/* ---- 8 · bölge katmanı: dilimleme + patch + diff ---- */
{
  inkCanonClear();
  inkCanon.maxTiles = 16;
  const L = 'ly_region';
  // 640×320 yüzey; 3 karo kaplar (tx:0..2, ty:0..1 → 6)
  const SW = 640, SH = 320;
  const s = makeSurface(SW, SH);
  for (let i = 3; i < s.data.length; i += 4) s.data[i] = 255; // opak zemin
  // Dikdörtgen karolar arası: x∈[200..620), y∈[240..300] → 3 sütun × 2 satır
  const rect = { x: 200, y: 240, w: 420, h: 60 };
  const slices = inkCanonRegionSlices(rect);
  ok('bölge 6 dilime kırpılır (karo sınırları)',
    slices.length === 6 &&
    slices.every(sl => sl.w <= 256 && sl.h <= 256), slices.map(sl => sw2(sl)));
  function sw2(sl) { return sl.tx + ',' + sl.ty + ' ' + sl.x + ',' + sl.y + ' ' + sl.w + 'x' + sl.h; }

  // 1) SICAK karolar önceden aynalanır (önceki boyama dönemi); patch bölge
  //    dilimlerini ancak SICAK karo üstüne işler. Soğuk karo aynalanmaz:
  //    performans semantiği — soğuk tam-karo okuması LRU'da bant değişince
  //    trash ölüveriyordu; undo kaydı bölge dilimlerinden kurulur, ayna
  //    tüketen yollar karosuz durumda fail-soft davranır.
  const tilesWarm = [{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }];
  inkCanonMirrorTiles(L, tilesWarm, (x, y, w, h) => s.read(x, y, w, h));
  const region1 = { width: rect.w, height: rect.h, data: s.read(rect.x, rect.y, rect.w, rect.h),
    modelX: rect.x, modelY: rect.y };
  inkCanonPatchFromRegion(L, rect, region1,
    (x, y, w, h) => s.read(x, y, w, h));
  // patch sonrası diff (aynı içerik) → değişen dilim yok
  const dSame = inkCanonDiffFromRegion(L, rect, region1);
  ok('aynı bölgede patch tekrar → diff 0', dSame.length === 0, dSame.length);
  // soğuk karo aynaya girmemiş olmalı (bölge-dilim semantiği)
  ok('soğuk karo aynalanmaz (patch yalnız sıcak karoyu günceller)',
    !inkCanon.tiles.get(inkCanonTileKey(L, 2, 0)) &&
    !inkCanon.tiles.get(inkCanonTileKey(L, 0, 1)) &&
    !!inkCanon.tiles.get(inkCanonTileKey(L, 0, 0)),
    { soğuk2_0: !!inkCanon.tiles.get(inkCanonTileKey(L, 2, 0)),
      soğuk0_1: !!inkCanon.tiles.get(inkCanonTileKey(L, 0, 1)),
      sıcak0_0: !!inkCanon.tiles.get(inkCanonTileKey(L, 0, 0)) });
  // sıcak karoların flush'u yüzeye birebir oturur (yalnız o karo alanları)
  const t2 = makeSurface(SW, SH);
  inkCanonFlushTiles(L, tilesWarm, (x, y, patch, w, h) => t2.write(x, y, patch, w, h));
  let regionOff = 0;
  const tileRange = [[0, 0], [1, 0]];
  for (const [tx, ty] of tileRange) {
    for (let y = ty * 256; y < (ty + 1) * 256; y++) {
      for (let x = tx * 256; x < (tx + 1) * 256; x++) {
        const i = (y * SW + x) * 4;
        if (Math.abs(s.data[i] - t2.data[i]) > 1) regionOff++;
      }
    }
  }
  ok('sıcak karo flush yüzeyle ≤1 LSB', regionOff === 0, { off: regionOff });

  // 2) diff: sıcak karo içinde tek piksel değişir → yalnız o dilim işaretlenir
  const idx = (250 * SW + 210) * 4; // y=250,x=210 → dilim (0,0)
  s.data[idx] = 9; s.data[idx + 3] = 40;
  const region2 = { width: rect.w, height: rect.h, data: s.read(rect.x, rect.y, rect.w, rect.h),
    modelX: rect.x, modelY: rect.y };
  const changed = inkCanonDiffFromRegion(L, rect, region2, { commit: true });
  ok('değişen tek dilim işaretlendi',
    changed.length === 1 && changed[0].x === 200 && changed[0].y === 240,
    changed.map(c => c.tx + ',' + c.ty));
  ok('commit sonrası ikinci diff 0',
    inkCanonDiffFromRegion(L, rect, region2).length === 0);
}

console.log('');
if (fail === 0) console.log(`TÜM TESTLER GEÇTİ (${pass}/${pass})`);
else console.log(`BAŞARISIZ (${fail} hata / ${pass} ok)`);
process.exit(fail === 0 ? 0 : 1);
