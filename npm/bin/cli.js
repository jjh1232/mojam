#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { fix, decode } = require('..');

const args = process.argv.slice(2);
if (!args.length || args[0] === '-h' || args[0] === '--help') {
  console.log(`mojibake-fix — repair garbled text (mojibake)

  mojibake-fix "ì•ˆë…•í•˜ì„¸ìš”"    fix a string  → 안녕하세요
  mojibake-fix -f broken.csv > ok.csv   decode a file to UTF-8
  echo "¾È³çÇÏ¼¼¿ä" | mojibake-fix -  read stdin    → 안녕하세요

Web version (no install): https://prelaps.com/mojibake/en/`);
  process.exit(0);
}
if (args[0] === '-f') {
  const r = decode(fs.readFileSync(args[1]));
  if (r.text === null) { console.error(r.binary ? 'binary file' : 'could not decode'); process.exit(1); }
  console.error('encoding: ' + r.encoding);
  process.stdout.write(r.text);
} else if (args[0] === '-') {
  process.stdout.write(fix(fs.readFileSync(0, 'utf8')));
} else {
  console.log(fix(args.join(' ')));
}
