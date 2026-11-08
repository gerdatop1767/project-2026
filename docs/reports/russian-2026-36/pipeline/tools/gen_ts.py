"""2026 book: build/vNN.json -> packages/db/src/russianDoshchinsky2026/variantNN.ts (+ index.ts of all built variants)."""
import json, re, sys, glob
R, OUT = sys.argv[1], sys.argv[2]
IDX = json.load(open(f'{R}/seg/index.json'))
PARTS = [(1, 38, 1), (39, 76, 2), (77, 114, 3), (115, 152, 4), (153, 190, 5), (191, 228, 6), (229, 266, 7), (267, 304, 8), (305, 341, 9)]
def part_file(p):
    for a, b, n in PARTS:
        if a <= p <= b: return f'ege_russian_2026_part_{n}_pages_{a}-{b}.pdf'
def plain(md): return re.sub(r'\s+', ' ', md.replace('***', '').replace('**', '').replace('*', '')).strip()
def js(x): return json.dumps(x, ensure_ascii=False)
built = []
for f in sorted(glob.glob(f'{R}/build/v*.json')):
    d = json.load(open(f)); v = d['variant']; built.append(v)
    a, b = IDX[str(v)]['pdfStart'], IDX[str(v)]['pdfEnd']
    files = sorted({part_file(a), part_file(b)})
    P = d['passages']
    def pas(k):
        p = P[k]
        return {'title': p['title'], 'bodyMd': p['bodyMd'], 'sourceAuthor': p['author'], 'sourceNote': p['note']}
    tasks = []
    for t in d['tasks']:
        o = {'taskNumber': t['taskNumber'], 'topicSlug': t['topicSlug'], 'topicName': t['topicName'],
             'passage': t['passage'], 'sourcePage': t['sourcePage'] or a, 'conditionMd': t['conditionMd'],
             'rawStatement': plain(t['conditionMd']), 'answerType': t['answerType'], 'correctAnswer': t['correctAnswer'],
             'acceptedAnswers': t['acceptedAnswers'], 'digitSetOrderInsensitive': t['digitSetOrderInsensitive'],
             'correctAnswerDisplay': t['correctAnswerDisplay']}
        if t.get('multiPart'): o['multiPart'] = [{'id': c['id'], 'label': c['label'], 'correctAnswer': c['correctAnswer']} for c in t['multiPart']]
        o.update({'explanationMd': t['explanationMd'], 'hintMd': t['hintMd']})
        if t['answerType'] == 'essay': o['sampleEssayMd'] = t['sampleEssayMd']
        o.update({'status': t['status'], 'reviewReason': t['review']})
        if t.get('sameAs'): o['sameAs'] = t['sameAs']
        tasks.append(o)
    data = {'variant': v, 'sourceFile': ' + '.join(files), 'sourcePageStart': a, 'sourcePageEnd': b,
            'passages': {'A': pas('A'), 'B': pas('B')}, 'tasks': tasks}
    src = (f"// Generated from the scan of the 2026 book (variant {v}, PDF pages {a}–{b}); edit the source data, not this file.\n"
           "import type { RussianBookVariant } from '../russianBook/types.js';\n\n"
           f"export const variant{v:02d}: RussianBookVariant = {js(data)};\n")
    open(f'{OUT}/variant{v:02d}.ts', 'w').write(src)
idx = ("// Generated: every variant of the 2026 36-variant book that has been prepared so far.\n"
       "import type { RussianBookVariant } from '../russianBook/types.js';\n")
idx += ''.join(f"import {{ variant{v:02d} }} from './variant{v:02d}.js';\n" for v in built)
idx += "\nexport const r26Variants: readonly RussianBookVariant[] = [" + ', '.join(f'variant{v:02d}' for v in built) + "];\n"
open(f'{OUT}/index.ts', 'w').write(idx)
print('generated', built)
