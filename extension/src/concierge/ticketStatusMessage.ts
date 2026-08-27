// BL-493: the two pure "testable seams" the ticket's own spec calls out -
// which topic a ticket event targets, and what its edit-in-place status line
// reads - kept separate from topicRouter.ts's I/O orchestration (mirrors this
// codebase's existing convention of a dedicated pure module per concern, e.g.
// topicIcon.ts/topicTitleAge.ts/epicProgress.ts).
import { ICON_EMOJI, TopicIconState } from './topicIcon';

// An epic-bound ticket targets its epic's topic; an epic-less ticket targets
// the standing Backlog topic (BL-492). Read straight off the ticket's OWN
// `epic` field (BacklogItem.epic via backlogReader.ts) - never inferred from
// notes: prose, mirroring BL-341's own epic-membership rule.
export type TicketStatusTarget = { kind: 'epic'; epicId: string } | { kind: 'backlog' };

export function resolveTicketStatusTarget(epic: string | undefined): TicketStatusTarget {
  return epic ? { kind: 'epic', epicId: epic } : { kind: 'backlog' };
}

// The in-message status glyph now that there is no per-ticket topic icon to
// carry lifecycle state (topicIcon.ts's own ICON_EMOJI, carried over per the
// ticket's spec). 'paused'/'awaiting-approval' never actually reach this
// builder in production - a ticket only fires the TaskStarted/TaskCompleted/
// tagged-NeedsApproval events this status line renders for while ACTIVE or
// DONE (a paused ticket has no such event), but both are still mapped here
// for TopicIconState's own exhaustiveness.
const STATUS_LABEL: Record<TopicIconState, string> = {
  done: 'done',
  defect: 'in progress',
  feature: 'in progress',
  paused: 'paused',
  'awaiting-approval': 'awaiting approval',
};

export function buildTicketStatusText(backlogId: string, title: string, state: TopicIconState): string {
  return `${backlogId} ${ICON_EMOJI[state]} ${STATUS_LABEL[state]} — ${title}`;
}
