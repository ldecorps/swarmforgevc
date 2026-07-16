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
 *   OPENAI_API_KEY                          BL-426 slice 1: optional - when
 *                                            absent, voice I/O is simply not
 *                                            wired (the coordinator's
 *                                            Operator topic stays text-only,
 *                                            the exact pre-BL-426 behavior)
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  getTelegramUpdates,
  sendTelegramMessage,
  sendTelegramPoll,
  createForumTopic,
  closeForumTopic,
  deleteForumTopic,
  editForumTopic,
  editForumTopicWithRateLimitRetry,
  getForumTopicIconStickers,
  answerCallbackQuery,
  editMessageText,
  deleteMessage,
  getFile,
  downloadTelegramFile,
  sendVoiceNote,
  TelegramUpdate,
  TelegramPostFn,
} from '../notify/telegramClient';
import {
  PollAdapters,
  subjectForTopic,
  resolveReplyDelivery,
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
  decideStandingTopicTitleSync,
  decideEnsureRoleTopicAction,
  OPERATOR_TOPIC_NAME,
  OPERATOR_SUBJECT_ID,
  decideEnsureApprovalsTopicAction,
  APPROVALS_TOPIC_NAME,
  APPROVALS_SUBJECT_ID,
  decideEnsureRecertTopicAction,
  RECERT_TOPIC_NAME,
  RECERT_SUBJECT_ID,
  decideEnsureAgentQuestionsTopicAction,
  AGENT_QUESTIONS_TOPIC_NAME,
  AGENT_QUESTIONS_SUBJECT_ID,
  SttResult,
  TtsResult,
  ReplyRelayAdapters,
} from './telegramFrontDeskBotCore';
import { backlogForTopic } from '../concierge/topicRouter';
import { recordApprovalReply, recordRejectionReply } from '../concierge/pendingApprovalReply';
import {
  computeRecertBatch,
  isScenarioUpForRecert,
  recordRecertValidate,
  queueRecertAmendProposal,
  queueRecertDeleteProposal,
} from '../docs/recertificationStore';
import { readBacklogTopicMap, writeBacklogTopicMap, dropBacklogTopicMapping } from '../concierge/backlogTopicMapStore';
import { ALL_SWARM_ROLES, readRoleTopicMap, writeRoleTopicMap } from '../concierge/roleTopicMapStore';
import { runConciergeTick, ConciergeTickAdapters, BacklogFoldersSnapshot, TickState } from '../concierge/conciergeTick';
import { reconcileTopicLifecycle, ReconcileAdapters } from '../concierge/topicReconciliation';
import { sweepTopicDeletions, TopicDeletionAdapters, topicRetentionWindowMs } from '../concierge/topicDeletion';
import { readBacklogFolders } from '../panel/backlogReader';
import { appendOperatorEvent } from '../bridge/operatorEventQueue';
import { appendMessage, readRecord, hasCompletionRecord, isRecordCommitted, hasUpdateId, readSwarmIconId, recordSwarmIconId, lastActivityMs } from '../concierge/blTopicStore';
import { IconStickerLookup, StandingTopicTarget } from '../concierge/topicIcon';
import { computeRoleGateStatesLive, RoleGateState } from '../bridge/gateSnapshot';
import { computeCurrentHolders } from '../bridge/holisticProjections';
import { readRoleHoldingWindows, TicketHoldingWindow } from '../metrics/ticketHoldingWindows';
import { parseRolesTsv, readTicketStageMap, invertTicketStageToRoleHeldTickets } from '../swarm/swarmState';
import { wrapPipelineBoardHtml } from '../concierge/pipelineBoard';
import { readTmuxSocket, readSwarmRoles, paneTarget, getPaneBaseIndex, capturePane, sendKeys } from '../swarm/tmuxClient';
import { sendInstructionVerified } from '../swarm/verifiedInject';
import { sleepSync } from '../swarm/sleepSync';
import { runCliMain } from './swarm-metrics';
import { atomicWrite } from '../util/atomicWrite';

const execFileAsync = promisify(execFile);

// Re-exported for backward compatibility - parseNextSseRecord's
// implementation lives in telegramFrontDeskBotCore.ts (the testable core),
// not this thin live wrapper.
export { parseNextSseRecord };

const POLL_TIMEOUT_SECONDS = 25;

function topicMapPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

// BL-370: front_desk_supervisor.bb reads this SAME file/shape (a plain
// {lastHeartbeatMs} JSON) to decide whether the poll loop is still
// listening - "is there a pid" is not proof of that, only a completed
// poll cycle is.
function frontDeskPollHeartbeatPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'front-desk-poll-heartbeat.json');
}

function writeFrontDeskPollHeartbeat(targetPath: string): void {
  atomicWrite(frontDeskPollHeartbeatPath(targetPath), JSON.stringify({ lastHeartbeatMs: Date.now() }));
}

// {topicId: subjectId} - bot-owned, machine-local (gitignored under
// .swarmforge/), never committed. topicId's string key is DEFAULT_SUBJECT_KEY
// for a DM (no real Telegram topic). Read on every update (no caching) so a
// mapping openSubjectAndRecord just wrote is visible to the very next poll.
// Exported (BL-353) so a second CLI (notify-dead-letters.ts) can resolve
// BL-346's reserved Operator topic id without a second, drifting
// implementation of this file's own path/shape.
export function readTopicMap(targetPath: string): Record<string, string> {
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

// BL-410: {backlogId: 'reject' | 'amend'} - which ticket(s) are awaiting a
// follow-up reason/note after a Reject/Amend button tap. Bot-owned,
// machine-local (gitignored under .swarmforge/, same posture as
// telegram-topic-map.json above), never committed - a restart with a
// pending tap simply forgets it (the human just taps again), same
// "no durability promise beyond one process lifetime" posture as
// concierge-tick-state.json.
function pendingButtonActionsPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-pending-button-actions.json');
}

function readPendingButtonActions(targetPath: string): Record<string, 'reject' | 'amend'> {
  try {
    return JSON.parse(fs.readFileSync(pendingButtonActionsPath(targetPath), 'utf8')) as Record<string, 'reject' | 'amend'>;
  } catch {
    return {};
  }
}

function writePendingButtonActions(targetPath: string, actions: Record<string, 'reject' | 'amend'>): void {
  fs.mkdirSync(path.dirname(pendingButtonActionsPath(targetPath)), { recursive: true });
  fs.writeFileSync(pendingButtonActionsPath(targetPath), JSON.stringify(actions));
}

// BL-450: {scenarioId} | {} - which scenario's delete is currently awaiting
// an explicit in-chat confirmation (BL-150 recert-04), if any. Bot-owned,
// machine-local, gitignored, same "no durability promise beyond one process
// lifetime" posture as telegram-pending-button-actions.json above - a
// restart mid-confirmation simply forgets it and the human just replies
// "delete <id>" again.
function pendingRecertDeletePath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-pending-recert-delete.json');
}

function readPendingRecertDelete(targetPath: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(pendingRecertDeletePath(targetPath), 'utf8')) as { scenarioId?: string };
    return parsed.scenarioId;
  } catch {
    return undefined;
  }
}

function writePendingRecertDelete(targetPath: string, scenarioId: string | undefined): void {
  fs.mkdirSync(path.dirname(pendingRecertDeletePath(targetPath)), { recursive: true });
  fs.writeFileSync(pendingRecertDeletePath(targetPath), JSON.stringify(scenarioId ? { scenarioId } : {}));
}

// BL-426 slice 1: {subjectId: true} - which subject's NEXT reply should be
// synthesized back to a voice note (markVoiceOriginatedTurn/
// isVoiceOriginatedTurn/clearVoiceOriginatedTurn, telegramFrontDeskBotCore.ts).
// Same "bot-owned, machine-local, gitignored, no durability promise beyond
// one process lifetime" posture as telegram-pending-button-actions.json
// above - a restart mid-turn simply drops back to text-only for that one
// reply, never a correctness issue.
function voiceTurnsPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-voice-turns.json');
}

