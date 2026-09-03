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
  buildTrendsBoardState,
  buildBubbleHealthTrendsState,
  BridgeState,
} from './bridgeState';
import { buildStreamSnapshot } from './streamSnapshot';
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
import { getBubbleHostUiHtml, isBubbleHostPath } from './bubbleHostUiHtml';
import { getCatchUpUiHtml } from './catchUpUiHtml';
import {
  buildOperatorDocsIndexState,
  buildOperatorDocsPageState,
  getOperatorDocsUiHtml,
  isOperatorDocsIndexPath,
  isOperatorDocsPagePath,
  isOperatorDocsPath,
} from './operatorDocsHtml';
import {
  getBubbleHealthUiHtml,
  isBubbleHealthPath,
  isBubbleHealthTrendsPath,
} from './bubbleHealthHtml';
import { computeCatchUpStateLive } from './catchUpLive';
import { markMessageRead, readCatchUpReadState } from './catchUpReadState';
import { getEpicReorderUiHtml } from './epicReorderUiHtml';
import { getSpecTreeUiHtml } from './specTreeUiHtml';
import { computeDocsTree } from '../docs/docsTree';
import { sortEpicsByPriority, computeEpicReorder, EpicPriorityItem, ReorderDirection, PriorityWrite } from './epicReorderSafety';
import { computeMakeTopPriority, MakeTopItem, MakeTopResult, DependencyResolution } from './makeTopPrioritySafety';
import { computeEpicTopics, filterEpicsWithTopics, resolveTopicMembership } from './epicTopicSlugMatch';
import {
  recordApprovalReply,
  readRulingOptions,
  classifyApprovalRulingRequirement,
} from '../concierge/pendingApprovalReply';
import { requestConciergeTick } from '../concierge/conciergeTickRequest';
import { getContextBudgetUiHtml } from './contextBudgetUiHtml';
import { listTelemetryAgents, summarizeTelemetryForAgent } from './contextTelemetryGate';
import { runCommitIntegrity, commitApprovalWrites } from '../util/commitIntegrityRunner';
import { getLetsTalkUiHtml } from './letsTalkUiHtml';
import {
  createLetsTalkWriteRoutes,
  isLetsTalkPath,
  mergeBubbleHostIntoUiBundleManifest,
  mergeOperatorDocsIntoUiBundleManifest,
  mergeBubbleHealthIntoUiBundleManifest,
} from './letsTalkRoutes';
import { createWebUiFontSizeRoutes, isWebUiFontSizePath } from './webUiFontSizeRoutes';
import { resolveLetsTalkAudioAdaptersFromEnv } from './letsTalkAudio';
import { resolveLetsTalkAudioForTurn } from './letsTalkAudioPreference';
import { createLetsTalkAudioEngineRoutes } from './letsTalkAudioEngineRoutes';
import { createLetsTalkMetaRoutes } from './letsTalkMetaRoutes';
import { createAgentNotesRoutes } from './agentNotesRoutes';
import { getLetsTalkBubbleConfig, isLetsTalkBubbleConfigPath } from './letsTalkBubbleConfig';
import { getLetsTalkChiptunesCatalog, isLetsTalkChiptunesPath } from './letsTalkChiptunes';
import { getLetsTalkUiBundleManifest, isLetsTalkUiBundlePath } from './letsTalkUiBundle';
import {
  readHostActivityFeed,
  subscribeHostActivity,
} from './hostActivityFeed';
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
  sendTelegramPoll,
} from '../notify/telegramClient';
import { sendBubbleMirrorChunks, telegramMirrorEnv } from './bubbleMirrorDelivery';
import { appendPendingChoicePoll } from './bubbleMirrorState';
import {
  effectiveBubbleMirrorTopicId,
  readCursorBridgeTopicIds,
  type CursorBridgeTopicIds,
} from './bubbleMirrorTopic';
import type { MirrorLetsTalkTurnDeps, BubbleMirrorPollFn, BubbleMirrorSendFn } from './bubbleMirrorTypes';
export type { MirrorLetsTalkTurnDeps, BubbleMirrorPollFn, BubbleMirrorSendFn } from './bubbleMirrorTypes';
export { effectiveBubbleMirrorTopicId, mergeTopicId, readCursorBridgeTopicIds } from './bubbleMirrorTopic';
import { execFileSync } from 'child_process';
import { estimateEpicEta } from '../metrics/epicEta';

