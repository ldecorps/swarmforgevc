'use strict';

// BL-1385: a step handler that cannot load never reaches main.
//
// Since BL-1371 a handler registers by EXISTING in specs/pipeline/steps, and
// the registry requires every discovered handler eagerly. So one handler whose
// require names a module living only on an unlanded parcel makes EVERY
// acceptance run throw. On 2026-09-04 a93aa4a18f landed exactly that:
// 947 handlers, 1 unloadable, 0 features runnable, and both existing guards
// passed it because neither loads a handler.
//
// Every scenario drives the REAL swarmforge/scripts/check_handler_module_graph.sh
// over a REAL scratch repository through lib/bl1385HandlerModuleGraphCli.sh,
// and the two consumer scenarios drive the REAL consumers - land_step_lib.bb's
// own replayed-tree-guard list and the guard's no-argument staged-tree call -
// rather than invoking the script directly. A guard that works but is not IN
// the list is the defect this ticket exists for, so the test has to ask the
// list, not the script.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1385HandlerModuleGraphCli.sh');
const FIXTURE_PREFIX = 'bl1385-acc-';

const FEATURE = 'BL-1385 A handler that cannot load never reaches main';

// The Examples' own words, mapped to the fixture shape each is built as.
// Explicit KNOWN_VALUES: an unrecognised row throws rather than passing
// through unchecked.
const MODULE_FORMS = {
  'a compiled extension module under out/': 'missing-ext-out',
  'a sibling helper under lib/': 'missing-lib-sibling',
  'a relative module beside the handler': 'missing-relative',
};

// Scenario 03's two rows: tree state x checker state -> verdict.
const TREE_VS_CHECKER = {
  'absent|compiled': 'checker-has-it',
  'present|absent': 'tree-has-it',
};

const VERDICTS = { refuses: 'refuses', passes: 'passes' };

