/* =========================================================
   60-settings-hub.js — TEK AYARLAR penceresi
   ---------------------------------------------------------
   Üst mod çubuğundaki ⋯ düğmesi her modda (3D/Çizim/Referans)
   aynı yerde durur ve bu pencereyi açar. Şema:
     · GENEL ayarlar (dil, kayıt, yedek) — tüm programı etkiler
     · ÇİZİM sütunu (tema + çizime özel ayarlar) + "?" açıklaması
     · REFERANS sütunu (tema) + "?" açıklaması
   Alt bant: hata bildirme adresi.
   Çizim değerleri draw-v5.js'in window.inkV5Settings köprüsünden
   gelir (o betik app.js'ten SONRA yüklenir; değerler açılış
   anında okunur).
   ========================================================= */
'use strict';

window.settingsHubToggle = function settingsHubToggle() {
  const visible = openStudioPanel(settingsEl);
  if (!visible) return;
  settingsNavInit();
  /* Son kategori hatırlanır (kapatıp açınca aynı yerde devam). */
  let cat = 'general';
  try { cat = localStorage.getItem('tailref-settings-cat') || 'general'; } catch { /* sessiz */ }
  if (!document.querySelector('#settingsNav .settingsNavItem[data-cat="' + cat + '"]')) cat = 'general';
  settingsNavSelect(cat);
  settingsHubSync();
};

/* Dişli tutamacı (araç çubuğu grip) tık hattı — draw-v5.js
   bindToolbarDrag'ın !moved dalından çağrılır: Ayarlar penceresini
   doğrudan ÇİZİM sayfasında açar. openStudioPanel toggle olduğu için
   (açık + önde → kapatır) kapatma yan etkisini ikinci çağrıyla geri
   alırız: net etki her koşulda "açık ve önde" olur. Detached pencere
   modunda ise yalnız o pencere öne getirilir. */
window.settingsHubOpenDrawing = function settingsHubOpenDrawing() {
  if (typeof openStudioPanel !== 'function' || !settingsEl) return false;
  let visible = openStudioPanel(settingsEl);
  if (!visible) visible = openStudioPanel(settingsEl);
  if (!visible) return false;
  settingsNavInit();
  settingsNavSelect('drawing');
  settingsHubSync();
  return true;
};

/* ---- Kategori navigasyonu (Tur S iki panel) ----
   Nav item'ların data-help'i header'daki #settingsCatDesc'e yazılır;
   çeviri data-l10n-help → data-help kanalından gelir (01b-l10n). */
const settingsNavEl = () => document.getElementById('settingsNav');

function settingsNavSelect(cat) {
  for (const item of document.querySelectorAll('#settingsNav .settingsNavItem')) {
    const on = item.dataset.cat === cat;
    item.setAttribute('aria-selected', String(on));
  }
  for (const page of document.querySelectorAll('#settings .settingsPage')) {
    page.hidden = page.dataset.page !== cat;
  }
  const desc = document.getElementById('settingsCatDesc');
  const item = document.querySelector('#settingsNav .settingsNavItem[data-cat="' + cat + '"]');
  if (desc) desc.textContent = item ? (item.getAttribute('data-help') || '') : '';
  try { localStorage.setItem('tailref-settings-cat', cat); } catch { /* sessiz */ }
}

function settingsNavInit() {
  const nav = settingsNavEl();
  if (!nav || nav.dataset.navBound) return;
  nav.dataset.navBound = '1';
  nav.addEventListener('click', e => {
    const btn = e.target.closest('.settingsNavItem');
    if (btn && btn.dataset.cat) settingsNavSelect(btn.dataset.cat);
  });
  /* Klavye: ok tuşlarıyla kategori gezinme (Home/End dahil). */
  nav.addEventListener('keydown', e => {
    if (!e.target.classList.contains('settingsNavItem')) return;
    const items = [...nav.querySelectorAll('.settingsNavItem')];
    const idx = items.indexOf(e.target);
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      items[next].focus();
      settingsNavSelect(items[next].dataset.cat);
    }
  });
}

function settingsHubPopulateThemes() {
  for (const id of ['settingsThemeDraw', 'settingsThemeRef', 'settingsThemeGlobal']) {
    const select = document.getElementById(id);
    if (!select || select.options.length) continue;
    for (const name of themeNames) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    /* Tur T Faz 3: özel temalar (kayıt defteri) select'lere eklenir.
       Gömülü tema listesi korunur; özel id'ler 'ct_' önekli gelir. */
    {
      const reg = window.tailrefThemeRegistry;
      if (reg) {
        for (const t of reg.list()) {
          const option = document.createElement('option');
          option.value = t.id;
          option.textContent = t.name;
          select.appendChild(option);
        }
      }
    }
    if (typeof watchThemeMenu === 'function') watchThemeMenu(select);
  }
  /* Genel tema: TÜM uygulamayı etkiler (19-themes applyTheme →
     tailref-theme). Mod temaları kendi select'lerinden ayrı akar. */
  const themeGlobal = document.getElementById('settingsThemeGlobal');
  if (themeGlobal && !themeGlobal.dataset.bound) {
    themeGlobal.dataset.bound = '1';
    themeGlobal.onchange = () => {
      try { applyTheme(themeGlobal.value); } catch { /* sessiz */ }
    };
  }
}

/* Tur T Faz 5 — Arayüz galerisi (kaynak: window.tailrefInterfaces).
   Her kart gerçek kayıt defteri tanımıdır; tıklama uiInterfaceApply
   çağırır (canlı geçiş, restart yok). Skin link'siz tanım zaten
   reddedilir — sahte kart görünmez. */
function settingsHubPopulateInterfaces() {
  const box = document.getElementById('settingsInterfaceGallery');
  if (!box) return;
  const api = window.tailrefInterfaces;
  if (!api || typeof api.list !== 'function') return;
  const active = api.active();
  box.replaceChildren();
  for (const def of api.list()) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'settingsThemeCard';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-pressed', String(def.id === active));
    card.title = def.desc || def.name;
    const name = document.createElement('span');
    name.className = 'settingsThemeCardName';
    name.textContent = def.name;
    const tag = document.createElement('span');
    tag.className = 'settingsThemeCardTag';
    tag.textContent = def.builtin ? __t('built-in') : __t('package');
    name.appendChild(tag);
    /* WIP rozeti: kayıtta wip:true olan arayüzler (ör. SGI IRIX 4Dwm)
       kartta "work in progress" etiketi taşır. */
    if (def.wip) {
      const wip = document.createElement('span');
      wip.className = 'settingsThemeCardTag settingsThemeCardTagWip';
      wip.textContent = __t('work in progress');
      name.appendChild(wip);
    }
    card.appendChild(name);
    const desc = document.createElement('span');
    desc.className = 'settingsThemeDraftHint';
    desc.textContent = def.desc || '';
    card.appendChild(desc);
    card.addEventListener('click', () => {
      if (typeof api.apply !== 'function') return;
      const ok = api.apply(def.id);
      if (!ok) {
        try { window.toast(__t('Interface could not be applied')); } catch { /* sessiz */ }
        return;
      }
      /* WIP uyarısı: geliştirme aşamasındaki arayüzü seçen kullanıcıya
         pürüzlü olabileceği açıkça söylenir (uzun süreli toast). */
      if (def.wip) {
        try {
          window.toast(__t('This interface is a work in progress — rough spots will be polished over time.'), 6000);
        } catch { /* sessiz */ }
      }
      settingsHubPopulateInterfaces();
    });
    box.appendChild(card);
  }
  const label = document.getElementById('settingsInterfaceActive');
  if (label) {
    const cur = api.list().find(d => d.id === active);
    label.textContent = cur ? cur.name : 'TailRef Classic';
  }
  /* Faz 6: kurulu paket satırları (02e renderInstalled). */
  const installed = document.getElementById('settingsInterfacePackages');
  if (installed && window.tailrefUiPackages &&
      typeof window.tailrefUiPackages.renderInstalled === 'function') {
    window.tailrefUiPackages.renderInstalled(installed);
  }
}

function settingsHubSetToggle(button, on) {
  if (!button) return;
  button.setAttribute('aria-pressed', String(!!on));
  button.textContent = on ? __t('On') : __t('Off');
}

