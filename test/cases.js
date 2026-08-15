// 벤치마크 케이스 정의. benchmark.js(Node) 와 browser.js(Chrome) 가 공유한다.
//
// 인코딩 라벨은 iconv-lite 기준으로 통일한다.
// TextDecoder 를 섞어 쓰면 안 된다 — WHATWG 표준에서 'latin1' 은 windows-1252 의
// 별칭이라 ISO-8859-1 이 아니다. 왕복 검사(iconv.encode)와 의미가 어긋나면
// 해당 케이스가 조용히 전부 탈락한다.

const iconv = require('iconv-lite');

const SAMPLES = {
  ko_short: '안녕',
  ko_mid:   '안녕하세요',
  ko_long:  '오늘 회의는 오후 3시에 시작합니다. 자료는 미리 확인해 주세요.',
  ko_mixed: '파일명: 보고서_최종.xlsx (2024년 3월)',
  ja_mid:   'こんにちは',
  ja_long:  '本日の会議は午後3時から開始します。資料を事前にご確認ください。',
  ja_mixed: '会議室A-301 15:00開始 (資料3枚)',
  zh_mid:   '你好世界',
  zh_long:  '今天的会议将于下午三点开始，请提前查阅资料。',
  zh_mixed: '文件名: 报告_2024年3月.xlsx (共5页)',
  ru_mid:   'Привет',
  ru_long:  'Сегодняшнее совещание начнётся в три часа дня.',
  de_mid:   'Grüße über Straße',
  fr_mid:   'déjà vu à côté',
  th_mid:   'สวัสดีครับ',
  vi_mid:   'Xin chào bạn',
  he_mid:   'שלום עולם',
  ar_mid:   'مرحبا بالعالم',
  el_mid:   'Καλημέρα κόσμε',
  pl_mid:   'Zażółć gęślą jaźń',
};

// [저장한 인코딩, 잘못 읽은 인코딩]
//
// latin1 = 진짜 ISO-8859-1 (바이트를 그대로 U+0000~U+00FF 로 읽음).
// 엔진의 latin1-raw 후보에 대응하며, 한국에서 "뷁체"라 부르는 깨짐의 정본이다.
// windows-1252 와 별개 케이스이므로 둘 다 유지할 것.
const CASES = [
  ['utf-8', 'windows-1252'],  ['utf-8', 'latin1'],
  ['utf-8', 'euc-kr'],        ['utf-8', 'shift_jis'],
  ['utf-8', 'gbk'],           ['utf-8', 'koi8-r'],
  ['utf-8', 'windows-1251'],  ['euc-kr', 'utf-8'],
  ['shift_jis', 'windows-1252'], ['gbk', 'windows-1252'],
  ['windows-1251', 'utf-8'],  ['windows-1251', 'koi8-r'],
  ['windows-874', 'windows-1252'],  ['windows-1258', 'windows-1252'],
  ['iso-8859-8', 'windows-1252'],   ['windows-1256', 'windows-1252'],
  ['iso-8859-7', 'windows-1252'],   ['windows-1250', 'windows-1252'],
  // 멀티바이트 → latin1 오독. 실사용 빈도가 가장 높은 구간인데 이전엔 0건이었다.
  ['euc-kr', 'latin1'],       ['shift_jis', 'latin1'],
  ['gbk', 'latin1'],          ['big5', 'latin1'],
  ['windows-1251', 'latin1'],
  ['euc-kr', 'windows-1252'], ['big5', 'windows-1252'],
];

/**
 * 실제 깨짐 상황을 재현한다.
 * actual 인코딩으로 저장한 바이트를 misread 인코딩으로 잘못 읽은 결과를 반환.
 * 이론상 복구 불가능한 케이스는 null 을 반환해 테스트에서 제외한다.
 */
function mojibake(text, actual, misread) {
  let buf;
  try { buf = iconv.encode(text, actual); } catch (e) { return null; }

  // 저장 단계에서 이미 바이트가 소실된 경우 (예: 한글을 shift_jis로 저장)
  let back;
  try { back = iconv.decode(buf, actual); } catch (e) { return null; }
  if (back !== text) return null;

  let broken;
  try { broken = iconv.decode(buf, misread); } catch (e) { return null; }
  if (broken === text || broken.includes('�')) return null;

  // 되돌릴 수 있는지 확인 — 재인코딩해서 원 바이트가 안 나오면 복구 불가
  let rb;
  try { rb = iconv.encode(broken, misread); } catch (e) { return null; }
  if (Buffer.compare(rb, buf) !== 0) return null;

  return broken;
}

