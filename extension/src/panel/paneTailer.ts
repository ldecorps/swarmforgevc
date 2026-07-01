import {
  capturePane,
  getPaneCommand,
  readSwarmRoles,
  readTmuxSocket,
  resizeWindow,
  resolveAgentPaneTarget,
  sendKeys,
  sessionExists,
  setHistoryLimit,
  setWindowSizeManual,
  SwarmRole,
  getPaneBaseIndex,
} from '../swarm/tmuxClient';
import { appendInputEntry } from '../swarm/inputLog';
import { agentPaneStatusMessage } from './agentPaneState';
import { stripAnsi } from './ansi';
import { detectNeedsHuman } from './needsHumanDetection';

const DEFAULT_POLL_INTERVAL_MS = 200;
export const STALL_THRESHOLD_MS = 120_000;
const DEFAULT_HISTORY_LINES = 5000;
const MAX_HISTORY_LINES = 50000;

// Headless tmux panes default to 80x24, capping each tile at 24 lines. Resize
// windows taller so the agent TUI re-renders into more rows.
const TILE_PANE_COLS = 120;
const DEFAULT_TILE_PANE_ROWS = 200;
const MIN_TILE_PANE_ROWS = 6;
const MAX_TILE_PANE_ROWS = 1000;

export function normalizeHistoryLines(value: number | undefined | null): number {
  if (value === undefined || value === null || value <= 0) {
    return DEFAULT_HISTORY_LINES;
  }
  return Math.min(value, MAX_HISTORY_LINES);
}

export function normalizePaneRows(value: number | undefined | null): number {
  if (value === undefined || value === null || value <= 0) {
    return DEFAULT_TILE_PANE_ROWS;
  }
  return Math.max(MIN_TILE_PANE_ROWS, Math.min(value, MAX_TILE_PANE_ROWS));
}

/**
 * True when the set of role names differs between two role lists (a role was
 * added or removed). Order-insensitive. Used to detect when a respawn adds a
 * role — e.g. QA — while reusing the same tmux socket, so the panel can create
 * the new tile instead of showing stale roles.
 */
export function rolesChanged(prev: SwarmRole[], next: SwarmRole[]): boolean {
  if (prev.length !== next.length) {
    return true;
  }
  const prevNames = new Set(prev.map((r) => r.role));
  return next.some((r) => !prevNames.has(r.role));
}

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

export interface DeadEvent {
  role: string;
  dead: boolean;
}

export interface NeedsHumanEvent {
  role: string;
  needsHuman: boolean;
}

export class PaneTailer {
  private interval: ReturnType<typeof setInterval> | undefined;
  private lastText = new Map<string, string>();
  private lastChangedAt = new Map<string, number>();
  private stalledRoles = new Set<string>();
  private deadRoles = new Set<string>();
  private needsHumanRoles = new Set<string>();
  private liveRoles = new Set<string>();
  private paneBaseIndex = 0;
  private roles: SwarmRole[] = [];
  private socketPath = '';
  private historyLines: number;
  private paneRows: number;
  private rolePaneRows = new Map<string, number>();

  constructor(
    private readonly targetPath: string,
    private readonly onOutput: (updates: TileOutput[]) => void,
    private readonly onStall?: (events: StallEvent[]) => void,
    private readonly onDead?: (events: DeadEvent[]) => void,
    private readonly onInputLogError?: (message: string) => void,
    historyLines?: number,
    private readonly onRoles?: (roles: SwarmRole[]) => void,
    paneRows?: number,
    private readonly onNeedsHuman?: (events: NeedsHumanEvent[]) => void
  ) {
    this.historyLines = normalizeHistoryLines(historyLines);
    this.paneRows = normalizePaneRows(paneRows);
  }

