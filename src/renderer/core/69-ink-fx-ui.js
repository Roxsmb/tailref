/* TailRef app · ink fx panel + dynamic inspector + preset sistemi · Faz 4
   ------------------------------------------------------------------------
   Master spec Bölüm 3/4/5:
   • Tek bağlamsal Effect Properties inspector (20 ayrı pencere DEĞİL) —
     Katmanlar paneli içinde, seçili efektin kendi kontrolleri.
   • Effect Browser: "+ FX" butonu → arama + 3 kategori + GERÇEK önizleme
     küçük görselleri (efekt apply'i örnek rastere uygulanır; stok görsel yok).
   • Preset sistemi: built-in (68-ink-fx-data.js) + kullanıcı presetleri
     (IndexedDB 'meta' / 'ink:fx-presets' — proje bağımsız), Save/Delete/
     Restore Defaults; tam parametre konfigürasyonu saklanır.
   • Performans: parametre dokunuşu inkFxInvalidate YAPMAZ — aşama sig
     önbelleği yalnız değişen aşamayı + alttakileri yeniden hesaplar.
   ========================================================= */
'use strict';

/* =========================================================
   durum + yardımcılar
   ========================================================= */

const inkFxUi = {
  selFxId: null,          // inspector'da açık efekt (stack id)
  browserOpen: false,
  browserBuilt: false,
  custom: new Map(),      // type -> [{ name, params }]
  customLoaded: false,
  thumbs: new Map(),      // type -> canvas (64×48 gerçek önizleme)
  lastPreset: null,       // { id, type, value: 'b:Name' | 'c:Name' } — select işareti (efekt örneğine bağlı)
  revealSel: false,       // seçim/ekleme/sıralama sonrası liste seçili satıra kaysın
  closedGroups: new Set(), // 'type|Grup' — kullanıcı parametre grubunu kapattıysa
};

const INK_FX_UI_CATS = [
  ['printmaking', 'Printmaking'],
  ['traditional', 'Traditional Media'],
  ['experimental', 'Experimental Illustration'],
];

function inkFxUiEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function inkFxUiDef(type) { return INK_FX_EFFECTS.get(type) || null; }

/* Slider sürüklemesi TEK geri-al adımı olmalı. Eskiden 700 ms'lik zaman
   penceresi kullanılıyordu: yavaş bir sürükleme (ör. 3 sn) geri alma
   geçmişine 4-5 kayıt bırakıyor, kullanıcı tek hareketi geri almak için
   Ctrl+Z'ye defalarca basmak zorunda kalıyordu.
   - pointerdown → sürükleme başladı (henüz snapshot yok)
   - ilk input → tek pushUndo
   - change (bırakış) → kilit açılır
   - klavye ile ayarlamada pointer yok: 700 ms pencere tek adım sayılır;
     her yeni input pencereyi tazeler (renk seçici dakikalarca açık kalsa da
     tek seçim = tek Ctrl+Z) */
function inkFxUiArmUndo(target) {
  const armTimer = () => {
    clearTimeout(target.__fxUndoTimer);
    target.__fxUndoTimer = setTimeout(() => { target.__fxUndoArmed = false; }, 700);
  };
  if (target.__fxUndoPending) {
    target.__fxUndoPending = false;
    target.__fxUndoArmed = true;
    if (typeof pushUndo === 'function') pushUndo();
    return;
  }
  if (target.__fxUndoArmed) {
    if (!target.__fxPointerDrag) armTimer();
    return;
  }
  target.__fxUndoArmed = true;
  if (typeof pushUndo === 'function') pushUndo();
  if (!target.__fxPointerDrag) armTimer();
}

function inkFxUiReleaseUndo(target) {
  clearTimeout(target.__fxUndoTimer);
  target.__fxUndoArmed = false;
  target.__fxUndoPending = false;
  target.__fxPointerDrag = false;
}

function inkFxUiDefaults(type) {
  const def = inkFxUiDef(type);
  const out = {};
  if (def) for (const p of def.params) out[p.key] = p.default;
  return out;
}

/** Preset → tam parametre konfigürasyonu (varsayılan + override, kelepçeli). */
function inkFxUiResolvePreset(type, p) {
  const def = inkFxUiDef(type);
  if (!def) return {};
  const out = {};
  for (const param of def.params) {
    out[param.key] = inkFxClampParam(param,
      p && Object.prototype.hasOwnProperty.call(p, param.key) ? p[param.key] : param.default);
  }
  return out;
}

/** `lastPreset` etiketi hâlâ efektin gerçek parametrelerini temsil ediyor mu?
 *  Panel her kurulduğunda doğrulanır; geri-al (Ctrl+Z) parametreleri geri
 *  döndürdüğünde select yanlışlıkla uygulanmış preset adını göstermez. */
function inkFxUiPresetMatches(fx, tag) {
  if (!fx || !tag || typeof tag.value !== 'string' || tag.value.length < 3) return false;
  const kind = tag.value[0];
  const name = tag.value.slice(2);
  const rec = kind === 'b'
    ? (INK_FX_PRESETS[fx.type] || []).find(x => x.name === name)
    : (inkFxUi.custom.get(fx.type) || []).find(x => x.name === name);
  if (!rec) return false;
  const want = inkFxUiResolvePreset(fx.type, rec.p || rec.params || {});
  const def = inkFxUiDef(fx.type);
  if (!def) return false;
  for (const p of def.params) {
    if (String(fx.params[p.key]) !== String(want[p.key])) return false;
  }
  return true;
}

function inkFxUiScopedItem() {
  if (typeof inkScopedImageItem === 'function') {
    try { const it = inkScopedImageItem(); if (it) return it; } catch { /* düş */ }
  }
  for (const id of (typeof selection !== 'undefined' ? selection : [])) {
    const it = typeof getItem === 'function' ? getItem(id) : null;
    if (it && it.kind === 'image') return it;
  }
  return null;
}

/** Ekran + kayıt: aşama sig önbelleği değişen kısmı yeniden hesaplar. */
function inkFxUiTouch(it) {
  if (!it) return;
  if (typeof inkSyncDom === 'function') { try { inkSyncDom(it); } catch { /* sessiz */ } }
  if (typeof inkEditorInvalidate === 'function') {
    try { inkEditorInvalidate(); } catch { /* sessiz */ }
  }
  if (typeof scheduleSave === 'function') { try { scheduleSave(); } catch { /* sessiz */ } }
}

/* =========================================================
   gerçek önizleme küçük görselleri (Bölüm 4: "genuine previews")
   ========================================================= */

function inkFxUiSampleCanvas() {
  const w = 64, h = 48;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { colorSpace: 'srgb' });
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, '#c0392b');
  grd.addColorStop(0.5, '#f1c40f');
  grd.addColorStop(1, '#2c3e50');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.arc(w * 0.72, h * 0.32, 9, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(20,18,16,0.85)';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(w * 0.14, h * 0.82);
  g.quadraticCurveTo(w * 0.42, h * 0.5, w * 0.82, h * 0.78);
  g.stroke();
  return c;
}

/** Efekt apply'i örnek rastere uygulanır — önizleme efektin KENDİ çıktısıdır. */
function inkFxUiThumb(type) {
  let thumb = inkFxUi.thumbs.get(type);
  if (thumb) return thumb;
  const def = inkFxUiDef(type);
  if (!def) return null;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 48;
  const g = c.getContext('2d', { colorSpace: 'srgb' });
  try {
    def.apply(g, inkFxUiSampleCanvas(), inkFxUiDefaults(type), { w: 64, h: 48 }, inkFxRng(0x5eed));
  } catch { /* önizleme hatası → boş bırak, etiket taşır */ }
  inkFxUi.thumbs.set(type, c);
  return c;
}

