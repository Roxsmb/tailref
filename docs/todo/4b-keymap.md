# Tur 4b · Merkezi Keymap Refactor — 4b.0 Denetim Raporu

> 14 Kasım 2026 · `grep addEventListener\('key(down|up|press)` ile 47 bağlama
> noktası bulundu; her biri okunarak döküldü. Karar kolonu 4b.2 hedefini
> gösterir: **A** = keymap tablosuna bağlanır (özelleştirilebilir),
> **B** = sabit kalır (UI/yardımcı — keymap dışı), **C** = kombinasyon
> (ilk turda sabit; 4b.2 sonunda raporda belirtilir).

> **DURUM (15 Kasım 2026): TUR 4b TAMAMLANDI.**
> • 4b.1 çekirdek (`23-keymap.js`, 28 eylem) · 4b.2 bağlama (inkws
>   delegasyonu + tahta switch + editör R) · 4b.3 isTyping kuralı ·
>   4b.4 Ayarlar UI · 4b.5 tuş rehberi senkronu · 4b.6 tercih yedeği
>   (export bölümü + doğrulanmış import) — hepsi bitti.
> • 4b.7 kalıcı kapı: `tests/keymap-test.js` (18/18) run-gates --full
>   zincirinde → **58/58 kapı yeşil**; masaüstü paketi SHA-256
>   3152724C6C5A0E7F4147DBFDEA1EBFE1DE39DEE2FA40C77E0983D80F7F8A6200
>   (115.006.607 bayt).
> • 4b.8 kapanış doğrulaması (kullanıcı istemi): tmp-4b8-live.js —
>   Ayarlar'daki TÜM kontroller canlı tek tek test edildi → **40/40
>   GEÇTİ** (16+12 kısayol satırı dahil; native diyalog açan 6 düğme
>   bağlama+IPC düzeyinde; işaretli bulgu: `toast()` tanımsız — geri
>   bildirim mesajları sessiz, eylemler çalışıyor).
> • Kalan (sonraki tur): 3D pose tuşları (faz 2, keysActive
>   birleştirmesi) + kombinasyon grupları (faz 3) + çakışmada BLOK
>   yerine yer değiştirme seçeneği + `toast()` bildirim kanalının
>   gerçek bir gösterimle bağlanması.

## 1. GLOBAL bağlama noktaları (window/document)

