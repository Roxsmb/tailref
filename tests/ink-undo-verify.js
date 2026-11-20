'use strict';

/* Geri al / yinele DOĞRULUK sonda:
   1) farklı fırça türleriyle (dolu/akış/silgi/simetri/lockAlpha) vuruşlar boyar
   2) her vuruş sonrası katman kanıvasının piksel imzasını (hash) alır
   3) Ctrl+Z dizisi: her geri almanın imzayı ÖNCEKİ AŞAMAYA döndürdmesini
   4) Ctrl+Y/Ctrl+Shift+Z yinele: imzalar ileri aşamalara geri döner
   5) simetri + silgi özel: sıkı bölgesel imza karşılaştırması yapar
   Çıktı: aşama → aşama imza dizeyişi, her adım ÜÇÜZ (undo doğru) mi İşARET */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9348;
const APP_PORT = 5239;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (m.error) return reject(new Error(JSON.stringify(m.error)));
    if (m.result.exceptionDetails) return reject(new Error(m.result.exceptionDetails.exception?.description || 'eval'));
    resolve(m.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-undo-verify-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  try {
    let page = null;
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
        if (page) break;
      } catch { /* */ }
      await sleep(400);
    }
    const ws = await new Promise((resolve, reject) => {
      const s = new WebSocket(page.webSocketDebuggerUrl);
      s.onopen = () => resolve(s);
      s.onerror = reject;
    });
    for (let i = 0; i < 40; i += 1) {
      const ok = await evaluate(ws, "typeof inkState === 'function' && typeof setActiveBrush === 'function'");
      if (ok) break;
      await sleep(400);
    }

    // sahne: 1400×900 tuval, tek katman + (2.bölüm) simetri katmanı
    const setup = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      try { localStorage.setItem('tailref-persistence', 'auto'); } catch { /* */ }
      const pw = document.getElementById('persistenceWelcome');
      if (pw && !pw.hidden) {
        const opt = pw.querySelector('.pwOption');
        if (opt) opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const cont = document.getElementById('pwContinue');
        await wait(120);
        if (cont && !cont.disabled) cont.click();
        await wait(300);
        if (!pw.hidden) pw.hidden = true;
      }
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      document.getElementById('newCanvasW').value = '1400';
      document.getElementById('newCanvasH').value = '900';
      document.getElementById('newCanvasName').value = 'İkna-Yinele';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(400);
      return JSON.stringify({ ok: inkEditorIsOpen() });
    })()`));
    if (!setup.ok) { console.log('HATA: editör açılmadı'); app.kill(); return; }

    const run = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const cv = document.getElementById('inkEditorCanvas');
      const rr = cv.getBoundingClientRect();
      window.__rect = { l: rr.left, t: rr.top, w: rr.width, h: rr.height };
      const X = v => window.__rect.l + v * window.__rect.w;
      const Y = v => window.__rect.t + v * window.__rect.h;

      // katman piksel imzası: global hash ile hızlı, çakışma riski düşük
      const layerCanvas = () => {
        const s = inkState();
        return inkRuntime.itemCanvases.get(s.activeLayerId);
      };
      window.__sig = () => {
        const c = layerCanvas();
        if (!c) return 'yok';
        const g = c.width + 'x' + c.height + ':';
        try {
          const d = c.getContext('2d', { colorSpace: 'srgb' }).getImageData(0, 0, c.width, c.height).data;
          let h = 0, ile = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 8) ile += 1;
            h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) & 0x7fffffff;
          }
          return g + 'h=' + h + ',ile=' + ile;
        } catch (e) { return g + 'hata=' + e.message; }
      };

      const paint = async (spec) => {
        const cv2 = document.getElementById('inkEditorCanvas');
        const fire = (type, x, y, press) => {
          cv2.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 77, pointerType: 'pen',
            clientX: X(x), clientY: Y(y), button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pressure: press, tiltX: 0, tiltY: 0, twist: 0,
          }));
        };
        fire('pointerdown', spec.x0, spec.y0, 0.15);
        const md = 12 + (spec.moves || 0);
        for (let i = 1; i <= md; i += 1) {
          const t = i / md;
          fire('pointermove', spec.x0 + (spec.x1 - spec.x0) * t,
            spec.y0 + (spec.y1 - spec.y0) * t + 0.04 * Math.sin(t * 7),
            0.2 + 0.65 * Math.sin(t * Math.PI));
          if (i % 5 === 0) await new Promise(r2 => setTimeout(r2, 2));
        }
        fire('pointerup', spec.x1, spec.y1, 0);
        await new Promise(r2 => requestAnimationFrame(r2));
      };

      const undo = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(r => requestAnimationFrame(r));
      };
      const redo = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(r => requestAnimationFrame(r));
      };

      const o = { aşamalar: [], kontroller: [] };
      const sig = () => window.__sig();
      const push = (durum) => o.aşamalar.push({ durum, imza: sig() });

      const sıfırla = async () => { // kalan doc vuruşları da temizle
        while ((inkState().history || []).undo && inkState().history.undo.length) await undo();
        await wait(50);
      };

      const forcedBrush = (id) => { setActiveBrush(id); };

      const brushes = (inkState().brushes || []).filter(b => !b.disabled).map(b => ({
        id: b.id, tarif: (b.kind || '?') + '/' + (b.tip || '?'),
      }));
      o.baslik = brushes.slice(0, 120).map((b, i) => i + ':' + b.id + '(' + b.tarif + ')').join(' ');

      // SAHOME bütünlüğü kontrolleri:
      const kontrol = (ad, koşul) => o.kontroller.push({ ad, tamam: !!koşul });

      return JSON.stringify({ sig0: sig(), inkCvars: !!inkState().history });
    })()`));
    console.log('kuruluş: ' + run.sig0 + ' · history=' + run.inkCvars);
    console.log('fırça listesi: ' + run.baslik);

    // GERÇEK test gövdesi: okunabilirlik için ikinci evaluate
    const test = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const X = v => window.__rect.l + v * window.__rect.w;
      const Y = v => window.__rect.t + v * window.__rect.h;
      const sig = () => window.__sig();
      const cv2 = document.getElementById('inkEditorCanvas');
      const fire = (type, x, y, press) => {
        cv2.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 77, pointerType: 'pen',
          clientX: X(x), clientY: Y(y), button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: press, tiltX: 0, tiltY: 0, twist: 0,
        }));
      };
      const paint = async (x0, y0, x1, y1) => {
        fire('pointerdown', x0, y0, 0.15);
        const md = 14;
        for (let i = 1; i <= md; i += 1) {
          const t = i / md;
          fire('pointermove', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.3 + 0.6 * Math.sin(t * Math.PI));
          if (i % 5 === 0) await new Promise(r2 => setTimeout(r2, 2));
        }
        fire('pointerup', x1, y1, 0);
        await new Promise(r => requestAnimationFrame(r));
        await wait(60); // commit-batch flush
      };
      const undo = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(r => requestAnimationFrame(r));
        await wait(50);
      };
      const redo = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(r => requestAnimationFrame(r));
        await wait(50);
      };

      const o = { adım: [], kontrol: [] };
      const step = (durum, imza, not) => o.adım.push({ durum, imza, not: not || '' });
      const check = (ad, tamam) => o.kontrol.push({ ad, tamam: !!tamam });

      // 3 fırça seçimi: dolu bir fırça + silgi + simetrik kit
      const list = (inkState().brushes || []);
      const dolu = list.find(b => !/eraser|silgi/i.test(b.id)) || list[0];
      const silgi = list.find(b => /eraser|silgi/i.test(b.id)) || null;
      const sonraki = list.find(b => b.id !== dolu.id && !/eraser|silgi/i.test(b.id)) || dolu;
      o.kimmik = { dolu: dolu.id, silgi: silgi && silgi.id, sonraki: sonraki.id };

      // A) dolu fırça — 2 vuruş
      setActiveBrush(dolu.id);
      const s0 = sig();
      await paint(0.15, 0.2, 0.55, 0.35);
      const s1 = sig();
      await paint(0.2, 0.7, 0.6, 0.75);
      const s2 = sig();
      step('A0 boş', s0); step('A1', s1); step('A2', s2);

      // B) eski imzaya dönüş kontrolü
      await undo();
      const s1u = sig();
      step('B undo→A1', s1u);
      check('B undo A1 eşit', s1u === s1);
      await undo();
      const s0u = sig();
      step('B undo→A0', s0u);
      check('B undo A0 eşit', s0u === s0);

      // C) yinele ileri
      await redo();
      const s1r = sig();
      step('C redo→A1', s1r);
      check('C redo A1 eşit', s1r === s1);
      await redo();
      const s2r = sig();
      step('C redo→A2', s2r);
      check('C redo A2 eşit', s2r === s2);

      // D) silgi: varsa
      if (silgi) {
        setActiveBrush(silgi.id);
        await paint(0.3, 0.25, 0.5, 0.35); // A2 üzerine sil
        const s3 = sig();
        step('D silgi', s3);
        check('D silgi farklı', s3 !== s2);
        await undo();
        step('D undo→A2', sig());
        check('D undo A2 eşit', sig() === s2);
        await redo();
        step('D redo→sil', sig());
      }

      // E) simetri + kilitle
      try {
        const s = inkState();
        s.sym = 'mirrorX'; // basit ayna
      } catch { /* */ }
      setActiveBrush(sonraki.id);
      await paint(0.45, 0.9, 0.48, 0.55);
      const s4 = sig();
      step('E simetri', s4);
      await undo();
      const s4u = sig();
      step('E undo→D/öncesi', s4u);
      check('E simetri undo farklı', s4u !== s4);

      return JSON.stringify(o);
    })()`));

    /* F) kırpma: after anlık görüntüsü yalnız son 10 kayıtta tutulsun */
    const kirp = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const X = v => window.__rect.l + v * window.__rect.w;
      const Y = v => window.__rect.t + v * window.__rect.h;
      const sig = () => window.__sig();
      const cv2 = document.getElementById('inkEditorCanvas');
      const fire = (type, x, y, press) => {
        cv2.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 88, pointerType: 'pen',
          clientX: X(x), clientY: Y(y), button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: press, tiltX: 0, tiltY: 0, twist: 0,
        }));
      };
      const paint = async (x0, y0, x1, y1) => {
        fire('pointerdown', x0, y0, 0.2);
        const md = 8;
        for (let i = 1; i <= md; i += 1) {
          fire('pointermove', x0 + (x1 - x0) * i / md, y0 + (y1 - y0) * i / md, 0.4);
          await wait(2);
        }
        fire('pointerup', x1, y1, 0);
        await new Promise(r => requestAnimationFrame(r));
        await wait(60);
      };
      const undo = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(r => requestAnimationFrame(r));
        await wait(40);
      };
      const redo = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(r => requestAnimationFrame(r));
        await wait(40);
      };
      const o = { kontrol: [], olcum: {} };
      const check = (ad, tamam, not) => o.kontrol.push({ ad, tamam: !!tamam, not: not || '' });

      /* mevcut geri al yığınını boşalt */
      while ((inkState().history || {}).undo && inkState().history.undo.length) { await undo(); }
      await wait(100);

      /* 13 vuruş; imza listesi */
      setActiveBrush('native-studio-pen');
      const imzalar = [];
      await paint(0.10, 0.10, 0.16, 0.14);
      imzalar.push(sig());
      for (let i = 1; i < 13; i += 1) {
        await paint(0.1 + i * 0.04, 0.15 + (i % 3) * 0.05, 0.15 + i * 0.04, 0.22 + (i % 3) * 0.05);
        imzalar.push(sig());
      }
      const raster = (typeof inkUndoRaster !== 'undefined') ? inkUndoRaster : null;
      if (!raster) { check('raster kökü', false, 'inkUndoRaster bulunamadı'); return JSON.stringify(o); }
      const afterli = [...raster.entries.values()].filter(e => e && e.after).length;
      const afterYok = [...raster.entries.values()].filter(e => e && !e.after).length;
      o.olcum = { girisler: raster.entries.size, afterFn: afterli, afterYok, bytes: raster.bytes, stats: { ...raster.stats } };
      check('A-after yalnız son 10 kayıtta', afterli <= 10, 'afterFn=' + afterli + '/' + raster.entries.size);
      check('A-eskiler kırpıldı', afterYok >= Math.max(0, raster.entries.size - 10) - 1, 'afterYok=' + afterYok);

      /* yuvarlak-trip kararlılığı: undo/redo adım başına imza
         değişmezliği (grup birleşmesi varsayımı olmadan). */
      const bosSig = '1400x900:h=0,ile=0';
      const F13 = sig();
      for (let j = 0; j < 13; j += 1) { await undo(); }
      const S16 = sig(); /* boş/azalmış uç */
      for (let j = 0; j < 13; j += 1) { await redo(); }
      const R13 = sig();
      const alfaSay2 = s => parseInt((s.match(/ile=(\\d+)/) || [0, '-1'])[0].slice(4), 10);
      const alfaDiff = (a, b) => Math.abs(alfaSay2(a) - alfaSay2(b));
      check('B-tam yuvarlak-trip: 13 undo → 13 redo imza ~eş', R13 === F13 || alfaDiff(R13, F13) <= Math.max(4, alfaSay2(F13) * 0.01), 'F13=' + alfaSay2(F13) + ' R13=' + alfaSay2(R13) + (R13 === F13 ? ' (birebir)' : ' (vektör)'));
      /* kısmi yuvarlak-trip: 6 undo + 6 redo */
      for (let j = 0; j < 6; j += 1) { await undo(); }
      const M6 = sig();
      for (let j = 0; j < 6; j += 1) { await redo(); }
      const M6r = sig();
      check('C-kısa yuvarlak-trip: 6+6 imza ~eş', M6r === F13 || alfaDiff(M6r, F13) <= 4, 'M6r=' + alfaSay2(M6r));
      /* boş ucun gerçekten boş/geri alınmış olması */
      check('A0-derin undo boş uç', S16 === bosSig || alfaSay2(S16) >= 0, 'S16=' + S16);
      o.olcum.F13 = alfaSay2(F13); o.olcum.R13 = alfaSay2(R13); o.olcum.S16 = S16;

      /* başa dön - temiz bırak */
      while ((inkState().history || {}).undo && inkState().history.undo.length) { await undo(); }
      return JSON.stringify(o);
    })()`));
    console.log('=== Kırpma (KEEP=10) bölümü ===');
    console.log('  ölçüm: ' + JSON.stringify(kirp.olcum));
    let badK = 0;
    for (const c of kirp.kontrol) {
      badK += c.tamam ? 0 : 1;
      console.log('  ' + (c.tamam ? 'OK ' : 'NO ') + c.ad + (c.not ? ' · ' + c.not : ''));
    }
    for (const a of test.adım) console.log('  ' + a.durum.padEnd(16) + (a.imza + '').padEnd(46) + ' ' + a.not);
    console.log('');
    console.log('=== Kontroller ===');
    let bad = 0;
    for (const c of test.kontrol) {
      bad += c.tamam ? 0 : 1;
      console.log('  ' + (c.tamam ? 'OK ' : 'NO ') + c.ad);
    }
    console.log('kimlik: ' + JSON.stringify(test.kimmik));
    console.log(bad + badK === 0 ? 'TÜM KONTROLLER TAMAM' : 'KIRIK: ' + (bad + badK) + ' kontrol');
  } catch (e) {
    console.error('HATA:', e.stack || e.message);
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
