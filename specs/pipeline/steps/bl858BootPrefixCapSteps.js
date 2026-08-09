'use strict';

// BL-858: step handlers for "Boot stable prefix returns under the cap with
// real headroom" - the second bust after BL-618. Three of BL-618's own
// handlers ("the prompt engine test runner executes", "the stable prefix
// length is under 51200 characters", "the runner reports ALL PASS") are
// commit-agnostic and are reused as-is by binding to their exact step text -
// they are NOT re-registered here (specs/pipeline/steps/bl618StablePrefixCapSteps.js
// already registers them). Likewise the shared When/Then steps that consume
// ctx.passages/ctx.movedPassages/ctx.allPassages/ctx.verdicts/ctx.slimArticles/
// ctx.slimArticleContents ("each removed passage is searched for under...",
// "each removed passage is found verbatim...", "that slim article is read",
// "it retains a pointer naming...", "the removed lines are compared against
// the added lines", "every removed normative rule sentence appears in a
// reference file or remains in its slim article") are BL-618's own
// registrations, reused unchanged - this file only supplies the ctx those
// steps read, scoped to BL-858's own fix commit, plus the two scenarios
// BL-618 never had (headroom-budget-02, cap-value-unchanged-06).
//
// The passage-collection algorithm below is a fresh implementation of the
// same approach BL-618's own step file uses (a "passage" is a removed run
// of diff lines, further split at top-level numbered-list-item boundaries;
// a passage counts as moved if found verbatim, whitespace-normalized,
// under reference/, otherwise it must show strong word-overlap with the
// hunk's added lines) - NOT a shared import, and BL-618's own file and
// FIX_COMMIT constant are untouched, per the ticket's own instruction not
// to silently rewrite a landed ticket's acceptance contract.
//
// Unlike BL-618 (one commit), this parcel landed as BASE_COMMIT..FIX_COMMIT
// - three commits (trim, materialize the feature, fix two mechanical gaps
// the acceptance run itself surfaced). Diffing FIX_COMMIT against its own
// immediate parent would show only the third commit's changes; the actual
// claim ("every passage this parcel removed") is about the whole parcel, so
// the diff is a RANGE from the pre-BL-858 base to the latest content
// commit, same semantics as BL-618's single-commit diff generalized to N
// commits.

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BASE_COMMIT = '1fae38318';
const FIX_COMMIT = 'b69856736';
const PROMPT_ENGINE_TEST_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'prompt_engine_test_runner.bb');
const ARTICLES_DIR = 'swarmforge/constitution/articles';
const REFERENCE_DIR = path.join(REPO_ROOT, ARTICLES_DIR, 'reference');
const TOP_LEVEL_ITEM_RE = /^\d+\.\s/;
const REWORD_OVERLAP_THRESHOLD = 0.6;

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function isAncestor(ancestor, descendant) {
  try {
    git(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function fixCommitDiff() {
  return git(['diff', BASE_COMMIT, FIX_COMMIT, '--', ARTICLES_DIR]);
}

function parseHunks(diffText) {
  const hunks = [];
  let currentFile = null;
  let currentHunk = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/ b\/(\S+)$/);
      currentFile = match ? match[1] : null;
      continue;
    }
    if (line.startsWith('@@')) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = { file: currentFile, lines: [] };
      continue;
    }
    if (!currentHunk || line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'remove', text: line.slice(1) });
    } else if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', text: line.slice(1) });
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({ type: 'context', text: line.slice(1) });
    }
  }
  if (currentHunk) {
    hunks.push(currentHunk);
  }
  return hunks.filter((hunk) => hunk.file && !hunk.file.startsWith(`${ARTICLES_DIR}/reference/`));
}

function removedPassages(hunk) {
  const passages = [];
  let current = [];
  const flush = () => {
    if (current.length) {
      passages.push(current.join('\n'));
    }
    current = [];
  };
  for (const line of hunk.lines) {
    if (line.type === 'remove') {
      if (TOP_LEVEL_ITEM_RE.test(line.text) && current.length) {
        flush();
      }
      current.push(line.text);
    } else if (line.type === 'context') {
      flush();
    }
  }
  flush();
  return passages.filter((passage) => passage.trim().length > 0);
}

