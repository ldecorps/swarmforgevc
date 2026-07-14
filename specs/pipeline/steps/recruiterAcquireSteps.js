'use strict';

// BL-233 slice 2: step handlers for the recruiter's acquire-access
// scenarios (auto-acquire-free-02, acquire-wall-escalates-03). Fakes
// signup/secret-store per the TESTABLE-boundary constraint - no real
// network, signup, or secret writes here. The real file-based secret store
// is exercised directly by extension/test/recruiterSecretStore.test.js's
// own unit tests, not through the acceptance layer. The shared Background
// step is already registered by recruiterDiscoverSteps.js (first-match
// registry) - not re-registered here.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { acquireAccess } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'recruiter', 'acquire')
);

// Maps the Gherkin Examples table's human-readable wall text to the
// machine SignupAutomation value discovery would have classified the
// candidate under (see candidate.ts).
const WALL_TEXT_TO_AUTOMATION = {
  'payment details': 'payment-wall',
  'a captcha': 'captcha-wall',
  'manual ToS acceptance': 'manual-tos-wall',
};

const FAKE_API_KEY = 'sk-fake-test-key-do-not-use';

function candidateFixture(automation) {
  return {
    model: 'free-model-mini',
    provider: 'acme-ai',
    planCost: automation === 'automatable' ? { amountUsd: 0, unit: 'free' } : { amountUsd: 9, unit: 'monthly' },
    signupPath: { url: 'https://acme.example/signup', automation },
  };
}

function fakeSignup(apiKey) {
  return {
    calls: [],
    async signUp(candidate) {
      this.calls.push(candidate);
      return apiKey;
    },
  };
}

function fakeSecretStore() {
  return {
    calls: [],
    async store(candidate, apiKey) {
      this.calls.push({ candidate, apiKey });
    },
  };
}

function registerSteps(registry) {
  // ── auto-acquire-free-02 ─────────────────────────────────────────────
  registry.define(/^a discovered candidate whose plan is free and permits automated signup$/, (ctx) => {
    ctx.candidate = candidateFixture('automatable');
    // Stands in for "the working tree" the acquired key must never land
    // in - the fake secret store below writes to ctx.secretStore.calls
    // (in-memory), never into this directory; this fixture exists so the
    // Then step below has a real filesystem location to prove is untouched.
    ctx.workingTreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-recruiter-worktree-'));
    fs.writeFileSync(path.join(ctx.workingTreeDir, 'placeholder.txt'), 'nothing secret here\n');
  });

  registry.define(/^the recruiter acquires access$/, async (ctx) => {
    ctx.signup = fakeSignup(FAKE_API_KEY);
    ctx.secretStore = fakeSecretStore();
    ctx.outcome = await acquireAccess(ctx.candidate, { signup: ctx.signup, secretStore: ctx.secretStore });
  });

  registry.define(/^it obtains an API key and stores it in the host secret store$/, (ctx) => {
    if (ctx.outcome.status !== 'acquired') {
      throw new Error(`expected status "acquired", got "${ctx.outcome.status}"`);
    }
    if (ctx.secretStore.calls.length !== 1 || ctx.secretStore.calls[0].apiKey !== FAKE_API_KEY) {
      throw new Error('expected the acquired key to be stored in the secret store exactly once');
    }
  });

  registry.define(/^the key is never written to the working tree or any commit$/, (ctx) => {
    if (JSON.stringify(ctx.outcome).includes(FAKE_API_KEY)) {
      throw new Error('the raw key must never appear in the acquire outcome (it could be printed/logged/committed)');
    }
    for (const file of fs.readdirSync(ctx.workingTreeDir)) {
      const content = fs.readFileSync(path.join(ctx.workingTreeDir, file), 'utf8');
      if (content.includes(FAKE_API_KEY)) {
        throw new Error(`the working tree fixture must never contain the key, found it in ${file}`);
      }
    }
  });

  // ── acquire-wall-escalates-03 ────────────────────────────────────────
  registry.define(/^a discovered candidate whose signup requires "([^"]+)"$/, (ctx, wallText) => {
    const automation = WALL_TEXT_TO_AUTOMATION[wallText];
    if (!automation) {
      throw new Error(`unrecognized wall text "${wallText}"`);
    }
    ctx.expectedWall = automation;
    ctx.candidate = candidateFixture(automation);
  });

  registry.define(/^the recruiter attempts to acquire access$/, async (ctx) => {
    ctx.signup = fakeSignup('should-never-be-used');
    ctx.secretStore = fakeSecretStore();
    ctx.outcome = await acquireAccess(ctx.candidate, { signup: ctx.signup, secretStore: ctx.secretStore });
  });

  registry.define(/^it escalates to a human for that candidate$/, (ctx) => {
    if (ctx.outcome.status !== 'escalated' || ctx.outcome.wall !== ctx.expectedWall) {
      throw new Error(`expected escalation with wall "${ctx.expectedWall}", got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  registry.define(/^no API key is fabricated and nothing is committed$/, (ctx) => {
    if (ctx.signup.calls.length !== 0) {
      throw new Error('signup must never be attempted against a wall - that IS "fabricating a key past a wall"');
    }
    if (ctx.secretStore.calls.length !== 0) {
      throw new Error('no key may be stored when escalating');
    }
  });
}

module.exports = { registerSteps };
