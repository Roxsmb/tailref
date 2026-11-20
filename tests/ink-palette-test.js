/* TailRef · ink-palette-test
   ------------------------------------------------------------------
   FAZ 3-3 paletleyici (09-palette-wheel.js) saf birim testleri.
   Kapsam:
     • buildPaletteCandidates — OKLab toplama, OKLCH aile/l düzey kutu
       eşleme, canlılık puanı
     • paletteGap — OKLCH H/L/C boşluk ölçümü (chroma normalizasyonu)
     • pickPaletteColors — aile temsili + 10 slot
     • fillPaletteToTen — OKLCH shade doldurma / benzersizlik
     • sortPaletteColors — gri en sona, kromatikler içinde hue sırası
   Bağlılık: 56-ink-color.js (inkRgbBytesToOkLch / inkOkLabToBytes /
   inkOkLchToBytes / inkHexToOkLch) aynı sandbox'a bitişik yüklenir.
   Çalıştırma: repo kökünden `node scripts/ink-palette-test.js`
   ========================================================= */
'use strict';

const fs = require('fs');
const vm = require('vm');

const SRC56 = 'src/renderer/core/56-ink-color.js';
const SRC09 = 'src/renderer/core/09-palette-wheel.js';

/* 09 modülünün uç düzey DOM bağlantıları yalnızca stub'lanır; saf
   fonksiyonlar gerçek ortam elden (browser bundle + vm) aynıdır. */
const elStub = () => ({ addEventListener () {}, onclick: null });
const sandbox = {
  Math,
  btnPalette: elStub(),
  $: () => elStub(),
  window: { addEventListener () {} },
  itemBarEl: { querySelector: () => null },
};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(SRC56, 'utf8') + '\n' + fs.readFileSync(SRC09, 'utf8'),
  sandbox,
  { filename: 'vm:56+09' });

const {
  paletteGap, buildPaletteCandidates, pickPaletteColors,
  fillPaletteToTen, sortPaletteColors, inkHexToOkLch,
} = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const mark = cond ? 'OK  ' : 'HATA';
  const extra = cond ? '' : '  → ' + JSON.stringify(detail);
  console.log(mark, name, extra);
  if (cond) pass++; else fail++;
}
function near(x, y, eps) { return Math.abs(x - y) <= (eps || 1e-4); }

/** RAF piksel dizisi {rgb:[r,g,b], n: tekrar} kayıtlarından getClass
    ikili dizisi üretir. */
function pixelsOf(entries) {
  const out = [];
  for (const e of entries) {
    for (let i = 0; i < e.n; i++) {
      out.push(e.rgb[0], e.rgb[1], e.rgb[2], 255);
    }
  }
  return out;
}

/* ---- 1 × inkRgbBytesToOkLch üzerinden aday üretim ---- */
{
  const pixels = pixelsOf([
    { rgb: [228, 26, 28], n: 400 },    // doygun kırmızı
    { rgb: [46, 89, 220], n: 360 },    // doygun mavi
    { rgb: [245, 208, 40], n: 300 },   // doygun sarı
    { rgb: [130, 132, 136], n: 500 },  // nötr gri
    { rgb: [24, 22, 26], n: 200 },     // koyu nötr
  ]);
  const cands = buildPaletteCandidates(new Uint8ClampedArray(pixels));
  ok('aday listesi boş değil', cands.length > 0, cands.length);
  ok('aday alanları bayt aralığında', cands.every(c =>
    c.rgb.every(v => v >= 0 && v <= 255 && Number.isInteger(v)) &&
    Number.isInteger(c.count) && c.count > 0), cands);
  const vividRed = cands.find(c => c.family !== 'n' && c.rgb[0] > 170 && c.rgb[1] < 110);
  ok('doygun kırmızı adayı chroma > 0.2', !!vividRed && vividRed.c > 0.2, vividRed);
  const neutral = cands.find(c => c.family === 'n');
  ok('nötr kutu ailesi "n", chroma < 0.015',
    !!neutral && neutral.c < 0.015, neutral);
  /* alfa 128 altı pikseller atılmalı */
  const pixelsForgotten = pixelsOf([{ rgb: [255, 0, 0], n: 5 }]).map((v, i) =>
    (i % 4 === 3 ? 100 : v));
  const cands2 = buildPaletteCandidates(new Uint8ClampedArray(pixelsForgotten));
  ok('alfa > 128 eşiği: zayıf pikseller ayrışmaz', cands2.length === 0, cands2);
}

