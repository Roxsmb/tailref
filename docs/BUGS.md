# BUGS — bulunan ve kapatılan kayıtlar

Her kayıt: bulmak (nasıl/nezaman) → köken → düzeltme → kanıt.
Bu dosya kamu okur; dil kısa ve maddelidir.

## 2026-11-07 · Performans turu

### B1 · Simetrik vuruşta canlı önizleme koyulaşırdı (çift ağırlık birikimi)
- **Bulmak:** vuruş-ortası byte-parite probe'u (`scripts/_midstroke-parity.js`)
  sym açıkken `previewSkip`'in hiç ilerlemediğini gösterdi — her kare
  yürüyüşü tüm klonları ağırlık tuvaline TEKRAR basıyordu.
- **Etki:** canlı çizgi her karede koyulaştırırdı; commit baskısı da aynı
  çift birikimi kilitleyebilirdi.
- **Düzeltme:** `36-ink-editor.js` — sim devredeyken her çağrıda ağırlık
  tuvali sıfırlanır, tüm dablar TEK geçişte basılır (`skipDabs=0`).
  Simetrili vuruşlar nadirdir; maliyet önemsiz. (`M5`)
- **Kanıt:** `_midstroke-parity` ORTA·mirrorX **diff=0**; `symmetry-test` 16/16.

### B2 · Dirty-rect kompozitte cephe kayması → vuruş-ortası parite ihlali
- **Bulmak:** M2'den sonra vuruş-ortası byte-parite probe'u sym-off'ta
  `diff=4497..12757` (kanal) raporladı; bbox + örnek pikselle teşhis:
  comp'ta pigment **yok**, ref'te damla var (bölge dışında kalan dablar).
- **Köken:** `28-ink-brush.js` `stableOnly` yolunda dab yürüyüşü son 2
  segmenti işlemez (`segmentLimit = len-2`); yani çağrının yeni bastığı
  dablar nokta listesinin sonunun 2 gerisindedir. Delta bölge "son
  eklenen noktalar"dan açıldığı için bu dablar kutu dışında kalıyordu.
- **Düzeltme:** `36-ink-editor.js` — delta bölge başlangıcı **3 nokta
  geriden** açılır (`dualCompPts - 3`); pencere taşması idempotenttir
  (aynı bölge tekrar kompozit edilir, aynı sonucu verir). (`M2b`)
- **Kanıt:** `_midstroke-parity` ORTA·sym-off **diff=0**, ORTA·mirrorX
  **diff=0**; ayrıca `gates` 8/8, `ink-commit-check` 7/7,
  `live-parity-probe` 5×1.00, `test:ink` 233/233.

### B3 · Ölçek kemikleri (bilgi amaçlı, kapatıldı)
- Minyatür overlay senkronu vuruş sırasında her karede oluyordu → **5 sn**
  kısınlama; koordinat X/Y DOM yazımı karede → **~10 Hz**; vuruş sırasında
  resample kalitesi `medium` (commit aynen, parite korunur).

### B4 · Vuruş sırasında sahne render'ı olay-başına yanardı (düşük donanım)
- **Bulmak:** CDP CPU-throttle simülasyonu — ×4 kısım sahne renderını
  kare-başına koşturunca vuruş kare hızı 17.8→11.8 fps'e düşüyordu;
  biseksiyon deneyleri: render sayısını yarıya indirmek ~2× kazanç,
  tuval bitmap'ini yarıya indirmek sadece ~%20 → darboğaz render
  SIKLIĞI (raster/kompozitör), sahne alanı değil.
- **Düzeltme:** `36-ink-editor.js` `inkEditorLoop` — kare süresi 25 ms'yi
  2 kez aşarsa sahne render'ı alternatif karede bir atlanır (M6);
  imleç halkası ayrı rAF döngüsünde tam hızda; dab birikimi artımlı
  olduğundan atlanan karede iş kaybolmaz.
