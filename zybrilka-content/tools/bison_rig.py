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


def _curve(n=48):
    """Resample the smile polyline into n points + unit normals (pointing 'down' in head space)."""
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(SMILE, axis=0), axis=1))]
    t = np.linspace(0, d[-1], n)
    pts = np.c_[np.interp(t, d, SMILE[:, 0]), np.interp(t, d, SMILE[:, 1])]
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
    d = ImageDraw.Draw(img)
    if o > 0.02:
        pts, nrm = _curve()
        n = len(pts)
        tt = np.linspace(0, 1, n)
        lo, hi = 0.5 - 0.5 * width * 0.88, 0.5 + 0.5 * width * 0.88
        sel = (tt >= lo - 0.04) & (tt <= hi + 0.04)
        p, nm, ts = pts[sel], nrm[sel], (tt[sel] - lo) / (hi - lo)
        bulge = np.clip(np.sin(np.pi * np.clip(ts, 0, 1)), 0, 1) ** 0.75
        top = p + nm * (bulge * o * 2.5 * S)[:, None] * -0.25
        bot = p + nm * (bulge * o * MAX_OPEN * (0.95 + 0.1 * (1 - width)))[:, None]
        poly = [tuple(v) for v in np.r_[top, bot[::-1]]]
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.polygon(poly, fill=CAVITY + (255,))
        # tongue: lower part of cavity
        mid = len(p) // 2
        tc = (p[mid] + nm[mid] * o * MAX_OPEN * 0.78)
        trx, try_ = (hi - lo) * 0.3 * (pts[-1, 0] - pts[0, 0]), max(2, o * MAX_OPEN * 0.42)
        tongue = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(tongue).ellipse([tc[0] - trx, tc[1] - try_, tc[0] + trx, tc[1] + try_], fill=TONGUE + (255,))
        mask = Image.new("L", img.size, 0); ImageDraw.Draw(mask).polygon(poly, fill=255)
        layer.paste(tongue, (0, 0), Image.composite(tongue, Image.new("RGBA", img.size), mask).getchannel("A"))
        if o > 0.45:  # hint of upper teeth on wide vowels
            teeth = Image.new("RGBA", img.size, (0, 0, 0, 0))
            tp = [tuple(v) for v in np.r_[top, (top + nm * (o * 2.6 * S))[::-1]]]
            ImageDraw.Draw(teeth).polygon(tp, fill=(250, 244, 236, 235))
            layer.alpha_composite(Image.composite(teeth, Image.new("RGBA", img.size), mask))
        layer = layer.filter(ImageFilter.GaussianBlur(0.6))
        img.alpha_composite(layer)
        d = ImageDraw.Draw(img)
        d.line([tuple(v) for v in top], fill=LIP, width=int(2.4 * S), joint="curve")
        d.line([tuple(v) for v in bot], fill=LIP + (200,), width=int(1.6 * S), joint="curve")
    if blink > 0.05:
        img = _blink(img, blink, lids)
    return img


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
