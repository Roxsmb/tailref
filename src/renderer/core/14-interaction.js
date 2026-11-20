/* TailRef app · duplicate, drag, resize, rotate, marquee */
'use strict';

function duplicateSelection() {
  if (!selection.size) return;
  pushUndo();
  const newSel = [];
  const groupMap = new Map();
  if (!state.groupParents) state.groupParents = {};

  // eski grup zincirini yeni kimliklerle eşle (iç içe gruplar korunur)
  const mapChain = oldGid => {
    if (groupMap.has(oldGid)) return groupMap.get(oldGid);
    const chain = [];
    let g = oldGid;
    const seen = new Set();
    while (g && !seen.has(g)) { seen.add(g); chain.push(g); g = groupParentOf(g); }
    let parent = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const og = chain[i];
      if (!groupMap.has(og)) groupMap.set(og, 'g_' + newId());
      const ng = groupMap.get(og);
      if (parent) state.groupParents[ng] = parent;
      if (state.groupTitles && state.groupTitles[og]) state.groupTitles[ng] = state.groupTitles[og];
      if (state.groupImportant && state.groupImportant[og]) state.groupImportant[ng] = state.groupImportant[og];
      parent = ng;
    }
    return groupMap.get(oldGid);
  };

  for (const id of selection) {
    const src = getItem(id);
    if (!src) continue;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = 'it_' + newId();
    copy.x += 24; copy.y += 24;
    copy.z = nextZ();
    if (copy.groupId) copy.groupId = mapChain(copy.groupId);
    state.items.push(copy);
    newSel.push(copy.id);
    // Görsele bağlı çizim katmanları da kopyayla birlikte çoğalır.
    if (typeof inkDuplicateLayers === 'function') inkDuplicateLayers(src.id, copy.id);
  }
  selection = new Set(newSel);
  syncAll();
  scheduleSave();
}

function bringToFront() {
  if (!selection.size) return;
  pushUndo();
  for (const id of selection) {
    const it = getItem(id);
    if (it) it.z = nextZ();
  }
  syncAll();
  scheduleSave();
}

/* Kilit / kilit açma: araç çubuğundaki btnLock ile aynı davranış;
   bağlam menüsünden de erişilebilir olsun diye ortak işleve çıkarıldı. */
function toggleLockSelection() {
  const its = selectedImageItems();
  if (!its.length) return;
  pushUndo();
  const lock = !its.every(it => it.locked);
  its.forEach(it => { it.locked = lock; });
  const btnLock = document.getElementById('btnLock');
  if (btnLock) btnLock.setAttribute('aria-pressed', lock ? 'true' : 'false');
  syncAll();
  scheduleSave();
}

function sendToBack() {
  if (!selection.size) return;
  pushUndo();
  /* Öne getirin aynadaki karşılığı: en küçük z'nin altına, seçimin
     göreli sırasını koruyarak diz (ilk seçilen en altta kalır). Negatif
     z serbest: sıralama yalnızca karşılaştırma yapar. */
  const minZ = state.items.reduce((m, i) => Math.min(m, i.z || 0), 0);
  /* Tıklama sırası (selectionOrder) kopyala/yapıştır ve Ctrl+A gibi
     yollarda güncellenmiyor; eski kimlikler kalınca "arkaya gönder"
     hiçbir şey yapmıyor ya da seçimin yalnız bir kısmını gönderiyordu.
     Önce geçerli tıklama sırası, sonra seçimde kalanlar (kararlı sıra). */
  const ordered = [];
  for (const id of (selectionOrder || [])) {
    if (selection.has(id) && getItem(id) && !ordered.includes(id)) ordered.push(id);
  }
  for (const id of selection) {
    if (!ordered.includes(id) && getItem(id)) ordered.push(id);
  }
  let i = 0;
  for (const id of ordered) {
    const it = getItem(id);
    if (!it) continue;
    it.z = minZ - 1 - i;
    i++;
  }
  syncAll();
  scheduleSave();
}

