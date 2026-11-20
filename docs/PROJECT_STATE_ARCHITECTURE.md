# Pano State ve Sekme Yönetim Mimarisi

> Sürüm: 1.1 · 29.10.2026
> Kaynak: `src/renderer/core/26-projects.js` (pano durumu), `main.js` + `preload.js` (kurtarma)
> Arayüz: `#projectBar` / `#projectTabs` (`index.html`, `style.css`)

Bu belge, TailRef Studio'nun çoklu pano (board) mimarisini açıklar.
Qt/PySide karşılıkları yerine mevcut Electron + JavaScript yığınındaki
uygulaması anlatılır.

## 1. Sorumluluklar

| Sınıf | Sorumluluk |
|---|---|
| `ProjectState` | Tek panonun izole durumu: öğeler, görünüm, arka plan, gruplar, bağlantılar, çöp, seçim, geri al/yinele, 3D kamera transformu ve rig pozu. |
| `TailRefWorkspaceManager` | Pano listesi, aktif pano, sekme şeridi, `+` yeni pano, sekmeler arası geçiş, yeniden adlandırma, kapatma ve IndexedDB kalıcılığı. |

`QTabWidget.currentChanged` davranışının karşılığı `switchTo(id)` →
`activate(id)` zinciridir. `close_project_tab` karşılığı
`closeProjectTab(id)`'dir.

## 2. ProjectState veri modeli

```js
{
  id, name, createdAt, updatedAt,

  snapshot: {                 // canlı tahtanın derin kopyası
    items: [],                // görseller + metinler (konum, boyut, filtre…)
    view: { x, y, scale },    // 2D pan/zoom
    bg,                       // arka plan opaklığı
    groupTitles, groupImportant, groupParents,
    links: [],                // görsel bağlantı okları
    trash: []                 // süreli çöp kayıtları
  },

  cameraTransform: {          // camera_transform
    mode: 'perspective' | 'orthographic',
    target: [x, y, z],
    persp: { position, up, fov, near, far },
    ortho: { position, up, scale, zoom, near, far }
  },

  pose3d: {                   // rig / model verisi
    rigSignature, modelName,
    bones: [{ id, name, p:[x,y,z], q:[x,y,z,w] }],
    parts: [{ index, name, visible }]
  },

  // Yalnızca oturum içi (diske yazılmaz):
  undoStack: [], redoStack: [], selection: []
}
```

`serialize()` / `toRecord()` ve `ProjectState.deserialize(record)` gelecekte
dosyaya proje kaydetme/yükleme için kullanılabilir. Otomatik yedekler artık
`workspace.projects` altında tüm panoların kayıtlarını taşır.

## 3. IndexedDB şeması

Mevcut `tailref` veritabanı ve `meta` store'u kullanılır; sürüm artırılmaz.

| Anahtar | Değer |
|---|---|
| `meta/workspace` | `{ schema, activeId, projects: [{ id, name, updatedAt }] }` |
| `meta/project:<id>` | `ProjectState.toRecord()` çıktısı |
| `meta/state` | Aktif panonun tahta anlık görüntüsü (eski sürüm/uyedek uyumluluğu) |
| `images/<imageId>` | Görsel blob'u (değişmedi) |

### Göç

`meta/workspace` yoksa eski `meta/state` kaydı okunur ve `Pano 1` olarak ilk
pano kaydına taşınır. Hiç kayıt yoksa boş `Pano 1` oluşturulur. Bu nedenle
mevcut kullanıcıların tek tahtası korunur.

## 4. Sekme yaşam döngüsü

```
switchTo(id)
  ├─ _commitActive()          // debounce iptal, uçuştaki kayıt beklenir
  │    └─ project.capture()   // tahta + kamera + poz + seçim + undo
  ├─ activate(id)
  │    ├─ project.apply()     // snapshot'ı derin kopyayla state'e uygula
  │    ├─ _resetBoardDom()    // öğe/bağlantı/grup DOM'unu temizle
  │    ├─ görselleri yükle   // loadImage + ilerleme etiketi
  │    ├─ applyView / applyBackdrop / syncAll / syncSelection
  │    ├─ _apply3d()          // kamera + rig pozu (veya varsayılan)
  │    ├─ updateTrashUI()
  │    └─ indeks + meta/state yaz
  └─ tailref-project-changed olayı
```

`createProject()` aktif panoyu kaydeder, boş `ProjectState` oluşturur ve
onaya geçer. `closeProjectTab(id)`:

