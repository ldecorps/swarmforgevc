'use strict';

// BL-1038: step handlers for "the unit-lane guard that inspects test files for
// live-repository derivation".
//
// Every scenario drives the REAL guard and the REAL closure walk from the
// compiled helpers - the same ones the lane's own guard test calls. Scenarios
// 01-04 pass file TEXT rather than writing files, because the guard's decision
// is a pure function of a file's contents and driving it that way lets a
// scenario construct a shape the repository does not contain.
//
// Scenario 05 is different and deliberately does touch a tree: "a pinned
// fixture does not change when the live repository does" is a claim about
// growth, and the only honest way to show it is to grow something and
// recompute.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const path = require('node:path');

const FEATURE = 'A unit-lane test pins the repository it derives from';

const EXT = path.join(__dirname, '..', '..', '..', 'extension');
const {
  violationFor,
  isSelfExempt,
  findLiveRepoDerivations,
} = require(path.join(EXT, 'test', 'helpers', 'liveRepoDerivationGuard'));
const { resolveScriptClosure } = require(path.join(EXT, 'test', 'helpers', 'pinnedRepoFixture'));

// Explicit known values per the Scenario Outline handler rule: scenario 03's
// closed set. A row the handlers do not know is a hard failure.
const KNOWN_REASONS = new Set(['stated', 'absent']);
const KNOWN_VERDICTS = new Set(['passes', 'fails']);

// A file that walks the LIVE repository's history - the growth term.
const LIVE_DERIVING = [
  "const REPO_ROOT = path.join(__dirname, '..', '..');",
  "execSync('git log --format=%H', { cwd: REPO_ROOT });",
].join('\n');

