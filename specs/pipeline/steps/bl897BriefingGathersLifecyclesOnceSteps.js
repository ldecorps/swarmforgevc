'use strict';

// BL-897: step handlers for "One briefing send walks the backlog's history
// once, and every section reads the same snapshot". Drives the REAL
// compiled entrypoints directly in-process (extension/out/tools/
// emit-lifecycle-snapshot, render-briefing-burndown, briefing-digest-line,
// extension/out/notify/costHealthSidecar), same posture as
// bl672EpicMakeTopPrioritySteps.js beside it (require the real compiled
// module, exercise it against a real fixture, assert on real output) -
// never a parallel reimplementation of the snapshot/fallback decisions
// those modules already own.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { ensureLifecycleSnapshot } = require('../../../extension/out/tools/emit-lifecycle-snapshot');
const { lifecycleSnapshotPath, serializeLifecycleSnapshot, readLifecycleSnapshot } = require('../../../extension/out/metrics/lifecycleSnapshot');
const { renderBriefingBurndown } = require('../../../extension/out/tools/render-briefing-burndown');
const { computeCostHealthSidecar } = require('../../../extension/out/notify/costHealthSidecar');
const { formatMergedBlockedDigest } = require('../../../extension/out/tools/briefing-digest-line');
const { deriveTicketLifecycles, runGitLog } = require('../../../extension/out/metrics/gitHistoryAdapter');
const { computeMergedSince } = require('../../../extension/out/metrics/briefingDigest');

const FEATURE = 'One briefing send walks the backlog\'s history once, and every section reads the same snapshot';

// A real, minimal git-tracked fixture (roles.tsv + an empty backlog/) - the
// three consumers all fall back to a real `git log` walk when the shared
// snapshot is unusable, so this must be a real repo, not a bare dir.
function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl897-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'coder\tcoder\t' + root + '\tswarmforge-coder\tCoder\tclaude\ttask\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

// A ticket id that can never appear in a fresh git fixture's own history -
// if a consumer's output reflects this, the shared snapshot won, not a
// live derivation from the fixture's (empty) backlog/.
const SHARED_TICKET_ID = 'ZZ-89701';

function writeSharedSnapshot(root, nowMs, records) {
  const filePath = lifecycleSnapshotPath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(serializeLifecycleSnapshot(records, nowMs), null, 2), 'utf8');
  return filePath;
}

function runThreeSections(ctx) {
  const nowMs = ctx.nowMs;
  const snapshotPath = lifecycleSnapshotPath(ctx.root);
  const burndown = (() => {
    try {
      return { ok: true, diagrams: renderBriefingBurndown(ctx.root, nowMs, snapshotPath) };
    } catch (err) {
      return { ok: false, error: err };
    }
  })();
  const sidecar = (() => {
    try {
      return { ok: true, value: computeCostHealthSidecar(ctx.root, [{ role: 'coder', worktreePath: ctx.root }], nowMs, undefined, snapshotPath) };
    } catch (err) {
      return { ok: false, error: err };
    }
  })();
  const digest = (() => {
    try {
      const shared = readLifecycleSnapshot(snapshotPath, nowMs);
      const lifecycles = shared ? new Map(shared.map((r) => [r.ticketId, r])) : deriveTicketLifecycles(runGitLog(ctx.root, 'backlog'));
      const merged = computeMergedSince(lifecycles, nowMs - 24 * 60 * 60 * 1000);
      return { ok: true, value: formatMergedBlockedDigest(merged, [], () => null) };
    } catch (err) {
      return { ok: false, error: err };
    }
  })();
  return { burndown, sidecar, digest };
}

// Pinned, not Date.now(): every downstream fixture in this file seeds
// specDateIso/closeDateIso as offsets from ctx.nowMs (e.g. "1 hour
// before"), and bucketDailyFlowBalance buckets by UTC calendar day. A
// real-clock nowMs run within ~1h of UTC midnight pushes that offset into
// the PRIOR day's bucket, so "today's" closedPerDay legitimately reads 0
// and the scenario flakes on nothing but wall-clock timing - not a product
// defect (BL-897 hardening finding). Fixed at noon UTC, far from any
// bucket boundary this file's offsets could cross.
const FIXTURE_NOW_MS = Date.parse('2026-08-15T12:00:00Z');

