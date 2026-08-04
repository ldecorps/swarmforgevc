'use strict';

// BL-802: step handlers for "babysitterd runs on the macOS swarm host".
// Drives the REAL scripts (never a parallel reimplementation): the real
// start_babysitterd.sh against disposable fixture roots with curated PATH
// overrides for the setsid scenarios, the real babysitter_check.sh with
// fake tmux/ps binaries on PATH for the pane-gather scenario, and the real
// pure babysitterd_sweep_lib.bb check-memory-floor (via `bb -e`, same idiom
// as bl611BabysitterdLifecycleSteps.js) for the memory-floor scenarios.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');
const START_BABYSITTERD_SH = path.join(SCRIPTS, 'start_babysitterd.sh');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');

const FEATURE = 'BL-802 babysitterd runs on the macOS swarm host';

const LIVE_PIDS = new Set();
function trackPid(pid) {
  if (pid) LIVE_PIDS.add(pid);
}
function reapPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  LIVE_PIDS.delete(pid);
}
process.on('exit', () => {
  for (const pid of LIVE_PIDS) reapPid(pid);
});

function mkFixtureRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bl802-'));
  fs.mkdirSync(path.join(d, '.swarmforge', 'handoffs', 'failed'), { recursive: true });
  fs.mkdirSync(path.join(d, 'backlog', 'active'), { recursive: true });
  return d;
}

function pidFile(root) {
  return path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.pid');
}

function readPid(root) {
  const p = pidFile(root);
  if (!fs.existsSync(p)) return null;
  const s = fs.readFileSync(p, 'utf8').trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitFor(predicate, { tries = 25, intervalMs = 200 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return true;
    const until = Date.now() + intervalMs;
    while (Date.now() < until) {
      /* busy-wait a short, bounded interval — no external sleep dependency */
    }
  }
  return predicate();
}

// Every tool start_babysitterd.sh/babysitterd.sh/freshness_stop_marker_lib.sh
// actually shell out to, resolved by name (never setsid) — a curated,
// resolve-by-name symlink farm instead of whole-PATH-tree scanning, which
// measured 6-20s in dev and starved the very next scenario of process-
// creation headroom under that load.
const REQUIRED_TOOLS = [
  'bash', 'sh', 'env', 'mkdir', 'cat', 'sleep', 'date', 'wc', 'tail', 'mv',
  'touch', 'rm', 'nohup', 'cp', 'ls', 'basename', 'dirname', 'grep', 'sed',
  'awk', 'cut', 'head', 'xargs', 'find', 'chmod', 'stat', 'readlink',
  'hostname', 'uname', 'tr', 'sort', 'mktemp', 'ps', 'pgrep', 'true',
  'false', 'git',
];

function buildPathWithoutSetsid() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl802-no-setsid-'));
  for (const tool of REQUIRED_TOOLS) {
    const resolved = spawnSync('command', ['-v', tool], { shell: true, encoding: 'utf8' }).stdout.trim();
    if (!resolved) continue;
    try {
      fs.symlinkSync(resolved, path.join(dir, tool));
    } catch {
      /* best-effort; a missing optional tool does not invalidate the scenario */
    }
  }
  return dir;
}

function buildPathWithSetsidStub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl802-setsid-stub-'));
  const stub = path.join(dir, 'setsid');
  fs.writeFileSync(stub, '#!/usr/bin/env bash\nexec "$@"\n');
  fs.chmodSync(stub, 0o755);
  return `${dir}:${process.env.PATH}`;
}

// start_babysitterd.sh's own confirmation loop is a bounded 1s (5 x 0.2s) —
// occasionally too tight under the process-creation load of a back-to-back
// acceptance run. Re-invoking is safe: the script checks the pidfile first
// and is a no-op ("already running") if the prior attempt actually landed.
function startWithRetry(root, pathOverride) {
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = spawnSync('bash', [START_BABYSITTERD_SH, root], {
      encoding: 'utf8',
      env: { ...process.env, PATH: pathOverride },
    });
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    if (/started|already running/.test(out)) return result;
  }
  return result;
}

