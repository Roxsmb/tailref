'use strict';

/* =========================================================
   30b · Şekil oturtma (hold-to-shape) tanıyıcı

   Kullanıcı serbest elle şekil çizerken kalemi basılı tutup
   ~2 saniye hareketsiz beklerse vuruş kusursuz geometriye
   dönüşür. Tanıyıcı yalnızca tetiklendiği anda TEK geçişte
   koşar (pointermove hattına girmez); maliyet < 0,1 ms.

   Boru hattı (orijinal C++ referans uygulamasının JS portu):
     1. ham vuruş → eşit aralıklı yeniden örnekleme (64 nokta)
     2. açık/kapalı ayrımı (uç mesafesi / toplam uzunluk)
     3. açık: düz çizgi → daire uydurma kalıntısı (Kasa en küçük
        kareler) → yay. Köşeli açık vuruşlar (L, V, S) ASLA
        yaya dönüştürülmez: dokunulup bırakılır.
     4. kapalı: daire (yarıçap varyasyon katsayısı + tek-daire
        kalıntısı). Tur 4j: üçgen/kare/dikdörtgen/çokgen dönüşümü
        KALDIRILDI — kullanıcı bu şekillerin otomatik düzeltilmesini
        istemiyor ("yuvarlak dışında başka hiçbir şekli tanımlama
        düzeltme yapmıyoruz"). Çok-turlu spiral/öz-kesişmeli döngü
        ASLA daireye dönüştürülmez (tek-daire kalıntısı kapısı).

   Çıktı: vuruş `kind:'shape'` + `shape:'line'|'arc'|'circle'`
   olur; noktalar poliline olarak saklanır (render açısından
   uygundan bağımsız, kayıt/geri al mevcut yollarla çalışır).

   Tur 4j · MÜKEMMELLEŞTİRME (smooth-on-null yükseltmesi): hiçbir
   şekle benzemeyen iz bekletilince (kalem basılı) yerinde
   mükemmelleştirilir — inkShapeSnapFairPath: uçlar bit-birebir,
   keskin köşeler (Z harfi) tespit edilip SABİTLENİR (sivri kalır),
   yumuşak bölgeler uyarlanabilir çapalı akıtma ile pürüzsüzleşir;
   tepe/çukur/döngü YAPISI korunur (kullanıcı: "zikzak zikzak
   kusursuz bir şeye dönüşsün; z çizerken s'e dönüşmesin; spiral
   yuvarlağa dönüştürülmemeli"). 36/30 portları bu çekirdeği çağırır.

   Tur 4i · TETİKLEME SÖZLEŞMESİ (Procreate modeli): oturtma YALNIZ
   bilinçli BEKLEMEDE ateşler (kalem basılı, ~550 ms hareketsiz —
   hold zamanlayıcısı). Kalemi BEKLEMEDEN bırakmak ASLA oturtmaz:
   boyama/karalama/çizgi bırakışları ham iz olarak commit edilir
   (kullanıcı: "boyamayı bitirip bırakıyorum yuvarlağa dönüşüyor" —
   bırakış-anı oturtması denenmişti, Tur 4i'de tamamen kaldırıldı).

   Bu dosya saf geometri içerir: DOM/kitaplık bağımlılığı yok —
   tests/shape-snap-check.js saf Node'da yükleyip birim test eder.
   ========================================================= */

/* ---- eşikler (elle çizim toleransları) ---- */
const INK_SNAP_N = 64;            // yeniden örnekleme nokta sayısı
/* Bekleme: referans etkileşim ~0,5 sn'dir. Kalem bırakılmadan dönüştürme
   canlı görünür. Tur 4'te "harekete devam → revert" kalktı (hareket
   artık canlı şekil ayarı); bu yüzden kısa bekleme normal çizimde
   yanlış tetiklenme YARATIR — Tur 4f ateşlemeyi fireCheck koşuluna
   bağladı: yavaş çizim ve mikro duraksamalar dönüştürme tetiklemez. */
const INK_SNAP_HOLD_MS = 550;     // hareketsizlik süresi (ms)
const INK_SNAP_HOLD_MOVE_PX = 8;  // bu ekran-px yer değişimi "hareket" sayılır
/* Tur 4f v5 · oyalanma (crawl) koruması eşikleri — canlı ölçümle
   kalibre (tests/tmp-diag-hold.js, 13 Kasım 2026):
   quiet  = son iz girişinin yaşı eşiği. Sürünmede olay yaşı ~24-26ms,
            60-70ms mikro duraksamada ~85-95ms → ikisi de taze → kalem
            AKTİF. Yaş ≥ quiet (duruş ≥ ~220ms; GC durgunlaşması
            dahil) → ateşle.
   ratio  = düznlük oranı (net/yol, ≤640ms pencere): titreme salınımı
            net'i yolun ~0.04-0.16'sında tutar → ateşle; sürünme
            ~0.5-0.85 → koru.
   net    = yürüyüş-toleranslı net tabanı: sentetik/adım gürültüsü
            (±0.6px/kare rastgele yürüyüş) net'i sinyalle çarpıştırıp
            oranı 0.3'ün altına indiriyor (ölçüm: sürünme net 1.89-3.48
            ile ateşlemeler üretti). wnet ≥ 1.7 = "yine de belirgin
            ilerliyor" → koru. Titreme net'i 0.39 (ölçüm) → ateşler.
   resked = erteleme sonrası yeniden deneme aralığı (tam bekleme değil).
   (v4'ün prod+net eşiği canlı probe'da çöktü: sürünme net(640ms)
   2.77-2.96px ölçüldü, 4px eşiğin ALTINDA → skip hiç çalışmadı.) */
const INK_SNAP_HOLD_QUIET_MS = 220; // giriş yaşı: altı = kalem aktif
const INK_SNAP_HOLD_RATIO = 0.3;    // net/yol: altı = titreme salınımı
const INK_SNAP_HOLD_NET_PX = 1.7;   // yürüyüş toleransı: net tabanı
const INK_SNAP_HOLD_RESKED_MS = 220;
/* Kalem basılı beklerken el titremesi 3 px'i aşabiliyordu: zamanlayıcı
   sürekli yeniden kuruluyor ve oturtma hiç tetiklenmiyordu. */
const INK_SNAP_MIN_LEN = 28;      // tanınabilir en kısa vuruş (px uzayı)
const INK_SNAP_MIN_PTS = 8;       // tanınabilir en az ham nokta
const INK_SNAP_CLOSED_RATIO = 0.12;   // uçlar/uzunluk ≤ → kapalı şekil
/* NOT: daha büyük uç boşlukları (280°+ tarama) kasıtlı olarak KAPALI
   dalına girmez; açık daldaki halka kararı (TURN_CIRCLE) onları
   yakalar. 0.16'ya gevşetmek kanca girişli/kuyruklu halkaları köşe
   sınıflandırıcıya düşürüp polygon sanıyordu. */
const INK_SNAP_LINE_RATIO = 0.93;     // uçlar/uzunluk ≥ → düz çizgi
const INK_SNAP_CIRCLE_CV = 0.18;      // daire: yarıçap varyasyon katsayısı
const INK_SNAP_ARC_CV = 0.09;         // yay: daire-uyma kalıntısı
const INK_SNAP_MAX_TURN = 0.75;   // radyan: üstü köşeli (yay olamaz)
const INK_SNAP_CORNER_TURN = 0.6; // radyan ~34°: kapalı şekil köşelilik sınırı
const INK_SNAP_MIN_SWEEP = 0.7;   // radyan ~40°: en az yay taraması
/* Tur 4j · tek-daire kalıntısı kapısı: döngü sayısı fark etmeksizin
   KASA uydurmasından dönen tek daireye uyma kalıntısı bu eşiği aşan
   iz daire DEdilmez → mükemmelleştirmeye düşer. Kalibrasyon (13.11):
   kalp 0.226-0.230 (reddedilir), kuyruklu-6 0.201-0.209 (geçer),
   kanca 0.193-0.196 (geçer), basık oval 0.168 (geçer). */
const INK_SNAP_CIRCLE_RES = 0.215;    // rms((|p−c|−r)/r) tavanı
/* Yarım-yay drift tavanı: içe/dışa spiral 0.243+/0.57+ (reddedilir),
   kanca girişli halka 0.195-0.211 (geçer), tek-turlu halkalar <0.02. */
const INK_SNAP_CIRCLE_DRIFT = 0.22;

/* Tur 4j · MÜKEMMELLEŞTİRME sabitleri (smooth-on-null çekirdeği).
   Sözleşme: keskin köşeler SİVRİ kalır (Z asla S olmaz), yumuşak iz
   daha da yumuşar; tepe/çukur/döngü/spiral yapısı korunur; uçlar
   bit-birebir. Kullanıcı: "zikzak kusursuz bir şeye dönüşsün; z
   çizerken s'e dönüşmesin; spiral yuvarlağa dönüştürülmemeli." */
const INK_FAIR_MIN_PTS = 8;        // bu kadar az nokta değmez
const INK_FAIR_MIN_LEN = 6;        // toplam yol (px): altı değmez
const INK_FAIR_STEP_LO = 1.2;      // yeniden örnekleme adım sınırları (px)
const INK_FAIR_STEP_HI = 4;
const INK_FAIR_MAX_N = 4096;       // örnek tavanı (aşırı uzun vuruş)
const INK_FAIR_WIN = 0.02;         // köşe penceresi = örnek sayısı × bu
const INK_FAIR_CORNER_TURN = 0.72; // radyan ~41°: üstü keskin köşe
const INK_FAIR_MAX_CORNERS = 14;   // üstü = karalama → hafif mod
const INK_FAIR_LAMBDA = 0.5;       // Taubin alçak geçiren λ
const INK_FAIR_MU = 0.62;          // Taubin μ (μ>λ: küçülme nötrü)
const INK_FAIR_MU_SOFT = 0.56;     // karalama modu μ (nazik)
const INK_FAIR_PAIRS = 40;         // geçiş çifti tavanı (güçlü mod)
const INK_FAIR_PAIRS_MIN = 10;
const INK_FAIR_SOFT_PAIRS = 16;
const INK_FAIR_SOFT_MIN = 4;
const INK_FAIR_ROUGH_MIN = 0.05;   // hedef pürüzlülük tabanı (px)
const INK_FAIR_ROUGH_RATIO = 0.08; // hedef = rough0 × bu (güçlü mod)
const INK_FAIR_SOFT_RATIO = 0.35;  // karalama hedef oranı
const INK_FAIR_DISP_RATIO = 0.02;  // yer-değiştirme tavanı = yol × bu
const INK_FAIR_DISP_MIN = 1;       // (px)
const INK_FAIR_DISP_MAX = 6;
const INK_FAIR_SPAN_DISP = 0.08;   // span uydurma tavanı = span × bu
/* 4.9 rad ~280°: boşluklu kapanışlı daireler (60°'ye varan açık boşluk)
   daire sayılsın. Açık "C" yayı ~270° (4,71 rad) kaldığı sürece yay
   sınıfında kalır; 280° üstü halkadır. */
const INK_SNAP_TURN_CIRCLE = 4.9; // radyan ~280°: toplam dönüş bu kadarsa halkadır
const INK_SNAP_MAX_GAP = 2.2;     // radyan ~126°: daire açı boşluğu sınırı
/* Tur 4k · açık halka kararı BOŞLUK kuralı: |sweep| ≥ 280° iken açı
   boşluğu 2π−|sweep| bu eşiğin altındaysa halka/daire; üstündeyse iz
   bilinçli AÇIK kıvrımdır (C/D) → yay kalır. Kalibrasyon: C-kıvrımı
   ~293° tarar (boşluk ~67°) → yay; kanca girişli halka örtüşlüdür
   (boşluk negatif) → daire. */
const INK_SNAP_TURN_GAP = 0.8;    // radyan ~46°: halka boşluk tavanı
/* Oturtma sonrası kalem bu kadar (ekran-px) hareket ederse vuruş eski
   ham izine döner ve çizim normal sürer (yanlış oturtmayı geri al). */
const INK_SNAP_REVERT_PX = 8;

/* =========================================================
   Tur 4k · ÇOKGEN (poly) + ROBUST DAİRE/ELİPS + YAPISAL SPAN
   Kullanıcı sözleşmesi (13.11.2026 fotoğraflar + yanıtlar):
     · Bekletilen HER vuruş GÖRÜNÜR düzelir ve daire gibi düzenleme
       moduna girer.
     · Kapalı el karesi/üçgeni/çokgeni de kusursuz ÇOKGENE dönüşür
       (Tur 4j "kare/üçgen dönüştürülmez" sözleşmesi kullanıcı
       onayıyla değişti: "Evet — bekletilen her şey düzelsin").
     · Basık oval (2:1) OVAL KALIR (en-boy korunur), daireye
       zorlanmaz; düzenlenebilir şekil nesnesi olur.
     · C/D kıvrımı (~300°) KUSURSUZ YAY olur, halkaya kapanmaz.
   ========================================================= */
