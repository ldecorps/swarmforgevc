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
import { getTelegramUpdates, sendTelegramMessage, createForumTopic, closeForumTopic, TelegramUpdate } from '../notify/telegramClient';
import { nextUpdateOffset } from '../notify/telegramInboundRelay';
import {
  pollAndForward,
  PollAdapters,
  subjectForTopic,
  topicForSubject,
  relaySseReplies,
  parseNextSseRecord,
  DEFAULT_SUBJECT_KEY,
} from './telegramFrontDeskBotCore';
import { backlogForTopic } from '../concierge/topicRouter';
import { runConciergeTick, ConciergeTickAdapters, BacklogFoldersSnapshot, TickState } from '../concierge/conciergeTick';
import { readBacklogFolders } from '../panel/backlogReader';
import { appendOperatorEvent } from '../bridge/operatorEventQueue';
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
async function postOperatorContext(targetPath: string, backlogId: string, text: string): Promise<boolean> {
  appendOperatorEvent(targetPath, { type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId, text });
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

// Polls forever, one batch at a time - each cycle's decision goes through
// pollAndForward (adapter-injected, unit-tested); this loop only owns the
// offset threaded across cycles and never stopping.
async function pollLoop(botToken: string, principalUserId: string, targetPath: string, bridgeUrl: string, controlToken: string): Promise<void> {
  const adapters = buildPollAdapters(botToken, targetPath, bridgeUrl, controlToken);
  let offset = 0;
  for (;;) {
    const result = await pollAndForward(offset, principalUserId, adapters);
    offset = result.nextOffset;
  }
}

// Subscribes to the bridge's SSE stream forever - the only untested
// boundary is readChunk (the real stream reader); every decision (which
// records to relay, which topic, dropping an unmapped threadId) lives in
// relaySseReplies (adapter-injected, unit-tested), mirroring pollLoop/
// pollAndForward's own thin-wrapper/tested-core split above.
async function subscribeReplies(botToken: string, chatId: string, targetPath: string, bridgeUrl: string, bridgeToken: string): Promise<void> {
  const res = await fetch(`${bridgeUrl}/events`, { headers: { authorization: `Bearer ${bridgeToken}` } });
  if (!res.body) {
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  await relaySseReplies('', {
    readChunk: async () => {
      const { done, value } = await reader.read();
      return { done, chunk: done ? '' : decoder.decode(value, { stream: true }) };
    },
    sendReply: (topicId, text) => sendTelegramMessage(botToken, chatId, text, undefined, undefined, topicId).then(() => undefined),
    topicForSubject: (subjectId) => topicForSubject(readTopicMap(targetPath), subjectId),
  });
}

// BL-300: readBacklogFolders returns the panel's own richer BacklogItem
// shape - narrowed to {id, title} here so conciergeTick.ts stays decoupled
// from panel/backlogReader.ts's type (the same "core stays narrow, live
// wrapper adapts the real type" split as every other adapter in this file).
function toFoldersSnapshot(targetPath: string): BacklogFoldersSnapshot {
  const folders = readBacklogFolders(targetPath);
  const pick = (items: { id: string; title: string }[]) => items.map((item) => ({ id: item.id, title: item.title }));
  return { active: pick(folders.active), paused: pick(folders.paused), done: pick(folders.done) };
}

// BL-301: resolveRoleWorktrees is file-local in bridge/bridgeState.ts -
// duplicated here rather than exported/imported, same "no shared lifecycle
// worth coupling" posture gateSnapshot.ts's own header already documents
// for this exact live-glue class of function.
function resolveLiveRoles(targetPath: string): { role: string; worktreePath: string }[] {
  try {
    return parseRolesTsv(fs.readFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), 'utf8')).map((r) => ({
      role: r.role,
      worktreePath: r.worktreePath,
    }));
  } catch {
    return [];
  }
}

// BL-301: computeRoleGateStatesLive's RoleGateState carries an optional
// snippet the swarm-agnostic GateSignal shape has no room for (question-
// snippet enrichment is explicitly out of this slice's scope, same limit
// as BL-299's summary) - narrowed to {role, gated} here.
function readGates(targetPath: string): { role: string; gated: boolean }[] {
  const roles = resolveLiveRoles(targetPath).map((r) => r.role);
  return computeRoleGateStatesLive(targetPath, roles).map((g: RoleGateState) => ({ role: g.role, gated: g.gated }));
}

// BL-301: inverts computeCurrentHolders' ticketId->role into role->ticketId
// (a role holds exactly one ticket at a time in normal operation - an
// anomalous multi-hold picks one, never mis-tags a gate to the wrong
// BL-###; a gated role with no held ticket is simply absent here, and
// diffNeedsApproval already drops an untagged gate rather than guess).
function readRoleTicket(targetPath: string): Record<string, string> {
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
async function tickLoop(targetPath: string, botToken: string, chatId: string, intervalMs: number): Promise<void> {
  const adapters = buildConciergeTickAdapters(targetPath, botToken, chatId);
  for (;;) {
    await runConciergeTick(adapters);
    await sleep(intervalMs);
  }
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

  await Promise.all([
    pollLoop(botToken, principalUserId, targetPath, bridgeUrl, controlToken),
    subscribeReplies(botToken, chatId, targetPath, bridgeUrl, bridgeToken),
    tickLoop(targetPath, botToken, chatId, conciergeTickIntervalMs()),
  ]);
}

if (require.main === module) {
  runCliMain(main);
}
