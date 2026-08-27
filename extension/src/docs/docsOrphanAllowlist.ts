/**
 * BL-757: shared allowlist + path helpers for real-tree docs orphan gates.
 * Known pre-existing orphans carry an explicit date so debt stays visible.
 */
import * as fs from 'fs';
import * as path from 'path';

import { type DivioMode, type OrphanedDoc } from './docsStructure';

export type AllowlistEntry = {
  modeRelative: string;
  notedDate: string;
  note?: string;
};

export const KNOWN_ORPHAN_ALLOWLIST_REL = 'extension/test/docs_orphan_known_debt.tsv';

export function orphanDocKey(doc: OrphanedDoc): string {
  return `${doc.mode}/${doc.file}`;
}

export function isAuthoredDivioDocPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return /^docs\/(tutorials|how-to|reference|explanation)\/.+\.md$/i.test(normalized);
}

/** Repo-relative docs/how-to/foo.md → mode-relative how-to/foo.md */
export function modeRelativeFromRepoDocPath(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, '/');
  const match = normalized.match(/^docs\/(tutorials|how-to|reference|explanation)\/(.+\.md)$/i);
  if (!match) {
    return undefined;
  }
  return `${match[1]}/${match[2]}`;
}

export function parseAllowlistTsv(text: string): AllowlistEntry[] {
  const entries: AllowlistEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const parts = trimmed.split('\t');
    const modeRelative = parts[0]?.trim();
    const notedDate = parts[1]?.trim();
    if (!modeRelative || !notedDate) {
      continue;
    }
    entries.push({ modeRelative, notedDate, note: parts[2]?.trim() });
  }
  return entries;
}

export function allowlistKeySet(entries: AllowlistEntry[]): Set<string> {
  return new Set(entries.map((e) => e.modeRelative));
}

export function loadKnownOrphanAllowlist(repoRoot: string): Set<string> {
  const abs = path.join(repoRoot, KNOWN_ORPHAN_ALLOWLIST_REL);
  try {
    const text = fs.readFileSync(abs, 'utf8');
    return allowlistKeySet(parseAllowlistTsv(text));
  } catch {
    return new Set();
  }
}

export function filterNonAllowlistedOrphans(
  orphans: OrphanedDoc[],
  allowlist: Set<string>
): OrphanedDoc[] {
  return orphans.filter((doc) => !allowlist.has(orphanDocKey(doc)));
}

export function allowlistEntriesHaveDates(entries: AllowlistEntry[]): boolean {
  return entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.notedDate));
}
