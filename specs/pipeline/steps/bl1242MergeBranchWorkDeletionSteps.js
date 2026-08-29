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

const FEATURE = 'A merge never silently drops work the receiving branch introduced';

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
    const result = st.matrixResult || st.noRemovalResult;
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

  scoped(/^the merge would remove no file the branch introduced$/, (ctx) => {
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
}

module.exports = { registerSteps };
