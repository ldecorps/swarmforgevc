// BL-342: a topic's icon tracks its ticket's state instead of rotting -
// pure resolution logic only (no I/O; the icon is a UI signal, never a
// decision anything else in the swarm depends on). The Operator applied
// this exact convention by hand across 26 ticket topics:
//   check (✅) = done/shipped; microbe (🦠) = defect in flight;
//   musical note (🎵) = feature in flight; magnifier (🔍) = paused/held.
// BL-417: feature-in-flight remapped from the bulb (💡) to the musical note
// (🎵) - the orchestra icon remap's one ticket-level change, within
// Telegram's free sticker set (no instruments/notation available, so the
// note is the closest musical stand-in - "a passage being played"). The
// other three states have no musical stand-in that beats their existing
// icon and are unchanged.
// Epic icons (trophy/lightning/folder) are OUT of scope here entirely -
// they were hand-assigned to specific named epics, never derived from a
// ticket's own type/state, and the automated sync this module feeds only
// ever fires from ticket-level TaskStarted/TaskCompleted/pause
// transitions - an epic topic is simply never a target of it.

// BL-424: a paused ticket blocked ONLY on the human's own approval
// (actionable by him right now) is otherwise indistinguishable by icon from
// a paused ticket held for any other reason (a dependency, an overlap hold,
// a deliberate park) - 'awaiting-approval' is a fifth, paused-scoped state
// so the human can glance the topic list and see which paused tickets need
// him specifically. Eyes (👀) reads as "needs a look" and is a stand-in for
// the human's OWN attention, distinct from the other four states'
// established conventions (see the header comment above).
export type TopicIconState = 'done' | 'defect' | 'feature' | 'paused' | 'awaiting-approval';

export const ICON_EMOJI: Record<TopicIconState, string> = {
  done: '✅',
  defect: '🦠',
  feature: '🎵',
  paused: '🔍',
  'awaiting-approval': '👀',
};

// Folder membership is authoritative over the ticket's own `type:` for
// done/paused - a paused bug still shows the magnifier, a shipped bug
// still shows the check. Only the active/in-flight case actually branches
// on type.
// BL-424: humanApproval only ever matters for the paused branch - an
// active or done ticket keeps its existing icon even if its approval field
// were somehow pending, since the marker exists to flag a paused hold the
// human can clear, not the field's raw value.
export function resolveIconState(
  folder: 'active' | 'paused' | 'done',
  type: string | undefined,
  humanApproval?: 'pending' | 'approved'
): TopicIconState {
  if (folder === 'done') {
    return 'done';
  }
  if (folder === 'paused') {
    return humanApproval === 'pending' ? 'awaiting-approval' : 'paused';
  }
  return type === 'bug' ? 'defect' : 'feature';
}

export interface IconStickerLookup {
  emoji?: string;
  customEmojiId: string;
}

// BL-342 scenario 06: icon ids are NOT free-form - Telegram allows only
// the set getForumTopicIconStickers actually returns (112 today). This
// resolves a semantic emoji against that REAL, live-fetched list; an
// emoji absent from it (a set that can change over time, per Telegram's
// own docs) resolves to undefined rather than a hardcoded id that was
// never validated and would fail at call time on a live topic.
export function resolveIconStickerId(stickers: IconStickerLookup[], emoji: string): string | undefined {
  return stickers.find((s) => s.emoji === emoji)?.customEmojiId;
}

// BL-418: the orchestra remap's harder half - icons for the STANDING
// non-ticket topics (support/intake, the Operator), extending BL-342's
// mapping beyond ticket-state icons. A separate table from ICON_EMOJI
// above: these two keys are never a ticket's folder/type, so they get
// their own type rather than growing TopicIconState with unrelated
// members. support/intake is the box office (🎟); the Operator standing
// topic is the opera house (🏛) - both human-decided 2026-07-15, within
// Telegram's free sticker set (docs/branding/icon-system.md).
// BL-434: 'approvals' extends the standing-topic icon set for the new
// standing Approvals topic - a clipboard (📋) reads as "items awaiting
// sign-off", distinct from the Operator's opera house and support/intake's
// ticket stub, within Telegram's free sticker set (same constraint the
// header comment above already documents for the other two).
export type StandingTopicKey = 'support/intake' | 'operator' | 'approvals';

export const STANDING_TOPIC_ICON: Record<StandingTopicKey, string> = {
  'support/intake': '🎟',
  operator: '🏛',
  approvals: '📋',
};

// A single standing topic the concierge tick's icon sync targets - either
// the one Operator topic or one of potentially many open support subjects
// (every SUP-### thread the human is only ever the one who creates, by
// messaging into an unbound topic - the swarm never mints these itself,
// unlike a ticket's own topic). `id` is the durable ownership-marker key
// (blTopicStore's readSwarmIconId/recordSwarmIconId, reused generically -
// never a second parallel store); `topicId` is the real Telegram topic to
// set the icon on.
export interface StandingTopicTarget {
  id: string;
  topicId: number;
  iconKey: StandingTopicKey;
}
