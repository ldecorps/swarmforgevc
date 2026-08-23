'use strict';

// BL-1071: the shared fixture for driving a REAL babysitter sweep with a
// chosen probe broken.
//
// Three places need this — the acceptance step handler and the two property
// files — and the tricky parts (the bin farm, the two-role tmux stub, the
// pane-pid detail that decides whether a failing `ps` is even visible) are
// exactly the parts that go subtly wrong when copied. So they live here once.
//
// `mkdir` is INJECTED rather than called directly. The two contexts genuinely
// need different temp-dir lifecycles: a Vitest test allocates through the
// shared mkTmpDir helper so the per-test afterEach sweeps it (BL-420, and the
// tmpDirMigrationGuard forbids a raw mkdtemp anywhere else under
// extension/test/), while the acceptance runner has no afterEach and sweeps by
// prefix instead. Injecting the allocator is what lets one implementation
// serve both without either borrowing the other's cleanup rules.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHECK_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitter_check.sh');

// TWO standing roles, because one role cannot be both halves of the survival
// question. LIVE_ROLE has a pane with a pid, so a failing `ps` has something
// to fail to gather — `gather-failed?` is `(and pid (nil? ps-output))`, so a
// role with no pane produces no proc-gather finding at all and the probe's own
// failure would be invisible. VANISHED_ROLE has no session, so a repair is
// genuinely due and "a repair that is due is still performed" is not vacuous.
const LIVE_ROLE = 'coder';
const LIVE_SESSION = `swarmforge-${LIVE_ROLE}`;
const VANISHED_ROLE = 'cleaner';
const VANISHED_SESSION = `swarmforge-${VANISHED_ROLE}`;

const TMUX_TWO_ROLES =
  [
    '#!/usr/bin/env bash',
    'args="$*"',
    'case "$args" in',
    `  *has-session*${VANISHED_SESSION}*) exit 1 ;;`,
    '  *has-session*) exit 0 ;;',
    '  *list-panes*) echo 222; exit 0 ;;',
    "  *capture-pane*) printf '%%\\n'; exit 0 ;;",
    `  *list-sessions*) echo "${LIVE_SESSION}"; exit 0 ;;`,
    'esac',
    'exit 0',
  ].join('\n') + '\n';

const TMUX_NO_SERVER = '#!/usr/bin/env bash\nexit 1\n';

const PS_BROKEN = '#!/usr/bin/env bash\necho "ps: fixture failure" >&2\nexit 1\n';
const PGREP_GREEN = '#!/usr/bin/env bash\nexit 0\n';

// A ./swarm that records every ensure and returns immediately.
const SWARM_OK = '#!/usr/bin/env bash\necho 1 >> "$(dirname "$0")/ensure-count"\necho ensured\nexit 0\n';

function realSearchPath() {
  return (process.env.PATH || '').split(path.delimiter).filter(Boolean);
}

// A bin dir carrying a symlink to every executable on the real search path,
// minus the named ones.
//
// A FARM, not a curated list of "the binaries the sweep needs": a curated list
// is a guess that goes stale silently, and the failure it produces (a script
// dying on some unrelated missing binary) looks nothing like the thing under
// test. That is BL-814's own root cause and the reason BL-1063's nvm property
// farm is built this way.
//
// A shebang-to-nowhere does NOT work as a substitute and was measured: execvp
// keeps searching PATH past an unexecutable entry and finds the real binary.
// The binary has to be absent from every entry.
function farmWithout(mkdir, names) {
  const dir = mkdir();
  for (const searchDir of realSearchPath()) {
    let entries;
    try {
      entries = fs.readdirSync(searchDir);
    } catch {
      continue; // a PATH entry that does not exist is not an error
    }
    for (const name of entries) {
      if (names.includes(name)) continue;
      const link = path.join(dir, name);
      if (fs.existsSync(link)) continue; // first on PATH wins, as the shell does
      try {
        fs.symlinkSync(path.join(searchDir, name), link);
      } catch {
        /* a name we cannot link is one the farm simply does not carry */
      }
    }
  }
  for (const name of names) {
    assert.ok(
      !fs.existsSync(path.join(dir, name)),
      `the farm still carries "${name}", so nothing would break the probe it names`
    );
  }
  return dir;
}

function git(repo, ...args) {
  const r = spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
}

function roleRow(role, session) {
  return `${role}\t${role}\t${path.join('.worktrees', role)}\t${session}\tRole\tclaude\ttask\n`;
}

/**
 * A fixture repo in the shape test_babysitter_check.sh's make_root builds: a
 * git repo with main and swarmforge-QA at one commit (BL-631's check fails
 * closed without it), a readable meminfo, two standing roles and a socket.
 */
