// BL-833: bounded per-session host-agent activity feed (tee of progress lines).
// Observing must never damage the turn — every public write swallows errors.

export const HOST_ACTIVITY_FEED_BOUND = 128;

export type HostActivityQuiet = { status: 'quiet' };
export type HostActivityActive = {
  status: 'active';
  sessionId: string;
  lines: string[];
};
export type HostActivityState = HostActivityQuiet | HostActivityActive;

export type HostActivityLineListener = (payload: {
  sessionId: string;
  line: string;
}) => void;

type FeedSession = { sessionId: string; lines: string[] };

let session: FeedSession | undefined;
const listeners = new Set<HostActivityLineListener>();
let appendHook: ((sessionId: string, line: string, lines: string[]) => void) | undefined;

export function hostActivityFeedBound(): number {
  return HOST_ACTIVITY_FEED_BOUND;
}

export function beginHostActivitySession(sessionId: string): void {
  session = { sessionId, lines: [] };
}

export function endHostActivitySession(): void {
  session = undefined;
}

function defaultAppend(sessionId: string, line: string, lines: string[]): void {
  lines.push(line);
  if (lines.length > HOST_ACTIVITY_FEED_BOUND) {
    lines.splice(0, lines.length - HOST_ACTIVITY_FEED_BOUND);
  }
  void sessionId;
}

/** Best-effort record. Never throws to the caller (invariant 3). */
export function recordHostActivityLine(line: string): void {
  try {
    if (!session || typeof line !== 'string' || line.length === 0) {
      return;
    }
    const { sessionId, lines } = session;
    const append = appendHook ?? defaultAppend;
    append(sessionId, line, lines);
    for (const listener of listeners) {
      listener({ sessionId, line });
    }
  } catch {
    // Feed failures must not delay, drop, or fail the host turn.
  }
}

export function readHostActivityFeed(): HostActivityState {
  if (!session) {
    return { status: 'quiet' };
  }
  return {
    status: 'active',
    sessionId: session.sessionId,
    lines: session.lines.slice(),
  };
}

export function subscribeHostActivity(listener: HostActivityLineListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: make the write path throw (or restore default). */
export function __setHostActivityAppendHookForTests(
  hook: ((sessionId: string, line: string, lines: string[]) => void) | undefined
): void {
  appendHook = hook;
}

export function __resetHostActivityFeedForTests(): void {
  session = undefined;
  listeners.clear();
  appendHook = undefined;
}