/* =========================================================
   v5 çizim arayüzü köprüsü
   ---------------------------------------------------------
   Çizim modunda görünen Katmanlar paneli draw-v5.js tarafından
   kurulur. Panel "Layers / FX" sekmeleri taşır; FX görünümü boş bir
   kabuk (#v5FxHost) olarak kurulur ve gerçek FX bölümü buraya
   taşınır. Bölüm düğümü taşınsa da delegasyon dinleyicileri düğüm
   kimliğine bağlı olduğu için çalışmaya devam eder.
   ========================================================= */
function inkFxUiMountV5Layers(host) {
  const section = document.getElementById('inkFxSection');
  const body = host || document.getElementById('v5FxHost');
  if (!section || !body) return false;
  if (section.parentElement !== body) body.appendChild(section);
  section.classList.add('inkFxSection--v5');
  return true;
}

/** FX sekmesine girildiğinde: bölüm açık + tarayıcı görünür. */
function inkFxUiEnterTab() {
  const section = document.getElementById('inkFxSection');
  if (!section) return;
  inkFxUiMountV5Layers();
  section.hidden = !inkFxUiScopedItem();
  section.open = true;
  inkFxUi.browserOpen = true;
  inkFxUi.revealSel = true;
  inkSyncFxPanel();
}

/** Eski paneldeki + FX düğmesi / kısayollar: sekmeyi FX'e çevir. */
function inkFxUiOpenFromV5() {
  const it = inkFxUiScopedItem();
  if (!it) {
    if (typeof window.toast === 'function') {
      window.toast('Select an image to add effects', 2600);
    }
    return;
  }
  if (typeof window.__v5LayersSetTab === 'function') {
    window.__v5LayersSetTab('fx');
  } else {
    inkFxUiEnterTab();
  }
}

window.inkFxUiMountV5Layers = inkFxUiMountV5Layers;
window.inkFxUiEnterTab = inkFxUiEnterTab;
window.inkFxUiOpenFromV5 = inkFxUiOpenFromV5;

/* =========================================================
   panel senkronu
   ========================================================= */

function inkSyncFxPanel() {
  const section = document.getElementById('inkFxSection');
  if (!section) return;
  /* v5 Katmanlar paneli (yeniden) kurulduysa bölümü FX sekmesine taşı. */
  inkFxUiMountV5Layers();
  const it = inkFxUiScopedItem();
  section.hidden = !it;
  /* Görsel seçili değilken FX sekmesinde yönlendirme metni görünür. */
  const emptyHint = document.querySelector('.v5-fx-empty');
  if (emptyHint) emptyHint.hidden = !!it;
  if (!it) { inkFxUi.browserOpen = false; return; }

  inkFxEnsure(it);
  const stack = it.fx.stack;

  const count = document.getElementById('inkFxCount');
  if (count) count.textContent = String(stack.length);

  /* seçili efekt stack'te yoksa seçim düşer */
  if (inkFxUi.selFxId && !stack.some(fx => fx.id === inkFxUi.selFxId)) inkFxUi.selFxId = null;

  const list = document.getElementById('inkFxStack');
  if (list) {
    /* Liste her senkronda baştan kuruluyor; kullanıcının kaydırma konumu
       korunur, ardından seçili satır (özellikle yeni eklenen efekt)
       görünür alana getirilir. Aksi halde 8+ efektde yeni satır listenin
       altında kalıyor ve "efekt eklendi" geri bildirimi kayboluyordu. */
    const keepScroll = list.scrollTop;
    list.replaceChildren();
    if (!stack.length) {
      list.appendChild(inkFxUiEl('div', 'inkLayersEmpty', 'No effects yet — pick one from the browser below.'));
    }
    for (const [idx, fx] of stack.entries()) {
      const def = inkFxUiDef(fx.type);
      const row = inkFxUiEl('div', 'inkLayerRow inkFxRow');
      row.dataset.fx = fx.id;
      row.draggable = true;
      /* Klavye erişimi: satır odaklanabilir, Enter/Space seçer. */
      row.tabIndex = 0;
      row.setAttribute('role', 'listitem');
      row.setAttribute('aria-label', __t('{name} effect', { name: def ? __t(def.label) : fx.type }));
      if (fx.id === inkFxUi.selFxId) row.classList.add('active');

      const eye = inkFxUiEl('button', 'inkLayerBtn' + (fx.visible ? ' on' : ''), '');
      eye.type = 'button';
      eye.dataset.act = 'eye';
      eye.title = __t('Visibility');
      eye.setAttribute('aria-label', __t('Toggle visibility'));
      eye.setAttribute('aria-pressed', fx.visible ? 'true' : 'false');
      eye.textContent = fx.visible ? '●' : '○';
      row.appendChild(eye);

      const up = inkFxUiEl('button', 'inkLayerBtn', '');
      up.type = 'button';
      up.dataset.act = 'up';
      up.title = __t('Move up');
      up.setAttribute('aria-label', __t('Move effect up'));
      up.textContent = '↑';
      /* İlk satırda yukarı, son satırda aşağı hareket edilemez: düğme
         etkin görünüp hiçbir şey yapmıyordu (katman panelindeki gibi
         devre dışı bırakılır). */
      if (idx === 0) { up.disabled = true; up.setAttribute('aria-disabled', 'true'); }
      row.appendChild(up);

      const down = inkFxUiEl('button', 'inkLayerBtn', '');
      down.type = 'button';
      down.dataset.act = 'down';
      down.title = __t('Move down');
      down.setAttribute('aria-label', __t('Move effect down'));
      down.textContent = '↓';
      if (idx === stack.length - 1) { down.disabled = true; down.setAttribute('aria-disabled', 'true'); }
      row.appendChild(down);

      const name = inkFxUiEl('div', 'inkLayerName');
      const b = inkFxUiEl('b', '', def ? def.label : fx.type);
      name.appendChild(b);
      name.appendChild(inkFxUiEl('span', '',
        Math.round((fx.opacity === undefined ? 1 : fx.opacity) * 100) + '% · ' + (fx.blend || 'normal')));
      row.appendChild(name);

      const del = inkFxUiEl('button', 'inkLayerBtn inkLayerDel', '');
      del.type = 'button';
      del.dataset.act = 'del';
      del.title = __t('Remove effect');
      del.setAttribute('aria-label', __t('Remove effect'));
      del.textContent = '×';
      row.appendChild(del);

      list.appendChild(row);
    }
    list.scrollTop = keepScroll;
    const activeRow = list.querySelector('.inkFxRow.active');
    if (activeRow && inkFxUi.revealSel) {
      inkFxUi.revealSel = false;
      requestAnimationFrame(() => {
        if (!activeRow.isConnected) return;
        const listRect = list.getBoundingClientRect();
        if (listRect.height <= 0) return;
        const rowRect = activeRow.getBoundingClientRect();
        if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
        else if (rowRect.top < listRect.top) list.scrollTop -= listRect.top - rowRect.top;
      });
    }
  }

  const browser = document.getElementById('inkFxBrowser');
  if (browser) browser.hidden = !inkFxUi.browserOpen;

  inkFxUiRenderInspector(it);
  inkFxUiRenderBrowser();
}

/* =========================================================
   inspector (Bölüm 3: tek bağlamsal properties panel)
   ========================================================= */

