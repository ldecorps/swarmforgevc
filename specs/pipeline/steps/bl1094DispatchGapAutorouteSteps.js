'use strict';

// BL-1094: stamp the dispatch-gap auto-route so HEAD tip commits pass the
// BL-953 coherence gate. Drives REAL dispatch_gap_sweep_harness.bb +
// swarm_handoff.bb — never reimplements the gate or the sweep.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'The daemon can deliver the auto-route it generates';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS, 'swarm_handoff.bb');
const SWEEP_HARNESS = path.join(SCRIPTS, 'test', 'dispatch_gap_sweep_harness.bb');
const COHERENCE_LIB = path.join(SCRIPTS, 'task_commit_coherence_gate_lib.bb');

const ITEM_ID = 'BL-1094';
const OTHER_ID = 'BL-999';

const SUBJECT_FOR = {
  'a different ticket': `${OTHER_ID}: unrelated tip subject`,
  'the routed ticket': `${ITEM_ID}: matching tip subject`,
  'no ticket at all': 'Merge tip with no ticket id in the subject',
};

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1094-acc-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  const coderWt = path.join(root, '.worktrees', 'coder');
  fs.mkdirSync(coderWt, { recursive: true });
  const rows = [
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tC\tclaude\ttask`,
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask`,
  ].join('\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows}\n`);
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${ITEM_ID}-gap.yaml`),
    `id: ${ITEM_ID}\ntitle: "gap"\nstatus: todo\nassigned_to: coder\n`
  );
  ctx.root = root;
  ctx.coderWt = coderWt;
}

function cleanup(ctx) {
  if (ctx.root) {
    try {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    ctx.root = undefined;
  }
}

function coordinatorOutbox(ctx) {
  return path.join(ctx.root, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function listAutoroutes(ctx) {
  const dir = coordinatorOutbox(ctx);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.handoff'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .filter(
      (c) =>
        /^type: git_handoff$/m.test(c) &&
        new RegExp(`^task: ${ITEM_ID}`, 'm').test(c) &&
        /^to: coder$/m.test(c)
    );
}

function sendHandoff(ctx, { env, draft }) {
  const draftPath = path.join(ctx.root, `draft-${Date.now()}.txt`);
  fs.writeFileSync(draftPath, draft);
  const result = execFileSync(
    'bb',
    [SWARM_HANDOFF, draftPath],
    {
      cwd: ctx.root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SWARMFORGE_ROLE: 'coder',
        SWARMFORGE_SKIP_SYNC_INJECT: '1',
        ...env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  return result;
}

function trySend(ctx, opts) {
  try {
    sendHandoff(ctx, opts);
    return { ok: true, err: '' };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message || e) };
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an active ticket with a real assignee and no dispatch trail$/, (ctx) => {
    mkFixture(ctx);
  });

  scoped(/^HEAD's commit subject names (a different ticket|the routed ticket|no ticket at all)$/, (ctx, kind) => {
    assert.ok(SUBJECT_FOR[kind], `unknown subject cell ${kind}`);
    git(ctx.root, ['commit', '-q', '--allow-empty', '-m', SUBJECT_FOR[kind]]);
    ctx.headSubjectKind = kind;
  });

  scoped(/^the daemon runs its dispatch-gap sweep$/, (ctx) => {
    ctx.sweepOut = execFileSync('bb', [SWEEP_HARNESS, ctx.root], { encoding: 'utf8' });
  });

  scoped(/^the assignee receives the parcel$/, (ctx) => {
    try {
      const parcels = listAutoroutes(ctx);
      assert.ok(
        parcels.length >= 1,
        `expected auto-route git_handoff for ${ITEM_ID}; sweep:\n${ctx.sweepOut}`
      );
      assert.match(parcels[0], /^commit: [0-9a-f]{10}$/m);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^a hand-authored git_handoff whose task and commit name different tickets$/, (ctx) => {
    mkFixture(ctx);
    git(ctx.root, ['commit', '-q', '--allow-empty', '-m', `${OTHER_ID}: other work`]);
    ctx.commit = git(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
    ctx.handAuthoredDraft =
      `type: git_handoff\nto: coder\npriority: 50\ntask: ${ITEM_ID}-gap\ncommit: ${ctx.commit}\n`;
  });

  scoped(/^the sender submits it$/, (ctx) => {
    // Hand-authored: no dispatch-gap env — coherence must still refuse.
    ctx.sendResult = trySend(ctx, { draft: ctx.handAuthoredDraft, env: {} });
  });

  scoped(/^the send is refused$/, (ctx) => {
    assert.equal(ctx.sendResult.ok, false, 'hand-authored mismatch must be refused');
  });

  scoped(/^the refusal names the coherence gate$/, (ctx) => {
    try {
      assert.match(ctx.sendResult.err, /BL-953/);
      assert.match(ctx.sendResult.err, /stale field|belongs to/);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^an auto-route the validator refuses$/, (ctx) => {
    mkFixture(ctx);
    git(ctx.root, ['commit', '-q', '--allow-empty', '-m', `${OTHER_ID}: tip`]);
    ctx.commit = git(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
    // Auto-route-shaped draft WITHOUT the exemption env — reproduces the
    // refusal the live daemon used to hit, so we can assert log naming.
    ctx.refusedDraft =
      `type: git_handoff\nto: coder\npriority: 00\ntask: ${ITEM_ID}\ncommit: ${ctx.commit}\n`;
    ctx.sendResult = trySend(ctx, { draft: ctx.refusedDraft, env: { SWARMFORGE_ROLE: 'coordinator' } });
    assert.equal(ctx.sendResult.ok, false);
  });

  scoped(/^the daemon logs the failure$/, (ctx) => {
    const line = execFileSync(
      'bb',
      [
        '-e',
        `(load-file "${COHERENCE_LIB}")\n` +
          `(println (task-commit-coherence-gate-lib/operator-refusal-log-line ${JSON.stringify(ctx.sendResult.err)}))`,
      ],
      { encoding: 'utf8' }
    ).trim();
    ctx.logLine = line;
  });

  scoped(/^the log line names the refusing gate and its reason$/, (ctx) => {
    try {
      assert.match(ctx.logLine, /gate=task-commit-coherence \(BL-953\)/);
      assert.match(ctx.logLine, /reason=/);
      assert.match(ctx.logLine, /BL-953|belongs to/);
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
