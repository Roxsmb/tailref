'use strict';

/* Canvas Editor şekil oturtma (hold-to-shape) + mükemmelleştirme birim
   testi — saf Node, tarayıcı gerekmez. Derlenmiş
   src/renderer/canvas-editor.js yüklenir; `document` saplamasıyla
   bootstrap etkinleşmez (readyState 'loading' → yalnızca
   DOMContentLoaded dinleyicisi kurulur), böylece saf geometri modülü
   (PSCE.shapeSnap*) test edilebilir.

   Tur 4k sözleşmesi (kullanıcı onayı: "bekletilen her şey düzelsin"):
   • line + arc + circle + OVAL (rx/ry korunur, oval:1) dönüşür
   • köşeli kapalı iz (kare/dikdörtgen/üçgen/çokgen) → kapalı ÇOKGEN
     (poly, closed=true; köşeler birebir)
   • köşeli açık iz (L/V) → AÇIK çokgen (closed=false; yaya dönmez)
   • çok-turlu spiral/öz-kesişmeli döngü → null (asla circle)
   • shapeSnapPerfect(res, pressure): poly/oval dalları dahil
   • mükemmelleştirme (shapeSnapFairPath fair v2): uçlar bit-birebir,
     keskin köşeler SİVRİ kalır (Z asla S olmaz), serbest spanler
     yapısal sınıflarına oturtulur (açık VE kapalı), kopuk (br) iz
     köprülenip onarılır, girdi mutasyona uğramaz
   • ayar: varsayılan açık, kapatma kalıcı
   • bekleme zamanlayıcısı: titreşime dayanır (≤8 px), disarm
   ========================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'canvas-editor.js');
if (!fs.existsSync(SRC)) {
  console.error('HATA canvas-editor.js yok — önce: npm run build:canvas');
  process.exit(1);
}

const listeners = [];
const sandbox = {
  console,
  Math,
  Number,
  document: {
    readyState: 'loading',
    addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') listeners.push(fn); },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);
if (listeners.length !== 0) {
  // Bootstrap ertelendi: istenmedi. Etkinleştirmeyiz; modül saf kullanılır.
  listeners.length = 0;
}

const PSCE = sandbox.PSCE;
if (!PSCE || typeof PSCE.shapeSnapRecognize !== 'function') {
  console.error('HATA PSCE.shapeSnapRecognize bulunamadı — derleme eksik mi?');
  process.exit(1);
}

const {
  shapeSnapRecognize, shapeSnapPerfect, shapeSnapFairPath,
  shapeSnapEnabled, shapeSnapSetEnabled,
  ShapeSnapHold, SHAPE_SNAP_HOLD_MS, SHAPE_SNAP_HOLD_MOVE_PX,
} = PSCE;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const info = detail === undefined ? '' : ' → ' + JSON.stringify(detail);
  if (cond) { pass++; console.log('OK   ' + name + info); }
  else { fail++; console.log('HATA ' + name + info); }
}

/* ---- sentetik vuruş üreticileri (doc-px uzayı, 1400×900 tuval) ---- */
// LCG: deterministik "el titremesi" — her vuruş kendi tohumuyla
// üretilir; test sırası üretimi etkilemez.
function makeJitter(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 2; // ±1 px
  };
}
const jitter = makeJitter(424242);

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

function arcPts(cx, cy, r, a0, a1, steps = 64) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const ang = a0 + (a1 - a0) * (i / steps);
    out.push({ x: cx + Math.cos(ang) * r + jitter(), y: cy + Math.sin(ang) * r + jitter() });
  }
  return out;
}

/** Elips yayı: rx/ry bağımsız (basık oval testleri). */
function ellPts(cx, cy, rx, ry, a0, a1, steps = 64) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const ang = a0 + (a1 - a0) * (i / steps);
    out.push({ x: cx + Math.cos(ang) * rx + jitter(), y: cy + Math.sin(ang) * ry + jitter() });
  }
  return out;
}

function closedStroke(pts) {
  // el çizimi "kapalı" vuruş: son nokta başlangıca döner (1 px kaymayla —
  // birebir ikiz dikiş başlangıç köşesinin küme enerjisini boğar;
  // JS süitindeki squarePx/rectPx üreticisiyle aynı kural)
  return pts.concat([{ x: pts[0].x + 1, y: pts[0].y + 1 }]);
}

function polyline(legs, step) {
  let pts = [];
  for (let i = 0; i < legs.length - 1; i++) {
    const s = seg(legs[i], legs[i + 1], step);
    if (i > 0) s.shift();
    pts = pts.concat(s);
  }
  return pts;
}

function roughness(px) {
  let s = 0;
  for (let i = 1; i + 1 < px.length; i++) {
    const dx = px[i + 1].x - 2 * px[i].x + px[i - 1].x;
    const dy = px[i + 1].y - 2 * px[i].y + px[i - 1].y;
    s += Math.hypot(dx, dy);
  }
  return s / Math.max(1, px.length - 2);
}

/** Adil pürüzlülük tabanı: ham izi çıkışla AYNI nokta sayısına (aynı
    örnek aralığına) doğrusal yeniden örnekle — ikinci-fark h²'ye bağlı
    olduğu için aralık farkı kıyası bozar; bu taban yalnız akıtmanın
    katkısını ölçer. */
