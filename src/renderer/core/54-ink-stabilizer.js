/* TailRef app · ink stabilizer · One-Euro Filter (FAZ 2)
   --------------------------------------------------------------------
   docs/ARCH-RESCUE-PLAN.md FAZ 2 çekirdeği. Bu modül DOM'suz ve saf
   matemattır: hem tarayıcı zincirinde hem de Node tabanlı birim
   testlerde (scripts/ink-stabilizer-test.js) aynı haliyle çalışır.

   One-Euro Filter (Casiez vd., CHI 2012): düşük hızda titremeyi
   bastıran, yüksek hızda gecikmeyi neredeyse sıfıra düşüren adaptif
   low-pass. Klasik EMA'nın aksine "yavaşken yumuşak, hızlıken
   keskin" davranır — tablet titremesi ile çizim gecikmesinin
   sanayide kabul görmüş çözümüdür.

       α(dt, f_c) = 1 / (1 + τ/f_c) tan τ = 1 / (2π·f_c)
       dx'        = lowpass(dx, α(dt, f_d))       türev hattı
       f_c        = f_min + β·|dx'|               hız-adaptif kesim
       x'         = lowpass(x, α(dt, f_c))        konum hattı
   ========================================================= */
'use strict';

/* Fiziksel girdi ölçeği: girdi çerçeveleri CSS pikselidir; 96 dpi
   referanslı OS ölçeğinde 1 CSS px = 25.4/96 mm. Hız artık cihaz-DPR
   pencere-büyüklük tanımsız kalır (FAZ2-2). */
/* var: Node tabanlı birim testte vm sandbox'ına sızmaları için
   (tarayıcıda klasik script üst-level const'tan farkı yoktur). */
var INK_MM_PER_CSS_PX = 25.4 / 96;

function inkEuroAlpha(dtSec, cutoffHz) {
  const tau = 1 / (2 * Math.PI * Math.max(0.001, cutoffHz));
  return 1 / (1 + tau / Math.max(dtSec, 0.001));
}

/** Yumuşatma seviyesi (smoothing 0..0.95) → One-Euro parametreleri.
 *  smoothing=0 → kapalı (null), üstel eğriyle 16 → tam 0.5 Hz iner. */
function inkStabilizerCutoffs(amount) {
  const s = clamp(Number.isFinite(amount) ? amount : 0, 0, 0.95);
  if (s <= 0.001) return null;
  return {
    // min cutoff: küçük = daha yumuşak (0'da 16 Hz, 0.95'te 0.5 Hz).
    minCutoff: 16 * Math.pow(0.5 / 16, s / 0.95),
    // beta: hız arttıkça kesim frekansını yükselten katsayı.
    beta: 0.007 + 0.028 * s,
  };
}

/** Vuruş başına stabilizatör durumu: üç bağımsız kanal (x, y, basınç)
 *  + birleşik zaman. */
function inkStabilizerBegin() {
  return {
    t: 0,
    x: null, xD: null,
    y: null, yD: null,
    p: null, pD: null,
  };
}

function inkEuroStep(stab, x, y, pressure, tMs, cutoffs) {
  if (!Number.isFinite(tMs)) tMs = 0;
  const dtSec = stab.t ? Math.max(0.001, (tMs - stab.t) / 1000) : 0.0167;

  /* — x kanalı —
     Türev hattı ilk gerçek hamlede filtresiz alır (One-Euro makalesinin
     başlatma deseni): hız hemen kesim frekansına destek olur, hızlı
     vuruşta gecikme ilk örnekten itibaren düşük kalır. */
  const hadX = stab.x !== null;
  const dxRaw = hadX ? (x - stab.x) / dtSec : 0;
  const aD = inkEuroAlpha(dtSec, 1.0);
  stab.xD = !hadX ? null
    : (stab.xD === null ? dxRaw : dxRaw * aD + stab.xD * (1 - aD));
  const cutX = cutoffs.minCutoff + cutoffs.beta * Math.abs(stab.xD);
  const aX = inkEuroAlpha(dtSec, cutX);
  /* İlk örnek: filtresiz al (gecikme 0), sonrakiler low-pass. */
  stab.x = stab.x === null ? x : stab.x + (x - stab.x) * aX;

  /* — y kanalı — */
  const hadY = stab.y !== null;
  const dyRaw = hadY ? (y - stab.y) / dtSec : 0;
  stab.yD = !hadY ? null
    : (stab.yD === null ? dyRaw : dyRaw * aD + stab.yD * (1 - aD));
  const cutY = cutoffs.minCutoff + cutoffs.beta * Math.abs(stab.yD);
  const aY = inkEuroAlpha(dtSec, cutY);
  stab.y = stab.y === null ? y : stab.y + (y - stab.y) * aY;

  /* — basınç kanalı — konumdan bağımsız, daha yumuşak kesim */
  const hadP = stab.p !== null;
  const prRaw = hadP ? (pressure - stab.p) / dtSec : 0;
  stab.pD = !hadP ? null
    : (stab.pD === null ? prRaw : prRaw * aD + stab.pD * (1 - aD));
  const cutP = Math.max(1.2, cutoffs.minCutoff);
  const aP = inkEuroAlpha(dtSec, cutP);
  stab.p = stab.p === null ? pressure : stab.p + (pressure - stab.p) * aP;

  stab.t = Number.isFinite(tMs) ? tMs : stab.t;
  return { x: stab.x, y: stab.y, p: stab.p };
}

/** Vuruş girdisini yumuşat. amount ≤ 0 → ham değerler (yapı değişmez). */
function inkStabilizerApply(stab, x, y, pressure, tMs, amount) {
  const cutoffs = amount <= 0.001 ? null : inkStabilizerCutoffs(amount);
  if (!stab || !cutoffs) return { x, y, p: pressure, raw: true };
  const out = inkEuroStep(stab, x, y, pressure, tMs, cutoffs);
  return { x: out.x, y: out.y, p: out.p, raw: false };
}

/* =========================================================
   fare için hız → basınç simülasyonu (FAZ2-4)
   ========================================================= */

/** Fare (basınç bildirmeyen cihaz) için: yavaş ele güçlü basınç,
 *  hızlı ele ince çizgi. speed 0..1 (inkSpeedInfluence). */
function inkSimulatedPressure(speed) {
  return clamp(1 - 0.7 * speed, 0.3, 1);
}

/* =========================================================
   uzun vuruşun nokta sınırı: başı yutmadan seyrelt (FAZ2-5)
   ========================================================= */

/**
 * `points.length >= cap` durumunda baş noktayı asla atmayıp içeri
 * seyreltir (FAZ2-5). Seyreltilmiş noktalar hâlâ aynı parçaların
 * arasından geçtiği için polilinea geometrisi görsel olarak korunur;
 * oynatma ve raster yeniden çizimi aynı tek listeden okur → tutarlı.
 * İlk nokta + son 2 nokta (canlı damga penceresi) asla silinmez.
 * Değişiklik yoksa null döner.
 * @returns {Array|null}
 */
function inkDecimateStrokePoints(points, cap) {
  if (!points || points.length < cap) return null;
  const src = points;
  const kept = [src[0]];
  for (let i = 2; i < src.length - 3; i += 2) kept.push(src[i]);
  // Son 2 nokta canlı damga penceresidir (prev2/prev): atlanmaz.
  kept.push(src[src.length - 2]);
  kept.push(src[src.length - 1]);
  // En az 2 nokta kalır.
  return kept.length >= 2 ? kept : null;
}
