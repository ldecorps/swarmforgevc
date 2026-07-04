"use strict";
// BL-093: every pane-injection call site (respawnAgent, the '/clear' path,
// handoffd.bb's notify!) fires send-keys and forgets. Observed live: a lost
// Enter left an instruction typed-but-unsubmitted; repeated respawn attempts
// stacked three unconsumed copies of the same command in one pane. This
// module is the shared, host-I/O-free seam: given a pane capture and the
// text just injected, decide whether the input line still holds it, and
// orchestrate a bounded verify/retry/report loop against injectable
// send/capture functions so it is testable without a real tmux server.
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPendingInput = hasPendingInput;
exports.isTextStillPending = isTextStillPending;
exports.sendInstructionVerified = sendInstructionVerified;
// Heuristic: the input line is whatever trails the last recognizable prompt
// marker (a shell '$'/'#' or a TUI arrow '>'/'❯') on the last non-blank line
// of the capture. Absent any marker, the whole last non-blank line counts
// (covers panes rendering a bare input box with no visible marker). A marker
// with nothing after it (e.g. a lone "❯ ") is an empty, not pending, prompt -
// distinct from "no marker at all", which is treated as unstructured pending
// text (e.g. a plain human line with no rendered prompt yet).
const HAS_MARKER = /[$#❯>]/;
const MARKER_TAIL = /[$#❯>]\s*(\S.*)?$/;
function lastNonBlankLine(paneText) {
    const lines = paneText.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().length > 0) {
            return lines[i];
        }
    }
    return undefined;
}
function pendingInputLine(paneText) {
    const line = lastNonBlankLine(paneText);
    if (line === undefined) {
        return '';
    }
    if (!HAS_MARKER.test(line)) {
        return line.trim();
    }
    const match = MARKER_TAIL.exec(line);
    return match?.[1]?.trim() ?? '';
}
/** True when the pane's input line already holds unsubmitted content. */
function hasPendingInput(paneText) {
    return pendingInputLine(paneText).length > 0;
}
/**
 * True when `text` (the string just typed) is still sitting in the pane's
 * input line, i.e. the submit (Enter) has not taken effect yet.
 */
function isTextStillPending(paneText, text) {
    const pending = pendingInputLine(paneText);
    return pending.length > 0 && pending.includes(text.trim());
}
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 200;
/**
 * Types `text` into a pane and confirms it was submitted, retrying Enter
 * with backoff. Never stacks: if the pane already holds undelivered input
 * when called, it retries submitting THAT (never types a new copy on top)
 * and reports rather than silently dropping either instruction.
 */
function sendInstructionVerified(deps, text, options = {}) {
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const before = deps.capturePane();
    let pendingText = text;
    let typed = false;
    if (hasPendingInput(before)) {
        // Something is already sitting there undelivered (ours from a prior
        // failed attempt, or unrelated) - recover it, do not append a copy.
        pendingText = pendingInputLine(before);
    }
    else {
        if (!deps.sendLiteral(text)) {
            return { status: 'failed', attempts: 0, reason: 'send failed at the transport level' };
        }
        typed = true;
    }
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
//# sourceMappingURL=verifiedInject.js.map