'use strict';

// BL-413: step handlers for "stale acceptance-test sandboxes are swept from
// /tmp before they exhaust the disk". Scenarios 01/02 drive the REAL pure
// decision function (sandbox_sweep_lib.bb's removable?) via
// sandbox_sweep_decision_acceptance_runner.bb - the same Babashka-runner
// pattern bl412DiskSpaceEarlyWarningAlertSteps.js already established -
// never a hand-rolled reimplementation of the decision in JS. Scenario 03
// (the redirectable-root claim) drives a REAL operator_runtime.bb
// --tick-once subprocess against a private, disposable fixture directory -
// never the real /tmp (the engineering "LIVE shared runtime path" rule) -
// mirroring swarmforge/scripts/test/test_operator_runtime_sandbox_sweep.sh's
// own convention in a second, independent harness.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DECISION_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'sandbox_sweep_decision_acceptance_runner.bb');
const OPERATOR_RUNTIME = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime.bb');

// "the sweep runs" is dispatchGapSteps.js's own step text too (registered
// earlier in specs/pipeline/steps/index.js's DOMAINS array, so it would win
// first-match unscoped - a real collision, unrelated behavior). Registered
// via defineScoped, pinned to this exact Feature: title, so it is only ever
// preferred when THIS feature is running; dispatchGapSteps.js's own
// scenarios are completely unaffected (bl425RoleSteeringTopicsSteps.js's own
// identical note is the precedent for this fix).
const FEATURE_NAME = 'stale acceptance-test sandboxes are swept from /tmp before they exhaust the disk';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_BOOLEANS = { yes: true, no: false };

function knownBoolean(label, value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_BOOLEANS, value)) {
    throw new Error(`stale-sandbox-sweep: unrecognized <${label}> example value "${value}"`);
  }
  return KNOWN_BOOLEANS[value];
}

