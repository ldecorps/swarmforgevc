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
    const had = assertionLines(before);
    if (had.length === 0) continue;

    const remaining = new Map<string, number>();
    for (const line of assertionLines(edit.after ?? '')) {
      remaining.set(line, (remaining.get(line) ?? 0) + 1);
    }
    for (const line of had) {
      const left = remaining.get(line) ?? 0;
      // A multiset, not a set: a test that asserted something twice and now
      // asserts it once HAS had an assertion removed.
      if (left === 0) return edit;
      remaining.set(line, left - 1);
    }
  }
  return null;
}
