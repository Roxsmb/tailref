/* TailRef app · item DOM creation/update, sync, item bar */
'use strict';

/* =========================================================
   DOM üretimi
   ========================================================= */
/* Metin düzenlemesinde ilk gerçek girişte düzenleme öncesi durumu yığına
   yazan işaret. startEdit doldurur, commit/blur temizler. */
let textEditUndoId = null;

/* contenteditable metnini modele çevirir. Chromium Shift+Enter'da <br>,
   Enter'da <div> üretir; düz textContent ikisini de yeni satır saymaz ve
   yazı yeniden yüklenince tek satıra çöküyordu (kullanıcı hatası gibi
   görünen veri kaybı). Blok sınırları ve <br> burada '\n' olur. */
function editableTextValue(root) {
  let out = '';
  /* Blok sınırı = tek satır sonu. Boş satırlar (<div><br></div>) BR'den bir,
     blok sınırından bir olmak üzere İKİ kez sayılıyordu; kullanıcının
     yazdığı boş satırlar her kayıtta çoğalıyordu. lineBreak() ardışık
     satır sonlarını birleştirir, BR kendi satır sonunu korur. */
  const lineBreak = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out += child.nodeValue; continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (tag === 'BR') { out += '\n'; continue; }
      const block = tag === 'DIV' || tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE';
      if (block) lineBreak();
      walk(child);
      if (block) lineBreak();
    }
  };
  walk(root);
  return out.replace(/\n+$/, '');
}

function createItemEl(it) {
  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.id = it.id;
  // Türü sınıf olarak da taşı: fotoğraflara yuvarlak köşe, yazıya ayrı davranış.
  el.classList.add(it.kind === 'image' ? 'is-image' : 'is-text');

  if (it.kind === 'image') {
    // Filtre, opaklık ve kırpma ayrı bir sarmalayıcıda tutulur. Böylece
    // sürükleme sırasında öğenin transform katmanı ile görsel efekt
    // katmanı birbirine karışmaz; çift görüntü/hayalet oluşmaz.
    const media = document.createElement('div');
    media.className = 'media';
    const img = document.createElement('img');
    img.draggable = false;
    img.alt = '';
    const c = imgCache.get(it.imageId);
    if (c) img.src = c.url;
    media.appendChild(img);
    el.appendChild(media);
    el.title = c ? c.name : '';

    /* Kilitli fotoğrafın sağ üstünde görünen rozet. Öğe döndüğünde
       ters döndürülür; boyutu --inv ile ekran ölçeğinde sabit kalır. */
    const lockBadge = document.createElement('div');
    lockBadge.className = 'lockBadge';
    lockBadge.setAttribute('aria-hidden', 'true');
    lockBadge.innerHTML = '<svg viewBox="0 0 24 24"><use href="#icon-lock"/></svg>';
    el.appendChild(lockBadge);
  } else {
    const t = document.createElement('div');
    t.className = 'text';
    // Metin yalnızca düzenleme sırasında contenteditable olur. Aksi halde
    // tek tıkla seçilen yazı, klavye odağını içeride tutup Delete/Backspace
    // kısayolunu yutuyordu.
    t.contentEditable = 'false';
    t.spellcheck = false;
    t.textContent = it.text || '';
    el.appendChild(t);

    /* Dinleyiciler createItemEl sırasındaki nesneye kapanır; geri al/yinele
       sonrası syncAll aynı DOM'u yeni nesneyle günceller. Kapanan eski
       nesneye yazmak metni sessizce kaybettiriyordu → her zaman güncel
       öğeyi çöz. */
    const liveItem = () => getItem(it.id) || it;
    t.addEventListener('input', () => {
      const cur = liveItem();
      cur.text = editableTextValue(t);
      cur.w = textAutoWidth(cur);
      el.style.width = cur.w + 'px';
      cur.h = t.offsetHeight || cur.h;
      scheduleSave();
      updateInspector();
    });
    /* İlk gerçek girişten ÖNCE snapshot: düzenleme oturumu başına tek
       geri-alma adımı. Tarayıcının kendi geri/yinele komutları (historyUndo)
       zaten metni değiştirir; onlar için ikinci adım açmayız. */
    t.addEventListener('beforeinput', e => {
      if (textEditUndoId !== it.id) return;
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') return;
      textEditUndoId = null;
      pushUndo();
    });
    t.addEventListener('pointerdown', e => {
      if (editingId === it.id) e.stopPropagation();
    });
    t.addEventListener('focusout', e => {
      if (editingId !== it.id) return;
      // panelden boyut/renk ayarı yapılıyorsa yazıyı silme
      if (e.relatedTarget && inspectorEl.contains(e.relatedTarget)) return;
      editingId = null;
      textEditUndoId = null;
      t.contentEditable = 'false';
      el.classList.remove('editing');
      const cur = liveItem();
      if (!(cur.text || '').trim()) {
        removeItems([it.id], false, { toTrash: false });
      } else {
        cur.h = t.offsetHeight || cur.h;
        scheduleSave();
        syncAll();
      }
    });
  }

  const hs = document.createElement('div');
  hs.className = 'handles';
  for (const [hx, hy, cls] of HANDLES) {
    const d = document.createElement('div');
    d.className = 'handle ' + cls;
    d.dataset.hx = hx; d.dataset.hy = hy;
    hs.appendChild(d);
  }
  const rot = document.createElement('div');
  rot.className = 'handle rot';
  rot.dataset.rot = '1';
  hs.appendChild(rot);
  el.appendChild(hs);

  return el;
}