function runDecision(scenario) {
  const out = execFileSync('bb', [DECISION_RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a sweep deciding whether a \/tmp entry is a stale, removable acceptance sandbox$/, (ctx) => {
    ctx.decisionInput = { knownSandboxPrefix: false, stale: false, hasLiveProcess: false, socketDir: false };
  });

  // ── stale-sandbox-sweep-01 (Scenario Outline) ───────────────────────────
  registry.define(/^a \/tmp entry whose name matches a known sandbox prefix is "([^"]+)"$/, (ctx, value) => {
    ctx.decisionInput.knownSandboxPrefix = knownBoolean('prefix_match', value);
  });

  registry.define(/^its age past the stale threshold is "([^"]+)"$/, (ctx, value) => {
    ctx.decisionInput.stale = knownBoolean('is_stale', value);
  });

  registry.define(/^a live process rooted in it is "([^"]+)"$/, (ctx, value) => {
    ctx.decisionInput.hasLiveProcess = knownBoolean('has_live_process', value);
  });

  registry.define(/^the sweep evaluates the entry$/, (ctx) => {
    ctx.result = runDecision(ctx.decisionInput);
  });

  registry.define(/^it is removed is "([^"]+)"$/, (ctx, value) => {
    const expected = knownBoolean('removed', value);
    if (ctx.result.removable !== expected) {
      throw new Error(`expected removable=${expected} for ${JSON.stringify(ctx.decisionInput)}, got removable=${ctx.result.removable}`);
    }
  });

  // ── stale-sandbox-sweep-02 ───────────────────────────────────────────────
  // Reuses the SAME real decision function via the runner: the socket-dir
  // exclusion must win even when every other input says "removable"
  // (known prefix + stale + no live process) - the strongest form of "left
  // untouched regardless of its age" the pure predicate can express.
  registry.define(/^the live swarm socket directory \/tmp\/swarmforge-<uid> exists and is old$/, (ctx) => {
    ctx.decisionInput = { knownSandboxPrefix: true, stale: true, hasLiveProcess: false, socketDir: true };
  });

  // BL-413's own stale-sandbox-sweep-03, below, shares this EXACT step text
  // ("the sweep runs") for a completely different action (a real subprocess,
  // not the pure decision call) - branches on ctx.runRealSandboxSweep, set
  // by an earlier Given step in that scenario only, the SAME branch-on-flag
  // convention dispatchGapSteps.js's own shared "the sweep runs" handler
  // already established for stuckEscalationEmailSteps.js's unrelated reuse.
  registry.defineScoped(
    /^the sweep runs$/,
    (ctx) => {
      if (ctx.runRealSandboxSweep) {
        ctx.runRealSandboxSweep();
        return;
      }
      ctx.result = runDecision(ctx.decisionInput);
    },
    FEATURE_NAME
  );

  registry.define(/^the socket directory is left untouched regardless of its age$/, (ctx) => {
    if (ctx.result.removable !== false) {
      throw new Error(`expected the socket directory to never be removable, got removable=${ctx.result.removable}`);
    }
  });

  // ── stale-sandbox-sweep-03 ───────────────────────────────────────────────
  // A real operator_runtime.bb --tick-once subprocess, pointed at a private
  // fixture root via the SAME SWARMFORGE_SANDBOX_SWEEP_ROOT override the
  // production sweep reads - proves the wiring only ever lists/removes
  // under that root, never the real /tmp. operator_runtime.bb's own
  // load-file calls resolve relative to ITS OWN file path, not project-root,
  // so the real script runs unmodified with no copying needed - only the
  // throwaway project-root (isolated .swarmforge/ state) and the swept root
  // are disposable fixture directories.
  registry.define(/^the sweep's temp root is pointed at a test-owned directory via its override seam$/, (ctx) => {
    ctx.projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl413-project-'));
    ctx.sweptRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl413-swept-'));
    ctx.outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl413-outside-'));

    // A stale, known-prefix entry INSIDE the swept root - eligible for
    // removal, proving the sweep actually did SOMETHING under its own root.
    ctx.insideEntry = path.join(ctx.sweptRoot, 'sfvc-inside-stale');
    fs.mkdirSync(ctx.insideEntry);
    const oldTime = new Date(Date.now() - 48 * 3600 * 1000);
    fs.utimesSync(ctx.insideEntry, oldTime, oldTime);

    // An equally stale, equally-eligible entry OUTSIDE the swept root - if
    // the sweep ever listed/touched anything beyond its own configured
    // root, this is what would disappear.
    ctx.outsideEntry = path.join(ctx.outsideRoot, 'sfvc-outside-stale');
    fs.mkdirSync(ctx.outsideEntry);
    fs.utimesSync(ctx.outsideEntry, oldTime, oldTime);

    ctx.runRealSandboxSweep = () => {
      execFileSync('bb', [OPERATOR_RUNTIME, ctx.projectRoot, '--tick-once'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          OPERATOR_SKIP_LAUNCH: '1',
          SWARMFORGE_SANDBOX_SWEEP_ROOT: ctx.sweptRoot,
          SWARMFORGE_SANDBOX_STALE_HOURS: '1',
          // Isolates BL-458's own sweep, wired into the SAME tick - a
          // nonexistent path under this scenario's own throwaway project
          // root, so it no-ops rather than touching the real /tmp as a
          // side effect of a scenario that is only about sandbox-sweep!.
          SWARMFORGE_FIXTURE_REAP_ROOT: path.join(ctx.projectRoot, '.no-fixture-reap'),
          // BL-486: isolates the orphan-agent-process reaper, also wired
          // into the SAME tick - an empty candidate list means it never
          // scans the real /proc table for SwarmForge-* processes as a
          // side effect of a scenario that is only about sandbox-sweep!.
          SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS: '',
        },
      });
    };
  });

  registry.define(/^only entries under that test-owned directory are considered for removal$/, (ctx) => {
    try {
      if (fs.existsSync(ctx.insideEntry)) {
        throw new Error('expected the stale entry INSIDE the swept root to be removed');
      }
      if (!fs.existsSync(ctx.outsideEntry)) {
        throw new Error('expected the equally-stale entry OUTSIDE the swept root to be left untouched - the sweep reached outside its own root');
      }
    } finally {
      fs.rmSync(ctx.projectRoot, { recursive: true, force: true });
      fs.rmSync(ctx.sweptRoot, { recursive: true, force: true });
      fs.rmSync(ctx.outsideRoot, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
