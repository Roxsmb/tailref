/* TailRef app · add files/text, editing, removal */
'use strict';

/* =========================================================
   öğe işlemleri
   ========================================================= */
async function addFiles(fileList, atWorld, options = {}) {
  const all = Array.from(fileList).filter(f => f);
  /* Sessiz yutma bug'ı: video/PDF gibi desteklenmeyen dosyalar hiçbir
     geri bildirim olmadan kayboluyordu. Kullanıcı artık nedenini görür. */
  const skipped = all.filter(f => f.type && !f.type.startsWith('image/'));
  if (skipped.length) {
    try { toast('Only images and GIFs can be added to the board · video support in development', 4200); }
    catch { /* toast yoksa sessiz kalma davranışına geri dön */ }
  }
  const files = all.filter(f => f && f.type && f.type.startsWith('image/'));
  if (!files.length) return;
  const paletteGenerated = !!options.paletteGenerated;

  pushUndo();
  const base = atWorld || screenToWorld({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
  const added = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let entry;
    try {
      entry = await decodeImage(f);
    } catch (e) {
      console.warn('image could not open: ', f.name, e);
      continue;
    }

    const imageId = 'img_' + newId();
    /* Blob yazılıp öğeye bağlanana kadar GC turu denk gelirse görsel
       "sahipsiz" sanılıp silinebilir; sayaç GC'yi bekletir. */
    beginImageWrite();
    try {
      await idbPut('images', imageId, { blob: f, name: f.name || 'pasted.png', savedAt: Date.now() });
      setImgCache(imageId, { img: entry.img, url: entry.url, name: f.name || '' });

      // doğal boyut, ekranın %55'inden büyükse küçült
      let w = entry.img.naturalWidth  || 400;
      let h = entry.img.naturalHeight || 300;
      const maxW = (stage.clientWidth / state.view.scale) * 0.55;
      if (w > maxW) { const k = maxW / w; w *= k; h *= k; }

      const it = {
        id: 'it_' + newId(),
        kind: 'image',
        imageId,
        x: 0, y: 0,
        w, h, rot: 0, z: nextZ(),
      };
      // Üretilen palet görselinden tekrar palet üretilmesini engelle.
      if (paletteGenerated) it.paletteGenerated = true;
      state.items.push(it);
      added.push(it);
    } finally {
      endImageWrite();
    }
  }

  if (!added.length) return;

  // tek görsel: imlecin/tuval merkezinin tam ortasına
  // çoklu görsel: yan yana dizmek yerine boyutlarına dokunmadan kareye yakın blok
  layoutAdded(added, base);

  selection = new Set(added.map(it => it.id));
  syncAll();
  if (added.length > 1) fitItemsIfNeeded(added);
  scheduleSave();
}

/** Görselleri boyutlarını değiştirmeden, kareye en yakın ızgaraya yerleştirir */
function layoutAdded(items, base, gap = 22) {
  const n = items.length;
  if (!n) return;
  if (n === 1) {
    items[0].x = base.x - items[0].w / 2;
    items[0].y = base.y - items[0].h / 2;
    return;
  }

  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const colW = new Array(cols).fill(0);
    const rowH = new Array(rows).fill(0);
    items.forEach((it, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      if (it.w > colW[c]) colW[c] = it.w;
      if (it.h > rowH[r]) rowH[r] = it.h;
    });
    const W = colW.reduce((s, w) => s + w, 0) + gap * (cols - 1);
    const H = rowH.reduce((s, h) => s + h, 0) + gap * (rows - 1);
    const empty = rows * cols - n;
    // kareye yakınlık + boş hücre cezası
    const score = Math.abs(Math.log(W / Math.max(H, 1))) + empty * 0.08;
    if (!best || score < best.score) best = { cols, colW, rowH, W, H, score };
  }

  const { cols, colW, rowH, W, H } = best;
  const top = base.y - H / 2;
  const left = base.x - W / 2;
  items.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    let x = left;
    for (let k = 0; k < c; k++) x += colW[k] + gap;
    let y = top;
    for (let k = 0; k < r; k++) y += rowH[k] + gap;
    it.x = x + (colW[c] - it.w) / 2;
    it.y = y + (rowH[r] - it.h) / 2;
  });
}

