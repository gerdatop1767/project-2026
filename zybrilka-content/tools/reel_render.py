#!/usr/bin/env python3
"""App-only reels (no mascot): the real zybrilka.ru mobile site in a phone + bold on-screen captions + music (+ optional voice).

  node tools/reel_capture.cjs <reel_dir>          # records frames from the live site (reel.json → frames/)
  python3 tools/reel_render.py <reel_dir>         # → <reel_dir>/final/<slug>.mp4  (+ qa/report.json)
  python3 tools/reel_render.py <reel_dir> --preview 0.5 4 9   # PNG stills to qa/preview_*.png

reel.json
{
  "slug": "007-app-nn-game", "title": "Н и НН за 10 секунд",
  "voice": false,                         # true → each clip's "line" is voiced with the fixed Fish voice (VOICE.md)
  "palette": 0,                           # 0..5 background colour scheme
  "music_seed": 3, "bpm": 124,            # music is synthesized (royalty-free by construction)
  "clips": [
    {"actions": [...see reel_capture.cjs...],
     "caption": "Н или НН? *10 секунд* на слово",   # big top text, *word* = yellow highlight, \n = line break
     "sub": "мини-игра по заданию 15",             # optional small pill under the caption
     "line": "Не помнишь, где Н, а где НН?"},      # voice text (only when "voice": true)
    ...
  ],
  "outro": {"caption": "Всё *бесплатно*", "sub": "Пиши в Telegram: @Zybrilka_bot", "sec": 2.4},
  "telegram": {"header": "...", "tiktok_description": "...", "details": "..."}
}
A clip lasts as long as its recorded actions, or longer if its voice line needs it (last frame is held).
"""
import argparse, json, math, re, subprocess, sys, wave
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import studio as S  # noqa: E402
import audio_fx  # noqa: E402

W, H, FPS = 1080, 1920, 30
YELLOW = (255, 214, 64)
PALETTES = [((37, 99, 235), (14, 22, 60)), ((124, 58, 237), (24, 14, 58)), ((5, 150, 105), (8, 40, 38)),
            ((234, 88, 12), (58, 20, 10)), ((219, 39, 119), (52, 10, 36)), ((14, 165, 233), (8, 30, 56))]
PHONE_W, PHONE_TOP, CAP_Y = 700, 520, 140


# ---------------- graphics ----------------
@lru_cache(maxsize=8)
def background(pal):
    c1, c2 = PALETTES[pal % len(PALETTES)]
    big = S.rays_bg(c1, c2).convert("RGB").resize((int(W * 1.15), int(H * 1.15)), Image.LANCZOS)
    v = Image.new("L", big.size, 0)                       # vignette for depth
    ImageDraw.Draw(v).ellipse([-big.width * .3, -big.height * .2, big.width * 1.3, big.height * 1.1], fill=255)
    dark = Image.new("RGB", big.size, tuple(int(c * .5) for c in c2))
    return Image.composite(big, dark, v.filter(ImageFilter.GaussianBlur(220)))


def bg_frame(pal, t):
    big = background(pal); k = (math.sin(t * 0.35) + 1) / 2
    x = int((big.width - W) * (0.3 + 0.4 * k)); y = int((big.height - H) * (0.5 + 0.3 * math.cos(t * 0.27)))
    return big.crop((x, y, x + W, y + H)).convert("RGBA")


def parse_markup(text):
    """'Н или НН? *10 секунд*' → [[(word, highlighted), ...] per line]"""
    out = []
    for line in text.split("\n"):
        words, hl = [], False
        for tok in re.split(r"(\*)", line):
            if tok == "*": hl = not hl; continue
            words += [(w, hl) for w in tok.split()]
        out.append(words)
    return out


def wrap(lines, size, max_w):
    f = S.font(size); res = []
    for words in lines:
        cur, cw = [], 0
        for w, hl in words:
            ww = f.getlength(w + " ")
            if cur and cw + ww > max_w: res.append(cur); cur, cw = [], 0
            cur.append((w, hl)); cw += ww
        if cur: res.append(cur)
    return res


