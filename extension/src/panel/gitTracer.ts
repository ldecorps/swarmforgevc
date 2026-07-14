import { execSync } from 'child_process';

export interface CommitRef {
  hash: string;
  message: string;
}

export function lastCommitForItem(targetPath: string, id: string): CommitRef | null {
  try {
    const output = execSync(
      `git -C ${JSON.stringify(targetPath)} log --oneline --grep=${JSON.stringify(id + ':')} -1`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!output) {
      return null;
    }
    const spaceIdx = output.indexOf(' ');
    if (spaceIdx === -1) {
      return null;
    }
    return { hash: output.slice(0, spaceIdx), message: output.slice(spaceIdx + 1) };
  } catch {
    return null;
  }
}
