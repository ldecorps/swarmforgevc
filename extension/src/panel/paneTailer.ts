import {
  capturePane,
  paneTarget,
  readSwarmRoles,
  readTmuxSocket,
  sendKeys,
  SwarmRole,
  getPaneBaseIndex,
} from '../swarm/tmuxClient';
import { stripAnsi } from './ansi';

const DEFAULT_POLL_INTERVAL_MS = 200;

export interface TileOutput {
  role: string;
  displayName: string;
  text: string;
  full: boolean;
}

export class PaneTailer {
  private interval: ReturnType<typeof setInterval> | undefined;
  private lastText = new Map<string, string>();
  private paneBaseIndex = 0;
  private roles: SwarmRole[] = [];
  private socketPath = '';

  constructor(
    private readonly targetPath: string,
    private readonly onOutput: (updates: TileOutput[]) => void
  ) {}

  start(pollMs = DEFAULT_POLL_INTERVAL_MS): void {
    this.stop();
    this.refreshState();

    this.interval = setInterval(() => {
      this.poll();
    }, pollMs);
    this.poll();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  refreshState(): void {
    this.socketPath = readTmuxSocket(this.targetPath) ?? '';
    this.roles = readSwarmRoles(this.targetPath);
    this.lastText.clear();
    if (this.socketPath) {
      this.paneBaseIndex = getPaneBaseIndex(this.socketPath);
    }
  }

  getRoles(): SwarmRole[] {
    return this.roles;
  }

  private poll(): void {
    if (!this.socketPath) {
      this.refreshState();
      if (!this.socketPath) {
        return;
      }
    }

    const updates: TileOutput[] = [];

    for (const role of this.roles) {
      const target = paneTarget(
        role.session,
        role.displayName,
        this.paneBaseIndex
      );
      const result = capturePane(this.socketPath, target);

      if (result.exitCode !== 0) {
        continue;
      }

      const text = stripAnsi(result.stdout);
      const previous = this.lastText.get(role.role);
      if (text === previous) {
        continue;
      }

      this.lastText.set(role.role, text);
      updates.push({
        role: role.role,
        displayName: role.displayName,
        text,
        full: true,
      });
    }

    if (updates.length > 0) {
      this.onOutput(updates);
    }
  }

  private resolveTarget(roleName: string): string | undefined {
    if (!this.socketPath) {
      return undefined;
    }
    const role = this.roles.find((r) => r.role === roleName);
    if (!role) {
      return undefined;
    }
    return paneTarget(role.session, role.displayName, this.paneBaseIndex);
  }

  forwardInput(roleName: string, data: string): void {
    const target = this.resolveTarget(roleName);
    if (!target) {
      return;
    }
    const mapped = mapInputToTmuxKey(data);
    sendKeys(this.socketPath, target, mapped.key, mapped.literal);
  }

  forwardSpecialKey(roleName: string, key: string): void {
    const target = this.resolveTarget(roleName);
    if (!target) {
      return;
    }
    const tmuxKey = mapSpecialKeyToTmux(key);
    if (tmuxKey) {
      sendKeys(this.socketPath, target, tmuxKey);
    }
  }
}

export function mapInputToTmuxKey(data: string): { key: string; literal: boolean } {
  if (data === '\r' || data === '\n') {
    return { key: 'Enter', literal: false };
  }
  if (data === '\x7f' || data === '\b') {
    return { key: 'BSpace', literal: false };
  }
  if (data === '\t') {
    return { key: 'Tab', literal: false };
  }
  if (data.length === 1 && data.charCodeAt(0) < 32) {
    const letter = String.fromCharCode(data.charCodeAt(0) + 64).toLowerCase();
    return { key: `C-${letter}`, literal: false };
  }
  return { key: data, literal: true };
}

const SPECIAL_KEY_MAP: Record<string, string> = {
  Enter: 'Enter',
  Backspace: 'BSpace',
  Tab: 'Tab',
  Escape: 'Escape',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PPage',
  PageDown: 'NPage',
  Delete: 'DC',
};

export function mapSpecialKeyToTmux(key: string): string | undefined {
  return SPECIAL_KEY_MAP[key];
}
