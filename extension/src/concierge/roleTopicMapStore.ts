// BL-425 slice 1: the machine-local, gitignored role->Telegram-topic-id map
// - one standing forum topic per swarm role (all 8), mirroring
// backlogTopicMapStore.ts's path/read/write shape. Unlike that map (which
// must be reverse-keyed, backlogId->topicId, because BL-297 needed the
// forward direction for its own routing), this one is keyed by role name
// directly - the role IS the stable, already-known key, so no reserved-
// subject indirection (telegramFrontDeskBotCore.ts's OPERATOR_SUBJECT_ID)
// is needed the way the single shared Operator topic needs one.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { keyForId } from '../util/inverseLookup';
import { PIPELINE_CHAIN } from '../swarm/rolePack';

// The coordinator sits outside PIPELINE_CHAIN's forward parcel chain (it is
// not a stage a parcel is handed to) but still gets its own steering topic
// per the ticket's "all 8 roles" - appended rather than duplicating the
// 7-role list a second time.
export const ALL_SWARM_ROLES: readonly string[] = [...PIPELINE_CHAIN, 'coordinator'];

export function roleTopicMapPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'role-topic-map.json');
}

export function readRoleTopicMap(targetPath: string): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(roleTopicMapPath(targetPath), 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

export function writeRoleTopicMap(targetPath: string, topicMap: Record<string, number>): void {
  atomicWrite(roleTopicMapPath(targetPath), JSON.stringify(topicMap));
}

// Pure: the inverse-lookup sibling of topicRouter.ts's backlogForTopic -
// given a topic id (an inbound message's message_thread_id), which role (if
// any) owns that topic. undefined topicId (a DM, no real Telegram topic)
// short-circuits to undefined - a role steering topic is never the DM
// default. Delegates to the shared keyForId (util/inverseLookup.ts) rather
// than re-carrying its own copy of the same 4-line body - jscpd flagged
// this and topicRouter.ts's backlogForTopic as an exact clone.
export function roleForTopic(topicMap: Record<string, number>, topicId: number | undefined): string | undefined {
  return keyForId(topicMap, topicId);
}
