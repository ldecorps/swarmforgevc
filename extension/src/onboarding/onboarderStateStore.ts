// BL-590 slice 1: durable per-target persistence for the onboarding
// onboarder's prerequisites state machine (onboarderState.ts).
// Follows readRelayOffset/writeRelayOffset's own discipline (BL-381,
// relay-onboarding-negotiation-telegram.ts): try/catch to a safe default on
// read, atomicWrite (temp-file + rename) on write - never a bare
// fs.writeFileSync a crash could leave half-written.
//
// Lives under the SWARM repo's own .swarmforge/, not the target's - unlike
// the negotiation relay (BL-381), the prerequisites phase never clones the
// target, so there is no target-repo .swarmforge/ to write into yet. One
// file per target (keyed by a slug of its repo URL) so concurrent
// onboardings (slice 3) stay distinct.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { OnboarderState } from './onboarderState';

function onboardingStateDir(swarmRepoRoot: string): string {
  return path.join(swarmRepoRoot, '.swarmforge', 'onboarding');
}

// A filesystem-safe, human-recognizable key for a target repo URL - strips
// the scheme and replaces anything that isn't alphanumeric/-/. with '-', so
// two distinct URLs never collide and the resulting filename stays legible
// for operator debugging (e.g. github.com/org/repo).
export function slugifyTargetRepoUrl(targetRepoUrl: string): string {
  const withoutScheme = targetRepoUrl.replace(/^[a-z]+:\/\//i, '').replace(/\.git$/i, '');
  const slug = withoutScheme.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'target';
}

function onboardingStatePath(swarmRepoRoot: string, targetRepoUrl: string): string {
  return path.join(onboardingStateDir(swarmRepoRoot), `${slugifyTargetRepoUrl(targetRepoUrl)}.json`);
}

// BL-590 architect bounce #2 (defect 1 residual, 2026-07-25): the guard used
// to be a single last-processed-updateId scalar, on the false premise that
// only the newest id can ever be redelivered - offsetAfterDelivery falsifies
// that (a stuck head-of-line delivery parks the offset while later, already-
// processed updates in the same batch stay unconfirmed, so THEY are what get
// redelivered). The guard is now a per-target SET, one entry per processed
// updateId, wide enough to recognise any of them - not just the latest.
//
// Each entry also records the message that was computed AND whether it was
// actually delivered. This lets a redelivered update that was already
// APPLIED to the state machine but never successfully SENT (a transient
// send failure) retry just the send - never re-run the state machine
// against text that no longer matches the step the state has since moved
// past. Mirrors openSubjectAndRecord's (BL-389) "store the resultant value,
// short-circuit on it" shape, adapted with a delivered flag since this
// guard's resultant value is an outbound send, not a return value.
export interface ProcessedOnboardingUpdate {
  readonly message: string;
  readonly delivered: boolean;
}

interface OnboardingStateEnvelope {
  readonly state: OnboarderState;
  readonly processedUpdates: Readonly<Record<string, ProcessedOnboardingUpdate>>;
}

function isEnvelope(parsed: unknown): parsed is OnboardingStateEnvelope {
  return typeof parsed === 'object' && parsed !== null && 'state' in parsed && 'processedUpdates' in parsed;
}

function readEnvelope(swarmRepoRoot: string, targetRepoUrl: string): OnboardingStateEnvelope | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(onboardingStatePath(swarmRepoRoot, targetRepoUrl), 'utf8'));
    if (isEnvelope(parsed)) {
      return parsed;
    }
    // A state file written before this envelope existed (a bare
    // OnboarderState) - keep its progress, start its
    // processed-update history empty rather than fail to read it at all.
    return { state: parsed as OnboarderState, processedUpdates: {} };
  } catch {
    return undefined;
  }
}

function writeEnvelope(swarmRepoRoot: string, envelope: OnboardingStateEnvelope): void {
  atomicWrite(onboardingStatePath(swarmRepoRoot, envelope.state.targetRepoUrl), JSON.stringify(envelope, null, 2));
}

