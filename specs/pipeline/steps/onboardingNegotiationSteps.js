'use strict';

// BL-344: step handlers for "The onboarding scope contract is negotiated,
// not just proposed once". Drives the REAL compiled CLIs (propose ->
// object -> approve, and the unchanged build-start gate) against a REAL
// isolated git fixture repo - never a fixture standing in for the
// negotiation logic itself, matching BL-262's own onboardingContractSteps.js
// convention (real compiled modules, real fixture data) one level up (real
// CLI subprocess calls, since the negotiation loop's own state lives in
// real files the CLI reads/writes across separate invocations).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TOOLS_DIR = path.join(REPO_ROOT, 'extension', 'out', 'tools');
const PROPOSE_CLI = path.join(TOOLS_DIR, 'propose-onboarding-contract.js');
const NEGOTIATE_CLI = path.join(TOOLS_DIR, 'negotiate-onboarding-contract.js');
const GATE_CLI = path.join(TOOLS_DIR, 'onboarding-contract-gate.js');

const VALID_FACTS = {
  languages: ['TypeScript'],
  layoutSummary: 'src/ + test/',
  readmeSummary: 'A CLI tool.',
  seedVision: 'Ship the MVP, including the payments integration.',
  initialBacklogSummary: '5 tickets queued.',
};

function mkTargetWithProposedContract() {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'bl344-negotiation-'));
  execFileSync('git', ['init'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: targetRepo });
  const surveyPath = path.join(targetRepo, 'survey.json');
  fs.writeFileSync(surveyPath, JSON.stringify(VALID_FACTS));
  execFileSync('node', [PROPOSE_CLI, targetRepo, surveyPath]);
  return targetRepo;
}

function readContractYaml(targetRepo) {
  const { parseContractYaml } = require(path.join(REPO_ROOT, 'extension', 'out', 'onboarding', 'contractView'));
  return parseContractYaml(fs.readFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'utf8'));
}

function object(targetRepo, objection) {
  const output = execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', objection], { encoding: 'utf8' });
  return JSON.parse(output);
}

function approve(targetRepo) {
  const output = execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'approve'], { encoding: 'utf8' });
  return JSON.parse(output);
}

