'use strict';

// BL-1314: step handlers for "The invariant-2 assertion fires on the QA
// question, not on ancestry in general".
//
// Every scenario drives the REAL predicate - `inv2_qa_definition_violations`
// from swarmforge/scripts/invariant2_qa_definition_lib.sh, sourced in bash -
// against throwaway fixture copies of the two files it judges. Nothing here
// re-implements the greps: a JS restatement would be a second definition of
// the very thing invariant 2 is about, and could not exhibit the defect this
// ticket fixes.
//
// Fixture copies, not the live tree, because the regression under test is not
// expressible in place: scenario 01 needs a handoffd.bb carrying an ancestry
// helper for an unrelated question, and scenarios 02-03 need one that is
// broken on purpose. Scenario 04 is the one that reads the live files.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'The invariant-2 assertion fires on the QA question, not on ancestry in general';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS_DIR, 'invariant2_qa_definition_lib.sh');
const LIVE_GUARD = path.join(SCRIPTS_DIR, 'check_pipeline_code_on_main.sh');
const LIVE_HANDOFFD = path.join(SCRIPTS_DIR, 'handoffd.bb');
const STANDING_TEST = path.join(SCRIPTS_DIR, 'test', 'test_pipeline_code_on_main_guard.sh');
const SHARED_DEFINITION = 'is_qa_ancestor.sh';

const FIXTURE_PREFIX = 'bl1314-inv2-';

// The two files the assertion judges, by the basenames the feature names.
const JUDGED_FILES = {
  'handoffd.bb': 'handoffd',
  'check_pipeline_code_on_main.sh': 'guard',
};

// The helpers scenario 01's Examples table names, each quoted from
// handoffd.bb as it stands, with the ref pair it actually asks about. An
// unknown <helper> row is a hard failure, never a passthrough (Scenario
// Outline handler rule) - and the question column is checked against the
// same table, so a row whose prose and code disagree fails too.
const OTHER_QUESTION_HELPERS = {
  'master-main-origin-is-ancestor?': {
    question: 'whether origin/main is an ancestor of HEAD',
    body: [
      '(defn master-main-origin-is-ancestor? []',
      '  (zero? (:exit (sh! ["git" "merge-base" "--is-ancestor" "origin/main" "HEAD"]))))',
    ].join('\n'),
  },
  'git-is-ancestor?': {
    question: 'whether a role branch can fast-forward to the landed commit',
    body: [
      '(defn git-is-ancestor? [dir ancestor descendant]',
      '  (zero? (:exit (sh! ["git" "merge-base" "--is-ancestor" ancestor descendant] {:dir dir}))))',
    ].join('\n'),
  },
};

// A clean fixture pair: each file reaches the QA question through the one
// shared script and neither re-answers it inline.
const CLEAN_GUARD = [
  '#!/usr/bin/env bash',
  'if bash "$SCRIPT_DIR/is_qa_ancestor.sh" "$sha"; then',
  '  echo approved',
  'fi',
  '',
].join('\n');

const CLEAN_HANDOFFD = [
  '#!/usr/bin/env bb',
  '(defn qa-ancestor? [sha]',
  '  (sh! ["bash" (str (fs/path script-dir "is_qa_ancestor.sh")) sha]))',
  '',
].join('\n');

// The inline second answer to the QA question, in each file's own idiom.
const INLINE_QA_CALL = {
  'handoffd.bb': [
    '(defn sneaky-qa? [sha]',
    '  (zero? (:exit (sh! ["git" "merge-base" "--is-ancestor" sha "swarmforge-QA"]))))',
    '',
  ].join('\n'),
  'check_pipeline_code_on_main.sh': 'git merge-base --is-ancestor "$SHA" swarmforge-QA\n',
};

