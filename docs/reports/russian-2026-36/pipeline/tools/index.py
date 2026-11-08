"""Page -> variant index from OCR headers; task anchors (boxed task numbers 1..27) per variant.
Writes seg/index.json and prints anomalies. Usage: index.py R"""
import json, re, sys, os
R = sys.argv[1]
pages = {}
for f in os.listdir(f'{R}/ocr'):
    m = re.match(r'p(\d{3})\.txt$', f)
    if m: pages[int(m.group(1))] = open(f'{R}/ocr/{f}', encoding='utf-8').read()
start = {}
for p in sorted(pages):
    if p >= 314: break
    for m in re.finditer(r'^\s*ВАРИАНТ\s+(\d{1,2})\s*$', pages[p], re.M):
        v = int(m.group(1))
        if 1 <= v <= 36 and v not in start and re.search(r'Часть\s*1', pages[p]): start[v] = p
print('starts', len(start), sorted(start.items()))
missing = [v for v in range(1, 37) if v not in start]
print('missing starts', missing)
idx = {}
vs = sorted(start)
for i, v in enumerate(vs):
    end = (start[vs[i + 1]] - 1) if i + 1 < len(vs) else 313
    idx[v] = {'pdfStart': start[v], 'pdfEnd': end, 'printedStart': start[v] + 9, 'printedEnd': end + 9}
json.dump(idx, open(f'{R}/seg/index.json', 'w'), ensure_ascii=False, indent=1)
lens = {v: d['pdfEnd'] - d['pdfStart'] + 1 for v, d in idx.items()}
print('pages per variant', sorted(set(lens.values())), {v: l for v, l in lens.items() if l not in (8, 9)})
