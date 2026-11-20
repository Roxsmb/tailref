'use strict';

/* Geçici QA koşum çatısı: gerçek Electron + CDP, taze profil, gerçek DOM
   olayları. Av dosyaları bunu kullanır; iş sonunda silinir. */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PRELUDE = `
  window.__qa = {
    reset() {
      state.items = []; state.links = []; state.trash = [];
      state.groupParents = {}; state.groupTitles = {}; state.groupImportant = {};
      selection = new Set(); selectionOrder = [];
      undoStack.length = 0; redoStack.length = 0;
      editingId = null;
      state.view = { x: 0, y: 0, scale: 1 };
      applyView(); syncAll();
      return true;
    },
    text(text, x, y) {
      addText(screenToWorld({ x, y }));
      const it = state.items[state.items.length - 1];
      const t = elMap.get(it.id).querySelector('.text');
      t.textContent = text;
      t.dispatchEvent(new Event('input', { bubbles: true }));
      commitEdit();
      return it.id;
    },
    async image(color, x, y) {
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color || '#3a7'; ctx.fillRect(0, 0, 240, 160);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const file = new File([blob], 'qa-audit.png', { type: 'image/png' });
      await addFiles([file], screenToWorld({ x, y }));
      return state.items[state.items.length - 1].id;
    },
    select(ids) { selection = new Set(ids); selectionOrder = ids.slice(); syncSelection(); },
    fire(target, type, x, y, pointerId) {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        pointerId: pointerId || 3, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      }));
      return true;
    },
    dragHandle(handle, dx, dy) {
      const r = handle.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      this.fire(handle, 'pointerdown', x, y, 4);
      this.fire(window, 'pointermove', x + dx, y + dy, 4);
      this.fire(window, 'pointerup', x + dx, y + dy, 4);
      return true;
    },
    dragItem(id, dx, dy) {
      const el = elMap.get(id);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      this.fire(el, 'pointerdown', x, y, 5);
      this.fire(window, 'pointermove', x + dx, y + dy, 5);
      this.fire(window, 'pointerup', x + dx, y + dy, 5);
      return true;
    },
    key(target, key, extra) {
      target.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, extra || {})));
      return true;
    },
    typed(el, text) {
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    notices: [],
  };
  window.__qaErrs = [];
  window.addEventListener('error', e => window.__qaErrs.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', e => window.__qaErrs.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
  if (typeof showProjectNotice === 'function') {
    const origNotice = showProjectNotice;
    window.showProjectNotice = (m, t) => { window.__qa.notices.push(String(m)); return origNotice(m, t); };
  }
  true;
`;

async function start(opts = {}) {
  const PORT = opts.port || 9481;
  const APP_PORT = opts.appPort || 5343;
  const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  const userDataDir = opts.userDataDir ||
    fs.mkdtempSync(path.join(os.tmpdir(), opts.prefix || 'tailref-audit-'));
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let appLog = '';
  app.stdout.on('data', d => { appLog += d.toString(); });
  app.stderr.on('data', d => { appLog += d.toString(); });

  let ws = null;
  const state = { pass: 0, fail: 0, fails: [] };

  const evaluate = expression => new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6);
    const timer = setTimeout(() => reject(new Error('eval zaman aşımı')), 60000);
    const onMsg = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      clearTimeout(timer);
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

  const check = (name, ok, detail) => {
    console.log(`${ok ? '✓' : '✗'} ${name}${detail == null ? '' : '  · ' + String(detail).slice(0, 600)}`);
    if (ok) state.pass++; else { state.fail++; state.fails.push(name); }
  };

  /* Hata yakalayıp denetimi sürdüren senaryo sarmalı. */
  const scenario = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(`${name} · ÇALIŞTIRILAMADI`, false, e.message.split('\n')[0]);
    }
  };

  const json = async expr => JSON.parse(await evaluate(expr));

  try {
    let page = null;
    for (let i = 0; i < 100 && !page; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      } catch { /* bekle */ }
      if (!page) await sleep(400);
    }
    if (!page) throw new Error('hata ayıklama portu açılmadı\n' + appLog.slice(0, 1500));
    ws = await new Promise((resolve, reject) => {
      const s = new WebSocket(page.webSocketDebuggerUrl);
      s.onopen = () => resolve(s);
      s.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

    const deadline = Date.now() + 40000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = await evaluate("typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth");
        if (ready) break;
      } catch { /* bekle */ }
      await sleep(400);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    for (let i = 0; i < 40; i++) {
      const done = await evaluate(`(() => {
        const w = document.getElementById('persistenceWelcome');
        if (!w || w.hidden) return true;
        if (!document.querySelector('.pwOption.is-selected')) document.querySelector('.pwOption[data-mode="auto"]')?.click();
        const b = document.getElementById('pwContinue');
        if (b && !b.disabled) b.click();
        return !!w.hidden;
      })()`);
      if (done) break;
      await sleep(300);
    }
    await sleep(700);
    await evaluate(PRELUDE);
  } catch (e) {
    try { app.kill(); } catch { /* sessiz */ }
    throw e;
  }

  return {
    ws, evaluate, json, check, scenario, state, userDataDir,
    async reload() {
      await evaluate('location.reload(); true');
      await sleep(2500);
      for (let i = 0; i < 60; i++) {
        try {
          if (await evaluate("typeof state !== 'undefined' && !!stage && !!stage.clientWidth")) break;
        } catch { /* bekle */ }
        await sleep(400);
      }
      await sleep(800);
      await evaluate(PRELUDE);
    },
    async shot(file) {
      const id = Math.floor(Math.random() * 1e6);
      const res = await new Promise((resolve, reject) => {
        const onMsg = ev => {
          const msg = JSON.parse(ev.data);
          if (msg.id !== id) return;
          ws.removeEventListener('message', onMsg);
          if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
          resolve(msg.result);
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }));
      });
      fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    },
    async stop() {
      try { ws && ws.close(); } catch { /* sessiz */ }
      try { app.kill(); } catch { /* sessiz */ }
      await sleep(1200);
    },
    async finish() {
      await this.stop();
      if (!opts.keepData) {
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* sessiz */ }
      }
      console.log(state.fail === 0
        ? `\nTÜM TESTLER GEÇTİ (${state.pass}/${state.pass})`
        : `\n${state.fail} TEST BAŞARISIZ (${state.pass}/${state.pass + state.fail})\n  ${state.fails.join('\n  ')}`);
      process.exit(state.fail === 0 ? 0 : 1);
    },
  };
}

module.exports = { start, sleep, ROOT };
