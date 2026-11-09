"""2026 book: build one variant from data/vNN.txt (DSL) + OCR anchors + final key -> build/vNN.json, with QC.
Tasks 1–26 take their answer from the book key (answers/key_final.json); task 27 is the essay (no answer).
Usage: build.py R N [--show]"""
import json, re, sys
W, V = sys.argv[1], int(sys.argv[2]); SHOW = '--show' in sys.argv
KEY = json.load(open(f'{W}/answers/key_final.json'))[str(V)]
L = json.load(open(f'{W}/tasks/anchors_v{V:02d}.json'))['lines']
KEYS = ('same', 'title', 'author', 'note', 'lines', 'fix', 'drop', 'append', 'text', 'topic', 'status', 'review',
        'cond', 'expl', 'hint', 'para', 'page', 'prepend', 'sample')
JUNK = re.compile(r'^(<<PAGE|ВАРИАНТ \d+|\d+\s+ЕГЭ|ЕГЭ\. ТИПОВЫЕ|Копирование|©|Ответ:)')

def parse(path):
    blocks, cur, key = [], None, None
    for raw in open(path, encoding='utf-8').read().split('\n'):
        m = re.match(r'^@(passage|task)\s+(\S+)\s*$', raw)
        if m:
            cur = {'kind': m.group(1), 'id': m.group(2), 'fix': [], 'drop': []}; blocks.append(cur); key = None; continue
        m = re.match(r'^(' + '|'.join(KEYS) + r'):\s?(.*)$', raw)
        if m and cur is not None:
            key, val = m.group(1), m.group(2)
            if key == 'fix':
                a, b = val.split(' => '); cur['fix'].append((a, b)); key = None
            elif key == 'drop':
                cur['drop'].append(val.strip()); key = None
            else:
                cur[key] = val
            continue
        if cur is not None and key:
            cur[key] = (cur[key] + '\n' + raw) if cur[key] else raw
    for b in blocks:
        for k in list(b):
            if isinstance(b[k], str): b[k] = b[k].strip()
    return blocks

def ranges(spec):
    out = []
    for part in spec.split(','):
        part = part.strip()
        if not part: continue
        a, _, b = part.partition('-'); out.extend(range(int(a), int(b or a) + 1))
    return out

def passage_text(b, errs):
    if 'text' in b and b['text']:
        body = b['text']
    else:
        drop = set()
        for d in b['drop']: drop.update(ranges(d))
        lines = [L[i] for i in ranges(b['lines']) if i not in drop and not JUNK.match(L[i].strip())]
        paras, cur = [], []
        for ln in lines:
            s = ln.strip()
            if not s:
                if cur and re.search(r'[.!?…»)]\s*$', cur[-1]): paras.append(cur); cur = []
                continue
            cur.append(s)
        if cur: paras.append(cur)
        def join(ls):
            t = ''
            for s_ in ls:
                t = (t + s_) if re.search(r'\w-$', t) else ((t + ' ' + s_) if t else s_)
            return re.sub(r'\s+', ' ', t)
        body = '\n\n'.join(join(p) for p in paras)
        if b.get('append'): body += '\n\n' + b['append']
        if b.get('prepend'): body = b['prepend'].replace('\\n', '\n').rstrip() + ('\n\n' if b['prepend'].endswith('\\n') else ' ') + body
    for a, c in b['fix']:
        if a not in body: errs.append(f"passage {b['id']}: fix not found: {a!r}")
        body = body.replace(a, c.replace('\\n', '\n'))
    for p in b.get('para', '').split(','):
        p = p.strip()
        if not p: continue
        if f'\n\n({p})' in body or f'\n\n— ({p})' in body or body.startswith(f'({p})'): continue
        if f' — ({p})' in body: body = body.replace(f' — ({p})', f'\n\n— ({p})', 1)
        elif f' ({p})' in body: body = body.replace(f' ({p})', f'\n\n({p})', 1)
        else: errs.append(f"passage {b['id']}: para ({p}) not found")
    body = re.sub(r'\((\d+)\)\s+', r'(\1)', body)
    for m in re.finditer(r'[,;]\s*(?:— )?\((\d+)\)', body):
        errs.append(f"passage {b['id']}: comma/semicolon before sentence ({m.group(1)}) — OCR period? check the scan")
    nums = [int(x) for x in re.findall(r'\((\d+)\)', body)]
    if nums and b['id'] == 'B':
        exp = list(range(1, max(nums) + 1))
        seen = [n for n in nums if n <= max(nums)]
        if sorted(set(seen)) != exp: errs.append(f'passage B: sentence numbers missing {sorted(set(exp) - set(seen))}')
        if seen != sorted(seen): errs.append(f'passage B: numbers out of order near {[x for x, y in zip(seen, seen[1:]) if y < x][:5]}')
    bad = re.findall(r'[A-Za-z]{2,}|[|\\@#$^&_{}~‘’‚©]|\s[,.;:]', re.sub(r'\((?:фр|англ|лат|нем|итал|греч)\. [A-Za-z ]+\)', '', re.sub(r'\d \: \d', '', re.sub(r'\b[IVXLC]+\b', 'Ⅹ', body.replace('*', '')))))
    if bad: errs.append(f"passage {b['id']}: suspicious {sorted(set(bad))[:15]}")
    return body

