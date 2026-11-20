# Tur T · Tema + Arayüz Özelleştirme Sistemi — YAPILACAKLAR

> Kaynak: kullanıcının tam teknik spec'i (2 katman: Tema = görsel palet,
> Arayüz = tam bileşen tasarım dili; Windows 95 referans dönüşüm).
> Durum: **FAZ 1 MİMARİ DENETİM TAMAMLANDI (15 Kasım 2026).**
> Temel kurallar: mevcut işlev korunur; sahte/dekoratif kontrol YOK;
> tema ve arayüz sistemleri bağımsız; canlı geçiş (restart yok);
> veri güvenliği — görünüm değişikliği asla veri kaybettirmez.

## FAZ 1 · MİMARİ DENETİM — BULGULAR (tamamlandı)

### 1.1 · Mevcut tema motoru (`19-themes-effects.js`)
- **Tema veri yapısı YOK** — yalnızca isim dizisi (satır 5):
  `['classic','obsidian','midnight','cutting-mat','graphite','paper','forest','rain','snow','candy']`
  (10 tema; classic varsayılan).
- Uygulama: `data-theme` attribute (`classic` → attribute kaldırılır);
  `tailref-theme` localStorage; boot'ta geri yükleme (satır 219-220).
- Tema tanımı tamamen `style.css`'te: `:root[data-theme="X"]` bloğu.
- **Mod-başına tema**: `tailref-theme-draw` / `tailref-theme-reference`
  (çizim ve referans modlarının kendi temaları); 3D modda tema değişmez.
- Ortam efektleri: rain/snow tam pencere canvas'ları, tema koşullu.
- Public API: `window.tailrefThemes = { names, get, set, modeNow, applyDraw, applyReference }`.

### 1.2 · Token mimarisi (`style.css` + 4 CSS katmanı)
- `:root` temel palet **7 tema değişkeni**: `--bg, --panel, --border,
  --text, --dim, --accent, --accent-ink` (+ ikinci `:root` bloğu 1411-1425
  "Sequoia" efektif classic değerlerini verir — data-theme onu geçer).
- **Türev katmanları (hepsi core 7'den color-mix ile üretilir, bağımsız
  palet yok)**: `--glass-*` (Liquid Glass), `--bar-*` (toolbar dock),
  `--ps-*` (ui-shell.css, 34 token), `--v5-*` (draw-v5.css, 32),
  `--ink-*` (çizim modu, ~24 + boyut tokenları), `--vp-*` (3D viewport),
  `--motion-*`/`--ease-*` (10 hareket tokenı).
- Toplam ~89 benzersiz custom property. Prefix disiplini: yalnız alt
  kozlarda (`--ce-`, `--ps-`, `--v5-`, `--ink-`); ana uygulamada yok.
- **Yeni tema maliyeti**: 7-değişken blok + `#backdrop` kuralı + diziye
  isim + option ≈ 15-25 satır. Türev katmanlar otomatik döner.
- **Açık tema riski**: `paper` örneği — ~20 ek düzeltme kuralı istiyor.

### 1.3 · Accent override sistemi (özel temalar için hazır model)
- `62-settings-extended.js`: `tailref-accent` → `:root` **inline style**
  override (`--accent` + `--accent-ink`) → tüm temaları ezer.
  "Temaya dön" = removeProperty + anahtar silme. data-accent kanca.
- **Özel temalar için bu model şablon**: inline style override +
  dataset kanca + localStorage anahtarı.

### 1.4 · Canvas editor — ayrı pencere, sabit tema
- `canvas-editor.css:15-29` kendi `--ce-*` 14 token'ı; **ana temaya
  hiçbir bağlantı yok** (her zaman koyu). Tema/Arayüz sistemi için
  bilinçli karar gerekiyor (bağlama vs. dışarıda tutma).

### 1.5 · Ayarlar altyapısı (`60-settings-hub.js` + `62-settings-extended.js`)
- 12 kategori: `general, appearance, performance, drawing, input,
  reference, pose3d, accessibility, shortcuts, storage, advanced, about`.
- Yeni kategori maliyeti: 1 nav düğmesi + 1 `<section data-page>` +
  (isteğe bağlı) binding + l10n. **Nav/sayfa/arama generik** — arama
  dizini DOM'dan kurulur, yeni satırlar otomatik dahil.
- Kalıcı kontrol kalıbı: HTML satır → idempotent binding
  (`dataset.extBound`) → `settingApplyX()` dataset+localStorage →
  boot'ta uygulama → `settingsExtSync()` panel açılışında.
- Kalıcılık yedeği: `settingsPrefsKeys()` **önek filtresi**
  (`tailref-`/`tailref:` TÜM anahtarlar) → yeni anahtarlar otomatik
  yedeklenir; IndexedDB kullanıcı verisi asla dahil edilmez.

### 1.6 · Pencere chrome
- Frameless (`frame:false, transparent`), **toolbar = title bar**
  (`#bar` drag region), pencere düğmeleri IPC (`22-init.js` →
  `window.tailref.minimize/toggleFullscreen/close`).
- Çizim modunda ikinci set: `#appModeBar` içinde `btnDrawMin/Max/Close`.
- Native menü YOK (`Menu.setApplicationMenu(null)`); context menu özel
  (`15-menu-export.js renderContextMenu`); toast özel
  (`#projectNotice`, `window.toast`); confirm = native `window.confirm`.

### 1.7 · Yüzen paneller
- `floatingPanelSelector` (17-floating-panels.js:645): settings,
  pomodoro, youtube, pose3d, pinterest, artstation, imageEditor, help,
  inspector, itemBar, contextMenu (+ trashPanel kendi konumlandırıcısı,
  overflowMenu sabit). Ortak yüzey: `.floatingPanelHead/Body`,
  detach-to-window (panel-window.js DOM kopyası!).

