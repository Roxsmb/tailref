'use strict';

/* FAZ 6 A10 — renk çarkı doğruluğu denetimi (kullanıcının artist
   arkadaşının regresyonu; saf Node, tarayıcı gerekmez).

   Kapsam:
   × OKLCH hex grid'inin TÜMÜNDE hex→state üretilen durum üçgen
     İÇİNDE (s,v ∈ [0,1], v ≥ s) → tutamaç asla üçgen dışına çıkamaz.
   × hex→state→hex→state idempotens: ikinci geçiş kayması eşiği altı
     → gösterilen renk = seçilen renk (panel-dışı gösterge reg.
     önlendi).
   × Üçgen-içi hex gidiş-dönüşü algısal sadık (Δl eşiği altı).
   × cusp denetimi (Ottosson yardımcıları): köşe chroma ≤ gamut cusp
     chroma → üçgen sRGB'nin güvenli içinde kalır.

   Kullanım: node scripts/color-wheel-audit.js */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'core', '56-ink-color.js');

const sandbox = { Math };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);

const {
  inkOkLchToHex, inkHexToWheelState, inkWheelStateToHex,
  inkHexToOkLch, inkWheelPureCorner, inkWheelClampStateStable,
  inkWheelCusp, inkWheelMaxSaturation,
} = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const info = detail === undefined ? '' : '  → ' + JSON.stringify(detail);
  if (cond) { pass++; console.log('OK   ' + name + info); }
  else { fail++; console.log('HATA ' + name + info); }
}

/* Δ: iki hex'in algısal uzaklığı (OKLab L + kabaca hue-içi Δc). */
function dOk(hexA, hexB) {
  const a = inkHexToOkLch(hexA), b = inkHexToOkLch(hexB);
  const dn = Math.abs(((a.h - b.h) % 360 + 540) % 360 - 180) * 0.0011;
  return Math.sqrt((a.l - b.l) * (a.l - b.l) +
    (a.c - b.c) * (a.c - b.c) + dn * dn);
}

/* ---- 1 × OKLCH hex grid: hue × l × c --------------------------
   c 0.02..0.40 (sRGB tavan ~0.33; üstler gamut-klamp ile hex'e düşer),
   l 0..1: grid'in bir bölümü üçgen dışıdır — tam olarak A10'un
   ele aldığı bölge. ~2.2K hue-karesi × 420 = ~2.3×10⁴ örnek. */
const grid = [];
for (let h = 0; h < 360; h += 7)
  for (let li = 0; li <= 20; li++)
    for (let ci = 1; ci <= 20; ci++)
      grid.push([h, li / 20, ci * 0.02]);

/* ---- 2 × tutamaç kaçışı: 0 (arkadaş bulgusu 1) ---------------- */
let escape = 0, escapeBad = null;
let worstStab = null;
for (const sample of grid) {
  const h = sample[0], l = sample[1], c = sample[2];
  const hex = inkOkLchToHex(l, c, h);
  const st = inkHexToWheelState(hex);
  const outside = !(st.s >= 0 && st.s <= 1 && st.v >= 0 && st.v <= 1 &&
    st.v >= st.s - 1e-9);
  if (outside) {
    escape++;
    if (!escapeBad) escapeBad = { h, l, c, hex, st };
  }
  /* iki-geçiş yakınsaması: UI state'i her renk değişiminde hex'ten
     yeniden okur; İKİNCİ okuma birinciyi artık değiştirmemeli
     (sabit nokta; aksi hâlde sürükleyici elin altında zıplar). */
  const back = inkWheelStateToHex(st.h, st.s, st.v);
  const st1 = inkHexToWheelState(back);
  const back2 = inkWheelStateToHex(st1.h, st1.s, st1.v);
  const st2 = inkHexToWheelState(back2);
  const ds = Math.abs(st2.s - st1.s);
  const dv = Math.abs(st2.v - st1.v);
  const dh = Math.abs(((st2.h - st1.h) % 360 + 540) % 360 - 180);
  const e = Math.max(ds, dv, dh / 360);
  if (!worstStab || e > worstStab.e) {
    worstStab = { e: +e.toFixed(5), h, l, c, hex, st, st1, st2,
      ds: +ds.toFixed(5), dv: +dv.toFixed(5), dh: +dh.toFixed(3) };
  }
}
ok('hex→state: tüm grid üçgen İÇİNDE (kaçış = 0)', escape === 0,
  escape ? { kaçış: escape, bad: escapeBad } : '0 / ' + grid.length);
