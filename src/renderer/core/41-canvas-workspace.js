/* TailRef app — Yeni çizim tuvali (referans uygulama tarzı boyut soran pencere)
   ------------------------------------------------------------------
   Referans tahtası ile çizim modu aynı belgeyi paylaşır. "New canvas"
   seçildiğinde genişlik × yükseklik piksel olarak sorulur; oluşturulan
   görsel öğe tahtaya eklenir ve üzerine bağlı bir çizim katmanı açılır.

   Böylece:
     • Çizim modunda yapılan vuruşlar aynı katman tuvaline işlenir,
     • Referans moduna dönünce aynı tuval tahtadaki öğede görünür,
     • Tuval çözünürlüğü kullanıcının girdiği piksel boyutudur.

   Bu modül yalnızca yeni belge oluşturur; mevcut bir görseli düzenlemek
   için mod anahtarındaki "Drawing" sekmesi doğrudan o görseli açar. */

'use strict';

const NEW_CANVAS_MAX_SIDE = 8192;
const NEW_CANVAS_MIN_SIDE = 16;
const NEW_CANVAS_MAX_PIXELS = 50 * 1000 * 1000;

const NEW_CANVAS_PRESETS = [
  { label: 'Square', w: 1080, h: 1080 },
  { label: '4:3', w: 1440, h: 1080 },
  { label: '16:9', w: 1600, h: 900 },
  { label: '1080p', w: 1920, h: 1080 },
  { label: 'A4', w: 2480, h: 3508 },
  { label: 'A5', w: 1748, h: 2480 },
  { label: '4K', w: 3840, h: 2160 },
  { label: '1024', w: 1024, h: 1024 },
];

const newCanvasUi = {
  bound: false,
  busy: false,
  els: {},
};

function newCanvasStorageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw;
  } catch {
    return fallback;
  }
}

function newCanvasStorageSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* sessiz */ }
}

/** Yeni tuvalin ad kökü: arayüz diline göre "Canvas" / "Tuval". */
function newCanvasBaseName() {
  try {
    if (window.L10N && typeof window.L10N.t === 'function') {
      const base = window.L10N.t('Canvas');
      if (base && base !== 'Canvas') return base;
    }
  } catch { /* sessiz */ }
  return 'Canvas';
}

/** Tahtadaki öğe adlarını (küçük harfe indirgenmiş) döndürür. */
function newCanvasUsedNames() {
  const used = new Set();
  const items = typeof state !== 'undefined' && Array.isArray(state.items) ? state.items : [];
  for (const item of items) {
    const name = String((item && (item.title || item.name)) || '').trim().toLowerCase();
    if (name) used.add(name);
  }
  return used;
}

/** Verilen ad tahtada zaten kullanılıyor mu? */
function newCanvasNameTaken(name) {
  const want = String(name || '').trim().toLowerCase();
  return !!want && newCanvasUsedNames().has(want);
}

/** Tahtadaki mevcut adları atlayarak sıradaki boş "<kök> N" adını verir. */
function newCanvasNextFreeName() {
  const base = newCanvasBaseName();
  const used = newCanvasUsedNames();
  let n = 1;
  while (used.has((base + ' ' + n).toLowerCase())) n++;
  return base + ' ' + n;
}

function newCanvasDefaultName() {
  return newCanvasNextFreeName();
}

function newCanvasParseSize(el) {
  const n = Math.round(Number(el && el.value));
  return Number.isFinite(n) ? n : NaN;
}

function newCanvasValidate(show) {
  const ui = newCanvasUi;
  const w = newCanvasParseSize(ui.els.w);
  const h = newCanvasParseSize(ui.els.h);
  let error = '';
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    error = 'Width and height must be numbers.';
  } else if (w < NEW_CANVAS_MIN_SIDE || h < NEW_CANVAS_MIN_SIDE) {
    error = `Must be at least ${NEW_CANVAS_MIN_SIDE} × ${NEW_CANVAS_MIN_SIDE} px.`;
  } else if (w > NEW_CANVAS_MAX_SIDE || h > NEW_CANVAS_MAX_SIDE) {
    error = `En fazla ${NEW_CANVAS_MAX_SIDE} px olabilir.`;
  } else if (w * h > NEW_CANVAS_MAX_PIXELS) {
    error = 'Canvas too large (at most 50 megapixels).';
  }
  if (show) {
    const info = ui.els.info;
    if (info) {
      info.textContent = error;
      info.classList.toggle('is-error', !!error);
    }
  }
  return error ? null : { w, h };
}

