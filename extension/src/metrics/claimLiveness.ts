export interface ClaimRecord {
  role: string;
  task: string;
  claimCount: number;
  lastClaimMs: number;
  hasProgress: boolean;
}

export interface ClaimLivenessConfig {
  idleReclaimThreshold: number;
  nudgeThreshold: number;
  reassignThreshold: number;
  haltThreshold: number;
}

export type ClaimAction = 'ok' | 'nudge' | 'reassign' | 'halt';

export function evaluateClaimLiveness(
  record: ClaimRecord,
  config: ClaimLivenessConfig
): ClaimAction {
  if (record.hasProgress) {
    return 'ok';
  }
  
  if (record.claimCount >= config.haltThreshold) {
    return 'halt';
  }
  
  if (record.claimCount >= config.reassignThreshold) {
    return 'reassign';
  }
  
  if (record.claimCount >= config.nudgeThreshold) {
    return 'nudge';
  }
  
  return 'ok';
}
