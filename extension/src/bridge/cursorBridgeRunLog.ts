// BL-1050: the Cursor Remote bridge's own record of a failed run.
//
// The supervisor spawns the bridge with :out-file and :err-file both pointing
// at .swarmforge/operator/cursor-bridge.log, so anything the bridge prints is
// already captured, appended and timestamped next to the supervisor's own
// spawn lines. The bridge simply never printed: a run failure existed in
// exactly one place, a Telegram message - a scrollback nobody can grep, on the
// surface most likely to be unusable during the failure being diagnosed.
//
// Two invariants shape this module.
//
//  1. A failure surfaced to a human is also written to disk. The line is
//     emitted where the failure is DECIDED - before the throw the Telegram
//     poster catches - so the record cannot be reachable only through the code
//     path that also posts. A sink that throws is swallowed for the same
//     reason: losing the log must never become the error the caller reports.
//
//  2. No secret and no conversation content is logged. The line is built from
//     exactly three fields - run id, reason, reset decision - so a prompt or a
//     reply has no way in. The reason comes from the SDK, which is not this
//     module's to trust, so any value of a secret-looking environment variable
//     appearing in it is redacted. cursor-bridge.log is world-readable to
//     anything on this host.

/** Stable grep anchor. Changing it breaks every runbook that greps the log. */
export const CURSOR_RUN_FAILURE_MARKER = 'cursor-bridge run failed';

const REDACTION_PLACEHOLDER = '[redacted]';

// Short values are not redacted: a two-character "secret" would blank ordinary
// words out of every reason and make the log less readable than no log.
const MIN_REDACTABLE_SECRET_LENGTH = 8;

const SECRET_NAME_PATTERN = /(^|_)(API_)?(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS)$/i;

export interface CursorRunFailure {
  runId?: string;
  reason?: string;
  reset: boolean;
}

export interface CursorRunLogDeps {
  sink: (line: string) => void;
  now: () => string;
  env: Record<string, string | undefined>;
}

/**
 * The values this host's environment says are secret, judged by variable NAME
 * only - the value itself is never inspected, logged or compared against a
 * pattern that could leak it through an error message.
 */
export function secretEnvironmentValues(env: Record<string, string | undefined>): Set<string> {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!SECRET_NAME_PATTERN.test(name)) {
      continue;
    }
    const trimmed = (value ?? '').trim();
    if (trimmed.length >= MIN_REDACTABLE_SECRET_LENGTH) {
      values.add(trimmed);
    }
  }
  return values;
}

export function redactEnvironmentSecrets(text: string, env: Record<string, string | undefined>): string {
  let out = text;
  for (const secret of secretEnvironmentValues(env)) {
    out = out.split(secret).join(REDACTION_PLACEHOLDER);
  }
  return out;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function formatCursorRunFailureLine(event: {
  at: string;
  runId?: string;
  reason?: string;
  reset: boolean;
}): string {
  const runId = oneLine(event.runId ?? '') || 'unknown';
  const reason = oneLine(event.reason ?? '') || 'unknown';
  return `${event.at} ${CURSOR_RUN_FAILURE_MARKER} run=${runId} reset=${event.reset ? 'yes' : 'no'} reason=${reason}`;
}

/**
 * Builds and emits the line. Returns it so a caller can assert on what was
 * recorded without reaching for the sink - and so the throw that follows can
 * be reasoned about next to the record it is guaranteed to have.
 */
export function logCursorRunFailure(failure: CursorRunFailure, deps: CursorRunLogDeps): string {
  const line = formatCursorRunFailureLine({
    at: deps.now(),
    runId: failure.runId,
    reason: redactEnvironmentSecrets(failure.reason ?? '', deps.env),
    reset: failure.reset,
  });
  try {
    deps.sink(line);
  } catch {
    // Invariant 1 is about the record existing, not about the record being
    // load-bearing: a broken log device must not turn into the error the
    // human sees instead of the real run failure.
  }
  return line;
}

/** The default seams: stderr (which the supervisor already redirects) and the real clock. */
export function defaultCursorRunLogDeps(): CursorRunLogDeps {
  return {
    sink: (line) => console.error(line),
    now: () => new Date().toISOString(),
    env: process.env,
  };
}
