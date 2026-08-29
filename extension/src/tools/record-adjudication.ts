#!/usr/bin/env node
// BL-1267: the WRITER for the discharge the freshness gate reads.
//
// Article 3.6's confirm-promote outcome had nowhere to be recorded that
// deprecate-check.js could read. This CLI writes that record: who adjudicated,
// when, with what outcome, and - the part that makes it safe - a fingerprint
// of the exact ticket content the adjudication was made against, so amending
// the ticket afterwards re-arms the gate instead of riding a stale clearance.
//
// Shipped in the same parcel as the reader on purpose. A writer with no reader
// (or a reader with no writer) is a dark path that goes green over fakes while
// the end-to-end route stays broken.
import * as fs from 'fs';
import * as path from 'path';
import {
  AdjudicationOutcome,
  AdjudicationRecord,
  adjudicationRecordPath,
  computeTicketFingerprint,
  findTicketYamlPath,
  normalizeTicketId,
} from './deprecate-check';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

const OUTCOMES: AdjudicationOutcome[] = ['confirm_promote', 'amend', 'retire', 'split'];

export interface RecordAdjudicationArgs {
  root: string;
  ticketId: string;
  outcome: AdjudicationOutcome;
  adjudicatedBy: string;
  adjudicatedAt?: string;
}

function missingRequiredArg(root?: string, ticketId?: string, outcome?: string, adjudicatedBy?: string): boolean {
  return !root || !ticketId || !outcome || !adjudicatedBy;
}

export function parseArgs(argv: string[]): RecordAdjudicationArgs | null {
  const [root, ticketId, outcome, adjudicatedBy, adjudicatedAt] = argv;
  if (missingRequiredArg(root, ticketId, outcome, adjudicatedBy)) {
    return null;
  }
  if (!OUTCOMES.includes(outcome as AdjudicationOutcome)) {
    return null;
  }
  return {
    root,
    ticketId,
    outcome: outcome as AdjudicationOutcome,
    adjudicatedBy,
    ...(adjudicatedAt ? { adjudicatedAt } : {}),
  };
}

/**
 * Write the record. Throws when the ticket cannot be found: an adjudication
 * that names no ticket content has nothing to be fingerprinted against, and a
 * record with an empty fingerprint would discharge nothing - better to refuse
 * loudly than to write one that can never match.
 */
export function recordAdjudication(args: RecordAdjudicationArgs, nowIso: string = new Date().toISOString()): {
  path: string;
  record: AdjudicationRecord;
} {
  const id = normalizeTicketId(args.ticketId);
  const ticketPath = findTicketYamlPath(args.root, id);
  if (!ticketPath) {
    throw new Error(`no ticket YAML found for ${id} under ${args.root} — nothing to fingerprint`);
  }
  const record: AdjudicationRecord = {
    ticket: id,
    outcome: args.outcome,
    adjudicated_by: args.adjudicatedBy,
    adjudicated_at: args.adjudicatedAt ?? nowIso,
    content_fingerprint: computeTicketFingerprint(fs.readFileSync(ticketPath, 'utf8')),
  };
  const target = adjudicationRecordPath(args.root, id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
  return { path: target, record };
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node record-adjudication.js <project-root> <BL-id> <confirm_promote|amend|retire|split> <adjudicated-by> [iso-timestamp]\n',
  async (args) => {
    printJsonToStdout(recordAdjudication(args));
  }
);

if (require.main === module) {
  runCliMain(main);
}
