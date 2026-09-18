'use strict';

// BL-1633: step handlers for "A new pole is confirmed alone before the
// per-file gate refuses". Scenarios 01-02 drive the REAL
// checkFileDurationBudget (BL-1598, extended here with the optional
// confirmAlone argument) against fixture reports and a recording fake
// confirmer - the same "pure decision, fake seam" idiom BL-1598's own
// handler uses. Scenarios 03-04 drive the REAL exported confirmer
// (recordTestDuration.js's confirmPoleAlone) and the REAL register, never
// a re-statement of either.
//
// NOTE (invariant 1 applies to this file too): everything below binds at
// step-execution time - module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT = path.join(REPO_ROOT, 'extension');
const OUT_DIR = path.join(EXT, 'out');
const {
  checkFileDurationBudget,
  parseRegisterRows,
  PER_FILE_DURATION_BUDGET_MS,
  NEW_POLE_REFUSAL_FRACTION,
} = require(path.join(OUT_DIR, 'tools', 'check-suite-file-budget'));
const { confirmPoleAlone } = require(path.join(EXT, 'scripts', 'recordTestDuration.js'));

const FEATURE = 'BL-1633 A new pole is confirmed alone before the per-file gate refuses';

const REFUSAL_THRESHOLD_MS = PER_FILE_DURATION_BUDGET_MS * NEW_POLE_REFUSAL_FRACTION;

