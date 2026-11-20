'use strict';

/* Fırça kütüphanesi kalıcılığı + .abr turu.
   ------------------------------------------------------------------
   Kullanıcı sorusu: "yeni fırça yapıyoruz; uygulamayı kapatıp açınca
   gerçekten duruyor mu, yoksa kayıp mı oluyor?"
   Bu kapı gerçek Electron'u iki kez aynı profil klasörüyle açar:
     1) prosedürel fırça + PNG uçlu fırça + özel kategori + favori
     2) .abr dışa aktar → gerçek dosya girişinden içe aktar → kart görünür
     3) silinen fırça ve bozuk .abr davranışı
     4) kapat → yeniden aç → hepsi hâlâ yerinde mi?
   ================================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP_PORT = 5371;               /* iki açılışta da AYNI: IndexedDB origin'i */
const DEBUG_A = 9383;
const DEBUG_B = 9385;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STAMP = Date.now();
const CATEGORY = 'QA Kalıcı Kategori ' + STAMP;
const BRUSH_A = 'QA Kalıcı Prosedürel ' + STAMP;
const BRUSH_B = 'QA Kalıcı PNG ' + STAMP;
const BRUSH_C = 'QA Silinecek ' + STAMP;
const BRUSH_D = 'QA Taşınan ' + STAMP;
const MOVE_CATEGORY = 'QA Taşıma Kategorisi ' + STAMP;

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
  ok ? pass++ : fail++;
};

/* ---------------------------------------------------------------
   Gerçek dünya .abr varyantları. Kendi yazıcımız yalnızca v6.2 +
   8-bit üretiyor; sahada v1/v2 (39 baytlık başlık), 16-bit uçlar ve
   `samp` bloğu `desc`/`cbsh`'ten önce gelen setler de dolaşıyor.
   Aşağıdaki üreticiler o düzenleri birebir taklit eder.
   --------------------------------------------------------------- */
function qaAlphaMask(size) {
  const a = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2 + 0.5, dy = y - size / 2 + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      a[y * size + x] = Math.max(0, Math.min(255, Math.round((1 - d / (size / 2 - 1)) * 255)));
    }
  }
  return a;
}

/* 39 bayt dolgu + PSD başlığı + piksel (legacy kayıt düzeni). */
function qaAbrTipEntry(size, { depth = 8, rle = false } = {}) {
  const a = qaAlphaMask(size);
  const bpp = depth === 16 ? 2 : 1;
  const out = [];
  for (let i = 0; i < 39; i++) out.push(0);
  const hdr = new DataView(new ArrayBuffer(19));
  hdr.setInt32(0, 0);
  hdr.setInt32(4, 0);
  hdr.setInt32(8, size);
  hdr.setInt32(12, size);
  hdr.setUint16(16, depth);
  hdr.setUint8(18, rle ? 1 : 0);
  for (const b of new Uint8Array(hdr.buffer)) out.push(b);
  if (!rle) {
    for (let i = 0; i < a.length; i++) {
      if (depth === 8) out.push(a[i]);
      else out.push(a[i], 0);
    }
    return Buffer.from(out);
  }
  const rowBytes = size * bpp;
  for (let y = 0; y < size; y++) {
    out.push(rowBytes - 1);
    for (let x = 0; x < size; x++) {
      if (depth === 8) out.push(a[y * size + x]);
      else { out.push(a[y * size + x], 0); }
    }
  }
  return Buffer.from(out);
}

function qaAbrLegacy(entries) {
  const out = [0, 1, 0, entries.length];
  for (const entry of entries) {
    const n = entry.length;
    out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    for (const b of entry) out.push(b);
  }
  return Buffer.from(out);
}

