#!/usr/bin/env node
'use strict';

/**
 * Question-block tool for the english-rewriter / chinese-english-translator skills.
 *
 * Commands:
 *   node blocks.js parse   <file>                    Print the file's question blocks as a JSON array.
 *   node blocks.js write   <file> <blocks.json>      Rebuild <file> from the (output-filled) JSON array.
 *   node blocks.js set     <file> <i> <out.txt>      Set block #i's output from a text file and write immediately.
 *   node blocks.js sync    <original> <copy>         Append blocks present in <original> but missing from <copy>.
 *   node blocks.js pending <source> <outfile>        Print the source blocks not yet completed in <outfile>.
 *   node blocks.js emit    <source> <outfile> <i> [answer]
 *                                                    Complete source block #i in <outfile> (see below).
 *
 * `write`, `set`, and `emit` accept `-` in place of the input path to read that payload from
 * stdin, so a caller that must not create temporary files can pipe it instead.
 *
 * `write` is the batch path (fill every block, then one whole-file write).
 * `set` is the incremental path that fills blocks inside one self-contained file: it rewrites the
 * file after each block, so the work is resumable — a block already set re-parses as skip: true.
 *
 * `pending`/`emit` are the build-up path: the output file starts empty (the script creates it,
 * seeded with the source's preamble) and grows one block per `emit`. The model supplies only the
 * answer text; the script writes header + questionBody + questionMetaData + answer, so the
 * byte-sensitive parts are never retyped. Per block, `emit`:
 *   - appends the block (with the answer, when given) if it is absent from the output file;
 *   - fills the answer in place if the block is present but unanswered (old-style working
 *     copies, or source == outfile for in-place processing);
 *   - with no answer argument, copies the block verbatim (for skip: true blocks);
 *   - refuses to overwrite a block already answered in the output file.
 * Blocks are matched between source and output file by header line + occurrence index (same
 * rule as `sync`), so progress is derived from the files — nothing is deleted or tracked aside.
 *
 * Block shape:
 *   { header, questionBody, questionMetaData, output, skip }
 *
 * Invariant: header + questionBody + questionMetaData reproduces the original block byte-for-byte.
 * `output` is the only field the caller fills in; empty output means the block is emitted unchanged.
 */

const fs = require('fs');

// Segmentation rules (fixed; every skill and every run must agree on them):
//   HEADER_LINE  -> a `# [index or title] YYYY-MM-DD HH:mm:ss.SSS` heading starts a block
//                   (anything may precede the timestamp; the line must END with the timestamp)
//   question body -> ends at the first `<!--` anywhere in the block, NOT line-anchored
const HEADER_LINE = /^#\s+(?:.*\s+)?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s*\r?$/;
const COMMENT_OPEN = '<!--';
const COMMENT = /<!--[\s\S]*?-->/g;
const ANSWER_MARKER = /optimized/;

/**
 * True when the tail carries an answer marker, i.e. an HTML *comment* containing `optimized`.
 * The keyword is matched against the comment only —
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

/** A time-header line, per HEADER_LINE above. */
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

    // The question ends at the FIRST `<!--` anywhere in the block — the match is
    // not line-anchored. Everything from that
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

function headerKey(block) {
  return block.header.trim();
}

/** Group blocks by header line, preserving order within each group. */
function groupByHeader(blocks) {
  const map = new Map();
  for (const b of blocks) {
    const key = headerKey(b);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }
  return map;
}

/**
 * Find the output-file block matching source block #index: same header line, same occurrence
 * ordinal among blocks sharing that header (the `sync` identity rule). Null when absent.
 */
function matchInOut(sourceBlocks, index, outMap) {
  const key = headerKey(sourceBlocks[index]);
  let occ = 0;
  for (let i = 0; i < index; i++) {
    if (headerKey(sourceBlocks[i]) === key) occ++;
  }
  const candidates = outMap.get(key) || [];
  return occ < candidates.length ? candidates[occ] : null;
}

/**
 * Source blocks not yet completed in the output file. A block is completed when its match
 * exists in the output file and either side carries an answer marker (skip: true) — a
 * skip: true source block still counts as pending until its verbatim copy has been emitted.
 */
function pendingBlocks(sourceText, outText) {
  const src = parse(sourceText);
  const outMap = groupByHeader(parse(outText).blocks);
  const result = [];
  src.blocks.forEach((b, index) => {
    const m = matchInOut(src.blocks, index, outMap);
    const done = !!m && (m.skip || b.skip);
    if (!done) {
      result.push({ index, header: b.header, questionBody: b.questionBody, skip: b.skip });
    }
  });
  return result;
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

  if (cmd === 'pending') {
    if (!a || !b) throw new Error('usage: blocks.js pending <source> <outfile>');
    const outText = fs.existsSync(b) ? read(b) : '';
    process.stdout.write(JSON.stringify(pendingBlocks(read(a), outText), null, 2) + '\n');
    return;
  }

  if (cmd === 'emit') {
    const answerArg = process.argv[6]; // optional: omit to copy the block verbatim
    if (!a || !b || process.argv[5] === undefined) {
      throw new Error('usage: blocks.js emit <source> <outfile> <blockIndex> [answerFile|-]');
    }
    const index = Number(process.argv[5]);
    const sourceText = read(a);
    const { preamble, blocks } = parse(sourceText);
    if (!Number.isInteger(index) || index < 0 || index >= blocks.length) {
      throw new Error(`block index ${index} out of range (source has ${blocks.length} block(s))`);
    }
    const block = blocks[index];
    const answer = (answerArg === undefined ? '' : readInput(answerArg)).replace(/\s+$/, '');
    if (block.skip && answer) {
      throw new Error(
        `block ${index} is already answered in the source — emit it without an answer to copy it verbatim`
      );
    }

    // A missing or empty output file starts as the source's preamble, so content before the
    // first heading survives the build-up flow.
    const outExists = fs.existsSync(b);
    const outText = outExists ? read(b) : '';
    const seeded = outText || preamble;
    const out = parse(seeded);
    const eol = eolOf(outText || sourceText);

    const match = matchInOut(blocks, index, groupByHeader(out.blocks));
    if (match) {
      if (match.skip) {
        if (answer) {
          throw new Error(`block ${index} is already answered in the output file — refusing to overwrite`);
        }
        process.stdout.write(`block ${index} already present in output file\n`);
        return;
      }
      if (!answer) {
        process.stdout.write(`block ${index} already present in output file\n`);
        return;
      }
      match.output = answer;
      fs.writeFileSync(b, assemble(out.preamble, out.blocks, eol), 'utf8');
      process.stdout.write(`filled block ${index} in place (${blocks.length} block(s) in source)\n`);
      return;
    }

    const raw = (block.header + block.questionBody + block.questionMetaData).replace(/(?:\r?\n)*$/, '');
    const chunk = answer ? raw + eol + eol + answer : raw;
    const base = seeded.replace(/(?:\r?\n)*$/, '');
    fs.writeFileSync(b, (base ? base + eol + eol : '') + chunk + eol, 'utf8');
    process.stdout.write(
      `emitted block ${index}${answer ? '' : ' verbatim'} (${blocks.length} block(s) in source)\n`
    );
    return;
  }

  throw new Error('usage: blocks.js <parse|write|set|sync|pending|emit> ...');
}

main();