function inkFxUiRenderInspector(it) {
  const box = document.getElementById('inkFxInspector');
  if (!box) return;
  box.replaceChildren();
  if (!it) return;
  const stack = it.fx.stack;
  if (!stack.length) {
    box.appendChild(inkFxUiEl('div', 'inkHint', 'Pick an effect from the browser below to add it to this image.'));
    return;
  }
  const fx = stack.find(f => f.id === inkFxUi.selFxId);
  if (!fx) {
    box.appendChild(inkFxUiEl('div', 'inkHint', 'Select an effect row to edit its parameters.'));
    return;
  }
  const def = inkFxUiDef(fx.type);
  if (!def) return;

  /* --- başlık + paylaşılan kontroller (opacity/blend/visible/reset) --- */
  const head = inkFxUiEl('div', 'inkFxHead');
  head.appendChild(inkFxUiEl('b', 'inkFxTitle', def.label));

  const opRow = inkFxUiEl('div', 'inkSliderRow');
  const opLabel = inkFxUiEl('label', '', 'Opacity');
  opLabel.htmlFor = 'inkFxOpacity';
  const opRange = inkFxUiEl('input', '');
  opRange.id = 'inkFxOpacity';
  opRange.type = 'range';
  opRange.min = '0'; opRange.max = '100'; opRange.step = '1';
  opRange.value = String(Math.round((fx.opacity === undefined ? 1 : fx.opacity) * 100));
  opRange.dataset.role = 'fx-opacity';
  const opOut = inkFxUiEl('output', 'inkFxOpOut', opRange.value + '%');
  /* Geri-al adımı section'daki pointerdown/ilk-input mekanizmasından gelir;
     burada ayrıca pushUndo çağırmak tek sürüklemeye İKİ kayıt bırakıyordu
     (biri boşa giden "ölü" Ctrl+Z). */
  opRow.append(opLabel, opRange, opOut);
  head.appendChild(opRow);

  const blendRow = inkFxUiEl('div', 'inkSelectRow');
  const blendLabel = inkFxUiEl('label', '', 'Blend');
  blendLabel.htmlFor = 'inkFxBlend';
  const blendSel = inkFxUiEl('select', '');
  blendSel.id = 'inkFxBlend';
  blendSel.dataset.role = 'fx-blend';
  for (const mode of (typeof INK_BLEND_MODES !== 'undefined' ? INK_BLEND_MODES : ['normal'])) {
    const opt = document.createElement('option');
    opt.value = mode;
    opt.textContent = mode;
    if ((fx.blend || 'normal') === mode) opt.selected = true;
    blendSel.appendChild(opt);
  }
  blendRow.append(blendLabel, blendSel);
  head.appendChild(blendRow);

  const visCheck = inkFxUiEl('label', 'inkCheck');
  const visInput = inkFxUiEl('input', '');
  visInput.type = 'checkbox';
  visInput.checked = fx.visible !== false;
  visInput.dataset.role = 'fx-visible';
  visCheck.append(visInput, inkFxUiEl('span', '', 'Enabled / Visible'));
  head.appendChild(visCheck);

  const btnRow = inkFxUiEl('div', 'inkFxBtnRow');
  const reset = inkFxUiEl('button', 'inkFxBtn', 'Reset Parameters');
  reset.type = 'button'; reset.dataset.act = 'reset';
  const resetAll = inkFxUiEl('button', 'inkFxBtn', 'Reset All');
  resetAll.type = 'button'; resetAll.dataset.act = 'reset-all';
  btnRow.append(reset, resetAll);
  head.appendChild(btnRow);
  box.appendChild(head);

  /* --- preset satırı (Bölüm 5) --- */
  const presetRow = inkFxUiEl('div', 'inkFxPresetRow');
  const presetSel = inkFxUiEl('select', '');
  presetSel.dataset.role = 'fx-preset';
  presetSel.value = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = __t('Preset…');
  presetSel.appendChild(ph);
  const builtGroup = document.createElement('optgroup');
  builtGroup.label = __t('Built-in');
  for (const pr of (INK_FX_PRESETS[fx.type] || [])) {
    const opt = document.createElement('option');
    opt.value = 'b:' + pr.name;
    opt.textContent = pr.name;
    builtGroup.appendChild(opt);
  }
  if (builtGroup.children.length) presetSel.appendChild(builtGroup);
  const customs = inkFxUi.custom.get(fx.type) || [];
  if (customs.length) {
    const cg = document.createElement('optgroup');
    cg.label = 'Custom';
    for (const pr of customs) {
      const opt = document.createElement('option');
      opt.value = 'c:' + pr.name;
      opt.textContent = pr.name;
      cg.appendChild(opt);
    }
    presetSel.appendChild(cg);
  }
  /* Son uygulanan preset selectte işaretlenir — yalnız parametreler hâlâ
     o preset'e uyuyorsa. Geri-al (Ctrl+Z) parametreleri eski değere
     döndürdüğünde etiket "uygulanmış" görünmeye devam ediyordu. */
  const lastTag = inkFxUi.lastPreset;
  if (lastTag && lastTag.id === fx.id && lastTag.type === fx.type
    && inkFxUiPresetMatches(fx, lastTag)) {
    presetSel.value = lastTag.value;
    if (presetSel.value !== lastTag.value) presetSel.value = '';
  } else if (lastTag && lastTag.id === fx.id) {
    inkFxUi.lastPreset = null;
  }
  presetRow.appendChild(presetSel);
  const presetName = inkFxUiEl('input', 'inkFxPresetName');
  presetName.type = 'text';
  presetName.placeholder = __t('Preset name');
  presetName.setAttribute('aria-label', __t('Preset name'));
  presetName.dataset.role = 'fx-preset-name';
  presetRow.appendChild(presetName);
  const saveBtn = inkFxUiEl('button', 'inkFxBtn', 'Save');
  saveBtn.type = 'button'; saveBtn.dataset.act = 'preset-save';
  const delBtn = inkFxUiEl('button', 'inkFxBtn', 'Delete');
  delBtn.type = 'button'; delBtn.dataset.act = 'preset-delete';
  /* Yalnız SEÇİLİ bir kullanıcı preseti silinebilir. Eskiden kullanıcı
     preseti varsa düğme her zaman etkindi: yerleşik bir preset seçiliyken
     "Delete"e basmak sessizce hiçbir şey yapmıyordu. */
  delBtn.disabled = !(presetSel.value || '').startsWith('c:');
  delBtn.title = 'Delete custom preset';
  delBtn.setAttribute('aria-label', 'Delete custom preset');
  presetRow.append(saveBtn, delBtn);
  box.appendChild(presetRow);

  /* --- parametre bölümleri (collapsible sections) --- */
  const groups = (typeof INK_FX_GROUPS !== 'undefined' && INK_FX_GROUPS[fx.type]) || null;
  const done = new Set();
  const sections = groups
    ? groups.map(([label, ...keys]) => ({
      label,
      params: keys.map(k => def.params.find(p => p.key === k)).filter(Boolean),
    }))
    : [{ label: 'Parameters', params: def.params }];
  const seenKeys = new Set(sections.flatMap(s => s.params.map(p => p.key)));
  const rest = def.params.filter(p => !seenKeys.has(p.key));
  if (rest.length) sections.push({ label: 'Other', params: rest });

  for (const sec of sections) {
    if (!sec.params.length) continue;
    const det = inkFxUiEl('details', 'inkFxGroup');
    /* Kullanıcı grubu kapattıysa panel yeniden kurulduğunda (göz/↑/↓,
       ekleme, undo…) tüm gruplar yeniden açılıp düzeni bozuyordu. */
    const groupKey = fx.type + '|' + sec.label;
    det.dataset.group = sec.label;
    det.open = !inkFxUi.closedGroups.has(groupKey);
    det.appendChild(inkFxUiEl('summary', '', sec.label));
    det.addEventListener('toggle', () => {
      if (det.open) inkFxUi.closedGroups.delete(groupKey);
      else inkFxUi.closedGroups.add(groupKey);
    });
    for (const p of sec.params) {
      if (done.has(p.key)) continue;
      done.add(p.key);
      det.appendChild(inkFxUiParamRow(fx, p, sec.label));
    }
    box.appendChild(det);
  }
  /* başlangıç görünürlüğü: `when` koşulu sağlanmayan satırlar gizli doğar,
     böylece denetleyici değişince tam yeniden kurulum gerekmez */
  inkFxUiRefreshVisibility(fx);
}

