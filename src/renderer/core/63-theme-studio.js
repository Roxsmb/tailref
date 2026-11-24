'use strict';
/* ======================================================================
   TailRef · Tur T Faz 3 — Tema stüdyosu (Ayarlar → Görünüm)
   ======================================================================
   Galeri (gömülü + özel) + özel tema editörü + görsel tema kaynakları.
   Kurallar:
   - Gömülü tema kartları paletini CSSOM'dan OKUR (kopya veri yok —
     style.css'teki :root[data-theme] blokları tek kaynaktır).
   - Kart tıklaması temayı ANINDA uygular (restart yok).
   - Canlı önizleme: editördeki her değişiklik taslağı uygular; Kaydet
     olmadan kalıcı olmaz. Mevcut tema ASLA sessizce ezilmez: özel tema
     üzerine yazma yalnızca window.confirm onayıyla; gömülü temalar
     daima YENİ tema olarak kaydedilir (spec 1.3).
   - Palet çıkarma ve görsel küçültme yerel canvas'tır (harici servis
     yok; spec 1.4). Depolama localStorage (tercih yedeği otomatik).
   ====================================================================== */

/* ---- editör taslağı (modül durumu; panel kapanınca korunur) ---- */
let themeStudioDraft = null;
let themeStudioPreviewTimer = 0;

function themeStudioRoot() { return document.documentElement; }
/* Seçimi aktif modun anahtarına da yaz (çizim/referans ayrı tema tutar). */
function themeStudioApplyForMode(id) {
  if (typeof window.tailrefThemeApplyForMode === 'function') window.tailrefThemeApplyForMode(id);
  else if (typeof applyTheme === 'function') applyTheme(id);
}
function themeStudioBackdropGradientCss() {
  const bd = document.getElementById('backdrop');
  if (!bd) return null;
  const img = getComputedStyle(bd).backgroundImage || '';
  return /gradient\(/i.test(img) ? img : null;
}
function themeStudioCurrentEffect() {
  const cur = document.documentElement.dataset.theme || 'classic';
  if (cur === 'rain' || cur === 'snow') return cur;
  const reg = window.tailrefThemeRegistry;
  return reg && typeof reg.effectOf === 'function' ? reg.effectOf(cur) : null;
}

/* ---- gömülü tema paletini CSSOM'dan oku ---- */
function themeStudioBuiltinColors(id) {
  const want = ':root[data-theme="' + id + '"]';
  for (const sheet of document.styleSheets) {
    let rules = null;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const r of rules) {
      if (!r.selectorText || r.selectorText !== want) continue;
      const out = {};
      let found = 0;
      for (const k of ['bg', 'panel', 'border', 'text', 'dim', 'accent']) {
        const v = r.style.getPropertyValue('--' + k).trim();
        if (v) { out[k] = v; found++; }
      }
      if (found >= 5) return out;
    }
  }
  return null;
}
function themeStudioClassicColors() {
  const cs = getComputedStyle(themeStudioRoot());
  const v = k => cs.getPropertyValue('--' + k).trim();
  return { bg: v('bg'), panel: v('panel'), border: v('border'), text: v('text'), dim: v('dim'), accent: v('accent') };
}
function themeStudioNormalize(colors) {
  const reg = window.tailrefThemeRegistry;
  const hex = v => {
    if (!v) return '#4da3ff';
    if (String(v).trim().startsWith('#')) return String(v).trim();
    /* rgba(...) → hex */
    try { return themeStudioHexFromRgbString(v); } catch { return '#4da3ff'; }
  };
  const out = { bg: hex(colors.bg), panel: hex(colors.panel), border: hex(colors.border),
    text: hex(colors.text), dim: hex(colors.dim), accent: hex(colors.accent) };
  out.accentInk = colors.accentInk && String(colors.accentInk).startsWith('#')
    ? colors.accentInk
    : (reg ? reg.accentInkFor(out.accent) : '#ffffff');
  return out;
}
function themeStudioHexFromRgbString(v) {
  const m = String(v).match(/[\d.]+/g) || [];
  const p = n => Math.max(0, Math.min(255, Math.round(+n || 0))).toString(16).padStart(2, '0');
  return '#' + p(m[0]) + p(m[1]) + p(m[2]);
}

