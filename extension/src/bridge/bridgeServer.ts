/// BL-094/BL-241/BL-522/BL-526/BL-538 bridge server: HTTP entrypoint for
/// SwarmForge's read JSON routes, SSE feed, Mini App shells, and a handful
/// of control-scoped POST routes (gate answers, Telegram inbound, reply
/// ack, paused-pager expedite/approve).

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  buildBridgeState,
  buildDeliveryMetricsState,
  buildCostTelemetryState,
  buildHolisticState,
  buildStageDwellState,
  buildBurnRateState,
  BridgeState,
} from './bridgeState';
import { extractBearerToken, isAuthorizedByQueryToken, parseQueryCredential } from './bridgeAuth';
import { getHolisticUiHtml } from './holisticUiHtml';
import { getResidentSpyUiHtml } from './residentSpyUiHtml';
import { getConsoleMenuUiHtml } from './consoleMenuUiHtml';
import { getPipelineGridUiHtml } from './pipelineGridUiHtml';
import { captureMonoRouterLiveScreen } from './residentPaneLive';
import { capturePipelineGridLive } from './pipelineGridLive';
import { answerCapturedGateLive } from './gateAnswerLive';
import { computeRoleGateStatesLive, filterPendingGates } from './gateSnapshot';
import { readSwarmRoles } from '../swarm/tmuxClient';
import {
  isKnownLlmCostHorizon,
  LLM_COST_HORIZONS_MS,
  isKnownOriginDimension,
  rankLlmInvocations,
  rollupLlmInvocationsByOrigin,
} from '../metrics/llmCostLedger';
import { readLlmInvocationRecords } from '../metrics/llmCostLedgerStore';
import { readThread, writeThread, appendMessage, messageForUpdateId, withEventQueued, SupportThread, ThreadMessage } from './supportThreadStore';
import { appendOperatorEvent, readNewReplyOutboxEntries } from './operatorEventQueue';
import { readPersistedCursor, writePersistedCursor, advanceCursorOnAck } from './replyRelayCursor';
import {
  DeviceRegistry,
  DeviceScope,
  Device,
  registerDevice,
  revokeDevice,
  rotateDeviceToken,
  findDeviceByToken,
  findDeviceByControlToken,
} from './deviceRegistry';
import { readBacklogFolders, BacklogItem } from '../panel/backlogReader';
import { promoteToActive, findBacklogFilePath } from '../panel/backlogWriter';
import { atomicWrite } from '../util/atomicWrite';
import { getPausedPagerUiHtml } from './pausedPagerUiHtml';
import { getEpicReorderUiHtml } from './epicReorderUiHtml';
import { sortEpicsByPriority, computeEpicReorder, EpicPriorityItem, ReorderDirection, PriorityWrite } from './epicReorderSafety';
import { computeMakeTopPriority, MakeTopItem, MakeTopResult, DependencyResolution } from './makeTopPrioritySafety';
import { computeEpicTopics, resolveTopicMembership } from './epicTopicSlugMatch';
import { recordApprovalReply } from '../concierge/pendingApprovalReply';
import { requestConciergeTick } from '../concierge/conciergeTickRequest';
import { getContextBudgetUiHtml } from './contextBudgetUiHtml';
import { listTelemetryAgents, summarizeTelemetryForAgent } from './contextTelemetryGate';
import { runCommitIntegrity, commitApprovalWrites } from '../util/commitIntegrityRunner';
import { getLetsTalkUiHtml } from './letsTalkUiHtml';
import {
  createLetsTalkWriteRoutes,
  isLetsTalkPath,
} from './letsTalkRoutes';
import { resolveLetsTalkAudioAdaptersFromEnv } from './letsTalkAudio';
import { resolveLetsTalkAudioForTurn } from './letsTalkAudioPreference';
import { createLetsTalkAudioEngineRoutes } from './letsTalkAudioEngineRoutes';
import { createLetsTalkMetaRoutes } from './letsTalkMetaRoutes';
import { getLetsTalkBubbleConfig, isLetsTalkBubbleConfigPath } from './letsTalkBubbleConfig';
import {
  isCompanionManifestPath,
  isCompanionPackagePath,
  listCompanionPackages,
  parseCompanionPackageRequest,
  readCompanionPackage,
} from './companionManifest';
import { parseLetsTalkSpeechLanguage, speechLocaleForLanguage } from './letsTalkCore';
import { createLiveCursorBridgeAgentSession, type CursorBridgeAgentSessionDeps } from './cursorBridgeAgentSession';
import type { TranscribeAudio, SynthesizeSpeech } from './letsTalkAudio';
import {
  sendTelegramMessageWithRateLimitRetry,
  sendTelegramPoll,
  type SendMessageResult,
} from '../notify/telegramClient';
import {
  bubbleTopicIdFromMap,
  cursorBridgeTopicIdFromMap,
  parseCursorBridgeState,
  splitTelegramChunks,
} from '../tools/telegramCursorBridgeCore';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const LOCALHOST = '127.0.0.1';
// BL-240: the gate-answer body is a short {role, answer} JSON payload (a
// human-typed reply) - capped well above any realistic answer so a
// malformed/hostile client can't hold the connection open streaming an
// unbounded body into memory.
const GATE_ANSWER_MAX_BODY_BYTES = 16 * 1024;
// BL-281: an inbound Telegram message body ({subjectId, channel, text}) -
// same cap posture as the gate-answer body above; Telegram's own message
// length limit is far under this.
const TELEGRAM_INBOUND_MAX_BODY_BYTES = 16 * 1024;
// BL-320: a reply-ack body ({id}) is a single idempotency-key string -
// same small-body posture as the gate-answer/telegram-inbound bodies above.
const REPLY_ACK_MAX_BODY_BYTES = 4 * 1024;
// BL-538: Expedite/approve body ({id}) from the /paused-pager Mini App.
const PAUSED_PAGER_CONTROL_MAX_BODY_BYTES = 4 * 1024;
// BL-572: move body ({id, direction}) from the /epic-reorder Mini App.
const EPIC_REORDER_MOVE_MAX_BODY_BYTES = 4 * 1024;
// BL-672: make-top body ({id}) from the same Mini App.
const EPIC_MAKE_TOP_MAX_BODY_BYTES = 4 * 1024;
// BL-673: topic make-top body ({epicId, topicId}).
const EPIC_TOPIC_MAKE_TOP_MAX_BODY_BYTES = 4 * 1024;
const CURSOR_BRIDGE_STATE_FILE = 'cursor-bridge-state.json';
const CURSOR_BRIDGE_TOPIC_MAP_FILE = 'cursor-bridge-topic-map.json';

interface CursorBridgeTopicIds {
  cursorTopicId?: number;
  bubbleTopicId?: number;
}

function mergeTopicId(
  preferred: number | undefined,
  fallback: number | undefined
): number | undefined {
  return typeof preferred === 'number' && Number.isFinite(preferred) && preferred > 0
    ? preferred
    : fallback;
}

function readCursorBridgeTopicIds(targetPath: string): CursorBridgeTopicIds {
  let stateCursorTopicId: number | undefined;
  let stateBubbleTopicId: number | undefined;
  const statePath = path.join(targetPath, '.swarmforge', 'operator', CURSOR_BRIDGE_STATE_FILE);
  if (fs.existsSync(statePath)) {
    try {
      const state = parseCursorBridgeState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
      stateCursorTopicId = state.cursorTopicId;
      stateBubbleTopicId = state.bubbleTopicId;
    } catch {
      // fall through to topic map
    }
  }
  const mapPath = path.join(targetPath, '.swarmforge', 'operator', CURSOR_BRIDGE_TOPIC_MAP_FILE);
  if (!fs.existsSync(mapPath)) {
    return {
      cursorTopicId: stateCursorTopicId,
      bubbleTopicId: stateBubbleTopicId,
    };
  }
  try {
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as Record<string, string>;
    return {
      cursorTopicId: mergeTopicId(stateCursorTopicId, cursorBridgeTopicIdFromMap(map)),
      bubbleTopicId: mergeTopicId(stateBubbleTopicId, bubbleTopicIdFromMap(map)),
    };
  } catch {
    return {
      cursorTopicId: stateCursorTopicId,
      bubbleTopicId: stateBubbleTopicId,
    };
  }
}

/** Prefer the dedicated Bubble topic; never dump ordinary talk onto Cursor Remote. */
export function effectiveBubbleMirrorTopicId(topicIds: CursorBridgeTopicIds): number | undefined {
  if (topicIds.bubbleTopicId === undefined) {
    return undefined;
  }
  return topicIds.bubbleTopicId === topicIds.cursorTopicId ? undefined : topicIds.bubbleTopicId;
}

export function formatBubbleMirrorText(transcript: string, replyText: string): string {
  const you = transcript.trim();
  const agent = replyText.trim();
  if (you && agent) {
    return `You: ${you}\n\nBubble: ${agent}`;
  }
  return agent || you;
}

export type BubbleMirrorSendFn = (
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
  postFn?: unknown,
  messageThreadId?: number
) => Promise<SendMessageResult>;

export type BubbleMirrorPollFn = (
  token: string,
  chatId: string,
  question: string,
  options: string[],
  messageThreadId?: number
) => Promise<{ success: boolean; pollId?: string; error?: string }>;

export interface MirrorLetsTalkTurnDeps {
  sendMessage?: BubbleMirrorSendFn;
  sendPoll?: BubbleMirrorPollFn;
  splitChunks?: (text: string, maxLen?: number) => string[];
}

interface LetsTalkChoicePollSpec {
  question: string;
  options: string[];
}

