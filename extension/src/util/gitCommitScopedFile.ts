import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

// BL-1475: an attempt now reports WHY it failed, not just whether - the
// retry loop below must retry only a transient index.lock refusal (never a
// real error, e.g. a hook rejection or "nothing to commit"), and a caller
// giving up needs git's own stderr rather than a generic message.
export interface CommitAttemptResult {
  committed: boolean;
  /** True only for a failure that looks like a transient `.git/index.lock`
   * refusal - the one case worth retrying. Never set when committed. */
  retryable?: boolean;
  /** git's own stderr from the failed attempt, captured (never discarded)
   * so a final give-up can log the real reason. Never set when committed. */
  stderr?: string;
}
export type CommitAttemptFn = (targetPath: string, filePath: string, commitMessage: string) => CommitAttemptResult;
export type SleepFn = (ms: number) => void;

const INDEX_LOCK_PATTERN = /index\.lock/;

function defaultAttemptCommit(targetPath: string, filePath: string, commitMessage: string): CommitAttemptResult {
  try {
    execFileSync('git', ['-C', targetPath, 'add', '--', filePath], { stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync('git', ['-C', targetPath, 'commit', '-m', commitMessage, '--', filePath], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { committed: true };
  } catch (err) {
    const stderrBuf = err && typeof err === 'object' ? (err as { stderr?: Buffer | string }).stderr : undefined;
    const stderr = stderrBuf ? String(stderrBuf) : undefined;
    return { committed: false, retryable: INDEX_LOCK_PATTERN.test(stderr ?? ''), stderr };
  }
}

// A real, short SYNCHRONOUS wait (commitScopedFile's callers all depend on
// its synchronous boolean-return contract, so the retry loop below cannot
// go async) - never used by a test, which injects its own no-op sleep
// instead (this codebase's no-real-timers-in-tests rule is about tests,
// not this bounded production backoff).
function defaultSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// BL-1475: raised from 3 attempts / 25ms*attempt (a window measured in tens
// of ms) to a budget actually sized to the guard chain every other commit
// on the shared checkout runs (run_commit_guards.sh, up to the full
// property lane), which can hold `.git/index.lock` for SECONDS. Backoff is
// capped so the total bound stays well inside 30s even at the max attempt
// count (this codebase's own bounded-retry rule) - see the sum in the
// comment below.
const DEFAULT_MAX_ATTEMPTS = 12;
const BASE_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5000;

// Sum of backoffDelayMs(1..11) = 250+500+750+1000+1250+1500+1750+2000+2250+2500+2750 = 16,500ms - well under 30s.
function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * attempt, MAX_RETRY_DELAY_MS);
}

/** Reports the real stderr from a give-up (retryable exhausted, or a
 * non-retryable real failure) - never called on a durable outcome. */
export type CommitFailureDetailFn = (stderr: string | undefined) => void;

// Shared by commitCostHealthSidecar (costHealthSidecar.ts) and
// commitTopicRecord (blTopicStore.ts): both commit exactly one file into an
// already-checked-out repo, scoped so no other dirty state in the worktree
// is swept in, and fail open (never throw) so the caller's own write always
// succeeds regardless of whether this particular commit does — including
// the "nothing to commit" case (e.g. an identical re-run).
//
// BL-407: a single attempt turned a TRANSIENT failure (confirmed live: two
// processes sharing one physical worktree - e.g. the front-desk bot and a
// concurrent coordinator commit - racing on .git/index.lock) into a
// PERMANENT durability gap, since nothing ever retried the commit and
// topicDeletion.ts correctly refuses to delete an unverified topic forever.
// Retries a small, BOUNDED number of times with backoff (this codebase's
// own established retry convention - see the engineering article's
// bounded-retry rule) before giving up and returning false exactly as
// before. attemptCommit/sleep are injected so a test can prove the retry
// and its bound without a real git race or a real wall-clock wait.
//
// BL-1475: only a lock refusal (attemptCommit's own `retryable`) is worth
// retrying - a real error (a hook rejection, a missing path) fails at once.
// Before reporting failure, verify against HEAD (isFileCommitted, which
// already fails closed for a path that was never written): a failed
// attempt does not necessarily mean the path is undurable - another writer
// may have landed the exact same content in the meantime, or it was already
// durable to begin with (an identical rewrite). onFailureDetail carries
// git's real stderr to a caller that wants to log it, e.g. blTopicStore.ts's
// CommitFailureReporter - never called when this function returns true.
export function commitScopedFile(
  targetPath: string,
  filePath: string,
  commitMessage: string,
  attemptCommit: CommitAttemptFn = defaultAttemptCommit,
  sleep: SleepFn = defaultSleep,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  onFailureDetail?: CommitFailureDetailFn
): boolean {
  let lastStderr: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = attemptCommit(targetPath, filePath, commitMessage);
    if (result.committed) {
      return true;
    }
    lastStderr = result.stderr;
    if (!result.retryable || attempt >= maxAttempts) {
      break;
    }
    sleep(backoffDelayMs(attempt));
  }
  if (isFileCommitted(targetPath, filePath)) {
    return true;
  }
  onFailureDetail?.(lastStderr);
  return false;
}

// BL-331 architect bounce: "verified" must mean DURABLY serialised, never
// merely "present in a working-tree file" - commitScopedFile's own commit
// step can fail (network/lock/disk issue) AFTER its write already
// succeeded (CommitFailureReporter's whole reason for existing), leaving a
// record that reads back correctly right now but is lost on a fresh
// checkout/git clean/disk failure until a LATER successful commit lands.
// A caller gating an irreversible action (BL-331's topic delete) on
// "verified" must check the file has no uncommitted changes at all, not
// just that its content parses - `git status --porcelain` for exactly this
// one path is empty only when the working tree matches what is actually
// committed. Fails CLOSED (false = "not confirmed committed") on any git
// error, e.g. not a repo at all - never assume durability it cannot prove.
//
// BL-390 hardening: `git status --porcelain -- <path>` prints nothing for a
// path that is simply ABSENT (never written, never tracked) - the exact
// same empty output as a path that IS committed with no pending changes.
// Left unguarded, that collapses "durable" and "never existed" into one
// return value, in direct contradiction of this function's own fail-closed
// contract above. No current caller triggers it (every caller here writes
// the file via atomicWrite before checking it - blTopicStore.ts's
// appendMessage/commitTopicRecord, repair-bl-topic-records.ts), so this is
// a latent trap rather than a live defect, but it sits directly upstream of
// BL-390's own new no-op guard (commitTopicRecord's early
// `if (isFileCommitted(...)) return true`), so a future check-before-write
// caller would silently skip minting any commit at all. Check existence
// first so a missing file can never read as "already durable".
export function isFileCommitted(targetPath: string, filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    const status = execFileSync('git', ['-C', targetPath, 'status', '--porcelain', '--', filePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return status.trim().length === 0;
  } catch {
    return false;
  }
}