function readVoiceTurns(targetPath: string): Record<string, boolean> {
  try {
    return JSON.parse(fs.readFileSync(voiceTurnsPath(targetPath), 'utf8')) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeVoiceTurns(targetPath: string, turns: Record<string, boolean>): void {
  atomicWrite(voiceTurnsPath(targetPath), JSON.stringify(turns));
}

// BL-298/300/331/332: readBacklogTopicMap/writeBacklogTopicMap/
// dropBacklogTopicMapping (backlogId->topicId, topicRouter.ts's own
// BacklogTopicMap shape - a SEPARATE, reverse-keyed file from
// readTopicMap's {topicId: subjectId} above) now live in
// concierge/backlogTopicMapStore.ts, shared with recreate-bl-topic.ts,
// which had accreted an identical copy (jscpd-flagged clone).

// BL-300: the tick's own durable state (the prev/curr diff baseline +
// the DURABLE emitted-keys dedup set) - a restart must not lose either,
// or an already-routed event could fire again. Machine-local, gitignored
// under .swarmforge/, same posture as every other file in this directory.
function tickStatePath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'concierge-tick-state.json');
}

// Exported (mirrors readTopicMap above) so the standing-topic icon backfill
// (backfill-standing-topic-icons.ts) can seed standingIconSeenIds ahead of
// the live tick's own first run, without a second reader/writer of this
// same file.
export function readTickState(targetPath: string): TickState {
  try {
    return JSON.parse(fs.readFileSync(tickStatePath(targetPath), 'utf8')) as TickState;
  } catch {
    return { snapshot: null, emittedKeys: [] };
  }
}

export function writeTickState(targetPath: string, state: TickState): void {
  fs.mkdirSync(path.dirname(tickStatePath(targetPath)), { recursive: true });
  fs.writeFileSync(tickStatePath(targetPath), JSON.stringify(state));
}

