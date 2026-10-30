#!/usr/bin/env python3
"""노션 → 무료 자료실 매일 동기화

실행 (저장소 맨 위에서):
  python3 tools/sync.py            바뀐 게 있으면 ./deploy.sh 로 main 에 올려요
  python3 tools/sync.py --dry-run  비교 결과만 보여 주고 올리지 않아요
  python3 tools/sync.py --init     (처음 한 번) 지금 올라가 있는 자료를 기준으로 저장해요

먼저 할 일 (Claude 가 노션 연결로 해요, 이 파일은 노션에 직접 접속하지 않아요)
  notion_raw/_pages.json   「DM 자료 모음」 하위 페이지 목록 (아이콘 · 날짜 · 웹 게시)을 오늘 것으로 고치기
  notion_raw/<id>.md       비아브 로고 아이콘인 페이지의 노션 원문을 그대로 저장하기

하는 일
  1. 올릴 자료(비아브 로고 · 웹 게시 꺼짐 아님 · 템플릿 아님)를 지난번에 올린 목록(tools/sync_state.json)과 비교해요
     - 새 자료: 지난번에 없던 자료
     - 바뀐 자료: 노션 원문 · 제목 · 날짜 · 분야 · 받는 것 · 소개 중 하나라도 달라진 자료
     - 내린 자료: 지난번엔 있었는데 🔴 · 웹 게시 꺼짐 · 노션에서 빠짐으로 이번엔 없는 자료
  2. tools/notion_import_map.json 에 없는 새 자료는 제목으로 분야를 정해요. 애매하면 "확인 필요" 로 남겨요
  3. 바뀐 게 있으면 notion_import.py → ./deploy.sh 로 올리고, 없으면 올리지 않아요
  4. tools/sync.log 에 한 줄 남겨요
     2026-10-31 05:53 · 새 자료 1 · 바뀐 자료 0 · 내린 자료 0 · 올림 ✓ · 확인 필요: 없음
"""
import datetime
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "notion_raw"
MAP = ROOT / "tools" / "notion_import_map.json"
STATE = ROOT / "tools" / "sync_state.json"
LOG = ROOT / "tools" / "sync.log"
READY_ICON = "viav-monogram"
KST = datetime.timezone(datetime.timedelta(hours=9))

# 제목으로 분야 정하기 (위에서부터 먼저 맞는 쪽). 두 분야 이상 맞거나 하나도 안 맞으면 "확인 필요"
CATEGORY_WORDS = [
    ("주문으로-이어지기", ["주문", "DM", "프로필", "답장", "예약", "안내문", "문의", "판매", "구매"]),
    ("AI로-콘텐츠-만들기", ["AI", "프롬프트", "챗GPT", "ChatGPT", "Claude", "클로드", "Gemini", "캔바", "카드뉴스", "자동"]),
    ("릴스-기획-촬영", ["릴스", "촬영", "찍기", "편집", "장면", "대본", "훅", "후킹", "손님", "기획", "자막"]),
]
DEFAULT_CATEGORY = "릴스-기획-촬영"


def clean_title(t):
    t = re.sub(r"^\s*[🔴🟢🟡⚪️]\s*", "", t)
    return re.sub(r"^CC\s*\|\s*", "", t).strip()


def guess_category(title):
    hits = [cat for cat, words in CATEGORY_WORDS if any(w.lower() in title.lower() for w in words)]
    if len(hits) == 1:
        return hits[0], None
    if not hits:
        return DEFAULT_CATEGORY, f"{title}: 제목으로 분야를 못 정해서 {DEFAULT_CATEGORY} 에 넣었어요"
    # "AI 프롬프트" 와 "주문" 처럼 둘 다 맞으면 앞쪽(더 구체적인) 분야에 넣고 확인을 부탁해요
    return hits[0], f"{title}: 분야가 애매해요 ({' / '.join(hits)}) → {hits[0]} 에 넣었어요"


def slug_for(page_id, used):
    base = f"item-{page_id[:8]}"
    s, n = base, 2
    while s in used:
        s, n = f"{base}-{n}", n + 1
    return s


def first_line(md):
    for line in md.splitlines():
        t = re.sub(r"<[^>]+>", "", line).strip()
        if t and not t.startswith(("#", "|", "-", "!", "👉", "```", ">")) and len(t) > 8:
            return re.sub(r"\\(.)", r"\1", t)[:60]
    return ""


def fingerprint(page, entry):
    raw = RAW / f"{page['id']}.md"
    body = raw.read_text(encoding="utf-8") if raw.exists() else ""
    keys = [page.get("notion_title", ""), page.get("date", ""), body] + [str(entry.get(k, "")) for k in ("분야", "주소", "받는것", "소개", "제목앞")]
    return hashlib.sha256("\n␞".join(keys).encode("utf-8")).hexdigest()[:16]


