// BL-713 (slice A of BL-712): the seat's wire-format surface.
//
// Split out of cursorSeatProtocol.ts (BL-485 mutation-site advisory). This
// half is text serialisation/parsing and has no decision logic: the handoff
// draft builder (Article 2.2's plain `field: value` header lines), the
// `ready_for_next.sh` stdout parser, and the human-facing transcript
// renderer — an OUTPUT, never read back to decide anything.

import type { CursorIdentity, PackPosture } from './cursorIdentity';
import { identityKey } from './cursorIdentity';

// ── the handoff draft ─────────────────────────────────────────────────────

const COMMIT_PATTERN = /^[0-9a-f]{10}$/;
const PRIORITY_PATTERN = /^[0-9]{2}$/;

/**
 * Plain `field: value` header lines — Article 2.2. A JSON envelope is rejected
 * by the parser (every brace line reads as an unknown header), so this builds
 * text and never serialises an object.
 */
export function buildSeatHandoffDraft(opts: {
  to: string;
  priority: string;
  task: string;
  commit: string;
}): string {
  if (!opts.to.trim()) {
    throw new Error('handoff draft: "to" must name a role');
  }
  if (!opts.task.trim()) {
    throw new Error('handoff draft: "task" must carry the stable task name');
  }
  if (!PRIORITY_PATTERN.test(opts.priority)) {
    throw new Error(`handoff draft: "priority" must be two digits 00-99, got "${opts.priority}"`);
  }
  if (!COMMIT_PATTERN.test(opts.commit)) {
    throw new Error(`handoff draft: "commit" must be exactly 10 lowercase hex characters, got "${opts.commit}"`);
  }
  return [
    'type: git_handoff',
    `to: ${opts.to}`,
    `priority: ${opts.priority}`,
    `task: ${opts.task}`,
    `commit: ${opts.commit}`,
    '',
  ].join('\n');
}

// ── ready_for_next output ─────────────────────────────────────────────────

export interface ReadyForNextTask {
  status: 'task';
  file: string;
  from: string;
  type: string;
  priority: string;
  taskName?: string;
  payload: string;
}

export type ReadyForNextResult =
  | ReadyForNextTask
  | { status: 'no_task' }
  | { status: 'rotate_home'; homeRole?: string }
  | { status: 'draining' };

function headerValue(lines: string[], name: string): string | undefined {
  const prefix = `${name}: `;
  const line = lines.find((l) => l.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length).trim();
}

export function parseReadyForNextOutput(stdout: string): ReadyForNextResult {
  const lines = stdout.split('\n');
  const first = (lines[0] ?? '').trim();
  if (first === 'NO_TASK') {
    return { status: 'no_task' };
  }
  if (first === 'ROTATE_HOME') {
    return { status: 'rotate_home', homeRole: headerValue(lines, 'HOME_ROLE') };
  }
  if (first === 'DRAINING') {
    return { status: 'draining' };
  }
  const file = headerValue(lines, 'TASK');
  if (file === undefined) {
    return { status: 'no_task' };
  }
  const payloadIndex = lines.indexOf('PAYLOAD:');
  return {
    status: 'task',
    file,
    from: headerValue(lines, 'FROM') ?? 'unknown',
    type: headerValue(lines, 'TYPE') ?? 'unknown',
    priority: headerValue(lines, 'PRIORITY') ?? '50',
    taskName: headerValue(lines, 'TASK_NAME'),
    payload: payloadIndex === -1 ? '' : lines.slice(payloadIndex + 1).join('\n'),
  };
}

// ── the transcript (an OUTPUT, never an input) ────────────────────────────

export function renderTranscript(opts: {
  role: string;
  identity: CursorIdentity;
  posture: PackPosture;
  stamp: string;
  lines: string[];
}): string {
  return [
    `# Cursor seat transcript — ${opts.role}`,
    '',
    `- identity: ${identityKey(opts.identity)}`,
    `- pack posture: ${opts.posture}`,
    `- stamp: ${opts.stamp}`,
    '',
    '## Session',
    '',
    ...opts.lines,
    '',
  ].join('\n');
}
