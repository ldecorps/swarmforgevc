'use strict';

// BL-854: step handlers for "promotion orthogonality advises on epic overlap
// instead of blocking on it". Drives the REAL promotion_gates_cli.bb
// `evaluate`/`select` and the real promote_and_route_next.sh against a real
// fixture git repo - same "drive the real script against a real fixture
// repo, run the CLI directly (not copied) from this checkout's own
// swarmforge/scripts, pointed at a fixture root" pattern as
// bl663PromotionGatesSteps.js / bl853PromotionPathHonoursNoLimitDepthSentinelSteps.js.
//
// promotion_gates_cli.bb evaluate/select write their ADVISORY line to
// stderr, never stdout (BL-854's own machine-contract invariant) - every
// gate-evaluation helper below captures stdout and stderr SEPARATELY and
// keeps them separate through to the Then steps, never merging them the way
// bl663's own combinedOutput() does for its refusal-text assertions.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GATES_CLI = path.join(SCRIPTS_DIR, 'promotion_gates_cli.bb');
const PROMOTE_SCRIPT = path.join(SCRIPTS_DIR, 'promote_and_route_next.sh');

const FEATURE_NAME = 'promotion orthogonality advises on epic overlap instead of blocking on it';

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
// broader environment into a spawned bash/bb subprocess (same posture as
// bl663PromotionGatesSteps.js's processEnvAllowlist).
function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function initFixture(ctx) {
  if (ctx.root) {
    return;
  }
  ctx.root = mkTmp('bl854-orthogonality-advisory-');
  git(ctx.root, ['init', '-q']);
  git(ctx.root, ['config', 'user.email', 't@t']);
  git(ctx.root, ['config', 'user.name', 't']);
  git(ctx.root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(ctx.root, 'swarmforge'));
  fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 5\n');
}