function extractLetsTalkChoicePoll(replyText: string): LetsTalkChoicePollSpec | null {
  const lines = replyText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const optionMatches = lines
    .map((line) => line.match(/^(?:[-*]\s+)?(\d+)[\).:-]\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null);
  if (optionMatches.length < 2 || optionMatches.length > 10) {
    return null;
  }
  const options: string[] = [];
  for (let i = 0; i < optionMatches.length; i += 1) {
    const expected = String(i + 1);
    if (optionMatches[i][1] !== expected) {
      return null;
    }
    options.push(optionMatches[i][2].trim());
  }
  const firstOptionLine = optionMatches[0][0];
  const firstOptionIndex = lines.findIndex((line) => line === firstOptionLine);
  const question = firstOptionIndex > 0 ? lines.slice(0, firstOptionIndex).join(' ') : 'Choose one option';
  return { question: question.slice(0, 280), options: options.map((opt) => opt.slice(0, 100)) };
}

function appendPendingChoicePoll(targetPath: string, pollId: string, spec: LetsTalkChoicePollSpec, originTopicId: number): void {
  const statePath = path.join(targetPath, '.swarmforge', 'operator', CURSOR_BRIDGE_STATE_FILE);
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        raw = parsed;
      }
    } catch {
      raw = {};
    }
  }
  const existing = Array.isArray(raw.pendingChoicePolls) ? raw.pendingChoicePolls : [];
  const next = [...existing, { pollId, question: spec.question, options: spec.options, createdAtMs: Date.now(), originTopicId }].slice(-20);
  raw.pendingChoicePolls = next;
  fs.writeFileSync(statePath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
}

async function mirrorLetsTalkChoicePollToBubble(
  targetPath: string,
  replyText: string,
  deps: MirrorLetsTalkTurnDeps = {}
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return;
  }
  const topicId = effectiveBubbleMirrorTopicId(readCursorBridgeTopicIds(targetPath));
  if (topicId === undefined) {
    return;
  }
  const spec = extractLetsTalkChoicePoll(replyText);
  if (!spec) {
    return;
  }
  const sendPoll = deps.sendPoll ?? sendTelegramPoll;
  const sent = await sendPoll(botToken, chatId, spec.question, spec.options, topicId);
  if (!sent.success || !sent.pollId) {
    return;
  }
  appendPendingChoicePoll(targetPath, sent.pollId, spec, topicId);
}

/** Best-effort mirror of Bubble / Let's Talk turns into the standing Bubble Telegram topic. */
export async function mirrorLetsTalkTurnToBubble(
  targetPath: string,
  transcript: string,
  replyText: string,
  deps: MirrorLetsTalkTurnDeps = {}
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return;
  }
  const topicId = effectiveBubbleMirrorTopicId(readCursorBridgeTopicIds(targetPath));
  if (topicId === undefined) {
    return;
  }
  const text = formatBubbleMirrorText(transcript, replyText);
  if (!text.trim()) {
    return;
  }
  // BL-718: chunk like Cursor Remote — never one un-chunked send over Telegram's limit.
  const splitChunks = deps.splitChunks ?? splitTelegramChunks;
  const sendMessage = deps.sendMessage ?? sendTelegramMessageWithRateLimitRetry;
  const chunks = splitChunks(text);
  for (let i = 0; i < chunks.length; i += 1) {
    const result = await sendMessage(botToken, chatId, chunks[i], undefined, undefined, topicId);
    if (!result.success) {
      const err = result.error || 'unknown send failure';
      const msg = `Bubble talk mirror failed (topic ${topicId}, chunk ${i + 1}/${chunks.length}): ${err}`;
      console.error(msg);
      appendOperatorEvent(targetPath, {
        type: 'bubble-talk-mirror-failed',
        topicId,
        chunk: i + 1,
        chunkCount: chunks.length,
        error: err,
        at: new Date().toISOString(),
      });
      return;
    }
  }
  await mirrorLetsTalkChoicePollToBubble(targetPath, replyText, deps);
}

export interface BridgeHandle {
  port: number;
  // BL-241: the bootstrap device's own base (read) token - still present
  // for backward compatibility with a plain-string startBridge call and
  // anything that only ever needed the one original credential. A caller
  // that wants real multi-device rotation/revocation/scope uses the
  // registerDevice/revokeDevice/rotateToken/getRegistry methods below
  // instead of this single field.
  token: string;
  registerDevice: (label: string, scope: DeviceScope) => Device;
  revokeDevice: (deviceId: string) => void;
  rotateToken: (deviceId: string) => Device | undefined;
  getRegistry: () => DeviceRegistry;
  stop: () => void;
}

export interface StartBridgeOptions {
  port?: number;
  pollIntervalMs?: number;
  // BL-270: injectable evaluation instant for /stage-dwell (and any future
  // route that reads the clock), so a test can pin the SAME instant its
  // fixture timestamps are built from - two independent real `new Date()`
  // reads (one in the fixture, one at request time) are exactly the
  // real-clock-fixture-vs-real-clock-code flake this exists to prevent
  // (engineering article, Test Speed And Isolation). Undefined in
  // production - buildStageDwellState defaults to the real clock unchanged.
  nowMs?: number;
  // BL-696: injectable Let's Talk adapters for headless/BDD tests.
  letsTalk?: {
    agentSession?: CursorBridgeAgentSessionDeps;
    transcribeAudio?: TranscribeAudio;
    synthesizeSpeech?: SynthesizeSpeech;
  };
  // BL-763: injectable /lets-talk/meta instanceId, so a test can pin two
  // startBridge() calls (simulating a bounce) to known, distinct values
  // instead of asserting only "different" against real randomUUID() output.
  // Undefined in production - a fresh randomUUID() is generated below.
  instanceId?: string;
}

// BL-241: startBridge's auth param generalizes from BL-065's one static
// string to a full DeviceRegistry, without breaking a caller that only
// ever passed a bare token - normalized once, right at the top, into a
// single bootstrap control-scoped device whose token AND controlToken are
// both the passed string. This is the SAME "hardens rather than replaces"
// posture the whole ticket takes: reading (the bearer alone) behaves
// exactly as before either way; a bare-string caller wanting the new
// control step-up simply presents that same string as BOTH the bearer and
// the X-Control-Token header - registry-based callers get real separate
// credentials for free.
function normalizeToRegistry(tokenOrRegistry: string | DeviceRegistry): DeviceRegistry {
  if (typeof tokenOrRegistry !== 'string') {
    return tokenOrRegistry;
  }
  return {
    devices: [
      {
        id: 'bootstrap',
        label: 'bootstrap',
        scope: 'control',
        token: tokenOrRegistry,
        controlToken: tokenOrRegistry,
        revoked: false,
      },
    ],
  };
}

// The token surfaced on BridgeHandle.token: the bootstrap device's token
// when this bridge was started the legacy (string) way, else the first
// still-registered device's token as a reasonable default - never throws
// on an empty registry.
function primaryTokenOf(registry: DeviceRegistry): string {
  return registry.devices[0]?.token ?? '';
}

type StateRoute = '/pipeline' | '/agents' | '/backlog' | '/runlog';

function stateForRoute(state: BridgeState, route: StateRoute): unknown {
  switch (route) {
    case '/pipeline':
      return state.pipeline;
    case '/agents':
      return state.agents;
    case '/backlog':
      return state.backlog;
    case '/runlog':
      return state.runLog;
  }
}

function isStateRoute(url: string): url is StateRoute {
  return url === '/pipeline' || url === '/agents' || url === '/backlog' || url === '/runlog';
}

// Split out of the request handler below so its own complexity stays under
// the CRAP<=6 gate (BL-096's added /metrics branch pushed it to 7) - the
// cached-snapshot-or-compute-fresh choice for a new SSE subscriber.
function resolveEventsSnapshot(lastSnapshot: string | undefined, targetPath: string, runLogPath: string): string {
  return lastSnapshot ?? JSON.stringify(buildBridgeState(targetPath, runLogPath));
}

function isRootPath(url: string): boolean {
  return url === '/' || url.startsWith('/?');
}

// BL-522: Telegram Mini App shell (served without prior auth, like root).
function isResidentSpyPath(url: string): boolean {
  return url === '/resident-spy' || url.startsWith('/resident-spy?');
}

// BL-522: JSON pane feed polled by the Mini App with ?token=.
function isResidentPanePath(url: string): boolean {
  return url === '/resident-pane' || url.startsWith('/resident-pane?');
}

// BL-526: console landing menu (two portrait buttons).
function isConsolePath(url: string): boolean {
  return url === '/console' || url.startsWith('/console?');
}

// BL-526: pipeline STATUS GRID Mini App shell.
function isPipelineGridPath(url: string): boolean {
  return url === '/pipeline-grid' || url.startsWith('/pipeline-grid?');
}

// BL-526: JSON board feed polled by the grid Mini App with ?token=.
function isPipelineBoardPath(url: string): boolean {
  return url === '/pipeline-board' || url.startsWith('/pipeline-board?');
}

// BL-538: paused-ticket pager Mini App shell.
function isPausedPagerPath(url: string): boolean {
  return url === '/paused-pager' || url.startsWith('/paused-pager?');
}

// BL-538: JSON state for the paused-ticket pager Mini App.
function isPausedPagerStatePath(url: string): boolean {
  return url === '/paused-pager-state' || url.startsWith('/paused-pager-state?');
}

// BL-572: epic priority reorder Mini App shell.
function isEpicReorderPath(url: string): boolean {
  return url === '/epic-reorder' || url.startsWith('/epic-reorder?');
}

// BL-572: JSON state for the epic reorder Mini App.
function isEpicReorderStatePath(url: string): boolean {
  return url === '/epic-reorder-state' || url.startsWith('/epic-reorder-state?');
}

// GH-23: Context Budget dashboard Mini App shell.
function isContextBudgetPath(url: string): boolean {
  return url === '/context-budget' || url.startsWith('/context-budget?');
}

// GH-23: JSON state polled by the Context Budget Mini App with ?token=&agent=.
function isContextBudgetStatePath(url: string): boolean {
  return url === '/context-budget-state' || url.startsWith('/context-budget-state?');
}

// BL-551 (bridge-08): JSON top-expensive-invocations/rollup feed over the
// unified LLM cost ledger.
function isCostRankPath(url: string): boolean {
  return url === '/cost-rank' || url.startsWith('/cost-rank?');
}

