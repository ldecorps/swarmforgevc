'use strict';

// BL-1242: step handlers for "A merge never silently drops work the
// receiving branch introduced". Drives the REAL check_merge_deletion.sh
// (and check_ticket_deletion.sh for the no-double-report scenario) end to
// end via lib/bl1242MergeBranchWorkDeletionCli.sh - a real git fixture
// reproducing the 2026-08-28 incident shape (shared history introduces
// two files under two tickets, one branch reverts them, the other keeps
// them, merge resolves as "theirs deleted, ours unchanged").

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'A merge never silently drops work either branch carries';

const CLI = path.join(__dirname, 'lib', 'bl1242MergeBranchWorkDeletionCli.sh');

function runCli(mode, param) {
  const args = [CLI, mode];
  if (param) args.push(param);
  const out = execFileSync('bash', args, { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out.trim().split('\n').pop());
}

const TICKETS_TO_PARAM = { none: 'none', every: 'every' };
const PATH_TO_KIND = {
  'backlog/paused/BL-0001-example-ticket.yaml': 'ticket-yaml',
  'specs/pipeline/steps/bl0001ExampleSteps.js': 'product',
  'swarmforge/scripts/bl0001_example_lib.bb': 'product',
};
const GUARD_TO_KEY = {
  'check_ticket_deletion.sh': 'ticketGuardFlagged',
  'this guard': 'mergeGuardFlagged',
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a role branch that introduced files of its own for several tickets$/, (ctx) => {
    ctx.bl1242 = {};
  });

  scoped(/^the merge would remove those files and the message names "?([a-z]+)"? of them$/, (ctx, tickets) => {
    const param = TICKETS_TO_PARAM[tickets];
    assert.ok(param, `unknown tickets value: ${tickets}`);
    ctx.bl1242.matrixResult = runCli('matrix', param);
  });

  scoped(/^the merge commit is (refused|allowed)$/, (ctx, outcome) => {
    const st = ctx.bl1242;
    // BL-1341 shares this Then across both directions - one outcome step, as
    // the ticket asked for one refusal model rather than a parallel set.
    const result = st.matrixResult || st.noRemovalResult || st.incomingResult;
    if (outcome === 'refused') {
      assert.notEqual(result.exitCode, 0, `expected refusal, got exit ${result.exitCode}`);
    } else {
      assert.equal(result.exitCode, 0, `expected allowed (exit 0), got ${JSON.stringify(result)}`);
    }
  });

  scoped(/^the merge is refused for an unaccounted removal$/, (ctx) => {
    ctx.bl1242.refusalResult = runCli('refusal-detail');
    assert.notEqual(ctx.bl1242.refusalResult.exitCode, 0, 'expected the refusal-detail fixture to actually be refused');
  });

  scoped(/^the refusal names every removed path$/, (ctx) => {
    const { stderr } = ctx.bl1242.refusalResult;
    assert.ok(stderr.includes('bl0001ExampleSteps.js'), `expected first path in refusal, got: ${stderr}`);
    assert.ok(stderr.includes('bl0002_example_lib.bb'), `expected second path in refusal, got: ${stderr}`);
  });

  scoped(/^the refusal names the ticket each removed path belongs to$/, (ctx) => {
    const { stderr } = ctx.bl1242.refusalResult;
    assert.ok(stderr.includes('BL-0001'), `expected BL-0001 in refusal, got: ${stderr}`);
    assert.ok(stderr.includes('BL-0002'), `expected BL-0002 in refusal, got: ${stderr}`);
  });

  scoped(/^the refusal names the commit on this branch that introduced each removed path$/, (ctx) => {
    const { stderr } = ctx.bl1242.refusalResult;
    assert.ok(/introduced at [0-9a-f]{6,10} on this branch/.test(stderr), `expected an introducing-commit reference in refusal, got: ${stderr}`);
  });

  scoped(/^the merge would remove no file either branch carries$/, (ctx) => {
    ctx.bl1242.noRemovalResult = runCli('no-removal');
  });

  scoped(/^the merge would remove "?([^"]+)"?$/, (ctx, removedPath) => {
    const kind = PATH_TO_KIND[removedPath];
    assert.ok(kind, `unknown path for double-report fixture: ${removedPath}`);
    ctx.bl1242.doubleReportResult = runCli('double-report', kind);
  });

  scoped(/^the removal is reported by "?([^"]+)"?$/, (ctx, guard) => {
    const key = GUARD_TO_KEY[guard];
    assert.ok(key, `unknown guard: ${guard}`);
    assert.equal(ctx.bl1242.doubleReportResult[key], true, `expected ${guard} to flag the removal`);
    ctx.bl1242.expectedFlaggingKey = key;
  });

  scoped(/^the removal is reported once and not twice$/, (ctx) => {
    const { doubleReportResult, expectedFlaggingKey } = ctx.bl1242;
    const otherKey = expectedFlaggingKey === 'ticketGuardFlagged' ? 'mergeGuardFlagged' : 'ticketGuardFlagged';
    assert.equal(doubleReportResult[otherKey], false, `expected the OTHER guard to stay silent, got: ${JSON.stringify(doubleReportResult)}`);
  });

  // ── BL-1341: the incoming side ────────────────────────────────────────

  scoped(/^a merge in progress on a branch that lacks files the incoming branch carries$/, () => {
    // The fixture for this scenario family is built by the CLI driver
    // itself (bl1242MergeBranchWorkDeletionCli.sh's incoming-* modes), so
    // this Given has nothing to record - the real work happens in the When.
  });

  scoped(/^the merge result omits those files and the message names "?([a-z]+)"? of them$/, (ctx, tickets) => {
    const param = TICKETS_TO_PARAM[tickets];
    assert.ok(param, `unknown tickets cell: ${tickets}`);
    ctx.bl1242.incomingResult = runCli('incoming-matrix', param);
  });

  scoped(/^the merge is refused for an unaccounted incoming removal$/, (ctx) => {
    const result = runCli('incoming-detail');
    ctx.bl1242.incomingResult = result;
    assert.notEqual(result.exitCode, 0, `expected a refusal, got: ${JSON.stringify(result)}`);
  });

  scoped(/^the refusal names every omitted path$/, (ctx) => {
    assert.ok(
      ctx.bl1242.incomingResult.stderr.includes('specs/pipeline/steps/bl0006IncomingSteps.js'),
      `the refusal does not name the omitted path: ${ctx.bl1242.incomingResult.stderr}`,
    );
  });

  scoped(/^the refusal names the ticket each omitted path belongs to$/, (ctx) => {
    assert.ok(
      ctx.bl1242.incomingResult.stderr.includes('BL-0006'),
      `the refusal does not name the omitted path's ticket: ${ctx.bl1242.incomingResult.stderr}`,
    );
  });

  scoped(/^the refusal says the path came from the incoming branch$/, (ctx) => {
    assert.match(ctx.bl1242.incomingResult.stderr, /incoming branch/);
  });

  scoped(/^the merge result keeps every file the incoming branch carries$/, (ctx) => {
    ctx.bl1242.incomingResult = runCli('incoming-kept');
  });

  scoped(/^the merge omits a path both branches carry$/, (ctx) => {
    ctx.bl1242.incomingResult = runCli('incoming-both-sides');
  });

  scoped(/^the removal is reported once$/, (ctx) => {
    const result = ctx.bl1242.incomingResult;
    assert.notEqual(result.exitCode, 0, `expected a refusal, got: ${JSON.stringify(result)}`);
    assert.equal(
      result.mentions,
      1,
      `a path dropped from both sides must be reported once, got ${result.mentions}`,
    );
  });
}

module.exports = { registerSteps };