// BL-298: routes a reply as context for its backlog item's task via the
// SAME operator-event file appendOperatorEvent already writes
// TELEGRAM_TOPIC_MESSAGE (SUP-###) events into - a distinct event type
// carrying backlogId, so the two paths never collide. What the Operator
// does with this event is the Operator's own behavior (out of scope here).
// BL-389: gated on hasUpdateId - the parked-offset incident replayed the
// same update every poll and THIS was the call that flooded (209 commits,
// the same two messages answered again each time), because it was the one
// adapter with no idempotency key at all (postToBridge already had one via
// BL-369; this one never did). A redelivered updateId is a known no-op:
// skip both the operator event and the topic-record append entirely,
// never merely re-appending a message already on record.
export async function postOperatorContext(targetPath: string, backlogId: string, text: string, updateId: number): Promise<boolean> {
  if (hasUpdateId(readRecord(targetPath, backlogId), updateId)) {
    return true;
  }
  appendOperatorEvent(targetPath, { type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId, text });
  appendMessage(targetPath, backlogId, { author: 'human', type: 'inbound', text, updateId });
  return true;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in the environment`);
  }
  return value;
}

// BL-369 (bug #2 + "the bridge cannot be reached"): a network-level failure
// (bridge unreachable, connection reset) makes fetch() itself REJECT, not
// merely return a non-ok response - previously uncaught here, which would
// have propagated out of processUpdate and aborted the WHOLE poll cycle's
// remaining updates uncontrolled. Caught and turned into a plain `false`,
// matching every other adapter in this codebase's own "never throw, return
// a result" convention (telegramClient.ts's callTelegramApi is the
// established shape). updateId rides the body as the bridge's own
// idempotency key for a redelivered message (scenario 03).
async function postToBridge(bridgeUrl: string, controlToken: string, subjectId: string, text: string, updateId: number): Promise<boolean> {
  try {
    const res = await fetch(`${bridgeUrl}/telegram-inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${controlToken}`, 'x-control-token': controlToken },
      body: JSON.stringify({ subjectId, channel: 'telegram', text, updateId }),
    });
    return res.ok;
  } catch {
    return false;
  }
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

// BL-389 rework (architect bounce): openSubjectAndRecord was the one
// adapter BL-389's own idempotency sweep left unprotected - a redelivered
// update (offset never advanced, e.g. the process crashes between
// openSubject minting a fresh SUP-### and this function persisting the
// topicId mapping) would mint a SECOND, duplicate SUP-### for the same
// original conversation opener. Shares the SAME topicMap file/write as
// topicMapKey above (never a second parallel store) with a distinct key
// namespace, so the update-id check and the topicId mapping land in ONE
// atomic write together.
function updateOpenKey(updateId: number): string {
  return `update:${updateId}`;
}

// BL-453: {subjectId: title} - the last title this process is known to have
// SET on a standing topic, so a rebrand's own rename (unlike creation,
// which always gets the current OPERATOR_TOPIC_NAME for free) is applied
// exactly once rather than on every restart. Bot-owned, machine-local
// (gitignored under .swarmforge/), same posture as every other file in
// this directory - the same "never re-edit an already-correct topic" gate
// topicTitleSync.ts's own lastAnnouncedBucket already established for
// per-ticket topics, generalized here to any standing (non-ticket) topic.
function standingTopicTitlesPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-standing-topic-titles.json');
}

function readStandingTopicTitles(targetPath: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(standingTopicTitlesPath(targetPath), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStandingTopicTitles(targetPath: string, titles: Record<string, string>): void {
  atomicWrite(standingTopicTitlesPath(targetPath), JSON.stringify(titles));
}

// BL-453: renames an already-bound standing topic to desiredTitle when (and
// only when) the recorded title actually differs (decideStandingTopicTitleSync) -
// the rebrand's own "single-topic single edit, never every tick" constraint.
// A failed edit is logged and left unrecorded, so the NEXT call (next
// restart) retries rather than silently giving up forever.
async function syncStandingTopicTitleIfNeeded(
  targetPath: string,
  subjectId: string,
  topicId: number,
  desiredTitle: string,
  botToken: string,
  chatId: string,
  postFn?: TelegramPostFn
): Promise<void> {
  const titles = readStandingTopicTitles(targetPath);
  if (decideStandingTopicTitleSync(titles[subjectId], desiredTitle) === 'unchanged') {
    return;
  }
  const result = await editForumTopic(botToken, chatId, topicId, { name: desiredTitle }, postFn);
  if (!result.success) {
    process.stderr.write(`syncStandingTopicTitleIfNeeded: failed to rename "${subjectId}" to "${desiredTitle}": ${result.error}\n`);
    return;
  }
  writeStandingTopicTitles(targetPath, { ...titles, [subjectId]: desiredTitle });
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
// BL-358: now RETURNS the resolved topicId (undefined only on a failed
// create) so topicRouter.ts's RouteAdapters.ensureOperatorTopic can wire
// straight to this - the SAME reuse-or-create decision the pre-poll-loop
// call site below already relied on, its return value simply unused there
// (a void call site is unaffected by a function starting to return
// something).
export async function ensureOperatorTopic(targetPath: string, botToken: string, chatId: string, postFn?: TelegramPostFn): Promise<number | undefined> {
  const topicMap = readTopicMap(targetPath);
  const decision = decideEnsureOperatorTopicAction(topicMap);
  if (decision.kind === 'reuse') {
    // BL-453: the Operator->Concierge rebrand's live-topic rename - a fresh
    // create (below) always gets the current name for free, but an already-
    // bound topic (every pre-BL-453 install) needs its title actually
    // edited to catch up.
    await syncStandingTopicTitleIfNeeded(targetPath, OPERATOR_SUBJECT_ID, decision.topicId, OPERATOR_TOPIC_NAME, botToken, chatId, postFn);
    return decision.topicId;
  }
  const created = await createForumTopic(botToken, chatId, OPERATOR_TOPIC_NAME, postFn);
  if (!created.success || created.messageThreadId === undefined) {
    process.stderr.write(`ensureOperatorTopic: failed to create the Operator topic: ${created.error ?? 'no messageThreadId returned'}\n`);
    return undefined;
  }
  topicMap[topicMapKey(created.messageThreadId)] = OPERATOR_SUBJECT_ID;
  writeTopicMap(targetPath, topicMap);
  // Records the title it was JUST created with, so a later restart's
  // reuse-branch check above never fires an unnecessary rename edit.
  writeStandingTopicTitles(targetPath, { ...readStandingTopicTitles(targetPath), [OPERATOR_SUBJECT_ID]: OPERATOR_TOPIC_NAME });
  return created.messageThreadId;
}

// BL-434: the Approvals-topic twin of ensureOperatorTopic above - identical
// reuse-or-create/idempotent-across-restarts shape, sharing the SAME
// {topicId: subjectId} map, just keyed by its own reserved subject id.
// Called once BEFORE the poll loop starts (same ordering rationale as
// ensureOperatorTopic) and wired straight into topicRouter.ts's
// RouteAdapters.ensureApprovalsTopic and approvalsRosterSync.ts's own
// ApprovalsRosterAdapters.ensureApprovalsTopic - both resolve to this ONE
// standing topic, never a second Approvals-topic notion.
export async function ensureApprovalsTopic(targetPath: string, botToken: string, chatId: string, postFn?: TelegramPostFn): Promise<number | undefined> {
  const topicMap = readTopicMap(targetPath);
  const decision = decideEnsureApprovalsTopicAction(topicMap);
  if (decision.kind === 'reuse') {
    return decision.topicId;
  }
  const created = await createForumTopic(botToken, chatId, APPROVALS_TOPIC_NAME, postFn);
  if (!created.success || created.messageThreadId === undefined) {
    process.stderr.write(`ensureApprovalsTopic: failed to create the Approvals topic: ${created.error ?? 'no messageThreadId returned'}\n`);
    return undefined;
  }
  topicMap[topicMapKey(created.messageThreadId)] = APPROVALS_SUBJECT_ID;
  writeTopicMap(targetPath, topicMap);
  return created.messageThreadId;
}

// BL-450: the Recert-topic twin of ensureApprovalsTopic above - identical
// reuse-or-create/idempotent-across-restarts shape, sharing the SAME
// {topicId: subjectId} map, just keyed by its own reserved subject id.
// Called once BEFORE the poll loop starts (same ordering rationale as
// ensureOperatorTopic) and wired straight into recertPostingSync.ts's
// RecertPostingAdapters.ensureRecertTopic - the ONE standing topic every
// posted scenario and every reply routes through, never a second notion.
export async function ensureRecertTopic(targetPath: string, botToken: string, chatId: string, postFn?: TelegramPostFn): Promise<number | undefined> {
  const topicMap = readTopicMap(targetPath);
  const decision = decideEnsureRecertTopicAction(topicMap);
  if (decision.kind === 'reuse') {
    return decision.topicId;
  }
  const created = await createForumTopic(botToken, chatId, RECERT_TOPIC_NAME, postFn);
  if (!created.success || created.messageThreadId === undefined) {
    process.stderr.write(`ensureRecertTopic: failed to create the Recert topic: ${created.error ?? 'no messageThreadId returned'}\n`);
    return undefined;
  }
  topicMap[topicMapKey(created.messageThreadId)] = RECERT_SUBJECT_ID;
  writeTopicMap(targetPath, topicMap);
  return created.messageThreadId;
}

// BL-466: the Agent Questions-topic twin of ensureRecertTopic above -
// identical reuse-or-create/idempotent-across-restarts shape, sharing the
// SAME {topicId: subjectId} map. Called once BEFORE the poll loop starts
// (same ordering rationale as ensureOperatorTopic/ensureApprovalsTopic/
// ensureRecertTopic) - every agent-asked question (poll or plain-message
// fallback) and every reply to one routes through this ONE standing topic,
// never resolved per-subject the way an ordinary SUP-### reply is.
export async function ensureAgentQuestionsTopic(targetPath: string, botToken: string, chatId: string, postFn?: TelegramPostFn): Promise<number | undefined> {
  const topicMap = readTopicMap(targetPath);
  const decision = decideEnsureAgentQuestionsTopicAction(topicMap);
  if (decision.kind === 'reuse') {
    return decision.topicId;
  }
  const created = await createForumTopic(botToken, chatId, AGENT_QUESTIONS_TOPIC_NAME, postFn);
  if (!created.success || created.messageThreadId === undefined) {
    process.stderr.write(`ensureAgentQuestionsTopic: failed to create the Agent Questions topic: ${created.error ?? 'no messageThreadId returned'}\n`);
    return undefined;
  }
  topicMap[topicMapKey(created.messageThreadId)] = AGENT_QUESTIONS_SUBJECT_ID;
  writeTopicMap(targetPath, topicMap);
  return created.messageThreadId;
}

// BL-466: {pollId: {threadId, options}} - the poll id -> SUP-### thread
// mapping sendTelegramPoll's own send-time result needs to survive until a
// later poll_answer arrives (which carries no thread/topic info at all - see
// resolvePollThread/PollAdapters in telegramFrontDeskBotCore.ts). Bot-owned,
// machine-local (gitignored under .swarmforge/), same posture as every other
// file in this directory - and the SOLE writer/reader pair for this mapping
// (operator_runtime.bb never touches it), so there is no cross-process write
// race the way a shared Babashka/TS file would risk.
export function pollMapPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-poll-map.json');
}

export type PollMap = Record<string, { threadId: string; options: string[] }>;

// Hardener (BL-466): exported so a wiring test can prove this NEW on-disk
// read/write is load-bearing with a real fixture file, rather than only
// being exercised indirectly through buildPollAdapters/connectAndRelayReplies
// (both module-private) - the same "a new on-disk input needs a fixture
// proving the read is load-bearing" discipline this file's own engineering
// article names.
export function readPollMap(targetPath: string): PollMap {
  try {
    return JSON.parse(fs.readFileSync(pollMapPath(targetPath), 'utf8')) as PollMap;
  } catch {
    return {};
  }
}

export function writePollMap(targetPath: string, map: PollMap): void {
  atomicWrite(pollMapPath(targetPath), JSON.stringify(map));
}

// BL-466: read-only from this side - operator_runtime.bb/operator_ask.bb own
// writing awaiting-answer.json exclusively; this never writes it, so there is
// no cross-process write race the way a shared read-modify-write would risk.
// Used only to resolve "which SUP-### thread is the CURRENTLY pending agent
// question on" for an in-topic plain-message reply (BL-306's own "one
// pending question at a time" MVP constraint means this is never ambiguous).
// Hardener: exported for the same fixture-proof reason as readPollMap above.
export function readAwaitingAnswer(targetPath: string): { threadId?: string } | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(targetPath, '.swarmforge', 'operator', 'awaiting-answer.json'), 'utf8')) as {
      thread_id?: string;
    };
    return { threadId: parsed.thread_id };
  } catch {
    return undefined;
  }
}

// BL-425 slice 1 (cleaner): one role's own provision decision + effect,
// split out of ensureRoleTopics below so that function's own loop stays a
// thin sequencer and its branch count stays at or below the CRAP threshold -
// the same "extract so branch count stays low" reasoning this file already
// applies throughout (e.g. deliverOperatorContext/checkUpdateEligibility in
// telegramFrontDeskBotCore.ts). Mutates topicMap in place (the same object
// ensureRoleTopics holds) and returns whether it gained a new binding, so
// the caller writes the map to disk only once, after the whole batch, iff
// ANY role actually changed.
async function provisionRoleTopic(
  topicMap: Record<string, number>,
  role: string,
  botToken: string,
  chatId: string,
  postFn?: TelegramPostFn
): Promise<boolean> {
  const decision = decideEnsureRoleTopicAction(topicMap, role);
  if (decision.kind === 'reuse') {
    return false;
  }
  const created = await createForumTopic(botToken, chatId, role, postFn);
  if (!created.success || created.messageThreadId === undefined) {
    process.stderr.write(`ensureRoleTopics: failed to create the "${role}" topic: ${created.error ?? 'no messageThreadId returned'}\n`);
    return false;
  }
  topicMap[role] = created.messageThreadId;
  return true;
}

// BL-425 slice 1: creates each swarm role's own standing forum topic (named
// for the role) and binds it in role-topic-map.json, mirroring
// ensureOperatorTopic's reuse-or-create/idempotent-across-restarts shape
// above. Called once, BEFORE the poll loop starts (same ordering rationale
// as ensureOperatorTopic: no inbound message can reach an unbound role
// topic and be misrouted while it is still unbound). A single role's
// failed create is logged and skipped - it never blocks provisioning the
// remaining roles or the rest of the bot from coming up.
export async function ensureRoleTopics(
  targetPath: string,
  botToken: string,
  chatId: string,
  roles: readonly string[] = ALL_SWARM_ROLES,
  postFn?: TelegramPostFn
): Promise<void> {
  const topicMap = readRoleTopicMap(targetPath);
  let changed = false;
  for (const role of roles) {
    if (await provisionRoleTopic(topicMap, role, botToken, chatId, postFn)) {
      changed = true;
    }
  }
  if (changed) {
    writeRoleTopicMap(targetPath, topicMap);
  }
}

// BL-425 slice 1: resolves role R's live tmux pane target on the SWARM's own
// socket (.swarmforge/tmux-socket) - never the restricted front-desk
// operator's own socket (BL-334) - mirroring extension.ts's own inline
// paneTargetFor pattern (readTmuxSocket + readSwarmRoles(...).find +
// paneTarget), the identical seam the daily-briefing/idle-clear nudges
// already inject through. undefined when the swarm isn't up or the role
// has no live session, so a redirect against a not-yet-running swarm
// degrades to a logged no-op instead of throwing.
export function resolveRolePaneTarget(targetPath: string, role: string): { socketPath: string; target: string } | undefined {
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return undefined;
  }
  const roleEntry = readSwarmRoles(targetPath).find((r) => r.role === role);
  if (!roleEntry) {
    return undefined;
  }
  return { socketPath, target: paneTarget(roleEntry.session, roleEntry.displayName, getPaneBaseIndex(socketPath)) };
}

// BL-425 slice 1: REDIRECT execution - an authorised, topic-scoped steering
// message is injected into role R's live pane as a VERIFIED, INTERRUPTING
// nudge (sendInstructionVerified, never a bare unverified Enter - BL-152),
// the same seam extension.ts's daily-briefing/idle-clear nudges already
// inject through. A failed resolve/delivery is logged and swallowed - never
// thrown - matching this file's own established "a live-network/pane
// adapter never throws out of the poll cycle" convention (postToBridge,
// answerCallbackQueryQuietly above).
export async function redirectToRole(targetPath: string, role: string, text: string): Promise<void> {
  const resolved = resolveRolePaneTarget(targetPath, role);
  if (!resolved) {
    process.stderr.write(`redirectToRole: no live pane resolved for role "${role}" - is the swarm running?\n`);
    return;
  }
  const { socketPath, target } = resolved;
  const result = sendInstructionVerified(
    {
      capturePane: () => {
        const captured = capturePane(socketPath, target);
        return captured.exitCode === 0 ? captured.stdout : '';
      },
      sendLiteral: (literalText: string) => sendKeys(socketPath, target, literalText, true).exitCode === 0,
      sendEnter: () => {
        sendKeys(socketPath, target, 'Enter');
      },
      wait: sleepSync,
    },
    text
  );
  if (result.status !== 'delivered') {
    process.stderr.write(`redirectToRole: failed to deliver redirect to "${role}": ${result.reason ?? 'unknown'}\n`);
  }
}

// BL-294: opens the subject, records the topicId(or DM default)->subjectId
// mapping, and notifies the Operator the SAME way an existing-subject post
// does (appendOperatorEvent - the bridge's own /telegram-inbound handler
// does this identically for a resolved subjectId; this is the open-path's
// equivalent, not a second notification mechanism).
// BL-389 rework: gated on updateOpenKey FIRST - a redelivered update whose
// prior attempt already minted a subject returns that SAME subjectId
// without ever calling openSubject (and therefore never externally
// minting a second SUP-###) or re-notifying the Operator a second time.
export async function openSubjectAndRecord(targetPath: string, topicId: number | undefined, text: string, updateId: number): Promise<string> {
  const already = readTopicMap(targetPath)[updateOpenKey(updateId)];
  if (already !== undefined) {
    return already;
  }
  const subjectId = await openSubject(targetPath, text);
  const topicMap = readTopicMap(targetPath);
  topicMap[topicMapKey(topicId)] = subjectId;
  topicMap[updateOpenKey(updateId)] = subjectId;
  writeTopicMap(targetPath, topicMap);
  appendOperatorEvent(targetPath, { type: 'TELEGRAM_TOPIC_MESSAGE', subject: subjectId });
  return subjectId;
}

// BL-410: same never-throw posture as postToBridge above (a network-level
// failure must never abort the rest of the poll cycle) - a failed answer
// just leaves the human's spinner spinning a little longer; the next tap
// (or this same one, on a future retry path) can still succeed.
async function answerCallbackQueryQuietly(botToken: string, callbackQueryId: string): Promise<void> {
  try {
    await answerCallbackQuery(botToken, callbackQueryId);
  } catch {
    // swallowed - see comment above.
  }
}

// ── BL-426 slice 1: OpenAI STT/TTS - the human-approved provider choice ──

const OPENAI_STT_MODEL = 'whisper-1';
const OPENAI_TTS_MODEL = 'tts-1';
const OPENAI_TTS_VOICE = 'alloy';

type VoiceAudioResolution = { kind: 'ok'; bytes: Buffer } | { kind: 'transient-failure' } | { kind: 'unprocessable' };

// Resolves a voice note's file_id to its downloaded audio bytes (Telegram's
// own two-step getFile -> plain GET, telegramClient.ts). Split out of
// transcribeVoiceNote below to keep that function's own branch count at or
// below the project's CRAP threshold (same "extract so branch count stays
// low" reasoning telegramFrontDeskBotCore.ts already applies throughout) -
// this half owns the Telegram-side transient-vs-unprocessable distinction
// (an empty download is structurally unprocessable, never retryable), the
// other half owns OpenAI's.
async function resolveVoiceAudio(botToken: string, fileId: string): Promise<VoiceAudioResolution> {
  const fileResult = await getFile(botToken, fileId);
  if (!fileResult.success || !fileResult.filePath) {
    return { kind: 'transient-failure' };
  }
  const download = await downloadTelegramFile(botToken, fileResult.filePath);
  if (!download.success || !download.bytes) {
    return { kind: 'transient-failure' };
  }
  if (download.bytes.length === 0) {
    return { kind: 'unprocessable' };
  }
  return { kind: 'ok', bytes: download.bytes };
}

// Classifies OpenAI's transcription response into the same
// transient-vs-unprocessable distinction resolveVoiceAudio applies to the
// Telegram side - split out for the same CRAP-budget reason. A 4xx means
// OpenAI looked at the file and rejected it (bad/undecodable audio) -
// terminal, never retryable. A 5xx/other is a provider-side failure that
// may succeed on retry. A 2xx with no transcript text is also terminal -
// nothing to retry into a different result.
function classifyTranscriptionResponse(status: number, ok: boolean, text: string | undefined): SttResult {
  if (!ok) {
    return status >= 400 && status < 500 ? { kind: 'unprocessable' } : { kind: 'transient-failure' };
  }
  return text ? { kind: 'ok', transcript: text } : { kind: 'unprocessable' };
}

// Downloads the voice note's audio and sends it to OpenAI's transcription
// endpoint. Distinguishes a TRANSIENT failure (Telegram/network/OpenAI 5xx
// or timeout - retryable, must NOT drop) from a STRUCTURALLY
// un-processable file (empty download, or OpenAI's own 4xx rejecting the
// audio as undecodable - a deliberate, terminal drop) per the ticket's own
// failure posture and the engineering article's deliberate-drop-vs-failure
// rule - collapsing these into one outcome is exactly the mistake BL-389
// had to fix for ordinary drops elsewhere in this file.
export async function transcribeVoiceNote(botToken: string, openaiApiKey: string, fileId: string): Promise<SttResult> {
  const audio = await resolveVoiceAudio(botToken, fileId);
  if (audio.kind !== 'ok') {
    return audio;
  }
  try {
    const form = new FormData();
    form.append('file', new Blob([audio.bytes]), 'voice.oga');
    form.append('model', OPENAI_STT_MODEL);
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${openaiApiKey}` },
      body: form,
    });
    const json = res.ok ? ((await res.json()) as { text?: string }) : undefined;
    return classifyTranscriptionResponse(res.status, res.ok, json?.text);
  } catch {
    return { kind: 'transient-failure' };
  }
}

