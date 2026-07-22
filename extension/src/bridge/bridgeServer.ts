/// BL-094/BL-241/BL-522/BL-526/BL-538 bridge server: HTTP entrypoint for
/// SwarmForge's read JSON routes, SSE feed, Mini App shells, and a handful
/// of control-scoped POST routes (gate answers, Telegram inbound, reply
/// ack, paused-pager expedite).

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildBridgeState,
  buildDeliveryMetricsState,
  buildCostTelemetryState,
  buildHolisticState,
  buildStageDwellState,
  buildBurnRateState,
  BridgeState,
} from './bridgeState';
import { extractBearerToken, isAuthorizedByQueryToken } from './bridgeAuth';
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
// BL-538: Expedite body ({id}) from the /paused-pager Mini App.
const PAUSED_PAGER_EXPEDITE_MAX_BODY_BYTES = 4 * 1024;

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
  if (!isAuthorizedForControl(req, registry)) {
    respondJson(res, 403, { success: false, reason: 'control auth required' });
    return false;
  }
  return true;
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

// BL-538: Paused-pager Expedite request shape and route.
function isPausedPagerExpediteRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && (url === '/paused-pager/expedite' || url.startsWith('/paused-pager/expedite?'));
}

function isPausedPagerExpediteRequestShape(value: unknown): value is { id: string } {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string';
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
    PAUSED_PAGER_EXPEDITE_MAX_BODY_BYTES,
    isPausedPagerExpediteRequestShape,
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
      const PRIORITY_LINE = /^priority:\s*.+$/m;
      let updated: string;
      if (PRIORITY_LINE.test(content)) {
        updated = content.replace(PRIORITY_LINE, 'priority: 0');
      } else {
        updated = content.trimEnd() + '\npriority: 0\n';
      }
      atomicWrite(filePath, updated);
      respondJson(res, 200, { success: true, id: backlogId });
    } catch (err) {
      respondJson(res, 500, {
        success: false,
        reason: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });
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
  // BL-538: paused-pager Expedite route, control-scoped.
  { matches: isPausedPagerExpediteRoute, handle: handlePausedPagerExpediteRoute },
];

function requestPath(req: http.IncomingMessage): string {
  return req.url ?? '/';
}

function queryToken(url: string): string | undefined {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) {
    return undefined;
  }
  return new URLSearchParams(url.slice(queryIndex + 1)).get('token') ?? undefined;
}

// BL-094/BL-241: every route stays header-only EXCEPT the root HTML shell,
// which a plain browser navigation cannot attach a header to - it
// additionally accepts the token via query string (see bridgeAuth.ts's own
// comment). Read auth accepts ANY non-revoked device regardless of scope -
// unchanged from BL-065's original "one token, full read access" model,
// just generalized to a roster. The stronger control-only check lives in
// isAuthorizedForControl below.
function isAuthorizedForRead(authHeader: string | undefined, url: string, registry: DeviceRegistry): boolean {
  if (findDeviceByToken(registry, extractBearerToken(authHeader))) {
    return true;
  }
  // Root HTML uses query token client-side; Mini App JSON polls
  // (/resident-pane, /pipeline-board, /paused-pager-state) also accept it because those fetches
  // cannot set an Authorization header.
  return (isRootPath(url) || isResidentPanePath(url) || isPipelineBoardPath(url) || isPausedPagerStatePath(url))
    && isAuthorizedByQueryToken(queryToken(url), primaryTokenOf(registry));
}

// BL-241 control-requires-step-up-04: control actions require a SEPARATE
// X-Control-Token header in addition to the normal bearer - a genuinely
// stronger auth step than read-only viewing needs, never satisfiable by a
// read-scoped device (it has no control token at all).
function isAuthorizedForControl(req: http.IncomingMessage, registry: DeviceRegistry): boolean {
  const bearer = extractBearerToken(req.headers.authorization);
  const stepUp = req.headers['x-control-token'];
  return Boolean(findDeviceByControlToken(registry, bearer, typeof stepUp === 'string' ? stepUp : undefined));
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
    };
  });

  return { items, index: 0, total: items.length };
}

function queryParams(url: string): URLSearchParams {
  const queryIndex = url.indexOf('?');
  return new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1));
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
      compute: () => captureMonoRouterLiveScreen(targetPath),
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

      if (!isAuthorizedForRead(req.headers.authorization, url, registry)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
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

      const writeRoute = writeRoutes.find((route) => route.matches(req, url));
      if (writeRoute) {
        writeRoute.handle(req, res, targetPath, registry);
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
