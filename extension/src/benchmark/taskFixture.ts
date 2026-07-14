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

// BL-386: a battery is every task subdirectory under batteryRoot (each
// carrying its own task.json, loaded via loadTaskSpec above) - sorted by
// directory name for a deterministic run order, never directory-listing
// order (which is not guaranteed across platforms).
export function loadTaskBattery(batteryRoot: string): TaskSpec[] {
  return fs
    .readdirSync(batteryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => loadTaskSpec(path.join(batteryRoot, name)));
}

// BL-386: a task's OWN known-correct solution, kept as a `reference/`
// subtree inside its fixture dir mirroring the paths a real solution
// would occupy (e.g. `reference/src/wordFrequency.js` overlays `src/
// wordFrequency.js`) - never given to a model, only used to validate a
// task fixture is actually solvable before any model is scored against it
// (taskSoundness.ts).
export function referenceSolutionDir(task: TaskSpec): string {
  return path.join(task.fixtureDir, 'reference');
}

export function hasReferenceSolution(task: TaskSpec): boolean {
  return fs.existsSync(referenceSolutionDir(task));
}

// Overlays the reference solution onto an already-materialized fixture
// copy (never the pinned fixtureDir itself) - a plain recursive copy, so
// the reference tree's own relative paths decide what gets overwritten.
export function overlayReferenceSolution(task: TaskSpec, materializedDir: string): void {
  fs.cpSync(referenceSolutionDir(task), materializedDir, { recursive: true });
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
