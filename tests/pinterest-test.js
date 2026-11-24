'use strict';

/* Pinterest paneli uçtan uca testi.

   Gerçek Pinterest'e gitmeden, yerel bir fixture sayfasıyla şunları doğrular:
   • Pinterest uygulamanın İÇİNDE (<webview>) açılıyor, ayrı pencere değil.
   • Konuk sayfaya enjekte edilen "Tahtaya ekle" düğmesi görünüyor.
   • Tek tıkla görsel indirilip tahtaya ekleniyor.
   • Paneldeki bağlantı alanından da görsel eklenebiliyor.

   Kullanım: node scripts/pinterest-test.js
   Uygulama izole veri klasöründe ve ayrı portta çalışır. */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 5195;
/* Üretim varsayılanı 5194 ile ÇAKIŞMASIN (uygulama açıkken fixture
   bağlanamıyordu; kullanıcıya da "listen EACCES" hatası çıkıyordu). */
const FIXTURE_PORT = 5412;
const DEBUG_PORT = 9335;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Bu kontrol Electron gerektirmez; kötü niyetli alan adlarının panele
   sokulmadığını doğrular. */
const { isPinterestUrl } = require(path.join(ROOT, 'src', 'main', 'pinterest.js'));

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
  setTimeout(() => reject(new Error('eval zaman aşımı')), 30000);
});

async function waitFor(fn, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(300);
  }
  throw new Error(`${label} zaman aşımı${lastError ? ' (' + lastError.message + ')' : ''}`);
}

async function findTarget(port, predicate) {
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  return list.find(t => t.url.includes(`:${port}`) && (!predicate || predicate(t))) || null;
}

function fixturePage() {
  return `<!doctype html>
<html lang="tr">
<head><meta charset="utf-8"><title>Pinterest fixture</title>
<style>body{margin:0;background:#101014;font-family:system-ui}main{padding:32px;display:flex;flex-direction:column;align-items:center;gap:12px}
a{display:block;width:240px}.pin{width:240px;height:240px;object-fit:cover;display:block;border-radius:16px}
.row{display:flex;gap:10px}.row img{width:180px;height:180px;object-fit:cover;border-radius:12px}</style>
</head>
<body><main>
  <a href="/pin/1"><img class="pin" src="http://127.0.0.1:${APP_PORT}/assets/favicon-light.png" alt="pinterest-test-gorseli"></a>
  <div class="row">
    <img src="http://127.0.0.1:${FIXTURE_PORT}/pin1.png" alt="toplu-1">
    <img src="http://127.0.0.1:${FIXTURE_PORT}/pin2.png" alt="toplu-2">
    <img src="http://127.0.0.1:${FIXTURE_PORT}/pin3.png" alt="toplu-3">
  </div>
</main></body></html>`;
}

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (/^\/pin\d?\.png$/.test(request.url || '')) {
        const bytes = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'favicon-dark.png'));
        response.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.length });
        response.end(bytes);
        return;
      }
      const html = Buffer.from(fixturePage(), 'utf8');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length });
      response.end(html);
    });
    server.once('error', reject);
    server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve(server));
  });
}

