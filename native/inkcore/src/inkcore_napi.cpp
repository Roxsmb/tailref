/* =========================================================
   inkcore - N-API saricisi
   =========================================================
   Ana surec (Electron main) icinde yuklenir; renderer'a IPC
   uzerinden acilir. Disa cikilan islevler:
     - noise32(x, y, seed)                       -> number
     - noiseTip(px, density, edge, seed, step)   -> { data, stat }
     - watercolorTip(px, core, ring, edge, seed) -> { data, stat }
   data: Uint8ClampedArray (px*px*4, RGBA, carpilmamis).
   Bellek paylasimi yok: motor sonucu yeni dizide acikca dondurur. */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
/* NODE_API_MODULE bu header setinde yok (Node 26/Electron 45:
   symbol-tabanlı kayıda geçildi). NAPI_MODULE (node_api.h'ta
   tanimli) napi_register_module_v1 sembolunu uretir - yeterli. */
#include <node_api.h>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include "./inkcore_kernel.hpp"

namespace {

/* --- yardimci: sayi argumani oku --- */
bool ReadNumber(napi_env env, napi_value v, double* out) {
    napi_valuetype t = napi_undefined;
    if (napi_typeof(env, v, &t) != napi_ok) return false;
    if (t != napi_number) return false;
    return napi_get_value_double(env, v, out) == napi_ok;
}

napi_value ThrowMsg(napi_env env, const char* msg) {
    napi_throw_error(env, nullptr, msg);
    return nullptr;
}

/* --- SONUC: piksel dizisini yeni ArrayBuffer'a kopyalar ---
   data: Uint8ClampedArray; stat istatistik sayisi. */
napi_value MakeResult(
    napi_env env, const std::string& fnName, const uint8_t* bytes,
    size_t byteCount, int64_t stat)
{
    void* buffer = nullptr;
    napi_value ab;
    if (napi_create_arraybuffer(env, byteCount, &buffer, &ab) != napi_ok ||
        !buffer) {
        return ThrowMsg(env, "inkcore: bellek atanamadi");
    }
    std::memcpy(buffer, bytes, byteCount);
    napi_value data;
    if (napi_create_typedarray(
            env, napi_uint8_clamped_array, byteCount, ab, 0,
            &data) != napi_ok) {
        return ThrowMsg(env, "inkcore: dizi sarilamadi");
    }
    napi_value obj, fn, st;
    napi_create_object(env, &obj);
    napi_create_string_utf8(env, fnName.c_str(), fnName.size(), &fn);
    napi_set_named_property(env, obj, "fn", fn);
    napi_set_named_property(env, obj, "data", data);
    napi_create_int64(env, stat, &st);
    napi_set_named_property(env, obj, "stat", st);
    return obj;
}

/* --- noise32(x, y, seed) -> number (parite capraz yoklemesi) --- */
napi_value Noise32(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value args[3];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 3) return ThrowMsg(env, "noise32: 3 sayi gerekli");
    double x, y, seed;
    if (!ReadNumber(env, args[0], &x) || !ReadNumber(env, args[1], &y) ||
        !ReadNumber(env, args[2], &seed)) {
        return ThrowMsg(env, "noise32: sayi olmayan arguman");
    }
    const uint32_t mixed =
        static_cast<uint32_t>(x) * 374761393u ^
        static_cast<uint32_t>(y) * 668265263u ^
        static_cast<uint32_t>(seed) * 2246822519u;
    uint32_t n = (mixed ^ (mixed >> 13)) * 1274126177u;
    n ^= n >> 16;
    napi_value out;
    napi_create_uint32(env, n, &out);
    return out;
}

