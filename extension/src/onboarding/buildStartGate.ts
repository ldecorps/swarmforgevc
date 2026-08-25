import { GateDecision } from './contractTypes';
import { parseContractYaml } from './contractView';

// BL-262 gate-decides-by-agreement-state-02: the build-start gate the
// coordinator consults before its first promotion for a target. Pure over an
// already-read (or absent) contract.yaml string - fail-closed on every state
// but 'agreed' (BL-099 missing-data posture), and every hold names the
// unagreed contract's state as the reason, never crashing on bad input.
export function evaluateBuildStartGate(rawContractYaml: string | undefined): GateDecision {
  if (rawContractYaml === undefined) {
    return { decision: 'hold', reason: 'missing: no onboarding contract found for this target' };
  }

  const contract = parseContractYaml(rawContractYaml);
  if (contract === null) {
    return { decision: 'hold', reason: 'malformed: the onboarding contract could not be parsed' };
  }

  if (contract.agreement === 'agreed') {
    return { decision: 'allow' };
  }

  return {
    decision: 'hold',
    reason: `${contract.agreement}: the onboarding contract is not yet agreed`,
  };
}
