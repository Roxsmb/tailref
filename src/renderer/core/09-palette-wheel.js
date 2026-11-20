/* TailRef app · dominant palette, color wheel, important color
   ------------------------------------------------------------------
   FAZ 3-3: palet hattı OKLCH/OKLab'da çalışır (56-ink-color.js):
     • aday üretim   — pikseller OKLab'ta toplanır; LCH eşikleri algısal
     • boşluk ölçümü — paletteGap OKLCH H/L/C üzerinde
     • ton doldurma  — inkOkLchToBytes ile shade üretimi
     • sıralama      — gri chroması + OKLCH hue sırası
   colorDistance sRGB bayt hipoteni kalır (bayt eşikleri kalibre
   edilmeden davranış kaymasın). Eski HSV üçlülerü (rgbToHsvTriplet /
   hsvToRgbTriplet / hsvToHex / hexToHsv) SİLİNDİ — ölü kod kalmaz.
   ========================================================= */
'use strict';

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const PALETTE_SIZE = 10;
const PALETTE_COLUMNS = 5;
const PALETTE_HUE_BINS = 24;      // 15°'lik bağımsız OKLCH hue aileleri
const PALETTE_LIGHT_BINS = 4;
/* FAZ 3-3: doygunluk/düzey eşiği HSV'den OKLCH'ye taşındı.
   NEUTRAL_CHROMA 0.015: algısal gri eşiği. CHROMA_NORM 0.25 ≈ tam
   doygun referansı (eski s 0..1 ölçeğine normalize için). */
const PALETTE_NEUTRAL_CHROMA = 0.015;
const PALETTE_VIVID_CHROMA = 0.075;
const PALETTE_CHROMA_NORM = 0.25;

// Hue + L + chroma farkını birlikte ölçer. Düşük chromada hue
// önemsizleşir — eski HSV formülünün şekli, algısal uzayda.
function paletteGap(a, b) {
  const cA = Math.min(1, Math.max(0, a.c / PALETTE_CHROMA_NORM));
  const cB = Math.min(1, Math.max(0, b.c / PALETTE_CHROMA_NORM));
  const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
  const hueGap = (dh / 180) * Math.min(cA, cB);
  return Math.hypot(hueGap * 1.45, Math.abs(a.l - b.l), Math.abs(cA - cB) * 0.6);
}

function buildPaletteCandidates(pixels) {
  const bins = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const lch = inkRgbBytesToOkLch(pixels[i], pixels[i + 1], pixels[i + 2]);
    const neutral = lch.c < PALETTE_NEUTRAL_CHROMA || lch.l < 0.07;
    const family = neutral
      ? 'n'
      : String(Math.min(PALETTE_HUE_BINS - 1, Math.floor(lch.h / (360 / PALETTE_HUE_BINS))));
    const lBin = Math.min(PALETTE_LIGHT_BINS - 1, Math.floor(lch.l * PALETTE_LIGHT_BINS));
    const key = family + '|' + lBin;
    const bin = bins.get(key) || { family, sum: [0, 0, 0], count: 0 };
    bin.sum[0] += lch.L; bin.sum[1] += lch.a; bin.sum[2] += lch.b; bin.count++;
    bins.set(key, bin);
  }
  return [...bins.values()].map(bin => {
    const L = bin.sum[0] / bin.count, A = bin.sum[1] / bin.count, B = bin.sum[2] / bin.count;
    const lch = inkOkLabToOkLch(L, A, B);
    const rgbB = inkOkLabToBytes(L, A, B);
    const rgb = [rgbB.r, rgbB.g, rgbB.b];
    // Alan büyüklüğü logaritmayla sönümlenir: aynı tondaki dev bir alan
    // paletin birkaç slotunu birden ele geçiremez. Canlılık payı
    // algısal chroma'dan gelir (0.25 = tam doygun referansı).
    const vivid = Math.min(1, lch.c / PALETTE_CHROMA_NORM);
    const score = Math.log1p(bin.count) * (0.45 + 0.55 * vivid);
    return { rgb, count: bin.count, family: bin.family, h: lch.h, c: lch.c, l: lch.l, score };
  }).sort((a, b) => b.score - a.score);
}

