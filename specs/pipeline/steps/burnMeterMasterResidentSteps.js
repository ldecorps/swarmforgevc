'use strict';

// BL-312: step handlers for "Master-resident roles report combined usage
// instead of double-counted identical totals". Drives the REAL compiled
// producers (out/metrics/burnRate.js, out/metrics/costTelemetry.js) against
// a real transcript fixture, same posture as burnRateSteps.js's own
// computeBurnRateTokensPerHour drive - here through the impure
// computeBurnRateForRoles/computeCostTelemetry entry points since the
// scenario is specifically about worktreePath collision detection, which
// lives in those orchestrators (via swarmMetrics.ts's shared
// groupRolesByWorktreePath), not in the pure per-record math.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { computeBurnRateForRoles, DEFAULT_BURN_RATE_WINDOW_MS } = require(path.join(EXT_DIR, 'out', 'metrics', 'burnRate'));
const { computeCostTelemetry } = require(path.join(EXT_DIR, 'out', 'metrics', 'costTelemetry'));

const NOW_MS = Date.parse('2026-07-09T08:15:00Z');
const KNOWN_INPUT_TOKENS = 100;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function slugFor(worktreePath) {
  return worktreePath.replace(/[/.]/g, '-');
}

// Writes one transcript record (KNOWN_INPUT_TOKENS input tokens, inside
// burn-rate's default rolling window) into worktreePath's own
// ~/.claude/projects/<slug>/ directory under the given fixture
// claudeProjectsDir - the real reader both producers under test share.
function writeKnownTranscript(claudeProjectsDir, worktreePath) {
  const dir = path.join(claudeProjectsDir, slugFor(worktreePath));
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: new Date(NOW_MS - 5 * 60 * 1000).toISOString(),
    message: {
      id: 'm1',
      model: 'claude-sonnet-5',
      usage: { input_tokens: KNOWN_INPUT_TOKENS, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), line + '\n');
}

function registerSteps(registry) {
  // ── burn-meter-master-resident-01/02 shared Given ───────────────────
  registry.define(/^the coordinator and specifier roles share the same worktreePath$/, (ctx) => {
    const masterWt = mkTmp('aps-burn-meter-master-');
    ctx.claudeProjectsDir = mkTmp('aps-burn-meter-projects-');
    ctx.roles = [
      { role: 'coordinator', worktreePath: masterWt },
      { role: 'specifier', worktreePath: masterWt },
    ];
  });

  registry.define(/^that worktree's transcripts record a known amount of usage$/, (ctx) => {
    writeKnownTranscript(ctx.claudeProjectsDir, ctx.roles[0].worktreePath);
  });

  // ── burn-meter-master-resident-01/03 shared When ────────────────────
  registry.define(/^burn-rate and cost-sidecar attribution run$/, (ctx) => {
    ctx.burnRate = computeBurnRateForRoles('/unused/target', ctx.roles, NOW_MS, DEFAULT_BURN_RATE_WINDOW_MS, ctx.claudeProjectsDir);
    ctx.costTelemetry = computeCostTelemetry('/unused/target', ctx.roles, ctx.claudeProjectsDir);
  });

  // ── burn-meter-master-resident-01 Then ──────────────────────────────
  registry.define(/^the coordinator and specifier are reported as one combined\/shared usage total$/, (ctx) => {
    const burnRateKeys = Object.keys(ctx.burnRate);
    const costKeys = Object.keys(ctx.costTelemetry);
    if (burnRateKeys.length !== 1 || burnRateKeys[0] !== 'coordinator+specifier') {
      throw new Error(`expected one combined burn-rate key "coordinator+specifier", got: ${JSON.stringify(ctx.burnRate)}`);
    }
    if (costKeys.length !== 1 || costKeys[0] !== 'coordinator+specifier') {
      throw new Error(`expected one combined cost-telemetry key "coordinator+specifier", got: ${JSON.stringify(ctx.costTelemetry)}`);
    }
    if (ctx.burnRate.coordinator !== undefined || ctx.burnRate.specifier !== undefined) {
      throw new Error('expected no independent per-role burn-rate entries for the colliding pair');
    }
    if (ctx.costTelemetry.coordinator !== undefined || ctx.costTelemetry.specifier !== undefined) {
      throw new Error('expected no independent per-role cost-telemetry entries for the colliding pair');
    }
  });

  // ── burn-meter-master-resident-02 ────────────────────────────────────
  registry.define(/^the day's aggregate cost total is computed$/, (ctx) => {
    const costTelemetry = computeCostTelemetry('/unused/target', ctx.roles, ctx.claudeProjectsDir);
    // What a naive "day total" consumer would do: sum every reported
    // entry's input tokens for the day. If the collision were still
    // double-counted (one entry per colliding role, each carrying the
    // full total), this sum would come out at 2x KNOWN_INPUT_TOKENS.
    let total = 0;
    for (const telemetry of Object.values(costTelemetry)) {
      for (const day of Object.values(telemetry.byDay)) {
        total += day.usage.inputTokens;
      }
    }
    ctx.dayAggregateTokens = total;
  });

  registry.define(/^the shared worktree's usage is counted exactly once toward the total$/, (ctx) => {
    if (ctx.dayAggregateTokens !== KNOWN_INPUT_TOKENS) {
      throw new Error(`expected the day aggregate to count the shared worktree's usage exactly once (${KNOWN_INPUT_TOKENS}), got ${ctx.dayAggregateTokens}`);
    }
  });

  // ── burn-meter-master-resident-03 ───────────────────────────────────
  registry.define(/^a role whose worktreePath is not shared with any other current roster role$/, (ctx) => {
    const coderWt = mkTmp('aps-burn-meter-coder-');
    ctx.claudeProjectsDir = mkTmp('aps-burn-meter-projects-');
    ctx.roles = [{ role: 'coder', worktreePath: coderWt }];
    writeKnownTranscript(ctx.claudeProjectsDir, coderWt);
  });

  registry.define(/^that role's usage is reported exactly as it is today$/, (ctx) => {
    if (ctx.burnRate.coder === undefined || ctx.costTelemetry.coder === undefined) {
      throw new Error(`expected an unaffected role to keep its own individual key, got burnRate=${JSON.stringify(ctx.burnRate)} costTelemetry=${JSON.stringify(ctx.costTelemetry)}`);
    }
    const dayKey = Object.keys(ctx.costTelemetry.coder.byDay)[0];
    if (ctx.costTelemetry.coder.byDay[dayKey].usage.inputTokens !== KNOWN_INPUT_TOKENS) {
      throw new Error('expected the unaffected role\'s usage to be reported unchanged');
    }
  });
}

module.exports = { registerSteps };
