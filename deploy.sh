#!/usr/bin/env bash
# =====================================================================
# 무료 자료실 배포 ("자료실 배포해줘" 라고 하면 이걸 실행해요)
#
#   ./deploy.sh            지금 바뀐 것을 확인 → main 에 올려요
#   ./deploy.sh "메모"      커밋 메시지에 메모를 붙여요
#
# 하는 일
# 1. node build.js 로 자료실을 만들어 보고 (오류가 나면 멈춰요)
# 2. dist 에 index.html · embed.js · 자료 본문이 다 있는지 확인하고
# 3. 바뀐 파일을 커밋해서 GitHub main 에 올려요 → Vercel 이 1~2분 안에 새로 배포해요
#    https://viav-free-library.vercel.app
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "① 자료실 만들기"
node build.js

echo "② 결과 확인"
for f in dist/index.html dist/embed.js dist/assets/data.js dist/assets/app.js dist/assets/style.css; do
  [ -s "$f" ] || { echo "   ✗ $f 가 없어요. 배포를 멈춰요."; exit 1; }
done
items=$(ls dist/assets/items/*.json 2>/dev/null | wc -l | tr -d ' ')
echo "   ✓ 사이트 파일과 자료 본문 ${items}개"

echo "③ GitHub main 에 올리기"
git fetch -q origin main
branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "   지금 칸이 '$branch' 예요. main 에서 실행해 주세요 (git checkout main)."
  exit 1
fi
git pull -q --rebase origin main
git add -A
if git diff --cached --quiet; then
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
    echo "   바뀐 것이 없어요. 이미 최신이에요."
    exit 0
  fi
else
  msg="자료실 배포 ($(TZ=Asia/Seoul date +%Y-%m-%d))${1:+: $1}"
  git commit -q -m "$msg"
  echo "   커밋: $msg"
fi
for wait in 2 4 8 16 0; do
  if git push -q origin main; then
    echo "   ✓ 올렸어요. 1~2분 뒤 https://viav-free-library.vercel.app 에 반영돼요."
    exit 0
  fi
  [ "$wait" = 0 ] && break
  echo "   올리기 실패, ${wait}초 뒤 다시 해 볼게요"
  sleep "$wait"
done
echo "   ✗ GitHub 에 올리지 못했어요."
exit 1