1. Doluysa kullanıcıdan onay alır.
2. Aktifse son hâli kaydeder.
3. Kaydı `meta/project:<id>`'den siler, Map/sıradan çıkarır.
4. Aktifse komşu sekmeyi, son sekme kapandıysa yeni boş `Pano 1`'i açar.
5. `gcImages()` çalıştırır. GC, **tüm** panoların tahta/çöp/undo/redo
   görsellerini korur; yalnızca hiçbir panoda kullanılmayan blob'ları siler.

## 5. 3D köprüsü

- `captureCameraTransform()` / `applyCameraTransform()`:
  `window.__pose3dDebug.cameraManager` üzerinden persp + ortho kameralarını,
  hedefi ve modu taşır.
- `capturePose3d()` / `applyPose3d()`: `Rig.snapshotJSON()` /
  `Rig.restoreJSON()` ve `SceneGraph.setPartVisible()` kullanır.
- 3D hazır olduğunda `src/renderer/pose3d/bootstrap.js` `tailref-3d-ready` olayını
  yayınlar. Yönetici varsayılan kamera/pozu bir kez yakalar; 3D durumu
  olmayan panolara bu varsayılanı uygular.
- 3D tuvalinde `pointerup` / `wheel` sonrası `scheduleSave()` çağrılır;
  böylece kamera/poz değişiklikleri de panoya yazılır.

## 6. Dışa açılan köprü

```js
window.ProjectState
window.TailRefWorkspaceManager
window.__tailrefWorkspace   // aktif örnek
```

Yönetici API'si: `bootstrap()`, `switchTo(id)`, `createProject(name?)`,
`renameProject(id, name)`, `closeProjectTab(id)`, `serializeWorkspace()`,
`activate(id)`, `notifyProjectLimit()`.

## 7. Pano sınırı ve varsayılanlar

- `MAX_PROJECTS = 10`. Sınırdayken `createProject()` yeni pano açmaz;
  `#btnNewProject` `disabled` olur ve kısa bir bildirim (`#projectNotice`)
  gösterilir. Bir pano kapanınca sınır yeniden açılır.
- `+` / `Ctrl+Shift+N` → `requestNewProject()` önce `promptProjectName()`
  ile küçük bir açılır kutu (`#projectNamePopover`) gösterir. Kutu önerilen
  "Pano N" adıyla ve seçili metinle açılır: `Enter` kabul, `Esc` / dışına
  tıklama iptal. Boş bırakılırsa önerilen ad kullanılır. Sekmeye çift tıkla
  yeniden adlandırma (`renameProject`) aynen durur.
- Yeni pano anlık görüntüsü `emptyBoardSnapshot()` ile üretilir ve
  `bg: 1` (arka plan opaklığı %100) taşır.
- Tahtada 3000+ öğe varsa `maybeWarnOverload()` bir kez uyarır ve
  "Son sağlıklı kayda dön" yolunu hatırlatır.
- **Katman sırası:** yüzen paneller `#inspector,#itemBar` → `2100`.
  Önemli-renk çarkı `#impWheel` → `2400`, açılır menüler → `2500`, pano adı
  kutusu → `2600`. Çark panelin üstünde kaldığı için "Önemli" rengi
  tıklanabilir.
- **Arka plan opaklık yüzdesi:** `#bar .opVal` `z-index:3`, slider
  `z-index:2`; numara ray çizgisinin arkasında kalmaz. Konum
  `left: calc(var(--p) * (100% - 12px) + 6px)` ile thumb'ı izler
  (`transition: left 60ms linear`), sağ uçta `.is-left` ile sola geçer.

## 8. Aşırı yük kurtarma

Renderer ağır bir tahtada donabilir (örn. yanlışlıkla binlerce görsel).
Donmuş bir arayüzden ne yeni sekme ne de kayıt yazılabilir; bu yüzden
kurtarma **ana süreçte** yürür:

1. `main.js` her 3 sn'de bir `webContents.executeJavaScript('1')` yoklaması
   yapar. Yanıt 2,5 sn'de gelmezse ya da 1,2 sn'den uzun sürerse renderer
   "kullanılamaz" sayılır; 4 ardışık kötü yoklamadan sonra (~13 sn) yerel
   `dialog.showMessageBox` açılır.
2. Kutu pencerenin modalıdır ve ana süreçte çalışır; renderer'ın JavaScript'i
   yanıt vermese bile görünür. `Ctrl+Alt+Shift+R` (`before-input-event`)
   aynı kutuyu elle açar.
