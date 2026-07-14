// BL-143: coordinator-facing queue/intake visibility defaults to real
// .handoff payloads only - operational sidecar files (.chase.json, .nudge)
// are metadata, not work parcels, and dominating a queue view with them
// creates a false impression of pending/stuck work. This is observability
// filtering only: sidecars are never touched here, and chase/nudge logic
// (inboxChaser.ts scanInboxNew/scanInProcess, chase_sweep_lib.bb) keeps
// reading and writing them exactly as before.
import * as fs from 'fs';
import * as path from 'path';
import { scanInboxNew, scanInProcess } from './inboxChaser';

export type SidecarKind = 'chase-sidecar' | 'nudge-sidecar' | 'other';

export interface SidecarEntry {
  name: string;
  kind: SidecarKind;
}

function classifySidecar(name: string): SidecarKind {
  if (name.endsWith('.chase.json')) {
    return 'chase-sidecar';
  }
  if (name.endsWith('.nudge')) {
    return 'nudge-sidecar';
  }
  return 'other';
}

// Debug-mode-only: every non-.handoff entry in a dir, labeled by kind.
// Never called from the default (non-debug) path.
export function listSidecars(dir: string): SidecarEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => !name.endsWith('.handoff'))
    .map((name) => ({ name, kind: classifySidecar(name) }));
}

export interface RoleQueueView {
  role: string;
  /** Real .handoff payload file names still waiting in inbox/new/. */
  newPayloads: string[];
  /**
   * BL-323: real .handoff payload file names already CLAIMED into
   * inbox/in_process/ - kept SEPARATE from newPayloads (not flattened
   * together as before) so a caller can tell "nothing pending" (both
   * empty) apart from "something is claimed and nobody visibly owns it"
   * (in_process non-empty, new empty). A role whose agent was killed
   * mid-task looked identical to a genuinely idle one under the old
   * flattened count - exactly how a real ~4-hour stall went unnoticed
   * (BL-323's own incident report).
   */
  inProcessPayloads: string[];
  /** Populated only when debug is requested; empty otherwise. */
  sidecars: SidecarEntry[];
}

// BL-143 inbox-visibility-01/02/03: payloads always come from the same
// filtered scan inboxChaser.ts's chase/nudge logic already uses (no second,
// divergent definition of "real work"); sidecars are computed only when
// debug is true, so a default-mode caller never even lists sidecar files
// in the first place, not just hides them after the fact.
export function computeRoleQueueView(
  role: string,
  inboxNewDir: string,
  inProcessDir: string,
  debug: boolean
): RoleQueueView {
  const newPayloads = scanInboxNew(inboxNewDir).map((item) => path.basename(item.filePath));
  const inProcessPayloads = scanInProcess(inProcessDir).map((item) => path.basename(item.filePath));

  const sidecars = debug ? [...listSidecars(inboxNewDir), ...listSidecars(inProcessDir)] : [];

  return { role, newPayloads, inProcessPayloads, sidecars };
}
