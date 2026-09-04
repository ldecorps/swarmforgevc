'use strict';

// BL-1387: an open merge nobody owns is surfaced as orphaned, not as a
// human's.
//
// The sweep's only reading of an open MERGE_HEAD was "a human is mid-merge,
// hold", asserted from presence alone - no owner, no process, no lock, no
// index. On 2026-09-04 that held two roles and the daemon for fifteen minutes
// on a merge with no owning process whose index carried NONE of the incoming
// side; a `git commit` there would have written a merge whose tree reverted
// the whole origin side.
//
// Every scenario drives the REAL classifier over a REAL repository with a
// REAL open MERGE_HEAD, a REAL index and a REAL lock file, through
// lib/bl1387OrphanedMergeCli.sh. The index-poisoning reading is the whole of
// invariant 3 and a stubbed index could not exhibit it. The one injected
// input is the live-git-process signal: parking a real long-lived `git merge`
// on its editor is the environmentally unsuitable boundary, and the adapter
// that reads /proc/<pid>/cwd is exercised there rather than here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1387OrphanedMergeCli.sh');
const FIXTURE_PREFIX = 'bl1387-acc-';

const FEATURE = 'BL-1387 An open merge nobody owns is surfaced as orphaned, not as a human\'s';

// The Examples' own words, mapped to the fixture shape each is built as.
// Explicit KNOWN_VALUES: an unrecognised row throws rather than passing
// through unchecked.
const OWNER_SIGNALS = {
  'a live git process whose cwd is the checkout': 'live-process',
  'an index lock younger than the freshness window': 'fresh-lock',
  'an ownership record naming the MERGE_HEAD sha': 'owned',
};

const INDEX_STATES = {
  'carries none of': 'orphan-poisoned',
  carries: 'orphan-carrying',
};

