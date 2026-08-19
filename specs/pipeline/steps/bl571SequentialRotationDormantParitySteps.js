'use strict';

// BL-571: step handlers for "Ensure recognises every single-resident
// rotation value as dormant-capable". Scenarios 01/02 drive the REAL
// swarm_ensure.bb as a subprocess over an on-disk fixture (fake tmux via
// PATH stub, the same shape test_swarm_ensure.sh's own BL-530 dormant case
// uses); scenario 03 drives the REAL pure rotate-home decision
// (mono-router-lib/rotate-home? composed exactly as
// ready_for_next_task.bb's report-no-task-or-rotate! composes it) via
// `bb -e` - the bl577 posture for the pure half, with the IO wrapper
// proven by test_ready_for_next's own suite.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ENSURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_ensure.bb');
const MONO_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mono_router_lib.bb');
const FEATURE = 'Ensure recognises every single-resident rotation value as dormant-capable';

const MIDDLE_ROLES = ['specifier', 'cleaner', 'architect', 'hardender', 'documenter'];

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function bbEval(expr) {
  const code = `(load-file ${JSON.stringify(MONO_LIB)}) (println (pr-str ${expr}))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed for: ${expr}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl571-'));
  trackedRoots.push(root);
  for (const dir of ['.swarmforge/daemon', '.swarmforge/operator', '.swarmforge/launch', '.swarmforge/babysitterd', '.worktrees/coder', 'bin']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${root}/fake.sock\n`);
  const rows = [
    `coder\tcoder\t${root}/.worktrees/coder\tswarmforge-coder\tCoder\tclaude\ttask`,
    ...MIDDLE_ROLES.map((r) => `${r}\t${r}\t${root}/.worktrees/coder\tswarmforge-${r}\t${r}\tclaude\ttask`),
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
  // BL-537: a dormant rotate target needs its launch script on disk, or the
  // classification is FAILED rather than DORMANT (the ticket's own re-read
  // note 2) - one per middle role.
  for (const r of MIDDLE_ROLES) {
    fs.writeFileSync(path.join(root, '.swarmforge', 'launch', `${r}.sh`), '#!/usr/bin/env bash\n');
  }
  // live stand-in pids (this process) so daemon/operator report healthy
  fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'handoffd.pid'), `${process.pid}\n`);
  fs.writeFileSync(path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.pid'), `${process.pid}\n`);
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'runtime.pid'), `${process.pid}\n`);
  ctx.root = root;
  ctx.respawnLog = path.join(root, 'respawns');
  fs.writeFileSync(ctx.respawnLog, '');
  // Fake tmux: resident + coordinator sessions exist, middle roles do not;
  // every respawn-pane is recorded. PATH stub, never chmod-for-failure.
  const tmux = `#!/usr/bin/env bash
sock_cmd="$3"
if [[ "$sock_cmd" == "has-session" ]]; then
  target="$5"
  case "$target" in
    swarmforge-coder|swarmforge-coordinator) exit 0 ;;
    *) exit 1 ;;
  esac
fi
if [[ "$sock_cmd" == "list-panes" ]]; then
  # pane_dead probe: only sessions that exist can answer - a missing
  # session fails, exactly as real tmux does (drives the classic-pack
  # repair path in scenario 02)
  target="$5"
  case "$target" in
    swarmforge-coder|swarmforge-coordinator) echo "0"; exit 0 ;;
    *) exit 1 ;;
  esac
fi
if [[ "$sock_cmd" == "respawn-pane" ]]; then
  echo "RESPAWN $*" >> "${ctx.respawnLog}"
  exit 0
fi
exit 0
`;
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), tmux);
  fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);
  for (const [name, body] of [
    ['fake_ext_check.sh', '#!/usr/bin/env bash\nexit 0\n'],
    ['fake_ext_bounce.sh', '#!/usr/bin/env bash\nexit 0\n'],
  ]) {
    fs.writeFileSync(path.join(root, 'bin', name), body);
    fs.chmodSync(path.join(root, 'bin', name), 0o755);
  }
}

