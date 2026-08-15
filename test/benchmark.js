// 복구 엔진 회귀 테스트 (Node)
// 사용법:  node test/benchmark.js
//
// ⚠ 이건 빠른 게이트일 뿐 실제 정확도가 아니다.
//    Node 의 TextDecoder(ICU) 와 브라우저의 TextDecoder(WHATWG index) 는 표가 다르다.
//    특히 euc-kr 은 Node 가 8,412쌍, Chrome 이 17,048쌍을 매핑한다.
//    사용자가 쓰는 값은 `npm run bench:browser` 쪽이다.
//
// 채점 배점이나 인코딩 후보를 건드린 뒤 반드시 둘 다 실행할 것.

const E = require('../engine.js');
const { build, report, buildParagraphs, buildMixed,
        buildWrapped, cleanTexts, WRAPPERS, buildNbspLost } = require('./cases.js');

const THRESHOLD = 80;  // 1순위 정답률 하한 (%) — 목표치가 아니라 회귀 감지선

const cases = build();
const t0 = Date.now();
const rows = cases.map(c => [c, E.recover(c.broken).list.map(r => r.text)]);
const ms = Date.now() - t0;

let ok = report(rows, `Node ${process.version}  (${ms}ms, 평균 ${(ms / cases.length).toFixed(1)}ms/건)`, THRESHOLD);

/* ─────────── 결과 언어 라벨 ─────────── */
// 후보 옆에 붙는 라벨이 실제 언어와 모순되지 않는지 본다.
// 문자로 단정할 수 없는 것은 문자 이름으로 물러서므로, 정답 집합에 그 키도 넣는다
// (cyrillic 은 러시아어·우크라이나어 공용, latin 은 서유럽 여러 언어 공용).
//
// ⚠ 번역문이 아니라 **키**로 검사한다. langHint() 는 'ko'·'cyrillic' 같은 키만 돌려주고
//   사람이 읽는 글자는 화면 코드의 I18N 이 만든다. 키로 검사해야 번역을 고쳐도 안 깨진다.
const LANG_OK = {
  ko: ['ko'],
  ja: ['ja', 'han'],
  zh: ['zhHans', 'zhHant', 'han'],
  ru: ['cyrillic'],
  de: ['westeur', 'centeur', 'tr', 'baltic', 'latin'],
  fr: ['westeur', 'centeur', 'tr', 'latin'],
  pl: ['centeur', 'westeur', 'baltic', 'latin'],
  vi: ['vi', 'westeur', 'latin'],
  th: ['th'], he: ['he'], ar: ['ar'], el: ['el'],
};
const LANG_THRESHOLD = 90;  // 어긋나는 것은 가나 없는 일본어처럼 원리적으로 구분 불가한 경우뿐이어야 한다

let hit = 0;
const langBad = [];
for (const c of cases) {
  const got = E.langHint(c.text, c.actual);
  if ((LANG_OK[c.lang] || []).includes(got)) hit++;
  else langBad.push(`  ${c.lang} ${c.actual.padEnd(13)} → ${JSON.stringify(got)}  ${JSON.stringify(c.text.slice(0, 20))}`);
}
const rate = hit / cases.length * 100;
console.log(`\n══ 결과 언어 라벨 ══`);
console.log(`실제 언어와 일치  ${hit}/${cases.length}  (${rate.toFixed(1)}%)`);
if (langBad.length) {
  console.log('어긋난 것');
  langBad.slice(0, 10).forEach(b => console.log(b));
  if (langBad.length > 10) console.log(`  … 외 ${langBad.length - 10}건`);
}
if (rate < LANG_THRESHOLD) {
  console.log(`\n[FAIL] 언어 라벨 일치율 ${rate.toFixed(1)}% — 하한 ${LANG_THRESHOLD}% 미달.`);
  ok = false;
} else {
  console.log(`\n[PASS] 언어 라벨 하한 ${LANG_THRESHOLD}% 통과`);
}

/* ─────────── 여러 줄 입력 (줄마다 다른 깨짐) ─────────── */
// 두 방향을 같이 잰다. 이득만 보면 정상 문단을 망가뜨리는 변경을 통과시키게 된다.
//
//   문단 = 한 언어·한 유형의 여러 줄 → recoverLines() 가 **발동하면 안 된다**
//          (문장이 길수록 채점이 정확하므로 통짜가 낫다)
//   섞임 = 서로 다른 유형이 섞인 여러 줄 → 통짜로는 거의 못 푸는 구간
const MIXED_FLOOR = 25;   // 섞임 구간 1순위 정답률 하한 (%)