3. **Yedek sağlık taraması (P1).** `inspectBackup()` her yedeğin içeriğini
   okur: toplam öğe, görsel sayısı, dosya boyutu. Eşikler:
   `MAX_HEALTHY_ITEMS = 1500`, `MAX_HEALTHY_IMAGES = 300`,
   `MAX_HEALTHY_BYTES = 200 MB`. Yeni → eski taranır ve **ilk sağlıklı**
   yedek seçilir; 60 sn'den yeni olanlar tercih edilmez. Bozuk/şişmiş
   yedekler kutuya "atlandı" olarak yazılır ve asla yüklenmez.
4. **Kutu seçenekleri (P5):**
   `Son sağlıklı kayda dön` / `Temiz başlat` / `Bekle`.
   Hiç sağlıklı yedek yoksa yalnızca `Temiz başlat` / `Bekle` gösterilir.
   `Bekle` 45 sn cooldown uygular.
5. **Son sağlıklı kayda dön:** `userData/recovery.json` işaretine
   `{mode:'restore', backup}` yazılır, seçilen dosya
   `recovery-history.json` içine "denendi" olarak eklenir ve `app.relaunch()`
   çalışır. Tahta hâlâ aşırsa bir sonraki kutu **başka** bir aday önerir.
6. **Temiz başlat (P2):** işarete `{mode:'reset'}` yazılır. Açılışta
   `archiveAndWipeBoards()` mevcut panoları `Archive/<zaman>/workspace.json`
   olarak saklar (görseller hariç — asıl şişkinlik onlarda), `Backups`
   klasörünün kopyasını da arşive alır. Sonra yalnızca **pano verisi**
   silinir: `state`, pano indeksi (`workspace`) ve `project:*` kayıtları +
   `images` deposu. Özel fırça kütüphanesi (`ink:brushes`), FX presetleri ve
   native fırça önizlemeleri (`nbprev|*`) korunur. `bootstrap()` tek boş
   panoyu (`bg: 1`) oluşturur.
   **Veri silinmez**, arşivden geri alınabilir (Ayarlar → **Arşivi aç**).
7. **Emniyet kopyası (P3):** her geri yüklemeden önce mevcut (bozuk) durum
   `Backups/emergency-<zaman>.json` olarak yazılır (son 5 dosya tutulur).
8. Açılışta `init()` → `applyPendingRecoveryOnBoot()` işareti okur ve yedeği
   **pano verisi yüklenmeden önce** `importBackupPayload()` ile IndexedDB'ye
   yazar. Yükleme sonrası toplam öğe sayısı `OVERLOAD_SAFE_ITEMS` (1500)
   altındaysa `recovery-healthy` çağrılır ve deneme geçmişi temizlenir;
   üstündeyse kullanıcı uyarılır ve geçmiş korunur (zincirleme geri dönüş).
9. Aynı yol elle de çalışır: Ayarlar → **Son sağlıklı kayda dön**
   (`list-backups` artık `healthy`, `items`, `images`, `reason` döndürür),
   **Arşivi aç** veya **Yedek dosyası seç**.

Yedekler `userData/Backups` altında 20 dosya ile sınırlıdır (en eskiler
silinir; `emergency-*` dosyaları bu sayıya girmez). Sağlık kontrolünden
geçen son 3 yedek **`Backups/good/` altında ayrıca** tutulur ve rotasyondan
etkilenmez (P4). Yedek içeriği `meta/state`, tüm panolar (`workspace`) ve
görselleri base64 olarak taşır; bu yüzden geri yükleme tek dosyayla tamdır.

## 9. Test

`node scripts/projects-test.js` (`npm run test:projects`) gerçek Electron
penceresinde şunları doğrular:

- İlk açılışta tek pano, `+` ile yeni pano, iki sekme
- Panolar arasında öğe ve görsel kimliği izolasyonu
- 3D kamera transformu ve rig pozunun pano başına hatırlanması
- Çift tıkla yeniden adlandırma ve indekse yazılması
- Yeniden yükleme sonrası aktif pano ve içerik kalıcılığı
- Kapatma, komşuya geçiş, kayıt/görsel temizliği (GC)
- Son sekme kapanınca boş pano oluşumu
- Eski `meta/state` kaydından göç
- Yeni panonun %100 arka planla açılması, 10 pano sınırı ve + düğmesi
- `+` / `Ctrl+Shift+N` isim kutusu: önerilen ad, verilen adla açma, `Esc` iptali
- Önemli-renk çarkının (`#impWheel`) seçim panelinin üstünde kalması (tıklanabilirlik)
- Arka plan opaklık yüzdesinin (%0 · %50 · %98) slider'ın üstünde ve ray içinde kalması
- İşaret dosyası + yedek ile açılışta otomatik kurtarma
- 1600 öğeli yedeğin "sağlıksız" işaretlenmesi ve yerine sağlıklı olanın seçilmesi
- "Temiz başlat" sonrası tek boş pano + `Archive/` altına yazılan pano kaydı

