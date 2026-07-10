// BL-233 slice 2 (auto-acquire-free-02): the host secret store. Writes
// acquired API keys to a JSON file OUTSIDE the target working directory -
// createFileSecretStore REJECTS (throws) any path that resolves inside
// `forbiddenWorkingTreeRoot` (defaulting to process.cwd(), i.e. wherever
// the recruiter tool was invoked from - its target repo, matching the
// constraint's own wording), so the "never in the working tree or a
// commit" rule is enforced structurally, not by caller convention alone
// (architect bounce 2d96adcb10: an earlier version only claimed this in a
// comment, with zero actual enforcement).
//
// Deliberately NOT "reject any path inside ANY git repository": that
// heuristic has a real false-positive - an operator's chosen host-level
// secrets location (e.g. under os.homedir()) can itself sit inside an
// UNRELATED git repo (a dotfiles checkout is a common real example), which
// has nothing to do with "the target working directory" this constraint
// actually means. Comparing against the specific invoking cwd avoids that
// false positive entirely while still catching the real danger: pointing
// the store at (or under) the target repo itself.
//
// Keyed by "<provider>:<model>" so re-acquiring one candidate never
// clobbers another's stored key; re-acquiring the SAME candidate overwrites
// its own entry rather than duplicating one.

import * as fs from 'fs';
import * as path from 'path';
import { ModelCandidate, SecretStore } from './candidate';

function isInside(targetPath: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function secretKeyFor(candidate: ModelCandidate): string {
  return `${candidate.provider}:${candidate.model}`;
}

function readExisting(secretsFilePath: string): Record<string, string> {
  if (!fs.existsSync(secretsFilePath)) {
    return {};
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(secretsFilePath, 'utf-8'));
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
}

export function createFileSecretStore(
  secretsFilePath: string,
  forbiddenWorkingTreeRoot: string = process.cwd()
): SecretStore {
  if (isInside(secretsFilePath, forbiddenWorkingTreeRoot)) {
    throw new Error(
      `refusing to store a secret inside the target working directory (${path.resolve(forbiddenWorkingTreeRoot)}) - the host secret store must live outside it`
    );
  }
  return {
    async store(candidate: ModelCandidate, apiKey: string): Promise<void> {
      fs.mkdirSync(path.dirname(secretsFilePath), { recursive: true });
      const existing = readExisting(secretsFilePath);
      existing[secretKeyFor(candidate)] = apiKey;
      fs.writeFileSync(secretsFilePath, JSON.stringify(existing, null, 2), { mode: 0o600 });
    },
  };
}
