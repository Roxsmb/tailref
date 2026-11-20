'use strict';

/* Şekil oturtma (hold-to-shape) + mükemmelleştirme birim testi — saf Node,
   tarayıcı gerekmez. src/renderer/core/30b-ink-shape-snap.js yüklenir.

   Tur 4k sözleşmesi (kullanıcı onayı: "bekletilen her şey düzelsin"):
   • line + arc + circle + OVAL (rx/ry korunur) otomatik dönüşür
   • köşeli kapalı iz (kare/dikdörtgen/üçgen/çokgen) → kapalı ÇOKGEN
     (köşeler birebir; kurulamazsa null → bekletme mükemmelleştirmesi)
   • köşeli açık iz (V/Z/L) → AÇIK çokgen (closed=false; yaya dönmez)
   • bilinçli açık kıvrım (C/D: boşluk > 46°) → yay kalır, halka olmaz
   • çok-turlu spiral/öz-kesişmeli döngü → null (asla circle)
   • bekletmede mükemmelleştirme (fair v2): keskin köşeler SİVRİ kalır
     (Z asla S olmaz), zikzak bacakları kusursuz düzlenir, kopuk (br)
     iz onarılır, uçlar bit-birebir, tepe/çukur/döngü yapısı korunur
   • bekleme zamanlayıcısı: kur / titreşime dayanıklı / disarm
   ========================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'core', '30b-ink-shape-snap.js');

/* NOT: clamp (02-state-db.js) bu modülün dış bağımlılığıdır. */
const sandbox = {
  Math, console, setTimeout, clearTimeout, performance,
  clamp: (v, a, b) => (v < a ? a : (v > b ? b : v)),
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);

const {
  inkShapeSnapRecognize, inkShapeSnapConvertStroke, inkShapeSnapHoldCreate,
  inkShapeSnapFairPath,
} = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const info = detail === undefined ? '' : ' → ' + JSON.stringify(detail);
  if (cond) { pass++; console.log('OK   ' + name + info); }
  else { fail++; console.log('HATA ' + name + info); }
}

/* ---- sentetik vuruş üreticileri (px uzayı, 300×300 öğe) ---- */
const SX = 300, SY = 300;
const jitter = (seed => () => {
  // LCG: deterministik "el titremesi"
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x7fffffff - 0.5) * 2; // ±1 px
})(424242);

function strokeFromPx(px) {
  return { kind: 'stroke', points: px.map(p => ({ x: p.x / SX, y: p.y / SY, p: 1 })) };
}

function seg(a, b, step = 4) {
  const out = [];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.round(d / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x: a.x + (b.x - a.x) * t + jitter(), y: a.y + (b.y - a.y) * t + jitter() });
  }
  return out;
}

function polylinePx(legs, step = 4) {
  let pts = [];
  for (let i = 0; i < legs.length - 1; i++) {
    const s = seg(legs[i], legs[i + 1], step);
    if (i > 0) s.shift();
    pts = pts.concat(s);
  }
  return pts;
}

function arcPx(cx, cy, r, a0, a1, steps = 48) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = a0 + (a1 - a0) * t;
    out.push({ x: cx + Math.cos(ang) * r + jitter(), y: cy + Math.sin(ang) * r + jitter() });
  }
  return out;
}

function squarePx(x0, y0, s) {
  return [
    ...seg({ x: x0, y: y0 }, { x: x0 + s, y: y0 }),
    ...seg({ x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }),
    ...seg({ x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }),
    ...seg({ x: x0, y: y0 + s }, { x: x0 + 1, y: y0 + 1 }),
  ];
}

function rectPx(x0, y0, w, h) {
  return [
    ...seg({ x: x0, y: y0 }, { x: x0 + w, y: y0 }),
    ...seg({ x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }),
    ...seg({ x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }),
    ...seg({ x: x0, y: y0 + h }, { x: x0 + 1, y: y0 + 1 }),
  ];
}

function trianglePx(a, b, c) {
  return [...seg(a, b), ...seg(b, c), ...seg(c, { x: a.x + 1, y: a.y + 1 })];
}

function roughnessPx(px) {
  let s = 0;
  for (let i = 1; i + 1 < px.length; i++) {
    const dx = px[i + 1].x - 2 * px[i].x + px[i - 1].x;
    const dy = px[i + 1].y - 2 * px[i].y + px[i - 1].y;
    s += Math.hypot(dx, dy);
  }
  return s / Math.max(1, px.length - 2);
}

/** Köşe kapsama: her hedef köşeye en yakın aday nokta tol içinde mi?
    (çokgen nokta sırası çizim yönünü taşır; kapsama yeterli kanıt.) */
function cornersCovered(pts, targets, tol = 14) {
  return targets.every(t =>
    pts.some(p => Math.hypot(p.x - t[0], p.y - t[1]) <= tol));
}

