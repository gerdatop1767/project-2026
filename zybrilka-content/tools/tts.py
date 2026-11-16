#!/usr/bin/env python3
"""ZYBRILKA voice: synthesize a video's voiceover.json with the bison's fixed voice.

Free & offline: Piper TTS (MIT) + voice ru_RU-denis-medium (dataset CC0).
Stress can be forced with a combining acute accent (Зубри́лка) or raw phonemes [[ ... ]].

Usage: python3 tts.py <video_dir> [--voice-dir DIR] [--voice NAME]
Writes: <video_dir>/audio/voiceover.wav and audio/lines.json (start/end of every line).
"""
import argparse, json, subprocess, wave, os
from pathlib import Path
from piper import PiperVoice, SynthesisConfig

HERE = Path(__file__).resolve().parent
DEFAULT_VOICE_DIR = Path(os.environ.get("ZYB_VOICE_DIR", HERE.parent / "character/voice/models"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video_dir")
    ap.add_argument("--voice-dir", default=str(DEFAULT_VOICE_DIR))
    ap.add_argument("--voice")
    a = ap.parse_args()
    vd = Path(a.video_dir)
    spec = json.loads((vd / "voiceover.json").read_text())
    voice_name = a.voice or spec["voice"]
    voice = PiperVoice.load(str(Path(a.voice_dir) / f"{voice_name}.onnx"))
    sr = voice.config.sample_rate
    cfg = SynthesisConfig(length_scale=spec.get("length_scale", 1.0),
                          noise_scale=spec.get("noise_scale", 0.7),
                          noise_w_scale=spec.get("noise_w", 0.9))
    out = vd / "audio"; out.mkdir(exist_ok=True)
    lead = spec.get("lead_in", 0.25)
    pcm = bytearray(b"\x00\x00" * int(sr * lead))
    t = lead; lines = []
    for ln in spec["lines"]:
        chunk = b"".join(c.audio_int16_bytes for c in voice.synthesize(ln["text"], syn_config=cfg))
        dur = len(chunk) / 2 / sr
        lines.append({"id": ln["id"], "text": ln["text"].replace("́", ""), "start": round(t, 3), "end": round(t + dur, 3)})
        pcm += chunk; t += dur
        gap = ln.get("pause_after", 0.3)
        pcm += b"\x00\x00" * int(sr * gap); t += gap
    raw = out / "voiceover_raw.wav"
    with wave.open(str(raw), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(bytes(pcm))
    # Broadcast polish: de-mud, presence, gentle compression, loudness for TikTok (~-14 LUFS).
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af",
                    "highpass=f=80,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3500:t=q:w=1.2:g=3,"
                    "acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-14:TP=-1.5:LRA=7",
                    "-ar", "48000", str(out / "voiceover.wav")], check=True)
    (out / "lines.json").write_text(json.dumps({"duration": round(t, 3), "lines": lines}, ensure_ascii=False, indent=1))
    print(f"voiceover {t:.2f}s -> {out/'voiceover.wav'}")


if __name__ == "__main__":
    main()