const INK_SNAP_POLY_MIN = 3;        // kapalı çokgen köşe alt sınırı
const INK_SNAP_POLY_MAX = 12;       // üstü karalama → çokgen değil
const INK_SNAP_SPAN_STRAIGHT = 0.35; // radyan: |turn| altı = düz span
const INK_SNAP_SPAN_STRAIGHT_DEV = 0.10; // Tur 4k · dev/len altı = düz span
// (akord-sapması düzlük kanıtı: uygulama girişinde One-Euro +
//  Catmull-Rom köşe dönüşünü bacaklara taşar; işaretli dönüş 0.35'i
//  aşsa da iz akorda yakın dursa (≤ %10) düzdür. Gerçek yay aralıkları
//  0.2+ sapar: 72° yay ~0.22, çeyrek ~0.29, yarım ~0.50 — boşluklu
//  halkanın küme-arası yayları bu kanıtla asla düz sayılmaz.)
const INK_SNAP_SPAN_STRAIGHT_PEAK = 0.75; // dev kuralı zirve tavanı (rad)
// (dev kuralı yalnız span içinde MAX_TURN altı zirve varsa düz der:
//  uzun zigzag span'lerde dev/len küçülür (2 köşeli ~750px span'de
//  0.093!) — zirve kanıtı olmadan düzlük yalan söyler; ≥0.75 zirve
//  gerçek kaçık köşedir → RefineCorners köşe yapar.)
const INK_SNAP_SPAN_WAVES = 2;      // eğrilik işaret değişimi ≥ → dalgalı
const INK_SNAP_SPAN_WAVE_DEV = 0.12; // dalgalı span sapma tavanı (span oran;
                                    // zikzak bacağı yakalar, YAYI yutmaz:
                                    // çeyrek yay bile ~0.19 sapar)
const INK_SNAP_SPAN_ARC_MAX = 1.75 * Math.PI * 2; // yay span dönüş tavanı
const INK_SNAP_ARC_FIT_RES = 0.09;  // span yay uydurma kalıntısı tavanı
const INK_SNAP_ARC_FIT_DISP = 0.06; // yay uydurma yer-değiştirme (span oran)
const INK_SNAP_DOM_FRAC = 0.45;     // baskın köşe eşiği = maxTurn × bu
const INK_SNAP_DOM_MIN = 0.6;       // baskın köşe alt sınırı (radyan)
const INK_SNAP_INLIER_MIN = 0.62;   // robust uyumda içiuygun örnek oranı
const INK_SNAP_ELLIPSE_BETTER = 0.72; // elips kalıntısı < daire×bu → elips
const INK_SNAP_ELLIPSE_RATIO = 1.18;  // rx/ry bu oran dışında = gerçek oval
const INK_SNAP_ELLIPSE_SWEEP = 1.25;  // elips yalnız ~tek turda (×2π)
const INK_SNAP_SPIRAL_CORR = 0.6;   // r↔yay korelasyonu üstü = spiral
/* kopukluk (br) köprüleme: boşluk bu eşiğin altındaysa parçalar
   birleştirilir (iz bir bütün gibi düzeltilir); üstündeyse vuruş
   parçalara bölünüp her parça ayrı düzeltilir (br uçta korunur). */
const INK_SNAP_HEAL_GAP_MIN = 24;   // px
const INK_SNAP_HEAL_GAP_RATIO = 0.06; // toplam yol oran

function inkShapeSnapDist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function inkShapeSnapLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += inkShapeSnapDist(pts[i - 1], pts[i]);
  return len;
}

/** C++ port: hız farkından doğan yoğunluk kaymasını dengeler. */
function inkShapeSnapResample(pts, step) {
  if (pts.length < 2 || !(step > 0)) return pts.slice();
  const out = [pts[0]];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let curr = pts[i];
    let segLen = inkShapeSnapDist(prev, curr);
    while (acc + segLen >= step && segLen > 0) {
      const t = (step - acc) / segLen;
      const np = {
        x: prev.x + t * (curr.x - prev.x),
        y: prev.y + t * (curr.y - prev.y),
      };
      out.push(np);
      prev = np;
      segLen = inkShapeSnapDist(prev, curr);
      acc = 0;
    }
    acc += segLen;
    prev = curr;
  }
  if (inkShapeSnapDist(out[out.length - 1], pts[pts.length - 1]) > 1e-6) {
    out.push(pts[pts.length - 1]);
  }
  return out;
}

/** Kırpılmış (segment içinde kalan) nokta–doğru parçası uzaklığı.
    Kapsama denetimi segment uçlarında aşırı genişleyemez, bu
    yüzden burada kırpılır. */
function inkShapeSnapSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return inkShapeSnapDist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Tur 4c · yuvarlatılmış köşeler için köşe bölgesi kümeleme.
    RDP eps'i köşeyi yutabilir (el-karesi köşeleri yumuşaktır); bunun
    yerine DÖNÜŞ enerjisi kullanılır: W=3 örneklik pencerede toplam
    dönüş ≥ INK_SNAP_CORNER_TURN olan ardışık örnekler bir köşe bölgesi
    kümesidir (küme en az 2 örnek — tek örneklik titreşim sivri ucu
    kümelenmez). Daire dönüşü tüm pencerelere dağılır (~0.29 rad) →
    küme üretmez. Dönüş: çizim sırasında köşe merkezleri (px uzayı). */
/** Tur 4c · yuvarlatılmış köşeler için köşe bölgesi kümeleme.
    RDP eps'i köşeyi yutabilir (el-karesi köşeleri yumuşaktır); bunun
    yerine DÖNÜŞ enerjisi kullanılır: W=3 örneklik pencerede toplam
    dönüş ≥ INK_SNAP_CORNER_TURN olan ardışık örnekler bir köşe bölgesi
    kümesidir (küme en az 2 örnek — tek örneklik titreşim sivri ucu
    kümelenmez). Daire dönüşü tüm pencerelere dağılır (~0.29 rad) →
    küme üretmez.

    Tur 4c.2 · BASKINLIK: çokgende köşeler ARASINDAKİ kenarlar düzdür —
    kümelerin DIŞINDA kalan pencerelerin medyan dönüşü ~0'dır.
    Dalgalı/oval kapalı çizimlerde ise dönüş tüm path'e DAĞILIR:
    küme eşiği yalnızca "taban + salınım"ın aynı yöne katlandığı
    yerleri işaretlediğinden kümeler dışı medyan yine tabana yakın
    kalır (≥ ~0.2 rad). Dönüş: { list: köşe merkezleri,
    outMedian: küme dışı pencere dönüş medyanı (rad) }. */
function inkShapeSnapCornerClusters(rs) {
  const W = 3;
  const n = rs.length;
  const turns = [];
  const marks = [];
  for (let i = W; i + W < n; i++) {
    const v1x = rs[i].x - rs[i - W].x, v1y = rs[i].y - rs[i - W].y;
    const v2x = rs[i + W].x - rs[i].x, v2y = rs[i + W].y - rs[i].y;
    const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
    if (m1 < 1e-9 || m2 < 1e-9) { turns.push(0); continue; }
    const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
    const turn = Math.acos(dot);
    turns.push(turn);
    if (turn >= INK_SNAP_CORNER_TURN) marks.push(i);
  }
  if (!marks.length) return { list: [], outMedian: null };
  const clusters = [];
  let cur = [marks[0]];
  for (let k = 1; k < marks.length; k++) {
    if (marks[k] - cur[cur.length - 1] <= 2) cur.push(marks[k]);
    else { clusters.push(cur); cur = [marks[k]]; }
  }
  clusters.push(cur);
  /* Küme DIŞI pencere dönüşleri: gerçek köşeli şekilde bunlar düz
     kenarlardır (~0); daire/bükümli çizimde taban dönüşü sürer. */
  const inCluster = new Set();
  for (const c of clusters) {
    if (c.length < 2) continue; // tek örnek: titreşim sivri ucu
    for (const i of c) inCluster.add(i);
  }
  const outside = [];
  for (let k = 0; k < turns.length; k++) {
    if (inCluster.has(k + W)) continue;
    if (turns[k] < INK_SNAP_CORNER_TURN) outside.push(turns[k]);
  }
  outside.sort((a, b) => a - b);
  const outMedian = outside.length
    ? outside[Math.floor(outside.length / 2)] : null;
  const list = [];
  const idx = [];
  for (const c of clusters) {
    if (c.length < 2) continue; // tek örnek: titreşim sivri ucu
    let sx = 0, sy = 0;
    /* Tur 4k: çapa ÖRNEK İNDEKSİ de taşınır (kümenin en-dönüşlü
       örneği) — span bölmeleri ve çokgen köşeleri bu indeksle kurulur. */
    let bestI = c[0], bestT = -1;
    for (const i of c) {
      sx += rs[i].x; sy += rs[i].y;
      /* turns[j] = j+W örneğinin dönüşü — çapa KÜMENİN en-dönüşlü
         örneğidir (indeks kayması dizi dışına taşıyordu). */
      if (turns[i - W] > bestT) { bestT = turns[i - W]; bestI = i; }
    }
    list.push({ x: sx / c.length, y: sy / c.length });
    idx.push({ i: bestI, energy: bestT });
  }
  return { list, idx, outMedian };
}

/** Kasa doğrusal en küçük kareler daire uydurması → {cx, cy, r} | null */
function inkShapeSnapFitCircle(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x; sy += p.y;
    sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    sxz += p.x * z; syz += p.y * z; sz += z;
  }
  // [sxx sxy sx; sxy syy sy; sx sy n] · [A B C]ᵀ = [-sxz -syz -sz]ᵀ
  const det = sxx * (syy * n - sy * sy) - sxy * (sxy * n - sy * sx) + sx * (sxy * sy - syy * sx);
  if (Math.abs(det) < 1e-9) return null;
  const A = ((-sxz) * (syy * n - sy * sy) - sxy * ((-syz) * n - sy * (-sz)) + sx * ((-syz) * sy - syy * (-sz))) / det;
  const B = (sxx * ((-syz) * n - sy * (-sz)) - (-sxz) * (sxy * n - sy * sx) + sx * (sxy * (-sz) - (-syz) * sx)) / det;
  const C = (sxx * (syy * (-sz) - (-syz) * sy) - sxy * (sxy * (-sz) - (-syz) * sx) + (-sxz) * (sxy * sy - syy * sx)) / det;
  const cx = -A / 2, cy = -B / 2;
  const rSq = cx * cx + cy * cy - C;
  if (!Number.isFinite(rSq) || rSq <= 0) return null;
  return { cx, cy, r: Math.sqrt(rSq) };
}

/** Tek-daireye uyum kalıntısı: rms(|p−c|−r)/r. Spiral/çok döngülü
    dolambaçlar tek daireye sığmaz → kalıntı tavanı aşar (Tur 4j). */
function inkShapeSnapCircleResidual(pts, cx, cy, r) {
  if (!(r > 1e-9) || !pts.length) return Infinity;
  let s = 0;
  for (const p of pts) {
    const e = (inkShapeSnapDist(p, { x: cx, y: cy }) - r) / r;
    s += e * e;
  }
  return Math.sqrt(s / pts.length);
}

/** Tek-daire drift denetimi (Tur 4j): izi yay-uzunluğunda ikiye böl,
    her yarıma ayrı Kasa daire uydur. Spiral/dışa açılan dolambaçta
    yarıçaplar MONOTON büyür → drift oranı |r2−r1|/r1 tavanı aşar →
    tek daire değildir. Gerçek dairede iki yarım aynı yarıçapta
    uyar (drift ~0). Uydurma yoksa Infinity (kapı kapanır). */
function inkShapeSnapCircleDrift(rs) {
  const m = rs.length;
  if (m < 16) return Infinity;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + inkShapeSnapDist(rs[i - 1], rs[i]);
  const half = cum[m - 1] / 2;
  let k = 1;
  while (k < m - 1 && cum[k] < half) k++;
  const A = rs.slice(0, k + 1), B = rs.slice(k);
  if (A.length < 8 || B.length < 8) return Infinity;
  const fA = inkShapeSnapFitCircle(A), fB = inkShapeSnapFitCircle(B);
  if (!fA || !fB || !(fA.r > 1e-6)) return Infinity;
  return Math.abs(fB.r - fA.r) / fA.r;
}

