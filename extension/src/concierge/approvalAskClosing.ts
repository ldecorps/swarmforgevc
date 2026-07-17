// BL-484: a decided approval ask must close itself - strip its inline
// keyboard and show the recorded verdict, rather than sitting forever with
// live Approve/Amend/Reject buttons after the decision has already been
// recorded. This is the PURE core (verdict + instant -> decision line /
// edited text / stale-tap toast text) - the one closing routine the
// ticket's own constraint calls for, shared by BOTH entry points (a button
// tap and a typed reply); the impure Telegram edit/answer calls and the
// persisted message-id lookup live in the thin adapters that call this
// (telegram-front-desk-bot.ts's wiring).

// BL-490: 'expedited' is a THIRD verdict, distinct from 'approved' - the
// underlying human_approval field write reuses the exact same
// recordApprovalReply effect an ordinary Approve tap uses (the ticket's own
// "step (a) must reuse the EXISTING approval writer" constraint), but the
// topic's own audit trail must still show which verb decided it, so the
// closing line reads "-- Expedited <UTC>", never "-- Approved <UTC>".
// BL-509: 'amending' is a FOURTH, non-terminal verdict - unlike the other
// three, it is not a final resolution (the specifier flips it back to
// pending on re-present, slice 3), but it still closes the posted ask the
// same way (the ticket leaves the Approvals topic while being revised).
export type ApprovalDecisionVerdict = { kind: 'approved' } | { kind: 'rejected'; reason: string } | { kind: 'expedited' } | { kind: 'amending' };

// A build-time/cosmetic detail (exact wording), not a promotion gate - the
// ticket's own examples: "-- Approved 2026-07-17 03:07 UTC" /
// "-- Rejected: <reason>". A pure function of an injected epoch-ms - never
// a bare new Date()/Date.now() (engineering no-real-clock rule).
function formatUtcStamp(nowMs: number): string {
  const d = new Date(nowMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function decisionLineFor(verdict: ApprovalDecisionVerdict, nowMs: number): string {
  if (verdict.kind === 'approved') {
    return `-- Approved ${formatUtcStamp(nowMs)}`;
  }
  if (verdict.kind === 'expedited') {
    return `-- Expedited ${formatUtcStamp(nowMs)}`;
  }
  if (verdict.kind === 'amending') {
    return `-- Amending ${formatUtcStamp(nowMs)}`;
  }
  return `-- Rejected: ${verdict.reason}`;
}

// Keeps the original ask text ABOVE the appended decision line (the
// ticket's own "topic stays an audit trail" constraint) - never replaces
// or truncates it.
export function composeDecidedAskText(originalText: string, verdict: ApprovalDecisionVerdict, nowMs: number): string {
  return `${originalText}\n${decisionLineFor(verdict, nowMs)}`;
}

// The stale-tap guard's own toast text - a tap on an ask whose ticket is no
// longer pending gets this instead of any decision side effect.
export function alreadyDecidedToastText(verdict: 'approved' | 'rejected'): string {
  return `Already decided: ${verdict}`;
}
