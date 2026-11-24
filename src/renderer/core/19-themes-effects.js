/* TailRef app · rain/snow effects, themes */
'use strict';

/* ---------------- tema seçimi (V2) ---------------- */
const themeNames = ['classic', 'obsidian', 'midnight', 'cutting-mat', 'graphite', 'paper', 'forest', 'rain', 'snow', 'candy'];
let themeIndex = 0;
const themeSelect = $('#themeSelect');
const themeSelectOverflow = $('#themeSelectOverflow');

/* ---------------- Rain tema animasyonu ---------------- */
const rainCanvas = $('#rainCanvas');
const rainCtx = rainCanvas && rainCanvas.getContext('2d');
let rainDrops = [];
let rainFrame = 0;
let rainWidth = 0;
let rainHeight = 0;

/* Ortam efekti türü: gömülü rain/snow + özel temada taşınan efekt
   (kayıt defteri 'effect' alanı). Kare başına localStorage okumamak için
   liste değişiminde tazelenen bir harita kullanılır. */
let ambientEffectByTheme = {};
function ambientEffectKind() {
  const t = document.documentElement.dataset.theme || 'classic';
  if (t === 'rain' || t === 'snow') return t;
  return ambientEffectByTheme[t] || null;
}
function ambientEffectCacheRefresh() {
  ambientEffectByTheme = {};
  try {
    const reg = window.tailrefThemeRegistry;
    if (reg && typeof reg.list === 'function') {
      for (const t of reg.list()) {
        if (t && (t.effect === 'rain' || t.effect === 'snow')) {
          ambientEffectByTheme[t.id] = t.effect;
        }
      }
    }
  } catch { /* sessiz */ }
  ambientSyncDataset();
}
/* Tuval görünürlüğü CSS'te data-theme="rain|snow" ile kuruluyor; özel tema
   kimliği ct_... olduğu için o kural tutmuyordu (yağmur/kar görünmüyordu).
   Etkin efekt türü data-ambient'e yazılır; CSS bu attribute'u da dinler. */
