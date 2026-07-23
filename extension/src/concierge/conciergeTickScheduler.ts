// Debounced, single-flight concierge tick scheduling — lets the Telegram
// poll loop (and bridge write paths) refresh the pipeline board / Approvals
// roster immediately after a human decision without racing the periodic tick.

export type ConciergeTickRunner = () => Promise<void>;

export const DEFAULT_CONCIERGE_TICK_DEBOUNCE_MS = 250;

export class ConciergeTickScheduler {
  private inFlight?: Promise<void>;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly runTick: ConciergeTickRunner) {}

  scheduleDebounced(delayMs: number = DEFAULT_CONCIERGE_TICK_DEBOUNCE_MS): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.runNow();
    }, delayMs);
  }

  async runNow(): Promise<void> {
    if (this.inFlight !== undefined) {
      return this.inFlight;
    }
    this.inFlight = this.runTick().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  clearDebounceForTest(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }
}
