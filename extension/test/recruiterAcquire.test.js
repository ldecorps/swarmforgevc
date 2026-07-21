const assert = require('node:assert/strict');
const { acquireAccess } = require('../out/recruiter/acquire');

// BL-233 slice 2: auto-acquire-free-02 / acquire-wall-escalates-03.
// signup/secretStore are the injectable seams the TESTABLE-boundary
// constraint requires (no real network/signup/secret writes here) - the
// real file-based secret store is exercised by recruiterSecretStore.test.js.

function candidate(overrides = {}) {
  return {
    model: 'free-model-mini',
    provider: 'acme-ai',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
    ...overrides,
  };
}

function fakeSignup(apiKey) {
  return {
    calls: [],
    async signUp(c) {
      this.calls.push(c);
      return apiKey;
    },
  };
}

function fakeSecretStore() {
  return {
    calls: [],
    async store(c, apiKey) {
      this.calls.push({ candidate: c, apiKey });
    },
  };
}

test('an automatable candidate is signed up and its key stored, outcome reports "acquired" with no key', async () => {
  const signup = fakeSignup('sk-live-abc123');
  const secretStore = fakeSecretStore();

  const outcome = await acquireAccess(candidate(), { signup, secretStore });

  assert.deepEqual(outcome, { model: 'free-model-mini', status: 'acquired' });
  assert.equal(secretStore.calls.length, 1);
  assert.equal(secretStore.calls[0].apiKey, 'sk-live-abc123');
  assert.equal(secretStore.calls[0].candidate.model, 'free-model-mini');
});

test('the raw API key never appears anywhere in the returned outcome', async () => {
  const signup = fakeSignup('sk-live-abc123');
  const secretStore = fakeSecretStore();

  const outcome = await acquireAccess(candidate(), { signup, secretStore });

  assert.equal(
    JSON.stringify(outcome).includes('sk-live-abc123'),
    false,
    'a printed/logged outcome must never leak the raw key'
  );
});

for (const wall of ['payment-wall', 'captcha-wall', 'manual-tos-wall']) {
  test(`a "${wall}" candidate escalates without ever attempting signup or storing a key`, async () => {
    const signup = fakeSignup('should-never-be-used');
    const secretStore = fakeSecretStore();

    const outcome = await acquireAccess(
      candidate({ planCost: { amountUsd: 9, unit: 'monthly' }, signupPath: { url: 'https://x.example', automation: wall } }),
      { signup, secretStore }
    );

    assert.deepEqual(outcome, { model: 'free-model-mini', status: 'escalated', wall });
    assert.equal(signup.calls.length, 0, 'signup must never be attempted against a wall');
    assert.equal(secretStore.calls.length, 0, 'no key may be stored when escalating');
  });
}
