// Host-side pane history for the Resident Spy / Mini App / Telegram live
// screen. Same problem BL-070 solved for VS Code tiles: local-model (qwen)
// and Claude TUIs run in tmux's alternate screen, so tmux history_size stays
// 0 and capture-pane can only ever return the painted frame (~24 rows).
// Humans can still scroll inside the agent UI; our capture path cannot see
// that buffer. Reconstruct the transcript by diffing successive captures
// (accumulatePaneHistory) and serve the accumulated text as paneText.

import {
  readTmuxSocket,
  readLiveRosterSwarmRoles,
  getPaneBaseIndex,
  resolveAgentPaneTarget,
  capturePane,
} from '../swarm/tmuxClient';
import { stripAnsi } from '../panel/ansi';
import { accumulatePaneHistory } from '../panel/paneHistory';
import { RESIDENT_PANE_SPY_DEFAULT_LINES } from '../concierge/residentPaneSpy';

/** Match paneTailer's default — enough to scroll back to the welcome screen. */
export const RESIDENT_PANE_HISTORY_LINES = 5000;

/** Poll while the spy feed is in use so fast-scrolling frames are not missed. */
export const RESIDENT_PANE_HISTORY_POLL_MS = 500;

interface RoleHistoryState {
  history: string[];
  contentLines: string[] | null;
  displayText: string;
}

const historyByTarget = new Map<string, Map<string, RoleHistoryState>>();
const pollersByTarget = new Map<string, ReturnType<typeof setInterval>>();
const tickInFlight = new Set<string>();

function roleMapFor(targetPath: string): Map<string, RoleHistoryState> {
  let map = historyByTarget.get(targetPath);
  if (!map) {
    map = new Map();
    historyByTarget.set(targetPath, map);
  }
  return map;
}

export function ingestResidentPaneCapture(
  targetPath: string,
  role: string,
  rawCaptureText: string,
  maxHistoryLines: number = RESIDENT_PANE_HISTORY_LINES
): string {
  const map = roleMapFor(targetPath);
  const prev = map.get(role);
  const result = accumulatePaneHistory(
    prev?.contentLines ?? null,
    prev?.history ?? [],
    rawCaptureText,
    maxHistoryLines
  );
  const state: RoleHistoryState = {
    history: result.history,
    contentLines: result.contentLines,
    displayText: result.displayText,
  };
  map.set(role, state);
  return state.displayText;
}

export function getResidentPaneHistoryText(targetPath: string, role: string): string | undefined {
  return historyByTarget.get(targetPath)?.get(role)?.displayText;
}

export function tickResidentPaneHistories(targetPath: string): void {
  if (tickInFlight.has(targetPath)) {
    return;
  }
  tickInFlight.add(targetPath);
  try {
    const socketPath = readTmuxSocket(targetPath);
    if (!socketPath) {
      return;
    }
    const liveRoles = readLiveRosterSwarmRoles(targetPath);
    const paneBaseIndex = getPaneBaseIndex(socketPath);
    for (const roleEntry of liveRoles) {
      const target = resolveAgentPaneTarget(socketPath, roleEntry.session, paneBaseIndex);
      const captured = capturePane(socketPath, target, -RESIDENT_PANE_SPY_DEFAULT_LINES);
      if (captured.exitCode !== 0) {
        continue;
      }
      const paneText = stripAnsi(captured.stdout ?? '');
      if (!paneText.trim()) {
        continue;
      }
      ingestResidentPaneCapture(targetPath, roleEntry.role, paneText);
    }
  } finally {
    tickInFlight.delete(targetPath);
  }
}

export function ensureResidentPaneHistoryPoller(
  targetPath: string,
  intervalMs: number = RESIDENT_PANE_HISTORY_POLL_MS
): void {
  if (pollersByTarget.has(targetPath)) {
    return;
  }
  tickResidentPaneHistories(targetPath);
  const handle = setInterval(() => {
    tickResidentPaneHistories(targetPath);
  }, intervalMs);
  if (typeof handle.unref === 'function') {
    handle.unref();
  }
  pollersByTarget.set(targetPath, handle);
}

export function clearResidentPaneHistory(targetPath?: string): void {
  if (targetPath === undefined) {
    for (const handle of pollersByTarget.values()) {
      clearInterval(handle);
    }
    pollersByTarget.clear();
    historyByTarget.clear();
    tickInFlight.clear();
    return;
  }
  const handle = pollersByTarget.get(targetPath);
  if (handle) {
    clearInterval(handle);
    pollersByTarget.delete(targetPath);
  }
  historyByTarget.delete(targetPath);
  tickInFlight.delete(targetPath);
}
