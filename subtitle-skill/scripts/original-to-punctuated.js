#!/usr/bin/env node
'use strict';

/**
 * Work-list and verification tool for the original-to-cleaned / cleaned-to-punctuated skills.
 *
 * Commands, where <stage> is `clean` (for original-to-cleaned) or `punctuate` (for cleaned-to-punctuated):
 *
 *   node original-to-punctuated.js list    <stage> <folder>   Tasks still to do, already filtered.
 *   node original-to-punctuated.js prepare <stage> <prefix>   Create or resume one task's working copy.
 *   node original-to-punctuated.js verify  <stage> <prefix>   Check a working copy against its source.
 *   node original-to-punctuated.js publish <stage> <prefix>   Verify, then rename the working copy.
 *
 * Every command prints JSON on stdout and nothing else, so the caller parses one value, and exits
 * non-zero when it failed or did not pass verification.
 *
 * The division of labour: everything mechanical and everything conditional lives here — which
 * files are tasks, which are already done, when to create a working copy, whether the result may
 * be published. The caller is left with exactly one job, judging text, and never has to decide
 * whether to skip something.
 *
 * The pipeline these two skills sit in:
 *
 *   .original.srt   --[service: srt-to-original]-->  .original.json
 *   .original.json  --[skill: original-to-cleaned]-->  .cleaned.json
 *   .cleaned.json   --[skill: cleaned-to-punctuated]-->  .punctuated.json
 *   .punctuated.json --[service: align-media, then the rest of the chain]-->  .srt
 *
 * Each stage reads one suffix and writes another, so "has this stage run?" is answered by
 * "does its output exist?" and by nothing else. That is why the model half of original-to-cleaned
 * writes `.cleaned.json` rather than editing `.original.json` in place: sharing a name with the
 * service's product would make the two stages indistinguishable.
 *
 * Why the selection lives here and not in the model's head: a task is identified by its
 * *path prefix*, the part before the FIRST dot — the same rule the LARS service uses, so
 * `aaa.original.srt`, `aaa.mp4` and `aaa.original.json` are one task. Deriving that by eye
 * over a recursive tree, then diffing it against which outputs already exist, is exactly the
 * kind of bookkeeping that must produce the identical answer on every run and on every machine.
 */

const fs = require('fs');
const path = require('path');

/** Suffixes of the pipeline. Changing one here changes it nowhere else. */
const SUFFIX = {
  srt: '.original.srt',
  original: '.original.json',
  cleaned: '.cleaned.json',
  punctuated: '.punctuated.json',
};

/** Per-stage wiring: what it reads, what it writes. The working copy is always output + `.working`. */
const STAGE = {
  clean: { input: SUFFIX.original, output: SUFFIX.cleaned },
  punctuate: { input: SUFFIX.cleaned, output: SUFFIX.punctuated },
};

/**
 * The task prefix of a file: its directory plus the basename up to the first dot.
 *
 * The service computes this by taking everything before the first dot of the WHOLE path string,
 * so a dot anywhere in a directory name makes the two disagree and silently splits one task in
 * half. That case is reported rather than papered over — see `dirtyPath`.
 */
function taskPrefix(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const dot = base.indexOf('.');
  return path.join(dir, dot === -1 ? base : base.slice(0, dot));
}

/**
 * True when a directory component contains a dot, which the prefix rule of step 0 cannot survive.
 *
 * Checked against the resolved absolute path, for two reasons. It is what step 0 actually sees, so
 * a dot in a parent directory outside the scanned folder is caught rather than missed. And it keeps
 * a relative argument from producing a false alarm: `path.dirname("./a.original.json")` is `"."`,
 * which would otherwise flag every file in the folder as unsafe when the caller passes `.`.
 */
function dirtyPath(filePath) {
  return path.dirname(path.resolve(filePath)).includes('.');
}

/** Every regular file under `root`, recursively. */
function walk(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (entry.isFile()) {
      found.push(full);
    }
  }
  return found;
}

const exists = (p) => fs.existsSync(p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));

/**
 * Build the work list for one stage.
 *
 * `tasks` holds only what is actually to be done — every filtering decision is made here, so the
 * caller iterates the list and processes every entry, with no "should I skip this one?" left to
 * judgement. Anything excluded moves to `excluded` with a reason, purely so the caller can
 * mention it in its report.
 */
