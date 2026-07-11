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
import { RepoSurveyFacts } from '../onboarding/contractTypes';
import { initializeTargetContract } from '../config/targetBootstrap';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

function parseArgs(argv: string[]): { targetRepoPath: string; surveyFactsPath: string } | null {
  const [targetRepoPath, surveyFactsPath] = argv;
  return targetRepoPath && surveyFactsPath ? { targetRepoPath, surveyFactsPath } : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function readSurveyFacts(surveyFactsPath: string): RepoSurveyFacts {
  const raw: unknown = JSON.parse(fs.readFileSync(surveyFactsPath, 'utf8'));
  if (
    !raw ||
    typeof raw !== 'object' ||
    !isStringArray((raw as Record<string, unknown>).languages) ||
    typeof (raw as Record<string, unknown>).layoutSummary !== 'string' ||
    typeof (raw as Record<string, unknown>).readmeSummary !== 'string' ||
    typeof (raw as Record<string, unknown>).seedVision !== 'string' ||
    typeof (raw as Record<string, unknown>).initialBacklogSummary !== 'string'
  ) {
    throw new Error(
      `${surveyFactsPath} does not match RepoSurveyFacts (languages: string[], layoutSummary/readmeSummary/seedVision/initialBacklogSummary: string)`
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
    const result = await initializeTargetContract(targetRepoPath, contract);
    printJsonToStdout(result);
  }
);

if (require.main === module) {
  runCliMain(main);
}