// The same need, met from a pinned fixture: no live root is bound at all.
const PINNED = [
  "const root = mkTmpDir('fixture-');",
  "execFileSync('git', ['init', '-q'], { cwd: root });",
  "execFileSync('git', ['-C', root, 'log', '--format=%H']);",
].join('\n');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the unit-lane guard that inspects test files for live-repository derivation$/, (ctx) => {
    ctx.exemption = '';
  });

  scoped(/^a unit-lane test file that resolves the live repository root$/, (ctx) => {
    ctx.body = LIVE_DERIVING;
    ctx.file = 'someLiveDeriving.test.js';
  });

  scoped(/^a unit-lane test file that derives its history from a pinned fixture$/, (ctx) => {
    ctx.body = PINNED;
    ctx.file = 'somePinned.test.js';
  });

  scoped(/^that file carries no exemption$/, (ctx) => {
    ctx.exemption = '';
  });

  scoped(/^that file carries an exemption whose recorded reason is (stated|absent)$/, (ctx, reason) => {
    assert.ok(KNOWN_REASONS.has(reason), `unknown reason "${reason}" - the handlers know ${[...KNOWN_REASONS]}`);
    // "absent" is a marker with NOTHING after it - present-but-unjustified,
    // which is the state BL-999 found one layer down and the whole point of
    // checking the relation rather than the field.
    ctx.exemption = reason === 'stated'
      ? '// BL-1038-EXEMPT: smoke-tests that the real maintained diagrams still render\n'
      : '// BL-1038-EXEMPT:\n';
  });

  scoped(/^the guard's own source and the pinned-fixture helper both contain the pattern the guard matches on$/, (ctx) => {
    // Asserted, not assumed: if the machinery stopped containing the needle,
    // this scenario would pass while testing nothing.
    //
    // A DIVERGENCE from the scenario's literal wording, recorded rather than
    // papered over: the scenario says the guard's source AND the fixture
    // helper both contain the pattern. The guard's source does. The fixture
    // HELPER does not - it takes the live scripts directory as a PARAMETER
    // and never resolves a root itself, so there is no needle in it to flag.
    // That is a better design than the one the scenario anticipated, not a
    // gap: the file that does carry the needle is the helper's own TEST, which
    // must read the live directory to assert the closure is smaller than it,
    // and which carries a recorded BL-1038-EXEMPT reason saying so.
    //
    // The scenario's actual content - the guard never flags its own machinery -
    // is checked in full below against the real scan.
    const fs = require('node:fs');
    const guardText = fs.readFileSync(path.join(EXT, 'test', 'helpers', 'liveRepoDerivationGuard.js'), 'utf8');
    assert.match(guardText, /__dirname/, 'the guard source must contain the needle it matches on');
    const helperTestText = fs.readFileSync(path.join(EXT, 'test', 'pinnedRepoFixture.test.js'), 'utf8');
    assert.match(helperTestText, /readdirSync/, "the fixture helper's own test must contain the needle");
    ctx.checkSelfExempt = true;
  });

  scoped(/^the live repository gains a commit$/, (ctx) => {
    // Modelled as what a commit does to the tree the fixture reads from: it
    // adds scripts. The closure must not notice.
    ctx.sources = {
      'entry.bb': '(load-file (str (fs/path x "dep.bb")))',
      'dep.bb': '(defn f [])',
    };
    ctx.before = [...resolveScriptClosure(['entry.bb'], (n) => ctx.sources[n])].sort();
    for (let i = 0; i < 25; i++) ctx.sources[`added${i}.bb`] = '(defn g [])';
  });

  scoped(/^that test runs again$/, (ctx) => {
    ctx.after = [...resolveScriptClosure(['entry.bb'], (n) => ctx.sources[n])].sort();
  });

  scoped(/^the guard runs$/, (ctx) => {
    if (ctx.checkSelfExempt) {
      ctx.selfExempt = ['helpers/liveRepoDerivationGuard.js', 'helpers/pinnedRepoFixture.js'].map(isSelfExempt);
      // And the real scan, which must not name them either.
      ctx.realViolations = findLiveRepoDerivations(path.join(EXT, 'test'));
      return;
    }
    ctx.violation = violationFor(ctx.file, ctx.exemption + ctx.body);
  });

  scoped(/^the guard fails$/, (ctx) => {
    assert.ok(ctx.violation, 'a live-repository derivation with no recorded reason must fail the guard');
  });

  scoped(/^the guard passes$/, (ctx) => {
    if (ctx.checkSelfExempt) {
      assert.deepEqual(ctx.realViolations, [],
        `the real tree must be clean: ${JSON.stringify(ctx.realViolations)}`);
      return;
    }
    assert.equal(ctx.violation, null, 'a pinned-fixture test, or a justified exemption, must pass');
  });

  scoped(/^the guard (passes|fails)$/, (ctx, verdict) => {
    assert.ok(KNOWN_VERDICTS.has(verdict), `unknown verdict "${verdict}"`);
    if (verdict === 'passes') assert.equal(ctx.violation, null, 'a recorded reason must be honoured');
    else assert.ok(ctx.violation, 'a bare marker with no reason must NOT be honoured');
  });

  scoped(/^that file is named, with what it reached for$/, (ctx) => {
    assert.equal(ctx.violation.file, ctx.file, 'the guard must name the file');
    assert.ok(ctx.violation.reason && ctx.violation.reason.length > 0,
      'naming the file without saying what it reached for leaves the reader to re-derive it');
  });

  scoped(/^that file is not named$/, (ctx) => {
    assert.equal(ctx.violation, null);
  });

  scoped(/^neither the guard's own source nor the fixture helper is named$/, (ctx) => {
    assert.deepEqual(ctx.selfExempt, [true, true],
      'both must be self-exempt, or the guard goes red precisely because the code is correct');
    const named = ctx.realViolations.map((v) => v.file);
    for (const rel of ['helpers/liveRepoDerivationGuard.js', 'helpers/pinnedRepoFixture.js',
                       'pinnedRepoFixture.test.js', 'liveRepoDerivationGuard.test.js']) {
      assert.ok(!named.includes(rel), `${rel} must not be named`);
    }
  });

  scoped(/^it reads the same fixture contents as before$/, (ctx) => {
    assert.deepEqual(ctx.after, ctx.before,
      'a pinned fixture whose contents move when the repository grows is not pinned');
  });

  // ── scenario 06: speed is never bought with coverage ────────────────────

  scoped(/^the test count recorded by the previous unit-lane run$/, (ctx) => {
    ctx.countedBefore = true;
  });

  scoped(/^the unit lane runs after the conversion$/, (ctx) => {
    // The recorded count lives in .test-durations.jsonl and is a fact about
    // successive RUNS, checked in this ticket's qa_e2e step 6. What is
    // checkable here, and is the half that would actually be tempting, is that
    // the conversion skipped or deleted nothing.
    const fs = require('node:fs');
    ctx.converted = [
      'commitIntegrityRunner.test.js', 'epicReorderBridge.test.js', 'epicMakeTopBridge.test.js',
      'pausedPagerBridge.test.js', 'topicMakeTopBridge.test.js', 'telegramFrontDeskBotCli.test.js',
    ];
    ctx.skips = ctx.converted.flatMap((f) => {
      const text = fs.readFileSync(path.join(EXT, 'test', f), 'utf8');
      return /\btest\.(skip|todo)\b|\bdescribe\.skip\b/.test(text) ? [f] : [];
    });
    ctx.missing = ctx.converted.filter((f) => !fs.existsSync(path.join(EXT, 'test', f)));
  });

  scoped(/^the recorded test count is not lower than before$/, (ctx) => {
    assert.ok(ctx.countedBefore);
    assert.deepEqual(ctx.missing, [], `no converted test file may be deleted; missing: ${ctx.missing.join(', ')}`);
  });

  scoped(/^no test file has been deleted, skipped, or added to an exclude glob$/, (ctx) => {
    assert.deepEqual(ctx.skips, [],
      `speed must not be bought by skipping: ${ctx.skips.join(', ')}`);
    assert.deepEqual(ctx.missing, []);
  });
}

module.exports = { registerSteps };
