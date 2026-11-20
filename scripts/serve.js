'use strict';

/* Geliştirme host'u — repo kökünü tarayıcıya sunar.
   Kullanım: node scripts/serve.js [port]
   Varsayılan port 8770. Ctrl+C ile durdurulur. */

const path = require('path');
const { startStaticServer } = require('../static-server');

const port = Number(process.argv[2]) || 8770;
const root = path.join(__dirname, '..');

(async () => {
  try {
    const server = await startStaticServer({ root, port });
    console.log('TailRef geliştirme host\'u: http://127.0.0.1:' + port +
      '\nKök: ' + root + '\nDurdurmak için Ctrl+C');
    server.on('error', err => {
      console.error('host hatası:', err.message);
      process.exit(1);
    });
  } catch (err) {
    console.error('host başlatılamadı:', err.message);
    process.exit(1);
  }
})();
