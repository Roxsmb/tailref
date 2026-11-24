/* TailRef app · text inspector, image filters, crop */
'use strict';

function selectedTextItem() {
  if (editingId) {
    const it = getItem(editingId);
    if (it && it.kind === 'text') return it;
  }
  if (selection.size === 1) {
    const it = getItem([...selection][0]);
    if (it && it.kind === 'text') return it;
  }
  return null;
}

function updateInspector() {
  const it = selectedTextItem();
  if (it) {
    showPanel(inspectorEl);
    // Kayıtlı konum ilk tutuşta uygulanınca panel aniden zıplıyordu.
    prepareFloatingPanel(inspectorEl);
  } else {
    hidePanel(inspectorEl);
  }
  if (!it) return;

  const fs = Math.round(it.fontSize || FONT_SIZE);
  if (document.activeElement !== fsRangeEl) fsRangeEl.value = String(clamp(fs, 8, 240));
  if (document.activeElement !== fsInputEl) fsInputEl.value = String(fs);
  $('#btnBold').setAttribute('aria-pressed', it.bold ? 'true' : 'false');
  $('#btnTextBg').setAttribute('aria-pressed', it.bg && it.bg !== 'transparent' ? 'true' : 'false');

}

function textAutoWidth(it) {
  const fs = it.fontSize || FONT_SIZE;
  const lines = String(it.text || '').split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return clamp(Math.round(longest * fs * 0.62 + 28), 200, 1600);
}

function restyle(it, refreshInspector = true) {
  const el = elMap.get(it.id);
  if (el) {
    if (it.kind === 'text') {
      it.w = textAutoWidth(it);
      el.style.width = it.w + 'px';
    }
    updateItemEl(it, el);
  }
  scheduleSave();
  if (refreshInspector) updateInspector();
}

inspectorEl.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const it = selectedTextItem();
  if (!it) return;

  /* Metin görünümünü değiştiren her düğme geri alınabilir olmalı;
     kopyala/sil kendi adımını atar. */
  if (btn.dataset.color) {
    pushUndo();
    it.color = btn.dataset.color;
    restyle(it);
    return;
  }

  const fs = it.fontSize || FONT_SIZE;
  switch (btn.dataset.act) {
    case 'fs+': pushUndo(); it.fontSize = clamp(fs + 4, 8, 400); break;
    case 'fs-': pushUndo(); it.fontSize = clamp(fs - 4, 8, 400); break;
    case 'bold': pushUndo(); it.bold = !it.bold; break;
    case 'bg': {
      pushUndo();
      const opts = [null, 'rgba(0,0,0,.35)', 'rgba(0,0,0,.72)', 'rgba(255,255,255,.88)'];
      const idx  = opts.indexOf(it.bg || null);
      it.bg = opts[(idx + 1) % opts.length];
      break;
    }
    case 'dup': duplicateSelection(); return;
    case 'del': removeItems([it.id], true); return;
    default: return;
  }
  restyle(it);
});

/* yazı boyutu: kaydırıcı + sayı kutusu */
function setTextSize(value, undo = false) {
  const it = selectedTextItem();
  if (!it) return;
  if (undo) pushUndo();
  it.fontSize = clamp(Math.round(Number(value) || FONT_SIZE), 8, 400);
  if (fsRangeEl.value !== String(it.fontSize)) fsRangeEl.value = String(clamp(it.fontSize, 8, 240));
  if (document.activeElement !== fsInputEl) fsInputEl.value = String(it.fontSize);
  // Slider sürüklenirken paneli her input'ta yeniden taşımak odağı bozuyordu.
  restyle(it, false);
}
bindSliderUndo(fsRangeEl, () => !!selectedTextItem());
fsRangeEl.addEventListener('input', () => setTextSize(fsRangeEl.value));
fsInputEl.addEventListener('change', () => setTextSize(fsInputEl.value, true));
fsInputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); fsInputEl.blur(); }
  if (e.key === 'Escape') { e.preventDefault(); updateInspector(); fsInputEl.blur(); }
});