DEFAULT_TOPIC = {2: ('russian-lexical-meaning', 'Лексическое значение слова'), 3: ('russian-text-analysis', 'Анализ текста'),
 4: ('russian-orthoepy', 'Орфоэпия (ударение)'), 5: ('russian-paronyms', 'Паронимы'), 6: ('russian-lexical-norms', 'Лексические нормы'),
 7: ('russian-grammar-forms', 'Грамматические нормы (образование форм слова)'), 8: ('russian-grammar-errors', 'Грамматические ошибки (синтаксис)'),
 9: ('russian-root-spelling', 'Правописание корней'), 10: ('russian-prefix-spelling', 'Правописание приставок'),
 11: ('russian-suffix-spelling', 'Правописание суффиксов'), 12: ('russian-suffix-spelling', 'Правописание суффиксов (личные окончания глаголов)'),
 13: ('russian-not-with-words', 'Правописание НЕ с разными частями речи'), 14: ('russian-together-separate-spelling', 'Слитное, раздельное и дефисное написание слов'),
 15: ('russian-nn-spelling', 'Правописание Н и НН'), 16: ('russian-punctuation-homogeneous', 'Пунктуация при однородных членах и сложном предложении'),
 17: ('russian-punctuation-attributes', 'Пунктуация при деепричастных оборотах'), 18: ('russian-punctuation-parenthetical', 'Пунктуация при вводных словах и обращениях'),
 19: ('russian-punctuation-complex-sentence', 'Пунктуация в сложноподчинённом предложении'), 20: ('russian-punctuation-complex-sentence', 'Пунктуация в сложноподчинённом предложении'),
 21: ('russian-punctuation-rules', 'Пунктуационный анализ текста'), 22: ('russian-literary-devices', 'Изобразительно-выразительные средства языка'),
 23: ('russian-text-content-matching', 'Соответствие содержанию текста'), 24: ('russian-text-structure-analysis', 'Анализ структуры и типов речи текста'),
 25: ('russian-phraseology', 'Фразеологизмы'), 26: ('russian-sentence-connections', 'Средства связи предложений в тексте'),
 27: ('russian-essay', 'Сочинение-рассуждение (задание с развёрнутым ответом)')}
WORD = {1, 5, 6, 7, 25}

ANCH = json.load(open(f'{W}/tasks/anchors_v{V:02d}.json'))['anchors']
def page_of(n):
    i = ANCH.get(str(n))
    if i is None: return None
    for j in range(i, -1, -1):
        m = re.match(r'<<PAGE (\d+)>>', L[j])
        if m: return int(m.group(1))
    return None

def answer(n, errs):
    e = KEY[str(n)]; a = e['answers']
    out = {'acceptedAnswers': [], 'digitSetOrderInsensitive': False, 'answerType': 'short_answer', 'correctAnswerDisplay': None}
    if n in (8, 22):
        d = a[0]; ids = [('a', 'А'), ('b', 'Б'), ('v', 'В'), ('g', 'Г'), ('d', 'Д')]
        out['answerType'] = 'multi_part'
        out['multiPart'] = [{'id': i, 'label': l, 'answerType': 'short_answer', 'correctAnswer': c} for (i, l), c in zip(ids, d)]
        out['correctAnswer'] = d
        return out
    out['correctAnswer'] = a[0]; rest = a[1:]
    if n in WORD:
        out['acceptedAnswers'] = rest
        if rest: out['correctAnswerDisplay'] = ' / '.join(a)
        return out
    perm = all(sorted(x) == sorted(a[0]) for x in rest)
    if e['anySequence'] or (rest and perm and n != 26):
        out['digitSetOrderInsensitive'] = True
        if len(a[0]) > 1 and e['anySequence']: out['correctAnswerDisplay'] = f'{a[0]} (в любом порядке)'
        elif rest: out['correctAnswerDisplay'] = ' / '.join(a)
    else:
        out['acceptedAnswers'] = rest
        if rest: out['correctAnswerDisplay'] = ' / '.join(a)
    return out

blocks = parse(f'{W}/data/v{V:02d}.txt'); errs = []
CRITERIA = open(f'{W}/data/criteria.md', encoding='utf-8').read().strip()
for b_ in blocks:
    if b_.get('expl'): b_['expl'] = b_['expl'].replace('{{CRITERIA}}', CRITERIA)
