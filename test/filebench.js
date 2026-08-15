// 파일(바이트) 모드 회귀 테스트 (Node)
// 사용법:  node test/filebench.js
//
// ⚠ benchmark.js 와 같은 주의 — Node(ICU) 와 브라우저(WHATWG index) 의 TextDecoder 표가
//    다르므로 이건 빠른 게이트일 뿐이다. 실사용 값은 `npm run bench:browser` 쪽이다.
//
// 붙여넣기 모드와 정답 조건이 다르다: 인코딩 이름이 아니라 디코딩 결과 문자열로 판정한다.
// cases.js 의 buildFile() 참고.

const iconv = require('iconv-lite');
const E = require('../site/engine.js');
const { buildFile, reportFile } = require('./cases.js');

const THRESHOLD = 74;  // 1순위 정답률 하한 (%) — 목표치가 아니라 회귀 감지선

/* ─────────── 인코딩 판별 ─────────── */
const cases = buildFile();
const t0 = Date.now();
const rows = cases.map(c => [c, E.recoverBytes(Uint8Array.from(c.bytes)).list.map(r => r.text)]);
const ms = Date.now() - t0;

let ok = reportFile(rows, `Node ${process.version} 파일 모드  (${ms}ms, 평균 ${(ms / cases.length).toFixed(1)}ms/건)`, THRESHOLD);

/* ─────────── BOM / ASCII 처리 ─────────── */
// BOM 이 있거나 0x80 이상이 없으면 인코딩 불일치가 성립할 수 없다.
// 후보 경쟁을 돌리지 않고 그 사실을 알려주는 경로가 살아 있는지 확인한다.
const guards = [
  ['UTF-8 BOM',  Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('안녕하세요', 'utf-8')]), r => r.bom === 'utf-8' && r.list[0].text === '안녕하세요'],
  ['UTF-16LE BOM', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('안녕하세요', 'utf16le')]),   r => r.bom === 'utf-16le' && r.list[0].text === '안녕하세요'],
  ['순수 ASCII',  Buffer.from('name,qty\nwidget,3\n', 'ascii'),                                        r => r.ascii === true && r.list[0].text === 'name,qty\nwidget,3\n'],
  ['PNG 이진',    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0xFF, 0xD8]), r => r.binary === true && r.list.length === 0],
  ['제어문자 다발', Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0xE0, 0xE1, 0xE2]),           r => r.binary === true],

  // 파일은 멀쩡한데 안에 담긴 글자가 이미 깨진 경우.
  // 깨진 글자를 복사해 메모장에 저장하면 이렇게 되므로 실사용에서 가장 흔한 경로다.
  // 유효 UTF-8 을 확정하지 않으면 gbk 로 넘어가 한자 쓰레기가 나온다.
  ['내용 깨짐 (euc-kr→latin1)',
   Buffer.from(iconv.decode(iconv.encode('안녕하세요 반갑습니다', 'euc-kr'), 'latin1'), 'utf-8'),
   r => r.certain === true && r.list[0].actual === 'utf-8' &&
        r.content && r.content[0].text === '안녕하세요 반갑습니다'],
  ['내용 깨짐 (utf-8→cp1252)',
   Buffer.from(iconv.decode(iconv.encode('Grüße über die Straße', 'utf-8'), 'windows-1252'), 'utf-8'),
   r => r.content && r.content[0].text === 'Grüße über die Straße'],

  // 오탐 회귀 감지 — 멀쩡한 UTF-8 파일에 체인이 걸리면 안 된다
  ['정상 UTF-8 한국어', Buffer.from('오늘 회의는 오후 3시에 시작합니다. 자료는 미리 확인해 주세요.', 'utf-8'),
   r => r.certain === true && r.content === null],
  ['정상 UTF-8 CSV',   Buffer.from(['이름,수량', '보고서,3', '최종본,12', ''].join('\n'), 'utf-8'),
   r => r.certain === true && r.content === null],
  ['정상 UTF-8 일본어', Buffer.from('本日の会議は午後3時から開始します', 'utf-8'),
   r => r.content === null],
];

console.log('\n══ 파일 가드 (BOM · 이진 · ASCII · 내용 깨짐) ══');
for (const [label, buf, check] of guards) {
  const r = E.recoverBytes(Uint8Array.from(buf));
  const pass = check(r);
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${label}`);
  if (!pass) { console.log(`       ${JSON.stringify(r).slice(0, 160)}`); ok = false; }
}

/* ─────────── ZIP 파일명 ─────────── */
// CP949 파일명을 가진 최소 ZIP(무압축)을 만들어 판별 → 재작성 → 재파싱까지 검증한다.
const CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return b => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function makeZip(names, enc) {
  const local = [], central = [];
  let off = 0;
  for (const name of names) {
    const nb = iconv.encode(name, enc);
    const data = Buffer.from(`contents of ${name}\n`, 'utf-8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034B50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(CRC(data), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, nb, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014B50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(CRC(data), 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nb.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt32LE(off, 42);
    central.push(cd, nb);
    off += lh.length + nb.length + data.length;
  }
  const body = Buffer.concat(local);
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);
  eocd.writeUInt16LE(names.length, 8); eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(dir.length, 12); eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, dir, eocd]);
}

const ZIP_NAMES = ['보고서_최종.xlsx', '사진/여름휴가.jpg', '읽어주세요.txt'];
console.log('\n══ ZIP 파일명 복구 ══');

const zip = Uint8Array.from(makeZip(ZIP_NAMES, 'cp949'));
const insp = E.zipInspect(zip);

if (insp.error) {
  console.log(`  FAIL 파싱: ${insp.error}`); ok = false;
} else if (insp.ok) {
  console.log('  FAIL 깨진 파일명을 정상으로 판정했습니다'); ok = false;
} else {
  const hit = insp.cands.findIndex(c => ZIP_NAMES.every((n, i) => c.names[i] === n));
  console.log(`  ${hit === 0 ? 'OK  ' : 'FAIL'} 판별 — 1순위 ${insp.cands[0].actual}: ${JSON.stringify(insp.cands[0].names)}`);
  if (hit !== 0) ok = false;

  const rb = E.zipRebuild(zip, insp.entries, insp.cands[0].names);
  if (rb.error) {
    console.log(`  FAIL 재작성: ${rb.error}`); ok = false;
  } else {
    const again = E.zipInspect(rb.bytes);
    const fixed = !again.error && again.ok &&
                  ZIP_NAMES.every((n, i) => again.cands[0].names[i] === n);
    console.log(`  ${fixed ? 'OK  ' : 'FAIL'} 재작성본이 UTF-8 플래그로 다시 읽힘`);
    if (!fixed) { console.log(`       ${JSON.stringify(again).slice(0, 200)}`); ok = false; }

    // 이미 UTF-8 인 아카이브는 손대지 않아야 한다
    const clean = E.zipInspect(Uint8Array.from(makeZip(['plain.txt'], 'utf-8')));
    console.log(`  ${clean.ok ? 'OK  ' : 'FAIL'} ASCII 파일명 아카이브는 정상 판정`);
    if (!clean.ok) ok = false;
  }
}

if (!ok) process.exit(1);
