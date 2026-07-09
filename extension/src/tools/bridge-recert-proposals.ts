#!/usr/bin/env node
/**
 * BL-217 webhook-05: the host-side bridge from the serverless receiver's
 * committed proposals (backlog/recert-inbox/*.json, written via GitHub's
 * Contents API by recertProposalRepoCommit.ts - the function has no
 * filesystem access to a running host's .swarmforge/) into BL-150's
 * existing durable review queue (.swarmforge/recert_proposals/<month>.jsonl,
 * appendRecertProposal). Without this, a committed proposal is the
 * "built-but-unwired trap" the ticket calls out: real infra with nothing
 * picking it up.
 *
 * Ingesting a file is host-filesystem-only (fs.rmSync); this tool does not
 * shell out to git - whoever runs it (a role, a human) commits the
 * resulting deletions in their own normal commit, same as any other
 * backlog-folder move in this project.
 *
 * Usage: node bridge-recert-proposals.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { appendRecertProposal } from '../docs/recertificationStore';
import { RecertProposal, ReviewOutcome } from '../docs/recertification';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

function recertInboxDir(targetPath: string): string {
  return path.join(targetPath, 'backlog', 'recert-inbox');
}

function isReviewOutcome(value: unknown): value is ReviewOutcome {
  return value === 'update' || value === 'delete';
}

function parseRecertProposal(raw: string): RecertProposal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const candidate = parsed as Partial<RecertProposal>;
  if (typeof candidate.scenarioId !== 'string' || typeof candidate.receivedAtIso !== 'string' || !isReviewOutcome(candidate.outcome)) {
    return null;
  }
  const proposal: RecertProposal = { scenarioId: candidate.scenarioId, outcome: candidate.outcome, receivedAtIso: candidate.receivedAtIso };
  if (candidate.outcome === 'update' && typeof candidate.newText === 'string') {
    proposal.newText = candidate.newText;
  }
  return proposal;
}

export interface BridgeRecertProposalsResult {
  ingested: string[];
  skipped: Array<{ file: string; reason: string }>;
}

export function bridgeRecertProposals(targetPath: string, nowMs: number = Date.now()): BridgeRecertProposalsResult {
  const inboxDir = recertInboxDir(targetPath);
  const result: BridgeRecertProposalsResult = { ingested: [], skipped: [] };

  let entries: string[];
  try {
    entries = fs.readdirSync(inboxDir);
  } catch {
    return result;
  }

  for (const file of entries.filter((name) => name.endsWith('.json')).sort()) {
    const filePath = path.join(inboxDir, file);
    const raw = fs.readFileSync(filePath, 'utf8');
    const proposal = parseRecertProposal(raw);
    if (!proposal) {
      result.skipped.push({ file, reason: 'not a valid recertification proposal' });
      continue;
    }
    appendRecertProposal(targetPath, proposal, nowMs);
    fs.rmSync(filePath);
    result.ingested.push(file);
  }

  return result;
}

export function main(): void {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const result = bridgeRecertProposals(mainWorktreePath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  runCliMain(main);
}