/** [-π, π] aralığına indirgenmiş açı farkı. */
function inkShapeSnapAngleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Tur 4g · Kapalı aday yolu "en düz" örnekten başlatacak şekilde
    döndürür. Kümeleme taraması ilk/son W örneği atlar; başlangıç bir
    köşenin üstüne denk gelirse o köşe hiç kümelemez (teşhis:
    köşeden başlayan dikdörtgende yalnız 2 küme üretildi, dikdörtgen
    sınıfı düşüyordu). Yol en düşük pencere-dönüş enerjili örnekten
    (kenar ortası) başlatılır; nokta sırası korunur, dairesel geometri
    değişmez. Açık şekiller (çizgi/yay) döndürülmeden sınıflanır. */
function inkShapeSnapRotateFlat(rs) {
  const n = rs.length;
  if (n < 12) return rs;
  const heads = [];
  for (let i = 0; i < n; i++) {
    const a = rs[i], b = rs[(i + 1) % n];
    heads.push(Math.atan2(b.y - a.y, b.x - a.x));
  }
  let best = 0, bestE = Infinity;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let k = 0; k < 4; k++) {
      e += Math.abs(inkShapeSnapAngleDelta(
        heads[(i + k) % n], heads[(i + k + n - 1) % n]));
    }
    if (e < bestE) { bestE = e; best = i; }
  }
  return rs.slice(best).concat(rs.slice(0, best));
}

/* =========================================================
   Tur 4k · YAPISAL YARDIMCILAR
   Span profili + sınıf kararı (düz / yay / dokunma), pinli uçlu yay
   uydurma, robust (aykırı-kırpışlı) daire uydurma, eksen-hizalı elips
   uydurma, spiral koruması ve çokgen (poly) aday kurucular.
   Hem tanıyıcı (recognize) hem mükemmelleştirici (fair) kullanır.
   ========================================================= */

/** Span profili: [a..b] örnekleri (wrapN > 0 → döngüsel indeks).
    dev: akordtan azami sapma; turn: işaretli toplam dönüş;
    waves: filtrelenmiş eğrilik işaret değişimi; peak: iç dönüş zirvesi. */
function inkShapeSnapSpanProfile(px, py, a, b, wrapN) {
  const at = i => {
    if (!wrapN) return i;
    const m = ((i % wrapN) + wrapN) % wrapN;
    return m;
  };
  const nS = b - a;
  const P = i => ({ x: px[at(i)], y: py[at(i)] });
  // uzunluk + işaretli dönüş
  let len = 0, turn = 0;
  let prevHead = null;
  for (let i = a; i < b; i++) {
    const p1 = P(i), p2 = P(i + 1);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const seg = Math.hypot(dx, dy);
    len += seg;
    if (seg > 1e-9) {
      const head = Math.atan2(dy, dx);
      if (prevHead !== null) turn += inkShapeSnapAngleDelta(head, prevHead);
      prevHead = head;
    }
  }
  // akord sapması
  const pa = P(a), pb = P(b);
  let dev = 0;
  for (let i = a + 1; i < b; i++) {
    const d = inkShapeSnapSegDist(P(i), pa, pb);
    if (d > dev) dev = d;
  }
  // eğrilik işaret dizisi → dalga sayısı
  let waves = 0;
  {
    let lastSign = 0;
    for (let i = a + 1; i < b; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1);
      const ax = p1.x - p0.x, ay = p1.y - p0.y;
      const bx = p2.x - p1.x, by = p2.y - p1.y;
      const m1 = Math.hypot(ax, ay), m2 = Math.hypot(bx, by);
      if (m1 < 1e-9 || m2 < 1e-9) continue;
      const cross = (ax * by - ay * bx) / (m1 * m2); // sin(dönüş)
      if (Math.abs(cross) < 0.05) continue;         // mikro titreme sayılmaz
      const sign = cross > 0 ? 1 : -1;
      if (lastSign !== 0 && sign !== lastSign) waves++;
      lastSign = sign;
    }
  }
  // iç dönüş zirvesi (eksik köşe yakalama için)
  let peakIdx = -1, peakTurn = 0;
  {
    const w = Math.max(1, Math.min(3, Math.floor(nS / 4)));
    for (let i = a + w; i <= b - w; i++) {
      const p0 = P(i - w), p1 = P(i), p2 = P(i + w);
      const v1x = p1.x - p0.x, v1y = p1.y - p0.y;
      const v2x = p2.x - p1.x, v2y = p2.y - p1.y;
      const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
      if (m1 < 1e-9 || m2 < 1e-9) continue;
      const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
      const t = Math.acos(dot);
      if (t > peakTurn) { peakTurn = t; peakIdx = at(i); }
    }
  }
  return { len, dev, turn, waves, peakIdx, peakTurn };
}

/** Span sınıfı: 'straight' | 'arc' | 'keep'.
    · |turn| ≤ 0.35 → düz ( Nazik bük dahi akord üzerine dizilir).
    · dalgalı (işaret değişimi ≥ 2) ve sapma makul → düz (zikzak bacağı
      kusursuz düzlenir — kullanıcının "dalgalı V temiz V olsun" isteği).
    · tutarlı eğrilik (dalgasız) ve dönüş makul → yay adayı.
    · geri kalan → dokunma (Taubin hâli korunur). */
function inkShapeSnapSpanClass(prof) {
  const t = Math.abs(prof.turn);
  /* Tur 4k · zirve koruması: span içinde MAX_TURN (0.75) üstü zirve
     varsa gerçek kaçık köşe taşır — net dönüş küçük bile olsa
     (zigzag köşeleri iptal olur, W parçasında |turn| 0.09!) düz
     SAYILMAZ; RefineCorners köşeyi ekler. Uygulama bacaklarının
     köşe-taşması zirveleri 0.27–0.41 → korumayı geçer. */
  if (prof.peakTurn <= INK_SNAP_SPAN_STRAIGHT_PEAK) {
    if (t <= INK_SNAP_SPAN_STRAIGHT) return 'straight';
    /* akord-sapması düzlük kanıtı: uygulama girişinde (One-Euro +
       Catmull-Rom) köşe dönüşü bacaklara taşar; işaretli dönüş
       büyüse de iz akorda yakın dursa (dev/len ≤ %10) düz sayılır.
       Gerçek yay aralıkları 0.2+ sapar → boşluklu halkanın
       küme-arası yayları asla düz sınıflanmaz. */
    if (prof.dev <= prof.len * INK_SNAP_SPAN_STRAIGHT_DEV) return 'straight';
    /* dalga kuralı: zikzak bacağı kusursuz düzlenir (WAVE_DEV 0.12
       yayı yutmaz: çeyrek yay ~0.19 sapar). */
    if (prof.waves >= INK_SNAP_SPAN_WAVES &&
        prof.dev <= prof.len * INK_SNAP_SPAN_WAVE_DEV) return 'straight';
  }
  if (prof.waves === 0 && t > INK_SNAP_SPAN_STRAIGHT &&
      t <= INK_SNAP_SPAN_ARC_MAX) return 'arc';
  return 'keep';
}

/** Span'i pinli uçlu yay üzerine oturtur (yerinde). Uçlar bit-birebir
    kalır (r0/r1 lerp + kendi θ'sı). Yer-değiştirme tavanı aşılırsa
    dokunmaz (false). Tur 4k fair v2 kullanır. */
function inkShapeSnapSpanArcApply(X, Y, OX, OY, a, b) {
  const m = b - a;
  if (m < 4) return false;
  const pts = [];
  for (let k = a; k <= b; k++) pts.push({ x: X[k], y: Y[k] });
  const f = inkShapeSnapFitCircle(pts);
  if (!f) return false;
  const res = inkShapeSnapCircleResidual(pts, f.cx, f.cy, f.r);
  if (!(res <= INK_SNAP_ARC_FIT_RES)) return false;
  const cx = f.cx, cy = f.cy;
  const r0 = Math.hypot(X[a] - cx, Y[a] - cy);
  const r1 = Math.hypot(X[b] - cx, Y[b] - cy);
  if (!(r0 > 1e-6) || !(r1 > 1e-6)) return false;
  // span yay uzunlukları
  const cum = new Float64Array(m + 1);
  for (let k = a + 1; k <= b; k++) {
    cum[k - a] = cum[k - a - 1] + Math.hypot(X[k] - X[k - 1], Y[k] - Y[k - 1]);
  }
  const spanLen = cum[m];
  if (!(spanLen > 1e-9)) return false;
  const cap = Math.max(6, spanLen * INK_SNAP_ARC_FIT_DISP);
  let maxD = 0;
  const nx = new Float64Array(m + 1), ny = new Float64Array(m + 1);
  for (let k = a; k <= b; k++) {
    const t = cum[k - a] / spanLen;
    const r = r0 + (r1 - r0) * t;
    const th = Math.atan2(Y[k] - cy, X[k] - cx);
    const qx = cx + Math.cos(th) * r, qy = cy + Math.sin(th) * r;
    nx[k - a] = qx; ny[k - a] = qy;
    const d = Math.hypot(qx - OX[k], qy - OY[k]);
    if (d > maxD) maxD = d;
  }
  if (maxD > cap) return false;
  for (let k = a; k <= b; k++) { X[k] = nx[k - a]; Y[k] = ny[k - a]; }
  return true;
}

/** Robust (2 tur aykırı-kırpışlı) Kasa daire uydurması.
    Kanca/çıntı gibi yerel aykırılar aykırı sonuç değildir; içiuygun
    oranına ve içiuygun yarılara göre drift döner. */
function inkShapeSnapRobustCircle(rs) {
  const n = rs.length;
  if (n < 16) return null;
  let f = inkShapeSnapFitCircle(rs);
  if (!f) return null;
  let idx = null;
  for (let round = 0; round < 2; round++) {
    const es = [];
    for (const p of rs) {
      es.push(Math.abs((inkShapeSnapDist(p, { x: f.cx, y: f.cy }) - f.r) / f.r));
    }
    const sorted = es.slice().sort((x, y) => x - y);
    const med = sorted[Math.floor(sorted.length / 2)];
    const tol = Math.max(0.06, med * 2.5);
    idx = [];
    for (let i = 0; i < n; i++) if (es[i] <= tol) idx.push(i);
    if (idx.length < 12) return null;
    const inl = idx.map(i => rs[i]);
    const f2 = inkShapeSnapFitCircle(inl);
    if (!f2) return null;
    f = f2;
  }
  const inl = idx.map(i => rs[i]);
  const res = inkShapeSnapCircleResidual(inl, f.cx, f.cy, f.r);
  // içiuygun yarılara göre drift (kanca tamamen kırpılmış olur)
  const cum = new Float64Array(idx.length);
  for (let k = 1; k < idx.length; k++) {
    cum[k] = cum[k - 1] + inkShapeSnapDist(rs[idx[k - 1]], rs[idx[k]]);
  }
  const half = cum[idx.length - 1] / 2;
  let s = 1;
  while (s < idx.length - 1 && cum[s] < half) s++;
  const A = inl.slice(0, s + 1), B = inl.slice(s);
  let drift = Infinity;
  if (A.length >= 8 && B.length >= 8) {
    const fA = inkShapeSnapFitCircle(A), fB = inkShapeSnapFitCircle(B);
    if (fA && fB && fA.r > 1e-6) drift = Math.abs(fB.r - fA.r) / fA.r;
  }
  return {
    cx: f.cx, cy: f.cy, r: f.r, res,
    idx, inlierRatio: idx.length / n, drift,
  };
}

/** Eksen-hizalı elips eksen uydurması (verilen merkezde): A·u²+B·v²=1
    doğrusal LSQ → rx=1/√A, ry=1/√B. Kalıntı: rms(|√(Au²+Bv²)−1|). */
function inkShapeSnapEllipseAxes(rs, idx, cx, cy) {
  if (!idx || idx.length < 12) return null;
  let su4 = 0, sv4 = 0, suv = 0, su2 = 0, sv2 = 0;
  for (const i of idx) {
    const u = rs[i].x - cx, v = rs[i].y - cy;
    const u2 = u * u, v2 = v * v;
    su4 += u2 * u2; sv4 += v2 * v2; suv += u2 * v2;
    su2 += u2; sv2 += v2;
  }
  const det = su4 * sv4 - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const A = (su2 * sv4 - sv2 * suv) / det;
  const B = (su4 * sv2 - suv * su2) / det;
  if (!(A > 0) || !(B > 0)) return null;
  const rx = 1 / Math.sqrt(A), ry = 1 / Math.sqrt(B);
  if (!(rx > 2) || !(ry > 2)) return null;
  let s = 0;
  for (const i of idx) {
    const u = rs[i].x - cx, v = rs[i].y - cy;
    const q = Math.sqrt(A * u * u + B * v * v);
    const e = q - 1;
    s += e * e;
  }
  return { rx, ry, res: Math.sqrt(s / idx.length), A, B };
}

