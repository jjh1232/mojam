// 사이트 벤치마크(test/benchmark.js)가 엔진을 검사한다. 여기는 감싸는 층만 본다.
const assert = require('assert');
const m = require('./');

const cases = [
  ['ì•ˆë…•í•˜ì„¸ìš”', '안녕하세요', 'whole'],             // UTF-8 → CP1252
  ['¾È³çÇÏ¼¼¿ä', '안녕하세요', 'whole'],                   // EUC-KR → CP1252
  ['ë³´ê³ ì„œ_ìµœì¢….xlsx', '보고서_최종.xlsx', 'whole'],
  ['dÃ©jÃ  vu', 'déjà vu', 'whole'],
  ['제목: ¿À´Ã È¸ÀÇ´Â ¿ÀÈÄ 3½Ã', '제목: 오늘 회의는 오후 3시', 'segments'],
  ['그냥 정상 문장', '그냥 정상 문장', 'none'],               // 안 깨진 글은 그대로
  ['Grüße über Straße', 'Grüße über Straße', 'none'],
  ['', '', 'none'],
];
for (const [inp, want, mode] of cases) {
  const a = m.analyze(inp);
  assert.strictEqual(a.text, want, JSON.stringify(inp));
  assert.strictEqual(a.mode, mode, JSON.stringify(inp) + ' mode');
  assert.strictEqual(m.fix(inp), want);
}

// EUC-KR 파일 바이트 (이름,나이\n홍길동,30)
const euckr = Uint8Array.from([0xC0,0xCC,0xB8,0xA7,0x2C,0xB3,0xAA,0xC0,0xCC,0x0A,0xC8,0xAB,0xB1,0xE6,0xB5,0xBF,0x2C,0x33,0x30]);
const d = m.decode(euckr);
assert.strictEqual(d.text, '이름,나이\n홍길동,30');
assert.strictEqual(d.encoding, 'euc-kr');
assert.strictEqual(m.decode(new TextEncoder().encode('ok')).certain, true);

// ZIP: 파일명 EUC-KR(보고서.txt), bit 11 없음, 무압축
function zip(nameBytes) {
  const data = [0x68, 0x69];
  const le = (n, w) => Array.from({ length: w }, (_, i) => (n >>> (8 * i)) & 255);
  let c = ~0; for (const x of data) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  const crc = ~c >>> 0, n = nameBytes.length;
  const local = [...le(0x04034b50,4), ...le(20,2), 0,0, 0,0, 0,0,0,0, ...le(crc,4), ...le(2,4), ...le(2,4), ...le(n,2), 0,0, ...nameBytes, ...data];
  const cd = [...le(0x02014b50,4), ...le(20,2), ...le(20,2), 0,0, 0,0, 0,0,0,0, ...le(crc,4), ...le(2,4), ...le(2,4), ...le(n,2), 0,0, 0,0, 0,0, 0,0, 0,0,0,0, ...le(0,4), ...nameBytes];
  const eocd = [...le(0x06054b50,4), 0,0, 0,0, ...le(1,2), ...le(1,2), ...le(cd.length,4), ...le(local.length,4), 0,0];
  return Uint8Array.from([...local, ...cd, ...eocd]);
}
const z = m.fixZipNames(zip([0xBA,0xB8,0xB0,0xED,0xBC,0xAD,0x2E,0x74,0x78,0x74]));
assert.deepStrictEqual(z.names, ['보고서.txt']);
assert.strictEqual(z.changed, true);
assert.strictEqual(m.fixZipNames(z.zip).changed, false);   // 고친 결과는 다시 고칠 게 없다

console.log('ok');