passages = {}; tasks = {}
for b in blocks:
    if b['kind'] == 'passage':
        passages[b['id']] = {'title': b.get('title'), 'author': b.get('author'), 'note': b.get('note') or None,
                             'bodyMd': passage_text(b, errs)}
    else:
        n = int(b['id'])
        for k in ('cond', 'expl', 'hint'):
            if not b.get(k): errs.append(f'task {n}: missing {k}')
        if len(b.get('expl','')) <= 80: errs.append(f'task {n}: explanation too short')
        topic = b.get('topic')
        slug, name = (topic.split(' | ') if topic else DEFAULT_TOPIC.get(n, (None, None)))
        if not slug: errs.append(f'task {n}: no topic')
        t = {'taskNumber': n, 'topicSlug': slug, 'topicName': name, 'conditionMd': b.get('cond', ''),
             'explanationMd': b.get('expl', ''), 'hintMd': b.get('hint', ''), 'status': b.get('status', 'published'),
             'review': b.get('review'), 'sourcePage': int(b['page']) if b.get('page') else page_of(n),
             'passage': 'A' if n <= 3 else ('B' if n >= 23 else None)}
        if b.get('same'): t['sameAs'] = {'variant': int(b['same']), 'taskNumber': n}
        if n == 27:
            t.update({'answerType': 'essay', 'correctAnswer': '', 'acceptedAnswers': [], 'digitSetOrderInsensitive': False,
                      'correctAnswerDisplay': None, 'sampleEssayMd': b.get('sample') or None})
            if not t['sampleEssayMd']: errs.append('task 27: missing sample essay')
        else:
            t.update(answer(n, errs))
            if b.get('sample'): errs.append(f'task {n}: sample only for the essay')
        for fld in ('explanationMd', 'hintMd'):
            if re.search(r'[A-Za-z]', re.sub(r'\b[IVXLC]+\b', '', t[fld])): errs.append(f'task {n}: latin letters in {fld}')
        if t.get('sampleEssayMd') and re.search(r'[A-Za-z]', re.sub(r'\b[IVXLC]+\b', '', t['sampleEssayMd'])): errs.append(f'task {n}: latin letters in sample')
        c = t['conditionMd']
        if re.search(r'[A-Za-z]{3,}|@@|<<|\||[‘’‚©]', re.sub(r'\b[IVXLC]+\b', '', c.replace('**', ''))): errs.append(f'task {n}: suspicious chars in cond')
        if n in (2, 3, 4, 9, 10, 11, 12, 13, 14, 16, 23, 24):
            opts = re.findall(r'(?m)^(\d)\) ', c)
            if opts != [str(i) for i in range(1, len(opts) + 1)] or len(opts) < 5: errs.append(f'task {n}: options {opts}')
        if n in (8, 22) and len(re.findall(r'(?m)^[1-9]\) ', c)) < 7: errs.append(f'task {n}: <7 numbered rows')
        if n in (15, 17, 18, 19, 20) and t['digitSetOrderInsensitive'] is not None:
            mx = max([int(x) for x in re.findall(r'\((\d)\)', c)] or [0])
            if any(int(ch) > mx for ch in t['correctAnswer']): errs.append(f'task {n}: answer digit > max mark {mx}')
        if t['status'] == 'needs_review' and not t['review']: errs.append(f'task {n}: needs_review without reason')
        tasks[n] = t
missing = [n for n in range(1, 28) if n not in tasks]
if missing: errs.append(f'missing tasks {missing}')
for k in ('A', 'B'):
    if k not in passages: errs.append(f'missing passage {k}')
if 'B' in passages:
    mx = max([int(x) for x in re.findall(r'\((\d+)\)', passages['B']['bodyMd'])] or [0])
    for n in (24, 26):
        if n in tasks:
            for x in re.findall(r'\b(\d{1,2})\b', tasks[n]['conditionMd']):
                if int(x) > mx: errs.append(f'task {n}: refers to sentence {x} > {mx}')
    if 26 in tasks:
        rng = re.search(r'(\d+)\s*[–—-]\s*(\d+)', tasks[26]['conditionMd'])
        if rng:
            lo, hi = int(rng.group(1)), int(rng.group(2)); a = tasks[26]['correctAnswer']
            cand = [a] + tasks[26]['acceptedAnswers']
            ok = any(all(lo <= int(p) <= hi for p in re.findall(r'\d{2}|\d', x) ) for x in cand) or all(lo <= int(a[i:i+2]) <= hi for i in range(0, len(a), 2))
            if not ok and not (lo <= int(a) <= hi): errs.append(f'task 26: answer {a} outside {lo}-{hi}')
json.dump({'variant': V, 'passages': passages, 'tasks': [tasks[n] for n in sorted(tasks)]},
          open(f'{W}/build/v{V:02d}.json', 'w'), ensure_ascii=False, indent=1)
print(f'V{V}: {len(tasks)} tasks, {sum(t["status"]=="published" for t in tasks.values())} published, errors: {len(errs)}')
for e in errs: print('  !', e)
if SHOW:
    for k, p in passages.items(): print(f'--- passage {k} ---\n{p["bodyMd"]}\n')
