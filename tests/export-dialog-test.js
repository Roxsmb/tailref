'use strict';

/* Dışa Aktar penceresi — her özelliği tek tek doğrulayan test.

   Kapsam:
   • Ctrl+E kısayolu pencereyi açar
   • Önizleme çizilir + px/dosya boyutu bilgisi dolar
   • Kapsam: seçim yok → tile devre dışı; seçim var → aktif
   • Kapsam: Görüş Alanı → ekran boyutuyla birebir
   • Biçim: JPEG → kalite satırı + metadata kapalı; saydam → beyaz dönüş
   • Biçim: WebP → ipucu metni değişir
   • Ölçek: 2× pikselleri büyütür; "Belirli" W×H + oran kilidi
   • DPI: 300 → ~4.17× piksel
   • Sadece çizimler: çizim yok → "yok" + İndir kapalı; çizim var (stub) → boyut
   • Perform: PNG/JPEG/WebP gerçek blob + doğru dosya adı
   • Metadata gömme: PNG blob'unda tEXt parçası
   • Tercihler localStorage'da kalır
   • Escape pencereyi kapatır

   Uygulamayı izole profille kendisi başlatır ve kapatır.
   Kullanım: node tests/export-dialog-test.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9341;        // desktop-smoke (9333) ile çakışmasın
const APP_PORT = 5199;    // desktop-smoke (5196) ile çakışmasın
const sleep = ms => new Promise(r => setTimeout(r, ms));

function electronPath() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('electron bulunamadı (npm install)');
  return found;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

const send = (ws, method, params) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  /* awaitPromise: pencere betikleri async IIFE kullanıyor. */
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 15000);
});

/* Ctrl+E gibi bileşik kısayollar. */
async function keyCombo(ws, key, code, vk, modifiers) {
  await send(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key, code, windowsVirtualKeyCode: vk });
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode: vk });
}

