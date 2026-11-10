'use strict';
/* mojibake-fix — 엔진(engine.js)을 감싸는 얇은 층.
 *
 * engine.js 는 이 폴더의 원본이 아니다. 원본은 ../site/engine.js 이고, `npm pack`/`publish`
 * 직전에 prepack 스크립트가 복사해 온다. 여기서 엔진을 고치지 말 것.
 *
 * 판단 순서(통짜 → 줄 → 구간)는 사이트 화면(site/ui.js run())과 같다. 거기가 바뀌면 여기도.
 */
const E = require('./engine.js');

const WHOLE_GAIN = 10; // ui.js 의 wholeOk 와 같은 값

function analyze(text) {
  if (typeof text !== 'string') throw new TypeError('mojibake-fix: text must be a string');
  if (!text.trim()) return { text, changed: false, mode: 'none', candidates: [] };

  const { base, list } = E.recover(text);
  const lines = E.recoverLines(text);
  const wholeOk = list.length > 0 && list[0].score >= base + WHOLE_GAIN;
  const segs = (lines || wholeOk) ? null : E.recoverSegments(text);
  const confs = E.confidences(list);
  const candidates = list.map((c, i) => ({
    text: c.text,
    confidence: confs[i] / 100,
    chain: c.chain.map(x => ({ misreadAs: x.m === 'latin1-raw' ? 'latin1' : x.m, actual: x.a })),
  }));

  let out = text, mode = 'none';
  if (lines) { out = lines.text; mode = 'lines'; }
  else if (wholeOk) { out = list[0].text; mode = 'whole'; }
  else if (segs) { out = segs.text; mode = 'segments'; }
  return { text: out, changed: out !== text, mode, candidates };
}

function fix(text) {
  return analyze(text).text;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError('mojibake-fix: expected Uint8Array, Buffer or ArrayBuffer');
}

// 파일 바이트 → 올바른 문자열. 붙여넣기보다 정확하다(원본 바이트를 그대로 갖고 있으므로).
function decode(input) {
  const bytes = toBytes(input);
  const r = E.recoverBytes(bytes);
  if (r.binary) return { text: null, encoding: null, certain: false, binary: true };
  if (!r.list.length) return { text: null, encoding: null, certain: false, binary: false };
  const top = r.list[0];
  // 파일은 멀쩡한데 안의 글자가 이미 깨져 있던 경우까지 본다 (ui.js renderTextFile 과 같은 순서)
  const lr = E.recoverLines(top.text) || (r.content ? null : E.recoverSegments(top.text));
  const text = lr ? lr.text : (r.content ? r.content[0].text : top.text);
  return { text, encoding: top.actual, certain: !!r.certain, binary: false };
}

// ZIP 안의 깨진 파일명을 UTF-8 로 다시 쓴다. 압축 데이터는 건드리지 않는다.
function fixZipNames(input) {
  const bytes = toBytes(input);
  if (!E.isZip(bytes)) throw new Error('mojibake-fix: not a ZIP file');
  const z = E.zipInspect(bytes);
  if (z.error) throw new Error('mojibake-fix: ' + z.error);
  const c = z.cands[0];
  if (z.ok) return { zip: bytes, names: c.names, encoding: c.actual, changed: false };
  const rb = E.zipRebuild(bytes, z.entries, c.names);
  if (rb.error) throw new Error('mojibake-fix: ' + rb.error);
  return { zip: rb.bytes, names: c.names, encoding: c.actual, changed: true };
}

module.exports = { fix, analyze, decode, fixZipNames, engine: E };
