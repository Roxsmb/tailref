"""TailRef marka görsellerini tek kaynaktan üretir.

Kaynak: assets/logo-source/logo-paint-master.png
  2026-11 revizyonu: kullanıcının düzeltilmiş PSD çıktısı (4000×4000,
  şeffaf zemin) birebir master olarak alındı — damla renkleri KAYNAKTAN
  korunur. Eski DROP_COLORS normalizasyonu yalnız --recolor bayrağıyla
  zorlanabilir (v1 master'daki uyumsuz renkler içindi).

Üretilen set:
  - tailref_logo_black_transparent.png  → siyah sincap + renkli damlalar
    (açık tema markası, şeffaf zemin)
  - favicon-light/dark.png, tailref-mark.svg (gömülü PNG yedeği)
  - build/icon-{16..256}.png + build/icon.ico (yuvarlatılmış beyaz kart)
  - splash.html gömülü açılış logusu (base64) tazelenir
  - src/renderer/assets kopyaları + assets/tailref_splash_logo.png

Kullanım: python scripts/build-brand-assets.py [--recolor]
"""

from __future__ import annotations

from pathlib import Path
import re
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "logo-source"
ASSETS = ROOT / "assets"
BUILD = ROOT / "build"
RENDER_ASSETS = ROOT / "src" / "renderer" / "assets"

MASTER = SRC / "logo-paint-master.png"

# Damla üçlüsü: aynı doygunluk/vibrance ailesinden uyumlu renkler.
# Eski PSD değerleri uyumsuzdu: kırmızı #840000 (çok koyu/kirli),
# yeşil #008400 (sert saf web yeşili), mavi #00437F (koyu, patlamakta).
DROP_COLORS = {
    "kirmizi": (192, 57, 43),    # #C0392B
    "yesil": (39, 174, 96),      # #27AE60
    "mavi": (41, 128, 185),      # #2980B9
}

ICON_BG = (21, 21, 26, 255)          # #15151a
ICON_CARD_BG = (250, 250, 248, 255)  # #fafaf8 — beyaz kart rozeti
ICON_RADIUS_RATIO = 0.22

# 32px'in altında damlalar ~1px'e düşer ve leke gibi okunur; küçük ikonlar
# için tek renk (yalnız sincap) varyant daha temiz görünür.
DROPLESS_MAX_ICON = 48


def load_master() -> Image.Image:
    im = Image.open(MASTER).convert("RGBA")
    im.load()
    return im


def classify_drops(arr) -> np.ndarray:
    """Renkli damla piksellerini baskın kanala göre sınıflar.

    arr: RGBA numpy dizisi veya PIL Image.
    Dönüş: H×W uint8 maskesi (0=siyah-beyaz sanat, 1/2/3=damla).
    Sınır pikselleri (koyu kenar antialiasing) baskın hue'ya düşürülür.
    """
    if isinstance(arr, Image.Image):
        arr = np.array(arr)
    a = arr.astype(np.int16)
    alpha = a[:, :, 3]
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    renkli = (alpha > 0) & ((mx - mn) > 30)
    lab = np.zeros(arr.shape[:2], dtype=np.uint8)
    k = renkli & (r > np.maximum(g, b) + 15)
    y = renkli & ~k & (g > np.maximum(r, b) + 15)
    m = renkli & ~k & ~y & (b > np.maximum(r, g) + 15)
    lab[k] = 1
    lab[y] = 2
    lab[m] = 3
    return lab


def recolor(master: Image.Image) -> Image.Image:
    """Damla renklerini DROP_COLORS ile değiştirir (alfa/doku korunur)."""
    arr = np.array(master)
    lab = classify_drops(arr)
    for i, renk in enumerate((DROP_COLORS["kirmizi"], DROP_COLORS["yesil"], DROP_COLORS["mavi"]), start=1):
        sec = lab == i
        for c in range(3):
            arr[:, :, c][sec] = renk[c]
    return Image.fromarray(arr)


def white_variant(recolored: Image.Image) -> Image.Image:
    """[KULLANILMIYOR] Siyah-beyaz sanatı beyaza çevirir; damlalar renkli kalır.
    Doku beyaza çevrilince ağırlaştığı için üretimden çıkarıldı — kart rozeti
    kalıbına geçildi. Referans olarak tutuluyor."""
    arr = np.array(recolored).copy()
    lab = classify_drops(Image.fromarray(arr))
    gri = (arr[:, :, 3] > 0) & (lab == 0)
    arr[:, :, 0][gri] = 255
    arr[:, :, 1][gri] = 255
    arr[:, :, 2][gri] = 255
    return Image.fromarray(arr)