/** Parametre etiketi: grup başlığıyla aynı öneki at (PIGMENT grubunda
    "Pigment Diffusion" → "Diffusion"). 64 px'lik etiket kolonunda beş
    satırın hepsi "Pigment D..." görünüyordu; hangisi olduğu anlaşılmıyordu. */
function inkFxParamShortLabel(label, groupLabel) {
  const text = String(label || '');
  const group = String(groupLabel || '').trim();
  if (!group || group === 'Parameters' || group === 'Other') return text;
  const lowText = text.toLowerCase();
  const lowGroup = group.toLowerCase();
  if (lowText.startsWith(lowGroup) && text.length > group.length + 2) {
    const rest = text.slice(group.length).replace(/^[\s\-–—]+/, '').trim();
    if (rest.length >= 3) return rest;
  }
  return text;
}

function inkFxUiParamRow(fx, p, groupLabel) {
  const val = fx.params[p.key];
  const shortLabel = inkFxParamShortLabel(p.label, groupLabel);
  if (p.type === 'slider' || p.type === 'angle') {
    const row = inkFxUiEl('div', 'inkSliderRow');
    const label = inkFxUiEl('label', '', shortLabel);
    label.title = p.label;
    label.htmlFor = 'inkFxP-' + p.key;
    const range = inkFxUiEl('input', '');
    range.id = 'inkFxP-' + p.key;
    range.type = 'range';
    range.min = String(p.min); range.max = String(p.max); range.step = String(p.step);
    range.value = String(val);
    range.dataset.param = p.key;
    const num = inkFxUiEl('input', 'inkFxNum');
    num.type = 'number';
    num.min = String(p.min); num.max = String(p.max); num.step = String(p.step);
    num.value = String(val);
    num.dataset.param = p.key;
    num.dataset.partner = 'range';
    /* Görünür etiket yalnız range'e bağlı; sayı kutusunun erişilebilir
       adı yoktu (ekran okuyucu "spin button" diyordu). */
    num.setAttribute('aria-label', p.label);
    range.dataset.partner = 'num';
    row.dataset.paramRow = p.key;
    row.append(label, range, num);
    return row;
  }
  if (p.type === 'dropdown') {
    const row = inkFxUiEl('div', 'inkSelectRow');
    const label = inkFxUiEl('label', '', shortLabel);
    label.title = p.label;
    label.htmlFor = 'inkFxP-' + p.key;
    const sel = inkFxUiEl('select', '');
    sel.id = 'inkFxP-' + p.key;
    sel.dataset.param = p.key;
    for (const opt of p.options) {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt;
      if (val === opt) o.selected = true;
      sel.appendChild(o);
    }
    row.dataset.paramRow = p.key;
    row.append(label, sel);
    return row;
  }
  if (p.type === 'toggle') {
    const check = inkFxUiEl('label', 'inkCheck');
    const input = inkFxUiEl('input', '');
    input.type = 'checkbox';
    input.checked = !!val;
    input.dataset.param = p.key;
    check.dataset.paramRow = p.key;
    check.append(input, inkFxUiEl('span', '', p.label));
    return check;
  }
  if (p.type === 'color') {
    const row = inkFxUiEl('div', 'inkSelectRow inkFxColorRow');
    const label = inkFxUiEl('label', '', shortLabel);
    label.title = p.label;
    label.htmlFor = 'inkFxP-' + p.key;
    const isNone = val === 'none';
    const color = inkFxUiEl('input', 'inkFxColor');
    color.id = 'inkFxP-' + p.key;
    color.type = 'color';
    color.value = isNone ? (typeof p.default === 'string' && p.default.startsWith('#') ? p.default : '#ffffff') : val;
    color.dataset.param = p.key;
    color.disabled = isNone;
    row.dataset.paramRow = p.key;
    row.append(label, color);
    if (p.default === 'none') {
      const none = inkFxUiEl('label', 'inkCheck inkFxNone');
      const nc = inkFxUiEl('input', '');
      nc.type = 'checkbox';
      nc.checked = isNone;
      nc.dataset.paramNone = p.key;
      none.append(nc, inkFxUiEl('span', '', 'Transparent'));
      row.appendChild(none);
    }
    return row;
  }
  return inkFxUiEl('div', 'inkHint', p.label);
}

/** Controller (dropdown/toggle/slider) değişince `when` bağımlı satırları
 *  tam yeniden kurmadan göster/gizle — slider sürüklemesi kesilmez. */
function inkFxUiRefreshVisibility(fx) {
  const def = inkFxUiDef(fx.type);
  if (!def || !fx) return;
  const box = document.getElementById('inkFxInspector');
  if (!box) return;
  const rows = box.querySelectorAll('[data-param-row]');
  for (const row of rows) {
    const p = def.params.find(x => x.key === row.dataset.paramRow);
    if (p) row.hidden = !inkFxParamVisible(p, fx.params);
  }
  for (const det of box.querySelectorAll('details.inkFxGroup')) {
    const inner = [...det.querySelectorAll('[data-param-row]')];
    if (inner.length) det.hidden = inner.every(r => r.hidden);
  }
}

/* =========================================================
   effect browser (Bölüm 4)
   ========================================================= */

function inkFxUiRenderBrowser() {
  const grid = document.getElementById('inkFxGrid');
  if (!grid) return;
  if (!inkFxUi.browserOpen) return;
  if (!inkFxUi.browserBuilt) {
    grid.replaceChildren();
    for (const [cat, label] of INK_FX_UI_CATS) {
      const defs = [...INK_FX_EFFECTS.values()].filter(d => d.category === cat);
      if (!defs.length) continue;
      const head = inkFxUiEl('div', 'inkFxGridHead', label);
      head.dataset.cat = cat;
      grid.appendChild(head);
      const cells = inkFxUiEl('div', 'inkFxGridCells');
      for (const def of defs) {
        const cell = inkFxUiEl('button', 'inkFxCell');
        cell.type = 'button';
        cell.dataset.type = def.id;
        cell.title = def.label;
        const thumbSrc = inkFxUiThumb(def.id);
        if (thumbSrc) {
          const thumb = document.createElement('canvas');
          thumb.width = thumbSrc.width; thumb.height = thumbSrc.height;
          thumb.className = 'inkFxThumb';
          const tg = thumb.getContext('2d', { colorSpace: 'srgb' });
          /* kâğıt altlığı: şeffaf zeminli efektler (woodcut/contour) okunur kalır */
          tg.fillStyle = '#f6f3ea';
          tg.fillRect(0, 0, thumb.width, thumb.height);
          tg.drawImage(thumbSrc, 0, 0);
          cell.appendChild(thumb);
        }
        cell.appendChild(inkFxUiEl('span', '', def.label));
        cells.appendChild(cell);
      }
      grid.appendChild(cells);
    }
    inkFxUi.browserBuilt = true;
  }
  inkFxUiFilterBrowser();
}