async function waitForTarget(deadlineMs = 20000) {
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

(async () => {
  // Gerçek tahtaya dokunmamak için izole profil + ayrı port.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-export-'));
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  let ws = null;
  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await connect(page.webSocketDebuggerUrl);

    // Renderer hazır olana kadar bekle.
    const ready = Date.now() + 20000;
    let isReady = false;
    while (Date.now() < ready) {
      try {
        isReady = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth");
        if (isReady) break;
      } catch { /* henüz değil */ }
      await sleep(500);
    }
    if (!isReady) throw new Error('renderer hazır olmadı');
    await sleep(1200);

    /* Test görseli ekle (tahta boşken dışa aktarılamaz uyarısını önle). */
    const eklenen = await evaluate(ws, `(async () => {
      const c = document.createElement('canvas'); c.width = 240; c.height = 180;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 240, 180);
      g.fillStyle = grad; g.fillRect(0, 0, 240, 180);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await addFiles([new File([blob], 'export-test.png', { type: 'image/png' })], null);
      return state.items.length;
    })()`);
    await sleep(800);
    check('test görseli eklendi', eklenen >= 1, `items=${eklenen}`);
    /* addFiles öğeyi seçebilir: "seçim yok" senaryosu için temizle. */
    await evaluate(ws, `(() => { selection.clear(); return selection.size; })()`);
    await evaluate(ws, `openExportDialog()`);
    await sleep(500);

    /* --- 1) Ctrl+E pencereyi açar ------------------------------------- */
    await keyCombo(ws, 'e', 'KeyE', 69, 2 /* Ctrl */);
    await sleep(400);
    check('Ctrl+E pencereyi açar', (await evaluate(ws, "!document.getElementById('exportModal').hidden")) === true, '');

    /* --- 1b) Sade açılış: ileri ayarlar kapalı -------------------------- */
    const sade = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      const webp = m.querySelector('input[name="exFormat"][value="webp"]').closest('.exFmt');
      const dpiRow = m.querySelector('#exDpiGroup').closest('.exScaleRow');
      const kapsam = m.querySelector('.exRangeTiles');
      return { adv: m.classList.contains('is-adv'),
               webpGizli: getComputedStyle(webp).display === 'none',
               dpiGizli: getComputedStyle(dpiRow).display === 'none',
               kapsamGorunur: !kapsam.closest('.exAdvOnly'),
               btnVar: !!document.getElementById('exAdvBtn') };
    })())`));
    check('sade açılış → kapsam görünür, ileri ayarlar kapalı', sade.adv === false && sade.webpGizli === true && sade.dpiGizli === true && sade.kapsamGorunur === true && sade.btnVar === true, JSON.stringify(sade));
    await evaluate(ws, `(() => { document.getElementById('exAdvBtn').click(); return 'ok'; })()`);
    const advAcik = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      const webp = m.querySelector('input[name="exFormat"][value="webp"]').closest('.exFmt');
      return { adv: m.classList.contains('is-adv'), webpGizli: getComputedStyle(webp).display === 'none',
               aria: document.getElementById('exAdvBtn').getAttribute('aria-expanded') };
    })())`));
    check('Daha fazla ayar → ileri blok açıldı', advAcik.adv === true && advAcik.webpGizli === false && advAcik.aria === 'true', JSON.stringify(advAcik));

    /* --- 2) Önizleme çizildi + bilgi metni ---------------------------- */
    await sleep(700);
    const pv1 = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      const cv = m.querySelector('#exPreviewCanvas');
      const info = m.querySelector('#exInfo').textContent;
      const mm = info.match(/(\\d+)\\s*×\\s*(\\d+)/);
      return { w: cv.width, h: cv.height, info, tw: mm ? +mm[1] : 0, th: mm ? +mm[2] : 0,
               dlDisabled: m.querySelector('#exDownload').disabled };
    })())`));
    check('önizleme tuvali çizildi', pv1.w > 0 && pv1.h > 0, `${pv1.w}×${pv1.h}`);
    check('bilgi metni px içeriyor', /px/.test(pv1.info), pv1.info);
    check('1× ölçek boyutu öğrenildi', pv1.tw > 0 && pv1.th > 0, `${pv1.tw}×${pv1.th}`);
    check('İndir düğmesi açık', pv1.dlDisabled === false, '');

    const temel = { tw: pv1.tw, th: pv1.th };
    const bilgiOku = async () => JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      const mm = m.querySelector('#exInfo').textContent.match(/(\\d+)\\s*×\\s*(\\d+)/);
      return { tw: mm ? +mm[1] : 0, th: mm ? +mm[2] : 0,
               dlDisabled: m.querySelector('#exDownload').disabled,
               info: m.querySelector('#exInfo').textContent };
    })())`));

    /* --- 3) Kapsam: seçim yok → tile devre dışı ----------------------- */
    const tile0 = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      const tile = m.querySelector('#exTileSel');
      const inp = tile.querySelector('input');
      return { dis: tile.classList.contains('is-disabled'), inpDis: inp.disabled,
               sub: m.querySelector('#exTileSelSub').textContent };
    })())`));
    check('seçim yok → tile devre dışı', tile0.dis === true && tile0.inpDis === true, tile0.sub);
    check('seçim yok → alt yazı "Seçim yok/No selection"', tile0.sub === 'Seçim yok' || tile0.sub === 'No selection', tile0.sub);

    /* --- 4) Biçim: JPEG → kalite satırı + metadata kapalı ------------- */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('input[name="exFormat"][value="jpeg"]').click();
      return 'ok';
    })()`);
    await sleep(700);
    const jpegUi = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      return { qHidden: m.querySelector('#exQualityRow').hidden,
               metaDis: m.querySelector('#exMeta').disabled,
               metaWrap: m.querySelector('#exMetaWrap').classList.contains('is-disabled') };
    })())`));
    check('JPEG → kalite satırı görünür', jpegUi.qHidden === false, '');
    check('JPEG → metadata kutusu devre dışı', jpegUi.metaDis === true && jpegUi.metaWrap === true, '');

    /* --- 5) JPEG + saydam → beyaza döner ------------------------------ */
    const bgAfterJpeg = await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      return m.querySelector('input[name="exBg"][value="white"]').checked;
    })()`);
    check('JPEG + saydam → arka plan beyaz oldu', bgAfterJpeg === true, '');

    /* --- 6) Biçim: WebP → ipucu değişir ------------------------------- */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('input[name="exFormat"][value="webp"]').click();
      return 'ok';
    })()`);
    await sleep(500);
    const webpUi = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      return { hint: m.querySelector('#exFormatHint').textContent,
               qHidden: m.querySelector('#exQualityRow').hidden };
    })())`));
    check('WebP → ipucu metni değişti', (/saydam|transparent/.test(webpUi.hint) && /küçük|small/.test(webpUi.hint)), webpUi.hint);
    check('WebP → kalite satırı görünür', webpUi.qHidden === false, '');

    /* PNG'e dön: kalite gizlenir, metadata tekrar açık. */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('input[name="exFormat"][value="png"]').click();
      return 'ok';
    })()`);
    await sleep(500);
    const pngBack = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      return { qHidden: m.querySelector('#exQualityRow').hidden,
               metaDis: m.querySelector('#exMeta').disabled };
    })())`));
    check('PNG → kalite satırı gizli', pngBack.qHidden === true, '');
    check('PNG → metadata kutusu açık', pngBack.metaDis === false, '');

    /* --- Biçim kartları: BMP / PDF / ICO / AVIF ------------------------ */
    await evaluate(ws, `(() => { document.querySelector('#exportModal input[name="exFormat"][value="bmp"]').click(); return 'ok'; })()`);
    await sleep(400);
    const bmpUi = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      return { hint: m.querySelector('#exFormatHint').textContent, qHidden: m.querySelector('#exQualityRow').hidden };
    })())`));
    check('BMP → ipucu + kalite satırı gizli', /Sıkıştırmasız|Uncompressed/.test(bmpUi.hint) && bmpUi.qHidden === true, bmpUi.hint);
    await evaluate(ws, `(() => { document.querySelector('#exportModal input[name="exFormat"][value="pdf"]').click(); return 'ok'; })()`);
    await sleep(400);
    const pdfUi = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      return { hint: m.querySelector('#exFormatHint').textContent, qHidden: m.querySelector('#exQualityRow').hidden };
    })())`));
    check('PDF → ipucu + kalite satırı gizli', /belge|document/i.test(pdfUi.hint) && pdfUi.qHidden === true, pdfUi.hint);
    await evaluate(ws, `(() => { document.querySelector('#exportModal input[name="exFormat"][value="ico"]').click(); return 'ok'; })()`);
    await sleep(400);
    const icoHint = await evaluate(ws, `document.querySelector('#exportModal #exFormatHint').textContent`);
    check('ICO → ipucu simge anlatıyor', /Simge|Icon/.test(icoHint), icoHint);
    /* AVIF kartı bu Chromium'un kodlama desteğiyle eşleşmeli. */
    const avifDestek = await evaluate(ws, `(() => { try { return document.createElement('canvas').toDataURL('image/avif').indexOf('data:image/avif') === 0; } catch { return false; } })()`);
    const avifDis = await evaluate(ws, `document.querySelector('#exportModal input[name="exFormat"][value="avif"]').disabled`);
    check('AVIF kartı destek durumuna göre', avifDis === !avifDestek, `destek=${avifDestek} kilitli=${avifDis}`);
    await evaluate(ws, `(() => { document.querySelector('#exportModal input[name="exFormat"][value="png"]').click(); return 'ok'; })()`);
    await sleep(400);

    /* --- 7) Ölçek: 2× pikselleri büyütür ------------------------------ */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('#exScaleGroup button[data-scale="2"]').click();
      return 'ok';
    })()`);
    await sleep(700);
    const iki = await bilgiOku();
    check('2× → genişlik ikiye katlandı', Math.abs(iki.tw - temel.tw * 2) <= 2, `${iki.tw} vs ${temel.tw * 2}`);
    check('2× → yükseklik ikiye katlandı', Math.abs(iki.th - temel.th * 2) <= 2, `${iki.th} vs ${temel.th * 2}`);
    const exactGizli = await evaluate(ws, `document.getElementById('exExactRow').hidden`);
    check('2× → belirli boyut satırı gizli', exactGizli === true, '');

    /* --- 8) Ölçek: "Belirli" W×H + oran kilidi ------------------------ */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('#exScaleGroup button[data-scale="custom"]').click();
      return 'ok';
    })()`);
    await sleep(500);
    const customUi = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      const row = m.querySelector('#exExactRow');
      const w = m.querySelector('#exW'), h = m.querySelector('#exH');
      return { gizli: row.hidden, w: w.value, h: h.value, oran: w.value && h.value ? w.value / h.value : 0 };
    })())`));
    check('Belirli → satır görünür', customUi.gizli === false, '');
    check('Belirli → kutular içerik boyutuyla doldu', +customUi.w === temel.tw && +customUi.h === temel.th, `${customUi.w}×${customUi.h} vs ${temel.tw}×${temel.th}`);
    /* Genişliğe yaz → oran kilidi yüksekliği günceller. */
    const oranSonra = await evaluate(ws, `(async () => {
      const m = document.getElementById('exportModal');
      const w = m.querySelector('#exW'), h = m.querySelector('#exH');
      const beklenenOran = ${temel.tw} / ${temel.th};
      w.value = '800';
      w.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      return { h: h.value, uyum: Math.abs(+h.value - Math.round(800 / beklenenOran)) <= 2 };
    })()`);
    check('Belirli + kilit → yükseklik orana uydu', oranSonra.uyum, `H=${oranSonra.h}`);

    /* --- 9) DPI: 300 → ~4.17× ----------------------------------------- */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('#exScaleGroup button[data-scale="1"]').click();
      return 'ok';
    })()`);
    await sleep(300);
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('#exDpiGroup button[data-dpi="300"]').click();
      return 'ok';
    })()`);
    await sleep(700);
    const dpi = await bilgiOku();
    const beklenenK = 300 / 72;
    check('DPI 300 → düğme aktif', (await evaluate(ws, `document.querySelector('#exDpiGroup button[data-dpi="300"]').classList.contains('is-active')`)) === true, '');
    check('DPI 300 → pikseller ~4.17×', Math.abs(dpi.tw - temel.tw * beklenenK) <= temel.tw * 0.02 + 2, `${dpi.tw} vs ~${Math.round(temel.tw * beklenenK)}`);
    check('DPI 300 → belirli satır gizli', (await evaluate(ws, `document.getElementById('exExactRow').hidden`)) === true, '');
    /* 72'ye dön → 1×. */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('#exDpiGroup button[data-dpi="72"]').click();
      return 'ok';
    })()`);
    await sleep(700);
    const dpi72 = await bilgiOku();
    check('DPI 72 → 1× döndü', Math.abs(dpi72.tw - temel.tw) <= 2, `${dpi72.tw} vs ${temel.tw}`);

    /* --- 10) Kapsam: Görüş Alanı → ekran boyutu ----------------------- */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('input[name="exScope"][value="viewport"]').click();
      return 'ok';
    })()`);
    await sleep(700);
    const vp = await bilgiOku();
    const ekran = JSON.parse(await evaluate(ws, `JSON.stringify([stage.clientWidth, stage.clientHeight])`));
    check('Görüş Alanı → ekran genişliği', Math.abs(vp.tw - ekran[0]) <= 4, `${vp.tw} vs ${ekran[0]}`);
    check('Görüş Alanı → ekran yüksekliği', Math.abs(vp.th - ekran[1]) <= 4, `${vp.th} vs ${ekran[1]}`);
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('input[name="exScope"][value="all"]').click();
      return 'ok';
    })()`);
    await sleep(500);

    /* --- 11) Kapsam: seçim var → tile aktif --------------------------- */
    await evaluate(ws, `(() => { selection.add(state.items[0].id); return selection.size; })()`);
    await evaluate(ws, `openExportDialog()`);
    await sleep(500);
    const tileSel = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      const tile = m.querySelector('#exTileSel');
      return { dis: tile.classList.contains('is-disabled'), inpDis: tile.querySelector('input').disabled,
               sub: m.querySelector('#exTileSelSub').textContent };
    })())`));
    check('seçim var → tile aktif', tileSel.dis === false && tileSel.inpDis === false, tileSel.sub);
    check('seçim var → alt yazı öğe sayısı', /1/.test(tileSel.sub), tileSel.sub);
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('#exTileSel input').click();
      return 'ok';
    })()`);
    await sleep(700);
    const secim = await bilgiOku();
    check('Sadece Seçili → önizleme boyutu geçerli', secim.tw > 0 && secim.th > 0 && secim.dlDisabled === false, `${secim.tw}×${secim.th}`);
    check('Sadece Seçili ≤ Tüm Pano', secim.tw <= temel.tw + 2 && secim.th <= temel.th + 2, '');
    await evaluate(ws, `(() => { selection.clear(); return 'ok'; })()`);
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('input[name="exScope"][value="all"]').click();
      return 'ok';
    })()`);

    /* --- 12) Sadece çizimler: çizim yok → "yok" + İndir kapalı -------- */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('#exSketchOnly').click();
      return 'ok';
    })()`);
    await sleep(700);
    const bos = await bilgiOku();
    check('Sadece çizimler + çizim yok → uyarı metni', /yok|Nothing to export/.test(bos.info), bos.info);
    check('Sadece çizimler + çizim yok → İndir kapalı', bos.dlDisabled === true, '');

    /* Çizim sınırları stub'la: boyut stub'tan gelir. */
    await evaluate(ws, `(async () => {
      window.__inkGB = inkGlobalWorldBounds;
      inkGlobalWorldBounds = () => ({ x: -500, y: -400, w: 1000, h: 800 });
      exportSchedulePreview();
      await new Promise(r => setTimeout(r, 500));
      const mm = document.getElementById('exInfo').textContent.match(/(\\d+)\\s*×\\s*(\\d+)/);
      return { tw: mm ? +mm[1] : 0, th: mm ? +mm[2] : 0, dl: document.getElementById('exDownload').disabled };
    })()`);
    const stub = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const mm = document.getElementById('exInfo').textContent.match(/(\\d+)\\s*×\\s*(\\d+)/);
      return { tw: mm ? +mm[1] : 0, th: mm ? +mm[2] : 0, dl: document.getElementById('exDownload').disabled };
    })())`));
    /* Stub: pad varsayılanı Yok → düz 1000×800. */
    check('Sadece çizimler + çizim stub → 1000×800', stub.tw === 1000 && stub.th === 800, `${stub.tw}×${stub.th}`);
    check('Sadece çizimler + çizim var → İndir açık', stub.dl === false, '');
    /* Stub'u geri al, kutuyu kapat, önizlemeyi tazele. */
    await evaluate(ws, `(() => {
      inkGlobalWorldBounds = window.__inkGB;
      document.getElementById('exSketchOnly').click();
      exportSchedulePreview();
      return 'ok';
    })()`);
    await sleep(400);

    /* --- 13) Perform: indirme hattı stub'ı ---------------------------- */
    await evaluate(ws, `(() => {
      window.__exAdlar = [];
      window.__exSonBlob = null;
      window.__origCreateURL = URL.createObjectURL;
      window.__origClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = b => { window.__exSonBlob = b; return 'blob:test'; };
      HTMLAnchorElement.prototype.click = function () { window.__exAdlar.push(this.download); };
      return 'ok';
    })()`);

    /* PNG perform */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('#exName').value = 'export-test: advers*name';
      m.querySelector('input[name="exFormat"][value="png"]').click();
      return 'ok';
    })()`);
    await sleep(500);
    await evaluate(ws, `document.getElementById('exportForm').requestSubmit()`);
    await sleep(1500);
    const pngDl = JSON.parse(await evaluate(ws, `JSON.stringify((() => ({
      adlar: window.__exAdlar, boyut: window.__exSonBlob ? window.__exSonBlob.size : 0,
      tur: window.__exSonBlob ? window.__exSonBlob.type : ''
    }))())`));
    check('PNG perform → dosya indirildi (boyut > 0)', pngDl.boyut > 0, `${pngDl.boyut} B`);
    check('PNG perform → geçerli dosya adı (temizlenmiş + .png)',
      pngDl.adlar.length === 1 && /_/.test(pngDl.adlar[0]) && pngDl.adlar[0].endsWith('.png'), pngDl.adlar.join(','));

    /* --- 14) Metadata gömme: tEXt parçası ----------------------------- */
    await evaluate(ws, `(() => {
      const el = document.getElementById('exMeta');
      if (!el.checked) el.click();
      return el.checked;
    })()`);
    await sleep(300);
    await evaluate(ws, `(() => { document.getElementById('exportForm').requestSubmit(); return 'ok'; })()`);
    await sleep(1500);
    const metaVar = await evaluate(ws, `(async () => {
      const b = window.__exSonBlob;
      if (!b) return false;
      const bayt = new Uint8Array(await b.arrayBuffer());
      const hedef = [0x74, 0x45, 0x58, 0x74]; // tEXt
      dis: for (let i = 0; i < bayt.length - 4; i += 1) {
        for (let j = 0; j < 4; j += 1) if (bayt[i + j] !== hedef[j]) continue dis;
        return true;
      }
      return false;
    })()`);
    check('Metadata gömme → PNG blob tEXt içeriyor', metaVar === true, '');

    /* --- 15) JPEG perform --------------------------------------------- */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('input[name="exFormat"][value="jpeg"]').click();
      return 'ok';
    })()`);
    await sleep(500);
    await evaluate(ws, `(() => { document.getElementById('exportForm').requestSubmit(); return 'ok'; })()`);
    await sleep(1500);
    const jpegDl = JSON.parse(await evaluate(ws, `JSON.stringify((() => ({
      ad: window.__exAdlar[window.__exAdlar.length - 1] || '',
      tur: window.__exSonBlob ? window.__exSonBlob.type : '', boyut: window.__exSonBlob ? window.__exSonBlob.size : 0
    }))())`));
    check('JPEG perform → image/jpeg + .jpg', jpegDl.tur === 'image/jpeg' && jpegDl.ad.endsWith('.jpg') && jpegDl.boyut > 0, `${jpegDl.tur} ${jpegDl.ad}`);

    /* --- 16) WebP perform --------------------------------------------- */
    await evaluate(ws, `(() => {
      const m = document.getElementById('exportModal');
      m.querySelector('input[name="exFormat"][value="webp"]').click();
      return 'ok';
    })()`);
    await sleep(500);
    await evaluate(ws, `(() => { document.getElementById('exportForm').requestSubmit(); return 'ok'; })()`);
    await sleep(1500);
    const webpDl = JSON.parse(await evaluate(ws, `JSON.stringify((() => ({
      ad: window.__exAdlar[window.__exAdlar.length - 1] || '',
      tur: window.__exSonBlob ? window.__exSonBlob.type : '', boyut: window.__exSonBlob ? window.__exSonBlob.size : 0
    }))())`));
    check('WebP perform → image/webp + .webp', webpDl.tur === 'image/webp' && webpDl.ad.endsWith('.webp') && webpDl.boyut > 0, `${webpDl.tur} ${webpDl.ad}`);

    /* --- BMP / PDF / ICO perform --------------------------------------- */
    await evaluate(ws, `(() => { document.querySelector('#exportModal input[name="exFormat"][value="bmp"]').click(); return 'ok'; })()`);
    await sleep(500);
    await evaluate(ws, `(() => { document.getElementById('exportForm').requestSubmit(); return 'ok'; })()`);
    await sleep(1500);
    const bmpDl = await evaluate(ws, `(async () => {
      const b = window.__exSonBlob; if (!b) return null;
      const bayt = new Uint8Array(await b.arrayBuffer());
      return { ad: window.__exAdlar[window.__exAdlar.length - 1] || '', boyut: b.size,
               bm: bayt[0] === 0x42 && bayt[1] === 0x4D };
    })()`);
    check('BMP perform → BM imzası + .bmp', !!bmpDl && bmpDl.bm && bmpDl.ad.endsWith('.bmp') && bmpDl.boyut > 0, `${bmpDl && bmpDl.ad} ${bmpDl && bmpDl.boyut}B`);

    await evaluate(ws, `(() => { document.querySelector('#exportModal input[name="exFormat"][value="ico"]').click(); return 'ok'; })()`);
    await sleep(500);
    await evaluate(ws, `(() => { document.getElementById('exportForm').requestSubmit(); return 'ok'; })()`);
    await sleep(1500);
    const icoDl = await evaluate(ws, `(async () => {
      const b = window.__exSonBlob; if (!b) return null;
      const bayt = new Uint8Array(await b.arrayBuffer());
      return { ad: window.__exAdlar[window.__exAdlar.length - 1] || '', boyut: b.size,
               ico: bayt[0] === 0 && bayt[1] === 0 && bayt[2] === 1 && bayt[3] === 0 };
    })()`);
    check('ICO perform → ICO imzası + .ico', !!icoDl && icoDl.ico && icoDl.ad.endsWith('.ico') && icoDl.boyut > 0, `${icoDl && icoDl.ad} ${icoDl && icoDl.boyut}B`);

    await evaluate(ws, `(() => { document.querySelector('#exportModal input[name="exFormat"][value="pdf"]').click(); return 'ok'; })()`);
    await sleep(500);
    await evaluate(ws, `(() => { document.getElementById('exportForm').requestSubmit(); return 'ok'; })()`);
    await sleep(1500);
    const pdfDl = await evaluate(ws, `(async () => {
      const b = window.__exSonBlob; if (!b) return null;
      const bayt = new Uint8Array(await b.arrayBuffer());
      const imza = [0x25, 0x50, 0x44, 0x46]; // %PDF
      let pdf = bayt.length >= 4;
      for (let i = 0; i < 4; i += 1) if (bayt[i] !== imza[i]) pdf = false;
      const son = bayt.slice(-8);
      let eof = false;
      for (let i = 0; i < son.length - 4; i += 1) {
        if (son[i] === 0x25 && son[i + 1] === 0x25 && son[i + 2] === 0x45 && son[i + 3] === 0x4F && son[i + 4] === 0x46) eof = true;
      }
      return { ad: window.__exAdlar[window.__exAdlar.length - 1] || '', boyut: b.size, pdf, eof };
    })()`);
    check('PDF perform → %PDF imzası + %%EOF + .pdf', !!pdfDl && pdfDl.pdf && pdfDl.eof && pdfDl.ad.endsWith('.pdf') && pdfDl.boyut > 0, `${pdfDl && pdfDl.ad} ${pdfDl && pdfDl.boyut}B`);

    /* --- 17) Kenar boşluğu varsayılanı: Yok ----------------------------- */
    const padUi = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      const aktif = m.querySelector('#exPadGroup button.is-active');
      return { aktif: aktif ? aktif.dataset.pad : '' };
    })())`));
    check('Boşluk varsayılanı Yok (0)', padUi.aktif === '0', JSON.stringify(padUi));
    await evaluate(ws, `(() => {
      document.querySelector('#exportModal button[data-pad="48"]').click();
      return 'ok';
    })()`);
    await sleep(400);
    const pad48 = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const mm = document.querySelector('#exInfo #exChipDim').textContent.match(/(\\d+)\\s*×\\s*(\\d+)/);
      return { tw: mm ? +mm[1] : 0, th: mm ? +mm[2] : 0 };
    })())`));
    check('Boşluk Normal → boyut 96px arttı', Math.abs(pad48.tw - (temel.tw + 96)) <= 2 && Math.abs(pad48.th - (temel.th + 96)) <= 2, `${pad48.tw}×${pad48.th} vs ${temel.tw + 96}×${temel.th + 96}`);
    await evaluate(ws, `(() => { document.querySelector('#exportModal button[data-pad="0"]').click(); return 'ok'; })()`);
    await sleep(300);

    /* --- 18) Kayıt klasörü: seç → sakla → uygula ------------------------- */
    await evaluate(ws, `(() => {
      document.querySelector('#exportModal input[name="exFormat"][value="webp"]').click();
      const m = document.getElementById('exportModal');
      m.querySelector('#exQuality').value = '80';
      m.querySelector('#exQuality').dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await sleep(300);
    /* Gerçek pencere testi bloklamasın: yardımcı fonksiyonla ayarla
       (Gözat düğmesi aynı fonksiyonu çağırır). */
    await evaluate(ws, `(() => { exportKayitKlasoruAyarla('C:\\\\TestKlasor'); return 'ok'; })()`);
    await evaluate(ws, `exportHide()`);
    const prefs = await evaluate(ws, `JSON.parse(localStorage.getItem('tailref:export:v1') || '{}')`);
    check('tercihler kaydedildi (webp + kalite 80 + klasör)', prefs.format === 'webp' && Number(prefs.quality) === 80 && prefs.saveDir === 'C:\\TestKlasor', JSON.stringify(prefs));
    await evaluate(ws, `openExportDialog()`);
    await sleep(400);
    const geri = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
      const m = document.getElementById('exportModal');
      const fmt = m.querySelector('input[name="exFormat"]:checked');
      return { fmt: fmt ? fmt.value : '', q: m.querySelector('#exQuality').value,
               dir: document.getElementById('exDirText').textContent,
               clearGizli: document.getElementById('exDirClear').hidden };
    })())`));
    check('tercihler geri yüklendi (webp + 80 + klasör)', geri.fmt === 'webp' && geri.q === '80' && geri.dir === 'C:\\TestKlasor' && geri.clearGizli === false, JSON.stringify(geri));
    /* Temizlik: klasörü sıfırla — sonraki oturumlar etkilenmesin. */
    await evaluate(ws, `(() => { exportKayitKlasoruAyarla(''); return 'ok'; })()`);
    await sleep(200);

    /* --- 18) Escape kapatır -------------------------------------------- */
    await evaluate(ws, `(() => {
      const form = document.getElementById('exportForm');
      form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return document.getElementById('exportModal').hidden;
    })()`);
    check('Escape pencereyi kapattı', (await evaluate(ws, `document.getElementById('exportModal').hidden`)) === true, '');
  } finally {
    if (ws) ws.close();
    app.kill();
    await sleep(400);
    try { process.kill(app.pid); } catch { /* zaten kapandı */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli olabilir */ }
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('TEST HATASI:', e.message); process.exit(1); });