### 1.8 · Scrollbar + form bileşenleri
- Scrollbar stilleri style.css'te **~20 lokasyona** dağılmış.
- Toggle: `settingToggleBtn` (aria-pressed + ::after knob); checkbox:
  `settingCheck`; select/slider/number native; color = custom swatch
  radiogroup. **Arayüz sistemi için bunlar bileşen sözleşmesinin
  hedef listesi.**

## FAZ 2 · MİMARİ TASARIM — KARARLAR (öneri; uygulanacak)

### 2.1 · İki bağımsız kayıt defteri
- **Tema kaydı** (`01-theme-registry.js` yeni core modülü):
  - Gömülü 10 tema mevcut motorla KORUNUR (19-themes-effects.js
    dokunulmaz — parite).
  - Özel temalar: `tailref-custom-themes` (JSON: {id, name, colors{7},
    backdrop{type,pos,scale,opacity,blur}, createdAt}) — inline style
    override ile uygulanır (accent modeli şablon; dataset
    `data-custom-theme`).
  - API: `tailrefThemeRegistry.list/apply/save/duplicate/delete/rename`.
- **Arayüz kaydı** (`02-interface-registry.js` yeni core modülü):
  - `tailref-interface` anahtarı, `'classic'` varsayılan (parite).
  - Uygulama: `documentElement.dataset.interface = id` + arayüze özel
    CSS dosyasının dinamik enable/disable'ı (`<link data-ui-skin>`).
  - Arayüz sözleşmesi: her preset {id, name, desc, version, tokens{},
    skinHref, fixed{}} — `fixed` = kimlik koruyan zorunlu tokenlar
    (Win95 bevel/typography/proportions temadan bağımsız sabit).
- **Bağımsızlık (spec PART 5)**: `tailref-theme` ve `tailref-interface`
  ayrı anahtarlar; birini değiştirmek diğerine dokunmaz.

### 2.2 · Token katmanları
- Tema tokenları = mevcut 7 çekirdek (kullanıcı özelleştirilebilir).
- Arayüz tokenları = YENİ `--ui-*` öneki: `--ui-font, --ui-fs-base,
  --ui-radius, --ui-bevel, --ui-border-w, --ui-btn-h, --ui-titlebar-h,
  --ui-icon-size, --ui-scrollbar-w ...` — arayüz tanımından yazılır,
  tema paletinden renk alır (`color-mix(var(--panel)...)` köprüsü
  korunur). Classic arayüzü `--ui-*`'ı mevcut değerlere eşler
  (görsel değişiklik YOK).

### 2.3 · SGI IRIX arayüzü (Faz 4) — preset kararı güncellendi
- **Güncelleme (16 Kasım 2026, v3):** kullanıcı kararıyla preset
  **Windows 98 → SGI IRIX (4Dwm / Indigo Magic Desktop)** çevrildi.
  Kimlik/tanımlayıcılar kökten yeniden adlandırıldı: `data-interface="irix"`,
  dosyalar `ui-irix.css` / `ui-irix-ce.css` / `irix-shell.js`,
  sınıf önekleri `--irix-*` / `irix-`; registry adı "SGI IRIX 4Dwm"
  (kaynak: `core/02c-interface-registry.js` — app.js build ÇIKTISI).
  localStorage'da eski 'win98' değeri artık eşleşmez → classic'e düşer.
- **IRIX görsel dili (kullanıcı spesifikasyonu):** yüzey #7E828C,
  bevel üçlüsü #B8BCC6/#383A40/#1E2024 (Motif 3px ridge + 1px derin
  dış çerçeve), aktif başlık #3B446B indigo (alt. #5B2C45 plum token'ı
  hazır), inaktif #6A6D77, seçim #D9A441 gold + koyu metin,
  terracotta #C84B31 (kapat hover/danger), workspace petrol #245363.
  Helvetica stack, başlık çubuğu bold italic, radius 0, chunky scrollbar.
