#!/usr/bin/env python3
"""Royalty-free by construction: music bed and SFX synthesized from scratch with numpy.

python3 audio_fx.py music <seconds> <out.wav> [--bpm 118] [--seed 1]
python3 audio_fx.py sfx <out_dir>
"""
import sys, wave, numpy as np
from pathlib import Path

SR = 48000


def write(path, x):
    x = np.asarray(x, np.float32)
    if x.ndim == 1:
        x = np.c_[x, x]
    x = x / max(1e-9, np.abs(x).max()) * 0.89
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def env(n, a=0.005, d=0.2):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)


def tone(f, dur, kind="saw", det=0.0):
    t = np.arange(int(dur * SR)) / SR
    out = 0
    for dd in ([-det, det] if det else [0]):
        ph = (f * (1 + dd)) * t
        out = out + (2 * (ph % 1) - 1 if kind == "saw" else np.sin(2 * np.pi * ph))
    return out / (2 if det else 1)


def lp(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR); y = np.zeros_like(x); s = 0.0
    for i in range(len(x)):  # small loops only; fine for short notes
        s = (1 - a) * x[i] + a * s; y[i] = s
    return y


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def music(seconds, bpm=118, seed=1):
    rng = np.random.default_rng(seed)
    beat = 60 / bpm; n = int(seconds * SR)
    L = np.zeros(n); R = np.zeros(n)
    def add(sig, t, pan=0.0, g=1.0):
        i = int(t * SR); j = min(n, i + len(sig))
        if i >= n: return
        L[i:j] += sig[:j - i] * g * (1 - pan) ; R[i:j] += sig[:j - i] * g * (1 + pan)
    kick_t = np.arange(int(0.35 * SR)) / SR
    kick = np.sin(2 * np.pi * (45 * kick_t + 90 * (1 - np.exp(-kick_t * 30)) / 30 * 1.0)) * np.exp(-kick_t * 9)
    clap = rng.normal(0, 1, int(0.18 * SR)) * env(int(0.18 * SR), 0.001, 0.05)
    hat = np.diff(rng.normal(0, 1, int(0.06 * SR) + 1)) * env(int(0.06 * SR), 0.001, 0.015)
    # i - VI - III - VII in A minor, bright pluck arps
    prog = [(57, [69, 72, 76]), (53, [69, 72, 77]), (48, [67, 72, 76]), (55, [67, 71, 74])]
    bars = int(seconds / (4 * beat)) + 1
    for b in range(bars):
        root, chord = prog[b % 4]
        for k in range(4):
            t = (b * 4 + k) * beat
            add(kick, t, g=0.9)
            if k in (1, 3): add(clap, t, g=0.35)
        for k in range(8):
            t = (b * 4 + k / 2) * beat
            add(hat, t + beat / 2 * 0.0, pan=0.3 if k % 2 else -0.3, g=0.18 if k % 2 else 0.1)
            bass = tone(midi(root - 12), beat / 2 * 0.95, "saw") * env(int(beat / 2 * 0.95 * SR), 0.004, 0.16)
            add(np.tanh(bass * 1.5) * 0.5, t, g=0.45)
        for k in range(16):
            t = (b * 4 + k / 4) * beat
            note = chord[[0, 1, 2, 1][k % 4]] + (12 if k % 8 >= 6 else 0)
            p = tone(midi(note), 0.22, "saw", det=0.004) * env(int(0.22 * SR), 0.002, 0.07)
            add(p * 0.22, t, pan=np.sin(k) * 0.4)
        pad = sum(tone(midi(c - 12), 4 * beat, "sin") for c in chord) * 0.06
        add(pad * np.minimum(1, np.arange(len(pad)) / (0.3 * SR)), b * 4 * beat)
    x = np.c_[L, R]
    fade = np.ones(n); fade[-int(1.2 * SR):] = np.linspace(1, 0, int(1.2 * SR)); fade[:int(0.05 * SR)] = np.linspace(0, 1, int(0.05 * SR))
    return np.tanh(x * 1.2) * fade[:, None]


def sfx(out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(3)
    n = int(0.45 * SR); t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    sweep = np.zeros(n); s = 0.0
    for i in range(n):  # whoosh: noise through a rising/falling one-pole low-pass
        c = 400 + 5000 * np.sin(np.pi * i / n) ** 2
        a = np.exp(-2 * np.pi * c / SR); s = (1 - a) * noise[i] + a * s; sweep[i] = s
    write(out / "whoosh.wav", sweep * np.sin(np.pi * t / t[-1]) ** 1.5)
    n = int(0.12 * SR); t = np.arange(n) / SR
    write(out / "pop.wav", np.sin(2 * np.pi * (500 * t + 2500 * t * t)) * env(n, 0.001, 0.04))
    n = int(0.9 * SR); t = np.arange(n) / SR
    write(out / "ding.wav", (np.sin(2 * np.pi * 1318 * t) + 0.5 * np.sin(2 * np.pi * 1975 * t) + 0.3 * np.sin(2 * np.pi * 2637 * t)) * env(n, 0.002, 0.3))
    n = int(0.35 * SR); t = np.arange(n) / SR
    write(out / "buzz.wav", np.sign(np.sin(2 * np.pi * 140 * t)) * 0.5 * env(n, 0.005, 0.15) + np.sin(2 * np.pi * 110 * t) * env(n, 0.005, 0.2))
    n = int(0.05 * SR)
    write(out / "click.wav", rng.normal(0, 1, n) * env(n, 0.0005, 0.006))
    n = int(1.2 * SR); t = np.arange(n) / SR
    write(out / "riser.wav", rng.normal(0, 1, n) * (t / t[-1]) ** 2 * 0.6 + np.sin(2 * np.pi * (200 * t + 300 * t * t)) * (t / t[-1]) * 0.4)


if __name__ == "__main__":
    if sys.argv[1] == "music":
        bpm = float(sys.argv[sys.argv.index("--bpm") + 1]) if "--bpm" in sys.argv else 118
        write(sys.argv[3], music(float(sys.argv[2]), bpm))
    else:
        sfx(sys.argv[2])
