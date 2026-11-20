'use strict';

/* =========================================================
   FAZ 2 · Ayarlar genişlemesi — Appearance / Accessibility / Input
   ---------------------------------------------------------
   Her kontrol GERÇEK bir yeteneğe bağlıdır (sahte kontrol yok):
   • Accent color  → :root inline --accent/--accent-ink override;
                     tüm temaların accent'ini geçer; "tema varsayılanı"
                     inline override'ı kaldırıp kontrolü temaya verir.
   • Density       → :root[data-density] → bar ölçü değişkenleri
                     (--bar-h/--bar-target/...) + ayar penceresi satırları.
   • Reduce motion → html[data-reduce-motion] → motionReduced() override
                     (01-bootstrap) + CSS kanalı (rain/snow durur).
   • High contrast → html[data-hi-contrast] → --dim/--border güçlendirme;
                     tüm UI bu değişkenleri kullandığından etki geneldir.
   • Pointer info  → canlı pointerType dinleme (mouse/pen/touch) +
                     navigator.maxTouchPoints + pen basınç algısı.
   ========================================================= */

const SETTING_ACCENTS = [
  '#4da3ff', '#38bdf8', '#55c7ff', '#d97742', '#e0a458',
  '#d8c778', '#8dcc78', '#5adf9a', '#ff5c5c', '#ff9dcc',
  '#a170f2', '#b9e5ff',
];
const SETTING_DENSITY_KEY = 'tailref-density';
const SETTING_ACCENT_KEY = 'tailref-accent';
const SETTING_REDUCE_KEY = 'tailref-reduce-motion';
const SETTING_CONTRAST_KEY = 'tailref-hi-contrast';
const SETTING_UI_SCALE_KEY = 'tailref-ui-scale';

function settingAccentInkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#08121f';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  /* Açık accent üzerine koyu, koyu accent üzerine açık yazı. */
  return luma > 0.62 ? '#0d1013' : '#ffffff';
}

function settingApplyAccent(hex) {
  const root = document.documentElement;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-ink', settingAccentInkFor(hex));
  root.dataset.accent = '1';
  try { localStorage.setItem(SETTING_ACCENT_KEY, hex); } catch { /* sessiz */ }
}

function settingResetAccent() {
  const root = document.documentElement;
  root.style.removeProperty('--accent');
  root.style.removeProperty('--accent-ink');
  delete root.dataset.accent;
  try { localStorage.removeItem(SETTING_ACCENT_KEY); } catch { /* sessiz */ }
}

function settingCurrentAccent() {
  try {
    const saved = localStorage.getItem(SETTING_ACCENT_KEY);
    if (saved) return saved;
  } catch { /* sessiz */ }
  return null; // tema varsayılanı
}

function settingApplyDensity(value) {
  const root = document.documentElement;
  if (value === 'compact' || value === 'cozy') root.dataset.density = value;
  else if ('density' in root.dataset) delete root.dataset.density;
  try { localStorage.setItem(SETTING_DENSITY_KEY, String(value || 'normal')); } catch { /* sessiz */ }
}

function settingApplyReduceMotion(on) {
  const root = document.documentElement;
  if (on) root.dataset.reduceMotion = '1';
  else if ('reduceMotion' in root.dataset) delete root.dataset.reduceMotion;
  try { localStorage.setItem(SETTING_REDUCE_KEY, on ? '1' : '0'); } catch { /* sessiz */ }
}

function settingApplyHiContrast(on) {
  const root = document.documentElement;
  if (on) root.dataset.hiContrast = '1';
  else if ('hiContrast' in root.dataset) delete root.dataset.hiContrast;
  try { localStorage.setItem(SETTING_CONTRAST_KEY, on ? '1' : '0'); } catch { /* sessiz */ }
}

/* ---- UI ölçeği: webFrame zoom (preload tailref.setZoomFactor) ----
   Fizibilite kanıtı (tests/tmp-zoom-feasibility.js 13/13): stroke hatası
   zoom 1.25'te ≤0.13%, buffer keskinliği korunur (viewScale=1), tahta
   çift tık konumu sapmasız. API yoksa (web önizleme) seçenek etkisiz
   kalır ama bozulmaz — gerçek yetenek masaüstünde yaşar. */