const MINIAPP_CSP =
  "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://telegram.org; connect-src 'self'";

function serveMiniAppHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': MINIAPP_CSP,
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
  });
  res.end(html);
}

// BL-240: the ONLY route on this server that reads a request body - every
// other route is GET/no-body. Rejects (never parses) a body over the cap
// rather than buffering an unbounded stream into memory.
function readJsonBody(req: http.IncomingMessage, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (result: { ok: true; value: unknown } | { ok: false; reason: string }) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        finish({ ok: false, reason: 'request body too large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => finish({ ok: false, reason: 'request body read error' }));
    req.on('end', () => {
      try {
        finish({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
      } catch {
        finish({ ok: false, reason: 'invalid JSON body' });
      }
    });
  });
}

// BL-240: the write path accepts ONLY this exact {role, answer} shape -
// no additional fields select some other action, matching the ticket's
// "gate answers only, no arbitrary control" scope.
function isGateAnswerRequestShape(value: unknown): value is { role: string; answer: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).role === 'string' &&
    typeof (value as Record<string, unknown>).answer === 'string'
  );
}

function isGateAnswerRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && url === '/gate-answer';
}

function respondJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function requireControlAuth(req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry): boolean {
  const url = requestPath(req);
  if (isAuthorizedForControl(req, url, registry)) {
    return true;
  }
  const queryCred = parseQueryCredential(url);
  const bearer = extractBearerToken(req.headers.authorization) ?? queryCred;
  const stepUpHeader = req.headers['x-control-token'];
  const stepUp = typeof stepUpHeader === 'string' ? stepUpHeader : queryCred;
  const device = findDeviceByToken(registry, bearer);
  if (!device) {
    respondJson(res, 401, { success: false, reason: 'unauthorized' });
    return false;
  }
  if (device.scope !== 'control' || device.controlToken === undefined) {
    respondJson(res, 403, { success: false, reason: 'control auth required' });
    return false;
  }
  if (!stepUp) {
    respondJson(res, 403, { success: false, reason: 'control auth required' });
    return false;
  }
  respondJson(res, 401, { success: false, reason: 'unauthorized' });
  return false;
}

// Reads and shape-validates the request body, responding 400 itself (and
// resolving null) on either a body-read failure or a shape mismatch - the
// caller only has to handle its own non-null, already-validated body.
async function readValidatedBody<T>(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxBytes: number,
  isShape: (value: unknown) => value is T,
  shapeErrorReason: string
): Promise<T | null> {
  const body = await readJsonBody(req, maxBytes);
  if (!body.ok) {
    respondJson(res, 400, { success: false, reason: body.reason });
    return null;
  }
  if (!isShape(body.value)) {
    respondJson(res, 400, { success: false, reason: shapeErrorReason });
    return null;
  }
  return body.value;
}

function handleGateAnswerRoute(req: http.IncomingMessage, res: http.ServerResponse, targetPath: string, registry: DeviceRegistry): void {
  if (!requireControlAuth(req, res, registry)) {
    return;
  }
  readValidatedBody(req, res, GATE_ANSWER_MAX_BODY_BYTES, isGateAnswerRequestShape, 'expected a JSON body of {role, answer}').then((value) => {
    if (!value) {
      return;
    }
    const result = answerCapturedGateLive(targetPath, value);
    respondJson(res, result.success ? 200 : 403, result);
  });
}

function isValidOptionalUpdateId(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function isTelegramInboundRequestShape(value: unknown): value is { subjectId: string; channel: string; text: string; updateId?: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.subjectId === 'string' && typeof v.channel === 'string' && typeof v.text === 'string' && isValidOptionalUpdateId(v.updateId);
}

function isTelegramInboundRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && url === '/telegram-inbound';
}

function findExistingMessage(thread: SupportThread | null, updateId: number | undefined): ThreadMessage | undefined {
  return thread && updateId !== undefined ? messageForUpdateId(thread, updateId) : undefined;
}

function resolveInboundMessage(
  targetPath: string,
  subjectId: string,
  channel: string,
  text: string,
  updateId: number | undefined
): { thread: SupportThread; message: ThreadMessage } {
  const existing = readThread(targetPath, subjectId);
  const found = findExistingMessage(existing, updateId);
  if (existing && found) {
    return { thread: existing, message: found };
  }
  const thread = appendMessage(existing, subjectId, channel, new Date().toISOString(), text, updateId);
  writeThread(targetPath, thread);
  return { thread, message: thread.messages[thread.messages.length - 1] };
}

export function ingestTelegramInboundMessage(
  targetPath: string,
  subjectId: string,
  channel: string,
  text: string,
  updateId: number | undefined
): { success: boolean; reason?: string } {
  try {
    const { thread, message } = resolveInboundMessage(targetPath, subjectId, channel, text, updateId);
    if (message.eventQueued) {
      return { success: true };
    }
    appendOperatorEvent(targetPath, { type: 'TELEGRAM_TOPIC_MESSAGE', subject: subjectId, updateId });
    if (updateId !== undefined) {
      writeThread(targetPath, withEventQueued(thread, updateId));
    }
    return { success: true };
  } catch (err) {
    return { success: false, reason: err instanceof Error ? err.message : 'unknown error' };
  }
}

function handleTelegramInboundRoute(req: http.IncomingMessage, res: http.ServerResponse, targetPath: string, registry: DeviceRegistry): void {
  if (!requireControlAuth(req, res, registry)) {
    return;
  }
  readValidatedBody(
    req,
    res,
    TELEGRAM_INBOUND_MAX_BODY_BYTES,
    isTelegramInboundRequestShape,
    'expected a JSON body of {subjectId, channel, text}'
  ).then((value) => {
    if (!value) {
      return;
    }
    const { subjectId, channel, text, updateId } = value;
    const result = ingestTelegramInboundMessage(targetPath, subjectId, channel, text, updateId);
    respondJson(res, result.success ? 200 : 500, result);
  });
}

function isReplyAckRequestShape(value: unknown): value is { id: string } {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string';
}

function isReplyAckRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && url === '/reply-ack';
}

function handleReplyAckRoute(req: http.IncomingMessage, res: http.ServerResponse, targetPath: string, registry: DeviceRegistry): void {
  if (!requireControlAuth(req, res, registry)) {
    return;
  }
  readValidatedBody(req, res, REPLY_ACK_MAX_BODY_BYTES, isReplyAckRequestShape, 'expected a JSON body of {id}').then((value) => {
    if (!value) {
      return;
    }
    const { ackedIndex } = readPersistedCursor(targetPath);
    const { entries } = readNewReplyOutboxEntries(targetPath, ackedIndex);
    const nextAckedIndex = advanceCursorOnAck(ackedIndex, value.id, entries);
    if (nextAckedIndex !== ackedIndex) {
      writePersistedCursor(targetPath, { ackedIndex: nextAckedIndex });
    }
    respondJson(res, 200, { success: true, ackedIndex: nextAckedIndex });
  });
}

// BL-538: Paused-pager control POST routes (expedite, approve).
function isPausedPagerExpediteRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && (url === '/paused-pager/expedite' || url.startsWith('/paused-pager/expedite?'));
}

function isPausedPagerApproveRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && (url === '/paused-pager/approve' || url.startsWith('/paused-pager/approve?'));
}

function isPausedPagerIdRequestShape(value: unknown): value is { id: string } {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string';
}

// Shared by the expedite route (priority always -> 0) and BL-572's epic
// reorder move route (priority -> a computed value): replaces an existing
// `priority:` line in place, or appends one if the ticket had none, leaving
// every other line byte-identical.
const PRIORITY_LINE = /^priority:\s*.+$/m;
function replacePriorityLine(content: string, priority: number): string {
  if (PRIORITY_LINE.test(content)) {
    return content.replace(PRIORITY_LINE, `priority: ${priority}`);
  }
  return content.trimEnd() + `\npriority: ${priority}\n`;
}

function handlePausedPagerExpediteRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetPath: string,
  registry: DeviceRegistry
): void {
  if (!requireControlAuth(req, res, registry)) {
    return;
  }
  readValidatedBody(
    req,
    res,
    PAUSED_PAGER_CONTROL_MAX_BODY_BYTES,
    isPausedPagerIdRequestShape,
    'expected a JSON body of {id}'
  ).then((value) => {
    if (!value) {
      return;
    }
    const backlogId = value.id;
    try {
      // BL-538: Expedite from paused-pager — reuse BL-490's force-promote
      // semantics (promote paused->active if present) and set priority 0
      // in the ticket YAML. commitExpediteWrites/dispatch are owned by
      // telegramFrontDeskBotCore; here we only mutate YAML and folders.
      promoteToActive(targetPath, backlogId);
      const filePath = findBacklogFilePath(targetPath, backlogId);
      if (!filePath) {
        respondJson(res, 404, { success: false, reason: 'ticket not found in active/paused' });
        return;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      atomicWrite(filePath, replacePriorityLine(content, 0));
      respondJson(res, 200, { success: true, id: backlogId });
    } catch (err) {
      respondJson(res, 500, {
        success: false,
        reason: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });
}

// BL-892 (hardener split, CRAP): the route's actual decide-what-happened
// logic, pulled out of the request callback below so each half stays under
// the CRAP complexity budget - this one is unit-testable in-process with no
// HTTP layer at all. Behavior-preserving: same status/body per branch, same
// synchronous-commit posture (a paused-pager tap has no external owner to
// defer its commit to, unlike Expedite's own poll-tick deferral) as
// commitEpicReorderWrites below. A failed commit must not report
// unqualified success: disk holds the flip, but the human is told it is
// not yet durable.
async function computePausedPagerApproveOutcome(
  targetPath: string,
  backlogId: string
): Promise<{ status: number; body: Record<string, unknown>; conciergeTick: boolean }> {
  if (!findBacklogFilePath(targetPath, backlogId)) {
    return { status: 404, body: { success: false, reason: 'ticket not found in active/paused' }, conciergeTick: false };
  }
  const changed = recordApprovalReply(targetPath, backlogId);
  if (!changed) {
    return { status: 200, body: { success: false, id: backlogId, reason: 'not pending approval' }, conciergeTick: false };
  }
  const committed = await commitApprovalWrites(targetPath, backlogId, `Approve ${backlogId}: record human_approval\n\nBy coder.`);
  if (!committed) {
    return { status: 500, body: { success: false, changed: true, id: backlogId, reason: 'approved but failed to commit' }, conciergeTick: false };
  }
  return { status: 200, body: { success: true, id: backlogId }, conciergeTick: true };
}

function handlePausedPagerApproveRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetPath: string,
  registry: DeviceRegistry
): void {
  if (!requireControlAuth(req, res, registry)) {
    return;
  }
  readValidatedBody(
    req,
    res,
    PAUSED_PAGER_CONTROL_MAX_BODY_BYTES,
    isPausedPagerIdRequestShape,
    'expected a JSON body of {id}'
  ).then(async (value) => {
    if (!value) {
      return;
    }
    try {
      const outcome = await computePausedPagerApproveOutcome(targetPath, value.id);
      if (outcome.conciergeTick) {
        requestConciergeTick(targetPath);
      }
      respondJson(res, outcome.status, outcome.body);
    } catch (err) {
      respondJson(res, 500, {
        success: false,
        reason: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });
}

// BL-572: paused `type: epic` tickets, normalized to a required numeric
// priority and sorted the same way the screen displays them - the one place
// both the read (state) and write (move) routes derive "current order"
// from, so they can never disagree about who a mover's on-screen neighbour
// is.
function readPausedEpics(targetPath: string): (BacklogItem & EpicPriorityItem)[] {
  const MAX_PRIORITY = Number.MAX_SAFE_INTEGER;
  const epics = readBacklogFolders(targetPath)
    .paused.filter((item) => item.type === 'epic')
    .map((item) => ({ ...item, priority: item.priority ?? MAX_PRIORITY }));
  return sortEpicsByPriority(epics);
}

// BL-674: whether a live item carries at least one depends_on id that
// itself resolves to another LIVE item - the one bit of decision logic the
// drill-down's dependency marker needs, kept here (testable) rather than
// inline in epicReorderUiHtml.ts's script (untestable-edge boundary, per
// the ticket's own "keep new logic thin" guidance).
function hasLiveDependency(item: MakeTopItem, liveIds: Set<string>): boolean {
  return (item.dependsOn ?? []).some((depId) => liveIds.has(depId));
}

function computeEpicReorderState(targetPath: string): unknown {
  const epics = readPausedEpics(targetPath);
  // BL-672's own paused+hold domination set - kept for hasLiveDependency's
  // dependency-liveness check ONLY (invariant 2: widening the drill-down's
  // MEMBERSHIP must never widen what counts as a live dependency).
  const liveItems = readLiveBacklogItems(targetPath);
  const liveIds = new Set(liveItems.map((item) => item.id));
  // BL-687: the within-epic drill-down's own widened membership set (paused
  // + hold + active, done excluded) - deliberately NOT readLiveBacklogItems
  // above, which stays paused+hold-only for BL-672's epic-tile route
  // (invariant 3: widening that reader in place would silently widen the
  // whole-backlog epic-tile Make top's domination set too).
  const withinEpicItems = readWithinEpicLiveBacklogItems(targetPath);
  // BL-686: membership is resolved by slug (epicTopicSlugMatch.ts), never by
  // comparing a child's `epic:` slug against an epic tile's `id:` - those
  // are different strings by design (BL-542/BL-545's shared slug proves a
  // slug isn't even unique). `type: epic` rows are excluded from `topics`
  // by computeEpicTopics itself.
  const topics = computeEpicTopics(withinEpicItems, epics);
  return {
    items: epics.map((epic) => ({ id: epic.id, title: epic.title, priority: epic.priority })),
    total: epics.length,
    // BL-674/BL-686: every live topic, tagged with every epic TICKET ID
    // (unique, unlike its raw slug) whose own slug matches it - the
    // drill-down filters client-side on this ticket id (presentation-only,
    // no new decision logic in the webview). BL-687: inFlight badges a topic
    // sourced from active/ - hasLiveDependency stays computed against the
    // UNWIDENED liveIds above, so an active depends_on never lights it.
    topics: topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      priority: topic.priority,
      epicIds: topic.epicIds,
      hasLiveDependency: hasLiveDependency(topic, liveIds),
      inFlight: topic.inFlight,
    })),
  };
}

// BL-572: durably commits the reorder's writes through the same shared,
// locked commit-integrity helper (commit_integrity_cli.bb, BL-419) the
// paused-pager Expedite verb uses - never a raw git commit issued from the
// bridge server, which would race the roles committing to main. Unlike
// Expedite (whose commit is deferred to telegramFrontDeskBotCore's own poll
// tick, BL-490/BL-538), a plain console screen action has no such external
// owner to defer to, so this commits synchronously in the same request -
// still exclusively through the CLI, never a hand-rolled git command.
// Accepts every id whose file changed, not just two - a tie-run rewrite
// (BL-572 amendment) can touch more than the moved pair. The exec + parse
// is shared with telegram-front-desk-bot.ts's own commitExpediteWrites via
// runCommitIntegrity (util/commitIntegrityRunner.ts).
function commitEpicReorderWrites(targetPath: string, relPaths: string[], ids: string[]): Promise<boolean> {
  return runCommitIntegrity(targetPath, relPaths, `Epic reorder ${ids.join(', ')}: rewrite priority\n\nBy coder.`);
}

function isEpicReorderMoveRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && (url === '/epic-reorder/move' || url.startsWith('/epic-reorder/move?'));
}

function isEpicReorderMoveRequestShape(value: unknown): value is { id: string; direction: ReorderDirection } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && (v.direction === 'up' || v.direction === 'down');
}

// Resolves every write's on-disk path BEFORE any write is applied, so a
// missing file anywhere in a tie-run cascade (which can touch 3+ files, not
// just the moved pair) aborts the whole move with nothing written, rather
// than leaving a partially-rewritten backlog that matches neither the old
// nor the new order (architect bounce #3, secondary finding). `findFn` is
// injectable so this all-or-nothing property is unit-testable without a
// real filesystem race.
export function resolveEpicWritePaths(
  targetPath: string,
  writes: PriorityWrite[],
  findFn: (targetPath: string, id: string) => string | null = findBacklogFilePath
): Array<{ write: PriorityWrite; filePath: string }> | null {
  const resolved: Array<{ write: PriorityWrite; filePath: string }> = [];
  for (const write of writes) {
    const filePath = findFn(targetPath, write.id);
    if (!filePath) {
      return null;
    }
    resolved.push({ write, filePath });
  }
  return resolved;
}

// BL-572: the epic reorder screen's write route. Reads paused epics fresh
// (same order the screen itself was built from), asks the pure decision
// core which files change, applies those as atomic writes, then commits
// them - scenario 06's "committed to main" is not a separate step, it is
// part of what a successful move means. A move is never refused by the
// decision core except at the true list boundary (first epic up / last
// epic down); that boundary answers changed:false with a human-readable
// reason the screen must display (architect bounce #2's response-contract
// finding) rather than a payload indistinguishable from success.
function handleEpicReorderMoveRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetPath: string,
  registry: DeviceRegistry
): void {
  if (!requireControlAuth(req, res, registry)) {
    return;
  }
  readValidatedBody(
    req,
    res,
    EPIC_REORDER_MOVE_MAX_BODY_BYTES,
    isEpicReorderMoveRequestShape,
    'expected a JSON body of {id, direction}'
  ).then(async (value) => {
    if (!value) {
      return;
    }
    const epics = readPausedEpics(targetPath);
    if (!epics.some((epic) => epic.id === value.id)) {
      respondJson(res, 404, { success: false, reason: 'epic not found in paused' });
      return;
    }
    const result = computeEpicReorder(epics, value.id, value.direction);
    if (!result) {
      respondJson(res, 404, { success: false, reason: 'epic not found in paused' });
      return;
    }
    if (!result.changed) {
      respondJson(res, 200, { success: true, changed: false, reason: result.reason });
      return;
    }
    try {
      const resolved = resolveEpicWritePaths(targetPath, result.writes);
      if (!resolved) {
        respondJson(res, 500, { success: false, reason: 'epic file missing during write' });
        return;
      }
      const relPaths: string[] = [];
      for (const { write, filePath } of resolved) {
        const content = fs.readFileSync(filePath, 'utf8');
        atomicWrite(filePath, replacePriorityLine(content, write.priority));
        relPaths.push(path.relative(targetPath, filePath));
      }
      const committed = await commitEpicReorderWrites(
        targetPath,
        relPaths,
        result.writes.map((write) => write.id)
      );
      if (!committed) {
        respondJson(res, 500, { success: false, changed: true, reason: 'write succeeded but commit failed' });
        return;
      }
      respondJson(res, 200, { success: true, changed: true });
    } catch (err) {
      respondJson(res, 500, {
        success: false,
        reason: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });
}

// BL-672: the full domination set for "make top priority" - every live
// (paused + hold) backlog item, epic AND non-epic topic alike (unlike
// readPausedEpics's epics-only, paused-only scope, approval_context #3) -
// active/ is excluded (already promoted; rewriting an in-flight ticket's
// YAML risks worktree staleness for zero scheduling effect) and done/ is
// never read or written here.
function readLiveBacklogItems(targetPath: string): (BacklogItem & MakeTopItem)[] {
  const MAX_PRIORITY = Number.MAX_SAFE_INTEGER;
  const folders = readBacklogFolders(targetPath);
  const live = [...folders.paused, ...folders.hold].map((item) => ({
    ...item,
    priority: item.priority ?? MAX_PRIORITY,
    dependsOn: item.dependsOn ?? [],
  }));
  return sortEpicsByPriority(live);
}

// BL-687: pure combination step for the within-epic drill-down's own widened
// live set (paused + hold + active, done never passed in at all - excluded
// by this function's own signature rather than filtered, so "done never
// appears" holds by construction). Tags each item's provenance so the
// drill-down can badge an active/ child without a second lookup. Kept
// separate from the FS read (readWithinEpicLiveBacklogItems below) so
// invariant 1 (every backlog state's membership) is property-testable
// without a filesystem - same testable-core split the rest of this module
// follows.
export function combineWithinEpicLiveItems<T extends BacklogItem>(folders: {
  paused: T[];
  hold: T[];
  active: T[];
}): (T & MakeTopItem & { inFlight: boolean })[] {
  const MAX_PRIORITY = Number.MAX_SAFE_INTEGER;
  const tag =
    (inFlight: boolean) =>
    (item: T): T & MakeTopItem & { inFlight: boolean } => ({
      ...item,
      priority: item.priority ?? MAX_PRIORITY,
      dependsOn: item.dependsOn ?? [],
      inFlight,
    });
  const within = [...folders.paused.map(tag(false)), ...folders.hold.map(tag(false)), ...folders.active.map(tag(true))];
  return sortEpicsByPriority(within);
}

// BL-687: the within-epic drill-down surface ONLY - never shared with
// readLiveBacklogItems above (BL-672's own paused+hold domination set,
// which handleEpicMakeTopRoute and computeEpicReorderState's own
// hasLiveDependency check keep using unchanged, invariant 3). Approval
// context #1: an active/ ticket is a full ordering peer and a valid make-top
// target here, never merely displayed.
function readWithinEpicLiveBacklogItems(targetPath: string): (BacklogItem & MakeTopItem & { inFlight: boolean })[] {
  return combineWithinEpicLiveItems(readBacklogFolders(targetPath));
}

// BL-672: classifies a depends_on id NOT present in the live domination set
// - done/active are satisfied/ignored terminal nodes for ordering purposes
// (the coordinator's promotion gate owns active's own completion); anything
// else is a dangling reference and computeMakeTopPriority refuses on it.
function buildResolveNonLiveDependency(folders: ReturnType<typeof readBacklogFolders>): (id: string) => DependencyResolution {
  const activeIds = new Set(folders.active.map((item) => item.id));
  const doneIds = new Set(folders.done.map((item) => item.id));
  return (id: string): DependencyResolution => (activeIds.has(id) ? 'active' : doneIds.has(id) ? 'done' : 'unknown');
}

function commitMakeTopPriorityWrites(targetPath: string, relPaths: string[], targetId: string): Promise<boolean> {
  return runCommitIntegrity(targetPath, relPaths, `Epic make-top-priority ${targetId}: rewrite priority\n\nBy coder.`);
}

// Resolves every write's on-disk path (all-or-nothing, same contract as
// resolveEpicWritePaths' own caller in handleEpicReorderMoveRoute) and
// applies them atomically, returning the committed relPaths - or null when
// any target file went missing between decision and write, so the caller
// can answer the dedicated 500 rather than a generic one. Split out of
// applyMakeTopPriorityResult purely to keep that function's own branching
// under the article 4.1 CRAP threshold - no behavior change.
function writeMakeTopPriorityFiles(targetPath: string, writes: PriorityWrite[]): string[] | null {
  const resolved = resolveEpicWritePaths(targetPath, writes);
  if (!resolved) {
    return null;
  }
  const relPaths: string[] = [];
  for (const { write, filePath } of resolved) {
    const content = fs.readFileSync(filePath, 'utf8');
    atomicWrite(filePath, replacePriorityLine(content, write.priority));
    relPaths.push(path.relative(targetPath, filePath));
  }
  return relPaths;
}

// Shared response tail for both make-top routes (BL-672 epic-level, BL-673
// topic-level): apply a computed MakeTopResult's writes atomically, commit
// through the same commit-integrity path the move route uses, and answer
// with the same success/changed/reason contract either way - a refusal
// (result.changed === false) already carries its own stated reason.
async function applyMakeTopPriorityResult(
  targetPath: string,
  result: MakeTopResult,
  res: http.ServerResponse,
  commitWrites: (relPaths: string[]) => Promise<boolean>
): Promise<void> {
  if (!result.changed) {
    respondJson(res, 200, { success: true, changed: false, reason: result.reason });
    return;
  }
  try {
    const relPaths = writeMakeTopPriorityFiles(targetPath, result.writes);
    if (!relPaths) {
      respondJson(res, 500, { success: false, reason: 'backlog file missing during write' });
      return;
    }
    const committed = await commitWrites(relPaths);
    if (!committed) {
      respondJson(res, 500, { success: false, changed: true, reason: 'write succeeded but commit failed' });
      return;
    }
    respondJson(res, 200, { success: true, changed: true, reason: result.reason });
  } catch (err) {
    respondJson(res, 500, {
      success: false,
      reason: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

function isEpicMakeTopRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && (url === '/epic-reorder/make-top' || url.startsWith('/epic-reorder/make-top?'));
}

function isEpicMakeTopRequestShape(value: unknown): value is { id: string } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return typeof (value as Record<string, unknown>).id === 'string';
}

// BL-672: the make-top-priority screen verb. Reads the full live domination
// set fresh (paused + hold, epics AND topics), asks the pure decision core
// which files change (dependency-bounded), applies those as atomic writes,
// then commits through the same commit-integrity path the move route uses -
// never a bare git command from the bridge. A refusal (cycle, dangling
// dependency, a live dependency ranked worse than the target, or already in
// the best permitted position) answers changed:false with a stated reason -
// same response-contract lesson as the move route (BL-572 architect bounce
// #2/#3: a tap that did nothing must say so, and the reason must actually
// reach the screen, not just the response body).
function handleEpicMakeTopRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetPath: string,
  registry: DeviceRegistry
): void {
  if (!requireControlAuth(req, res, registry)) {
    return;
  }
  readValidatedBody(
    req,
    res,
    EPIC_MAKE_TOP_MAX_BODY_BYTES,
    isEpicMakeTopRequestShape,
    'expected a JSON body of {id}'
  ).then(async (value) => {
    if (!value) {
      return;
    }
    const folders = readBacklogFolders(targetPath);
    const liveItems = readLiveBacklogItems(targetPath);
    const result = computeMakeTopPriority(liveItems, value.id, buildResolveNonLiveDependency(folders));
    if (!result) {
      respondJson(res, 404, { success: false, reason: 'ticket not found in paused or hold' });
      return;
    }
    await applyMakeTopPriorityResult(targetPath, result, res, (relPaths) =>
      commitMakeTopPriorityWrites(targetPath, relPaths, value.id)
    );
  });
}

function commitTopicMakeTopPriorityWrites(targetPath: string, relPaths: string[], topicId: string): Promise<boolean> {
  return runCommitIntegrity(targetPath, relPaths, `Topic make-top-priority ${topicId}: rewrite priority\n\nBy coder.`);
}

function isEpicReorderTopicMakeTopRoute(req: http.IncomingMessage, url: string): boolean {
  return (
    req.method === 'POST' &&
    (url === '/epic-reorder/topic-make-top' || url.startsWith('/epic-reorder/topic-make-top?'))
  );
}

function isEpicReorderTopicMakeTopRequestShape(value: unknown): value is { epicId: string; topicId: string } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.epicId === 'string' && typeof v.topicId === 'string';
}

// BL-673: topic-level make-top-priority, scoped to one epic - "same
// primitive one level down" from BL-672's epic-level verb. The peer set
// (who the target must rank strictly above, absent a bound) is narrowed to
// the OTHER live topics carrying the SAME epic; dependency resolution stays
// GLOBAL (a live dependency in any other epic still bounds or refuses the
// move, approval_context #1) via computeMakeTopPriority's own
// dominationSet parameter. The named epic and the target topic's own
// `epic:` field must agree - a mismatch is a 404-class refusal (scenario
// 07), never a silent move scoped to the wrong epic or the whole backlog.
//
// BL-687: membership (target + peers) and the ordering array both resolve
// from withinEpicItems (paused+hold+active) - an active/ sibling is now a
// full ordering peer and a valid target itself (approval_context #1).
// Dependency traversal keeps reading liveItems (paused+hold only), passed as
// computeMakeTopPriority's separate dependencyLiveItems parameter, so an
// active depends_on stays exactly the inert 'active' classification BL-672
// already gave it (invariant 2) regardless of how it's tagged for ordering.
function handleEpicReorderTopicMakeTopRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetPath: string,
  registry: DeviceRegistry
): void {
  if (!requireControlAuth(req, res, registry)) {
    return;
  }
  readValidatedBody(
    req,
    res,
    EPIC_TOPIC_MAKE_TOP_MAX_BODY_BYTES,
    isEpicReorderTopicMakeTopRequestShape,
    'expected a JSON body of {epicId, topicId}'
  ).then(async (value) => {
    if (!value) {
      return;
    }
    const folders = readBacklogFolders(targetPath);
    const epics = readPausedEpics(targetPath);
    const liveItems = readLiveBacklogItems(targetPath);
    const withinEpicItems = readWithinEpicLiveBacklogItems(targetPath);
    // BL-686: `epicId` on the wire is the tile's TICKET id; membership is
    // decided by resolving THAT ticket's own slug and comparing it against
    // the target's `epic:` slug (epicTopicSlugMatch.ts) - the same rule the
    // read side uses, so read and write can never disagree about who is in
    // the epic (invariant 2). A `type: epic` row is never itself a valid
    // make-top target or peer here (invariant 3).
    const membership = resolveTopicMembership(withinEpicItems, epics, value.epicId, value.topicId);
    if (!membership) {
      respondJson(res, 404, { success: false, reason: `topic not found among epic '${value.epicId}'s live topics` });
      return;
    }
    const result = computeMakeTopPriority(
      withinEpicItems,
      value.topicId,
      buildResolveNonLiveDependency(folders),
      membership.peers,
      `epic ${value.epicId}'s live topics`,
      liveItems
    );
    if (!result) {
      respondJson(res, 404, { success: false, reason: `topic not found among epic '${value.epicId}'s live topics` });
      return;
    }
    await applyMakeTopPriorityResult(targetPath, result, res, (relPaths) =>
      commitTopicMakeTopPriorityWrites(targetPath, relPaths, value.topicId)
    );
  });
}

function requireLetsTalkControlAuth(req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry): boolean {
  if (!isAuthorizedForControl(req, requestPath(req), registry)) {
    respondJson(res, 401, { success: false, reason: 'unauthorized' });
    return false;
  }
  return true;
}

interface WriteRoute {
  matches: (req: http.IncomingMessage, url: string) => boolean;
  handle: (req: http.IncomingMessage, res: http.ServerResponse, targetPath: string, registry: DeviceRegistry) => void;
}

// The bridge's write (POST) routes, table-driven for the same reason
// buildJsonRoutes is: a future write route only ever adds a row here,
// never another branch in the request dispatcher below.
const writeRoutes: WriteRoute[] = [
  { matches: isGateAnswerRoute, handle: handleGateAnswerRoute },
  { matches: isTelegramInboundRoute, handle: handleTelegramInboundRoute },
  { matches: isReplyAckRoute, handle: handleReplyAckRoute },
  // BL-538: paused-pager control routes, control-scoped.
  { matches: isPausedPagerExpediteRoute, handle: handlePausedPagerExpediteRoute },
  { matches: isPausedPagerApproveRoute, handle: handlePausedPagerApproveRoute },
  // BL-572: epic reorder move route, control-scoped.
  { matches: isEpicReorderMoveRoute, handle: handleEpicReorderMoveRoute },
  // BL-672: epic make-top-priority route, control-scoped.
  { matches: isEpicMakeTopRoute, handle: handleEpicMakeTopRoute },
  // BL-673: topic make-top-priority route (scoped to one epic), control-scoped.
  { matches: isEpicReorderTopicMakeTopRoute, handle: handleEpicReorderTopicMakeTopRoute },
];

function requestPath(req: http.IncomingMessage): string {
  return req.url ?? '/';
}

// Sideload APKs: publish-apk.sh copies versioned debug builds into
// `.swarmforge/operator/public/`. bubble.musicalsifu.com terminates on this
// bridge, so those files must be served here (pre-auth — phones cannot set
// Authorization when opening a download link). Basename-only, fixed prefix.
export const SIDELOAD_APK_PATH = /^\/swarmforge-float-companion-[A-Za-z0-9._-]+\.apk$/;

// BL-788: any request under this literal prefix is claimed by the sideload
// namespace pre-auth, even one that fails SIDELOAD_APK_PATH (a malformed
// name, a traversal attempt, a percent-encoded one). Before this, such a
// request fell through to the generic 401 gate - safe only by coincidence
// (no other route happened to match it either), not because this route
// deliberately rejected it. Claiming the whole prefix makes the rejection
// explicit and guarantees it 404s rather than depending on nothing else in
// the routing table ever matching it.
export const SIDELOAD_APK_NAMESPACE_PREFIX = '/swarmforge-float-companion';

function sideloadApkPublicDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'public');
}

