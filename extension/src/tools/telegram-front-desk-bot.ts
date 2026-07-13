#!/usr/bin/env node
/**
 * BL-281: the Telegram Front Desk Bot - a thin adapter that is a CLIENT of
 * the bridge (bridgeServer.ts), never coupled to the Operator runtime
 * directly ("every hop is mediated by the bridge"). Owns everything
 * Telegram-specific: polling getUpdates, the topic<->SUP-### mapping, and
 * the principal-only inbound filter (BL-239/240's own posture, reused).
 * POSTs an already-resolved {subjectId, channel, text} to the bridge's
 * authed /telegram-inbound route (async - fires and moves on, never
 * RPC), and separately subscribes to the bridge's SSE stream for
 * telegram-reply events, posting each into its mapped topic.
 *
 * All per-update/per-reply DECISIONS live in telegramFrontDeskBotCore.ts
 * (pure/adapter-injected, unit-tested); this file is the thin,
 * untested-boundary process that wires the real network/fs adapters in
 * and runs forever - the same "testable core, thin live wrapper" split
 * launch_operator.sh/operator_runtime.bb already use.
 *
 * BL-294: a DM or an unmapped topic OPENS/adopts a SUP-### instead of
 * being dropped - id assignment stays with the support store
 * (support_thread.bb open, shelled out to below), never a second id
 * sequence in this file.
 *
 * BL-300: a THIRD, wall-clock loop (tickLoop) derives TaskStarted/
 * TaskCompleted events from the live backlog folders every
 * CONCIERGE_TICK_INTERVAL_MS and routes each into its BL-### Telegram
 * topic (creating/closing as BL-297/299 decide) - the runtime wiring the
 * rest of the Concierge epic's pure modules needed to stop being dark
 * features. Every decision/persistence lives in runConciergeTick
 * (adapter-injected, unit-tested); this loop only owns the timing.
 *
 * BL-302: the poll loop backs off (bounded, growing, reset on success) on
 * a failed cycle instead of hot-spinning, and escalates a visible warning
 * on sustained failure without ever giving up (runPollCycle owns this
 * decision). All three forever-loops now run inside runContainedLoop - a
 * fault in one is caught, logged, and the loop restarted, without ever
 * tearing down its siblings via a rejected Promise.all.
 *
 * Usage: node telegram-front-desk-bot.js <bridge-url> <target-path>
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   Telegram Bot API credentials
 *   TELEGRAM_PRINCIPAL_USER_ID             the one authorized sender
 *   BRIDGE_TOKEN                            bridge bearer token (read)
 *   BRIDGE_CONTROL_TOKEN                    bridge X-Control-Token (write)
 *   CONCIERGE_TICK_INTERVAL_MS              optional, defaults to 30000
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getTelegramUpdates, sendTelegramMessage, createForumTopic, closeForumTopic, TelegramUpdate, TelegramPostFn } from '../notify/telegramClient';
import { nextUpdateOffset } from '../notify/telegramInboundRelay';
import {
  PollAdapters,
  subjectForTopic,
  resolveReplyTopicId,
  relaySseReplies,
  parseNextSseRecord,
  DEFAULT_SUBJECT_KEY,
  runPollCycle,
  applyPollCycleResult,
  PollLoopState,
  runContainedLoop,
  PollBackoffConfig,
  ReplyRelayLoopState,
  computeReplyRelayCycleResult,
  applyReplyRelayCycleResult,
  decideEnsureOperatorTopicAction,
  OPERATOR_TOPIC_NAME,
  OPERATOR_SUBJECT_ID,
} from './telegramFrontDeskBotCore';
import { backlogForTopic } from '../concierge/topicRouter';
import { runConciergeTick, ConciergeTickAdapters, BacklogFoldersSnapshot, TickState } from '../concierge/conciergeTick';
import { reconcileTopicLifecycle, ReconcileAdapters } from '../concierge/topicReconciliation';
import { readBacklogFolders } from '../panel/backlogReader';
import { appendOperatorEvent } from '../bridge/operatorEventQueue';
import { appendMessage, readRecord } from '../concierge/blTopicStore';
import { computeRoleGateStatesLive, RoleGateState } from '../bridge/gateSnapshot';
import { computeCurrentHolders } from '../bridge/holisticProjections';
import { readRoleHoldingWindows, TicketHoldingWindow } from '../metrics/ticketHoldingWindows';
import { parseRolesTsv } from '../swarm/swarmState';
import { runCliMain } from './swarm-metrics';

const execFileAsync = promisify(execFile);

// Re-exported for backward compatibility - parseNextSseRecord's
// implementation lives in telegramFrontDeskBotCore.ts (the testable core),
// not this thin live wrapper.
export { parseNextSseRecord };

const POLL_TIMEOUT_SECONDS = 25;

function topicMapPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

// {topicId: subjectId} - bot-owned, machine-local (gitignored under
// .swarmforge/), never committed. topicId's string key is DEFAULT_SUBJECT_KEY
// for a DM (no real Telegram topic). Read on every update (no caching) so a
// mapping openSubjectAndRecord just wrote is visible to the very next poll.
function readTopicMap(targetPath: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(topicMapPath(targetPath), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

// BL-294: the write half of readTopicMap above - records a newly-opened
// subject's mapping so subsequent messages in the same context resolve via
// subjectForTopic instead of opening a second subject.
function writeTopicMap(targetPath: string, topicMap: Record<string, string>): void {
  fs.mkdirSync(path.dirname(topicMapPath(targetPath)), { recursive: true });
  fs.writeFileSync(topicMapPath(targetPath), JSON.stringify(topicMap));
}

// BL-298: BL-297's own backlogId->topicId map (topicRouter.ts's own
// BacklogTopicMap shape) - a SEPARATE, reverse-keyed file from
// readTopicMap's {topicId: subjectId} above, never a repurposing of it.
// Read-only here: this slice only consumes the mapping BL-297's own
// outbound routing writes, it never creates a BL-### topic itself.
function backlogTopicMapPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'backlog-topic-map.json');
}

function readBacklogTopicMap(targetPath: string): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(backlogTopicMapPath(targetPath), 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

// BL-300: the missing writer - modelled on writeTopicMap's own shape.
// recordTopicId (topicRouter.ts's own RouteAdapters field) is wired to
// this, so a topic created by the outbound tick becomes visible to
// BL-298's own inbound readBacklogTopicMap on the very next poll.
function writeBacklogTopicMap(targetPath: string, topicMap: Record<string, number>): void {
  fs.mkdirSync(path.dirname(backlogTopicMapPath(targetPath)), { recursive: true });
  fs.writeFileSync(backlogTopicMapPath(targetPath), JSON.stringify(topicMap));
}

// BL-300: the tick's own durable state (the prev/curr diff baseline +
// the DURABLE emitted-keys dedup set) - a restart must not lose either,
// or an already-routed event could fire again. Machine-local, gitignored
// under .swarmforge/, same posture as every other file in this directory.
function tickStatePath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'concierge-tick-state.json');
}

function readTickState(targetPath: string): TickState {
  try {
    return JSON.parse(fs.readFileSync(tickStatePath(targetPath), 'utf8')) as TickState;
  } catch {
    return { snapshot: null, emittedKeys: [] };
  }
}

function writeTickState(targetPath: string, state: TickState): void {
  fs.mkdirSync(path.dirname(tickStatePath(targetPath)), { recursive: true });
  fs.writeFileSync(tickStatePath(targetPath), JSON.stringify(state));
}

// BL-298: routes a reply as context for its backlog item's task via the
// SAME operator-event file appendOperatorEvent already writes
// TELEGRAM_TOPIC_MESSAGE (SUP-###) events into - a distinct event type
// carrying backlogId, so the two paths never collide. What the Operator
// does with this event is the Operator's own behavior (out of scope here).
export async function postOperatorContext(targetPath: string, backlogId: string, text: string): Promise<boolean> {
  appendOperatorEvent(targetPath, { type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId, text });
  appendMessage(targetPath, backlogId, { author: 'human', type: 'inbound', text });
  return true;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in the environment`);
  }
  return value;
}

async function postToBridge(bridgeUrl: string, controlToken: string, subjectId: string, text: string): Promise<boolean> {
  const res = await fetch(`${bridgeUrl}/telegram-inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${controlToken}`, 'x-control-token': controlToken },
    body: JSON.stringify({ subjectId, channel: 'telegram', text }),
  });
  return res.ok;
}

// BL-294: allocates a fresh SUP-### via the support store CLI (the
// authoritative id sequence - support_lib.bb's next-thread-id, never
// duplicated here) and durably records the given text as that subject's
// opening message in the SAME shared thread store supportThreadStore.ts
// reads (.swarmforge/support/threads/<id>.json) - so this call alone
// delivers the message; no separate postToBridge follow-up for it.
async function openSubject(targetPath: string, text: string): Promise<string> {
  const cli = path.join(targetPath, 'swarmforge', 'scripts', 'support_thread.bb');
  const { stdout } = await execFileAsync('bb', [cli, targetPath, 'open', '--channel', 'telegram', '--text', text]);
  const thread = JSON.parse(stdout) as { id: string };
  return thread.id;
}

function topicMapKey(topicId: number | undefined): string {
  return topicId === undefined ? DEFAULT_SUBJECT_KEY : String(topicId);
}

// BL-346: creates the standing "Operator" forum topic and binds it to the
// reserved OPERATOR_SUBJECT_ID in the SAME map subjectForTopic/
// topicForSubject already trust - BEFORE the poll loop ever starts, so no
// inbound message can reach this topic while it is still unbound (the
// auto-adopt trap the ticket calls out: an unbound topic would take the
// open-for-topic branch and mint a throwaway SUP-### instead). Idempotent
// across restarts: decideEnsureOperatorTopicAction finds the existing
// binding and this is a no-op. A failed create degrades quietly (logged,
// not thrown) - the rest of the bot (ordinary SUP-###/BL-### routing)
// must not go down over it, and the next restart retries since the map
// still lacks the binding.
export async function ensureOperatorTopic(targetPath: string, botToken: string, chatId: string, postFn?: TelegramPostFn): Promise<void> {
  const topicMap = readTopicMap(targetPath);
  if (decideEnsureOperatorTopicAction(topicMap).kind === 'reuse') {
    return;
  }
  const created = await createForumTopic(botToken, chatId, OPERATOR_TOPIC_NAME, postFn);
  if (!created.success || created.messageThreadId === undefined) {
    process.stderr.write(`ensureOperatorTopic: failed to create the Operator topic: ${created.error ?? 'no messageThreadId returned'}\n`);
    return;
  }
  topicMap[topicMapKey(created.messageThreadId)] = OPERATOR_SUBJECT_ID;
  writeTopicMap(targetPath, topicMap);
}

// BL-294: opens the subject, records the topicId(or DM default)->subjectId
// mapping, and notifies the Operator the SAME way an existing-subject post
// does (appendOperatorEvent - the bridge's own /telegram-inbound handler
// does this identically for a resolved subjectId; this is the open-path's
// equivalent, not a second notification mechanism).
async function openSubjectAndRecord(targetPath: string, topicId: number | undefined, text: string): Promise<string> {
  const subjectId = await openSubject(targetPath, text);
  const topicMap = readTopicMap(targetPath);
  topicMap[topicMapKey(topicId)] = subjectId;
  writeTopicMap(targetPath, topicMap);
  appendOperatorEvent(targetPath, { type: 'TELEGRAM_TOPIC_MESSAGE', subject: subjectId });
  return subjectId;
}

function buildPollAdapters(botToken: string, targetPath: string, bridgeUrl: string, controlToken: string): PollAdapters {
  return {
    getUpdates: (offset) => getTelegramUpdates(botToken, offset, POLL_TIMEOUT_SECONDS),
    postToBridge: (subjectId, text) => postToBridge(bridgeUrl, controlToken, subjectId, text),
    subjectForTopic: (topicId) => subjectForTopic(readTopicMap(targetPath), topicId),
    openSubjectAndRecord: (topicId, text) => openSubjectAndRecord(targetPath, topicId, text),
    backlogForTopic: (topicId) => backlogForTopic(readBacklogTopicMap(targetPath), topicId),
    postOperatorContext: (backlogId, text) => postOperatorContext(targetPath, backlogId, text),
    nextOffset: nextUpdateOffset,
  };
}

// BL-302: bounded, growing backoff on a failed poll cycle (reset to the
// floor on the next successful one), reusing telegramRetry.ts's own
// exponential-capped math via computePollBackoffMs. Escalates a VISIBLE
// warning after DEGRADED_THRESHOLD consecutive failures but keeps
// retrying forever at the capped cadence - a chat bot must self-recover
// when the network returns, never go permanently offline.
const POLL_BACKOFF_CONFIG = { backoffBaseMs: 2000, backoffMaxMs: 60_000, degradedThreshold: 5 };

// Polls forever, one batch at a time - every decision (post/open/route,
// AND now the backoff/warning decision) goes through runPollCycle
// (adapter-injected, unit-tested); this loop only owns the timing (the
// actual sleep call) and the stderr write for a degraded warning.
async function pollLoop(botToken: string, principalUserId: string, targetPath: string, bridgeUrl: string, controlToken: string): Promise<void> {
  const adapters = buildPollAdapters(botToken, targetPath, bridgeUrl, controlToken);
  let state: PollLoopState = { offset: 0, consecutiveFailures: 0 };
  for (;;) {
    const cycle = await runPollCycle(state, principalUserId, adapters, POLL_BACKOFF_CONFIG);
    state = cycle.state;
    await applyPollCycleResult(cycle, (message) => process.stderr.write(message), sleep);
  }
}

// BL-320: confirms one entry's id back to the bridge - the bridge only
// advances its persisted cursor on this, never on emit. A non-ok response
// is treated as a failed ack (thrown, not swallowed) so it flows through
// the SAME reconnect-with-backoff path as a dropped connection: the next
// attempt (this one or after a reconnect) replays/retries it rather than
// silently leaving the bridge's cursor stuck.
async function ackReply(bridgeUrl: string, controlToken: string, id: string): Promise<void> {
  const res = await fetch(`${bridgeUrl}/reply-ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${controlToken}`, 'x-control-token': controlToken },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    throw new Error(`reply-ack failed with status ${res.status}`);
  }
}

// One connection attempt: subscribes to the bridge's SSE stream and relays
// until the stream ends or the connection drops (readChunk rejects - the
// real stream reader is the only untested boundary here). Every decision
// (which records to relay, which topic, idempotency, acking) lives in
// relaySseReplies (adapter-injected, unit-tested), mirroring pollLoop/
// pollAndForward's own thin-wrapper/tested-core split above. seenIds is
// threaded in from subscribeReplies below so it survives a reconnect.
async function connectAndRelayReplies(
  botToken: string,
  chatId: string,
  targetPath: string,
  bridgeUrl: string,
  bridgeToken: string,
  controlToken: string,
  seenIds: Set<string>
): Promise<void> {
  const res = await fetch(`${bridgeUrl}/events`, { headers: { authorization: `Bearer ${bridgeToken}` } });
  if (!res.body) {
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  await relaySseReplies(
    '',
    {
      readChunk: async () => {
        const { done, value } = await reader.read();
        return { done, chunk: done ? '' : decoder.decode(value, { stream: true }) };
      },
      // BL-329: serialises this reply into the ticket's own durable record,
      // ONLY when topicId resolves back to an actual BL-### ticket - a
      // SUP-### thread reply has no backlogForTopic mapping and is
      // deliberately skipped (that channel has its own store, BL-329 is
      // BL-topics only).
      sendReply: (topicId, text) =>
        sendTelegramMessage(botToken, chatId, text, undefined, undefined, topicId).then(() => {
          const backlogId = backlogForTopic(readBacklogTopicMap(targetPath), topicId);
          if (backlogId) {
            appendMessage(targetPath, backlogId, { author: 'swarm', type: 'outbound', text });
          }
          return undefined;
        }),
      // BL-325: falls back to the backlog topic map so a reply whose
      // threadId names a BL-### item (operator-decide.js's approve relay,
      // invoked with backlogId as threadId) reaches that item's own topic
      // - the SAME resolver every SUP-### reply already went through.
      topicForSubject: (subjectId) => resolveReplyTopicId(readTopicMap(targetPath), readBacklogTopicMap(targetPath), subjectId),
      ackReply: (id) => ackReply(bridgeUrl, controlToken, id),
    },
    seenIds
  );
}

// BL-320: retry-forever with capped backoff around the SSE connection
// itself (reusing BL-302's own computePollBackoffMs/shouldRaiseDegraded
// Warning - the front-desk track's established resilience policy),
// layered UNDERNEATH runContainedLoop's flat 5s whole-loop restart net at
// the main() call site below. A dropped connection (undici "terminated")
// or a failed ack both surface as a rejection out of
// connectAndRelayReplies and are caught HERE, not left to propagate: the
// live failure this ticket exists for (subscribeReplies's own silent-stop
// gap, flagged as BL-302's explicit follow-up) is handled at the layer
// that can actually replay - the outer runContainedLoop restart alone
// would lose seenIds and read a fresh empty buffer with no memory of what
// was already relayed.
const REPLY_RECONNECT_BACKOFF_CONFIG: PollBackoffConfig = { backoffBaseMs: 2000, backoffMaxMs: 60_000, degradedThreshold: 5 };

// Split out of subscribeReplies below so its own for(;;) stays a bare
// two-statement loop (cleaner review: the inline try/catch here previously
// pushed subscribeReplies's own complexity/CRAP well over threshold at the
// near-zero coverage this live-network wrapper realistically gets - same
// "extract the branch, thin the loop" split as pollLoop/runPollCycle
// above). Returns undefined on success, the failure's message otherwise -
// connectAndRelayReplies runs until the connection drops or the stream
// ends, so a rejection here is always a real fault worth backing off for.
async function attemptReplyRelayConnection(
  botToken: string,
  chatId: string,
  targetPath: string,
  bridgeUrl: string,
  bridgeToken: string,
  controlToken: string,
  seenIds: Set<string>
): Promise<string | undefined> {
  try {
    await connectAndRelayReplies(botToken, chatId, targetPath, bridgeUrl, bridgeToken, controlToken, seenIds);
    return undefined;
  } catch (error) {
    return describeError(error);
  }
}

// Cleaner pass: the state-transition/backoff/warning decision (both the
// success-vs-failure branch AND the "stream ended cleanly" pause) lives in
// computeReplyRelayCycleResult/applyReplyRelayCycleResult
// (telegramFrontDeskBotCore.ts, unit-tested), mirroring pollLoop/
// runPollCycle/applyPollCycleResult's own "thin live loop, tested core"
// split above - this loop stays a bare for(;;) two-statement wrapper.
async function subscribeReplies(
  botToken: string,
  chatId: string,
  targetPath: string,
  bridgeUrl: string,
  bridgeToken: string,
  controlToken: string
): Promise<void> {
  const seenIds = new Set<string>();
  let state: ReplyRelayLoopState = { consecutiveFailures: 0 };
  for (;;) {
    const errorMessage = await attemptReplyRelayConnection(botToken, chatId, targetPath, bridgeUrl, bridgeToken, controlToken, seenIds);
    const cycle = computeReplyRelayCycleResult(state, errorMessage === undefined, REPLY_RECONNECT_BACKOFF_CONFIG);
    state = cycle.state;
    await applyReplyRelayCycleResult(cycle, errorMessage, (message) => process.stderr.write(message), sleep);
  }
}

// BL-300: readBacklogFolders returns the panel's own richer BacklogItem
// shape - narrowed to {id, title, notes?, firstAcceptanceStep?} here so
// conciergeTick.ts stays decoupled from panel/backlogReader.ts's type (the
// same "core stays narrow, live wrapper adapts the real type" split as
// every other adapter in this file). BL-322: notes/firstAcceptanceStep now
// pass through unnarrowed (topic-opening-summary-01's own two derived
// sources) instead of being dropped the way BL-301's gate snippet used to
// be before BL-325 fixed that same class of narrowing.
function toFoldersSnapshot(targetPath: string): BacklogFoldersSnapshot {
  const folders = readBacklogFolders(targetPath);
  const pick = (items: { id: string; title: string; notes?: string; firstAcceptanceStep?: string }[]) =>
    items.map((item) => ({ id: item.id, title: item.title, notes: item.notes, firstAcceptanceStep: item.firstAcceptanceStep }));
  return { active: pick(folders.active), paused: pick(folders.paused), done: pick(folders.done) };
}

// BL-301: resolveRoleWorktrees is file-local in bridge/bridgeState.ts -
// duplicated here rather than exported/imported, same "no shared lifecycle
// worth coupling" posture gateSnapshot.ts's own header already documents
// for this exact live-glue class of function.
export function resolveLiveRoles(targetPath: string): { role: string; worktreePath: string }[] {
  try {
    return parseRolesTsv(fs.readFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), 'utf8')).map((r) => ({
      role: r.role,
      worktreePath: r.worktreePath,
    }));
  } catch {
    return [];
  }
}

// BL-325: computeRoleGateStatesLive's RoleGateState.snippet (the gated
// role's own question text) now passes through into GateSignal instead of
// being narrowed away - BL-301 deferred this; discarding it here is exactly
// the "question thrown away" defect the ticket fixes.
function readGates(targetPath: string): { role: string; gated: boolean; snippet?: string }[] {
  const roles = resolveLiveRoles(targetPath).map((r) => r.role);
  return computeRoleGateStatesLive(targetPath, roles).map((g: RoleGateState) => ({ role: g.role, gated: g.gated, snippet: g.snippet }));
}

// BL-301: inverts computeCurrentHolders' ticketId->role into role->ticketId
// (a role holds exactly one ticket at a time in normal operation - an
// anomalous multi-hold picks one, never mis-tags a gate to the wrong
// BL-###; a gated role with no held ticket is simply absent here, and
// diffNeedsApproval already drops an untagged gate rather than guess).
// Exported (CLI main() thin-wrapper rule) so this is unit-tested in-process
// against a real roles.tsv + handoff fixture rather than only reachable
// through the live bot process.
export function readRoleTicket(targetPath: string): Record<string, string> {
  const roles = resolveLiveRoles(targetPath);
  const windowsByRole: Record<string, TicketHoldingWindow[]> = {};
  for (const role of roles) {
    windowsByRole[role.role] = readRoleHoldingWindows(role.worktreePath);
  }
  const roleTicket: Record<string, string> = {};
  for (const [ticketId, role] of computeCurrentHolders(windowsByRole)) {
    roleTicket[role] = ticketId;
  }
  return roleTicket;
}

function buildConciergeTickAdapters(targetPath: string, botToken: string, chatId: string): ConciergeTickAdapters {
  return {
    readFolders: () => toFoldersSnapshot(targetPath),
    readGates: () => readGates(targetPath),
    readRoleTicket: () => readRoleTicket(targetPath),
    readTickState: () => readTickState(targetPath),
    writeTickState: (state) => writeTickState(targetPath, state),
    routeAdapters: {
      getTopicMap: () => readBacklogTopicMap(targetPath),
      createTopic: async (name) => {
        const result = await createForumTopic(botToken, chatId, name);
        return { success: result.success, topicId: result.messageThreadId };
      },
      recordTopicId: (backlogId, topicId) => {
        const map = readBacklogTopicMap(targetPath);
        map[backlogId] = topicId;
        writeBacklogTopicMap(targetPath, map);
      },
      sendMessage: (topicId, text) => sendTelegramMessage(botToken, chatId, text, undefined, undefined, topicId).then((r) => r.success),
      closeTopic: (topicId) => closeForumTopic(botToken, chatId, topicId).then((r) => r.success),
      recordMessage: (backlogId, text) => {
        appendMessage(targetPath, backlogId, { author: 'swarm', type: 'outbound', text });
      },
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_CONCIERGE_TICK_INTERVAL_MS = 30_000;

// Exported (CLI main() thin-wrapper rule) so every branch - unset, a valid
// override, and an invalid/non-positive value falling back to the default
// - is unit-tested in-process rather than only coverage-invisible behind
// the live env-var read.
export function conciergeTickIntervalMs(rawEnv: string | undefined = process.env.CONCIERGE_TICK_INTERVAL_MS): number {
  const parsed = rawEnv ? Number(rawEnv) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONCIERGE_TICK_INTERVAL_MS;
}

// BL-300: the process's first wall-clock loop (pollLoop/subscribeReplies
// are both long-poll/SSE-driven) - derives TaskStarted/TaskCompleted from
// the live backlog folders and routes each via routeEvent, every
// intervalMs, forever. Every decision/persistence lives in
// runConciergeTick (adapter-injected, unit-tested); this loop only owns
// the timing.
// BL-330: the state-based safety net beneath the diff path above -
// isAlreadyReconciled is backed by BL-329's own durable record (a
// completion summary matching text already recorded means this ticket's
// topic was already brought to its completed state), never a second,
// parallel marker file.
function buildReconcileAdapters(targetPath: string, routeAdapters: ConciergeTickAdapters['routeAdapters']): ReconcileAdapters {
  return {
    getTopicMap: routeAdapters.getTopicMap,
    isAlreadyReconciled: (backlogId, summaryText) =>
      readRecord(targetPath, backlogId).messages.some((m) => m.type === 'outbound' && m.text === summaryText),
    routeAdapters,
  };
}

async function tickLoop(targetPath: string, botToken: string, chatId: string, intervalMs: number): Promise<void> {
  const adapters = buildConciergeTickAdapters(targetPath, botToken, chatId);
  const reconcileAdapters = buildReconcileAdapters(targetPath, adapters.routeAdapters);
  for (;;) {
    await runConciergeTick(adapters);
    await reconcileTopicLifecycle(adapters.readFolders().done, reconcileAdapters);
    await sleep(intervalMs);
  }
}

// BL-302: how long runContainedLoop waits before restarting a loop that
// just threw - deliberately separate from POLL_BACKOFF_CONFIG (that's the
// poll loop's OWN internal cycle-to-cycle pacing on a getUpdates failure,
// which never throws in the first place - callTelegramApi already catches
// network errors into {success:false}). This is the outer, whole-loop
// containment net for a genuinely unexpected fault.
const LOOP_RESTART_DELAY_MS = 5000;

// Shared by every catch site in this file that needs a human-readable
// message out of an unknown thrown value (a rejection is not guaranteed to
// be an Error instance) - was duplicated inline at logLoopFault and
// subscribeReplies below before this cleaner pass.
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logLoopFault(name: string, error: unknown): void {
  process.stderr.write(`front-desk bot: ${name} loop faulted (restarting): ${describeError(error)}\n`);
}

// Split out of main() so that function's own branch count stays low, same
// technique as every other CLI's parseArgs in this directory.
export function parseCliArgs(argv: string[]): { bridgeUrl: string; targetPath: string } | null {
  const [bridgeUrl, targetPath] = argv;
  return bridgeUrl && targetPath ? { bridgeUrl, targetPath } : null;
}

export async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write('Usage: telegram-front-desk-bot.js <bridge-url> <target-path>\n');
    process.exitCode = 1;
    return;
  }
  const { bridgeUrl, targetPath } = args;
  const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requiredEnv('TELEGRAM_CHAT_ID');
  const principalUserId = requiredEnv('TELEGRAM_PRINCIPAL_USER_ID');
  const bridgeToken = requiredEnv('BRIDGE_TOKEN');
  const controlToken = requiredEnv('BRIDGE_CONTROL_TOKEN');

  // BL-346: bind the standing Operator topic BEFORE any loop starts
  // polling, so no inbound message can ever reach it while it is still
  // unbound (see ensureOperatorTopic's own comment for the auto-adopt
  // trap this ordering avoids). A failed create here must never block the
  // rest of the bot's ordinary routing from coming up.
  await ensureOperatorTopic(targetPath, botToken, chatId);

  // BL-302 LOOP ISOLATION: each of the three forever-loops runs inside its
  // own runContainedLoop - a fault (thrown exception) in one is caught,
  // logged, and RESTARTED after a brief delay, without ever rejecting the
  // Promise.all itself. A bare Promise.all of the raw loop promises would
  // let any one loop's fault reject the whole thing, and runCliMain's own
  // reportFatalAndExit would then process.exit(1) - tearing down the other
  // two loops even though nothing was wrong with them.
  await Promise.all([
    runContainedLoop('poll', () => pollLoop(botToken, principalUserId, targetPath, bridgeUrl, controlToken), sleep, LOOP_RESTART_DELAY_MS, logLoopFault),
    runContainedLoop(
      'reply-relay',
      () => subscribeReplies(botToken, chatId, targetPath, bridgeUrl, bridgeToken, controlToken),
      sleep,
      LOOP_RESTART_DELAY_MS,
      logLoopFault
    ),
    runContainedLoop('concierge-tick', () => tickLoop(targetPath, botToken, chatId, conciergeTickIntervalMs()), sleep, LOOP_RESTART_DELAY_MS, logLoopFault),
  ]);
}

if (require.main === module) {
  runCliMain(main);
}
