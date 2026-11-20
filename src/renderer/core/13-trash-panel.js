/* TailRef app · trash panel position, restore, purge, drag */
'use strict';

function positionTrashPanel(forceDefault = false) {
  if (!trashPanelEl || trashPanelEl.hidden || !btnTrashDockEl) return;
  const margin = 12;
  const gap = 12;
  const bottomReserve = 88;
  const dockRect = btnTrashDockEl.getBoundingClientRect();
  const width = Math.min(360, innerWidth - margin * 2);
  const rawHeight = trashPanelEl.offsetHeight || 380;
  /* Diğer yüzen paneller gibi üst/alt dock sınırları içinde kal. */
  const topLimit = floatingTopLimit();
  const bottomLimit = floatingBottomLimit();
  const availableHeight = Math.max(220, bottomLimit - topLimit);
  let left;
  let top;
  let panelHeight;

  if (forceDefault) {
    trashPanelPos = null;
    persistTrashPanelPosition();
  }

  if (trashPanelPos) {
    panelHeight = Math.min(rawHeight, availableHeight);
    const clamped = clampTrashPanelPosition(trashPanelPos.left, trashPanelPos.top, width, panelHeight);
    left = clamped.left;
    top = clamped.top;
    trashPanelPos = clamped;
  } else {
    panelHeight = Math.min(rawHeight, Math.max(220, bottomLimit - bottomReserve - topLimit));
    const right = Math.max(margin, innerWidth - dockRect.right);
    top = Math.max(topLimit, innerHeight - bottomReserve - panelHeight);
    const candidate = {
      left: innerWidth - right - width,
      right: innerWidth - right,
      top,
      bottom: top + panelHeight,
    };
    const barVisible = itemBarEl && !itemBarEl.hidden && isPanelVisible(itemBarEl);
    const barRect = barVisible ? itemBarEl.getBoundingClientRect() : null;
    left = candidate.left;
    if (barRect &&
        candidate.left < barRect.right && candidate.right > barRect.left &&
        candidate.top < barRect.bottom && candidate.bottom > barRect.top) {
      const leftOfBar = barRect.left - gap;
      if (leftOfBar - width >= margin) left = leftOfBar - width;
    }
  }

  trashPanelEl.style.left = Math.max(margin, Math.min(left, innerWidth - width - margin)) + 'px';
  trashPanelEl.style.right = 'auto';
  trashPanelEl.style.top = Math.max(topLimit, top) + 'px';
  trashPanelEl.style.bottom = 'auto';
  trashPanelEl.style.width = width + 'px';
  const maxHeightLimit = trashPanelPos ? bottomLimit : bottomLimit - bottomReserve + margin;
  trashPanelEl.style.maxHeight = Math.max(220, maxHeightLimit - Math.max(topLimit, top)) + 'px';
}

function openTrashPanel() {
  if (!trashPanelEl) return;
  showTrashDock(false);
  updateTrashUI(true);
  showPanel(trashPanelEl);
  requestAnimationFrame(() => {
    positionTrashPanel();
    requestAnimationFrame(() => positionTrashPanel());
  });
  if (btnTrashDockEl) btnTrashDockEl.setAttribute('aria-expanded', 'true');
}

function closeTrashPanel() {
  if (!trashPanelEl) return;
  hidePanel(trashPanelEl);
  if (btnTrashDockEl) btnTrashDockEl.setAttribute('aria-expanded', 'false');
  scheduleTrashIdle();
}

function toggleTrashPanel() {
  if (isPanelVisible(trashPanelEl)) closeTrashPanel();
  else openTrashPanel();
}

function restoreTrashGroups(groups) {
  if (!Array.isArray(groups) || !groups.length) return;
  if (!state.groupParents) state.groupParents = {};
  if (!state.groupTitles) state.groupTitles = {};
  if (!state.groupImportant) state.groupImportant = {};
  for (const group of groups) {
    if (!group || !group.id) continue;
    if (!(group.id in state.groupParents) && group.parent) state.groupParents[group.id] = group.parent;
    if (!state.groupTitles[group.id] && group.title) state.groupTitles[group.id] = group.title;
    if (!state.groupImportant[group.id] && group.important) state.groupImportant[group.id] = group.important;
  }
}

function restoreTrashLinks(links) {
  if (!Array.isArray(links) || !links.length) return;
  if (!Array.isArray(state.links)) state.links = [];
  for (const link of links) {
    if (!link || !getItem(link.from) || !getItem(link.to)) continue;
    if (linkExists(link.from, link.to)) continue;
    state.links.push({ id: link.id || 'lk_' + newId(), from: link.from, to: link.to });
  }
}

