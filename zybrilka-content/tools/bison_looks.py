"""Code-made variations of the official bison (no AI generation): outfits, accessories, expressions, head tilt.

Everything is applied on top of bison_rig.render() output (1120x1344, 2x of the 560x672 original),
so lip-sync and blinking keep working. Coordinates below are in ORIGINAL px and scaled by S.

look = {
  "outfit": "navy|blue|red|green|purple|white|black|yellow|pink",   # hoodie colour (navy = canon)
  "accessory": [] | ["glasses", "sunglasses", "grad_cap", "headphones", "cap", "crown", "pencil"],
  "expression": "neutral|happy|surprised|skeptical|angry|sad",
  "tilt": degrees (head tilt, -3..3; larger shows ghosting),
  "flip": false                                                       # mirror the whole character
}
"""
from functools import lru_cache
import math
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter

S = 2.0
EYE_L, EYE_R = np.array([230, 224]) * S, np.array([324, 188]) * S
BROW_L = dict(box=(186, 160, 258, 206), c=(222, 186))
BROW_R = dict(box=(288, 124, 345, 150), c=(316, 137))
NECK = np.array([300, 300]) * S
HEAD_TOP = np.array([298, 62]) * S
HEAD_ANGLE = -21.0  # eye-line slope of the canon art
OUTFITS = {"navy": None, "blue": (40, 110, 230), "red": (200, 40, 60), "green": (30, 150, 90), "purple": (120, 60, 200),
           "white": (225, 228, 235), "black": (24, 24, 28), "yellow": (240, 190, 40), "pink": (235, 110, 160)}


def _rot(p, c, deg):
    a = math.radians(deg); x, y = p[0] - c[0], p[1] - c[1]
    return np.array([c[0] + x * math.cos(a) + y * math.sin(a), c[1] - x * math.sin(a) + y * math.cos(a)])