/* ---- 2 × paletteGap ---- */
{
  const red = inkHexToOkLch('#e01a1c');
  const blue = inkHexToOkLch('#2e59dc');
  const same = { h: red.h, c: red.c, l: red.l };
  ok('paletteGap aynı renk = 0', near(paletteGap(same, same), 0), red);
  ok('paletteGap simetrik',
    near(paletteGap(same, blue), paletteGap(blue, same), 1e-9), blue);
  /* düşük chromada hue önemsizleşir: iki gri-birbirine yakın düşük c */
  const g1 = { h: 20, c: 0.01, l: 0.7 }, g2 = { h: 200, c: 0.01, l: 0.7 };
  const lowCDuo = paletteGap(g1, g2);
  const highCDuo = paletteGap({ h: 20, c: 0.2, l: 0.7 }, { h: 200, c: 0.2, l: 0.7 });
  ok('chroma düşükken hue farkı katkısı küçük', lowCDuo * 2.2 < highCDuo,
    { lowCDuo, highCDuo });
}

/* ---- 3 × pickPaletteColors ---- */
{
  const asRgb = c => c.rgb || c;   /* boş-aday yolu ham dizi döner */
  const empty = pickPaletteColors([]);
  ok('boş aday → 10 slot', empty.length === 10, empty);
  ok('boş aday çıktısı bayt geçerli', empty.every(c => {
    const rgb = asRgb(c);
    return rgb.length === 3 && rgb.every(v => v >= 0 && v <= 255 && Number.isInteger(v));
  }), empty);

  const cands = buildPaletteCandidates(new Uint8ClampedArray(pixelsOf([
    { rgb: [228, 26, 28], n: 400 },
    { rgb: [46, 89, 220], n: 360 },
    { rgb: [245, 208, 40], n: 300 },
    { rgb: [130, 132, 136], n: 500 },
    { rgb: [24, 22, 26], n: 200 },
  ])));
  const picked = pickPaletteColors(cands);
  ok('adaydan 10 slot', picked.length === 10, picked);
  ok('slotlar benzersiz', new Set(picked.map(c => c.rgb.join(','))).size === 10, picked);
  const hueOf = bg => {
    const lch = inkHexToOkLch('#' + bg.map(v => v.toString(16).padStart(2, '0')).join(''));
    return lch.h;
  };
  const hues = picked.map(c => hueOf(asRgb(c)));
  ok('kırmızı ve mavi kasada bağımsız slot almış', picked.some(c => c.rgb[0] > 170 && c.rgb[1] < 110) &&
    picked.some(c => c.rgb[2] > 170 && c.rgb[0] < 110), picked);
  ok('hue taramada NaN yok', hues.every(h => Number.isFinite(h)), hues);
}

/* ---- 4 × fillPaletteToTen ---- */
{
  const filled = fillPaletteToTen([[228, 26, 28]]);
  ok('tek taban → 10 slot', filled.length === 10, filled);
  ok('tek taban doldurması benzersiz',
    new Set(filled.map(c => c.join(','))).size === 10, filled);
  const graysOnly = fillPaletteToTen([[255, 255, 255]]);
  ok('akromatik taban → 10 slot benzersiz',
    graysOnly.length === 10 &&
    new Set(graysOnly.map(c => c.join(','))).size === 10, graysOnly);
}

/* ---- 5 × sortPaletteColors ---- */
{
  const mixed = [
    [130, 132, 136],   // nötr (gri)
    [255, 60, 0],      // kırmızımsı (h≈29)
    [20, 120, 220],    // mavi (h≈264)
    [20, 20, 20],      // nötr koyu
    [255, 200, 40],    // sarı (h≈110)
  ];
  const sorted = sortPaletteColors(mixed);
  ok('sıralama 5 slot korur', sorted.length === 5, sorted);
  const neutralFirstIdx = sorted.findIndex(c => {
    const lch = inkHexToOkLch('#' + c.rgb.map(v => v.toString(16).padStart(2, '0')).join(''));
    return lch.c < 0.015;
  });
  ok('nötrler sona düşer', neutralFirstIdx === 3, { neutralFirstIdx, sorted });
  const kRow = sorted.map(c => {
    const lch = inkHexToOkLch('#' + c.rgb.map(v => v.toString(16).padStart(2, '0')).join(''));
    return [Math.round(lch.h), Math.round(lch.l * 100) / 100];
  });
  ok('chromatikler OKLCH hue artan (krm < sarı < mavi)',
    kRow[0][0] < kRow[1][0] && kRow[1][0] < kRow[2][0], kRow);
  ok('nötrler L artan (koyu → açık)', kRow[3][1] < kRow[4][1], kRow);
}

/* ---- 6 × uç dayanıklılık ---- */
{
  ok('boş piksel → boş aday, pick seçimli 10 slot',
    buildPaletteCandidates(new Uint8ClampedArray(0)).length === 0 &&
    pickPaletteColors(buildPaletteCandidates(new Uint8ClampedArray(0))).length === 10);
}

/* ---- sonuç ---- */
console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} test HATA (${pass} geçti)`);
process.exitCode = fail ? 1 : 0;
