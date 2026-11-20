# `.tail` Dosya Biçimi (TAIL_FORMAT)

Bu belge, TailRef'ın manuel kayıt dosyası **`.tail`** kapsayıcısının byte
düzeyinde düzenini tanımlar. Kaynak: `src/main/main.js` (`save-tail` /
`open-tail` IPC, `TAIL_MAGIC` / `TAIL_VERSION`) ve
`src/renderer/core/04-persistence-view.js` (payload üretimi) ile renderer
tarafı `saveAsTail` (app.js).

## Kapsayıcı düzeni (v1)

| Offset | Boyut | İçerik |
|---|---|---|
| 0 | 4 B | Sihirli baytlar: `TAIL` (ASCII) |
| 4 | 1 B | Kapsayıcı sürümü (`unsigned byte`, şu an `1`) |
| 5 | … | zlib-compressed JSON (Node `zlib.deflateSync`, level 6) |

- Kayıt sırası: `magic(4) + version(1) + deflated(veri baytları)`; tampon
  tek seferde atomik yazılır (`writeFileAtomic`: tmp + rename). Sıkıştırma
  `zlib.deflate` (async) ile yapılır: büyük panolarda ana süreç (pencere,
  menü, IPC) donmaz.
- Açılımı: `magic` eşleşmezse `ok:false` "geçerli bir .tail değil";
  `version` eşleşmezse "desteklenmeyen sürüm" uyarısı; `zlib.inflate` +
  `JSON.parse`.
- **Boyut sınırları (bozuk/kötü niyetli dosya koruması):** disk dosyası en
  fazla **1 GB**, açılmış JSON en fazla **1,5 GB** olabilir. Sınırı aşan,
  bozuk veya zip-bomb niteliğindeki gövde çökme yerine "geçerli bir .tail
  değil" hatasıyla reddedilir. Kaydetme tarafında da 1,5 GB üstü pano
  yazılmaz.
- **Geriye dönük okuma:** Eski Refeverr sürümlerinin yazdığı `RFVR`
  imzası okuma tarafında kabul edilir (`LEGACY_TAIL_MAGIC`). Yeni dosyalar
  her zaman `TAIL` imzasıyla yazılır.

## Payload JSON şeması (v2)

Sıkıştırma AÇILDIĞINDA gelen JSON; **kapsayıcı sürümünden bağımsız kendi
`version` alanını taşır (şu an `2`)** — ikisini karıştırmayın.

```json
{
  "version": 2,
  "createdAt": "2026-11-06T20:33:12.345Z",
  "state": "..." ,   // tahta/kalıcılık anlık görüntüsü (createStateSnapshot)
  "workspace": {...}, // çizim modu görünümleri (opsiyonel; serializeWorkspace)
  "images": [
    { "id": "...", "name": "image", "dataUrl": "data:image/png;base64,..." }
  ],
  "imagesComplete": true
}
```

- `state`: pano öğeleri, görünüm/arka plan vb. (uygulama sadece bu
  görüntüyü açar; importBackupPayload bunu doğrudan yükler).
- `workspace`: görseli çizim moduna taşıyan çalışma alanı durumu (yoksa null).
- `images`: yalnızca panolarda **referanslanan** görsellerin IndexedDB
  `images` deposundaki blob'unun **dataURL** karşılığı. Sahipsiz (artık
  hiçbir öğede kullanılmayan) blob'lar ve yalnızca geri al/yinele
  yığınında kalan görseller dosyaya girmez; açılış bu depoyu yeniden inşâ
  eder.
- `imagesComplete`: görsel listesinin eksiksiz olduğunu bildirir. Yeni
  `.tail` ve otomatik yedeklerde `true`'dur; bir görsel kodlanamazsa `false`
  yazılır ve içe aktarma, kullanıcının IndexedDB'sindeki sağlam kopyaları
  temizlemez. Acil kopyalar bu alanı taşımaz. `true` olan bir dosyada
  panonun işaret ettiği görsel ne dosyada ne cihazda varsa, açılışta
  "görsel okunamadı" uyarısı gösterilir.
- **Sürüm reddi:** `version` alanı `2`'den büyükse içe aktarma, veriyi
  bozmamak için dosyayı reddeder. Alanı olmayan eski dosyalar kabul edilir.

## Otomatik yedek (auto mod) ile ilişki

- `.tail` **manuel kayıt modu** dosyasıdır (Ctrl+S) — kullanıcının seçtiği
  klasöre gider.
- **Auto mod** yedeği `userData/Backups/` altında **düz JSON** (kapsayıcı
  yok): `tailref-<ISO-stamp>.json`; rotasyon: son **20** yedek dışı silinir
  (`emergency-` öneki hariç); sağlıklı yedekler ek katmanda `Backups/good/`
  kopyası korunur (`inspectBackup` onaylı).

## UTF uyumlu uygulamalar için notlar

- Dosya son bayta kadar sıkıştırıldığından boyut/checksum beklenmez; sadece
  kapsayıcı doğrulanır.
- **Sürüm ilerlemesi**: kapsayıcı v1'den itibaren uyumlu okuma hedefidir;
  payload v2 şeması genişledikçe eski alanlar korunur (opsiyonel alanlar
  yoklukta `null`/eksik kabul edilir).