// Synthesizes the coordinator's text reply to OGG/Opus audio via OpenAI's
// TTS endpoint. A failure here is NOT retried (deliverReply's own
// synthesizeVoiceReplyIfNeeded already degrades gracefully to the
// text-only reply already sent - see telegramFrontDeskBotCore.ts) - unlike
// STT, a missed voice-out enrichment never loses the answer itself.
export async function synthesizeVoiceReply(openaiApiKey: string, text: string): Promise<TtsResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${openaiApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_TTS_MODEL, voice: OPENAI_TTS_VOICE, input: text, response_format: 'opus' }),
    });
    if (!res.ok) {
      return { kind: 'failure' };
    }
    return { kind: 'ok', audio: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return { kind: 'failure' };
  }
}

function buildPollAdapters(
  botToken: string,
  targetPath: string,
  bridgeUrl: string,
  controlToken: string,
  chatId: string,
  openaiApiKey: string | undefined
): PollAdapters {
  return {
    chatId,
    getUpdates: (offset) => getTelegramUpdates(botToken, offset, POLL_TIMEOUT_SECONDS),
    postToBridge: (subjectId, text, updateId) => postToBridge(bridgeUrl, controlToken, subjectId, text, updateId),
    subjectForTopic: (topicId) => subjectForTopic(readTopicMap(targetPath), topicId),
    openSubjectAndRecord: (topicId, text, updateId) => openSubjectAndRecord(targetPath, topicId, text, updateId),
    backlogForTopic: (topicId) => backlogForTopic(readBacklogTopicMap(targetPath), topicId),
    postOperatorContext: (backlogId, text, updateId) => postOperatorContext(targetPath, backlogId, text, updateId),
    recordApprovalReply: (backlogId) => Promise.resolve(recordApprovalReply(targetPath, backlogId)),
    recordRejectionReply: (backlogId, reason) => Promise.resolve(recordRejectionReply(targetPath, backlogId, reason)),
    notifyApprovalsTopic: (topicId, text) => sendTelegramMessage(botToken, chatId, text, undefined, undefined, topicId).then((r) => r.success),
    // BL-450: recertificationStore.ts's own read-check-write functions -
    // the FIRST live callers of confirmScenario/writeRecertStore/
    // appendRecertProposal (recertification.ts had zero production callers
    // before this ticket).
    isScenarioUpForRecert: (scenarioId) => Promise.resolve(isScenarioUpForRecert(targetPath, scenarioId)),
    recordRecertValidate: (scenarioId) => Promise.resolve(recordRecertValidate(targetPath, scenarioId)),
    queueRecertAmendProposal: (scenarioId, newText) => Promise.resolve(queueRecertAmendProposal(targetPath, scenarioId, newText)),
    queueRecertDeleteProposal: (scenarioId) => Promise.resolve(queueRecertDeleteProposal(targetPath, scenarioId)),
    getPendingRecertDelete: () => Promise.resolve(readPendingRecertDelete(targetPath)),
    setPendingRecertDelete: (scenarioId) => {
      writePendingRecertDelete(targetPath, scenarioId);
      return Promise.resolve();
    },
    clearPendingRecertDelete: () => {
      writePendingRecertDelete(targetPath, undefined);
      return Promise.resolve();
    },
    notifyRecertTopic: (topicId, text) => sendTelegramMessage(botToken, chatId, text, undefined, undefined, topicId).then((r) => r.success),
    getPendingButtonAction: (backlogId) => Promise.resolve(readPendingButtonActions(targetPath)[backlogId]),
    // BL-426 slice 1: absent (openaiApiKey unset) means "voice not wired" -
    // the exact pre-BL-426 behavior, same optional-adapter convention as
    // BL-410/BL-425 above.
    ...(openaiApiKey
      ? {
          transcribeVoice: (fileId: string) => transcribeVoiceNote(botToken, openaiApiKey, fileId),
          markVoiceOriginatedTurn: (subjectId: string) => {
            const turns = readVoiceTurns(targetPath);
            turns[subjectId] = true;
            writeVoiceTurns(targetPath, turns);
            return Promise.resolve();
          },
        }
      : {}),
    clearPendingButtonAction: (backlogId) => {
      const actions = readPendingButtonActions(targetPath);
      delete actions[backlogId];
      writePendingButtonActions(targetPath, actions);
      return Promise.resolve();
    },
    setPendingButtonAction: (backlogId, kind) => {
      const actions = readPendingButtonActions(targetPath);
      actions[backlogId] = kind;
      writePendingButtonActions(targetPath, actions);
      return Promise.resolve();
    },
    answerCallbackQuery: (callbackQueryId) => answerCallbackQueryQuietly(botToken, callbackQueryId),
    readRoleTopicMap: () => readRoleTopicMap(targetPath),
    redirectToRole: (role, text) => redirectToRole(targetPath, role, text),
    agentQuestionsTopicId: () => ensureAgentQuestionsTopic(targetPath, botToken, chatId),
    getPendingAgentQuestionThread: () => Promise.resolve(readAwaitingAnswer(targetPath)?.threadId),
    resolvePollThread: (pollId) => Promise.resolve(readPollMap(targetPath)[pollId]),
  };
}

