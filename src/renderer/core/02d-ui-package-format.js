'use strict';
/* ======================================================================
   TailRef · Tur T Faz 6 — Arayüz paket formatı doğrulayıcı (SAF)
   ======================================================================
   Format: { format:"tailref-ui@1", meta{name,author,version,desc},
             tokens{--ui-*:değer}, rules[{selector, props{...}}] }
   GÜVENLİK KURALLARI (spec):
   - JS yürütme YOK: bu modül saf Object/JSON denetimi yapar; paketten
     kod ÇALIŞTIRILMAZ. CSS metni bu modülde BİZ üretiriz — paketin
     ham CSS'i asla belgeye girmaz.
   - Boyut limiti: paket ≤ 64 KB (MAX_BYTES).
   - Alan doğrulama: property whitelist, seçici/özellik karakter seti
     ({};@ ve url()/expression()/javascript: yasak).
   - Asset yalnız data:image/* URI (background-image); path yok.
   Bu dosya SAF'tır (DOM/localStorage YOK): hem app bundle'ında hem
   scripts/ui-package-validate.js CLI'ında aynı kod koşar.
   ====================================================================== */

(function () {
  const MAX_BYTES = 65536;          /* tek paket limiti */
  const MAX_RULES = 120;
  const MAX_TOKENS = 64;

  /* Property whitelist — sunum kimliği taşıyan güvenli küme.
     Arayüz paketi yerleşimi değiştiremez (position/display yasak),
     veri okuyamaz, davranışa giremez. */
  const PROP_ALLOW = new Set([
    'background', 'background-color', 'background-image',
    'color', 'opacity',
    'border', 'border-color', 'border-radius', 'border-width',
    'box-shadow', 'outline',
    'font-family', 'font-size', 'font-weight',
    'letter-spacing', 'text-transform',
    'min-height', 'height',
    'padding', 'gap',
  ]);

  const FORBIDDEN_IN_VALUE = ['url(', 'expression(', 'javascript:', 'import', '@import'];

  function err(errors, msg) { errors.push(msg); }

  function checkText(value, label, errors, max) {
    if (typeof value !== 'string') { err(errors, label + ' is not text'); return; }
    if (value.length > max) { err(errors, label + ' is too long (>' + max + ')'); }
    /* CSS dil enjeksiyonu yüzeyi: {} ; @ ve ters bölü (CSS kaçış dizisi)
       belgeye bizim derleyicimizden girmedikçe zararsız olsa da doğrulama
       REDDEDER (hatasız paket ilkesi). Ters bölü olmadan `\7b` gibi bir
       kaçış dizisi `{` olarak çözülüp kural enjekte edebilirdi. */
    if (/[{};@\\]/.test(value)) { err(errors, label + ' contains a forbidden character'); return; }
    const low = value.toLowerCase();
    for (const bad of FORBIDDEN_IN_VALUE) {
      if (low.includes(bad)) { err(errors, label + ' contains forbidden content: ' + bad); return; }
    }
  }

  /** background-image özel kuralı: yalnız 'none' veya data:image/* URI. */
  function checkBackgroundImage(value, errors) {
    if (value === 'none') return;
    const low = String(value).toLowerCase();
    if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/.test(low)) {
      err(errors, 'background-image must be a data:image/* URI or none');
    }
  }

  /** Seçici: {} ; @ < ve ters bölü yasak — enjeksiyon yüzeyini kapatır. */
  function checkSelector(sel, errors) {
    if (typeof sel !== 'string' || !sel.trim()) { err(errors, 'empty selector'); return; }
    if (sel.length > 120) { err(errors, 'selector is too long'); return; }
    if (/[{};@<\\]/.test(sel)) { err(errors, 'selector contains a forbidden character'); return; }
  }

  /**
   * Paketi doğrular; geçerliyse derlenmiş CSS'i döner.
   * @param {*} pkg    çözümlenmiş JSON (Object olmalı)
   * @param {string} id belgeye yazılacak arayüz id'si (önek ui_)
   * @returns {{ok:true, css:string} | {ok:false, errors:string[]}}
   */
  function validate(pkg, id) {
    const errors = [];
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
      return { ok: false, errors: ['package is not an object'] };
    }
    if (pkg.format !== 'tailref-ui@1') {
      return { ok: false, errors: ['format is not "tailref-ui@1": ' + JSON.stringify(pkg.format).slice(0, 40)] };
    }
    const meta = pkg.meta;
    if (!meta || typeof meta !== 'object' || typeof meta.name !== 'string' || !meta.name.trim()) {
      return { ok: false, errors: ['meta.name is required'] };
    }
    checkText(meta.name, 'meta.name', errors, 40);
    checkText(meta.author || '', 'meta.author', errors, 60);
    checkText(meta.desc || '', 'meta.desc', errors, 200);
    if (meta.version != null && !(typeof meta.version === 'number' && meta.version > 0)) {
      err(errors, 'meta.version must be a positive number');
    }

    /* --- tokens: yalnız --ui-* özel özellikleri --- */
    const tokens = pkg.tokens || {};
    const tokenKeys = Object.keys(tokens);
    if (tokenKeys.length > MAX_TOKENS) err(errors, 'token count > ' + MAX_TOKENS);
    let tokenCss = '';
    for (const key of tokenKeys) {
      if (!/^--ui-[a-z0-9-]{2,40}$/.test(key)) { err(errors, 'token name is not whitelisted: ' + key); continue; }
      const value = tokens[key];
      checkText(value, 'token ' + key, errors, 200);
      if (typeof value === 'string' && !/[{};@\\]/.test(value)) {
        tokenCss += key + ':' + value + ';';
      }
    }

    /* --- rules: whitelisted property + güvenli değer (denetim turu) --- */
    const rules = Array.isArray(pkg.rules) ? pkg.rules : [];
    if (rules.length > MAX_RULES) err(errors, 'rule count > ' + MAX_RULES);
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule || typeof rule !== 'object') { err(errors, 'rule #' + i + ' is not an object'); continue; }
      checkSelector(rule.selector, errors);
      for (const prop of Object.keys(rule.props || {})) {
        const pl = String(prop).toLowerCase();
        if (!PROP_ALLOW.has(pl)) { err(errors, 'property is not whitelisted: ' + prop); continue; }
        const value = rule.props[prop];
        if (typeof value !== 'string') { err(errors, prop + ' value is not text'); continue; }
        if (value.length > 300) { err(errors, prop + ' value is too long'); continue; }
        if (pl === 'background-image') { checkBackgroundImage(value, errors); }
        else checkText(value, prop + ' value', errors, 300);
      }
    }

    if (errors.length) return { ok: false, errors };

    /* --- derleme: bu modül CSS metnini kendisi üretir.
       Kurallar !important ile derlenir — sunum otoritesi emsali
       (skin otoritesi): ID'li temel kurallar paketi eziyordu.
       Tokenlar özel özellik olduğundan !important'suz. --- */
    let css = ':root[data-interface="' + id + '"]{' + tokenCss + '}';
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule || typeof rule !== 'object') continue;
      let props = '';
      for (const prop of Object.keys(rule.props || {})) {
        const pl = String(prop).toLowerCase();
        const value = rule.props[prop];
        if (typeof value !== 'string' || !PROP_ALLOW.has(pl)) continue;
        if (pl === 'background-image') {
          if (value !== 'none' && !/^data:image\//i.test(value)) continue;
        } else if (/[{};@\\]/.test(value)) continue;
        props += pl + ':' + value + '!important;';
      }
      /* ÖNEMLİ: önek ile seçici arasında torun kombinatoru (boşluk) ŞART —
         aksi hâlde compound selector olur ve hiçbir şeyi eşlemez. */
      if (props && !/[{};@<\\]/.test(rule.selector)) {
        css += ':root[data-interface="' + id + '"] ' + rule.selector + '{' + props + '}';
      }
    }
    return { ok: true, css };
  }

  window.tailrefUiPackageFormat = { validate, MAX_BYTES, PROP_ALLOW };
})();
