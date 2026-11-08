"""Writes the pipeline state into the repo: docs/reports/russian-2026-36/{import-progress.json, duplicate-review.md, answer-review.md, ocr-manifest.json, ...}
Usage: progress.py R REPO"""
import json, glob, os, re, sys, shutil, subprocess
R, REPO = sys.argv[1], sys.argv[2]
D = f'{REPO}/docs/reports/russian-2026-36'; P = f'{D}/pipeline'
os.makedirs(f'{P}/data', exist_ok=True); os.makedirs(f'{P}/tools', exist_ok=True)
# OCR manifest (no text): one entry per PDF page
man = [json.load(open(f)) for f in sorted(glob.glob(f'{R}/ocr/p*.json'))]
json.dump(man, open(f'{D}/ocr-manifest.json', 'w'), ensure_ascii=False, indent=0)
for f in ('seg/index.json', 'seg/overrides.json', 'seg/tasks_index.json', 'answers/verify.json', 'answers/key_final.json'):
    shutil.copy(f'{R}/{f}', f'{P}/{os.path.basename(f)}')
for f in glob.glob(f'{R}/data/*'): shutil.copy(f, f'{P}/data/')
for f in glob.glob(f'{R}/tools/*.py') + glob.glob(f'{R}/tools/*.sh'): shutil.copy(f, f'{P}/tools/')
shutil.copy(f'{R}/reports/segmentation-errors.md', f'{D}/segmentation-errors.md')
key = json.load(open(f'{R}/answers/key_final.json'))
built = {int(re.search(r'v(\d+)', f).group(1)): json.load(open(f)) for f in glob.glob(f'{R}/build/v*.json')}
review = [(v, t['taskNumber'], t['review']) for v, d in sorted(built.items()) for t in d['tasks'] if t['status'] == 'needs_review']
prog = {
  'book': 'ЕГЭ 2026. Русский язык. 36 типовых экзаменационных вариантов (под ред. Р. А. Дощинского)',
  'ocr': {'pages': len(man), 'done': sum(m['status'] == 'ocr_done' for m in man), 'rotated': [m['pdfPage'] for m in man if m.get('rotation')]},
  'segmentation': {'variants': 36, 'positionsAnchored': 972, 'manualAnchorCorrections': len(json.load(open(f'{R}/seg/overrides.json')))},
  'answerKey': {'variants': len(key), 'answers': sum(len(x) for x in key.values()),
                'confirmedOcrAndScan': sum(e['source'] == 'ocr+visual' for x in key.values() for e in x.values()),
                'readFromScanZoom': sum(e['source'] == 'visual' for x in key.values() for e in x.values())},
  'variantsPrepared': sorted(built), 'positionsPrepared': sum(len(d['tasks']) for d in built.values()),
  'published': sum(t['status'] == 'published' for d in built.values() for t in d['tasks']),
  'needsReview': [{'variant': v, 'task': n, 'reason': r} for v, n, r in review],
}
json.dump(prog, open(f'{D}/import-progress.json', 'w'), ensure_ascii=False, indent=1)
# answer review: every key note
lines = ['# Ключ ответов — журнал сверки (2026)', '', 'Источник: таблицы ответов учебника, PDF 315–332 (В1–В14 — часть 9; В15–В36 — отдельный файл ответов, пиксельно совпадает с частью 9).',
         'Каждая страница ключа сверена со сканом. «ocr+visual» — OCR и скан совпали; «visual» — значение взято со скана (увеличенный фрагмент), когда OCR ошибся.', '',
         '| Вариант | № | Ответ (как в ключе) | Страница PDF | Примечание |', '|---|---|---|---|---|']
for v in sorted(key, key=int):
    for n in sorted(key[v], key=int):
        e = key[v][n]
        if e.get('note') or e['source'] == 'visual':
            lines.append(f"| {v} | {n} | {e['raw'].replace('|', '/')} | {e['pdfPage']} | {e.get('note', 'со скана')} |")
open(f'{D}/answer-review.md', 'w').write('\n'.join(lines) + '\n')
print(json.dumps({k: prog[k] for k in ('variantsPrepared', 'positionsPrepared', 'published')}, ensure_ascii=False), 'needs_review', len(review))
# duplicate review: overlaps found by dupcheck.py (30-letter windows; task conditions without the instruction paragraph)
rows = [l.rsplit(' ', 1) for l in open(f'{R}/reports/dup.txt').read().splitlines() if not l.startswith('overlaps:')]
dl = ['# Возможные дубли — журнал проверки (2026)', '',
      'Сравнение: тексты A/Б и содержательная часть условий (без первого абзаца с инструкцией) с 18 вариантами Дощинского, книгой «36 вариантов» 2027 и другими вариантами книги 2026. Порог 0,3 по 30-буквенным фрагментам.',
      'Политика: задания 2026 и 2027 годов не объединяются автоматически — каждое хранится со своим источником и годом; полные совпадения внутри книги 2026 связываются ссылкой (`sameAs`), а не копируются.', '',
      '| Задание 2026 | С чем совпадает | Доля | Вывод |', '|---|---|---|---|']
for name_other, r in rows:
    name, other = name_other.split(' ', 2)[:2], name_other.split(' ', 2)[2]
    r = float(r)
    verdict = 'полное совпадение — оставлено отдельно (другой учебник/год)' if r >= 0.9 else ('частичное — проверить вручную' if r >= 0.6 else 'общие типовые формулировки — не дубль')
    dl.append(f"| {' '.join(name)} | {other} | {r:.2f} | {verdict} |")
open(f'{D}/duplicate-review.md', 'w').write('\n'.join(dl) + '\n')