function inkFxUiFilterBrowser() {
  const search = document.getElementById('inkFxSearch');
  const grid = document.getElementById('inkFxGrid');
  if (!grid) return;
  const q = (search && search.value ? search.value : '').trim().toLowerCase();
  const heads = grid.querySelectorAll('.inkFxGridHead');
  const cellWraps = grid.querySelectorAll('.inkFxGridCells');
  let totalVisible = 0;
  for (let i = 0; i < heads.length && i < cellWraps.length; i++) {
    let visible = 0;
    for (const cell of cellWraps[i].children) {
      const label = cell.textContent || '';
      const show = !q || label.toLowerCase().includes(q);
      cell.hidden = !show;
      if (show) visible++;
    }
    heads[i].hidden = !visible;
    cellWraps[i].hidden = !visible;
    totalVisible += visible;
  }
  /* Arama hiçbir efekte uymadığında boş ızgara yerine açıklama göster. */
  let empty = grid.querySelector('.inkFxGridEmpty');
  if (!empty) {
    empty = inkFxUiEl('div', 'inkFxGridEmpty', 'No effects match this search.');
    grid.appendChild(empty);
  }
  empty.hidden = totalVisible > 0;
}

/** Efekt eklendikten sonra parametre inspector'ının başını görünür alana
    getir; ama sekmeleri/efekt listesini ekrandan kaçırma. Eskiden tam
    kaydırma yapılıyordu: 425 px'lik panelde "Layers | FX" sekmeleri ve
    efekt satırları tamamen yukarıda kalıyordu. */
function inkFxUiRevealInspector() {
  const insp = document.getElementById('inkFxInspector');
  if (!insp) return;
  const box = insp.closest('.v5-layers-body');
  if (!box) return;
  requestAnimationFrame(() => {
    const ir = insp.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    /* Başlık + ilk kontroller zaten görünüyorsa hiç kaydırma. */
    if (ir.top >= br.top && ir.top < br.bottom - 60) return;
    const tabs = box.querySelector('.v5-layer-tabs');
    const keep = tabs
      ? Math.max(0, tabs.getBoundingClientRect().bottom - br.top + 6)
      : 0;
    /* Kaydırma en fazla sekmeleri görünür tutacak kadar. */
    const maxScroll = box.scrollTop + keep;
    const want = box.scrollTop + (ir.top - br.top) - 8;
    box.scrollTop = Math.max(box.scrollTop, Math.min(want, maxScroll));
  });
}

/* =========================================================
   eylemler
   ========================================================= */

function inkFxUiAdd(type) {
  const it = inkFxUiScopedItem();
  const def = inkFxUiDef(type);
  if (!it || !def) return;
  if (typeof pushUndo === 'function') pushUndo();
  inkFxEnsure(it);
  const fx = {
    id: inkFxNewId(),
    type,
    params: inkFxUiDefaults(type),
    opacity: 1,
    visible: true,
    blend: 'normal',
    seed: (Math.random() * 0xffffffff) | 0,
  };
  it.fx.stack.push(fx);
  inkFxUi.selFxId = fx.id;
  inkFxUi.revealSel = true;
  inkFxChanged(it);
  inkSyncFxPanel();
  inkFxUiRevealInspector();
}

function inkFxUiRemove(it, fx) {
  if (typeof pushUndo === 'function') pushUndo();
  const i = it.fx.stack.indexOf(fx);
  if (i >= 0) it.fx.stack.splice(i, 1);
  if (inkFxUi.selFxId === fx.id) inkFxUi.selFxId = null;
  inkFxChanged(it);
  inkSyncFxPanel();
}

function inkFxUiMove(it, fx, dir) {
  const stack = it.fx.stack;
  const i = stack.indexOf(fx);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= stack.length) return;
  if (typeof pushUndo === 'function') pushUndo();
  stack.splice(j, 0, stack.splice(i, 1)[0]);
  inkFxUi.revealSel = true;
  inkFxChanged(it);
  inkSyncFxPanel();
}

/** Sürükle-bırak: efekti hedef satırın önüne (index) taşır.
 *  Hedef index çıkarılan öğeden sonraysa bir kaydırılır — sonuç her zaman
 *  "bırakılan yerdeki nihai sıra" olur (↑/↓ ile aynı veri modeli). */
function inkFxUiMoveTo(it, fx, index) {
  const stack = it.fx.stack;
  const from = stack.indexOf(fx);
  if (from < 0) return false;
  let to = Math.max(0, Math.min(stack.length, index));
  if (from < to) to -= 1;
  if (to === from) return false;
  if (typeof pushUndo === 'function') pushUndo();
  stack.splice(to, 0, stack.splice(from, 1)[0]);
  inkFxUi.revealSel = true;
  inkFxChanged(it);
  inkSyncFxPanel();
  return true;
}

function inkFxUiSetParam(it, fx, key, value) {
  const def = inkFxUiDef(fx.type);
  const p = def ? def.params.find(x => x.key === key) : null;
  if (!p) return;
  fx.params[key] = inkFxClampParam(p, value);
  /* Parametre elle değişti: "uygulanmış preset" işareti artık doğru değil
     (select hâlâ preset adını gösteriyordu). Panelin tamamını yeniden
     kurmuyoruz — slider sürüklemesi kesilmesin; yalnız etiket sıfırlanır. */
  inkFxUiClearPresetTag(fx.id);
  inkFxUiTouch(it); /* invalidate YOK — sig önbelleği yetenekli */
}

/** Efektin parametreleri preset'ten saptığında select etiketini temizler. */
function inkFxUiClearPresetTag(fxId) {
  if (!inkFxUi.lastPreset || inkFxUi.lastPreset.id !== fxId) return;
  inkFxUi.lastPreset = null;
  const presetSel = document.querySelector('[data-role="fx-preset"]');
  if (presetSel && presetSel.value) presetSel.value = '';
}

function inkFxUiApplyPreset(it, fx, preset, tagValue) {
  if (typeof pushUndo === 'function') pushUndo();
  fx.params = inkFxUiResolvePreset(fx.type, preset.p);
  inkFxUi.lastPreset = { id: fx.id, type: fx.type, value: tagValue || ('b:' + preset.name) };
  inkFxChanged(it);
  inkSyncFxPanel();
}

/* --- kullanıcı presetleri: IndexedDB 'meta' / 'ink:fx-presets' --- */

const INK_FX_PRESET_DB_KEY = 'ink:fx-presets';

function inkFxUiPersistCustom() {
  const obj = {};
  for (const [type, list] of inkFxUi.custom) obj[type] = list;
  try { idbPut('meta', INK_FX_PRESET_DB_KEY, obj).catch(() => {}); } catch { /* sessiz */ }
}

async function inkFxUiLoadCustom() {
  if (inkFxUi.customLoaded) return;
  inkFxUi.customLoaded = true;
  let obj = null;
  try { obj = await idbGet('meta', INK_FX_PRESET_DB_KEY); } catch { return; }
  if (obj && typeof obj === 'object') {
    for (const [type, list] of Object.entries(obj)) {
      if (Array.isArray(list)) {
        inkFxUi.custom.set(type, list.filter(pr => pr && typeof pr.name === 'string'
          && pr.params && typeof pr.params === 'object'));
      }
    }
  }
  const it = inkFxUiScopedItem();
  if (it) inkSyncFxPanel();
}

function inkFxUiSaveCustom(it, fx, name) {
  const clean = String(name || '').trim() || ('Preset ' + ((inkFxUi.custom.get(fx.type) || []).length + 1));
  const list = inkFxUi.custom.get(fx.type) || [];
  const existing = list.findIndex(pr => pr.name === clean);
  const record = { name: clean, params: { ...fx.params } };
  if (existing >= 0) list[existing] = record; else list.push(record);
  inkFxUi.custom.set(fx.type, list);
  inkFxUiPersistCustom();
  inkFxUi.lastPreset = { id: fx.id, type: fx.type, value: 'c:' + clean };
  inkSyncFxPanel();
}

