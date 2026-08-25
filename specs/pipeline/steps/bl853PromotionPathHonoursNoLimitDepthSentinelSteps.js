'use strict';

// BL-853: step handlers for "the promotion path honours the documented
// no-limit depth sentinel". Drives the REAL babashka CLIs
// (effective_backlog_depth_cli.bb, backlog_depth_cli.bb,
// promotion_gates_cli.bb evaluate) against a real fixture git repo - same
// "drive the real script against a real fixture repo" pattern as
// bl663PromotionGatesSteps.js / bl803PromoteRouteSedBsdPortabilitySteps.js.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const EFFECTIVE_CLI = path.join(SCRIPTS_DIR, 'effective_backlog_depth_cli.bb');
const DEPTH_CLI = path.join(SCRIPTS_DIR, 'backlog_depth_cli.bb');
const GATES_CLI = path.join(SCRIPTS_DIR, 'promotion_gates_cli.bb');

// backlog-depth-lib/default-max-depth, mirrored here ONLY to assert the
// fix never silently lands there in a case that should resolve a real
// configured/effective value - never as a value this file feeds INTO a
// fixture (scenario 04 asks the real CLI for its own default instead).
const LIBRARY_DEFAULT_MAX_DEPTH = '5';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Never {...process.env} - an explicit allowlist, never leak this box's own
// broader environment into a spawned bb subprocess (same posture as
// bl760DuplicateChainGuardSteps.js's processEnvAllowlist).
function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function bb(args, cwd) {
  return execFileSync('bb', args, { cwd, env: processEnvAllowlist(), encoding: 'utf8' }).trim();
}

