'use strict';

/* Tuval dışından içeriye çizim testi.

   Kapsam:
   • Tuval (görsel) dışında başlayıp içeri giren fırça vuruşu oluşturuyor mu?
   • Vuruş tam sınır noktasından başlıyor mu, içeride mi kalıyor?
   • Tuval dışında başlayıp hiç içeri girmeden bırakılan basış vuruş açmıyor mu?
   • Tuval içinde başlayıp dışarı çıkıp tekrar giren vuruş tek parça kalıyor mu?
   • Normal (tamamen içeride) fırça vuruşu bozulmadı mı?

   Kullanım: node scripts/ink-outside-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
/* 9341/5204 test:commit ile aynıydı: electron kapanmadan yeni takım
   başlarsa port çakışması sahte BAŞARISIZ üretiyordu (17 Kasım). Bu
   takım kendi portlarını kullanır. */
const PORT = 9342;
const APP_PORT = 5205;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const electronPath = () => path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
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

async function waitForTarget(deadlineMs = 30000) {
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-outside-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3' };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  const errors = [];
  let ws = null;
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(d.exception?.description || d.text || 'bilinmeyen hata');
      }
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    const result = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};

      // Yeni tuval akışında modeDrawBtn boş tahtada YENİ TUVAL
      // modalını açar; eski "modal.hidden=true" gizlemesi artık
      // işlemez (uygulama modalı yeniden görünür yapıyor).
      // referans uygulama-layer-test deseni: click → modal açıldıysa alanları
      // doldur ve submit et.
      // click → modal açılıyorsa alanları doldur ve submit et.
      document.getElementById('modeDrawBtn').click();
      await wait(600);
      const modal = document.getElementById('newCanvasModal');
      if (!inkEditorIsOpen() && modal && !modal.hidden) {
        const wEl = document.getElementById('newCanvasW');
        const hEl = document.getElementById('newCanvasH');
        if (wEl && !wEl.value) wEl.value = '1200';
        if (hEl && !hEl.value) hEl.value = '800';
        const submit = document.getElementById('newCanvasCreate');
        const form = document.getElementById('newCanvasForm');
        if (submit) submit.click(); else if (form) form.requestSubmit();
        await wait(900);
      }
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      out.editorOpen = inkEditorIsOpen();
      if (!out.editorOpen) return JSON.stringify(out);

      const item = state.items.find(it => it.id === inkEditorUi.itemId);
      out.item = !!item;
      out.itemTitle = item ? item.title : '';
      if (!item) return JSON.stringify(out);

      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      const fit = inkEditorUi.fit;
      out.fit = { x: Math.round(fit.x), y: Math.round(fit.y), w: Math.round(fit.w), h: Math.round(fit.h) };
      // Görsel dışına taşan boşluğun büyük olduğu ekseni seç.
      out.axis = fit.x >= fit.y ? 'x' : 'y';
      out.margin = Math.round(Math.max(fit.x, fit.y));
      const pt = (lx, ly) => ({
        clientX: rect.left + fit.x + lx * fit.w,
        clientY: rect.top + fit.y + ly * fit.h,
      });
      const fire = (type, p) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 91, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: p.clientX, clientY: p.clientY,
      }));

      const countStrokes = () => inkLayersForOwner(item.id)
        .reduce((n, l) => n + (l.strokes || []).length, 0);
      const allStrokes = () => inkLayersForOwner(item.id)
        .flatMap(l => (l.strokes || []).map(s => ({ layerId: l.id, stroke: s })));

      inkSetTool('brush');

      // 1) Dışarıdan içeriye: sol/üst boşluktan gir.
      const beforeOutsideIn = countStrokes();
      const outsideStart = out.axis === 'x'
        ? pt(-0.35, 0.42)
        : pt(0.42, -0.35);
      const entry = out.axis === 'x'
        ? pt(0.0, 0.42)
        : pt(0.42, 0.0);
      const inside = out.axis === 'x'
        ? pt(0.28, 0.5)
        : pt(0.5, 0.28);
      fire('pointerdown', outsideStart);
      out.armed = !!inkEditorUi.pendingStroke;
      fire('pointermove', entry);
      fire('pointermove', inside);
      fire('pointerup', inside);
      await wait(600);
      out.outsideInAdded = countStrokes() - beforeOutsideIn;
      const added = allStrokes().filter(x => x.stroke.id && x.stroke.kind !== 'shape');
      const strokeOut = added[added.length - 1]?.stroke || null;
      if (strokeOut) {
        const pts = strokeOut.points || [];
        const first = pts[0] || {};
        const last = pts[pts.length - 1] || {};
        out.outsideInFirst = { x: +first.x.toFixed(3), y: +first.y.toFixed(3) };
        out.outsideInLast = { x: +last.x.toFixed(3), y: +last.y.toFixed(3) };
        out.outsideInPoints = pts.length;
        out.outsideInInside = pts.every(p => p.x >= -1e-6 && p.x <= 1 + 1e-6 && p.y >= -1e-6 && p.y <= 1 + 1e-6);
        out.outsideInBoundary = out.axis === 'x'
          ? Math.abs(first.x) <= 0.02
          : Math.abs(first.y) <= 0.02;
      }

      // 2) Dışarıda başlayıp içeri girmeden bırak: vuruş açılmamalı.
      const beforeCancel = countStrokes();
      const far = out.axis === 'x' ? pt(-0.35, 0.7) : pt(0.7, -0.35);
      const far2 = out.axis === 'x' ? pt(-0.2, 0.72) : pt(0.72, -0.2);
      fire('pointerdown', far);
      fire('pointermove', far2);
      fire('pointerup', far2);
      await wait(400);
      out.outsideCancelAdded = countStrokes() - beforeCancel;
      out.pendingCleared = !inkEditorUi.pendingStroke && !inkEditorUi.stroke;

      // 3) İçeride başla, dışarı çık, tekrar gir: tek vuruş.
      const beforeCross = countStrokes();
      const c0 = out.axis === 'x' ? pt(0.3, 0.7) : pt(0.7, 0.3);
      const c1 = out.axis === 'x' ? pt(0.85, 0.7) : pt(0.7, 0.85);
      const outPoint = out.axis === 'x' ? pt(1.3, 0.7) : pt(0.7, 1.3);
      const c2 = out.axis === 'x' ? pt(0.6, 0.75) : pt(0.75, 0.6);
      // Not: Olayları ritimli gönder (her ham arası kısa bekleme) —
      // gerçek imleç dizisinde ms aralığı var; sıfır-aralıklı senkron
      // dizi One-Euro stabilizatörü yetiştiremez ve kenar-kırpması
      // noktaları hiç üretmeden filtre lagde kalır.
      fire('pointerdown', c0);
      await wait(60);
      fire('pointermove', c1);
      await wait(60);
      fire('pointermove', outPoint);
      await wait(60);
      fire('pointermove', c2);
      await wait(30);
      fire('pointerup', c2);
      await wait(600);
      out.crossAdded = countStrokes() - beforeCross;
      const crossStrokes = allStrokes().filter(x => x.stroke.kind !== 'shape');
      const cross = crossStrokes[crossStrokes.length - 1]?.stroke || null;
      if (cross) {
        const pts = cross.points || [];
        out.crossPoints = pts.length;
        out.crossInside = pts.every(p => p.x >= -1e-6 && p.x <= 1 + 1e-6 && p.y >= -1e-6 && p.y <= 1 + 1e-6);
        out.crossReachedEdge = out.axis === 'x'
          ? pts.some(p => p.x > 0.98)
          : pts.some(p => p.y > 0.98);
      }

      // 4) Tamamen içeride normal vuruş.
      const beforeNormal = countStrokes();
      const n0 = pt(0.15, 0.15);
      const n1 = pt(0.4, 0.2);
      fire('pointerdown', n0);
      for (let i = 1; i <= 5; i += 1) fire('pointermove', pt(0.15 + 0.25 * i / 5, 0.15 + 0.05 * i / 5));
      fire('pointerup', n1);
      await wait(500);
      out.normalAdded = countStrokes() - beforeNormal;

      out.errors = window.__checkErrs || [];
      return JSON.stringify(out);
    })()`));

    check('çizim editörü açıldı', result.editorOpen === true, '');
    check('görsel dışında yeterli boşluk var', (result.margin || 0) > 20,
      `eksen=${result.axis} boşluk=${result.margin}px · fit=${JSON.stringify(result.fit)}`);
    check('dışarıda basınca vuruş beklemede (armed)', result.armed === true, '');
    check('dışarıdan içeriye çizim vuruş oluşturdu', result.outsideInAdded === 1,
      `${result.outsideInAdded || 0} vuruş · nokta=${result.outsideInPoints || 0}`);
    check('vuruş tam sınır noktasından başladı', result.outsideInBoundary === true,
      `ilk=${JSON.stringify(result.outsideInFirst)}`);
    check('vuruş noktaları tuval içinde kaldı', result.outsideInInside === true,
      `son=${JSON.stringify(result.outsideInLast)}`);
    check('içeri girmeden bırakılan basış vuruş açmadı', result.outsideCancelAdded === 0,
      `${result.outsideCancelAdded || 0} vuruş · bekleme temiz=${result.pendingCleared}`);
    check('içeriden çıkıp tekrar giren vuruş tek parça', result.crossAdded === 1 && result.crossReachedEdge === true,
      `${result.crossAdded || 0} vuruş · nokta=${result.crossPoints || 0} · kenara ulaştı=${result.crossReachedEdge}`);
    check('çıkış sırasında taşan nokta yok', result.crossInside === true, '');
    check('normal fırça vuruşu bozulmadı', result.normalAdded === 1, `${result.normalAdded || 0} vuruş`);
    check('sayfada çalışma zamanı hatası yok',
      Array.isArray(result.errors) && result.errors.length === 0 && errors.length === 0,
      [...(result.errors || []), ...errors].join(' | ') || '');
  } catch (err) {
    console.error('TEST HATASI:', err.message);
    fail += 1;
  } finally {
    try { ws && ws.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* sessiz */ }
  }

  console.log(`\n${fail === 0 ? 'TÜMÜ GEÇTİ' : 'BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
