'use strict';

// BL-1378: an expedite-closed ticket can satisfy the close guard.
// Drives the REAL test_bl1378_expedite_close_guard.sh, which drives the REAL
// commit_integrity_cli.bb over real git fixtures with real record files.
// Calling the guard lib directly would report green for a decision that is
// right and not wired in - which refuses nothing, and is the BL-1235 shape the
// ticket's own required_wiring exists to avoid.
//
// The Background's ticket id is the fixture's own ("BL-9001"), so nothing here
// pins an id the code never sees.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1378 An expedite-closed ticket can satisfy the close guard';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_bl1378_expedite_close_guard.sh'
);

// The Outline rows' own words, mapped to the markers the run records for each.
// Explicit KNOWN_VALUES: a row this handler does not know throws rather than
// passing through unchecked.
const MAILBOX_OUTCOMES = {
  'holds a QA handoff naming "BL-9001"': {
    allowed: ['02a: a QA handoff with no expedite record still closes'],
  },
  'holds no QA handoff naming "BL-9001"': {
    refused: ['02b: no QA handoff and no record still refuses', "02b: with today's reason"],
  },
};

const RECORD_MISMATCHES = {
  'names a different ticket': [
    '03 other-ticket: the close is refused',
    '03 other-ticket: as a missing QA approval, not a store problem',
  ],
  'carries a stage other than QA': [
    '03 other-stage: the close is refused',
    '03 other-stage: as a missing QA approval, not a store problem',
  ],
  'carries approval false': [
    '03 approval-false: the close is refused',
    '03 approval-false: as a missing QA approval, not a store problem',
  ],
};

const STORE_PROBLEMS = {
  'obstructed by a file': ['05a obstructed: refused', '05a obstructed: and the problem is named'],
  unreadable: ['05b unreadable: refused', '05b unreadable: and the problem is named'],
  'holding a record line with no commit': [
    '05c no commit field: refused',
    '05c no commit field: and the field is named',
  ],
  'holding a record line with no approval': [
    '05d no approval field: refused',
    '05d no approval field: and the field is named',
  ],
};

function runFixture(ctx) {
  if (ctx.bl1378?.out) return ctx.bl1378.out;
  const res = spawnSync('bash', [FIXTURE], { encoding: 'utf8', timeout: 900000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1378 = { ...(ctx.bl1378 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`test_bl1378_expedite_close_guard.sh failed (${res.status}):\n${out}`);
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
  scoped(/^a commit moving "(\S+)" from active to done$/, (ctx) => {
    ctx.bl1378 = ctx.bl1378 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^an expedite QA verdict record for ticket "(\S+)" with approval true$/, (ctx) => {
    ctx.bl1378.case = 'record';
  });

  scoped(/^the approved commit is an ancestor of main$/, (ctx) => {
    ctx.bl1378.case = 'landed';
  });

  scoped(/^the approved commit is not an ancestor of main$/, (ctx) => {
    ctx.bl1378.case = 'unlanded';
  });

  scoped(/^no expedite verdict record for ticket "(\S+)"$/, (ctx) => {
    ctx.bl1378.case = 'mailbox';
  });

  scoped(/^the coordinator mailbox (holds .+)$/, (ctx, mailbox) => {
    const known = MAILBOX_OUTCOMES[mailbox];
    if (known) {
      ctx.bl1378.mailbox = mailbox;
      return;
    }
    // The other scenarios say "holds no QA handoff naming ..." as a premise
    // rather than as an Examples row; it is the fixture's default.
    assert.match(
      mailbox,
      /^holds no QA handoff naming/,
      `unknown coordinator mailbox state: ${mailbox}`
    );
  });

  scoped(/^an expedite verdict record that (.+)$/, (ctx, record) => {
    const markers = RECORD_MISMATCHES[record];
    assert.ok(markers, `unknown record mismatch in the Examples table: ${record}`);
    ctx.bl1378.case = 'mismatch';
    ctx.bl1378.markers = markers;
  });

  scoped(/^the expedite verdict store is (.+)$/, (ctx, store) => {
    const markers = STORE_PROBLEMS[store];
    assert.ok(markers, `unknown store problem in the Examples table: ${store}`);
    ctx.bl1378.case = 'store-problem';
    ctx.bl1378.markers = markers;
  });

  scoped(/^the expedite verdict store does not exist$/, (ctx) => {
    ctx.bl1378.case = 'absent';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the close guard validates the commit$/, (ctx) => {
    runFixture(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  // One handler for both the literal Then and the Outline's placeholder. Two
  // patterns, one of which is a prefix of the other, would let whichever is
  // registered first swallow the Outline's rows.
  scoped(/^the close is (allowed|refused)$/, (ctx, outcome) => {
    const mailbox = ctx.bl1378.mailbox;
    if (mailbox) {
      const markers = MAILBOX_OUTCOMES[mailbox][outcome];
      assert.ok(
        markers,
        `the Examples row pairs ${JSON.stringify(mailbox)} with ${JSON.stringify(outcome)}, which this handler does not know`
      );
      markers.forEach((m) => requirePass(ctx, m));
      // The regression that matters most: a corrupt store must not take the
      // mailbox path down with it.
      if (outcome === 'allowed') requirePass(ctx, '02c: a corrupt store does not break the mailbox path');
      return;
    }
    if (outcome === 'allowed') {
      requirePass(ctx, '01: the close is allowed');
      return;
    }
    const markers = {
      unlanded: ['04: the close is refused'],
      mismatch: ctx.bl1378.markers,
      'store-problem': ctx.bl1378.markers,
      absent: ['06: the close is refused'],
    }[ctx.bl1378.case];
    assert.ok(markers && markers.length, `no refusal marker for case ${ctx.bl1378.case}`);
    markers.forEach((m) => requirePass(ctx, m));
  });


  scoped(/^the guard names the expedite verdict record it relied on$/, (ctx) => {
    requirePass(ctx, '01: and the guard names the record it relied on');
    requirePass(ctx, '01: naming the approved commit');
  });

  scoped(/^the guard names the commit that never reached main$/, (ctx) => {
    requirePass(ctx, '04: and the guard names the commit that never reached main');
    requirePass(ctx, '04: saying what is wrong with it');
    // ...and where landing belongs, so the reader knows whose move it is.
    requirePass(ctx, '04: and where landing belongs');
  });

  scoped(/^the guard names the store problem$/, (ctx) => {
    (ctx.bl1378.markers || []).forEach((m) => requirePass(ctx, m));
  });

  scoped(/^the guard reports the missing QA approval, not a store problem$/, (ctx) => {
    requirePass(ctx, '06: reporting the missing QA approval');
    requirePass(ctx, '06: and not a store problem');
  });
}

module.exports = { registerSteps };
