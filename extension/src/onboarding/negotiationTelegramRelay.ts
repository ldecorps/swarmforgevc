// BL-381: adapter-injected orchestration for one negotiation-topic poll
// cycle - sequences decideNegotiationUpdateAction (pure) against the real
// negotiation rounds (BL-344's runObject/runApprove, injected as adapters
// here so this file stays testable with no live Telegram/filesystem) and
// posts the outcome back into the topic. Mirrors telegramFrontDeskBotCore's
// own processUpdate/pollAndForward split: one pure decision, then adapters
// sequenced around it.
import { TelegramUpdate } from '../notify/telegramClient';
import { nextUpdateOffset } from '../tools/telegramFrontDeskBotCore';
import { ProposedContract } from './contractTypes';
import { decideNegotiationUpdateAction, formatContractForTelegram } from './negotiationTelegramRouting';

// BL-389's own lesson applied here: a negotiation that has ALREADY ended
// (approved earlier, or round-limited earlier) can never succeed on a
// retry - it is a TERMINAL outcome, not a failure, so it must never be
// conflated with one. 'round-limit' is the SAME terminal shape reached
// freshly by this very objection. Both distinguish from the ordinary
// 'revised'/'agreed' success outcomes without throwing, so a stale or
// replayed update can never re-run BL-344's own already-ended guard as an
// uncaught exception that would abort the whole poll cycle.
// BL-442: 'not-derived' is the outcome for an objection from which no
// concrete contract change could be derived - the revision step must never
// fabricate a boundary clause from raw text it could not interpret, so this
// is a distinct terminal-for-this-round outcome, not a variant of 'revised'
// (the contract rides back unchanged, never re-posted as if it were new).
export type ObjectToContractResult =
  | { outcome: 'revised'; contract: ProposedContract }
  | { outcome: 'not-derived' }
  | { outcome: 'round-limit' }
  | { outcome: 'already-ended' };

export type ApproveContractResult = { outcome: 'agreed'; contract: ProposedContract } | { outcome: 'already-ended' };

export interface NegotiationRelayAdapters {
  objectToContract: (text: string) => Promise<ObjectToContractResult>;
  approveContract: () => Promise<ApproveContractResult>;
  postToTopic: (text: string) => Promise<void>;
}

export const CONTRACT_AGREED_MESSAGE = 'The contract is agreed. Onboarding will continue.';
export const ROUND_LIMIT_MESSAGE = 'The negotiation has reached its round limit. Please reach out directly to continue.';
// BL-442: posted when routing cannot confidently classify a reply as either
// approval or objection - asks the human to disambiguate in the topic
// instead of defaulting to the mutate-the-contract path.
export const CLARIFY_INTENT_MESSAGE = 'Did you mean to approve the contract, or is this an objection? Reply "agree" to approve, or restate your objection.';
// BL-442: posted when an objection is definitely an objection but no
// concrete contract change could be derived from it - never a fabricated
// boundary clause built from the raw text.
export const COULD_NOT_DERIVE_CHANGE_MESSAGE = "Couldn't derive a change from this - could you rephrase your objection?";

// Split out of relayNegotiationUpdates so that function's own branch count
// stays low, the same technique this codebase uses throughout (e.g.
// telegramFrontDeskBotCore's processUpdate/deliverOperatorContext split).
// Returns 'posted' for anything genuinely acted on (including the
// round-limit notice - the human still needs to see it), 'dropped' for a
// pure decision-drop OR an already-ended negotiation - neither can ever
// succeed on a retry, so neither may ever be treated as a failure that
// blocks the offset (the exact BL-389 mechanism this file exists to avoid
// repeating).
export async function processNegotiationUpdate(
  update: TelegramUpdate,
  principalUserId: string,
  chatId: string,
  negotiationTopicId: number,
  adapters: NegotiationRelayAdapters
): Promise<'posted' | 'dropped'> {
  const decision = decideNegotiationUpdateAction(update, principalUserId, chatId, negotiationTopicId);
  if (decision.action === 'drop') {
    return 'dropped';
  }
  if (decision.action === 'ask') {
    await adapters.postToTopic(CLARIFY_INTENT_MESSAGE);
    return 'posted';
  }
  if (decision.action === 'agree') {
    const result = await adapters.approveContract();
    if (result.outcome === 'already-ended') {
      return 'dropped';
    }
    await adapters.postToTopic(CONTRACT_AGREED_MESSAGE);
    return 'posted';
  }
  const result = await adapters.objectToContract(decision.text);
  if (result.outcome === 'already-ended') {
    return 'dropped';
  }
  if (result.outcome === 'round-limit') {
    await adapters.postToTopic(ROUND_LIMIT_MESSAGE);
    return 'posted';
  }
  if (result.outcome === 'not-derived') {
    await adapters.postToTopic(COULD_NOT_DERIVE_CHANGE_MESSAGE);
    return 'posted';
  }
  await adapters.postToTopic(formatContractForTelegram(result.contract));
  return 'posted';
}

export interface NegotiationRelayResult {
  nextOffset: number;
  posted: number;
  dropped: number;
}

// One poll cycle's worth of updates, in fetch order - each update is fully
// processed (including its own state mutation + Telegram post) before the
// next one starts, so two objections in the same batch are never applied
// out of order.
export async function relayNegotiationUpdates(
  updates: TelegramUpdate[],
  currentOffset: number,
  principalUserId: string,
  chatId: string,
  negotiationTopicId: number,
  adapters: NegotiationRelayAdapters
): Promise<NegotiationRelayResult> {
  let posted = 0;
  let dropped = 0;
  for (const update of updates) {
    const outcome = await processNegotiationUpdate(update, principalUserId, chatId, negotiationTopicId, adapters);
    if (outcome === 'posted') {
      posted += 1;
    } else {
      dropped += 1;
    }
  }
  return { nextOffset: nextUpdateOffset(updates, currentOffset), posted, dropped };
}
