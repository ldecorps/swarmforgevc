// BL-485: the count-only mutation-site helper the cleaner runs before
// handoff — reports how many mutation sites each changed file has WITHOUT
// running the test-per-mutant loop, so an oversized file can be split
// before it reaches the hardener's mutation gate. Pure over an INJECTED
// mutant-counting adapter (mutation-site-count.ts's CLI wires the real
// @stryker-mutator/instrumenter there) — this module never itself touches
// Stryker, a test runner, or the filesystem, mirroring dependencyGate.ts's
// own "pure over already-captured input" boundary.
//
// Counts come from the compiled out/ file, never the TypeScript src/ file
// (Stryker's own mutate scope is out/**/*.js — stryker-mutate-scope-is-
// out-not-src) — mapToOutPath below is the src->out translation every
// changed .ts path is run through before counting.

export interface MutationSiteCountAdapters {
  // Reads a compiled out/ file's content, or undefined if it does not
  // exist (a changed file with no compiled counterpart, e.g. a deleted
  // source, contributes no mutation sites rather than erroring).
  readOutFile(outPath: string): string | undefined;
  // Counts mutation sites per file WITHOUT executing any of them against
  // the test suite — keyed by the SAME path each input file carries. The
  // real adapter drives @stryker-mutator/instrumenter's pure AST
  // instrumentation step only, never Stryker's sandbox/test-runner/
  // checker-pool machinery (which is what actually EXECUTES a mutant).
  countMutantsPerFile(files: ReadonlyArray<{ path: string; content: string }>): Promise<Record<string, number>>;
}

export interface FileMutationSiteCount {
  file: string;
  outPath: string;
  siteCount: number;
}

const SRC_TS_PATTERN = /^(.*\/)?src\/(.+)\.ts$/;

// 'foo/src/bar/baz.ts' -> 'foo/out/bar/baz.js', matching this project's
// 1:1 `tsc -p ./` layout (extension/src/**/*.ts -> extension/out/**/*.js).
// A path that is not under a src/ segment (already a compiled out/ path,
// or any other file) passes through unchanged.
export function mapToOutPath(filePath: string): string {
  const match = filePath.match(SRC_TS_PATTERN);
  if (!match) {
    return filePath;
  }
  const [, prefix, rest] = match;
  return `${prefix ?? ''}out/${rest}.js`;
}

// One file's mutation-site count is 0, not omitted, when its mapped out/
// file does not exist — a changed file that never reached the compiled
// tree (e.g. deleted, or genuinely not yet compiled) is not silently
// dropped from the report; it just carries no sites to flag.
export async function countMutationSites(
  changedFiles: readonly string[],
  adapters: MutationSiteCountAdapters
): Promise<FileMutationSiteCount[]> {
  const mapped = changedFiles.map((file) => ({ file, outPath: mapToOutPath(file) }));
  const readable: Array<{ file: string; outPath: string; content: string }> = [];
  for (const { file, outPath } of mapped) {
    const content = adapters.readOutFile(outPath);
    if (content !== undefined) {
      readable.push({ file, outPath, content });
    }
  }
  const counts = await adapters.countMutantsPerFile(readable.map(({ outPath, content }) => ({ path: outPath, content })));
  const bySrcOutPath = new Map(readable.map(({ outPath, file }) => [outPath, file]));
  return mapped.map(({ file, outPath }) => ({
    file,
    outPath,
    siteCount: bySrcOutPath.has(outPath) ? (counts[outPath] ?? 0) : 0,
  }));
}

export type MutationSiteVerdict = 'within' | 'over';

// Boundary-inclusive: a count exactly AT the threshold stays 'within' -
// the gate fires only once a file genuinely EXCEEDS the configured limit.
export function verdictFor(siteCount: number, threshold: number): MutationSiteVerdict {
  return siteCount > threshold ? 'over' : 'within';
}
