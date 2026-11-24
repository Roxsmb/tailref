'use strict';

/* ArtStation köprüsü (ana süreç).

   Pinterest paneliyle aynı desen: uygulama içindeki <webview> ArtStation'ı
   kendi oturumunda (persist:artstation) açar; bu modül yalnızca görsel indirme,
   diske kaydetme ve oturum temizliği için IPC sağlar. Görselin baytları
   doğrudan renderer'a verilir; böylece CORS engeline takılmadan, mevcut
   addFiles() akışıyla tahtaya eklenir.

   Testlerde (paketlenmemiş) TailRef_ARTSTATION_URL ile yerel bir fixture
   sayfası ve 127.0.0.1 görselleri kullanılabilir. Paketli sürümde yalnızca
   ArtStation alan adları kabul edilir. */

const { ipcMain, session, app, shell } = require('electron');
const ipcGuard = require('./ipc-guard');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { registerGuestSite } = require('./guest-guards');

const PARTITION = 'persist:artstation';
const PRELOAD_URL = pathToFileURL(path.join(__dirname, 'artstation-preload.js')).href;
const SITE_URL = 'https://www.artstation.com/';
const LOGIN_URL = 'https://www.artstation.com/users/sign_in';
/* ArtStation Cloudflare arkasında. UA'yı elle sabitlemek (ör. Chrome/128)
   Chromium sürümüyle çelişince yönetilen doğrulama ("Bir dakika lütfen…")
   takılıyordu; bu yüzden sürüm çalışma zamanından alınır. */
const CHROME_VERSION = process.versions.chrome || '128.0.0.0';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + `(KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/* ArtStation tek alan adı ailesi kullanır: site ve görsel CDN'i
   (cdn.artstation.com, cdna…, cdnb…) aynı kökün altında. */
const ARTSTATION_HOST_RE = /(^|\.)artstation\.com$/i;
const IMAGE_PATH_RE = /\.(png|jpe?g|webp|gif|avif)$/i;

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function isArtStationHost(hostname) {
  return ARTSTATION_HOST_RE.test(hostname);
}

function isLocalHost(hostname, allowLocal) {
  return allowLocal && (hostname === '127.0.0.1' || hostname === 'localhost');
}

function fileNameFor(url) {
  let base = 'artstation';
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    if (name) base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w-]+/g, '-').slice(0, 48) || base;
  } catch { /* varsayılan ad */ }
  return `${base}-${Date.now()}`;
}

async function extractOgImage(pageUrl, ses) {
  const response = await ses.fetch(pageUrl, {
    headers: {
      'user-agent': CHROME_UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'tr,en;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`ArtStation page could not open (HTTP ${response.status})`);
  const html = await response.text();
  const patterns = [
    /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i,
    /<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match && match[1]) return match[1].replace(/&amp;/g, '&');
  }
  throw new Error('No image address found on the ArtStation page');
}

async function resolveImageUrl(rawUrl, ses, allowLocal) {
  const parsed = new URL(rawUrl);
  const local = isLocalHost(parsed.hostname, allowLocal);
  if (!isArtStationHost(parsed.hostname) && !local) {
    throw new Error('Only ArtStation links are supported');
  }
  /* CDN adresleri doğrudan görseldir; sayfa adreslerinden og:image çekilir. */
  if (IMAGE_PATH_RE.test(parsed.pathname)) return parsed.toString();
  return extractOgImage(parsed.toString(), ses);
}

/* ArtStation aynı görseli boyut klasörleriyle sunar
   (.../images/012/345/678/medium/…, /large/…). Izgara kartları "medium"
   varyantını kullanır; tahtaya eklerken "large" istemek daha yüksek çözünürlük
   verir. Varyant yoksa aşağıda özgün adrese geri dönülür. */
const SIZE_SEGMENT_RE = /\/(micro|small|medium|large|original|4k)\//i;

function upgradeImageUrl(imageUrl) {
  try {
    const parsed = new URL(imageUrl);
    if (!SIZE_SEGMENT_RE.test(parsed.pathname)) return imageUrl;
    parsed.pathname = parsed.pathname.replace(SIZE_SEGMENT_RE, '/large/');
    return parsed.toString();
  } catch {
    return imageUrl;
  }
}

async function downloadImage(imageUrl, ses, allowLocal) {
  const parsed = new URL(imageUrl);
  if (!isArtStationHost(parsed.hostname) && !isLocalHost(parsed.hostname, allowLocal)) {
    throw new Error('Image is not on the ArtStation server');
  }

  /* Not: referer başlığı elle verilmemeli. Chromium, isteğin kendi origin'iyle
     uyuşmayan bir Referer başlığını net::ERR_BLOCKED_BY_CLIENT ile reddediyor
     (Electron 32). */
  const response = await ses.fetch(imageUrl, {
    headers: {
      'user-agent': CHROME_UA,
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`Could not download image (HTTP ${response.status})`);

  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) throw new Error('The link does not return an image');

  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared > MAX_IMAGE_BYTES) throw new Error('Image is too large (30 MB limit)');

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('Image came back empty');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image is too large (30 MB limit)');

  const ext = MIME_EXT[mime] || 'png';
  return { buffer, mime, name: `${fileNameFor(imageUrl)}.${ext}` };
}

async function fetchFromUrl(rawUrl, ses, allowLocal) {
  try {
    const value = String(rawUrl || '').trim();
    if (!value) throw new Error('Link is empty');
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && !(allowLocal && parsed.protocol === 'http:')) {
      throw new Error('Only https links are supported');
    }
    const imageUrl = await resolveImageUrl(value, ses, allowLocal);
    let image;
    const upgraded = upgradeImageUrl(imageUrl);
    try {
      image = await downloadImage(upgraded, ses, allowLocal);
    } catch (error) {
      if (upgraded === imageUrl) throw error;
      image = await downloadImage(imageUrl, ses, allowLocal);
    }
    return { ok: true, ...image };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : 'Image could not be fetched' };
  }
}

/* ---------- gezinme güvenliği ---------- */

/* Konuk pencere yalnızca ArtStation içinde gezinsin. Test modunda yerel
   fixture adresine izin verilir. */
function isArtStationUrl(rawUrl, { allowLocal = false } = {}) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'about:' || url.protocol === 'devtools:') return true;
    if (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:')) return false;
    if (isArtStationHost(url.hostname)) return true;
    return allowLocal && isLocalHost(url.hostname, true);
  } catch {
    return false;
  }
}

/* ArtStation'a giriş Google, Facebook veya Epic hesabıyla yapılabilir.
   Yalnızca bu sağlayıcıların kendi alan adlarına kontrollü izin verilir. */
const AUTH_POPUP_RE = /(^|\.)(accounts\.google\.com|appleid\.apple\.com|facebook\.com|epicgames\.com)$/i;

function isAuthPopup(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && AUTH_POPUP_RE.test(url.hostname);
  } catch {
    return false;
  }
}

/* ---------- diske kaydetme ---------- */

const SAVE_DIR_NAME = 'TailRef ArtStation';

function saveDirFor(isTest) {
  const override = isTest ? process.env.TailRef_DOWNLOAD_DIR : '';
  if (override) return path.resolve(override);
  return path.join(app.getPath('downloads'), SAVE_DIR_NAME);
}

/* Dosya adı URL'den geliyor: yol ayırıcıları ve kontrol karakterleri
   temizlenir, klasör dışına yazma ihtimali kalmaz. */
function safeFileName(name) {
  const base = path.basename(String(name || ''))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^[.\-]+/, '')
    .slice(0, 90);
  return base || `artstation-${Date.now()}.png`;
}

function uniqueFilePath(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${stem}-${i}${ext}`);
  }
  return candidate;
}

