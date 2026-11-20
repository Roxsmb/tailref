/* TailRef app · context menu, PNG export, text drawing */
'use strict';

const contextMenuEl = $('#contextMenu');

function hideContextMenu() {
  hidePanel(contextMenuEl, () => {
    if (contextMenuEl.hidden) contextMenuEl.replaceChildren();
  });
}

function enhanceIconButton(button, icon) {
  if (!button || !icon || button.querySelector('.toolIcon')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('toolIcon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${icon}`);
  svg.appendChild(use);
  button.prepend(svg);
}

function setButtonLabel(button, label) {
  if (!button) return;
  // Yeni araç çubuğunda etiket ayrı bir .tlabel içinde; onu güncelle.
  const labelEl = button.querySelector('.tlabel');
  if (labelEl) { labelEl.textContent = label; return; }
  const icon = button.querySelector('.toolIcon');
  button.replaceChildren(...(icon ? [icon] : []), document.createTextNode(label));
}

function renderContextMenu(items, x, y) {
  contextMenuEl.replaceChildren();
  showPanel(contextMenuEl);
  const title = document.createElement('div');
  title.className = 'floatingPanelHead contextMenuHead';
  title.textContent = 'Canvas menu';
  contextMenuEl.appendChild(title);
  let rowIndex = 0;
  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'menuDivider';
      separator.setAttribute('role', 'separator');
      contextMenuEl.appendChild(separator);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menuItem';
    button.setAttribute('role', 'menuitem');
    button.disabled = !!item.disabled;
    button.style.setProperty('--row-index', String(Math.min(rowIndex++, 10)));
    button.setAttribute('aria-label', [item.label, item.shortcut].filter(Boolean).join(', '));
    enhanceIconButton(button, item.icon);
    const label = document.createElement('span');
    label.className = 'menuLabel';
    label.textContent = item.label;
    button.append(label);
    if (item.shortcut) {
      const shortcut = document.createElement('kbd');
      shortcut.textContent = item.shortcut;
      button.append(shortcut);
    }
    button.addEventListener('click', () => {
      hideContextMenu();
      item.action();
    });
    contextMenuEl.appendChild(button);
  }
  contextMenuEl.style.left = `${Math.max(8, Math.min(x, innerWidth - contextMenuEl.offsetWidth - 8))}px`;
  contextMenuEl.style.top = `${Math.max(8, Math.min(y, innerHeight - contextMenuEl.offsetHeight - 8))}px`;
  prepareFloatingPanel(contextMenuEl, false);
  contextMenuEl.querySelector('.menuItem:not(:disabled)')?.focus();
}

function openContextMenu(x, y, target = null) {
  const itemEl = target && target.closest ? target.closest('.item') : null;
  if (itemEl) {
    const id = itemEl.dataset.id;
    if (id && !selection.has(id)) {
      selection = new Set([id]);
      syncSelection();
    }
  }
  const hasSelection = selection.size > 0;
  const selectedImages = selectedImageItems();
  const clickedItem = itemEl && itemEl.dataset.id ? getItem(itemEl.dataset.id) : null;
  const clickedImage = clickedItem && clickedItem.kind === 'image' ? clickedItem : null;
  renderContextMenu([
    { label: 'Add image…', shortcut: 'Ctrl+O', icon: 'image', action: () => fileInput.click() },
    { label: 'Text add', shortcut: 'T', icon: 'type', action: () => addText(screenToWorld({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 })) },
    { separator: true },
    { label: 'Fit selected', shortcut: 'F', icon: 'fit', disabled: !hasSelection, action: () => frameSelection() },
    // Mod değişimi yalnızca sağdaki segment ve Ctrl/Cmd+1–2 ile yapılır;
    // bağlam menüsünde ikinci bir giriş noktası tutulmaz.
    { label: __t('Fit whole board'), icon: 'fit', action: () => fitAll() },
    { label: __t('Actual size'), shortcut: '1', icon: 'zoom', action: () => zoomTo100() },
    { separator: true },
    { label: __t('Duplicate'), shortcut: 'Ctrl+D', icon: 'copy', disabled: !hasSelection, action: () => duplicateSelection() },
    { label: __t('Copy'), shortcut: 'Ctrl+C', icon: 'copy', disabled: !hasSelection, action: () => copySelectionToClipboard(false) },
    { label: __t('Paste'), shortcut: 'Ctrl+V', icon: 'paste', disabled: !itemClipboard.length, action: () => pasteItemsFromClipboard() },
    { label: __t('Bring forward'), shortcut: 'B', icon: 'front', disabled: !hasSelection, action: () => bringToFront() },
    { label: __t('Send to back'), shortcut: 'Shift+B', icon: 'back', disabled: !hasSelection, action: () => sendToBack() },
    { label: __t('Group / ungroup'), shortcut: 'G', icon: 'group', disabled: selection.size < 2, action: () => groupSelection() },
    { label: __t('Link / unlink'), shortcut: 'L', icon: 'link', disabled: selectedImages.length < 2, action: () => toggleLink() },
    { label: __t('Lock / unlock'), icon: 'lock', disabled: !selectedImages.length, action: () => toggleLockSelection() },
    { label: __t('Delete'), shortcut: 'Del', icon: 'trash', disabled: !hasSelection, action: () => deleteSelection() },
  ], x, y);
}

stage.addEventListener('contextmenu', e => {
  e.preventDefault();
  openContextMenu(e.clientX, e.clientY, e.target);
});
document.addEventListener('pointerdown', e => {
  if (isPanelVisible(contextMenuEl) && !contextMenuEl.contains(e.target)) hideContextMenu();
});
contextMenuEl.addEventListener('keydown', e => {
  const items = [...contextMenuEl.querySelectorAll('.menuItem:not(:disabled)')];
  const index = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
  }
});

/* =========================================================
   zoom
   ========================================================= */
stage.addEventListener('wheel', e => {
  /* Vuruş koruması: kalem çizerken öbür elden gelen tekerlek tahtayı
     zoom/pan ediyordu — canlı vuruşun ekran→dünya eşlemesi kayıp
     vuruş yamuluyordu. Canlı vuruşta tekerlek yutulur. */
  if (typeof inkPointer !== 'undefined' && (inkPointer || inkTransform)) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  /* Sektör standardı tekerlek tercihi (15 Kasım): varsayılan zoom
     (mevcut davranış); "Zoom with scroll wheel" kapalıysa tekerlek
     görünümü kaydırır (Krita/CSP pan). Ctrl her zaman zoom.
     "Natural scroll direction" açıkken deltaY/DeltaX tersine çevrilir. */
  const dir = (typeof tailrefWheelInvert === 'function' && tailrefWheelInvert()) ? -1 : 1;
  if (!e.ctrlKey && typeof tailrefWheelZoom === 'function' && !tailrefWheelZoom()) {
    state.view.x -= e.deltaX * dir;
    state.view.y -= e.deltaY * dir;
    applyView();
    scheduleSave();
    return;
  }
  const factor = Math.exp(-e.deltaY * dir * (e.deltaMode === 1 ? 0.05 : 0.0015));
  zoomAt({ x: e.clientX, y: e.clientY }, factor);
}, { passive: false });

/* =========================================================
   çift tık
   ========================================================= */
stage.addEventListener('dblclick', e => {
  // Alt basılıyken (renk örnekleme/büyüteç) asla metin yazma yeri açma:
  // hızlı klikler çift tık sayılsa bile.
  if (e.altKey) { e.preventDefault(); return; }
  const itemEl = e.target.closest && e.target.closest('.item');
  if (itemEl) {
    const it = getItem(itemEl.dataset.id);
    // yazıya çift tık -> düzenle, görsele çift tık -> üstüne yazı ekle
    if (it && it.kind === 'text') { startEdit(it); return; }
  }
  
  addText(screenToWorld({ x: e.clientX, y: e.clientY }));
});

/* =========================================================
   klavye
   ========================================================= */
/* Ok tuşuyla kaydırma tek bir geri-alma adımına toplanır: tuş basılı
   tutulduğunda her keydown ayrı snapshot üretip yığını dolduruyordu.
   900 ms içindeki ardışık kaydırmalar aynı adımda birleşir; araya başka
   bir geri-alınabilir işlem girerse (yığın boyu değişir) yeni adım açılır. */
let nudgeUndoDepth = -1;
let nudgeUndoAt = 0;
function pushNudgeUndo() {
  const now = Date.now();
  if (nudgeUndoDepth === undoStack.length && now - nudgeUndoAt < 900) {
    nudgeUndoAt = now;
    return;
  }
  pushUndo();
  nudgeUndoDepth = undoStack.length;
  nudgeUndoAt = now;
}

