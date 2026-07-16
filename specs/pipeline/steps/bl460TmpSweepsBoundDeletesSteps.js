'use strict';

// BL-460: step handlers for "the /tmp sweeps bound deletes per tick, make
// progress past non-reapable entries, and report what they do" - the fix
// for the bounded-SCAN wedge (BL-413's stale-dir sweep and BL-458's
// orphan-process reaper both re-scanned the SAME fixed-position window
// forever when it never contained a reapable entry). Scenarios 01/02/04/05
// drive a REAL operator_runtime.bb --tick-once subprocess sequence against a
// private, disposable fixture root - never the real /tmp (the engineering
// "LIVE shared runtime path" rule) - mirroring
// swarmforge/scripts/test/test_operator_runtime_sandbox_sweep_bounded_progress.sh's
// own convention in a second, independent harness. Scenario 03 drives the
// REAL pure decision function (sandbox_sweep_lib.bb's removable? - the one
// predicate with all four dimensions the Examples table exercises) via the
// SAME sandbox_sweep_decision_acceptance_runner.bb BL-413's own steps
// already use - never a hand-rolled reimplementation of the decision in JS.
// Scenario 06 drives the real allowlist (sandbox-sweep-lib/known-sandbox-prefix?).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const OPERATOR_RUNTIME = path.join(SCRIPTS_DIR, 'operator_runtime.bb');
const DECISION_RUNNER = path.join(SCRIPTS_DIR, 'test', 'sandbox_sweep_decision_acceptance_runner.bb');

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_BOOLEANS = { yes: true, no: false };
function knownBoolean(label, value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_BOOLEANS, value)) {
    throw new Error(`bl460 tmp-sweep: unrecognized <${label}> example value "${value}"`);
  }
  return KNOWN_BOOLEANS[value];
}

const SWEEP_CONFIGS = {
  'stale-dir': {
    rootEnv: 'SWARMFORGE_SANDBOX_SWEEP_ROOT',
    staleHoursEnv: 'SWARMFORGE_SANDBOX_STALE_HOURS',
    maxPerTickEnv: 'SWARMFORGE_SANDBOX_SWEEP_MAX_PER_TICK',
    nothingPeriodEnv: 'SWARMFORGE_SANDBOX_SWEEP_NOTHING_LOG_PERIOD',
    otherRootDisableEnv: 'SWARMFORGE_FIXTURE_REAP_ROOT',
    prefix: 'sfvc-',
    logTag: 'sandbox-sweep',
  },
  'orphan-process': {
    rootEnv: 'SWARMFORGE_FIXTURE_REAP_ROOT',
    staleHoursEnv: 'SWARMFORGE_FIXTURE_REAP_STALE_HOURS',
    maxPerTickEnv: 'SWARMFORGE_FIXTURE_REAP_MAX_PER_TICK',
    nothingPeriodEnv: 'SWARMFORGE_FIXTURE_REAP_NOTHING_LOG_PERIOD',
    otherRootDisableEnv: 'SWARMFORGE_SANDBOX_SWEEP_ROOT',
    prefix: 'aps-',
    logTag: 'fixture-reaper-sweep',
  },
};

function knownSweep(value) {
  if (!Object.prototype.hasOwnProperty.call(SWEEP_CONFIGS, value)) {
    throw new Error(`bl460 tmp-sweep: unrecognized <sweep> example value "${value}"`);
  }
  return SWEEP_CONFIGS[value];
}

function mkFixture(cfg) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl460-project-'));
  const sweptRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl460-swept-'));
  return { projectRoot, sweptRoot, cfg };
}

function runTick(fixture) {
  execFileSync('bb', [OPERATOR_RUNTIME, fixture.projectRoot, '--tick-once'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      OPERATOR_SKIP_LAUNCH: '1',
      [fixture.cfg.rootEnv]: fixture.sweptRoot,
      [fixture.cfg.staleHoursEnv]: '1',
      [fixture.cfg.maxPerTickEnv]: '2',
      // Never touch the SIBLING sweep's real default root as a side effect
      // of a scenario that is only about THIS sweep.
      [fixture.cfg.otherRootDisableEnv]: path.join(fixture.projectRoot, '.no-other-sweep'),
    },
  });
}

