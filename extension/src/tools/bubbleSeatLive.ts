/**
 * BL-1296: the Bubble seat's live turn.
 *
 * `bubbleSeat.ts` decides; this performs. It is the half the first build left
 * unwritten - the architect's D1 - so the seat was declared, consulted in the
 * bridge's dispatch guard, and never reachable in production.
 *
 * STRICT ECHO, the human's ruling of 2026-09-03 (option 1 of three): "the
 * Bubble seat relays the front desk's own answer and produces none of its
 * own." So this module contains no code path that composes a reply. It drives
 * the FRONT DESK's own turn - the same `processLetsTalkTurn` the Let's Talk
 * surface drives, against the same agent session - and posts what that
 * returns, unedited. Invariant 1 (the Bubble seat never diverges from the
 * front desk) is therefore structural: producing a divergent answer would mean
 * adding a code path that writes one.
 *
 * The one thing it does author is a REFUSAL, and only when the front desk
 * could not answer at all. That is deliberate and is the intake's own
 * requirement: "a Bubble seat that cannot answer says why in its own topic; it
 * never fails silently and never hands the turn to another seat." A topic that
 * goes quiet is indistinguishable from a topic nobody is watching.
 *
 * What this does NOT do, stated rather than implied: it does not add a second
 * answering worker. Option 1 was chosen over a dedicated paid session knowing
 * that. It removes Bubble's dependence on the CURSOR HOST TOPIC's decision
 * path - a Bubble message is answered from the front desk's own turn without
 * cursor being asked about it at all - but the front desk's turn still runs
 * against the shared agent session, so it is not a parallel brain. The seat
 * runs INSIDE the bridge's existing poll and opens no second getUpdates
 * consumer (invariant 3), the same way BL-1235's seat does.
 */

import {
  BubbleSeatTurn,
  decideBubbleSeatTurn,
  formatBubbleSeatRefusal,
} from './bubbleSeat';
import { processLetsTalkTurn } from '../bridge/letsTalkRoutes';
import { createLiveCursorBridgeAgentSession } from '../bridge/cursorBridgeAgentSession';

/** What the front desk answered, or why it could not. Never a partial. */
export type FrontDeskAnswer =
  | { success: true; replyText: string }
  | { success: false; reason: string };

export type FrontDeskTurnFn = (text: string) => Promise<FrontDeskAnswer>;

export interface BubbleSeatTurnInput {
  targetPath: string;
  /** The topic the message arrived in. */
  topicId: number | undefined;
  /** The topic this seat is bound to. */
  seatTopicId: number | undefined;
  /** Cursor's own topic, so a skip can name whose surface it is. */
  cursorTopicId?: number;
  text: string;
  post: (topicId: number, message: string) => Promise<void>;
  /**
   * Deliberately accepted and deliberately UNREAD, exactly as
   * `decideBubbleSeatTurn` takes it: the ticket exists because Bubble used to
   * wait behind this flag, so the regression has a name and a test.
   */
  cursorBusy?: boolean;
  /** Seam for the front desk's own turn - injected so tests need no agent. */
  frontDeskTurnFn?: FrontDeskTurnFn;
}

/**
 * The REAL front desk turn: the same route body the Let's Talk surface posts
 * to, against the same live agent session. Not a second way to get an answer -
 * that would be the divergence invariant 1 forbids.
 */
export function liveFrontDeskTurn(targetPath: string): FrontDeskTurnFn {
  return async (text: string) => {
    const result = await processLetsTalkTurn(
      { text },
      { agentSession: createLiveCursorBridgeAgentSession(targetPath) }
    );
    return result.success
      ? { success: true, replyText: result.replyText }
      : { success: false, reason: result.reason };
  };
}

async function askFrontDesk(input: BubbleSeatTurnInput): Promise<FrontDeskAnswer> {
  const ask = input.frontDeskTurnFn ?? liveFrontDeskTurn(input.targetPath);
  try {
    return await ask(input.text);
  } catch (err) {
    // A thrown edge is still an answer the seat owes its topic, never silence.
    return { success: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function runBubbleSeatTurn(input: BubbleSeatTurnInput): Promise<BubbleSeatTurn> {
  // The topic gate FIRST, before anything is asked of the front desk: a
  // message outside this seat's topic must not even cause a turn, let alone an
  // answer (invariant 2). `decideBubbleSeatTurn`'s own first clause is the
  // gate; it is asked here with `mirrorAvailable: true` because availability
  // is not yet known and cannot matter to a not-mine verdict.
  const gate = decideBubbleSeatTurn({
    topicId: input.topicId,
    seatTopicId: input.seatTopicId,
    cursorTopicId: input.cursorTopicId,
    mirrorAvailable: true,
  });
  if (gate.kind === 'not-mine') {
    return gate;
  }

  const answered = await askFrontDesk(input);
  // An empty reply is not an answer. Posting it would leave the topic looking
  // answered while saying nothing, which is the silent-failure shape the
  // intake rules out.
  const usable = answered.success && answered.replyText.trim().length > 0;
  const decision = decideBubbleSeatTurn({
    topicId: input.topicId,
    seatTopicId: input.seatTopicId,
    cursorTopicId: input.cursorTopicId,
    mirrorAvailable: usable,
    ...(usable
      ? {}
      : {
          mirrorUnavailableReason: answered.success
            ? 'the front desk returned an empty answer'
            : answered.reason,
        }),
  });

  if (decision.kind === 'answer') {
    // The front desk's own text, unedited. This is the only place a non-refusal
    // reaches the topic, and it composes nothing.
    await input.post(decision.topicId, (answered as { replyText: string }).replyText);
    return decision;
  }
  if (decision.kind === 'refuse') {
    await input.post(decision.topicId, formatBubbleSeatRefusal(decision));
  }
  return decision;
}
