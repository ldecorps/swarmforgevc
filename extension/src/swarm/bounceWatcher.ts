import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

export type BounceType = 'swarm' | 'extension' | 'all';

export interface BounceWatcher extends fs.FSWatcher {
  dispose(): void;
}

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

class BounceFSWatcher extends EventEmitter {
  private currentWatcher: fs.FSWatcher | null = null;
  private permanentlyClosed = false;
  private restartScheduled = false;
  private suppressReconnect = false;
  private watcherGeneration = 0;

  constructor(
    private readonly targetPath: string,
    private readonly onBounce: (bounceType: BounceType) => void,
    private readonly onError?: (error: string) => void,
  ) {
    super();
    this.attachWatcher();
  }

  private attachWatcher(): void {
    if (this.permanentlyClosed || this.restartScheduled) {
      return;
    }

    const generation = ++this.watcherGeneration;
    const swarmforgeDir = path.join(this.targetPath, '.swarmforge');
    fs.mkdirSync(swarmforgeDir, { recursive: true });
    const bounceFilePath = path.join(swarmforgeDir, 'bounce');

    const watcher = fs.watch(swarmforgeDir, (_eventType, filename) => {
      if (filename !== 'bounce') {
        return;
      }

      setTimeout(() => {
        if (fs.existsSync(bounceFilePath)) {
          processBounceFile(bounceFilePath, this.onBounce, this.onError);
        }
      }, 50);
    });

    const handleError = (error: Error) => {
      if (this.watcherGeneration !== generation) {
        return;
      }
      if (this.onError) {
        this.onError(`Bounce watcher error: ${error.message}`);
      }
      this.reconnect();
    };

    const handleClose = () => {
      if (this.suppressReconnect || this.watcherGeneration !== generation) {
        return;
      }
      this.reconnect();
    };

    watcher.on('error', handleError);
    watcher.on('close', handleClose);
    this.currentWatcher = watcher;
  }

  private reconnect(): void {
    if (this.permanentlyClosed || this.suppressReconnect) {
      return;
    }

    if (this.currentWatcher) {
      this.currentWatcher.close();
      this.currentWatcher = null;
    }

    if (this.restartScheduled) {
      return;
    }

    this.restartScheduled = true;
    setTimeout(() => {
      this.restartScheduled = false;
      this.attachWatcher();
    }, 100);
  }

  close(): void {
    this.suppressReconnect = true;
    this.closeCurrentWatcher();
    this.suppressReconnect = false;
    if (!this.permanentlyClosed) {
      this.attachWatcher();
    }
  }

  dispose(): void {
    this.permanentlyClosed = true;
    this.suppressReconnect = true;
    this.closeCurrentWatcher();
    this.removeAllListeners();
  }

  private closeCurrentWatcher(): void {
    if (this.currentWatcher) {
      this.currentWatcher.close();
      this.currentWatcher = null;
    }
  }
}

export function startBounceWatcher(
  targetPath: string,
  onBounce: (bounceType: BounceType) => void,
  onError?: (error: string) => void,
): BounceWatcher | null {
  return new BounceFSWatcher(targetPath, onBounce, onError) as unknown as BounceWatcher;
}