// A symlink whose own name lives inside publicRoot and matches
// SIDELOAD_APK_PATH resolves (lexically) to a path under publicRoot even
// when its target does not, so the prefix check alone cannot catch it -
// resolveSideloadApkFile's lstat/isSymbolicLink check below is what does.
function isWithinPublicRoot(resolvedPath: string, publicRoot: string): boolean {
  const resolvedRoot = path.resolve(publicRoot);
  const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  return resolvedPath.startsWith(rootPrefix);
}

// fs.statSync/createReadStream both follow symlinks, so without this
// lstat/isSymbolicLink check, planting a symlink under
// .swarmforge/operator/public/ would serve any file on the host,
// unauthenticated. Returns the lstat only for a REGULAR file that is
// itself not a symlink; null means "do not serve".
function statRegularNonSymlinkFile(resolved: string): fs.Stats | null {
  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(resolved);
  } catch {
    return null;
  }
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    return null;
  }
  return lstat;
}

// BL-851 review goal 1: path.resolve is lexical only - it never touches the
// filesystem, so the containment check and the symlink check are two
// separate, both-required guards (see the two helpers above). Returns the
// resolved path only when both hold; null means "do not serve" (caller
// decides whether that means fall-through or 404).
export function resolveSideloadApkFile(pathname: string, publicRoot: string): string | null {
  if (!SIDELOAD_APK_PATH.test(pathname)) {
    return null;
  }
  const fileName = path.basename(pathname);
  const resolvedRoot = path.resolve(publicRoot);
  const resolved = path.resolve(path.join(resolvedRoot, fileName));
  if (!isWithinPublicRoot(resolved, publicRoot)) {
    return null;
  }
  if (!statRegularNonSymlinkFile(resolved)) {
    return null;
  }
  return resolved;
}

