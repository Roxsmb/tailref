/* Küçük statik sunucu: tarayıcıda (Electron köprüsü olmadan) test amaçlı
   kullanılır. python yoksa bile çalışır; `node scripts/dev-server.js`
   → http://localhost:8787

   Kök istek src/renderer/index.html'e eşlenir; diğer istekler önce
   src/renderer altında, bulunamazsa repo kökünde aranır. Böylece
   index.html'in göreli asset yolları (style.css, app.js, canvas/...)
   olduğu gibi çalışır. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

const inside = (base, target) => target === base || target.startsWith(base + path.sep);

function resolveFile(urlPath) {
  const p = decodeURIComponent(urlPath);
  if (p === '/' || p === '/index.html') return path.join(RENDERER, 'index.html');
  const rel = p.replace(/^\/+/, '');
  const candidates = [path.join(RENDERER, rel), path.join(ROOT, rel)];
  for (const file of candidates) {
    if (!inside(RENDERER, file) && !inside(ROOT, file)) continue;
    try {
      const st = fs.statSync(file);
      if (st.isFile()) return file;
    } catch { /* sıradaki aday */ }
  }
  return null;
}

http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const file = resolveFile(url.pathname);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found: ' + req.url);
      return;
    }
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('server error');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log('DEV SERVER ◆ http://localhost:' + PORT + '  (Ctrl+C ile durur)');
});
