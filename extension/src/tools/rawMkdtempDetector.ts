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
 * Pure: given one file's own text, the 1-indexed line numbers containing a
 * raw call. No filesystem, no repository, no subject root.
 */
export function findRawMkdtempLines(text: string): number[] {
  const hits: number[] = [];
  text.split('\n').forEach((line, index) => {
    if (RAW_MKDTEMP_PATTERN.test(line)) {
      hits.push(index + 1);
    }
  });
  return hits;
}
