#!/usr/bin/env node
// BL-1056: the price cliff as a query rather than a memory. Prints every
// pricing entry whose validity window has closed or is about to, so
// "Sonnet 5 intro pricing ends 2026-08-31" is something the swarm can be
// ASKED instead of something a human has to remember.
//
// Usage: node pricing-windows.js [YYYY-MM-DD]
// With no argument, answers for now. Reads only PRICING_TABLE - there is no
// sibling windows file to drift against.
import { listPricingWindowAlerts, PricingWindowAlert } from '../metrics/pricingTable';
import { printJsonToStdout, runCliMain } from './swarm-metrics';

const USAGE = 'Usage: pricing-windows.js [YYYY-MM-DD]\n';

/** Null for an argument that is not a plain calendar day - never a silent "now". */
export function parsePricingWindowsAt(argv: string[], now: Date = new Date()): Date | null {
  const [day] = argv;
  if (day === undefined) {
    return now;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface PricingWindowsReport {
  at: string;
  alerts: PricingWindowAlert[];
}

export function runPricingWindows(at: Date): PricingWindowsReport {
  return { at: at.toISOString(), alerts: listPricingWindowAlerts(at) };
}

export function main(): void {
  const at = parsePricingWindowsAt(process.argv.slice(2));
  if (!at) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }
  printJsonToStdout(runPricingWindows(at));
}

if (require.main === module) {
  runCliMain(main);
}
