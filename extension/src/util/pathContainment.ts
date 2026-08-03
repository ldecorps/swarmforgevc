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
