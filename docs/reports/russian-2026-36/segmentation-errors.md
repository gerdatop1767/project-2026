# Segmentation log — Дощинский ЕГЭ 2026 (36 вариантов)

- Variants found: 36 (headers «ВАРИАНТ N» + «Часть 1»). Positions anchored: 972 (36 × 27), passages A/B: 72.
- Page numbering: printed page = PDF page + 9 (front matter not included in the PDF).
- Pages per variant: 8–10 (В13: 10 pages, PDF 102–111; PDF 111 is a short page).

## Scanning / OCR anomalies that affected segmentation

- PDF 172 (В20) and PDF 188 (В22) are scanned upside down (tesseract OSD: rotate 180). Re-OCRed after rotation; cache entries carry `rotation: 180`.

## Manual anchor corrections (not data changes)

- В15: 9→line 164, 10→line 172, 11→line 180, 12→line 188. OCR damaged the wording of №9 on PDF p.124 ('НЫЕ' instead of 'пропущена'): the regex matched №10 as №9 and shifted 9–12. Verified by the 'Укажите варианты' lines and 'Ответ' separators.
- В24: 9→line 150, 10→line 159. OCR split the headings of №9 and №10 ('Укажите варианты ответов, в которых во' / 'всех словах…'): the regex matched the second halves. Starts set to the 'Укажите' lines; the line order of №10's heading is to be checked against the scan when the variant is transcribed.
- В36: passageB→line 268. The heading 'Прочитайте текст и выполните задания 23–27' on PDF p.311 is not recognised (line 268 is OCR noise); text B starts at line 269 '(1)Если бы можно было'.

## Boxed task numbers misread by OCR (anchors verified by order and content, no action)

В2 №17 «[7]», В5 №11 «[21]», В7 №17 «[27]», В11 №17 «[9]», В14 №27 «[2]», В16 №17 «[27]», В18 №11 «[22]», В19/В28/В30 №11 «[12]», В25 №7 «[1]», В25 №23 «[28]», В30 №27 «[21]», В33 №7 «[1]».

## Structural check

- Inside every task span there is no line that starts another task (instruction-start regex), after the corrections above.
