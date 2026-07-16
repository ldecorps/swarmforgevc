'use strict';

// BL-446: step handlers for "A mutation run that kills no mutants is
// surfaced as a broken gate, not accepted as a clean pass". Drives the REAL
// compiled classifyMutationGateHealth/buildMutationGateHealthVerdict/
// formatMutationGateHealthVerdict (mutationGateHealth.ts) directly - pure,
// no VS Code, no network, no live Stryker run. The OPERATIONAL half of this
// ticket (the actual fix to Stryker's kill mechanism) is a QA e2e procedure
// (a fresh, cache-cleared scoped Stryker run), not an acceptance scenario -
// mirrors BL-445's own split between acceptance-verified pure logic and
// E2E-verified wiring (bl445SuiteDurationBudgetSteps.js).
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { buildMutationGateHealthVerdict, formatMutationGateHealthVerdict } = require(
  path.join(EXT_DIR, 'out', 'mutation', 'mutationGateHealth')
);

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a completed mutation run summarized by its killed and survived mutant counts$/, () => {
    // Nothing to stash - each scenario below supplies its own counts.
  });

  // ── BL-446 mutation-gate-zero-kill-broken-01 (Scenario Outline) ─────
  registry.define(/^a mutation run reporting "([^"]+)" killed and "([^"]+)" survived mutants$/, (ctx, killedText, survivedText) => {
    ctx.killed = Number(killedText);
    ctx.survived = Number(survivedText);
  });

  registry.define(/^the run's mutation-gate health is classified$/, (ctx) => {
    ctx.result = buildMutationGateHealthVerdict(ctx.killed, ctx.survived);
  });

  registry.define(/^the health is reported "([^"]+)"$/, (ctx, expectedHealth) => {
    if (ctx.result.health !== expectedHealth) {
      throw new Error(`expected health "${expectedHealth}", got "${ctx.result.health}" for ${ctx.killed} killed / ${ctx.survived} survived`);
    }
  });

  // ── BL-446 mutation-gate-zero-kill-broken-02 ────────────────────────
  registry.define(/^a mutation run that killed no mutants across many survivors$/, (ctx) => {
    ctx.killed = 0;
    ctx.survived = 94;
  });

  registry.define(/^the mutation-gate health verdict is produced$/, (ctx) => {
    ctx.result = buildMutationGateHealthVerdict(ctx.killed, ctx.survived);
    ctx.formatted = formatMutationGateHealthVerdict(ctx.result);
  });

  registry.define(/^the run is surfaced as zero-kill-suspect with its mutant counts, not reported as a clean gate pass$/, (ctx) => {
    if (ctx.result.health !== 'zero-kill-suspect') {
      throw new Error(`expected zero-kill-suspect, got "${ctx.result.health}"`);
    }
    if (!/suspect/i.test(ctx.formatted) || !/0 killed/.test(ctx.formatted) || !/94 survived/.test(ctx.formatted)) {
      throw new Error(`expected the verdict to be surfaced with its counts, got: ${ctx.formatted}`);
    }
    if (/healthy/i.test(ctx.formatted)) {
      throw new Error(`expected the surfaced verdict to never read as a clean pass, got: ${ctx.formatted}`);
    }
  });
}

module.exports = { registerSteps };
