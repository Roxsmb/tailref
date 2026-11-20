/* TailRef app · ink color · linear-light + OKLab (FAZ 3)
   --------------------------------------------------------------------
   docs/ARCH-RESCUE-PLAN.md FAZ 3 çekirdeği. Bu modül DOM'suz saf
   matemattır: tarayıcı zinciri ve Node tabanlı birim testler
   (scripts/ink-color-test.js) aynı haliyle çalışır.

   FAZ 3'e kadar tüm karışım gamma-kodlu 8-bit sRGB üzerindeydi —
   "muddy" karışımlar üretir (gamma ortalaması, ortalamadan koyu çıkar).
   Bu modül tek transfer çiftini ve Ottosson OKLab'ı (CSS Color 4
   matrisleri) sağlar; karışım noktaları sırayla buraya taşınır:

       gamma 8-bit  --inkSrgbToLin-->  linear 0..1   (ışık/doz uzayı)
       linear 0..1  --inkLinToSrgb-->  gamma 8-bit   (kaydetme uzayı)
       linear       --inkLinearToOkLab-->  OKLab     (algı uzayı)
       OKLab        --inkOkLabToLinear-->  linear
       OKLab        <-> OKLCH (l: 0..1, c: 0..~0.33, h: derece)

   Ottosson'ın "±0.015625 (1/64)" bordör notu: LMS küp kök sınır
   durumlarıdır; Math.cbrt'ün sign-koruyan davranışı + 8-bit yuvarlama
   bunu sağlar. Lineer değerlere yapay "sıfır bölgesi" UYGULANMAZ —
   gölgedeki koyu geçerli değerler (lin 0.003 gibi) yutulup
   siyahlaşmasın.

   ⚠︎ Performans kuralı: piksel döngüleri (smudge/dab) Math.pow yerine
   LUT kullanır (inkLinLut / inkLinToSrgbLut) — FAZ 3-1 notu.
   ========================================================= */
'use strict';

/* -----------------------------------------------------------
   Transfer çifti (FAZ 3-1: tek kaynak, başka yerde pow yok)
   ----------------------------------------------------------- */

/** Gamma 8-bit (0..255) → lineer (0..1).
 *  Formül: c/255 → c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4 */
