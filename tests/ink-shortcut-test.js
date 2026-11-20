'use strict';
/* FAZ 6 A3 probe — v5 kısayol kapısı: çizim modunda B/P/E/I/L/M/U/V/T
   araç kısayolları, [ ] boyut adımı ve U şekil döngüsü gerçek Electron
   penceresinde doğrulanır. Referans modda aynı tuşlar tahtaya kalır
   (iki-program kuralı, 39-mode.js).
   node scripts/ink-shortcut-probe.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9372;
const APP_PORT = 5232;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

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
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    const desc = d.exception && d.exception.description || d.text || 'eval';
    throw new Error(desc + '  [@script ' + (d.scriptId || '?') +
      ' satır ' + d.lineNumber + ':' + d.columnNumber + ']');
  }
  return r.result.value;
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
};
const failNoExit = () => { results.failcnt = (results.failcnt || 0) + 1; };

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-keyprobe-'));
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

  /* --- giriş: welcome kapat → çizim moduna geç (modal varsa tuval kur).
     Welcome diyaloğu init() sonrası asenkron açılır; yavaş yüklemde
     4 sn'de henüz görünür olmayabilir — görünürlük için bekle. */
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
  })()`);
  await sleep(900);
  await evaluate(ws, `document.getElementById('modeDrawBtn')?.click()`);
  await sleep(900);
  let boot = await evaluate(ws, `(() => {
    if (document.body.classList.contains('mode-draw')) return 'draw';
    const modal = document.getElementById('newCanvasModal');
    if (modal && !modal.hidden) {
      const wEl = document.getElementById('newCanvasW');
      const hEl = document.getElementById('newCanvasH');
      const nameEl = document.getElementById('newCanvasName');
      if (wEl && !wEl.value) wEl.value = '800';
      if (hEl && !hEl.value) hEl.value = '600';
      if (nameEl && !nameEl.value) nameEl.value = 'Kısayol Tuvali';
      const form = document.getElementById('newCanvasForm');
      const submit = form?.querySelector('button[type="submit"], .pwPrimary, button:not([type="button"])')
        || document.getElementById('newCanvasCreate');
      if (submit) submit.click(); else if (form) form.requestSubmit();
      return 'submitted';
    }
    return 'unknown';
  })()`);
  /* Unknown ise bir kez daha dene: modeDrawBtn click diyalog yarışına
     denk gelebilir; welcome kapalıyken tekrar güvenli. */
  for (let i = 0; i < 3 && boot === 'unknown'; i++) {
    await sleep(700);
    await evaluate(ws, `document.getElementById('modeDrawBtn')?.click()`);
    await sleep(900);
    boot = await evaluate(ws, `(() => {
      if (document.body.classList.contains('mode-draw')) return 'draw';
      const modal = document.getElementById('newCanvasModal');
      if (modal && !modal.hidden) {
        const wEl = document.getElementById('newCanvasW');
        const hEl = document.getElementById('newCanvasH');
        const nameEl = document.getElementById('newCanvasName');
        if (wEl && !wEl.value) wEl.value = '800';
        if (hEl && !hEl.value) hEl.value = '600';
        if (nameEl && !nameEl.value) nameEl.value = 'Kısayol Tuvali';
        const form = document.getElementById('newCanvasForm');
        const submit = form?.querySelector('button[type="submit"], .pwPrimary, button:not([type="button"])')
          || document.getElementById('newCanvasCreate');
        if (submit) submit.click(); else if (form) form.requestSubmit();
        return 'submitted';
      }
      return 'unknown';
    })()`);
  }
  await sleep(1500);
  let inDraw = await evaluate(ws, `document.body.classList.contains('mode-draw') && (typeof inkEditorIsOpen !== 'function' || inkEditorIsOpen())`);
  check('çizim moduna giriş (modal yolu dahil)', !!inDraw, `yol=${boot}`);

  if (inDraw) {
    const press = k => `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); return true; })()`;
    const tool = async () => evaluate(ws, `(typeof inkState === 'function' && inkState().tool) || ''`);

    const seq = [
      ['p', 'pencil'], ['b', 'brush'], ['e', 'eraser'], ['b', 'brush'],
      ['u', 'shape'], ['i', 'eyedropper'], ['l', 'lasso'],
      ['m', 'marquee'], ['v', 'transform'], ['t', 'text'],
    ];
    for (const [k, want] of seq) {
      /* editör dışı kutuya odak olmadığından emin ol */
      await evaluate(ws, `(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); })()`);
      await evaluate(ws, press(k));
      await sleep(120);
      const got = await tool();
      check(`"${k}" → ${want}`, got === want, `tool=${got || '-'}`);
      if (got !== want) failNoExit();
    }

    /* U şekil döngüsü: shape aracında tekrar U sıradaki şekil */
    await evaluate(ws, press('u'));
    await sleep(120);
    const shape1 = await evaluate(ws, `inkState().shape || ''`);
    await evaluate(ws, press('u'));
    await sleep(120);
    const shape2 = await evaluate(ws, `inkState().shape || ''`);
    check('"U" şekil türünü döngülüyor', !!shape1 && !!shape2 && shape1 !== shape2,
      `${shape1} → ${shape2}`);
    if (!shape1 || shape1 === shape2) failNoExit();

    /* Türkçe klavye (TR-Q): 'i' tuşunun key'i 'ı' gelir; 'İ'.toLowerCase()
       iki karakterdir. Kısayollar e.code (KeyX) ile düzen bağımsız
       çözülmeli — TR harf key'iyle (ı/B) bile araç değişmeli. */
    const pressTr = (key, code) => `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, bubbles: true })); return true; })()`;
    const seqTr = [
      ['ı', 'KeyI', 'eyedropper'],
      ['B', 'KeyB', 'brush'],
      ['p', 'KeyP', 'pencil'],
      ['e', 'KeyE', 'eraser'],
      ['v', 'KeyV', 'transform'],
      ['b', 'KeyB', 'brush'],
    ];
    for (const [k, code, want] of seqTr) {
      await evaluate(ws, `(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); })()`);
      await evaluate(ws, pressTr(k, code));
      await sleep(120);
      const got = await tool();
      check(`TR düzen "${k}" (code=${code}) → ${want}`, got === want, `tool=${got || '-'}`);
      if (got !== want) failNoExit();
    }

    /* [ ] boyut adımı: fırça aracında */
    await evaluate(ws, press('b'));
    await sleep(120);
    await evaluate(ws, `(() => { inkState().size = 40; if (typeof inkSyncUI === 'function') inkSyncUI(); })()`);
    await evaluate(ws, press(']'));
    await sleep(120);
    const sizeUp = await evaluate(ws, `inkState().size`);
    await evaluate(ws, press('['));
    await evaluate(ws, press('['));
    await sleep(120);
    const sizeDown = await evaluate(ws, `inkState().size`);
    /* oranlı adım (%12): yukarı 40→45, aşağı 45→40→35 — elt eşitlik
       DEĞİLDİR; doğru davranış yukarıdan büyü, aşağıdan küçük gelmektir. */
    check('"] → [" oranlı boyut adımı (40 üzerinde çıkar, altında iner)',
      sizeUp > 40 && sizeDown < 40,
      `40 → ${sizeUp} → %12 adım → ${sizeDown} (tasarım: oransal)`);
    if (!(sizeUp > 40 && sizeDown < 40)) failNoExit();

    /* FAZ 6 B8: Boyut HUD baloncuğu — "]" sonrası imleç dibi beliri */
    await evaluate(ws, press(']'));
    const b8a = await evaluate(ws, `(() => {
      const b = document.getElementById('inkSizeBubble');
      if (!b) return { ok: false, reason: 'balon yok' };
      const dot = b.querySelector('.inkSizeBubbleDot');
      const val = b.querySelector('.inkSizeBubbleVal');
      return { ok: true, shown: b.classList.contains('show'),
        val: val ? val.textContent : '',
        dot: dot ? Number.parseInt(dot.style.width, 10) : 0,
        size: (typeof inkState === 'function')
          ? Math.round(inkState().size) : -1 };
    })()`);
    check('"] → boyut balonu: görünü + px metni + nokta çapı',
      b8a.ok && b8a.shown && b8a.val.includes(Math.round(b8a.size) + ' px') &&
      Math.abs(b8a.dot - Math.min(96, Math.max(6, Math.round(b8a.size)))) < 2,
      JSON.stringify(b8a));

    /* Alt+tekerlek: imleç noktasında balon + boyut adımı */
    const wheelInfo = await evaluate(ws, `(() => {
      const st = document.getElementById('stage');
      const r = st.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 3) };
    })()`);
    await evaluate(ws, `(() => { inkState().size = 30;
      if (typeof inkSyncUI === 'function') inkSyncUI(); })()`);
    await sleep(1400); /* Önceki balon sönsün */
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseWheel',
      x: wheelInfo.x, y: wheelInfo.y, deltaX: 0, deltaY: -240,
      modifiers: 1, button: 'none', pointerType: 'mouse' });
    await sleep(120);
    const b8w = await evaluate(ws, `(() => {
      const b = document.getElementById('inkSizeBubble');
      const ink = (typeof inkState === 'function') ? inkState() : null;
      if (!b) return { ok: false };
      return { ok: true, shown: b.classList.contains('show'),
        val: b.querySelector('.inkSizeBubbleVal').textContent,
        left: Math.round(Math.abs(parseInt(b.style.left, 10))),
        top: Math.round(Math.abs(parseInt(b.style.top, 10))),
        size: ink ? Math.round(ink.size) : -1,
        wx: ${wheelInfo.x}, wy: ${wheelInfo.y} };
    })()`);
    check('Alt+tekerlek boyut adımlar + balon imlece yakın',
      b8w.ok && b8w.shown &&
      Math.abs(b8w.left - b8w.wx) < 200 && /* 18px ofset + balon genişliği */
      Math.abs(b8w.top - b8w.wy) < 200, JSON.stringify(b8w));
    /* 1.2s sonra söner */
    await sleep(1500);
    const b8t = await evaluate(ws, `(() => {
      const b = document.getElementById('inkSizeBubble');
      return b ? !b.classList.contains('show') : false;
    })()`);
    check('balon otomatik söner (1.2s)', b8t === true);

    /* referans modu izolasyonu: çık, P tahtada aracı değiştirmemeli */
    await evaluate(ws, `(() => { if (typeof modeExitDraw === 'function') modeExitDraw(); })()`);
    await sleep(500);
    await evaluate(ws, press('p'));
    await sleep(120);
    const refTool = await tool();
    const backInDrawOk = await evaluate(ws, `document.body.classList.contains('mode-reference')`);
    check('referans modda "P" aracı değiştirmez (iki-program kuralı)',
      refTool !== 'pencil' && !!backInDrawOk, `tool=${refTool || '-'} mod=reference`);
    if (refTool === 'pencil' || !backInDrawOk) failNoExit();
  } else {
    failNoExit();
  }

  const pass = results.filter(r => r.ok).length;
  const total = results.length;
  console.log(`\nINK-SHORTCUT PROBE: ${pass}/${total} ✓`);
  await evaluate(ws, `window.close()`);
  await sleep(300);
  try { app.kill(); } catch { /* sessiz */ }
  process.exit(pass === total ? 0 : 1);
})().catch(e => { console.error('PROBE HATA:', e && e.stack || e); process.exit(2); });
