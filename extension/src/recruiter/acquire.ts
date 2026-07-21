// BL-233 slice 2 (auto-acquire-free-02 / acquire-wall-escalates-03):
// acquires a discovered candidate's API access. An automatable candidate is
// signed up and its key handed straight to the secret store - the raw key
// is never returned in the outcome (only a status), so it can never leak
// into a printed report, a log, or a committed file. A candidate whose
// signupPath already names a wall (payment/captcha/manual-ToS, classified
// at discovery time - see candidate.ts's SignupAutomation) is never
// attempted: automating past a payment/captcha/ToS wall is exactly what the
// engineering bounded-safety rule forbids, so it escalates immediately
// instead of trying and failing.

import { AcquireOutcome, ModelCandidate, SecretStore, SignupSource } from './candidate';

export async function acquireAccess(
  candidate: ModelCandidate,
  deps: { signup: SignupSource; secretStore: SecretStore }
): Promise<AcquireOutcome> {
  const { automation } = candidate.signupPath;
  if (automation !== 'automatable') {
    return { model: candidate.model, status: 'escalated', wall: automation };
  }
  const apiKey = await deps.signup.signUp(candidate);
  await deps.secretStore.store(candidate, apiKey);
  return { model: candidate.model, status: 'acquired' };
}
