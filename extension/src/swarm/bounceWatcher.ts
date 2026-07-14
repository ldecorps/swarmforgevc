import * as fs from 'fs';
import * as path from 'path';

export type BounceType = 'swarm' | 'extension' | 'all';

// BL-131: shared by every fs.watch-callback debounce in this file and in
// bounceDrain.ts's handleGracefulWatchEvent (which mirrors this same
// pattern for its own trigger file) - one place for the type and the
// real-setTimeout default instead of six repeated inline copies (jscpd
// flagged the repetition once the scheduleTick param made these
// functions' signatures line up almost exactly).
export type ScheduleTick = (fn: () => void, ms: number) => void;
export const defaultScheduleTick: ScheduleTick = (fn, ms) => {
  setTimeout(fn, ms);
};

export function isBounceType(value: unknown): value is BounceType {
  return value === 'swarm' || value === 'extension' || value === 'all';
}

export interface BounceParsed {
  valid: boolean;
  bounceType?: BounceType;
  error?: string;
}

export function parseBounceFile(content: string): BounceParsed {
  const trimmed = content.trim();

  if (trimmed === 'swarm') {
    return { valid: true, bounceType: 'swarm' };
  }
  if (trimmed === 'extension') {
    return { valid: true, bounceType: 'extension' };
  }
  if (trimmed === 'all') {
    return { valid: true, bounceType: 'all' };
  }

  return { valid: false, error: `Unknown bounce type: ${trimmed}` };
}

function reportBounceError(onError: ((error: string) => void) | undefined, message: string): void {
  if (onError) {
    onError(message);
  }
}

export function processBounceFile(
  filePath: string,
  onBounce: (bounceType: BounceType) => void,
  onError?: (error: string) => void,
): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseBounceFile(content);

    if (!parsed.valid) {
      reportBounceError(onError, parsed.error || 'Unknown error');
    } else if (parsed.bounceType) {
      onBounce(parsed.bounceType);
    }

    // Delete the file after processing (whether valid or invalid)
    fs.unlinkSync(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportBounceError(onError, `Failed to process bounce file: ${message}`);
  }
}

// BL-131: the filename guard + debounce is the only substantive logic behind
// fs.watch's callback, and is fully testable without a real OS watch event -
// pulled out so tests can drive it directly with an injected scheduleTick
// instead of writing real files and waiting on real fs.watch timing. Shared
// by handleWatchEvent below and bounceDrain.ts's handleGracefulWatchEvent,
// which mirrors this exact fs.watch pattern for its own trigger file - only
// the expected filename and target path differ.
export function handleFileWatchEvent(
  filename: string | null,
  expectedFilename: string,
  filePath: string,
  onBounce: (bounceType: BounceType) => void,
  onError: ((error: string) => void) | undefined,
  scheduleTick: ScheduleTick = defaultScheduleTick,
): void {
  if (filename !== expectedFilename) {
    return;
  }

  // Small delay to ensure file is fully written
  scheduleTick(() => {
    if (fs.existsSync(filePath)) {
      processBounceFile(filePath, onBounce, onError);
    }
  }, 50);
}

export function handleWatchEvent(
  filename: string | null,
  bounceFilePath: string,
  onBounce: (bounceType: BounceType) => void,
  onError: ((error: string) => void) | undefined,
  scheduleTick: ScheduleTick = defaultScheduleTick,
): void {
  handleFileWatchEvent(filename, 'bounce', bounceFilePath, onBounce, onError, scheduleTick);
}

// BL-115: fs.watch holds the directory's inode at watch time. If .swarmforge/
// is ever removed and recreated (a target re-init) the original watcher is
// silently orphaned - watching a now-unlinked inode, delivering no further
// events for the new directory, with no error of its own. Node does surface
// this as the watcher's 'error' or 'close' event on SOME platforms/causes,
// so those are wired below - but deliberately closing a watcher ourselves
// (a target-path switch, extension deactivation, a bounce cycle replacing it
// with a fresh one) ALSO fires 'close', and must not be mistaken for a lost
// watcher and trigger a redundant re-establish. closeBounceWatcher marks a
// watcher as an intentional close before actually closing it so the 'close'
// handler below can tell the two apart.
const intentionallyClosingWatchers = new WeakSet<fs.FSWatcher>();

export function closeBounceWatcher(watcher: fs.FSWatcher | null | undefined): void {
  if (!watcher) {
    return;
  }
  intentionallyClosingWatchers.add(watcher);
  watcher.close();
}

