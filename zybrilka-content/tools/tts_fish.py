#!/usr/bin/env python3
"""ZYBRILKA voice via Fish Audio API (paid per character). Same contract as tts.py:
reads <video_dir>/voiceover.json, writes audio/voiceover_raw.wav, audio/voiceover.wav, audio/lines.json.

The API key is NOT read from code or env: the session proxy injects it for api.fish.audio.
voiceover.json fields used: "fish": {"reference_id", "model", "speed", "temperature", "top_p"}.
Each line is synthesized separately (exact line timings, re-take one line without paying for all),
cached in audio/fish_cache/<hash>.wav so re-renders cost nothing.

Usage: python3 tts_fish.py <video_dir> [--force LINE_ID ...]
"""
import argparse, hashlib, json, re, subprocess, sys, urllib.request, urllib.error, wave, io
from pathlib import Path

API = "https://api.fish.audio/v1/tts"
SR = 44100


def synth(text, fish):
    body = {"text": text, "reference_id": fish["reference_id"], "format": "wav", "sample_rate": SR,
            "normalize": True, "latency": "normal", "prosody": {"speed": fish.get("speed", 1.0), "volume": 0}}
    for k in ("temperature", "top_p"):
        if k in fish: body[k] = fish[k]
    req = urllib.request.Request(API, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": "Bearer proxy-injected", "Content-Type": "application/json", "model": fish.get("model", "s2.1-pro-free")})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"Fish Audio error {e.code}: {e.read()[:300]!r}")


def pcm_mono(wav_bytes):
    """Decode any wav to mono int16 @SR via ffmpeg, trimming leading/trailing silence."""
    p = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "-", "-ac", "1", "-ar", str(SR), "-af",
                        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,"
                        "areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.18,areverse",
                        "-f", "s16le", "-"], input=wav_bytes, capture_output=True, check=True)
    return p.stdout


STRESS = Path(__file__).resolve().parent.parent / "pipeline/stress.json"


def apply_stress(text):
    """Owner-maintained dictionary (pipeline/stress.json: {"зубрилка": "Зубри́лка", ...}) applied to every voiced line,
    unless the word already carries a stress mark. Case of the first letter is preserved."""
    if not STRESS.exists(): return text
    d = {k.lower(): v for k, v in json.loads(STRESS.read_text()).items() if not k.startswith("_")}
    def fix(m):
        w = m.group(0)
        if "\u0301" in w or w.lower() not in d: return w
        v = d[w.lower()]
        return v[0].upper() + v[1:] if w[0].isupper() else v[0].lower() + v[1:]
    return re.sub(r"[А-Яа-яЁё\u0301-]+", fix, text)


def line_file(out, lid, chunk):
    """Each line as its own clean file (48 kHz, voice EQ/comp, 10 ms fade-in, 60 ms fade-out) — reels place these
    files directly, so no line can be cut or bleed into the next one."""
    dur = len(chunk) / 2 / SR; (out / "lines").mkdir(exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", "-af",
                    "highpass=f=70,equalizer=f=3000:t=q:w=1.2:g=1.5,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=80,"
                    f"afade=t=in:d=0.01,afade=t=out:st={max(0, dur - 0.06):.3f}:d=0.06", "-ar", "48000", str(out / "lines" / f"{lid}.wav")],
                   input=bytes(chunk), check=True)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("video_dir"); ap.add_argument("--force", nargs="*", default=[])
    a = ap.parse_args()
    vd = Path(a.video_dir); spec = json.loads((vd / "voiceover.json").read_text()); fish = spec["fish"]
    out = vd / "audio"; cache = out / "fish_cache"; cache.mkdir(parents=True, exist_ok=True)
    lead = spec.get("lead_in", 0.25)
    pcm = bytearray(b"\x00\x00" * int(SR * lead)); t = lead; lines = []; chars = 0
    for ln in spec["lines"]:
        text = apply_stress(ln.get("fish_text", ln["text"])).strip()
        if text and text[-1] not in ".!?…": text += "."  # a closing mark stops Fish from clipping the last word  # acute marks are kept: they steer Fish's stress
        key = hashlib.sha1(json.dumps([text, fish], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
        f = cache / f"{ln['id']}-{key}.wav"
        if not f.exists() or ln["id"] in a.force:
            f.write_bytes(synth(text, fish)); chars += len(text); print("synth", ln["id"], len(text), "chars")
        chunk = pcm_mono(f.read_bytes()); dur = len(chunk) / 2 / SR; line_file(out, ln["id"], chunk)
        lines.append({"id": ln["id"], "text": ln["text"].replace("́", ""), "start": round(t, 3), "end": round(t + dur, 3)})
        pcm += chunk; t += dur
        gap = ln.get("pause_after", 0.25); pcm += b"\x00\x00" * int(SR * gap); t += gap
    raw = out / "voiceover_raw.wav"
    with wave.open(str(raw), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(bytes(pcm))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af",
                    "highpass=f=70,equalizer=f=3000:t=q:w=1.2:g=1.5,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=80,"
                    "loudnorm=I=-14:TP=-1.5:LRA=7", "-ar", "48000", str(out / "voiceover.wav")], check=True)
    (out / "lines.json").write_text(json.dumps({"duration": round(t, 3), "lines": lines, "engine": "fish", "voice": fish},
                                               ensure_ascii=False, indent=1))
    # word timings from the real audio (Whisper + alignment onto the script) for lip-sync, captions, events
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import lipsync
    words = lipsync.align(lines, lipsync.asr_words(out / "voiceover_raw.wav", " ".join(l["text"] for l in lines)))
    (out / "words.json").write_text(json.dumps(words, ensure_ascii=False, indent=0))
    print(f"voiceover {t:.2f}s, {len(words)} words aligned, billed chars this run: {chars}")


if __name__ == "__main__":
    main()
