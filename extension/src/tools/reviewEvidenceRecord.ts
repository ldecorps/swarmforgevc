/**
 * BL-1362: the pure half of the review-pass evidence recorder.
 *
 * Article 4.4 makes every review pass leave one evidence file - items D1..Dn
 * with their fixed fields plus blamed role and remediation pointer, or an
 * explicit NONE for a clean sweep - and BL-536 makes the forward name the
 * commit carrying it. All of that is ENFORCED and none of it was assisted:
 * `review_forward_evidence_gate_lib.bb` refuses a forward that contributed
 * nothing, and has been hardened three times (BL-536, BL-806, BL-1293), each
 * after a role got the ritual wrong. This is the missing writer.
 *
 * It records; it never judges. The verdict is the reviewing role's, and an
 * inventory that is neither NONE nor D1..Dn is REFUSED rather than written
 * empty - a role with no verdict has not finished its pass, and the gate would
 * refuse the forward one turn later with less information.
 */

export interface Article44Field {
  /** The constitution's own label, asserted against QA.prompt by a test. */
  label: string;
  /** The key this tool reads it from. */
  key: keyof EvidenceItem;
}

/**
 * Article 4.4's item fields: the five QA.prompt states, PLUS the blamed role
 * and remediation pointer that same passage requires.
 *
 * BL-897: this list is mirrored across a boundary - the constitution's prose
 * and this code - so a test asserts the two literals agree rather than trusting
 * them to. Changing the prompt's wording fails that test, which is the point:
 * a second copy that drifts silently is the failure mode being prevented.
 */
export const ARTICLE_44_ITEM_FIELDS: Article44Field[] = [
  { label: 'Failing command', key: 'command' },
  { label: 'Commit hash', key: 'commit' },
  { label: 'First error excerpt', key: 'excerpt' },
  { label: 'Failure class', key: 'class' },
  { label: 'Expected vs observed', key: 'expected' },
  { label: 'Blamed role', key: 'blamed' },
  { label: 'Remediation pointer', key: 'remediation' },
];

export interface EvidenceItem {
  command: string;
  commit: string;
  excerpt: string;
  class: string;
  expected: string;
  blamed: string;
  remediation: string;
}

export type EvidenceVerdict = { kind: 'none' } | { kind: 'items'; items: EvidenceItem[] };

export interface VerdictInput {
  none: boolean;
  items: EvidenceItem[];
}

const VERDICT_REQUIREMENT =
  'a verdict must be either an explicit NONE (a full sweep that found nothing) ' +
  'or an inventory of one or more items D1..Dn, each carrying ' +
  ARTICLE_44_ITEM_FIELDS.map((f) => f.label).join(', ');

/**
 * The verdict, validated and never inferred (invariant 3). Refusing is a
 * feature: absence of a verdict is not a clean sweep, and writing it as one
 * would produce the artifact the gate exists to demand while saying nothing.
 */
export function parseVerdict(input: VerdictInput): EvidenceVerdict {
  const items = input.items || [];
  if (input.none && items.length > 0) {
    return refuse('both NONE and a defect inventory were supplied; ' + VERDICT_REQUIREMENT);
  }
  if (input.none) {
    return { kind: 'none' };
  }
  if (items.length === 0) {
    return refuse('no verdict was supplied: ' + VERDICT_REQUIREMENT);
  }
  items.forEach((item, index) => {
    for (const field of ARTICLE_44_ITEM_FIELDS) {
      const value = item[field.key];
      if (typeof value !== 'string' || value.trim() === '') {
        refuse(`item D${index + 1} is missing its ${field.label} (${field.key}); ` + VERDICT_REQUIREMENT);
      }
    }
  });
  return { kind: 'items', items };
}

function refuse(message: string): never {
  throw new Error(`record-review-evidence: ${message}`);
}

/**
 * `<ticket>-<role>-<YYYYMMDD>.md`, the corpus's own convention.
 *
 * A second pass by one role on one day never overwrites the first: the
 * numeric suffix is the form the corpus already carries (BL-1166's
 * `-20260827-2.md`, BL-1204's `-20260828-2.md`), chosen over the `pass2`
 * qualifier because a tool can emit it deterministically without knowing what
 * the second pass MEANT.
 *
 * `taken` is injected rather than read here so the naming rule is testable
 * with no filesystem at all.
 */
export function evidenceFileName(
  ticket: string,
  role: string,
  date: string,
  taken: (name: string) => boolean
): string {
  const base = `${ticket}-${role}-${date}`;
  if (!taken(`${base}.md`)) {
    return `${base}.md`;
  }
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}.md`;
    if (!taken(candidate)) {
      return candidate;
    }
  }
  return refuse(`could not find a free name for ${base} after 999 attempts`);
}

export interface RenderInput {
  ticket: string;
  role: string;
  date: string;
  verdict: EvidenceVerdict;
}

/** The file's text. NONE and an inventory take the SAME path (invariant 2). */
export function renderEvidence({ ticket, role, date, verdict }: RenderInput): string {
  const lines = [`# ${ticket} — ${role} review pass, ${formatDate(date)}`, ''];
  if (verdict.kind === 'none') {
    lines.push(
      'NONE. The full checklist was run and found no defect.',
      '',
      'Recorded as an explicit NONE rather than skipped: an inventory is a pass',
      'artifact, not only a bounce artifact (Article 4.4), and the forward names',
      'THIS commit rather than the received hash (BL-536).',
      ''
    );
  } else {
    lines.push(`${verdict.items.length} defect(s) found. One bounce, complete inventory (Article 4.4).`, '');
    verdict.items.forEach((item, index) => {
      lines.push(`## D${index + 1}`, '');
      for (const field of ARTICLE_44_ITEM_FIELDS) {
        lines.push(`- **${field.label}**: ${item[field.key]}`);
      }
      lines.push('');
    });
  }
  lines.push(`By ${role}.`, '');
  return lines.join('\n');
}

function formatDate(date: string): string {
  if (!/^\d{8}$/.test(date)) {
    return date;
  }
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}