function inkSrgbToLin(c255) {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Lineer (0..1) → gamma 8-bit (0..255, yuvarlanmış, sıkıştırılmış). */
function inkLinToSrgb(lin) {
  const c = inkGamutClamp01(lin);
  const g = c <= 0.0031308
    ? c * 12.92
    : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(g * 255);
}

/* Gamut sıkıştırma: gerçek sınır değerler (negatif/NaN → 0, taşma → 1).
   Yapay merkez-sıfır bölgesi YOKTUR — koyu lineer değerler geçerlidir. */
function inkGamutClamp01(v) {
  if (!(v > 0)) return 0;   /* NaN dahil → 0 */
  if (v >= 1) return 1;
  return v;
}

/* Piksel döngüsü LUT'ları: ilk kullanımda kurulur (FAZ 3-1).
   inkLinLut()[i]        : gamma i (0..255)   → lineer
   inkLinToSrgbLut()[j]  : lineer j/1023 → gamma 8-bit (yakın 8-bit) */
var inkLinTable = null;
var inkGamutTable = null;

function inkLinLut() {
  if (!inkLinTable) {
    inkLinTable = new Float64Array(256);
    for (let i = 0; i < 256; i++) inkLinTable[i] = inkSrgbToLin(i);
  }
  return inkLinTable;
}

function inkLinToSrgbLut() {
  if (!inkGamutTable) {
    /* 65536 adım: karanlık toe'da (12.92 bölümü) lin-grid adımı
       ~3.2 γ-birim kapsamaz — 1024 adım orada ±2 γ hatası üretirdi. */
    const N = 65536;
    inkGamutTable = new Uint8Array(N + 1);
    for (let j = 0; j <= N; j++) inkGamutTable[j] = inkLinToSrgb(j / N);
  }
  return inkGamutTable;
}

/** Piksel döngüsü hız yolu: gamma 8-bit → lineer. Tamsayı girdi
 *  LUT değerinin birebir kendisi; kesirli girdi (smudge pickup
 *  ortalaması) bitişik iki LUT girişi arasında doğrusal ara. */
function inkLinData(c255) {
  const t = inkLinLut();
  const x = c255 >= 255 ? 255 : c255 <= 0 ? 0 : c255;
  const i0 = Math.floor(x), f = x - i0;
  if (!f) return t[i0];
  const i1 = Math.min(255, i0 + 1);
  return t[i0] + (t[i1] - t[i0]) * f;
}

/** Piksel döngüsü hız yolu: lineer → gamma 8-bit (yakın indeks). */
function inkGamutData(lin) {
  const t = inkLinToSrgbLut();
  const j = Math.round(inkGamutClamp01(lin) * 65535);
  return t[j > 65535 ? 65535 : j < 0 ? 0 : j];
}

/* -----------------------------------------------------------
   hex yardımcıları (hatalı girdi affedici — projenin genel tutumu
   eski inkColorToHsl davranışına eştilerdi, FAZ 3'te konvansiyon
   korunarak OKLab hattına taşındı)
   ----------------------------------------------------------- */

/** '#rrggbb' → lineer {r,g,b} (0..1). Hatalı girdi → beyaz. */
function inkHexToLinear(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return { r: 1, g: 1, b: 1 };
  const n = parseInt(m[1], 16);
  return {
    r: inkLinLut()[(n >> 16) & 255],
    g: inkLinLut()[(n >> 8) & 255],
    b: inkLinLut()[n & 255],
  };
}

/** lineer {r,g,b} → '#rrggbb' (8-bit, sıkıştırılmış). */
function inkLinearToHex(c) {
  const to = v => {
    const j = Math.round(inkGamutClamp01(v) * 65535);
    return inkLinToSrgbLut()[j > 65535 ? 65535 : j < 0 ? 0 : j]
      .toString(16).padStart(2, '0');
  };
  return '#' + to(c.r) + to(c.g) + to(c.b);
}

/* -----------------------------------------------------------
   Ottosson OKLab (CSS Color 4 matrisleri, linear 0..1 ↔ Lab)
   ----------------------------------------------------------- */

/** Doğrusal sRGB (0..1) → OKLab {L,a,b}. */
function inkLinearToOkLab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

/** OKLab {L,a,b} → doğrusal sRGB {r,g,b} (gamut dışı borderline'lar
 *  inkGamutClamp01'e dahil değil; hex'e girişte sıkışır). */
function inkOkLabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  };
}

function inkHexToOkLab(hex) {
  const c = inkHexToLinear(hex);
  return inkLinearToOkLab(c.r, c.g, c.b);
}

function inkOkLabToHex(L, a, b) {
  return inkLinearToHex(inkOkLabToLinear(L, a, b));
}

/* -----------------------------------------------------------
   OKLCH (l: 0..1, c: 0..~0.33, h: 0..360 derece, NaN=akromatik)
   ----------------------------------------------------------- */

function inkOkLabToOkLch(L, a, b) {
  const c = Math.hypot(a, b);
  let h = Math.atan2(b, a) * 180 / Math.PI;
  if (!(h >= 0)) h += 360;              /* -0°-ları 360'a sar */
  if (h >= 360) h -= 360;
  return { l: L, c, h };
}

function inkOkLchToOkLab(l, c, h) {
  const rad = h * Math.PI / 180;
  return { L: l, a: Math.cos(rad) * c, b: Math.sin(rad) * c };
}

function inkHexToOkLch(hex) {
  const lab = inkHexToOkLab(hex);
  return inkOkLabToOkLch(lab.L, lab.a, lab.b);
}

function inkOkLchToHex(l, c, h) {
  const lab = inkOkLchToOkLab(l, c, h);
  return inkOkLabToHex(lab.L, lab.a, lab.b);
}

/** OKLab → sRGB baytları {r,g,b} (piksel döngüsü için; hex string'siz). */
function inkOkLabToBytes(L, a, b) {
  const lin = inkOkLabToLinear(L, a, b);
  return {
    r: inkGamutData(lin.r),
    g: inkGamutData(lin.g),
    b: inkGamutData(lin.b),
  };
}

/** sRGB baytları → OKLab + OKLCH (piksel döngüsü için; hex string'siz,
 *  paletleyicinin L/a/b toplaması ve L/C/H eşikleri tek çağrıda). */
