"""2D puppet rig for the approved ZYBRILKA bison (support-bison, front, thumbs-up).

The character art is never redrawn: only the jaw region is warped, a mouth cavity is
painted under the existing smile line, and eyelids are painted over the existing eyes.
All coordinates are for character/references/bison-front-thumbsup@2x.png (1120x1344).
"""
from functools import lru_cache
from pathlib import Path
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "character/references/bison-front-thumbsup@2x.png"
S = 2.0  # rig points measured on the 560x672 original

# Smile line, left -> right (original px). Head is tilted, so the line rises to the right.
SMILE = np.array([(260, 262.5), (270, 265), (282.5, 267.5), (297.5, 265), (312.5, 257.5),
                  (327.5, 245), (336, 236)]) * S
EYES = [dict(c=(230 * S, 224 * S), rx=26 * S, ry=24 * S), dict(c=(324 * S, 188 * S), rx=21 * S, ry=23 * S)]
HEAD_ANGLE = -21.0  # degrees, eye line slope
MAX_OPEN = 15 * S
LIP = (92, 44, 30)
CAVITY = (58, 18, 24)
TONGUE = (214, 98, 104)


def _spline(P, k=24):
    """Catmull-Rom through the smile points -> smooth lip curve (no visible kinks)."""
    P = np.r_[P[:1] * 2 - P[1:2], P, P[-1:] * 2 - P[-2:-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, k, endpoint=False):
            out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2])
    return np.array(out)


def _curve(n=48):
    """Resample the smoothed smile into n points + unit normals (pointing 'down' in head space)."""
    C = _spline(SMILE)
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))]
    t = np.linspace(0, d[-1], n)
    pts = np.c_[np.interp(t, d, C[:, 0]), np.interp(t, d, C[:, 1])]
    tan = np.gradient(pts, axis=0); tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    nrm = np.c_[-tan[:, 1], tan[:, 0]]
    nrm[nrm[:, 1] < 0] *= -1
    return pts, nrm


@lru_cache(maxsize=1)
def base():
    im = Image.open(REF).convert("RGBA")
    arr = np.array(im)
    pts, _ = _curve(200)
    # Jaw weight field: 1 just below the smile, fading to 0 at the chin and at the muzzle sides.
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    line_y = np.interp(xx, pts[:, 0], pts[:, 1], left=np.nan, right=np.nan)
    below = yy - line_y
    t = np.clip((xx - pts[0, 0]) / (pts[-1, 0] - pts[0, 0]), 0, 1)
    side = np.sin(np.pi * t) ** 0.7
    side = np.where(np.isnan(line_y), 0, side)
    fall = np.clip(1 - below / (34 * S), 0, 1) ** 1.3
    weight = np.where((below > -2) & ~np.isnan(line_y), side * fall, 0).astype(np.float32)
    weight = cv2.GaussianBlur(weight, (0, 0), 3 * S)
    # Eyelid colour: fur just above each eye.
    lids = []
    for e in EYES:
        cx, cy = e["c"]
        patch = arr[int(cy - e["ry"] * 1.45):int(cy - e["ry"] * 1.15), int(cx - e["rx"] * .4):int(cx + e["rx"] * .4), :3]
        lids.append(tuple(int(v) for v in np.median(patch.reshape(-1, 3), axis=0)))
    return arr, weight, xx, yy, lids