/* ---------------- seçili görsel paneli ---------------- */

/* Kaydırıcı geri alma: anlık görüntü pointerdown anında alınır, yığına
   yalnız ilk GERÇEK input'ta yazılır. Kaydırıcıya sadece dokunup bırakmak
   boş bir geri-alma adımı bırakmaz. Klavye ile ince ayarda (pointer yok)
   her input kendi adımıdır; değer değişmeden input gelmez. */
function bindSliderUndo(control, enabled) {
  if (!control) return;
  let armed = null;
  let pointerActive = false;
  const ready = () => (typeof enabled === 'function' ? enabled() : true);
  control.addEventListener('pointerdown', () => {
    pointerActive = true;
    armed = ready() ? maskSnapStringify(createStateSnapshot()) : null;
  });
  const end = () => { pointerActive = false; armed = null; };
  control.addEventListener('pointerup', end);
  control.addEventListener('pointercancel', end);
  control.addEventListener('change', end);
  control.addEventListener('input', () => {
    if (!ready()) { armed = null; return; }
    if (armed) { const snap = armed; armed = null; pushUndoRaw(snap); return; }
    if (!pointerActive) pushUndo();
  });
}

/* Opaklık: üst çubuktaki itemAlpha ile panel içindeki fOpacity AYNI değer
   sürer; iki kaydırıcı senkron kalır, okumalar yüzde gösterir. */
function applyImageAlpha(val) {
  const its = selectedImageItems();
  if (!its.length) return;
  const pct = String(clamp(Math.round(val * 100), 5, 100));
  for (const it of its) {
    it.alpha = clamp(Number(pct) / 100, 0, 1);
    const el = elMap.get(it.id);
    const media = el && el.firstChild;
    if (media && media.style) {
      if (it.alpha < 1) media.style.opacity = String(it.alpha);
      else media.style.removeProperty('opacity');
    }
  }
  /* Her iki kontrol de aynı değerden okur — hangisi sürüklenirse sürüklesin. */
  if (document.activeElement !== itemAlphaEl) itemAlphaEl.value = pct;
  syncRangeFill(itemAlphaEl);
  if (document.activeElement !== fOpacityEl) fOpacityEl.value = pct;
  syncRangeFill(fOpacityEl);
  alphaValEl.textContent = pct + '%';
  if (fOpacityValEl) fOpacityValEl.textContent = '%' + pct;
  syncImageSliderFills();
  scheduleSave();
}

bindSliderUndo(itemAlphaEl, () => selectedImageItems().length > 0);
itemAlphaEl.addEventListener('input', () => {
  applyImageAlpha(Number(itemAlphaEl.value) / 100);
});

bindSliderUndo(fOpacityEl, () => selectedImageItems().length > 0);
fOpacityEl.addEventListener('input', () => {
  applyImageAlpha(Number(fOpacityEl.value) / 100);
});

/* Renk bölümü kaydırıcıları — okumalar: doygunluk ham %, parlaklık/kontrast
   sapma %, sıcaklık işaretli sayı. */
function getImageFilterValues() {
  return {
    gray: Number(fGrayEl.value),
    bright: Number(fBrightEl.value),
    contrast: Number(fContrastEl.value),
    temp: Number(fTempEl.value) || 0,
  };
}

/* Programatik değer atamalarında (elle giriş, hazır ayar, seçim
   senkronu) kaydırıcı dolgusu CSS'i --fill tazelenmeli: .value atamak
   'input' olayı üretmez, dolgu eski yerde kalırdı (kullanıcı raporu:
   "elimle sayı girince slider bozuluyor"). */
