'use strict';
/* ======================================================================
   TailRef · Tur T Faz 2 — Arayüz kayıt defteri (15 Kasım 2026)
   ======================================================================
   Tema (renk paleti) ve Arayüz (bileşen tasarım dili) BAĞIMSIZ iki
   katmandır (spec PART 5). Bu modül arayüz seçimini yönetir:
   - documentElement.dataset.interface = id (classic → attribute yok,
     görsel değişiklik YOK — parite).
   - Arayüze özel sunum CSS'i <link data-ui-skin="..."> üzerinden
     enable/disable edilir (link yoksa o arayüz seçilemez — sahte
     kontol yasak; Faz 4 ui-win95.css eklendiğinde kayıta girer).
   - Paket mimarisi (Faz 6) register() ile genişler: doğrulanmış
     dekleratif paket tanımı buraya bağlanır; JS yürütülmez.
   Depo: localStorage 'tailref-interface' ('classic' varsayılan).
   ====================================================================== */

const UI_INTERFACE_KEY = 'tailref-interface';
/* Gömülü arayüzler. classic DAIMA mevcut TailRef sunumu — varsayılan,
   yeniden tasarlanmaz. Yeni preset yalnızca skin CSS dosyası projeye
   eklendiğinde bu listeye girer (skin dosyasız arayüz sahte olur). */
const uiInterfaceDefs = [
  { id: 'classic', name: 'TailRef Classic', version: 1, builtin: true,
    desc: 'The current TailRef interface — default, always available.' },
  /* Tur T Faz 4: SGI IRIX 4Dwm — ui-irix.css skin'i ile. Skin link
     belgelerde var; registry yalnızca enable/disable eder. Kullanıcı
     kararı: preset = IRIX (kendi arayüzümüz classic + IRIX; ileride
     yeni arayüzler register() ile gelir). */
  { id: 'irix', name: 'SGI IRIX 4Dwm', version: 1, builtin: true, wip: true,
    desc: 'SGI IRIX / Indigo Magic Desktop: thick Motif 4Dwm bevels, plum and indigo title bars, Helvetica, petrol teal workspace, square corners. Colors still follow the theme.' },
];

/* Skin kaynağı: builtin'lerde <link data-ui-skin>, Faz 6 paketlerinde
   <style data-ui-skin> (derlenmiş dekleratif CSS). İkisi de aynı
   kontratla açılır/kapanır. */
function uiInterfaceSkinEl(id) {
  return document.querySelector(
    'link[data-ui-skin="' + CSS.escape(id) + '"],style[data-ui-skin="' + CSS.escape(id) + '"]');
}
/* Skin'i aç/kapat. on=true → AÇIK. <style> elementinde disabled
   etkisizdir — media geçişi kullanılır. DİKKAT: LINK dalında atama
   TERSİNE (!on) — disabled özelliği "kapalı" anlamına gelir. */
function uiInterfaceSkinToggle(skin, on) {
  if (!skin) return;
  if (skin.tagName === 'LINK') skin.disabled = !on;
  else skin.media = on ? '' : 'not all';
}
function uiInterfaceList() { return uiInterfaceDefs.slice(); }
function uiInterfaceActive() {
  try { return localStorage.getItem(UI_INTERFACE_KEY) || 'classic'; } catch { return 'classic'; }
}
/** Arayüz uygula. classic → data-interface yok + tüm skin'ler kapalı.
    Diğerleri → dataset + kendi skin'i açık, diğer kapalı. Skin kaynağı
    belgelerde yoksa seçim REDDEDİLİR (false) — mevcut görünüm korunur. */
function uiInterfaceApply(id) {
  const def = uiInterfaceDefs.find(d => d.id === id);
  if (!def) return false;
  const skin = uiInterfaceSkinEl(id);
  if (id !== 'classic' && !skin) return false;
  for (const el of document.querySelectorAll('link[data-ui-skin],style[data-ui-skin]')) {
    if (el !== skin) uiInterfaceSkinToggle(el, false);
  }
  uiInterfaceSkinToggle(skin, true);
  if (id === 'classic') delete document.documentElement.dataset.interface;
  else document.documentElement.dataset.interface = id;
  try { localStorage.setItem(UI_INTERFACE_KEY, id); } catch { /* sessiz */ }
  document.dispatchEvent(new CustomEvent('tailref-interface-changed',
    { detail: { id, def } }));
  return true;
}
/** Faz 6: paket kaydı. Doğrulama 02d-ui-package-format.js'te; burada
    yalnız skin kaynağı olan tanımlar kabul edilir (register anında
    skin yoksa bile kabul — 02e enjeksiyonu register'dan ÖNCE yapar;
    belge kapanınca eski haline döner, kalıcı zarar yok). */
function uiInterfaceRegister(def) {
  if (!def || typeof def.id !== 'string' || !def.id || def.builtin) return false;
  if (uiInterfaceDefs.some(d => d.id === def.id)) return false;
  uiInterfaceDefs.push({
    id: def.id, name: String(def.name || def.id).slice(0, 40),
    version: +def.version || 1, builtin: false,
    desc: String(def.desc || '').slice(0, 200), packaged: true,
  });
  document.dispatchEvent(new CustomEvent('tailref-interface-changed',
    { detail: { registered: def.id } }));
  return true;
}
/** Faz 6: paket kaldırma (yalnız packaged kayıtlar). */
function uiInterfaceUnregister(id) {
  const idx = uiInterfaceDefs.findIndex(d => d.id === id && !d.builtin);
  if (idx < 0) return false;
  uiInterfaceDefs.splice(idx, 1);
  document.dispatchEvent(new CustomEvent('tailref-interface-changed',
    { detail: { unregistered: id } }));
  return true;
}
window.tailrefInterfaces = {
  list: uiInterfaceList,
  apply: uiInterfaceApply,
  active: uiInterfaceActive,
  register: uiInterfaceRegister,
  unregister: uiInterfaceUnregister,
};
/* Boot: kayıtlı arayüz. Skin link yüklenmemişse (Faz 4 öncesi)
   classic'te kalır — sessiz güvenli düşüş, parite korunur. */
setTimeout(() => {
  try {
    const saved = uiInterfaceActive();
    if (saved && saved !== 'classic') uiInterfaceApply(saved);
  } catch { /* sessiz */ }
}, 0);