function settingApplyUiScale(value) {
  const f = parseFloat(String(value));
  const api = window.tailref && typeof window.tailref.setZoomFactor === 'function'
    ? window.tailref : null;
  if (!api || !(f > 0)) return false;
  const applied = api.setZoomFactor(f);
  try { localStorage.setItem(SETTING_UI_SCALE_KEY, String(f)); } catch { /* sessiz */ }
  return applied === f;
}

/* ---- Accent seçici UI (idempotent; panel her açılışta tazelenir) ---- */
function settingsExtBuildAccent() {
  const row = document.getElementById('settingsAccentRow');
  if (!row || row.childElementCount) return;
  for (const hex of SETTING_ACCENTS) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'settingsAccentSwatch';
    swatch.dataset.hex = hex;
    swatch.style.background = hex;
    swatch.setAttribute('role', 'radio');
    /* Native title yasak (pill ile üst üste biniyor): data-tooltip kanalı. */
    swatch.dataset.tooltip = hex;
    swatch.setAttribute('aria-label', 'Accent ' + hex);
    swatch.addEventListener('click', () => {
      settingApplyAccent(hex);
      settingsExtSyncAccentSelection();
    });
    row.appendChild(swatch);
  }
  const def = document.createElement('button');
  def.type = 'button';
  def.className = 'settingsAccentSwatch';
  def.dataset.role = 'default';
  def.setAttribute('role', 'radio');
  /* Native title yasak: data-tooltip kanalı. */
  try {
    def.dataset.tooltip = window.L10N ? window.L10N.t('Theme default') : 'Theme default';
  } catch { def.dataset.tooltip = 'Theme default'; }
  def.setAttribute('aria-label', def.dataset.tooltip);
  def.addEventListener('click', () => {
    settingResetAccent();
    settingsExtSyncAccentSelection();
  });
  row.appendChild(def);
}

function settingsExtSyncAccentSelection() {
  const row = document.getElementById('settingsAccentRow');
  if (!row) return;
  const current = settingCurrentAccent();
  for (const swatch of row.querySelectorAll('.settingsAccentSwatch')) {
    const on = swatch.dataset.role === 'default'
      ? current === null
      : swatch.dataset.hex === current;
    swatch.setAttribute('aria-pressed', String(on));
  }
}

/* ---- İşaretçi (pointer) tanılama — gerçek canlı algılama ---- */
const settingsPointerSeen = new Set();
let settingsPointerPenPressure = false;

function settingsPointerSummary() {
  const parts = [];
  if (settingsPointerSeen.has('mouse')) parts.push('Mouse');
  if (settingsPointerSeen.has('pen')) {
    parts.push(settingsPointerPenPressure && window.L10N
      ? `${window.L10N.t('Pen')} (${window.L10N.t('pressure detected')})`
      : 'Pen');
  }
  if (settingsPointerSeen.has('touch')) parts.push('Touch');
  const touch = (navigator.maxTouchPoints || 0);
  const tail = window.L10N && touch
    ? ` · ${touch} ${window.L10N.t('touch points')}` : '';
  return (parts.length ? parts.map(p => {
    if (p === 'Mouse') return window.L10N ? window.L10N.t('Mouse') : p;
    if (p === 'Pen') return window.L10N ? window.L10N.t('Pen') : p;
    if (p === 'Touch') return window.L10N ? window.L10N.t('Touch') : p;
    return p;
  }).join(' · ') + tail : (window.L10N
    ? window.L10N.t('Move the pointer to detect devices')
    : 'Move the pointer to detect devices'));
}

function settingsPointerOnEvent(event) {
  const type = event.pointerType;
  if (type && !settingsPointerSeen.has(type)) {
    settingsPointerSeen.add(type);
    settingsExtSyncPointer();
    return;
  }
  if (type === 'pen' && !settingsPointerPenPressure
      && Number(event.pressure) > 0 && Number(event.pressure) !== 0.5) {
    settingsPointerPenPressure = true;
    settingsExtSyncPointer();
  }
}

