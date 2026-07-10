// BL-233 slice 1 (discover-candidates-01): the discovery seam. "hunt the
// internet for cheap/free plans" - the TESTABLE-boundary constraint means
// the injectable seam is a DiscoverySource, faked in tests; no real network
// in tests. The default production source reads an operator-maintained
// JSON candidates file rather than scraping live sites itself: discovery
// data becomes a reviewable, versioned artifact (the same "defined,
// reviewable list" posture as the i18n jargon preserve-list) instead of
// unbounded, un-testable network I/O baked into this tool. A smarter
// crawler-backed DiscoverySource can fill the same seam later without
// touching the report/CLI code that consumes it.

import * as fs from 'fs';
import { ModelCandidate } from './candidate';

export interface DiscoverySource {
  discover(): Promise<ModelCandidate[]>;
}

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isModelCandidate(value: unknown): value is ModelCandidate {
  if (!isNonNullObject(value)) {
    return false;
  }
  return (
    typeof value.model === 'string' &&
    typeof value.provider === 'string' &&
    isNonNullObject(value.planCost) &&
    isNonNullObject(value.signupPath)
  );
}

// A missing candidates file reads as "nothing discovered yet" (empty
// report), not an error - mirrors translationCache.ts's own defensive-read
// posture for absent/malformed state.
export function createFileDiscoverySource(candidatesFilePath: string): DiscoverySource {
  return {
    async discover(): Promise<ModelCandidate[]> {
      if (!fs.existsSync(candidatesFilePath)) {
        return [];
      }
      const parsed = JSON.parse(fs.readFileSync(candidatesFilePath, 'utf-8'));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isModelCandidate);
    },
  };
}
