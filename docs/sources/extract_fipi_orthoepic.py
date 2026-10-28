"""Extracts «Орфоэпический список – 2026» from FIPI's navigator PDF.

The list's forms are printed in bold; lemmas and notes are not. Usage:
    pdftohtml -xml -i -q -f 1 -l 6 ru-1-fonetika.pdf doc
    python3 extract_fipi_orthoepic.py doc.xml official.json
Cross-checked against a plain-text (pdftotext) rule-based extraction —
identical, 220 forms (docs/imports/stress-dictionary-audit-2026.md).
"""
import re, json, sys, html
from xml.etree import ElementTree as ET
doc = ET.parse(sys.argv[1]).getroot()
SECTIONS = ['Имена существительные','Имена прилагательные','Глаголы','Причастия и отглагольные прилагательные','Деепричастия','Наречия']
entries=[]; section=None; stop=False
for page in doc.iter('page'):
    pno=int(page.get('number'))
    # group text fragments into lines by `top` (±3px)
    frags=[]
    for t in page.iter('text'):
        txt=''.join(t.itertext())
        bold=t.find('b') is not None or (t.find('i') is not None and t.find('i').find('b') is not None)
        italic=t.find('i') is not None
        frags.append((int(t.get('top')), int(t.get('left')), txt, bold, italic, int(t.get('height'))))
    frags.sort()
    lines=[]
    for f in frags:
        if lines and abs(lines[-1][0]-f[0])<=4: lines[-1][1].append(f)
        else: lines.append([f[0],[f]])
    for top, fs in lines:
        fs.sort(key=lambda f:f[1])
        text=' '.join(f[2] for f in fs).strip()
        if text in SECTIONS: section=text; continue
        if text.startswith('Обратите внимание'): stop=True
        if stop or section is None: continue
        if text.startswith('Навигатор') or re.fullmatch(r'\d+',text): continue
        # within the line: bold fragments are list forms; plain/italic text after a bold form is its note
        cur=None
        for (_,left,txt,bold,italic,h) in fs:
            if bold and re.search(r'[А-ЯЁ]', txt) and re.search(r'[а-яё]', txt + 'а'):
                for part in [p.strip() for p in re.split(r'[;,]', txt) if p.strip()]:
                    cur={'marked':part,'page':pno,'section':section,'note':'','line':text}
                    entries.append(cur)
            elif cur is not None:
                cur['note']=(cur['note']+' '+txt).strip()
json.dump(entries, open(sys.argv[2],'w'), ensure_ascii=False, indent=1)
print(len(entries))
