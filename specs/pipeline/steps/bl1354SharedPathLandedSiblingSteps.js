'use strict';

// BL-1354: `sibling-landed?` asked whether a sibling's attributed content was
// already on origin/main by comparing each attributed path's WHOLE blob. On a
// file several tickets touch, that comparison is decided by every co-owner at
// once, so a sibling whose own lines were all landed still read unlanded
// whenever any co-owner's were not. Observed six-for-six on
// docs/reference/Specification.MD during BL-1332's own land, every one of the
// six already in backlog/done/.
//
// Every scenario runs the REAL land_step_lib.bb over a REAL repository whose
// origin/main carries a tip-pure REPLAY of the first sibling's lines - a
// different commit object, which is what makes the shared file's blob still
// differ while that sibling's own lines are all present. A mocked git layer
// could not exhibit the defect at all: it lives entirely in which content two
// different comparisons are drawn over.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLASSIFY_CLI = path.join(__dirname, 'lib', 'bl1354SharedPathClassifyCli.bb');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const FEATURE = 'A shared path does not hide a landed sibling';

const FIRST = 'BL-9302';
const SECOND = 'BL-9303';

// The outline's quoted words for an unanswered attribution, each mapped to the
// row the driver builds for it. Explicit KNOWN_VALUES: an unrecognised row
// fails rather than passing through unchecked.
const ATTRIBUTIONS = {
  'a walk that failed': 'a walk that failed',
  'an empty path set': 'an empty path set',
  'an unreadable diff': 'an unreadable diff',
};

function runDriver(...args) {
  const out = execFileSync('bb', [CLASSIFY_CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 300_000,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^the land step is classifying the siblings of a commit$/, (ctx) => {
    ctx.bl1354 = { first: FIRST, second: SECOND };
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^a shared path carries lines attributed to two siblings$/, (ctx) => {
    ctx.bl1354.shared = true;
  });

  scoped(/^the first sibling's own lines are all present on origin\/main$/, (ctx) => {
    ctx.bl1354.landFirst = true;
  });

  scoped(/^the second sibling's own lines are absent from origin\/main$/, (ctx) => {
    assert.equal(ctx.bl1354.landFirst, true, 'the first sibling must already be landed in this row');
    ctx.bl1354.landFirst = true;
  });

  scoped(/^neither sibling's own lines are present on origin\/main$/, (ctx) => {
    ctx.bl1354.landFirst = false;
  });

  scoped(/^the attribution for a sibling is (.+)$/, (ctx, attribution) => {
    const kind = ATTRIBUTIONS[attribution];
    assert.ok(kind, `unknown attribution: ${attribution}`);
    ctx.bl1354.attribution = kind;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the siblings are classified$/, (ctx) => {
    ctx.bl1354.report = ctx.bl1354.attribution
      ? runDriver('attribution', ctx.bl1354.attribution)
      : runDriver('classify', String(ctx.bl1354.landFirst === true));
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the first sibling is reported landed$/, (ctx) => {
    const { report } = ctx.bl1354;
    assert.ok(
      report.landed.includes(FIRST),
      `${FIRST}'s own lines are all on origin/main, so it must read landed; got landed=${JSON.stringify(report.landed)} unlanded=${JSON.stringify(report.unlanded)}`,
    );
    assert.ok(!report.unlanded.includes(FIRST));
  });

  scoped(/^the second sibling is reported unlanded$/, (ctx) => {
    const { report } = ctx.bl1354;
    assert.ok(report.unlanded.includes(SECOND));
    assert.ok(!report.landed.includes(SECOND));
  });

  scoped(/^both siblings are reported unlanded$/, (ctx) => {
    const { report } = ctx.bl1354;
    assert.deepEqual(report.landed, []);
    assert.deepEqual([...report.unlanded].sort(), [FIRST, SECOND]);
  });

  scoped(/^that sibling is reported unlanded$/, (ctx) => {
    const { report } = ctx.bl1354;
    assert.deepEqual(report.landed, [], 'an unanswered attribution never reports a sibling landed');
    assert.ok(report.unlanded.includes(FIRST));
  });
}

module.exports = { registerSteps };
