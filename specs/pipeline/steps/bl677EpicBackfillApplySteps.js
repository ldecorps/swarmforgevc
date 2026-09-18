'use strict';

// BL-677: step handlers for "Epic backfill apply". Drives the REAL
// epic_backfill_apply_lib.bb (apply!) against a real fixture git repo -
// never a reimplementation of the batching/refusal/idempotency logic in
// JS. The library's own pure functions (parse-mapping-rows, refusal,
// classify-row, with-epic-line, partition-into-batches) are covered by
// swarmforge/scripts/test/epic_backfill_apply_lib_test_runner.bb; this
// handler proves the real write + real commit-integrity path end to end,
// including the batch/commit count and the byte-identical-on-refusal
// guarantee (a real git status/HEAD comparison, not an assumption).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { onAbnormalExit } = require('./lib/fixtureReaper');

const FEATURE = 'Epic backfill apply';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB_PATH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'epic_backfill_apply_lib.bb');

// BL-1390 fixture rules / BL-693's own bounce this same pass: a mkdtemp
// root, tracked and swept even if the scenario throws before its own
// terminal step's cleanup runs.
const trackedDirs = new Set();
function trackDir(dir) {
  trackedDirs.add(dir);
  return () => {
    if (trackedDirs.delete(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}
onAbnormalExit(() => {
  for (const dir of Array.from(trackedDirs)) {
    trackedDirs.delete(dir);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeTicket(root, pool, id, text) {
  const dir = path.join(root, 'backlog', pool);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), text);
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

// A fixture done tree (untagged BL-010/011/012, BL-020 already carrying
// epic: reliability) plus a two-epic roster (console, reliability) under
// backlog/active/ - the roster an epic definition may itself live
// outside backlog/done/ mirrors epic-backfill-proposals-lib's own
// premise, so the roster tickets are deliberately NOT under done/.
function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl677-acc-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);

  writeTicket(root, 'active', 'BL-900', 'id: BL-900\ntitle: "EPIC - console"\nmilestone: M3\ntype: epic\nepic: console\n');
  writeTicket(root, 'active', 'BL-901', 'id: BL-901\ntitle: "EPIC - reliability"\nmilestone: M5\ntype: epic\nepic: reliability\n');

  writeTicket(root, 'done', 'BL-010', 'id: BL-010\ntitle: "fixture"\nmilestone: M2\nstatus: done\n');
  writeTicket(root, 'done', 'BL-011', 'id: BL-011\ntitle: "fixture"\nmilestone: M2\nstatus: done\n');
  writeTicket(root, 'done', 'BL-012', 'id: BL-012\ntitle: "fixture"\nmilestone: M2\nstatus: done\n');
  writeTicket(root, 'done', 'BL-020', 'id: BL-020\ntitle: "fixture"\nmilestone: M2\nstatus: done\nepic: reliability\n');

  commitAll(root, 'seed fixture repo');
  return root;
}

function readTicket(root, id) {
  return fs.readFileSync(path.join(root, 'backlog', 'done', `${id}-fixture.yaml`), 'utf8');
}

function epicOf(root, id) {
  const m = /^epic:\s*(.*)$/m.exec(readTicket(root, id));
  return m ? m[1].trim() : undefined;
}

function buildMapping({ approved = true, rows = [] } = {}) {
  const lines = ['# Epic backfill proposals (BL-676)', ''];
  if (approved) {
    lines.push('human_approval: approved', '');
  }
  lines.push('| id | tier | proposal | evidence |', '| --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(`| ${r.id} | ${r.tier || 'roster-match'} | ${r.proposal || ''} | ${r.evidence || 'fixture'} |`);
  }
  return lines.join('\n') + '\n';
}

// Shells to the REAL bb library function (never the CLI, whose own
// mapping-path argument is the only thing worth a second entry point -
// see qa_e2e_procedure for that real-CLI check) so tests can inject a
// small :batch-size to exercise batch boundaries against a handful of
// fixture tickets, exactly as BL-677's own "injected commit runner"
// constraint intends for the LIBRARY's seams.
function runApply(root, mappingText, { batchSize } = {}) {
  const mappingPath = path.join(root, '.bl677-mapping.md');
  const runnerPath = path.join(root, '.bl677-run.bb');
  fs.writeFileSync(mappingPath, mappingText);
  const opts = batchSize ? `{:batch-size ${batchSize}}` : '{}';
  fs.writeFileSync(
    runnerPath,
    [
      `(load-file "${LIB_PATH}")`,
      "(require '[cheshire.core :as json])",
      `(let [text (slurp "${mappingPath}")`,
      `      result (epic-backfill-apply-lib/apply! "${root}" text ${opts})]`,
      '  (println (json/generate-string result)))',
    ].join('\n')
  );
  try {
    const out = execFileSync('bb', [runnerPath], { cwd: root, encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    fs.rmSync(mappingPath, { force: true });
    fs.rmSync(runnerPath, { force: true });
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────

  scoped(/^a fixture done tree with untagged tickets and an epic roster "console,reliability"$/, (ctx) => {
    ctx.repo = mkFixtureRepo();
    ctx.cleanupBl677Repo = trackDir(ctx.repo);
  });

  scoped(/^a mapping file derived from the proposal report$/, () => {
    // Flavor/context only - every scenario below builds its own mapping
    // text via buildMapping, which emits the SAME table shape
    // epic-backfill-proposals-lib/render-report does (the real format
    // BL-677's own parse-mapping-rows parses, proven by the unit runner).
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────

  scoped(/^the mapping is approved and maps "([^"]+)" to "([^"]+)"$/, (ctx, id, epic) => {
    ctx.mappingText = buildMapping({ approved: true, rows: [{ id, proposal: epic }] });
  });

  scoped(/^the apply runs$/, (ctx) => {
    ctx.preHead = git(ctx.repo, ['rev-parse', 'HEAD']).trim();
    ctx.preStatus = git(ctx.repo, ['status', '--short']);
    ctx.result = runApply(ctx.repo, ctx.mappingText, ctx.applyOpts || {});
  });

  scoped(/^"([^"]+)" carries epic "([^"]+)" and the write landed via a commit-integrity commit$/, (ctx, id, epic) => {
    try {
      assert.equal(epicOf(ctx.repo, id), epic, `expected ${id} to carry epic ${epic}`);
      const postHead = git(ctx.repo, ['rev-parse', 'HEAD']).trim();
      assert.notEqual(postHead, ctx.preHead, 'expected a new commit');
      assert.equal(ctx.result.refused, false);
      assert.equal(ctx.result.applied, 1);
      assert.equal(ctx.result.commits.length, 1);
      assert.equal(ctx.result.commits[0].success, true, 'expected the commit-integrity call to report success');
      const subject = git(ctx.repo, ['log', '-1', '--format=%s']).trim();
      assert.match(subject, /^BL-677: epic backfill apply/, `expected a commit-integrity subject, got: ${subject}`);
    } finally {
      ctx.cleanupBl677Repo();
    }
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────

  scoped(/^the mapping has no approval line$/, (ctx) => {
    ctx.mappingText = buildMapping({ approved: false, rows: [{ id: 'BL-010', proposal: 'console' }] });
  });

  scoped(/^the run is refused and every backlog file is byte-identical to before$/, (ctx) => {
    // Terminal for scenario 02, but scenarios 03/08 chain one more step
    // ("the refusal names...") after this one - that later step reads
    // only ctx.result (already captured), never the filesystem, so
    // cleaning up the fixture repo here is safe either way.
    // cleanupFixtureRoot's own idempotency (a Set delete, not a second
    // rmSync) makes it harmless if that later step also calls it.
    try {
      assert.equal(ctx.result.refused, true, `expected the run refused, got ${JSON.stringify(ctx.result)}`);
      const postHead = git(ctx.repo, ['rev-parse', 'HEAD']).trim();
      const postStatus = git(ctx.repo, ['status', '--short']);
      assert.equal(postHead, ctx.preHead, 'expected no new commit on a refused run');
      assert.equal(postStatus, ctx.preStatus, 'expected no working-tree changes on a refused run');
    } finally {
      ctx.cleanupBl677Repo();
    }
  });

  // ── Scenario 03 / 08 (shared "names" step) ──────────────────────────

  scoped(/^the mapping is approved and one row maps "([^"]+)" to "([^"]+)"$/, (ctx, id, epic) => {
    ctx.mappingText = buildMapping({ approved: true, rows: [{ id, proposal: epic }] });
  });

  scoped(/^the refusal names "([^"]+)"$/, (ctx, token) => {
    try {
      assert.match(ctx.result.detail || '', new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    } finally {
      ctx.cleanupBl677Repo();
    }
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────

  scoped(
    /^the mapping is approved and maps "([^"]+)" to "([^"]+)" but "([^"]+)" already carries epic "([^"]+)"$/,
    (ctx, mapId, proposedEpic, taggedId, currentEpic) => {
      assert.equal(mapId, taggedId, 'bl677: fixture error - the mapped id and the already-tagged id must match');
      assert.equal(epicOf(ctx.repo, taggedId), currentEpic, `bl677: fixture error - expected ${taggedId} pre-seeded with epic ${currentEpic}`);
      ctx.mappingText = buildMapping({ approved: true, rows: [{ id: mapId, proposal: proposedEpic }] });
    }
  );

  scoped(/^"([^"]+)" still carries epic "([^"]+)" and the summary reports it skipped$/, (ctx, id, epic) => {
    try {
      assert.equal(epicOf(ctx.repo, id), epic, `expected ${id} unchanged at epic ${epic}`);
      assert.equal(ctx.result.refused, false);
      assert.equal(ctx.result.applied, 0);
      assert.equal(ctx.result['skipped-already-tagged'], 1);
    } finally {
      ctx.cleanupBl677Repo();
    }
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────

  scoped(/^the mapping is approved and the "([^"]+)" row has an empty proposal cell$/, (ctx, id) => {
    ctx.bl677EmptyProposalId = id;
    ctx.mappingText = buildMapping({ approved: true, rows: [{ id, tier: 'needs-judgment', proposal: '' }] });
  });

  scoped(/^"([^"]+)" is unchanged and the summary reports it skipped for judgment$/, (ctx, id) => {
    try {
      assert.equal(epicOf(ctx.repo, id), undefined, `expected ${id} to remain untagged`);
      assert.equal(ctx.result.refused, false);
      assert.equal(ctx.result.applied, 0);
      assert.equal(ctx.result['skipped-empty-proposal'], 1);
    } finally {
      ctx.cleanupBl677Repo();
    }
  });

  // ── Scenario 06 ──────────────────────────────────────────────────────

  scoped(/^the mapping is approved with more rows than one batch holds$/, (ctx) => {
    const ids = ['BL-010', 'BL-030', 'BL-031', 'BL-032', 'BL-033', 'BL-034', 'BL-035'];
    for (const id of ids.slice(1)) {
      writeTicket(ctx.repo, 'done', id, `id: ${id}\ntitle: "fixture"\nmilestone: M2\nstatus: done\n`);
    }
    commitAll(ctx.repo, 'seed extra fixture tickets for the batch-overflow scenario');
    ctx.applyOpts = { batchSize: 3 };
    ctx.mappingText = buildMapping({ approved: true, rows: ids.map((id) => ({ id, proposal: 'console' })) });
  });

  scoped(/^the commit count equals the batch count and every commit went via commit integrity$/, (ctx) => {
    try {
      assert.equal(ctx.result.refused, false);
      assert.ok(ctx.result.batches > 1, `expected more than one batch, got ${ctx.result.batches}`);
      assert.equal(ctx.result.commits.length, ctx.result.batches, 'expected exactly one commit per batch');
      assert.ok(
        ctx.result.commits.every((c) => c.success === true),
        `expected every batch commit to succeed, got ${JSON.stringify(ctx.result.commits)}`
      );
      const log = git(ctx.repo, ['log', '--oneline']).trim().split('\n');
      // seed + extra-fixture-seed + one commit per batch.
      assert.equal(log.length, 2 + ctx.result.batches, `expected ${2 + ctx.result.batches} total commits, got ${log.length}`);
    } finally {
      ctx.cleanupBl677Repo();
    }
  });

  // ── Scenario 07 ──────────────────────────────────────────────────────

  scoped(/^the apply already ran to completion with this mapping$/, (ctx) => {
    ctx.mappingText = buildMapping({ approved: true, rows: [{ id: 'BL-010', proposal: 'console' }] });
    const firstRun = runApply(ctx.repo, ctx.mappingText, {});
    assert.equal(firstRun.refused, false, `bl677: fixture setup - expected the first run to succeed, got ${JSON.stringify(firstRun)}`);
    assert.equal(firstRun.applied, 1, 'bl677: fixture setup - expected the first run to apply exactly one row');
  });

  scoped(/^no file changes and no commit is created$/, (ctx) => {
    try {
      const postHead = git(ctx.repo, ['rev-parse', 'HEAD']).trim();
      const postStatus = git(ctx.repo, ['status', '--short']);
      assert.equal(ctx.result.refused, false, 'a re-run is not a refusal - there is simply nothing left to write');
      assert.equal(ctx.result.applied, 0, 'expected zero applies on the second run');
      assert.equal(ctx.result.batches, 0, 'expected zero batches (and so zero commits) on the second run');
      assert.equal(postHead, ctx.preHead, 'expected no new commit on the idempotent re-run');
      assert.equal(postStatus, ctx.preStatus, 'expected no working-tree changes on the idempotent re-run');
    } finally {
      ctx.cleanupBl677Repo();
    }
  });

  // ── Scenario 08 ──────────────────────────────────────────────────────

  scoped(/^the mapping is approved and one row names "([^"]+)" which has no file under done$/, (ctx, id) => {
    ctx.mappingText = buildMapping({ approved: true, rows: [{ id, proposal: 'console' }] });
  });
}

module.exports = { registerSteps };