/* --- noiseTip(px, density, edge, seed, step) --- */
napi_value NoiseTip(napi_env env, napi_callback_info info) {
    size_t argc = 5;
    napi_value args[5];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 5) return ThrowMsg(env, "noiseTip: 5 arguman gerekli");
    double px, density, edge, seed, step;
    if (!ReadNumber(env, args[0], &px) || !ReadNumber(env, args[1], &density) ||
        !ReadNumber(env, args[2], &edge) || !ReadNumber(env, args[3], &seed) ||
        !ReadNumber(env, args[4], &step)) {
        return ThrowMsg(env, "noiseTip: sayi olmayan arguman");
    }
    const int size = static_cast<int>(px);
    if (size <= 0 || size > 2048) {
        return ThrowMsg(env, "noiseTip: boyut aralik disi");
    }
    std::vector<uint8_t> held(
        static_cast<size_t>(size) * size * 4, 0);
    const int64_t painted = static_cast<int64_t>(inkcore::noiseTipRgba(
        size, density, edge, static_cast<int32_t>(seed),
        static_cast<int>(step), held.data()));
    return MakeResult(env, "noiseTip", held.data(), held.size(), painted);
}

/* --- watercolorTip(px, core, ring, edge, seed) --- */
napi_value WatercolorTip(napi_env env, napi_callback_info info) {
    size_t argc = 5;
    napi_value args[5];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 5) return ThrowMsg(env, "watercolorTip: 5 arguman gerekli");
    double px, core, ring, edge, seed;
    if (!ReadNumber(env, args[0], &px) || !ReadNumber(env, args[1], &core) ||
        !ReadNumber(env, args[2], &ring) || !ReadNumber(env, args[3], &edge) ||
        !ReadNumber(env, args[4], &seed)) {
        return ThrowMsg(env, "watercolorTip: sayi olmayan arguman");
    }
    const int size = static_cast<int>(px);
    if (size <= 0 || size > 2048) {
        return ThrowMsg(env, "watercolorTip: boyut aralik disi");
    }
    std::vector<uint8_t> held(
        static_cast<size_t>(size) * size * 4, 0);
    const int64_t marked = static_cast<int64_t>(inkcore::watercolorTipRgba(
        size, core, ring, edge, static_cast<int32_t>(seed), held.data()));
    return MakeResult(env, "watercolorTip", held.data(), held.size(), marked);
}

/* --- EVRE 2 - dabList(pointsFlat, spacingPx, sx, sy, stableOnly,
       spacingJitter, taperStartPx, taperEndPx, progressOffsetPx,
       totalLengthPx, strokeId)
   pointsFlat: Float64Array, stride 7 (x,y,p,s,t,a,br).
   totalLengthPx: NaN gecilirse JS Number.isFinite=false yolu.
   Donus: { fn, data: Float64Array (stride 9, x,y,k,p,s,t,a,br,tilted),
            count } --- */
