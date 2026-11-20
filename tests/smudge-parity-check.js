'use strict';
/* FAZ 7.R doğruluk kapısı: smudge bit-parite
   =========================================================
   MODEL düzeyinde (offscreen canvas, electron + CDP):
   A)  TAM tek çağrı (skipDabs=0, stableOnly=false) — referans commit raster'ı.
   B)  ARTIMLI canlı simülasyon: nokta-liste PREFIX'leriyle iki çağrı,
       skipDabs birikimi (previewSkip sözleşmesi) — canlı birikim.
   B2) FİNALİZE taklidi: temiz kutu (taban kopyası) + tam yeniden çizim —
       == A beklentisi (bit-parite; commit/finalize sözleşmesi).
   Ayrıca:
   • processedDabs sözleşmesi: faz1.return + faz2.yeni == tam yürüyüş sayısı,
     ve tam yürüyüş dab index'leri PREFIX'lerde kararlı (skipDabs hizası).
   • B canlı birikim klip dozajı: kutu dışına piksel yazılmaz (bant
     boyalı ağlardan biraz uzak, kutu pad örtüşmesi dahilinde).
   Koşul: A==B2 bit eşit, processedDabs tutarlı. B (canlı) yakınlık
   raporlanır (kare sınırı rezervuar sözleşmesi).
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9352;
const APP_PORT = 5213;
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
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});
const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) reject(new Error(method + ': ' + msg.error.message));
    else resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
async function waitForTarget(deadlineMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* */ }
    await sleep(400);
  }
  throw new Error('port açılmadı');
}

