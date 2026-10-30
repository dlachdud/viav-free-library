// =====================================================================
// 무료 자료실 화면
// 처음 화면(#/) → 분야 목록(#/분야폴더) → 자료 한 개(#/분야폴더/자료파일)
// 자료 내용은 assets/data.js (node build.js 로 만들어요) 에서 읽어요.
// =====================================================================
(function () {
  const L = window.LIBRARY;
  const app = document.getElementById("app");
  const KEY = "viav_free_email";

  // ---------- 이메일 → 스티비 주소록 ----------
  // 사이트의 /api/subscribe (api/subscribe.js) 가 스티비에 구독자를 넣어요. API 키는 Vercel 설정에만 있어요.
  // 스티비가 늦거나 실패해도, 이미 구독 중이어도 방문자에게는 자료를 열어 줘요. 6초 넘게 걸리면 기다리지 않아요.
  function sendEmail(email, category, adAgreed) {
    const post = fetch("api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, category, adAgreed: !!adAgreed, privacyAgreed: true }),
    }).then(r => r.json()).catch(() => ({ ok: false }));
    const timeout = new Promise(res => setTimeout(() => res({ ok: false, timeout: true }), 6000));
    return Promise.race([post, timeout]);
  }

  let memoryEmail = "";
  function savedEmail() {
    try { return localStorage.getItem(KEY) || memoryEmail; } catch (e) { return memoryEmail; }
  }
  function saveEmail(email) {
    memoryEmail = email;
    try { localStorage.setItem(KEY, email); } catch (e) { /* 저장이 막힌 브라우저는 이번 방문 동안만 열려요 */ }
  }
  const isUnlocked = () => !!savedEmail();

  // ---------- 글 → 화면 ----------
  const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function inline(s) {
    let h = esc(s);
    h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/【([^】]+)】/g, "<mark>【$1】</mark>");
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return h;
  }

  function videoHtml(url) {
    let m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
    if (m) {
      return `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" title="영상" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    }
    m = url.match(/instagram\.com\/(?:[\w.]+\/)?(reel|reels|p|tv)\/([\w-]+)/);
    if (m) {
      const kind = m[1] === "reels" ? "reel" : m[1];
      return `<div class="video ig"><iframe src="https://www.instagram.com/${kind}/${m[2]}/embed" title="인스타 영상" loading="lazy" allowfullscreen></iframe></div>` +
        `<a class="video-fallback" href="${esc(url)}" target="_blank" rel="noopener">영상이 안 보이면 인스타에서 보기 →</a>`;
    }
    return `<p><a href="${esc(url)}" target="_blank" rel="noopener">영상 보기 →</a></p>`;
  }

  function render(md) {
    const lines = md.split("\n");
    const out = [];
    let i = 0;
    const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (!t) { i++; continue; }

      const fence = t.match(/^```(.*)$/);
      if (fence) {
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
        i++;
        const code = buf.join("\n");
        const kind = fence[1].trim();
        if (kind === "프롬프트" || kind === "문장") {
          const label = kind === "프롬프트" ? "프롬프트" : "그대로 쓰는 문장";
          out.push(`<div class="prompt"><div class="prompt-bar"><span>${label}</span><button type="button" class="copy">복사하기</button></div><pre>${esc(code)}</pre></div>`);
        } else {
          out.push(`<pre><code>${esc(code)}</code></pre>`);
        }
        continue;
      }
      const vid = t.match(/^@영상\s+(\S+)/);
      if (vid) { out.push(videoHtml(vid[1])); i++; continue; }
      const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (img) { out.push(`<p><img src="${esc(img[2])}" alt="${esc(img[1])}" loading="lazy"></p>`); i++; continue; }
      const h = t.match(/^(#{1,3})\s+(.*)$/);
      if (h) { const n = Math.min(h[1].length + 1, 3); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
      if (/^(-{3,}|\*{3,})$/.test(t)) { out.push("<hr>"); i++; continue; }

      if (isTableRow(line)) {
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
        const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        const head = cells(rows[0]);
        const body = rows.slice(1).filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
        out.push(`<div class="table-scroll"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${cells(r).map((c, k) => `<td data-label="${esc(head[k] || "")}">${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (/^>\s?/.test(t)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) buf.push(lines[i++].trim().replace(/^>\s?/, ""));
        out.push(`<blockquote>${buf.map(inline).join("<br>")}</blockquote>`);
        continue;
      }
      if (/^[-*]\s+/.test(t)) {
        const buf = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) buf.push(lines[i++].trim().replace(/^[-*]\s+/, ""));
        const check = buf.every(b => /^\[[ xX]\]\s/.test(b));
        if (check) {
          out.push(`<ul class="check">${buf.map(b => `<li><input type="checkbox"${/^\[[xX]\]/.test(b) ? " checked" : ""} aria-label="체크"><span>${inline(b.slice(4))}</span></li>`).join("")}</ul>`);
        } else {
          out.push(`<ul>${buf.map(b => `<li>${inline(b)}</li>`).join("")}</ul>`);
        }
        continue;
      }
      if (/^\d+[.)]\s+/.test(t)) {
        const buf = [];
        while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) buf.push(lines[i++].trim().replace(/^\d+[.)]\s+/, ""));
        out.push(`<ol>${buf.map(b => `<li>${inline(b)}</li>`).join("")}</ol>`);
        continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|[-*]\s|\d+[.)]\s|>|\||@영상\s|!\[)/.test(lines[i].trim())) buf.push(lines[i++].trim());
      if (!buf.length) { buf.push(lines[i++].trim()); }
      out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
    }
    return out.join("\n");
  }

  // ---------- 화면들 ----------
  const findCat = id => L.categories.find(c => c.id === id);
  const href = (...parts) => "#/" + parts.map(encodeURIComponent).join("/");
  const fmtDate = d => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
    return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : "";
  };

  function banners() {
    if (!L.site.banners.length) return "";
    return `<section class="banners" aria-label="비아브 소식">${L.site.banners.map(b =>
      `<div class="banner"><img src="assets/logo_symbol.svg" alt=""><p>${esc(b["문구"])}</p><a href="${esc(b["링크"])}" target="_blank" rel="noopener">${esc(b["버튼"])}</a></div>`
    ).join("")}</section>`;
  }

  function home() {
    document.title = L.site.name;
    app.innerHTML = `
      <section class="hero">
        <img src="assets/logo_symbol.svg" alt="VIAV 비아브 로고">
        <h1>${esc(L.site.name)}</h1>
        <p class="slogan">${esc(L.site.slogan)}</p>
        <p class="intro">${esc(L.site.intro)}</p>
      </section>
      <h2 class="section-title">어떤 자료가 필요하세요?</h2>
      <ul class="cards">${L.categories.map(c => {
        const n = c.items.length;
        const inner = `<span class="icon" aria-hidden="true">${esc(c.icon)}</span>
          <span><h2>${esc(c.name)}</h2><p>${esc(c.desc)}</p>
          <span class="meta">${n ? `자료 ${n}개` : '<span class="badge">곧 올라와요</span>'}</span></span>
          ${n ? '<span class="go" aria-hidden="true">›</span>' : ""}`;
        return `<li>${n ? `<a class="card" href="${href(c.id)}">${inner}</a>` : `<div class="card soon" aria-disabled="true">${inner}</div>`}</li>`;
      }).join("")}</ul>
      ${banners()}`;
  }

  function category(c) {
    document.title = `${c.name} · ${L.site.name}`;
    app.innerHTML = `
      <nav class="crumb"><a href="#/">← 처음으로</a></nav>
      <header class="page-head"><h1>${esc(c.icon)} ${esc(c.name)}</h1><p>${esc(c.desc)}</p></header>
      ${c.items.length ? `<ul class="cards">${c.items.map(it => `
        <li><a class="card" href="${href(c.id, it.id)}">
          <span><h3>${esc(it.title)}</h3><p>${esc(it.intro || it.gets)}</p>${it.date ? `<span class="meta">${fmtDate(it.date)}</span>` : ""}</span>
          <span class="go" aria-hidden="true">›</span>
        </a></li>`).join("")}</ul>`
        : `<div class="empty">곧 올라와요<br>자료가 준비되면 이곳에 보여 드릴게요</div>`}
      ${banners()}`;
  }

  function item(c, it) {
    document.title = `${it.title} · ${L.site.name}`;
    const open = isUnlocked();
    const hasLock = !!it.locked.trim();
    app.innerHTML = `
      <nav class="crumb"><a href="#/">처음</a> › <a href="${href(c.id)}">${esc(c.name)}</a></nav>
      <header class="doc-head">
        <h1>${esc(it.title)}</h1>
        ${it.intro ? `<p class="intro-line">${esc(it.intro)}</p>` : ""}
        ${it.gets ? `<div class="gets"><b>이 자료로 받는 것</b> · ${esc(it.gets)}</div>` : ""}
        ${it.date ? `<div class="date">${fmtDate(it.date)} 정리</div>` : ""}
      </header>
      <article class="doc">
        <div class="part open">${render(it.open)}</div>
        ${!hasLock ? "" : open
          ? `<p class="unlocked-note">🔓 이메일 확인 완료 · 아래 내용까지 모두 열렸어요</p><div class="part locked">${render(it.locked)}</div>`
          : `<div class="fade"></div>
             <section class="gate" aria-labelledby="gate-title">
               <div class="lock" aria-hidden="true">🔒</div>
               <h2 id="gate-title">나머지 내용은 이메일을 넣으면 열려요</h2>
               <p>프롬프트와 체크리스트까지 전부 볼 수 있어요<br>한 번만 넣으면 모든 자료가 계속 열려 있어요</p>
               <form novalidate>
                 <div class="row">
                   <label class="sr" for="email" hidden>이메일</label>
                   <input id="email" type="email" inputmode="email" autocomplete="email" placeholder="이메일 주소" required>
                   <button type="submit">자료 열기</button>
                 </div>
                 <div class="agree">
                   <label><input type="checkbox" id="agree-privacy"> <span><b>(필수)</b> 개인정보 수집·이용에 동의해요</span></label>
                   <details>
                     <summary>자세히 보기</summary>
                     <ul>
                       <li>수집 항목: 이메일 주소</li>
                       <li>이용 목적: 무료 자료 제공, 비아브 뉴스레터 · 자료 소식 안내</li>
                       <li>보관 기간: 구독 해지 시까지 (해지하면 바로 삭제해요)</li>
                       <li>이메일은 뉴스레터 발송 서비스(스티비)에 보관돼요</li>
                       <li>동의하지 않으셔도 되지만, 동의하지 않으면 자료 전체를 볼 수 없어요</li>
                     </ul>
                   </details>
                   <label><input type="checkbox" id="agree-ad"> <span>(선택) 비아브 소식(광고성 정보)을 이메일로 받을게요</span></label>
                   <details>
                     <summary>자세히 보기</summary>
                     <p>비아브의 새 자료, 템플릿, 강의 소식을 이메일로 받아요. 받은 메일의 수신거부 링크로 언제든 그만 받을 수 있어요.</p>
                   </details>
                 </div>
               </form>
               <p class="err" role="alert"></p>
             </section>`}
      </article>
      ${banners()}`;

    const form = app.querySelector(".gate form");
    if (form) {
      form.addEventListener("submit", e => {
        e.preventDefault();
        const input = form.querySelector("#email");
        const email = input.value.trim();
        const err = app.querySelector(".gate .err");
        const btn = form.querySelector("button");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          err.textContent = "이메일 주소를 다시 확인해 주세요";
          input.focus();
          return;
        }
        if (!form.querySelector("#agree-privacy").checked) {
          err.textContent = "개인정보 수집·이용에 동의해 주셔야 자료가 열려요";
          form.querySelector("#agree-privacy").focus();
          return;
        }
        err.textContent = "";
        btn.disabled = true;
        btn.textContent = "여는 중…";
        sendEmail(email, c.id, form.querySelector("#agree-ad").checked).then(() => {
          saveEmail(email);
          const y = window.scrollY;
          item(c, it);
          window.scrollTo(0, y);
        });
      });
    }
  }

  function notFound() {
    app.innerHTML = `<div class="empty" style="margin-top:32px">찾는 자료가 없어요<br><a href="#/">처음 화면으로 가기</a></div>`;
  }

  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    if (!parts.length) home();
    else {
      const c = findCat(parts[0]);
      if (!c) notFound();
      else if (parts.length === 1) category(c);
      else {
        const it = c.items.find(x => x.id === parts[1]);
        it ? item(c, it) : notFound();
      }
    }
    window.scrollTo(0, 0);
  }

  // 프롬프트 복사
  app.addEventListener("click", e => {
    const btn = e.target.closest(".copy");
    if (!btn) return;
    const text = btn.closest(".prompt").querySelector("pre").textContent;
    const done = () => {
      btn.textContent = "복사했어요 ✓";
      btn.classList.add("done");
      setTimeout(() => { btn.textContent = "복사하기"; btn.classList.remove("done"); }, 1800);
    };
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (err) { btn.textContent = "길게 눌러 복사해 주세요"; }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  });

  window.addEventListener("hashchange", route);
  route();
})();