function settingsExtSyncPointer() {
  const info = document.getElementById('settingsPointerInfo');
  if (info) info.textContent = settingsPointerSummary();
}

/* ---- Panel açılışında tazelenen birleşik sync ---- */
function settingsExtSync() {
  settingsExtBuildAccent();
  settingsExtSyncAccentSelection();
  settingsExtSyncPointer();
  /* Yoğunluk seçimi kayıtlı değeri gösterir; aksi halde panel "Normal"
     yazarken arayüz "Compact" kalıyordu. */
  try {
    const density = document.getElementById('settingsDensitySelect');
    if (density) density.value = localStorage.getItem(SETTING_DENSITY_KEY) || 'normal';
  } catch { /* sessiz */ }
  /* UI ölçeği: panel her açılışta kayıtlı değeri gösterir. */
  try {
    const uiScale = document.getElementById('settingsUiScaleSelect');
    if (uiScale) {
      const saved = localStorage.getItem(SETTING_UI_SCALE_KEY) || '1';
      uiScale.value = saved;
    }
  } catch { /* sessiz */ }
}

/* ---- Boot: kayıtlı tercihleri uygula + dinleyicileri kur ---- */
try {
  const savedAccent = localStorage.getItem(SETTING_ACCENT_KEY);
  if (savedAccent) settingApplyAccent(savedAccent);
  settingApplyDensity(localStorage.getItem(SETTING_DENSITY_KEY) || 'normal');
  settingApplyReduceMotion(localStorage.getItem(SETTING_REDUCE_KEY) === '1');
  settingApplyHiContrast(localStorage.getItem(SETTING_CONTRAST_KEY) === '1');
  settingApplyUiScale(localStorage.getItem(SETTING_UI_SCALE_KEY) || '1');
} catch { /* sessiz */ }

{
  const density = document.getElementById('settingsDensitySelect');
  if (density && !density.dataset.extBound) {
    density.dataset.extBound = '1';
    density.onchange = () => settingApplyDensity(density.value);
  }

  const uiScale = document.getElementById('settingsUiScaleSelect');
  if (uiScale && !uiScale.dataset.extBound) {
    uiScale.dataset.extBound = '1';
    uiScale.onchange = () => settingApplyUiScale(uiScale.value);
  }

  const bindExtToggle = (id, apply) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.extBound) return;
    el.dataset.extBound = '1';
    el.addEventListener('click', () => {
      const on = el.getAttribute('aria-pressed') !== 'true';
      apply(on);
      el.setAttribute('aria-pressed', String(on));
      el.textContent = on ? __t('On') : __t('Off');
    });
  };
  bindExtToggle('settingsReduceMotion', settingApplyReduceMotion);
  bindExtToggle('settingsHiContrast', settingApplyHiContrast);

  /* Toggle'ların AÇILIŞ durumunu kayıttan senkronla (aria-pressed + metin). */
  const syncToggleState = (id, on) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('aria-pressed', String(!!on));
    el.textContent = on ? __t('On') : __t('Off');
  };
  syncToggleState('settingsReduceMotion',
    document.documentElement.dataset.reduceMotion === '1');
  syncToggleState('settingsHiContrast',
    document.documentElement.dataset.hiContrast === '1');

  /* Pointer dinleyicileri: capture + passive — çizim performansına dokunmaz. */
  window.addEventListener('pointermove', settingsPointerOnEvent, { passive: true, capture: true });
  window.addEventListener('pointerdown', settingsPointerOnEvent, { passive: true, capture: true });
  window.addEventListener('pointerrawupdate', settingsPointerOnEvent, { passive: true, capture: true });

  /* Dil değişince pointer özeti de çevrilir. */
  if (window.L10N && typeof window.L10N.onChange === 'function') {
    window.L10N.onChange(() => { try { settingsExtSyncPointer(); } catch { /* sessiz */ } });
  }
}
