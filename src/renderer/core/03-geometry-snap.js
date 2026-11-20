/* TailRef app · coordinates, bounds, snapping */
'use strict';

function screenToWorld(p) {
  return {
    x: (p.x - state.view.x) / state.view.scale,
    y: (p.y - state.view.y) / state.view.scale,
  };
}

function itemCenter(it) {
  return { x: it.x + it.w / 2, y: it.y + (it.h || 0) / 2 };
}

/** Döndürülmüş kutunun dünya koordinatlarındaki köşeleri */
function itemCorners(it) {
  const c = itemCenter(it);
  const hw = it.w / 2, hh = (it.h || 0) / 2;
  const r = (it.rot || 0) * Math.PI / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  return [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([px, py]) => ({
    x: c.x + px * cos - py * sin,
    y: c.y + px * sin + py * cos,
  }));
}

function boundsOf(items, pad = 0) {
  if (!items.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    for (const p of itemCorners(it)) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
}

/* ---------------- yapışma (snap) ----------------
   Sürüklenen fotoğraf(lar) yakındaki fotoğraflara yapışır:
   kenar kenara tam oturur, köşeler birbirine değer, ortalar hizalanır. */
const SNAP_SCREEN_PX = 16;   // ekran pikseli cinsinden yapışma mesafesi

/* Tahta yapışması (aday 9): hizalama kılavuzlarını "Snap on board"
   anahtarı açıp kapatır. Anahtar yoksa → açık (mevcut davranış). */
function boardSnapOn() {
  try { return localStorage.getItem('tailref-board-snap') !== '0'; } catch { return true; }
}
window.tailrefBoardSnapOn = boardSnapOn;

function itemBounds(it) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of itemCorners(it)) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** b: hareket eden seçimin sınır kutusu; dönüş: {d: uygulanacak kaydırma, at: hizalama çizgisi, o: hedef} */
function snapDelta(b, others, axis) {
  const tol = SNAP_SCREEN_PX / state.view.scale;
  const mS = axis === 'x' ? b.x : b.y;
  const mE = mS + (axis === 'x' ? b.w : b.h);
  const mM = (mS + mE) / 2;

  let best = null, bestAt = 0, bestO = null, bestType = 'align';
  const take = (d, at, o, type) => {
    if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) {
      best = d; bestAt = at; bestO = o; bestType = type;
    }
  };

  for (const o of others) {
    const ob = itemBounds(o);
    const oS = axis === 'x' ? ob.x : ob.y;
    const oE = oS + (axis === 'x' ? ob.w : ob.h);
    const oM = (oS + oE) / 2;
    take(oE - mS, oE, o, 'contact');   // sol/üst kenar, diğerinin sağ/alt kenarına değer
    take(oS - mE, oS, o, 'contact');   // sağ/alt kenar, diğerinin sol/üst kenarına değer
    take(oS - mS, oS, o, 'align');     // aynı hizada (sol/sol)
    take(oE - mE, oE, o, 'align');     // aynı hizada (sağ/sağ)
    take(oM - mM, oM, o, 'align');     // ortalar aynı hizada
  }
  return { d: best || 0, at: bestAt, o: bestO, type: best === null ? null : bestType };
}

/* --- yapışma geri bildirimi: ince kılavuz çizgi + birleşme yerinde ışın --- */
const snapGuidesEl = $('#snapGuides');
const sgV = snapGuidesEl.querySelector('.sg.v');
const sgH = snapGuidesEl.querySelector('.sg.h');
let snapBeamKey = '';

function hideSnapFeedback() {
  sgV.hidden = true;
  sgH.hidden = true;
  snapBeamKey = '';
}

