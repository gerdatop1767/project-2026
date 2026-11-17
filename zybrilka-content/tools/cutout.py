#!/usr/bin/env python3
"""Cut a character off a plain white background (owner-made pose art) -> transparent PNG.

Flood-fill from the image border over near-white pixels (so white/cream areas INSIDE the character,
like horns or drawstrings, are kept), then a soft anti-aliased edge and white-fringe removal.

python3 cutout.py in.jpg out.png [--tol 28]
"""
import sys
import numpy as np, cv2
from PIL import Image


def cutout(src, dst, tol=28):
    rgb = np.array(Image.open(src).convert("RGB"))
    h, w = rgb.shape[:2]
    near_white = (255 - rgb.astype(np.int16)).max(axis=2) <= tol
    mask = np.zeros((h + 2, w + 2), np.uint8)
    bg = np.zeros((h, w), np.uint8)
    seeds = [(x, y) for x in range(0, w, 7) for y in (0, h - 1)] + [(x, y) for y in range(0, h, 7) for x in (0, w - 1)]
    fill = near_white.astype(np.uint8)
    for x, y in seeds:
        if fill[y, x] and not bg[y, x]:
            m = np.zeros((h + 2, w + 2), np.uint8)
            cv2.floodFill(fill.copy(), m, (x, y), 2, 0, 0, flags=8 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY)
            bg |= m[1:-1, 1:-1]
    alpha = (bg == 0).astype(np.float32)
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # soft edge: partial alpha on the 1-2 px border by how white the pixel is
    edge = cv2.dilate(alpha, np.ones((3, 3), np.uint8)) - cv2.erode(alpha, np.ones((3, 3), np.uint8))
    whiteness = 1 - (255 - rgb.astype(np.float32)).max(axis=2) / 255
    alpha = np.where(edge > 0, np.clip(alpha * (1 - whiteness * 0.85), 0, 1), alpha)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.7)
    # de-fringe: un-mix the white background from semi-transparent edge pixels
    a = np.clip(alpha, 1e-3, 1)[..., None]
    col = np.clip((rgb.astype(np.float32) - 255 * (1 - a)) / a, 0, 255)
    col = np.where(alpha[..., None] > 0.98, rgb, col)
    out = np.dstack([col, alpha * 255]).astype(np.uint8)
    ys, xs = np.nonzero(alpha > 0.05)
    out = out[max(0, ys.min() - 4): ys.max() + 5, max(0, xs.min() - 4): xs.max() + 5]
    Image.fromarray(out, "RGBA").save(dst)
    return out.shape


if __name__ == "__main__":
    tol = int(sys.argv[sys.argv.index("--tol") + 1]) if "--tol" in sys.argv else 28
    print(cutout(sys.argv[1], sys.argv[2], tol))
