// BL-1066: the swarm panel recomputed mean ticket time on its 2-second stage
// poll tick, and one computation was ~794 `git log --follow` walks - about
// 102 seconds of git. Two independent things went wrong there and both are
// decided here, once, rather than in the panel's tick body:
//
//   1. A tick must never start a computation while one is still running.
//   2. A tick must not start one at all until the last result has aged past
//      its own refresh interval - the expensive walk belongs on a far slower
//      cadence than the tick that used to drive it.
//
// The gate is deliberately generic over what it computes: it owns the "may
// this tick compute now" decision and the last published value, nothing about
// metrics. That keeps both decisions testable without booting VS Code, which
// the panel itself is not.

export type MetricsTickOutcome = 'ran' | 'in-flight' | 'throttled';

export interface MetricsTickGateOptions {
  // How long a published value stands before a tick may recompute.
  minIntervalMs: number;
  now: () => number;
}

export interface MetricsTickGate<T> {
  // Runs `compute` if this tick is allowed to, and reports which of the
  // three things happened. Never queues: a refused tick is dropped, because
  // the next one is already on its way.
  //
  // `subject` names WHAT is being computed (for the panel, the target repo).
  // A tick naming a different subject from the standing value is never
  // throttled: the refresh interval exists to avoid recomputing the same
  // answer, not to serve one subject's answer for another. Callers with a
  // single subject can leave it out.
  run(compute: () => T, subject?: string): MetricsTickOutcome;
  // The most recent successfully computed value, or null before the first.
  latest(): T | null;
  isInFlight(): boolean;
}

export function createMetricsTickGate<T>(options: MetricsTickGateOptions): MetricsTickGate<T> {
  let inFlight = false;
  let latestValue: T | null = null;
  let lastCompletedAtMs: number | null = null;
  let latestSubject: string | undefined;

  function standingValueAnswers(subject: string | undefined): boolean {
    return subject === latestSubject && lastCompletedAtMs !== null && options.now() - lastCompletedAtMs < options.minIntervalMs;
  }

  return {
    run(compute: () => T, subject?: string): MetricsTickOutcome {
      if (inFlight) {
        return 'in-flight';
      }
      if (standingValueAnswers(subject)) {
        return 'throttled';
      }
      latestSubject = subject;
      inFlight = true;
      try {
        latestValue = compute();
        return 'ran';
      } finally {
        // A computation that THREW still opens the refresh window and still
        // clears the in-flight flag. Retrying a failing computation on every
        // tick would be the same storm with a failing git in it, and a stuck
        // in-flight flag would freeze the metric forever.
        lastCompletedAtMs = options.now();
        inFlight = false;
      }
    },
    latest(): T | null {
      return latestValue;
    },
    isInFlight(): boolean {
      return inFlight;
    },
  };
}
