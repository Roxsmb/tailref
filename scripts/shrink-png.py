#!/usr/bin/env python3
"""Downscale a PNG in place (2x render -> documentation size).

Used by scripts/capture-docs.js so the shipped screenshots are crisp
rather than captured at 1x.
"""
import os
import sys

from PIL import Image


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: shrink-png.py <file.png> <width>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    width = int(sys.argv[2])

    with Image.open(path) as src:
        im = src.convert("RGB")
        if im.width <= width:
            print("PNG %s · %dx%d (unchanged)" % (os.path.basename(path), im.width, im.height))
            return 0
        height = max(1, round(width * im.height / im.width))
        im = im.resize((width, height), Image.LANCZOS)
        im.save(path, format="PNG", optimize=True)

    print("PNG %s · %dx%d · %.0f KB" % (
        os.path.basename(path), width, height,
        os.path.getsize(path) / 1024.0))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