const paras = buildParagraphs();
const mixed = buildMixed();

let paraFire = 0, paraOk = 0;
const paraBad = [];
for (const p of paras) {
  const lr = E.recoverLines(p.broken);
  if (lr) { paraFire++; paraBad.push(`  ${p.lang} ${p.pair}`); }
  const got = lr ? lr.text : (E.recover(p.broken).list[0] || {}).text;
  if (got === p.text) paraOk++;
}

let mixWhole = 0, mixNow = 0;
for (const m of mixed) {
  const whole = (E.recover(m.broken).list[0] || {}).text;
  if (whole === m.text) mixWhole++;
  const lr = E.recoverLines(m.broken);
  if ((lr ? lr.text : whole) === m.text) mixNow++;
}

console.log('\n══ 여러 줄 입력 ══');
console.log(`한 언어·한 유형 문단 ${paras.length}건   정답 ${paraOk}   줄별 발동 ${paraFire}건 (0이어야 정상)`);
paraBad.slice(0, 5).forEach(b => console.log(b));
const mixRate = mixNow / mixed.length * 100;
console.log(`유형 섞인 입력 ${mixed.length}건       통짜 ${mixWhole} (${(mixWhole / mixed.length * 100).toFixed(0)}%)  →  현재 ${mixNow} (${mixRate.toFixed(0)}%)`);

if (paraFire > 0) {
  console.log(`\n[FAIL] 정상 문단에서 줄별 복구가 ${paraFire}건 발동했다. 잘 되던 입력을 건드리고 있다.`);
  ok = false;
} else if (mixRate < MIXED_FLOOR) {
  console.log(`\n[FAIL] 섞인 입력 정답률 ${mixRate.toFixed(1)}% — 하한 ${MIXED_FLOOR}% 미달.`);
  ok = false;
} else {
  console.log(`\n[PASS] 문단 무간섭 + 섞임 하한 ${MIXED_FLOOR}% 통과`);
}

/* ─────────── 맥락이 붙은 입력 (정상 글자 + 깨진 글자가 한 줄에) ─────────── */
// 여기도 두 방향을 같이 잰다. 이득만 보면 정상 문장을 망가뜨리는 변경을 통과시키게 된다.
//
//   래퍼  = "제목: <깨짐> 입니다" 처럼 정상 글자가 섞인 입력 → 통짜로는 후보 0개인 구간
//   정상  = 안 깨진 문장·문단 → 줄별·구간 카드가 **뜨면 안 된다**
//   통짜  = 통짜로 이미 정답을 맞힌 케이스 → 그 위에 카드가 **뜨면 안 된다**
//
// 세 번째가 뒤늦게 추가된 선이다. 처음엔 "통짜가 맞히면 통짜로 세고 아니면 구간을 시도한다"
// 로만 재서, 통짜가 이미 성공했는데 구간 복구가 끼어드는 경우를 못 봤다. 실제로 정답을
// 찾아놓고 그 위에 오답 카드를 띄우고 있었다 (카드가 .res.best 라 화면에서 가장 큰 자리다).
const WRAP_FLOOR = 50;    // 래퍼 구간 1순위 정답률 하한 (%)

// index.html 의 run() 과 같은 분기. 카드가 언제 뜨는지를 그대로 재현해야 의미가 있다.
function route(s) {
  const { base, list } = E.recover(s);
  const lr = E.recoverLines(s);
  const wholeOk = list.length && list[0].score >= base + 10;
  const sg = (lr || wholeOk) ? null : E.recoverSegments(s);
  return { rank: (list[0] || {}).text || null, card: lr ? lr.text : (sg ? sg.text : null) };
}

const wrapped = buildWrapped();
const byWrap = {};
let wrapWhole = 0, wrapNow = 0;

for (const w of wrapped) {
  const W = byWrap[w.wrap] = byWrap[w.wrap] || { whole: 0, now: 0, total: 0 };
  W.total++;
  const r = route(w.broken);
  if (r.rank === w.want) { wrapWhole++; wrapNow++; W.whole++; W.now++; }
  else if (r.card === w.want) { wrapNow++; W.now++; }
}

const cleans = cleanTexts();
let segFire = 0;
const segBad = [];
for (const t of cleans) {
  const r = route(t);
  if (r.card) { segFire++; segBad.push(`  ${JSON.stringify(t.slice(0, 24))} → ${JSON.stringify(r.card.slice(0, 24))}`); }
}