function settingsHubSetSelect(select, value) {
  if (!select) return;
  select.value = String(value);
  if (select.selectedIndex < 0) select.selectedIndex = 0;
}

/* Çizim modu panel düğmeleri: Referans panosu / Renk / Katmanlar /
   Fırça Kütüphanesi — draw-v5 durumundan okunur. */
function settingsHubBuildPanels() {
  const host = document.getElementById('settingsDrawPanels');
  if (!host) return;
  const api = window.inkV5Settings;
  if (!api || typeof api.panels !== 'function') return;
  const list = api.panels() || [];
  const wanted = list.map(item => item.id).join(',');
  if (host.dataset.panelsId === wanted && host.childElementCount === list.length) {
    // Değerleri tazele
    [...host.querySelectorAll('[data-panel-id]')].forEach(button => {
      const item = list.find(entry => entry.id === button.dataset.panelId);
      if (item) settingsHubSetToggle(button, item.visible);
    });
    return;
  }
  host.innerHTML = '';
  host.dataset.panelsId = wanted;
  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'settingRow';
    row.dataset.help = item.id === 'reference'
      ? 'A small floating reference board next to the drawing.'
      : 'The drawing area panel in the ' + (item.column === 'right' ? 'right' : 'left') + ' column.';
    const label = document.createElement('span');
    label.textContent = item.title;
    const button = document.createElement('button');
    button.className = 'settingToggleBtn';
    button.type = 'button';
    button.dataset.panelId = item.id;
    button.addEventListener('click', () => {
      const pressed = button.getAttribute('aria-pressed') === 'true';
      try { api.setPanelVisible(item.id, !pressed); } catch { /* sessiz */ }
      settingsHubSetToggle(button, !pressed);
    });
    row.append(label, button);
    host.appendChild(row);
    settingsHubSetToggle(button, item.visible);
  }
}

/** 3D kalite etiketi (Türkçe). */
function settingsHubPerfQ3dLabel(level) {
  return { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' }[level] || String(level);
}

/** "Şu an geçerli: Karo Orta · 3D Orta" canlı özet satırı. */
function settingsHubPerfSync() {
  try { settingsHubSetSelect(document.getElementById('settingsPerfQ3dSelect'),
    localStorage.getItem('tailref-q3d-level') || 'auto'); } catch { /* sessiz */ }
  const line = document.getElementById('settingsPerfSummary');
  if (!line) return;
  /* Karo: elle sabitse o; otomatikse ölçülmüş etkin boyutun adı. */
  let tile = __t('Auto');
  try {
    const api = window.inkV5Settings;
    if (api) {
      const mode = String(api.tileSize?.() || 'auto');
      if (mode !== 'auto') {
        tile = mode === '128' ? 'Small' : mode === '512' ? 'Large' : 'Medium';
      } else {
        const cur = Number(api.tileSizeResolved?.() || 0);
        tile = cur ? (__t('Auto → ') + (cur <= 128 ? __t('Small') : cur <= 256 ? __t('Medium') : __t('Large'))) : __t('Auto');
      }
    }
  } catch { /* sessiz */ }
  /* 3D: seçim sabitse onu; otomatikse programın o an oturttuğu seviyeyi. */
  let q3 = __t('Auto');
  const stored = settingsHubPerfQ3dLabel(localStorage.getItem('tailref-q3d-level') || 'auto');
  try {
    const resolved = window.tailrefPose3dPerf ? String(window.tailrefPose3dPerf.level?.() || '') : '';
    q3 = resolved ? (stored === 'Auto' ? `${__t('Auto → ')}${__t(settingsHubPerfQ3dLabel(resolved))}` : __t(settingsHubPerfQ3dLabel(resolved)))
      : __t(stored);
  } catch { /* sessiz */ }
  line.textContent = __t('Currently: Tile {tile} · 3D {q3}', { tile, q3 });
}

/** Açılışta her şeyi güncel duruma eşitler. */
/* ---- Faz 5: ayar arama ----
   Tüm kategorilerin etiket + açıklama metninde (çevrilmiş hâlleriyle)
   arar; sonuç tıklanınca kategoriye gider ve satırı vurgular. Dizin
   panel her açılışta yeniden kurulur (dil değişimini yakalar). */
const settingsSearchUi = { index: [], timer: 0 };

function settingsSearchL10n(key, fallback) {
  try {
    if (window.L10N && typeof window.L10N.t === 'function') {
      const t = window.L10N.t(key);
      if (t && t !== key) return t;
    }
  } catch { /* sessiz */ }
  return fallback || key || '';
}

function settingsSearchBuildIndex() {
  const items = [];
  /* Kategorilerin kendileri de sonuç olur (kategoriye atlar). */
  for (const item of document.querySelectorAll('#settingsNav .settingsNavItem')) {
    const name = item.textContent.trim();
    items.push({
      cat: item.dataset.cat,
      row: null,
      label: name,
      catLabel: name,
      hay: (name + ' ' + (item.getAttribute('data-help') || '')).toLowerCase(),
      isCat: true,
    });
  }
  for (const page of document.querySelectorAll('#settings .settingsPage')) {
    const cat = page.dataset.page;
    const navItem = document.querySelector('#settingsNav .settingsNavItem[data-cat="' + cat + '"]');
    const catLabel = navItem ? navItem.textContent.trim() : cat;
    for (const row of page.querySelectorAll('.settingRow, .settingCheck')) {
      const span = row.querySelector('span[data-l10n]') ||
        row.querySelector('.spLabel') || row.querySelector('span');
      const labelKey = span ? span.getAttribute('data-l10n') : null;
      const label = labelKey
        ? settingsSearchL10n(labelKey, span.textContent)
        : (span ? span.textContent.trim() : '');
      const help = row.getAttribute('data-help') || '';
      const parts = [label, help ? settingsSearchL10n(help, help) : '', help];
      /* Select etiketleri de aranır (ör. "Sıkı"). */
      for (const opt of row.querySelectorAll('option[data-l10n]')) {
        parts.push(settingsSearchL10n(opt.getAttribute('data-l10n'), opt.textContent));
      }
      items.push({ cat, row, label, catLabel, hay: parts.join('\n').toLowerCase(), isCat: false });
    }
  }
  settingsSearchUi.index = items;
}

function settingsSearchReset() {
  const input = document.getElementById('settingsSearch');
  const box = document.getElementById('settingsSearchResults');
  if (input) input.value = '';
  if (box) { box.hidden = true; box.replaceChildren(); }
  settingsSearchBuildIndex();
}

function settingsSearchRun(rawQuery) {
  const box = document.getElementById('settingsSearchResults');
  if (!box) return;
  box.replaceChildren();
  const query = String(rawQuery || '').trim().toLowerCase();
  if (!query) { box.hidden = true; return; }
  const hits = settingsSearchUi.index.filter(it => it.hay.indexOf(query) >= 0).slice(0, 40);
  for (const hit of hits) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settingsSearchResult';
    const label = document.createElement('b');
    label.textContent = hit.label || hit.catLabel;
    const cat = document.createElement('span');
    cat.textContent = hit.catLabel;
    btn.append(label, cat);
    btn.addEventListener('click', () => {
      settingsNavSelect(hit.cat);
      const input = document.getElementById('settingsSearch');
      if (input) input.value = '';
      box.hidden = true;
      box.replaceChildren();
      if (hit.row) {
        try {
          hit.row.scrollIntoView({ block: 'center' });
          hit.row.classList.add('settingsSearchHit');
          setTimeout(() => hit.row.classList.remove('settingsSearchHit'), 1800);
        } catch { /* sessiz */ }
      }
    });
    box.appendChild(btn);
  }
  if (!hits.length) {
    const empty = document.createElement('p');
    empty.className = 'settingsSearchEmpty';
    empty.textContent = settingsSearchL10n('No matching settings', 'No matching settings');
    box.appendChild(empty);
  }
  box.hidden = false;
}