window.addEventListener('keydown', e => {
  // Çizim modu açıkken tahta kısayolları (sil, grupla, bağla, PNG...)
  // çalışmaz. Yalnızca pencere düzeyindeki F11 geçer. Çizim kısayolları
  // kendi dinleyicilerinde (30/36-ink-*) işlenir.
  if (typeof modeIsDraw === 'function' && modeIsDraw() && e.key !== 'F11') return;
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault();
    openContextMenu(innerWidth / 2, innerHeight / 2);
    return;
  }
  if (e.key === 'F11') {
    e.preventDefault();
    if (window.tailref && window.tailref.toggleFullscreen) window.tailref.toggleFullscreen();
    return;
  }
  // Fırça kütüphanesi açıkken tahta kısayolları (sil, grupla, bağla) ve
  // Escape arkadaki panelleri kapatmasın.
  const nativeBrushRoot = document.getElementById('nativeBrushLibrary');
  if (nativeBrushRoot && !nativeBrushRoot.hidden) return;
  if (e.key === 'Escape' && isPanelVisible(contextMenuEl)) {
    e.preventDefault();
    hideContextMenu();
    stage.focus({ preventScroll: true });
    return;
  }
  /* Export modalı açıkken Escape modalı kapatmalı (X butonunun
     "Close (Esc)" etiketiyle sözü bu). Odak formun içinde değilse
     form düzeyindeki dinleyici ateşlenmez; pencere düzeyinde yakala. */
  if (e.key === 'Escape' && exportUi.bound && exportUi.els && !exportUi.els.modal.hidden) {
    e.preventDefault();
    exportHide();
    return;
  }
  if (e.key === 'Escape' && window.tailref && window.tailref.isFullscreen) {
    window.tailref.isFullscreen().then(full => {
      if (full && window.tailref.toggleFullscreen) window.tailref.toggleFullscreen();
    }).catch(() => {});
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  const typing = editingId && document.activeElement &&
                 document.activeElement.classList.contains('text');

  if (typing) {
    if (e.key === 'Escape') { e.preventDefault(); commitEdit(); }
    return;
  }

  const ae = document.activeElement;
  // Yalnızca metin girişi kısayolları yutar. Kaydırıcı, onay kutusu veya
  // düğme odakta kaldığında Ctrl+Z / Ctrl+A gibi kısayollar çalışmaya devam
  // etmeli; aksi hâlde fırça panelindeki bir kaydırıcıya dokunduktan sonra
  // geri al sessizce ölüyordu.
  const isTextField = ae && (
    ae.isContentEditable ||
    ae.tagName === 'TEXTAREA' ||
    (ae.tagName === 'INPUT' &&
      !/^(range|checkbox|radio|button|submit|reset|color|file)$/i.test(ae.type || 'text'))
  );
  if (isTextField) {
    if (e.key === 'Escape') { ae.blur(); syncSelection(); }
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  const isButtonFocused = ae && ae.closest &&
    ae.closest('button, a, [role="button"]');
  if (isButtonFocused && !mod) return;

  if (e.code === 'Space') {
    spaceDown = true;
    stage.classList.add('space');
    e.preventDefault();
    return;
  }

  /* Faz 3a: tahta kombinasyonları (Ctrl+Z/Y/A/D/S/E/O) keymap 'board'
     grubundan çözülür; keymap yoksa eski hardcoded tuşlar geçerli kalır
     (parite). Ctrl+Shift+Z paritesi: shift'li basış redo yapar (pose3d
     kalıbı). Ctrl+0/+/-/T zoom ve panel kısayolları sabittir. */
  const modKey = (mod && e.key && e.key.length === 1) ? e.key.toLowerCase() : '';
  let boardModAct = '';
  if (modKey) {
    if (window.tailrefKeymap) {
      boardModAct = window.tailrefKeymap.actionFor('ctrl+' + modKey, 'board');
    } else {
      const legacyMap = {
        z: 'board.undo', y: 'board.redo', a: 'board.selectAll',
        d: 'board.duplicate', s: 'board.save', e: 'board.export', o: 'board.open',
        c: 'board.copy', x: 'board.cut', v: 'board.paste',
      };
      boardModAct = legacyMap[modKey] || '';
    }
  }

  if (boardModAct === 'board.undo') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (boardModAct === 'board.redo') { e.preventDefault(); redo(); return; }
  if (boardModAct === 'board.selectAll') {
    e.preventDefault();
    selection = new Set(state.items.map(i => i.id));
    syncSelection();
    return;
  }
  if (boardModAct === 'board.duplicate') { e.preventDefault(); duplicateSelection(); return; }
  if (boardModAct === 'board.copy') { e.preventDefault(); copySelectionToClipboard(false); return; }
  if (boardModAct === 'board.cut') { e.preventDefault(); copySelectionToClipboard(true); return; }
  /* Öğe panosu boşken Ctrl+V'i native'e bırak: işletim sistemi panosundaki
     görsel 'paste' olayı üzerinden tahtaya düşer. */
  if (boardModAct === 'board.paste') {
    const pasted = pasteItemsFromClipboard();
    if (pasted) e.preventDefault();
    return;
  }
  if (boardModAct === 'board.save') {
    /* Ctrl+Shift+S 3D yakalamaya ayrıldı (src/app/22-init.js). */
    if (e.shiftKey) return;
    e.preventDefault();
    /* Manuel modda Ctrl+S .tail dosyasına kaydeder; otomatik modda IndexedDB'ye. */
    if (isPersistenceAuto()) {
      /* Otomatik modda Ctrl+S eskiden görünür bir geri bildirim vermiyordu:
         kullanıcı kaydedildi mi diye emin olamıyordu. */
      Promise.resolve(saveNow()).then(() => {
        try { showProjectNotice(__t('Saved to this device.'), 1800); }
        catch { /* sessiz */ }
      }).catch(() => { /* hata saveNow içinde bildirilir */ });
    } else {
      saveAsTail();
    }
    return;
  }
  if (boardModAct === 'board.export') { e.preventDefault(); openExportDialog(); return; }
  if (boardModAct === 'board.open') {
    e.preventDefault();
    /* Manuel modda Ctrl+O .tail dosyası açar; otomatik modda görsel içe aktarır. */
    if (isPersistenceAuto()) fileInput.click();
    else openTailFile();
    return;
  }
  // Zoom: Ctrl/Cmd + 0 sıfırla, + yakınlaştır, − uzaklaştır
  if (mod && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) {
    e.preventDefault(); zoomTo100(); return;
  }
  if (mod && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) {
    e.preventDefault(); zoomByFactor(ZOOM_STEP); return;
  }
  if (mod && (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')) {
    e.preventDefault(); zoomByFactor(1 / ZOOM_STEP); return;
  }
  if (mod && e.key.toLowerCase() === 't') {
    // Çizim modunda Ctrl+T serbest dönüştürmedir; tahta paneli kısayolu
    // yalnızca referans modunda çalışır.
    if (typeof modeIsDraw === 'function' && modeIsDraw()) return;
    e.preventDefault();
    if (toggleTop) toggleTop();
    return;
  }

  /* Geriye gönder: 'b' tek tuş keymap'te "Öne getir"e bağlı; imza motoru
     shift bileşimlerini temsil edemediğinden Shift+B sabit kısayoldur
     (layers grubundaki Shift+N paritesi). */
  if (e.shiftKey && !mod && (e.key === 'B' || e.key === 'b')) {
    e.preventDefault();
    sendToBack();
    return;
  }

  /* Tur 4b: tahta tek tuşları keymap tablosundan çözülür
     (TODO-4b-keymap.md §4). Eski switch anahtarları eylem id'lerine
     döner; varsayılan tuşlar birebir aynı davranışı üretir. Ctrl/Shift
     bileşim akışları yukarıda zaten iade edildiği/ele alındığı için
     çözüm koşulu bilerek aynıdır (Ctrl+G gibi akışlar korunur). */
  let boardAction = '';
  if (window.tailrefKeymap && e.key && e.key.length === 1) {
    boardAction = window.tailrefKeymap.actionFor(e.key.toLowerCase(), 'board');
  }

  switch (boardAction || e.key) {
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      deleteSelection();
      break;
    case 'Escape':
      selection.clear(); selectionOrder = [];
      syncSelection();
      closeStudioPanel(helpEl);
      break;
    case 'board.fit':
      if (selection.size) frameSelection();
      else fitAll();
      break;
    case 'board.toggleBar':
      toggleBarManually();
      break;
    case 'board.zoom100':
      zoomTo100();
      break;
    case 'board.addText': {
      const c = screenToWorld({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
      addText(c);
      break;
    }
    case 'board.help':
      openStudioPanel(helpEl);
      break;
    case 'board.bringFront':
      bringToFront();
      break;
    case 'board.group':
      groupSelection();
      break;
    case 'board.link':
      toggleLink();
      break;
    case 'board.important': {
      if (!selection.size) break;
      pushUndo();
      // grup seçili: sadece grup çizgileri kırmızı olur
      const gid = selectedGroupId();
      if (gid) {
        setGroupImportant(gid, !isGroupImportant(gid));
        scheduleSave();
        updateItemBar();
        break;
      }
      const on = ![...selection].every(id => { const i = getItem(id); return i && i.important; });
      const color = on ? randomImpColor() : '';
      for (const id of selection) {
        const it = getItem(id);
        if (!it) continue;
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
      scheduleSave();
      updateItemBar();
      updateGroupFrame();
      break;
    }
    case 'board.bgLeft':
      setBg(state.bg - 0.1);
      break;
    case 'board.bgRight':
      setBg(state.bg + 0.1);
      break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      if (!selection.size) break;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      /* Kilitli görseller ok tuşuyla da oynamamalı (sürüklemedeki kilitle
         aynı sözleşme); yalnız hareket edebilenler kaydırılır. */
      const movable = [];
      for (const id of selection) {
        const it = getItem(id);
        if (it && !it.locked) movable.push(it);
      }
      if (!movable.length) break;
      pushNudgeUndo();
      for (const it of movable) {
        it.x += dx; it.y += dy;
        updateItemEl(it, elMap.get(it.id));
      }
      updateItemBar();
      updateGroupFrame();
      scheduleSave();
      break;
    }
  }
});

window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    spaceDown = false;
    stage.classList.remove('space');
  }
});
window.addEventListener('blur', () => {
  spaceDown = false;
  stage.classList.remove('space');
});

/* =========================================================
   pano + sürükle-bırak
   ========================================================= */
window.addEventListener('paste', e => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    addFiles(files, null);
  }
});

