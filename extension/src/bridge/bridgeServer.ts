import * as http from 'http';
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
import { answerCapturedGateLive } from './gateAnswerLive';
import { computeRoleGateStatesLive, filterPendingGates } from './gateSnapshot';
import { readSwarmRoles } from '../swarm/tmuxClient';
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

// BL-240: matcher + handler for the write route, split out of the main
// request dispatcher (mirroring this file's existing route-predicate style,
// e.g. isRootPath/isStateRoute) so the new branch's own if/&&/body-parsing
// doesn't grow the dispatcher's own complexity - the same "table instead of
// per-route branch" reasoning buildJsonRoutes's comment above documents,
// applied to a route whose body-read + non-200 statuses don't fit that
// table's uniform "match, compute JSON, respond 200" shape.
function isGateAnswerRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && url === '/gate-answer';
}

// BL-241 control-requires-step-up-04: the step-up check is enforced here
// (not in the dispatcher) so the dispatcher's own complexity stays flat as
// this route's auth grows - a read-scoped device passes the dispatcher's
// read-level gate (it can view) but is refused here (read-only-cannot-
// control-03).
// Shared by handleGateAnswerRoute/handleTelegramInboundRoute below - both
// are control-scoped write routes with the exact same auth-check/body-cap/
// shape-validate shell around a different action; factored out so a
// future write route reuses this shell instead of a third copy of it.
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

// Split out of isTelegramInboundRequestShape below to keep that function's
// own CRAP under the project's cap (cleaner pass, BL-369): updateId is
// optional, so a missing one is as valid as a numeric one.
function isValidOptionalUpdateId(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

// BL-281: {subjectId, channel, text} - the Front Desk Bot has ALREADY
// resolved which SUP-### thread this belongs to (topic<->SUP-### mapping
// is entirely bot-owned); the bridge only ever ingests an already-resolved
// subject, never a raw Telegram update. BL-369: updateId (Telegram's own
// update_id) is optional so an older/other caller with no update behind it
// still ingests exactly as before - dedup is simply unavailable without it.
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

// Split out of ingestTelegramInboundMessage below (cleaner pass, BL-369) to
// keep that function's own CRAP under the project's cap: a redelivered
// updateId only ever resolves against an already-read thread, never a null
// one, so this stays a plain lookup with no thread-nullability branch of
// its own.
function findExistingMessage(thread: SupportThread | null, updateId: number | undefined): ThreadMessage | undefined {
  return thread && updateId !== undefined ? messageForUpdateId(thread, updateId) : undefined;
}

// Split out of ingestTelegramInboundMessage below: resolves the thread and
// message this update maps to, appending a fresh transcript entry only when
// no message for this updateId is already recorded. The returned thread is
// always the up-to-date, non-null one - the caller never needs its own
// null-thread branch.
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

// BL-369: the bridge's own durable-accept gate. Two writes - the SUP-###
// transcript and the Operator-wake event - used to run unconditionally,
// in that order, with no error path and no idempotency key (bug #3: "the
// bridge's ingest is TWO NON-ATOMIC WRITES, IN THE WRONG ORDER, WITH NO
// ERROR PATH"). Now:
//   1. Dedup by updateId FIRST (scenario 03) - a redelivered message whose
//      transcript line AND queued event are both already confirmed is a
//      pure no-op (still reports success, since it genuinely WAS handled).
//      resolveInboundMessage above owns steps 1-2.
//   2. The transcript write happens only if no message for this updateId
//      exists yet - never twice for the same update.
//   3. The event enqueue is attempted whether the message is fresh or was
//      written by a PRIOR failed attempt (message.eventQueued still
//      false) - a retry after a transcript-succeeded-but-enqueue-failed
//      crash re-attempts ONLY the enqueue, never re-appends the transcript.
//   4. eventQueued flips to true ONLY after the enqueue is CONFIRMED to
//      have not thrown - "arm on confirmed delivery, never on attempt"
//      (engineering.prompt's own alarm-flag rule, reused here for the
//      identical reason).
// Any step throwing is caught and reported as {success:false} - never left
// to hang the response (bug #3's "the route may never even respond") and
// never silently treated as delivered.
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

// BL-281 telegram-topic-01/telegram-topic-02: mirrors handleGateAnswerRoute
// exactly - same control-scope step-up auth, same body-cap/shape-validate/
// dispatch shape. ASYNC, not RPC (the ticket's own explicit constraint):
// this ingests the message and responds immediately - it never waits for
// the Operator to react, so the reply (if any) is guaranteed to not exist
// yet when this response is sent.
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

// BL-320: {id} - the idempotency key of the outbox entry the bot just
// finished processing (posted to Telegram, or decided to drop as
// unmapped) - the ONLY thing that ever advances the persisted cursor.
function isReplyAckRequestShape(value: unknown): value is { id: string } {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string';
}

function isReplyAckRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && url === '/reply-ack';
}