/** Blok ekrana sığmıyorsa görünümü bloğa sığdır (yakınlaştırmaz) */
function fitItemsIfNeeded(items, padding = 70) {
  if (!items.length) return;
  const b = boundsOf(items, 0);
  const vw = stage.clientWidth, vh = stage.clientHeight;
  const s = clamp(
    Math.min((vw - padding * 2) / Math.max(b.w, 1), (vh - padding * 2) / Math.max(b.h, 1)),
    MIN_SCALE, MAX_SCALE
  );
  if (s >= state.view.scale) return;
  state.view.scale = s;
  state.view.x = vw / 2 - (b.x + b.w / 2) * s;
  state.view.y = vh / 2 - (b.y + b.h / 2) * s;
  applyView();
}

function decodeImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

function addText(worldPos) {
  pushUndo();
  /* Aday 7: kullanıcı varsayılanları (punto/aile) — anahtar yoksa
     mevcut davranış (FONT_SIZE + CSS ailesi). */
  const textDefs = (typeof window.tailrefTextDefaults === 'function')
    ? window.tailrefTextDefaults() : { size: FONT_SIZE, family: '' };
  const it = {
    id: 'it_' + newId(),
    kind: 'text',
    text: '',
    x: worldPos.x, y: worldPos.y,
    w: 260, h: 44, rot: 0, z: nextZ(),
    fontSize: textDefs.size, color: '#ffffff', bold: false, bg: 'rgba(0,0,0,.35)',
  };
  if (textDefs.family) it.fontFamily = textDefs.family;
  state.items.push(it);
  selection = new Set([it.id]);
  syncAll();
  /* Yeni yazının eklenmesi zaten pushUndo ile kaydedildi; ilk tuşta
     ikinci bir "boş yazı" adımı açılmasın. */
  startEdit(it, { fresh: true });
}

function startEdit(it, options = {}) {
  const el = elMap.get(it.id);
  if (!el) return;
  editingId = it.id;
  /* Metin düzenlemesi geri alınabilir olmalı: ilk gerçek girişte
     (beforeinput) düzenleme ÖNCESİ durum yığına yazılır. Yeni eklenen
     yazıda bu gerekmez (ekleme adımı zaten var). */
  textEditUndoId = options.fresh ? null : it.id;
  if (typeof setAddTool === 'function') setAddTool('text');
  el.classList.add('editing');
  const t = el.querySelector('.text');
  t.contentEditable = 'true';
  // preventScroll şart: sahne kaydırılırsa tuval görsel olarak kayar.
  t.focus({ preventScroll: true });
  const r = document.createRange();
  r.selectNodeContents(t);
  r.collapse(false);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
  /* Enter = commit, Shift+Enter = satır sonu (çizim programı kalıbı).
     Daha önce Enter içeriğe kendi halinde yeni satır düşürüyor, editör
     açık kalıyordu; naif kullanıcı yazıyı bitiremiyordu. */
  if (!t.dataset.enterBound) {
    t.dataset.enterBound = '1';
    t.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        commitEdit();
      }
    });
  }
  updateInspector();

}

function commitEdit() {
  if (!editingId) return;
  const id = editingId;
  const it = getItem(id);
  const el = elMap.get(id);
  const t = el && el.querySelector('.text');
  editingId = null;
  textEditUndoId = null;
  if (t) {
    if (document.activeElement === t) t.blur();
    t.contentEditable = 'false';
  }
  if (it && it.kind === 'text' && !(it.text || '').trim()) {
    removeItems([id], false, { toTrash: false });
  } else if (el) {
    el.classList.remove('editing');
  }
  updateInspector();
}