function sweepStaleFixtures() {
  const base = os.tmpdir();
  const processStart = Date.now() - Math.round(process.uptime() * 1000);
  for (const name of fs.readdirSync(base)) {
    if (!name.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(base, name);
    try {
      // Only roots older than this process: a live sibling fixture must
      // never be swept out from under a concurrent scenario.
      if (fs.statSync(full).mtimeMs >= processStart) continue;
      fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // best-effort - a live run removes its own root in its own cleanup
    }
  }
}

function makeFixture() {
  sweepStaleFixtures();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  const files = {
    guard: path.join(root, 'check_pipeline_code_on_main.sh'),
    handoffd: path.join(root, 'handoffd.bb'),
  };
  fs.writeFileSync(files.guard, CLEAN_GUARD);
  fs.writeFileSync(files.handoffd, CLEAN_HANDOFFD);
  return { root, files };
}

// Runs the REAL predicate. Returns its exit status and everything it printed,
// so a scenario can assert both that it fired and which file it named.
function runPredicate(guardPath, handoffdPath) {
  const script = [
    `source ${JSON.stringify(LIB)}`,
    `inv2_qa_definition_violations ${JSON.stringify(guardPath)} ${JSON.stringify(handoffdPath)}`,
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

function fixtureOf(ctx) {
  assert.ok(ctx.fx, 'no fixture was built - a Given step must run first');
  return ctx.fx;
}

function assertJudgedFile(name) {
  assert.ok(
    Object.prototype.hasOwnProperty.call(JUDGED_FILES, name),
    `unknown file "${name}" - the assertion judges ${JSON.stringify(Object.keys(JUDGED_FILES))}`
  );
  return JUDGED_FILES[name];
}

function cleanup(ctx) {
  if (ctx.fx && ctx.fx.root) {
    try {
      fs.rmSync(ctx.fx.root, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  ctx.fx = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the invariant-2 assertion in "([^"]+)"$/, (ctx, testPath) => {
    assert.equal(
      testPath,
      'swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh',
      'the feature names a different standing test than the one that carries the pin'
    );
    // The pin's live-tree run still lives in the standing test, and the
    // standing test still calls the extracted predicate - the wiring that
    // keeps the assertion reachable by the standing suite.
    const standing = fs.readFileSync(STANDING_TEST, 'utf8');
    assert.match(
      standing,
      /source "\$SCRIPT_DIR\/\.\.\/invariant2_qa_definition_lib\.sh"/,
      'the standing test no longer sources the invariant-2 predicate'
    );
    assert.match(
      standing,
      /inv2_qa_definition_violations "\$GUARD" "\$HANDOFFD"/,
      'the standing test no longer runs the invariant-2 predicate against the live tree'
    );
    ctx.fx = makeFixture();
  });

  scoped(/^the shared QA-ancestry definition "([^"]+)"$/, (ctx, sharedPath) => {
    assert.equal(sharedPath, 'swarmforge/scripts/is_qa_ancestor.sh', 'unexpected shared-definition path');
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, sharedPath)),
      `the one shared definition is missing: ${sharedPath}`
    );
  });

  scoped(/^"([^"]+)" reaches the QA-approved-tip question through "([^"]+)"$/, (ctx, file, shared) => {
    const key = assertJudgedFile(file);
    assert.equal(shared, SHARED_DEFINITION, `unexpected shared definition "${shared}"`);
    const fx = fixtureOf(ctx);
    assert.match(
      fs.readFileSync(fx.files[key], 'utf8'),
      new RegExp(SHARED_DEFINITION.replace('.', '\\.')),
      `the ${file} fixture does not reach the QA question through ${shared}`
    );
  });

  scoped(/^handoffd\.bb also defines "([^"]+)", which asks (.+)$/, (ctx, helper, question) => {
    const known = OTHER_QUESTION_HELPERS[helper];
    assert.ok(
      known,
      `unknown <helper> "${helper}" - the handlers know ${JSON.stringify(Object.keys(OTHER_QUESTION_HELPERS))}`
    );
    assert.equal(
      question.trim(),
      known.question,
      `the Examples table's question for "${helper}" disagrees with the handler's known-value table`
    );
    // The helper asks about a ref pair that is NOT the QA question - that is
    // the whole point, so assert it rather than trusting the prose column.
    assert.ok(
      !known.body.includes('swarmforge-QA'),
      `"${helper}" mentions swarmforge-QA - it would be a genuine second definition, not another question`
    );
    const fx = fixtureOf(ctx);
    fs.appendFileSync(fx.files.handoffd, `${known.body}\n`);
  });

  scoped(/^"([^"]+)" also runs its own inline ancestry call against "swarmforge-QA"$/, (ctx, file) => {
    const key = assertJudgedFile(file);
    const fx = fixtureOf(ctx);
    fs.appendFileSync(fx.files[key], INLINE_QA_CALL[file]);
  });

  scoped(/^"([^"]+)" no longer calls "([^"]+)" at all$/, (ctx, file, shared) => {
    const key = assertJudgedFile(file);
    assert.equal(shared, SHARED_DEFINITION, `unexpected shared definition "${shared}"`);
    const fx = fixtureOf(ctx);
    const stripped = fs
      .readFileSync(fx.files[key], 'utf8')
      .split('\n')
      .filter((l) => !l.includes(SHARED_DEFINITION))
      .join('\n');
    fs.writeFileSync(fx.files[key], stripped);
  });

  scoped(/^handoffd\.bb and check_pipeline_code_on_main\.sh exactly as they stand on main$/, (ctx) => {
    // The live files, not fixtures: the case the standing suite runs.
    cleanup(ctx);
    ctx.liveTree = true;
  });

  scoped(/^the invariant-2 assertion runs$/, (ctx) => {
    if (ctx.liveTree) {
      ctx.result = runPredicate(LIVE_GUARD, LIVE_HANDOFFD);
      return;
    }
    const fx = fixtureOf(ctx);
    ctx.result = runPredicate(fx.files.guard, fx.files.handoffd);
  });

  scoped(/^the assertion passes$/, (ctx) => {
    try {
      assert.ok(ctx.result, 'the assertion was never run');
      assert.equal(
        ctx.result.status,
        0,
        `the assertion reported a violation that does not exist: ${ctx.result.output}`
      );
      assert.equal(ctx.result.output, '', `a passing assertion printed output: ${ctx.result.output}`);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the assertion fails$/, (ctx) => {
    assert.ok(ctx.result, 'the assertion was never run');
    assert.notEqual(ctx.result.status, 0, 'the assertion passed where it must fail');
    assert.match(ctx.result.output, /BL-925 invariant 2/, `the failure is not an invariant-2 failure: ${ctx.result.output}`);
  });

  scoped(/^the failure names "([^"]+)"$/, (ctx, file) => {
    try {
      assertJudgedFile(file);
      assert.ok(
        ctx.result.output.includes(file),
        `the failure does not name ${file}: ${ctx.result.output}`
      );
      // ...and does not blame the other file for this one's defect.
      const other = Object.keys(JUDGED_FILES).find((f) => f !== file);
      assert.ok(
        !ctx.result.output.includes(other),
        `the failure also names ${other}, which is intact: ${ctx.result.output}`
      );
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