/* ---- galeri ---- */
function themeStudioBuildGallery() {
  const box = document.getElementById('settingsThemeGallery');
  if (!box) return;
  const active = (document.documentElement.dataset.theme || 'classic');
  const reg = window.tailrefThemeRegistry;
  const customs = reg ? reg.list() : [];
  /* idempotent: her açılışta yeniden kur (seçim durumu değişebilir) */
  box.replaceChildren();
  const mkCard = (id, name, colors, isCustom) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'settingsThemeCard';
    card.dataset.themeCard = id;
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-pressed', String(active === id));
    /* native title yasak: data-tooltip kanalı */
    card.dataset.tooltip = name;
    card.setAttribute('aria-label', name);
    const nm = document.createElement('span');
    nm.className = 'settingsThemeCardName';
    nm.textContent = name;
    if (isCustom) {
      const tag = document.createElement('i');
      tag.className = 'settingsThemeCardTag';
      tag.textContent = '★';
      nm.appendChild(tag);
    }
    const strip = document.createElement('span');
    strip.className = 'settingsThemeCardSwatches';
    const c = themeStudioNormalize(colors || {});
    for (const k of ['bg', 'panel', 'border', 'accent', 'text']) {
      const i = document.createElement('i');
      i.style.background = k === 'panel' ? c.panel : c[k];
      strip.appendChild(i);
    }
    card.append(nm, strip);
    card.addEventListener('click', () => {
      /* Önceki taslak önizlemesinin inline override'ları temizlenmeli;
         aksi halde uygulanan tema görünmez (inline > data-theme). */
      themeStudioClearInlinePalette();
      if (isCustom) {
        const t = reg.list().find(x => x.id === id);
        if (t) {
          themeStudioApplyForMode(id);
          themeStudioLoadDraftFromCustom(t);
        }
      } else {
        themeStudioApplyForMode(id);
        themeStudioLoadDraftFromBuiltin(id);
      }
      settingsThemeStudioSync();
    });
    return card;
  };
  /* Gömülü temalar: 19-themes-effects dizi sırası korunur. */
  for (const id of (typeof themeNames === 'object' ? themeNames.filter(n => !n.startsWith('ct_')) : [])) {
    const colors = id === 'classic' ? themeStudioClassicColors() : themeStudioBuiltinColors(id);
    if (!colors) continue;
    box.appendChild(mkCard(id, id.charAt(0).toUpperCase() + id.slice(1), colors, false));
  }
  for (const t of customs) {
    box.appendChild(mkCard(t.id, t.name, themeStudioPanelHex(t), true));
  }
}
function themeStudioPanelHex(t) {
  /* panel rgba string'i olabilir → hex'e indirger (önizleme için) */
  const c = { ...t.colors };
  if (typeof c.panel === 'string' && c.panel.startsWith('rgba')) c.panel = themeStudioHexFromRgbString(c.panel);
  return c;
}

