'use strict';

/* TailRef yerel sunucu (tarayıcı sürümü) — bağımlılık yok.
   Kullanım: node server.js   (veya start.bat)
   Statik sunucu mantığı static-server.js içinde, masaüstü sürümüyle ortak. */

const { spawn } = require('child_process');
const { startStaticServer } = require('./static-server');

const ROOT = path.join(__dirname, '..', 'renderer');
const HOST = '127.0.0.1';

/* PORT ortam değişkeni doğrulanmadan dinleme adresine girmemeli; aksi halde
   hatalı/zararlı bir değer beklenmedik bir portu veya tüm arayüzleri açabilir. */
function parsePort(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

const RAW_PORT = process.env.PORT || '5173';
const PORT = parsePort(RAW_PORT);
if (PORT === null) {
  console.error(`\n  Geçersiz PORT değeri: ${JSON.stringify(RAW_PORT)}`);
  console.error('  1 ile 65535 arasında bir tam sayı girin. Örnek: set PORT=5174\n');
  process.exit(1);
}

/* Tarayıcıyı kabuk yorumlaması olmadan açar. URL yalnızca sabit ana makine ve
   doğrulanmış sayısal porttan üretilir; dışarıdan gelen metin geçmez. */
function openBrowser(url) {
  const isWin = process.platform === 'win32';
  const command = isWin ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = isWin ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { /* tarayıcı yoksa sunucu yine çalışsın */ });
    child.unref();
  } catch { /* sessiz: tarayıcı açılamadı */ }
}

startStaticServer({ root: ROOT, port: PORT, host: HOST })
  .then(() => {
    const url = `http://localhost:${PORT}/`;
    console.log('');
    console.log('  TailRef çalışıyor');
    console.log('  ' + url);
    console.log('');
    console.log('  Kapatmak için bu pencereyi kapat veya Ctrl+C');
    console.log('');
    if (process.env.NO_OPEN !== '1') openBrowser(url);
  })
  .catch((e) => {
    if (e && e.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} dolu. Başka bir kopya açık olabilir.`);
      console.error(`  Farklı port için:  set PORT=5174 && node server.js\n`);
      process.exit(1);
    }
    throw e;
  });
