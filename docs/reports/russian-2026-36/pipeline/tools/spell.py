"""Words of a variant's OCR (from passage A start to the end) that hunspell ru_RU does not know, with line numbers. Usage: spell.py R N"""
import json, re, sys, subprocess
R, v = sys.argv[1], int(sys.argv[2]); a = json.load(open(f'{R}/tasks/anchors_v{v:02d}.json'))
L = a['lines']; start = a['anchors']['passageA']
words = {}
for i in range(start, len(L)):
    if re.search(r"[.,‚]{2}", L[i]): continue
    for w in re.findall(r'[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*', L[i]):
        if len(w) > 2 and not w.isupper(): words.setdefault(w, []).append(i)
out = subprocess.run(['hunspell', '-d', 'ru_RU', '-l'], input='\n'.join(words), capture_output=True, text=True).stdout.split()
out = [w for w in set(out) if w in words]
for w in sorted(out, key=lambda x: words[x][0]): print(words[w][0], w)
