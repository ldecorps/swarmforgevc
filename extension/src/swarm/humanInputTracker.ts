// BL-076: tracks when a human last typed into a role's pane, independent of
// whether the pane's rendered output has visibly changed yet (a live
// conversation in progress must never be cleared out from under the human,
// even before the agent has responded). Module-level singleton, mirroring
// watchdog/paneActivity.ts's pattern.
const lastInputByRole = new Map<string, number>();

export function recordHumanInput(role: string, nowMs: number = Date.now()): void {
  lastInputByRole.set(role, nowMs);
}

export function lastHumanInputMs(role: string): number | null {
  return lastInputByRole.get(role) ?? null;
}

export function resetHumanInputTracker(): void {
  lastInputByRole.clear();
}