/** Önizleme kutusundaki beyaz/saydam kâğıdı güncel orana getirir. */
function newCanvasUpdatePreview(w, h) {
  const sheet = document.getElementById('newCanvasPreviewSheet');
  const preview = document.getElementById('newCanvasPreview');
  if (!sheet || !preview) return;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  const padX = 36;
  const padY = 30;
  const availW = Math.max(48, preview.clientWidth - padX);
  const availH = Math.max(40, preview.clientHeight - padY);
  const ratio = w / h;
  let sw = availW;
  let sh = sw / ratio;
  if (sh > availH) {
    sh = availH;
    sw = sh * ratio;
  }
  sheet.style.width = Math.round(sw) + 'px';
  sheet.style.height = Math.round(sh) + 'px';
}

/** Arka plan seçimine göre önizleme kâğıdını damalı/beyaz yapar. */
function newCanvasSyncPreviewBg() {
  const ui = newCanvasUi;
  const preview = document.getElementById('newCanvasPreview');
  if (!preview) return;
  const bg = ui.els.modal
    ? ui.els.modal.querySelector('input[name="ncBg"]:checked')
    : null;
  preview.classList.toggle('is-transparent', !!bg && bg.value === 'transparent');
}

function newCanvasUpdateInfo() {
  const ui = newCanvasUi;
  const size = newCanvasValidate(false);
  const info = ui.els.info;
  if (!info) return;
  if (!size) {
    // Ayrıntılı hata metnini hemen göster.
    newCanvasValidate(true);
    return;
  }
  info.classList.remove('is-error');
  info.textContent = `${size.w} × ${size.h} px`;
  newCanvasUpdatePreview(size.w, size.h);
  newCanvasSyncPreviewBg();
}

function newCanvasSyncPresets() {
  const ui = newCanvasUi;
  if (!ui.els.presets) return;
  const w = newCanvasParseSize(ui.els.w);
  const h = newCanvasParseSize(ui.els.h);
  // Aynı boyutu paylaşan birden fazla hazır ayar olabilir (16:9 ve
  // 1080p). Yalnızca ilk eşleşen seçili görünür.
  let matched = false;
  for (const btn of ui.els.presets.querySelectorAll('.ncPreset')) {
    const pw = Number(btn.dataset.w);
    const ph = Number(btn.dataset.h);
    const active = !matched && pw === w && ph === h;
    if (active) matched = true;
    btn.classList.toggle('is-active', active);
  }
}

function newCanvasRenderPresets() {
  const ui = newCanvasUi;
  const host = ui.els.presets;
  if (!host) return;
  host.textContent = '';
  for (const preset of NEW_CANVAS_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ncPreset';
    btn.dataset.w = String(preset.w);
    btn.dataset.h = String(preset.h);
    btn.title = `${preset.w} × ${preset.h} px`;

    // Küçük oran önizlemesi: kutunun içine sığan gri dikdörtgen.
    const shape = document.createElement('i');
    shape.className = 'ncPresetShape';
    const ratio = preset.w / preset.h;
    const maxW = 30;
    const maxH = 24;
    let sw;
    let sh;
    if (ratio >= maxW / maxH) {
      sw = maxW;
      sh = maxW / ratio;
    } else {
      sh = maxH;
      sw = maxH * ratio;
    }
    shape.style.width = Math.max(9, sw).toFixed(1) + 'px';
    shape.style.height = Math.max(9, sh).toFixed(1) + 'px';

    const label = document.createElement('span');
    label.className = 'ncPresetLabel';
    label.textContent = preset.label;

    btn.append(shape, label);
    btn.addEventListener('click', () => {
      ui.els.w.value = String(preset.w);
      ui.els.h.value = String(preset.h);
      newCanvasUpdateInfo();
      newCanvasSyncPresets();
    });
    host.appendChild(btn);
  }
}