/* Ekran ve dışa aktarımın AYNI filtre dilini konuşması için tek kaynak:
   sıcaklık pozitifse sıcak (sepia+doymuşluk), negatifse serin (hue-rotate)
   ton; değerler yüzdeyle ölçeklenir. 15-menu-export ctx.filter dizgisiyle
   birebir aynıdır. */
function imageFilterCss(gray, bright, contrast, temp) {
  const parts = [];
  if (gray) parts.push(`grayscale(${gray}%)`);
  if (temp > 0) {
    parts.push(`sepia(${Math.min(60, temp * 0.6)}%)`);
    parts.push(`saturate(${Math.round(100 + temp * 0.35)}%)`);
  } else if (temp < 0) {
    const t = -temp;
    parts.push(`hue-rotate(${Math.min(30, t * 0.3)}deg)`);
    parts.push(`saturate(${Math.round(100 - t * 0.2)}%)`);
    parts.push(`brightness(${Math.round(100 + t * 0.05)}%)`);
  }
  if (bright !== 100) parts.push(`brightness(${bright}%)`);
  if (contrast !== 100) parts.push(`contrast(${contrast}%)`);
  return parts.join(' ');
}

function updateItemEl(it, el) {
  // Konumu left/top yerine transform ile sürüyoruz: her karede layout
  // tetiklenmez, compositor katmanı taşınır ve sürükleme sırasında eski
  // karelerin "hayaleti" ekranda kalmaz.
  if (el.style.left !== '0px') el.style.left = '0px';
  if (el.style.top !== '0px') el.style.top = '0px';
  const widthValue = it.w + 'px';
  if (el.style.width !== widthValue) el.style.width = widthValue;
  const zValue = String(10 + (Number(it.z) || 1));
  if (el.style.zIndex !== zValue) el.style.zIndex = zValue;
  /* Yatay/dikey aynala: öğenin kendisi çevrilir (görsel + üstündeki çizim).
     scale, rotate'ten SONRA gelir — aynalama döndürülmüş eksen çiftidir
     ve dışa aktarımdaki ctx.scale sırasıyla birebir uyuşur. */
  const flipValue = (it.flipH ? -1 : 1) * (it.flipV ? -1 : 1);
  const transformValue = `translate3d(${it.x}px, ${it.y}px, 0) rotate(${it.rot || 0}deg) scale(${it.flipH ? -1 : 1}, ${it.flipV ? -1 : 1})`;
  if (el.style.transform !== transformValue) el.style.transform = transformValue;
  /* Kilit rozeti öğeyle birlikte dönmesin diye ters açı CSS'e taşınır. */
  const rotValue = String(Number(it.rot) || 0) + 'deg';
  if (el.style.getPropertyValue('--rot') !== rotValue) el.style.setProperty('--rot', rotValue);

  if (it.kind === 'image') {
    const heightValue = it.h + 'px';
    if (el.style.height !== heightValue) el.style.height = heightValue;
    // Cache sonradan doldurulursa (örn. çöpten geri getirme) img.src güncellensin
    const img = el.querySelector('.media img');
    if (img && it.imageId) {
      const c = imgCache.get(it.imageId);
      if (c) {
        if (img.src !== c.url) { img.src = c.url; el.title = c.name; }
      } else if (!imageLoadFailures.has(it.imageId)) {
        // Önbellekte yoksa (geri al/yinele veya tahliye sonrası) tembel yükle.
        ensureImageCached(it.imageId).then(value => {
          if (!el.isConnected || elMap.get(it.id) !== el) return;
          img.src = value.url;
          el.title = value.name;
        }).catch(() => { /* kalıcı hata: tekrar denemeyi bırak */ });
      }
    }
    // Görsele bağlı çizim katmanları öğenin içinde yaşar; transformu
    // otomatik olarak görselle birlikte hareket eder.
    if (typeof inkSyncItem === 'function') inkSyncItem(it, el);
  } else {
    if (el.style.height !== 'auto') el.style.height = 'auto';
    const t = el.firstChild;
    /* Yükseklik yalnızca içerik/stil değiştiğinde yeniden ölçülür. Her
       sync çağrısında offsetHeight okumak, stil yazmalarıyla serpişince
       her öğede forced reflow üretir; büyük tahtalarda kare başına
       yüzlerce kez layout tetiklenip donmaya yol açıyordu. Metin, boyut,
       kalınlık, arka plan, renk, genişlik veya düzenleme durumu aynıysa
       mevcut yükseklik zaten geçerlidir. */
    const textSig = `${it.text || ''}|${it.fontSize || FONT_SIZE}|${it.fontFamily || ''}|${it.bold ? 1 : 0}|${it.bg || ''}|${it.color || ''}|${it.w}|${editingId === it.id ? 1 : 0}`;
    const textStyleChanged = el.dataset.textSig !== textSig;
    t.style.fontSize   = (it.fontSize || FONT_SIZE) + 'px';
    /* Aday 7: öğe ailesi boşsa CSS varsayılanı (Inter yığını). */
    t.style.fontFamily = it.fontFamily || '';
    t.style.color      = it.color || '#fff';
    t.style.fontWeight = it.bold ? 700 : 400;
    t.style.background = it.bg || 'transparent';
    if (document.activeElement !== t && t.textContent !== (it.text || '')) {
      t.textContent = it.text || '';
    }
    if (editingId !== it.id) t.contentEditable = 'false';
    // yüksekliği ölç (transform öncesi layout px = dünya birimi)
    if (textStyleChanged || document.activeElement === t || !it.h) {
      it.h = t.offsetHeight || it.h || 0;
      el.dataset.textSig = textSig;
    }
  }

  el.classList.toggle('sel', selection.has(it.id));
  el.classList.toggle('editing', editingId === it.id);
  el.classList.toggle('important', !!it.important);
  el.classList.toggle('locked', !!it.locked);
  if (it.important) el.style.setProperty('--imp', impColorOf(it));
  else el.style.removeProperty('--imp');

  // Opaklık/filtre/kırpma yalnızca içeriğe uygulanır (tutamaçlar tam
  // görünür kalsın). Varsayılan değerlerde özellik tamamen kaldırılır;
  // böylece gereksiz GPU filtre katmanı oluşmaz.
  const media = el.firstChild;
  if (media && media.style) {
    const alpha = alphaOf(it);
    if (alpha < 1) media.style.opacity = String(alpha);
    else media.style.removeProperty('opacity');

    const cropTop = Number(it.cropTop) || 0;
    const cropRight = Number(it.cropRight) || 0;
    const cropBottom = Number(it.cropBottom) || 0;
    const cropLeft = Number(it.cropLeft) || 0;
    if (cropTop || cropRight || cropBottom || cropLeft) {
      media.style.clipPath = `inset(${cropTop}% ${cropRight}% ${cropBottom}% ${cropLeft}%)`;
    } else {
      media.style.removeProperty('clip-path');
    }

    const gray = Number(it.fGray) || 0;
    const bright = it.fBright === undefined ? 100 : Number(it.fBright);
    const contrast = it.fContrast === undefined ? 100 : Number(it.fContrast);
    const temp = Number(it.fTemp) || 0;
    if (gray || bright !== 100 || contrast !== 100 || temp) {
      media.style.filter = imageFilterCss(gray, bright, contrast, temp);
    } else {
      media.style.removeProperty('filter');
    }
  }

  // bağlantı okları öğeyle birlikte hareket etsin
  if (typeof scheduleLinks === 'function') scheduleLinks();
}

