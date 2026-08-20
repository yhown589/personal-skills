#!/usr/bin/env node
'use strict';

/**
 * Work-list, mechanical processing, and verification for the srt-to-cleaned /
 * cleaned-to-punctuated skills.
 *
 * Commands, where <stage> is `clean` (for srt-to-cleaned) or `punctuate` (for cleaned-to-punctuated):
 *
 *   node srt-to-punctuated.js list    <stage> <folder>   Tasks still to do, already filtered.
 *   node srt-to-punctuated.js prepare <stage> <prefix>   Create or resume one task's working copy.
 *   node srt-to-punctuated.js verify  <stage> <prefix>   Check a working copy against its source.
 *   node srt-to-punctuated.js publish <stage> <prefix>   Verify, then produce the final output.
 *
 * Every command prints JSON on stdout and nothing else, so the caller parses one value, and exits
 * non-zero when it failed or did not pass verification.
 *
 * The pipeline:
 *
 *   .original.srt    --[srt-to-cleaned]-->          .cleaned.json
 *   .cleaned.json    --[cleaned-to-punctuated]-->   .punctuated.json
 *   .punctuated.json --[service: align-media, then the rest of the chain]--> .srt
 *
 * ## Why the `clean` stage works at cue granularity
 *
 * Merging cues into ~100-second alignment windows must happen AFTER the non-speech cues are gone,
 * never before. Get that order wrong and the failure is severe but silent: a window ends up
 * spanning audio that no longer has any text covering it, and because forced alignment must place
 * every character somewhere inside its window, the neighbouring real words get smeared across the
 * uncovered audio. Measured on a real episode: a single "I" stretched to 6.5 seconds, and 308
 * seconds of screaming and panting sat inside windows with nothing to account for it.
 *
 * So `prepare clean` stops at cue granularity and hands the caller one entry per cue. Only
 * `publish clean` — after the caller's deletions are in — merges what survived. The merger
 * therefore sees the gaps the deletions opened up and cuts there.
 *
 * ## Why the caller never supplies a timestamp
 *
 * On publish, every timing is re-read from the source `.srt` by cue index. Whatever is in the
 * working file is advisory: the caller can look at it, but cannot influence it. Timestamp drift
 * is not guarded against here, it is structurally impossible.
 */

const fs = require('fs');
const path = require('path');

const SUFFIX = {
  srt: '.original.srt',
  cleaned: '.cleaned.json',
  punctuated: '.punctuated.json',
};

const STAGE = {
  clean: { input: SUFFIX.srt, output: SUFFIX.cleaned },
  punctuate: { input: SUFFIX.cleaned, output: SUFFIX.punctuated },
};

/**
 * Merge parameters for the `clean` stage.
 *
 * `target` is the window size forced alignment gets. Large on purpose: inside a window the aligner
 * ignores the subtitle's own timings entirely and re-derives every word position from the audio,
 * so a wide window makes cue-level timing jitter — and a subtitle that does not quite match this
 * release — stop mattering. `max` bounds the memory of one forward pass (measured: ~1.9 GB at 100s
 * for wav2vec2 base).
 *
 * `minGap` is what counts as a safe place to cut: a sentence split across two windows aligns as two
 * halves and the seam is always wrong. `maxGap` is the one that must never be relaxed — any gap
 * this long is audio with no text, and it has to fall BETWEEN windows rather than inside one.
 */
const MERGE = { target: 100, max: 150, minGap: 0.5, maxGap: 3 };

/** Timecode line. Loose on purpose — a `.srt` extension does not promise a well-formed file. */
const TIME_LINE = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

const ASS_TAG = /\{[^}]*\}/g;                          // {\an8}, {\i1}, SSA comment blocks
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;                // <i>, <font color="#fff">
const BRACKETED = /\[[^\]]*\]|【[^】]*】|〔[^〕]*〕/g;    // [ Screaming ], 【尖叫】
const WHOLE_CUE_NON_SPEECH = /^\([^)]*\)$|^（[^）]*）$|^#[^#]*#$/;  // (laughs), # Music playing #
const MUSIC_NOTE = /[♪♫]/g;
const NUMERIC_ENTITY = /&#(x?)([0-9a-fA-F]+);/g;
const HAS_LETTER = /\p{L}/u;

