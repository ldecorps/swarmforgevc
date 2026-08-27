/**
 * BL-1174 — shared types/constants for /deprecate (soft operator verbs).
 * One retirement per confirm run, or refuse with a reason (BL-1015 envelope).
 */

export interface Envelope {
  files: number;
  lines: number;
}

/** One-item retirement envelope — smaller than a normal slice (BL-634 median). */
export const SIZE_ENVELOPE: Envelope = { files: 3, lines: 80 };

export type EnvelopeDimension = 'files' | 'lines';

export type SeatTier = 'hard' | 'easy' | 'weak';

export type AdjudicationBucket = 'retire' | 'defect' | 'human-ask';

export type StaleKind = 'orphan-conf-flag';

export interface StaleItem {
  subject: string;
  kind: StaleKind;
  recurrence: number;
  blastRadius: number;
  adjudication: AdjudicationBucket;
  estimatedFiles: number;
  estimatedLines: number;
  ambiguityReason?: string;
}

export type DeprecateMode = 'dry' | 'confirm';

export type DeprecateResult =
  | { outcome: 'ranked'; dry: true; items: StaleItem[] }
  | { outcome: 'retired'; subject: string; stubPath: string; indexLinked: true }
  | { outcome: 'human-ask'; subject: string; reason: string }
  | { outcome: 'defect'; subject: string; reason: string; closesTicket: false }
  | { outcome: 'refused'; reason: string }
  | { outcome: 'nothing-ranked' };

export interface DeprecateIo {
  mode: DeprecateMode;
  seatTier: SeatTier | undefined;
  signals: StaleItem[];
  writeFile: (relPath: string, content: string) => void;
  readFile: (relPath: string) => string | null;
  confPath?: string;
  indexPath?: string;
}

export const HARD_TIER_REFUSE_REASON = 'needs hard-tier multi-document reasoner';

export const DEPRECATED_SECTION_HEADING = '## Deprecated';

export const DEFAULT_CONF_PATH = 'swarmforge/swarmforge.conf';
export const DEFAULT_INDEX_PATH = 'docs/index.md';