function syncAll() {
  const seen = new Set();
  let freshIndex = 0;
  for (const it of state.items) {
    seen.add(it.id);
    let el = elMap.get(it.id);
    if (!el) {
      // Geri al/yinele sırasında aynı kimlikli eski kopya hâlâ sönüyorsa kaldır.
      const orphan = world.querySelector(`.item.item-leaving[data-id="${it.id}"]`);
      if (orphan) orphan.remove();
      el = createItemEl(it);
      elMap.set(it.id, el);
      el.style.setProperty('--stagger', String(Math.min(freshIndex, 8)));
      freshIndex++;
      if (!motionReduced()) {
        el.classList.add('item-enter');
        setTimeout(() => {
          el.classList.remove('item-enter');
          el.style.removeProperty('--stagger');
        }, 620);
      }
      world.appendChild(el);
    }
    updateItemEl(it, el);
  }
  for (const [id, el] of [...elMap]) {
    if (!seen.has(id)) {
      elMap.delete(id);
      retireItemEl(el);
    }
  }
  hintEl.classList.toggle('hidden', state.items.length > 0);
  setItemCountLabel();
  updateInspector();
  updateItemBar();
  updateGroupFrame();
  updateLinkButton();
  scheduleLinks();
  // Aşırı büyük tahtalarda kullanıcıyı erken uyar (kurtarma yolu gösterilir).
  if (typeof maybeWarnOverload === 'function') maybeWarnOverload();
  if (typeof inkSyncDom === 'function') inkSyncDom();
}

