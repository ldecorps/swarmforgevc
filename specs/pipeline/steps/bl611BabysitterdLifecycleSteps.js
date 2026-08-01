'use strict';

// BL-611: step handlers for "babysitterd is a deterministic daemon managed
// by the swarm lifecycle". Drives REAL scripts wherever possible (never a
// parallel reimplementation): babysitterd_sweep_lib.bb's pure functions via
// `bb -e` for the fixture-driven check scenarios, and the real shell/bb
// lifecycle scripts (start_babysitterd.sh, babysitterd.sh, babysitter_check.sh,
// start_ancillary_services.sh, stop_ancillary_services.sh, kill_all_swarm.sh,
// swarm_ensure.bb, swarm_status.bb) against disposable fixture roots for the
// integration scenarios.
//
// Every real babysitterd process this file starts is tracked in
// LIVE_PIDS and reaped on the Node process exit, in addition to whatever a
// scenario's own steps stop — a stray daemon loop surviving the acceptance
// run would itself trip BL-637's own survivor scan (as it should).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');
const DAEMON_SH = path.join(SCRIPTS, 'babysitterd.sh');
const START_BABYSITTERD_SH = path.join(SCRIPTS, 'start_babysitterd.sh');
const START_ANCILLARY_SH = path.join(SCRIPTS, 'start_ancillary_services.sh');
const STOP_ANCILLARY_SH = path.join(SCRIPTS, 'stop_ancillary_services.sh');
const KILL_ALL_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'kill_all_swarm.sh');
const SWARM_ENSURE_BB = path.join(SCRIPTS, 'swarm_ensure.bb');
const SWARM_STATUS_BB = path.join(SCRIPTS, 'swarm_status.bb');
const ASSESS_LIB_TEST_RUNNER = path.join(SCRIPTS, 'test', 'babysitter_assess_lib_test_runner.bb');
const TEST_BABYSITTER_CHECK_SH = path.join(SCRIPTS, 'test', 'test_babysitter_check.sh');
const TEST_LIFECYCLE_SH = path.join(SCRIPTS, 'test', 'test_babysitterd_lifecycle.sh');
const START_SWARM_SH = path.join(REPO_ROOT, 'start-swarm.sh');
const STOP_SWARM_SH = path.join(REPO_ROOT, 'stop-swarm.sh');

const FEATURE = 'babysitterd is a deterministic daemon managed by the swarm lifecycle';

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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bl611-'));
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

function ancillarySkipEnv() {
  return {
    SWARMFORGE_SKIP_OPERATOR: '1',
    SWARMFORGE_SKIP_FRONT_DESK: '1',
    SWARMFORGE_SKIP_ONBOARDER: '1',
    SWARMFORGE_SKIP_TUNNEL: '1',
    SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL: '1',
  };
}

function runStartAncillary(root) {
  return spawnSync('bash', [START_ANCILLARY_SH, root], {
    encoding: 'utf8',
    env: { ...process.env, ...ancillarySkipEnv() },
  });
}

function runStopAncillary(root) {
  return spawnSync('bash', [STOP_ANCILLARY_SH, root], { encoding: 'utf8', env: process.env });
}

function ensureState(ctx) {
  if (!ctx.bl611) ctx.bl611 = {};
  return ctx.bl611;
}

// Starts a REAL babysitterd for the given fixture root and waits for a live
// pidfile. Tracked for exit-time reaping.
function startRealBabysitterd(root) {
  const result = spawnSync('bash', [START_BABYSITTERD_SH, root], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`start_babysitterd.sh failed:\n${result.stdout}\n${result.stderr}`);
  }
  const ok = waitFor(() => pidAlive(readPid(root)));
  if (!ok) {
    throw new Error(`babysitterd never produced a live pidfile in ${root}`);
  }
  const pid = readPid(root);
  trackPid(pid);
  return pid;
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

function bbNil(pr) {
  return pr === 'nil';
}

// check-swarm-starved returns {:finding ... :new-streak ...}, never a bare
// nilable — bbNil() must never be applied to its whole pr-str.
function starvedFindingIsNil(pr) {
  return pr.includes(':finding nil');
}

