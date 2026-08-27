// BL-744: pure topic-id merge helpers for Bubble talk mirror routing.
import * as fs from 'fs';
import * as path from 'path';
import {
  bubbleTopicIdFromMap,
  cursorBridgeTopicIdFromMap,
  parseCursorBridgeState,
} from '../tools/telegramCursorBridgeCore';

const CURSOR_BRIDGE_STATE_FILE = 'cursor-bridge-state.json';
const CURSOR_BRIDGE_TOPIC_MAP_FILE = 'cursor-bridge-topic-map.json';

export interface CursorBridgeTopicIds {
  cursorTopicId?: number;
  bubbleTopicId?: number;
}

export function mergeTopicId(
  preferred: number | undefined,
  fallback: number | undefined
): number | undefined {
  return typeof preferred === 'number' && Number.isFinite(preferred) && preferred > 0
    ? preferred
    : fallback;
}

function topicIdsFromStateFile(statePath: string): CursorBridgeTopicIds {
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    const state = parseCursorBridgeState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
    return {
      cursorTopicId: state.cursorTopicId,
      bubbleTopicId: state.bubbleTopicId,
    };
  } catch {
    return {};
  }
}

function topicIdsFromMapFile(mapPath: string, stateIds: CursorBridgeTopicIds): CursorBridgeTopicIds {
  if (!fs.existsSync(mapPath)) {
    return stateIds;
  }
  try {
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as Record<string, string>;
    return {
      cursorTopicId: mergeTopicId(stateIds.cursorTopicId, cursorBridgeTopicIdFromMap(map)),
      bubbleTopicId: mergeTopicId(stateIds.bubbleTopicId, bubbleTopicIdFromMap(map)),
    };
  } catch {
    return stateIds;
  }
}

export function readCursorBridgeTopicIds(targetPath: string): CursorBridgeTopicIds {
  const operatorDir = path.join(targetPath, '.swarmforge', 'operator');
  const stateIds = topicIdsFromStateFile(path.join(operatorDir, CURSOR_BRIDGE_STATE_FILE));
  return topicIdsFromMapFile(path.join(operatorDir, CURSOR_BRIDGE_TOPIC_MAP_FILE), stateIds);
}

/** Prefer the dedicated Bubble topic; never dump ordinary talk onto Cursor Remote. */
export function effectiveBubbleMirrorTopicId(topicIds: CursorBridgeTopicIds): number | undefined {
  if (topicIds.bubbleTopicId === undefined) {
    return undefined;
  }
  return topicIds.bubbleTopicId === topicIds.cursorTopicId ? undefined : topicIds.bubbleTopicId;
}

export function bubbleMirrorTopicForPath(targetPath: string): number | undefined {
  return effectiveBubbleMirrorTopicId(readCursorBridgeTopicIds(targetPath));
}