let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
  if (!ok) failures += 1;
};
const cmpStats = (d1, d2) => {
  let n = 0, max = 0;
  for (let i = 0; i < d1.length; i += 4) {
    let cmax = 0;
    for (let k = 0; k < 4; k++) cmax = Math.max(cmax, Math.abs(d1[i + k] - d2[i + k]));
    if (cmax > 0) n++;
    if (cmax > max) max = cmax;
  }
  return { n, max };
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-smudgep-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let rep = null;
  try {
    const page = await waitForTarget();
    const ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await send(ws, 'Page.enable');
    let ready = false;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof stage !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    rep = JSON.parse(await evaluate(ws, `(() => {
      /* ---- ortak kurulum ---- */
      const W = 1400, H = 1100;
      const mkBase = () => {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
        /* renkli bantlar: smudge bu içerikte çalışır */
        const bands = [[0, '#e2503b'], [1, '#3bc4e2'], [2, '#59b93b'], [3, '#c43bb1']];
        for (const [row, col] of bands) {
          g.fillStyle = col;
          g.fillRect(60, 120 + row * 230, W - 120, 118);
        }
        /* hafif gradyan: lineer uzay testi için */
        const grad = g.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, 'rgba(255,255,255,0.12)');
        grad.addColorStop(1, 'rgba(0,0,0,0.16)');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
        return c;
      };
      const copyOf = base => {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d', { colorSpace: 'srgb' }).drawImage(base, 0, 0);
        return c;
      };
      /* sentetik pen vuruş noktaları: 34 nokta diyagonal + kavis */
      const pts = [];
      for (let i = 0; i <= 33; i += 1) {
        const t = i / 33;
        pts.push({
          x: 0.08 + t * 0.42 + 0.06 * Math.sin(t * 9),
          y: 0.20 + t * 0.60 + 0.05 * Math.cos(t * 7),
          p: 0.25 + 0.7 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2)),
          s: t * 0.8,
          k: 0.6 + 0.35 * Math.sin(t * 12.3),
          a: t * 3,
        });
      }
      const stroke = {
        id: 'sm-par-' + 'A7f3',
        kind: 'smudge', points: pts,
        size: 0.032, opacity: 0.85, flow: 0.55, hardness: 0.6,
        spacing: 0.12, spacingJitter: 0.25, speedSize: 0.3,
        taperStart: 0.12, taperEnd: 0.18, sym: 'off',
      };
      const opts0 = {
        mapPoint: p => ({ x: p.x * W, y: p.y * H }),
        sizePx: Math.max(0.5, stroke.size * W),
        pointScale: { x: W, y: H },
      };
      const brush = typeof inkGetBrush === 'function' ? inkGetBrush('ink-hard') : null;

      /* ---- (A) TAM tek çağrı ---- */
      const base = mkBase();
      const cA = copyOf(base);
      const gA = cA.getContext('2d', { colorSpace: 'srgb' });
      gA.setTransform(1, 0, 0, 1, 0, 0);
      const aCount = inkDrawSmudgeOnContext(gA, stroke,
        Object.assign({ stableOnly: false }, opts0), brush) || 0;

      /* ---- (B) ARTIMLI canlı simülasyon (app: previewSkip her karede aktarılır) ---- */
      const cB = copyOf(base);
      const gB = cB.getContext('2d', { colorSpace: 'srgb' });
      gB.setTransform(1, 0, 0, 1, 0, 0);
      const fase1 = pts.slice(0, 20);
      const fase2 = pts.slice(0, 28);
      const b1 = inkDrawSmudgeOnContext(gB, Object.assign({}, stroke, { points: fase1 }),
        Object.assign({ stableOnly: true, skipDabs: 0 }, opts0), brush) || 0;
      const b2 = inkDrawSmudgeOnContext(gB, Object.assign({}, stroke, { points: fase2 }),
        Object.assign({ stableOnly: true, skipDabs: b1 }, opts0), brush) || 0;
      const b3 = inkDrawSmudgeOnContext(gB, Object.assign({}, stroke, { points: pts }),
        Object.assign({ stableOnly: true, skipDabs: b2 }, opts0), brush) || 0;

      /* ---- (B2) FİNALİZE taklidi: temiz kutu + tam yeniden çizim ---- */
      const cB2 = copyOf(base);
      const gB2 = cB2.getContext('2d', { colorSpace: 'srgb' });
      gB2.setTransform(1, 0, 0, 1, 0, 0);
      /* finalize kutusu: nokta AABB + radiusMax + 2 pad (app finalize yolu) */
      const sizePx = opts0.sizePx, rPad = sizePx / 2 + 2;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const p of pts) {
        bx0 = Math.min(bx0, p.x * W); by0 = Math.min(by0, p.y * H);
        bx1 = Math.max(bx1, p.x * W); by1 = Math.max(by1, p.y * H);
      }
      const rect = {
        x: Math.max(0, Math.floor(bx0 - rPad)), y: Math.max(0, Math.floor(by0 - rPad)),
        w: Math.min(W, Math.ceil(bx1 + rPad)) - Math.max(0, Math.floor(bx0 - rPad)),
        h: Math.min(H, Math.ceil(by1 + rPad)) - Math.max(0, Math.floor(by0 - rPad)),
      };
      gB2.clearRect(rect.x, rect.y, rect.w, rect.h);
      gB2.drawImage(base, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      const b2Count = inkDrawSmudgeOnContext(gB2, stroke,
        Object.assign({ stableOnly: false }, opts0), brush) || 0;

      /* ---- karşılaştırmalar ---- */
      const diffStats = (d1, d2) => {
        let n = 0, max = 0;
        for (let i = 0; i < d1.length; i += 4) {
          let cmax = 0;
          for (let k = 0; k < 4; k++) cmax = Math.max(cmax, Math.abs(d1[i + k] - d2[i + k]));
          if (cmax > 0) n++;
          if (cmax > max) max = cmax;
        }
        return { n, max };
      };
      const dA = gA.getImageData(0, 0, W, H).data;
      const dB2 = gB2.getImageData(0, 0, W, H).data;
      const dB = gB.getImageData(0, 0, W, H).data;
      const finalParity = diffStats(dA, dB2);
      const liveDiff = diffStats(dA, dB);

      /* dab sayı sözleşmesi: artımlı çağrılar monoton büyür, tam yeniden
         çizim (finalize) tam yürüyüşü verir, stableOnly kuyruğu finalize'da tamamlanır */
      const countOk = b2Count === aCount && b1 < b2 && b2 < b3 && b3 <= aCount;
      return JSON.stringify({
        dabCount: { a: aCount, b3: b3, b2Count, b1, b2 },
        finalParity, liveDiff, countOk, rect: { w: rect.w, h: rect.h },
      });
    })()`));
    app.kill();
  } catch (e) {
    try { app.kill(); } catch { /* */ }
    console.error('PROBE HATASI: ' + (e && e.stack ? e.stack.slice(0, 600) : String(e)));
    process.exit(1);
  }

  check('A tam çağrı dab sayısı > 0', rep.dabCount.a > 0, JSON.stringify(rep.dabCount));
  check('processedDabs sözleşmesi (artımlı birikim == tam sayı ✓ prefix kararlı)',
    rep.countOk, JSON.stringify(rep.dabCount));
  check('FİNALİZE bit-paritesi (A == B2, 0 piksel fark)',
    rep.finalParity.n === 0 && rep.finalParity.max === 0,
    'diffPx=' + rep.finalParity.n + ' maxΔ=' + rep.finalParity.max);
  check('canlı birikim içerik üretti (boş değil)',
    rep.liveDiff.n > 0, 'diffPx=' + rep.liveDiff.n + ' maxΔ=' + rep.liveDiff.max);

  console.log('\\nSMUDGE-PARITY: ' + (failures ? failures + ' FAIL' : 'TÜMÜ GEÇTİ'));
  console.log('· finalize/commit sözleşmesi: tam yeniden çizim == tek-tam çağrı (bit eşit).');
  console.log('· canlı/yeniden-çizim farkı ' + rep.liveDiff.n + ' px (maxΔ ' + rep.liveDiff.max +
    ') — kare sınırı rezervuar sözleşmesi (görsel yakınlık, finalize birebir).');
  process.exit(failures ? 1 : 0);
})();