function pickPaletteColors(candidates) {
  if (!candidates.length) return fillPaletteToTen([[128, 128, 128]]);
  const total = candidates.reduce((sum, c) => sum + c.count, 0);
  // Çok küçük kenar/yumuşatma lekelerini ele; canlı küçük detaylar korunur.
  const minCount = Math.max(10, Math.round(total * 0.0015));
  const minVividCount = Math.max(6, Math.round(total * 0.0004));
  const usable = candidates.filter(c =>
    c.count >= minCount || (c.c >= PALETTE_VIVID_CHROMA && c.count >= minVividCount));
  const source = usable.length ? usable : candidates;

  const byFamily = new Map();
  for (const c of source) {
    if (!byFamily.has(c.family)) byFamily.set(c.family, []);
    byFamily.get(c.family).push(c);
  }
  const families = [...byFamily.entries()].map(([family, list]) => {
    list.sort((a, b) => b.score - a.score);
    return { family, list, top: list[0] };
  }).sort((a, b) => b.top.score - a.top.score);

  const chromaticFamilies = families.filter(f => f.family !== 'n').length;
  const neutralCap = chromaticFamilies ? 2 : PALETTE_SIZE;
  const selected = [];
  let neutralUsed = 0;
  const accept = (c, minGap) => {
    if (selected.length >= PALETTE_SIZE) return false;
    if (c.family === 'n' && neutralUsed >= neutralCap) return false;
    for (const chosen of selected) {
      if (paletteGap(c, chosen) < minGap) return false;
      if (colorDistance(c.rgb, chosen.rgb) < 24) return false;
    }
    selected.push(c);
    if (c.family === 'n') neutralUsed++;
    return true;
  };

  // 1. geçiş: her hue ailesinden yalnızca bir anahtar renk alınır.
  // Böylece tek bir rengin tonları paleti doldurmaz, farklı hue'lar kaçmaz.
  for (const fam of families) {
    for (const c of fam.list) {
      if (accept(c, 0.16)) break;
    }
    if (selected.length >= PALETTE_SIZE) break;
  }
  // 2. geçiş: görselde 10'dan az hue ailesi varsa boşlukları, seçilenlerden
  // en bağımsız (hue + value farkı en büyük) renklerle doldur.
  while (selected.length < PALETTE_SIZE) {
    let best = null, bestPriority = -1;
    for (const c of source) {
      if (selected.includes(c)) continue;
      if (c.family === 'n' && neutralUsed >= neutralCap) continue;
      let gap = Infinity;
      for (const chosen of selected) {
        gap = Math.min(gap, paletteGap(c, chosen));
      }
      if (gap < 0.14) continue;
      if (selected.some(chosen => colorDistance(c.rgb, chosen.rgb) < 24)) continue;
      const priority = c.score * gap;
      if (priority > bestPriority) { bestPriority = priority; best = c; }
    }
    if (!best) break;
    selected.push(best);
    if (best.family === 'n') neutralUsed++;
  }

  return sortPaletteColors(fillPaletteToTen(selected.map(c => c.rgb)));
}