- **Yer korunumu (kullanıcı kuralı):** panel konum/boyut override'ları
  SİLİNDİ (#barDock top:104, #projectBar top:72, #inkDocSize bottom:52);
  rect parite: yalnız appModeBar farkı (tam genişlik indigo başlık —
  mockup gereği); diğer tüm paneller aynı merkez/y/height.
- Görev çubuğu/durum çubuğu blokları CSS'ten silindi (öğeler yok).
- Swatch muafiyeti: evrensel button kuralına `:not(.inkColorChip):
  :not(.v5-color-swatch):not(.v5-opt-color)`; chip'ler inline hex +
  düz kare (mockup'a uygun). Faz 10 parite bloğu: ref-zoom düz etiket,
  fırça kartları beyaz tile + gold aktif ring, opt-brush beyaz slot.
- Kanıt: aud-c1..4 / aud-i1..4 (8 ekran), zoom-titlebar2 (dither aktif
  sekme + raised pencere düğmeleri), rect-parity diff, GATES 13/13,
  portable SHA `5851D6C5BE6EC5687A2AE48E9E69D40DF1973E80BE1C67DC46F2FB939DD37DD6`
  = masaüstü kopyası. Orijinal Win98 plan metni aşağıda.

### 2.3.1 · IRIX v4 turu (16 Kasım 2026 — kullanıcı geri bildirimi)
- **Üst şerit classic'e döndü:** tam genişlik indigo başlık YOK;
  appModeBar classic konumunda compact 4Dwm penceresi (face + bev-window).
  #brand override silindi (classic yerleşim). Global menü çubuğu
  (#uiMenuBar) CSS + irix-shell.js kurulumundan tamamen silindi —
  4Dwm'de global menü yoktur (ripserve IRIX referansları doğruladı).
- **4Dwm pencere çerçevesi:** --irix-bev-window'a dış halkalar eklendi
  (0 0 0 1px dark / 0 0 0 3px hilite / 0 0 0 4px shadow) — TÜM paneller
  ve toolbar'lar gerçek IRIX pencereleri gibi kalın çerçeveli (kullanıcı
  onayladı). CE editor (#ce-titlebar vs.) dahil.
- **Renkler aydınlatıldı (v4 paleti):** face #868B96, hilite #C3C7D1,
  shadow #40444D, dark #1D2026, desktop #26586A. CE tokenları eşitlendi.
- **Saydamlaştırma + tema değişimi çalışır hale geldi:** opak workspace
  pinleri (#stage/#board/#world/body) SİLİNDİ; IRIX teal default'u
  `:where([data-interface="irix"]) #backdrop` (spesifikasite (1,0,0))
  ile verildi → [data-theme] kuralları (1,1,0) ezebilir. bgOpacity
  slider inline opacity yazar (CDP ile 0.35 doğrulandı), obsidian
  teması IRIX'te de applyTheme ile zemin değiştiriyor (CDP doğrulandı).
  --bg:var(--irix-desktop) köprüsü body/html'i teal boyar.
- **Classic'te çizim modunda tema arka planı (rain/snow):** iki ayrı
  opacity:0 kapanı kaldırıldı — draw-v5.css VE draw-proto.css'teki
  `body.mode-draw #backdrop/#rainCanvas/#snowCanvas{opacity:0}` blokları
  silindi; her iki dosyada `#inkEditor` transparent !important.
  (İlk denemede yalnız draw-v5.css düzeltilmiş, draw-proto.css ikinci
  kopya olduğu için yağmur hâlâ görünmüyordu — piksel yoklamasıyla
  bulundu.) Rain artık çizim masasında da yağıyor (ekran kanıtı:
  probe-draw.png / v4-a-classic-rain-draw.png).
- **IRIX'te çizim masası bilinçli teal pinli kalır**
  (#inkEditor → --irix-desktop) — kullanıcı isteği classic için verdi.
- **Performans denetimi (çizim modunda yağmur):** rAF sayacı, tüm
  senaryolarda 170 fps vsync tavanı: ref+rain / draw+rain /
  draw+classic / fırça darbesi sırasında fark ≤2 fps. CPU throttle 4x:
  delta 0; 6x (çok yavaş laptop simülasyonu): darbe sırasında
  162→155 fps (delta 7, ikisi de 60 Hz çok üstü). Darboğaz YOK;
  yine de ortam efektleri anahtarı (tailref-ambient-effects) vana.
- Kanıt: v4-a/b/c ekran seti, perf-check + perf-throttle ölçümleri,
  rect-parity (appModeBar x/width metrics farkı dışında konum özdeş),
  GATES 13/13, portable SHA
  `7799B97A2325185BF8BB1FFE54CD486CFA3E4911580F3220341144FDDE86E820`
  = masaüstü kopyası eşleşti.

### 2.3.2 · IRIX v5 turu (16 Kasım 2026 — ikinci geri bildirim turu)
- **Tema galerisi seçili halkası (GERÇEK BUG):** `63-theme-studio.js`
  6 yerde tanımsız `themeStudioSync()` çağırıyordu (doğru ad
  `settingsThemeStudioSync`) → her kart tıklamasında ReferenceError;
  tema uygulanıyor ama aria-pressed halkası HİÇ güncellenmiyordu ve
  Kaydet akışının sync'i de ölüydü. replaceAll ile düzeltildi; CDP
  testinde halka artık aktif temayı takip ediyor.
- **Tema editor Background → backdrop canlı:** `themeStudioApplyPreview`
  önizlemede backdrop'ı boyamıyordu (yalnız --bg inline). Artık
  backdrop görselsizken `backgroundColor = draft.bg` inline yazılır
  (CDP: #123456 → backdrop anında). Kaydet'te üretilen kural zaten
  bg'den gradyan kurar.
- **Radial menü (sağ tık) IRIX kasması:** cam disk backdrop-filter
  blur(26px) + saturate, IRIX bevel'lı slot içeriği her hover
  karesinde yeniden blur → "kasa kasa". Faz 11 bloğu: disk düz yüzey +
  bev-window, slotlar 1px dil + gold aktif halka (5 katman bevel +
  conic dither blur altında yeniden raster edilmez). Ölçüm: hover
  IRIX 170 fps = CLASSIC 170 fps.
- **Çerçevesiz kalan yüzeyler:** `#pose3dPanel .poseSection`
  (Görsel/Kamera/Poz kartları) ve `body.mode-draw #inkColorPanel`
  (renk çarkı paneli — modern yumuşak gölge vardı) → bev-window.
  Layers/Brush (.v5-panel) zaten çerçeveliydi; kullanıcının
  "çerçevesiz/Ayarlar ince/chip gri" ekranları eski exe'den (5851D6C5)
  — mevcut build probe'larında hepsi doğru.
- Kanıt: diag-irix/diag2/final-check probe çıktıları,
  radial-irix2.png, GATES 13/13, portable SHA
  `74E63BAF1E71FEFD367023BE3799CF7628A3AE9E2C9A6992FD0740A40A2E771B`
  = masaüstü kopyası eşleşti.
- **Güncelleme (16 Kasım 2026):** kullanıcı kararıyla preset **Windows 98**
  (dosya adları `ui-win98*`; Win95 yerine Win98 = aynı bevel sistemi +
  DÜZ lacivert başlık çubuğu, gradyan YOK). Orijinal plan metni aşağıda.
- **Yeni CSS dosyası `src/renderer/ui-win95.css`** — inkâr edilemez
  kimlik: `#win95` grilesi, raised/sunken bevel (outset/inset 2px,
  hilite #fff + shadow #808080 + dark #000), MS Sans Serif yığını
  (MS Sans Serif → Tahoma → Segoe UI fallback), kare köşeler, gradient
  yasak, radius 0.
- Kapsam (spec PART 3): title bar (#bar + appModeBar), context menu,
  overflow/panels menüsü, ayar paneli + tüm form bileşenleri (toggle →
  gerçek checkbox görünümü, select → klasik, scrollbar → ok düğmeli),
  yüzen paneller (Pomodoro/YouTube/Pinterest/ArtStation/3D/help),
  inspector/itemBar, çizim editörü panelleri, dialog/toast, status.
- Davranış KORUNUR: aynı ID'ler, aynı event, klavye, erişilebilirlik.
- Canlı geçiş: dataset + skin link toggle; açık panel/konum koruması
  (floating panel konumu dataset'ten bağımsız zaten kalıcı).

### 2.3.3 · IRIX v5 üçüncü tur (16 Kasım 2026 — üçüncü geri bildirim turu)
- **Dock'a kenetlenen panel çerçevesi KAYBOLMA kökü (gerçek bug):**
  `#v5LeftDock/#v5RightDock` `overflow-y:auto + overflow-x:hidden` →
  `.v5-panel`'in dışına taşan 4Dwm halkaları (1px koyu + 3px açık +
  4px gölge) dock padding-box dışında KIRPILIYORDU. Yüzen panel
  (Brush Library gibi) çerçeveli görünürken kenetlenen panel
  çıplak kalıyordu ("sağ tarafa koyunca çerçeve yok oluyo").
  Çözüm (Faz 13): dock'a yalnız DIŞ tarafta + üstte 5px halka payı;
  genişlik aynı miktarda dışa büyütüldü (border-box) → panel iç
  konumu/genişliği birebir korundu; panel araları (gap 12 ≥ 5+5)
  halkayı zaten taşıyordu. Probe: dockW 345, panel halkası görünür.
- **Son kullanılan renkler ızgarası (yeni özellik):** renk paneli
  şeridinin sağ ucuna aşağı ok (`.v5-recents-toggle`, chevron) —
  tıklayınca altında 96'ya kadar son kullanılan rengin 24px
  mozaik ızgarası açılır (`.v5-recents-grid`, ~6 sıradan fazlası
  ızgara içinde kayar), tekrar tıklayınca kapanır (aria-expanded +
  is-open ile ok 180° döner). Boş listede ok disabled. Recents
  kapasitesi 8 → 96 (store anahtarı aynı, geriye uyumlu). Renkler
  stroke commit'inde eklenir (draw-v5.js `stroke.color → addRecent`).
- **Recents chip griliği:** chip'ler sınıfsız olduğu için IRIX
  evrensel buton kuralı onları da bevel grileştiriyordu →
  `.v5-recents-chip` sınıfı + muafiyet zincirine
  `:not(.v5-recents-chip)`; IRIX'te 1px koyu kenar + radius 0,
  is-current altın halka.
- Kanıt: dock-recents-check / recents-check2 probe çıktıları,
  full-draw.png + recents-colors.png (chip'ler renkli, şerit =
  ızgara 24px eşit boyut), GATES 13/13, portable SHA
  `0B8977BACD9CD5ED2EF25171D08E080283C80506869008663284AB1C83D45368`
  = masaüstü kopyası eşleşti.

### 2.4 · Paket mimarisi temeli (Faz 6)
- Format: `.tailref-ui.json` — tek dosya, dekleratif, sürümlü:
  `{format:"tailref-ui@1", meta{name,author,version,desc}, tokens{},
  colors{compatible:bool}, rules[]}` — **CSS string yalnız
  whitelist property adlarıyla** veya dekleratif token haritası.
- Güvenlik: JS yürütme YOK; boyut limiti; alan doğrulama (schema);
  asset yalnız data:image/* URI; path yok. Doğrulama hatasız → yükle.
  (İçe aktarım UI'sı Faz 6'da; şimdilik kayıt defteri + doğrulayıcı.)

### 2.5 · Ayarlar entegrasyonu (Faz 5)
- `appearance` sayfası genişler: tema bölümü (gömülü liste + özel tema
  yönetimi + görsel yükle + palet çıkarma + önizleme) VEYA yeni
  `interface` kategorisi ayrı (spec 8.1/8.2 iki ayrı alan ister).
  Karar: **tema = appearance içinde yeni bölüm; arayüz = yeni
  `interface` kategorisi** (bölünme net).
- Görsel yükleme + palet çıkarma: yerel canvas median-cut (harici
  servis yok); önizleme → kullanıcı onayı → özel tema olarak kaydet
  (mevcut tema ASLA otomatik ezilmez).

## FAZ PLANI
- [x] Faz 1 — mimari denetim (bu belge)
- [x] Faz 2 — token + kayıt defteri iskeleti — **TAMAMLANDI (15 Kasım 2026)**:
      `02b-theme-registry.js` (özel tema motoru: CRUD + üretilmiş CSS
      kuralları `:root[data-theme="ct_*"]` + themeNames runtime uzantısı +
      median-cut palet + downscale), `02c-interface-registry.js` (classic
      kaydı + `<link data-ui-skin>` enable/disable + register()), style.css
      sonunda `--ui-*` token katmanı (classic değerleri = görsel parite).
- [x] Faz 3 — tema sistemi — **TAMAMLANDI (15 Kasım 2026)**:
      `63-theme-studio.js` + index.html appearance bölümü (galeri + 7 renk
      editörü + panel opaklığı + görsel yükleme/fit/opaklık/blur + palet
      çıkarma + taslak önizleme + onaylı overwrite) + hub senkronu +
      tr.json 46 anahtar (build-locales: 10 dil · 12009).
      **Kanıt:** `tests/theme-studio-test.js` 11/11 (CDP, izole profil):
      galeri 10 kart, obsidian anında uygulama, özel tema kaydı ile
      accent/depo/üretilmiş kural gerçek değişimi, themeNames guard,
      kopyala/yeniden adlandır/sil, aktif silince classic'e düşüş, palet
      çıkarma (3 renk · 7 slot), görsel arka plan computed kanıtı,
      gömülü 10 tema zarar görmedi, arayüz kaydı classic parite +
      bilinmeyen arayüz reddi. run-gates.js FULL zincirine eklendi.
      Canlı instance SS: "Gece Moru" özel teması tüm arayüzde + üst bar
      tema seçicisinde (kendi gözle incelendi); kullanıcının kendi
      temasına (rain) geri yüklendi. Not: reg.save doğrudan çağrıda taslak
      inline override kuralı gölgeler — Kaydet her zaman UI düğmesi
      (themeStudioClearInlinePalette) üzerinden gitmeli (test betiklerinde
      bile). settings-hub rejresyonu: 69/69.
- [x] Faz 4 — arayüz sistemi (Classic koruma + tam Win98 kabuğu) — **ÇEKİRDEK TAMAMLANDI (16 Kasım 2026)**:
      Preset kararı: **Windows 98** (kullanıcı: "win98 bir tema değil; program
      sanki Win98'de çalışıyor gibi" — tam kabuk dönüşümü; Win98 = Win95
      bevel sistemi + DÜZ lacivert başlık çubuğu, gradyan Win95'e aittir).
      Dosyalar: `ui-win98.css` (tokenlar + bevel + tüm ana pencere
      bileşenleri), `ui-win98-ce.css` + `ce-skin.js` (canvas editor),
      `w98-shell.js` (YENİ: menü çubuğu + görev çubuğu köprüsü — her öğe
      MEVCUT gerçek kontrole bağlı: File/Edit/View/Tools/Window/Help →
      btnNewProject/btnAdd/btnLoadSave/btnExport/btnOpenArchive/btnText/
      btnGroup/btnArrange/btnLock/btnLink/btnZoomOut/btn100/btnFit/btnTop/
      btnGrid/btnTool*/btnPalette/btnPanelsBar/settingsHubToggle/btnPomodoro/
      btnYoutubeMusic/btnPinterest/btnArtStation/#help; Start = #btnPanelsBar
      gerçek Paneller menüsü; saat = gerçek Date). Kapsam kanıtlı:
      lacivert tam genişlik başlık çubuğu (#appModeBar + #brand solda),
      menü çubuğu dropdown'ları, sekme şeridi (#projectBar), araç çubuğu
      (#bar gri bevel + raised .tbtn + sunken zoom + sarı tooltip),
      durum çubuğu (#psStatusBar — 4 Kasım gizleme kararı win98'de
      mockup gereği açıldı), görev çubuğu (Start + 5 görev + gerçek saat),
      bağlam menüsü, ayarlar (select/Save düğmeleri !important ile
      kazanıldı — ID'li temel kurallar specificity ile eziyordu),
      New canvas diyaloğu, 3D tool window'lar (.poseStackItem → lacivert
      summary + gri gövde + sunken viewport), canvas editor (titlebar/
      panel başlıkları lacivert, sunken alanlar).
      **Kanıt (CDP, izole profil, kendi gözle incelendi):**
      M1-M4/F1-F2 + T1-T4 SS'leri. Metrikler: barBg rgb(192,192,192)+
      radius 0+MS Sans Serif; select/save gri; menü çubuğu 6 üst öğe +
      File dropdown 5 gerçek öğe; görev çubuğu Start+5+saat \d{2}:\d{2};
      3D poseStackItem summary rgb(0,0,128); boot kalıcılığı (reload
      sonrası dataset=win98 + menü çubuğu kurulu); classic dönüş
      teardown (menü/görev çubuğu sökülür, dataset yok, cam yüzey geri).
      Kapılar: build-app 64 kaynak ✔, theme-studio 11/11, settings-hub 69/69.
      Kalan rötuş: çizim workspace iç panelleri (ink) detay skin'i,
      3D fullscreen'de menü/görev çubuğu görünürlüğü kararı.
- [x] Faz 5 — Ayarlar entegrasyonu + bağımsızlık testleri — **TAMAMLANDI (16 Kasım 2026)**:
      Ayarlar'a `interface` kategorisi (nav düğmesi + `<section data-page="interface">`:
      #settingsInterfaceGallery radiogroup + #settingsInterfaceActive etiketi);
      60-settings-hub.js'e `settingsHubPopulateInterfaces()` (settingsThemeCard
      kartları — builtin/package tag, click → window.tailrefInterfaces.apply(id),
      hata → toast; skin'siz tanım zaten reddedilir, sahte kart YOK) +
      settingsHubSync içinden çağrı + `tailref-interface-changed` listener'ı
      (mod/perf listener'larının yanında — galeri canlı tazelenir).
      l10n: tr.json + build-locales (Interface/Interface design/Live switch/
      built-in/package/Interface could not be applied + yardımcı metinler;
      diğer diller EN'ye düşer).
      **Bağımsızlık kanıtı (tests/interface-registry-test.js — YENİ kapı,
      run-gates FULL zincirine eklendi; 6/6 ✔):** Win98 kart tıklaması →
      dataset=win98 + depo + aria-pressed + aktif etiket + skin açık;
      BAĞIMSIZLIK A: applyTheme('forest') → data-theme=forest AMA interface
      hâlâ win98; BAĞIMSIZLIK B: apply('classic') → interface temizlendi
      AMA data-theme hâlâ forest; skin'siz 'fake-ui' reddi (false).
      **Canlı kanıt turu (CDP + SS, kendi gözle incelendi):** P1 Interface
      kategorisi (2 kart: Classic seçili + Windows 98 açıklamalı + Live
      switch satırı), P2 ayarlar AÇIKKEN Win98 kartına tıkla → arka plan
      canlı Win98'e döndü (lacivert başlık + menü çubuğu + görev çubuğu +
      durum çubuğu), settings penceresi de Win98 diyaloğuna dönüştü;
      classic kartı → canlı dönüş (dataset yok, cam yüzey geri).
      Kapı sayısı güncellemesi: settings-hub-test nav beklentisi 12 → 13.
      Kontrast rötuşu (kanıt: P2 son hâli): skin, .settingsPage + .settingsFoot
      içeriğine siyah metin dayatır (temanın --dim grisi gri zeminde soluk
      kalıyordu; ::after yardım metinleri dahil).
      **Zincir sonu (16/17 Kasım 2026):** run-gates --full tamamen yeşil
      (PURE 14 + FULL 48 kapı; verify-package için önce portable yeniden
      üretildi — kaynak değişmişti). Portable: `npm run build:portable` →
      dist\TailRef_Studio.exe 109.8 MB → masaüstü kopya SHA256
      `9E77750C5F89AC511BC5CDA742472D7F88CA2CE1703FF42A4A41669DAA989660`
      (eski 730953FF… exesinin yerini aldı — Faz 4+5 kodu pakettedir).
      tmp temizliği: diag-w98-*.js + win98/hub SS klasörleri + eski tur
      profil klasörleri silindi (keymap/theme/win95 SS arşivleri durur).
- [x] Faz 6 — paket formatı + doğrulayıcı — **TAMAMLANDI (16 Kasım 2026)**
  - `core/02d-ui-package-format.js`: SAF doğrulayıcı + derleyici (JS
    yürütme YOK). Format `tailref-ui@1`; property whitelist (position/
    display yasak — yerleşim değiştirilemez); seçicide `{};@<` yasak;
    değerlerde `url(`/`expression(`/`javascript:` yasak; asset yalnız
    `data:image/*`; paket ≤ 64 KB. Derleme: kurallar `!important` ile
    (skin otoritesi emsali) + önek–seçici arasına torun boşluğu ŞART.
  - `core/02e-ui-package-store.js`: depo `tailref-ui-packages`
    ({id,text}, toplam 256 KB) + boot self-heal (bozuk paket düşer) +
    importText/removePackage/renderInstalled + FileReader import UI.
  - `scripts/ui-package-validate.js` CLI kapı: **11/11 ✔** (run-gates
    PURE'a eklendi). `tests/ui-package-test.js` electron kapı: **9/9 ✔**
    (import → enjeksiyon → kart apply → hesaplanan stil kanıtı → reload
    kalıcılığı → 5 güvenlik reddi → duplicate id → unregister builtin
    koruması → remove). run-gates FULL'a eklendi.
  - Regression düzeltmesi: `02c` refactor'da `uiInterfaceSkinToggle`
    LINK dalı `skin.disabled = on` idi (TERSİNE — on:true iken kapatıyordu);
    `skin.disabled = !on` oldu; interface-registry-test **6/6 ✔**.
  - Bootstrap `JSON.parse(store[i])` bug'ı düzeltildi (depo öğesi zaten
    nesne; `entry.text` parse edilir — aksi hâlde her açılışta paketler
    sessizce siliniyordu).
  - **Zincir sonu (16 Kasım 2026)**: run-gates --full — tüm kapılar
    yeşil; tek kırmızı verify-package (kaynak değişmişti) → portable
    yeniden üretildi → verify-package "PAKET GÜNCEL" ✔. Masaüstü kopya
    SHA256 `74DB10D7A7B4F2E0D5D65103A3B809FEB2544C4CD73C4F9016508611EB6C6C38`
    (109.8 MB — eski 9E77750C… exesinin yerini aldı; Faz 6 kodu pakette).
    Portable duman testi ✔: launcher `--remote-debugging-port` iletir,
    CDP açılır, `tailrefUiPackages`/`tailrefUiPackageFormat` pakette,
    builtin kayıt `classic,win98`, taze profil classic başlar.
    tmp temizliği: 22 diag betiği + 21 tur profili silindi.
- [x] Faz 7 — odak dışı başlık grisi + mod × arayüz kapıları —
      **TAMAMLANDI (16 Kasım 2026)**
  - Odak dışı pencere: `w98-shell.js` + `ce-skin.js` window
    blur/focus'ta `:root.w98-window-inactive` yazar (gerçek odak
    durumu — sahte/dekoratif durum YOK). CSS: `ui-win98.css` +
    `ui-win98-ce.css` inactive caption grisi (`--w98-title-inactive`
    #808080, token Faz 4'te hazır bekliyordu); kapsam: `#appModeBar`
    (başlık), `.floatingPanelHead`, `#pose3dPanel` summary, CE
    `#ce-titlebar` + `.ce-panel-head`.
  - `tests/interface-modes-test.js`: **8/8 ✔** (run-gates FULL'a
    eklendi): win98 başlık lacivert + kabuk kurulu → gerçek blur ile
    başlık/panel başı rgb(128,128,128) + focus ile geri → mod turu
    @win98 (reference→3D→draw[yeni tuval formu]→reference; her adımda
    dataset.mode + kabuk duruyor) → classic'te kabuk tam sökülür +
    mod turu çökmesiz → reload'ta win98 + kabuk yeniden kurulur.
  - Rejresyon emsalleri: interface-registry 6/6, ui-package 9/9.
  - Zincir dersi: tam zincirde pencere önceki kapıların pencere
    kalıntılarından gerçekten odak kaybedebiliyor → odak gerektiren
    doğrulamalardan önce `window.dispatchEvent(new Event('focus'))`
    ile taban durumu normalize edilir (test belirsizliği, ürün hatası
    değil); düzeltme sonrası zincirde 8/8.
  - **Zincir sonu (16 Kasım 2026)**: run-gates --full — **64/64 kapı
    yeşil**. Portable yeniden üretildi → verify-package "PAKET GÜNCEL"
    ✔. Masaüstü kopya SHA256
    `6CB891615D3567CA0130656E12EBACED7033746D7743A47D195E22D5994E032B`
    (109.8 MB — eski 74DB10D7… exesinin yerini aldı; Faz 7 inactive
    caption + normalize edilmiş kapı pakette). tmp temizliği:
    35 tur profili silindi.

### Kaydetme modu karşılama diyaloğu doğrulaması (16 Kasım 2026)
- Kullanıcı isteği: açılıştaki "nasil kaydetmek istersin" diyaloğunun
  iki seçeneği de gerçekten çalışıyor mu?
- Yeni kapı `tests/persistence-welcome-test.js` — **7/7 yeşil**, izole
  CDP profilleri (port 9419–9423 / 5281–5285):
  - A · AUTO: taze profilde diyalog açılır, Continue seçimsiz kilitli →
    auto seçilir → görsel eklenir → reload'da görsel GERİ GELİR +
    diyalog bir daha sorulmaz.
  - B · MANUAL: manual seçilir → reload'da tahta BOŞ (26-projects
    `_load` sözleşmesi: manual modda açılışta yükleme yok; kaydetmeden
    çıkınca veri gider) + seçim hatırlanır + diyalog sorulmaz.
  - C · ESCAPE: diyalog odaklıyken Escape → güvenli varsayılan auto
    ile kapanır.
- Kapı run-gates FULL zincirine eklendi (interface-modes ardına).
- Ders: Escape dinleyicisi diyalog elemanının kendisinde; test
  document'e değil `#persistenceWelcome`'e ateşlemeli (ilk koşuda
  yanlış hedefe ateşledik — ürün hatası değil, test düzeltmesi).

### Tema değişimi darboğazı: kök neden + düzeltme (16 Kasım 2026)
- Kullanıcı raporu: "tema değiştirirken kasıyor". Ölçüm: applyTheme
  çağrısının JS'i 0 ms, ama her değişim ana iş parçacığında ~1,2-2,5 sn
  tek karelik duraklama; timeline'da görünmeyen kısım asenk promise
  zincirlerindeki önizleme boyaması.
- **Kök neden (CPU profiler kanıtı)**: fırça önizleme bake anahtarı
  tema mürekkep rengini içeriyor (`inkPreviewBakeKey` … `|` + color).
  Tema rengi değişince 103 şerit + 12 kart + oluşturucu önizleme bake
  kaçırıp yeniden damgalanıyor; `createNoiseTip` tek başına ~350 ms
  örneklendi (`inkStampFor → inkTintedTip → inkBrushSourceCanvas →
  inkCreateNativeTip` zinciri). Paneller çoğunlukla GİZLİ olduğu için
  işin tamamı boşa: kullanıcı hiç görmediği tuvaller boyanıyordu.
- **Düzeltme — görünürlük duyarlı önizleme** (52-native-brush-library):
  - `inkPreviewCanvasVisible(canvas)` (offsetParent testi) +
    `inkNativeRefreshPreviews` artık gizli tuvalleri atlayıp
    `nbPreviewStale` işaretliyor; `inkNativeBrushUi.previewDirty` bayrağı.
  - `inkPreviewFlushStale()`: panel görünür olduğunda bayatları boşaltır.
    Kancalar: `inkNativeSync` başı, `01-bootstrap showPanel`,
    `19-themes-effects tailref-mode-changed` (rAF ile).
  - Idle kuyruğu kanalları da boşaltma anında görünürlük test ediyor:
    `inkNativeRenderQuickBrushes` şerit kapanışı, `inkNativeBrushCard`
    (senkron boyama → whenIdle'a taşındı), `inkNativeSyncCustomCreator`.
- **Ölçüm (isınmış durum, 8 sn boot backlog'u tükendikten sonra)**:
  - Düzeltme öncesi: her tema değişiminde 115-116 boya çağrısı,
    renderStrokePreview toplam ~1,0 sn; wall ~1,0-2,5 sn.
  - Düzeltme sonrası: boya çağrısı ~0 (gizli), refreshPreviews 9-10 ms,
    **wall 13-15 ms**. Tam probe (3 görsel dolu tahta, 10 tema × 3 tur):
    applyTheme 11-17 ms/tema (önce 1.100-1.906 ms), stüdyo galeri
    kartları 16-26 ms (önce 1.345-1.623 ms), nav 8-18 ms, arama 63
    ms/sorgu (değişmedi), accent 8 ms. Oturum boyunca ≥50 ms longtask:
    2 adet (önce her değişimde 1 adet 1,2-1,7 sn).
- **Ölçüm dersi**: `src/renderer/app.js` DEV SUNUCUDA otomatik
  yeniden üretilmiyor — src düzenlemesi sonrası `node
  scripts/build-app.js` koşulmadan probe'lar ESKİ kodu ölçer (bir
  ölçüm turu bu yüzden yanıltıcı "iyileşme" gösterdi; app.js mtime
  14:03 iken düzeltmeler 15:16'ydı). Bundan sonra: probe öncesi
  build-app zorunlu.
- Kalan bilinçli maliyet: açılış backlog'u (`inkNativeWhenIdle`
  kuyruğu, 12 ms/dilim) boot sonrası ilk saniyelerde akar — tema
  değişimine değil, açılışa ait; kullanıcıya görünmez.
- Paket: portable `dist\TailRef_Studio.exe` (109,8 MB) src
  düzeltmeleriyle yeniden üretildi — SHA256
  `C44F743D276E71257D7915E71DC36E5E2EF328848BD4A60E7519777F370F8BC1`
  (eski `6CB89161…`'in yerini aldı); masaüstü kopyası aynı SHA ile
  tazelendi. run-gates --full: ilk koşuda keymap-test 19/20 kırmızı
  görüldü, tek başına 20/20 → flake (zamanlama); zincir yeniden
  koşuldu → **65/65 kapı yeşil (tam zincir)**.

## AÇIK KARARLAR (kullanıcı cevapları — 15 Kasım 2026)
1. Canvas editor (ayrı pencere) → **Win95 arayüzüne DAHİL** (Faz 4 kapsamı).
2. Görsel tema arka planı → **#backdrop + panel dokunuşu** (panel
   opaklığı ile görsel panel yüzeylerinden görünür).
3. l10n → **46 anahtar tr + en tam işlendi**; diğer 8 dil EN fallback
   (build-locales zaten böyle üretir).

## WIN98 GÖRSEL DÖNÜŞÜMÜ (16 Kasım 2026) — otantik Windows 98 skin'i
- Kapsam: ui-win98.css'e BÜYÜK çizim modu bölümü eklendi (ink + v5 panel
  sistemi); önceki durumda çizim modu komple skinlenmemişti (yarım
  classic yarım win98 şikayetinin kökü).
- Kural korundu: HİÇBİR panelin konumu/boyutu değişmez. Ölçüm: klasik vs
  win98 dikdörtgen karşılaştırması — v5 dock'lar ve kanvas çerçevesi
  (324,141 628x471) birebir aynı; itemBar (989,134 320x427) birebir aynı.
- Layout ihlalleri düzeltildi (skin'in kendisi yapıyı bozuyordu):
  #projectBar 'left:4px!important' kaldırıldı (merkez translateX(-50%)
  korundu, yalnız 48px kabuk bandının altına iner); #bar{top:76px}
  kaldırıldı (relative elemana top uygulanınca 132'ye kayıyordu) — yerine
  #barDock 104px'e taşınır; #appModeBar justify-content:flex-end!important
  (çizim modunda base kuralı ezilip düğmeler markayla çakışıyordu).
- KRİTİK DERS: ps-ref-live canlı mini tahta. Çizim modunda soldaki
  "Reference board" paneli gerçek panonun KIRPILMIŞ görünümüdür (#stage
  z1230, dock z1500'ün altında). Panel gövdesi OPAK verilirse canlı
  tahta kapanır (classic'te gövde yarı saydam) — thumbnail kaybolmuştu.
  Çözüm: gövde/stage saydam, yalnız başlık lacivert + ayak (.v5-ref-foot)
  gri. Aynı nedenle .v5-ref-stage'e opak 'field' zemini VERİLMEZ, yalnız
  sunken çerçeve.
- .v5-panel--color .v5-panel-head opacity:0 hover-görünür — app tasarımı
  (classic davranışı), skin bunu korur; hover'da lacivert.
- #inkDocSize 665'ten 621'e alındı (durum çubuğu + görev çubuğu bandının
  altında kalmaması için); #inkHud konumu aynı.
- v5Toolbar/v5OptionsBar konumları DEĞİŞMEZ (içerikleri 48px bandın
  altında kalmıyor; ölçümle teyitli).
- itemBar kaymasının kökü skinden değil, APP HATASI: çizim modunda
  #itemBar CSS display:none iken render döngüsü prepareFloatingPanel
  çağırıyor, ölçü 0x0 -> constrainFloatingPanel clamp çöpü (8,topLimit
  280x380) yazıyor. DÜZELTME: 17-floating-panels.js constrain/save artık
  ölçülemez (0x0) panelde dokunmaz. Klasik+win98 ikisinde de tur sonrası
  panel 989,134'te kalıyor (önce klasikte bile sola duserdi).
- Panolar gri zemine geçti: body.mode-reference/#stage/#board/#world
  #C0C0C0 (koyu palet KALMAZ); itemBar/inspector içeriğine siyah metin +
  raised düğmeler; .v5-ref-foot gri; trash dock raised;
  .v5-brush-cat/.inkLayerRow active lacivert.
- Canlı kanıt: ekranlar Temp\opencode\w98z-1..3.png; delta raporu
  w98-verify.js (KLASIK vs W98 referans/çizim).

## WIN98 v2 OTANTİKLİK REVİZYONU (16 Kasım 2026) — tamamlanan
- ui-win98.css BAŞTAN yeniden yazıldı (v2, ~1900 satır): bevel token
  sistemi (--w98-bev-btn/press/window/field/field-thin + --w98-dither),
  evrensel !important'lı button/input/select/checkbox/radio/range/
  scrollbar kuralları; TÜM istisna kurallar da !important'lı.
- Lacivert yalnız: ana başlık (#appModeBar) + seçili liste öğeleri +
  menü hover. Panel başlıkları GRİ + siyah kalın + etched ayraç
  (floatingPanelHead, v5-panel-head, poseStackItem/poseSection summary,
  pose3dHead, ce-panel-head).
- 3D pose panelleri TAMAMEN skinlendi (Faz 8): poseQuick şeridi + sağ
  poseStack bölümleri gri tool window; QuickBtn/Seg/SegRow/Axes/
  poseSectionBody raised; aria-pressed dither+sunken; poseQuickSwitch
  sunken yuva + kare topuz; poseListRow beyaz alan, aktif karakter
  lacivert + beyaz metin; poseGuide/poseGuideStep gri; range'ler groove
  kızak + 11x18 kare thumb; #pose3dPanel::before cam katmanı kaldırıldı.
- Küçük düzeltmeler (Faz 9): scrollbar 16px !important (base 5px ID
  ezer); #itemAlpha/#bgOpacity kare thumb + groove (beyaz daire kalmaz);
  itemOpacityControl cam hapı düz; #alphaVal düz siyah; #projectBar
  projTab klasik kare düğme dili (hap/dither); katman küçük resimleri
  (.inkLayerThumb) beyaz sunken; aktif katman satırı düğmeleri gri
  raised; lacivert karakter kartında etiketler beyaz.
- CE skin (ui-win98-ce.css): ce-panel-head gri + etched; ce-btn/ce-tool
  is-active dither+sunken; kırmızı close hover kaldırıldı (XP'ye aittir);
  inactive yalnız #ce-titlebar grileşir.
- Layout koruma teyidi (ölçümlü): kanvas çerçevesi 324,141 628x471
  AYNI; v5 dock'lar (20,80 280x596 / 976,80 340x596) AYNI; itemBar
  989,134 320x427 AYNI. Beklenen/bilinen farklar: #bar ve #projectBar
  48px menü bandına taşınır (kabuk tasarımı); genişlik -44/-11px Tahoma
  metrikleri (shrink-to-fit); #inkDocSize bottom 621 (belgelenmiş
  istisna); psStatusBar yalnız win98 kabuğunda var.
- Doğrulama: w98-final.js / w98-drawrect.js / w98-lbl-probe.js
  (Temp\opencode); ekranlar w98f/w98g-1..3.png (referans, çizim, 3D).
- Kapılar: GATES 13/13 yeşil (PURE). Portable yeniden üretildi:
  dist\TailRef_Studio.exe SHA256 7402917E…DAAFB5DE (115.110.085 bayt),
  masaüstü kopyasıyla birebir eşleşti.