/** Tur 4k · Robust eksen-hizalı elips uydurması (basık oval + kanca):
    2:1 ovali daireye zorlamak yerine merkez AYKIRILARLA birlikte
    yeniden tahmin edilir (ağırlık merkezi kırpılan örneklerin). Üç
    tur budama; kanca/çıntı tamamen kırpılır. */
function inkShapeSnapRobustEllipse(rs) {
  const n = rs.length;
  if (n < 16) return null;
  let idx = rs.map((_, i) => i);
  let cx = 0, cy = 0, ell = null, A = 0, B = 0;
  for (let round = 0; round < 3; round++) {
    let sx = 0, sy = 0;
    for (const i of idx) { sx += rs[i].x; sy += rs[i].y; }
    cx = sx / idx.length;
    cy = sy / idx.length;
    ell = inkShapeSnapEllipseAxes(rs, idx, cx, cy);
    if (!ell) return null;
    A = ell.A; B = ell.B;
    const es = new Array(n);
    for (let i = 0; i < n; i++) {
      const u = rs[i].x - cx, v = rs[i].y - cy;
      es[i] = Math.abs(Math.sqrt(A * u * u + B * v * v) - 1);
    }
    const sorted = es.slice().sort((x, y) => x - y);
    const med = sorted[Math.floor(sorted.length / 2)];
    const tol = Math.max(0.06, med * 2.5);
    const next = [];
    for (let i = 0; i < n; i++) if (es[i] <= tol) next.push(i);
    if (next.length < 16) return null;
    idx = next;
  }
  let s = 0;
  for (const i of idx) {
    const u = rs[i].x - cx, v = rs[i].y - cy;
    const e = Math.sqrt(A * u * u + B * v * v) - 1;
    s += e * e;
  }
  return {
    cx, cy, rx: ell.rx, ry: ell.ry,
    res: Math.sqrt(s / idx.length), idx,
  };
}

/** Spiral koruması: yarıçap ile yay-uzunluğu arasındaki Pearson
    korelasyonunun büyüklüğü. Monoton içe/dışa sarılımda |corr| → 1. */
function inkShapeSnapRadiusCorr(rs, idx, cx, cy) {
  const m = idx.length;
  if (m < 16) return 0;
  const cum = new Float64Array(m);
  for (let k = 1; k < m; k++) {
    cum[k] = cum[k - 1] + inkShapeSnapDist(rs[idx[k - 1]], rs[idx[k]]);
  }
  let sr = 0, sc = 0;
  const rr = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    rr[k] = inkShapeSnapDist(rs[idx[k]], { x: cx, y: cy });
    sr += rr[k]; sc += cum[k];
  }
  sr /= m; sc /= m;
  let cov = 0, vr = 0, vc = 0;
  for (let k = 0; k < m; k++) {
    cov += (rr[k] - sr) * (cum[k] - sc);
    vr += (rr[k] - sr) * (rr[k] - sr);
    vc += (cum[k] - sc) * (cum[k] - sc);
  }
  if (vr < 1e-12 || vc < 1e-12) return 0;
  return Math.abs(cov / Math.sqrt(vr * vc));
}

/** Tur 4k · birleşik yuvarlak karar (daire ya da eksen-hizalı oval).
    Sıra: 1) düz Kasa daire (çok-turlu karalama kırpılma istemez),
    2) robust daire + inlier elips (kanca kırpılır),
    3) robust elips (basık oval + kanca). Spiral koruması her yolda:
    |sweep| ≥ 2π iken yarıçap-yay korelasyonu yüksekse YOK. */
function inkShapeSnapRoundDecision(rs, sweep) {
  const spiral = Math.abs(sweep) >= Math.PI * 2;
  /* 1) düz (Kasa) daire: örneklerin tamamı daire üzerindeyse en
     doğru merkez bu uydurmadan gelir; çok-turlu karalamalar
     (çift tur) budamaya ihtiyaç duymaz. */
  {
    const f = inkShapeSnapFitCircle(rs);
    if (f) {
      const res = inkShapeSnapCircleResidual(rs, f.cx, f.cy, f.r);
      const drift = inkShapeSnapCircleDrift(rs);
      const corr = spiral
        ? inkShapeSnapRadiusCorr(rs, rs.map((_, i) => i), f.cx, f.cy) : 0;
      if (res <= INK_SNAP_CIRCLE_RES && drift <= INK_SNAP_CIRCLE_DRIFT &&
          corr < INK_SNAP_SPIRAL_CORR) {
        return {
          type: 'circle', cx: f.cx, cy: f.cy, r: f.r,
          a0: Math.atan2(rs[0].y - f.cy, rs[0].x - f.cx),
          dir: sweep >= 0 ? 1 : -1,
        };
      }
    }
  }
  /* 2) robust daire: kanca/çıntı aykırıları kırpılır; elips inlier
     örneklerde denencek (basık oval daire sanılmaz). Kapı TÜM izin
     kalıntısıdır: kırpma bir lobu sığdırıp öbürünü (kalp) görmezden
     gelemez — tam iz robust daireye de sığmalı. */
  const rob = inkShapeSnapRobustCircle(rs);
  if (rob && rob.inlierRatio >= INK_SNAP_INLIER_MIN &&
      inkShapeSnapCircleResidual(rs, rob.cx, rob.cy, rob.r) <=
        INK_SNAP_CIRCLE_RES &&
      !(spiral && inkShapeSnapRadiusCorr(rs, rob.idx, rob.cx, rob.cy) >=
        INK_SNAP_SPIRAL_CORR)) {
    const a0 = Math.atan2(rs[0].y - rob.cy, rs[0].x - rob.cx);
    const dir = sweep >= 0 ? 1 : -1;
    const ell = inkShapeSnapEllipseAxes(rs, rob.idx, rob.cx, rob.cy);
    if (ell) {
      const ratio = Math.max(ell.rx, ell.ry) / Math.min(ell.rx, ell.ry);
      if (ell.res <= INK_SNAP_CIRCLE_RES &&
          Math.abs(sweep) <= Math.PI * 2 * INK_SNAP_ELLIPSE_SWEEP &&
          ratio >= INK_SNAP_ELLIPSE_RATIO &&
          ell.res < rob.res * INK_SNAP_ELLIPSE_BETTER) {
        /* basık oval: OVAL kalır (en-boy korunur), daireye zorlanmaz. */
        return {
          type: 'circle', cx: rob.cx, cy: rob.cy,
          r: Math.max(ell.rx, ell.ry), rx: ell.rx, ry: ell.ry,
          a0, dir, oval: 1,
        };
      }
    }
    if (rob.res <= INK_SNAP_CIRCLE_RES && rob.drift <= INK_SNAP_CIRCLE_DRIFT) {
      return { type: 'circle', cx: rob.cx, cy: rob.cy, r: rob.r, a0, dir };
    }
  }
  /* 3) robust elips: daire hiç uymuyorsa (oval + kanca) eksen-hizalı
     elips budamayla denenir; merkez kırpılan örneklerden yenilenir. */
  return inkShapeSnapRobustOval(rs, sweep);
}

/** Tur 4k · robust elips oval kararı (RoundDecision + tanıyıcı
    birincil yolu ortak kullanır): oran anlamlı, kalıntı tavanı,
    ~tek tur, spiral koruması. */
function inkShapeSnapRobustOval(rs, sweep) {
  const rell = inkShapeSnapRobustEllipse(rs);
  if (!rell) return null;
  const ratio = Math.max(rell.rx, rell.ry) / Math.min(rell.rx, rell.ry);
  const corr = Math.abs(sweep) >= Math.PI * 2
    ? inkShapeSnapRadiusCorr(rs, rell.idx, rell.cx, rell.cy) : 0;
  if (ratio >= INK_SNAP_ELLIPSE_RATIO &&
      rell.res <= INK_SNAP_CIRCLE_RES &&
      Math.abs(sweep) <= Math.PI * 2 * INK_SNAP_ELLIPSE_SWEEP &&
      corr < INK_SNAP_SPIRAL_CORR) {
    return {
      type: 'circle', cx: rell.cx, cy: rell.cy,
      r: Math.max(rell.rx, rell.ry), rx: rell.rx, ry: rell.ry,
      a0: Math.atan2(rs[0].y - rell.cy, rs[0].x - rell.cx),
      dir: sweep >= 0 ? 1 : -1, oval: 1,
    };
  }
  return null;
}

/** Merkezi verilen elips denemesi (kapalı birincil yol: ağırlık merkezi).
    Gates: kalıntı tavanı, oran anlamlı, ~tek tur. */
function inkShapeSnapEllipseFromCenter(rs, cx, cy, sweep) {
  const idx = rs.map((_, i) => i);
  const ell = inkShapeSnapEllipseAxes(rs, idx, cx, cy);
  if (!ell) return null;
  const ratio = Math.max(ell.rx, ell.ry) / Math.min(ell.rx, ell.ry);
  if (!(ell.res <= INK_SNAP_CIRCLE_RES)) return null;
  if (!(Math.abs(sweep) <= Math.PI * 2 * INK_SNAP_ELLIPSE_SWEEP)) return null;
  if (!(ratio >= INK_SNAP_ELLIPSE_RATIO)) return null;
  return {
    type: 'circle', cx, cy,
    r: Math.max(ell.rx, ell.ry), rx: ell.rx, ry: ell.ry,
    a0: Math.atan2(rs[0].y - cy, rs[0].x - cx),
    dir: sweep >= 0 ? 1 : -1, oval: 1,
  };
}

/** Baskın köşe süzgeci: küme enerjisi ≥ max(0.6, maxTurn×0.45). */
function inkShapeSnapDominantCorners(cc, maxTurn) {
  if (!cc || !cc.idx || !cc.idx.length) return [];
  const thr = Math.max(INK_SNAP_DOM_MIN, maxTurn * INK_SNAP_DOM_FRAC);
  return cc.idx.filter(e => e.energy >= thr);
}

/** Pencere dönüşü azami (OpenPoly/ClosedPoly/kanıt ortak kullanır). */
function inkShapeSnapMaxTurnOf(arr) {
  const W = 3;
  let mx = 0;
  for (let i = W; i + W < arr.length; i++) {
    const v1x = arr[i].x - arr[i - W].x, v1y = arr[i].y - arr[i - W].y;
    const v2x = arr[i + W].x - arr[i].x, v2y = arr[i + W].y - arr[i].y;
    const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
    if (m1 < 1e-9 || m2 < 1e-9) continue;
    const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
    const t = Math.acos(dot);
    if (t > mx) mx = t;
  }
  return mx;
}

/** Span denetimi: köşe listesinin tüm span'leri DÜZ sınıflanabiliyor mu? */
function inkShapeSnapSpanCheck(px, py, corners, wrapN) {
  const n = px.length;
  const seq = wrapN
    ? corners.concat([corners[0] + n])
    : [0].concat(corners, [n - 1]);
  for (let s = 0; s + 1 < seq.length; s++) {
    if (seq[s + 1] - seq[s] < 4) continue;
    /* Tur 4k · kapalı adayda SON span (kapanış) sınıf denetiminden
       muaf: kapanış kenarı çokgen kurucusunda köşe kord'undan
       SENTEZLENİR; izin aşırı-sallanma uçları (tepe kubbesi, kapanış
       kancası) bu span'de yaşar ve kord'tan sapması DOĞALDIR.
       Kapanış kanıtı girişteki kapanış-oranı (≤ 0.12) + köşe
       baskınlığıdır. Açık yolda son span normal denetlenir. */
    if (wrapN && s + 2 === seq.length) continue;
    const prof = inkShapeSnapSpanProfile(px, py, seq[s], seq[s + 1], wrapN);
    if (inkShapeSnapSpanClass(prof) !== 'straight') return false;
  }
  return true;
}

/** Eksik köşe ekleme (tek geçiş): düz olmayan span'in iç dönüş zirvesi
    eşiği aşarsa köşe yapılır; her iki yarı da sınıflanabilir kalırsa
    ekleme kalıcıdır (el-karesinin yutulmuş 4. köşesi böyle geri gelir). */
