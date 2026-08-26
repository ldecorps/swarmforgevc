// BL-593: append-only IO for .swarmforge/telemetry/mutation-runs.jsonl.

import * as fs from 'fs';
import * as path from 'path';
import { MutationRunRecord } from './mutationRunTelemetry';

export function defaultMutationRunsLogPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'telemetry', 'mutation-runs.jsonl');
}

export function appendMutationRunRecord(filePath: string, record: MutationRunRecord): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

export function readMutationRunRecords(filePath: string): MutationRunRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MutationRunRecord);
}
