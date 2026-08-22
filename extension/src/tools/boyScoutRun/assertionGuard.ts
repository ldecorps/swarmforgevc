/**
 * BL-1015 — invariant 2: tests are not the thing being cleaned. Split out of
 * `boyScoutRun.ts` (BL-485 mutation-site size).
 */

import { normalizeEdits } from './measure';
import type { CurrentContent, FileEdit } from './types';

/**
 * Every test lane this repository actually has. Declared rather than inferred:
 * a guard that guessed would be exactly as trustworthy as no guard at all.
 */
export const TEST_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)tests?\//,
  /\.test\.(js|mjs|cjs|ts)$/,
  /(^|\/)test_[^/]*\.(sh|bb)$/,
  /_test(_runner)?\.bb$/,
  /_property_runner\.bb$/,
  /(^|\/)specs\/(features|pipeline)\//,
];

export function isTestPath(relPath: string): boolean {
  return TEST_PATH_PATTERNS.some((re) => re.test(relPath));
}

/**
 * What an assertion looks like in each language this repository tests in:
 * node:assert and Vitest in `extension/`, `assert-true`/`is` in Babashka, and
 * `assert_*` shell helpers in `swarmforge/scripts/test/`.
 */
export const ASSERTION_PATTERNS: readonly RegExp[] = [
  /\bassert[-_.\w]*\s*\(/, // assert.equal(...), assert(...), (assert-true ...)
  /^\s*assert[-_\w]*\s+\S/, // assert_elements "a" "b" — the shell command form
  /\bexpect\s*\(/, // expect(x).toBe(1) — Vitest's own matcher form
  /\(\s*is\s+/, // (is (= 1 1)) — clojure.test
];

function splitLines(text: string): string[] {
  return text.split('\n');
}

/** Trimmed assertion lines, in order, duplicates kept — the comparison is a multiset. */
export function assertionLines(text: string): string[] {
  return splitLines(text)
    .map((line) => line.trim())
    .filter((line) => ASSERTION_PATTERNS.some((re) => re.test(line)));
}

/**
 * Whether `after`'s assertion lines are a strict multiset SUBSET-match
 * failure against `before`'s: some assertion line `before` had is not
 * accounted for in `after`, at the same multiplicity.
 *
 * A multiset, not a set: a test that asserted something twice and now
 * asserts it once HAS had an assertion removed.
 */
function buildMultiset(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/** True the moment an assertion line from `had` has no remaining copy in `remaining` — depletes as it checks. */
function hasUnaccountedLine(had: string[], remaining: Map<string, number>): boolean {
  for (const line of had) {
    const left = remaining.get(line) ?? 0;
    if (left === 0) return true;
    remaining.set(line, left - 1);
  }
  return false;
}

function editRemovesAnAssertion(before: string, after: string): boolean {
  const had = assertionLines(before);
  if (had.length === 0) return false;
  const remaining = buildMultiset(assertionLines(after));
  return hasUnaccountedLine(had, remaining);
}

/**
 * The offending edit, or null when every existing test assertion survives.
 *
 * Deliberately conservative in one direction: renaming a symbol that appears
 * inside an assertion trips this guard even though the assertion still asserts
 * the same thing. An autonomous editor that got that call wrong would be
 * rewriting the tests that were supposed to be checking it, so the guard errs
 * towards abandoning and saying the item needs its own ticket.
 */
export function assertionsWouldChange(edits: FileEdit[], currentOf: CurrentContent): FileEdit | null {
  for (const edit of normalizeEdits(edits)) {
    if (!isTestPath(edit.path)) continue;
    const before = currentOf(edit.path);
    if (before === null) continue; // a brand-new test file has nothing to preserve
    if (editRemovesAnAssertion(before, edit.after ?? '')) return edit;
  }
  return null;
}