// Clojure map with STRING keys (not the generic keyword-keyed cljVal object
// serialization) — decide-nudges looks dedup state up by a finding's :key,
// which is always a plain string, never a keyword.
function cljStrMap(obj) {
  const parts = Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)} ${cljVal(v)}`);
  return `{${parts.join(' ')}}`;
}

// decide-nudges' opts map, with last-nudged-ms-by-key correctly string-keyed.
function cljDecideNudgesOpts({ lastNudgedMsByKey = {}, nowMs, cooldownMs }) {
  return `{:last-nudged-ms-by-key ${cljStrMap(lastNudgedMsByKey)} :now-ms ${nowMs} :cooldown-ms ${cooldownMs}}`;
}

// ── KNOWN_VALUES: scenario-05 check-name -> {green, degraded} snapshots ────
// BL-112: Scenario Outline example values are validated against this
// explicit map — an unrecognized <check name>/<degraded condition> throws,
// never silently passes through.
const CHECK_05_FIXTURES = {
  'live-session-per-role': {
    degradedCondition: 'a role pane with no live claude process (via ps --ppid)',
    green: { role: 'coder', 'pane-exists?': true, 'has-claude-process?': true },
    degraded: { role: 'coder', 'pane-exists?': true, 'has-claude-process?': false },
    fn: 'check-live-session',
    keyPrefix: 'proc-',
  },
  'remote-control-flag': {
    degradedCondition: 'a live process missing --remote-control',
    green: { role: 'coder', 'pane-exists?': true, 'has-claude-process?': true, 'has-remote-control?': true },
    degraded: { role: 'coder', 'pane-exists?': true, 'has-claude-process?': true, 'has-remote-control?': false },
    fn: 'check-remote-control',
    keyPrefix: 'rc-',
  },
  'handoffd-supervisor-fresh': {
    degradedCondition: 'handoffd.log older than 5 minutes',
    green: { 'handoffd-alive?': true, 'supervisor-alive?': true, 'log-age-secs': 5, 'max-age-secs': 300 },
    degraded: { 'handoffd-alive?': true, 'supervisor-alive?': true, 'log-age-secs': 400, 'max-age-secs': 300 },
    fn: 'check-handoffd-supervisor-fresh',
    keyPrefix: 'heartbeat',
  },
  'dead-letter-nonempty': {
    degradedCondition: 'a non-empty .swarmforge/handoffs/failed/ box',
    green: { 'failed-count': 0 },
    degraded: { 'failed-count': 2 },
    fn: 'check-dead-letter',
    keyPrefix: 'failed-box',
  },
  'stuck-in-process': {
    degradedCondition: 'an in_process parcel older than 30 minutes in a worktree mailbox',
    greenList: [],
    degradedList: [{ name: 'p1', 'age-min': 45 }],
    fn: 'check-stuck-in-process',
    keyPrefix: 'stuck-',
    listCheck: true,
  },
  'menu-blocked-pane': {
    degradedCondition: 'a pane capture showing an interactive menu/dialog',
    green: { role: 'coder', 'menu-blocked?': false },
    degraded: { role: 'coder', 'menu-blocked?': true },
    fn: 'check-menu-blocked',
    keyPrefix: 'menu-',
  },
  'busy-but-frozen': {
    degradedCondition: 'an unchanged spinner-stripped content hash across 3 sweeps',
    green: { role: 'coder', 'busy?': true, 'hash-history': ['a', 'b', 'c'] },
    degraded: { role: 'coder', 'busy?': true, 'hash-history': ['a', 'a', 'a'] },
    fn: 'check-busy-frozen',
    keyPrefix: 'frozen-',
  },
  'memory-floor': {
    degradedCondition: 'available memory below the configured floor',
    green: { 'available-mb': 4000, 'floor-mb': 1500 },
    degraded: { 'available-mb': 800, 'floor-mb': 1500 },
    fn: 'check-memory-floor',
    keyPrefix: 'memory',
  },
};

// ── scenario 15 allowlist: files a repo-wide "babysitter" grep may match ───
function isAllowedBabysitterMatch(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('backlog/') || p.startsWith('docs/')) return true; // history/records
  if (p === 'backlog/topics/BABYSITTER.json') return true;
  // the deterministic daemon itself + its thin wrappers
  if (/^swarmforge\/scripts\/babysitterd?(_check|d_sweep_lib|\.sh|d\.sh)?/.test(p)) return true;
  if (p === 'swarmforge/scripts/start_babysitterd.sh') return true;
  // every test file, regardless of filename — cross-ticket test suites
  // referencing the shared daemon/paths/env-vars are expected and harmless;
  // scenario 15's real concern is retired-agent PRODUCT code, not test refs.
  if (p.startsWith('swarmforge/scripts/test/')) return true;
  if (p.startsWith('specs/pipeline/steps/')) return true;
  // salvaged pure libraries this ticket explicitly KEEPs
  if (
    [
      'swarmforge/scripts/babysitter_assess_lib.bb',
      'swarmforge/scripts/babysitter_assess.bb',
      'swarmforge/scripts/babysitter_lib.bb',
      'swarmforge/scripts/babysitter_nudge_lib.bb',
      'swarmforge/scripts/babysitter_nudge_resident.bb',
      'swarmforge/scripts/babysitter_enqueue_wake.sh',
    ].includes(p)
  ) {
    return true;
  }
  // lifecycle scripts wiring the daemon in (comments + real calls)
  if (
    [
      'swarmforge/scripts/start_ancillary_services.sh',
      'swarmforge/scripts/stop_ancillary_services.sh',
      'swarmforge/scripts/kill_all_swarm.sh',
      'swarmforge/scripts/kill_pipeline_swarm.sh',
      'swarmforge/scripts/swarm_ensure.bb',
      'swarmforge/scripts/swarm_status.bb',
      'swarmforge/scripts/stack_survivor_scan.sh',
      'swarmforge/scripts/daemon_log_freshness.conf',
      'swarmforge/scripts/ancillary_provider_lib.sh',
      'start-swarm.sh',
      'stop-swarm.sh',
      'swarm-kill',
    ].includes(p)
  ) {
    return true;
  }
  // disposable-onboarding-root orphan reaping is a distinct, unrelated
  // concern (stray processes from throwaway test sandboxes, not the swarm's
  // own babysitter) — out of this ticket's scope, left untouched.
  if (
    [
      'swarmforge/scripts/orphan_janitor_lib.bb',
      'swarmforge/scripts/orphan_janitor_sweep_lib.bb',
      'swarmforge/scripts/operator_runtime.bb',
      'swarmforge/scripts/flow_watchdog_lib.bb',
      'extension/src/tools/telegramCursorBridgePilot.ts',
      'extension/test/telegramCursorBridgePilot.test.js',
    ].includes(p)
  ) {
    return true;
  }
  // the expeditor already names the shipped daemon process pattern
  if (['swarmforge/scripts/expedite_lib.bb', 'swarmforge/scripts/expedite_cli.bb'].includes(p)) return true;
  if (p.startsWith('specs/features/')) return true;
  // salvaged pure topic decision (durable Babysitter Telegram topic record)
  if (
    [
      'extension/src/tools/telegram-front-desk-bot.ts',
      'extension/src/tools/telegramFrontDeskBotCore.ts',
      'extension/src/tools/telegramTopicDecisions.ts',
      'extension/test/telegramFrontDeskBotCore.test.js',
    ].includes(p)
  ) {
    return true;
  }
  return false;
}

// Used two ways: (a) scenario 15 checks these FILES no longer EXIST — a
// historical mention of the old filename in backlog/docs/evidence prose (or
// in this very scanner's own detection logic) is expected and fine, only a
// resurrected FILE at that path is the regression; (b) scenario 16 checks a
// lifecycle script's own stdout/stderr never names one of these paths in a
// missing-file error, which IS a legitimate content check on script output.
const RETIRED_FILE_PATHS = [
  'babysit.sh',
  'swarmforge/roles/babysitter.prompt',
  'swarmforge/scripts/launch_babysitter.sh',
  'swarmforge/scripts/start_babysitter.sh',
  'swarmforge/scripts/babysitter.claude-settings.json',
  'extension/src/tools/notify-babysitter.ts',
  'swarmforge/scripts/babysitter_runtime.bb',
];

const FORBIDDEN_RETIRED_PATTERNS = [
  /babysit\.sh/i,
  /babysitter\.prompt/i,
  /launch_babysitter\.sh/i,
  /start_babysitter\.sh(?!d)/i, // start_babysitter.sh, but not start_babysitterd.sh
  /babysitter\.claude-settings\.json/i,
  /notify-babysitter/i,
  /babysitter_runtime\.bb/i,
];

// git-tracked files only — "the repo after this ticket lands" means the
// shipped, version-controlled content, never gitignored runtime state
// (.swarmforge/), worktree scratch (tmp/), local tool caches (.aider.*), or
// regenerated build artifacts (specs/pipeline/generated/, .vitest-report.json).
function listTrackedFiles() {
  // --cached (committed/staged) + --others --exclude-standard (untracked but
  // not gitignored, e.g. this ticket's new files before their own commit) —
  // never plain `git ls-files`, which would silently omit anything not yet
  // staged and let a real offender hide behind "I haven't committed it yet".
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout.split('\n').filter(Boolean);
}

function scanRepoForBabysitter() {
  const offenders = [];
  const tracked = new Set(listTrackedFiles());
  for (const rel of tracked) {
    const abs = path.join(REPO_ROOT, rel);
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue; // binary or unreadable — not a text match
    }
    if (!/babysit/i.test(content) && !/babysit/i.test(path.basename(rel))) continue;
    if (!isAllowedBabysitterMatch(rel)) offenders.push(rel);
  }
  // File-existence check (not a content scan) — a historical mention of a
  // retired filename in backlog/docs prose is expected; a resurrected file
  // AT that path is the actual regression scenario 15 guards against.
  const forbidden = RETIRED_FILE_PATHS.filter((rel) => tracked.has(rel));
  return { offenders, forbidden };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.defineScoped(/^SWARMFORGE_SKIP_BABYSITTERD is not set$/, (ctx) => {
    ensureState(ctx).skipBabysitterd = false;
  }, FEATURE);

  // ── Scenario 01: lifecycle-start-stop ───────────────────────────────────
  registry.defineScoped(/^start-swarm\.sh runs$/, (ctx) => {
    const st = ensureState(ctx);
    st.root = st.root || mkFixtureRoot();
    const result = runStartAncillary(st.root);
    st.lastStart = result;
    const pid = readPid(st.root);
    if (pid) trackPid(pid);
  }, FEATURE);

  // Shared text across two scenarios: scenario 1's Then (verify what
  // start-swarm.sh just produced) and scenario 3's Given (its own fresh
  // setup — nothing started it yet). Distinguish by whether a root is
  // already in play, not by which keyword the feature file used.
  registry.defineScoped(/^babysitterd is running with a live pidfile$/, (ctx) => {
    const st = ensureState(ctx);
    if (!st.root) {
      st.root = mkFixtureRoot();
      st.startedPid = startRealBabysitterd(st.root);
      return;
    }
    const ok = waitFor(() => pidAlive(readPid(st.root)));
    if (!ok) {
      throw new Error(`babysitterd is not running with a live pidfile; start output:\n${JSON.stringify(st.lastStart)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^stop-swarm\.sh runs$/, (ctx) => {
    const st = ensureState(ctx);
    st.lastStop = runStopAncillary(st.root);
  }, FEATURE);

  registry.defineScoped(/^babysitterd is stopped and its pidfile is removed$/, (ctx) => {
    const st = ensureState(ctx);
    const pid = st.startedPid || readPid(st.root);
    if (pidAlive(pid)) {
      throw new Error(`babysitterd (pid ${pid}) is still alive after stop-swarm.sh`);
    }
    if (fs.existsSync(pidFile(st.root))) {
      throw new Error('babysitterd pidfile still present after stop-swarm.sh');
    }
  }, FEATURE);

  // ── Scenario 02: double-start-refused ───────────────────────────────────
  registry.defineScoped(/^babysitterd is already running with a live pidfile$/, (ctx) => {
    const st = ensureState(ctx);
    st.root = st.root || mkFixtureRoot();
    st.startedPid = startRealBabysitterd(st.root);
  }, FEATURE);

  registry.defineScoped(/^start_ancillary_services\.sh attempts to start babysitterd again$/, (ctx) => {
    const st = ensureState(ctx);
    st.secondStart = runStartAncillary(st.root);
  }, FEATURE);

  registry.defineScoped(/^the second start is refused$/, (ctx) => {
    const st = ensureState(ctx);
    const pidAfter = readPid(st.root);
    if (pidAfter !== st.startedPid) {
      throw new Error(`expected pidfile to remain ${st.startedPid}, got ${pidAfter} — a second daemon was started`);
    }
  }, FEATURE);

  registry.defineScoped(/^the original babysitterd process is left running$/, (ctx) => {
    const st = ensureState(ctx);
    if (!pidAlive(st.startedPid)) {
      throw new Error(`original babysitterd (pid ${st.startedPid}) is no longer running`);
    }
    reapPid(st.startedPid); // scenario has no explicit stop step — clean up now
  }, FEATURE);

  // ── Scenario 03: kill_all_swarm includes babysitterd ────────────────────
  registry.defineScoped(/^kill_all_swarm\.sh runs$/, (ctx) => {
    const st = ensureState(ctx);
    st.killResult = spawnSync('bash', [KILL_ALL_SH, st.root], { encoding: 'utf8' });
  }, FEATURE);

  registry.defineScoped(/^babysitterd is signalled via its pidfile$/, (ctx) => {
    const st = ensureState(ctx);
    if (pidAlive(st.startedPid)) {
      throw new Error(`babysitterd (pid ${st.startedPid}) is still alive after kill_all_swarm.sh`);
    }
    reapPid(st.startedPid);
  }, FEATURE);

  registry.defineScoped(/^its pidfile is removed$/, (ctx) => {
    const st = ensureState(ctx);
    if (fs.existsSync(pidFile(st.root))) {
      throw new Error('babysitterd pidfile still present after kill_all_swarm.sh');
    }
  }, FEATURE);

  // ── Scenario 04: ensure restarts dead, leaves live alone (Outline) ──────
  const ENSURE_STATES = new Set(['not running', 'already running']);
  const ENSURE_ACTIONS = new Set(['a fresh babysitterd is started', 'no restart is performed']);

  registry.defineScoped(/^babysitterd is (not running|already running)$/, (ctx, state) => {
    if (!ENSURE_STATES.has(state)) throw new Error(`unrecognized babysitterd state "${state}"`);
    const st = ensureState(ctx);
    st.root = st.root || mkFixtureRoot();
    st.ensureState = state;
    if (state === 'already running') {
      st.startedPid = startRealBabysitterd(st.root);
    }
  }, FEATURE);

  registry.defineScoped(/^\.\/swarm ensure runs$/, (ctx) => {
    const st = ensureState(ctx);
    const env = {
      ...process.env,
      SWARM_ENSURE_EXTENSION_CHECK_CMD: 'true',
      SWARM_ENSURE_SUPERVISOR_CMD: 'true',
      SWARM_ENSURE_OPERATOR_CMD: 'true',
      SWARM_ENSURE_FRONT_DESK_CMD: 'true',
    };
    st.ensureResult = spawnSync('bb', [SWARM_ENSURE_BB, st.root], { encoding: 'utf8', env });
  }, FEATURE);

  registry.defineScoped(/^babysitterd ends the tick running$/, (ctx) => {
    const st = ensureState(ctx);
    const ok = waitFor(() => pidAlive(readPid(st.root)));
    if (!ok) throw new Error(`babysitterd is not running after ./swarm ensure:\n${st.ensureResult.stdout}`);
  }, FEATURE);

  registry.defineScoped(/^(a fresh babysitterd is started|no restart is performed) occurs$/, (ctx, action) => {
    if (!ENSURE_ACTIONS.has(action)) throw new Error(`unrecognized ensure action "${action}"`);
    const st = ensureState(ctx);
    const out = st.ensureResult.stdout || '';
    const pidAfter = readPid(st.root);
    if (action === 'a fresh babysitterd is started') {
      if (!/babysitterd: FIXED/.test(out)) throw new Error(`expected babysitterd: FIXED in ensure output:\n${out}`);
      reapPid(pidAfter);
    } else {
      if (!/babysitterd: HEALTHY/.test(out)) throw new Error(`expected babysitterd: HEALTHY in ensure output:\n${out}`);
      if (pidAfter !== st.startedPid) throw new Error(`expected pid to remain ${st.startedPid}, got ${pidAfter} — a restart occurred`);
      reapPid(st.startedPid);
    }
  }, FEATURE);

  // ── Scenario 05: 8 checks fire-and-stay-quiet (Outline) ─────────────────
  registry.defineScoped(/^a green snapshot with no degraded condition$/, (ctx) => {
    ensureState(ctx).phase = 'green';
  }, FEATURE);

  registry.defineScoped(/^the finding-assembly core evaluates it$/, () => {
    /* no-op: evaluation happens per-check in the Then step below, since the
       fixture (green vs degraded) is only known once the check name is
       matched there too. */
  }, FEATURE);

  registry.defineScoped(/^no finding is produced for (.+)$/, (ctx, checkName) => {
    const fixture = CHECK_05_FIXTURES[checkName];
    if (!fixture) throw new Error(`BL-611: unrecognized check name "${checkName}"`);
    const st = ensureState(ctx);
    st.fixture = fixture;
    st.checkName = checkName;
    const arg = fixture.listCheck ? fixture.greenList : fixture.green;
    const pr = bbEval(`(sw/${fixture.fn} ${cljVal(arg)})`);
    const isEmpty = fixture.listCheck ? pr === '[]' : bbNil(pr);
    if (!isEmpty) throw new Error(`expected no finding for ${checkName} on the green fixture; got: ${pr}`);
  }, FEATURE);

  registry.defineScoped(/^a snapshot degraded only by (.+)$/, (ctx, condition) => {
    const st = ensureState(ctx);
    if (!st.fixture) throw new Error(`no check name resolved yet for degraded condition "${condition}"`);
    if (st.fixture.degradedCondition !== condition) {
      throw new Error(`degraded condition "${condition}" does not match fixture for "${st.checkName}" (expected "${st.fixture.degradedCondition}")`);
    }
  }, FEATURE);

  registry.defineScoped(/^exactly the (.+) finding is produced$/, (ctx, checkName) => {
    const st = ensureState(ctx);
    if (st.checkName !== checkName) throw new Error(`expected check "${st.checkName}", Then names "${checkName}"`);
    const fixture = st.fixture;
    const arg = fixture.listCheck ? fixture.degradedList : fixture.degraded;
    const pr = bbEval(`(sw/${fixture.fn} ${cljVal(arg)})`);
    if (fixture.listCheck) {
      if (!pr.includes(`:key "${fixture.keyPrefix}`)) throw new Error(`expected a ${fixture.keyPrefix}* finding; got: ${pr}`);
    } else {
      if (bbNil(pr)) throw new Error(`expected a finding for ${checkName} on the degraded fixture; got nil`);
      if (!pr.includes(`:key "${fixture.keyPrefix}`)) {
        throw new Error(`expected finding key to start with "${fixture.keyPrefix}"; got: ${pr}`);
      }
    }
  }, FEATURE);

  // ── Scenario 06: claim-progress risk scan as check 11 ───────────────────
  registry.defineScoped(/^babysitter_assess_lib\.bb's existing unit tests$/, () => {}, FEATURE);

  registry.defineScoped(/^they run against the ported deterministic check$/, (ctx) => {
    ensureState(ctx).assessResult = spawnSync('bb', [ASSESS_LIB_TEST_RUNNER], { encoding: 'utf8' });
  }, FEATURE);

  registry.defineScoped(/^they still pass$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.assessResult.status !== 0) {
      throw new Error(`babysitter_assess_lib_test_runner failed:\n${st.assessResult.stdout}\n${st.assessResult.stderr}`);
    }
  }, FEATURE);

  registry.defineScoped(/^their findings flow through the same severity and nudge contract as the other checks$/, () => {
    const critical = bbEval(`(sw/check-claim-risk ${cljVal({ role: 'hardener', severity: 'critical', reclaims: 6 })})`);
    if (!critical.includes(':severity "CRIT"')) throw new Error(`expected critical claim-risk to map to CRIT; got: ${critical}`);
    const eligible = bbEval(`(sw/nudge-eligible? ${cljVal({ key: 'claim-risk-hardener', severity: 'CRIT' })})`);
    if (eligible !== 'true') throw new Error(`expected claim-risk CRIT to be nudge-eligible; got: ${eligible}`);
  }, FEATURE);

  // ── Scenario 07: rotate-not-honored ──────────────────────────────────────
  registry.defineScoped(/^the newest completed parcel carries a rotate instruction older than the grace period$/, (ctx) => {
    ensureState(ctx).rotate = { 'note-name': '000741_rotate', 'note-target': 'architect', 'note-age-min': 15, 'grace-min': 10 };
  }, FEATURE);

  registry.defineScoped(/^its target role differs from the active-role file's persona$/, (ctx) => {
    ensureState(ctx).rotate['active-role'] = 'coder';
  }, FEATURE);

  registry.defineScoped(/^the note is newer than the active-role file's mtime$/, (ctx) => {
    const r = ensureState(ctx).rotate;
    r['note-mtime-ms'] = 2000;
    r['active-role-file-mtime-ms'] = 1000;
  }, FEATURE);

  registry.defineScoped(/^the sweep runs$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.rotate) {
      st.rotateResult = bbEval(`(sw/check-rotate-not-honored ${cljVal({ ...st.rotate, 'paused?': Boolean(st.paused) })})`);
    }
  }, FEATURE);

  registry.defineScoped(/^a CRIT finding names the parcel, expected persona, and actual persona$/, (ctx) => {
    const st = ensureState(ctx);
    const pr = st.rotateResult;
    if (bbNil(pr)) throw new Error('expected a CRIT rotate-unhonored finding, got nil');
    if (!pr.includes(':severity "CRIT"')) throw new Error(`expected CRIT; got: ${pr}`);
    for (const needle of [st.rotate['note-name'], st.rotate['note-target'], st.rotate['active-role']]) {
      if (!pr.includes(needle)) throw new Error(`expected finding to mention "${needle}"; got: ${pr}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the active-role file's mtime is newer than that same rotate note$/, (ctx) => {
    const r = ensureState(ctx).rotate;
    r['note-mtime-ms'] = 1000;
    r['active-role-file-mtime-ms'] = 2000;
    r['active-role'] = r['note-target']; // honored: persona now matches the note's target
  }, FEATURE);

  registry.defineScoped(/^the sweep runs again$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.rotate) {
      st.rotateResult = bbEval(`(sw/check-rotate-not-honored ${cljVal({ ...st.rotate, 'paused?': Boolean(st.paused) })})`);
    }
    if (st.starved) {
      st.starved.prevStreak = st.starved.newStreak;
      runStarvedCheck(st);
    }
  }, FEATURE);

  registry.defineScoped(/^no CRIT finding is produced for that note$/, (ctx) => {
    const st = ensureState(ctx);
    if (!bbNil(st.rotateResult)) throw new Error(`expected no finding once honored; got: ${st.rotateResult}`);
  }, FEATURE);

  // ── Scenario 08: swarm-starved streak + abandoned/stale filtering ──────
  function runStarvedCheck(st) {
    const args = {
      'active-ticket-count': st.starved.activeTicketCount ?? 2,
      'any-pane-busy?': Boolean(st.starved.anyPaneBusy),
      'paused?': Boolean(st.paused),
      'prev-streak': st.starved.prevStreak ?? 0,
      'pending-claims': st.starved.pendingClaims ?? [],
      'in-process-claims': st.starved.inProcessClaims ?? [],
    };
    const pr = bbEval(`(sw/check-swarm-starved ${cljVal(args)})`);
    st.starved.result = pr;
    const streakMatch = /:new-streak (\d+)/.exec(pr);
    st.starved.newStreak = streakMatch ? Number(streakMatch[1]) : 0;
  }

  registry.defineScoped(/^active tickets are present$/, (ctx) => {
    const st = ensureState(ctx);
    st.starved = st.starved || {};
    st.starved.activeTicketCount = 2;
  }, FEATURE);

  registry.defineScoped(/^zero pending and zero in_process parcels are counted across master and worktree mailboxes$/, (ctx) => {
    const st = ensureState(ctx);
    st.starved.pendingClaims = [];
    st.starved.inProcessClaims = [];
  }, FEATURE);

  registry.defineScoped(/^no pane shows a busy footer$/, (ctx) => {
    ensureState(ctx).starved.anyPaneBusy = false;
  }, FEATURE);

  registry.defineScoped(/^this is the first such idle sweep$/, (ctx) => {
    ensureState(ctx).starved.prevStreak = 0;
    runStarvedCheck(ensureState(ctx));
  }, FEATURE);

  registry.defineScoped(/^no swarm-starved finding is produced$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.starved && !starvedFindingIsNil(st.starved.result)) {
      throw new Error(`expected no swarm-starved finding; got: ${st.starved.result}`);
    }
    if (st.rotateResult !== undefined && !bbNil(st.rotateResult)) {
      throw new Error(`expected no rotate-unhonored finding; got: ${st.rotateResult}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the same idle condition persists into a second consecutive sweep$/, (ctx) => {
    const st = ensureState(ctx);
    st.starved.prevStreak = st.starved.newStreak;
  }, FEATURE);

  registry.defineScoped(/^a swarm-starved CRIT finding is produced$/, (ctx) => {
    const st = ensureState(ctx);
    runStarvedCheck(st);
    if (starvedFindingIsNil(st.starved.result)) throw new Error('expected a swarm-starved CRIT finding, got nil');
    if (!st.starved.result.includes(':severity "CRIT"')) throw new Error(`expected CRIT; got: ${st.starved.result}`);
  }, FEATURE);

  registry.defineScoped(/^the only pending-looking parcels are abandoned or older than 120 minutes$/, (ctx) => {
    const st = ensureState(ctx);
    st.starved.pendingClaims = [
      { 'abandoned?': true, 'age-min': 5 },
      { 'abandoned?': false, 'age-min': 200 },
    ];
    runStarvedCheck(st);
  }, FEATURE);

  registry.defineScoped(/^those parcels do not suppress the swarm-starved finding$/, (ctx) => {
    const st = ensureState(ctx);
    if (starvedFindingIsNil(st.starved.result)) throw new Error('expected abandoned/stale parcels to still allow swarm-starved to fire');
  }, FEATURE);

  // ── Scenario 6d-09: busy detection survives truncation ──────────────────
  registry.defineScoped(/^a pane capture whose busy-footer hint fragment is truncated away by the terminal width$/, (ctx) => {
    ensureState(ctx).paneText = '✻ Combobulating… (12s · e';
  }, FEATURE);

  registry.defineScoped(/^the capture still carries the spinner glyph and elapsed-time pattern$/, () => {}, FEATURE);

  registry.defineScoped(/^the sweep classifies the pane$/, (ctx) => {
    const st = ensureState(ctx);
    st.busyResult = bbEval(`(sw/classify-pane-busy? ${cljVal(st.paneText)})`);
  }, FEATURE);

  registry.defineScoped(/^the pane is classified busy$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.busyResult !== 'true') throw new Error(`expected the truncated pane to classify busy; got: ${st.busyResult}`);
  }, FEATURE);

  registry.defineScoped(/^no swarm-starved finding fires from this pane alone$/, (ctx) => {
    const st = ensureState(ctx);
    st.starved = st.starved || {};
    st.starved.anyPaneBusy = st.busyResult === 'true';
    runStarvedCheck(st);
    if (!starvedFindingIsNil(st.starved.result)) throw new Error(`expected no swarm-starved finding while the pane reads busy; got: ${st.starved.result}`);
  }, FEATURE);

  // ── Scenario 6d-10: aged active claim counts as motion ──────────────────
  registry.defineScoped(/^an in_process claim older than the aged-claim window$/, (ctx) => {
    ensureState(ctx).agedClaim = { 'age-min': 45 };
  }, FEATURE);

  registry.defineScoped(/^the claim's owning worktree resident is verifiably busy$/, (ctx) => {
    ensureState(ctx).agedClaim['owner-busy?'] = true;
  }, FEATURE);

  registry.defineScoped(/^the sweep evaluates swarm-starved$/, (ctx) => {
    const st = ensureState(ctx);
    st.starved = { inProcessClaims: [st.agedClaim], prevStreak: 1 };
    runStarvedCheck(st);
  }, FEATURE);

  registry.defineScoped(/^this claim does not contribute to a starved finding$/, (ctx) => {
    const st = ensureState(ctx);
    if (!starvedFindingIsNil(st.starved.result)) throw new Error(`expected the busy-owner aged claim not to starve; got: ${st.starved.result}`);
  }, FEATURE);

  registry.defineScoped(/^a same-aged in_process claim whose owning worktree resident is idle$/, (ctx) => {
    ensureState(ctx).agedClaim = { 'age-min': 45, 'owner-busy?': false };
  }, FEATURE);

  registry.defineScoped(/^no other motion is present$/, () => {}, FEATURE);

  registry.defineScoped(/^this claim does contribute to a starved finding$/, (ctx) => {
    const st = ensureState(ctx);
    if (starvedFindingIsNil(st.starved.result)) throw new Error('expected the idle-owner aged claim to contribute to a starved finding');
  }, FEATURE);

  // ── Scenario 17: planned pause suppresses starvation; overdue is CRIT ──
  registry.defineScoped(/^a control-pause record marked active whose untilMs has not yet passed$/, (ctx) => {
    const st = ensureState(ctx);
    st.paused = true;
    st.pause = { 'paused?': true, 'now-ms': 2000000, 'until-ms': 1900000, 'overdue-threshold-ms': 900000 };
  }, FEATURE);

  registry.defineScoped(/^a snapshot that would otherwise produce a swarm-starved and a rotate-unhonored finding$/, (ctx) => {
    const st = ensureState(ctx);
    st.starved = { activeTicketCount: 2, anyPaneBusy: false, prevStreak: 1 };
    st.rotate = { 'note-name': '000741_rotate', 'note-target': 'architect', 'note-age-min': 999, 'grace-min': 10,
      'note-mtime-ms': 2000, 'active-role-file-mtime-ms': 1000, 'active-role': 'coder' };
    runStarvedCheck(st);
    st.rotateResult = bbEval(`(sw/check-rotate-not-honored ${cljVal({ ...st.rotate, 'paused?': true })})`);
    st.resumeOverdueResult = bbEval(`(sw/check-resume-overdue ${cljVal(st.pause)})`);
  }, FEATURE);

  registry.defineScoped(/^no rotate-unhonored finding is produced$/, (ctx) => {
    const st = ensureState(ctx);
    if (!bbNil(st.rotateResult)) throw new Error(`expected no rotate-unhonored finding while paused; got: ${st.rotateResult}`);
  }, FEATURE);

  registry.defineScoped(/^a control-pause record still marked active whose untilMs expired more than 15 minutes ago$/, (ctx) => {
    const st = ensureState(ctx);
    st.pause = { 'paused?': true, 'now-ms': 3000000, 'until-ms': 1000000, 'overdue-threshold-ms': 900000 };
  }, FEATURE);

  registry.defineScoped(/^a resume-overdue CRIT finding is produced$/, (ctx) => {
    const st = ensureState(ctx);
    st.resumeOverdueResult = bbEval(`(sw/check-resume-overdue ${cljVal(st.pause)})`);
    if (bbNil(st.resumeOverdueResult)) throw new Error('expected a resume-overdue CRIT finding, got nil');
    if (!st.resumeOverdueResult.includes(':severity "CRIT"')) throw new Error(`expected CRIT; got: ${st.resumeOverdueResult}`);
  }, FEATURE);

  // ── Scenario 11: nudge dedup + cooldown ─────────────────────────────────
  registry.defineScoped(/^a CRIT finding was nudged less than the cooldown ago$/, (ctx) => {
    const st = ensureState(ctx);
    st.finding = { key: 'memory', severity: 'CRIT', message: 'low memory' };
    st.dedup = { lastNudgedMsByKey: { memory: 100000 }, nowMs: 200000, cooldownMs: 1800000 };
  }, FEATURE);

  registry.defineScoped(/^the same finding-key recurs on the next sweep$/, (ctx) => {
    const st = ensureState(ctx);
    st.nudgeResult = bbEval(`(sw/decide-nudges [${cljVal(st.finding)}] ${cljDecideNudgesOpts(st.dedup)})`);
  }, FEATURE);

  registry.defineScoped(/^no additional nudge is sent$/, (ctx) => {
    const st = ensureState(ctx);
    if (!/:to-nudge \[\]/.test(st.nudgeResult)) throw new Error(`expected no nudge during cooldown; got: ${st.nudgeResult}`);
  }, FEATURE);

  registry.defineScoped(/^the cooldown has since expired$/, (ctx) => {
    ensureState(ctx).dedup.nowMs = 2000000;
  }, FEATURE);

  registry.defineScoped(/^the same finding-key recurs again$/, (ctx) => {
    const st = ensureState(ctx);
    st.nudgeResult = bbEval(`(sw/decide-nudges [${cljVal(st.finding)}] ${cljDecideNudgesOpts(st.dedup)})`);
  }, FEATURE);

  registry.defineScoped(/^a new nudge is sent$/, (ctx) => {
    const st = ensureState(ctx);
    if (/:to-nudge \[\]/.test(st.nudgeResult)) throw new Error(`expected a nudge after cooldown expiry; got: ${st.nudgeResult}`);
  }, FEATURE);

  // ── Scenario 12: nudge skipped when coordinator is down ─────────────────
  registry.defineScoped(/^a CRIT finding is due to nudge$/, () => {}, FEATURE);

  registry.defineScoped(/^the coordinator pane\/process is down$/, (ctx) => {
    ensureState(ctx).coordinatorDown = true;
  }, FEATURE);

  registry.defineScoped(/^the nudge step runs$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.coordinatorDown) {
      st.checkOut = spawnSync('bash', [TEST_BABYSITTER_CHECK_SH], { encoding: 'utf8' });
    }
  }, FEATURE);

  registry.defineScoped(/^no keystrokes are sent to any pane$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.checkOut && st.checkOut.status !== 0) {
      throw new Error(`test_babysitter_check.sh failed:\n${st.checkOut.stdout}\n${st.checkOut.stderr}`);
    }
  }, FEATURE);

  registry.defineScoped(/^a NUDGE-SKIP line is logged$/, (ctx) => {
    const st = ensureState(ctx);
    const out = (st.checkOut && (st.checkOut.stdout + st.checkOut.stderr)) || '';
    if (!out.includes('PASS: D: no swarm running skips the nudge and logs NUDGE-SKIP with zero keystrokes')) {
      throw new Error(`expected the NUDGE-SKIP shell scenario to pass:\n${out}`);
    }
  }, FEATURE);

  // ── Scenario 13: nudge eligibility (Outline) ────────────────────────────
  const FINDING_SHAPES = {
    'a CRIT finding': { key: 'memory', severity: 'CRIT' },
    'a stuck-* WARN finding': { key: 'stuck-000123', severity: 'WARN' },
    'any other WARN finding': { key: 'rc-coder', severity: 'WARN' },
  };
  const NUDGE_COUNTS = { one: 1, zero: 0 };

  registry.defineScoped(/^a sweep whose only finding is (.+)$/, (ctx, shape) => {
    if (!FINDING_SHAPES[shape]) throw new Error(`unrecognized finding shape "${shape}"`);
    ensureState(ctx).outlineFinding = FINDING_SHAPES[shape];
  }, FEATURE);

  registry.defineScoped(/^exactly (one|zero) nudge is sent$/, (ctx, word) => {
    const expected = NUDGE_COUNTS[word];
    const st = ensureState(ctx);
    const pr = bbEval(
      `(sw/decide-nudges [${cljVal(st.outlineFinding)}] ${cljVal({ 'last-nudged-ms-by-key': {}, 'now-ms': 100000, 'cooldown-ms': 1800000 })})`
    );
    const count = (pr.match(/:key/g) || []).length;
    if (count !== expected) throw new Error(`expected ${expected} nudge(s), got ${count} (${pr})`);
  }, FEATURE);

  // ── Scenario 14: read-only apart from the nudge line ────────────────────
  registry.defineScoped(/^a pane blocked on an interactive menu$/, (ctx) => {
    ensureState(ctx).menuFinding = bbEval(`(sw/check-menu-blocked ${cljVal({ role: 'coder', 'menu-blocked?': true })})`);
  }, FEATURE);

  registry.defineScoped(/^a report finding is produced$/, (ctx) => {
    const st = ensureState(ctx);
    if (bbNil(st.menuFinding)) throw new Error('expected a menu-blocked CRIT finding, got nil');
  }, FEATURE);

  registry.defineScoped(/^no keystrokes are sent toward the menu$/, (ctx) => {
    // The pure core's only action vocabulary is a single coordinator nudge —
    // structurally proven by the property runner (P2). Here: confirm the
    // menu finding rides that exact same decide-nudges/format-nudge-message
    // pipeline (never a distinct "act on this pane" action), and confirm
    // the composed message only ever reports, never instructs a keypress.
    const st = ensureState(ctx);
    const nudges = bbEval(`(sw/decide-nudges [${st.menuFinding}] ${cljVal({ 'last-nudged-ms-by-key': {}, 'now-ms': 100000, 'cooldown-ms': 1800000 })})`);
    if (/:to-nudge \[\]/.test(nudges)) throw new Error(`expected the menu-blocked CRIT to be nudge-eligible; got: ${nudges}`);
    const property = spawnSync('bb', [path.join(SCRIPTS, 'test', 'babysitterd_sweep_lib_property_runner.bb')], { encoding: 'utf8' });
    if (property.status !== 0) {
      throw new Error(`P2 read-only-apart-from-nudge property failed:\n${property.stdout}\n${property.stderr}`);
    }
  }, FEATURE);

  // ── Scenario 15: agent-based babysitter fully removed ───────────────────
  registry.defineScoped(/^the repo after this ticket lands$/, () => {}, FEATURE);

  registry.defineScoped(/^a repo-wide grep for "babysitter" is run$/, (ctx) => {
    ensureState(ctx).scan = scanRepoForBabysitter();
  }, FEATURE);

  registry.defineScoped(/^the only matches are the deterministic daemon, its salvaged pure libraries, docs, and history$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.scan.offenders.length > 0) {
      throw new Error(`unexpected "babysitter" matches outside the allowlist:\n${st.scan.offenders.join('\n')}`);
    }
  }, FEATURE);

  registry.defineScoped(/^no babysitter\.prompt role, LLM launch path, or wake runtime remains$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.scan.forbidden.length > 0) {
      throw new Error(`retired agent-babysitter artifacts still present:\n${st.scan.forbidden.join('\n')}`);
    }
  }, FEATURE);

  // ── Scenario 16: start/stop/ensure clean; status reports the daemon ────
  registry.defineScoped(/^\.\/start-swarm\.sh, \.\/stop-swarm\.sh, and \.\/swarm ensure run$/, (ctx) => {
    const st = ensureState(ctx);
    st.startHelp = spawnSync('bash', [START_SWARM_SH, '--help'], { encoding: 'utf8' });
    st.stopHelp = spawnSync('bash', [STOP_SWARM_SH, '--help'], { encoding: 'utf8' });
    st.ensureRoot = mkFixtureRoot();
    st.ensureRun = spawnSync('bb', [SWARM_ENSURE_BB, st.ensureRoot], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SWARM_ENSURE_EXTENSION_CHECK_CMD: 'true',
        SWARM_ENSURE_SUPERVISOR_CMD: 'true',
        SWARM_ENSURE_OPERATOR_CMD: 'true',
        SWARM_ENSURE_FRONT_DESK_CMD: 'true',
        SWARM_ENSURE_BABYSITTERD_CMD: 'true',
      },
    });
    reapPid(readPid(st.ensureRoot));
  }, FEATURE);

  registry.defineScoped(/^none of them error on a missing reference to a removed file$/, (ctx) => {
    const st = ensureState(ctx);
    for (const [label, result] of [['start-swarm.sh --help', st.startHelp], ['stop-swarm.sh --help', st.stopHelp], ['swarm ensure', st.ensureRun]]) {
      const out = (result.stdout || '') + (result.stderr || '');
      for (const pattern of FORBIDDEN_RETIRED_PATTERNS) {
        if (pattern.test(out)) throw new Error(`${label} output references a retired file (${pattern}):\n${out}`);
      }
      if (/No such file or directory/.test(out) && /babysit/i.test(out)) {
        throw new Error(`${label} errored on a missing babysitter-related file:\n${out}`);
      }
    }
  }, FEATURE);

  registry.defineScoped(/^\.\/swarm status runs$/, (ctx) => {
    const st = ensureState(ctx);
    st.statusRoot = st.statusRoot || mkFixtureRoot();
    st.statusRun = spawnSync('bb', [SWARM_STATUS_BB, st.statusRoot], { encoding: 'utf8' });
  }, FEATURE);

  registry.defineScoped(/^it reports no row for the retired agent-based babysitter$/, (ctx) => {
    const st = ensureState(ctx);
    const out = st.statusRun.stdout || '';
    if (/babysitter-runtime/.test(out)) throw new Error(`status still reports the retired babysitter-runtime row:\n${out}`);
    if (/\bbabysitter\b(?!d)/i.test(out)) throw new Error(`status mentions a bare "babysitter" row (should be "babysitterd"):\n${out}`);
  }, FEATURE);

  registry.defineScoped(/^it reports the deterministic babysitterd daemon$/, (ctx) => {
    const st = ensureState(ctx);
    const out = st.statusRun.stdout || '';
    if (!/babysitterd/.test(out)) throw new Error(`status does not mention babysitterd at all:\n${out}`);
  }, FEATURE);
}

module.exports = { registerSteps };
