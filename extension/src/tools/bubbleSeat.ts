// BL-1296: Bubble's own answering seat.
//
// Today there is exactly ONE answering seat - the live Cursor agent session -
// and both the cursor host topic and the Bubble topic route to it, so while
// cursor is mid-turn Bubble cannot answer at all. This is the seat that makes
// Bubble answerable in parallel, riding the seat/lifecycle shape BL-1235
// already shipped for the local qwen seat rather than inventing a second
// mechanism.
//
// BUBBLE STAYS A MIRROR (the human's ruling, option B, 2026-08-30: "Same
// answers as the front desk, just not blocked behind Cursor's current turn").
// That is invariant 1, and it is structural here rather than a rule someone
// has to remember: the only `answer` this decision can produce carries
// `via: 'front-desk-mirror'`, and there is no variant on which the seat
// answers from a context of its own. A second brain cannot be built out of
// this type without changing it - which is exactly the review a divergence
// would deserve.
//
// Invariant 2 - a seat serves only its own topic - is the FIRST clause, a hard
// gate ahead of everything else, so no path exists on which the Bubble worker
// answers cursor's host topic or the front desk. Invariant 3 - one getUpdates
// owner - is not decided here at all: this seat runs inside the bridge's
// EXISTING poll (see telegramCursorBridgeLive), so it opens no poller to
// compete with, the same way BL-1235's seat does.

export const BUBBLE_SEAT_NAME = 'Bubble';
export const CURSOR_SEAT_NAME = 'Cursor';

export type BubbleSeatTurn =
  /**
   * Not this seat's surface. It says NOTHING - it does not decline, it is
   * simply not asked. `seat` names whose topic it is when we know, so a caller
   * logging the skip can say where the message went instead of "somewhere".
   */
  | { kind: 'not-mine'; seat?: string }
  /** Answer, from the front desk's shared context. The only answer shape there is. */
  | { kind: 'answer'; seat: string; topicId: number; via: 'front-desk-mirror' }
  /** Cannot answer, and says so IN ITS OWN TOPIC, naming why. */
  | { kind: 'refuse'; seat: string; topicId: number; reason?: string };

export interface BubbleSeatTurnInput {
  /** The topic the message arrived in. */
  topicId: number | undefined;
  /** The topic this seat is bound to, from the subject-id topic map. */
  seatTopicId: number | undefined;
  /** Cursor's own topic, so a skip can name whose surface it is. */
  cursorTopicId?: number | undefined;
  /**
   * Whether the Cursor seat is mid-turn. Deliberately part of the INPUT and
   * deliberately unread: the ticket exists because Bubble used to wait behind
   * this flag, and a future edit that starts consulting it reintroduces the
   * defect. It is here so that regression has a name and a test.
   */
  cursorBusy?: boolean;
  /** Whether the front desk's shared context can be read for this turn. */
  mirrorAvailable: boolean;
  /** Why it could not, when it could not - the seat never refuses namelessly. */
  mirrorUnavailableReason?: string;
}

// `seatTopicId === undefined` on its own is not a distinct case: when it
// holds and topicId is also undefined, `topicId === undefined` already
// fires; when topicId is a number, `topicId !== seatTopicId` already fires
// (a number is never `undefined`). So the gate below is exactly
// `topicId === undefined || topicId !== seatTopicId` - the third clause
// alone, once the redundant first is folded away.
function notMineTurn(topicId: number | undefined, cursorTopicId: number | undefined): BubbleSeatTurn {
  return topicId !== undefined && topicId === cursorTopicId
    ? { kind: 'not-mine', seat: CURSOR_SEAT_NAME }
    : { kind: 'not-mine' };
}

export function decideBubbleSeatTurn(input: BubbleSeatTurnInput): BubbleSeatTurn {
  const { topicId, seatTopicId, cursorTopicId } = input;
  if (topicId === undefined || topicId !== seatTopicId) {
    return notMineTurn(topicId, cursorTopicId);
  }
  // Note what is NOT consulted here: cursorBusy. Bubble answers on its own
  // worker, so cursor's turn is none of its business.
  if (!input.mirrorAvailable) {
    return {
      kind: 'refuse',
      seat: BUBBLE_SEAT_NAME,
      topicId,
      ...(input.mirrorUnavailableReason ? { reason: input.mirrorUnavailableReason } : {}),
    };
  }
  return { kind: 'answer', seat: BUBBLE_SEAT_NAME, topicId, via: 'front-desk-mirror' };
}

/**
 * The refusal as the Bubble topic reads it. Never silence and never a bare
 * status: a topic that goes quiet is indistinguishable from a topic nobody is
 * watching, and the last sentence is the "never hands the turn on" half said
 * out loud to the reader.
 */
export function formatBubbleSeatRefusal(turn: Extract<BubbleSeatTurn, { kind: 'refuse' }>): string {
  const reason = turn.reason ?? 'the front desk mirror is unavailable for this turn';
  return `Bubble seat cannot answer: ${reason}. No other seat has been asked.`;
}

export interface SeatLiveness {
  name: string;
  /** undefined means "could not tell" - never read as alive. */
  alive: boolean | undefined;
}

export interface SeatWatchReport {
  needsAttention: string[];
  message: string;
}

/**
 * The watchdog's whole seat decision: BOTH seats, every check. A seat whose
 * liveness could not be determined is reported rather than assumed alive -
 * "could not tell" and "running" are the two answers a supervisor must never
 * conflate, because only one of them is safe to ignore.
 */
export function decideSeatWatch(seats: readonly SeatLiveness[]): SeatWatchReport {
  const unknown = seats.filter((seat) => seat.alive === undefined).map((seat) => seat.name);
  const stopped = seats.filter((seat) => seat.alive === false).map((seat) => seat.name);
  const needsAttention = [...stopped, ...unknown];
  if (needsAttention.length === 0) {
    return { needsAttention, message: `all seats running: ${seats.map((s) => s.name).join(', ')}` };
  }
  const parts = [
    ...(stopped.length ? [`stopped: ${stopped.join(', ')}`] : []),
    ...(unknown.length ? [`liveness unknown: ${unknown.join(', ')}`] : []),
  ];
  return { needsAttention, message: `seats needing attention — ${parts.join('; ')}` };
}