| # | Dosya:Satır | Kapsam | Tuş(lar) | Mod koşulu | Input atlanma | Karar |
|---|---|---|---|---|---|---|
| 1 | 15-menu-export.js:158 (+ keyup :369) | **Tahta modu ana tablosu** | ContextMenu/Shift+F10 menü; F11 tam ekran; Esc seçim temizle; Space pan; Delete/Backspace sil; F sığdır; H bar; 1 %100; T metin; ? yardım; B öne getir; G grupla; L bağlantı; X önemli; [ ] bg; Oklar (Shift=10) taşı; Ctrl+Z/Shift+Z/Y/A/D/S/E/O/0/+/-/T | `modeIsDraw()` → yalnız F11; fırça kütüphanesi açıkken return | editingId `typing` + `isTextField` (range/checkbox istisna listesi) + buton odak kontrolü ✓ | **A** (tek tuşlar) + **C** (modlar) |
| 2 | 30-ink-tools.js:2326 → inkHandleKeyDown:2167 | **Çizim motoru** | b/p/e/i/l/m/u/v/t araç; [ ] fırça boyutu; Shift+[ ] bg; Esc (kademeli: stroke→seçim→transient→image scope); Delete/Backspace (seçim yoksa katman sil) | `inkInlineModeActive()`; kütüphane açıkken return; mod tuşları (ctrl/alt/meta) → false | contentEditable/INPUT/TEXTAREA/SELECT + editingId ✓ | **A** — 42/44 ink-workspace 16 eylemiyle **tek kaynak** (bkz. §3) |
| 3 | 44-ink-workspace-controls.js:243 (capture) | **Çizim kısayol sistemi (Faz 4b.1)** | INK_WS_SHORTCUT_DEFS 16 eylem; kullanıcı tuşu = preventDefault+stopImmediatePropagation; motor varsayılanı = motora bırak | çizim çalışma alanı | inkWorkspaceShortcutsAllowed ✓ | **A** — keymap çekirdeğinin ilk istemcisi |
| 4 | 36-ink-editor.js:186-187 → :2590/:2712 | **Görüntü editörü** | Esc kademeli (radial→gizmo/marquee→seçim→overlay/renk çarkı); Ctrl+T serbest dönüştür; Space pan; Alt(Bottom) bas; R geçici döndürme (keyup bırak); +/-/0/1 zoom | `ui.open`; kütüphane + katman özellik diyaloğu açıkken return | `typing` + range istisna listesi ✓ | **A** (R; diğerleri ilk turda sabit) + **C** (Ctrl+T) |
| 5 | 48-shell.js:1404 (capture) | **Kabuk/mod geçişi** | Ctrl+1 çizim; Ctrl+2 referans; Ctrl+3 3D panel; Ctrl+0 zoom reset; Tab dock toggle | kütüphane açıkken return; `event.defaultPrevented` → return | `psShellShouldToggleOnTab` (INPUT/TEXTAREA/SELECT/BUTTON/A + dock bölgeleri) ✓ | **C** — kombinasyonlar ilk turda sabit |
| 6 | 50-layer-stack.js:1735 (capture) | **Katman işlemleri** (çizim + editör açık) | Shift+N yeni katman; Ctrl+J çoğalt; Ctrl+[ / Ctrl+] katman taşı; Ctrl+Shift+H görünürlük; Delete panel içi sil | `modeIsDraw()` + `inkEditorIsOpen()` | INPUT/TEXTAREA/SELECT/contentEditable ✓ | **C** (Shift+N hariç **A** adayı) |
| 7 | 26-projects.js:561 | Yeni pano | Ctrl+Shift+N | tahta modu | — | **C** |
| 8 | 22-init.js:133 (capture) | 3D poz yakalama | Ctrl+Shift+S (Alt=quick) | tahta modu | — | **C** |
| 9 | pose3d/ui/PanelController.js:1942 (capture, signal ile temizlenir) | **3D Poz paneli** | Esc (fullscreen/izolasyon); Numpad1/3/7 görünüm (Ctrl karşıt); Numpad5 persp↔ortho; Numpad0 sığdır; Numpad* odak; Ctrl+Z/Y; Q/W/E/R gizmo (R kontrolcü boyutu); X/Y/Z eksen; A tüm; F odak; Shift+F fullscreen; 5/0 | `keysActive`: panel görünür + (pointer içerde \| focus içerde \| hedef panelde); INPUT/SELECT/TEXTAREA ✓ | contentEditable + input etiketleri ✓ | **A** (tek tuşlar; faz 2 — planın 4b.2 sırası) |
| 10 | 32-ink-perf.js:193 (capture) | Geliştirici HUD | Alt+P | — | — | **B** — keymap dışı (tanı araçları) |
| 11 | 61-perf-diag.js:307 (capture) | Perf diyagnostik | Ctrl+Alt+P | — | — | **B** |
| 12 | 01-bootstrap.js:372 (capture, passive) | Undo debug günlüğü | tüm tuşları kaydeder, yutmaz | — | — | **B** |

## 2. GLOBAL — Escape/yardımcı kapatanlar (sabit, keymap dışı)

| Dosya:Satır | Kapsam |
|---|---|
| 17-floating-panels.js:106 (capture) | Esc → panel fullscreen çıkışı |
| 18-toolbar-layout.js:221 | Esc → overflow menü kapat |
| 26-projects.js:176 (capture) | İsim popover açıkken Enter/Escape (popover modali) |
| 41-canvas-workspace.js:267 (capture) | Esc → yeni tuval diyaloğu kapat |
| 52-native-brush-library.js:2542 (capture) | Ctrl+Z/Y fırça oluşturucu test undo (kütüphane açıkken; metin girişinde yerel undo korunur) |
| 52-native-brush-library.js:3885 / :3951 (capture) | Esc → fırça kütüphanesi / context menü kapat |
| 15-menu-export.js:369 | keyup Space → pan bitişi |

