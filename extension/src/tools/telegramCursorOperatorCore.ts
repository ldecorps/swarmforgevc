// BL-702: pure danger-tier + confirm decision helpers for the Cursor Remote
// operator surface (slice 1 of BL-698). Twin of telegramControlCore's
// ignore|refuse|prompt|execute shape; Live wiring owns I/O.

export type OperatorDangerTier = 'read' | 'soft' | 'hard';

export type PendingOperatorConfirm =
  | { tier: 'soft' | 'hard'; verb: string; args?: string }
  | undefined;

/** Soft verbs need one Confirm tap (BL-698 Q1). Hard verbs need two-step confirm. */
const SOFT_VERBS = new Set([
  '/pause',
  '/resume',
  '/hold',
  '/reinstate',
  '/syncenv',
  '/compile',
  '/pull',
  '/quiet',
  '/redeploy',
]);

const HARD_VERBS = new Set([
  '/stop',
  '/start',
  '/restart',
  '/bounce',
  '/drain-agents',
  '/drain-swarm',
  '/ensure',
  '/ambulance',
  '/kill-all',
  '/hydrate',
  '/mint',
  '/autopilot',
  '/land',
]);

const READ_VERBS = new Set([
  '/status',
  '/update',
  '/log',
  '/doctor',
  '/tunnel',
  '/help',
  '/confirm-off',
]);

export const OPERATOR_CALLBACK_PREFIX = 'op:';

export const OPERATOR_CALLBACK_DATA = {
  confirm: 'op:confirm',
  cancel: 'op:cancel',
  stopDrain: 'op:stop-drain',
  stopEmergency: 'op:stop-emergency',
} as const;

export const OPERATOR_CALLBACK_PREFIXES = {
  stopAndRun: 'op:stop-and-run:',
  runAnyway: 'op:run-anyway:',
  landSleep: 'op:land-sleep:',
} as const;

export function operatorDangerTier(verb: string): OperatorDangerTier | undefined {
  const parts = verb.trim().toLowerCase().split(/\s+/);
  const base = parts[0] ?? '';
  const rest = parts.slice(1).join(' ');
  // BL-703: dry variants list only — no confirm.
  if ((base === '/autopilot' || base === '/land') && rest.startsWith('dry')) {
    return 'read';
  }
  if (READ_VERBS.has(base)) {
    return 'read';
  }
  if (SOFT_VERBS.has(base)) {
    return 'soft';
  }
  if (HARD_VERBS.has(base) || base.startsWith('/bounce')) {
    return 'hard';
  }
  // /shift status and /holiday list are read; other shift/holiday mutate (BL-704).
  if (base === '/shift' || base === '/holiday' || base === '/oncall') {
    if (base === '/shift' && rest.startsWith('status')) {
      return 'read';
    }
    if (base === '/holiday' && rest.startsWith('list')) {
      return 'read';
    }
    return 'soft';
  }
  return undefined;
}

export type OperatorConfirmDecision =
  | { action: 'ignore' }
  | { action: 'execute'; verb: string; args?: string }
  | { action: 'prompt-confirm'; tier: 'soft' | 'hard'; verb: string; args?: string }
  | { action: 'clear-pending' }
  | { action: 'cancel-pending' };

/**
 * Given a slash verb (already principal+topic gated), decide whether to
 * prompt, execute immediately (read), clear pending, or ignore.
 */
export function decideOperatorVerbConfirm(
  text: string,
  pending: PendingOperatorConfirm
): OperatorConfirmDecision {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (lower === '/confirm-off') {
    return pending ? { action: 'clear-pending' } : { action: 'ignore' };
  }

  const parts = trimmed.split(/\s+/);
  const verb = (parts[0] ?? '').toLowerCase();
  const args = parts.slice(1).join(' ') || undefined;
  const tier = operatorDangerTier(`${verb}${args ? ` ${args}` : ''}`);
  if (!tier) {
    return { action: 'ignore' };
  }
  if (tier === 'read') {
    return { action: 'execute', verb, args };
  }
  return { action: 'prompt-confirm', tier, verb, args };
}

export type OperatorSpecialCallbackDecision =
  | { action: 'ignore' }
  | { action: 'cancel-pending' }
  | { action: 'stop-and-run'; verb: string; args?: string }
  | { action: 'run-anyway'; verb: string; args?: string }
  | { action: 'land-sleep'; answer: 'yes' | 'no' }
  | { action: 'stop-mode'; mode: 'drain' | 'emergency' };

