import * as fs from 'fs';
import * as path from 'path';

export interface RunEntry {
  name: string;
  targetPath: string;
  startedAt: string;
  completedAt?: string;
  prUrl?: string;
  status?: 'running' | 'stopped';
}

export function loadRuns(logPath: string): RunEntry[] {
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n');
    return lines
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function appendRun(logPath: string, entry: RunEntry): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line, 'utf8');
}

export function updateLastRunForTarget(
  logPath: string,
  targetPath: string,
  update: Partial<Pick<RunEntry, 'completedAt' | 'prUrl' | 'status'>>
): void {
  const runs = loadRuns(logPath);
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].targetPath === targetPath) {
      runs[i] = { ...runs[i], ...update };
      const lines = runs.map((r) => JSON.stringify(r) + '\n').join('');
      fs.writeFileSync(logPath, lines, 'utf8');
      return;
    }
  }
}
