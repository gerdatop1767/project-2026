"""ZYBRILKA video studio: reusable building blocks for 1080x1920 TikTok renders (Pillow + ffmpeg).

Everything here is code-generated: background, phone mockup, kinetic text, subtitles,
audio-driven lip-sync for the bison rig. Brand tokens are taken from zybrilka.ru.
"""
import json, math, subprocess, wave
from functools import lru_cache
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
W, H, FPS = 1080, 1920, 30
# TikTok safe zone (UI overlays): keep text inside x 60..930, y 150..1440
SAFE = (60, 150, 930, 1440)

BG = (5, 7, 15)
BG2 = (14, 22, 58)
BLUE = (53, 152, 243)
BLUE2 = (79, 174, 250)
CYAN = (110, 210, 255)
RED = (255, 76, 106)
GREEN = (64, 214, 140)
YELLOW = (255, 214, 92)
WHITE = (255, 255, 255)
MUTED = (154, 166, 191)

FONT_DISPLAY = ROOT / "branding/fonts/Unbounded-Variable.ttf"
FONT_TEXT = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
LOGO = REPO / "apps/web/public/branding/v3/logo-icon-desktop.png"


# ---------- easing ----------
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))

def ease_out(t):
    t = clamp(t); return 1 - (1 - t) ** 3

def ease_in_out(t):
    t = clamp(t); return 3 * t * t - 2 * t ** 3

def back_out(t, s=1.7):
    t = clamp(t) - 1; return t * t * ((s + 1) * t + s) + 1

def prog(t, start, dur):
    return clamp((t - start) / dur)


# ---------- fonts / text ----------
@lru_cache(maxsize=64)
def font(size, weight=800, display=True):
    if display:
        f = ImageFont.truetype(str(FONT_DISPLAY), size)
        f.set_variation_by_axes([weight])
        return f
    return ImageFont.truetype(FONT_TEXT, size)


def text_img(txt, size, fill=WHITE, weight=800, display=True, stroke=0, stroke_fill=(0, 0, 0), shadow=True):
    f = font(size, weight, display)
    l, t, r, b = f.getbbox(txt, stroke_width=stroke)
    pad = 24
    im = Image.new("RGBA", (r - l + pad * 2, b - t + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if shadow:
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).text((pad - l, pad - t + 6), txt, font=f, fill=(0, 0, 0, 170), stroke_width=stroke, stroke_fill=(0, 0, 0, 170))
        im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(8)))
    d.text((pad - l, pad - t), txt, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
    return im


def paste_center(canvas, im, cx, cy, scale=1.0, alpha=1.0, rot=0.0):
    if scale <= 0.01 or alpha <= 0.01:
        return
    if scale != 1.0:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.BICUBIC)
    if rot:
        im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
    if alpha < 1:
        im = im.copy(); im.putalpha(im.getchannel("A").point(lambda v: int(v * alpha)))
    canvas.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))