/* ---- 1 · kapalı şekiller: Tur 4k sözleşmesi ---- */
{
  /* Kullanıcı onayı (Tur 4k): köşeli kapalı iz kusursuz ÇOKGENE
     dönüşür — köşeler birebir korunur, aday kapalıdır. */
  const sq = inkShapeSnapRecognize(squarePx(40, 40, 160));
  ok('kare → poly (kapalı)', sq && sq.type === 'poly' && sq.closed === true,
    sq && sq.type);
  if (sq && sq.type === 'poly') {
    ok('kare köşe sayısı 4', sq.pts.length === 4, sq.pts.length);
    ok('kare köşeleri hedeflerde',
      cornersCovered(sq.pts, [[40, 40], [200, 40], [200, 200], [40, 200]]),
      sq.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }

  const rect = inkShapeSnapRecognize(rectPx(30, 60, 220, 90));
  ok('dikdörtgen → poly (kapalı)',
    rect && rect.type === 'poly' && rect.closed === true, rect && rect.type);
  if (rect && rect.type === 'poly') {
    ok('dikdörtgen köşe sayısı 4', rect.pts.length === 4, rect.pts.length);
    ok('dikdörtgen köşeleri hedeflerde',
      cornersCovered(rect.pts, [[30, 60], [250, 60], [250, 150], [30, 150]]),
      rect.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }

  const tri = inkShapeSnapRecognize(trianglePx(
    { x: 150, y: 40 }, { x: 40, y: 240 }, { x: 260, y: 240 }));
  ok('üçgen → poly (kapalı)',
    tri && tri.type === 'poly' && tri.closed === true, tri && tri.type);
  if (tri && tri.type === 'poly') {
    ok('üçgen köşe sayısı 3', tri.pts.length === 3, tri.pts.length);
    ok('üçgen köşeleri hedeflerde',
      cornersCovered(tri.pts, [[150, 40], [40, 240], [260, 240]]),
      tri.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }

  // beşgen: 5 kenar (kapalı halka, kapanış ilk köşeye döner)
  const pent = [];
  for (let i = 0; i < 5; i++) {
    const a0 = -Math.PI / 2 + i * 2 * Math.PI / 5;
    const a1 = -Math.PI / 2 + ((i + 1) % 5) * 2 * Math.PI / 5;
    pent.push(...seg(
      { x: 150 + Math.cos(a0) * 90, y: 150 + Math.sin(a0) * 90 },
      { x: 150 + Math.cos(a1) * 90, y: 150 + Math.sin(a1) * 90 }));
  }
  const pentRes = inkShapeSnapRecognize(pent);
  ok('beşgen → poly (kapalı)',
    pentRes && pentRes.type === 'poly' && pentRes.closed === true,
    pentRes && pentRes.type);
  if (pentRes && pentRes.type === 'poly') {
    ok('beşgen köşe sayısı 5', pentRes.pts.length === 5, pentRes.pts.length);
    ok('beşgen köşeleri hedeflerde', (() => {
      const t = [];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
        t.push([Math.round(150 + Math.cos(a) * 90),
                Math.round(150 + Math.sin(a) * 90)]);
      }
      return cornersCovered(pentRes.pts, t, 16);
    })(), pentRes.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }

  const resC = inkShapeSnapRecognize(arcPx(150, 150, 90, 0, Math.PI * 1.98, 64));
  ok('daire → circle', resC && resC.type === 'circle', resC && resC.type);
  if (resC) {
    ok('daire merkezi makul', Math.hypot(resC.cx - 150, resC.cy - 150) < 12,
      { cx: resC.cx, cy: resC.cy });
    ok('daire yarıçapı makul', Math.abs(resC.r - 90) < 8, resC.r);
  }
}

/* ---- 2 · açık şekiller ---- */
{
  const line = seg({ x: 40, y: 50 }, { x: 270, y: 260 }, 3);
  const resL = inkShapeSnapRecognize(line);
  ok('düz çizgi → line', resL && resL.type === 'line', resL && resL.type);

  const arc = arcPx(150, 150, 100, Math.PI * 0.9, Math.PI * 1.9, 40);
  const resA = inkShapeSnapRecognize(arc);
  ok('yay → arc', resA && resA.type === 'arc', resA && resA.type);
  if (resA) {
    ok('yay merkezi doğru', Math.hypot(resA.cx - 150, resA.cy - 150) < 10,
      { cx: resA.cx, cy: resA.cy });
  }

  /* Tur 4j: yarım yuvarlak → yarım YAY, asla tam daire. */
  const half = arcPx(150, 150, 100, Math.PI, Math.PI * 2, 60);
  const resH = inkShapeSnapRecognize(half);
  ok('yarım yuvarlak → arc (circle değil)', resH && resH.type === 'arc', resH && resH.type);
  if (resH) {
    ok('yarım yuvarlak taraması ~π', Math.abs(Math.abs(resH.sweep) - Math.PI) < 0.35,
      resH && Math.abs(resH.sweep));
  }
}

/* ---- 3 · köşeli açık vuruşlar AÇIK ÇOKGENE dönüşür (kritik ayırt edici) ---- */
{
  const lShape = [...seg({ x: 60, y: 40 }, { x: 60, y: 240 }),
                  ...seg({ x: 60, y: 240 }, { x: 240, y: 240 })];
  const resLShape = inkShapeSnapRecognize(lShape);
  ok('L şekli → poly (açık)',
    resLShape && resLShape.type === 'poly' && resLShape.closed === false,
    resLShape && resLShape.type);
  if (resLShape && resLShape.type === 'poly') {
    ok('L köşeleri hedeflerde',
      cornersCovered(resLShape.pts, [[60, 40], [60, 240], [240, 240]]),
      resLShape.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }

  const vShape = [...seg({ x: 50, y: 50 }, { x: 150, y: 250 }),
                  ...seg({ x: 150, y: 250 }, { x: 250, y: 50 })];
  const resV = inkShapeSnapRecognize(vShape);
  ok('V şekli → poly (açık)',
    resV && resV.type === 'poly' && resV.closed === false,
    resV && resV.type);
  if (resV && resV.type === 'poly') {
    ok('V köşeleri hedeflerde',
      cornersCovered(resV.pts, [[50, 50], [150, 250], [250, 50]]),
      resV.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }

  const sShape = [...arcPx(150, 100, 60, Math.PI * 0.2, Math.PI * 1.1, 24),
                  ...arcPx(150, 200, 60, Math.PI * 1.9, Math.PI * 2.8, 24)];
  const resS = inkShapeSnapRecognize(sShape);
  ok('S eğrisi → null', resS === null, resS && resS.type);

  // açık "C": uçları kapatmaya yakın ama tam kapanmamış; yay ya da null
  // olabilir — kesinlikle circle olmamalı.
  const cShape = arcPx(150, 150, 90, Math.PI * 0.45, Math.PI * 1.95, 40);
  const resC = inkShapeSnapRecognize(cShape);
  ok('açık C → arc ya da null', resC === null || resC.type === 'arc', resC && resC.type);
}

/* ---- 4 · dokunmama garantisi ---- */
{
  ok('kısa vuruş → null',
    inkShapeSnapRecognize(seg({ x: 10, y: 10 }, { x: 18, y: 12 }, 1)) === null);

  // dağınık karalama: deterministik rastgele yürüyüş
  const scribble = [];
  let x = 100, y = 100;
  let seed = 7;
  for (let i = 0; i < 80; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    x += (seed / 0x7fffffff - 0.5) * 40;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    y += (seed / 0x7fffffff - 0.5) * 40;
    scribble.push({ x, y });
  }
  ok('karalama → null', inkShapeSnapRecognize(scribble) === null,
    (() => { const r = inkShapeSnapRecognize(scribble); return r && r.type; })());

  // düzensiz kapalı çizim (kalp benzeri): daire/çokgen olmamalı
  const heart = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    heart.push({
      x: 150 + 16 * Math.pow(Math.sin(t), 3) * 8,
      y: 140 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) - Math.cos(4 * t)) * 8,
    });
  }
  const resH = inkShapeSnapRecognize(heart);
  ok('kalp eğrisi → null (şekle dönüşmez)', resH === null, resH && resH.type);
}

/* ---- 4b · halka çeşitliliği: NASIL çizildiği önemli değil ----
   Geçmeli tur, boşluklu kapanış, kanca girişli başlangıç, çift tur,
   basık oval, kuyruklu "6" → daire. İçe spiral (çok-turlu) → Tur 4j:
   ASLA daire değil, mükemmelleştirmeye düşer. */
{
  const mkJig = seed => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 2; // ±1 px
  };
  function ell(cx, cy, rx, ry, a0, a1, steps, jig) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const ang = a0 + (a1 - a0) * (i / steps);
      out.push({ x: cx + Math.cos(ang) * rx + jig(),
                 y: cy + Math.sin(ang) * ry + jig() });
    }
    return out;
  }
  const TAU = Math.PI * 2;

  // 1 · geçmeli tur: kapanışı ~54° aşıyor, üstüne geri dönüyor
  {
    const res = inkShapeSnapRecognize(ell(150, 150, 90, 88, -Math.PI / 2,
      -Math.PI / 2 + TAU * 1.15, 90, mkJig(11)));
    ok('halka · geçmeli tur (1.15×) → circle', res && res.type === 'circle', res && res.type);
  }

  // 2 · boşluklu kapanış: 325° ve 340° tarama, üstte boşluk
  {
    const res = inkShapeSnapRecognize(ell(150, 150, 92, 86, -Math.PI / 2,
      -Math.PI / 2 + TAU * (325 / 360), 84, mkJig(12)));
    ok('halka · 325° boşluklu → circle', res && res.type === 'circle', res && res.type);
    const res2 = inkShapeSnapRecognize(ell(150, 150, 90, 90, -Math.PI / 2,
      -Math.PI / 2 + TAU * (340 / 360), 84, mkJig(13)));
    ok('halka · 340° boşluklu → circle', res2 && res2.type === 'circle', res2 && res2.type);
  }

  // 3 · kanca girişli: başlangıçta küçük iç kanca, sonra tam tur
  {
    const jig = mkJig(14);
    const pts = [
      ...ell(170, 230, 45, 45, Math.PI * 0.75, Math.PI * 1.45, 10, jig), // kanca
      ...ell(150, 150, 90, 90, Math.PI * 0.9, Math.PI * 0.9 + TAU, 80, jig), // tur
    ];
    const res = inkShapeSnapRecognize(pts);
    ok('halka · kanca girişli → circle', res && res.type === 'circle', res && res.type);
  }

  // 4 · çift tur: 1.75 tur — aynı izin üstüne binmiş
  {
    const res = inkShapeSnapRecognize(ell(150, 150, 90, 88, -Math.PI / 2,
      -Math.PI / 2 + TAU * 1.75, 130, mkJig(15)));
    ok('halka · çift tur (1.75×) → circle', res && res.type === 'circle', res && res.type);
  }

  // 5 · basık oval: yatay uzamış elips — CV yolu eleştirir, dönüş kurtarır
  {
    const res = inkShapeSnapRecognize(ell(150, 150, 110, 68, -Math.PI / 2,
      -Math.PI / 2 + TAU, 80, mkJig(16)));
    ok('halka · basık oval → circle', res && res.type === 'circle', res && res.type);
    if (res) {
      ok('halka · oval merkezi doğru',
        Math.hypot(res.cx - 150, res.cy - 150) < 12, { cx: res.cx, cy: res.cy });
    }
  }

  // 6 · kuyruklu "6": aşağı inen kuyruk döngüye tepeden bağlanır + tam tur
  {
    const jig = mkJig(17);
    const pts = [
      ...seg({ x: 158, y: 40 }, { x: 154, y: 114 }, 3), // kuyruk
      ...ell(160, 190, 74, 74, -Math.PI / 2, -Math.PI / 2 + TAU, 76, jig),
    ];
    const res = inkShapeSnapRecognize(pts);
    ok('halka · kuyruklu 6 → circle', res && res.type === 'circle', res && res.type);
  }

  // 7 · içe spiral: yarıçap 100 → 55 daralırken 2.5 tur — Tur 4j:
  //     ASLA circle (kalıntı + drift kapıları); mükemmelleştirmeye düşer.
  {
    const jig = mkJig(18);
    const pts = [];
    const steps = 150;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = -Math.PI / 2 + TAU * 2.5 * t;
      const r = 100 - 45 * t;
      pts.push({ x: 150 + Math.cos(ang) * r + jig(),
                 y: 150 + Math.sin(ang) * r + jig() });
    }
    const res = inkShapeSnapRecognize(pts);
    ok('spiral (2.5 tur) → null (circle DEĞİL)', res === null, res && res.type);

    /* Mükemmelleştirme: yapı korunur — dönüş sayısı ~2.5 tur, pürüzlülük
       düşer, uçlar bit-birebir. */
    const stroke = strokeFromPx(pts);
    const out = inkShapeSnapFairPath(stroke.points, SX, SY);
    ok('spiral fair çıktı var (kusursuzlaşır)', !!out);
    if (out) {
      ok('spiral uçlar bit-birebir',
        out[0] === stroke.points[0] &&
        out[out.length - 1] === stroke.points[stroke.points.length - 1]);
      const px = out.map(p => ({ x: p.x * SX, y: p.y * SY }));
      let turnSum = 0;
      let prev = Math.atan2(px[1].y - px[0].y, px[1].x - px[0].x);
      for (let i = 2; i < px.length; i++) {
        const h = Math.atan2(px[i].y - px[i - 1].y, px[i].x - px[i - 1].x);
        let d = h - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        turnSum += d; prev = h;
      }
      const turnsKept = Math.abs(turnSum) / TAU;
      ok('spiral dönüş sayısı korunur (~2.5)', Math.abs(turnsKept - 2.5) < 0.45,
        +turnsKept.toFixed(2));
      ok('spiral pürüzlülük düşer',
        roughnessPx(px) < roughnessPx(pts) * 0.7,
        { once: +roughnessPx(pts).toFixed(3), sonra: +roughnessPx(px).toFixed(3) });
    }
  }
}

