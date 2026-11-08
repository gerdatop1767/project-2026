"""Paragraph starts of text B from line indentation (tesseract TSV, cached in tsv/). Prints sentence numbers that open an
indented line, i.e. paragraph starts, for the DSL 'para:' key. Usage: paras.py R N"""
import sys, csv, json, subprocess, os, re, statistics
R, N = sys.argv[1], int(sys.argv[2])
idx = json.load(open(f'{R}/seg/tasks_index.json'))[str(N)]['items']
p0, p1 = idx['passageB']['pdfPage'], idx['23']['pdfPage']
res = []
for p in range(p0, p1 + 1):
    t = f'{R}/tsv/p{p}.tsv'
    if not os.path.exists(t):
        img = f'{R}/pages/p{p:03d}.ppm'
        if p in (172, 188):
            subprocess.run(['convert', img, '-rotate', '180', f'{R}/tsv/rot{p}.png']); img = f'{R}/tsv/rot{p}.png'
        subprocess.run(['tesseract', img, t[:-4], '-l', 'rus', '--psm', '3', 'tsv'], capture_output=True, env={**os.environ, 'OMP_THREAD_LIMIT': '1'})
    rows = list(csv.DictReader(open(t), delimiter='\t', quoting=csv.QUOTE_NONE))
    lines = {}
    for r in rows:
        if r['level'] != '5' or not r['text'].strip(): continue
        k = (r['block_num'], r['par_num'], r['line_num'])
        lines.setdefault(k, []).append(r)
    L = []
    for k, ws in lines.items():
        ws.sort(key=lambda w: int(w['left']))
        L.append((int(ws[0]['top']), int(ws[0]['left']), ' '.join(w['text'] for w in ws)))
    L.sort()
    lefts = [l for _, l, txt in L if len(txt) > 50]
    if not lefts: continue
    base = statistics.median(lefts)
    for top, left, txt in L:
        m = re.match(r'^[—–-]?\s*\((\d{1,2})\)', txt)
        if left - base > 18 and m: res.append(int(m.group(1)))
print(','.join(str(x) for x in sorted(set(res)) if x != 1))
