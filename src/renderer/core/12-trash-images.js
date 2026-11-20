/* TailRef app · image cache, trash list and countdowns */
'use strict';

function loadImage(imageId) {
  if (!imageId) return Promise.resolve({ status: 'missing' });
  const cached = imgCache.get(imageId);
  if (cached) return Promise.resolve({ status: 'ok', value: cached });
  const pending = imageLoadPromises.get(imageId);
  if (pending) return pending;
  const load = (async () => {
    let rec;
    try {
      rec = await idbGet('images', imageId);
    } catch {
      imageLoadFailures.add(imageId);
      return { status: 'error' };
    }
    if (!rec || !rec.blob) {
      imageLoadFailures.add(imageId);
      return { status: 'missing' };
    }
    try {
      const entry = await decodeImage(rec.blob);
      const value = { img: entry.img, url: entry.url, name: rec.name || '' };
      setImgCache(imageId, value);
      return { status: 'ok', value };
    } catch {
      imageLoadFailures.add(imageId);
      return { status: 'decode-failed' };
    }
  })().finally(() => imageLoadPromises.delete(imageId));
  imageLoadPromises.set(imageId, load);
  return load;
}

async function ensureImageCached(imageId) {
  if (!imageId) throw new Error('missing image id');
  const result = await loadImage(imageId);
  if (result.status !== 'ok') throw new Error(result.status);
  return result.value;
}

/* Görsel blob'u IDB'ye yazılıp tahtadaki öğeye bağlanana kadar geçen kısa
   aralıkta GC turu denk gelirse blob "sahipsiz" sanılıp silinebilir. Bu
   sayaç > 0 iken GC hiç çalışmaz (sonraki turda temizler). */
let imageWriteInFlight = 0;
function beginImageWrite() { imageWriteInFlight++; }
function endImageWrite() { if (imageWriteInFlight > 0) imageWriteInFlight--; }

function scheduleGcImages(delay = 4000) {
  clearTimeout(trashGcTimer);
  trashGcTimer = setTimeout(() => {
    trashGcTimer = null;
    gcImages();
  }, delay);
}

function purgeExpiredTrash(options = {}) {
  const now = Date.now();
  const before = state.trash.length;
  state.trash = state.trash.filter(entry => entry.expiresAt > now);
  const removed = before - state.trash.length;
  if (!removed) return 0;
  // Kalıcı silinen görsellerin bağlı çizim katmanları artık geri gelmeyeceği
  // için vuruş verileri de temizlenir. (Geri getirilebilir çöpte korunur.)
  if (typeof inkPruneOrphanLayers === 'function') {
    inkPruneOrphanLayers();
    inkSyncDom();
    // FAZ 8.A: prune artık 'remove' olayı yayıyor — abone paneli taşır.
  }
  if (options.save !== false) scheduleSave();
  if (options.render !== false) updateTrashUI(true);
  scheduleGcImages(3500);
  return removed;
}