function fillPaletteToTen(rgbList) {
  const colors = rgbList.map(rgb => rgb.slice());
  const bases = colors.map(rgb => {
    const lch = inkRgbBytesToOkLch(rgb[0], rgb[1], rgb[2]);
    return { h: lch.h, c: lch.c };
  });
  // Ton çeşitliliği azsa boşlukları tek bir rengin tonlarıyla değil,
  // seçilen renklerin tamamına sırayla dağıtarak doldur.
  // FAZ 3-3: shade düzlemi OKLCH — v (0.2..0.99) → L, s katmanı → chroma
  // katmanı (0.04·s ≈ 0.01 c, 0.02·s ≈ 0.005 c tabanları korunarak).
  for (const l of [0.2, 0.34, 0.48, 0.62, 0.76, 0.9, 0.99]) {
    for (const base of bases) {
      if (colors.length >= PALETTE_SIZE) break;
      for (const [c, threshold] of [[Math.max(0.01, base.c * 0.9), 14], [Math.max(0.005, base.c * 0.35), 18]]) {
        if (colors.length >= PALETTE_SIZE) break;
        const shade = inkOkLchToBytes(l, c, base.h);
        const rgb = [shade.r, shade.g, shade.b];
        if (colors.every(col => colorDistance(col, rgb) >= threshold)) colors.push(rgb);
      }
    }
    if (colors.length >= PALETTE_SIZE) break;
  }
  const grays = [16, 44, 72, 100, 128, 156, 184, 212, 240];
  for (const g of grays) {
    if (colors.length >= PALETTE_SIZE) break;
    const rgb = [g, g, g];
    if (colors.every(col => colorDistance(col, rgb) >= 10)) colors.push(rgb);
  }
  while (colors.length < PALETTE_SIZE) colors.push([128, 128, 128]);
  return colors.slice(0, PALETTE_SIZE);
}

function sortPaletteColors(rgbList) {
  return rgbList.map(rgb => {
    const lch = inkRgbBytesToOkLch(rgb[0], rgb[1], rgb[2]);
    return { rgb, h: lch.h, c: lch.c, l: lch.l };
  }).sort((a, b) => {
    const aNeutral = a.c < PALETTE_NEUTRAL_CHROMA, bNeutral = b.c < PALETTE_NEUTRAL_CHROMA;
    if (aNeutral !== bNeutral) return aNeutral ? 1 : -1;
    if (aNeutral) return a.l - b.l;
    return (a.h - b.h) || (a.l - b.l);
  });
}

function paletteHex(rgb) {
  return '#' + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function renderPaletteCard(colors) {
  const cols = PALETTE_COLUMNS, rows = Math.ceil(PALETTE_SIZE / cols);
  const padX = 32, padTop = 60, boxW = 130, boxH = 116, gapX = 14, labelH = 24, rowGap = 18;
  const rowStep = boxH + labelH + rowGap;
  const canvas = document.createElement('canvas');
  canvas.width = padX * 2 + cols * boxW + (cols - 1) * gapX;
  canvas.height = padTop + rows * rowStep - rowGap + 18;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f3ef'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#202124'; ctx.font = '700 23px "Segoe UI", Arial, sans-serif';
  ctx.fillText('TailRef COLOR PALETTE', padX, 40);
  ctx.fillStyle = 'rgba(32,33,36,.55)'; ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('10 KEY COLORS · HUE + VALUE', canvas.width - padX, 39);
  ctx.textAlign = 'left';

  colors.forEach((c, i) => {
    const x = padX + (i % cols) * (boxW + gapX);
    const y = padTop + Math.floor(i / cols) * rowStep;
    const hex = paletteHex(c.rgb);
    ctx.fillStyle = hex;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath(); ctx.roundRect(x, y, boxW, boxH, 7); ctx.fill();
    } else {
      ctx.fillRect(x, y, boxW, boxH);
    }
    ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#2b2c2f'; ctx.font = '600 15px "Segoe UI", Arial, sans-serif';
    ctx.fillText(hex, x + 2, y + boxH + 19);
  });
  return canvas;
}

async function createDominantPalette() {
  const it = selectedImageItems().find(item => !item.paletteGenerated);
  if (!it) return;
  const cached = imgCache.get(it.imageId);
  if (!cached || !cached.img) return;

  const src = cached.img;
  const sample = document.createElement('canvas');
  const sw = 200, sh = Math.max(1, Math.round((src.naturalHeight / src.naturalWidth) * sw));
  sample.width = sw; sample.height = Math.min(sh, 200);
  const sg = sample.getContext('2d', { willReadFrequently: true });
  sg.drawImage(src, 0, 0, sample.width, sample.height);
  const pixels = sg.getImageData(0, 0, sample.width, sample.height).data;
  const colors = pickPaletteColors(buildPaletteCandidates(pixels));
  const canvas = renderPaletteCard(colors);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'tailref-renk-paleti.png', { type: 'image/png' });
  await addFiles([file], { x: it.x + it.w + 36, y: it.y }, { paletteGenerated: true });
}