/* ---- 4c · gevşek halka kapsamı: boşluklu/samuraya yakın daireler ----
   Eşikler (Tur 4k): TURN_CIRCLE 4.9 (~280°), TURN_GAP 0.8 (~46°),
   CV 0.18; sınırlar kanıtlanır. */
{
  const mkJig = seed => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 2;
  };
  function ell(cx, cy, rx, ry, a0, a1, steps, jig) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const ang = a0 + (a1 - a0) * (i / steps);
      out.push({ x: cx + Math.cos(ang) * rx + jig(),
                 y: cy + Math.sin(ang) * ry + jig() });
    }
    return out;
  }
  const TAU = Math.PI * 2;

  // 290° boşluklu: boşluk 70° > GAP (46°) → bilinçli AÇIK kıvrım, yay
  {
    const res = inkShapeSnapRecognize(ell(150, 150, 88, 86, -Math.PI / 2,
      -Math.PI / 2 + TAU * (290 / 360), 76, mkJig(31)));
    ok('halka · 290° boşluklu → arc (bilinçli açık)',
      res && res.type === 'arc', res && res.type);
  }
  // 300° boşluklu (~60° açık kapanış): boşluk hâlâ GAP üstü → yay
  {
    const res = inkShapeSnapRecognize(ell(150, 150, 90, 88, -Math.PI / 2,
      -Math.PI / 2 + TAU * (300 / 360), 78, mkJig(32)));
    ok('halka · 300° boşluklu → arc (bilinçli açık)',
      res && res.type === 'arc', res && res.type);
  }
  // samuraya yakın kapalı daire: dalgalı yarıçap (CV~0.15)
  {
    const jig = mkJig(33);
    const pts = [];
    const steps = 72;
    for (let i = 0; i <= steps; i++) {
      const ang = -Math.PI / 2 + TAU * (i / steps);
      const wob = 1 + 0.09 * Math.sin(ang * 5);  // dalgalı yarıçap
      pts.push({ x: 150 + Math.cos(ang) * 90 * wob + jig(),
                 y: 150 + Math.sin(ang) * 90 * wob + jig() });
    }
    const res = inkShapeSnapRecognize(pts);
    ok('halka · dalgalı yarıçaplı (CV~0.15) → circle', res && res.type === 'circle',
      res && res.type);
  }
  // sınır: 270° açık "C" hâlâ daire DEĞİL (arc/null kalır)
  {
    const res = inkShapeSnapRecognize(ell(150, 150, 90, 90, Math.PI * 0.45,
      Math.PI * 1.95, 60, mkJig(34)));
    ok('sınır · 270° açık C → arc ya da null (daire olmaz)',
      res === null || res.type === 'arc', res && res.type);
  }
}

