"""Variant text (with <<PAGE n>> markers) and chunks split on 'Ответ' lines. Writes seg/vNN.txt, prints counts."""
import json, re, sys
R = sys.argv[1]
idx = json.load(open(f'{R}/seg/index.json'))
FOOT = re.compile(r'(©\s*20\d\d|Копирование, распространение|ЕГЭ\.?\s*ТИПОВЫЕ ЭКЗАМЕНАЦИОННЫЕ|^\s*ВАРИАНТ\s+\d+\s*\d*\s*$|^\s*\d{1,3}\s*$)')
ANS = re.compile(r'^\s*О\s*т\s*в\s*е\s*т\s*[:.;]?.{0,40}$')
out = {}
for v, d in sorted(idx.items(), key=lambda x: int(x[0])):
    lines = []
    for p in range(d['pdfStart'], d['pdfEnd'] + 1):
        lines.append(f'<<PAGE {p}>>')
        for ln in open(f'{R}/ocr/p{p:03d}.txt', encoding='utf-8').read().split('\n'):
            if ln.strip() and not FOOT.search(ln): lines.append(ln)
    open(f'{R}/seg/v{int(v):02d}.txt', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    n = sum(1 for ln in lines if ANS.match(ln))
    out[int(v)] = n
print({v: n for v, n in out.items() if n != 26} or 'all 26', 'total', sum(out.values()))
