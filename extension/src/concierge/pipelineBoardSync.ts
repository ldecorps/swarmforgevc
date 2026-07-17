// BL-452/BL-455: adapter-injected I/O half of the pipeline board. BL-462
// changed the mechanism: the board no longer edits a single message in
// place (that remains editInPlaceMessageSync.ts's job, still used verbatim
// by approvalsRosterSync.ts - DO NOT touch that shared module or point the
// roster at this one). The board now change-gates on a CONTENT SIGNATURE
// (the rendered grid + parked list, EXCLUDING the footer timestamp - see
// pipelineBoard.ts's renderPipelineBoardBody) and, on a real content change,
// DELETES the previously-posted message (if any) and POSTS a fresh one, so
// the board is always the LATEST message in its topic. An unchanged tick is
// a complete no-op: no delete, no post, no state change - the existing
// message (and its footer timestamp) stays exactly where it is.
import { PipelineBoardData, PIPELINE_BOARD_MESSAGE_MAX_LENGTH, budgetPipelineBoardLinks, renderPipelineBoard, renderPipelineBoardBody, wrapPipelineBoardHtml } from './pipelineBoard';

// BL-497: the board's retry cap - the number of CONSECUTIVE failed ticks
// (any mix of failed-no-topic/failed-post) tolerated before exactly one
// operator alert is raised naming the frozen board. A small number of ~30s
// ticks per the ticket's own suggestion; tune here if the architect's review
// wants a different value - every consumer reads this one constant, never a
// hardcoded number of its own.
export const PIPELINE_BOARD_ALERT_FAILURE_CAP = 5;

export type PipelineBoardFailureClass = 'topic-gone' | 'too-long' | 'transient' | 'unknown';

export interface PipelineBoardTopicResult {
  topicId?: number;
  error?: string;
}

export interface PipelineBoardPostResult {
  messageId?: number;
  error?: string;
}

export interface PipelineBoardAdapters {
  // BL-497: widened from Promise<number | undefined> to carry the
  // underlying Telegram error up to syncPipelineBoard - a caller that
  // returns only success (a real adapter must set `error` off the
  // Telegram client's own `.error` field; a pre-BL-497 test fixture that
  // still resolves a bare number/undefined is no longer valid TypeScript
  // and must be updated to `{ topicId }` / `{ error }`, same for
  // postMessage below).
  ensureBoardTopic: () => Promise<PipelineBoardTopicResult>;
  // BL-465: linksHtml added LAST (after text) - the below-grid GitHub link
  // list, already rendered as its own HTML fragment (renderPipelineBoardLinks)
  // so the real adapter can append it AFTER the closing </pre> tag rather
  // than escaping it into the monospace block. Optional/empty for every
  // pre-BL-465 fixture that never passes a 3rd arg.
  postMessage: (topicId: number, text: string, linksHtml?: string) => Promise<PipelineBoardPostResult>;
  // BL-462: replaces editMessage - the board never edits in place anymore.
  // Best-effort: its result is intentionally not branched on (see
  // syncPipelineBoard's own comment) - an orphaned undeleted old message is
  // a minor cosmetic issue, never a reason to fail posting the new latest
  // message.
  deleteMessage: (topicId: number, messageId: number) => Promise<boolean>;
  // BL-497: emits exactly one operator alert naming the frozen board, called
  // ONLY when the consecutive-failure cap is exceeded and no alert is armed
  // yet for the current episode (see maybeEmitFailureAlert below). Returns
  // whether the alert was CONFIRMED delivered - syncPipelineBoard arms
  // alertArmed only on `true`, never on the mere attempt (BL-215/BL-333's
  // "the alarm for a silent failure failed silently" lesson). Optional: a
  // fixture that never drives the board into its failure path (almost every
  // fixture that predates this ticket) needs no implementation at all.
  emitFailureAlert?: (message: string) => Promise<boolean>;
}

