'use strict';
/* FAZ 6 madde 14 probe: WIDE-GAMUT (Display-P3) hazırlık denetimi.
   Saf Node — tarayıcı gerekmez. Kapsam:
   • A · KAYNAK DENETİMİ: tüm getContext('2d') çağrılarında açık
     colorSpace bildirimi (srgb|display-p3) — örtük davranışa kapı yok.
   • B · OKLAB ÇEKİRDEĞİ (56-ink-color): Ottosson altın vektörleri,
     lineer↔OKLab gidiş-dönüş baskınlığı, geniş-gam lineerde NaN yok.
   • C · TILE AYNASI (57-ink-tile-canon): Float32 premul lin karoda
     geniş-gam değerleri (<0 ve >1) BİREBİR korunur; diff toleransı
     kararı; flush yalnızca 8-bit sınırında sıkıştırır.
   • D · P3 BENZETİMİ: Display-P3 doğrusal → sRGB-doğrusal matrisiyle
     P3 kırmızısı sRGB koordinatlarında negatif kanal üretir; OKLab
     finite; P3-kırmızı ile sRGB-kırmızının OKLCH kroması ayrışır.
   Kullanım: node scripts/wide-gamut-test.js */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const info = detail === undefined ? '' : ' → ' + JSON.stringify(detail);
  if (cond) { pass++; console.log('OK   ' + name + info); }
  else { fail++; console.log('HATA ' + name + info); }
}

/* ---------------------------------------------------------------
   sandbox: 56-ink-color.js + 57-ink-tile-canon.js (DOM'suz)
   --------------------------------------------------------------- */
const sandbox = { Math, console, Float32Array, Uint8ClampedArray };
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'core', '56-ink-color.js'), 'utf8'),
  sandbox);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'core', '57-ink-tile-canon.js'), 'utf8'),
  sandbox);
const {
  inkLinearToOkLab, inkOkLabToLinear, inkOkLabToOkLch,
  inkCanon, inkCanonSetTile, inkCanonTileKey, inkCanonDiffTiles,
  inkCanonFlushTiles, inkCanonLinToPatch, inkCanonPatchToLin,
  inkCanonStats, inkCanonClear,
  inkCanonLin01ToSRGB,
} = sandbox;

/* ===============================================================
   A · kaynak denetimi: her getContext('2d') açık colorSpace ister
   =============================================================== */
function auditColorSpaces() {
  const files = ['src/renderer/canvas/draw-v5.js'].concat(fs.readdirSync(path.join(ROOT, 'src', 'renderer', 'core'))
    .filter(x => x.endsWith('.js')).map(x => 'src/renderer/core/' + x));
  const missing = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    let idx = 0;
    while (true) {
      idx = text.indexOf("getContext('2d", idx);
      if (idx < 0) break;
      /* çağrının paren dengesini yürü: argüman listesini çıkar */
      const open = text.indexOf('(', idx + 11);
      let depth = 0, end = open;
      for (; end < text.length; end++) {
        if (text[end] === '(') depth++;
        else if (text[end] === ')') { depth--; if (depth === 0) break; }
      }
      const args = text.slice(open, end);
      if (args.includes('2d') && !args.includes('colorSpace')) {
        const line = text.slice(0, open).split('\n').length;
        missing.push(file + ':' + line);
      }
      idx = end;
    }
  }
  return missing;
}

/* Display-P3 doğrusal → sRGB doğrusal (D65; iki beyaz aynı) */
const M_P3_TO_XYZ = [
  [0.4865709, 0.2656677, 0.1982173],
  [0.2289746, 0.6917385, 0.0792869],
  [0.0000000, 0.0451134, 0.9154887],
];
const M_XYZ_TO_SRGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [0.0556434, -0.2040259, 1.0572252],
];
function p3ToSrgbLin(rgb) {
  return M_XYZ_TO_SRGB.map(row => {
    const xyz = M_P3_TO_XYZ.map(prow =>
      prow.reduce((s, m, c) => s + m * rgb[c], 0));
    return row.reduce((s, m, c) => s + m * xyz[c], 0);
  });
}

const near = (a, b, eps) => Math.abs(a - b) <= eps;