function ambientSyncDataset() {
  const root = document.documentElement;
  const kind = ambientEffectKind();
  if (kind) root.dataset.ambient = kind;
  else if ('ambient' in root.dataset) delete root.dataset.ambient;
}
function ambientEnsureRunning() {
  ambientSyncDataset();
  if (!ambientEffectsOn()) return;
  const kind = ambientEffectKind();
  if (kind === 'rain' && !rainFrame) rainFrame = requestAnimationFrame(animateRain);
  if (kind === 'snow' && !snowFrame) snowFrame = requestAnimationFrame(animateSnow);
}
document.addEventListener('tailref-custom-themes-changed', ambientEffectCacheRefresh);
window.tailrefAmbientEffectKind = ambientEffectKind;
ambientEffectCacheRefresh();
function resizeRain() {
  if (!rainCanvas || !rainCtx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  rainWidth = window.innerWidth;
  rainHeight = window.innerHeight;
  rainCanvas.width = Math.round(rainWidth * dpr);
  rainCanvas.height = Math.round(rainHeight * dpr);
  rainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = Math.max(70, Math.min(190, Math.round(rainWidth / 8)));
  rainDrops = Array.from({ length: count }, () => ({
    x: Math.random() * rainWidth,
    y: Math.random() * rainHeight,
    length: 9 + Math.random() * 20,
    speed: 7 + Math.random() * 11,
    drift: 1.5 + Math.random() * 2.5,
    alpha: .16 + Math.random() * .3,
  }));
}
function animateRain() {
  if (!rainCtx) return;
  const isRain = ambientEffectKind() === 'rain';
  if (!isRain) {
    rainCtx.clearRect(0, 0, rainWidth, rainHeight);
    rainFrame = 0;
    return;
  }
  rainCtx.clearRect(0, 0, rainWidth, rainHeight);
  rainCtx.lineWidth = 1;
  for (const drop of rainDrops) {
    rainCtx.strokeStyle = `rgba(125, 207, 255, ${drop.alpha})`;
    rainCtx.beginPath();
    rainCtx.moveTo(drop.x, drop.y);
    rainCtx.lineTo(drop.x - drop.drift, drop.y + drop.length);
    rainCtx.stroke();
    drop.x -= drop.drift;
    drop.y += drop.speed;
    if (drop.y > rainHeight + drop.length) {
      drop.y = -drop.length - Math.random() * 80;
      drop.x = Math.random() * rainWidth;
    }
    if (drop.x < -20) drop.x = rainWidth + 20;
  }
  rainFrame = requestAnimationFrame(animateRain);
}
window.addEventListener('resize', resizeRain);
resizeRain();

const snowCanvas = $('#snowCanvas');
const snowCtx = snowCanvas && snowCanvas.getContext('2d');
let snowFlakes = [];
let snowFrame = 0;
let snowWidth = 0;
let snowHeight = 0;
function resizeSnow() {
  if (!snowCanvas || !snowCtx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  snowWidth = window.innerWidth;
  snowHeight = window.innerHeight;
  snowCanvas.width = Math.round(snowWidth * dpr);
  snowCanvas.height = Math.round(snowHeight * dpr);
  snowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = Math.max(55, Math.min(135, Math.round(snowWidth / 12)));
  snowFlakes = Array.from({ length: count }, () => ({
    x: Math.random() * snowWidth,
    y: Math.random() * snowHeight,
    size: 1.2 + Math.random() * 3.4,
    speed: .35 + Math.random() * .8,
    sway: Math.random() * Math.PI * 2,
    swaySpeed: .008 + Math.random() * .018,
    alpha: .35 + Math.random() * .55,
  }));
}
function animateSnow() {
  if (!snowCtx) return;
  const isSnow = ambientEffectKind() === 'snow';
  if (!isSnow) {
    snowCtx.clearRect(0, 0, snowWidth, snowHeight);
    snowFrame = 0;
    return;
  }
  snowCtx.clearRect(0, 0, snowWidth, snowHeight);
  for (const flake of snowFlakes) {
    flake.sway += flake.swaySpeed;
    flake.x += Math.sin(flake.sway) * .28;
    flake.y += flake.speed;
    if (flake.y > snowHeight + 8) {
      flake.y = -8;
      flake.x = Math.random() * snowWidth;
    }
    snowCtx.beginPath();
    snowCtx.fillStyle = `rgba(235, 249, 255, ${flake.alpha})`;
    snowCtx.shadowColor = 'rgba(190, 230, 255, .65)';
    snowCtx.shadowBlur = flake.size * 2;
    snowCtx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2);
    snowCtx.fill();
  }
  snowCtx.shadowBlur = 0;
  snowFrame = requestAnimationFrame(animateSnow);
}
window.addEventListener('resize', resizeSnow);
resizeSnow();
/* Ortam efektleri anahtarı (aday 8): yağmur/karı animasyonlarını
   "hareketi azalt"tan bağımsız aç/kapa. Anahtar yoksa → açık
   (mevcut davranış). '0' → temalar yağmur/kârı olsa da animasyon
   koşmaz, tuval temiz kalır. */
function ambientEffectsOn() {
  try { return localStorage.getItem('tailref-ambient-effects') !== '0'; } catch { return true; }
}
function ambientEffectsStop() {
  if (rainFrame) { cancelAnimationFrame(rainFrame); rainFrame = 0; }
  if (snowFrame) { cancelAnimationFrame(snowFrame); snowFrame = 0; }
  if (rainCtx && rainWidth) rainCtx.clearRect(0, 0, rainWidth, rainHeight);
  if (snowCtx && snowWidth) snowCtx.clearRect(0, 0, snowWidth, snowHeight);
}
window.tailrefAmbientEffectsOn = ambientEffectsOn;
window.tailrefAmbientEffectsSet = function (on) {
  try { localStorage.setItem('tailref-ambient-effects', on ? '1' : '0'); } catch { /* sessiz */ }
  if (!on) { ambientEffectsStop(); return; }
  ambientEnsureRunning();
};
function applyTheme(name) {
  if (!themeNames.includes(name)) name = 'classic';
  /* Aynı tema tekrar uygulanırsa pahalı önizleme yenileme atlanır:
     mod geçişinde aynı tema defalarca "uygulanır" ve bu, editörün ilk
     vuruş canlı önizlemesini tıkayabiliyordu (ink-commit-check). */
  const prev = document.documentElement.dataset.theme || 'classic';
  if (prev === name) {
    if (themeSelect) themeSelect.value = name;
    if (themeSelectOverflow) themeSelectOverflow.value = name;
    /* Aynı id'ye efekt sonradan eklenmiş olabilir (özel tema düzenlemesi):
       animasyonu yine de başlat. */
    ambientEnsureRunning();
    return;
  }
  themeIndex = themeNames.indexOf(name);
  if (name === 'classic') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = name;
  ambientEnsureRunning();
  try { localStorage.setItem('tailref-theme', name); } catch { /* sessiz */ }
  if (themeSelect) themeSelect.value = name;
  if (themeSelectOverflow) themeSelectOverflow.value = name;
  /* Fırça kartı önizlemeleri tema metin rengiyle çizilir. Kartlar bir kez
     üretildiği için tema değişince tuval pikselleri eski renkte kalıyordu.
     Bir sonraki karede (tüm modüller yüklendikten sonra) yeniden boya. */
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      try {
        if (typeof inkNativeRefreshPreviews === 'function') inkNativeRefreshPreviews();
      } catch { /* sessiz */ }
    });
  }
}