const DEFAULT_POLL_INTERVAL_MS = 1000;
// BL-1350: how often an idle /events connection is written to. Node's bundled
// undici applies a 300000 ms bodyTimeout BETWEEN BODY CHUNKS, and a silent
// stream therefore dies with `TypeError: terminated` after five idle minutes -
// which the front-desk relay counts as a reconnect FAILURE, so a quiet swarm
// read as a chronic outage and BL-1111's sustained-outage alert fired on a
// phantom one every 2-4 hours. 20000 ms is one fifteenth of that timeout,
// chosen for margin rather than measured.
const DEFAULT_SSE_KEEPALIVE_INTERVAL_MS = 20000;
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
// BL-545: mark-read body ({topicId, seq}) from the /catch-up Mini App.
const CATCH_UP_MARK_READ_MAX_BODY_BYTES = 4 * 1024;
// BL-572: move body ({id, direction}) from the /epic-reorder Mini App.
const EPIC_REORDER_MOVE_MAX_BODY_BYTES = 4 * 1024;
// BL-672: make-top body ({id}) from the same Mini App.
const EPIC_MAKE_TOP_MAX_BODY_BYTES = 4 * 1024;
// BL-673: topic make-top body ({epicId, topicId}).
const EPIC_TOPIC_MAKE_TOP_MAX_BODY_BYTES = 4 * 1024;

/**
 * BL-709: Let's Talk mirror destination.
 * Bound dedicated Bubble → Bubble only; unbound → previous Cursor Remote mirror.
 */
export function effectiveLetsTalkMirrorTopicId(topicIds: CursorBridgeTopicIds): number | undefined {
  const bubble = effectiveBubbleMirrorTopicId(topicIds);
  if (bubble !== undefined) {
    return bubble;
  }
  return typeof topicIds.cursorTopicId === 'number' ? topicIds.cursorTopicId : undefined;
}

/** BL-1311: Let's Talk mirror destination for a target path — resolves via effectiveLetsTalkMirrorTopicId, not effectiveBubbleMirrorTopicId. */
function letsTalkMirrorTopicForPath(targetPath: string): number | undefined {
  return effectiveLetsTalkMirrorTopicId(readCursorBridgeTopicIds(targetPath));
}

export function formatBubbleMirrorText(transcript: string, replyText: string): string {
  const you = transcript.trim();
  const agent = replyText.trim();
  if (you && agent) {
    return `You: ${you}\n\nBubble: ${agent}`;
  }
  return agent || you;
}

interface LetsTalkChoicePollSpec {
  question: string;
  options: string[];
}

