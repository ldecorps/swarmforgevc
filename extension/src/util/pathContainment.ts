import * as fs from 'fs';
import * as path from 'path';

// Shared by the recruiter and onboarding host secret stores (both enforce
// "never inside the target working directory") - extracted rather than
// duplicated so the one containment check has one implementation.
export function isPathInside(candidatePath: string, rootPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// BL-792: resolves p to its canonical (symlink-free) form even when p - or
// any suffix of it - does not exist yet, by walking up to the nearest
// existing ancestor, realpath-ing THAT, and re-appending the missing tail
// unresolved (a path that does not exist cannot itself be a symlink).
// Needed anywhere a path gets compared against another already-canonical
// path (a git-canonicalized repo root, a realpath'd os.tmpdir()): macOS's
// /tmp -> /private/tmp and /var -> /private/var symlinks otherwise make an
// unresolved raw path and its canonical form silently fail a prefix or
// path.relative comparison (co-change-report.ts's cwd-vs-`git rev-parse
// --show-toplevel` mismatch; relay-onboarding-negotiation-telegram.ts's
// isTestFixtureRoot ENOENT-fallback case).
export function tryRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) {
      return p;
    }
    return path.join(tryRealpath(parent), path.basename(p));
  }
}