export interface PipelineBoardState {
  topicId?: number;
  messageId?: number;
  // The last rendered BODY (grid + parked, no footer) - the change-gate
  // input. Distinct from the full posted text, which also carries the
  // footer stamped with lastChangeMs below.
  contentSignature?: string;
  // The instant the content signature last actually changed - fed into
  // renderPipelineBoard's footer. Never bumped on an unchanged tick, however
  // far the wall clock has moved (BL-462 pipeline-board-refine-06).
  lastChangeMs?: number;
  // BL-497: consecutive failed-post/failed-no-topic ticks since the last
  // successful post - reset to 0 the instant a post succeeds.
  consecutiveFailures?: number;
  // BL-497: true once the "board frozen" operator alert has been CONFIRMED
  // delivered for the CURRENT failure episode. Cleared to false on the next
  // successful post, so a later episode alarms fresh.
  alertArmed?: boolean;
}

export type PipelineBoardSyncOutcome = 'posted' | 'reposted' | 'skipped-unchanged' | 'failed-no-topic' | 'failed-post';

export interface PipelineBoardSyncResult {
  state: PipelineBoardState;
  outcome: PipelineBoardSyncOutcome;
  // BL-497: the underlying Telegram error for a failed-no-topic/failed-post
  // outcome - the observability fix itself (previously discarded entirely).
  // Undefined for every other outcome.
  error?: string;
  // BL-497: set whenever `error` is set - classifies it so a topic-gone
  // failure can self-heal (see postBoardMessage) while a transient/unknown
  // one never recreates the topic.
  failureClass?: PipelineBoardFailureClass;
  // BL-497: true exactly on the tick where the caller must treat the board
  // as needing its one alert - already reflected in `state.alertArmed`
  // being left false when emitFailureAlert was not confirmed delivered (or
  // not wired at all), so a caller inspecting state alone can still tell.
  shouldAlert?: boolean;
}

// BL-497: known Telegram error signatures, kept as an explicit lookup per
// the engineering acceptance-mutation rule - never a bare substring branch
// that would lump every unrecognized value into the wrong bucket. Case-
// insensitive match against the (already human-readable) formatted error
// text callTelegramApi/formatApiFailureError produce.
const TOPIC_GONE_ERROR_SIGNATURES = ['message thread not found'];
// BL-502: a too-long payload is NOT transient - retrying the identical
// oversized message fails forever until the payload itself shrinks
// (budgetPipelineBoardLinks' own job). Classified on its own class,
// distinct from transient/unknown, purely so BL-497's alert names the
// real cause instead of lumping it under "unknown" if a payload is ever
// still over budget; the topic itself is fine (only the payload is too
// big), so this retains it exactly like transient/unknown do.
const TOO_LONG_ERROR_SIGNATURES = ['text is too long'];
const TRANSIENT_ERROR_SIGNATURES = [
  'too many requests',
  'retry after',
  'enotfound',
  'econnreset',
  'econnrefused',
  'etimedout',
  'network request failed',
  'internal server error',
  'bad gateway',
  'service unavailable',
  'gateway timeout',
];

function matchesAnySignature(error: string, signatures: string[]): boolean {
  const lower = error.toLowerCase();
  return signatures.some((signature) => lower.includes(signature));
}

// BL-497/BL-502 (cleaner, CRAP budget): the three signature lists above,
// tried in this fixed order - topic-gone and too-long are both distinct,
// non-transient causes checked before the broader transient bucket, so an
// error matching more than one list's wording still lands on the earliest,
// most specific class. Extracted from classifyBoardFailure below (which
// repeated the identical `error && matchesAnySignature(error, X)` shape
// three times) into one ordered lookup, purely to keep that function's own
// CRAP under threshold - mirrors resolveBoardTopicId's own extraction below
// for the identical reason.
const FAILURE_CLASSIFICATION_ORDER: { signatures: string[]; failureClass: PipelineBoardFailureClass }[] = [
  { signatures: TOPIC_GONE_ERROR_SIGNATURES, failureClass: 'topic-gone' },
  { signatures: TOO_LONG_ERROR_SIGNATURES, failureClass: 'too-long' },
  { signatures: TRANSIENT_ERROR_SIGNATURES, failureClass: 'transient' },
];