// ---------------------------------------------------------------- file helpers

const exists = (p) => fs.existsSync(p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 4) + '\n', 'utf8');

/**
 * Read a subtitle file, deciding its encoding.
 *
 * A `.srt` extension does not promise UTF-8: windows-1252 western subtitles and BOM-marked UTF-16
 * are both common, and decoding either as UTF-8 corrupts the whole file. BOM first (it is proof),
 * then a strict UTF-8 attempt (its byte structure is self-validating), then windows-1252, which
 * maps every byte and so can never fail.
 */
function readSubtitle(p) {
  const buf = fs.readFileSync(p);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString('utf8', 3).replace(/﻿/g, '');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le', 2).replace(/﻿/g, '');
  }
  const asUtf8 = buf.toString('utf8');
  // Node substitutes U+FFFD for invalid sequences instead of throwing, so detect it that way
  if (!asUtf8.includes('�')) return asUtf8.replace(/﻿/g, '');
  return buf.toString('latin1').replace(/﻿/g, '');
}

// ---------------------------------------------------------------- srt parsing

function toSeconds(h, m, s, ms) {
  return (h ? +h : 0) * 3600 + +m * 60 + +s + +(ms + '00').slice(0, 3) / 1000;
}

/**
 * Strip everything that is markup rather than speech.
 *
 * Square brackets are the subtitle convention for non-speech description and are stripped wherever
 * they appear, so `- [ Gun cocks ] - Huh?` keeps its "Huh?". Round brackets and hashes are not a
 * reserved convention — they occur in real text — so they are only stripped when the whole cue is
 * one, which no line of dialogue ever is.
 *
 * Bare ALL-CAPS sound descriptions are deliberately NOT handled here: subtitles use capitals for
 * shouted dialogue too ("FREE THE CHARGE! FREE US ALL!" is a real line), and no pattern separates
 * the two. That call needs a reader, which is exactly what the caller is for.
 */
function cleanText(raw) {
  let t = raw.replace(ASS_TAG, '').replace(HTML_TAG, '');
  t = t.replace(NUMERIC_ENTITY, (m, hex, code) => {
    const n = parseInt(code, hex ? 16 : 10);
    return Number.isFinite(n) ? String.fromCharCode(n) : m;
  });
  // &amp; last, or &amp;lt; would decode to <
  t = t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
       .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  t = t.replace(BRACKETED, '').replace(MUSIC_NOTE, '');
  t = t.split(/\s+/).join(' ').trim();
  return WHOLE_CUE_NON_SPEECH.test(t) ? '' : t;
}

/**
 * Parse an srt into cues, mechanically cleaned, sorted, with roll-up duplicates collapsed.
 *
 * The only anchor is the timecode line: index lines may be absent, misnumbered, or run together
 * without blank separators, so recognising the one part of the format that has a fixed shape is
 * far more robust than trusting the three-line structure.
 */
function parseSrt(content) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const cues = [];
  let i = 0;

  const isIndexLineOfNextCue = (k) =>
    /^\d+$/.test(lines[k].trim()) && k + 1 < lines.length && TIME_LINE.test(lines[k + 1]);

  while (i < lines.length) {
    const m = lines[i].match(TIME_LINE);
    if (!m) { i++; continue; }

    const start = toSeconds(m[1], m[2], m[3], m[4]);
    const end = toSeconds(m[5], m[6], m[7], m[8]);
    i++;

    const buf = [];
    while (i < lines.length && lines[i].trim() && !TIME_LINE.test(lines[i]) && !isIndexLineOfNextCue(i)) {
      buf.push(lines[i]); i++;
    }

    const text = cleanText(buf.join(' '));
    if (HAS_LETTER.test(text) && end > start) cues.push({ start, end, text });
  }

  cues.sort((a, b) => a.start - b.start);

  // Roll-up captions and CC streams repeat a line across consecutive cues while only the timecode
  // advances. Left in, the aligner is asked to match one spoken phrase against the audio several
  // times over, and the surplus copies displace their neighbours.
  const deduped = [];
  for (const cue of cues) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text.toLowerCase() === cue.text.toLowerCase()) {
      prev.end = Math.max(prev.end, cue.end);
      continue;
    }
    deduped.push({ ...cue });
  }
  return deduped.map((c, index) => ({ index, ...c }));
}

