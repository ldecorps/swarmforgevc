// BL-698: shared ambulance marker I/O for Cursor Remote and Control.
// Shape matches ambulance_lib.bb / Control engageAmbulance
// ({active, ticket, engagedAtMs, by}).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { lookupBacklogItemById } from '../panel/backlogReader';

export function controlAmbulanceStatePath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'control-ambulance.json');
}

type RawAmbulanceMarker =
  | { active: true; ticket?: string; engagedAtMs?: number; by?: string }
  | { active: false }
  | undefined;

function atomicWrite(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readRawAmbulanceMarker(repoRoot: string): RawAmbulanceMarker {
  try {
    return JSON.parse(fs.readFileSync(controlAmbulanceStatePath(repoRoot), 'utf8')) as RawAmbulanceMarker;
  } catch {
    return undefined;
  }
}

export function engageOperatorAmbulance(
  repoRoot: string,
  ticket: string,
  nowMs: number = Date.now()
): { ok: boolean; text: string } {
  const id = ticket.trim().toUpperCase();
  if (!/^BL-\d+$/i.test(id)) {
    return { ok: false, text: `ambulance: need BL-xxx (got ${ticket || '(empty)'}).` };
  }
  if (!lookupBacklogItemById(repoRoot, id)) {
    return {
      ok: false,
      text: `Ambulance refused for ${id} - no YAML file for it anywhere under backlog/ (would hold everything forever).`,
    };
  }
  const raw = readRawAmbulanceMarker(repoRoot);
  if (!(raw?.active && raw.ticket === id)) {
    atomicWrite(
      controlAmbulanceStatePath(repoRoot),
      JSON.stringify({ active: true, ticket: id, engagedAtMs: nowMs, by: 'telegram' })
    );
  }
  return {
    ok: true,
    text: `Ambulance engaged for ${id} - only its parcels move now; everything else queues in place, untouched.`,
  };
}

export function releaseOperatorAmbulance(repoRoot: string): { ok: boolean; text: string } {
  const raw = readRawAmbulanceMarker(repoRoot);
  if (raw?.active) {
    atomicWrite(controlAmbulanceStatePath(repoRoot), JSON.stringify({ active: false }));
  }
  return { ok: true, text: 'Ambulance released - every held parcel resumes moving.' };
}