// BL-497: a topic-gone classification self-heals (the next tick re-ensures
// a fresh topic); a transient one retains the topic and bounded-retries; an
// UNKNOWN/unclassifiable error is deliberately folded into the same
// retained posture as transient - the ticket's own conservative choice, so
// a never-seen-before error string can never spawn a duplicate topic.
export function classifyBoardFailure(error: string | undefined): PipelineBoardFailureClass {
  if (!error) {
    return 'unknown';
  }
  const matched = FAILURE_CLASSIFICATION_ORDER.find(({ signatures }) => matchesAnySignature(error, signatures));
  return matched?.failureClass ?? 'unknown';
}

// The topic id is created ONCE then reused - split out purely to keep
// syncPipelineBoard's own CRAP under threshold (mirrors
// editInPlaceMessageSync.ts's own resolveTopicId split).
function resolveBoardTopicId(prevState: PipelineBoardState | undefined, adapters: PipelineBoardAdapters): Promise<PipelineBoardTopicResult> {
  if (prevState?.topicId !== undefined) {
    return Promise.resolve({ topicId: prevState.topicId });
  }
  return adapters.ensureBoardTopic();
}

// BL-497: builds a failed PipelineBoardSyncResult - shared by both failure
// sites below so the consecutive-failure count, the alert-armed carry-over,
// and the shouldAlert threshold check are computed identically regardless
// of which step failed. `stateOverlay` lets each caller decide what else
// changes (a topic-gone post failure clears topicId/messageId; a
// failed-no-topic has nothing else to change).
function failedOutcome(
  prevState: PipelineBoardState | undefined,
  stateOverlay: Partial<PipelineBoardState>,
  outcome: 'failed-post' | 'failed-no-topic',
  error: string | undefined,
  failureClass: PipelineBoardFailureClass
): PipelineBoardSyncResult {
  const consecutiveFailures = (prevState?.consecutiveFailures ?? 0) + 1;
  const alertArmed = prevState?.alertArmed ?? false;
  return {
    state: { ...prevState, ...stateOverlay, consecutiveFailures, alertArmed },
    outcome,
    error,
    failureClass,
    shouldAlert: consecutiveFailures >= PIPELINE_BOARD_ALERT_FAILURE_CAP && !alertArmed,
  };
}

// BL-497: naming text for the one alert a caller emits when the retry cap
// is exceeded - always names the board and the failure count so a human
// reading it in the Operator topic knows exactly what happened without
// cross-referencing anything else.
function buildFailureAlertText(consecutiveFailures: number, error: string | undefined): string {
  return `Pipeline Board frozen: ${consecutiveFailures} consecutive failed post attempts${error ? ` (last error: ${error})` : ''}.`;
}

// BL-497: emits the alert exactly when a failed result crosses the cap, and
// arms `alertArmed` ONLY on CONFIRMED delivery - never on the attempt (the
// BL-215/BL-333 lesson). A missing adapter (not wired) or a failed send
// leaves the result untouched, so the very next failing tick recomputes
// shouldAlert the same way and tries again, rather than suppressing it.
async function maybeEmitFailureAlert(result: PipelineBoardSyncResult, adapters: PipelineBoardAdapters): Promise<PipelineBoardSyncResult> {
  if (!result.shouldAlert || !adapters.emitFailureAlert) {
    return result;
  }
  const delivered = await adapters.emitFailureAlert(buildFailureAlertText(result.state.consecutiveFailures ?? 0, result.error));
  if (!delivered) {
    return result;
  }
  return { ...result, state: { ...result.state, alertArmed: true } };
}

