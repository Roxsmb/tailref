/* TailRef app · settings, pomodoro, YouTube Music, backup restore */
'use strict';

/* ---------------- ayarlar ---------------- */
const settingsEl = $('#settings');
const backupIntervalEl = $('#backupInterval');
const backupLimitEl = $('#backupLimit');
const backupFileInput = $('#backupFileInput');
const settingsTopEl = $('#settingsTop');

function syncSettingsTheme(name) {
  if (themeSelect) themeSelect.value = name;
  if (themeSelectOverflow) themeSelectOverflow.value = name;
  /* Tur S: Ayarlar > Appearance'daki genel tema select'i de aynı kanaldan
     beslenir (mod değişince değer güncel kalsın). */
  const themeGlobal = $('#settingsThemeGlobal');
  if (themeGlobal) themeGlobal.value = name;
  /* Mod-başına tema: hub'daki Çizim/Referans select'leri 60-settings-hub
     kendi akışıyla besler; burada dokunulmaz. */
}
const originalApplyTheme = applyTheme;
applyTheme = name => {
  originalApplyTheme(name);
  syncSettingsTheme(name);
};
syncSettingsTheme(localStorage.getItem('tailref-theme') || 'classic');

if ($('#btnSettings')) $('#btnSettings').onclick = () => {
  /* Tur S: açılış tek kapıdan — settingsHubToggle nav init + son kategori
     restore + settingsNavSelect + settingsHubSync'i yapar. openStudioPanel'i
     direkt çağırmak nav başlatmayı atlıyordu; sync zaten backupInterval,
     trashRetention ve Always on Top durumunu da tazeler. */
  window.settingsHubToggle();
};
/* ---------------- Pomodoro ---------------- */
const POMODORO_ROUNDS_KEY = 'tailref-pomodoro-rounds';

const pomodoroPanel = $('#pomodoroPanel');
const pomodoroTimeEl = $('#pomodoroTime');
const pomodoroModeEl = $('#pomodoroMode');
const pomodoroProgressEl = $('#pomodoroProgressBar');
const pomodoroStartEl = $('#pomodoroStart');
const pomodoroRoundsEl = $('#pomodoroRounds');

let pomodoroTimer = null;
let pomodoroFocus = 25;
let pomodoroBreak = 5;
let pomodoroSeconds = 1500;
let pomodoroTotal = 1500;
let pomodoroIsBreak = false;
let pomodoroRounds = Number(localStorage.getItem(POMODORO_ROUNDS_KEY) || 0);

function paintPomodoro() {
  const m = String(Math.floor(pomodoroSeconds / 60)).padStart(2, '0');
  const s = String(pomodoroSeconds % 60).padStart(2, '0');
  pomodoroTimeEl.textContent = `${m}:${s}`;
  pomodoroModeEl.textContent = pomodoroIsBreak ? 'Mola' : 'Focus mode';
  pomodoroProgressEl.style.width = `${(1 - pomodoroSeconds / pomodoroTotal) * 100}%`;
  pomodoroStartEl.textContent = pomodoroTimer ? 'Duraklat' : 'Start';
  pomodoroRoundsEl.textContent = pomodoroRounds;
}

function setPomodoroMode(focus, pause) {
  clearInterval(pomodoroTimer);
  pomodoroTimer = null;
  pomodoroFocus = focus;
  pomodoroBreak = pause;
  pomodoroIsBreak = false;
  pomodoroSeconds = focus * 60;
  pomodoroTotal = pomodoroSeconds;
  paintPomodoro();
}

function nextPomodoroPhase() {
  if (!pomodoroIsBreak) {
    pomodoroRounds++;
    localStorage.setItem(POMODORO_ROUNDS_KEY, pomodoroRounds);
  }
  pomodoroIsBreak = !pomodoroIsBreak;
  pomodoroSeconds = (pomodoroIsBreak ? pomodoroBreak : pomodoroFocus) * 60;
  pomodoroTotal = pomodoroSeconds;
  paintPomodoro();
}

