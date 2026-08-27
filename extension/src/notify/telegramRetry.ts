// BL-239: bounded-retry-then-escalate for Telegram sends, matching the
// project's existing convention (constitution/articles/engineering.prompt) -
// inboxChaser.ts's computeChaseBackoffSeconds (exponential backoff, capped)
// and wedgedRespawn.ts's decideWedgedRespawnAction (bounded attempts,
// escalate on exhaustion). No shared helper module exists for either
// convention to import; this mirrors their shape for a Telegram send instead
// of reimplementing ad hoc backoff math.

export interface TelegramRetryConfig {
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

// attempt is 1-indexed: the count of attempts made so far, including the one
// that just failed. Pure so the bound is testable without a real clock.
export function computeTelegramRetryBackoffMs(attempt: number, config: TelegramRetryConfig): number {
  return Math.min(config.backoffBaseMs * Math.pow(2, attempt - 1), config.backoffMaxMs);
}

export function decideTelegramRetryAction(attempt: number, config: TelegramRetryConfig): 'retry' | 'escalate' {
  return attempt < config.maxAttempts ? 'retry' : 'escalate';
}

export interface SendAttemptResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

export interface BoundedRetryResult extends SendAttemptResult {
  attempts: number;
}

const defaultWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Escalation here means exactly what it means elsewhere in this codebase:
// stop retrying and hand the final failure back to the caller to log/report
// (mirrors chaserMonitor's dead-letter and wedgedRespawn's stuck-escalation
// terminal states) - there is no further automatic recourse for a Telegram
// send, so escalation is observable purely as "gave up after maxAttempts".
export async function sendWithBoundedRetry(
  send: () => Promise<SendAttemptResult>,
  config: TelegramRetryConfig,
  wait: (ms: number) => Promise<void> = defaultWait
): Promise<BoundedRetryResult> {
  let lastResult: SendAttemptResult = { success: false };
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    lastResult = await send();
    if (lastResult.success) {
      return { ...lastResult, attempts: attempt };
    }
    if (decideTelegramRetryAction(attempt, config) === 'retry') {
      await wait(computeTelegramRetryBackoffMs(attempt, config));
    }
  }
  return { ...lastResult, attempts: config.maxAttempts };
}