// ---------------------------------------------------------------- merging

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Merge surviving cues into alignment windows.
 *
 * Cut points are chosen by looking ahead: among the positions within `max` that are followed by a
 * gap, take the one whose duration is closest to `target`. Waiting for a gap after passing the
 * target instead would run a long stretch of continuous dialogue all the way to the cap and then
 * cut mid-sentence anyway — the one thing the gap rule exists to avoid.
 *
 * A gap of `maxGap` or more overrides all of that and cuts on the spot. That gap is audio with no
 * text; a short window is a small cost, an uncovered stretch inside a window is a large one.
 */
function mergeCues(cues) {
  const segments = [];
  let groupStart = 0;

  while (groupStart < cues.length) {
    const startTime = cues[groupStart].start;
    let bestEnd = -1, bestDistance = Infinity, lastWithinCap = groupStart, forced = false;

    for (let i = groupStart; i < cues.length; i++) {
      const duration = cues[i].end - startTime;
      if (duration > MERGE.max && i > groupStart) break;
      lastWithinCap = i;

      const gapToNext = i + 1 < cues.length ? cues[i + 1].start - cues[i].end : Infinity;
      if (gapToNext >= MERGE.maxGap) { bestEnd = i; forced = true; break; }
      if (gapToNext < MERGE.minGap) continue;

      const distance = Math.abs(duration - MERGE.target);
      if (distance < bestDistance) { bestDistance = distance; bestEnd = i; }
    }

    const end = bestEnd >= 0 ? bestEnd : lastWithinCap;
    segments.push({
      text: cues.slice(groupStart, end + 1).map((c) => c.text).join(' '),
      start: round3(startTime),
      end: round3(cues[end].end),
      // External subtitles carry no ASR confidence. 1 is also a sentinel: a real logprob is always
      // negative, so this value marks a segment that was never transcribed. Nothing thresholds it.
      avg_logprob: 1.0,
      forcedCut: forced,
    });
    groupStart = end + 1;
  }

  return segments.map(({ forcedCut, ...seg }) => seg);
}

// ---------------------------------------------------------------- task listing

function taskPrefix(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const dot = base.indexOf('.');
  return path.join(dir, dot === -1 ? base : base.slice(0, dot));
}

/**
 * True when a directory component contains a dot.
 *
 * The Java service derives a task prefix by cutting at the first dot of the whole path string, so a
 * dot in any directory splits one task into two halves that never find each other. Resolved to an
 * absolute path first: that is what the service sees, and it also stops a relative argument like
 * `.` from flagging every file in the folder.
 */
const dirtyPath = (p) => path.dirname(path.resolve(p)).includes('.');

