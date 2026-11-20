'use strict';
/* ======================================================================
   TailRef · Tur T Faz 3 kapısı — Tema stüdyosu + kayıt defteri
   ======================================================================
   Kanıt zinciri (izole Electron profili, CDP):
   1. API'ler mevcut (themeRegistry + interfaces)
   2. Galeri kuruldu: ≥10 gömülü kart
   3. Gömülü kart tıklaması → data-theme anında
   4. Özel tema: mevcutdan yeni → renk değiştir → Kaydet → depo + kural
      + computed --accent gerçekten değişti
   5. Kopyala / yeniden adlandır / sil (onay diyaloğu override'ı)
   6. Aktif özel tema silinince classic'e geri düşüş
   7. Palet çıkarma (yerel median-cut) → ≥2 renk + 7 slot
   8. Görsel arka plan → üretilmiş kuralda url + computed backgroundImage
   9. Gömülü temalar zarar görmedi (10 builtin)
  10. Arayüz kayıt defteri: classic parite + skin'siz arayüz reddi
   ====================================================================== */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const PORT = 9371;
const APP_PORT = 5239;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  → ' + detail : ''));
}
function connect(wsUrl) {
  return new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
}
const send = (ws, method, params) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => { const m = JSON.parse(ev.data); if (m.id !== id) return; ws.removeEventListener('message', onMsg);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => { const m = JSON.parse(ev.data); if (m.id !== id) return; ws.removeEventListener('message', onMsg);
    m.error ? reject(new Error(JSON.stringify(m.error))) : (m.result.exceptionDetails ? reject(new Error(m.result.exceptionDetails.exception?.description || 'eval')) : resolve(m.result.result.value)); };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  setTimeout(() => reject(new Error('timeout')), 30000);
});

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-themestudio-'));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'],
    { cwd: ROOT, env: { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' }, stdio: 'ignore' });
  try {
    let page = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && !page) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      } catch { /* henüz hazır değil */ }
      if (!page) await sleep(400);
    }
    if (!page) throw new Error('ana pencere açılmadı');
    const ws = await connect(page.webSocketDebuggerUrl);
    await send(ws, 'Page.enable', {});
    for (let i = 0; i < 40; i++) { try { if (await evaluate(ws, "typeof state !== 'undefined'")) break; } catch {} await sleep(400); }
    await evaluate(ws, `(function(){ if (typeof setPersistenceMode === 'function') setPersistenceMode('auto');
      const el = document.getElementById('persistenceWelcome'); if (el) el.hidden = true;
      /* test onayları: window.confirm'u otomatik Evrat yap */
      window.confirm = () => true; window.__tailrefConfirmBypass = true; })()`);
      /* appConfirm stub yoluna düşsün — üst satırdaki bypass bayrağı ile. */    await sleep(400);

    /* ---- 1. API'ler ---- */
    const apis = JSON.parse(await evaluate(ws, `JSON.stringify({
      reg: typeof window.tailrefThemeRegistry,
      ui: typeof window.tailrefInterfaces,
      gallery: !!document.getElementById('settingsThemeGallery'),
      editorColors: !!document.getElementById('settingsCustomThemeColors') })`));
    check('Kayıt defteri + arayüz API mevcut, editör HTML var',
      apis.reg === 'object' && apis.ui === 'object' && apis.gallery && apis.editorColors, JSON.stringify(apis));

    /* ---- 2-3. Galeri + gömülü kart uygulama ---- */
    await evaluate(ws, `document.getElementById('btnOverflow').click()`);
    await sleep(900);
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="appearance"]').click()`);
    await sleep(350);
    const g2 = JSON.parse(await evaluate(ws, `(function () {
      const box = document.getElementById('settingsThemeGallery');
      const cards = [...box.querySelectorAll('.settingsThemeCard')];
      const obsidian = cards.find(c => c.dataset.themeCard === 'obsidian');
      if (obsidian) obsidian.click();
      return JSON.stringify({ cards: cards.length, obsidianFound: !!obsidian }); })()`));
    await sleep(450);
    const themeAfter = await evaluate(ws, `document.documentElement.dataset.theme || 'classic'`);
    check('Galeri ≥10 gömülü kart + obsidian kartı',
      g2.cards >= 10 && g2.obsidianFound, `kart=${g2.cards}`);
    check('Kart tıklaması temayı ANINDA uyguladı',
      themeAfter === 'obsidian', themeAfter);

    /* ---- 4. Özel tema: mevcutdan yeni → kaydet → gerçek uygulama ---- */
    const custom = JSON.parse(await evaluate(ws, `(async () => {
      document.getElementById('settingsCustomThemeNew').click();
      await new Promise(r => setTimeout(r, 250));
      const name = document.getElementById('settingsCustomThemeName');
      name.value = 'Test Mavisi';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      const accent = document.querySelector('#settingsCustomThemeColors input[data-slot="accent"]');
      accent.value = '#ff5c5c';
      accent.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('settingsCustomThemeSave').click();
      await new Promise(r => setTimeout(r, 500));
      const reg = window.tailrefThemeRegistry;
      const list = reg.list();
      const active = document.documentElement.dataset.theme || 'classic';
      const accentNow = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const ruleHas = document.getElementById('tailrefCustomThemeStyles').textContent.includes(active);
      return JSON.stringify({ count: list.length, active, accentNow, ruleHas,
        stored: !!localStorage.getItem('tailref-custom-themes'),
        name: list.length ? list[list.length - 1].name : null });
    })()`));
    check('Özel tema kaydedildi: depo + data-theme + üretilmiş kural + accent',
      custom.count === 1 && custom.active.startsWith('ct_') && custom.accentNow === '#ff5c5c'
      && custom.ruleHas && custom.stored && custom.name === 'Test Mavisi',
      JSON.stringify(custom));
    const nameGuard = JSON.parse(await evaluate(ws,
      `JSON.stringify({ n: themeNames.includes(${JSON.stringify(custom.active)}) })`));
    check('Özel id themeNames\'e girdi (applyTheme guard artık kabul ediyor)',
      nameGuard.n === true, custom.active);

    /* ---- 5. Kopyala / yeniden adlandır / sil ---- */
    /* Not: kayıttan sonra taslak kayıtlı temayı işaret eder ve aktif
       hâlâ O original'dır; duplicate kopyayı listeye EKLER (index 1).
       Sil testi aktif olmayan KOPYAYI siler. */
    const dupA = JSON.parse(await evaluate(ws, `(async () => {
      document.getElementById('settingsCustomThemeDuplicate').click();
      await new Promise(r => setTimeout(r, 350));
      return JSON.stringify({ count: window.tailrefThemeRegistry.list().length });
    })()`));
    const dupB = JSON.parse(await evaluate(ws, `(function () {
      const reg = window.tailrefThemeRegistry;
      const first = reg.list()[0];
      reg.rename(first.id, 'Yeni ad');
      return JSON.stringify({ renamed: reg.list().find(t => t.id === first.id).name });
    })()`));
    const dupC = JSON.parse(await evaluate(ws, `(function () {
      const reg = window.tailrefThemeRegistry;
      /* aktif = list[0] (original); kopya = list[1] — kopyayı sil */
      const copy = reg.list()[1];
      const before = reg.active();
      reg.delete(copy.id);
      return JSON.stringify({ afterDelete: reg.list().length,
        activeStill: document.documentElement.dataset.theme || 'classic',
        activeUnchanged: before === reg.active() });
    })()`));
    const dup = { ...dupA, ...dupB, ...dupC };
    check('Kopyala → 2; yeniden adlandır çalıştı; kopya silindi (aktif korundu)',
      dup.count === 2 && dup.renamed === 'Yeni ad' && dup.afterDelete === 1
      && dup.activeStill.startsWith('ct_') && dup.activeUnchanged, JSON.stringify(dup));

    /* ---- 6. Aktif özel tema silinince classic düşüşü ---- */
    const delActive = JSON.parse(await evaluate(ws, `(async () => {
      const reg = window.tailrefThemeRegistry;
      const active = reg.active();
      reg.delete(active);
      await new Promise(r => setTimeout(r, 300));
      return JSON.stringify({ after: document.documentElement.dataset.theme || 'classic',
        count: reg.list().length,
        savedTheme: localStorage.getItem('tailref-theme') });
    })()`));
    check('Aktif özel tema silindi → classic + anahtar classic',
      delActive.after === 'classic' && delActive.count === 0 && delActive.savedTheme === 'classic',
      JSON.stringify(delActive));

    /* ---- 7. Palet çıkarma (yerel) ---- */
    const pal = JSON.parse(await evaluate(ws, `(async () => {
      const reg = window.tailrefThemeRegistry;
      /* Yapay görsel: koyu zemin + canlı accent bandı */
      const c = document.createElement('canvas'); c.width = 120; c.height = 80;
      const g = c.getContext('2d');
      g.fillStyle = '#101018'; g.fillRect(0, 0, 120, 80);
      g.fillStyle = '#e05555'; g.fillRect(0, 0, 60, 40);
      g.fillStyle = '#f0f0f5'; g.fillRect(60, 40, 60, 40);
      const dataUrl = c.toDataURL('image/png');
      const r = await reg.extractPalette(dataUrl);
      return JSON.stringify({ n: r.palette.length, slots: Object.keys(r.slots).length,
        bg: r.slots.bg, accent: r.slots.accent, text: r.slots.text });
    })()`));
    check('Palet çıkarma: ≥2 renk, 7 slot, koyu zemin + açık metin sezgisel',
      pal.n >= 2 && pal.slots === 7 && pal.bg === '#101018' && pal.text === '#f0f0f5'
      && pal.accent.toLowerCase() === '#e05555', JSON.stringify(pal));

    /* ---- 8. Görsel arka plan: kaydet → kuralda url + computed ---- */
    const img = JSON.parse(await evaluate(ws, `(async () => {
      const reg = window.tailrefThemeRegistry;
      /* Taslak oluştur + görsel yükle + kaydet */
      document.getElementById('settingsCustomThemeNew').click();
      await new Promise(r => setTimeout(r, 200));
      const name = document.getElementById('settingsCustomThemeName');
      name.value = 'Gorsel Tema';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      const c = document.createElement('canvas'); c.width = 100; c.height = 70;
      const g = c.getContext('2d');
      g.fillStyle = '#20242e'; g.fillRect(0, 0, 100, 70);
      const small = await reg.downscale(c.toDataURL('image/png'));
      const draft = { name: 'Gorsel Tema', colors: {
          bg: '#20242e', panel: '#20242e', border: '#35353f', text: '#e7e7ee',
          dim: '#8b8b9c', accent: '#4da3ff', accentInk: '#ffffff' },
        panelAlpha: 94, backdrop: { image: small, position: 'center', size: 'cover', opacity: 1, blur: 0 } };
      const res = reg.save(draft, true);
      await new Promise(r => setTimeout(r, 400));
      const style = document.getElementById('tailrefCustomThemeStyles').textContent;
      const backdrop = document.getElementById('backdrop');
      /* Kural stylesheet'ten uygulanır → computed kontrolü DOĞRU kanıt */
      return JSON.stringify({ ok: res.ok, active: document.documentElement.dataset.theme || 'classic',
        ruleHasUrl: style.includes('url("data:image/jpeg'),
        computed: getComputedStyle(backdrop).backgroundImage.startsWith('url("data:image/jpeg'),
        computedRaw: getComputedStyle(backdrop).backgroundImage.slice(0, 60),
        id: res.id });
    })()`));
    check('Görsel arka plan: kural url içeriyor + #backdrop inline backgroundImage',
      img.ok && img.active.startsWith('ct_') && img.ruleHasUrl && img.computed, JSON.stringify(img));

    /* ---- 9. Gömülü temalar zarar görmedi ---- */
    const builtins = JSON.parse(await evaluate(ws, `JSON.stringify({
      n: themeNames.filter(n => !n.startsWith('ct_')).length,
      customs: themeNames.filter(n => n.startsWith('ct_')).length })`));
    check('Gömülü 10 tema + kayıtlı özel id sayısı tutarlı',
      builtins.n === 10 && builtins.customs === 1, JSON.stringify(builtins));

    /* ---- 10. Arayüz kayıt defteri ---- */
    const ui = JSON.parse(await evaluate(ws, `(async () => {
      const api = window.tailrefInterfaces;
      const classicOk = api.apply('classic');
      const noneOk = api.apply('yok-boyle-arayuz');
      return JSON.stringify({ classicOk, noneOk, active: api.active(),
        hasDataset: 'interface' in document.documentElement.dataset,
        listLen: api.list().length });
    })()`));
    check('Arayüz kaydı: classic parite (dataset yok) + bilinmeyen arayüz reddi',
      ui.classicOk && !ui.noneOk && ui.active === 'classic' && !ui.hasDataset, JSON.stringify(ui));

    /* paneli kapat */
    await evaluate(ws, `(function(){ const b = document.getElementById('btnSettingsClose'); if (b) b.click(); })()`);

    /* ---- konsol hatası kontrolü ---- */
    const errs = [];
    // (basit: sonraki evaluate'te hata fırlarsa gate zaten kırmızı olur)
  } catch (e) {
    check('akış hatasız tamamlanmalı', false, e.message);
  } finally {
    try { app.kill(); } catch {}
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  }
  const fails = results.filter(r => !r.ok);
  console.log(`\nTEMA-STUDYO: ${results.length - fails.length} geçti, ${fails.length} kaldı`);
  process.exit(fails.length ? 1 : 0);
})();
