'use strict';

/* EVRE 4 · tileSlice DÜRÜST uçtan uca hız sonda:
   Çekirdek paritesindeki "1,9×" yalnız C++ işleviydi (IPC'siz).
   Bu sonda gerçek yolu ölçer — undo akışının iki tarafı da:
     JS yolu  : 34-ink-undo.js satır band kopyası (SENKRON,IFA öncesi)
     Native   : window.tailref.engineTiles → IPC → ana süreç → core
   Ölçümler:
     T1) kopya bant başına (döngüsel ısrarlı)  — sync JS vs sync IPC-üstü maliyet__,
     T2) vuruş penceresi topX (yalniz x) momentum
     T3) aynı bölge N=20 ardışık iş — iki yolda da
   Kullanım: node tests/ink-tilespeed-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9352;
const APP_PORT = 5244;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (m.error) return reject(new Error(JSON.stringify(m.error)));
    if (m.result.exceptionDetails) {
      return reject(new Error(m.result.exceptionDetails.exception?.description || 'eval'));
    }
    resolve(m.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

const cdp = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = 900000 + Math.floor(Math.random() * 90000);
  const onMsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (m.error) reject(new Error(method + ': ' + m.error.message));
    else resolve(m.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-tilespeed-'));
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
      } catch { /* başlangıçta bağlantı reddedilebilir */ }
      await sleep(500);
    }
    if (!page) { console.error('sayfa bulunamadı'); app.kill(); process.exit(2); }
    const ws = new WebSocket(page.webSocketDebuggerUrl.replace('ws://127.0.0.1', 'ws://localhost'));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    for (let i = 0; i < 40; i += 1) {
      const ready = await evaluate(ws, `Boolean(window.tailref && window.tailref.engineTiles)`)
        .catch(() => false);
      if (ready) break;
      await sleep(500);
    }

    const out = await evaluate(ws, `(async () => {
      const TILE = 256;
      const mkRegion = (w, h) => {
        /* gerçek undo bölgesi ölçüsü: 2560 tuvalde vuruş bandı */
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        const d = new ImageData(w, h);
        for (let i = 0; i < d.data.length; i += 4) {
          d.data[i] = (i * 7) & 255; d.data[i + 1] = (i * 13) & 255;
          d.data[i + 2] = (i * 29) & 255; d.data[i + 3] = 255;
        }
        ctx.putImageData(d, 0, 0);
        return ctx.getImageData(0, 0, w, h);
      };
      const mkSlices = (w, h) => {
        const sl = [];
        for (let gx = 0; gx < w; gx += TILE) {
          const cw = Math.min(TILE, w - gx);
          for (let row = 0; row < h; row += TILE) {
            const ch = Math.min(TILE, h - row);
            sl.push([gx, row, cw, ch]);
          }
        }
        return sl;
      };
      /* JS referansı: 34-ink-undo.js satır band kopyasının aynısı */
      const jsSlice = (src, srcW, slices) => {
        let bytes = 0;
        for (const [rx, ry, w, h] of slices) {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let row = 0; row < h; row++) {
            const from = ((ry + row) * srcW + rx) * 4;
            data.set(src.subarray(from, from + w * 4), row * w * 4);
          }
          bytes += data.length;
        }
        return bytes;
      };
      const bench = async (w, h, iters) => {
        const img = mkRegion(w, h);
        const slices = mkSlices(w, h);
        const bytes = slices.reduce((s, t) => s + t[2] * t[3] * 4, 0);
        const flat = new Int32Array(slices.flat());
        /* ısınma */
        jsSlice(img.data, w, slices);
        const nativeWarm = await window.tailref.engineTiles(img.data, w, h, flat);
        if (!nativeWarm || !nativeWarm.ok) {
          return { hata: 'native yok: ' + (nativeWarm && nativeWarm.error) };
        }
        /* T1: senkron JS döngüsü */
        const t0 = performance.now();
        for (let i = 0; i < iters; i++) jsSlice(img.data, w, slices);
        const jsPer = (performance.now() - t0) / iters;
        /* T2: native GERÇEK yol — sıra'da IPC+klon dahil (await) */
        const t1 = performance.now();
        for (let i = 0; i < iters; i++) {
          const r = await window.tailref.engineTiles(img.data, w, h, flat);
          if (!r.ok) return { hata: 'native reddi' };
        }
        const ipcPerMs = (performance.now() - t1) / iters;
        /* T3: EVRE 5.1 transferable port yolu — kopyasız tampon. DİKKAT:
           transfer tamponu kopattığı için her çağrı taze kopyayla gider
           (gerçek yoldaki köprü klonuyla aynı maliyet, eşitik gösterim). */
        if (typeof window.tailref.enginePortTiles !== 'function') {
          return { hata: 'port köprüsü yok' };
        }
        let bağlandaftersleeps = 0;
        let portWarm = null;
        for (let i = 0; i < 40 && !portWarm; i++) {
          const r = await window.tailref.enginePortTiles(
            img.data.slice(), w, h, flat.slice()).catch(() => null);
          if (r && r.ok) portWarm = r;
          else { await new Promise(rs => setTimeout(rs, 250)); bağlandaftersleeps++; }
        }
        if (!portWarm) return { hata: 'port bağlanamadı' };
        /* port yolunda doğruluk: JS referansı bayt-bayt */
        const okReply = await window.tailref.enginePortTiles(
          img.data.slice(), w, h, flat.slice());
        const jsRef = jsSlice(img.data, w, slices);
        let portDiffs = 0;
        if (!okReply.ok || okReply.data.length !== jsRef) portDiffs++;
        else {
          let off = 0;
          for (const [rx, ry, cw, ch] of slices) {
            const expected = new Uint8ClampedArray(cw * ch * 4);
            for (let row = 0; row < ch; row++) {
              const from = ((ry + row) * w + rx) * 4;
              expected.set(img.data.subarray(from, from + cw * 4), row * cw * 4);
            }
            for (let i = 0; i < expected.length; i++) {
              if (okReply.data[off + i] !== expected[i]) portDiffs++;
            }
            if (portDiffs > 4) break;
            off += expected.length;
          }
        }
        const t2 = performance.now();
        for (let i = 0; i < iters; i++) {
          /* her denemede taze klon: gerçekte köprü aşımlarıyla aynı */
          const r = await window.tailref.enginePortTiles(
            img.data.slice(), w, h, flat.slice());
          if (!r.ok) return { hata: 'port reddi 2' };
        }
        const portPerMs = (performance.now() - t2) / iters;
        return {
          bölge: w + 'x' + h, dilim: slices.length,
          bayt: bytes, ısınma: Math.round(jsPer * iters * 2),
          jsSync: +jsPer.toFixed(3), nativeSıra: +ipcPerMs.toFixed(3),
          portYolu: +portPerMs.toFixed(3), portParite: portDiffs === 0,
          oran: +(jsPer / Math.max(0.001, ipcPerMs)).toFixed(2),
          portOran: +(jsPer / Math.max(0.001, portPerMs)).toFixed(2),
          bağlama: bağlandaftersleeps,
        };
      };
      const rA = await bench(2560, 128, 24);   /* gerçek büyük band */
      const rB = await bench(640, 90, 24);     /* orta bölge */
      const rC = await bench(340, 60, 24);     /* küçük bölge (eşik 64k altı) */
      return JSON.stringify({ rA, rB, rC, enstrümantasyon: window.tailref.engineStatus ? 'köprü var' : 'köprü yok' });
    })()`);
    const o = JSON.parse(out);
    for (const r of [o.rA, o.rB, o.rC]) {
      if (r.hata) console.log('HATA: ' + r.hata);
      else console.log(
        r.bölge + ' · dilim=' + r.dilim + ' · ' + Math.round(r.bayt / 1024) + ' KB →' +
        '  JS=senkron ' + r.jsSync + ' ms  vs  invoke ' +
        r.nativeSıra + ' ms (' + r.oran + '×)  vs  PORT ' +
        r.portYolu + ' ms (' + r.portOran + '×)' +
        (r.portParite ? '  · port parite ✓ (' + r.bağlama + ' kez bekleme)' : '  · PORT PARİTE KIRMIZI'));
    }
    console.log('köprü: ' + o.enstrümantasyon);
    app.kill();
    process.exit(0);
  } catch (e) {
    console.error('SONDA HATASI: ' + e);
    app.kill();
    process.exit(3);
  }
})();
