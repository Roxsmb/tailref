/* TailRef app · trash dock, entries, fly animations */
'use strict';

function scheduleTrashIdle() {
  clearTimeout(trashIdleTimer);
  trashIdleTimer = null;
  if (!trashDockEl || isPanelVisible(trashPanelEl)) return;
  trashIdleTimer = setTimeout(() => {
    trashIdleTimer = null;
    if (!trashDockEl || isPanelVisible(trashPanelEl)) return;
    if (trashDockEl.matches(':hover') || trashDockEl.contains(document.activeElement)) {
      scheduleTrashIdle();
      return;
    }
    trashDockEl.classList.add('is-idle');
  }, TRASH_IDLE_MS);
}

function showTrashDock(restartIdle = true) {
  if (!trashDockEl) return;
  trashDockEl.classList.remove('is-idle');
  if (restartIdle) scheduleTrashIdle();
}

function trashDockHotZone(x, y) {
  const margin = 120;
  return x >= innerWidth - margin && y >= innerHeight - margin;
}

function clampTrashPanelPosition(left, top, width, height) {
  const margin = 12;
  /* Çöp paneli de diğer yüzen panellerle aynı sınırlara uyar: başlığı üst
     dock'un (#barDock) altında, gövdesi alt dock'un üstünde kalır. Aksi halde
     panel pencere sürükleme şeridine giriyor, orada tıklama pencereyi taşıyor
     ve panel bir daha tutulamıyordu (bkz. 17-floating-panels.js). */
  const topLimit = typeof floatingTopLimit === 'function' ? floatingTopLimit() : margin;
  const bottomLimit = typeof floatingBottomLimit === 'function' ? floatingBottomLimit() : innerHeight - margin;
  const maxTop = Math.max(topLimit, bottomLimit - height);
  return {
    left: clamp(left, margin, Math.max(margin, innerWidth - width - margin)),
    top: clamp(top, topLimit, maxTop),
  };
}

function persistTrashPanelPosition() {
  try {
    if (trashPanelPos) localStorage.setItem(TRASH_PANEL_POS_KEY, JSON.stringify(trashPanelPos));
    else localStorage.removeItem(TRASH_PANEL_POS_KEY);
  } catch { /* sessiz */ }
}

function normalizeTrash(value) {
  if (!Array.isArray(value)) return [];
  const now = Date.now();
  return value
    .filter(entry => entry && entry.item && entry.item.id)
    .map(entry => {
      const deletedAt = Number(entry.deletedAt);
      const safeDeletedAt = Number.isFinite(deletedAt) ? deletedAt : now;
      const expiresAt = Number(entry.expiresAt);
      return {
        id: entry.id || 'tr_' + newId(),
        item: entry.item,
        deletedAt: safeDeletedAt,
        expiresAt: Number.isFinite(expiresAt)
          ? expiresAt
          : safeDeletedAt + trashRetentionMinutes * 60000,
        batchId: entry.batchId || '',
        groups: Array.isArray(entry.groups) ? entry.groups.filter(g => g && g.id) : [],
        links: Array.isArray(entry.links) ? entry.links.filter(l => l && l.from && l.to) : [],
      };
    });
}

function trashRetentionText(minutes = trashRetentionMinutes) {
  if (minutes >= 60 && minutes % 60 === 0) return (minutes / 60) + ' saat';
  return minutes + ' dakika';
}

function groupChainSnapshot(gid) {
  const chain = [];
  let g = gid;
  const seen = new Set();
  while (g && !seen.has(g)) {
    seen.add(g);
    chain.push({
      id: g,
      parent: groupParentOf(g) || null,
      title: (state.groupTitles && state.groupTitles[g]) || '',
      important: (state.groupImportant && state.groupImportant[g]) || '',
    });
    g = groupParentOf(g);
  }
  return chain;
}