// 통짜로 정답을 맞힌 케이스 위에 카드가 얹히면 안 된다
let overFire = 0;
const overBad = [];
for (const c of build()) {
  const r = route(c.broken);
  if (r.rank === c.text && r.card) {
    overFire++;
    overBad.push(`  ${c.name} ${c.actual}→${c.misread} : ${JSON.stringify(r.card.slice(0, 24))}`);
  }
}

console.log('\n══ 맥락이 붙은 입력 ══');
console.log(`유효 케이스 ${wrapped.length}개  (${build().length}건 × 래퍼 ${WRAPPERS.length}종)`);
for (const [wrap, v] of Object.entries(byWrap)) {
  console.log(`  ${wrap.padEnd(16)} 통짜 ${String((v.whole / v.total * 100).toFixed(0) + '%').padStart(4)}  →  구간 복구까지 ${String((v.now / v.total * 100).toFixed(0) + '%').padStart(4)}`);
}
const wrapRate = wrapNow / wrapped.length * 100;
console.log(`  ${'전체'.padEnd(16)} 통짜 ${(wrapWhole / wrapped.length * 100).toFixed(1)}%  →  구간 복구까지 ${wrapRate.toFixed(1)}%`);
console.log(`정상 문장·문단 ${cleans.length}건에서 줄별·구간 카드 ${segFire}건 (0이어야 정상)`);
segBad.slice(0, 5).forEach(b => console.log(b));
console.log(`통짜로 맞힌 케이스 위에 카드 ${overFire}건 (0이어야 정상)`);
overBad.slice(0, 5).forEach(b => console.log(b));

if (segFire > 0) {
  console.log(`\n[FAIL] 안 깨진 입력에서 카드가 ${segFire}건 떴다. 잘 되던 입력을 건드리고 있다.`);
  ok = false;
} else if (overFire > 0) {
  console.log(`\n[FAIL] 통짜로 정답을 맞힌 입력 ${overFire}건 위에 카드가 얹혔다. 정답 위에 오답을 띄우고 있다.`);
  ok = false;
} else if (wrapRate < WRAP_FLOOR) {
  console.log(`\n[FAIL] 맥락 붙은 입력 정답률 ${wrapRate.toFixed(1)}% — 하한 ${WRAP_FLOOR}% 미달.`);
  ok = false;
} else {
  console.log(`\n[PASS] 무간섭(정상·통짜) + 맥락 하한 ${WRAP_FLOOR}% 통과`);
}

/* ─────────── 붙여넣다가 NBSP 를 잃은 입력 ─────────── */
// 메신저·HTML·웹 입력창·엑셀이 NBSP(U+00A0) 를 일반 공백으로 조용히 바꾼다.
// 사용자는 자기 입력이 손상됐다는 걸 알 방법이 없고, 고치기 전에는 20건이 전부 실패했다.
//
// C1 소실과 혼동하지 말 것 — C1 은 바이트가 진짜로 사라져 복구 불가지만(기획서 5.1.2),
// NBSP 는 UTF-8 이어지는 바이트가 0x80~0xBF 여야 한다는 구조 덕에 되살아난다.
const NBSP_FLOOR = 80;   // 되살린 뒤 1순위 정답률 하한 (%)

const nbspLost = buildNbspLost();
let nbspOk = 0;
const nbspBad = [];
for (const c of nbspLost) {
  const r = route(c.broken);
  if (r.rank === c.text || r.card === c.text) nbspOk++;
  else nbspBad.push(`  ${c.name.padEnd(9)} ${c.actual}→${c.misread}  ${JSON.stringify((r.rank || '없음').slice(0, 24))}`);
}

console.log('\n══ 붙여넣다가 NBSP 를 잃은 입력 ══');
console.log(`유효 케이스 ${nbspLost.length}개  (전체 ${build().length}건 중 NBSP 가 든 것)`);
const nbspRate = nbspLost.length ? nbspOk / nbspLost.length * 100 : 100;
console.log(`1순위 정답  ${nbspOk}  (${nbspRate.toFixed(1)}%)   [복원 없이는 0%]`);
nbspBad.slice(0, 5).forEach(b => console.log(b));

if (nbspRate < NBSP_FLOOR) {
  console.log(`\n[FAIL] NBSP 소실 정답률 ${nbspRate.toFixed(1)}% — 하한 ${NBSP_FLOOR}% 미달.`);
  ok = false;
} else {
  console.log(`\n[PASS] NBSP 복원 하한 ${NBSP_FLOOR}% 통과`);
}

if (!ok) process.exit(1);
