"""Find tasks of variant N whose OCR option block matches an already built 2026 variant's task (same number).
Compares letters of the task's OCR span with built conditions. Usage: repeats.py R N"""
import json, re, sys, glob
R, N = sys.argv[1], int(sys.argv[2])
letters = lambda s: re.sub(r'[^а-яё]', '', s.lower())
a = json.load(open(f'{R}/tasks/anchors_v{N:02d}.json')); L = a['lines']; an = a['anchors']
order = sorted([(an[str(n)], n) for n in range(1, 28)])
spans = {}
for k, (i, n) in enumerate(order):
    j = order[k + 1][0] if k + 1 < len(order) else len(L)
    spans[n] = letters(' '.join(L[i:j]))
built = {}
for f in glob.glob(f'{R}/build/v*.json'):
    d = json.load(open(f))
    if d['variant'] == N: continue
    for t in d['tasks']: built[(d['variant'], t['taskNumber'])] = letters('\n\n'.join(t['conditionMd'].split('\n\n')[1:]))
for n in range(4, 27):
    s = spans[n]; best = (0, None)
    for (v, m), c in built.items():
        if m != n or len(c) < 40: continue
        ws = [c[i:i + 20] for i in range(0, len(c) - 20, 10)]
        r = sum(w in s for w in ws) / len(ws)
        if r > best[0]: best = (r, v)
    if best[0] >= 0.6: print(f'№{n}: {best[0]:.2f} like В{best[1]}')
