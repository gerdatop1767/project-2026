"""Viseme lip-sync for the bison rig (v2).

1. Whisper gives real word timestamps for the voiceover; the known script text is aligned onto them
   (so subtitles keep the exact script spelling, timing comes from the actual audio).
2. Each Russian letter maps to a mouth shape (open, width): а/я wide, о/у/ю/ё round, э/е/и/ы mid,
   м/б/п closed, ф/в nearly closed, others small.
3. Keyframes are blended with cosine easing, scaled by loudness, closed in silence, then run through
   a critically damped spring (120 Hz sub-steps) -> smooth, non-jittery motion at any FPS.
"""
import difflib, re, subprocess, wave
from functools import lru_cache
import numpy as np

VOWEL = {"а": (1.0, 1.0), "я": (0.95, 1.0), "о": (0.8, 0.55), "ё": (0.75, 0.58), "у": (0.5, 0.42), "ю": (0.5, 0.45),
         "э": (0.75, 0.95), "е": (0.65, 0.92), "и": (0.45, 1.0), "ы": (0.5, 0.9)}
CONS = {**{c: (0.0, 0.85) for c in "мбп"}, **{c: (0.12, 0.8) for c in "фв"}, **{c: (0.25, 0.7) for c in "шщжч"},
        **{c: (0.22, 0.9) for c in "сзцтдлнркгхй"}}
WEIGHT_V, WEIGHT_C = 1.7, 1.0


HALLUCINATION = re.compile(r"редактор субтитров|корректор|субтитры (сделал|создавал)|продолжение следует|спасибо за просмотр", re.I)


def norm(w):
    return re.sub(r"[^а-яёa-z0-9]", "", w.lower().replace("ё", "е"))


@lru_cache(maxsize=1)
def _model():
    import os
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    from faster_whisper import WhisperModel
    return WhisperModel("small", device="cpu", compute_type="int8")


def load_mono16k(path):
    return np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                                        capture_output=True, check=True).stdout, np.float32)


def asr_words(path, prompt="", max_s=None):
    x = load_mono16k(path)
    if max_s: x = x[: int(max_s * 16000)]  # cut music tail: Whisper hallucinates captions credits on it
    segs, _ = _model().transcribe(x, language="ru", word_timestamps=True, initial_prompt=prompt or None,
                                  vad_filter=True, condition_on_previous_text=False)
    out = []
    for s in segs:
        if HALLUCINATION.search(s.text):  # Whisper's classic invented credits on silence/music
            continue
        for w in s.words:
            out.append(dict(w=w.word.strip(), s=float(w.start), e=float(w.end)))
    return out


def align(script_lines, asr):
    """Script words get timings from ASR words (difflib alignment); gaps are interpolated within their line."""
    sw = [(w, ln["id"], ln["start"], ln["end"]) for ln in script_lines for w in ln["text"].split()]
    a = [norm(x["w"]) for x in asr]; b = [norm(x[0]) for x in sw]
    times = [None] * len(sw)
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
            for k in range(j2 - j1):
                times[j1 + k] = (asr[i1 + k]["s"], asr[i1 + k]["e"])
        elif tag == "replace" and i2 > i1:  # n:m — spread the ASR span over the script words
            s0, e0 = asr[i1]["s"], asr[i2 - 1]["e"]; n = j2 - j1
            for k in range(n):
                times[j1 + k] = (s0 + (e0 - s0) * k / n, s0 + (e0 - s0) * (k + 1) / n)
    out = []
    for idx, (w, lid, ls, le) in enumerate(sw):
        t = times[idx]
        if t is None or not (ls - 0.3 <= t[0] <= le + 0.3):  # fall back to proportional inside the line
            line_words = [x for x in sw if x[1] == lid]; k = line_words.index((w, lid, ls, le))
            t = (ls + (le - ls) * k / len(line_words), ls + (le - ls) * (k + 1) / len(line_words))
        out.append(dict(w=w, s=max(ls, t[0]), e=min(le + 0.05, max(t[1], t[0] + 0.06)), line=lid))
    for i in range(1, len(out)):  # keep monotonic
        out[i]["s"] = max(out[i]["s"], out[i - 1]["s"] + 0.02)
    return out


