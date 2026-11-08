"""OCR the answer column of each key table as a whole (psm 6, deskew) and split it into entries:
a line continues the previous entry if it starts with 'последовательность'/'<или>' or the previous ends with '<или>'.
Writes answers/key_cols.json {variant: {entries:[...], count, pdfPage, source}}. Usage: answer_cols.py R"""
import sys, json, subprocess, re, os
import numpy as np
from PIL import Image
R = sys.argv[1]; ENV = {'OMP_THREAD_LIMIT': '1', 'PATH': '/usr/bin:/bin'}
def runs(mask):
    idx = np.where(mask)[0]
    if len(idx) == 0: return []
    g, s, p = [], idx[0], idx[0]
    for i in idx[1:]:
        if i != p + 1: g.append((s, p)); s = i
        p = i
    g.append((s, p)); return g
CONT = re.compile(r'^(последовательн|<или>|этих\s+цифр|цифр\b)')
out = {}
for page in range(315, 333):
    src = f'{R}/keypages/k{page}.ppm' if page >= 322 else f'{R}/pages/p{page}.ppm'
    im = np.array(Image.open(src).convert('L')); h, w = im.shape
    colfrac = (im < 160)[int(h*0.15):int(h*0.85)].mean(axis=0)
    v = [int((a+b)//2) for a, b in runs(colfrac > 0.3)]
    x1L, x0R = [(a, b) for a, b in zip(v, v[1:]) if 24 <= b - a <= 36 and 500 < a < 700][0]
    for t, (xs, x1) in enumerate([(x1L - 530 + 123, x1L), (x0R + 122, min(w - 1, x0R + 535))]):
        variant = (page - 315) * 2 + 1 + t
        fn = f'{R}/answers/cols/v{variant:02d}.png'
        Image.fromarray(im[int(h*0.10):int(h*0.93), xs+6:x1-4]).save(fn)
        subprocess.run(['convert', fn, '-resize', '300%', '-deskew', '40%', fn], env=ENV)
        txt = subprocess.run(['tesseract', fn, '-', '-l', 'rus', '--psm', '6'], capture_output=True, text=True, env=ENV).stdout
        lines = [re.sub(r'^[\W_]{1,3}\s', '', ' '.join(l.split())).strip(' |[]') for l in txt.split('\n')]
        lines = [l for l in lines if l and not re.match(r'^(Ответ|№|задания|©|Копирован)', l)]
        ents = []
        for l in lines:
            if ents and (CONT.match(l) or ents[-1].endswith('<или>')): ents[-1] += ' ' + l
            else: ents.append(l)
        out[variant] = {'entries': ents, 'count': len(ents), 'pdfPage': page, 'printedPage': page + 9, 'source': os.path.basename(src)}
json.dump(out, open(f'{R}/answers/key_cols.json', 'w'), ensure_ascii=False, indent=1)
print({v: d['count'] for v, d in out.items() if d['count'] != 26} or 'all 26')
