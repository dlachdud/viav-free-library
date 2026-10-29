#!/usr/bin/env python3
"""노션 「DM 자료 모음」 원본 → 자료실 자료 파일

실행 (free-library 폴더에서):  python3 tools/notion_import.py
그다음:                         node build.js

읽는 것
  notion_raw/_pages.json        노션 페이지 목록 (아이콘 · 날짜 · 웹 게시 상태)
  notion_raw/<id>.md            노션 원문 그대로 (notion-fetch 결과의 <content> 안쪽)
  tools/notion_import_map.json  페이지마다 분야 · 주소 이름 · 받는 것 · 한 줄 소개

만드는 것
  content/<분야>/<주소>.md      맨 위에 제목 · 주소 · 날짜 · 받는것 · 소개 · 노션
  tools/last_import.md          옮긴 자료와 건너뛴 자료 표

기준 (2026-10-29 초영님과 정함)
  - 아이콘이 비아브 로고(viav-monogram)인 페이지만 옮겨요. 🔴 등은 건너뛰어요.
  - 웹 게시가 꺼진 것(web_published: false)은 건너뛰어요. 확인 못 함(null)은 옮기고 표에 적어요.
  - 위아래 배너 · 인스타 바로가기 · 템플릿 소식 문구 · 회색 확인 메모는 빼요.
  - 날짜가 지난 라이브 · 이벤트 · 마감 안내 줄은 빼요. 날짜가 붙은 사실은 그대로 둬요.
  - 제목은 앞의 "CC |"와 상태 표시만 빼고 노션 그대로. 띄어쓰기만 고쳐요.
  - 공개는 앞 25% 안팎, 프롬프트 · 영상은 항상 잠금 아래.
  - 이 도구가 만든 파일(맨 위에 "노션:" 줄이 있는 파일)만 다시 만들고 지워요. 손으로 쓴 자료는 건드리지 않아요.
"""
import datetime
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "notion_raw"
CONTENT = ROOT / "content"
MAP = Path(__file__).resolve().parent / "notion_import_map.json"
REPORT = Path(__file__).resolve().parent / "last_import.md"

OPEN_RATIO = 0.25
LOCK = "<!-- 잠금 -->"
READY_ICON = "viav-monogram"
TODAY = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date()


# ---------- 노션 글 → 자료실 글 ----------

def unescape(s):
    s = re.sub(r"\\([_|\[\]~*`#<>-])", r"\1", s)
    return html.unescape(s)


def inline(s):
    s = re.sub(r"<b>(.*?)</b>", r"**\1**", s)
    s = re.sub(r"<strong>(.*?)</strong>", r"**\1**", s)
    s = re.sub(r"<code>(.*?)</code>", r"`\1`", s)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"</?(span|i|em|u|s|p)[^>]*>", "", s)
    s = unescape(s)
    s = re.sub(r"[_＿]{3,}", "【　　】", s)  # 빈칸 표시를 자료실 빈칸 모양으로
    return s.strip()


def html_table(block):
    rows = re.findall(r"<tr>(.*?)</tr>", block, re.S)
    cells = [[inline(c.strip()).replace("\n", " ").replace("|", "／") for c in re.findall(r"<td>(.*?)</td>", r, re.S)] for r in rows]
    if not cells:
        return ""
    out = ["| " + " | ".join(cells[0]) + " |", "|" + "---|" * len(cells[0])]
    out += ["| " + " | ".join(r) + " |" for r in cells[1:]]
    return "\n".join(out)


PROMPT_HINT = re.compile(r"(줘|알려|만들어|부탁|써 줘|정리해|추천해|제안해)")


def code_block(lang_body):
    body = lang_body.strip("\n")
    kind = "프롬프트" if PROMPT_HINT.search(body) else "문장"
    return f"```{kind}\n{body}\n```"


DATE_RE = re.compile(r"(?:(20\d\d)[-./년 ]\s*)?(\d{1,2})\s*[월/.-]\s*(\d{1,2})\s*일?")
EVENT_RE = re.compile(r"(라이브|이벤트|선착순|모집|신청 마감|마감 임박|특강|오픈 기념)")


def expired_line(line):
    if not EVENT_RE.search(line):
        return False
    for y, m, d in DATE_RE.findall(line):
        try:
            when = datetime.date(int(y) if y else TODAY.year, int(m), int(d))
        except ValueError:
            continue
        if when < TODAY:
            return True
    return False


