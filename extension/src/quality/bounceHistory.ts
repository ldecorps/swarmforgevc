// BL-608: the pure render/merge core for a ticket's own `bounce_history:`
// record - the git-visible per-ticket counterpart to the gitignored
// qa_bounces/<month>.jsonl aggregate (qaBounce.ts/qaBounceStore.ts), so "how
// many times did this ticket bounce, and why" is answerable from the ticket
// YAML alone. Deliberately NOT a full YAML round-trip (js-yaml.dump would
// reformat every field, block scalar, and comment in a hand-authored ticket
// file) - each entry is written as a single-line flow mapping and merged by
// text, the same discipline `required_stages:` (BL-606) established for
// keeping the file greppable and diff-friendly. js-yaml is used only as a
// parse-sanity check, never to re-serialize the file.
import * as yaml from 'js-yaml';

export interface BounceHistoryEntry {
  at: string; // yyyy-mm-dd (date only, not a full timestamp)
  by: string; // the bouncing role (e.g. QA)
  blamed: string; // the role held responsible (qaBounce.ts's producingRole)
  failureClass: string;
  commit: string;
  evidence: string;
}

export type BounceHistoryMergeReason = 'appended' | 'duplicate' | 'unparseable';

export interface BounceHistoryMergeResult {
  text: string;
  updated: boolean;
  reason: BounceHistoryMergeReason;
}

const ENTRY_LINE = /^ {2}- \{ at: ([^,]+), by: ([^,]+), blamed: ([^,]+), class: ([^,]+), commit: ([^,]+), evidence: (.+) \}\s*$/;
const BOUNCE_COUNT_LINE = /^bounce_count:[^\n]*\n?/m;
const BOUNCE_HISTORY_BLOCK = /^bounce_history:[ \t]*\n(?:^ {2}-\s*\{[^\n]*\}[ \t]*\n?)*/m;

// Idempotency key: date + failure class, mirroring qaBounceNaturalKey's own
// dateOnly + failureClass contract (ticket is implicit - this is always one
// ticket's own file).
function entryNaturalKey(entry: Pick<BounceHistoryEntry, 'at' | 'failureClass'>): string {
  return `${entry.at}|${entry.failureClass}`;
}

export function formatBounceHistoryEntry(entry: BounceHistoryEntry): string {
  return `  - { at: ${entry.at}, by: ${entry.by}, blamed: ${entry.blamed}, class: ${entry.failureClass}, commit: ${entry.commit}, evidence: ${entry.evidence} }`;
}

export function parseBounceHistoryEntries(yamlText: string): BounceHistoryEntry[] {
  const entries: BounceHistoryEntry[] = [];
  for (const line of yamlText.split('\n')) {
    const match = ENTRY_LINE.exec(line);
    if (!match) {
      continue;
    }
    const [, at, by, blamed, failureClass, commit, evidence] = match;
    entries.push({
      at: at.trim(),
      by: by.trim(),
      blamed: blamed.trim(),
      failureClass: failureClass.trim(),
      commit: commit.trim(),
      evidence: evidence.trim(),
    });
  }
  return entries;
}

function isParseableYaml(text: string): boolean {
  try {
    yaml.load(text);
    return true;
  } catch {
    return false;
  }
}

function stripExistingBlock(text: string): string {
  return text.replace(BOUNCE_HISTORY_BLOCK, '').replace(BOUNCE_COUNT_LINE, '');
}

function appendBlock(text: string, entries: BounceHistoryEntry[]): string {
  const trimmed = text.replace(/\s+$/, '');
  const block = [`bounce_count: ${entries.length}`, 'bounce_history:', ...entries.map(formatBounceHistoryEntry)].join('\n');
  return `${trimmed}\n${block}\n`;
}

// Pure: merges one new bounce entry into a ticket's raw YAML text.
// bounce_count is always recomputed from the resulting list - a stale or
// tampered on-disk count is never trusted. A duplicate on the natural key
// (date + failure class) is a no-op, matching qaBounceNaturalKey's own
// idempotency contract. Never throws: a ticket whose YAML doesn't even
// parse is reported unparseable so the caller can degrade (BL-608's
// best-effort, never-blocking requirement) without risking corrupting an
// already-broken file further.
export function mergeBounceHistoryEntry(yamlText: string, entry: BounceHistoryEntry): BounceHistoryMergeResult {
  if (!isParseableYaml(yamlText)) {
    return { text: yamlText, updated: false, reason: 'unparseable' };
  }
  const existing = parseBounceHistoryEntries(yamlText);
  const key = entryNaturalKey(entry);
  if (existing.some((e) => entryNaturalKey(e) === key)) {
    return { text: yamlText, updated: false, reason: 'duplicate' };
  }
  const stripped = stripExistingBlock(yamlText);
  const merged = appendBlock(stripped, [...existing, entry]);
  return { text: merged, updated: true, reason: 'appended' };
}
