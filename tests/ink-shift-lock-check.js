'use strict';

/* Shift düz-çizgi kilidi doğrulaması (Photoshop tarzı).

   Çizim editöründe iki vuruş çizer:
   A) Shift'siz: noktalar başlangıca göre serbest açılarda dağılır
      (kenetleme YOK kanıtı).
   B) Shift basılı: her ham örnek vuruşun İLK noktasına göre en yakın
      45° yönüne kenetlenir; noktalar tek doğrunun üstünde kalır
      (sapma < 1.5°).

   Kullanım: node tests/ink-shift-lock-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9382;
const APP_PORT = 5267;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (m.error) return reject(new Error(JSON.stringify(m.error)));
    if (m.result.exceptionDetails) {
      return reject(new Error(m.result.exceptionDetails.exception?.description || 'eval'));
    }
    resolve(m.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true } }));
});

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-lock-check-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'],
    { cwd: ROOT, env, stdio: 'ignore' });
  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };
  try {
    let page = null;
    for (let i = 0; i < 120 && !page; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
        if (!page) await sleep(300);
      } catch { await sleep(300); }
    }
    if (!page) throw new Error('uygulama sayfası bulunamadı');
    const ws = await new Promise((res, rej) => {
      const s = new WebSocket(page.webSocketDebuggerUrl);
      s.onopen = () => res(s);
      s.onerror = rej;
    });
    for (let i = 0; i < 40; i += 1) {
      const ok = await evaluate(ws,
        "typeof inkState === 'function' && typeof setActiveBrush === 'function' && !!stage.clientWidth")
        .catch(() => false);
      if (ok) break;
      await sleep(400);
    }

    const report = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = { strokes: [], a: {}, b: {} };
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '1600';
      document.getElementById('newCanvasH').value = '1200';
      document.getElementById('newCanvasName').value = 'Shift Testi';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 120 && !(typeof inkEditorIsOpen === 'function' && inkEditorIsOpen()); i += 1) {
        await wait(100);
      }
      await wait(700);
      out.editorOpen = inkEditorIsOpen();
      if (!out.editorOpen) return JSON.stringify(out);

      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      const toClient = (nx, ny) => ({
        clientX: rect.left + fit.x + nx * fit.w,
        clientY: rect.top + fit.y + ny * fit.h,
      });
      const ev2 = (type, p, shift, up) => new PointerEvent(type, {
        bubbles: true, composed: true, cancelable: true,
        pointerId: 23, pointerType: 'mouse', isPrimary: true,
        clientX: p.clientX, clientY: p.clientY,
        button: 0, buttons: up ? 0 : 1,
        shiftKey: !!shift,
      });

      // A) Shift'siz vuruş: serbest açılar (kenetlenme YOK kanıtı).
      inkSetTool('brush', { brushId: 'ink-hard' });
      const ink = inkState();
      ink.size = 36; ink.opacity = 1; ink.color = '#ffffff';
      await wait(150);
      const aA = toClient(0.2, 0.45);
      canvas.dispatchEvent(ev2('pointerdown', aA, false));
      await wait(40);
      // Başlangıca göre sürekli kırılan serbest yol (45° dışı açılar).
      const pathA = [[0.50, 0.605], [0.65, 0.500], [0.85, 0.635]];
      for (const [nx, ny] of pathA) {
        canvas.dispatchEvent(ev2('pointermove', toClient(nx, ny), false));
        await wait(24);
      }
      const rawA = inkEditorUi.stroke ? inkEditorUi.stroke.points.map(p => ({ x: p.x, y: p.y })) : [];
      out.a.points = rawA.length;
      out.a.angles = (() => {
        const it = getItem(inkEditorUi.itemId);
        const p0 = rawA[0] || { x: 0, y: 0 };
        return rawA.slice(1).map(p =>
          Math.atan2((p.y - p0.y) * it.h, (p.x - p0.x) * it.w) * 180 / Math.PI);
      })();
      canvas.dispatchEvent(ev2('pointerup', toClient(0.8, 0.563), false, true));
      await wait(600); // commit + yeniden çizim

      // B) Shift basılı vuruş: kırık yollar dahi tek 45° doğruya kenetlenir.
      inkSetTool('brush', { brushId: 'ink-hard' });
      await wait(120);
      ink.size = 36; ink.opacity = 1; ink.color = '#ffffff';
      await wait(120);
      const aB = toClient(0.2, 0.70);
      canvas.dispatchEvent(ev2('pointerdown', aB, true));
      await wait(40);
      // Açığı ve sürekli değişen yönler: y sağa sola kırılıyor (23°→-40°→60°).
      const pathB = [
        [0.42, 0.804], [0.58, 0.610], [0.70, 0.822], [0.82, 0.640], [0.86, 0.702],
      ];
      for (const [nx, ny] of pathB) {
        canvas.dispatchEvent(ev2('pointermove', toClient(nx, ny), true));
        await wait(24);
      }
      const rawB = inkEditorUi.stroke ? inkEditorUi.stroke.points.map(p => ({ x: p.x, y: p.y })) : [];
      out.b.points = rawB.length;
      const itB = getItem(inkEditorUi.itemId);
      const p0B = rawB[0] || { x: 0, y: 0 };
      out.b.angles = rawB.slice(1).map(p =>
        Math.atan2((p.y - p0B.y) * itB.h, (p.x - p0B.x) * itB.w) * 180 / Math.PI);
      out.b.shiftPressed = true;
      canvas.dispatchEvent(ev2('pointerup', toClient(0.86, 0.702), true, true));
      await wait(600);
      // Kenetlenmiş çizgi ekranda duruyor mu? (kaba parlaklık)
      const dprC = canvas.width / Math.max(1, rect.width);
      const bx = Math.round((fit.x + 0.15 * fit.w) * dprC);
      const by = Math.round((fit.y + 0.62 * fit.h) * dprC);
      const bw = Math.round(0.75 * fit.w * dprC);
      const bh = Math.max(8, Math.round(0.16 * fit.h * dprC));
      const d = canvas.getContext('2d').getImageData(bx, by, bw, bh).data;
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) bright += 1;
      }
      out.b.bright = bright;
      return JSON.stringify(out);
    })()`));

    check('çizim editörü açıldı', report.editorOpen === true);

    // A) Shift'siz: açı serbest — başlangıca göre 45° ızgaradan uzak.
    const aAngles = report.a && report.a.angles || [];
    const aSpread = aAngles.length > 1
      ? Math.abs(Math.max(...aAngles) - Math.min(...aAngles)) : 0;
    check('A · Shiftsiz çizim serbest açıda kalır (kenetleme yok)',
      aAngles.length >= 10 && aSpread > 5,
      `nokta=${report.a && report.a.points} · açı dağılımı=${aSpread.toFixed(1)}°`);

    // B) Shift basılı: tüm noktalar en yakın 45° yönünde, sapma küçük.
    const bAngles = report.b && report.b.angles || [];
    const maxDev = bAngles.reduce((m, a) => {
      const rel = Math.abs(((a % 45) + 45) % 45 - 22.5);
      return Math.max(m, 22.5 - rel);
    }, 0);
    check('B · Shift basılıyken vuruş 45° ızgaraya kenetlenir',
      bAngles.length >= 10 && maxDev < 1.5,
      `nokta=${report.b && report.b.points} · en kötü sapma=${maxDev.toFixed(2)}°`);

    check('B · kenetlenmiş çizgi ekranda görünür', report.b && report.b.bright > 50,
      `beyaz piksel=${report.b && report.b.bright}`);

    console.log(pass + ' geçti · ' + fail + ' kaldı');
    if (fail) process.exitCode = 1;
  } catch (e) {
    console.error('HATA:', e.message);
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(200);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
  }
})();
