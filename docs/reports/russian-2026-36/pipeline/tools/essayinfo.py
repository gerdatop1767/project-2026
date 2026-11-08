"""Crop the «Информация о текстах» row of variant N (PDF 333–338) into view/e.png. Usage: essayinfo.py R N"""
import sys, csv, glob
from PIL import Image
R, N = sys.argv[1], int(sys.argv[2])
heads = []
for p in range(333, 339):
    rows = list(csv.DictReader(open(f'{R}/tsv/p{p}.tsv'), delimiter='\t', quoting=csv.QUOTE_NONE))
    for i, r in enumerate(rows):
        if r['text'] == 'ВАРИАНТ' and i + 1 < len(rows) and rows[i + 1]['text'].strip().isdigit():
            heads.append((int(rows[i + 1]['text']), p, int(r['top'])))
heads.sort(key=lambda x: (x[1], x[2]))
idx = [k for k, h in enumerate(heads) if h[0] == N]
if not idx: sys.exit(f'variant {N} heading not found; found {[h[0] for h in heads]}')
k = idx[0]; v, p, y = heads[k]
im = Image.open(f'{R}/pages/p{p}.ppm'); w, h = im.size
end = heads[k + 1][2] if k + 1 < len(heads) and heads[k + 1][1] == p else int(h * 0.92)
im.crop((0, max(0, y - 10), w, min(h, end - 5))).resize((900, int((min(h, end - 5) - max(0, y - 10)) * 900 / w))).save(f'{R}/view/e.png')
print('page', p, 'y', y, '..', end)