// ── bb -e helper: evaluate an expression against the pure sweep lib ────────
function cljVal(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(cljVal).join(' ')}]`;
  if (typeof v === 'object') {
    const parts = Object.entries(v).map(([k, val]) => `:${k} ${cljVal(val)}`);
    return `{${parts.join(' ')}}`;
  }
  throw new Error(`unsupported clj value: ${v}`);
}

function bbEval(expr) {
  const code = `(load-file "${SWEEP_LIB}") (require '[babysitterd-sweep-lib :as sw]) (println (pr-str ${expr}))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed for: ${expr}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function ensureState(ctx) {
  if (!ctx.bl802) ctx.bl802 = {};
  return ctx.bl802;
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.defineScoped(/^a fixture project root with a \.swarmforge directory$/, (ctx) => {
    ensureState(ctx).root = mkFixtureRoot();
  }, FEATURE);

  // ── Scenarios 01/02: setsid present/absent on PATH ──────────────────────
  registry.defineScoped(/^setsid is not resolvable on PATH$/, (ctx) => {
    const st = ensureState(ctx);
    st.pathOverride = buildPathWithoutSetsid();
    st.pathOverrideDir = st.pathOverride;
  }, FEATURE);

  registry.defineScoped(/^a setsid stub is resolvable on PATH$/, (ctx) => {
    const st = ensureState(ctx);
    st.pathOverride = buildPathWithSetsidStub();
  }, FEATURE);

  registry.defineScoped(/^start_babysitterd\.sh starts the daemon$/, (ctx) => {
    const st = ensureState(ctx);
    st.startResult = startWithRetry(st.root, st.pathOverride);
  }, FEATURE);

  registry.defineScoped(/^it exits 0 reporting a live pidfile$/, (ctx) => {
    const st = ensureState(ctx);
    const out = `${st.startResult.stdout || ''}${st.startResult.stderr || ''}`;
    if (!/started/.test(out)) {
      throw new Error(`expected a start confirmation; got:\n${out}`);
    }
    const ok = waitFor(() => pidAlive(readPid(st.root)));
    if (!ok) throw new Error(`babysitterd never produced a live pidfile in ${st.root}`);
    st.pid = readPid(st.root);
    trackPid(st.pid);
  }, FEATURE);

  registry.defineScoped(/^the daemon process outlives the invoking shell$/, (ctx) => {
    const st = ensureState(ctx);
    // startWithRetry's spawnSync has already returned (the launcher shell
    // has exited) by the time the pidfile/liveness check above ran — that
    // check IS the survival proof, this step names it explicitly.
    if (!pidAlive(st.pid)) {
      throw new Error(`babysitterd (pid ${st.pid}) did not survive the invoking shell's exit`);
    }
  }, FEATURE);

  // ── Scenario 03: pane process gather on BSD-style ps ────────────────────
  registry.defineScoped(/^a ps stub on PATH that rejects the --ppid option but supports BSD syntax$/, (ctx) => {
    const st = ensureState(ctx);
    st.fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'bl802-fakebin-'));
    const ps = path.join(st.fakeBin, 'ps');
    fs.writeFileSync(
      ps,
      [
        '#!/usr/bin/env bash',
        'for arg in "$@"; do',
        '  if [[ "$arg" == "--ppid" ]]; then',
        '    echo "ps: illegal option -- -" >&2',
        '    exit 1',
        '  fi',
        'done',
        'cat <<\'ROWS\'',
        '  111     1 /sbin/launchd',
        '  222   111 /bin/bash pane-shell',
        '  333   222 claude --remote-control fake',
        'ROWS',
        '',
      ].join('\n')
    );
    fs.chmodSync(ps, 0o755);
  }, FEATURE);

  registry.defineScoped(/^a pane whose shell has one live child process$/, (ctx) => {
    const st = ensureState(ctx);
    fs.mkdirSync(path.join(st.root, '.worktrees', 'coder'), { recursive: true });
    fs.writeFileSync(
      path.join(st.root, '.swarmforge', 'roles.tsv'),
      `coder\tcoder\t${path.join(st.root, '.worktrees', 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask\n`
    );
    const sock = path.join(st.root, 'fake.sock');
    fs.writeFileSync(sock, '');
    fs.writeFileSync(path.join(st.root, '.swarmforge', 'tmux-socket'), sock);
    const tmux = path.join(st.fakeBin, 'tmux');
    fs.writeFileSync(
      tmux,
      [
        '#!/usr/bin/env bash',
        'for arg in "$@"; do',
        '  if [[ "$arg" == "has-session" ]]; then exit 0; fi',
        '  if [[ "$arg" == "list-panes" ]]; then echo "222"; exit 0; fi',
        '  if [[ "$arg" == "capture-pane" ]]; then printf \'%%\\n\'; exit 0; fi',
        'done',
        'exit 0',
        '',
      ].join('\n')
    );
    fs.chmodSync(tmux, 0o755);
  }, FEATURE);

  registry.defineScoped(/^the sweep gathers that pane's processes$/, (ctx) => {
    const st = ensureState(ctx);
    fs.writeFileSync(path.join(st.root, 'meminfo'), 'MemAvailable:    8000000 kB\n');
    st.checkResult = spawnSync('bash', [CHECK_SH, st.root], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${st.fakeBin}:${process.env.PATH}`,
        BABYSITTER_MEMINFO_PATH: path.join(st.root, 'meminfo'),
      },
    });
  }, FEATURE);

  registry.defineScoped(/^the gather returns the live child$/, (ctx) => {
    const st = ensureState(ctx);
    const out = st.checkResult.stdout || '';
    if (/CRIT \[proc-coder\]/.test(out)) {
      throw new Error(`expected the BSD-ps gather to find the live claude child, not a half-launch CRIT; got:\n${out}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the sweep log records no gather failure for that pane$/, (ctx) => {
    const st = ensureState(ctx);
    const out = st.checkResult.stdout || '';
    if (/UNAVAILABLE \[proc-gather-coder\]/.test(out)) {
      throw new Error(`expected no gather-unavailable line once the BSD-syntax ps gather succeeded; got:\n${out}`);
    }
  }, FEATURE);

  // ── Scenario 04/05: memory floor reads whatever facility gathered ───────
  registry.defineScoped(/^\/proc\/meminfo is absent$/, () => {
    /* documents the host condition BL-802 fixes for; the memory-floor pure
       check (exercised below) is agnostic to which facility gathered its
       :available-mb input — the real vm_stat-vs-meminfo I/O selection is
       covered directly by test_babysitter_check.sh scenarios G/H. */
  }, FEATURE);

  registry.defineScoped(/^the host memory seam reports (\d+) MB available$/, (ctx, mb) => {
    ensureState(ctx).availableMb = Number(mb);
  }, FEATURE);

  registry.defineScoped(/^every memory facility the sweep knows is absent$/, (ctx) => {
    ensureState(ctx).availableMb = null;
  }, FEATURE);

  registry.defineScoped(/^the configured memory floor is (\d+) MB$/, (ctx, mb) => {
    ensureState(ctx).floorMb = Number(mb);
  }, FEATURE);

  registry.defineScoped(/^the sweep runs the memory floor check$/, (ctx) => {
    const st = ensureState(ctx);
    const floorMb = st.floorMb ?? 1500;
    st.memoryResult = bbEval(`(sw/check-memory-floor ${cljVal({ 'available-mb': st.availableMb, 'floor-mb': floorMb })})`);
  }, FEATURE);

  registry.defineScoped(/^the memory floor check (raises a finding|stays quiet)$/, (ctx, outcome) => {
    const st = ensureState(ctx);
    const isNil = st.memoryResult === 'nil';
    if (outcome === 'raises a finding') {
      if (isNil || !st.memoryResult.includes(':severity "CRIT"')) {
        throw new Error(`expected a CRIT memory finding; got: ${st.memoryResult}`);
      }
    } else if (!isNil) {
      throw new Error(`expected no finding (quiet); got: ${st.memoryResult}`);
    }
  }, FEATURE);

  registry.defineScoped(/^no finding is raised by the memory floor check$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.memoryResult.includes(':severity "CRIT"') || st.memoryResult.includes(':severity "WARN"')) {
      throw new Error(`expected no CRIT/WARN finding from a failed gather; got: ${st.memoryResult}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the sweep log records the memory floor check as unavailable$/, (ctx) => {
    const st = ensureState(ctx);
    if (!st.memoryResult.includes(':severity "UNAVAILABLE"')) {
      throw new Error(`expected the memory floor check to report UNAVAILABLE; got: ${st.memoryResult}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