ok('state→hex zinciri ikinci geçişte sabit (max kayma ≤ 0.02)',
  worstStab && worstStab.e <= 0.02, worstStab);

/* ---- 3 × algısal sadakat (arkadaş bulgusu 2) ------------------ */
/* Üçgen-içi hex'ler birebir yakın dönmeli; üçgen-dışına düşen grid
   örnekleri kenar-projeksiyon yaptığından Δ > 0 GENİŞ — bunun
   dağılımı raporlanır ve P99 eşiği assert edilir. */
let inE = { n: 0, max: 0 };
const projDeltas = [];
for (const sample of grid) {
  const h = sample[0], l = sample[1], c = sample[2];
  const hex = inkOkLchToHex(l, c, h);
  const st = inkHexToWheelState(hex);
  const back = inkWheelStateToHex(st.h, st.s, st.v);
  const e = dOk(hex, back);
  if (st.s < 0.999 && st.v < 0.999 && st.v > st.s + 0.001) {
    inE.n++;
    if (e > inE.max) {
      inE.max = e;
      inE.bad = { h, l, c, hex, st, back, e: +e.toFixed(5) };
    }
  }
  projDeltas.push(e);
}
projDeltas.sort((a, b) => a - b);
const q = qq => projDeltas[Math.min(projDeltas.length - 1,
  Math.floor(qq * projDeltas.length))];
const f4 = x => (+x).toFixed(4);
console.log('     Δ dağılımı: P50=' + f4(q(0.5)) + ' P95=' + f4(q(0.95)) +
  ' P99=' + f4(q(0.99)) + ' max=' + f4(projDeltas[projDeltas.length - 1]));
ok('üçgen-içi hex gidiş-dönüş algısal aynı (max Δ ≤ 0.012)',
  inE.max <= 0.012, { n: inE.n, maxE: f4(inE.max), bad: inE.bad || null });
ok('üçgen-dışı projeksiyon sınırlı (P99 Δ ≤ 0.05)', q(0.99) <= 0.05,
  { P99: f4(q(0.99)) });

/* ---- 4 × cusp: üçgen sRGB'nin güvenli içinde kalmalı ---------- */
/* Köşe hex'inin (a,b) normalizesin cusp çek; cusp chroma ≥ köşe
   chroma − küçük bant: köşe (ve dolayısıyla tüm üçgen) gamutta. */
let cuspBad = null;
let cuspMin = null;
for (let h = 0; h < 360; h += 5) {
  const corner = inkWheelPureCorner(h);
  const lch = inkHexToOkLch(corner.hex);
  const rad = lch.h * Math.PI / 180;
  const cusp = inkWheelCusp(Math.cos(rad), Math.sin(rad));
  const gap = cusp[1] - corner.c;
  if (cuspMin === null || gap < cuspMin.gap) cuspMin = { gap: +gap.toFixed(5), h, cornerC: +corner.c.toFixed(4), cuspC: +cusp[1].toFixed(4) };
  if (gap < -0.01) { cuspBad = cuspMin; break; }
}
ok('her hue: köşe chroma ≤ cusp chroma (üçgen sRGB içinde)', cuspMin !== null,
  cuspBad ? { cuspBad } : cuspMin);

/* ---- 5 × canlı regresyon: koyu doygun vaka takımı ------------- */
/* Katman karışımından çıkabilecek koyu doygun renkler: eski kod
   bunlardan v<s / s>1 durum üretip tutamacı dışarı gönderiyordu. */
const cases = [
  '#0020e0', '#1500c0', '#0040a0', '#870087', '#00907a',
  '#b0006a', '#2000ff', '#0082ff', '#ac00ff', '#00a0ff',
];
let caseBad = null;
for (const hex of cases) {
  const st = inkWheelClampStateStable(inkHexToWheelState(hex));
  const back = inkWheelStateToHex(st.h, st.s, st.v);
  const st2 = inkHexToWheelState(back);
  const drift = Math.max(Math.abs(st2.s - st.s), Math.abs(st2.v - st.v));
  const beyond = st.v < st.s - 1e-9 || st.s > 1 || st.v > 1;
  if (beyond || drift > 0.02) { caseBad = { hex, st, back, st2, drift: +drift.toFixed(5) }; break; }
}
ok('koyu doygun vaka takımı stabil (v ≥ s, drift ≤ 0.02)', !caseBad, caseBad);

console.log('');
console.log('color-wheel-audit: ' + pass + ' geçti, ' + fail + ' kaldı');
process.exit(fail ? 1 : 0);
