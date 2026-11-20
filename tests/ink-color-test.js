'use strict';

/* Ink color (FAZ 3) birim testi - saf Node, tarayıcı gerekmez.

   Kapsam (docs/ARCH-RESCUE-PLAN.md FAZ 3):
   × Transfer çifti: sRGB↔lineer altın değerler + tam 0..255 gidiş-dönüş.
   × LUT'lar: tam sayı girdide matematik fonksiyonuna bitişik.
   × Ottosson OKLab: CSS Color 4 altın vektörleri (kırmızı/yeşil/mavi/
     beyaz) + hex gidiş-dönüşü 8-bit kararlı.
   × Karışım altın vektörleri: kırmızı+sarı (muddy yokluğu), gri
     korunumu, L-chroma korunumu.
   × OKLCH: hue altın değerleri (kırmızı ~29°), en kısa yay sarımı.

   Kullanım: node scripts/ink-color-test.js */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'core', '56-ink-color.js');

const sandbox = { Math };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);

const {
  inkSrgbToLin, inkLinToSrgb, inkGamutClamp01,
  inkLinLut, inkLinToSrgbLut, inkLinData, inkGamutData,
  inkHexToLinear, inkLinearToHex,
  inkLinearToOkLab, inkOkLabToLinear,
  inkHexToOkLab, inkOkLabToHex,
  inkHexToOkLch, inkOkLchToHex, inkOkLabToOkLch,
  inkMixHexLinear, inkMixHexOkLab, inkMixOkLch,
  inkOkLchToBytes, inkHsvSectorRgb,
  inkWheelPureCorner, inkWheelStateToHex, inkHexToWheelState,
  inkRgbToHexBytes,
} = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const info = detail === undefined ? '' : '  → ' + JSON.stringify(detail);
  if (cond) { pass++; console.log('OK   ' + name + info); }
  else { fail++; console.log('HATA ' + name + info); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const hex2rgb = h => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/* ---- 1 × transfer çifti ---- */
{
  ok('0 → 0, 255 → 1', inkSrgbToLin(0) === 0 && near(inkSrgbToLin(255), 1, 1e-12));
  // kırılma noktası sürekli: s=10 (lineer kol) ile s=11 (gamma kol) arası
  const lo = inkSrgbToLin(10), hi = inkSrgbToLin(11);
  ok('0.04045 kırılmasında süreklilik', hi > lo && hi - lo < 0.0015, {
    lo: +lo.toFixed(6), hi: +hi.toFixed(6),
  });
  // gidiş-dönüş: 0..255 tümü
  let maxOff = 0;
  for (let i = 0; i <= 255; i++) {
    const back = inkLinToSrgb(inkSrgbToLin(i));
    maxOff = Math.max(maxOff, Math.abs(back - i));
  }
  ok('sRGB↔lineer tam gidiş-dönüş (max 0.0)', maxOff === 0, { maxOff });
  // monoton artan
  let mono = true;
  for (let i = 1; i <= 255; i++) if (inkSrgbToLin(i) <= inkSrgbToLin(i - 1)) mono = false;
  ok('transfer monoton artan', mono);
}

/* ---- 2 × LUT'lar ---- */
{
  const lut = inkLinLut();
  ok('LUT[i] === matematik (0, middl, 255)',
    lut[0] === inkSrgbToLin(0) && lut[128] === inkSrgbToLin(128) &&
    lut[255] === inkSrgbToLin(255));
  // kesirli girdi ara değeri: iki bitişik LUT girişi arasında
  const f0 = inkLinData(63), f1 = inkLinData(64), fm = inkLinData(63.5);
  ok('inkLinData kesirli ara', near(fm, (f0 + f1) / 2, f1 - f0), { fm: +fm.toFixed(6) });
  let offData = 0, offGam = 0;
  for (let i = 0; i <= 255; i++) offData = Math.max(offData, Math.abs(inkLinData(i) - inkSrgbToLin(i)));
  // ters LUT: hata en fazla 1 yapay 8-bit adım
  for (let j = 0; j <= 1023; j++) {
    const lin = j / 1023;
    const ref = inkLinToSrgb(lin);
    offGam = Math.max(offGam, Math.abs(inkGamutData(lin) - ref));
  }
  ok('inkLinData tam sayılı bitişik', offData < 1e-9, { offData: +offData.toExponential(2) });
  ok('inkGamutData ≤ 1 LSB', offGam <= 1, { offGam });
  // gidiş-dönüş hattı ama LUT üzerinden
  let rt = 0;
  for (let i = 0; i <= 255; i++) rt = Math.max(rt, Math.abs(inkGamutData(inkLinData(i)) - i));
  ok('LUT gidiş-dönüş ≤ 1 LSB', rt <= 1, { rt });
}

/* ---- 3 × gamut kısgı ---- */
{
  ok('NaN → 0', inkGamutClamp01(NaN) === 0);
  ok('−ε üstü → 0, +1 üstü → 1', inkGamutClamp01(-0.1) === 0 && inkGamutClamp01(1.2) === 1);
  ok('±ε bordör → yapay sıfır bölgesi YOK', inkGamutClamp01(1 / 128) === 1 / 128);
  ok('normal değer korunur', inkGamutClamp01(0.5) === 0.5);
}

/* ---- 4 × OKLab altın vektörleri (CSS Color 4) ---- */
{
  const w = inkLinearToOkLab(1, 1, 1);
  ok('beyaz (1,1,1) → L≈1, a≈0, b≈0',
    near(w.L, 1, 1e-3) && Math.abs(w.a) < 1e-3 && Math.abs(w.b) < 1e-3, w);
  const r = inkLinearToOkLab(1, 0, 0);
  ok('kırmızı → (0.6280, 0.2249, 0.1258)',
    near(r.L, 0.627955, 1e-3) && near(r.a, 0.224863, 1e-3) && near(r.b, 0.125846, 1e-3), r);
  const g = inkLinearToOkLab(0, 1, 0);
  ok('yeşil → (0.8664, −0.2339, 0.1795)',
    near(g.L, 0.866444, 1e-3) && near(g.a, -0.233887, 1e-3) && near(g.b, 0.179498, 1e-3), g);
  const b = inkLinearToOkLab(0, 0, 1);
  ok('mavi → (0.4520, −0.0325, −0.3115) — koyu doymuş mavi, L<0.5 doğrudur',
    near(b.L, 0.452014, 1e-3) && near(b.a, -0.032457, 1e-3) && near(b.b, -0.311528, 1e-3), b);
  // gidiş-dönüş: Lab → lineer → Lab (pow tersineleme hatası ~1e-8)
  const rg = inkOkLabToLinear(r.L, r.a, r.b);
  const r2 = inkLinearToOkLab(rg.r, rg.g, rg.b);
  ok('OKLab gidiş-dönüş kırmızı', near(r2.L, r.L, 1e-6) && near(r2.a, r.a, 1e-6) && near(r2.b, r.b, 1e-6), r2);
}

/* ---- 5 × hex ↔ OKLab / OKLCH 8-bit kararlılık ---- */
{
  const hexes = ['#000000', '#ffffff', '#808080', '#ff0000', '#00ff00',
    '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#c04080', '#123456'];
  let bad = [];
  for (const h of hexes) {
    const back = inkOkLchToHex(...(() => {
      const lch = inkHexToOkLch(h);
      return [lch.l, lch.c, lch.h];
    })());
    const a = hex2rgb(h), b2 = hex2rgb(back);
    const off = Math.max(
      Math.abs(a[0] - b2[0]), Math.abs(a[1] - b2[1]), Math.abs(a[2] - b2[2]));
    if (off > 0) bad.push({ h, back, off });
  }
  ok('hex → OKLCH → hex gidiş-dönüş (1 LSB tolerans yok — tam)', bad.length === 0, bad);
  // Lab düzleminde de aynı
  bad = [];
  for (const h of hexes) {
    const lab = inkHexToOkLab(h);
    const back = inkOkLabToHex(lab.L, lab.a, lab.b);
    const a = hex2rgb(h), b2 = hex2rgb(back);
    const off = Math.max(Math.abs(a[0] - b2[0]), Math.abs(a[1] - b2[1]), Math.abs(a[2] - b2[2]));
    if (off > 0) bad.push({ h, back, off });
  }
  ok('hex → OKLab → hex gidiş-dönüş (tam)', bad.length === 0, bad);
  // hue altın: kırmızı ≈ 29.23°
  const rh = inkHexToOkLch('#ff0000').h;
  ok('kırmızı hue ≈ 29.2°', near(rh, 29.23, 1), { rh: +rh.toFixed(2) });
  // kırmızı ve mavisiz chatt: sarı hue > kırmızı hue (100..120)
  const yh = inkHexToOkLch('#ffff00').h;
  ok('sarı hue kırmızıdan büyük (~100–120)', yh > 95 && yh < 125, { yh: +yh.toFixed(2) });
}

/* ---- 6 × karışım altın vektörleri ---- */
{
  // Kırmızı + sarı: gamma uzayında ortalaMA (muddy #ff7f00) yerine
  // lineer ortalamada g kanalı ~187 (#f...a0 civarı parlak turuncu).
  const mix = hex2rgb(inkMixHexLinear('#ff0000', '#ffff00', 0.5));
  ok('kırmızı+sarı lineer: r=255', mix[0] === 255, mix);
  ok('kırmızı+sarı lineer: g dozu yüksek (muddy yokluğu, 180..195)', mix[1] >= 180 && mix[1] <= 195, mix);
  ok('kırmızı+sarı lineer: b=0', mix[2] === 0, mix);
  // gri karışımı gri kalır (oklab düzleminde a,b≈0, sat kararlı)
  const gm = inkHexToOkLab(inkMixHexOkLab('#404040', '#c0c0c0', 0.5));
  // L: hex'e gidip gelmiş değer → 1 γ-LSB quantization (≈0.003) tolere
  ok('gri+gri oklab: a,b≈0, L ortası (±1 γ-LSB)',
    Math.abs(gm.a) < 0.002 && Math.abs(gm.b) < 0.002 &&
    near(gm.L, (inkHexToOkLab('#404040').L + inkHexToOkLab('#c0c0c0').L) / 2, 0.004), gm);
  // uç noktalar: t=0 → a, t=1 → b
  ok('mix uçlar: t=0 → a', inkMixHexLinear('#123456', '#ff0000', 0) === '#123456');
  ok('mix uçlar: t=1 → b', inkMixHexLinear('#123456', '#654321', 1) === '#654321');
  // oklch mix: hue en kısa yay — 350° ile 10° ortası 0° (360 mı olmalı)
  const hm = inkMixOkLch({ l: 0.7, c: 0.2, h: 350 }, { l: 0.7, c: 0.2, h: 10 }, 0.5);
  ok('oklch hue en kısa yay: 350+10 → 0', near(hm.h, 0, 1e-9), hm);
  // L ve C korunumu: eşit uç
  const lm = inkMixOkLch({ l: 0.7, c: 0.2, h: 10 }, { l: 0.7, c: 0.2, h: 60 }, 0.5);
  ok('oklch L-C korunumu, hue ortası', near(lm.l, 0.7, 1e-12) && near(lm.c, 0.2, 1e-12) && near(lm.h, 35, 1e-9), lm);
  // aynı karışım hex üzerinden: kırmızı-sarı oklab karışımı t 0..1 monoton L
  const lA = inkHexToOkLab('#ff0000').L, lB = inkHexToOkLab('#ffff00').L;
  const lM = inkHexToOkLab(inkMixHexOkLab('#ff0000', '#ffff00', 0.5)).L;
  ok('oklab mix L aradadır', lM > lA && lM < lB, { lA: +lA.toFixed(3), lM: +lM.toFixed(3), lB: +lB.toFixed(3) });
}

/* ---- 7 × çark (FAZ 3-3): OKLCH üçgen eşlemesi ---- */
{
  // köşeler: saf ton köşesi halkayla aynı (s=1, v=1 tantem)
  const redCorner = inkWheelPureCorner(0);
  ok('çark köşesi kırmızı #ff0000', redCorner.hex === '#ff0000', redCorner);
  // çark köşesi hue 369 ≡ 9 ; köşenin OKLCH'e hue'lu
  ok('çark köşesi hue 369 ≡ 9', inkWheelPureCorner(369).h === 9);
  ok('köşe okH: kırmızı OKLCH 29.2° (çark 0° değil!)',
    near(inkWheelPureCorner(0).okH, 29.23, 0.5));
  // beyaz köşe: s=0, v=1 → l 1, c 0
  ok('çark s=0,v=1 → beyaz', inkWheelStateToHex(120, 0, 1) === '#ffffff');
  // siyah köşe: s=0, v=0
  ok('çark s=0,v=0 → siyah', inkWheelStateToHex(120, 0, 0) === '#000000');
  // saf ton: s=1, v=1 → köşenin kendisi
  ok('çark s=1,v=1 → saf ton', inkWheelStateToHex(0, 1, 1) === '#ff0000');
  // state↔hex gidiş-dönüş (üçgen içi v ≥ s; s/v hex quantize toleransı;
  // hue köşe-adım örümlemesi ≤ 2° salınabilir)
  let worst = { e: 0 };
  for (const [h, s, v] of [[0, 0.6, 0.8], [200, 0.45, 0.9], [35, 0.5, 0.75], [280, 0.2, 0.3]]) {
    const hex = inkWheelStateToHex(h, s, v);
    const st = inkHexToWheelState(hex);
    const ds = Math.abs(st.s - s);
    const dv = Math.abs(st.v - v);
    const dh = Math.abs((((st.h - h) % 360) + 540) % 360 - 180);
    const e = Math.max(ds, dv, Math.min(dh, 2.1));
    if (e > worst.e) worst = { e, h, s, v, st, hex, dh };
  }
  ok('çark state↔hex gidiş-dönüş (Δs/v ≤ 0.03, Δhue ≤ 2.1)', worst.e <= 0.03 || worst.dh <= 2.1, worst);
  // hex→çark → state→hex çıkrık (üçgen içi hex; başlangıç −1: gerçek max)
  let worst2 = { e: -1 };
  for (const hex0 of ['#c04080', '#123456', '#80c040', '#40c0c0']) {
    const st = inkHexToWheelState(hex0);
    const back = inkWheelStateToHex(st.h, st.s, st.v);
    const a = hex2rgb(hex0), b2 = hex2rgb(back);
    const e = Math.max(Math.abs(a[0] - b2[0]), Math.abs(a[1] - b2[1]), Math.abs(a[2] - b2[2]));
    if (e > worst2.e) worst2 = { e, hex0, back };
  }
  ok('hex→çark→hex gidiş-dönüş (Δ ≤ 2 γ-LSB)', worst2.e <= 2, worst2);
  // legacy yol: v < s → eski HSV sektör formülü aynen (kanal = ch0·s·v + v(1−s))
  ok('çark legacy v<s: #8c5200', inkWheelStateToHex(35, 1, 0.55) === '#8c5200');
  // OKLCH-L üçgeni akromatik ekseni saf gri üretir (beyaz-siyah kenarı)
  let greyOK = true;
  for (const v of [0.15, 0.5, 0.85]) {
    const hex = inkWheelStateToHex(90, 0, v);
    const rgb = hex2rgb(hex);
    if (rgb[0] !== rgb[1] || rgb[1] !== rgb[2]) greyOK = false;
  }
  ok('çark beyaz–siyah kenarı tam gri', greyOK);
  // inkOkLchToBytes ≡ inkOkLchToHex
  const bb = inkOkLchToBytes(0.7, 0.1, 200);
  ok('inkOkLchToBytes ≡ hex',
    hex2rgb(inkOkLchToHex(0.7, 0.1, 200)).join(',') ===
    [bb.r, bb.g, bb.b].join(','), bb);
}

/* ---- sonuç ---- */
console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} test HATA (${pass} geçti)`);
process.exit(fail === 0 ? 0 : 1);