function addedText(hunk) {
  return hunk.lines.filter((line) => line.type === 'add').map((line) => line.text).join('\n');
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function significantWords(text) {
  return text.toLowerCase().match(/[a-z0-9]{4,}/g) || [];
}

function overlapRatio(removedText, addedTextForHunk) {
  const removedWords = significantWords(removedText);
  if (removedWords.length === 0) {
    return 1;
  }
  const addedSet = new Set(significantWords(addedTextForHunk));
  const shared = removedWords.filter((word) => addedSet.has(word)).length;
  return shared / removedWords.length;
}

function referenceFileNames() {
  return fs.readdirSync(REFERENCE_DIR).filter((name) => fs.statSync(path.join(REFERENCE_DIR, name)).isFile());
}

function referenceFileContents(names) {
  const contents = new Map();
  for (const name of names) {
    contents.set(name, fs.readFileSync(path.join(REFERENCE_DIR, name), 'utf8'));
  }
  return contents;
}

function collectPassages() {
  const refNames = referenceFileNames();
  const refContents = referenceFileContents(refNames);
  const hunks = parseHunks(fixCommitDiff());
  const passages = [];
  for (const hunk of hunks) {
    const hunkAdded = addedText(hunk);
    for (const passageText of removedPassages(hunk)) {
      const normalized = normalizeWhitespace(passageText);
      const foundIn = refNames.filter((name) => normalizeWhitespace(refContents.get(name)).includes(normalized));
      passages.push({ file: hunk.file, text: passageText, hunkAdded, foundIn });
    }
  }
  return passages;
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.define(/^the repository at the parcel's fix commit$/, () => {
    if (!fs.existsSync(PROMPT_ENGINE_TEST_RUNNER)) {
      throw new Error(`expected the prompt engine test runner at ${PROMPT_ENGINE_TEST_RUNNER}`);
    }
    if (!isAncestor(FIX_COMMIT, 'HEAD')) {
      throw new Error(`expected HEAD to descend from the BL-858 fix commit ${FIX_COMMIT}`);
    }
  });

  // ── headroom-budget-02 (reuses BL-618's "the prompt engine test runner
  //    executes" for the When step) ─────────────────────────────────────────
  registry.define(/^the stable prefix length is at most 44000 characters$/, (ctx) => {
    const match = ctx.runnerOutput.match(/stable-prefix chars:\s*(\d+)/);
    if (!match) {
      throw new Error('expected the runner output to report "stable-prefix chars: <n>"');
    }
    const chars = Number(match[1]);
    if (!(chars <= 44000)) {
      throw new Error(`expected the stable prefix at or under 44000 chars, got ${chars}`);
    }
  });

  // ── moved-text-preserved-03 / slim-pointer-retained-04 / no-rule-dropped-05
  //    (Given steps only - the When/Then steps that consume ctx.* below are
  //    BL-618's own reused registrations) ────────────────────────────────────
  registry.define(/^the set of passages this parcel removed from boot-inlined articles$/, (ctx) => {
    ctx.passages = collectPassages();
    if (ctx.passages.length === 0) {
      throw new Error('expected the fix diff to remove at least one passage from a boot-inlined article');
    }
  });

  registry.define(/^a boot article that lost a passage to a reference file in this parcel$/, (ctx) => {
    const passages = collectPassages().filter((passage) => passage.foundIn.length === 1);
    if (passages.length === 0) {
      throw new Error('expected at least one boot article to have lost a passage to a reference file');
    }
    const bySourceFile = new Map();
    for (const passage of passages) {
      if (!bySourceFile.has(passage.file)) {
        bySourceFile.set(passage.file, new Set());
      }
      bySourceFile.get(passage.file).add(passage.foundIn[0]);
    }
    ctx.slimArticles = [...bySourceFile.entries()].map(([file, refs]) => ({ file, refs: [...refs] }));
  });

  registry.define(/^the diff of this parcel across the constitution tree$/, (ctx) => {
    ctx.allPassages = collectPassages();
  });

  // ── cap-value-unchanged-06 ─────────────────────────────────────────────────
  registry.define(/^the cap enforced by the prompt engine test runner is read$/, (ctx) => {
    ctx.runnerSource = fs.readFileSync(PROMPT_ENGINE_TEST_RUNNER, 'utf8');
  });

  registry.define(/^the enforced cap is still 51200 characters$/, (ctx) => {
    if (!/<\s*stable-len\s+51200\)/.test(ctx.runnerSource)) {
      throw new Error('expected the runner source to still enforce "< stable-len 51200)"');
    }
  });
}

module.exports = { registerSteps };
