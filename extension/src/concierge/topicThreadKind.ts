// BL-695: which Telegram threads may receive a git-tracked topic record.
// Fail closed: anything that is not a clear ticket id is never serialised
// into backlog/topics/. Supervisor (SUP-*) threads keep icon memory only
// under .swarmforge/ (untracked).
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

export type TopicThreadKind = 'ticket' | 'supervisor' | 'unbound';

const TICKET_ID = /^(?:BL|GH)-\d+$/i;
const SUPERVISOR_ID = /^SUP-\d+$/i;

export type UnboundThreadReporter = (threadId: string) => void;

export const reportUnboundThreadToStderr: UnboundThreadReporter = (threadId) => {
  process.stderr.write(
    `blTopicStore: unbound thread "${threadId}" — writing no tracked topic record (BL-695 fail-closed)\n`
  );
};

// BL-1210: a DIFFERENT event from the one above. That one fires whenever a
// non-ticket id is denied a git-tracked record, which is routine and
// correct. This one fires only when no store at all would hold the icon
// ownership marker - rare, and always alongside a 'refused' return value.
export const reportMarkerRefusedToStderr: UnboundThreadReporter = (threadId) => {
  process.stderr.write(
    `blTopicStore: thread "${threadId}" — no store will hold an icon ownership marker for this id (BL-1210)\n`
  );
};

export function classifyTopicThread(threadId: string): TopicThreadKind {
  if (TICKET_ID.test(threadId)) {
    return 'ticket';
  }
  if (SUPERVISOR_ID.test(threadId)) {
    return 'supervisor';
  }
  return 'unbound';
}

export function mayWriteTrackedTopicRecord(threadId: string): boolean {
  return classifyTopicThread(threadId) === 'ticket';
}

// BL-1210: the ownership marker's STORE depends on the id's kind; whether
// it is recorded at all does not. Supervisor and unbound ids each keep an
// untracked map under .swarmforge/ - two files rather than one, so a
// supervisor thread's memory keeps the exact filename BL-695 gave it and
// migration code that names it keeps working.
const SUPERVISOR_ICON_STORE = 'supervisor-topic-icons.json';
const UNBOUND_ICON_STORE = 'topic-icons.json';

function iconStorePath(targetPath: string, storeFile: string): string {
  return path.join(targetPath, '.swarmforge', storeFile);
}

function readIconMap(targetPath: string, storeFile: string): Record<string, string> {
  const file = iconStorePath(targetPath, storeFile);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // missing or corrupt — empty map
  }
  return {};
}

function recordIconInMap(targetPath: string, storeFile: string, threadId: string, iconId: string): void {
  const map = readIconMap(targetPath, storeFile);
  map[threadId] = iconId;
  const file = iconStorePath(targetPath, storeFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, `${JSON.stringify(map, null, 2)}\n`);
}

// BL-1210: the one id shape no store can key a marker by. A blank id names
// no topic, so it is REFUSED rather than silently written under an empty
// key - and the refusal is a value the caller handles (see
// blTopicStore's recordSwarmIconId), never only a line on stderr.
export function isStorableTopicId(threadId: string): boolean {
  return typeof threadId === 'string' && threadId.trim().length > 0;
}

export function readSupervisorSwarmIconId(targetPath: string, threadId: string): string | undefined {
  return readIconMap(targetPath, SUPERVISOR_ICON_STORE)[threadId];
}

export function recordSupervisorSwarmIconId(targetPath: string, threadId: string, iconId: string): void {
  recordIconInMap(targetPath, SUPERVISOR_ICON_STORE, threadId, iconId);
}

// BL-1210: epic, standing and role ids all classify 'unbound'. BL-695 gave
// them no store, so their markers were dropped and topicIcon.ts's
// "reused generically" ownership marker became inert for three of the four
// topic kinds. They share one untracked store; none of them may ever
// acquire a git-tracked record, which is BL-695's boundary, kept.
export function readUnboundSwarmIconId(targetPath: string, threadId: string): string | undefined {
  return readIconMap(targetPath, UNBOUND_ICON_STORE)[threadId];
}

export function recordUnboundSwarmIconId(targetPath: string, threadId: string, iconId: string): void {
  recordIconInMap(targetPath, UNBOUND_ICON_STORE, threadId, iconId);
}

function isSupervisorTopicFilename(name: string): boolean {
  return /^SUP-\d+\.json$/i.test(name);
}

function swarmIconIdFromRecord(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.swarmIconId === 'string' && parsed.swarmIconId) {
      return parsed.swarmIconId;
    }
  } catch {
    // corrupt — migrate nothing, still delete
  }
  return undefined;
}

function migrateOneSupervisorRecord(targetPath: string, topicsDirectory: string, name: string): string {
  const full = path.join(topicsDirectory, name);
  const id = name.replace(/\.json$/i, '');
  const iconId = swarmIconIdFromRecord(fs.readFileSync(full, 'utf8'));
  if (iconId !== undefined) {
    recordSupervisorSwarmIconId(targetPath, id, iconId);
  }
  fs.unlinkSync(full);
  return full;
}

/** Migrate icon markers from legacy tracked SUP-*.json records into the untracked store, then delete those files. */
export function retireTrackedSupervisorRecords(targetPath: string, topicsDirectory: string): string[] {
  if (!fs.existsSync(topicsDirectory)) {
    return [];
  }
  return fs
    .readdirSync(topicsDirectory)
    .filter(isSupervisorTopicFilename)
    .map((name) => migrateOneSupervisorRecord(targetPath, topicsDirectory, name));
}