function resampleN(pts, n) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] +
      Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  const out = [];
  let k = 0;
  for (let j = 0; j < n; j++) {
    const t = total * j / Math.max(1, n - 1);
    while (k < cum.length - 2 && cum[k + 1] < t) k++;
    const segL = cum[k + 1] - cum[k];
    const f = segL > 1e-12 ? (t - cum[k]) / segL : 0;
    out.push({
      x: pts[k].x + (pts[k + 1].x - pts[k].x) * f,
      y: pts[k].y + (pts[k + 1].y - pts[k].y) * f,
    });
  }
  return out;
}

/** Dalgalı bacak: uçlarda 0, ortada `bow` px kavis + hafif titreme —
    kullanıcının "titrek zikzak" izi. */
function bowedLeg(a, b, bow, step, jig) {
  const out = [];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.round(d / step));
  const px = -(b.y - a.y) / d, py = (b.x - a.x) / d; // dik birim
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const o = bow * Math.sin(t * Math.PI);
    out.push({
      x: a.x + (b.x - a.x) * t + px * o + jig(),
      y: a.y + (b.y - a.y) * t + py * o + jig(),
    });
  }
  return out;
}

/* ---- 1 · Tur 4k: köşeli kapalı şekiller kusursuz ÇOKGENE dönüşür ---- */

/** Köşe kapsama: her hedef köşeye en yakın aday nokta tol içinde mi? */
function cornersCovered(pts, targets, tol = 20) {
  return targets.every(t =>
    pts.some(p => Math.hypot(p.x - t[0], p.y - t[1]) <= tol));
}

