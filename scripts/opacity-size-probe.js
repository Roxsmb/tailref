'use strict';
/* K14 · opaklık/boyut doğrulama kanalı — endüstriyel model denetimi.
 *
 * • OPKLK: %8 vuruş iç dolgusu ≈ %8 örtüklik (PS kuralı: "opaklık bir
 *   vuruşta birikmez"). Eskiden damla birikimi yüzünden iç dolgu
 *   ~%56'ya katlanıyordu (kullanıcı raporu).
 * • BOYUT: 75px fırça tam basınçta merkez satırda ~75px genişlik bırakır.
 *
 *   node scripts/opacity-size-probe.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9378;
const APP_PORT = 5238;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
  if (ok) pass++; else fail++;
};

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
const evaluate = async (ws, expression) => {
  const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};

/* Beyaz zemine düşük opaklıkla düz vuruş çizer, döner: {satır pikselleri}
   nesnesini JSON-sıralı ham sayı dizisiyle. */
const renderProbe = (params) => {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 120;
  const ctx = c.getContext('2d', { colorSpace: 'srgb' });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 320, 120);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const pts = [];
  for (let x = 90; x <= 230; x += 2) pts.push({ x: x / 320, y: 0.5, p: 1, s: 0 });
  const stroke = {
    id: 'probe-' + params.name,
    kind: 'stroke',
    tool: 'brush',
    brushId: 'soft-round',
    color: '#0000ff',
    opacity: params.opacity,
    size: params.size,
    spacing: params.spacing,
    flow: 1,
    hardness: 1,
    sym: 'off',
    points: pts,
  };
  inkDrawStrokeOnContext(ctx, stroke, {
    mapPoint: p => ({ x: p.x * 320, y: p.y * 120 }),
    sizePx: params.size,
    pointScale: { x: 320, y: 120 },
  });
  const data = ctx.getImageData(0, 0, 320, 120).data;
  return { data: Array.from(data), w: 320, h: 120, op: params.opacity, size: params.size, name: params.name };
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-opprobe-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let page = null; const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !page) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
    } catch { /* bekle */ }
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('pencere açılmadı');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await sleep(4000);
  await evaluate(ws, `document.getElementById('modeDrawBtn')?.click()`);
  await sleep(1200);

  // ---- OPKLK-1: %8 opaklık → iç dolgu ≈ %8 (8-bit tol −) -----------
  const low = await evaluate(ws, `(${renderProbe})({ name:'low', opacity:0.08, size:60, spacing:0.1 })`);
  {
    // iç dolgu ortalaması: vuruş gövdesi x∈[125,195] satır 60.
    let sum = 0, n = 0;
    const row = 60;
    for (let x = 125; x <= 195; x += 2) {
      const i = (row * 320 + x) * 4;
      sum += (255 - low.data[i]) / 255;
      n++;
    }
    const cov = sum / n;
    check('OPKLK-1 · %8 opaklık iç dolgusu ≈ %8 (birikme yok)',
      cov > 0.045 && cov < 0.13,
      `ort örtülük=${(cov * 100).toFixed(1)}%`);
  }

  // ---- OPKLK-2: %1 opaklık → görünür-bir azınlık tavanda birikme yok
  const faint = await evaluate(ws, `(${renderProbe})({ name:'faint', opacity:0.01, size:60, spacing:0.1 })`);
  {
    const row = 60, x = 160, i = (row * 320 + x) * 4;
    const r = faint.data[i];
    const cov = (255 - r) / 255;
    check('OPKLK-2 · %1 opaklık iç dolgusu ≈ %1 (tavana katlanma yok)',
      cov < 0.06,
      `r=${r} → cov=${(cov * 100).toFixed(2)}%`);
  }

  // ---- OPKLK-3: %100 opaklık → tam doygunluk (regresyon donanımsı) --
  const solid = await evaluate(ws, `(${renderProbe})({ name:'solid', opacity:1, size:60, spacing:0.1 })`);
  {
    const row = 60, x = 160, i = (row * 320 + x) * 4;
    const r = solid.data[i];
    check('OPKLK-3 · %100 opaklık hâlâ tam doygun',
      r <= 1, `r=${r}`);
  }

  // ---- BOYUT-1: 75px fırça → orta kolon dikey kalınlık ≈ 75px ------
  const size = await evaluate(ws, `(${renderProbe})({ name:'size', opacity:1, size:75, spacing:0.1 })`);
  {
    const col = 160;
    let top = -1, bot = -1;
    for (let y = 0; y < 120; y++) {
      const i = (y * 320 + col) * 4;
      if (size.data[i] < 250) { if (top < 0) top = y; bot = y; }
    }
    const span = bot - top + 1;
    check('BOYUT-1 · 75px fırça tam basınçta ~75px kalınlık (±3)',
      top >= 0 && Math.abs(span - 75) <= 3,
      `kalınlık=${span}px  [${top},${bot}]`);
  }

  // ---- BOYUT-2: çıktı sabitliği — ikinci çizim aynı kalınlık --------
  const size2 = await evaluate(ws, `(${renderProbe})({ name:'size2', opacity:1, size:75, spacing:0.1 })`);
  {
    const col = 160;
    let top = -1, bot = -1;
    for (let y = 0; y < 120; y++) {
      const i = (y * 320 + col) * 4;
      if (size2.data[i] < 250) { if (top < 0) top = y; bot = y; }
    }
    const span2 = bot - top + 1;
    check('BOYUT-2 · tekrar çizim aynı kalınlıkta (deterministik)',
      Math.abs(span2 - 75) <= 3, `kalınlık=${span2}px`);
  }

  console.log(`\nOPACITY-SIZE PROBE: ${pass}/${pass + fail} ✓`
    + (fail ? ` — ${fail} BAŞARISIZ` : ''));

  try { app.kill(); } catch { }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
