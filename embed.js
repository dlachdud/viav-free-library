// =====================================================================
// 무료 자료실을 다른 홈페이지에 붙이는 스크립트
//
// 홈페이지에 아래 두 줄만 넣으면 돼요.
//   <div id="viav-free-library"></div>
//   <script src="https://viav-free-library.vercel.app/embed.js" defer></script>
//
// 자료실은 상자 안(Shadow DOM)에 그려서 홈페이지 디자인과 서로 섞이지 않아요.
// 자료실 주소는 이 스크립트 주소에서 알아내요. 이메일 · 스티비 연결도 자료실 주소로 그대로 가요.
// =====================================================================
(function () {
  if (window.ViavLibraryEmbedLoaded) return;
  window.ViavLibraryEmbedLoaded = true;

  const me = document.currentScript || document.querySelector('script[src*="embed.js"]');
  const BASE = new URL(".", me ? me.src : location.href).href;
  const box = document.getElementById("viav-free-library");
  if (!box) {
    console.warn("[비아브 자료실] <div id=\"viav-free-library\"></div> 상자를 찾지 못했어요");
    return;
  }

  // 글꼴은 홈페이지 쪽에 한 번만 불러와요 (상자 안에서는 글꼴을 등록할 수 없어서요)
  if (!document.querySelector('link[data-viav-font]')) {
    const font = document.createElement("link");
    font.rel = "stylesheet";
    font.href = "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap";
    font.setAttribute("data-viav-font", "");
    document.head.appendChild(font);
  }

  const shadow = box.attachShadow ? box.attachShadow({ mode: "open" }) : box;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = BASE + "assets/style.css";
  const root = document.createElement("div");
  root.className = "viav-embed wrap";
  root.innerHTML = '<p style="padding:24px 0;text-align:center;color:#8F8781">자료실을 불러오고 있어요…</p>';
  shadow.appendChild(css);
  shadow.appendChild(root);

  const load = src => new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = fail;
    document.head.appendChild(s);
  });

  window.VIAV_EMBED = true;
  const v = "?t=" + Date.now().toString().slice(0, -5); // 100초마다 바뀌어서 새 자료가 늦게 보이지 않아요
  load(BASE + "assets/data.js" + v)
    .then(() => load(BASE + "assets/app.js" + v))
    .then(() => window.ViavLibrary.mount(root, { base: BASE, embed: true }))
    .catch(() => {
      root.innerHTML = '<p style="padding:24px 0;text-align:center">자료실을 불러오지 못했어요 · <a href="' + BASE + '" target="_blank" rel="noopener">자료실에서 바로 보기</a></p>';
    });
})();