/** 유효 케이스 전체를 { name, lang, actual, misread, text, broken } 배열로 반환 */
function build() {
  const out = [];
  for (const [name, text] of Object.entries(SAMPLES)) {
    for (const [actual, misread] of CASES) {
      const broken = mojibake(text, actual, misread);
      if (broken !== null) {
        out.push({ name, lang: name.split('_')[0], actual, misread, text, broken });
      }
    }
  }
  return out;
}

/** 결과 배열([{ case, results }])을 집계해 표로 출력한다. 두 러너가 공유. */
function report(rows, label, threshold) {
  let pass = 0, top3 = 0;
  const byLang = {}, byPair = {}, failures = [];

  for (const [c, results] of rows) {
    const L = byLang[c.lang] = byLang[c.lang] || { pass: 0, total: 0 };
    const key = `${c.actual}→${c.misread}`;
    const P = byPair[key] = byPair[key] || { pass: 0, total: 0 };
    L.total++; P.total++;

    if (results[0] === c.text) {
      pass++; top3++; L.pass++; P.pass++;
    } else if (results.includes(c.text)) {
      top3++;
      failures.push(`  ${c.name.padEnd(9)} ${key}  2·3순위로 밀림`);
    } else {
      failures.push(`  ${c.name.padEnd(9)} ${key}  실패: ${JSON.stringify((results[0] || '없음').slice(0, 30))}`);
    }
  }

  const total = rows.length;
  const rate1 = pass / total * 100;
  console.log(`\n══ ${label} ══`);
  console.log(`유효 케이스 ${total}개`);
  console.log(`1순위 정답  ${pass}  (${rate1.toFixed(1)}%)`);
  console.log(`후보 3개 내 ${top3}  (${(top3 / total * 100).toFixed(1)}%)`);

  console.log('\n언어별 1순위 정답률');
  for (const [lang, v] of Object.entries(byLang)) {
    const bar = '#'.repeat(Math.round(v.pass / v.total * 10)).padEnd(10, '.');
    console.log(`  ${lang.padEnd(3)} ${bar} ${String(v.pass).padStart(2)}/${v.total}  ${(v.pass / v.total * 100).toFixed(0)}%`);
  }

  console.log('\n깨짐 쌍별 커버리지  (저장한 인코딩 → 잘못 읽은 인코딩)');
  const sampleN = Object.keys(SAMPLES).length;
  for (const [actual, misread] of CASES) {
    const key = `${actual}→${misread}`;
    const v = byPair[key];
    if (!v) {
      console.log(`  ${key.padEnd(30)}  0/${sampleN}  (이론상 복구 불가 — 저장·오독 단계에서 바이트 소실)`);
      continue;
    }
    console.log(`  ${key.padEnd(30)} ${String(v.pass).padStart(2)}/${String(v.total).padEnd(2)} 유효 ${String(v.total).padStart(2)}/${sampleN}  ${(v.pass / v.total * 100).toFixed(0)}%`);
  }

  if (failures.length) {
    console.log('\n틀린 케이스');
    failures.forEach(f => console.log(f));
  }

  if (rate1 < threshold) {
    console.log(`\n[FAIL] 1순위 정답률 ${rate1.toFixed(1)}% — 하한 ${threshold}% 미달. 커밋하지 말 것.`);
    return false;
  }
  console.log(`\n[PASS] 하한 ${threshold}% 통과`);
  return true;
}

/* ─────────── 파일(바이트) 모드 ─────────── */
// 붙여넣기 모드와 달리 깨짐을 시뮬레이션할 필요가 없다. 파일은 원본 바이트 그 자체이므로
// iconv.encode(원문, enc) 가 곧 입력이고, 엔진이 할 일은 enc 를 알아맞히는 것이다.
//
// 정답 조건도 다르다 — 인코딩 "이름"이 아니라 디코딩 결과 문자열이 원문과 같은지로 본다.
// 같은 바이트를 호환 인코딩(예: gbk/gb18030)으로 읽어 같은 글자가 나오면 정답이다.
const FILE_ENCODINGS = [
  'utf-8', 'euc-kr', 'shift_jis', 'euc-jp', 'gbk', 'big5',
  'windows-1250', 'windows-1251', 'windows-1252', 'windows-1253',
  'windows-1254', 'windows-1255', 'windows-1256', 'windows-1257',
  'koi8-r', 'iso-8859-2', 'iso-8859-7', 'iso-8859-8', 'windows-874',
];

/** 파일 케이스 전체를 { name, lang, actual, text, bytes } 배열로 반환 */
function buildFile() {
  const out = [];
  for (const [name, text] of Object.entries(SAMPLES)) {
    for (const enc of FILE_ENCODINGS) {
      let buf;
      try { buf = iconv.encode(text, enc); } catch (e) { continue; }
      // 저장 단계에서 표현 불가능했던 조합은 제외 (예: 한글을 shift_jis 로)
      let back;
      try { back = iconv.decode(buf, enc); } catch (e) { continue; }
      if (back !== text) continue;
      out.push({ name, lang: name.split('_')[0], actual: enc, text, bytes: Array.from(buf) });
    }
  }
  return out;
}