{
  const input = document.getElementById('settingsSearch');
  if (input && !input.dataset.searchBound) {
    input.dataset.searchBound = '1';
    input.addEventListener('input', () => {
      clearTimeout(settingsSearchUi.timer);
      settingsSearchUi.timer = setTimeout(() => settingsSearchRun(input.value), 100);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        /* İlk Esc yalnız sorguyu temizler; sorgu zaten boşsa pencere
           kapanır (ikinci Esc). */
        if (input.value) {
          e.stopPropagation();
          input.value = '';
          const box = document.getElementById('settingsSearchResults');
          if (box) { box.hidden = true; box.replaceChildren(); }
        } else {
          /* Sorgu zaten boş: ikinci Esc pencereyi kapatır. */
          e.stopPropagation();
          input.blur();
          if (typeof closeStudioPanel === 'function') closeStudioPanel(settingsEl);
          else if (settingsEl) settingsEl.hidden = true;
        }
      }
    });
  }
}

/* Escape açık ayarlar penceresini kapatır (uygulama geneli kural).
   Metin alanında ilk Esc yalnız odağı bırakır; kısayol yakalama sırasında
   capture dinleyicisi olayı zaten yuttuğu için buraya ulaşmaz. Ayrı
   pencereye taşınmış paneli kendi penceresi yönetir. */
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!settingsEl || settingsEl.hidden || settingsEl.dataset.detached === '1') return;
  const ae = document.activeElement;
  const isTextField = ae && (
    ae.isContentEditable ||
    ae.tagName === 'TEXTAREA' ||
    (ae.tagName === 'INPUT' &&
      !/^(range|checkbox|radio|button|submit|reset|color|file)$/i.test(ae.type || 'text'))
  );
  if (isTextField) return;
  event.preventDefault();
  event.stopPropagation();
  if (typeof closeStudioPanel === 'function') closeStudioPanel(settingsEl);
  else settingsEl.hidden = true;
});

/* ---- Faz 6: tercih içe/dışa aktarma + güvenli sıfırlama ----
   Whitelist: 'tailref-' ve 'tailref:' önekli localStorage anahtarları.
   Tahta verisi IndexedDB'dedir; 'workspace' (proje dizini) ve
   'ink:library' (fırça kütüphanesi) gibi kullanıcı veri anahtarları
   önek filtresine düşmediği için ASLA dışa aktarılmaz/silinmez. */
const PREFS_EXPORT_KIND = 'tailref-preferences';
const PREFS_EXPORT_VERSION = 1;

function settingsPrefsKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.indexOf('tailref-') === 0 || k.indexOf('tailref:') === 0)) keys.push(k);
  }
  return keys.sort();
}

function settingsPrefsBuild() {
  const data = {};
  for (const k of settingsPrefsKeys()) {
    try { data[k] = localStorage.getItem(k); } catch { /* sessiz */ }
  }
  const payload = {
    app: 'TailRef Studio',
    kind: PREFS_EXPORT_KIND,
    version: PREFS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    count: Object.keys(data).length,
    data,
  };
  /* Tur 4b.6: keymap bölümü — ayrı okunabilir alan (bilgi + ileriye
     uyumluluk). Gerçek veri data['tailref-keymap'] içinde; buradaki
     kopya yalnızca gösterim/doğrulama kolaylığı sağlar. */
  try {
    const raw = localStorage.getItem('tailref-keymap');
    payload.keymap = raw ? JSON.parse(raw) : { version: 1, actions: {} };
    if (!payload.keymap || typeof payload.keymap !== 'object') payload.keymap = { version: 1, actions: {} };
  } catch { payload.keymap = { version: 1, actions: {} }; }
  return payload;
}

function settingsPrefsApply(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'bad payload' };
  if (payload.kind !== PREFS_EXPORT_KIND) return { ok: false, error: 'kind' };
  if (payload.version !== PREFS_EXPORT_VERSION) return { ok: false, error: 'version' };
  if (!payload.data || typeof payload.data !== 'object') return { ok: false, error: 'data' };
  let n = 0;
  for (const [k, v] of Object.entries(payload.data)) {
    if (typeof v !== 'string') continue;
    /* Whitelist savunması: dosyada yabancı anahtar olsa bile yazılmaz. */
    if (k.indexOf('tailref-') !== 0 && k.indexOf('tailref:') !== 0) continue;
    /* Tur 4b.6: keymap özel durumu — ham yazım YOK; doğrulanmış
       temiz kopya uygulanır (bilinmeyen eylem + bozuk imza atılır). */
    if (k === 'tailref-keymap') {
      try { if (settingsPrefsApplyKeymap(v)) n++; } catch { /* sessiz */ }
      continue;
    }
    try { localStorage.setItem(k, v); n++; } catch { /* sessiz */ }
  }
  return { ok: true, count: n };
}

/* Tur 4b.6: içe aktarılan keymap değerini doğrulayıp uygula.
   Kurallar: JSON {version, actions:{eylem: tuş}}; bilinmeyen eylem
   atılır; imza tek karakter (a-z0-9) veya ctrl+x olmalı; sabit tuşlar
   reddedilir. Uygulama km.set/reset üzerinden yapılır — store
   önbelleği ve change olayları doğru tazelenir. inkws eylemleri
   (delege) bu mağazada yaşalmaz; onlar ink-workspace tercihinden gelir. */
function settingsPrefsApplyKeymap(raw) {
  const km = window.tailrefKeymap;
  if (!km || typeof raw !== 'string' || !raw) return false;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return false; }
  if (!parsed || typeof parsed !== 'object') return false;
  if (!parsed.actions || typeof parsed.actions !== 'object') return false;
  const clean = {};
  for (const [id, sig] of Object.entries(parsed.actions)) {
    if (typeof sig !== 'string') continue;
    const s = sig.toLowerCase();
    const single = s.length === 1 && /[a-z0-9]/.test(s);
    const ctrl = s.startsWith('ctrl+') && s.length === 6 && /[a-z0-9]$/.test(s);
    if (!single && !ctrl) continue;
    if (km.isFixedKey(s)) continue;
    clean[id] = s;
  }
  /* Yalnızca keymap mağazasında yaşayan eylemler (storage:'keymap'). */
  for (const def of km.defs) {
    if (def.storage !== 'keymap') continue;
    const want = clean[def.id] || '';
    const cur = km.get(def.id);
    if (want && want !== cur) km.set(def.id, want, { force: true });
    else if (!want && cur !== def.defaultKey) km.reset(def.id);
  }
  return true;
}

function settingsPrefsClear() {
  for (const k of settingsPrefsKeys()) {
    try { localStorage.removeItem(k); } catch { /* sessiz */ }
  }
}

function settingsPrefsNotice(msg) {
  if (typeof showProjectNotice === 'function') { showProjectNotice(msg, 4200); return; }
  try { console.log('[prefs]', msg); } catch { /* sessiz */ }
}

