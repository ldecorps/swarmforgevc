'use strict';

// BL-1376: the expedite closing handover names the branch it left unlanded.
// Drives the REAL test_bl1376_expedite_branch_handover.sh, which in turn drives
// the REAL expedite_cli.bb over the shared expedite fixture - never a parallel
// reimplementation of the handover, and never the pure lib in isolation. The
// defect was that a true report omitted one leaving; only the text a real run
// prints can show that it no longer does.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1376 The expedite closing handover names the branch it left unlanded';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_bl1376_expedite_branch_handover.sh'
);

// The Outline's own words for each branch state, mapped to the marker the run
// records for it. Explicit KNOWN_VALUES: a row this handler does not know
// throws rather than passing through unchecked.
const BRANCH_STATES = {
  '3 commits ahead of origin/main': {
    named: '01: the handover names the run branch',
    'not named': null,
  },
  'level with origin/main': {
    named: null,
    'not named': '02: so the handover does not name it',
  },
};

function runFixture(ctx) {
  if (ctx.bl1376?.out) return ctx.bl1376.out;
  const res = spawnSync('bash', [FIXTURE], { encoding: 'utf8', timeout: 900000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1376 = { ...(ctx.bl1376 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`test_bl1376_expedite_branch_handover.sh failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePass(ctx, marker) {
  const out = runFixture(ctx);
  assert.ok(out.includes(`ok   ${marker}`), `missing "ok   ${marker}" in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^an expedite run whose stages have finished$/, (ctx) => {
    ctx.bl1376 = ctx.bl1376 || {};
    ctx.bl1376.case = 'ahead';
  });

  // The Given that names a branch state - both the Scenario's literal one and
  // the Outline's placeholder. Anchored to the states this handler knows, so
  // it cannot swallow the unrelated `the run branch is still the only branch
  // …` Then further down; a `(.+)` here did exactly that.
  scoped(/^the run branch is (\d+ commits ahead of origin\/main|level with origin\/main)$/, (ctx, state) => {
    const known = BRANCH_STATES[state];
    assert.ok(known, `unknown branch state in the Examples table: ${state}`);
    ctx.bl1376 = ctx.bl1376 || {};
    ctx.bl1376.state = state;
    ctx.bl1376.case = state.includes('ahead') ? 'ahead' : 'level';
    if (ctx.bl1376.case === 'ahead') requirePass(ctx, '01: it states the distance from origin/main');
  });

  scoped(/^origin\/main cannot be resolved$/, (ctx) => {
    ctx.bl1376.case = 'unreadable';
  });

  scoped(/^an expedite run invoked as a dry run, which changed nothing$/, (ctx) => {
    ctx.bl1376 = ctx.bl1376 || {};
    ctx.bl1376.case = 'dry';
  });

  scoped(/^an expedite run that refuses after it has already parked tickets$/, (ctx) => {
    ctx.bl1376 = ctx.bl1376 || {};
    ctx.bl1376.case = 'refusal';
    requirePass(ctx, '05: the refusal is the teardown one, which fires after parking');
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the run prints its closing handover$/, (ctx) => {
    runFixture(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the handover names the run branch as outstanding$/, (ctx) => {
    const marker = {
      ahead: '01: the run branch is an OUTSTANDING subject',
      unreadable: '04: it is reported as an outstanding subject',
      refusal: '05: it names the run branch',
    }[ctx.bl1376.case];
    assert.ok(marker, `no branch-naming marker for case ${ctx.bl1376.case}`);
    requirePass(ctx, marker);
  });

  scoped(/^the handover states the branch is 3 commits ahead of origin\/main$/, (ctx) => {
    requirePass(ctx, '01: it states the distance from origin/main');
  });

  scoped(/^the handover names the owner who must land it$/, (ctx) => {
    requirePass(ctx, '01: it names the owner who must land it');
    // Naming an owner is only useful if it names the rule that makes them one.
    requirePass(ctx, '01: and says under which rule');
  });

  scoped(/^the run branch is (named|not named) in the handover$/, (ctx, reported) => {
    const state = ctx.bl1376.state;
    assert.ok(state, 'the Outline set no branch state');
    const marker = BRANCH_STATES[state][reported];
    assert.ok(
      marker,
      `the Examples row pairs ${JSON.stringify(state)} with ${JSON.stringify(reported)}, which this handler does not know`
    );
    requirePass(ctx, marker);
    if (reported === 'not named') {
      // Silence about the branch must not become silence about everything.
      requirePass(ctx, '02: while the leavings it DID make are still reported');
    }
  });

  scoped(/^the handover reports nothing outstanding$/, (ctx) => {
    requirePass(ctx, '03: a dry run reports nothing outstanding');
    requirePass(ctx, '03: and names no branch');
  });

  scoped(/^the handover names the reason the branch distance could not be read$/, (ctx) => {
    requirePass(ctx, '04: and the reason the distance could not be read is given');
    requirePass(ctx, '04: no distance is invented');
  });

  scoped(/^the handover names the parked tickets as outstanding$/, (ctx) => {
    requirePass(ctx, '05: it names the parked tickets');
    requirePass(ctx, '05: and the tickets really were parked');
  });

  scoped(/^the handover names the uncommitted backlog moves as outstanding$/, (ctx) => {
    requirePass(ctx, '05: it names the uncommitted backlog moves');
  });

  scoped(/^origin\/main is unchanged by the run$/, (ctx) => {
    requirePass(ctx, '06: origin/main did not move');
    requirePass(ctx, '06: main did not move');
    // Read from the driver's source too, not only from its behaviour: the
    // ticket's invariant 2 is about what the code may do, not only what this
    // run happened to do.
    requirePass(ctx, '06b: the branch read never merges');
    requirePass(ctx, '06b: never pushes');
    requirePass(ctx, '06b: and never checks anything out');
  });

  scoped(/^the run branch is still the only branch containing the run commits$/, (ctx) => {
    requirePass(ctx, '06: the run branch is the only branch containing the run commits');
    requirePass(ctx, '06: the handover never claims the branch was landed');
  });
}

module.exports = { registerSteps };
