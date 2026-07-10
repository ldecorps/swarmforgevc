#!/usr/bin/env node
/**
 * BL-250 architect bounce (47ee1df386, "roster source has no CLI
 * entrypoint"): the bake-off's end-to-end entry point. recruiter-run.ts
 * (BL-233's CLI) is hardwired to createFileDiscoverySource, which neither
 * attaches costTier nor filters non-chat endpoints - feeding a bake-off
 * catalog through it would silently produce wrong output, not just
 * "technically unreachable." This CLI wires createFileRosterSource
 * instead, through the SAME real orchestrator/secret-store/battery
 * (unchanged, per the ticket's own reuse scope), and labels the printed
 * report by cost tier (this ticket's own novel surface) via costTierLabel.ts.
 * No live swarm state touched, no swarmforge.conf mutation (recommend.ts
 * structurally cannot write it).
 *
 * Usage: node bakeoff-run.js <catalog-file> <signup-keys-file>
 *          <role-trials-file> <secrets-file> <current-models-file>
 *
 * Thin presenter over orchestrator.ts + costTierLabel.ts - no other
 * derivation logic here, same posture as recruiter-run.ts.
 */

import { ConfChangeSuggestion, ModelCandidate, RoleLeaderboard } from '../recruiter/candidate';
import { labelCostTier } from '../recruiter/costTierLabel';
import { EscalatedCandidate, RecruiterReport, RoleReport } from '../recruiter/orchestrator';
import { createFileRosterSource } from '../recruiter/rosterSource';
import { runRecruiterWithFileAdapters } from '../recruiter/runRecruiterFromFiles';
import { printJsonToStdout, runCliMain } from './swarm-metrics';

export interface BakeoffRunArgs {
  catalogFile: string;
  signupKeysFile: string;
  roleTrialsFile: string;
  secretsFile: string;
  currentModelsFile: string;
}

const USAGE =
  'Usage: bakeoff-run.js <catalog-file> <signup-keys-file> <role-trials-file> <secrets-file> <current-models-file>\n';

// Pure - no process.argv/stderr/exitCode access here, same "keep main() a
// thin dispatcher over a testable pure helper" split recruiter-run.ts's
// own hardener pass already established (a CLI main() run only through a
// subprocess test is coverage-invisible, which pushed CRAP over the gate
// there - avoided here by never letting that logic live only in main()).
export function parseArgs(argv: string[]): BakeoffRunArgs | null {
  const [catalogFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile] = argv;
  const files = [catalogFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile];
  if (files.some((file) => !file)) {
    return null;
  }
  return { catalogFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile };
}

interface LabeledEntry {
  model: string;
  capability: number;
  planCost: ModelCandidate['planCost'];
  costTier: ModelCandidate['costTier'] | null;
}

interface LabeledRoleLeaderboard extends Omit<RoleLeaderboard, 'ranked'> {
  ranked: LabeledEntry[];
}

interface LabeledRoleReport extends Omit<RoleReport, 'leaderboard'> {
  leaderboard: LabeledRoleLeaderboard;
  suggestion: ConfChangeSuggestion | null;
}

interface LabeledEscalatedCandidate extends EscalatedCandidate {
  costTier: ModelCandidate['costTier'] | null;
}

export interface LabeledRecruiterReport {
  roles: LabeledRoleReport[];
  escalated: LabeledEscalatedCandidate[];
}

// Merges each roster candidate's cost tier into the recruiter report's
// per-role ranked entries and escalated (untested) list, WITHOUT touching
// rank.ts/orchestrator.ts - both stay unchanged per the ticket's own
// "reuse the best-value ranker and report writer unchanged" scope. Every
// candidate is labeled (the ticket's own wording), ranked or not.
export function labelReportCostTiers(report: RecruiterReport, candidates: ModelCandidate[]): LabeledRecruiterReport {
  const costTierByModel = new Map(candidates.map((candidate) => [candidate.model, labelCostTier(candidate).costTier]));
  return {
    roles: report.roles.map((roleReport) => ({
      ...roleReport,
      leaderboard: {
        ...roleReport.leaderboard,
        ranked: roleReport.leaderboard.ranked.map((entry) => ({
          ...entry,
          costTier: costTierByModel.get(entry.model) ?? null,
        })),
      },
    })),
    escalated: report.escalated.map((entry) => ({
      ...entry,
      costTier: costTierByModel.get(entry.model) ?? null,
    })),
  };
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const roster = createFileRosterSource(args.catalogFile);
  const candidates = await roster.discover();
  const report = await runRecruiterWithFileAdapters(roster, args);
  printJsonToStdout(labelReportCostTiers(report, candidates));
}

if (require.main === module) {
  runCliMain(main);
}
