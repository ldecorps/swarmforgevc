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

function supervisorIconStorePath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'supervisor-topic-icons.json');
}

function readSupervisorIconMap(targetPath: string): Record<string, string> {
  const file = supervisorIconStorePath(targetPath);
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

export function readSupervisorSwarmIconId(targetPath: string, threadId: string): string | undefined {
  return readSupervisorIconMap(targetPath)[threadId];
}

export function recordSupervisorSwarmIconId(targetPath: string, threadId: string, iconId: string): void {
  const map = readSupervisorIconMap(targetPath);
  map[threadId] = iconId;
  const file = supervisorIconStorePath(targetPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, `${JSON.stringify(map, null, 2)}\n`);
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
