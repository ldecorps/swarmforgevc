// BL-696: /pilot — Cursor agent staffs an offline expedition (wears pipeline
// hats). Distinct from /expedite, which spawns the automated claude -p driver.
// BL-699: prompt prefers quality over speed; bounce-backs first-class; human
// questions via Telegram poll on Cursor Remote.
// BL-700: mandatory Telegram status posts on ticket / hat / bounce-back.
// BL-701: stage-boundary cleanup of orphan acceptance / Stryker leftovers.
// BL-727: landing runs through the acceptance-contract gate CLI
// (pilot-acceptance-gate.ts) instead of a bare `git mv` - the gate refuses
// the land unless the ticket's own declared acceptance contract just ran
// green.

import { normalizeExpediteTicket, readExpediteLock } from './telegramCursorBridgeExpedite';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/** Parse `/pilot` or `/pilot BL-696` (case-insensitive). */
export function parsePilotTicket(text: string, defaultTicket = 'BL-696'): string | undefined {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/pilot(?:\s+(\S+))?\s*$/i);
  if (!match) {
    return undefined;
  }
  return normalizeExpediteTicket(match[1], defaultTicket);
}

export type PilotSafeCommand = { kind: 'start' } | { kind: 'list' };

// BL-792: pilotSafeDefects.test.js already specified this parser's full
// contract (BL-722's own test, landed ahead of this piece of BL-722's
// wiring) but the function itself was never added, so every run since has
// failed on a plain missing-export TypeError - not a behavior regression.
// Scoped to exactly what that test asserts; dispatching a real incoming
// `/pilot safe` command to listSafePilotDefects/pickSafePilotDefect stays
// BL-722's own wiring work, not part of this fix.
/** Parse `/pilot safe`, `/pilot safe --list`, `/pilot safe list` (case-insensitive). */
export function parsePilotSafeCommand(text: string): PilotSafeCommand | undefined {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/pilot\s+safe(?:\s+(--list|list))?\s*$/i);
  if (!match) {
    return undefined;
  }
  return match[1] ? { kind: 'list' } : { kind: 'start' };
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
 * BL-749: cleaner/hardener/architect hats must trace CALL SITES before
 * downgrading a ticket's own guardrail gap to a non-blocking nit.
 * BL-753: an unreachable acceptance step handler is an untested-behavior
 * flag until the claim question is answered — never a cosmetic dead-code nit.
 * BL-755: a multi-branch parser needs one distinct test per arm.
 * BL-751: a new arm added to an existing multi-branch dispatch must be
 * diffed against its siblings' shared gating pattern before pass.
 * BL-758: per-hat reinject of live swarmforge/roles/<role>.prompt — not a
 * mega-brief that only says "wear every hat".
 */