## 3. ELEMAN-kapsamlı handler'lar (keymap hedefi DEĞİL — alan içi gezinme/kısaltma)

07-groups:200 (metin input), 08-inspector-image:95/307, 15-menu-export:116
(context menü ok gezinmesi) / :812 (export form Esc), 19-themes-effects:206
(select), 20-settings-pomodoro:296, 23-pinterest:398 / 24-artstation:427
(URL input), 26-projects:1128 (input), 31-ink-ui:1218/1230 (hex/renk
input), 36-ink-editor:5246 (power slider), 39-mode:378 (mod adı input),
41-canvas-workspace:241, 43-ink-workspace-menu:475 (kısayol adı input),
44-ink-workspace-controls:548 (handle), 48-shell:417/952/1379 (başlık/
tuval/handle), 50-layer-stack:1599/1719 (diyalog/input), 52-native-brush-
library:3508/3579 (form/kart), 60-settings-hub:56/297 (nav/search).

## 4. 4b.2 eylem tablosu taslağı (tek doğruluk kaynağı keymap olacak)

**Mevcut çekirdek:** `42-ink-workspace.js` INK_WS_SHORTCUT_DEFS — 16 çizim
eylemi zaten {id, label, fallback} modelinde + `tailref-ink-workspace-v1`
kalıcılığı. 4b.1: keymap bu tabloyu **genişletir** (çizim dışı gruplar da
aynı modele girer), mevcut 16 eylemin kalıcılığı geriye uyumlu taşınır.

| Grup | Eylem id örnekleri | Varsayılan | Kaynak | Tur |
|---|---|---|---|---|
| Çizim | toolBrush/…, sizeDown/Up, colorWheel, fit, actual | mevcut 16 | 30/42/44 | 1 (zaten var) |
| Tahta | board.fit(F), board.toggleBar(H), board.zoom1(1), board.addText(T), board.bringFront(B), board.group(G), board.link(L), board.important(X), board.help(?), board.bgLeft([), board.bgRight(]) | tek tuşlar | 15 | 1 |
| Editör | editor.rotateView(R) | R | 36 | 1 |
| 3D | pose3d.translate(W)…, pose3d.viewFront(Numpad1)…, pose3d.camMode(Numpad5/5) | W/E/R/Q/F/5/0… | PanelController | 2 |
| Kombinasyon | undo/redo/selectAll/duplicate/save/export/open, mod geçişleri (Ctrl+1/2/3), katman işlemleri, Ctrl+Shift+N/S | — | 15/22/26/48/50 | 3 (sabit kalabilir) |

**Mod kapsam kuralı (kritik):** aynı fiziksel tuş farklı modlarda farklı
eylemlerdir (B: tahta=öne getir, çizim=fırça). Keymap sorgusu bugünkü
handler zinciri gibi **mod kapısıyla** yapılır; action id'leri global ama
çözümleme sırası: fırça kütüphanesi açık → çizim → editör → tahta → 3D
(panel görünür). Bu sıra bozulursa parite kapıları (ink-shortcut-test,
canvas-editor) kırılır — her grup sonrası koşulacak.

**Bilinen sorun (4b'de ele alınacak):** pose3d-smoke FAIL — "numpad 5
mod değiştiriyor": test çizim modunda 3D paneli açıyor; `keysActive`
panel görünür + pointer içerde koşuluyla Numpad5'e izin veriyor; testin
beklediği "panel gizliyken tuş yutulmuyor" davranışı ile çelişiyor.
4b.2 faz 2'de keysActive koşulları keymap kuralıyla (§4b.3) birleştirilecek.

## 5. 4b.3 kuralın mevcut karşılıkları (korunacak)

Zaten işleyen input-atlanma noktaları: 15-menu-export `isTextField`
(range/checkbox/radio/button/submit/reset/color/file istisnaları ile),
30-ink-tools:2176-2178, 36-ink-editor:2654-2660, 48-shell
`psShellShouldToggleOnTab`, 50-layer-stack:1737-1738, pose3d `bindKeys`
etiket kontrolü. 4b.3 bunları tek bir `tailrefKeymap.isTyping()` yardımcısına
toplar; davranış AYNI kalır (parite: metin yazımı kısayol ateşlemez).