function inkFxUiDeleteCustom(it, fx, name) {
  const list = inkFxUi.custom.get(fx.type) || [];
  const i = list.findIndex(pr => pr.name === name);
  if (i < 0) return;
  list.splice(i, 1);
  if (list.length) inkFxUi.custom.set(fx.type, list);
  else inkFxUi.custom.delete(fx.type);
  inkFxUiPersistCustom();
  inkSyncFxPanel();
}

/* =========================================================
   olay delegasyonu + kurulum
   ========================================================= */

function inkFxUiBind() {
  const section = document.getElementById('inkFxSection');
  if (!section) return;

  /* Satır işleminden sonra panel yeniden kurulur (düğüm değişir) → klavye
     odağı gövdeye düşüp sekme baştan başlıyordu; aynı düğmeye geri ver. */
  const fxRefocusRow = (fxId, act) => {
    requestAnimationFrame(() => {
      const row = document.querySelector('#inkFxStack .inkFxRow[data-fx="' + fxId + '"]');
      const btn = row ? row.querySelector('[data-act="' + act + '"]') : null;
      /* Sıra ucuna taşınan efektin ↑/↓ düğmesi artık devre dışı: odak
         satırın kendisine verilir (aksi halde odak gövdeye düşüyordu). */
      if (btn && !btn.disabled) { btn.focus({ preventScroll: true }); return; }
      if (row) row.focus({ preventScroll: true });
    });
  };

  /* + FX aksiyon butonu: Katmanlar paneli aksiyon şeridinden tarayıcıyı açar */
  const addBtn = document.getElementById('btnInkAddFx');
  if (addBtn) {
    addBtn.addEventListener('click', e => {
      e.preventDefault();
      const itNow = inkFxUiScopedItem();
      if (!itNow) { addBtn.title = __t('Select an image first'); return; }
      section.hidden = false;
      section.open = true;
      inkFxUi.browserOpen = !inkFxUi.browserOpen;
      inkSyncFxPanel();
      if (inkFxUi.browserOpen) {
        const search = document.getElementById('inkFxSearch');
        if (search) search.focus({ preventScroll: true });
      }
    });
  }

  const search = document.getElementById('inkFxSearch');
  if (search) search.addEventListener('input', () => inkFxUiFilterBrowser());

  /* Sürükleme geri-al adımı: basışta işaretle, ilk input'ta tek snapshot. */
  section.addEventListener('pointerdown', e => {
    const t = e.target;
    if (!(t instanceof Element) || t.type !== 'range') return;
    if (!t.dataset.param && t.dataset.role !== 'fx-opacity') return;
    t.__fxPointerDrag = true;
    t.__fxUndoPending = true;
  });

  /* --- section delegasyonu: tıklama --- */
  section.addEventListener('click', e => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const actEl = target.closest('[data-act]');
    const it = inkFxUiScopedItem();
    if (!it) return;

    if (actEl) {
      const act = actEl.dataset.act;
      const stack = it.fx.stack;
      const row = actEl.closest('.inkFxRow');
      const fx = row ? stack.find(f => f.id === row.dataset.fx) : null;
      if (act === 'eye' && fx) {
        if (typeof pushUndo === 'function') pushUndo();
        fx.visible = fx.visible === false;
        inkFxChanged(it);
        inkSyncFxPanel();
        fxRefocusRow(fx.id, 'eye');
        return;
      }
      if (act === 'up' && fx) { inkFxUiMove(it, fx, -1); fxRefocusRow(fx.id, 'up'); return; }
      if (act === 'down' && fx) { inkFxUiMove(it, fx, 1); fxRefocusRow(fx.id, 'down'); return; }
      if (act === 'del' && fx) {
        /* Gerçek çift tıklamanın ikinci tıkı (detail > 1), satırlar yukarı
           kaydığı için bir SONRAKİ efektin × düğmesine denk geliyordu →
           tek niyetle iki efekt siliniyordu. İkinci tık yok sayılır. */
        if (e.detail > 1) return;
        /* Panel yeniden kurulunca düğüm yok olur → klavye odağı gövdeye
           düşüyordu (Tab baştan başlıyordu). Aynı konumdaki satırın silme
           düğmesine, liste boşaldıysa FX sekmesine odaklan. */
        const idx = stack.indexOf(fx);
        inkFxUiRemove(it, fx);
        requestAnimationFrame(() => {
          const rows = [...document.querySelectorAll('#inkFxStack .inkFxRow')];
          if (rows.length) {
            const row = rows[Math.min(idx, rows.length - 1)];
            const btn = row.querySelector('[data-act="del"]') || row;
            btn.focus({ preventScroll: true });
          } else {
            const tab = document.querySelector('#v5RightDock .v5-layer-tab[data-tab="fx"]');
            if (tab) tab.focus({ preventScroll: true });
          }
        });
        return;
      }
      if (act === 'reset' || act === 'reset-all') {
        const fxSel = stack.find(f => f.id === inkFxUi.selFxId);
        if (!fxSel) return;
        if (typeof pushUndo === 'function') pushUndo();
        const targets = act === 'reset-all' ? stack : [fxSel];
        for (const t of targets) {
          t.params = inkFxUiDefaults(t.type);
          /* Varsayılana dönen efekt artık uygulanmış preset'i temsil etmez. */
          if (inkFxUi.lastPreset && inkFxUi.lastPreset.id === t.id) inkFxUi.lastPreset = null;
        }
        inkFxChanged(it);
        inkSyncFxPanel();
        return;
      }
      if (act === 'preset-save') {
        const fxSel = stack.find(f => f.id === inkFxUi.selFxId);
        if (!fxSel) return;
        const nameInput = section.querySelector('[data-role="fx-preset-name"]');
        inkFxUiSaveCustom(it, fxSel, nameInput ? nameInput.value : '');
        return;
      }
      if (act === 'preset-delete') {
        const fxSel = stack.find(f => f.id === inkFxUi.selFxId);
        const sel = section.querySelector('[data-role="fx-preset"]');
        if (!fxSel || !sel) return;
        if (sel.value.startsWith('c:')) inkFxUiDeleteCustom(it, fxSel, sel.value.slice(2));
        return;
      }
      return;
    }

    const cell = target.closest('.inkFxCell');
    if (cell) {
      /* Gerçek çift tıklamanın ikinci tıkı (detail > 1) efekti İKİ kez
         ekliyordu: 4K'da her ekleme ~1 s blokladığı için kullanıcı iki kez
         bekliyor, aynı efekt iki kez yığılıyordu. İkinci tık yok sayılır
         (silme düğmesindeki korumanın aynısı). */
      if (e.detail > 1) return;
      inkFxUiAdd(cell.dataset.type);
      return;
    }

    const rowEl = target.closest('.inkFxRow');
    if (rowEl && it.fx.stack.some(f => f.id === rowEl.dataset.fx)) {
      /* Gerçek çift tıklamanın ikinci tıkı satırı hemen geri kapatıyordu
         (seç → aynı anda kaldır). İkinci tık yok sayılır; bilinçli ikinci
         tek tıklama seçimi kaldırmaya devam eder. */
      if (e.detail > 1) return;
      /* Seçili satıra tekrar tıklamak seçimi kaldırır: inspector kapanır,
         satır vurgusu gider. Eskiden ikinci tıklama hiçbir şey yapmıyordu;
         kullanıcı parametre panelinden çıkmak için başka efekt seçmek
         zorundaydı. */
      if (inkFxUi.selFxId === rowEl.dataset.fx) {
        inkFxUi.selFxId = null;
        inkFxUi.revealSel = false;
        inkSyncFxPanel();
        /* Panel yeniden kuruldu (satır düğümü değişti) → klavye odağı
           gövdeye düşmesin; aynı satır odaklı kalsın. */
        const keepId = rowEl.dataset.fx;
        requestAnimationFrame(() => {
          const again = document.querySelector('#inkFxStack .inkFxRow[data-fx="' + keepId + '"]');
          if (again) again.focus({ preventScroll: true });
        });
        return;
      }
      inkFxUi.selFxId = rowEl.dataset.fx;
      inkFxUi.revealSel = true;
      inkSyncFxPanel();
      /* Seçilen efektin parametreleri panelin altında kalmasın; sekmeler
         görünür kalacak kadar kaydır. */
      inkFxUiRevealInspector();
    }
  });

  /* --- section delegasyonu: klavye (satır seçimi) ---
     Satırlar div; yalnız fareyle seçilebiliyordu → klavye kullanıcısı
     efekt parametrelerini hiç düzenleyemiyordu. Satır Tab ile odaklanır,
     Enter seçer; panel yeniden kurulduğu için odak yeni satıra taşınır.
     (Space bilinçli olarak kullanılmaz: çizim editöründe Space geçici
     kaydırma tuşu, odaklı öğeyi blur edip olayı yakalıyor.) */
  section.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const target = e.target;
    if (!(target instanceof Element) || !target.classList.contains('inkFxRow')) return;
    const it = inkFxUiScopedItem();
    if (!it || !it.fx.stack.some(f => f.id === target.dataset.fx)) return;
    e.preventDefault();
    /* Enter de tıklama gibi aç/kapa: seçili satırda Enter seçimi kaldırır. */
    if (inkFxUi.selFxId === target.dataset.fx) {
      inkFxUi.selFxId = null;
      inkFxUi.revealSel = false;
      inkSyncFxPanel();
      requestAnimationFrame(() => {
        const again = document.querySelector('#inkFxStack .inkFxRow[data-fx="' + target.dataset.fx + '"]');
        if (again) again.focus({ preventScroll: true });
      });
      return;
    }
    inkFxUi.selFxId = target.dataset.fx;
    inkFxUi.revealSel = true;
    inkSyncFxPanel();
    inkFxUiRevealInspector();
    requestAnimationFrame(() => {
      const active = document.querySelector('#inkFxStack .inkFxRow.active');
      if (active) active.focus({ preventScroll: true });
    });
  });

  /* --- section delegasyonu: input (range/number/color/arama) --- */
  section.addEventListener('input', e => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const it = inkFxUiScopedItem();
    if (!it) return;
    const stack = it.fx.stack;

    if (target.dataset.paramNone) {
      /* 'none' izinli renk paramı: kutu işaretliyse değer 'none' */
      const fx = stack.find(f => f.id === inkFxUi.selFxId);
      if (!fx) return;
      const key = target.dataset.paramNone;
      if (target.checked) {
        if (typeof pushUndo === 'function') pushUndo();
        inkFxUiSetParam(it, fx, key, 'none');
        const color = section.querySelector('[data-param="' + key + '"]');
        if (color) color.disabled = true;
      } else {
        const color = section.querySelector('[data-param="' + key + '"]');
        if (color) {
          color.disabled = false;
          if (typeof pushUndo === 'function') pushUndo();
          inkFxUiSetParam(it, fx, key, color.value);
        }
      }
      return;
    }

    const key = target.dataset.param;
    if (key) {
      /* number girdisi kısmi yazım durumlarını bozar — commit 'change'de */
      if (target.type === 'number') return;
      const fx = stack.find(f => f.id === inkFxUi.selFxId);
      if (!fx) return;
      const p = (inkFxUiDef(fx.type) || { params: [] }).params.find(x => x.key === key);
      if (!p) return;
      let value;
      if (p.type === 'toggle') value = target.checked;
      else value = target.value;
      /* range ↔ number eşzamanlama (hedefin partneri diğer kontroldür) */
      const partnerSel = target.dataset.partner === 'num'
        ? 'input.inkFxNum[data-param="' + key + '"]'
        : 'input[type="range"][data-param="' + key + '"]';
      const partner = section.querySelector(partnerSel);
      if (partner && partner !== target) partner.value = target.value;
      /* slider sürüklemede pushUndo yalnız ilk input'ta (tek geri-al adımı).
         Renk seçicide de canlı `input` akışı var: her olay kayıt bırakmasın. */
      if (p.type === 'slider' || p.type === 'angle' || p.type === 'color') {
        inkFxUiArmUndo(target);
      } else if (typeof pushUndo === 'function') {
        pushUndo();
      }
      if (target.type === 'range' && typeof inkFxPreviewBegin === 'function'
        && (p.type === 'slider' || p.type === 'angle')) {
        inkFxPreviewBegin(it.id);
      }
      inkFxUiSetParam(it, fx, key, value);
      if (typeof inkFxParamIsController === 'function'
        && inkFxParamIsController(fx.type, key)) inkFxUiRefreshVisibility(fx);
      return;
    }

    if (target.dataset.role === 'fx-opacity') {
      const fx = stack.find(f => f.id === inkFxUi.selFxId);
      if (!fx) return;
      inkFxUiArmUndo(target);
      /* Tam çözünürlüklü zincir input başına pahalı (watercolor 4K'da
         saniyeler); sürükleme boyunca düşük çözünürlük önizlemesi. */
      if (typeof inkFxPreviewBegin === 'function') inkFxPreviewBegin(it.id);
      fx.opacity = Math.min(1, Math.max(0, Number(target.value) / 100));
      const out = target.parentElement.querySelector('output');
      if (out) out.textContent = target.value + '%';
      inkFxUiTouch(it);
      const rowEl = section.querySelector('.inkFxRow[data-fx="' + fx.id + '"] span');
      if (rowEl) rowEl.textContent = target.value + '% · ' + (fx.blend || 'normal');
      return;
    }
  });

  /* --- section delegasyonu: change (select/checkbox commit) --- */
  section.addEventListener('change', e => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const it = inkFxUiScopedItem();
    if (!it) return;
    const stack = it.fx.stack;

    /* slider bırakıldı: önizleme biter, tam çözünürlük hemen hesaplanır */
    if (target.dataset.param && target.type === 'range') {
      inkFxUiReleaseUndo(target);
      if (typeof inkFxPreviewEnd === 'function') inkFxPreviewEnd(it.id);
      inkFxUiTouch(it);
      return;
    }
    /* ortak opaklık slider'ı: bırakınca tam çözünürlük */
    if (target.dataset.role === 'fx-opacity') {
      inkFxUiReleaseUndo(target);
      if (typeof inkFxPreviewEnd === 'function') inkFxPreviewEnd(it.id);
      inkFxUiTouch(it);
      return;
    }

    if (target.dataset.param !== undefined && target.dataset.param !== ''
      && (target.tagName === 'SELECT' || target.type === 'checkbox' || target.type === 'number' || target.type === 'color')) {
      const fx = stack.find(f => f.id === inkFxUi.selFxId);
      if (!fx) return;
      const p = (inkFxUiDef(fx.type) || { params: [] }).params.find(x => x.key === target.dataset.param);
      if (!p) return;
      if (p.type === 'slider' || p.type === 'angle') {
        /* range zaten 'input' yolunda işlendi; number commit'te partneri de eşzamanla
           ve kırpılmış (clamp) değeri girdiye geri yaz — aksi halde kullanıcı
           "0.5" yazıp ekranda 0.5 görürken modelde 2 kalıyordu. */
        if (target.type === 'range') return;
        /* Değer zaten aynıysa (ör. min sınırındayken daha küçük yazmak)
           boş bir geri-al adımı bırakma. */
        const nextVal = inkFxClampParam(p, target.value);
        if (nextVal === fx.params[p.key]) {
          target.value = String(nextVal);
          const sameRange = section.querySelector('input[type="range"][data-param="' + p.key + '"]');
          if (sameRange) sameRange.value = String(nextVal);
          return;
        }
        /* Ok tuşlarıyla art arda değer değiştirmek her basışta ayrı kayıt
           bırakıyordu; kısa aralıktaki değişimler tek adımda birleşir. */
        inkFxUiArmUndo(target);
        inkFxUiSetParam(it, fx, p.key, target.value);
        const applied = fx.params[p.key];
        target.value = String(applied);
        const range = section.querySelector('input[type="range"][data-param="' + p.key + '"]');
        if (range) range.value = String(applied);
        if (typeof inkFxParamIsController === 'function'
          && inkFxParamIsController(fx.type, p.key)) inkFxUiRefreshVisibility(fx);
        return;
      }
      if (p.type === 'toggle') {
        /* Onay kutusu `input` olayında zaten uygulandı ve tek kayıt bıraktı;
           `change` ikinci bir ölü geri-al adımı ekliyordu. */
        return;
      }
      if (p.type === 'color') {
        /* Renk seçicide canlı `input` akışı değeri çoktan uyguladı; buradaki
           `change` yalnız birleştirme penceresini kapatır. */
        inkFxUiReleaseUndo(target);
        if (String(target.value).toLowerCase() !== String(fx.params[p.key]).toLowerCase()) {
          if (typeof pushUndo === 'function') pushUndo();
          inkFxUiSetParam(it, fx, p.key, target.value);
        }
        return;
      }
      if (typeof pushUndo === 'function') pushUndo();
      inkFxUiSetParam(it, fx, p.key, target.value);
      if (p.type === 'number' && String(fx.params[p.key]) !== String(target.value)) {
        target.value = String(fx.params[p.key]);
      }
      if (typeof inkFxParamIsController === 'function'
        && inkFxParamIsController(fx.type, p.key)) inkFxUiRefreshVisibility(fx);
      return;
    }

    if (target.dataset.role === 'fx-blend') {
      const fx = stack.find(f => f.id === inkFxUi.selFxId);
      if (!fx) return;
      if (typeof pushUndo === 'function') pushUndo();
      fx.blend = target.value || 'normal';
      inkFxUiTouch(it);
      const rowEl = section.querySelector('.inkFxRow[data-fx="' + fx.id + '"] span');
      if (rowEl) rowEl.textContent = Math.round((fx.opacity === undefined ? 1 : fx.opacity) * 100) + '% · ' + fx.blend;
      return;
    }

    if (target.dataset.role === 'fx-visible') {
      const fx = stack.find(f => f.id === inkFxUi.selFxId);
      if (!fx) return;
      if (typeof pushUndo === 'function') pushUndo();
      fx.visible = target.checked;
      inkFxChanged(it);
      inkSyncFxPanel();
      return;
    }

    if (target.dataset.role === 'fx-preset') {
      const fx = stack.find(f => f.id === inkFxUi.selFxId);
      if (!fx || !target.value) return;
      const kind = target.value[0];
      const name = target.value.slice(2);
      if (kind === 'b') {
        const pr = (INK_FX_PRESETS[fx.type] || []).find(x => x.name === name);
        if (pr) inkFxUiApplyPreset(it, fx, pr);
      } else if (kind === 'c') {
        const pr = (inkFxUi.custom.get(fx.type) || []).find(x => x.name === name);
        if (pr) inkFxUiApplyPreset(it, fx, { name: pr.name, p: pr.params }, 'c:' + name);
      }
    }
  });

  /* Sürükleme önizlemesi bırakışta kesin biter: change olayı gelmese bile
     (pointer capture, klavye, iptal) tam çözünürlüğe dönülür. */
  const fxEndPreview = () => {
    const it = inkFxUiScopedItem();
    if (!it) return;
    if (typeof inkFxPreviewEnd === 'function') inkFxPreviewEnd(it.id);
    inkFxUiTouch(it);
  };
  section.addEventListener('pointerup', fxEndPreview);
  section.addEventListener('pointercancel', fxEndPreview);

  /* --- section delegasyonu: efekt sırasını sürükle-bırak ---
     Satırlar veri modelindeki sırayla çizilir; bırakma noktası satırın
     üst/alt yarısına göre "önüne/arkasına" çözülür. ↑/↓ düğmeleriyle
     aynı pushUndo + inkFxChanged yolunu kullanır (undo tek adım). */
  let fxDragId = null;
  const fxClearDropMarks = () => {
    for (const row of section.querySelectorAll('.inkFxRow.is-drop-above, .inkFxRow.is-drop-below')) {
      row.classList.remove('is-drop-above', 'is-drop-below');
    }
  };

  section.addEventListener('dragstart', event => {
    const row = event.target instanceof Element ? event.target.closest('.inkFxRow') : null;
    if (!row || !section.contains(row)) return;
    fxDragId = row.dataset.fx;
    row.classList.add('is-dragging');
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', fxDragId);
    } catch { /* sessiz */ }
  });

  section.addEventListener('dragover', event => {
    if (!fxDragId) return;
    const row = event.target instanceof Element ? event.target.closest('.inkFxRow') : null;
    fxClearDropMarks();
    if (!row) return;
    event.preventDefault();
    try { event.dataTransfer.dropEffect = 'move'; } catch { /* sessiz */ }
    const rect = row.getBoundingClientRect();
    row.classList.add(event.clientY < rect.top + rect.height / 2 ? 'is-drop-above' : 'is-drop-below');
  });

  section.addEventListener('drop', event => {
    if (!fxDragId) return;
    const moving = fxDragId;
    fxDragId = null;
    const row = event.target instanceof Element ? event.target.closest('.inkFxRow') : null;
    const inList = event.target instanceof Element
      && !!event.target.closest('#inkFxStack');
    const hint = row && row.classList.contains('is-drop-above') ? 'above' : 'below';
    fxClearDropMarks();
    for (const r of section.querySelectorAll('.inkFxRow.is-dragging')) r.classList.remove('is-dragging');
    const it = inkFxUiScopedItem();
    if (!it || (!row && !inList)) return;
    event.preventDefault();
    const stack = it.fx.stack;
    const fx = stack.find(f => f.id === moving);
    if (!fx) return;
    inkFxUi.selFxId = fx.id; /* bırakılan efekt seçili kalır (inspector takip eder) */
    let index;
    if (row) {
      const target = stack.findIndex(f => f.id === row.dataset.fx);
      if (target < 0) return;
      index = target + (hint === 'below' ? 1 : 0);
    } else {
      index = stack.length; /* listenin boş alanı → en sona */
    }
    if (!inkFxUiMoveTo(it, fx, index)) return;
    inkSyncFxPanel();
  });

  section.addEventListener('dragend', () => {
    fxDragId = null;
    fxClearDropMarks();
    for (const row of section.querySelectorAll('.inkFxRow.is-dragging')) {
      row.classList.remove('is-dragging');
    }
  });

  inkFxUiLoadCustom();
}

function inkFxUiInit() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => inkFxUiBind());
  } else {
    inkFxUiBind();
  }
}

inkFxUiInit();