@lru_cache(maxsize=64)
def caption_img(text, size=86, max_w=960):
    for sz in (size, size - 8, size - 16, size - 24):
        rows = wrap(parse_markup(text.upper()), sz, max_w)
        if len(rows) <= 3: break
    f = S.font(sz); lh = int(sz * 1.12); pad = 30
    im = Image.new("RGBA", (W, lh * len(rows) + pad * 2), (0, 0, 0, 0))
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0)); ds = ImageDraw.Draw(sh); d = ImageDraw.Draw(im)
    for i, row in enumerate(rows):
        txt = " ".join(w for w, _ in row); x = (W - f.getlength(txt)) / 2; y = pad + i * lh
        for w, hl in row:
            ds.text((x + 4, y + 7), w, font=f, fill=(0, 0, 0, 170))
            d.text((x, y), w, font=f, fill=YELLOW if hl else S.WHITE, stroke_width=max(4, sz // 14), stroke_fill=(10, 12, 24))
            x += f.getlength(w + " ")
    out = sh.filter(ImageFilter.GaussianBlur(6)); out.alpha_composite(im)
    return out


@lru_cache(maxsize=32)
def sub_img(text):
    return S.badge(text, size=44, fill=((255, 255, 255), (230, 236, 255)), color=(20, 24, 40), padx=34, pady=18, glow=None)


@lru_cache(maxsize=400)
def phone_img(path):
    im, sc, off = S.phone(Image.open(path).convert("RGBA"), PHONE_W)
    return im, sc, off


def paste_scaled(canvas, im, cx, top, scale=1.0, alpha=1.0):
    if scale != 1.0:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.BILINEAR)
    if alpha < 1.0:
        a = im.getchannel("A").point(lambda v: int(v * alpha)); im = im.copy(); im.putalpha(a)
    canvas.alpha_composite(im, (int(cx - im.width / 2), int(top)))
    return im.width, im.height


def draw_tap(canvas, x, y, k):
    """k 0→1 during the press: ring shrinks onto the point, then a ripple."""
    d = ImageDraw.Draw(canvas)
    r = 46 - 18 * min(1, k * 2); a = int(230 * min(1, k * 3))
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a // 3), outline=(255, 255, 255, a), width=6)
    if k > 0.5:
        rr = 30 + 70 * (k - 0.5) * 2; aa = int(200 * (1 - (k - 0.5) * 2))
        d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=(255, 255, 255, aa), width=5)