function walk(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/**
 * The work list for one stage: only what is still to be done.
 *
 * Every filtering decision is made here, so the caller iterates and processes every entry with no
 * "should I skip this one?" left to judgement. Exclusions move to `excluded` with a reason, purely
 * so the caller can mention them in its report.
 */
function list(stage, folder) {
  if (!folder || !exists(folder) || !fs.statSync(folder).isDirectory()) {
    return { error: `not a directory: ${folder}` };
  }
  folder = path.resolve(folder);

  const { input, output } = STAGE[stage];
  const tasks = [];
  const excluded = [];

  for (const prefix of [...new Set(walk(folder).map(taskPrefix))].sort()) {
    const inputPath = prefix + input;
    if (!exists(inputPath)) continue;

    const name = path.basename(prefix);
    if (dirtyPath(inputPath)) {
      excluded.push({ name, prefix, reason: 'unsafe-path', detail: 'a directory in the path contains a dot' });
    } else if (exists(prefix + output)) {
      excluded.push({ name, prefix, reason: 'already-done', detail: `${output} already exists` });
    } else {
      tasks.push({
        prefix, name, inputPath,
        outputPath: prefix + output,
        workingPath: prefix + output + '.working',
      });
    }
  }

  return { stage, folder, inputSuffix: input, outputSuffix: output, taskCount: tasks.length, tasks, excludedCount: excluded.length, excluded };
}

// ---------------------------------------------------------------- prepare

/**
 * Create or resume a task's working copy.
 *
 * `clean` parses the subtitle and writes one entry per surviving cue — deliberately unmerged, so
 * that the deletions the caller is about to make can still influence where the windows are cut.
 * `punctuate` copies its input, which carries the timings across byte-for-byte.
 */
function prepare(stage, prefix) {
  const { input, output } = STAGE[stage];
  const inputPath = prefix + input;
  const workingPath = prefix + output + '.working';
  if (!exists(inputPath)) return { error: `input not found: ${inputPath}` };

  const resumed = exists(workingPath);
  if (!resumed) {
    if (stage === 'clean') {
      const cues = parseSrt(readSubtitle(inputPath));
      if (!cues.length) return { error: `no cue parsed from ${inputPath}` };
      writeJson(workingPath, cues.map((c) => ({ index: c.index, start: round3(c.start), end: round3(c.end), text: c.text })));
    } else {
      fs.copyFileSync(inputPath, workingPath);
    }
  }

  const entries = readJson(workingPath);
  const result = { prefix, stage, workingPath, outputPath: prefix + output, resumed, entryCount: entries.length };
  if (stage === 'clean') {
    const parsed = parseSrt(readSubtitle(inputPath)).length;
    result.cuesInSubtitle = parsed;
    result.note = 'entries are single cues, not merged windows; merging happens on publish, after your deletions';
  }
  return result;
}

// ---------------------------------------------------------------- verify

const words = (t) => t.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase()).filter(Boolean);

function isSubsequence(sub, full) {
  let i = 0;
  for (const w of full) if (i < sub.length && w === sub[i]) i++;
  return i === sub.length;
}

function verify(stage, prefix) {
  const { input, output } = STAGE[stage];
  const sourcePath = prefix + input;
  const workingPath = prefix + output + '.working';
  if (!exists(sourcePath)) return { error: `input not found: ${sourcePath}` };
  if (!exists(workingPath)) return { error: `no working copy for ${prefix}; run prepare first` };

  return stage === 'clean'
    ? verifyClean(sourcePath, workingPath, prefix)
    : verifyPunctuate(readJson(sourcePath), readJson(workingPath), prefix, workingPath);
}

/**
 * The `clean` stage may delete cues and delete words; it may not invent one, reorder them, or touch
 * an index. Each surviving entry is matched to its source cue by index and its words must be a
 * subsequence of that cue's.
 */
function verifyClean(sourcePath, workingPath, prefix) {
  const source = new Map(parseSrt(readSubtitle(sourcePath)).map((c) => [c.index, c]));
  const working = readJson(workingPath);
  const problems = [];
  let previousIndex = -1;

  working.forEach((entry, i) => {
    const origin = source.get(entry.index);
    if (!origin) {
      problems.push({ entry: i, kind: 'unknown-index', detail: `index ${entry.index} is not in the subtitle` });
      return;
    }
    if (entry.index <= previousIndex) {
      problems.push({ entry: i, kind: 'out-of-order', detail: `index ${entry.index} after ${previousIndex}` });
    }
    previousIndex = entry.index;

    const kept = words(entry.text || '');
    if (!kept.length) {
      problems.push({ entry: i, kind: 'empty-entry', detail: 'delete the entry instead of emptying it' });
    } else if (!isSubsequence(kept, words(origin.text))) {
      problems.push({ entry: i, kind: 'not-a-subsequence', detail: 'a word was invented, altered, or reordered' });
    }
  });

  return {
    prefix, stage: 'clean', target: workingPath,
    cuesInSubtitle: source.size, cuesKept: working.length, cuesDropped: source.size - working.length,
    ok: problems.length === 0, problems,
  };
}

