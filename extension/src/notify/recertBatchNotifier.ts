// BL-339: "Telegram announces a waiting recert batch and deep-links into
// the PWA" - notify + deep-link only (the operator's own chosen shape;
// verdicts are still given in the PWA, never accepted via Telegram).
//
// selectForRecertification (recertification.ts) ALWAYS returns up to
// batchSize scenarios from whatever recertifiable pool exists, oldest-
// reviewed-first - marking a scenario reviewed only reorders the pool, it
// never empties it (confirmed by reading the real selection logic). So a
// batch's own SIZE is not a reliable "is this a new batch" signal: once
// the human answers the current batch via the PWA, the very next scenario
// rotates to the front and the reported size can stay identical. The
// decision below tracks the batch's own scenario IDENTITIES (their ids),
// not just a count or a boolean armed flag - re-announcing exactly when
// the CURRENT set of waiting ids differs from the last-announced set,
// which correctly covers both "first time waiting" and "a genuinely
// different batch after the prior one was answered" (BL-339's own
// recert-notify-deep-link-06), while never re-announcing the SAME
// outstanding batch on every tick (BL-326: this project has already sent
// 136 real notifications by accident).

export interface RecertAnnouncementDecision {
  shouldAnnounce: boolean;
  // The ids to persist as "already announced" - [] the instant the pool
  // empties (so a later new batch is announced fresh), the CURRENT ids
  // once a real announcement goes out, or the unchanged prior ids when
  // nothing about the waiting set has changed.
  nextAnnouncedIds: string[];
}

function sameIdSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function decideRecertAnnouncement(currentBatchIds: string[], lastAnnouncedIds: string[]): RecertAnnouncementDecision {
  if (currentBatchIds.length === 0) {
    return { shouldAnnounce: false, nextAnnouncedIds: [] };
  }
  if (sameIdSet(currentBatchIds, lastAnnouncedIds)) {
    return { shouldAnnounce: false, nextAnnouncedIds: lastAnnouncedIds };
  }
  return { shouldAnnounce: true, nextAnnouncedIds: currentBatchIds };
}

// One message per batch, never one per scenario (the ticket's own explicit
// scope) - the count is named, never enumerated scenario-by-scenario.
export function buildRecertAnnouncementText(batchSize: number, deepLink: string | null): string {
  const plural = batchSize === 1 ? 'scenario' : 'scenarios';
  const linkLine = deepLink ? `\n${deepLink}` : '';
  return `SwarmForge: ${batchSize} recert ${plural} waiting for your review.${linkLine}`;
}