function runtimeLog(fixture) {
  const p = path.join(fixture.projectRoot, '.swarmforge', 'operator', 'runtime.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function mkEntry(fixture, name) {
  const p = path.join(fixture.sweptRoot, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function ageEntry(entryPath, hoursAgo) {
  const t = new Date(Date.now() - hoursAgo * 3600 * 1000);
  fs.utimesSync(entryPath, t, t);
}

function cleanup(fixture) {
  fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
  fs.rmSync(fixture.sweptRoot, { recursive: true, force: true });
}

function runDecision(scenario) {
  const out = execFileSync('bb', [DECISION_RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

// The 5 kinds map onto sandbox_sweep_lib.bb's removable? - the one pure
// predicate with all four dimensions this scenario exercises (fixture-
// reaper-lib's reapable? has no live-process input at all).
const KIND_TO_DECISION = {
  'a stale idle known fixture': { knownSandboxPrefix: true, stale: true, hasLiveProcess: false, socketDir: false },
  'a fresh known fixture': { knownSandboxPrefix: true, stale: false, hasLiveProcess: false, socketDir: false },
  'an unknown-prefix entry': { knownSandboxPrefix: false, stale: true, hasLiveProcess: false, socketDir: false },
  'the live swarm socket root': { knownSandboxPrefix: true, stale: true, hasLiveProcess: false, socketDir: true },
  'a stale known fixture with a live process': { knownSandboxPrefix: true, stale: true, hasLiveProcess: true, socketDir: false },
};

function knownKind(value) {
  if (!Object.prototype.hasOwnProperty.call(KIND_TO_DECISION, value)) {
    throw new Error(`bl460 tmp-sweep: unrecognized <kind> example value "${value}"`);
  }
  return KIND_TO_DECISION[value];
}

function registerSteps(registry) {
  // ── tmp-sweep-bounded-deletes-01 ────────────────────────────────────────
  // The Given step names no sweep of its own (only the When step's own
  // "<sweep>" does, per the Scenario Outline) - the fixture itself is built
  // lazily in the When step below, once the sweep (and thus its prefix) is
  // actually known.
  registry.define(
    /^a fixture root whose listing places more non-reapable entries than the per-tick cap before a reapable entry$/,
    () => {}
  );

  registry.define(/^the "([^"]*)" sweep runs for enough ticks to cover the listing$/, (ctx, sweep) => {
    ctx.currentSweep = sweep;
    const cfg = knownSweep(sweep);
    const f = mkFixture(cfg);
    ctx.fixture = f;
    mkEntry(f, `${cfg.prefix}a-fresh`);
    mkEntry(f, `${cfg.prefix}b-fresh`);
    ctx.reapableEntry = mkEntry(f, `${cfg.prefix}c-stale-reapable`);
    ageEntry(ctx.reapableEntry, 2);
    // cap=2, 2 fresh entries sort first - "enough ticks to cover the
    // listing" for a 3-entry root at cap 2 is 2 ticks (window 1: the two
    // fresh; window 2: wraps to the reapable one).
    runTick(f);
    runTick(f);
  });

  registry.define(/^that reapable entry beyond the cap is removed$/, (ctx) => {
    try {
      if (fs.existsSync(ctx.reapableEntry)) {
        throw new Error(`expected the reapable entry beyond the per-tick cap to be removed, still present: ${ctx.reapableEntry}`);
      }
    } finally {
      cleanup(ctx.fixture);
      ctx.fixture = null;
    }
  });

  // ── tmp-sweep-bounded-deletes-02 ────────────────────────────────────────
  // Same "Given names no sweep of its own" shape as -01 above - the fixture
  // is built lazily in the When step once the sweep is known.
  registry.define(/^a fixture root where the count of reapable entries exceeds one tick's delete cap$/, () => {});

  registry.define(/^the "([^"]*)" sweep runs one tick$/, (ctx, sweep) => {
    ctx.currentSweep = sweep;
    const cfg = knownSweep(sweep);
    const f = mkFixture(cfg);
    ctx.fixture = f;
    ctx.reapableEntries = ['x1', 'x2', 'x3'].map((n) => {
      const p = mkEntry(f, `${cfg.prefix}${n}-stale`);
      ageEntry(p, 2);
      return p;
    });
    runTick(f);
  });

  registry.define(/^at most the per-tick cap of entries are removed$/, (ctx) => {
    const remaining = ctx.reapableEntries.filter((p) => fs.existsSync(p)).length;
    const removed = ctx.reapableEntries.length - remaining;
    if (removed > 2) {
      throw new Error(`expected at most cap=2 removed in one tick, got ${removed}`);
    }
    if (removed === 0) {
      throw new Error('expected at least one entry removed in this tick - the cap bounds deletes, it does not disable them');
    }
    ctx.removedAfterOneTick = removed;
  });

  registry.define(/^the remaining reapable entries are removed on subsequent ticks$/, (ctx) => {
    try {
      runTick(ctx.fixture);
      runTick(ctx.fixture);
      const stillPresent = ctx.reapableEntries.filter((p) => fs.existsSync(p));
      if (stillPresent.length > 0) {
        throw new Error(`expected every reapable entry removed within a few subsequent ticks, still present: ${JSON.stringify(stillPresent)}`);
      }
    } finally {
      cleanup(ctx.fixture);
      ctx.fixture = null;
    }
  });

  // ── tmp-sweep-bounded-deletes-03 ────────────────────────────────────────
  registry.define(/^a scanned fixture root entry that is "([^"]*)"$/, (ctx, kind) => {
    ctx.decisionInput = knownKind(kind);
  });

  registry.define(/^the sweep evaluates it$/, (ctx) => {
    ctx.result = runDecision(ctx.decisionInput);
  });

  registry.define(/^the entry is removed is "([^"]*)"$/, (ctx, value) => {
    const expected = knownBoolean('removed', value);
    if (ctx.result.removable !== expected) {
      throw new Error(`expected removable=${expected} for ${JSON.stringify(ctx.decisionInput)}, got removable=${ctx.result.removable}`);
    }
  });

  // ── tmp-sweep-bounded-deletes-04 ─────────────────────────────────────────
  registry.define(/^a sweep tick that removes one or more entries$/, (ctx) => {
    const cfg = SWEEP_CONFIGS['stale-dir'];
    const f = mkFixture(cfg);
    ctx.logFixture = f;
    const p = mkEntry(f, `${cfg.prefix}stale-for-summary`);
    ageEntry(p, 2);
  });

  registry.define(/^the tick completes$/, (ctx) => {
    runTick(ctx.logFixture);
  });

  registry.define(/^it logs a summary line reporting how many entries it reaped$/, (ctx) => {
    try {
      const log = runtimeLog(ctx.logFixture);
      if (!/sandbox-sweep reaped \d+ of \d+ scanned/.test(log)) {
        throw new Error(`expected a reap-summary line in runtime.log, got:\n${log}`);
      }
    } finally {
      cleanup(ctx.logFixture);
      ctx.logFixture = null;
    }
  });

  // ── tmp-sweep-bounded-deletes-05 ─────────────────────────────────────────
  registry.define(/^consecutive sweep ticks that scan entries and remove none$/, (ctx) => {
    const cfg = SWEEP_CONFIGS['stale-dir'];
    const f = mkFixture(cfg);
    ctx.periodicFixture = f;
    mkEntry(f, `${cfg.prefix}only-fresh`);
    ctx.periodicTickCount = 6;
    ctx.periodicPeriod = 3;
  });

  registry.define(/^the ticks run$/, (ctx) => {
    const f = ctx.periodicFixture;
    for (let i = 0; i < ctx.periodicTickCount; i += 1) {
      execFileSync('bb', [OPERATOR_RUNTIME, f.projectRoot, '--tick-once'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          OPERATOR_SKIP_LAUNCH: '1',
          [f.cfg.rootEnv]: f.sweptRoot,
          [f.cfg.staleHoursEnv]: '1',
          [f.cfg.maxPerTickEnv]: '2',
          [f.cfg.nothingPeriodEnv]: String(ctx.periodicPeriod),
          [f.cfg.otherRootDisableEnv]: path.join(f.projectRoot, '.no-other-sweep'),
        },
      });
    }
  });

  registry.define(/^a scanned-nothing line is logged periodically rather than on every tick$/, (ctx) => {
    try {
      const log = runtimeLog(ctx.periodicFixture);
      const lines = (log.match(/sandbox-sweep scanned/g) || []).length;
      if (lines === 0 || lines >= ctx.periodicTickCount) {
        throw new Error(`expected a periodic (not per-tick) count of nothing-found lines, got ${lines} lines across ${ctx.periodicTickCount} ticks`);
      }
    } finally {
      cleanup(ctx.periodicFixture);
      ctx.periodicFixture = null;
    }
  });

  // ── tmp-sweep-bounded-deletes-06 ─────────────────────────────────────────
  registry.define(/^a \/tmp entry whose name begins with "([^"]*)"$/, (ctx, prefix) => {
    ctx.prefixUnderTest = prefix;
  });

  registry.define(/^the allowlist classifies the entry$/, (ctx) => {
    const out = execFileSync(
      'bb',
      [
        '-e',
        `(load-file "${path.join(SCRIPTS_DIR, 'sandbox_sweep_lib.bb')}") (println (sandbox-sweep-lib/known-sandbox-prefix? "${ctx.prefixUnderTest}abc123"))`,
      ],
      { encoding: 'utf8' }
    );
    ctx.classifiedAsKnown = out.trim() === 'true';
  });

  registry.define(/^it is a known fixture is "([^"]*)"$/, (ctx, value) => {
    const expected = knownBoolean('known_fixture', value);
    if (ctx.classifiedAsKnown !== expected) {
      throw new Error(`expected known-sandbox-prefix?=${expected} for "${ctx.prefixUnderTest}", got ${ctx.classifiedAsKnown}`);
    }
  });
}

module.exports = { registerSteps };
