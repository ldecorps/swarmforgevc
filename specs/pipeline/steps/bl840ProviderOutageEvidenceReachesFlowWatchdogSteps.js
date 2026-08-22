'use strict';

// BL-840: step handlers for "provider-outage evidence reaches the
// flow-watchdog in production". Drives the REAL Babashka producer/reader
// (provider_outage_evidence_lib.bb) and the REAL production sweep
// (flow_watchdog_lib.bb/run-sweep!, wired exactly the way handoffd.bb wires
// it) via bl840_provider_outage_evidence_acceptance_runner.bb - the same
// JSON-bridge pattern as BL-849/BL-486/BL-458's own acceptance runners.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl840_provider_outage_evidence_acceptance_runner.bb');

const FEATURE_NAME = 'provider-outage evidence reaches the flow-watchdog in production';

const KNOWN_EVIDENCE_STATES = {
  'holds an "anthropic" outage from "2026-08-07T09:10:00Z" to "2026-08-07T09:40:00Z"': {
    evidenceState: 'holds-outage',
    evidenceProvider: 'anthropic',
    evidenceStart: '2026-08-07T09:10:00Z',
    evidenceEnd: '2026-08-07T09:40:00Z',
  },
  'holds no lines at all': { evidenceState: 'empty' },
  'does not exist': { evidenceState: 'missing' },
  'is corrupt and cannot be parsed': { evidenceState: 'corrupt' },
};

