/**
 * BL-512: pure, deterministic failure-mode inventory over structured evidence.
 * Input paths / file contents are injected by callers — never reads
 * repo-root .swarmforge/ itself (Stryker sandbox / live-tree rule).
 */

export type EvidenceSource = 'rule_proposal' | 'qa_bounce' | 'commit_subject' | 'chaser';

export interface EvidenceRecord {
  source: EvidenceSource;
  /** Stable grouping key for one failure signature. */
  signature: string;
  /** Durable citation id (path#line, ticket@commit, handoff id, …). */
  citation: string;
}

export interface FailureModeGroup {
  signature: string;
  count: number;
  citations: string[];
}

export function normalizeSignatureText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function inventoryFailureModes(records: EvidenceRecord[]): FailureModeGroup[] {
  const bySig = new Map<string, { count: number; citations: Set<string> }>();
  for (const record of records) {
    if (!record.signature) continue;
    let bucket = bySig.get(record.signature);
    if (!bucket) {
      bucket = { count: 0, citations: new Set() };
      bySig.set(record.signature, bucket);
    }
    bucket.count += 1;
    if (record.citation) bucket.citations.add(record.citation);
  }
  const groups: FailureModeGroup[] = [];
  for (const [signature, bucket] of bySig) {
    groups.push({
      signature,
      count: bucket.count,
      citations: [...bucket.citations].sort(),
    });
  }
  // Deterministic order: signature ascending (same inputs → same array).
  groups.sort((a, b) => (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
  return groups;
}

/** Rank by occurrence desc, then signature asc (stable). */
export function rankFailureModesByFrequency(groups: FailureModeGroup[]): FailureModeGroup[] {
  return [...groups].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0;
  });
}

function parseJsonlObjects(content: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      // skip malformed — never throw
    }
  }
  return out;
}

export function recordsFromRuleProposalJsonl(content: string, sourceLabel = 'rule_proposals'): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  let lineNo = 0;
  for (const line of content.split(/\r?\n/)) {
    lineNo += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const body = typeof obj.body === 'string' ? obj.body : '';
      if (!body) continue;
      records.push({
        source: 'rule_proposal',
        signature: `rule_proposal:${normalizeSignatureText(body)}`,
        citation: `${sourceLabel}:L${lineNo}`,
      });
    } catch {
      // skip
    }
  }
  return records;
}

export function recordsFromQaBounceJsonl(content: string, sourceLabel = 'qa_bounces'): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  let lineNo = 0;
  for (const line of content.split(/\r?\n/)) {
    lineNo += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const failureClass = typeof obj.failureClass === 'string' ? obj.failureClass : '';
      const producingRole = typeof obj.producingRole === 'string' ? obj.producingRole : '';
      const ticket = typeof obj.ticket === 'string' ? obj.ticket : '';
      const commit = typeof obj.commit === 'string' ? obj.commit : '';
      if (!failureClass || !producingRole) continue;
      records.push({
        source: 'qa_bounce',
        signature: `qa_bounce:${failureClass}:${producingRole}`,
        citation: `${sourceLabel}:L${lineNo}:${ticket}@${commit}`,
      });
    } catch {
      // skip
    }
  }
  return records;
}

/** Strip leading ticket tokens (BL-123 / GH-9) then normalize. */
export function normalizeCommitSubject(subject: string): string {
  const stripped = subject.replace(/^(?:[A-Za-z]+-?\d+\s*)+/g, '').replace(/^(?:Merge|Revert)\s+/i, '');
  return normalizeSignatureText(stripped);
}

export function recordsFromCommitSubjects(lines: string[], sourceLabel = 'git-log'): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  let i = 0;
  for (const raw of lines) {
    i += 1;
    const line = raw.trim();
    if (!line) continue;
    // Accept "hash subject" or bare subject
    const m = line.match(/^[0-9a-f]{7,40}\s+(.+)$/i);
    const subject = m ? m[1] : line;
    const sig = normalizeCommitSubject(subject);
    if (!sig) continue;
    records.push({
      source: 'commit_subject',
      signature: `commit:${sig}`,
      citation: `${sourceLabel}:${i}:${line.slice(0, 80)}`,
    });
  }
  return records;
}

export function recordsFromChaserJsonl(
  content: string,
  opts: { minCount?: number; sourceLabel?: string } = {},
): EvidenceRecord[] {
  const minCount = opts.minCount ?? 3;
  const sourceLabel = opts.sourceLabel ?? 'chaser';
  const records: EvidenceRecord[] = [];
  for (const obj of parseJsonlObjects(content)) {
    const type = typeof obj.type === 'string' ? obj.type : '';
    const role = typeof obj.role === 'string' ? obj.role : '';
    const count = typeof obj.count === 'number' ? obj.count : 0;
    const handoffId = typeof obj.handoffId === 'string' ? obj.handoffId : '';
    const at = typeof obj.at === 'string' ? obj.at : '';
    if (!type || !role) continue;
    if (type === 'resource_sample') continue;
    if (count < minCount) continue;
    records.push({
      source: 'chaser',
      signature: `chaser:${type}:${role}`,
      citation: `${sourceLabel}:${type}/${role}@${at || handoffId || 'n'}`,
    });
  }
  return records;
}

export function loadInventoryFromContents(inputs: {
  ruleProposalsJsonl?: string;
  qaBouncesJsonl?: string;
  commitSubjects?: string[];
  chaserJsonl?: string;
  chaserMinCount?: number;
}): FailureModeGroup[] {
  const records: EvidenceRecord[] = [];
  if (inputs.ruleProposalsJsonl) {
    records.push(...recordsFromRuleProposalJsonl(inputs.ruleProposalsJsonl));
  }
  if (inputs.qaBouncesJsonl) {
    records.push(...recordsFromQaBounceJsonl(inputs.qaBouncesJsonl));
  }
  if (inputs.commitSubjects) {
    records.push(...recordsFromCommitSubjects(inputs.commitSubjects));
  }
  if (inputs.chaserJsonl) {
    records.push(...recordsFromChaserJsonl(inputs.chaserJsonl, { minCount: inputs.chaserMinCount }));
  }
  return inventoryFailureModes(records);
}