function isEligibleSideloadRequestMethod(method: string | undefined): boolean {
  return method === 'GET' || method === 'HEAD';
}

function extractSideloadRequestPathname(url: string): string {
  return (url.split('?')[0] ?? '').split('#')[0] ?? '';
}

function writeSideloadApkFileResponse(
  res: http.ServerResponse,
  resolved: string,
  method: string | undefined
): void {
  const fileName = path.basename(resolved);
  const stat = fs.statSync(resolved);
  res.writeHead(200, {
    'content-type': 'application/vnd.android.package-archive',
    'content-length': stat.size,
    'content-disposition': `attachment; filename="${fileName}"`,
    'cache-control': 'no-store',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(resolved).pipe(res);
}

function tryServeSideloadApk(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetPath: string,
  url: string
): boolean {
  if (!isEligibleSideloadRequestMethod(req.method)) {
    return false;
  }
  const pathname = extractSideloadRequestPathname(url);
  if (!pathname.startsWith(SIDELOAD_APK_NAMESPACE_PREFIX)) {
    return false;
  }
  if (!SIDELOAD_APK_PATH.test(pathname)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return true;
  }
  const resolved = resolveSideloadApkFile(pathname, sideloadApkPublicDir(targetPath));
  if (!resolved) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return true;
  }
  writeSideloadApkFileResponse(res, resolved, req.method);
  return true;
}

function queryToken(url: string): string | undefined {
  return parseQueryCredential(url);
}

// BL-788: applicationId the shipped Bubble build installs under. Single
// source of truth for the pairing page's intent:// link -
// bl788BubblePairingInvariants.property.test.js parses
// android/app/build.gradle.kts's applicationId and asserts it never drifts
// from this constant (invariant 2: the bridge must never hand the phone a
// package id the build declares differently).
export const BUBBLE_APPLICATION_ID = 'com.swarmforge.float';

const PAIR_PAGE_PATH = '/pair';

function isPairPagePath(pathname: string): boolean {
  return pathname === PAIR_PAGE_PATH;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// BL-788: pre-auth pairing page. A phone that has never paired has no
// bearer token to send, so - like the sideload APK route above - this is
// gated by a query-string credential rather than an Authorization header.
// The intent:// link is a plain, clickable <a> (never an auto-navigating
// <meta refresh> or script redirect to a bare swarmforge-bubble:// URL):
// the old hotfix's bare custom-scheme auto-redirect failed silently with no
// fallback when Bubble was not yet installed. Exported for direct unit
// testing without needing a live HTTP round trip.
export function buildPairPageHtml(bridgeUrl: string, token: string): string {
  const intentHref =
    `intent://pair?url=${encodeURIComponent(bridgeUrl)}&token=${encodeURIComponent(token)}` +
    `#Intent;scheme=swarmforge-bubble;package=${BUBBLE_APPLICATION_ID};end`;
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>Pair Bubble</title></head><body>',
    '<h1>Pair the Bubble app</h1>',
    `<p><a href="${escapeHtml(intentHref)}">Open in Bubble</a></p>`,
    "<p>If the button does nothing (Bubble not installed, or the browser blocks intent: links), copy these into Bubble's Settings screen by hand:</p>",
    `<p>Bridge URL: <code>${escapeHtml(bridgeUrl)}</code></p>`,
    `<p>Token: <code>${escapeHtml(token)}</code></p>`,
    '</body></html>',
  ].join('\n');
}

function tryServePairPage(res: http.ServerResponse, url: string, host: string | undefined, registry: DeviceRegistry): boolean {
  const pathname = extractSideloadRequestPathname(url);
  if (!isPairPagePath(pathname)) {
    return false;
  }
  if (!isAuthorizedByQueryToken(queryToken(url), primaryTokenOf(registry))) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return true;
  }
  const token = primaryTokenOf(registry);
  const bridgeUrl = `https://${host ?? ''}`;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(buildPairPageHtml(bridgeUrl, token));
  return true;
}

// BL-866: companion-manifest + package catalog. Neither fits the JsonRoute
// table (always-200) shape below - a package request needs 304/404/503
// depending on generation/readability - so both are handled by this one
// boolean-returning dispatcher, same extract-and-return-handled shape as
// tryServeSideloadApk above. Extracted (rather than left inline in the
// request listener) to keep that listener's own CRAP from absorbing this
// block's complexity - this block is independently 100%-covered by
// companionManifest.test.js and bridgeServer.test.js's own companion-route
// tests.
function tryServeCompanionRoutes(res: http.ServerResponse, url: string, targetPath: string): boolean {
  if (isCompanionManifestPath(url)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ packages: listCompanionPackages(targetPath) }));
    return true;
  }
  if (!isCompanionPackagePath(url)) {
    return false;
  }
  const { name, generation } = parseCompanionPackageRequest(url);
  const result = readCompanionPackage(targetPath, name, generation);
  if (result.status === 'unknown') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown_package', name: result.name, reason: result.reason }));
    return true;
  }
  if (result.status === 'unreadable') {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unreadable_package', name: result.name, reason: result.reason }));
    return true;
  }
  if (result.status === 'unchanged') {
    res.writeHead(304, { etag: result.generation });
    res.end();
    return true;
  }
  res.writeHead(200, { 'content-type': 'application/json', etag: result.generation });
  res.end(
    JSON.stringify({
      name: result.name,
      generation: result.generation,
      format: result.format,
      formatVersion: result.formatVersion,
      data: result.data,
    })
  );
  return true;
}

