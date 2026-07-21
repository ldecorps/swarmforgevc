import { ClaimAction } from './claimLiveness';

export interface ClaimHealerDeps {
  nudgeRole: (role: string, message: string) => void;
  triggerBounce: (type: 'swarm' | 'extension' | 'all') => void;
  haltWithAlerts: (role: string, task: string, reason: string) => void;
}

export function executeHealAction(
  action: ClaimAction,
  role: string,
  task: string,
  deps: ClaimHealerDeps
): void {
  switch (action) {
    case 'nudge':
      deps.nudgeRole(role, `Idle reclaim detected for task ${task}. Please make progress or release the claim.`);
      break;
    case 'reassign':
      // Bouncing the extension forces the swarm to re-evaluate and reassign the claim
      deps.triggerBounce('extension');
      break;
    case 'halt':
      deps.haltWithAlerts(role, task, 'claim-without-progress exceeded halt threshold; escalating to operator alerts.');
      break;
    case 'ok':
    default:
      // No action needed
      break;
  }
}
