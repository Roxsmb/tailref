/* =========================================================
   01b-l10n.js — L10N çekirdeği (yerelleştirme)
   ---------------------------------------------------------
   gettext-tarzı, İngilizce-literal anahtarlı sistem:
     · Anahtar = İngilizce metin (EN = identity fallback — kod
       çevirisiz çalışır, ham anahtar asla kullanıcıya görünmez).
     · Sözlükler window.TailRefLocales içinde (01c-locale-data.js,
       scripts/build-locales.js tarafından locales/*.json'dan üretilir).
     · t(anahtar, params)        → {ad} interpolasyonu
     · tPlural(anahtar, count)   → Intl.PluralRules (anahtar_one/other…)
     · lang() / setLang(kod)     → anlık geçiş, restart yok
     · onChange(cb)              → modüller menü/panel yeniler
     · applyDom(kök)             → [data-l10n] + nitelik varyantları
   Kalıcılık: localStorage 'tailref-lang' (varsayılan 'en').
   Eski anahtar 'tailref-language' bir kez göçürülür.
   Yerelleştirilmeyenler: dosya uzantıları, kısayollar, marka adları,
   kullanıcı içeriği (kaynak kodda zaten t()suz geçilir).
   ========================================================= */
'use strict';

(function () {
  if (window.L10N) return; // çift yükleme koruması (draw-v5 vs.)

  const LANG_KEY = 'tailref-lang';
  const LEGACY_KEY = 'tailref-language';
  const DEFAULT_LANG = 'en';

  /* Desteklenen diller — adlar NATIVE (seçicide hiç çevrilmez). */
  const LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'tr', name: 'Türkçe' },
    { code: 'de', name: 'Deutsch' },
    { code: 'fr', name: 'Français' },
    { code: 'es', name: 'Español' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'zh-CN', name: '简体中文' },
    { code: 'pt-BR', name: 'Português (Brasil)' },
    { code: 'ru', name: 'Русский' },
  ];
  const CODES = new Set(LANGUAGES.map(l => l.code));

  /* --- Kalıcılık + göç ------------------------------------------------ */
  function storedLang() {
    try {
      const cur = localStorage.getItem(LANG_KEY);
      if (cur && CODES.has(cur)) return cur;
      /* eski anahtardan bir kez göç (kullanıcının önceki seçimi korunur) */
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy && CODES.has(legacy)) {
        localStorage.setItem(LANG_KEY, legacy);
        return legacy;
      }
    } catch { /* sessiz — özel mod vb. */ }
    return DEFAULT_LANG;
  }

  let current = storedLang();
  const listeners = new Set();

  /* --- Sözlük erişimi ------------------------------------------------- */
  function dict(code) {
    const all = window.TailRefLocales;
    return (all && all[code]) || null;
  }

  function lookup(dictObj, key) {
    if (!dictObj) return undefined;
    const v = dictObj[key];
    return (typeof v === 'string' && v.length) ? v : undefined;
  }

  /* Çoğul: anahtar_one / anahtar_other … yoksa düz anahtar,
     o da yoksa EN, o da yoksa soneksiz anahtar (identity). */
  function pluralKey(key, n) {
    let cat = 'other';
    try {
      const rules = new Intl.PluralRules(current === 'en' ? 'en' : current);
      cat = rules.select(n);
    } catch { /* kategori 'other' kalır */ }
    return key + '_' + cat;
  }

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (m, name) => {
      const v = params[name];
      return (v === undefined || v === null) ? m : String(v);
    });
  }

  /** Çevir: t('Brush') → sözlükteki karşılık; yoksa anahtarın kendisi. */
  function t(key, params) {
    if (typeof key !== 'string' || !key) return key;
    let out = lookup(dict(current), key);
    if (out === undefined) out = lookup(dict('en'), key);
    if (out === undefined) out = key; // EN = identity fallback
    return interpolate(out, params);
  }

  /** Çoğullu çeviri: tPlural('item', 3) → 'items' ('item_one'/'item_other'). */
  function tPlural(key, count, params) {
    if (typeof key !== 'string' || !key) return key;
    const n = Number(count) || 0;
    const pkey = pluralKey(key, n);
    let out = lookup(dict(current), pkey);
    if (out === undefined) out = lookup(dict('en'), pkey);
    if (out === undefined) {
      /* EN soneksiz kimlik: soneki soyup düz anahtara düş */
      const base = key.replace(/_(one|two|few|many|zero|other)$/, '');
      out = lookup(dict(current), base);
      if (out === undefined) out = lookup(dict('en'), base);
      if (out === undefined) out = base;
    }
    return interpolate(out, Object.assign({}, params, { count: n }));
  }

  /* --- DOM uygulama --------------------------------------------------- */
  const ATTRS = [
    ['data-l10n', null],               // metin içeriği
    ['data-l10n-title', 'title'],
    ['data-l10n-aria', 'aria-label'],
    ['data-l10n-placeholder', 'placeholder'],
    ['data-l10n-help', 'data-help'],   // ayar "?" yardım metni (CSS attr() ile basılır)
    ['data-l10n-label', 'label'],      // optgroup/option grup etiketi
  ];

  function applyElement(el) {
    for (const [attr, prop] of ATTRS) {
      const key = el.getAttribute(attr);
      if (key === null) continue;
      const value = t(key);
      /* Düğme title'ları → data-tooltip kanalı (15 Kasım 2026):
         l10n her yenilemede title'ı geri yazarsa native tooltip (pencere
         kenarında kırılan tek satır kutu) özel pill ile ÜST ÜSTE biner
         (kullanıcı: "üstlerinde yazan şeyin yarısı yok oluyor"). Düğmelerde
         title yazılmaz; çeviri data-tooltip'e + aria-label'a gider. */
      const isButton = prop === 'title' && el.matches &&
        (el.matches('button') || el.matches('[role="button"]'));
      if (isButton) {
        if (el.getAttribute('data-tooltip') !== value) el.setAttribute('data-tooltip', value);
        if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', value);
        if (el.hasAttribute('title')) el.removeAttribute('title');
        continue;
      }
      if (prop) el.setAttribute(prop, value);
      else if (el.firstChild && el.childElementCount === 0 &&
               el.children.length === 0 && el.firstChild.nodeType === 3) {
        /* tek metin düğümü: alt öğeleri bozmadan değiştir */
        el.firstChild.nodeValue = value;
      } else {
        el.textContent = value;
      }
    }
    /* Tooltip kanalı: 16-toolbar title'ı data-tooltip'a taşır; dil değişince
       data-tooltip da güncellenir (aksi halde eski dilde kalır). Duruma bağlı
       dinamik tooltip'ler ilgili modülün onChange yenilemesiyle geri yazılır. */
    const kt = el.getAttribute('data-l10n-title');
    if (kt !== null && el.hasAttribute('data-tooltip')) {
      const v = t(kt);
      if (el.getAttribute('data-tooltip') !== v) el.setAttribute('data-tooltip', v);
    }
  }

  /** Kök altındaki tüm [data-l10n*] öğelerini günceller (varsayılan: döküman). */
  function applyDom(root) {
    const scope = root || document;
    if (!scope.querySelectorAll) return;
    if (scope !== document && scope.matches &&
        scope.matches('[data-l10n],[data-l10n-title],[data-l10n-aria],[data-l10n-placeholder],[data-l10n-help],[data-l10n-label]')) {
      applyElement(scope);
    }
    const sel = '[data-l10n],[data-l10n-title],[data-l10n-aria],[data-l10n-placeholder],[data-l10n-help],[data-l10n-label]';
    for (const el of scope.querySelectorAll(sel)) applyElement(el);
  }

  /* --- Geçiş ---------------------------------------------------------- */
  function lang() { return current; }

  function setLang(code, opts) {
    if (!CODES.has(code)) return current;
    if (code === current) { applyDom(); fire(); return current; }
    current = code;
    try { localStorage.setItem(LANG_KEY, code); } catch { /* sessiz */ }
    try { document.documentElement.lang = code; } catch { /* sessiz */ }
    if (!(opts && opts.silent)) applyDom();
    fire();
    return current;
  }

  function fire() {
    for (const cb of [...listeners]) {
      try { cb(current); } catch (e) { /* dinleyici hatası zinciri bozmasın */ }
    }
  }

  function onChange(cb) {
    if (typeof cb !== 'function') return () => {};
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  /** Seçici doldurma yardımcıları (ayarlar hub'ı kullanır). */
  function available() { return LANGUAGES.slice(); }
  function nativeName(code) {
    const l = LANGUAGES.find(x => x.code === code);
    return l ? l.name : code;
  }

  /* --- Açılış --------------------------------------------------------- */
  try { document.documentElement.lang = current; } catch { /* sessiz */ }
  /* Ana-süreç diyaloglarını (kaydet/aç, kapatma uyarısı, kurtarma kutuları)
     yerel dilde göstermek için dil seçimini ana sürece bildir: açılışta
     bir kez + her setLang değişiminde. Masaüstü köprüsü yoksa (tarayıcı
     sürümü) sessizce atlanır. */
  try {
    const send = window.tailref && window.tailref.sendAppLanguage;
    if (typeof send === 'function') {
      send(current);
      onChange(code => { try { send(code); } catch { /* sessiz */ } });
    }
  } catch { /* sessiz */ }
  /* Modüller DOM'u sonradan inşa ettiğinden üç aşamada uygulanır:
     hemen + DOMContentLoaded + load (idempotent — son kazanan güncel dil). */
  try { applyDom(); } catch { /* sessiz */ }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { try { applyDom(); } catch { /* sessiz */ } }, { once: true });
  }
  window.addEventListener('load', () => {
    try { applyDom(); } catch { /* sessiz */ }
    /* async modül kurulumları (fırça/panel yüklemeleri) load'dan sonra
       bittiği için bir kez daha — gecikmiş kurulumlar için son perde. */
    setTimeout(() => { try { if (current !== 'en') applyDom(); } catch { /* sessiz */ } }, 1500);
  });

  window.L10N = { t, tPlural, lang, setLang, onChange, applyDom, available, nativeName };

  /** Modüller için kısa yardımcı: __t('Brush') — L10N hazır değilse anahtar döner. */
  window.__t = function (key, params) {
    if (typeof key !== 'string' || !key) return key;
    try { return t(key, params); } catch { return key; }
  };

  /** Çoğul yardımcısı: __tp('image', 3). IIFE kapsamı dışındaki dosyalar
      çıplak tPlural() çağıramaz (ReferenceError); bu köprü tek güvenli yol. */
  window.__tp = function (key, count, params) {
    if (typeof key !== 'string' || !key) return key;
    try { return tPlural(key, count, params); } catch { return key; }
  };
})();