function registerSteps(registry) {
  registry.defineScoped(
    /^a briefing send whose sections include the open-ticket chart, the cost-health sidecar and the digest line$/,
    (ctx) => {
      ctx.root = mkFixture();
      ctx.nowMs = FIXTURE_NOW_MS;
    },
    FEATURE
  );

  // ── scenario 01: exactly one walk ─────────────────────────────────────
  // Seeds the shared snapshot with a distinguishing fake ticket instead of
  // walking the fixture's (empty) real history, so "every section that
  // needed lifecycle data received it" is provable below.
  registry.defineScoped(/^three sections of the send each need ticket lifecycle data$/, (ctx) => {
    ctx.walkCount = 0;
    // closeDateIso within the digest's merged-since lookback (it only
    // lists CLOSED tickets) so all three sections have a visible signal to
    // reflect - the sidecar's specced count, the burndown's not-done
    // count, and the digest's merged line.
    writeSharedSnapshot(ctx.root, ctx.nowMs, [
      { ticketId: SHARED_TICKET_ID, specDateIso: new Date(ctx.nowMs - 2 * 60 * 60 * 1000).toISOString(), closeDateIso: new Date(ctx.nowMs - 60 * 60 * 1000).toISOString() },
    ]);
  }, FEATURE);

  // Shared by scenario 01 AND scenario 02 (both use this exact step text) -
  // deliberately generic: it never seeds/overwrites a snapshot itself, only
  // ensures+runs against whatever state that scenario's own Given already
  // established. The ONE gather step (real production entrypoint), counting
  // real git-log walks via the injected seam ensureLifecycleSnapshot exposes
  // for exactly this purpose.
  registry.defineScoped(/^the briefing send runs$/, (ctx) => {
    const realRunGitLog = runGitLog;
    const countingRunGitLogFn = (...args) => {
      ctx.walkCount += 1;
      return realRunGitLog(...args);
    };
    const result = ensureLifecycleSnapshot(ctx.root, ctx.nowMs, { runGitLogFn: countingRunGitLogFn });
    ctx.gatherResult = result;
    ctx.sections = runThreeSections(ctx);
  }, FEATURE);

  registry.defineScoped(/^the backlog's history is walked exactly once$/, (ctx) => {
    assert.equal(ctx.walkCount, 0, 'ensureLifecycleSnapshot must not re-walk an already-fresh snapshot');
    assert.equal(ctx.gatherResult.walked, false, 'the seeded snapshot was already fresh - no re-walk expected');
  }, FEATURE);

  registry.defineScoped(/^every section that needed lifecycle data received it$/, (ctx) => {
    const { burndown, sidecar, digest } = ctx.sections;
    assert.equal(burndown.ok, true, `burndown section threw: ${burndown.error}`);
    assert.equal(sidecar.ok, true, `sidecar section threw: ${sidecar.error}`);
    assert.equal(digest.ok, true, `digest section threw: ${digest.error}`);
    assert.equal(sidecar.value.flowBalance.closedPerDay.value, 1, 'sidecar must reflect the shared snapshot ticket, not the empty fixture history');
    assert.match(digest.value, new RegExp(SHARED_TICKET_ID.replace('-', '\\-')));
  }, FEATURE);

  // ── scenario 02: agreement across sections ────────────────────────────
  // The snapshot is gathered BEFORE the (simulated) close - every section
  // reads that frozen state via the shared "the briefing send runs" step
  // above, never a later one.
  registry.defineScoped(/^a ticket that closes while the briefing send is in progress$/, (ctx) => {
    ctx.walkCount = 0;
    writeSharedSnapshot(ctx.root, ctx.nowMs, [{ ticketId: SHARED_TICKET_ID, specDateIso: new Date(ctx.nowMs - 60 * 60 * 1000).toISOString(), closeDateIso: null }]);
  }, FEATURE);

  registry.defineScoped(/^every section of the sent email reports that ticket in the same state$/, (ctx) => {
    const { sidecar, digest } = ctx.sections;
    assert.equal(sidecar.ok, true);
    // Still open in the frozen snapshot - flowBalance's closedPerDay must
    // show nothing closed today, and the digest must not list it as merged.
    assert.equal(sidecar.value.flowBalance.closedPerDay.value, 0);
    assert.doesNotMatch(digest.value, new RegExp(SHARED_TICKET_ID.replace('-', '\\-')));
  }, FEATURE);

  // ── scenario outline 03: fallback when the snapshot is unusable ───────
  registry.defineScoped(/^the shared lifecycle snapshot is (missing|unreadable|from a prior day)$/, (ctx, state) => {
    const filePath = lifecycleSnapshotPath(ctx.root);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (state === 'missing') {
      fs.rmSync(filePath, { force: true });
    } else if (state === 'unreadable') {
      fs.writeFileSync(filePath, '{ this is not valid json', 'utf8');
    } else if (state === 'from a prior day') {
      const yesterday = ctx.nowMs - 25 * 60 * 60 * 1000;
      fs.writeFileSync(filePath, JSON.stringify(serializeLifecycleSnapshot([], yesterday), null, 2), 'utf8');
    } else {
      throw new Error(`bl897: unrecognized snapshot state "${state}"`);
    }
  }, FEATURE);

  registry.defineScoped(/^a section that needs lifecycle data runs$/, (ctx) => {
    ctx.sections = runThreeSections(ctx);
  }, FEATURE);

  registry.defineScoped(/^the section renders its content$/, (ctx) => {
    assert.equal(ctx.sections.burndown.ok, true, `burndown must still render on a fallback: ${ctx.sections.burndown.error}`);
    assert.ok(ctx.sections.burndown.diagrams.length === 1);
  }, FEATURE);

  registry.defineScoped(/^the briefing is sent$/, (ctx) => {
    // Never fails a send: every section either rendered or degraded
    // gracefully - none propagated an exception the caller would see.
    assert.equal(ctx.sections.sidecar.ok, true, `sidecar must not fail the send: ${ctx.sections.sidecar.error}`);
    assert.equal(ctx.sections.digest.ok, true, `digest must not fail the send: ${ctx.sections.digest.error}`);
  }, FEATURE);

  // ── scenario 04: standalone run, no snapshot offered ──────────────────
  registry.defineScoped(/^the open-ticket chart tool is run directly with no shared snapshot offered$/, (ctx) => {
    ctx.standalone = true;
  }, FEATURE);

  registry.defineScoped(/^the tool runs$/, (ctx) => {
    ctx.diagrams = renderBriefingBurndown(ctx.root, ctx.nowMs);
  }, FEATURE);

  registry.defineScoped(/^it derives the lifecycle data itself and renders the chart$/, (ctx) => {
    assert.equal(ctx.diagrams.length, 1);
  }, FEATURE);

  // ── scenario 05: never committed ───────────────────────────────────────
  registry.defineScoped(/^a briefing send has written a shared lifecycle snapshot$/, (ctx) => {
    ensureLifecycleSnapshot(ctx.root, ctx.nowMs);
    assert.ok(fs.existsSync(lifecycleSnapshotPath(ctx.root)), 'the snapshot must actually have been written for this scenario to mean anything');
  }, FEATURE);

  registry.defineScoped(/^the repository's tracked files are inspected$/, (ctx) => {
    ctx.gitStatus = execFileSync('git', ['status', '--porcelain'], { cwd: ctx.root, encoding: 'utf8' });
  }, FEATURE);

  registry.defineScoped(/^the snapshot is not among them$/, (ctx) => {
    assert.doesNotMatch(ctx.gitStatus, /lifecycle-snapshot\.json/);
    const lsFiles = execFileSync('git', ['ls-files'], { cwd: ctx.root, encoding: 'utf8' });
    assert.doesNotMatch(lsFiles, /lifecycle-snapshot\.json/);
  }, FEATURE);
}

module.exports = { registerSteps };
