'use strict';

// BL-1076: step handlers for "a batch claim is judged stale only when its
// owner shows no work".
//
// Every scenario drives the REAL sweep - batch_claim_progress_sweep_harness.bb,
// which mirrors handoffd.bb's batch-claim-progress-sweep! call for call (same
// chase_sweep_lib.bb functions, same real swarm_handoff.bb send path, same
// per-role threshold resolution, same conf parser). The defect was never in
// one pure predicate: it was in which threshold the sweep resolved and which
// signals it read, so only driving the sweep exercises the thing that broke.
//
// SCOPED, not global. BL-678's handlers register "the chase sweep runs" and
// "the parcel remains claimed in in_process with no copy in inbox new"
// UNSCOPED, and both texts appear in this feature too. defineScoped pins every
// step below to this feature so the two never resolve into each other's
// fixtures (BL-425).
//
// Determinism: no wall-clock sleeps. "N minutes have passed" writes the
// sidecar's own lastProgressAtMs to now - N minutes, the same injected-clock
// posture BL-678's handlers use.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1076 a batch claim is judged stale only when its owner shows no work';

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const READY_BATCH_BB = path.join(SWARMFORGE_SCRIPTS, 'ready_for_next_batch.bb');
const SWEEP_HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'batch_claim_progress_sweep_harness.bb');

const MINUTE_MS = 60_000;
// Long enough that no scenario's single sweep is ever throttled by it.
const COOLDOWN_MS = MINUTE_MS;

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function worktreeFor(ctx) {
  return path.join(ctx.root, '.worktrees', ctx.role);
}

function inProcessDir(ctx) {
  return path.join(worktreeFor(ctx), '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function newDir(ctx) {
  return path.join(worktreeFor(ctx), '.swarmforge', 'handoffs', 'inbox', 'new');
}

function coordinatorOutbox(ctx) {
  return path.join(ctx.root, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function writeHandoff(dir, basename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, basename),
    Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\nbody\n'
  );
}

// Builds the fixture for whichever role the scenario named. Called lazily by
// the first step that knows the role, because the owning role IS the variable
// under test here - it cannot be fixed in the Background.
function buildFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1076-'));
  ctx.root = root;
  git(root, ['init', '-q']);
  // The daemon's dirtiness signal is `git status --porcelain` in the role
  // worktree, and .swarmforge/ is runtime state, not work. Ignoring it here
  // mirrors the real repo, and without it every fixture worktree would read
  // dirty forever and the clean rows of the outline would be unreachable.
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n.worktrees/\n');
  git(root, ['add', '.gitignore']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);

  const wt = worktreeFor(ctx);
  git(root, ['worktree', 'add', '-q', '-b', ctx.role, wt]);

  const rolesTsv =
    [
      [ctx.role, ctx.role, wt, `swarmforge-${ctx.role}`, ctx.role, 'claude', 'batch'],
      ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ]
      .map((r) => r.join('\t'))
      .join('\n') + '\n';
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesTsv);
  fs.writeFileSync(path.join(wt, '.swarmforge', 'roles.tsv'), rolesTsv);

  // Three parcels, as the live incident had - one claim, three sidecars, and
  // scenario 04 is specifically about all three moving together.
  for (const [i, id] of [
    ['10', 'BL-1076'],
    ['20', 'BL-1077'],
    ['30', 'BL-1078'],
  ]) {
    writeHandoff(newDir(ctx), `${i}_item.handoff`, {
      id: `t${i}`,
      from: 'specifier',
      to: ctx.role,
      recipient: ctx.role,
      priority: '50',
      type: 'note',
      message: `${id} batch item`,
      created_at: '2026-08-22T20:20:18Z',
    });
  }

  // The REAL production claim path, so the sidecars this test reads are the
  // ones production writes.
  execFileSync('bb', [READY_BATCH_BB], { cwd: wt, env: { ...process.env, SWARMFORGE_ROLE: ctx.role } });

  const batches = fs.readdirSync(inProcessDir(ctx)).filter((e) => e.startsWith('batch_'));
  assert.equal(batches.length, 1, `expected exactly one batch dir, got: ${batches.join(', ')}`);
  ctx.batchDir = path.join(inProcessDir(ctx), batches[0]);
  ctx.parcelPaths = ['10_item.handoff', '20_item.handoff', '30_item.handoff'].map((b) =>
    path.join(ctx.batchDir, b)
  );
}