/* v6.2 blok yazıcı: blok sırası serbest. */
function qaAbrV6(blocks) {
  const out = [];
  const u16 = n => out.push((n >> 8) & 255, n & 255);
  const u32 = n => out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  const patch32 = (pos, n) => {
    out[pos] = (n >>> 24) & 255; out[pos + 1] = (n >>> 16) & 255;
    out[pos + 2] = (n >>> 8) & 255; out[pos + 3] = n & 255;
  };
  const uni = s => { u32(s.length); for (let i = 0; i < s.length; i++) u16(s.charCodeAt(i)); };
  const id = s => { u32(s.length); for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255); };
  const ascii = s => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255); };
  const f64 = n => { const t = new Uint8Array(8); new DataView(t.buffer).setFloat64(0, n); for (const b of t) out.push(b); };
  const block = (tag, payload) => {
    for (const ch of '8BIM' + tag) out.push(ch.charCodeAt(0));
    const sizePos = out.length;
    u32(0);
    const start = out.length;
    payload();
    patch32(sizePos, out.length - start);
    while (out.length % 4) out.push(0);
  };
  u16(6); u16(2);
  for (const b of blocks) block(b.tag, () => b.write({ u16, u32, uni, id, ascii, f64, out }));
  return Buffer.from(out);
}

function qaAbrDescBlock(name) {
  return {
    tag: 'desc',
    write: ({ u32, uni, id, ascii }) => {
      u32(1);              // descriptor sürümü
      uni('brushPreset');  // sınıf adı
      id('brushPreset');   // sınıf kimliği
      u32(1);              // alan sayısı
      id('Nm  ');          // anahtar
      ascii('TEXT');       // anahtar tipi
      uni(name);           // değer
    },
  };
}

function qaAbrCbshBlock(size) {
  return {
    tag: 'cbsh',
    write: ({ u32, uni, id, ascii, f64 }) => {
      const num = (key, unit, value) => {
        id(key); ascii('UntF'); ascii(unit); f64(value);
      };
      u32(16);
      uni('computedBrush');
      id('computedBrush');
      u32(1);
      num('Dmtr', '#Pxl', size);
    },
  };
}

function qaAbrSampBlock(entries) {
  return {
    tag: 'samp',
    write: ({ u16, u32, out }) => {
      u16(1);
      u16(entries.length);
      for (const entry of entries) {
        u32(entry.length);
        for (let i = 0; i < entry.length; i++) out.push(entry[i]);
      }
    },
  };
}