export function rolePromptRelativePath(role: string): string {
  const normalized = role.trim().toLowerCase();
  const basename = normalized === 'qa' ? 'QA.prompt' : `${normalized}.prompt`;
  return path.join('swarmforge', 'roles', basename);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export type ComposePilotStagePromptDeps = {
  readRolePrompt?: (role: string) => string | undefined;
  packOverlayFragment?: string;
};

function defaultReadRolePrompt(role: string, repoRoot: string): string | undefined {
  const rel = rolePromptRelativePath(role);
  const abs = path.join(repoRoot, rel);
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
}

function thinPilotIsolationWrapper(ticket: string): string {
  const normalized = normalizeExpediteTicket(ticket) ?? ticket.toUpperCase();
  return [
    `PILOT STAGE WRAPPER for ${normalized} (thin isolation — does not replace role duties):`,
    `- Work only in \`.worktrees/expedite-${normalized}\` on branch \`expedite/${normalized}\`.`,
    '- Do not use handoffd, mailboxes, tmux, rotate_to_role, ready_for_next, or the coordinator.',
    '- Telegram status posts on ticket / hat / bounce-back remain mandatory (BL-700).',
    '- Stage-boundary cleanup of this expedition\'s orphans remains mandatory (BL-701).',
    `- Land only via \`node extension/out/tools/pilot-acceptance-gate.js ${normalized}\`.`,
    '- On hat change and bounce-back: resetAgent (or equivalent) then reinject composePilotStagePrompt for the new role — never rely on the start mega-brief alone.',
  ].join('\n');
}

/**
 * BL-758: compose the active system context for one pilot hat — thin isolation
 * wrapper + full live role prompt bytes (+ optional pack overlay).
 */
export function composePilotStagePrompt(
  ticket: string,
  role: string,
  deps: ComposePilotStagePromptDeps = {},
  repoRoot: string = process.cwd()
): string {
  const roleBody =
    deps.readRolePrompt?.(role) ?? defaultReadRolePrompt(role, repoRoot) ?? `(missing role prompt for ${role})`;
  const overlay = (deps.packOverlayFragment || '').trim();
  const parts = [thinPilotIsolationWrapper(ticket), '', `=== LIVE ROLE PROMPT (${rolePromptRelativePath(role)}) ===`, roleBody];
  if (overlay) {
    parts.push('', '=== PACK / PROFILE OVERLAY ===', overlay);
  }
  return parts.join('\n');
}

export function composePilotExpeditorPrompt(ticket: string): string {
  const normalized = normalizeExpediteTicket(ticket) ?? ticket.toUpperCase();
  return [
    `You are staffing an OFFLINE EXPEDITION for ${normalized} (command: /pilot).`,
    '',
    'Mode: Cursor-as-expeditor. Do NOT spawn `expedite_cli.bb`,',
    '`expedite_with_progress.sh`, or `claude -p` stage runners.',
    '',
    'PER-HAT REINJECT (BL-758 — mandatory): at each hat change and bounce-back,',
    'resetAgent (or equivalent session boundary) then inject',
    '`composePilotStagePrompt(ticket, role)` — the thin pilot isolation wrapper',
    'PLUS the full live `swarmforge/roles/<role>.prompt` bytes (QA → QA.prompt),',
    'plus pack overlay when configured. Do NOT wear every pipeline hat from one',
    'mega-brief alone. Do NOT merely remind yourself of the role name or ask',
    'yourself to "read" the prompt file without reinjecting its contents.',
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
    'TELEGRAM STATUS POSTS (mandatory on Host — not only progress.json',
    'or playful SDK status):',
    '- Ticket change (start, switch, or handoff to another BL): post ticket id +',
    '  object (title / one-line purpose from YAML).',
    '- Hat / casquette change: post which role is now worn + brief stage job.',
    '- Bounce-back: post target role AND explicit reason (what failed / evidence).',
    'Optional: short posts when interesting non-vacuous scenarios appear.',
    '',
    'HUMAN QUESTIONS: if you (any hat) need a decision or answer from the human,',
    'you MUST ask with a native Telegram poll on the Host topic. Clear',
    'question + discrete options. Wait for the vote. Do not rely on free-text-only',
    'asks. EVERY poll MUST include one extra option meaning the human needs more',
    'context before they can answer — label it exactly: "Need more detail". If',
    'that option wins, post a richer brief (or fewer sharper polls) and ask again;',
    'do not treat silence as consent.',
    '',
    'STAGE-BOUNDARY CLEANUP: after each stage and at run end, check and kill',
    'leftovers from THIS expedition before declaring the stage done or going',
    'long-idle — hung acceptance runners (`node --test`, `*.generated.test.js`,',
    'cucumber under disposable roots), leftover Stryker / mutation jobs, and',
    'related fixture babysitter / bridge processes under `/tmp/tmp.*` spawned for',
    'the run. Do NOT kill the Host bridge, Operator, or live-window',
    'host processes. Do not rely solely on the host orphan janitor (~2h reap).',
    '',
    'REVIEW HATS (cleaner / hardener / architect during /pilot) — BL-749:',
    'A gap against the ticket\'s OWN explicit guardrail claim is never a',
    'non-blocking nit until you have read the CALL SITE (not only the',
    'function in isolation) and confirmed whether the guardrail is actually',
    'upheld downstream. Call-site tracing before nit-downgrade is mandatory.',
    '',
    'REVIEW HATS (cleaner / hardener / architect during /pilot) — BL-753:',
    'A registered acceptance step handler whose pattern matches no rendered',
    'feature step is an untested-behavior flag until you answer: what claim',
    'was this step meant to verify, and is that claim tested any other way?',
    'Do not dismiss it as cosmetic dead code.',
    '',
    'REVIEW HATS (hardener during /pilot) — BL-755:',
    'A multi-branch parser (cond / case / if-else with ≥3 arms) needs one',
    'distinct test per arm before pass — not only the branch the ticket',
    'narrates. Untested arms are untested-parser-branch defects.',
    '',
    'REVIEW HATS (hardener during /pilot) — BL-751:',
    'A new arm added to an existing multi-branch dispatch (cond / case /',
    'if-else) whose other arms already share a gating pattern (a timeout,',
    'grace period, or guard condition applied uniformly) must be diffed',
    'against those siblings before pass. A shared pattern silently dropped',
    'on the new arm is a defect candidate, not a style nit — flag it for an',
    'explicit decision (follow the pattern or document the deviation).',
    '',
    'Isolation (same as BL-567):',
    '- Work only in `.worktrees/expedite-' + normalized + '` on branch `expedite/' + normalized + '`.',
    '- Do not use handoffd, mailboxes, tmux, rotate_to_role, ready_for_next, or the coordinator.',
    '- You MAY stop/start the swarm stack and park sibling active tickets to backlog/hold/.',
    '',
    'Stages (in order, skip any already done with evidence): specifier → coder →',
    'cleaner → architect → hardener → documenter → QA. For each stage: reinject',
    'that role\'s live prompt via composePilotStagePrompt, do the work, leave a',
    'verdict under `.swarmforge/expedite/' + normalized + '/NN-<role>/verdict.json`',
    '(include `role_prompt_path` + `role_prompt_sha256` of the injected bytes),',
    'and refresh `.swarmforge/expedite/' + normalized + '/progress.json` (include',
    '`"mode":"cursor-as-expeditor"`).',
    '',
    'When QA stamps the ticket, land it by running',
    '`node extension/out/tools/pilot-acceptance-gate.js ' + normalized + '`',
    '— this is the ONLY landing path. It runs the ticket\'s own declared',
    'acceptance contract and moves the yaml to backlog/done/ only on a green',
    'result, refusing (and writing nothing) otherwise; never `git mv` the',
    'yaml directly. Then write run.json.',
    'Restart of the swarm is optional and non-blocking — ask before restarting.',
    '',
    `Begin now with ${normalized}: composePilotStagePrompt for the first required`,
    'hat (usually specifier), reinject, then read the ticket YAML and expedite artifacts.',
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
    'Post Telegram status on Host for start and stop.',
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
