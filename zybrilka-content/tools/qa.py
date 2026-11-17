#!/usr/bin/env python3
"""Automatic QA for a rendered video. Writes <video_dir>/qa/{report.json,contact.png,mouth.png}.
Exit 0 = all hard checks pass, 1 = failures (see report). The QA agent must also LOOK at contact.png / mouth.png.

python3 qa.py <video_dir>
"""
import difflib, json, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import lipsync


def probe(p):
    out = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(p)],
                                    capture_output=True, text=True, check=True).stdout)
    v = next(s for s in out["streams"] if s["codec_type"] == "video"); a = next((s for s in out["streams"] if s["codec_type"] == "audio"), {})
    return dict(width=v["width"], height=v["height"], fps=eval(v["r_frame_rate"]), vcodec=v["codec_name"], pix=v.get("pix_fmt"),
                acodec=a.get("codec_name"), sr=int(a.get("sample_rate", 0)), duration=float(out["format"]["duration"]))


def loudness(p):
    err = subprocess.run(["ffmpeg", "-i", str(p), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    tail = err[err.rfind("Summary"):]
    I = float(tail.split("I:")[1].split("LUFS")[0]); pk = float(tail.split("Peak:")[1].split("dBFS")[0])
    return I, pk


def frames(p, times, crop=None, w=270):
    ims = []
    for t in times:
        vf = (f"crop={crop}," if crop else "") + f"scale={w}:-1"
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(p), "-frames:v", "1", "-vf", vf, "-f", "image2pipe", "-vcodec", "png", "-"],
                             capture_output=True).stdout
        import io; ims.append(Image.open(io.BytesIO(raw)).convert("RGB"))
    return ims


def sheet(ims, cols, path):
    w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols
    c = Image.new("RGB", (cols * (w + 6), rows * (h + 6)), "white")
    for i, im in enumerate(ims): c.paste(im, ((i % cols) * (w + 6), (i // cols) * (h + 6)))
    c.save(path)


def main():
    vd = Path(sys.argv[1]); sb = json.loads((vd / "storyboard.json").read_text())
    slug = sb.get("slug", vd.name); mp4 = vd / f"final/{slug}.mp4"
    q = vd / "qa"; q.mkdir(exist_ok=True)
    lines = json.loads((vd / "audio/lines.json").read_text())["lines"]
    words = json.loads((vd / "audio/words.json").read_text())
    rep = {"video": str(mp4), "checks": {}, "fail": []}
    def chk(name, ok, value):
        rep["checks"][name] = {"ok": bool(ok), "value": value}
        if not ok: rep["fail"].append(name)

    pr = probe(mp4)
    chk("format_1080x1920", pr["width"] == 1080 and pr["height"] == 1920, f"{pr['width']}x{pr['height']}")
    chk("fps_30_or_60", round(pr["fps"]) in (30, 60), pr["fps"])
    chk("codecs_h264_aac", pr["vcodec"] == "h264" and pr["acodec"] == "aac" and pr["pix"] == "yuv420p", f"{pr['vcodec']}/{pr['acodec']}/{pr['pix']}")
    dmin, dmax = sb.get("duration_range", [10, 60])
    chk("duration", dmin <= pr["duration"] <= dmax, round(pr["duration"], 2))
    I, pk = loudness(mp4)
    chk("loudness_-14_LUFS", -15.5 <= I <= -12.5, I); chk("true_peak", pk <= -1.0, pk)

    # speech vs script (word error rate on normalized words)
    asr = lipsync.asr_words(mp4, " ".join(l["text"] for l in lines))
    a = [lipsync.norm(w["w"]) for w in asr]; b = [lipsync.norm(w) for l in lines for w in l["text"].split()]
    sm = difflib.SequenceMatcher(None, b, a, autojunk=False)
    errs = sum(max(i2 - i1, j2 - j1) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != "equal")
    wer = errs / max(1, len(b))
    diffs = [f"{tag}: '{' '.join(b[i1:i2])}' -> '{' '.join(a[j1:j2])}'" for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != "equal"]
    chk("speech_matches_script_WER<=0.12", wer <= 0.12, {"wer": round(wer, 3), "diffs": diffs[:20], "asr": " ".join(w["w"] for w in asr)})

    # lip-sync: correlation with loudness, smoothness (jerk), closed in silence
    o, wd = lipsync.mouth_track(vd / "audio/voiceover_raw.wav", words)
    rms = lipsync._rms_track(vd / "audio/voiceover_raw.wav", 30)[: len(o)]
    n = min(len(o), len(rms)); o, rms = o[:n], rms[:n]
    lags = {L: float(np.corrcoef(o[max(0, L):n + min(0, L)], rms[max(0, -L):n - max(0, L)])[0, 1]) for L in range(-4, 5)}
    corr, best_lag = lags[0], max(lags, key=lags.get)
    jerk = float(np.abs(np.diff(o, 2)).mean())
    silent = rms < 0.05; closed = float((o[silent] < 0.12).mean()) if silent.any() else 1.0
    # thresholds calibrated on video 001: old amplitude rig = corr .87 / jerk .146 (twitchy); viseme v2 = .68 / .069
    chk("lipsync_corr>=0.55", corr >= 0.55, round(corr, 3))
    chk("lipsync_mouth_not_late(lag_frames<=0)", -2 <= best_lag <= 0, best_lag)
    chk("mouth_smooth_jerk<=0.08", jerk <= 0.08, round(jerk, 4))
    chk("mouth_closed_in_silence>=0.85", closed >= 0.85, round(closed, 3))

    # visual sheets for the QA agent to inspect
    dur = pr["duration"]
    sheet(frames(mp4, list(np.linspace(0.4, dur - 0.4, 12))), 6, q / "contact.png")
    # mouth strip: busiest speech second while the bison is big on screen (closeup/full), crop computed from the layout
    import render
    v = render.Video(vd)
    big = np.array([v.scene_at(k / 30).get("bison", "full") in ("closeup", "full") for k in range(len(o))])
    act = np.convolve(o, np.ones(20), "same") * big
    i = int(np.argmax(act)) if act.max() > 0 else int(np.argmax(np.convolve(o, np.ones(20), "same")))
    t0 = max(0.0, i / 30 - 0.33); rep["mouth_strip_start"] = round(t0, 2)
    fx, fy, sc = v.layout(t0 + 0.25)
    mx = fx + (595 - render.FACE[0]) * sc; my = fy + (515 - render.FACE[1]) * sc
    cw, chh = int(300 * sc), int(220 * sc)
    crop = f"{cw}:{chh}:{int(mx - cw / 2)}:{int(my - chh / 2)}"
    sheet(frames(mp4, [t0 + k / 30 for k in range(16)], crop=crop, w=240), 8, q / "mouth.png")
    rep["passed"] = not rep["fail"]
    (q / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1))
    print(json.dumps({k: v["value"] if not isinstance(v["value"], dict) else v["value"].get("wer") for k, v in rep["checks"].items()}, ensure_ascii=False))
    print("PASSED" if rep["passed"] else "FAILED: " + ", ".join(rep["fail"]))
    sys.exit(0 if rep["passed"] else 1)


if __name__ == "__main__":
    main()
