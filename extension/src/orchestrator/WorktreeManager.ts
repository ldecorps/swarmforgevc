import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const BASE_ROLES = new Set(['coordinator', 'specifier']);

export interface WorktreeEntry {
  role: string;
  worktreePath: string;
  branch: string;
}

interface RegisteredWorktree {
  worktreePath: string;
  branch: string;
}

function runGit(repoPath: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function listRegisteredWorktrees(repoPath: string): RegisteredWorktree[] {
  const output = runGit(repoPath, 'worktree list --porcelain');
  if (!output) {
    return [];
  }

  const entries: RegisteredWorktree[] = [];
  let worktreePath = '';
  let branch = '';

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (worktreePath && branch) {
        entries.push({ worktreePath, branch });
      }
      worktreePath = line.slice('worktree '.length);
      branch = '';
      continue;
    }
    if (line.startsWith('branch ')) {
      branch = line.slice('branch refs/heads/'.length);
    }
  }

  if (worktreePath && branch) {
    entries.push({ worktreePath, branch });
  }

  return entries;
}

function branchExists(repoPath: string, branch: string): boolean {
  try {
    runGit(repoPath, `show-ref --verify --quiet refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

function candidateBranches(role: string): string[] {
  return [`swarm/${role}`, `swarmforge-${role}`];
}

export class WorktreeManager {
  private worktrees: WorktreeEntry[] = [];

  constructor(private readonly repoPath: string) {}

  setup(roles: string[]): void {
    const subordinates = roles.filter((r) => !BASE_ROLES.has(r));
    const registered = listRegisteredWorktrees(this.repoPath);

    for (const role of subordinates) {
      this.worktrees.push(this.ensureWorktree(role, registered));
    }
  }

  private ensureWorktree(
    role: string,
    registered: RegisteredWorktree[]
  ): WorktreeEntry {
    const worktreePath = path.join(this.repoPath, '.worktrees', role);
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    let resolvedWorktreePath: string;
    try {
      resolvedWorktreePath = fs.realpathSync(worktreePath);
    } catch {
      resolvedWorktreePath = path.resolve(worktreePath);
    }

    const existing = registered.find(
      (entry) => path.resolve(entry.worktreePath) === resolvedWorktreePath
    );
    if (existing) {
      return { role, worktreePath, branch: existing.branch };
    }

    if (fs.existsSync(worktreePath)) {
      throw new Error(
        `${worktreePath} exists but is not a registered git worktree. ` +
          'Remove it or run "git worktree prune", then try again.'
      );
    }

    for (const branch of candidateBranches(role)) {
      if (branchExists(this.repoPath, branch)) {
        runGit(this.repoPath, `worktree add ${worktreePath} ${branch}`);
        return { role, worktreePath, branch };
      }
    }

    const branch = candidateBranches(role)[0];
    runGit(this.repoPath, `worktree add -b ${branch} ${worktreePath}`);
    return { role, worktreePath, branch };
  }

  list(): WorktreeEntry[] {
    return [...this.worktrees];
  }

  getPath(role: string): string {
    if (BASE_ROLES.has(role)) {
      return this.repoPath;
    }
    const entry = this.worktrees.find((w) => w.role === role);
    return entry ? entry.worktreePath : this.repoPath;
  }

  teardown(): void {
    for (const entry of this.worktrees) {
      try {
        runGit(this.repoPath, `worktree remove --force ${entry.worktreePath}`);
        if (entry.branch.startsWith('swarm/')) {
          runGit(this.repoPath, `branch -D ${entry.branch}`);
        }
      } catch {
        // best-effort cleanup
      }
    }
    this.worktrees = [];
  }
}