/* =========================================================
   MOD-BAŞINA TEMA — Çizim ve Referans kendi temasını taşır.
   Mode değişince modun tema harci uygulanır (3D son uygulamada
   kalan temayı sürdürür; 3D panel kendi görünümünü yönetir).
   Eski tek anahtar (tailref-theme) her iki modun başlangıç
   değeri olur; kullanıcı değiştirince mod anahtarına yazılır.
   ========================================================= */
const THEME_MODE_KEYS = {
  draw: 'tailref-theme-draw',
  reference: 'tailref-theme-reference',
};
function themeGet(mode) {
  try {
    const stored = localStorage.getItem(THEME_MODE_KEYS[mode] || '');
    if (stored && themeNames.includes(stored)) return stored;
  } catch { /* sessiz */ }
  // Geriye dönük uyum: daha önce tek tema vardı; onu her iki mod için başlat.
  try { return localStorage.getItem('tailref-theme') || 'classic'; } catch { return 'classic'; }
}
function themeSet(mode, name) {
  if (!themeNames.includes(name)) return;
  try { localStorage.setItem(THEME_MODE_KEYS[mode] || 'tailref-theme', name); } catch { /* sessiz */ }
  const cur = themeModeNow();
  if (cur === mode || !THEME_MODE_KEYS[cur]) applyTheme(name);
}
/* Galeri/tema stüdyosu için: seçimi YALNIZ görünüme uygulamakla kalma,
   aktif modun anahtarına da yaz. Aksi hâlde çizimde seçilen tema mod
   değişiminde eski anahtara geri dönüyordu (tema "bazen bozuluyor"). */
function themeApplyForMode(name) {
  const mode = themeModeNow();
  const reg = window.tailrefThemeRegistry;
  if (reg && typeof reg.isCustom === 'function' && reg.isCustom(name)) {
    if (typeof reg.apply === 'function') reg.apply(name);
    try { localStorage.setItem(THEME_MODE_KEYS[mode] || 'tailref-theme', name); } catch { /* sessiz */ }
    return;
  }
  themeSet(mode, name);
}
window.tailrefThemeApplyForMode = themeApplyForMode;
function themeModeNow() {
  const body = document.body;
  if (body && body.classList.contains('mode-draw')) return 'draw';
  if (body && body.classList.contains('mode-3d')) return '3d';
  return 'reference';
}
window.tailrefThemes = {
  names: themeNames,
  get: themeGet,
  set: themeSet,
  modeNow: themeModeNow,
  applyDraw: name => themeSet('draw', name),
  applyReference: name => themeSet('reference', name),
};
/* Program aktif moda göre mod temasına uyar; 'tailref-mode-changed'
   (39-mode.js) hem sekme hem kısayol geçişlerinde aynı kapıyı kullanır. */
window.addEventListener('tailref-mode-changed', event => {
  const mode = event.detail && event.detail.mode;
  if (mode === 'draw') applyTheme(themeGet('draw'));
  else if (mode === 'reference') applyTheme(themeGet('reference'));
  /* '3d' → tema değişmez; son uygulamada kalan görünüm sürdürülür. */
  /* Tema sırada gizli kalan fırça önizlemeleri: modun panelleri yerleşince
     bir kez boşalt (darbokaz düzeltmesi; boş çağrı ~0 ms). */
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      try { if (typeof inkPreviewFlushStale === 'function') inkPreviewFlushStale(); } catch { /* sessiz */ }
    });
  }
});
try { applyTheme(localStorage.getItem('tailref-theme') || 'classic'); }
catch { applyTheme('classic'); }
if (themeSelect) themeSelect.onchange = () => themeSet(themeModeNow() === 'draw' ? 'draw' : 'reference', themeSelect.value);
if (themeSelectOverflow) themeSelectOverflow.onchange = () => themeSet(themeModeNow() === 'draw' ? 'draw' : 'reference', themeSelectOverflow.value);
function watchThemeMenu(select) {
  if (!select) return;
  select.addEventListener('focus', () => { themeMenuOpen = true; });
  select.addEventListener('blur', () => { themeMenuOpen = false; });
  select.addEventListener('pointerdown', () => { themeMenuOpen = true; });
  select.addEventListener('change', () => { themeMenuOpen = false; });
  select.addEventListener('keydown', e => {
    if (e.key === 'Escape') themeMenuOpen = false;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') themeMenuOpen = true;
  });
}
watchThemeMenu(themeSelect);