function inkRgbBytesToOkLch(r, g, b) {
  const lab = inkLinearToOkLab(inkLinData(r), inkLinData(g), inkLinData(b));
  const lch = inkOkLabToOkLch(lab.L, lab.a, lab.b);
  return { L: lab.L, a: lab.a, b: lab.b, l: lch.l, c: lch.c, h: lch.h };
}

/** source-over tek piksel (FAZ 3-2 dab/smudge döngüsü için saf birim):
 *  hedef gamma 8-bit + düz alfa; kaynak lineer + düz alfa; amount =
 *  dab mask payı (0..1). Karışım LINEER uzayda yapılır (muddy yok).
 *  Çıktı: gamma 8-bit (0..255). bgByte tam sayı olmalı (piksel verisi). */
function inkDabOverChannel(bgByte, bgA, srcLin, srcA, amount) {
  const keep = bgA * (1 - amount);
  const add = srcA * amount;
  const outA = keep + add;
  if (!(outA > 0)) return 0;
  const out = (inkLinData(bgByte) * keep + srcLin * add) / outA;
  return inkGamutData(out);
}

/** OKLCH → sRGB baytları {r,g,b} (piksel döngüsü için; hex string'siz). */
function inkOkLchToBytes(l, c, h) {
  const lab = inkOkLchToOkLab(
    inkGamutClamp01(l),
    Math.min(0.35, Math.max(0, c)),
    h);
  const lin = inkOkLabToLinear(lab.L, lab.a, lab.b);
  return {
    r: inkGamutData(lin.r),
    g: inkGamutData(lin.g),
    b: inkGamutData(lin.b),
  };
}

function inkOkLchToHex(l, c, h) {
  const b = inkOkLchToBytes(l, c, h);
  return '#' + [b.r, b.g, b.b].map(n => n.toString(16).padStart(2, '0')).join('');
}

/* -----------------------------------------------------------
   çark (FAZ 3-3): dış halka renk kimliği eski HSV saf ton tanımıyla
   aynı kalır (görsel devamlılık); iç üçgen köşeleri OKLCH karışımıdır:
     A beyaz {l:1, c:0} · B siyah {l:0, c:0} · C saf ton {l,c,h}
   Piksel rengi = barycentric ağırlıkların OKLCH-L düzleminde doğrusal
   karışımı (eski gamma düz karışım muddy üçgen üretiyordu).
   ----------------------------------------------------------- */

/** Saf ton renk (halkayla aynı tanım: HSV s=1, v=1) → baytlar. */
function inkHsvSectorRgb(hue) {
  const h = ((hue % 360) + 360) % 360;
  const x = 1 - Math.abs(((h / 60) % 2) - 1);
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = 1; g = x; }
  else if (h < 120) { r = x; g = 1; }
  else if (h < 180) { g = 1; b = x; }
  else if (h < 240) { g = x; b = 1; }
  else if (h < 300) { r = x; b = 1; }
  else              { r = 1; b = x; }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

/* Saf ton köşe önbelleği: derece başına bir giriş (≤360 kayıt). */
var inkWheelCorners = new Map();

function inkWheelPureCorner(hue) {
  const h = Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : 0;
  const k = Math.round(h) % 360;
  let corner = inkWheelCorners.get(k);
  if (!corner) {
    const rgb = inkHsvSectorRgb(k);
    const hex = inkRgbToHexBytes(rgb);
    const lch = inkHexToOkLch(hex);
    corner = {
      /* h = ÇARK açısı (köşe seçici); okH = köşenin gerçek OKLCH hue'su
         (kırmızı ≈ 29.2° — üçgen boyunca chroma ekseni o yöne iner). */
      h: k,
      rgb,
      hex,
      l: lch.l,
      c: lch.c,
      okH: lch.h,
    };
    inkWheelCorners.set(k, corner);
  }
  return corner;
}

/* FAZ 6 A10: Ottosson gamut yardımcıları (public domain, kaynak
   docs/reference/ok-color-conversion.js — MIT). Üçgen köşesi halka
   kimliği için klasik HSV saf tonunda KALIR (referans çizim uygulamalarının
   tanıdıklığı); cusp, üçgen-içi doğruluğun denetim pusulasıdır. a_ ve b_ normalize
   (a_²+b_²=1) hue yönü; dönüş [L_cusp, C_cusp]. */