export function startBounceWatcher(
  targetPath: string,
  onBounce: (bounceType: BounceType) => void,
  onError?: (error: string) => void,
  scheduleTick: ScheduleTick = defaultScheduleTick,
  onWatcherLost?: (reason: string) => void,
): fs.FSWatcher | null {
  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  const bounceFilePath = path.join(swarmforgeDir, 'bounce');

  // BL-204: .swarmforge is created by SwarmForge's own launcher - if it is
  // absent there is no swarm to bounce, so the watcher must not create it.
  // This is the single place that decides null vs. a real watcher; the
  // caller's own null-check is the only other branch point (extension.ts's
  // now-removed early existsSync guard duplicated this decision and made
  // that branch unreachable). Not a failure - never reported via
  // onWatcherLost - the "restart after every successful launch/bounce" hook
  // is what re-attempts this later, once the swarm actually exists.
  if (!fs.existsSync(swarmforgeDir)) {
    return null;
  }

  // fs.watch can throw SYNCHRONOUSLY (e.g. ENOSPC once the host's inotify
  // watch limit is exhausted) rather than failing later via an 'error'
  // event on an already-created watcher - both are real, unexpected
  // failures and must reach onWatcherLost through the same channel so a
  // caller has exactly one place to decide whether/how to retry.
  let watcher: fs.FSWatcher;
  try {
    // Watch the directory since watching a non-existent file may not work reliably
    watcher = fs.watch(swarmforgeDir, (eventType, filename) => {
      handleWatchEvent(filename, bounceFilePath, onBounce, onError, scheduleTick);
    });
  } catch (err) {
    if (onWatcherLost) {
      onWatcherLost(`Bounce watcher failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }

  watcher.on('error', (err) => {
    if (onWatcherLost) {
      onWatcherLost(`Bounce watcher error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  watcher.on('close', () => {
    if (!intentionallyClosingWatchers.has(watcher) && onWatcherLost) {
      onWatcherLost('Bounce watcher closed unexpectedly');
    }
    intentionallyClosingWatchers.delete(watcher);
  });

  return watcher;
}

// BL-115 bounce-watch-05 / engineering.prompt's retry-cap rule: a lost
// watcher must not re-establish immediately and unconditionally forever -
// e.g. a persistent ENOSPC would otherwise spin a tight infinite loop.
// Exponential backoff (attempt is 1-based: the Nth retry), capped at maxMs.
export const DEFAULT_MAX_REESTABLISH_ATTEMPTS = 5;
export const DEFAULT_REESTABLISH_BACKOFF_BASE_MS = 1000;
export const DEFAULT_REESTABLISH_BACKOFF_MAX_MS = 30000;

export function computeReestablishBackoffMs(
  attempt: number,
  baseMs: number = DEFAULT_REESTABLISH_BACKOFF_BASE_MS,
  maxMs: number = DEFAULT_REESTABLISH_BACKOFF_MAX_MS
): number {
  return Math.min(baseMs * Math.pow(2, Math.max(0, attempt - 1)), maxMs);
}

export interface ResilientWatcherHandle {
  close: () => void;
}

export interface ResilientWatcherOptions {
  scheduleTick?: ScheduleTick;
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  onLost?: (reason: string) => void;
  onExhausted?: (reason: string) => void;
}

/**
 * Bounded, backed-off re-establish loop around a single-attempt watcher
 * factory. attemptEstablish is given an onLost callback to invoke if/when
 * ITS watcher is later lost - it returns the watcher (or null for a
 * non-failure "nothing to watch yet", which is never retried here; the
 * caller's own periodic re-invocation, e.g. after every launch/bounce,
 * covers that case instead).
 *
 * A successful establish resets the attempt count, so a later, unrelated
 * failure gets its own full retry budget rather than inheriting an old
 * count. Exhausting maxAttempts calls onExhausted instead of retrying
 * forever (BL-115 bounce-watch-05). Kept generic (not bounce-specific) so
 * its retry/backoff/cap logic is unit-testable with a fully fake watcher
 * factory and a fake scheduleTick - no real fs.watch, no real timers.
 */
export function createResilientWatcherSupervisor(
  attemptEstablish: (onLost: (reason: string) => void) => fs.FSWatcher | null,
  options: ResilientWatcherOptions = {}
): ResilientWatcherHandle {
  const {
    scheduleTick = defaultScheduleTick,
    maxAttempts = DEFAULT_MAX_REESTABLISH_ATTEMPTS,
    backoffBaseMs = DEFAULT_REESTABLISH_BACKOFF_BASE_MS,
    backoffMaxMs = DEFAULT_REESTABLISH_BACKOFF_MAX_MS,
    onLost,
    onExhausted,
  } = options;

  let current: fs.FSWatcher | null = null;
  let attempt = 0;
  let disposed = false;

  function handleLost(reason: string): void {
    if (disposed) {
      return;
    }
    if (onLost) {
      onLost(reason);
    }
    attempt += 1;
    if (attempt >= maxAttempts) {
      if (onExhausted) {
        onExhausted(reason);
      }
      current = null;
      return;
    }
    scheduleTick(tryOnce, computeReestablishBackoffMs(attempt, backoffBaseMs, backoffMaxMs));
  }

  function tryOnce(): void {
    if (disposed) {
      return;
    }
    const watcher = attemptEstablish(handleLost);
    if (watcher) {
      attempt = 0;
    }
    current = watcher;
  }

  tryOnce();

  return {
    close: () => {
      disposed = true;
      closeBounceWatcher(current);
      current = null;
    },
  };
}

export interface StartResilientBounceWatcherOptions extends ResilientWatcherOptions {
  onError?: (error: string) => void;
}

/** Production wiring: createResilientWatcherSupervisor bound to the real startBounceWatcher. */
export function startResilientBounceWatcher(
  targetPath: string,
  onBounce: (bounceType: BounceType) => void,
  options: StartResilientBounceWatcherOptions = {}
): ResilientWatcherHandle {
  const { onError, ...supervisorOptions } = options;
  return createResilientWatcherSupervisor(
    (onLost) => startBounceWatcher(targetPath, onBounce, onError, undefined, onLost),
    supervisorOptions
  );
}