/* =========================================================
   Ctrl+C/X/V öğe panosu
   Kopyalar orijinal koordinat ve kimlikleriyle saklanır; yeni kimlikler
   yapıştırma anında üretilir, böylece aynı pano defalarca yapıştırılabilir.
   Görsel öğeler imageId ile IndexedDB'deki paylaşımlı kayda referans
   verir; blob kopyalamaya gerek yoktur.
   ========================================================= */
let itemClipboard = [];
let pasteCascade = 0; // art arda yapıştırmalarda +24 ofset birikimi

function copySelectionToClipboard(cut) {
  if (!selection.size) return false;
  const clones = [];
  for (const id of selection) {
    const src = getItem(id);
    if (!src) continue;
    clones.push(JSON.parse(JSON.stringify(src)));
  }
  if (!clones.length) return false;
  itemClipboard = clones;
  pasteCascade = 0;
  if (cut) deleteSelection();
  return true;
}

function pasteItemsFromClipboard() {
  if (!itemClipboard.length) return false;
  /* Metin düzenlemesi açıkken Ctrl+V metnin içine yapıştırmalı;
     öğe panosu devreye girmez (keydown handler'ın typing koruması
     buraya düşmeden iade eder, yine de çifte emniyet). */
  if (typeof editingId !== 'undefined' && editingId) return false;

  pushUndo();
  const groupMap = new Map();
  if (!state.groupParents) state.groupParents = {};

  // eski grup zincirini yeni kimliklerle eşle (duplicateSelection ile aynı desen)
  const mapChain = oldGid => {
    if (groupMap.has(oldGid)) return groupMap.get(oldGid);
    const chain = [];
    let g = oldGid;
    const seen = new Set();
    while (g && !seen.has(g)) { seen.add(g); chain.push(g); g = groupParentOf(g); }
    let parent = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const og = chain[i];
      if (!groupMap.has(og)) groupMap.set(og, 'g_' + newId());
      const ng = groupMap.get(og);
      if (parent) state.groupParents[ng] = parent;
      if (state.groupTitles && state.groupTitles[og]) state.groupTitles[ng] = state.groupTitles[og];
      if (state.groupImportant && state.groupImportant[og]) state.groupImportant[ng] = state.groupImportant[og];
      parent = ng;
    }
    return groupMap.get(oldGid);
  };

  /* Konum: panoda seçim yoksa kopya demetini görünür alanın merkezine
     getir; seçim varsa duplicate paritesi olan +24 ofsele bas. Seçimle
     art arda yapıştırmalar kademeli kayar ki üst üste binme kör olmasın. */
  let dx = 24 + pasteCascade * 24;
  let dy = 24 + pasteCascade * 24;
  if (!selection.size) {
    const c = screenToWorld({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
    const minX = Math.min(...itemClipboard.map(i => i.x || 0));
    const minY = Math.min(...itemClipboard.map(i => i.y || 0));
    dx = c.x - minX;
    dy = c.y - minY;
  }
  pasteCascade++;

  const newSel = [];
  for (const srcClone of itemClipboard) {
    const copy = JSON.parse(JSON.stringify(srcClone));
    const srcId = srcClone.id;
    copy.id = 'it_' + newId();
    copy.x += dx; copy.y += dy;
    copy.z = nextZ();
    if (copy.groupId) copy.groupId = mapChain(copy.groupId);
    state.items.push(copy);
    newSel.push(copy.id);
    // Görsele bağlı çizim katmanları kopyayla gelir. Kaynak kesilip
    // tahtadan silindiyse katmanları ikinci kez çoğaltmamak için
    // yalnızca kaynak hâlâ yaşıyorsa çoğaltılır.
    if (typeof inkDuplicateLayers === 'function' && getItem(srcId)) {
      inkDuplicateLayers(srcId, copy.id);
    }
  }
  selection = new Set(newSel);
  syncAll();
  scheduleSave();
  return true;
}

/* =========================================================
   sürükleme / boyutlandırma / döndürme
   ========================================================= */
let drag = null;
let pendingMove = null;
const MOVE_DRAG_THRESHOLD = 4; // px: bu mesafeden sonra tıklama sürüklemeye dönüşür
let winMoveStart = null;
let dragUiFrame = 0;

// Sürükleme sırasında grup çerçevesi ve panel güncellemelerini kare
// başına bir kez çalıştır. Yüksek Hz'li farelerde her pointermove'da
// layout/paint tetiklenmesi görüntü bozulmasına yol açabiliyordu.
function scheduleDragUI() {
  if (dragUiFrame) return;
  dragUiFrame = requestAnimationFrame(() => {
    dragUiFrame = 0;
    if (!drag) return;
    updateGroupFrame();
  });
}

function cancelDragUI() {
  if (dragUiFrame) cancelAnimationFrame(dragUiFrame);
  dragUiFrame = 0;
}

/* Tutamaç sürüklemesinde geri alma anlık görüntüsü ilk GERÇEK hareketten
   önce alınır. Sadece tıklamak (veya 1-2 px titreme) boş bir geri-alma
   adımı bırakmamalı; eşik geçilince snapshot bir kez yazılır. */
const DRAG_UNDO_THRESHOLD = 2;
function beginDragUndo(current, e) {
  if (current.undoPushed) return true;
  if (Math.hypot(e.clientX - current.sx, e.clientY - current.sy) < DRAG_UNDO_THRESHOLD) return false;
  current.undoPushed = true;
  pushUndo();
  return true;
}

stage.addEventListener('pointerdown', e => {
  pendingMove = null;
  if (editingId) commitEdit();

  /* Askıda kalmış bir DOM metin seçimi (ör. silinen boş yazı öğesinden
     artakalan) Chromium'u kendi native sürüklemesine zorluyordu: marquee
     ve çoklu taşıma pointer akışını öldürüp hayalet sürükleme bırakıyordu.
     Burada temizliyoruz; yazı düzenleme açıkken caret'e dokunmayız. */
  if (!editingId) {
    const sel = document.getSelection ? document.getSelection() : null;
    if (sel && (sel.rangeCount > 1 || !sel.isCollapsed)) sel.removeAllRanges();
  }

  // Panel içindeki bir alan (ör. yazı boyutu kutusu) odakta kalmışsa
  // tuvale dönünce klavye kısayolları yeniden çalışsın.
  const active = document.activeElement;
  if (active && active !== stage &&
      (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) {
    active.blur();
  }
  if (document.activeElement !== stage) stage.focus({ preventScroll: true });

  // Alt + boş alan sürükle = pencereyi taşı (masaüstü, çerçevesiz)
  if (isDesktop && e.altKey && e.button === 0) {
    const onItem = e.target.closest && (e.target.closest('.item') || e.target.closest('.handle'));
    if (!onItem) {
      e.preventDefault();
      const sx = e.screenX, sy = e.screenY;
      window.tailref.getWindowPos().then(pos => {
        winMoveStart = { sx, sy, px: pos[0], py: pos[1] };
        drag = { mode: 'winmove' };
      });
      return;
    }
  }

  // pan
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    e.preventDefault();
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
    stage.classList.add('panning');
    return;
  }
  if (e.button !== 0) return;

  // grup çerçevesinin tutamacı -> grubun tamamını ölçekle
  const gHandleEl = e.target.closest && e.target.closest('.ghandle');
  if (gHandleEl) {
    const frameEl = gHandleEl.closest('.gframe');
    const gid = frameEl && frameEl.dataset.gid;
    const members = gid ? groupItemsDeep(gid) : [];
    if (members.length >= 2) {
      e.preventDefault();
      if (!isGroupActive(gid)) {
        selection = new Set(members.map(m => m.id));
        syncSelection();
      }
      startGroupResize(gid, +gHandleEl.dataset.hx, +gHandleEl.dataset.hy, e);
      return;
    }
  }

  const handleEl = e.target.closest && e.target.closest('.handle');
  if (handleEl && selection.size) {
    const itemEl = handleEl.closest('.item');
    const it = itemEl && getItem(itemEl.dataset.id);
    if (!it) return;
    if (it.locked) return;
    e.preventDefault();
    if (handleEl.dataset.rot === '1') startRotate(it, e);
    else startResize(it, +handleEl.dataset.hx, +handleEl.dataset.hy, e);
    return;
  }

  const itemEl = e.target.closest && e.target.closest('.item');
  if (itemEl) {
    const id = itemEl.dataset.id;
    const it = getItem(id);
    if (!it) return;
    if (editingId === id) return; // yazı düzenleniyor

    if (e.shiftKey || e.ctrlKey) {
      // gruplu öğede Shift/Ctrl + tık: grubun tamamını seç/bırak
      const g = outermostGroupOf(it);
      const ids = g ? groupItemsDeep(g).map(i => i.id) : [id];
      if (ids.every(i => selection.has(i))) {
        ids.forEach(i => selection.delete(i));
      } else {
        ids.forEach(i => { selection.add(i); recordSelection(i); });
      }
    } else {
      // gruplu öğeye tıklanınca en dış grubun tamamı seçilir
      const gid = outermostGroupOf(it);
      const memberIds = gid ? groupItemsDeep(gid).map(i => i.id) : [id];
      if (!selection.has(id) || memberIds.some(m => !selection.has(m))) {
        selection = new Set(memberIds);
        selectionOrder = [];
        memberIds.forEach(m => recordSelection(m));
      } else {
        recordSelection(id);
      }
    }
    syncSelection();
    // Tek basışta seç + sürükle: sürüklemeyi pointer 4px hareket edince
    // başlat. Böylece tek tıklama yalnızca seçer; yeni bir öğeyi ikinci
    // kez basmadan doğrudan sürükleyebilirsin.
    pendingMove = (!it.locked && selection.has(id))
      ? { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY }
      : null;
    return;
  }

  // boş alan -> dikdörtgen seçim
  if (!e.shiftKey && !e.ctrlKey) {
    selection.clear(); selectionOrder = [];
    syncSelection();
  }
  drag = {
    mode: 'marquee',
    sx: e.clientX, sy: e.clientY,
    base: new Set(selection),
  };
  showMarquee(e.clientX, e.clientY);
});

function setItemsDragging(ids, on) {
  for (const id of ids) {
    const el = elMap.get(id);
    if (el) el.classList.toggle('dragging', on);
  }
}

/* Tahtadan (öğelerden/boş alan) başlayan NATIVE sürüklemeleri engelle.
   Chromium buna kalkışırsa pointer olaylarını kendine alıp akışımızı
   öldürür: öğeler yerinde kalır, hayalet görüntü + kararma oluşur.
   Dışarıdan dosya düşürme (dragover/drop) etkilenmez; bu yalnızca
   içeriden başlatılan sürükleme yaşamı kapatır. */
window.addEventListener('dragstart', e => {
  const t = e.target;
  if (t && t.closest && t.closest('.item, #stage, #world')) e.preventDefault();
});

function startMove(e) {
  /* Kilitli öğeler konum değiştirmemeli: çoklu seçimde kilitli bir görsel
     varken diğerini sürüklemek kilidi deliyordu. Yalnız hareket edebilen
     öğeler sürükleme listesine girer; seçim olduğu gibi kalır. */
  const ids = [...selection].filter(id => {
    const it = getItem(id);
    return it && !it.locked;
  });
  if (!ids.length) return;
  pushUndo();
  setItemsDragging(ids, true);
  drag = {
    mode: 'move',
    ids,
    sx: e.clientX, sy: e.clientY,
    start: ids.map(id => {
      const it = getItem(id);
      return { id, x: it.x, y: it.y };
    }),
  };
}

function startResize(it, hx, hy, e) {
  const c = itemCenter(it);
  setItemsDragging([it.id], true);
  drag = {
    mode: 'resize',
    ids: [it.id],
    it,
    hx, hy,
    sx: e.clientX, sy: e.clientY,
    w0: it.w, h0: it.h || 0, rot: it.rot || 0,
    cx: c.x, cy: c.y,
  };
}

function startRotate(it, e) {
  const c = itemCenter(it);
  const p = screenToWorld({ x: e.clientX, y: e.clientY });
  setItemsDragging([it.id], true);
  drag = {
    mode: 'rotate',
    ids: [it.id],
    it,
    sx: e.clientX, sy: e.clientY,
    cx: c.x, cy: c.y,
    rot0: it.rot || 0,
    a0: Math.atan2(p.y - c.y, p.x - c.x),
  };
}

/** Grup çerçevesinden çekince grubun tamamı birlikte büyür/küçülür */
function startGroupResize(gid, hx, hy, e) {
  /* Kilitli üyeler ölçeklenmez; hepsi kilitliyse tutamaç hiç iş yapmaz. */
  const members = groupItemsDeep(gid).filter(it => !it.locked);
  if (!members.length) return;
  const pad = 14;
  const b = boundsOf(groupItemsDeep(gid), 0);
  setItemsDragging(members.map(m => m.id), true);
  drag = {
    mode: 'gresize',
    ids: members.map(m => m.id),
    gid, hx, hy,
    sx: e.clientX, sy: e.clientY,
    f: { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 },
    members: members.map(it => ({
      id: it.id, kind: it.kind,
      x: it.x, y: it.y, w: it.w, h: it.h || 0,
      fontSize: it.fontSize || FONT_SIZE,
    })),
  };
}
function showMarquee(x, y) {
  if (!drag) return;
  const x1 = Math.min(drag.sx, x), y1 = Math.min(drag.sy, y);
  const x2 = Math.max(drag.sx, x), y2 = Math.max(drag.sy, y);
  marqueeEl.style.display = 'block';
  marqueeEl.style.left   = x1 + 'px';
  marqueeEl.style.top    = y1 + 'px';
  marqueeEl.style.width  = (x2 - x1) + 'px';
  marqueeEl.style.height = (y2 - y1) + 'px';
}

window.addEventListener('pointermove', e => {
  if (!drag && pendingMove) {
    if (e.pointerId !== pendingMove.pointerId) return;
    const dx = e.clientX - pendingMove.sx;
    const dy = e.clientY - pendingMove.sy;
    if (Math.hypot(dx, dy) < MOVE_DRAG_THRESHOLD) return;
    const start = pendingMove;
    pendingMove = null;
    // İlk basış noktasını kullan: öğe imlecin altında kalır, sıçrama olmaz.
    startMove({ clientX: start.sx, clientY: start.sy });
  }
  if (!drag) return;

  if (drag.mode === 'winmove') {
    if (winMoveStart) {
      window.tailref.setWindowPos(
        winMoveStart.px + (e.screenX - winMoveStart.sx),
        winMoveStart.py + (e.screenY - winMoveStart.sy)
      );
    }
    return;
  }

  if (drag.mode === 'pan') {
    state.view.x = drag.vx + (e.clientX - drag.sx);
    state.view.y = drag.vy + (e.clientY - drag.sy);
    applyView();
    return;
  }

  if (drag.mode === 'marquee') {
    showMarquee(e.clientX, e.clientY);
    const w1 = screenToWorld({ x: drag.sx, y: drag.sy });
    const w2 = screenToWorld({ x: e.clientX, y: e.clientY });
    const box = {
      x1: Math.min(w1.x, w2.x), y1: Math.min(w1.y, w2.y),
      x2: Math.max(w1.x, w2.x), y2: Math.max(w1.y, w2.y),
    };
    selection = new Set(drag.base);
    for (const it of state.items) {
      const pts = itemCorners(it);
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      if (Math.max(...xs) < box.x1 || Math.min(...xs) > box.x2) continue;
      if (Math.max(...ys) < box.y1 || Math.min(...ys) > box.y2) continue;
      selection.add(it.id);
    }
    syncSelection();
    return;
  }

  if (drag.mode === 'move') {
    const rawDx = (e.clientX - drag.sx) / state.view.scale;
    const rawDy = (e.clientY - drag.sy) / state.view.scale;
    let dx = rawDx, dy = rawDy;
    let lockAxis = null;
    if (e.shiftKey) {
      if (Math.abs(rawDx) > Math.abs(rawDy)) { dy = 0; lockAxis = 'y'; }
      else { dx = 0; lockAxis = 'x'; }
    }

    const place = (ox, oy) => {
      for (const s of drag.start) {
        const it = getItem(s.id);
        if (!it) continue;
        it.x = s.x + dx + ox;
        it.y = s.y + dy + oy;
      }
    };
    place(0, 0);

    // yakındaki kenarlara yapış (Alt basılıysa kapat; aday 9: Snap on
    // board anahtarı '0' ise kalıcı olarak kapalı)
    let snapX = null, snapY = null;
    const snapKapali = e.altKey ||
      (typeof tailrefBoardSnapOn === 'function' && !tailrefBoardSnapOn());
    if (!snapKapali) {
      const movingIds = new Set(drag.start.map(s => s.id));
      const others = state.items.filter(i => !movingIds.has(i.id));
      if (others.length) {
        const moving = drag.start.map(s => getItem(s.id)).filter(Boolean);
        const b = boundsOf(moving, 0);
        snapX = lockAxis === 'x' ? { d: 0, at: 0, o: null } : snapDelta(b, others, 'x');
        snapY = lockAxis === 'y' ? { d: 0, at: 0, o: null } : snapDelta(b, others, 'y');
        if (snapX.d || snapY.d) place(snapX.d, snapY.d);
        showSnapFeedback(b, snapX, snapY, others);
      } else {
        hideSnapFeedback();
      }
    } else {
      hideSnapFeedback();
    }

    for (const s of drag.start) {
      const it = getItem(s.id);
      if (it) updateItemEl(it, elMap.get(it.id));
    }
    scheduleDragUI();
    return;
  }

  if (drag.mode === 'resize') {
    if (!beginDragUndo(drag, e)) return;
    const it = drag.it;
    const hx = drag.hx, hy = drag.hy;
    const r  = drag.rot * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);

    // sabit (karşı) köşe, dünya koordinatında
    const anchorLocalX = -hx * drag.w0 / 2;
    const anchorLocalY = -hy * drag.h0 / 2;
    const ax = drag.cx + anchorLocalX * cos - anchorLocalY * sin;
    const ay = drag.cy + anchorLocalX * sin + anchorLocalY * cos;

    const p = screenToWorld({ x: e.clientX, y: e.clientY });
    const vx =  (p.x - ax) * cos + (p.y - ay) * sin;
    const vy = -(p.x - ax) * sin + (p.y - ay) * cos;

    let nw = drag.w0, nh = drag.h0;
    /* Shift basılıyken görsel HİÇ bozulmaz (kullanıcı isteği: "nerden
       tutup çekersek itsek fotoğraf asla bozulmasın"): köşe tutamacı da,
       KENAR/ORTA tutamaç da uniform ölçek yapar — çekilen aks k uygulanır,
       karşı ucun orta noktası (mevcut hesap) sabit kalır. Alt tuşu yine
       serbest deformasyonu getirir (Shift'ten güçlü). */
    const uniformImage = it.kind === 'image' && !e.altKey &&
      (e.shiftKey || (hx !== 0 && hy !== 0));
    if (uniformImage && drag.h0) {
      const ar = drag.w0 / drag.h0;
      let k = hx !== 0 ? Math.abs(vx) / drag.w0 : Math.abs(vy) / drag.h0;
      k = Math.max(k, MIN_SIZE / Math.max(1, drag.w0), MIN_SIZE / Math.max(1, drag.h0));
      nw = drag.w0 * k;
      nh = drag.h0 * k;
    } else {
      if (hx !== 0) nw = Math.max(MIN_SIZE, Math.abs(vx));
      if (hy !== 0) nh = Math.max(MIN_SIZE, Math.abs(vy));
    }

    // merkez, sabit köşeye göre yeniden konumlanır
    const offX = hx * nw / 2;
    const offY = hy * nh / 2;
    const ncx = ax + offX * cos - offY * sin;
    const ncy = ay + offX * sin + offY * cos;

    it.w = nw;
    it.h = nh;
    it.x = ncx - nw / 2;
    it.y = ncy - nh / 2;
    updateItemEl(it, elMap.get(it.id));
    scheduleDragUI();
    return;
  }

  if (drag.mode === 'gresize') {
    if (!beginDragUndo(drag, e)) return;
    const { hx, hy, f } = drag;
    const p = screenToWorld({ x: e.clientX, y: e.clientY });

    // sabit kenar (karşı taraf), dünya koordinatında
    const ax = hx > 0 ? f.x : hx < 0 ? f.x + f.w : f.x + f.w / 2;
    const ay = hy > 0 ? f.y : hy < 0 ? f.y + f.h : f.y + f.h / 2;

    const sx = hx ? Math.abs(p.x - ax) / f.w : null;
    const sy = hy ? Math.abs(p.y - ay) / f.h : null;
    let k = sx !== null && sy !== null ? Math.max(sx, sy) : (sx !== null ? sx : sy);
    if (e.shiftKey && sx !== null && sy !== null) k = Math.min(sx, sy);

    // hiçbir görsel MIN_SIZE'ın altına düşmesin
    let minK = 0.02;
    for (const m of drag.members) {
      if (m.w) minK = Math.max(minK, MIN_SIZE / m.w);
      if (m.h) minK = Math.max(minK, MIN_SIZE / m.h);
    }
    k = Math.max(k, minK);

    const nw = f.w * k, nh = f.h * k;
    const nx = hx > 0 ? ax : hx < 0 ? ax - nw : ax - nw / 2;
    const ny = hy > 0 ? ay : hy < 0 ? ay - nh : ay - nh / 2;

    // bütün öğeler çerçeveye göre aynı oranda büyür/küçülür
    for (const m of drag.members) {
      const it = getItem(m.id);
      if (!it) continue;
      it.w = m.w * k;
      it.h = m.h * k;
      if (it.kind !== 'image') {
        it.fontSize = clamp(m.fontSize * k, 8, 400);
        it.w = textAutoWidth(it);
      }
      it.x = nx + (m.x - f.x) * k;
      it.y = ny + (m.y - f.y) * k;
      updateItemEl(it, elMap.get(it.id));
    }
    scheduleDragUI();
    return;
  }

  if (drag.mode === 'rotate') {
    if (!beginDragUndo(drag, e)) return;
    const p = screenToWorld({ x: e.clientX, y: e.clientY });
    const a = Math.atan2(p.y - drag.cy, p.x - drag.cx);
    let deg = drag.rot0 + (a - drag.a0) * 180 / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    drag.it.rot = deg;
    updateItemEl(drag.it, elMap.get(drag.it.id));
    scheduleDragUI();
  }
});

function finishPointerDrag() {
  pendingMove = null;
  if (!drag) return null;
  const mode = drag.mode;
  const resizeIds = mode === 'resize' || mode === 'gresize' ? (drag.ids || []).slice() : null;
  cancelDragUI();
  setItemsDragging(drag.ids || [], false);
  drag = null;
  winMoveStart = null;
  stage.classList.remove('panning');
  marqueeEl.style.display = 'none';
  hideSnapFeedback();
  if (mode === 'move' || mode === 'resize' || mode === 'gresize' || mode === 'rotate') {
    updateGroupFrame();
    updateItemBar();
  }
  // Görselin boyutu değişti: bağlı katman tuvallerinin DPR-duyarlı
  // tavanını güncelle ve kırpma grubu önbelleğini tazele (FAZ1-6).
  if (resizeIds && typeof inkRelayoutItemsForResize === 'function') {
    inkRelayoutItemsForResize(resizeIds);
  }
  return mode;
}

window.addEventListener('pointerup', e => {
  const mode = finishPointerDrag();
  if (mode && mode !== 'marquee') scheduleSave();
});
window.addEventListener('pointercancel', () => {
  const mode = finishPointerDrag();
  if (mode && mode !== 'marquee') scheduleSave();
});