function gateDecision(targetRepo) {
  return JSON.parse(execFileSync('node', [GATE_CLI, targetRepo], { encoding: 'utf8' }));
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^the swarm has surveyed a target repository and proposed a scope contract$/, (ctx) => {
    ctx.targetRepo = mkTargetWithProposedContract();
    ctx.proposedContract = readContractYaml(ctx.targetRepo);
  });

  // ── onboarding-negotiation-01 ─────────────────────────────────────────
  registry.define(/^the human objects to the proposed contract$/, (ctx) => {
    ctx.objectionResult = object(ctx.targetRepo, 'also add accessibility support');
  });
  registry.define(/^the objection is accepted$/, (ctx) => {
    if (ctx.objectionResult.ended) {
      throw new Error(`expected the objection to be accepted (negotiation still open), got ended: ${JSON.stringify(ctx.objectionResult)}`);
    }
    if (!ctx.objectionResult.round || ctx.objectionResult.round.round !== 1) {
      throw new Error(`expected a real round-1 record, got: ${JSON.stringify(ctx.objectionResult)}`);
    }
  });

  // ── onboarding-negotiation-02/03 ──────────────────────────────────────
  registry.define(/^the human has objected to part of the proposed contract$/, (ctx) => {
    ctx.objection = 'also add accessibility support';
    object(ctx.targetRepo, ctx.objection);
  });
  registry.define(/^the swarm proposes again$/, (ctx) => {
    ctx.revisedContract = readContractYaml(ctx.targetRepo);
  });
  registry.define(/^the new proposal differs in the way the objection asked for$/, (ctx) => {
    if (!ctx.revisedContract.scope.some((s) => s.includes('accessibility support'))) {
      throw new Error(`expected the revised contract's scope to reflect the objection ("accessibility support"), got: ${JSON.stringify(ctx.revisedContract.scope)}`);
    }
  });
  registry.define(/^the new proposal is not identical to the previous one$/, (ctx) => {
    if (JSON.stringify(ctx.revisedContract) === JSON.stringify(ctx.proposedContract)) {
      throw new Error('expected the revised proposal to differ from the original proposal, it was identical');
    }
  });

  // ── onboarding-negotiation-04 ──────────────────────────────────────────
  registry.define(/^the human has objected and the swarm has proposed again$/, (ctx) => {
    object(ctx.targetRepo, 'also add accessibility support');
  });
  registry.define(/^the human approves the proposal$/, (ctx) => {
    ctx.approveResult = approve(ctx.targetRepo);
  });
  registry.define(/^the negotiation ends$/, (ctx) => {
    const result = ctx.approveResult || ctx.roundLimitResult;
    if (!result || !result.ended) {
      throw new Error(`expected the negotiation to have ended, got: ${JSON.stringify(result)}`);
    }
  });
  registry.define(/^the approved contract is the one that stands$/, (ctx) => {
    const finalContract = readContractYaml(ctx.targetRepo);
    if (finalContract.agreement !== 'agreed') {
      throw new Error(`expected the final committed contract's agreement to be "agreed", got: ${finalContract.agreement}`);
    }
    if (!finalContract.scope.some((s) => s.includes('accessibility support'))) {
      throw new Error('expected the APPROVED contract to be the revised one (carrying the objection), not the original proposal');
    }
  });

  // ── onboarding-negotiation-05 ──────────────────────────────────────────
  registry.define(/^the human keeps objecting$/, (ctx) => {
    // Drive exactly the real default round budget (5), then one more -
    // the real CLI enforces the cap, never a fixture standing in for it.
    for (let i = 0; i < 5; i++) {
      object(ctx.targetRepo, `objection number ${i}`);
    }
  });
  registry.define(/^the round limit is reached$/, (ctx) => {
    ctx.roundLimitResult = object(ctx.targetRepo, 'one objection too many');
  });
  registry.define(/^no contract is approved$/, (ctx) => {
    const finalContract = readContractYaml(ctx.targetRepo);
    if (finalContract.agreement === 'agreed') {
      throw new Error('expected the contract to remain unapproved after the round limit, it was agreed');
    }
    // The regression this ticket exists to prevent: approval must remain
    // possible right up to the cap, and refusing further objections must
    // never silently approve by exhaustion - confirmed here against the
    // REAL CLI, not just the pure function.
    if (ctx.roundLimitResult.endedReason !== 'round-limit') {
      throw new Error(`expected endedReason "round-limit", got: ${ctx.roundLimitResult.endedReason}`);
    }
  });

  // ── onboarding-negotiation-06 ──────────────────────────────────────────
  registry.define(/^the human has not approved any proposal$/, () => {
    // Narrative only - the Background's own proposed contract already
    // satisfies this (agreement: proposed, never touched by an approve
    // call in this scenario).
  });
  registry.define(/^onboarding is attempted$/, (ctx) => {
    ctx.gateResult = gateDecision(ctx.targetRepo);
  });
  registry.define(/^the target repository is not onboarded$/, (ctx) => {
    if (ctx.gateResult.decision !== 'hold') {
      throw new Error(`expected the build-start gate to hold (unapproved contract), got: ${JSON.stringify(ctx.gateResult)}`);
    }
  });

  // ── onboarding-negotiation-07 ──────────────────────────────────────────
  registry.define(/^the negotiation is reviewed$/, (ctx) => {
    const { negotiationLogPath } = require(path.join(TOOLS_DIR, 'negotiate-onboarding-contract'));
    ctx.negotiationLog = fs.readFileSync(negotiationLogPath(ctx.targetRepo), 'utf8');
  });
  registry.define(/^each round records the objection and what changed in response$/, (ctx) => {
    const lines = ctx.negotiationLog.trim().split('\n').map((l) => JSON.parse(l));
    if (lines.length === 0) {
      throw new Error('expected at least one recorded round in the real negotiation log, found none');
    }
    for (const round of lines) {
      if (typeof round.objection !== 'string' || !round.objection) {
        throw new Error(`expected every recorded round to carry the objection text, got: ${JSON.stringify(round)}`);
      }
      if (!Array.isArray(round.changedFields) || round.changedFields.length === 0) {
        throw new Error(`expected every recorded round to name what changed, got: ${JSON.stringify(round)}`);
      }
    }
    if (!lines.some((r) => r.objection.includes('accessibility support'))) {
      throw new Error('expected the real recorded round to carry the actual objection text');
    }
  });

  // ── BL-262 slice 2 (folded in from the parked .feature.draft, built by
  //    BL-344) - same underlying real CLI, different Gherkin phrasing ────
  registry.define(/^a proposed onboarding contract the swarm has drafted from its repo survey$/, (ctx) => {
    if (!ctx.targetRepo) {
      ctx.targetRepo = mkTargetWithProposedContract();
      ctx.proposedContract = readContractYaml(ctx.targetRepo);
    }
  });
  registry.define(/^the operator requests a change to the proposed contract$/, (ctx) => {
    ctx.objection = 'also add accessibility support';
    ctx.objectionResult = object(ctx.targetRepo, ctx.objection);
  });
  registry.define(/^the swarm revises the contract and re-proposes it, still awaiting agreement$/, (ctx) => {
    const revised = readContractYaml(ctx.targetRepo);
    if (revised.agreement !== 'proposed') {
      throw new Error(`expected the revised contract to still await agreement ("proposed"), got: ${revised.agreement}`);
    }
  });
  registry.define(/^the requested change is reflected in the revised proposal$/, (ctx) => {
    const revised = readContractYaml(ctx.targetRepo);
    if (!revised.scope.some((s) => s.includes('accessibility support'))) {
      throw new Error(`expected the revised proposal to reflect the requested change, got scope: ${JSON.stringify(revised.scope)}`);
    }
  });

  registry.define(/^the contract has been revised across one or more request-and-revise rounds$/, (ctx) => {
    ctx.objection = 'also add accessibility support';
    object(ctx.targetRepo, ctx.objection);
  });
  registry.define(/^the coordinator evaluates the build-start gate before agreement$/, (ctx) => {
    ctx.gateBeforeAgreement = gateDecision(ctx.targetRepo);
  });
  registry.define(/^the gate holds dispatch$/, (ctx) => {
    if (ctx.gateBeforeAgreement.decision !== 'hold') {
      throw new Error(`expected the gate to hold across negotiation rounds, got: ${JSON.stringify(ctx.gateBeforeAgreement)}`);
    }
  });
  registry.define(/^once the operator agrees to a revised contract the gate allows dispatch$/, (ctx) => {
    approve(ctx.targetRepo);
    const gateAfter = gateDecision(ctx.targetRepo);
    if (gateAfter.decision !== 'allow') {
      throw new Error(`expected the gate to allow once the revised contract is agreed, got: ${JSON.stringify(gateAfter)}`);
    }
  });

  registry.define(/^the operator requested a specific change to the proposed scope$/, (ctx) => {
    ctx.originalScope = readContractYaml(ctx.targetRepo).scope.slice();
    ctx.objection = 'also add accessibility support';
    object(ctx.targetRepo, ctx.objection);
  });
  registry.define(/^the swarm re-proposes the contract$/, (ctx) => {
    ctx.reProposedContract = readContractYaml(ctx.targetRepo);
  });
  registry.define(/^the re-proposed scope carries the operator's requested change rather than a fresh survey that ignores it$/, (ctx) => {
    const { reProposedContract, originalScope } = ctx;
    if (!reProposedContract.scope.some((s) => s.includes('accessibility support'))) {
      throw new Error('expected the re-proposed scope to carry the operator\'s requested change');
    }
    // Proves this is a RESPONSIVE revision, not a fresh survey that
    // discards the prior proposal: every original scope entry is still
    // present, with the requested change ADDED alongside it.
    for (const entry of originalScope) {
      if (!reProposedContract.scope.includes(entry)) {
        throw new Error(`expected the original scope entry to survive the revision (never a fresh regenerate-from-scratch), missing: ${entry}`);
      }
    }
  });
}

module.exports = { registerSteps };
