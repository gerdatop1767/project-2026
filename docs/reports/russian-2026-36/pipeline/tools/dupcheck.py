"""Overlap of 2026 passages/conditions with the bot's Russian content (2027 book, 18 Дощинский variants, other 2026 variants).
30-letter windows every 15 letters; prints overlaps >= 0.3. Usage: dupcheck.py R SRC_DIR"""
import json, re, sys, glob, os
R, SRC = sys.argv[1], sys.argv[2]
letters = lambda s: re.sub(r'[^а-яё]', '', s.lower())
def windows(s):
    n = letters(s); return [n[i:i+30] for i in range(0, len(n) - 30, 15)]
others = {}
for f in glob.glob(f'{SRC}/importRussianDoshchinsky2027Variant*.ts'):
    if f.endswith('.test.ts'): continue
    others['18v:' + os.path.basename(f)] = letters(open(f).read().replace('\\n', ' '))
for f in glob.glob(f'{SRC}/russianDoshchinsky36/variant*.ts'):
    others['2027book:' + os.path.basename(f)] = letters(open(f).read().replace('\\n', ' '))
built = {int(re.search(r'v(\d+)', f).group(1)): json.load(open(f)) for f in glob.glob(f'{R}/build/v*.json')}
hits = []
for v, d in sorted(built.items()):
    BOIL = re.compile(r'^(Запишите в таблицу|\*\*[А-ЯЁ -]+\*\*$|\(По |\([А-ЯЁ]\. )')
    def content(t):
        paras = t['conditionMd'].split('\n\n')[1:]
        return '\n'.join(x for x in paras if not BOIL.match(x.strip()))
    items = [(f'В{v} текст {k}', p['bodyMd']) for k, p in d['passages'].items()] + [(f'В{v} №{t["taskNumber"]}', content(t)) for t in d['tasks'] if t['taskNumber'] not in (1, 25, 26, 27)]
    for name, text in items:
        ws = windows(text)
        if len(ws) < 4: continue
        for oname, o in others.items():
            r = sum(w in o for w in ws) / len(ws)
            if r >= 0.3: hits.append((name, oname, round(r, 2)))
        for v2, d2 in built.items():
            if v2 == v: continue
            o = letters(json.dumps(d2, ensure_ascii=False))
            r = sum(w in o for w in ws) / len(ws)
            if r >= 0.3: hits.append((name, f'2026 В{v2}', round(r, 2)))
for h in hits: print(*h)
print('overlaps:', len(hits))
