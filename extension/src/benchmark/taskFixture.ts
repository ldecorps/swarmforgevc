import * as fs from 'fs';
import * as path from 'path';
import { TaskSpec } from './types';

interface TaskConfigFile {
  id: string;
  promptFile: string;
  testFile: string;
}

export function loadTaskSpec(fixtureDir: string): TaskSpec {
  const configPath = path.join(fixtureDir, 'task.json');
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as TaskConfigFile;
  return { id: parsed.id, fixtureDir, promptFile: parsed.promptFile, testFile: parsed.testFile };
}

export function loadTaskPrompt(task: TaskSpec): string {
  return fs.readFileSync(path.join(task.fixtureDir, task.promptFile), 'utf8');
}

// Materializes a fresh, independent copy of the pinned fixture tree so
// every trial - every model, every repetition - starts from byte-identical
// state (acceptance scenario 01), and one trial's edits can never leak
// into another's.
export function materializeTaskFixture(task: TaskSpec, scratchRoot: string): string {
  fs.mkdirSync(scratchRoot, { recursive: true });
  const dest = fs.mkdtempSync(path.join(scratchRoot, 'trial-'));
  fs.cpSync(task.fixtureDir, dest, { recursive: true });
  return dest;
}