def square(im: Image.Image, pad_ratio: float = 0.06) -> Image.Image:
    """İçeriği kırpar, kare tuvale oranlı boşlukla ortalar."""
    box = im.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
    if not box:
        raise ValueError("görselde içerik bulunamadı")
    im = im.crop(box)
    side = int(max(im.width, im.height) * (1 + pad_ratio * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return canvas


def resize(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.LANCZOS)


def rounded_icon(mark: Image.Image, size: int, scale: float = 0.82, dropless: Image.Image | None = None) -> Image.Image:
    """Beyaz yuvarlatılmış kart zemin + ortada siyah mark.

    Siyah mürekkep sanatı koyu zemine beyaz olarak taşınamıyor (doku
    ağırlaşıyor); görev çubuğunda beyaz kart + siyah sincap okunuyor.
    scale 0.82: yuvarlak köşelerde (radius %22) güvenli, mark dolgun. """
    kaynak = dropless if (dropless is not None and size <= DROPLESS_MAX_ICON) else mark
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = int(size * ICON_RADIUS_RATIO)
    ImageDraw.Draw(canvas).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, fill=ICON_CARD_BG
    )
    inner = int(size * scale)
    m = resize(kaynak, inner)
    canvas.paste(m, ((size - inner) // 2, (size - inner) // 2), m)
    return canvas


def write(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  ({path.stat().st_size / 1024:.1f} KB, {img.width}x{img.height})")


def main() -> int:
    master = load_master()
    # Yeni master damla renklerini zaten taşıyor; --recolor yalnız eski
    # v1 master'daki uyumsuz renkler için DROP_COLORS normalizasyonunu
    # zorlamak içindi.
    recolored = recolor(master) if "--recolor" in sys.argv else master
    black = square(recolored)

    # Küçük ikonlar için damlasız varyant (yalnız sincap, tek renk).
    arr = np.array(recolored).copy()
    lab = classify_drops(Image.fromarray(arr))
    arr[lab > 0] = 0
    black_dropless = square(Image.fromarray(arr))
    # İkon kartına padsiz kaynak: mark kartin %82'sini doldursun.
    black_tight = square(recolored, 0.0)
    black_tight_dropless = square(Image.fromarray(arr), 0.0)

    print("Uygulama varlıkları:")
    # Beyaz varyant kaldırıldı: siyah mürekkep sanatı beyaza çevirince
    # kaligrafi dokusu ağırlaşıyor. Koyu zeminlerde mark, BEYAZ KART üzerinde
    # siyah olarak kullanılıyor (CSS chip + siyah PNG).
    write(resize(black, 512), ASSETS / "tailref_logo_black_transparent.png")
    write(resize(black, 256), ASSETS / "favicon-light.png")
    write(rounded_icon(black_tight, 256, dropless=black_tight_dropless), ASSETS / "favicon-dark.png")

    # iOS saydamlığı yok sayar: opak zemin şart. (Splash kopyası da tazelensin.)
    write(resize(black, 512), ASSETS / "tailref_splash_logo.png")

    # SVG yedeği: onerror durumunda kullanılıyor. Gerçek vektör değil, gömülü PNG.
    # Siyah mark gömer: .brandMark chip CSS'i beyaz kart zeminini sağlar.
    import base64
    import io
    buf = io.BytesIO()
    resize(black, 128).save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" '
        'width="128" height="128">\n'
        f'  <image href="data:image/png;base64,{b64}" width="128" height="128"/>\n'
        "</svg>\n"
    )
    svg_path = ASSETS / "tailref-mark.svg"
    svg_path.write_text(svg, encoding="utf-8")
    print(f"  {svg_path.relative_to(ROOT)}  ({svg_path.stat().st_size / 1024:.1f} KB, gömülü PNG)")

    print("\nPencere/uygulama ikonu:")
    icon_pngs = []
    for size in (16, 24, 32, 48, 64, 128, 256):
        img = rounded_icon(black_tight, size, dropless=black_tight_dropless)
        icon_pngs.append(img)
        write(img, BUILD / f"icon-{size}.png")

    ico_path = BUILD / "icon.ico"
    icon_pngs[-1].save(ico_path, format="ICO", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    print(f"  {ico_path.relative_to(ROOT)}  ({ico_path.stat().st_size / 1024:.1f} KB)")

    print("\nSplash gömülü logusu:")
    splash_path = ROOT / "src" / "renderer" / "splash.html"
    html = splash_path.read_text(encoding="utf-8")
    buf = io.BytesIO()
    resize(black, 256).save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    html, n = re.subn(
        r'(src=")data:image/png;base64,[^"]*(")',
        r"\1data:image/png;base64," + b64 + r"\2",
        html, count=1,
    )
    if n != 1:
        raise SystemExit("splash.html gömülü logo deseni bulunamadı")
    splash_path.write_text(html, encoding="utf-8")
    print(f"  {splash_path.relative_to(ROOT)}  ({splash_path.stat().st_size / 1024:.1f} KB, gömülü 256px)")

    print("\nrenderer kopyaları:")
    for ad in ("tailref_logo_black_transparent.png",
               "favicon-light.png", "favicon-dark.png", "tailref-mark.svg"):
        shutil.copyfile(ASSETS / ad, RENDER_ASSETS / ad)
        print(f"  src/renderer/assets/{ad}  ({(RENDER_ASSETS / ad).stat().st_size / 1024:.1f} KB)")

    print("\nTamamlandı.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
