import * as fs from 'fs';
import * as path from 'path';

export interface RunEntry {
  name: string;
  targetPath: string;
  startedAt: string;
  completedAt?: string;
  prUrl?: string;
}

export function loadRuns(logPath: string): RunEntry[] {
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendRun(logPath: string, entry: RunEntry): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const runs = loadRuns(logPath);
  runs.push(entry);
  fs.writeFileSync(logPath, JSON.stringify(runs, null, 2), 'utf8');
}

export function updateLastRunForTarget(
  logPath: string,
  targetPath: string,
  update: Partial<Pick<RunEntry, 'completedAt' | 'prUrl'>>
): void {
  const runs = loadRuns(logPath);
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].targetPath === targetPath) {
      runs[i] = { ...runs[i], ...update };
      fs.writeFileSync(logPath, JSON.stringify(runs, null, 2), 'utf8');
      return;
    }
  }
}