`node scripts/overload-test.js` (`npm run test:overload`) renderer'ı 35 sn
senkron olarak kilitler ve ana sürecin ~13 sn içinde kurtarma kutusunu
açtığını, onay olmadan işaret yazmadığını doğrular.

## 10. Kayıt güvenliği (18 Kasım 2026 denetimi)

Hem otomatik hem manuel mod uçtan uca incelendi; kapatılan riskler ve
sözleşmeleri:

- **Mod geçişi:** manuel → otomatik geçişte canlı tahtalar hemen diske
  yazılır (`saveNow`) ve çalışma alanında olmayan eski `project:*`
  kayıtları `pruneStaleStoredBoards()` ile temizlenir. Otomatik → manuel
  geçişte bekleyen debounce yazımı iptal edilir; IDB'deki otomatik veriler
  sessizce bekler (manuel tahtaya karışmaz).
- **Dosya açma:** `.tail`/yedek yüklemeden önce otomatik modda
  `flushSave()`, manuel modda canlı tahtayı içeren
  `saveEmergencyCopy(true)` alınır. `importBackupPayload` sonrası
  `location.reload()` sırasında `pagehide` flush'ı
  `suspendPersistenceForReload()` ile susturulur; import başarısız olursa
  `resumePersistenceAfterFailedImport()` kaydı geri açar.
- **Manuel "kaydedilmemiş değişiklik":** `manualStateSignature()` tahta
  panoları + kamera/poz durumunu karşılaştırır; son kaydetme/açma imzasıyla
  (`markManualClean`) aynıysa kapanışta soru sorulmaz. İmza içerik
  tabanlıdır, olay sayımına bağlı değildir.
- **Dosya içeriği:** `.tail` ve otomatik yedek yalnızca panolarda
  referanslanan görselleri gömer (sahipsiz blob'lar ve yalnızca geri
  al/yinele yığınında kalan görseller dosyayı şişirmez). `imagesComplete`
  bayrağı görsel listesinin eksiksiz olduğunu bildirir; eksik görsel varsa
  açılışta uyarı çıkar ve dosya "eksiksiz" işaretlenmez.
- **Dosya sertleştirme:** `.tail` yazımı/okuması async zlib ile yapılır
  (ana süreç donmaz); disk dosyası 1 GB, açılmış JSON 1,5 GB ile
  sınırlıdır; bozuk gövde ve daha yeni payload sürümü veriye dokunmadan
  reddedilir. Acil kopya ve arşiv yazımları da atomiktir.
- **Yedek disiplini:** otomatik yedek zamanlayıcısı, son yedekten beri
  yeni bir kayıt yoksa diske yazmaz; yazılan dosyanın sağlık kontrolü
  renderer'dan gelen öğe/görsel sayılarıyla yapılır (dosya yeniden
  okunmaz).
- **Görsel çöp toplama yarışı:** `beginImageWrite`/`endImageWrite` sayacı,
  blob yazılıp tahta öğesine bağlanana kadar `gcImages` ve manuel temizliği
  bekletir. Başarılı `.tail` kaydından sonra `pruneUnusedImagesNow`
  sahipsiz görselleri siler; diskte duran panoların görselleri korunur.
- **Oturum bayrakları:** "Açılışta temiz başla" kapalıyken bile bu oturumda
  açıkça yüklenen `.tail`/yedek, yeniden yüklemede arşivlenip silinmez
  (`tailref-opened-file-once`).
- **Hata görünürlüğü:** IndexedDB yazımı veya disk yedeği başarısız olursa
  oturumda bir kez kullanıcı uyarısı gösterilir; otomatik modda Ctrl+S
  görünür "Saved to this device." bildirimi verir ve kayıt kutusu tek
  uçuşludur.

Regresyon: `node tests/persistence-safety-test.js` (33 kontrol; temiz
başlat kapsamı, görsel filtresi/eksiksizlik bayrağı, import/reload yarışı,
manuel acil kopya, durum imzası, mod geçişi temizliği, boşta yedek atlama,
.tail yaz/oku turu, bozuk/yeni sürüm dosya reddi, görsel GC koruması).