btnPalette.onclick = () => createDominantPalette();

$('#btnItemDup').onclick = () => duplicateSelection();
$('#btnItemDel').onclick = () => deleteSelection();

/* ---------------- önemli rengi çarkı ----------------
   Düğmenin üstünde bekleyince altında renk çarkı açılır;
   tıklanan renk seçili görsele / gruba atanır.
   FAZ 3-3: eski hsvToHex/hexToHsv SİLİNDİ; çark artık fırça çarkıyla
   aynı yardımcılardan beslenir — inkWheelStateToHex (halka kimliği
   eski saf ton tanımıyla birebir; koşu beyaza OKLCH-L'de gider) ve
   inkHexToWheelState (ters eşleme, çark açısı köşe seçicidir). */
const impWrapEl   = $('#impWrap');
const impWheelEl  = $('#impWheel');
const wheelDiscEl = $('#wheelDisc');
const wheelDotEl  = $('#wheelDot');
const wheelPrevEl = $('#wheelPrev');
const wheelHexEl  = $('#wheelHex');
let wheelShowTimer = 0, wheelHideTimer = 0;

function placeWheelDot(hex) {
  const c = /^#[0-9a-f]{6}$/i.test(hex) ? hex : IMP_FALLBACK;
  const st = inkHexToWheelState(c);
  const r = wheelDiscEl.getBoundingClientRect();
  const rad = (r.width / 2) * Math.max(0, Math.min(1, st.s));
  const a = st.h * Math.PI / 180;
  wheelDotEl.style.left = (r.width / 2 + Math.cos(a) * rad) + 'px';
  wheelDotEl.style.top  = (r.height / 2 + Math.sin(a) * rad) + 'px';
  wheelDotEl.style.background = c;
}

function setWheelPreview(hex) {
  const c = /^#[0-9a-f]{6}$/i.test(hex) ? hex : IMP_FALLBACK;
  wheelPrevEl.style.background = c;
  wheelHexEl.textContent = c.toUpperCase();
  placeWheelDot(c);
}

/** imlecin çark üzerindeki rengi (konum da güncellenir) */
function wheelPickAt(ev) {
  const r = wheelDiscEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const dx = ev.clientX - cx, dy = ev.clientY - cy;
  const maxR = Math.max(1, r.width / 2);
  const dist = Math.min(Math.hypot(dx, dy), maxR);
  const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
  const sat = dist / maxR;
  const hex = inkWheelStateToHex(hue, sat, 1);
  wheelDotEl.style.left = (r.width / 2 + Math.cos(hue * Math.PI / 180) * dist) + 'px';
  wheelDotEl.style.top  = (r.height / 2 + Math.sin(hue * Math.PI / 180) * dist) + 'px';
  wheelDotEl.style.background = hex;
  wheelPrevEl.style.background = hex;
  wheelHexEl.textContent = hex.toUpperCase();
  return hex;
}

function currentImpColor() {
  const its = selectedImageItems();
  const gid = selectedGroupId();
  if (gid) return isGroupImportant(gid) ? groupImpColor(gid) : '';
  const marked = its.find(i => i.important);
  return marked ? impColorOf(marked) : '';
}

/** Çarkı, görünür olduğu panelin dışına taşmadan ••• düğmesine hizalar. */
function positionImpWheel() {
  if (!impWheelEl || impWheelEl.hidden || !btnImportant) return;
  /* Çark, açıldığı itemBar'ın HEMEN ÜSTÜNDE yaşar: itemBar tutulup
     yükseltilince (kayan z bandı 2300+) sabit 2400 sınıfının ALTINA
     düşüyordu — "çark panelin altında kalıyor, renk seçilmiyor". */
  if (typeof floatingPanelZ === 'function') {
    const host = document.getElementById('itemBar');
    if (host) impWheelEl.style.zIndex = String(floatingPanelZ(host) + 4);
  }
  const anchor = btnImportant.getBoundingClientRect();
  const width = impWheelEl.offsetWidth || 168;
  const height = impWheelEl.offsetHeight || 190;
  const margin = 8;
  const gap = 8;

  let left = anchor.left + anchor.width / 2 - width / 2;
  let top = anchor.bottom + gap;
  let up = false;

  // Altında yer yoksa çarkı düğmenin üstüne al.
  if (top + height > innerHeight - margin) {
    top = anchor.top - height - gap;
    up = top >= margin;
  }
  // Her iki taraf da sığmıyorsa görünür alanda tut.
  top = clamp(top, margin, Math.max(margin, innerHeight - height - margin));
  left = clamp(left, margin, Math.max(margin, innerWidth - width - margin));

  impWheelEl.classList.toggle('up', up);
  impWheelEl.style.left = `${Math.round(left)}px`;
  impWheelEl.style.top = `${Math.round(top)}px`;
  impWheelEl.style.marginLeft = '0px';
}

