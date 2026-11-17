#!/usr/bin/env python3
"""Data-driven renderer: <video_dir>/storyboard.json + audio/{voiceover.wav,voiceover_raw.wav,lines.json,words.json}
-> final/<slug>.mp4 (+ subtitles/<slug>.srt). Agents write the storyboard, never Python.

python3 render.py <video_dir> [--preview 1.5,8,20]   # stills to render/preview_*.png
python3 render.py <video_dir> --check                 # validate storyboard only

Storyboard schema (all times are word references resolved from audio/words.json):
{
  "slug": "002-udareniya",
  "music": "zybrilka-theme-a", "music_volume": 0.2,
  "keywords": ["егэ", "ударение"],                 # highlighted yellow in captions
  "scenes": [{
     "lines": ["hook"],                              # voiceover line ids covered by this scene (first = scene start)
     "bison": "closeup|full|corner|corner_right|hidden",
     "background": "glyphs|plain",
     "phone": {"screens": [{"screen": "home"}, {"screen": "home_scrolled", "at": "математике"}], "x": 620, "crop": {"t1_condition": 420}},
     "items": [
        {"type": "text", "text": "ЕГЭ", "size": 120, "color": "white|yellow|red|blue|green|muted|#rrggbb", "weight": 900,
         "x": 400, "y": 250, "at": "ЕГЭ", "until": "так", "rot": 0, "shake": false, "sfx": "pop"},
        {"type": "badge", "text": "БЕСПЛАТНО", "size": 50, "style": "blue|dark|green|red", ...},
        {"type": "icon", "icon": "check|cross", "r": 70, ...},
        {"type": "logo", "size": 170, ...}, {"type": "wordmark", "size": 96, ...},
        {"type": "counter", "to": 3064, "size": 92, "duration": 1.4, ...},
        {"type": "callout", "screen": "t3_checked", "box": [x0, y0, x1, y1], "width": 600, ...},
        {"type": "card", "title": "Задание 4", "lines": ["звони́т", "договор"], "width": 760, "size": 46, ...},
        {"type": "image", "path": "character/poses/bison-desk-night.webp", "width": 900, ...}
     ]}],
  "sfx": [{"kind": "whoosh", "at": "@scene:2", "offset": -0.15}]   # extra sounds; items may carry "sfx" too
}
Word reference: "слово" (first match), "слово#2" (2nd), "слово@lineid", "@line:hook" (line start),
"@line_end:hook", "@scene:N" (scene N start), number = absolute seconds. Optional "offset" on items: "at_offset".
"""
import json, math, re, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import studio as S
import bison_rig, lipsync
from studio import W, H, FPS, prog, ease_out, ease_in_out, back_out, paste_center

COLORS = {"white": S.WHITE, "yellow": S.YELLOW, "red": S.RED, "blue": S.BLUE2, "green": S.GREEN, "muted": S.MUTED, "cyan": S.CYAN}
BADGE = {"blue": ((53, 152, 243), (79, 174, 250)), "dark": (20, 28, 64), "green": ((40, 170, 120), (64, 214, 140)), "red": ((220, 50, 80), (255, 76, 106))}
FACE = np.array([560, 450]); RIG = np.array([1120, 1344])
LAYOUT = {"closeup": (540, 760, 1.12), "full": (540, 905, 0.76), "corner": (205, 1170, 0.5), "corner_right": (800, 1170, 0.5),
          "hidden": (205, 2600, 0.5)}


def color(c):
    if isinstance(c, str) and c.startswith("#"):
        return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
    return COLORS.get(c, S.WHITE)