(async () => {
  /* A · açık colorSpace ---------------------------------------- */
  const missing = auditColorSpaces();
  ok('A · her getContext açık colorSpace bildirir (0 eksiği)',
    missing.length === 0, missing.slice(0, 8).join(' ') || null);

  /* B · Ottosson altın vektörleri ------------------------------ */
  const GOLDEN = [
    { name: 'beyaz', lin: [1, 1, 1], L: 1.0, a: 0.0, b: 0.0 },
    { name: 'kırmızı', lin: [1, 0, 0], L: 0.627955, a: 0.224863, b: 0.125846 },
    { name: 'yeşil', lin: [0, 1, 0], L: 0.866444, a: -0.233887, b: 0.179498 },
    { name: 'mavi', lin: [0, 0, 1], L: 0.452014, a: -0.032457, b: -0.311528 },
  ];
  let goldenOK = true, goldenBad = null;
  for (const g of GOLDEN) {
    const lab = inkLinearToOkLab(g.lin[0], g.lin[1], g.lin[2]);
    if (!lab || !near(lab.L, g.L, 0.0015) || !near(lab.a, g.a, 0.0015) ||
      !near(lab.b, g.b, 0.0015)) { goldenOK = false; goldenBad = g.name; break; }
  }
  ok('B · Ottosson altın vektörleri (beyaz/kırmızı/yeşil/mavi)', goldenOK,
    goldenBad || null);

  /* gidiş-dönüş: gam DIŞI lineer aralık dahil [-0.3 .. 1.6] */
  let rtOK = true, rtMax = 0;
  for (let v = -0.3; v <= 1.6; v += 0.0071) {
    const lab = inkLinearToOkLab(v, v * 0.7, v * 0.4);
    if (!lab || !Number.isFinite(lab.L) || !Number.isFinite(lab.a) ||
      !Number.isFinite(lab.b)) { rtOK = false; break; }
    const back = inkOkLabToLinear(lab.L, lab.a, lab.b);
    if (!back || !Number.isFinite(back.r) || !Number.isFinite(back.g) ||
      !Number.isFinite(back.b)) { rtOK = false; break; }
    rtMax = Math.max(rtMax,
      Math.abs(back.r - v), Math.abs(back.g - v * 0.7),
      Math.abs(back.b - v * 0.4));
  }
  ok('B · lin↔OKLab gidiş-dönüş (geniş-gam dahil) baskın ≤1e-6',
    rtOK && rtMax <= 1e-6, 'max=' + rtMax.toExponential(2));

  /* C · ayna: geniş-gam değerler karoda birebir yaşar ----------- */
  inkCanonClear();
  const sweep = new Float32Array(256 * 256 * 4);
  for (let px = 0; px < 256 * 256; px++) {
    const t = px / (256 * 256);
    const j = px * 4;
    sweep[j] = 1.35 * (1 - t) - 0.25 * t;      /* +1.35 → −0.25 süpürme */
    sweep[j + 1] = -0.15 + 1.5 * t;            /* −0.15 → +1.35 süpürme */
    sweep[j + 2] = (px % 64) / 64;
    sweep[j + 3] = 1;
  }
  inkCanonSetTile('wg_test', 0, 0, sweep);
  const mirrored = inkCanon.tiles.get(inkCanonTileKey('wg_test', 0, 0)).lin;
  let worst = 0;
  for (let i = 0; i < sweep.length; i++)
    worst = Math.max(worst, Math.abs(sweep[i] - mirrored[i]));
  ok('C · Float32 ayna geniş-gam değerleri birebir (Float32 eps)',
    mirrored.length === sweep.length && worst <= 2e-6,
    'maxDiff=' + worst.toExponential(2));

  /* diff sözleşmesi: ayna da RGBA8 patch'ten kurulur (üretimdeki
     gibi) → 8-biti aşan fark yakalanır, birebir eşleşme sessiz. */
  const basePatch = new Uint8ClampedArray(inkCanonLinToPatch(mirrored));
  /* ortadan bir RENK kanalı seç (60..200 bandı): kenar değerler 8-bit
     sınırında sıkıştığı için +1 LSB yutulmaz; alpha kanalı (idx%4==3)
     hariç tutulur. */
  let sbi = -1;
  for (let i = 0; i < basePatch.length; i++) {
    if (i % 4 !== 3 && basePatch[i] >= 150 && basePatch[i] <= 250) { sbi = i; break; }
  }
  inkCanonSetTile('wg_diff', 0, 0, inkCanonPatchToLin(basePatch));
  const subtle = new Uint8ClampedArray(basePatch);
  subtle[sbi] += 1;                              /* 1 lin LSB fark */
  const changed = inkCanonDiffTiles('wg_diff', [{ tx: 0, ty: 0 }],
    () => subtle, { tolerance: 1 / 255 });
  inkCanonSetTile('wg_diff2', 0, 0, inkCanonPatchToLin(basePatch));
  const unchanged = inkCanonDiffTiles('wg_diff2', [{ tx: 0, ty: 0 }],
    () => basePatch, { tolerance: 1 / 255 });
  ok('C · diff 8-biti aşan farkı yakalar / birebir eşleşme sessiz',
    changed.length === 1 && unchanged.length === 0,
    'changed=' + changed.length + ' unchanged=' + unchanged.length +
    ' stats.diffs=' + inkCanonStats().diffs);

  /* flush: lin aynasından sRGB'ye yalnızca 8-bit sınırında sıkışır */
  const flushTile = new Float32Array(4);
  flushTile[0] = 1.6; flushTile[1] = -0.3; flushTile[2] = 0.5; flushTile[3] = 1;
  inkCanonSetTile('wg_flush', 0, 0, flushTile);
  let flushed = null;
  inkCanonFlushTiles('wg_flush', [{ tx: 0, ty: 0 }],
    (x, y, patch) => { flushed = patch; });
  ok('C · flush 8-bit sınırı: lin>1 → 255, lin<0 → 0',
    !!flushed && flushed[0] === 255 && flushed[1] === 0 &&
    flushed[2] > 100 && flushed[2] < 200,
    flushed && Array.from(flushed.slice(0, 3)));

  /* D · P3 benzetimi ------------------------------------------- */
  const p3Red = p3ToSrgbLin([1, 0, 0]);
  ok('D · P3-kırmızı sRGB-lin: R>1, G<0 (geniş-gam kanıtı)',
    Number.isFinite(p3Red[0]) && p3Red[0] > 1 && p3Red[1] < 0,
    p3Red.map(v => +v.toFixed(4)));

  const p3Lab = inkLinearToOkLab(p3Red[0], p3Red[1], p3Red[2]);
  ok('D · P3-kırmızı OKLab finite',
    !!p3Lab && Number.isFinite(p3Lab.L) && Number.isFinite(p3Lab.a) &&
    Number.isFinite(p3Lab.b),
    p3Lab && { L: +p3Lab.L.toFixed(4), a: +p3Lab.a.toFixed(4),
      b: +p3Lab.b.toFixed(4) });

  const p3Lch = p3Lab && inkOkLabToOkLch(p3Lab.L, p3Lab.a, p3Lab.b);
  const srgbLab = inkLinearToOkLab(1, 0, 0);
  const srgbLch = inkOkLabToOkLch(srgbLab.L, srgbLab.a, srgbLab.b);
  const dc = (p3Lch && srgbLch) ? Math.abs(p3Lch.c - srgbLch.c) : NaN;
  ok('D · P3-kırmızı kroması sRGB-kırmızından ayrışır (>0.02)',
    Number.isFinite(dc) && dc > 0.02,
    { cP3: +p3Lch.c.toFixed(4), cSrgb: +srgbLch.c.toFixed(4), dc: +dc.toFixed(4) });

  /* P3-yeşil → 8-bit tohum → kanon lineeri: gidiş-dönüş ≤1 LSB */
  const p3Green = p3ToSrgbLin([0, 1, 0]);
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const seed = new Uint8ClampedArray(4);
  seed[0] = Math.round(inkCanonLin01ToSRGB(clamp01(p3Green[0])) * 255);
  seed[1] = Math.round(inkCanonLin01ToSRGB(clamp01(p3Green[1])) * 255);
  seed[2] = Math.round(inkCanonLin01ToSRGB(clamp01(p3Green[2])) * 255);
  seed[3] = 255;
  const seedLin = inkCanonPatchToLin(seed);
  const back8 = inkCanonLinToPatch(seedLin);
  ok('D · P3-yeşil 8-bit tohum ↔ kanon lin gidiş-dönüş ≤1 LSB',
    Math.abs(seed[0] - back8[0]) <= 1 && Math.abs(seed[1] - back8[1]) <= 1 &&
    Math.abs(seed[2] - back8[2]) <= 1,
    Array.from(seed.slice(0, 3)) + ' → ' + Array.from(back8.slice(0, 3)));

  const failed = fail > 0;
  console.log('\nWG-PROBE: ' + pass + '/' + (pass + fail) + ' yeşil' +
    (failed ? ' — ' + fail + ' hata' : ''));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('WG-PROBE hata:', e); process.exit(1); });