function trashTimeLabel(entry) {
  const seconds = Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function updateTrashCountdowns() {
  if (!trashListEl) return;
  const now = Date.now();
  for (const row of trashListEl.querySelectorAll('[data-trash-expires]')) {
    const expiresAt = Number(row.dataset.trashExpires);
    if (!Number.isFinite(expiresAt)) continue;
    const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
    const next = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    const time = row.querySelector('.trashTime');
    /* Saniye ilerlese de dakika metni çoğu tick'te aynı; değişmediyse yazma. */
    if (time && time.textContent !== next) time.textContent = next;
  }
}

function hydrateTrashThumb(entry, thumb, img) {
  if (entry.item.kind !== 'image') return;
  const cached = imgCache.get(entry.item.imageId);
  if (cached) {
    img.src = cached.url;
    thumb.classList.add('ready');
    return;
  }
  thumb.classList.add('loading');
  ensureImageCached(entry.item.imageId)
    .then(value => {
      if (!thumb.isConnected) return;
      img.src = value.url;
      thumb.classList.remove('loading');
      thumb.classList.add('ready');
    })
    .catch(() => {
      if (!thumb.isConnected) return;
      thumb.classList.remove('loading');
      thumb.classList.add('missing');
    });
}

function renderTrashList() {
  if (!trashListEl) return;
  trashListEl.replaceChildren();
  if (!state.trash.length) {
    trashListEl.hidden = true;
    if (trashEmptyEl) trashEmptyEl.hidden = false;
    return;
  }
  trashListEl.hidden = false;
  if (trashEmptyEl) trashEmptyEl.hidden = true;

  const fragment = document.createDocumentFragment();
  [...state.trash].sort((a, b) => b.deletedAt - a.deletedAt).forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'trashItem';
    row.dataset.trashId = entry.id;
    row.dataset.trashExpires = String(entry.expiresAt);
    row.style.setProperty('--row-index', String(Math.min(index, 8)));
    row.setAttribute('role', 'listitem');

    const thumb = document.createElement('div');
    thumb.className = 'trashThumb';
    if (entry.item.kind === 'image') {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      thumb.appendChild(img);
      hydrateTrashThumb(entry, thumb, img);
    } else {
      thumb.classList.add('textThumb');
      thumb.textContent = 'Aa';
    }

    const meta = document.createElement('div');
    meta.className = 'trashMeta';
    const name = document.createElement('b');
    name.textContent = entry.item.kind === 'image' ? 'Photo' : 'Text';
    const detail = document.createElement('span');
    if (entry.item.kind === 'image') {
      detail.textContent = (imgCache.get(entry.item.imageId) && imgCache.get(entry.item.imageId).name) || 'Image';
    } else {
      detail.textContent = String(entry.item.text || 'Empty text').replace(/\s+/g, ' ').slice(0, 48) || 'Empty text';
    }
    const time = document.createElement('span');
    time.className = 'trashTime';
    time.textContent = trashTimeLabel(entry);
    meta.append(name, detail, time);

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'trashRestore';
    restore.dataset.trashRestore = entry.id;
    restore.textContent = __t('Restore');
    restore.title = __t('Bring this item back to the board');

    row.append(thumb, meta, restore);
    fragment.appendChild(row);
  });
  trashListEl.appendChild(fragment);
  updateTrashCountdowns();
}

function updateTrashUI(forceRender = false) {
  if (!trashDockEl) return;
  const count = state.trash.length;
  const signature = state.trash.map(entry => entry.id).join('|');
  if (trashCountEl) trashCountEl.textContent = String(count);
  trashDockEl.classList.toggle('is-empty', count === 0);
  if (btnTrashDockEl) {
    btnTrashDockEl.setAttribute('aria-expanded', String(isPanelVisible(trashPanelEl)));
    btnTrashDockEl.setAttribute('aria-label', count ? __t('Trash, {n} items', { n: count }) : __t('Open trash'));
  }
  if (trashTitleEl) {
    const images = state.trash.filter(entry => entry.item.kind === 'image').length;
    const texts = state.trash.filter(entry => entry.item.kind === 'text').length;
    const parts = [];
    if (images) parts.push(images + ' ' + __t('photo'));
    if (texts) parts.push(texts + ' ' + __t('text'));
    trashTitleEl.textContent = parts.join(' · ') || __t('Empty');
  }
  if (trashRetentionLabelEl) trashRetentionLabelEl.textContent = trashRetentionText();
  if (btnTrashRestoreAllEl) btnTrashRestoreAllEl.disabled = count === 0;
  if (btnTrashPurgeEl) btnTrashPurgeEl.disabled = count === 0;
  if (forceRender || signature !== trashRenderedSignature) {
    trashRenderedSignature = signature;
    renderTrashList();
  }
  updateTrashCountdowns();
}

/* Dil değişince çöp kutusu rozetleri/başlığı tazelensin. */
if (window.L10N && window.L10N.onChange) {
  window.L10N.onChange(() => { try { updateTrashUI(); } catch { /* sessiz */ } });
}

function startTrashClock() {
  clearInterval(trashClockTimer);
  trashClockTimer = setInterval(() => {
    const removed = purgeExpiredTrash();
    if (!removed) updateTrashCountdowns();
  }, 1000);
}

function configureTrashRetention(minutes, persist = true) {
  const n = Math.min(1440, Math.max(1, Math.round(Number(minutes) || TRASH_RETENTION_DEFAULT)));
  trashRetentionMinutes = n;
  if (persist) {
    try { localStorage.setItem(TRASH_RETENTION_KEY, String(n)); } catch { /* sessiz */ }
  }
  if (trashRetentionSelectEl && trashRetentionSelectEl.value !== String(n)) {
    trashRetentionSelectEl.value = String(n);
  }
  // Mevcut çöpteki bekleme süresini de yeni ayara göre güncelle.
  for (const entry of state.trash) {
    entry.expiresAt = entry.deletedAt + n * 60000;
  }
  purgeExpiredTrash({ render: false, save: false });
  updateTrashUI(true);
  scheduleSave();
  return n;
}
