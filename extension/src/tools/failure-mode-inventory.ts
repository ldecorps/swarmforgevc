#!/usr/bin/env node
/**
 * BL-512: run the pure failure-mode inventory over injected evidence paths.
 *
 * Usage:
 *   node failure-mode-inventory.js \
 *     --rule-proposals path.jsonl \
 *     --qa-bounces path.jsonl \
 *     --commit-subjects path.txt \
 *     --chaser path.jsonl \
 *     [--chaser-min-count 3] \
 *     [--json]
 *
 * Paths are required for whichever sources you want; missing flags skip that
 * source. Never defaults to repo-root .swarmforge/ (caller injects fixtures
 * or explicit live paths).
 */
import * as fs from 'fs';
import {
  loadInventoryFromContents,
  rankFailureModesByFrequency,
  FailureModeGroup,
} from '../metrics/failureModeInventory';
import { runCliMain } from './swarm-metrics';

export interface InventoryCliArgs {
  ruleProposals?: string;
  qaBounces?: string;
  commitSubjects?: string;
  chaser?: string;
  chaserMinCount: number;
  json: boolean;
}

export function parseArgs(argv: string[]): InventoryCliArgs {
  const out: InventoryCliArgs = { chaserMinCount: 3, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--rule-proposals') out.ruleProposals = next();
    else if (a === '--qa-bounces') out.qaBounces = next();
    else if (a === '--commit-subjects') out.commitSubjects = next();
    else if (a === '--chaser') out.chaser = next();
    else if (a === '--chaser-min-count') out.chaserMinCount = Number(next()) || 3;
    else if (a === '--json') out.json = true;
  }
  return out;
}

function readOptional(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return fs.readFileSync(path, 'utf8');
}

export function runInventory(args: InventoryCliArgs): FailureModeGroup[] {
  const groups = loadInventoryFromContents({
    ruleProposalsJsonl: readOptional(args.ruleProposals),
    qaBouncesJsonl: readOptional(args.qaBounces),
    commitSubjects: args.commitSubjects
      ? fs.readFileSync(args.commitSubjects, 'utf8').split(/\r?\n/)
      : undefined,
    chaserJsonl: readOptional(args.chaser),
    chaserMinCount: args.chaserMinCount,
  });
  return rankFailureModesByFrequency(groups);
}

export function formatInventoryText(groups: FailureModeGroup[]): string {
  if (groups.length === 0) return 'No failure modes inventoried.';
  return groups.map((g) => `${g.count}\t${g.signature}\t${g.citations[0] ?? ''}`).join('\n');
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  const groups = runInventory(args);
  if (args.json) {
    console.log(JSON.stringify(groups, null, 2));
  } else {
    console.log(formatInventoryText(groups));
  }
}

if (require.main === module) {
  runCliMain(() => main());
}
