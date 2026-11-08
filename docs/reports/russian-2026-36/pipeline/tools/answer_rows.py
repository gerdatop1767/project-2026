"""Answer tables, PDF 315-332 (2 variants per page). Row bands from the task-number column's rules;
OCR each answer cell (psm 6) and number cell (digits). V15-V36 read from the separate key file (k*.ppm, identical pixels).
Writes answers/key_rows.json, prints structural problems. Usage: answer_rows.py R"""
import sys, json, subprocess, os
import numpy as np
from PIL import Image
R = sys.argv[1]
ENV = {'OMP_THREAD_LIMIT': '1', 'PATH': '/usr/bin:/bin'}
def runs(mask):
    idx = np.where(mask)[0]
    if len(idx) == 0: return []
    g, s, p = [], idx[0], idx[0]
    for i in idx[1:]:
        if i != p + 1: g.append((s, p)); s = i
        p = i
    g.append((s, p)); return g
def ocr(fn, *args):
    return ' '.join(subprocess.run(['tesseract', fn, '-', '-l', 'rus', *args], capture_output=True, text=True, env=ENV).stdout.split())
out, problems = {}, {}
for page in range(315, 333):
    src = f'{R}/keypages/k{page}.ppm' if page >= 322 else f'{R}/pages/p{page}.ppm'
    im = np.array(Image.open(src).convert('L')); dark = im < 140; h, w = dark.shape
    colfrac = (im < 160)[int(h*0.15):int(h*0.85)].mean(axis=0)
    v = [int((a+b)//2) for a, b in runs(colfrac > 0.3)]
    gap = [(a, b) for a, b in zip(v, v[1:]) if 24 <= b - a <= 36 and 500 < a < 700]
    if not gap: problems[f'p{page}'] = f'no gap {v}'; continue
    x1L, x0R = gap[0]
    snap = lambda x: min(v, key=lambda y: abs(y - x)) if min(abs(y - x) for y in v) <= 12 else x
    x0L = snap(x1L - 530); xsL = snap(x0L + 123); xsR = snap(x0R + 122); x1R = snap(x0R + 535)
    grid = [(x0L, xsL, x1L), (x0R, xsR, x1R)]
    for t, (x0, xs, x1) in enumerate(grid):
        variant = (page - 315) * 2 + 1 + t
        num = dark[:, x0+4:xs-4].mean(axis=1)
        hl = [(a+b)//2 for a, b in runs(num > 0.7)]
        bands = [(a, b) for a, b in zip(hl, hl[1:]) if b - a > 18]
        # header strip above the table → 'ВАРИАНТ N'
        top = hl[0] if hl else int(h*0.12)
        hfn = f'{R}/answers/cells2/v{variant:02d}_head.png'
        Image.fromarray(im[max(0, top-70):top, x0:x1]).resize(((x1-x0)*2, 140)).save(hfn)
        head = ocr(hfn, '--psm', '7')
        nums = []
        for (y0, y1) in bands:
            k = Image.fromarray(im[y0+3:y1-2, x0+4:xs-4]); k = k.resize((k.width*3, k.height*3))
            kn = f'{R}/answers/cells2/tmp_num.png'; k.save(kn)
            nums.append(ocr(kn, '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789'))
        score = lambda off: sum(1 for n in range(1, 27) if 0 <= off + n - 1 < len(bands) and nums[off + n - 1] == str(n))
        off = max(range(0, max(1, len(bands) - 25)), key=score)
        rows = bands[off:off + 26]
        if score(off) < 18 or len(rows) != 26: problems[variant] = f'alignment {score(off)}/26, bands {len(bands)}'
        ans = {}
        for n, (y0, y1) in enumerate(rows[:26], start=1):
            c = Image.fromarray(im[y0+3:y1-2, xs+4:x1-3]); c = c.resize((c.width*3, c.height*3))
            fn = f'{R}/answers/cells2/v{variant:02d}_{n:02d}.png'; c.save(fn)
            k = Image.fromarray(im[y0+3:y1-2, x0+4:xs-4]); k = k.resize((k.width*3, k.height*3))
            kn = f'{R}/answers/cells2/v{variant:02d}_{n:02d}_num.png'; k.save(kn)
            ans[n] = {'text': ocr(fn, '--psm', '6'), 'num': ocr(kn, '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789'),
                      'pdfPage': page, 'printedPage': page + 9, 'source': os.path.basename(src)}
        out[variant] = {'header': head, 'answers': ans}
        print(variant, head, len(rows), flush=True)
json.dump(out, open(f'{R}/answers/key_rows.json', 'w'), ensure_ascii=False, indent=1)
print('problems:', problems)
