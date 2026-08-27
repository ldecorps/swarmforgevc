import * as fs from 'fs';
import * as path from 'path';

export const INPUT_LOG_FILENAME = '.swarmforge/input-log.jsonl';

export function appendInputEntry(targetPath: string, role: string, data: string): void {
  const logPath = path.join(targetPath, INPUT_LOG_FILENAME);
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), role, data });
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, entry + '\n', 'utf8');
  } catch {
    // errors logged by caller via output channel; do not interrupt keystroke delivery
  }
}
