'use strict';
/* =========================================================
   tile-parity-check.js — karo ızgara / tam-yol parite probe'u
   ---------------------------------------------------------
   Kullanıcı raporu: vuruş bırakışında bazı karolar bayat/parça
   parça çıkıyor; zoom ya da yakın çizim düzeltiyor. Bu probe
   aynı koşulları üretir ve HER görünür karoyu tam-yol referans
   kompozitiyle byte-birebir kıyaslar; uyumsuz karoları +
   fark kutularını + hangi kaynaktan sızdığını raporlar.
   Kullanım: node tests/tile-parity-check.js   (kapı DEĞİL)
   NOT: sentetik pointerType=pen — süreler SÖZDE-SÜRETTİR.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9346;
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
    } catch { /* henüz değil */ }
    await sleep(400);
  }
  throw new Error('debug portu açılmadı (9346)');
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
    ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('renderer hazır olmadı');
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-tpar-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);

    const r = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '2600';
      document.getElementById('newCanvasH').value = '1700';
      document.getElementById('newCanvasName').value = 'TPar';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 200 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      const ui = inkEditorUi;
      /* karo ızgarayı zorla devreye sok: probesuz, görünür zaten önemli değil */
      ui.tileViewOn = true;
      try { localStorage.setItem('tailref-tile-size', '256'); } catch (e2) { /* sessiz */ }
      inkEditorInvalidate();
      await wait(300);

      const canvas = document.getElementById('inkEditorCanvas');
      const fit = ui.fit;
      const rect = canvas.getBoundingClientRect();
      const fire = (type, x, y, press, pid) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: pid || 42, pointerType: 'pen',
        clientX: rect.left + fit.x + x * fit.w,
        clientY: rect.top + fit.y + y * fit.h,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : press }));
      const ciz = async (brush, size, color, y0, y1, steps, x0) => {
        inkSetTool(brush === 'smudge' ? 'smudge' : 'brush', brush === 'smudge' ? undefined : { brushId: brush });
        const ink = inkState();
        ink.size = size; ink.opacity = 1; ink.smoothing = 0.2; ink.color = color;
        await wait(30);
        fire('pointerdown', x0, y0, 0.4, 42 + steps);
        for (let k = 1; k <= steps; k += 1) {
          fire('pointermove', x0 + (0.74 - x0) * k / steps, y0 + (y1 - y0) * k / steps, 0.5);
          await wait(5);
        }
        fire('pointerup', 0.74, y1, 0);
        await new Promise(r2 => requestAnimationFrame(r2));
        await wait(90);
      };

      /* vuruş kümesi: karo sınırlarını ENİSİ geçen köşegenler + zengin
         katmanlar; kullanıcı raporundaki "sınır blokları koşulunu kurmak" */
      const basla = Date.now();
      inkState().activeLayerId = inkState().layers[0].id;
      await ciz('ink-hard', 80, '#101010', 0.12, 0.5, 40, 0.08);
      await ciz('ink-hard', 120, '#b8860b', 0.35, 0.72, 40, 0.10);
      await ciz('ink-hard', 60, '#101010', 0.55, 0.88, 36, 0.12);
      const L = inkState().layers.filter(l => l.kind === 'attached');
      inkState().activeLayerId = L[0].id;
      await ciz('ink-hard', 90, '#202020', 0.2, 0.75, 44, 0.06);
      await ciz('ink-air', 140, '#333333', 0.18, 0.82, 40, 0.14);
      /* sonraki vuruş YAKIN: bayatı onarır (kullanıcı raporundaki ikinci
         şikâyetin ritmi) — iki fazda ölçülür */
      const cogusma1 = Date.now() - basla;

      /* yakınsama bekle */
      for (let i = 0; i < 60 && (ui.tvBakeLeft || (ui.tvLive && ui.tvLive.size)); i += 1) await wait(80);
      await wait(200);

      /* --- karoların tam-yol referansıyla parite ölçümü --- */
      const kesif = (() => {
        const tv = ui.tileView;
        if (!tv) return { hata: 'tileView yok' };
        const dpr = ui.dpr || 1;
        const fit = ui.fit;
        const off = ui.baseOffset || { x: 0, y: 0 };
        const layers = inkLayersForOwner(ui.itemId);
        const karoRapor = [];
        for (const [k, t] of tv.tiles) {
          if (!t.canvas || !t.ctx) continue;
          const dev = t.dev;
          /* referans: painter'ın TAM YOL işlemlerinin kopyası */
          const ref = document.createElement('canvas');
          ref.width = dev; ref.height = dev;
          const rctx = ref.getContext('2d', { colorSpace: 'srgb' });
          const bx = Math.round(t.cssX * dpr), by = Math.round(t.cssY * dpr);
          rctx.setTransform(1, 0, 0, 1, -bx, -by);
          rctx.drawImage(ui.baseCanvas, off.x, off.y);
          rctx.setTransform(dpr, 0, 0, dpr, -bx, -by);
          rctx.imageSmoothingEnabled = true;
          rctx.imageSmoothingQuality = 'medium';
          for (const layer of layers) {
            if (!layer.visible || layer.opacity <= 0.001) continue;
            const src = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
            if (!src) continue;
            rctx.save();
            rctx.globalAlpha = clamp(layer.opacity, 0, 1);
            rctx.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
            const drawSrc = inkEditorScaledSource(layer, src);
            rctx.drawImage(drawSrc, fit.x, fit.y, fit.w, fit.h);
            rctx.restore();
          }
          rctx.strokeStyle = 'rgba(255,255,255,.2)';
          rctx.lineWidth = 1;
          rctx.strokeRect(fit.x + 0.5, fit.y + 0.5, Math.max(0, fit.w - 1), Math.max(0, fit.h - 1));
          /* kıyas */
          const a = t.ctx.getImageData(0, 0, dev, dev).data;
          const b = rctx.getImageData(0, 0, dev, dev).data;
          let fark = 0, maxD = 0;
          let fMinX = dev, fMinY = dev, fMaxX = -1, fMaxY = -1;
          for (let i2 = 0; i2 < a.length; i2 += 4) {
            const d = Math.abs(a[i2] - b[i2]) + Math.abs(a[i2 + 1] - b[i2 + 1]) +
              Math.abs(a[i2 + 2] - b[i2 + 2]) + Math.abs(a[i2 + 3] - b[i2 + 3]);
            if (d > 8) {
              fark++;
              if (d > maxD) maxD = d;
              const px = (i2 >> 2) % dev, py = (i2 >> 2) / dev | 0;
              if (px < fMinX) fMinX = px;
              if (py < fMinY) fMinY = py;
              if (px > fMaxX) fMaxX = px;
              if (py > fMaxY) fMaxY = py;
            }
          }
          karoRapor.push({ k, fark, maxD,
            kutu: fark > 0 ? [fMinX, fMinY, fMaxX, fMaxY] : null });
        }
        const bozuk = karoRapor.filter(x => x.fark > 0);
        return { karolar: karoRapor.length, bozuk: bozuk.length,
          bozukLista: bozuk.slice(0, 10),
          cogusma1: Date.now() - basla };
      })();
      return kesif;
    })()`));
    console.log(JSON.stringify(r, null, 1));
  } catch (e) {
    console.error('TPAR HATASI: ' + (e && e.message ? e.message.slice(0, 300) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* */ }
  }
})();