function inkWheelMaxSaturation(a_, b_) {
  let k0, k1, k2, k3, k4, wl, wm, ws;
  if (-1.88170328 * a_ - 0.80936493 * b_ > 1) {
    /* kırmızı kanalı */
    k0 = +1.19086277; k1 = +1.76576728; k2 = +0.59662641; k3 = +0.75515197; k4 = +0.56771245;
    wl = +4.0767416621; wm = -3.3077115913; ws = +0.2309699292;
  } else if (1.81444104 * a_ - 1.19445276 * b_ > 1) {
    /* yeşil kanalı */
    k0 = +0.73956515; k1 = -0.45954404; k2 = +0.08285427; k3 = +0.12541070; k4 = +0.14503204;
    wl = -1.2684380046; wm = +2.6097574011; ws = -0.3413193965;
  } else {
    /* mavi kanalı */
    k0 = +1.35733652; k1 = -0.00915799; k2 = -1.15130210; k3 = -0.50559606; k4 = +0.00692167;
    wl = -0.0041960863; wm = -0.7034186147; ws = +1.7076147010;
  }
  /* polinom yaklaşık + bir adım Halley düzeltmesi */
  let S = k0 + k1 * a_ + k2 * b_ + k3 * a_ * a_ + k4 * a_ * b_;
  const k_l = +0.3963377774 * a_ + 0.2158037573 * b_;
  const k_m = -0.1055613458 * a_ - 0.0638541728 * b_;
  const k_s = -0.0894841775 * a_ - 1.2914855480 * b_;
  {
    const l_ = 1 + S * k_l, m_ = 1 + S * k_m, s_ = 1 + S * k_s;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const l_dS = 3 * k_l * l_ * l_, m_dS = 3 * k_m * m_ * m_, s_dS = 3 * k_s * s_ * s_;
    const l2 = 6 * k_l * k_l * l_, m2 = 6 * k_m * k_m * m_, s2 = 6 * k_s * k_s * s_;
    const f = wl * l + wm * m + ws * s;
    const f1 = wl * l_dS + wm * m_dS + ws * s_dS;
    const f2 = wl * l2 + wm * m2 + ws * s2;
    S = S - f * f1 / (f1 * f1 - 0.5 * f * f2);
  }
  return S;
}

function inkWheelCusp(a_, b_) {
  const S_cusp = inkWheelMaxSaturation(a_, b_);
  const rgb = inkOkLabToLinear(1, S_cusp * a_, S_cusp * b_);
  const L_cusp = Math.cbrt(1 / Math.max(Math.max(rgb.r, rgb.g), rgb.b));
  return [L_cusp, L_cusp * S_cusp];
}

/* Çark açısı ↔ OKLCH hue eşlemesi (tersi): saf tonun OKLCH hue'su çark
   açısına göre monoton artar (kırmızı 29° → sarı ~110° → yeşil ~143° →
   mavi ~264° → macenta ~328°).
   FAZ 6 A10: biseksiyon KALDIRILDI. Köşe ızgarası düz basamaklıdır
   (sarıda 1.6° sıçrama): biseksiyon hedefe kilitlenemezken hücre
   sınırında sabitlenir (57.4999 / 56.5000), hex kuantalama gürültüsü
   sınırı iteler ve state ±1° "hue yürür" (60.5 → 61.5 → ...) —
   arkadaşın panel-dışı gösterge kaymasını üreten katman. Argmin:
   h daima chroma eksenini çizecek köşenin BİREBİR derecesidir;
   state→hex→state sabit noktada, yürüyüş imkansızdır. */
