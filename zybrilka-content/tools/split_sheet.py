#!/usr/bin/env python3
"""Split a sticker sheet (several poses on white) into separate transparent PNGs.
python3 split_sheet.py sheet.jpg out_dir prefix [--grid ROWSxCOLS]  -> out_dir/prefix_01.png … (left-to-right, top-to-bottom)
Without --grid figures are found as separate blobs; with --grid (for tightly packed sheets) every blob goes to the cell of its centre."""
import sys, os
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from cutout import cutout

src, out, prefix = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
tmp = os.path.join(out, "_sheet.png"); cutout(src, tmp)
full = np.array(Image.open(tmp)); a = (full[..., 3] > 40).astype(np.uint8)
if "--grid" in sys.argv:
    R, C = map(int, sys.argv[sys.argv.index("--grid") + 1].split("x"))
    src_h, src_w = np.array(Image.open(src)).shape[:2]
    n, lab, stats, cent = cv2.connectedComponentsWithStats(a, 8)
    # cutout() cropped the sheet: recover the offset to map centres back to the original grid
    ys0, xs0 = np.nonzero(a); oy, ox = 0, 0
    cells = {}
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 30: continue
        cx, cy = cent[i]; r = min(R - 1, int(cy / (full.shape[0] / R))); c = min(C - 1, int(cx / (full.shape[1] / C)))
        cells.setdefault((r, c), []).append(i)
    for k, key in enumerate(sorted(cells), 1):
        m = np.isin(lab, cells[key]); ys, xs = np.nonzero(m)
        piece = full.copy(); piece[..., 3] = np.where(m, piece[..., 3], 0)
        piece = piece[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
        Image.fromarray(piece).save(os.path.join(out, f"{prefix}_{k:02d}.png")); print(k, key, piece.shape)
    os.remove(tmp); sys.exit()
n, lab, stats, cent = cv2.connectedComponentsWithStats(cv2.dilate(a, np.ones((9, 9), np.uint8)), 8)
areas = stats[1:, cv2.CC_STAT_AREA]; big = [i + 1 for i in np.argsort(-areas) if areas[i] > areas.max() * 0.25]
owner = {}
for i in range(1, n):  # decorations (?, zzz, sparkles) join the nearest big figure
    if i in big: owner[i] = i; continue
    cx, cy = cent[i]
    owner[i] = min(big, key=lambda b: max(0, stats[b, 0] - cx, cx - stats[b, 0] - stats[b, 2]) ** 2 + max(0, stats[b, 1] - cy, cy - stats[b, 1] - stats[b, 3]) ** 2)
rows = sorted(big, key=lambda b: (round(cent[b][1] / (full.shape[0] / 4)), cent[b][0]))
for k, b in enumerate(rows, 1):
    m = np.isin(lab, [i for i, o in owner.items() if o == b])
    ys, xs = np.nonzero(m & (a > 0))
    piece = full.copy(); piece[..., 3] = np.where(m, piece[..., 3], 0)
    piece = piece[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    Image.fromarray(piece).save(os.path.join(out, f"{prefix}_{k:02d}.png")); print(k, piece.shape)
os.remove(tmp)
