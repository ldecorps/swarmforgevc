'use strict';

// BL-1026: step handlers for "the expeditor's default per-stage budget holds,
// and every place that states it agrees".
//
// Scenario 01 drives the REAL valve - expedite_lib.bb's stage-timeout-verdict,
// the exact function expedite_cli.bb's sh-bounded consults before killing a
// stage's process group - through a bb subprocess with a PINNED clock. No
// scenario names a number of minutes, so every duration below is computed FROM
// the budget in force, which is read out of the lib rather than restated here.
// Restating it would mint the sixth hand-mirrored copy this feature exists to
// prevent.
//
// Scenarios 02 and 03 run the mirror gate over the REAL four sites in the real
// working tree. 03 is the vacuity check: it copies the tree's stated sites,
// changes one, and requires the gate to go red naming it. It mutates a COPY,
// never the working tree - a handler that edited the repo and crashed would
// leave the fault behind it.
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = "the expeditor's default per-stage budget holds, and every place that states it agrees";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_lib.bb');

// Explicit known values per the Scenario Outline handler rule. Each is a
// closed set; a row the handlers do not know is a hard failure, never a
// passthrough that would let a new Example silently assert nothing.
const KNOWN_BUDGETS = new Set(['no explicit per-stage budget', 'an explicit budget under the default']);
const KNOWN_ELAPSED = new Set([
  'just under the default budget',
  'exactly the default budget',
  'well past the default budget',
  'past its explicit budget but under the default',
]);
const KNOWN_REPORTED = new Set(['the default', 'the explicit budget']);

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function libExpr(body) {
  return `(require '[babashka.fs :as fs])\n(load-file "${LIB}")\n${body}`;
}

// The budget the code states, read from the code. Everything scenario 01 does
// is expressed relative to this.
function defaultBudgetMs() {
  return Number(bb(libExpr('(println expedite-lib/default-stage-timeout-ms)')));
}

function verdict({ elapsedMs, timeoutMs }) {
  const opts = timeoutMs === null
    ? `{:started-at-ms 0 :now-ms ${elapsedMs}}`
    : `{:started-at-ms 0 :now-ms ${elapsedMs} :timeout-ms ${timeoutMs}}`;
  const out = bb(libExpr(`(let [v (expedite-lib/stage-timeout-verdict ${opts})]
  (println (:overrun? v) (:timeout-ms v)))`));
  const [overrun, reported] = out.split(/\s+/);
  return { overrun: overrun === 'true', reportedMs: Number(reported) };
}

function gateFindings(root) {
  return JSON.parse(bb(libExpr(`(require '[cheshire.core :as json])
(println (json/generate-string
  (expedite-lib/budget-mirror-findings
    (expedite-lib/read-budget-mirrors "${root}")
    expedite-lib/default-stage-timeout-ms)))`)));
}

function statedSites() {
  return JSON.parse(bb(libExpr(`(require '[cheshire.core :as json])
(println (json/generate-string expedite-lib/budget-mirror-sites))`)));
}