// BL-320: the ack-driven cursor's only writer. Deliberately stateless
// (re-reads the persisted cursor fresh on every call rather than
// threading per-bridge-instance mutable state through the write-route
// table) - acks are low-frequency (one human reply at a time) so the tiny
// extra file read/write per ack costs nothing, and it keeps this route the
// same "plain function of (targetPath, body)" shape as every other route
// here instead of needing closure access to startBridge's internals.
// advanceCursorOnAck (pure) refuses to advance past an entry that does not
// match the ack's id, so a stale or out-of-order ack is a harmless no-op,
// never a corrupted cursor.
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
  return isRootPath(url) && isAuthorizedByQueryToken(queryToken(url), primaryTokenOf(registry));
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
      // BL-096: computed fresh per-request only, deliberately outside
      // buildBridgeState/the SSE poll loop above (git-history-walk cost -
      // see buildDeliveryMetricsState's own comment).
      matches: (url) => url === '/metrics',
      compute: () => buildDeliveryMetricsState(targetPath),
    },
    {
      // BL-100: same posture as /metrics - transcript + telemetry reads are
      // too expensive for the SSE poll loop, computed only on direct request.
      matches: (url) => url === '/cost-telemetry',
      compute: () => buildCostTelemetryState(targetPath),
    },
    {
      // BL-094: same posture as /metrics/cost-telemetry - git-history +
      // handoff-state reads, too expensive for the SSE poll loop.
      matches: (url) => url === '/holistic',
      compute: () => buildHolisticState(targetPath, runLogPath),
    },
    {
      // BL-102: same posture as /metrics/cost-telemetry/holistic - scans
      // every role's completed-handoff audit trail, too expensive for the
      // SSE poll loop. BL-270: nowMs defaults to undefined here too -
      // buildStageDwellState/computeStageDwellReportForRoles fall back to
      // the real clock unless a test injected an instant via
      // StartBridgeOptions.nowMs, so production behavior is unchanged.
      matches: (url) => url === '/stage-dwell',
      compute: () => buildStageDwellState(targetPath, nowMs),
    },
    {
      // BL-265 slice 1: lists the currently-PENDING to-human gates (a live
      // tmux pane capture per role) - same "too expensive for the SSE poll
      // loop, computed only on direct request" posture as every sibling
      // route above. READ-scoped only (the global isAuthorizedForRead check
      // ahead of this table already covers it) - answering a gate stays the
      // separate, control-step-up-gated POST /gate-answer route below; this
      // never writes anything.
      matches: (url) => url === '/gates',
      compute: () => filterPendingGates(computeRoleGateStatesLive(targetPath, readSwarmRoles(targetPath).map((r) => r.role))),
    },
    {
      // BL-273: same posture as /cost-telemetry above - transcript scans are
      // too expensive for the SSE poll loop, computed only on direct
      // request. nowMs mirrors /stage-dwell's own StartBridgeOptions.nowMs
      // injection (BL-270) so a test can pin the same instant its fixture
      // and this route both evaluate against.
      matches: (url) => url === '/burn-rate',
      compute: () => buildBurnRateState(targetPath, nowMs),
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
    // BL-241: mutable so rotate/revoke/register (via the BridgeHandle
    // methods below) take effect on the NEXT request without restarting
    // the bridge - token-rotation-01/device-revocation-02 both need a
    // live bridge whose auth state can actually change mid-run.
    let registry: DeviceRegistry = normalizeToRegistry(tokenOrRegistry);

    const server = http.createServer((req, res) => {
      const url = requestPath(req);

      if (!isAuthorizedForRead(req.headers.authorization, url, registry)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (isRootPath(url)) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          // Inline style/script only, matching the page's own "self-contained,
          // no external fetch" scope note - no external origin needs allowing.
          'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        });
        res.end(getHolisticUiHtml());
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
        // BL-320: replay every entry the persisted cursor still considers
        // unacked to THIS freshly (re)connected client - covers both "the
        // previous connection dropped mid-relay before acking" and "the
        // bridge itself restarted" (the persisted cursor, re-read fresh
        // here rather than trusted from a stale in-memory copy, is exactly
        // what survived the restart). Sent only to the new client, not
        // broadcast to every already-connected one, since an existing
        // client has no reason to see history it may have already acked.
        // Deliberately does NOT touch emittedIndex: /events can have more
        // than one live client (the front-desk bot AND a holistic-UI
        // viewer both subscribe), and emittedIndex is the poll tick's own
        // "already broadcast to everyone" pointer - advancing it here from
        // a single new client's catch-up replay would make the NEXT poll
        // tick skip broadcasting that same still-unacked range to every
        // OTHER already-connected client, silently starving them of an
        // entry they never actually received. The bot's own idempotency-
        // by-id dedup already makes an extra, unadvanced-emittedIndex
        // redelivery on the very next tick harmless.
        relayEntriesFrom(readPersistedCursor(targetPath).ackedIndex, [res]);
        return;
      }

      // BL-240/BL-241/BL-281: the bridge's write (POST) routes - answering a
      // captured to-human gate, and ingesting a resolved Telegram inbound
      // message. Read-level auth is already enforced above, uniformly with
      // every other route; each handler enforces its own additional control
      // step-up. GET (or any other method) to either path falls through to
      // the 404 below, same as any unrecognized route.
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

    // BL-281/BL-320 telegram-topic-03: how the Operator's reply reaches the
    // bot - the disposable Operator (via operator_reply.bb) appends {id,
    // threadId, text} to .swarmforge/operator/telegram-reply-outbox.jsonl.
    // emittedIndex is an in-memory, best-effort "already pushed to the
    // CURRENTLY connected client(s)" pointer - it exists only to avoid
    // re-broadcasting the same unacked entry on every single poll tick; it
    // carries no durability requirement of its own (losing it costs at
    // most one redundant replay, which the bot's own idempotency-by-id
    // guard already absorbs harmlessly). The genuinely durable, at-least-
    // once-delivery cursor is the ACKED one persisted in
    // telegram-reply-relay-cursor.json (replyRelayCursor.ts) - that file,
    // never this variable, is what the "/events" connect handler above
    // replays from on every fresh connection.
    let emittedIndex = readPersistedCursor(targetPath).ackedIndex;

    // Split out of the poll tick below so that callback's own branch count
    // stays low - each half of the tick (state snapshot, reply relay) is
    // independently a couple of branches, not one six-branch function.
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
