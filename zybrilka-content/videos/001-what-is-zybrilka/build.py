#!/usr/bin/env python3
"""Video 001 — «Что такое Зубрилка». Renders render/video_silent.mp4, then mixes final/…mp4.

python3 build.py [--preview t1,t2,...]   # preview writes PNG stills instead of the video
"""
import json, math, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "tools"))
import studio as S
from studio import W, H, FPS, prog, ease_out, ease_in_out, back_out, paste_center
import bison_rig

SCR = HERE / "source/screens"
AUD = HERE / "audio"
FX = S.ROOT / "audio/effects"
lines = json.loads((AUD / "lines.json").read_text())
L = {l["id"]: l for l in lines["lines"]}
DUR = lines["duration"] + 0.45
N = int(DUR * FPS)

# ---- words, subtitles ----
words = S.word_times(lines["lines"])
merged = []
for w in words:  # «Зубрилка точка ру» -> one caption token «zybrilka.ru»
    if w["line"] == "cta" and w["w"] in ("точка", "ру"):
        merged[-1]["w"] = "zybrilka.ru"; merged[-1]["e"] = w["e"]; continue
    merged.append(dict(w))
for w in merged:
    if w["w"] == "ру": w["w"] = "zybrilka.ru"
CHUNKS = S.chunk_words(merged)
KEY = {"егэ", "наугад", "зубр", "зубрилка", "бесплатный", "трёх", "тысяч", "сразу", "разбор", "шагам",
       "мини-игра", "теория", "подписок", "zybrilka.ru", "сейчас", "видишь"}


def at(word, line=None, nth=0):
    hits = [w for w in words if w["w"].strip(",.?!—:").lower() == word.lower() and (line is None or w["line"] == line)]
    return hits[nth]["s"]


# ---- scene plan ----
SC = [("hook", 0.0), ("intro", L["intro"]["start"] - 0.08), ("tasks", L["tasks"]["start"] - 0.1),
      ("check", L["check"]["start"] - 0.1), ("explain", L["explain"]["start"] - 0.08), ("modes", L["modes"]["start"] - 0.1),
      ("cta", L["cta"]["start"] - 0.1)]


def scene_at(t):
    cur = SC[0]
    for s in SC:
        if t >= s[1]: cur = s
    return cur[0], t - cur[1], cur[1]


# bison layouts: face position + scale (rig face ~ (560, 450) in a 1120x1344 image)
FACE = np.array([560, 450]); RIG = np.array([1120, 1344])
LAYOUT = {
    "hook": (540, 760, 1.12), "intro": (540, 905, 0.76), "tasks": (205, 1170, 0.5), "check": (205, 1170, 0.5),
    "explain": (205, 1170, 0.5), "modes": (205, 1170, 0.5), "cta": (540, 900, 0.78),
}

mouth_open, mouth_w = S.mouth_track(AUD / "voiceover_raw.wav")
blinks = S.blink_track(N + 10)
energy = np.convolve(np.r_[mouth_open, np.zeros(10)], np.ones(9) / 9, mode="same")


def layout(t):
    name, lt, t0 = scene_at(t)
    names = [s[0] for s in SC]; i = names.index(name)
    cur = np.array(LAYOUT[name], float)
    if i > 0:
        prev = np.array(LAYOUT[names[i - 1]], float)
        k = ease_in_out(prog(lt, 0, 0.38))
        cur = prev + (cur - prev) * k
    return cur


# ---- assets ----
bg = S.Background()
phone_screens = {k: S.screen(SCR / f"{k}.png") for k in
                 ["home", "home_scrolled", "t1_condition", "t2_typed", "t3_checked", "t4_solution", "training", "games", "learning"]}


