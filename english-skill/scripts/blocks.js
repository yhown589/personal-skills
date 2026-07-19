#!/usr/bin/env node
'use strict';

/**
 * Question-block tool for the english-rewriter / chinese-english-translator skills.
 *
 * Commands:
 *   node blocks.js parse <file>                  Print the file's question blocks as a JSON array.
 *   node blocks.js write <file> <blocks.json>    Rebuild <file> from the (output-filled) JSON array.
 *   node blocks.js set   <file> <i> <out.txt>    Set block #i's output from a text file and write immediately.
 *
 * `write` and `set` accept `-` in place of the input path to read that payload from stdin,
 * so a caller that must not create temporary files can pipe it instead.
 *   node blocks.js sync  <original> <copy>       Append blocks present in <original> but missing from <copy>.
 *
 * `write` is the batch path (fill every block, then one whole-file write).
 * `set` is the incremental path for skills whose per-block output is large: it rewrites the file
 * after each block, so the work is resumable — a block already set re-parses as skip: true.
 *
 * Block shape:
 *   { header, questionBody, questionMetaData, output, skip }
 *
 * Invariant: header + questionBody + questionMetaData reproduces the original block byte-for-byte.
 * `output` is the only field the caller fills in; empty output means the block is emitted unchanged.
 */

const fs = require('fs');

// Header and question-body matching mirror `mdFileUtils.ts` (the app's batch-import parser),
// so the skills and the importer segment a file identically:
//   splitTimeHeader     -> HEADER_LINE
//   matchQuestionBody   -> first `<!--` anywhere, NOT line-anchored
const HEADER_LINE = /^#\s+(?:\d+\s+)?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s*\r?$/;
const COMMENT_OPEN = '<!--';
const COMMENT = /<!--[\s\S]*?-->/g;
const ANSWER_MARKER = /optimized/;

/**
 * True when the tail carries an answer marker, i.e. an HTML *comment* containing `optimized`.
 * Mirrors mdFileUtils.matchTargetCommentBlock: the keyword is matched against the comment only —
 * a fenced code block that merely mentions the word must NOT count as an answer.
 */
function hasAnswerMarker(questionMetaData) {
  return (questionMetaData.match(COMMENT) || []).some((comment) => ANSWER_MARKER.test(comment));
}

/** Read UTF-8 and drop a leading BOM (PowerShell's `Out-File -Encoding utf8` emits one). */
function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
}

/**
 * Read a content argument. `-` means "read stdin instead of a file", so callers that must not
 * create temporary files can pipe the payload in. Any other value is treated as a file path.
 */
function readInput(pathOrDash) {
  return pathOrDash === '-' ? read(0) : read(pathOrDash);
}

/** A time-header line, per mdFileUtils.splitTimeHeader. */
function isHeading(line) {
  return HEADER_LINE.test(line.replace(/\n$/, ''));
}

/** Split into lines with their terminators still attached, so joining is lossless. */
function splitLines(text) {
  return text.length ? text.split(/(?<=\n)/) : [];
}

function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function parse(text) {
  const lines = splitLines(text);
  const starts = [];
  lines.forEach((line, i) => {
    if (isHeading(line)) starts.push(i);
  });

  // Content before the first heading is not part of any block, but must be preserved on write.
  const preamble = starts.length ? lines.slice(0, starts[0]).join('') : text;

  const blocks = starts.map((from, i) => {
    const to = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const rest = lines.slice(from + 1, to).join('');

    // The question ends at the FIRST `<!--` anywhere in the block — matching
    // mdFileUtils.matchQuestionBody, which is not line-anchored. Everything from that
    // point on (metadata comments, code blocks, existing answer units) is the tail.
    // Slices stay raw (untrimmed) so header + body + tail rebuilds the block byte-for-byte.
    let cut = rest.indexOf(COMMENT_OPEN);
    if (cut === -1) cut = rest.length;

    const questionMetaData = rest.slice(cut);
    return {
      header: lines[from],
      questionBody: rest.slice(0, cut),
      questionMetaData,
      output: '',
      skip: hasAnswerMarker(questionMetaData),
    };
  });

  return { preamble, blocks };
}