/* ---- 4d · dönüşüm: snapFree işareti + medyan basınç ---- */
{
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const ang = (i / 60) * Math.PI * 1.98;
    pts.push({ x: 150 + Math.cos(ang) * 90, y: 150 + Math.sin(ang) * 90,
               p: i < 30 ? 0.15 : 0.85 });  // ilk yarısı hafif, sonra tam
  }
  const stroke = { kind: 'stroke', points: pts.map(p => ({ x: p.x / 300, y: p.y / 300, p: p.p })) };
  const converted = inkShapeSnapConvertStroke(stroke, 300, 300);
  ok('daire vuruşu dönüştü', converted === true);
  ok('snapFree işareti kondu', stroke.snapFree === 1, stroke.snapFree);
  ok('medyan basınç kullanıldı (ilk değil)',
    stroke.points.every(p => p.p === 0.85), stroke.points[0] && stroke.points[0].p);
}

/* ---- 5 · vuruş dönüşümü: Tur 4k sözleşmesi ---- */
{
  /* Köşeli kapalı vuruş ÇOKGEN vuruşuna dönüşür: kind 'shape',
     shape 'poly', closed=true; köşe noktaları birebir yazılır. */
  const sqStroke = strokeFromPx(squarePx(40, 40, 160));
  const sqConv = inkShapeSnapConvertStroke(sqStroke, SX, SY);
  ok('kare vuruşu dönüştü', sqConv === true, sqConv);
  ok('kare: shape=poly, closed=true',
    sqStroke.kind === 'shape' && sqStroke.shape === 'poly' &&
    sqStroke.closed === true,
    { kind: sqStroke.kind, shape: sqStroke.shape, closed: sqStroke.closed });
  ok('kare: 4 köşe + kapanış noktası (son == ilk)',
    sqStroke.points.length === 5 &&
    Math.hypot(
      sqStroke.points[0].x - sqStroke.points[4].x,
      sqStroke.points[0].y - sqStroke.points[4].y) < 1e-9,
    sqStroke.points.length);

  const lineStroke = strokeFromPx(seg({ x: 40, y: 50 }, { x: 270, y: 260 }, 3));
  inkShapeSnapConvertStroke(lineStroke, SX, SY);
  ok('çizgi: shape=line, closed=false',
    lineStroke.kind === 'shape' && lineStroke.shape === 'line' && lineStroke.closed === false);

  const circStroke = strokeFromPx(arcPx(150, 150, 90, 0, Math.PI * 1.98, 64));
  inkShapeSnapConvertStroke(circStroke, SX, SY);
  ok('daire: shape=circle', circStroke.shape === 'circle', circStroke.shape);
  /* Tur 4: serbest-el damga yolu AÇIK poliline çizer (stroke.closed
     fırça zincirinde kullanılmıyor) → kapanış noktası açıkça yazılır.
     Eskiden "örtüşmez" bekleniyordu; bu, daire başında bir segment
     boşluk üretiyordu (kullanıcı raporu 12.11). */
  ok('daire kapanış noktası (65 nokta, son == ilk)',
    circStroke.points.length === 65 &&
    Math.hypot(
      circStroke.points[0].x - circStroke.points[64].x,
      circStroke.points[0].y - circStroke.points[64].y) < 1e-9);

  // AÇIK köşeli vuruş da dönüştürülür; closed=false (damga zinciri
  // kapanış segmenti çizmez → açık V/Z/L kapanmaz).
  const lStroke = strokeFromPx([...seg({ x: 60, y: 40 }, { x: 60, y: 240 }),
                                ...seg({ x: 60, y: 240 }, { x: 240, y: 240 })]);
  const lConv = inkShapeSnapConvertStroke(lStroke, SX, SY);
  ok('L vuruşu dönüştü (shape=poly, closed=false)',
    lConv === true && lStroke.shape === 'poly' && lStroke.closed === false,
    { conv: lConv, shape: lStroke.shape, closed: lStroke.closed });
  ok('L vuruşu: 3 köşe, kapanış noktası YOK',
    lStroke.points.length === 3 &&
    Math.hypot(
      lStroke.points[0].x - lStroke.points[2].x,
      lStroke.points[0].y - lStroke.points[2].y) > 1e-6,
    lStroke.points.length);

  // tanınmayan vuruşta (S eğrisi) DOKUNMAZ
  const sStroke = strokeFromPx([
    ...arcPx(150, 100, 60, Math.PI * 0.2, Math.PI * 1.1, 24),
    ...arcPx(150, 200, 60, Math.PI * 1.9, Math.PI * 2.8, 24),
  ]);
  const sConv = inkShapeSnapConvertStroke(sStroke, SX, SY);
  ok('S vuruşu dönüştürülmedi', sConv === false, sConv);
  ok('S vuruşu kind değişmedi',
    sStroke.kind === 'stroke' && sStroke.shape === undefined);
}

