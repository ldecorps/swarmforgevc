// BL-897: shared --snapshot flag parsing for the briefing-section CLIs
// (briefing-digest-line.ts, render-briefing-burndown.ts,
// emit-cost-health-sidecar.ts). Deliberately permissive, unlike
// closingCeremonyRunArgs.ts's guarded main(): these CLIs already have an
// established "never crash the briefing send" contract (a non-zero exit
// just means the daemon omits that section), so a malformed/unrecognized
// --snapshot must degrade to "no snapshot offered" - the same as the flag
// being absent - never abort the whole CLI over an optional seam.
import { parseFlagPairs } from './bounceArgsCore';

const FLAG_NAMES = ['--snapshot'] as const;

export function parseSnapshotPath(argv: string[]): string | undefined {
  const flags = parseFlagPairs(argv, FLAG_NAMES);
  return flags?.['--snapshot'];
}
