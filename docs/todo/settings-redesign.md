# Tur S · Ayarlar (Preferences) yeniden tasarımı + genişletme — YAPILACAKLAR

> Kaynak: kullanıcı brief'i (2 bölüm: iki-panel yeniden tasarım + profesyonel
> genişletme), 14 Kasım 2026. Durum: **TAMAMLANDI — Faz 1-6, 8, 9 yeşil;
> Faz 7 kasıtlı yapılmayacaklar; kalan tek açık iş 4b.2 (ayrı tur).**
> Temel kural: mevcut işlev korunur; ID'ler ve event handler'lar değişmez;
> sahte/dekoratif kontrol YOK; her yeni ayar gerçek bir yeteneğe bağlıdır.
> Sorun çıkarsa kullanıcıya danışılacak (açık karar noktaları §9'da).

## 15 KASIM 2026 · KULLANICI HATA TURU — KAPANDI (canlı kanıtlı)

Kullanıcının bildirdiği tüm arızalar tek tek canlı instance (CDP 9399/8787)
üzerinden denetlendi; her sonuç SS + DOM ölçümüyle doğrulandı, kapılar
59/59 yeşil (settings-hub 69/69 — 6 yeni kalıcı kontrol dahil):

| Bildirim | Sonuç | Kanıt |
|---|---|---|
| Tekerlek yönü (invert) | ÇALIŞIYORDU | kapalı 1→0.6376 uzaklaştı / açık 1→1.5683 yaklaştı |
| Fırça imleci | **ÖLÜ KONTROL — düzeltildi** | `tailref-brush-cursor` yazılıyor ama okuyan kod yoktu; 3 mod canlı 4/4 (ring halka 3354 px, cross/hidden 0 px) |
| Tooltip yarısı yok oluyor | **Düzeltildi** | native `title` kaldırıldı → data-tooltip pill; canlı: pill panel içinde tam |
| Panel kenara yapışmıyor | **Düzeltildi** | bırakınca clamp + bozuk kayıt temizliği; left=5 kayıtla panel 562px'te açıldı |
| Garip garip yazı (mojibake) | **Düzeltildi** | `style.css` `⠿` + `52-native-brush-library.js` `«`; tarama temiz; canlı SS "⠿ TEXT" |
| Hap düğmeler bozuk | Kaynak sağlıklı | knop 15px, fs 0, taşma yok — şüphe: eski portable exe; masaüstüne taze kopya (SHA256 eşleşmeli) |
| Font varsayılanları çalışmıyor | Kaynak sağlıklı | 19px Georgia canlı kanıt; aynı "eski exe" açıklaması |
| UI scale %85/90/95 | **Eklendi** | gerçek zoomFactor 0.85/0.9/0.95 + 100'e dönüş |
| Footer Kaydet/Sıfırla | **Eklendi** | sessiz yazma (2 kopya dosya) + boot'ta otomatik geri yükleme |

Tasarım notu (hata değil): `settingsPanelsHide` tahta (board) modunda
bilinçli olarak etkisizdir (draw-v5 `apply()` sınıfı siler); çizim
modunda gerçekten çalışır.

## SÖZLEŞMELER (her fazda geçerli)

- S1 · Tüm mevcut kontrol ID'leri aynen korunur (aşağıdaki envanter).
- S2 · l10n mimarisi bozulmaz: `data-l10n*` → `locales/*.json` →
  `node scripts/build-locales.js` (01c elle DÜZENLENMEZ, üretilir).
  Yeni anahtarlar için en az tr çevirisi eklenir; diğer diller EN fallback.
- S3 · Açıklama metinleri `data-l10n-help` → `data-help` kanalından beslenir
  (CSS `attr()`); yeni JS/l10n kodu gerekmez.
- S4 · Tema desteği: ayar penceresi tüm temalarda okunur (var(--bg/--panel/
  --text/--dim/--border/--accent) + color-mix; sabit HEX palet yasak).
- S5 · Kalıcılık: mevcut anahtarlar (tailref-*) değişmez; yeni ayarlar için
  yeni anahtarlar, makul varsayılanlar = MEVCUT davranış.
- S6 · Ayar penceresi yüzen panel kalır (openStudioPanel / 17-floating-panels);
  başlık çubuğu sürükleme + btnSettingsClose korunur.

## FAZ 0 · DENETİM (yarısı yapıldı — envanter aşağıda)

### 0.1 · Mevcut ayar envanteri (ID → modül → kalıcılık) — TAMAMLANDI

| # | Kontrol | ID | Modül | Kalıcılık |
|---|---------|----|-------|-----------|
| 1 | Karo boyutu | settingsTileSizeSelect | 60 → inkV5Settings.setTileSize | draw-v5 köprüsü |
| 2 | 3D kalite | settingsPerfQ3dSelect | 60 → tailref-q3d-level + tailrefPose3dPerf | localStorage |
| 3 | Otomatikye dön | settingsPerfAutoBack | 60 (tile + q3d auto) | — |
| 4 | Yeniden ölç | settingsPerfRemeasure | 60 → remeasure + remeasureTile | profil sıfırlama |
| 5 | Canlı özet | settingsPerfSummary | 60 (tailref-perf-changed) | — |
| 6 | Dil | settingsLanguageSelect | 60 → L10N.setLang | tailref-lang |
| 7 | Kayıt modu | persistenceSeg | 20 → setPersistenceMode | kalıcılık modülü |
| 8 | Otomatik yedek | backupInterval | 20 → configureBackupInterval | tailref-backup-interval |
| 9 | Kayıt yükle | btnLoadSave | 20 → openTailFile (Ctrl+O) | — |
| 10 | Yedek klasörü | btnRestoreBackup | 20 → tailref.openBackups | — |
| 11 | Yedek seç | btnChooseBackup + backupFileInput | 20 → importBackupPayload | — |
| 12 | Son sağlıklı kayda dön | btnRecoverBackup | 20 → listBackups/pickLatest/saveEmergencyCopy | — |
| 13 | Her zaman üstte | settingsTop | 20 → tailref.setAlwaysOnTop | main process |
| 14 | Çizim teması | settingsThemeDraw | 60 → tailrefThemes.applyDraw | tema modülü |
| 15 | Referans teması | settingsThemeRef | 60 → applyReference | ↑ |
| 16 | Çizim panelleri (dinamik) | settingsDrawPanels | 60 → inkV5Settings.panels | draw-v5 |
| 17 | Panelleri gizle | settingsPanelsHide | 60 → setPanelsHidden | ↑ |
| 18 | Kenar şeritleri | settingsPowerSliders | 60 → setPowerSliders | ↑ |
| 19 | Fare basıncı | settingsMousePressure | 60 → setMousePressure | ↑ |
| 20 | Simetri | settingsSymSelect | 60 → setSym | ↑ |
| 21 | Şekil aracı | settingsShapeTool | 60 → setShape | ↑ |
| 22 | Panelleri sıfırla | settingsPanelsReset | 60 → inkV5Settings.reset | — |
| 23 | 3D rehber | settingsPoseGuide | 60 → poseGuide + seen anahtarı | tailref-pose3d-guide-seen |
| 24 | 3D panel sıfırla | btnPoseStackReset | 60 → tailrefPoseStackReset | tailref-pose-stack-v* |
| 25 | 3D her şeyi sıfırla | settingsPose3dReset | 60 → tailrefPose3dEverything | — |
| 26 | Çöp saklama | trashRetention | 20 → configureTrashRetention | trashRetentionMinutes |
| 27 | Arşivi aç | btnOpenArchive | 20 → tailref.openArchive | — |
| 28 | Tuş rehberi düğmesi | btnSettingsKeyHelp | 60 → inkV5Settings.keyHelp | — |
| 29 | Genel tema | (Ayarlar'da YOK; çubuk themeSelect) | 19-themes applyTheme | tailref-theme |

### 0.2 · Kalan denetim maddeleri — YAPILACAK

- [ ] main.js: pencere boyut/konum kalıcılığı var mı (Workspace kararı için).
- [ ] pose3d.js: grid/eksen/zemin/FOV/wireframe/orbit-pan-zoom sensitivite
      sabitleri var mı (3D ayarlarına GERÇEK karşılık araması).
- [ ] draw-v5 + 54-ink-stabilizer: smoothing/stabilizer setter'ları
      inkV5Settings köprüsüne açık mı (Ayarlar'a expose edilebilir mi).
- [ ] 28-ink-brush / 33-ink-stamp: pressure eğrisi/haritalama fonksiyonu var mı.
- [ ] 05-links-zoom + 14-interaction: zoom/pan sensitivite sabitleri.
- [ ] 61-perf-diag.js: ne sunuyor (Advanced/Performance Diagnostics içeriği).
- [ ] Undo limit sabiti (canvas-editor-test "30 adım" diyor) — kayıt amaçlı.
- [ ] localStorage anahtar dökümü (export whitelist için): tailref-* listesi +
      tahta verisi hangi anahtarlarda (02-state-db IndexedDB mi).
- [ ] watchThemeMenu davranışı (yeni global tema select'i için).
- [ ] ARAŞTIR: webFrame/UI zoom fizibilitesi — canvas piksel kalitesi testi.

## FAZ 1 · MİMARİ — Bölüm 1 yeniden tasarım (iki panel)

- [ ] 1.1 · #settings markup yeniden yaz (ID'LER AYNI):
      settingsHead (başlık + kategori açıklaması #settingsCatDesc +
      btnSettingsClose) / floatingPanelBody.settingsHubBody
      (settingsNav sol 178px + settingsPages sağ, yalnız sağ kayar) /
      settingsFoot (yalnız mail satırı — minimal).
- [ ] 1.2 · Nav kategorileri (buton data-cat + data-l10n-help → açıklama):
      General · Appearance · Performance · Drawing · Input & Tablet ·
      Reference · 3D Pose · Shortcuts · Storage & Backup · Accessibility ·
      Advanced · About (12 kategori — boş kategori YOK, bkz §7).
- [ ] 1.3 · CSS v2 (style.css, 8740-8798 bloğu yenilenir):
      - Nav: yarı saydam koyu zemin, aktif = accent %14 + 2px iç bar.
      - settingsGroup: subtle zemin (text %3), radius 10, satırlar hairline.
      - settingRow v2: sol ad+açıklama / sağ kontrol; açıklama HER ZAMAN
        görünür (data-help attr, 11px, muted) — "?" düğmeleri kalkar.
      - settingToggleBtn → gerçek switch (38×21 track + knob,
        aria-pressed konumlar; metin font-size:0 ile gizlenir).
        DİKKAT: action butonları (btnOpenArchive, settingsPoseGuide,
        btnPoseStackReset, settingsPose3dReset) markup'ta .settingsAction'a
        taşınır — switch olmaması için.
      - .settingsAction (+ .is-primary / .is-danger): prim=Kayıt yükle?,
        danger=Son sağlıklı kayda dön + 3D her şeyi sıfırla.
      - select: tek yükseklik 28px, width 180px sabit (sağda hizalı).
      - Eski 360px ortalama kuralı (2277) override: tam genişlik iki panel.
      - focus-visible outline, hover subtle, disabled %45.
- [ ] 1.4 · JS (60-settings-hub.js uzatılır, yeni ayrı modül DEĞİL):
      - settingsNavInit(): kategori değişimi (anında, ayarlar sıfırlanmaz),
        aria-selected, son kategori hatırlama (tailref-settings-cat),
        ok tuşlarıyla nav, header açıklaması = data-help.
      - settingsHubPopulateThemes listesine settingsThemeGlobal ekle
        (genel tema Ayarlar'a gelir; onchange applyTheme(value)).
      - 20-settings syncSettingsTheme: settingsThemeGlobal.value senkron.
      - "?" toggle döngüsü silinir (markup'ta kalmıyor).
- [ ] 1.5 · l10n: yeni anahtarlar locales/*.json'a (kategori adları, grup
      başlıkları, açıklamalar) + build-locales.js.
- [ ] 1.6 · Kabul: 29 kontrolün 28'i ID ile yerinde; sayfa açılışında tüm
      kategoriler açılıp kapanıyor; desktop-smoke + pose3d-smoke +
      projects-test yeşil.

## FAZ 2 · ÇEKİRDEK YENİ KATEGORİLER (gerçek implementasyon)

### Appearance
- [ ] Interface theme: 10 mevcut tema select'i (classic…candy) → applyTheme.
      (Dark/Light/System YOK — bkz §7.)
- [ ] Accent color: predefined swatch seti + "varsayılana dön". Uygulama:
      localStorage 'tailref-accent' + :root style.setProperty('--accent', …)
      + applyTheme sonrası yeniden uygulanır. Temaların --accent'ını
      GEÇERSİZ KILAR yalnız kullanıcı seçimi varsa.
- [ ] Density: Compact/Comfortable — data-density="compact" body class +
      az sayıda spacing CSS değişkeni (ayar penceresi + araç çubukları).
      Kapsam ARAŞTIR sonrası netleşir (tüm px'ler dönüştürülmez).

### Accessibility
- [ ] Reduce interface animations: body.reduce-motion + CSS
      (animation/transition kısma; splash + panel animasyonları dahil;
      prefers-reduced-motion zaten var — aynı kurallar sınıfa bağlanır).
- [ ] High contrast: body.hi-contrast + border/text kontrast artışı CSS
      (tema bağımsız overlay — yeni tema DEĞİL).
- [ ] UI scaling (80-125%): webFrame zoom — fizibilite testine bağlı (§9).
- [ ] Focus indicators: :focus-visible çerçevesi her kontrolde (statik CSS,
      anahtar gerektirmez; ayar değil — doğrudan uygulanır).

### Input & Tablet
- [ ] Mouse pressure buraya taşınır (Drawing'den; ID aynı).
- [ ] Stroke stabilization: inkV5Settings köprüsünde smoothing setter varsa
      Ayarlar'a expose (options-bar'daki Smoothing ile AYNI kaynağı yazar —
      ikinci doğruluk kaynağı YARATILMAZ; yoksa yapılmaz).
- [ ] Zoom/scroll sensitivite: denetimde sabit bulunursa expose; bulunamazsa
      yapılmaz.
- [ ] Tablet diagnostics: pointer türü algılama (pointer events) — salt
      bilgilendirici satır "pointerType: pen/mouse" (gerçek veri).

## FAZ 3 · YARATICI KATEGORİLER (mevcutların uzatması)

- [ ] Drawing: mevcut 8 kontrol gruplara ayrılır (Interface/Tools/Panels).
- [ ] Reference: tema + çöp saklama + arşiv (mevcut); ek: yok — import
      davranışı ayarı YOK (mevcut sürükle-bırak mimarisi değiştirilmez).
- [ ] 3D Pose: rehber + panel sıfırla + her şeyi sıfırla (mevcut); pose3d
      denetiminde (0.2) gerçek viewport/display ayarı bulunursa eklenir,
      bulunamazsa bu kategori 3 kontrolle kalır — boş not kaldırılır.
- [ ] Performance: mevcut 5 kontrol + 61-perf-diag bağlantısı (aç/köprü).

## FAZ 4 · GELİŞMİŞ

- [ ] Shortcuts: Faz 4b'deki keymap tablosundan ÜRETİLEN, gruplu +
      aranabilir yönetim arayüzü (yeniden atama, çakışma, varsayılana dön,
      profil). Tuş-rehberi tablolarının elle kopyası KALMAZ.
- [ ] Advanced: GPU/bilgi satırları (WebGL debug renderer info — gerçek
      veri), perf-diag aç düğmesi. Tehlikeli kontrol yok.
- [ ] About: sürüm (package.json), mail, logo. Gerçek bilgi.

## FAZ 5 · AYARLAR ARAMASI

- [ ] Header'a arama girişi: satır etiketleri (çözülmüş data-l10n metni) +
      data-help üzerinden arama — MANUEL liste KOPYASI YASAK.
- [ ] Sonuç: kategoriye atla + satırı vurgula (2 sn outline) + klavye
      (Enter ilk sonuç, ↑↓ gezinme), boş sonuç durumu metni.
- [ ] tr çevirili arama: data-help zaten çevrilmiş olur — otomatik çalışır.

## FAZ 6 — TERCİH İÇE/DIŞA AKTARMA + SIFIRLAMA — TAMAMLANDI (14 Kasım)

- [x] Export: localStorage tailref-* whitelist (Faz 0 dökümünden; tahta
      verisi/IndexedDB HARİÇ) → tailref-preferences.json (sürüm alanlı,
      kind+version+exportedAt). Masaüstünde save-preferences-json IPC
      (native kaydet penceresi); anchor indirmesi yedeği.
- [x] Import: JSON doğrulama + sürüm kontrol + bozuk dosyada güvenli
      hata; onay diyalogu ("şunlar içe aktarılacak"); sonra
      location.reload(). settingsPrefsApply whitelist savunması:
      dosyadaki yabancı anahtar yazılmaz.
- [x] Reset preferences: onaylı ("panolarınız etkilenmez") + whitelist
      anahtarlarını sil + reload. Kayıt/veri mimarisine DOKUNMAZ.
- [x] Kanıt: görsel test 46/46 (whitelist dışlama + reload'suz
      round-trip + doğrulama reddi); gates 56/56; l10n 3377 anahtar.


## FAZ 7 — KASITLI OLARAK YAPILMAYACAKLAR — ONAYLANDI (14 Kasım)

Her madde gerekçesiyle kasıtlı olarak yapılmadı; kategori yaratılmadı
(boş/sahte kategori yasağı):

- Dark/Light/System tema butonları → 10 temalı zengin sistem var; tek
  anahtarlık ikili modeli geriye çekmek regresyon olur.
- Color Management (çalışma uzayı/P3/profil dönüşümü) → Chromium canvas
  ICC dönüşümü açığa çıkmıyor; sahte önizleme yapılamaz.
- Privacy & Diagnostics → telemetri/analitik/kilitlenme raporu YOK;
  kategori yaratılmaz.
- Updates → autoUpdater yok (portable dağıtım); sürüm bilgisi About'ta.
- Workspace kategorisi → **main.js denetimi tamamlandı:** pencere
  boyut/konum kalıcılığı ZATEN VAR (userData/window.json, getNormalBounds
  + atomik yazım). Kullanıcı hiçbir ayar yapmadan penceresini geri
  alıyor; ayrı kategori yine gereksiz — karar doğrulandı.
- Tooltip aç/kapa + gecikme → native title tooltip CSS ile
  kapatılamaz; özel tooltip sistemi kapsam dışı.
- Font boyutu ayrı ayar → UI ölçekleme (zoom) ile aynı kanal; ayrı
  kontrol yapılmaz.


## FAZ 4b · KISAYOL ÖZELLEŞTİRME (kullanıcı kararı: yapılacak)

Merkezi keymap katmanı — mevcut modüllere gömülü tuşları tek tabloya
toplar. RİSKLİ FAZ: her adım parite kapısıyla korunur.

- [x] 4b.0 · Denetim: TÜM keydown/keyup bağlama noktalarının dökümü —
      **TAMAMLANDI (14 Kasım)**: 47 bağlama noktası bulundu, hepsi okundu.
      Tam tablo → `TODO-4b-keymap.md` (global 12 + Escape yardımcıları 7 +
      eleman-kapsamlı 28; keymap kararları: A özelleştirilebilir / B sabit
      yardımcı / C kombinasyon ilk turda sabit). Mod kapsam kuralı + pose3d
      numpad5 sorunu belgelendi.
- [x] 4b.1 · Yeni çekirdek modül (ör. 23-keymap.js):
      **TAMAMLANDI (15 Kasım)**: `23-keymap.js` — 28 eylem (16 ink delege
      + 11 tahta + 1 editör); API get/set/reset/resetAll/conflicts/all/
      actionFor/registerDelegate/signatureFromEvent/isTyping/isFixedKey;
      kalıcılık `tailref-keymap` ({version:1, actions:{}}); store
      önbellekli (keydown başına JSON.parse yok).
- [x] 4b.2 · Bağlama noktaları tabloya bağlanır (kademeli, grup grup):
      **TAMAMLANDI (15 Kasım)**: inkws delegasyonu (44-ink-workspace-
      controls; tek kaynak ink-workspace'te kalır), 15-menu-export tahta
      switch → eylem id (Delete/Escape/arrows sabit; Ctrl+G vb. akışlar
      parite korundu), 36-ink-editor geçici döndürme (R). Kombinasyonlar
      ve 3D tuşları sonraki tura (raporda belirtildi). Parite kapıları
      yeşil: ink-shortcut 17/17, ink-rotate 35/35, canvas-editor 60/60.
- [x] 4b.3 · Kural: input/textarea/contentEditable odaklıyken tek tuş
      **TAMAMLANDI (15 Kasım)**: keymap `isTyping()` koruması; test
      kanıtı: odakta 0→0 blok, blur'da +1.
- [x] 4b.4 · Ayarlar UI (Shortcuts kategorisi):
      **TAMAMLANDI (15 Kasım)**: `#settingsKeymapBoard` (11) +
      `#settingsKeymapEditor` (1) grupları; tuş yakalama (window-capture
      yutma), çakışma BLOK + yerelleştirilmiş not, Escape iptal, tekil ↺
      yalnız özelleştirilmiş satırda, toplu "Restore all defaults";
      l10n 23 anahtar × 10 dil.
- [x] 4b.5 · Tuş rehberi (inkKeyHelp + Shortcuts sayfası) TABLODAN üret:
      **TAMAMLANDI (15 Kasım)**: statik kbd'lere `data-km-help`; draw-v5
      `inkKeyHelpSyncKeys()` install + açılış + `tailref-keymap-change`
      dinleyici; B→Z→B canlı kanıt.
- [x] 4b.6 · Profil içe/dışa aktarma: Faz 6 JSON'una 'keymap' bölümü:
      **TAMAMLANDI (15 Kasım)**: export payload `keymap` bölümü; import
      doğrulama (`settingsPrefsApplyKeymap`) — bilinmeyen eylem, bozuk
      imza, sabit tuş atılır; geçerli km.set ile uygulanır. Round-trip +
      kötü veri filtresi kanıtları tmp testte.
- [x] 4b.7 · Test: tests/keymap-test.js:
      **TAMAMLANDI (15 Kasım)**: tmp-keymap-core kalıcılaştırıldı
      (18/18; SHOT_DIR temp ekran karesi) → run-gates --full 58/58 kapı
      yeşil; portable yeniden inşa; masaüstü SHA-256
      3152724C6C5A0E7F4147DBFDEA1EBFE1DE39DEE2FA40C77E0983D80F7F8A6200
      (115.006.607 bayt); CHANGELOG [1.4.1] Added bloğu yazıldı.
- [x] 4b.8 · KAPANIŞ DOĞRULAMASI (kullanıcı istemi):
      **TAMAMLANDI (15 Kasım)**: tmp-4b8-live.js — 40/40 GEÇTİ; 11
      kategorideki TÜM kontroller canlı uygulamada tek tek değiştirilip
      doğrulandı (16 çizim + 12 tahta/editör kısayol satırı dahil,
      her satır ayrı ayrı yeniden atandı ve geri döndü). Native
      diyalog açan 6 düğme (Export/Import/LoadSave/ChooseBackup/
      RestoreBackup/RecoverBackup/OpenArchive) canlı tıklama yerine
      bağlama+IPC düzeyinde doğrulandı (raporda işaretli). İşaretlenen
      bulgu: `toast()` geri bildirim işlevi kodda hiçbir yerde tanımlı
      değil — "Otomatikte geri al", "Yeniden ölç", 3D sıfırlama
      düğmelerinin eylemleri çalışıyor ama kullanıcıya görünen mesaj
      sessiz kalıyor (eylem kanıtı state/localStorage ile alındı).
      Ayrıca bilinen kısıt doğrulandı: keymap yakalamayla geri dönerken
      varsayılan tuş başka modda kullanılıyorsa (ör. board.zoom100 '1'
      ↔ ink actual '1') çakışma BLOK'una takılır; kullanıcı akışı bu
      durumda satır ↺ düğmesini kullanır (test ↺ ile doğrulandı).

## FAZ 8 — TEST & QA — TAMAMLANDI (14 Kasım)

- [x] Kalıcı kapı: tests/settings-hub-test.js — tmp-settings-visual'dan
      kalıcılaştırıldı; run-gates FULL_EXTRA zincirine girdi (57/57).
      12 kategori nav taraması, kontrol kanalları, Faz 4b.1 kısayol
      özelleştirme (yakalama→kalıcılık→geri dönüş), Faz 5 arama
      (sorgu→sonuç→kategori atlama+satır vurgusu, boş sonuç, Escape),
      Faz 6 tercih yedeği round-trip + whitelist savunması.
- [x] Etkilenen mevcut kapılar yeşil: pose3d-smoke, projects-test,
      desktop-smoke, save-on-close, overload, power-sliders,
      options-bar, smoke-test — hepsi tam zincirde koştu.
- [x] Farklı pencere boyutları: Emulation ile 1000×700 ve 720×520 —
      panel pencereye sığıyor, yatay taşma 0, nav görünür.
- [x] Kapat-aç kalıcılık: son kategori hatırlanıyor (storage testi);
      accent/reduce-motion/kısayol kalıcılığı kendi kontrolleriyle.


## FAZ 9 — PAKETLEME & RAPOR — TAMAMLANDI (14 Kasım)

- [x] CHANGELOG.md + bu dosya güncellendi (uygulanan/yapılmayanlar gerekçeli).
- [x] npm run build:portable → verify-package "PAKET GÜNCEL" (exit 0).
- [x] Masaüstü kopya + SHA-256:
      B356D297A777447B1102A1B635433B99938BC851A56F22B088003EEFA6D193BF
      (114.962.008 bayt).
- [x] Kullanıcı raporu: bu dosyadaki FAZ işaretleri + CHANGELOG.

## DURUM: KEYMAP FAZ 3a TURU (KOMBİNASYON ÖZELLEŞTİRME) TAMAMLANDI (15 Kasım) —
## 59/59 kapı yeşil; masaüstü paketi 0D7D4B12…504F (115.020.531 bayt).
## Ayarlar → Kısayollar'da 5 grup kutusu (tahta/editör/3D poz/çalışma
## modu/katman) canlı; keymap tablosu 55 eylem. Önceki tur: faz 2 3D
## pose tuşları (13 eylem) — paket AB282D1C…832. Daha önce: sektör
## standardı 3 ayar — paket 0CE220E8…D8A8.

## EK · KEYMAP FAZ 3a — KOMBİNASYON ÖZELLEŞTİRME TURU (15 Kasım) — TAMAMLANDI

İmza motoru sınırı içinde (tek karakter / Ctrl+X) kalan 14 kombinasyon
özelleştirilebilir oldu; imza motoru değişmedi, keymap tablosu
41 → 55 eylem.

- [x] core/23-keymap.js: KEYMAP_DEFS +14 — shell ×3 (ctrl+1/2/3),
      board ×7 (ctrl+z/y/a/d/s/e/o), layers ×3 (ctrl+j/]/[),
      editor +1 (editor.freeTransform ctrl+t; grup 2'ye çıktı).
- [x] Bağlama noktaları ×4: 48-shell.js mod geçişleri (keymap/legacy
      fallback; Ctrl+0 sabit), 15-menu-export.js tahta kombinasyonları
      (Ctrl+Shift+Z paritesi shift'li basışta redo; Ctrl+Shift+S 3D
      yakalama ayrımda korundu), 50-layer-stack.js katman işlemleri
      (Shift+N ve Ctrl+Shift+H sabit), 36-ink-editor.js Ctrl+T.
- [x] Ayarlar UI: boxGroups +2 (shell/layers); index.html "Workspace
      mode shortcuts" + "Layer shortcuts" kutuları; Restore-all 6 grup
      kapsıyor (ink/board/editor/pose3d/shell/layers); style.css 6
      seçici grubu güncellendi.
- [x] l10n: 13 yeni anahtar × 9 dil (+117; Undo/Redo/Select all/
      Duplicate layer mevcut çevirilerden) → build-locales 3911 →
      4028. Sıfırlama title'ı çalışma modu + katmanı kapsayacak
      şekilde güncellendi.
- [x] tests/keymap-test.js: 55 eylem + grup sayımları + FAZ 3a bloğu
      (rebind/actionFor/çapraz grup çakışma/shift imzası 'ctrl+n') +
      4b.4 render sayımları → **20/20**.
- [x] Canlı kanal (tmp-faz3a-live.js, tur sonunda silindi): dört
      bağlama noktasının gerçek keydown kanıtı — undo/redo zinciri
      (Delete→Ctrl+Z→Ctrl+Y→Ctrl+Shift+Z, casus kanıtlı), shell
      rebind (eski tuş ölü), katman çoğaltma rebind, freeTransform
      rebind (CDP girdiyle çizilen vuruşta araç değişimi),
      board.export rebind → **20/20**.
- [x] node scripts/build-locales.js + build-app + npm run
      build:portable → run-gates --full → **59/59 kapı yeşil**
      (pose3d-smoke 108/108 dahil) · masaüstü kopya:
      0D7D4B12A9817EBF03C0773B6C37FF1D955928DB930DE9EA5041891510B1504F
      (115.020.531 bayt; dist ile birebir aynı).
- [x] Tur tmp dosyaları silindi (tmp-faz3a-locales.cjs, tmp-faz3a-
      live.js, tmp-faz3a-probe.js).

## EK · KEYMAP FAZ 2 — 3D POSE TUŞLARI TURU (15 Kasım) — TAMAMLANDI

pose3d panelinin tek tuşları keymap tablosuna bağlandı; Ayarlar →
Kısayollar'da "3D pose shortcuts" grubu (13 eylem) render ediliyor.
Varsayılanlar mevcut tuşlar (parite): Q/W/E/R, X/Y/Z, A, F, 5, 0,
Ctrl+Z/Y. Numpad presetleri + Esc + Shift+F bilinçli sabit (imza
motoru temsil sınırı).

- [x] core/23-keymap.js: KEYMAP_DEFS +13 pose3d eylem (id öneki
      'pose3d.', storage 'keymap'; toplam 41).
- [x] pose3d/ui/PanelController.js bindKeys: actionFor(sig,'pose3d')
      ile çözümleme; keysActive + eski hedef-INPUT guard'ı korundu;
      keymap yoksa eski zincir fallback; Ctrl+Shift+Z paritesi özel
      (imza ctrl+z + shift → redo); undo/redo'da stopImmediatePropagation.
- [x] Ayarlar → Kısayollar: index.html'e "3D pose shortcuts" başlığı
      + #settingsKeymapPose3d kutusu; 60-settings-hub.js render
      döngüsü 3 gruba genişletildi; Restore all pose3d'i de sıfırlar;
      style.css 5 seçiciye yeni kutu eklendi.
- [x] l10n: 13 yeni anahtar × 9 dil (+117; "Move gizmo" 9 dilde
      zaten vardı — HUD çevirisi yeniden kullanıldı; "Rotate gizmo"
      mevcut çeviriyle) → build-locales 3794 → 3911. Sıfırlama
      düğmesi title'ı 3D pose'u kapsayacak şekilde güncellendi
      (yeni EN anahtar; eski anahtar sözlükte ölü kaldı).
- [x] tests/keymap-test.js: tablo 41 eylem + pose3d 13 varsayılan
      kontrolü, ayarlar sayfasında 13 satır + TR başlık,
      pose3d.move yakalama + actionFor → 19/19. Düzeltme: 4b.5
      rehber testi 'z'→'k' ('z' artık pose3d.axisZ varsayılanı —
      çakışma bloğu testi bozuyordu).
- [x] tests/pose3d-smoke.js: FAZ 2 canlı blokları — pose3d.cameraMode
      'k'ye taşınıyor (gerçek keydown 'k' modu değiştirir, '5'
      sönüyor) + Ctrl+Z undo / Ctrl+Shift+Z redo paritesi (cm.activate
      + rAF ile) → 108/108 (2 ardışık koşum).
- [x] Flake kökü kapatıldı: HUD navigasyon testlerindeki gerçek CDP
      fare olayları dış-tık kapatma tetikleyip paneli kapatabiliyordu
      (eski "numpad 5" kırmızısının nedeni); tuş testlerinden önce
      panel garantili açılıyor.
- [x] pose3d-smoke run-gates --full zincirine eklendi (58 → 59 kapı;
      kullanıcı onayıyla).
- [x] node scripts/build-locales.js + node scripts/build-app.js.
- [x] npm run build:portable → run-gates --full → **59/59 kapı yeşil
      (pose3d-smoke zincirde ilk kez, 108/108)** · masaüstü kopya:
      AB282D1C9A43D4914BCE46F65A9068E6E26AB36E823F63819D2B75C0EF782832
      (114.978.412 bayt; dist ile birebir aynı).
- [x] Tur tmp dosyaları silindi: AppData tmp-keymap-locales.cjs +
      tmp-check-prev.cjs.

## Açık iş notları (keymap faz 2 sonrası)

- Fırça imleci tercihi yalnız çizim editörünü kapsıyor; tahta çizim
  modundaki (ink) imleç ayrı dünya — oraya ring çizmek yeni bir
  overlay yüzeyi ister (kullanıcı istemedi; yalnız isterse).
- Keymap faz 3a (kombinasyonlar): TAMAMLANDI — Ctrl+Z/Y/A/D/S/E/O,
  Ctrl+1/2/3, Ctrl+J/[/], Ctrl+T özelleştirilebilir (55 eylem).
  Kalan: Shift'li kombinasyonlar (Ctrl+Shift+N/S/H/Z) imza motoru
  sınırı gereği sabit; motor genişletilirse tekrar değerlendirilir.
- Çakışmada "yer değiştir" seçeneği: force API hazır, UI'da yok.
- Sözlükte ölü anahtar: DİL DENETİMİ TURUNDA temizlendi (14 ölü +
  en.json "close" silindi; ayrıntı aşağıdaki tur bölümünde).

## DİL DENETİMİ TURU (15 Kasım) — TAMAMLANDI

9 dilde eksiksiz çeviri denetimi (l10n kuralı: anahtar = İngilizce
metin; `locales/*.json` üst düzey; `build-locales` yeniden).

- [x] Denetim: evren=1260, canlı=1259; tr eksik=0; 8 dilde ortak 875
      eksik küme (`tmp-dil-eksik.json`).
- [x] Ölü 14 anahtar silindi (tr'den 14, 8 dilde 4'er, en'den 2) +
      en.json'dan "close" (ikon adı).
- [x] 52 yeni anahtar × 9 dil eklendi (51 planlı + "Bring this item
      back to the board"); mevcut çeviriler ezilmedi; tr'de zaten
      olan 6 atlandı.
- [x] 866 anahtar × 8 dil çevrildi (de/es/fr/ja/ko/pt-BR/ru/zh-CN);
      her dil 1260 anahtar. tr 4 geride kalan sonradan eklendi
      (Gradient tool, Move or transform, Smudge tool, History
      States açıklaması) → 9 dil eksik=0.
- [x] 10 ham EN dize `__t()`'e bağlandı: 31-ink-ui.js (Hide/Show +
      Hide/Show layer + Alpha lock on/off), 39-mode.js ("Double-click
      to rename" ×3), 12-trash-images.js (Restore + "Bring this item
      back to the board"), draw-v5.js ("Other tool options" +
      item.state), 60-settings-hub.js + 62-settings-extended.js
      (On/Off).
- [x] Pas listesi (çevrilmez, bilinçli): `' + def.title + '`,
      `Canvas Editor` (pencere başlığı), `Layer `/`Layer 1`
      (varsayılan katman adları), `Redo (`/`Undo (` (birleşik
      parçalar), `100%`/`110%`/`125%` (sayısal).
- [x] build-locales: 4028 → **11374 anahtar** · app.js yeniden.
- [x] `npm run build:portable` + `run-gates --full` → **59/59 kapı
      yeşil** (keymap-test 20/20 dahil) · masaüstü kopya:
      E744C77E7CF5390113FB57CCE8BB6FA5CBEEEE1021E0B42078497F4F3DC3E5D9
      (115.088.422 bayt; dist ile birebir aynı).
- [x] Tur tmp dosyaları silindi (tmp-dil-*, tmp-yama-*, tmp-tr-ekle,
      tmp-amp-probe; kullanıcının eski tmp-* dosyalarına dokunulmadı).

## ADAY İŞLER — AYAR TURLARI (15 Kasım · kullanıcı onaylı: hepsi yapılacak)

> Sıra: keymap faz 3a ✓ → dil denetimi ✓ → bu listeden küçükten büyüğe.
> Hepsi gerçek davranış değiştiren ayarlar; sahte/dekoratif kontrol yok.

## ADAY 1 · PANO KAPATMA ONAYI (15 Kasım) — TAMAMLANDI

Ayarlar → Kayıt & Yedek → **"Ask before closing boards"**
(`settingsCloseConfirm` toggle; localStorage `tailref-close-confirm`).

- [x] `26-projects.js` closeProjectTab: `askOnClose =
      localStorage.getItem('tailref-close-confirm') !== '0'` (try/catch,
      anahtar yoksa/bozuksa = mevcut davranış); dolu panolarda onay
      metni `__t()` ile (2 parça: ad sorusu + silme uyarısı, {name} +
      {count} interpolasyon). Boş panolar onaysız kapanmaya devam.
- [x] `_renderTabs`: sekme düğmesi başlıkları `__t()`'e bağlandı
      ("… — close board", "Close board", "Double-click to rename").
- [x] `index.html` storage sayfasına settingRow + toggle eklendi
      (Backup başlığının üstünde; varsayılan aria-pressed="true").
- [x] `60-settings-hub.js`: settingsHubSync senkron + bindToggle
      (setter localStorage'a '1'/'0' yazar); `tailref-*` öneki tercih
      yedeği whitelist'ine otomatik dahil.
- [x] l10n: 6 anahtar × 9 dil = 54 girdi → her dil **1266 anahtar**;
      build-locales **11428**.
- [x] Test: settings-hub-test kalıcı kapıya toggle persistence check
      → **55/55**; canlı kanıt (tmp-onay-live.js) **7/7** — dolu pano +
      anahtar yok → confirm çıkar ve false dönerse pano durur; confirm
      true → pano bellek+diskten silinir; `0` → onay yok, hemen kapanır;
      boş pano → onay yok (parite); tr dilinde onay metni + sekme
      başlıkları çevrilmiş.
- [x] Zincir: `build:portable` + `run-gates --full` → **59/59 kapı
      yeşil** · masaüstü kopya:
      CFAF76166228AEC551378D97B5E688946F5AC1292DE33E08BB7A5BBE43A2B150
      (115.100.255 bayt; dist ile birebir aynı).
- [x] Tur tmp dosyaları silindi (tmp-onay-l10n.cjs, tmp-onay-live.js).

## ADAY 2 · WEBVIEW VERİ TEMİZLEME (15 Kasım) — TAMAMLANDI

Ayarlar → Kayıt & Yedek → **Web panelleri** →
"Reset Pinterest and ArtStation sessions" (`settingsClearGuestData`,
is-danger eylem düğmesi).

- [x] `20-settings-pomodoro-youtube.js`: düğme bağlaması — native
      confirm (2 parça `__t()`, çevrilir) → `window.tailref.
      pinterestClear()` + `artstationClear()` (main'deki HAZIR
      kanallar; sıfır yeni IPC) → açık bağlı panel sayfaları giriş
      sayfasına yönlendirilir → toast. Köprü yoksa desktop-only
      alert. Köprü contextBridge olduğundan renderer stub'lanamaz —
      çağrılar gerçek ana sürece gider (gerçek davranış).
- [x] `index.html`: storage sayfasına "Web panels" grubu + satır
      (aday 1 satırı ile Backup arası).
- [x] l10n: 9 anahtar × 9 dil = 81 girdi → her dil **1275 anahtar**;
      build-locales **11509**.
- [x] Test: settings-hub-test is-danger düğme check'i → **56/56**;
      canlı kanıt (tmp-ade2-live.js) **6/6** — confirm false → koşmaz;
      confirm true → gerçek kanallar koşar + toast; gerçek
      pinterest-clear ok=true; tr'de etiket + confirm çevrilmiş.
- [x] Ortak paket (aday 1+2): masaüstü kopya
      2E421E33C1DE3D9CDCE2A859748F46173C4238132765603F9F0149F59353B532
      (115.085.423 bayt; dist ile birebir aynı) · **59/59 kapı yeşil**.
- [x] Tur tmp dosyaları silindi (tmp-ade2-l10n.cjs, tmp-ade2-live.js).

## ADAY 3 · AÇILIŞ OTURUMU (15 Kasım) — TAMAMLANDI

Ayarlar → General → **Startup** → "Restore boards at startup"
(`settingsRestoreBoards` toggle; localStorage `tailref-restore-boards`).

- [x] `26-projects.js` _load: anahtar '0' → temiz başlat —
      `archiveAndWipeBoards()` (kurtarma akışının emniyet ilkesi:
      arşiv yazılır, IDB boşaltılır; veri kaybolmaz) + tek boş
      "Board 1" + arşiv yolu bildirimi. Anahtar yoksa/bozuksa eski
      davranış. Manuel mod kısa devresi bu daldan ÖNCE koşar
      (parite korunur).
- [x] Kurtarma uyumu: `22-init.js` — kurtarma yedeği uygulandıysa
      ("son kayda dön") `_recoveryRestoredThisBoot` bayrağı konur;
      temiz başlatma yapılmaz, kullanıcının geri dönüşü korunur.
- [x] `index.html`: General sayfasına "Startup" grubu + satır
      (tekerlek satırlarının altında).
- [x] `60-settings-hub.js`: sync + bindToggle ('1'/'0').
- [x] l10n: 3 anahtar × 9 dil = 27 girdi → her dil **1278 anahtar**;
      build-locales **11536**.
- [x] Test: settings-hub-test toggle check'i → **57/57**; canlı kanıt
      (tmp-ade3-live.js) **5/5** — anahtar yok → 2 pano geri gelir;
      `0` → tek boş pano + eski kayıtlar silindi + arşiv iki panoyu
      içeriyor + bildirim; anahtar geri açılınca boş başlangıç; `0` +
      kurtarma yedeği → yedek kazanır (temiz başlatma yapılmaz).
- [x] Ortak paket (aday 1+2+3): masaüstü kopya
      71112EE255E69EB7BB590E085225854C55FFEA270A4BE9D19A3663B8280FEE04
      (115.074.181 bayt; dist ile birebir aynı) · **59/59 kapı yeşil**.
- [x] Tur tmp dosyaları silindi (tmp-ade3-l10n.cjs, tmp-ade3-live.js).

## ADAY 4 · YEDEK SAKLAMA POLİTİKASI (15 Kasım) — TAMAMLANDI

Ayarlar → Kayıt & Yedek → Backup grubu → **"Keep automatic
backups"** (`#backupLimit` select; localStorage `tailref-backup-limit`;
5 / 10 / 20 / 50 — varsayılan 20 = mevcut davranış).

- [x] `src/main/main.js`: `autoBackupKeepCount(limit)` — 1–200 clamp,
      geçersiz/eksik → fallback 20 (parite). auto-backup handler 2.
      argümanı kabul eder; silme `files.slice(keep)` ile en yenileri
      saklar. `good\` (GOOD_BACKUPS_KEPT=3) ve `emergency-*.json`
      rotasyonu sınırdan bağımsız.
- [x] `src/preload/preload.js`: `autoBackup(payload, limit)` imzası.
- [x] `src/renderer/core/04-persistence-view.js`:
      `backupLimitFromSettings()` — localStorage değeri temizse 2.
      argümanla gönderir; yoksa/bozuksa gönderilmez → main fallback 20.
- [x] `index.html`: storage Backup grubuna `#backupLimit` select
      (backupInterval yanına).
- [x] `20-settings-pomodoro-youtube.js`: bind (geçersizse removeItem) +
      manuel modda backupInterval ile birlikte soluklaştırma/disabled;
      otomatik modda geri açılır.
- [x] `60-settings-hub.js`: settingsHubSync senkronu (kayıt yoksa '20').
- [x] l10n: 2 anahtar × 9 dil = 18 girdi (build-locales 11653 →
      11671 → son 11824).
- [x] Test: canlı kanıt (tests/tmp-ade4-live.js) **8/8** — limit
      yok → 22 yedekten 20 kalır + healthy=true; limit=5 → 5;
      'abc' → fallback 20; limit=3 → kökte 3; `good\` sabit 3;
      `#backupLimit` kalıcılığı 10→20; `settingsHubSync()` kayıt
      yokken 20. Kalıcı kapı: settings-hub-test +1 check ("Yedek
      saklama sınırı") → **58/58**.
- [x] Zincir: build-locales + build-app + `build:portable` +
      `run-gates --full` → **59/59 kapı yeşil** · masaüstü kopya:
      BC0A0B0AB4F2DAB570728F7CB81B65BCAE5DB29E885A6DC0F699B14E00FE6515
      (115.095.703 bayt; dist ile birebir aynı).
- [x] Ek düzeltme (aynı tur, kapı testinin yakaladığı yarış):
      `canvas-editor:maximize` ve `window-toggle-max` — maximize()
      sonrası anlık isMaximized() okuması eski değeri döndürebiliyordu;
      hedef durum önce hesaplanıyor → canvas-editor-test **60/60**.

## ADAY 5 · TABLET BASINÇ PROFİLİ (15 Kasım) — TAMAMLANDI

Ayarlar → Giriş & Tablet → **"Pressure curve"** (`#settingsPressureProfile`
select; localStorage `tailref-pressure-profile`; soft / linear / hard —
varsayılan linear = mevcut davranış, bit bit parite).

- [x] `28-ink-brush.js`: `inkPressureProfileExp` (soft → 0.55,
      hard → 1.8; yok/bozuk/linear → 1) + `inkCurvePressure` artık
      eğriyi ÇARPAR: fırça eğrisi (options bar) ayrı kalır, ikisi
      birlikte etkiler. `window.tailrefPressureProfileSet` köprüsü
      (anında etki; restart yok).
- [x] `index.html`: input sayfasının en üstüne "Pressure curve" satırı
      (fare basıncının üstünde; help metni linear/soft/hard anlamını
      anlatır).
- [x] `60-settings-hub.js`: sync `settingsHubSync` içinde (kayıt
      yoksa 'linear') + onchange bind (write + anında setter; geçersiz
      değer yazılmaz).
- [x] l10n: "Pressure curve / Soft / Linear / Hard" anahtarları 9 dilde
      hazır (tr: Basınç eğrisi / Yumuşak / Doğrusal / Sert); yeni girdi
      gerekmedi — build-locales **11833**.
- [x] Test: canlı kanıt (tests/tmp-ade5-live.js) **7/7** — linear bit
      bit kimlik; soft hamdan dolgun (0.4 → 0.6041), hard ince
      (0.4 → 0.1922); seçici kalıcılığı + anında etki; **GERÇEK vuruş**
      (tahta-içi kalem vuruşu, test kapısıyla): hard'da 0.25 → ilk
      nokta p=0.0825 ≈ 0.25^1.8; sync kayıt yokken 'linear'. Kalıcı
      kapı: settings-hub-test +1 check ("Tablet basınç profili") →
      **59/59**.
- [x] Zincir: build-locales + build-app + `build:portable` +
      `run-gates --full` → **59/59 kapı yeşil** · masaüstü kopya:
      A760B02B79131CD3AF6965A2F2C89F5CA8B4CBCF99B43D63246F20E2B81EC177
      (115.111.736 bayt; dist ile birebir aynı).
- [x] Tur tmp dosyaları silindi (tmp-ade5-kontrol.cjs, tmp-ade5-l10n.cjs,
      tests/tmp-ade5-live.js).

## ADAYLAR 6-9 · ZOOM ODAĞI + METİN VARSAYILANLARI + ORTAM EFEKTİ + IZGARA/SNAP (15 Kasım) — TAMAMLANDI

Tek turda dört küçük ayar (hepsi parite: anahtar yoksa/bozuksa eski
davranış bit bit korunur):

- [x] **Aday 6 — İmleç odaklı zoom** (`src/canvas-editor/editor.ts`
      `onWheel`; `tailref-zoom-cursor`): görüntü editöründe Ctrl+tekerlek
      '1' → imlecin altındaki nokta yerinde kalır; yoksa mevcut merkez-
      sabit zoom. Ayarlar → Çizim ("Cursor-anchored zoom", varsayılan Off).
- [x] **Aday 7 — Yeni metin varsayılanları** (`01-bootstrap.js`
      `tailrefTextDefaults()` + `__TailRef_TEXT_FAMILIES` whitelist;
      `10-items.js addText`; `06-render.js` textSig + `t.style.fontFamily`;
      `15-menu-export.js drawTextItem` export fontu; anahtarlar
      `tailref-text-default-size` / `tailref-text-default-family`):
      punto 8-400 clamp, aile güvenli listeden. Ayarlar → General
      ("New text defaults"; boş = uygulama varsayılanı).
- [x] **Aday 8 — Ortam efektleri** (`19-themes-effects.js`
      `ambientEffectsOn/Stop`; `tailref-ambient-effects`): yağmur/karı
      animasyonları "Hareketi azalt"tan bağımsız aç/kapa; '0' iken
      tema yeniden uygulansa bile koşmaz; setter ile canlı geri başlar.
      Ayarlar → Görünüm ("Ambient effects", varsayılan On).
- [x] **Aday 9 — Izgara aralığı + tahta yapışması** (`editor.ts
      drawGrid` gridStep 16-256 clamp, major = 8 katı, anahtar
      `tailref-ce-grid-step`, varsayılan 64; `03-geometry-snap.js
      boardSnapOn()` + `14-interaction.js` sürükleme snap'i Alt ||
      kapalıysa atlanır, anahtar `tailref-board-snap`): Ayarlar → Çizim
      ("Editor grid step" 32/64/128/256) + General ("Snap on board").
- [x] `index.html`: 4 sayfada 6 yeni ayar satırı; `60-settings-hub.js`:
      sync (`settingsHubSync`) + bind'ler (toggle/select/onchange).
- [x] l10n: 14 yeni anahtar × 9 dil = 126 girdi (tr dahil) —
      build-locales **11959**.
- [x] Test: canlı kanıt (tests/tmp-ade6-9-live.js) **18/18** — aday 7
      parite/gerçek/DOM/bozuk-fallback (6), aday 8 yağmur piksel kanıtı
      (4), aday 9 snap gap=0/serbest gap=8 + ızgara kolon taraması
      base 9 / 256px 3 / 32px 17 (2+2), aday 6 merkez-sabit vs imleç-
      sabit screenToDoc kanıtı (2). Kalıcı kapı: settings-hub-test
      +4 check → **63/63**.
- [x] Zincir: build-locales + build-app + build-canvas-editor +
      `build:portable` + `run-gates --full` → **59/59 kapı yeşil** ·
      masaüstü kopya:
      B00C4B4515122AE48A3570F1EFC2EE5BD57CFD4826CE4D92395BDF987CE27078
      (115.118.674 bayt; dist ile birebir aynı).
- [x] Tur tmp dosyaları silindi (tmp-l10n-ade6-9.cjs,
      tests/tmp-ade6-9-live.js).

## DİNAMİK DİL DÜZELTMELERİ (15 Kasım) — TAMAMLANDI

Kullanıcı şüphesi ("her dili tek tek baktın mı") üzerine derin
denetim: sözlük + `__t()` kusursuzdu; sorun dinamik yazarlarda —
dil değişince yenilenmeyen sert string'ler + 32 eksik sözlük anahtarı.

- [x] `01b-l10n.js` applyElement: data-l10n-title → data-tooltip
      kanalı (16-toolbar title taşımasına merkezi çözüm).
- [x] 11 modüle `L10N.onChange` yeniden koşma kaydı + yazarlar
      `__t()`'ye sarıldı: 48-shell (durum çubuğu/dock tooltip'leri),
      04-persistence-view (sayaç), 42/43-ink-workspace (yoğunluk
      notu), 39-mode (mod çubuğu), 26-projects (yeni pano başlığı +
      limit bildirimi), 12-trash-images (çöp rozetleri),
      31-ink-ui (katman paneli), 05-links-zoom (bağla düğmesi),
      06-render (seçim çubuğu tooltip'leri), 22-init (tam ekran
      düğmesi), 15-menu-export (bağlam menüsü 7 etiket).
- [x] 50-layer-stack ('Select a drawing layer', 'Layer Properties —
      {name}'), 49-draw-proto ('N image'), 60-settings-hub ('Auto → ',
      'Currently: Tile {tile} · 3D {q3}' parametreli).
- [x] l10n: 32 anahtar × 9 dil → her dil **1310 anahtar** (toplam
      11824; en.json identity dokunulmadı).
- [x] Kanıt: tests/tmp-dil-canli.js **31/31** — her dil tek tek:
      sözlük 10 blok, ≥1000 anahtar, seçicide 10 seçenek, 15 örnek
      anahtar sözlükle birebir, tam DOM sweep temiz (ham İngilizce
      kimlik kalmadı; özdeş çeviri + saf sayı etiketleri süzgeçte),
      kalıcılık.

## ADAY İŞLER — KALAN LİSTE (küçükten büyüğe)

Güçlü adaylar:

1. ~~Pano kapatma onayı~~ — ✓ ADAY 1 TAMAMLANDI (yukarıda).
2. ~~Webview veri temizleme~~ — ✓ ADAY 2 TAMAMLANDI (yukarıda).
3. ~~Açılış oturumu~~ — ✓ ADAY 3 TAMAMLANDI (yukarıda).
4. ~~Yedek saklama politikası~~ — ✓ ADAY 4 TAMAMLANDI (yukarıda).
5. ~~Tablet basınç eğrisi~~ — ✓ ADAY 5 TAMAMLANDI (yukarıda).

Orta adaylar:

6. ~~**Zoom imleç odağı** — Ctrl+tekerlekte "imlece yakınlaştır" anahtarı
   (çizim/görünüm); mevcut merkez-sabit davranış varsayılan kalır.~~ —
   ✓ ADAY 6 TAMAMLANDI (yukarıda).
7. ~~**Yeni metin varsayılanları** — punto/aile (tahta sayfası).~~ —
   ✓ ADAY 7 TAMAMLANDI (yukarıda).
8. ~~**Ortam efektleri anahtarı** — yağmur/karı "hareketi azalt"tan
   bağımsız aç/kapa (görünüm).~~ — ✓ ADAY 8 TAMAMLANDI (yukarıda).
9. ~~**Izgara ayarı** — çizim editörü ızgara aralığı + tahtada yapışma
   (snap) seçeneği.~~ — ✓ ADAY 9 TAMAMLANDI (yukarıda).

## EK · NAV SAYFA GEÇİŞİ BUG TURU (15 Kasım) — TAMAMLANDI

Kullanıcı bildirimi: sol nav'da kategoriye (Görünüm/Çizim/Gelişmiş/
3D Poz…) tıklayınca sağdaki sayfa değişmiyordu; vurgu + üst açıklama
değişiyor, içerik General'de takılı kalıyordu.

- [x] Kök neden: `.settingsPage{display:flex}` kuralı `[hidden]`
      UA kuralını görsel olarak eziyordu — 12 sayfa üst üste hep
      görünürdı; settingsNavSelect'in `page.hidden` yazması
      görüntüyü değiştirmiyordu. (style.css 4614 notundaki tuzak
      deseninin aynısı; `.settingsPage[hidden]` kuralı eksikti.)
- [x] Düzeltme: `.settingsPage[hidden]{display:none}` eklendi
      (style.css, .settingsPage kuralının yanına; tek satır CSS,
      JS değişikliği yok).
- [x] Canlı kanıt: tests/tmp-nav-click-live.js — GERÇEK fare girdisi
      (CDP Input.dispatchMouseEvent) + elementFromPoint overlay
      kontrolü + hesaplanmış display ölçümü; 12 kategori 25/25.
      (Tur 4b.8 testi hidden özniteliğini okuduğu için bu körlüğü
      yakalayamamıştı — testin kendisi de kördü.)
- [x] Kalıcı kapı güçlendirildi: tests/settings-hub-test.js nav
      sayfa ölçümleri (kategori döngüsü, FAZ 8 taraması, yeniden
      açma) `hidden` özniteliğinden hesaplanmış `display`'e
      geçirildi → 49/49.
- [x] locales + app.js yeniden derlendi (build-locales, build-app).
- [x] EK · toast() bildirim kanalı (aynı tur): core/26-projects.js
      global window.toast → showProjectNotice + gösterim anında __t;
      9 bildirim anahtarı 9 dile eklendi (+81; EN identity);
      canlı test tests/tmp-toast-live.js 4/4 (EN metin, TR metin,
      otomatik kaybolma). Bu sayfadaki "toast bulgusu" kapandı.
- [x] npm run build:portable yeniden koşuldu (toast dahil paket).
- [x] run-gates --full ikinci koşum → 58/58 kapı yeşil (tek flake
      ink-select-check; tek koşumda 11/11 doğrulandı) ·
      verify-package "PAKET GÜNCEL" · masaüstü kopya:
      43AD818DCBB6FFBF85613CC3D8C342517B58B08EBB2AFA3740619626F93962E1
      (114.974.863 bayt; dist ile birebir aynı).
- [x] Tur tmp dosyaları silindi: tests/tmp-nav-click-live.js,
      tests/tmp-toast-live.js, AppData tmp-toast-locales.cjs +
      tmp-nav-css.ps1.

## EK · SEKTÖR STANDARDI AYARLAR TURU (15 Kasım) — KOŞUMDA

Kullanıcı isteği: önerilen 3 "olmazsa olmaz" sektör standardı ayar
tek tura eklendi. Sıra: fırça imleci → undo sınırı → tekerlek
tercihi (undo için önce gerçek büyüme davranışı ölçüldü: üç yığında
da sınır + eviction VAR — editör History 30 adım + 192 MB byte
bütçesi, tahta çizim 60 raster-drop, tahta öğeleri 60; eksik olan
sınırın kullanıcıya açılmasıydı).

- [x] Tekerlek tercihi: core/01-bootstrap.js yardımcıları
      (tailrefWheelZoom/WheelInvert/UndoLimit — parite: anahtar yoksa
      mevcut davranış); core/15-menu-export.js tahta tekerleği
      zoom→pan + Ctrl her zaman zoom; core/49-draw-proto.js minitahta
      doğal yön; Ayarlar → General ("Mouse wheel" grubu, 2 toggle).
- [x] Undo adım sınırı (Photoshop History States karşılığı):
      tailref-undo-steps (5–200; boş = yığın kendi sınırı) → dört
      yığın: canvas-editor History (PSCE.resolveHistoryLimit +
      constructor), 04-persistence-view.js, 34-ink-undo.js,
      36-ink-editor.js (while-loop eviction; sınır düşürülünce hemen
      boşaltılır). Undo başlığındaki sabit "/30" gerçek sınıra
      geçti. Ayarlar → Performans ("Undo step limit").
- [x] Fırça imleci: tailref-brush-cursor (ring varsayılan / cross /
      hidden); canvas-editor drawCursor + canvas-editor.css
      body.ce-cursor-hidden; Ayarlar → Çizim ("Brush cursor").
      Tahta çizim modu ayrı imleç dünyası — bu turda editör kapsamı
      (aşağıdaki açık işe not edildi).
- [x] l10n: 12 anahtar × 9 dil (+108; EN identity) → build-locales
      3686 → 3794.
- [x] Canlı test tests/tmp-sector-live.js 17/17: yardımcı clamp'leri,
      GERÇEK CDP tekerleğiyle tahta zoom/pan/invert (hesaplanan
      state.view), editörde undo-steps=5 + 7 vuruş → yığın 5 +
      başlık "/5", fırça imleci 4 mod geçişi (halka piksel ölçümü,
      hidden cursor=none). Ders: persistenceWelcome diyaloğu üstteyken
      gerçek wheel girdisi yutuluyor — önce kapatılmalı.
- [x] Kalıcı kapı: settings-hub-test.js +5 kontrol (UI etkileşimiyle
      kalıcılık, clamp, yeniden açılış senkronu) → 54/54.
- [x] run-gates --full → 58/58 kapı yeşil (ink-select-check flake
      olmadan ilk denemede 11/11) · verify-package "PAKET GÜNCEL" ·
      masaüstü kopya:
      0CE220E8A0A4FDBD159EA91E6074AE919040866271AA768071754B89BAD0D8A8
      (114.981.953 bayt; dist ile birebir aynı).
- [x] Tur tmp dosyaları silindi: tests/tmp-sector-live.js +
      AppData tmp-sector-locales.cjs.

## Açık iş notları (sektör standardı turundan — güncellendi)

- Fırça imleci tercihi yalnız çizim editörünü kapsıyor; tahta çizim
  modundaki (ink) imleç ayrı dünya — oraya ring çizmek yeni bir
  overlay yüzeyi ister (kullanıcı istemedi; yalnız isterse).
- pose3d-smoke 2 kırmızı: ÇÖZÜLDÜ (bu tur) — "numpad 5" flake kökü
  panel görünürlüğüydü (testte garantili açılıyor); "bağlı tutamaç
  kemiği izleme" iki koşumda yeşildi, düzeltme gerekmedi. Kanal
  zincire alındı (59 kapı).
- Keymap faz 2: TAMAMLANDI (bu tur) — kalan: faz 3 (kombinasyonlar),
  çakışmada "yer değiştir" seçeneği (yukarıda).