  // Grow the scrollback buffer and make each agent window taller so tiles show
  // far more than the default 24 lines. Re-applied whenever the role set changes
  // so a newly added window (e.g. QA on respawn) is sized too.
  private applyPaneSettings(): void {
    if (!this.socketPath) {
      return;
    }
    setHistoryLimit(this.socketPath, this.historyLines);
    setWindowSizeManual(this.socketPath);
    for (const role of this.roles) {
      const rows = this.rolePaneRows.get(role.role) ?? this.paneRows;
      resizeWindow(this.socketPath, role.session, TILE_PANE_COLS, rows);
    }
  }

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
    this.deadRoles.clear();
    this.liveRoles.clear();
    if (this.socketPath) {
      this.paneBaseIndex = getPaneBaseIndex(this.socketPath);
      this.applyPaneSettings();
    }
  }

  getRoles(): SwarmRole[] {
    return this.roles;
  }

  // Each tile measures and reports its OWN visible height (a selected tile is
  // taller than the rest, per BL-040/043/051), so the fit must be per-role:
  // resize only the pane that changed rather than re-applying one shared row
  // count to every role's pane.
  updatePaneRows(role: string, newPaneRows: number): void {
    const normalized = normalizePaneRows(newPaneRows);
    if (this.rolePaneRows.get(role) === normalized) {
      return;
    }
    this.rolePaneRows.set(role, normalized);
    if (!this.socketPath) {
      return;
    }
    const target = this.roles.find((r) => r.role === role);
    if (!target) {
      return;
    }
    resizeWindow(this.socketPath, target.session, TILE_PANE_COLS, normalized);
  }

  private poll(): void {
    const latestSocket = readTmuxSocket(this.targetPath) ?? '';
    if (latestSocket !== this.socketPath) {
      this.socketPath = latestSocket;
      this.roles = readSwarmRoles(this.targetPath);
      this.lastText.clear();
      if (this.socketPath) {
        this.paneBaseIndex = getPaneBaseIndex(this.socketPath);
        this.applyPaneSettings();
      }
      this.onRoles?.(this.roles);
    } else {
      // The socket file is reused across respawns, so a socket-path change is
      // not enough to notice a role being added/removed (e.g. QA appended after
      // the cleaner). Re-read roles.tsv each poll and refresh the panel when the
      // role set changes, so the new tile appears without a full relaunch.
      const latestRoles = readSwarmRoles(this.targetPath);
      if (rolesChanged(this.roles, latestRoles)) {
        const liveNames = new Set(latestRoles.map((r) => r.role));
        for (const name of [...this.lastText.keys()]) {
          if (!liveNames.has(name)) {
            this.lastText.delete(name);
          }
        }
        this.roles = latestRoles;
        this.applyPaneSettings();
        this.onRoles?.(this.roles);
      }
    }

    if (!this.socketPath) {
      return;
    }

    const updates: TileOutput[] = [];
    const deadEvents: DeadEvent[] = [];

    for (const role of this.roles) {
      if (!sessionExists(this.socketPath, role.session)) {
        const text = `Session "${role.session}" is not running.\n\nUse SwarmForge: Stop Swarm, then Launch Swarm.`;
        this.pushFullTextIfChanged(role, updates, text);
        if (this.liveRoles.has(role.role) && !this.deadRoles.has(role.role)) {
          this.deadRoles.add(role.role);
          deadEvents.push({ role: role.role, dead: true });
        }
        continue;
      }

      if (this.deadRoles.has(role.role)) {
        this.deadRoles.delete(role.role);
        deadEvents.push({ role: role.role, dead: false });
      }
      this.liveRoles.add(role.role);

      const target = resolveAgentPaneTarget(
        this.socketPath,
        role.session,
        this.paneBaseIndex
      );
      const result = capturePane(this.socketPath, target, -this.historyLines);

      if (result.exitCode !== 0) {
        const text = `Could not read tmux pane for ${role.displayName}.\n\nTry SwarmForge: Stop Swarm, then Launch Swarm.`;
        this.pushFullTextIfChanged(role, updates, text);
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

    if (this.onDead && deadEvents.length > 0) {
      this.onDead(deadEvents);
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

    if (this.onNeedsHuman) {
      const needsHumanEvents: NeedsHumanEvent[] = [];
      for (const role of this.roles) {
        const text = this.lastText.get(role.role);
        const needsHuman = detectNeedsHuman(text);
        const wasNeedsHuman = this.needsHumanRoles.has(role.role);
        if (needsHuman !== wasNeedsHuman) {
          if (needsHuman) {
            this.needsHumanRoles.add(role.role);
          } else {
            this.needsHumanRoles.delete(role.role);
          }
          needsHumanEvents.push({ role: role.role, needsHuman });
        }
      }
      if (needsHumanEvents.length > 0) {
        this.onNeedsHuman(needsHumanEvents);
      }
    }
  }

  private pushFullTextIfChanged(role: SwarmRole, updates: TileOutput[], text: string): void {
    if (this.lastText.get(role.role) !== text) {
      this.lastText.set(role.role, text);
      updates.push({
        role: role.role,
        displayName: role.displayName,
        text,
        full: true,
      });
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
    this.logInput(roleName, data);
  }

  forwardSpecialKey(roleName: string, key: string): void {
    const target = this.resolveTarget(roleName);
    if (!target) {
      return;
    }
    const tmuxKey = mapSpecialKeyToTmux(key);
    if (tmuxKey) {
      sendKeys(this.socketPath, target, tmuxKey);
      this.logInput(roleName, key);
    }
  }

  private logInput(role: string, data: string): void {
    try {
      appendInputEntry(this.targetPath, role, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onInputLogError?.(`Input log write failed: ${message}`);
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