// BL-468: posts the fresh message FIRST, only deleting the prior one
// (best-effort) AFTER the new one already exists - so there is always at
// least one board message visible in the topic, and a failed post never
// leaves the old message already deleted. Split out purely to keep
// syncPipelineBoard's own CRAP under threshold.
async function postBoardMessage(
  topicId: number,
  text: string,
  linksHtml: string,
  contentSignature: string,
  lastChangeMs: number,
  prevState: PipelineBoardState | undefined,
  adapters: PipelineBoardAdapters
): Promise<PipelineBoardSyncResult> {
  const { messageId, error } = await adapters.postMessage(topicId, text, linksHtml);
  if (messageId === undefined) {
    // A failed post must never delete the still-good prior message - the
    // existing board (and its own tracked messageId) is left exactly as it
    // was, so a board is always visible even when the fresh post fails.
    // BL-497: UNLESS the failure names the topic itself as gone, in which
    // case that "still-good prior message" is a fiction - both topicId and
    // messageId are cleared so the NEXT tick's resolveBoardTopicId
    // re-ensures a genuinely fresh topic and posts into it (self-heal).
    // Any other class (too-long/transient/unknown) retains both untouched -
    // BL-502: a too-long payload's TOPIC is fine, only the payload was too
    // big (and budgetPipelineBoardLinks now keeps it under budget going
    // forward), so recreating the topic would be pointless churn.
    const failureClass = classifyBoardFailure(error);
    const stateOverlay: Partial<PipelineBoardState> = failureClass === 'topic-gone' ? { topicId: undefined, messageId: undefined } : { topicId };
    return failedOutcome(prevState, stateOverlay, 'failed-post', error, failureClass);
  }

  const hadPriorMessage = prevState?.messageId !== undefined;
  if (hadPriorMessage) {
    // Best-effort, only now that the new latest message already exists: an
    // already-gone or failed delete never blocks or undoes the post above -
    // see the adapters interface's own comment above.
    await adapters.deleteMessage(topicId, prevState!.messageId!);
  }

  // BL-497: a successful post clears the failure episode entirely - the
  // next transient/topic-gone run starts a fresh count and can alarm again.
  return {
    state: { topicId, messageId, contentSignature, lastChangeMs, consecutiveFailures: 0, alertArmed: false },
    outcome: hadPriorMessage ? 'reposted' : 'posted',
  };
}

export async function syncPipelineBoard(
  data: PipelineBoardData,
  prevState: PipelineBoardState | undefined,
  adapters: PipelineBoardAdapters,
  nowMs: number,
  repoBaseUrl?: string
): Promise<PipelineBoardSyncResult> {
  const contentSignature = renderPipelineBoardBody(data);
  if (contentSignature === prevState?.contentSignature) {
    return { state: prevState ?? {}, outcome: 'skipped-unchanged' };
  }

  const topicResult = await resolveBoardTopicId(prevState, adapters);
  if (topicResult.topicId === undefined) {
    const result = failedOutcome(prevState, {}, 'failed-no-topic', topicResult.error, classifyBoardFailure(topicResult.error));
    return maybeEmitFailureAlert(result, adapters);
  }

  const lastChangeMs = nowMs;
  const text = renderPipelineBoard(data, lastChangeMs);
  // BL-502: the link list is the ELASTIC part - budgeted against whatever
  // room remains after the fixed grid/parked/footer body (always included
  // in full). wrapPipelineBoardHtml(text) (no linksHtml arg) is that body
  // alone, wrapped exactly as it will be sent; the "\n\n" separator is
  // reserved too, since it is only added once there is at least one link
  // line to append.
  const maxLinksLength = PIPELINE_BOARD_MESSAGE_MAX_LENGTH - wrapPipelineBoardHtml(text).length - 2;
  const { html: linksHtml } = budgetPipelineBoardLinks(data.links ?? [], repoBaseUrl, maxLinksLength);
  const result = await postBoardMessage(topicResult.topicId, text, linksHtml, contentSignature, lastChangeMs, prevState, adapters);
  return result.outcome === 'failed-post' ? maybeEmitFailureAlert(result, adapters) : result;
}
