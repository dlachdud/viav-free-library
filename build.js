// =====================================================================
// 무료 자료실 만들기
//
// 실행: node build.js   (free-library 폴더에서)
//
// 하는 일
// 1. content/<분야 폴더>/_분야.json 과 자료 파일(.md)을 모두 읽어요.
// 2. 자료마다 공개 부분과 잠금 부분을 나눠요.
//    - 자료 안의 <!-- 잠금 --> 줄부터 아래가 잠금이에요.
//    - 이 줄이 없으면 앞에서 25% 안팎에서 자동으로 나눠요.
//    - 프롬프트(```프롬프트)와 영상(@영상 주소)은 항상 잠금 아래로 보내요.
//    - 공개 부분이 40%를 넘으면 알려 줘요.
// 3. 결과를 assets/data.js 로 저장해요. index.html 이 이 파일을 읽어요.
// 4. 사이트 파일만 dist 폴더에 모아요. Vercel 이 배포할 때 이 파일을 실행하고 dist 만 공개해요.
// =====================================================================
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONTENT = path.join(ROOT, "content");
const OUT = path.join(ROOT, "assets", "data.js");
const LOCK = "<!-- 잠금 -->";

const config = JSON.parse(fs.readFileSync(path.join(ROOT, "자료실_설정.json"), "utf8"));
const warnings = [];

function parseFront(src, file) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(`${file}: 맨 위 --- 사이에 제목·받는것·날짜를 적어 주세요.`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta["제목"]) throw new Error(`${file}: 제목이 없어요.`);
  return { meta, body: src.slice(m[0].length).trim() };
}

// 빈 줄 기준 덩어리로 나눠요. 코드 블록 안의 빈 줄은 덩어리를 끊지 않아요.
function splitBlocks(body) {
  const blocks = [];
  let cur = [];
  let inCode = false;
  for (const line of body.split("\n")) {
    if (line.trim().startsWith("```")) inCode = !inCode;
    if (!inCode && line.trim() === "") {
      if (cur.length) blocks.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));
  return blocks;
}

const textLen = b => b.replace(/[#|*`>\-\[\]【】_]/g, "").replace(/\s+/g, "").length;
const isSecret = b => /^```프롬프트/m.test(b) || /^@영상\s/m.test(b);

function splitLock(body, file) {
  let blocks = splitBlocks(body);
  let at = blocks.findIndex(b => b.trim() === LOCK);
  if (at >= 0) blocks.splice(at, 1);
  else {
    // 표시가 없으면 글자 수 기준 25% 를 넘기 직전에서 나눠요 (첫 덩어리는 항상 공개).
    const total = blocks.reduce((s, b) => s + textLen(b), 0);
    let acc = 0;
    at = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      acc += textLen(blocks[i]);
      if (i > 0 && acc > total * config["공개비율"]) { at = i; break; }
    }
    warnings.push(`${file}: 잠금 표시가 없어서 앞 ${at}덩어리만 공개했어요.`);
  }
  const secret = blocks.findIndex(isSecret);
  if (secret >= 0 && secret < at) {
    warnings.push(`${file}: 프롬프트·영상이 공개 부분에 있어서 그 앞에서 잠갔어요.`);
    at = secret;
  }
  const open = blocks.slice(0, at);
  const locked = blocks.slice(at);
  const total = blocks.reduce((s, b) => s + textLen(b), 0) || 1;
  const ratio = open.reduce((s, b) => s + textLen(b), 0) / total;
  if (ratio > config["최대공개비율"]) warnings.push(`${file}: 공개 부분이 ${Math.round(ratio * 100)}%예요 (최대 ${config["최대공개비율"] * 100}%).`);
  return { open: open.join("\n\n"), locked: locked.join("\n\n"), ratio: Math.round(ratio * 100) };
}

const categories = [];
for (const dir of fs.readdirSync(CONTENT).sort()) {
  const full = path.join(CONTENT, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  const infoFile = path.join(full, "_분야.json");
  if (!fs.existsSync(infoFile)) { warnings.push(`content/${dir}: _분야.json 이 없어서 건너뛰었어요.`); continue; }
  const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
  const items = [];
  for (const f of fs.readdirSync(full).sort()) {
    if (!f.endsWith(".md") || f.startsWith("_")) continue;
    const rel = `content/${dir}/${f}`;
    const { meta, body } = parseFront(fs.readFileSync(path.join(full, f), "utf8"), rel);
    const parts = splitLock(body, rel);
    items.push({
      id: meta["주소"] || f.replace(/\.md$/, ""),
      title: meta["제목"],
      gets: meta["받는것"] || "",
      intro: meta["소개"] || "",
      date: meta["날짜"] || "",
      order: Number(meta["순서"] || 99),
      notion: meta["노션"] || "",
      ...parts,
    });
  }
  // 최신순 (날짜가 같으면 순서 → 파일 이름 순)
  items.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.order - b.order);
  categories.push({ id: info["주소"] || dir, name: info["이름"], icon: info["아이콘"] || "", desc: info["설명"] || "", order: info["순서"] || 99, items });
}
categories.sort((a, b) => a.order - b.order);

// 처음 화면이 빨리 뜨도록 data.js 에는 목록(제목 · 소개 등)만 넣고,
// 자료 본문(공개 · 잠금 부분)은 자료마다 assets/items/<분야>--<자료>.json 으로 따로 둬요. 자료를 열 때만 불러와요.
const builtAt = new Date().toISOString();
const version = builtAt.replace(/\D/g, "").slice(0, 12);
const bodies = [];
const data = {
  site: { name: config["이름"], slogan: config["슬로건"], intro: config["소개"], banners: config["배너"] || [] },
  categories: categories.map(c => ({
    ...c,
    items: c.items.map(({ open, locked, ratio, notion, ...it }) => {
      const file = `items/${c.id}--${it.id}.json`;
      bodies.push({ file, open, locked });
      return { ...it, file, hasLock: !!locked.trim() };
    }),
  })),
  version,
  builtAt,
};
fs.writeFileSync(OUT, `// node build.js 가 만든 파일이에요. 직접 고치지 말고 content 폴더를 고친 뒤 다시 실행하세요.\nwindow.LIBRARY = ${JSON.stringify(data, null, 2)};\n`);

for (const c of categories) {
  console.log(`${c.icon} ${c.name}: 자료 ${c.items.length}개${c.items.map(i => `\n   - ${i.title} (공개 ${i.ratio}%)`).join("")}`);
}
// 사이트 파일: index.html · embed.js · assets 만 dist 폴더에 담아요 (Vercel 이 이 폴더만 공개해요).
// content · tools · notion_raw · build.js 는 공개되지 않아요.
const DIST = path.join(ROOT, "dist");
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "assets", "items"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "index.html"), path.join(DIST, "index.html"));
fs.copyFileSync(path.join(ROOT, "embed.js"), path.join(DIST, "embed.js"));
for (const f of fs.readdirSync(path.join(ROOT, "assets"))) {
  if (fs.statSync(path.join(ROOT, "assets", f)).isFile()) fs.copyFileSync(path.join(ROOT, "assets", f), path.join(DIST, "assets", f));
}
for (const b of bodies) fs.writeFileSync(path.join(DIST, "assets", b.file), JSON.stringify({ open: b.open, locked: b.locked }));

