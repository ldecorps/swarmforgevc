// BL-696: /pilot — Cursor agent staffs an offline expedition (wears pipeline
// hats). Distinct from /expedite, which spawns the automated claude -p driver.

import { normalizeExpediteTicket, readExpediteLock } from './telegramCursorBridgeExpedite';

/** Parse `/pilot` or `/pilot BL-696` (case-insensitive). */
export function parsePilotTicket(text: string, defaultTicket = 'BL-696'): string | undefined {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/pilot(?:\s+(\S+))?\s*$/i);
  if (!match) {
    return undefined;
  }
  return normalizeExpediteTicket(match[1], defaultTicket);
}

export function formatPilotStartMessage(ticket: string): string {
  return [
    `🧭 Pilot ${ticket} started.`,
    'This Cursor agent will wear the pipeline hats offline (no claude -p / expedite_cli).',
    'Progress posts and /update will reflect the run.',
  ].join('\n');
}

export function formatPilotBlockedByExpediteMessage(ticket: string, detail: string): string {
  return [
    `Cannot pilot ${ticket}: automated expedite is already running (${detail}).`,
    'Wait for it to finish, or stop it, before starting a Cursor-piloted run.',
  ].join('\n');
}

export type PilotGateResult = { ok: true } | { ok: false; detail: string };

/** Refuse to pilot while the automated expeditor holds the bridge lock. */
export function gatePilotAgainstExpediteLock(repoRoot: string): PilotGateResult {
  const lock = readExpediteLock(repoRoot);
  if (!lock) {
    return { ok: true };
  }
  return { ok: false, detail: `${lock.ticket} pid ${lock.pid}` };
}

/**
 * Prompt that puts the Cursor bridge agent into offline-expeditor mode for one
 * ticket. Intentionally does not invoke expedite_cli — the agent itself walks
 * the gates.
 */
export function composePilotExpeditorPrompt(ticket: string): string {
  const normalized = normalizeExpediteTicket(ticket) ?? ticket.toUpperCase();
  return [
    `You are staffing an OFFLINE EXPEDITION for ${normalized} (command: /pilot).`,
    '',
    'Mode: Cursor-as-expeditor. YOU wear every pipeline hat in turn. Do NOT spawn',
    '`expedite_cli.bb`, `expedite_with_progress.sh`, or `claude -p` stage runners.',
    '',
    'Isolation (same as BL-567):',
    '- Work only in `.worktrees/expedite-' + normalized + '` on branch `expedite/' + normalized + '`.',
    '- Do not use handoffd, mailboxes, tmux, rotate_to_role, ready_for_next, or the coordinator.',
    '- You MAY stop/start the swarm stack and park sibling active tickets to backlog/hold/.',
    '',
    'Stages (in order, skip any already done with evidence): specifier → coder →',
    'cleaner → architect → hardener → documenter → QA. For each stage: do the work,',
    'leave a verdict under `.swarmforge/expedite/' + normalized + '/NN-<role>/verdict.json`,',
    'and refresh `.swarmforge/expedite/' + normalized + '/progress.json` (include',
    '`"mode":"cursor-as-expeditor"`).',
    '',
    'When QA stamps the ticket, `git mv` it to backlog/done/ and write run.json.',
    'Restart of the swarm is optional and non-blocking — ask before restarting.',
    '',
    `Begin now with ${normalized}. Read the ticket YAML and current expedite artifacts first.`,
  ].join('\n');
}