export function readOnboarderState(swarmRepoRoot: string, targetRepoUrl: string): OnboarderState | undefined {
  return readEnvelope(swarmRepoRoot, targetRepoUrl)?.state;
}

export function writeOnboarderState(swarmRepoRoot: string, state: OnboarderState): void {
  const existing = readEnvelope(swarmRepoRoot, state.targetRepoUrl);
  writeEnvelope(swarmRepoRoot, { state, processedUpdates: existing?.processedUpdates ?? {} });
}

// Every per-target state file currently on disk - the routing layer uses
// this to find which target (if any) a plain-text reply in the Onboarding
// topic applies to, since slice 1's single-topic-reused design (per the
// specifier's design note) means the topic itself carries no target
// identity of its own.
export function listOnboarderStates(swarmRepoRoot: string): OnboarderState[] {
  return listOnboardingEnvelopes(swarmRepoRoot).map((envelope) => envelope.state);
}

function listOnboardingEnvelopes(swarmRepoRoot: string): OnboardingStateEnvelope[] {
  const dir = onboardingStateDir(swarmRepoRoot);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith('.json') && entry !== 'last-processed-update.json')
    .map((entry) => {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
        return isEnvelope(parsed) ? parsed : { state: parsed as OnboarderState, processedUpdates: {} };
      } catch {
        return undefined;
      }
    })
    .filter((envelope): envelope is OnboardingStateEnvelope => envelope !== undefined);
}

export interface ProcessedOnboardingUpdateLookup {
  readonly targetRepoUrl: string;
  readonly record: ProcessedOnboardingUpdate;
}

// Scans every persisted target's processed-update set - the guard runs
// BEFORE handleOnboardingMessage decides which target (if any) a plain-text
// reply belongs to, so which target owns a given updateId is not yet known
// at call time.
export function findProcessedOnboardingUpdate(swarmRepoRoot: string, updateId: number): ProcessedOnboardingUpdateLookup | undefined {
  const key = String(updateId);
  for (const envelope of listOnboardingEnvelopes(swarmRepoRoot)) {
    const record = envelope.processedUpdates[key];
    if (record) {
      return { targetRepoUrl: envelope.state.targetRepoUrl, record };
    }
  }
  return undefined;
}

export function hasProcessedOnboardingUpdateId(swarmRepoRoot: string, updateId: number): boolean {
  return findProcessedOnboardingUpdate(swarmRepoRoot, updateId) !== undefined;
}

// Arms the guard atomically WITH the state write (one atomicWrite, one
// file) - not after the send - so the state advance and the processed-id
// marker can never come apart. Recorded with delivered:false; the send is
// attempted only after this returns, and is retried (never the state
// machine) on every redelivery until it is marked delivered.
export function writeOnboardingStateAndMarkUpdateProcessed(
  swarmRepoRoot: string,
  state: OnboarderState,
  updateId: number,
  message: string
): void {
  const existing = readEnvelope(swarmRepoRoot, state.targetRepoUrl);
  const processedUpdates = { ...(existing?.processedUpdates ?? {}), [String(updateId)]: { message, delivered: false } };
  writeEnvelope(swarmRepoRoot, { state, processedUpdates });
}

// Only called once the outbound send actually succeeds - never on a failed
// send, so a redelivery of a still-undelivered update keeps retrying the
// send (via findProcessedOnboardingUpdate's stored message) instead of
// silently counting a lost message as done.
export function markOnboardingUpdateDelivered(swarmRepoRoot: string, targetRepoUrl: string, updateId: number): void {
  const existing = readEnvelope(swarmRepoRoot, targetRepoUrl);
  const record = existing?.processedUpdates[String(updateId)];
  if (!existing || !record) {
    return;
  }
  writeEnvelope(swarmRepoRoot, {
    state: existing.state,
    processedUpdates: { ...existing.processedUpdates, [String(updateId)]: { ...record, delivered: true } },
  });
}
