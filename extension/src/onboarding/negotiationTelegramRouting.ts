// BL-381: the pure decision half of wiring BL-344's negotiation rounds to
// BL-380's provisioned negotiation topic - given one Telegram update, is it
// an objection or an agreement from the authorized human in the target's own
// negotiation topic, or something to drop. Reuses telegramFrontDeskBotCore's
// own guards (isFromMyChat/isFromPrincipal - "the guard from BL-379") rather
// than restating them; this module only ever adds the negotiation-topic
// check and the objection-vs-agreement classification on top.
import { TelegramUpdate } from '../notify/telegramClient';
import { isFromMyChat, isFromPrincipal, messageTextOf, topicIdOf } from '../tools/telegramFrontDeskBotCore';
import { ProposedContract } from './contractTypes';

// A closed, deliberately narrow pattern - the whole reply, not a substring
// match, so an objection that happens to CONTAIN the word "agree" (e.g. "I
// agree with most of this but remove the PWA work") is never misread as
// approval. Mirrors pendingApprovalReply.ts's own posture: agreement is a
// reply that IS the agreement word, not one that merely mentions it.
// BL-442: broadened to also accept a leading "all" and "ok"/"okay" - the
// exact failure this ticket fixes ("All agreed" failed this anchor and fell
// through to the objection path). Still whole-message anchored (^...$), so
// the guard above is unchanged: an objection merely containing "agree"
// still fails this pattern and is never misread as approval.
const AGREEMENT_PATTERN = /^\s*(all\s+)?(agree|agreed|approve|approved|lgtm|yes|ok|okay)[.!]?\s*$/i;

// BL-442: a reply whose intent is genuinely uncertain - the human is unsure
// or asking a question back, rather than either approving or making a
// concrete objection. Deliberately narrow and separate from the objection
// fallthrough below, so this can never reclassify a real objection as
// merely ambiguous: only this small, explicit, whole-message set of
// non-committal replies routes to 'ask' - anything else still falls
// through to 'objection', exactly as before this ticket.
const AMBIGUOUS_INTENT_PATTERN = /^\s*(not sure|unsure|no idea|maybe|i don'?t know|idk|hmm+|huh\??|what\??|\?+)\s*$/i;

export function isAgreementText(text: string): boolean {
  return AGREEMENT_PATTERN.test(text);
}

export function isAmbiguousIntentText(text: string): boolean {
  return AMBIGUOUS_INTENT_PATTERN.test(text);
}

export type NegotiationUpdateDecision =
  | { action: 'objection'; text: string }
  | { action: 'agree' }
  | { action: 'ask' }
  | { action: 'drop'; reason: 'not-my-chat' | 'not-principal' | 'not-negotiation-topic' | 'no-text' };

// Pure: the negotiation relay's whole per-update decision. Order mirrors
// decideUpdateAction's own (chat guard first, per BL-379 - a stranger in a
// foreign chat is "not-my-chat", never any later reason), with the
// negotiation-topic check added as this module's own extra guard: a message
// anywhere else in the target's group (there may be other topics) is never
// mistaken for a negotiation reply.
export function decideNegotiationUpdateAction(
  update: TelegramUpdate,
  principalUserId: string,
  chatId: string,
  negotiationTopicId: number
): NegotiationUpdateDecision {
  if (!isFromMyChat(update, chatId)) {
    return { action: 'drop', reason: 'not-my-chat' };
  }
  if (!isFromPrincipal(update, principalUserId)) {
    return { action: 'drop', reason: 'not-principal' };
  }
  if (topicIdOf(update) !== negotiationTopicId) {
    return { action: 'drop', reason: 'not-negotiation-topic' };
  }
  const text = messageTextOf(update);
  if (!text) {
    return { action: 'drop', reason: 'no-text' };
  }
  if (isAgreementText(text)) {
    return { action: 'agree' };
  }
  if (isAmbiguousIntentText(text)) {
    return { action: 'ask' };
  }
  return { action: 'objection', text };
}

function renderBulletList(entries: string[]): string {
  return entries.length > 0 ? entries.map((entry) => `- ${entry}`).join('\n') : '(none)';
}

// A chat-message rendering of the contract - deliberately plainer than
// contractView.ts's generateContractMarkdown (that one is the legible
// CONTRACT.md view, headed with '#' markdown Telegram's default parse mode
// renders literally, not as headings) - reuses the SAME field order/content,
// never a second contract vocabulary.
export function formatContractForTelegram(contract: ProposedContract): string {
  return [
    'SwarmForge onboarding contract',
    `Agreement: ${contract.agreement}`,
    '',
    'Scope:',
    renderBulletList(contract.scope),
    '',
    'Out of scope:',
    renderBulletList(contract.outOfScope),
    '',
    'Boundaries:',
    renderBulletList(contract.boundaries),
    '',
    'Reply in this topic to object, or reply "agree" to approve.',
  ].join('\n');
}