function newCanvasBind() {
  const ui = newCanvasUi;
  if (ui.bound) return true;
  const modal = document.getElementById('newCanvasModal');
  if (!modal) return false;
  const form = document.getElementById('newCanvasForm');

  ui.els.modal = modal;
  ui.els.form = form;
  ui.els.w = document.getElementById('newCanvasW');
  ui.els.h = document.getElementById('newCanvasH');
  ui.els.name = document.getElementById('newCanvasName');
  ui.els.presets = document.getElementById('newCanvasPresets');
  ui.els.info = document.getElementById('newCanvasInfo');
  ui.els.create = document.getElementById('newCanvasCreate');
  ui.els.swap = document.getElementById('newCanvasSwap');
  if (!ui.els.w || !ui.els.h || !ui.els.create) return false;

  newCanvasRenderPresets();

  for (const el of [ui.els.w, ui.els.h]) {
    el.addEventListener('input', () => {
      newCanvasUpdateInfo();
      newCanvasSyncPresets();
    });
    el.addEventListener('blur', () => {
      const v = newCanvasParseSize(el);
      if (Number.isFinite(v)) {
        el.value = String(clamp(v, NEW_CANVAS_MIN_SIDE, NEW_CANVAS_MAX_SIDE));
      }
      newCanvasUpdateInfo();
      newCanvasSyncPresets();
    });
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (form) form.requestSubmit();
      }
    });
  }

  if (ui.els.swap) ui.els.swap.addEventListener('click', () => {
    const w = ui.els.w.value;
    ui.els.w.value = ui.els.h.value;
    ui.els.h.value = w;
    newCanvasUpdateInfo();
    newCanvasSyncPresets();
  });

  for (const radio of modal.querySelectorAll('input[name="ncBg"]')) {
    radio.addEventListener('change', newCanvasSyncPreviewBg);
  }

  const close = () => newCanvasClose();
  document.getElementById('newCanvasClose')?.addEventListener('click', close);
  document.getElementById('newCanvasCancel')?.addEventListener('click', close);
  modal.addEventListener('pointerdown', event => {
    if (event.target === modal) close();
  });
  document.addEventListener('keydown', event => {
    if (modal.hidden || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, true);

  if (form) form.addEventListener('submit', event => {
    event.preventDefault();
    void newCanvasCreate();
  });

  ui.bound = true;
  return true;
}

function newCanvasOpen() {
  if (!newCanvasBind()) return false;
  const ui = newCanvasUi;
  if (!ui.els.modal) return false;

  // Son kullanılan boyutu hatırla; yoksa Full HD ile başla.
  const saved = newCanvasStorageGet('tailref-canvas-size', '1920x1080');
  const m = /^(\d+)x(\d+)$/.exec(String(saved));
  if (m) {
    ui.els.w.value = m[1];
    ui.els.h.value = m[2];
  }
  /* Hatırlanan ad yalnızca tahtada henüz yoksa kullanılır; aksi halde aynı
     adla ikinci tuval oluşurdu ("Canvas 1" + "Canvas 1"). */
  const rememberedName = String(newCanvasStorageGet('tailref-canvas-name', '') || '').trim();
  ui.els.name.value = rememberedName && !newCanvasNameTaken(rememberedName)
    ? rememberedName
    : newCanvasDefaultName();
  const lastBg = newCanvasStorageGet('tailref-canvas-bg', 'white');
  const bgRadio = ui.els.modal.querySelector(`input[name="ncBg"][value="${lastBg === 'transparent' ? 'transparent' : 'white'}"]`);
  if (bgRadio) bgRadio.checked = true;

  ui.els.modal.hidden = false;
  ui.busy = false;
  if (ui.els.create) ui.els.create.disabled = false;
  newCanvasUpdateInfo();
  newCanvasSyncPresets();

  requestAnimationFrame(() => {
    try { ui.els.w.focus({ preventScroll: true }); ui.els.w.select(); } catch { /* sessiz */ }
  });
  return true;
}

/* Yeni tuvali boyut penceresi açmadan, son kullanılan boyut ve otomatik
   adla hemen oluşturur. Kullanıcı adı sonradan çizim üst çubuğundaki
   isme çift tıklayarak değiştirebilir. Boyut seçmek isteyenler için
   Shift+tık hâlâ ayrıntılı pencereyi açar. */
async function newCanvasQuickOpen() {
  if (!newCanvasBind()) return false;
  const ui = newCanvasUi;
  if (!ui.els.modal || !ui.els.w || !ui.els.h || !ui.els.name) return false;
  if (ui.busy) return false;

  const saved = newCanvasStorageGet('tailref-canvas-size', '1920x1080');
  const m = /^(\d+)x(\d+)$/.exec(String(saved));
  if (m) {
    ui.els.w.value = m[1];
    ui.els.h.value = m[2];
  }
  ui.els.name.value = newCanvasNextFreeName();
  const lastBg = newCanvasStorageGet('tailref-canvas-bg', 'white');
  const bgRadio = ui.els.modal.querySelector(
    `input[name="ncBg"][value="${lastBg === 'transparent' ? 'transparent' : 'white'}"]`
  );
  if (bgRadio) bgRadio.checked = true;
  newCanvasUpdateInfo();
  newCanvasSyncPresets();
  ui.els.modal.hidden = true;
  return newCanvasCreate();
}

function newCanvasClose() {
  const ui = newCanvasUi;
  if (ui.busy) return;
  if (ui.els.modal) ui.els.modal.hidden = true;
}

function newCanvasSafeFileName(name) {
  const base = String(name || 'Canvas')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'Canvas';
  return base + '.png';
}

async function newCanvasCreate() {
  const ui = newCanvasUi;
  if (ui.busy) return false;
  const size = newCanvasValidate(true);
  if (!size) return false;

  const name = String(ui.els.name?.value || '').trim().slice(0, 64) || newCanvasDefaultName();
  const bgEl = ui.els.modal.querySelector('input[name="ncBg"]:checked');
  const transparent = bgEl ? bgEl.value === 'transparent' : false;

  newCanvasStorageSet('tailref-canvas-size', `${size.w}x${size.h}`);
  newCanvasStorageSet('tailref-canvas-name', name);
  newCanvasStorageSet('tailref-canvas-bg', transparent ? 'transparent' : 'white');

  ui.busy = true;
  if (ui.els.create) ui.els.create.disabled = true;
  if (ui.els.info) {
    ui.els.info.classList.remove('is-error');
    ui.els.info.textContent = 'Creating the canvas…';
  }

  try {
    // Arayüzün "oluşturuluyor" durumunu çizmesine izin ver.
    await new Promise(resolve => requestAnimationFrame(() => resolve()));

    const surface = document.createElement('canvas');
    surface.width = size.w;
    surface.height = size.h;
    const sctx = surface.getContext('2d');
    if (!sctx) throw new Error('Canvas context could not open.');
    if (!transparent) {
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(0, 0, size.w, size.h);
    }

    const blob = await new Promise(resolve => {
      surface.toBlob(resolve, 'image/png');
    });
    if (!blob || !blob.size) throw new Error('Canvas image could not be produced.');

    const fileName = newCanvasSafeFileName(name);
    const file = new File([blob], fileName, { type: 'image/png' });
    const imageId = 'img_' + newId();
    let it = null;
    beginImageWrite();
    try {
      await idbPut('images', imageId, { blob: file, name: fileName, savedAt: Date.now() });

      const entry = await decodeImage(file);
      setImgCache(imageId, { img: entry.img, url: entry.url, name: fileName });

      // Tahtadaki görselin dünya boyutu = piksel boyutu. Böylece %100
      // yakınlaştırmada 1 px = 1 dünya birimi olur ve fırça çapı doğrudan
      // tuval pikselleriyle eşleşir.
      const base = screenToWorld({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
      it = {
        id: 'it_' + newId(),
        kind: 'image',
        imageId,
        title: name,
        name,
        x: base.x - size.w / 2,
        y: base.y - size.h / 2,
        w: size.w,
        h: size.h,
        rot: 0,
        z: nextZ(),
      };
      state.items.push(it);
    } finally {
      endImageWrite();
    }

    // Görsele bağlı çizim katmanı tam olarak seçilen piksel boyutunda.
    const layer = inkAddLayer({
      kind: 'attached',
      ownerId: it.id,
      name: 'Layer 1',
      pxW: size.w,
      pxH: size.h,
    });
    if (!layer) {
      state.items = state.items.filter(x => x.id !== it.id);
      throw new Error('Could not create the drawing layer.');
    }
    layer.pxW = size.w;
    layer.pxH = size.h;

    selection = new Set([it.id]);
    selectionOrder = [it.id];
    syncAll();

    // Tuvali referans tahtasında ortala ve sığdır; çizim editörü açılınca
    // kendi odak görünümünü kuracak.
    const vw = stage.clientWidth || innerWidth;
    const vh = stage.clientHeight || innerHeight;
    const pad = 130;
    const minScale = typeof MIN_SCALE === 'number' ? MIN_SCALE : 0.02;
    const scale = clamp(
      Math.min((vw - pad * 2) / Math.max(1, size.w), (vh - pad * 2) / Math.max(1, size.h), 1),
      minScale,
      1
    );
    state.view.scale = scale;
    state.view.x = vw / 2 - (it.x + size.w / 2) * scale;
    state.view.y = vh / 2 - (it.y + size.h / 2) * scale;
    applyView();
    syncSelection();
    scheduleSave();

    ui.busy = false;
    if (ui.els.create) ui.els.create.disabled = false;
    newCanvasClose();

    // Aynı belgeyi çizim modunda aç: yapılan çizim referans tahtasında
    // görünen tuvalin kendisidir.
    if (typeof modeEnterDraw === 'function') modeEnterDraw(it.id);
    if (typeof showProjectNotice === 'function') {
      showProjectNotice(`${name} · ${size.w} × ${size.h} px ready.`, 2200);
    }
    return true;
  } catch (error) {
    console.error('[yeni-tuval]', error);
    ui.busy = false;
    if (ui.els.create) ui.els.create.disabled = false;
    if (ui.els.info) {
      ui.els.info.textContent = 'Canvas could not be created: ' + (error && error.message ? error.message : String(error));
      ui.els.info.classList.add('is-error');
    }
    return false;
  }
}

/* DOM hazırsa bağla; değilse kısa bir kez daha dene. */
queueMicrotask(() => {
  if (!newCanvasBind()) setTimeout(newCanvasBind, 0);
});
