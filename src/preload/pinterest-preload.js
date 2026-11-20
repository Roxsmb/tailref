'use strict';

/* Pinterest konuk sayfası (uygulama içi <webview>) için ön yükleyici.
   Sayfadaki görsellerin üzerine gelince küçük bir "Tahtaya ekle" düğmesi
   gösterir; tıklanınca görsel adresini ana pencereye yollar. Ana pencere
   baytları indirip tahtaya ekler ve sonucu buraya geri bildirir.

   Not: Bu betik Pinterest sayfasının içinde çalışır; ana uygulamanın
   DOM'una erişmez, yalnızca sendToHost/on mesajlarını kullanır. */

const { ipcRenderer } = require('electron');

const PICK_ID = 'tailref-pick';
const MIN_NATURAL = 200;   // avatar/ikonları ele
const MIN_DISPLAY = 140;
const MAX_BATCH = 20;      // "Görünenleri ekle" için üst sınır

/* Düğme etiketleri: ana uygulama güncel dile göre üretip
   'pinterest-labels' kanalıyla yollar; istek 'pinterest-labels-request'.
   Başlangıç değerleri, uygulama yanıt verene kadarki yedektir. */
let labels = {
  idle: '＋ Tahtaya ekle',
  busy: '… Ekleniyor',
  ok: '✓ Eklendi',
  err: '✕ Alınamadı',
  aria: 'Seçili Pinterest görselini tahtaya ekle',
};

function applyLabels(next) {
  if (!next || typeof next !== 'object') return;
  for (const key of ['idle', 'busy', 'ok', 'err', 'aria']) {
    if (typeof next[key] === 'string' && next[key]) labels[key] = next[key];
  }
  if (button) {
    if (typeof labels.aria === 'string') button.setAttribute('aria-label', labels.aria);
    if (!busy) button.textContent = labels.idle;
  }
}

let button = null;
let targetImg = null;
let hideTimer = 0;
let busy = false;

/* ---------- görsel seçimi ---------- */

function bestImageUrl(img) {
  let bestWidth = -1;
  let best = '';
  const srcset = img.getAttribute('srcset') || '';
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/);
    const url = bits[0];
    if (!url) continue;
    const descriptor = (bits[1] || '').toLowerCase();
    let width = 0;
    if (descriptor.endsWith('w')) width = parseFloat(descriptor) || 0;
    else if (descriptor.endsWith('x')) width = (parseFloat(descriptor) || 1) * (img.naturalWidth || 0);
    if (width > bestWidth) { bestWidth = width; best = url; }
  }
  return best || img.currentSrc || img.src || '';
}

function isPhotoUrl(src) {
  try {
    const url = new URL(src);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    // Pinterest CDN'i + yerel test fixture'ları. Boyut kontrolü avatarları eler.
    return /(^|\.)pinimg\.com$/i.test(url.hostname)
      || url.hostname === '127.0.0.1'
      || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

function imageAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (button && button.contains(el)) return null;

  let img = el.tagName === 'IMG' ? el : null;
  if (!img && el.closest) {
    // Pinterest görselin üzerine tıklama katmanı koyabiliyor.
    const link = el.closest('a[href*="/pin/"]');
    img = link ? link.querySelector('img') : null;
  }
  if (!img) return null;

  if (!isPhotoUrl(img.currentSrc || img.src || '')) return null;
  if ((img.naturalWidth || 0) < MIN_NATURAL) return null;
  const rect = img.getBoundingClientRect();
  if (rect.width < MIN_DISPLAY || rect.height < MIN_DISPLAY) return null;
  return img;
}

/* ---------- görünenleri toplama ---------- */

/* O an ekranda duran, yeterince büyük Pinterest görsellerini sırayla döndürür.
   Kaydırma yapmaz, arka planda gezinmez; yalnızca kullanıcının gördüğü alan. */
function visibleImages() {
  const seen = new Set();
  const found = [];
  const width = innerWidth;
  const height = innerHeight;

  for (const img of document.images) {
    const url = bestImageUrl(img);
    if (!url || seen.has(url) || !isPhotoUrl(url)) continue;
    if ((img.naturalWidth || 0) < MIN_NATURAL) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < MIN_DISPLAY || rect.height < MIN_DISPLAY) continue;
    // Görselin en az bir parçası görünür alanda olmalı.
    if (rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width) continue;
    seen.add(url);
    found.push({ url, top: rect.top, title: img.alt || '' });
  }

  found.sort((a, b) => a.top - b.top);
  return found.slice(0, MAX_BATCH).map(item => ({ url: item.url, title: item.title }));
}

