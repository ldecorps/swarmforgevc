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