function togglePomodoro() {
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = null;
  } else {
    pomodoroTimer = setInterval(() => {
      if (pomodoroSeconds > 0) pomodoroSeconds--;
      else nextPomodoroPhase();
      paintPomodoro();
    }, 1000);
  }
  paintPomodoro();
}

$('#btnPomodoro').onclick = () => openStudioPanel(pomodoroPanel);
$('#btnPomodoroClose').onclick = () => closeStudioPanel(pomodoroPanel);
pomodoroStartEl.onclick = togglePomodoro;
$('#pomodoroReset').onclick = () => setPomodoroMode(pomodoroFocus, pomodoroBreak);
document.querySelectorAll('#pomodoroPanel [data-focus]').forEach(btn => {
  btn.onclick = () => setPomodoroMode(+btn.dataset.focus, +btn.dataset.break);
});
$('#pomodoroCustom').onchange = e => {
  const n = Math.max(1, Math.min(180, +e.target.value || 25));
  e.target.value = n;
  setPomodoroMode(n, Math.max(1, Math.round(n / 5)));
};
paintPomodoro();

/* ---------------- YouTube Music ---------------- */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,}$/;

const youtubePanel = $('#youtubeMusicPanel');
const youtubeUrlEl = $('#youtubeUrl');
const youtubeLoadEl = $('#youtubeLoad');
const youtubePlayerEl = $('#youtubePlayer');
const youtubeStatusEl = $('#youtubeStatus');
const youtubeVolumeEl = $('#youtubeVolume');
const youtubeExternalEl = $('#youtubeExternal');

/** YouTube linkinden playlist ve video kimliklerini çıkarır.
    Dayanıklı ayrıştırma (kullanıcı: "hiçbir link çalışmıyor" — protokol
    eksikliği, m/y.music alt alanadları, yuvarlak çağrı URL'leri dahil):
    • protokol yoksa https:// varsay; satırsonları/baş boşlukları kırp
    • music.youtube.com, m.youtube.com, youtu.be, watch?v=, shorts/,
      embed/, live/, yotube.com (yazım hatası) biçimlerini tanır */
function youtubeIds(value) {
  let raw = String(value || '').trim();
  if (!raw) return { list: null, video: null };
  /* Kopyalanan metinde satır satır birden çok link olabilir: ilk satırı al */
  raw = raw.split(/\r?\n/)[0].trim();
  if (/^@[\w.-]+$/.test(raw)) return { list: null, video: null }; // kanal bağlantısı
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw.replace(/^\/+/, '');
  try {
    let url;
    try { url = new URL(raw); }
    catch {
      /* yazım hatası toleransı: youtbe/yotu.com → youtube.com */
      raw = raw.replace(/^https?:\/\/(www\.)?(youtub|yotub|yutu|yout)\w*\.com/i,
        (m, w) => 'https://' + (w || '') + 'youtube.com');
      url = new URL(raw);
    }
    url.hostname = url.hostname.replace(/^(m|music|gaming)\.youtube\.com$/i, 'www.youtube.com').toLowerCase();
    const list = url.searchParams.get('list') || url.searchParams.get('playlist');
    let video = url.searchParams.get('v');
    if (!video && url.hostname === 'youtu.be') {
      video = url.pathname.slice(1).split('/')[0];
    }
    if (!video) {
      /* Bozuk biçimlerde (?v= sorguda değil yolda kalmış olabilir:
         youtube.com/watch/?v=ID) ham metinde parana içindeki v= ara */
      const rawV = raw.match(/[?&]v=([A-Za-z0-9_-]+)/);
      if (rawV) video = rawV[1];
    }
    if (!video) {
      const parts = url.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v')
          && parts[1]) {
        video = parts[1];
      }
    }
    return { list, video };
  } catch {
    return { list: null, video: null };
  }
}

/** Iframe oynatıcısına YouTube IFrame API komutu gönderir. */
function youtubeCmd(func, args = []) {
  if (youtubePlayerEl.hidden || !youtubePlayerEl.contentWindow) return;
  youtubePlayerEl.contentWindow.postMessage(
    JSON.stringify({ event: 'command', func, args }),
    '*'
  );
}