/* ---- editör ---- */
function themeStudioBuildColorInputs() {
  const box = document.getElementById('settingsCustomThemeColors');
  if (!box || box.childElementCount) return;
  const reg = window.tailrefThemeRegistry;
  const labels = reg ? reg.slotLabels : {};
  for (const k of (reg ? reg.slots : ['bg', 'panel', 'border', 'text', 'dim', 'accent', 'accentInk'])) {
    const wrap = document.createElement('label');
    wrap.className = 'settingsCustomColor';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = '#4da3ff';
    inp.dataset.slot = k;
    /* native title yasak: data-tooltip */
    inp.dataset.tooltip = labels[k] || k;
    inp.setAttribute('aria-label', labels[k] || k);
    const nm = document.createElement('span');
    nm.textContent = labels[k] || k;
    inp.addEventListener('input', () => {
      if (!themeStudioDraft) return;
      themeStudioDraft.colors[k] = inp.value;
      themeStudioSchedulePreview();
      themeStudioHint();
    });
    wrap.append(inp, nm);
    box.appendChild(wrap);
  }
}
function themeStudioLoadDraftFromBuiltin(id) {
  const raw = id === 'classic' ? themeStudioClassicColors() : themeStudioBuiltinColors(id);
  if (!raw) return;
  themeStudioDraft = {
    id: null, sourceId: id, sourceCustom: false,
    name: id === 'classic' ? '' : id.charAt(0).toUpperCase() + id.slice(1) + ' style',
    colors: themeStudioNormalize(raw), panelAlpha: 94, backdrop: null,
    /* Rain/Snow: efekt + kendi gradyanı kaydetmede korunur. */
    effect: (id === 'rain' || id === 'snow') ? id : null,
    backdropCss: themeStudioBackdropGradientCss(),
  };
  themeStudioDraftToUi();
}
function themeStudioLoadDraftFromCustom(t) {
  const colors = { ...t.colors };
  if (typeof colors.panel === 'string' && colors.panel.startsWith('rgba')) {
    colors.panel = themeStudioHexFromRgbString(colors.panel);
  }
  themeStudioDraft = {
    id: t.id, sourceId: t.id, sourceCustom: true,
    name: t.name, colors, panelAlpha: t.panelAlpha || 94,
    backdrop: t.backdrop ? { ...t.backdrop } : null,
    effect: t.effect === 'rain' || t.effect === 'snow' ? t.effect : null,
    backdropCss: t.backdropCss || null,
  };
  themeStudioDraftToUi();
}
function themeStudioNewFromCurrent() {
  themeStudioDraft = {
    id: null, sourceId: null, sourceCustom: false,
    name: '', colors: themeStudioNormalize(themeStudioClassicColors()),
    panelAlpha: 94, backdrop: null,
    effect: themeStudioCurrentEffect(),
    backdropCss: themeStudioBackdropGradientCss(),
  };
  /* Mevcut aktif tema görünümünden kopyala: computed değerler */
  const cs = getComputedStyle(themeStudioRoot());
  for (const k of ['bg', 'panel', 'border', 'text', 'dim', 'accent']) {
    const v = cs.getPropertyValue('--' + k).trim();
    if (v) themeStudioDraft.colors[k] = themeStudioNormalize({ [k]: v })[k];
  }
  themeStudioDraftToUi();
  themeStudioApplyPreview();
}
function themeStudioDraftToUi() {
  themeStudioBuildColorInputs();
  const box = document.getElementById('settingsCustomThemeColors');
  if (box && themeStudioDraft) {
    for (const inp of box.querySelectorAll('input[type="color"]')) {
      const k = inp.dataset.slot;
      const v = themeStudioDraft.colors[k];
      if (v) inp.value = v.length === 7 ? v : '#' + v.slice(1).split('').map(c => c + c).join('');
    }
  }
  const name = document.getElementById('settingsCustomThemeName');
  if (name) name.value = themeStudioDraft ? themeStudioDraft.name : '';
  const alpha = document.getElementById('settingsCustomPanelAlpha');
  if (alpha) alpha.value = themeStudioDraft ? themeStudioDraft.panelAlpha : 94;
  const bd = themeStudioDraft && themeStudioDraft.backdrop;
  const opts = document.getElementById('settingsCustomThemeImageOpts');
  if (opts) opts.hidden = !bd || !bd.image;
  if (bd && bd.image) {
    const size = document.getElementById('settingsCustomImageSize');
    const op = document.getElementById('settingsCustomImageOpacity');
    const bl = document.getElementById('settingsCustomImageBlur');
    if (size) size.value = bd.size || 'cover';
    if (op) op.value = Math.round((bd.opacity == null ? 1 : bd.opacity) * 100);
    if (bl) bl.value = bd.blur || 0;
  }
  themeStudioHint();
}
function themeStudioHint() {
  const el = document.getElementById('settingsCustomThemeHint');
  if (!el) return;
  if (!themeStudioDraft) { el.textContent = window.L10N ? L10N.t('Pick a theme card, or New from current.') : 'Pick a theme card, or New from current.'; return; }
  const src = themeStudioDraft.sourceCustom ? (window.L10N ? L10N.t('editing a custom theme') : 'editing a custom theme')
    : themeStudioDraft.sourceId ? (window.L10N ? L10N.t('built-in theme — saving creates a new theme') : 'built-in theme — saving creates a new theme')
    : (window.L10N ? L10N.t('new theme') : 'new theme');
  el.textContent = (window.L10N ? L10N.t('Draft') : 'Draft') + ': ' + src;
}
function themeStudioSchedulePreview() {
  if (themeStudioPreviewTimer) clearTimeout(themeStudioPreviewTimer);
  themeStudioPreviewTimer = setTimeout(themeStudioApplyPreview, 120);
}
function themeStudioApplyPreview() {
  if (!themeStudioDraft) return;
  const reg = window.tailrefThemeRegistry;
  if (!reg) return;
  /* Taslak applyTheme akışından geçmez (kaydasız) → geçici kural:
     draft'ı GEÇİCİ id ile kaydetmeyen mini uygulama yerine doğrudan
     inline override + dataset kanca (accent modeli). Kaydet deyince
     temizlenir. */
  const root = themeStudioRoot();
  const c = themeStudioDraft.colors;
  const alpha = Math.max(40, Math.min(100, +themeStudioDraft.panelAlpha || 94)) / 100;
  const pv = themeRegHexToRgbSafe(c.panel);
  root.style.setProperty('--bg', c.bg);
  root.style.setProperty('--panel', `rgba(${pv.r},${pv.g},${pv.b},${alpha})`);
  root.style.setProperty('--border', c.border);
  root.style.setProperty('--text', c.text);
  root.style.setProperty('--dim', c.dim);
  root.style.setProperty('--accent', c.accent);
  root.style.setProperty('--accent-ink', reg.accentInkFor(c.accent));
  root.dataset.customDraft = '1';
  const backdrop = document.getElementById('backdrop');
  const bd = themeStudioDraft.backdrop;
  if (backdrop) {
    if (bd && bd.image) {
      backdrop.style.backgroundColor = c.bg;
      backdrop.style.backgroundImage = `url("${bd.image}")`;
      backdrop.style.backgroundPosition = bd.position || 'center';
      backdrop.style.backgroundSize = bd.size || 'cover';
      backdrop.style.backgroundRepeat = 'no-repeat';
      backdrop.style.opacity = String(Math.max(0.05, Math.min(1, +bd.opacity || 1)));
      backdrop.style.filter = `blur(${Math.max(0, Math.min(40, +bd.blur || 0))}px)`;
    } else {
      themeStudioClearBackdropInline();
      /* Kullanıcı kararı: Background rengi backdrop'ı da canlı boyasın.
         Rain/Snow'dan gelen gradyan varsa korunur; yoksa düz renk.
         (Kaydet'te üretilen kural aynı gradyanı taşır.) */
      backdrop.style.backgroundImage = themeStudioDraft.backdropCss || 'none';
      backdrop.style.backgroundColor = c.bg;
    }
  }
  if (typeof inkNativeRefreshPreviews === 'function') {
    requestAnimationFrame(() => { try { inkNativeRefreshPreviews(); } catch { /* sessiz */ } });
  }
}
function themeRegHexToRgbSafe(v) {
  if (typeof window.tailrefThemeRegistry === 'object' && window.tailrefThemeRegistry.mix) {
    /* registry mix'i üzerinden rgb'e çevirim: mix(v,v,0) = v */
  }
  const m = String(v || '#000000').match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  let h = m ? m[1] : '000000';
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
/** Taslak inline override'larını temizler; accent override'ını
    (kullanıcı kayıtlıysa) geri yazar. Ardından çağıran taraf gerçek
    temayı uygular (applyTheme). */
function themeStudioClearInlinePalette() {
  const root = themeStudioRoot();
  if (!root.dataset.customDraft) return;
  for (const k of ['--bg', '--panel', '--border', '--text', '--dim', '--accent', '--accent-ink']) {
    root.style.removeProperty(k);
  }
  delete root.dataset.customDraft;
  themeStudioClearBackdropInline();
  try {
    const acc = localStorage.getItem('tailref-accent');
    if (acc) {
      root.style.setProperty('--accent', acc);
      const reg = window.tailrefThemeRegistry;
      root.style.setProperty('--accent-ink', reg ? reg.accentInkFor(acc) : '#ffffff');
      root.dataset.accent = '1';
    }
  } catch { /* sessiz */ }
  if (typeof inkNativeRefreshPreviews === 'function') {
    requestAnimationFrame(() => { try { inkNativeRefreshPreviews(); } catch { /* sessiz */ } });
  }
}
function themeStudioClearBackdropInline() {
  const backdrop = document.getElementById('backdrop');
  if (!backdrop) return;
  for (const p of ['backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundSize', 'backgroundRepeat', 'opacity', 'filter']) {
    backdrop.style.removeProperty(p.replace(/[A-Z]/g, m => '-' + m.toLowerCase()));
  }
}

/* ---- panel açılış senkronu ---- */
function settingsThemeStudioSync() {
  themeStudioBuildColorInputs();
  themeStudioBuildGallery();
  /* Editör boşsa ve aktif tema özel ise onu yükle */
  if (!themeStudioDraft) {
    const reg = window.tailrefThemeRegistry;
    const active = reg ? reg.list().find(t => t.id === (document.documentElement.dataset.theme || '')) : null;
    if (active) themeStudioLoadDraftFromCustom(active);
  }
  if (themeStudioDraft) themeStudioDraftToUi();
  themeStudioSyncToolbarSelects();
}
function themeStudioSyncToolbarSelects() {
  const reg = window.tailrefThemeRegistry;
  if (!reg) return;
  const list = reg.list();
  /* Görünen (uygulanmış) tema esastır: mod başına anahtar base'den farklı
     olabilir; select eski temayı göstermesin. */
  const active = document.documentElement.dataset.theme || 'classic';
  for (const id of ['themeSelect', 'themeSelectOverflow', 'settingsThemeGlobal', 'settingsThemeDraw', 'settingsThemeRef']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    for (const opt of [...sel.options]) if (opt.value.startsWith('ct_')) opt.remove();
    for (const t of list) {
      if ([...sel.options].some(o => o.value === t.id)) continue;
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }
    if (active.startsWith('ct_')) sel.value = active;
  }
}

/* ---- binding ---- */
function settingsThemeStudioBind() {
  if (document.getElementById('settingsCustomThemeSave')?.dataset.studioBound) return;
  const $ = id => document.getElementById(id);
  const save = $('settingsCustomThemeSave');
  if (save) save.dataset.studioBound = '1';
  const reg = window.tailrefThemeRegistry;

  $('settingsCustomThemeName')?.addEventListener('input', () => {
    if (themeStudioDraft) { themeStudioDraft.name = $('settingsCustomThemeName').value; themeStudioHint(); }
  });
  $('settingsCustomPanelAlpha')?.addEventListener('input', () => {
    if (!themeStudioDraft) return;
    themeStudioDraft.panelAlpha = +$('settingsCustomPanelAlpha').value;
    themeStudioSchedulePreview();
  });
  $('settingsCustomThemePreview')?.addEventListener('click', () => {
    if (!themeStudioDraft) { window.toast && toast(window.L10N ? L10N.t('Pick a theme card, or New from current.') : 'Pick a theme card, or New from current.'); return; }
    themeStudioApplyPreview();
  });
  $('settingsCustomThemeSave')?.addEventListener('click', () => {
    if (!themeStudioDraft || !reg) return;
    themeStudioDraft.name = ($('settingsCustomThemeName')?.value || '').trim();
    if (!themeStudioDraft.name) {
      themeStudioDraft.name = (window.L10N ? L10N.t('My theme') : 'My theme');
      if ($('settingsCustomThemeName')) $('settingsCustomThemeName').value = themeStudioDraft.name;
    }
    let asNew = false;
    if (themeStudioDraft.id && themeStudioDraft.sourceCustom) {
      const ok = window.confirm((window.L10N ? L10N.t('Overwrite this custom theme?') : 'Overwrite this custom theme?'));
      if (!ok) return;
    } else if (themeStudioDraft.id) {
      asNew = true; /* gömülü kaynak — daima yeni tema */
    }
    const res = reg.save(themeStudioDraft, asNew);
    if (!res.ok) {
      /* Doğrulama nedenleri artık İngilizce anahtarlar (02b); kullanıcıya
         seçili dilde göster. 'Invalid color: <slot>' slot adını korur. */
      const err = String(res.error || '');
      const msg = err === 'limit'
        ? (window.L10N ? L10N.t('Custom theme limit reached') : 'Custom theme limit reached')
        : err.indexOf('Invalid color: ') === 0
          ? __t('Invalid color') + err.slice('Invalid color'.length)
          : __t(err);
      window.toast && toast(msg);
      return;
    }
    /* Taslak inline override'ları kaldır — kayıtlı tema artık üretilmiş
       kural üzerinden (data-theme) geçerli; inline onu ezmesin. */
    themeStudioClearInlinePalette();
    /* Kaydetme aktif modun anahtarına da yazılmalı; yoksa çizimde kaydedilen
       tema mod değişiminde eski temaya dönüyordu. */
    if (typeof themeSet === 'function' && typeof themeModeNow === 'function') {
      themeSet(themeModeNow(), res.id);
    }
    /* draft artık kayıtlı temaya işaret eder */
    const saved = reg.list().find(t => t.id === res.id);
    if (saved) themeStudioLoadDraftFromCustom(saved);
    window.toast && toast(window.L10N ? L10N.t('Theme saved') : 'Theme saved');
    settingsThemeStudioSync();
  });
  $('settingsCustomThemeNew')?.addEventListener('click', () => {
    themeStudioNewFromCurrent();
  });
  $('settingsCustomThemeDuplicate')?.addEventListener('click', () => {
    if (!reg) return;
    const active = reg.active();
    const res = themeStudioDraft && themeStudioDraft.sourceCustom && themeStudioDraft.id
      ? reg.duplicate(themeStudioDraft.id) : null;
    if (!res || !res.ok) {
      /* Gömülü/aktif temayı kopyala: yeni taslak + kaydet */
      const src = reg.list().find(t => t.id === active);
      if (src) {
        const copy = reg.duplicate(src.id);
        if (copy.ok) { window.toast && toast(window.L10N ? L10N.t('Theme duplicated') : 'Theme duplicated'); settingsThemeStudioSync(); return; }
        /* Sınır doluysa kopya da 'limit' döner: ham kod yerine insan okur */
        if (copy.error === 'limit') {
          window.toast && toast(window.L10N ? L10N.t('Custom theme limit reached') : 'Custom theme limit reached');
          return;
        }
      }
      /* 'limit' ilk kopyadan dönerse de aynı kapıya düşer; 'yok' gibi
         iç kodlar asla ham gösterilmez. */
      if (res && res.error === 'limit') {
        window.toast && toast(window.L10N ? L10N.t('Custom theme limit reached') : 'Custom theme limit reached');
        return;
      }
      window.toast && toast(window.L10N ? L10N.t('Nothing to duplicate') : 'Nothing to duplicate');
      return;
    }
    window.toast && toast(window.L10N ? L10N.t('Theme duplicated') : 'Theme duplicated');
    settingsThemeStudioSync();
  });
  $('settingsCustomThemeDelete')?.addEventListener('click', () => {
    if (!reg) return;
    const target = themeStudioDraft && themeStudioDraft.sourceCustom ? themeStudioDraft.id : reg.active();
    if (!reg.isCustom(target)) { window.toast && toast(window.L10N ? L10N.t('Built-in themes cannot be deleted') : 'Built-in themes cannot be deleted'); return; }
    if (!window.confirm((window.L10N ? L10N.t('Delete this custom theme?') : 'Delete this custom theme?'))) return;
    const res = reg.delete(target);
    if (res.ok) {
      if (themeStudioDraft && themeStudioDraft.id === target) { themeStudioDraft = null; themeStudioDraftToUi(); }
      window.toast && toast(window.L10N ? L10N.t('Theme deleted') : 'Theme deleted');
      settingsThemeStudioSync();
    }
  });
  /* Görsel tema */
  const file = $('settingsCustomThemeFile');
  $('settingsCustomThemeUpload')?.addEventListener('click', () => file && file.click());
  file?.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { window.toast && toast(window.L10N ? L10N.t('Unsupported image format') : 'Unsupported image format'); return; }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error('read'));
        fr.readAsDataURL(f);
      });
      const small = await reg.downscale(dataUrl);
      if (!themeStudioDraft) themeStudioNewFromCurrent();
      themeStudioDraft.backdrop = {
        image: small, position: 'center', size: 'cover', opacity: 1, blur: 0,
      };
      $('settingsCustomThemeImageOpts').hidden = false;
      themeStudioSchedulePreview();
      themeStudioHint();
      window.toast && toast(window.L10N ? L10N.t('Image loaded — Preview or Save theme') : 'Image loaded — Preview or Save theme');
    } catch { window.toast && toast(window.L10N ? L10N.t('Image could not be read') : 'Image could not be read'); }
  });
  $('settingsCustomThemeExtract')?.addEventListener('click', async () => {
    if (!reg) return;
    const src = themeStudioDraft && themeStudioDraft.backdrop && themeStudioDraft.backdrop.image;
    if (!src) { window.toast && toast(window.L10N ? L10N.t('Upload an image first') : 'Upload an image first'); return; }
    try {
      const { palette, slots } = await reg.extractPalette(src);
      if (!themeStudioDraft) themeStudioNewFromCurrent();
      themeStudioDraft.colors = { ...themeStudioDraft.colors, ...slots };
      themeStudioDraftToUi();
      themeStudioApplyPreview();
      window.toast && toast((window.L10N ? L10N.t('Palette extracted') : 'Palette extracted') + ': ' + palette.length);
    } catch { window.toast && toast(window.L10N ? L10N.t('Palette extraction failed') : 'Palette extraction failed'); }
  });
  $('settingsCustomThemeImageClear')?.addEventListener('click', () => {
    if (!themeStudioDraft) return;
    themeStudioDraft.backdrop = null;
    const opts = $('settingsCustomThemeImageOpts');
    if (opts) opts.hidden = true;
    themeStudioSchedulePreview();
  });
  const bindImageOpt = (id, fn) => {
    $(id)?.addEventListener('input', () => {
      if (!themeStudioDraft || !themeStudioDraft.backdrop) return;
      fn(themeStudioDraft.backdrop, $(id).value);
      themeStudioSchedulePreview();
    });
  };
  bindImageOpt('settingsCustomImageSize', (bd, v) => { bd.size = v; });
  bindImageOpt('settingsCustomImageOpacity', (bd, v) => { bd.opacity = Math.max(0.05, Math.min(1, (+v || 100) / 100)); });
  bindImageOpt('settingsCustomImageBlur', (bd, v) => { bd.blur = Math.max(0, Math.min(40, +v || 0)); });
  /* Kayıt defteri değişince galeri + selectler tazelensin */
  document.addEventListener('tailref-custom-themes-changed', () => {
    themeStudioSyncToolbarSelects();
    if (document.getElementById('settings') && !document.getElementById('settings').hidden) settingsThemeStudioSync();
  });

  /* ---- Taslak inline override'ları tema uygulamasında temizle ----
     Önizleme root + #backdrop üzerine INLINE stil yazar (inline >
     data-theme kuralı). Kaydet düğmesi bunları temizliyor ama tema
     applyTheme ile BAŞKA bir yoldan değişirse (reg.save API çağrısı,
     toolbar select, keymap…) taslak inline'ları kalıyordu — örn.
     taslaksız önizlemeden kalan background-image:none, kaydedilen
     görsel temanın stylesheet kuralını eziyordu (theme-studio-test
     bulgusu). data-theme değiştiğinde temizlik idempotent: önizleme
     sırasında data-theme değişmez (çakışma yok). */
  if (!window.__tailrefThemeStudioDraftObserver) {
    window.__tailrefThemeStudioDraftObserver = new MutationObserver(() => {
      themeStudioClearInlinePalette();
    });
    window.__tailrefThemeStudioDraftObserver.observe(
      document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
}
window.settingsThemeStudioSync = settingsThemeStudioSync;
window.settingsThemeStudioBind = settingsThemeStudioBind;
/* Panel ilk açılışta bağla: settingsHubToggle → navInit sonrası. */
document.addEventListener('tailref-settings-opened', () => {
  settingsThemeStudioBind();
  settingsThemeStudioSync();
});
