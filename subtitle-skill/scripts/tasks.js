#!/usr/bin/env node
'use strict';

/**
 * Work-list tool for the srt-to-transcript / transcript-punctuator skills.
 *
 * Commands:
 *   node tasks.js list srt        <folder>   Tasks for srt-to-transcript.
 *   node tasks.js list punctuate  <folder>   Tasks for transcript-punctuator.
 *   node tasks.js verify <prefix> [source]   Check a punctuated file against its source.
 *
 * Every command prints JSON on stdout and nothing else, so the caller parses one value.
 *
 * Why the selection lives here and not in the model's head: a task is identified by its
 * *path prefix*, the part before the FIRST dot — the same rule the LARS service uses, so
 * `aaa.original.srt`, `aaa.mp4` and `aaa.original.json` are one task. Deriving that by eye
 * over a recursive tree, then diffing it against which outputs already exist, is exactly the
 * kind of bookkeeping that must produce the identical answer on every run and on every machine.
 */

const fs = require('fs');
const path = require('path');

/** Suffixes of the chain, mirrored from application.yml. Changing one here changes it nowhere else. */
const SUFFIX = {
  srt: '.original.srt',
  original: '.original.json',
  punctuated: '.punctuated.json',
  working: '.punctuated.json.working',
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

/** True when a directory component contains a dot, which the service's prefix rule cannot survive. */
function dirtyPath(filePath) {
  return path.dirname(filePath).includes('.');
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

/**
 * Build the work list for one stage.
 *
 * `srt`:        every prefix that has a `.original.srt`. Nothing is filtered out — the model
 *               reviews the produced `.original.json` even when the service skipped it, because
 *               re-reviewing an already-clean file is a no-op and that is what makes an
 *               interrupted run resumable.
 * `punctuate`:  every prefix that has a `.original.json`, marked `skip` when `.punctuated.json`
 *               already exists. That output is the only skip condition.
 */
function list(stage, folder) {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return { error: `not a directory: ${folder}` };
  }

  const prefixes = [...new Set(walk(folder).map(taskPrefix))].sort();
  const tasks = [];

  for (const prefix of prefixes) {
    if (stage === 'srt') {
      const srtPath = prefix + SUFFIX.srt;
      if (!exists(srtPath)) continue;
      tasks.push({
        prefix,
        name: path.basename(prefix),
        srtPath,
        originalPath: prefix + SUFFIX.original,
        originalExists: exists(prefix + SUFFIX.original),
        unsafePath: dirtyPath(srtPath),
      });
    } else {
      const originalPath = prefix + SUFFIX.original;
      if (!exists(originalPath)) continue;
      tasks.push({
        prefix,
        name: path.basename(prefix),
        originalPath,
        punctuatedPath: prefix + SUFFIX.punctuated,
        workingPath: prefix + SUFFIX.working,
        skip: exists(prefix + SUFFIX.punctuated),
        resuming: exists(prefix + SUFFIX.working),
        unsafePath: dirtyPath(originalPath),
      });
    }
  }

  return { stage, folder, taskCount: tasks.length, tasks };
}

/** Words as the aligner effectively sees them: case-folded, stripped of everything but letters/digits. */
function words(text) {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase())
    .filter((w) => w.length > 0);
}

/**
 * Check a punctuated file against its source.
 *
 * This is the machine half of the "never add or remove a word" rule. The model cannot reliably
 * re-read twenty thousand characters and notice one dropped word, and a dropped word is not a
 * cosmetic defect: the aligner still places every remaining word, so the timings of the whole
 * segment shift. Same for a changed `start`/`end`, or a changed segment count — each one
 * corrupts the alignment silently.
 *
 * Checks the working file when it exists (mid-run), otherwise the published one.
 */
function verify(prefix, sourceOverride) {
  const source = sourceOverride || prefix + SUFFIX.original;
  const target = exists(prefix + SUFFIX.working) ? prefix + SUFFIX.working : prefix + SUFFIX.punctuated;

  if (!exists(source)) return { error: `source not found: ${source}` };
  if (!exists(target)) return { error: `nothing to verify, neither working nor punctuated file exists for ${prefix}` };

  const before = JSON.parse(fs.readFileSync(source, 'utf8').replace(/^﻿/, ''));
  const after = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^﻿/, ''));

  const problems = [];
  if (before.length !== after.length) {
    problems.push({ segment: null, kind: 'segment-count', detail: `${before.length} -> ${after.length}` });
  }

  const shared = Math.min(before.length, after.length);
  let punctuated = 0;
  let sentences = 0;

  for (let i = 0; i < shared; i++) {
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

    if (b.text !== a.text) punctuated++;
    sentences += (b.text.match(/[.!?]["')\]]?(\s|$)/g) || []).length;
    if (!/[.!?]["')\]]?$/.test(b.text.trim())) {
      problems.push({ segment: i, kind: 'no-terminal-mark', detail: b.text.trim().slice(-40) });
    }
  }

  return { prefix, target, segments: after.length, punctuated, sentences, ok: problems.length === 0, problems };
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  let result;

  if (command === 'list') {
    const [stage, folder] = rest;
    result = stage !== 'srt' && stage !== 'punctuate'
      ? { error: `unknown stage "${stage}", expected "srt" or "punctuate"` }
      : list(stage, folder);
  } else if (command === 'verify') {
    const [prefix, source] = rest;
    result = prefix ? verify(prefix, source) : { error: 'verify needs a task prefix' };
  } else {
    result = { error: `unknown command "${command}", expected "list" or "verify"` };
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.error ? 1 : 0;
}

main();