function loadYoutubeMusic() {
  const { list, video } = youtubeIds(youtubeUrlEl.value);
  const key = list || video;

  /* Durum satırı dinamiktir: statik data-l10n ipucu anahtarı kaldırılır.
     Aksi halde her applyDom (dil değişimi + açılışın "load+1500ms" son
     perdesi) oynatma durumunu ipucu metnine geri ezer. */
  youtubeStatusEl.removeAttribute('data-l10n');

  if (!key || !YOUTUBE_ID_RE.test(key)) {
    youtubeStatusEl.textContent = __t('Enter a valid YouTube link');
    return;
  }

  youtubePlayerEl.hidden = false;
  youtubeExternalEl.hidden = false;
  youtubeStatusEl.textContent = list && !video
    ? __t('Playlist playing')
    : __t('YouTube playing');

  youtubePlayerEl.onload = () => {
    /* Panel ayrı penceredeyse ana oynatıcı çalmaz: ses yalnız ayrı
       penceredeki oynatıcıdan gelir. */
    if (youtubePanel && youtubePanel.dataset.detached === '1') return;
    youtubeCmd('setVolume', [+youtubeVolumeEl.value]);
    youtubeCmd('playVideo');
  };

  /* Hata 153 (oynatıcı yapılandırma): YouTube, referrer'ı olmayan gömülere
     kapatıyor — no-referrer yerine origin gönderilir; enablejsapi'ye
     eşlik etmesi önerilen origin parametresi de eklenir. */
  const detached = !!(youtubePanel && youtubePanel.dataset.detached === '1');
  const params = `autoplay=${detached ? 0 : 1}&controls=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  // youtube-nocookie.com: izleme çerezleri yerleşmeden gömülü oynatma sağlar.
  /* video + list birlikte (YouTube Music mix linkleri, watch?v=…&list=…):
     videoseries başlangıç videosunu düşürür ve mix gömülmesini reddedebilir
     (siyah ekran) — video ile list birlikte gömülür; oynatma o videodan
     başlar, çalma listesi yanında sürer. */
  youtubePlayerEl.src = list && video
    ? `https://www.youtube-nocookie.com/embed/${video}?list=${encodeURIComponent(list)}&${params}`
    : list
      ? `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}&${params}`
      : `https://www.youtube-nocookie.com/embed/${video}?${params}`;
}

$('#btnYoutubeMusic').onclick = () => openStudioPanel(youtubePanel);
$('#btnYoutubeMusicClose').onclick = () => closeStudioPanel(youtubePanel);
youtubeLoadEl.onclick = loadYoutubeMusic;
youtubeUrlEl.onkeydown = e => {
  if (e.key === 'Enter') loadYoutubeMusic();
};
youtubeVolumeEl.oninput = () => youtubeCmd('setVolume', [+youtubeVolumeEl.value]);
youtubeExternalEl.onclick = () => window.tailref?.openExternal?.(youtubeUrlEl.value);

$('#btnSettingsClose').onclick = () => closeStudioPanel(settingsEl);
backupIntervalEl.onchange = () => configureBackupInterval(backupIntervalEl.value);
/* Yedek saklama sınırı (aday 4): kalıcılık localStorage 'tailref-backup-limit';
   04-persistence-view.js autoBackup çağrısında okunur ve main'e gönderilir. */
if (backupLimitEl) backupLimitEl.onchange = () => {
  try {
    const n = Number(backupLimitEl.value);
    if (Number.isFinite(n) && n >= 1) localStorage.setItem('tailref-backup-limit', String(Math.floor(n)));
    else localStorage.removeItem('tailref-backup-limit');
  } catch { /* sessiz — özel mod vb. */ }
};