// The single file this ticket's own register-row removal is about
// (scenario 04) - a constant, never re-derived, the same "future signal
// this handler needs updating" reasoning BL-1620's own handler states for
// its own single-file constant. REPO-ROOT relative (the register's own
// path shape, and confirmPoleAlone's real, non-absolute convention -
// recordTestDuration.js's own REPO_ROOT_DIR comment).
const TARGET_REPO_REL_FILE = 'extension/test/telegramFrontDeskBotCli.test.js';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // -- Scenario 01 (Outline) + shared fixture-building steps ---------------

  scoped(
    /^a per-file duration report where (.+) measures (\d+) ms in-suite, at or above the refusal line$/,
    (ctx, file, ms) => {
      const durationMs = Number(ms);
      assert.ok(
        durationMs >= REFUSAL_THRESHOLD_MS,
        `fixture error: ${durationMs} is not at or above the refusal line (${REFUSAL_THRESHOLD_MS})`
      );
      ctx.bl1633Durations = ctx.bl1633Durations || [];
      ctx.bl1633Durations.push({ file, durationMs });
    }
  );

  scoped(
    /^a per-file duration report where (.+) measures (\d+) ms in-suite, under the refusal line$/,
    (ctx, file, ms) => {
      const durationMs = Number(ms);
      assert.ok(
        durationMs < REFUSAL_THRESHOLD_MS,
        `fixture error: ${durationMs} is not under the refusal line (${REFUSAL_THRESHOLD_MS})`
      );
      ctx.bl1633Durations = ctx.bl1633Durations || [];
      ctx.bl1633Durations.push({ file, durationMs });
    }
  );

  scoped(/^backlog\/suite-poles\.tsv names (.+) under an open ticket$/, (ctx, file) => {
    ctx.bl1633Register = ctx.bl1633Register || [];
    ctx.bl1633OpenTickets = ctx.bl1633OpenTickets || new Set();
    ctx.bl1633Register.push({ file, ticket: 'BL-1', firstSeen: '2026-01-01', measuredMs: 15000, note: 'fixture' });
    ctx.bl1633OpenTickets.add('BL-1');
  });

  scoped(/^a confirmer that measures (.+) alone at (\d+) ms$/, (ctx, file, ms) => {
    const aloneMs = Number(ms);
    ctx.bl1633ConfirmCalls = [];
    ctx.bl1633Confirm = (f) => {
      ctx.bl1633ConfirmCalls.push(f);
      return f === file ? aloneMs : null;
    };
  });

  scoped(
    /^a confirmer that measures (.+) alone at (\d+) ms, never finishes for (.+), and records every file it is asked to measure$/,
    (ctx, okFile, ms, timeoutFile) => {
      const aloneMs = Number(ms);
      ctx.bl1633ConfirmCalls = [];
      ctx.bl1633Confirm = (f) => {
        ctx.bl1633ConfirmCalls.push(f);
        if (f === timeoutFile) return null; // BL-1633's own timeout sentinel
        return f === okFile ? aloneMs : null;
      };
    }
  );

  scoped(/^the per-file budget guard runs with the confirmer$/, (ctx) => {
    ctx.bl1633Verdict = checkFileDurationBudget(
      ctx.bl1633Durations,
      PER_FILE_DURATION_BUDGET_MS,
      ctx.bl1633Register || [],
      ctx.bl1633OpenTickets || new Set(),
      ctx.bl1633Confirm
    );
  });

  scoped(
    /^the verdict is (contention|new-pole) and the run (passes|is refused), naming both durations when the verdict is contention$/,
    (ctx, verdict, outcome) => {
      assert.equal(ctx.bl1633Verdict.verdict, verdict, `expected verdict ${verdict}, got ${ctx.bl1633Verdict.verdict}`);
      assert.equal(ctx.bl1633Verdict.passed, outcome === 'passes');
      if (verdict === 'contention') {
        assert.equal(ctx.bl1633Verdict.contention.length, 1);
        const c = ctx.bl1633Verdict.contention[0];
        assert.ok(c.durationMs > 0, 'contention entry must name the in-suite duration');
        assert.ok(c.aloneMs > 0, 'contention entry must name the alone duration');
        assert.equal(ctx.bl1633Verdict.offenders.length, 0);
      } else {
        assert.equal(ctx.bl1633Verdict.offenders.length, 1);
        assert.equal(ctx.bl1633Verdict.contention.length, 0);
      }
    }
  );

  // -- Scenario 02 -----------------------------------------------------------

  scoped(/^the confirmer is never asked about (.+) or (.+)$/, (ctx, a, b) => {
    assert.ok(!ctx.bl1633ConfirmCalls.includes(a), `confirmer must not have been asked about ${a}`);
    assert.ok(!ctx.bl1633ConfirmCalls.includes(b), `confirmer must not have been asked about ${b}`);
  });

  scoped(/^the confirmer is asked about (.+) exactly once$/, (ctx, file) => {
    const count = ctx.bl1633ConfirmCalls.filter((f) => f === file).length;
    assert.equal(count, 1, `expected ${file} confirmed exactly once, got ${count}`);
  });

  scoped(/^(.+) is a new-pole, refused exactly as today$/, (ctx, file) => {
    assert.ok(
      ctx.bl1633Verdict.offenders.some((o) => o.file === file),
      `expected ${file} reported as a new-pole offender`
    );
    assert.equal(ctx.bl1633Verdict.passed, false);
  });

  // -- Scenario 03 -------------------------------------------------------------

  scoped(/^a fixture test file that sleeps 200 ms, not under extension\/test\/$/, (ctx) => {
    // BL-1390 fixture rules: a mkdtemp root outside the tracked test tree,
    // never a file under extension/test/ that npm test's own real run
    // would then also discover.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1633-fixture-'));
    ctx.bl1633FixtureDir = tmpDir;
    ctx.bl1633FixtureFile = path.join(tmpDir, 'fixture.test.js');
    fs.writeFileSync(
      ctx.bl1633FixtureFile,
      "test('sleeps 200ms', async () => { await new Promise((r) => setTimeout(r, 200)); });\n"
    );
  });

  scoped(/^the recorder's real confirmer measures it alone$/, (ctx) => {
    try {
      ctx.bl1633ConfirmedMs = confirmPoleAlone(ctx.bl1633FixtureFile);
    } finally {
      fs.rmSync(ctx.bl1633FixtureDir, { recursive: true, force: true });
    }
  });

  scoped(/^it returns a duration at least 200 ms and under the per-file budget$/, (ctx) => {
    assert.ok(ctx.bl1633ConfirmedMs !== null, 'expected a real measured duration, not null (timeout/failure)');
    assert.ok(ctx.bl1633ConfirmedMs >= 200, `expected at least 200ms, got ${ctx.bl1633ConfirmedMs}`);
    assert.ok(
      ctx.bl1633ConfirmedMs < PER_FILE_DURATION_BUDGET_MS,
      `expected under the ${PER_FILE_DURATION_BUDGET_MS}ms budget, got ${ctx.bl1633ConfirmedMs}`
    );
  });

  // -- Scenario 04 ---------------------------------------------------------------

  scoped(/^extension\/test\/telegramFrontDeskBotCli\.test\.js at the parcel's own commit$/, (ctx) => {
    ctx.bl1633RepoRelFile = TARGET_REPO_REL_FILE;
  });

  scoped(/^it runs alone once under the real vitest$/, (ctx) => {
    ctx.bl1633Ms = confirmPoleAlone(ctx.bl1633RepoRelFile);
  });

  scoped(/^it measures under 7000 ms$/, (ctx) => {
    assert.ok(
      ctx.bl1633Ms !== null && ctx.bl1633Ms < PER_FILE_DURATION_BUDGET_MS,
      `expected under the ${PER_FILE_DURATION_BUDGET_MS}ms budget, got ${ctx.bl1633Ms}`
    );
  });

  scoped(/^backlog\/suite-poles\.tsv has no row for it$/, (ctx) => {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'backlog', 'suite-poles.tsv'), 'utf8');
    const rows = parseRegisterRows(text);
    assert.ok(
      !rows.some((r) => r.file === ctx.bl1633RepoRelFile),
      `expected no backlog/suite-poles.tsv row for ${ctx.bl1633RepoRelFile}`
    );
  });

  scoped(/^every other row in backlog\/suite-poles\.tsv is byte-identical to main$/, (ctx) => {
    const currentText = fs.readFileSync(path.join(REPO_ROOT, 'backlog', 'suite-poles.tsv'), 'utf8');
    const mainText = execFileSync('git', ['show', `main:backlog/suite-poles.tsv`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const withoutTargetRow = (text) =>
      text
        .split('\n')
        .filter((line) => !line.includes(ctx.bl1633RepoRelFile))
        .join('\n');
    assert.equal(
      withoutTargetRow(currentText),
      withoutTargetRow(mainText),
      'every row other than the removed one must be byte-identical to main'
    );
  });

  // BL-1006 (both amendments): this parcel retires a scenario in each of
  // two sibling features whose premise it falsifies (BL-1620's own row,
  // BL-1598's census count) - both read the REAL committed feature file,
  // never a re-statement of its content.
  function featureScenarioTags(text) {
    return [...text.matchAll(/^\s*# BL-\d+ ([\w-]+)$/gm)].map((m) => m[1]);
  }

  scoped(
    /^BL-1620's feature at the parcel carries scenarios two-unit-lane-poles-01 and -03 only, its narrative stating the register row's fate in the past$/,
    () => {
      const text = fs.readFileSync(
        path.join(REPO_ROOT, 'specs', 'features', 'BL-1620-two-unit-lane-poles-come-under-the-per-file-budget.feature'),
        'utf8'
      );
      assert.deepEqual(
        featureScenarioTags(text),
        ['two-unit-lane-poles-01', 'two-unit-lane-poles-03'],
        'expected BL-1620\'s feature to carry only scenarios 01 and 03 (02 retired)'
      );
      assert.match(
        text,
        /register row stayed, re-owned by BL-1633, until BL-1633 retired it/,
        'expected BL-1620\'s narrative to state the row\'s fate in the past tense'
      );
      assert.doesNotMatch(text, /register row stays, re-owned by BL-1633 \(/, 'expected the present-tense narrative to be gone');
    }
  );

  scoped(
    /^BL-1598's feature at the parcel carries scenarios unit-suite-pole-register-01 and -02 only, its narrative stating the 2026-09-16 census in the past$/,
    () => {
      const text = fs.readFileSync(
        path.join(
          REPO_ROOT,
          'specs',
          'features',
          'BL-1598-the-unit-suite-pole-register-makes-the-per-file-gate-green.feature'
        ),
        'utf8'
      );
      assert.deepEqual(
        featureScenarioTags(text),
        ['unit-suite-pole-register-01', 'unit-suite-pole-register-02'],
        'expected BL-1598\'s feature to carry only scenarios 01 and 02 (03 retired)'
      );
      assert.match(
        text,
        /nine\s+poles measured on 2026-09-16 were registered with an open owner/,
        'expected BL-1598\'s narrative to state the census in the past tense'
      );
      assert.doesNotMatch(
        text,
        /nine\s+poles measured on 2026-09-16 are registered with an open owner/,
        'expected the present-tense narrative to be gone'
      );
    }
  );
}

module.exports = { registerSteps };
