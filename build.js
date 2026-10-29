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
      ...parts,
    });
  }
  // 최신순 (날짜가 같으면 순서 → 파일 이름 순)
  items.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.order - b.order);
  categories.push({ id: info["주소"] || dir, name: info["이름"], icon: info["아이콘"] || "", desc: info["설명"] || "", order: info["순서"] || 99, items });
}
categories.sort((a, b) => a.order - b.order);

const data = {
  site: { name: config["이름"], slogan: config["슬로건"], intro: config["소개"], banners: config["배너"] || [] },
  categories,
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(OUT, `// node build.js 가 만든 파일이에요. 직접 고치지 말고 content 폴더를 고친 뒤 다시 실행하세요.\nwindow.LIBRARY = ${JSON.stringify(data, null, 2)};\n`);

for (const c of categories) {
  console.log(`${c.icon} ${c.name}: 자료 ${c.items.length}개${c.items.map(i => `\n   - ${i.title} (공개 ${i.ratio}%)`).join("")}`);
}
// 사이트 파일: index.html 과 assets 만 dist 폴더에 담아요 (Vercel 이 이 폴더만 공개해요).
// content · tools · notion_raw · build.js 는 공개되지 않아요.
const DIST = path.join(ROOT, "dist");
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "assets"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "index.html"), path.join(DIST, "index.html"));
for (const f of fs.readdirSync(path.join(ROOT, "assets"))) fs.copyFileSync(path.join(ROOT, "assets", f), path.join(DIST, "assets", f));

if (warnings.length) console.log("\n알림\n" + warnings.map(w => " - " + w).join("\n"));
console.log(`\n완료: assets/data.js · dist/`);
