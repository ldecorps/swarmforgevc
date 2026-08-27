'use strict';

// BL-618: step handlers for "Stable prefix returns under the boot cap".
// Verifies the real fix commit (boot-prefix trim via the established BL-433
// split mechanism) against the actual git history and file tree - runs the
// real prompt_engine_test_runner.bb gate and diffs the real fix commit,
// never stubs the char-count check or hand-waves passage preservation.
//
// "Passage" extraction: a removed run of git-diff lines, further split at
// top-level numbered-list-item boundaries (e.g. "6. Epics have icons...").
// The extra split is needed because adjacent numbered items with no blank
// line between them (local-engineering.prompt items 5/6) land in the same
// diff run, but the BL-433 split can still route each item's prose to its
// own section of a reference file - splitting on the item marker keeps each
// passage's verbatim-match check honest instead of merging unrelated prose.
//
// A passage counts as "moved" if it is found verbatim (whitespace-
// normalized) in some file under reference/; otherwise it must show strong
// word-overlap with the hunk's added lines (a reword-in-place that keeps
// the rule's content, e.g. the engineering.prompt daemon-wiring bullet).

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIX_COMMIT = '624ad2bc2';
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
  return git(['diff', `${FIX_COMMIT}^`, FIX_COMMIT, '--', ARTICLES_DIR]);
}

// Parses a unified diff into per-file hunks, keeping context lines so
// unrelated edits that git merged into one @@ block can still be told apart.
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

// Every removed passage in the fix diff, tagged with which reference
// file(s) contain it verbatim (whitespace-normalized) - the empty case
// means it was reworded in place rather than moved out.
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
  // ── gate-green-01 ──────────────────────────────────────────────────────
  registry.define(/^the repository at the fix commit$/, () => {
    if (!fs.existsSync(PROMPT_ENGINE_TEST_RUNNER)) {
      throw new Error(`expected the prompt engine test runner at ${PROMPT_ENGINE_TEST_RUNNER}`);
    }
    if (!isAncestor(FIX_COMMIT, 'HEAD')) {
      throw new Error(`expected HEAD to descend from the BL-618 fix commit ${FIX_COMMIT}`);
    }
  });

  registry.define(/^the prompt engine test runner executes$/, (ctx) => {
    ctx.runnerOutput = execFileSync('bb', [PROMPT_ENGINE_TEST_RUNNER], { cwd: REPO_ROOT, encoding: 'utf8' });
  });

  registry.define(/^the stable prefix length is under 51200 characters$/, (ctx) => {
    const match = ctx.runnerOutput.match(/stable-prefix chars:\s*(\d+)/);
    if (!match) {
      throw new Error('expected the runner output to report "stable-prefix chars: <n>"');
    }
    const chars = Number(match[1]);
    if (!(chars < 51200)) {
      throw new Error(`expected the stable prefix under 51200 chars, got ${chars}`);
    }
  });

  registry.define(/^the runner reports ALL PASS$/, (ctx) => {
    if (!ctx.runnerOutput.includes('ALL PASS')) {
      throw new Error(`expected the runner output to include "ALL PASS", got: ${ctx.runnerOutput}`);
    }
  });

  // ── moved-text-preserved-02 ────────────────────────────────────────────
  registry.define(/^the set of passages this fix removed from boot-inlined articles$/, (ctx) => {
    ctx.passages = collectPassages();
    if (ctx.passages.length === 0) {
      throw new Error('expected the fix diff to remove at least one passage from a boot-inlined article');
    }
  });

  registry.define(/^each removed passage is searched for under "([^"]+)"$/, (ctx, searchDir) => {
    if (!searchDir.includes('constitution/articles/reference')) {
      throw new Error(`unexpected search directory: ${searchDir}`);
    }
    ctx.movedPassages = ctx.passages.filter((passage) => passage.foundIn.length >= 1);
    if (ctx.movedPassages.length === 0) {
      throw new Error('expected at least one removed passage to have moved into reference/');
    }
  });

  registry.define(/^each removed passage is found verbatim in exactly one reference file$/, (ctx) => {
    for (const passage of ctx.movedPassages) {
      if (passage.foundIn.length !== 1) {
        throw new Error(
          `expected the passage removed from ${passage.file} to be found verbatim in exactly one reference ` +
            `file, found in ${passage.foundIn.length}: ${passage.foundIn.join(', ')}`
        );
      }
    }
  });

  // ── slim-pointer-retained-03 ───────────────────────────────────────────
  registry.define(/^a boot article that lost a passage to a reference file in this fix$/, (ctx) => {
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

  registry.define(/^that slim article is read$/, (ctx) => {
    ctx.slimArticleContents = ctx.slimArticles.map(({ file, refs }) => ({
      file,
      refs,
      content: fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')
    }));
  });

  registry.define(/^it retains a pointer naming the reference file that absorbed the passage$/, (ctx) => {
    const refNames = new Set(referenceFileNames());
    for (const { file, refs, content } of ctx.slimArticleContents) {
      for (const refName of refs) {
        if (!refNames.has(refName)) {
          throw new Error(`${file} points at "${refName}", which does not exist under reference/`);
        }
        if (!content.includes(`**${refName}**`)) {
          throw new Error(`expected the current content of ${file} to retain a pointer naming ${refName}`);
        }
      }
    }
  });

  // ── no-rule-dropped-04 ─────────────────────────────────────────────────
  registry.define(/^the diff of this fix across the constitution tree$/, (ctx) => {
    ctx.allPassages = collectPassages();
  });

  registry.define(/^the removed lines are compared against the added lines$/, (ctx) => {
    ctx.verdicts = ctx.allPassages.map((passage) => {
      if (passage.foundIn.length >= 1) {
        return { passage, preserved: true };
      }
      const ratio = overlapRatio(passage.text, passage.hunkAdded);
      return { passage, preserved: ratio >= REWORD_OVERLAP_THRESHOLD, ratio };
    });
  });

  registry.define(/^every removed normative rule sentence appears in a reference file or remains in its slim article$/, (ctx) => {
    for (const { passage, preserved, ratio } of ctx.verdicts) {
      if (!preserved) {
        throw new Error(
          `expected no rule text dropped in ${passage.file} (overlap ratio ${ratio}): "${passage.text.slice(0, 80)}..."`
        );
      }
    }
  });
}

module.exports = { registerSteps };