/** The `punctuate` stage may change nothing but punctuation and case. */
function verifyPunctuate(before, after, prefix, workingPath) {
  const problems = [];
  if (before.length !== after.length) {
    problems.push({ segment: null, kind: 'segment-count', detail: `${before.length} -> ${after.length}` });
  }

  let sentences = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const a = before[i], b = after[i];
    if (a.start !== b.start || a.end !== b.end) {
      problems.push({ segment: i, kind: 'timestamp', detail: `${a.start}-${a.end} -> ${b.start}-${b.end}` });
    }
    if (a.avg_logprob !== b.avg_logprob) {
      problems.push({ segment: i, kind: 'avg_logprob', detail: `${a.avg_logprob} -> ${b.avg_logprob}` });
    }

    const wa = words(a.text), wb = words(b.text);
    if (wa.length !== wb.length) {
      problems.push({ segment: i, kind: 'word-count', detail: `${wa.length} -> ${wb.length}` });
    } else {
      const at = wa.findIndex((w, k) => w !== wb[k]);
      if (at !== -1) problems.push({ segment: i, kind: 'word-changed', detail: `#${at}: "${wa[at]}" -> "${wb[at]}"` });
    }

    sentences += (b.text.match(/[.!?]["')\]]?(\s|$)/g) || []).length;
    if (!/[.!?]["')\]]?$/.test(b.text.trim())) {
      problems.push({ segment: i, kind: 'no-terminal-mark', detail: b.text.trim().slice(-40) });
    }
  }

  return { prefix, stage: 'punctuate', target: workingPath, segments: after.length, sentences, ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------- publish

/**
 * Verify, then produce the final output. A working copy that fails its invariants must never
 * become the file the next stage reads, so the gate is here rather than left to the caller.
 *
 * For `clean` this is where merging happens — and where every timing comes from: the source cue at
 * that index, never the working file. The caller decides what text survives and nothing else.
 */
function publish(stage, prefix) {
  const result = verify(stage, prefix);
  if (result.error) return result;
  if (!result.ok) return { ...result, published: false, detail: 'not published: fix the problems and run publish again' };

  const { input, output } = STAGE[stage];
  const workingPath = prefix + output + '.working';
  const outputPath = prefix + output;

  if (stage === 'clean') {
    const source = new Map(parseSrt(readSubtitle(prefix + input)).map((c) => [c.index, c]));
    const kept = readJson(workingPath).map((e) => ({
      index: e.index,
      start: source.get(e.index).start,
      end: source.get(e.index).end,
      text: e.text.trim(),
    }));
    const segments = mergeCues(kept);
    writeJson(outputPath, segments);
    fs.unlinkSync(workingPath);

    const holes = kept.slice(0, -1)
      .map((c, i) => kept[i + 1].start - c.end)
      .filter((g) => g >= MERGE.maxGap);
    return {
      ...result, published: true, outputPath,
      segments: segments.length,
      longestSegment: round3(Math.max(...segments.map((s) => s.end - s.start))),
      gapsCutOn: holes.length,
      audioLeftOutside: round3(holes.reduce((a, b) => a + b, 0)),
    };
  }

  fs.renameSync(workingPath, outputPath);
  return { ...result, published: true, outputPath };
}

// ---------------------------------------------------------------- cli

const COMMANDS = { list, prepare, verify, publish };

function main() {
  const [command, stage, target] = process.argv.slice(2);
  let result;

  if (!COMMANDS[command]) {
    result = { error: `unknown command "${command}", expected one of ${Object.keys(COMMANDS).join(', ')}` };
  } else if (!STAGE[stage]) {
    result = { error: `unknown stage "${stage}", expected "clean" or "punctuate"` };
  } else if (!target) {
    result = { error: `${command} needs a ${command === 'list' ? 'folder' : 'task prefix'}` };
  } else {
    result = COMMANDS[command](stage, target);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.error || result.ok === false ? 1 : 0;
}

main();
