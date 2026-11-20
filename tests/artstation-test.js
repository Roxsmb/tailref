'use strict';

/* ArtStation paneli uçtan uca testi.

   Gerçek ArtStation'a gitmeden, yerel bir fixture sayfasıyla şunları doğrular:
   • ArtStation uygulamanın İÇİNDE (<webview>) açılıyor, ayrı pencere değil.
   • Konuk sayfaya enjekte edilen "Tahtaya ekle" düğmesi görünüyor.
   • Tek tıkla görsel indirilip tahtaya ekleniyor.
   • Paneldeki bağlantı alanından da görsel eklenebiliyor.
   • "Görünenleri ekle" aynı görseli ikinci kez eklemiyor.
   • Yalnızca ArtStation alan adları panele sokuluyor.

   Kullanım: node scripts/artstation-test.js
   Uygulama izole veri klasöründe ve ayrı portta çalışır. */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 5205;
const FIXTURE_PORT = 5204;
const DEBUG_PORT = 9380;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Bu kontroller Electron gerektirmez: kötü niyetli alan adları ve görsel
   çözünürlüğü yükseltmesi saf fonksiyonlarla doğrulanır. */
const { isArtStationUrl, upgradeImageUrl } = require(path.join(ROOT, 'src', 'main', 'artstation.js'));

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

/* Izgara kartı gibi davranan fixture: bir büyük görsel + üçlü sıra.
   Görseller 256×256 olduğu için enjekte edilen düğmenin boyut eşiklerini geçer. */
