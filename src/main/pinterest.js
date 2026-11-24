'use strict';

/* Pinterest köprüsü (ana süreç).

   Uygulama içindeki <webview> Pinterest'i kendi oturumunda (persist:pinterest)
   açar; bu modül yalnızca görsel indirme ve oturum temizliği için IPC sağlar.
   Görselin baytları doğrudan renderer'a verilir; böylece CORS engeline
   takılmadan, mevcut addFiles() akışıyla tahtaya eklenir.

   Testlerde (paketlenmemiş) TailRef_PINTEREST_URL ile yerel bir fixture
   sayfası ve 127.0.0.1 görselleri kullanılabilir. Paketli sürümde yalnızca
   Pinterest alan adları kabul edilir. */

const { ipcMain, session, app, shell } = require('electron');
const ipcGuard = require('./ipc-guard');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { registerGuestSite } = require('./guest-guards');

const PARTITION = 'persist:pinterest';
const PRELOAD_URL = pathToFileURL(path.join(__dirname, 'pinterest-preload.js')).href;
const LOGIN_URL = 'https://www.pinterest.com/login/';
const FEED_URL = 'https://www.pinterest.com/';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

const PINIMG_RE = /(^|\.)pinimg\.com$/i;
/* Pinterest'in gerçek alan adları. Önceki `pinterest\.[a-z.]{2,}` kalıbı
   `pinterest.saldirgan.com` gibi taklit alan adlarını da kabul ediyordu; bu,
   panelde sahte bir giriş sayfası açılmasına yol açabilirdi. */
const PINTEREST_TLDS = [
  'com', 'co.uk', 'ca', 'de', 'fr', 'es', 'it', 'jp', 'com.au', 'com.br',
  'com.mx', 'ch', 'at', 'be', 'min', 'se', 'no', 'fi', 'nl', 'pl', 'pt', 'ru',
  'co.kr', 'co.nz', 'ie', 'in', 'ph', 'sg', 'tw', 'hk', 'ar', 'cl', 'co',
  'mx', 'nz', 'pe', 'ro', 'sk', 'hu', 'cz', 'gr', 'com.tr', 'com.ua',
];
const PINTEREST_HOST_RE = new RegExp(
  `(^|\\.)pinterest\\.(?:${PINTEREST_TLDS.map(tld => tld.replace(/\./g, '\\.')).join('|')})$`,
  'i'
);
const PINIT_RE = /(^|\.)pin\.it$/i;

function isPinterestHost(hostname) {
  return PINTEREST_HOST_RE.test(hostname) || PINIT_RE.test(hostname);
}

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

function isLocalHost(hostname, allowLocal) {
  return allowLocal && (hostname === '127.0.0.1' || hostname === 'localhost');
}

function isImageHost(hostname, allowLocal) {
  return PINIMG_RE.test(hostname) || isLocalHost(hostname, allowLocal);
}

function fileNameFor(url) {
  let base = 'pinterest';
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
  if (!response.ok) throw new Error(`Pin page could not open (HTTP ${response.status})`);
  const html = await response.text();
  const patterns = [
    /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match && match[1]) return match[1].replace(/&amp;/g, '&');
  }
  throw new Error('No image address found on the Pin page');
}

async function resolveImageUrl(rawUrl, ses, allowLocal) {
  const parsed = new URL(rawUrl);
  if (isImageHost(parsed.hostname, allowLocal)) return parsed.toString();
  if (isPinterestHost(parsed.hostname) || isLocalHost(parsed.hostname, allowLocal)) {
    return extractOgImage(parsed.toString(), ses);
  }
  throw new Error('Only Pinterest links are supported');
}

async function downloadImage(imageUrl, ses, allowLocal) {
  const parsed = new URL(imageUrl);
  if (!isImageHost(parsed.hostname, allowLocal)) {
    throw new Error('Image is not on the Pinterest server');
  }
  if (imageUrl.startsWith('data:')) throw new Error('Data URLs are not supported');

  /* Not: referer başlığı elle verilmemeli. Chromium, isteğin kendi origin'iyle
     uyuşmayan bir Referer başlığını net::ERR_BLOCKED_BY_CLIENT ile reddediyor
     (Electron 32). Pinterest CDN'i (i.pinimg.com) referer istemiyor. */
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
    const image = await downloadImage(imageUrl, ses, allowLocal);
    return { ok: true, ...image };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : 'Image could not be fetched' };
  }
}

/* ---------- oturum ---------- */

/* Pinterest, giriş yapmış kullanıcıya da misafire de `_auth` çerezi bırakıyor
   (misafirde değeri "1"). Bu yüzden çerez tek başına yeterli değil; çerez
   ipucu vermezse sayfanın kendi oturum bilgisine bakıyoruz
   (`"is_authenticated":true`). Sonuç kısa süre önbelleklenir: panel her
   yenilendiğinde yeniden indirme olmasın. */
const AUTH_COOKIE = '_auth';
const AUTH_CACHE_MS = 30000;
let authCache = { at: 0, value: false };

