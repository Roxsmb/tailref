'use strict';

/* Ortak statik dosya sunucusu — hem Electron ana süreci (main.js) hem de
   tarayıcı sürümü (server.js) bunu kullanır. Bağımlılık yok. */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.fbx':  'application/octet-stream',
  '.obj':  'text/plain; charset=utf-8',
};

/* Null baytı ve diğer kontrol karakterleri dosya yolu olamaz. Windows'ta
   null baytlı bir yol fs.readFile'ı senkron olarak fırlatır; bu istisna
   yakalanmazsa tüm yerel sunucu (ve Electron ana süreci) düşer. */
const UNSAFE_PATH_RE = /[\u0000-\u001f\u007f]/;

/* Sunucu yalnızca uygulamanın çalışma zamanı dosyalarını sunmalı. Nokta ile
   başlayan dosyalar (.env, .gitignore, .git) ve node_modules istemciye
   açılmamalıdır; aksi halde yerel sunucu bir sır dosyasını veya geliştirme
   bağımlılıklarını dışarı verebilir. */
const BLOCKED_SEGMENTS = new Set(['node_modules']);

function hasBlockedSegment(value) {
  return value.split(/[\\/]+/).some(segment => {
    if (!segment) return false;
    if (BLOCKED_SEGMENTS.has(segment.toLowerCase())) return true;
    return segment.startsWith('.') && segment !== '.' && segment !== '..';
  });
}

function hasUnsafePathChars(value) {
  return typeof value !== 'string' || UNSAFE_PATH_RE.test(value);
}

/** İstenen URL yolunu kök klasör içinde güvenli bir dosya yoluna çevirir.
    Klasör dışına çıkan, kontrol karakteri içeren veya gizli/bağımlılık
    klasörlerine işaret eden istekler için null döner. */
function resolvePath(root, urlPath) {
  if (hasUnsafePathChars(urlPath) || hasBlockedSegment(urlPath)) return null;
  const normalized = path.normalize(urlPath).replace(/^([/\\])+/, '');
  const filePath = path.join(root, normalized);
  const rel = path.relative(root, filePath);
  // "" => kökün kendisi; ".." veya "..\x" => dışarı çıkıyor; mutlak yol => sürücü değişmiş
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  return filePath;
}

function createHandler(root) {
  return (req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end('bad request');
      return;
    }

    // %00 gibi kodlanmış kontrol karakterleri decode sonrası burada yakalanır.
    if (hasUnsafePathChars(urlPath)) {
      res.writeHead(400, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end('bad request');
      return;
    }

    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    const filePath = resolvePath(root, urlPath);
    if (!filePath) {
      res.writeHead(403, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end('forbidden');
      return;
    }

    // fs.readFile callback API'si bazı geçersiz yollarda senkron istisna
    // fırlatabilir. İstek düzeyinde yakala; süreç düşmesin.
    try {
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end('bulunamadi: ' + urlPath);
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'X-Frame-Options': 'DENY',
        });
        res.end(data);
      });
    } catch {
      if (!res.headersSent) {
        res.writeHead(400, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end('bad request');
      } else {
        res.destroy();
      }
    }
  };
}

/**
 * Sunucuyu başlatır.
 * @param {{root:string, port:number, host?:string}} options
 * @returns {Promise<import('http').Server>}
 */
function startStaticServer({ root, port, host = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createHandler(root));
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

module.exports = { startStaticServer, createHandler, resolvePath, MIME };