async function restoreTrashEntries(ids) {
  const wanted = new Set(ids);
  const entries = state.trash.filter(entry => wanted.has(entry.id));
  if (!entries.length) return 0;

  const imageIds = [...new Set(entries
    .filter(entry => entry.item.kind === 'image')
    .map(entry => entry.item.imageId))];
  const readyImages = new Set();
  await Promise.all(imageIds.map(async imageId => {
    try {
      await ensureImageCached(imageId);
      readyImages.add(imageId);
    } catch { /* görsel verisi bulunamadı */ }
  }));

  const restorable = entries.filter(entry =>
    entry.item.kind !== 'image' || readyImages.has(entry.item.imageId));
  if (!restorable.length) {
    alert('Data of the trashed images was not found; could not restore.');
    return 0;
  }

  /* Tahtada zaten duran kayıtlar için geri getirilecek bir şey yok.
     Bunları sessizce temizle ve boş bir geri-alma adımı bırakma. */
  const fresh = restorable.filter(entry => !getItem(entry.item.id));
  if (!fresh.length) {
    const staleIds = new Set(restorable.map(entry => entry.id));
    state.trash = state.trash.filter(entry => !staleIds.has(entry.id));
    scheduleSave();
    updateTrashUI(true);
    return 0;
  }

  pushUndo();
  const restoredIds = new Set(restorable.map(entry => entry.id));
  state.trash = state.trash.filter(entry => !restoredIds.has(entry.id));
  const restored = [];
  for (const entry of restorable) {
    if (getItem(entry.item.id)) continue;
    const item = JSON.parse(JSON.stringify(entry.item));
    item.z = nextZ();
    state.items.push(item);
    restored.push({ item, entry });
    restoreTrashGroups(entry.groups);
    restoreTrashLinks(entry.links);
  }

  if (!restored.length) {
    scheduleSave();
    updateTrashUI(true);
    return 0;
  }
  
  // Geri getirme, geri al (Ctrl+Z) ile aynı görünsün: syncAll yeni öğeleri
  // .item-enter sınıfıyla yerinde belirir (kademeli fade + hafif yukarı
  // kayma + büyüme). Çöpten uçuş animasyonu kaldırıldı.
  selection = new Set(restored.map(r => r.item.id));
  selectionOrder = restored.map(r => r.item.id);
  syncAll();

  pulseTrashDock('restore');
  updateTrashUI(true);
  scheduleSave();
  return restored.length;
}

async function restoreAllTrash() {
  return restoreTrashEntries(state.trash.map(entry => entry.id));
}

async function purgeAllTrash() {
  if (!state.trash.length) return;
  const count = state.trash.length;
  if (!(await appConfirm(__t('Permanently delete the {n} items in the trash?', { n: count })))) return;
  pushUndo();
  state.trash = [];
  // Çöp tamamen boşaltıldı: öksüz kalan görsele bağlı çizim katmanlarını sil.
  if (typeof inkPruneOrphanLayers === 'function') {
    inkPruneOrphanLayers();
    inkSyncDom();
    // FAZ 8.A: prune artık 'remove' olayı yayıyor — abone paneli taşır.
  }
  updateTrashUI(true);
  scheduleSave();
  scheduleGcImages(10000);
}

if (btnTrashDockEl) btnTrashDockEl.onclick = toggleTrashPanel;
if (btnTrashCloseEl) btnTrashCloseEl.onclick = closeTrashPanel;
if (btnTrashRestoreAllEl) btnTrashRestoreAllEl.onclick = () => restoreAllTrash();
if (btnTrashPurgeEl) btnTrashPurgeEl.onclick = () => purgeAllTrash();

/* Escape açık çöp panelini kapatır (uygulama geneli kural: Esc en üstteki
   UI'ı iptal eder). Olay burada yutulur; aksi hâlde tahta dinleyicisi de
   Esc'i görüp seçimi temizlerdi. Metin düzenlemesi sürüyorsa Esc önce onu
   bitirir (panel açıkken tahtada yazı düzenlenebilir). Onay penceresi ana
   süreçte açıldığından buraya tuş ulaşmaz. */
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!trashPanelEl || !isPanelVisible(trashPanelEl)) return;
  const ae = document.activeElement;
  const isTextField = ae && (
    ae.isContentEditable ||
    ae.tagName === 'TEXTAREA' ||
    (ae.tagName === 'INPUT' &&
      !/^(range|checkbox|radio|button|submit|reset|color|file)$/i.test(ae.type || 'text'))
  );
  if (isTextField) return;
  event.preventDefault();
  event.stopPropagation();
  closeTrashPanel();
});

/* Dock 7 sn dokunulmazsa yumuşakça çekilir; sağ-alt sıcak bölgeye
   fare girince veya dock'a odaklanınca geri gelir. */
if (trashDockEl) {
  trashDockEl.addEventListener('pointerenter', () => showTrashDock());
  trashDockEl.addEventListener('pointerleave', () => {
    if (!trashDockEl.contains(document.activeElement)) scheduleTrashIdle();
  });
  trashDockEl.addEventListener('focusin', () => showTrashDock());
  trashDockEl.addEventListener('focusout', () => scheduleTrashIdle());
  trashDockEl.addEventListener('pointerdown', () => showTrashDock());
}