function run(subcommand, payload) {
  const out = execFileSync('bb', [RUNNER, subcommand, JSON.stringify(payload || {})], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the daemon observes each live role's pane on every chase sweep$/,
    () => {
      // Documents the production trigger; each scenario's own runner
      // subcommand exercises the real observe/record or sweep path
      // directly - nothing to arrange here.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^role "([^"]+)" runs provider "([^"]+)"$/,
    (ctx, role, provider) => {
      ctx.roles = ctx.roles || {};
      ctx.roles[role] = provider;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the availability ledger contributes no intervals over the spans below$/,
    () => {
      // The acceptance runner's sweep-parcel subcommand never seeds a BL-823
      // ledger record - ledger-intervals is always [] there, matching this
      // precondition exactly.
    },
    FEATURE_NAME
  );

  // ── provider-outage-evidence-reaches-flow-watchdog-01 ───────────────────
  registry.defineScoped(
    /^no provider-outage evidence has been recorded for role "([^"]+)"$/,
    (ctx, role) => {
      ctx.observeRole = role;
      // Each runner invocation below uses its own fresh temp state-dir -
      // "no evidence recorded" is the natural starting state, nothing to
      // arrange.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the daemon observes role "([^"]+)"'s pane showing "([^"]+)"$/,
    (ctx, role, text) => {
      const provider = (ctx.roles && ctx.roles[role]) || 'anthropic';
      ctx.observeResult = run('observe-and-count', {
        role,
        provider,
        text,
        observedAt: '2026-08-07T10:00:00Z',
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^one provider-outage evidence line is recorded for provider "([^"]+)"$/,
    (ctx, provider) => {
      if (ctx.observeResult.lineCount !== 1) {
        throw new Error(`expected exactly one recorded line, got ${ctx.observeResult.lineCount}`);
      }
      ctx.recordedLine = ctx.observeResult.lines[0];
      ctx.recordedProvider = provider;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the recorded line carries the observation timestamp and the observed text$/,
    (ctx) => {
      const expectedTsMs = Date.parse('2026-08-07T10:00:00Z');
      if (ctx.recordedLine.tsMs !== expectedTsMs) {
        throw new Error(`expected recorded ts-ms ${expectedTsMs}, got ${ctx.recordedLine.tsMs}`);
      }
      if (ctx.recordedLine.text !== 'API Error: 529 overloaded_error') {
        throw new Error(`expected recorded text to be the observed pane text, got "${ctx.recordedLine.text}"`);
      }
    },
    FEATURE_NAME
  );

  // ── provider-outage-evidence-reaches-flow-watchdog-02 (Scenario Outline) ─
  registry.defineScoped(
    /^the number of evidence lines recorded is (\d+)$/,
    (ctx, expected) => {
      const got = ctx.observeResult.lineCount;
      if (String(got) !== expected) {
        throw new Error(`expected ${expected} evidence line(s), got ${got}`);
      }
    },
    FEATURE_NAME
  );

  // ── provider-outage-evidence-reaches-flow-watchdog-03 (Scenario Outline) ─
  registry.defineScoped(
    /^the configured observation interval is 60 seconds$/,
    (ctx) => {
      ctx.minIntervalMs = 60000;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^role "([^"]+)" recorded a provider-outage evidence line at "([^"]+)"$/,
    (ctx, role, seededAt) => {
      ctx.observeRole = role;
      ctx.seededAt = seededAt;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the daemon observes the same banner on that pane at "([^"]+)"$/,
    (ctx, observedAt) => {
      const provider = (ctx.roles && ctx.roles[ctx.observeRole]) || 'anthropic';
      ctx.throttleResult = run('observe-after-seed', {
        role: ctx.observeRole,
        provider,
        seededAt: ctx.seededAt,
        observedAt,
        minIntervalMs: ctx.minIntervalMs,
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the number of further evidence lines recorded is (\d+)$/,
    (ctx, expected) => {
      const got = ctx.throttleResult.furtherLines;
      if (String(got) !== expected) {
        throw new Error(`expected ${expected} further line(s), got ${got}`);
      }
    },
    FEATURE_NAME
  );

  // ── provider-outage-evidence-reaches-flow-watchdog-04/05 ─────────────────
  registry.defineScoped(
    /^a parcel enqueued at "([^"]+)" aging in role "([^"]+)"$/,
    (ctx, enqueuedAt, role) => {
      ctx.parcel = { enqueuedAt, role };
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the provider-outage evidence store (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_EVIDENCE_STATES, raw)) {
        throw new Error(`bl840: unrecognized <evidence state> example value "${raw}"`);
      }
      ctx.evidenceFixture = KNOWN_EVIDENCE_STATES[raw];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^provider-outage evidence observed on role "([^"]+)"'s pane for provider "([^"]+)" spanning "([^"]+)" to "([^"]+)"$/,
    (ctx, _observingRole, provider, from, to) => {
      ctx.evidenceFixture = { evidenceState: 'holds-outage', evidenceProvider: provider, evidenceStart: from, evidenceEnd: to };
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the flow-watchdog sweeps at "([^"]+)"$/,
    (ctx, sweepAt) => {
      const provider = (ctx.roles && ctx.roles[ctx.parcel.role]) || undefined;
      ctx.sweepResult = run('sweep-parcel', {
        role: ctx.parcel.role,
        roleProvider: provider,
        enqueuedAt: ctx.parcel.enqueuedAt,
        sweepAt,
        ...ctx.evidenceFixture,
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the parcel's wall age is (\d+) minutes$/,
    (ctx, minutes) => {
      const expectedMs = Number(minutes) * 60 * 1000;
      if (ctx.sweepResult.wallAgeMs !== expectedMs) {
        throw new Error(`expected wall age ${expectedMs}ms, got ${ctx.sweepResult.wallAgeMs}ms`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its effective age is (\d+) minutes$/,
    (ctx, minutes) => {
      const expectedMs = Number(minutes) * 60 * 1000;
      if (ctx.sweepResult.effectiveAgeMs !== expectedMs) {
        throw new Error(`expected effective age ${expectedMs}ms, got ${ctx.sweepResult.effectiveAgeMs}ms`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the sweep completes without error$/,
    (ctx) => {
      if (!ctx.sweepResult.sweptWithoutError) {
        throw new Error(`expected the sweep to complete without error, got: ${ctx.sweepResult.sweepError}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