def pill(w, h, fill, radius=None, outline=None, glow=None):
    r = radius if radius is not None else h // 2
    pad = 40 if glow else 0
    im = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    if glow:
        g = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(g).rounded_rectangle([pad, pad, pad + w, pad + h], r, fill=glow + (150,))
        im.alpha_composite(g.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(im)
    if isinstance(fill, tuple) and len(fill) == 2 and isinstance(fill[0], tuple):  # horizontal gradient
        grad = Image.new("RGBA", (w, h))
        a, b = np.array(fill[0], float), np.array(fill[1], float)
        row = (a[None, :] + (b - a)[None, :] * np.linspace(0, 1, w)[:, None]).astype(np.uint8)
        grad = Image.fromarray(np.repeat(np.c_[row, np.full((w, 1), 255, np.uint8)][None], h, 0), "RGBA")
        m = Image.new("L", (w, h), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255)
        im.paste(grad, (pad, pad), m)
    else:
        d.rounded_rectangle([pad, pad, pad + w - 1, pad + h - 1], r, fill=fill)
    if outline:
        d.rounded_rectangle([pad, pad, pad + w - 1, pad + h - 1], r, outline=outline, width=3)
    return im


def badge(txt, size=46, fill=((53, 152, 243), (79, 174, 250)), color=WHITE, padx=40, pady=24, glow=BLUE):
    t = text_img(txt, size, color, 800, shadow=False)
    p = pill(t.width - 48 + padx * 2, t.height - 48 + pady * 2, fill, glow=glow)
    p.alpha_composite(t, ((p.width - t.width) // 2, (p.height - t.height) // 2))
    return p


def wordmark(size=90):
    """'Zyb' white + 'rilka' blue, as in the site header."""
    a = text_img("Zyb", size, WHITE, 800, shadow=False)
    b = text_img("rilka", size, BLUE2, 800, shadow=False)
    im = Image.new("RGBA", (a.width + b.width - 48, max(a.height, b.height)), (0, 0, 0, 0))
    im.alpha_composite(a, (0, 0)); im.alpha_composite(b, (a.width - 48, 0))
    return im


@lru_cache(maxsize=4)
def logo(size):
    return Image.open(LOGO).convert("RGBA").resize((size, size), Image.LANCZOS)


def icon_cross(r=70, color=RED):
    im = Image.new("RGBA", (r * 2 + 40, r * 2 + 40), (0, 0, 0, 0))
    g = Image.new("RGBA", im.size, (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse([20, 20, 20 + 2 * r, 20 + 2 * r], fill=color + (160,))
    im.alpha_composite(g.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(im); d.ellipse([20, 20, 20 + 2 * r, 20 + 2 * r], fill=color)
    k = r * 0.42; c = 20 + r
    d.line([(c - k, c - k), (c + k, c + k)], fill=WHITE, width=int(r * 0.2)); d.line([(c - k, c + k), (c + k, c - k)], fill=WHITE, width=int(r * 0.2))
    return im


def icon_check(r=70, color=GREEN):
    im = icon_cross(r, color)
    d = ImageDraw.Draw(im); c = 20 + r
    d.rectangle([c - r * .6, c - r * .6, c + r * .6, c + r * .6], fill=color)
    d.line([(c - r * .45, c), (c - r * .1, c + r * .35), (c + r * .5, c - r * .35)], fill=WHITE, width=int(r * 0.2), joint="curve")
    return im


# ---------- background ----------
GLYPHS = ["π", "√x", "∑", "x²", "sin", "log", "∫", "≠", "%", "Δ", "f(x)", "∞", "а́", "?", "ЕГЭ"]


class Background:
    def __init__(self, seed=4):
        rng = np.random.default_rng(seed)
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        self.base = []
        for cx, cy in [(0.75, 0.18), (0.25, 0.7)]:
            pass
        r = np.sqrt(((xx - W * 0.7) / W) ** 2 + ((yy - H * 0.22) / H) ** 2)
        r2 = np.sqrt(((xx - W * 0.2) / W) ** 2 + ((yy - H * 0.78) / H) ** 2)
        g = np.clip(1 - r * 1.6, 0, 1)[..., None] * np.array(BG2, np.float32) + np.clip(1 - r2 * 1.9, 0, 1)[..., None] * np.array((10, 30, 70), np.float32)
        arr = np.array(BG, np.float32)[None, None] + g
        # subtle dot grid
        grid = ((xx % 54 < 2.2) & (yy % 54 < 2.2)).astype(np.float32)[..., None] * 18
        self.img = Image.fromarray(np.clip(arr + grid, 0, 255).astype(np.uint8)).convert("RGBA")
        self.glyphs = []
        for i in range(16):
            g = GLYPHS[i % len(GLYPHS)]
            im = text_img(g, int(rng.integers(50, 110)), (120, 170, 255), 600, shadow=False)
            self.glyphs.append(dict(im=im, x=rng.uniform(0, W), y=rng.uniform(0, H), vy=rng.uniform(-30, -12),
                                    a=rng.uniform(0.05, 0.13), ph=rng.uniform(0, 6.28), rot=rng.uniform(-15, 15)))

    def frame(self, t, glyph_alpha=1.0):
        im = self.img.copy()
        if glyph_alpha > 0:
            for g in self.glyphs:
                y = (g["y"] + g["vy"] * t) % (H + 200) - 100
                x = g["x"] + 18 * math.sin(t * 0.6 + g["ph"])
                paste_center(im, g["im"], x, y, 1.0, g["a"] * glyph_alpha, g["rot"])
        return im


# ---------- phone mockup ----------
@lru_cache(maxsize=32)
def screen(path):
    return Image.open(path).convert("RGBA")


def phone(screen_img, width=520, crop_y=0, glow=True):
    """Rounded phone with real screenshot. crop_y scrolls the screenshot (in screenshot px)."""
    sw = width - 28
    sc = sw / screen_img.width
    sh = int(sw * 2.0)
    src_h = int(sh / sc)
    crop = screen_img.crop((0, crop_y, screen_img.width, min(screen_img.height, crop_y + src_h)))
    crop = crop.resize((sw, int(crop.height * sc)), Image.LANCZOS)
    pad = 60
    im = Image.new("RGBA", (width + pad * 2, sh + 28 + pad * 2), (0, 0, 0, 0))
    if glow:
        g = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(g).rounded_rectangle([pad, pad, pad + width, pad + sh + 28], 70, fill=BLUE + (120,))
        im.alpha_composite(g.filter(ImageFilter.GaussianBlur(40)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([pad, pad, pad + width, pad + sh + 28], 66, fill=(18, 20, 30), outline=(70, 80, 110), width=3)
    m = Image.new("L", (sw, sh), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, sw - 1, sh - 1], 54, fill=255)
    scr = Image.new("RGBA", (sw, sh), BG + (255,)); scr.alpha_composite(crop, (0, 0))
    im.paste(scr, (pad + 14, pad + 14), m)
    d.rounded_rectangle([pad + width / 2 - 60, pad + 26, pad + width / 2 + 60, pad + 52], 13, fill=(0, 0, 0))  # island
    return im, sc, (pad + 14, pad + 14)


def content_end(img, nav_px=0, bg_tol=10):
    """Last row (above a fixed bottom nav) that has non-background pixels — for scroll limits of tall shots."""
    a = np.asarray(img.convert("RGB"), np.int16)
    body = a[: a.shape[0] - nav_px] if nav_px else a
    bg = np.median(body[-40:].reshape(-1, 3), axis=0)
    differ = (np.abs(body - bg).max(axis=2) > max(bg_tol, 24)).mean(axis=1)   # share of "content" pixels per row
    rows = np.nonzero(differ > 0.02)[0]
    return int(rows[-1]) + 40 if len(rows) else body.shape[0]


def phone_scroll(screen_img, width, crop_y, nav_px=232):
    """Phone with a tall page scrolled to crop_y while the site's bottom nav stays fixed (like a real phone)."""
    sw = width - 28; sc = sw / screen_img.width; win = int(sw * 2.0 / sc)
    page = screen_img.crop((0, 0, screen_img.width, screen_img.height - nav_px)) if nav_px else screen_img
    view = Image.new("RGBA", (screen_img.width, win), BG + (255,))
    view.alpha_composite(page.crop((0, crop_y, page.width, min(page.height, crop_y + win))).convert("RGBA"), (0, 0))
    if nav_px:
        view.alpha_composite(screen_img.crop((0, screen_img.height - nav_px, screen_img.width, screen_img.height)).convert("RGBA"), (0, win - nav_px))
    return phone(view, width, 0)[0]


def laptop(screen_img, width=980, crop_y=0, glow=True):
    """Laptop mockup for desktop screenshots (2880x1800 -> 16:10 screen); crop_y scrolls a tall desktop shot."""
    sw = width - 40; sh = int(sw * 10 / 16); sc = sw / screen_img.width
    crop = screen_img.crop((0, crop_y, screen_img.width, min(screen_img.height, crop_y + int(sh / sc))))
    crop = crop.resize((sw, int(crop.height * sc)), Image.LANCZOS)
    pad = 60; base_h = int(width * 0.05)
    im = Image.new("RGBA", (width + pad * 2 + 80, sh + 40 + base_h + pad * 2), (0, 0, 0, 0))
    if glow:
        g = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(g).rounded_rectangle([pad + 40, pad, pad + 40 + width, pad + sh + 40], 30, fill=BLUE + (110,))
        im.alpha_composite(g.filter(ImageFilter.GaussianBlur(40)))
    d = ImageDraw.Draw(im); x0 = pad + 40
    d.rounded_rectangle([x0, pad, x0 + width, pad + sh + 40], 26, fill=(18, 20, 30), outline=(70, 80, 110), width=3)
    scr = Image.new("RGBA", (sw, sh), BG + (255,)); scr.alpha_composite(crop.convert("RGBA"), (0, 0))
    m = Image.new("L", (sw, sh), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, sw - 1, sh - 1], 10, fill=255)
    im.paste(scr, (x0 + 20, pad + 20), m)
    d.ellipse([x0 + width / 2 - 4, pad + 7, x0 + width / 2 + 4, pad + 15], fill=(40, 44, 60))
    d.rounded_rectangle([pad, pad + sh + 40, pad + width + 80, pad + sh + 40 + base_h], 14, fill=(52, 58, 78), outline=(90, 100, 130), width=2)
    d.rounded_rectangle([x0 + width / 2 - 70, pad + sh + 40, x0 + width / 2 + 70, pad + sh + 40 + base_h * 0.35], 6, fill=(36, 40, 56))
    return im


def highlight_box(w, h, color=BLUE2, r=26, t=1.0):
    im = Image.new("RGBA", (w + 60, h + 60), (0, 0, 0, 0))
    g = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(g).rounded_rectangle([30, 30, 30 + w, 30 + h], r, outline=color + (int(200 * t),), width=10)
    im.alpha_composite(g.filter(ImageFilter.GaussianBlur(10)))
    ImageDraw.Draw(im).rounded_rectangle([30, 30, 30 + w, 30 + h], r, outline=color + (int(255 * t),), width=5)
    return im


# ---------- audio-driven lip sync ----------
def mouth_track(wav_path, fps=FPS, lead=0.03):
    """Per-frame (open, width) from the voice: RMS -> jaw, spectral centroid -> lip rounding."""
    with wave.open(str(wav_path)) as w:
        sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768
        if w.getnchannels() == 2: x = x[::2]
    n = int(len(x) / sr * fps) + 1
    win = int(sr * 0.045)
    rms = np.zeros(n); cen = np.zeros(n)
    freqs = np.fft.rfftfreq(win, 1 / sr)
    for i in range(n):
        c = int((i / fps + lead) * sr)
        seg = x[max(0, c - win // 2): c + win // 2]
        if len(seg) < win: seg = np.pad(seg, (0, win - len(seg)))
        rms[i] = np.sqrt((seg ** 2).mean())
        sp = np.abs(np.fft.rfft(seg * np.hanning(win)))
        band = (freqs > 200) & (freqs < 4000)
        cen[i] = (sp[band] * freqs[band]).sum() / (sp[band].sum() + 1e-9)
    ref = np.percentile(rms[rms > 0.01], 90) if (rms > 0.01).any() else 1
    o = np.clip((rms / ref - 0.1) / 0.85, 0, 1) ** 0.85
    # smoothing: fast attack, slower release, plus a slight jitter break so it is not robotic
    sm = np.zeros(n); v = 0
    for i in range(n):
        v = v + (o[i] - v) * (0.75 if o[i] > v else 0.45); sm[i] = v
    width = np.clip(0.55 + (cen - 700) / 1600, 0.6, 1.0)
    return sm, width


def blink_track(n, fps=FPS, seed=2, every=(2.4, 4.2)):
    rng = np.random.default_rng(seed); b = np.zeros(n); t = rng.uniform(0.8, 1.6)
    shape = [0.45, 1.0, 0.8, 0.3]
    while t * fps < n:
        i = int(t * fps)
        for k, v in enumerate(shape):
            if i + k < n: b[i + k] = v
        t += rng.uniform(*every)
    return b


# ---------- subtitles ----------
def word_times(lines):
    """Spread each line's measured [start,end] over its words, weighted by letters (+ comma pauses)."""
    out = []
    for ln in lines:
        words = ln["text"].split()
        wts = [max(2, sum(ch.isalnum() for ch in w)) + (2 if w[-1] in ",.?!—:" else 0) for w in words]
        tot = sum(wts); t = ln["start"]; span = ln["end"] - ln["start"]
        for w, k in zip(words, wts):
            d = span * k / tot; out.append(dict(w=w, s=t, e=t + d, line=ln["id"])); t += d
    return out


def chunk_words(words, max_chars=18, max_words=3):
    chunks, cur = [], []
    for w in words:
        if cur and (cur[-1]["line"] != w["line"] or len(" ".join(x["w"] for x in cur + [w])) > max_chars or len(cur) >= max_words or cur[-1]["w"][-1] in ".?!"):
            chunks.append(cur); cur = []
        cur.append(w)
    if cur: chunks.append(cur)
    return chunks


def rays_bg(c1, c2, n=18, seed=0):
    """Radial gradient with soft sunburst rays (reference-account style). c1 = centre colour, c2 = edge colour."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cx, cy = W / 2, H * 0.62
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (H * 0.75)
    ang = np.arctan2(yy - cy, xx - cx)
    rays = (np.sin(ang * n) > 0.45).astype(np.float32) * (0.25 + 0.75 * np.clip(r, 0, 1)) * 0.22
    k = np.clip(r * 1.15, 0, 1)[..., None] ** 0.8
    base = np.array(c1, np.float32)[None, None] * (1 - k) + np.array(c2, np.float32)[None, None] * k
    out = base * (1 + rays[..., None])
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert("RGBA")


def polaroid(img, width=620, border=16, rot=-4):
    """Screenshot as a tilted white-framed card with shadow (product insert)."""
    sc = width / img.width; im = img.resize((width, int(img.height * sc)), Image.LANCZOS).convert("RGBA")
    card = Image.new("RGBA", (im.width + border * 2, im.height + border * 2), (255, 255, 255, 255))
    card.alpha_composite(im, (border, border))
    pad = 50; out = Image.new("RGBA", (card.width + pad * 2, card.height + pad * 2), (0, 0, 0, 0))
    sh = Image.new("RGBA", out.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rectangle([pad + 10, pad + 18, pad + card.width + 10, pad + card.height + 18], fill=(0, 0, 0, 170))
    out.alpha_composite(sh.filter(ImageFilter.GaussianBlur(16))); out.alpha_composite(card, (pad, pad))
    return out.rotate(rot, resample=Image.BICUBIC, expand=True)


def draw_headline(canvas, chunks, t, keywords=(), y=300, size=92, max_width=920):
    """Top 'headline' captions: current phrase in big uppercase, white; keywords in yellow (reference style)."""
    ch = next((c for c in chunks if c[0]["s"] - 0.05 <= t < c[-1]["e"] + 0.15), None)
    if not ch:
        return
    words = [w["w"].upper() for w in ch if w["s"] <= t + 0.02] or [ch[0]["w"].upper()]
    f = font(size, 900); space = f.getlength(" ")
    total = sum(f.getlength(w) for w in words) + space * (len(words) - 1)
    layer = Image.new("RGBA", (int(total) + 120, size + 120), (0, 0, 0, 0)); d = ImageDraw.Draw(layer); x = 60
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
    for w in words:
        key = w.strip(",.?!—:").lower() in keywords
        sd.text((x, 68), w, font=f, fill=(0, 0, 0, 200))
        d.text((x, 60), w, font=f, fill=(YELLOW if key else WHITE) + (255,), stroke_width=6, stroke_fill=(10, 10, 20, 255))
        x += f.getlength(w) + space
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0)); out.alpha_composite(sh.filter(ImageFilter.GaussianBlur(6))); out.alpha_composite(layer)
    sc = min(1.0, max_width / out.width) * (0.9 + 0.1 * back_out(prog(t, ch[0]["s"] - 0.05, 0.14)))
    paste_center(canvas, out, W / 2, y, sc)


def draw_subtitle(canvas, chunks, t, y=1330, keywords=(), size=60):
    ch = next((c for c in chunks if c[0]["s"] - 0.05 <= t < c[-1]["e"] + 0.12), None)
    if not ch:
        return
    f = font(size, 800)
    parts = []
    for w in ch:
        active = w["s"] <= t
        key = w["w"].strip(",.?!—:").lower() in keywords
        col = (YELLOW if key else WHITE) if active else (255, 255, 255)
        a = 255 if active else 150
        parts.append((w["w"], col + (a,), key and active))
    space = f.getlength(" ")
    total = sum(f.getlength(p[0]) for p in parts) + space * (len(parts) - 1)
    pop = back_out(prog(t, ch[0]["s"] - 0.05, 0.16))
    layer = Image.new("RGBA", (int(total) + 80, size + 80), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer); x = 40
    for word, col, key in parts:
        d.text((x, 30), word, font=f, fill=col, stroke_width=9, stroke_fill=(5, 7, 15, 255))
        x += f.getlength(word) + space
    sc = 0.86 + 0.14 * pop
    paste_center(canvas, layer, W / 2 - 30, y, sc)


# ---------- encode ----------
class Encoder:
    def __init__(self, path, fps=FPS):
        self.p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                                   "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "17",
                                   "-pix_fmt", "yuv420p", str(path)], stdin=subprocess.PIPE)

    def write(self, im):
        self.p.stdin.write(im.convert("RGB").tobytes())

    def close(self):
        self.p.stdin.close(); self.p.wait()
