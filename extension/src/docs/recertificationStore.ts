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
import { parseConfigValue, readConfigValue } from '../util/swarmforgeConfig';
import { computeDocsTree } from './docsTree';
import {
  confirmScenario,
  emptyRecertStore,
  RecertifiableScenario,
  recertifiableScenariosFrom,
  RecertProposal,
  RecertStoreData,
  selectForRecertification,
  toRecertProposal,
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
  return parseConfigValue(confContent, 'recert_email_to') ?? DEFAULT_RECERT_EMAIL_TO;
}

export function readRecertEmailTo(targetPath: string): string {
  return readConfigValue(targetPath, 'recert_email_to') ?? DEFAULT_RECERT_EMAIL_TO;
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

// BL-450: the standing Recert Telegram topic's own read/write surface - the
// FIRST live callers of confirmScenario/writeRecertStore/appendRecertProposal
// (recertification.ts had zero production callers before this ticket, per
// its own header comment). "Currently up for recertification" is never a
// second posted-scenario marker of its own to keep in sync with the chat -
// it is always whatever computeRecertBatch(targetPath, 1, ...) would select
// right now, the SAME oldest-first computation the Telegram posting side
// (conciergeTick.ts) already drives its own edit-in-place message from, so
// the reply-verification side and the posting side can never drift apart.
export function currentRecertScenarioId(targetPath: string, nowMs: number = Date.now()): string | undefined {
  return computeRecertBatch(targetPath, 1, nowMs).batch[0]?.id;
}

// A reply naming any OTHER scenario id - a stale one already validated away,
// or an outright fabricated/ghost one - is never applied (front-desk-
// operator-fabricates-backlog-state memory); the caller surfaces it instead.
export function isScenarioUpForRecert(targetPath: string, scenarioId: string, nowMs: number = Date.now()): boolean {
  return currentRecertScenarioId(targetPath, nowMs) === scenarioId;
}

// recert-telegram-03: validate applies DIRECTLY (a last-reviewed timestamp
// bump, low risk) - reuses confirmScenario/writeRecertStore exactly as the
// (still-dark, pre-this-ticket) inbound-email path would have. Returns
// false, writing nothing, when the scenario is not the one currently up for
// recert.
export function recordRecertValidate(targetPath: string, scenarioId: string, nowMs: number = Date.now()): boolean {
  if (!isScenarioUpForRecert(targetPath, scenarioId, nowMs)) {
    return false;
  }
  const nowIso = new Date(nowMs).toISOString();
  writeRecertStore(targetPath, confirmScenario(readRecertStore(targetPath), scenarioId, nowIso));
  return true;
}

// recert-telegram-04: amend never edits the .feature file directly - it
// queues an "update" proposal (toRecertProposal/appendRecertProposal, the
// SAME durable queue the still-unwired bridge-recert-proposals.ts CLI reads)
// for the specifier's own review. Returns false, queuing nothing, when the
// scenario is not currently up for recert.
export function queueRecertAmendProposal(targetPath: string, scenarioId: string, newText: string, nowMs: number = Date.now()): boolean {
  if (!isScenarioUpForRecert(targetPath, scenarioId, nowMs)) {
    return false;
  }
  appendRecertProposal(targetPath, toRecertProposal({ scenarioId, outcome: 'update', newText }, new Date(nowMs).toISOString()), nowMs);
  return true;
}

// recert-telegram-06: a CONFIRMED delete (the confirmation gate itself lives
// one layer up, in telegramFrontDeskBotCore.ts's delivery adapters - this
// function is only ever called once that gate has already resolved) queues
// a "delete" proposal the same way amend queues an "update" one. Returns
// false, queuing nothing, when the scenario is no longer the one currently
// up for recert (e.g. it was validated away between the delete request and
// its confirmation).
export function queueRecertDeleteProposal(targetPath: string, scenarioId: string, nowMs: number = Date.now()): boolean {
  if (!isScenarioUpForRecert(targetPath, scenarioId, nowMs)) {
    return false;
  }
  appendRecertProposal(targetPath, toRecertProposal({ scenarioId, outcome: 'delete' }, new Date(nowMs).toISOString()), nowMs);
  return true;
}