function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6);
    const timer = setTimeout(() => reject(new Error('eval zaman aşımı')), 30000);
    const onMsg = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMsg);
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      if (msg.result.exceptionDetails) {
        return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
      }
      resolve(msg.result.result.value);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({
      id, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
}

async function launch(debugPort, userData) {
  const env = {
    ...process.env,
    TailRef_USER_DATA: userData,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${debugPort}`, '--disable-gpu', '--no-sandbox'],
    { cwd: ROOT, env, stdio: 'ignore' });

  let page = null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && !page) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
    } catch { /* bekle */ }
    if (!page) await sleep(400);
  }
  if (!page) { try { app.kill(); } catch { /* sessiz */ } throw new Error('ana pencere açılmadı'); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try {
      ready = await evaluate(ws,
        "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth");
    } catch { /* bekle */ }
    if (!ready) await sleep(400);
  }
  if (!ready) { try { app.kill(); } catch { /* sessiz */ } throw new Error('renderer hazır olmadı'); }

  for (let i = 0; i < 40; i++) {
    const done = await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (!w || w.hidden) return true;
      if (!document.querySelector('.pwOption.is-selected')) document.querySelector('.pwOption[data-mode="auto"]')?.click();
      const b = document.getElementById('pwContinue');
      if (b && !b.disabled) b.click();
      return !!w.hidden;
    })()`);
    if (done) break;
    await sleep(300);
  }
  await sleep(900);
  await evaluate(ws, `window.__qaErrs = [];
    window.addEventListener('error', e => window.__qaErrs.push(String(e.message || e)));
    window.addEventListener('unhandledrejection', e => window.__qaErrs.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
    window.__qaNotices = [];
    if (typeof showProjectNotice === 'function') {
      const orig = showProjectNotice;
      window.showProjectNotice = (m, t) => { window.__qaNotices.push(String(m)); return orig(m, t); };
    }
    true`);

  const json = async expr => JSON.parse(await evaluate(ws, expr));
  const stop = async () => {
    try { ws.close(); } catch { /* sessiz */ }
    await new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      app.once('exit', finish);
      try { app.kill(); } catch { finish(); }
      setTimeout(finish, 3000);
    });
    await sleep(1000);
  };
  return { ws, evaluate: expr => evaluate(ws, expr), json, stop };
}

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-brush-gate-'));
  let app = null;
  try {
    /* ================= 1. OTURUM ================= */
    app = await launch(DEBUG_A, userData);

    const created = await app.json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const cat = await inkNativeCreateCategory(${JSON.stringify(CATEGORY)});
      if (!cat || !cat.ok) return JSON.stringify({ error: 'kategori oluşmadı', cat });
      inkNativeSyncCustomCreator();

      /* prosedürel fırça */
      inkOpenNativeBrushLibrary(null, cat.category.id, { creatorOnly: true });
      const name = document.getElementById('nativeBrushCustomName');
      name.value = ${JSON.stringify(BRUSH_A)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
      const catSel = document.getElementById('nativeBrushCustomCategory');
      catSel.value = cat.category.id;
      catSel.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('nativeBrushCustomCreate').click();
      await wait(900);

      /* PNG uçlu fırça: gerçek dosya girişi */
      const c = document.createElement('canvas'); c.width = 72; c.height = 72;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 72, 72);
      g.fillStyle = '#000'; g.beginPath(); g.arc(36, 36, 24, 0, Math.PI * 2); g.fill();
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'qa-tip.png', { type: 'image/png' }));
      const pngInput = document.getElementById('nativeBrushCustomPng');
      pngInput.files = dt.files;
      pngInput.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 40; i++) { await wait(100); if (inkNativeBrushUi.uploadedTip) break; }
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: true });
      name.value = ${JSON.stringify(BRUSH_B)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
      catSel.value = 'custom';
      catSel.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('nativeBrushCustomCreate').click();
      await wait(1200);

      /* silinecek fırça */
      name.value = ${JSON.stringify(BRUSH_C)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('nativeBrushCustomCreate').click();
      await wait(900);

      const find = n => inkState().brushes.find(b => b.name === n) || null;
      const a = find(${JSON.stringify(BRUSH_A)});
      const b = find(${JSON.stringify(BRUSH_B)});
      const c2 = find(${JSON.stringify(BRUSH_C)});
      /* Favori yıldızı fırça listesini değiştirmez: uç PNG'leri yeniden
         yazılmamalı. idbPut'u sarıp hangi anahtarların yazıldığını say. */
      const writes = [];
      const origPut = idbPut;
      idbPut = async (store, key, val) => { writes.push(String(key)); return origPut(store, key, val); };
      if (a) await inkNativeToggleFavorite(a.id);
      idbPut = origPut;
      if (c2) { window.appConfirm = async () => true; await inkNativeDeleteBrush(c2.id); }
      /* Kategori silme onay metni yarım bir cümleydi ("… and its 1 —
         remove this brush …"). Onayı reddettirip yalnız metni yakala:
         erken dönüş olduğu için kütüphaneye dokunmaz. */
      let catConfirm = '';
      window.appConfirm = async (text) => { catConfirm = String(text || ''); return false; };
      await inkNativeDeleteCategory(cat.category.id);
      window.appConfirm = async () => true;
      await wait(200);

      /* Taşıma akışı: fırça başka kategoriye taşınınca pano kaydı da
         tazelenmeli; yoksa yeniden açılışta eski pano anlık görüntüsü
         fırçayı eski kategorisiyle geri getiriyordu. */
      const moveCat = await inkNativeCreateCategory(${JSON.stringify(MOVE_CATEGORY)});
      name.value = ${JSON.stringify(BRUSH_D)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
      catSel.value = 'custom';
      catSel.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('nativeBrushCustomCreate').click();
      await wait(900);
      const mover = find(${JSON.stringify(BRUSH_D)});
      const movedOk = mover && moveCat && moveCat.ok
        ? await inkNativeMoveBrushToCategory(mover.id, moveCat.category.id) : false;
      await wait(900);
      await wait(700);

      const db = await idbGet('meta', 'ink:brushes');
      const lib = await idbGet('meta', 'ink:library');
      return JSON.stringify({
        categoryId: cat.category.id,
        a: a && { id: a.id, category: a.category },
        b: b && { id: b.id, category: b.category, tipId: b.tipId, tipData: inkRuntime.importedTips.has(b.tipId) },
        c: c2 && c2.id,
        writes,
        dbNames: Array.isArray(db) ? db.map(r => r && r.brush ? r.brush.name : null) : [],
        libCategories: lib && lib.customCategories ? lib.customCategories.map(x => x.name) : [],
        deleted: lib && lib.deletedBrushIds ? lib.deletedBrushIds : [],
        favorites: lib && lib.favorites ? lib.favorites : [],
        catConfirm,
        moveCatId: moveCat && moveCat.ok ? moveCat.category.id : '',
        moverId: mover ? mover.id : '',
        moverCategory: mover ? mover.category : '',
        movedOk,
      });
    })()`);
    console.log('· 1. oturum:', JSON.stringify(created));

    check('favori yıldızı fırça/uç kayıtlarını yeniden yazmıyor',
      !created.writes.includes('ink:brushes') && created.writes.includes('ink:library'),
      created.writes.join(','));

    check('özel kategori oluşturuldu ve kayda yazıldı',
      created.libCategories.includes(CATEGORY), CATEGORY);
    check('prosedürel fırça oluşturuldu ve diske yazıldı',
      created.dbNames.includes(BRUSH_A) && !!created.a, created.a && created.a.category);
    check('PNG uçlu fırça ucuyla birlikte yazıldı',
      created.dbNames.includes(BRUSH_B) && !!(created.b && created.b.tipData),
      created.b && created.b.tipId);
    check('silinen fırça silinmiş olarak işaretlendi',
      !!created.c && created.deleted.includes(created.c), created.c);
    check('kategori silme onayı düzgün cümle kuruyor',
      /brush will be removed from the library\.$/.test(created.catConfirm || '') &&
      !/—\s*remove this brush/.test(created.catConfirm || ''),
      created.catConfirm);
    check('fırça başka kategoriye taşındı',
      created.movedOk === true && created.moverCategory === created.moveCatId,
      created.moverCategory);

    /* ---- .abr dışa aktarma ---- */
    const abr = await app.json(`(() => {
      const brush = inkGetBrush('ink-soft');
      if (!brush) return JSON.stringify({ error: 'yerleşik fırça yok' });
      const bytes = inkNativeBrushAbrBytes(brush);
      window.__qaAbr = bytes;
      const parsed = bytes ? inkParseAbr(bytes) : [];
      return JSON.stringify({
        length: bytes ? bytes.length : 0,
        magic: bytes ? [bytes[0], bytes[1], bytes[2], bytes[3]] : [],
        parsed: parsed.map(t => ({ kind: t.kind, name: t.name, hasData: !!t.dataUrl })),
      });
    })()`);
    console.log('· .abr export:', JSON.stringify(abr));
    check('.abr v6.2 başlığı ve gövdesi üretildi',
      abr.length > 1000 && abr.magic.join(',') === '0,6,0,2' &&
      abr.parsed.length >= 1 && abr.parsed[0].hasData,
      `${abr.length} bayt · ${abr.parsed.map(p => p.kind).join(',')}`);

    const abrBytes = Buffer.from(await app.evaluate('Array.from(window.__qaAbr)'));
    const abrB64 = abrBytes.toString('base64');

    /* ---- .abr içe aktarma (gerçek input) ---- */
    const imported = await app.json(`(async () => {
      const raw = atob(${JSON.stringify(abrB64)});
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      const input = document.getElementById('inkAbrInput');
      const before = inkState().brushes.length;
      const dt = new DataTransfer();
      dt.items.add(new File([arr], 'qa-gate.abr', { type: 'application/octet-stream' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (inkState().brushes.length > before) break;
      }
      await new Promise(r => setTimeout(r, 700));
      const added = inkState().brushes.slice(before);
      const target = added[0] || null;
      if (!target) return JSON.stringify({ error: 'içe aktarılan fırça yok' });
      const inCustom = inkNativeBrushesForCategory('custom').some(b => b.id === target.id);
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: false });
      inkNativeBrushUi.activeCategory = 'custom';
      inkNativeRenderBrushList();
      const card = [...document.querySelectorAll('#nativeBrushList .nbBrushCard')]
        .some(c => c.dataset.brushId === target.id);
      const img = inkRuntimeBrushes.abrImages.get(target.tipId);
      return JSON.stringify({
        id: target.id, name: target.name, category: target.category, badge: target.badge,
        inCustom, card, tipData: inkRuntime.importedTips.has(target.tipId),
        tipW: img ? img.naturalWidth : 0,
        notice: (window.__qaNotices || []).slice(-1),
      });
    })()`);
    console.log('· .abr import:', JSON.stringify(imported));
    check('içe aktarılan .abr Custom Brushes kategorisine düşüyor',
      imported.category === 'custom' && imported.badge === 'Custom' && imported.inCustom,
      `${imported.category}/${imported.badge}`);
    check('içe aktarılan .abr kütüphane kartında görünüyor',
      imported.card === true, imported.id);
    check('içe aktarılan .abr ucu yükleniyor',
      imported.tipData && imported.tipW > 0, `${imported.tipW}px`);
    check('içe aktarma kullanıcıya bildiriliyor',
      (imported.notice || []).some(n => /imported/i.test(n)), (imported.notice || []).join(' | '));

    /* ---- çoklu fırça .abr (3 kayıt tek dosyada) ---- */
    const multi = await app.json(`(async () => {
      const list = inkNativeVisibleBrushes().slice(0, 3);
      const bytes = inkNativeBrushesAbrBytes(list);
      const arr = new Uint8Array(bytes);
      const input = document.getElementById('inkAbrInput');
      const before = inkState().brushes.length;
      const dt = new DataTransfer();
      dt.items.add(new File([arr], 'qa-multi.abr', { type: 'application/octet-stream' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 80; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (inkState().brushes.length >= before + list.length) break;
      }
      await new Promise(r => setTimeout(r, 900));
      const added = inkState().brushes.slice(before);
      return JSON.stringify({
        exported: list.length,
        added: added.length,
        allCustom: added.every(b => b.category === 'custom' && b.badge === 'Custom'),
        names: added.map(b => b.name),
        tips: added.every(b => b.tipId && inkRuntime.importedTips.has(b.tipId)),
      });
    })()`);
    console.log('· çoklu .abr:', JSON.stringify(multi));
    check('çoklu .abr tüm fırçaları Custom Brushes içine aktarıyor',
      multi.exported === 3 && multi.added === 3 && multi.allCustom && multi.tips,
      `${multi.exported}→${multi.added}`);

    /* ---- favori yıldızı listeyi başa sarmıyor ---- */
    const scroll = await app.json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const list = document.getElementById('nativeBrushList');
      inkNativeBrushUi.activeCategory = 'custom';
      inkNativeRenderBrushList();
      list.style.flex = '0 0 150px';
      list.style.height = '150px';
      await wait(120);
      const overflow = list.scrollHeight > list.clientHeight + 20;
      list.scrollTop = 80;
      const before = list.scrollTop;
      const card = list.querySelector('.nbBrushCard');
      const star = card && card.querySelector('.nbBrushCard__star');
      if (star) star.click();
      await wait(400);
      const afterStar = list.scrollTop;
      const other = [...document.querySelectorAll('#nativeBrushCategories .nbCategory')]
        .find(btn => btn.dataset.category !== 'custom');
      if (other) other.click();
      await wait(150);
      const afterSwitch = list.scrollTop;
      list.style.flex = '';
      list.style.height = '';
      return JSON.stringify({ overflow, before, afterStar, afterSwitch,
        cards: list.querySelectorAll('.nbBrushCard').length });
    })()`);
    check('favori yıldızı liste kaydırmasını koruyor',
      scroll.overflow && scroll.before > 0 && scroll.afterStar === scroll.before,
      JSON.stringify(scroll));
    check('kategori değişimi listeyi başa sarıyor',
      scroll.afterSwitch === 0, 'scrollTop=' + scroll.afterSwitch);

    /* ---- gerçek dünya biçimleri: legacy v1/v2, samp-önce set, 16-bit ---- */
    const formatIds = [];
    const qaFormats = [
      {
        name: 'legacy-v1.abr',
        bytes: qaAbrLegacy([qaAbrTipEntry(24), qaAbrTipEntry(24, { rle: true })]),
        expect: 2,
        label: 'v1/v2 · 39 baytlık başlık · 2 uç',
      },
      {
        name: 'samp-first-16bit.abr',
        bytes: qaAbrV6([
          qaAbrSampBlock([qaAbrTipEntry(24, { depth: 16 }), qaAbrTipEntry(24, { depth: 16, rle: true })]),
          qaAbrDescBlock('Samp Set'),
        ]),
        expect: 2,
        label: 'samp-önce set · 16-bit uçlar',
      },
      {
        name: 'cbsh-16bit-rle.abr',
        bytes: qaAbrV6([
          qaAbrDescBlock('16bit RLE'),
          qaAbrCbshBlock(40),
          qaAbrSampBlock([qaAbrTipEntry(24, { depth: 16, rle: true })]),
        ]),
        expect: 1,
        label: 'v6 cbsh · 16-bit RLE uç',
      },
    ];
    for (const fx of qaFormats) {
      const b64 = fx.bytes.toString('base64');
      const res = await app.json(`(async () => {
        const raw = atob(${JSON.stringify(b64)});
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        const parsed = inkParseAbr(arr);
        const input = document.getElementById('inkAbrInput');
        const before = inkState().brushes.length;
        const dt = new DataTransfer();
        dt.items.add(new File([arr], ${JSON.stringify(fx.name)}, { type: 'application/octet-stream' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        for (let i = 0; i < 80; i++) {
          await new Promise(r => setTimeout(r, 100));
          if (inkState().brushes.length >= before + ${fx.expect}) break;
        }
        await new Promise(r => setTimeout(r, 800));
        const added = inkState().brushes.slice(before);
        return JSON.stringify({
          parsed: parsed.length,
          sizes: parsed.map(t => (t.width || t.sampledWidth || 0) + 'x' + (t.height || t.sampledHeight || 0)),
          added: added.length,
          ids: added.map(b => b.id),
          allCustom: added.every(b => b.category === 'custom'),
          tips: added.every(b => b.tipId && inkRuntime.importedTips.has(b.tipId)),
          error: inkRuntime.lastAbrError || '',
        });
      })()`);
      formatIds.push(...res.ids);
      check(`.abr ${fx.label}`, 
        res.parsed === fx.expect && res.added === fx.expect && res.allCustom && res.tips && !res.error,
        `${res.parsed} uç · ${res.added} fırça · ${res.sizes.join(',')}${res.error ? ' · ' + res.error : ''}`);
    }

    /* ---- bozuk .abr ---- */
    const bad = await app.json(`(async () => {
      const before = inkState().brushes.length;
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], 'bozuk.abr', { type: 'application/octet-stream' }));
      const input = document.getElementById('inkAbrInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));
      return JSON.stringify({
        before, after: inkState().brushes.length,
        notice: (window.__qaNotices || []).slice(-1),
        errors: window.__qaErrs.slice(),
      });
    })()`);
    check('bozuk .abr çökme yaratmıyor ve anlaşılır hata veriyor',
      bad.after === bad.before && bad.errors.length === 0 &&
      (bad.notice || []).some(n => /ABR could not be read/i.test(n)),
      (bad.notice || []).join(' | '));

    const firstIds = { a: created.a && created.a.id, b: created.b && created.b.id, c: created.c, abr: imported.id, formats: formatIds,
      mover: created.moverId, moveCat: created.moveCatId };
    await app.stop();
    app = null;

    /* ================= 2. OTURUM (uygulama yeniden açıldı) ================= */
    app = await launch(DEBUG_B, userData);

    /* .abr uç görselleri asenkron çözülür; kart/tip kontrolünden önce bekle. */
    await app.evaluate(`(async () => {
      const ids = ${JSON.stringify([firstIds.b, firstIds.abr])};
      for (let i = 0; i < 50; i++) {
        const ok = ids.every(id => {
          const b = inkState().brushes.find(x => x.id === id);
          return !b || !b.tipId || inkRuntimeBrushes.abrImages.has(b.tipId);
        });
        if (ok) return true;
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    })()`);

    const after = await app.json(`(async () => {
      const ink = inkState();
      const by = id => ink.brushes.find(b => b.id === id) || null;
      const a = by(${JSON.stringify(firstIds.a)});
      const b = by(${JSON.stringify(firstIds.b)});
      const c = by(${JSON.stringify(firstIds.c)});
      const abr = by(${JSON.stringify(firstIds.abr)});
      const mover = by(${JSON.stringify(firstIds.mover)});
      const db = await idbGet('meta', 'ink:brushes');
      const lib = await idbGet('meta', 'ink:library');
      const visibleIds = inkNativeVisibleBrushes().map(x => x.id);
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: false });
      inkNativeBrushUi.activeCategory = 'custom';
      inkNativeRenderBrushList();
      const customCards = [...document.querySelectorAll('#nativeBrushList .nbBrushCard')]
        .map(card => card.dataset.brushId);
      inkNativeBrushUi.activeCategory = ${JSON.stringify(firstIds.moveCat)};
      inkNativeRenderBrushList();
      const moveCards = [...document.querySelectorAll('#nativeBrushList .nbBrushCard')]
        .map(card => card.dataset.brushId);
      return JSON.stringify({
        a: a && { id: a.id, name: a.name, category: a.category },
        b: b && { id: b.id, name: b.name, tipId: b.tipId,
          tipData: inkRuntime.importedTips.has(b.tipId),
          imgW: inkRuntimeBrushes.abrImages.has(b.tipId)
            ? inkRuntimeBrushes.abrImages.get(b.tipId).naturalWidth : 0 },
        cVisible: !!c && visibleIds.includes(c.id),
        abr: abr && { id: abr.id, name: abr.name, category: abr.category,
          tipData: inkRuntime.importedTips.has(abr.tipId) },
        abrCard: !!abr && customCards.includes(abr.id),
        mover: mover && { id: mover.id, category: mover.category,
          card: moveCards.includes(mover.id) },
        formats: ${JSON.stringify(firstIds.formats)}.map(id => {
          const b = inkState().brushes.find(x => x.id === id);
          return b ? { id, category: b.category,
            tip: !!(b.tipId && inkRuntime.importedTips.has(b.tipId)),
            card: customCards.includes(b.id) } : null;
        }),
        categoryVisible: inkNativeVisibleCategories().some(x => x.name === ${JSON.stringify(CATEGORY)}),
        favorites: lib && lib.favorites ? lib.favorites : [],
        deleted: lib && lib.deletedBrushIds ? lib.deletedBrushIds : [],
        dbNames: Array.isArray(db) ? db.map(r => r && r.brush ? r.brush.name : null) : [],
        errors: window.__qaErrs.slice(),
      });
    })()`);
    console.log('· 2. oturum:', JSON.stringify(after));

    check('prosedürel fırça yeniden açılışta duruyor',
      !!after.a && after.a.category === created.categoryId, after.a && after.a.name);
    check('özel kategori yeniden açılışta duruyor',
      after.categoryVisible === true, CATEGORY);
    check('PNG uçlu fırça ucuyla birlikte yeniden açılışta duruyor',
      !!after.b && after.b.tipData && after.b.imgW > 0, `${after.b && after.b.imgW}px`);
    check('içe aktarılan .abr yeniden açılışta Custom Brushes içinde',
      !!after.abr && after.abr.category === 'custom' && after.abr.tipData && after.abrCard,
      after.abr && `${after.abr.name} · kart=${after.abrCard}`);
    check('legacy/16-bit .abr fırçaları yeniden açılışta uçlarıyla duruyor',
      Array.isArray(after.formats) && after.formats.length === 5 &&
      after.formats.every(f => f && f.category === 'custom' && f.tip && f.card),
      `${(after.formats || []).filter(f => f && f.tip).length}/${(after.formats || []).length} uçlu`);
    check('silinen fırça yeniden açılışta geri gelmiyor',
      after.cVisible === false && after.deleted.includes(firstIds.c), firstIds.c);
    check('favori yıldızı yeniden açılışta korunuyor',
      after.favorites.includes(firstIds.a), after.favorites.length + ' favori');
    check('taşınan fırça yeniden açılışta yeni kategorisinde kalıyor',
      !!after.mover && after.mover.category === firstIds.moveCat && after.mover.card,
      after.mover && (after.mover.category + ' · kart=' + after.mover.card));
    check('yeniden açılışta sayfa hatası yok',
      after.errors.length === 0, after.errors.join(' | '));
  } finally {
    if (app) await app.stop();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* kilitli olabilir */ }
  }

  console.log(fail === 0
    ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
    : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => {
  console.error('TEST HATASI:', err && err.message ? err.message : err);
  process.exit(1);
});