function sidecarPath(p) {
  return `${p}.batch-claim-progress.json`;
}

function readSidecar(p) {
  return JSON.parse(fs.readFileSync(sidecarPath(p), 'utf8'));
}

function writeConf(ctx) {
  const confDir = path.join(ctx.root, 'swarmforge');
  fs.mkdirSync(confDir, { recursive: true });
  const lines = [];
  if (ctx.configuredHardenerMinutes !== undefined) {
    lines.push(
      `config batch_claim_progress_role_stale_threshold_minutes hardender ${ctx.configuredHardenerMinutes}`
    );
  }
  fs.writeFileSync(path.join(confDir, 'swarmforge.conf'), lines.join('\n') + '\n');
}

// Runs the real sweep and classifies what it did to our parcel - which is the
// observation, read off behaviour rather than asked of a predicate.
function runSweep(ctx) {
  writeConf(ctx);
  ctx.sweepOutput = execFileSync(
    'bb',
    [SWEEP_HARNESS, ctx.root, '-', String(COOLDOWN_MS), ctx.worktreeState === 'dirty' ? 'dirty' : 'clean'],
    { encoding: 'utf8' }
  );
  const notes = notesToCoordinator(ctx);
  const suppressed = ctx.sweepOutput
    .split('\n')
    .filter((l) => l.startsWith('SUPPRESSED '));

  if (suppressed.length > 0) {
    ctx.observation = 'suppressed-visible-work';
  } else if (notes.length > 0) {
    ctx.observation = 'stale-suspect';
  } else {
    ctx.observation = 'silent';
  }
  ctx.suppressedLines = suppressed;
  ctx.notes = notes;
}

function notesToCoordinator(ctx) {
  let files;
  try {
    files = fs.readdirSync(coordinatorOutbox(ctx)).filter((f) => f.endsWith('.handoff'));
  } catch {
    files = [];
  }
  return files
    .map((f) => fs.readFileSync(path.join(coordinatorOutbox(ctx), f), 'utf8'))
    .filter((c) => /batch claim stale/.test(c));
}

