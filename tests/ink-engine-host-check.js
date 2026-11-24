'use strict';
const path = require('path');
const fs = require('fs');

/* iki bölge: düğüm koşucu kendini electron.exe'e devreder; electron
   bölgesi ev sahibi (ink-engine-host) üzerinden gerçek kanal
   işleyicilerini sınamaktadır - ipcMain taklidi ile. */
if (!(process.versions && process.versions.electron)) {
  const exe = path.join(__dirname, '..', 'node_modules', 'electron',
    'dist', 'electron.exe');
  if (!fs.existsSync(exe)) {
    console.error('HOST: electron.exe yok');
    process.exit(3);
  }
  const { spawn } = require('child_process');
  spawn(exe, [path.join(__filename)], { stdio: 'inherit' })
    .on('exit', code => process.exit(code || 0))
    .on('error', err => {
      console.error('HOST: elektron başlatılamadı - ' + err);
      process.exit(5);
    });
} else {
  const { app } = require('electron');
  const host = require(path.join(__dirname, '..', 'src', 'main',
    'ink-engine-host.js'));
  const ipcGuard = require(path.join(__dirname, '..', 'src', 'main',
    'ipc-guard.js'));

  const TEST_ORIGIN_URL = 'http://127.0.0.1:5178/';
  const TEST_SENDER = { id: 1, isDestroyed: () => false };
  const trustedEvent = () => ({
    sender: TEST_SENDER,
    senderFrame: { url: TEST_ORIGIN_URL, parent: null },
  });

  function main() {
    /* ipcMain taklidi: handle çağrılarını kaydet ve döndür. */
    const handlers = new Map();
    const fakeIpcMain = {
      handle: (channel, handler) => handlers.set(channel, handler),
      /* port-us yol kanalı (ink-engine:port-open): invoke yedeği
         yeterli olduğu için taklitte kayıt yeterli, çalıştırma gerekmez. */
      on: (channel, handler) => { /* kayıtsız — kapı kapsamı dışı */ },
    };
    let failures = 0;

    ipcGuard.setAllowedOrigin(TEST_ORIGIN_URL);
    ipcGuard.trustMain(TEST_SENDER);

    try {
      host.register(fakeIpcMain);
    } catch (err) {
      console.error('HOST KIRMIZI: register - ' + err);
      app.exit(1);
      return;
    }

    const status = handlers.get('ink-engine:status');
    const tip = handlers.get('ink-engine:tip');
    if (typeof status !== 'function' || typeof tip !== 'function') {
      console.error('HOST KIRMIZI: kanallar eksik');
      app.exit(1);
      return;
    }

    (async () => {
      const st = await status(trustedEvent(), null);
      if (!st.ok) {
        console.error('HOST KIRMIZI: status beklenmedik - ' + st.error);
        app.exit(1);
        return;
      }
      console.log('HOST: motor yüklü, mod=' + st.kind);

      /* noiseTip: boyut + aralık denetimleri */
      const off = await tip(trustedEvent(), 'noiseTip', 0, 0.5, 0.9, 0);
      if (off.ok) { console.error('HOST KIRMIZI: px=0 kabul edildi'); failures++; }
      const big = await tip(trustedEvent(), 'noiseTip', 2000, 0.5, 0.9, 0);
      if (big.ok) { console.error('HOST KIRMIZI: px=2000 kabul edildi'); failures++; }
      const garbage = await tip(trustedEvent(), 'noiseTip', 'x', 0.5, 0.9, 0);
      if (garbage.ok) { console.error('HOST KIRMIZI: sayı olmayan kabul'); failures++; }
      const alien = await tip(trustedEvent(), 'circleTip', 64, 1, 1, 1);
      if (alien.ok) { console.error('HOST KIRMIZI: bilinmeyen iş kabul'); failures++; }

      const noise = await tip(trustedEvent(), 'noiseTip', 128, 0.55, 0.94, 3, 1);
      if (!noise.ok) {
        console.error('HOST KIRMIZI: noiseTip - ' + noise.error);
        failures++;
      } else {
        const len = noise.data.length;
        if (len !== 128 * 128 * 4) {
          console.error('HOST KIRMIZI: noiseTip boyut ' + len);
          failures++;
        } else {
          console.log('HOST: noiseTip 128 piksel=' + noise.stat);
        }
      }

      const wc = await tip(trustedEvent(), 'watercolorTip', 128, 0.22, 0.76, 0.42, 0);
      if (!wc.ok || wc.data.length !== 128 * 128 * 4) {
        console.error('HOST KIRMIZI: watercolorTip - ' + (wc.error || 'boyut'));
        failures++;
      } else {
        console.log('HOST: watercolorTip 128 piksel=' + wc.stat);
      }

      if (failures) {
        console.error('HOST SONUÇ: ' + failures + ' kırmızı');
        app.exit(1);
        return;
      }
      console.log('HOST SONUÇ: yeşil');
      app.exit(0);
    })().catch(err => {
      console.error('HOST SONUÇ: istisna - ' + err);
      app.exit(1);
    });
  }

  app.whenReady().then(main).catch(err => {
    console.error('HOST: elektron başlatılamadı - ' + err);
    app.exit(5);
  });
}