// BL-302: bounded, growing backoff on a failed poll cycle (reset to the
// floor on the next successful one), reusing telegramRetry.ts's own
// exponential-capped math via computePollBackoffMs. Escalates a VISIBLE
// warning after DEGRADED_THRESHOLD consecutive failures but keeps
// retrying forever at the capped cadence - a chat bot must self-recover
// when the network returns, never go permanently offline.
// BL-369: stuckRetryLimit is measured in CYCLES, not attempts-with-backoff -
// each poll cycle is itself a full retry of the still-undelivered update
// (its offset never advanced), paced by the long-poll's own cadence.
const POLL_BACKOFF_CONFIG = { backoffBaseMs: 2000, backoffMaxMs: 60_000, degradedThreshold: 5, stuckRetryLimit: 5 };

// BL-369 (scenario 05): "the failure is escalated to the human" - sent
// DIRECTLY via Telegram (never through the bridge, which is presumptively
// the broken half when this fires) straight to the main chat, since the
// stuck update's own topic/subject may not even be resolvable yet (that
// resolution is exactly what keeps failing).
async function escalateStuckDelivery(botToken: string, chatId: string): Promise<void> {
  await sendTelegramMessage(
    botToken,
    chatId,
    "front-desk bot: a message could not be delivered after repeated attempts (the bridge may be unreachable). It has NOT been dropped - delivery will resume automatically once the underlying issue clears."
  );
}