async function saveImageToDisk(image, isTest) {
  const dir = saveDirFor(isTest);
  await fs.promises.mkdir(dir, { recursive: true });
  const file = uniqueFilePath(dir, safeFileName(image.name));
  await fs.promises.writeFile(file, image.buffer);
  return { dir, file };
}

function registerArtStation({ isTest = false } = {}) {
  const ses = () => session.fromPartition(PARTITION);

  const applyIdentity = () => {
    try {
      const current = ses();
      current.setUserAgent(CHROME_UA, 'tr-TR,tr,en-US,en;q=0.9');
    } catch { /* oturum henüz hazır değilse yok say */ }
  };

  registerGuestSite({
    partition: PARTITION,
    name: 'ArtStation paneli',
    isAllowed: url => isArtStationUrl(url, { allowLocal: !!isTest }),
    isAuthPopup: url => isAuthPopup(url),
  });

  ipcGuard.handle(ipcMain, 'artstation-config', async () => {
    applyIdentity();
    const fixture = isTest ? process.env.TailRef_ARTSTATION_URL : '';
    return {
      mode: fixture ? 'fixture' : 'feed',
      startUrl: fixture || SITE_URL,
      loginUrl: LOGIN_URL,
      feedUrl: SITE_URL,
      userAgent: CHROME_UA,
      preloadUrl: PRELOAD_URL,
      allowLocal: !!isTest,
    };
  });

  ipcGuard.handle(ipcMain, 'artstation-fetch', async (_event, url, options) => {
    const result = await fetchFromUrl(url, ses(), !!isTest);
    if (!result || !result.ok || !options || !options.save) return result;
    try {
      const saved = await saveImageToDisk(result, isTest);
      return { ...result, savedPath: saved.file, saveDir: saved.dir };
    } catch (error) {
      // Tahtaya ekleme devam etsin; yalnızca disk kopyası başarısız oldu.
      return { ...result, saveError: (error && error.message) || 'Could not save to disk' };
    }
  });

  ipcGuard.handle(ipcMain, 'artstation-open-folder', async () => {
    try {
      const dir = saveDirFor(isTest);
      await fs.promises.mkdir(dir, { recursive: true });
      const error = await shell.openPath(dir);
      return { ok: !error, dir, error: error || '' };
    } catch (error) {
      return { ok: false, dir: '', error: (error && error.message) || 'Folder could not open' };
    }
  });

  ipcGuard.handle(ipcMain, 'artstation-clear', async () => {
    try {
      const current = ses();
      await current.clearStorageData();
      await current.clearCache();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : 'Could not clear session' };
    }
  });
}

module.exports = {
  registerArtStation,
  isArtStationUrl,
  isArtStationHost,
  upgradeImageUrl,
  ARTSTATION_PARTITION: PARTITION,
  CHROME_UA,
};