function runEnsure(ctx) {
  const env = { ...process.env };
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.TELEGRAM_CHAT_ID;
  delete env.TELEGRAM_PRINCIPAL_USER_ID;
  delete env.CURSOR_BRIDGE_BOT_TOKEN;
  env.PATH = `${path.join(ctx.root, 'bin')}:${env.PATH}`;
  env.SWARMFORGE_ENSURE_EXTENSION_CHECK = path.join(ctx.root, 'bin', 'fake_ext_check.sh');
  env.SWARMFORGE_ENSURE_EXTENSION_BOUNCE = path.join(ctx.root, 'bin', 'fake_ext_bounce.sh');
  env.SWARMFORGE_ENSURE_SUPERVISOR = path.join(ctx.root, 'bin', 'fake_supervisor.bb');
  env.SWARMFORGE_SKIP_OPERATOR = '1';
  env.SWARMFORGE_SKIP_FRONT_DESK = '1';
  const res = spawnSync('bb', [ENSURE, ctx.root], { encoding: 'utf8', env });
  ctx.output = `${res.stdout || ''}${res.stderr || ''}`;
}

function respawnedRoles(ctx) {
  return fs.readFileSync(ctx.respawnLog, 'utf8').split('\n').filter((l) => l.trim().length > 0);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the resident and the coordinator hold standing sessions$/,
    (ctx) => {
      mkFixture(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the five middle pipeline roles have no standing session$/,
    (ctx) => {
      // encoded in the fake tmux's has-session case above - nothing to do,
      // but assert the fixture is in the expected shape
      assert.ok(fs.existsSync(path.join(ctx.root, 'bin', 'tmux')));
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a pack declaring rotation "([^"]+)"$/,
    (ctx, rotation) => {
      // the handler must honor the CAPTURED value (the ticket's own
      // shared-cell-mutation-survivor warning), and only the two
      // launcher-accepted values are meaningful here
      assert.ok(['router', 'sequential'].includes(rotation), `unknown <rotation> token: ${rotation}`);
      ctx.rotation = rotation;
      fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'swarm-identity'), `rotation\t${rotation}\n`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^a pack declaring no rotation mode$/,
    (ctx) => {
      // a classic pack has no rotation line at all - no swarm-identity
      // rotation key, no conf directive
      ctx.rotation = undefined;
    },
    FEATURE
  );

  registry.defineScoped(
    /^a non-home role whose mailbox is empty$/,
    (ctx) => {
      ctx.nonHomeRole = 'cleaner';
    },
    FEATURE
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^swarm ensure runs$/,
    (ctx) => {
      runEnsure(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^that role runs ready_for_next$/,
    (ctx) => {
      // the REAL pure decision ready_for_next_task.bb composes, with the
      // REAL router-only conf predicate it consumes - pinned unwidened
      const conf = `config rotation ${ctx.rotation}\nconfig rotation_home coder\n`;
      ctx.rotateHome = bbEval(
        `(mono-router-lib/rotate-home?
           {:rotation-router? (mono-router-lib/conf-rotation-router? ${JSON.stringify(conf)})
            :role ${JSON.stringify(ctx.nonHomeRole)}
            :home-role (mono-router-lib/parse-rotation-home ${JSON.stringify(conf)})
            :mailbox-empty? true})`
      );
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the five middle pipeline roles are reported DORMANT$/,
    (ctx) => {
      for (const role of MIDDLE_ROLES) {
        assert.ok(
          ctx.output.includes(`agent:${role}: DORMANT`),
          `expected ${role} DORMANT under rotation ${ctx.rotation}:\n${ctx.output}`
        );
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^ensure respawns no middle pipeline role$/,
    (ctx) => {
      assert.deepEqual(respawnedRoles(ctx), [], `respawns recorded under rotation ${ctx.rotation}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no middle pipeline role is reported DORMANT$/,
    (ctx) => {
      assert.ok(!ctx.output.includes('DORMANT'), `classic pack must never classify DORMANT:\n${ctx.output}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^ensure repairs every missing middle pipeline role$/,
    (ctx) => {
      const respawns = respawnedRoles(ctx);
      for (const role of MIDDLE_ROLES) {
        assert.ok(
          respawns.some((l) => l.includes(`swarmforge-${role}`)),
          `expected a repair for ${role}, got:\n${respawns.join('\n')}\noutput:\n${ctx.output}`
        );
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the rotate-home backstop does not fire$/,
    (ctx) => {
      assert.equal(ctx.rotateHome, 'false', 'ROTATE_HOME must keep its router-only meaning');
    },
    FEATURE
  );
}

module.exports = { registerSteps };
