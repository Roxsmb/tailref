/* TailRef app · groups, titles, frames, group selection */
'use strict';

/* ---------------- gruplar (iç içe destekli) ---------------- */
function groupMembersOf(gid) {
  return gid ? state.items.filter(i => i.groupId === gid) : [];
}

function groupParentOf(gid) {
  return (state.groupParents && state.groupParents[gid]) || null;
}

function childGroupIds(gid) {
  const out = [];
  for (const [g, p] of Object.entries(state.groupParents || {})) {
    if (p === gid) out.push(g);
  }
  return out;
}

/** Tahtadaki bütün grup kimlikleri (üst gruplar dahil) */
function allGroupIds() {
  const set = new Set();
  for (const it of state.items) {
    let g = it.groupId;
    const seen = new Set();
    while (g && !seen.has(g)) { seen.add(g); set.add(g); g = groupParentOf(g); }
  }
  for (const g of Object.keys(state.groupParents || {})) set.add(g);
  return [...set];
}

/** Grubun içindeki bütün öğeler (alt gruplar dahil) */
function groupItemsDeep(gid, seen = new Set()) {
  if (!gid || seen.has(gid)) return [];
  seen.add(gid);
  const out = groupMembersOf(gid).slice();
  for (const c of childGroupIds(gid)) out.push(...groupItemsDeep(c, seen));
  return out;
}

/** Bir grubun doğrudan çocuk sayısı (öğe + alt grup) */
function groupUnitCount(gid) {
  return groupMembersOf(gid).length + childGroupIds(gid).length;
}

function outermostGroupOf(it) {
  let g = it && it.groupId;
  const seen = new Set();
  while (g && groupParentOf(g) && !seen.has(g)) { seen.add(g); g = groupParentOf(g); }
  return g || null;
}

/** gid, ancestor grubunun içinde mi? */
function groupInside(gid, ancestor) {
  let g = groupParentOf(gid);
  const seen = new Set();
  while (g && !seen.has(g)) {
    if (g === ancestor) return true;
    seen.add(g);
    g = groupParentOf(g);
  }
  return false;
}

/** Grubu çöz: öğeler ve alt gruplar bir üst seviyeye taşınır */
function dissolveGroup(gid) {
  const parent = groupParentOf(gid);
  for (const it of groupMembersOf(gid)) {
    if (parent) it.groupId = parent; else delete it.groupId;
  }
  for (const c of childGroupIds(gid)) {
    if (parent) state.groupParents[c] = parent; else delete state.groupParents[c];
  }
  if (state.groupParents) delete state.groupParents[gid];
  if (state.groupTitles) delete state.groupTitles[gid];
  if (state.groupImportant) delete state.groupImportant[gid];
}

/** Boş kalmış grup kayıtlarını temizle */
function pruneGroups() {
  const alive = new Set();
  for (const it of state.items) {
    let g = it.groupId;
    const seen = new Set();
    while (g && !seen.has(g)) { seen.add(g); alive.add(g); g = groupParentOf(g); }
  }
  for (const [g, p] of Object.entries(state.groupParents || {})) {
    if (!alive.has(g) || (p && !alive.has(p))) delete state.groupParents[g];
  }
  for (const g of Object.keys(state.groupTitles || {})) if (!alive.has(g)) delete state.groupTitles[g];
  for (const g of Object.keys(state.groupImportant || {})) if (!alive.has(g)) delete state.groupImportant[g];
}

/** Seçimi en içteki gruplara/tek öğelere böler */
function selectionUnits() {
  const sel = new Set(selection);
  const groups = allGroupIds().filter(gid => {
    const deep = groupItemsDeep(gid);
    return deep.length >= 2 && deep.every(i => sel.has(i.id));
  });
  const maximal = groups.filter(gid => !groups.some(o => o !== gid && groupInside(gid, o)));
  const used = new Set();
  const units = maximal.map(gid => {
    const deep = groupItemsDeep(gid);
    deep.forEach(i => used.add(i.id));
    return { type: 'group', gid, items: deep };
  });
  for (const id of sel) if (!used.has(id) && getItem(id)) units.push({ type: 'item', id });
  return units;
}

/* ---------------- grup başlıkları ---------------- */
const groupTitlesEl = $('#groupTitles');
const groupTitleEls = new Map();   // gid -> DOM

function groupTitleOf(gid) {
  return (state.groupTitles && state.groupTitles[gid]) || '';
}

function setGroupTitle(gid, value) {
  if (!state.groupTitles) state.groupTitles = {};
  const v = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  if (v) state.groupTitles[gid] = v;
  else delete state.groupTitles[gid];
  scheduleSave();
}

function isGroupActive(gid) {
  const members = groupItemsDeep(gid);
  return members.length >= 2 && members.every(m => selection.has(m.id));
}