// Copy the stated sites into a scratch root so scenario 03 can change one
// without touching the working tree.
function copyTreeForMutation() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1026-mirror-'));
  for (const rel of statedSites()) {
    const dest = path.join(scratch, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dest);
  }
  return scratch;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a stage with (.+)$/, (ctx, budget) => {
    assert.ok(KNOWN_BUDGETS.has(budget), `unknown budget "${budget}" - the handlers know ${[...KNOWN_BUDGETS]}`);
    ctx.defaultMs = defaultBudgetMs();
    assert.ok(ctx.defaultMs > 0, 'the code must state a positive default budget');
    if (budget === 'no explicit per-stage budget') {
      ctx.timeoutMs = null;
      ctx.inForceMs = ctx.defaultMs;
    } else {
      // Strictly under the default, and not by one millisecond - the row that
      // follows puts the clock past this but under the default, so the gap has
      // to be real.
      ctx.timeoutMs = Math.floor(ctx.defaultMs / 2);
      ctx.inForceMs = ctx.timeoutMs;
      assert.ok(ctx.timeoutMs < ctx.defaultMs, 'an explicit budget under the default must actually be under it');
    }
  });

  scoped(/^it has been running for (.+)$/, (ctx, elapsed) => {
    assert.ok(KNOWN_ELAPSED.has(elapsed), `unknown elapsed "${elapsed}" - the handlers know ${[...KNOWN_ELAPSED]}`);
    const d = ctx.defaultMs;
    const elapsedMs = {
      'just under the default budget': d - 1,
      'exactly the default budget': d,
      'well past the default budget': d * 2,
      // Past the explicit budget, but still comfortably under the default -
      // the row that tells the two budgets apart. If the override were broken
      // and the default applied, this stage would NOT be judged overrun.
      'past its explicit budget but under the default': ctx.timeoutMs === null ? d - 1 : ctx.timeoutMs + 1,
    }[elapsed];
    if (elapsed === 'past its explicit budget but under the default') {
      assert.ok(ctx.timeoutMs !== null, 'that elapsed only makes sense for a stage with an explicit budget');
      assert.ok(elapsedMs < d, 'the clock must still be under the default, or the row proves nothing');
    }
    ctx.verdict = verdict({ elapsedMs, timeoutMs: ctx.timeoutMs });
  });

  scoped(/^the overrun verdict is (true|false)$/, (ctx, expected) => {
    assert.equal(ctx.verdict.overrun, expected === 'true',
      `the valve must read elapsed >= the budget in force (${ctx.inForceMs} ms)`);
  });

  scoped(/^the budget the verdict reports is (.+)$/, (ctx, reported) => {
    assert.ok(KNOWN_REPORTED.has(reported), `unknown reported "${reported}" - the handlers know ${[...KNOWN_REPORTED]}`);
    const expectedMs = reported === 'the default' ? ctx.defaultMs : ctx.timeoutMs;
    assert.equal(ctx.verdict.reportedMs, expectedMs,
      `reporting the wrong budget is how a broken override hides: got ${ctx.verdict.reportedMs}`);
  });

  scoped(/^one place the expeditor states its default is changed to a different budget$/, (ctx) => {
    ctx.scratch = copyTreeForMutation();
    const sites = statedSites();
    // The manual states the budget twice (ms and minutes); changing it there
    // is the harder case, so that is the one scenario 03 uses.
    ctx.mutated = sites.find((s) => s.endsWith('.md')) || sites[0];
    const target = path.join(ctx.scratch, ctx.mutated);
    const before = fs.readFileSync(target, 'utf8');
    // Derive the different budget FROM the stated one rather than picking a
    // literal, so the mutation cannot accidentally equal what the code says.
    const after = before.replace(/\((\d+) min\)/g, (_m, mins) => `(${Number(mins) + 5} min)`);
    assert.notEqual(after, before, `the mutation must actually change ${ctx.mutated}`);
    fs.writeFileSync(target, after);
  });

  scoped(/^every place the expeditor states its default per-stage budget is read$/, (ctx) => {
    try {
      ctx.findings = gateFindings(ctx.scratch || REPO_ROOT);
      ctx.sitesRead = statedSites();
      assert.ok(ctx.sitesRead.length > 0, 'a gate that reads no sites is vacuous');
    } finally {
      if (ctx.scratch) {
        // A fixture dir is removed in a finally, never only after the last
        // assertion - a throw here would otherwise leak it forever.
        fs.rmSync(ctx.scratch, { recursive: true, force: true });
        ctx.scratch = null;
      }
    }
  });

  scoped(/^each of them states the same budget as the code$/, (ctx) => {
    assert.deepEqual(ctx.findings, [],
      `every stated place must agree with default-stage-timeout-ms; drift: ${JSON.stringify(ctx.findings)}`);
  });

  scoped(/^the disagreement is reported$/, (ctx) => {
    assert.ok(ctx.findings.length > 0,
      'a gate that stays silent when a place was changed is not a gate - this is exactly what test 15 did');
  });

  scoped(/^the place that disagrees is named$/, (ctx) => {
    const named = new Set(ctx.findings.map((f) => f.site));
    assert.deepEqual([...named], [ctx.mutated],
      `the gate must name the site a human has to go fix, and only that one; named ${[...named]}`);
  });
}

module.exports = { registerSteps };
