/* TailRef — automatic update UI (settings + top-bar chip).
   ---------------------------------------------------------
   The main process owns every update decision. This module only renders
   the state it receives and forwards explicit user actions. Installation
   asks the main process to start a save handshake; it never closes the
   window by itself. */
'use strict';

(function () {
  const api = window.tailref;
  if (!api || typeof api.updateGetState !== 'function') return;

  const byId = id => document.getElementById(id);
  const t = (key, params) => (typeof window.__t === 'function'
    ? window.__t(key, params)
    : key);

  let state = null;
  let preferences = { autoCheck: true, channel: 'latest', skippedVersion: '' };
  let installHandling = false;

  function isSupported(s) { return !!(s && s.supported); }

  function statusText(s) {
    if (!s) return t('Automatic updates are unavailable.');
    if (!s.supported) {
      if (s.reason === 'development') {
        return t('Development build - automatic updates are available in the installed release.');
      }
      if (s.reason === 'portable') {
        return t('Portable build - download the new version from GitHub to update.');
      }
      if (s.reason === 'platform') {
        /* macOS ve Linux'ta güncelleyici kapalı; her platform kendi
           güncelleme yolunu söyler. */
        const onMac = /mac/i.test(navigator.platform || '') ||
          /macintosh|mac os x/i.test(navigator.userAgent || '');
        return onMac
          ? t('Automatic updates are Windows-only. On macOS, download the new disk image.')
          : t('Automatic updates are Windows-only. On Linux, update through your package manager or download the new AppImage.');
      }
      return t('Automatic updates are not available on this platform.');
    }
    switch (s.status) {
      case 'checking': return t('Checking for updates...');
      case 'up-to-date':
        return s.message === 'skipped'
          ? t('This version is skipped. A manual check still shows it.')
          : t('You are using the latest version.');
      case 'available':
        return t('Version {v} is available.', { v: s.version || '' });
      case 'downloading':
        return t('Downloading update... {p}%', {
          p: String(Math.round((s.progress && s.progress.percent) || 0)),
        });
      case 'downloaded':
        return t('Update downloaded. Restart TailRef to install version {v}.', {
          v: s.version || '',
        });
      case 'installing': return t('Preparing to restart...');
      case 'error': return s.error || t('The update could not be completed.');
      case 'disabled':
        return t('Automatic updates are unavailable.');
      default:
        return s.autoCheck
          ? t('Ready to check for updates.')
          : t('Automatic update checks are off.');
    }
  }

  function hintText(s) {
    if (!s) return '';
    if (!s.supported) {
      if (s.reason === 'portable') {
        return t('Portable builds cannot replace themselves. Download the installer from GitHub and run it over this copy.');
      }
      if (s.reason === 'development') {
        return t('Run the installed NSIS build to receive automatic updates.');
      }
      return '';
    }
    if (s.status === 'error') {
      return t('You can try again, or download the new version from GitHub.');
    }
    if (s.status === 'up-to-date' && s.message === 'skipped') {
      return t('Skipped versions are ignored by automatic checks.');
    }
    if (s.status === 'available') {
      return t('Nothing is downloaded until you choose Download update.');
    }
    return '';
  }

  function setHidden(el, hidden) {
    if (el) el.hidden = !!hidden;
  }

  function applyState(next) {
    if (!next) return;
    state = next;
    preferences = {
      autoCheck: next.autoCheck !== false,
      channel: next.channel === 'beta' ? 'beta' : 'latest',
      skippedVersion: preferences.skippedVersion || '',
    };

    const current = byId('settingsUpdateCurrent');
    if (current) current.textContent = next.currentVersion ? 'v' + next.currentVersion : '-';

    const auto = byId('settingsUpdateAuto');
    if (auto) {
      auto.setAttribute('aria-pressed', String(preferences.autoCheck));
      auto.textContent = t(preferences.autoCheck ? 'On' : 'Off');
      auto.setAttribute('aria-label', t('Automatic update checks'));
    }

    const panel = byId('settingsUpdatePanel');
    if (panel) panel.dataset.status = next.status || 'idle';

    const status = byId('settingsUpdateStatus');
    if (status) status.textContent = statusText(next);

    const version = byId('settingsUpdateVersion');
    if (version) {
      version.textContent = (next.status === 'available' || next.status === 'downloaded' ||
        next.status === 'installing') && next.version ? 'v' + next.version : '';
    }

    const progress = byId('settingsUpdateProgress');
    const bar = byId('settingsUpdateProgressBar');
    const showProgress = next.status === 'downloading' || next.status === 'installing';
    if (progress) {
      progress.hidden = !showProgress;
      const percent = next.status === 'installing'
        ? 100
        : Math.round((next.progress && next.progress.percent) || 0);
      progress.setAttribute('aria-valuenow', String(percent));
      if (bar) bar.style.width = percent + '%';
    }

    const notes = byId('settingsUpdateNotes');
    const notesText = byId('settingsUpdateNotesText');
    const showNotes = !!(next.releaseNotes &&
      (next.status === 'available' || next.status === 'downloaded'));
    if (notes) notes.hidden = !showNotes;
    if (notesText) notesText.textContent = showNotes ? next.releaseNotes : '';

    const hint = byId('settingsUpdateHint');
    if (hint) {
      const text = hintText(next);
      hint.textContent = text;
      hint.hidden = !text;
    }

    const check = byId('settingsUpdateCheck');
    if (check) {
      setHidden(check, !isSupported(next));
      check.disabled = next.status === 'checking' ||
        next.status === 'downloading' || next.status === 'installing';
      check.textContent = next.status === 'checking'
        ? t('Checking...')
        : t('Check for updates');
    }

    setHidden(byId('settingsUpdateDownload'), next.status !== 'available');
    setHidden(byId('settingsUpdateInstall'), !(next.status === 'downloaded' && next.canInstall));
    setHidden(byId('settingsUpdateSkip'), next.status !== 'available');
    setHidden(byId('settingsUpdatePage'), isSupported(next) && next.status !== 'error');

    renderChip(next);
  }

  function renderChip(s) {
    const chip = byId('updateChip');
    const label = byId('updateChipText');
    if (!chip) return;
    let text = '';
    if (s.status === 'available') text = t('Update {v}', { v: s.version || '' });
    else if (s.status === 'downloading') {
      text = t('{p}%', { p: String(Math.round((s.progress && s.progress.percent) || 0)) });
    } else if (s.status === 'downloaded') text = t('Restart to update');
    else if (s.status === 'installing') text = t('Restarting...');
    chip.hidden = !text;
    chip.dataset.status = s.status || '';
    if (label) label.textContent = text;
    chip.setAttribute('aria-label', text || t('Update available'));
    chip.setAttribute('title', text || t('Update available'));
  }

  function openAbout() {
    const panel = byId('settings');
    if (!panel || typeof openStudioPanel !== 'function') return;
    let visible = openStudioPanel(panel);
    if (!visible) visible = openStudioPanel(panel);
    if (!visible) return;
    if (typeof settingsNavSelect === 'function') settingsNavSelect('about');
    if (typeof settingsHubSync === 'function') settingsHubSync();
  }

  async function refresh() {
    try {
      const next = await api.updateGetState();
      applyState(next);
      const prefs = await api.updateGetPreferences();
      if (prefs) {
        preferences = {
          autoCheck: prefs.autoCheck !== false,
          channel: prefs.channel === 'beta' ? 'beta' : 'latest',
          skippedVersion: typeof prefs.skippedVersion === 'string' ? prefs.skippedVersion : '',
        };
      }
    } catch { /* main process may still be starting */ }
  }

  function bind() {
    const check = byId('settingsUpdateCheck');
    if (check && !check.dataset.bound) {
      check.dataset.bound = '1';
      check.addEventListener('click', async () => {
        check.disabled = true;
        try { applyState(await api.updateCheck(true)); } catch { /* reported via state */ }
      });
    }

    const download = byId('settingsUpdateDownload');
    if (download && !download.dataset.bound) {
      download.dataset.bound = '1';
      download.addEventListener('click', async () => {
        download.disabled = true;
        try { applyState(await api.updateDownload()); } catch { /* reported via state */ }
        finally { download.disabled = false; }
      });
    }

    const install = byId('settingsUpdateInstall');
    if (install && !install.dataset.bound) {
      install.dataset.bound = '1';
      install.addEventListener('click', async () => {
        install.disabled = true;
        try { applyState(await api.updateInstall()); } catch { /* reported via state */ }
        finally { install.disabled = false; }
      });
    }

    const page = byId('settingsUpdatePage');
    if (page && !page.dataset.bound) {
      page.dataset.bound = '1';
      page.addEventListener('click', () => { api.updateOpenDownload().catch(() => {}); });
    }

    const skip = byId('settingsUpdateSkip');
    if (skip && !skip.dataset.bound) {
      skip.dataset.bound = '1';
      skip.addEventListener('click', async () => {
        if (!state || !state.version) return;
        preferences.skippedVersion = state.version;
        try { applyState(await api.updateSetPreferences({ skippedVersion: state.version })); }
        catch { /* reported via state */ }
      });
    }

    const auto = byId('settingsUpdateAuto');
    if (auto && !auto.dataset.bound) {
      auto.dataset.bound = '1';
      auto.addEventListener('click', async () => {
        const next = !(state ? state.autoCheck : preferences.autoCheck);
        try { applyState(await api.updateSetPreferences({ autoCheck: next })); }
        catch { /* reported via state */ }
      });
    }

    const chip = byId('updateChip');
    if (chip && !chip.dataset.bound) {
      chip.dataset.bound = '1';
      chip.addEventListener('click', openAbout);
    }
  }

  /* Main process asks the renderer to save before the installer runs. The
     renderer either saves, explicitly declines, or postpones. It never
     closes the window on its own. */
  if (typeof api.onUpdateInstallRequested === 'function') {
    api.onUpdateInstallRequested(async () => {
      if (installHandling) return;
      installHandling = true;
      let ready = false;
      try {
        if (!isPersistenceAuto()) {
          const dirty = typeof manualSavedHash === 'undefined' || manualSavedHash === null ||
            manualStateSignature() !== manualSavedHash;
          if (!dirty) {
            ready = true;
          } else {
            const choice = typeof api.updateInstallChoice === 'function'
              ? await api.updateInstallChoice()
              : 2;
            if (choice === 0) ready = await saveAsTail();
            else if (choice === 1) ready = true;
          }
        } else {
          await flushSave();
          ready = true;
        }
      } catch {
        ready = false;
      }
      try {
        if (ready) await api.updateInstallReady();
        else await api.updateInstallPostpone();
      } catch { /* main process decides */ }
      installHandling = false;
    });
  }

  if (typeof api.onUpdateState === 'function') {
    api.onUpdateState(next => applyState(next));
  }

  function init() {
    bind();
    refresh();
    if (window.L10N && typeof window.L10N.onChange === 'function') {
      window.L10N.onChange(() => {
        if (state) applyState(state);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