# ---------------- timeline ----------------
class Reel:
    def __init__(self, rd):
        self.rd = Path(rd); self.spec = json.loads((self.rd / "reel.json").read_text())
        self.tl = json.loads((self.rd / "frames/timeline.json").read_text())
        self.voice = bool(self.spec.get("voice")); self.lines = {}
        if self.voice: self.make_voice()
        self.build()

    def make_voice(self):
        vo = json.loads((S.ROOT / "character/voice/VOICE.md").read_text().split("```json")[1].split("```")[0]) \
            if "```json" in (S.ROOT / "character/voice/VOICE.md").read_text() else None
        fish = vo if vo and "reference_id" in vo else {"reference_id": "2376703359f149a791466ec08f794481", "model": "s2.1-pro-free", "speed": 1.0}
        lines = [{"id": f"c{i + 1}", "text": c["line"], "pause_after": 0.0} for i, c in enumerate(self.spec["clips"]) if c.get("line")]
        (self.rd / "voiceover.json").write_text(json.dumps({"fish": fish, "lead_in": 0.0, "lines": lines}, ensure_ascii=False, indent=1))
        subprocess.run([sys.executable, str(Path(__file__).parent / "tts_fish.py"), str(self.rd)], check=True)
        lj = json.loads((self.rd / "audio/lines.json").read_text())
        self.lines = {l["id"]: (l["start"], l["end"]) for l in lj["lines"]}

    def build(self):
        """Flatten clips into per-output-frame records."""
        self.frames = []; self.clip_starts = []; self.taps = []; self.vo_places = []
        for ci, clip in enumerate(self.tl["clips"]):
            start = len(self.frames); self.clip_starts.append(start / FPS)
            for f, n, tap in clip["frames"]:
                for k in range(n):
                    self.frames.append((ci, f, (tap, k / max(1, n - 1)) if tap else None))
                if tap: self.taps.append((start + len(self.frames) - start - n) / FPS)
            lid = f"c{ci + 1}"
            if lid in self.lines:
                a, b = self.lines[lid]; need = int((b - a + 0.35) * FPS)
                self.vo_places.append((lid, start / FPS + 0.12))
                while len(self.frames) - start < need + 4:
                    self.frames.append((ci, self.frames[-1][1], None))
        self.outro_start = len(self.frames) / FPS
        o = self.spec.get("outro") or {}
        self.outro_sec = float(o.get("sec", 2.4)) if o else 0
        self.dur = self.outro_start + self.outro_sec

    def render_frame(self, i):
        t = i / FPS; spec = self.spec; pal = spec.get("palette", 0)
        if t >= self.outro_start: return self.render_outro(t - self.outro_start)
        ci, f, tap = self.frames[i]; clip = spec["clips"][ci]; ct = t - self.clip_starts[ci]
        cv = bg_frame(pal + (ci % 2) * (1 if spec.get("alt_palette", True) else 0), t)
        ph, sc, off = phone_img(str(self.rd / "frames" / f))
        enter = S.ease_out(S.clamp(t / 0.55)); punch = 1 + 0.035 * math.exp(-ct * 9) if ci else 1.0
        top = PHONE_TOP + (1 - enter) * 900
        scale = punch * 1.0
        pw, phh = paste_scaled(cv, ph, W / 2, top - (ph.height * (scale - 1)) / 2, scale)
        if tap:
            (px, py), k = tap
            x = W / 2 - pw / 2 + (off[0] + px * sc) * scale; y = top - (ph.height * (scale - 1)) / 2 + (off[1] + py * sc) * scale
            draw_tap(cv, x, y, k)
        cap = clip.get("caption")
        if cap:
            ci_img = caption_img(cap); k = S.back_out(S.clamp(ct / 0.32))
            paste_scaled(cv, ci_img, W / 2, CAP_Y + (1 - k) * 30, 0.6 + 0.4 * k, S.clamp(ct / 0.15))
            if clip.get("sub"):
                si = sub_img(clip["sub"]); k2 = S.ease_out(S.clamp((ct - 0.25) / 0.3))
                if k2 > 0: paste_scaled(cv, si, W / 2, CAP_Y + ci_img.height - 6 + (1 - k2) * 20, 1.0, k2)
        if ci and ct < 0.1:  # flash cut
            fl = Image.new("RGBA", (W, H), (255, 255, 255, int(150 * (1 - ct / 0.1)))); cv.alpha_composite(fl)
        return cv

    def render_outro(self, ot):
        o = self.spec["outro"]; pal = self.spec.get("palette", 0)
        cv = bg_frame(pal, self.outro_start + ot)
        wm = S.wordmark(150); k = S.back_out(S.clamp(ot / 0.4))
        paste_scaled(cv, wm, W / 2, 640 + (1 - k) * 60, 0.5 + 0.5 * k, S.clamp(ot / 0.2))
        ci = caption_img(o.get("caption", "Всё *бесплатно*")); k2 = S.back_out(S.clamp((ot - 0.25) / 0.35))
        if k2 > 0: paste_scaled(cv, ci, W / 2, 860, 0.6 + 0.4 * k2, S.clamp((ot - 0.25) / 0.15))
        b = S.badge(o.get("sub", "Пиши в Telegram: @Zybrilka_bot"), size=50); k3 = S.ease_out(S.clamp((ot - 0.6) / 0.35))
        if k3 > 0: paste_scaled(cv, b, W / 2, 870 + ci.height + (1 - k3) * 30, 1.0, k3)
        return cv

    # ---------------- audio ----------------
    def audio(self, silent, out):
        ad = self.rd / "audio"; ad.mkdir(exist_ok=True)
        m = audio_fx.music(self.dur + 0.5, bpm=self.spec.get("bpm", 122), seed=self.spec.get("music_seed", 1))
        audio_fx.write(ad / "music.wav", m)
        sfx_dir = ad / "sfx"
        if not (sfx_dir / "whoosh.wav").exists(): sfx_dir.mkdir(exist_ok=True); audio_fx.sfx(sfx_dir)
        events = [("whoosh", s - 0.08) for s in self.clip_starts[1:]] + [("click", t + 0.35) for t in self.taps] + [("ding", self.outro_start + 0.25)]
        inputs = ["-i", str(silent), "-i", str(ad / "music.wav")]; fl = []; labs = []
        mv = 0.16 if self.voice else 0.55
        fl.append(f"[1:a]volume={mv},atrim=0:{self.dur:.2f},afade=t=out:st={self.dur - 0.8:.2f}:d=0.8[mus]")
        idx = 2
        for name, at in events:
            inputs += ["-i", str(sfx_dir / f"{name}.wav")]; d = int(max(0, at) * 1000)
            fl.append(f"[{idx}:a]volume={0.5 if name != 'click' else 0.35},adelay={d}|{d}[e{idx}]"); labs.append(f"[e{idx}]"); idx += 1
        if self.voice:
            vo = ad / "voiceover.wav"; parts = []
            for lid, at in self.vo_places:
                a, b = self.lines[lid]; d = int(at * 1000)
                inputs += ["-i", str(vo)]
                fl.append(f"[{idx}:a]atrim={a:.3f}:{b + 0.05:.3f},asetpts=PTS-STARTPTS,adelay={d}|{d}[v{idx}]"); parts.append(f"[v{idx}]"); idx += 1
            fl.append(f"{''.join(parts)}amix=inputs={len(parts)}:normalize=0,apad[vo]")
            fl.append("[vo]asplit[vo1][vo2]")
            fl.append("[mus][vo1]sidechaincompress=threshold=0.04:ratio=6:attack=15:release=300[duck]")
            mixin = "[duck][vo2]" + "".join(labs); n = 2 + len(labs)
        else:
            mixin = "[mus]" + "".join(labs); n = 1 + len(labs)
        fl.append(f"{mixin}amix=inputs={n}:normalize=0:duration=first,alimiter=limit=0.89,loudnorm=I=-14:TP=-1.5:LRA=9[a]")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(fl), "-map", "0:v", "-map", "[a]",
                        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{self.dur:.2f}", str(out)], check=True)

    def render(self):
        fin = self.rd / "final"; fin.mkdir(exist_ok=True)
        silent = fin / "_silent.mp4"; enc = S.Encoder(silent, FPS)
        for i in range(int(self.dur * FPS)): enc.write(self.render_frame(i))
        enc.close()
        out = fin / f"{self.spec.get('slug', self.rd.name)}.mp4"; self.audio(silent, out); silent.unlink()
        return out


