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

export function processBounceFile(
  filePath: string,
  onBounce: (bounceType: BounceType) => void,
  onError?: (error: string) => void,
): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseBounceFile(content);

    if (!parsed.valid) {
      if (onError) {
        onError(parsed.error || 'Unknown error');
      }
    } else if (parsed.bounceType) {
      onBounce(parsed.bounceType);
    }

    // Delete the file after processing (whether valid or invalid)
    fs.unlinkSync(filePath);
  } catch (error) {
    if (onError) {
      const message = error instanceof Error ? error.message : String(error);
      onError(`Failed to process bounce file: ${message}`);
    }
  }
}

export function startBounceWatcher(
  targetPath: string,
  onBounce: (bounceType: BounceType) => void,
  onError?: (error: string) => void,
): fs.FSWatcher | null {
  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  const bounceFilePath = path.join(swarmforgeDir, 'bounce');

  fs.mkdirSync(swarmforgeDir, { recursive: true });

  // Watch the directory since watching a non-existent file may not work reliably
  const watcher = fs.watch(swarmforgeDir, (eventType, filename) => {
    if (filename !== 'bounce') {
      return;
    }

    // Small delay to ensure file is fully written
    setTimeout(() => {
      if (fs.existsSync(bounceFilePath)) {
        processBounceFile(bounceFilePath, onBounce, onError);
      }
    }, 50);
  });

  return watcher;
}
