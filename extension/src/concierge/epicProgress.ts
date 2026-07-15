// BL-341: an epic's slices are TICKETED (real backlog items declaring
// `epic: <id>`) or REMAINING-UNTRACKED (declared only in the epic's own
// definition, no ticket yet). The load-bearing requirement: an epic view
// that could only see tickets would show every one of the human's three
// real epics as "done" while hiding the untracked gap that was the whole
// reason he needed the view - epicProgressText below never claims
// completion while a remaining-untracked slice still exists. Pure and
// fully decoupled from conciergeTick.ts's adapter-injected orchestration.

export interface EpicDefinition {
  id: string;
  title: string;
  // Free-text descriptions of work known to belong to this epic but not
  // yet ticketed - human/specifier-authored, since nothing in the backlog
  // can derive an unticketed slice's existence on its own.
  remainingSlices: string[];
}

export interface EpicSlice {
  done: boolean;
}

export interface EpicProgress {
  epicId: string;
  ticketedTotal: number;
  ticketedDone: number;
  remainingUntracked: string[];
}

export function computeEpicProgress(definition: EpicDefinition, slices: EpicSlice[]): EpicProgress {
  return {
    epicId: definition.id,
    ticketedTotal: slices.length,
    ticketedDone: slices.filter((s) => s.done).length,
    remainingUntracked: definition.remainingSlices,
  };
}

export function epicOpeningText(title: string): string {
  return `Epic: ${title}`;
}

// BL-394: the epic announcement's own durable dedup key - content-based
// (epicId + the exact announced text) so ANY change in what would be
// announced (progress advancing, or the one-time opening line) is a new
// key that announces once, while an unchanged announcement is deduped
// forever regardless of how many times its triggering event re-derives.
// Mirrors swarmEventKey's "stable identity" contract (swarmEventStream.ts)
// but keyed on content rather than event type, because an event key alone
// does not capture whether what it would announce actually changed - the
// live incident this fixes was an unrelated per-ticket post stuck
// retrying every tick, dragging an unchanged epic announcement along with
// it despite the aggregate never moving.
export function epicAnnouncementKey(epicId: string, text: string): string {
  return `EpicUpdate:${epicId}:${text}`;
}

// Never claims completion while an untracked remaining slice exists - every
// ticketed slice being done must not read as "the epic is done" when real
// remaining work is recorded only in the epic's own definition.
export function epicProgressText(progress: EpicProgress): string {
  const base = `${progress.ticketedDone} of ${progress.ticketedTotal} ticketed slice(s) complete.`;
  if (progress.remainingUntracked.length === 0) {
    return progress.ticketedDone === progress.ticketedTotal ? `${base} Epic complete.` : base;
  }
  return `${base} Remaining (not yet ticketed): ${progress.remainingUntracked.join(', ')}.`;
}
