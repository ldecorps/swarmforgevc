// BL-744: persisted choice-poll append for Bubble talk mirror.
import * as fs from 'fs';
import * as path from 'path';

const CURSOR_BRIDGE_STATE_FILE = 'cursor-bridge-state.json';

export interface LetsTalkChoicePollSpec {
  question: string;
  options: string[];
}

export function readCursorBridgeStateRecord(targetPath: string): Record<string, unknown> {
  const statePath = path.join(targetPath, '.swarmforge', 'operator', CURSOR_BRIDGE_STATE_FILE);
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return {};
}

export function appendPendingChoicePoll(
  targetPath: string,
  pollId: string,
  spec: LetsTalkChoicePollSpec,
  originTopicId: number
): void {
  const statePath = path.join(targetPath, '.swarmforge', 'operator', CURSOR_BRIDGE_STATE_FILE);
  const raw = readCursorBridgeStateRecord(targetPath);
  const existing = Array.isArray(raw.pendingChoicePolls) ? raw.pendingChoicePolls : [];
  const next = [...existing, { pollId, question: spec.question, options: spec.options, createdAtMs: Date.now(), originTopicId }].slice(-20);
  raw.pendingChoicePolls = next;
  fs.writeFileSync(statePath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
}
