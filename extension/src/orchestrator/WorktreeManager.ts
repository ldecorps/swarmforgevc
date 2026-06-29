import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const BASE_ROLES = new Set(['coordinator', 'specifier']);

export interface WorktreeEntry {
  role: string;
  worktreePath: string;
  branch: string;
}

export class WorktreeManager {
  private worktrees: WorktreeEntry[] = [];

  constructor(private readonly repoPath: string) {}

  setup(roles: string[]): void {
    const subordinates = roles.filter((r) => !BASE_ROLES.has(r));
    for (const role of subordinates) {
      const worktreePath = path.join(this.repoPath, '.worktrees', role);
      const branch = `swarm/${role}`;
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
      execSync(
        `git worktree add -b ${branch} ${worktreePath}`,
        { cwd: this.repoPath, stdio: 'pipe' }
      );
      this.worktrees.push({ role, worktreePath, branch });
    }
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
        execSync(`git worktree remove --force ${entry.worktreePath}`, {
          cwd: this.repoPath,
          stdio: 'pipe',
        });
        execSync(`git branch -D ${entry.branch}`, {
          cwd: this.repoPath,
          stdio: 'pipe',
        });
      } catch {
        // best-effort cleanup
      }
    }
    this.worktrees = [];
  }
}