/** Seçim tam olarak tek bir grubu kaplıyorsa o grubun kimliği (en dıştaki) */
function selectedGroupId() {
  if (selection.size < 2) return null;
  let best = null;
  for (const gid of allGroupIds()) {
    const deep = groupItemsDeep(gid);
    if (deep.length < 2 || deep.length !== selection.size) continue;
    if (!deep.every(i => selection.has(i.id))) continue;
    if (!best || groupInside(best, gid)) best = gid;
  }
  return best;
}

/** Grup seviyesindeki "önemli" — sadece dış çizgileri renklendirir, fotoğraflara dokunmaz */
function isGroupImportant(gid) {
  return !!(state.groupImportant && state.groupImportant[gid]);
}

/** Grubun önemli rengi (eski kayıtlarda true ise kırmızı) */
function groupImpColor(gid) {
  const v = state.groupImportant && state.groupImportant[gid];
  return (typeof v === 'string' && v) ? v : IMP_FALLBACK;
}

function setGroupImportant(gid, on, color) {
  if (!state.groupImportant) state.groupImportant = {};
  if (on) state.groupImportant[gid] = color || randomImpColor();
  else delete state.groupImportant[gid];
  updateGroupFrame();
}

function focusGroupTitle(gid) {
  const el = groupTitleEls.get(gid);
  if (!el) return;
  const t = el.querySelector('.gtText');
  t.focus({ preventScroll: true });
  try {
    const r = document.createRange();
    r.selectNodeContents(t); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  } catch (e) {}
}

function makeGroupTitleEl(gid) {
  const el = document.createElement('div');
  el.className = 'gt';
  el.dataset.gid = gid;
  /* Düzenleme oturumunun başlangıç başlığı: Escape bunu geri yükler,
     geri-alma adımı da yalnız başlık gerçekten değiştiyse açılır. */
  let titleBase = null;

  const text = document.createElement('div');
  text.className = 'gtText';
  text.dataset.ph = 'Group title…';
  text.spellcheck = false;
  text.setAttribute('role', 'textbox');
  text.setAttribute('aria-label', 'Group title');

  text.addEventListener('pointerdown', e => e.stopPropagation());
  text.addEventListener('click', e => {
    e.stopPropagation();
    // başlığa tıklayınca o grup seçilir (iç içe gruplarda iç gruba geçmek için)
    if (selectedGroupId() !== gid) {
      selection = new Set(groupItemsDeep(gid).map(i => i.id));
      syncSelection();
    }
  });
  text.addEventListener('dblclick', e => e.stopPropagation());

  text.addEventListener('focus', () => {
    titleBase = groupTitleOf(gid);
  });

  text.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      /* Model input sırasında güncellendiği için groupTitleOf(gid) artık
         YAZILAN değeri döndürür; vazgeçmek için oturum başındaki başlık
         geri yüklenir. Blur, aynı değere dönüldüğü için undo adımı açmaz. */
      if (titleBase !== null) text.textContent = titleBase;
      text.blur();
    }
  });

  text.addEventListener('input', () => {
    setGroupTitle(gid, text.textContent);
  });

  text.addEventListener('blur', () => {
    const base = titleBase;
    titleBase = null;
    const v = text.textContent.replace(/\s+/g, ' ').trim().slice(0, 90);
    text.textContent = v;
    /* Geri-alma anlık görüntüsü düzenleme ÖNCESİ başlıkla alınır; böylece
       Ctrl+Z eski başlığa döner. Başlık değişmediyse (Escape dâhil) adım
       açılmaz. */
    if (base !== null && v !== base) {
      setGroupTitle(gid, base);
      pushUndo();
    }
    setGroupTitle(gid, v);
    updateGroupTitles();
  });

  el.appendChild(text);
  groupTitlesEl.appendChild(el);
  return el;
}

/** Her grubun başlığını grubun üstünde göster */
let updatingGroupTitles = false;
function updateGroupTitles() {
  // odaktaki başlık kaldırılırken blur tetiklenip burayı yeniden çağırabiliyor;
  // iç içe çağrı DOM'u bozmasın diye koruma
  if (updatingGroupTitles) return;
  updatingGroupTitles = true;
  try {
    updateGroupTitlesInner();
  } finally {
    updatingGroupTitles = false;
  }
}