/* ---- 5b · MÜKEMMELLEŞTİRME (fair path) ---- */
{
  /* Zikzak: uçlar bit-birebir, köşeler sivri kalır, pürüzlülük düşer,
     bacaklar (açık iz) kusursuz düzlenir. */
  const legs = [
    { x: 30, y: 40 }, { x: 270, y: 40 }, { x: 30, y: 130 },
    { x: 270, y: 130 }, { x: 30, y: 220 }, { x: 270, y: 220 },
  ];
  const raw = polylinePx(legs, 5);
  const stroke = strokeFromPx(raw);
  /* Tur 4k: köşeli açık iz kusursuz AÇIK ÇOKGENE oturur (V/Z/W) —
     zirve korumalı span sınıfı sayılmazsa RefineCorners yutulan
     köşeleri geri getirir. */
  const wRes = inkShapeSnapRecognize(raw);
  ok('zikzak → açık çokgen (poly, closed=false, 6 nokta)',
    !!wRes && wRes.type === 'poly' && wRes.closed === false &&
    Array.isArray(wRes.pts) && wRes.pts.length === 6,
    wRes ? (wRes.type + ' closed=' + wRes.closed + ' n=' +
      (wRes.pts && wRes.pts.length) + ' ' + (wRes.pts || []).map(p =>
      [Math.round(p.x), Math.round(p.y)]).join(' ')) : 'null');
  const out = inkShapeSnapFairPath(stroke.points, SX, SY);
  ok('zikzak fair çıktı var', !!out);
  if (out) {
    ok('zikzak uç[0] bit-birebir orijinal nesne', out[0] === stroke.points[0]);
    ok('zikzak uç[n] bit-birebir orijinal nesne',
      out[out.length - 1] === stroke.points[stroke.points.length - 1]);
    const fairPx = out.map(p => ({ x: p.x * SX, y: p.y * SY }));
    ok('zikzak pürüzlülük düşer', roughnessPx(fairPx) < roughnessPx(raw) * 0.5,
      { once: +roughnessPx(raw).toFixed(3), sonra: +roughnessPx(fairPx).toFixed(3) });
    // köşe sivriliği: her köşe civarında max pencere dönüşü korunmalı
    const cornerTurns = (px) => legs.slice(1, -1).map(c => {
      let best = 0;
      const W = 6;
      for (let i = W; i + W < px.length; i++) {
        if (Math.hypot(px[i].x - c.x, px[i].y - c.y) > 14) continue;
        const v1x = px[i].x - px[i - W].x, v1y = px[i].y - px[i - W].y;
        const v2x = px[i + W].x - px[i].x, v2y = px[i + W].y - px[i].y;
        const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
        if (m1 < 1e-9 || m2 < 1e-9) continue;
        const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
        best = Math.max(best, Math.acos(dot));
      }
      return best;
    });
    const tB = cornerTurns(raw), tA = cornerTurns(fairPx);
    ok('zikzak köşe dönüşleri korunur (≥ %92)',
      tA.every((t, i) => t >= tB[i] * 0.92 - 0.02),
      { once: tB.map(t => +t.toFixed(2)), sonra: tA.map(t => +t.toFixed(2)) });
    // bacak dalgalanması: kendi akorduna sapma düşmeli
    const legDev = (px, a, b) => {
      const band = [];
      for (const p of px) {
        const d = Math.abs((p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y)) /
          Math.hypot(b.x - a.x, b.y - a.y);
        if (d > 8) continue;
        const t2 = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) /
          ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
        if (t2 < 0.1 || t2 > 0.86) continue;
        band.push(p);
      }
      if (band.length < 3) return 0;
      const c0 = band[0], c1 = band[band.length - 1];
      const dx = c1.x - c0.x, dy = c1.y - c0.y, L = Math.hypot(dx, dy);
      let m = 0;
      for (const p of band) {
        const t = L > 1e-9 ? ((p.x - c0.x) * dx + (p.y - c0.y) * dy) / (L * L) : 0;
        if (t < 0.12 || t > 0.88) continue;
        m = Math.max(m, Math.abs((p.y - c0.y) * dx - (p.x - c0.x) * dy) / L);
      }
      return m;
    };
    const dB = Math.max(legDev(raw, legs[0], legs[1]), legDev(raw, legs[2], legs[3]));
    const dA = Math.max(legDev(fairPx, legs[0], legs[1]), legDev(fairPx, legs[2], legs[3]));
    ok('zikzak bacak düzlüğü iyileşir', dA < dB * 0.6,
      { once: +dB.toFixed(2), sonra: +dA.toFixed(2) });
  }

  /* Z harfi: 2 keskin köşe bölgesi korunur — S olmaz. */
  {
    const zLegs = [
      { x: 40, y: 40 }, { x: 250, y: 40 }, { x: 40, y: 190 }, { x: 250, y: 190 },
    ];
    const zRaw = polylinePx(zLegs, 5);
    const zStroke = strokeFromPx(zRaw);
    ok('Z tanıma: poly (açık çokgen, closed=false)', (() => {
      const r = inkShapeSnapRecognize(zRaw);
      return r && r.type === 'poly' && r.closed === false && r.pts.length === 4;
    })(), (() => { const r = inkShapeSnapRecognize(zRaw);
      return r && (r.type === 'poly' ? 'poly n=' + r.pts.length + ' closed=' + r.closed : r.type); })());
    const zOut = inkShapeSnapFairPath(zStroke.points, SX, SY);
    ok('Z fair çıktı var', !!zOut);
    if (zOut) {
      const zPx = zOut.map(p => ({ x: p.x * SX, y: p.y * SY }));
      let highZones = 0;
      const W = 6;
      let inZone = false;
      for (let i = W; i + W < zPx.length; i++) {
        const v1x = zPx[i].x - zPx[i - W].x, v1y = zPx[i].y - zPx[i - W].y;
        const v2x = zPx[i + W].x - zPx[i].x, v2y = zPx[i + W].y - zPx[i].y;
        const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
        const dot = m1 > 1e-9 && m2 > 1e-9 ? (v1x * v2x + v1y * v2y) / (m1 * m2) : 1;
        const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (turn >= 0.72) { if (!inZone) { highZones++; inZone = true; } }
        else inZone = false;
      }
      ok('Z: 2 keskin köşe bölgesi korunur', highZones === 2, highZones);
    }
  }

  /* Kapalı el-kare: köşeler sabit, kenarlar yumuşar, yapı korunur
     (çokgene dönüştürülemediği karalama durumunda fair yolu devrede). */
  {
    const sqRaw = squarePx(40, 40, 160);
    const sqStroke = strokeFromPx(sqRaw);
    const sqOut = inkShapeSnapFairPath(sqStroke.points, SX, SY);
    ok('el-kare fair çıktı var', !!sqOut);
    if (sqOut) {
      const sqPx = sqOut.map(p => ({ x: p.x * SX, y: p.y * SY }));
      ok('el-kare pürüzlülük düşer', roughnessPx(sqPx) < roughnessPx(sqRaw) * 0.6,
        { once: +roughnessPx(sqRaw).toFixed(3), sonra: +roughnessPx(sqPx).toFixed(3) });
      // 4 köşe hâlâ yüksek dönüş bölgeleri
      let zones = 0;
      const W = 6;
      let inZone = false;
      for (let i = W; i + W < sqPx.length; i++) {
        const v1x = sqPx[i].x - sqPx[i - W].x, v1y = sqPx[i].y - sqPx[i - W].y;
        const v2x = sqPx[i + W].x - sqPx[i].x, v2y = sqPx[i + W].y - sqPx[i].y;
        const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
        const dot = m1 > 1e-9 && m2 > 1e-9 ? (v1x * v2x + v1y * v2y) / (m1 * m2) : 1;
        if (Math.acos(Math.max(-1, Math.min(1, dot))) >= 0.72) {
          if (!inZone) { zones++; inZone = true; }
        } else inZone = false;
      }
      // 4 köşe: vuruş köşede başlıyorsa başlangıç köşesi uç (rijit)
      // olduğundan pencere taraması dışında kalır → 3 iç köşe bölgesi.
      ok('el-kare: köşe yapısı korunur (≥3 bölge)', zones >= 3, zones);
    }
  }

  /* Karalama: nazik iyileşme, yapı korunur. */
  {
    const scr = [];
    for (let i = 0; i <= 260; i++) {
      const t = i / 260;
      scr.push({
        x: 30 + 240 * t + 14 * Math.sin(t * 34) + jitter() * 1.4,
        y: 150 + 60 * Math.sin(t * 19) + 25 * Math.sin(t * 47) + jitter() * 1.4,
      });
    }
    const scrStroke = strokeFromPx(scr);
    const scrOut = inkShapeSnapFairPath(scrStroke.points, SX, SY);
    ok('karalama fair çıktı var', !!scrOut);
    if (scrOut) {
      const scrPx = scrOut.map(p => ({ x: p.x * SX, y: p.y * SY }));
      const rB = roughnessPx(scr), rA = roughnessPx(scrPx);
      ok('karalama: nazik iyileşme (yıkıcı değil)', rA < rB && rA > rB * 0.1,
        { once: +rB.toFixed(2), sonra: +rA.toFixed(2) });
    }
  }

  /* Tekrarlı bekletmede yakınsama: iz sürüklenmez, uçlar korunur. */
  {
    const vLegs = [{ x: 30, y: 40 }, { x: 270, y: 40 }, { x: 30, y: 130 }];
    const vRaw = polylinePx(vLegs, 5);
    const vStroke = strokeFromPx(vRaw);
    const v1 = inkShapeSnapFairPath(vStroke.points, SX, SY);
    ok('fair 1. geçiş çıktı', !!v1);
    if (v1) {
      const px1 = v1.map(p => ({ x: p.x * SX, y: p.y * SY }));
      const r1 = roughnessPx(px1);
      const v2 = inkShapeSnapFairPath(v1, SX, SY);
      /* Tekrarlı bekletme = art arda "iyileştir" istekleri: her geçiş
         pürüzlülüğü KÖTÜLEŞTİRMEMELİ, yer değiştirmesi kapsamla sınırlı
         kalmalı (sürüklenme yok). Yakınsamış izde null döner. */
      ok('fair 2. geçiş: kötülemez (ya da yakınsadı)', v2 === null ||
        (() => {
          const px2 = v2.map(p => ({ x: p.x * SX, y: p.y * SY }));
          const r2 = roughnessPx(px2);
          return r2 <= r1 * 1.05;
        })(), v2 ? 'dizi' : 'null');
      ok('tekrarlı fairde uçlar bit-birebir',
        v1[0] === vStroke.points[0] &&
        v1[v1.length - 1] === vStroke.points[vStroke.points.length - 1] &&
        (v2 === null || (v2[0] === v1[0] &&
          v2[v2.length - 1] === v1[v1.length - 1])));
    }
  }

  /* Tur 4k · kopukluk (br) onarımı: küçük boşluk → TEK BÜTÜN
     köprülenip düzeltilir; büyük boşluk → parçalar AYRI düzeltilir,
     uç nesneleri + br bayrakları birebir korunur. Ölçekli uzay
     (normalize nokta + sx/sy) ile ölçülür. */
  {
    const mkRun = (a, b, br) => {
      const out = [];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(2, Math.round(d / 5));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = { x: (a.x + (b.x - a.x) * t + jitter() * 0.5) / SX,
          y: (a.y + (b.y - a.y) * t + jitter() * 0.5) / SY };
        if (br && i === 0) p.br = 1;
        out.push(p);
      }
      return out;
    };
    // küçük kopukluk: boşluk ~15 px < healCap
    const runA = mkRun({ x: 60, y: 60 }, { x: 200, y: 64 });
    const runB = mkRun({ x: 215, y: 78 }, { x: 270, y: 140 }, true);
    const smallGap = runA.concat(runB);
    const fS = inkShapeSnapFairPath(smallGap, SX, SY);
    ok('br · küçük kopukluk onarılır (tek bütün)', !!fS, fS && fS.length);
    if (fS) {
      const e0 = smallGap[0], e1 = smallGap[smallGap.length - 1];
      const o0 = fS[0], o1 = fS[fS.length - 1];
      ok('br · onarımda uçlar bit-birebir (değer)',
        o0.x === e0.x && o0.y === e0.y && o1.x === e1.x && o1.y === e1.y,
        { a: [o0.x, o0.y], b: [e0.x, e0.y] });
      // köprü sürekli: ardışık adım px'te tavan altı
      let maxStep = 0;
      for (let i = 1; i < fS.length; i++) {
        maxStep = Math.max(maxStep, Math.hypot(
          (fS[i].x - fS[i - 1].x) * SX, (fS[i].y - fS[i - 1].y) * SY));
      }
      ok('br · köprü bölgesi süreksizlik içermiyor', maxStep < 30,
        +maxStep.toFixed(1));
    }
    // büyük kopukluk: boşluk ~260 px > healCap
    const runC = mkRun({ x: 60, y: 60 }, { x: 200, y: 64 });
    const runD = mkRun({ x: 30, y: 260 }, { x: 260, y: 280 }, true);
    const bigGap = runC.concat(runD);
    const fB = inkShapeSnapFairPath(bigGap, SX, SY);
    ok('br · büyük kopuklukta parçalar ayrı düzeltilir', !!fB);
    if (fB) {
      ok('br · parça uçları orijinal nesneler',
        fB[0] === bigGap[0] &&
        fB[fB.length - 1] === bigGap[bigGap.length - 1]);
      ok('br · br bayrağı korunur', fB.some(p => p.br) === true);
    }
  }

  /* Alan taşınımı + girdi mutasyona uğramaz. */
  {
    const tiltRaw = polylinePx(
      [{ x: 30, y: 40 }, { x: 270, y: 40 }, { x: 30, y: 130 }], 5)
      .map((p, i) => ({ x: p.x / SX, y: p.y / SY, p: 0.5 + 0.1 * (i % 3),
        a: (i * 0.7) % (2 * Math.PI), s: 0 }));
    const clone = JSON.parse(JSON.stringify(tiltRaw));
    const tOut = inkShapeSnapFairPath(tiltRaw, SX, SY);
    ok('tilt/alan fair çıktı var', !!tOut);
    ok('girdi dizisi değişmez', JSON.stringify(tiltRaw) === JSON.stringify(clone));
    if (tOut) {
      ok('uçlar orijinal nesne',
        tOut[0] === tiltRaw[0] && tOut[tOut.length - 1] === tiltRaw[tiltRaw.length - 1]);
      ok('p alanı taşınır', Number.isFinite(tOut[5].p), tOut[5].p);
      ok('a alanı taşınır', Number.isFinite(tOut[5].a), +tOut[5].a.toFixed(2));
    }
  }

  /* Değmez: kısa/az noktalı iz → null. */
  {
    const short = [];
    for (let i = 0; i <= 6; i++) short.push({ x: 10 + i, y: 10 + i * 0.5 });
    const shortStroke = strokeFromPx(short);
    ok('kısa iz fair → null', inkShapeSnapFairPath(shortStroke.points, SX, SY) === null);
    ok('3 nokta fair → null',
      inkShapeSnapFairPath(
        [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.1 }], SX, SY) === null);
  }
}

