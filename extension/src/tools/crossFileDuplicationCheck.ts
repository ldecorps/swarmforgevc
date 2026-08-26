/**
 * BL-737: pure cross-file duplication check for /pilot land. Detects an
 * identical normalized consecutive-line block shared by more than two
 * files the run itself touched (BL-637 threshold: same --help block in 16
 * scripts). IO (git touched-path resolution, file reads) stays in
 * commitClaimGitReader / pilot-acceptance-gate.
 */

export const CROSS_FILE_DUPLICATION_REFUSAL =
  'identical normalized text appears in more than two files the run touched';

/** BL-637 shape: a twelve-line help block pasted across many scripts. */
export const MIN_DUPLICATION_BLOCK_LINES = 12;

export type CrossFileDuplicationHit = {
  fingerprint: string;
  paths: string[];
};

export type CrossFileDuplicationCheckOutcome =
  | { checked: true; filesScanned: number; duplication?: CrossFileDuplicationHit }
  | { checked: false };

export function normalizeLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/g, ''));
}

function blockFingerprint(lines: string[], start: number, length: number): string {
  return lines.slice(start, start + length).join('\n');
}

function indexBlocks(
  files: Array<{ path: string; text: string }>,
  minBlockLines: number
): Map<string, Set<string>> {
  const byFingerprint = new Map<string, Set<string>>();
  for (const file of files) {
    const lines = normalizeLines(file.text);
    if (lines.length < minBlockLines) {
      continue;
    }
    const lastStart = lines.length - minBlockLines;
    for (let start = 0; start <= lastStart; start += 1) {
      const fingerprint = blockFingerprint(lines, start, minBlockLines);
      let holders = byFingerprint.get(fingerprint);
      if (!holders) {
        holders = new Set();
        byFingerprint.set(fingerprint, holders);
      }
      holders.add(file.path);
    }
  }
  return byFingerprint;
}

function firstHitOverThreshold(byFingerprint: Map<string, Set<string>>): CrossFileDuplicationHit | undefined {
  for (const [fingerprint, holders] of byFingerprint) {
    if (holders.size > 2) {
      return { fingerprint, paths: [...holders].sort() };
    }
  }
  return undefined;
}

/**
 * Find identical normalized blocks of at least `minBlockLines` consecutive
 * lines shared by more than two of the given files. Two-file duplication
 * does not refuse (BL-737 invariant / scenario 02).
 */
export function findCrossFileDuplication(
  files: Array<{ path: string; text: string }>,
  minBlockLines: number = MIN_DUPLICATION_BLOCK_LINES
): CrossFileDuplicationCheckOutcome {
  if (minBlockLines < 1) {
    return { checked: true, filesScanned: files.length };
  }
  const byFingerprint = indexBlocks(files, minBlockLines);
  const duplication = firstHitOverThreshold(byFingerprint);
  if (duplication) {
    return { checked: true, filesScanned: files.length, duplication };
  }
  return { checked: true, filesScanned: files.length };
}
