import sys, subprocess, numpy as np
from faster_whisper import WhisperModel
m = WhisperModel("small", device="cpu", compute_type="int8")
def load(f): return np.frombuffer(subprocess.run(["ffmpeg","-i",f,"-ac","1","-ar","16000","-f","f32le","-"],capture_output=True).stdout,dtype=np.float32)
for f in sys.argv[1:]:
    segs,_ = m.transcribe(load(f), language="ru")
    print("==", f); print(" ".join(s.text.strip() for s in segs))