/** Sadece gerçekten birbirine değen kenarlar için dikiş (ışın) üretir */
function contactBeams(box, other, eps = 0.75) {
  const ob = itemBounds(other);
  const out = [];
  const oy1 = Math.max(box.y, ob.y), oy2 = Math.min(box.y + box.h, ob.y + ob.h);
  const ox1 = Math.max(box.x, ob.x), ox2 = Math.min(box.x + box.w, ob.x + ob.w);

  // dikey dikiş (yan yana duran fotoğraflar)
  let vx = null;
  if (Math.abs(box.x + box.w - ob.x) <= eps) vx = ob.x;
  else if (Math.abs(ob.x + ob.w - box.x) <= eps) vx = box.x;
  if (vx !== null && oy2 >= oy1 - eps) out.push({ dir: 'v', at: vx, a: oy1, b: oy2, o: other });

  // yatay dikiş (üst üste duran fotoğraflar)
  let hy = null;
  if (Math.abs(box.y + box.h - ob.y) <= eps) hy = ob.y;
  else if (Math.abs(ob.y + ob.h - box.y) <= eps) hy = box.y;
  if (hy !== null && ox2 >= ox1 - eps) out.push({ dir: 'h', at: hy, a: ox1, b: ox2, o: other });

  return out;
}

function addSnapBeam(beam) {
  const sc = state.view.scale, vx = state.view.x, vy = state.view.y;
  const el = document.createElement('i');
  el.className = 'snapBeam ' + beam.dir;
  const len = Math.max(0, (beam.b - beam.a) * sc);
  if (beam.dir === 'v') {
    const x = beam.at * sc + vx;
    const y = beam.a * sc + vy;
    el.style.left = (x - 1) + 'px';
    el.style.top = y + 'px';
    el.style.height = Math.max(3, len) + 'px';
  } else {
    const x = beam.a * sc + vx;
    const y = beam.at * sc + vy;
    el.style.left = x + 'px';
    el.style.top = (y - 1) + 'px';
    el.style.width = Math.max(3, len) + 'px';
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 560);
}

function showSnapFeedback(b, sx, sy, others) {
  const hasX = !!(sx && sx.d), hasY = !!(sy && sy.d);
  const sc = state.view.scale, vx = state.view.x, vy = state.view.y;
  const pad = 16;   // çizginin uçlarda sönmesi için pay (ekran pikseli)

  if (hasX) {
    sgV.hidden = false;
    sgV.style.left = (sx.at * sc + vx) + 'px';
    // çizgi sonsuza kadar gitmesin: sadece hizalanan fotoğrafların boyu kadar
    let y1 = b.y + (sy ? sy.d : 0);
    let y2 = y1 + b.h;
    if (sx.o) {
      const ob = itemBounds(sx.o);
      y1 = Math.min(y1, ob.y);
      y2 = Math.max(y2, ob.y + ob.h);
    }
    sgV.style.top = (y1 * sc + vy - pad) + 'px';
    sgV.style.height = Math.max(10, (y2 - y1) * sc + pad * 2) + 'px';
  } else sgV.hidden = true;

  if (hasY) {
    sgH.hidden = false;
    sgH.style.top = (sy.at * sc + vy) + 'px';
    let x1 = b.x + (sx ? sx.d : 0);
    let x2 = x1 + b.w;
    if (sy.o) {
      const ob = itemBounds(sy.o);
      x1 = Math.min(x1, ob.x);
      x2 = Math.max(x2, ob.x + ob.w);
    }
    sgH.style.left = (x1 * sc + vx - pad) + 'px';
    sgH.style.width = Math.max(10, (x2 - x1) * sc + pad * 2) + 'px';
  } else sgH.hidden = true;

  // yapıştıktan sonraki gerçek kutu; sadece gerçekten temas eden kenarlar ışık verir
  const box = {
    x: b.x + (sx ? sx.d : 0),
    y: b.y + (sy ? sy.d : 0),
    w: b.w, h: b.h,
  };
  const seen = new Set();
  const beams = [];
  for (const o of (others || [])) {
    for (const bm of contactBeams(box, o)) {
      const k = bm.dir + ':' + Math.round(bm.at) + ':' + Math.round(bm.a) + ':' + Math.round(bm.b);
      if (seen.has(k)) continue;
      seen.add(k);
      beams.push(bm);
    }
  }
  if (!beams.length) { snapBeamKey = ''; return; }

  const key = beams.map(bm => bm.o.id + ':' + bm.dir + ':' + Math.round(bm.at)).join('|');
  if (key === snapBeamKey) return;   // aynı dikiş sürüyor: tekrar çakmasın
  snapBeamKey = key;
  for (const bm of beams) addSnapBeam(bm);
}