function list(stage, folder) {
  if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return { error: `not a directory: ${folder}` };
  }

  // 一律换算成绝对路径再往下走：产出的每个 path 都要能被调用方原样使用，
  // 而调用方的工作目录未必是这里的工作目录
  folder = path.resolve(folder);

  const { input, output } = STAGE[stage];
  const prefixes = [...new Set(walk(folder).map(taskPrefix))].sort();
  const tasks = [];
  const excluded = [];

  for (const prefix of prefixes) {
    const inputPath = prefix + input;
    if (!exists(inputPath)) continue;

    const name = path.basename(prefix);

    // 目录名里带点：服务取的是整条路径的第一个点，和这里的算法不一致，
    // 同一个任务会被算成两个前缀。不是跳过就能了事的情况，必须报出来。
    if (dirtyPath(inputPath)) {
      excluded.push({ name, prefix, reason: 'unsafe-path', detail: 'a directory in the path contains a dot' });
      continue;
    }
    if (exists(prefix + output)) {
      excluded.push({ name, prefix, reason: 'already-done', detail: `${output} already exists` });
      continue;
    }

    tasks.push({
      prefix,
      name,
      inputPath,
      outputPath: prefix + output,
      workingPath: prefix + output + '.working',
    });
  }

  return {
    stage,
    folder,
    inputSuffix: input,
    outputSuffix: output,
    taskCount: tasks.length,
    tasks,
    excludedCount: excluded.length,
    excluded,
  };
}

/**
 * Make sure a task's working copy exists, and report what is in it.
 *
 * Copying is done here rather than by the caller for the same reason the filtering is: it is a
 * conditional mechanical step, and getting it wrong in either direction is costly — recreating an
 * existing working copy throws away everything an interrupted run had already finished, while
 * failing to create one leaves the edits with nowhere to go.
 *
 * The copy is what keeps `start`, `end` and `avg_logprob` byte-identical to the input: those
 * numbers are never retyped, so they cannot drift.
 */
function prepare(stage, prefix) {
  const { input, output } = STAGE[stage];
  const inputPath = prefix + input;
  const workingPath = prefix + output + '.working';

  if (!exists(inputPath)) return { error: `input not found: ${inputPath}` };

  const resumed = exists(workingPath);
  if (!resumed) {
    fs.copyFileSync(inputPath, workingPath);
  }

  const segments = readJson(workingPath);
  return {
    prefix,
    stage,
    workingPath,
    outputPath: prefix + output,
    resumed,
    segmentCount: segments.length,
  };
}

/**
 * Publish a finished task: verify first, then rename the working copy onto the final name.
 *
 * Verification is not optional and not separable — a working copy that fails its stage's
 * invariants must never become the file the next stage reads, so the rename is gated on it here
 * instead of relying on the caller to check first.
 */
function publish(stage, prefix) {
  const result = verify(stage, prefix);
  if (result.error) return result;
  if (!result.ok) {
    return { ...result, published: false, detail: 'not renamed: fix the problems and run publish again' };
  }

  const { output } = STAGE[stage];
  const workingPath = prefix + output + '.working';
  const outputPath = prefix + output;

  if (exists(workingPath)) {
    fs.renameSync(workingPath, outputPath);
  }
  return { ...result, published: true, outputPath };
}

/** Words as the aligner effectively sees them: case-folded, stripped of everything but letters/digits. */
function words(text) {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase())
    .filter((w) => w.length > 0);
}

/** True when `sub` appears inside `full` in order, gaps allowed. */
function isSubsequence(sub, full) {
  let i = 0;
  for (const word of full) {
    if (i < sub.length && word === sub[i]) i++;
  }
  return i === sub.length;
}

/**
 * Check a stage's output against its input.
 *
 * This is the machine half of the invariants the skills declare. The model cannot reliably
 * re-read twenty thousand characters and notice one dropped word, and the failure is invisible
 * afterwards: the aligner still places every remaining word, so the timings of the whole segment
 * shift with nothing to indicate why.
 *
 * The two stages have different invariants, so they are checked differently:
 *
 * - `clean` may delete words and may delete whole segments (both are safe — a segment is an
 *   independent alignment window). It may not invent a word, reorder words, or touch a timestamp.
 *   So: every kept segment is matched to its source by `start`, and its words must be a
 *   subsequence of the source's words.
 * - `punctuate` may change nothing but punctuation and case. So: same segment count, same
 *   timestamps, identical word sequence, and every segment must end in a terminal mark.
 *
 * Checks the working copy when it exists (mid-run), otherwise the published output.
 */
