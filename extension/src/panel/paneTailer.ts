import {
  capturePane,
  getPaneCommand,
  getPanePid,
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
import { recordHumanInput } from '../swarm/humanInputTracker';
import { agentPaneStatusMessage, isAgentActivelyWorking } from './agentPaneState';
import { stripAnsi } from './ansi';
import { detectNeedsHuman } from './needsHumanDetection';
import { accumulatePaneHistory } from './paneHistory';

const DEFAULT_POLL_INTERVAL_MS = 200;
export const STALL_THRESHOLD_MS = 120_000;
// Recent pane/output motion keeps the tile border in a soft "working" pulse.
export const WORKING_INDICATOR_MS = 30_000;
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

/**
 * BL-120: `tmux respawn-pane` (e.g. a relaunch that reuses the existing
 * session rather than killing it) swaps the process running in a pane
 * without changing the session name or the socket path - the two signals
 * the tailer otherwise uses to decide "something changed, reset retained
 * state". A changed pane pid is the respawn signal that survives that:
 * true only when a PREVIOUS pid was already known (so first-ever capture
 * of a role is not misread as a respawn) and it differs from a genuinely
 * resolved current pid (an empty string means the capture itself failed,
 * not a respawn).
 */
export function didPaneRespawn(previousPid: string | undefined, currentPid: string): boolean {
  return previousPid !== undefined && currentPid !== '' && currentPid !== previousPid;
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

export interface ActivityEvent {
  role: string;
  working: boolean;
}

export class PaneTailer {
  private interval: ReturnType<typeof setInterval> | undefined;
  private lastText = new Map<string, string>();
  // The current capture's own text (or status overlay), distinct from
  // lastText once lastText starts holding the BL-070 accumulated transcript
  // — detectors that reason about "what's on screen right now" must read
  // this, not the growing history.
  private lastRawText = new Map<string, string>();
  private lastChangedAt = new Map<string, number>();
  private lastPaneCommand = new Map<string, string>();
  private stalledRoles = new Set<string>();
  private workingRoles = new Set<string>();
  private deadRoles = new Set<string>();
  private needsHumanRoles = new Set<string>();
  private liveRoles = new Set<string>();
  private paneBaseIndex = 0;
  private roles: SwarmRole[] = [];
  private socketPath = '';
  private historyLines: number;
  private paneRows: number;
  private rolePaneRows = new Map<string, number>();
  // BL-070: retained transcript per role, reconstructed on the host since
  // tmux keeps no scrollback for the Claude CLI's alternate-screen TUI.
  private paneHistory = new Map<string, string[]>();
  private paneHistoryContentLines = new Map<string, string[] | null>();
  // BL-120: last-seen pane pid per role, to detect a respawn that reuses
  // the same session/socket (see didPaneRespawn).
  private panePids = new Map<string, string>();

  constructor(
    private readonly targetPath: string,
    private readonly onOutput: (updates: TileOutput[]) => void,
    private readonly onStall?: (events: StallEvent[]) => void,
    private readonly onDead?: (events: DeadEvent[]) => void,
    private readonly onInputLogError?: (message: string) => void,
    historyLines?: number,
    private readonly onRoles?: (roles: SwarmRole[]) => void,
    paneRows?: number,
    private readonly onNeedsHuman?: (events: NeedsHumanEvent[]) => void,
    private readonly onPollError?: (message: string) => void,
    private readonly onActivity?: (events: ActivityEvent[]) => void
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
    this.lastRawText.clear();
    this.lastChangedAt.clear();
    this.lastPaneCommand.clear();
    this.stalledRoles.clear();
    this.workingRoles.clear();
    this.deadRoles.clear();
    this.liveRoles.clear();
    this.paneHistory.clear();
    this.paneHistoryContentLines.clear();
    this.panePids.clear();
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
    try {
      this.refreshRolesForTick();
    } catch (err) {
      // A transient failure here (e.g. a state-file race) must not abort the
      // whole tick — keep polling with whatever roles/socket we already had,
      // so a later successful refresh resumes updates on its own. See
      // BL-088: a per-tick exception thrown before onOutput silently froze
      // every tile even while the rest of the extension host stayed alive.
      this.reportPollError(err);
    }

    if (!this.socketPath) {
      return;
    }

    const { updates, deadEvents } = this.pollAllRoles();

    if (updates.length > 0) {
      this.onOutput(updates);
    }
    if (this.onDead && deadEvents.length > 0) {
      this.onDead(deadEvents);
    }

    this.emitStallEvents();
    this.emitActivityEvents();
    this.emitNeedsHumanEvents();
  }

  // Captures every role's pane for this tick, isolating one role's thrown
  // error from the rest (see BL-088's poll() comment above) so the loop
  // itself stays out of poll()'s own CRAP/complexity.
  private pollAllRoles(): { updates: TileOutput[]; deadEvents: DeadEvent[] } {
    const updates: TileOutput[] = [];
    const deadEvents: DeadEvent[] = [];
    for (const role of this.roles) {
      try {
        this.pollRole(role, updates, deadEvents);
      } catch (err) {
        this.reportPollError(err, role.role);
      }
    }
    return { updates, deadEvents };
  }

  private emitStallEvents(): void {
    if (!this.onStall) {
      return;
    }
    const now = Date.now();
    const stallEvents: StallEvent[] = [];
    for (const role of this.roles) {
      const event = this.checkRoleStall(role, now);
      if (event) {
        stallEvents.push(event);
      }
    }
    if (stallEvents.length > 0) {
      this.onStall(stallEvents);
    }
  }

  private checkRoleStall(role: SwarmRole, now: number): StallEvent | null {
    const lastChanged = this.lastChangedAt.get(role.role);
    if (lastChanged === undefined) {
      return null;
    }
    const stalled = isStalled(lastChanged, now);
    const wasStalled = this.stalledRoles.has(role.role);
    if (stalled === wasStalled) {
      return null;
    }
    if (stalled) {
      this.stalledRoles.add(role.role);
    } else {
      this.stalledRoles.delete(role.role);
    }
    return { role: role.role, stalled };
  }

  private emitActivityEvents(): void {
    if (!this.onActivity) {
      return;
    }
    const now = Date.now();
    const events: ActivityEvent[] = [];
    for (const role of this.roles) {
      if (this.deadRoles.has(role.role)) {
        if (this.workingRoles.has(role.role)) {
          this.workingRoles.delete(role.role);
          events.push({ role: role.role, working: false });
        }
        continue;
      }
      const lastChanged = this.lastChangedAt.get(role.role);
      const raw = this.lastRawText.get(role.role) ?? '';
      const cmd = this.lastPaneCommand.get(role.role) ?? '';
      const working =
        isAgentActivelyWorking(cmd, raw) ||
        (lastChanged !== undefined && now - lastChanged < WORKING_INDICATOR_MS);
      const wasWorking = this.workingRoles.has(role.role);
      if (working === wasWorking) {
        continue;
      }
      if (working) {
        this.workingRoles.add(role.role);
      } else {
        this.workingRoles.delete(role.role);
      }
      events.push({ role: role.role, working });
    }
    if (events.length > 0) {
      this.onActivity(events);
    }
  }

  private emitNeedsHumanEvents(): void {
    if (!this.onNeedsHuman) {
      return;
    }
    const needsHumanEvents: NeedsHumanEvent[] = [];
    for (const role of this.roles) {
      // BL-070: detect against the CURRENT capture, not the accumulated
      // retained transcript in lastText — a resolved question from
      // earlier in the (now much longer) history must not keep matching
      // just because it hasn't scrolled out of an arbitrary line window.
      const text = this.lastRawText.get(role.role);
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

  // Re-reads the socket path and role list for this tick, resetting retained
  // state when either changes. Split out from poll() so a thrown error here
  // (e.g. a state-file race) can be caught without also swallowing the
  // per-role capture loop below.
  private refreshRolesForTick(): void {
    const latestSocket = readTmuxSocket(this.targetPath) ?? '';
    if (latestSocket !== this.socketPath) {
      this.applySocketChange(latestSocket);
      return;
    }
    this.refreshRolesOnUnchangedSocket();
  }

  private applySocketChange(latestSocket: string): void {
    this.socketPath = latestSocket;
    this.roles = readSwarmRoles(this.targetPath);
    this.lastText.clear();
    this.lastRawText.clear();
    this.paneHistory.clear();
    this.paneHistoryContentLines.clear();
    if (this.socketPath) {
      this.paneBaseIndex = getPaneBaseIndex(this.socketPath);
      this.applyPaneSettings();
    }
    this.onRoles?.(this.roles);
  }

  // The socket file is reused across respawns, so a socket-path change is
  // not enough to notice a role being added/removed (e.g. QA appended after
  // the cleaner). Re-read roles.tsv each poll and refresh the panel when the
  // role set changes, so the new tile appears without a full relaunch.
  private refreshRolesOnUnchangedSocket(): void {
    const latestRoles = readSwarmRoles(this.targetPath);
    if (!rolesChanged(this.roles, latestRoles)) {
      return;
    }
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

  // Captures and processes a single role's pane for this tick. Thrown errors
  // propagate to the caller, which isolates them per role (see poll()).
  private pollRole(role: SwarmRole, updates: TileOutput[], deadEvents: DeadEvent[]): void {
    if (this.handleDeadSession(role, updates, deadEvents)) {
      return;
    }

    this.markRoleLive(role, deadEvents);

    const text = this.captureRoleOutput(role, updates);
    if (text === null) {
      return;
    }

    this.pushIfTextChanged(role, updates, text);
  }

  // Returns true when the session is dead and the caller should stop -
  // updates/deadEvents are already populated for that case.
  private handleDeadSession(role: SwarmRole, updates: TileOutput[], deadEvents: DeadEvent[]): boolean {
    if (sessionExists(this.socketPath, role.session)) {
      return false;
    }
    const text = `Session "${role.session}" is not running.\n\nUse SwarmForge: Stop Swarm, then Launch Swarm.`;
    this.pushFullTextIfChanged(role, updates, text);
    if (this.liveRoles.has(role.role) && !this.deadRoles.has(role.role)) {
      this.deadRoles.add(role.role);
      deadEvents.push({ role: role.role, dead: true });
      // A dead session's retained transcript is now stale; a respawn
      // reseeds fresh rather than diffing against unrelated content.
      this.paneHistory.delete(role.role);
      this.paneHistoryContentLines.delete(role.role);
    }
    return true;
  }

  private markRoleLive(role: SwarmRole, deadEvents: DeadEvent[]): void {
    if (this.deadRoles.has(role.role)) {
      this.deadRoles.delete(role.role);
      deadEvents.push({ role: role.role, dead: false });
    }
    this.liveRoles.add(role.role);
  }

  // BL-120: a respawned pane (same session/socket, new process) must not
  // keep diffing/merging fresh content against retained state built from
  // the process that used to be there - reset this role's history so the
  // next capture is treated as a clean first read.
  private resetRoleRetainedState(role: string): void {
    this.lastText.delete(role);
    this.lastRawText.delete(role);
    this.lastChangedAt.delete(role);
    this.lastPaneCommand.delete(role);
    this.paneHistory.delete(role);
    this.paneHistoryContentLines.delete(role);
  }

  // Captures this role's pane and returns the text to diff, or null when the
  // capture itself failed (a message was already pushed for that case).
  private captureRoleOutput(role: SwarmRole, updates: TileOutput[]): string | null {
    const target = resolveAgentPaneTarget(this.socketPath, role.session, this.paneBaseIndex);

    const currentPid = getPanePid(this.socketPath, target);
    if (didPaneRespawn(this.panePids.get(role.role), currentPid)) {
      this.resetRoleRetainedState(role.role);
    }
    if (currentPid !== '') {
      this.panePids.set(role.role, currentPid);
    }

    const result = capturePane(this.socketPath, target, -this.historyLines);

    if (result.exitCode !== 0) {
      const text = `Could not read tmux pane for ${role.displayName}.\n\nTry SwarmForge: Stop Swarm, then Launch Swarm.`;
      this.pushFullTextIfChanged(role, updates, text);
      return null;
    }

    const rawText = stripAnsi(result.stdout);
    const paneCommand = getPaneCommand(this.socketPath, target);
    this.lastPaneCommand.set(role.role, paneCommand);
    const statusOverlay = agentPaneStatusMessage(paneCommand, rawText, role.agent);
    const effectiveRaw = statusOverlay ?? rawText;
    const previousRaw = this.lastRawText.get(role.role);
    this.lastRawText.set(role.role, effectiveRaw);
    if (previousRaw === undefined || previousRaw !== effectiveRaw) {
      this.lastChangedAt.set(role.role, Date.now());
    }
    return statusOverlay ?? this.accumulateHistory(role.role, rawText);
  }

  private pushIfTextChanged(role: SwarmRole, updates: TileOutput[], text: string): void {
    const previous = this.lastText.get(role.role);
    if (text === previous) {
      return;
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

  private reportPollError(err: unknown, role?: string): void {
    const message = err instanceof Error ? err.message : String(err);
    const prefix = role ? `Poll failed for ${role}` : 'Poll failed';
    this.onPollError?.(`${prefix}: ${message}`);
  }

  // BL-070: diffs this capture against the role's previous one and merges
  // any genuinely new content lines into its bounded retained transcript —
  // see paneHistory.ts for the full root-cause writeup and algorithm.
  private accumulateHistory(role: string, rawText: string): string {
    const previousContentLines = this.paneHistoryContentLines.get(role) ?? null;
    const history = this.paneHistory.get(role) ?? [];
    const result = accumulatePaneHistory(previousContentLines, history, rawText, this.historyLines);
    this.paneHistory.set(role, result.history);
    this.paneHistoryContentLines.set(role, result.contentLines);
    return result.displayText;
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
    recordHumanInput(roleName);
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
      recordHumanInput(roleName);
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
