// BL-449: an epic is a large-scale musical FORM, so each epic topic gets its
// own performance-emoji icon - a NEW, separate assignment path from
// topicIcon.ts's ticket-state icons (ICON_EMOJI/resolveIconState) and
// STANDING_TOPIC_ICON, never a member of either. The three epic topics the
// human hand-created before this ticket existed (147 Swarm Role
// Benchmarking, 149 Dynamic Routing, 151 Onboarding a New Target Repo) get
// finalised, distinct glyphs; any further epic is auto-assigned the next
// distinct icon from this ordered pool. Pool order and membership per
// icon-system.md §5a (verified against the live getForumTopicIconStickers
// set 2026-07-15) - 🎶 is deliberately excluded: at badge size it reads as
// 🎵, the ticket-state feature-in-flight icon, so including it would
// reintroduce the exact collision this pool exists to avoid.
export const EPIC_ICON_POOL: readonly string[] = ['🎙', '🎭', '🎬', '🎤', '🎨', '🎩', '🕺', '💃', '✍️', '📚'];

// Fixed glyphs for the three epics the human named directly (finalised with
// him 2026-07-16) - never displaced by the pool-assignment branch below,
// regardless of what else is already assigned.
const KNOWN_EPIC_ICON: Readonly<Record<string, string>> = {
  'role-benchmarking': '🎙',
  'dynamic-routing': '🎭',
  'onboarding-target-repo': '🎬',
};

// Pure: no I/O, no live sticker-set validation (that stays syncTopicIcon's
// job, reused unchanged for epics - see topicIconSync.ts). A known epic id
// resolves to its fixed glyph; any other epic id resolves to the first pool
// icon not already in alreadyAssignedIcons, so a caller assigning several
// epics in one pass can thread its own already-resolved icons through to
// keep them distinct. Distinctness is best-effort only: once every pool
// slot is taken, this gracefully reuses the pool's last icon rather than
// throwing - a caller wiring a live tick decides whether/how to log that
// reuse, this function never has I/O of its own to do so.
// BL-457: does this epic id carry a fixed, pinned glyph (vs. a pool-assigned
// one)? A caller resolving several epics in one pass uses this to RESERVE
// every present known epic's glyph before handing pool icons to unknown
// epics, so an unknown epic can never grab a known epic's pinned icon.
export function isKnownEpic(epicId: string): boolean {
  return Object.prototype.hasOwnProperty.call(KNOWN_EPIC_ICON, epicId);
}

export function resolveEpicIcon(epicId: string, alreadyAssignedIcons: string[] = []): string {
  // Branch on the SAME own-property guard isKnownEpic uses, so the two can
  // never disagree: a bare KNOWN_EPIC_ICON[epicId] lookup reaches
  // Object.prototype, and an epic id named after a prototype member
  // ('valueOf', 'toString', ...) would resolve to the inherited FUNCTION -
  // which both live callers pass straight to the Telegram API (BL-946
  // bounce D1).
  if (isKnownEpic(epicId)) {
    return KNOWN_EPIC_ICON[epicId];
  }
  const used = new Set(alreadyAssignedIcons);
  const next = EPIC_ICON_POOL.find((icon) => !used.has(icon));
  return next ?? EPIC_ICON_POOL[EPIC_ICON_POOL.length - 1];
}
