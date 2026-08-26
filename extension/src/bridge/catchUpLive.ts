// BL-545: pure catch-up queue builder — collects unread outbound (agent)
// messages across all backlog/topics/*.json records for the Telegram Mini App
// pager. No I/O here; callers pass topic records and read-state in.
import * as fs from 'fs';
import * as path from 'path';
import { TopicRecord, topicsDir, readRecord } from '../concierge/blTopicStore';
import {
  AGENT_QUESTIONS_SUBJECT_ID,
  AGENT_QUESTIONS_TOPIC_NAME,
  APPROVALS_SUBJECT_ID,
  APPROVALS_TOPIC_NAME,
  BACKLOG_SUBJECT_ID,
  BACKLOG_TOPIC_NAME,
  BABYSITTER_SUBJECT_ID,
  BABYSITTER_TOPIC_NAME,
  CONTROL_SUBJECT_ID,
  CONTROL_TOPIC_NAME,
  OPERATOR_SUBJECT_ID,
  OPERATOR_TOPIC_NAME,
  RECERT_SUBJECT_ID,
  RECERT_TOPIC_NAME,
  RESIDENT_SPY_SUBJECT_ID,
  RESIDENT_SPY_TOPIC_NAME,
} from '../tools/telegramFrontDeskBotCore';
import { CatchUpReadState, isMessageRead } from './catchUpReadState';

export interface CatchUpMessage {
  topicId: string;
  topicLabel: string;
  seq: number;
  author: string;
  text: string;
  ts: number;
  agoLabel: string;
}

export interface CatchUpState {
  items: CatchUpMessage[];
  total: number;
}

const STANDING_TOPIC_LABELS: Record<string, string> = {
  [OPERATOR_SUBJECT_ID]: OPERATOR_TOPIC_NAME,
  [APPROVALS_SUBJECT_ID]: APPROVALS_TOPIC_NAME,
  [RECERT_SUBJECT_ID]: RECERT_TOPIC_NAME,
  [AGENT_QUESTIONS_SUBJECT_ID]: AGENT_QUESTIONS_TOPIC_NAME,
  [BACKLOG_SUBJECT_ID]: BACKLOG_TOPIC_NAME,
  [CONTROL_SUBJECT_ID]: CONTROL_TOPIC_NAME,
  [BABYSITTER_SUBJECT_ID]: BABYSITTER_TOPIC_NAME,
  [RESIDENT_SPY_SUBJECT_ID]: RESIDENT_SPY_TOPIC_NAME,
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

export function topicLabelForId(topicId: string): string {
  const standing = STANDING_TOPIC_LABELS[topicId];
  if (standing) {
    return standing;
  }
  if (/^BL-\d+$/.test(topicId)) {
    return topicId;
  }
  return topicId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatAgoLabel(ts: number, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - ts);
  if (elapsed < MINUTE_MS) {
    return 'just now';
  }
  if (elapsed < HOUR_MS) {
    return `${Math.max(1, Math.floor(elapsed / MINUTE_MS))}m ago`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.max(1, Math.floor(elapsed / HOUR_MS))}h ago`;
  }
  if (elapsed < 3 * DAY_MS) {
    return `${Math.max(1, Math.floor(elapsed / DAY_MS))}d ago`;
  }
  return '3d+ ago';
}

export function collectUnreadFromRecord(
  record: TopicRecord,
  readState: CatchUpReadState,
  nowMs: number
): CatchUpMessage[] {
  const topicLabel = topicLabelForId(record.id);
  const unread: CatchUpMessage[] = [];
  for (const message of record.messages) {
    if (message.type !== 'outbound') {
      continue;
    }
    if (isMessageRead(readState, record.id, message.seq)) {
      continue;
    }
    unread.push({
      topicId: record.id,
      topicLabel,
      seq: message.seq,
      author: message.author,
      text: message.text,
      ts: message.ts,
      agoLabel: formatAgoLabel(message.ts, nowMs),
    });
  }
  return unread;
}

// Pure: merge unread messages from many topic records, oldest-first.
export function buildCatchUpQueue(records: TopicRecord[], readState: CatchUpReadState, nowMs: number): CatchUpMessage[] {
  const items = records.flatMap((record) => collectUnreadFromRecord(record, readState, nowMs));
  items.sort((a, b) => {
    if (a.ts !== b.ts) {
      return a.ts - b.ts;
    }
    if (a.topicId !== b.topicId) {
      return a.topicId.localeCompare(b.topicId);
    }
    return a.seq - b.seq;
  });
  return items;
}

export function buildCatchUpState(records: TopicRecord[], readState: CatchUpReadState, nowMs: number): CatchUpState {
  const items = buildCatchUpQueue(records, readState, nowMs);
  return { items, total: items.length };
}

function listTopicIds(targetPath: string): string[] {
  const dir = topicsDir(targetPath);
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length));
  } catch {
    return [];
  }
}

export function loadAllTopicRecords(targetPath: string): TopicRecord[] {
  return listTopicIds(targetPath).map((id) => readRecord(targetPath, id));
}

export function computeCatchUpStateLive(targetPath: string, readState: CatchUpReadState, nowMs?: number): CatchUpState {
  const records = loadAllTopicRecords(targetPath);
  return buildCatchUpState(records, readState, nowMs ?? Date.now());
}
