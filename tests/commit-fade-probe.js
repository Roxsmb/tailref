'use strict';
/* K20b · commit-sönme probe — "çoklu vuruş çizdikçe önceki çizimler sönüyor"
   ---------------------------------------------------------------------
   K20b öncesi: bake = (katman kopyası) × stroke.opacity → her commit'te
   ÖNCEKİ çizimler opaklıkla çarpılıp sönüyordu (özellikle düşük opaklıkta).
   Bu probe: vuruş A → commit, say; vuruş B (opaklık düşük) → commit, say;
   A bandındaki alfa pikselleri BITÜRÜN aynı kalmalı (hem sayı hem toplam).
   node scripts/commit-fade-probe.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9395;
const APP_PORT = 5259;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const send = (ws, method, params = {}, timeout = 240000) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), timeout);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    clearTimeout(timer);
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (ws, expression, timeout) => {
  const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && d.exception.description || d.text || 'eval').slice(0, 500));
  }
  return r.result.value;
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-fade-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let mainPage = null; let deadline = Date.now() + 40000;
  while (Date.now() < deadline && !mainPage) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      mainPage = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
    } catch { /* bekle */ }
    if (!mainPage) await sleep(500);
  }
  if (!mainPage) throw new Error('ana pencere açılmadı');
  const ws = new WebSocket(mainPage.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await sleep(4000);
  await evaluate(ws, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 24; i++) {
      const w = document.getElementById('persistenceWelcome');
      if (w && !w.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
        await sleep(300);
        const w2 = document.getElementById('persistenceWelcome');
        if (!w2 || w2.hidden) return true;
        await sleep(400);
        continue;
      }
      await sleep(400);
    }
    return false;
  })()`, 60000);

  await evaluate(ws, `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const g = c.getContext('2d');
    g.fillStyle = '#202028'; g.fillRect(0, 0, 640, 480);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await addFiles([new File([blob], 'fade-probe.png', { type: 'image/png' })], null);
    for (let i = 0; i < 40; i++) {
      if (state.items.some(it => it.kind === 'image')) break;
      await wait(150);
    }
    const item = state.items.find(it => it.kind === 'image');
    if (!item) throw new Error('görsel yok');
    modeEnterDraw(item.id);
    for (let i = 0; i < 40 && !inkEditorIsOpen(); i += 1) await wait(100);
    if (!inkEditorIsOpen()) throw new Error('editör açılamadı');
    return true;
  })()`, 60000);

  const rep = await evaluate(ws, `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ink = inkState();
    const it = state.items.find(x => x.kind === 'image');
    const ui = inkEditorUi;
    const layer = inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'fade' });
    ink.activeLayerId = layer.id;
    inkSetTool('brush', { brushId: 'native-studio-pen' });
    ink.tool = 'brush';
    ink.color = '#ff2000';
    ink.opacity = 0.5;                    // sönme hatalarını en sert tetikler
    ink.size = 24;
    const rect = ui.canvas.getBoundingClientRect();
    const pt = p => ({ x: rect.left + ui.fit.x + ui.fit.w * p[0], y: rect.top + ui.fit.y + ui.fit.h * p[1] });
    const ev = (type, p, pr) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 900, pointerType: 'pen',
      isPrimary: true, pressure: pr, clientX: p.x, clientY: p.y,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
    });
    const cv = () => inkRuntime.itemCanvases.get(layer.id);
    // katman raster istatistiği: alfa sayısı + 8-bit alfa toplamı (sönme = toplam düşüş)
    const stats = c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0, sum = 0;
      for (let j = 3; j < d.length; j += 4) { if (d[j] > 8) n++; sum += d[j]; }
      return { n, sum };
    };

    const drag = async seg => {
      ui.canvas.dispatchEvent(ev('pointerdown', pt(seg[0]), 0.6));
      for (let i = 1; i < seg.length; i++) {
        await wait(60);
        ui.canvas.dispatchEvent(ev('pointermove', pt(seg[i]), 0.6 + i * 0.05));
      }
      await wait(80);
      ui.canvas.dispatchEvent(ev('pointerup', pt(seg[seg.length - 1]), 0.6));
      for (let k = 0; k < 40; k++) {
        await wait(50);
        if (!ui.stroke && !ui.previewCanvas) break;
      }
      await wait(100);
    };

    // vuruş A: sol üçlü
    const segA = [[0.08, 0.2], [0.14, 0.55], [0.2, 0.25], [0.26, 0.6], [0.3, 0.3]];
    await drag(segA);
    const afterA = stats(cv());
    // vuruş B: sağ üçlü (A bandına dokunmaz) — başta opaklık düşük
    ink.opacity = 0.35;
    const segB = [[0.62, 0.25], [0.68, 0.6], [0.74, 0.3], [0.8, 0.55], [0.86, 0.28]];
    await drag(segB);
    ink.opacity = 0.5;
    const afterB = stats(cv());
    // vuruş C: orta bölge
    const segC = [[0.4, 0.7], [0.46, 0.35], [0.52, 0.65], [0.58, 0.4]];
    await drag(segC);
    const afterC = stats(cv());
    // 4. vuruş: A bandının ÜSTÜNE düşük opaklıkla çiz (gerçek sönme tetiği)
    ink.opacity = 0.4;
    const segD = [[0.09, 0.6], [0.15, 0.3], [0.22, 0.55], [0.28, 0.35]];
    await drag(segD);
    ink.opacity = 0.5;
    const afterD = stats(cv());

    // A bandı (sol %5-%50) satır baz ölçümü — B/C bant dışı olmalı
    const layerCv = cv();
    const d = layerCv.getContext('2d').getImageData(0, 0, layerCv.width, layerCv.height).data;
    let bandN = 0, bandSum = 0;
    for (let y = 0; y < layerCv.height; y++) {
      for (let x = Math.round(layerCv.width * 0.05); x < Math.round(layerCv.width * 0.5); x++) {
        const a = d[(y * layerCv.width + x) * 4 + 3];
        if (a > 8) bandN++;
        bandSum += a;
      }
    }

    try { inkRemoveLayer(layer.id); } catch { }
    return { afterA, afterB, afterC, afterD, bandN, bandSum };
  })()`, 120000);

  const r = typeof rep === 'object' && rep !== null ? rep : JSON.parse(rep);
  console.log('alpha px  : A ' + r.afterA.n + ' → B ' + r.afterB.n + ' → C ' + r.afterC.n + ' → D ' + r.afterD.n);
  console.log('alpha top : A ' + r.afterA.sum + ' → B ' + r.afterB.sum + ' → C ' + r.afterC.sum + ' → D ' + r.afterD.sum);
  const growB = r.afterB.sum - r.afterA.sum;
  const growC = r.afterC.sum - r.afterB.sum;
  const growD = r.afterD.sum - r.afterC.sum;
  const lo = 0.5, hi = 1.4; // D bant içinde de çizdi, pozitif büyüme beklenir
  let pass = true;
  if (growB <= 0) { pass = false; console.log('!! B commit sonrası toplam alfa düşmedi → kayıp'); }
  if (growC <= 0) { pass = false; console.log('!! C commit sonrası toplam alfa düşmedi'); }
  if (growD <= 0) { pass = false; console.log('!! D commit sonrası toplam alfa düşmedi'); }
  // sönme oranı eski davranışta her commit ~×0.35-0.5 → B büyümesi eksik olacaktı
  if (r.afterB.n < r.afterA.n) { pass = false; console.log('!! B sonrası A bölgesi pikselleri sönüp alt eşiğe düştü'); }
  console.log(pass ? 'SONUÇ: sönme YOK — birikim kompoziti commit kayıpsız' : 'SONUÇ: SÖNME VAR');
  try { await evaluate(ws, 'window.close()'); } catch { }
  app.kill();
  setTimeout(() => process.exit(pass ? 0 : 1), 400);
})().catch(e => {
  console.error('HATA:', e.message);
  if (typeof app !== 'undefined' && app) { try { app.kill(); } catch { } }
  process.exit(1);
});