/** Parse Stop & run / Run anyway / land-sleep / stop-mode callback payloads. */
export function decideOperatorSpecialCallback(callbackData: string): OperatorSpecialCallbackDecision {
  if (callbackData === OPERATOR_CALLBACK_DATA.cancel) {
    return { action: 'cancel-pending' };
  }
  if (callbackData === OPERATOR_CALLBACK_DATA.stopDrain) {
    return { action: 'stop-mode', mode: 'drain' };
  }
  if (callbackData === OPERATOR_CALLBACK_DATA.stopEmergency) {
    return { action: 'stop-mode', mode: 'emergency' };
  }
  if (callbackData.startsWith(OPERATOR_CALLBACK_PREFIXES.stopAndRun)) {
    const rest = callbackData.slice(OPERATOR_CALLBACK_PREFIXES.stopAndRun.length).trim();
    const parts = rest.split(/\s+/);
    const verb = (parts[0] ?? '').toLowerCase();
    const args = parts.slice(1).join(' ') || undefined;
    return verb ? { action: 'stop-and-run', verb, args } : { action: 'ignore' };
  }
  if (callbackData.startsWith(OPERATOR_CALLBACK_PREFIXES.runAnyway)) {
    const rest = callbackData.slice(OPERATOR_CALLBACK_PREFIXES.runAnyway.length).trim();
    const parts = rest.split(/\s+/);
    const verb = (parts[0] ?? '').toLowerCase();
    const args = parts.slice(1).join(' ') || undefined;
    return verb ? { action: 'run-anyway', verb, args } : { action: 'ignore' };
  }
  if (callbackData.startsWith(OPERATOR_CALLBACK_PREFIXES.landSleep)) {
    const answer = callbackData.slice(OPERATOR_CALLBACK_PREFIXES.landSleep.length).trim().toLowerCase();
    if (answer === 'yes' || answer === 'no') {
      return { action: 'land-sleep', answer };
    }
  }
  return { action: 'ignore' };
}

/** Callback confirm only fires when pending matches. */
export function decideOperatorConfirmCallback(
  pending: PendingOperatorConfirm,
  callbackData: string
): OperatorConfirmDecision {
  if (callbackData === OPERATOR_CALLBACK_DATA.cancel) {
    return pending ? { action: 'cancel-pending' } : { action: 'ignore' };
  }
  if (callbackData !== OPERATOR_CALLBACK_DATA.confirm) {
    return { action: 'ignore' };
  }
  if (!pending) {
    return { action: 'ignore' };
  }
  // /stop uses stop-mode buttons, not generic Confirm.
  if (pending.verb.toLowerCase() === '/stop') {
    return { action: 'ignore' };
  }
  return { action: 'execute', verb: pending.verb, args: pending.args };
}

/** @deprecated Prefer decideOperatorConfirmCallback with op:confirm data. */
export function decideOperatorConfirmCallbackVerb(
  pending: PendingOperatorConfirm,
  confirmedVerb: string
): OperatorConfirmDecision {
  if (!pending) {
    return { action: 'ignore' };
  }
  if (pending.verb !== confirmedVerb.toLowerCase()) {
    return { action: 'ignore' };
  }
  return { action: 'execute', verb: pending.verb, args: pending.args };
}

export function formatOperatorConfirmPrompt(
  tier: 'soft' | 'hard',
  verb: string,
  args?: string
): string {
  const cmd = args ? `${verb} ${args}` : verb;
  if (tier === 'soft') {
    return `Confirm ${cmd}? One tap to run.`;
  }
  return `Hard confirm: run ${cmd}? This can mutate swarm / host state.`;
}

export function operatorConfirmButtons(): Array<Array<{ text: string; callbackData: string }>> {
  return [
    [
      { text: 'Confirm', callbackData: OPERATOR_CALLBACK_DATA.confirm },
      { text: 'Cancel', callbackData: OPERATOR_CALLBACK_DATA.cancel },
    ],
  ];
}

/** BL-698: /stop offers drain-stop vs emergency-stop (Control twin). */
export function operatorStopModeButtons(): Array<Array<{ text: string; callbackData: string }>> {
  return [
    [
      { text: 'Drain-stop', callbackData: OPERATOR_CALLBACK_DATA.stopDrain },
      { text: 'Emergency-stop', callbackData: OPERATOR_CALLBACK_DATA.stopEmergency },
    ],
    [{ text: 'Cancel', callbackData: OPERATOR_CALLBACK_DATA.cancel }],
  ];
}

export function formatOperatorStopModePrompt(): string {
  return 'Stop the swarm? Choose drain-stop (wait for empty pipeline, then kill) or emergency-stop (kill now).';
}