def main():
    dry = "--dry-run" in sys.argv
    now = datetime.datetime.now(KST)
    pages = json.loads((RAW / "_pages.json").read_text(encoding="utf-8"))["pages"]
    mapping_doc = json.loads(MAP.read_text(encoding="utf-8"))
    mapping = mapping_doc["pages"]
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {"published": {}}
    before = state.get("published", {})
    checks, added_map = [], []

    ready = {}
    for p in pages:
        title = p.get("notion_title", "")
        if "템플릿" in title and "삭제 금지" in title:
            continue
        if READY_ICON not in p.get("icon", "") or p.get("web_published") is False:
            continue
        if not (RAW / f"{p['id']}.md").exists():
            checks.append(f"{clean_title(title)}: 노션 원문이 저장되지 않아 이번엔 건너뛰었어요")
            continue
        if p["id"] not in mapping:
            # Claude 가 미리 채우지 못한 새 자료: 제목으로 분야를 정하고, 주소 이름은 임시로 만들어요
            cat, note = guess_category(clean_title(title))
            used = {m.get("주소") for m in mapping.values()}
            mapping[p["id"]] = {
                "분야": cat,
                "주소": slug_for(p["id"], used),
                "받는것": "",
                "소개": first_line((RAW / f"{p['id']}.md").read_text(encoding="utf-8")),
            }
            added_map.append(clean_title(title))
            checks.append(note or f"{clean_title(title)}: 분야는 {cat}, 주소 이름은 임시예요 (받는 것 · 소개 확인 필요)")
        ready[p["id"]] = {"title": clean_title(title), "hash": fingerprint(p, mapping[p["id"]]),
                          "slug": mapping[p["id"]]["주소"], "category": mapping[p["id"]]["분야"]}

    new = [pid for pid in ready if pid not in before]
    changed = [pid for pid in ready if pid in before and before[pid].get("hash") != ready[pid]["hash"]]
    removed = [pid for pid in before if pid not in ready]

    def names(ids, src):
        return ", ".join(src[i]["title"] for i in ids)

    summary = f"새 자료 {len(new)} · 바뀐 자료 {len(changed)} · 내린 자료 {len(removed)}"
    print(summary)
    for label, ids, src in (("+ 새", new, ready), ("~ 바뀐", changed, ready), ("- 내린", removed, before)):
        if ids:
            print(f"  {label}: {names(ids, src)}")
    if checks:
        print("  확인 필요: " + " / ".join(checks))

    if dry:
        print("(--dry-run 이라 올리지 않았어요)")
        return
    if "--init" in sys.argv:
        # 처음 한 번: 지금 자료실에 올라가 있는 자료를 "지난번에 올린 목록"으로 저장해요 (올리지 않아요)
        STATE.write_text(json.dumps({"published": ready, "updated": now.strftime("%Y-%m-%d %H:%M")}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"지금 자료 {len(ready)}개를 기준으로 저장했어요")
        return

    pushed = "바뀐 게 없어 안 올림"
    if new or changed or removed:
        if added_map:
            MAP.write_text(json.dumps(mapping_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        subprocess.run([sys.executable, str(ROOT / "tools" / "notion_import.py")], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
        state = {"published": ready, "updated": now.strftime("%Y-%m-%d %H:%M")}
        STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        line = log_line(now, summary, "올림 ✓", checks)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
        detail = "; ".join(f"{k} {names(v, s)}" for k, v, s in (("새", new, ready), ("바뀐", changed, ready), ("내린", removed, before)) if v)
        r = subprocess.run(["./deploy.sh", f"{summary} ({detail})"], cwd=ROOT)
        if r.returncode != 0:
            # 올리기에 실패하면 기록을 고쳐 남겨요 (다음 실행 때 다시 올라가요)
            lines = LOG.read_text(encoding="utf-8").splitlines()
            lines[-1] = log_line(now, summary, "올리기 실패 ✗", checks)
            LOG.write_text("\n".join(lines) + "\n", encoding="utf-8")
            STATE.write_text(json.dumps({"published": before}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print("올리기 실패")
            sys.exit(1)
        pushed = "올림 ✓"
    else:
        with LOG.open("a", encoding="utf-8") as f:
            f.write(log_line(now, summary, pushed, checks) + "\n")
        # 바뀐 게 없는 날도 기록 한 줄은 저장소에 남겨요 (사이트 내용은 그대로예요)
        if subprocess.run(["./deploy.sh", "기록만"], cwd=ROOT).returncode != 0:
            print("기록을 GitHub 에 올리지 못했어요 (사이트는 그대로예요)")
    print(log_line(now, summary, pushed, checks))


def log_line(now, summary, pushed, checks):
    return f"{now:%Y-%m-%d %H:%M} · {summary} · {pushed} · 확인 필요: {' / '.join(checks) if checks else '없음'}"


if __name__ == "__main__":
    main()
