'use strict';

// BL-243: step handlers for the coordinator-is-provisioned-infrastructure
// feature. Drives the REAL swarmforge.sh directly (sourced, not executed -
// its ZSH_EVAL_CONTEXT toplevel guard skips tmux/git/real-launch side
// effects when sourced, BL-089's own established convention), mirroring
// swarmforge/scripts/test/test_coordinator_provisioned_infrastructure.sh's
// exact fixture shape. No real tmux session is ever launched or bounced by
// these scenarios - "the swarm launches" below means parse_config +
// provision_coordinator run against a fixture conf, never a live launch.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SH = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'swarmforge.sh');

function mkFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-coordinator-infra-'));
  const rolesDir = path.join(root, 'swarmforge', 'roles');
  fs.mkdirSync(rolesDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['specifier', 'coder', 'cleaner']) {
    fs.writeFileSync(path.join(rolesDir, `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function writeConf(root, content) {
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), content);
}

// Runs `source swarmforge.sh <root>; parse_config` (+ any extra commands),
// returning { ok, stdout } - never throws on a non-zero exit (a rejection
// scenario is an expected outcome here, not a test-harness failure).
function sourceAndRun(root, extraCommands) {
  const script = `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${extraCommands}`;
  try {
    const stdout = execFileSync('zsh', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout };
  } catch (err) {
    const stdout = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '');
    return { ok: false, stdout };
  }
}

function registerSteps(registry) {
  registry.define(
    /^a swarm named "([^"]+)" whose swarmforge\.conf declares its pack as role windows$/,
    (ctx, name) => {
      ctx.swarmName = name;
      ctx.root = mkFixtureRoot();
      // A complete, valid default conf - most scenarios overwrite this
      // with their own more specific fixture via a follow-up Given, but a
      // scenario with no scenario-specific Given (coordinator-
      // infrastructure-05 goes straight from Background to "When the
      // swarm launches") still needs a launchable conf to exercise.
      writeConf(ctx.root, `config swarm_name ${name}\nwindow coder claude coder --model x\n`);
    }
  );

  registry.define(/^\.\/swarm is the launch entrypoint$/, () => {
    // Documents the precondition - each scenario's own Given below writes
    // the specific fixture conf it needs; swarmforge.sh is what ./swarm
    // ultimately execs, and is what these steps drive directly.
  });

  // ── coordinator-infrastructure-01 ────────────────────────────────────
  registry.define(/^the conf lists all roles except coordinator$/, (ctx) => {
    writeConf(
      ctx.root,
      `config swarm_name ${ctx.swarmName}\nwindow specifier claude master --model x\nwindow coder claude coder --model x\nwindow cleaner claude cleaner batch --model x\n`
    );
  });

  registry.define(/^the swarm launches$/, (ctx) => {
    ctx.result = sourceAndRun(
      ctx.root,
      `write_roles_file; write_swarm_identity_file; print -l -- "\${ROLES[@]}" ; print -r -- "coordinator-worktree:\${WORKTREE_NAMES[\${ROLE_INDEX[coordinator]}+1]:-none}"`
    );
  });

  registry.define(/^every configured role pane comes up with a live agent$/, (ctx) => {
    for (const role of ['specifier', 'coder', 'cleaner']) {
      if (!ctx.result.stdout.split('\n').includes(role)) {
        throw new Error(`expected role "${role}" to be provisioned, got: ${ctx.result.stdout}`);
      }
    }
  });

  registry.define(/^a coordinator pane is provisioned automatically$/, (ctx) => {
    if (!ctx.result.stdout.split('\n').includes('coordinator')) {
      throw new Error(`expected an automatically-provisioned coordinator, got: ${ctx.result.stdout}`);
    }
  });

  registry.define(/^handoffd delivers local handoffs between roles normally$/, (ctx) => {
    const rolesTsv = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), 'utf8');
    if (!/^coordinator\t/m.test(rolesTsv)) {
      throw new Error('expected coordinator to appear in roles.tsv, the source handoffd reads to know every deliverable role');
    }
  });

  // ── coordinator-infrastructure-02 ────────────────────────────────────
  registry.define(/^the conf declares a 2-pack of coder and cleaner$/, (ctx) => {
    writeConf(ctx.root, 'window coder claude coder --model x\nwindow cleaner claude cleaner batch --model x\n');
  });

  registry.define(/^the reported pack size is 2$/, (ctx) => {
    const result = sourceAndRun(ctx.root, 'print -r -- "$(pack_size)"');
    ctx.packSizeResult = result;
    if (result.stdout.trim() !== '2') {
      throw new Error(`expected reported pack size 2, got: ${result.stdout}`);
    }
  });

  registry.define(/^the coordinator is not counted in the pack size$/, (ctx) => {
    // Already proven by the exact "2" (not 3, which counting the
    // auto-provisioned coordinator would produce) asserted above.
    if (ctx.packSizeResult.stdout.trim() !== '2') {
      throw new Error('expected the coordinator to be excluded from the pack-size count');
    }
  });

  // ── coordinator-infrastructure-03 ────────────────────────────────────
  registry.define(/^the coordinator pane has no dedicated git worktree$/, (ctx) => {
    if (!ctx.root) {
      ctx.root = mkFixtureRoot();
    }
    writeConf(ctx.root, 'window coder claude coder --model x\n');
    ctx.result = sourceAndRun(ctx.root, 'write_roles_file');
    const rolesTsv = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), 'utf8');
    const coordinatorLine = rolesTsv.split('\n').find((l) => l.startsWith('coordinator\t'));
    if (!coordinatorLine) {
      throw new Error('expected a coordinator line in roles.tsv');
    }
    const worktreeName = coordinatorLine.split('\t')[1];
    if (worktreeName !== 'master') {
      throw new Error(`expected the coordinator's worktree name to be "master" (no dedicated worktree), got: "${worktreeName}"`);
    }
  });

  registry.define(/^the coordinator writes to no integration branch of its own$/, (ctx) => {
    const rolesTsv = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), 'utf8');
    const coordinatorLine = rolesTsv.split('\n').find((l) => l.startsWith('coordinator\t'));
    const worktreePath = coordinatorLine.split('\t')[2];
    if (worktreePath !== ctx.root) {
      throw new Error(`expected the coordinator to use the main checkout (no separate worktree/branch), got: "${worktreePath}"`);
    }
  });

  // ── coordinator-infrastructure-04 ────────────────────────────────────
  registry.define(/^the conf lists coordinator among its roles$/, (ctx) => {
    writeConf(ctx.root, 'window coordinator claude master --model x\nwindow coder claude coder --model x\n');
  });

  registry.define(/^the launch reports that coordinator is reserved infrastructure$/, (ctx) => {
    ctx.rejectResult = sourceAndRun(ctx.root, '');
    if (ctx.rejectResult.ok) {
      throw new Error('expected parse_config to fail for a conf naming coordinator');
    }
    if (!/coordinator is reserved infrastructure/i.test(ctx.rejectResult.stdout)) {
      throw new Error(`expected a "coordinator is reserved infrastructure" message, got: ${ctx.rejectResult.stdout}`);
    }
  });

  registry.define(/^the coordinator is provisioned exactly once$/, (ctx) => {
    // The conf's own coordinator line is rejected outright (proven above),
    // so a normal (accepted) conf is what proves "exactly once" - reuse
    // scenario 01's own fixture shape here, a fresh root.
    const root = mkFixtureRoot();
    writeConf(root, 'window coder claude coder --model x\n');
    const result = sourceAndRun(root, 'print -l -- "${ROLES[@]}"');
    const coordinatorCount = result.stdout.split('\n').filter((l) => l === 'coordinator').length;
    if (coordinatorCount !== 1) {
      throw new Error(`expected exactly one coordinator entry, got ${coordinatorCount}`);
    }
  });

  // ── coordinator-infrastructure-05 ────────────────────────────────────
  registry.define(/^identity\(\) for the swarm returns name "([^"]+)"$/, (ctx, name) => {
    if (!ctx.root) {
      ctx.root = mkFixtureRoot();
      writeConf(ctx.root, `config swarm_name ${name}\nwindow coder claude coder --model x\n`);
    }
    sourceAndRun(ctx.root, 'write_swarm_identity_file');
    const identity = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'swarm-identity'), 'utf8');
    if (!identity.includes(`swarm_name\t${name}`)) {
      throw new Error(`expected identity() to report swarm_name "${name}", got: ${identity}`);
    }
  });

  registry.define(/^the coordinator is the endpoint the fleet console subscribes to$/, (ctx) => {
    const result = sourceAndRun(ctx.root, 'print -l -- "${ROLES[@]}"');
    if (!result.stdout.split('\n').includes('coordinator')) {
      throw new Error('expected a coordinator to exist as the swarm\'s one always-addressable identity');
    }
  });
}

module.exports = { registerSteps };