// Kare
{
  const pts = seg({ x: 500, y: 300 }, { x: 700, y: 300 })
    .concat(seg({ x: 700, y: 300 }, { x: 700, y: 500 }))
    .concat(seg({ x: 700, y: 500 }, { x: 500, y: 500 }))
    .concat(seg({ x: 500, y: 500 }, { x: 500, y: 300 }));
  const res = shapeSnapRecognize(closedStroke(pts));
  ok('kare → poly (kapalı)', !!res && res.type === 'poly' && res.closed === true,
    res && res.type);
  if (res && res.type === 'poly') {
    ok('kare köşe sayısı 4', res.pts.length === 4, res.pts.length);
    ok('kare köşeleri hedeflerde', cornersCovered(res.pts,
      [[500, 300], [700, 300], [700, 500], [500, 500]]),
      res.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }
}

// Dikdörtgen
{
  const pts = seg({ x: 400, y: 200 }, { x: 900, y: 200 })
    .concat(seg({ x: 900, y: 200 }, { x: 900, y: 500 }))
    .concat(seg({ x: 900, y: 500 }, { x: 400, y: 500 }))
    .concat(seg({ x: 400, y: 500 }, { x: 400, y: 200 }));
  const res = shapeSnapRecognize(closedStroke(pts));
  ok('dikdörtgen → poly (kapalı)',
    !!res && res.type === 'poly' && res.closed === true, res && res.type);
  if (res && res.type === 'poly') {
    ok('dikdörtgen köşe sayısı 4', res.pts.length === 4, res.pts.length);
    ok('dikdörtgen köşeleri hedeflerde', cornersCovered(res.pts,
      [[400, 200], [900, 200], [900, 500], [400, 500]]),
      res.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }
}

// Üçgen
{
  const pts = seg({ x: 300, y: 600 }, { x: 600, y: 600 })
    .concat(seg({ x: 600, y: 600 }, { x: 450, y: 400 }))
    .concat(seg({ x: 450, y: 400 }, { x: 300, y: 600 }));
  const res = shapeSnapRecognize(closedStroke(pts));
  ok('üçgen → poly (kapalı)',
    !!res && res.type === 'poly' && res.closed === true, res && res.type);
  if (res && res.type === 'poly') {
    ok('üçgen köşe sayısı 3', res.pts.length === 3, res.pts.length);
    ok('üçgen köşeleri hedeflerde', cornersCovered(res.pts,
      [[300, 600], [600, 600], [450, 400]]),
      res.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }
}

// Çokgen (beşgen)
{
  const cx = 700, cy = 450, r = 130;
  const verts = [];
  for (let i = 0; i < 5; i++) {
    const ang = -Math.PI / 2 + Math.PI * 2 * (i / 5);
    verts.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
  }
  let pts = [];
  for (let i = 0; i < 5; i++) pts = pts.concat(seg(verts[i], verts[(i + 1) % 5]));
  const res = shapeSnapRecognize(closedStroke(pts));
  ok('beşgen → poly (kapalı)',
    !!res && res.type === 'poly' && res.closed === true, res && res.type);
  if (res && res.type === 'poly') {
    ok('beşgen köşe sayısı 5', res.pts.length === 5, res.pts.length);
    ok('beşgen köşeleri hedeflerde', cornersCovered(res.pts, verts.map(v =>
      [Math.round(v.x), Math.round(v.y)]), 24),
      res.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }
}

// Yumuşak kapalı iz: daire → circle (kalıntı + drift kapılarıyla)
{
  const raw = closedStroke(arcPts(700, 450, 120, 0, Math.PI * 2));
  const res = shapeSnapRecognize(raw);
  ok('daire → circle', !!res && res.type === 'circle', res && res.type);
  if (res && res.type === 'circle') {
    ok('daire merkez', Math.hypot(res.cx - 700, res.cy - 450) < 8, { cx: res.cx, cy: res.cy });
    ok('daire yarıçap', Math.abs(res.r - 120) < 6, res.r);
  }
}

// Kalp: köşesiz ama daire DEĞİL (kalıntı kapısı: res ~0.226-0.230 > 0.215)
{
  const heart = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    heart.push({
      x: 700 + 16 * Math.pow(Math.sin(t), 3) * 37,
      y: 450 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) - Math.cos(4 * t)) * 37,
    });
  }
  const res = shapeSnapRecognize(closedStroke(heart));
  ok('kalp → null (daire SANILMAZ)', res === null, res && res.type);
}

/* ---- 2 · açık şekller: line + arc yine dönüşür ---- */

// Düz çizgi
{
  const res = shapeSnapRecognize(seg({ x: 200, y: 200 }, { x: 800, y: 260 }));
  ok('çizgi → line', !!res && res.type === 'line', res && res.type);
}

// Yay
{
  const res = shapeSnapRecognize(arcPts(600, 500, 140, Math.PI * 1.15, Math.PI * 1.95));
  ok('yay → arc', !!res && res.type === 'arc', res && res.type);
}

// Yarım yuvarlak → yarım YAY, asla tam daire (Tur 4j)
{
  const res = shapeSnapRecognize(arcPts(700, 450, 140, Math.PI, Math.PI * 2, 60));
  ok('yarım yuvarlak → arc', !!res && res.type === 'arc', res && res.type);
  if (res && res.type === 'arc') {
    ok('yarım yuvarlak taraması ~π', Math.abs(Math.abs(res.sweep) - Math.PI) < 0.35,
      Math.abs(res.sweep));
  }
}

// L: köşeli açık vuruş → AÇIK çokgen (yaya dönmez)
{
  const pts = seg({ x: 300, y: 300 }, { x: 300, y: 600 })
    .concat(seg({ x: 300, y: 600 }, { x: 600, y: 600 }));
  const res = shapeSnapRecognize(pts);
  ok('L → poly (açık)', !!res && res.type === 'poly' && res.closed === false,
    res && res.type);
  if (res && res.type === 'poly') {
    ok('L köşeleri hedeflerde', cornersCovered(res.pts,
      [[300, 300], [300, 600], [600, 600]]),
      res.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }
}

// V: aynı garanti
{
  const pts = seg({ x: 300, y: 300 }, { x: 450, y: 600 })
    .concat(seg({ x: 450, y: 600 }, { x: 600, y: 300 }));
  const res = shapeSnapRecognize(pts);
  ok('V → poly (açık)', !!res && res.type === 'poly' && res.closed === false,
    res && res.type);
  if (res && res.type === 'poly') {
    ok('V köşeleri hedeflerde', cornersCovered(res.pts,
      [[300, 300], [450, 600], [600, 300]]),
      res.pts.map(p => [Math.round(p.x), Math.round(p.y)]));
  }
}

/* ---- 3 · dokunmama garantileri ---- */

ok('kısa vuruş dokunulmaz', shapeSnapRecognize(seg({ x: 10, y: 10 }, { x: 26, y: 14 })) === null);

{
  // dağınık karalama: kapalı olmayan rastgele gezinti (bağımsız tohum)
  const j2 = makeJitter(99);
  const pts = [];
  let x = 100, y = 100;
  for (let i = 0; i < 40; i++) {
    x += 18 + j2() * 6;
    y += (i % 2 ? 14 : -9) + j2() * 6;
    pts.push({ x, y });
  }
  const res = shapeSnapRecognize(pts);
  ok('karalama dokunulmaz', res === null, res && res.type);
}

/* ---- 4 · mükemmel şekil üretimi (shapeSnapPerfect: 2 bağımsız değişken) ---- */

{
  const res = shapeSnapRecognize(closedStroke(arcPts(700, 450, 120, 0, Math.PI * 2)));
  const perfect = res ? shapeSnapPerfect(res, 0.7) : null;
  ok('daire → 65 nokta (kapanış dahil)', !!perfect && perfect.length === 65,
    perfect && perfect.length);
  ok('basınç korunur', !!perfect && perfect.every(p => p.pressure === 0.7));
  if (perfect) {
    ok('daire kapanış noktası (son == ilk)', Math.hypot(
      perfect[0].x - perfect[64].x, perfect[0].y - perfect[64].y) < 1e-9);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of perfect) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    ok('daire sınırlı ±4 px', Math.abs(maxX - minX - 240) < 4 && Math.abs(maxY - minY - 240) < 4,
      { w: maxX - minX, h: maxY - minY });
    ok('daire doc-px uzayında', Math.abs((minX + maxX) / 2 - 700) < 6 &&
      Math.abs((minY + maxY) / 2 - 450) < 6,
      { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
  }
}

{
  // çizgi: tam 2 nokta, uçlar ham uçlarla aynı
  const res = shapeSnapRecognize(seg({ x: 200, y: 200 }, { x: 800, y: 260 }));
  const perfect = res ? shapeSnapPerfect(res, 1) : null;
  ok('çizgi → 2 nokta', !!perfect && perfect.length === 2, perfect && perfect.length);
  ok('çizgi uçları', !!perfect &&
    Math.abs(perfect[0].x - 200) < 2 && Math.abs(perfect[0].y - 200) < 2 &&
    Math.abs(perfect[1].x - 800) < 2 && Math.abs(perfect[1].y - 260) < 2);
}

{
  // yay: 41 nokta (40 adım), tarama ~π
  const res = shapeSnapRecognize(arcPts(700, 450, 140, Math.PI, Math.PI * 2, 60));
  const perfect = res ? shapeSnapPerfect(res, 0.5) : null;
  ok('yarım yay → 41 nokta', !!perfect && perfect.length === 41, perfect && perfect.length);
}

{
  // Tur 4k · kapalı çokgen: köşe noktaları birebir + kapanış noktası
  const pts = seg({ x: 500, y: 300 }, { x: 700, y: 300 })
    .concat(seg({ x: 700, y: 300 }, { x: 700, y: 500 }))
    .concat(seg({ x: 700, y: 500 }, { x: 500, y: 500 }))
    .concat(seg({ x: 500, y: 500 }, { x: 500, y: 300 }));
  const res = shapeSnapRecognize(closedStroke(pts));
  const perfect = res ? shapeSnapPerfect(res, 0.8) : null;
  ok('kare perfect: 5 nokta (4 köşe + kapanış)',
    !!perfect && perfect.length === 5, perfect && perfect.length);
  ok('kare perfect basınç', !!perfect && perfect.every(p => p.pressure === 0.8));
  if (perfect) {
    ok('kare perfect kapanış (son == ilk)', Math.hypot(
      perfect[0].x - perfect[4].x, perfect[0].y - perfect[4].y) < 1e-9);
    ok('kare perfect köşeleri hedeflerde', cornersCovered(perfect.slice(0, 4),
      [[500, 300], [700, 300], [700, 500], [500, 500]], 3),
      perfect.map(p => [Math.round(p.x), Math.round(p.y)]));
  }
}

{
  // Tur 4k · açık çokgen: kapanış noktası YOK
  const pts = seg({ x: 300, y: 300 }, { x: 300, y: 600 })
    .concat(seg({ x: 300, y: 600 }, { x: 600, y: 600 }));
  const res = shapeSnapRecognize(pts);
  const perfect = res ? shapeSnapPerfect(res, 0.6) : null;
  ok('L perfect: 3 köşe, kapanış YOK',
    !!perfect && perfect.length === 3 &&
    Math.hypot(perfect[0].x - perfect[2].x, perfect[0].y - perfect[2].y) > 1e-6,
    perfect && perfect.length);
}

{
  // Tur 4k · basık oval: elips damgası (en-boy korunur)
  const res = shapeSnapRecognize(ellPts(700, 450, 265, 165, -Math.PI / 2,
    -Math.PI / 2 + Math.PI * 2, 80));
  const perfect = res ? shapeSnapPerfect(res, 0.7) : null;
  ok('oval perfect: 65 nokta', !!perfect && perfect.length === 65,
    perfect && perfect.length);
  if (perfect) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of perfect) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    ok('oval perfect en-boy korunur (~530×330)',
      Math.abs(maxX - minX - 530) < 16 && Math.abs(maxY - minY - 330) < 16,
      { w: Math.round(maxX - minX), h: Math.round(maxY - minY) });
  }
}

/* ---- 4b · halka çeşitliliği: NASIL çizildiği önemli değil ----
   Geçmeli tur, boşluklu kapanış, kanca girişli başlangıç, çift tur,
   basık oval, kuyruklu "6" → daire. İçe/dışa spiral (çok-turlu) →
   Tur 4j: ASLA daire değil (kalıntı + drift kapıları). */
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

  {
    const res = shapeSnapRecognize(ell(700, 450, 220, 214, -Math.PI / 2,
      -Math.PI / 2 + TAU * 1.15, 90, mkJig(11)));
    ok('halka · geçmeli tur (1.15×) → circle', res && res.type === 'circle', res && res.type);
  }
  {
    const res = shapeSnapRecognize(ell(700, 450, 224, 208, -Math.PI / 2,
      -Math.PI / 2 + TAU * (325 / 360), 84, mkJig(12)));
    ok('halka · 325° boşluklu → circle', res && res.type === 'circle', res && res.type);
    const res2 = shapeSnapRecognize(ell(700, 450, 220, 218, -Math.PI / 2,
      -Math.PI / 2 + TAU * (340 / 360), 84, mkJig(13)));
    ok('halka · 340° boşluklu → circle', res2 && res2.type === 'circle', res2 && res2.type);
  }
  {
    const jig = mkJig(14);
    const pts = [
      ...ell(700 + 0.22 * 220, 450 + 0.89 * 220, 110, 110,
        Math.PI * 0.75, Math.PI * 1.45, 10, jig),
      ...ell(700, 450, 220, 220, Math.PI * 0.9, Math.PI * 0.9 + TAU, 80, jig),
    ];
    const res = shapeSnapRecognize(pts);
    ok('halka · kanca girişli → circle', res && res.type === 'circle', res && res.type);
  }
  {
    const res = shapeSnapRecognize(ell(700, 450, 220, 214, -Math.PI / 2,
      -Math.PI / 2 + TAU * 1.75, 130, mkJig(15)));
    ok('halka · çift tur (1.75×) → circle', res && res.type === 'circle', res && res.type);
  }
  {
    const res = shapeSnapRecognize(ell(700, 450, 265, 165, -Math.PI / 2,
      -Math.PI / 2 + TAU, 80, mkJig(16)));
    /* Tur 4k · basık oval OVAL KALIR: circle türünde oval:1 + rx/ry
       (en-boy korunur) — daireye zorlanmaz. */
    ok('halka · basık oval → circle (oval:1)',
      !!res && res.type === 'circle' && res.oval === 1, res && res.type);
    if (res && res.type === 'circle') {
      const ratio = Math.max(res.rx, res.ry) / Math.min(res.rx, res.ry);
      ok('halka · oval en-boy korunur (rx/ry ~265/165)',
        Math.abs(res.rx - 265) < 14 && Math.abs(res.ry - 165) < 14 &&
        ratio > 1.35,
        { rx: res.rx && Math.round(res.rx), ry: res.ry && Math.round(res.ry) });
      ok('halka · oval merkezi doğru',
        Math.hypot(res.cx - 700, res.cy - 450) < 26, { cx: res.cx, cy: res.cy });
    }
  }
  {
    const jig = mkJig(17);
    const pts = [
      ...seg({ x: 712, y: 180 }, { x: 706, y: 352 }, 3),
      ...ell(710, 545, 180, 180, -Math.PI / 2, -Math.PI / 2 + TAU, 76, jig),
    ];
    const res = shapeSnapRecognize(pts);
    ok('halka · kuyruklu 6 → circle', res && res.type === 'circle', res && res.type);
  }

  // İçe spiral (2.5 tur, daralan): ASLA circle → null + mükemmelleşir
  {
    const jig = mkJig(18);
    const pts = [];
    const steps = 580; // yoğun örnekleme (~5 px adım) — jitter ikinci-farka yazsın
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = -Math.PI / 2 + TAU * 2.5 * t;
      const r = 240 - 108 * t;
      pts.push({ x: 700 + Math.cos(ang) * r + jig(),
                 y: 450 + Math.sin(ang) * r + jig() });
    }
    const res = shapeSnapRecognize(pts);
    ok('spiral (2.5 tur) → null (circle DEĞİL)', res === null, res && res.type);

    const out = shapeSnapFairPath(pts, 1, 1);
    ok('spiral fair çıktı var (kusursuzlaşır)', !!out);
    if (out) {
      ok('spiral uçlar bit-birebir', out[0] === pts[0] &&
        out[out.length - 1] === pts[pts.length - 1]);
      let turnSum = 0;
      let prev = Math.atan2(out[1].y - out[0].y, out[1].x - out[0].x);
      for (let i = 2; i < out.length; i++) {
        const h = Math.atan2(out[i].y - out[i - 1].y, out[i].x - out[i - 1].x);
        let d = h - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        turnSum += d; prev = h;
      }
      const turnsKept = Math.abs(turnSum) / TAU;
      ok('spiral dönüş sayısı korunur (~2.5)', Math.abs(turnsKept - 2.5) < 0.45,
        +turnsKept.toFixed(2));
      ok('spiral pürüzlülük düşer (eş-aralıklı taban)',
        roughness(out) < roughness(resampleN(pts, out.length)) * 0.7,
        { once: +roughness(resampleN(pts, out.length)).toFixed(3),
          sonra: +roughness(out).toFixed(3) });
    }
  }

  // Dışa spiral (2.5 tur, büyüyen — kullanıcı fotoğrafı): ASLA circle
  {
    const jig = mkJig(19);
    const pts = [];
    const steps = 220;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = 2.5 * TAU * t;
      const r = 70 + 165 * t;
      pts.push({ x: 700 + r * Math.cos(ang) + jig() * 0.8,
                 y: 450 + r * Math.sin(ang) + jig() * 0.8 });
    }
    const res = shapeSnapRecognize(pts);
    ok('dışa spiral → null (circle DEĞİL)', res === null, res && res.type);
  }
}