async function hasPinterestLogin(ses) {
  if (Date.now() - authCache.at < AUTH_CACHE_MS) return authCache.value;

  let loggedIn = false;
  try {
    const cookies = await ses.cookies.get({ url: FEED_URL });
    const auth = cookies.find(cookie => cookie.name === AUTH_COOKIE);
    // Misafirde "1" olur; gerçek oturumda daha uzun bir jeton taşır.
    if (auth && String(auth.value || '').trim().length > 1) loggedIn = true;
  } catch { /* çerez okunamadı */ }

  if (!loggedIn) {
    try {
      const response = await ses.fetch(FEED_URL, { headers: { accept: 'text/html' } });
      if (response.ok) {
        const html = await response.text();
        loggedIn = html.includes('"is_authenticated":true');
      }
    } catch { /* ağ yok → giriş yok kabul et */ }
  }

  authCache = { at: Date.now(), value: loggedIn };
  return loggedIn;
}

/* Panelin hangi sayfayla açılacağı:
   fixture → teste özel yerel sayfa (internet gerekmez)
   feed     → giriş yapılmış, normal Pinterest akışı
   login    → henüz giriş yok, giriş sayfası */
function startFor({ isTest, loggedIn }) {
  const fixture = isTest ? process.env.TailRef_PINTEREST_URL : '';
  if (fixture) return { mode: 'fixture', startUrl: fixture };
  return loggedIn
    ? { mode: 'feed', startUrl: FEED_URL }
    : { mode: 'login', startUrl: LOGIN_URL };
}

/* ---------- gezinme güvenliği ---------- */

/* Konuk pencere yalnızca Pinterest içinde gezinsin. Panelin URL alanına veya
   Pinterest içindeki bir bağlantıya tıklanarak başka bir siteye gidilirse
   (kimlik avı / sahte giriş sayfası riski) gezinme engellenir. Test
   modunda yerel fixture adresine izin verilir. */
function isPinterestUrl(rawUrl, { allowLocal = false } = {}) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'about:' || url.protocol === 'devtools:') return true;
    if (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:')) return false;
    if (isPinterestHost(url.hostname)) return true;
    return allowLocal && isLocalHost(url.hostname, true);
  } catch {
    return false;
  }
}

/* Giriş sağlayıcıları pencereyle çalışır (Google Identity Services,
   Facebook OAuth). Bunlara yalnızca kendi alan adlarında kontrollü izin
   veriyoruz; diğer tüm popup istekleri reddedilir. */
const AUTH_POPUP_RE = /(^|\.)(accounts\.google\.com|accounts\.youtube\.com|facebook\.com|messenger\.com)$/i;

function isAuthPopup(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && AUTH_POPUP_RE.test(url.hostname);
  } catch {
    return false;
  }
}

/* ---------- diske kaydetme ---------- */

const SAVE_DIR_NAME = 'TailRef Pinterest';

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
  return base || `pinterest-${Date.now()}.png`;
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

function registerPinterest({ isTest = false } = {}) {
  const ses = () => session.fromPartition(PARTITION);

  /* Konuk sayfa normal Chrome gibi görünsün: Electron ibaresi taşımayan
     user-agent + Türkçe dil tercihi. Oturum geneline uygulanır; webview
     içindeki alt istekler (XHR, görsel, çerez) da aynı kimliği kullanır. */
  const applyIdentity = () => {
    try {
      const current = ses();
      current.setUserAgent(CHROME_UA, 'tr-TR,tr,en-US,en;q=0.9');
    } catch { /* oturum henüz hazır değilse yok say */ }
  };

  /* Panelin gezinme beyaz listesi ve giriş popup kuralları ortak konuk
     güvenlik katmanına kaydedilir (guest-guards.js). */
  registerGuestSite({
    partition: PARTITION,
    name: 'Pinterest paneli',
    isAllowed: url => isPinterestUrl(url, { allowLocal: !!isTest }),
    isAuthPopup: url => isAuthPopup(url),
  });

  ipcGuard.handle(ipcMain, 'pinterest-config', async () => {
    applyIdentity();
    const loggedIn = await hasPinterestLogin(ses());
    const { mode, startUrl } = startFor({ isTest, loggedIn });
    return {
      mode,
      loggedIn,
      startUrl,
      loginUrl: LOGIN_URL,
      feedUrl: FEED_URL,
      userAgent: CHROME_UA,
      preloadUrl: PRELOAD_URL,
      allowLocal: !!isTest,
    };
  });

  /* Giriş durumu sayfa gezinirken değişebilir (giriş yapınca `_auth` gelir).
     Panel dom-ready oldukça buradan tazeliyor. */
  ipcGuard.handle(ipcMain, 'pinterest-session', async () => {
    const loggedIn = await hasPinterestLogin(ses());
    return { loggedIn, mode: startFor({ isTest, loggedIn }).mode };
  });

  ipcGuard.handle(ipcMain, 'pinterest-fetch', async (_event, url, options) => {
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

  ipcGuard.handle(ipcMain, 'pinterest-open-folder', async () => {
    try {
      const dir = saveDirFor(isTest);
      await fs.promises.mkdir(dir, { recursive: true });
      const error = await shell.openPath(dir);
      return { ok: !error, dir, error: error || '' };
    } catch (error) {
      return { ok: false, dir: '', error: (error && error.message) || 'Folder could not open' };
    }
  });

  ipcGuard.handle(ipcMain, 'pinterest-clear', async () => {
    try {
      const current = ses();
      await current.clearStorageData();
      await current.clearCache();
      authCache = { at: 0, value: false };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : 'Could not clear session' };
    }
  });
}

module.exports = { registerPinterest, isPinterestUrl, isPinterestHost, PINTEREST_PARTITION: PARTITION, CHROME_UA };