/** 파일 모드 결과([{ case, results }])를 집계해 표로 출력한다. Node·브라우저 러너가 공유. */
function reportFile(rows, label, threshold) {
  let pass = 0, top3 = 0;
  const byLang = {}, byEnc = {}, failures = [];

  for (const [c, results] of rows) {
    const L = byLang[c.lang] = byLang[c.lang] || { pass: 0, total: 0 };
    const E = byEnc[c.actual] = byEnc[c.actual] || { pass: 0, total: 0 };
    L.total++; E.total++;

    if (results[0] === c.text) {
      pass++; top3++; L.pass++; E.pass++;
    } else if (results.includes(c.text)) {
      top3++;
      failures.push(`  ${c.name.padEnd(9)} ${c.actual.padEnd(13)} 2·3순위로 밀림`);
    } else {
      failures.push(`  ${c.name.padEnd(9)} ${c.actual.padEnd(13)} 실패: ${JSON.stringify((results[0] || '없음').slice(0, 24))}`);
    }
  }

  const total = rows.length;
  const rate1 = pass / total * 100;
  console.log(`\n══ ${label} ══`);
  console.log(`유효 케이스 ${total}개`);
  console.log(`1순위 정답  ${pass}  (${rate1.toFixed(1)}%)`);
  console.log(`후보 3개 내 ${top3}  (${(top3 / total * 100).toFixed(1)}%)`);

  console.log('\n언어별 1순위 정답률');
  for (const [lang, v] of Object.entries(byLang)) {
    const bar = '#'.repeat(Math.round(v.pass / v.total * 10)).padEnd(10, '.');
    console.log(`  ${lang.padEnd(3)} ${bar} ${String(v.pass).padStart(2)}/${v.total}  ${(v.pass / v.total * 100).toFixed(0)}%`);
  }

  console.log('\n저장 인코딩별 커버리지');
  for (const enc of FILE_ENCODINGS) {
    const v = byEnc[enc];
    if (!v) { console.log(`  ${enc.padEnd(16)}  0건 (표현 가능한 샘플 없음)`); continue; }
    console.log(`  ${enc.padEnd(16)} ${String(v.pass).padStart(2)}/${String(v.total).padEnd(2)}  ${(v.pass / v.total * 100).toFixed(0)}%`);
  }

  if (failures.length) {
    console.log('\n틀린 케이스');
    failures.forEach(f => console.log(f));
  }

  if (rate1 < threshold) {
    console.log(`\n[FAIL] 1순위 정답률 ${rate1.toFixed(1)}% — 하한 ${threshold}% 미달. 커밋하지 말 것.`);
    return false;
  }
  console.log(`\n[PASS] 하한 ${threshold}% 통과`);
  return true;
}

/* ─────────── 여러 줄 입력 ─────────── */
// 복구는 "어떻게 잘못 읽혔는지" 를 하나 가정하고 되감는다. 그래서 줄마다 가정이 다르면
// 통짜로는 못 푼다. recoverLines() 가 그 경우만 골라내는지 두 방향으로 잰다.
//
//   문단  = 한 언어 · 한 깨짐 유형의 여러 줄. 지금 잘 되는 경우다 — 여기서 발동하면 안 된다.
//   섞임  = 서로 다른 깨짐 유형이 섞인 여러 줄. 통짜로는 거의 못 푸는 경우다.

const PARAGRAPHS = {
  ko: ['오늘 회의는 오후 3시에 시작합니다', '자료는 미리 확인해 주세요', '늦지 않게 참석 부탁드립니다'],
  ja: ['本日の会議は午後3時から開始します', '資料を事前にご確認ください', '遅れないようにお願いします'],
  ru: ['Сегодняшнее совещание начнётся в три часа', 'Пожалуйста, ознакомьтесь с материалами', 'Просим не опаздывать'],
  de: ['Die Besprechung beginnt um drei Uhr', 'Bitte prüfen Sie die Unterlagen vorher', 'Grüße und bis später'],
};

/** 한 언어·한 유형 문단 → [{ lang, pair, broken:[], text:string }] */
function buildParagraphs() {
  const out = [];
  for (const [lang, lines] of Object.entries(PARAGRAPHS)) {
    for (const [actual, misread] of CASES) {
      const bs = lines.map(l => mojibake(l, actual, misread));
      if (bs.some(b => b === null)) continue;
      out.push({ lang, pair: `${actual}→${misread}`, broken: bs.join('\n'), text: lines.join('\n') });
    }
  }
  return out;
}

