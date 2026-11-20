'use strict';
/* =========================================================
   ink-perf-profile.js — çizim hattı darboğaz profili (v2)
   ---------------------------------------------------------
   Kullanıcı talebi: "uzun boyamalar, farklı fırçalar, büyük
   boyutta çizimler, bir sürü layerlar — nereler darboğaz?"

   Senaryolar:
   S1 · 1600×1200 · 5 fırça × 6 uzun vuruş (hard/soft/marker/air/pencil)
   D  · undo ×8 + redo ×2 (yukarı vuruşlar üstünde)
   L  · +12 katman ekleyip her katmana vuruş
   V  · 13 katman görünürken pan/zoom
   S2 · 3840×2160 büyük tuval · sert + airbrush uzun vuruşlar
   U2 · büyük tuvalde undo ×6

   Ölçüm: __inkPerf snapshot közleri + fonksiyon sarıcıları
   (render/capture/apply/liveSegment/tileFrame) + rAF kadans.
   Kullanım: node tests/ink-perf-profile.js   (probe — kapı DEĞİL)
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9353;
const APP_PORT = 5209;
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
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
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
    } catch { /* henüz hazır değil */ }
    await sleep(400);
  }
  throw new Error('uygulama hata ayıklama portu açılmadı');
}

/* --- ortam yardımcıları (eval içine tek satır JS olarak basılır) --- */
const ENV_JS = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  window.__raf = { samples: [], last: 0 };
  const rafLoop = t => {
    if (window.__raf.last) window.__raf.samples.push(t - window.__raf.last);
    if (window.__raf.samples.length > 6000) window.__raf.samples.splice(0, 2000);
    window.__raf.last = t;
    window.__raf.id = requestAnimationFrame(rafLoop);
  };
  window.__raf.id = requestAnimationFrame(rafLoop);

  window.__PROF = { render: [], capBefore: [], apply: [], live: [], tileFrame: [], rebuild: [], dirtyFlush: [], commit: [] };
  const wrap = (name, key) => {
    const orig = window[name];
    if (typeof orig !== 'function') { window.__PROF[key + '_!'] = true; return; }
    window[name] = function (...args) {
      const t0 = performance.now();
      const out = orig.apply(this, args);
      window.__PROF[key].push(performance.now() - t0);
      if (window.__PROF[key].length > 6000) window.__PROF[key].splice(0, 2000);
      return out;
    };
  };
  wrap('inkEditorRender', 'render');
  wrap('inkEditorCommitStroke', 'commit');
  wrap('inkUndoCaptureBefore', 'capBefore');
  wrap('inkUndoApplyRaster', 'apply');
  wrap('inkEmitLiveSegment', 'live');
  wrap('inkEditorTileFrame', 'tileFrame');
  wrap('inkRerenderLayer', 'rebuild');
  wrap('inkFlushDirtyLayers', 'dirtyFlush');
  window.__inkPerf.reset();

  window.__sleep = wait;
  window.__prof = window.__inkPerf.snapshot;
  /* konum ölçer */
  window.__geometri = () => {
    const canvas = document.getElementById('inkEditorCanvas');
    const fit = inkEditorUi.fit;
    const rect = canvas.getBoundingClientRect();
    return { canvas, fit, rect };
  };
  /* vuruş çizici: brushId + boyut + renk + koordinat + yoğunluk */
  window.__ciz = async (brushId, size, color, y0, y1, steps, ms) => {
    const { canvas, fit, rect } = window.__geometri();
    const tool = ({ 'ink-pencil': 'pencil', 'smudge': 'smudge',
      'eraser': 'eraser' })[brushId] || 'brush';
    inkSetTool(tool, { brushId: tool === 'brush' ? brushId : undefined });
    const ink = inkState();
    ink.size = size; ink.opacity = 1; ink.smoothing = 0.2; ink.color = color;
    await wait(50);
    const fire = (type, x, y, press) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
      clientX: rect.left + fit.x + x * fit.w,
      clientY: rect.top + fit.y + y * fit.h,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pressure: type === 'pointerup' ? 0 : press, tiltX: 0, tiltY: 0, twist: 0,
    }));
    fire('pointerdown', 0.12, y0, 0.4);
    for (let i = 1; i <= steps; i += 1) {
      fire('pointermove', 0.12 + 0.76 * i / steps, y0 + (y1 - y0) * i / steps, 0.5);
      await wait(ms);
    }
    fire('pointerup', 0.88, y1, 0);
    await new Promise(r => requestAnimationFrame(r));
  };
  /* aynı eğriyi N kez, katmanı değiştirerek çizer */
  window.__katmanVurusu = async (katmanId, brushId, size, i) => {
    const ink = inkState();
    ink.activeLayerId = katmanId;
    const { canvas, fit, rect } = window.__geometri();
    inkSetTool(brushId === 'ink-pencil' ? 'pencil' : 'brush', { brushId });
    ink.size = size; ink.opacity = 1; ink.color = '#33374d';
    await wait(40);
    const y0 = 0.15 + (i % 7) * 0.11;
    const fire = (type, x, y, press) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 42, pointerType: 'pen',
      clientX: rect.left + fit.x + x * fit.w,
      clientY: rect.top + fit.y + y * fit.h,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pressure: type === 'pointerup' ? 0 : press, tiltX: 0, tiltY: 0, twist: 0,
    }));
    fire('pointerdown', 0.15, y0, 0.4);
    for (let p = 1; p <= 18; p += 1) {
      fire('pointermove', 0.15 + 0.7 * p / 18, y0, 0.5);
      await wait(4);
    }
    fire('pointerup', 0.85, y0, 0);
    await new Promise(r => requestAnimationFrame(r));
  };
  return 'env-ok';
})()`;

const snapshotAll = ws => evaluate(ws, `JSON.stringify({
  qs: window.__inkPerf.snapshot(),
  heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  rafLen: window.__raf.samples.length,
  prof: { render: window.__PROF.render.length, capBefore: window.__PROF.capBefore.length,
    apply: window.__PROF.apply.length, live: window.__PROF.live.length,
    tileFrame: window.__PROF.tileFrame.length, rebuild: window.__PROF.rebuild.length,
    dirtyFlush: window.__PROF.dirtyFlush.length, commit: window.__PROF.commit.length },
  layers: inkState().layers.length,
  strokes: inkState().layers.reduce((n, l) => n + (l.strokes || []).length, 0),
  tileSay: inkEditorUi.tileView ? inkEditorUi.tileView.tiles.size : 0,
})`);

const profAll = ws => evaluate(ws, `JSON.stringify({
  raf: window.__raf.samples.slicе ? window.__raf.samples : window.__raf.samples,
  prof: window.__PROF })`).then(() => null).catch(() => null);
void profAll;

const wrapStat = arr => {
  if (!arr.length) return '—';
  const s = arr.slice().sort((a, b) => a - b);
  const sum = s.reduce((x, y) => x + y, 0);
  const r = v => Math.round(v * 100) / 100;
  return `n=${s.length} avg=${r(sum / s.length)} p50=${r(s[Math.floor(s.length / 2)])} p95=${r(s[Math.floor(s.length * 0.95)])} max=${r(s[s.length - 1])}`;
};
const rafStat = (samples, all) => {
  const arr = all.slice(Math.max(0, all.length - samples));
  if (!arr.length) return '—';
  const j25 = arr.filter(x => x > 25).length;
  const j40 = arr.filter(x => x > 40).length;
  return wrapStat(arr) + ` · jank25+ ${j25} · jank40+ ${j40}`;
};

const runPhase = async (ws, name, js, phases) => {
  const before = JSON.parse(await snapshotAll(ws));
  const started = Date.now();
  const res = await evaluate(ws, `(async () => { ${js} return JSON.stringify({ sonuc: 'ok' }); })()`);
  const wall = Date.now() - started;
  const end = JSON.parse(await snapshotAll(ws));
  const pAll = JSON.parse(await evaluate(ws, `JSON.stringify(window.__PROF)`));
  const rafAll = JSON.parse(await evaluate(ws, `JSON.stringify({ r: window.__raf.samples })`)).r;
  const phase = { name, wall, before, end,
    rend: pAll.render.slice(before.prof.render),
    capB: pAll.capBefore.slice(before.prof.capBefore),
    appl: pAll.apply.slice(before.prof.apply),
    live: pAll.live.slice(before.prof.live),
    tileF: pAll.tileFrame.slice(before.prof.tileFrame),
    rebuild: pAll.rebuild.slice(before.prof.rebuild),
    dirtyF: pAll.dirtyFlush.slice(before.prof.dirtyFlush),
    commit: pAll.commit.slice(before.prof.commit),
    raf: rafAll.slice(Math.max(0, before.rafLen), Math.min(rafAll.length, before.rafLen + 1500)),
  };
  phases.push(phase);
  /* rapor satırı */
  const c = end.qs;
  const prev = before.qs;
  const dabs = (c.counters.dabs || 0) - (prev.counters.dabs || 0);
  const liveD = (c.counters.liveDabs || 0) - (prev.counters.liveDabs || 0);
  const commits = (c.counters.commitCount || 0) - (prev.counters.commitCount || 0);
  const undoSnapAvg = (c.avg.undoSnapMs || 0);
  console.log(`\n== ${name} ==  duvar ${wall} ms · sonuç ${res}`);
  console.log(`   commitSt : ${wrapStat(phase.commit)} · dabs Δ${dabs} · vuruş Δ${end.strokes} · katman ${end.layers} · heap ${end.heap} MB`);
  console.log(`   undoSnap : Δ${Math.round(((c.counters.undoSnapMs || 0) - (prev.counters.undoSnapMs || 0)) * 100) / 100} ms ×${(c.counters.undoSnapCount || 0) - (prev.counters.undoSnapCount || 0)} · Δ${Math.round(((c.counters.undoSnapBytes || 0) - (prev.counters.undoSnapBytes || 0)) / 1024)} KB`);
  console.log(`   rAF: ${rafStat(phase.raf.length || 1, phase.raf)}`);
  console.log(`   render  : ${wrapStat(phase.rend)}`);
  console.log(`   capBefor: ${wrapStat(phase.capB)}`);
  console.log(`   apply   : ${wrapStat(phase.appl)}`);
  console.log(`   liveSeg : ${wrapStat(phase.live)}`);
  console.log(`   tileFrm : ${wrapStat(phase.tileF)}`);
  console.log(`   rebuild : ${wrapStat(phase.rebuild)}`);
  console.log(`   rsBölge : Δ${((c.counters.rebuildRectMs || 0) - (prev.counters.rebuildRectMs || 0)).toFixed(1)} ms ×${(c.counters.rebuildRectCount || 0) - (prev.counters.rebuildRectCount || 0)} (avg ${((end.qs.counters.rebuildRectCount ? (end.qs.counters.rebuildRectMs || 0) / end.qs.counters.rebuildRectCount : 0) || 0).toFixed(1)} ms)`);
  console.log(`   dirtyFl : ${wrapStat(phase.dirtyF)}`);
  const counters = end.qs.counters;
  const prevCounters = before.qs.counters;
  const spanStat = (base) => {
    const n = ((counters[base + 'Count'] || 0) - (prevCounters[base + 'Count'] || 0));
    if (!n) return '—';
    const tot = (counters[base + 'Ms'] || 0) - (prevCounters[base + 'Ms'] || 0);
    const mx = (counters[base + 'MaxMs'] || 0);
    return `n=${n} tot=${Math.round(tot * 10) / 10} avg=${Math.round(tot / n * 100) / 100} max=${Math.round(mx * 100) / 100}`;
  };
  console.log(`   pyrSync: ${spanStat('pyrSync')} (full ${((counters.pyrFull || 0) - (prevCounters.pyrFull || 0))} / patch ${((counters.pyrPatch || 0) - (prevCounters.pyrPatch || 0))})`);
  console.log(`   scaledB: ${spanStat('scaledBuild')}`);
  void undoSnapAvg;
  return phase;
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-perf-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  const phases = [];
  try {
    const page = await waitForTarget();
    const ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await send(ws, 'Page.enable');

    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    // tuvalyi playing alanı: karşılama kapat + editör aç
    await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (w && !w.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
      }
      return 'welcome';
    })()`);

    const canvasAc = (qW, qH, ad) => evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      if (inkEditorIsOpen()) { inkEditorClose(); await wait(400); }
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = String(${qW});
      document.getElementById('newCanvasH').value = String(${qH});
      document.getElementById('newCanvasName').value = ${JSON.stringify(ad)};
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 150 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(600);
      return JSON.stringify({ open: inkEditorIsOpen(), katmanlar: inkState().layers.length });
    })()`);

    // ============ S1: 1600×1200 · 5 fırça ============
    let opened = JSON.parse(await canvasAc(1600, 1200, 'Perf S1'));
    console.log('TEST: S1 editör ' + JSON.stringify(opened));
    const envRes = await evaluate(ws, ENV_JS).catch(e => { throw new Error('ENV kurulum: ' + e.message); });
    if (envRes !== 'env-ok') throw new Error('ENV kurulum döndü: ' + envRes);

    await runPhase(ws, 'S1·ink-hard 24px · 6 uzun vuruş', `
      for (let i = 0; i < 6; i += 1) {
        await window.__ciz('ink-hard', 24, '#22243a', 0.12 + i * 0.12, 0.16 + i * 0.12, 40, 5);
        await window.__sleep(140);
      }
      await window.__sleep(250);
    `, phases);
    await runPhase(ws, 'S1·ink-soft 40px · 6 uzun vuruş', `
      for (let i = 0; i < 6; i += 1) {
        await window.__ciz('ink-soft', 40, '#2f5fd0', 0.14 + i * 0.11, 0.18 + i * 0.11, 40, 5);
        await window.__sleep(140);
      }
      await window.__sleep(250);
    `, phases);
    await runPhase(ws, 'S1·ink-marker 34px · 6 uzun vuruş', `
      for (let i = 0; i < 6; i += 1) {
        await window.__ciz('ink-marker', 34, '#3a6d3a', 0.13 + i * 0.115, 0.2 + i * 0.115, 40, 5);
        await window.__sleep(140);
      }
      await window.__sleep(250);
    `, phases);
    await runPhase(ws, 'S1·ink-air 60px · 3 uzun vuruş', `
      for (let i = 0; i < 3; i += 1) {
        await window.__ciz('ink-air', 60, '#7a1414', 0.2 + i * 0.16, 0.26 + i * 0.16, 40, 5);
        await window.__sleep(200);
      }
      await window.__sleep(300);
    `, phases);
    await runPhase(ws, 'S1·ink-pencil 9px · 8 kısa vuruş', `
      for (let i = 0; i < 8; i += 1) {
        await window.__ciz('ink-pencil', 9, '#111', 0.1 + (i % 4) * 0.22, 0.3 + (i % 4) * 0.22, 14, 4);
        await window.__sleep(110);
      }
      await window.__sleep(250);
    `, phases);

    await runPhase(ws, 'S1·undo ×8 + redo ×2', `
      for (let i = 0; i < 8 && undoStack.length; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown',
          { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await window.__sleep(110);
      }
      await window.__sleep(150);
      window.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
      await window.__sleep(180);
      window.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
      await window.__sleep(250);
    `, phases);

    await runPhase(ws, 'S1·pan/zoom tekerlek ×20', `
      const { canvas } = window.__geometri();
      for (let i = 0; i < 10; i += 1) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: 100, clientY: 100, deltaY: 120 }));
        await window.__sleep(55);
      }
      for (let i = 0; i < 10; i += 1) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: 100, clientY: 100, deltaY: -120 }));
        await window.__sleep(55);
      }
      await window.__sleep(250);
    `, phases);

    // ============ L: çok katman ============
    await runPhase(ws, 'L1·+12 katman ekleme', `
      for (let i = 0; i < 12; i += 1) { inkAddLayer({ name: 'P' + i }); await window.__sleep(60); }
      await window.__sleep(250);
    `, phases);
    await runPhase(ws, 'L2·13 katmana 1er vuruş (hard 30)', `
      const ids = inkState().layers.slice(0, 13).map(l => l.id);
      for (let i = 0; i < ids.length; i += 1) {
        await window.__katmanVurusu(ids[i], 'ink-hard', 30, i);
        await window.__sleep(130);
      }
      await window.__sleep(300);
    `, phases);
    await runPhase(ws, 'L3·13 katman görünürken pan/zoom ×20', `
      const { canvas } = window.__geometri();
      for (let i = 0; i < 10; i += 1) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: 100, clientY: 100, deltaY: 120 }));
        await window.__sleep(55);
      }
      for (let i = 0; i < 10; i += 1) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: 100, clientY: 100, deltaY: -120 }));
        await window.__sleep(55);
      }
      await window.__sleep(250);
    `, phases);

    // ============ A: katman ayarları + maskeler + efekt yolları ============
    await runPhase(ws, 'A1·opacity 0.6 + blend multiply/screen + vuruş', `
      const L0 = inkState().layers[0];
      L0.opacity = 0.6; L0.blend = 'multiply';
      if (typeof inkEditorRender === 'function') inkEditorRender();
      await window.__sleep(150);
      for (let i = 0; i < 2; i += 1) {
        await window.__ciz('ink-hard', 30, '#cc8800', 0.4 + i * 0.1, 0.45 + i * 0.1, 26, 5);
        await window.__sleep(140);
      }
      L0.blend = 'screen';
      await window.__ciz('ink-hard', 30, '#0066cc', 0.55, 0.6, 26, 5);
      await window.__sleep(180);
      L0.opacity = 1; L0.blend = 'normal';
      await window.__sleep(200);
    `, phases);
    await runPhase(ws, 'A2·clipping mask (clip katman + 4 vuruş)', `
      const ln = inkAddLayer({ name: 'CLIP1' });
      ln.clip = true;
      if (typeof inkEditorRender === 'function') inkEditorRender();
      await window.__sleep(150);
      for (let i = 0; i < 4; i += 1) {
        await window.__katmanVurusu(ln.id, 'ink-hard', 26, i + 1);
        await window.__sleep(140);
      }
      await window.__sleep(250);
    `, phases);
    await runPhase(ws, 'A2b·maskeli katmana 3 vuruş (bölgesel commit)', `
      const LM = inkState().layers.find(l => l.kind === 'attached' && !l.mask && l.clip)
        || inkState().layers.find(l => l.kind === 'attached' && !l.mask)
        || inkState().layers[0];
      inkDocAddMask(LM.id, 'reveal');
      if (inkState().maskEditId === LM.id) inkDocToggleMaskEdit(LM.id);
      await window.__sleep(160);
      for (let i = 0; i < 3; i += 1) {
        await window.__ciz('ink-hard', 30, '#c1a900', 0.2 + i * 0.12, 0.24 + i * 0.12, 24, 5);
        await window.__sleep(150);
      }
      await window.__sleep(250);
    `, phases);
    await runPhase(ws, 'A3·maske ekle + maske düzenleme 3 vuruş', `
      const L0 = inkState().layers[0];
      inkDocAddMask(L0.id, 'reveal');
      inkDocToggleMaskEdit(L0.id);
      await window.__sleep(180);
      for (let i = 0; i < 3; i += 1) {
        await window.__ciz('ink-hard', 26, '#ffffff', 0.3 + i * 0.12, 0.34 + i * 0.12, 20, 5);
        await window.__sleep(150);
      }
      inkDocToggleMaskEdit(L0.id);
      inkDocRemoveMask(L0.id);
      await window.__sleep(250);
    `, phases);
    await runPhase(ws, 'A4·simetri mirrorX ×4 + radial8 ×1', `
      inkState().symMode = 'mirrorX';
      for (let i = 0; i < 4; i += 1) {
        await window.__ciz('ink-hard', 24, '#444', 0.35 + i * 0.07, 0.4 + i * 0.07, 24, 5);
        await window.__sleep(140);
      }
      inkState().symMode = 'radial8';
      await window.__ciz('ink-hard', 24, '#444', 0.5, 0.56, 24, 5);
      inkState().symMode = 'off';
      await window.__sleep(300);
    `, phases);
    await runPhase(ws, 'A5·smudge ×3 uzun', `
      for (let i = 0; i < 3; i += 1) {
        await window.__ciz('smudge', 40, '#000000', 0.62 + i * 0.05, 0.66 + i * 0.05, 26, 6);
        await window.__sleep(170);
      }
      await window.__sleep(250);
    `, phases);
    await runPhase(ws, 'A6·alfa kilidi ×3', `
      const L0 = inkState().layers[0];
      L0.alphaLock = true;
      await window.__sleep(120);
      for (let i = 0; i < 3; i += 1) {
        await window.__ciz('ink-hard', 30, '#ff8800', 0.5 + i * 0.05, 0.55 + i * 0.05, 22, 5);
        await window.__sleep(140);
      }
      L0.alphaLock = false;
      await window.__sleep(200);
    `, phases);
    await runPhase(ws, 'AU·undo ×6 (kırptan sonra redo ×1)', `
      for (let i = 0; i < 6 && undoStack.length; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown',
          { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await window.__sleep(110);
      }
      await window.__sleep(150);
      window.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
      await window.__sleep(250);
    `, phases);

    // ============ S2: büyük tuval ============
    opened = JSON.parse(await canvasAc(3840, 2160, 'Perf S2'));
    console.log('TEST: S2 editör ' + JSON.stringify(opened));
    const envRes2 = await evaluate(ws, ENV_JS).catch(e => { throw new Error('ENV kurulum 2: ' + e.message); });
    if (envRes2 !== 'env-ok') throw new Error('ENV kurulum 2 döndü: ' + envRes2);
    await runPhase(ws, 'S2·3840×2160 · ink-hard 60 · 4 uzun vuruş', `
      for (let i = 0; i < 4; i += 1) {
        await window.__ciz('ink-hard', 60, '#202', 0.15 + i * 0.18, 0.2 + i * 0.18, 30, 6);
        await window.__sleep(160);
      }
      await window.__sleep(300);
    `, phases);
    await runPhase(ws, 'S2·ink-air 110 · 2 uzun vuruş', `
      for (let i = 0; i < 2; i += 1) {
        await window.__ciz('ink-air', 110, '#0a4', 0.5 + i * 0.1, 0.55 + i * 0.1, 28, 7);
        await window.__sleep(220);
      }
      await window.__sleep(300);
    `, phases);
    await runPhase(ws, 'S2·undo ×6 + pan/zoom ×10', `
      for (let i = 0; i < 6 && undoStack.length; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown',
          { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await window.__sleep(110);
      }
      await window.__sleep(150);
      const { canvas } = window.__geometri();
      for (let i = 0; i < 5; i += 1) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: 300, clientY: 200, deltaY: 120 }));
        await window.__sleep(60);
      }
      await window.__sleep(250);
    `, phases);

    const finalSnap = JSON.parse(await evaluate(ws, `JSON.stringify({
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null })`));
    console.log('\n== SON ==  heap ' + finalSnap.heap + ' MB');
    console.log('SÖZDE-SÜRET UYARISI: sentetik kalem (pointerType=pen) — gerçek tablet/document'
      + ' hızı benzerimde; bazı yollar (kalem sono, WIN ink) ölçeğimde küçük farkla koşabilir.');
    try { app.kill(); } catch { /* */ }
    process.exit(0);
  } catch (e) {
    console.error('PROFİL HATASI: ' + (e && e.stack ? e.stack : String(e)));
    try { app.kill(); } catch { /* */ }
    process.exit(3);
  }
})();