function syncImageSliderFills() {
  for (const ctl of [fGrayEl, fBrightEl, fContrastEl, fTempEl, fOpacityEl, cropTopEl, cropRightEl, cropBottomEl, cropLeftEl]) {
    syncRangeFill(ctl);
  }
}

function syncFilterReadouts(v) {
  if (fGrayValEl) fGrayValEl.textContent = String(v.gray) + '%';
  if (fBrightValEl) fBrightValEl.textContent = Math.round(v.bright - 100) + '%';
  if (fContrastValEl) fContrastValEl.textContent = Math.round(v.contrast - 100) + '%';
  if (fTempValEl) fTempValEl.textContent = (v.temp > 0 ? '+' : '') + v.temp;
}

function applyImageFilters() {
  const its = selectedImageItems();
  if (!its.length) return;
  const v = getImageFilterValues();
  for (const it of its) {
    it.fGray = v.gray;
    it.fBright = v.bright;
    it.fContrast = v.contrast;
    it.fTemp = v.temp;
    const el = elMap.get(it.id);
    if (el) updateItemEl(it, el);
  }
  syncFilterReadouts(v);
  syncImageSliderFills();
  scheduleSave();
}

for (const control of [fGrayEl, fBrightEl, fContrastEl, fTempEl]) {
  bindSliderUndo(control, () => selectedImageItems().length > 0);
  control.addEventListener('input', applyImageFilters);
}

btnResetFilter.onclick = () => {
  if (!selectedImageItems().length) return;
  pushUndo();
  fGrayEl.value = '0';
  fBrightEl.value = '100';
  fContrastEl.value = '100';
  fTempEl.value = '0';
  applyImageFilters();
};

/* -------- döndürme ve aynalama -------- */
function rotateImageSelection(delta) {
  const its = selectedImageItems();
  if (!its.length) return;
  pushUndo();
  for (const it of its) {
    it.rot = ((Math.round(it.rot || 0) + delta) % 360 + 360) % 360;
    const el = elMap.get(it.id);
    if (el) updateItemEl(it, el);
  }
  scheduleSave();
}

function flipImageSelection(axis) {
  const its = selectedImageItems();
  if (!its.length) return;
  pushUndo();
  for (const it of its) {
    if (axis === 'h') it.flipH = !it.flipH;
    else it.flipV = !it.flipV;
    const el = elMap.get(it.id);
    if (el) updateItemEl(it, el);
  }
  const first = its[0];
  if (btnImageFlipH) btnImageFlipH.setAttribute('aria-pressed', first.flipH ? 'true' : 'false');
  if (btnImageFlipV) btnImageFlipV.setAttribute('aria-pressed', first.flipV ? 'true' : 'false');
  scheduleSave();
}

if (btnImageRotL) btnImageRotL.addEventListener('click', () => rotateImageSelection(-90));
if (btnImageRotR) btnImageRotR.addEventListener('click', () => rotateImageSelection(90));
if (btnImageFlipH) btnImageFlipH.addEventListener('click', () => flipImageSelection('h'));
if (btnImageFlipV) btnImageFlipV.addEventListener('click', () => flipImageSelection('v'));

/* -------- kırpma -------- */
/** Kaydırıcıları ve px okumalarını seçili ilk görselden yeniler. */
function syncCropControls() {
  const its = selectedImageItems();
  const it = its[0];
  if (!it || it.kind !== 'image') return;
  cropTopEl.value = String(it.cropTop || 0);
  cropRightEl.value = String(it.cropRight || 0);
  cropBottomEl.value = String(it.cropBottom || 0);
  cropLeftEl.value = String(it.cropLeft || 0);
  for (const ctl of [cropTopEl, cropRightEl, cropBottomEl, cropLeftEl]) syncRangeFill(ctl);
  updateCropPxOutputs(it);
}

