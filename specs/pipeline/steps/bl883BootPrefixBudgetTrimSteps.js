'use strict';

// BL-883: step handlers for "Boot stable prefix returns under the 44000
// budget with enforced landing headroom" - the third bust, and unlike
// BL-618/BL-858 a BUDGET bust (44000) rather than a CAP bust (51200): the
// bb runner was already green at 51200, only BL-858's own live
// headroom-budget-02 scenario was red. Reuses BL-618's own commit-agnostic
// registrations as-is by binding to their exact step text ("the prompt
// engine test runner executes", "each removed passage is searched for
// under...", "each removed passage is found verbatim...", "that slim
// article is read", "it retains a pointer naming...", "the removed lines
// are compared against the added lines", "every removed normative rule
// sentence appears in a reference file or remains in its slim article")
// and BL-858's "the stable prefix length is at most 44000 characters" -
// none re-registered here. This file supplies: the Background bound to
// BL-883's own fix commit (worded differently from BL-618's and BL-858's
// so all three Backgrounds stay distinguishable), the three Given steps
// worded for "the BL-883 parcel" (also distinct from "this fix"/"this
// parcel"), and the two scenarios neither prior ticket had
// (landing-headroom-02's own commit-pinned composer-through-worktree
// check, cap-value-unchanged-06 reused verbatim from BL-858's pattern but
// registered fresh since BL-858's own registration is scoped to its own
// ctx wiring only via shared step text, not exported).
//
// Passage-collection algorithm: a fresh implementation of the same
// approach BL-618's and BL-858's own files use (not a shared import, per
// the ticket's own instruction not to silently rewrite a landed ticket's
// acceptance contract by having it depend on this file). Range
// BASE_COMMIT..FIX_COMMIT: BASE_COMMIT is the commit immediately before
// this parcel's first content commit; the claim ("every passage the
// BL-883 parcel removed") is about the whole parcel, same N-commit
// generalization BL-858 used over BL-618's single-commit diff.
//
// cap-value-unchanged-06 in this parcel's feature reuses BL-858's exact
// step text ("the cap enforced by the prompt engine test runner is read" /
// "the enforced cap is still 51200 characters") verbatim, so it is NOT
// re-registered here - the stepRegistry resolves unscoped patterns
// first-match-across-every-registration (specs/pipeline/stepRegistry.js),
// and bl858BootPrefixCapSteps.js's identical registration already wins;
// duplicating it here would be dead code, not a second real registration.
//
// BL-654 stated reason (all three of BL-883's declared invariants): none
// admits a fast-check property-test encoding, per the same non-encodability
// hatch BL-715/BL-798/BL-853 already used ("some invariants quantify over
// prose/process, not a pure, testable module with a generated input space"):
//   1. "No normative rule text is lost..." quantifies over the passages
//      removed by THIS PARCEL'S OWN diff (BASE_COMMIT..FIX_COMMIT) - a
//      single fixed artifact, not a generated state space. Substitute:
//      moved-text-preserved-03/slim-pointer-retained-04/no-rule-dropped-05
//      above, reusing BL-618's shared registrations - verified passing.
//   2. "...51200 cap and 44000 budget unchanged and no reference/ file body
//      enters the boot prefix" splits in two: the two literal thresholds
//      are read straight from known files (cap-value-unchanged-06 above;
//      the budget by BL-858's own still-live headroom-budget-02 scenario,
//      unchanged, plus this parcel's budget-restored-01) - again a fixed
//      artifact read, not a generated space. The "reference/ never inlined"
//      clause IS a genuinely generative property (arbitrary content under
//      reference/ never appears in stable-prefix-text), but it is not new
//      here and not a JS module: prompt-engine-lib/stable-prefix-text is a
//      Babashka function, outside the *.property.test.js/fast-check lane
//      entirely per this project's Testability Boundary (Babashka is gated
//      only by its own unit-test suite, no property wiring). BL-858 already
//      planted that exact property as a scratch-marker check inside
//      swarmforge/scripts/test/prompt_engine_test_runner.bb (the
//      "an arbitrary reference/ file's content is never inlined" assertion)
//      - unchanged by this parcel, still exercised every runner invocation
//      (verified: ALL PASS at 41812 chars, this parcel's own trim included).
//   3. "...at most 42000 chars...asserted by a commit-pinned acceptance
//      scenario" quantifies over ONE fixed commit's tree and literally
//      names its own enforcement mechanism in the invariant text itself -
//      that mechanism is landing-headroom-02 above, verified passing.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BASE_COMMIT = '004853665';
const FIX_COMMIT = '19929a794';
const PROMPT_ENGINE_TEST_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'prompt_engine_test_runner.bb');
const COMPOSE_AT_ROOT_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'prompt_engine_compose_at_root.bb');
const ARTICLES_DIR = 'swarmforge/constitution/articles';
const REFERENCE_DIR = path.join(REPO_ROOT, ARTICLES_DIR, 'reference');
const TOP_LEVEL_ITEM_RE = /^\d+\.\s/;
const REWORD_OVERLAP_THRESHOLD = 0.6;