class Video:
    def __init__(self, vd):
        self.vd = Path(vd)
        self.sb = json.loads((self.vd / "storyboard.json").read_text())
        L = json.loads((self.vd / "audio/lines.json").read_text())
        self.lines = {l["id"]: l for l in L["lines"]}
        self.words = json.loads((self.vd / "audio/words.json").read_text())
        self.dur = L["duration"] + 0.45
        self.n = int(self.dur * FPS)
        self.scenes = []
        for i, sc in enumerate(self.sb["scenes"]):
            st = 0.0 if i == 0 else self.lines[sc["lines"][0]]["start"] - 0.1
            self.scenes.append(dict(sc, start=st, idx=i))
        self.slug = self.sb.get("slug", self.vd.name)
        self.cache = {}

    # ---- time references ----
    def at(self, ref, default=None):
        if ref is None: return default
        if isinstance(ref, (int, float)): return float(ref)
        m = re.match(r"@(line|line_end|scene):(.+)", ref)
        if m:
            k, v = m.groups()
            if k == "scene": return self.scenes[int(v)]["start"]
            return self.lines[v]["start" if k == "line" else "end"]
        word, line, nth = ref, None, 1
        if "@" in word: word, line = word.split("@", 1)
        if "#" in word: word, nth = word.split("#", 1); nth = int(nth)
        key = lipsync.norm(word)
        hits = [w for w in self.words if lipsync.norm(w["w"]) == key and (line is None or w["line"] == line)]
        if len(hits) < nth:
            hits = [w for w in self.words if lipsync.norm(w["w"]).startswith(key) and (line is None or w["line"] == line)]
        if len(hits) < nth:
            raise KeyError(f"word reference not found: {ref!r}")
        return hits[nth - 1]["s"]

    def scene_at(self, t):
        cur = self.scenes[0]
        for s in self.scenes:
            if t >= s["start"]: cur = s
        return cur

    # ---- assets ----
    def screen(self, name):
        return S.screen(self.vd / "source/screens" / f"{name}.png")

    def asset(self, it):
        key = json.dumps(it, sort_keys=True, ensure_ascii=False)
        if key in self.cache: return self.cache[key]
        t = it["type"]
        if t == "text":
            im = S.text_img(it["text"], it.get("size", 80), color(it.get("color", "white")), it.get("weight", 900))
        elif t == "badge":
            st = it.get("style", "blue"); fill = BADGE[st]
            im = S.badge(it["text"], it.get("size", 46), fill=fill, glow=None if st == "dark" else (S.GREEN if st == "green" else S.BLUE),
                         padx=28 if st == "dark" else 40, pady=18 if st == "dark" else 24)
        elif t == "icon":
            im = (S.icon_check if it.get("icon") == "check" else S.icon_cross)(it.get("r", 70))
        elif t == "logo":
            im = S.logo(it.get("size", 150))
        elif t == "wordmark":
            im = S.wordmark(it.get("size", 96))
        elif t == "callout":
            im = callout(self.screen(it["screen"]), it["box"], it.get("width", 600))
        elif t == "card":
            im = card(it.get("title", ""), it.get("lines", []), it.get("width", 760), it.get("size", 46), it.get("highlight"))
        elif t == "image":
            p = S.ROOT / it["path"]
            im = Image.open(p).convert("RGBA"); w = it.get("width", 900)
            im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
        else:
            raise ValueError(f"unknown item type {t}")
        self.cache[key] = im
        return im

    def check(self):
        errs = []
        for s in self.scenes:
            for lid in s["lines"]:
                if lid not in self.lines: errs.append(f"scene {s['idx']}: unknown line {lid}")
            if s.get("bison", "full") not in LAYOUT: errs.append(f"scene {s['idx']}: bison layout {s.get('bison')}")
            for it in s.get("items", []):
                for k in ("at", "until"):
                    try: self.at(it.get(k))
                    except KeyError as e: errs.append(f"scene {s['idx']} item {it.get('text', it['type'])}: {e}")
                try:
                    if it['type'] != 'counter': self.asset(it)
                except Exception as e: errs.append(f"scene {s['idx']} item {it['type']}: {e}")
                x, y = it.get("x", 540), it.get("y", 600)
                if it["type"] in ("text", "badge", "counter") and not (S.SAFE[1] <= y <= S.SAFE[3]):
                    errs.append(f"scene {s['idx']} '{it.get('text', it['type'])}' y={y} outside safe zone 150..1440")
            for sc in (s.get("phone") or {}).get("screens", []):
                if not (self.vd / "source/screens" / f"{sc['screen']}.png").exists(): errs.append(f"missing screen {sc['screen']}.png")
        for e in self.sb.get("sfx", []):
            try: self.at(e["at"])
            except KeyError as ex: errs.append(f"sfx: {ex}")
        return errs

    # ---- render ----
    def prepare(self):
        self.bg = S.Background()
        self.mouth_o, self.mouth_w = lipsync.mouth_track(self.vd / "audio/voiceover_raw.wav", self.words)
        self.blinks = S.blink_track(self.n + 10)
        self.energy = np.convolve(np.r_[self.mouth_o, np.zeros(12)], np.ones(9) / 9, mode="same")
        self.chunks = S.chunk_words([dict(w) for w in self.words])
        self.keywords = {k.lower() for k in self.sb.get("keywords", [])}

    def layout(self, t):
        s = self.scene_at(t); cur = np.array(LAYOUT[s.get("bison", "full")], float)
        if s["idx"] > 0:
            prev = np.array(LAYOUT[self.scenes[s["idx"] - 1].get("bison", "full")], float)
            cur = prev + (cur - prev) * ease_in_out(prog(t - s["start"], 0, 0.38))
        return cur

    def frame(self, i):
        t = i / FPS; s = self.scene_at(t); lt = t - s["start"]
        c = self.bg.frame(t, glyph_alpha=0.0 if s.get("background") == "plain" else (0.6 if s.get("phone") else 1.0))
        if s.get("phone"): self.draw_phone(c, t, s, lt)
        for it in s.get("items", []):
            if it.get("layer") == "back": self.draw_item(c, t, it)
        if s.get("bison", "full") != "hidden" or s["idx"] > 0:
            self.draw_bison(c, t, i, s, lt)
        for it in s.get("items", []):
            if it.get("layer") != "back": self.draw_item(c, t, it)
        if lt < 0.12 and s["idx"] > 0:
            c.alpha_composite(Image.new("RGBA", (W, H), (255, 255, 255, int(70 * (1 - lt / 0.12)))))
        S.draw_subtitle(c, self.chunks, t, y=1340, keywords=self.keywords)
        return c

    def draw_bison(self, c, t, i, s, lt):
        fx, fy, sc = self.layout(t)
        k = min(i, len(self.mouth_o) - 1)
        rig = bison_rig.render(self.mouth_o[k], self.mouth_w[k], self.blinks[i])
        rot = 1.4 * math.sin(t * 1.1) + 2.6 * (self.energy[k] - 0.3)
        punch = 1 + (0.12 if s.get("bison") == "closeup" else 0.05) * (1 - ease_out(prog(lt, 0, 0.35))) if s["idx"] == 0 or s.get("bison") in ("closeup", "full") else 1
        sca = sc * (1 + 0.008 * math.sin(t * 2.2)) * punch
        bob = -9 * self.energy[k] * (sc / 0.8)
        paste_center(c, rig, fx + (RIG[0] / 2 - FACE[0]) * sca, fy + (RIG[1] / 2 - FACE[1]) * sca + bob, sca, 1.0, rot)

    def draw_phone(self, c, t, s, lt):
        ph = s["phone"]; scr = ph["screens"][0]["screen"]
        for e in ph["screens"][1:]:
            if t >= self.at(e.get("at")) - 0.1: scr = e["screen"]
        prev_phone = s["idx"] > 0 and self.scenes[s["idx"] - 1].get("phone")
        slide = 1.0 if prev_phone else ease_out(prog(lt, 0, 0.45))
        crop = ph.get("crop", {}).get(scr, 0); width = ph.get("width", 500)
        key = ("phone", scr, crop, width)
        if key not in self.cache: self.cache[key] = S.phone(self.screen(scr), width, crop)[0]
        im = self.cache[key]
        paste_center(c, im, ph.get("x", 620) + (1 - slide) * 700, 160 + im.height / 2 - 60)

    def draw_item(self, c, t, it):
        start = self.at(it.get("at"), 0.0) + it.get("at_offset", -0.05)
        end = self.at(it.get("until")) + it.get("until_offset", -0.05) if it.get("until") else None
        if t < start or (end is not None and t > end + 0.2): return
        x, y = it.get("x", 540), it.get("y", 600)
        if it["type"] == "counter":
            v = int(it["to"] * ease_out(prog(t, start, it.get("duration", 1.4))))
            im = S.text_img(f"{v:,}".replace(",", " "), it.get("size", 92), color(it.get("color", "white")), 900)
        else:
            im = self.asset(it)
        k = back_out(prog(t, start, 0.28)); a = min(1.0, prog(t, start, 0.12))
        if end is not None and t > end: a *= 1 - prog(t, end, 0.2)
        if it.get("shake"): x += 8 * math.sin(t * 60) * (1 - prog(t, start, 0.35))
        base = it.get("scale", 1.0)
        if it.get("pulse"): base *= 1 + 0.04 * math.sin(max(0, t - start) * 7)
        paste_center(c, im, x, y, base * (0.6 + 0.4 * k), a, it.get("rot", 0))

    def sfx_events(self):
        ev = []
        for sc in self.scenes[1:]:
            ev.append(("whoosh", sc["start"] - 0.15))
        for sc in self.scenes:
            for it in sc.get("items", []):
                if it.get("sfx"): ev.append((it["sfx"], self.at(it.get("at"), 0.0) + it.get("at_offset", -0.05)))
        for e in self.sb.get("sfx", []):
            ev.append((e["kind"], self.at(e["at"]) + e.get("offset", 0)))
        return [(k, max(0, t)) for k, t in ev if t < self.dur]

    def mix(self, silent, out):
        FX = S.ROOT / "audio/effects"; ev = self.sfx_events()
        music = S.ROOT / f"audio/music/{self.sb.get('music', 'zybrilka-theme-a')}.wav"
        inputs = ["-i", str(silent), "-i", str(self.vd / "audio/voiceover.wav"), "-i", str(music)]
        for k, _ in ev: inputs += ["-i", str(FX / f"{k}.wav")]
        vol = {"pop": 0.35, "buzz": 0.3, "whoosh": 0.35, "ding": 0.3, "click": 0.5, "riser": 0.3}
        fl = [f"[2:a]volume={self.sb.get('music_volume', 0.2)},atrim=0:{self.dur:.2f}[mus]",
              "[mus][1:a]sidechaincompress=threshold=0.04:ratio=6:attack=15:release=300[duck]"]
        lab = []
        for j, (k, tt) in enumerate(ev):
            d = int(tt * 1000); fl.append(f"[{3 + j}:a]volume={vol.get(k, 0.3)},adelay={d}|{d}[s{j}]"); lab.append(f"[s{j}]")
        fl += ["[1:a]apad[vo]", f"[duck][vo]{''.join(lab)}amix=inputs={2 + len(lab)}:normalize=0:duration=first,alimiter=limit=0.89,loudnorm=I=-14:TP=-1.5:LRA=9[a]"]
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(fl), "-map", "0:v", "-map", "[a]",
                        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{self.dur:.2f}", "-movflags", "+faststart", str(out)], check=True)

    def srt(self, path):
        def ts(x):
            ms = int(round(x * 1000)); return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"
        Path(path).write_text("\n".join(f"{i}\n{ts(c[0]['s'])} --> {ts(c[-1]['e'])}\n{' '.join(w['w'] for w in c)}\n" for i, c in enumerate(self.chunks, 1)))


