'use strict';

/* Dış bağlantı kapısı — IPC 'open-external' için TEK doğrulama noktası.
   Renderer keyfi URL gönderebilir; yalnız bilinen https hedefleri açılır.
   Yeni bir dış hedef eklenecekse allowlist burada büyütülür ve
   tests/external-links-test.js güncellenir. */

const ALLOWED_EXTERNAL_HOSTS = [
  /(^|\.)youtube\.com$/,
  /(^|\.)youtu\.be$/,
  /(^|\.)youtube-nocookie\.com$/,
  /(^|\.)buymeacoffee\.com$/,
];

function isAllowedExternalUrl(raw) {
  try {
    const parsed = new URL(String(raw));
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_EXTERNAL_HOSTS.some(rx => rx.test(parsed.hostname));
  } catch {
    return false;
  }
}

/** Doğrulanmış URL'yi kurallı biçimde döndürür; reddedilirse null. */
function normalizeExternalUrl(raw) {
  if (!isAllowedExternalUrl(raw)) return null;
  try {
    return new URL(String(raw)).toString();
  } catch {
    return null;
  }
}

module.exports = { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl, normalizeExternalUrl };
