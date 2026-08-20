// BL-449: each epic topic gets its own distinct icon - a NEW, separate
// assignment path from topicIcon.ts's ticket-state icons
// (ICON_EMOJI/resolveIconState), STANDING_TOPIC_ICON and ROLE_TOPIC_ICON,
// never a member of any of them. The three epic topics the human
// hand-created before this ticket existed (147 Swarm Role Benchmarking,
// 149 Dynamic Routing, 151 Onboarding a New Target Repo) get finalised,
// distinct glyphs; any further epic is auto-assigned the next distinct icon
// from this ordered pool.
//
// BL-946 (Architecture Rule 6 as amended 2026-08-19): the pool draws from
// the WHOLE stock getForumTopicIconStickers set, not only its
// musical/performance corner - 10 glyphs against 39 live epics collapsed
// three epics in four onto the pool's reuse tail. The pool is DERIVED, not
// hand-picked: the committed live-set snapshot minus every glyph reserved
// by the three other icon tables and minus the badge-size read-alikes of
// reserved glyphs (🎶 reads as 🎵, the ticket-state feature icon, at badge
// size - the collision this pool exists to avoid). Deriving is what makes
// "every member resolves in the live set" true by construction; hand-picking
// is the step that bounced BL-469 twice on 2026-07-17. The original 10
// glyphs stay as the order prefix so every already-assigned epic keeps its
// badge; everything after them follows the snapshot's own stable order.
import { FORUM_TOPIC_ICON_STICKER_SET } from './forumTopicIconStickerSet';
import { ICON_EMOJI, STANDING_TOPIC_ICON, ROLE_TOPIC_ICON } from './topicIcon';

const ORIGINAL_POOL_ORDER_PREFIX: readonly string[] = ['🎙', '🎭', '🎬', '🎤', '🎨', '🎩', '🕺', '💃', '✍️', '📚'];

// Glyphs that read as a reserved table's icon at badge size, generalised
// from the original musical-note pair. Each entry names its reserved twin.
const BADGE_SIZE_READ_ALIKES: readonly string[] = [
  '🎶', // reads as 🎵 (ICON_EMOJI.feature)
];

const RESERVED_GLYPHS: ReadonlySet<string> = new Set([
  ...Object.values(ICON_EMOJI),
  ...Object.values(STANDING_TOPIC_ICON),
  ...Object.values(ROLE_TOPIC_ICON),
  ...BADGE_SIZE_READ_ALIKES,
]);

export const EPIC_ICON_POOL: readonly string[] = [
  ...ORIGINAL_POOL_ORDER_PREFIX,
  ...FORUM_TOPIC_ICON_STICKER_SET.filter(
    (glyph) => !RESERVED_GLYPHS.has(glyph) && !ORIGINAL_POOL_ORDER_PREFIX.includes(glyph)
  ),
];

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
  const known = KNOWN_EPIC_ICON[epicId];
  if (known !== undefined) {
    return known;
  }
  const used = new Set(alreadyAssignedIcons);
  const next = EPIC_ICON_POOL.find((icon) => !used.has(icon));
  return next ?? EPIC_ICON_POOL[EPIC_ICON_POOL.length - 1];
}
