'use strict';

/* itch.io HTML5 (tarayıcı demosu) derlemesi.

   src/renderer klasörünü olduğu gibi dist-web'e kopyalar, index.html'e
   web-demo.js'i (app.js'ten önce) ekler ve src/web/web-demo.js'i yanına
   koyar. Çıktı, kökünde index.html olan bir klasördür; butler ile
   `roxsmb/tailref:web` kanalına push edilir.

   Kullanım:
     node scripts/build-app.js && node scripts/build-web.js
     node scripts/build-web.js --check     (yazmadan yalnızca doğrula) */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'renderer');
const EXTRA = path.join(ROOT, 'src', 'web');
const OUT = path.join(ROOT, 'dist-web');
const CHECK_ONLY = process.argv.includes('--check');

function fail(message) {
  console.error('build-web: ' + message);
  process.exit(1);
}

function countFiles(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countFiles(full);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      files += 1;
      bytes += fs.statSync(full).size;
    }
  }
  return { files, bytes };
}

function patchIndex(html) {
  if (html.includes('web-demo.js')) return html;
  const anchor = '<script defer src="app.js"></script>';
  if (!html.includes(anchor)) fail('index.html içinde app.js etiketi bulunamadı');
  return html.replace(anchor, '<script defer src="web-demo.js"></script>\n' + anchor);
}

function main() {
  if (!fs.existsSync(path.join(SRC, 'index.html'))) fail('src/renderer/index.html yok');
  if (!fs.existsSync(path.join(SRC, 'app.js'))) {
    fail('src/renderer/app.js yok — önce `node scripts/build-app.js` çalıştırın');
  }
  if (!fs.existsSync(path.join(EXTRA, 'web-demo.js'))) fail('src/web/web-demo.js yok');

  if (CHECK_ONLY) {
    const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    const patched = patchIndex(html);
    console.log('build-web --check: ' + (patched === html ? 'index.html zaten hazır' : 'index.html yamalanacak'));
    return;
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(SRC, OUT, { recursive: true });
  fs.copyFileSync(path.join(EXTRA, 'web-demo.js'), path.join(OUT, 'web-demo.js'));

  const indexPath = path.join(OUT, 'index.html');
  fs.writeFileSync(indexPath, patchIndex(fs.readFileSync(indexPath, 'utf8')), 'utf8');

  const stats = countFiles(OUT);
  console.log('build-web: ' + OUT);
  console.log('  ' + stats.files + ' dosya, ' + (stats.bytes / (1024 * 1024)).toFixed(2) + ' MB');
  console.log('  giriş: index.html (web-demo.js + app.js)');
}

main();