/* ---- 6 · bekleme zamanlayıcısı ---- */
{
  let fired = 0;
  const hold = inkShapeSnapHoldCreate(() => { fired++; });

  // ilk track: zamanlayıcı + çapa kurulur
  hold.track(100, 100);
  ok('kurulum zamanlayıcı ve çapa kurar', !!hold.timer && !!hold.anchor);

  // küçük titreşim: çapa değişmez (aynı zamanlayıcı sürer)
  const anchor0 = hold.anchor;
  hold.track(101, 101);
  ok('titreşim çapayı bozmaz', hold.anchor === anchor0);

  // gerçek hareket: çapa yenilenir
  hold.track(120, 105);
  ok('hareket çapayı yeniler', hold.anchor !== anchor0);

  // disarm: zamanlayıcı temizlenir
  hold.disarm();
  ok('disarm zamanlayıcıyı kapatır', hold.timer === null && hold.anchor === null);
}

/* disarm sonrası tetiklenmez (zamanlayıcı kanıtı) */
let firedTotal = 0;
{
  const hold2 = inkShapeSnapHoldCreate(() => { firedTotal++; });
  hold2.track(50, 50);
  hold2.disarm();
}
setTimeout(() => {
  ok('disarm sonrası tetiklenmez', firedTotal === 0, firedTotal);

  /* ---- özet ---- */
  console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
  process.exit(fail ? 1 : 0);
}, 50);
