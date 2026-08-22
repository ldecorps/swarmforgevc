/**
 * BL-1014 — shared types for the Boy Scout scan. See ./index.ts for the
 * module's overall design note.
 */

export const EVIDENCE_SOURCES = [
  'deferred-hardening-gate',
  'bounce-recurrence',
  'crap-over-threshold',
  'duplication',
  'runtime-bloat',
] as const;

export type EvidenceSourceName = (typeof EVIDENCE_SOURCES)[number];

/** One source's attestation that `subject` is carrying debt. */
export interface Evidence {
  subject: string;
  source: EvidenceSourceName;
  /** The artifact a human opens to check this without re-running the scan. */
  artifact: string;
  /** Enough detail to find the row/line inside that artifact. */
  detail: string;
}

export interface DebtItem {
  subject: string;
  /** DISTINCT sources attesting this subject - the rank key. */
  sourceCount: number;
  evidence: Evidence[];
}

export interface ConsultedSource {
  source: EvidenceSourceName;
  /** False when the source could not be read at all - never the same as clean. */
  available: boolean;
  count: number;
  why?: string;
}

export interface HardeningLedgerRow {
  parcel: string;
  gate: string;
  file_set: string[];
  reason?: string;
  detected_at?: string;
}

export interface CountedPath {
  path: string;
  count: number;
  threshold: number;
}

export interface SourceReaders {
  hardeningLedger(root: string): HardeningLedgerRow[];
  bounceLines(root: string): string[];
  crapReport(root: string): string;
  duplicationReport(root: string): string;
  countedPaths(root: string): CountedPath[];
}

export interface ScanResult {
  ranked: DebtItem[];
  consulted: ConsultedSource[];
}