/* ---- 5 · MÜKEMMELLEŞTİRME (shapeSnapFairPath, doc-px: sx=sy=1) ---- */

{
  /* Zikzak (titrek bacaklar): uçlar bit-birebir, köşeler sivri kalır,
     pürüzlülük düşer, bacaklar (açık iz) kendi akorduna düzlenir.
     Taze ±2 px titreme dizisi: gerçek kalem sarsıntısı (ince ±1 px'te
     tek Taubin geçişi ~%40'ı alır; kalem sarsıntısı baskınken ~%60). */
  const legs = [
    { x: 140, y: 120 }, { x: 1260, y: 120 }, { x: 140, y: 410 },
    { x: 1260, y: 410 }, { x: 140, y: 700 }, { x: 1260, y: 700 },
  ];
  let zseed = 20260101;
  const jigZ = () => {
    zseed = (zseed * 1103515245 + 12345) & 0x7fffffff;
    return (zseed / 0x7fffffff - 0.5) * 4; // ±2 px
  };
  let raw = [];
  for (let i = 0; i < legs.length - 1; i++) {
    const s = bowedLeg(legs[i], legs[i + 1], 5, 5, jigZ);
    if (i > 0) s.shift();
    raw = raw.concat(s);
  }
  /* Tur 4k: köşeli açık iz kusursuz AÇIK ÇOKGENE oturur (V/Z/W) —
     zirve korumalı span sınıfı sayılmazsa RefineCorners yutulan
     köşeleri geri getirir. */
  const wRes = shapeSnapRecognize(raw);
  ok('zikzak → açık çokgen (poly, closed=false, 6 nokta)',
    !!wRes && wRes.type === 'poly' && wRes.closed === false &&
    Array.isArray(wRes.pts) && wRes.pts.length === 6,
    wRes ? (wRes.type + ' closed=' + wRes.closed + ' n=' +
      (wRes.pts && wRes.pts.length) + ' ' + (wRes.pts || []).map(p =>
      [Math.round(p.x), Math.round(p.y)]).join(' ')) : 'null');
  const out = shapeSnapFairPath(raw, 1, 1);
  ok('zikzak fair çıktı var', !!out);
  if (out) {
    ok('zikzak uç[0] bit-birebir orijinal nesne', out[0] === raw[0]);
    ok('zikzak uç[n] bit-birebir orijinal nesne',
      out[out.length - 1] === raw[raw.length - 1]);
    // köşe sivriliği: her köşe civarında max pencere dönüşü korunmalı
    const cornerTurns = (px) => legs.slice(1, -1).map(c => {
      let best = 0;
      const W = 8;
      for (let i = W; i + W < px.length; i++) {
        if (Math.hypot(px[i].x - c.x, px[i].y - c.y) > 40) continue;
        const v1x = px[i].x - px[i - W].x, v1y = px[i].y - px[i - W].y;
        const v2x = px[i + W].x - px[i].x, v2y = px[i + W].y - px[i].y;
        const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
        if (m1 < 1e-9 || m2 < 1e-9) continue;
        const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
        best = Math.max(best, Math.acos(dot));
      }
      return best;
    });
    const tB = cornerTurns(raw), tA = cornerTurns(out);
    ok('zikzak köşe dönüşleri korunur (≥ %92)',
      tA.every((t, i) => t >= tB[i] * 0.92 - 0.02),
      { once: tB.map(t => +t.toFixed(2)), sonra: tA.map(t => +t.toFixed(2)) });
    // bacak dalgalanması: KENDİ yerel akordundan sapma (akord-tilt gürültüsü
    // devre dışı — sözleşme "bacak kendi akorduna dizilir"). Band d>20:
    // komşu diyagonal bacağın köşe-yakını örnekleri bantla karışmasın.
    const selfChordDev = (px, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      const band = [];
      for (const p of px) {
        const d = Math.abs((p.y - a.y) * dx - (p.x - a.x) * dy) / L;
        if (d > 20) continue;
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (L * L);
        if (t < 0.12 || t > 0.88) continue;
        band.push(p);
      }
      if (band.length < 3) return 0;
      const c0 = band[0], c1 = band[band.length - 1];
      const ddx = c1.x - c0.x, ddy = c1.y - c0.y, LL = Math.hypot(ddx, ddy);
      let m = 0;
      for (const p of band) {
        const t = LL > 1e-9 ? ((p.x - c0.x) * ddx + (p.y - c0.y) * ddy) / (LL * LL) : 0;
        if (t < 0.05 || t > 0.95) continue;
        m = Math.max(m, Math.abs((p.y - c0.y) * ddx - (p.x - c0.x) * ddy) / LL);
      }
      return m;
    };
    const dB = Math.max(selfChordDev(raw, legs[0], legs[1]),
      selfChordDev(raw, legs[2], legs[3]));
    const dA = Math.max(selfChordDev(out, legs[0], legs[1]),
      selfChordDev(out, legs[2], legs[3]));
    ok('zikzak bacak düzlüğü iyileşir (kavis 5 px → akord)', dA < dB * 0.65,
      { once: +dB.toFixed(2), sonra: +dA.toFixed(2) });
    // gövde pürüzlülüğü: köşe çevreleri hariç (rijit köşeler ölçümü domine
    // etmesin) — akıtmanın jitter temizliği burada net görünür
    const corners4 = legs.slice(1, -1);
    const roughAway = (px) => {
      let s = 0, cnt = 0;
      for (let i = 1; i + 1 < px.length; i++) {
        let near = false;
        for (const c of corners4) {
          if (Math.hypot(px[i].x - c.x, px[i].y - c.y) < 30) { near = true; break; }
        }
        if (near) continue;
        s += Math.hypot(px[i + 1].x - 2 * px[i].x + px[i - 1].x,
          px[i + 1].y - 2 * px[i].y + px[i - 1].y);
        cnt++;
      }
      return cnt ? s / cnt : 0;
    };
    ok('zikzak gövde pürüzlülüğü düşer (köşeler hariç, eş-aralıklı taban)',
      /* tek bekletme = tek Taubin geçişi: ~%40 iyileşme (yer-değiştirme
         tavanı 6 px + rijit köşeler); tekrarlı bekletme daha da
         rafine eder — ayrı tekrarlı-geçiş denetimi aşağıda. */
      roughAway(out) < roughAway(resampleN(raw, out.length)) * 0.7,
      { once: +roughAway(resampleN(raw, out.length)).toFixed(3),
        sonra: +roughAway(out).toFixed(3) });
  }

  /* Z harfi: 2 keskin köşe bölgesi korunur — S olmaz. */
  {
    const zLegs = [
      { x: 190, y: 120 }, { x: 1170, y: 120 }, { x: 190, y: 590 }, { x: 1170, y: 590 },
    ];
    const zRaw = polyline(zLegs, 6);
    ok('Z tanıma: arc/circle DEĞİL (çokgen adayı kurulamazsa null)',
      (() => { const r = shapeSnapRecognize(zRaw);
        return r === null || (r.type === 'poly' && r.closed === false);
      })());
    const zOut = shapeSnapFairPath(zRaw, 1, 1);
    ok('Z fair çıktı var', !!zOut);
    if (zOut) {
      let highZones = 0;
      const W = 8;
      let inZone = false;
      for (let i = W; i + W < zOut.length; i++) {
        const v1x = zOut[i].x - zOut[i - W].x, v1y = zOut[i].y - zOut[i - W].y;
        const v2x = zOut[i + W].x - zOut[i].x, v2y = zOut[i + W].y - zOut[i].y;
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
     (çokgene dönüştürülemediği karalama durumunda fair yolu devrede;
     Tur 4k fair v2: kapalı izde de serbest spanler oturtulur). */
  {
    const sqRaw = closedStroke([
      ...seg({ x: 500, y: 300 }, { x: 700, y: 300 }, 5),
      ...seg({ x: 700, y: 300 }, { x: 700, y: 500 }, 5),
      ...seg({ x: 700, y: 500 }, { x: 500, y: 500 }, 5),
      ...seg({ x: 500, y: 500 }, { x: 500, y: 300 }, 5),
    ].slice(0, -1));
    const sqOut = shapeSnapFairPath(sqRaw, 1, 1);
    ok('el-kare fair çıktı var', !!sqOut);
    if (sqOut) {
      ok('el-kare pürüzlülük düşer (eş-aralıklı taban)',
        roughness(sqOut) < roughness(resampleN(sqRaw, sqOut.length)) * 0.6,
        { once: +roughness(resampleN(sqRaw, sqOut.length)).toFixed(3),
          sonra: +roughness(sqOut).toFixed(3) });
      // köşe yapısı korunur (≥3 bölge — başlangıç köşesi uç: rijit)
      let zones = 0;
      const W = 8;
      let inZone = false;
      for (let i = W; i + W < sqOut.length; i++) {
        const v1x = sqOut[i].x - sqOut[i - W].x, v1y = sqOut[i].y - sqOut[i - W].y;
        const v2x = sqOut[i + W].x - sqOut[i].x, v2y = sqOut[i + W].y - sqOut[i].y;
        const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
        const dot = m1 > 1e-9 && m2 > 1e-9 ? (v1x * v2x + v1y * v2y) / (m1 * m2) : 1;
        if (Math.acos(Math.max(-1, Math.min(1, dot))) >= 0.72) {
          if (!inZone) { zones++; inZone = true; }
        } else inZone = false;
      }
      ok('el-kare: köşe yapısı korunur (≥3 bölge)', zones >= 3, zones);
    }
  }

  /* Karalama: nazik iyileşme, yıkıcı değil. Yoğun örnekleme + orta-frekans
     dalga + ince jitter: akıtma jitter'ı alır, dalga yapısı korunur. */
  {
    const j3 = makeJitter(77);
    const scr = [];
    for (let i = 0; i <= 900; i++) {
      const t = i / 900;
      scr.push({
        x: 140 + 1120 * t + 65 * Math.sin(t * 34) + j3() * 2,
        y: 450 + 280 * Math.sin(t * 19) + 115 * Math.sin(t * 47) + j3() * 2,
      });
    }
    const scrOut = shapeSnapFairPath(scr, 1, 1);
    ok('karalama fair çıktı var', !!scrOut);
    if (scrOut) {
      const rB = roughness(resampleN(scr, scrOut.length)), rA = roughness(scrOut);
      ok('karalama: nazik iyileşme (yıkıcı değil, eş-aralıklı taban)',
        rA < rB && rA > rB * 0.1,
        { once: +rB.toFixed(2), sonra: +rA.toFixed(2) });
      /* Orta-frekans dalga yapısı korunur: çıkışın kendi-düz çizgisinden
         sapma bandı, ham dalganın bandıyla aynı mertebede kalır. */
      const band = (px) => {
        const a = px[0], b = px[px.length - 1];
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
        let m = 0;
        for (const p of px) {
          const d = Math.abs((p.y - a.y) * dx - (p.x - a.x) * dy) / L;
          if (d > m) m = d;
        }
        return m;
      };
      const bB = band(resampleN(scr, scrOut.length)), bA = band(scrOut);
      ok('karalama: dalga bandı korunur (≤ ±%35)', bA >= bB * 0.65 && bA <= bB * 1.35,
        { once: +bB.toFixed(1), sonra: +bA.toFixed(1) });
    }
  }

  /* Tekrarlı bekletme = art arda "iyileştir": pürüzlülük KÖTÜLEMEZ. */
  {
    const vRaw = polyline([{ x: 140, y: 120 }, { x: 1260, y: 120 }, { x: 140, y: 410 }], 6);
    const v1 = shapeSnapFairPath(vRaw, 1, 1);
    ok('fair 1. geçiş çıktı', !!v1);
    if (v1) {
      const r1 = roughness(v1);
      const v2 = shapeSnapFairPath(v1, 1, 1);
      ok('fair 2. geçiş: kötülemez (ya da yakınsadı)', v2 === null ||
        roughness(v2) <= r1 * 1.05, v2 ? 'dizi' : 'null');
      ok('tekrarlı fairde uçlar bit-birebir',
        v1[0] === vRaw[0] && v1[v1.length - 1] === vRaw[vRaw.length - 1] &&
        (v2 === null || (v2[0] === v1[0] && v2[v2.length - 1] === v1[v1.length - 1])));
    }
  }

  /* Alan taşınımı + girdi mutasyona uğramaz (pressure alanı). */
  {
    const tiltRaw = polyline(
      [{ x: 140, y: 120 }, { x: 1260, y: 120 }, { x: 140, y: 410 }], 6)
      .map((p, i) => ({ x: p.x, y: p.y, pressure: 0.5 + 0.1 * (i % 3),
        a: (i * 0.7) % (2 * Math.PI), s: 0 }));
    const clone = JSON.parse(JSON.stringify(tiltRaw));
    const tOut = shapeSnapFairPath(tiltRaw, 1, 1);
    ok('tilt/alan fair çıktı var', !!tOut);
    ok('girdi dizisi değişmez', JSON.stringify(tiltRaw) === JSON.stringify(clone));
    if (tOut) {
      ok('uçlar orijinal nesne',
        tOut[0] === tiltRaw[0] && tOut[tOut.length - 1] === tiltRaw[tiltRaw.length - 1]);
      ok('pressure alanı taşınır', Number.isFinite(tOut[5].pressure), tOut[5].pressure);
      ok('a alanı taşınır', Number.isFinite(tOut[5].a), +tOut[5].a.toFixed(2));
    }
  }

  /* Değmez: kısa/az noktalı iz → null. */
  {
    const short = [];
    for (let i = 0; i <= 6; i++) short.push({ x: 10 + i, y: 10 + i * 0.5 });
    ok('kısa iz fair → null', shapeSnapFairPath(short, 1, 1) === null);
    ok('3 nokta fair → null',
      shapeSnapFairPath([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }], 1, 1) === null);
  }

  /* Tur 4k · kopukluk (br) onarımı: küçük boşluk → TEK BÜTÜN
     köprülenip düzeltilir; büyük boşluk → parçalar AYRI düzeltilir,
     uç nesneleri + br bayrakları birebir korunur. */
  {
    const jigH = makeJitter(55);
    const runA = [];
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      runA.push({ x: 200 + 500 * t + jigH(), y: 200 + 8 * t + jigH() });
    }
    // küçük kopukluk: boşluk ~14 px (healCap = max(24, yol×%6) altı)
    const runB = seg({ x: 714, y: 214 }, { x: 950, y: 420 }, 5);
    runB[0] = { ...runB[0], br: 1 };
    const smallGap = runA.concat(runB);
    const fSmall = shapeSnapFairPath(smallGap, 1, 1);
    ok('br · küçük kopukluk onarılır (tek bütün)', !!fSmall, fSmall && fSmall.length);
    if (fSmall) {
      /* Heal yolu uçları DEĞER olarak bit-birebir döndürür (kopya
         nesne; kimlik büyük-kopma yolundadır korunur). */
      const e0 = smallGap[0];
      const e1 = smallGap[smallGap.length - 1];
      const o0 = fSmall[0];
      const o1 = fSmall[fSmall.length - 1];
      ok('br · onarımda uçlar bit-birebir (değer)', o0.x === e0.x &&
        o0.y === e0.y && o1.x === e1.x && o1.y === e1.y,
        { a: [o0.x, o0.y], b: [e0.x, e0.y] });
      // köprü sürekli: çıktı ardışık adımlar makul (~adım tavanı)
      let maxStep = 0;
      for (let i = 1; i < fSmall.length; i++) {
        maxStep = Math.max(maxStep,
          Math.hypot(fSmall[i].x - fSmall[i - 1].x, fSmall[i].y - fSmall[i - 1].y));
      }
      ok('br · köprü bölgesi süreksizlik içermiyor', maxStep < 30,
        +maxStep.toFixed(1));
    }
    // büyük kopukluk: boşluk ~400 px (healCap üstü)
    const runC = seg({ x: 1100, y: 700 }, { x: 1350, y: 760 }, 5);
    runC[0] = { ...runC[0], br: 1 };
    const bigGap = runA.concat(runC);
    const fBig = shapeSnapFairPath(bigGap, 1, 1);
    ok('br · büyük kopuklukta parçalar ayrı düzeltilir', !!fBig);
    if (fBig) {
      ok('br · parça uçları orijinal nesneler', fBig[0] === bigGap[0] &&
        fBig[fBig.length - 1] === bigGap[bigGap.length - 1]);
      ok('br · br bayrağı korunur', fBig.some(p => p.br) === true);
    }
  }
}

/* ---- 6 · ayar: varsayılan açık + kalıcılık ---- */

{
  const store = new Map();
  sandbox.window.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  ok('varsayılan açık', shapeSnapEnabled() === true);
  shapeSnapSetEnabled(false);
  ok('kapalı kalır', shapeSnapEnabled() === false);
  shapeSnapSetEnabled(true);
  ok('yeniden açılır', shapeSnapEnabled() === true);
  delete sandbox.window.localStorage;
}

/* ---- 7 · bekleme zamanlayıcısı: titreşime dayanır ---- */

{
  let fired = 0;
  const hold = new ShapeSnapHold(() => { fired += 1; });
  const origSet = sandbox.window.setTimeout;
  const origClear = sandbox.window.clearTimeout;
  let timer = null, fireFn = null;
  sandbox.window.setTimeout = (fn, ms) => { fireFn = fn; timer = { ms }; return timer; };
  sandbox.window.clearTimeout = () => { timer = null; fireFn = null; };

  hold.arm(100, 100);
  ok('arm → zamanlayıcı kurulu', !!timer && timer.ms === SHAPE_SNAP_HOLD_MS, timer && timer.ms);
  const armedFn = fireFn;
  // titreşim ≤ 8 px (el titremesi): zamanlayıcı yeniden kurulmaz
  hold.track(104, 104);
  ok('≤8px titreşim bozmaz', fireFn === armedFn);
  fireFn();
  ok('titreşim sonrası tek ateş', fired === 1, fired);
  // hareket > 8 px: yeniden kurulur
  hold.track(120, 120);
  ok('>8px hareket yeniden kurar', !!timer && timer.ms === SHAPE_SNAP_HOLD_MS);
  hold.disarm();
  ok('disarm temizler', timer === null && fireFn === null);

  sandbox.window.setTimeout = origSet;
  sandbox.window.clearTimeout = origClear;
}

ok('sabitler: 550 ms / 8 px (referans etkileşim ~0,5 sn)',
  SHAPE_SNAP_HOLD_MS === 550 && SHAPE_SNAP_HOLD_MOVE_PX === 8,
  { ms: SHAPE_SNAP_HOLD_MS, px: SHAPE_SNAP_HOLD_MOVE_PX });

/* ---- özet ---- */

console.log(`\n${pass} geçti, ${fail} hata`);
process.exit(fail === 0 ? 0 : 1);
