# mojibake-fix

Repair **mojibake**: text that was saved in one encoding and read in another.

```
ì•ˆë…•í•˜ì„¸ìš”        →  안녕하세요
¾È³çÇÏ¼¼¿ä            →  안녕하세요
ë³´ê³ ì„œ_ìµœì¢….xlsx  →  보고서_최종.xlsx
dÃ©jÃ  vu             →  déjà vu
제목: ¿À´Ã È¸ÀÇ´Â 3½Ã   →  제목: 오늘 회의는 3시   (only the broken part is replaced)
```

**Try it in the browser, no install:** [prelaps.com/mojibake](https://prelaps.com/mojibake/en/) ([한국어](https://prelaps.com/mojibake/) · [日本語](https://prelaps.com/mojibake/ja/)). This package uses the same engine as that site.

- Zero dependencies. Uses the built-in `TextDecoder`.
- Handles UTF-8 / EUC-KR (CP949) / Shift_JIS / EUC-JP / GBK / Big5 / Cyrillic and other legacy code pages, misread as Latin-1, Windows-1252, EUC-KR, Shift_JIS and others.
- Double encoding (broken twice), inputs where each line broke differently, and normal text mixed with broken text.
- Leaves text alone if it doesn't look broken.
- Raw file bytes: detects the encoding and returns UTF-8 (e.g. a CSV that Excel saved as CP949).
- ZIP: rewrites Korean, Japanese or Chinese filenames that show up garbled after unzipping on another OS. The compressed data is not touched.

## Install

```sh
npm install mojibake-fix
```

## Usage

```js
const { fix, analyze, decode, fixZipNames } = require('mojibake-fix');

fix('ì•ˆë…•í•˜ì„¸ìš”');          // '안녕하세요'
fix('Grüße über Straße');        // unchanged

analyze('¾È³çÇÏ¼¼¿ä');
// { text: '안녕하세요', changed: true, mode: 'whole',
//   candidates: [
//     { text: '안녕하세요', confidence: 0.99, chain: [{ misreadAs: 'latin1', actual: 'euc-kr' }] },
//     { text: '照括馬室推', confidence: 0.99, chain: [{ misreadAs: 'latin1', actual: 'euc-jp' }] },
//     { text: '救崇窍技夸', confidence: 0.99, chain: [{ misreadAs: 'latin1', actual: 'gbk' }] } ] }
//
// Short CJK inputs can be read as Korean, Japanese or Chinese equally well, so the
// candidates tie. If you know the language, pick the candidate that matches it.

// file bytes → UTF-8
const { text, encoding } = decode(fs.readFileSync('excel-export.csv'));   // encoding: 'euc-kr'

// ZIP with garbled filenames → ZIP with UTF-8 filenames
const { zip, names } = fixZipNames(fs.readFileSync('archive.zip'));
fs.writeFileSync('archive-fixed.zip', zip);
```

TypeScript types are included.

### CLI

```sh
npx mojibake-fix "ì•ˆë…•í•˜ì„¸ìš”"           # 안녕하세요
npx mojibake-fix -f broken.csv > fixed.csv  # decode a file to UTF-8
cat broken.txt | npx mojibake-fix -
```

## How it works

For each pair of (wrong encoding it was read as, real encoding it was saved in), the engine turns the garbled string back into bytes, decodes them again, and scores the result by how natural it looks (script consistency, rare characters, leftover control characters). The best few candidates are returned. If the whole input can't be explained by one pair, it tries each line on its own, then only the broken spans.

Some damage cannot be undone. If a broken character was already replaced with `�` (U+FFFD), or a byte was dropped when the text was copied, those bytes are gone. When you still have the original **file**, use `decode()`: no bytes have been lost yet, so it is more accurate than `fix()`.

## Accuracy: Node vs. browser

Node's `TextDecoder` uses ICU and the browser's uses the WHATWG tables. They do not map the same characters. For EUC-KR, Node maps about half as many byte pairs as Chrome, so some cases (for example UTF-8 misread as EUC-KR) recover in the browser but not in Node. The engine trusts whichever table it runs on.

## 한국어

인코딩이 엇갈려 깨진 글자(뷁어, `ì•ˆë…•`, `¾È³ç`)를 원래 글자로 되돌리는 라이브러리입니다. 엑셀 CSV 한글 깨짐, 압축 파일 한글 파일명 깨짐도 처리합니다. 설치 없이 쓰려면 **[prelaps.com/mojibake](https://prelaps.com/mojibake/)** 에서 바로 쓸 수 있습니다. 입력은 서버로 보내지지 않습니다.

## License

MIT