// A killed run traps no `finally`, so sweep by prefix BEFORE this one starts
// as well (BL-971).
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
  scoped(/^a scratch repository whose step registry discovers handlers$/, (ctx) => {
    ctx.bl1385 = { shape: 'good' };
  });

  scoped(/^a good handler on the tree$/, (ctx) => {
    // Present in every shape, so a refusal is always attributable to the BAD
    // handler rather than to nothing loading at all.
    ctx.bl1385.hasGoodHandler = true;
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^a handler on the tree requiring (.+) that is absent from the tree$/, (ctx, form) => {
    const shape = MODULE_FORMS[form.trim()];
    assert.ok(shape, `unknown module form: ${form}`);
    ctx.bl1385.shape = shape;
  });

  scoped(/^a handler on the tree requiring a compiled extension module whose source is on the tree$/, (ctx) => {
    ctx.bl1385.shape = 'good';
  });

  scoped(/^a handler on the tree requiring a compiled extension module that is (absent|present)$/, (ctx, onTree) => {
    ctx.bl1385.onTree = onTree.trim();
  });

  scoped(/^the checking worktree has that module (compiled|absent)$/, (ctx, inChecker) => {
    const key = `${ctx.bl1385.onTree}|${inChecker.trim()}`;
    const shape = TREE_VS_CHECKER[key];
    assert.ok(shape, `unknown tree/checker combination: ${key}`);
    ctx.bl1385.shape = shape;
  });

  scoped(/^a tip-pure replay whose tree carries a handler requiring a module absent from the tree$/, (ctx) => {
    ctx.bl1385.shape = 'land-replay';
  });

  scoped(/^a commit adding a handler requiring a module absent from the tree$/, (ctx) => {
    ctx.bl1385.shape = 'commit-guards';
  });

  scoped(/^a tree-ish the guard cannot open$/, (ctx) => {
    ctx.bl1385.shape = 'unreadable-tree';
  });

  scoped(/^a tree with no step registry directory at all$/, (ctx) => {
    ctx.bl1385.shape = 'no-steps-dir';
  });

  scoped(/^a handler on the tree calling process\.exit before a bad handler requiring a module absent from the tree$/, (ctx) => {
    ctx.bl1385.shape = 'handler-calls-exit';
  });

  scoped(/^a handler on the tree requiring a nonexistent absolute path outside any tree$/, (ctx) => {
    ctx.bl1385.shape = 'escapes-tree-scope';
  });

  // ── BL-1385 invariant 3 (added 2026-09-04 after the cleaner reproduced two
  //    runs deleting each other's tree). This guard runs from a commit hook,
  //    where invocations overlap constantly - and BL-971's sweep-by-prefix,
  //    written for test fixtures that never run concurrently, deleted a live
  //    run's materialised tree. Every file then read as absent and the guard
  //    reported hundreds of phantom missing modules, refusing valid commits.
  scoped(/^two handler module graph guards examine the tree at the same time$/, (ctx) => {
    ctx.bl1385.shape = 'concurrent';
    ctx.bl1385.report = runFixture('concurrent');
  });

  scoped(/^both guards pass$/, (ctx) => {
    const { report } = ctx.bl1385;
    assert.match(report.out, /a=0 b=0/, `a concurrent pair did not both pass: ${report.out}`);
  });

  scoped(/^neither guard removed a working directory it did not create$/, (ctx) => {
    // A sibling root owned by a LIVE pid is planted before the pair runs. Its
    // survival is the invariant stated directly: reaping is scoped to roots no
    // live run owns.
    assert.match(
      ctx.bl1385.report.out,
      /probe_survived=true/,
      `a guard reaped a root it did not own: ${ctx.bl1385.report.out}`
    );
  });

  // ── When ────────────────────────────────────────────────────────────────
  const run = (ctx) => {
    assert.ok(ctx.bl1385.shape, 'no fixture shape was chosen');
    ctx.bl1385.report = runFixture(ctx.bl1385.shape);
  };

  scoped(/^the handler module graph guard examines the tree$/, run);
  scoped(/^the land step guards the replayed tree$/, run);
  scoped(/^the commit guards run on that commit$/, run);

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the guard (refuses|passes)$/, (ctx, verdict) => {
    const expected = VERDICTS[verdict];
    assert.ok(expected, `unknown verdict: ${verdict}`);
    const { report } = ctx.bl1385;
    if (expected === 'refuses') {
      assert.notEqual(report.exit, 0, `the guard passed a tree it should refuse: ${report.out}`);
    } else {
      assert.equal(report.exit, 0, `the guard refused a tree it should pass: ${report.out}`);
    }
  });

  scoped(/^its output carries the HANDLER_LOAD_BLOCK marker$/, (ctx) => {
    assert.equal(ctx.bl1385.report.marker, true, ctx.bl1385.report.out);
  });

  scoped(/^its output omits the HANDLER_LOAD_BLOCK marker$/, (ctx) => {
    assert.equal(ctx.bl1385.report.marker, false, ctx.bl1385.report.out);
  });

  scoped(/^its output names the handler and the missing module$/, (ctx) => {
    const { report } = ctx.bl1385;
    // Both, not either: a refusal naming only the handler leaves the reader to
    // find which require broke, and one naming only the module leaves them to
    // find which of 947 handlers it belongs to.
    assert.equal(report.namesHandler, true, `the refusal does not name the handler: ${report.out}`);
    assert.equal(report.namesModule, true, `the refusal does not name the module: ${report.out}`);
  });

  scoped(/^the land is refused$/, (ctx) => {
    assert.notEqual(
      ctx.bl1385.report.exit,
      0,
      `the land's own tree-guard list did not refuse - the guard may work but not be IN the list: ${ctx.bl1385.report.out}`
    );
  });

  scoped(/^the land output carries the HANDLER_LOAD_BLOCK marker$/, (ctx) => {
    assert.equal(ctx.bl1385.report.marker, true, ctx.bl1385.report.out);
  });

  scoped(/^the guard set fails$/, (ctx) => {
    assert.notEqual(ctx.bl1385.report.exit, 0, ctx.bl1385.report.out);
    // 1 specifically: commit_guard_chain_lib.sh's run_guard reads any other
    // non-zero status as UNEXPECTED rather than as a refusal, which would
    // report the guard as broken instead of as having found something.
    assert.equal(
      ctx.bl1385.report.exit,
      1,
      `the commit chain reads a status other than 1 as unexpected, not as a refusal: exit ${ctx.bl1385.report.exit}`
    );
  });

  scoped(/^the output carries the HANDLER_LOAD_BLOCK marker$/, (ctx) => {
    assert.equal(ctx.bl1385.report.marker, true, ctx.bl1385.report.out);
  });

  scoped(/^every other guard's status is still reported$/, (ctx) => {
    // The chain captures each guard's status rather than aborting on the
    // first (Guardrails, BL-1242/BL-1252), so a refusal here must not mask
    // the others. Asserted through the exit status the chain can act on.
    assert.equal(ctx.bl1385.report.exit, 1, ctx.bl1385.report.out);
  });

  scoped(/^its output says the tree could not be examined$/, (ctx) => {
    assert.match(
      ctx.bl1385.report.out,
      /could not read the tree|could not determine a tree/,
      `the refusal does not say the tree was unreadable: ${ctx.bl1385.report.out}`
    );
  });
}

module.exports = { registerSteps };
