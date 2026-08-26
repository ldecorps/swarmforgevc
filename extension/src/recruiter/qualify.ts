// BL-233 slice 3 (qualify-via-battery-04): qualifies an acquired candidate
// by driving it through a representative trial task per swarm role (the
// injectable RoleTrialRunner seam - see candidate.ts), gating each trial's
// output through BL-231's real swarm-compliance battery, and recording the
// aggregated per-role scorecard. Never filters or judges here - qualify's
// only job is to run the battery and record what it says; the (later)
// ranking slice is what excludes non-compliant candidates.

import { BatteryEntry, BatteryGate, ModelCandidate, QualifyOutcome, RoleTrialRunner } from './candidate';

export async function qualifyCandidate(
  candidate: ModelCandidate,
  deps: { trialRunner: RoleTrialRunner; battery: BatteryGate }
): Promise<QualifyOutcome> {
  const trials = await deps.trialRunner.runTrials(candidate);
  const entries: BatteryEntry[] = [];
  for (const trial of trials) {
    entries.push(await deps.battery.gate(trial.role, trial.gateArgs));
  }
  const scorecard = await deps.battery.scorecard(candidate.model, entries);
  return { model: candidate.model, scorecard };
}