// Polls forever, one batch at a time - every decision (post/open/route,
// AND now the backoff/warning/escalation decision) goes through
// runPollCycle (adapter-injected, unit-tested); this loop only owns the
// timing (the actual sleep call), the stderr write for a degraded
// warning, and (BL-370) the poll-heartbeat write - written on every
// completed cycle, success or handled failure alike.
async function pollLoop(
  botToken: string,
  principalUserId: string,
  targetPath: string,
  bridgeUrl: string,
  controlToken: string,
  chatId: string,
  openaiApiKey: string | undefined
): Promise<void> {
  const adapters = buildPollAdapters(botToken, targetPath, bridgeUrl, controlToken, chatId, openaiApiKey);
  let state: PollLoopState = { offset: 0, consecutiveFailures: 0, stuckAttempts: 0 };
  for (;;) {
    const cycle = await runPollCycle(state, principalUserId, adapters, POLL_BACKOFF_CONFIG);
    state = cycle.state;
    await applyPollCycleResult(
      cycle,
      (message) => process.stderr.write(message),
      sleep,
      () => escalateStuckDelivery(botToken, chatId),
      () => writeFrontDeskPollHeartbeat(targetPath)
    );
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
type VoiceReplyAdapters = Partial<Pick<ReplyRelayAdapters, 'isVoiceOriginatedTurn' | 'clearVoiceOriginatedTurn' | 'synthesizeVoice' | 'sendVoice'>>;

// BL-426 slice 1: absent (openaiApiKey unset) means "voice not wired" - the
// exact pre-BL-426 text-only behavior, same optional-adapter convention
// buildPollAdapters above uses. Split out of connectAndRelayReplies below to
// keep that function's own branch/statement count at or below the project's
// CRAP threshold (same "extract so branch count stays low" reasoning
// telegramFrontDeskBotCore.ts already applies throughout).
function buildVoiceReplyAdapters(openaiApiKey: string | undefined, botToken: string, chatId: string, targetPath: string): VoiceReplyAdapters {
  return openaiApiKey
    ? {
        isVoiceOriginatedTurn: (threadId: string) => Promise.resolve(readVoiceTurns(targetPath)[threadId] === true),
        clearVoiceOriginatedTurn: (threadId: string) => {
          const turns = readVoiceTurns(targetPath);
          delete turns[threadId];
          writeVoiceTurns(targetPath, turns);
          return Promise.resolve();
        },
        synthesizeVoice: (text: string) => synthesizeVoiceReply(openaiApiKey, text),
        sendVoice: (topicId: number | undefined, audio: Buffer) => sendVoiceNote(botToken, chatId, audio, topicId).then(() => undefined),
      }
    : {};
}

async function connectAndRelayReplies(
  botToken: string,
  chatId: string,
  targetPath: string,
  bridgeUrl: string,
  bridgeToken: string,
  controlToken: string,
  seenIds: Set<string>,
  openaiApiKey: string | undefined
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
      // BL-440: retractsPendingQuestion (set by operator-decide.ts's
      // runApprove on a successful gate answer, threaded here through the
      // reply-outbox/SSE relay) rides straight onto this SAME append - the
      // real production write of that field, never a second synthetic
      // message unconnected to an actual send.
      sendReply: (topicId, text, retractsPendingQuestion) =>
        sendTelegramMessage(botToken, chatId, text, undefined, undefined, topicId).then(() => {
          const backlogId = backlogForTopic(readBacklogTopicMap(targetPath), topicId);
          if (backlogId) {
            appendMessage(targetPath, backlogId, { author: 'swarm', type: 'outbound', text, retractsPendingQuestion });
          }
          return undefined;
        }),
      // BL-355: falls back to the backlog topic map so a reply whose
      // threadId names a BL-### item (operator-decide.js's approve relay,
      // invoked with backlogId as threadId) reaches that item's own topic
      // - the SAME resolver every SUP-### reply already went through -
      // and additionally decides whether General needs its own copy or
      // pointer (resolveReplyTopicId's own bare-topic-id resolution is
      // unchanged and still exported for any other caller).
      resolveDelivery: (subjectId) => resolveReplyDelivery(readTopicMap(targetPath), readBacklogTopicMap(targetPath), subjectId),
      ackReply: (id) => ackReply(bridgeUrl, controlToken, id),
      // BL-466: sendPoll/recordPollMapping/agentQuestionsTopicId - the
      // outbound half of the agent-question round trip (deliverAgentQuestion,
      // telegramFrontDeskBotCore.ts). agentQuestionsTopicId reuses the SAME
      // ensureAgentQuestionsTopic the inbound side (buildPollAdapters above)
      // and main()'s own pre-loop binding call use - never a second lookup.
      sendPoll: (topicId, question, options) => sendTelegramPoll(botToken, chatId, question, options, topicId).then((r) => ({ pollId: r.pollId })),
      recordPollMapping: (pollId, threadId, options) => {
        const map = readPollMap(targetPath);
        map[pollId] = { threadId, options };
        writePollMap(targetPath, map);
        return Promise.resolve();
      },
      agentQuestionsTopicId: () => ensureAgentQuestionsTopic(targetPath, botToken, chatId),
      ...buildVoiceReplyAdapters(openaiApiKey, botToken, chatId, targetPath),
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
// stuckRetryLimit is unused here (only runPollCycle's own stuck-delivery
// tracking reads it) - present only because PollBackoffConfig is shared
// between the two loop shapes; this loop has no analogous "stuck on one
// message" concept.
const REPLY_RECONNECT_BACKOFF_CONFIG: PollBackoffConfig = { backoffBaseMs: 2000, backoffMaxMs: 60_000, degradedThreshold: 5, stuckRetryLimit: 5 };

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
  seenIds: Set<string>,
  openaiApiKey: string | undefined
): Promise<string | undefined> {
  try {
    await connectAndRelayReplies(botToken, chatId, targetPath, bridgeUrl, bridgeToken, controlToken, seenIds, openaiApiKey);
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
  controlToken: string,
  openaiApiKey: string | undefined
): Promise<void> {
  const seenIds = new Set<string>();
  let state: ReplyRelayLoopState = { consecutiveFailures: 0 };
  for (;;) {
    const errorMessage = await attemptReplyRelayConnection(botToken, chatId, targetPath, bridgeUrl, bridgeToken, controlToken, seenIds, openaiApiKey);
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
//
// BL-357/BL-341: humanApproval and epic now pass through too - both were
// previously dropped here exactly the same way notes/firstAcceptanceStep
// used to be, which would have left pendingApprovalFor/epicForBacklogId
// correct in conciergeTick.ts but permanently DARK against the real live
// backlog (unit tests alone never caught it, since they inject
// BacklogFolderItem fixtures directly rather than going through this
// narrowing).
// BL-341: type/remainingSlices now pass through too, alongside
// humanApproval/epic (BL-357/BL-341) - all previously dropped here exactly
// the way notes/firstAcceptanceStep used to be, which would leave
// epicDefinitionsFor correct in conciergeTick.ts but permanently DARK
// against the real live backlog (unit tests alone never caught the earlier
// two, since they inject BacklogFolderItem fixtures directly rather than
// going through this narrowing).
export function toFoldersSnapshot(targetPath: string): BacklogFoldersSnapshot {
  const folders = readBacklogFolders(targetPath);
  const pick = (
    items: {
      id: string;
      title: string;
      notes?: string;
      firstAcceptanceStep?: string;
      humanApproval?: 'pending' | 'approved';
      epic?: string;
      type?: string;
      remainingSlices?: string[];
    }[]
  ) =>
    items.map((item) => ({
      id: item.id,
      title: item.title,
      notes: item.notes,
      firstAcceptanceStep: item.firstAcceptanceStep,
      humanApproval: item.humanApproval,
      epic: item.epic,
      type: item.type,
      remainingSlices: item.remainingSlices,
    }));
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

// BL-342: Telegram's own valid icon set (getForumTopicIconStickers) rarely
// changes and a tick can fire the icon sync several times in one pass
// (several tickets transitioning at once) - fetched once per process and
// reused, rather than a fresh live call per topic. A restart naturally
// refreshes it; no TTL needed for a set this stable.
let cachedIconStickers: IconStickerLookup[] | undefined;

export async function iconStickersOnce(botToken: string, postFn?: TelegramPostFn): Promise<IconStickerLookup[]> {
  if (cachedIconStickers === undefined) {
    const result = await getForumTopicIconStickers(botToken, postFn);
    cachedIconStickers = result.success ? result.stickers : [];
  }
  return cachedIconStickers;
}

// Test-only: the module-level cache above is deliberate (BL-342 comment
// above) but means a unit test exercising both the miss and hit branches
// must be able to reset it between cases, rather than depending on test
// file load order to observe an unset cache.
export function __resetIconStickersCacheForTest(): void {
  cachedIconStickers = undefined;
}

// BL-418: classifies the front-desk bot's OWN {topicId: subjectId} map
// (readTopicMap, above - never backlogTopicMap, which is ticket topics
// only) into the standing-topic targets conciergeTick.ts's icon sync wants:
// the one Operator topic, plus every currently-open support subject's own
// topic. A key that is not a real numeric topic id - DEFAULT_SUBJECT_KEY
// (a DM/General binding, no real Telegram topic to iconize) or an
// `update:<id>` idempotency-guard key (openSubjectAndRecord's own, sharing
// this same map/file rather than a second store) - is skipped by the
// Number.isFinite check alone, with no separate name-list of keys to keep
// in sync.
// BL-434: the Operator/Approvals reserved subjects each get their own
// iconKey; every other bound subject (an ordinary SUP-### support thread)
// falls back to 'support/intake' - split out so standingTopicTargets' own
// loop body stays a flat push, the same "extract so branch count/nesting
// stays low" convention this file already applies throughout.
function standingTopicIconKeyFor(subjectId: string): StandingTopicTarget['iconKey'] {
  if (subjectId === OPERATOR_SUBJECT_ID) {
    return 'operator';
  }
  if (subjectId === APPROVALS_SUBJECT_ID) {
    return 'approvals';
  }
  if (subjectId === RECERT_SUBJECT_ID) {
    return 'recert';
  }
  return 'support/intake';
}

export function standingTopicTargets(targetPath: string): StandingTopicTarget[] {
  const topicMap = readTopicMap(targetPath);
  const targets: StandingTopicTarget[] = [];
  for (const [key, subjectId] of Object.entries(topicMap)) {
    const topicId = Number(key);
    if (!Number.isFinite(topicId)) {
      continue;
    }
    targets.push({ id: subjectId, topicId, iconKey: standingTopicIconKeyFor(subjectId) });
  }
  return targets;
}

// Shared postMessage/editMessage pair for a plain-text edit-in-place standing
// topic (ApprovalsRosterAdapters, RecertPostingAdapters) - both boil down to
// the same sendTelegramMessage/editMessageText calls, only the topic-specific
// ensure* differs.
function plainTextEditInPlaceAdapters(
  botToken: string,
  chatId: string
): { postMessage: (topicId: number, text: string) => Promise<number | undefined>; editMessage: (topicId: number, messageId: number, text: string) => Promise<boolean> } {
  return {
    postMessage: (topicId, text) => sendTelegramMessage(botToken, chatId, text, undefined, undefined, topicId).then((r) => (r.success ? r.messageId : undefined)),
    editMessage: (topicId, messageId, text) => editMessageText(botToken, chatId, messageId, text).then((r) => r.success),
  };
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
      sendMessage: (topicId, text, buttons) => sendTelegramMessage(botToken, chatId, text, undefined, undefined, topicId, buttons).then((r) => r.success),
      closeTopic: (topicId) => closeForumTopic(botToken, chatId, topicId).then((r) => r.success),
      recordMessage: (backlogId, text) => {
        appendMessage(targetPath, backlogId, { author: 'swarm', type: 'outbound', text });
      },
      ensureOperatorTopic: () => ensureOperatorTopic(targetPath, botToken, chatId),
      ensureApprovalsTopic: () => ensureApprovalsTopic(targetPath, botToken, chatId),
    },
    iconAdapters: {
      getIconStickers: () => iconStickersOnce(botToken),
      setTopicIcon: (topicId, iconCustomEmojiId) => editForumTopic(botToken, chatId, topicId, { iconCustomEmojiId }).then((r) => r.success),
      readSwarmIconId: (ticketId) => readSwarmIconId(targetPath, ticketId),
      recordSwarmIconId: (ticketId, iconId) => recordSwarmIconId(targetPath, ticketId, iconId),
    },
    readStandingTopics: () => standingTopicTargets(targetPath),
    // BL-414: last activity comes from the SAME per-ticket record
    // appendMessage/blTopicStore.ts already maintains - never a second
    // store. setTopicTitle edits only the name, leaving the icon field
    // untouched.
    // BL-414 hardener bounce: a bare, non-retrying edit here reproduces
    // BL-342's "19 of 26 succeeded, 7 silently dropped" rate-limit storm on
    // THIS sync's own first-tick mass fan-out (every existing topic's
    // bucket transitions from unset to real at once, so syncAllTitleAgeBuckets
    // fires one editForumTopic call per topic back-to-back). Reuses the
    // SAME 429/retry_after-honouring mechanism the icon backfill already
    // relies on (editForumTopicWithRateLimitRetry, telegramClient.ts) rather
    // than the bare call the icon adapter above still uses for its own,
    // narrower (transition-gated, not all-at-once) update volume.
    titleAdapters: {
      readLastActivityMs: (ticketId) => lastActivityMs(readRecord(targetPath, ticketId)),
      setTopicTitle: (topicId, title) => editForumTopicWithRateLimitRetry(botToken, chatId, topicId, { name: title }),
    },
    // BL-464: each role's CURRENTLY held ticket id(s), from the coordinator-
    // fed AUTHORITATIVE ticket->stage store (readTicketStageMap, written by
    // `pipeline_stage_cli.bb sync`) - replacing BL-452's own
    // readPipelineStages(...).heldTicketIds in_process/task-header scrape,
    // which was blind to a note-only kickoff (BL-434/450 never showed on
    // the board) and could observe the same ticket at two roles at once
    // during a transition. Never readRoleTicket above either (that one's
    // holding-window mechanism is the hop-log family this feature's own
    // data-source decision explicitly rejected).
    readRoleHeldTickets: () => invertTicketStageToRoleHeldTickets(readTicketStageMap(targetPath)),
    // BL-452: the standing "Pipeline Board" topic is created ONCE - the
    // ticket's own durable TickState.pipelineBoard.topicId marker is what
    // makes this idempotent across ticks/restarts (syncPipelineBoard only
    // ever calls ensureBoardTopic while that marker is unset), so no
    // separate topic-map file/reuse-lookup is needed the way
    // ensureOperatorTopic's own reuse-or-create needs one.
    boardAdapters: {
      ensureBoardTopic: async () => {
        const created = await createForumTopic(botToken, chatId, 'Pipeline Board');
        return created.success ? created.messageThreadId : undefined;
      },
      postMessage: (topicId, text) =>
        sendTelegramMessage(botToken, chatId, wrapPipelineBoardHtml(text), undefined, undefined, topicId, undefined, 'HTML').then((r) =>
          r.success ? r.messageId : undefined
        ),
      // BL-462: the board reposts at the bottom on a content change rather
      // than editing in place - deletes the previous message (best-effort;
      // see pipelineBoardSync.ts) before the fresh one is posted above.
      deleteMessage: (topicId, messageId) => deleteMessage(botToken, chatId, messageId).then((r) => r.success),
    },
    // BL-434: the standing "Approvals" topic's own roster sync - shares the
    // SAME ensureApprovalsTopic the ask-routing RouteAdapters above uses
    // (never a second Approvals-topic notion), so the roster and every
    // ticket's ask always land in the one topic.
    rosterAdapters: {
      ensureApprovalsTopic: () => ensureApprovalsTopic(targetPath, botToken, chatId),
      ...plainTextEditInPlaceAdapters(botToken, chatId),
    },
    // BL-450: the current oldest-unreviewed recert scenario, straight off
    // computeRecertBatch(targetPath, 1) - never a second selection computed
    // here.
    readRecertScenario: () => computeRecertBatch(targetPath, 1).batch[0],
    // BL-450: the standing "Recert" topic's own posting sync - shares the
    // SAME ensureRecertTopic the reply-routing binding above uses (never a
    // second Recert-topic notion), so the posted scenario and every reply
    // always land in the one topic.
    recertPostingAdapters: {
      ensureRecertTopic: () => ensureRecertTopic(targetPath, botToken, chatId),
      ...plainTextEditInPlaceAdapters(botToken, chatId),
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
    // BL-331: shares hasCompletionRecord with the deletion sweep's own
    // verification gate below - the exact same "is this ticket's record
    // verified complete" predicate, never a second, drifting notion of it.
    isAlreadyReconciled: (backlogId, summaryText) => hasCompletionRecord(readRecord(targetPath, backlogId), summaryText),
    routeAdapters,
  };
}

// BL-331: the delete-sweep's own I/O adapters - deleteForumTopic is the
// one genuinely destructive Telegram call in this file, reached only
// through sweepTopicDeletions' own verified-and-outside-retention gate,
// never directly. reportUnverifiedDeletion defaults to loud stderr,
// mirroring blTopicStore.ts's own reportCommitFailureToStderr convention.
function buildTopicDeletionAdapters(targetPath: string, botToken: string, chatId: string): TopicDeletionAdapters {
  return {
    getTopicMap: () => readBacklogTopicMap(targetPath),
    readRecord: (ticketId) => readRecord(targetPath, ticketId),
    isRecordCommitted: (ticketId) => isRecordCommitted(targetPath, ticketId),
    deleteTopic: (topicId) => deleteForumTopic(botToken, chatId, topicId).then((r) => r.success),
    dropTopicMapping: (backlogId) => dropBacklogTopicMapping(targetPath, backlogId),
    reportUnverifiedDeletion: (ticketId) => {
      process.stderr.write(
        `topicDeletion: ${ticketId}'s topic is past its retention window but has NO verified completion record - refusing to delete. The topic and its record are left intact; investigate the archive write path for this ticket.\n`
      );
    },
  };
}

// BL-330 hardening: the one-tick body pulled out of tickLoop's own for(;;)
// so the wiring between the diff path (runConciergeTick) and the
// reconciliation safety net (reconcileTopicLifecycle) is unit-testable
// in-process, not only reachable by running the live infinite loop. Before
// this split, a wrong argument here (e.g. reconciling folders.active
// instead of folders.done, or the wrong adapters object) had zero test
// coverage - tickLoop itself is never invoked by any test.
// BL-331: the deletion sweep runs LAST, after both the diff path and the
// reconciliation safety net - so a ticket that only just reached its
// completed state THIS tick is considered for deletion with up-to-date
// mapping/record state, never a stale pre-tick snapshot. nowMs/
// retentionWindowMs default to the real clock/env-configured window in
// production; tests always pass them explicitly for a deterministic
// result (the shared engineering.prompt no-real-timers convention).
export async function runOneConciergeTick(
  adapters: ConciergeTickAdapters,
  reconcileAdapters: ReconcileAdapters,
  deletionAdapters: TopicDeletionAdapters,
  nowMs: number = Date.now(),
  retentionWindowMs: number = topicRetentionWindowMs()
): Promise<void> {
  await runConciergeTick(adapters, nowMs);
  const doneTickets = adapters.readFolders().done;
  await reconcileTopicLifecycle(doneTickets, reconcileAdapters);
  await sweepTopicDeletions(doneTickets, deletionAdapters, nowMs, retentionWindowMs);
}

async function tickLoop(targetPath: string, botToken: string, chatId: string, intervalMs: number): Promise<void> {
  const adapters = buildConciergeTickAdapters(targetPath, botToken, chatId);
  const reconcileAdapters = buildReconcileAdapters(targetPath, adapters.routeAdapters);
  const deletionAdapters = buildTopicDeletionAdapters(targetPath, botToken, chatId);
  for (;;) {
    await runOneConciergeTick(adapters, reconcileAdapters, deletionAdapters);
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
  // BL-426 slice 1: optional - absent means voice I/O is simply not wired
  // (see buildPollAdapters/connectAndRelayReplies), never a startup failure.
  const openaiApiKey = process.env.OPENAI_API_KEY;

  // BL-346: bind the standing Operator topic BEFORE any loop starts
  // polling, so no inbound message can ever reach it while it is still
  // unbound (see ensureOperatorTopic's own comment for the auto-adopt
  // trap this ordering avoids). A failed create here must never block the
  // rest of the bot's ordinary routing from coming up.
  await ensureOperatorTopic(targetPath, botToken, chatId);

  // BL-434: bind the standing Approvals topic BEFORE any loop starts
  // polling too - same ordering rationale as ensureOperatorTopic just
  // above (an inbound reply must never reach an unbound Approvals topic
  // and be misrouted as an ordinary support-thread post).
  await ensureApprovalsTopic(targetPath, botToken, chatId);

  // BL-450: bind the standing Recert topic BEFORE any loop starts polling
  // too - same ordering rationale as ensureOperatorTopic/ensureApprovalsTopic
  // just above (an inbound reply must never reach an unbound Recert topic
  // and be misrouted as an ordinary support-thread post).
  await ensureRecertTopic(targetPath, botToken, chatId);

  // BL-466: bind the standing Agent Questions topic BEFORE any loop starts
  // polling too - same ordering rationale as ensureOperatorTopic/
  // ensureApprovalsTopic/ensureRecertTopic just above (an unbound Agent
  // Questions topic must never be reachable by an inbound reply before the
  // binding decideAgentQuestionsReplyAction depends on exists).
  await ensureAgentQuestionsTopic(targetPath, botToken, chatId);

  // BL-425 slice 1: bind each swarm role's own standing steering topic
  // BEFORE any loop starts polling too - same ordering rationale as
  // ensureOperatorTopic just above (an unbound role topic must never be
  // reachable by an inbound message).
  await ensureRoleTopics(targetPath, botToken, chatId);

  // BL-302 LOOP ISOLATION: each of the three forever-loops runs inside its
  // own runContainedLoop - a fault (thrown exception) in one is caught,
  // logged, and RESTARTED after a brief delay, without ever rejecting the
  // Promise.all itself. A bare Promise.all of the raw loop promises would
  // let any one loop's fault reject the whole thing, and runCliMain's own
  // reportFatalAndExit would then process.exit(1) - tearing down the other
  // two loops even though nothing was wrong with them.
  await Promise.all([
    runContainedLoop(
      'poll',
      () => pollLoop(botToken, principalUserId, targetPath, bridgeUrl, controlToken, chatId, openaiApiKey),
      sleep,
      LOOP_RESTART_DELAY_MS,
      logLoopFault
    ),
    runContainedLoop(
      'reply-relay',
      () => subscribeReplies(botToken, chatId, targetPath, bridgeUrl, bridgeToken, controlToken, openaiApiKey),
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
