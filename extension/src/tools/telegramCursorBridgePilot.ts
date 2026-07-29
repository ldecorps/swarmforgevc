// BL-696: /pilot — Cursor agent staffs an offline expedition (wears pipeline
// hats). Distinct from /expedite, which spawns the automated claude -p driver.
// BL-699: prompt prefers quality over speed; bounce-backs first-class; human
// questions via Telegram poll on Cursor Remote.
// BL-700: mandatory Telegram status posts on ticket / hat / bounce-back.
// BL-701: stage-boundary cleanup of orphan acceptance / Stryker leftovers.

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

/** BL-700: structured Cursor Remote post when the piloted ticket changes. */
export function formatPilotTicketChangeStatus(ticket: string, objectSummary: string): string {
  const summary = objectSummary.trim() || '(no title)';
  return `🧭 Pilot ticket: ${ticket} — ${summary}`;
}

/** BL-700: structured Cursor Remote post when the worn pipeline hat changes. */
export function formatPilotHatChangeStatus(role: string, stageJob: string): string {
  const job = stageJob.trim() || 'stage work';
  return `🎩 Pilot hat: ${role.trim()} — ${job}`;
}

/** BL-700: structured Cursor Remote post when bouncing to an earlier role. */
export function formatPilotBounceBackStatus(targetRole: string, reason: string): string {
  const why = reason.trim() || '(no reason given)';
  return `↩️ Pilot bounce-back → ${targetRole.trim()}: ${why}`;
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
 * BL-700: post structured Telegram status on ticket change, hat change, and
 * bounce-back (with reason); keep progress.json / SDK status secondary.
 * BL-701: at stage boundaries and run end, tear down orphan acceptance /
 * Stryker / disposable-tmp ancillaries from this expedition only.
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
    'TELEGRAM STATUS POSTS (mandatory on Cursor Remote — not only progress.json',
    'or playful SDK status):',
    '- Ticket change (start, switch, or handoff to another BL): post ticket id +',
    '  object (title / one-line purpose from YAML).',
    '- Hat / casquette change: post which role is now worn + brief stage job.',
    '- Bounce-back: post target role AND explicit reason (what failed / evidence).',
    'Optional: short posts when interesting non-vacuous scenarios appear.',
    '',
    'HUMAN QUESTIONS: if you (any hat) need a decision or answer from the human,',
    'you MUST ask with a native Telegram poll on the Cursor Remote topic. Clear',
    'question + discrete options. Wait for the vote. Do not rely on free-text-only',
    'asks.',
    '',
    'STAGE-BOUNDARY CLEANUP: after each stage and at run end, check and kill',
    'leftovers from THIS expedition before declaring the stage done or going',
    'long-idle — hung acceptance runners (`node --test`, `*.generated.test.js`,',
    'cucumber under disposable roots), leftover Stryker / mutation jobs, and',
    'related fixture babysitter / bridge processes under `/tmp/tmp.*` spawned for',
    'the run. Do NOT kill the host Cursor Remote bridge, Operator, or live-window',
    'host processes. Do not rely solely on the host orphan janitor (~2h reap).',
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

/** BL-703: specifier-only wake; drain-stop when specifier would hand off to coder. */
export function composeHydratePrompt(target: string, mode: 'hydrate' | 'mint' = 'hydrate'): string {
  const label = mode === 'mint' ? '/mint' : '/hydrate';
  return [
    `You are running ${label} for target ${target}.`,
    '',
    'Goal: wake ONLY the specifier (plus daemons handoff needs). Spec or mint the',
    'intake / underspecced ticket. When the specifier would git_handoff to coder,',
    'STOP — drain-stop the swarm immediately. Never start the coder session.',
    '',
    'Refuse if any non-specifier pipeline role is already up.',
    'Post Telegram status on Cursor Remote for start and stop.',
    '',
    `Begin ${label} for ${target} now.`,
  ].join('\n');
}

export function formatPilotBlockedBySwarmLiveMessage(ticket: string, detail: string): string {
  return [
    `Cannot pilot ${ticket}: swarm is live (${detail}).`,
    'Clear with /drain-swarm or /stop, or confirm Stop & run to drain-stop then pilot.',
  ].join('\n');
}

export function landSleepButtons(): Array<Array<{ text: string; callbackData: string }>> {
  return [
    [
      { text: 'Drain-stop', callbackData: 'op:land-sleep:yes' },
      { text: 'Leave up', callbackData: 'op:land-sleep:no' },
    ],
  ];
}