function launch(userDataDir, saveDir) {
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
    TailRef_PINTEREST_URL: `http://127.0.0.1:${FIXTURE_PORT}/`,
    TailRef_DOWNLOAD_DIR: saveDir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(electronPath(), ['.', `--remote-debugging-port=${DEBUG_PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-pinterest-'));
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-pinterest-saves-'));
  const fixture = await startFixtureServer();
  const app = launch(userDataDir, saveDir);
  let mainWs = null;
  let guestWs = null;
  let detWs = null;
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  const allowedPinterest = [
    'https://www.pinterest.com/pin/1/',
    'https://tr.pinterest.com/',
    'https://pinterest.co.uk/',
    'https://pin.it/abc123',
  ];
  const deniedPinterest = [
    'https://pinterest.saldirgan.com/',
    'https://saldirganpinterest.com/',
    'https://pinterest.com.saldirgan.com/',
    'https://pinterest.xyz/',
    'http://www.pinterest.com/',
  ];
  check('Pinterest alan adı beyaz listesi taklitleri reddediyor',
    allowedPinterest.every(url => isPinterestUrl(url))
      && deniedPinterest.every(url => !isPinterestUrl(url)),
    `${allowedPinterest.length} izin / ${deniedPinterest.length} ret`);

  try {
    const mainTarget = await waitFor(() => findTarget(APP_PORT, t => t.type === 'page'), 'ana pencere');
    mainWs = await connect(mainTarget.webSocketDebuggerUrl);
    await waitFor(async () => evaluate(mainWs,
      "typeof state !== 'undefined' && typeof appReady !== 'undefined' && appReady === true"), 'renderer hazır');

    // Panel menüden açılıyor mu?
    await evaluate(mainWs, "document.getElementById('btnPinterest').click()");
    await sleep(700);
    const panelState = JSON.parse(await evaluate(mainWs, `(() => {
      const panel = document.getElementById('pinterestPanel');
      const view = document.getElementById('pinterestView');
      const rect = view ? view.getBoundingClientRect() : null;
      return JSON.stringify({
        open: !!panel && !panel.hidden,
        tag: view ? view.tagName.toLowerCase() : '',
        rect: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
        windows: 0
      });
    })()`));
    check('Pinterest paneli açıldı', panelState.open === true);
    check('Pinterest uygulama içinde <webview> ile açılıyor', panelState.tag === 'webview'
      && panelState.rect && panelState.rect[0] > 300 && panelState.rect[1] > 200,
      `${panelState.tag} ${JSON.stringify(panelState.rect)}`);

    // Oturum/giriş akışı: test profili yeni olduğu için giriş yok; fixture modunda
    // panel yine de doğrudan yerel sayfayı açmalı ve "giriş yap" uyarısı vermemeli.
    const cfg = JSON.parse(await evaluate(mainWs, `(async () => {
      const c = await window.tailref.pinterestConfig();
      const s = await window.tailref.pinterestSession();
      return JSON.stringify({ mode: c.mode, loggedIn: c.loggedIn, startUrl: c.startUrl, loginUrl: c.loginUrl, sessionLoggedIn: s.loggedIn, sessionMode: s.mode });
    })()`));
    check('giriş durumu okunuyor (yeni profil → giriş yok)', cfg.loggedIn === false && cfg.sessionLoggedIn === false,
      `loggedIn=${cfg.loggedIn}`);
    check('giriş sayfası adresi hazır', cfg.loginUrl === 'https://www.pinterest.com/login/', cfg.loginUrl);
    check('test modunda fixture açılıyor', cfg.mode === 'fixture'
      && cfg.startUrl.includes(`:${FIXTURE_PORT}`), `${cfg.mode} ${cfg.startUrl}`);
    await sleep(400);
    const readyText = await evaluate(mainWs, "document.getElementById('pinterestStatus').textContent");
    check('giriş uyarısı fixture modunda gösterilmiyor', !readyText.includes('giriş yap'), readyText);

    // Diske kaydetme: tercih açılıyor (testte TailRef_DOWNLOAD_DIR geçici klasör)
    const saveOn = await evaluate(mainWs, `(() => {
      const box = document.getElementById('pinterestSaveDisk');
      if (!box) return false;
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      return true;
    })()`);
    check('diske kaydet tercihi açılabiliyor', saveOn === true);

    // Konuk sayfa yüklendi ve düğme enjekte edildi mi?
    const guestTarget = await waitFor(async () => findTarget(FIXTURE_PORT, t => t.type === 'webview' || t.type === 'page'),
      'Pinterest konuk sayfası');
    guestWs = await connect(guestTarget.webSocketDebuggerUrl);
    await waitFor(async () => evaluate(guestWs, "!!document.getElementById('tailref-pick')"), 'enjekte edilen düğme');
    const image = JSON.parse(await evaluate(guestWs, `(() => {
      const img = document.querySelector('img.pin');
      if (!img) return 'null';
      const r = img.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`));
    check('konuk sayfa ve görsel hazır', !!image, image ? `tıklama ${image.x},${image.y}` : '');

    await evaluate(guestWs, `document.dispatchEvent(new MouseEvent('mousemove', {
      clientX: ${image.x}, clientY: ${image.y}, bubbles: true
    }))`);
    const pill = await waitFor(async () => {
      const raw = await evaluate(guestWs, `(() => {
        const b = document.getElementById('tailref-pick');
        return b ? JSON.stringify({ hidden: b.hidden, text: b.textContent }) : 'null';
      })()`);
      if (raw === 'null') return null;
      const value = JSON.parse(raw);
      return value.hidden ? null : value;
    }, 'tahtaya ekle düğmesi');
    check('görselin üzerinde "Tahtaya ekle/Add to board" düğmesi çıktı',
      /Tahtaya ekle|Add to board/.test(pill.text), pill.text);

    // Tek tıkla ekle
    await evaluate(guestWs, "document.getElementById('tailref-pick').click()");
    await waitFor(async () => (await evaluate(mainWs, "state.items.filter(i => i.kind === 'image').length")) === 1,
      'görselin tahtaya eklenmesi');
    const firstItem = JSON.parse(await evaluate(mainWs, `(() => {
      const it = state.items.find(i => i.kind === 'image');
      return JSON.stringify(it ? { w: Math.round(it.w), h: Math.round(it.h) } : null);
    })()`));
    check('tek tıkla görsel tahtaya eklendi', !!firstItem && firstItem.w > 50 && firstItem.h > 50,
      firstItem ? `${firstItem.w}×${firstItem.h}` : '');

    await waitFor(async () => (await evaluate(mainWs,
      "document.getElementById('pinterestStatus').textContent")).includes('added') ||
      (await evaluate(mainWs, "document.getElementById('pinterestStatus').textContent")).includes('eklendi'), 'panel durumu');
    check('panel durumu güncellendi', true, await evaluate(mainWs, "document.getElementById('pinterestStatus').textContent"));

    // Bağlantı alanından ekleme
    await evaluate(mainWs, `(() => {
      const input = document.getElementById('pinterestUrl');
      input.value = 'http://127.0.0.1:${FIXTURE_PORT}/pin.png';
      document.getElementById('pinterestAddUrl').click();
      return true;
    })()`);
    await waitFor(async () => (await evaluate(mainWs, "state.items.filter(i => i.kind === 'image').length")) === 2,
      'bağlantıdan görsel ekleme');
    check('bağlantı alanından görsel eklendi', true);

    const savedAfterUrl = fs.readdirSync(saveDir).filter(name => /\.(png|jpg|jpeg|webp|avif|gif)$/i.test(name));
    check('bağlantıdan eklenen görsel diske kaydedildi', savedAfterUrl.length === 2, `${savedAfterUrl.length} dosya`);
    const urlStatus = await evaluate(mainWs, "document.getElementById('pinterestStatus').textContent");
    check('durum satırı disk kaydını bildiriyor', urlStatus.includes('diske kaydedildi') || urlStatus.includes('saved to disk'), urlStatus);

    // Görünenleri topluca ekleme
    await evaluate(mainWs, "document.getElementById('pinterestAddVisible').click()");
    await waitFor(async () => (await evaluate(mainWs, "state.items.filter(i => i.kind === 'image').length")) === 5,
      'görünenlerin topluca eklenmesi');
    const batchStatus = await evaluate(mainWs, "document.getElementById('pinterestStatus').textContent");
    check('görünen 3 görsel tek düğmeyle eklendi', /3 görsel|3 images/.test(batchStatus), batchStatus);

    // Aynı görseller tekrar eklenmemeli
    await evaluate(mainWs, "document.getElementById('pinterestAddVisible').click()");
    await waitFor(async () => (await evaluate(mainWs, "document.getElementById('pinterestStatus').textContent")).includes('Yeni görsel yok') ||
      (await evaluate(mainWs, "document.getElementById('pinterestStatus').textContent")).includes('No new images'),
      'tekrar ekleme engeli');
    const afterRepeat = await evaluate(mainWs, "state.items.filter(i => i.kind === 'image').length");
    check('aynı görseller ikinci kez eklenmiyor', afterRepeat === 5, `öğe sayısı ${afterRepeat}`);

    const savedAfterBatch = fs.readdirSync(saveDir).filter(name => /\.(png|jpg|jpeg|webp|avif|gif)$/i.test(name));
    const uniqueNames = new Set(savedAfterBatch);
    check('toplu eklenen görseller de diske kaydedildi', savedAfterBatch.length === 5 && uniqueNames.size === 5,
      `${savedAfterBatch.length} dosya`);

    // Kontrollü popup: giriş sağlayıcısı dışındaki pencereler açılmamalı
    const targetsBefore = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).length;
    await evaluate(guestWs, "String(window.open('https://example.com/', '_blank'))");
    await sleep(900);
    const targetsAfter = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).length;
    check('giriş sağlayıcısı dışındaki popup engellendi', targetsAfter <= targetsBefore,
      `${targetsBefore} → ${targetsAfter}`);

    // ---- ayrı pencere: konuk sayfa orada da çalışmalı ----
    await evaluate(mainWs, "pinterestSeen.clear()");
    const detached = JSON.parse(await evaluate(mainWs, `(async () => {
      const panel = document.getElementById('pinterestPanel');
      const ok = await detachPanelToWindow(panel);
      return JSON.stringify({ ok, flag: panel.dataset.detached || '', hidden: panel.hidden });
    })()`));
    const detTarget = await waitFor(() => findTarget(APP_PORT, t => t.url.includes('/panel.html')),
      'ayrı panel penceresi');
    detWs = await connect(detTarget.webSocketDebuggerUrl);
    await waitFor(async () => evaluate(mainWs, "document.getElementById('pinterestPanel').hidden"),
      'panelin uygulama içinde gizlenmesi');
    const detGuestUrl = await waitFor(async () => {
      const url = await evaluate(detWs, `(() => {
        const v = document.querySelector('webview');
        if (!v) return '';
        try { return v.getURL() || ''; } catch { return ''; }
      })()`);
      return url.includes(`:${FIXTURE_PORT}`) ? url : '';
    }, 'ayrı penceredeki Pinterest konuk sayfası');
    check('Pinterest ayrı pencerede <webview> ile açıldı',
      detached.ok && detached.flag === '1' && !!detGuestUrl,
      JSON.stringify({ detached, detGuestUrl }));

    const guestEval = expression => evaluate(detWs, `(async () => {
      const v = document.querySelector('webview');
      if (!v) return '';
      return v.executeJavaScript(${JSON.stringify(expression)});
    })()`);

    await guestEval(`(() => {
      const img = document.querySelector('img.pin');
      if (!img) return 'null';
      const r = img.getBoundingClientRect();
      document.dispatchEvent(new MouseEvent('mousemove', {
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
        bubbles: true
      }));
      return 'ok';
    })()`);
    const detPill = await waitFor(async () => {
      const raw = await guestEval(`(() => {
        const b = document.getElementById('tailref-pick');
        return b ? JSON.stringify({ hidden: b.hidden, text: b.textContent }) : 'null';
      })()`);
      if (!raw || raw === 'null') return null;
      const value = JSON.parse(raw);
      return value.hidden ? null : value;
    }, 'ayrı pencerede tahtaya ekle düğmesi');
    check('ayrı penceredeki konuk sayfada "Tahtaya ekle/Add to board" düğmesi çıktı',
      /Tahtaya ekle|Add to board/.test(detPill.text), detPill.text);

    await guestEval("(() => { const b = document.getElementById('tailref-pick'); if (b) b.click(); return 'ok'; })()");
    await waitFor(async () => (await evaluate(mainWs, "state.items.filter(i => i.kind === 'image').length")) === 6,
      'ayrı pencereden görsel ekleme');
    const detReply = await waitFor(async () => {
      const raw = await guestEval(`(() => {
        const b = document.getElementById('tailref-pick');
        return b ? JSON.stringify({ text: b.textContent }) : 'null';
      })()`);
      if (!raw || raw === 'null') return null;
      const value = JSON.parse(raw);
      return /Eklendi|Added/.test(value.text) ? value : null;
    }, 'ayrı penceredeki ekleme yanıtı');
    check('ayrı pencereden seçilen görsel tahtaya eklendi ve konuk yanıt aldı',
      /Eklendi|Added/.test(detReply.text), detReply.text);

    await evaluate(detWs, "document.getElementById('pinterestAddVisible').click()");
    const detBatchStatus = await waitFor(async () => {
      const text = await evaluate(detWs, "document.getElementById('pinterestStatus').textContent");
      return /3 görsel|3 images/.test(text) ? text : '';
    }, 'ayrı pencerede toplu ekleme');
    check('ayrı pencerede "Görünenleri ekle" çalışıyor', /3 görsel|3 images/.test(detBatchStatus), detBatchStatus);

    await evaluate(mainWs, "window.tailref.closePanelWindow('pinterestPanel', true)");
    await sleep(1400);
    const docked = JSON.parse(await evaluate(mainWs, `JSON.stringify({
      flag: document.getElementById('pinterestPanel').dataset.detached || '',
      visible: !document.getElementById('pinterestPanel').hidden,
    })`));
    const dockedUrl = await waitFor(async () => {
      const url = await evaluate(mainWs, `(() => {
        try { return document.getElementById('pinterestView').getURL(); } catch { return ''; }
      })()`);
      return url.includes(`:${FIXTURE_PORT}`) ? url : '';
    }, 'geri takılan Pinterest sayfası');
    check('Pinterest paneli geri takıldı ve aynı sayfada devam ediyor',
      docked.flag !== '1' && docked.visible && !!dockedUrl,
      JSON.stringify({ docked, dockedUrl }));

    // ---- ayrı penceredeki × uygulama içi kapatma gibi davranmalı ----
    /* Taşımayı beklemeden başlat, sonucu ayrı ölç: hang'in çağrı içinde mi
       yoksa sonrasında mı olduğunu ayırır. */
    const detachKick = await evaluate(mainWs, `(() => {
      window.__detach2State = 'kick';
      Promise.resolve()
        .then(() => detachPanelToWindow(document.getElementById('pinterestPanel')))
        .then(r => { window.__detach2State = 'done:' + r; })
        .catch(e => { window.__detach2State = 'err:' + (e && e.message); });
      return 'kicked';
    })()`);
    if (detachKick !== 'kicked') throw new Error('ikinci taşıma başlatılamadı');
    const detach2State = await waitFor(async () => {
      const s = await evaluate(mainWs, 'window.__detach2State');
      return s && s !== 'kick' ? s : '';
    }, 'ikinci ayrı panel taşıma');
    if (detach2State !== 'done:true') {
      throw new Error('ikinci taşıma başarısız: ' + detach2State);
    }
    const detTarget2 = await waitFor(() => findTarget(APP_PORT, t => t.url.includes('/panel.html')),
      'ikinci ayrı panel penceresi');
    detWs = await connect(detTarget2.webSocketDebuggerUrl);
    await waitFor(async () => {
      const url = await evaluate(detWs, `(() => {
        const v = document.querySelector('webview');
        if (!v) return '';
        try { return v.getURL() || ''; } catch { return ''; }
      })()`);
      return url.includes(`:${FIXTURE_PORT}`) ? url : '';
    }, 'ikinci ayrı penceredeki konuk sayfa');
    await evaluate(detWs, `(async () => {
      const v = document.querySelector('webview');
      await v.executeJavaScript("location.href = '/pin/1'");
      return true;
    })()`);
    await waitFor(async () => {
      const url = await evaluate(mainWs, 'pinterestDetachedUrl');
      return url && url.includes('/pin/1') ? url : '';
    }, 'ayrı pencerede gezinmenin ana pencereye bildirilmesi');
    await evaluate(detWs, "document.getElementById('btnPinterestClose').click()");
    await waitFor(async () => {
      const hidden = await evaluate(mainWs,
        "document.getElementById('pinterestPanel').hidden && document.getElementById('pinterestPanel').dataset.detached !== '1'");
      return hidden === true;
    }, 'ayrı penceredeki × ile kapanma');
    const closedUrl = await waitFor(async () => {
      const url = await evaluate(mainWs, `(() => {
        try { return document.getElementById('pinterestView').getURL(); } catch { return ''; }
      })()`);
      return url.includes('/pin/1') ? url : '';
    }, 'kapatılan panelin sayfa konumu');
    await evaluate(mainWs, "document.getElementById('btnPinterest').click()");
    await sleep(500);
    const reopened = JSON.parse(await evaluate(mainWs, `JSON.stringify({
      visible: !document.getElementById('pinterestPanel').hidden,
      url: (() => { try { return document.getElementById('pinterestView').getURL(); } catch { return ''; } })(),
    })`));
    check('ayrı penceredeki × kapatıyor; menüden açınca aynı sayfa geri geliyor',
      reopened.visible && !!closedUrl && reopened.url.includes('/pin/1'),
      JSON.stringify({ closedUrl, reopened }));
  } catch (error) {
    console.error('TEST HATASI:', error.message);
    fail++;
  } finally {
    if (detWs) { try { detWs.close(); } catch { /* sessiz */ } }
    if (guestWs) { try { guestWs.close(); } catch { /* sessiz */ } }
    if (mainWs) { try { mainWs.close(); } catch { /* sessiz */ } }
    try { fixture.close(); } catch { /* sessiz */ }
    if (app.exitCode === null) {
      app.kill();
      await sleep(500);
      try { process.kill(app.pid); } catch { /* kapandı */ }
    }
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli */ }
    try { fs.rmSync(saveDir, { recursive: true, force: true }); } catch { /* kilitli */ }
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
