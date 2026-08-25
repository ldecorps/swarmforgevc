/**
 * BL-735: pure helpers for pilot acceptance execution tracking and
 * revert-then-reland note requirements. IO stays in pilot-acceptance-gate.ts.
 */

export const ACCEPTANCE_NOT_EXECUTED_REFUSAL =
  'acceptance was declared but not executed for this landing attempt';

export const RELAND_NOTES_REQUIRED_REFUSAL =
  'revert-then-reland tickets must carry yaml notes explaining the revert and why the reland is warranted';

export function isRevertRelandTicket(notes: string | undefined): boolean {
  if (!notes) {
    return false;
  }
  const lower = notes.toLowerCase();
  return /\brevert/.test(lower) && (/\bre-?land/.test(lower) || /\bsecond\s+land/.test(lower));
}

export function assessRelandNotes(notes: string | undefined): { satisfied: boolean } {
  if (!isRevertRelandTicket(notes)) {
    return { satisfied: true };
  }
  if (!notes) {
    return { satisfied: false };
  }
  const lower = notes.toLowerCase();
  const explainsRevert = /\brevert/.test(lower) && (/\bbecause\b/.test(lower) || /\bwhy\b/.test(lower));
  const explainsReland =
    (/\bre-?land/.test(lower) || /\bsecond\s+land/.test(lower)) &&
    (/\bwarrant/.test(lower) || /\bwhy\b/.test(lower) || /\bbecause\b/.test(lower));
  return { satisfied: explainsRevert && explainsReland };
}

export function hadPriorLandWithoutReceipt(
  notes: string | undefined,
  receiptExists: boolean
): boolean {
  if (receiptExists || !notes) {
    return false;
  }
  const lower = notes.toLowerCase();
  return (
    /\bwithout\s+(an?\s+)?acceptance\s+receipt/.test(lower) ||
    (/\brevert/.test(lower) && /\b(done|landed)\b/.test(lower) && !/\breceipt/.test(lower))
  );
}

export function acceptanceExecutedForFeature(
  executedFeature: string | undefined,
  featureFilePath: string
): boolean {
  return executedFeature !== undefined && executedFeature === featureFilePath;
}
