// BL-141: context-fullness gate for idle-clear. Backend agent runtimes may
// not expose true context-token usage to the extension, so the gate
// supports two tiers: an exact reading when a backend DOES report it
// (telemetry), and a deterministic proxy metric when it does not — with the
// decision always labeled by which tier produced it, so a clear driven by
// the proxy is never silently mistaken for one driven by exact telemetry.
export type ContextFullnessSource = 'telemetry' | 'proxy';

export interface ContextFullness {
  percent: number;
  source: ContextFullnessSource;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// telemetryPercent is null when the backend does not report context usage
// for this role at all (the current reality for every backend this
// extension drives) — resolveContextFullness falls back to the caller-
// supplied proxy reading in that case, never blocking on missing telemetry.
export function resolveContextFullness(
  telemetryPercent: number | null,
  proxyPercent: number
): ContextFullness {
  if (telemetryPercent !== null) {
    return { percent: clampPercent(telemetryPercent), source: 'telemetry' };
  }
  return { percent: clampPercent(proxyPercent), source: 'proxy' };
}

// Deterministic proxy: pane-history line count as a fraction of a
// configured "typical full window" line count. Simple and cheap (no token
// counting), and monotonic in the one signal every backend's pane capture
// already gives us for free.
export function estimateProxyFullnessPercent(paneLineCount: number, fullAtLineCount: number): number {
  if (fullAtLineCount <= 0) {
    return 100;
  }
  return clampPercent((paneLineCount / fullAtLineCount) * 100);
}