napi_value DabList(napi_env env, napi_callback_info info) {
    size_t argc = 11;
    napi_value args[11];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 11) return ThrowMsg(env, "dabList: 11 arguman gerekli");

    double nums[9];
    for (int i = 1; i <= 9; ++i) {
        if (!ReadNumber(env, args[i], &nums[i - 1])) {
            return ThrowMsg(env, "dabList: sayi olmayan arguman");
        }
    }
    napi_valuetype st = napi_undefined;
    if (napi_typeof(env, args[10], &st) != napi_ok || st != napi_string) {
        return ThrowMsg(env, "dabList: strokeId dizesi gerekli");
    }
    size_t idLen16 = 0;
    napi_get_value_string_utf16(env, args[10], nullptr, 0, &idLen16);
    std::vector<char16_t> idBuf(idLen16 + 1, 0);
    napi_get_value_string_utf16(env, args[10],
        reinterpret_cast<char16_t*>(idBuf.data()), idBuf.size(), &idLen16);
    const uint32_t idHash = inkcore::fnv1aHashUtf16(
        reinterpret_cast<const uint16_t*>(idBuf.data()), idLen16);

    /* nokta tamponu: Float64Array bekler */
    napi_typedarray_type pType = napi_int8_array;
    void* pData = nullptr;
    size_t pLen = 0;
    bool isTyped = false;
    if (napi_get_typedarray_info(env, args[0], &pType, &pLen, &pData,
                                 nullptr, nullptr) == napi_ok &&
        pType == napi_float64_array) {
        isTyped = true;
    }
    if (!isTyped) {
        return ThrowMsg(env, "dabList: points Float64Array olmak zorunda");
    }
    const double* pts = static_cast<const double*>(pData);
    const size_t stride = 7;
    if (pLen < stride) {
        return ThrowMsg(env, "dabList: nokta tamponu kisa");
    }
    const int32_t nPoints = static_cast<int32_t>(pLen / stride);
    if (nPoints <= 0) {
        return ThrowMsg(env, "dabList: nokta yok");
    }

    inkcore::DabKernelInput in{};
    in.pts = pts;
    in.nPoints = nPoints;
    in.spacingPx = nums[0];
    in.sx = nums[1];
    in.sy = nums[2];
    in.stableOnly = nums[3] != 0.0;
    in.spacingJitter = nums[4];
    in.taperStartPx = nums[5];
    in.taperEndPx = nums[6];
    in.progressOffsetPx = nums[7];
    in.hasTotalLength = std::isfinite(nums[8]) ? 1 : 0;
    in.totalLengthPxOpt = nums[8];
    in.idHash = idHash;

    /* 1. gecis: sayi; 2. gecis: yaz */
    const int64_t count = inkcore::dabListKernel(in, nullptr, 0);
    std::vector<double> held(static_cast<size_t>(count) * 9, 0.0);
    if (count > 0) {
        inkcore::dabListKernel(in, held.data(),
                               static_cast<int64_t>(held.size()));
    }
    void* buffer = nullptr;
    napi_value ab;
    const size_t byteCount = held.size() * sizeof(double);
    if (napi_create_arraybuffer(env, byteCount, &buffer, &ab) != napi_ok ||
        !buffer) {
        return ThrowMsg(env, "dabList: bellek atanamadi");
    }
    std::memcpy(buffer, held.data(), byteCount);
    napi_value data;
    if (napi_create_typedarray(
            env, napi_float64_array, held.size(), ab, 0, &data) != napi_ok) {
        return ThrowMsg(env, "dabList: dizi sarilamadi");
    }
    napi_value obj, fn, cnt;
    napi_create_object(env, &obj);
    napi_create_string_utf8(env, "dabList", 7, &fn);
    napi_set_named_property(env, obj, "fn", fn);
    napi_set_named_property(env, obj, "data", data);
    napi_create_int64(env, count, &cnt);
    napi_set_named_property(env, obj, "count", cnt);
    return obj;
}

/* --- EVRE 4 - tileSlice(src, srcW, srcH, slicesFlat)
   src: Uint8ClampedArray (bolge RGBA, satir adimi srcW*4).
   slicesFlat: Int32Array, stride 4 [relX, relY, w, h] —
   karo kutularinin bolgeye gore konumu (s.x - rect.x).
   Donus: { fn, data: Uint8Array (dilim sira usulunde bitisik,
   karo basina w*h*4 bayt), count: toplam bayt } --- */