function showImpWheel() {
  if (!selectedImageItems().length) return;
  impWheelEl.classList.remove('up');
  impWheelEl.style.marginLeft = '0px';
  showPanel(impWheelEl);
  positionImpWheel();
  requestAnimationFrame(positionImpWheel);
  setWheelPreview(currentImpColor() || IMP_FALLBACK);
}

function hideImpWheel() {
  clearTimeout(wheelShowTimer);
  clearTimeout(wheelHideTimer);
  hidePanel(impWheelEl);
}

impWrapEl.addEventListener('pointerenter', () => {
  clearTimeout(wheelShowTimer);
  clearTimeout(wheelHideTimer);
  wheelShowTimer = setTimeout(showImpWheel, 420);
});
impWrapEl.addEventListener('pointerleave', () => {
  clearTimeout(wheelShowTimer);
  clearTimeout(wheelHideTimer);
  wheelHideTimer = setTimeout(hideImpWheel, 220);
});

// Çark artık panelin dışında (body çocuğu) olduğu için düğmeden çarka
// geçerken kapanma sayacı iptal edilir; çarktan çıkınca yeniden başlar.
impWheelEl.addEventListener('pointerenter', () => {
  clearTimeout(wheelHideTimer);
  clearTimeout(wheelShowTimer);
});
impWheelEl.addEventListener('pointerleave', () => {
  clearTimeout(wheelHideTimer);
  wheelHideTimer = setTimeout(hideImpWheel, 240);
});

wheelDiscEl.addEventListener('pointermove', ev => {
  if (ev.buttons) return;
  wheelPickAt(ev);
});

wheelDiscEl.addEventListener('pointerdown', ev => {
  ev.preventDefault();
  ev.stopPropagation();
  const hex = wheelPickAt(ev);
  applyImpColor(hex);
  hideImpWheel();
});

/** seçili görsele/gruba istenen önemli rengini atar */
function applyImpColor(color) {
  const its = selectedImageItems();
  if (!its.length) return;
  pushUndo();

  const gid = selectedGroupId();
  if (gid) {
    // grup seçili: sadece grup çizgileri/başlığı renklenir, fotoğraflar değişmez
    setGroupImportant(gid, true, color);
  } else {
    for (const it of its) {
      it.important = true;
      it.impColor = color;
      const el = elMap.get(it.id);
      if (el) {
        el.classList.add('important');
        el.style.setProperty('--imp', color);
      }
    }
    updateGroupFrame();
  }

  btnImportant.setAttribute('aria-pressed', 'true');
  scheduleSave();
  updateItemBar();
}

// çark dışına tıklanınca kapat
window.addEventListener('pointerdown', ev => {
  if (isPanelVisible(impWheelEl) &&
      !impWrapEl.contains(ev.target) &&
      !impWheelEl.contains(ev.target)) {
    hideImpWheel();
  }
}, true);

// Panel içeriği kaydırılınca düğme yer değiştirir; çarkı kapat.
itemBarEl.querySelector('.itemBarContent')?.addEventListener('scroll', () => {
  if (isPanelVisible(impWheelEl)) hideImpWheel();
}, { passive: true });

window.addEventListener('resize', () => {
  updateItemBar();
  if (isPanelVisible(impWheelEl)) positionImpWheel();
});