function syncSelection() {
  const gid = selectedGroupId();
  for (const [id, el] of elMap) {
    el.classList.toggle('sel', selection.has(id));
    // grup seçiliyken tek tek tutamaçlar yerine grubun tutamaçları kullanılır
    el.classList.toggle('grouped', !!gid && selection.has(id));
  }
  updateInspector();
  updateItemBar();
  updateGroupFrame();
  updateLinkButton();
  // Mod anahtarı seçime göre "Drawing" düğmesini etkinleştirir/pasifleştirir.
  if (typeof modeSyncUi === 'function') modeSyncUi();
}

/* =========================================================
   yazı paneli
   ========================================================= */
const inspectorEl = $('#inspector');
const fsRangeEl   = $('#fsRange');
const fsInputEl   = $('#fsInput');
const itemBarEl   = $('#itemBar');
const itemAlphaEl = $('#itemAlpha');
const alphaValEl  = $('#alphaVal');
const itemBarTitleEl = $('#itemBarTitle');
const btnImportant = $('#btnImportant');
const btnLock = $('#btnLock');
const btnPalette = $('#btnPalette');
const btnArrange = $('#btnArrange');
const btnExportImageEl = $('#btnExportImage');
const fGrayEl = $('#fGray');
const fBrightEl = $('#fBright');
const fContrastEl = $('#fContrast');
const fTempEl = $('#fTemp');
const fOpacityEl = $('#fOpacity');
const fGrayValEl = $('#fGrayVal');
const fBrightValEl = $('#fBrightVal');
const fContrastValEl = $('#fContrastVal');
const fTempValEl = $('#fTempVal');
const fOpacityValEl = $('#fOpacityVal');
const btnImageRotL = $('#btnImageRotL');
const btnImageRotR = $('#btnImageRotR');
const btnImageFlipH = $('#btnImageFlipH');
const btnImageFlipV = $('#btnImageFlipV');
const ieRatioGroupEl = $('#ieRatioGroup');
const btnResetFilter = $('#btnResetFilter');
const btnEditImage = $('#btnEditImage');
const cropTopEl = $('#cropTop');
const cropRightEl = $('#cropRight');
const cropBottomEl = $('#cropBottom');
const cropLeftEl = $('#cropLeft');
const cropTopValEl = $('#cropTopVal');
const cropRightValEl = $('#cropRightVal');
const cropBottomValEl = $('#cropBottomVal');
const cropLeftValEl = $('#cropLeftVal');
const imageEditorEl = $('#imageEditor');
const btnImageEditorClose = $('#btnImageEditorClose');

const alphaOf = it => (typeof it.alpha === 'number' ? it.alpha : 1);

