// BL-493: the machine-local, gitignored per-ticket edit-in-place message
// identity store - keyed ticket-id -> EditInPlaceMessageState, so a later
// lifecycle transition edits the SAME status message instead of posting a
// new one. Stores the FULL EditInPlaceMessageState (including renderedText,
// not just {topicId, messageId}) - syncEditInPlaceMessage's own
// skip-unchanged change-gate compares the next tick's text against
// renderedText, so dropping it here would silently defeat that gate on
// every restart/re-read, re-editing an already-correct message every tick.
// Modeled on backlogTopicMapStore.ts (read+write+atomicWrite), the closest
// existing sibling that is also read AND written by the swarm itself
// (epicTopicMapStore.ts, by contrast, is a human-authored, swarm-read-only
// input).
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { EditInPlaceMessageState } from './editInPlaceMessageSync';

export type TicketMessageMap = Record<string, EditInPlaceMessageState>;

export function ticketMessageMapPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'ticket-message-map.json');
}

export function readTicketMessageMap(targetPath: string): TicketMessageMap {
  try {
    return JSON.parse(fs.readFileSync(ticketMessageMapPath(targetPath), 'utf8')) as TicketMessageMap;
  } catch {
    return {};
  }
}

export function writeTicketMessageMap(targetPath: string, map: TicketMessageMap): void {
  atomicWrite(ticketMessageMapPath(targetPath), JSON.stringify(map));
}

// Read-modify-write a single ticket's entry - mirrors
// backlogTopicMapStore.ts's own dropBacklogTopicMapping shape, SET instead
// of delete.
export function writeTicketMessageEntry(targetPath: string, backlogId: string, entry: EditInPlaceMessageState): void {
  const map = readTicketMessageMap(targetPath);
  map[backlogId] = entry;
  writeTicketMessageMap(targetPath, map);
}
