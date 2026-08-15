// 복구 엔진 회귀 테스트 (실제 브라우저)
// 사용법:  node test/browser.js
//
// 왜 필요한가 — 엔진은 TextDecoder 의 인코딩 표를 그대로 신뢰하는데,
// Node(ICU) 와 브라우저(WHATWG index) 의 표가 다르다. euc-kr 은 Node 8,412쌍 /
// Chrome 17,048쌍으로 두 배 차이가 난다. Node 벤치마크만 보면 엔진을 과소평가한다.
//
// Chrome 또는 Edge 를 headless 로 띄워 index.html 의 엔진을 그대로 실행한다.
// 브라우저 경로는 환경변수 BROWSER 로 덮어쓸 수 있다.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { build, report, buildFile, reportFile,
        buildWrapped, cleanTexts, WRAPPERS, buildNbspLost } = require('./cases.js');

const THRESHOLD = 82;       // 붙여넣기 모드. 브라우저는 Node 보다 높게 나온다
const FILE_THRESHOLD = 74;  // 파일 모드 — filebench.js 와 같은 이유의 회귀 감지선
const WRAP_FLOOR = 50;      // 맥락 붙은 입력 — benchmark.js 와 같은 하한

const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const browser = CANDIDATES.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
if (!browser) {
  console.error('Chrome/Edge 를 찾지 못했습니다. BROWSER 환경변수로 실행 파일 경로를 지정하세요.');
  process.exit(1);
}

// 엔진 원본은 engine.js 다. 예전엔 index.html 에서 <script> 블록을 긁어냈는데,
// 다국어로 가면서 엔진이 별도 파일로 빠졌다 — 이제 그 파일을 그대로 읽어 쓴다.
// 브라우저에서는 전역 MojiEngine 으로 붙으므로 아래 벤치 코드가 그 이름으로 접근한다.
const js = fs.readFileSync(path.join(__dirname, '..', 'site', 'engine.js'), 'utf-8');

const cases = build();
const fileCases = buildFile();
const wrapped = buildWrapped();
const cleans = cleanTexts();
const nbspLost = buildNbspLost();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojibake-'));
const page = path.join(dir, 'bench.html');

fs.writeFileSync(page,
  '<!DOCTYPE html><meta charset="utf-8"><body><script>\n' + js +
  // engine.js 는 전역 MojiEngine 으로 붙는다. 아래 벤치 코드는 index.html 의 화면 코드와
  // 같은 방식으로 이름을 받아 쓴다 — 그래야 실제 페이지와 같은 경로를 재는 것이 된다.
  '\nconst { recover, recoverBytes, recoverLines, recoverSegments } = MojiEngine;\n' +
  '\nconst CASES=' + JSON.stringify(cases) + ';\n' +
  'const FILES=' + JSON.stringify(fileCases.map(c => c.bytes)) + ';\n' +
  'const WRAP=' + JSON.stringify(wrapped.map(w => ({ broken: w.broken, want: w.want }))) + ';\n' +
  'const CLEAN=' + JSON.stringify(cleans) + ';\n' +
  'const NBSP=' + JSON.stringify(nbspLost.map(c => ({ broken: c.broken, want: c.text }))) + ';\n' +
  'const t0=performance.now();\n' +
  'const OUT=CASES.map(c=>recover(c.broken).list.map(x=>x.text));\n' +
  'const t1=performance.now();\n' +
  'const FOUT=FILES.map(b=>recoverBytes(Uint8Array.from(b)).list.map(x=>x.text));\n' +
  // index.html 의 run() 과 같은 분기. 카드가 언제 뜨는지를 그대로 재현해야 의미가 있다.
  'function route(s){\n' +
  '  var r=recover(s);\n' +
  '  var lr=recoverLines(s);\n' +
  '  var wholeOk=r.list.length&&r.list[0].score>=r.base+10;\n' +
  '  var sg=(lr||wholeOk)?null:recoverSegments(s);\n' +
  '  return {rank:(r.list[0]||{}).text||null, card:lr?lr.text:(sg?sg.text:null)};\n' +
  '}\n' +
  // 0=실패  1=통짜로 맞힘  2=카드로 맞힘
  'const WOUT=WRAP.map(function(w){\n' +
  '  var r=route(w.broken);\n' +
  '  if(r.rank===w.want) return 1;\n' +
  '  return (r.card===w.want)?2:0;\n' +
  '});\n' +
  // 안 깨진 입력에서 카드가 뜨면 회귀다
  'const COUT=CLEAN.map(function(t){ return route(t).card; });\n' +
  // 통짜로 정답을 맞힌 케이스 위에 카드가 얹히면 회귀다
  'const OOUT=CASES.map(function(c){ var r=route(c.broken); return (r.rank===c.text&&r.card)?r.card:null; });\n' +
  // 붙여넣다가 NBSP 를 잃은 입력. 복원이 없으면 전부 실패한다.
  'const NOUT=NBSP.map(function(c){ var r=route(c.broken); return (r.rank===c.want||r.card===c.want)?1:0; });\n' +
  'document.body.textContent=JSON.stringify({ms:Math.round(t1-t0),' +
  'fms:Math.round(performance.now()-t1),out:OUT,fout:FOUT,wout:WOUT,cout:COUT,oout:OOUT,nout:NOUT});\n' +
  '<' + '/script></body>', 'utf-8');

