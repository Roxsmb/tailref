'use strict';

/* TailRef — automatic update policy tests (plain Node).
   Covers the decisions that must never regress:
   • SemVer ordering (including prereleases),
   • release-note sanitising,
   • friendly error mapping,
   • strict preference validation (prototype keys dropped),
   • portable detection and backoff. */

const {
  backoffDelay,
  compareVersions,
  isNewerVersion,
  isPortableEnv,
  isValidVersion,
  mapUpdateError,
  normalizeUpdatePreferences,
  sanitizeReleaseNotes,
  sanitizeShortText,
} = require('../src/main/update-policy');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
};

/* --- SemVer --- */
ok('1.4.2 > 1.4.1', compareVersions('1.4.2', '1.4.1') === 1);
ok('1.4.10 > 1.4.9', compareVersions('1.4.10', '1.4.9') === 1);
ok('2.0.0 > 1.99.99', compareVersions('2.0.0', '1.99.99') === 1);
ok('equal versions', compareVersions('1.4.2', 'v1.4.2') === 0);
ok('prerelease is older than release', compareVersions('1.4.2-beta.1', '1.4.2') === -1);
ok('beta.2 > beta.1', compareVersions('1.4.2-beta.2', '1.4.2-beta.1') === 1);
ok('alpha < beta', compareVersions('1.4.2-alpha', '1.4.2-beta') === -1);
ok('numeric prerelease before text', compareVersions('1.4.2-1', '1.4.2-beta') === -1);
ok('build metadata ignored', compareVersions('1.4.2+build.9', '1.4.2') === 0);
ok('invalid version returns null', compareVersions('not-a-version', '1.0.0') === null);
ok('isNewerVersion true', isNewerVersion('1.5.0', '1.4.1') === true);
ok('isNewerVersion false for same', isNewerVersion('1.4.1', '1.4.1') === false);
ok('isNewerVersion false for older', isNewerVersion('1.4.0', '1.4.1') === false);
ok('isValidVersion stable', isValidVersion('1.4.2') === true);
ok('isValidVersion prerelease', isValidVersion('1.4.2-rc.1') === true);
ok('isValidVersion rejects leading text', isValidVersion('v1.4.2x') === false);

/* --- release notes --- */
ok('HTML tags stripped', sanitizeReleaseNotes('<b>New</b> brush') === 'New brush');
ok('script block stripped', !sanitizeReleaseNotes('<script>alert(1)</script>safe').includes('alert'));
ok('HTML comment stripped', sanitizeReleaseNotes('a<!-- secret -->b') === 'a b');
ok('array notes joined', sanitizeReleaseNotes([{ version: '1.4.2', note: 'One' }, { note: 'Two' }]) === 'One\n\nTwo');
ok('control characters removed', !/[\u0000\u0001]/.test(sanitizeReleaseNotes('a\u0000b\u0001c')));
ok('long notes truncated', sanitizeReleaseNotes('x'.repeat(5000)).length <= 4000);
ok('non-string notes become empty', sanitizeReleaseNotes({ nope: true }) === '');
ok('short text strips markup', sanitizeShortText('<i>Build</i> 42', 20) === 'Build 42');
ok('short text bounded', sanitizeShortText('a'.repeat(50), 10).length === 10);

/* --- error mapping --- */
ok('offline mapped', mapUpdateError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }).code === 'offline');
ok('network disconnected mapped', mapUpdateError({ message: 'net::ERR_INTERNET_DISCONNECTED' }).code === 'offline');
ok('rate limit mapped', mapUpdateError({ message: 'API rate limit exceeded (403)' }).code === 'rate-limit');
ok('checksum mapped', mapUpdateError({ message: 'sha512 checksum mismatch' }).code === 'verify');
ok('disk space mapped', mapUpdateError({ code: 'ENOSPC' }).code === 'disk');
ok('no release mapped', mapUpdateError({ message: 'No published versions on GitHub' }).code === 'no-release');
ok('cancel mapped', mapUpdateError({ message: 'download canceled' }).code === 'canceled');
ok('unknown mapped', mapUpdateError({ message: 'weird failure' }).code === 'unknown');
ok('raw error not leaked', !mapUpdateError({ message: 'secret C:\\Users\\name' }).message.includes('C:\\'));

/* --- preferences --- */
const defaults = normalizeUpdatePreferences(null);
ok('autoCheck defaults on', defaults.autoCheck === true);
ok('channel defaults latest', defaults.channel === 'latest');
ok('defaults are plain', Object.getPrototypeOf(defaults) === Object.prototype);
const prefs = normalizeUpdatePreferences({
  autoCheck: false,
  channel: 'beta',
  skippedVersion: '1.4.3',
  lastCheckAt: 1234.9,
  errorCount: 2,
  unknown: 'drop me',
  __proto__: { polluted: true },
});
ok('autoCheck accepted', prefs.autoCheck === false);
ok('beta channel accepted', prefs.channel === 'beta');
ok('skipped version accepted', prefs.skippedVersion === '1.4.3');
ok('lastCheckAt floored', prefs.lastCheckAt === 1234);
ok('errorCount accepted', prefs.errorCount === 2);
ok('unknown key dropped', !Object.prototype.hasOwnProperty.call(prefs, 'unknown'));
ok('prototype not polluted', ({}).polluted === undefined);
const badPrefs = normalizeUpdatePreferences({
  autoCheck: 'yes',
  channel: 'nightly',
  skippedVersion: '<script>',
  lastCheckAt: -5,
  errorCount: 99,
});
ok('bad autoCheck falls back', badPrefs.autoCheck === true);
ok('bad channel falls back', badPrefs.channel === 'latest');
ok('bad skipped version dropped', badPrefs.skippedVersion === '');
ok('negative lastCheckAt dropped', badPrefs.lastCheckAt === 0);
ok('errorCount capped', badPrefs.errorCount === 10);

/* --- portable / backoff --- */
ok('portable dir detected', isPortableEnv({ PORTABLE_EXECUTABLE_DIR: 'C:\\x' }) === true);
ok('portable file detected', isPortableEnv({ PORTABLE_EXECUTABLE_FILE: 'C:\\x.exe' }) === true);
ok('normal env not portable', isPortableEnv({ PATH: 'x' }) === false);
ok('null env not portable', isPortableEnv(null) === false);
ok('first backoff 30m', backoffDelay(1) === 30 * 60 * 1000);
ok('second backoff 1h', backoffDelay(2) === 60 * 60 * 1000);
ok('later backoff 4h', backoffDelay(99) === 4 * 60 * 60 * 1000);

console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
