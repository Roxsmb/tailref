'use strict';
/* =========================================================
   screen-parity-check.js — KULLANICININ GÖRDÜĞÜ YÜZEYİN paritesi
   ---------------------------------------------------------
   Önceki probe'lar yalnız YAŞAYAN karo tuvallerini ölçüyordu;
   kullanıcı gördüğü yüzey = ana tuval + karo DOM katmanı.
   Bu probe tam ekransal bileşimi toplar (ana tuval + karolar
   kendi konumlarında) ve taze tam-yol referansı ile bit
   düzeyinde kıyaslar; ayrıca ilk bozuk bölgenin montajını PNG
   olarak yazar. Yol boşluğu: ana tuval katmanları bölgesel
   frameChip'ten mi geliyor vsQuick hızlı vuruşlarla kayıp mı?
   Kullanım: node tests/screen-parity-check.js   (kapı DEĞİL)
   NOT: sentetik pointerType=pen — süreler SÖZDE-SÜRETTİR.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9348;
const APP_PORT = 5216;
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
  throw new Error('debug portu açılmadı (9348)');
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

/* sayfa-içi: YÜZEY paritesi ölçümü (kurulur ve yeniden kullanılır) */
const OLCUM = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ui = inkEditorUi;
  /* referans: tam-yol kompozit (painter ile aynı işlem sırası,
     KAYNAK = kalıcı katman) */
  const ref = document.createElement('canvas');
  ref.width = ui.canvas.width; ref.height = ui.canvas.height;
  const rc = ref.getContext('2d', { colorSpace: 'srgb' });
  const dpr = ui.dpr || 1;
  const fit = ui.fit;
  const off = ui.baseOffset || { x: 0, y: 0 };
  rc.setTransform(1, 0, 0, 1, 0, 0);
  rc.drawImage(ui.baseCanvas, off.x, off.y);
  rc.setTransform(dpr, 0, 0, dpr, 0, 0);
  rc.imageSmoothingEnabled = true;
  rc.imageSmoothingQuality = 'medium';
  const layers2 = inkLayersForOwner(ui.itemId);
  for (const layer of layers2) {
    if (!layer.visible || layer.opacity <= 0.001) continue;
    const src = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
    if (!src) continue;
    rc.save();
    rc.globalAlpha = clamp(layer.opacity, 0, 1);
    rc.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
    const drawSrc = inkEditorScaledSource(layer, src);
    rc.drawImage(drawSrc, fit.x, fit.y, fit.w, fit.h);
    rc.restore();
  }
  rc.strokeStyle = 'rgba(255,255,255,.2)';
  rc.lineWidth = 1;
  rc.strokeRect(fit.x + 0.5, fit.y + 0.5, Math.max(0, fit.w - 1), Math.max(0, fit.h - 1));
  /* YÜZEY: ana tuval + karolar kendi konumlarında */
  const gorunen = document.createElement('canvas');
  gorunen.width = ui.canvas.width; gorunen.height = ui.canvas.height;
  const gc = gorunen.getContext('2d', { colorSpace: 'srgb' });
  gc.setTransform(1, 0, 0, 1, 0, 0);
  gc.drawImage(ui.canvas, 0, 0);
  const tv = ui.tileView;
  if (tv) {
    for (const [, t] of tv.tiles) {
      if (!t.canvas || !t.ctx) continue;
      gc.drawImage(t.canvas, Math.round(t.cssX * dpr), Math.round(t.cssY * dpr));
    }
  }
  /* fark: kutu + sayım + hangi alanda (karo altında mı / tuvalde mi) */
  const a = gc.getImageData(0, 0, gorunen.width, gorunen.height).data;
  const b = rc.getImageData(0, 0, ref.width, ref.height).data;
  const W = gorunen.width;
  let fark = 0, maxD = 0;
  let x0 = W, y0 = gorunen.height, x1 = -1, y1 = -1;
  const karoAltinde = (px, py) => {
    if (!tv) return false;
    for (const [, t] of tv.tiles) {
      if (px >= Math.round(t.cssX * dpr) && py >= Math.round(t.cssY * dpr) &&
          px < Math.round(t.cssX * dpr) + t.dev && py < Math.round(t.cssY * dpr) + t.dev) return true;
    }
    return false;
  };
  let farkKaro = 0, farkTuval = 0;
  let eksikN = 0, fazlaN = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) +
      Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
    if (d > 8) {
      fark++;
      /* yön: koyuluk toplamı karşılaştır (kanaat: mürekkep koyu) */
      const la = a[i] + a[i + 1] + a[i + 2] + a[i + 3] * (0 / 255);
      const lb = b[i] + b[i + 1] + b[i + 2] + b[i + 3] * (0 / 255);
      if (la > lb + 12) eksikN++; else if (lb > la + 12) fazlaN++;
      if (d > maxD) maxD = d;
      const px = (i >> 2) % W, py = (i >> 2) / W | 0;
      if (px < x0) x0 = px;
      if (py < y0) y0 = py;
      if (px > x1) x1 = px;
      if (py > y1) y1 = py;
      if (karoAltinde(px, py)) farkKaro++; else farkTuval++;
    }
  }
  return {
    farkN: fark, maxD, farkKaro, farkTuval,
    kutu: fark > 0 ? [x0, y0, x1, y1] : null,
    /* yön sayımı: eksik mürekkep (görünen açık, referans koyu) vs fazla */
    eksik: eksikN, fazla: fazlaN,
    /* ilk 10 fark pikselinin TAM RGBA'sı (kanal teşhisi) */
    orn: (function () {
      const out = [];
      for (let py = y0; py <= y1 && out.length < 10; py += 4) {
        for (let px = x0; px <= x1 && out.length < 10; px += 4) {
          const j = (py * W + px) << 2;
          const dd = Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) +
            Math.abs(a[j + 2] - b[j + 2]) + Math.abs(a[j + 3] - b[j + 3]);
          if (dd > 8) out.push([px, py,
            [a[j], a[j + 1], a[j + 2], a[j + 3]],
            [b[j], b[j + 1], b[j + 2], b[j + 3]]]);
        }
      }
      /* AYNI noktalarda ana tuvalin tile'sız hali — çift gölge ana
         tuvalde mi, tile bitinde mi ayrıştırır */
      const mcx = document.createElement('canvas');
      mcx.width = ui.canvas.width; mcx.height = ui.canvas.height;
      const mc2 = mcx.getContext('2d', { colorSpace: 'srgb' });
      mc2.drawImage(ui.canvas, 0, 0);
      const mdata = mc2.getImageData(0, 0, mcx.width, mcx.height).data;
      for (const o2 of out.slice()) {
        const j2 = (o2[1] * W + o2[0]) << 2;
        out.push([o2[0], o2[1], 'ANA',
          [mdata[j2], mdata[j2 + 1], mdata[j2 + 2], mdata[j2 + 3]]]);
      }
      return out;
    })(),
    karoListesi: (function () {
      const out = [];
      if (tv) for (const [k, t] of tv.tiles) {
        out.push([k, Math.round(t.cssX * dpr), Math.round(t.cssY * dpr), t.dev]);
      }
      return out;
    })(),
    ascii: (function () {
      if (fark === 0 || x1 < x0) return null;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      const gw = Math.min(48, Math.max(8, Math.round(bw / 16)));
      const gh = Math.min(24, Math.max(6, Math.round(bh / 16)));
      const grid = [];
      for (let gy = 0; gy < gh; gy += 1) {
        let satir = '';
        for (let gx = 0; gx < gw; gx += 1) {
          const cx0 = x0 + Math.floor(bw * gx / gw), cx1 = x0 + Math.floor(bw * (gx + 1) / gw);
          const cy0 = y0 + Math.floor(bh * gy / gh), cy1 = y0 + Math.floor(bh * (gy + 1) / gh);
          let n = 0;
          for (let py = cy0; py < cy1 && n < 400; py += 1) {
            for (let px = cx0; px < cx1 && n < 400; px += 1) {
              const j = (py * W + px) << 2;
              const dd = Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) +
                Math.abs(a[j + 2] - b[j + 2]) + Math.abs(a[j + 3] - b[j + 3]);
              if (dd > 8) n++;
            }
          }
          satir += n > 40 ? '#' : (n > 8 ? '+' : (n > 0 ? '.' : '.'));
        }
        grid.push(satir);
      }
      return { kutu: [x0, y0, bw, bh], ag: gw + 'x' + gh, grid };
    })(),
    boyut: [gorunen.width, gorunen.height] };
   })()`;

/* sayfa-içi: üçlü montaj (görünen | referans | kırmızı maske) dataURL */
const MONTAJIM = `(function () {
  const ui = inkEditorUi;
  const dpr = ui.dpr || 1;
  const gw = ui.canvas.width, gh = ui.canvas.height;
  const gorunen = document.createElement('canvas');
  gorunen.width = gw; gorunen.height = gh;
  const gc = gorunen.getContext('2d');
  gc.drawImage(ui.canvas, 0, 0);
  const tv = ui.tileView;
  if (tv) for (const [, t] of tv.tiles) {
    gc.drawImage(t.canvas, Math.round(t.cssX * dpr), Math.round(t.cssY * dpr));
  }
  const ref = document.createElement('canvas');
  ref.width = gw; ref.height = gh;
  const rc = ref.getContext('2d', { colorSpace: 'srgb' });
  const fit = ui.fit;
  const off = ui.baseOffset || { x: 0, y: 0 };
  rc.setTransform(1, 0, 0, 1, 0, 0);
  rc.drawImage(ui.baseCanvas, off.x, off.y);
  rc.setTransform(dpr, 0, 0, dpr, 0, 0);
  rc.imageSmoothingEnabled = true;
  rc.imageSmoothingQuality = 'medium';
  const layers2 = inkLayersForOwner(ui.itemId);
  for (const layer of layers2) {
    if (!layer.visible || layer.opacity <= 0.001) continue;
    const src = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
    if (!src) continue;
    rc.save();
    rc.globalAlpha = clamp(layer.opacity, 0, 1);
    rc.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
    const drawSrc = inkEditorScaledSource(layer, src);
    rc.drawImage(drawSrc, fit.x, fit.y, fit.w, fit.h);
    rc.restore();
  }
  rc.strokeStyle = 'rgba(255,255,255,.2)';
  rc.lineWidth = 1;
  rc.strokeRect(fit.x + 0.5, fit.y + 0.5, Math.max(0, fit.w - 1), Math.max(0, fit.h - 1));
  const a = gc.getImageData(0, 0, gw, gh).data;
  const b = rc.getImageData(0, 0, gw, gh).data;
  const mask = document.createElement('canvas');
  mask.width = gw; mask.height = gh;
  const mc = mask.getContext('2d');
  mc.fillStyle = '#ffffff';
  mc.fillRect(0, 0, gw, gh);
  const ms = mc.getImageData(0, 0, gw, gh);
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) +
      Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
    if (d > 8) {
      ms.data[i] = 220; ms.data[i + 1] = 0; ms.data[i + 2] = 0; ms.data[i + 3] = 255;
    }
  }
  mc.putImageData(ms, 0, 0);
  return { gorunen: gorunen.toDataURL('image/png'), ref: ref.toDataURL('image/png'),
    maske: mask.toDataURL('image/png'), boyut: [gw, gh] };
})()`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-spc-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);

    /* editörü aç + karo ızgarayı zorla */
    await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '2600';
      document.getElementById('newCanvasH').value = '1700';
      document.getElementById('newCanvasName').value = 'SPC';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 200 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      const ui = inkEditorUi;
      ui.tileViewOn = true;
      try { localStorage.setItem('tailref-tile-size', '256'); } catch (e2) { /* sessiz */ }
      inkEditorInvalidate();
      await wait(300);
      if (!ui.tileView) { try { inkEditorTileView(); } catch (e2) { /* sessiz */ } }
    })()`);

    /* F1: HIZLI ardışık vuruş (context: release→down < 10 ms; bir
       önceki vuruşun frameChip'i tam kare bulamadan yeni vuruş
       başlıyor mu?) — ardına zaman serisi değil, SONDA yüzey
       paritesi ölç. */
    const r1 = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ui = inkEditorUi;
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      const fire = (type, x, y, press, pid) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: pid || 42, pointerType: 'pen',
        clientX: rect.left + ui.fit.x + x * ui.fit.w,
        clientY: rect.top + ui.fit.y + y * ui.fit.h,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : press }));
      inkSetTool('brush', { brushId: 'ink-hard' });
      const ink = inkState();
      ink.activeLayerId = ink.layers.filter(l => l.kind === 'attached')[0].id;
      ink.size = 60; ink.opacity = 1; ink.smoothing = 0.2; ink.color = '#101010';
      const zaman = [];
      for (let s = 0; s < 10; s += 1) {
        const t0 = Date.now();
        fire('pointerdown', 0.15 + (s % 4) * 0.04, 0.15 + (s % 3) * 0.07, 0.4, 50 + s);
        for (let k2 = 1; k2 <= 14; k2 += 1) {
          fire('pointermove', 0.15 + (s % 4) * 0.04 + 0.30 * k2 / 14,
            0.15 + (s % 3) * 0.07 + 0.28 * k2 / 14, 0.5, 50 + s);
          await wait(4);
        }
        fire('pointerup', 0.15 + (s % 4) * 0.04 + 0.30,
          0.15 + (s % 3) * 0.07 + 0.28, 0, 50 + s);
        zaman.push(Date.now() - t0);
        /* HIZLI: yaln 6-10 ms boşluk → frameChip tam kareyi yakalayamaz mı? */
        await wait(8);
      }
      for (let i = 0; i < 200 && (ui.tvBakeLeft || (ui.tvLive && ui.tvLive.size)); i += 1) await wait(40);
      /* settle ana croşu: dirty temiz olana dek */
      for (let i = 0; i < 200 && ui.tileView &&
           ui.tileView.dirty && ui.tileView.dirty.size; i += 1) await wait(30);
      await wait(500);
      return { zaman };
    })()`));
    console.log('F1 vuruş zamanları: ' + JSON.stringify(r1));

    const parite1 = JSON.parse(await evaluate(ws, OLCUM));
    console.log('F1 YÜZEY PARİTESİ: ' + JSON.stringify(parite1));
    const montajYaz = async (dus) => {
      const m = JSON.parse(await evaluate(ws, MONTAJIM));
      if (m && m.gorunen) {
        const p1 = path.join(__dirname, 'screen-parity-gorunen-' + dus + '.png');
        const p2 = path.join(__dirname, 'screen-parity-ref-' + dus + '.png');
        const p3 = path.join(__dirname, 'screen-parity-maske-' + dus + '.png');
        fs.writeFileSync(p1, Buffer.from(m.gorunen.split(',')[1], 'base64'));
        fs.writeFileSync(p2, Buffer.from(m.ref.split(',')[1], 'base64'));
        fs.writeFileSync(p3, Buffer.from(m.maske.split(',')[1], 'base64'));
        console.log('MONTAJ ' + dus + ' yazıldı');
      } else {
        console.log('MONTAJ ' + dus + ': çekilemedi');
      }
    };
    if (parite1.farkN > 0) await montajYaz('f1');

    /* F2: göz hareketi (hover) + kısa vuruşlar + idare */
    {
      /* F1 bozukluğu varsa zoom testi */
    }
    const r2 = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ui = inkEditorUi;
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      const fire = (type, x, y, press, pid) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: pid || 42, pointerType: 'pen',
        clientX: rect.left + ui.fit.x + x * ui.fit.w,
        clientY: rect.top + ui.fit.y + y * ui.fit.h,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : press }));
      /* 12 kere hover: buttons=0 pointermove — tam kareler buda/ölmüş */
      for (let h = 0; h < 12; h += 1) {
        canvas.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, cancelable: true, pointerId: 60, pointerType: 'pen',
          clientX: rect.left + ui.fit.x + h * 30, clientY: rect.top + ui.fit.y + h * 22,
          button: 0, buttons: 0, pressure: 0 }));
        await wait(16);
      }
      /* kısa vuruş ×4 */
      await wait(120);
      for (let s = 0; s < 4; s += 1) {
        fire('pointerdown', 0.2 + s * 0.05, 0.4, 0.4, 61 + s);
        for (let k2 = 1; k2 <= 10; k2 += 1) {
          fire('pointermove', 0.2 + s * 0.05 + 0.18 * k2 / 10, 0.4 + 0.2 * k2 / 10, 0.5, 61 + s);
          await wait(5);
        }
        fire('pointerup', 0.2 + s * 0.05 + 0.18, 0.6, 0, 61 + s);
        await wait(10);
      }
      for (let i = 0; i < 200 && (ui.tvBakeLeft || (ui.tvLive && ui.tvLive.size)); i += 1) await wait(40);
      for (let i = 0; i < 200 && ui.tileView && ui.tileView.dirty && ui.tileView.dirty.size; i += 1) await wait(30);
      await wait(500);
      return { ok: true };
    })()`));
    console.log('F2: ' + JSON.stringify(r2));
    const parite2 = JSON.parse(await evaluate(ws, OLCUM));
    console.log('F2 YÜZEY PARİTESİ: ' + JSON.stringify(parite2));
    if (parite2.farkN > 0) await montajYaz('f2');

    /* F3: zoom in/out — kullanıcı raporu: zoom düzeltiyor.
       Zoom sonrası yüzey paritesi düzelir mi, ölç. */
    const r3 = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ui = inkEditorUi;
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      for (let i = 0; i < 3; i += 1) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, deltaY: 240, ctrlKey: true }));
        await wait(50);
      }
      for (let i = 0; i < 200 && (ui.tvBakeLeft || (ui.tvLive && ui.tvLive.size)); i += 1) await wait(40);
      await wait(300);
      for (let i = 0; i < 3; i += 1) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, deltaY: -240, ctrlKey: true }));
        await wait(50);
      }
      for (let i = 0; i < 200 && (ui.tvBakeLeft || (ui.tvLive && ui.tvLive.size)); i += 1) await wait(40);
      await wait(500);
      return { fit: [Math.round(ui.fit.x), Math.round(ui.fit.y), Math.round(ui.fit.w), Math.round(ui.fit.h)] };
    })()`));
    console.log('F3 zoom: ' + JSON.stringify(r3));
    const parite3 = JSON.parse(await evaluate(ws, OLCUM));
    console.log('F3 YÜZEY PARİTESİ (zoom sonrası): ' + JSON.stringify(parite3));

    /* F3 sonrası montaj (genelde temiz — F1/F2 montajları bozuk anı taşır) */
    await montajYaz('f3');
  } catch (e) {
    console.error('SPC HATASI: ' + (e && e.message ? e.message.slice(0, 400) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* */ }
  }
})();