def _rms_track(path, fps):
    with wave.open(str(path)) as wf:
        sr = wf.getframerate(); ch = wf.getnchannels()
        x = np.frombuffer(wf.readframes(wf.getnframes()), "<i2").astype(np.float32) / 32768
    if ch == 2: x = x[::2]
    hop = sr // fps; win = int(sr * 0.04); n = len(x) // hop + 1
    r = np.array([np.sqrt((x[max(0, i * hop - win // 2): i * hop + win // 2] ** 2).mean() + 1e-12) for i in range(n)])
    ref = np.percentile(r[r > 0.01], 90) if (r > 0.01).any() else 1
    return np.clip(r / ref, 0, 1.3)


def mouth_track(wav_path, words, fps=30, lead=0.035, om=30.0, mix=0.85, sil=0.1):
    """Return per-frame (open 0..1, width 0.4..1) arrays for the rig."""
    rate = 120
    rms = _rms_track(wav_path, rate)
    n = len(rms)
    keys = []  # (time, open, width)
    for w in words:
        letters = [c for c in w["w"].lower() if c in VOWEL or c in CONS]
        if not letters: continue
        wts = [WEIGHT_V if c in VOWEL else WEIGHT_C for c in letters]
        tot = sum(wts); t = w["s"]
        for c, k in zip(letters, wts):
            d = (w["e"] - w["s"]) * k / tot
            o, wd = VOWEL.get(c) or CONS[c]
            keys.append((t + d * 0.5, o, wd)); t += d
        keys.append((w["e"] + 0.02, 0.08, 0.9))
    keys.sort()
    tt = np.arange(n) / rate
    tgt_o = np.zeros(n); tgt_w = np.full(n, 0.9)
    if keys:
        kt = np.array([k[0] for k in keys]); ko = np.array([k[1] for k in keys]); kw = np.array([k[2] for k in keys])
        idx = np.clip(np.searchsorted(kt, tt) - 1, 0, len(kt) - 2)
        f = np.clip((tt - kt[idx]) / np.maximum(1e-3, kt[idx + 1] - kt[idx]), 0, 1)
        f = 0.5 - 0.5 * np.cos(np.pi * f)  # cosine blend between visemes
        tgt_o = ko[idx] * (1 - f) + ko[idx + 1] * f
        tgt_w = kw[idx] * (1 - f) + kw[idx + 1] * f
        gap = (kt[idx + 1] - kt[idx]) > 0.35  # long pauses -> rest
        tgt_o[gap & (f > 0.15) & (f < 0.85)] = 0.0
    loud = np.clip(rms[: n], 0, 1.2)
    tgt_o = tgt_o * ((1 - mix) + mix * np.clip(loud * 1.4, 0, 1))
    tgt_o[np.convolve(loud, np.ones(9) / 9, "same") < sil] = 0.0  # silence -> closed
    # critically damped spring (omega ~ 26 rad/s): smooth but still crisp on syllables
    dt = 1 / rate
    def spring(target):
        x = v = 0.0; out = np.zeros_like(target)
        for i, g in enumerate(target):
            a = om * om * (g - x) - 2 * om * v; v += a * dt; x += v * dt; out[i] = x
        return out
    o = np.clip(spring(tgt_o), 0, 1); wd = np.clip(spring(tgt_w - 0.9) + 0.9, 0.4, 1.0)
    # visual lead: frame shows the mouth state `lead` s ahead (compensates spring lag; lips slightly precede sound)
    frames = np.clip((np.arange(int(n * fps / rate)) / fps + lead) * rate, 0, n - 1).astype(int)
    return o[frames], wd[frames]