function fixturePage() {
  return `<!doctype html>
<html lang="tr">
<head><meta charset="utf-8"><title>ArtStation fixture</title>
<style>body{margin:0;background:#101014;font-family:system-ui}main{padding:32px;display:flex;flex-direction:column;align-items:center;gap:12px}
a{display:block;width:240px}.art{width:240px;height:240px;object-fit:cover;display:block;border-radius:16px}
.row{display:flex;gap:10px}.row img{width:180px;height:180px;object-fit:cover;border-radius:12px}</style>
</head>
<body><main>
  <a href="/artwork/1"><img class="art" src="http://127.0.0.1:${FIXTURE_PORT}/pick.png" alt="artstation-test-gorseli"></a>
  <div class="row">
    <img src="http://127.0.0.1:${FIXTURE_PORT}/a.png" alt="toplu-1">
    <img src="http://127.0.0.1:${FIXTURE_PORT}/b.png" alt="toplu-2">
    <img src="http://127.0.0.1:${FIXTURE_PORT}/c.png" alt="toplu-3">
  </div>
</main></body></html>`;
}

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (/^\/[\w-]+\.png$/.test(request.url || '')) {
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
    TailRef_ARTSTATION_URL: `http://127.0.0.1:${FIXTURE_PORT}/`,
    TailRef_DOWNLOAD_DIR: saveDir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(electronPath(), ['.', `--remote-debugging-port=${DEBUG_PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-artstation-'));
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-artstation-saves-'));
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

  const allowedArtStation = [
    'https://www.artstation.com/',
    'https://www.artstation.com/artwork/abc123',
    'https://cdnb.artstation.com/p/assets/images/images/012/345/678/large/a.jpg',
    'https://cdna.artstation.com/p/assets/images/images/012/345/678/large/a.jpg',
  ];
  const deniedArtStation = [
    'https://artstation.saldirgan.com/',
    'https://www.artstation.com.saldirgan.com/',
    'https://saldirganartstation.com/',
    'https://artstation.xyz/',
    'http://www.artstation.com/',
  ];
  check('ArtStation alan adı beyaz listesi taklitleri reddediyor',
    allowedArtStation.every(url => isArtStationUrl(url))
      && deniedArtStation.every(url => !isArtStationUrl(url)),
    `${allowedArtStation.length} izin / ${deniedArtStation.length} ret`);

  const upgraded = upgradeImageUrl('https://cdnb.artstation.com/p/assets/images/images/012/345/678/medium/a.jpg?1650000000');
  check('görsel adresi büyük varyanta yükseltiliyor',
    upgraded === 'https://cdnb.artstation.com/p/assets/images/images/012/345/678/large/a.jpg?1650000000', upgraded);
  check('saf görsel adresi değiştirilmiyor',
    upgradeImageUrl('http://127.0.0.1:5204/a.png') === 'http://127.0.0.1:5204/a.png');

  try {
    const mainTarget = await waitFor(() => findTarget(APP_PORT, t => t.type === 'page'), 'ana pencere');
    mainWs = await connect(mainTarget.webSocketDebuggerUrl);
    await waitFor(async () => evaluate(mainWs,
      "typeof state !== 'undefined' && typeof appReady !== 'undefined' && appReady === true"), 'renderer hazır');

    // Panel menüden açılıyor mu?
    await evaluate(mainWs, "document.getElementById('btnArtStation').click()");
    await sleep(700);
    const panelState = JSON.parse(await evaluate(mainWs, `(() => {
      const panel = document.getElementById('artstationPanel');
      const view = document.getElementById('artstationView');
      const rect = view ? view.getBoundingClientRect() : null;
      return JSON.stringify({
        open: !!panel && !panel.hidden,
        tag: view ? view.tagName.toLowerCase() : '',
        rect: rect ? [Math.round(rect.width), Math.round(rect.height)] : null
      });
    })()`));
    check('ArtStation paneli açıldı', panelState.open === true);
    check('ArtStation uygulama içinde <webview> ile açılıyor', panelState.tag === 'webview'
      && panelState.rect && panelState.rect[0] > 300 && panelState.rect[1] > 200,
      `${panelState.tag} ${JSON.stringify(panelState.rect)}`);

    const cfg = JSON.parse(await evaluate(mainWs, `(async () => {
      const c = await window.tailref.artstationConfig();
      return JSON.stringify({ mode: c.mode, startUrl: c.startUrl, loginUrl: c.loginUrl });
    })()`));
    check('giriş sayfası adresi hazır', cfg.loginUrl === 'https://www.artstation.com/users/sign_in', cfg.loginUrl);
    check('test modunda fixture açılıyor', cfg.mode === 'fixture'
      && cfg.startUrl.includes(`:${FIXTURE_PORT}`), `${cfg.mode} ${cfg.startUrl}`);
    await sleep(400);
    const readyText = await evaluate(mainWs, "document.getElementById('artstationStatus').textContent");
    check('giriş uyarısı fixture modunda gösterilmiyor', !readyText.includes('giriş yap'), readyText);

    // Diske kaydetme: tercih açılıyor (testte TailRef_DOWNLOAD_DIR geçici klasör)
    const saveOn = await evaluate(mainWs, `(() => {
      const box = document.getElementById('artstationSaveDisk');
      if (!box) return false;
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      return true;
    })()`);
    check('diske kaydet tercihi açılabiliyor', saveOn === true);

    // Konuk sayfa yüklendi ve düğme enjekte edildi mi?
    const guestTarget = await waitFor(async () => findTarget(FIXTURE_PORT, t => t.type === 'webview' || t.type === 'page'),
      'ArtStation konuk sayfası');
    guestWs = await connect(guestTarget.webSocketDebuggerUrl);
    await waitFor(async () => evaluate(guestWs, "!!document.getElementById('tailref-pick')"), 'enjekte edilen düğme');
    const image = JSON.parse(await evaluate(guestWs, `(() => {
      const img = document.querySelector('img.art');
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
      "document.getElementById('artstationStatus').textContent")).includes('added') ||
      (await evaluate(mainWs, "document.getElementById('artstationStatus').textContent")).includes('eklendi'), 'panel durumu');
    check('panel durumu güncellendi', true, await evaluate(mainWs, "document.getElementById('artstationStatus').textContent"));

    // Bağlantı alanından ekleme
    await evaluate(mainWs, `(() => {
      const input = document.getElementById('artstationUrl');
      input.value = 'http://127.0.0.1:${FIXTURE_PORT}/url.png';
      document.getElementById('artstationAddUrl').click();
      return true;
    })()`);
    await waitFor(async () => (await evaluate(mainWs, "state.items.filter(i => i.kind === 'image').length")) === 2,
      'bağlantıdan görsel ekleme');
    check('bağlantı alanından görsel eklendi', true);

    const savedAfterUrl = fs.readdirSync(saveDir).filter(name => /\.(png|jpg|jpeg|webp|avif|gif)$/i.test(name));
    check('bağlantıdan eklenen görsel diske kaydedildi', savedAfterUrl.length === 2, `${savedAfterUrl.length} dosya`);
    const urlStatus = await evaluate(mainWs, "document.getElementById('artstationStatus').textContent");
    check('durum satırı disk kaydını bildiriyor', urlStatus.includes('diske kaydedildi') || urlStatus.includes('saved to disk'), urlStatus);

    // Görünenleri topluca ekleme (fixture'da 4 görsel var; biri zaten tahtada)
    await evaluate(mainWs, "document.getElementById('artstationAddVisible').click()");
    await waitFor(async () => (await evaluate(mainWs, "state.items.filter(i => i.kind === 'image').length")) === 5,
      'görünenlerin topluca eklenmesi');
    const batchStatus = await evaluate(mainWs, "document.getElementById('artstationStatus').textContent");
    check('görünen 3 görsel tek düğmeyle eklendi', /3 görsel|3 images/.test(batchStatus), batchStatus);

    // Aynı görseller tekrar eklenmemeli
    await evaluate(mainWs, "document.getElementById('artstationAddVisible').click()");
    await waitFor(async () => (await evaluate(mainWs, "document.getElementById('artstationStatus').textContent")).includes('Yeni görsel yok') ||
      (await evaluate(mainWs, "document.getElementById('artstationStatus').textContent")).includes('No new images'),
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
    await evaluate(mainWs, "artstationSeen.clear()");
    const detached = JSON.parse(await evaluate(mainWs, `(async () => {
      const panel = document.getElementById('artstationPanel');
      const ok = await detachPanelToWindow(panel);
      return JSON.stringify({ ok, flag: panel.dataset.detached || '', hidden: panel.hidden });
    })()`));
    const detTarget = await waitFor(() => findTarget(APP_PORT, t => t.url.includes('/panel.html')),
      'ayrı panel penceresi');
    detWs = await connect(detTarget.webSocketDebuggerUrl);
    await waitFor(async () => evaluate(mainWs, "document.getElementById('artstationPanel').hidden"),
      'panelin uygulama içinde gizlenmesi');
    const detGuestUrl = await waitFor(async () => {
      const url = await evaluate(detWs, `(() => {
        const v = document.querySelector('webview');
        if (!v) return '';
        try { return v.getURL() || ''; } catch { return ''; }
      })()`);
      return url.includes(`:${FIXTURE_PORT}`) ? url : '';
    }, 'ayrı penceredeki ArtStation konuk sayfası');
    check('ArtStation ayrı pencerede <webview> ile açıldı',
      detached.ok && detached.flag === '1' && !!detGuestUrl,
      JSON.stringify({ detached, detGuestUrl }));

    const guestEval = expression => evaluate(detWs, `(async () => {
      const v = document.querySelector('webview');
      if (!v) return '';
      return v.executeJavaScript(${JSON.stringify(expression)});
    })()`);

    await guestEval(`(() => {
      const img = document.querySelector('img.art');
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

    await evaluate(detWs, "document.getElementById('artstationAddVisible').click()");
    const detBatchStatus = await waitFor(async () => {
      const text = await evaluate(detWs, "document.getElementById('artstationStatus').textContent");
      return /3 görsel|3 images/.test(text) ? text : '';
    }, 'ayrı pencerede toplu ekleme');
    check('ayrı pencerede "Görünenleri ekle" çalışıyor', /3 görsel|3 images/.test(detBatchStatus), detBatchStatus);

    await evaluate(mainWs, "window.tailref.closePanelWindow('artstationPanel', true)");
    await sleep(1400);
    const docked = JSON.parse(await evaluate(mainWs, `JSON.stringify({
      flag: document.getElementById('artstationPanel').dataset.detached || '',
      visible: !document.getElementById('artstationPanel').hidden,
    })`));
    const dockedUrl = await waitFor(async () => {
      const url = await evaluate(mainWs, `(() => {
        try { return document.getElementById('artstationView').getURL(); } catch { return ''; }
      })()`);
      return url.includes(`:${FIXTURE_PORT}`) ? url : '';
    }, 'geri takılan ArtStation sayfası');
    check('ArtStation paneli geri takıldı ve aynı sayfada devam ediyor',
      docked.flag !== '1' && docked.visible && !!dockedUrl,
      JSON.stringify({ docked, dockedUrl }));

    // ---- ayrı penceredeki × uygulama içi kapatma gibi davranmalı ----
    await evaluate(mainWs, `(async () => {
      await detachPanelToWindow(document.getElementById('artstationPanel'));
      return true;
    })()`);
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
      await v.executeJavaScript("location.href = '/artwork/1'");
      return true;
    })()`);
    await waitFor(async () => {
      const url = await evaluate(mainWs, 'artstationDetachedUrl');
      return url && url.includes('/artwork/1') ? url : '';
    }, 'ayrı pencerede gezinmenin ana pencereye bildirilmesi');
    await evaluate(detWs, "document.getElementById('btnArtStationClose').click()");
    await waitFor(async () => {
      const hidden = await evaluate(mainWs,
        "document.getElementById('artstationPanel').hidden && document.getElementById('artstationPanel').dataset.detached !== '1'");
      return hidden === true;
    }, 'ayrı penceredeki × ile kapanma');
    const closedUrl = await waitFor(async () => {
      const url = await evaluate(mainWs, `(() => {
        try { return document.getElementById('artstationView').getURL(); } catch { return ''; }
      })()`);
      return url.includes('/artwork/1') ? url : '';
    }, 'kapatılan panelin sayfa konumu');
    await evaluate(mainWs, "document.getElementById('btnArtStation').click()");
    await sleep(500);
    const reopened = JSON.parse(await evaluate(mainWs, `JSON.stringify({
      visible: !document.getElementById('artstationPanel').hidden,
      url: (() => { try { return document.getElementById('artstationView').getURL(); } catch { return ''; } })(),
    })`));
    check('ayrı penceredeki × kapatıyor; menüden açınca aynı sayfa geri geliyor',
      reopened.visible && !!closedUrl && reopened.url.includes('/artwork/1'),
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
