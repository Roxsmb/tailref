'use strict';
/* pe-debug.js — kalem arkası silgi: ink.tool'ın kim geri koyduğunu bulur */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const PORT = 9364, APP_PORT = 5234;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const electronPath = () => path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (m.error) return reject(new Error(JSON.stringify(m.error)));
    if (m.result.exceptionDetails) return reject(new Error(m.result.exceptionDetails.exception?.description || 'eval'));
    const v = m.result.result.value;
    resolve(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});
async function waitForTarget(d = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < d) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { }
    await sleep(400);
  }
  throw new Error('port acilmadi');
}
function connect(page) {
  return new Promise((res, rej) => {
    const s = new WebSocket(page.webSocketDebuggerUrl);
    s.onopen = () => res(s); s.onerror = rej;
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

const TEST = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ink = inkState();
  document.getElementById('modeDrawBtn').click();
  await wait(300);
  inkSetTool('brush');
  await wait(100);
  document.getElementById('newCanvasW').value = '1200';
  document.getElementById('newCanvasH').value = '800';
  document.getElementById('newCanvasName').value = 'PE-DBG';
  document.getElementById('newCanvasForm').requestSubmit();
  for (let i = 0; i < 200 && !inkEditorIsOpen(); i += 1) await wait(100);
  await wait(300);
  const iz = [];
  const ST = inkSetTool;
  inkSetTool = (tool, opts) => { iz.push({ tool, stack: (new Error().stack || '').split('\\n').slice(2, 6).join(' | ') }); return ST(tool, opts); };

  const cv = document.getElementById('inkEditorCanvas');
  const rc = cv.getBoundingClientRect();
  const cx = Math.round(rc.left + rc.width / 2), cy = Math.round(rc.top + rc.height / 2);
  const adim = {};
  /* Not: inkState() canlı döner ama inkEnsureState state.ink'i DEĞİŞTİREBİLİR;
     bu yüzden her adımda taze referans oku. */
  const taze = () => inkState();
  taze().tool = 'brush';
  inkRuntime.penEraserRestore = { tool: 'brush', brushId: taze().brushId };
  inkSwapToolSettings(taze(), 'eraser');
  taze().tool = 'eraser';
  adim.s0_atama = taze().tool;
  if (typeof inkUpdateGizmo === 'function') inkUpdateGizmo();
  adim.s1_gizmo = taze().tool;
  if (typeof inkApplyToolCursor === 'function') inkApplyToolCursor();
  adim.s2_cursor = taze().tool;
  if (typeof inkEditorCursorInvalidate === 'function') inkEditorCursorInvalidate();
  adim.s3_eci = taze().tool;
  if (typeof inkSyncUI === 'function') inkSyncUI();
  adim.s4_syncUI = taze().tool;
  inkPenEraserRestore();
  adim.s5_restore = taze().tool;
  return { adim, iz };
})()`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-ped-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);
    console.log('DBG: ' + await evaluate(ws, TEST, 60000));
  } catch (e) {
    console.error('PED HATASI: ' + (e && e.message ? e.message.slice(0, 500) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { }
    await sleep(300);
  }
})();
