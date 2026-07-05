// BL-093: every pane-injection call site (respawnAgent, the '/clear' path,
// handoffd.bb's notify!) fires send-keys and forgets. Observed live: a lost
// Enter left an instruction typed-but-unsubmitted; repeated respawn attempts
// stacked three unconsumed copies of the same command in one pane. This
// module is the shared, host-I/O-free seam: given a pane capture and the
// text just injected, decide whether the input line still holds it, and
// orchestrate a bounded verify/retry/report loop against injectable
// send/capture functions so it is testable without a real tmux server.

// Heuristic: the input line is whatever trails the last recognizable prompt
// marker (a shell '$'/'#' or a TUI arrow '>'/'❯') on the last non-blank line
// of the capture. A marker with nothing after it (e.g. a lone "❯ ") is an
// empty, not pending, prompt.
//
// BL-109: a line with NO recognizable marker at all is standing UI chrome,
// not pending input - e.g. Claude Code's idle status footer ("  ⏵⏵ bypass
// permissions on (shift+tab to cycle)  /rc"), which contains none of
// `$#❯>` and rendered as the pane's last non-blank line while genuinely
// idle. An earlier version of this heuristic treated "no marker" as
// unstructured pending text (to cover a hypothetical bare input box with no
// visible marker); in practice that meant a Claude Code pane's idle footer
// read as forever-pending, unsubmitted text, so beginInjection took the
// "recover pending text" branch and never typed the real wake-up message at
// all - a deterministic, 100%-reproducible failure specifically when the
// target was IDLE. The marker is the only reliable signal that a line IS
// the input row; absent one, there is nothing pending.
const HAS_MARKER = /[$#❯>]/;
const MARKER_TAIL = /[$#❯>]\s*(\S.*)?$/;

function lastNonBlankLine(paneText: string): string | undefined {
  const lines = paneText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) {
      return lines[i];
    }
  }
  return undefined;
}

function pendingInputLine(paneText: string): string {
  const line = lastNonBlankLine(paneText);
  if (line === undefined || !HAS_MARKER.test(line)) {
    return '';
  }
  // The optional-chaining link here is unkillable in this module's usage:
  // MARKER_TAIL shares HAS_MARKER's exact character class, so once the guard
  // above passes, MARKER_TAIL is guaranteed to match (its trailing groups
  // are all optional and can absorb any suffix) - `match` is never null in
  // practice.
  const match = MARKER_TAIL.exec(line);
  return match?.[1]?.trim() ?? '';
}

/** True when the pane's input line already holds unsubmitted content. */
export function hasPendingInput(paneText: string): boolean {
  return pendingInputLine(paneText).length > 0;
}

/**
 * True when `text` (the string just typed) is still sitting in the pane's
 * input line, i.e. the submit (Enter) has not taken effect yet.
 */
export function isTextStillPending(paneText: string, text: string): boolean {
  const pending = pendingInputLine(paneText);
  return pending.length > 0 && pending.includes(text.trim());
}

export interface VerifiedInjectDeps {
  capturePane: () => string;
  // Returns false when the underlying send itself failed at the transport
  // level (e.g. tmux send-keys exited non-zero) - distinct from "typed fine
  // but never submitted", which the retry loop below handles. A false
  // return aborts immediately: retrying capture/Enter against a send that
  // never reached the pane would just burn the backoff delays for nothing.
  sendLiteral: (text: string) => boolean;
  sendEnter: () => void;
  wait: (ms: number) => void;
}

export interface VerifiedInjectOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

export type VerifiedInjectStatus = 'delivered' | 'skipped-pending' | 'failed';

export interface VerifiedInjectResult {
  status: VerifiedInjectStatus;
  attempts: number;
  reason?: string;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 200;

/**
 * Types `text` into a pane and confirms it was submitted, retrying Enter
 * with backoff. Never stacks: if the pane already holds undelivered input
 * when called, it retries submitting THAT (never types a new copy on top)
 * and reports rather than silently dropping either instruction.
 */
export function sendInstructionVerified(
  deps: VerifiedInjectDeps,
  text: string,
  options: VerifiedInjectOptions = {}
): VerifiedInjectResult {
  const start = beginInjection(deps, text);
  if (start.failure) {
    return start.failure;
  }

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  return retryUntilSubmitted(deps, start.pendingText, start.typed, maxRetries, retryDelayMs);
}

interface InjectionStart {
  pendingText: string;
  typed: boolean;
  failure?: VerifiedInjectResult;
}

// Split out of sendInstructionVerified (CRAP): decides whether to type the
// text fresh or recover an already-pending line, never both (never-stacks).
function beginInjection(deps: VerifiedInjectDeps, text: string): InjectionStart {
  const before = deps.capturePane();
  if (hasPendingInput(before)) {
    // Something is already sitting there undelivered (ours from a prior
    // failed attempt, or unrelated) - recover it, do not append a copy.
    return { pendingText: pendingInputLine(before), typed: false };
  }
  if (!deps.sendLiteral(text)) {
    return {
      pendingText: text,
      typed: false,
      failure: { status: 'failed', attempts: 0, reason: 'send failed at the transport level' },
    };
  }
  return { pendingText: text, typed: true };
}

// Split out of sendInstructionVerified (CRAP): the bounded verify/retry loop
// against whichever text beginInjection decided to track.
function retryUntilSubmitted(
  deps: VerifiedInjectDeps,
  pendingText: string,
  typed: boolean,
  maxRetries: number,
  retryDelayMs: number
): VerifiedInjectResult {
  let attempts = 1;
  deps.sendEnter();
  for (;;) {
    const capture = deps.capturePane();
    if (!isTextStillPending(capture, pendingText)) {
      return { status: 'delivered', attempts };
    }
    if (attempts >= maxRetries) {
      return {
        status: typed ? 'failed' : 'skipped-pending',
        attempts,
        reason: typed
          ? `submit not confirmed after ${attempts} attempt(s)`
          : 'pane already held undelivered input and it still would not submit',
      };
    }
    deps.wait(retryDelayMs * attempts);
    deps.sendEnter();
    attempts += 1;
  }
}
