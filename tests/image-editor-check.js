'use strict';

/* Kontrol: Görsel Düzenleyici ikinci nesil arayüz
   • üç bölge katlanabilir (Renk ve Görünüm / Döndür ve Aynala / Kırpma Ayarları)
   • Sıcaklık + Opaklık sayar kaydırıcılar çalışır (panelde YENİ)
   • Doygunluk/Parlaklık/Kontrast okumaları güncellenir
   • Sola/Sağa 90° döndürme, Yatay/Dikey Yansıt (aria-pressed)
   • Kırpma oranı hazır ayarları (Serbest/1:1/16:9/4:3) merkez sabit veet
   • Kırpma kaydırıcıları px okumaları gösterir
   • Sıfırla tüm renk bölümünü başa döndürür
   • üst çubuktaki opaklık kaydırıcısıyla panel senkron kalır */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9341;
const APP_PORT = 5214;
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

const inputEvent = el => `document.getElementById('${el}').dispatchEvent(new Event('input', { bubbles: true })); true`;

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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-imgedit-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  const results = {};
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
      try { ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth"); if (ready) break; } catch { }
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');
    /* Uygulama varsayılan dili İngilizce; bölüm başlıklarını Türkçe sına. */
    await evaluate(ws, "window.L10N ? window.L10N.setLang('tr') : 'no-l10n'");

    await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
    await sleep(900);
    await evaluate(ws, 'window.__errs = []; window.addEventListener("error", e => window.__errs.push(String(e.message || e))); window.it_edit = () => state.items.find(i => i.id === "it_edit_probe"); true');

    // denek görseli oluştur ve seç
    const added = await evaluate(ws, `(async () => {
      try {
        const c = document.createElement('canvas');
        c.width = 400; c.height = 300;
        const x = c.getContext('2d');
        x.fillStyle = '#b05a3a'; x.fillRect(0, 0, 400, 300);
        x.fillStyle = '#ffffff'; x.beginPath(); x.arc(200, 150, 60, 0, 7); x.fill();
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const imageId = 'img_edit_probe';
        await idbPut('images', imageId, { blob, name: 'edit-denek.png' });
        const entry = await decodeImage(blob);
        setImgCache(imageId, { img: entry.img, url: entry.url, name: 'edit-denek.png' });
        const it = {
          id: 'it_edit_probe', kind: 'image', imageId, title: 'edit-denek',
          x: 0, y: 0, w: 400, h: 300, rot: 0, z: nextZ(),
        };
        state.items.push(it);
        if (typeof inkAddLayer === 'function') {
          inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'Katman 1', pxW: 400, pxH: 300 });
        }
        const base = { x: stage.clientWidth / 2 / state.view.scale, y: stage.clientHeight / 2 / state.view.scale };
        it.x = base.x - 200; it.y = base.y - 150;
        selection = new Set([it.id]);
        selectionOrder = [it.id];
        if (typeof syncAll === 'function') syncAll();
        syncSelection();
        await new Promise(r => setTimeout(r, 400));
        return { ok: true, id: it.id, w: it.w, h: it.h };
      } catch (err) {
        return { ok: false, reason: String(err && err.message || err) };
      }
    })()`);
    results.added = added.ok;
    results.addedReason = added.reason || '';
    if (!added.ok) throw new Error('denek görseli eklenemedi: ' + added.reason);

    // paneli aç
    await evaluate(ws, `document.getElementById('btnEditImage').click(); true`);
    await sleep(500);
    results.panelOpen = await evaluate(ws, '!document.getElementById("imageEditor").hidden');
    results.sections = await evaluate(ws, `[...document.querySelectorAll('#imageEditor .ieSecTitle')].map(n => n.textContent.trim()).join('|')`);
    results.controls = await evaluate(ws, `JSON.stringify({
      temp: !!document.getElementById('fTemp'),
      opacity: !!document.getElementById('fOpacity'),
      reset: !!document.getElementById('btnResetFilter'),
      rotL: !!document.getElementById('btnImageRotL'),
      rotR: !!document.getElementById('btnImageRotR'),
      flipH: !!document.getElementById('btnImageFlipH'),
      flipV: !!document.getElementById('btnImageFlipV'),
      ratioBtns: document.querySelectorAll('#ieRatioGroup button[data-ratio]').length,
      outputs: [...document.querySelectorAll('#imageEditor .ieVal')].length,
    })`);

    /* doygunluk + sıcaklık: filtre dizgisi öğe üzerinde görünür olmalı */
    await evaluate(ws, `document.getElementById('fGray').value = '60'; true`);
    await evaluate(ws, inputEvent('fGray'));
    await evaluate(ws, `document.getElementById('fTemp').value = '50'; true`);
    await evaluate(ws, inputEvent('fTemp'));
    await sleep(250);
    results.grayVal = await evaluate(ws, `String(it_edit().fGray)`);
    results.tempVal = await evaluate(ws, `String(it_edit().fTemp)`);
    results.mediaFilter = await evaluate(ws, `(document.querySelector('[data-id="it_edit_probe"] .media img')?.style.filter) || document.querySelector('[data-id="it_edit_probe"] .media')?.style.filter || ''`);
    results.grayReadout = await evaluate(ws, `document.getElementById('fGrayVal').textContent`);
    results.tempReadout = await evaluate(ws, `document.getElementById('fTempVal').textContent`);

    /* opaklık: panel kaydırıcısı üst çubuğu besler */
    await evaluate(ws, `document.getElementById('fOpacity').value = '70'; true`);
    await evaluate(ws, inputEvent('fOpacity'));
    await sleep(200);
    results.alphaAfterPanel = await evaluate(ws, `it_edit().alpha`);
    results.topAlphaSync = await evaluate(ws, `document.getElementById('itemAlpha').value`);
    results.opacityReadout = await evaluate(ws, `document.getElementById('fOpacityVal').textContent`);
    await evaluate(ws, `document.getElementById('itemAlpha').value = '100'; true`);
    await evaluate(ws, inputEvent('itemAlpha'));
    await sleep(200);
    results.alphaAfterBar = await evaluate(ws, `it_edit().alpha`);
    results.panelAlphaSync = await evaluate(ws, `document.getElementById('fOpacity').value`);

    /* döndürme + çevirme */
    results.rotBefore = await evaluate(ws, `it_edit().rot || 0`);
    await evaluate(ws, `document.getElementById('btnImageRotL').click(); true`);
    await sleep(160);
    results.rotAfterL = await evaluate(ws, `it_edit().rot`);
    await evaluate(ws, `document.getElementById('btnImageRotR').click(); true`);
    await sleep(160);
    results.rotAfterR = await evaluate(ws, `it_edit().rot`);
    await evaluate(ws, `document.getElementById('btnImageFlipH').click(); true`);
    await sleep(160);
    results.flipHVal = await evaluate(ws, `it_edit().flipH`);
    results.flipHAria = await evaluate(ws, `document.getElementById('btnImageFlipH').getAttribute('aria-pressed')`);
    results.elTransform = await evaluate(ws, `document.querySelector('[data-id="it_edit_probe"]').style.transform`);
    await evaluate(ws, `document.getElementById('btnImageFlipV').click(); true`);
    await sleep(160);
    results.flipVVal = await evaluate(ws, `it_edit().flipV`);

    /* kırpma oranı: 16:9 merkez sabit */
    await evaluate(ws, `document.querySelector('#ieRatioGroup [data-ratio="1.77778"]').click(); true`);
    await sleep(250);
    results.cropVals = await evaluate(ws, `JSON.stringify([it_edit().cropTop, it_edit().cropRight, it_edit().cropBottom, it_edit().cropLeft])`);
    results.ratioApplied = await evaluate(ws, `(() => {
      const it = it_edit();
      const wv = 1 - ((it.cropLeft || 0) + (it.cropRight || 0)) / 100;
      const hv = 1 - ((it.cropTop || 0) + (it.cropBottom || 0)) / 100;
      return ((it.w * wv) / (it.h * hv)).toFixed(2);
    })()`);
    results.cropPxReadout = await evaluate(ws, `document.getElementById('cropLeftVal').textContent`);
    /* serbest: değerlere dokunmaz */
    await evaluate(ws, `document.querySelector('#ieRatioGroup [data-ratio="0"]').click(); true`);
    await sleep(120);
    results.freeSame = await evaluate(ws, `it_edit().cropLeft`);

    /* Sıfırla: renk bölümü başa döner */
    await evaluate(ws, `document.getElementById('btnResetFilter').click(); true`);
    await sleep(200);
    results.afterReset = await evaluate(ws, `JSON.stringify({ g: it_edit().fGray, t: it_edit().fTemp })`);
    results.tempSliderAfter = await evaluate(ws, `document.getElementById('fTemp').value`);

    /* okumaya çift tık → elle giriş */
    results.dblGray = await evaluate(ws, `(async () => {
      const out = document.getElementById('fGrayVal');
      out.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const inp = out.querySelector('input');
      if (!inp) return 'kutu-acilmadi';
      inp.value = '20';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return JSON.stringify({ fGray: it_edit().fGray, okuma: out.textContent, slider: document.getElementById('fGray').value });
    })()`);
    /* kırpma px girişi: 300 yükseklikli öğede 60 px → %20 */
    results.dblCrop = await evaluate(ws, `(async () => {
      const out = document.getElementById('cropTopVal');
      out.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const inp = out.querySelector('input');
      if (!inp) return 'kutu-acilmadi';
      inp.value = '60';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return JSON.stringify({ cropTop: it_edit().cropTop, okuma: out.textContent, slider: document.getElementById('cropTop').value });
    })()`);
    /* Esc vazgeçme */
    results.dblEscape = await evaluate(ws, `(async () => {
      const out = document.getElementById('fTempVal');
      const prev = out.textContent;
      out.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const inp = out.querySelector('input');
      if (!inp) return 'kutu-acilmadi';
      inp.value = '77';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 120));
      return JSON.stringify({ once: prev, sonra: out.textContent, fTemp: it_edit().fTemp });
    })()`);

    /* katlanabilirlik: kırpma bölümünü kapat-aç */
    await evaluate(ws, `document.querySelector('#ieCropSection > .ieSecHead').click(); true`);
    await sleep(120);
    results.cropClosed = await evaluate(ws, `!document.getElementById('ieCropSection').open`);
    await evaluate(ws, `document.querySelector('#ieCropSection > .ieSecHead').click(); true`);
    await sleep(120);
    results.cropReopened = await evaluate(ws, `document.getElementById('ieCropSection').open`);

    /* dolgu CSS'i tazelik kontrolü */
    results.fillAfterType = await evaluate(ws, `document.getElementById('fGray').style.getPropertyValue('--fill')`);
    results.fillCropAfterRatio = await evaluate(ws, `document.getElementById('cropTop').style.getPropertyValue('--fill')`);
    results.errs = await evaluate(ws, `JSON.stringify(window.__errs)`);
  } catch (e) {
    results.error = e.message;
  } finally {
    try { ws && ws.close(); } catch { }
    try { app.kill(); } catch { }
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { }
  }

  const num = v => Number(v) || 0;
  const ok = (name, cond, detail) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}  ${detail == null ? '' : '→ ' + detail}`);

  ok('denek görsel eklendi', results.added === true, results.addedReason);
  ok('panel açıldı', results.panelOpen === true);
  ok('bölüm başlıkları', String(results.sections) === 'Renk ve Görünüm|Döndür ve Aynala|Kırpma Ayarları', results.sections);
  const ctl = JSON.parse(results.controls || '{}');
  ok('yeni kontroller yerinde', ctl.temp && ctl.opacity && ctl.reset && ctl.rotL && ctl.rotR && ctl.flipH && ctl.flipV && ctl.ratioBtns === 4 && ctl.outputs >= 9, results.controls);
  ok('doygunluk uygulandı', results.grayVal === '60' && String(results.mediaFilter || '').includes('grayscale(60%)'), `${results.grayVal} · ${results.mediaFilter}`);
  ok('sıcaklık uygulandı', num(results.tempVal) === 50 && String(results.mediaFilter || '').includes('sepia'), `${results.tempVal} · ${results.mediaFilter}`);
  ok('okumalar güncellendi', results.grayReadout === '60%' && results.tempReadout === '+50', `${results.grayReadout} · ${results.tempReadout}`);
  ok('panel opaklığı üst çubuğu besledi', Math.round(num(results.alphaAfterPanel) * 100) === 70 && results.topAlphaSync === '70', `alfa=${results.alphaAfterPanel} üst=${results.topAlphaSync}`);
  ok('üst çubuk opaklığı paneli besledi', Math.round(num(results.alphaAfterBar) * 100) === 100 && results.panelAlphaSync === '100', `alfa=${results.alphaAfterBar}`);
  ok('Sola 90°', num(results.rotBefore) === 0 && num(results.rotAfterL) === 270, `${results.rotBefore} → ${results.rotAfterL}`);
  ok('Sağa 90° geri getirdi', num(results.rotAfterR) === 0, String(results.rotAfterR));
  ok('Yatay Yansıt çalıştı', results.flipHVal === true && results.flipHAria === 'true', `${results.flipHVal} · aria=${results.flipHAria}`);
  ok('öğe transformu çevirmeyi içeriyor', String(results.elTransform).includes('scale(-1'), results.elTransform);
  ok('Dikey Yansıt çalıştı', results.flipVVal === true, String(results.flipVVal));
  const crops = JSON.parse(results.cropVals || '[0,0,0,0]');
  ok('16:9 kırpma uygulandı', crops.some(v => v > 0) && Math.abs(num(results.ratioApplied) - 1.78) < 0.06, `kırp=${results.cropVals} oran=${results.ratioApplied}`);
  ok('kırpma px okuması', /\d+ px$/.test(String(results.cropPxReadout)), results.cropPxReadout);
  ok('Serbest kırpma değişmedi', results.freeSame === crops[3], String(results.freeSame));
  const rst = JSON.parse(results.afterReset || '{}');
  ok('Sıfırla renk bölümünü temizledi', rst.g === 0 && rst.t === 0 && results.tempSliderAfter === '0', results.afterReset);
  const dg = JSON.parse(results.dblGray || '{}');
  ok('okumaya çift tık → elle giriş (doygunluk)', dg.fGray === 20 && dg.okuma === '20%' && dg.slider === '20', results.dblGray);
  ok('dolgu yine tazelendi (--fill %20)', results.fillAfterType === '20.00%', results.fillAfterType);
  ok('hız ayarı sonrası kırpma dolgusu güncel', results.fillCropAfterRatio === '44.44%', results.fillCropAfterRatio);
  const dc = JSON.parse(results.dblCrop || '{}');
  ok('kırpma px elle giriş → % kaydırıcı', dc.cropTop === 20 && dc.slider === '20' && /60 px$/.test(String(dc.okuma)), results.dblCrop);
  const de = JSON.parse(results.dblEscape || '{}');
  ok('Esc vazgeçme değeri korur', de.fTemp === 0 && de.sonra === de.once, results.dblEscape);
  ok('bölüm kapanıp açıldı', results.cropClosed === true && results.cropReopened === true);
  ok('sayfada hata yok', results.errs === '[]', results.errs);

  if (results.error) {
    console.log('HATA: ' + results.error);
    console.log(JSON.stringify(results, null, 1));
    process.exit(1);
  }
  process.exit(0);
})();