/* ---- Kalıcılık modu: karşılama diyaloğu + Ayarlar seçici ---- */
const pwEl = $('#persistenceWelcome');
const pwOptions = $('#pwOptions');
const pwContinue = $('#pwContinue');
const pwHint = $('#persistenceHint');
const persistenceSeg = $('#persistenceSeg');
let pwSelected = null;

function syncPersistenceUI() {
  const mode = getPersistenceMode();
  if (persistenceSeg) {
    for (const btn of persistenceSeg.querySelectorAll('.spSegBtn')) {
      btn.classList.toggle('is-active', btn.dataset.mode === mode);
    }
  }
  if (pwHint) pwHint.textContent = mode === 'manual'
    ? 'Saves only to the .tail file with Ctrl+S. If you close without saving, everything is gone.'
    : 'The app saves everything itself; you continue where you left off when you reopen.';
  /* Otomatik yedekleme satırı manuel modda anlamsız: soluklaştır ve devre dışı bırak. */
  if (backupIntervalEl) {
    const row = backupIntervalEl.closest('.settingRow');
    if (row) row.style.opacity = mode === 'manual' ? '.45' : '';
    backupIntervalEl.disabled = mode === 'manual';
  }
  /* Yedek saklama sınırı (aday 4): otomatik modda anlamlı — manuel modda soluklaştır. */
  if (backupLimitEl) {
    const row = backupLimitEl.closest('.settingRow');
    if (row) row.style.opacity = mode === 'manual' ? '.45' : '';
    backupLimitEl.disabled = mode === 'manual';
  }
}

function showPersistenceWelcome() {
  if (!pwEl) return;
  pwSelected = null;
  if (pwContinue) pwContinue.disabled = true;
  for (const opt of (pwOptions ? pwOptions.querySelectorAll('.pwOption') : [])) {
    opt.classList.remove('is-selected');
  }
  pwEl.hidden = false;
}

function closePersistenceWelcome(mode) {
  setPersistenceMode(mode);
  if (pwEl) pwEl.hidden = true;
  /* İlk açılışta kullanıcı "Manual" seçtiyse: init() henüz mod bilmeden
     auto varsayıp IndexedDB'den panoları yüklemiş olabilir. Manuel modda
     açılışta boş tahta gelmeli; kaydedilmemiş veri geri gelmemeli. */
  if (mode === 'manual') {
    resetToEmptyBoard();
  }
}

if (pwOptions) {
  pwOptions.addEventListener('click', (e) => {
    const opt = e.target.closest('.pwOption');
    if (!opt) return;
    pwSelected = opt.dataset.mode;
    for (const o of pwOptions.querySelectorAll('.pwOption')) o.classList.toggle('is-selected', o === opt);
    if (pwContinue) pwContinue.disabled = false;
  });
}
if (pwContinue) {
  pwContinue.addEventListener('click', () => {
    if (!pwSelected) return;
    closePersistenceWelcome(pwSelected);
  });
}
/* Esc: veri kaybını önlemek için güvenli varsayılan (auto) ile devam ettir. */
if (pwEl) {
  pwEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePersistenceWelcome('auto'); }
  });
}
if (persistenceSeg) {
  persistenceSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.spSegBtn');
    if (!btn) return;
    setPersistenceMode(btn.dataset.mode);
  });
}
/* Açılışta Ayarlar UI'ını mevcut modla senkronize et. */
syncPersistenceUI();
if (trashRetentionSelectEl) {
  trashRetentionSelectEl.onchange = () => configureTrashRetention(trashRetentionSelectEl.value);
}
settingsTopEl.onchange = async () => {
  if (!window.tailref || !window.tailref.setAlwaysOnTop) return;
  try {
    const on = await window.tailref.setAlwaysOnTop(settingsTopEl.checked);
    settingsTopEl.checked = !!on;
    if (paintTopState) paintTopState(!!on);
  } catch {
    settingsTopEl.checked = !settingsTopEl.checked;
  }
};
/* FAZ 6 B10 Not: "Canvas edge strips" (Power Sliders) anahtarı
   Ayarlar'dan kaldırıldı; çizim modu toothuluğundaki dişlinin (grip)
   "Drawing Settings" menüsünde. kaynak: draw-v5.js openPanelsMenu →
   window.inkPowerSlidersSet. */
