"""Print a variant's OCR lines with anchors (#n) for transcription. Usage: show.py R N"""
import json, sys, re
R, v = sys.argv[1], int(sys.argv[2]); a = json.load(open(f'{R}/tasks/anchors_v{v:02d}.json'))
L = a['lines']; inv = {}
for k, i in a['anchors'].items():
    if i is not None: inv.setdefault(i, []).append(k)
for i, l in enumerate(L):
    s = l.strip()
    if not s or re.match(r'^(Копирование|Копиров|©|последовательность цифр|работы, а затем|начиная с первой|символов\. Каждую|с приведёнными в бланке|ВАРИАНТ \d+ \d+|Часть 1)', s): continue
    tag = ('#' + ','.join(inv[i]) + ' ') if i in inv else ''
    print(f'{i} {tag}{s}')