function makeTrashEntry(it, now, batchId, links) {
  return {
    id: 'tr_' + newId(),
    item: JSON.parse(JSON.stringify(it)),
    deletedAt: now,
    expiresAt: now + trashRetentionMinutes * 60000,
    batchId,
    groups: groupChainSnapshot(it.groupId),
    links: links.map(link => ({ ...link })),
  };
}

function pulseTrashDock(kind = 'catch') {
  if (!trashDockEl) return;
  showTrashDock();
  trashDockEl.classList.remove('is-catching', 'is-restoring');
  void trashDockEl.offsetWidth;
  trashDockEl.classList.add(kind === 'restore' ? 'is-restoring' : 'is-catching');
  clearTimeout(trashPulseTimer);
  trashPulseTimer = setTimeout(() => {
    trashDockEl.classList.remove('is-catching', 'is-restoring');
  }, 600); // Biraz daha uzun
  if (trashCountEl) {
    trashCountEl.classList.remove('count-pop');
    void trashCountEl.offsetWidth;
    trashCountEl.classList.add('count-pop');
  }
}

function flyItemToTrash(it, el) {
  if (!el || it.kind !== 'image' || motionReduced() || !btnTrashDockEl) return false;
  const rect = el.getBoundingClientRect();
  const target = btnTrashDockEl.getBoundingClientRect();
  if (!rect.width || !rect.height || !target.width) return false;

  const clone = el.cloneNode(true);
  clone.querySelectorAll('.handles').forEach(node => node.remove());
  clone.classList.remove('sel', 'editing', 'dragging', 'important', 'locked', 'grouped', 'item-enter', 'item-leaving');
  clone.removeAttribute('data-id');
  clone.classList.add('trashFly');
  clone.style.position = 'fixed';
  clone.style.left = rect.left + 'px';
  clone.style.top = rect.top + 'px';
  clone.style.width = rect.width + 'px';
  clone.style.height = rect.height + 'px';
  clone.style.margin = '0';
  clone.style.pointerEvents = 'none';
  clone.style.zIndex = '2600';
  clone.style.transformOrigin = '50% 50%';
  clone.style.transform = `rotate(${it.rot || 0}deg)`;
  clone.style.borderRadius = getComputedStyle(el).borderRadius;
  // Klon dünya transform'u dışında, doğrudan ekran pikselinde durur.
  clone.style.setProperty('--inv', '1');
  document.body.appendChild(clone);

  const startX = rect.left + rect.width / 2;
  const startY = rect.top + rect.height / 2;
  const endX = target.left + target.width / 2;
  const endY = target.top + target.height / 2;
  const dx = endX - startX;
  const dy = endY - startY;
  const targetScale = Math.max(0.05, Math.min(0.24, target.width / Math.max(rect.width, rect.height) * 0.62));
  // Daha yumuşak yay: arc ve spin azaltıldı
  const arc = Math.min(60, Math.max(16, Math.abs(dx) * 0.05 + Math.abs(dy) * 0.03));
  const spin = (it.rot || 0) + (dx >= 0 ? 8 : -8);
  const duration = 680; // Biraz daha uzun = daha yumuşak
  const delay = Math.min(120, (Number(it.z) || 1) % 4 * 24);

  const animation = clone.animate([
    { transform: `translate3d(0,0,0) rotate(${it.rot || 0}deg) scale(1)`, opacity: 1, offset: 0 },
    { transform: `translate3d(${dx * 0.5}px, ${dy * 0.3 - arc}px, 0) rotate(${spin * 0.4}deg) scale(.75)`, opacity: .95, offset: .6 },
    { transform: `translate3d(${dx}px, ${dy}px, 0) rotate(${spin * 0.05}deg) scale(${targetScale})`, opacity: .04, offset: 1 },
  ], {
    duration,
    delay,
    easing: 'cubic-bezier(.25,.1,.15,1)', // Daha yumuşak easing
    fill: 'both',
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clone.remove();
  };
  animation.onfinish = () => {
    cleanup();
    pulseTrashDock('catch');
  };
  animation.oncancel = cleanup;
  setTimeout(cleanup, duration + delay + 120);
  return true;
}

