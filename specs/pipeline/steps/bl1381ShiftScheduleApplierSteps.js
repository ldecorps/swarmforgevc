'use strict';

// BL-1381: the shift schedule applier loads, and its install wrapper fails
// loud.
//
// `shift_schedule_applier_lib.bb` required babashka.process INSIDE a function
// body. SCI resolves an alias at ANALYSIS time, so the whole file failed to
// load and every consumer died at load rather than at the governor call: the
// reconcile CLI every ./swarm start runs, the fixture applier, and the BL-660
// runner that guards this very library - red from 2026-08-27 with nobody told,
// because the standing bb suite gates no commit.
//
// Every scenario drives the REAL lib, the REAL install wrapper and the REAL
// BL-660 runner through lib/bl1381ShiftScheduleCli.sh. The crontab is ALWAYS a
// fixture file behind a shim on PATH - the scripts under test install into a
// real crontab, and the ticket requires explicitly that no test touch the live
// one.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1381ShiftScheduleCli.sh');
const FIXTURE_PREFIX = 'bl1381-acc-';

const FEATURE = 'BL-1381 The shift schedule applier loads and its install wrapper fails loud';

// The Examples' own words, mapped to the fixture shape each is built as.
// Explicit KNOWN_VALUES: an unrecognised row throws rather than passing
// through unchecked.
const GOVERNOR_CLI = {
  'present and prints a pass': 'governor-present',
  absent: 'governor-absent',
};

const GOVERNOR_VERDICT = {
  'the parsed pass': 'pass',
  none: null,
};

const RECONCILE_BEHAVIOUR = {
  'exits non-zero printing nothing': 'reconcile-empty',
  'exits zero printing text that is not JSON': 'reconcile-notjson',
};

function sweepFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

