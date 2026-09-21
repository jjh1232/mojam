'use strict';
/*
 * 링크 전수 검사.
 *
 * 왜 필요한가 — 페이지가 18장이고 전부 상대 경로다. 링크가 깨져도 화면에는
 * 아무 표시가 없고, 더 나쁜 것은 "살아 있지만 다른 언어를 가리키는" 링크다.
 * 영어 페이지 푸터가 한국어 약관으로 가도 브라우저는 멀쩡히 연다.
 * 그래서 존재 검사만으로는 부족하고 언어 일치까지 같이 본다.
 *
 * 도구가 늘면 .langsw 경로가 페이지마다 달라진다(도구 A 의 영어판은 도구 A 여야 한다).
 * 그 실수를 잡는 것이 이 파일의 주 용도다.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', 'site');
const ORIGIN = 'https://prelaps.com/mojibake';
const LANGS = ['ko', 'en', 'ja'];
const XDEFAULT = 'en';

let fails = 0;
const bad = (file, msg) => { fails++; console.log('  ✗ ' + file + ' — ' + msg); };

// ── 페이지 수집 ───────────────────────────────────────────────
// ROOT 가 site/ 라 test/·docs/ 는 애초에 안 걸린다. 이 목록은 site/ 안에
// 실수로 들어올 수 있는 것들만 남겨둔 방어선이다.
const SKIP = new Set(['node_modules', '.git']);
// 404.html 은 15장짜리 언어 격자에 속하지 않는다 — 주소가 하나뿐이라
// canonical·hreflang·sitemap·langsw 검사가 전부 의미가 없다.
// 대신 아래 "404" 절에서 따로 본다.
const NOINDEX = new Set(['404.html']);
function pages(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name.endsWith('.html')) {
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (!NOINDEX.has(rel)) out.push(rel);
    }
  }
  return out;
}

// ── 경로 ↔ 언어 ↔ URL ─────────────────────────────────────────
const langOf = rel => (rel.startsWith('en/') ? 'en' : rel.startsWith('ja/') ? 'ja' : 'ko');
// 언어 접두어를 뗀 형태. 언어별 형제 페이지를 만들 때 쓴다.
const neutral = rel => rel.replace(/^(en|ja)\//, '');
const sibling = (rel, lang) => (lang === 'ko' ? '' : lang + '/') + neutral(rel);
// 배포 URL 은 확장자가 없다 — Cloudflare Pages·Netlify 가 .html 을 떼고 301 한다.
const urlOf = rel => ORIGIN + '/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '');

// 내부 링크도 확장자가 없다(2026-09-21). 링크가 가리키는 주소를 다시 파일
// 이름으로 되돌려야 존재 검사를 할 수 있다.
//   './' -> index.html      'en/' -> en/index.html
//   'content/about' -> content/about.html
// styles.css·favicon.svg 처럼 이미 확장자가 있는 것은 그대로 둔다
// (이 함수는 href 와 src 를 같이 받는다).
const toFile = t => {
  const p = t.startsWith('./') ? t.slice(2) : t;
  if (p === '' || p.endsWith('/')) return p + 'index.html';
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (base.includes('.')) return p;
  return p + '.html';
};

const list = pages().sort();
const exists = new Set(list);

console.log('페이지 ' + list.length + '장\n');

for (const rel of list) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const lang = langOf(rel);
  const dir = path.posix.dirname(rel);
  const resolve = href => path.posix.normalize(path.posix.join(dir, href));

  // 1. 상대 링크가 실제 파일을 가리키는가
  for (const m of src.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#|data:)/.test(href)) continue;
    const target = toFile(resolve(href));
    if (!fs.existsSync(path.join(ROOT, target))) bad(rel, '깨진 링크 ' + href);
  }

  // 1-2. 내부 링크에 .html 이 남아 있으면 안 된다.
  //
  // 2026-09-21 이전에는 링크가 excel-csv.html 이었다. 자산 층이 .html 을 떼고
  // 서빙하므로 그 링크는 전부 307 을 한 번 타고 최종 주소에 닿았다 — 화면에는
  // 아무 표시가 없다. 그런데 구글은 내부 링크가 가리키는 주소(.html)와
  // canonical(확장자 없음)이 다른 것으로 보아, 내부 링크 907개 중 129개를
  // 「리디렉션이 포함된 페이지」쪽으로 셌다. content/about 3장은 정식 주소로
  // 들어오는 링크가 0 이라 사실상 고아였다.
  for (const m of src.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#|data:)/.test(href)) continue;
    if (href.endsWith('.html')) bad(rel, '내부 링크에 .html 이 있다 — ' + href + ' (canonical 은 확장자가 없다)');
  }

  // 2. <html lang> 이 폴더와 맞는가
  const htmlLang = (src.match(/<html lang="([^"]+)"/) || [])[1];
  if (htmlLang !== lang) bad(rel, '<html lang> 이 ' + htmlLang + ' — ' + lang + ' 이어야 한다');

  // 3. canonical · hreflang · og
  const canon = (src.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
  if (canon !== urlOf(rel)) bad(rel, 'canonical 이 ' + canon + ' — ' + urlOf(rel) + ' 이어야 한다');
  for (const L of LANGS) {
    const want = urlOf(sibling(rel, L));
    const got = (src.match(new RegExp('hreflang="' + L + '" href="([^"]+)"')) || [])[1];
    if (got !== want) bad(rel, 'hreflang=' + L + ' 이 ' + got + ' — ' + want + ' 이어야 한다');
  }
  const xd = (src.match(/hreflang="x-default" href="([^"]+)"/) || [])[1];
  if (xd !== urlOf(sibling(rel, XDEFAULT))) bad(rel, 'x-default 가 ' + xd);
  const ogu = (src.match(/<meta property="og:url" content="([^"]+)">/) || [])[1];
  if (ogu !== urlOf(rel)) bad(rel, 'og:url 이 ' + ogu);
  if (!/<meta property="og:image" content="https:\/\//.test(src)) bad(rel, 'og:image 가 절대 URL 이 아니다');

  // 4. 언어 전환기 — 자기 언어는 <span>, 나머지 둘은 "같은 페이지의 다른 언어" 여야 한다.
  //    존재만 보면 놓친다. 도구가 늘면 여기가 가장 먼저 어긋난다.
  const sw = (src.match(/<nav class="langsw"[\s\S]*?<\/nav>/) || [])[0];
  if (!sw) bad(rel, '.langsw 가 없다');
  else {
    for (const L of LANGS) {
      if (L === lang) continue;
      const href = (sw.match(new RegExp('href="([^"]+)" hreflang="' + L + '"')) || [])[1];
      if (!href) { bad(rel, '.langsw 에 ' + L + ' 링크가 없다'); continue; }
      const want = sibling(rel, L);
      if (toFile(resolve(href)) !== want) bad(rel, '.langsw ' + L + ' 이 ' + toFile(resolve(href)) + ' — ' + want + ' 이어야 한다');
    }
    if (!/<span aria-current="page">/.test(sw)) bad(rel, '.langsw 에 현재 언어 표시가 없다');
  }

  // 5. 푸터 법적 링크 — 애드센스가 요구하는 자리이고, 자기 언어를 가리켜야 한다.
  //
  // 개인정보처리방침·이용약관·문의는 **허브에 하나씩** 있다 (헌법 §8).
  // 이 도구는 헌법보다 먼저 만들어져서 자기 복사본을 갖고 있었는데, 2026-08-22 에
  // 허브로 넘기고 파일을 지웠다. 옛 주소는 src/index.js 의 MOVED 가 301 로 넘긴다.
  // 소개(about)는 도구 소개 내용이 섞여 있어 아직 도구에 남아 있다.
  const fn = (src.match(/<nav class="fnav"[\s\S]*?<\/nav>/) || [])[0];
  if (!fn) bad(rel, '.fnav 가 없다');
  else {
    const raw = [...fn.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    const got = raw.map(h => (/^https?:/.test(h) ? h : toFile(resolve(h))));

    // 도구에 남아 있는 것
    const own = (lang === 'ko' ? '' : lang + '/') + 'content/about.html';
    if (!got.includes(own)) bad(rel, '푸터에 ' + own + ' 링크가 없다 (언어 섞임?)');

    // 허브로 넘긴 것 — 반드시 자기 언어여야 한다
    const hub = {
      privacy: 'https://prelaps.com/' + lang + '/privacy#mojibake',
      terms: 'https://prelaps.com/' + lang + '/terms',
      contact: 'https://prelaps.com/' + lang + '/contact',
    };
    for (const [name, url] of Object.entries(hub)) {
      if (!got.includes(url)) bad(rel, '푸터의 ' + name + ' 가 허브(' + url + ')를 안 가리킨다');
    }
    // 도구 안에 정책 파일이 되살아나는 것을 막는다
    for (const h of raw) {
      const t = h.endsWith('.html') ? h.slice(0, -5) : h;
      if (['privacy', 'terms', 'contact'].some(name => t.endsWith('content/' + name))) {
        bad(rel, '정책 링크가 도구 안(' + h + ')을 가리킨다 — 허브로 가야 한다');
      }
    }
  }
}

// ── 사이트맵 ─────────────────────────────────────────────────
// 2026-08-22 에 정책 페이지를 허브로 넘기면서 이 파일에서 URL 블록을 지웠는데,
// 마지막 블록에 </urlset> 이 붙어 있어서 **닫는 태그가 같이 사라졌다.**
// 화면에는 아무 표시가 없었고, 구글 서치콘솔이 「오류 1개 · 발견된 페이지 0」 으로
// 알려줄 때까지 몰랐다. 그래서 여기서 형태를 직접 본다.
{
  const rel = 'sitemap.xml';
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    bad(rel, '사이트맵이 없다');
  } else {
    const src = fs.readFileSync(abs, 'utf8');
    if (!/<urlset[\s>]/.test(src)) bad(rel, '<urlset> 이 없다');
    if (!/<\/urlset>/.test(src)) bad(rel, '</urlset> 이 닫히지 않았다 — 구글이 통째로 못 읽는다');
    const opens = (src.match(/<url>/g) || []).length;
    const closes = (src.match(/<\/url>/g) || []).length;
    if (opens !== closes) bad(rel, `<url> ${opens}개 / </url> ${closes}개 — 짝이 안 맞는다`);
    if (opens === 0) bad(rel, '<url> 이 하나도 없다');

    // 사이트맵에 적힌 주소가 실제로 있는 파일인지. 확장자 없는 주소로 쓰므로 .html 을 붙여 본다.
    const fileOfLoc = loc => {
      const p = loc.replace(ORIGIN, '');
      return (p.endsWith('/') ? p + 'index.html' : p + '.html').replace(/^\//, '');
    };
    for (const m of src.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      if (!fs.existsSync(path.join(ROOT, fileOfLoc(m[1])))) bad(rel, `없는 페이지를 가리킨다 ${m[1]}`);
    }

    // lastmod 가 그 페이지의 실제 변경일과 맞는지.
    //
    // 손으로 적는 값이라, 페이지를 고치고 여기를 안 고치면 조용히 낡는다.
    // 반대로 배포할 때마다 오늘로 찍는 것도 안 된다 — 구글이 다시 긁어보고
    // 바뀐 게 없다는 것을 알아채면 **이 사이트의 lastmod 를 통째로 무시한다.**
    // 그래서 git 이 아는 실제 날짜와 대조한다.
    //   커밋된 파일   -> 마지막 커밋 날짜
    //   수정 중인 파일 -> 파일 수정 시각
    // git 을 못 쓰는 환경이면 이 검사만 조용히 건너뛴다 (null).
    const changedOn = file => {
      try {
        const opt = { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
        const dirty = execSync(`git status --porcelain -- "site/${file}"`, opt).trim();
        if (dirty) return fs.statSync(path.join(ROOT, file)).mtime.toISOString().slice(0, 10);
        return execSync(`git log -1 --format=%cs -- "site/${file}"`, opt).trim() || null;
      } catch {
        return null;
      }
    };
    for (const m of src.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = (m[1].match(/<loc>([^<]+)<\/loc>/) || [])[1];
      const lastmod = (m[1].match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
      if (!loc) continue;
      if (!lastmod) { bad(rel, `lastmod 가 없다 ${loc}`); continue; }
      const real = changedOn(fileOfLoc(loc));
      if (real && lastmod < real) {
        bad(rel, `lastmod 가 낡았다 ${loc} — ${lastmod} 로 적혀 있는데 파일은 ${real} 에 바뀌었다`);
      }
    }
  }
}

// ── 404 ──────────────────────────────────────────────────────
// Cloudflare Pages 는 404.html 이 없으면 index.html 을 status 200 으로 돌려준다.
// 그러면 없는 주소가 전부 "정상 페이지" 로 색인되는 soft 404 가 되는데,
// 화면상 아무 표시가 없어서 눈으로는 절대 못 잡는다. 그래서 존재를 강제한다.
{
  const rel = '404.html';
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    bad(rel, '404 페이지가 없다 — 없으면 index.html 이 200 으로 나가 soft 404 가 된다');
  } else {
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#|data:)/.test(href)) continue;
      if (!fs.existsSync(path.join(ROOT, toFile(path.posix.normalize(href))))) bad(rel, '깨진 링크 ' + href);
    }
    if (!/<meta name="robots" content="noindex/.test(src)) bad(rel, 'noindex 가 없다');
    if (/<link rel="canonical"/.test(src)) bad(rel, 'canonical 이 있다 — 실재하지 않는 주소를 선언하면 안 된다');
  }
}

// ── 구조화 데이터 ─────────────────────────────────────────────
// FAQPage 의 문항이 화면 문구와 한 글자라도 다르면 구글이 통째로 무시한다.
// 규칙으로만 적어뒀더니 3언어 15문항 중 13문항이 어긋난 채로 있었다.
for (const rel of list) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const blocks = [...src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];

  const faq = [];
  for (const [, raw] of blocks) {
    let json;
    try { json = JSON.parse(raw); }
    catch (e) { bad(rel, 'JSON-LD 파싱 실패 — ' + e.message); continue; }
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (o['@type'] === 'FAQPage' && Array.isArray(o.mainEntity))
        for (const q of o.mainEntity) faq.push({ q: q.name, a: q.acceptedAnswer && q.acceptedAnswer.text });
      for (const v of Object.values(o)) walk(v);
    })(json);
  }
  if (!faq.length) continue;

  // 화면의 FAQ 는 <p class="note"><b>질문</b><br>답변</p> 라는 모양이다.
  //
  // 예전에는 「마지막 <h2> 뒤」만 훑었는데, FAQ 절 다음에 h2 가 하나라도 더 붙으면
  // 훑는 범위가 통째로 빗나가 0문항으로 잡힌다. 실제로 읽을 거리 절을 뒤에 붙였다가
  // 그렇게 터졌다.
  //
  // 그래서 문서 전체를 훑되, **문단 경계를 넘지 않게** 가둔다. 그냥 [\s\S]*? 로 두면
  // FAQ 가 아닌 <p class="note"><b>…</b> 에서 시작해 한참 뒤의 </b><br> 까지 한 덩어리로
  // 삼켜, 문항 수는 맞는데 내용이 본문 전체가 되는 일이 생긴다 (실제로 그렇게 나왔다).
  const strip = t => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const FAQ_RE = /<p class="note"><b>((?:(?!<\/p>)[\s\S])*?)<\/b><br>((?:(?!<\/p>)[\s\S])*?)<\/p>/g;
  const seen = [...src.matchAll(FAQ_RE)]
    .map(m => ({ q: strip(m[1]), a: strip(m[2]) }));

  if (faq.length !== seen.length)
    bad(rel, 'FAQPage ' + faq.length + '문항인데 화면은 ' + seen.length + '문항');
  else for (let i = 0; i < faq.length; i++) {
    if (faq[i].q !== seen[i].q) bad(rel, 'FAQ 질문 ' + (i + 1) + ' 이 화면과 다르다 — LD "' + faq[i].q + '" / 화면 "' + seen[i].q + '"');
    else if (faq[i].a !== seen[i].a) bad(rel, 'FAQ 답변 ' + (i + 1) + ' ("' + faq[i].q + '") 이 화면과 다르다');
  }
}

// ── 사이트맵이 페이지 목록과 일치하는가 ────────────────────────
const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const inMap = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
for (const rel of list) if (!inMap.has(urlOf(rel))) bad('sitemap.xml', urlOf(rel) + ' 누락');
for (const u of inMap) if (!list.some(rel => urlOf(rel) === u)) bad('sitemap.xml', u + ' 는 실제 파일이 없다');

console.log(fails === 0 ? '\n링크 검사 통과 — 0건' : '\n실패 ' + fails + '건');
process.exit(fails === 0 ? 0 : 1);