/** Kırpma okumaları gerçek piksele çevrilir: kaydırıcı yüzde, panel px gösterir.
    Değer, slider yerine DOĞRUDAN öğeden okunur (senkron sırası: slider atanır
    üstte/sağda, okuma fazla-bayat olamaz). */
function updateCropPxOutputs(it) {
  if (!it || it.kind !== 'image' || typeof it.w !== 'number') return;
  const pairs = [
    [cropTopValEl, it.h, it.cropTop],
    [cropBottomValEl, it.h, it.cropBottom],
    [cropLeftValEl, it.w, it.cropLeft],
    [cropRightValEl, it.w, it.cropRight],
  ];
  for (const [out, dim, crop] of pairs) {
    if (!out) continue;
    const v = clamp(Number(crop) || 0, 0, 100);
    out.textContent = String(Math.round(v / 100 * dim)) + ' px';
  }
}

/** Seçili görseller — grup seçiliyse grubun bütün görselleri birlikte gelir */
function selectedImageItems() {
  const list = [];
  for (const id of selection) {
    const it = getItem(id);
    if (it && it.kind === 'image') list.push(it);
  }
  return list;
}

function worldToScreen(p) {
  return { x: p.x * state.view.scale + state.view.x, y: p.y * state.view.scale + state.view.y };
}

