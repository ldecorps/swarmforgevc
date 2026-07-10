// Shared by discoverySource.ts and rosterSource.ts: both read an
// operator-maintained JSON array catalog file, defensively - a missing or
// malformed file reads as "nothing here yet" (empty array), never an
// error, and each entry is validated independently so one bad entry
// doesn't sink the whole file.

import * as fs from 'fs';

export function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readJsonArrayFile<T>(filePath: string, isEntry: (value: unknown) => value is T): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isEntry);
}