function inkWheelHueFromOkHue(target) {
  const t = Number.isFinite(target) ? ((target % 360) + 360) % 360 : 0;
  let best = 0, bestD = Infinity;
  for (let k = 0; k < 360; k++) {
    const d = Math.abs(((inkWheelPureCorner(k).okH - t) % 360 + 540) % 360 - 180);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

function inkRgbToHexBytes(b) {
  return '#' + [b.r, b.g, b.b].map(n =>
    (n & 255).toString(16).padStart(2, '0')).join('');
}

/** FAZ 6 A10: OKLCH noktası lineer sRGB tam kübünde mı (klampsız)?
 *  inkGamutData kanal-klampı hücrette hue'yi bozar (koyu mavi → mor
 *  kayması); bu nedenle çark yolunda eşleşmelerşı önce burada yakalarız.
 *  Tolerans ±0.002 (≈ 1 γ-LSB): JİLET-KADAR örneklerde (8-bit yuvarlama
 *  duvarına değen kanallar) ±1e-6 yanıt sallar ve state→hex zinciri
 *  geçişler arasında_hop yapar; 8-bit aralığında karar her bayta
 *  aynıdır (fark ≤ 1 LSB). */
function inkWheelOkLchInGamut(l, c, h) {
  const lab = inkOkLchToOkLab(
    inkGamutClamp01(l), Math.max(0, Number.isFinite(c) ? c : 0), h);
  const lin = inkOkLabToLinear(lab.L, lab.a, lab.b);
  const TOL = 0.002;
  return lin.r > -TOL && lin.r < 1 + TOL &&
    lin.g > -TOL && lin.g < 1 + TOL &&
    lin.b > -TOL && lin.b < 1 + TOL;
}

/* Çark durumu (h, s, v) ↔ hex. Geometri eşlemesi eskiyle birebir:
     a (beyaz payı) = v − s · b (siyah payı) = 1 − v · c (saf ton payı) = s
   Renk karışımı OKLab düzleminde (a/b) düz: chroma ekseni köşenin
   GERÇEK OKLCH hue'suna (okH) doğru iner — çark açısı h yalnız
   köşe seçimini belirler. */
function inkWheelStateToHex(h, s, v) {
  const corner = inkWheelPureCorner(h);
  const sc = Math.min(1, Math.max(0, Number(s) || 0));
  const vc = Math.min(1, Math.max(0, Number(v) || 0));
  /* Eşitlik payı: K–P kenarında v == s matematiksel olarak denk ama
     kayan noktada ±1 ULP sapan örnekler eski v<s yolu yanlışacağında
     dal değiştirebilir (hue 20° kayması). Pay bant içinde üçgen içidir. */
  if (vc + 1e-9 >= sc) {
    const wa = Math.min(1, Math.max(0, vc - sc));
    const wb = Math.min(1, Math.max(0, 1 - vc));
    const wc = Math.min(1, Math.max(0, 1 - wa - wb));
    const sum = wa + wb + wc || 1;
    const na = wa / sum, nc = wc / sum;
    let C = nc * corner.c;
    const L = na + nc * corner.l;
    const H = corner.okH;
    /* FAZ 6 A10: gamut garantisı. K–P ışını koyu doygun mavi/magenta
       yönlerinde sRGB'den taşar; kanal-klampı hue'yi bozardı (arkadaşın
       "renk yanlış" bulgusunun kökü — 20° mor kayması). Ottosson
       gamut-clipping ilkesi: hue ve L KORUNUR, chroma in-gamut
       tavane düşürülür (ikili arama; girişi gamutta olan noktalar
       buna girmez). */
    if (C > 1e-9 && !inkWheelOkLchInGamut(L, C, H)) {
      let lo = 0, hi = C;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        if (inkWheelOkLchInGamut(L, mid, H)) lo = mid; else hi = mid;
      }
      C = lo;
    }
    return inkOkLchToHex(L, C, H);
  }
  /* v < s: üçgenin dışında (yalnız hex girişinden gelir). Eski
     davranış aynen korunur: HSV sektör matematiği (kanal = ch0·s·v
     + v(1−s)) — state→hex kendi kendine tutarlı kalır. */
  const rgb = inkHsvSectorRgb(corner.h);
  return '#' +
    [rgb.r, rgb.g, rgb.b].map(raw => {
      const c0 = raw / 255;
      return Math.round((c0 * sc * vc + vc * (1 - sc)) * 255)
        .toString(16).padStart(2, '0');
    }).join('');
}

/* FAZ 6 A10: hex → çark durumu. Eskiden üçgen dışı (v<s, s>1) bölge
   üretilebiliyordu — tutamaç üçgen dışına çıkıyor ve gösterilen renk
   seçilenle tutarsızlaşıyordu (arkadaşın iki bulgusu). Yol: OKLCH
   (l,c) düzleminde en yakın üçgen kenarına 2-D projeksiyon — OKLCH-L
   korunur, hue korunur, yalnız chroma kırpılır:
     (1) s = lch.c/cPure → [0,1]      (P ötesi doygunluk kırpılır)
     (2) l − s·lPure < 0 → K–P kenarı: s = l/lPure  (L korunur)
     (3) v > 1 → W–P kenarı: s = (1−l)/(1−lPure), v = 1
   Sonuç: tutamaç üçgen İÇİNDE garantili; gösterilen renk = seçilen renk. */
function inkHexToWheelState(hex) {
  const lch = inkHexToOkLch(hex);
  const h = inkWheelHueFromOkHue(lch.h);
  const corner = inkWheelPureCorner(h);
  let s = corner.c > 1e-9 ? lch.c / corner.c : 0;
  if (s > 1) s = 1;                              /* (1) P ötesi */
  if (lch.l < s * corner.l) s = corner.l > 1e-9  /* (2) K–P kenarı */
    ? Math.min(1, Math.max(0, lch.l / corner.l)) : 0;
  let v = lch.l + s * (1 - corner.l);       /* v = wa + wc (bary toplamı 1) */
  if (v > 1) {                                   /* (3) W–P kenarı */
    v = 1;
    s = corner.l < 1 - 1e-9
      ? Math.min(1, Math.max(0, (1 - lch.l) / (1 - corner.l))) : 0;
  }
  return {
    h,
    s: Math.min(1, Math.max(0, s)),
    v: Math.min(1, Math.max(0, v)),
  };
}

/** FAZ 6 A10: çark durumunu üçgen içinde stabil tutar (defansif son
 *  savunma): s ∈ [0,1], v ∈ [s,1]. 31-ink-ui.js'te durum bilgisini
 *  yazan üç noktaya bağlanır; sürükleme zaten bary clamp ile tutar. */
function inkWheelClampStateStable(st) {
  const s = Math.min(1, Math.max(0, Number(st && st.s) || 0));
  const v0 = Math.min(1, Math.max(0, Number(st && st.v) || 0));
  const hRaw = Number(st && st.h);
  return {
    h: Number.isFinite(hRaw) ? ((hRaw % 360) + 360) % 360 : 0,
    s,
    v: Math.min(1, Math.max(s, v0)),
  };
}

/* -----------------------------------------------------------
   karışım çekirdeği (FAZ 3-2'de beş noktaya bağlanır)
   ----------------------------------------------------------- */

/** Doğrusal-ışık karışımı: doz/ışık ortalaması (muddy'siz).
 *  t=0 → a, t=1 → b. */
function inkMixHexLinear(hexA, hexB, t) {
  const a = inkHexToLinear(hexA);
  const b = inkHexToLinear(hexB);
  const k = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
  return inkLinearToHex({
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  });
}

/** Algısal karışım (OKLab a/b düzleminde düz): renk tekeri/dual-brush
 *  karışımında doğal orta renk üretir. */
function inkMixHexOkLab(hexA, hexB, t) {
  const a = inkHexToOkLab(hexA);
  const b = inkHexToOkLab(hexB);
  const k = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
  return inkOkLabToHex(a.L + (b.L - a.L) * k,
    a.a + (b.a - a.a) * k, a.b + (b.b - a.b) * k);
}

/** OKLCH kanal karışımı: L ve C doğrusal, hue en kısa yay boyunca
 *  (FAZ 3-2 renk dinamikleri: L-chroma korunarak hue dönüşü).
 *  girdi/çıktı: {l,c,h} (c 0..~0.33, h derece). */
function inkMixOkLch(a, b, t) {
  const k = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
  /* en kısa yay: farkı [-180, 180) aralığına sar */
  let dh = ((b.h - a.h) % 360 + 540) % 360 - 180;
  if (!Number.isFinite(dh)) dh = 0;
  let h = a.h + dh * k;
  h = (h % 360 + 360) % 360;
  return {
    l: a.l + (b.l - a.l) * k,
    c: a.c + (b.c - a.c) * k,
    h,
  };
}