function inkShapeSnapRefineCorners(px, py, corners, wrapN, maxTurn) {
  let list = corners.slice();
  const gate = Math.max(INK_FAIR_CORNER_TURN, maxTurn * 0.5);
  for (let pass = 0; pass < 2; pass++) {
    let inserted = false;
    const next = [];
    const bounds = wrapN
      ? list.concat([list[0] + wrapN])
      : [0].concat(list, [px.length - 1]);
    const seq = wrapN
      ? bounds
      : bounds;
    for (let s = 0; s + 1 < seq.length; s++) {
      const a = seq[s], b = seq[s + 1];
      next.push(a);
      if (b - a < 8) continue;
      const prof = inkShapeSnapSpanProfile(px, py, a, b, wrapN);
      if (inkShapeSnapSpanClass(prof) === 'straight') continue;
      if (prof.peakIdx >= 0 && prof.peakTurn >= gate &&
          prof.peakIdx !== a && prof.peakIdx !== b) {
        // zirveyi ara köşe yap; iki yarı da sınıflanabiliyorsa kabul
        const pA = inkShapeSnapSpanProfile(px, py, a, prof.peakIdx, wrapN);
        const pB = inkShapeSnapSpanProfile(px, py, prof.peakIdx, b, wrapN);
        if (inkShapeSnapSpanClass(pA) !== 'keep' &&
            inkShapeSnapSpanClass(pB) !== 'keep') {
          next.push(prof.peakIdx);
          inserted = true;
        }
      }
    }
    if (!wrapN) next.push(px.length - 1);
    else next.push(next[0] + wrapN); // döngüsel: kapanış
    list = wrapN ? next.slice(0, next.length - 1) : next.slice(1, next.length - 1);
    if (!inserted) break;
  }
  return list;
}

/** Tur 4k · KAPALI çokgen adayı: köşeli kapalı iz (el karesi/üçgeni/
    dikdörtgen/çokgen) kusursuz çokgene dönüşür (kullanıcı onayı).
    ÇİFT kanıt: önce döndürülmüş kopya kümesi (rsr), olmazsa ham iz
    kümesi (rs) — başlangıç körüğü tek kanıtı bölebilir. */
function inkShapeSnapClosedPoly(rsr, ccR, ccU, rs) {
  const p = inkShapeSnapClosedPolyFrom(ccR, rsr) || inkShapeSnapClosedPolyFrom(ccU, rs);
  return p;
}

function inkShapeSnapClosedPolyFrom(cc, arr) {
  if (!cc || !cc.idx || !cc.idx.length || cc.outMedian == null ||
      cc.outMedian >= 0.12) return null;
  const n = arr.length;
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 0; i < n; i++) { px[i] = arr[i].x; py[i] = arr[i].y; }
  const maxTurn = inkShapeSnapMaxTurnOf(arr);
  /* Açgözlü köşe seçimi: baskın köşeler GÜÇ sırasıyla eklenir; tüm
     span'ler düz sınıflanabilen EN KÜÇÜK küme kazanır. Dalga gürültüsü
     küçük enerjili köşeleri dışarıda bırakır (el-karesinin zayıf
     köşeleri RefineCorners ile zirveden geri gelir). */
  const dom = inkShapeSnapDominantCorners(cc, maxTurn)
    .sort((a, b) => b.energy - a.energy);
  if (dom.length < 2 || dom.length > INK_SNAP_POLY_MAX) return null;
  for (let k = 2; k <= dom.length; k++) {
    const sub = dom.slice(0, k).map(e => e.i).sort((a, b) => a - b);
    const ref = inkShapeSnapRefineCorners(px, py, sub, n, maxTurn);
    if (ref.length < INK_SNAP_POLY_MIN || ref.length > INK_SNAP_POLY_MAX) {
      continue;
    }
    /* Tur 4k · değnek adayı reddi: ardışık köşe aralığı (çevrimsel)
       eşik altındaysa bir kenar iğne kadar kısadır (kubbe kink'i +
       gerçek köşe gibi değnek üretir) — aday reddedilir. */
    const minSep = Math.max(3, Math.round(n * 0.07));
    let sepOk = true;
    for (let s = 0; s < ref.length; s++) {
      const gap = s + 1 < ref.length
        ? ref[s + 1] - ref[s]
        : ref[0] + n - ref[s];
      if (gap < minSep) { sepOk = false; break; }
    }
    if (!sepOk) continue;
    /* Tur 4k · kapanış span'i muaf olduğundan eksik baskın köşe
       kapanış aşırı-sallanması ARKASINA saklanamaz: aday tüm baskın
       köşeleri kapsamalı (RefineCorners onları zirveden geri
       getiremezse aday reddedilir). */
    let coversAll = true;
    for (let d = k; d < dom.length; d++) {
      if (ref.indexOf(dom[d].i) < 0) { coversAll = false; break; }
    }
    if (!coversAll) continue;
    if (!inkShapeSnapSpanCheck(px, py, ref, n)) continue;
    const pts = ref.map(i => ({ x: arr[i].x, y: arr[i].y }));
    // bitişik köşeleri birleştir (<4px)
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 4) continue;
      out.push(p);
    }
    if (out.length >= 2) {
      const first = out[0], last = out[out.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < 4) out.pop();
    }
    if (out.length >= INK_SNAP_POLY_MIN) {
      return { type: 'poly', closed: true, pts: out };
    }
  }
  return null;
}

/** Tur 4k · AÇIK çokgen adayı: köşeli açık iz (V/Z/L) — açgözlü köşe
    seçimi: en güçlü köşeden başla, tüm bacaklar düz sınıflanınca dur. */
function inkShapeSnapOpenPoly(rs, maxTurn) {
  const cc = inkShapeSnapCornerClusters(rs);
  /* Tur 4k · köşe-BASKINLIĞI kanıtı (kapalı yoldakiyle aynı): dönüş
     enerjisi AZ sayıda dar kümede toplanmalı (küme-dışı medyan < 0.12).
     2,5-periyot dalga gibi sürekli-eğrili açık izlerde kümeler zirve
     yakalar ama enerji her yere dağılır (outMedian 0.231) — baskınlık
     yoksa iz çokgen DEĞİL, mükemmelleştirmeye düşer. */
  if (!(cc.outMedian != null && cc.outMedian < 0.12)) return null;
  const dom = inkShapeSnapDominantCorners(cc, maxTurn)
    .sort((a, b) => b.energy - a.energy);
  if (!dom.length || dom.length > INK_SNAP_POLY_MAX) return null;
  const n = rs.length;
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 0; i < n; i++) { px[i] = rs[i].x; py[i] = rs[i].y; }
  for (let k = 1; k <= dom.length; k++) {
    const sub = dom.slice(0, k).map(e => e.i).sort((a, b) => a - b);
    const refined = inkShapeSnapRefineCorners(px, py, sub, 0, maxTurn);
    if (refined.length > INK_SNAP_POLY_MAX) continue;
    if (!inkShapeSnapSpanCheck(px, py, refined, 0)) continue;
    const seq = [0].concat(refined, [n - 1]);
    const out = [];
    for (const i of seq) {
      const p = { x: rs[i].x, y: rs[i].y };
      const last = out[out.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 4) continue;
      out.push(p);
    }
    if (out.length >= 2) {
      return { type: 'poly', closed: false, pts: out };
    }
  }
  return null;
}

/**
 * Tanıyıcı girişi: px uzayında (en-boy doğru oranlı) ham noktalar.
 * Çıktı: null (dokunma) ya da sonuç nesnesi:
 *   { type:'line', a, b }
 *   { type:'arc', cx, cy, r, a0, sweep }
 *   { type:'circle', cx, cy, r, a0, dir [, oval:1, rx, ry] }
 *   { type:'poly', closed:bool, pts:[{x,y}…] }
 */
