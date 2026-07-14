import { BenchmarkRanking, ModelAggregate } from './types';

function eligibleCandidates(aggregates: ModelAggregate[]): ModelAggregate[] {
  return aggregates.filter((a) => !a.excluded && a.repetitions > 0);
}

function maxBy(candidates: ModelAggregate[], score: (a: ModelAggregate) => number): ModelAggregate {
  return candidates.reduce((best, c) => (score(c) > score(best) ? c : best));
}

// BL-385: candidates whose score EQUALS the top score, never fewer or more
// than that regardless of array order (the array-order bug this ticket
// exists to fix) - a plain max + equality filter, not a reduce that can
// only ever keep one element.
function topScorers(candidates: ModelAggregate[], score: (a: ModelAggregate) => number): ModelAggregate[] {
  const top = Math.max(...candidates.map(score));
  return candidates.filter((c) => score(c) === top);
}

// A tie is TWO OR MORE candidates sharing the top quality score - never
// "all candidates agree", so a single genuine winner among otherwise-tied
// runners-up is still named (a-tie-is-reported-as-a-tie-02's own neighbour
// guard: the tie path must not swallow a real winner).
function bestByQualityOf(candidates: ModelAggregate[]): { modelId: string | null; tied: boolean } {
  const top = topScorers(candidates, (c) => c.meanQuality);
  return top.length === 1 ? { modelId: top[0].modelId, tied: false } : { modelId: null, tied: true };
}

function bestByValueOf(pricedCandidates: ModelAggregate[]): ModelAggregate | null {
  return pricedCandidates.length > 0 ? maxBy(pricedCandidates, (c) => c.meanQuality / (c.meanCostUsd as number)) : null;
}

function cheapestAcceptableOf(acceptable: ModelAggregate[]): ModelAggregate | null {
  return acceptable.length > 0
    ? acceptable.reduce((cheapest, c) => ((c.meanCostUsd as number) < (cheapest.meanCostUsd as number) ? c : cheapest))
    : null;
}

// best / best value / cheapest acceptable (acceptance scenario 03), with
// an explicit stated reason when nothing clears the threshold (scenario
// 05) rather than a silently empty field.
//
// BL-385: a tie in the TOP quality score is reported as a tie, never
// resolved into a false winner by array order - the honest result IS that
// the benchmark could not discriminate. When quality ties, best-value
// reduces to cheapest (a defensible answer) but is labelled as ranked on
// cost alone rather than presented as a quality-cost judgement.
export function rankModels(aggregates: ModelAggregate[], qualityThreshold: number): BenchmarkRanking {
  const candidates = eligibleCandidates(aggregates);
  if (candidates.length === 0) {
    return {
      bestByQuality: null,
      couldNotDiscriminateReason: null,
      bestByValue: null,
      bestByValueRankedByCostAlone: false,
      cheapestAcceptable: null,
      noAcceptableModelReason: 'no model produced a scored run',
    };
  }

  const { modelId: bestByQuality, tied } = bestByQualityOf(candidates);
  const pricedCandidates = candidates.filter((c) => c.meanCostUsd !== null && c.meanCostUsd > 0);
  const bestByValue = bestByValueOf(pricedCandidates);
  const acceptable = pricedCandidates.filter((c) => c.meanQuality >= qualityThreshold);
  const cheapestAcceptable = cheapestAcceptableOf(acceptable);

  return {
    bestByQuality,
    couldNotDiscriminateReason: tied ? 'every scored model reached the same top quality score - the benchmark could not discriminate a winner' : null,
    bestByValue: bestByValue ? bestByValue.modelId : null,
    bestByValueRankedByCostAlone: tied,
    cheapestAcceptable: cheapestAcceptable ? cheapestAcceptable.modelId : null,
    noAcceptableModelReason: cheapestAcceptable ? null : `no model reached the quality threshold of ${qualityThreshold}`,
  };
}