/* ---------- düğme ---------- */

function ensureButton() {
  if (button) return;
  const style = document.createElement('style');
  style.id = 'tailref-pick-style';
  style.textContent = `
    #${PICK_ID}{
      position:fixed!important;
      z-index:2147483647!important;
      display:inline-flex!important;
      align-items:center!important;
      justify-content:center!important;
      height:32px!important;
      padding:0 13px!important;
      margin:0!important;
      border-radius:999px!important;
      border:1px solid rgba(77,163,255,.55)!important;
      background:rgba(21,21,26,.94)!important;
      color:#f1f3f4!important;
      font:600 12px/1 'Inter',BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif!important;
      letter-spacing:.1px!important;
      box-shadow:0 6px 20px rgba(0,0,0,.45)!important;
      backdrop-filter:blur(8px)!important;
      cursor:pointer!important;
      white-space:nowrap!important;
      pointer-events:auto!important;
      transform:none!important;
      opacity:1!important;
    }
    #${PICK_ID}:hover{background:#4da3ff!important;color:#07131d!important;border-color:#4da3ff!important}
    #${PICK_ID}[disabled]{opacity:.82!important;cursor:default!important}
    #${PICK_ID}[hidden]{display:none!important}
  `;
  (document.head || document.documentElement).appendChild(style);

  button = document.createElement('button');
  button.id = PICK_ID;
  button.type = 'button';
  button.textContent = labels.idle;
  button.hidden = true;
  button.setAttribute('aria-label', labels.aria);
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    pick();
  }, true);
  button.addEventListener('mouseenter', () => { clearTimeout(hideTimer); });
  button.addEventListener('mouseleave', () => { if (!busy) hideButton(); });
  document.documentElement.appendChild(button);
}

function showButton(img) {
  ensureButton();
  targetImg = img;
  const rect = img.getBoundingClientRect();
  const width = button.offsetWidth || 132;
  const height = button.offsetHeight || 32;
  const left = Math.max(8, Math.min(innerWidth - width - 8, rect.right - width - 10));
  const top = Math.max(8, Math.min(innerHeight - height - 8, rect.bottom - height - 10));
  button.style.left = `${Math.round(left)}px`;
  button.style.top = `${Math.round(top)}px`;
  button.hidden = false;
  clearTimeout(hideTimer);
}

function hideButton() {
  clearTimeout(hideTimer);
  if (!button || busy) return;
  button.hidden = true;
  targetImg = null;
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideButton, 220);
}

function pick() {
  if (!targetImg || busy) return;
  const url = bestImageUrl(targetImg);
  if (!url) return;
  busy = true;
  button.disabled = true;
  button.textContent = labels.busy;
  ipcRenderer.sendToHost('pinterest-pick', { url, title: targetImg.alt || '' });
  // Ana pencere yanıt vermezse düğme kilitli kalmasın.
  setTimeout(() => {
    if (!busy) return;
    busy = false;
    if (button) { button.disabled = false; button.textContent = labels.idle; }
  }, 20000);
}

ipcRenderer.on('pinterest-pick-result', (_event, result) => {
  busy = false;
  if (!button) return;
  button.disabled = false;
  const ok = !!(result && result.ok);
  button.textContent = ok ? labels.ok : labels.err;
  setTimeout(() => {
    if (!button) return;
    button.textContent = labels.idle;
    hideButton();
  }, ok ? 1100 : 1800);
});

/* Ana uygulamadan güncel dil etiketleri: istek → yanıt akışı. */
ipcRenderer.on('pinterest-labels', (_event, next) => applyLabels(next));
try { ipcRenderer.sendToHost('pinterest-labels-request'); } catch { /* sessiz */ }

ipcRenderer.on('pinterest-collect', () => {
  let items = [];
  try {
    items = visibleImages();
  } catch {
    items = [];
  }
  ipcRenderer.sendToHost('pinterest-collected', { items });
});

/* ---------- olaylar ---------- */

document.addEventListener('mousemove', event => {
  if (busy) return;
  if (button && button.contains(event.target)) return;
  const img = imageAt(event.clientX, event.clientY);
  if (img) showButton(img);
  else scheduleHide();
}, true);

window.addEventListener('scroll', () => hideButton(), true);
window.addEventListener('resize', () => hideButton());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideButton();
}, true);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureButton, { once: true });
} else {
  ensureButton();
}