@lru_cache(maxsize=1)
def _masks(shape):
    import bison_rig
    arr = bison_rig.base()[0]
    rgb = arr[..., :3].astype(np.float32) / 255; a = arr[..., 3] / 255.0
    hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    h, s_, v = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]] / S
    region = (yy > 262) & (yy < 575) & (xx > 95) & (xx < 530) & (a > 0.5)
    fur = (((h < 45) | (h > 340)) & (s_ > 0.33) & (v > 0.2))          # orange/brown fur, hands, legs
    light = v > 0.5                                                   # drawstrings, logo patch
    hood = (region & ~fur & ~light).astype(np.uint8)
    hood = cv2.medianBlur(hood * 255, 7) / 255.0
    hood = cv2.morphologyEx(hood.astype(np.float32), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    hood = cv2.GaussianBlur(hood, (0, 0), 1.6) * (a > 0.5)
    # head mask for tilting (ellipse around head, fading out at the neck)
    head = np.zeros(arr.shape[:2], np.float32)
    cv2.ellipse(head, (int(255 * S), int(165 * S)), (int(200 * S), int(150 * S)), 0, 0, 360, 1.0, -1)
    head *= np.clip((305 - yy) / 30, 0, 1)
    head = cv2.GaussianBlur(head, (0, 0), 8 * S)
    return hood, head


def recolor(img, outfit):
    target = OUTFITS.get(outfit)
    if target is None: return img
    arr = np.array(img).astype(np.float32)
    hood, _ = _masks(arr.shape)
    lum = arr[..., :3].mean(-1, keepdims=True) / 255
    shade = np.clip(lum / 0.22, 0.25, 1.6)  # keep folds/shading of the original fabric
    col = np.clip(np.array(target, np.float32)[None, None] * (0.35 + 0.65 * shade), 0, 255)
    if outfit == "black": col = arr[..., :3] * 0.7
    arr[..., :3] = arr[..., :3] * (1 - hood[..., None]) + col * hood[..., None]
    return Image.fromarray(arr.astype(np.uint8))


def _warp_region(arr, box, dy, dx=0.0, rot=0.0):
    """Shift a soft-edged region (eyebrow) by dx/dy px and rotate (deg) around its centre."""
    x0, y0, x1, y1 = [int(v * S) for v in box]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    M = cv2.getRotationMatrix2D((cx, cy), rot, 1.0); M[0, 2] += dx * S; M[1, 2] += dy * S
    moved = cv2.warpAffine(arr, M, (arr.shape[1], arr.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    m = np.zeros(arr.shape[:2], np.float32)
    cv2.ellipse(m, (int(cx), int(cy)), (int((x1 - x0) * 0.62), int((y1 - y0) * 0.75)), 0, 0, 360, 1.0, -1)
    m = cv2.warpAffine(m, M, (arr.shape[1], arr.shape[0]))
    m = cv2.GaussianBlur(m, (0, 0), 3 * S)[..., None]
    return (arr * (1 - m) + moved * m).astype(np.uint8)


EXPR = {  # (left brow dy, rot), (right brow dy, rot), squint 0..1
    "neutral": ((0, 0), (0, 0), 0.0), "happy": ((-2, 4), (-2, -4), 0.35), "surprised": ((-9, 0), (-8, 0), 0.0),
    "skeptical": ((-8, 6), (3, -6), 0.15), "angry": ((5, -14), (5, 14), 0.2), "sad": ((-3, 14), (-3, -14), 0.1),
}


def expression(img, name, k=1.0):
    if name in (None, "neutral") or k <= 0.01: return img
    (ldy, lr), (rdy, rr), squint = EXPR[name]
    arr = np.array(img)
    arr = _warp_region(arr, BROW_L["box"], ldy * k, 0, lr * k)
    arr = _warp_region(arr, BROW_R["box"], rdy * k, 0, rr * k)
    img = Image.fromarray(arr)
    if squint * k > 0.02:  # "smiling eyes": lower lids pushed up by the cheeks
        import bison_rig
        lids = bison_rig.base()[4]
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
        for e, col in zip(bison_rig.EYES, lids):
            cx, cy = e["c"]; rx, ry = e["rx"] * 1.1, e["ry"] * 1.1
            top = cy + ry - 2 * ry * squint * k * 0.6
            d.chord([cx - rx, top - ry * 0.5, cx + rx, cy + ry * 1.25], 0, 180, fill=col + (255,))
        m = Image.new("L", img.size, 0); md = ImageDraw.Draw(m)
        for e in bison_rig.EYES:
            cx, cy = e["c"]; md.ellipse([cx - e["rx"] * 1.15, cy - e["ry"] * 1.15, cx + e["rx"] * 1.15, cy + e["ry"] * 1.15], fill=255)
        lay.putalpha(Image.fromarray(np.minimum(np.array(lay.getchannel("A")), np.array(m))))
        img.alpha_composite(lay.filter(ImageFilter.GaussianBlur(1.2)))
    return img


def tilt(img, deg):
    if abs(deg) < 0.2: return img
    arr = np.array(img).astype(np.float32)
    _, head = _masks(arr.shape)
    M = cv2.getRotationMatrix2D(tuple(NECK), deg, 1.0)
    rot = cv2.warpAffine(arr, M, (arr.shape[1], arr.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    hm = cv2.warpAffine(head, M, (head.shape[1], head.shape[0]))[..., None]
    out = arr * (1 - hm) + rot * hm
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


# ---------- accessories (vector, drawn at 3x then downsampled) ----------
def _layer(size):
    return Image.new("RGBA", (size[0], size[1]), (0, 0, 0, 0))


def _eye_frame(d, c, r, color, width, fill=None):
    d.rounded_rectangle([c[0] - r * 1.25, c[1] - r * 0.95, c[0] + r * 1.25, c[1] + r * 0.95], int(r * 0.45), outline=color, width=width, fill=fill)


def accessories(img, items):
    if not items: return img
    W, H = img.size; lay = _layer(img.size); d = ImageDraw.Draw(lay)
    mid = (EYE_L + EYE_R) / 2; ang = HEAD_ANGLE
    for it in items:
        if it in ("glasses", "sunglasses"):
            fill = (12, 14, 22, 245) if it == "sunglasses" else (255, 255, 255, 30)
            col = (20, 20, 26, 255) if it == "sunglasses" else (35, 70, 140, 255)
            g = _layer(img.size); gd = ImageDraw.Draw(g)
            for c, r in ((EYE_L, 30 * S), (EYE_R, 26 * S)):
                _eye_frame(gd, c, r, col, int(5 * S), fill)
            gd.line([tuple(EYE_L + np.array([31, -6]) * S), tuple(EYE_R + np.array([-27, 8]) * S)], fill=col, width=int(5 * S))
            if it == "sunglasses":
                for c in (EYE_L, EYE_R):
                    gd.line([tuple(c + np.array([-14, -12]) * S), tuple(c + np.array([-4, -16]) * S)], fill=(255, 255, 255, 140), width=int(3 * S))
            lay.alpha_composite(g)
        elif it == "grad_cap":
            top = HEAD_TOP + np.array([-10, 18]) * S
            base = [tuple(_rot(top + np.array(p) * S, top, ang * 0.4)) for p in [(-62, 0), (62, 0), (52, 26), (-52, 26)]]
            board = [tuple(_rot(top + np.array(p) * S, top, ang * 0.4)) for p in [(0, -40), (95, -8), (0, 22), (-95, -8)]]
            d.polygon(base, fill=(18, 20, 30, 255)); d.polygon(board, fill=(28, 30, 44, 255), outline=(60, 70, 110, 255))
            tas = _rot(top + np.array([70, -6]) * S, top, ang * 0.4)
            d.line([tuple(_rot(top, top, 0)), tuple(tas)], fill=(255, 200, 60, 255), width=int(3 * S))
            d.line([tuple(tas), tuple(tas + np.array([4, 48]) * S)], fill=(255, 200, 60, 255), width=int(5 * S))
        elif it == "cap":
            top = HEAD_TOP + np.array([-6, 30]) * S
            d.pieslice([top[0] - 95 * S, top[1] - 55 * S, top[0] + 95 * S, top[1] + 75 * S], 180, 360, fill=(53, 152, 243, 255))
            d.ellipse([top[0] - 20 * S, top[1] + 2 * S, top[0] + 120 * S, top[1] + 32 * S], fill=(30, 110, 210, 255))
            d.ellipse([top[0] - 8 * S, top[1] - 62 * S, top[0] + 8 * S, top[1] - 48 * S], fill=(30, 110, 210, 255))
        elif it == "headphones":
            l, r = np.array([118, 240]) * S, np.array([412, 168]) * S
            d.arc([l[0] - 10 * S, HEAD_TOP[1] - 20 * S, r[0] + 10 * S, l[1] + 120 * S], 190, 340, fill=(30, 32, 40, 255), width=int(14 * S))
            for c in (l, r):
                d.rounded_rectangle([c[0] - 26 * S, c[1] - 40 * S, c[0] + 26 * S, c[1] + 40 * S], int(18 * S), fill=(53, 152, 243, 255), outline=(20, 22, 30, 255), width=int(4 * S))
        elif it == "scarf":
            pts = [(200, 285), (300, 312), (405, 268), (412, 300), (300, 345), (195, 318)]
            d.polygon([tuple(np.array(p) * S) for p in pts], fill=(220, 50, 70, 255))
            for k in range(5):
                x = 220 + k * 40; d.line([(x * S, (290 + k * 2) * S), ((x + 10) * S, (325 + k * 2) * S)], fill=(255, 255, 255, 160), width=int(6 * S))
            d.polygon([tuple(np.array(p) * S) for p in [(360, 300), (395, 300), (385, 390), (352, 385)]], fill=(200, 40, 60, 255))
        elif it == "crown":
            top = HEAD_TOP + np.array([-4, 4]) * S
            pts = [(-60, 30), (-60, -10), (-30, 10), (0, -30), (30, 10), (60, -10), (60, 30)]
            d.polygon([tuple(_rot(top + np.array(p) * S, top, ang * 0.4)) for p in pts], fill=(255, 205, 60, 255), outline=(200, 140, 20, 255))
        elif it == "pencil":
            p0, p1 = np.array([410, 170]) * S, np.array([470, 120]) * S
            d.line([tuple(p0), tuple(p1)], fill=(255, 196, 60, 255), width=int(11 * S))
            d.line([tuple(p0), tuple(p0 + (p0 - p1) * 0.18)], fill=(40, 30, 30, 255), width=int(7 * S))
    img = img.copy(); img.alpha_composite(lay.filter(ImageFilter.GaussianBlur(0.6)))
    return img


_STYLED = {}


def styled_base(look):
    """Outfit + eyebrow/squint expression baked into the rig base once per look (fast path for video)."""
    import json, bison_rig
    key = json.dumps({k: look.get(k) for k in ("outfit", "expression", "expression_k")}, sort_keys=True)
    if key not in _STYLED:
        img = Image.fromarray(bison_rig.base()[0])
        img = recolor(img, look.get("outfit", "navy"))
        img = expression(img, look.get("expression", "neutral"), look.get("expression_k", 1.0))
        _STYLED[key] = np.array(img)
    return _STYLED[key]


_ACC = {}


def accessory_layer(items, size):
    key = tuple(items or ())
    if key not in _ACC:
        _ACC[key] = accessories(Image.new("RGBA", size, (0, 0, 0, 0)), list(key)) if key else None
    return _ACC[key]


def render_look(open_, width, blink, look, t=0.0):
    """Fast per-frame render: cached styled base + live mouth/blink + cached accessory layer + tilt/flip."""
    import bison_rig
    look = look or {}
    img = bison_rig.render(open_, width, blink, base_arr=styled_base(look) if look else None)
    acc = accessory_layer(look.get("accessory"), img.size)
    if acc is not None: img.alpha_composite(acc)
    tl = float(np.clip(look.get("tilt", 0) + look.get("tilt_wobble", 0) * math.sin(t * 2.4), -3.5, 3.5))
    img = tilt(img, tl)
    if look.get("flip"): img = img.transpose(Image.FLIP_LEFT_RIGHT)
    return img


def apply(img, look, t=0.0):
    if not look: return img
    img = recolor(img, look.get("outfit", "navy"))
    img = expression(img, look.get("expression", "neutral"), look.get("expression_k", 1.0))
    img = accessories(img, look.get("accessory", []))
    tl = float(np.clip(look.get("tilt", 0) + look.get("tilt_wobble", 0) * math.sin(t * 2.4), -3.5, 3.5))
    img = tilt(img, tl)
    if look.get("flip"): img = img.transpose(Image.FLIP_LEFT_RIGHT)
    return img


if __name__ == "__main__":
    import sys
    sys.path.insert(0, __import__("os").path.dirname(__file__))
    import bison_rig
    looks = [{}, {"outfit": "red", "accessory": ["sunglasses"], "expression": "skeptical"},
             {"outfit": "blue", "accessory": ["grad_cap"], "expression": "happy"}, {"outfit": "green", "accessory": ["headphones"], "expression": "surprised"},
             {"outfit": "white", "accessory": ["glasses"], "expression": "sad", "tilt": 3}, {"outfit": "yellow", "accessory": ["cap"], "expression": "angry", "tilt": -3}]
    tiles = [apply(bison_rig.render(0.3, 1, 0), lk).resize((373, 448)) for lk in looks]
    sheet = Image.new("RGBA", (373 * 3, 448 * 2), (230, 235, 245, 255))
    for i, t in enumerate(tiles): sheet.alpha_composite(t, ((i % 3) * 373, (i // 3) * 448))
    sheet.convert("RGB").save(sys.argv[1] if len(sys.argv) > 1 else "looks.png")