function writeActiveTicket(root, id, epic) {
  mkdirp(path.join(root, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${id}-active.yaml`),
    `id: ${id}\ntitle: "active fixture ${id}"\nstatus: active\ntype: feature\npriority: 5\nepic: ${epic}\nhuman_approval: approved\nassigned_to: coder\n`
  );
}

function writePausedCandidate(root, id, epic, priority) {
  mkdirp(path.join(root, 'backlog', 'paused'));
  const file = path.join(root, 'backlog', 'paused', `${id}-candidate.yaml`);
  fs.writeFileSync(
    file,
    `id: ${id}\ntitle: "candidate ${id}"\nstatus: paused\ntype: feature\npriority: ${priority}\nepic: ${epic}\nhuman_approval: approved\nassigned_to:\n`
  );
  return file;
}

function writeHeldCandidate(root, id, epic) {
  mkdirp(path.join(root, 'backlog', 'hold'));
  const file = path.join(root, 'backlog', 'hold', `${id}-held.yaml`);
  fs.writeFileSync(
    file,
    `id: ${id}\ntitle: "held fixture ${id}"\nstatus: hold\ntype: feature\npriority: 50\nepic: ${epic}\nhuman_approval: approved\nassigned_to:\n`
  );
  return file;
}

function findYamlStartingWith(dir, prefix) {
  if (!fs.existsSync(dir)) {
    return null;
  }
  const match = fs.readdirSync(dir).find((name) => name.startsWith(`${prefix}-`) && name.endsWith('.yaml'));
  return match ? path.join(dir, match) : null;
}

function evaluateGate(root, ticketFile, held, maxDepth) {
  const res = spawnSync('bb', [GATES_CLI, 'evaluate', root, ticketFile, held, String(maxDepth)], {
    cwd: root,
    encoding: 'utf8',
    env: processEnvAllowlist(),
  });
  return { status: res.status, stdout: (res.stdout || '').trim(), stderr: res.stderr || '' };
}

function commitAll(ctx, message) {
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['commit', '-q', '-m', message]);
}

function runPromoteScript(ctx, args) {
  const res = spawnSync('bash', [PROMOTE_SCRIPT, ...args], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: processEnvAllowlist(),
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function registerSteps(registry) {
  // ── Given ──────────────────────────────────────────────────────────────

  registry.defineScoped(/^an active ticket (BL-\d+) in epic ([\w-]+)$/, (ctx, id, epic) => {
    initFixture(ctx);
    writeActiveTicket(ctx.root, id, epic);
  }, FEATURE_NAME);

  registry.defineScoped(/^a paused candidate in epic ([\w-]+)$/, (ctx, epic) => {
    initFixture(ctx);
    ctx.candidateFile = writePausedCandidate(ctx.root, 'BL-950', epic, 50);
    ctx.held = 'false';
    ctx.maxDepth = '5';
  }, FEATURE_NAME);

  registry.defineScoped(
    /^a paused candidate in epic ([\w-]+) that is the correctly-laned next pick under Article 3\.2\.4$/,
    (ctx, epic) => {
      initFixture(ctx);
      ctx.winnerId = 'BL-960';
      ctx.winnerFile = writePausedCandidate(ctx.root, ctx.winnerId, epic, 1);
    },
    FEATURE_NAME
  );

  registry.defineScoped(/^a lower-laned paused candidate in epic ([\w-]+)$/, (ctx, epic) => {
    initFixture(ctx);
    ctx.loserId = 'BL-961';
    ctx.loserFile = writePausedCandidate(ctx.root, ctx.loserId, epic, 50);
  }, FEATURE_NAME);

  registry.defineScoped(/^a paused candidate blocked by the (.+) gate$/, (ctx, gate) => {
    initFixture(ctx);
    if (gate === 'human_approval') {
      mkdirp(path.join(ctx.root, 'backlog', 'paused'));
      const file = path.join(ctx.root, 'backlog', 'paused', 'BL-970-candidate.yaml');
      fs.writeFileSync(
        file,
        'id: BL-970\ntitle: "candidate"\nstatus: paused\ntype: feature\npriority: 50\nepic: bl854-approval-epic\nhuman_approval: pending\nassigned_to:\n'
      );
      ctx.candidateFile = file;
      ctx.held = 'false';
      ctx.maxDepth = '5';
    } else if (gate === 'active_backlog_max_depth') {
      // The Background's own "an active ticket BL-900 in epic
      // swarm-reliability" is the sole occupant here - maxDepth 1 means it
      // alone already saturates the cap, no second active fixture needed.
      ctx.candidateFile = writePausedCandidate(ctx.root, 'BL-971', 'bl854-depth-epic', 50);
      ctx.held = 'false';
      ctx.maxDepth = '1';
    } else if (gate === 'hold marker') {
      ctx.candidateFile = writeHeldCandidate(ctx.root, 'BL-972', 'bl854-hold-epic');
      ctx.held = 'true';
      ctx.maxDepth = '5';
    } else {
      throw new Error(`unknown gate fixture requested: "${gate}"`);
    }
  }, FEATURE_NAME);

  // ── When ───────────────────────────────────────────────────────────────

  registry.defineScoped(/^the promotion gates evaluate that candidate$/, (ctx) => {
    ctx.gateResult = evaluateGate(ctx.root, ctx.candidateFile, ctx.held, ctx.maxDepth);
  }, FEATURE_NAME);

  registry.defineScoped(/^a caller reads the evaluation verdict$/, (ctx) => {
    ctx.gateResult = evaluateGate(ctx.root, ctx.candidateFile, ctx.held, ctx.maxDepth);
  }, FEATURE_NAME);

  registry.defineScoped(/^promote_and_route selects the next candidate$/, (ctx) => {
    // promote_and_route_next.sh does a real `git mv` on the winning
    // candidate - the fixture files this scenario wrote via the Given steps
    // above must be tracked (committed) before that mv can succeed, exactly
    // as bl663PromotionGatesSteps.js's own commitAll does for its own
    // fixtures.
    commitAll(ctx, 'seed BL-854 selection fixtures');
    ctx.result = runPromoteScript(ctx, [ctx.root]);
  }, FEATURE_NAME);

  // ── Then ───────────────────────────────────────────────────────────────

  registry.defineScoped(/^the verdict is allow$/, (ctx) => {
    if (ctx.gateResult.stdout !== 'ALLOW') {
      throw new Error(`expected ALLOW on stdout, got: ${ctx.gateResult.stdout} (stderr: ${ctx.gateResult.stderr})`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the verdict is refuse$/, (ctx) => {
    if (!ctx.gateResult.stdout.startsWith('REFUSE|')) {
      throw new Error(`expected a REFUSE verdict on stdout, got: ${ctx.gateResult.stdout}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^an orthogonality advisory is raised$/, (ctx) => {
    if (!ctx.gateResult.stderr.includes('ADVISORY|orthogonality|')) {
      throw new Error(`expected an ADVISORY|orthogonality| line on stderr, got: ${JSON.stringify(ctx.gateResult.stderr)}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^no orthogonality advisory is raised$/, (ctx) => {
    if (ctx.gateResult.stderr.includes('ADVISORY')) {
      throw new Error(`expected no advisory, got stderr: ${ctx.gateResult.stderr}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the advisory names (BL-\d+)$/, (ctx, id) => {
    if (!ctx.gateResult.stderr.includes(id)) {
      throw new Error(`expected the advisory to name ${id}, got stderr: ${ctx.gateResult.stderr}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the advisory names (BL-\d+) and (BL-\d+)$/, (ctx, id1, id2) => {
    const advisoryLine = ctx.gateResult.stderr.split('\n').find((l) => l.includes('ADVISORY|orthogonality|'));
    if (!advisoryLine || !advisoryLine.includes(id1) || !advisoryLine.includes(id2)) {
      throw new Error(`expected one advisory line naming both ${id1} and ${id2}, got stderr: ${ctx.gateResult.stderr}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the refusal names the (.+) gate as the reason$/, (ctx, gate) => {
    if (!ctx.gateResult.stdout.includes(gate)) {
      throw new Error(`expected the refusal to name the "${gate}" gate, got: ${ctx.gateResult.stdout}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the swarm-reliability candidate is selected$/, (ctx) => {
    const activeFile = findYamlStartingWith(path.join(ctx.root, 'backlog', 'active'), ctx.winnerId);
    if (!activeFile) {
      throw new Error(
        `expected ${ctx.winnerId} to be promoted into backlog/active/, but it is not there. output:\n${ctx.result.stdout}\n${ctx.result.stderr}`
      );
    }
    const loserStillPaused = findYamlStartingWith(path.join(ctx.root, 'backlog', 'paused'), ctx.loserId);
    if (!loserStillPaused) {
      throw new Error(`expected ${ctx.loserId} to remain in backlog/paused/, it is gone`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^its advisory is reported once for the promoted ticket$/, (ctx) => {
    const advisoryLines = (ctx.result.stderr.match(/ADVISORY\|orthogonality\|[^\n]*/g) || []);
    if (advisoryLines.length !== 1) {
      throw new Error(`expected exactly one ADVISORY line, found ${advisoryLines.length}. stderr:\n${ctx.result.stderr}`);
    }
    if (!advisoryLines[0].includes('BL-900')) {
      throw new Error(`expected the advisory to name BL-900. line: ${advisoryLines[0]}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the verdict it reads is the same one it reads for a candidate with no epic overlap$/, (ctx) => {
    const controlFile = writePausedCandidate(ctx.root, 'BL-951', 'bl854-no-overlap-control-epic', 50);
    const controlResult = evaluateGate(ctx.root, controlFile, 'false', '5');
    if (ctx.gateResult.stdout !== controlResult.stdout) {
      throw new Error(
        `stdout diverged with an epic overlap present: overlapping=${ctx.gateResult.stdout} vs non-overlapping=${controlResult.stdout}`
      );
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the advisory reaches the operator on a separate stream$/, (ctx) => {
    if (ctx.gateResult.stdout.includes('ADVISORY')) {
      throw new Error(`advisory text leaked onto stdout: ${ctx.gateResult.stdout}`);
    }
    if (!ctx.gateResult.stderr.includes('ADVISORY|orthogonality|')) {
      throw new Error(`expected an ADVISORY line on stderr, got: ${ctx.gateResult.stderr}`);
    }
  }, FEATURE_NAME);
}

module.exports = { registerSteps };
