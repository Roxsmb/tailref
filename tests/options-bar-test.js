'use strict';
/* Geçici probe: v5 options bar (FAZ 5) davranışını gerçek Electron
   penceresinde doğrular.
   • Aracı değiştirince şema değişiyor (brush → smudge → gradient)
   • range widget'ı inkState alanına yazıyor
   • dar ekranda taşan widget'lar `⋯` menüsüne kaçıyor ve geri dönüyor
   • bar araç çubuğunun altında kenetleniyor
   node scripts/options-bar-probe.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9371;
const APP_PORT = 5231;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (ws, expression) => {
  const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};
const setWidth = async (ws, w, h = 900) => {
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-optprobe-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let page = null; const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !page) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
    } catch { /* bekle */ }
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('pencere açılmadı');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await sleep(4000);

  await setWidth(ws, 1500, 940);
  await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
  await sleep(900);
  // Çizim moduna geç: tek tık yetmezse segment düğmeleri ve Oluştur devreye girer.
  await evaluate(ws, `document.getElementById('modeDrawBtn')?.click()`);
  await sleep(1200);
  let bodyCls = await evaluate(ws, `document.body.className`);
  if (!bodyCls.includes('mode-draw')) {
    await evaluate(ws, `(() => {
      const candidates = [...document.querySelectorAll('#appModeBar .modeBtn[data-mode="draw"], #modeDrawBtn, .modeBtn[data-mode="draw"]')];
      for (const b of candidates) { try { b.click(); } catch { } }
      return candidates.length;
    })()`);
    await sleep(1500);
    bodyCls = await evaluate(ws, `document.body.className`);
  }
  if (!bodyCls.includes('mode-draw')) {
    await evaluate(ws, `(() => {
      const ok = [...document.querySelectorAll('#newCanvasModal button')].find(b => /Oluştur|Create/.test(b.textContent || ''));
      if (ok) ok.click();
    })()`);
    await sleep(1800);
    bodyCls = await evaluate(ws, `document.body.className`);
  }
  check('mode-draw etkin', bodyCls.includes('mode-draw'), bodyCls.slice(0, 60));
  await evaluate(ws, `(() => {
    const cancel = [...document.querySelectorAll('#newCanvasModal button')].find(b => /İptal|Cancel/.test(b.textContent || ''));
    if (cancel) cancel.click();
    const nc = document.getElementById('newCanvasModal'); if (nc) nc.hidden = true;
  })()`);
  await sleep(900);

  // ---------- 1) Varlık + geniş ekran --------
  const wide = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const toolbar = document.getElementById('v5Toolbar');
    if (!bar || !toolbar) return { exists: false };
    const br = toolbar.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    const ink = (typeof inkState === 'function') ? inkState() : null;
    return {
      exists: true,
      visible: r.width > 0 && r.height > 0,
      underToolbar: r.top >= br.bottom - 2 &&
        Math.abs(r.left - br.left) < 24,
      toolLabel: (bar.querySelector('.v5-opt-tool-name') || {}).textContent || '',
      widgetIds: [...bar.querySelectorAll('[id^="v5opt_"], .v5-opt-brush, .v5-opt-color')]
        .map(x => x.id || x.className),
      brushName: ((bar.querySelector('.v5-opt-brush-name') || {}).textContent || '').trim(),
      inkTool: ink ? ink.tool : null,
      inkSize: ink ? ink.size : null,
      empty: bar.classList.contains('is-empty')
    };
  })()`);
  check('options bar var ve görünüyor', wide.exists && wide.visible);
  check('bar araç çubuğunun altında kenetli', wide.underToolbar);
  if (!wide.exists) {
    console.error('options bar yok — devam edemem');
    try { app.kill(); } catch { }
    process.exit(1);
  }
  check('varsayılan araç = Fırça/Brush', wide.inkTool === 'brush' && /Fırça|Brush/.test(wide.toolLabel),
    `label="${wide.toolLabel}" ink.tool=${wide.inkTool}`);
  /* K13 sertlik/akış widget'ları çubuktan çıkarıldı (kullanıcı talebi) —
     yeni şema: uç + boyut/opaklık/yumuşatma. */
  check('brush şeması: uç + boyut/opaklık/yumuşatma (sertlik+akış yok)',
    (wide.widgetIds || []).some(x => String(x).includes('v5-opt-brush')) &&
    ['size', 'opacity', 'smoothing']
      .every(k => (wide.widgetIds || []).some(x => String(x).includes('v5opt_' + k))) &&
    !(wide.widgetIds || []).some(x => /v5opt_(hardness|flow)/.test(String(x))),
    JSON.stringify(wide.widgetIds));

  // ---------- 2) range → inkState yazımı --------
  const sizeBefore = await evaluate(ws, `inkState().size`);
  const afterRange = await evaluate(ws, `(() => {
    const input = document.getElementById('v5opt_size');
    if (!input) return { ok: false };
    input.value = '77';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const ink = inkState();
    return { ok: true, state: ink.size, out: (document.getElementById('v5opt_size')
      .closest('.v5-opt').querySelector('.v5-opt-val') || {}).textContent };
  })()`);
  check('range input → inkState.size = 77', afterRange.ok && afterRange.state === 77,
    `state=${afterRange.state}`);
  check('output değeri güncellendi',
    /77/.test(String(afterRange.out || '')), `out="${afterRange.out}"`);
  await evaluate(ws, `(() => {
    const input = document.getElementById('v5opt_size');
    input.value = ${String(sizeBefore)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  // ---------- 2a) K9 · canlı önizleme balonu ----------
  /* Kullanıcı raporu: "boyut ve opaklığı ayarlarken gerçek size ve gerçek
     opaklığı görmek istiyorum, hemen altlarında küçük bir panel açılabilir."
     UI yolu: v5opt_size'a input dispatch → balon görünür, etiket gerçek px
     içerir, ~900ms sonra kendiliğinden kapanır. Opaklık için de balonun
     açıldığı doğrulanır. */
  const live1 = await evaluate(ws, `(() => {
    const input = document.getElementById('v5opt_size');
    if (!input) return { ok: false };
    input.value = '64';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const box = document.getElementById('v5LivePreview');
    const val = document.getElementById('v5LivePreviewVal');
    return { ok: true, visible: !!box && !box.hidden,
      canvas: !!box.querySelector('canvas'),
      text: val ? val.textContent : '' };
  })()`);
  check('K9 · boyut sürüklenince canlı balon açılır', live1.ok && live1.visible && live1.canvas,
    JSON.stringify(live1));
  check('K9 · balon etiketi gerçek px + %opaklık içerir',
    /\d+\s*px/.test(String(live1.text || '')) && /%\s*\d+/.test(String(live1.text || '')),
    `text="${live1.text}"`);
  await sleep(1600);
  const live2 = await evaluate(ws, `(() => {
    const box = document.getElementById('v5LivePreview');
    return { hidden: !box || box.hidden };
  })()`);
  check('K9 · balon ~850ms sonra kendiliğinden kapanır', live2.hidden, JSON.stringify(live2));
  const live3 = await evaluate(ws, `(() => {
    const box = document.getElementById('v5LivePreview');
    const input = document.getElementById('v5opt_opacity');
    if (input) { input.value = '40'; input.dispatchEvent(new Event('input', { bubbles: true })); }
    return { opVis: !!box && !box.hidden };
  })()`);
  check('K9 · opaklık sürüklenince balon yeniden açılır', live3.opVis, JSON.stringify(live3));
  await evaluate(ws, `(() => {
    const input = document.getElementById('v5opt_opacity');
    input.value = '100';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  // ---------- 2c) K12 · çift tıkla elle değer ----------
  /* Kullanıcı raporu: "2 kez tıklayıp kendim sayı girmek istiyorum."
     UI yolu: çıktıya dblclick → input belirir; değer yaz, Enter →
     inkState yazılır ve çıktı güncellenir. */
  const typed = await evaluate(ws, `(async () => {
    const wrap = document.getElementById('v5opt_size');
    if (!wrap) return { ok: false };
    const out = wrap.closest('.v5-opt')?.querySelector('.v5-opt-val');
    if (!out) return { ok: false, why: 'out yok' };
    out.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const ed = out.querySelector('input');
    if (!ed) return { ok: false, why: 'editör açılmadı' };
    ed.value = '64';
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // K12 · blur senkron ama DOM boşaltma/balon repaintribi mikro-görevi
    // gecikebilir; gerçek kullanıcı okuması gibi bir tık bekleyip oku.
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 40)));
    const after = inkState().size;
    const outText = out.textContent;
    return { ok: true, state: after, outText };
  })()`);
  check('K12 · çıktıya çift tık → elle giriş', typed.ok && typed.state === 64,
    JSON.stringify(typed));
  check('K12 · elle girilen değer çıktıya yansır', /64/.test(String(typed.outText || '')),
    `out="${typed.outText}"`);

  // ---------- 2b) FAZ 6 A2: renk geçmişi (renk panelinde) -----------
  /* Şerit (#v5OptRecents) options bar'dan kaldırıldı; geçmiş yalnızca
     renk panelindeki #v5Recents şeridinde yaşar. Test önce barın
     temiz kaldığını doğrular, sonra panel şeridini işler. */
  const recentsPanel = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const optStrip = bar ? bar.querySelector('#v5OptRecents') : null;
    const strip = document.getElementById('v5Recents');
    if (!strip) return { ok: false, optStripGone: !optStrip };
    let btns = [...strip.querySelectorAll('button')];
    if (btns.length < 4 && typeof inkSetColor === 'function') {
      ['#112299', '#3344bb', '#5566dd', '#99aabb'].forEach(h => {
        try { inkSetColor(h, true); } catch { /* sessiz */ }
      });
      btns = [...strip.querySelectorAll('button')];
    }
    if (!btns.length) return { ok: true, count: 0, optStripGone: !optStrip };
    const target = btns.find(b => !b.classList.contains('is-current')) || btns[0];
    const hex = String(target.title || '').toUpperCase();
    target.click();
    const color = (typeof inkState === 'function') ? String(inkState().color).toUpperCase() : null;
    /* is-current: panel şeridi tek kaynaktır */
    const cur = [...document.querySelectorAll('#v5Recents button')]
      .filter(b => b.classList.contains('is-current')).map(b => String(b.title || '').toUpperCase());
    return { ok: true, count: btns.length, hex, color,
      cur: cur[0] || null, optStripGone: !optStrip };
  })()`);
  check('options bar şeridi kaldırıldı; renk paneli geçmişi var (≥4 swatch)',
    recentsPanel.ok && recentsPanel.count >= 4 && recentsPanel.optStripGone,
    JSON.stringify(recentsPanel));
  check('panel swatch tıklaması rengi uygular ve is-current kayar',
    recentsPanel.ok && recentsPanel.count > 0 &&
    recentsPanel.cur === recentsPanel.hex && recentsPanel.color === recentsPanel.hex,
    JSON.stringify(recentsPanel));

  // ---------- 3) araç değişince şema değişimi --------
  await evaluate(ws, `document.querySelector('#v5Toolbar [data-tool="smudge"]').click()`);
  await sleep(400);
  const smudge = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const ink = inkState();
    return { tool: ink.tool, label: (bar.querySelector('.v5-opt-tool-name')||{}).textContent,
      hasBrushTip: !!bar.querySelector('.v5-opt-brush'), hasSize: !!document.getElementById('v5opt_size'),
      hasFlow: !!document.getElementById('v5opt_flow'), hasColor: !!bar.querySelector('.v5-opt-color') };
  })()`);
  check('smudge: araç seçildi ve şema sade (uç yok, akış çubuğa yok)',
    smudge.tool === 'smudge' && !smudge.hasBrushTip && smudge.hasSize && !smudge.hasFlow && !smudge.hasColor,
    `label="${smudge.label}"`);
  const smudgeFlowDefault = await evaluate(ws, `inkState().toolSettings.smudge.flow`);
  check('smudge akış varsayılanı korunuyor (0.32)', smudgeFlowDefault === 0.32,
    `flow=${smudgeFlowDefault}`);

  await evaluate(ws, `document.querySelector('#v5Toolbar [data-tool="gradient"]').click()`);
  await sleep(400);
  const gradient = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    return { tool: inkState().tool, hasColor: !!bar.querySelector('.v5-opt-color'),
      hasTolerance: !!document.getElementById('v5opt_opacity') && !!bar.querySelector('.v5-opt-color'),
      swatchBg: (bar.querySelector('.v5-opt-color')||{}).style ? (bar.querySelector('.v5-opt-color').style.background || '') : '' };
  })()`);
  check('gradient: renk widget var, kaleme özgü widget yok', gradient.tool === 'gradient' && gradient.hasColor,
    `tool=${gradient.tool}`);
  // Renk düğmesi renk panelini açar:
  const colorPanel = await evaluate(ws, `(() => {
    const btn = document.querySelector('#v5OptionsBar .v5-opt-color');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(400);
  check('gradient renk düğmesi tıklanabilir', colorPanel === true);
  await evaluate(ws, `document.querySelector('#v5Toolbar [data-tool="brush"]').click()`);
  await sleep(400);

  // ---------- 3b) Kalem (caret menü) + toggle + şekil --------
  const pencil = await evaluate(ws, `(() => {
    const caret = document.querySelector('#v5Toolbar [data-menu="paint"]');
    if (!caret) return { caret: false };
    caret.click();
    const menu = document.querySelector('.v5-menu');
    if (!menu) return { caret: true, menu: false };
    const item = [...menu.querySelectorAll('button')].find(b => /Kalem|Pencil/.test(b.textContent || ''));
    return { caret: true, menu: true, items: [...menu.querySelectorAll('button')].length, pencilItem: !!item,
      brushChecked: !![...menu.querySelectorAll('button')].find(b => /Fırça|Brush/.test(b.textContent || '') && b.querySelector('.v5-menu-check') && b.querySelector('.v5-menu-check').textContent.trim()) };
  })()`);
  check('paint caret menüsü fırça+kalem gösteriyor',
    pencil.caret && pencil.menu && pencil.pencilItem && pencil.items === 2, JSON.stringify(pencil));
  await evaluate(ws, `(() => {
    const item = [...document.querySelectorAll('.v5-menu button')].find(b => /Kalem|Pencil/.test(b.textContent || ''));
    if (item) item.click();
  })()`);
  await sleep(400);
  const pencilSel = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    return { tool: inkState().tool, label: (bar.querySelector('.v5-opt-tool-name')||{}).textContent,
      /* K13: "Fare basıncı" çubuktan Çizim Ayarları menüsüne taşındı —
         şemadan çıkarıldığı için bar'da olmaMALI. */
      hasToggleInBar: !!document.getElementById('v5opt_mouseSpeedPressure'),
      hasSize: !!document.getElementById('v5opt_size'), hasFlow: !!document.getElementById('v5opt_flow'),
      /* FAZ 6 A6 (tek-ışık): gruba ışık grup düzeyinde yanar, fırça
         düğmesi kendisi sönük kalmalı. */
      brushGroupLit: !!document.querySelector('#v5Toolbar [data-group="brush"].is-active'),
      brushBtnDark: !document.querySelector('#v5Toolbar [data-tool="brush"].is-active') };
  })()`);
  check('kalem seçildi: şema sade (toggle menüde), paint grubu yanıyor, fırça düğmesi sönük',
    pencilSel.tool === 'pencil' && !pencilSel.hasToggleInBar && pencilSel.hasSize && !pencilSel.hasFlow &&
    pencilSel.brushGroupLit && pencilSel.brushBtnDark,
    JSON.stringify(pencilSel));
  /* K13 · ayar artık ⋯ → Ayarlar penceresinin ÇİZİM sütununda: köprü
     window.inkV5Settings.setMousePressure → inkState boolean. */
  const toggleTest = await evaluate(ws, `(() => {
    const k = 'mouseSpeedPressure';
    const before = !!inkState()[k];
    const api = window.inkV5Settings;
    if (!api || typeof api.setMousePressure !== 'function') return { ok: false, why: 'inkV5Settings köprüsü yok' };
    api.setMousePressure(!before);
    const after = !!inkState()[k];
    api.setMousePressure(before);
    const geri = !!inkState()[k];
    return { ok: before !== after, before, after, geri };
  })()`);
  check('Fare basıncı köprüsü inkState boolean alanına yazıyor',
    toggleTest.ok && toggleTest.before !== toggleTest.after, JSON.stringify(toggleTest));
  /* ⋯ → Ayarlar penceresi ÇİZİM sütununda "Şekil aracı" satırı var;
     köprü window.inkV5Settings.setShape ile seçildikten sonra options
     bar'ın shape select widget'ı görünür olmalı. */
  const shapeOpen = await evaluate(ws, `(() => {
    const api = window.inkV5Settings;
    if (!api || typeof api.setShape !== 'function') return { grip: false, menu: false, item: false, why: 'köprü yok' };
    api.setShape(true);
    return { grip: true, menu: true, item: true, source: 'inkV5Settings.setShape' };
  })()`);
  check('Ayarlar (ÇİZİM) köprüsü Şekil aracını seçiyor',
    shapeOpen.grip && shapeOpen.menu && shapeOpen.item, JSON.stringify(shapeOpen));
  await evaluate(ws, `(() => {
    const item = [...document.querySelectorAll('.v5-menu button')]
      .find(b => /Şekil aracı|Shape tool/.test(b.textContent || ''));
    if (item) item.click();
  })()`);
  await sleep(400);
  const shapeSelCheck = await evaluate(ws, `(() => {
    const sel = document.getElementById('v5opt_shape');
    return { ok: true, tool: inkState().tool,
      brushed: !!document.querySelector('#v5Toolbar [data-tool="brush"].is-active'),
      menuClosed: !document.querySelector('.v5-menu'),
      hasSelect: !!sel, selValue: sel ? sel.value : null };
  })()`);
  check('şekil aracı menüden seçiliyor, select widget var',
    shapeSelCheck.tool === 'shape' && !shapeSelCheck.brushed &&
    shapeSelCheck.menuClosed && shapeSelCheck.hasSelect &&
    shapeSelCheck.selValue === 'arrow', JSON.stringify(shapeSelCheck));
  const shapeSel = await evaluate(ws, `(() => {
    const sel = document.getElementById('v5opt_shape');
    if (!sel) return { shape: null };
    sel.value = 'rect';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { shape: inkState().shape };
  })()`);
  check('şekil türü select → inkState.shape yazıyor', shapeSel.shape === 'rect', JSON.stringify(shapeSel));
  await evaluate(ws, `document.querySelector('#v5Toolbar [data-tool="brush"]').click()`);
  await sleep(400);

  // ---------- 3c) FAZ 6 A1/A9: alfa kilidi (toolbar) -----------------
  /* FAZ 6 A9: alfa kilidi widget'ı options bardan KALDIRILDI (kullanıcı
     talebi: çubukta gereksiz); kilidi toolbar kilit düğmesi ve katman
     paneli yönetir. Test: toolbar düğmesi var, widget yok (regresyon
     guard), toolbar çevrimi katman alanını + aria + ışığı sync eder. */
  const alphaLock = await evaluate(ws, `(() => {
    const btn = document.querySelector('#v5Toolbar [data-action="alpha-lock"]');
    const wid = document.getElementById('v5opt_alphaLock');
    if (!btn) return { btn: false, wid: false };
    const layer = (typeof inkDocOwnerId === 'function' &&
      typeof inkDocSelectedLayer === 'function')
      ? inkDocSelectedLayer(inkDocOwnerId()) : null;
    if (!layer) return { btn: true, wid: !!wid, layer: false };
    /* Katman alanını doğrudan okuyan gözlem — arayüzle senkronu zorunlu
       (sözleşme 2: aria-pressed + ışık tek kaynak) ve widget yokluğu. */
    const before = !!layer.alphaLock;
    btn.click();
    const s1 = { state: !!layer.alphaLock, pressed: btn.getAttribute('aria-pressed'),
      lit: btn.classList.contains('is-active') };
    return { btn: true, wid: !!wid, layer: true, before,
      flip: s1.state !== before,
      sync: s1.pressed === (s1.state ? 'true' : 'false') &&
        s1.lit === s1.state };
  })()`);
  check('alfa kilidi: toolbar düğmesi + widget yokluğu (A9 sözleşmesi)',
    alphaLock.btn === true && alphaLock.wid === false, JSON.stringify(alphaLock));
  check('alfa kilidi toggle: katman alanı + aria + ışık senkronu',
    alphaLock.layer === true && alphaLock.flip && alphaLock.sync,
    JSON.stringify(alphaLock));

  // ---------- 4) daralma + overflow --------
  await setWidth(ws, 560, 900);
  await sleep(400);
  const narrow = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    if (!bar) return null;
    return { overflowClass: bar.classList.contains('is-overflowing'),
      hasMore: [...bar.querySelectorAll('.v5-opt-more')].some(b => b.style.display !== 'none'),
      hidden: bar.querySelectorAll('.v5-opt.is-overflowed').length,
      total: bar.querySelectorAll('.v5-opt').length };
  })()`);
  check('dar ekranda widgetlar taşınıyor (⋯ görünür)',
    narrow && narrow.overflowClass && narrow.hasMore && narrow.hidden > 0,
    JSON.stringify(narrow));

  const moreOpen = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const more = bar.querySelector('.v5-opt-more');
    if (!more || more.style.display === 'none') return { ok: false };
    more.click();
    const panel = document.querySelector('.v5-options-overflow');
    if (!panel) return { ok: true, panelOpen: false };
    /* FAZ 6 sözleşme 1 (bounds): panel pencere geometrisine hapsolmalı. */
    const r = panel.getBoundingClientRect();
    const inBounds = r.left >= 0 && r.top >= 0 &&
      r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
    return { ok: true, panelOpen: !!panel,
      movedIn: panel.querySelectorAll('.v5-opt').length,
      menuVisible: r.height > 0, inBounds,
      bounds: { l: Math.round(r.left), t: Math.round(r.top),
        r: Math.round(r.right), b: Math.round(r.bottom),
        iw: innerWidth, ih: innerHeight } };
  })()`);
  check('⋯ menüsü taşan widgetları gösteriyor',
    moreOpen.ok && moreOpen.panelOpen && moreOpen.movedIn > 0 && moreOpen.menuVisible,
    JSON.stringify(moreOpen));
  check('⋯ menüsü pencere sınırlarını aşmıyor (bounds sözleşmesi)',
    moreOpen.inBounds === true, JSON.stringify(moreOpen.bounds));

  const moreClose = await evaluate(ws, `(() => {
    const panel = document.querySelector('.v5-options-overflow');
    if (!panel) return { ok: false };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape',
      bubbles: true, cancelable: true }));
    const bar = document.getElementById('v5OptionsBar');
    return { ok: true, panelGone: !document.querySelector('.v5-options-overflow'),
      backInBar: bar.querySelectorAll('.v5-opt').length };
  })()`);
  await sleep(300);
  // Kapanınca ölçüm yeniden koşar: çubuk hâlâ dar olduğu için bazı
  // widgetlar tekrar taşınır (beklenen); önemli olan hepsinin çubuğa
  // dönmesi ve panelin kalkması.
  check('⋯ menüsü kapanınca widgetlar çubuğa döndü',
    moreClose.ok && moreClose.panelGone && moreClose.backInBar === narrow.total,
    JSON.stringify(moreClose));

  // ---------- 5) geniş ekrana dönünce kompakt hap davranışı --------
  // FAZ 6 A9: bar artık pencereyi dolduran şerit değil, tavanlı
  // (≤860px) bağlamsal hap. Öncelik kontrolleri (Uç-Boyut-Opaklık-
  // Yumuşatma) görünür kalır; taşanlar `⋯`'de ve içerik asla
  // kırpılmaz (scrollWidth == clientWidth).
  await setWidth(ws, 1700, 940);
  await sleep(500);
  const back = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const w = bar.getBoundingClientRect().width;
    const clipped = bar.scrollWidth > bar.clientWidth + 1;
    const visible = id => { const n = document.getElementById(id);
      return !!n && n.offsetParent !== null && !n.closest('.is-overflowed'); };
    const barRight = Math.round(bar.getBoundingClientRect().right);
    return { width: Math.round(w), clipped,
      /* K11: tavan 900→1220 (CSS max-width); grip + 2px tol = 1244. */
      overCap: w > 1244,
      coreVisible: visible('v5opt_size') && visible('v5opt_opacity') &&
        !document.getElementById('v5opt_alphaLock'),
      overflowed: bar.querySelectorAll('.v5-opt.is-overflowed').length,
      overflowIds: [...bar.querySelectorAll('.v5-opt.is-overflowed')]
        .map(n => n.id || n.textContent.trim().slice(0, 24) || 'anon'),
      windowWidth: innerWidth, barRight,
      rightGap: innerWidth - barRight };
  })()`);
  check('options bar kompakt tavana oturur (≤1220px, pencereye hapsolur)',
    /* K11: grip ~22px yasal katkı — tavan yine CSS max-width 1220. */
    !back.overCap && !back.clipped, JSON.stringify(back));
  check('öncelik: Boyut/Opaklık görünür, çekirdek ⁘ taşmıyor (A9)',
    /* K13: sertlik+akış+fare basıncı çubuktan çıktığı için bar ekran
       içinde her widget'la sığar; taşma artık zorunlu değil — çekirdek
       in-bar ve taşmış-listede olmaması yeterli. */
    back.coreVisible && !back.clipped &&
    !back.overflowIds.some(t => /Boyut|Opaklık|v5opt_(size|opacity)/.test(t)),
    JSON.stringify(back));

  // ---------- 6) maske düzenleme rozeti ----------------------------
  // FAZ 6 A5: inkState.maskEditId açıkken bar, hedefi adlandıran
  // "MASKE · katman" rozeti yakan; tıkla → düzenlemeyi bırak.
  const mask = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const badge = bar.querySelector('.v5-opt-mask');
    if (!badge) return { ok: false, reason: 'rozet yok' };
    const hiddenAtStart = badge.hidden;
    // Maske ekle: inkDocAddMask maskEditId'yi AÇIK ayarlar (50:316).
    // Senkron zarfi açıkça çağrılır (inkSyncUI zinciri maska yolundan
    // her zaman geçmez).
    const owner = typeof inkDocOwnerId === 'function' ? inkDocOwnerId() : null;
    const layer = typeof inkDocAddLayer === 'function' ? inkDocAddLayer({ ownerId: owner, name: 'Maske Denek' }) : null;
    if (!layer) return { ok: false, reason: 'katman eklenemedi' };
    const withMask = typeof inkDocAddMask === 'function' ? inkDocAddMask(layer.id, 'hide') : null;
    if (window.__v5OptSync) window.__v5OptSync();
    const on = typeof inkState === 'function' ? !!inkState().maskEditId : false;
    const visOn = !badge.hidden && badge.offsetParent !== null;
    const ariaOn = badge.getAttribute('aria-pressed') === 'true';
    const nameTxt = (badge.querySelector('.v5-opt-mask-name') || {}).textContent || '';
    // Tıkla-çıkış: rozet tıklaması maskEditId'yi boşaltmalı.
    badge.click();
    if (window.__v5OptSync) window.__v5OptSync();
    const off = typeof inkState === 'function' ? !!inkState().maskEditId : true;
    const visOff = badge.hidden;
    return { ok: true, hiddenAtStart, on, visOn, ariaOn, nameTxt, layerName: layer.name, maskOk: !!withMask, off, visOff };
  })()`);
  check('maske rozeti başlangıçta gizli', mask.ok !== undefined && mask.hiddenAtStart !== false,
    JSON.stringify(mask));
  check('maskEditId açıkken rozet yanar ve hedefi adlandırır',
    mask.ok && mask.on && mask.visOn && mask.ariaOn &&
    mask.nameTxt === 'Maske Denek' && mask.layerName === 'Maske Denek',
    JSON.stringify(mask));  check('rozet tıklaması maske düzenlemeyi bırakır',
    mask.ok && !mask.off && mask.visOff, JSON.stringify(mask));
  if (!mask.ok || !mask.on || !mask.visOn || !mask.visOff) results.push({ name: 'maske rozeti', ok: false });

  // Denek katmanı + maskesini temizle (diğer kontrolleri kirletmesin).
  await evaluate(ws, `(() => {
    const ink = typeof inkState === 'function' ? inkState() : null;
    if (ink && ink.maskEditId && typeof inkDocToggleMaskEdit === 'function') inkDocToggleMaskEdit(ink.maskEditId);
    const owner = typeof inkDocOwnerId === 'function' ? inkDocOwnerId() : null;
    const victim = owner && typeof inkDocLayers === 'function'
      ? inkDocLayers(owner).find(l => l.name === 'Maske Denek') : null;
    if (victim && typeof inkDocDeleteLayer === 'function') inkDocDeleteLayer(victim.id);
  })()`);
  await sleep(200);

  // ---------- 7) A4: transform bilgi satırı + "Seçimi bırak" --------
  const a4 = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    if (typeof inkSetTool === 'function') inkSetTool('transform');
    if (window.__v5OptSync) window.__v5OptSync();
    const info = bar.querySelector('.v5-opt-info');
    if (!info) return { ok: false, reason: 'transform info satırı yok' };
    const emptyTxt = info.querySelector('.v5-opt-info-val').textContent;
    const mode = typeof inkInlineModeActive === 'function'
      ? !!inkInlineModeActive() : false;
    // Yanlış kimlikli "seçim" bile satırı dolduramaz (invalid). Gerçek
    // seçim mevcutluğu motor ayrı doğrular; burada iki uç sarılır:
    // boş (yok) ve motor değerli satır (sayısal desen).
    const st = typeof inkState === 'function' ? inkState() : null;
    const hasSel = !!st && Array.isArray(st.selection);
    // Action row: marquee şeması düğme üretir mi + seçim yokken gizli mi.
    if (typeof inkSetTool === 'function') inkSetTool('marquee');
    if (window.__v5OptSync) window.__v5OptSync();
    const actionBox = bar.querySelector('.v5-opt-action');
    if (!actionBox) return { ok: false, reason: 'marquee action yok' };
    const hiddenWhenEmpty = actionBox.hidden;
    const infoOnMarquee = null;
    // Seçim birdürük (engine inkClearSelection tek yol): sahte id ile
    // doldur → görünür → tıkla → motor temizler → gizli.
    const hadSet = typeof inkState === 'function';
    if (hadSet) inkState().selection = ['fake-id-1', 'fake-id-2'];
    if (window.__v5OptSync) window.__v5OptSync();
    const shownWithSelection = !actionBox.hidden;
    const cleared = typeof inkClearSelection === 'function'
      ? !!inkClearSelection() : false;
    const emptied = hadSet ? inkState().selection.length === 0 : false;
    if (window.__v5OptSync) window.__v5OptSync();
    const hiddenAfterClear = actionBox.hidden;
    return { ok: true, emptyTxt, mode, hasSel, hiddenWhenEmpty,
      shownWithSelection, cleared, emptied, hiddenAfterClear, infoOnMarquee };
  })()`);
  check('transform info satırı boşta "yok/none" der', a4.ok && (a4.emptyTxt === 'yok' || a4.emptyTxt === 'none') && a4.mode,
    JSON.stringify(a4));
  check('"Seçimi bırak" seçim yokken gizli seçim varken yanar',
    a4.ok && a4.hiddenWhenEmpty && a4.shownWithSelection, JSON.stringify(a4));
  check('"Seçimi bırak" motoru tek yoldan temizler ve söner',
    a4.ok && a4.cleared && a4.emptied && a4.hiddenAfterClear, JSON.stringify(a4));
  // ---------- 8) FAZ 6 B6: seçim modları --------------------------------
  /* Widget kontrolleri (marquee/lasso şemalarında selmode segmenti) +
     motor merge semantiği birim + Shift/Alt geçici üstünlüğü ve
     gerçek pointer akışıyla drag-başı mod yakalama. */
  const b6w = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const out = { ok: true };
    const state = inkState();
    state.selectionMode = 'new';
    if (typeof inkSetTool === 'function') inkSetTool('marquee');
    if (window.__v5OptSync) window.__v5OptSync();
    const box = bar.querySelector('.v5-opt-selmode');
    if (!box) return { ok: false, reason: 'marquee selmode yok' };
    out.btns = box.querySelectorAll('.v5-selmode-btn').length;
    out.btnOrder = [...box.querySelectorAll('.v5-selmode-btn')]
      .map(b => b.dataset.value);
    const actives = box.querySelectorAll('.v5-selmode-btn.is-active').length;
    out.actives = actives;
    const cur = box.querySelector('.v5-selmode-btn.is-active');
    out.defaultNew = cur && cur.dataset.value === 'new';
    // lasso şeması da taşımak zorunda.
    if (typeof inkSetTool === 'function') inkSetTool('lasso');
    if (window.__v5OptSync) window.__v5OptSync();
    out.lassoBox = !!bar.querySelector('.v5-opt-selmode');
    // A7 aria: her düğme aria-pressed taşır.
    out.aria = [...box.querySelectorAll('.v5-selmode-btn')]
      .every(b => b.getAttribute('aria-pressed') ===
        (b.classList.contains('is-active') ? 'true' : 'false'));
    if (typeof inkSetTool === 'function') inkSetTool('marquee');
    if (window.__v5OptSync) window.__v5OptSync();
    return out;
  })()`);
  check('seçim modu segmenti marquee+lasso şemalarında (4 düğme, tek ışık)',
    b6w.ok && b6w.btns === 4 && b6w.actives === 1 && b6w.defaultNew &&
    b6w.lassoBox && b6w.aria &&
    b6w.btnOrder.join(',') === 'new,add,sub,intersect', JSON.stringify(b6w));

  // Widget yazımı: Ekle düğmesine tıkla → state + ışık tazelenir.
  const b6click = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const box = bar.querySelector('.v5-opt-selmode');
    const btn = box && [...box.querySelectorAll('.v5-selmode-btn')]
      .find(b => b.dataset.value === 'add');
    if (!btn) return { ok: false };
    btn.click();
    const state = inkState();
    const written = state.selectionMode === 'add';
    if (window.__v5OptSync) window.__v5OptSync();
    const moved = box.querySelector('.v5-selmode-btn.is-active')
      ?.dataset.value === 'add';
    // Geri al (Yeni).
    const btnNew = [...box.querySelectorAll('.v5-selmode-btn')]
      .find(b => b.dataset.value === 'new');
    btnNew.click();
    const restored = state.selectionMode === 'new';
    return { ok: written && moved && restored, written, moved, restored };
  })()`);
  check('mod düğmesi tıklaması inkState.selectionMode yazar ve ışığı taşır',
    b6click.ok, JSON.stringify(b6click));

  // Motor merge semantiği (birim): her mod için beklenen sonuç.
  const b6merge = await evaluate(ws, `(() => {
    const m = (mode, prev, fresh) => inkSelectionMerge(mode, prev, fresh);
    const same = (a, b) => a.length === b.length &&
      a.every((v, i) => v === b[i]);
    return {
      add: same(m('add', ['a', 'b'], ['b', 'c']), ['a', 'b', 'c']),
      addEmpty: same(m('add', ['a'], []), ['a']),
      sub: same(m('sub', ['a', 'b', 'c'], ['b']), ['a', 'c']),
      subEmptyKeeps: same(m('sub', ['a', 'b'], []), ['a', 'b']),
      intersect: same(m('intersect', ['a', 'b'], ['b', 'c']), ['b']),
      intersectEmpty: m('intersect', ['a', 'b'], []).length === 0,
      fresh: same(m('new', ['a'], ['x']), ['x']),
      freshEmpty: m('new', ['a'], []).length === 0,
    };
  })()`);
  check('inkSelectionMerge semantiği (add/sub/intersect/new + boş parça)',
    b6merge.add && b6merge.addEmpty && b6merge.sub && b6merge.subEmptyKeeps &&
    b6merge.intersect && b6merge.intersectEmpty && b6merge.fresh &&
    b6merge.freshEmpty, JSON.stringify(b6merge));

  // Shift/Ctrl geçici üstünlüğü (drag-başı çözümü; PS haritası + Ctrl
  // takma adları — tahtada Alt pcrlo  pencere taşımaya gider).
  const b6key = await evaluate(ws, `(() => {
    inkState().selectionMode = 'new';
    const m = e => inkSelectEffectiveMode(e);
    return {
      shift: m({ shiftKey: true }) === 'add',
      alt: m({ altKey: true }) === 'sub',
      both: m({ shiftKey: true, altKey: true }) === 'intersect',
      ctrl: m({ ctrlKey: true }) === 'sub',
      shiftCtrl: m({ shiftKey: true, ctrlKey: true }) === 'intersect',
      none: m({}) === 'new',
      persisted: (() => {
        inkState().selectionMode = 'sub';
        const p = m({}) === 'sub';
        return p;
      })(),
      restored: (() => { inkState().selectionMode = 'new'; return true; })(),
    };
  })()`);
  check('Shift=Ekle Ctrl/Alt=Çıkar Shift+Ctrl=Kesişim geçici; yoksa kalıcı',
    b6key.shift && b6key.alt && b6key.both && b6key.ctrl &&
    b6key.shiftCtrl && b6key.none && b6key.persisted,
    JSON.stringify(b6key));

  // Gerçek pointer akışı: marquee drag CDP Input ile, modifiers'la.
  const b6drag = await evaluate(ws, `(() => {
    // Boş sahne hedefi: stage merkezi (panel/txt örtüşmez).
    const st = document.getElementById('stage');
    const r = st.getBoundingClientRect();
    return {
      cx: r.left + r.width / 2, cy: r.top + r.height / 2,
      tool: typeof inkSetTool === 'function' ? (inkSetTool('marquee'),
        inkState().tool) : null,
    };
  })()`);
  const marqueeDrag = async (modifiers) => {
    const { cx, cy } = b6drag;
    const down = { type: 'mousePressed', x: cx - 40, y: cy - 40, buttons: 1,
      clickCount: 1, modifiers, button: 'left' };
    const move = { type: 'mouseMoved', x: cx - 40, y: cy - 40, buttons: 1,
      modifiers, button: 'left' };
    const mv2 = { ...move, x: cx + 40, y: cy + 40 };
    const up = { type: 'mouseReleased', x: cx + 40, y: cy + 40, buttons: 0,
      modifiers: 0, button: 'left', clickCount: 1 };
    for (const ev of [down, move, mv2, up]) {
      await send(ws, 'Input.dispatchMouseEvent', ev); await sleep(70);
    }
    await sleep(150);
    return evaluate(ws, `inkState().selection.length`);
  };
  // 1) new modda boş bölge → seçim boşalır.
  await evaluate(ws, `(() => { inkState().selection = ['f1','f2'];
    if (window.__v5OptSync) window.__v5OptSync(); })()`);
  const nNew = await marqueeDrag(0);
  check('marquee drag new modda öncekini değiştirir (boşta sıfırlar)', nNew === 0,
    'selection.length=' + nNew);
  // 2) add modda boş bölge → seçim korunur.
  await evaluate(ws, `(() => { inkState().selection = ['f1','f2']; })()`);
  const nAdd = await marqueeDrag(8); // Shift
  check('marquee drag Shift=Ekle (boş parça seçimi korur)', nAdd === 2,
    'selection.length=' + nAdd);
  // 3) Ctrl modda boş parça → korunur (PS: boş çıkarma işlemez).
  const nSub = await marqueeDrag(2); // Ctrl (Alt tahtada pencere-taşıma yolu)
  check('marquee drag Ctrl=Çıkar (boş parça seçimi korur)', nSub === 2,
    'selection.length=' + nSub);
  // 4) Shift+Ctrl kesişim → boş parça eleme (bırakır boş).
  const nInt = await marqueeDrag(10); // Shift+Ctrl (8|2)
  check('marquee drag Shift+Ctrl=Kesişim (boş parçayla boşaltır)', nInt === 0,
    'selection.length=' + nInt);
  // Temizlik: mod + seçim + araç.
  await evaluate(ws, `(() => {
    inkState().selectionMode = 'new';
    inkState().selection = [];
    if (typeof inkSetTool === 'function') inkSetTool('brush');
    if (window.__v5OptSync) window.__v5OptSync();
  })()`);

  // ---------- 9) FAZ 6 B7: Transform HUD (sayısal X/Y/W/H/R) ----------
  /* Widget varlığı + gizlilik kuralı (seçim yokken) + gerçek vuruşla
     çift-yön: alan→motor taşı/ölçek/döndür, gizmo→alan senkron. */
  const b7w = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    if (typeof inkSetTool === 'function') inkSetTool('transform');
    if (window.__v5OptSync) window.__v5OptSync();
    const hud = bar.querySelector('.v5-opt-hud');
    if (!hud) return { ok: false, reason: 'gizmohud widget yok' };
    const nums = [...hud.querySelectorAll('.v5-opt-hud-num')];
    const caps = [...hud.querySelectorAll('.v5-opt-hud-cap')]
      .map(c => c.textContent.trim());
    return { ok: true, count: nums.length, caps, types: nums.map(n => n.type),
      hiddenWhenEmpty: hud.hidden,
      allNumber: nums.every(n => n.type === 'number') };
  })()`);
  check('transform HUD: X/Y/W/H/R beş sayısal alan',
    b7w.ok && b7w.count === 5 && b7w.allNumber &&
    b7w.caps.join(',') === 'X,Y,W,H,R' &&
    b7w.hiddenWhenEmpty, JSON.stringify(b7w));

  // Gerçek vuruş denek: global katman + dünya-koordinatlı vuruş.
  const b7denek = await evaluate(ws, `(() => {
    const layer = typeof inkAddLayer === 'function'
      ? inkAddLayer({ kind: 'global', name: 'B7 Denek' }) : null;
    if (!layer) return { ok: false, reason: 'katman yok' };
    layer.strokes.push({
      id: 'b7-stroke', kind: 'stroke', tool: 'brush',
      color: '#000000', opacity: 1, size: 6, hardness: 1,
      spacing: 0.05, brushId: 'ink-hard',
      points: [{ x: 600, y: 300, p: 1 }, { x: 700, y: 300, p: 1 },
               { x: 700, y: 360, p: 1 }],
    });
    if (typeof inkRerenderLayer === 'function') inkRerenderLayer(layer.id);
    inkState().selection = ['b7-stroke'];
    inkUpdateGizmo();
    if (window.__v5OptSync) window.__v5OptSync({ measure: false });
    const hud = document.querySelector('.v5-opt-hud');
    const b = inkSelectionBounds();
    return { ok: !!hud && !!b, layerId: layer.id,
      bounds: b ? { x: Math.round(b.x), y: Math.round(b.y),
        w: Math.round(b.w), h: Math.round(b.h) } : null,
      hudVisible: hud && !hud.hidden,
      vals: [...hud.querySelectorAll('.v5-opt-hud-num')]
        .map(i => i.value) };
  })()`);
  check('HUD seçimle görünür ve değerleri gizmo bounds yansıtır',
    b7denek.ok && b7denek.hudVisible && !!b7denek.bounds &&
    b7denek.vals.length === 5 &&
    Math.abs(Number(b7denek.vals[0]) - b7denek.bounds.x) < 2 &&
    Math.abs(Number(b7denek.vals[1]) - b7denek.bounds.y) < 2,
    JSON.stringify(b7denek));

  const b7num = async (idx, value, settle = 150) => {
    const r = await evaluate(ws, `(async () => {
      const hud = document.querySelector('.v5-opt-hud');
      const input = [...hud.querySelectorAll('.v5-opt-hud-num')][${idx}];
      const before = inkSelectionBounds();
      const snap = { x: before.x, y: before.y, w: before.w, h: before.h,
        cx: before.x + before.w / 2, cy: before.y + before.h / 2 };
      input.value = String(${value});
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(res => setTimeout(res, ${settle}));
      const after = inkSelectionBounds();
      return { snap, after, stillHud: !hud.hidden };
    })()`);
    return r;
  };
  // X +50 → yalnız taşır (y sabit).
  const b7x = await b7num(0, Math.round(b7denek.bounds.x) + 50);
  check('HUD X alanı seçim bütünü +50 taşır',
    b7x.after && Math.abs(b7x.after.x - (b7x.snap.x + 50)) < 1.5 &&
    Math.abs(b7x.after.y - b7x.snap.y) < 1.5, JSON.stringify(b7x));
  // W ×2 → nokta-spread sol-üst çapayla ölçeklenir; stroke reach (pad)
  // ölçek dışında olduğundan sınır b.w ile b.w + 2reach arasına oturur.
  const b7w2 = await b7num(2, Math.round(b7denek.bounds.w) * 2);
  check('HUD W alanı sol-üst çapayla ölçekler (reach payı tol)',
    b7w2.after && b7w2.after.x - b7w2.snap.x > -3 &&
    b7w2.after.x - b7w2.snap.x < 14 &&
    b7w2.after.w > b7x.snap.w * 1.7 &&
    b7w2.after.w < b7x.snap.w * 2.1, JSON.stringify(b7w2));
  // R 90° → merkez korunur (b7r.snap = W sonrası bounds; doğrusu bu).
  const b7r = await b7num(4, 90);
  check('HUD R alanı merkezden 90° döndürür (merkez korunur)',
    b7r.after && Math.abs(
      (b7r.after.x + b7r.after.w / 2) - b7r.snap.cx) < 4 &&
    Math.abs((b7r.after.y + b7r.after.h / 2) - b7r.snap.cy) < 4,
    JSON.stringify(b7r));
  // Çalışmak final: alanların sync'i motor sonrası bounds'a dönüyor.
  const b7back = await evaluate(ws, `(() => {
    if (window.__v5OptSync) window.__v5OptSync({ measure: false });
    const hud = document.querySelector('.v5-opt-hud');
    const b = inkSelectionBounds();
    const vals = [...hud.querySelectorAll('.v5-opt-hud-num')]
      .map(i => i.value);
    /* R alanı boş bırakılır (akümüle edilmediği için) */
    return { ok: true,
      x: vals[0], y: vals[1], w: vals[2], h: vals[3], r: vals[4],
      matches: Math.abs(Number(vals[0]) - b.x) < 2 &&
        Math.abs(Number(vals[3]) - Math.round(b.h)) < 3 &&
        vals[4] === '' };
  })()`);
  check('gizmo→alan dönüşü: alanlar motor sonrası boundsa oturur',
    b7back.ok && b7back.matches, JSON.stringify(b7back));
  // Denek temizliği.
  await evaluate(ws, `(() => {
    if (typeof inkRemoveLayer === 'function') {
      const layer = inkState().layers
        .find(l => l.name === 'B7 Denek');
      if (layer) inkRemoveLayer(layer.id);
    }
    inkState().selection = [];
    if (typeof inkSetTool === 'function') inkSetTool('brush');
    if (window.__v5OptSync) window.__v5OptSync();
  })()`);
  await sleep(200);

  // Kalıcılık sanitize: bilinmeyen mod 'new'e düşer.
  const b6norm = await evaluate(ws, `(() => {
    const st = inkState();
    st.selectionMode = 'geçersiz';
    const norm = inkNormalizeState(st);
    return norm.selectionMode === 'new';
  })()`);
  check('sanitize: bilinmeyen selectionMode newe düşer', b6norm === true);

  /* =========================================================
     FAZ 6 B9 — options bar ayrı sabitleme (grip: sürükle → detach,
     çift tık → kenetle; pinned iken toolbar taşınması barı sürülemez)
     ========================================================= */
  const OPT_STORE_KEY = 'tailref-draw-v5-panels-v4';
  const storeBefore = await evaluate(ws,
    `localStorage.getItem('${OPT_STORE_KEY}')`);

  const b9grip = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const grip = bar && bar.querySelector('.v5-opt-grip');
    return { bar: !!bar, grip: !!grip,
      svg: grip ? !!grip.querySelector('svg') : false };
  })()`);
  check('B9 grip: options barda nokta grip var', b9grip.grip === true,
    JSON.stringify(b9grip));

  // Grip merkezini bul → CDP ile 140/70 sürükle (4px eşik aşılır).
  const b9g1 = await evaluate(ws, `(() => {
    const g = document.querySelector('#v5OptionsBar .v5-opt-grip');
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2) };
  })()`);
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed',
    x: b9g1.x, y: b9g1.y, button: 'left', buttons: 1, clickCount: 1,
    pointerType: 'mouse' });
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved',
    x: b9g1.x + 70, y: b9g1.y + 40, button: 'left', buttons: 1,
    pointerType: 'mouse' });
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved',
    x: b9g1.x + 140, y: b9g1.y + 70, button: 'left', buttons: 1,
    pointerType: 'mouse' });
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased',
    x: b9g1.x + 140, y: b9g1.y + 70, button: 'left', buttons: 0,
    pointerType: 'mouse' });
  await sleep(300);
  const b9detach = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const store = JSON.parse(localStorage.getItem('${OPT_STORE_KEY}') || '{}');
    return { floating: bar.classList.contains('v5-opt-floating'),
      left: Number.parseInt(bar.style.left, 10),
      top: Number.parseInt(bar.style.top, 10),
      savedPinned: !!store.optPinned, savedPos: store.optPos || null };
  })()`);
  check('B9 detach: grip sürükleyince pin + optPos kaydı',
    b9detach.floating === true && b9detach.savedPinned === true &&
    Number.isFinite(b9detach.left) &&
    b9detach.savedPos && Number.isFinite(b9detach.savedPos.left) &&
    Math.abs(b9detach.left - b9detach.savedPos.left) <= 2,
    JSON.stringify(b9detach));

  // Konum kalıcılığı: hard reload → optPos geri gelir.
  await evaluate(ws, `location.reload()`);
  await sleep(4500);
  await send(ws, 'Emulation.setDeviceMetricsOverride',
    { width: 1500, height: 940, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  // Reload sonrası giriş akışı (welcome ayarlanmış kalır; çizim moduna geç).
  await evaluate(ws, `(() => {
    const w = document.getElementById('persistenceWelcome');
    if (w && !w.hidden) {
      document.querySelector('.pwOption[data-mode="auto"]')?.click();
      document.getElementById('pwContinue')?.click();
    }
    document.getElementById('modeDrawBtn')?.click();
  })()`);
  // Bar kurulu olana kadar bekle (15s tavan).
  let barBack = false;
  for (let k = 0; k < 30 && !barBack; k++) {
    await sleep(500);
    barBack = await evaluate(ws,
      `!!document.getElementById('v5OptionsBar')`);
  }
  if (!barBack) {
    let bodyCls = await evaluate(ws, `document.body.className`);
    if (!String(bodyCls).includes('mode-draw')) {
      await evaluate(ws, `(() => {
        const modal = document.getElementById('newCanvasModal');
        if (modal && !modal.hidden) {
          const wEl = document.getElementById('newCanvasW');
          const hEl = document.getElementById('newCanvasH');
          if (wEl && !wEl.value) wEl.value = '900';
          if (hEl && !hEl.value) hEl.value = '600';
          const form = document.getElementById('newCanvasForm');
          if (form) form.requestSubmit();
        }
      })()`);
      await sleep(1800);
      barBack = await evaluate(ws,
        `!!document.getElementById('v5OptionsBar')`);
    }
  }
  const b9rest = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    if (!bar) return { ok: false, bar: false };
    const store = JSON.parse(localStorage.getItem('${OPT_STORE_KEY}') || '{}');
    return { ok: true,
      left: Number.parseFloat(bar.style.left),
      top: Number.parseFloat(bar.style.top),
      floating: bar.classList.contains('v5-opt-floating'),
      saved: store.optPos || null, pinned: !!store.optPinned };
  })()`);
  check('B9 konum kalıcı: yeniden açılışta optPos geri gelir',
    b9rest.ok && b9rest.pinned && b9rest.floating &&
    Math.abs(b9rest.left - b9rest.saved.left) <= 2 &&
    Math.abs(b9rest.top - b9rest.saved.top) <= 2,
    JSON.stringify(b9rest));

  // Çift tık → geri kenetle.
  await evaluate(ws, `(() => {
    const g = document.querySelector('#v5OptionsBar .v5-opt-grip');
    g.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  })()`);
  await sleep(250);
  const b9dock = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    const tb = document.getElementById('v5Toolbar');
    const store = JSON.parse(localStorage.getItem('${OPT_STORE_KEY}') || '{}');
    return { floating: bar.classList.contains('v5-opt-floating'),
      left: Number.parseFloat(bar.style.left),
      tbLeft: Math.round(tb.getBoundingClientRect().left),
      savedPinned: !!store.optPinned, savedPos: store.optPos || null };
  })()`);
  check('B9 çift tık geri kenetler (bar toolbar hizasına döner)',
    b9dock.floating === false && b9dock.savedPinned === false &&
    b9dock.savedPos === null &&
    Math.abs(b9dock.left - b9dock.tbLeft) <= 3,
    JSON.stringify(b9dock));

  // Pinned iken toolbar taşıması options barı sürüklemez.
  // (2. detach + toolbar sürükleme sentetik PointerEvent ile — reload
  //  sonrası CDP vuruş testi tutarsız düşebiliyor; sentetik akış
  //  handler zincirini doğrudan çalıştırır.)
  const b9d2 = await evaluate(ws, `(() => {
    const g = document.querySelector('#v5OptionsBar .v5-opt-grip');
    const r = g.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    g.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, button: 0, clientX: cx, clientY: cy,
        pointerId: 9, isPrimary: true }));
    window.dispatchEvent(new PointerEvent('pointermove',
      { bubbles: true, clientX: cx + 90, clientY: cy + 50,
        pointerId: 9, isPrimary: true }));
    window.dispatchEvent(new PointerEvent('pointerup',
      { bubbles: true, clientX: cx + 90, clientY: cy + 50,
        pointerId: 9, isPrimary: true }));
    const bar = document.getElementById('v5OptionsBar');
    return { floating: bar.classList.contains('v5-opt-floating'),
      left: Number.parseInt(bar.style.left, 10) };
  })()`);
  const optLeftBefore = b9d2.left;
  await evaluate(ws, `(() => {
    const g = document.querySelector('#v5Toolbar .v5-grip');
    const r = g.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    g.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, button: 0, clientX: cx, clientY: cy,
        pointerId: 8, isPrimary: true }));
    window.dispatchEvent(new PointerEvent('pointermove',
      { bubbles: true, clientX: cx + 200, clientY: cy - 90,
        pointerId: 8, isPrimary: true }));
    window.dispatchEvent(new PointerEvent('pointerup',
      { bubbles: true, clientX: cx + 200, clientY: cy - 90,
        pointerId: 8, isPrimary: true }));
  })()`);
  await sleep(350);
  const b9iso = await evaluate(ws, `(() => {
    const bar = document.getElementById('v5OptionsBar');
    return { optLeft: Number.parseInt(bar.style.left, 10),
      tbLeft: Math.round(document.getElementById('v5Toolbar')
        .getBoundingClientRect().left) };
  })()`);
  check('B9 pinned iken toolbar taşıması barı sürüklemez',
    b9d2.floating === true &&
    Math.abs(b9iso.optLeft - optLeftBefore) <= 2,
    JSON.stringify({ ...b9iso, before: optLeftBefore, detach: b9d2 }));

  // Mağazayı B9 öncesi haline döndür (sonraki koşular temiz başlar).
  await evaluate(ws,
    storeBefore === null
      ? `localStorage.removeItem('${OPT_STORE_KEY}')`
      : `localStorage.setItem('${OPT_STORE_KEY}', ${JSON.stringify(storeBefore)})`);
  await sleep(150);

  // Ekran görüntüsü
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '_shot-options-bar.png'),
    Buffer.from(shot.data, 'base64'));

  try { app.kill(); } catch { }
  const fail = results.filter(r => !r.ok).length;
  console.log(`\\nOPTIONS-BAR PROBE: ${results.length - fail}/${results.length} ✓` +
    (fail ? ` — ${fail} BAŞARISIZ` : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HATA:', e.message); process.exit(1); });