function git(args, opts) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', ...opts });
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
  registry.define(/^the repository at the BL-883 fix commit$/, () => {
    if (!fs.existsSync(PROMPT_ENGINE_TEST_RUNNER)) {
      throw new Error(`expected the prompt engine test runner at ${PROMPT_ENGINE_TEST_RUNNER}`);
    }
    if (!isAncestor(FIX_COMMIT, 'HEAD')) {
      throw new Error(`expected HEAD to descend from the BL-883 fix commit ${FIX_COMMIT}`);
    }
  });

  // ── landing-headroom-02: commit-pinned, composed through the real
  //    composer against a materialized worktree of the fix commit's tree -
  //    never a re-derived second implementation. prompt_engine_lib.bb's
  //    own stable-prefix-text already accepts an explicit root (BL-859's
  //    seam); this only supplies the materialized root and shells the real
  //    prompt_engine_compose_at_root.bb wrapper around it. ─────────────────
  registry.define(/^the stable prefix is composed from the BL-883 fix commit's tree through the real composer$/, (ctx) => {
    const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl883-landing-headroom-'));
    fs.rmdirSync(worktreeRoot);
    try {
      git(['worktree', 'add', '--detach', '--quiet', worktreeRoot, FIX_COMMIT]);
      ctx.landingHeadroomOutput = execFileSync('bb', [COMPOSE_AT_ROOT_SCRIPT, worktreeRoot], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      });
    } finally {
      git(['worktree', 'remove', '--force', worktreeRoot]);
    }
  });

  registry.define(/^the composed prefix length at that commit is at most 42000 characters$/, (ctx) => {
    const match = ctx.landingHeadroomOutput.match(/stable-prefix chars:\s*(\d+)/);
    if (!match) {
      throw new Error('expected the compose-at-root output to report "stable-prefix chars: <n>"');
    }
    const chars = Number(match[1]);
    if (!(chars <= 42000)) {
      throw new Error(`expected the BL-883 fix commit's composed prefix at or under 42000 chars, got ${chars}`);
    }
  });

  // ── moved-text-preserved-03 / slim-pointer-retained-04 / no-rule-dropped-05
  //    (Given steps only - the shared When/Then steps that consume
  //    ctx.passages/ctx.movedPassages/ctx.allPassages/ctx.verdicts/
  //    ctx.slimArticles/ctx.slimArticleContents are BL-618's own reused
  //    registrations) ──────────────────────────────────────────────────────
  registry.define(/^the set of passages the BL-883 parcel removed from boot-inlined articles$/, (ctx) => {
    ctx.passages = collectPassages();
    if (ctx.passages.length === 0) {
      throw new Error('expected the fix diff to remove at least one passage from a boot-inlined article');
    }
  });

  registry.define(/^a boot article that lost a passage to a reference file in the BL-883 parcel$/, (ctx) => {
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

  registry.define(/^the diff of the BL-883 parcel across the constitution tree$/, (ctx) => {
    ctx.allPassages = collectPassages();
  });

  // cap-value-unchanged-06's own two steps are BL-858's reused registrations
  // (see the file-header note above) - nothing to register here.
}

module.exports = { registerSteps };
