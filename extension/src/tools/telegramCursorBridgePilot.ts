// BL-696: /pilot — Cursor agent staffs an offline expedition (wears pipeline
// hats). Distinct from /expedite, which spawns the automated claude -p driver.
// BL-699: prompt prefers quality over speed; bounce-backs first-class; human
// questions via Telegram poll on Cursor Remote.

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
 *
 * BL-699: prefer output quality over delivery speed; bounce-backs to earlier
 * roles are first-class (with rationale); human questions must use a Telegram
 * poll on Cursor Remote — never free-text-only.
 */
export function composePilotExpeditorPrompt(ticket: string): string {
  const normalized = normalizeExpediteTicket(ticket) ?? ticket.toUpperCase();
  return [
    `You are staffing an OFFLINE EXPEDITION for ${normalized} (command: /pilot).`,
    '',
    'Mode: Cursor-as-expeditor. YOU wear every pipeline hat in turn. Do NOT spawn',
    '`expedite_cli.bb`, `expedite_with_progress.sh`, or `claude -p` stage runners.',
    '',
    'Quality over speed: prefer correctness, evidence, and gate discipline over',
    'finishing quickly. Output quality beats delivery speed.',
    '',
    'Bounce-backs are first-class (native-swarm spirit): if a later hat finds a',
    'defect that belongs upstream, return to that earlier pipeline role, fix it,',
    'and re-walk downstream as needed — with a clear rationale. Do not treat',
    '"already past role N" as a reason to paper over defects. Do not rush to a',
    'QA stamp over fixing upstream defects.',
    '',
    'HUMAN QUESTIONS: if you (any hat) need a decision or answer from the human,',
    'you MUST ask with a native Telegram poll on the Cursor Remote topic. Clear',
    'question + discrete options. Wait for the vote. Do not rely on free-text-only',
    'asks.',
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
