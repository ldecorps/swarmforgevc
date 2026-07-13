import { BenchmarkRanking, ModelAggregate } from './types';

function eligibleCandidates(aggregates: ModelAggregate[]): ModelAggregate[] {
  return aggregates.filter((a) => !a.excluded && a.repetitions > 0);
}

function maxBy(candidates: ModelAggregate[], score: (a: ModelAggregate) => number): ModelAggregate {
  return candidates.reduce((best, c) => (score(c) > score(best) ? c : best));
}

// best / best value / cheapest acceptable (acceptance scenario 03), with
// an explicit stated reason when nothing clears the threshold (scenario
// 05) rather than a silently empty field.
export function rankModels(aggregates: ModelAggregate[], qualityThreshold: number): BenchmarkRanking {
  const candidates = eligibleCandidates(aggregates);
  if (candidates.length === 0) {
    return { bestByQuality: null, bestByValue: null, cheapestAcceptable: null, noAcceptableModelReason: 'no model produced a scored run' };
  }

  const bestByQuality = maxBy(candidates, (c) => c.meanQuality);

  const pricedCandidates = candidates.filter((c) => c.meanCostUsd !== null && c.meanCostUsd > 0);
  const bestByValue = pricedCandidates.length > 0 ? maxBy(pricedCandidates, (c) => c.meanQuality / (c.meanCostUsd as number)) : null;

  const acceptable = pricedCandidates.filter((c) => c.meanQuality >= qualityThreshold);
  const cheapestAcceptable =
    acceptable.length > 0 ? acceptable.reduce((cheapest, c) => ((c.meanCostUsd as number) < (cheapest.meanCostUsd as number) ? c : cheapest)) : null;

  return {
    bestByQuality: bestByQuality.modelId,
    bestByValue: bestByValue ? bestByValue.modelId : null,
    cheapestAcceptable: cheapestAcceptable ? cheapestAcceptable.modelId : null,
    noAcceptableModelReason: cheapestAcceptable ? null : `no model reached the quality threshold of ${qualityThreshold}`,
  };
}