function inkShapeSnapRecognize(raw) {
  let pts = raw.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  /* Tur 4k · bitişik ikiz noktalar düşürülür: kapalı vuruşun dikişi
     (son nokta başlangıcın birebir kopyası) sıfır uzunluklu segment
     üretir; döndürülmüş kanıtta küme enerjisini bozar. */
  const dedup = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (last && inkShapeSnapDist(p, last) < 1e-6) continue;
    dedup.push(p);
  }
  pts = dedup;
  if (pts.length < INK_SNAP_MIN_PTS) return null;
  const rawLen = inkShapeSnapLength(pts);
  if (!(rawLen >= INK_SNAP_MIN_LEN)) return null;

  let rs = inkShapeSnapResample(pts, rawLen / INK_SNAP_N);
  if (rs.length < 8) return null;
  const endD = inkShapeSnapDist(rs[0], rs[rs.length - 1]);
  /* ---- açık şekiller ---- */
  if (endD > rawLen * INK_SNAP_CLOSED_RATIO) {
    const ratio = endD / rawLen;
    if (ratio >= INK_SNAP_LINE_RATIO) {
      return { type: 'line', a: pts[0], b: pts[pts.length - 1] };
    }
    // Yay mı, köşeli açık polyline mı? (L/V/S yaya dönmesin)
    const W = 3;
    let maxTurn = 0;
    for (let i = W; i + W < rs.length; i++) {
      const v1x = rs[i].x - rs[i - W].x, v1y = rs[i].y - rs[i - W].y;
      const v2x = rs[i + W].x - rs[i].x, v2y = rs[i + W].y - rs[i].y;
      const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
      if (m1 < 1e-9 || m2 < 1e-9) continue;
      const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
      const turn = Math.acos(dot); // 0 = düz devam, π = geri dönüş
      if (turn > maxTurn) maxTurn = turn;
    }
    const fit = inkShapeSnapFitCircle(rs);
    if (!fit) return null;
    const fc = { x: fit.cx, y: fit.cy };
    let meanR = 0;
    const radii = rs.map(p => {
      const r = inkShapeSnapDist(p, fc);
      meanR += r;
      return r;
    });
    meanR /= radii.length;
    /* 0.045: fazla tur atan çizimler (çift tur, içe spiral) için
       gevşetildi. meanR/rawLen ≈ 1/(2π·tur); 0.08 yalnız ~2 tura kadar
       izin veriyordu. Karalama/L koruması burada değil, sweep eşiğinde. */
    if (!(meanR > rawLen * 0.045)) return null;
    let vari = 0;
    for (const r of radii) vari += (r - meanR) * (r - meanR);
    const cv = Math.sqrt(vari / radii.length) / meanR;

    // açı taraması (işaretli toplam)
    let sweep = 0;
    let prevAng = Math.atan2(rs[0].y - fit.cy, rs[0].x - fit.cx);
    for (let i = 1; i < rs.length; i++) {
      const ang = Math.atan2(rs[i].y - fit.cy, rs[i].x - fit.cx);
      sweep += inkShapeSnapAngleDelta(ang, prevAng);
      prevAng = ang;
    }
    if (Math.abs(sweep) < INK_SNAP_MIN_SWEEP) return null;

    /* Tur 4k · AÇIK DAL: BOŞLUK kuralı + birleşik yuvarlak karar +
       köşeli açık çokgen (V/Z/L) + bilinçli açık yay (C/D).
       · |sweep| ≥ 280° ve boşluk ≤ 46° → halka: köşe koruması ÖNCE
         (kenar boşluklu kapanmış köşeli şekil da ~2π tarar — Tur 4g
         teşhisi), köşesizse robust daire/elips kararı.
       · Aksi (geniş boşluk ya da küçük tarama): köşeli iz → düzenle-
         nebilir çokgen; köşesiz ve tutarlı eğrilikli → yay. */
    if (Math.abs(sweep) >= INK_SNAP_TURN_CIRCLE &&
        Math.PI * 2 - Math.abs(sweep) <= INK_SNAP_TURN_GAP) {
      const rsrH = inkShapeSnapRotateFlat(rs);
      const ccH = inkShapeSnapCornerClusters(rsrH);
      const domH = ccH.list.length > 0 && ccH.outMedian != null &&
        ccH.outMedian < 0.12;
      if (!(ccH.list.length >= 3 && domH)) {
        /* robust uydurma: kanca/çıntı aykırıları kırpılır; spiral
           koruması çok-turlu içe sarılmayı yuvarlağa dönmez. */
        const round = inkShapeSnapRoundDecision(rs, sweep);
        if (round) return round;
      }
      /* köşeli halka ya da çok-döngülü iz: kapalı sınıflandırmaya düş */
    } else {
      if (maxTurn > INK_SNAP_MAX_TURN) {
        /* köşeli açık iz (V/Z/L) → çokgen adayı; kurulamazsa null
           (mükemmelleştirmeye düşer) — kapalı sınıflandırmaya ASLA
           düşmez (kapalı kanıt açık izde yalan söyler). */
        return inkShapeSnapOpenPoly(rs, maxTurn);
      }
      /* Tur 4k · bilinçli boşluklu halka: tarama ~280°+ ama boşluk
         TURN_GAP üstüyse iz bilinçli AÇIK halkadır (300° halka, C/D
         kıvrımı) — yay kalır, boşluk KORUNUR (daireye kapatmak
         kullanıcının kasıtlı boşluğunu siler). En-boy oranlı tuvalde
         çizilen boşluklu halka düz-ELİPS olur (cv ~0.11); dar ARC_CV
         (0.09) onu döküyordu (B2 teşhisi: 283° tarama, boşluk 77°,
         cv 0.114 → null). Geniş taramada tavan CIRCLE_CV (0.18) —
         spiral (cv 0.3+) hâlâ dışarıda. */
      const cvCap = Math.abs(sweep) >= INK_SNAP_TURN_CIRCLE
        ? INK_SNAP_CIRCLE_CV : INK_SNAP_ARC_CV;
      if (cv > cvCap) return null;
      return {
        type: 'arc',
        cx: fit.cx, cy: fit.cy, r: meanR,
        a0: Math.atan2(rs[0].y - fit.cy, rs[0].x - fit.cx),
        sweep,
      };
    }
  }

  /* Tur 4g · kapalı sınıflandırma: rs ham tutulur (daire çıktıları ve
     açısal ölçümler döndürmeden etkilenmesin); köşe kanıtı için
     döndürülmüş kopya (rsr) alınır. Küme taraması ilk/son W örneğini
     atlar; başlangıç bir köşeye denk gelirse o köşe hiç kümelemez
     (teşhis: köşeden başlayan dikdörtgende yalnız 2 küme). "En düz"
     örnekten (kenar ortası) başlatmak bunu giderir; kanıt ÇİFT
     KANITTIR (rsr + rs) — tek döndürme bölmeleri oynatabilir. */
  const rsr = inkShapeSnapRotateFlat(rs);

  /* ---- kapalı şekiller ----
     Önce köşelilik: gerçek köşeler dar pencerede tek noktada toplanır;
     daire eğriliği tüm noktalara dağılır. Keskin köşeli şekiller
     (üçgen/kare/dikdörtgen/çokgen) asla daire sanılmaz. */
  // toplam işaretli dönüş (başlık açıları üzerinden): halka sinyali.
  // Tek turlu el çizimi ~2π, çok turlu (spiral/geçmeli) daha fazla;
  // üçgen/kare de ~2π'dir — o yüzden köşelilik kontrolü ÖNCE gelir.
  let turnSum = 0;
  {
    let prevHead = Math.atan2(rs[1].y - rs[0].y, rs[1].x - rs[0].x);
    for (let i = 2; i < rs.length; i++) {
      const head = Math.atan2(rs[i].y - rs[i - 1].y, rs[i].x - rs[i - 1].x);
      turnSum += inkShapeSnapAngleDelta(head, prevHead);
      prevHead = head;
    }
  }

  /* Tur 4c/4g · köşe bölgesi kümeleri: yuvarlatılmış köşelerde RDP
     eps'i köşeyi yutabilir (el-karesi); dönüş enerjisi kümeleri köşeyi
     yakalar. ≥2 küme = gerçek köşeli şekil → daire/halka kararı KAPANIR
     (her şekil yuvarlağa dönüşüyordu — kare/çokgen koruması).
     Çift kanıt: rsr (başlangıç körüğü giderilmiş) + rs. */
  const ccR = inkShapeSnapCornerClusters(rsr);
  const ccU = inkShapeSnapCornerClusters(rs);
  /* Tur 4k · köşe kanıtı BASKIN küme sayısıyla: enerjisi
     max(0.6, maxTurn×0.45) üstü ≥2 küme (her iki kanıttan biri yeter)
     + küme-dışı medyan dönüş düşükse iz köşelidir. Dalga gürültüsü
     küçük enerjili kümeler baskın sayılmaz (dalgalı halka → daire
     yolu açık kalır); kanca birleşimi tek baskın küme üretir
     (oval+kanca → köşeli DEĞİL → elips yolu açık). */
  const maxTurnR = inkShapeSnapMaxTurnOf(rsr);
  const maxTurnU = inkShapeSnapMaxTurnOf(rs);
  const domR = ccR.outMedian != null && ccR.outMedian < 0.12;
  const domU = ccU.outMedian != null && ccU.outMedian < 0.12;
  const cornered = (domR &&
    inkShapeSnapDominantCorners(ccR, maxTurnR).length >= 2) ||
    (domU && inkShapeSnapDominantCorners(ccU, maxTurnU).length >= 2);

  /* Tur 4k · köşeli kapalı şekil (üçgen/kare/dikdörtgen/çokgen)
     kusursuz ÇOKGENE dönüşür (kullanıcı onayı: "bekletilen her şey
     düzelsin"). Kurulamazsa (karalama/yetersiz kanıt) null → bekletme
     mükemmelleştirmesi. */
  if (cornered) {
    const poly = inkShapeSnapClosedPoly(rsr, ccR, ccU, rs);
    if (poly) return poly;
    /* Çokgen kurulamadı: kanıt KAVŞAK niteliğindeyse (≤2 baskın köşe —
       kanca/çıntı birleşimi) yuvarlak karara dön; ≥3 gerçek köşede
       null — mükemmelleştirmeye düşer (karalama koruması). */
    const domCnt = Math.max(
      domR ? inkShapeSnapDominantCorners(ccR, maxTurnR).length : 0,
      domU ? inkShapeSnapDominantCorners(ccU, maxTurnU).length : 0);
    if (domCnt >= 3) return null;
  }

  // yumuşak kapalı şekil: daire (yarıçap varyasyonu + açısal kapsam;
  // açık "C" biçimli çizimler daire olmasın)
  let sumX = 0, sumY = 0;
  for (const p of rs) { sumX += p.x; sumY += p.y; }
  const cen = { x: sumX / rs.length, y: sumY / rs.length };
  let meanR = 0;
  const radii = rs.map(p => {
    const r = inkShapeSnapDist(p, cen);
    meanR += r;
    return r;
  });
  meanR /= radii.length;
  if (meanR > rawLen * 0.10) {
    let vari = 0;
    for (const r of radii) vari += (r - meanR) * (r - meanR);
    const cv = Math.sqrt(vari / radii.length) / meanR;
    /* Tur 4k · ÖNCE elips: basık oval (2:1) OVAL KALIR — ağırlık
       merkezli eksen uydurması geçerliyse daireye zorlanmaz. Merkez
       kanca/çıntıyla çekilmişse robust elips (budamalı) devreye girer. */
    const ell = inkShapeSnapEllipseFromCenter(rs, cen.x, cen.y, turnSum) ||
      inkShapeSnapRobustOval(rs, turnSum);
    if (ell) return ell;
    /* Tur 4c: köşe BASKIN ≥2 küme varsa bu bir daire DEĞİL (kare/çokgen)
       — CV eşiği el-karesini yutuyordu. Gürültü kümeleri (baskın değil)
       daire kararını kapatmaz. */
    if (cv < INK_SNAP_CIRCLE_CV) {
      const angs = radii.map((_, i) =>
        Math.atan2(rs[i].y - cen.y, rs[i].x - cen.x)).sort((a, b) => a - b);
      let maxGap = Math.PI * 2 - angs[angs.length - 1] + angs[0];
      for (let i = 1; i < angs.length; i++) {
        const gap = angs[i] - angs[i - 1];
        if (gap > maxGap) maxGap = gap;
      }
      if (maxGap < INK_SNAP_MAX_GAP) {
        return {
          type: 'circle', cx: cen.x, cy: cen.y, r: meanR,
          a0: Math.atan2(rs[0].y - cen.y, rs[0].x - cen.x),
          dir: turnSum >= 0 ? 1 : -1,
        };
      }
    }
  }

  /* Tur 4k · Halka yedeği: CV/açısal-kapsam testlerini geçemeyen ama
     TOPLAM DÖNÜŞÜ halkayı gösteren el çizimleri — kanca girişli
     başlangıç, geçmeli tur, çift tur. Birleşik yuvarlak karar:
     robust (aykırı-kırpışlı) daire/elips uydurması + spiral koruması.
     cornered zaten yukarıda çokgene döndü; bu satıra yalnız köşesiz
     izler ulaşır. */
  if (Math.abs(turnSum) >= INK_SNAP_TURN_CIRCLE) {
    const round = inkShapeSnapRoundDecision(rs, turnSum);
    if (round) return round;
  }
  return null;
}

/** Sonucu yerel 0..1 vuruş noktalarına çevirir (sx/sy = px ölçeği). */
function inkShapeSnapBuildPoints(res, sx, sy, pressure) {
  const push = (x, y, out) => out.push({ x: x / sx, y: y / sy, p: pressure });
  const out = [];
  if (res.type === 'line') {
    push(res.a.x, res.a.y, out);
    push(res.b.x, res.b.y, out);
    return out;
  }
  if (res.type === 'arc') {
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const ang = res.a0 + res.sweep * (i / steps);
      push(res.cx + Math.cos(ang) * res.r, res.cy + Math.sin(ang) * res.r, out);
    }
    return out;
  }
  if (res.type === 'circle') {
    const steps = 64;
    /* Serbest-el damga yolu (snapFree) AÇIK poliline çizer: stroke.closed
       damga zincirinde hiçbir yerde kullanılmıyor → son segment
       (başlangıca dönüş) çizilmiyor, daire başında boşluk kalıyordu.
       Kapanış noktasını açıkça yaz: son nokta == ilk nokta. */
    if (res.oval) {
      /* Tur 4k · basık oval: eksen-hizalı elips — en-boy korunur. */
      for (let i = 0; i <= steps; i++) {
        const ang = res.a0 + res.dir * Math.PI * 2 * (i / steps);
        push(res.cx + Math.cos(ang) * res.rx, res.cy + Math.sin(ang) * res.ry, out);
      }
    } else {
      for (let i = 0; i <= steps; i++) {
        const ang = res.a0 + res.dir * Math.PI * 2 * (i / steps);
        push(res.cx + Math.cos(ang) * res.r, res.cy + Math.sin(ang) * res.r, out);
      }
    }
    return out;
  }
  if (res.type === 'poly') {
    /* Tur 4k · köşeli izin geometrisi: köşe noktaları birebir. Kapalı
       çokgende kapanış noktası açıkça yazılır (damga zinciri boşluk-
       suz dönsün). */
    for (const q of res.pts) push(q.x, q.y, out);
    if (res.closed) {
      const first = out[0], last = out[out.length - 1];
      if (Math.abs(first.x - last.x) > 1e-9 ||
          Math.abs(first.y - last.y) > 1e-9) {
        push(res.pts[0].x, res.pts[0].y, out);
      }
    }
    return out;
  }
  return null;
}

/* =========================================================
   Tur 4j · MÜKEMMELLEŞTİRME çekirdeği (smooth-on-null)
   Hiçbir şekle benzemeyen iz bekletilince (kalem basılı) yerinde
   kusursuzlaştırılır: 36-ink-editor ve 30-ink-tools portları bu
   işlevi çağırır (aynı çekirdek → parite).

   Yöntem:
     1. px uzayında yay-uzunluğu yeniden örnekleme (adım = medyan
        segment, [1.2,4] px) — konum lineer, sayısal alanlar yay
        oranıyla, eğim açısı kısa-yay lerp ile.
     2. Keskin köşeler pencere-dönüşüyle bulunur (±%2 pencere,
        ≥0.72 rad; kümele → kümenin en-dönüşlü örneği çapa; çapalar
        arası min boşluk). Köşeler ±1 komşusuyla RİJİT blok:
        köşe açısı bit-birebir korunur (Z asla S olmaz). Uçlar da
        rijit. Köşe sayısı 14'ü aşarsa iz KARALAMA sayılır: köşesiz
        + hafif akıtma (karakter korunur).
     3. Taubin λ/μ çift geçişi: λ geçişi alçak geçirir, μ geçişi
        şişirir — toplam küçülme nötrü; el titremesi ve mikro
        dalga agresif söner, tepe/çukur/döngü/spiral yapısı yerinde
        kalır (ısı akıtmasının kapalı eğrileri büzme hatası yok).
        Pürüzlülük (ikinci-fark ortalaması, rijit bölgeler ölüm
        dışı) hedefe max(0.05px, rough0×oran) inene dek sürer.
     3b. Yakın-düz span düzleştirme (yalnız AÇIK iz): köşeler
        arasında kalan ve kendi akorduna ≤ max(2.5px, span×%2)
        sapan serbest bölümler akord üzerine dizilir — zikzak/L/Z
        bacakları kusursuz düz olur. Kapalı izde YOK (el üçgeni/
        karesi asla mükemmel çokgene dönüştürülmez — kullanıcının
        sözleşmesi: bu şekiller tanınıp düzeltilmez). Eğri span
        (sapma toleransı aşkın) olduğu gibi kalır.
     4. Güvenlik: örneklerin toplam yer-değiştirmesi yol×%2'yi
        (max 6px) aşarsa sonuç orijinale doğru ölçeklenir.
   ========================================================= */

