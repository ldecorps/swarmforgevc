import * as fs from 'fs';
import * as path from 'path';
import { evaluateClaimLiveness, ClaimLivenessConfig, ClaimAction, ClaimRecord } from './claimLiveness';

export interface ClaimState {
  [role: string]: {
    task: string;
    claimCount: number;
    lastClaimMs: number;
    lastBeatCount: number;
  };
}

const STATE_FILE = 'claim-liveness.json';

export function loadClaimState(dir: string): ClaimState {
  const filePath = path.join(dir, STATE_FILE);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

export function saveClaimState(dir: string, state: ClaimState): void {
  const filePath = path.join(dir, STATE_FILE);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function recordClaim(
  dir: string,
  role: string,
  task: string,
  currentBeatCount: number,
  config: ClaimLivenessConfig
): ClaimAction {
  const state = loadClaimState(dir);
  const current = state[role];
  
  let record: ClaimRecord;
  
  if (current && current.task === task) {
    const hasProgress = currentBeatCount > current.lastBeatCount;
    record = {
      role,
      task,
      claimCount: hasProgress ? 1 : current.claimCount + 1,
      lastClaimMs: Date.now(),
      hasProgress,
    };
  } else {
    record = {
      role,
      task,
      claimCount: 1,
      lastClaimMs: Date.now(),
      hasProgress: true,
    };
  }
  
  state[role] = {
    task,
    claimCount: record.claimCount,
    lastClaimMs: record.lastClaimMs,
    lastBeatCount: currentBeatCount,
  };
  
  saveClaimState(dir, state);
  
  return evaluateClaimLiveness(record, config);
}
