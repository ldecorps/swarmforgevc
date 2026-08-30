/**
 * BL-1235: a THIRD host-agent seat, backed by a local model served through
 * ollama, reachable only in its own dedicated messaging topic.
 *
 * The human directive this exists to honour, verbatim (2026-08-28):
 *
 *   > To be clear, cursor stays behind the usual host topic and front desk.
 *   > I want local qwen only behind its dedicated one.
 *
 * So this module adds a seat; it does not move, wrap or replace cursor
 * anywhere. `QWEN_LOCAL` is a sibling of `CURSOR_REMOTE` and `BUBBLE` in the
 * same topic map, resolved by the same `topicForSubject` — a new entry in an
 * existing mechanism, not a new mechanism.
 *
 * Everything here is PURE: a decision in, a decision out. The Telegram I/O,
 * the endpoint probe and the completion call all live in the caller, which is
 * the same split every other bridge decision module uses.
 *
 * This is also the genuine SECOND host-agent incarnation local-engineering
 * rule 7 names as the condition for the interface/incarnation split. It does
 * NOT license renaming Cursor identifiers; that stays out of policy.
 */

import { NamedModelEndpointProbe, isNamedModelHealthy } from '../swarm/modelServing';
import { topicForSubject } from './telegramTopicDecisions';
import { QWEN_LOCAL_SUBJECT_ID, QWEN_LOCAL_TOPIC_NAME } from './telegramCursorBridgeCore';

export { QWEN_LOCAL_SUBJECT_ID, QWEN_LOCAL_TOPIC_NAME };

/**
 * The model the seat runs, as CONFIGURATION with a documented default rather
 * than a constant baked into the code.
 *
 * The ticket refused to guess a tag: no `qwen3-coder` ~14B build could be
 * confirmed to exist, registry lookups 404 from this host, and ollama was not
 * installed when it was written. The human then answered directly, choosing
 * `qwen3:14b` from the models actually pulled here over the ticket's guessed
 * `qwen2.5-coder:14b`. That answer is the DEFAULT below, not a hardcoding: the
 * seat still verifies whatever it is configured with against the endpoint's
 * own catalogue at seat time, so a wrong tag is a visible refusal rather than
 * a silent fallback (scenario 04).
 */
export const DEFAULT_LOCAL_SEAT_MODEL_ID = 'qwen3:14b';
export const LOCAL_SEAT_MODEL_ENV = 'SWARMFORGE_LOCAL_SEAT_MODEL';

export function resolveLocalSeatModelId(
  env: Record<string, string | undefined> = process.env,
  configured?: string
): string {
  const fromConfig = String(configured ?? '').trim();
  if (fromConfig) {
    return fromConfig;
  }
  const fromEnv = String(env[LOCAL_SEAT_MODEL_ENV] ?? '').trim();
  return fromEnv || DEFAULT_LOCAL_SEAT_MODEL_ID;
}

export function qwenLocalTopicIdFromMap(topicMap: Record<string, string>): number | undefined {
  return topicForSubject(topicMap, QWEN_LOCAL_SUBJECT_ID);
}

export type LocalSeatTurn =
  /** Not this seat's surface. It says NOTHING - it does not decline, it is simply not asked. */
  | { kind: 'not-mine' }
  /** Answer with the local model. */
  | { kind: 'answer'; modelId: string; endpointUrl: string }
  /** Cannot answer, and says so IN ITS OWN TOPIC, naming why. */
  | { kind: 'refuse'; reason: string; modelId: string; endpointUrl: string };

export interface LocalSeatTurnInput {
  /** The topic the message arrived in. */
  topicId: number | undefined;
  /** The topic this seat is bound to, from the topic map. */
  seatTopicId: number | undefined;
  /** The endpoint probe the caller already performed. */
  probe: NamedModelEndpointProbe;
  /** The model this seat is configured with. */
  modelId: string;
  /** What the endpoint reports it actually holds. */
  catalogue: readonly string[];
}

/**
 * The seat's whole decision.
 *
 * Invariant 1 is the FIRST clause and is deliberately a hard gate rather than
 * a filter applied later: a message outside this seat's topic returns
 * `not-mine` before the endpoint, the model or anything else is considered, so
 * there is no path on which the local seat can answer on cursor's host topic
 * or the front desk. Those surfaces are cursor's and stay cursor's.
 *
 * Invariant 2 is the other two clauses. A seat that cannot answer says why, in
 * its own topic, and never hands the turn on: `refuse` carries the endpoint's
 * OWN reason, and the caller posts it into the same topic the message came
 * from. There is no `fallback` or `delegate` case in this type, which is the
 * structural half of "never hands the turn to another seat" - a caller cannot
 * route elsewhere on a decision that offers nowhere to route to.
 */
export function decideLocalSeatTurn(input: LocalSeatTurnInput): LocalSeatTurn {
  const { topicId, seatTopicId } = input;
  if (seatTopicId === undefined || topicId === undefined || topicId !== seatTopicId) {
    return { kind: 'not-mine' };
  }

  const modelId = String(input.modelId ?? '').trim();
  const health = isNamedModelHealthy(input.probe);
  if (!modelId) {
    return {
      kind: 'refuse',
      reason: 'no local model is configured for this seat',
      modelId,
      endpointUrl: health.endpointUrl,
    };
  }
  if (!health.ready) {
    return { kind: 'refuse', reason: health.reason, modelId, endpointUrl: health.endpointUrl };
  }
  if (!input.catalogue.includes(modelId)) {
    // Up, but does not hold what we asked for. Naming what it DOES hold turns
    // "unavailable" into something the reader can act on - the difference
    // between a wrong tag and a missing pull is one line of output away.
    const held = input.catalogue.length ? input.catalogue.join(', ') : 'nothing';
    return {
      kind: 'refuse',
      reason: `the endpoint is up but does not hold "${modelId}" (it holds: ${held})`,
      modelId,
      endpointUrl: health.endpointUrl,
    };
  }
  return { kind: 'answer', modelId, endpointUrl: health.endpointUrl };
}

/**
 * The refusal as the topic reads it. Never a bare status code and never
 * silence: both are named in scenario 03 as the failure, because a topic that
 * goes quiet is indistinguishable from a topic nobody is watching.
 */
export function formatLocalSeatRefusal(turn: Extract<LocalSeatTurn, { kind: 'refuse' }>): string {
  return `Local seat cannot answer: ${turn.reason}. Endpoint ${turn.endpointUrl}. No other seat has been asked.`;
}

/**
 * This host has no dedicated GPU, and a measured turn (2046-token prompt,
 * 289-token reply) took 3m19s at ~2.8 tok/s. Without a first word the topic
 * looks dead for minutes, and the operator's reasonable conclusion - that the
 * seat is broken - would be wrong. So the seat says it has started, names the
 * model, and says that a reply will take minutes on this host.
 */
export const LOCAL_SEAT_SLOW_TURN_NOTICE = 'CPU-only inference on this host - a reply can take several minutes.';

export function formatLocalSeatAcknowledgement(modelId: string): string {
  return `Local seat working on it with ${modelId}. ${LOCAL_SEAT_SLOW_TURN_NOTICE}`;
}
