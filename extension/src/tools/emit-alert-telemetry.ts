#!/usr/bin/env node
/**
 * BL-598: CLI for operator/handoff paths to append one alert verdict record.
 * Usage: emit-alert-telemetry.js <project-root> <alert-type> <verdict>
 */
import { runCliMain } from './swarm-metrics';
import { emitAlertVerdict } from '../metrics/alertTelemetryStore';
import type { AlertVerdict } from '../metrics/alertTelemetry';

function parseVerdict(raw: string): AlertVerdict | undefined {
  if (raw === 'false-positive' || raw === 'actionable') return raw;
  return undefined;
}

export async function main(): Promise<void> {
  const [projectRoot, alertType, verdictRaw] = process.argv.slice(2);
  if (!projectRoot || !alertType || !verdictRaw) {
    process.stderr.write(
      'Usage: emit-alert-telemetry.js <project-root> <alert-type> <false-positive|actionable>\n'
    );
    process.exitCode = 1;
    return;
  }
  const verdict = parseVerdict(verdictRaw);
  if (!verdict) {
    process.stderr.write(`Unknown verdict: ${verdictRaw}\n`);
    process.exitCode = 1;
    return;
  }
  emitAlertVerdict(projectRoot, alertType, verdict);
}

if (require.main === module) {
  runCliMain(main);
}
