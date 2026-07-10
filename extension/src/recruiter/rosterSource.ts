// BL-250 roster-enumerates-01 (bake-off, companion to BL-233): the
// curated, closed three-provider roster source. Unlike BL-233's open
// web-discovery (an operator-maintained "here's what I found" file), this
// enumerates the WHOLE agent-capable model roster Anthropic/Mistral/
// OpenAI expose - but mirrors discoverySource.ts's own established
// choice: reads an operator-maintained JSON catalog file rather than
// calling each provider's live models API directly. The TESTABLE-boundary
// constraint calls for an injectable seam here regardless, and a
// versioned, reviewable catalog file is the same "defined, reviewable
// list" posture discoverySource.ts already established. A live-API-backed
// RosterSource can fill the same seam later without touching anything
// downstream - acquire/qualify/rank/report all consume plain
// ModelCandidate[], same as BL-233.
//
// Non-chat endpoints (embeddings, image, audio, moderation) cannot act as
// swarm agents, so they never reach the returned roster regardless of
// what the catalog file lists.

import { CostTier, ModelCandidate } from './candidate';
import { DiscoverySource } from './discoverySource';
import { isNonNullObject, readJsonArrayFile } from './jsonCatalog';

const CHAT_ENDPOINT_TYPE = 'chat';

interface RawCatalogEntry {
  provider: string;
  model: string;
  planCost: { amountUsd: number; unit: 'free' | 'monthly' };
  signupPath: { url: string; automation: string };
  endpointType: string;
  costTier: CostTier;
}

function isRawCatalogEntry(value: unknown): value is RawCatalogEntry {
  if (!isNonNullObject(value)) {
    return false;
  }
  return (
    typeof value.model === 'string' &&
    typeof value.provider === 'string' &&
    isNonNullObject(value.planCost) &&
    isNonNullObject(value.signupPath) &&
    typeof value.endpointType === 'string' &&
    (value.costTier === 'paid-only' || value.costTier === 'free/eval-tier')
  );
}

function toModelCandidate(entry: RawCatalogEntry): ModelCandidate {
  return {
    model: entry.model,
    provider: entry.provider,
    planCost: entry.planCost,
    signupPath: entry.signupPath as ModelCandidate['signupPath'],
    costTier: entry.costTier,
  };
}

// A missing catalog file reads as "nothing rostered yet" (empty report),
// not an error - mirrors createFileDiscoverySource's own defensive-read
// posture for absent/malformed state.
export function createFileRosterSource(catalogFilePath: string): DiscoverySource {
  return {
    async discover(): Promise<ModelCandidate[]> {
      return readJsonArrayFile(catalogFilePath, isRawCatalogEntry)
        .filter((entry) => entry.endpointType === CHAT_ENDPOINT_TYPE)
        .map(toModelCandidate);
    },
  };
}
