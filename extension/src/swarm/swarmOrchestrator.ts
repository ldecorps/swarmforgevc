export type ActivationPath =
  | 'reattach'
  | 'reattach-after-daemon'
  | 'cold-launch'
  | 'resume-prompt'
  | 'none';

export interface ActivationDecisionInput {
  tmuxReady: boolean;
  daemonReady: boolean;
  configMatches: boolean;
  autoLaunch: boolean;
  skipDaemon: boolean;
  hasPriorRun: boolean;
  isStartupTriggered: boolean;
}

import { shouldSkipHandoffDaemon } from './daemonHealth';

export { shouldSkipHandoffDaemon };

/**
 * Pure activation routing for Stop → F5 and startup reattach. Keeps tmux
 * reattach separate from daemon repair so a live swarm with a dead handoffd
 * is healed without tearing down agent panes.
 */
export function decideActivationPath(input: ActivationDecisionInput): ActivationPath {
  const transportReady = input.tmuxReady && (input.daemonReady || input.skipDaemon);

  if (input.tmuxReady && input.configMatches && transportReady) {
    return 'reattach';
  }

  if (input.tmuxReady && input.configMatches && !input.skipDaemon && !input.daemonReady) {
    return 'reattach-after-daemon';
  }

  if (input.autoLaunch) {
    return 'cold-launch';
  }

  if (input.isStartupTriggered && input.hasPriorRun) {
    return 'resume-prompt';
  }

  return 'none';
}