function writeActiveTicket(root, id) {
  mkdirp(path.join(root, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${id}-active.yaml`),
    `id: ${id}\ntitle: "active filler"\nstatus: active\npriority: 5\nassigned_to: coder\n`
  );
}

// No epic:, no human_approval: - clean on every OTHER gate so a refusal in
// these scenarios can only ever be the depth gate under test.
function writePausedCandidate(root, id) {
  mkdirp(path.join(root, 'backlog', 'paused'));
  const file = path.join(root, 'backlog', 'paused', `${id}-candidate.yaml`);
  fs.writeFileSync(file, `id: ${id}\ntitle: "candidate"\nstatus: paused\npriority: 5\nassigned_to:\n`);
  return file;
}

function initFixture(ctx) {
  if (ctx.root) {
    return;
  }
  ctx.root = mkTmp('bl853-promotion-depth-');
  git(ctx.root, ['init', '-q']);
  git(ctx.root, ['config', 'user.email', 't@t']);
  git(ctx.root, ['config', 'user.name', 't']);
  git(ctx.root, ['commit', '-q', '--allow-empty', '-m', 'init']);
}

function evaluateGate(root, ticketFile, maxDepth) {
  try {
    return bb([GATES_CLI, 'evaluate', root, ticketFile, 'false', String(maxDepth)], root);
  } catch (e) {
    // promotion_gates_cli.bb evaluate exits 2 (a real refusal) with the
    // REFUSE|gate|reason line on stdout - never a crash to swallow blind.
    const out = (e.stdout || '').toString().trim();
    if (out.startsWith('REFUSE|')) {
      return out;
    }
    throw e;
  }
}

function registerSteps(registry) {
  // ── Given ──────────────────────────────────────────────────────────

  registry.define(/^a swarm whose launched config declares active_backlog_max_depth as -1$/, (ctx) => {
    initFixture(ctx);
    mkdirp(path.join(ctx.root, 'swarmforge'));
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth -1\n');
  });

  registry.define(/^backlog\/active\/ holds (\d+) tickets$/, (ctx, countStr) => {
    initFixture(ctx);
    const count = Number(countStr);
    for (let i = 0; i < count; i++) {
      writeActiveTicket(ctx.root, `BL-9${String(i).padStart(3, '0')}`);
    }
  });

  registry.define(/^a swarm whose config cannot be read by any depth reader$/, (ctx) => {
    initFixture(ctx);
    // Deliberately nothing under swarmforge/ and no .swarmforge/swarm-
    // identity: conf-file-path still resolves to a path (the tracked
    // default relpath), but nothing exists there to slurp - the degrade
    // under test, not an accidental successful parse.
  });

  registry.define(
    /^a promotion candidate evaluated against a cap of (-?\d+) with an active count of (\d+)$/,
    (ctx, maxDepthStr, activeCountStr) => {
      initFixture(ctx);
      ctx.maxDepth = maxDepthStr;
      const activeCount = Number(activeCountStr);
      for (let i = 0; i < activeCount; i++) {
        writeActiveTicket(ctx.root, `BL-9${String(i).padStart(3, '0')}`);
      }
      ctx.candidateFile = writePausedCandidate(ctx.root, 'BL-999');
    }
  );

  // ── When ───────────────────────────────────────────────────────────

  registry.define(/^promote_and_route resolves the effective depth cap$/, (ctx) => {
    ctx.resolvedCap = bb([EFFECTIVE_CLI, ctx.root], ctx.root);
  });

  registry.define(/^the promotion gates evaluate that candidate$/, (ctx) => {
    ctx.gateOutput = evaluateGate(ctx.root, ctx.candidateFile, ctx.maxDepth);
  });

  // ── Then ───────────────────────────────────────────────────────────

  registry.define(/^the resolved cap is (-?\d+)$/, (ctx, expected) => {
    if (ctx.resolvedCap !== expected) {
      throw new Error(`expected resolved cap ${expected}, got ${ctx.resolvedCap}`);
    }
  });

  registry.define(/^it is not the depth library's default for an unreadable config$/, (ctx) => {
    if (ctx.resolvedCap === LIBRARY_DEFAULT_MAX_DEPTH) {
      throw new Error(
        `resolved cap ${ctx.resolvedCap} equals the library's unreadable-config default (${LIBRARY_DEFAULT_MAX_DEPTH}) - the launched config's own -1 was not honoured`
      );
    }
  });

  registry.define(/^the depth gate allows the promotion$/, (ctx) => {
    const candidateFile = writePausedCandidate(ctx.root, 'BL-998');
    const out = evaluateGate(ctx.root, candidateFile, ctx.resolvedCap);
    if (out !== 'ALLOW') {
      throw new Error(`expected the depth gate to allow the promotion, got: ${out}`);
    }
  });

  registry.define(/^the depth gate (allows|refuses) it$/, (ctx, verdict) => {
    const wantAllow = verdict === 'allows';
    const gotAllow = ctx.gateOutput === 'ALLOW';
    if (gotAllow !== wantAllow) {
      throw new Error(`expected the depth gate to ${verdict}, got: ${ctx.gateOutput}`);
    }
    if (!wantAllow && !ctx.gateOutput.startsWith('REFUSE|active_backlog_max_depth|')) {
      throw new Error(`expected a REFUSE from the active_backlog_max_depth gate specifically, got: ${ctx.gateOutput}`);
    }
  });

  registry.define(/^the resolved cap is the value backlog_depth_cli\.bb itself reports for an unreadable config$/, (ctx) => {
    const unreadableConfPath = path.join(ctx.root, 'swarmforge', 'no-such-conf-file.conf');
    const libraryReported = bb([DEPTH_CLI, unreadableConfPath], ctx.root);
    if (ctx.resolvedCap !== libraryReported) {
      throw new Error(`expected the resolved cap (${ctx.resolvedCap}) to equal backlog_depth_cli.bb's own unreadable-config report (${libraryReported})`);
    }
  });

  registry.define(/^the promotion path contributes no depth default of its own$/, (ctx) => {
    // The pre-fix bug's own literal (promote_and_route_next.sh's old
    // hardcoded CAP=1) - a second, tighter default competing with the
    // library's documented one. Confirming it agrees with the library's
    // own reported default (the immediately preceding step) already rules
    // this out; this is the explicit "and it is not that" regression seal.
    if (ctx.resolvedCap === '1') {
      throw new Error('resolved cap is the pre-fix shell literal (1), not a value the depth library reported');
    }
  });
}

module.exports = { registerSteps };
