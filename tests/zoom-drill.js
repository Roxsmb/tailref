'use strict';
/* =========================================================
   zoom-drill.js — 120 ogelik tahtada zoom darbogazini bilen ayirir
   ---------------------------------------------------------
   Global fonksiyonlari sararak (plain-script zanni ile)
   applyView/scheduleSave/links/titles/bar/layout harcamalarini
   wheel firtinasi altinda olcer; kalan sure stil/boya/kompozit
   kuyrugu olarak etiketlenir. Kapı DEGIL.
   Kullanim: node tests/zoom-drill.js
   NOT: sentetik olaylar — sureler SOZDE-SURETTIR.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9351;
const APP_PORT = 5221;
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
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatasi'));
    }
    const v = msg.result.result.value;
    resolve(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

async function waitForTarget(deadlineMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henuz degil */ }
    await sleep(400);
  }
  throw new Error('debug portu acilmadi (9351)');
}
function connect(page) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}
async function hazirla(ws) {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  const dk = Date.now() + 60000;
  let ready = false;
  while (Date.now() < dk) {
    ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth");
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('renderer hazir olmad');
  let kapandi = false;
  for (let i = 0; i < 60 && !kapandi; i += 1) {
    kapandi = await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (!w || w.hidden) return true;
      if (!document.querySelector('.pwOption.is-selected')) {
        const opt = document.querySelector('.pwOption[data-mode="auto"]');
        if (opt) opt.click();
      }
      const btn = document.getElementById('pwContinue');
      if (btn && !btn.disabled) btn.click();
      return !!w.hidden;
    })()`);
    if (!kapandi) await sleep(500);
  }
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-zd-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);

    /* sessionRecorder kur + longtask oku */
    await evaluate(ws, `(() => {
      if (!window.__lt) {
        window.__lt = { n: 0, ms: 0, max: 0 };
        window.__ltObs = new PerformanceObserver(l => {
          for (const e of l.getEntries()) {
            window.__lt.n++; window.__lt.ms += e.duration;
            if (e.duration > window.__lt.max) window.__lt.max = e.duration;
          }
        });
        window.__ltObs.observe({ entryTypes: ['longtask'] });
      }
      return true;
    })()`);

    /* ==== 120 oge doldur (900x700 PNG) ==== */
    const kur = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let b = 0; b < 10; b += 1) {
        for (let k = 0; k < 12; k += 1) {
          const c = document.createElement('canvas');
          c.width = 900; c.height = 700;
          const cx = c.getContext('2d');
          cx.fillStyle = 'hsl(' + ((b * 12 + k) * 27 % 360) + ',70%,50%)';
          cx.fillRect(0, 0, 900, 700);
          cx.fillStyle = 'rgba(0,0,0,0.2)';
          for (let q = 0; q < 24; q += 1) cx.fillRect((q * 151) % 840, (q * 83) % 640, 70, 50);
          const blob = await new Promise(r2 => c.toBlob(r2, 'image/png'));
          const name = 'ZD-' + b + '-' + k + '.png';
          const imageId = 'img_' + newId();
          await idbPut('images', imageId, { blob, name });
          const entry = await decodeImage(blob);
          setImgCache(imageId, { img: entry.img, url: entry.url, name });
          state.items.push({ id: 'it_' + newId(), kind: 'image', imageId,
            title: name, name, x: (k % 4) * 940, y: b * 720, w: 900, h: 700, rot: 0, z: nextZ() });
        }
        if (b % 3 === 2) { pushUndo(); syncAll(); await wait(90); }
      }
      pushUndo(); syncAll(); fitAll(); await wait(150);
      return { items: state.items.length };
    })()`));
    console.log('kurulum: ' + JSON.stringify(kur));

    /* ==== fonksiyon sarmalayicilar (mevcut global baglar CALISIR) ==== */
    const sarmala = JSON.parse(await evaluate(ws, `(() => {
      if (window.__zd) return { zaten: true, ...window.__zd.snapshot() };
      window.__zd = { keys: {} };
      const SAR = ['applyView', 'scheduleSave', 'scheduleLinks', 'updateGroupTitles',
        'updateItemBar', 'queueToolbarLayout', 'updateGroupFrame', 'updateInspector',
        'inkSyncDom', 'maybeWarnOverload'];
      window.__zd.orig = {};
      for (const name of SAR) {
        const f = window[name];
        if (typeof f !== 'function') continue;
        window.__zd.orig[name] = f;
        window[name] = function (...a) {
          const t = performance.now();
          const r = f.apply(this, a);
          const d = performance.now() - t;
          const k = window.__zd.keys[name] || (window.__zd.keys[name] = { ms: 0, n: 0 });
          k.ms += d; k.n++;
          return r;
        };
      }
      window.__zd.stringifyN = 0;
      window.__zd.origStringify = JSON.stringify;
      JSON.stringify = function (v) { window.__zd.stringifyN++; return window.__zd.origStringify.call(JSON, v); };
      return { sarmalanan: Object.keys(window.__zd.orig) };
    })()`));
    console.log('sarmalama: ' + JSON.stringify(sarmala));

    /* ==== zoom firtinasi 300 wheel ==== */
    const oku = `(() => {
      const k = window.__zd ? window.__zd.keys : {};
      const out = { lt: { n: window.__lt.n, ms: Math.round(window.__lt.ms), max: Math.round(window.__lt.max) },
        stringifyN: window.__zd.stringifyN };
      for (const name of Object.keys(k)) {
        out[name] = { ms: Math.round(k[name].ms), n: k[name].n };
      }
      window.__zd.keys = {};
      window.__lt = { n: 0, ms: 0, max: 0 };
      return out;
    })()`;

    const run = async (ad, eventCount) => {
      const t0 = Date.now();
      await evaluate(ws, `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < ${eventCount}; i += 1) {
          stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
            clientX: 200 + (i % 500), clientY: 150 + (i % 400),
            deltaY: i % 2 ? 200 : -200, ctrlKey: true }));
          if (i % 15 === 0) await wait(4);
        }
      })()`);
      const r = JSON.parse(await evaluate(ws, oku));
      console.log(ad + ': faz=' + (Date.now() - t0) + 'ms -> ' + JSON.stringify(r));
      return r;
    };

    const z1 = await run('A zoom 300', 300);

    /* ==== sadece pan (ctrlKey yok) — zoom farkini ayirmak icin ==== */
    await evaluate(ws, `(() => {
      window.__lt = { n: 0, ms: 0, max: 0 };
      return true;
    })()`);
    await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const t0 = Date.now();
      for (let i = 0; i < 300; i += 1) {
        stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: 200 + (i % 500), clientY: 150 + (i % 400),
          deltaY: i % 2 ? 200 : -200, ctrlKey: false }));
        if (i % 15 === 0) await wait(4);
      }
      return true;
    })()`);
    const pan = JSON.parse(await evaluate(ws, oku));
    console.log('B pan 300: -> ' + JSON.stringify(pan));

    /* bare fitAll ölçümü */
    const fit = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__lt = { n: 0, ms: 0, max: 0 };
      window.__zd.keys = {};
      const t = performance.now();
      for (let i = 0; i < 30; i += 1) { fitAll(); await wait(10); }
      await wait(80);
      const k = window.__zd.keys;
      return { ms: Math.round(performance.now() - t),
        applyView: k.applyView ? Math.round(k.applyView.ms * 10) / 10 / k.applyView.n : null,
        lt: { n: window.__lt.n, ms: Math.round(window.__lt.ms) } };
    })()`));
    console.log('C fitAll 30: ' + JSON.stringify(fit));

    /* tahta her sey dahil: tek zoom tickinin DOM tarafi */
    const tick = JSON.parse(await evaluate(ws, `(() => {
      window.__zd.keys = {};
      const t = performance.now();
      stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
        clientX: 400, clientY: 300, deltaY: -200, ctrlKey: true }));
      const sync = Math.round(performance.now() - t);
      /* kare sinirli tarayici isi: style/layout/paint rAF'ye gider */
      return new Promise(resolve => requestAnimationFrame(() => {
        const k = window.__zd.keys;
        const sonuc = { sync, sonra: Math.round(performance.now() - t),
          applyView: k.applyView ? Math.round(k.applyView.ms * 100) : null,
          ltMs: Math.round(window.__lt.ms) };
        resolve(sonuc);
      }));
    })()`));
    console.log('D tek tick: ' + JSON.stringify(tick));

    console.log('HUKM: ' + (z1.lt && z1.lt.ms > 0 ? 'zoom lt=' + z1.lt.ms + 'ms n=' + z1.lt.n : 'zoom lt yok') +
      ' | pan lt=' + pan.lt.ms + 'ms n=' + pan.lt.n);

    /* ==== A/B izolasyonu: B scroll-okumasiz applyView, C willChange, D ikisi ==== */
    const sifirla = `(() => {
      window.__lt = { n: 0, ms: 0, max: 0 };
      if (window.__zd) window.__zd.keys = {};
      return true;
    })()`;
    const vary = async (ad, patch, restore) => {
      await evaluate(ws, patch);
      await evaluate(ws, sifirla);
      const r = await run(ad, 200);
      if (restore) await evaluate(ws, restore);
      return r;
    };
    const UYGULA = `(() => {
      window.__appliedView = window.applyView;
      window.applyView = function () {
        const v = state.view;
        world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.scale + ')';
        world.style.setProperty('--inv', String(1 / v.scale));
        zoomEl.textContent = Math.round(v.scale * 100) + '%';
        if (typeof queueToolbarLayout === 'function') queueToolbarLayout();
        if (typeof updateItemBar === 'function') updateItemBar();
        if (typeof updateGroupTitles === 'function') updateGroupTitles();
        if (typeof scheduleLinks === 'function') scheduleLinks();
      };
      return true;
    })()`;
    const GERI = `(() => {
      if (window.__appliedView) { window.applyView = window.__appliedView; }
      return true;
    })()`;
    const WC_AC = `(() => { world.style.willChange = 'transform'; return true; })()`;
    const WC_KAPA = `(() => { world.style.willChange = 'auto'; return true; })()`;
    await vary('B scroll-okumasiz 200', UYGULA, GERI);
    await vary('C willChange 200', WC_AC, WC_KAPA);
    /* İki IIFE'yi yan yana eklemek `(() => {...})()(() => {...})()`
       üretiyordu: ikinci IIFE birinci çağrının dönüş değerini çağırmaya
       çalışıyor ve "intermediate value is not a function" ile çöküyordu.
       Araya noktalı virgül koyarak iki ayrı ifade olmalarını sağla. */
    await vary('D ikisi birden 200', UYGULA + ';' + WC_AC, GERI + ';' + WC_KAPA);
    /* temel bir kez daha (sirasinin etkisini gormek icin) */
    await evaluate(ws, sifirla);
    await run('E temel-yine 200', 200);

  } catch (e) {
    console.error('ZD HATASI: ' + (e && e.message ? e.message.slice(0, 300) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(300);
  }
})();