function choicePollMirrorTarget(
  targetPath: string,
  replyText: string
): { topicId: number; spec: LetsTalkChoicePollSpec } | undefined {
  const topicId = letsTalkMirrorTopicForPath(targetPath);
  if (topicId === undefined) {
    return undefined;
  }
  const spec = extractLetsTalkChoicePoll(replyText);
  if (!spec) {
    return undefined;
  }
  return { topicId, spec };
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

async function mirrorLetsTalkChoicePollToBubble(
  targetPath: string,
  replyText: string,
  env: { botToken: string; chatId: string },
  deps: MirrorLetsTalkTurnDeps = {}
): Promise<void> {
  const target = choicePollMirrorTarget(targetPath, replyText);
  if (!target) {
    return;
  }
  const sendPoll = deps.sendPoll ?? sendTelegramPoll;
  const sent = await sendPoll(env.botToken, env.chatId, target.spec.question, target.spec.options, target.topicId);
  if (!sent.success || !sent.pollId) {
    return;
  }
  appendPendingChoicePoll(targetPath, sent.pollId, target.spec, target.topicId);
}

/** Best-effort mirror of Bubble / Let's Talk turns into the standing Bubble Telegram topic. */
export async function mirrorLetsTalkTurnToBubble(
  targetPath: string,
  transcript: string,
  replyText: string,
  deps: MirrorLetsTalkTurnDeps = {}
): Promise<void> {
  const env = telegramMirrorEnv();
  if (!env) {
    return;
  }
  const topicId = letsTalkMirrorTopicForPath(targetPath);
  if (topicId === undefined) {
    return;
  }
  const text = formatBubbleMirrorText(transcript, replyText);
  if (!text.trim()) {
    return;
  }
  const ok = await sendBubbleMirrorChunks(targetPath, env.botToken, env.chatId, topicId, text, deps);
  if (!ok) {
    return;
  }
  await mirrorLetsTalkChoicePollToBubble(targetPath, replyText, env, deps);
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
  // BL-1350: injectable so the suite can drive the keepalive on a fake clock
  // rather than waiting 20 s of real time (engineering.prompt, Test Speed And
  // Isolation - no real timers). pollIntervalMs is the precedent.
  keepaliveIntervalMs?: number;
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
//
// BL-1351: the fresh path goes through buildStreamSnapshot, the ONE producer
// of a stream frame, so a connecting client and an already-connected one see
// the same per-item shape (invariant 2). The cached `lastSnapshot` was
// produced by the same function in broadcastSnapshotIfChanged below.
function resolveEventsSnapshot(lastSnapshot: string | undefined, targetPath: string, runLogPath: string): string {
  return lastSnapshot ?? buildStreamSnapshot(targetPath, runLogPath);
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
  return url === '/resident-pane' || url.startsWith('/resident-pane?') || url.startsWith('/resident-pane/');
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

// BL-545: catch-up pager Mini App shell.
function isCatchUpPath(url: string): boolean {
  return url === '/catch-up' || url.startsWith('/catch-up?');
}

// BL-545: JSON state for the catch-up pager Mini App.
function isCatchUpStatePath(url: string): boolean {
  return url === '/catch-up-state' || url.startsWith('/catch-up-state?');
}

// BL-572: epic priority reorder Mini App shell.
function isEpicReorderPath(url: string): boolean {
  return url === '/epic-reorder' || url.startsWith('/epic-reorder?');
}

// BL-572: JSON state for the epic reorder Mini App.
function isEpicReorderStatePath(url: string): boolean {
  return url === '/epic-reorder-state' || url.startsWith('/epic-reorder-state?');
}

// BL-592: live read-only spec tree Mini App shell.
function isSpecTreePath(url: string): boolean {
  return url === '/spec-tree' || url.startsWith('/spec-tree?');
}

// BL-592: JSON state for the spec tree Mini App (computeDocsTree output).
function isSpecTreeStatePath(url: string): boolean {
  return url === '/spec-tree-state' || url.startsWith('/spec-tree-state?');
}

// GH-23: Context Budget dashboard Mini App shell.
function isContextBudgetPath(url: string): boolean {
  return url === '/context-budget' || url.startsWith('/context-budget?');
}

// GH-23: JSON state polled by the Context Budget Mini App with ?token=&agent=.
function isContextBudgetStatePath(url: string): boolean {
  return url === '/context-budget-state' || url.startsWith('/context-budget-state?');
}

// BL-1166: Operator docs Mini App shell and JSON feeds.
function isOperatorDocsIndexFeedPath(url: string): boolean {
  return isOperatorDocsIndexPath(url);
}

function isOperatorDocsPageFeedPath(url: string): boolean {
  return isOperatorDocsPagePath(url);
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

// BL-1367: the Approve tap may carry the option the human chose. Optional, so
// every existing caller and the other route sharing this shape are unaffected;
// a non-string `ruling` is rejected rather than coerced, because a ruling is
// written into the ticket and a coerced one would be a fabricated answer.
function isPausedPagerApproveRequestShape(value: unknown): value is { id: string; ruling?: string } {
  if (!isPausedPagerIdRequestShape(value)) {
    return false;
  }
  const ruling = (value as Record<string, unknown>).ruling;
  return ruling === undefined || typeof ruling === 'string';
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
      // BL-538: Expedite from paused-pager — reuse BL-490's promote step
      // (promote paused->active if present) and set priority 0 in the ticket
      // YAML. commitExpediteWrites/dispatch are owned by
      // telegramFrontDeskBotCore; here we only mutate YAML and folders.
      //
      // BL-1083: this comment used to say "force-promote", and it meant it -
      // this endpoint walked past depends_on, hold and the depth cap exactly
      // as the Telegram verb did. It is the SECOND caller of promoteToActive,
      // which is why the gate lives in the mover rather than here: a check
      // added to one caller would have left this one open, and this is the
      // path the operator uses from a phone.
      // BL-1083: the human's approval is recorded BEFORE the gates are
      // consulted, exactly as the Telegram Expedite verb does - so Expedite
      // SATISFIES the human_approval gate rather than being blocked by it. A
      // fix that let approval refuse an expedite would leave the verb dead,
      // which is the over-correction this ticket explicitly warns against. A
      // ticket that was not pending approval is already approved (or has no
      // ask at all), so `false` here is not an error.
      recordApprovalReply(targetPath, backlogId);
      const promotion = promoteToActive(targetPath, backlogId);
      if (promotion.refusal) {
        // 409, not 500: the request was well formed and the system is healthy;
        // a rule said no. The pager shows the gate's own words rather than a
        // bare status, so the operator learns WHICH gate and why (BL-572/662).
        respondJson(res, 409, {
          success: false,
          id: backlogId,
          gate: promotion.refusal.gate,
          reason: promotion.refusal.reason,
        });
        return;
      }
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
  backlogId: string,
  ruling?: string
): Promise<{ status: number; body: Record<string, unknown>; conciergeTick: boolean }> {
  if (!findBacklogFilePath(targetPath, backlogId)) {
    return { status: 404, body: { success: false, reason: 'ticket not found in active/paused' }, conciergeTick: false };
  }
  // BL-1367. This route used to call recordApprovalReply(targetPath,
  // backlogId) - a signature with no ruling parameter - so a ticket declaring
  // ruling_options was flipped to approved and its choice silently discarded.
  // BL-1309 was approved that way on 2026-09-01, its binary question never
  // answered, and the coder built on its own reading two days before QA caught
  // it. An approval that cannot carry its ruling is now REFUSED rather than
  // half-recorded: the half-recorded state is the one nobody can tell from a
  // complete answer.
  const requirement = classifyApprovalRulingRequirement(
    readRulingOptions(targetPath, backlogId),
    ruling
  );
  if (requirement.kind !== 'ok') {
    // 409, not 500: the request was well formed and the system is healthy; a
    // rule said no - the same posture the promotion gate takes one route up.
    // The options travel with the refusal so the pager can show the operator
    // WHICH choice is outstanding rather than a bare status (BL-572/BL-662).
    return {
      status: 409,
      body: {
        success: false,
        id: backlogId,
        reason: requirement.kind === 'ruling-required' ? 'ruling required' : 'unknown ruling option',
        options: requirement.options,
        detail:
          requirement.kind === 'ruling-required'
            ? `${backlogId} poses a choice and this tap carried no answer. Answer it on the bot's ruling keyboard, or send the chosen option with the approval.`
            : `${backlogId} declares no such option. Answer it on the bot's ruling keyboard, or send one of the options above.`,
      },
      conciergeTick: false,
    };
  }
  const changed = recordApprovalReply(targetPath, backlogId, ruling);
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
    isPausedPagerApproveRequestShape,
    'expected a JSON body of {id} or {id, ruling}'
  ).then(async (value) => {
    if (!value) {
      return;
    }
    try {
      const outcome = await computePausedPagerApproveOutcome(targetPath, value.id, value.ruling);
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

// BL-545: Catch-up mark-read request shape and route.
function isCatchUpMarkReadRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && (url === '/catch-up/mark-read' || url.startsWith('/catch-up/mark-read?'));
}

function isCatchUpMarkReadRequestShape(value: unknown): value is { topicId: string; seq: number } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).topicId === 'string' &&
    typeof (value as Record<string, unknown>).seq === 'number'
  );
}

function handleCatchUpMarkReadRoute(
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
    CATCH_UP_MARK_READ_MAX_BODY_BYTES,
    isCatchUpMarkReadRequestShape,
    'expected a JSON body of {topicId, seq}'
  ).then((value) => {
    if (!value) {
      return;
    }
    try {
      markMessageRead(targetPath, value.topicId, value.seq);
      respondJson(res, 200, { success: true, topicId: value.topicId, seq: value.seq });
    } catch (err) {
      respondJson(res, 500, {
        success: false,
        reason: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });
}


// BL-572: paused `type: epic` tickets, normalized to a required numeric
// priority and sorted. The reorder screen itself (and the move neighbour
// set) uses the child-bearing subset from readEpicReorderMembership, so a
// childless tracker is never an on-screen neighbour. Make-top still reads
// this full paused-epic list via readLiveBacklogItems's domination set.
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

// Shared by the reorder-state feed and the move route so a childless epic
// never appears as a tile AND never acts as a Move up / Move down neighbour.
function readEpicReorderMembership(targetPath: string) {
  const epics = readPausedEpics(targetPath);
  const topics = computeEpicTopics(readWithinEpicLiveBacklogItems(targetPath), epics);
  return { epics, topics, reorderable: filterEpicsWithTopics(epics, topics) };
}

// ── BL-591: per-epic velocity ETA, folded into the reorder tiles ─────────────
// The estimator itself is pure (extension/src/metrics/epicEta.ts); this is
// its impure collector. Completion events are when each backlog/done
// ticket YAML was ADDED (`git log --diff-filter=A`, the same approach
// leanLedgerComposeClose uses - burnRate.ts measures TOKEN burn, a
// different quantity). One commit can land several done files, so events
// are counted per FILE via --name-only, never per commit. The git spawn is
// TTL-cached in the bridge process: never one `git log` per
// /epic-reorder-state poll.

const EPIC_ETA_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;
const EPIC_ETA_CACHE_TTL_MS = 5 * 60 * 1000;
// Keyed on targetPath: one process can serve several bridges over
// DIFFERENT targets (the test fixtures do exactly this), and an unkeyed
// slot would leak one repo's completion history into another's ETA.
let epicEtaCompletionCache: { targetPath: string; atMs: number; events: number[] } | null = null;

function readEpicEtaCompletionEvents(targetPath: string, nowMs: number): number[] {
  if (
    epicEtaCompletionCache &&
    epicEtaCompletionCache.targetPath === targetPath &&
    nowMs - epicEtaCompletionCache.atMs < EPIC_ETA_CACHE_TTL_MS
  ) {
    return epicEtaCompletionCache.events;
  }
  let events: number[] = [];
  try {
    const out = execFileSync(
      'git',
      ['log', '--diff-filter=A', '--since=28 days ago', '--format=%ct', '--name-only', '--', 'backlog/done/'],
      { cwd: targetPath, encoding: 'utf8' }
    );
    let currentMs = NaN;
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (/^\d+$/.test(trimmed)) {
        currentMs = parseInt(trimmed, 10) * 1000;
      } else if (trimmed.endsWith('.yaml') && Number.isFinite(currentMs)) {
        events.push(currentMs);
      }
    }
  } catch {
    // Advisory display only: an unreadable history degrades to the
    // estimator's honest no-recent-pace state, never a fabricated range.
    events = [];
  }
  epicEtaCompletionCache = { targetPath, atMs: nowMs, events };
  return events;
}

// The pack the pace assumption names (invariant 1) - the measured ~5x
// throughput swing between packs dwarfs every other factor, so an ETA that
// does not name its pack is close to meaningless.
function epicEtaPackLabel(targetPath: string): string {
  if (process.env.SWARMFORGE_PACK) {
    return process.env.SWARMFORGE_PACK;
  }
  try {
    const identity = fs.readFileSync(path.join(targetPath, '.swarmforge', 'swarm-identity'), 'utf8');
    const match = identity.match(/^launch_pack\t(.+)$/m);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  } catch {
    // fall through to the honest label below
  }
  return 'unknown-pack';
}

function computeEpicReorderState(targetPath: string): unknown {
  const { topics, reorderable } = readEpicReorderMembership(targetPath);
  // BL-672's own paused+hold domination set - kept for hasLiveDependency's
  // dependency-liveness check ONLY (invariant 2: widening the drill-down's
  // MEMBERSHIP must never widen what counts as a live dependency).
  const liveItems = readLiveBacklogItems(targetPath);
  const liveIds = new Set(liveItems.map((item) => item.id));
  // Childless trackers are omitted from `items` (and from the move neighbour
  // set) so an empty shell cannot swallow a tap. Topics still span paused +
  // hold + active (BL-687), resolved by slug (BL-686).
  // BL-591: fold the pure estimator's per-epic output into the tiles. An
  // epic's children are the SAME slug-resolved topics the drill-down uses
  // (active+paused+hold, BL-686/BL-687) - never a second membership notion.
  const etaNowMs = Date.now();
  const etaCompletionsMs = readEpicEtaCompletionEvents(targetPath, etaNowMs);
  const etaPackLabel = epicEtaPackLabel(targetPath);
  return {
    items: reorderable.map((epic) => ({
      id: epic.id,
      title: epic.title,
      priority: epic.priority,
      epicEta: estimateEpicEta({
        children: topics.filter((topic) => topic.epicIds.includes(epic.id)),
        completionsMs: etaCompletionsMs,
        nowMs: etaNowMs,
        windowMs: EPIC_ETA_WINDOW_MS,
        packLabel: etaPackLabel,
      }),
    })),
    total: reorderable.length,
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

// BL-572: the epic reorder screen's write route. Reads the same child-
// bearing paused-epic subset the screen was built from, asks the pure
// decision core which files change, applies those as atomic writes, then
// commits them - scenario 06's "committed to main" is not a separate step,
// it is part of what a successful move means. A move is never refused by
// the decision core except at the true list boundary (first epic up / last
// epic down); that boundary answers changed:false with a human-readable
// reason the screen must display (architect bounce #2's response-contract
// finding) rather than a payload indistinguishable from success. A
// childless tracker is not a neighbour here, matching the tiles.
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
    const { reorderable } = readEpicReorderMembership(targetPath);
    if (!reorderable.some((epic) => epic.id === value.id)) {
      respondJson(res, 404, { success: false, reason: 'epic not found in paused' });
      return;
    }
    const result = computeEpicReorder(reorderable, value.id, value.direction);
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
}): (T & MakeTopItem & { inFlight: boolean; held: boolean })[] {
  const MAX_PRIORITY = Number.MAX_SAFE_INTEGER;
  // BL-591: `held` marks the hold/ folder - one input of the epic-ETA
  // blocked predicate (a held child never contributes weight to a
  // velocity-derived duration). Additive alongside inFlight; no consumer
  // of the existing fields changes.
  const tag =
    (inFlight: boolean, held: boolean) =>
    (item: T): T & MakeTopItem & { inFlight: boolean; held: boolean } => ({
      ...item,
      priority: item.priority ?? MAX_PRIORITY,
      dependsOn: item.dependsOn ?? [],
      inFlight,
      held,
    });
  const within = [
    ...folders.paused.map(tag(false, false)),
    ...folders.hold.map(tag(false, true)),
    ...folders.active.map(tag(true, false)),
  ];
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
  // BL-545: catch-up mark-read route, control-scoped.
  { matches: isCatchUpMarkReadRoute, handle: handleCatchUpMarkReadRoute },
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
  isCatchUpStatePath,
  isEpicReorderStatePath,
  isSpecTreeStatePath,
  isContextBudgetStatePath,
  isWebUiFontSizePath,
  isOperatorDocsIndexFeedPath,
  isOperatorDocsPageFeedPath,
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
      // BL-603: the behaviour-trend board's data. Read-only, and served
      // only here on the token-authed bridge - never from the static
      // backlog-dashboard PWA (Architecture rule 5).
      matches: (url) => url === '/trends',
      compute: () => buildTrendsBoardState(targetPath, nowMs),
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
      // BL-545: catch-up pager JSON feed for the Mini App.
      matches: isCatchUpStatePath,
      compute: () => computeCatchUpStateLive(targetPath, readCatchUpReadState(targetPath), nowMs),
    },
    {
      // BL-572: epic priority reorder JSON feed for the Mini App.
      matches: isEpicReorderStatePath,
      compute: () => computeEpicReorderState(targetPath),
    },
    {
      // BL-592: live spec navigation tree JSON feed for the Mini App.
      matches: isSpecTreeStatePath,
      compute: () => computeDocsTree(targetPath, nowMs),
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
    {
      // BL-765: hold-music catalog as data — the module landed (f175bc56d)
      // but was never wired to a served route, same dead-code shape BL-763
      // fixed for bubble-config.
      matches: isLetsTalkChiptunesPath,
      compute: () => getLetsTalkChiptunesCatalog(),
    },
    {
      // BL-825 slice A: versioned UI bundle manifest — same sibling shape
      // as bubble-config/chiptunes above, so Android's UiBundleResolver can
      // decide fresh/cached/stale/bare from what this route actually serves.
      matches: isLetsTalkUiBundlePath,
      compute: () =>
        mergeBubbleHostIntoUiBundleManifest(
          mergeBubbleHealthIntoUiBundleManifest(
            mergeOperatorDocsIntoUiBundleManifest(getLetsTalkUiBundleManifest(targetPath, process.env))
          )
        ),
    },
    {
      // BL-832: Health page JSON — same readouts as bubbleHealthCore, on demand.
      matches: isBubbleHealthTrendsPath,  // health-trends JSON feed
      compute: () => buildBubbleHealthTrendsState(targetPath, nowMs),
    },
    {
      // BL-1166: Operator docs index derived from docs/index.md.
      matches: isOperatorDocsIndexFeedPath,
      compute: () => buildOperatorDocsIndexState(targetPath),
    },
    {
      // BL-1166: one authored markdown page rendered as HTML JSON.
      matches: isOperatorDocsPageFeedPath,
      compute: (url) => buildOperatorDocsPageState(targetPath, url),
    },
    {
      // BL-833: host-agent activity feed (catch-up read of the same buffer SSE pushes).
      matches: (url) => url === '/host-activity',
      compute: () => readHostActivityFeed(),
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
  const keepaliveIntervalMs = options.keepaliveIntervalMs ?? DEFAULT_SSE_KEEPALIVE_INTERVAL_MS;

  return new Promise((resolve) => {
    const sseClients = new Set<http.ServerResponse>();
    let lastSnapshot: string | undefined;
    let registry: DeviceRegistry = normalizeToRegistry(tokenOrRegistry);
    // hostActivityStream — live push channel for BL-834 Host page (SSE /events).
    const unsubscribeHostActivity = subscribeHostActivity(({ sessionId, line }) => {
      const payload = JSON.stringify({ sessionId, line });
      for (const client of sseClients) {
        client.write(`event: host-activity\ndata: ${payload}\n\n`);
      }
    });

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
    const webUiFontSizeRoutes = createWebUiFontSizeRoutes(
      requireControlAuth,
      respondJson,
      (req, res, maxBytes, isShape, shapeErrorReason) => readValidatedBody(req, res, maxBytes, isShape, shapeErrorReason)
    );
    // BL-790: POST /agent-notes — authenticated note queue (agentNotesRoutes).
    const agentNotesRoutes = createAgentNotesRoutes(
      requireControlAuth,
      respondJson,
      (req, res, maxBytes, isShape, shapeErrorReason) => readValidatedBody(req, res, maxBytes, isShape, shapeErrorReason)
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
      if (isCatchUpPath(url)) {
        serveMiniAppHtml(res, getCatchUpUiHtml());
        return;
      }
      if (isEpicReorderPath(url)) {
        serveMiniAppHtml(res, getEpicReorderUiHtml());
        return;
      }
      if (isSpecTreePath(url)) {
        serveMiniAppHtml(res, getSpecTreeUiHtml());
        return;
      }
      if (isContextBudgetPath(url)) {
        serveMiniAppHtml(res, getContextBudgetUiHtml());
        return;
      }
      if (isOperatorDocsPath(url)) {
        serveMiniAppHtml(res, getOperatorDocsUiHtml());
        return;
      }
      if (isBubbleHealthPath(url)) {
        serveMiniAppHtml(res, getBubbleHealthUiHtml());
        return;
      }
      if (isBubbleHostPath(url)) {
        serveMiniAppHtml(res, getBubbleHostUiHtml());
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
        ...webUiFontSizeRoutes,
        ...agentNotesRoutes,
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
      // BL-1351: same single producer the connect frame uses.
      const snapshot = buildStreamSnapshot(targetPath, runLogPath);
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

    // BL-1350. Named `writeSseKeepalive` and defined HERE, in the module that
    // owns sseClients and the timers, because a keepalive helper that is
    // unit-tested but never reached from the running server would leave the
    // defect fully unfixed behind a green suite (BL-1235).
    //
    // The frame is an SSE COMMENT, which is inert to every consumer of this
    // stream: a browser EventSource ignores comments natively, and this repo's
    // own reader finds neither an `event: ` nor a `data: ` line in it, so no
    // reply is delivered, none acknowledged, and no cursor moves. Holding the
    // socket open is all it does.
    function writeSseKeepalive(clients: Iterable<http.ServerResponse>): number {
      let written = 0;
      for (const client of clients) {
        // A client that has gone away is dropped rather than written to: the
        // close handler removes it, but a write racing that removal must not
        // throw out of the timer and kill the loop for every other client.
        if (client.writableEnded || client.destroyed) {
          sseClients.delete(client);
          continue;
        }
        try {
          client.write(': keepalive\n\n');
          written += 1;
        } catch {
          sseClients.delete(client);
        }
      }
      return written;
    }

    const keepalive = setInterval(() => {
      if (sseClients.size === 0) {
        return;
      }
      writeSseKeepalive(sseClients);
    }, keepaliveIntervalMs);
    keepalive.unref();

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
          clearInterval(keepalive);
          unsubscribeHostActivity();
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
