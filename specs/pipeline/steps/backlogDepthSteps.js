'use strict';

// BL-216: step handlers for the backlog-depth conf feature. Drives the
// real swarm_handoff.bb (for the WARNING gate) and backlog_depth_lib.bb
// directly (for the pure read-max-depth/under-depth-cap? computation) -
// never a live daemon or tmux session. ready_for_next.bb's own
// promote-next-paused-item-if-needed is not invoked end-to-end here: its
// caller (dispatch-lib/run-dispatch!) always ends in either process/exec
// (which replaces the process image and never returns, confirmed
// empirically) or System/exit, so that call site is unreachable dead code
// in every observed path - a separate, flagged issue, not this ticket's to
// fix (BL-216 explicitly scopes out "whether ready_for_next.bb should
// auto-promote at all"). "ready_for_next runs its depth gate" below
// exercises the same shared computation that call site is wired to.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SWARMFORGE_SCRIPTS, 'swarm_handoff.bb');
const BACKLOG_DEPTH_LIB = path.join(SWARMFORGE_SCRIPTS, 'backlog_depth_lib.bb');

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-backlog-depth-'));
    git(ctx.targetPath, ['init', '-q']);
    git(ctx.targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return ctx.targetPath;
}

function writeRolesTsv(ctx) {
  fs.mkdirSync(path.join(ctx.targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(ctx.targetPath, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${ctx.targetPath}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`
  );
}

function writeConf(ctx, cap) {
  fs.mkdirSync(path.join(ctx.targetPath, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(ctx.targetPath, 'swarmforge', 'swarmforge.conf'), `config active_backlog_max_depth ${cap}\n`);
}

function writeActiveItems(ctx, n) {
  const dir = path.join(ctx.targetPath, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= n; i++) {
    fs.writeFileSync(path.join(dir, `BL-${i}-demo.yaml`), `id: BL-${i}\ntitle: "demo"\nstatus: active\n`);
  }
}

function runSwarmHandoff(ctx) {
  writeRolesTsv(ctx);
  const draft = path.join(ctx.targetPath, 'draft.txt');
  fs.writeFileSync(draft, 'type: awake\nto: coordinator\npriority: 50\n');
  const env = {
    ...process.env,
    SWARMFORGE_ROLE: 'coordinator',
    SWARMFORGE_SKIP_SYNC_INJECT: '1', // no live tmux/daemon needed; queues for backup delivery, exits 0
  };
  // check-backlog-depth's WARNING goes to stderr - execFileSync's plain
  // return value is stdout only on success, silently dropping it.
  // spawnSync captures both streams regardless of exit code.
  const result = spawnSync('bb', [SWARM_HANDOFF, draft], { cwd: ctx.targetPath, encoding: 'utf8', env });
  return (result.stdout || '') + (result.stderr || '');
}

function readMaxDepth(targetPath) {
  return execFileSync('bb', ['-e', `(load-file "${BACKLOG_DEPTH_LIB}") (println (backlog-depth-lib/read-max-depth "${targetPath}"))`], {
    encoding: 'utf8',
  }).trim();
}

function registerSteps(registry) {
  // ── depth-01: the depth warning fires only for a positive cap exceeded ──
  registry.define(/^swarmforge\/swarmforge\.conf sets active_backlog_max_depth to (-?\d+)$/, (ctx, cap) => {
    ensureTargetPath(ctx);
    writeConf(ctx, cap);
  });

  registry.define(/^backlog\/active\/ holds (\d+) items$/, (ctx, count) => {
    writeActiveItems(ctx, Number(count));
  });

  registry.define(/^a handoff is written$/, (ctx) => {
    ctx.handoffOutput = runSwarmHandoff(ctx);
  });

  registry.define(/^a depth-exceeded warning (is emitted|is not emitted)$/, (ctx, expectation) => {
    const warned = /Active backlog depth exceeded/i.test(ctx.handoffOutput || '');
    if (expectation === 'is emitted' && !warned) {
      throw new Error(`expected a depth-exceeded warning, got: ${ctx.handoffOutput}`);
    }
    if (expectation === 'is not emitted' && warned) {
      throw new Error(`expected no depth-exceeded warning, got: ${ctx.handoffOutput}`);
    }
  });

  // ── depth-02: the -1 sentinel leaves promotion ungated ──────────────────
  registry.define(/^backlog\/active\/ is non-empty and backlog\/paused\/ has an item$/, (ctx) => {
    writeActiveItems(ctx, 5);
    const pausedDir = path.join(ctx.targetPath, 'backlog', 'paused');
    fs.mkdirSync(pausedDir, { recursive: true });
    fs.writeFileSync(path.join(pausedDir, 'BL-9-demo.yaml'), 'id: BL-9\ntitle: "demo"\nstatus: todo\n');
  });

  registry.define(/^ready_for_next runs its depth gate$/, (ctx) => {
    const activeCount = fs.readdirSync(path.join(ctx.targetPath, 'backlog', 'active')).length;
    const out = execFileSync(
      'bb',
      [
        '-e',
        `(load-file "${BACKLOG_DEPTH_LIB}") (let [d (backlog-depth-lib/read-max-depth "${ctx.targetPath}")] (println (backlog-depth-lib/under-depth-cap? ${activeCount} d)))`,
      ],
      { encoding: 'utf8' }
    );
    ctx.gateResult = out.trim();
  });

  registry.define(/^the depth cap is treated as unlimited, not a mis-parsed cap of 1$/, (ctx) => {
    if (ctx.gateResult !== 'true') {
      throw new Error(`expected the depth gate to report unlimited (true) under -1, got: ${ctx.gateResult}`);
    }
  });

  // ── depth-03: the cap comes from the tracked config ──────────────────────
  registry.define(/^the tracked swarmforge\/swarmforge\.conf is the config present$/, (ctx) => {
    ensureTargetPath(ctx);
    writeConf(ctx, 3);
  });

  registry.define(/^no \.swarmforge\/swarmforge\.conf exists$/, (ctx) => {
    const bogus = path.join(ctx.targetPath, '.swarmforge', 'swarmforge.conf');
    if (fs.existsSync(bogus)) {
      throw new Error(`expected no fixture .swarmforge/swarmforge.conf (the old wrong path), found one at ${bogus}`);
    }
  });

  registry.define(/^the depth cap is read$/, (ctx) => {
    ctx.readMaxDepth = readMaxDepth(ctx.targetPath);
  });

  registry.define(/^its value comes from the tracked file, not the fallback default$/, (ctx) => {
    if (ctx.readMaxDepth !== '3') {
      throw new Error(`expected the tracked cap (3), got: ${ctx.readMaxDepth}`);
    }
  });

  // ── depth-04: an absent config degrades gracefully ───────────────────────
  registry.define(/^no swarmforge\.conf is present$/, (ctx) => {
    ensureTargetPath(ctx);
    // Deliberately no swarmforge/swarmforge.conf fixture file at all.
  });

  registry.define(/^the depth check runs$/, (ctx) => {
    writeActiveItems(ctx, 3); // under the default cap (5) - must not spuriously warn
    ctx.depthCheckOutput = runSwarmHandoff(ctx);
  });

  registry.define(/^it does not crash$/, (ctx) => {
    if (ctx.depthCheckOutput === undefined) {
      throw new Error('expected the depth check step to have run');
    }
  });

  registry.define(/^no spurious over-cap warning is emitted$/, (ctx) => {
    if (/Active backlog depth exceeded/i.test(ctx.depthCheckOutput || '')) {
      throw new Error(`expected no spurious over-cap warning, got: ${ctx.depthCheckOutput}`);
    }
  });
}

module.exports = { registerSteps };
