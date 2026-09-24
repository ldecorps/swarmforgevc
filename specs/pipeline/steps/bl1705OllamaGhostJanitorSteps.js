'use strict';

// BL-1705: step handlers for "the orphan janitor reaps ghost ollama
// runners and detached run clients". Drives the REAL Babashka decision
// (orphan-janitor-lib/reapable-ollama-ghost?) and sweep
// (orphan-janitor-sweep-lib/sweep!) via
// bl1705_ollama_ghost_janitor_acceptance_runner.bb - the same JSON-bridge
// pattern bl885's own janitor-side scenarios established - never a
// hand-rolled reimplementation of the reap decision in JS.
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl1705_ollama_ghost_janitor_acceptance_runner.bb');

const FEATURE_NAME = 'BL-1705 the orphan janitor reaps ghost ollama runners and detached run clients';

const KNOWN_PARENTS = {
  'a live ollama serve': 'live-ollama-serve',
  init: 'init',
  'a live interactive shell': 'live-shell',
};

// Mirrors bl885/bl886's KNOWN_AGES convention: parse "<N> <unit>" rather
// than hand list every Examples-table age string, since this outline has
// four distinct ages across three units-adjacent phrasings.
function parseAgeMs(raw) {
  const m = /^(\d+)\s+(hour|hours|minute|minutes)$/.exec(raw.trim());
  if (!m) {
    throw new Error(`bl1705: unrecognized <age> example value "${raw}"`);
  }
  const n = Number(m[1]);
  const unitMs = m[2].startsWith('hour') ? 3600000 : 60000;
  return n * unitMs;
}

const KNOWN_VERDICTS = { kept: false, reaped: true };

function run(subcommand, payload) {
  const out = execFileSync('bb', [RUNNER, subcommand, JSON.stringify(payload || {})], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── the-orphan-janitor-reaps-ghost-ollama-runners-01 ──────────────────
  registry.defineScoped(
    /^a process "(.+)" whose parent is (.+) and whose age is (.+)$/,
    (ctx, cmdline, parentRaw, ageRaw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_PARENTS, parentRaw)) {
        throw new Error(`bl1705: unrecognized <parent> example value "${parentRaw}"`);
      }
      ctx.cmdline = cmdline;
      ctx.parentState = KNOWN_PARENTS[parentRaw];
      ctx.ageMs = parseAgeMs(ageRaw);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the orphan janitor classifies it$/,
    (ctx) => {
      ctx.classifyResult = run('classify', {
        cmdline: ctx.cmdline,
        parentState: ctx.parentState,
        ageMs: ctx.ageMs,
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is "(.+)"$/,
    (ctx, verdictRaw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_VERDICTS, verdictRaw)) {
        throw new Error(`bl1705: unrecognized <verdict> example value "${verdictRaw}"`);
      }
      const expectedReaped = KNOWN_VERDICTS[verdictRaw];
      assert.equal(
        ctx.classifyResult.reaped,
        expectedReaped,
        `expected reaped=${expectedReaped} for cmdline "${ctx.cmdline}" parent=${ctx.parentState} age_ms=${ctx.ageMs}, got: ${JSON.stringify(ctx.classifyResult)}`
      );
    },
    FEATURE_NAME
  );

  // ── the-orphan-janitor-reaps-ghost-ollama-runners-02 ──────────────────
  registry.defineScoped(
    /^a stand-in ghost runner whose parent is init$/,
    () => {
      // Represented structurally by the runner's fixed ghost-pid/owned-pid
      // pair (fixed parent-liveness adapters) - nothing to arrange here.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a stand-in runner whose parent is a live stand-in ollama serve$/,
    () => {},
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the orphan janitor sweep runs$/,
    (ctx) => {
      ctx.sweepResult = run('sweep-two-ollama', {});
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the ghost runner is no longer running and the sweep log names its pid and command$/,
    (ctx) => {
      // Cheshire's default key-fn prints Clojure keywords verbatim
      // (kebab-case), so the JSON payload's keys are "ghost-reaped" etc.,
      // never camelCased - bracket access, not dot access.
      assert.equal(ctx.sweepResult['ghost-reaped'], true, `expected the ghost runner to be reaped, got: ${JSON.stringify(ctx.sweepResult)}`);
      const pid = ctx.sweepResult['ghost-pid'];
      const found = (ctx.sweepResult.audits || []).some(
        (line) => line.includes(`pid=${pid} `) && line.includes('cmd=llama-server')
      );
      if (!found) {
        throw new Error(`expected an audit line naming pid=${pid} and its command, got: ${JSON.stringify(ctx.sweepResult.audits)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the owned runner is still running$/,
    (ctx) => {
      assert.equal(ctx.sweepResult['owned-reaped'], false, `expected the owned runner to survive, got: ${JSON.stringify(ctx.sweepResult)}`);
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
