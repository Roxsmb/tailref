'use strict';

/* TailRef — dosya yolu güvenlik politikası (SAF).
   ------------------------------------------------------------------
   Renderer'dan gelen yollar ana süreçte yazma/okuma için kullanılmadan
   önce burada denetlenir. Amaçlar:

   • .tail açma: yalnızca yerel, mutlak ve .tail uzantılı dosyalar.
     UNC / aygıt yolları (\\server\share, \\?\C:\..., \\.\...) reddedilir;
     böylece ele geçirilmiş bir renderer SMB üzerinden kimlik sızdırma
     veya aygıt yoluna erişim başlatamaz.
   • Dışa aktarma klasörü: yalnızca kullanıcının klasör seçme penceresinde
     açıkça seçtiği (veya kaydet penceresinde onayladığı) klasörlere sessiz
     yazılır. Liste main süreçte tutulur; renderer yalnızca yol metnini
     gönderir, listeyi değiştiremez.

   Bu dosya DOM/Electron API'si kullanmaz; Node birim testiyle doğrulanır
   (tests/path-policy-test.js). */

const path = require('path');

const UNSAFE_PATH_RE = /[\u0000-\u001f\u007f]/;

/** Windows'ta sürücü harfli mutlak yol; diğer platformlarda path.isAbsolute. */
function isAbsoluteLocalPath(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || UNSAFE_PATH_RE.test(text)) return false;
  /* UNC (\\) ve aygıt (\\?\, \\.\) yollarını reddet. */
  if (/^[\\/]{2}/.test(text)) return false;
  if (process.platform === 'win32') return /^[a-zA-Z]:[\\/]/.test(text);
  return path.isAbsolute(text);
}

/** Dışa aktarma klasörünü kurallı biçime getirir; geçersizse null. */
function normalizeExportDir(value) {
  if (!isAbsoluteLocalPath(value)) return null;
  try {
    return path.resolve(value.trim());
  } catch {
    return null;
  }
}

/** Karşılaştırma anahtarı: Windows'ta büyük/küçük harf duyarsız. */
function normalizeDirKey(value) {
  const resolved = normalizeExportDir(value);
  if (!resolved) return null;
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** `value` izinli klasör listesinde mi? Liste string veya Set olabilir. */
function isAllowedExportDir(value, allowedDirs) {
  const key = normalizeDirKey(value);
  if (!key || !allowedDirs) return false;
  return Array.from(allowedDirs).some(entry => normalizeDirKey(entry) === key);
}

/** .tail açma kapısı: yerel, mutlak, .tail uzantılı dosya. */
function isTailFilePath(value) {
  if (!isAbsoluteLocalPath(value)) return false;
  return /\.tail$/i.test(value.trim());
}

module.exports = {
  UNSAFE_PATH_RE,
  isAbsoluteLocalPath,
  normalizeExportDir,
  normalizeDirKey,
  isAllowedExportDir,
  isTailFilePath,
};