function updateGroupTitlesInner() {
  const groups = new Map();
  for (const gid of allGroupIds()) {
    const deep = groupItemsDeep(gid);
    if (deep.length >= 2 && groupUnitCount(gid) >= 2) groups.set(gid, deep);
  }

  for (const gid of [...groupTitleEls.keys()]) {
    if (!groups.has(gid)) {
      const old = groupTitleEls.get(gid);
      groupTitleEls.delete(gid);
      if (old && old.parentNode) {
        try { old.parentNode.removeChild(old); } catch { /* blur sırasında taşınmış olabilir */ }
      }
    }
  }

  const focusGid = selectedGroupId();

  for (const [gid, members] of groups) {
    let el = groupTitleEls.get(gid);
    if (!el) { el = makeGroupTitleEl(gid); groupTitleEls.set(gid, el); }

    const focused = gid === focusGid;
    const text = el.querySelector('.gtText');
    el.classList.toggle('active', focused);
    el.classList.toggle('important', isGroupImportant(gid));
    if (isGroupImportant(gid)) el.style.setProperty('--imp', groupImpColor(gid));
    else el.style.removeProperty('--imp');
    if (document.activeElement !== text) {
      const v = groupTitleOf(gid);
      if (text.textContent !== v) text.textContent = v;
    }
    text.contentEditable = focused ? 'plaintext-only' : 'false';
    text.tabIndex = focused ? 0 : -1;
    const hasTitle = !!groupTitleOf(gid);
    el.classList.toggle('empty', !hasTitle);
    // boş başlık yalnızca grup seçiliyken görünür (tahta temiz kalsın)
    el.hidden = !hasTitle && !focused;
    if (el.hidden) continue;

    const b = boundsOf(members, 0);
    const p1 = worldToScreen({ x: b.x, y: b.y });
    const p2 = worldToScreen({ x: b.x + b.w, y: b.y });
    const cx = (p1.x + p2.x) / 2;
    el.style.visibility = 'hidden';
    const w = Math.min(el.offsetWidth || 120, window.innerWidth - 20);
    el.style.left = clamp(cx, w / 2 + 10, window.innerWidth - w / 2 - 10) + 'px';
    const minTop = document.body.classList.contains('bar-hidden') ? 46 : 124;
    el.style.top  = clamp(p1.y - 8, minTop, window.innerHeight - 10) + 'px';
    el.style.visibility = '';
  }
}

function updateGroupFrame() {
  const groups = new Map();
  for (const gid of allGroupIds()) {
    const deep = groupItemsDeep(gid);
    if (deep.length >= 2 && groupUnitCount(gid) >= 2) groups.set(gid, deep);
  }

  // dağılmış grupların çerçevelerini kaldır
  for (const [gid, el] of groupFrameEls) {
    if (!groups.has(gid)) { el.remove(); groupFrameEls.delete(gid); }
  }

  const focusGid = selectedGroupId();
  const pad = 14;
  for (const [gid, members] of groups) {
    let el = groupFrameEls.get(gid);
    if (!el) {
      el = document.createElement('div');
      el.className = 'gframe';
      for (let i = 0; i < 4; i++) {
        const tick = document.createElement('i');
        tick.className = 'gtick t' + i;
        el.appendChild(tick);
      }
      // grup boyutlandırma tutamaçları (sağ/sol/üst/alt + köşeler)
      for (const [hx, hy, cls] of HANDLES) {
        const h = document.createElement('b');
        h.className = 'ghandle ' + cls;
        h.dataset.hx = hx; h.dataset.hy = hy;
        el.appendChild(h);
      }
      groupFramesEl.appendChild(el);
      groupFrameEls.set(gid, el);
    }
    el.dataset.gid = gid;
    const b = boundsOf(members, 0);
    el.style.left   = (b.x - pad) + 'px';
    el.style.top    = (b.y - pad) + 'px';
    el.style.width  = (b.w + pad * 2) + 'px';
    el.style.height = (b.h + pad * 2) + 'px';
    el.classList.toggle('active', isGroupActive(gid));
    el.classList.toggle('important', isGroupImportant(gid));
    if (isGroupImportant(gid)) el.style.setProperty('--imp', groupImpColor(gid));
    else el.style.removeProperty('--imp');
    el.classList.toggle('nested', !!groupParentOf(gid));
    el.classList.toggle('focus', gid === focusGid);
    el.style.zIndex = gid === focusGid ? 14 : 10;
  }

  updateGroupTitles();
}

/** Seçilenleri grupla; tek bir grup seçiliyse o grubu çöz */
function groupSelection() {
  if (selection.size < 2) return;
  const units = selectionUnits();
  if (!units.length) return;
  /* Çözme değilse en az iki birim gerekir. Kontrol pushUndo'dan ÖNCE
     yapılmalı: eskiden önce snapshot alınıp geri atılıyordu, bu da
     yine de yineleme (redo) geçmişini siliyordu. */
  const dissolving = units.length === 1 && units[0].type === 'group';
  if (!dissolving && units.length < 2) return;

  pushUndo();

  // tek grup seçili -> grubu çöz (iç içe gruplar korunur)
  if (dissolving) {
    dissolveGroup(units[0].gid);
    syncSelection();
    scheduleSave();
    return;
  }

  // yeni üst grup: seçilen gruplar ve tek öğeler onun altına girer
  const g = 'g_' + newId();
  if (!state.groupParents) state.groupParents = {};
  for (const u of units) {
    if (u.type === 'group') state.groupParents[u.gid] = g;
    else {
      const it = getItem(u.id);
      if (it) it.groupId = g;
    }
  }

  selection = new Set(units.flatMap(u => u.type === 'group' ? u.items.map(i => i.id) : [u.id]));
  syncSelection();
  setTimeout(() => focusGroupTitle(g), 30);
  scheduleSave();
}