def convert(raw, title):
    removed = []
    text = raw.replace("\r\n", "\n")
    # 1) 통째로 빼는 덩어리
    def drop(pattern, why):
        nonlocal text
        n = len(re.findall(pattern, text, re.S | re.M))
        if n:
            removed.append(f"{why} {n}개")
            text = re.sub(pattern, "\n", text, flags=re.S | re.M)
    drop(r'<callout[^>]*color="gray_bg"[^>]*>.*?</callout>', "회색 확인 메모")
    drop(r"<image[^>]*/>", "배너 그림")
    drop(r"^👉 \[@viav\\?_here 인스타그램 바로가기\]\([^)]*\)\s*$", "인스타 바로가기")
    drop(r"<p>[^<]*?(?:(?!</p>).)*릴스 첫 10개 기획 템플릿.*?</p>", "템플릿 소식 문구")
    text = re.sub(r"<p\s*/>", "\n", text)
    text = re.sub(r"^-{3,}\s*$", "\n", text, flags=re.M)
    # 다른 콜아웃은 인용 상자로
    text = re.sub(r"<callout[^>]*>(.*?)</callout>", lambda m: "\n".join("> " + l for l in inline(m.group(1)).split("\n") if l.strip()), text, flags=re.S)
    # 2) 코드 · 표를 먼저 바꿔 두고, 나머지는 줄 단위
    blocks, out = [], []
    parts = re.split(r"(```[^\n]*\n.*?```|<table.*?</table>)", text, flags=re.S)
    for part in parts:
        if part.startswith("```"):
            out.append(code_block(part.split("\n", 1)[1].rsplit("```", 1)[0]))
        elif part.startswith("<table"):
            out.append(html_table(part))
        else:
            lines = []
            for line in part.split("\n"):
                if expired_line(line):
                    removed.append(f"지난 행사 안내 줄: {line.strip()[:30]}")
                    continue
                if line.strip().startswith("|") and re.match(r"^\|[\s:|-]+\|$", line.strip()):
                    lines.append(line.strip())
                    continue
                lines.append(inline(line) if line.strip() else "")
            out.append("\n".join(lines))
    body = "\n".join(out)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    # 제목과 똑같은 첫 소제목은 빼요
    first = re.match(r"^#{1,3}\s+(.*)\n?", body)
    if first and norm(first.group(1)) == norm(title):
        body = body[first.end():].strip()
    return body, removed


def norm(s):
    return re.sub(r"[^\w가-힣]", "", re.sub(r"^[^\w가-힣']+", "", s))


def clean_title(t, prefix=""):
    t = re.sub(r"^\s*[🔴🟢🟡⚪️]\s*", "", t)
    t = re.sub(r"^CC\s*\|\s*", "", t).strip()
    t = re.sub(r"'([^']+)'(?=[가-힣])", r"'\1' ", t)  # '요즘 맛'소식 → '요즘 맛' 소식
    t = re.sub(r"\s{2,}", " ", t)
    return f"{prefix} {t}".strip() if prefix else t


# ---------- 잠금 위치 ----------

def split_blocks(body):
    blocks, cur, in_code = [], [], False
    for line in body.split("\n"):
        if line.strip().startswith("```"):
            in_code = not in_code
        if not in_code and not line.strip():
            if cur:
                blocks.append("\n".join(cur))
            cur = []
        else:
            cur.append(line)
    if cur:
        blocks.append("\n".join(cur))
    return blocks


def text_len(b):
    return len(re.sub(r"[\s#|*`>\-\[\]【】_]", "", b))


def is_secret(b):
    return b.startswith("```프롬프트") or b.startswith("@영상")


def units_of(block):
    """표는 줄마다, 목록은 항목마다 나눠요. (머리, 나눌 조각들) — 나눌 수 없으면 None."""
    lines = block.split("\n")
    if all(l.strip().startswith("|") for l in lines) and len(lines) > 3:
        return "\n".join(lines[:2]), lines[2:]
    if len(lines) > 1 and all(re.match(r"^\s*([-*]|\d+[.)])\s", l) for l in lines):
        return None, lines
    return None