function runFixture(shape) {
  sweepFixtures();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  try {
    const out = execFileSync('bash', [FIXTURE_CLI, work, shape], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 600_000,
    });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a fixture project root with the swarmforge scripts$/, (ctx) => {
    ctx.bl1381 = {};
  });

  scoped(/^a crontab shim that reads and writes a fixture crontab file$/, (ctx) => {
    // Asserted after the run: the shim is what makes every scenario safe to
    // execute at all, so its effect is checked rather than assumed.
    ctx.bl1381.fixtureCrontab = true;
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the fixture conf sets swarm_shift to "day"$/, (ctx) => {
    ctx.bl1381.shape = 'configured-shift';
  });

  scoped(/^the fixture crontab holds one line that is not the swarm's$/, (ctx) => {
    ctx.bl1381.foreignLine = '/usr/bin/true';
  });

  scoped(/^the budget governor CLI is (.+)$/, (ctx, cli) => {
    const shape = GOVERNOR_CLI[cli.trim()];
    assert.ok(shape, `unknown governor CLI state: ${cli}`);
    ctx.bl1381.shape = shape;
  });

  scoped(/^the reconcile step (.+)$/, (ctx, behaviour) => {
    const shape = RECONCILE_BEHAVIOUR[behaviour.trim()];
    assert.ok(shape, `unknown reconcile behaviour: ${behaviour}`);
    ctx.bl1381.shape = shape;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the shift schedule applier library is loaded by babashka$/, (ctx) => {
    ctx.bl1381.shape = 'lib-loads';
    ctx.bl1381.report = runFixture('lib-loads');
  });

  scoped(/^the schedule cron is installed for the fixture root$/, (ctx) => {
    assert.ok(ctx.bl1381.shape, 'no fixture shape was chosen');
    ctx.bl1381.report = runFixture(ctx.bl1381.shape);
  });

  scoped(/^the budget shift governor verdict is requested for now$/, (ctx) => {
    assert.ok(ctx.bl1381.shape, 'no fixture shape was chosen');
    ctx.bl1381.report = runFixture(ctx.bl1381.shape);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^loading succeeds$/, (ctx) => {
    assert.match(
      ctx.bl1381.report.out,
      /LOADED/,
      `the lib did not load: ${ctx.bl1381.report.out}`
    );
    // The exact crash this ticket exists for, named so a regression is
    // recognisable rather than merely red.
    assert.ok(
      !/Unable to resolve symbol: process\/shell/.test(ctx.bl1381.report.out),
      `the analysis-time crash is back: ${ctx.bl1381.report.out}`
    );
  });

  scoped(/^the BL-660 unit runner exits zero with no failures$/, (ctx) => {
    const { report } = ctx.bl1381;
    assert.match(report.out, /runner-exit=0/, `the BL-660 runner did not exit zero: ${report.out}`);
    assert.match(report.out, /ALL TESTS PASSED/, report.out);
  });

  scoped(/^the install exits zero reporting the schedule installed$/, (ctx) => {
    const { report } = ctx.bl1381;
    assert.equal(report.exit, 0, `the install did not succeed: ${report.out}`);
    assert.match(report.out, /Installed shift schedule cron/, report.out);
  });

  scoped(/^the fixture crontab holds the managed block for the fixture root$/, (ctx) => {
    const { report } = ctx.bl1381;
    assert.match(
      report.cronAfter,
      /# swarmforge-shift-schedule-begin/,
      `no managed block was written: ${report.cronAfter}`
    );
    assert.notEqual(report.cronAfter, report.cronBefore, 'the crontab was not changed at all');
  });

  scoped(/^the line that is not the swarm's is still present byte-identical$/, (ctx) => {
    const { report } = ctx.bl1381;
    // The whole line, not a substring of it: a managed block that rewrites a
    // human's cron line is the failure this asserts against.
    assert.ok(
      report.cronAfter.split('\n').includes('0 12 * * * /usr/bin/true'),
      `the foreign line did not survive byte-identical: ${report.cronAfter}`
    );
  });

  scoped(/^the verdict is (.+)$/, (ctx, expected) => {
    const key = expected.trim();
    assert.ok(key in GOVERNOR_VERDICT, `unknown expected verdict: ${expected}`);
    const wanted = GOVERNOR_VERDICT[key];
    const parsed = JSON.parse(ctx.bl1381.report.verdictRaw);
    if (wanted === null) {
      assert.equal(parsed.verdict, null, `expected no verdict, got ${JSON.stringify(parsed)}`);
    } else {
      assert.equal(
        parsed.verdict && parsed.verdict.verdict,
        wanted,
        `expected the parsed pass, got ${JSON.stringify(parsed)}`
      );
    }
  });

  scoped(/^the install exits non-zero$/, (ctx) => {
    assert.notEqual(ctx.bl1381.report.exit, 0, `the install reported success: ${ctx.bl1381.report.out}`);
  });

  scoped(/^the install output names the reconcile failure$/, (ctx) => {
    const { report } = ctx.bl1381;
    assert.match(
      report.out,
      /refusing to report a verdict it never gave|carried no scheduling verdict/,
      `the failure did not name its cause: ${report.out}`
    );
    // Invariant 2's naming half is what the old wrapper actually failed: it
    // exited non-zero by aborting, emitting a raw interpreter traceback. An
    // operator reading launch output must get a statement, not a stack.
    assert.ok(
      !/Traceback \(most recent call last\)/.test(report.out),
      `an interpreter traceback reached the operator: ${report.out}`
    );
  });

  scoped(/^the install output does not say no schedule is configured$/, (ctx) => {
    assert.ok(
      !/No shift schedule configured/.test(ctx.bl1381.report.out),
      `a real failure was reported as an absent schedule: ${ctx.bl1381.report.out}`
    );
  });

  scoped(/^the fixture crontab is byte-identical to before the run$/, (ctx) => {
    const { report } = ctx.bl1381;
    assert.equal(
      report.cronAfter,
      report.cronBefore,
      'a failed run changed the crontab, violating invariant 1'
    );
  });
}

module.exports = { registerSteps };
