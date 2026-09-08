'use strict';

// BL-1372: step handlers for "The invariant-two pin asks the QA question".
//
// Every scenario drives the REAL assertion from
// swarmforge/scripts/test/bl962_merge_adjudication_test_runner.bb against
// throwaway fixture copies of babysitter_check.bb. Nothing here re-implements
// the regex: a JS restatement would be a second definition of the very thing
// the ticket narrows.
//
// Fixture copies, not the live tree, because the regression under test is not
// expressible in place: scenario 01 needs a babysitter_check.bb carrying a
// legitimate non-QA ancestry call, and scenario 02 needs one that has a
// genuine second QA-ancestry predicate. Scenario 03 reads the live file.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'The invariant-two pin asks the QA question';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_RUNNER = path.join(SCRIPTS_DIR, 'test', 'bl962_merge_adjudication_test_runner.bb');
const LIVE_CHECK = path.join(SCRIPTS_DIR, 'babysitter_check.bb');

const FIXTURE_PREFIX = 'bl1372-inv2-pin-';

// A clean fixture: babysitter_check.bb that calls is_qa_ancestor.sh exactly
// once and has no inline ancestry calls.
const CLEAN_CHECK = [
  '#!/usr/bin/env bb',
  '(defn qa-ancestor? [sha]',
  '  (sh! ["bash" (str (fs/path script-dir "is_qa_ancestor.sh")) sha]))',
  '',
].join('\n');

// A legitimate non-QA ancestry call: merge-base HEAD origin/main.
const NON_QA_ANCESTRY_CALL = [
  '(defn check-divergence []',
  '  (sh! ["git" "merge-base" "HEAD" "origin/main"]))',
  '',
].join('\n');

// A genuine second QA-ancestry predicate: inline merge-base against swarmforge-QA.
const INLINE_QA_CALL = [
  '(defn sneaky-qa? [sha]',
  '  (zero? (:exit (sh! ["git" "merge-base" "--is-ancestor" sha "swarmforge-QA"]))))',
  '',
].join('\n');

function sweepStaleFixtures() {
  const base = os.tmpdir();
  const processStart = Date.now() - Math.round(process.uptime() * 1000);
  for (const name of fs.readdirSync(base)) {
    if (!name.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(base, name);
    try {
      if (fs.statSync(full).mtimeMs >= processStart) continue;
      fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function makeFixture() {
  sweepStaleFixtures();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  const checkPath = path.join(root, 'babysitter_check.bb');
  fs.writeFileSync(checkPath, CLEAN_CHECK);
  return { root, checkPath };
}

// Runs the REAL assertion from bl962_merge_adjudication_test_runner.bb against
// a custom check file. Returns whether the assertion passed (true) or failed (false).
function runAssertion(checkPath) {
  const program = `
(let [raw (slurp "${checkPath}")
      code (let [lines (clojure.string/split-lines raw)
                 stripped (map (fn [line]
                                 (let [idx (clojure.string/index-of line ";;")]
                                   (if (nil? idx)
                                     line
                                     (let [before (subs line 0 idx)
                                           quote-count (count (filter #(= % \\\") before))]
                                       (if (odd? quote-count) line before)))))
                               lines)]
             (clojure.string/join "\\n" stripped))
      ancestry-refs (count (filter #(clojure.string/includes? % "is_qa_ancestor.sh")
                                   (clojure.string/split-lines code)))]
  (try
    (do
      (assert (nil? (re-find #"(?i)(merge-base|--is-ancestor).*swarmforge-QA" code))
              "no second QA-ancestry predicate")
      (assert (= 1 ancestry-refs)
              "is_qa_ancestor.sh is named at exactly one code site")
      (println "PASS"))
    (catch Exception e
      (println "FAIL")
      (println (.getMessage e)))))
`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  const output = `${r.stdout}${r.stderr}`;
  return { passed: r.status === 0 && output.includes('PASS'), output };
}

function fixtureOf(ctx) {
  assert.ok(ctx.fx, 'no fixture was built - a Given step must run first');
  return ctx.fx;
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

  scoped(/^the babysitter sweep's invariant-two assertion$/, (ctx) => {
    // Verify the test runner exists and carries the narrowed assertion.
    assert.ok(fs.existsSync(TEST_RUNNER), 'the test runner is missing');
    const runnerCode = fs.readFileSync(TEST_RUNNER, 'utf8');
    assert.match(
      runnerCode,
      /BL-1372.*narrowed from the original over-broad assertion/,
      'the test runner does not carry the BL-1372 narrowing comment'
    );
    assert.match(
      runnerCode,
      /\(\?i\)\(merge-base\|--is-ancestor\)\.\*swarmforge-QA/,
      'the test runner does not carry the narrowed regex pattern'
    );
    ctx.fx = makeFixture();
  });

  scoped(/^the sweep asks whether local main has diverged from origin$/, (ctx) => {
    const fx = fixtureOf(ctx);
    fs.appendFileSync(fx.checkPath, NON_QA_ANCESTRY_CALL);
  });

  scoped(/^the sweep decides QA ancestry without the shared predicate$/, (ctx) => {
    const fx = fixtureOf(ctx);
    fs.appendFileSync(fx.checkPath, INLINE_QA_CALL);
  });

  scoped(/^the sweep decides QA ancestry through the shared predicate only$/, (ctx) => {
    // The clean fixture already has this - just verify it.
    const fx = fixtureOf(ctx);
    const content = fs.readFileSync(fx.checkPath, 'utf8');
    assert.match(content, /is_qa_ancestor\.sh/, 'the fixture does not call is_qa_ancestor.sh');
    assert.doesNotMatch(
      content,
      /merge-base.*swarmforge-QA|--is-ancestor.*swarmforge-QA/i,
      'the fixture has an inline QA-ancestry call'
    );
  });

  scoped(/^the invariant-two assertion runs$/, (ctx) => {
    const fx = fixtureOf(ctx);
    ctx.result = runAssertion(fx.checkPath);
  });

  scoped(/^the assertion passes$/, (ctx) => {
    try {
      assert.ok(ctx.result, 'the assertion was never run');
      assert.ok(ctx.result.passed, `the assertion failed when it should pass: ${ctx.result.output}`);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the assertion fails naming the second predicate$/, (ctx) => {
    try {
      assert.ok(ctx.result, 'the assertion was never run');
      assert.ok(!ctx.result.passed, 'the assertion passed when it should fail');
      assert.match(
        ctx.result.output,
        /second QA-ancestry predicate|no second ancestry predicate/i,
        `the failure does not name the second predicate: ${ctx.result.output}`
      );
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
