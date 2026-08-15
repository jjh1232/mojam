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

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://prelaps.com';
const LANGS = ['ko', 'en', 'ja'];
const XDEFAULT = 'en';

let fails = 0;
const bad = (file, msg) => { fails++; console.log('  ✗ ' + file + ' — ' + msg); };

// ── 페이지 수집 ───────────────────────────────────────────────
// test/·docs/·samples/·node_modules/ 는 배포 대상이 아니라 제외한다.
const SKIP = new Set(['node_modules', 'test', 'docs', 'samples', '.git']);
function pages(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
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
    const target = resolve(href);
    if (!fs.existsSync(path.join(ROOT, target))) bad(rel, '깨진 링크 ' + href);
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
      if (resolve(href) !== want) bad(rel, '.langsw ' + L + ' 이 ' + resolve(href) + ' — ' + want + ' 이어야 한다');
    }
    if (!/<span aria-current="page">/.test(sw)) bad(rel, '.langsw 에 현재 언어 표시가 없다');
  }

  // 5. 푸터 법적 링크 4개 — 애드센스가 요구하는 자리이고, 자기 언어를 가리켜야 한다
  const fn = (src.match(/<nav class="fnav"[\s\S]*?<\/nav>/) || [])[0];
  if (!fn) bad(rel, '.fnav 가 없다');
  else {
    const want = ['about', 'privacy', 'terms', 'contact']
      .map(p => (lang === 'ko' ? '' : lang + '/') + 'content/' + p + '.html');
    const got = [...fn.matchAll(/href="([^"]+)"/g)].map(m => resolve(m[1]));
    for (const w of want) if (!got.includes(w)) bad(rel, '푸터에 ' + w + ' 링크가 없다 (언어 섞임?)');
  }
}

// ── 사이트맵이 페이지 목록과 일치하는가 ────────────────────────
const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const inMap = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
for (const rel of list) if (!inMap.has(urlOf(rel))) bad('sitemap.xml', urlOf(rel) + ' 누락');
for (const u of inMap) if (!list.some(rel => urlOf(rel) === u)) bad('sitemap.xml', u + ' 는 실제 파일이 없다');

console.log(fails === 0 ? '\n링크 검사 통과 — 0건' : '\n실패 ' + fails + '건');
process.exit(fails === 0 ? 0 : 1);
