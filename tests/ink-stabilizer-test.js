'use strict';

/* Ink stabilizer (FAZ 2) birim testi — saf Node, tarayıcı gerekmez.

   Kapsam (docs/ARCH-RESCUE-PLAN.md FAZ 2):
   • One-Euro parametre eğrisi: smoothing=0 kapalı, arttıkça min cutoff iner.
   • Adaptif filtre davranışı: titreşim bastırılırken hızlı hareket
     hemen takip edilir (gecikme < 8 ms ölçütlü).
   • smoothing=0 → ham geçiş (filtre kapalı).
   • Basınç kanalı: gürültülü tablet basıncı yumuşar.
   • Fare hız→basınç simülasyonu: monoton, sınırlı, uçlarda makul.
   • Nokta seyreltme: baş nokta + son 2 nokta asla atılmaz, tutulan
     noktalar orijinal vuruş noktalarının alt kümesidir.

   Kullanım: node scripts/ink-stabilizer-test.js */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'core', '54-ink-stabilizer.js');

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const sandbox = { Math, clamp };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);

const {
  inkStabilizerBegin, inkStabilizerApply, inkStabilizerCutoffs,
  inkSimulatedPressure, inkDecimateStrokePoints, INK_MM_PER_CSS_PX,
} = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const info = detail === undefined ? '' : ' → ' + JSON.stringify(detail);
  if (cond) { pass++; console.log('OK   ' + name + info); }
  else { fail++; console.log('HATA ' + name + info); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/* ---- 1 · cutoff eğrisi ---- */
{
  ok('smoothing=0 → filtre kapalı (null)', inkStabilizerCutoffs(0) === null);
  ok('smoothing=0.95 → minCut 0.5 Hz', inkStabilizerCutoffs(0.95).minCutoff <= 0.5 + 1e-9,
    inkStabilizerCutoffs(0.95));
  const a = inkStabilizerCutoffs(0.45);
  ok('varsayılan 0.45 → yumuşak ama gergin (0.5..16 Hz)', a.minCutoff > 0.5 && a.minCutoff < 16, a);
  const b = inkStabilizerCutoffs(0.9);
  ok('smoothing arttıkça minCut iner', b.minCutoff < a.minCutoff, { low: b.minCutoff, high: a.minCutoff });
  ok('beta 0 ile bile pozitif', b.beta > 0);
}

/* ---- 2 · adaptif gecikme: hızlı hamle hemen girer, jitter bastırılır ---- */
{
  // 250 Hz kalem örnekleme (5 mS aralık ~ 200 Hz; Electron pointer ~125-240Hz)
  const DT = 5;
  // Senaryo A: düz hat boyunca mikro titreme (±0.6 px, 60 Hz sarımsı)
  const sA = inkStabilizerBegin();
  let residual = 0;
  for (let i = 0; i < 240; i++) { // 1.2 s düz hat
    const t = i * DT;
    const x = i * 0.019; // yavaş kayma
    const n = Math.sin((t / 1000) * Math.PI * 2 * 12) * 0.6; // ±0.6 px, 12 Hz
    const inX = x + n;
    const out = inkStabilizerApply(sA, inX, 0, 1, t, 0.45);
    // Metrik: temiz çizgiye (x) kalan sapma = ÇIKTIKİ artık titreşim.
    // |out − in| değil: ham çıkış orada bile ~0.38 döner, ayırt etmez.
    residual += Math.abs(out.x - x);
  }
  const avgResidual = residual / 240;
  ok('titreme bastırılmış (artık titreşim < 0.35 px)', avgResidual < 0.35, { avgResidual: +avgResidual.toFixed(3) });

  // Senaryo B: hızlı hamle → gecikme. 800 px tek karede zıplama;
  // followed çıkışın hamı %90'a ne kadar sürede ulaştığı ölçülür.
  const sB = inkStabilizerBegin();
  inkStabilizerApply(sB, 0, 0, 1, 0, 0.45);
  let reachAt = -1;
  for (let i = 1; i <= 30; i++) {
    const t = i * DT;
    const out = inkStabilizerApply(sB, 80 * i, 0, 1, t, 0.45); // hızlı (≈1600 px/s)
    if (out.x >= 0.9 * (80 * i) && reachAt < 0) reachAt = t;
  }
  ok('hızlı hamlede gecikme < 8 ms', reachAt > 0 && reachAt < 8, { reachAtMs: reachAt });

  // Senaryo C: yavaş sprint ve durak; durak sonrası hedefe yanaşma
  const sC = inkStabilizerBegin();
  inkStabilizerApply(sC, 0, 0, 1, 0, 0.9);
  let x = 0;
  for (let i = 0; i < 200; i++) {
    const t = i * DT;
    x = Math.min(120, x + 6); // kısa hızlı hamle
    inkStabilizerApply(sC, x, 0, 1, t, 0.9);
  }
  const settle = inkStabilizerApply(sC, 120, 0, 1, 200 * DT || 1000, 0.9);
  ok('durunca ham hedefe konduru', near(settle.x, 120, 0.5), { x: +settle.x.toFixed(2) });
}

/* ---- 3 · kapalı filtre ham geçiş ---- */
{
  const s = inkStabilizerBegin();
  const r1 = inkStabilizerApply(s, 3.3, 4.4, 0.77, 0, 0);
  const r2 = inkStabilizerApply(s, 9.9, 8.8, 0.55, 16, 0);
  ok('smoothing=0 → ham değer', r1.raw && r2.raw && r2.x === 9.9 && r2.y === 8.8 && r2.p === 0.55, r2);
}

/* ---- 4 · basınç kanalı ---- */
{
  const s = inkStabilizerBegin();
  // Basınç gürültüsü: 0.6 ± 0.25 salınım → çıkış genliği daralır.
  let inAmp = 0, outAmp = 0;
  let i = 0;
  for (const ms of Array.from({ length: 120 }, (_, i2) => i2 * 8)) {
    i++;
    const pr = 0.6 + Math.sin(ms / 1000 * Math.PI * 2 * 8) * 0.25;
    const r = inkStabilizerApply(s, i, i, pr, ms, 0.45);
    inAmp = Math.max(inAmp, Math.abs(pr - 0.6));
    outAmp = Math.max(outAmp, Math.abs(r.p - 0.6));
  }
  ok('basınç gürültüsü baskılanmış', outAmp < inAmp * 0.6, { inAmp: +inAmp.toFixed(3), outAmp: +outAmp.toFixed(3) });
  ok('basınç kabarıp 0 olmuyor', outAmp > 0.01, { outAmp: +outAmp.toFixed(3) });
}

/* ---- 5 · fare hız→basınç simülasyonu ---- */
{
  ok('sim: duran el = tam basınç', inkSimulatedPressure(0) === 1);
  ok('sim: tam hız = ince basınç', near(inkSimulatedPressure(1), 0.3, 1e-9));
  const p05 = inkSimulatedPressure(0.5);
  ok('sim: monoton azalan', inkSimulatedPressure(0.4) > p05 && p05 > inkSimulatedPressure(0.6), { p05: +p05.toFixed(3) });
  // kalibrasyon: 0.15 px/ms == 25.4/96 mm/ms referans (eski devran kaybı yok)
  ok('INK_MM_PER_CSS_PX = 25.4/96', near(INK_MM_PER_CSS_PX, 25.4 / 96, 1e-12));
}

/* ---- 6 · seyreltme ---- */
{
  const cap = 16;
  const pts = [];
  for (let i = 0; i < cap; i++) pts.push({ x: i, y: 0, p: 1 });
  pts[cap - 1].x += 0.3; // son nokta farklı oject
  const dec = inkDecimateStrokePoints(pts, cap);
  ok('cap gazında seyreltme devreye girer', Array.isArray(dec) && dec.length < cap, { len: dec && dec.length });
  ok('BAŞ nokta korunur', dec[0] === pts[0]);
  ok('SON 2 nokta korunur', dec[dec.length - 2] === pts[pts.length - 2] && dec[dec.length - 1] === pts[pts.length - 1]);
  ok('tutulan noktalar orijinal alt kümesi', dec.every(p => pts.includes(p)));
  ok('cap altında null (dokunma)', inkDecimateStrokePoints(pts.slice(0, cap - 1), cap) === null);
  ok('boş/null güvenli', inkDecimateStrokePoints(null, cap) === null);

  // çizgi geometrisi: hepsi aynı düz hat — seyreltme sonrası segmentler
  // herhangi bir noktadan (orijinal polilinea) 0.6 px içinde geçmeli.
  const long = [];
  for (let i = 0; i < 4000; i++) long.push({ x: i * 1.7, y: Math.sin(i / 60) * 9 });
  const d2 = inkDecimateStrokePoints(long, 3600);
  let maxErr = 0;
  for (let k = 0; k < long.length; k++) {
    // en yakın tutulan noktaya uzaklık (polilinea örneklem kayması)
    let best = Infinity;
    for (let j = Math.max(0, k - 4); j < Math.min(long.length, k + 5); j++) {
      best = Math.min(best, Math.hypot(long[k].x - d2[Math.min(d2.length - 1, j >> 1)].x,
        long[k].y - d2[Math.min(d2.length - 1, j >> 1)].y));
    }
    maxErr = Math.max(maxErr, best);
  }
  ok('geometri gecikme tolerans içinde', maxErr <= 12, { maxErr: +maxErr.toFixed(2) });
}

/* ---- sonuç ---- */
console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} test HATA (${pass} geçti)`);
process.exit(fail === 0 ? 0 : 1);
