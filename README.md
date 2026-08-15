# Prelaps

브라우저 안에서만 도는 텍스트 도구 모음 (`prelaps.com`). 첫 번째 도구가 **깨진 글자 복구기**(`/mojibake`)다.

인코딩 불일치로 깨진 텍스트를 복구한다. 입력은 두 가지 — **붙여넣기**와 **파일**. 파일은 txt·csv·srt·json 같은 텍스트 파일의 인코딩을 판별해 UTF-8 로 바꿔 내려주고, ZIP 은 안쪽 한글 파일명을 고쳐 다시 묶어준다. 원본 바이트를 그대로 읽기 때문에 **파일 쪽이 붙여넣기보다 정확하다.**

**서버 없이 클라이언트에서만 동작한다.** 입력이 서버로 가지 않는 것이 이 도구의 차별점이다.

---

## 빠른 시작

```bash
npm install          # iconv-lite (테스트용 devDependency)
npm test             # 링크 전수 검사 + Node·브라우저 벤치마크 (붙여넣기·파일 두 모드)
```

도구를 보려면 `site/mojibake.html` 을 브라우저로 **더블클릭**하면 된다. 빌드 과정 없음, 서버 불필요.

```bash
npm run serve        # 필요하면 로컬 서버로 (http://localhost:3000)
```

---

## 구조

**빌드 단계가 없다.** `site/` 안의 파일이 그대로 사이트다. 아무 파일이나 브라우저로 열면 그게 실제 화면이다.

```
prelaps/
├─ site/              ★ 이 폴더가 그대로 배포된다
│  ├─ index.html         한국어 허브 (도구 목록).  <script> 없음
│  ├─ mojibake.html      한국어 도구
│  ├─ en/  ja/           영어·일본어. 각각 index.html + mojibake.html + content/
│  ├─ content/           법적 페이지 4개 (about·privacy·terms·contact)
│  │
│  ├─ engine.js          ★ 복구 엔진. 언어 중립이라 3언어가 공유한다
│  ├─ ui.js              ★ 화면 코드. 글자를 직접 안 쓰고 I18N 에서 꺼낸다
│  ├─ i18n.ko.js         ★ 언어별 화면 문자열 — 새 언어는 이 파일 하나가 번역 대상
│  ├─ i18n.en.js  i18n.ja.js
│  ├─ styles.css         18장이 공유하는 유일한 스타일 파일
│  │
│  ├─ robots.txt  sitemap.xml
│  ├─ _headers           보안 응답 헤더. Cloudflare Pages·Netlify 가 읽는다
│  ├─ favicon.svg        탭 아이콘. 글자 없이 도형만 (한글 글꼴 없는 환경 대비)
│  └─ og-image.png       1200×630 링크 미리보기
│
├─ test/              개발용. 배포 안 감
├─ docs/기획서.md      상세 기획
├─ CLAUDE.md          작업 규칙 — 고치기 전에 읽을 것
└─ package.json
```

**페이지는 18장이다** — 허브 3 + 도구 3 + 법적 4×3.

**페이지는 `engine.js` → `i18n.<언어>.js` → `ui.js` 순서로 부른다.** `ui.js` 가 `I18N` 을 읽으므로 순서를 바꾸면 안 된다.

---

## 고칠 곳

| 고치고 싶은 것 | 파일 |
|---|---|
| 복구 로직 · 정확도 | `site/engine.js` (3언어 공유) |
| 화면 동작 | `site/ui.js` (3언어 공유, 사람이 읽는 글자를 넣지 말 것) |
| 버튼·라벨·안내 문구 | `site/i18n.<언어>.js` |
| 본문 글 · FAQ | `site/mojibake.html` · `site/en/mojibake.html` · `site/ja/mojibake.html` |
| 도구 목록 | `site/index.html` (+ `en/` · `ja/`) |
| 색 · 글꼴 · 여백 | `site/styles.css` |
| 약관 · 개인정보 · 소개 · 문의 | `site/content/*.html` (+ `en/` · `ja/`) — 도메인 전체 공용 |

⚠ **푸터는 18개 파일에 들어 있고 내용은 6종이다** (번역 3 × 경로 깊이 2). 고칠 때는 6종을 먼저 정하고 뿌릴 것 — 18번 따로 쓰면 그중 하나가 어긋난다. 빌드를 없앤 대가는 이것 하나다.

```bash
cd site && grep -lc fnav *.html en/*.html ja/*.html content/*.html en/content/*.html ja/content/*.html
```

---

## 검사

