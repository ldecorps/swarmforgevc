import * as fs from 'fs';

export interface RunEntry {
  name: string;
  targetPath: string;
  startedAt: string;
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
  const runs = loadRuns(logPath);
  runs.push(entry);
  fs.writeFileSync(logPath, JSON.stringify(runs, null, 2), 'utf8');
}