// 나만 보는 관리자 페이지 (admin.html → dist/<관리자 주소>/index.html)
// 주소는 저장소가 공개라서 저장소에 적지 않고, Vercel 환경 변수 VIAV_ADMIN_PATH 에만 둬요 (kanri- 로 시작).
// 이 값이 없으면 관리자 페이지는 만들지 않아요.
const adminPath = (process.env.VIAV_ADMIN_PATH || "").trim();
let adminNote = "관리자 페이지: VIAV_ADMIN_PATH 가 없어서 만들지 않았어요";
if (adminPath && !/^kanri-[a-z0-9]{16,}$/.test(adminPath)) {
  warnings.push("VIAV_ADMIN_PATH 는 kanri- 뒤에 영어 소문자 · 숫자 16자 이상이어야 해요. 관리자 페이지를 만들지 않았어요.");
} else if (adminPath) {
  const siteUrl = (config["자료실주소"] || "").replace(/\/+$/, "");
  const s = config["스티비"] || {};
  const groupIds = s["분야그룹"] || {};
  const logFile = path.join(ROOT, "tools", "sync.log");
  const log = (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "").split("\n").filter(l => l.trim()).reverse().slice(0, 60)
    .map(l => {
      const [when, ...rest] = l.split(" · ");
      const checkAt = rest.findIndex(r => r.startsWith("확인 필요:"));
      const check = checkAt >= 0 ? rest.slice(checkAt).join(" · ").replace(/^확인 필요:\s*/, "") : "";
      const head = checkAt >= 0 ? rest.slice(0, checkAt) : rest;
      return { when, counts: head.slice(0, 3).join(" · "), pushed: head.slice(3).join(" · "), check };
    });
  const admin = {
    builtAt: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }),
    cats: categories.map(c => ({ id: c.id, name: c.name, icon: c.icon })),
    items: categories.flatMap(c => c.items.map(it => ({
      title: it.title, date: it.date, cat: c.id, catName: c.name, catIcon: c.icon, notion: it.notion,
      hasLock: !!it.locked.trim(), url: `${siteUrl}/#/${encodeURIComponent(c.id)}/${encodeURIComponent(it.id)}`,
    }))).sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    log,
    links: [
      { label: "자료실 열기", href: siteUrl + "/" },
      { label: "반영 기록 전체 (GitHub)", href: "https://github.com/dlachdud/viav-free-library/blob/main/tools/sync.log" },
      { label: "Vercel 배포 화면", href: "https://vercel.com/dashboard" },
    ],
    stibee: {
      listId: s["주소록"], list: `https://stibee.com/lists/${s["주소록"]}`,
      groups: categories.filter(c => groupIds[c.id]).map(c => ({ name: c.name, icon: c.icon, id: groupIds[c.id] })),
    },
  };
  const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8")
    .replace("/*ADMIN_DATA*/", JSON.stringify(admin).replace(/</g, "\\u003c"));
  fs.mkdirSync(path.join(DIST, adminPath), { recursive: true });
  fs.writeFileSync(path.join(DIST, adminPath, "index.html"), html);
  adminNote = `관리자 페이지: 만들었어요 (자료 ${admin.items.length}개 · 기록 ${log.length}줄)`;
}

if (warnings.length) console.log("\n알림\n" + warnings.map(w => " - " + w).join("\n"));
console.log(adminNote);
console.log(`\n완료: assets/data.js · dist/ (자료 본문 ${bodies.length}개 · 버전 ${version})`);
