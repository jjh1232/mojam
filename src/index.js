/**
 * prelaps.com/mojibake/* 를 site/ 에 잇는 얇은 층 + 구 주소의 301.
 *
 * Workers Assets 에는 "이 경로 아래에 자산을 붙인다" 는 설정이 없다.
 * 자산의 파일 경로가 곧 URL 경로라서, 그냥 두면
 * prelaps.com/mojibake/styles.css 가 site/mojibake/styles.css 를 찾는다.
 *
 * site/ 를 한 칸 내리는 대신 접두사를 여기서 떼어낸다.
 * site/ 안이 그대로 사이트라는 원칙도, file:// 더블클릭 원칙도 그대로 산다.
 *
 * 변환도 번들링도 없다 — 이 파일이 생겼다고 빌드 단계가 생긴 것은 아니다.
 */

/** 정식 호스트. 이 외의 호스트로 들어오면 전부 여기로 301 한다. */
const CANONICAL_HOST = 'prelaps.com';

/** prelaps.com 에서 이 도구가 사는 자리. */
const PREFIX = '/mojibake';

/**
 * 허브로 옮긴 정책 페이지들. (헌법 §8 — 정책 문서는 허브에 하나씩)
 *
 * 이 도구가 헌법보다 먼저 만들어져서 자기 복사본을 갖고 있었다. 파일은 지웠고,
 * 색인·외부 링크가 남아 있으므로 여기서 301 로 넘긴다. 그냥 지우면 404 가 되고,
 * 남겨두면 같은 약관이 두 주소로 색인되어 중복 콘텐츠가 된다.
 *
 * 키는 접두사를 뗀 뒤의 경로다. 확장자와 끝 슬래시는 아래에서 정규화한다.
 */
const MOVED = {
  '/content/privacy': '/ko/privacy#mojibake',
  '/content/terms': '/ko/terms',
  '/content/contact': '/ko/contact',
  '/en/content/privacy': '/en/privacy#mojibake',
  '/en/content/terms': '/en/terms',
  '/en/content/contact': '/en/contact',
  '/ja/content/privacy': '/ja/privacy#mojibake',
  '/ja/content/terms': '/ja/terms',
  '/ja/content/contact': '/ja/contact',
};


/** GA4 측정 ID. prelaps.com 전체가 한 속성이다. */
const GA_ID = 'G-NQ5XY9JPJ4';

/**
 * 애널리틱스 스니펫은 HTML 파일이 아니라 **여기 한 곳에만** 있다.
 * site/ 안의 페이지마다 붙여두면 언어판이나 문서를 하나 늘릴 때 조용히 빠뜨리고,
 * 빠진 건 화면에 아무 표시가 없어 눈으로는 못 잡는다.
 *
 * file:// 더블클릭 원칙도 그대로다 — 로컬로 열면 스니펫이 없으니
 * 개발 중 클릭이 실제 방문자 수치에 섞이지 않는다.
 */
const GA_SNIPPET = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GA_ID}');
</script>
`;

/**
 * HTML 응답의 </head> 직전에 GA 스니펫을 끼운다.
 * HTML 이 아니면 손대지 않는다 — CSS·JS·폰트까지 HTMLRewriter 에 태우면 낭비다.
 */
function withAnalytics(response) {
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;

  return new HTMLRewriter()
    .on('head', { element: (el) => el.append(GA_SNIPPET, { html: true }) })
    .transform(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── 구 주소(mojibake.prelaps.com) → 새 주소 ──────────────
    //
    // 서브도메인 시절 주소다. 색인·소유확인이 그쪽에 걸려 있으므로
    // 끊지 않고 301 로 넘겨 신호를 옮긴다.
    //
    // ⚠ 이 분기는 안전장치이기도 하다. 아래 접두사 제거는 경로가
    //    /mojibake 로 시작한다고 가정하는데, 구 도메인 요청에는 접두사가
    //    없다. 그대로 흘리면 /styles.css 가 "ss" 로 잘려 404 가 되고
    //    /en/ 은 한국어 루트를 서빙한다 (실제로 그렇게 깨졌었다).
    if (url.hostname !== CANONICAL_HOST) {
      url.hostname = CANONICAL_HOST;
      url.pathname = PREFIX + url.pathname;
      return Response.redirect(url.toString(), 301);
    }

    // 접두사가 없는 요청은 손대지 않는다.
    // 라우트가 prelaps.com/mojibake/* 라서 원래 여기 올 수 없지만,
    // 라우트 설정이 바뀌었을 때 조용히 경로를 망가뜨리지 않도록 막아둔다.
    if (!url.pathname.startsWith(PREFIX)) {
      return withAnalytics(await env.ASSETS.fetch(request));
    }

    // /mojibake/en/ -> /en/   자산은 site/ 루트 기준이다.
    url.pathname = url.pathname.slice(PREFIX.length) || '/';

    // 허브로 옮긴 문서는 자산을 찾기 전에 넘긴다.
    // 확장자와 끝 슬래시를 떼고 맞춰본다 — 같은 문서가 세 가지 주소로 들어온다.
    const key = url.pathname.replace(/\.html$/, '').replace(/\/$/, '');
    if (MOVED[key]) {
      return Response.redirect(new URL(MOVED[key], url).toString(), 301);
    }

    const response = await env.ASSETS.fetch(new Request(url, request));

    // 자산 층이 돌려주는 리다이렉트의 Location 은 site/ 루트 기준이라
    // 접두사가 빠져 있다. 그대로 흘려보내면 도구 밖으로 튕긴다.
    //   /mojibake/index.html -> Location: /      -> 허브 홈으로 이탈
    //   /mojibake/en         -> Location: /en/   -> 허브의 영어 페이지로 이탈
    // 내부 링크가 href="index.html" 이므로 홈 버튼 한 번에 터진다.
    const location = response.headers.get('location');
    if (!location) return withAnalytics(response);

    const to = new URL(location, url);
    const headers = new Headers(response.headers);
    headers.set('location', PREFIX + to.pathname + to.search + to.hash);

    // 리다이렉트라 body 는 비어 있다. 상태 코드는 자산 층 것을 그대로 쓴다.
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
