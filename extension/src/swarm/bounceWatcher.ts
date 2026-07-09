import * as fs from 'fs';
import * as path from 'path';

export type BounceType = 'swarm' | 'extension' | 'all';

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
// instead of writing real files and waiting on real fs.watch timing.
export function handleWatchEvent(
  filename: string | null,
  bounceFilePath: string,
  onBounce: (bounceType: BounceType) => void,
  onError: ((error: string) => void) | undefined,
  scheduleTick: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
): void {
  if (filename !== 'bounce') {
    return;
  }

  // Small delay to ensure file is fully written
  scheduleTick(() => {
    if (fs.existsSync(bounceFilePath)) {
      processBounceFile(bounceFilePath, onBounce, onError);
    }
  }, 50);
}

export function startBounceWatcher(
  targetPath: string,
  onBounce: (bounceType: BounceType) => void,
  onError?: (error: string) => void,
  scheduleTick: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
): fs.FSWatcher | null {
  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  const bounceFilePath = path.join(swarmforgeDir, 'bounce');

  // BL-204: .swarmforge is created by SwarmForge's own launcher - if it is
  // absent there is no swarm to bounce, so the watcher must not create it.
  // This is the single place that decides null vs. a real watcher; the
  // caller's own null-check is the only other branch point (extension.ts's
  // now-removed early existsSync guard duplicated this decision and made
  // that branch unreachable).
  if (!fs.existsSync(swarmforgeDir)) {
    return null;
  }

  // Watch the directory since watching a non-existent file may not work reliably
  const watcher = fs.watch(swarmforgeDir, (eventType, filename) => {
    handleWatchEvent(filename, bounceFilePath, onBounce, onError, scheduleTick);
  });

  return watcher;
}