def place_lock(body):
    blocks = split_blocks(body)
    total = sum(text_len(b) for b in blocks) or 1
    limit = next((i for i, b in enumerate(blocks) if is_secret(b)), len(blocks))
    target = OPEN_RATIO * total
    acc, cut = 0, None
    for i, b in enumerate(blocks[:limit]):
        n = text_len(b)
        if acc + n < target:
            acc += n
            continue
        u = units_of(b)
        if u:
            head, items = u
            k, run = 0, acc
            for it in items:
                if run + text_len(it) - target > target - run:
                    break
                run += text_len(it)
                k += 1
            if k == 0 and acc == 0:
                k = 1
            if 0 < k < len(items):
                first = ([head] if head else []) + items[:k]
                rest = ([head] if head else []) + items[k:]
                blocks = blocks[:i] + ["\n".join(first), "\n".join(rest)] + blocks[i + 1:]
                cut = i + 1
            else:
                cut = i + (1 if k else 0)
        else:
            cut = i + 1 if (acc + n - target) < (target - acc) or acc == 0 else i
        break
    if cut is None:
        cut = limit
    cut = max(1, min(cut, limit if limit else 1))
    while cut > 1 and blocks[cut - 1].lstrip().startswith("#"):
        cut -= 1  # 소제목만 공개되고 내용이 잠기지 않게
    ratio = round(sum(text_len(b) for b in blocks[:cut]) / total * 100)
    return "\n\n".join(blocks[:cut] + [LOCK] + blocks[cut:]), ratio


# ---------- 실행 ----------

def main():
    pages = json.loads((RAW / "_pages.json").read_text(encoding="utf-8"))["pages"]
    mapping = json.loads(MAP.read_text(encoding="utf-8"))["pages"]
    done, skipped, notes = [], [], []

    # 지난번에 이 도구가 만든 파일은 지우고 다시 만들어요
    for f in CONTENT.glob("*/*.md"):
        if re.search(r"^노션:", f.read_text(encoding="utf-8"), re.M):
            f.unlink()

    for p in pages:
        title_raw = p["notion_title"]
        if "템플릿" in title_raw and "삭제 금지" in title_raw:
            skipped.append((title_raw, "자동 제작에 쓰는 템플릿 페이지"))
            continue
        if READY_ICON not in p.get("icon", ""):
            mark = p.get("icon") or "아이콘 없음"
            skipped.append((title_raw, f"{mark} 확인 전 (비아브 로고 아이콘이 아니에요)"))
            continue
        if p.get("web_published") is False:
            skipped.append((title_raw, "노션 웹 게시가 꺼져 있어요"))
            continue
        m = mapping.get(p["id"])
        if not m:
            skipped.append((title_raw, "tools/notion_import_map.json 에 분야 · 주소 이름이 없어요"))
            continue
        raw_file = RAW / f"{p['id']}.md"
        if not raw_file.exists():
            skipped.append((title_raw, "노션 원문(notion_raw)이 저장되지 않았어요"))
            continue
        title = clean_title(title_raw, m.get("제목앞", ""))
        body, removed = convert(raw_file.read_text(encoding="utf-8"), clean_title(title_raw))
        body, ratio = place_lock(body)
        cat_dir = CONTENT / m["분야"]
        if not cat_dir.exists():
            skipped.append((title_raw, f"분야 폴더 content/{m['분야']} 가 없어요"))
            continue
        front = "\n".join([
            "---",
            f"제목: {title}",
            f"주소: {m['주소']}",
            f"날짜: {p.get('date', '')}",
            f"받는것: {m.get('받는것', '')}",
            f"소개: {m.get('소개', '')}",
            f"노션: https://app.notion.com/p/{p['id']}",
            "---",
        ])
        (cat_dir / f"{m['주소']}.md").write_text(front + "\n\n" + body + "\n", encoding="utf-8")
        done.append((title, m["분야"], m["주소"], p.get("date", ""), ratio, ", ".join(removed)))
        if p.get("web_published") is None:
            notes.append(f"{title}: 노션 웹 게시 여부를 확인 못 했어요")

    lines = [f"# 노션 → 자료실 옮기기 결과 ({TODAY})", "", "## 옮긴 자료", "",
             "| 제목 | 분야 | 주소 | 날짜 | 공개 | 뺀 것 |", "|---|---|---|---|---|---|"]
    lines += [f"| {t} | {c} | {s} | {d} | {r}% | {x or '-'} |" for t, c, s, d, r, x in done]
    lines += ["", "## 건너뛴 자료", "", "| 노션 제목 | 이유 |", "|---|---|"]
    lines += [f"| {t.replace('|', '／')} | {why} |" for t, why in skipped]
    if notes:
        lines += ["", "## 확인 필요", ""] + [f"- {n}" for n in notes]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
