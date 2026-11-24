'use strict';

/* KALICI KAPI · Ayarlar hub tam doğrulama (Faz 8 — TODO-ayarlar.md).
   tmp-settings-visual.js'in kalıcılaştırılmış kopyasıdır: iki panel
   Ayarlar'ın kategori gezinmesi + kontrol kanalları + kısayol
   özelleştirmesi (Faz 4b.1) + ayar araması (Faz 5) + tercih yedeği
   round-trip (Faz 6). Ekran görüntüleri temp klasöre gider.
   tmp-settings-visual.js geliştirme sırasında düzenlenir; kapıya
   alınan kontroller buraya aynalanır. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9338;
const APP_PORT = 5203;
const SHOT_DIR = path.join(os.tmpdir(), 'tailref-hub-shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function electronPath() {
  const found = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!fs.existsSync(found)) throw new Error('electron bulunamadı');
  return found;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 15000);
});

const send = (ws, method, params) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});

async function waitForTarget(deadlineMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz hazır değil */ }
    await sleep(400);
  }
  throw new Error('uygulama hata ayıklama portu açılmadı');
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-setvis-'));
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  let ws = null;
  let pass = 0, fail = 0;
  const errors = [];
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    fs.rmSync(SHOT_DIR, { recursive: true, force: true });
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    const page = await waitForTarget();
    ws = await connect(page.webSocketDebuggerUrl);
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      }
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

    const ready = Date.now() + 25000;
    let isReady = false;
    while (Date.now() < ready) {
      try {
        isReady = await evaluate(ws, "typeof state !== 'undefined' && !!document.querySelector('#settings')");
        if (isReady) break;
      } catch { /* henüz değil */ }
      await sleep(500);
    }
    if (!isReady) throw new Error('renderer hazır olmadı');

    /* Karşılama diyaloğu: güvenli kapat (desktop-smoke kalıbı). */
    for (let i = 0; i < 20; i++) {
      const seen = JSON.parse(await evaluate(ws, `(function () {
        const el = document.getElementById('persistenceWelcome');
        return !!(el && !el.hidden);
      })()`));
      if (seen) {
        await evaluate(ws, `(function () {
          if (typeof setPersistenceMode === 'function') setPersistenceMode('auto');
          else localStorage.setItem('tailref-persistence', 'auto');
          const el = document.getElementById('persistenceWelcome');
          if (el) el.hidden = true;
          return 'ok';
        })()`);
        break;
      }
      await sleep(400);
    }
    await sleep(300);

    /* Türkçe arayüzde doğrula (kullanıcının dili). */
    await evaluate(ws, `(() => { try { if (window.L10N) window.L10N.setLang('tr'); } catch { } return true; })()`);
    await sleep(400);

    /* ⋯ düğmesi (#btnOverflow) ile aç — gerçek kapı settingsHubToggle. */
    await evaluate(ws, `document.getElementById('btnOverflow').click()`);
    await sleep(600);

    const opened = JSON.parse(await evaluate(ws, `(() => {
      const panel = document.getElementById('settings');
      const nav = document.querySelectorAll('#settingsNav .settingsNavItem');
      const selected = document.querySelector('#settingsNav .settingsNavItem[aria-selected="true"]');
      return JSON.stringify({
        visible: !!(panel && !panel.hidden),
        navCount: nav.length,
        selectedCat: selected ? selected.dataset.cat : null,
        desc: (document.getElementById('settingsCatDesc') || {}).textContent || '',
      });
    })()`));
    check('⋯ düğmesi ile panel açıldı', opened.visible);
    check('nav 13 kategori (Faz 5: Interface eklendi)', opened.navCount === 13, String(opened.navCount));
    check('başlangıç kategorisi General', opened.selectedCat === 'general', opened.selectedCat || 'yok');
    check('kategori açıklaması dolu', opened.desc.length > 10, opened.desc.slice(0, 60));

    /* 8 kategori: aria-selected + sayfa + açıklama + ekran görüntüsü. */
    const cats = ['general', 'appearance', 'performance', 'drawing', 'reference', 'pose3d', 'shortcuts', 'storage'];
    const descs = {};
    for (const cat of cats) {
      await evaluate(ws, `(() => {
        const item = document.querySelector('#settingsNav .settingsNavItem[data-cat="${cat}"]');
        if (item) item.click();
        return !!item;
      })()`);
      await sleep(250);
      const state = JSON.parse(await evaluate(ws, `(() => {
        const cat = '${cat}';
        const item = document.querySelector('#settingsNav .settingsNavItem[data-cat="' + cat + '"]');
        const pageEl = document.querySelector('#settings .settingsPage[data-page="' + cat + '"]');
        /* Görünürlük = hesaplanmış display; .settingsPage{display:flex} [hidden]
           UA kuralını ezebildiği için öznitelik tek başına yeterli değil. */
        const others = [...document.querySelectorAll('#settings .settingsPage')]
          .filter(p => p.dataset.page !== cat && getComputedStyle(p).display !== 'none');
        return JSON.stringify({
          selected: item ? item.getAttribute('aria-selected') === 'true' : false,
          pageVisible: !!(pageEl && getComputedStyle(pageEl).display !== 'none'),
          strayPages: others.length,
          desc: (document.getElementById('settingsCatDesc') || {}).textContent || '',
        });
      })()`));
      descs[cat] = state.desc;
      check(`kategori ${cat}: nav seçili + sayfa görünür`,
        state.selected && state.pageVisible && state.strayPages === 0 && state.desc.length > 10,
        `seçili=${state.selected} sayfa=${state.pageVisible} artıkSayfa=${state.strayPages}`);
      const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, cat + '.png'), Buffer.from(shot.data, 'base64'));
    }

    /* Açıklama metinleri kategoriye göre değişmeli. */
    const uniqueDescs = new Set(Object.values(descs));
    check('her kategori açıklaması farklı', uniqueDescs.size === cats.length, `${uniqueDescs.size}/${cats.length}`);

    /* Tuş rehberi Ayarlar > Kısayollar düğmesinden AÇILMALI: panel açıkken
       gövdeye eklenen ilgisiz sınıflar (studio-panel-open vb.) kartı hemen
       kapatıyordu; kart ayrıca ayar penceresiyle üst üste binmemeli. */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="shortcuts"]').click()`);
    await sleep(250);
    const keyHelp = JSON.parse(await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const panel = document.getElementById('inkKeyHelp');
      const settings = document.getElementById('settings');
      document.getElementById('btnSettingsKeyHelp').click();
      await sleep(200);
      const card = panel.querySelector('.kkCard');
      const cr = card ? card.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const sr = settings.getBoundingClientRect();
      const overlaps = cr.width > 0 && cr.left < sr.right && cr.right > sr.left &&
        cr.top < sr.bottom && cr.bottom > sr.top;
      const inside = cr.left >= -1 && cr.top >= -1 &&
        cr.right <= innerWidth + 1 && cr.bottom <= innerHeight + 1;
      const topEl = cr.width > 0
        ? document.elementFromPoint(cr.left + cr.width / 2, cr.top + 22) : null;
      const opened = { hidden: panel.hidden, overlaps, inside,
        onTop: !!(topEl && topEl.closest && topEl.closest('#inkKeyHelp')) };
      document.getElementById('inkKeyHelpClose').click();
      await sleep(120);
      const closed = panel.hidden;
      document.getElementById('btnSettingsKeyHelp').click();
      await sleep(160);
      const reopened = !panel.hidden;
      document.getElementById('inkKeyHelpClose').click();
      await sleep(80);
      return JSON.stringify({ opened, closed, reopened,
        rect: [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width)],
        settings: [Math.round(sr.left), Math.round(sr.top)] });
    })()`));
    check('Ayarlar > Kısayollar tuş rehberini açıyor (açık panel kapatmıyor)',
      !keyHelp.opened.hidden && keyHelp.opened.inside && keyHelp.opened.onTop,
      `gizli=${keyHelp.opened.hidden} içeride=${keyHelp.opened.inside} üstte=${keyHelp.opened.onTop}`);
    check('tuş rehberi ayar penceresiyle çakışmıyor',
      !keyHelp.opened.overlaps,
      `kart=${keyHelp.rect.join(',')} ayarlar=${keyHelp.settings.join(',')}`);
    check('tuş rehberi kapatılıp yeniden açılabiliyor',
      keyHelp.closed && keyHelp.reopened,
      `kapat=${keyHelp.closed} yeniden=${keyHelp.reopened}`);

    /* Kategori geçişi kontrol değerini bozmuyor: dil seçimini değiştir,
       başka kategoriye geç, geri dön — değer korunmalı. */
    await evaluate(ws, `(() => {
      const sel = document.getElementById('settingsLanguageSelect');
      sel.value = 'de';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="appearance"]').click()`);
    await sleep(200);
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="general"]').click()`);
    await sleep(200);
    const langAfter = await evaluate(ws, `document.getElementById('settingsLanguageSelect').value`);
    check('kategori geçişi kontrol değerini bozmuyor', langAfter === 'de', `dil=${langAfter}`);

    /* Dil tercihi kalıcı mı (localStorage). */
    const langSaved = await evaluate(ws, `localStorage.getItem('tailref-lang')`);
    check('dil tercihi kaydedildi', langSaved === 'de', String(langSaved));
    /* temizle: tr'ye dön */
    await evaluate(ws, `(() => { const sel = document.getElementById('settingsLanguageSelect'); sel.value = 'tr'; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(300);

    /* ---- FAZ 2 · Appearance: accent + density ---- */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="appearance"]').click()`);
    await sleep(250);
    const accent = JSON.parse(await evaluate(ws, `(() => {
      const row = document.getElementById('settingsAccentRow');
      const swatches = row ? row.querySelectorAll('.settingsAccentSwatch') : [];
      const first = swatches[0];
      if (first) first.click();
      return JSON.stringify({
        count: swatches.length,
        accentVar: document.documentElement.style.getPropertyValue('--accent').trim(),
        inkVar: document.documentElement.style.getPropertyValue('--accent-ink').trim(),
        saved: localStorage.getItem('tailref-accent'),
        pressed: first ? first.getAttribute('aria-pressed') : null,
      });
    })()`));
    check('accent swatch seçimi --accent override', accent.count === 13
      && accent.accentVar && accent.saved && accent.pressed === 'true',
      `${accent.count} renk · accent=${accent.accentVar} ink=${accent.inkVar}`);

    /* accent'in UI'da gerçekten kullanıldığını doğrula: nav seçili arka planı
       accent karışımı olmalı (getComputedStyle --accent override'ı döndürür). */
    const accentUsed = await evaluate(ws, `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`);
    check('accent override hesaplamada görünür', accentUsed === accent.saved, `${accentUsed}`);

    const accentReset = JSON.parse(await evaluate(ws, `(() => {
      const row = document.getElementById('settingsAccentRow');
      const def = row.querySelector('.settingsAccentSwatch[data-role="default"]');
      def.click();
      return JSON.stringify({
        accentVar: document.documentElement.style.getPropertyValue('--accent').trim(),
        saved: localStorage.getItem('tailref-accent'),
      });
    })()`));
    check('"Temaya dön" accent override kaldırıyor', !accentReset.accentVar && !accentReset.saved,
      `accent="${accentReset.accentVar}" saved=${accentReset.saved}`);

    await evaluate(ws, `(() => {
      const sel = document.getElementById('settingsDensitySelect');
      sel.value = 'compact';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    /* zoom offsetHeight'ı etkilemez; final görsel boyut için rect kullan. */
    await sleep(600);
    const barHCompact = await evaluate(ws, `document.getElementById('bar').getBoundingClientRect().height`);
    const densityRoot = await evaluate(ws, `document.documentElement.dataset.density || ''`);
    await evaluate(ws, `(() => {
      const sel = document.getElementById('settingsDensitySelect');
      sel.value = 'normal';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(600);
    const barHNormal = await evaluate(ws, `document.getElementById('bar').getBoundingClientRect().height`);
    const density = { root: densityRoot, barH: barHCompact, barH2: barHNormal };
    check('density compact bar yüksekliğini değiştiriyor',
      density.root === 'compact' && density.barH < density.barH2,
      `bar: ${density.barH2} → ${density.barH}px`);

    /* ---- UI ölçeği: webFrame zoom (fizibilite 13/13 kanıtlı) ---- */
    const uiScale = JSON.parse(await evaluate(ws, `(() => {
      const sel = document.getElementById('settingsUiScaleSelect');
      const hasApi = !!(window.tailref && typeof window.tailref.setZoomFactor === 'function');
      if (!hasApi || !sel) return JSON.stringify({ hasApi, sel: !!sel });
      sel.value = '1.25';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.stringify({ hasApi, sel: true, zoom: window.tailref.getZoomFactor(), saved: localStorage.getItem('tailref-ui-scale') });
    })()`));
    check('UI scale 125% webFrame zoom uyguluyor', uiScale.hasApi && uiScale.zoom === 1.25,
      `zoom=${uiScale.zoom} saved=${uiScale.saved}`);
    const uiScaleBack = await evaluate(ws, `(() => {
      const sel = document.getElementById('settingsUiScaleSelect');
      sel.value = '1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.stringify({ zoom: window.tailref.getZoomFactor(), saved: localStorage.getItem('tailref-ui-scale') });
    })()`);
    const backScale = JSON.parse(uiScaleBack);
    check('UI scale %100 geri döndü', backScale.zoom === 1 && backScale.saved === '1',
      `zoom=${backScale.zoom} saved=${backScale.saved}`);

    /* ---- UI ölçeği küçük adımlar (15 Kasım 2026): %85/90/95 ---- */
    const uiScaleSmall = JSON.parse(await evaluate(ws, `(async () => {
      const sel = document.getElementById('settingsUiScaleSelect');
      const opts = [...sel.options].map(o => o.value).sort();
      const out = {};
      for (const v of ['0.85', '0.9', '0.95']) {
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 60));
        out[v] = window.tailref.getZoomFactor();
      }
      sel.value = '1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 60));
      out.back = window.tailref.getZoomFactor();
      return JSON.stringify({ opts, ...out });
    })()`));
    check('UI scale %85/%90/%95 seçenekleri gerçek zoom',
      uiScaleSmall['0.85'] === 0.85 && uiScaleSmall['0.9'] === 0.9 && uiScaleSmall['0.95'] === 0.95
      && uiScaleSmall.back === 1 && uiScaleSmall.opts.join(',') === '0.85,0.9,0.95,1,1.1,1.25',
      `zoom: ${uiScaleSmall['0.85']}/${uiScaleSmall['0.9']}/${uiScaleSmall['0.95']} geri=${uiScaleSmall.back}`);

    /* ---- Footer sağ uç (15 Kasım 2026): Kaydet + Tüm ayarları sıfırla ---- */
    const footerBtns = JSON.parse(await evaluate(ws, `(async () => {
      const foot = document.querySelector('#settings .settingsFoot');
      const save = document.getElementById('btnSettingsSave');
      const reset = document.getElementById('btnSettingsResetAll');
      if (!foot || !save || !reset) return JSON.stringify({ ok: false });
      const fr = foot.getBoundingClientRect();
      const sr = save.getBoundingClientRect();
      const rr = reset.getBoundingClientRect();
      /* Kaydet → diyalogsuz dosya yazımı (test profili). */
      save.click();
      await new Promise(r => setTimeout(r, 1200));
      const fileOk = window.tailref && typeof window.tailref.loadPreferencesAuto === 'function'
        ? !!(await window.tailref.loadPreferencesAuto()).ok : false;
      return JSON.stringify({ ok: true, fileOk,
        rightAligned: rr.right <= fr.right + 2 && sr.right < rr.right,
        resetLabel: reset.textContent });
    })()`));
    check('Footer Kaydet sağ uçta + diske sessiz yazdı',
      footerBtns.ok && footerBtns.fileOk && footerBtns.rightAligned,
      `fileOk=${footerBtns.fileOk} sağa yaslı=${footerBtns.rightAligned}`);
    check('Footer "Tüm ayarları sıfırla" düğmesi mevcut',
      footerBtns.ok && (/reset all settings/i.test(footerBtns.resetLabel) || /tüm ayarları sıfırla/i.test(footerBtns.resetLabel)),
      footerBtns.resetLabel || '');

    /* ---- Ayarlar paneli konum kırpma (clamp, 15 Kasım 2026) ---- */
    const clampCheck = await (async () => {
      await evaluate(ws, `localStorage.setItem('tailref-floating-settings', JSON.stringify({ left: 5, top: 200, width: 760, height: 520 }))`);
      await evaluate(ws, `(function(){ const b = document.getElementById('btnSettingsClose');
        if (b) b.click(); else document.getElementById('settings').hidden = true; })()`);
      await sleep(300);
      await evaluate(ws, `document.getElementById('btnOverflow').click()`);
      await sleep(700);
      const r = JSON.parse(await evaluate(ws, `(function () {
        const p = document.getElementById('settings');
        const b = p.getBoundingClientRect();
        return JSON.stringify({ left: Math.round(b.left), w: Math.round(b.width), vw: innerWidth });
      })()`));
      await evaluate(ws, `localStorage.removeItem('tailref-floating-settings')`);
      return r;
    })();
    check('Panel sola gömülü bozuk kayıtla bile pencere içinde açılıyor',
      clampCheck.left >= 8 && clampCheck.left + clampCheck.w <= clampCheck.vw - 8,
      `left=${clampCheck.left} w=${clampCheck.w} vw=${clampCheck.vw}`);

    /* ---- Fırça imleci: gerçek okuma kapısı (15 Kasım 2026) ---- */
    const brushCursor = JSON.parse(await evaluate(ws, `(function () {
      const s = document.getElementById('settingsBrushCursorSelect');
      if (!s) return JSON.stringify({ ok: false });
      s.value = 'cross';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      const saved = localStorage.getItem('tailref-brush-cursor');
      const fn = typeof inkEditorBrushCursorMode;
      s.value = 'ring';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.stringify({ ok: true, saved, fn });
    })()`));
    check('Fırça imleci: seçim kalıcı + okuma fonksiyonu var',
      brushCursor.ok && brushCursor.saved === 'cross' && brushCursor.fn === 'function',
      `saved=${brushCursor.saved} fn=${brushCursor.fn}`);

    /* ---- Tooltip pill kanalı: native title kırpığı yasak (15 Kasım 2026) ---- */
    const tipChannel = JSON.parse(await evaluate(ws, `(function () {
      let cssOk = false;
      for (const sheet of document.styleSheets) {
        try { for (const r of sheet.cssRules) {
          if (r.selectorText === '#settings button[data-tooltip]:not(.settingToggleBtn)::after') cssOk = true;
        } } catch {}
      }
      const btn = document.getElementById('settingsPose3dReset');
      return JSON.stringify({ cssOk,
        noTitle: btn ? !btn.hasAttribute('title') : null,
        hasDt: btn ? !!btn.getAttribute('data-tooltip') : null });
    })()`));
    check('Tooltip kanalı: title yok, data-tooltip + #settings sağ çapa CSS',
      tipChannel.cssOk && tipChannel.noTitle === true && tipChannel.hasDt === true,
      JSON.stringify(tipChannel));

    /* ---- FAZ 2b · toggle topuzu ----
       Genel `button[data-tooltip]::after` kuralı (daha yüksek özgüllük)
       switch topuzunu ezip düğmeyi boş gösteriyordu; topuz ::after'da
       kalmalı, tooltip toggle'larda ::before'a taşınmalı. */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="drawing"]').click()`);
    await sleep(250);
    const toggleKnob = JSON.parse(await evaluate(ws, `(() => {
      const el = document.getElementById('settingsPanelsHide');
      if (!el) return JSON.stringify({ missing: true });
      const a = getComputedStyle(el, '::after');
      const b = getComputedStyle(el, '::before');
      return JSON.stringify({
        w: a.width, h: a.height, bg: a.backgroundColor,
        afterText: (a.content || '').replace(/"/g, ''),
        tipDisplay: b.display,
      });
    })()`));
    check('Toggle topuzu: data-tooltip switch\'te ::after topuz olarak kalır',
      toggleKnob.w === '15px' && toggleKnob.h === '15px'
        && toggleKnob.bg !== 'rgba(0, 0, 0, 0)' && toggleKnob.bg !== 'transparent'
        && toggleKnob.afterText === '' && toggleKnob.tipDisplay === 'none',
      JSON.stringify(toggleKnob));

    /* ---- FAZ 3 · 3D Pose: üç eylem gerçek yetenek ---- */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="pose3d"]').click()`);
    await sleep(250);
    const poseBtns = JSON.parse(await evaluate(ws, `(() => JSON.stringify({
      guide: !!document.getElementById('settingsPoseGuide'),
      stack: !!document.getElementById('btnPoseStackReset'),
      scene: !!document.getElementById('settingsPose3dReset'),
      stackApi: typeof window.tailrefPoseStackReset,
      sceneApi: typeof window.tailrefPose3dEverything,
    }))()`));
    check('3D Pose: üç eylem düğmesi mevcut',
      poseBtns.guide && poseBtns.stack && poseBtns.scene,
      `guide=${poseBtns.guide} stack=${poseBtns.stack} scene=${poseBtns.scene}`);
    const poseGuide = JSON.parse(await evaluate(ws, `(() => {
      document.getElementById('settingsPoseGuide').click();
      const dlg = document.getElementById('poseGuide');
      const opened = !!(dlg && !dlg.hidden);
      if (dlg) dlg.hidden = true;
      return JSON.stringify({ opened, seen: localStorage.getItem('tailref-pose3d-guide-seen') });
    })()`));
    check('3D rehber düğmesi rehberi gerçekten açıyor', poseGuide.opened === true,
      `seen=${poseGuide.seen}`);
    /* Panel sıfırlama: API yoksa localStorage geri düşüşü de gerçektir. */
    const stackBefore = JSON.parse(await evaluate(ws, `JSON.stringify({
      v2: localStorage.getItem('tailref-pose-stack-v2'),
      v1: localStorage.getItem('tailref-pose-stack-v1') })`));
    await evaluate(ws, `document.getElementById('btnPoseStackReset').click()`);
    await sleep(200);
    const stackAfter = JSON.parse(await evaluate(ws, `JSON.stringify({
      v2: localStorage.getItem('tailref-pose-stack-v2'),
      v1: localStorage.getItem('tailref-pose-stack-v1') })`));
    check('3D panel sıfırlama anahtarları temizliyor',
      stackAfter.v2 === null && stackAfter.v1 === null,
      `önce v2=${stackBefore.v2 ? 'var' : 'yok'} → sonra v2=${stackAfter.v2 === null ? 'yok' : 'var'}`);

    /* ---- FAZ 4 · Advanced: teşhis köprüsü + GPU bilgisi ---- */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="advanced"]').click()`);
    await sleep(250);
    const diag = JSON.parse(await evaluate(ws, `(() => {
      const btn = document.getElementById('settingsPerfDiag');
      const api = typeof window.tailrefPerfDiagToggle;
      btn.click();
      const panel = document.getElementById('perfDiag');
      const on = !!(panel && panel.dataset.on === 'true');
      const pressed = btn.getAttribute('aria-pressed');
      btn.click();
      const off = panel ? panel.dataset.on === 'false' : null;
      const gpu = document.getElementById('settingsGpuInfo').textContent;
      return JSON.stringify({ api, on, pressed, off, gpu: gpu && gpu !== '–' ? gpu : '' });
    })()`));
    check('teşhis köprüsü gerçek paneli açıp kapatıyor',
      diag.api === 'function' && diag.on && diag.pressed === 'true' && diag.off === true,
      `api=${diag.api} açık=${diag.on} kapandı=${diag.off}`);
    check('GPU birimi gerçek donanım bilgisi', !!diag.gpu, diag.gpu.slice(0, 60));

    /* ---- FAZ 4 · About: yapı damgası + motor ---- */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="about"]').click()`);
    await sleep(400);
    const about = JSON.parse(await evaluate(ws, `(async () => {
      const build = document.getElementById('settingsAboutBuild').textContent;
      const engine = document.getElementById('settingsAboutEngine').textContent;
      let stampApi = null;
      try { stampApi = await window.tailref.getBuildStamp(); } catch { stampApi = 'HATA'; }
      return JSON.stringify({ build, engine, stampApi });
    })()`));
    check('About: yapı damgası IPC ile geliyor', about.build && about.build !== '–',
      `build="${about.build}" ipc="${about.stampApi}"`);
    check('About: motor sürümleri (Electron/Chrome)', /Electron\//.test(about.engine),
      about.engine);

    /* ---- FAZ 4b · Shortcuts: çizim kısayol özelleştirmesi (tek kaynak) ---- */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="shortcuts"]').click()`);
    await sleep(300);
    const shortcutsUi = JSON.parse(await evaluate(ws, `(() => {
      const box = document.getElementById('settingsInkShortcuts');
      const rows = box ? box.querySelectorAll('.inkWsShortcutRow').length : 0;
      const brush = box ? box.querySelector('[data-ws-shortcut="toolBrush"]') : null;
      return JSON.stringify({ rows, brushLabel: brush ? brush.textContent : '' });
    })()`));
    check('Shortcuts: çizim kısayol listesi render edildi', shortcutsUi.rows === 18,
      `satır=${shortcutsUi.rows} fırça=${shortcutsUi.brushLabel}`);

    /* Gerçek yakalama akışı: düğmeye tıkla → tuş gönder → state + kalıcılık. */
    const beforeBrush = await evaluate(ws, `inkWorkspaceUi.state.shortcuts.toolBrush`);
    const capture = JSON.parse(await evaluate(ws, `(async () => {
      const box = document.getElementById('settingsInkShortcuts');
      const btn = box.querySelector('[data-ws-shortcut="toolBrush"]');
      btn.click();
      const capturing = btn.className.includes('is-capturing');
      await new Promise(r => setTimeout(r, 100));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      const saved = JSON.parse(localStorage.getItem('tailref-ink-workspace-v1') || '{}');
      return JSON.stringify({
        capturing,
        state: inkWorkspaceUi.state.shortcuts.toolBrush,
        persisted: saved.shortcuts && saved.shortcuts.toolBrush,
        label: box.querySelector('[data-ws-shortcut="toolBrush"]').textContent,
      });
    })()`));
    check('Shortcuts: tuş yakalama gerçek çalışıyor',
      capture.state === 'k' && capture.persisted === 'k' && capture.label === 'K',
      `b=${beforeBrush} → state=${capture.state} kayıt=${capture.persisted} etiket=${capture.label}`);

    /* Geri al: yakalamayı tekrar başlat, eski tuşa döndür. */
    const restore = JSON.parse(await evaluate(ws, `(async () => {
      const box = document.getElementById('settingsInkShortcuts');
      box.querySelector('[data-ws-shortcut="toolBrush"]').click();
      await new Promise(r => setTimeout(r, 100));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      return JSON.stringify({ state: inkWorkspaceUi.state.shortcuts.toolBrush });
    })()`));
    check('Shortcuts: eski tuşa geri döndü', restore.state === beforeBrush,
      `state=${restore.state}`);

    /* ---- FAZ 5 · Ayar arama: dizin + gerçek arama + satıra atlama ---- */
    const searchUi = JSON.parse(await evaluate(ws, `(() => {
      const input = document.getElementById('settingsSearch');
      const box = document.getElementById('settingsSearchResults');
      return JSON.stringify({ hasInput: !!input, hasBox: !!box, ph: input ? input.placeholder : '' });
    })()`));
    check('Arama: kutu + sonuç listesi DOM\'da', searchUi.hasInput && searchUi.hasBox,
      `input=${searchUi.hasInput} box=${searchUi.hasBox} ph="${searchUi.ph}"`);

    /* Gerçek arama: sorguyu sayfada çeviriden hesapla (dile agnostik) —
       "Reduce motion" etiketi hangi dildeyse o metin dizinde var. */
    const searchRun = JSON.parse(await evaluate(ws, `(async () => {
      const input = document.getElementById('settingsSearch');
      const q = (window.L10N && L10N.t('Reduce motion') || 'Reduce motion').trim().toLowerCase();
      input.value = q;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      const box = document.getElementById('settingsSearchResults');
      const hits = box ? box.querySelectorAll('.settingsSearchResult').length : -1;
      const texts = box ? Array.from(box.querySelectorAll('.settingsSearchResult b')).map(b => b.textContent) : [];
      return JSON.stringify({ q, hits, texts: texts.slice(0, 4) });
    })()`));
    check('Arama: "Reduce motion" sorgusu sonuç buldu', searchRun.hits > 0,
      `sorgu="${searchRun.q}" sonuç=${searchRun.hits} → ${searchRun.texts.join(' | ')}`);

    /* Sonuç tıklanınca kategoriye gidip satırı vurgulamalı.
       (Kategori sonucu satırsızdır; vurgu için SATIR sonucunu tıklarız —
       önce kategori sonucunu tıklayıp kategori atlama kanalını da doğrularız.) */
    const searchJump = JSON.parse(await evaluate(ws, `(async () => {
      const box = document.getElementById('settingsSearchResults');
      const results = box.querySelectorAll('.settingsSearchResult');
      const catHit = results[0];                       /* kategori sonucu */
      catHit.click();
      await new Promise(r => setTimeout(r, 250));
      const active = document.querySelector('#settingsNav .settingsNavItem[aria-selected="true"]');
      const hiddenCat = document.getElementById('settingsSearchResults').hidden;
      /* Listeyi yeniden aç: sorguyu tekrar yaz → satır sonucunu tıkla → vurgu beklenir. */
      const input = document.getElementById('settingsSearch');
      input.value = (window.L10N && L10N.t('Reduce motion') || 'Reduce motion').trim().toLowerCase();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      const box2 = document.getElementById('settingsSearchResults');
      const results2 = box2.querySelectorAll('.settingsSearchResult');
      let rowHit = null;
      for (const r of results2) { if (r.querySelector('b').textContent !== (window.L10N ? L10N.t('Accessibility') : 'Accessibility')) { rowHit = r; break; } }
      if (!rowHit) rowHit = results2[results2.length - 1];
      rowHit.click();
      await new Promise(r => setTimeout(r, 400));
      const flash = document.querySelector('.settingsSearchHit');
      return JSON.stringify({ cat: active ? active.dataset.cat : '', hiddenCat, flash: !!flash });
    })()`));
    check('Arama: sonuç tıklaması kategoriye attı + satır vurgusu',
      searchJump.hiddenCat && searchJump.flash && !!searchJump.cat,
      `kategori=${searchJump.cat} liste kapandı=${searchJump.hiddenCat} vurgu=${searchJump.flash}`);

    /* Boş sorgu + kaçış: liste temizlenir. */
    const searchEsc = JSON.parse(await evaluate(ws, `(async () => {
      const input = document.getElementById('settingsSearch');
      input.value = 'zzz-yok-olan-ayar';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      const box = document.getElementById('settingsSearchResults');
      const emptyShown = !box.hidden && box.querySelector('.settingsSearchEmpty') !== null;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      return JSON.stringify({ emptyShown, clearedAfterEsc: box.hidden && input.value === '' });
    })()`));
    check('Arama: boş sonuç notu + Escape temizliği',
      searchEsc.emptyShown && searchEsc.clearedAfterEsc,
      `boş notu=${searchEsc.emptyShown} escape temizledi=${searchEsc.clearedAfterEsc}`);

    /* ---- FAZ 6 · Preferences backup: whitelist + round-trip ---- */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="general"]').click()`);
    await sleep(300);
    const prefsUi = JSON.parse(await evaluate(ws, `(() => {
      const be = document.getElementById('btnPrefsExport');
      const bi = document.getElementById('btnPrefsImport');
      const br = document.getElementById('btnPrefsReset');
      return JSON.stringify({ be: !!be, bi: !!bi, br: !!br, bound: !!(be && be.dataset.prefsBound) });
    })()`));
    check('Tercih yedeği: üç eylem düğmesi bağlandı',
      prefsUi.be && prefsUi.bi && prefsUi.br && prefsUi.bound,
      `export=${prefsUi.be} import=${prefsUi.bi} reset=${prefsUi.br} bound=${prefsUi.bound}`);

    /* Whitelist: veri anahtarları ('workspace', 'ink:library') ve yabancı
       anahtarlar ('evil-key') dışlanmalı; tailref-* içermeli. */
    const prefsKeys = JSON.parse(await evaluate(ws, `(() => {
      localStorage.setItem('workspace', 'VERI');
      localStorage.setItem('ink:library', 'VERI2');
      localStorage.setItem('evil-key', 'X');
      const ks = settingsPrefsKeys();
      return JSON.stringify({
        n: ks.length,
        hasWorkspace: ks.includes('workspace'),
        hasLibrary: ks.includes('ink:library'),
        hasEvil: ks.includes('evil-key'),
        hasTailref: ks.some(k => k.indexOf('tailref-') === 0),
      });
    })()`));
    check('Tercih yedeği: whitelist veri/yabancı anahtarları dışlar',
      prefsKeys.hasTailref && !prefsKeys.hasWorkspace && !prefsKeys.hasLibrary && !prefsKeys.hasEvil && prefsKeys.n > 10,
      `n=${prefsKeys.n} workspace=${prefsKeys.hasWorkspace} library=${prefsKeys.hasLibrary} evil=${prefsKeys.hasEvil} tailref=${prefsKeys.hasTailref}`);

    /* Round-trip (reload'suz): build → apply(tema değişimi) → doğrulama
       reddi (kind/version yabancı anahtar) → clear → geri yükleme. */
    const prefsRound = JSON.parse(await evaluate(ws, `(() => {
      const before = settingsPrefsBuild();
      const data2 = Object.assign({}, before.data);
      data2['tailref-theme'] = 'paper';
      const apply1 = settingsPrefsApply({ kind: 'tailref-preferences', version: 1, data: data2 });
      const themeNow = localStorage.getItem('tailref-theme');
      const evil = settingsPrefsApply({ kind: 'tailref-preferences', version: 1, data: { 'evil-key': 'Z', 'workspace': 'W' } });
      const evilNow = localStorage.getItem('evil-key');
      const badVersion = settingsPrefsApply({ kind: 'tailref-preferences', version: 9, data: {} }).ok;
      const badKind = settingsPrefsApply({ kind: 'yabanci', version: 1, data: {} }).ok;
      settingsPrefsClear();
      const afterClear = settingsPrefsKeys().length;
      const restored = settingsPrefsApply(before);
      const themeBack = localStorage.getItem('tailref-theme');
      localStorage.removeItem('evil-key');
      localStorage.removeItem('workspace');
      localStorage.removeItem('ink:library');
      const origTheme = Object.prototype.hasOwnProperty.call(before.data, 'tailref-theme') ? before.data['tailref-theme'] : null;
      return JSON.stringify({ count: before.count, apply1: apply1.ok, themeNow, evilNow: evilNow,
        evilUntouched: evilNow === 'X', badVersion, badKind, afterClear,
        restoredCount: restored.count, themeBack,
        themeRestored: themeBack === origTheme });
    })()`));
    check('Tercih yedeği: round-trip + whitelist savunması + doğrulama reddi',
      prefsRound.apply1 && prefsRound.themeNow === 'paper' && prefsRound.evilUntouched &&
        !prefsRound.badVersion && !prefsRound.badKind && prefsRound.afterClear === 0 &&
        prefsRound.restoredCount === prefsRound.count && prefsRound.themeRestored,
      `n=${prefsRound.count} tema=${prefsRound.themeNow}→temizle→${prefsRound.themeBack} ` +
        `evil=${prefsRound.evilNow} kötüSürüm=${prefsRound.badVersion} kötüTür=${prefsRound.badKind} ` +
        `temizSonra=${prefsRound.afterClear} geriYükleme=${prefsRound.restoredCount}`);

    /* ---- Sektör standardı ayarlar (15 Kasım): tekerlek + undo sınırı +
       fırça imleci — gerçek UI etkileşimiyle localStorage kalıcılığı ---- */
    const sector = JSON.parse(await evaluate(ws, `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const navTo = (cat) => document.querySelector('#settingsNav .settingsNavItem[data-cat="' + cat + '"]').click();
      const out = {};
      /* Tekerlek: General sayfasında iki aç/kapa. */
      navTo('general'); await wait(150);
      const wz = document.getElementById('settingsWheelZoom');
      wz.click(); await wait(80);
      out.zoomOff = localStorage.getItem('tailref-wheel-zoom');
      out.zoomOffAria = wz.getAttribute('aria-pressed');
      wz.click(); await wait(80);
      out.zoomOn = localStorage.getItem('tailref-wheel-zoom');
      const wi = document.getElementById('settingsWheelInvert');
      wi.click(); await wait(80);
      out.invOn = localStorage.getItem('tailref-wheel-invert');
      out.invOnAria = wi.getAttribute('aria-pressed');
      wi.click(); await wait(80);
      out.invOff = localStorage.getItem('tailref-wheel-invert');
      /* Açılışta panoları geri yükle: General sayfası toggle. */
      const rb = document.getElementById('settingsRestoreBoards');
      out.rbExists = String(!!rb);
      rb.click(); await wait(80);
      out.rbOff = localStorage.getItem('tailref-restore-boards');
      out.rbOffAria = rb.getAttribute('aria-pressed');
      rb.click(); await wait(80);
      out.rbOn = localStorage.getItem('tailref-restore-boards');
      out.rbOnAria = rb.getAttribute('aria-pressed');
      /* Undo sınırı: Performance sayfası, clamp + temizleme. */
      navTo('performance'); await wait(150);
      const us = document.getElementById('settingsUndoStepsInput');
      us.value = '999'; us.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.undoHigh = us.value + ':' + localStorage.getItem('tailref-undo-steps');
      us.value = '3'; us.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.undoLow = us.value + ':' + localStorage.getItem('tailref-undo-steps');
      us.value = ''; us.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.undoEmpty = String(localStorage.getItem('tailref-undo-steps'));
      /* Fırça imleci: Drawing sayfası. */
      navTo('drawing'); await wait(150);
      const bc = document.getElementById('settingsBrushCursorSelect');
      bc.value = 'cross'; bc.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.cursor = localStorage.getItem('tailref-brush-cursor');
      bc.value = 'ring'; bc.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.cursorBack = localStorage.getItem('tailref-brush-cursor');
      /* Pano kapatma onayı: Storage sayfası toggle. */
      navTo('storage'); await wait(150);
      const cc = document.getElementById('settingsCloseConfirm');
      out.ccExists = String(!!cc);
      cc.click(); await wait(80);
      out.ccOff = localStorage.getItem('tailref-close-confirm');
      out.ccOffAria = cc.getAttribute('aria-pressed');
      cc.click(); await wait(80);
      out.ccOn = localStorage.getItem('tailref-close-confirm');
      out.ccOnAria = cc.getAttribute('aria-pressed');
      /* Web paneli veri temizleme: depo sayfasında is-danger düğme. */
      const gd = document.getElementById('settingsClearGuestData');
      out.gdExists = String(!!gd);
      out.gdDanger = !!(gd && gd.className.indexOf('is-danger') >= 0);
      /* Yedek saklama sınırı (aday 4): Backup grubu select + kalıcılık. */
      const bl = document.getElementById('backupLimit');
      out.blExists = String(!!bl);
      bl.value = '5'; bl.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.bl5 = localStorage.getItem('tailref-backup-limit');
      bl.value = '50'; bl.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.bl50 = localStorage.getItem('tailref-backup-limit');
      /* Tablet basınç profili (aday 5): Input sayfası select + kalıcılık
         + sync paritesi (kayıt silinince seçici 'linear'a döner). */
      navTo('input'); await wait(150);
      const pp = document.getElementById('settingsPressureProfile');
      out.ppExists = String(!!pp);
      pp.value = 'soft'; pp.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.ppSoft = localStorage.getItem('tailref-pressure-profile');
      pp.value = 'hard'; pp.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.ppHard = localStorage.getItem('tailref-pressure-profile');
      localStorage.removeItem('tailref-pressure-profile');
      settingsHubSync(); await wait(60);
      out.ppSync = pp.value;
      /* Adaylar 6-9 (15 Kasım): imleç zoom + ortam efektleri + tahta
         snap + ızgara aralığı + metin varsayılanları — gerçek UI. */
      navTo('general'); await wait(150);
      const bs = document.getElementById('settingsBoardSnap');
      out.bsExists = String(!!bs);
      bs.click(); await wait(80);
      out.bsOff = localStorage.getItem('tailref-board-snap');
      out.bsOffAria = bs.getAttribute('aria-pressed');
      bs.click(); await wait(80);
      out.bsOn = localStorage.getItem('tailref-board-snap');
      const tsz = document.getElementById('settingsTextSizeDefault');
      out.tszExists = String(!!tsz);
      tsz.value = '19'; tsz.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.tsz19 = localStorage.getItem('tailref-text-default-size');
      tsz.value = 'abc'; tsz.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.tszBad = String(localStorage.getItem('tailref-text-default-size'));
      const tfm = document.getElementById('settingsTextFamilySelect');
      out.tfmExists = String(!!tfm);
      tfm.value = 'Georgia'; tfm.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.tfmGeorgia = localStorage.getItem('tailref-text-default-family');
      tfm.value = ''; tfm.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.tfmEmpty = String(localStorage.getItem('tailref-text-default-family'));
      navTo('appearance'); await wait(150);
      const ae = document.getElementById('settingsAmbientEffects');
      out.aeExists = String(!!ae);
      ae.click(); await wait(80);
      out.aeOff = localStorage.getItem('tailref-ambient-effects');
      out.aeOffAria = ae.getAttribute('aria-pressed');
      ae.click(); await wait(80);
      out.aeOn = localStorage.getItem('tailref-ambient-effects');
      navTo('drawing'); await wait(150);
      const zc = document.getElementById('settingsZoomCursor');
      out.zcExists = String(!!zc);
      out.zcDefaultAria = zc.getAttribute('aria-pressed');
      zc.click(); await wait(80);
      out.zcOn = localStorage.getItem('tailref-zoom-cursor');
      out.zcOnAria = zc.getAttribute('aria-pressed');
      zc.click(); await wait(80);
      out.zcOff = localStorage.getItem('tailref-zoom-cursor');
      const gs = document.getElementById('settingsGridStepSelect');
      out.gsExists = String(!!gs);
      const gridOv = document.getElementById('gridOverlay');
      gs.value = '256'; gs.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.gs256 = localStorage.getItem('tailref-ce-grid-step');
      out.gs256Size = gridOv ? gridOv.style.backgroundSize : null;
      gs.value = '32'; gs.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
      out.gs32 = localStorage.getItem('tailref-ce-grid-step');
      out.gs32Size = gridOv ? gridOv.style.backgroundSize : null;
      /* Temizlik. */
      localStorage.removeItem('tailref-brush-cursor');
      localStorage.removeItem('tailref-close-confirm');
      localStorage.removeItem('tailref-restore-boards');
      localStorage.removeItem('tailref-backup-limit');
      localStorage.removeItem('tailref-pressure-profile');
      localStorage.removeItem('tailref-board-snap');
      localStorage.removeItem('tailref-text-default-size');
      localStorage.removeItem('tailref-text-default-family');
      localStorage.removeItem('tailref-ambient-effects');
      localStorage.removeItem('tailref-zoom-cursor');
      localStorage.removeItem('tailref-ce-grid-step');
      return JSON.stringify(out);
    })()`));
    check('Tekerlek: zoom toggle localStorage\u2019a yazar (0/1)',
      sector.zoomOff === '0' && sector.zoomOn === '1' && sector.zoomOffAria === 'false',
      `kapalı=${sector.zoomOff}(${sector.zoomOffAria}) açık=${sector.zoomOn}`);
    check('\u0130mle\u00e7 odakl\u0131 zoom varsay\u0131lan\u0131 a\u00e7\u0131k (eski davran\u0131\u015f korunur)',
      sector.zcDefaultAria === 'true', `varsay\u0131lan aria=${sector.zcDefaultAria}`);
    check('Izgara aral\u0131\u011f\u0131: se\u00e7im #gridOverlay aral\u0131\u011f\u0131n\u0131 ger\u00e7ekten de\u011fi\u015ftirir',
      sector.gs256 === '256' && sector.gs256Size === '256px 256px' &&
      sector.gs32 === '32' && sector.gs32Size === '32px 32px',
      `256→${sector.gs256Size} · 32→${sector.gs32Size}`);
    check('Tekerlek: doğal yön toggle localStorage\u2019a yazar',
      sector.invOn === '1' && sector.invOff === '0' && sector.invOnAria === 'true',
      `açık=${sector.invOn}(${sector.invOnAria}) kapalı=${sector.invOff}`);
    check('Undo sınırı: 999→200, 3→5, boş→silinir (clamp gerçek)',
      sector.undoHigh === '200:200' && sector.undoLow === '5:5' && sector.undoEmpty === 'null',
      `${sector.undoHigh} · ${sector.undoLow} · ${sector.undoEmpty}`);
    check('Fırça imleci: select seçimi localStorage\u2019a yazar',
      sector.cursor === 'cross' && sector.cursorBack === 'ring',
      `${sector.cursor}→${sector.cursorBack}`);
    check('Pano kapatma onayı: toggle localStorage\u2019a yazar (0/1) + aria',
      sector.ccExists === 'true' && sector.ccOff === '0' && sector.ccOffAria === 'false' &&
      sector.ccOn === '1' && sector.ccOnAria === 'true',
      `var=${sector.ccExists} kapalı=${sector.ccOff}(${sector.ccOffAria}) açık=${sector.ccOn}(${sector.ccOnAria})`);
    check('Web paneli veri temizleme: depo sayfasında is-danger düğme',
      sector.gdExists === 'true' && sector.gdDanger === true,
      `var=${sector.gdExists} danger=${sector.gdDanger}`);
    check('Yedek saklama sınırı: select kalıcılığı (5/50) + temizlik',
      sector.blExists === 'true' && sector.bl5 === '5' && sector.bl50 === '50',
      `var=${sector.blExists} 5=${sector.bl5} 50=${sector.bl50}`);
    check('Tablet basınç profili: select kalıcılığı (soft/hard) + sync paritesi',
      sector.ppExists === 'true' && sector.ppSoft === 'soft' && sector.ppHard === 'hard' &&
      sector.ppSync === 'linear',
      `var=${sector.ppExists} soft=${sector.ppSoft} hard=${sector.ppHard} sync=${sector.ppSync}`);
    check('Açılışta panoları geri yükle: toggle localStorage\u2019a yazar (0/1) + aria',
      sector.rbExists === 'true' && sector.rbOff === '0' && sector.rbOffAria === 'false' &&
      sector.rbOn === '1' && sector.rbOnAria === 'true',
      `var=${sector.rbExists} kapalı=${sector.rbOff}(${sector.rbOffAria}) açık=${sector.rbOn}(${sector.rbOnAria})`);
    check('Tahta yapışması: toggle localStorage\u2019a yazar (0/1) + aria',
      sector.bsExists === 'true' && sector.bsOff === '0' && sector.bsOffAria === 'false' &&
      sector.bsOn === '1',
      `var=${sector.bsExists} kapalı=${sector.bsOff}(${sector.bsOffAria}) açık=${sector.bsOn}`);
    check('Yeni metin varsayılanları: punto (bozuk→temizle) + aile kalıcılığı',
      sector.tszExists === 'true' && sector.tsz19 === '19' && sector.tszBad === 'null' &&
      sector.tfmExists === 'true' && sector.tfmGeorgia === 'Georgia' && sector.tfmEmpty === 'null',
      `punto=${sector.tsz19} bozuk=${sector.tszBad} aile=${sector.tfmGeorgia}→${sector.tfmEmpty}`);
    check('Ortam efektleri: toggle localStorage\u2019a yazar (0/1) + aria',
      sector.aeExists === 'true' && sector.aeOff === '0' && sector.aeOffAria === 'false' &&
      sector.aeOn === '1',
      `var=${sector.aeExists} kapalı=${sector.aeOff}(${sector.aeOffAria}) açık=${sector.aeOn}`);
    check('Editör zoom/ızgara: imleç zoom toggle + ızgara aralığı kalıcılığı',
      sector.zcExists === 'true' && sector.zcDefaultAria === 'true' &&
      sector.zcOn === '0' && sector.zcOnAria === 'false' &&
      sector.zcOff === '1' && sector.gsExists === 'true' &&
      sector.gs256 === '256' && sector.gs32 === '32',
      `varsayılan=${sector.zcDefaultAria} zoom=${sector.zcOn}→${sector.zcOff}(${sector.zcOnAria}) ızgara=${sector.gs256}/${sector.gs32}`);

    /* ---- FAZ 8 · Tüm kategori taraması + pencere boyutu varyantları ---- */
    const navScan = JSON.parse(await evaluate(ws, `(async () => {
      const items = Array.from(document.querySelectorAll('#settingsNav .settingsNavItem'));
      const bad = [];
      for (const it of items) {
        it.click();
        await new Promise(r => setTimeout(r, 120));
        const page = document.querySelector('#settings .settingsPage[data-page="' + it.dataset.cat + '"]');
        const sel = it.getAttribute('aria-selected') === 'true';
        if (!page || getComputedStyle(page).display === 'none' || !sel) bad.push(it.dataset.cat);
      }
      return JSON.stringify({ total: items.length, bad });
    })()`));
    check('FAZ 8: tüm kategoriler açılıyor (nav taraması)',
      navScan.total >= 12 && navScan.bad.length === 0,
      `kategori=${navScan.total} sorunlu=${navScan.bad.join(',') || 'yok'}`);

    /* Küçük pencere emülasyonu: panel taşma/kırpılma yok. */
    const winChecks = [];
    for (const dims of [[1000, 700], [720, 520]]) {
      await send(ws, 'Emulation.setDeviceMetricsOverride', { width: dims[0], height: dims[1], deviceScaleFactor: 1, mobile: false });
      await sleep(250);
      const win = JSON.parse(await evaluate(ws, `(() => {
        const panel = document.getElementById('settings');
        const pr = panel.getBoundingClientRect();
        const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const fits = pr.left >= -1 && pr.top >= -1 && pr.right <= window.innerWidth + 1 && pr.bottom <= window.innerHeight + 1;
        const nav = document.getElementById('settingsNav');
        const navVisible = nav && nav.getBoundingClientRect().left >= 0 && nav.offsetWidth > 40;
        /* Destek düğmesi dar pencerede de erişilebilir kalmalı:
           gerekirse nav'ı en alta kaydırıp ölç. */
        let coffeeOk = false;
        const coffee = document.getElementById('settingsCoffee');
        if (coffee && nav) {
          nav.scrollTop = nav.scrollHeight;
          const cr = coffee.getBoundingClientRect();
          const nr = nav.getBoundingClientRect();
          coffeeOk = cr.width > 60 && cr.height > 16 &&
            cr.left >= nr.left - 1 && cr.right <= nr.right + 1 &&
            cr.top >= nr.top - 1 && cr.bottom <= nr.bottom + 1;
          nav.scrollTop = 0;
        }
        return JSON.stringify({ fits, overflowX, navVisible, coffeeOk });
      })()`));
      winChecks.push({ dims, ...win });
    }
    await send(ws, 'Emulation.clearDeviceMetricsOverride', {});
    await sleep(200);
    for (const wc of winChecks) {
      check(`FAZ 8: ${wc.dims[0]}×${wc.dims[1]} — panel sığıyor + nav görünür`,
        wc.fits && wc.overflowX <= 0 && wc.navVisible,
        `sığıyor=${wc.fits} yatayTaşma=${wc.overflowX} nav=${wc.navVisible}`);
      check(`FAZ 8: ${wc.dims[0]}×${wc.dims[1]} — destek düğmesi erişilebilir`,
        wc.coffeeOk === true, `coffee=${wc.coffeeOk}`);
    }

    /* ---- FAZ 2 · Accessibility ---- */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="accessibility"]').click()`);
    await sleep(250);
    const reduce = JSON.parse(await evaluate(ws, `(() => {
      const el = document.getElementById('settingsReduceMotion');
      el.click();
      const dataset = document.documentElement.dataset.reduceMotion;
      const pressed = el.getAttribute('aria-pressed');
      const barH = document.getElementById('bar').offsetHeight; // yerleşim bozulmamalı
      el.click();
      return JSON.stringify({ dataset, pressed, barH });
    })()`));
    check('reduce motion gerçek dataset kanalı',
      reduce.dataset === '1' && reduce.pressed === 'true',
      `dataset=${reduce.dataset} bar=${reduce.barH}px`);
    const contrast = JSON.parse(await evaluate(ws, `(() => {
      const el = document.getElementById('settingsHiContrast');
      el.click();
      const dataset = document.documentElement.dataset.hiContrast;
      const dim = getComputedStyle(document.documentElement).getPropertyValue('--dim').trim();
      el.click();
      return JSON.stringify({ dataset, dim });
    })()`));
    check('high contrast --dim güçlendiriyor', contrast.dataset === '1' && !!contrast.dim,
      `dataset=${contrast.dataset} dim=${contrast.dim}`);

    /* ---- FAZ 2 · Input & Tablet ---- */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="input"]').click()`);
    await sleep(250);
    const input = JSON.parse(await evaluate(ws, `(() => {
      const info = document.getElementById('settingsPointerInfo');
      const toggle = document.getElementById('settingsMousePressure');
      return JSON.stringify({
        info: info ? info.textContent : null,
        toggle: toggle ? toggle.getAttribute('aria-pressed') : null,
      });
    })()`));
    check('input sayfası: pointer özeti + mouse pressure toggle',
      input.info && input.info.length > 3 && input.toggle !== null,
      `özet="${input.info}" toggle=${input.toggle}`);

    /* ---- FAZ 2 ekran görüntüleri ---- */
    for (const cat of ['appearance', 'accessibility', 'input', 'advanced', 'about', 'shortcuts']) {
      await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="${cat}"]').click()`);
      await sleep(250);
      const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, 'faz2-' + cat + '.png'), Buffer.from(shot.data, 'base64'));
    }

    /* Kapat düğmesi çalışıyor mu. */
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="storage"]').click()`);
    await sleep(200);
    /* Footer konumu: panelin EN ALTINA yapışık ve SOL hizalı olmalı. */
    const foot = JSON.parse(await evaluate(ws, `(() => {
      const p = document.getElementById('settings').getBoundingClientRect();
      const f = document.querySelector('.settingsFoot');
      const m = document.querySelector('.settingsMail');
      const c = document.querySelector('.settingsCopyright');
      const fr = f.getBoundingClientRect(), mr = m.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      return JSON.stringify({
        bottomGap: Math.round(p.bottom - fr.bottom),
        leftAligned: Math.round(mr.left - fr.left),
        mailClipped: m.scrollWidth > m.clientWidth + 1,
        copyClipped: c.scrollWidth > c.clientWidth + 1,
        copyBelow: cr.top >= mr.bottom - 1,
        copyLeftDelta: Math.round(cr.left - mr.left),
      });
    })()`));
    check('footer panelin en altında', Math.abs(foot.bottomGap) <= 4, `alt boşluk=${foot.bottomGap}px`);
    check('footer sola hizalı', foot.leftAligned < 30, `mail sol kenar sapması=${foot.leftAligned}px`);
    check('footer metinleri kırpılmıyor (e-posta + telif tam okunur)',
      !foot.mailClipped && !foot.copyClipped,
      `mail kırpık=${foot.mailClipped} · telif kırpık=${foot.copyClipped}`);
    check('telif satırı e-posta metninin ALTINDA ve sol hizalı',
      foot.copyBelow && Math.abs(foot.copyLeftDelta) < 30,
      `alt=${foot.copyBelow} · sol sapma=${foot.copyLeftDelta}px`);

    /* ---- Dar panel (kullanıcı paneli küçültünce) ----
       400 px'te tek sütuna geçmeli: nav yatay şerit, e-posta tam genişlik,
       düğmeler alt satırda. Önceden e-posta tek harf genişliğinde sarıyordu. */
    const narrow = JSON.parse(await evaluate(ws, `(() => {
      const p = document.getElementById('settings');
      const prev = p.style.width;
      p.style.width = '400px';
      const nav = p.querySelector('.settingsNav');
      const m = p.querySelector('.settingsMail');
      const a = p.querySelector('.settingsFootActions');
      const mr = m.getBoundingClientRect(), ar = a.getBoundingClientRect();
      const out = {
        navDir: getComputedStyle(nav).flexDirection,
        mailWidth: Math.round(mr.width),
        mailClipped: m.scrollWidth > m.clientWidth + 1,
        actionsBelow: ar.top >= mr.bottom - 1,
        panelWidth: Math.round(p.getBoundingClientRect().width),
      };
      p.style.width = prev;
      return JSON.stringify(out);
    })()`));
    check('Dar panel: tek sütun düzeni (nav yatay, e-posta tam genişlik, düğmeler altta)',
      narrow.navDir === 'row' && narrow.mailWidth > 150 && !narrow.mailClipped &&
      narrow.actionsBelow === true,
      `nav=${narrow.navDir} mail=${narrow.mailWidth}px kırpık=${narrow.mailClipped} alt=${narrow.actionsBelow}`);
    await evaluate(ws, `document.getElementById('btnSettingsClose').click()`);
    await sleep(400);
    const closed = await evaluate(ws, `document.getElementById('settings').hidden`);
    check('kapat düğmesi paneli gizliyor', closed === true, String(closed));

    /* Tekrar açınca son kategori hatırlanıyor (storage). */
    await evaluate(ws, `document.getElementById('btnOverflow').click()`);
    await sleep(500);
    const resumed = JSON.parse(await evaluate(ws, `(() => {
      const sel = document.querySelector('#settingsNav .settingsNavItem[aria-selected="true"]');
      const pageEl = document.querySelector('#settings .settingsPage[data-page="storage"]');
      return JSON.stringify({ cat: sel ? sel.dataset.cat : null, pageVisible: !!(pageEl && getComputedStyle(pageEl).display !== 'none') });
    })()`));
    check('yeniden açınca son kategori (storage)', resumed.cat === 'storage' && resumed.pageVisible, `${resumed.cat} sayfa=${resumed.pageVisible}`);

    /* Sektör standardı: yeniden açılışta localStorage senkronu (15 Kasım). */
    const sectorSync = JSON.parse(await evaluate(ws, `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      localStorage.setItem('tailref-wheel-zoom', '0');
      localStorage.setItem('tailref-brush-cursor', 'hidden');
      document.getElementById('btnSettingsClose').click(); await wait(350);
      document.getElementById('btnOverflow').click(); await wait(500);
      const wz = document.getElementById('settingsWheelZoom');
      const bc = document.getElementById('settingsBrushCursorSelect');
      const out = { zoomAria: wz.getAttribute('aria-pressed'), cursor: bc.value };
      localStorage.removeItem('tailref-wheel-zoom');
      localStorage.removeItem('tailref-brush-cursor');
      return JSON.stringify(out);
    })()`));
    check('Sektör standardı: yeniden açılışta localStorage senkronu',
      sectorSync.zoomAria === 'false' && sectorSync.cursor === 'hidden',
      `zoomAria=${sectorSync.zoomAria} cursor=${sectorSync.cursor}`);

    /* Destek bağlantısı: sol kolonun en altında, doğru adrese bağlı. */
    const coffee = JSON.parse(await evaluate(ws, `(() => {
      const a = document.getElementById('settingsCoffee');
      const nav = document.getElementById('settingsNav');
      if (!a || !nav) return JSON.stringify({ found: false });
      const ar = a.getBoundingClientRect();
      const nr = nav.getBoundingClientRect();
      return JSON.stringify({
        found: true,
        href: a.getAttribute('href'),
        bound: a.dataset.bound === '1',
        inNav: nav.contains(a),
        bottomGap: Math.round(nr.bottom - ar.bottom),
        leftGap: Math.round(ar.left - nr.left),
        width: Math.round(ar.width),
      });
    })()`));
    check('destek bağlantısı sol kolonun en altında ve doğru adrese bağlı',
      coffee.found && coffee.inNav && coffee.bound &&
      coffee.href === 'https://www.buymeacoffee.com/roxsmb' &&
      coffee.bottomGap >= 0 && coffee.bottomGap <= 16 && coffee.width > 60,
      JSON.stringify(coffee));

    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, 'storage-resumed.png'), Buffer.from(shot.data, 'base64'));

    /* Esc: açık ayarlar penceresini kapatır (uygulama geneli kural). */
    const hubEsc = JSON.parse(await evaluate(ws, `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      if (document.getElementById('settings').hidden) {
        document.getElementById('btnOverflow').click();
        await wait(500);
      }
      const opened = !document.getElementById('settings').hidden;
      (document.activeElement || document.body)
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait(350);
      return JSON.stringify({ opened, closed: document.getElementById('settings').hidden });
    })()`));
    check('Esc açık ayarlar penceresini kapatıyor',
      hubEsc.opened === true && hubEsc.closed === true, JSON.stringify(hubEsc));

    check('konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(`\nEkran görüntüleri: ${SHOT_DIR}`);
    console.log(`${fail ? 'BAŞARISIZ' : 'TÜM TESTLER GEÇTİ'} (${pass}/${pass + fail})`);
  } catch (error) {
    console.error('HATA:', error.message);
    console.error('STACK:', String(error.stack).split('\n').slice(0, 6).join('\n'));
    if (errors.length) console.error('Sayfa hataları:\n' + errors.join('\n'));
    fail++;
  } finally {
    try { ws && ws.close(); } catch { /* yoksay */ }
    app.kill();
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli olabilir */ }
    process.exit(fail ? 1 : 0);
  }
})();
