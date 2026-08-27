'use strict';

// BL-360: step handlers for "An onboarded target repo comes with an
// inventory of what it already does". Mirrors onboardingContractSteps.js's
// own pattern: pure derivation scenarios (01/02/06) drive the REAL
// compiled deriveUseCaseInventory/generateUseCaseInventoryMarkdown
// in-process against fixture survey facts (the SURVEY itself is
// swarm/agent behavior, not unit-testable code); delivery scenarios
// (03/04) drive the REAL initializeTargetContract/
// initializeTargetUseCaseInventory against a real throwaway git target
// repo, proving the actual observable property (a file landing in the
// target, un-gated) rather than a mock of it.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { deriveUseCaseInventory, generateUseCaseInventoryMarkdown } = require(
  path.join(EXT_DIR, 'out', 'onboarding', 'useCaseInventory')
);
const { proposeContractFromSurvey } = require(path.join(EXT_DIR, 'out', 'onboarding', 'contractSurvey'));
const { initializeTargetContract, initializeTargetUseCaseInventory } = require(
  path.join(EXT_DIR, 'out', 'config', 'targetBootstrap')
);
const { parseContractYaml } = require(path.join(EXT_DIR, 'out', 'onboarding', 'contractView'));

const BASE_SURVEY_FACTS = {
  languages: ['TypeScript'],
  layoutSummary: 'src/ + test/',
  readmeSummary: 'A CLI tool. No feature list here - scenario 02 exists because of that gap.',
  seedVision: 'Ship the MVP.',
  initialBacklogSummary: '5 tickets queued.',
  useCaseObservations: [
    { name: 'CSV export', summary: 'Exports the current report as CSV.', locations: ['src/export/csv.ts'] },
    { name: 'Scheduled scan', summary: 'Runs a scan on a cron schedule.', locations: ['src/scheduler.ts'] },
  ],
};

function mkTargetRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-use-case-inventory-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^the swarm has been pointed at a target repo$/, (ctx) => {
    ctx.surveyFacts = BASE_SURVEY_FACTS;
    ctx.targetRepo = mkTargetRepo();
  });

  // ── target-use-case-inventory-01/02/06 ───────────────────────────────────
  registry.define(/^the swarm surveys the target repo$/, (ctx) => {
    ctx.inventory = deriveUseCaseInventory(ctx.surveyFacts);
  });

  registry.define(/^it produces an inventory of the use cases the target's existing code supports$/, (ctx) => {
    if (ctx.inventory.entries.length === 0) {
      throw new Error('expected the inventory to carry at least one use case for a target with observed capabilities');
    }
    const names = ctx.inventory.entries.map((e) => e.name);
    if (!names.includes('CSV export') || !names.includes('Scheduled scan')) {
      throw new Error(`expected the surveyed use cases to appear in the inventory, got: ${JSON.stringify(names)}`);
    }
  });

  registry.define(/^each use case in the inventory names where in the target's code it is implemented$/, (ctx) => {
    for (const entry of ctx.inventory.entries) {
      if (!entry.locations || entry.locations.length === 0) {
        throw new Error(`expected "${entry.name}" to name at least one code location, got: ${JSON.stringify(entry)}`);
      }
    }
  });

  // ── target-use-case-inventory-03 ─────────────────────────────────────────
  registry.define(/^the swarm proposes a scope contract for the target repo$/, async (ctx) => {
    const contract = proposeContractFromSurvey(ctx.surveyFacts);
    ctx.contractResult = await initializeTargetContract(ctx.targetRepo, contract);
    ctx.inventory = deriveUseCaseInventory(ctx.surveyFacts);
    ctx.inventoryResult = await initializeTargetUseCaseInventory(ctx.targetRepo, ctx.inventory);
  });

  registry.define(/^the inventory is written into the target repo as a legible document for its humans$/, (ctx) => {
    const inventoryPath = path.join(ctx.targetRepo, 'USE-CASES.md');
    if (!fs.existsSync(inventoryPath)) {
      throw new Error(`expected USE-CASES.md to exist in the target repo at ${inventoryPath}`);
    }
    const content = fs.readFileSync(inventoryPath, 'utf8');
    if (!content.includes('CSV export')) {
      throw new Error(`expected the delivered USE-CASES.md to name the surveyed use cases, got: ${content}`);
    }
  });

  // ── target-use-case-inventory-04 ─────────────────────────────────────────
  registry.define(/^the swarm has proposed a scope contract the human has not agreed to$/, async (ctx) => {
    const contract = proposeContractFromSurvey(ctx.surveyFacts);
    await initializeTargetContract(ctx.targetRepo, contract);
    ctx.inventory = deriveUseCaseInventory(ctx.surveyFacts);
    await initializeTargetUseCaseInventory(ctx.targetRepo, ctx.inventory);
    const yaml = fs.readFileSync(path.join(ctx.targetRepo, '.swarmforge', 'contract.yaml'), 'utf8');
    ctx.contractAgreement = parseContractYaml(yaml).agreement;
  });

  registry.define(/^the human asks what the target repo does$/, (ctx) => {
    ctx.inventoryPath = path.join(ctx.targetRepo, 'USE-CASES.md');
  });

  registry.define(/^the inventory is available to him$/, (ctx) => {
    if (!fs.existsSync(ctx.inventoryPath)) {
      throw new Error('expected the inventory to already be readable in the target repo');
    }
  });

  registry.define(/^it is not withheld pending his agreement to the contract$/, (ctx) => {
    if (ctx.contractAgreement !== 'proposed') {
      throw new Error(
        `expected the contract to still be merely "proposed" (not yet agreed) while the inventory is already delivered, got agreement="${ctx.contractAgreement}"`
      );
    }
    // The prior step's fs.existsSync already proved the file is there
    // DESPITE agreement still being "proposed" - the withholding this
    // step guards against is initializeTargetPrompts's own GateDecision
    // gate, which initializeTargetUseCaseInventory structurally cannot
    // take (see its own header comment).
  });

  // ── target-use-case-inventory-05 ─────────────────────────────────────────
  registry.define(/^the inventory has been delivered to the human$/, (ctx) => {
    ctx.inventory = deriveUseCaseInventory(ctx.surveyFacts);
  });

  registry.define(/^he asks for a change to one of the use cases in it$/, (ctx) => {
    ctx.citedEntry = ctx.inventory.entries[0];
  });

  registry.define(/^the change request can name that use case as its starting point$/, (ctx) => {
    const found = ctx.inventory.entries.find((e) => e.name === ctx.citedEntry.name);
    if (!found) {
      throw new Error(`expected the cited use case name "${ctx.citedEntry.name}" to be a stable, findable identifier in the inventory`);
    }
  });

  // ── target-use-case-inventory-06 ─────────────────────────────────────────
  registry.define(/^the target repo has no discernible use cases$/, (ctx) => {
    ctx.surveyFacts = { ...BASE_SURVEY_FACTS, useCaseObservations: [] };
  });

  registry.define(/^the inventory says plainly that it found none, rather than inventing one$/, (ctx) => {
    if (ctx.inventory.entries.length !== 0) {
      throw new Error(`expected zero entries for a target with no discernible use cases, got: ${JSON.stringify(ctx.inventory.entries)}`);
    }
    const markdown = generateUseCaseInventoryMarkdown(ctx.inventory);
    if (!markdown.includes('No discernible use cases were found')) {
      throw new Error(`expected an explicit "none found" statement, got: ${markdown}`);
    }
  });
}

module.exports = { registerSteps };