function assemble(preamble, blocks, eol) {
  let out = preamble;

  for (const block of blocks) {
    const original =
      (block.header || '') + (block.questionBody || '') + (block.questionMetaData || '');
    const output = (block.output || '').replace(/\s+$/, '');

    // Nothing to insert -> emit the block exactly as it was.
    if (!output) {
      out += original;
      continue;
    }

    // Insert before the block's trailing blank lines so inter-block spacing is preserved.
    const trailing = (original.match(/(?:\r?\n)*$/) || [''])[0];
    const body = original.slice(0, original.length - trailing.length);
    out += body + eol + eol + output + (trailing || eol);
  }

  return out;
}

function sync(originalText, copyText) {
  const eol = eolOf(copyText || originalText);
  const original = parse(originalText);
  const copy = parse(copyText);

  // A block's identity is its full header line plus which occurrence of that line it is,
  // so blocks sharing a header are matched positionally rather than collapsed.
  const copyCount = new Map();
  for (const b of copy.blocks) {
    const key = b.header.trim();
    copyCount.set(key, (copyCount.get(key) || 0) + 1);
  }

  const seen = new Map();
  const missing = original.blocks.filter((b) => {
    const key = b.header.trim();
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n > (copyCount.get(key) || 0);
  });

  if (!missing.length) return { text: copyText, appended: 0 };

  let text = copyText.replace(/(?:\r?\n)*$/, '');
  for (const block of missing) {
    const raw = (block.header + block.questionBody + block.questionMetaData).replace(
      /(?:\r?\n)*$/,
      ''
    );
    text += eol + eol + raw;
  }
  return { text: text + eol, appended: missing.length };
}

function main() {
  const [, , cmd, a, b] = process.argv;

  if (cmd === 'parse') {
    if (!a) throw new Error('usage: blocks.js parse <file>');
    const { blocks } = parse(read(a));
    process.stdout.write(JSON.stringify(blocks, null, 2) + '\n');
    return;
  }

  if (cmd === 'write') {
    if (!a || !b) throw new Error('usage: blocks.js write <file> <blocks.json|->');
    const text = read(a);
    const { preamble } = parse(text);
    const blocks = JSON.parse(readInput(b));
    if (!Array.isArray(blocks)) throw new Error('blocks input must be a JSON array');
    fs.writeFileSync(a, assemble(preamble, blocks, eolOf(text)), 'utf8');
    const filled = blocks.filter((x) => (x.output || '').trim()).length;
    process.stdout.write(`wrote ${blocks.length} block(s), ${filled} with new output\n`);
    return;
  }

  if (cmd === 'set') {
    const outFile = process.argv[5];
    if (!a || b === undefined || !outFile) {
      throw new Error('usage: blocks.js set <file> <blockIndex> <outputFile|->');
    }
    const index = Number(b);
    const text = read(a);
    const { preamble, blocks } = parse(text);
    if (!Number.isInteger(index) || index < 0 || index >= blocks.length) {
      throw new Error(`block index ${b} out of range (file has ${blocks.length} block(s))`);
    }
    if (blocks[index].skip) {
      throw new Error(`block ${index} is already answered (skip: true) — refusing to overwrite`);
    }
    blocks[index].output = readInput(outFile);
    fs.writeFileSync(a, assemble(preamble, blocks, eolOf(text)), 'utf8');
    process.stdout.write(`set block ${index} of ${blocks.length}\n`);
    return;
  }

  if (cmd === 'sync') {
    if (!a || !b) throw new Error('usage: blocks.js sync <original> <copy>');
    const result = sync(read(a), read(b));
    if (result.appended) fs.writeFileSync(b, result.text, 'utf8');
    process.stdout.write(`appended ${result.appended} missing block(s)\n`);
    return;
  }

  throw new Error('usage: blocks.js <parse|write|sync> ...');
}

main();
