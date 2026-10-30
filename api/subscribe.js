// =====================================================================
// 무료 자료실 이메일 → 스티비 주소록 (Vercel 서버 함수, 주소: /api/subscribe)
//
// 화면(assets/app.js)이 { email, category, adAgreed, privacyAgreed } 를 보내면
// 자료실_설정.json 의 「스티비」 주소록 · 분야 그룹에 구독자로 넣어요.
// API 키는 Vercel 환경 변수 STIBEE_API_KEY 에서만 읽어요. 키를 화면에 보내거나 기록에 남기지 않아요.
// 이미 구독 중인 이메일이거나 스티비가 실패해도 화면은 자료를 열어요 (답에는 결과만 알려 줘요).
// =====================================================================
const config = require("../자료실_설정.json");

const API = "https://api.stibee.com/v1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function stibee(path, body, key) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", AccessToken: key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 스티비가 JSON 이 아닌 답을 줄 때 */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

// 스티비 답에서 결과 이름만 뽑아요: success(새 구독) · update(정보 갱신) · exist(이미 구독 중) · fail
function outcome(r) {
  const v = r.json && r.json.Value;
  if (!r.json || r.json.Ok === false || !v) return "fail";
  const has = k => Array.isArray(v[k]) && v[k].length > 0;
  if (has("success")) return "success";
  if (has("update")) return "update";
  if (Object.keys(v).some(k => /^fail/i.test(k) && /exist|duplicat/i.test(k) && has(k))) return "exist";
  return Object.keys(v).some(k => /^fail/i.test(k) && has(k)) ? "fail" : "success";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, reason: "method" });
    return;
  }
  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    res.status(400).json({ ok: false, reason: "email" });
    return;
  }
  if (body.privacyAgreed !== true) {
    res.status(400).json({ ok: false, reason: "privacy" });
    return;
  }

  const key = process.env.STIBEE_API_KEY;
  const s = config["스티비"] || {};
  if (!key || !s["주소록"]) {
    res.status(200).json({ ok: false, reason: "not-configured" });
    return;
  }

  const listId = s["주소록"];
  const groupId = (s["분야그룹"] || {})[String(body.category || "")];
  const subscriber = { email, $ad_agreed: body.adAgreed ? "Y" : "N" };

  const add = groupIds => stibee(`/lists/${listId}/subscribers`, {
    eventOccuredBy: "SUBSCRIBER",
    confirmEmailYN: s["구독확인메일"] ? "Y" : "N",
    groupIds,
    subscribers: [subscriber],
  }, key);

  try {
    let r = await add(groupId ? [String(groupId)] : []);
    let result = outcome(r);
    // 요금제 때문에 그룹이 거절되면 그룹 없이 주소록에만 넣어요
    let groupSkipped = false;
    if (result === "fail" && groupId) {
      console.error("stibee subscribe with group failed, retrying without group", r.status, r.text);
      r = await add([]);
      result = outcome(r);
      groupSkipped = true;
    }
    // 이미 구독 중인 분도 이번 분야 그룹에 넣어 둬요 (실패해도 괜찮아요)
    let grouped = null;
    if (groupId && result === "exist" && !groupSkipped) {
      const g = await stibee(`/lists/${listId}/groups/${groupId}/subscribers`, [email], key).catch(() => null);
      grouped = g ? g.status : null;
    }
    if (result === "fail") console.error("stibee subscribe failed", r.status, r.text);
    res.status(200).json({ ok: result !== "fail", result, grouped, groupSkipped });
  } catch (e) {
    console.error("stibee subscribe error", e && e.message);
    res.status(200).json({ ok: false, reason: "network" });
  }
};