let trashPointerInHotZone = false;
document.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch' || !trashDockEl) return;
  const inside = trashDockHotZone(event.clientX, event.clientY);
  if (!inside) {
    trashPointerInHotZone = false;
    return;
  }
  if (!trashPointerInHotZone || trashDockEl.classList.contains('is-idle')) {
    trashPointerInHotZone = true;
    showTrashDock();
  }
}, { passive: true });
if (trashListEl) {
  trashListEl.addEventListener('click', event => {
    const button = event.target.closest('[data-trash-restore]');
    if (!button) return;
    restoreTrashEntries([button.dataset.trashRestore]);
  });
}
document.addEventListener('pointerdown', event => {
  if (!isPanelVisible(trashPanelEl)) return;
  if (trashPanelEl.contains(event.target) || trashDockEl.contains(event.target)) return;
  closeTrashPanel();
});

/* Çöp panelini başlığından sürükle; konum hatırlanır.
   Başlığa çift tıklamak varsayılan sağ-alt konuma döndürür. */
/* Sürükleme/kapatma mantığı bu dosyada kaldığı için panel
   floatingPanelSelector'e eklenmez; ancak diğer yüzen panellerle aynı
   davranışı gösterir: -webkit-app-region:no-drag (style.css) ve tıklanınca
   öne alma. Böylece çöp paneli pencere sürükleme şeridine girip
   kaybolamaz. */
if (trashPanelEl) {
  trashPanelEl.dataset.floatingPanel = 'true';
  trashPanelEl.addEventListener('pointerdown', () => raiseFloatingPanel(trashPanelEl), true);
}
let trashPanelDrag = null;
if (trashHeadEl && trashPanelEl) {
  const moveTrashPanelDrag = event => {
    if (!trashPanelDrag || event.pointerId !== trashPanelDrag.pointerId) return;
    const dx = event.clientX - trashPanelDrag.startX;
    const dy = event.clientY - trashPanelDrag.startY;
    if (!trashPanelDrag.moved && Math.abs(dx) + Math.abs(dy) > 3) trashPanelDrag.moved = true;
    const margin = 12;
    const width = trashPanelEl.offsetWidth;
    /* Sürükleme sırasında da üst/alt dock sınırları geçerli: panel pencere
       sürükleme şeridine girerse tıklama pencereyi taşıyor ve panel bir daha
       tutulamıyordu. */
    const height = trashPanelEl.offsetHeight;
    const topLimit = floatingTopLimit();
    const bottomLimit = floatingBottomLimit();
    const maxTop = Math.max(topLimit, bottomLimit - height);
    const left = clamp(trashPanelDrag.left + dx, margin, Math.max(margin, innerWidth - width - margin));
    const top = clamp(trashPanelDrag.top + dy, topLimit, maxTop);
    trashPanelPos = { left, top };
    trashPanelEl.style.left = left + 'px';
    trashPanelEl.style.top = top + 'px';
    trashPanelEl.style.right = 'auto';
    trashPanelEl.style.bottom = 'auto';
    trashPanelEl.style.maxHeight = Math.max(220, bottomLimit - top) + 'px';
    event.preventDefault();
  };
  const endTrashPanelDrag = event => {
    if (!trashPanelDrag) return;
    if (event && event.pointerId !== undefined && event.pointerId !== trashPanelDrag.pointerId) return;
    const moved = trashPanelDrag.moved;
    trashPanelDrag = null;
    trashPanelEl.classList.remove('is-dragging');
    window.removeEventListener('pointermove', moveTrashPanelDrag);
    window.removeEventListener('pointerup', endTrashPanelDrag);
    window.removeEventListener('pointercancel', endTrashPanelDrag);
    if (moved) {
      positionTrashPanel();
      persistTrashPanelPosition();
    }
  };
  trashHeadEl.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !isPanelVisible(trashPanelEl) || trashPanelDrag) return;
    if (event.target.closest('button,input,select,textarea,a,[contenteditable="true"]')) return;
    const rect = trashPanelEl.getBoundingClientRect();
    trashPanelDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    trashPanelEl.classList.add('is-dragging');
    showTrashDock(false);
    window.addEventListener('pointermove', moveTrashPanelDrag, { passive: false });
    window.addEventListener('pointerup', endTrashPanelDrag);
    window.addEventListener('pointercancel', endTrashPanelDrag);
    event.preventDefault();
    event.stopPropagation();
  });
  trashHeadEl.addEventListener('dblclick', event => {
    if (event.target.closest('button')) return;
    positionTrashPanel(true);
    showTrashDock(false);
  });
}

window.addEventListener('resize', () => {
  if (isPanelVisible(trashPanelEl)) positionTrashPanel();
});
