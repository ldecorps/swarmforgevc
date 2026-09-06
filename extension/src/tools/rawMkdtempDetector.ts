/**
 * BL-1209: the raw-mkdtemp detector, owned by the TOOL.
 *
 * BL-420 introduced this pattern inside
 * `extension/test/helpers/rawMkdtempGuard.js`, and BL-743's pilot check then
 * reached for it by path - `require(<subjectRoot>/extension/test/helpers/
 * rawMkdtempGuard)` - which made the check runnable only against the one
 * repository that happens to contain the tool, and made it throw
 * MODULE_NOT_FOUND against any other root.
 *
 * The pure detector therefore lives here, where the tool's own logic lives,
 * and the test helper re-exports it. One detector, two consumers importing it
 * - not one file two consumers reach for by path. Its SEMANTICS are unchanged
 * from BL-420: this move is about where it is resolved from, never about what
 * it detects.
 */

/** A raw `fs.mkdtempSync(path.join(os.tmpdir(), ...))` call site. */
export const RAW_MKDTEMP_PATTERN = /mkdtempSync\(\s*path\.join\(\s*os\.tmpdir\(\)/;

/**
 * BL-1226: the specs/pipeline/steps/ lane's detector. Unlike RAW_MKDTEMP_PATTERN
 * above, this is deliberately ROUTE-based, not spelling-based - it matches any
 * direct mkdtempSync(...) call regardless of what base expression it is handed
 * (os.tmpdir(), require('os').tmpdir(), require('node:os').tmpdir(), a bare
 * '/tmp' literal, a module-level constant, ...). The narrow pattern above
 * covers only one of those five spellings; reusing it unchanged for the steps
 * lane would ship a twelve-file blind spot on day one (measured 2026-08-28).
 * Enumerating every base expression is also unbounded - a new spelling always
 * finds a gap - so the only sound scope for THIS lane is "did this file call
 * mkdtempSync directly at all", leaving the required shared helper
 * (specs/pipeline/steps/lib/socketFixtureRoot.js) as the one route that never
 * matches, because a caller through it never spells mkdtempSync itself.
 */
export const RAW_MKDTEMP_ANY_BASE_PATTERN = /\bmkdtempSync\s*\(/;

function linesMatching(text: string, pattern: RegExp): number[] {
  const hits: number[] = [];
  text.split('\n').forEach((line, index) => {
    if (pattern.test(line)) {
      hits.push(index + 1);
    }
  });
  return hits;
}

/**
 * Pure: given one file's own text, the 1-indexed line numbers containing a
 * raw call. No filesystem, no repository, no subject root.
 */
export function findRawMkdtempLines(text: string): number[] {
  return linesMatching(text, RAW_MKDTEMP_PATTERN);
}

/** BL-1226: same shape as findRawMkdtempLines, the steps lane's own pattern. */
export function findRawMkdtempLinesAnyBase(text: string): number[] {
  return linesMatching(text, RAW_MKDTEMP_ANY_BASE_PATTERN);
}
