// BL-233 slice 3 (qualify-via-battery-04): the REAL BatteryGate
// implementation - drives swarmforge/scripts/compliance_battery.bb (BL-231),
// mirroring specs/pipeline/steps/complianceBatterySteps.js's own
// execFileSync convention. No hand-simulated check logic here: every
// verdict comes straight from the real script.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BatteryEntry, BatteryGate, BatteryScorecard } from './candidate';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BATTERY = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'compliance_battery.bb');

function runBattery(args: string[]): unknown {
  const out = execFileSync('bb', [BATTERY, ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}

export function createComplianceBatteryGate(): BatteryGate {
  return {
    async gate(role: string, args: string[]): Promise<BatteryEntry> {
      return runBattery(['gate', role, ...args]) as BatteryEntry;
    },
    async scorecard(model: string, entries: BatteryEntry[]): Promise<BatteryScorecard> {
      const entriesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recruiter-battery-')), 'entries.json');
      fs.writeFileSync(entriesFile, JSON.stringify(entries));
      return runBattery(['scorecard', model, entriesFile]) as BatteryScorecard;
    },
  };
}