- **Kanıt:** `_lowend-sweep` ×4: 22.4 fps, ×8: 8.3 fps (önce 11.8/2.7),
  ×1: etkisiz; `_midstroke-parity` ×8'de diff=0; full zincir yeşil.

### B5 — Sahne render'ı vuruş sırasında tüm yüzeyi baştan çiziyordu
- **Bulmak:** M6 sonrası ölçümde ×4 kısıtında render'a ayrılan süre
  hâlâ baskındı; biseksiyon: sahne render'ının maliyeti tam `clearRect`
  + tam `base` blit + önizlemenin her karede fit kutusuna resample'ıydı
  (M2'nin sahne seviyesindeki ikizi).
- **Düzeltme:** `36-ink-editor.js` `inkEditorRender` — M7 sahne
  kirli-kutu kompoziti (kiremit aşama 1): vuruş sırasında yalnızca
  `ui.sceneChip` (değişen önizleme kutusu, M2b pencere kurallarıyla
  üretilir) ekran karşılığı clip edilip bölge içi kompozit yeniden
  yapılır. Güvenceler: yalnız 2D artımlı dual yol chip üretir
  (sym/şekil/smudge/yol-fırçası/GPU/rot≠0 → eski tam yol); fit/offset
  ve katman sırası değişmedikçe devrede; kutu geçersizse tam yola düşer.
  Kiremit aşama 2 (DOM karo ızgarası, Krita kalıbı) ayrı aşamadır.
- **Kanıt:** `_midstroke-parity` ORTA·sym-off ve ORTA·mirrorX
  **diff=0** (`PARITE×8` dahil); `_lowend-sweep` ×4: 63.5 fps,
  ×8: 17.7 fps (B4 sonrası 22.4/8.3), ×1: 84.6 fps; `test:ink` 233/233;
  `ink-commit-check` 7/7 · canlı==commit 0 farklı kanal;
  `gates` 8/8 (build:portable sonrası `PAKET GÜNCEL`).

### B6 — Karo defteri vuruş içinde "boş" karelerle siliniyordu (dilim 3)
- **Bulmak:** kiremit üretimde AÇIK yapıldıktan sonra `_tiles-view-parity`
  A/B fazları tiles=0 dönmeye başladı: chip'i ÖNCEKİ karede tükenmiş,
  yeni dab'ı olmayan kareler (`previewDirty=false` üst kare) tam yola
  düşüyor ve `ui.stroke` dalındaki bayat-silme kuralı taze karo
  defterini dispose ediyordu. `_tile-debug` dökümü: 2 tileFrame çağrısı
  · drawn=6 · takeover wipe=7 — defter her seferinde boştu.
- **Düzeltme:** `36-ink-editor.js` — vuruş başında `ui.tvChipSeen=false`,
  ilk başarılı chip karesinde `true`. Tam yola düşen kare yalnız
  **yapısal** ise (chip karesi hiç görülmedi — GPU/scratch vuruşlar —
  ya da sym açık, rot≠0, anahtar değişimi) defter silinir; "benign"
  kare (chip karesi görülmüş + GPU yok + rot=0 + sym kapalı + anahtar
  aynı) defteri korur — içeriği öteki kareyle aynıdır, karolar güncel.
- **İlgili:** otomatik profil kararı bırakma sonrası hemen
  `setTileSize` ile uygulanıyordu — az önce yakınsanmış taze defteri
  bozuyordu. Karar kaydedilir, SONRAKİ vuruşun başında (ilk kare
  öncesi, vuruşlar-arası nokta) uygulanır.
- **Kanıt:** `_tiles-view-parity` A/B/C diff=0 (karo 4/6/6, maxDelta=0,
  üç koşu istikrarlı); `_midstroke-parity` sym-off+mirrorX diff=0;
  `_lowend-sweep` TV_ON ×1 89.9 / ×4 64.5 fps, ×8 parite biti diff=0;
  `_tiles-view-visual` 3 PNG (on-mid/on-final/off-mid) elle inceleme —
  karo dikişi yok; `run-gates` 9/9 + `test:ink` 233/233.

### B7 · Yeni taban modelde iki arıza: sipsiyah render + patlanmış rig (3D)
- **Bulmak:** kullanıcı Mixamo-rig'li FBX taban modeliyle paneli açtı;
  model düz siyah silüet, poz uygulaması sonrası uzuvlar gövdeye
  çakılmıştı.
- **Köken (iki ayrı kusur):**
  1. **Sipsiyah:** Mixamo FBX ihracatı normal datası yazmamış olabilir.
     Mesh'te `normal` attribute yokken `MeshToonMaterial` ışığı sıfır
     çarpım yapar → malzeme kara kalır (zemin gölgesi pozisyondan
     üretildiği için görünür — tanı yanılması düşük). Tanı:
     `_pose3d-diag-probe` `normal:false` raporladı.
  2. **Patlama:** `applyPose` kayıttaki EKLEM KONUMLARINI (p) koşulsuz
     kopyalıyordu. Farklı rig'den (eski referans iskelet) gelen pozun
     eklem konumları yeni rig'in kemik bağlarına uymaz → uzuvlar
     gövdeye çakılır.
- **Düzeltme:** `SceneGraph.load` FBX yolunda normal eksikse
  `computeVertexNormals` (OBJ yolundaki kuralla aynı);
  `PosingController.applyPose` dönüşleri her zaman, pozisyonları yalnız
  rig imzası aynıysa uygular; `Rig.build` taban konumları da saklar,
  `resetToBase` dönüş + konumu birlikte toparlar.
- **Kanıt:** `_pose3d-diag-probe` sonrası `normal:true`, şotta açık gri
  toon gölgelendirme; `_pose3d-base-probe` patlanma senaryosu — farklı
  rig + `p:[0,0,0]` poza `eklemKayma: 0`, kasıtlı sıfırlama sonrası
  `resetToBase` ile `resetPozKayip: 0`.

### B8 · Lineart silüette bloklu siyah dilimler (3D)
- **Bulmak:** kullanıcı pozu görüntüledi; karakter silüet boyunca
  çokgen, bloklu siyah kara dilimler (`facet` görünüm) taşıyordu;
  T-poz'a alındıktan sonra bile geri geliyordu.
- **Köken:** `_pose3d-lineart-probe` aynı yakın kamerada lineart
  AÇIK/KAPALI şotları nokta-atış ayıkladı: KAPALI şotta gövde pürüzsüz
  → sorunu `OutlineEffect` taşıyordu. Effect'in
  `calculateOutline` formülü silüet adımını **vec4'ü (z+w dahil)
  normalize** ediyordu; perspektifteki `w` farkı yönü bozup kontrol
  dışına taşan dilimlere yol açıyordu. (İkincil: Mixamo FBX non-indexed
  geometri + yüz-başına normal, facet'e katkı yapar — konum-weld ile
  yumuşatıldı.)
- **Düzeltme:** `vendor/OutlineEffect.js` formülü NDC'ye taşındı:
  `d = pos.xy/pos.w − pos2.xy/pos2.w`, 2D normalize, `dl>1e-7`
  korunması (NaN koruması) ve `pos.xy + dir*thickness*pos.w` — ekran
  kesri incecik ve sabit. Ayrıca `SceneGraph.weldVertexNormals`
  (konum-weld) FBX/OBJ yollarına eklendi.
- **Kanıt:** `_pose3d-lineart-probe` — ON şotunda ince düzgün kenar
  çizgisi, hilaller yok; OFF şotu yine pürüzsüz. `weldVertexNormals`
  FBX yolunda çağrılıyor (kod zinciri).

### Bilinen açık (bilinçli)
- GPU önizleme yeniden bağlama (madde 6) ayrı oturuma bırakıldı — yüksek risk.