$('#btnRestoreBackup').onclick = async () => {
  if (!window.tailref || !window.tailref.openBackups) {
    alert(__t('The backup folder can only open in the desktop app.'));
    return;
  }
  try {
    const result = await window.tailref.openBackups();
    if (result && result.ok === false) {
      try { await navigator.clipboard.writeText(result.path || ''); } catch { /* sessiz */ }
      alert(__t('Backup folder could not open.') + '\n\n'
        + __t('Path: {path}', { path: result.path || __t('unknown') }) + '\n\n'
        + __t('The path was copied to the clipboard; paste it into the address bar to open.')
        + (result.error ? '\n\n' + __t('Details: {error}', { error: result.error }) : ''));
    }
  } catch (e) {
    alert(__t('Backup folder could not open: ') + e.message);
  }
};
$('#btnChooseBackup').onclick = () => backupFileInput.click();

/* Web paneli veri temizleme: Pinterest/ArtStation oturumu (çerez +
   depolama) ve önbelleğini ana süreçteki hazır kanallarla temizler
   (persist:pinterest + persist:artstation partition'ları; app'in
   kendi oturumuna dokunulmaz). Açık bağlı panel sayfası oturum
   sonrası giriş sayfasına yönlendirilir. */
const settingsClearGuestData = $('#settingsClearGuestData');
if (settingsClearGuestData) {
  settingsClearGuestData.onclick = async () => {
    const ok = await appConfirm(
      __t('Reset the Pinterest and ArtStation sessions and caches?'),
      __t('Login data is cleared; you will need to sign in again.')
    );
    if (!ok) return;
    const api = window.tailref || {};
    const clears = [];
    try { if (api.pinterestClear) clears.push(api.pinterestClear()); } catch { /* sessiz */ }
    try { if (api.artstationClear) clears.push(api.artstationClear()); } catch { /* sessiz */ }
    if (!clears.length) {
      alert(__t('Panel session clearing is only available in the desktop app.'));
      return;
    }
    const results = await Promise.all(clears.map(p => p.catch(e => ({ ok: false, error: e && e.message }))));
    const anyFail = results.some(r => !r || r.ok === false);
    if (anyFail) {
      toast('Could not clear panel sessions', 4000);
      return;
    }
    /* Açık bağlı panel sayfalarını oturum sonrası giriş sayfasına al. */
    try {
      const pv = document.getElementById('pinterestView');
      if (pv) pv.loadURL('https://www.pinterest.com/login/');
    } catch { /* panel kapalı/yüklenmemiş */ }
    try {
      const av = document.getElementById('artstationView');
      if (av) av.loadURL('https://www.artstation.com/users/sign_in');
    } catch { /* panel kapalı/yüklenmemiş */ }
    toast('Panel sessions and caches cleared', 4000);
  };
}

/* Kayıt yükle: kaydedilen .tail dosyasını programın içine yükler
   (Ctrl+O ile aynı yol — 04-persistence-view.js openTailFile). */
const btnLoadSave = $('#btnLoadSave');
if (btnLoadSave) btnLoadSave.onclick = async () => {
  if (typeof openTailFile !== 'function') {
    alert('Save loading is not available in this version. Update the app and try again.');
    return;
  }
  try { await openTailFile(); } catch (e) {
    alert('Save could not be loaded: ' + (e && e.message || e));
  }
};

backupFileInput.onchange = async () => {
  const file = backupFileInput.files && backupFileInput.files[0];
  backupFileInput.value = '';
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!backup) throw new Error('Invalid backup');
    if (!(await appConfirm(__t('This backup will be loaded in place of the current boards. Continue?')))) return;
    /* Manuel modda canlı tahta emniyete alınsın; ardından reload flush'ı
       import edilen kaydı ezmesin. */
    if (isPersistenceAuto()) await flushSave();
    else await saveEmergencyCopy(true);
    suspendPersistenceForReload();
    try {
      await importBackupPayload(backup);
    } catch (importError) {
      resumePersistenceAfterFailedImport();
      throw importError;
    }
    location.reload();
  } catch (e) {
    alert('Backup could not be loaded: ' + e.message);
  }
};