function removeItems(ids, save = true, options = {}) {
  const list = [...new Set(ids)].filter(id => getItem(id));
  if (!list.length) return;
  if (save) pushUndo();

  const set = new Set(list);
  const toTrash = options.toTrash !== false;
  const now = Date.now();
  const batchId = 'tb_' + newId();
  const removedLinks = (Array.isArray(state.links) ? state.links : [])
    .filter(link => set.has(link.from) || set.has(link.to));
  let flew = false;

  if (toTrash) {
    for (const id of list) {
      const it = getItem(id);
      const el = elMap.get(id);
      state.trash.push(makeTrashEntry(it, now, batchId, removedLinks));
      if (el) {
        const flying = it.kind === 'image' && flyItemToTrash(it, el);
        if (flying) flew = true;
        elMap.delete(id);
        if (!flying) retireItemEl(el);
        else el.remove();
      }
    }
  } else {
    for (const id of list) {
      const el = elMap.get(id);
      if (el) {
        elMap.delete(id);
        retireItemEl(el);
      }
    }
  }

  state.items = state.items.filter(i => !set.has(i.id));
  if (typeof inkHandleItemsRemoved === 'function') inkHandleItemsRemoved(set);
  for (const id of list) selection.delete(id);
  // silinen öğelere bağlı okları temizle
  if (Array.isArray(state.links)) {
    state.links = state.links.filter(l => !set.has(l.from) && !set.has(l.to));
  }
  pruneGroups();
  syncAll();
  if (toTrash) {
    showTrashDock();
    updateTrashUI(true);
    if (!flew) pulseTrashDock('catch');
  }
  if (save) scheduleSave();
}

function deleteSelection() {
  if (!selection.size) return;
  /* Kilit sözleşmesi: kilitli görsel taşınamaz, ölçeklenemez — silinmesi de
     beklenmez. Delete tuşu, öğe çubuğu ve sağ tık menüsü hep buradan geçer;
     kilitliler atlanır ve kullanıcı uyarılır (yanlışlıkla veri kaybı olmaz). */
  const locked = [];
  const free = [];
  for (const id of selection) {
    const it = getItem(id);
    if (!it) continue;
    (it.locked ? locked : free).push(id);
  }
  if (locked.length) {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice(locked.length === 1
        ? 'Locked image: unlock it to delete.'
        : locked.length + ' locked images: unlock them to delete.', 2600);
    }
    if (!free.length) return;
  }
  removeItems(free, true);
}

/* =========================================================
   ÇÖP KUTUSU
   Silinen öğeler burada bekler; süresi dolunca görsel blob'u
   ile birlikte kalıcı olarak temizlenir.
   ========================================================= */
const trashDockEl = $('#trashDock');
const btnTrashDockEl = $('#btnTrashDock');
const trashCountEl = $('#trashCount');
const trashPanelEl = $('#trashPanel');
const trashListEl = $('#trashList');
const trashEmptyEl = $('#trashEmpty');
const trashTitleEl = $('#trashTitle');
const trashRetentionLabelEl = $('#trashRetentionLabel');
const btnTrashRestoreAllEl = $('#btnTrashRestoreAll');
const btnTrashPurgeEl = $('#btnTrashPurge');
const btnTrashCloseEl = $('#btnTrashClose');
const trashRetentionSelectEl = $('#trashRetention');
const trashHeadEl = trashPanelEl ? trashPanelEl.querySelector('.trashHead') : null;

const imageLoadPromises = new Map();
let trashClockTimer = null;
let trashGcTimer = null;
let trashPulseTimer = null;
let trashRenderedSignature = '';
let trashIdleTimer = null;
const TRASH_IDLE_MS = 7000;
const TRASH_PANEL_POS_KEY = 'tailref-trash-panel-pos';
let trashPanelPos = null;
try {
  const savedPos = JSON.parse(localStorage.getItem(TRASH_PANEL_POS_KEY) || 'null');
  if (savedPos && Number.isFinite(savedPos.left) && Number.isFinite(savedPos.top)) {
    trashPanelPos = { left: savedPos.left, top: savedPos.top };
  }
} catch { /* sessiz */ }
