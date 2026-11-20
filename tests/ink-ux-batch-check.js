'use strict';

/* UX yama topluluğu perması (09.11 raporları):
   1. Çerçeve (beyaz parlama): bölgesel yollarda çerçevenin üstüne
      üstüne basması alfa biriktiriyordu; artık yalnız tam-yol karesi
      çerçeveyi basar (clearRect sonrası) → kenar alfası SABİT kalmalı.
   2. Bırakış gecikmesi: commit yakınsaması tüm karoları tek karede
      boyuyordu; bütçeli drenaj ile bırakış sonrası kareler kısa kalmalı.
   3. Hız vuruş: karo boyaması tam kutu yerine bölge kesişimine
      indirildi; vuruş sırasında uzun kare oranı düşük kalmalı.
   4. Delete: seçim yokken Delete aktif katmanı siler (son katman
      ise içeriğini temizler), Ctrl+Z geri alır.
   5. Sağ tık renk çarkı: durum önbelleği — hex değişmedikçe çevrimde
      aynı (h,s,v) döner, çift yönlü titreme olmaz.

   Kullanım: node tests/ink-ux-batch-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9348;
const APP_PORT = 5214;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-ux-batch-'));
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
    await send(ws, 'Page.enable');

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    const out = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const modal = document.getElementById('newCanvasModal');

      // 1) Orta boy düz tuval, tek katman.
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '1400';
      document.getElementById('newCanvasH').value = '1050';
      document.getElementById('newCanvasName').value = 'UX Kümesi';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 120 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      out.editorOpen = inkEditorIsOpen();
      if (!out.editorOpen) return JSON.stringify(out);

      await wait(300);
      const slave = document.getElementById('inkEditorSlave');
      out.tileViewOn = !!inkEditorUi.tileViewOn;

      // Çark önbelleği (kontrol 5) — editörde de geçerli.
      try {
        const stA = inkRadialWheelState();
        const sameRef = inkRadialWheelState() === stA;
        const stB = inkRadialWheelState();
        const sameRef2 = inkRadialWheelState() === stB;
        out.wheel = {
          aynıNesne: !!sameRef && !!sameRef2,          hex: String(inkState().color || '').toLowerCase(),
        };
      } catch (e) { out.wheel = { hata: String(e && e.message || e) }; }

      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      out.fit = { w: Math.round(fit.w), h: Math.round(fit.h) };

      const rect = canvas.getBoundingClientRect();
      const toClient = (nx, ny) => ({
        clientX: rect.left + fit.x + nx * fit.w,
        clientY: rect.top + fit.y + ny * fit.h,
      });
      const ev = (type, p, extra) => new PointerEvent(type, Object.assign({
        bubbles: true, composed: true, cancelable: true,
        pointerId: 11, pointerType: 'mouse', isPrimary: true,
        clientX: p.clientX, clientY: p.clientY,
      }, extra));

      inkSetTool('brush', { brushId: 'ink-hard' });
      const ink = inkState();
      ink.size = 40;
      ink.opacity = 1;
      ink.smoothing = 0.2;
      ink.color = '#33bb88';
      await wait(120);

      const ctx = canvas.getContext('2d');
      const dpp = canvas.width / Math.max(0.01, rect.width); // dpr

      /* Çerçeve kenarı: fit sınırındaki device piksel bandı (soldan
         dikey şerit + üstten yatay şerit, bölüm ortasında). */
      const bxF = Math.round((fit.x + 0.5) * dpp);
      const byF = Math.round((fit.y + 0.5) * dpp);
      const edge = () => {
        try {
          const x0 = Math.max(0, bxF - 2);
          const y0 = Math.max(0, byF - 2);
          const w = 16, hMid = 64;
          const rx = Math.round((fit.y + fit.h * 0.45) * dpp);
          const a1 = ctx.getImageData(x0, rx, w, hMid).data;
          const cx = Math.round((fit.x + fit.w * 0.45) * dpp);
          const a2 = ctx.getImageData(cx, y0, hMid, w).data;
          /* Beyazlaşma sayacı: kanal toplamı — çerçeve üstüne üstüne
             basılsa her geçişte karanlık kenar görüntüleri beyaza
             kayardı; sabit kalmalı. */
          let cs = 0;
          for (const d of [a1, a2]) {
            for (let i = 0; i < d.length; i += 4) cs += d[i] + d[i + 1] + d[i + 2];
          }
          return cs;
        } catch { return -1; }
      };
      // Zemin çizgisi: vuruş öncesi kenar (damalı zemin + ilk kare).
      out.kenar0 = edge();
      // Bir tam kare boyaması zorla: undo yok → geçersiz kılma.
      inkEditorInvalidate();
      await wait(120);
      out.kenarSıfır = edge();

      /* Kare süresi ölçer: rAF dt'lerini pencere boyunca toplar. */
      const ölç = async (ms) => {
        const dts = [];
        let last = performance.now();
        const t0 = last;
        while (performance.now() - t0 < ms) {
          await new Promise(r => requestAnimationFrame(r));
          const now = performance.now();
          dts.push(now - last);
          last = now;
        }
        dts.sort((a, b) => a - b);
        return {
          n: dts.length,
          med: Math.round(dts[dts.length >> 1] * 10) / 10,
          p95: Math.round(dts[Math.min(dts.length - 1, Math.floor(dts.length * 0.95))] * 10) / 10,
          max: Math.round(dts[dts.length - 1] * 10) / 10,
          utuz25: dts.filter(d => d > 25).length,
          utuz33: dts.filter(d => d > 33).length,
        };
      };

      /* Boş taban: bu ortamın sıfır yük kare cadansı (test makinesi
         jelent throttling'i ile karşılaştırma — kapı eşikleri
         buna göre görecelinir). */
      out.taban = await ölç(600);
      await wait(120);

      /* Çizim yardımcıları: A→B kısa vuruş (8 ara adım, ~60 ms). */
      const strokeAB = async (ax, ay, bx, by, hold) => {
        const a = toClient(ax, ay);
        const b = toClient(bx, by);
        canvas.dispatchEvent(ev('pointerdown', a, { button: 0, buttons: 1 }));
        for (let i = 1; i <= 8; i += 1) {
          canvas.dispatchEvent(ev('pointermove', {
            clientX: a.clientX + (b.clientX - a.clientX) * (i / 8),
            clientY: a.clientY + (b.clientY - a.clientY) * (i / 8),
          }, { button: 0, buttons: 1 }));
          await wait(hold);
        }
        canvas.dispatchEvent(ev('pointerup', b, { button: 0, buttons: 0 }));
      };

      const sig = () => {
        const art = (inkState().artDoc || null);
        const L = [];
        for (const lyr of inkState().layers) {
          L.push({ id: lyr.id, s: (lyr.strokes || []).length });
        }
        return JSON.stringify({ L: L.length, ilk: L[0] && L[0].s, m: L.map(l => l.s).join(',') });
      };

      // 2) Çerçeve birikimi: 4 vuruş; her vuruş sonrası kenar alfası
      //    ölçülür — sabit kalmalı (parlama yok).
      out.kenarDizi = [];
      for (let k = 0; k < 4; k += 1) {
        await strokeAB(0.2 + k * 0.02, 0.28, 0.75, 0.32, 12);
        await wait(420);           // yakınsama + kare düşer
        out.kenarDizi.push(edge());
      }
      const kd = out.kenarDizi;
      const kdMax = Math.max.apply(null, kd.filter(v => v >= 0));
      out.kenarMaks = kdMax;

      // 3) Bırakış penceresi: uzun bırakış + 600 ms kare ölçümü.
      const a2 = toClient(0.15, 0.6);
      const b2 = toClient(0.9, 0.68);
      canvas.dispatchEvent(ev('pointerdown', a2, { button: 0, buttons: 1 }));
      for (let i = 1; i <= 30; i++) {
        const t = i / 30;
        canvas.dispatchEvent(ev('pointermove', {
          clientX: a2.clientX + (b2.clientX - a2.clientX) * t,
          clientY: a2.clientY + (b2.clientY - a2.clientY) * t,
        }, { button: 0, buttons: 1 }));
        await wait(6);
      }
      canvas.dispatchEvent(ev('pointerup', b2, { button: 0, buttons: 0 }));
      out.unlock = await ölç(600);

      // 4) Hız vuruş: sarmal doldurma — vuruş sırasında dt ölçümü.
      const hızP = []; {
        const cx2 = toClient(0.5, 0.5);
        let ang = 0, r = 0.18;
        canvas.dispatchEvent(ev('pointerdown', {
          clientX: cx2.clientX + 0, clientY: cx2.clientY - r * fit.h,
        }, { button: 0, buttons: 1 }));
        let last = performance.now();
        const t0 = last;
        for (let i = 1; i <= 160 && t0 + 1600 > performance.now(); i += 1) {
          ang += 0.32;
          r = 0.05 + 0.22 * (0.5 + 0.5 * Math.sin(i * 0.11));
          canvas.dispatchEvent(ev('pointermove', {
            clientX: cx2.clientX + Math.sin(ang) * r * fit.w,
            clientY: cx2.clientY + Math.cos(ang) * r * fit.h,
          }, { button: 0, buttons: 1 }));
          await new Promise(res => requestAnimationFrame(res));
          const now = performance.now();
          hızP.push(now - last);
          last = now;
        }
        canvas.dispatchEvent(ev('pointerup', {
          clientX: cx2.clientX, clientY: cx2.clientY,
        }, { button: 0, buttons: 0 }));
      }
      hızP.sort((x, y) => x - y);
      out.hız = {
        n: hızP.length,
        med: Math.round(hızP[hızP.length >> 1] * 10) / 10,
        p95: Math.round(hızP[Math.min(hızP.length - 1, Math.floor(hızP.length * 0.95))] * 10) / 10,
        max: Math.round(hızP[hızP.length - 1] * 10) / 10,
        utuz25: hızP.filter(d => d > 25).length,
        utuz40: hızP.filter(d => d > 40).length,
      };
      await wait(900);
      out.hızKenarı = edge();

      // 5) Delete: tek katman → içeriği temizler; Ctrl+Z geri alır.
      const s0 = sig();
      out.sig0 = s0;
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Delete', bubbles: true, cancelable: true,
      }));
      await wait(250);
      const s1 = sig();
      out.sig1 = s1;
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      await wait(250);
      const s2 = sig();
      out.sig2 = s2;
      // Tekrarı: Delete → içeriği temizle → yalnız bu kez kalıcı
      // dönemi dengeleyelim (aynı geçiş zaten güvenilir).
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Backspace', bubbles: true, cancelable: true,
      }));
      await wait(250);
      const s3 = sig();
      out.sig3 = s3;

      // 6) Katman ekle → Delete katmanı silsin.
      try {
        const nBefore = inkState().layers.length;
        inkDocAddLayer();
        await wait(200);
        out.katmanEkle = { önce: nBefore, sonra: inkState().layers.length };
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Delete', bubbles: true, cancelable: true,
        }));
        await wait(250);
        out.katmanSil = inkState().layers.length;
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
        }));
        await wait(250);
        out.katmanGeri = inkState().layers.length;
      } catch (e) { out.katmanHata = String(e && e.message || e); }

      out.errors = null;
      return JSON.stringify(out);
    })()`));
    console.log('rapor:', JSON.stringify(out));

    check('editör açıldı', out.editorOpen === true);

    // Çark: önbellek — ardışık çağrı daima aynı nesne.
    check('çark önbelleği (aynı nesne × ardışık)',
      !!(out.wheel && out.wheel.aynıNesne === true),
      JSON.stringify(out.wheel || {}));

    // Çerçeve: kenar RGB toplamı sıfır karedeki değerle tutarlı kalır
    // (üstüne basma → beyazlaşma → toplam artardı; sabit kalmalı).
    const kd = out.kenarDizi || [];
    const kdOk = kd.length === 4 && kd.every(v => v >= 0) &&
      Math.abs(kd[3] - out.kenarSıfır) <= 4; // toplamda < %0.001 sapma
    check('çerçeve: kenar alfa birikmiyor (4 vuruş)', kdOk,
      `dizi=${JSON.stringify(kd)} · sıfır kare=${out.kenarSıfır}`);

    // Bırakış penceresi: 600 ms'de uzun kare sayısı taban katmanıyla
    // göreceli bakılır (ortam düşük yağlı rAF kullanıyor olabilir).
    const tb = out.taban || { p95: 17, utuz33: 0 };
    check('bırakış: uzun kare (>33 ms) tabana göre',
      out.unlock && out.unlock.utuz33 <= tb.utuz33 + 2 &&
        out.unlock.p95 <= tb.p95 + 14,
      `taban=${JSON.stringify(tb)} · ölçüm=${JSON.stringify(out.unlock || {})}`);

    // Hız vuruş: vuruş sırasında p95/uzun kare tabana göre.
    check('hız vuruş: p95 tabana göre makul',
      out.hız && out.hız.p95 <= Math.max(60, tb.p95 + 16) &&
        out.hız.utuz40 <= tb.utuz33 + 12,
      `taban=${JSON.stringify(tb)} · ölçüm=${JSON.stringify(out.hız || {})}`);

    // Delete: temizleme + geri alma; imza eşliği.
    check('Delete: içeriği temizler + Ctrl+Z geri alır',
      out.sig1 !== out.sig0 && out.sig2 === out.sig0,
      `s0=${out.sig0} · s1=${out.sig1} · s2=${out.sig2}`);
    check('Delete tekrarı çalışır', out.sig3 !== out.sig2 || out.sig3 === out.sig1,
      `s3=${out.sig3}`);

    check('katman silme: katman sayısı dörder?',
      out.katmanEkle && out.katmanEkle.sonra === out.katmanEkle.önce + 1 &&
      out.katmanSil === out.katmanEkle.önce && out.katmanGeri === out.katmanEkle.önce + 1,
      JSON.stringify({ ekle: out.katmanEkle, sil_n: out.katmanSil, geri_n: out.katmanGeri, hata: out.katmanHata }));

    check('sayfada çalışma zamanı hatası yok', errors.length === 0,
      errors.slice(0, 3).join(' | '));
  } catch (err) {
    fail += 1;
    console.error('HATA:', err && err.message || err);
  } finally {
    try { if (ws) ws.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
  }

  console.log(pass + ' geçti · ' + fail + ' kaldı');
  process.exit(fail ? 1 : 0);
})();