function updateItemBar() {
  const its = selectedImageItems();
  const it = its[0];
  if (!it) {
    /* Seçim yokken "Seçim Özellikleri" paneli görünmez. Seçim yapılınca
       yeniden açılır; konumu kayıtlı olduğu için yerine döner. Ayrı
       penceredeyse o pencere de kapanır (geri takılmaz). */
    if (itemBarEl.dataset.detached === '1'
        && typeof tailrefCloseDetachedPanel === 'function') {
      tailrefCloseDetachedPanel(itemBarEl, false);
    } else {
      hidePanel(itemBarEl);
    }
    itemBarEl.classList.remove('multi');
    itemBarTitleEl.textContent = 'No selection';
    const itemGroupBtn = $('#btnItemGroup');
    if (itemGroupBtn) {
      itemGroupBtn.disabled = true;
      itemGroupBtn.title = 'Group at least two items (G)';
      itemGroupBtn.setAttribute('aria-pressed', 'false');
    }
    hidePanel(imageEditorEl, syncStudioPanelState);
    syncStudioPanelState();
    hidePanel(document.getElementById('impWheel'));
    if (typeof updateInspector === 'function') updateInspector();
    return;
  }

  itemBarEl.classList.remove('is-empty');
  /* Araç çubuğu katlıyken (bar-collapsed-ui) seçim özellikleri paneli
     de katlı kalır (kullanıcı isteği: "paneli gizli moda alırsam bu
     seçim özellikleri paneli de gizlensin onla beraber"). Bar açılınca
     unfoldItemBarFromBar gerçekten bilinçli şekilde geri getirir. */
  if (!document.body.classList.contains('bar-collapsed-ui')) {
    showPanel(itemBarEl);
    prepareFloatingPanel(itemBarEl);
  } else if (itemBarEl.hidden) {
    /* Panel bar katlıyken sahnede görünmez — tucked işaretle ki bar
       açıldığında çubuğun yanından (unfold) geri gelsin. */
    itemBarEl.dataset.tucked = '1';
  }
  if (isPanelVisible(impWheelEl)) positionImpWheel();
  itemBarEl.classList.toggle('multi', its.length > 1);
  itemBarTitleEl.textContent = its.length > 1 ? its.length + ' image' : 'Image';
  const groupBtn = $('#btnItemGroup');
  if (groupBtn) {
    const grouped = !!selectedGroupId();
    groupBtn.disabled = selection.size < 2;
    groupBtn.title = groupBtn.disabled
      ? 'Group at least two items (G)'
      : grouped
        ? 'Ungroup (G)'
        : 'Group the selected items (G)';
    groupBtn.setAttribute('aria-pressed', grouped ? 'true' : 'false');
  }

  const pct = Math.round(alphaOf(it) * 100);
  if (document.activeElement !== itemAlphaEl) itemAlphaEl.value = String(pct);
  syncRangeFill(itemAlphaEl);
  alphaValEl.textContent = pct + '%';
  if (fGrayEl && document.activeElement !== fGrayEl) fGrayEl.value = String(it.fGray || 0);
  if (fBrightEl && document.activeElement !== fBrightEl) fBrightEl.value = String(it.fBright === undefined ? 100 : it.fBright);
  if (fContrastEl && document.activeElement !== fContrastEl) fContrastEl.value = String(it.fContrast === undefined ? 100 : it.fContrast);
  if (fTempEl && document.activeElement !== fTempEl) fTempEl.value = String(Number(it.fTemp) || 0);
  const tempNow = Number(it.fTemp) || 0;
  if (fTempValEl) fTempValEl.textContent = (tempNow > 0 ? '+' : '') + tempNow;
  if (fGrayValEl) fGrayValEl.textContent = String(Number(it.fGray) || 0) + '%';
  if (fBrightValEl) fBrightValEl.textContent = Math.round((it.fBright === undefined ? 100 : Number(it.fBright)) - 100) + '%';
  if (fContrastValEl) fContrastValEl.textContent = Math.round((it.fContrast === undefined ? 100 : Number(it.fContrast)) - 100) + '%';
  if (fOpacityValEl) fOpacityValEl.textContent = '%' + pct;
  if (btnImageFlipH) btnImageFlipH.setAttribute('aria-pressed', it.flipH ? 'true' : 'false');
  if (btnImageFlipV) btnImageFlipV.setAttribute('aria-pressed', it.flipV ? 'true' : 'false');
  /* Programatik slider değeri atamaları 'input' olayı üretmez; dolgu
     CSS'i burada da tazelenmeli ki seçim değişince eski grafik kalmasın. */
  if (typeof syncImageSliderFills === 'function') syncImageSliderFills();
  updateCropPxOutputs(it);
  if (cropTopEl) cropTopEl.value = String(it.cropTop || 0);
  if (cropRightEl) cropRightEl.value = String(it.cropRight || 0);
  if (cropBottomEl) cropBottomEl.value = String(it.cropBottom || 0);
  if (cropLeftEl) cropLeftEl.value = String(it.cropLeft || 0);
  const paletteBlocked = its.every(item => item.paletteGenerated);
  btnPalette.disabled = paletteBlocked;
  btnPalette.classList.toggle('is-blocked', paletteBlocked);
  btnPalette.dataset.tooltip = paletteBlocked
    ? __t('A new palette cannot be created from the palette image')
    : __t('Pick 10 key colors from different hues and values of the photo');
  // "Arrange" en az iki öğe ister; boyutlar korunur, aralar eşit boşluk olur.
  const arrangeBlocked = selection.size < 2;
  btnArrange.disabled = arrangeBlocked;
  btnArrange.classList.toggle('is-blocked', arrangeBlocked);
  btnArrange.dataset.tooltip = arrangeBlocked
    ? __t('Select at least two items to arrange')
    : __t('Arrange the selected images with small gaps between them, keeping their sizes');
  /* Dışa aktarma tek bir fotoğraf için anlamlı: düzenlenmemiş fotoğraflar
     kaynak baytlarıyla, kırpma/filtre/çizim varsa görünen sonuçla yazılır.
     Birden fazla görsel seçiliyken düğme kapalıdır. */
  if (btnExportImageEl) {
    const exportBlocked = its.length !== 1;
    btnExportImageEl.disabled = exportBlocked;
    btnExportImageEl.classList.toggle('is-blocked', exportBlocked);
    btnExportImageEl.title = exportBlocked
      ? 'Select a single photo to export'
      : 'Export the selected photo as PNG with crop, filter, drawing and rotation';
  }
  const selGid = selectedGroupId();
  const anyImportant = selGid ? isGroupImportant(selGid) : its.some(i => i.important);
  btnImportant.setAttribute('aria-pressed', anyImportant ? 'true' : 'false');
  const impColor = selGid
    ? (isGroupImportant(selGid) ? groupImpColor(selGid) : '')
    : (its.find(i => i.important) ? impColorOf(its.find(i => i.important)) : '');
  if (impColor) itemBarEl.style.setProperty('--imp', impColor);
  else itemBarEl.style.removeProperty('--imp');

  if (typeof updateInspector === 'function') updateInspector();
  if (typeof inkSyncScopeVisual === 'function') inkSyncScopeVisual();
}

/* Dil değişince seçim çubuğu tooltip'leri (dinamik yazım) tazelensin. */
if (window.L10N && window.L10N.onChange) {
  window.L10N.onChange(() => { try { updateItemBar(); } catch { /* sessiz */ } });
}