/** 서로 다른 깨짐 유형이 섞인 여러 줄. 재현 가능하도록 난수를 고정한다. */
function buildMixed(limit) {
  const cases = build();
  const byPair = {};
  for (const c of cases) (byPair[`${c.actual}→${c.misread}`] ||= []).push(c);
  const pairs = Object.keys(byPair).filter(k => byPair[k].length >= 2);

  let rng = 20260811;
  const rand = n => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) % n;

  const out = [];
  for (let i = 0; i < (limit || 240); i++) {
    const k = 2 + rand(2), used = new Set(), ls = [];
    for (let j = 0; j < k; j++) {
      const p = pairs[rand(pairs.length)];
      used.add(p);
      ls.push(byPair[p][rand(byPair[p].length)]);
    }
    if (used.size < 2) continue;   // 유형이 하나뿐이면 "섞임" 이 아니다
    out.push({ broken: ls.map(c => c.broken).join('\n'), text: ls.map(c => c.text).join('\n') });
  }
  return out;
}

/* ─────────── 맥락이 붙은 입력 (정상 글자 + 깨진 글자가 한 줄에) ─────────── */
// 실사용자는 깨진 글자만 딱 떼어서 가져오지 않는다. "제목: <깨짐> 입니다" 처럼 정상
// 글자와 섞어서 가져온다. 그 순간 encodeWith 가 되돌릴 수 없는 문자를 만나 가설을
// 통째로 버리므로 통짜 복구는 후보 0개가 된다 — 실측 82.4% → 0% (후보 0개가 98%).
//
// ASCII 라벨만 통짜로도 살아남는데, 그게 원인을 그대로 말해준다. latin1-raw 가 ASCII 는
// 표현할 수 있기 때문이다. recoverSegments() 가 이 구간을 담당한다.
const WRAPPERS = [
  ['앞에 한글 라벨',  b => '제목: ' + b + ' 입니다'],
  ['뒤에 한글',       b => b + ' 확인바람'],
  ['파일명',          b => b + '_보고서.xlsx'],
  ['뒤에 이모지',     b => b + ' 🙂'],
  ['앞에 ASCII 라벨', b => 'name: ' + b],
];

/** 유효 케이스마다 위 래퍼를 씌운 배열. want 는 래퍼까지 포함한 정답 전체 문자열이다. */
function buildWrapped() {
  const out = [];
  for (const c of build()) {
    for (const [wrap, f] of WRAPPERS) {
      out.push({ name: c.name, lang: c.lang, actual: c.actual, misread: c.misread,
                 wrap, broken: f(c.broken), want: f(c.text) });
    }
  }
  return out;
}

/* ─────────── 붙여넣다가 NBSP 를 잃은 입력 ─────────── */
// 「제목」(U+C820) 처럼 UTF-8 바이트에 0xA0 이 들어가는 글자는 latin1 계열로 잘못 읽히면
// 깨진 문자열 안에 NBSP(U+00A0) 를 남긴다. 그런데 메신저·HTML·웹 입력창·엑셀이 NBSP 를
// 일반 공백으로 조용히 바꾼다 — 사용자는 자기 입력이 손상됐다는 걸 알 방법이 없다.
//
// 148건 중 20건(14%)에 NBSP 가 들어 있고, 고치기 전에는 그 20건이 **전부** 실패했다.
// 언어 편중도 없다 (ko 4 · ja 4 · zh 4 · fr 3 · vi 3 · th 1 · el 1).
const NBSP = '\u00A0';   // 리터럴로 쓰면 소스에서 안 보인다

/** 깨진 결과의 NBSP 를 일반 공백으로 바꾼 변형. 메신저·HTML 을 거친 입력을 재현한다. */
function buildNbspLost() {
  const out = [];
  for (const c of build()) {
    if (c.broken.indexOf(NBSP) < 0) continue;
    out.push({ name: c.name, lang: c.lang, actual: c.actual, misread: c.misread,
               text: c.text, broken: c.broken.split(NBSP).join(' ') });
  }
  return out;
}

/** 정상 문장 모음. 구간 복구가 여기서 발동하면 잘 되던 입력을 건드리고 있다는 뜻이다. */
function cleanTexts() {
  const out = Object.values(SAMPLES).slice();
  for (const lines of Object.values(PARAGRAPHS)) out.push(lines.join('\n'));
  return out;
}

module.exports = { SAMPLES, CASES, mojibake, build, report,
                   FILE_ENCODINGS, buildFile, reportFile,
                   PARAGRAPHS, buildParagraphs, buildMixed,
                   NBSP, buildNbspLost,
                   WRAPPERS, buildWrapped, cleanTexts };