{
  const btnExport = document.getElementById('btnPrefsExport');
  const btnImport = document.getElementById('btnPrefsImport');
  const btnReset = document.getElementById('btnPrefsReset');
  const fileInput = document.getElementById('prefsFileInput');

  if (btnExport && !btnExport.dataset.prefsBound) {
    btnExport.dataset.prefsBound = '1';
    btnExport.addEventListener('click', () => {
      let payload;
      try { payload = settingsPrefsBuild(); } catch (e) { alert('Export failed: ' + e.message); return; }
      const text = JSON.stringify(payload, null, 1);
      if (window.tailref && typeof window.tailref.savePreferencesJson === 'function') {
        window.tailref.savePreferencesJson(text, 'tailref-preferences.json').then(res => {
          if (res && res.ok) settingsPrefsNotice('Preferences exported: ' + res.file);
          else if (res && !res.canceled) alert('Export failed: ' + (res.error || 'unknown'));
        }).catch(() => { /* diyalog kanalı hatası: sessiz */ });
      } else {
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'tailref-preferences.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    });
  }

  if (btnImport && !btnImport.dataset.prefsBound) {
    btnImport.dataset.prefsBound = '1';
    btnImport.addEventListener('click', () => { if (fileInput) fileInput.click(); });
  }

  if (fileInput && !fileInput.dataset.prefsBound) {
    fileInput.dataset.prefsBound = '1';
    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        if (!payload || payload.kind !== PREFS_EXPORT_KIND) throw new Error('not a tailref-preferences file');
        if (payload.version !== PREFS_EXPORT_VERSION) throw new Error('unsupported version ' + payload.version);
        const n = payload.data ? Object.keys(payload.data).length : 0;
        if (!(await appConfirm('This will apply ' + n + ' preference entries from the file. Your boards are not affected. Continue?'))) return;
        const res = settingsPrefsApply(payload);
        if (!res.ok) throw new Error(res.error || 'apply failed');
        location.reload();
      } catch (e) {
        alert('Preferences could not be loaded: ' + e.message);
      }
    };
  }

  if (btnReset && !btnReset.dataset.prefsBound) {
    btnReset.dataset.prefsBound = '1';
    btnReset.addEventListener('click', async () => {
      const n = settingsPrefsKeys().length;
      if (!(await appConfirm('All ' + n + ' preference entries will be reset to defaults. Your boards and saves are not affected. Continue?'))) return;
      settingsPrefsClear();
      location.reload();
    });
  }

  /* Footer sağ uç (15 Kasım 2026): Kaydet + Tüm ayarları sıfırla.
     Kaydet → diyalogsuz sessiz yazma (userData + exe yanı); portable
     kullanıcının profili kaybolursa açılışta dosyadan geri yüklenir.
     Depolama sayfasındaki Export/Reset'in aynı whitelist'ini kullanır. */
  const btnSaveFoot = document.getElementById('btnSettingsSave');
  if (btnSaveFoot && !btnSaveFoot.dataset.prefsBound) {
    btnSaveFoot.dataset.prefsBound = '1';
    btnSaveFoot.addEventListener('click', async () => {
      let payload;
      try { payload = settingsPrefsBuild(); } catch (e) { settingsPrefsNotice('Export failed: ' + e.message); return; }
      const text = JSON.stringify(payload, null, 1);
      const api = window.tailref && typeof window.tailref.savePreferencesAuto === 'function'
        ? window.tailref : null;
      if (api) {
        try {
          const res = await api.savePreferencesAuto(text);
          if (res && res.ok) settingsPrefsNotice(__t('Preferences saved') + ': ' + res.file);
          else settingsPrefsNotice(__t('Preferences could not be saved') + (res && res.error ? ': ' + res.error : ''));
        } catch { settingsPrefsNotice(__t('Preferences could not be saved')); }
      } else {
        /* Web önizleme: indirme fallback'i. */
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'tailref-preferences.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    });
  }
  const btnResetFoot = document.getElementById('btnSettingsResetAll');
  if (btnResetFoot && !btnResetFoot.dataset.prefsBound) {
    btnResetFoot.dataset.prefsBound = '1';
    btnResetFoot.addEventListener('click', async () => {
      const n = settingsPrefsKeys().length;
      if (!(await appConfirm('All ' + n + ' preference entries will be reset to defaults. Your boards and saves are not affected. Continue?'))) return;
      settingsPrefsClear();
      location.reload();
    });
  }
  /* Destek (Buy Me a Coffee): bağlantı sistem tarayıcısında açılır.
     Renderer içinde harici pencere/sayfa açılmaz — güvenlik duvarı
     (setWindowOpenHandler) korunur. */
  const coffeeLink = document.getElementById('settingsCoffee');
  if (coffeeLink && !coffeeLink.dataset.bound) {
    coffeeLink.dataset.bound = '1';
    coffeeLink.addEventListener('click', event => {
      event.preventDefault();
      const url = coffeeLink.getAttribute('href') || 'https://www.buymeacoffee.com/roxsmb';
      const api = window.tailref;
      if (api && typeof api.openExternal === 'function') {
        api.openExternal(url).catch(() => { /* sessiz */ });
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    });
  }

  /* Kayıp profil kurtarma: localStorage'da tailref- anahtarı YOKSA ve
     diske kaydedilmiş tercih dosyası VARSA dosya içeriği uygulanır ve
     sayfa tazelenir. Profili dolu kullanıcılarda asla çalışmaz (parite:
     kayıp olmayan profile dokunulmaz). */
  try {
    const hasPrefs = settingsPrefsKeys().length > 0;
    const api = window.tailref && typeof window.tailref.loadPreferencesAuto === 'function'
      ? window.tailref : null;
    if (!hasPrefs && api) {
      api.loadPreferencesAuto().then(res => {
        if (!res || !res.ok || !res.text) return;
        let payload = null;
        try { payload = JSON.parse(res.text); } catch { return; }
        const r = settingsPrefsApply(payload);
        if (r && r.ok && r.count > 0) {
          try { localStorage.setItem('tailref-prefs-restored', '1'); } catch { /* sessiz */ }
          settingsPrefsNotice(__t('Your preferences were restored from the saved file.'));
          setTimeout(() => location.reload(), 900);
        }
      }).catch(() => { /* sessiz */ });
    }
  } catch { /* sessiz */ }
}

function settingsHubSync() {
  settingsHubPopulateThemes();
  /* Faz 5: arayüz galerisi her açılışta tazelenir (kaynak: kayıt defteri). */
  settingsHubPopulateInterfaces();
  const themes = window.tailrefThemes;
  settingsHubSetSelect(document.getElementById('settingsThemeDraw'), themes ? themes.get('draw') : 'classic');
  settingsHubSetSelect(document.getElementById('settingsThemeRef'), themes ? themes.get('reference') : 'classic');
  /* Genel tema: yürürlükteki tema (mod override'ı sonrası applyTheme
     buraya da yansır — syncSettingsTheme zaten besler; çift emniyet). */
  try {
    settingsHubSetSelect(document.getElementById('settingsThemeGlobal'),
      localStorage.getItem('tailref-theme') || 'classic');
  } catch { /* sessiz */ }

  try { settingsHubSetSelect($('#settingsLanguageSelect'), window.L10N ? window.L10N.lang() : (localStorage.getItem('tailref-lang') || 'en')); } catch { /* sessiz */ }

  const api = window.inkV5Settings;
  if (api) {
    settingsHubBuildPanels();
    try { settingsHubSetToggle($('#settingsPanelsHide'), api.panelsHidden()); } catch { /* sessiz */ }
    try { settingsHubSetToggle($('#settingsPowerSliders'), api.powerSliders()); } catch { /* sessiz */ }
    try { settingsHubSetToggle($('#settingsMousePressure'), api.mousePressure()); } catch { /* sessiz */ }
    try { settingsHubSetToggle($('#settingsShapeTool'), api.shape()); } catch { /* sessiz */ }
    try { settingsHubSetSelect($('#settingsSymSelect'), api.sym()); } catch { /* sessiz */ }
    try { settingsHubSetSelect($('#settingsTileSizeSelect'), api.tileSize()); } catch { /* sessiz */ }
  }

  /* Sektör standardı ayarlar (15 Kasım 2026): localStorage destekli;
     açılışta gerçek değerlerden senkronlanır. */
  try {
    const wZoom = $('#settingsWheelZoom');
    if (wZoom) settingsHubSetToggle(wZoom, window.tailrefWheelZoom ? window.tailrefWheelZoom() : true);
  } catch { /* sessiz */ }
  try {
    const wInv = $('#settingsWheelInvert');
    if (wInv) settingsHubSetToggle(wInv, window.tailrefWheelInvert ? window.tailrefWheelInvert() : false);
  } catch { /* sessiz */ }
  try {
    /* Pano kapatma onayı: tailref-close-confirm yoksa/bozuksa açık
       (mevcut davranış = dolu panolarda onay). */
    const cc = $('#settingsCloseConfirm');
    if (cc) settingsHubSetToggle(cc, localStorage.getItem('tailref-close-confirm') !== '0');
  } catch { /* sessiz */ }
  try {
    /* Açılışta panoları geri yükle: anahtar yoksa/bozuksa açık. */
    const rb = $('#settingsRestoreBoards');
    if (rb) settingsHubSetToggle(rb, localStorage.getItem('tailref-restore-boards') !== '0');
  } catch { /* sessiz */ }
  try {
    const steps = $('#settingsUndoStepsInput');
    if (steps) steps.value = localStorage.getItem('tailref-undo-steps') || '';
  } catch { /* sessiz */ }
  try {
    const bc = $('#settingsBrushCursorSelect');
    const v = localStorage.getItem('tailref-brush-cursor');
    if (bc && v) bc.value = v;
  } catch { /* sessiz */ }

  /* Hız ve Performans bölümü: seçimler + canlı özet satırı. */
  try { settingsHubPerfSync(); } catch { /* sessiz */ }

  /* Kalıcılık/yedek alanları 20-settings daha önce bekliyordu ⋯ tile üzerinden;
     artık açılış burada tazelensin. */
  if (typeof openStudioPanel === 'function' && typeof backupIntervalEl !== 'undefined' && backupIntervalEl) {
    try { backupIntervalEl.value = localStorage.getItem('tailref-backup-interval') || '5'; } catch { /* sessiz */ }
  }
  /* Yedek saklama sınırı (aday 4): kayıtlı anahtar yoksa 20 (seçicide 'selected'). */
  if (typeof backupLimitEl !== 'undefined' && backupLimitEl) {
    try {
      const n = Number(localStorage.getItem('tailref-backup-limit'));
      backupLimitEl.value = (Number.isFinite(n) && n >= 1) ? String(Math.floor(n)) : '20';
    } catch { /* sessiz */ }
  }
  /* Tablet basınç profili (aday 5): kayıtlı anahtar yoksa 'linear' (parite). */
  try {
    const savedProfile = localStorage.getItem('tailref-pressure-profile');
    settingsHubSetSelect(document.getElementById('settingsPressureProfile'),
      savedProfile === 'soft' || savedProfile === 'hard' ? savedProfile : 'linear');
  } catch { /* sessiz */ }
  /* Adaylar 6-9 (15 Kasım): imleç zoom, ortam efektleri, tahta snap,
     ızgara aralığı, metin varsayılanları. */
  try {
    const zc = $('#settingsZoomCursor');
    if (zc) settingsHubSetToggle(zc, localStorage.getItem('tailref-zoom-cursor') === '1');
    const ae = $('#settingsAmbientEffects');
    if (ae) settingsHubSetToggle(ae, window.tailrefAmbientEffectsOn ? window.tailrefAmbientEffectsOn() : true);
    const bs = $('#settingsBoardSnap');
    if (bs) settingsHubSetToggle(bs, localStorage.getItem('tailref-board-snap') !== '0');
    /* Boşta soldurma süresi (17 Kasım 2026): marka + sağ üst + katlı ok. */
    const idf = $('#settingsIdleFade');
    if (idf) {
      const s = window.tailrefIdleFadeSeconds ? window.tailrefIdleFadeSeconds() : 60;
      idf.value = String(s);
      if (idf.selectedIndex < 0) idf.value = '60';
    }
    const gs = $('#settingsGridStepSelect');
    if (gs) {
      const n = Number(localStorage.getItem('tailref-ce-grid-step'));
      gs.value = (n === 32 || n === 128 || n === 256) ? String(n) : '64';
    }
    const tsz = $('#settingsTextSizeDefault');
    if (tsz) {
      const n = Number(localStorage.getItem('tailref-text-default-size'));
      tsz.value = (Number.isFinite(n) && n >= 8 && n <= 400) ? String(Math.round(n)) : '';
    }
    const tfm = $('#settingsTextFamilySelect');
    if (tfm) {
      tfm.value = localStorage.getItem('tailref-text-default-family') || '';
      if (tfm.selectedIndex < 0) tfm.selectedIndex = 0;
    }
  } catch { /* sessiz */ }
  if (typeof trashRetentionSelectEl !== 'undefined' && trashRetentionSelectEl && typeof trashRetentionMinutes !== 'undefined') {
    try { trashRetentionSelectEl.value = String(trashRetentionMinutes); } catch { /* sessiz */ }
  }
  if (settingsTopEl && window.tailref && window.tailref.isAlwaysOnTop) {
    try { window.tailref.isAlwaysOnTop().then(on => { settingsTopEl.checked = !!on; }).catch(() => {}); } catch { /* sessiz */ }
  }

  /* Faz 2 genişlemesi (62-settings-extended): accent seçimi + pointer özeti. */
  try { if (typeof settingsExtSync === 'function') settingsExtSync(); } catch { /* sessiz */ }
  /* Tur T Faz 3: tema stüdyosu (galeri + özel tema editörü) senkronu. */
  try { if (typeof settingsThemeStudioBind === 'function') settingsThemeStudioBind(); } catch { /* sessiz */ }
  try { if (typeof settingsThemeStudioSync === 'function') settingsThemeStudioSync(); } catch { /* sessiz */ }

  /* Faz 4: teşhis paneli Ctrl+Alt+P ile de açılıp kapanabildiği için
     buton durumu her açılışta gerçek panelden okunur. */
  try {
    const pd = document.getElementById('perfDiag');
    const diag = document.getElementById('settingsPerfDiag');
    if (diag && pd) settingsHubSetToggle(diag, pd.dataset.on === 'true');
  } catch { /* sessiz */ }

  /* Faz 4b: Shortcuts sayfası çizim kısayol listesi — tek kaynaktan
     (inkWorkspaceUi.state) tazelenir; yakalama iptal edilir. */
  try {
    if (inkWorkspaceUi && inkWorkspaceUi.captureShortcut) {
      inkWorkspaceUi.captureShortcut = '';
      inkWorkspaceShowConflict('');
    }
    if (typeof inkWorkspaceRenderShortcuts === 'function') inkWorkspaceRenderShortcuts();
  } catch { /* sessiz */ }

  /* Tur 4b.4: keymap grupları (tahta/editör) — bind + render. */
  try {
    settingsKeymapCancelCapture();
    settingsKeymapBind();
    settingsKeymapRender();
  } catch { /* sessiz */ }

  /* Faz 5: arama dizinini yeniden kur (dil/kontrol değişimini yakalar). */
  try { if (typeof settingsSearchReset === 'function') settingsSearchReset(); } catch { /* sessiz */ }
}

/* ---- Tur 4b.4: keymap grupları (tahta + editör) ----
   Tek doğruluk kaynağı window.tailrefKeymap; çizim grubu Ayarlar'daki
   mevcut listeyle (inkWorkspace) aynı kalır — burada yalnızca keymap
   mağazasındaki (storage:'keymap') eylemler listelenir. */
const settingsKeymapUi = { capturing: '' };

function settingsKeymapL10n(text) {
  try {
    if (window.L10N && typeof window.L10N.t === 'function') {
      const v = window.L10N.t(text);
      if (v && v !== text) return v;
    }
  } catch { /* sessiz */ }
  return text;
}

function settingsKeymapShowConflict(msg) {
  const note = document.getElementById('settingsKeymapConflict');
  if (!note) return;
  if (msg) { note.textContent = msg; note.hidden = false; }
  else { note.hidden = true; note.textContent = ''; }
}

function settingsKeymapCancelCapture() {
  if (!settingsKeymapUi.capturing) return;
  settingsKeymapUi.capturing = '';
  settingsKeymapShowConflict('');
  settingsKeymapRender();
}

function settingsKeymapRender() {
  const km = window.tailrefKeymap;
  if (!km) return;
  const label = typeof inkWorkspaceShortcutLabel === 'function'
    ? inkWorkspaceShortcutLabel : (s => s);
  const boxGroups = [
    ['settingsKeymapBoard', 'board'],
    ['settingsKeymapEditor', 'editor'],
    ['settingsKeymapPose3d', 'pose3d'],
    ['settingsKeymapShell', 'shell'],
    ['settingsKeymapLayers', 'layers'],
  ];
  for (const [boxId, group] of boxGroups) {
    const box = document.getElementById(boxId);
    if (!box) continue;
    box.replaceChildren();
    for (const action of km.all()) {
      if (action.group !== group) continue;
      const row = document.createElement('div');
      row.className = 'inkWsShortcutRow';
      const labelEl = document.createElement('span');
      labelEl.textContent = settingsKeymapL10n(action.label);
      const capturing = settingsKeymapUi.capturing === action.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inkWsKbd' + (capturing ? ' is-capturing' : '');
      btn.dataset.kmShortcut = action.id;
      btn.textContent = capturing ? settingsKeymapL10n('Waiting for key…') : label(action.key);
      /* Native title yasak (pill ile üst üste biniyor): data-tooltip kanalı. */
      btn.dataset.tooltip = settingsKeymapL10n('Change shortcut');
      btn.setAttribute('aria-label', settingsKeymapL10n(action.label) + ' · ' +
        label(action.key) + ' · ' + settingsKeymapL10n('Press to change.'));
      row.append(labelEl, btn);
      /* Tekil sıfırlama: yalnızca özelleştirilmişse görünür. */
      if (action.key !== action.defaultKey) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'inkWsKbd is-reset';
        reset.dataset.kmReset = action.id;
        reset.textContent = '↺';
        /* Native title yasak: data-tooltip kanalı. */
        reset.dataset.tooltip = settingsKeymapL10n('Reset to default') + ' (' + label(action.defaultKey) + ')';
        reset.setAttribute('aria-label', settingsKeymapL10n(action.label) + ' · ' +
          settingsKeymapL10n('Reset to default'));
        row.append(reset);
      }
      box.appendChild(row);
    }
  }
}

function settingsKeymapBind() {
  const km = window.tailrefKeymap;
  if (!km || settingsKeymapUi.bound) return;
  settingsKeymapUi.bound = true;

  /* Yakalama başlatma + tekil/toplu sıfırlama — belge düzeyi delege. */
  document.addEventListener('click', event => {
    const t = event.target instanceof Element ? event.target : null;
    if (!t) return;
    const cap = t.closest('[data-km-shortcut]');
    if (cap) {
      settingsKeymapUi.capturing = cap.dataset.kmShortcut;
      settingsKeymapShowConflict('');
      settingsKeymapRender();
      return;
    }
    const rst = t.closest('[data-km-reset]');
    if (rst) {
      const res = km.reset(rst.dataset.kmReset);
      if (res && res.ok) {
        settingsKeymapCancelCapture();
        settingsKeymapShowConflict('');
        settingsKeymapRender();
      }
    }
  });

  /* Yakalama: pencere capture'ında yut; imza kuralları keymap'ten.
     Çakışmada BLOK (yer değiştirme sonraki turda); mesaj görünür.
     Ayrı panel penceresinden gelen tuşlar da aynı fonksiyonu kullanır. */
  function settingsKeymapHandleCapture(event) {
    if (!settingsKeymapUi.capturing) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      settingsKeymapCancelCapture();
      return true;
    }
    if (event.key === 'Tab') { event.preventDefault(); return true; }
    const sig = km.signatureFromEvent(event);
    if (!sig) {
      event.preventDefault();
      event.stopImmediatePropagation();
      settingsKeymapUi.capturing = '';
      settingsKeymapRender();
      settingsKeymapShowConflict(settingsKeymapL10n('Use a single letter, number or Ctrl+a key. Shift and Alt are fixed.'));
      return true;
    }
    const id = settingsKeymapUi.capturing;
    const res = km.set(id, sig);
    if (!res.ok && res.conflict) {
      event.preventDefault();
      event.stopImmediatePropagation();
      settingsKeymapUi.capturing = '';
      settingsKeymapRender();
      settingsKeymapShowConflict(settingsKeymapL10n('“{key}” is already used by “{action}”.')
        .replace('{key}', typeof inkWorkspaceShortcutLabel === 'function' ? inkWorkspaceShortcutLabel(sig) : sig)
        .replace('{action}', settingsKeymapL10n(res.conflict.label)));
      return true;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    settingsKeymapUi.capturing = '';
    settingsKeymapShowConflict('');
    settingsKeymapRender();
    return true;
  }

  window.addEventListener('keydown', event => {
    settingsKeymapHandleCapture(event);
  }, true);

  /* Ayrı panel penceresi köprüsü: tuş olayı orada yutulduğu için burada
     yeniden senkron bir olay nesnesine çevrilir. Global kısayollar görmez. */
  window.tailrefSettingsKeyCapture = data => {
    if (!data || !settingsKeymapUi.capturing) return false;
    const fake = {
      key: String(data.key || ''),
      code: String(data.code || ''),
      ctrlKey: !!data.ctrlKey,
      shiftKey: !!data.shiftKey,
      altKey: !!data.altKey,
      metaKey: !!data.metaKey,
      preventDefault() {},
      stopImmediatePropagation() {},
    };
    return settingsKeymapHandleCapture(fake);
  };
  window.tailrefSettingsKeyCaptureActive = () => !!settingsKeymapUi.capturing;

  /* Ayrı panel penceresindeki kısayol düğmesi: yakalama modunu burada
     başlatır. Ayrı pencere yalnız düğmeye basıldığını bildirir; DOM
     eşlemesi gerekmez. */
  window.tailrefSettingsKeyCaptureBegin = id => {
    if (typeof id !== 'string' || !id) return false;
    if (!km.defs || !km.defs.some(item => item.id === id)) return false;
    settingsKeymapUi.capturing = id;
    settingsKeymapShowConflict('');
    settingsKeymapRender();
    return true;
  };

  const resetAll = document.getElementById('settingsKeymapReset');
  if (resetAll && !resetAll.dataset.kmBound) {
    resetAll.dataset.kmBound = '1';
    resetAll.addEventListener('click', () => {
      for (const action of km.all()) {
        if (action.group === 'board' || action.group === 'editor' || action.group === 'pose3d' ||
            action.group === 'shell' || action.group === 'layers' || action.group === 'ink') km.reset(action.id);
      }
      settingsKeymapCancelCapture();
      settingsKeymapShowConflict('');
      settingsKeymapRender();
      /* ink grubu ink-workspace yüzeyinde basılır (43): onu da tazele. */
      try { if (typeof inkWorkspaceRenderShortcuts === 'function') inkWorkspaceRenderShortcuts(); } catch { /* sessiz */ }
    });
  }

  /* Dil değişince etiketler tazelenir. */
  try {
    if (window.L10N) window.L10N.onChange(() => {
      try { settingsKeymapRender(); } catch { /* sessiz */ }
    });
  } catch { /* sessiz */ }
}

/* ⋯ Ayarlar penceresi: her modda aynı yerde duran TEK kapı. Ayrıca
   17-floating-panels'in "btnSettings" denemeleri artık bu kapıya düşer. */
{
  const languageSelect = $('#settingsLanguageSelect');
  if (languageSelect) languageSelect.onchange = () => {
    /* Anlık dil geçişi: restart yok; workspace/durum dokunulmaz.
       L10N setLang kalıcılığı (tailref-lang) kendisi yazar ve
       [data-l10n*] öğelerini + onChange dinleyicilerini yeniler. */
    try {
      if (window.L10N) window.L10N.setLang(languageSelect.value);
      else localStorage.setItem('tailref-lang', languageSelect.value);
    } catch { /* sessiz */ }
  };
  /* Dil değişince hub'ın kendi metinleri (seçim özetleri, yardımlar) tazelensin. */
  if (languageSelect && window.L10N) {
    window.L10N.onChange(() => { try { settingsHubSync(); } catch { /* sessiz */ } });
  }

  const themeDraw = $('#settingsThemeDraw');
  if (themeDraw) themeDraw.onchange = () => {
    if (window.tailrefThemes) window.tailrefThemes.applyDraw(themeDraw.value);
  };
  const themeRef = $('#settingsThemeRef');
  if (themeRef) themeRef.onchange = () => {
    if (window.tailrefThemes) window.tailrefThemes.applyReference(themeRef.value);
  };

  /* "?" aç/kapa düğmeleri kaldırıldı (Tur S): açıklamalar her zaman
     görünür (CSS data-help attr kanalı). */

  const keyHelp = $('#btnSettingsKeyHelp');
  if (keyHelp) keyHelp.onclick = () => {
    try { if (window.inkV5Settings) window.inkV5Settings.keyHelp(); } catch { /* sessiz */ }
  };

  const bindToggle = (id, getter, setter) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      const pressed = el.getAttribute('aria-pressed') === 'true';
      try { setter(!pressed); } catch { /* sessiz */ }
      settingsHubSetToggle(el, !pressed);
      if (id === 'settingsPanelsHide') settingsHubBuildPanels();
    });
    void getter;
  };
  const api = () => window.inkV5Settings || {};
  bindToggle('settingsPanelsHide', () => api().panelsHidden && api().panelsHidden(), v => api().setPanelsHidden && api().setPanelsHidden(v));
  bindToggle('settingsPowerSliders', () => api().powerSliders && api().powerSliders(), v => api().setPowerSliders && api().setPowerSliders(v));
  bindToggle('settingsMousePressure', () => api().mousePressure && api().mousePressure(), v => api().setMousePressure && api().setMousePressure(v));
  bindToggle('settingsShapeTool', () => api().shape && api().shape(), v => api().setShape && api().setShape(v));

  /* Sektör standardı ayarlar (15 Kasım 2026): wheel zoom/pan + doğal yön,
     geri alma adım sınırı, fırça imleci. Kalıcılık: localStorage
     tailref-* anahtarları (tercih yedeği whitelist'ine otomatik dahil). */
  bindToggle('settingsWheelZoom',
    () => window.tailrefWheelZoom ? window.tailrefWheelZoom() : true,
    v => { try { localStorage.setItem('tailref-wheel-zoom', v ? '1' : '0'); } catch { /* sessiz */ } });
  bindToggle('settingsWheelInvert',
    () => window.tailrefWheelInvert ? window.tailrefWheelInvert() : false,
    v => { try { localStorage.setItem('tailref-wheel-invert', v ? '1' : '0'); } catch { /* sessiz */ } });
  /* Pano kapatma onayı (aday 1): anahtar '0' → onay yok; yoksa/bozuksa
     mevcut davranış. closeProjectTab (26-projects.js) okur. */
  bindToggle('settingsCloseConfirm',
    () => { try { return localStorage.getItem('tailref-close-confirm') !== '0'; } catch { return true; } },
    v => { try { localStorage.setItem('tailref-close-confirm', v ? '1' : '0'); } catch { /* sessiz */ } });
  /* Açılışta panoları geri yükle (aday 3): '0' → açılışta temiz
     başlat (arşiv + tek boş pano). _load (26-projects.js) okur. */
  bindToggle('settingsRestoreBoards',
    () => { try { return localStorage.getItem('tailref-restore-boards') !== '0'; } catch { return true; } },
    v => { try { localStorage.setItem('tailref-restore-boards', v ? '1' : '0'); } catch { /* sessiz */ } });
  const pressureProfileSelect = $('#settingsPressureProfile');
  if (pressureProfileSelect) pressureProfileSelect.onchange = () => {
    try {
      const v = pressureProfileSelect.value === 'soft' || pressureProfileSelect.value === 'hard'
        ? pressureProfileSelect.value : 'linear';
      localStorage.setItem('tailref-pressure-profile', v);
      if (typeof window.tailrefPressureProfileSet === 'function') window.tailrefPressureProfileSet(v);
    } catch { /* sessiz */ }
  };
  const brushCursorSelect = $('#settingsBrushCursorSelect');
  if (brushCursorSelect) brushCursorSelect.onchange = () => {
    try { localStorage.setItem('tailref-brush-cursor', brushCursorSelect.value || 'ring'); } catch { /* sessiz */ }
    /* Açık çizim editöründe ANINDA etkili olsun: CSS imleci + halka yenile. */
    try {
      const ui = typeof inkEditorUi !== 'undefined' ? inkEditorUi : null;
      if (ui && ui.open) {
        if (typeof inkEditorSyncCursorStyle === 'function') inkEditorSyncCursorStyle();
        if (typeof inkEditorCursorInvalidate === 'function') inkEditorCursorInvalidate();
      }
    } catch { /* sessiz */ }
  };
  const undoStepsInput = $('#settingsUndoStepsInput');
  if (undoStepsInput) undoStepsInput.onchange = () => {
    try {
      const raw = undoStepsInput.value.trim();
      if (!raw) { undoStepsInput.value = ''; localStorage.removeItem('tailref-undo-steps'); return; }
      const v = parseInt(raw, 10);
      if (!Number.isFinite(v)) { undoStepsInput.value = ''; localStorage.removeItem('tailref-undo-steps'); return; }
      const clamped = Math.min(200, Math.max(5, v));
      undoStepsInput.value = String(clamped);
      localStorage.setItem('tailref-undo-steps', String(clamped));
    } catch { /* sessiz */ }
  };

  /* Aday 6 (15 Kasım): imleç odaklı zoom — görüntü editörü Ctrl+tekerlek. */
  bindToggle('settingsZoomCursor',
    () => { try { return localStorage.getItem('tailref-zoom-cursor') === '1'; } catch { return false; } },
    v => { try { localStorage.setItem('tailref-zoom-cursor', v ? '1' : '0'); } catch { /* sessiz */ } });
  /* Aday 8 (15 Kasım): ortam efektleri — yağmur/karı bağımsız anahtar. */
  bindToggle('settingsAmbientEffects',
    () => window.tailrefAmbientEffectsOn ? window.tailrefAmbientEffectsOn() : true,
    v => window.tailrefAmbientEffectsSet && window.tailrefAmbientEffectsSet(v));
  /* Aday 9 (15 Kasım): tahta yapışması + editör ızgara aralığı. */
  bindToggle('settingsBoardSnap',
    () => { try { return localStorage.getItem('tailref-board-snap') !== '0'; } catch { return true; } },
    v => { try { localStorage.setItem('tailref-board-snap', v ? '1' : '0'); } catch { /* sessiz */ } });
  /* Boşta soldurma (17 Kasım): 0 = hiç kaybolma; saniye cinsinden. */
  const idleFadeSelect = $('#settingsIdleFade');
  if (idleFadeSelect) idleFadeSelect.onchange = () => {
    const v = Number(idleFadeSelect.value);
    if (window.tailrefIdleFadeSet) window.tailrefIdleFadeSet(Number.isFinite(v) ? v : 60);
  };
  const gridStepSelect = $('#settingsGridStepSelect');
  if (gridStepSelect) gridStepSelect.onchange = () => {
    try {
      const n = Number(gridStepSelect.value);
      if (n === 32 || n === 64 || n === 128 || n === 256) localStorage.setItem('tailref-ce-grid-step', String(n));
    } catch { /* sessiz */ }
  };
  /* Aday 7 (15 Kasım): yeni metin varsayılanları — punto/aile. */
  const textSizeDefault = $('#settingsTextSizeDefault');
  if (textSizeDefault) textSizeDefault.onchange = () => {
    try {
      const n = Number(textSizeDefault.value);
      if (Number.isFinite(n) && n >= 8 && n <= 400) {
        textSizeDefault.value = String(Math.round(n));
        localStorage.setItem('tailref-text-default-size', String(Math.round(n)));
      } else {
        textSizeDefault.value = '';
        localStorage.removeItem('tailref-text-default-size');
      }
    } catch { /* sessiz */ }
  };
  const textFamilySelect = $('#settingsTextFamilySelect');
  if (textFamilySelect) textFamilySelect.onchange = () => {
    try {
      const v = textFamilySelect.value || '';
      if (v) localStorage.setItem('tailref-text-default-family', v);
      else localStorage.removeItem('tailref-text-default-family');
    } catch { /* sessiz */ }
  };

  const symSelect = $('#settingsSymSelect');
  if (symSelect) symSelect.onchange = () => {
    try { if (symSelect.value && window.inkV5Settings) window.inkV5Settings.setSym(symSelect.value); } catch { /* sessiz */ }
  };
  const tileSelect = $('#settingsTileSizeSelect');
  if (tileSelect) tileSelect.onchange = () => {
    try { if (tileSelect.value && window.inkV5Settings) window.inkV5Settings.setTileSize(tileSelect.value); } catch { /* sessiz */ }
  };

  const resetPanels = $('#settingsPanelsReset');
  if (resetPanels) resetPanels.onclick = () => {
    try { if (window.inkV5Settings && window.inkV5Settings.reset) window.inkV5Settings.reset(); } catch { /* sessiz */ }
  };

  /* ---- Gelişmiş (Faz 4): teşhis köprüsü + GPU bilgisi ----
     Teşhis: gerçek Ctrl+Alt+P paneli (61-perf-diag) — aynı kanal.
     GPU: WEBGL_debug_renderer_info ile sürücünün bildirdiği gerçek
     donanım; bir kez okunur. */
  bindToggle('settingsPerfDiag',
    () => { const p = document.getElementById('perfDiag'); return !!(p && p.dataset.on === 'true'); },
    v => window.tailrefPerfDiagToggle && window.tailrefPerfDiagToggle(v));

  const gpuInfo = $('#settingsGpuInfo');
  if (gpuInfo && !gpuInfo.dataset.bound) {
    gpuInfo.dataset.bound = '1';
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      let name = '';
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        name = ext
          ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '')
          : String(gl.getParameter(gl.RENDERER) || '');
      }
      gpuInfo.textContent = name || '–';
    } catch { gpuInfo.textContent = '–'; }
  }

  /* ---- Hakkında (Faz 4): yapı damgası (IPC get-build-stamp) + motor ---- */
  const aboutBuild = $('#settingsAboutBuild');
  if (aboutBuild && !aboutBuild.dataset.bound) {
    aboutBuild.dataset.bound = '1';
    try {
      if (window.tailref && typeof window.tailref.getBuildStamp === 'function') {
        window.tailref.getBuildStamp().then(stamp => {
          aboutBuild.textContent = stamp || 'Development build';
        }).catch(() => { aboutBuild.textContent = 'Development build'; });
      }
    } catch { /* sessiz */ }
  }
  const aboutEngine = $('#settingsAboutEngine');
  if (aboutEngine && !aboutEngine.dataset.bound) {
    aboutEngine.dataset.bound = '1';
    try {
      const parts = String(navigator.userAgent).match(/Chrome\/[\d.]+|Electron\/[\d.]+/g);
      aboutEngine.textContent = parts ? parts.join(' · ') : '–';
    } catch { aboutEngine.textContent = '–'; }
  }

  /* 3D rehberi: ayar penceresinden istediğin zaman tekrar açılır. */
  const poseGuideBtn = $('#settingsPoseGuide');
  if (poseGuideBtn) poseGuideBtn.onclick = () => {
    try { localStorage.setItem('tailref-pose3d-guide-seen', '1'); } catch { /* sessiz */ }
    const dlg = document.getElementById('poseGuide');
    if (dlg) dlg.hidden = false;
  };

  /* 3D panelleri sıfırla: yüzen Kamera · Poz · Görüntü kartları
     varsayılan sağ dizilime döner (kullanıcı 8 Kasım). */
  const poseStackResetBtn = $('#btnPoseStackReset');
  if (poseStackResetBtn) poseStackResetBtn.onclick = () => {
    if (typeof window.tailrefPoseStackReset === 'function') {
      window.tailrefPoseStackReset();
      if (typeof toast === 'function') toast('3D panels reset to the right side');
    } else {
      try { localStorage.removeItem('tailref-pose-stack-v2'); localStorage.removeItem('tailref-pose-stack-v1'); } catch { /* sessiz */ }
      if (typeof toast === 'function') toast('3D panel positions reset');
    }
  };

  /* 3D gezinme şeması: Maya (endüstri standardı) ↔ Blender.
     Seçim localStorage'a yazılır; 3D panel açıksa olayla anında uygulanır,
     kapalıysa CameraManager açılışta okur. */
  const poseNavSelect = $('#settingsPoseNav');
  if (poseNavSelect) {
    let storedNav = 'maya';
    try { storedNav = localStorage.getItem('tailref-pose3d-nav') === 'blender' ? 'blender' : 'maya'; } catch { /* sessiz */ }
    poseNavSelect.value = storedNav;
    if (poseNavSelect.dataset.bound !== '1') {
      poseNavSelect.dataset.bound = '1';
      poseNavSelect.addEventListener('change', () => {
        const preset = poseNavSelect.value === 'blender' ? 'blender' : 'maya';
        try { localStorage.setItem('tailref-pose3d-nav', preset); } catch { /* sessiz */ }
        try {
          window.dispatchEvent(new CustomEvent('tailref:pose3d-nav', { detail: { preset } }));
        } catch { /* sessiz */ }
        if (typeof toast === 'function') {
          toast(preset === 'blender'
            ? '3D navigation: Blender — middle = orbit, Shift + middle = pan, Ctrl + middle = zoom'
            : '3D navigation: Industry standard — Alt + left = orbit, Alt + middle = pan, Alt + right = zoom');
        }
      });
    }
  }

  /* 3D sahne sıfırla: pozlar + boyutlar + görünürlükler, kamera
     yeniden çerçevelenir (kullanıcı 9 Kasım). Poz kütüphanesine ve
     2D tahtaya dokunmaz. */
  const pose3dResetBtn = $('#settingsPose3dReset');
  if (pose3dResetBtn) pose3dResetBtn.onclick = () => {
    if (typeof window.tailrefPose3dEverything === 'function') {
      window.tailrefPose3dEverything();
      if (typeof toast === 'function') toast('3D scene reset');
    } else {
      if (typeof toast === 'function') toast('3D mode was never opened; there is no scene to reset');
    }
  };

  /* ---- Hız ve Performans bölümü (kullanıcı 10 Kasım) ----
     Karo seçimi zaten yukarıdaki tileSelect kanalına bağlı; burada yalnız
     3D kalite, "Back to auto", "yeniden ölç" ve canlı özet bağlanır. */
  const q3dSelect = $('#settingsPerfQ3dSelect');
  if (q3dSelect) q3dSelect.onchange = () => {
    const level = q3dSelect.value;
    try { localStorage.setItem('tailref-q3d-level', level); } catch { /* sessiz */ }
    try {
      if (window.tailrefPose3dPerf) {
        if (level === 'auto') window.tailrefPose3dPerf.setAuto?.();
        else window.tailrefPose3dPerf.setManual?.(level);
      }
    } catch { /* sessiz */ }
    if (typeof toast === 'function') {
      toast(level === 'auto'
        ? __t('3D quality: Auto (monitored by the app)')
        : __t('3D quality locked: ') + settingsHubPerfQ3dLabel(level));
    }
    settingsHubPerfSync();
  };

  const perfAutoBack = $('#settingsPerfAutoBack');
  if (perfAutoBack) perfAutoBack.onclick = () => {
    try { if (window.inkV5Settings) window.inkV5Settings.setTileSize('auto'); } catch { /* sessiz */ }
    try { localStorage.setItem('tailref-q3d-level', 'auto'); } catch { /* sessiz */ }
    try { window.tailrefPose3dPerf?.setAuto?.(); } catch { /* sessiz */ }
    if (typeof toast === 'function') toast('Tile and 3D quality reverted to Auto');
    settingsHubPerfSync();
  };

  const perfRemeasure = $('#settingsPerfRemeasure');
  if (perfRemeasure) perfRemeasure.onclick = async () => {
    let fps = null;
    try { fps = await window.tailrefPose3dPerf?.remeasure?.() ?? null; } catch { fps = null; }
    try { if (window.inkV5Settings) window.inkV5Settings.remeasureTile?.(); } catch { /* sessiz */ }
    if (typeof toast === 'function') {
      toast(fps != null
        ? __t('Measurement done: 3D {fps} FPS on this computer', { fps: Math.round(fps) })
        : __t('Tiles will be re-measured — after a few strokes it picks its own size'));
    }
    settingsHubPerfSync();
  };

  /* Otomatik vites/ölçümler değişince özet satırı tazelensin. */
  window.addEventListener('tailref-perf-changed', () => {
    if (typeof isPanelVisible === 'function' && isPanelVisible(settingsEl)) settingsHubPerfSync();
  });

  /* Mod değişince açık pencerenin değerleri güncel kalsın (tema vs.). */
  window.addEventListener('tailref-mode-changed', () => {
    if (typeof isPanelVisible === 'function' && isPanelVisible(settingsEl)) settingsHubSync();
  });

  /* Tur T Faz 5: arayüz değişince galeri + aktif etiket canlı tazelenir
     (restart yok; hem apply() hem F5 dışı her yoldan gelir). */
  document.addEventListener('tailref-interface-changed', () => {
    if (typeof isPanelVisible === 'function' && isPanelVisible(settingsEl)) settingsHubPopulateInterfaces();
  });
}