let dom;
try {
  dom = execFileSync(browser,
    ['--headless', '--disable-gpu', '--no-sandbox', '--dump-dom', '--virtual-time-budget=60000',
     'file:///' + page.replace(/\\/g, '/')],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  console.error('브라우저 실행 실패:', e.message);
  process.exit(1);
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

const head = dom.indexOf('{"ms":');
const tail = dom.lastIndexOf('}');
if (head < 0 || tail <= head) {
  console.error('브라우저 결과를 파싱하지 못했습니다. 출력 앞부분:');
  console.error(dom.slice(0, 400));
  process.exit(1);
}
// dump-dom 은 텍스트 노드의 & < > 를 엔티티로 바꿔 내보낸다
const raw = dom.slice(head, tail + 1)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const res = JSON.parse(raw);

const name = path.basename(browser, '.exe');

const ok = report(cases.map((c, i) => [c, res.out[i]]),
  `${name} headless  (${res.ms}ms, 평균 ${(res.ms / cases.length).toFixed(1)}ms/건)`, THRESHOLD);

const fok = reportFile(fileCases.map((c, i) => [c, res.fout[i]]),
  `${name} headless 파일 모드  (${res.fms}ms, 평균 ${(res.fms / fileCases.length).toFixed(1)}ms/건)`, FILE_THRESHOLD);

/* ─────────── 맥락이 붙은 입력 ─────────── */
// benchmark.js 와 같은 두 방향을 브라우저 표로 다시 잰다.
const byWrap = {};
let wrapWhole = 0, wrapNow = 0;
wrapped.forEach((w, i) => {
  const W = byWrap[w.wrap] = byWrap[w.wrap] || { whole: 0, now: 0, total: 0 };
  W.total++;
  const v = res.wout[i];
  if (v >= 1) { wrapNow++; W.now++; }
  if (v === 1) { wrapWhole++; W.whole++; }
});

const segBad = res.cout.map((got, i) => [cleans[i], got]).filter(x => x[1] !== null);
const overBad = res.oout.map((got, i) => [cases[i], got]).filter(x => x[1] !== null);

console.log(`\n══ ${name} headless 맥락이 붙은 입력 ══`);
console.log(`유효 케이스 ${wrapped.length}개  (${cases.length}건 × 래퍼 ${WRAPPERS.length}종)`);
for (const [wrap, v] of Object.entries(byWrap)) {
  console.log(`  ${wrap.padEnd(16)} 통짜 ${String((v.whole / v.total * 100).toFixed(0) + '%').padStart(4)}  →  구간 복구까지 ${String((v.now / v.total * 100).toFixed(0) + '%').padStart(4)}`);
}
const wrapRate = wrapNow / wrapped.length * 100;
console.log(`  ${'전체'.padEnd(16)} 통짜 ${(wrapWhole / wrapped.length * 100).toFixed(1)}%  →  구간 복구까지 ${wrapRate.toFixed(1)}%`);
console.log(`정상 문장·문단 ${cleans.length}건에서 줄별·구간 카드 ${segBad.length}건 (0이어야 정상)`);
segBad.slice(0, 5).forEach(([t, got]) => console.log(`  ${JSON.stringify(t.slice(0, 24))} → ${JSON.stringify(got.slice(0, 24))}`));
console.log(`통짜로 맞힌 케이스 위에 카드 ${overBad.length}건 (0이어야 정상)`);
overBad.slice(0, 5).forEach(([c, got]) => console.log(`  ${c.name} ${c.actual}→${c.misread} : ${JSON.stringify(got.slice(0, 24))}`));

let wok = true;
if (segBad.length > 0) {
  console.log(`\n[FAIL] 안 깨진 입력에서 카드가 ${segBad.length}건 떴다. 잘 되던 입력을 건드리고 있다.`);
  wok = false;
} else if (overBad.length > 0) {
  console.log(`\n[FAIL] 통짜로 정답을 맞힌 입력 ${overBad.length}건 위에 카드가 얹혔다. 정답 위에 오답을 띄우고 있다.`);
  wok = false;
} else if (wrapRate < WRAP_FLOOR) {
  console.log(`\n[FAIL] 맥락 붙은 입력 정답률 ${wrapRate.toFixed(1)}% — 하한 ${WRAP_FLOOR}% 미달.`);
  wok = false;
} else {
  console.log(`\n[PASS] 무간섭(정상·통짜) + 맥락 하한 ${WRAP_FLOOR}% 통과`);
}

/* ─────────── 붙여넣다가 NBSP 를 잃은 입력 ─────────── */
const NBSP_FLOOR = 80;   // benchmark.js 와 같은 하한
const nbspOk = res.nout.reduce((a, v) => a + v, 0);
const nbspRate = nbspLost.length ? nbspOk / nbspLost.length * 100 : 100;

console.log(`\n══ ${name} headless NBSP 소실 ══`);
console.log(`유효 케이스 ${nbspLost.length}개`);
console.log(`1순위 정답  ${nbspOk}  (${nbspRate.toFixed(1)}%)   [복원 없이는 0%]`);
res.nout.forEach((v, i) => {
  if (!v) console.log(`  ${nbspLost[i].name.padEnd(9)} ${nbspLost[i].actual}→${nbspLost[i].misread}`);
});

let nok = true;
if (nbspRate < NBSP_FLOOR) {
  console.log(`\n[FAIL] NBSP 소실 정답률 ${nbspRate.toFixed(1)}% — 하한 ${NBSP_FLOOR}% 미달.`);
  nok = false;
} else {
  console.log(`\n[PASS] NBSP 복원 하한 ${NBSP_FLOOR}% 통과`);
}

if (!ok || !fok || !wok || !nok) process.exit(1);