function applyCrop() {
  const its = selectedImageItems();
  if (!its.length) return;
  const values = {
    cropTop: Number(cropTopEl.value), cropRight: Number(cropRightEl.value),
    cropBottom: Number(cropBottomEl.value), cropLeft: Number(cropLeftEl.value),
  };
  for (const it of its) {
    Object.assign(it, values);
    const el = elMap.get(it.id);
    if (el) updateItemEl(it, el);
  }
  updateCropPxOutputs(its[0]);
  syncImageSliderFills();
  scheduleSave();
}

for (const control of [cropTopEl, cropRightEl, cropBottomEl, cropLeftEl]) {
  bindSliderUndo(control, () => selectedImageItems().length > 0);
  control.addEventListener('input', applyCrop);
}

/* ---- sağdaki okumaları elle girilebilir yap (kullanıcı isteği:
   "sağdaki değerlere iki kez tıklayıp değeri kendim girmek istiyorum")
   → çift tık satır içi kutu açar; Enter/odak kaybı işler, Esc vazgeçer. ---- */
function makeValueEditable(out, apply) {
  if (!out) return;
  out.classList.add('ieValEditable');
  out.title = __t('Double-click to type manually');
  out.addEventListener('dblclick', () => {
    if (out.querySelector('input')) return;
    const prevText = out.textContent;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'ieValInput';
    inp.value = prevText.replace(/[%,]|px/g, '').trim();
    out.textContent = '';
    out.appendChild(inp);
    inp.focus();
    inp.select();
    let done = false;
    const commit = ok => {
      if (done) return;
      done = true;
      const raw = String(inp.value).replace(/,/, '.').replace(/[^\d.+-]/g, '');
      inp.remove();
      const v = parseFloat(raw);
      if (ok && Number.isFinite(v)) apply(v);
      /* uygulanamadıysa eski yazı geri gelsin */
      if (!out.textContent) out.textContent = prevText;
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    inp.addEventListener('blur', () => commit(true));
  });
}

/* Renk bölümü: okumalar kaydırıcı dilini konuşur — doygunluk ham %,
   parlaklık/kontrast sapma % (kutuya yazılan = 100 + fark), sıcaklık işaretli. */
makeValueEditable(fGrayValEl, v => {
  if (!selectedImageItems().length) return;
  pushUndo();
  fGrayEl.value = String(clamp(Math.round(v), 0, 100));
  applyImageFilters();
});
makeValueEditable(fBrightValEl, v => {
  if (!selectedImageItems().length) return;
  pushUndo();
  fBrightEl.value = String(clamp(Math.round(v + 100), 0, 200));
  applyImageFilters();
});
makeValueEditable(fContrastValEl, v => {
  if (!selectedImageItems().length) return;
  pushUndo();
  fContrastEl.value = String(clamp(Math.round(v + 100), 0, 200));
  applyImageFilters();
});
makeValueEditable(fTempValEl, v => {
  if (!selectedImageItems().length) return;
  pushUndo();
  fTempEl.value = String(clamp(Math.round(v), -100, 100));
  applyImageFilters();
});
makeValueEditable(fOpacityValEl, v => {
  if (!selectedImageItems().length) return;
  pushUndo();
  applyImageAlpha(clamp(Math.round(v), 5, 100) / 100);
});

/* Kırpma: kutucuk px bekler → yüzdelik kaydırıcıya çevrilir.
   Üst/Alt çokluğu öğe yüksekliği, Sağ/Sol genişliği ölçek alır. */
function makeCropOutputEditable(out, slider, dim) {
  makeValueEditable(out, px => {
    const it = selectedImageItems()[0];
    if (!it || it.kind !== 'image') return;
    const base = dim === 'h' ? Number(it.h) : Number(it.w);
    if (!base) return;
    pushUndo();
    slider.value = String(clamp(Math.round(px / base * 100), 0, 45));
    applyCrop();
  });
}
makeCropOutputEditable(cropTopValEl, cropTopEl, 'h');
makeCropOutputEditable(cropBottomValEl, cropBottomEl, 'h');
makeCropOutputEditable(cropLeftValEl, cropLeftEl, 'w');
makeCropOutputEditable(cropRightValEl, cropRightEl, 'w');

/* Oran hazır ayarları: merkez sabit kalarak görünür alanı hedef orana
   daraltır. Serbest->yalnızca işaret; kırpma değerlerine dokunmaz. */
function applyCropRatio(ratio) {
  const its = selectedImageItems();
  if (!its.length || !ratio) return;
  for (const it of its) {
    const top = Number(it.cropTop) || 0, right = Number(it.cropRight) || 0;
    const bottom = Number(it.cropBottom) || 0, left = Number(it.cropLeft) || 0;
    const wv = Math.max(0, 1 - (left + right) / 100);
    const hv = Math.max(0, 1 - (top + bottom) / 100);
    const itemW = Number(it.w) || 1, itemH = Number(it.h) || 1;
    const cur = (itemW * wv) / Math.max(1e-6, itemH * hv);
    let nTop = top, nRight = right, nBottom = bottom, nLeft = left;
    if (cur > ratio) {
      /* görünür alan hedeften geniş → yanlardan büyüteç */
      const targetWv = (itemH * hv * ratio) / itemW;
      const room = Math.max(0, Math.min(45 - left, 45 - right));
      const extra = Math.min(Math.max(0, (wv - targetWv) / 2 * 100), room);
      nLeft = clamp(left + extra, 0, 45);
      nRight = clamp(right + extra, 0, 45);
    } else if (cur < ratio) {
      const targetHv = (itemW * wv) / (itemH * ratio);
      const room = Math.max(0, Math.min(45 - top, 45 - bottom));
      const extra = Math.min(Math.max(0, (hv - targetHv) / 2 * 100), room);
      nTop = clamp(top + extra, 0, 45);
      nBottom = clamp(bottom + extra, 0, 45);
    }
    Object.assign(it, {
      cropTop: Math.round(nTop), cropRight: Math.round(nRight),
      cropBottom: Math.round(nBottom), cropLeft: Math.round(nLeft),
    });
    const el = elMap.get(it.id);
    if (el) updateItemEl(it, el);
  }
  syncCropControls();
  scheduleSave();
}

if (ieRatioGroupEl) {
  ieRatioGroupEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-ratio]');
    if (!btn) return;
    const ratio = Number(btn.dataset.ratio) || 0;
    for (const b of ieRatioGroupEl.querySelectorAll('button[data-ratio]')) {
      b.classList.toggle('on', b === btn);
    }
    if (ratio && selectedImageItems().length) {
      pushUndo();
      applyCropRatio(ratio);
    }
  });
}

btnEditImage.onclick = () => {
  openStudioPanel(imageEditorEl);
};
btnImageEditorClose.onclick = () => closeStudioPanel(imageEditorEl);

btnImportant.onclick = () => {
  const its = selectedImageItems();
  if (!its.length) return;
  pushUndo();

  // Grup seçiliyse: sadece grubun dış çizgileri kırmızı olur, fotoğraflar değişmez
  const gid = selectedGroupId();
  if (gid) {
    const on = !isGroupImportant(gid);
    setGroupImportant(gid, on);
    btnImportant.setAttribute('aria-pressed', on ? 'true' : 'false');
    scheduleSave();
    updateItemBar();
    return;
  }

  const on = !its.every(i => i.important);
  const color = on ? randomImpColor() : '';
  for (const it of its) {
    it.important = on;
    if (on) it.impColor = color;
    else delete it.impColor;
    const el = elMap.get(it.id);
    if (el) {
      el.classList.toggle('important', on);
      if (on) el.style.setProperty('--imp', color);
      else el.style.removeProperty('--imp');
    }
  }
  btnImportant.setAttribute('aria-pressed', on ? 'true' : 'false');
  updateGroupFrame();
  scheduleSave();
};