**링크는 눈으로 보지 말 것.** 18장 × 상대 경로라 깨져도 화면에 표시가 없고, 영어 페이지 푸터가 한국어 약관을 가리켜도 브라우저는 멀쩡히 연다.

```bash
npm run check:links    # 2초. 페이지만 고쳤으면 이것만 돌려도 된다
```

무엇을 보는지 — 상대 링크가 실제 파일을 가리키는가 / `<html lang>` 이 폴더와 맞는가 / `canonical`·`og:url` 이 그 파일의 URL 인가 / `hreflang` 4줄과 `.langsw` 가 **같은 페이지의 다른 언어**인가 / 푸터가 자기 언어 `content/` 인가 / `sitemap.xml` 이 페이지 목록과 정확히 일치하는가.

**엔진을 고쳤으면 반드시 `npm test`.** 하한 미달이면 커밋 금지.

```bash
npm run bench:node     # 붙여넣기 모드 (Node)
npm run bench:file     # 파일 모드 + BOM·이진·ZIP 가드 (Node)
npm run bench:browser  # 두 모드 다 (Chrome/Edge headless) ← 실사용 기준
```

### 정확도 (148건, 12개 언어)

| 모드 | Node (게이트) | **브라우저 (실사용)** |
|---|---|---|
| 붙여넣기 | 82.4% / 3개 내 86.5% | **84.5% / 3개 내 96.6%** |
| 파일 | 76.6% / 3개 내 81.8% | **75.3% / 3개 내 88.3%** |

**정확도를 인용할 때는 브라우저 숫자를 쓴다.** Node 는 ICU, 브라우저는 WHATWG index 표를 써서 `TextDecoder` 결과가 다르다 (euc-kr 기준 Node 8,412쌍 / Chrome 17,048쌍). Node 벤치는 빠른 게이트일 뿐이다.

**두 모드의 숫자를 섞지 말 것** — 케이스 집합이 다르다. 파일 벤치는 단일바이트 인코딩 12종을 동등 비중으로 재는데 그 구간이 원리적 동점이라 전체 숫자를 끌어내린다. 같은 CJK 구간만 보면 파일 모드가 훨씬 높다 (utf-8·euc-kr·gbk 각 100%).

### 경쟁 도구 대비

[ftfy](https://github.com/rspeer/python-ftfy) 는 mojibake 복구의 사실상 표준이지만 **CJK 가 얽힌 깨짐은 대상 밖이다** (71건 중 0건). 서구권 오독 구간에서는 96.8% 로 거의 완벽하다.

| 구간 | n | ftfy 6.3.1 | 이 도구 |
|---|---|---|---|
| 전체 | 148 | 24.3% | **84.5%** |
| UTF-8 → 서구권 오독 | 31 | 96.8% | 100% |
| CJK 인코딩으로 오독 | 20 | 0.0% | **100%** |
| 키릴 인코딩으로 오독 | 39 | 15.4% | **97.4%** |

---

## 배포

**`site/` 폴더가 그대로 배포된다.** Cloudflare Pages 설정은 세 칸뿐이다.

| 항목 | 값 |
|---|---|
| 프레임워크 프리셋 | `None` |
| 빌드 명령 | **비움** |
| 빌드 출력 디렉터리 | `site` |

빌드 명령에 뭔가를 적으면 그 순간 "원본과 산출물 두 벌" 이 생긴다. 비워두는 것이 이 프로젝트의 전제다.

`test/` · `docs/` · `CLAUDE.md` 는 `site/` 밖에 있어 자동으로 빠진다 — 저장소 루트를 배포하면 기획서가 색인된다.

**수정 흐름**

```
site/ 안의 파일을 고친다  →  npm run check:links  →  commit  →  push  →  자동 배포
```

엔진(`site/engine.js`)을 건드렸으면 `check:links` 대신 `npm test` 를 돌린다.

**배포 직후 확인할 것** — 개발자도구 Network 탭에서 `X-Content-Type-Options: nosniff` 가 붙었는지(`_headers` 가 먹었는지 화면상 표시가 없다), `/mojibake.html` 이 `/mojibake` 로 301 되는지(`canonical`·`sitemap` 이 확장자 없는 주소를 쓴다).

---

## 더 읽을 것

- **`CLAUDE.md`** — 작업 규칙. 채점 로직·파일 모드·다국어·CSS 를 건드리기 전에 해당 절을 읽을 것. 되돌린 시도와 그 이유가 적혀 있다.
- **`docs/기획서.md`** — 정확도 개선 이력(1~18차), 알려진 한계, 마일스톤.