napi_value TileSlice(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value args[4];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 4) return ThrowMsg(env, "tileSlice: 4 arguman gerekli");

    double nums[2];
    for (int i = 1; i <= 2; ++i) {
        if (!ReadNumber(env, args[i], &nums[i - 1])) {
            return ThrowMsg(env, "tileSlice: sayi olmayan arguman");
        }
    }
    const int32_t srcW = static_cast<int32_t>(nums[0]);
    const int32_t srcH = static_cast<int32_t>(nums[1]);
    if (srcW <= 0 || srcH <= 0 ||
        srcW > 8192 || srcH > 8192) {
        return ThrowMsg(env, "tileSlice: bolge boyutu aralik disi");
    }

    /* bolge tamponu: Uint8ClampedArray bekler */
    napi_typedarray_type sType = napi_int8_array;
    void* sData = nullptr;
    size_t sLen = 0;
    if (napi_get_typedarray_info(env, args[0], &sType, &sLen,
                                 &sData, nullptr, nullptr) != napi_ok ||
        sType != napi_uint8_clamped_array) {
        return ThrowMsg(env, "tileSlice: src Uint8ClampedArray olmak zorunda");
    }
    if (static_cast<int64_t>(sLen) <
        static_cast<int64_t>(srcW) * srcH * 4) {
        return ThrowMsg(env, "tileSlice: bolge tamponu kisa");
    }

    /* dilim listesi: Int32Array bekler */
    napi_typedarray_type iType = napi_int8_array;
    void* iData = nullptr;
    size_t iLen = 0;
    if (napi_get_typedarray_info(env, args[3], &iType, &iLen,
                                 &iData, nullptr, nullptr) != napi_ok ||
        iType != napi_int32_array) {
        return ThrowMsg(env, "tileSlice: slices Int32Array olmak zorunda");
    }
    if (iLen == 0 || iLen % 4 != 0) {
        return ThrowMsg(env, "tileSlice: dilim tamponu stride 4 olmali");
    }
    const int32_t nSlices = static_cast<int32_t>(iLen / 4);
    if (nSlices > 4096) {
        return ThrowMsg(env, "tileSlice: dilim siniri asildi");
    }

    inkcore::TileSliceKernelInput in{};
    in.src = static_cast<const uint8_t*>(sData);
    in.srcW = srcW;
    in.srcH = srcH;
    in.slices = static_cast<const int32_t*>(iData);
    in.nSlices = nSlices;

    /* 1. gecis: sayim (+dogrulama: -1 aralik disi dilim) */
    const int64_t total = inkcore::tileSliceKernel(in, nullptr, 0);
    if (total < 0) return ThrowMsg(env, "tileSlice: dilim aralik disi");
    /* 2. gecis: yaz */
    std::vector<uint8_t> held(static_cast<size_t>(total), 0);
    if (total > 0) {
        const int64_t written = inkcore::tileSliceKernel(
            in, held.data(), static_cast<int64_t>(held.size()));
        if (written != total) {
            return ThrowMsg(env, "tileSlice: yazim bozuklugu");
        }
    }

    void* buffer = nullptr;
    napi_value ab;
    if (napi_create_arraybuffer(env, held.size(), &buffer, &ab) != napi_ok ||
        !buffer) {
        return ThrowMsg(env, "tileSlice: bellek atanamadi");
    }
    if (!held.empty()) {
        std::memcpy(buffer, held.data(), held.size());
    }
    napi_value data;
    if (napi_create_typedarray(
            env, napi_uint8_array, held.size(), ab, 0, &data) != napi_ok) {
        return ThrowMsg(env, "tileSlice: dizi sarilamadi");
    }
    napi_value obj, fn, cnt;
    napi_create_object(env, &obj);
    napi_create_string_utf8(env, "tileSlice", 9, &fn);
    napi_set_named_property(env, obj, "fn", fn);
    napi_set_named_property(env, obj, "data", data);
    napi_create_int64(env, total, &cnt);
    napi_set_named_property(env, obj, "count", cnt);
    return obj;
}

napi_value Init(napi_env env, napi_value exports) {
    const struct { const char* name; napi_callback fn; } entries[] = {
        { "noise32",       Noise32        },
        { "noiseTip",      NoiseTip       },
        { "watercolorTip", WatercolorTip  },
        { "dabList",       DabList        },
        { "tileSlice",     TileSlice      },
    };
    for (const auto& e : entries) {
        napi_value fn;
        napi_create_function(env, e.name, NAPI_AUTO_LENGTH, e.fn,
                             nullptr, &fn);
        napi_set_named_property(env, exports, e.name, fn);
    }
    return exports;
}

} // namespace

/* Makro global kapsamda olmalı: genişlemesi dışa açık (extern "C")
   kayıt işlevi üretir; anonim ad alanına gömülürse çakışır.
   Init anonim ad alanının içinde tanımlı - global kimlik
   yoluyla aynı işlev referans edilir. */
NAPI_MODULE(inkcore, Init)