const INDEX_WORDING = {
  'carries none of': 'carries none of the incoming side',
  carries: 'carries the incoming side',
};

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
      timeout: 300_000,
    });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a fixture checkout with an open MERGE_HEAD created outside the sweep$/, (ctx) => {
    // The default is the 2026-09-04 shape: no owner, poisoned index. Later
    // Given steps narrow it.
    ctx.bl1387 = { shape: 'orphan-poisoned' };
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^no git process runs on the checkout$/, (ctx) => {
    ctx.bl1387.noProcess = true;
  });

  scoped(/^no index lock is present$/, (ctx) => {
    ctx.bl1387.noLock = true;
  });

  scoped(/^an index lock older than the freshness window$/, (ctx) => {
    ctx.bl1387.shape = 'stale-lock';
  });

  scoped(/^(a live git process whose cwd is the checkout|an index lock younger than the freshness window|an ownership record naming the MERGE_HEAD sha)$/, (ctx, signal) => {
    const shape = OWNER_SIGNALS[signal.trim()];
    assert.ok(shape, `unknown owner signal: ${signal}`);
    ctx.bl1387.shape = shape;
  });

  scoped(/^the index (carries none of|carries) the paths of HEAD\.\.MERGE_HEAD$/, (ctx, state) => {
    const shape = INDEX_STATES[state.trim()];
    assert.ok(shape, `unknown index state: ${state}`);
    ctx.bl1387.shape = shape;
    ctx.bl1387.indexState = state.trim();
  });

  scoped(/^the index shows no unmerged paths$/, (ctx) => {
    ctx.bl1387.expectNoUnmergedPaths = true;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^one sweep tick runs$/, (ctx) => {
    assert.ok(ctx.bl1387.shape, 'no fixture shape was chosen');
    ctx.bl1387.report = runFixture(ctx.bl1387.shape);
    // The scenario asserting "no unmerged paths" must be measuring a fixture
    // that genuinely has none, or invariant 3's point is not being made.
    if (ctx.bl1387.expectNoUnmergedPaths) {
      assert.equal(
        ctx.bl1387.report.unmergedPaths,
        0,
        `the fixture has unmerged paths, so it is not the poisoned-but-clean-looking shape: ${JSON.stringify(ctx.bl1387.report)}`
      );
    }
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the surfaced reason is orphaned-merge naming the MERGE_HEAD sha$/, (ctx) => {
    const { report } = ctx.bl1387;
    assert.equal(report.reason, 'orphaned-merge', `classified ${report.class}: ${report.surface}`);
    const shortSha = report.mergeHeadBefore.slice(0, 10);
    assert.ok(
      report.surface.includes(shortSha),
      `the surface does not name the merge (${shortSha}): ${report.surface}`
    );
  });

  scoped(/^the surfaced reason is human-merge-in-progress$/, (ctx) => {
    const { report } = ctx.bl1387;
    assert.equal(
      report.reason,
      'human-merge-in-progress',
      `an owner signal was present, yet the merge was called an orphan: ${JSON.stringify(report)}`
    );
  });

  scoped(/^the deadlock record reads reason orphaned-merge$/, (ctx) => {
    // The deadlock record and the status CLI both read the SURFACED reason
    // (`main_sync_status_cli.bb` takes `:reconcile-surfaced (:surfaced …)`),
    // so the reason reaching them is the reason the sweep surfaces.
    assert.equal(ctx.bl1387.report.reason, 'orphaned-merge');
  });

  scoped(/^the sync status CLI reports reason orphaned-merge$/, (ctx) => {
    assert.equal(ctx.bl1387.report.reason, 'orphaned-merge');
  });

  scoped(/^the escalation fires on that tick$/, (ctx) => {
    const { report } = ctx.bl1387;
    assert.ok(report.escalation, `no escalation text was produced: ${JSON.stringify(report)}`);
    // An orphan is not a human needing patience: the escalation carries the
    // remedy AND its one dangerous step on the first tick, not the third.
    assert.match(report.escalation, /abort and redo/, report.escalation);
    assert.match(report.escalation, /back up staged-new files first/, report.escalation);
  });

  // BL-1387 scenario 06, added by the specifier's 2026-09-04 amendment after
  // the owned row was RETIRED: BL-1386's fix aborts an owned merge rather than
  // surfacing it as a human's, so "an ownership record keeps the human
  // reading" stopped being true. The daemon's own leftover is now its own
  // category, which is what the classifier was for.
  scoped(/^the open merge is classified as the daemon's own$/, (ctx) => {
    assert.equal(
      ctx.bl1387.report.class,
      'own',
      `an ownership record naming the MERGE_HEAD sha did not classify as :own: ${JSON.stringify(ctx.bl1387.report)}`
    );
  });

  scoped(/^the surfaced reason is neither human-merge-in-progress nor orphaned-merge$/, (ctx) => {
    const { reason } = ctx.bl1387.report;
    assert.notEqual(reason, 'human-merge-in-progress', 'the daemon called its own leftover a human\'s');
    assert.notEqual(reason, 'orphaned-merge', 'the daemon called its own leftover an orphan');
    // Positively pinned, not merely "not the other two": an else-branch that
    // absorbed the new value is exactly what the BL-1386 D1b bounce was about.
    assert.equal(
      reason,
      'aborted-owned-merge',
      `expected the owned reading, got ${reason}: ${JSON.stringify(ctx.bl1387.report.logs)}`
    );
  });

  scoped(/^the escalation does not fire early$/, (ctx) => {
    assert.equal(
      ctx.bl1387.report.escalation,
      null,
      `a live owner escalated as though it were an orphan: ${ctx.bl1387.report.escalation}`
    );
  });

  scoped(/^the surfaced text says the index (carries none of|carries) the incoming side$/, (ctx, wording) => {
    const expected = INDEX_WORDING[wording.trim()];
    assert.ok(expected, `unknown wording: ${wording}`);
    assert.ok(
      ctx.bl1387.report.surface.includes(expected),
      `expected "${expected}" in: ${ctx.bl1387.report.surface}`
    );
    // ...and the reading is NOT the unmerged-path count, which is zero for
    // both rows. That is what makes a poisoned index look clean.
    assert.equal(ctx.bl1387.report.unmergedPaths, 0);
  });

  scoped(/^MERGE_HEAD is still present after the tick$/, (ctx) => {
    const { report } = ctx.bl1387;
    assert.equal(
      report.mergeHeadAfter,
      report.mergeHeadBefore,
      `classification changed MERGE_HEAD - this ticket aborts nothing: ${JSON.stringify(report)}`
    );
    assert.notEqual(report.mergeHeadAfter, '', 'MERGE_HEAD was cleared by a classification');
  });

  scoped(/^the index is byte-identical to before the tick$/, (ctx) => {
    const { report } = ctx.bl1387;
    assert.equal(
      report.indexAfter,
      report.indexBefore,
      `classification mutated the index (invariant 2): ${JSON.stringify(report)}`
    );
  });
}

module.exports = { registerSteps };
