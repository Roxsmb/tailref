'use strict';

/* Kontrol: yeniden boyutlendirmede Shift davranışı (kullanıcı isteği:
   "Shift basılıyken nerden tutup çekersek itsek görsel asla bozulmasın")
   1) Shiftsiz ORTA tutamaç → görsel uzar (eski davranış, bozulma olur)
   2) Shift basılı ORTA tutamaç → uniform ölçek, oran korunur
   3) Shift basılı KÖŞE → oran korunur (eskiden beri, halen çalışır)
   4) Shift+Alt → serbest deformasyon (Alt Shift'ten güçlü)
   5) karşılık: Shiftsiz köşe TH de oran korur (var olan düzen) */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9341;
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
    if (msg.result.exceptionDetails) return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

async function waitForTarget(deadlineMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { }
    await sleep(400);
  }
  throw new Error('hata ayıklama portu açılmadı');
}

/** hx/hy tutamacı; dst: {vx, vy} istenen dünya eksen değerleri (rot=0).
    Shift/alt uygulanır; sürüklenen konumdaki nihai öğe ölçüleri döner. */
const runDrag = (hx, hy, vx, vy, shift, alt) => `(async () => {
  try {
    const hx = ${hx}, hy = ${hy};
    const shiftK = ${shift ? 'true' : 'false'}, altK = ${alt ? 'true' : 'false'};
    const it = state.items.find(i => i.id === 'it_shift_probe');
    if (!it) return { err: 'denek yok' };
    it.rot = 0;
    syncSelection();
    const c = itemCenter(it);
    const ax = c.x - hx * it.w / 2;
    const ay = c.y - hy * (it.h || 0) / 2;
    // tutamaç o anki dünya konumu = anchor + (hx*w0/2, hy*h0/2)
    const px1 = ax + hx * it.w / 2, py1 = ay + hy * (it.h || 0) / 2;
    const s1 = worldToScreen({ x: px1, y: py1 });
    startResize(it, hx, hy, { clientX: s1.x, clientY: s1.y, shiftKey: shiftK, altKey: altK });
    const s2 = worldToScreen({ x: ax + hx * ${vx}, y: ay + hy * ${vy} });
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: s2.x, clientY: s2.y, shiftKey: shiftK, altKey: altK, bubbles: true,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: s2.x, clientY: s2.y, shiftKey: shiftK, altKey: altK, bubbles: true,
    }));
    await new Promise(r => setTimeout(r, 120));
    return { w: it.w, h: it.h, x: it.x, y: it.y };
  } catch (err) {
    return { err: String(err && err.message || err) };
  }
})()`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-shiftres-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  const results = {};
  let ws = null;
  try {
    const page = await waitForTarget();
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

    let ready = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try { ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth"); if (ready) break; } catch { }
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');
    await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
    await sleep(700);
    await evaluate(ws, 'window.__errs = []; window.addEventListener("error", e => window.__errs.push(String(e.message || e))); true');

    results.added = await evaluate(ws, `(async () => {
      try {
        const c = document.createElement('canvas');
        c.width = 400; c.height = 300;
        const x = c.getContext('2d');
        x.fillStyle = '#4a7fb0'; x.fillRect(0, 0, 400, 300);
        x.fillStyle = '#ffffff'; x.beginPath(); x.arc(200, 150, 50, 0, 7); x.fill();
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const imageId = 'img_shift_probe';
        await idbPut('images', imageId, { blob, name: 'shift-denek.png' });
        const entry = await decodeImage(blob);
        setImgCache(imageId, { img: entry.img, url: entry.url, name: 'shift-denek.png' });
        const it = { id: 'it_shift_probe', kind: 'image', imageId, title: 'shift-denek', x: 0, y: 0, w: 400, h: 300, rot: 0, z: nextZ() };
        state.items.push(it);
        selection = new Set([it.id]);
        selectionOrder = [it.id];
        syncAll();
        syncSelection();
        await new Promise(r => setTimeout(r, 300));
        return true;
      } catch (err) { return String(err && err.message || err); }
    })()`);
    if (results.added !== true) throw new Error('denek eklenemedi: ' + results.added);

    /* 1 · Shiftsiz orta kenar → uzat (bozma): sağ kenar vx=600 */
    results.edgeFree = await evaluate(ws, runDrag(1, 0, 600, 0, false, false));
    results.checkEdgeFree = { w: results.edgeFree.w, h: results.edgeFree.h, ornekOran: ((results.edgeFree.w || 1) / (results.edgeFree.h || 1)).toFixed(3), bozu: results.edgeFree.h !== 300 };

    /* 2 · Shift basılı orta kenar → uniform: aynı hareketle w=600 h=450 */
    await evaluate(ws, `(function(){ const it = state.items.find(i => i.id === 'it_shift_probe'); it.w = 400; it.h = 300; updateItemEl(it, elMap.get(it.id)); return true; })()`);
    results.edgeShift = await evaluate(ws, runDrag(1, 0, 600, 0, true, false));

    /* 3 · Shift+Alt orta kenar → serbest (h kalır) */
    await evaluate(ws, `(function(){ const it = state.items.find(i => i.id === 'it_shift_probe'); it.w = 400; it.h = 300; updateItemEl(it, elMap.get(it.id)); return true; })()`);
    results.edgeShiftAlt = await evaluate(ws, runDrag(1, 0, 600, 0, true, true));

    /* 4 · Shift basılı köşe → oran korunur (640x480 hedefi: vx=+640) */
    await evaluate(ws, `(function(){ const it = state.items.find(i => i.id === 'it_shift_probe'); it.w = 400; it.h = 300; updateItemEl(it, elMap.get(it.id)); return true; })()`);
    results.cornerShift = await evaluate(ws, runDrag(1, 1, 640, 560, true, false));

    /* 5 · .sw palet kural çakışması: sol-alt tutamacın merkezlemesi hover
       palet kurallarıyla ezilmemeli (kullanıcı raporu: sol alt sağa kayar) */
    results.swScoping = await evaluate(ws, `(() => {
      let hoverScoped = false, baseScoped = false;
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const r of rules) {
          const t = r.cssText || '';
          if (t.includes('.sw:not(.handle):not(.ghandle):hover')) hoverScoped = true;
          if (t.includes('transform:scale(1.14)') && t.startsWith('.sw:not(')) baseScoped = true;
          if (/^\\.sw:hover\\{/.test(t)) return JSON.stringify({ stale: true, t: t.slice(0, 60) });
        }
      }
      return JSON.stringify({ hoverScoped, baseScoped });
    })()`);
    results.swMatrix = await evaluate(ws, `(() => {
      const g = document.querySelector('.ghandle.sw') || document.querySelector('.handle.sw');
      if (!g) return 'tutamaç yok';
      const m = getComputedStyle(g).transform;
      return JSON.stringify({ tf: m, hasCentering: /matrix\\([^)]*-5\\s*,\\s*-5/.test(m) || m.includes('matrix(1, 0, 0, 1, ') });
    })()`);
    results.errs = await evaluate(ws, 'JSON.stringify(window.__errs)');
  } catch (e) {
    results.error = e.message;
  } finally {
    try { ws && ws.close(); } catch { }
    try { app.kill(); } catch { }
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { }
  }

  const num = v => Number(v) || 0;
  const near = (a, b, tol = 1.5) => Math.abs(num(a) - b) <= tol;
  const ok = (name, cond, detail) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}  ${detail == null ? '' : '→ ' + detail}`);

  ok('denek görsel eklendi', results.added === true, JSON.stringify(results.added));
  const ef = results.edgeFree || {};
  ok('Shiftsiz orta kenar uzatır (bozar)', near(ef.w, 600) && ef.h === 300, `w=${ef.w} h=${ef.h}`);
  const es = results.edgeShift || {};
  ok('Shift basılı orta kenar ASLA bozmaz (uniform)', near(es.w, 600) && near(es.h, 450) && near(es.w / es.h, 400 / 300, 0.01), `w=${es.w} h=${es.h}`);
  const ea = results.edgeShiftAlt || {};
  ok('Shift+Alt serbest (Alt üstün)', near(ea.w, 600) && near(ea.h, 300), `w=${ea.w} h=${ea.h}`);
  const cs = results.cornerShift || {};
  ok('Shift basılı köşe oran korur', near(cs.w, 640) && near(cs.h, 480) && near(cs.w / cs.h, 400 / 300, 0.01), `w=${cs.w} h=${cs.h} oran=${(cs.w / cs.h).toFixed(3)}`);
  ok('sayfada hata yok', results.errs === '[]', results.errs);

  const swS = (() => { try { return JSON.parse(results.swScoping || '{}') } catch { return {} } })();
  ok('palet .sw hover kuralları tutamaçları dışlıyor', swS.hoverScoped === true && swS.stale === undefined && results.swScoping.includes('"hoverScoped":true'), results.swScoping);
  ok('sol-alt tutamaç merkezleme transformu sağlam', /matrix\(1, 0, 0, 1|translate\(-50%/.test(String(results.swMatrix)), results.swMatrix);

  if (results.error) {
    console.log('HATA: ' + results.error);
    console.log(JSON.stringify(results, null, 1));
    process.exit(1);
  }
  process.exit(0);
})();