/** Tek Taubin geçişi (Jacobi): q[i] = p[i] + c/2·(p[i−1]+p[i+1]−2p[i]).
    Rijit örnekler hiç değişmez (p'den kopyalanır). c<0 → μ şişirme. */
function inkFairPass(px, py, qx, qy, n, c, rigid) {
  const h = c * 0.5;
  qx[0] = px[0]; qy[0] = py[0];
  qx[n] = px[n]; qy[n] = py[n];
  for (let i = 1; i < n; i++) {
    if (rigid[i]) { qx[i] = px[i]; qy[i] = py[i]; continue; }
    qx[i] = px[i] + h * (px[i - 1] + px[i + 1] - 2 * px[i]);
    qy[i] = py[i] + h * (py[i - 1] + py[i + 1] - 2 * py[i]);
  }
}

/** Pürüzlülük: ikinci-fark büyüklük ortalaması; penceresi rijit bir
    örneğe değen indisler ölçüm dışı (köşe/uç katkısı sayılmaz). */
function inkFairRoughness(x, y, n, rigid) {
  let s = 0, cnt = 0;
  for (let i = 1; i < n; i++) {
    if (rigid[i] || rigid[i - 1] || rigid[i + 1]) continue;
    const dx = x[i + 1] - 2 * x[i] + x[i - 1];
    const dy = y[i + 1] - 2 * y[i] + y[i - 1];
    s += Math.hypot(dx, dy);
    cnt++;
  }
  return cnt ? s / cnt : 0;
}

/**
 * Serbest izi mükemmelleştirir (saf; girdi dizisine dokunmaz).
 *
 * Girdi: `pts` yerel vuruş noktaları ({x,y,p,...}; br bayraklı kopuk
 * iz ONARILIR), `sx`/`sy` yerel→px ölçekleri (bağlı katmanda item
 * en/boy'u, genel katmanda 1). Dönüş: aynı uzayda YENİ nokta dizisi
 * ya da null (dokunma/değmez). Uç noktalar GİRİŞTEKİ orijinal
 * nesnelerle bit-birebir döner → çizim zinciri sürekliliği korunur.
 *
 * Tur 4k · kopukluk (br) onarımı: parçalar arası boşluk
 * max(24px, yol×%6) eşiğinin altındaysa iz TEK BÜTÜN gibi köprülenip
 * düzeltilir (kırılma raporu: bekletmede kopuk iz onarılmıyordu).
 * Eşiği aşan kopmada parçalar AYRI düzeltilir; uç nesneleri ve
 * br bayrakları birebir korunur (parça kısa ise olduğu gibi kalır).
 */
function inkShapeSnapFairPath(pts, sx, sy) {
  if (!Array.isArray(pts) || pts.length < INK_FAIR_MIN_PTS) return null;
  const sX = Number.isFinite(sx) && sx > 0 ? sx : 1;
  const sY = Number.isFinite(sy) && sy > 0 ? sy : 1;
  for (const q of pts) {
    if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;
  }
  const hasBr = pts.some(q => q.br);
  if (!hasBr) return inkShapeSnapFairCore(pts, sX, sY);
  const runs = [];
  let cur = [];
  for (const q of pts) {
    if (q.br && cur.length) { runs.push(cur); cur = []; }
    cur.push(q);
  }
  if (cur.length) runs.push(cur);
  if (runs.length === 1) return inkShapeSnapFairCore(pts, sX, sY);
  let total = 0;
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      total += Math.hypot((run[i].x - run[i - 1].x) * sX,
        (run[i].y - run[i - 1].y) * sY);
    }
  }
  const healCap = Math.max(INK_SNAP_HEAL_GAP_MIN,
    total * INK_SNAP_HEAL_GAP_RATIO);
  let heal = true;
  for (let k = 0; k + 1 < runs.length; k++) {
    const a = runs[k][runs[k].length - 1];
    const b = runs[k + 1][0];
    if (Math.hypot((b.x - a.x) * sX, (b.y - a.y) * sY) > healCap) {
      heal = false;
      break;
    }
  }
  if (heal) {
    /* Köprü: br bayrağısız sanal iz — TEK BÜTÜN düzeltilir; köprü
       bölgesi damga zincirinde sürekli kalır (onarımın amacı bu). */
    const flat = [];
    for (const run of runs) {
      for (const q of run) {
        const c = { x: q.x, y: q.y };
        for (const key of Object.keys(q)) {
          if (key === 'x' || key === 'y' || key === 'br') continue;
          c[key] = q[key];
        }
        flat.push(c);
      }
    }
    return inkShapeSnapFairCore(flat, sX, sY);
  }
  /* Büyük kopma: parçalar ayrı; kısa/eğilemeyen parça olduğu gibi. */
  const out = [];
  let changed = false;
  for (const run of runs) {
    if (run.length >= INK_FAIR_MIN_PTS) {
      const f = inkShapeSnapFairCore(run, sX, sY);
      if (f) { for (const q of f) out.push(q); changed = true; continue; }
    }
    for (const q of run) out.push(q);
  }
  return changed ? out : null;
}

function inkShapeSnapFairCore(pts, sX, sY) {
  /* Yeniden örneklenecek sayısal alanlar (x/y konum, a eğim açısı —
     özel işlem; p basınç, s ... alan-oranıyla taşınır). */
  const fields = [];
  for (const key of Object.keys(pts[0])) {
    if (key === 'x' || key === 'y' || key === 'a') continue;
    if (typeof pts[0][key] === 'number' && Number.isFinite(pts[0][key])) fields.push(key);
  }
  const hasTilt = Number.isFinite(pts[0].a);
  const arcLerpAngle = (a0, a1, f) => {
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a0 + d * f;
  };

  /* --- 1) yay-uzunluğu yeniden örnekleme (px uzayı) --- */
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(
      (pts[i].x - pts[i - 1].x) * sX, (pts[i].y - pts[i - 1].y) * sY);
  }
  const total = cum[pts.length - 1];
  if (!(total >= INK_FAIR_MIN_LEN)) return null;
  const lens = [];
  for (let i = 1; i < pts.length; i++) lens.push(cum[i] - cum[i - 1]);
  lens.sort((a, b) => a - b);
  const mid = lens.length >> 1;
  const med = (lens.length & 1) ? lens[mid] : (lens[mid - 1] + lens[mid]) / 2;
  let step = clamp(med, INK_FAIR_STEP_LO, INK_FAIR_STEP_HI);
  let n = Math.max(2, Math.round(total / step));
  if (n > INK_FAIR_MAX_N) { n = INK_FAIR_MAX_N; step = total / n; }
  const N = n + 1;
  let X = new Float64Array(N), Y = new Float64Array(N);
  const OX = new Float64Array(N), OY = new Float64Array(N); // orijinal kopya
  const FS = fields.map(() => new Float64Array(N));
  const FA = hasTilt ? new Float64Array(N) : null;
  let seg = 0;
  for (let k = 0; k < N; k++) {
    const t = total * k / n;
    while (seg < pts.length - 2 && cum[seg + 1] < t) seg += 1;
    const a = pts[seg], b = pts[seg + 1];
    const segLen = cum[seg + 1] - cum[seg];
    const f = segLen > 1e-12 ? clamp((t - cum[seg]) / segLen, 0, 1) : 0;
    const x = (a.x + (b.x - a.x) * f) * sX;
    const y = (a.y + (b.y - a.y) * f) * sY;
    X[k] = OX[k] = x;
    Y[k] = OY[k] = y;
    for (let fi = 0; fi < fields.length; fi++) {
      const key = fields[fi];
      const av = Number.isFinite(a[key]) ? a[key] : 0;
      const bv = Number.isFinite(b[key]) ? b[key] : av;
      FS[fi][k] = av + (bv - av) * f;
    }
    if (FA) {
      FA[k] = arcLerpAngle(Number.isFinite(a.a) ? a.a : 0,
        Number.isFinite(b.a) ? b.a : 0, f);
    }
  }

  /* --- 2) köşe tespiti (pencere dönüşü) --- */
  const W = Math.max(2, Math.round(N * INK_FAIR_WIN));
  const turns = new Float64Array(N);
  const marks = [];
  for (let i = W; i + W < N; i++) {
    const v1x = X[i] - X[i - W], v1y = Y[i] - Y[i - W];
    const v2x = X[i + W] - X[i], v2y = Y[i + W] - Y[i];
    const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
    if (m1 < 1e-9 || m2 < 1e-9) continue;
    const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
    const turn = Math.acos(dot); // 0 = düz devam, π = geri dönüş
    turns[i] = turn;
    if (turn >= INK_FAIR_CORNER_TURN) marks.push(i);
  }
  /* Kümeleme: aralık ≤ W olan ardışık işaretler tek köşe; çapa =
     kümenin en-dönüşlü örneği. Çapalar arası SPACING'ten yakın iki
     köşe tek köşeye çöker (güçlü kanıt kalır) — mikro kıvrım ikilisi
     rijit çift üretmesin. */
  const SPACING = Math.max(W * 2 + 2, 10);
  const anchors = [];
  {
    let i = 0;
    while (i < marks.length) {
      let j = i;
      let best = marks[i], bestT = turns[marks[i]];
      while (j + 1 < marks.length && marks[j + 1] - marks[j] <= W) {
        j++;
        if (turns[marks[j]] > bestT) { bestT = turns[marks[j]]; best = marks[j]; }
      }
      const prev = anchors.length ? anchors[anchors.length - 1] : -Infinity;
      if (best - prev >= SPACING) anchors.push(best);
      else if (bestT > turns[prev]) anchors[anchors.length - 1] = best;
      i = j + 1;
    }
  }
  const soft = anchors.length > INK_FAIR_MAX_CORNERS; // karalama: köşesiz
  const rigid = new Uint8Array(N);
  rigid[0] = 1;
  rigid[n] = 1;
  if (!soft) {
    for (const c of anchors) {
      rigid[c] = 1;
      if (c > 0) rigid[c - 1] = 1;
      if (c < n) rigid[c + 1] = 1;
    }
  }

  /* --- 3) Taubin λ/μ akıtma --- */
  const lam = INK_FAIR_LAMBDA;
  const mu = soft ? INK_FAIR_MU_SOFT : INK_FAIR_MU;
  const pairsCap = soft ? INK_FAIR_SOFT_PAIRS : INK_FAIR_PAIRS;
  const pairsMin = soft ? INK_FAIR_SOFT_MIN : INK_FAIR_PAIRS_MIN;
  const rough0 = inkFairRoughness(X, Y, n, rigid);
  if (rough0 <= INK_FAIR_ROUGH_MIN) return null; // çoktan kusursuz
  const target = Math.max(INK_FAIR_ROUGH_MIN,
    rough0 * (soft ? INK_FAIR_SOFT_RATIO : INK_FAIR_ROUGH_RATIO));
  let BX = new Float64Array(N), BY = new Float64Array(N);
  let rough = rough0;
  let pairs = 0;
  while (pairs < pairsCap && (pairs < pairsMin || rough > target)) {
    const prev = rough;
    inkFairPass(X, Y, BX, BY, n, lam, rigid);
    let t = X; X = BX; BX = t;
    t = Y; Y = BY; BY = t;
    inkFairPass(X, Y, BX, BY, n, -mu, rigid);
    t = X; X = BX; BX = t;
    t = Y; Y = BY; BY = t;
    pairs++;
    rough = inkFairRoughness(X, Y, n, rigid);
    /* Zeminde dur: hedefe inilemiyorsa (rijit köşe geçiş katkısı +
       gerçek eğrilik zemini) azalma çift başına %0.15'in altına
       düşünce kes — tekrarlı bekletmede iz sürüklenmesin. */
    if (pairs >= 6 && rough > prev * 0.9985) break;
  }

  /* --- 3b) span uydurma (Tur 4k fair v2: AÇIK ve KAPALI iz) ---
     Rijit köşe blokları arasında kalan serbest span'ler yapısal
     sınıflarına göre oturtulur: dalgalı-düz span AKORD ÜZERİNE
     (zikzak/L/V bacakları düzelir), tutarlı eğrilikli span pinli
     uçlu YAYA (C/D kıvrımları yuvarlaklaşır), kararsız span Taubin
     hâliyle kalır. Kapalı izde de çalışır (köşeli iz çokgene
     dönüştürülememişse kenarlar yine düzelir — "bekletilen her şey
     düzelsin" sözleşmesi). Yer-değiştirme tavanı span başına. */
  const TX = Float64Array.from(X), TY = Float64Array.from(Y); // Taubin yedeği
  let anyFit = false;
  {
    let a = 0;
    while (a + 1 < N && rigid[a + 1]) a++;
    for (let i = a + 1; i < N; i++) {
      if (!rigid[i]) continue;
      let j = i;
      while (j + 1 < N && rigid[j + 1]) j++;
      /* Serbest span: iki rijit blok ARASINDAKİ örnekler (a+1..i-1);
         akord ucu blokların ilk rijit örneklerine (a → i) sabitlenir.
         Akordu bloğun sonuna (j) taşımak köşeyi bir örnek aşıp
         sonraki bacağı döndürür — zikzak kuyruğunda bant sarkması
         (Tur 4k teşhisi). */
      if (i - a >= 4) {
        const prof = inkShapeSnapSpanProfile(X, Y, a, i, 0);
        const cls = inkShapeSnapSpanClass(prof);
        if (cls === 'arc') {
          /* Pinli uçlu yay: yer-değiştirme Taubin sonrası duruma göre
             ölçülür (Taubin kayması zaten kabul edilmişti). */
          if (inkShapeSnapSpanArcApply(X, Y, TX, TY, a, i)) anyFit = true;
        } else if (cls === 'straight' && anchors.length) {
          /* Tur 4k · çapa yokken yapıyı koru: köşe çapası bulunamayan
             izde tüm iz TEK serbest span'dır; akorda çekmek 2,5-periyot
             dalgayı düz çizgiye indirir (dev 62 item px, curv oranı
             0) ve Taubin kaymasıyla birleşip maxDev > 10 yapar.
             Çapasız iz yalnız Taubin'le kibar yumuşatılır (4j davranışı);
             çapalı span'ler (gerçek bacaklar) akord tavanıyla düzelir. */
          const ax = X[a], ay = Y[a];
          const dx = X[i] - ax, dy = Y[i] - ay;
          const L = Math.hypot(dx, dy);
          if (L > 1e-9) {
            let dev = 0;
            for (let k = a + 1; k < i; k++) {
              const d = Math.abs((Y[k] - ay) * dx - (X[k] - ax) * dy) / L;
              if (d > dev) dev = d;
            }
            if (dev > 0.5) { // zaten düzse dokunma (no-op koruması)
              const cap = Math.max(INK_FAIR_DISP_MAX, L * INK_FAIR_SPAN_DISP);
              let maxD = 0;
              for (let k = a + 1; k < i; k++) {
                const t = (k - a) / (i - a);
                const qx = ax + dx * t, qy = ay + dy * t;
                const d = Math.hypot(qx - X[k], qy - Y[k]);
                if (d > maxD) maxD = d;
              }
              const sc = maxD > cap ? cap / maxD : 1;
              for (let k = a + 1; k < i; k++) {
                const t = (k - a) / (i - a);
                X[k] += (ax + dx * t - X[k]) * sc;
                Y[k] += (ay + dy * t - Y[k]) * sc;
              }
              anyFit = true;
            }
          }
        }
      }
      a = j;
    }
  }

  /* --- 4) yer-değiştirme güvenliği: yapı asla kaymasın ---
     Span uydurma yapıldıysa her span kendi tavanıyla sınırlıdır;
     genel tavan yalnız saf Taubin sonucuna uygulanır. */
  if (!anyFit) {
    const cap = clamp(total * INK_FAIR_DISP_RATIO, INK_FAIR_DISP_MIN, INK_FAIR_DISP_MAX);
    let maxD = 0;
    for (let k = 1; k < n; k++) {
      const d = Math.hypot(X[k] - OX[k], Y[k] - OY[k]);
      if (d > maxD) maxD = d;
    }
    if (maxD > cap) {
      const s = cap / maxD;
      for (let k = 1; k < n; k++) {
        X[k] = OX[k] + (X[k] - OX[k]) * s;
        Y[k] = OY[k] + (Y[k] - OY[k]) * s;
      }
    }
  }

  /* --- 5) yerel uzaya geri; uçlar orijinal nesneler --- */
  const out = new Array(N);
  for (let k = 1; k < n; k++) {
    const q = { x: X[k] / sX, y: Y[k] / sY };
    for (let fi = 0; fi < fields.length; fi++) q[fields[fi]] = FS[fi][k];
    if (FA) q.a = FA[k];
    out[k] = q;
  }
  out[0] = pts[0];
  out[n] = pts[pts.length - 1];
  return out;
}