def callout(name, box, width=640):
    im = phone_screens[name].crop(box)
    sc = width / im.width
    im = im.resize((width, int(im.height * sc)), Image.LANCZOS)
    from PIL import ImageDraw
    m = Image.new("L", im.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, im.width - 1, im.height - 1], 34, fill=255)
    card = Image.new("RGBA", (im.width + 80, im.height + 80), (0, 0, 0, 0))
    glow = S.highlight_box(im.width, im.height, S.BLUE2, 34)
    sh = Image.new("RGBA", card.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([40, 52, 40 + im.width, 52 + im.height], 34, fill=(0, 0, 0, 200))
    from PIL import ImageFilter
    card.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    card.paste(im, (40, 40), m)
    card.alpha_composite(glow, (10, 10))
    return card


CALL = {
    "subjects": callout("home_scrolled", (40, 840, 1130, 1340), 600),
    "wrong": callout("t3_checked", (60, 1330, 1110, 2330), 560),
    "solution": callout("t4_solution", (40, 360, 1130, 1350), 640),
    "modes": callout("training", (40, 700, 1130, 1600), 600),
    "games": callout("games", (40, 540, 1130, 1130), 640),
    "theory": callout("learning", (40, 690, 1130, 960), 640),
}
TXT = {
    "h1": S.text_img("ЕГЭ", 120, S.WHITE, 900),
    "h2": S.text_img("наугад?", 120, S.YELLOW, 900),
    "bad": S.text_img("Так себе план", 84, S.RED, 900),
    "tag": S.text_img("тренажёр для подготовки к ЕГЭ", 40, S.MUTED, 500),
    "free": S.badge("БЕСПЛАТНО", 50),
    "count_lbl": S.text_img("заданий", 44, S.MUTED, 600),
    "math": S.badge("Математика · 678", 34, fill=(20, 28, 64), glow=None, padx=28, pady=18),
    "rus": S.badge("Русский · 2 386", 34, fill=(20, 28, 64), glow=None, padx=28, pady=18),
    "steps": S.badge("Разбор по шагам", 40, fill=((40, 170, 120), (64, 214, 140)), glow=S.GREEN),
    "nosub": S.badge("0 ₽ · без подписок", 46),
    "url": S.badge("zybrilka.ru", 72, padx=60, pady=34),
    "cta_top": S.text_img("Проверь себя", 64, S.WHITE, 900),
    "m_topics": S.badge("Темы", 38, fill=(20, 28, 64), glow=None, padx=28, pady=18),
    "m_var": S.badge("Вариант на время", 38, fill=(20, 28, 64), glow=None, padx=28, pady=18),
    "m_game": S.badge("Ударения", 38, fill=(20, 28, 64), glow=None, padx=28, pady=18),
    "m_theory": S.badge("Теория", 38, fill=(20, 28, 64), glow=None, padx=28, pady=18),
}
WORDMARK = S.wordmark(96)
CROSS, CHECK = S.icon_cross(70), S.icon_check(70)
PHONE_CACHE = {}


def get_phone(name, crop_y=0, width=500):
    k = (name, crop_y, width)
    if k not in PHONE_CACHE:
        PHONE_CACHE[k] = S.phone(phone_screens[name], width, crop_y)[0]
    return PHONE_CACHE[k]


def pop(canvas, im, x, y, t, start, dur=0.28, end=None, rot=0.0, base=1.0):
    if t < start or (end is not None and t > end + 0.2):
        return
    k = back_out(prog(t, start, dur))
    a = min(1, prog(t, start, 0.12) * 1.0)
    if end is not None and t > end:
        a *= 1 - prog(t, end, 0.2)
    paste_center(canvas, im, x, y, base * (0.6 + 0.4 * k), a, rot)


def draw_phone_scene(c, t, name, lt):
    """Phone on the right; screenshot depends on time."""
    slide = ease_out(prog(lt, 0, 0.45)) if name == "tasks" else 1.0
    x = 620 + (1 - slide) * 700
    if name == "tasks":
        scr = "home" if t < at("математике") - 0.2 else "home_scrolled"
    elif name == "check":
        scr = "t1_condition" if t < at("сразу") else ("t2_typed" if t < at("верно") else "t3_checked")
    elif name == "explain":
        scr = "t3_checked" if t < at("страшно") else "t4_solution"
    else:
        scr = "training" if t < at("мини-игра") - 0.1 else ("games" if t < at("теория") - 0.1 else "learning")
    crop = {"t1_condition": 420, "t3_checked": 330}.get(scr, 0)
    ph = get_phone(scr, crop)
    paste_center(c, ph, x, 160 + ph.height / 2 - 60)


def frame(i):
    t = i / FPS
    name, lt, t0 = scene_at(t)
    c = bg.frame(t, glyph_alpha=1.0 if name in ("hook", "intro", "cta") else 0.6)

    # ---------- scene layers behind the bison ----------
    if name in ("tasks", "check", "explain", "modes"):
        draw_phone_scene(c, t, name, lt)

    # ---------- bison ----------
    fx, fy, sc = layout(t)
    k = min(i, len(mouth_open) - 1)
    rig = bison_rig.render(mouth_open[k], mouth_w[k], blinks[i])
    rot = 1.6 * math.sin(t * 1.15) + 3.0 * (energy[k] - 0.3)
    breathe = 1 + 0.008 * math.sin(t * 2.2)
    punch = 1.0
    if name == "hook": punch = 1 + 0.12 * (1 - ease_out(prog(lt, 0, 0.35)))
    if name == "cta": punch = 1 + 0.05 * (1 - ease_out(prog(lt, 0.25, 0.4)))
    s = sc * breathe * punch
    bob = -10 * energy[k] * (sc / 0.8)
    cx = fx + (RIG[0] / 2 - FACE[0]) * s
    cy = fy + (RIG[1] / 2 - FACE[1]) * s + bob
    paste_center(c, rig, cx, cy, s, 1.0, rot)

    # ---------- scene layers in front ----------
    if name == "hook":
        pop(c, TXT["h1"], 400, 250, t, at("ЕГЭ", "hook") - 0.15, end=at("так") - 0.05)
        pop(c, TXT["h2"], 520, 385, t, at("наугад") - 0.1, end=at("так") - 0.05)
        pop(c, CROSS, 800, 240, t, at("ошибся", "hook") - 0.05, end=at("так") - 0.05)
        if t >= at("так") - 0.05:
            shake = 8 * math.sin(t * 60) * (1 - prog(t, at("так"), 0.3))
            pop(c, TXT["bad"], 520 + shake, 330, t, at("так") - 0.05, rot=-4)
    elif name == "intro":
        ts = at("это", "intro")
        pop(c, S.logo(170), 220, 290, t, ts - 0.1)
        pop(c, WORDMARK, 590, 290, t, ts)
        pop(c, TXT["tag"], 540, 420, t, at("тренажёр"))
        pop(c, TXT["free"], 540, 520, t, at("бесплатный") - 0.05, rot=-3)
    elif name == "tasks":
        ts = at("больше")
        if t >= ts:
            v = int(3064 * ease_out(prog(t, ts, 1.4)))
            num = S.text_img(f"{v:,}".replace(",", " "), 92, S.WHITE, 900)
            paste_center(c, num, 230, 300, 0.75 + 0.25 * back_out(prog(t, ts, 0.3)), min(1, prog(t, ts, 0.1)))
            pop(c, TXT["count_lbl"], 210, 385, t, ts + 0.2)
        pop(c, TXT["math"], 230, 500, t, at("математике"), rot=-2)
        pop(c, TXT["rus"], 230, 600, t, at("русскому"), rot=2)
        pop(c, CALL["subjects"], 610, 760, t, at("математике") + 0.05, end=L["tasks"]["end"] + 0.1, base=0.95)
    elif name == "check":
        pop(c, CHECK, 200, 420, t, at("верно") - 0.05, end=at("нет") - 0.05)
        pop(c, CROSS, 200, 420, t, at("нет") - 0.05)
        pop(c, CALL["wrong"], 620, 820, t, at("нет") + 0.05, base=0.95)
    elif name == "explain":
        pop(c, CALL["solution"], 600, 760, t, at("страшно") + 0.1, base=0.95)
        pop(c, TXT["steps"], 540, 420, t, at("разбор") - 0.05, rot=-3)
    elif name == "modes":
        pop(c, TXT["m_topics"], 210, 330, t, at("темы") - 0.05, rot=-2)
        pop(c, TXT["m_var"], 250, 430, t, at("полный") - 0.05, rot=2)
        pop(c, TXT["m_game"], 210, 530, t, at("мини-игра") - 0.05, rot=-2)
        pop(c, TXT["m_theory"], 210, 630, t, at("теория") - 0.05, rot=2)
        pop(c, CALL["modes"], 620, 800, t, at("полный") - 0.05, end=at("мини-игра") - 0.15, base=0.95)
        pop(c, CALL["games"], 610, 800, t, at("мини-игра") - 0.05, end=at("теория") - 0.15, base=0.95)
        pop(c, CALL["theory"], 610, 800, t, at("теория") - 0.05, end=at("подписок") - 0.4, base=0.95)
        pop(c, TXT["nosub"], 560, 820, t, at("всё") - 0.05, rot=-3)
    elif name == "cta":
        pop(c, S.logo(130), 240, 250, t, t0 + 0.05)
        pop(c, WORDMARK, 600, 250, t, t0 + 0.1, base=0.85)
        pulse = 1 + 0.04 * math.sin(max(0, t - at("заходи")) * 7)
        pop(c, TXT["url"], 540, 430, t, at("заходи") + 0.1, base=pulse)
        pop(c, TXT["cta_top"], 540, 560, t, at("проверь") - 0.05)

    # transition flash on scene cuts
    if lt < 0.12 and t0 > 0:
        fl = Image.new("RGBA", (W, H), (255, 255, 255, int(70 * (1 - lt / 0.12))))
        c.alpha_composite(fl)
    S.draw_subtitle(c, CHUNKS, t, y=1340, keywords=KEY)
    return c


def sfx_events():
    ev = [("pop", at("ЕГЭ", "hook") - 0.15), ("buzz", at("ошибся", "hook")), ("whoosh", SC[1][1] - 0.15),
          ("pop", at("это", "intro")), ("ding", at("бесплатный")), ("whoosh", SC[2][1] - 0.1),
          ("pop", at("математике")), ("pop", at("русскому")), ("whoosh", SC[3][1] - 0.15), ("click", at("сразу")),
          ("ding", at("верно")), ("buzz", at("нет")), ("whoosh", SC[4][1] - 0.15), ("ding", at("разбор")),
          ("whoosh", SC[5][1] - 0.15), ("pop", at("темы")), ("pop", at("полный")), ("pop", at("мини-игра")),
          ("pop", at("теория")), ("ding", at("всё")), ("riser", SC[6][1] - 1.1), ("pop", at("заходи") + 0.1)]
    return ev


def mix(silent, out):
    ev = sfx_events()
    inputs = ["-i", str(silent), "-i", str(AUD / "voiceover.wav"), "-i", str(S.ROOT / "audio/music/zybrilka-theme-a.wav")]
    for kind, _ in ev:
        inputs += ["-i", str(FX / f"{kind}.wav")]
    vol = {"pop": 0.35, "buzz": 0.3, "whoosh": 0.35, "ding": 0.3, "click": 0.5, "riser": 0.3}
    fl = ["[2:a]volume=0.20,atrim=0:%.2f[mus]" % DUR, "[mus][1:a]sidechaincompress=threshold=0.04:ratio=6:attack=15:release=300[duck]"]
    labels = []
    for j, (kind, tt) in enumerate(ev):
        d = int(max(0, tt) * 1000)
        fl.append(f"[{3 + j}:a]volume={vol[kind]},adelay={d}|{d}[s{j}]"); labels.append(f"[s{j}]")
    fl.append("[1:a]apad[vo]")
    fl.append(f"[duck][vo]{''.join(labels)}amix=inputs={2 + len(labels)}:normalize=0:duration=first,"
              f"alimiter=limit=0.89,loudnorm=I=-14:TP=-1.5:LRA=9[a]")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(fl), "-map", "0:v", "-map", "[a]",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{DUR:.2f}", "-movflags", "+faststart", str(out)], check=True)


def write_srt(path):
    def ts(x):
        ms = int(round(x * 1000)); return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"
    rows = [f"{i}\n{ts(ch[0]['s'])} --> {ts(ch[-1]['e'])}\n{' '.join(w['w'] for w in ch)}\n" for i, ch in enumerate(CHUNKS, 1)]
    Path(path).write_text("\n".join(rows))


if __name__ == "__main__":
    if "--preview" in sys.argv:
        ts_ = [float(x) for x in sys.argv[sys.argv.index("--preview") + 1].split(",")]
        for x in ts_:
            frame(int(x * FPS)).convert("RGB").save(HERE / f"render/preview_{x:05.2f}.png")
        sys.exit()
    (HERE / "render").mkdir(exist_ok=True); (HERE / "final").mkdir(exist_ok=True)
    silent = HERE / "render/video_silent.mp4"
    enc = S.Encoder(silent)
    for i in range(N):
        enc.write(frame(i))
        if i % 90 == 0: print(f"frame {i}/{N}", flush=True)
    enc.close()
    write_srt(HERE / "subtitles/001-what-is-zybrilka.ru.srt")
    out = HERE / "final/001-what-is-zybrilka.mp4"
    mix(silent, out)
    print("done", out)