// BL-094/BL-241: every route stays header-only EXCEPT the root HTML shell,
// which a plain browser navigation cannot attach a header to - it
// additionally accepts the token via query string (see bridgeAuth.ts's own
// comment). Read auth accepts ANY non-revoked device regardless of scope -
// unchanged from BL-065's original "one token, full read access" model,
// just generalized to a roster. The stronger control-only check lives in
// isAuthorizedForControl below.
// Root HTML uses query token client-side; Mini App JSON polls (/resident-pane,
// /pipeline-board, /paused-pager-state, /epic-reorder-state, /context-budget-
// state) also accept it because those fetches cannot set an Authorization
// header. Table-driven (BL-572), same reason buildJsonRoutes/writeRoutes are:
// each new query-token-eligible path is another row here, never another `||`
// growing isAuthorizedForRead's own branch count past the CRAP<=6 gate.
const QUERY_TOKEN_ELIGIBLE_PATHS: Array<(url: string) => boolean> = [
  isRootPath,
  isResidentPanePath,
  isPipelineBoardPath,
  isPausedPagerStatePath,
  isEpicReorderStatePath,
  isContextBudgetStatePath,
];

function isAuthorizedForRead(authHeader: string | undefined, url: string, registry: DeviceRegistry): boolean {
  if (findDeviceByToken(registry, extractBearerToken(authHeader))) {
    return true;
  }
  return (
    QUERY_TOKEN_ELIGIBLE_PATHS.some((matches) => matches(url)) &&
    isAuthorizedByQueryToken(queryToken(url), primaryTokenOf(registry))
  );
}

// BL-241 control-requires-step-up-04: control actions require a SEPARATE
// X-Control-Token header in addition to the normal bearer - a genuinely
// stronger auth step than read-only viewing needs, never satisfiable by a
// read-scoped device (it has no control token at all).
function isAuthorizedForControl(req: http.IncomingMessage, url: string, registry: DeviceRegistry): boolean {
  const queryCred = parseQueryCredential(url);
  const bearer = extractBearerToken(req.headers.authorization) ?? queryCred;
  const stepUpHeader = req.headers['x-control-token'];
  const stepUp = typeof stepUpHeader === 'string' ? stepUpHeader : queryCred;
  return Boolean(findDeviceByControlToken(registry, bearer, stepUp));
}

interface JsonRoute {
  matches: (url: string) => boolean;
  compute: (url: string) => unknown;
}

// BL-538: compute paused-pager JSON state from backlog paused tickets.
// ORDER: paused tickets sorted by priority ascending (lower number = higher
// urgency), then by ticket id ascending. Includes YAML text and a simple
// canExpedite flag per item.
function computePausedPagerState(targetPath: string): unknown {
  const folders = readBacklogFolders(targetPath);
  const paused = folders.paused.slice();

  if (!paused || paused.length === 0) {
    return { items: [], index: 0, total: 0 };
  }

  const MAX_PRIORITY = Number.MAX_SAFE_INTEGER;

  const sorted = paused.sort((a: BacklogItem, b: BacklogItem) => {
    const pa = a.priority ?? MAX_PRIORITY;
    const pb = b.priority ?? MAX_PRIORITY;
    if (pa !== pb) {
      return pa - pb;
    }
    // Tie-breaker: id ascending.
    return a.id.localeCompare(b.id);
  });

  const items = sorted.map((item) => {
    let yamlText: string | undefined;
    if (item.filename) {
      const filePath = path.join(targetPath, 'backlog', 'paused', item.filename);
      try {
        yamlText = fs.readFileSync(filePath, 'utf8');
      } catch {
        yamlText = undefined;
      }
    }
    return {
      id: item.id,
      title: item.title,
      yaml: yamlText,
      canExpedite: true,
      canApprove: item.humanApproval === 'pending',
    };
  });

  return { items, index: 0, total: items.length };
}

function queryParams(url: string): URLSearchParams {
  const queryIndex = url.indexOf('?');
  return new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1));
}

// GH-23: compute Context Budget JSON state. The picked agent is the one
// named by ?agent=, or (when absent) the first of GH-22's distinct-agents
// list - never re-derived here, always context_telemetry_cli.bb's own
// `agents`/`summary` output. An explicitly-named agent is honored even if it
// has zero recorded events (the CLI's summary still returns a valid
// all-null shape for it) so the required "no telemetry for this agent yet"
// empty state is reachable by name, not just via the picker.
function buildContextBudgetState(targetPath: string, url: string): unknown {
  const params = queryParams(url);
  const agents = listTelemetryAgents(targetPath);
  const requested = params.get('agent');
  const agent = requested || agents[0] || null;
  const summary = agent ? summarizeTelemetryForAgent(targetPath, agent) : null;
  return { agents, agent, summary };
}

// BL-551 (bridge-08): same ranking/rollup logic the swarm-cost-rank CLI
// exposes, over HTTP. An unknown/missing horizon degrades to '24h' rather
// than erroring - this table has no notion of a 400 response, every route
// here always computes SOMETHING (BL-096/BL-100 precedent).
function buildCostRankState(targetPath: string, url: string, nowMs?: number): unknown {
  const params = queryParams(url);
  const horizonParam = params.get('horizon') ?? '';
  const horizon = isKnownLlmCostHorizon(horizonParam) ? horizonParam : '24h';
  const topParam = params.get('top');
  const topN = topParam ? Number.parseInt(topParam, 10) : undefined;
  const groupBy = (params.get('groupBy') ?? '').split(',').filter(isKnownOriginDimension);
  const records = readLlmInvocationRecords(targetPath);
  const horizonMs = LLM_COST_HORIZONS_MS[horizon];
  const effectiveNowMs = nowMs ?? Date.now();

  if (groupBy.length > 0) {
    return { horizon, groups: rollupLlmInvocationsByOrigin(records, { horizonMs, nowMs: effectiveNowMs, groupBy }) };
  }
  return { horizon, ...rankLlmInvocations(records, { horizonMs, nowMs: effectiveNowMs, topN: Number.isFinite(topN) && topN! > 0 ? topN : undefined }) };
}

// Every route below except /events (and the root HTML shell, a different
// content-type entirely) follows the same "match, compute JSON, respond
// 200" shape. A data-driven table instead of one `if` per route keeps the
// request handler's own complexity flat as routes are added - BL-096's
// /metrics and BL-100's /cost-telemetry each pushed the handler's
// per-branch version back over the CRAP<=6 gate in turn; a future route
// only ever adds a table entry here, never another handler branch.
function buildJsonRoutes(targetPath: string, runLogPath: string, nowMs?: number): JsonRoute[] {
  return [
    {
      matches: isStateRoute,
      compute: (url) => stateForRoute(buildBridgeState(targetPath, runLogPath), url as StateRoute),
    },
    {
      matches: (url) => url === '/metrics',
      compute: () => buildDeliveryMetricsState(targetPath),
    },
    {
      matches: (url) => url === '/cost-telemetry',
      compute: () => buildCostTelemetryState(targetPath),
    },
    {
      matches: (url) => url === '/holistic',
      compute: () => buildHolisticState(targetPath, runLogPath),
    },
    {
      matches: (url) => url === '/stage-dwell',
      compute: () => buildStageDwellState(targetPath, nowMs),
    },
    {
      matches: (url) => url === '/gates',
      compute: () => filterPendingGates(computeRoleGateStatesLive(targetPath, readSwarmRoles(targetPath).map((r) => r.role))),
    },
    {
      matches: (url) => url === '/burn-rate',
      compute: () => buildBurnRateState(targetPath, nowMs),
    },
    {
      matches: isCostRankPath,
      compute: (url) => buildCostRankState(targetPath, url, nowMs),
    },
    {
      matches: isResidentPanePath,
      compute: () => captureMonoRouterLiveScreen(targetPath, nowMs),
    },
    {
      matches: isPipelineBoardPath,
      compute: () => capturePipelineGridLive(targetPath, nowMs),
    },
    {
      // BL-538: paused-ticket pager JSON feed for the Mini App.
      matches: isPausedPagerStatePath,
      compute: () => computePausedPagerState(targetPath),
    },
    {
      // BL-572: epic priority reorder JSON feed for the Mini App.
      matches: isEpicReorderStatePath,
      compute: () => computeEpicReorderState(targetPath),
    },
    {
      // GH-23: Context Budget dashboard JSON feed for the Mini App.
      matches: isContextBudgetStatePath,
      compute: (url) => buildContextBudgetState(targetPath, url),
    },
    {
      // BL-763: Bubble capability flags (e.g. bridgeBounceAutoSessionReset)
      // — the module already existed (BL-864 built it for voiceEngineSwitch,
      // read internally by letsTalkAudioEngineRoutes.ts) but was never wired
      // to a served route of its own until now.
      matches: isLetsTalkBubbleConfigPath,
      compute: () => getLetsTalkBubbleConfig(targetPath, process.env),
    },
  ];
}