/**
 * Vuruşu yerinde `kind:'shape'` vuruşuna çevirir. `sx`/`sy`: yerel
 * 0..1 uzayını px uzayına taşıyan ölçekler (bağlı katmanda görsel
 * en/boy'u; genel katmanda 1). Dönüşüm yoksa false döner, vuruşa
 * dokunulmaz.
 */
function inkShapeSnapConvertStroke(stroke, sx, sy) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < INK_SNAP_MIN_PTS) {
    return false;
  }
  if (!stroke.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
  const raw = stroke.points.map(q => ({ x: q.x * sx, y: q.y * sy }));
  const res = inkShapeSnapRecognize(raw);
  if (!res) return false;
  /* Kalınlık: vuruş boyunca GÖRÜLEN kalınlığı koru. İlk örnek basıncı
     kalemin değme anına ait olur ve çoğu zaman hafiftir — tüm şekil
     tek ilke basınçla yazılırsa kıl inceliğinde çıkar. Medyan basınç
     vuruşun baskın kalınlığını taşır. */
  const ps = stroke.points.map(q => Number(q.p)).filter(Number.isFinite).sort((a, b) => a - b);
  const pressure = ps.length ? ps[Math.floor(ps.length / 2)] : 1;
  const newPts = inkShapeSnapBuildPoints(res, sx, sy, pressure);
  if (!newPts || newPts.length < 2) return false;
  /* KAPSAMA KORUMASI (Tur 3): tanıyıcı kısmi izde yanılabiliyor
     (ör. yarım çemberi ark diye okuyup kapanışı uydurmak). Dönüşüm
     ham izin HER noktasını kapsamıyorsa geri çevir — yarım oturtma,
     commit'te ham izin silinen kısmında boşluk bırakıyor. Tolerans:
     fırça görsel yarı-genişliğinin dokuda karşılığı (stroke.size
     normalize; sx/sy ile doku-px'e döner). */
  /* Kapsama toleransı: fırça yarı-genişliği ya da iz uzunluğunun %15'i
     (hangisi büyükse). Hafif elips daireler (genel-olmayan en/boy) en
     kötü ~%10 sapma üretir → geçer; yarım tanınan iz (kalan kısım
     silinecek) %30+ sapar → reddedilir. */
  const covTol = Math.max(2, (Number(stroke.size) || 0) * Math.max(sx, sy) * 0.6,
    0.15 * inkShapeSnapLength(raw));
  /* Kapsama px uzayında: newPts normalize (0..1) döner, ham iz ölçekli. */
  const covPts = newPts.map(p => ({ x: p.x * sx, y: p.y * sy }));
  for (let j = 0; j < raw.length; j++) {
    const q = raw[j];
    let best = Infinity;
    for (let i = 1; i < covPts.length; i++) {
      const d = inkShapeSnapSegDist(q, covPts[i - 1], covPts[i]);
      if (d < best) best = d;
      if (best <= covTol) break;
    }
    if (best > covTol) return false;
  }
  stroke.kind = 'shape';
  stroke.shape =
    res.type === 'line' ? 'line' :
    res.type === 'arc' ? 'arc' :
    res.type === 'circle' ? 'circle' : 'poly';
  /* Tur 4k · closed bayrağı şekil türüne göre: daire/elips kapalı;
     çokgen adayın kendi kanıtına bakar (açık V/Z/L → kapalı DEĞİL). */
  stroke.closed = res.type === 'circle' ||
    (res.type === 'poly' && !!res.closed);
  stroke.points = newPts;
  /* Serbest elle oturtma işareti: bu vuruşlar düz yol yerine NORMAL
     fırça damgalarıyla yazılır (28-ink-brush dispatch). Böylece fırça
     dokusu/akışı korunur ve kalınlık fırça boyutuna eşit olur —
     şekil aracının ince kontur yolu (0.22×) buraya sızmaz. */
  stroke.snapFree = 1;
  return true;
}

/** Bekleme zamanlayıcısı: hareket çapayı aşarsa yeniden kurulur. */
function inkShapeSnapHoldCreate(fire) {
  const hold = {
    timer: null,
    anchor: null,
    trail: [],
    arm(x, y) {
      hold.disarm();
      hold.anchor = { x, y };
      hold.trail.length = 0;
      hold.trail.push({ x, y, t: performance.now() });
      hold.timer = setTimeout(hold.fireCheck, INK_SNAP_HOLD_MS);
    },
    /* Tur 4f v5 · oyalanma (crawl) koruması — canlı ölçümle kalibre.
       (v4 prod+net koşulu canlı probe'da hiç çalışmadı: sürünme
       net(640ms) 2.77-2.96px ölçüldü, 4px eşiğin altında → her
       fireCheck ateşliyordu; erken ateşlemeler vuruş kısa olduğundan
       zararsızdı, vuruş 28 item px'i aşınca çizim ortasında 'line'a
       dönüşüyordu.) Üç hıza-bağımsız sinyal:
       · yaş — son iz girişi taze mi? Sürünmede ~24ms, 60-70ms mikro
         duraksamada ~85-95ms: quiet'in altında → kalem aktif →
         ateşleme YOK. Duraksama quiet'i aşarsa (duruş, GC
         durgunlaşması dahil) ateşle. DURUŞ ALGILAYICISI BU.
       · düznlük — net/yol: titreme salınımı ~0.04-0.16 (net ≈ 0),
         sürünme ~0.5-0.85. Oran düşük = yerinde salınım → ateşle.
       · net tabanı — adım/yürüyüş gürültüsü net'i sinyalle
         çarpıştırınca (ölçüm: 1.89-3.48) oran düşüyor; wnet ≥ 1.7
         "yine de belirgin ilerliyor" → koru. Titreme net'i 0.39 →
         ateşler.
       Skip: iz silinmeden 220ms sonra yeniden dene. Hızlı çizimde
       fireCheck hiç çalışmaz (hareket > 8px → arm() sürekli yeniler). */
    fireCheck() {
      hold.timer = null;
      const now = performance.now();
      const win = hold.trail.filter(s => now - s.t <= INK_SNAP_HOLD_MS + 90);
      const last = hold.trail.length ? hold.trail[hold.trail.length - 1] : null;
      const age = last ? now - last.t : Infinity;
      let wpath = 0;
      for (let i = 1; i < win.length; i++) {
        wpath += Math.hypot(win[i].x - win[i - 1].x, win[i].y - win[i - 1].y);
      }
      const wnet = win.length >= 2 ? Math.hypot(
        win[win.length - 1].x - win[0].x,
        win[win.length - 1].y - win[0].y) : 0;
      /* yol yoksa (dönüşsüz duruş) düznlük anlamsız → durmuş say */
      const ratio = wpath > 0.5 ? wnet / wpath : 0;
      if (age < INK_SNAP_HOLD_QUIET_MS &&
          (ratio >= INK_SNAP_HOLD_RATIO || wnet >= INK_SNAP_HOLD_NET_PX)) {
        hold.anchor = { x: last.x, y: last.y };
        hold.timer = setTimeout(hold.fireCheck, INK_SNAP_HOLD_RESKED_MS);
        return;
      }
      fire();
    },
    track(x, y) {
      const now = performance.now();
      hold.trail.push({ x, y, t: now });
      /* izi zamana göre budayınca yüksek olay frekanslı kalemlerde de
         medium penceresi (350ms) dolu kalır; üst sınır yine de var. */
      while (hold.trail.length && now - hold.trail[0].t > INK_SNAP_HOLD_MS + 90) {
        hold.trail.shift();
      }
      if (hold.trail.length > 512) hold.trail.shift();
      if (!hold.timer || !hold.anchor) { hold.arm(x, y); return; }
      if (Math.hypot(x - hold.anchor.x, y - hold.anchor.y) > INK_SNAP_HOLD_MOVE_PX) {
        hold.arm(x, y);
      }
    },
    disarm() {
      if (hold.timer) { clearTimeout(hold.timer); hold.timer = null; }
      hold.anchor = null;
    },
  };
  return hold;
}
