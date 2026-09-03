'use strict';

// BL-1377: a suite's failure set is recorded once per base commit.
// Drives the REAL test_suite_baseline_cli.sh, which drives the REAL
// suite_baseline.sh over a real git repo with a real base worktree and a real
// record file. Only the suite command itself is stubbed, through the CLI's own
// SUITE_BASELINE_RUNNER seam - running a 143-second suite to test a cache
// would defeat the ticket - and "run once" versus "run twice" is read off that
// runner's own log rather than inferred.
//
// The Background's base sha is fixture prose. The shell test works at a real
// commit and the evidence assertions are made against THAT, so nothing here
// pins a literal the code never sees.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = "BL-1377 A suite's failure set is recorded once per base commit";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_suite_baseline_cli.sh');

// The Outline rows' own words, mapped to the case each is about. Explicit
// KNOWN_VALUES: a row this handler does not know throws rather than passing
// through unchecked.
const OBSERVED_CASES = {
  'a red the record does not name': 'new',
  'lost a red the record names': 'vanished',
};

const DIFFERENCE_MARKERS = {
  new: ['02: the evidence names the new red', '04: and calls it new'],
  vanished: ['03: the vanished red is named', '03: by name, not as a count'],
};

const UNUSABLE_RECORDS = {
  absent: ['05a absent: two runs', '05a absent: nothing is excused by a record'],
  unreadable: ['05b corrupt: two runs', '05b corrupt: never a pass on a cached set'],
  'recorded under a different suite config hash': [
    '05c config hash moved: two runs',
    '05c config hash moved: nothing is excused',
  ],
  'recorded at a different base sha': [
    '05d other base sha: two runs',
    '05d other base sha: nothing is excused',
  ],
};

function runFixture(ctx) {
  if (ctx.bl1377?.out) return ctx.bl1377.out;
  const res = spawnSync('bash', [FIXTURE], { encoding: 'utf8', timeout: 600000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1377 = { ...(ctx.bl1377 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`test_suite_baseline_cli.sh failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePass(ctx, marker) {
  const out = runFixture(ctx);
  assert.ok(out.includes(`ok   ${marker}`), `missing "ok   ${marker}" in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^the stage's parcel sits on base sha "(.+)"$/, (ctx) => {
    ctx.bl1377 = ctx.bl1377 || {};
    ctx.bl1377.case = 'fresh';
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^a recorded baseline for suite "(\w+)" at that base sha with (\d+) reds$/, (ctx, suite, reds) => {
    assert.equal(suite, 'unit', `this handler drives the unit suite, not ${suite}`);
    assert.equal(reds, '2', `the fixture records 2 reds, not ${reds}`);
    ctx.bl1377.case = 'fresh';
  });

  scoped(/^the suite config hash matches the record$/, (ctx) => {
    // The fixture reads the hash from the CLI itself rather than pinning a
    // literal, so "matches" is true by construction and asserted by 01's
    // single run.
    requirePass(ctx, '01: the suite ran once');
  });

  scoped(/^the observed run has (.+)$/, (ctx, observed) => {
    const which = OBSERVED_CASES[observed];
    assert.ok(which, `unknown observed case in the Examples table: ${observed}`);
    ctx.bl1377.case = which;
  });

  scoped(/^the baseline record is (.+)$/, (ctx, record) => {
    const markers = UNUSABLE_RECORDS[record];
    assert.ok(markers, `unknown record state in the Examples table: ${record}`);
    ctx.bl1377.case = 'unusable';
    ctx.bl1377.unusable = markers;
  });

  scoped(/^no baseline record exists for suite "(\w+)" at that base sha$/, (ctx, suite) => {
    assert.equal(suite, 'unit', `this handler drives the unit suite, not ${suite}`);
    ctx.bl1377.case = 'absent';
  });

  scoped(/^an allowlisted known-benign error occurs during the run$/, (ctx) => {
    ctx.bl1377.case = 'benign';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the stage gathers its pre-existing-red evidence$/, (ctx) => {
    runFixture(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the suite is run once$/, (ctx) => {
    requirePass(ctx, '01: the suite ran once');
    requirePass(ctx, '01: and it was the parcel run, not the base one');
  });

  scoped(/^the suite is run twice$/, (ctx) => {
    const markers = {
      new: ['02: the suite ran twice', '02: the base run happened'],
      vanished: ['03: the suite ran twice'],
      unusable: ctx.bl1377.unusable || [],
    }[ctx.bl1377.case];
    assert.ok(markers && markers.length, `no two-run marker for case ${ctx.bl1377.case}`);
    markers.forEach((m) => requirePass(ctx, m));
  });

  scoped(
    /^the evidence names that base sha, (\d+) recorded reds and (\d+) observed reds$/,
    (ctx) => {
      requirePass(ctx, '01: the evidence names the base sha');
      requirePass(ctx, '01: it names the recorded count');
      requirePass(ctx, '01: it names the observed count');
      requirePass(ctx, '01: and says the sets agree');
    }
  );

  scoped(/^the evidence names the (\w+) test$/, (ctx, difference) => {
    const markers = DIFFERENCE_MARKERS[difference];
    assert.ok(markers, `unknown difference in the Examples table: ${difference}`);
    markers.forEach((m) => requirePass(ctx, m));
  });

  scoped(/^no red is excused by a recorded baseline$/, (ctx) => {
    (ctx.bl1377.unusable || []).forEach((m) => requirePass(ctx, m));
  });

  scoped(/^the evidence reports the unnamed red as new$/, (ctx) => {
    requirePass(ctx, '02: the evidence names the new red');
    requirePass(ctx, '04: and calls it new');
  });

  scoped(/^the evidence does not report the unnamed red as pre-existing$/, (ctx) => {
    requirePass(ctx, '04: it is never reported as pre-existing');
  });

  scoped(/^the observed failure set is written as the new baseline for suite "(\w+)"$/, (ctx) => {
    requirePass(ctx, '05a absent: the observed base set was recorded');
    // With no record the base run happens, so the set that is written is the
    // one observed AT THE BASE - which is what a baseline is.
    requirePass(ctx, '05a absent: two runs');
  });

  scoped(/^the written record carries the base sha and suite config hash it was observed under$/, (ctx) => {
    requirePass(ctx, '05a absent: the record carries the base sha it was observed under');
    requirePass(ctx, '05a absent: and the suite config hash');
  });

  scoped(/^the allowlisted error is still tolerated$/, (ctx) => {
    requirePass(ctx, '06: the benign error did not force a second run');
    requirePass(ctx, '06: the verdict is unchanged');
  });

  scoped(/^the recorded baseline is unchanged by it$/, (ctx) => {
    requirePass(ctx, '06: and the recorded baseline is untouched');
  });
}

module.exports = { registerSteps };
