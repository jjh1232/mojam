/* English UI strings.
 *
 * ⚠ Draft translation — needs a human pass before this goes live.
 *   CLAUDE.md: machine/unreviewed translation must not ship (AdSense low-quality risk).
 *   Everything else (engine.js, ui.js) is shared and untouched by translation.
 *
 * Load order on a page: engine.js → i18n.<lang>.js → ui.js  (ui.js reads I18N).
 */
var I18N = {

  // Script/region labels shown next to each candidate.
  // ⚠ Do not turn cyrillic / han / latin into language names. Several languages
  //   share those scripts, so naming one would be a guess. Staying at the script
  //   level is deliberate (기획서 5.2).
  lang: {
    ko:'Korean', ja:'Japanese', th:'Thai', el:'Greek', he:'Hebrew', ar:'Arabic',
    zhHans:'Chinese (Simplified)', zhHant:'Chinese (Traditional)', vi:'Vietnamese', tr:'Turkish',
    centeur:'Central European', westeur:'Western European', baltic:'Baltic',
    cyrillic:'Cyrillic script', han:'Han characters', latin:'Latin script'
  },

  // Everything the user reads. Translating a language means translating this section only.
  // Sentences with numbers in them are functions — word order differs by language,
  // so string concatenation at the call site would not survive translation.
  ui: {
    latin1Raw: 'raw Latin-1',

    // Diagnostics (reasons)
    nbspFixed: '<b>A non-breaking space had been turned into a normal space</b> somewhere before you pasted it. Messengers, web forms and Excel commonly do this. We restored it this time, but <b>uploading the file instead avoids the damage entirely.</b>',
    damaged: n => '<b>' + n + ' character(s) were replaced along the way.</b> This looks like UTF-8 read as a Western European encoding, but some positions now hold a different character than the original. Try copying again from the original file or screen.',
    lowScore: '<b>These results are hard to trust.</b> No combination produced natural-looking text. Treat the candidates below as guesses only.',
    partialBytes: '<b>A byte appears to be missing from the middle of the input.</b> See "Partially recovered" below. Copying again from the original file or screen will most likely recover it fully.',
    fffd: n => 'The input contains ' + n + ' <code>�</code> character(s). Those bytes are gone, so no tool can bring them back. This is especially common with windows-1252, which leaves five slots empty (0x81, 0x8D, 0x8F, 0x90, 0x9D) — about 16% of Korean syllables die the moment they are read that way.',
    qmark: n => 'The input contains ' + n + ' <code>?</code> character(s). If the original characters were replaced by <code>?</code>, they cannot be recovered.',
    pasteDamage: '<b>The text may have been damaged further while being pasted.</b> This kind of mojibake usually contains invisible control characters, and messengers, web forms and text editors silently drop them. Try copying again from the original file or screen.',
    shortInput: (n, min) => 'The input is only ' + n + ' characters long. Detection works from the ratio of character types, so accuracy drops sharply below ' + min + ' characters. Paste more of the same text to improve it.',
    lossyExtra: 'Information may also have been lost in an intermediate step, if the text went through several conversions.',

    // Provenance chips
    undo: 'reversed',
    nbspChip: 'space restored',
    readAs: 'decoded',
    savedAs: 'file',
    savedAsName: 'filename',
    encFile: ' file',

    // Rank and confidence
    rank1: 'Best match',
    rankN: i => '#' + i,
    confShortTitle: 'The input is too short to compute a confidence score',
    confShortTitleFile: 'Too few characters to compute a confidence score',
    confShort: 'no confidence score',
    confRef: 'for reference',
    confFixed: 'declared in the file',

    // Buttons
    copy: 'Copy',
    copied: 'Copied',
    clear: 'Clear',
    download: 'Download as UTF-8',
    downloading: 'Preparing',
    takeThisName: 'Download with this name',
    meta: (ms, n) => ms + 'ms · ' + n + ' candidate(s)',

    // Line-wise / segment-wise recovery card
    cardSeg: 'Damaged parts only',
    cardLine: 'Recovered line by line',
    segCount: n => n + ' segment(s)',
    lineCount: (total, fixed) => fixed + ' of ' + total + ' line(s)',
    chipSeg: 'damaged segments only',
    chipLine: 'reversed line by line',
    segTail: ' undone, the rest left as-is',
    lineTail: '',   // 한국어는 '으로 되돌림' 접미사가 필요하지만 영어는 칩만으로 완결된다

    // Partial recovery
    partialTitle: 'Partially recovered',
    partialDesc: 'A byte seems to be missing from the middle of the input. Only the part before it could be restored. We cannot tell which reading is correct, so they are listed as-is.',

    // Paste tab messages
    needInput: 'Paste the garbled text first.',
    segMsg: '<b>Only the damaged parts were recovered.</b> Undamaged characters were mixed in, so the whole text could not be reversed at once. The damaged segments were undone and everything else left alone.',
    lineMsg: '<b>Each line is broken in a different way.</b> They could not be reversed together, so each line was <b>recovered separately.</b>',
    rankIsRef: ' The ranking below comes from reversing the whole text one single way, so treat it as reference.',
    belowIsRef: ' The results below come from reversing the whole text one single way, so treat them as reference.',
    notBroken: 'This text does not appear to be garbled. There is nothing to recover.',
    noCombo: '<b>No combination could reverse this.</b> The likely reasons are below.',
    alreadyNormal: 'This already looks like normal text. The candidates below are for reference.',
    nbspRecovered: '<b>Recovered.</b> Note that the input had been damaged once during pasting.',
    verifyFirst: '<b>Check this before relying on it.</b>',

    // File tab messages
    contentBroken: enc => '<b>The file itself is fine</b> — it is correctly stored as <code>' + enc + '</code>. What is garbled is <b>the text inside it</b>, which was already broken when it was saved, so that text was recovered instead. This is what happens when you copy garbled characters and save them into a text editor.',
    notText: '<b>This is not a text file.</b> Binary files such as images, executables and documents have no notion of an encoding mismatch, so there is nothing to recover. Upload a file that contains only text — txt, csv, srt, json and so on.',
    noGlyphs: 'No readable text could be extracted from this file. Please check that it really is a text file.',
    bomMsg: bom => 'This file carries a <code>' + bom + '</code> BOM. The encoding is declared inside the file, so there is no reason for it to break. If a program still shows it garbled, that program is ignoring the BOM.',
    asciiMsg: 'This file contains only letters, digits and symbols, so no encoding mismatch is possible. There is nothing to recover.',
    mixedMsg: '<b>The text looks garbled, but no combination could reverse it.</b> When <b>characters broken in different ways are mixed into one file</b>, they cannot be reversed together — recovery assumes one single answer to "how was this misread" and rewinds it, so multiple answers cannot hold at once. If the file has many lines, try splitting it. The text may also have been damaged further while being pasted.',
    utf8Fine: 'This file is stored as <code>utf-8</code>. No sign of an encoding mismatch was found.',
    zipAlready: 'The names in this archive are already marked as UTF-8. There is nothing to fix.',
    zipFail: 'The filenames inside this archive are garbled, but no encoding could read them. The filename bytes may already be damaged.',
    zipMsg: 'The <b>filenames inside this archive</b> are garbled. They can be fixed and downloaded without recompressing. File contents are copied through untouched, so nothing inside is damaged.',
    tooBig: (size, max) => 'The file is ' + size + ', which is too large. Everything runs inside your browser, so the limit is ' + max + '. Try uploading just the first part.',
    emptyFile: 'The file is empty.',
    readFail: 'The file could not be read.'
  }
};