function ageAllSidecars(ctx, minutes) {
  const nowMs = Date.now();
  ctx.agedMinutes = minutes;
  for (const p of ctx.parcelPaths) {
    const sidecar = readSidecar(p);
    sidecar.lastProgressAtMs = nowMs - minutes * MINUTE_MS;
    sidecar.claimAtMs = Math.min(sidecar.claimAtMs, sidecar.lastProgressAtMs);
    fs.writeFileSync(sidecarPath(p), JSON.stringify(sidecar));
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a batch role holds a claimed parcel whose worktree HEAD has not moved since its last recorded progress$/,
    (ctx) => {
      // The fixture is built once the scenario names its role; every scenario
      // does, directly or through the two "observation is X" Givens below.
      ctx.worktreeState = 'clean';
    }
  );

  scoped(/^the owning role is (\S+)$/, (ctx, role) => {
    if (!ctx.root) {
      ctx.role = role;
      buildFixture(ctx);
    } else {
      assert.equal(ctx.role, role, 'the fixture was already built for a different role');
    }
  });

  scoped(/^its worktree is (clean|dirty)$/, (ctx, state) => {
    ctx.worktreeState = state;
  });

  scoped(/^(\d+) minutes have passed since the last recorded progress$/, (ctx, minutes) => {
    ageAllSidecars(ctx, Number(minutes));
  });

  scoped(/^the configured hardener batch stale threshold is (\S+)$/, (ctx, configured) => {
    // "absent" means the key is not written at all - which is a different
    // thing from writing an unusable value, and the outline tests both.
    if (configured !== 'absent') ctx.configuredHardenerMinutes = configured;
  });

  scoped(/^the observation is (silent|stale-suspect|suppressed-visible-work)$/, (ctx, expected) => {
    if (!ctx.observation) runSweep(ctx);
    assert.equal(
      ctx.observation,
      expected,
      `role=${ctx.role} worktree=${ctx.worktreeState} aged=${ctx.agedMinutes}m ` +
        `conf=${ctx.configuredHardenerMinutes ?? 'absent'}\nsweep output:\n${ctx.sweepOutput}`
    );
  });

  // ── 02 and 03: the two Givens that name an observation up front ──────────
  // Each builds the smallest state that PRODUCES that observation for real,
  // rather than asserting it - the assertions are the Thens that follow.

  scoped(/^a claimed parcel whose observation is stale-suspect$/, (ctx) => {
    ctx.role = 'cleaner';
    buildFixture(ctx);
    ctx.worktreeState = 'clean';
    ageAllSidecars(ctx, 25); // past cleaner's 20-minute base
  });

  scoped(/^a claimed parcel whose observation is suppressed-visible-work$/, (ctx) => {
    ctx.role = 'hardender';
    buildFixture(ctx);
    ctx.worktreeState = 'dirty';
    ageAllSidecars(ctx, 95); // past hardener's 90-minute tolerance
  });

  scoped(/^the chase sweep runs$/, (ctx) => {
    runSweep(ctx);
  });

  scoped(
    /^the coordinator receives one suspect note naming the parcel and its progress age$/,
    (ctx) => {
      assert.equal(
        ctx.observation,
        'stale-suspect',
        `expected a genuine suspect, got ${ctx.observation}\n${ctx.sweepOutput}`
      );
      const named = ctx.notes.filter((c) => /^message: BL-1076 /m.test(c));
      assert.equal(named.length, 1, `expected exactly one note naming BL-1076, got:\n${ctx.notes.join('\n---\n')}`);
      assert.match(named[0], /^to: coordinator$/m, 'the suspect note goes to the coordinator only');
      assert.match(
        named[0],
        /batch claim stale \d+m since progress/,
        'the suspect note carries the progress age'
      );
    }
  );

  scoped(/^the parcel remains claimed in in_process with no copy in inbox new$/, (ctx) => {
    for (const p of ctx.parcelPaths) {
      assert.ok(fs.existsSync(p), `the parcel must stay claimed in in_process: ${p}`);
      const redelivered = path.join(newDir(ctx), path.basename(p));
      assert.ok(!fs.existsSync(redelivered), `nothing may be re-delivered to inbox/new: ${redelivered}`);
    }
  });

  scoped(/^no suspect note is sent to the coordinator$/, (ctx) => {
    assert.deepEqual(
      ctx.notes,
      [],
      `a suppressed observation must send nothing, got:\n${ctx.notes.join('\n---\n')}`
    );
  });

  scoped(/^the sweep records the suppression against the parcel id with its reason$/, (ctx) => {
    // Invariant 2: a suppression that went unrecorded would let a permanently
    // dirty worktree silence the signal with nothing to show for it.
    assert.equal(
      ctx.suppressedLines.length,
      ctx.parcelPaths.length,
      `every suppressed parcel must be recorded, got:\n${ctx.sweepOutput}`
    );
    assert.ok(
      ctx.suppressedLines.some((l) => l.includes('BL-1076')),
      `the suppression must name the parcel id, got:\n${ctx.sweepOutput}`
    );
    for (const line of ctx.suppressedLines) {
      assert.match(line, /worktree-dirty/, `each suppression must carry its reason, got: ${line}`);
    }
  });

  // ── 04: a commit clears the whole batch, not just the parcel that moved ──
  scoped(/^the role's worktree HEAD advances and the chase sweep runs$/, (ctx) => {
    const wt = worktreeFor(ctx);
    fs.writeFileSync(path.join(wt, 'progress.txt'), 'real work\n');
    git(wt, ['add', 'progress.txt']);
    git(wt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'BL-1076 progress']);
    ctx.newCommit = git(wt, ['rev-parse', '--short=10', 'HEAD']).trim();
    // The commit left the worktree clean, so this proves the HEAD signal on
    // its own - not the dirtiness gate standing in for it.
    ctx.worktreeState = 'clean';
    assert.equal(git(wt, ['status', '--porcelain']).trim(), '', 'the commit must leave the worktree clean');
    runSweep(ctx);
  });

  scoped(
    /^every parcel in that batch claim records the new commit as its last progress$/,
    (ctx) => {
      for (const p of ctx.parcelPaths) {
        const sidecar = readSidecar(p);
        assert.equal(
          sidecar.lastCommit,
          ctx.newCommit,
          `every parcel in the batch records the new commit, not just the one that moved: ${path.basename(p)}`
        );
      }
    }
  );
}

module.exports = { registerSteps };
