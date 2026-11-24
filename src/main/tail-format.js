'use strict';

/* TailRef — .tail kapsayıcı biçimi (SAF, Electron'suz).
   ------------------------------------------------------------------
   Dosya düzeni:  magic(4) + version(1) + gzip(JSON)

   • Yeni dosyalar her zaman 'TAIL' imzasıyla yazılır.
   • Eski Refeverr sürümlerinin 'RFVR' imzası OKUMA tarafında kabul edilir.
   • Sıkıştırılmış dosya ve açılmış JSON için ayrı üst sınırlar vardır:
     bozuk/kötü niyetli bir dosya belleği tüketemez (gzip bombası).

   Bu modül main.js'ten ayrıldı çünkü Electron olmadan test edilebilir
   olması gerekiyor: sınırlar, sürüm reddi, bozuk gövde, geçerli gzip ama
   geçersiz JSON ve nesne olmayan üst düzey değer durumları
   tests/tail-format-test.js ile doğrulanır.

   Sıkıştırma/açma bilinçli olarak ASYNC'dir: senkron zlib büyük panolarda
   ana süreci (pencere, menü, IPC) saniyelerce dondurur. */

const zlib = require('zlib');

const MAGIC = 'TAIL';
const LEGACY_MAGIC = 'RFVR';
const VERSION = 1;
const HEADER_BYTES = 5;

/* En ağır gerçek kullanıcı panosu ~200 MB; sınırlar bunun çok üstünde. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;       // 1 GB (disk)
const MAX_INFLATED_BYTES = 1536 * 1024 * 1024;   // 1,5 GB (JSON)

function deflate(buffer) {
  return new Promise((resolve, reject) => {
    zlib.deflate(buffer, { level: 6 }, (error, out) => (error ? reject(error) : resolve(out)));
  });
}

function inflate(buffer, maxOutputLength) {
  return new Promise((resolve, reject) => {
    zlib.inflate(buffer, { maxOutputLength }, (error, out) => (error ? reject(error) : resolve(out)));
  });
}

/** Panoyu .tail baytlarına çevirir. Sınır aşılırsa code='too-large' hatası.
    `options.maxInflatedBytes` yalnız testlerde küçültmek için. */
async function encodeBoard(text, options) {
  const opts = options || {};
  const maxInflatedBytes = Number.isFinite(opts.maxInflatedBytes)
    ? opts.maxInflatedBytes : MAX_INFLATED_BYTES;
  const json = Buffer.from(String(text == null ? '' : text), 'utf8');
  if (json.length > maxInflatedBytes) {
    const error = new Error('Board is too large to save as .tail');
    error.code = 'too-large';
    throw error;
  }
  const deflated = await deflate(json);
  return Buffer.concat([
    Buffer.from(MAGIC, 'ascii'),
    Buffer.from([VERSION]),
    deflated,
  ]);
}

/** .tail baytlarını çözer.
    Dönüş: { ok:true, payload } veya
           { ok:false, reason:'invalid' } veya
           { ok:false, reason:'version', version }. */
async function decodeBoard(buffer, options) {
  const opts = options || {};
  const maxFileBytes = Number.isFinite(opts.maxFileBytes) ? opts.maxFileBytes : MAX_FILE_BYTES;
  const maxInflatedBytes = Number.isFinite(opts.maxInflatedBytes)
    ? opts.maxInflatedBytes : MAX_INFLATED_BYTES;
  const invalid = { ok: false, reason: 'invalid' };

  if (!Buffer.isBuffer(buffer)) return invalid;
  if (buffer.length < HEADER_BYTES + 1) return invalid;
  if (buffer.length > maxFileBytes) return invalid;

  const magic = buffer.subarray(0, 4).toString('ascii');
  if (magic !== MAGIC && magic !== LEGACY_MAGIC) return invalid;

  const version = buffer[4];
  if (version !== VERSION) return { ok: false, reason: 'version', version };

  let json;
  try {
    json = await inflate(buffer.subarray(HEADER_BYTES), maxInflatedBytes);
  } catch {
    /* Bozuk gövde / sınırı aşan açılım. */
    return invalid;
  }

  let payload;
  try {
    payload = JSON.parse(json.toString('utf8'));
  } catch {
    return invalid;
  }

  /* Üst düzey değer nesne olmalı: null, sayı veya dizi olsaydı renderer
     payload.workspace / payload.state erişimlerinde çökerdi. */
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid;

  return { ok: true, payload };
}

module.exports = {
  MAGIC,
  LEGACY_MAGIC,
  VERSION,
  HEADER_BYTES,
  MAX_FILE_BYTES,
  MAX_INFLATED_BYTES,
  encodeBoard,
  decodeBoard,
};
