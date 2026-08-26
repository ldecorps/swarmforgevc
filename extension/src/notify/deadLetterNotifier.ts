// BL-353: ports the legacy single-chat narrator's "dead-letter" signal
// (extension/src/notify/telegramNarrator.ts:diffNewDeadLetters, retired by
// this ticket) onto the headless front desk. A dead-lettered handoff is not
// reliably ticket-scoped (the handoff's own free-text `task` field is not
// guaranteed to be a real BL-### id, unlike a live gate's roleTicket
// resolution - swarmEventStream.ts's SwarmEvent requires a real backlogId),
// so this is a swarm-wide announcement into BL-346's reserved Operator
// topic, not a per-ticket BL-topic post - the same "not any one ticket"
// channel BL-346 already built for exactly this kind of announcement.
//
// Growing-set semantics, not id-set-replace like recertBatchNotifier.ts:
// a dead-lettered file stays dead-lettered until a human handles it (never
// automatically "un-dead-letters"), so the durable state only ever GROWS -
// no need to un-arm/re-arm on a signal clearing, unlike BL-339's recert
// batch or BL-345/BL-349's alarm state.
import { DeadLetterInfo } from '../swarm/inboxChaser';

export interface DeadLetterAnnouncementDecision {
  shouldAnnounce: boolean;
  // The FULL set to persist as "already announced" once delivered - the
  // union of what was already known plus any new ones this sweep found.
  nextAnnouncedIds: string[];
}

export function decideDeadLetterAnnouncement(currentFilePaths: string[], alreadyAnnouncedFilePaths: string[]): DeadLetterAnnouncementDecision {
  const announced = new Set(alreadyAnnouncedFilePaths);
  const newOnes = currentFilePaths.filter((p) => !announced.has(p));
  if (newOnes.length === 0) {
    return { shouldAnnounce: false, nextAnnouncedIds: alreadyAnnouncedFilePaths };
  }
  return { shouldAnnounce: true, nextAnnouncedIds: [...alreadyAnnouncedFilePaths, ...newOnes] };
}

function describeDeadLetter(dl: DeadLetterInfo): string {
  const label = dl.task || dl.type || 'handoff';
  return `${dl.role}: ${label} (${dl.filePath.split('/').pop()})`;
}

export function buildDeadLetterAnnouncementText(newDeadLetters: DeadLetterInfo[]): string {
  const plural = newDeadLetters.length === 1 ? 'item' : 'items';
  const lines = newDeadLetters.map((dl) => `- ${describeDeadLetter(dl)}`);
  return `SwarmForge: ${newDeadLetters.length} dead-lettered ${plural} - nobody picked ${newDeadLetters.length === 1 ? 'it' : 'them'} up after repeated chases.\n${lines.join('\n')}`;
}
