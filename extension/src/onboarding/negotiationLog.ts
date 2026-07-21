import { NegotiationRound } from './contractNegotiation';

// BL-344 onboarding-negotiation-07: "each round records what was asked
// for and what changed" - a durable, append-only log of every objection
// and its response, one JSON line per round (this project's own
// established shape for a real event history - mirrors BL-343's
// park-cycle-log.jsonl). Never rewritten in place, only appended to, so
// the round history itself can never be silently edited after the fact.

// Split out of parseNegotiationLog so that function's own branch count stays
// low, same technique as contractView.ts's isContractShape /
// propose-onboarding-contract.ts's isRepoSurveyFactsShape.
function parseNegotiationRoundLine(trimmedLine: string): NegotiationRound | null {
  try {
    const parsed = JSON.parse(trimmedLine);
    if (typeof parsed.round === 'number' && typeof parsed.objection === 'string' && Array.isArray(parsed.changedFields)) {
      return { round: parsed.round, objection: parsed.objection, changedFields: parsed.changedFields };
    }
  } catch {
    // skip a malformed/truncated line rather than losing the rest of the log
  }
  return null;
}

export function parseNegotiationLog(content: string): NegotiationRound[] {
  const rounds: NegotiationRound[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const round = parseNegotiationRoundLine(trimmed);
    if (round) {
      rounds.push(round);
    }
  }
  return rounds;
}

export function renderNegotiationLogLine(round: NegotiationRound): string {
  return `${JSON.stringify(round)}\n`;
}