export function startBridge(
  targetPath: string,
  runLogPath: string,
  tokenOrRegistry: string | DeviceRegistry,
  options: StartBridgeOptions = {}
): Promise<BridgeHandle> {
  const port = options.port ?? 0;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  return new Promise((resolve) => {
    const sseClients = new Set<http.ServerResponse>();
    let lastSnapshot: string | undefined;
    let registry: DeviceRegistry = normalizeToRegistry(tokenOrRegistry);

    // BL-863: transcribeAudio/synthesizeSpeech overrides (test/mock
    // injection, e.g. BL-696's step handlers) are resolved once here, same
    // as before overrides are deterministic and don't change over the
    // bridge's lifetime. The real, non-override path resolves fresh per
    // turn via resolveAudioForTurn below (required_wiring: resolution must
    // live in the turn path, not startup, or a stored engine preference
    // written between turns would not apply until a restart).
    const letsTalkOverrides = {
      transcribeAudio: options.letsTalk?.transcribeAudio,
      synthesizeSpeech: options.letsTalk?.synthesizeSpeech,
    };
    const hasLetsTalkOverrides = Boolean(letsTalkOverrides.transcribeAudio || letsTalkOverrides.synthesizeSpeech);
    const staticLetsTalkAudio = hasLetsTalkOverrides
      ? resolveLetsTalkAudioAdaptersFromEnv(process.env, letsTalkOverrides)
      : undefined;
    const letsTalkAgentSession = options.letsTalk?.agentSession ?? createLiveCursorBridgeAgentSession(targetPath);
    // BL-696: POST /lets-talk/turn, POST /lets-talk/new-session (write routes).
    const letsTalkWriteRoutes = createLetsTalkWriteRoutes(
      {
        agentSession: letsTalkAgentSession,
        ...(staticLetsTalkAudio?.kind === 'ok' ? staticLetsTalkAudio.adapters : {}),
        resolveAudioForTurn: hasLetsTalkOverrides
          ? undefined
          : () => {
              const { resolution, unreadablePreference } = resolveLetsTalkAudioForTurn(targetPath, process.env);
              if (unreadablePreference) {
                appendOperatorEvent(targetPath, {
                  type: 'lets-talk-audio-preference-unreadable',
                  at: new Date().toISOString(),
                });
              }
              return resolution;
            },
        onTurnSuccess: (turn) => {
          void mirrorLetsTalkTurnToBubble(targetPath, turn.transcript, turn.replyText).catch((err) => {
            const error = err instanceof Error ? err.message : String(err);
            console.error(`Bubble talk mirror rejected: ${error}`);
            appendOperatorEvent(targetPath, {
              type: 'bubble-talk-mirror-failed',
              error,
              at: new Date().toISOString(),
            });
          });
        },
      },
      (req, res, maxBytes, isShape, shapeErrorReason) => readValidatedBody(req, res, maxBytes, isShape, shapeErrorReason),
      requireLetsTalkControlAuth,
      respondJson
    );
    // BL-864: GET/POST /lets-talk/audio-engine — Bubble Settings reads and
    // writes the BL-863 voice-engine preference through here.
    const letsTalkAudioEngineRoutes = createLetsTalkAudioEngineRoutes(
      targetPath,
      requireLetsTalkControlAuth,
      respondJson,
      (req, res, maxBytes, isShape, shapeErrorReason) => readValidatedBody(req, res, maxBytes, isShape, shapeErrorReason)
    );
    // BL-763: GET /lets-talk/meta — a stable-per-process instanceId (+
    // startedAt), generated ONCE per startBridge() call so it changes only
    // on a real bounce (a fresh process re-running this function), never
    // mid-process. Bubble polls this to detect a bounce and refresh its
    // session (BL-763 session-01).
    const letsTalkMetaRoutes = createLetsTalkMetaRoutes(
      options.instanceId ?? randomUUID(),
      new Date(options.nowMs ?? Date.now()).toISOString(),
      requireLetsTalkControlAuth,
      respondJson
    );

    const server = http.createServer((req, res) => {
      const url = requestPath(req);

      if (isRootPath(url)) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        });
        res.end(getHolisticUiHtml());
        return;
      }

      // Mini App HTML shells — pre-auth like root so Telegram can open ?token=…
      if (isResidentSpyPath(url)) {
        serveMiniAppHtml(res, getResidentSpyUiHtml());
        return;
      }
      if (isConsolePath(url)) {
        serveMiniAppHtml(res, getConsoleMenuUiHtml());
        return;
      }
      if (isPipelineGridPath(url)) {
        serveMiniAppHtml(res, getPipelineGridUiHtml());
        return;
      }
      if (isPausedPagerPath(url)) {
        serveMiniAppHtml(res, getPausedPagerUiHtml());
        return;
      }
      if (isEpicReorderPath(url)) {
        serveMiniAppHtml(res, getEpicReorderUiHtml());
        return;
      }
      if (isContextBudgetPath(url)) {
        serveMiniAppHtml(res, getContextBudgetUiHtml());
        return;
      }
      if (url === '/lets-talk/manifest.json' || url.startsWith('/lets-talk/manifest.json?')) {
        // Bake bearer into start_url when present so the home-screen icon
        // launches signed in (Telegram WebView storage does not carry over
        // to the installed Chrome PWA).
        const manifestQuery = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
        const manifestParams = new URLSearchParams(manifestQuery);
        const manifestBearer = String(manifestParams.get('bearer') || manifestParams.get('token') || '').trim();
        const startUrl = manifestBearer
          ? `/lets-talk?bearer=${encodeURIComponent(manifestBearer)}`
          : '/lets-talk';
        res.writeHead(200, {
          'content-type': 'application/manifest+json',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify({
          name: "Let's Talk",
          short_name: "Let's Talk",
          start_url: startUrl,
          scope: '/lets-talk',
          display: 'standalone',
          orientation: 'portrait',
          theme_color: '#0d1117',
          background_color: '#0d1117',
          icons: [{ src: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 128 128%22><rect width=%22128%22 height=%22128%22 rx=%2224%22 fill=%22%230d1117%22/><circle cx=%2264%22 cy=%2264%22 r=%2232%22 fill=%22%2358a6ff%22/><path d=%22M52 56 a16 16 0 0 1 24 0%22 stroke=%22%230d1117%22 stroke-width=%224%22 fill=%22none%22/><circle cx=%2264%22 cy=%2272%22 r=%226%22 fill=%22%230d1117%22/></svg>', sizes: '128x128', type: 'image/svg+xml' }],
        }));
        return;
      }
      if (url === '/lets-talk/sw.js' || url.startsWith('/lets-talk/sw.js?')) {
        res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-cache' });
        res.end(`self.addEventListener('install',e=>{self.skipWaiting()});self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim())});self.addEventListener('fetch',e=>{});`);
        return;
      }
      if (isLetsTalkPath(url)) {
        const speechSetting = parseLetsTalkSpeechLanguage(process.env.LETS_TALK_SPEECH_LANGUAGE);
        const speechLocale = speechLocaleForLanguage(speechSetting === 'auto' ? 'en' : speechSetting);
        serveMiniAppHtml(res, getLetsTalkUiHtml(speechLocale));
        return;
      }

      // Public sideload APKs (no bearer) — must stay ahead of the 401 gate.
      if (tryServeSideloadApk(req, res, targetPath, url)) {
        return;
      }

      // BL-788: pre-auth pairing page — a phone that has never paired has
      // no bearer token to send, so this is gated by query token like the
      // sideload route above, not the Authorization header.
      if (tryServePairPage(res, url, req.headers.host, registry)) {
        return;
      }

      const writeRoute = [
        ...writeRoutes,
        ...letsTalkWriteRoutes,
        ...letsTalkAudioEngineRoutes,
        ...letsTalkMetaRoutes,
      ].find((route) => route.matches(req, url));
      if (writeRoute) {
        writeRoute.handle(req, res, targetPath, registry);
        return;
      }

      if (!isAuthorizedForRead(req.headers.authorization, url, registry)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      // BL-866: companion-manifest + package catalog - see
      // tryServeCompanionRoutes above.
      if (tryServeCompanionRoutes(res, url, targetPath)) {
        return;
      }

      if (url === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const snapshot = resolveEventsSnapshot(lastSnapshot, targetPath, runLogPath);
        res.write(`data: ${snapshot}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        relayEntriesFrom(readPersistedCursor(targetPath).ackedIndex, [res]);
        return;
      }

      const jsonRoute = buildJsonRoutes(targetPath, runLogPath, options.nowMs).find((route) => route.matches(url));
      if (jsonRoute) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(jsonRoute.compute(url)));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    let emittedIndex = readPersistedCursor(targetPath).ackedIndex;

    function broadcastSnapshotIfChanged(previousSnapshot: string | undefined): string {
      const snapshot = JSON.stringify(buildBridgeState(targetPath, runLogPath));
      if (snapshot === previousSnapshot) {
        return previousSnapshot;
      }
      for (const client of sseClients) {
        client.write(`data: ${snapshot}\n\n`);
      }
      return snapshot;
    }

    function relayEntriesFrom(sinceIndex: number, clients: Iterable<http.ServerResponse>): number {
      const { entries, totalLines } = readNewReplyOutboxEntries(targetPath, sinceIndex);
      for (const entry of entries) {
        const payload = JSON.stringify(entry);
        for (const client of clients) {
          client.write(`event: telegram-reply\ndata: ${payload}\n\n`);
        }
      }
      return totalLines;
    }

    const poll = setInterval(() => {
      if (sseClients.size === 0) {
        return;
      }
      lastSnapshot = broadcastSnapshotIfChanged(lastSnapshot);
      emittedIndex = relayEntriesFrom(emittedIndex, sseClients);
    }, pollIntervalMs);
    poll.unref();

    server.listen(port, LOCALHOST, () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: boundPort,
        get token() {
          return primaryTokenOf(registry);
        },
        registerDevice: (label, scope) => {
          const result = registerDevice(registry, label, scope);
          registry = result.registry;
          return result.device;
        },
        revokeDevice: (deviceId) => {
          registry = revokeDevice(registry, deviceId);
        },
        rotateToken: (deviceId) => {
          const result = rotateDeviceToken(registry, deviceId);
          if (!result) {
            return undefined;
          }
          registry = result.registry;
          return result.device;
        },
        getRegistry: () => registry,
        stop: () => {
          clearInterval(poll);
          for (const client of sseClients) {
            client.end();
          }
          sseClients.clear();
          server.close();
        },
      });
    });
  });
}
