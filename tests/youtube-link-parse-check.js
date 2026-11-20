'use strict';

/* Kontrol: YouTube link alanı "hiçbir link çalışmıyor" şikâyeti sonrası
   güvenli ayrıştırma — protokolsüz linkler, m./music. alt alan adları,
   youtu.be / shorts / playlist, yapıştırılan çok satırlı metin ve
   kanal bağlantıları. Ayrıca gerçek yükleme: Yükle tuşu player'an
   doğru nocookie gömme adresini yazmalı. */

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
    if (msg.result.exceptionDetails) return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
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
    } catch { }
    await sleep(400);
  }
  throw new Error('hata ayıklama portu açılmadı');
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-ytparse-'));
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

    let ready = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try { ready = await evaluate(ws, "typeof state !== 'undefined' && typeof youtubeIds === 'function'"); if (ready) break; } catch { }
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı (youtubeIds yok)');
    await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
    await sleep(700);
    await evaluate(ws, 'window.__errs = []; window.addEventListener("error", e => window.__errs.push(String(e.message || e))); true');

    /* 1) Ayrıştırıcı birim doğrulaması — çeşitli gerçekçi girdiler */
    results.parse = await evaluate(ws, `(() => {
      const cases = {
        protokolsuz: youtubeIds('youtube.com/watch?v=dQw4w9WgXcQ'),
        protokolsuz_slash: youtubeIds('//www.youtube.com/watch?v=AbC-123_xy'),
        music: youtubeIds('https://music.youtube.com/watch?v=MuSiC01vid'),
        m_alt: youtubeIds('m.youtube.com/watch?v=mShort01X'),
        youtu_be: youtubeIds('https://youtu.be/ybe22vid-'),
        shorts: youtubeIds('https://www.youtube.com/shorts/sh0rtsvid1'),
        watch_eksik_anahtar: youtubeIds('https://www.youtube.com/watch/?v=wat33chvid'),
        playlist: youtubeIds('https://www.youtube.com/playlist?list=PLx000playlist'),
        watch_ve_list: youtubeIds('youtube.com/watch?v=both01vid&list=PLx9list'),
        cok_satirli: youtubeIds('https://youtu.be/first01vid\\nish bu: https://youtube.com/watch?v=second00v'),
        bosluklu: youtubeIds('   \\n  youtube.com/watch?v=spaced000v    '),
        kanal_baglantisi: youtubeIds('@birkanal'),
        bos_girdi: youtubeIds(''),
        degil_youtube: youtubeIds('https://vimeo.com/123456'),
      };
      for (const k of Object.keys(cases)) {
        if (cases[k] && typeof cases[k] === 'object') cases[k] = JSON.stringify(cases[k]);
      }
      return cases;
    })()`);

    /* 2) Canlı yükleme: protokolsüz link + Yükle tuşu → durum + gömme adresi */
    results.load = await evaluate(ws, `(async () => {
      try {
        /* Dil-bağımsız doğrulama: beklenen durum = çevrilmiş 'YouTube playing' */
        const beklenen = (typeof __t === 'function' ? __t('YouTube playing') : 'YouTube playing');
        const panel = document.getElementById('youtubeMusicPanel');
        const url = document.getElementById('youtubeUrl');
        const player = document.getElementById('youtubePlayer');
        const load = document.getElementById('youtubeLoad');
        const status = document.getElementById('youtubeStatus');
        panel.hidden = false;
        await new Promise(r => setTimeout(r, 100));
        url.value = 'youtube.com/watch?v=dQw4w9WgXcQ';
        load.click();
        await new Promise(r => setTimeout(r, 600));
        const solo = { status: status.textContent, src: player.src, hidden: player.hidden };
        /* Karışık link (YouTube Music mix'i): watch?v=…&list=… → video + list birlikte gömülür */
        url.value = 'youtube.com/watch?v=both01vid&list=PLx9list';
        load.click();
        await new Promise(r => setTimeout(r, 600));
        const mixed = { status: status.textContent, src: player.src, hidden: player.hidden };
        /* Yalnız playlist linki → videoseries gömülmesi */
        url.value = 'https://www.youtube.com/playlist?list=PLx000playlist';
        load.click();
        await new Promise(r => setTimeout(r, 600));
        const plist = { status: status.textContent, src: player.src, hidden: player.hidden };
        return { solo, mixed, plist, beklenen };
      } catch (err) { return { err: String(err && err.message || err) }; }
    })()`);

    results.errs = await evaluate(ws, 'JSON.stringify(window.__errs)');
  } catch (e) {
    results.error = e.message;
  } finally {
    try { ws && ws.close(); } catch { }
    try { app.kill(); } catch { }
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { }
  }

  let fail = 0;
  const ok = (name, cond, detail) => {
    if (!cond) fail++;
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}  ${detail == null ? '' : '→ ' + detail}`);
  };
  const p = results.parse || {};
  const l = results.load || {};

  ok('protokolsüz watch?v=', p.protokolsuz === '{"list":null,"video":"dQw4w9WgXcQ"}', p.protokolsuz);
  ok('// ile başlayan deformasyon kabul', p.protokolsuz_slash === '{"list":null,"video":"AbC-123_xy"}', p.protokolsuz_slash);
  ok('music.youtube.com → video, host www', p.music === '{"list":null,"video":"MuSiC01vid"}', p.music);
  ok('m.youtube.com → video', p.m_alt === '{"list":null,"video":"mShort01X"}', p.m_alt);
  ok('youtu.be kısa bağlantı', p.youtu_be === '{"list":null,"video":"ybe22vid-"}', p.youtu_be);
  ok('shorts bağlantı', p.shorts === '{"list":null,"video":"sh0rtsvid1"}', p.shorts);
  ok('watch/?v= bozuk çift soru işareti', p.watch_eksik_anahtar === '{"list":null,"video":"wat33chvid"}', p.watch_eksik_anahtar);
  ok('playlist?list=', p.playlist === '{"list":"PLx000playlist","video":null}', p.playlist);
  ok('watch?v= + list birlikte', p.watch_ve_list === '{"list":"PLx9list","video":"both01vid"}', p.watch_ve_list);
  ok('çok satırlı yapıştırmada ilk satır', p.cok_satirli === '{"list":null,"video":"first01vid"}', p.cok_satirli);
  ok('baş/son boşluk kırpılır', p.bosluklu === '{"list":null,"video":"spaced000v"}', p.bosluklu);
  ok('@kanal → reddedilir', p.kanal_baglantisi === '{"list":null,"video":null}', p.kanal_baglantisi);
  ok('boş girdi → null', p.bos_girdi === '{"list":null,"video":null}', p.bos_girdi);
  ok('youtube olmayan host reddedilir', p.degil_youtube === '{"list":null,"video":null}', p.degil_youtube);
  ok('Yükle: durum mesajı', l.solo?.status === l.beklenen, l.solo?.status + ' (beklenen: ' + l.beklenen + ')');
  ok('Yükle: nocookie gömme + doğru video', /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1&controls=1&rel=0&enablejsapi=1&origin=http/.test(l.solo?.src || ''), l.solo?.src);
  ok('Yükle: gizli değil', l.solo?.hidden === false, String(l.solo?.hidden));
  ok('Karışık link: video + list birlikte gömülüyor (videoseries düşmez)',
    /nocookie\.com\/embed\/both01vid\?list=PLx9list&/.test(l.mixed?.src || ''), l.mixed?.src);
  ok('Karışık link: durum videosunu söylüyor', l.mixed?.status === l.beklenen, l.mixed?.status);
  ok('Karışık link: iframe görünür', l.mixed?.hidden === false, String(l.mixed?.hidden));
  ok('Yalnız playlist: videoseries gömülmesi korunur',
    /nocookie\.com\/embed\/videoseries\?list=PLx000playlist&/.test(l.plist?.src || ''), l.plist?.src);
  ok('sayfada hata yok', results.errs === '[]', results.errs);

  if (results.error) {
    console.log('HATA: ' + results.error);
    console.log(JSON.stringify(results, null, 1));
    process.exit(1);
  }
  process.exit(fail === 0 ? 0 : 1);
})();
