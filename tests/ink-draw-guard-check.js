'use strict';

/* Çizim koruma regresyonları — gerçek Electron + CDP.

   Kapsam (canlı kullanıcı akışları, sentetik kalem olayları):
   1) Canlı vuruşta Escape vuruşu iptal eder; adım/piksel bırakmaz.
   2) Canlı vuruşta araç kısayolu aracı değiştirmez, vuruşu bozmaz.
   3) Kilitli katman çizim almaz (başka katmana sızmaz, undo açmaz).
   4) Gizli katman çizim almaz (aynı).
   5) Canlı vuruşta Ctrl+J katman çoğaltmaz.
   6) Damlalık karo (tile) görünümünde görünür karoyu okur.
   7) Sayfada hata yok.

   Uygulamayı kendisi başlatır ve kapatır. Kullanım:
     node tests/ink-draw-guard-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9342;
const APP_PORT = 5215;
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

async function waitForTarget(deadlineMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* daha hazır değil */ }
    await sleep(400);
  }
  throw new Error('hata ayıklama portu açılmadı');
}

const opens = async (ws) => {
  await evaluate(ws, `
    const modal = document.getElementById('newCanvasModal');
    if (typeof inkCloseTransientUi === 'function') inkCloseTransientUi();
    modal.hidden = true;
    document.getElementById('modeDrawBtn').click();
    setTimeout(() => {
      document.getElementById('newCanvasW').value = '400';
      document.getElementById('newCanvasH').value = '300';
      document.getElementById('newCanvasName').value = 'CizimKorumaTesti';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
    }, 280);
    true;
  `);
  for (let i = 0; i < 100; i++) {
    if (await evaluate(ws, 'typeof inkEditorIsOpen === "function" && inkEditorIsOpen()')) return true;
    await sleep(120);
  }
  return false;
};

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}  ${detail == null ? '' : '→ ' + detail}`);
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-drawguard-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  let ws = null;
  try {
    const page = await waitForTarget();
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
        if (ready) break;
      } catch { /* bekle */ }
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    await evaluate(ws, `
      window.__guardErrs = [];
      window.addEventListener('error', e => window.__guardErrs.push(String(e.message || e)));
      window.__guardNotices = [];
      window.showProjectNotice = m => window.__guardNotices.push(String(m));
      true;
    `);
    const editorOpen = await opens(ws);
    ok('çizim editörü açıldı', editorOpen === true, String(editorOpen));
    if (!editorOpen) throw new Error('editör açılamadı');

    /* Aktif, görünür, kilitli olmayan katmanı hazırla. */
    const prep = await evaluate(ws, `(() => {
      const docId = inkDocOwnerId();
      inkDocEnsure(docId);
      const layers = inkDocLayers(docId);
      const l = layers.filter(x => x.kind === 'attached').pop();
      if (!l) return JSON.stringify({ ok: false });
      l.locked = false;
      l.visible = true;
      inkSetActiveLayer(l.id);
      inkSetTool('brush');
      const ink = inkState(); ink.color = '#e05a3a'; ink.size = 30; ink.opacity = 1;
      if (typeof inkSyncUI === 'function') inkSyncUI();
      return JSON.stringify({ ok: true, id: l.id, strokes: (l.strokes || []).length, undo: undoStack.length });
    })()`);
    const base = JSON.parse(prep);
    ok('çizim editörü ve katman hazır', base.ok === true, prep);
    if (!base.ok) throw new Error('katman hazırlanamadı');

    /* --- 1 · canlı vuruşta Escape --- */
    const esc = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const l = inkLayerById(${JSON.stringify(base.id)});
      inkSetTool('brush');
      const ink = inkState(); ink.color = '#e05a3a'; ink.size = 30; ink.opacity = 1;
      if (typeof inkSyncUI === 'function') inkSyncUI();
      const before = (l.strokes || []).length;
      const u0 = undoStack.length;
      const s = document.getElementById('inkEditorCanvas');
      const f = inkEditorUi.fit;
      const a = { x: f.x + f.w * 0.25, y: f.y + f.h * 0.25 };
      const b = { x: f.x + f.w * 0.45, y: f.y + f.h * 0.25 };
      const mk = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 7001,
        pointerType: 'pen', isPrimary: true, pressure: 0.9,
        clientX: x, clientY: y, button: 0, buttons,
      });
      s.dispatchEvent(mk('pointerdown', a.x, a.y, 1));
      s.dispatchEvent(mk('pointermove', b.x, b.y, 1));
      const mid = inkStrokeActive();
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }));
      await wait(120);
      s.dispatchEvent(mk('pointermove', b.x + 24, b.y, 1));
      s.dispatchEvent(mk('pointerup', b.x + 24, b.y, 0));
      await wait(600);
      const cv = inkEnsureItemCanvas(l);
      const px = Array.from(cv.getContext('2d').getImageData(
        Math.round(0.35 * cv.width), Math.round(0.25 * cv.height), 1, 1).data);
      return JSON.stringify({ mid, before, after: (l.strokes || []).length,
        u0, u1: undoStack.length, px, open: inkEditorIsOpen() });
    })()`);
    const ec = JSON.parse(esc);
    ok('canlı vuruşta Escape vuruşu iptal ediyor (adım/piksel yok)',
      ec.mid === true && ec.after === ec.before && ec.u1 === ec.u0 && ec.px[3] < 20 && ec.open === true,
      esc);

    /* --- 2 · canlı vuruşta araç kısayolu --- */
    const toolKey = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const l = inkLayerById(${JSON.stringify(base.id)});
      inkSetTool('brush');
      const ink = inkState(); ink.color = '#e05a3a'; ink.size = 30; ink.opacity = 1;
      if (typeof inkSyncUI === 'function') inkSyncUI();
      const before = (l.strokes || []).length;
      const s = document.getElementById('inkEditorCanvas');
      const f = inkEditorUi.fit;
      const a = { x: f.x + f.w * 0.25, y: f.y + f.h * 0.4 };
      const mk = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 7002,
        pointerType: 'pen', isPrimary: true, pressure: 0.9,
        clientX: x, clientY: y, button: 0, buttons,
      });
      s.dispatchEvent(mk('pointerdown', a.x, a.y, 1));
      s.dispatchEvent(mk('pointermove', a.x + 20, a.y, 1));
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'e', code: 'KeyE', bubbles: true, cancelable: true,
      }));
      const toolDuring = inkState().tool;
      s.dispatchEvent(mk('pointermove', a.x + 50, a.y, 1));
      s.dispatchEvent(mk('pointerup', a.x + 50, a.y, 0));
      await wait(600);
      const cv = inkEnsureItemCanvas(l);
      const px = Array.from(cv.getContext('2d').getImageData(
        Math.round(0.35 * cv.width), Math.round(0.4 * cv.height), 1, 1).data);
      return JSON.stringify({ toolDuring, toolAfter: inkState().tool,
        before, after: (l.strokes || []).length, px });
    })()`);
    const tk = JSON.parse(toolKey);
    ok('canlı vuruşta araç kısayolu aracı değiştirmiyor, vuruş tamamlanıyor',
      tk.toolDuring === 'brush' && tk.toolAfter === 'brush' &&
      tk.after === tk.before + 1 && tk.px[3] > 40,
      toolKey);

    /* --- 3 · kilitli katman --- */
    const locked = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const l = inkLayerById(${JSON.stringify(base.id)});
      l.locked = true;
      await wait(150);
      const others = inkDocLayers(inkDocOwnerId()).filter(x => x.id !== l.id && x.kind === 'attached');
      const before = (l.strokes || []).length;
      const otherBefore = others.reduce((s, x) => s + (x.strokes || []).length, 0);
      const u0 = undoStack.length;
      window.__guardNotices.length = 0;
      const s = document.getElementById('inkEditorCanvas');
      const f = inkEditorUi.fit;
      const p = { x: f.x + f.w * 0.6, y: f.y + f.h * 0.55 };
      const mk = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 7003,
        pointerType: 'pen', isPrimary: true, pressure: 0.9,
        clientX: x, clientY: y, button: 0, buttons,
      });
      s.dispatchEvent(mk('pointerdown', p.x, p.y, 1));
      s.dispatchEvent(mk('pointermove', p.x + 30, p.y, 1));
      s.dispatchEvent(mk('pointerup', p.x + 30, p.y, 0));
      await wait(500);
      const after = (l.strokes || []).length;
      const otherAfter = others.reduce((s, x) => s + (x.strokes || []).length, 0);
      const notices = JSON.stringify(window.__guardNotices);
      l.locked = false;
      return JSON.stringify({ before, after, otherBefore, otherAfter,
        u0, u1: undoStack.length, notices });
    })()`);
    const lk = JSON.parse(locked);
    ok('kilitli katman çizim almıyor (başka katmana sızmıyor, uyarı veriyor)',
      lk.after === lk.before && lk.otherAfter === lk.otherBefore &&
      lk.u1 === lk.u0 && /locked/i.test(lk.notices),
      locked);

    /* --- 4 · gizli katman --- */
    const hidden = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const l = inkLayerById(${JSON.stringify(base.id)});
      inkDocSetVisible(l.id, false);
      await wait(200);
      const others = inkDocLayers(inkDocOwnerId()).filter(x => x.id !== l.id && x.kind === 'attached');
      const before = (l.strokes || []).length;
      const otherBefore = others.reduce((s, x) => s + (x.strokes || []).length, 0);
      const u0 = undoStack.length;
      window.__guardNotices.length = 0;
      const s = document.getElementById('inkEditorCanvas');
      const f = inkEditorUi.fit;
      const p = { x: f.x + f.w * 0.6, y: f.y + f.h * 0.7 };
      const mk = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 7004,
        pointerType: 'pen', isPrimary: true, pressure: 0.9,
        clientX: x, clientY: y, button: 0, buttons,
      });
      s.dispatchEvent(mk('pointerdown', p.x, p.y, 1));
      s.dispatchEvent(mk('pointermove', p.x + 30, p.y, 1));
      s.dispatchEvent(mk('pointerup', p.x + 30, p.y, 0));
      await wait(500);
      const after = (l.strokes || []).length;
      const otherAfter = others.reduce((s, x) => s + (x.strokes || []).length, 0);
      const undoDelta = undoStack.length - u0;
      const notices = JSON.stringify(window.__guardNotices);
      inkDocSetVisible(l.id, true);
      return JSON.stringify({ before, after, otherBefore, otherAfter,
        undoDelta, notices });
    })()`);
    const hd = JSON.parse(hidden);
    ok('gizli katman çizim almıyor (başka katmana sızmıyor, uyarı veriyor)',
      hd.after === hd.before && hd.otherAfter === hd.otherBefore &&
      hd.undoDelta === 0 && /hidden/i.test(hd.notices),
      hidden);

    /* --- 5 · canlı vuruşta Ctrl+J --- */
    const dup = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const l = inkLayerById(${JSON.stringify(base.id)});
      inkSetTool('brush');
      const ink = inkState(); ink.color = '#884400'; ink.size = 26; ink.opacity = 1;
      if (typeof inkSyncUI === 'function') inkSyncUI();
      const docId = inkDocOwnerId();
      const count0 = inkDocLayers(docId).length;
      const strokes0 = (l.strokes || []).length;
      const s = document.getElementById('inkEditorCanvas');
      const f = inkEditorUi.fit;
      const p = { x: f.x + f.w * 0.65, y: f.y + f.h * 0.82 };
      const mk = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 7005,
        pointerType: 'pen', isPrimary: true, pressure: 0.9,
        clientX: x, clientY: y, button: 0, buttons,
      });
      s.dispatchEvent(mk('pointerdown', p.x, p.y, 1));
      s.dispatchEvent(mk('pointermove', p.x + 20, p.y, 1));
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'j', code: 'KeyJ', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      await wait(150);
      const countMid = inkDocLayers(docId).length;
      s.dispatchEvent(mk('pointermove', p.x + 50, p.y, 1));
      s.dispatchEvent(mk('pointerup', p.x + 50, p.y, 0));
      await wait(600);
      const cv = inkEnsureItemCanvas(l);
      const px = Array.from(cv.getContext('2d').getImageData(
        Math.round(0.68 * cv.width), Math.round(0.82 * cv.height), 1, 1).data);
      return JSON.stringify({ count0, countMid, count1: inkDocLayers(docId).length,
        strokes0, strokes1: (l.strokes || []).length, px });
    })()`);
    const dd = JSON.parse(dup);
    ok('canlı vuruşta Ctrl+J katman çoğaltmıyor, vuruş tamamlanıyor',
      dd.countMid === dd.count0 && dd.count1 === dd.count0 &&
      dd.strokes1 === dd.strokes0 + 1 && dd.px[3] > 40,
      dup);

    /* --- 6 · damlalık karo görünümü --- */
    const eye = await evaluate(ws, `(() => {
      const tv = inkEditorUi.tileView;
      if (!tv) return JSON.stringify({ noTiles: true });
      const f = inkEditorUi.fit;
      const cx = f.x + f.w * 0.5;
      const cy = f.y + f.h * 0.5;
      const was = !!inkEditorUi.tileViewOn;
      inkEditorUi.tileViewOn = true;
      if (tv.container) tv.container.style.visibility = '';
      const gg = inkEditorGatePoint(cx, cy);
      const ts = tv.tileSize;
      const tx = Math.floor(gg.x / ts), ty = Math.floor(gg.y / ts);
      const t = tv.ensure(tx, ty);
      t.ctx.fillStyle = '#123456';
      t.ctx.fillRect(0, 0, t.canvas.width, t.canvas.height);
      tv.dirty.delete(inkTileViewKey(tx, ty));
      const peek = inkEditorEyePeek(cx, cy);
      inkEditorUi.tileViewOn = was;
      if (typeof inkEditorTileReset === 'function') inkEditorTileReset();
      return JSON.stringify({ noTiles: false, peek });
    })()`);
    const ey = JSON.parse(eye);
    ok('damlalık karo görünümünde görünür karoyu okuyor',
      ey.noTiles === true || /^#123456$/i.test(ey.peek || ''), eye);

    /* --- 7 · sayfa hataları --- */
    const errs = await evaluate(ws, 'JSON.stringify(window.__guardErrs || [])');
    ok('sayfada hata yok', errs === '[]', errs);
  } catch (e) {
    fail++;
    console.log('HATA: ' + e.message);
  } finally {
    try { ws && ws.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* sessiz */ }
  }

  console.log(fail === 0
    ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
    : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
