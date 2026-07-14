#!/usr/bin/env node
/**
 * BL-262 slice 1: turns already-gathered repo-survey facts into a proposed
 * onboarding contract and scaffolds + commits it into the target repo
 * (.swarmforge/contract.yaml + CONTRACT.md), reusing targetBootstrap.ts's
 * existing idempotent plan/write/commit seam. The SURVEY itself (reading the
 * target's languages/layout/README/seed/backlog) is swarm/agent behavior,
 * not this tool's job - the caller (an onboarding agent) gathers those facts
 * and passes them here as a JSON file matching RepoSurveyFacts.
 *
 * Usage: node propose-onboarding-contract.js <target-repo-path> <survey-facts-json-path>
 */
import * as fs from 'fs';
import { proposeContractFromSurvey } from '../onboarding/contractSurvey';
import { deriveUseCaseInventory } from '../onboarding/useCaseInventory';
import { RepoSurveyFacts } from '../onboarding/contractTypes';
import { initializeTargetContract, initializeTargetUseCaseInventory } from '../config/targetBootstrap';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

// Exported (like bakeoff-run.ts's own parseArgs/labelReportCostTiers) so
// these run in-process under coverage instead of only via the compiled
// CLI's subprocess - a CLI's main() run solely via execFileSync is
// coverage-invisible for everything it calls.
export function parseArgs(argv: string[]): { targetRepoPath: string; surveyFactsPath: string } | null {
  const [targetRepoPath, surveyFactsPath] = argv;
  return targetRepoPath && surveyFactsPath ? { targetRepoPath, surveyFactsPath } : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

// BL-360: each raw observation's own shape check, split out the same way
// isRepoSurveyFactsShape is split from readSurveyFacts below.
function isUseCaseObservationShape(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).name === 'string' &&
    typeof (value as Record<string, unknown>).summary === 'string' &&
    isStringArray((value as Record<string, unknown>).locations)
  );
}

// Split out of isRepoSurveyFactsShape so that function's own branch count
// stays under the CRAP threshold (adding this check as two more inline `&&`
// conjuncts pushed isRepoSurveyFactsShape's own complexity to 7).
function isUseCaseObservationArrayShape(value: unknown): boolean {
  return Array.isArray(value) && value.every(isUseCaseObservationShape);
}

// Split out of readSurveyFacts so that function's own branch count stays
// low, same technique as contractView.ts's isContractShape. Not a type
// predicate: RepoSurveyFacts has no index signature, so it cannot narrow a
// Record<string, unknown> directly - the caller casts once shape is confirmed.
function isRepoSurveyFactsShape(value: Record<string, unknown>): boolean {
  return (
    isStringArray(value.languages) &&
    typeof value.layoutSummary === 'string' &&
    typeof value.readmeSummary === 'string' &&
    typeof value.seedVision === 'string' &&
    typeof value.initialBacklogSummary === 'string' &&
    isUseCaseObservationArrayShape(value.useCaseObservations)
  );
}

export function readSurveyFacts(surveyFactsPath: string): RepoSurveyFacts {
  const raw: unknown = JSON.parse(fs.readFileSync(surveyFactsPath, 'utf8'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !isRepoSurveyFactsShape(raw as Record<string, unknown>)) {
    throw new Error(
      `${surveyFactsPath} does not match RepoSurveyFacts (languages: string[], layoutSummary/readmeSummary/seedVision/initialBacklogSummary: string, useCaseObservations: {name, summary, locations: string[]}[])`
    );
  }
  return raw as RepoSurveyFacts;
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node propose-onboarding-contract.js <target-repo-path> <survey-facts-json-path>\n',
  async ({ targetRepoPath, surveyFactsPath }) => {
    const facts = readSurveyFacts(surveyFactsPath);
    const contract = proposeContractFromSurvey(facts);
    const contractResult = await initializeTargetContract(targetRepoPath, contract);
    // BL-360: the inventory rides the SAME ungated path as the contract
    // (never behind a GateDecision - the human needs it to DECIDE on the
    // contract) and lands in the SAME proposal step, "at proposal time,
    // beside CONTRACT.md" - its own separate commit, per
    // initializeTargetUseCaseInventory's own header.
    const inventory = deriveUseCaseInventory(facts);
    const inventoryResult = await initializeTargetUseCaseInventory(targetRepoPath, inventory);
    printJsonToStdout({
      created: [...contractResult.created, ...inventoryResult.created],
      skipped: [...contractResult.skipped, ...inventoryResult.skipped],
      committed: contractResult.committed || inventoryResult.committed,
    });
  }
);

if (require.main === module) {
  runCliMain(main);
}
