import {
  capturePane,
  getPaneCommand,
  readSwarmRoles,
  readTmuxSocket,
  resolveAgentPaneTarget,
  sendKeys,
  sessionExists,
  SwarmRole,
  getPaneBaseIndex,
} from '../swarm/tmuxClient';
import { agentPaneStatusMessage } from './agentPaneState';
import { stripAnsi } from './ansi';

const DEFAULT_POLL_INTERVAL_MS = 200;
export const STALL_THRESHOLD_MS = 120_000;

export function isStalled(lastChangedAt: number, now: number): boolean {
  return now - lastChangedAt >= STALL_THRESHOLD_MS;
}

export interface TileOutput {
  role: string;
  displayName: string;
  text: string;
  full: boolean;
}

export interface StallEvent {
  role: string;
  stalled: boolean;
}

export class PaneTailer {
  private interval: ReturnType<typeof setInterval> | undefined;
  private lastText = new Map<string, string>();
  private lastChangedAt = new Map<string, number>();
  private stalledRoles = new Set<string>();
  private paneBaseIndex = 0;
  private roles: SwarmRole[] = [];
  private socketPath = '';

  constructor(
    private readonly targetPath: string,
    private readonly onOutput: (updates: TileOutput[]) => void,
    private readonly onStall?: (events: StallEvent[]) => void
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
    this.lastChangedAt.clear();
    this.stalledRoles.clear();
    if (this.socketPath) {
      this.paneBaseIndex = getPaneBaseIndex(this.socketPath);
    }
  }

  getRoles(): SwarmRole[] {
    return this.roles;
  }

  private poll(): void {
    const latestSocket = readTmuxSocket(this.targetPath) ?? '';
    if (latestSocket !== this.socketPath) {
      this.socketPath = latestSocket;
      this.roles = readSwarmRoles(this.targetPath);
      this.lastText.clear();
      if (this.socketPath) {
        this.paneBaseIndex = getPaneBaseIndex(this.socketPath);
      }
    }

    if (!this.socketPath) {
      return;
    }

    const updates: TileOutput[] = [];

    for (const role of this.roles) {
      if (!sessionExists(this.socketPath, role.session)) {
        const text = `Session "${role.session}" is not running.\n\nUse SwarmForge: Stop Swarm, then Launch Swarm.`;
        if (this.lastText.get(role.role) !== text) {
          this.lastText.set(role.role, text);
          updates.push({
            role: role.role,
            displayName: role.displayName,
            text,
            full: true,
          });
        }
        continue;
      }

      const target = resolveAgentPaneTarget(
        this.socketPath,
        role.session,
        this.paneBaseIndex
      );
      const result = capturePane(this.socketPath, target);

      if (result.exitCode !== 0) {
        const text = `Could not read tmux pane for ${role.displayName}.\n\nTry SwarmForge: Stop Swarm, then Launch Swarm.`;
        if (this.lastText.get(role.role) !== text) {
          this.lastText.set(role.role, text);
          updates.push({
            role: role.role,
            displayName: role.displayName,
            text,
            full: true,
          });
        }
        continue;
      }

      const rawText = stripAnsi(result.stdout);
      const paneCommand = getPaneCommand(this.socketPath, target);
      const statusOverlay = agentPaneStatusMessage(paneCommand, rawText);
      const text = statusOverlay ?? rawText;

      const previous = this.lastText.get(role.role);
      if (text === previous) {
        continue;
      }

      this.lastText.set(role.role, text);
      this.lastChangedAt.set(role.role, Date.now());
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

    if (this.onStall) {
      const stallEvents: StallEvent[] = [];
      const now = Date.now();
      for (const role of this.roles) {
        const lastChanged = this.lastChangedAt.get(role.role);
        if (lastChanged === undefined) {
          continue;
        }
        const stalled = isStalled(lastChanged, now);
        const wasStalled = this.stalledRoles.has(role.role);
        if (stalled !== wasStalled) {
          if (stalled) {
            this.stalledRoles.add(role.role);
          } else {
            this.stalledRoles.delete(role.role);
          }
          stallEvents.push({ role: role.role, stalled });
        }
      }
      if (stallEvents.length > 0) {
        this.onStall(stallEvents);
      }
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
    return resolveAgentPaneTarget(
      this.socketPath,
      role.session,
      this.paneBaseIndex
    );
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