def callout(src, box, width):
    im = src.crop(tuple(box)); sc = width / im.width
    im = im.resize((width, int(im.height * sc)), Image.LANCZOS)
    m = Image.new("L", im.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, im.width - 1, im.height - 1], 34, fill=255)
    card_ = Image.new("RGBA", (im.width + 80, im.height + 80), (0, 0, 0, 0))
    sh = Image.new("RGBA", card_.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([40, 52, 40 + im.width, 52 + im.height], 34, fill=(0, 0, 0, 200))
    card_.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    card_.paste(im, (40, 40), m)
    card_.alpha_composite(S.highlight_box(im.width, im.height, S.BLUE2, 34), (10, 10))
    return card_


def card(title, lines, width, size, highlight=None):
    """Dark rounded card (task / rule / meme text). highlight = index of a line to color yellow."""
    ft, fb = S.font(int(size * 0.8), 800), S.font(size, 600)
    wrapped = []
    for i, ln in enumerate(lines):
        words, cur = ln.split(), ""
        for w in words:
            if fb.getlength((cur + " " + w).strip()) > width - 80 and cur: wrapped.append((cur, i)); cur = w
            else: cur = (cur + " " + w).strip()
        wrapped.append((cur, i))
    lh = int(size * 1.35); th = int(size * 1.3) if title else 0
    h = 60 + th + lh * len(wrapped)
    im = S.pill(width, h, (16, 22, 52), radius=36, outline=(60, 90, 170), glow=S.BLUE)
    d = ImageDraw.Draw(im); x0, y0 = 40 + 40, 40 + 30
    if title: d.text((x0, y0), title, font=ft, fill=S.BLUE2); y0 += th
    for txt, i in wrapped:
        d.text((x0, y0), txt, font=fb, fill=S.YELLOW if i == highlight else S.WHITE); y0 += lh
    return im


def main():
    vd = sys.argv[1]; v = Video(vd)
    errs = v.check()
    if errs:
        print("STORYBOARD ERRORS:\n" + "\n".join(errs)); sys.exit(2)
    if "--check" in sys.argv: print("storyboard ok"); return
    v.prepare()
    out_dir = v.vd / "render"; out_dir.mkdir(exist_ok=True)
    if "--preview" in sys.argv:
        for x in sys.argv[sys.argv.index("--preview") + 1].split(","):
            v.frame(int(float(x) * FPS)).convert("RGB").save(out_dir / f"preview_{float(x):05.2f}.png")
        return
    (v.vd / "final").mkdir(exist_ok=True); (v.vd / "subtitles").mkdir(exist_ok=True)
    silent = out_dir / "video_silent.mp4"; enc = S.Encoder(silent)
    for i in range(v.n):
        enc.write(v.frame(i))
        if i % 150 == 0: print(f"frame {i}/{v.n}", flush=True)
    enc.close()
    v.srt(v.vd / f"subtitles/{v.slug}.srt")
    out = v.vd / f"final/{v.slug}.mp4"; v.mix(silent, out)
    print("done", out)


if __name__ == "__main__":
    main()