def qa(path, rd):
    pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                                   capture_output=True, text=True).stdout)
    v = next(s for s in pr["streams"] if s["codec_type"] == "video"); dur = float(pr["format"]["duration"])
    ln = subprocess.run(["ffmpeg", "-i", str(path), "-af", "loudnorm=print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
    lufs = float(json.loads(ln[ln.rindex("{"):ln.rindex("}") + 1])["input_i"])
    checks = {"size_1080x1920": (v["width"], v["height"]) == (1080, 1920), "duration_8_30s": 8 <= dur <= 30,
              "loudness_-15..-13": -15.5 <= lufs <= -12.5, "has_audio": any(s["codec_type"] == "audio" for s in pr["streams"])}
    rep = {"passed": all(checks.values()), "checks": checks, "duration": round(dur, 2), "lufs": lufs}
    (rd / "qa").mkdir(exist_ok=True); (rd / "qa/report.json").write_text(json.dumps(rep, indent=1))
    # contact sheet: 8 frames for the reviewer
    n = 8; shots = []
    for k in range(n):
        f = rd / f"qa/_c{k}.png"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{dur * (k + .5) / n:.2f}", "-i", str(path), "-frames:v", "1", "-vf", "scale=270:480", str(f)])
        shots.append(Image.open(f)); f.unlink()
    sheet = Image.new("RGB", (270 * 4, 480 * 2))
    for k, im in enumerate(shots): sheet.paste(im, ((k % 4) * 270, (k // 4) * 480))
    sheet.save(rd / "qa/contact.png")
    return rep


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("reel_dir"); ap.add_argument("--preview", nargs="*", type=float)
    a = ap.parse_args(); r = Reel(a.reel_dir)
    if a.preview is not None:
        (r.rd / "qa").mkdir(exist_ok=True)
        for t in a.preview or [0.6, r.dur / 2, r.dur - 1]:
            r.render_frame(min(int(t * FPS), int(r.dur * FPS) - 1)).convert("RGB").save(r.rd / f"qa/preview_{t:.1f}.png"); print("preview", t)
    else:
        out = r.render(); print("final:", out, json.dumps(qa(out, r.rd), ensure_ascii=False))