stage.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

stage.addEventListener('drop', e => {
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (files && files.length) {
    addFiles(files, screenToWorld({ x: e.clientX, y: e.clientY }));
  }
});

/* =========================================================
   PNG dışa aktarma
   ========================================================= */
function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para) { out.push(''); continue; }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width > maxW && line.trim()) {
        out.push(line.replace(/\s+$/, ''));
        line = w.replace(/^\s+/, '');
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/* Dışa aktarma çekirdeği: kapsam + kenar boşluğu + hedef boyut + arka
   plan → tuval. PNG düğmesi detaylı Dışa Aktar penceresini açar;
   önizleme ve indirme aynı hattı kullanır. */
const EXPORT_MAX_PX = 16000;

function exportComputeBounds(scope, sketchOnly) {
  if (sketchOnly) {
    const ib = typeof inkGlobalWorldBounds === 'function' ? inkGlobalWorldBounds() : null;
    if (!ib || ib.w < 1 || ib.h < 1) return null;
    return { items: [], b: { x: ib.x, y: ib.y, w: ib.w, h: ib.h } };
  }
  if (scope === 'viewport') {
    const vw = stage.clientWidth, vh = stage.clientHeight;
    const s = Math.max(1e-4, Number(state.view.scale) || 1);
    const b = {
      x: (0 - state.view.x) / s,
      y: (0 - state.view.y) / s,
      w: vw / s,
      h: vh / s,
    };
    return { items: state.items, b };
  }
  const secili = scope === 'selection' && selection.size > 0;
  const items = secili ? state.items.filter(i => selection.has(i.id)) : state.items;
  const hasInk = typeof inkViewportStrokeCount === 'function' && inkViewportStrokeCount() > 0;
  if (!items.length && !hasInk) return null;
  const b = boundsOf(items, 0);
  // Sadece çizim varsa veya notlar görsellerin dışına taşıyorsa tuvali büyüt.
  // (Seçim varsa dışa aktarım seçili öğelerle sınırlı kalır.)
  if (!secili && typeof inkGlobalWorldBounds === 'function') {
    const ib = inkGlobalWorldBounds();
    if (ib) {
      const x0 = Math.min(b.x, ib.x);
      const y0 = Math.min(b.y, ib.y);
      const x1 = Math.max(b.x + b.w, ib.x + ib.w);
      const y1 = Math.max(b.y + b.h, ib.y + ib.h);
      b.x = x0; b.y = y0; b.w = x1 - x0; b.h = y1 - y0;
    }
  }
  if (b.w < 1 || b.h < 1) return null;
  return { items, b };
}

/* Verilen öğe listesini ve dünya dikdörtgenini tuvale çizer. Dışa
   aktarma kapsamları ile ayrı penceredeki canlı referans görüntüsü aynı
   çizim hattını paylaşır. opts: {includeInk, pad, finalW, finalH, bg, bgColor} */
async function renderExportCanvas(items, b, opts) {
  const pad = opts.pad | 0;

  // Dışa aktarımda görsel eksik kalmasın: seçili görselleri önbelleğe al.
  await Promise.all(items
    .filter(it => it.kind === 'image' && it.imageId)
    .map(it => ensureImageCached(it.imageId).catch(() => null)));

  const W = Math.max(1, Math.ceil(b.w + pad * 2));
  const H = Math.max(1, Math.ceil(b.h + pad * 2));
  const k = Math.min(opts.finalW / W, opts.finalH / H, EXPORT_MAX_PX / Math.max(W, H));

  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(W * k);
  canvas.height = Math.round(H * k);
  const ctx = canvas.getContext('2d');
  ctx.scale(k, k);

  if (opts.bg === 'white') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
  } else if (opts.bg === 'custom') {
    ctx.fillStyle = opts.bgColor || '#ffffff';
    ctx.fillRect(0, 0, W, H);
  } else if (opts.bg === 'board') {
    const bgA = typeof state.bg === 'number' ? state.bg : 1;
    if (bgA > 0.01) {
      ctx.fillStyle = `rgba(21,21,26,${bgA})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Global çizim katmanları: alttakiler görsellerden önce, üsttekiler sonra.
  if (opts.includeInk !== false && typeof inkDrawGlobalForExport === 'function') inkDrawGlobalForExport(ctx, b, pad, 'below');

  for (const it of [...items].sort(byZ)) {
    const c = itemCenter(it);
    ctx.save();
    ctx.translate(c.x - b.x + pad, c.y - b.y + pad);
    ctx.rotate((it.rot || 0) * Math.PI / 180);
    /* Ekranla aynı sıra: aynalama döndürülmüş eksende uygulanır
       (06-render'daki scale(±1,±1) ile birebir). */
    ctx.scale(it.flipH ? -1 : 1, it.flipV ? -1 : 1);

    ctx.globalAlpha = alphaOf(it);

    if (it.kind === 'image') {      const cached = imgCache.get(it.imageId);
      if (cached && cached.img) {
        // Ekrandaki hafif yuvarlatılmış köşeler dışa aktarımda da korunur.
        const r = Math.min(3, it.w / 2, it.h / 2);
        ctx.save();
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(-it.w / 2, -it.h / 2, it.w, it.h, r);
        } else {
          const x = -it.w / 2, y = -it.h / 2;
          const w = it.w, h = it.h;
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + w - r, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + r);
          ctx.lineTo(x + w, y + h - r);
          ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          ctx.lineTo(x + r, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.closePath();
        }
        ctx.clip();

        // Ekrandaki kırpma ve filtreleri tuvale de uygula.
        const cropTop = clamp(Number(it.cropTop) || 0, 0, 100) / 100;
        const cropRight = clamp(Number(it.cropRight) || 0, 0, 100) / 100;
        const cropBottom = clamp(Number(it.cropBottom) || 0, 0, 100) / 100;
        const cropLeft = clamp(Number(it.cropLeft) || 0, 0, 100) / 100;
        const cw = it.w * Math.max(0, 1 - cropLeft - cropRight);
        const ch = it.h * Math.max(0, 1 - cropTop - cropBottom);
        if (cw > 0 && ch > 0) {
          const gray = Number(it.fGray) || 0;
          const bright = it.fBright === undefined ? 100 : Number(it.fBright);
          const contrast = it.fContrast === undefined ? 100 : Number(it.fContrast);
          const temp = Number(it.fTemp) || 0;
          const filters = [];
          if (gray) filters.push(`grayscale(${gray}%)`);
          if (temp > 0) {
            filters.push(`sepia(${Math.min(60, temp * 0.6)}%)`);
            filters.push(`saturate(${Math.round(100 + temp * 0.35)}%)`);
          } else if (temp < 0) {
            const t = -temp;
            filters.push(`hue-rotate(${Math.min(30, t * 0.3)}deg)`);
            filters.push(`saturate(${Math.round(100 - t * 0.2)}%)`);
            filters.push(`brightness(${Math.round(100 + t * 0.05)}%)`);
          }
          if (bright !== 100) filters.push(`brightness(${bright}%)`);
          if (contrast !== 100) filters.push(`contrast(${contrast}%)`);
          if (filters.length) ctx.filter = filters.join(' ');
          if (cropTop || cropRight || cropBottom || cropLeft) {
            ctx.beginPath();
            ctx.rect(
              -it.w / 2 + it.w * cropLeft,
              -it.h / 2 + it.h * cropTop,
              cw, ch
            );
            ctx.clip();
          }
          ctx.drawImage(cached.img, -it.w / 2, -it.h / 2, it.w, it.h);
        }
        ctx.restore();
        if (opts.includeInk !== false && typeof inkDrawAttachedForExport === 'function') inkDrawAttachedForExport(ctx, it);
      }
    } else {
      drawTextItem(ctx, it);
    }

    ctx.globalAlpha = 1;

    // "önemli" işaretli öğe: kendi renginde çerçeve
    if (it.important) {
      const w = it.w, h = it.h || 0;
      const impC = impColorOf(it);
      ctx.save();
      ctx.strokeStyle = impC;
      ctx.lineWidth = 4;
      ctx.shadowColor = hexToRgba(impC, 0.7);
      ctx.shadowBlur = 18;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 4);
      else ctx.rect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  if (opts.includeInk !== false && typeof inkDrawGlobalForExport === 'function') inkDrawGlobalForExport(ctx, b, pad, 'above');

  return { canvas, W, H, k };
}

/* Dışa aktarma kapsamından tuval üretir. */
async function renderExportCore(opts) {
  const bilgi = exportComputeBounds(opts.scope, opts.sketchOnly);
  if (!bilgi) return null;
  return renderExportCanvas(bilgi.items, bilgi.b, opts);
}

/* Ayrı panel penceresindeki canlı referans görüntüsü: verilen dünya
   dikdörtgenini hedef piksel boyutunda çizer. Raf görüntüsü panel
   penceresine veri URL'si olarak taşınır. */
async function renderBoardRegion(worldRect, outW, outH, opts) {
  const cfg = opts && typeof opts === 'object' ? opts : {};
  if (!worldRect) return null;
  const w = Number(worldRect.w);
  const h = Number(worldRect.h);
  if (!(w > 0) || !(h > 0)) return null;
  const items = Array.isArray(state.items) ? state.items : [];
  return renderExportCanvas(items, {
    x: Number(worldRect.x) || 0,
    y: Number(worldRect.y) || 0,
    w, h,
  }, {
    pad: 0,
    finalW: Math.max(1, Math.round(Number(outW) || w)),
    finalH: Math.max(1, Math.round(Number(outH) || h)),
    bg: cfg.bg || 'board',
    bgColor: cfg.bgColor || '',
    includeInk: cfg.includeInk !== false,
  });
}

async function renderBoardRegionDataUrl(worldRect, outW, outH, opts) {
  const result = await renderBoardRegion(worldRect, outW, outH, opts);
  if (!result || !result.canvas) return '';
  try { return result.canvas.toDataURL('image/webp', 0.86); } catch { return ''; }
}

/* ---- Dışa Aktar penceresi -------------------------------------------
   Kapsam (tüm pano / seçili / görüş alanı), biçim (PNG/JPEG/WebP),
   ölçek + DPI + belirli boyut, çizim katmanı seçenekleri, arka plan,
   kalite, metadata; canlı önizleme + boyut/dosya tahmini.
   Tercihler localStorage'da hatırlanır. */

const exportUi = {
  els: {}, bound: false, scaleVal: 1, ratio: 1,
  previewToken: 0, previewTimer: 0,
};

const EXPORT_FORMATS = {
  png:  { mime: 'image/png',  ext: 'png', hint: 'Lossless; supports transparent background.' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', hint: 'For photos and small files; no transparency.' },
  webp: { mime: 'image/webp', ext: 'webp', hint: 'As transparent as PNG, as small a file as JPEG.' },
  avif: { mime: 'image/avif', ext: 'avif', hint: 'Modern codec — smallest file; disabled on unsupported builds.' },
  bmp:  { mime: 'image/bmp',  ext: 'bmp', hint: 'Uncompressed raw pixels; almost any program opens them.', enc: 'bmp' },
  ico:  { mime: 'image/x-icon', ext: 'ico', hint: 'Icon file; scaled to at most 256×256.', enc: 'ico' },
  pdf:  { mime: 'application/pdf', ext: 'pdf', hint: 'Embeds the image in the document; for printing and sharing.', enc: 'pdf' },
};

function exportDefaultName() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `tailref-${stamp}`;
}

function exportLoadPrefs() {
  try { return JSON.parse(localStorage.getItem('tailref:export:v1') || '{}'); } catch { return {}; }
}

function exportSavePrefs(p) {
  try { localStorage.setItem('tailref:export:v1', JSON.stringify(p)); } catch { /* yoksay */ }
}

function exportBoyutYazisi(bayt) {
  if (bayt < 1024) return `${Math.round(bayt)} B`;
  if (bayt < 1024 * 1024) return `${Math.round(bayt / 1024)} KB`;
  return `${(bayt / (1024 * 1024)).toFixed(1)} MB`;
}

/* Kayıt klasörü satırını exportUi.saveDir'e göre çizer. */
function exportKayitKlasoruYaz() {
  const els = exportUi.els;
  if (!els || !els.dirText) return;
  els.dirText.textContent = exportUi.saveDir || 'Browser default';
  els.dirText.title = exportUi.saveDir || '';
  els.dirText.classList.toggle('is-empty', !exportUi.saveDir);
  els.dirClear.hidden = !exportUi.saveDir;
}

/* Klasörü ayarlar + prefs'e hemen yazar (aktarmadan bağımsız kalsın). */
function exportKayitKlasoruAyarla(dir) {
  exportUi.saveDir = dir || '';
  exportKayitKlasoruYaz();
  try { exportSavePrefs({ ...exportLoadPrefs(), saveDir: exportUi.saveDir }); } catch { /* yoksay */ }
}

/* Kalite parametresi yalnızca bu biçimlerde anlamlı. */
const EXPORT_QUALITY_RE = /jpeg|webp|avif/;

function exportFormatDestekli(format) {
  if (format !== 'avif') return true;
  if (exportUi.avifDestek === undefined) {
    try {
      exportUi.avifDestek = document.createElement('canvas')
        .toDataURL('image/avif').indexOf('data:image/avif') === 0;
    } catch { exportUi.avifDestek = false; }
  }
  return exportUi.avifDestek;
}

/* Aktif biçimi baytlara çevirir: kaliteli biçimler toBlob kullanır,
   BMP/ICO/PDF özel kodlayıcıdan geçer. */
function exportEncode(canvas, format, quality) {
  const f = EXPORT_FORMATS[format];
  if (f && f.enc === 'bmp') return canvasToBmpBlob(canvas);
  if (f && f.enc === 'ico') return canvasToIcoBlob(canvas);
  if (f && f.enc === 'pdf') return canvasToPdfBlob(canvas);
  return new Promise(res => canvas.toBlob(res, f.mime, quality));
}

function exportBind() {
  if (exportUi.bound) return true;
  const modal = document.getElementById('exportModal');
  if (!modal) return false;
  const form = modal.querySelector('#exportForm');
  const q = sel => modal.querySelector(sel);
  const els = {
    modal, form,
    pcanvas: q('#exPreviewCanvas'),
    info: q('#exInfo'),
    w: q('#exW'), h: q('#exH'), lock: q('#exLock'),
    exactRow: q('#exExactRow'),
    qualityRow: q('#exQualityRow'), quality: q('#exQuality'), qualityVal: q('#exQualityVal'),
    scaleGroup: q('#exScaleGroup'), dpiGroup: q('#exDpiGroup'),
    padGroup: q('#exPadGroup'),
    inkLayer: q('#exInkLayer'), sketchOnly: q('#exSketchOnly'),
    meta: q('#exMeta'), metaWrap: q('#exMetaWrap'),
    bgColor: q('#exBgColor'),
    formatHint: q('#exFormatHint'),
    name: q('#exName'),
    dirText: q('#exDirText'), dirBtn: q('#exDirBtn'), dirClear: q('#exDirClear'),
    advBtn: q('#exAdvBtn'),
    chipDim: q('#exChipDim'), chipFmt: q('#exChipFmt'), chipSize: q('#exChipSize'),
    download: q('#exDownload'),
    close: q('#exClose'),
    tileSel: q('#exTileSel'), tileSelSub: q('#exTileSelSub'),
  };
  if (!els.pcanvas || !els.download) return false;
  els.pctx = els.pcanvas.getContext('2d');
  exportUi.els = els;

  // Son tercihler
  const prefs = exportLoadPrefs();
  /* Eski sürüm kaydı (pad yok): beyaz arka plan kalıntısını temizle —
     varsayılan "fotoğraf neyse o" olsun. */
  if (prefs.pad === undefined) prefs.bg = 'transparent';
  const setRadio = (name, val) => {
    const el = form.querySelector(`input[name="${name}"][value="${val}"]`);
    if (el) el.checked = true;
  };
  if (prefs.format && EXPORT_FORMATS[prefs.format]) setRadio('exFormat', prefs.format);
  if (prefs.bg) setRadio('exBg', prefs.bg);
  if (Number.isFinite(prefs.quality)) els.quality.value = String(prefs.quality);
  els.qualityVal.textContent = `%${els.quality.value}`;
  els.scaleVal = 1;
  exportUi.scaleVal = Number.isFinite(prefs.scaleVal) ? prefs.scaleVal : 1;
  /* Kenar boşluğu: varsayılan Yok — içerik orijinal boyutuyla çıkar. */
  exportUi.pad = Number.isFinite(prefs.pad) ? Number(prefs.pad) : 0;
  if (prefs.lock === false) els.lock.checked = false;
  els.inkLayer.checked = prefs.inkInclude !== false;
  els.sketchOnly.checked = prefs.sketchOnly === true;
  els.meta.checked = prefs.meta === true && true;
  exportUi.saveDir = typeof prefs.saveDir === 'string' ? prefs.saveDir : '';
  exportKayitKlasoruYaz();

  // AVIF bu Chromium'da kodlanamıyorsa kartı kilitler.
  const avifInp = form.querySelector('input[name="exFormat"][value="avif"]');
  if (avifInp) {
    avifInp.disabled = !exportFormatDestekli('avif');
    const avifKart = avifInp.closest('.exFmt');
    if (avifKart) avifKart.classList.toggle('is-disabled', avifInp.disabled);
    if (avifInp.disabled && avifInp.checked) setRadio('exFormat', 'png');
  }

  // Ölçek + DPI düğmeleri
  els.scaleGroup.addEventListener('click', e => {
    const btn = e.target.closest('button[data-scale]');
    if (!btn) return;
    exportUi.scaleVal = btn.dataset.scale === 'custom' ? null : (Number(btn.dataset.scale) || 1);
    if (exportUi.scaleVal === null) exportBelirliDoldur();
    exportSyncScaleUi();
    exportSchedulePreview();
  });
  els.dpiGroup.addEventListener('click', e => {
    const btn = e.target.closest('button[data-dpi]');
    if (!btn) return;
    exportUi.scaleVal = Number(btn.dataset.dpi) / 72;
    exportSyncScaleUi();
    exportSchedulePreview();
  });
  // Kenar boşluğu düğmeleri (Yok / Az / Normal)
  els.padGroup.addEventListener('click', e => {
    const btn = e.target.closest('button[data-pad]');
    if (!btn) return;
    exportUi.pad = Number(btn.dataset.pad) || 0;
    exportSyncScaleUi();
    exportSchedulePreview();
  });

  // Kayıt klasörü: Gözat → ana süreçte klasör seçme penceresi
  els.dirBtn.addEventListener('click', async () => {
    const api = window.tailref;
    if (!api || typeof api.chooseDirectory !== 'function') return;
    const res = await api.chooseDirectory();
    if (res && res.ok && res.dir) exportKayitKlasoruAyarla(res.dir);
  });
  els.dirClear.addEventListener('click', () => exportKayitKlasoruAyarla(''));

  // Daha fazla ayar: sade ↔ ileri mod
  els.advBtn.addEventListener('click', () => {
    const acik = modal.classList.toggle('is-adv');
    els.advBtn.setAttribute('aria-expanded', acik ? 'true' : 'false');
  });

  form.addEventListener('submit', e => { e.preventDefault(); void exportPerform(); });
  q('#exCancel').addEventListener('click', exportHide);
  els.close.addEventListener('click', exportHide);
  form.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); exportHide(); }
  });
  modal.addEventListener('mousedown', e => { if (e.target === modal) exportHide(); });

  form.addEventListener('change', () => { exportSyncFormatUi(); exportSchedulePreview(); });
  els.quality.addEventListener('input', () => {
    els.qualityVal.textContent = `%${els.quality.value}`;
    exportSchedulePreview();
  });
  els.w.addEventListener('input', () => {
    if (els.lock.checked && exportUi.ratio > 0) {
      els.h.value = String(Math.max(16, Math.round((Number(els.w.value) || 16) / exportUi.ratio)));
    }
    exportSchedulePreview();
  });
  els.h.addEventListener('input', () => {
    if (els.lock.checked) {
      els.w.value = String(Math.max(16, Math.round((Number(els.h.value) || 16) * exportUi.ratio)));
    }
    exportSchedulePreview();
  });
  els.bgColor.addEventListener('input', exportSchedulePreview);

  exportUi.bound = true;
  exportSyncFormatUi();
  exportSyncScaleUi();
  return true;
}

function exportReadFormat() {
  const el = exportUi.els.form.querySelector('input[name="exFormat"]:checked');
  return el ? el.value : 'png';
}

function exportSyncFormatUi() {
  const els = exportUi.els;
  let fmt = exportReadFormat();
  if (!exportFormatDestekli(fmt)) {
    // Desteklenmeyen biçim (ör. AVIF'siz sürüm) → PNG'e dön.
    const pngInp = els.form.querySelector('input[name="exFormat"][value="png"]');
    if (pngInp) pngInp.checked = true;
    fmt = 'png';
  }
  els.formatHint.textContent = EXPORT_FORMATS[fmt].hint;
  els.qualityRow.hidden = !EXPORT_QUALITY_RE.test(fmt);
  const png = fmt === 'png';
  els.meta.disabled = !png;
  els.metaWrap.classList.toggle('is-disabled', !png);
  if (!png) els.meta.checked = false;
  // JPEG saydamlığı desteklemez: saydam seçiliyse beyaza döndür.
  const bgSel = els.form.querySelector('input[name="exBg"]:checked');
  if (fmt === 'jpeg' && bgSel && bgSel.value === 'transparent') {
    els.form.querySelector('input[name="exBg"][value="white"]').checked = true;
  }
  els.bgColor.hidden = !bgSel || bgSel.value !== 'custom';
}

function exportSyncScaleUi() {
  const els = exportUi.els;
  for (const btn of els.scaleGroup.querySelectorAll('button[data-scale]')) {
    const v = btn.dataset.scale;
    const aktif = v === 'custom' ? exportUi.scaleVal === null
      : Math.abs(Number(v) - (exportUi.scaleVal || 0)) < 1e-9;
    btn.classList.toggle('is-active', aktif);
  }
  for (const btn of els.dpiGroup.querySelectorAll('button[data-dpi]')) {
    const dpi = Number(btn.dataset.dpi);
    btn.classList.toggle('is-active',
      exportUi.scaleVal !== null && Math.abs(dpi / 72 - exportUi.scaleVal) < 0.01);
  }
  for (const btn of els.padGroup.querySelectorAll('button[data-pad]')) {
    btn.classList.toggle('is-active', Math.abs((Number(btn.dataset.pad) || 0) - (exportUi.pad || 0)) < 1e-9);
  }
  els.exactRow.hidden = exportUi.scaleVal !== null;
}

function exportReadCfg() {
  const els = exportUi.els;
  const form = els.form;
  const val = name => {
    const el = form.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
  };
  const format = val('exFormat') || 'png';
  let bg = val('exBg') || 'transparent';
  if (format === 'jpeg' && bg === 'transparent') bg = 'white';
  return {
    format,
    scope: val('exScope') || 'all',
    sketchOnly: els.sketchOnly.checked,
    includeInk: els.inkLayer.checked,
    meta: els.meta.checked,
    bg, bgColor: els.bgColor.value,
    scaleVal: exportUi.scaleVal,
    pad: exportUi.pad || 0,
    quality: clamp(Number(els.quality.value) || 92, 50, 100),
    lock: els.lock.checked,
    saveDir: exportUi.saveDir || '',
    name: (els.name.value.trim() || exportDefaultName()),
  };
}

/* Geçerli kapsamın ham boyutu (pad dahil, ölçeksiz). */
function exportBaseDims(cfg) {
  const bilgi = exportComputeBounds(cfg.scope, cfg.sketchOnly);
  if (!bilgi) return null;
  const b = bilgi.b;
  /* Kenar boşluğu: varsayılan 0 (içerik orijinal boyutuyla çıkar). */
  const pad = cfg.scope === 'viewport' ? 0 : (Number(cfg.pad) || 0);
  return {
    pad,
    W0: Math.max(1, Math.ceil(b.w + pad * 2)),
    H0: Math.max(1, Math.ceil(b.h + pad * 2)),
  };
}

/* "Custom size" W×H kutularını geçerli içeriğin gerçek pikseliyle doldurur. */
function exportBelirliDoldur() {
  const els = exportUi.els;
  const temel = exportBaseDims(exportReadCfg());
  if (!temel) return;
  els.w.value = String(temel.W0);
  els.h.value = String(temel.H0);
}

function exportFinalDims(cfg) {
  const temel = exportBaseDims(cfg);
  if (!temel) return null;
  exportUi.ratio = temel.W0 / temel.H0;
  let tw, th;
  if (cfg.scaleVal === null) {
    const twIstenen = Math.round(clamp(Number(exportUi.els.w.value) || temel.W0, 16, EXPORT_MAX_PX));
    const thIstenen = Math.round(clamp(Number(exportUi.els.h.value) || temel.H0, 16, EXPORT_MAX_PX));
    const k = Math.min(twIstenen / temel.W0, thIstenen / temel.H0, EXPORT_MAX_PX / Math.max(temel.W0, temel.H0));
    tw = Math.round(temel.W0 * k); th = Math.round(temel.H0 * k);
  } else {
    const k = Math.min(cfg.scaleVal, EXPORT_MAX_PX / Math.max(temel.W0, temel.H0));
    tw = Math.round(temel.W0 * k); th = Math.round(temel.H0 * k);
  }
  return { pad: temel.pad, W0: temel.W0, H0: temel.H0, tw: Math.max(1, tw), th: Math.max(1, th) };
}

function openExportDialog() {
  if (!exportBind()) return;
  const els = exportUi.els;
  const selVar = selection.size > 0;
  const selInput = els.form.querySelector('input[name="exScope"][value="selection"]');
  selInput.disabled = !selVar;
  els.tileSel.classList.toggle('is-disabled', !selVar);
  els.tileSelSub.textContent = selVar ? `${selection.size} items` : 'No selection';
  if (!selVar && selInput.checked) {
    els.form.querySelector('input[name="exScope"][value="all"]').checked = true;
  }
  if (!els.name.value.trim()) els.name.value = exportDefaultName();
  if (exportUi.scaleVal === null) exportBelirliDoldur();
  /* Sade açılış: ileri kontroller kapalı başlar; yalnız kayıtlı tercihler
     sade düzende görünmüyorsa (özel ölçek / ileri biçim) açık başlat. */
  const kayitliFmt = exportReadFormat();
  const sadeDegil = exportUi.scaleVal === null
    || (![1, 2].includes(exportUi.scaleVal))
    || (kayitliFmt !== 'png' && kayitliFmt !== 'jpeg');
  els.modal.classList.toggle('is-adv', sadeDegil);
  els.advBtn.setAttribute('aria-expanded', sadeDegil ? 'true' : 'false');
  els.modal.hidden = false;
  exportSchedulePreview();
}

function exportHide() {
  exportUi.els.modal.hidden = true;
  exportSavePrefs(exportReadCfg());
}

function exportSchedulePreview() {
  clearTimeout(exportUi.previewTimer);
  exportUi.previewTimer = setTimeout(() => { void exportUpdatePreview(); }, 120);
}

async function exportUpdatePreview() {
  const token = ++exportUi.previewToken;
  const els = exportUi.els;
  const cfg = exportReadCfg();
  const dims = exportFinalDims(cfg);
  if (!dims) {
    els.chipDim.textContent = 'Nothing to export.';
    els.chipFmt.textContent = '—';
    els.chipSize.textContent = '—';
    els.download.disabled = true;
    return;
  }
  els.download.disabled = false;
  const maxSide = 320;
  const kp = Math.min(maxSide / Math.max(dims.tw, dims.th), 1);
  const pvW = Math.max(1, Math.round(dims.tw * kp));
  const pvH = Math.max(1, Math.round(dims.th * kp));
  const sonuc = await renderExportCore({
    scope: cfg.scope, sketchOnly: cfg.sketchOnly, includeInk: cfg.includeInk,
    pad: dims.pad, finalW: pvW, finalH: pvH, bg: cfg.bg, bgColor: cfg.bgColor,
  });
  if (token !== exportUi.previewToken || !sonuc) return;
  els.pcanvas.width = pvW;
  els.pcanvas.height = pvH;
  els.pctx.clearRect(0, 0, pvW, pvH);
  els.pctx.drawImage(sonuc.canvas, 0, 0);
  const kalite = EXPORT_QUALITY_RE.test(cfg.format) ? cfg.quality / 100 : undefined;
  const blob = await exportEncode(sonuc.canvas, cfg.format, kalite);
  if (token !== exportUi.previewToken) return;
  const oran = (dims.tw * dims.th) / Math.max(1, pvW * pvH);
  const tahmin = blob ? blob.size * oran : 0;
  els.chipDim.textContent = `${dims.tw} × ${dims.th} px`;
  els.chipFmt.textContent = cfg.format.toUpperCase();
  els.chipSize.textContent = blob ? `~${exportBoyutYazisi(tahmin)}` : '—';
}

async function exportPerform() {
  const els = exportUi.els;
  const cfg = exportReadCfg();
  const dims = exportFinalDims(cfg);
  if (!dims) { alert('Nothing to export.'); return; }
  els.download.disabled = true;
  try {
    const sonuc = await renderExportCore({
      scope: cfg.scope, sketchOnly: cfg.sketchOnly, includeInk: cfg.includeInk,
      pad: dims.pad, finalW: dims.tw, finalH: dims.th, bg: cfg.bg, bgColor: cfg.bgColor,
    });
    if (!sonuc) { alert('Nothing to export.'); return; }
    const f = EXPORT_FORMATS[cfg.format];
    const kalite = EXPORT_QUALITY_RE.test(cfg.format) ? cfg.quality / 100 : undefined;
    let blob = await exportEncode(sonuc.canvas, cfg.format, kalite);
    if (!blob) { alert('Could not create the file.'); return; }
    if (cfg.format === 'png' && cfg.meta) {
      try { blob = await pngMetadataGom(blob, dims); } catch { /* yalın yaz */ }
    }
    const adi = cfg.name.replace(/[\\/:*?"<>|]+/g, '_');
    const dosyaAdi = adi.toLowerCase().endsWith('.' + f.ext) ? adi : `${adi}.${f.ext}`;
    if (cfg.saveDir && window.tailref && window.tailref.exportImage) {
      /* Seçili klasöre doğrudan yaz (pencere açılmaz). */
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const res = await window.tailref.exportImage(bytes, dosyaAdi, f.mime, cfg.saveDir);
      if (res && res.ok) {
        if (typeof showProjectNotice === 'function') showProjectNotice('Exported: ' + res.file, 4200);
      } else {
        alert('Export failed: ' + (res && res.error ? res.error : 'bilinmeyen hata'));
        return;
      }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = dosyaAdi;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    exportSavePrefs({
      format: cfg.format, bg: cfg.bg, quality: cfg.quality,
      scaleVal: cfg.scaleVal, lock: cfg.lock, pad: cfg.pad, saveDir: cfg.saveDir,
      inkInclude: cfg.includeInk, sketchOnly: cfg.sketchOnly, meta: cfg.meta,
    });
    exportHide();
  } finally {
    els.download.disabled = false;
  }
}

/* Hızlı PNG dışa aktarma: diyalog açmadan tüm panoyu (öğeler + global ve
   bağlı çizim katmanları) PNG olarak indirir. v5Toolbar'ın "png" eylemi
   ve eski exportPNG çağrıları buraya düşer; tercihleri kaydetmez, panoyu
   değiştirmez. Dönen değer: dosya yazıldıysa true. */
async function exportPNG() {
  const bilgi = exportComputeBounds('all', false);
  if (!bilgi) { return false; }
  const b = bilgi.b;
  const sonuc = await renderExportCore({
    scope: 'all', sketchOnly: false, includeInk: true,
    pad: 0,
    finalW: Math.max(1, Math.round(b.w)),
    finalH: Math.max(1, Math.round(b.h)),
    bg: 'transparent',
  });
  if (!sonuc) return false;
  const blob = await exportEncode(sonuc.canvas, 'png', undefined);
  if (!blob) return false;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = exportDefaultName() + '.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}

/* PNG tEXt metadata parçası ekler (IHDR'den sonra). Yalnızca ASCII. */
function pngCrc32(bayt) {
  let c = ~0;
  for (let i = 0; i < bayt.length; i += 1) {
    c ^= bayt[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

async function pngMetadataGom(blob, dims) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const imza = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) if (buf[i] !== imza[i]) return blob;
  const d = new Date();
  const metin = `TailRef Studio | ${d.toISOString()} | ${dims.tw}x${dims.th}px`;
  const veri = new TextEncoder().encode(metin.replace(/[^\x20-\x7E]/g, '?'));
  const tur = new TextEncoder().encode('tEXt');
  const kelime = new TextEncoder().encode('Comment');
  const chunkVeri = new Uint8Array(kelime.length + 1 + veri.length);
  chunkVeri.set(kelime, 0);
  chunkVeri[kelime.length] = 0;
  chunkVeri.set(veri, kelime.length + 1);
  const ihdrSon = 8 + 4 + 4 + 13 + 4; // imza + IHDR uzunluk + tur + veri + crc
  const cikti = new Uint8Array(buf.length + 12 + chunkVeri.length);
  cikti.set(buf.subarray(0, ihdrSon), 0);
  const uz = chunkVeri.length;
  cikti[ihdrSon] = (uz >>> 24) & 255;
  cikti[ihdrSon + 1] = (uz >>> 16) & 255;
  cikti[ihdrSon + 2] = (uz >>> 8) & 255;
  cikti[ihdrSon + 3] = uz & 255;
  cikti.set(tur, ihdrSon + 4);
  cikti.set(chunkVeri, ihdrSon + 8);
  const crcGirdi = new Uint8Array(4 + uz);
  crcGirdi.set(tur, 0);
  crcGirdi.set(chunkVeri, 4);
  const crc = pngCrc32(crcGirdi);
  const crcYeri = ihdrSon + 8 + uz;
  cikti[crcYeri] = (crc >>> 24) & 255;
  cikti[crcYeri + 1] = (crc >>> 16) & 255;
  cikti[crcYeri + 2] = (crc >>> 8) & 255;
  cikti[crcYeri + 3] = crc & 255;
  cikti.set(buf.subarray(ihdrSon), crcYeri + 4);
  return new Blob([cikti], { type: 'image/png' });
}

/* ---- Özel biçim kodlayıcıları ---------------------------------------
   PNG/JPEG/WebP/AVIF tarayıcının toBlob hattından çıkar; BMP, ICO ve
   PDF elle kodlanır (bağımlılık yok, tek dosyalık çıktı). */

/* 32 bit BMP — BITMAPV4 başlığı, alfa kanalı korunur. */
function canvasToBmpBlob(canvas) {
  const w = canvas.width, h = canvas.height;
  const img = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const satirHam = w * 4;
  const pad = (4 - (satirHam % 4)) % 4;
  const satir = satirHam + pad;
  const baslik = 14 + 108; // dosya başlığı + BITMAPV4HEADER
  const veri = satir * h;
  const buf = new Uint8Array(baslik + veri);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x4D; // 'BM'
  dv.setUint32(2, baslik + veri, true);
  dv.setUint32(10, baslik, true);
  dv.setUint32(14, 108, true);          // V4 başlık boyutu
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);             // pozitif = aşağıdan yukarıya
  dv.setUint16(26, 1, true);            // düzlem
  dv.setUint16(28, 32, true);           // bpp
  dv.setUint32(30, 3, true);            // BI_BITFIELDS
  dv.setUint32(34, veri, true);
  dv.setInt32(38, 2835, true);          // 72 DPI
  dv.setInt32(42, 2835, true);
  dv.setUint32(54, 0x00FF0000, true);   // R maskesi
  dv.setUint32(58, 0x0000FF00, true);   // G
  dv.setUint32(62, 0x000000FF, true);   // B
  dv.setUint32(66, 0xFF000000, true);   // A
  dv.setUint32(70, 0x73524742, true);   // LCS 'sRGB'
  for (let y = 0; y < h; y += 1) {
    const kaynak = (h - 1 - y) * satirHam;
    let hedef = baslik + y * satir;
    for (let x = 0; x < w; x += 1) {
      const i = kaynak + x * 4;
      buf[hedef] = img[i + 2];
      buf[hedef + 1] = img[i + 1];
      buf[hedef + 2] = img[i];
      buf[hedef + 3] = img[i + 3];
      hedef += 4;
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

/* ICO — PNG verisini simge kabına gömer; 256px üstü ölçeklenir. */
async function canvasToIcoBlob(canvas) {
  const en = canvas.width, boy = canvas.height;
  const k = Math.min(256 / en, 256 / boy, 1);
  const w = Math.max(1, Math.round(en * k));
  const h = Math.max(1, Math.round(boy * k));
  const kare = document.createElement('canvas');
  kare.width = w; kare.height = h;
  kare.getContext('2d').drawImage(canvas, 0, 0, w, h);
  const pngBlob = await new Promise(res => kare.toBlob(res, 'image/png'));
  const png = new Uint8Array(await pngBlob.arrayBuffer());
  const buf = new Uint8Array(6 + 16 + png.length);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, 0, true);    // rezerve
  dv.setUint16(2, 1, true);    // tür: simge
  dv.setUint16(4, 1, true);    // görüntü adedi
  buf[6] = w >= 256 ? 0 : w;   // 0 = 256
  buf[7] = h >= 256 ? 0 : h;
  buf[8] = 0; buf[9] = 0;      // palet rengi / rezerve
  dv.setUint16(10, 1, true);   // düzlem
  dv.setUint16(12, 32, true);  // bpp
  dv.setUint32(14, png.length, true);
  dv.setUint32(18, 22, true);  // PNG başlangıcı
  buf.set(png, 22);
  return new Blob([buf], { type: 'image/x-icon' });
}

/* PDF 1.4 — tek sayfa, JPEG (DCTDecode) gömülü; 1px = 1pt. */
async function canvasToPdfBlob(canvas) {
  const W = canvas.width, H = canvas.height;
  const jpegBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  const parcalar = [];
  let offset = 0;
  const objOffsets = [];
  const yaz = bayt => { parcalar.push(bayt); offset += bayt.length; };
  const ascii = s => yaz(new TextEncoder().encode(s));

  ascii('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n');
  objOffsets[1] = offset;
  ascii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objOffsets[2] = offset;
  ascii('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objOffsets[3] = offset;
  ascii(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n`);
  objOffsets[4] = offset;
  ascii(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  yaz(jpeg);
  ascii('\nendstream\nendobj\n');
  const icerik = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ`;
  objOffsets[5] = offset;
  ascii(`5 0 obj\n<< /Length ${icerik.length} >>\nstream\n${icerik}\nendstream\nendobj\n`);
  const xrefKonum = offset;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i += 1) xref += `${String(objOffsets[i]).padStart(10, '0')} 00000 n \n`;
  ascii(xref);
  ascii(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefKonum}\n%%EOF\n`);
  return new Blob(parcalar, { type: 'application/pdf' });
}

/* Seçili fotoğrafı dışa aktarır.

   Düzenlenmemiş fotoğraflarda IndexedDB'deki kaynak blob'u yeniden
   kodlanmadan diske yazılır (JPEG/PNG/WebP fark etmez): sıfır kayıp.

   Kırpma, filtre veya görsele bağlı çizim varsa kaynak baytlar ekranda
   görüneni içermez. Özellikle "New canvas" ile oluşturulan beyaz tuvalde
   bütün çizim ayrı bir katmanda durur; ham kaynağı yazmak bomboş bir sayfa
   üretir. Bu durumda öğe, göründüğü gibi kaynak çözünürlüğünde
   düzleştirilip PNG olarak yazılır. */
function imageItemHasVisibleInk(it) {
  if (!it || typeof inkLayersForOwner !== 'function') return false;
  let layers = [];
  try { layers = inkLayersForOwner(it.id); } catch { return false; }
  return layers.some(layer => layer
    && layer.visible !== false
    && !(layer.opacity <= 0.001)
    && Array.isArray(layer.strokes)
    && layer.strokes.length > 0);
}

/** Ham kaynak baytları görünen sonuçtan farklı mı? */
function imageItemNeedsComposite(it) {
  if (!it) return false;
  const cropKeys = ['cropTop', 'cropRight', 'cropBottom', 'cropLeft'];
  if (cropKeys.some(key => (Number(it[key]) || 0) > 0)) return true;
  if ((Number(it.fGray) || 0) > 0) return true;
  if (it.fBright !== undefined && Number(it.fBright) !== 100) return true;
  if (it.fContrast !== undefined && Number(it.fContrast) !== 100) return true;
  return imageItemHasVisibleInk(it);
}

/** Öğeyi kırpma + filtre + bağlı çizim katmanlarıyla kaynak çözünürlüğünde
    (en fazla 8192 px / 40 MP) tek bir tuvale düzleştirir. */
function renderImageItemForExport(it) {
  const cached = imgCache.get(it.imageId);
  const img = cached && cached.img;
  if (!img) return null;

  const naturalW = img.naturalWidth || img.width || 1;
  const naturalH = img.naturalHeight || img.height || 1;
  const baseW = Math.max(1, Number(it.w) || naturalW);
  const baseH = Math.max(1, Number(it.h) || naturalH);
  const cropTop = clamp(Number(it.cropTop) || 0, 0, 100) / 100;
  const cropRight = clamp(Number(it.cropRight) || 0, 0, 100) / 100;
  const cropBottom = clamp(Number(it.cropBottom) || 0, 0, 100) / 100;
  const cropLeft = clamp(Number(it.cropLeft) || 0, 0, 100) / 100;
  const visibleW = Math.max(1, baseW * (1 - cropLeft - cropRight));
  const visibleH = Math.max(1, baseH * (1 - cropTop - cropBottom));

  /* Kaynak piksel yoğunluğunu koru; tuval öğeleri zaten 1:1'dir. */
  let scale = Math.max(1, naturalW / baseW, naturalH / baseH);
  scale = Math.min(
    scale,
    8192 / Math.max(visibleW, visibleH),
    Math.sqrt((40 * 1000 * 1000) / Math.max(1, visibleW * visibleH))
  );
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const W = Math.max(1, Math.round(visibleW * scale));
  const H = Math.max(1, Math.round(visibleH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  /* Kırpılan görünür alanın sol üstü tuvale (0,0) gelsin. */
  ctx.translate(
    (baseW / 2 - baseW * cropLeft) * scale,
    (baseH / 2 - baseH * cropTop) * scale
  );
  ctx.scale(scale, scale);

  const gray = Number(it.fGray) || 0;
  const bright = it.fBright === undefined ? 100 : Number(it.fBright);
  const contrast = it.fContrast === undefined ? 100 : Number(it.fContrast);
  const filters = [];
  if (gray) filters.push(`grayscale(${gray}%)`);
  if (bright !== 100) filters.push(`brightness(${bright}%)`);
  if (contrast !== 100) filters.push(`contrast(${contrast}%)`);

  ctx.save();
  if (filters.length) ctx.filter = filters.join(' ');
  ctx.drawImage(img, -baseW / 2, -baseH / 2, baseW, baseH);
  ctx.restore();

  /* Bağlı çizim katmanları: ekrandaki sıra, opaklık ve karışım aynen. */
  if (typeof inkDrawAttachedForExport === 'function' && typeof inkLayersForOwner === 'function') {
    for (const layer of inkLayersForOwner(it.id)) {
      if (!layer || layer.visible === false || layer.opacity <= 0.001) continue;
      if (!Array.isArray(layer.strokes) || !layer.strokes.length) continue;
      const ready = inkRuntime && inkRuntime.itemCanvases
        ? inkRuntime.itemCanvases.get(layer.id) : null;
      const dirty = !!(inkRuntime && inkRuntime.dirtyLayers && inkRuntime.dirtyLayers.has(layer.id));
      if (typeof inkRebuildItemLayer === 'function' && (!ready || dirty)) {
        inkRebuildItemLayer(layer);
      }
    }
    inkDrawAttachedForExport(ctx, { ...it, w: baseW, h: baseH });
  }

  /* Öğe döndürülmüşse ekrandaki yönelim korunur. */
  const deg = Number(it.rot) || 0;
  if (Math.abs(deg % 360) < 0.0001) return canvas;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const outW = Math.max(1, Math.round(W * cos + H * sin));
  const outH = Math.max(1, Math.round(W * sin + H * cos));
  const rotated = document.createElement('canvas');
  rotated.width = outW;
  rotated.height = outH;
  const rctx = rotated.getContext('2d');
  if (!rctx) return canvas;
  rctx.translate(outW / 2, outH / 2);
  rctx.rotate(rad);
  rctx.drawImage(canvas, -W / 2, -H / 2);
  canvas.width = 0;
  canvas.height = 0;
  return rotated;
}

/** Blob'u masaüstünde kaydetme penceresine (yoksa indirmeye) yazar. */
async function writeImageExport(blob, fileName) {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (window.tailref && window.tailref.exportImage) {
      const res = await window.tailref.exportImage(bytes, fileName, blob.type || '');
      if (res && res.ok) {
        if (typeof showProjectNotice === 'function') showProjectNotice('Exported: ' + res.file, 4200);
        return true;
      }
      if (res && res.canceled) return false;
      alert('Export failed: ' + (res && res.error ? res.error : 'bilinmeyen hata'));
      return false;
    }
    /* Tarayıcı yedeği: aynı blob'u indirir, yeniden kodlama yapmaz. */
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  } catch (error) {
    alert('Export failed: ' + (error && error.message ? error.message : String(error)));
    return false;
  }
}

async function exportSelectedImageLossless() {
  const list = typeof selectedImageItems === 'function' ? selectedImageItems() : [];
  if (list.length !== 1) {
    alert('Select a single photo to export.');
    return false;
  }
  const it = list[0];
  if (!it || !it.imageId) {
    alert('The selected item is not a photo.');
    return false;
  }
  let rec = null;
  try { rec = await idbGet('images', it.imageId); } catch { rec = null; }
  if (!rec || !rec.blob) {
    alert('Photo source not found.');
    return false;
  }
  /* Kullanıcı tuvali yeniden adlandırdıysa görünen ad önceliklidir. */
  const nameSource = String(it.title || it.name || rec.name || 'fotograf');

  if (imageItemNeedsComposite(it)) {
    await ensureImageCached(it.imageId).catch(() => null);
    const canvas = renderImageItemForExport(it);
    if (canvas) {
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) { alert('PNG could not be created.'); return false; }
      const baseName = nameSource.replace(/\.[a-z0-9]+$/i, '') || 'fotograf';
      return writeImageExport(blob, baseName + '.png');
    }
    /* Düzleştirme başarısız olduysa kaynak baytlara düş. */
  }

  return writeImageExport(rec.blob, nameSource);
}

{
  const btnExportImage = document.getElementById('btnExportImage');
  /* Seçim panelindeki "Export" da detaylı pencereyi açar
     (kapsam "Selection Only" olarak hazır gelir). */
  if (btnExportImage) btnExportImage.onclick = () => openExportDialog();
}

function drawTextItem(ctx, it) {
  const pad = 8;
  const fs  = it.fontSize || FONT_SIZE;
  const lh  = fs * 1.3;
  /* Aday 7: öğe ailesi boşsa mevcut varsayılan yığın. */
  const fam = it.fontFamily || 'Inter,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif';
  const font = `${it.bold ? '700' : '400'} ${fs}px ${fam}`;

  ctx.font = font;
  ctx.textBaseline = 'top';

  const lines = wrapLines(ctx, it.text || '', Math.max(20, it.w - pad * 2));
  const h = lines.length * lh + pad * 2;

  ctx.translate(-it.w / 2, -h / 2);
  if (it.bg && it.bg !== 'transparent') {
    ctx.fillStyle = it.bg;
    ctx.fillRect(0, 0, it.w, h);
  }
  ctx.fillStyle = it.color || '#fff';
  lines.forEach((line, i) => {
    ctx.fillText(line, pad, pad + i * lh + (lh - fs) / 2);
  });
}
