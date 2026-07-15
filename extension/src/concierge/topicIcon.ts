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

export type TopicIconState = 'done' | 'defect' | 'feature' | 'paused';

export const ICON_EMOJI: Record<TopicIconState, string> = {
  done: '✅',
  defect: '🦠',
  feature: '🎵',
  paused: '🔍',
};

// Folder membership is authoritative over the ticket's own `type:` for
// done/paused - a paused bug still shows the magnifier, a shipped bug
// still shows the check. Only the active/in-flight case actually branches
// on type.
export function resolveIconState(folder: 'active' | 'paused' | 'done', type: string | undefined): TopicIconState {
  if (folder === 'done') {
    return 'done';
  }
  if (folder === 'paused') {
    return 'paused';
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
