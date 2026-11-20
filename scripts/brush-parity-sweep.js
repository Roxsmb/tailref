'use strict';
/* K20 · fırça parite sweep — 52 native fırçanın tamamında canlı/commit
   ------------------------------------------------------------------
   Kullanıcı/gpl regression: "canlı çizimle bırakınca şekil farklı",
   "bazı fırçalarda yazdığım görünmüyor". Smoke'ın jenerik tek-fırça
   paritesi bunları yakalamıyor; burada NativeBrushLibrary'deki HER
   fırça için gerçek uygulama akışı sürülür:

     pointerdown → pointermove'lar → (canlı önizleme snapshot'ı)
     → pointerup → commit bitmap'i katmana uygulanana kadar beklenir
     → katman raster snapshot'ı

   Her fırça için ölçülür:
     • live  : canlı önizlemede vuruş renginde piksel sayısı (>0 olmalı)
     • commit: katman backing'inde alfa>8 piksel sayısı (>0 olmalı)
     • iou   : canlı maskesi ∩ katman maskesi / birleşim (şekil paritesi)
     • gl    : canlı GPU (WebGL2) önizleme aktif mi (tanısal)
   Çıktı: fırça başına satır + genel karar. Exit != 0 → başarısız fırça var.
   node scripts/brush-parity-sweep.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9393;
const APP_PORT = 5250;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const send = (ws, method, params = {}, timeout = 300000) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const timer = setTimeout(() => {
    reject(new Error('CDP zaman aşımı: ' + method));
  }, timeout);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    clearTimeout(timer);
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (ws, expression, timeout) => {
  const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    const desc = d.exception && d.exception.description || d.text || 'eval';
    throw new Error(desc);
  }
  return r.result.value;
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-paritysweep-'));
  // GPU AÇIK: kullanıcı ortamı; canlı GPU önizleme tanıya dahil.
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let mainPage = null; let deadline = Date.now() + 40000;
  while (Date.now() < deadline && !mainPage) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      mainPage = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
    } catch { /* bekle */ }
    if (!mainPage) await sleep(500);
  }
  if (!mainPage) throw new Error('ana pencere açılmadı');
  const ws = new WebSocket(mainPage.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await sleep(4000);
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
  })()`, 60000);

  /* 640×480 test görseli ekle */
  console.log('· test görseli ekleniyor');
  const setup = await evaluate(ws, `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 640, 480);
    grad.addColorStop(0, '#26415f'); grad.addColorStop(1, '#5f2640');
    g.fillStyle = grad; g.fillRect(0, 0, 640, 480);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await addFiles([new File([blob], 'parity-sweep.png', { type: 'image/png' })], null);
    for (let i = 0; i < 40; i++) {
      if (state.items.some(it => it.kind === 'image')) break;
      await wait(150);
    }
    const item = state.items.find(it => it.kind === 'image');
    if (!item) return JSON.stringify({ ok: false });
    return JSON.stringify({ ok: true, id: item.id });
  })()`, 60000);
  const s0 = JSON.parse(setup);
  if (!s0.ok) throw new Error('test görseli eklenemedi');

  console.log('· modal editör açılıyor');
  await evaluate(ws, `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    modeEnterDraw(${JSON.stringify(s0.id)});
    for (let i = 0; i < 40 && !inkEditorIsOpen(); i += 1) await wait(100);
    return inkEditorIsOpen();
  })()`, 60000);

  console.log('· sweep koşumu (kütüphanedeki tüm fırçalar) — bu 2-4 dk sürer');
  const raw = await evaluate(ws, `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ink = inkState();
    const ui = inkEditorUi;
    const rectOf = () => ui.canvas.getBoundingClientRect();
    const results = [];
    const glActive = !!(inkDabGl && inkDabGl.tried && inkDabGl.ok && !inkDabGl.disabled);
    for (const brush of NativeBrushLibrary) {
      const layer = inkAddLayer({ kind: 'attached', ownerId: ${JSON.stringify(s0.id)}, name: 'sweep-' + brush.id });
      if (!layer) { results.push({ id: brush.id, error: 'katman yok' }); continue; }
      ink.activeLayerId = layer.id;
      inkSetTool('brush', { brushId: brush.id });
      ink.tool = 'brush';
      ink.color = '#ff2000';
      ink.smoothing = 0.1;
      // Fırçanın boyutu/opaklığı gerçek seçimle UI'dan gelir; sweep bunu birebir uygular.
      ink.size = Math.round(brush.size) || 12;
      ink.opacity = Number.isFinite(brush.opacity) ? brush.opacity : 1;
      ink.hardness = Number.isFinite(brush.hardness) ? brush.hardness : 0.8;

      const rect = rectOf();
      const pt = p => ({
        x: rect.left + ui.fit.x + ui.fit.w * p[0],
        y: rect.top + ui.fit.y + ui.fit.h * p[1],
      });
      const ev = (type, p, pressure) => new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 555, pointerType: 'pen',
        isPrimary: true, pressure, clientX: p.x, clientY: p.y,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      });
      const seg = [[0.22, 0.30], [0.34, 0.24], [0.46, 0.34], [0.58, 0.24], [0.70, 0.32], [0.80, 0.28]];
      try {
        ui.canvas.dispatchEvent(ev('pointerdown', pt(seg[0]), 0.55));
        for (let i = 1; i < seg.length; i++) ui.canvas.dispatchEvent(ev('pointermove', pt(seg[i]), 0.55 + i * 0.08));
        await wait(70);
        // canlı önizleme raster'ı (TAM yol: K20b bileşim + alfa>8 ölçümü;
        // yarım-yol yakalama toz fırçaların düşük-alfa halo'sunu eksik
        // sayıyordu — IoU imzası fırça sınıfı değil ölçüm noktasıydı)
        const preview = inkEditorRebuildPreview(true);
        const pw = preview.width, ph = preview.height;
        const pd = preview.getContext('2d').getImageData(0, 0, pw, ph).data;
        const live = new Uint8Array(pw * ph);
        let liveCount = 0;
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const i = (y * pw + x) * 4;
            // K20b: önizleme = taban ⊕ (ağırlık × opaklık); boş katmanda
            // dablar saydamda kalır → alfa düşük ama renk kanalları vuruş
            // rengini taşır (#ff2000). Eski eşik (alfa>40 + kısa vuruş)
            // akış fırçalarını (su/aerografi, alfa ~k5) yanlış "boş"
            // sayıyordu; ölçüm artık commit ölçümüyle aynı (alfa>8).
            if (pd[i] > 100 && pd[i + 1] < 180 && pd[i + 2] < 180 && pd[i + 3] > 8) {
              live[y * pw + x] = 1; liveCount++;
            }
          }
        }
        ui.canvas.dispatchEvent(ev('pointerup', pt(seg[5]), 0.75));
        // commit bitmap'ini bekle: katman pikseleri iki kez üst üste sabitlenene dek
        const cv = inkRuntime.itemCanvases.get(layer.id);
        let last = -1, steady = 0, commit = 0;
        for (let k = 0; k < 60; k++) {
          await wait(50);
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
          let c = 0;
          for (let j = 3; j < d.length; j += 4) if (d[j] > 8) c++;
          if (c === last && c > 0) steady++; else steady = 0;
          last = c;
          if (steady >= 3) break;
        }
        commit = last;
        // IoU: canlı maskesi (önizleme boyutu = katman boyutu) ile katman maskesi
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        const cw = cv.width, chh = cv.height;
        let inter = 0, union = 0;
        if (cw === pw && chh === ph) {
          for (let p2 = 0; p2 < cw * chh; p2++) {
            const a = live[p2] === 1;
            const b = d[p2 * 4 + 3] > 8;
            if (a && b) inter++;
            if (a || b) union++;
          }
        }
        const iou = union > 0 ? inter / union : 0;
        results.push({ id: brush.id, live: liveCount, commit, iou: Math.round(iou * 1000) / 1000,
          gl: glActive, cw: cw, pw: pw });
      } catch (e) {
        results.push({ id: brush.id, error: String((e && e.message) || e) });
      }
      // izolasyon: vuruşları ve katmanı kaldır
      try {
        layer.strokes = [];
        inkRemoveLayer(layer.id);
        await wait(30);
      } catch { /* k Commons */ }
    }
    return JSON.stringify({ glActive, results });
  })()`, 300000);
  const sweep = JSON.parse(raw);

  try { await evaluate(ws, 'window.close()'); } catch { }
  app.kill();

  /* ---- rapor ---- */
  const failures = [];
  for (const r of sweep.results) {
    if (r.error) { failures.push(`${r.id} · hata: ${r.error}`); continue; }
    const problems = [];
    if (r.commit === 0) problems.push('COMMIT BOŞ (yazdığı görünmüyor)');
    if (r.live === 0) problems.push('CANLI BOŞ (çizerken görünmüyor)');
    if (r.commit > 0 && r.iou < 0.45) problems.push('ŞEKİL PARİTESİ DÜŞÜK ' + r.iou);
    if (problems.length) failures.push(`${r.id} · live=${r.live} commit=${r.commit} iou=${r.iou} · ${problems.join(' | ')}`);
  }
  console.log(`\nGL canlı önizleme: ${sweep.glActive ? 'AKTİF' : 'kapalı · 2B raster'}`);
  console.log('FIRÇA SONUÇLARI:');
  for (const r of sweep.results) {
    if (r.error) { console.log('  ✗ ' + r.id + ' · ' + r.error); continue; }
    const flag = (r.commit === 0 || r.live === 0 || (r.commit > 0 && r.iou < 0.45)) ? '✗' : '✓';
    console.log(`  ${flag} ${r.id.padEnd(24)} live=${String(r.live).padStart(6)} commit=${String(r.commit).padStart(6)} iou=${r.iou}${r.cw !== r.pw ? '  boyut farkı! ' + r.cw + '≠' + r.pw : ''}`);
  }
  if (failures.length) {
    console.log('\nBAŞARISIZ ' + failures.length + ' FIRÇA:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('\nTÜM FIRÇALAR PARİTEDE');
  process.exit(0);
})().catch(e => {
  console.error('HATA:', e.message);
  try { process.exit(1); } catch { }
  setTimeout(() => process.exit(1), 100);
});