function verify(stage, prefix) {
  const { input, output } = STAGE[stage];
  const sourcePath = prefix + input;
  const targetPath = exists(prefix + output + '.working') ? prefix + output + '.working' : prefix + output;

  if (!exists(sourcePath)) return { error: `input not found: ${sourcePath}` };
  if (!exists(targetPath)) return { error: `nothing to verify, neither working nor final output exists for ${prefix}` };

  const before = readJson(sourcePath);
  const after = readJson(targetPath);
  const problems = [];

  return stage === 'clean'
    ? verifyClean(before, after, problems, prefix, targetPath)
    : verifyPunctuate(before, after, problems, prefix, targetPath);
}

function verifyClean(before, after, problems, prefix, targetPath) {
  // 按 start 配对：cleaned 允许整段消失，但留下来的段必须还是原来那一段
  const sourceByStart = new Map(before.map((s) => [String(s.start), s]));

  for (let i = 0; i < after.length; i++) {
    const b = after[i];
    const a = sourceByStart.get(String(b.start));

    if (!a) {
      problems.push({ segment: i, kind: 'unknown-segment', detail: `start ${b.start} is not in the source` });
      continue;
    }
    if (a.end !== b.end || a.avg_logprob !== b.avg_logprob) {
      problems.push({ segment: i, kind: 'timestamp', detail: `${a.start}-${a.end} -> ${b.start}-${b.end}` });
    }

    const kept = words(b.text);
    if (kept.length === 0) {
      problems.push({ segment: i, kind: 'empty-segment', detail: 'delete the element instead of emptying it' });
    } else if (!isSubsequence(kept, words(a.text))) {
      problems.push({ segment: i, kind: 'not-a-subsequence', detail: 'a word was invented, altered, or reordered' });
    }
  }

  const droppedStarts = before.length - after.length;
  return {
    prefix, stage: 'clean', target: targetPath,
    segmentsBefore: before.length, segmentsAfter: after.length, segmentsDropped: droppedStarts,
    wordsBefore: before.reduce((n, s) => n + words(s.text).length, 0),
    wordsAfter: after.reduce((n, s) => n + words(s.text).length, 0),
    ok: problems.length === 0, problems,
  };
}

function verifyPunctuate(before, after, problems, prefix, targetPath) {
  if (before.length !== after.length) {
    problems.push({ segment: null, kind: 'segment-count', detail: `${before.length} -> ${after.length}` });
  }

  let sentences = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const a = before[i];
    const b = after[i];

    if (a.start !== b.start || a.end !== b.end) {
      problems.push({ segment: i, kind: 'timestamp', detail: `${a.start}-${a.end} -> ${b.start}-${b.end}` });
    }
    if (a.avg_logprob !== b.avg_logprob) {
      problems.push({ segment: i, kind: 'avg_logprob', detail: `${a.avg_logprob} -> ${b.avg_logprob}` });
    }

    const wordsBefore = words(a.text);
    const wordsAfter = words(b.text);
    if (wordsBefore.length !== wordsAfter.length) {
      problems.push({ segment: i, kind: 'word-count', detail: `${wordsBefore.length} -> ${wordsAfter.length}` });
    } else {
      const at = wordsBefore.findIndex((w, k) => w !== wordsAfter[k]);
      if (at !== -1) {
        problems.push({ segment: i, kind: 'word-changed', detail: `#${at}: "${wordsBefore[at]}" -> "${wordsAfter[at]}"` });
      }
    }

    sentences += (b.text.match(/[.!?]["')\]]?(\s|$)/g) || []).length;
    if (!/[.!?]["')\]]?$/.test(b.text.trim())) {
      problems.push({ segment: i, kind: 'no-terminal-mark', detail: b.text.trim().slice(-40) });
    }
  }

  return {
    prefix, stage: 'punctuate', target: targetPath,
    segments: after.length, sentences,
    ok: problems.length === 0, problems,
  };
}

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