def render(open_=0.0, width=1.0, blink=0.0, smile_up=0.0):
    """open_ 0..1 jaw opening; width 0.55..1 (rounded vowels narrower); blink 0..1."""
    arr, weight, xx, yy, lids = base()
    o = float(np.clip(open_, 0, 1))
    out = arr
    if o > 0.02:
        disp = weight * (o * MAX_OPEN)
        out = cv2.remap(arr, xx, yy - disp, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    img = Image.fromarray(out)
    if o > 0.02:
        img.alpha_composite(*_mouth_layer(o, width))
    if blink > 0.05:
        img = _blink(img, blink, lids)
    return img


SS = 3  # supersampling factor for the mouth layer (smooth anti-aliased edges)


def _mouth_layer(o, width):
    """Mouth cavity + tongue + teeth + lips drawn at SSx on a local canvas, then downsampled."""
    pts, nrm = _curve(96)
    tt = np.linspace(0, 1, len(pts))
    half = 0.5 * (0.46 + 0.5 * width)            # rounded vowels pull the corners in
    lo, hi = 0.5 - half, 0.5 + half
    sel = (tt >= lo) & (tt <= hi)
    p, nm, ts = pts[sel], nrm[sel], (tt[sel] - lo) / (hi - lo)
    rnd = 1 - width                               # 0 wide .. 0.6 round
    prof = np.sin(np.pi * ts) ** (0.85 - 0.45 * rnd)   # rounder (more "O") profile for round vowels
    depth = o * MAX_OPEN * (0.92 + 0.35 * rnd)
    top = p - nm * (prof * o * 1.6 * S)[:, None]       # upper lip lifts a little
    bot = p + nm * (prof * depth)[:, None]
    x0, y0 = np.floor(np.r_[top, bot].min(0) - 12 * S).astype(int)
    x1, y1 = np.ceil(np.r_[top, bot].max(0) + 12 * S).astype(int)
    w, h = (x1 - x0) * SS, (y1 - y0) * SS
    T = [tuple((v - (x0, y0)) * SS) for v in top]; B = [tuple((v - (x0, y0)) * SS) for v in bot]
    poly = T + B[::-1]
    mask = Image.new("L", (w, h), 0); ImageDraw.Draw(mask).polygon(poly, fill=255)
    # cavity: vertical gradient, darker at the top (shadow under the upper lip)
    g = np.linspace(0, 1, h)[:, None, None]
    cav = (np.array((34, 8, 14))[None, None] * (1 - g) + np.array((96, 30, 40))[None, None] * g).repeat(w, 1)
    lay = Image.fromarray(np.dstack([cav, np.zeros((h, w))]).astype(np.uint8), "RGBA")
    inner = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(inner)
    mid = len(p) // 2
    if o > 0.12:  # tongue rests on the lower lip
        tc = (bot[mid] - nm[mid] * depth * 0.18 - (x0, y0)) * SS
        trx = (hi - lo) * 0.26 * (pts[-1, 0] - pts[0, 0]) * SS; tr_y = max(2, depth * 0.38) * SS
        d.ellipse([tc[0] - trx, tc[1] - tr_y, tc[0] + trx, tc[1] + tr_y], fill=TONGUE + (255,))
        d.ellipse([tc[0] - trx * 0.5, tc[1] - tr_y * 0.6, tc[0] + trx * 0.5, tc[1] - tr_y * 0.05], fill=(236, 132, 136, 140))
    if o > 0.3:  # upper teeth strip
        th = min(o * 3.0 * S, depth * 0.3)
        tp = T + [tuple((v + nm[i] * th - (x0, y0)) * SS) for i, v in reversed(list(enumerate(top)))]
        d.polygon(tp, fill=(250, 246, 240, 240))
    lay.alpha_composite(inner)
    lay.putalpha(mask)
    ld = ImageDraw.Draw(lay)
    ld.line(T, fill=LIP + (255,), width=int(2.2 * S * SS), joint="curve")     # upper lip line (the original smile)
    ld.line(B, fill=(150, 88, 70, 170), width=int(1.3 * S * SS), joint="curve")  # soft lower lip
    for c in (T[0], T[-1]):                                                  # rounded corners
        r = 1.1 * S * SS; ld.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=LIP + (255,))
    lay = lay.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    full = Image.new("RGBA", base()[0].shape[1::-1], (0, 0, 0, 0))
    full.alpha_composite(lay, (int(x0), int(y0)))
    return (full,)


def _blink(img, b, lids):
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    bb = b
    for e, col in zip(EYES, lids):
        cx, cy = e["c"]; rx, ry = e["rx"] * 1.14, e["ry"] * 1.12
        w, h = int(rx * 2 + 12), int(ry * 2 + 12)
        X, Y = np.meshgrid(np.arange(w) - w / 2, np.arange(h) - h / 2)
        b = 0.8 * bb  # keep the closed lid edge inside the eye so the lash curve stays visible
        inside = (X / rx) ** 2 + (Y / ry) ** 2 <= 1
        edge0 = -ry + 2 * ry * b
        sag = ry * 0.35 * b * np.clip(1 - (X / rx) ** 2, 0, 1)   # lid edge curves down like a closed eye
        edge = edge0 + sag - ry * 0.35 * b
        a = (inside & (Y <= edge)).astype(np.float32)
        shade = np.clip(1 - 0.22 * np.clip((Y - (edge - ry * 0.6)) / (ry * 0.6), 0, 1), 0.75, 1)
        rgb = (np.array(col, np.float32)[None, None, :] * shade[..., None]).clip(0, 255)
        top_light = np.clip(1.08 - 0.10 * (Y + ry) / (2 * ry), 0.9, 1.1)
        rgb = (rgb * top_light[..., None] + np.random.default_rng(7).normal(0, 6, rgb.shape)).clip(0, 255)
        a = cv2.GaussianBlur(a, (0, 0), 1.4 * S)
        lid = Image.fromarray(np.dstack([rgb, a * 255]).astype(np.uint8), "RGBA")
        # lash line along the lid edge
        xs = np.linspace(-rx, rx, 40)
        ok = [(x, e_) for x, e_ in zip(xs, edge0 + ry * 0.35 * b * (1 - (xs / rx) ** 2) - ry * 0.35 * b)
              if (x / rx) ** 2 + (e_ / ry) ** 2 <= 1.02]
        if len(ok) > 2:
            ImageDraw.Draw(lid).line([(x + w / 2, y + h / 2) for x, y in ok], fill=(46, 24, 18, 255),
                                     width=int((1.6 + 1.4 * b) * S), joint="curve")
        lid = lid.rotate(-HEAD_ANGLE, resample=Image.BICUBIC, expand=False)
        lay.alpha_composite(lid, (int(cx - w / 2), int(cy - h / 2)))
    img.alpha_composite(lay.filter(ImageFilter.GaussianBlur(0.7)))
    return img


if __name__ == "__main__":
    import sys
    states = [(0, 1, 0), (0.3, 1, 0), (0.6, 1, 0), (1, 1, 0), (0.7, 0.6, 0), (0, 1, 0.5), (0, 1, 1)]
    tiles = [render(o, w, b).crop((380, 300, 760, 640)) for o, w, b in states]
    sheet = Image.new("RGBA", (380 * len(tiles), 340), "white")
    for i, t in enumerate(tiles):
        sheet.alpha_composite(t, (i * 380, 0))
    sheet.convert("RGB").save(sys.argv[1] if len(sys.argv) > 1 else "rig_test.png")
