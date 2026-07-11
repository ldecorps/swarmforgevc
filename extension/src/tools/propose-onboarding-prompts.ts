#!/usr/bin/env node
/**
 * BL-269: turns already-gathered repo-survey facts into the target repo's
 * own project.prompt/engineering.prompt (survey-populated, not the generic
 * "Initialize Target" placeholder), then releases them for commit into the
 * target repo ONLY when the SAME onboarding contract this survey also
 * proposes (BL-262) is agreed - one agreement gates the whole artifact
 * set. Re-running this CLI after the operator agrees is what actually
 * commits the files; running it earlier (proposed/pending) is a safe no-op
 * that reports withheld:true.
 *
 * Reuses propose-onboarding-contract.js's readSurveyFacts and
 * onboarding-contract-gate.js's readContractYaml as-is - never a second
 * survey-facts parser or a second gate-state reader.
 *
 * Usage: node propose-onboarding-prompts.js <target-repo-path> <survey-facts-json-path>
 */
import { proposePromptsFromSurvey } from '../onboarding/promptProposal';
import { evaluateBuildStartGate } from '../onboarding/buildStartGate';
import { initializeTargetPrompts } from '../config/targetBootstrap';
import { readSurveyFacts } from './propose-onboarding-contract';
import { readContractYaml } from './onboarding-contract-gate';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export function parseArgs(argv: string[]): { targetRepoPath: string; surveyFactsPath: string } | null {
  const [targetRepoPath, surveyFactsPath] = argv;
  return targetRepoPath && surveyFactsPath ? { targetRepoPath, surveyFactsPath } : null;
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node propose-onboarding-prompts.js <target-repo-path> <survey-facts-json-path>\n',
  async ({ targetRepoPath, surveyFactsPath }) => {
    const facts = readSurveyFacts(surveyFactsPath);
    const prompts = proposePromptsFromSurvey(facts);
    const gateDecision = evaluateBuildStartGate(readContractYaml(targetRepoPath));
    const result = await initializeTargetPrompts(targetRepoPath, prompts, gateDecision);
    printJsonToStdout(result);
  }
);

if (require.main === module) {
  runCliMain(main);
}
