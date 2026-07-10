// BL-233 slice 2 (auto-acquire-free-02): the host secret store. Writes
// acquired API keys to a JSON file OUTSIDE the target working tree/repo -
// callers supply a host-level path (e.g. under os.homedir()), never a path
// inside this or any target repo, satisfying the "never in the working
// tree or a commit" constraint structurally rather than by convention
// alone. Keyed by "<provider>:<model>" so re-acquiring one candidate never
// clobbers another's stored key; re-acquiring the SAME candidate overwrites
// its own entry rather than duplicating one.

import * as fs from 'fs';
import * as path from 'path';
import { ModelCandidate, SecretStore } from './candidate';

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

export function createFileSecretStore(secretsFilePath: string): SecretStore {
  return {
    async store(candidate: ModelCandidate, apiKey: string): Promise<void> {
      fs.mkdirSync(path.dirname(secretsFilePath), { recursive: true });
      const existing = readExisting(secretsFilePath);
      existing[secretKeyFor(candidate)] = apiKey;
      fs.writeFileSync(secretsFilePath, JSON.stringify(existing, null, 2), { mode: 0o600 });
    },
  };
}
