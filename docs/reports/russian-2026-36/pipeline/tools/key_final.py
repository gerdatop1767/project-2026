"""Final 2026 key: OCR column entries + visual verification (answers/verify.json).
Writes answers/key_final.json {v: {n: {raw, answers, anySequence, source, pdfPage, printedPage, keyFile}}} and prints format problems."""
import json, re, sys
R = sys.argv[1]
K = json.load(open(f'{R}/answers/key_cols.json')); V = json.load(open(f'{R}/answers/verify.json'))
ANY = 'любая другая последовательность этих цифр'
clean = lambda s: re.sub(r'\s*<\s*или\s*>\s*', ' <или> ', ' '.join(s.replace('_', ' ').split())).strip(' .,-')
out, bad = {}, []
for v in range(1, 37):
    k, ver = K[str(v)], V[str(v)]
    ents = ver.get('full') or k['entries']
    if len(ents) != 26: bad.append((v, 'entries', len(ents))); continue
    out[v] = {}
    for n in range(1, 27):
        raw = clean(ver['fixes'].get(str(n), ents[n - 1]))
        parts = [p.strip() for p in raw.split('<или>')]
        anyseq = any(ANY in p for p in parts)
        ans = [p for p in parts if ANY not in p]
        src = 'visual' if (ver.get('full') or str(n) in ver['fixes']) else 'ocr+visual'
        out[v][n] = {'raw': raw, 'answers': ans, 'anySequence': anyseq, 'source': src,
                     'pdfPage': k['pdfPage'], 'printedPage': k['printedPage'],
                     'keyFile': 'answer_key_source_pages_322-332.pdf' if k['pdfPage'] >= 322 else 'ege_russian_2026_part_9_pages_305-341.pdf'}
        if str(n) in ver['notes']: out[v][n]['note'] = ver['notes'][str(n)]
        a = ans
        if not a: bad.append((v, n, 'empty'))
        elif n in (8, 22) and not (len(a) == 1 and re.fullmatch(r'\d{5}', a[0])): bad.append((v, n, a))
        elif n in (1, 5, 6, 7, 25) and not all(re.fullmatch(r'[а-яё]+', x) for x in a): bad.append((v, n, a))
        elif n not in (1, 5, 6, 7, 8, 22, 25) and not all(re.fullmatch(r'\d+', x) for x in a): bad.append((v, n, a))
        elif n not in (1, 5, 6, 7, 8, 22, 25, 26) and any(len(set(x)) != len(x) for x in a): bad.append((v, n, a, 'repeated digit'))
        elif len(a) == 2 and n not in (1, 5, 6, 7, 25) and sorted(a[0]) != sorted(a[1]) : bad.append((v, n, a, 'alternatives are not permutations'))
json.dump(out, open(f'{R}/answers/key_final.json', 'w'), ensure_ascii=False, indent=1)
cells = sum(len(x) for x in out.values())
print('variants', len(out), 'cells', cells, 'visual-only', sum(e['source'] == 'visual' for x in out.values() for e in x.values()),
      'anySequence', sum(e['anySequence'] for x in out.values() for e in x.values()))
print('format problems', bad)
