/* =========================================================
   inkcore - çekirdek piksel matematiği
   =========================================================
   JS kaynağı: src/renderer/core/52-native-brush-library.js
   Port ilkesi: inkNativeNoise Math.imul tabanlı 32-bit tamsayı
   hash'tir; C++ tarafında uint32_t çarpma + xorshift ile bit
   bitine eşleşir. Diğer üreticiler double matematik kullanır;
   V8 ile MSVC CRT arasında ±1 ULP sınıfında küçük fark kalabilir.
   Parite sondası bu yüzden kanal başına 1/255 payı ile ölçer:
   ImageData düzeyinde büyük çoğunluk bit eşit, kalanlar tek birim.

   Çıktı sözleşmesi: RGBA, önceden çarpılmamış (ImageData semantiği),
   satır-bazlı, tek bitişik bellek bloğu.
   ========================================================= */

#include <cstdint>
#include <cmath>
#include <cstring>
#include <limits>
#include <vector>
#include <algorithm>

namespace inkcore {

/* --- deterministik gürültü (JS kaynağına birebir) ---
   JS:  n = imul(x,374761393) ^ imul(y,668265263) ^ imul(seed,2246822519)
        n = imul(n ^ (n >>> 13), 1274126177)
        dönüş ((n ^ (n >>> 16)) >>> 0) / 4294967295
   imul = 32-bit sarmalı çarpma; C++'ta uint32_t ortamda a*b zaten
   sarmalıdır, sonuç eşleşir. */
inline double inkNativeNoise(int32_t x, int32_t y, int32_t seed) {
    uint32_t n =
        static_cast<uint32_t>(x) * 374761393u ^
        static_cast<uint32_t>(y) * 668265263u ^
        static_cast<uint32_t>(seed) * 2246822519u;
    n = (n ^ (n >> 13)) * 1274126177u;
    return static_cast<double>(n ^ (n >> 16)) / 4294967295.0;
}

inline double clampf(double v, double lo, double hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

inline double smoothf(double v) {
    const double t = clampf(v, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

/* JS `ifade | 0` kesmesi sıfıra doğru keser;
   double -> int32 dönüşümünde C++ cast'i de aynı davranır. */
inline int32_t jsTruncToInt32(double v) {
    return static_cast<int32_t>(v);
}

/* --- gürültü uç üreticisi (createNoiseTip port) ---
   JS sürümü fillRect ile beyaz kareler basar; burada aynı alfa
   formülü doğrudan RGBA ImageData'ya yazılır (255,255,255,alfa).
   step 1 veya 2 (JS: px > 320 iken 2). Blok kenarı px'i aşarsa
   kırpılır. Dönüş: boyanan piksel sayısı (bilgi amaçlı). */
inline uint64_t noiseTipRgba(
    int px, double density, double edge, int32_t seed, int step,
    uint8_t* out)
{
    const double r = px * 0.5 * edge;
    const double cx = px / 2.0, cy = px / 2.0;
    uint64_t painted = 0;
    for (int y = 0; y < px; y += step) {
        for (int x = 0; x < px; x += step) {
            const double dx = x + step / 2.0 - cx;
            const double dy = y + step / 2.0 - cy;
            const double d = std::hypot(dx, dy);
            if (d > r) continue;
            const double n = inkNativeNoise(x, y, 31 + seed);
            if (n > density) continue;
            const double feather = clampf(
                (r - d) / std::fmax(1.0, px * 0.09), 0.0, 1.0);
            const double alpha =
                (0.25 + 0.75 * inkNativeNoise(y, x, 73 + seed)) * feather;
            if (alpha <= 0.01) continue;
            /* JS fillRect 'rgba(...)' yazarken alpha.toFixed(3) uygular;
               3 ondalık kuantalama 0..255 skalasında en fazla 1 birim
               kayma yaratır - parite sondası bu payı gözler. */
            const double aFixed = std::round(alpha * 1000.0) / 1000.0;
            const double aR = std::floor(
                clampf(aFixed, 0.0, 1.0) * 255.0 + 0.5);
            const uint8_t a = static_cast<uint8_t>(aR);
            for (int by = 0; by < step && y + by < px; ++by) {
                uint8_t* rowOut = out + static_cast<size_t>(y + by) * px * 4;
                for (int bx = 0; bx < step && x + bx < px; ++bx) {
                    uint8_t* p = rowOut + static_cast<size_t>(x + bx) * 4;
                    p[0] = 255; p[1] = 255; p[2] = 255; p[3] = a;
                    ++painted;
                }
            }
        }
    }
    return painted;
}

/* --- sulu boya uç üreticisi (createWatercolorTip port) ---
   JS sürümü zaten ImageData'yı doğrudan yazar, yani bit-parite
   adayıdır. Fazlar double; sin/atan2'de 1 ULP'lik fark olası - sonda
   1/255 tolerans raporu dışında bir şey gerekmez. */
inline uint64_t watercolorTipRgba(
    int px, double core, double ring, double edge, int32_t seed,
    uint8_t* out)
{
    const double phaseA = seed * 0.71;
    const double phaseB = seed * 1.31 + 0.9;
    const double phaseC = seed * 2.17;
    const double radius = std::fmax(1.0, px / 2.0 - 1);
    uint64_t marked = 0;
    for (int y = 0; y < px; ++y) {
        for (int x = 0; x < px; ++x) {
            const double dx = (x + 0.5 - px / 2.0) / radius;
            const double dy = (y + 0.5 - px / 2.0) / radius;
            const double angle = std::atan2(dy, dx);
            const double roughness =
                0.025 * std::sin(angle * 4.0 + 0.7 + phaseA) +
                0.016 * std::sin(angle * 9.0 - 1.3 + phaseB) +
                0.01 * (inkNativeNoise(
                    jsTruncToInt32(x / 5.0), jsTruncToInt32(y / 5.0),
                    53 + (seed % 97)) - 0.5);
            const double boundary = 0.95 + roughness;
            const double distance = std::hypot(dx, dy) / boundary;
            double alpha = 0.0;
            if (distance < 1.0) {
                const double wash = core *
                    (0.62 + 0.7 * smoothf(distance / 0.9));
                const double pigmentRim = edge *
                    smoothf((distance - ring) / std::fmax(0.02, 0.92 - ring)) *
                    (1.0 - smoothf((distance - 0.92) / 0.08));
                /* JS: inkNativeNoise((x>>2)+phaseC, (y>>2)+phaseC, 97)
                   -> toplama önce yapılır, |0 kesmesi SONRA gelir. */
                const double gx = static_cast<double>(x >> 2) + phaseC;
                const double gy = static_cast<double>(y >> 2) + phaseC;
                const double grain = 0.86 + 0.14 * inkNativeNoise(
                    jsTruncToInt32(gx), jsTruncToInt32(gy), 97);
                alpha = std::fmax(wash, pigmentRim) * grain;
            }
            uint8_t* p = out + (static_cast<size_t>(y) * px + x) * 4;
            /* JS Math.round(alpha*255) - yarıyı yukarı yuvarlar. */
            const double aR = std::floor(
                clampf(alpha, 0.0, 1.0) * 255.0 + 0.5);
            p[0] = 255; p[1] = 255; p[2] = 255;
            p[3] = static_cast<uint8_t>(aR);
            if (aR > 0.5) ++marked;
        }
    }
    return marked;
}

/* =========================================================
    EVRE 2 - damla aritmetigi (inkForEachDab + inkCatmull portu)
    ---------------------------------------------------------
    JS kaynagi: src/renderer/core/28-ink-brush.js (K16/K17/K18).
    Nokta tamponu stride 7: [x, y, p, s, t, a, br] (p/s/t/a yoksa
    NaN, br yoksa 0 arac tarafindan yazilir; JS'teki |undefined|
    semantigi boylece korunur).
    Cikis tamponu stride 9: [x, y, k, p, s, t, a, br, tilted].
    Pas-gec dablarda (ilk/kirik/son) p/s/t/a ham kaynak degeri
    olarak kalir (JS Object.assign({}, nokta) ayni davranis).

    Float parite: V8 Math.hypot/std::exp ile MSVC CRT arasinda
    +-1 ULP sinifinda fark mumkundur - parite sondasi 1e-9
    mutlak pay ile olcer. Boya yuvarlamasi etkisi tek kanal
    asterinin cok altindadir.
   ========================================================= */

/* JS: hash = 2166136261; hash = imul(hash ^ charCodeAt(i), 16777619)
   charCodeAt UTF-16 kod birimi dondurur - N-API utf16 dizesiyle
   bit bitine eslenir. */
inline uint32_t fnv1aHashUtf16(const uint16_t* s, size_t len) {
    uint32_t hash = 2166136261u;
    for (size_t i = 0; i < len; ++i) {
        hash = (hash ^ static_cast<uint32_t>(s[i])) * 16777619u;
    }
    return hash;
}

/* JS: inkStrokeRandom(stroke, dabIndex, channel) - uc asamali imul
   karistirici; tam tamsayi matemligi, bit-parite adayi. */
inline double strokeRandom(uint32_t idHash, int32_t dabIndex, int32_t channel) {
    uint32_t hash = idHash;
    hash ^= static_cast<uint32_t>(dabIndex + 1) * 0x9e3779b1u;
    hash ^= static_cast<uint32_t>(channel + 1) * 0x85ebca6bu;
    hash ^= hash >> 16;
    hash *= 0x7feb352du;
    hash ^= hash >> 15;
    hash *= 0x846ca68bu;
    hash ^= hash >> 16;
    return static_cast<double>(hash) / 4294967296.0;
}

inline double sigmoid01(double t) {
    const double LO = 1.0 / (1.0 + std::exp(3.0));
    const double SPAN = 1.0 / (1.0 + std::exp(-3.0)) - LO;
    return (1.0 / (1.0 + std::exp(-6.0 * (t - 0.5))) - LO) / SPAN;
}

/* JS: [-PI, PI] araliginda en kisa yol harmani. */
inline double lerpAngle(double a, double b, double t) {
    double d = b - a;
    const double PI = 3.14159265358979323846;
    while (d > PI) d -= PI * 2.0;
    while (d < -PI) d += PI * 2.0;
    return a + d * t;
}

/* K17 - sentripetal Catmull-Rom. */
inline void catmullKernel(
    const double* pts, int stride,
    int i0, int i1, int i2, int i3,
    double t, double sx, double sy,
    double* outX, double* outY)
{
    const double gx = (std::isfinite(sx) && sx > 0.0) ? sx : 1.0;
    const double gy = (std::isfinite(sy) && sy > 0.0) ? sy : 1.0;
    const double* A = pts + static_cast<size_t>(i0) * stride;
    const double* B = pts + static_cast<size_t>(i1) * stride;
    const double* C = pts + static_cast<size_t>(i2) * stride;
    const double* D = pts + static_cast<size_t>(i3) * stride;
    const double d01 = std::fmax(1e-6, std::hypot(
        (B[0] - A[0]) * gx, (B[1] - A[1]) * gy));
    const double d12 = std::fmax(1e-6, std::hypot(
        (C[0] - B[0]) * gx, (C[1] - B[1]) * gy));
    const double d23 = std::fmax(1e-6, std::hypot(
        (D[0] - C[0]) * gx, (D[1] - C[1]) * gy));
    const double w1 = d12 / ((d01 + d12) * 3.0);
    const double w2 = d12 / ((d12 + d23) * 3.0);
    const double tx = (1.0 - t) * (1.0 - t) * (1.0 - t);
    const double ty = 3.0 * (1.0 - t) * (1.0 - t) * t;
    const double tz = 3.0 * (1.0 - t) * t * t;
    const double tw = t * t * t;
    const double x1 = B[0], y1 = B[1], x2 = C[0], y2 = C[1];
    *outX = x1 * tx + (x1 + (x2 - A[0]) * w1) * ty +
            (x2 - (D[0] - x1) * w2) * tz + x2 * tw;
    *outY = y1 * tx + (y1 + (y2 - A[1]) * w1) * ty +
            (y2 - (D[1] - y1) * w2) * tz + y2 * tw;
}

struct DabKernelInput {
    const double* pts;   /* stride 7: x,y,p,s,t,a,br */
    int32_t nPoints;
    double spacingPx;
    double sx, sy;
    int stableOnly;
    double spacingJitter;
    double taperStartPx, taperEndPx, progressOffsetPx;
    int hasTotalLength;  /* JS Number.isFinite(options.totalLengthPx) */
    double totalLengthPxOpt;
    uint32_t idHash;     /* strokeId FNV hash (fnv1aHashUtf16) */
};

/* Donus: yazilan damla sayisi. out stride 9. */
inline int64_t dabListKernel(const DabKernelInput& in, double* out,
                             int64_t outCap)
{
    const int stride = 7;
    const double* pts = in.pts;
    const int n = in.nPoints;
    if (!pts || n <= 0) return 0;
    const double spacing = std::fmax(0.6,
        (in.spacingPx != 0.0 && std::isfinite(in.spacingPx))
            ? in.spacingPx : 1.0);
    /* --- dokulme basta: kumulatif yay uzunlugu (olcekkli uzay) --- */
    std::vector<double> cumulative(static_cast<size_t>(n), 0.0);
    double totalLengthPx = 0.0;
    for (int i = 1; i < n; ++i) {
        const double* cur = pts + static_cast<size_t>(i) * stride;
        const double* prev = pts + static_cast<size_t>(i - 1) * stride;
        if (cur[6] == 0.0) {
            totalLengthPx += std::hypot(
                (cur[0] - prev[0]) * in.sx, (cur[1] - prev[1]) * in.sy);
        }
        cumulative[i] = totalLengthPx;
    }
    if (in.hasTotalLength) {
        totalLengthPx = std::fmax(totalLengthPx, in.totalLengthPxOpt);
    }
    /* K16.d - tap muafiyeti: bastan >=1px segment gorulunce kes. */
    bool tapLike = true;
    for (int i = 1; i < n; ++i) {
        const double* cur = pts + static_cast<size_t>(i) * stride;
        if (cur[6] == 0.0 &&
            cumulative[i] - cumulative[i - 1] >= 1.0) {
            tapLike = false;
            break;
        }
    }
    const double tStartPx = tapLike ? 0.0 : in.taperStartPx;
    const double tEndPx = (in.stableOnly || tapLike) ? 0.0 : in.taperEndPx;
    auto taper = [&](double progressPx) {
        double factor = 1.0;
        if (tStartPx > 0.0) {
            const double t = std::fmax(0.0, std::fmin(1.0,
                (in.progressOffsetPx + progressPx) / tStartPx));
            factor = std::fmin(factor, t * t * (3.0 - 2.0 * t));
        }
        if (tEndPx > 0.0) {
            const double t = std::fmax(0.0, std::fmin(1.0,
                (totalLengthPx - in.progressOffsetPx - progressPx) /
                    tEndPx));
            factor = std::fmin(factor, t * t * (3.0 - 2.0 * t));
        }
        return factor;
    };
    int64_t written = 0;
    double lastX = 0.0, lastY = 0.0;
    auto emit = [&](double x, double y, double k, double p, double s,
                    double t, double a, double br, double tilted) {
        lastX = x; lastY = y;
        if (out && written < outCap) {
            double* r = out + written * 9;
            r[0] = x; r[1] = y; r[2] = k; r[3] = p;
            r[4] = s; r[5] = t; r[6] = a; r[7] = br; r[8] = tilted;
        }
        ++written;
    };
    auto emitPassthrough = [&](int i, double k) {
        const double* pt = pts + static_cast<size_t>(i) * stride;
        emit(pt[0], pt[1], k, pt[2], pt[3], pt[4], pt[5], pt[6], 0.0);
    };
    /* --- ilk surekli nokta --- */
    if (pts[6] == 0.0) {
        emitPassthrough(0, taper(0.0));
    }
    int index = 1;
    if (n == 1) return written;
    const int segmentLimit = in.stableOnly
        ? std::max(0, n - 2) : n - 1;
    double spacingRemainder = spacing;
    for (int i = 0; i < segmentLimit; ++i) {
        const int p1i = i, p2i = i + 1;
        const double* P2 = pts + static_cast<size_t>(p2i) * stride;
        if (P2[6] != 0.0) {
            emitPassthrough(p2i, taper(cumulative[i + 1]));
            spacingRemainder = spacing;
            continue;
        }
        const int p0i = (pts[static_cast<size_t>(p1i) * stride + 6] != 0.0)
            ? p1i : std::max(0, i - 1);
        const int p3i = (i + 2 < n &&
            pts[static_cast<size_t>(i + 2) * stride + 6] == 0.0)
            ? i + 2 : p2i;
        const double* P1 = pts + static_cast<size_t>(p1i) * stride;
        const double dist = std::hypot(
            (P2[0] - P1[0]) * in.sx, (P2[1] - P1[1]) * in.sy);
        if (dist <= 0.0) continue;
        const double pa = std::isfinite(P1[2]) ? P1[2] : 1.0;
        const double pb = std::isfinite(P2[2]) ? P2[2] : 1.0;
        const double sa = std::isfinite(P1[3]) ? P1[3] : 0.0;
        const double sb = std::isfinite(P2[3]) ? P2[3] : 0.0;
        const double ta = (P1[4] != 0.0 && std::isfinite(P1[4]))
            ? P1[4] : 0.0;
        const double tb = (P2[4] != 0.0 && std::isfinite(P2[4]))
            ? P2[4] : 0.0;
        const bool tilted = ta > 0.0 || tb > 0.0;
        double traveled = spacingRemainder;
        while (traveled <= dist) {
            double t = traveled / dist;
            if (in.spacingJitter > 0.0) {
                t = std::fmax(0.001, std::fmin(0.999,
                    t + (strokeRandom(in.idHash, index, 6) - 0.5) *
                        in.spacingJitter * spacing / dist));
            }
            double qx, qy;
            catmullKernel(pts, stride, p0i, p1i, p2i, p3i, t,
                          in.sx, in.sy, &qx, &qy);
            const double qk = taper(cumulative[i] + dist * t);
            const double qp = pa + (pb - pa) * sigmoid01(t);
            const double qs = sa + (sb - sa) * t;
            /* JS'te eğimsiz damlada q.t/q.a YOK (undefined); kayıt
               dilinde "yok" = NaN (JS Object.assign gibisi poz). */
            double qt = std::numeric_limits<double>::quiet_NaN();
            double qa = std::numeric_limits<double>::quiet_NaN();
            if (tilted) {
                qt = ta + (tb - ta) * t;
                const double a1 = (P1[5] != 0.0 && std::isfinite(P1[5]))
                    ? P1[5] : 0.0;
                const double a2 = (P2[5] != 0.0 && std::isfinite(P2[5]))
                    ? P2[5] : 0.0;
                qa = lerpAngle(a1, a2, t);
            }
            emit(qx, qy, qk, qp, qs, qt, qa, 0.0, tilted ? 1.0 : 0.0);
            ++index;
            traveled += spacing;
        }
        spacingRemainder = traveled - dist;
    }
    /* --- kuyruk: tam vurusta bitis noktasinin damlasi garanti;
       stableOnly (artimli onizleme) kuyruk eklemez --- */
    const int lastI = n - 1;
    const double* LP = pts + static_cast<size_t>(lastI) * stride;
    if (!in.stableOnly && LP[6] == 0.0) {
        const double dx = (LP[0] - lastX) * in.sx;
        const double dy = (LP[1] - lastY) * in.sy;
        if (std::hypot(dx, dy) > 0.001) {
            emitPassthrough(lastI, taper(totalLengthPx));
        }
    }
    return written;
}

/* =========================================================
    EVRE 4 - undo karo dilimleri (inkUndoRegionTileSlices portu)
    ---------------------------------------------------------
    JS kaynagi: src/renderer/core/34-ink-undo.js
    (FAZ 4-5: bolge TEK getImageData ile alinmis; karo dilimleri
    bu anlik goruntuden satir satir kesilir. Asagidaki port o
    kesme isleminin ta kendisi: saf byte banti, hicbir boyama
    mantigindan bagimsiz.)

    Giris:
      src  : bolge RGBA tamponu, satir adimi srcW*4 bayt.
      slices: Int32 stride 4 [relX, relY, w, h]; relX/relY =
              karo kutusunun bolgeye gore konumu (JS'te
              s.x - rect.x olarak onceden hesaplanir).
    Cikis: dilim sira usulunde BITISIK tampon; karo basina
    w*h*4 bayt, satir-bazli. Donus: yazilan toplam bayt;
    out==nullptr ise yalniz sayim (2-gecis dabList kalibi).

    Dogrulama: dilim bolgeyi tasarsa ya da bozulduysa -1 —
    JS cagrisi eski senkron donguya duser (yedek anlik goruntu
    yedegi her durumda kayitlidir; yukis degismez).
    ========================================================= */
struct TileSliceKernelInput {
    const uint8_t* src;    /* satir adimi srcW*4 */
    int32_t srcW, srcH;
    const int32_t* slices; /* stride 4: relX, relY, w, h */
    int32_t nSlices;
};

inline int64_t tileSliceKernel(const TileSliceKernelInput& in,
                               uint8_t* out, int64_t outCap)
{
    if (!in.src || !in.slices ||
        in.srcW <= 0 || in.srcH <= 0 || in.nSlices <= 0) return 0;
    const int64_t srcStride =
        static_cast<int64_t>(in.srcW) * 4;
    /* 1. gecis: dogrulama + toplam bayt */
    int64_t total = 0;
    for (int32_t i = 0; i < in.nSlices; ++i) {
        const int32_t* s = in.slices + static_cast<size_t>(i) * 4;
        const int64_t rx = s[0], ry = s[1], w = s[2], h = s[3];
        if (w <= 0 || h <= 0) return -1;
        if (rx < 0 || ry < 0 ||
            rx + w > in.srcW || ry + h > in.srcH) return -1;
        total += w * h * 4;
    }
    if (!out || outCap <= 0) return total;
    if (total > outCap) return -1;
    /* 2. gecis: satir banti memcpy'e iner — JS subarray/set
       dongusunun aynen eslenigi (satir sira + bayt sira). */
    int64_t cursor = 0;
    for (int32_t i = 0; i < in.nSlices; ++i) {
        const int32_t* s = in.slices + static_cast<size_t>(i) * 4;
        const int rx = s[0], ry = s[1], w = s[2], h = s[3];
        const size_t rowBytes = static_cast<size_t>(w) * 4;
        for (int row = 0; row < h; ++row) {
            const size_t from =
                static_cast<size_t>(ry + row) *
                    static_cast<size_t>(srcStride) +
                static_cast<size_t>(rx) * 4;
            std::memcpy(out + cursor, in.src + from, rowBytes);
            cursor += static_cast<int64_t>(rowBytes);
        }
    }
    return cursor;
}

} // namespace inkcore
