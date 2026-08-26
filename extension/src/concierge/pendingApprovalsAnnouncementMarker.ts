// BL-649 pending-set identity gate: durable marker suppresses duplicate doorbell
// posts when the pending approval set is unchanged across restarts (re-announce
// on set change or after 24h — same posture as approvalsRosterSync markers).

import type { TickState } from './conciergeTick';
import type { PendingApprovalsAnnouncementMarker } from './pendingApprovalsAnnouncement';

export function readApprovalsAnnouncementMarker(state: TickState): PendingApprovalsAnnouncementMarker | undefined {
  return state.approvalsAnnouncementMarker;
}

export function withApprovalsAnnouncementMarker(
  state: TickState,
  marker: PendingApprovalsAnnouncementMarker | undefined
): TickState {
  if (!marker) {
    const next = { ...state };
    delete next.approvalsAnnouncementMarker;
    return next;
  }
  return { ...state, approvalsAnnouncementMarker: marker };
}