function makeSweepFixture(mkdir, { launchScripts = true, swarmStub = SWARM_OK } = {}) {
  const root = fs.realpathSync(mkdir());
  const state = path.join(root, '.swarmforge');
  fs.mkdirSync(path.join(state, 'handoffs', 'failed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'meminfo'), 'MemAvailable:    8000000 kB\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(root, 'branch', 'swarmforge-QA');

  for (const role of [LIVE_ROLE, VANISHED_ROLE]) {
    fs.mkdirSync(path.join(root, '.worktrees', role), { recursive: true });
  }
  fs.writeFileSync(
    path.join(state, 'roles.tsv'),
    roleRow(LIVE_ROLE, LIVE_SESSION) + roleRow(VANISHED_ROLE, VANISHED_SESSION)
  );
  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.writeFileSync(path.join(state, 'tmux-socket'), `${sock}\n`);

  if (launchScripts) {
    fs.mkdirSync(path.join(state, 'launch'), { recursive: true });
    for (const role of [LIVE_ROLE, VANISHED_ROLE]) {
      fs.writeFileSync(path.join(state, 'launch', `${role}.sh`), '#!/usr/bin/env zsh\necho fake-launch\n');
    }
  }
  fs.writeFileSync(path.join(root, 'swarm'), swarmStub, { mode: 0o755 });

  const stubs = mkdir();
  fs.writeFileSync(path.join(stubs, 'pgrep'), PGREP_GREEN, { mode: 0o755 });

  return { root, state, stubs, mkdir };
}

function writeStub(fixture, name, body) {
  fs.writeFileSync(path.join(fixture.stubs, name), body, { mode: 0o755 });
}

/**
 * Break the named probes, the way the live incident broke them.
 *
 *   memory        no readable meminfo AND no `vm_stat` to fall back to.
 *   ps            a `ps` that exits non-zero.
 *   control-plane no `tmux` anywhere on PATH, so the probe's own sh! throws
 *                 IOException out of ProcessBuilder before any exit code
 *                 exists — a throw, not a non-zero exit, and the same class
 *                 of failure `vm_stat` caused.
 */
function breakProbes(fixture, probes, { planeMissing = false } = {}) {
  const absent = [];
  if (probes.includes('memory')) {
    fixture.meminfoPath = path.join(fixture.root, 'no-such-meminfo');
    absent.push('vm_stat');
  }
  if (probes.includes('control-plane')) absent.push('tmux');
  if (absent.length > 0) fixture.binPath = farmWithout(fixture.mkdir, absent);
  if (probes.includes('ps')) writeStub(fixture, 'ps', PS_BROKEN);
  if (!probes.includes('control-plane')) {
    writeStub(fixture, 'tmux', planeMissing ? TMUX_NO_SERVER : TMUX_TWO_ROLES);
    fixture.paneGatherable = !planeMissing;
  }
  fixture.brokenProbes = probes;
  return fixture;
}

function ensureCalls(fixture) {
  const log = path.join(fixture.root, 'ensure-count');
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
}

function runSweep(fixture, extraEnv = {}) {
  const dirs = fixture.binPath ? [fixture.stubs, fixture.binPath] : [fixture.stubs, ...realSearchPath()];
  const started = Date.now();
  const r = spawnSync('bash', [CHECK_SH, fixture.root], {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      PATH: dirs.join(path.delimiter),
      BABYSITTER_MEMINFO_PATH: fixture.meminfoPath ?? path.join(fixture.root, 'meminfo'),
      ...extraEnv,
    },
  });
  return {
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    exitCode: r.status,
    elapsedMs: Date.now() - started,
  };
}

// The incident's own signature, inverted: babysitterd.log carried ~192 stack
// traces, zero "OK all checks green" and zero REPAIR lines.
function died(output) {
  return /Exception|at clojure\.|----- Error/.test(output);
}
function reachedFindings(output) {
  return /OK all checks green|CRIT \[|WARN \[|UNAVAILABLE \[/.test(output);
}
function reachedRepair(output) {
  return /REPAIR \[/.test(output);
}

module.exports = {
  CHECK_SH,
  LIVE_ROLE,
  LIVE_SESSION,
  VANISHED_ROLE,
  VANISHED_SESSION,
  TMUX_TWO_ROLES,
  TMUX_NO_SERVER,
  SWARM_OK,
  farmWithout,
  makeSweepFixture,
  writeStub,
  breakProbes,
  ensureCalls,
  runSweep,
  died,
  reachedFindings,
  reachedRepair,
};
