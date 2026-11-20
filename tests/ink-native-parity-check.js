/* =========================================================
   ink-native-parity-check.js - C++ çekirdek parite sondası
   =========================================================
   electron --no-sandbox ile ana süreçte koşar (N-API modülü
   Electron ABI'sine derlenir; düz node açamaz).
   Uç üretim çekirdeklerini JS referansı ile karşılaştırır:
     - gürültü uç: toFixed(3) kuantlamalı alfa - pay 1/255
     - sulu boya uç: Math.round alfa - sin/atan2 ULP payı 1/255
   Mükellef örtmez oldurma: küçük farklar raporlanır; kapı ise
   "kanal farkı ≤ 1, üstü pay yüzde 0,1'i aşmaz" koşulu yeşil/kırmızı.
   Çıktı örnek: PARITE: noiseTip 512x256 seed=3 maxDiff=1
   ========================================================= */

'use strict';
const path = require('path');
const fs = require('fs');

/* iki bölge: düğüm koşucu burada kendini electron.exe'e devreder;
   electron bölgesi (aşağıdaki app.whenReady) asıl parite işini yapar. */
if (!(process.versions && process.versions.electron)) {
  const exe = path.join(__dirname, '..', 'node_modules', 'electron',
    'dist', 'electron.exe');
  if (!fs.existsSync(exe)) {
    console.error('PARITE: electron.exe yok - ' + exe);
    process.exit(3);
  }
  const { spawn } = require('child_process');
  const child = spawn(exe, [path.join(__filename)], {
    stdio: 'inherit',
  });
  child.on('exit', code => process.exit(code || 0));
  child.on('error', err => {
    console.error('PARITE: elektron başlatılamadı - ' + err);
    process.exit(5);
  });
} else {
  const { app } = require('electron');

  /* --- JS referansı: 52-native-brush-library.js formüllerinin
       kanvasız birebir matematik sürümü (sadece ImageData semantiği) --- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function inkNativeNoise(x, y, seed) {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^
      Math.imul(seed | 0, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function smoothSlide(v) {
    const t = clamp(v, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function noiseTipExpected(px, density, edge, seed, step) {
    const out = new Uint8ClampedArray(px * px * 4);
    const r = px * 0.5 * edge;
    const cx = px / 2, cy = px / 2;
    for (let y = 0; y < px; y += step) {
      for (let x = 0; x < px; x += step) {
        const dx = x + step / 2 - cx;
        const dy = y + step / 2 - cy;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const n = inkNativeNoise(x, y, 31 + seed);
        if (n > density) continue;
        const feather = clamp((r - d) / Math.max(1, px * 0.09), 0, 1);
        const alpha = (0.25 + 0.75 * inkNativeNoise(y, x, 73 + seed)) * feather;
        if (alpha <= 0.01) continue;
        /* JS fillRect 'rgba(...,alpha.toFixed(3))' - 3 ondalık kuantam.
           Kanvas kompoziti ImageData'ya 0..255'e taşıdığında aynı sayı
           (çarpılmamış beyaz + alfa) zorunlu olarak şu değeri alır:
           Math.ceil'de ±0.5 tolerans - sonda pay 1 tarif eder. */
        const aFixed = Math.round(alpha * 1000) / 1000;
        const a = Math.round(clamp(aFixed, 0, 1) * 255);
        for (let by = 0; by < step && y + by < px; by++) {
          for (let bx = 0; bx < step && x + bx < px; bx++) {
            const i = ((y + by) * px + (x + bx)) * 4;
            out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = a;
          }
        }
      }
    }
    return out;
  }

  function watercolorTipExpected(px, core, ring, edge, seed) {
    const out = new Uint8ClampedArray(px * px * 4);
    const phaseA = seed * 0.71, phaseB = seed * 1.31 + 0.9, phaseC = seed * 2.17;
    const radius = Math.max(1, px / 2 - 1);
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const dx = (x + 0.5 - px / 2) / radius;
        const dy = (y + 0.5 - px / 2) / radius;
        const angle = Math.atan2(dy, dx);
        const roughness =
          0.025 * Math.sin(angle * 4 + 0.7 + phaseA) +
          0.016 * Math.sin(angle * 9 - 1.3 + phaseB) +
          0.01 * (inkNativeNoise((x / 5) | 0, (y / 5) | 0, 53 + (seed % 97)) - 0.5);
        const boundary = 0.95 + roughness;
        const distance = Math.hypot(dx, dy) / boundary;
        let alpha = 0;
        if (distance < 1) {
          const wash = core * (0.62 + 0.7 * smoothSlide(distance / 0.9));
          const pigmentRim = edge *
            smoothSlide((distance - ring) / Math.max(0.02, 0.92 - ring)) *
            (1 - smoothSlide((distance - 0.92) / 0.08));
          const grain = 0.86 + 0.14 * inkNativeNoise(
            (x >> 2) + phaseC, (y >> 2) + phaseC, 97);
          alpha = Math.max(wash, pigmentRim) * grain;
        }
        const i = (y * px + x) * 4;
        out[i] = 255; out[i + 1] = 255; out[i + 2] = 255;
        out[i + 3] = Math.round(clamp(alpha, 0, 1) * 255);
      }
    }
    return out;
  }

  /* --- karşılaştırıcı: kanal başına en büyük fark + aşan sayısı --- */
  function compare(a, b, tolerance) {
    let maxDiff = 0;
    let over = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > maxDiff) maxDiff = d;
      if (d > tolerance) over++;
    }
    return { maxDiff, over, total: n };
  }

  /* =========================================================
     EVRE 2 paritesi: damla emisyonu (inkForEachDab K16 referansı)
     JS tarafı 28-ink-brush.js'teki algoritmanın birebir portudur.
     Kayıt: [x, y, k, p, s, t, a, br, tilted] (yokluk = undefined).
     ========================================================= */
  const SIG_LO = 1 / (1 + Math.exp(3));
  const SIG_SPAN = 1 / (1 + Math.exp(-3)) - SIG_LO;
  function inkSigmoid01(t) {
    return (1 / (1 + Math.exp(-6 * (t - 0.5))) - SIG_LO) / SIG_SPAN;
  }
  function inkLerpAngle(a, b, t) {
    let d = (b || 0) - (a || 0);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return (a || 0) + d * t;
  }
  const INK_HASH_CACHE = new Map();
  function inkStrokeIdHash(id) {
    let hash = INK_HASH_CACHE.get(id);
    if (hash !== undefined) return hash;
    hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
      hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
    }
    INK_HASH_CACHE.set(id, hash);
    return hash;
  }
  function inkStrokeRandomRef(strokeId, dabIndex, channel = 0) {
    let hash = inkStrokeIdHash(String(strokeId || ''));
    hash ^= Math.imul((dabIndex | 0) + 1, 0x9e3779b1);
    hash ^= Math.imul((channel | 0) + 1, 0x85ebca6b);
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }
  function catmullRef(p0, p1, p2, p3, t, sx, sy) {
    const gx = typeof sx === 'number' && isFinite(sx) && sx > 0 ? sx : 1;
    const gy = typeof sy === 'number' && isFinite(sy) && sy > 0 ? sy : 1;
    const d01 = Math.max(1e-6, Math.hypot((p1.x - p0.x) * gx, (p1.y - p0.y) * gy));
    const d12 = Math.max(1e-6, Math.hypot((p2.x - p1.x) * gx, (p2.y - p1.y) * gy));
    const d23 = Math.max(1e-6, Math.hypot((p3.x - p2.x) * gx, (p3.y - p2.y) * gy));
    const w1 = d12 / ((d01 + d12) * 3);
    const w2 = d12 / ((d12 + d23) * 3);
    const tx = (1 - t) * (1 - t) * (1 - t);
    const ty = 3 * (1 - t) * (1 - t) * t;
    const tz = 3 * (1 - t) * t * t;
    const tw = t * t * t;
    return {
      x: p1.x * tx + (p1.x + (p2.x - p0.x) * w1) * ty +
         (p2.x - (p3.x - p1.x) * w2) * tz + p2.x * tw,
      y: p1.y * tx + (p1.y + (p2.y - p0.y) * w1) * ty +
         (p2.y - (p3.y - p1.y) * w2) * tz + p2.y * tw,
    };
  }
  /* flat Float64Array (stride 7) -> kayıt listesi (K16 port) */
  function dabListExpected(flat, spacingPx, scale, options = {}) {
    const n = flat.length / 7;
    const at = i => ({
      x: flat[i * 7], y: flat[i * 7 + 1], p: flat[i * 7 + 2],
      s: flat[i * 7 + 3], t: flat[i * 7 + 4], a: flat[i * 7 + 5],
      br: flat[i * 7 + 6],
    });
    const raw = i => {
      const base = i * 7;
      return [flat[base], flat[base + 1], flat[base + 2], flat[base + 3],
        flat[base + 4], flat[base + 5], flat[base + 6]];
    };
    const out = [];
    const spacing = Math.max(0.6, spacingPx || 1);
    let sx = 1, sy = 1;
    if (typeof scale === 'number' && isFinite(scale) && scale > 0) {
      sx = sy = scale;
    } else if (scale && typeof scale === 'object') {
      const kx = Number(scale.x), ky = Number(scale.y);
      if (isFinite(kx) && kx > 0) sx = kx;
      if (isFinite(ky) && ky > 0) sy = ky;
    }
    const stableOnly = !!options.stableOnly;
    const segmentLimit = stableOnly ? Math.max(0, n - 2) : n - 1;
    const spacingJitter = clamp(Number(options.spacingJitter) || 0, 0, 1);
    const taperStartPx = Math.max(0, Number(options.taperStartPx) || 0);
    const taperEndPx = stableOnly ? 0 : Math.max(0, Number(options.taperEndPx) || 0);
    const progressOffsetPx = Math.max(0, Number(options.progressOffsetPx) || 0);
    let spacingRemainder = spacing;
    const cumulative = new Float64Array(n);
    let totalLengthPx = 0;
    for (let i = 1; i < n; i++) {
      if (!flat[i * 7 + 6]) {
        totalLengthPx += Math.hypot((flat[i * 7] - flat[(i - 1) * 7]) * sx,
          (flat[i * 7 + 1] - flat[(i - 1) * 7 + 1]) * sy);
      }
      cumulative[i] = totalLengthPx;
    }
    if (isFinite(options.totalLengthPx)) {
      totalLengthPx = Math.max(totalLengthPx, options.totalLengthPx);
    }
    let tapLike = true;
    for (let i = 1; i < n; i++) {
      if (!flat[i * 7 + 6] && cumulative[i] - cumulative[i - 1] >= 1) {
        tapLike = false;
        break;
      }
    }
    const tStartPx = tapLike ? 0 : taperStartPx;
    const tEndPx = tapLike ? 0 : taperEndPx;
    const taper = progressPx => {
      let factor = 1;
      if (tStartPx > 0) {
        const t = clamp((progressOffsetPx + progressPx) / tStartPx, 0, 1);
        factor = Math.min(factor, t * t * (3 - 2 * t));
      }
      if (tEndPx > 0) {
        const t = clamp((totalLengthPx - progressOffsetPx - progressPx) / tEndPx, 0, 1);
        factor = Math.min(factor, t * t * (3 - 2 * t));
      }
      return factor;
    };
    let lastX = 0, lastY = 0;
    const push = (x, y, k, p, s, t, a, br, tilted) => {
      lastX = x; lastY = y;
      out.push([x, y, k, p, s, t, a, br, tilted]);
    };
    const pushRaw = (i, k) => {
      const r = raw(i);
      push(r[0], r[1], k, r[2], r[3], r[4], r[5], r[6], 0);
    };
    if (!flat[6]) pushRaw(0, taper(0));
    let index = 1;
    if (n === 1) return out;
    for (let i = 0; i < segmentLimit; i++) {
      if (flat[(i + 1) * 7 + 6]) {
        pushRaw(i + 1, taper(cumulative[i + 1]));
        spacingRemainder = spacing;
        continue;
      }
      const p1i = i, p2i = i + 1;
      const p0i = flat[p1i * 7 + 6] ? p1i : Math.max(0, i - 1);
      const p3i = (i + 2 < n && !flat[(i + 2) * 7 + 6]) ? i + 2 : p2i;
      const p0 = at(p0i), p1 = at(p1i), p2 = at(p2i), p3 = at(p3i);
      const dist = Math.hypot((p2.x - p1.x) * sx, (p2.y - p1.y) * sy);
      if (dist <= 0) continue;
      const pa = isFinite(p1.p) ? p1.p : 1;
      const pb = isFinite(p2.p) ? p2.p : 1;
      const sa = isFinite(p1.s) ? p1.s : 0;
      const sb = isFinite(p2.s) ? p2.s : 0;
      const ta = p1.t || 0;
      const tb = p2.t || 0;
      const tilted = ta > 0 || tb > 0;
      let traveled = spacingRemainder;
      while (traveled <= dist) {
        let t = traveled / dist;
        if (spacingJitter > 0) {
          t = clamp(t + (inkStrokeRandomRef(options.strokeId, index, 6) - 0.5) *
            spacingJitter * spacing / dist, 0.001, 0.999);
        }
        const q = catmullRef(p0, p1, p2, p3, t, sx, sy);
        const qk = taper(cumulative[i] + dist * t);
        const qp = pa + (pb - pa) * inkSigmoid01(t);
        const qs = sa + (sb - sa) * t;
        push(q.x, q.y, qk, qp, qs,
          tilted ? ta + (tb - ta) * t : NaN,
          tilted ? inkLerpAngle(p1.a || 0, p2.a || 0, t) : NaN,
          0, tilted ? 1 : 0);
        index++;
        traveled += spacing;
      }
      spacingRemainder = traveled - dist;
    }
    const lRaw = raw(n - 1), cH = Math.hypot((lRaw[0] - lastX) * sx,
      (lRaw[1] - lastY) * sy);
    if (!stableOnly && !lRaw[6] && (!out.length || cH > 0.001)) {
      pushRaw(n - 1, taper(totalLengthPx));
    }
    return out;
  }

  /* damla sınama senaryoları: her biri { ad, flat, spacing, scale, opsiyonlar } */
  function mkStroke(list) {
    const flat = new Float64Array(list.length * 7);
    list.forEach((p, i) => {
      flat[i * 7] = p.x; flat[i * 7 + 1] = p.y;
      flat[i * 7 + 2] = 'p' in p ? p.p : NaN;
      flat[i * 7 + 3] = 's' in p ? p.s : NaN;
      flat[i * 7 + 4] = 't' in p ? p.t : NaN;
      flat[i * 7 + 5] = 'a' in p ? p.a : NaN;
      flat[i * 7 + 6] = p.br ? 1 : 0;
    });
    return flat;
  }
  function densStroke(n, seed) {
    const pts = [];
    let x = 3, y = 9;
    for (let i = 0; i < n; i++) {
      x += 2.3 + Math.sin(i * 0.37 + seed);
      y += 1.7 + Math.cos(i * 0.23 + seed);
      pts.push({ x, y, p: 0.4 + 0.6 * Math.abs(Math.sin(i * 0.11)), s: 0.2 });
    }
    return pts;
  }
  const DAB_CASES = [
    { ad: 'yoğun200', pts: densStroke(200, 1), spacing: 3, jitter: 0 },
    { ad: 'seyrek', pts: [
        { x: 0, y: 0, p: 1 }, { x: 40, y: 3, p: 0.8 },
        { x: 160, y: 90, p: 0.5 }, { x: 400, y: 10, p: 0.9 }], spacing: 12 },
    { ad: 'kopuk', pts: [
        { x: 5, y: 5 }, { x: 25, y: 9 }, { x: 45, y: 20 },
        { x: 100, y: 40, br: true }, { x: 140, y: 80 },
        { x: 220, y: 130 }], spacing: 6, jitter: 0.5, strokeId: 'rzeyrek' },
    { ad: 'tek-nokta', pts: [{ x: 33, y: 44, p: 0.9 }], spacing: 4 },
    { ad: 'tap', pts: [
        { x: 60, y: 60.5, p: 1 }, { x: 60, y: 61, p: 1 },
        { x: 60, y: 61.4, p: 1 }], spacing: 5, taperStartPx: 60, taperEndPx: 60 },
    { ad: 'egim', pts: [
        { x: 10, y: 10, p: 1, t: 0.9, a: 0.4 },
        { x: 50, y: 22, p: 0.8, t: 0.2, a: -1.2 },
        { x: 120, y: 70, p: 0.6, t: 0.6, a: 2.9 }], spacing: 7, jitter: 0.3,
      strokeId: 'regim' },
    { ad: 'stabilOnly', pts: densStroke(40, 2).concat([
        { x: 12, y: 12, p: 1 }]), spacing: 5, stableOnly: true },
    { ad: 'olcek', pts: densStroke(30, 3).map(p => ({
        x: p.x / 2, y: p.y / 2, p: p.p, s: p.s })), spacing: 4,
      scale: { x: 2, y: 2 } },
    { ad: 'taper', pts: densStroke(50, 4), spacing: 4,
      taperStartPx: 80, taperEndPx: 120, strokeId: 'rtaper' },
  ];

  function compareDabs(jsRecs, nativeRecs, label) {
    if (jsRecs.length !== nativeRecs.length) {
      console.error('PARITE KIRMIZI: ' + label + ' damla sayısı js=' +
        jsRecs.length + ' cpp=' + nativeRecs.length);
      return false;
    }
    let maxDiff = 0;
    /* yokluk semantiği: undefined/null/NaN üçü de "yok" sayılır. */
    const empty = v => v === undefined || v === null || Number.isNaN(v);
    for (let i = 0; i < jsRecs.length; i++) {
      const j = jsRecs[i], c = nativeRecs[i];
      for (let ch = 0; ch < 9; ch++) {
        const jEmpty = empty(j[ch]), cEmpty = empty(c[ch]);
        if (jEmpty !== cEmpty) {
          console.error('PARITE KIRMIZI: ' + label + ' damla ' + i +
            ' kanal ' + ch + ' tanımlılık farkı js=' + j[ch] +
            ' cpp=' + c[ch]);
          return false;
        }
        if (jEmpty) continue;
        const d = Math.abs(j[ch] - c[ch]);
        if (d > maxDiff) maxDiff = d;
      }
    }
    if (maxDiff > 1e-9) {
      console.error('PARITE KIRMIZI: ' + label + ' maxDiff=' + maxDiff);
      return false;
    }
    return true;
  }

  function main() {
    const node = path.join(__dirname, '..', 'native', 'inkcore',
      'build', 'Release', 'inkcore.node');
    if (!fs.existsSync(node)) {
      console.error('PARITE: inkcore.node yok - derleme eksik (' + node + ')');
      app.exit(3);
      return;
    }
    let core;
    try {
      core = require(node);
    } catch (error) {
      console.error('PARITE: yukleme hatası - ' + error);
      app.exit(3);
      return;
    }

    let failures = 0;
    let jsTime = 0;
    let cppTime = 0;

    /* --- noise32 cross-check: bit-parite mutlaka --- */
    for (const [x, y, seed] of [[0, 0, 0], [7, 31, 5], [-3, 12, -8], [255, 255, 99]]) {
      let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^
        Math.imul(seed | 0, 2246822519);
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      n = (n ^ (n >>> 16)) >>> 0;
      const native = core.noise32(x, y, seed);
      if (native !== n) {
        console.error('PARITE KIRMIZI: noise32 mismatch', x, y, seed, native, n);
        failures++;
      }
    }

    /* --- noiseTip --- */
    for (const size of [64, 128, 256, 512]) {
      for (const seed of [0, 3, -7, 7919]) {
        for (const density of [0.55, 0.7]) {
          const step = size > 320 ? 2 : 1;
          const js = noiseTipExpected(size, density, 0.94, seed, step);
          const reply = core.noiseTip(size, density, 0.94, seed, step);
          const cpp = new Uint8ClampedArray(reply.data);
          const cmp = compare(js, cpp, 1);
          const bad = cmp.maxDiff > 1 || cmp.over > cmp.total * 0.001;
          if (bad) failures++;
          console.log(
            (bad ? 'PARITE KIRMIZI: ' : 'PARITE: ') +
            'noiseTip ' + size + 'x' + seed + '/' + density +
            ' maxDiff=' + cmp.maxDiff + ' over=' + cmp.over);
        }
      }
    }

    /* --- watercolorTip --- */
    for (const size of [64, 128, 256, 512]) {
      for (const seed of [0, 2, -5, 7919]) {
        for (const ring of [0.76, 0.6]) {
          const js = watercolorTipExpected(size, 0.22, ring, 0.42, seed);
          const reply = core.watercolorTip(size, 0.22, ring, 0.42, seed);
          const cpp = new Uint8ClampedArray(reply.data);
          const cmp = compare(js, cpp, 1);
          const bad = cmp.maxDiff > 1;
          if (bad) failures++;
          console.log((bad ? 'PARITE KIRMIZI: ' : 'PARITE: ') +
            'watercolorTip ' + size + 'x' + seed + '/' + ring +
            ' maxDiff=' + cmp.maxDiff + ' over=' + cmp.over);
        }
      }
    }

    /* --- EVRE 2: dabList paritesi (damla emisyonu, K16) --- */
    for (const cs of DAB_CASES) {
      const flat = mkStroke(cs.pts);
      const opsiyonlar = {
        stableOnly: !!cs.stableOnly,
        spacingJitter: cs.jitter || 0,
        taperStartPx: cs.taperStartPx || 0,
        taperEndPx: cs.taperEndPx || 0,
        progressOffsetPx: cs.progressOffsetPx || 0,
        totalLengthPx: cs.totalLengthPx,
        strokeId: cs.strokeId || 'rparite',
      };
      const sx = (cs.scale && typeof cs.scale === 'object') ? cs.scale.x
        : (typeof cs.scale === 'number' ? cs.scale : 1);
      const sy = (cs.scale && typeof cs.scale === 'object') ? cs.scale.y
        : (typeof cs.scale === 'number' ? cs.scale : 1);
      const js = dabListExpected(flat, cs.spacing, cs.scale, opsiyonlar);
      const reply = core.dabList(flat, cs.spacing, sx, sy,
        opsiyonlar.stableOnly ? 1 : 0, opsiyonlar.spacingJitter,
        opsiyonlar.taperStartPx, opsiyonlar.taperEndPx,
        opsiyonlar.progressOffsetPx, opsiyonlar.totalLengthPx || NaN,
        opsiyonlar.strokeId);
      const native = [];
      const buf = new Float64Array(reply.data, 0, reply.count * 9);
      for (let i = 0; i < reply.count; i++) {
        native.push(Array.from(buf.subarray(i * 9, i * 9 + 9)));
      }
      const good = compareDabs(js, native, cs.ad);
      if (!good) failures++;
      console.log((good ? 'PARITE: ' : 'PARITE KIRMIZI: ') +
        'dabList ' + cs.ad + ' damla=' + js.length);
    }

    /* --- EVRE 4: tileSlice paritesi (undo karo dilimleri) --- */
    {
      /* deterministik rng — test tekrarlanabilir olmalı */
      let seed4 = 20261109;
      const rnd4 = () => {
        seed4 = (seed4 ^ (seed4 << 13)) >>> 0;
        seed4 = (seed4 ^ (seed4 >>> 17)) >>> 0;
        seed4 = (seed4 ^ (seed4 << 5)) >>> 0;
        return seed4 / 4294967296;
      };
      /* JS referansı: 34-ink-undo.js satır band kopyasının aynısı */
      const jsSliceRegion = (src, srcW, slices) => {
        const bufs = [];
        for (const [rx, ry, w, h] of slices) {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let row = 0; row < h; row++) {
            const from = ((ry + row) * srcW + rx) * 4;
            data.set(src.subarray(from, from + w * 4), row * w * 4);
          }
          bufs.push(data);
        }
        return bufs;
      };
      const TILE4 = 256;
      for (let caseNo = 0; caseNo < 4; caseNo++) {
        /* gerçek akış taklidi: vuruş bölgesi karo sınırlarıyla ortak kesilir */
        const rx0 = Math.floor(rnd4() * 480);
        const ry0 = Math.floor(rnd4() * 480);
        const rw = 64 + Math.floor(rnd4() * 600);
        const rh = 16 + Math.floor(rnd4() * 260);
        /* bölge anlık görüntüsü: bölge köşesinden RGB'de üçgen desen */
        const src = new Uint8ClampedArray(rw * rh * 4);
        for (let i = 0; i < src.length; i++) {
          src[i] = (i * 37 + caseNo * 91) & 255;
        }
        /* karo dilimleri: kılavuz grid'le kesişen sade kutu listesi,
           kenar (1px) ve tam kaplama olmayan gevşek durumlar da dahil */
        const sl = [];
        const gx0 = Math.floor(rx0 / TILE4) * TILE4;
        const gy0 = Math.floor(ry0 / TILE4) * TILE4;
        for (let gy = gy0; gy <= ry0 + rh; gy += TILE4) {
          for (let gx = gx0; gx <= rx0 + rw; gx += TILE4) {
            const x0 = Math.max(rx0, gx);
            const y0 = Math.max(ry0, gy);
            const x1 = Math.min(rx0 + rw, gx + TILE4);
            const y1 = Math.min(ry0 + rh, gy + TILE4);
            if (x1 > x0 && y1 > y0) {
              sl.push([x0 - rx0, y0 - ry0, x1 - x0, y1 - y0]);
            }
          }
        }
        sl.push([0, 0, 1, 1]);            /* tek piksel köşe */
        sl.push([rw - 1, rh - 1, 1, 1]);  /* karşı köşe */
        const flat = new Int32Array(sl.flat());
        const reply = core.tileSlice(src, rw, rh, flat);
        const jsBuffers = jsSliceRegion(src, rw, sl);
        /* alınan bitişik tamponu dilim görünümüne böl ve karşılaştır */
        const nativeViews = [];
        let off = 0;
        for (const [rx, ry, w, h] of sl) {
          const len = w * h * 4;
          nativeViews.push(new Uint8ClampedArray(reply.data.buffer, off, len));
          off += len;
        }
        let diffs = 0, first = -1;
        for (let k = 0; k < jsBuffers.length; k++) {
          const a = jsBuffers[k], b = nativeViews[k];
          if (a.length !== b.length) { diffs++; first = k; break; }
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) { diffs++; first = k + ':' + i; break; }
          }
          if (diffs) break;
        }
        const good = diffs === 0 && off === reply.count;
        if (!good) { failures++; console.error('EVRE4 hatası: ' + first); }
        console.log((good ? 'PARITE: ' : 'PARITE KIRMIZI: ') +
          'tileSlice senaryo ' + caseNo + ' dilim=' + sl.length +
          ' bölge=' + rw + 'x' + rh + ' byte=' + reply.count);
      }
      /* hız: gerçek boyutta bölge (2560 tuval alternatifi: 1536×128) */
      const bw = 1536, bh = 128;
      const bench = new Uint8ClampedArray(bw * bh * 4);
      for (let i = 0; i < bench.length; i++) bench[i] = (i * 13) & 255;
      const bsl = [];
      for (let gx = 0; gx < bw; gx += TILE4) {
        bsl.push([gx, 0, Math.min(TILE4, bw - gx), bh]);
      }
      const bflat = new Int32Array(bsl.flat());
      const runSlice = (fn) => {
        const t0 = performance.now();
        for (let i = 0; i < 50; i++) fn();
        return (performance.now() - t0) / 50;
      };
      const jsSl = runSlice(() => jsSliceRegion(bench, bw, bsl));
      const cppSl = runSlice(() => core.tileSlice(bench, bw, bh, bflat));
      console.log('HIZ: karo dilim 1536x128 js=' + jsSl.toFixed(3) +
        'ms cpp=' + cppSl.toFixed(3) + 'ms kat=' +
        (jsSl / Math.max(0.001, cppSl)).toFixed(1));
    }

    if (failures) {
      console.error('PARITE SONUÇ: ' + failures + ' kırmızı - YENİDEN BAK');
      app.exit(1);
      return;
    }
    console.log('PARITE SONUÇ: tüm kapsam yeşil');

    /* --- hız ölçümü bilgilendirme: C++ vs JS (512 px) --- */
    {
      const run = (fn) => {
        const t0 = performance.now();
        for (let i = 0; i < 5; i++) fn();
        return (performance.now() - t0) / 5;
      };
      const jsNoise = run(() => noiseTipExpected(512, 0.55, 0.94, 7, 2));
      const cppNoise = run(() => core.noiseTip(512, 0.55, 0.94, 7, 2));
      console.log('HIZ: gürültü uç 512px js=' + jsNoise.toFixed(2) +
        'ms cpp=' + cppNoise.toFixed(2) + 'ms kat=' +
        (jsNoise / Math.max(0.01, cppNoise)).toFixed(1));
      const jsWc = run(() => watercolorTipExpected(512, 0.22, 0.76, 0.42, 7));
      const cppWc = run(() => core.watercolorTip(512, 0.22, 0.76, 0.42, 7));
      console.log('HIZ: suluboya uç 512px js=' + jsWc.toFixed(2) +
        'ms cpp=' + cppWc.toFixed(2) + 'ms kat=' +
        (jsWc / Math.max(0.01, cppWc)).toFixed(1));
      /* EVRE 2: damla emisyonu (200 nokta × 3 aralık) */
      const dabFlat = mkStroke(densStroke(200, 1));
      const dabOps = { strokeId: 'rhiz', spacingJitter: 0.3 };
      const runDab = (fn) => {
        const t0 = performance.now();
        for (let i = 0; i < 300; i++) fn();
        return (performance.now() - t0) / 300;
      };
      const jsDab = runDab(() => {
        let n = 0;
        dabListExpected(dabFlat, 3, 1, dabOps);
        return n;
      });
      const cppDab = runDab(() =>
        core.dabList(dabFlat, 3, 1, 1, 0, 0.3, 0, 0, 0, NaN, 'rhiz'));
      console.log('HIZ: damla emisyon 200p js=' + jsDab.toFixed(3) +
        'ms cpp=' + cppDab.toFixed(3) + 'ms kat=' +
        (jsDab / Math.max(0.001, cppDab)).toFixed(1));
    }

    app.exit(0);
  }

  app.whenReady().then(main).catch(err => {
    console.error('PARITE: elektron başlatılamadı - ' + err);
    app.exit(5);
  });
}
