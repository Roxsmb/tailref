'use strict';

/* TailRef — automatic update policy (PURE).
   ------------------------------------------------------------------
   This module contains every decision that does not touch Electron or
   the filesystem, so it can be tested in plain Node:

   • semantic version comparison (stable > prerelease),
   • release-note sanitising (HTML/control characters removed),
   • friendly error mapping (offline, rate limit, checksum, disk space),
   • update preference validation (strict allowlist, no prototype keys),
   • portable-build detection,
   • exponential backoff for failed automatic checks.

   The Electron-facing state machine lives in update-manager.js. */

const MAX_RELEASE_NOTES = 4000;
const MAX_SKIPPED_VERSION = 64;

const DEFAULT_PREFERENCES = Object.freeze({
  autoCheck: true,
  channel: 'latest',
  skippedVersion: '',
  lastCheckAt: 0,
  errorCount: 0,
});

/* Backoff steps for automatic checks after a failure. The first failed
   automatic check retries after 30 minutes, then one hour, then four. */
const BACKOFF_STEPS_MS = Object.freeze([
  30 * 60 * 1000,
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
]);

/** Parse a strict SemVer string (optional leading v, build metadata ignored). */
function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
    .exec(value.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return {
    major,
    minor,
    patch,
    pre: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;   // release > prerelease
  if (!b.length) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const an = /^\d+$/.test(a[i]) ? Number(a[i]) : null;
    const bn = /^\d+$/.test(b[i]) ? Number(b[i]) : null;
    if (an !== null && bn !== null) {
      if (an !== bn) return an < bn ? -1 : 1;
    } else if (an !== null) {
      return -1; // numeric identifiers sort before alphanumeric ones
    } else if (bn !== null) {
      return 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Compare two versions. Returns -1, 0, 1, or null when either is invalid. */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return comparePrerelease(pa.pre, pb.pre);
}

/** True only when both versions are valid and remote is newer. */
function isNewerVersion(remote, current) {
  return compareVersions(remote, current) === 1;
}

/** True when the string is a valid stable or prerelease SemVer. */
function isValidVersion(value) {
  return parseVersion(value) !== null;
}

function stripHtml(value) {
  return String(value)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

/** Release notes may arrive as a string or as [{version, note}]. Never
    return HTML or control characters; cap the result so a hostile release
    body cannot freeze the settings panel. */
function sanitizeReleaseNotes(value) {
  let text = '';
  if (typeof value === 'string') {
    text = value;
  } else if (Array.isArray(value)) {
    text = value.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item.note === 'string') return item.note;
      return '';
    }).join('\n\n');
  } else if (value && typeof value === 'object' && typeof value.note === 'string') {
    text = value.note;
  }
  text = stripHtml(text)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > MAX_RELEASE_NOTES) {
    text = `${text.slice(0, MAX_RELEASE_NOTES - 1).trimEnd()}…`;
  }
  return text;
}

/** Keep short metadata (release name/date) plain and bounded. */
function sanitizeShortText(value, max = 200) {
  if (typeof value !== 'string') return '';
  return stripHtml(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, max));
}

/** Map updater/network failures to language the user can act on. The raw
    error is never sent to the renderer. */
function mapUpdateError(error) {
  const text = String(
    (error && (error.code || error.name) || '') + ' ' +
    (error && error.message || error || '')
  ).toLowerCase();
  if (/no published versions|invalid release feed|channel file not found|404/.test(text)) {
    return { code: 'no-release', message: 'No published update was found for this version yet.' };
  }
  if (/net::err_internet_disconnected|enotfound|econnrefused|econnreset|etimedout|network|offline/.test(text)) {
    return { code: 'offline', message: 'Could not reach GitHub. Check your internet connection and try again.' };
  }
  if (/rate limit|403|api rate/.test(text)) {
    return { code: 'rate-limit', message: 'GitHub is temporarily limiting update checks. Please try again later.' };
  }
  if (/enospc|no space|disk full|not enough space/.test(text)) {
    return { code: 'disk', message: 'There is not enough disk space to download the update.' };
  }
  if (/sha512|checksum|integrity|signature|verification/.test(text)) {
    return { code: 'verify', message: 'The downloaded update could not be verified. Please try again.' };
  }
  if (/cancel/.test(text)) {
    return { code: 'canceled', message: 'The update was canceled.' };
  }
  return { code: 'unknown', message: 'The update could not be completed. Please try again.' };
}

/** Validate and rebuild the preferences object from a known allowlist.
    Unknown keys (including __proto__/constructor) are discarded. */
function normalizeUpdatePreferences(raw) {
  const out = { ...DEFAULT_PREFERENCES };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (typeof raw.autoCheck === 'boolean') out.autoCheck = raw.autoCheck;
  if (raw.channel === 'beta') out.channel = 'beta';
  else if (raw.channel === 'latest') out.channel = 'latest';
  if (typeof raw.skippedVersion === 'string' &&
      raw.skippedVersion.length <= MAX_SKIPPED_VERSION &&
      isValidVersion(raw.skippedVersion)) {
    out.skippedVersion = raw.skippedVersion;
  }
  if (Number.isFinite(raw.lastCheckAt) && raw.lastCheckAt >= 0) {
    out.lastCheckAt = Math.floor(raw.lastCheckAt);
  }
  if (Number.isInteger(raw.errorCount) && raw.errorCount >= 0) {
    out.errorCount = Math.min(raw.errorCount, 10);
  }
  return out;
}

/** electron-builder's portable target sets these variables. Portable
    builds cannot be updated in place, so the UI offers a download link. */
function isPortableEnv(env) {
  if (!env || typeof env !== 'object') return false;
  return !!(env.PORTABLE_EXECUTABLE_DIR ||
    env.PORTABLE_EXECUTABLE_FILE ||
    env.PORTABLE_EXECUTABLE_APP_FILENAME);
}

/** Delay before the next automatic check after `errorCount` failures. */
function backoffDelay(errorCount) {
  const n = Math.max(1, Math.min(Number(errorCount) || 1, BACKOFF_STEPS_MS.length));
  return BACKOFF_STEPS_MS[n - 1];
}

module.exports = {
  BACKOFF_STEPS_MS,
  DEFAULT_PREFERENCES,
  MAX_RELEASE_NOTES,
  backoffDelay,
  compareVersions,
  isNewerVersion,
  isPortableEnv,
  isValidVersion,
  mapUpdateError,
  normalizeUpdatePreferences,
  parseVersion,
  sanitizeReleaseNotes,
  sanitizeShortText,
};
