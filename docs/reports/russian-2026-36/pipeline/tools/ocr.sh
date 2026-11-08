#!/bin/bash
# Resumable per-page OCR cache. Skips a page whose source sha256 is unchanged and whose text exists.
# Usage: ocr.sh R
R=$1; V=$(tesseract --version 2>&1 | head -1); P="convert -resize 200% -colorspace Gray; tesseract -l rus --psm 3"
export R V P OMP_THREAD_LIMIT=1
one() {
  f=$1; b=$(basename $f .ppm); n=${b#p}; n=$((10#$n))
  sha=$(sha256sum $f | cut -d' ' -f1); m=$R/ocr/$b.json
  if [ -s $R/ocr/$b.txt ] && [ -f $m ] && grep -q "\"sha256\": \"$sha\"" $m; then return; fi
  t=$R/ocr/$b.tmp.png; convert $f -resize 200% -colorspace Gray $t && tesseract $t $R/ocr/$b -l rus --psm 3 >/dev/null 2>&1; st=$?; rm -f $t
  part=$(( (n-1)/38 + 1 )); inpart=$(( (n-1)%38 + 1 ))
  printf '{"pdfPage": %d, "printedPage": %d, "part": %d, "pageInPart": %d, "sha256": "%s", "tool": "%s", "params": "%s", "date": "%s", "status": "%s", "chars": %d}\n' \
    $n $((n+9)) $part $inpart "$sha" "$V" "$P" "$(date -u +%FT%TZ)" $([ $st = 0 ] && echo ocr_done || echo ocr_failed) $(wc -c < $R/ocr/$b.txt 2>/dev/null || echo 0) > $m
}
export -f one
ls $R/pages/p*.ppm | xargs -P 4 -I{} bash -c 'one {}'
echo "DONE $(ls $R/ocr/*.txt | wc -l) pages"
