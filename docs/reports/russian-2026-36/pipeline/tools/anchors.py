"""2026 book: ordered anchors for passage A, tasks 1-26, passage B, task 27 (essay). Two passes:
instruction regex, then boxed-number / loose regex between known neighbours. Writes tasks/anchors_vNN.json."""
import re, json, sys
R = sys.argv[1]
A = {
 1: r'Самостоятельно\s+подбер',
 2: r'выделено\s+пять\s+слов|лексическое\s+значение\s+выделенного',
 3: r'характеристики\s+текста',
 4: r'ударн\w*\s+гласн',
 5: r'НЕВЕРНО\s+употреблен',
 6: r'Отредактируйте|исключив\s+лишн',
 7: r'допущена\s+грамматическ|выделенных\s+ниже\s+слов\s+допущен',
 8: r'соответствие\s+между\s+грамматическ',
 9: r'одного\s+ряда\s+пропущен',
 10: r'одного\s+ряда\s+пропущен',
 11: r'одного\s+ряда\s+пропущен',
 12: r'одного\s+ряда\s+пропущен',
 13: r'НЕ\s+с\s+выделенн',
 14: r'выделенные\s+слова\s+пишутся',
 15: r'пишется\s+(НН|одна\s+буква|Н\b|две)',
 16: r'ОДНУ\s+запят',
 17: r'стоять\s+запят',
 18: r'стоять\s+запят',
 19: r'стоять\s+запят',
 20: r'стоять\s+запят',
 21: r'Найдите\s+предложения,?\s+в\s+которых\s+(запят|тире|двоеточ|скобк)',
 22: r'соответствие\s+между\s+предложениями',
 23: r'(высказываний|утверждений)\s+(не\s+)?соответству\w*\s+содержани|соответствуют\s+содержанию',
 24: r'перечисленных\s+утверждений\s+являются',
 25: r'^\W{0,4}(\d{1,2}\s*\W{0,3})?(Из|В)\s+предложени\w*\s+[\dЗ][^)]{0,30}(выпиш|найд|укаж)',
 26: r'Среди\s+предложений',
}
PASS_A = r'Прочитайте\s+текст\s+и\s+выполните\s+задания\s+1'
PASS_B = r'Прочитайте\s+текст\s+и\s+выполните\s+задания\s+2[23]'
ESSAY = r'Нап\w*\s+сочинение|сочинение-рассуждение\s+по\s+проблеме'
LOOSE = {
 1: r'подберите|Самостоятельно',
 4: r'ударн|обозначающ\w*\s+ударн|буква,\s+обознач',
 7: r'грамматическ\w*\s+ошибк|Исправьте\s+ошибку|ошибка\.\s*Исправьте|Исправьте',
 8: r'соответствие\s+между\s+грамм|ГРАММАТИЧЕСКИЕ\s+ОШИБК',
 11: r'пропущен\w*\s+одна\s+и\s+та\s+же|одного\s+ряд',
 12: r'пропущен\w*\s+одна\s+и\s+та\s+же|одного\s+ряд|обоих\s+слов',
 13: r'\bНЕ\b.*(СЛИТНО|РАЗДЕЛЬНО)|с\s+выделенн',
 15: r'\bНН\b|буква\s+Н\b|одна\s+буква',
 20: r'запят|Укажите\s+цифр',
 21: r'Найдите\s+предложени|в\s+соответствии\s+с\s+одним',
 22: r'Установите\s+соответствие|ИЗОБРАЗИТЕЛЬНО',
 23: r'содержани\w*\s+текста|соответству',
 24: r'утверждений|ошибочн|являются\s+верн',
 25: r'выпишите|Из\s+предложени',
 26: r'Среди\s+предлож|связан\w*\s+с\s+предыдущ',
}

NUMPRE = lambda n: rf'^\W{0,3}{n}\s*[\]|)]?\s+[А-ЯЁ]'
flat_ = lambda s: re.sub(r'\s+', ' ', s)
bad = 0
import os
OVR = json.load(open(f'{R}/seg/overrides.json')) if os.path.exists(f'{R}/seg/overrides.json') else {}
for v in range(1, 37):
    L = open(f'{R}/seg/v{v:02d}.txt', encoding='utf-8').read().rstrip('\n').split('\n')
    F = [flat_(l) for l in L]
    def find(pat, frm, to=None):
        for i in range(frm, len(L) if to is None else to):
            if re.search(pat, F[i]) or (i + 1 < len(L) and re.search(pat, F[i] + ' ' + F[i + 1]) and not re.search(pat, F[i + 1])):
                return i
        return None
    pos = {}
    pos['passageA'] = find(PASS_A, 0)
    cur = (pos['passageA'] or 0) + 1
    for n in range(1, 27):
        if n == 23:
            pos['passageB'] = find(PASS_B, cur)
            if pos['passageB'] is not None: cur = pos['passageB'] + 1
        i = find(A[n], cur)
        pos[n] = i
        if i is not None: cur = i + 1
    pos[27] = find(ESSAY, cur)
    for n in range(1, 27):
        if pos.get(n) is not None: continue
        lo = max([pos[k] for k in range(1, n) if pos.get(k) is not None] + [pos['passageA'] or 0]) + 1
        hi = min([pos[k] for k in range(n + 1, 28) if pos.get(k) is not None] + [len(L)])
        if n == 23 and pos.get('passageB') is not None: lo = max(lo, pos['passageB'] + 1)
        cand = [i for i in range(lo, hi) if re.search(NUMPRE(n), L[i])]
        if not cand and n in LOOSE: cand = [i for i in range(lo, hi) if re.search(LOOSE[n], L[i])]
        pos[n] = cand[0] if cand else None
    if pos.get('passageB') is None and pos.get(23) is not None and pos.get(22) is not None:
        for i in range(pos[22] + 1, pos[23]):
            if re.search(r'Прочитайте\s+текст', L[i]): pos['passageB'] = i; break
    ov = OVR.get(str(v), {}).get('anchors', {})
    for k, x in ov.items(): pos[int(k) if k.isdigit() else k] = x
    order = [pos[n] for n in range(1, 28) if pos.get(n) is not None]
    mono = all(x < y for x, y in zip(order, order[1:]))
    missing = [n for n in range(1, 28) if pos.get(n) is None]
    if missing or not mono or pos.get('passageA') is None or pos.get('passageB') is None:
        bad += 1; print(v, 'missing', missing, 'monotonic', mono, 'A', pos['passageA'], 'B', pos.get('passageB'))
    json.dump({'variant': v, 'lines': L, 'anchors': pos}, open(f'{R}/tasks/anchors_v{v:02d}.json', 'w'), ensure_ascii=False)
print('variants with anomalies:', bad)
