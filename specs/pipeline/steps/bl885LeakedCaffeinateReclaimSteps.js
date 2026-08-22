'use strict';

// BL-885: step handlers for "orphan janitor reclaims leaked swarm
// caffeinate -dims daemons". Drives the REAL Babashka decision/wiring
// functions via bl885_leaked_caffeinate_acceptance_runner.bb (the same
// JSON-bridge pattern bl849/bl879/bl886's janitor-side scenarios already
// established) - never a hand-rolled reimplementation of the reap decision
// in JS.
//
// Per the ticket's own IR-DRY disposition: the never-reap cases were
// merged into one decision-table Scenario Outline, and its parameterized
// step vocabulary is IDENTICAL (by design) to scenarios 01 and 03's
// literal steps, so a single handler set serves all three scenarios.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl885_leaked_caffeinate_acceptance_runner.bb');

const FEATURE_NAME = 'BL-885 orphan janitor reclaims leaked swarm caffeinate daemons';

const KNOWN_PIDFILE_STATES = {
  'records live PID 900': 900,
  'is missing': null,
};

const KNOWN_CMDLINES = {
  'caffeinate -dims': 'caffeinate -dims',
  'caffeinate -i': 'caffeinate -i',
};

const KNOWN_CWD_STATES = {
  'a registered worktree path': 'in-scope',
  'a path outside the project': 'out-of-scope',
  'not determinable': 'undeterminable',
};

// Mirrors bl886_vitest_orphan_reaper_acceptance_runner.bb's KNOWN_AGES
// convention: far below / far above the 2.0h default threshold, so the
// outcome can only be explained by the age gate actually firing.
const KNOWN_AGES = { younger: 1000, older: 999999999 };

const KNOWN_OUTCOMES = { survives: false, 'is reaped': true };

function run(subcommand, payload) {
  const out = execFileSync('bb', [RUNNER, subcommand, JSON.stringify(payload || {})], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^an orphan janitor sweep wired with a fake process table and audit log$/,
    (ctx) => {
      ctx.pid = null;
      ctx.cmdline = null;
      ctx.cwdState = null;
      ctx.ageMs = null;
      ctx.liveCaffeinatePid = null;
      ctx.envOverrideHours = null;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the registered project paths are the host root and its role worktrees$/,
    () => {
      // Represented structurally by the runner's fixed fixture-project-root
      // / in-scope-cwd pair (a real path-prefix relationship, never
      // stubbed) - nothing to arrange here.
    },
    FEATURE_NAME
  );

  // ── shared across leaked-caffeinate-reclaim-01/02/03 (identical step
  //    vocabulary by design - see file header) ──────────────────────────
  registry.defineScoped(
    /^the caffeinate pidfile (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_PIDFILE_STATES, raw)) {
        throw new Error(`bl885: unrecognized <pidfile-state> example value "${raw}"`);
      }
      ctx.liveCaffeinatePid = KNOWN_PIDFILE_STATES[raw];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a process "(.+)" with PID (\d+) reparented to launchd$/,
    (ctx, cmdlineRaw, pidRaw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_CMDLINES, cmdlineRaw)) {
        throw new Error(`bl885: unrecognized <cmdline> example value "${cmdlineRaw}"`);
      }
      ctx.cmdline = KNOWN_CMDLINES[cmdlineRaw];
      ctx.pid = Number(pidRaw);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its cwd is (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_CWD_STATES, raw)) {
        throw new Error(`bl885: unrecognized <cwd> example value "${raw}"`);
      }
      ctx.cwdState = KNOWN_CWD_STATES[raw];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its age relative to the caffeinate stale threshold is (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_AGES, raw)) {
        throw new Error(`bl885: unrecognized <age> example value "${raw}"`);
      }
      ctx.ageMs = KNOWN_AGES[raw];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the sweep runs$/,
    (ctx) => {
      const env = ctx.envOverrideHours
        ? { ...process.env, SWARMFORGE_ORPHAN_JANITOR_CAFFEINATE_STALE_HOURS: String(ctx.envOverrideHours) }
        : process.env;
      const out = execFileSync(
        'bb',
        [
          RUNNER,
          'sweep-one-caffeinate',
          JSON.stringify({
            pid: ctx.pid,
            cmdline: ctx.cmdline,
            cwdState: ctx.cwdState,
            ageMs: ctx.ageMs,
            liveCaffeinatePid: ctx.liveCaffeinatePid,
          }),
        ],
        { encoding: 'utf8', env }
      );
      ctx.sweepResult = JSON.parse(out);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^PID (\d+) (survives|is reaped)$/,
    (ctx, pidRaw, outcomeRaw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_OUTCOMES, outcomeRaw)) {
        throw new Error(`bl885: unrecognized <outcome> example value "${outcomeRaw}"`);
      }
      const expectedPid = Number(pidRaw);
      if (expectedPid !== ctx.pid) {
        throw new Error(`bl885: step named PID ${expectedPid} but the fixture used PID ${ctx.pid}`);
      }
      const expectedReaped = KNOWN_OUTCOMES[outcomeRaw];
      if (ctx.sweepResult.reaped !== expectedReaped) {
        throw new Error(`expected reaped=${expectedReaped} for PID ${expectedPid}, got: ${JSON.stringify(ctx.sweepResult)}`);
      }
    },
    FEATURE_NAME
  );

  // ── leaked-caffeinate-reclaim-01 only ──────────────────────────────
  registry.defineScoped(
    /^the audit log records reason "(.+)" for PID (\d+)$/,
    (ctx, reason, pidRaw) => {
      const pid = Number(pidRaw);
      const found = (ctx.sweepResult.audits || []).some(
        (line) => line.includes(`reason=${reason}`) && line.includes(`pid=${pid} `)
      );
      if (!found) {
        throw new Error(
          `expected an audit line with reason=${reason} pid=${pid}, got: ${JSON.stringify(ctx.sweepResult.audits)}`
        );
      }
    },
    FEATURE_NAME
  );

  // ── leaked-caffeinate-reclaim-03 only ──────────────────────────────
  registry.defineScoped(
    /^SWARMFORGE_ORPHAN_JANITOR_CAFFEINATE_STALE_HOURS is set above the default$/,
    (ctx) => {
      // Default is 2.0h - deliberately well above it so a "survives" result
      // can only be explained by the override actually being read at sweep
      // time (raising the bar), never by coincidentally landing under the
      // unmodified default.
      ctx.envOverrideHours = 6;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its age is between the default threshold and the custom threshold$/,
    (ctx) => {
      // 4h: older than the 2h default (would reap under it) but younger
      // than the 6h custom threshold set above (must survive under it).
      ctx.ageMs = 4 * 3600 * 1000;
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
