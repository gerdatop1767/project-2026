#!/bin/bash
# 2026 book: build all variants, generate TS, duplicate report, format, typecheck, tests, commit "$1", push.
set -e
R=/tmp/claude-0/-home-user-project-2026/d698dfb6-0e4d-52ab-9328-3a93c897f01e/scratchpad/rus26
REPO=/home/user/project-2026
for f in $R/data/v*.txt; do n=$(basename $f .txt); n=$((10#${n#v})); OUT=$(python3 -I $R/tools/build.py $R $n); echo "$OUT" | head -1; echo "$OUT" | grep -q "errors: 0" || { echo "$OUT"; echo BUILD ERRORS; exit 1; }; done
python3 -I $R/tools/gen_ts.py $R $REPO/packages/db/src/russianDoshchinsky2026
python3 -I $R/tools/dupcheck.py $R $REPO/packages/db/src > $R/reports/dup.txt; tail -1 $R/reports/dup.txt
python3 -I $R/tools/progress.py $R $REPO
cd $REPO
npx prettier --write packages/db/src/russianDoshchinsky2026 docs/reports/russian-2026-36 >/dev/null
pnpm -F @zybrilka/db exec tsc --noEmit -p . 
OUT=$(cd packages/db && npx vitest run src/importRussianDoshchinsky2026Book36.test.ts 2>&1); echo "$OUT" | grep -E "Tests |AssertionError|FAIL" | head; echo "$OUT" | grep -q " failed" && { echo TEST FAILED; exit 1; }
git add packages/db/src/russianDoshchinsky2026 docs/reports/russian-2026-36 $EXTRA
git commit -q -m "$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V5aXJ7wVgr1fgsBGegHuoa"
for i in 1 2 3 4; do git push -q origin chore/add-emil-design-eng-skill && break || sleep $((2**i)); done
git log --oneline -1; git status -sb | head -1