/** Yedek listesinden geri dönülecek dosyayı seçer. Öncelik SIRASI:
    1) ana sürecin sağlık kontrolünden geçmiş, en az 60 sn önce yazılmış en yeni yedek,
    2) sağlıklı herhangi bir yedek (en yeniden eskiye),
    3) hiçbiri sağlıklı değilse null (bozuk yedeğe dönmek yerine uyar). */
function pickLatestBackup(list) {
  const sorted = (Array.isArray(list) ? list.slice() : [])
    .filter(entry => entry && entry.name)
    .sort((a, b) => b.mtime - a.mtime);
  if (!sorted.length) return null;
  const healthy = sorted.filter(entry => entry.healthy !== false);
  const cutoff = Date.now() - 60000;
  return healthy.find(entry => entry.mtime <= cutoff) || healthy[0] || null;
}

/** Sağlıksız yedeklerin neden atlandığını kısa metne çevirir. */
function describeSkipped(list) {
  const bad = (Array.isArray(list) ? list : []).filter(entry => entry && entry.healthy === false);
  if (!bad.length) return '';
  return `

${__t('{n} backups skipped (too large / too many items).', { n: bad.length })}`;
}

const btnRecoverBackup = $('#btnRecoverBackup');
if (btnRecoverBackup) {
  btnRecoverBackup.onclick = async () => {
    const api = window.tailref;
    if (!api || !api.listBackups || !api.readBackupFile) {
      alert('Restore from a backup is only available in the desktop app.');
      return;
    }
    try {
      const list = await api.listBackups();
      const pick = pickLatestBackup(list);
      if (!pick) {
        const any = Array.isArray(list) && list.length;
        alert(any
          ? __t('No healthy backup found.') + '\n\n'
            + __t('All backups look too large/too many items. With Settings → "Open archive" you can check old data or load a file manually with "Choose backup file".')
          : __t('No backups yet. Try again in a few minutes while Settings → "Auto backup" is on.'));
        return;
      }
      const when = new Date(pick.mtime).toLocaleString(navigator.language || undefined);
      const content = typeof pick.items === 'number'
        ? `${pick.items} ${__tp('item', pick.items)} · ${pick.images || 0} ${__tp('image', pick.images || 0)}`
        : '';
      const revertDetail = __t('Backup: {name}', { name: pick.name }) + '\n'
        + __t('Date: {date}', { date: when })
        + (content ? '\n' + __t('Contents: {contents}', { contents: content }) : '')
        + describeSkipped(list)
        + '\n\n'
        + __t('Current boards will be replaced by this backup; changes after the backup are lost. The current state is also stored as an "emergency" backup.');
      /* Not: eski koddaki '\\n\\n' literal bug'ı giderildi — boş satır
         artık gerçekten boş satır. */
      if (!(await appConfirm(__t('Revert to the last healthy save?'), revertDetail))) return;
      // Yanlış yedeğe karşı emniyet: mevcut durumu önce sakla.
      await saveEmergencyCopy(true);
      const raw = await api.readBackupFile(pick.name);
      if (!raw) throw new Error(__t('Backup file could not be read'));
      suspendPersistenceForReload();
      try {
        await importBackupPayload(JSON.parse(raw));
      } catch (importError) {
        resumePersistenceAfterFailedImport();
        throw importError;
      }
      location.reload();
    } catch (e) {
      alert(__t('Backup could not be restored: ') + e.message);
    }
  };
}

const btnOpenArchive = $('#btnOpenArchive');
if (btnOpenArchive) {
  btnOpenArchive.onclick = async () => {
    const api = window.tailref;
    if (!api || !api.openArchive) return;
    try { await api.openArchive(); } catch { /* sessiz */ }
  };
}
