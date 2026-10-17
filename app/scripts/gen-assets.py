#!/usr/bin/env python3
"""Derive every app icon / splash / favicon asset from the master Nomad logo.

Usage:
    python scripts/gen-assets.py                     # uses assets/Nomad-log-gradient.png
    python scripts/gen-assets.py path/to/new-logo.png

Drop a new master logo into assets/ (or pass a path) and rerun this. It writes
the five derived PNGs that app.json points at, so the icon, adaptive icon,
themed icon, splash and favicon all update together and stay consistent.

Logo sizing: the logo is scaled to 52.5% of a 1024x1024 square canvas for the
plain icon/splash/favicon layers, and 45% for the two Android adaptive layers.
Android crops the adaptive layer to the central 66/108 (~61%) of the canvas, so
anything larger loses its edges to the squircle mask.

The master logo should have a transparent background. It is centred by its
alpha bounding box, so the artwork does not need to sit in the middle of its
own canvas.

Requires Pillow:  python -m pip install Pillow
"""
import os
import sys
from PIL import Image

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(APP_DIR, "assets")

DEFAULT_MASTER = os.path.join(ASSETS, "Nomad-log-gradient.png")

CANVAS = 1024
LOGO_FILL = 0.525   # icon / splash / favicon
SAFE_FILL = 0.45    # Android adaptive layers (mask ceiling ~0.611)

# name, fill ratio, background colour or None for transparent
OUTPUTS = [
    ("icon.png", LOGO_FILL, None),
    ("android-icon-foreground.png", SAFE_FILL, None),
    ("splash-icon.png", LOGO_FILL, None),
]


def load_centred(master, canvas, fill_ratio, bg=None):
    """Square canvas with the master's alpha bbox centred at `fill_ratio`."""
    bbox = master.getbbox()  # bounds of non-transparent pixels
    if bbox is None:
        raise SystemExit("master logo is fully transparent - nothing to draw")

    logo = master.crop(bbox)
    inner = int(canvas * fill_ratio)
    logo.thumbnail((inner, inner), Image.LANCZOS)

    out = Image.new("RGBA", (canvas, canvas), bg or (0, 0, 0, 0))
    out.paste(logo, ((canvas - logo.width) // 2, (canvas - logo.height) // 2), logo)
    return out


def save(img, name):
    path = os.path.join(ASSETS, name)
    img.save(path, "PNG", optimize=True)
    bbox = img.getbbox()
    fill = max(bbox[2] - bbox[0], bbox[3] - bbox[1]) / img.size[0] * 100
    print("  %-30s %4dx%-4d fill %5.1f%%  %7.1f KB"
          % (name, img.width, img.height, fill, os.path.getsize(path) / 1024))


def main():
    master_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MASTER
    if not os.path.exists(master_path):
        raise SystemExit("master logo not found: %s" % master_path)

    print("master: %s" % master_path)
    master = Image.open(master_path).convert("RGBA")
    print("source: %dx%d" % master.size)

    for name, fill, bg in OUTPUTS:
        save(load_centred(master, CANVAS, fill, bg), name)

    # Android 13+ themed icon: same silhouette as the adaptive foreground,
    # flattened to white so the launcher can tint it.
    mono = load_centred(master, CANVAS, SAFE_FILL)
    white = Image.new("RGBA", mono.size, (255, 255, 255, 0))
    white.putalpha(mono.split()[3])
    save(white, "android-icon-monochrome.png")

    # Browser tab icon.
    save(load_centred(master, 64, LOGO_FILL), "favicon.png")

    print("\nRebuild the app to apply:")
    print("  npx expo prebuild --platform android --no-install")
    print("  cd android && ./gradlew assembleRelease --no-daemon")


if __name__ == "__main__":
    main()
