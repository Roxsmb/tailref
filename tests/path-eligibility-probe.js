'use strict';
/* =========================================================
   path-eligibility-probe.js — ink-bench path=0 kırığının
   kök nedeni: hangi eligibility koşulu 'ink-hard' vuruşunu
   damla yoluna düşürüyor? Tanısal probe, kapı değil.
   Kullanım: node tests/path-eligibility-probe.js
   ========================================================= */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9361;
const APP_PORT = 5231;
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
  throw new Error('debug portu acilmadi');
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

/* Bench ile birebir aynı vuruş üretimi + koşul-koşul eligibility ayrıştırması */
const PROBE = `(async () => {
  const ink = inkState();
  if (!ink.brushes || !ink.brushes.length) {
    if (typeof inkDefaultBrushes === 'function') ink.brushes = inkDefaultBrushes();
  }
  function makePoints(n, kind) {
    const pts = [];
    const turns = 5;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const a = t * Math.PI * 2 * turns;
      const r = 60 + 640 * t;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.75,
        p: kind === 'soft' ? 0.55 + 0.35 * Math.sin(t * Math.PI) : 1 });
    }
    return pts;
  }
  const hardStroke = {
    id: 'sk_probe_hard', kind: 'stroke', tool: 'brush', shape: '',
    color: '#2f7bff', size: 24, opacity: 1, hardness: 1, spacing: 0.07,
    brushId: 'ink-hard', scatter: 0, closed: false, points: makePoints(1000, 'hard'),
  };
  const softStroke = {
    id: 'sk_probe_soft', kind: 'stroke', tool: 'brush', shape: '',
    color: '#2f7bff', size: 24, opacity: 1, hardness: 0.4, spacing: 0.09,
    brushId: 'ink-soft', scatter: 0, closed: false, points: makePoints(1000, 'soft'),
  };
  const coz = id => {
    const resolved = (typeof inkResolveBrushId === 'function') ? inkResolveBrushId(id) : id;
    return (ink.brushes || []).find(b => b.id === resolved) || null;
  };
  const cozumle = (stroke) => {
    const brush = coz(stroke.brushId);
    const sizePx = stroke.size; /* bench mapPoint K=0.5 için size*0.5=12 değil; gerçek commit yolunu taklit et */
    const sonuc = { brushId: stroke.brushId, resolvedId: brush ? brush.id : null, eligible: null, nedenler: [] };
    if (!brush) { sonuc.nedenler.push('brush bulunamadi'); sonuc.eligible = false; return sonuc; }
    /* inkStrokePathEligible koşullarını tek tek test et (33-ink-stamp.js sırasıyla) */
    const N = [];
    if (!(stroke.kind === 'stroke')) N.push('kind');
    if (!(sizePx >= 2)) N.push('sizePx');
    if (brush.tip && brush.tip !== 'circle') N.push('tip=' + brush.tip);
    if (brush.angleFollow) N.push('angleFollow');
    if ((stroke.scatter || 0) > 0) N.push('stroke.scatter');
    if ((stroke.flowJitter || 0) > 0) N.push('stroke.flowJitter');
    if ((stroke.taperStart || 0) > 0 || (stroke.taperEnd || 0) > 0) N.push('taper(stroke)');
    if (brush.kind === 'abr') N.push('kind=abr');
    if (brush.dual) N.push('dual');
    if (brush.scatterCount > 1 || brush.scatterCountJitter > 0) N.push('scatterCount');
    if (brush.noise > 0) N.push('noise');
    if (brush.wetEdges > 0) N.push('wetEdges');
    if (brush.airbrush) N.push('airbrush');
    if (brush.buildUp === false) N.push('buildUp=false');
    if (brush.scatterX != null && brush.scatterX !== brush.scatter) N.push('scatterX');
    if (brush.scatterY != null && brush.scatterY !== brush.scatter) N.push('scatterY');
    const cd = brush.colorDynamics || {};
    if (cd.foregroundBackground || cd.hueJitter || cd.saturationJitter || cd.brightnessJitter || cd.purity) N.push('colorDynamics');
    if (Number.isFinite(brush.roundness) && brush.roundness < 0.98) N.push('roundness=' + brush.roundness);
    const dyn = brush.dynamics || {};
    if (dyn.angleJitter > 0 || dyn.scatterJitter > 0 || dyn.spacingJitter > 0 ||
        dyn.sizeJitter > 0 || dyn.roundnessJitter > 0 || dyn.roundnessMin < 1 ||
        dyn.opacityJitter > 0 || dyn.src === 'random') N.push('dynamics=' + JSON.stringify(dyn));
    if (Number.isFinite(brush.flow) && brush.flow < 0.08) N.push('flow=' + brush.flow);
    if (Number.isFinite(brush.flowJitter) && brush.flowJitter > 0) N.push('flowJitter');
    if (brush.texture) N.push('texture');
    if ((stroke.speedSize || 0) > 0 || (brush.speedSize > 0)) N.push('speedSize stroke=' + (stroke.speedSize || 0) + ' brush=' + brush.speedSize);
    if (typeof inkBrushDynamics === 'function') {
      const bd = inkBrushDynamics(brush);
      if (bd.src === 'velocity') N.push('dynSrc=velocity');
      if (bd.src === 'pressure' && bd.sizeMin < 0.05) N.push('pressure sizeMin=' + bd.sizeMin);
    }
    const hardness = stroke.tool === 'eraser' ? 1 : Number(stroke.hardness);
    if (!(hardness >= (typeof INK_PATH_MIN_HARDNESS !== 'undefined' ? INK_PATH_MIN_HARDNESS : 0.98))) {
      N.push('hardness=' + hardness + ' (min ' + (typeof INK_PATH_MIN_HARDNESS !== 'undefined' ? INK_PATH_MIN_HARDNESS : '?') + ')');
    }
    let min = 1, max = 0;
    for (const p of stroke.points) {
      if (p.br) { N.push('br'); break; }
      min = Math.min(min, p.p == null ? 1 : p.p); max = Math.max(max, p.p == null ? 1 : p.p);
    }
    if (max - min > 0.6) N.push('pressure araligi=' + (max - min).toFixed(2));
    sonuc.eligible = typeof inkStrokePathEligible === 'function'
      ? inkStrokePathEligible(stroke, brush, sizePx) : null;
    sonuc.nedenler = N;
    /* gerçek commit sizePx'i: bench mapPoint K=0.5 */
    sonuc.eligibleK05 = typeof inkStrokePathEligible === 'function'
      ? inkStrokePathEligible(stroke, brush, stroke.size * 0.5) : null;
    sonuc.brushOzet = { tip: brush.tip, speedSize: brush.speedSize, flow: brush.flow,
      hardness: brush.hardness, roundness: brush.roundness,
      dynamics: brush.dynamics || null, texture: !!brush.texture, dual: !!brush.dual };
    return sonuc;
  };
  return { hard: cozumle(hardStroke), soft: cozumle(softStroke),
    nativeBrushCount: (ink.brushes || []).length };
})()`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-pep-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);
    console.log('PROBE: ' + await evaluate(ws, PROBE));
  } catch (e) {
    console.error('PEP HATASI: ' + (e && e.message ? e.message.slice(0, 400) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* son nefes */ }
    await sleep(300);
  }
})();
