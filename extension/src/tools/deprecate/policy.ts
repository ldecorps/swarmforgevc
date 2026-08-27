import type { Envelope, EnvelopeDimension, SeatTier, StaleItem } from './types';
import { HARD_TIER_REFUSE_REASON, SIZE_ENVELOPE } from './types';

export function seatAllowsDeprecate(tier: SeatTier | undefined): boolean {
  return tier === 'hard';
}

export function seatRefuseReason(): string {
  return HARD_TIER_REFUSE_REASON;
}

export function exceedsEnvelope(
  size: { files: number; lines: number },
  envelope: Envelope = SIZE_ENVELOPE
): EnvelopeDimension[] {
  const blown: EnvelopeDimension[] = [];
  if (size.files > envelope.files) blown.push('files');
  if (size.lines > envelope.lines) blown.push('lines');
  return blown;
}

/** Rank: recurrence desc, blastRadius desc, subject asc. */
export function rankStaleItems(items: StaleItem[]): StaleItem[] {
  return [...items].sort((a, b) => {
    if (b.recurrence !== a.recurrence) return b.recurrence - a.recurrence;
    if (b.blastRadius !== a.blastRadius) return b.blastRadius - a.blastRadius;
    return a.subject.localeCompare(b.subject);
  });
}

export function adjudicateTop(item: StaleItem): {
  action: 'retire' | 'defect' | 'human-ask' | 'refuse-envelope';
  closesTicket: false;
  reason?: string;
} {
  const blown = exceedsEnvelope({
    files: item.estimatedFiles,
    lines: item.estimatedLines,
  });
  if (blown.length > 0) {
    return {
      action: 'refuse-envelope',
      closesTicket: false,
      reason: `oversized retirement (${blown.join(', ')}) exceeds envelope`,
    };
  }
  if (item.adjudication === 'human-ask') {
    return {
      action: 'human-ask',
      closesTicket: false,
      reason: item.ambiguityReason ?? 'ambiguous between stale and valid',
    };
  }
  if (item.adjudication === 'defect') {
    return {
      action: 'defect',
      closesTicket: false,
      reason: 'route to specifier — never auto-close',
    };
  }
  return { action: 'retire', closesTicket: false };
}
