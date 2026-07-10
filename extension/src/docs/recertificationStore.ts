// BL-150: the impure read/write layer for recertification.ts's pure
// functions - the durable per-scenario last-reviewed store
// (.swarmforge/recert-state.json, mirroring canaryInjector.ts's
// canary-status.json idiom: defensive read, whole-file overwrite) and the
// durable, one-per-change proposal queue
// (.swarmforge/recert_proposals/<yyyy-MM>.jsonl, mirroring handoffd.bb's
// rule_proposals/<yyyy-MM>.jsonl audit trail on the babashka side).

import * as fs from 'fs';
import * as path from 'path';
import { atomicAppend, atomicWrite } from '../util/atomicWrite';
import { computeDocsTree } from './docsTree';
import {
  emptyRecertStore,
  RecertifiableScenario,
  recertifiableScenariosFrom,
  RecertProposal,
  RecertStoreData,
  selectForRecertification,
} from './recertification';

function recertStateFile(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'recert-state.json');
}

// Defensive read, matching canaryInjector.ts's own idiom: a missing,
// unreadable, or corrupt store is never fatal - it just means every
// scenario is treated as never-reviewed.
export function readRecertStore(targetPath: string): RecertStoreData {
  try {
    const content = fs.readFileSync(recertStateFile(targetPath), 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && parsed.scenarios && typeof parsed.scenarios === 'object') {
      return parsed as RecertStoreData;
    }
    return emptyRecertStore();
  } catch {
    return emptyRecertStore();
  }
}

export function writeRecertStore(targetPath: string, store: RecertStoreData): void {
  atomicWrite(recertStateFile(targetPath), JSON.stringify(store));
}

function recertProposalsFile(targetPath: string, nowMs: number): string {
  const month = new Date(nowMs).toISOString().slice(0, 7); // yyyy-MM
  return path.join(targetPath, '.swarmforge', 'recert_proposals', `${month}.jsonl`);
}

// recert-03/recert-05's queuing contract: one durable jsonl line per
// proposal, appended via O_APPEND so concurrent inbound emails never
// clobber each other - the extension host's counterpart to
// append-rule-proposal! (handoffd.bb), since it has no SWARMFORGE_ROLE
// identity to route a real rule_proposal handoff through swarm_handoff.bb.
export function appendRecertProposal(targetPath: string, proposal: RecertProposal, nowMs: number = Date.now()): void {
  atomicAppend(recertProposalsFile(targetPath, nowMs), JSON.stringify(proposal) + '\n');
}

export const RECERT_BATCH_SCHEMA_VERSION = 1;

export interface RecertBatchData {
  schemaVersion: number;
  generatedAtIso: string;
  recertEmailTo: string;
  batch: RecertifiableScenario[];
}

const DEFAULT_RECERT_BATCH_SIZE = 1;

// BL-223: recert_email_to in swarmforge.conf, mirroring BL-090's swarm_name
// convention (holisticProjections.ts's parseSwarmName/readSwarmName) - kept
// config-injected, not a second hardcode, so a later branded custom-domain
// swap (e.g. recert@inbound.musicalsifu.com) is a config change, never a
// code change. Defaults to the operator's Resend-managed receiving domain
// (no DNS/MX setup needed) - NEVER the reserved .invalid TLD, which can
// never resolve and made every phone recert email bounce (BL-223 root
// cause: pwa/app.js used to hardcode that placeholder directly).
const DEFAULT_RECERT_EMAIL_TO = 'recert@tolokarooo.resend.app';

export function parseRecertEmailTo(confContent: string): string {
  const match = confContent.match(/^\s*config\s+recert_email_to\s+(\S+)/m);
  return match ? match[1] : DEFAULT_RECERT_EMAIL_TO;
}

export function readRecertEmailTo(targetPath: string): string {
  try {
    return parseRecertEmailTo(fs.readFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), 'utf8'));
  } catch {
    return DEFAULT_RECERT_EMAIL_TO;
  }
}

// The one impure orchestrator generate-recert-batch.ts's CLI wraps (same
// split as docsTree.ts's computeDocsTree/buildDocsTree): resolves the
// current recertifiable pool from the docs tree and the durable
// last-reviewed store, then hands the already oldest-first-sorted batch to
// the published artifact - the PWA client stays a pure renderer of it,
// matching BL-117's own "no derivation logic in the PWA client" posture.
export function computeRecertBatch(
  targetPath: string,
  batchSize: number = DEFAULT_RECERT_BATCH_SIZE,
  nowMs: number = Date.now()
): RecertBatchData {
  const tree = computeDocsTree(targetPath, nowMs);
  const store = readRecertStore(targetPath);
  const pool = recertifiableScenariosFrom(tree.tickets);
  return {
    schemaVersion: RECERT_BATCH_SCHEMA_VERSION,
    generatedAtIso: new Date(nowMs).toISOString(),
    recertEmailTo: readRecertEmailTo(targetPath),
    batch: selectForRecertification(pool, store, batchSize),
  };
}
