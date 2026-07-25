const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  PREREQUISITE_STEP_ORDER,
  createOnboardingState,
  handleOnboardingMessage,
  isBareDoneClaim,
} = require('../out/onboarding/onboardingFacilitatorState');
const {
  slugifyTargetRepoUrl,
  listOnboardingFacilitatorStates,
} = require('../out/onboarding/onboardingFacilitatorStateStore');
const { handleOnboardingFacilitatorMessage } = require('../out/tools/telegram-front-desk-bot');

// BL-590 slice 1, architect-owned property pass (role prompt: "Property
// Testing"). onboardingFacilitatorState.ts is a pure, clock-injected state
// machine and onboardingFacilitatorStateStore.ts its durable twin - exactly
// the testable-module boundary the ticket asked for, and the modules this
// parcel touched. Their example tests pin the handful of sequences a human
// was imagined to type; the invariants below are the ones the ticket's own
// promises rest on, and they must hold across EVERY message sequence:
//
//   P1  a bare claim of completion never advances a step (scenario 04's
//       promise is "never on a claim", for every phrasing that IS a claim,
//       not the four the example test happens to name);
//   P2  slugifyTargetRepoUrl is deterministic, filesystem-safe and stable
//       under re-slugging - it is the key the durable per-target state file
//       is named by, so an unstable slug loses a target's whole record;
//   P3  the redelivery guard: across ANY interleaving of updates and send
//       failures, a redelivered updateId re-sends the message computed the
//       FIRST time and never re-enters the state machine.
//
// P3 is the one that matters most here. This parcel bounced three times on
// three instances of that single invariant (evidence:
// backlog/evidence/BL-590-*architect-bounce*.md) - each fix was correct for
// the branch it was aimed at and left another branch uncovered. An example
// test can only pin the branch someone thought of; the property pins the
// invariant itself.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from the unit/coverage/mutation run per engineering.prompt's
// property-test separation rule.

const TARGET_URL = 'https://github.com/acme/widget';

// The passing verification paste for each prerequisite step, in step order -
// the real markers from PREREQUISITE_STEPS, so a generated "walk N steps
// forward" advances the real machine rather than a stand-in.
const PASSING_PASTES = [
  'git version 2.40.0\nv20.11.0\ntmux 3.3\nbabashka v1.3.0\nclaude 1.0.0',
  'Hi acme! You have successfully authenticated, but GitHub does not provide shell access.',
  "Cloning into 'swarm-forge'...\nabc1234",
  "Cloning into 'widget'...\norigin\tgit@github.com:acme/widget.git (fetch)",
  'Created a new bot @acme_widget_bot via BotFather and the token was saved.',
];

// A clock that only ever moves forward, pinned to a fixed epoch - production
// reads wall time, so the fixture must not (engineering.prompt: pin fixture
// clocks; real-clock ties make pickActiveOnboardingState's "most recently
// touched" reduce order-dependent).
function monotonicClock(startMs = 1_700_000_000_000) {
  let current = startMs;
  return () => (current += 1000);
}

// Walks a fresh onboarding forward `n` verified steps and returns the state.
function stateAfterSteps(n, now) {
  let state = createOnboardingState(TARGET_URL, now);
  for (let i = 0; i < n; i++) {
    state = handleOnboardingMessage([state], PASSING_PASTES[i], now).state;
  }
  return state;
}

// ── P1: a bare claim of completion never advances a step ────────────────────

// Every phrasing BARE_DONE_PATTERN recognises, with the optional prefix,
// casing, punctuation and surrounding whitespace it tolerates - generated
// rather than enumerated, so the property covers the pattern's whole
// language and not the four spellings the example test names.
const bareDoneArb = fc
  .tuple(
    fc.constantFrom('', "it's ", 'its ', 'IT’S '.toLowerCase()),
    fc.constantFrom('done', 'finished', 'complete', 'completed', 'ready', 'yes', 'ok', 'okay'),
    fc.constantFrom('', '.', '!'),
    fc.constantFrom('', ' ', '  ', '\n'),
    fc.constantFrom('', ' ', '\t')
  )
  .map(([prefix, word, punct, lead, trail]) => `${lead}${prefix}${word}${punct}${trail}`)
  .filter((text) => isBareDoneClaim(text));

test('P1: a bare claim of completion never advances a step, from any point in the checklist', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: PREREQUISITE_STEP_ORDER.length - 1 }), bareDoneArb, (stepsDone, claim) => {
      const now = monotonicClock();
      const before = stateAfterSteps(stepsDone, now);
      const outcome = handleOnboardingMessage([before], claim, now);
      assert.equal(outcome.kind, 'advanced', 'a reply to an in-flight onboarding is always an advanced turn');
      assert.equal(outcome.state.stepIndex, before.stepIndex, `"${claim}" must not move the step index`);
      assert.deepEqual(outcome.state.verifiedSteps, before.verifiedSteps, `"${claim}" must not verify a step`);
      assert.equal(outcome.state.phase, before.phase);
    }),
    { numRuns: 300 }
  );
});

// ── P2: the durable-state filename key is stable and filesystem-safe ────────

const repoUrlArb = fc
  .tuple(
    fc.constantFrom('https://', 'http://', 'ssh://', ''),
    fc.stringMatching(/^[a-z][a-z0-9.-]{0,20}$/),
    fc.stringMatching(/^[A-Za-z0-9_.-]{1,20}$/),
    fc.stringMatching(/^[A-Za-z0-9_.-]{1,20}$/),
    fc.constantFrom('', '.git', '/')
  )
  .map(([scheme, host, org, repo, suffix]) => `${scheme}${host}/${org}/${repo}${suffix}`);

test('P2: slugifyTargetRepoUrl is deterministic, non-empty, filesystem-safe and stable under re-slugging', () => {
  fc.assert(
    fc.property(repoUrlArb, (url) => {
      const slug = slugifyTargetRepoUrl(url);
      assert.equal(slug, slugifyTargetRepoUrl(url), 'must be deterministic - the state file is named by it');
      assert.ok(slug.length > 0, 'an empty slug would collapse every target onto one state file');
      assert.doesNotMatch(slug, /[/\\]/, 'a path separator would escape the onboarding state directory');
      assert.doesNotMatch(slug, /^[.]{1,2}$/, '"." / ".." would not be a file at all');
      assert.doesNotMatch(slug, /\s/, 'whitespace in a state filename is a shell hazard downstream');
      // Stability under re-slugging: the slug of a slug is the slug itself.
      // Without this, any code path that re-keys an already-slugged value
      // (a reconcile pass, an operator debugging by filename) silently
      // addresses a DIFFERENT file than the one the state lives in.
      assert.equal(slugifyTargetRepoUrl(slug), slug, 'slugify must be stable on its own output');
    }),
    { numRuns: 500 }
  );
});

// ── P3: the redelivery guard, across any interleaving ───────────────────────

function onboardingStates(root) {
  return listOnboardingFacilitatorStates(root);
}

// postFn driven by a generated success/failure stream, so the property
// explores exactly the failed-send-then-redelivery interleavings that
// offsetAfterDelivery makes reachable (a stuck head-of-line delivery parks
// the offset while later updates in the same batch are fully applied).
function scriptedPostFn(successes) {
  const calls = [];
  const postFn = async (url, body) => {
    const ok = successes[calls.length % successes.length];
    calls.push({ url, body, ok });
    if (!ok) {
      return { ok: false, status: 502, json: { ok: false, description: 'Bad Gateway' } };
    }
    return { ok: true, status: 200, json: { ok: true, result: { message_id: calls.length } } };
  };
  return { postFn, calls };
}

// A message pool spanning every branch handleOnboardingMessage can take:
// the repo URL (start/resume), each passing verification, a failing paste,
// a bare claim, both control words, and plain chatter (the
// no-active-onboarding branch when nothing is in flight).
const messageArb = fc.constantFrom(
  TARGET_URL,
  ...PASSING_PASTES,
  'fatal: repository not found',
  'done',
  'pause',
  'proceed',
  'hi',
  'where are we?'
);

// updateIds drawn from a small pool so redeliveries actually occur - the
// whole point of the property. Telegram never reuses an update_id, so a
// repeat of one IS a redelivery and nothing else.
const opArb = fc.record({ updateId: fc.integer({ min: 700, max: 706 }), text: messageArb });

test('P3: a redelivered updateId re-sends the first-computed message and never re-enters the state machine', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(opArb, { minLength: 2, maxLength: 14 }),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
      async (ops, successes) => {
        const root = mkTmpDir('sfvc-onboarding-prop-');
        const { postFn, calls } = scriptedPostFn(successes);
        // What was sent for each updateId, and whether it has landed yet.
        const firstBodyFor = new Map();
        const deliveredFor = new Set();

        for (const op of ops) {
          const seenBefore = firstBodyFor.has(op.updateId);
          const statesBefore = onboardingStates(root);
          const callsBefore = calls.length;

          await handleOnboardingFacilitatorMessage(root, 'tok', 'chat', 42, op.text, op.updateId, postFn);

          const sent = calls.slice(callsBefore);
          if (!seenBefore) {
            assert.equal(sent.length, 1, 'a first-seen update is always attempted exactly once');
            firstBodyFor.set(op.updateId, sent[0].body);
            if (sent[0].ok) {
              deliveredFor.add(op.updateId);
            }
            continue;
          }

          // ── This op is a REDELIVERY. Three things must hold. ──
          if (deliveredFor.has(op.updateId)) {
            assert.equal(sent.length, 0, `updateId ${op.updateId} already landed - a redelivery must send nothing at all`);
          } else {
            assert.equal(sent.length, 1, `updateId ${op.updateId} never landed - a redelivery must retry the send`);
            assert.equal(
              sent[0].body,
              firstBodyFor.get(op.updateId),
              `updateId ${op.updateId} must re-send the message computed on the FIRST attempt, never a freshly recomputed one`
            );
            if (sent[0].ok) {
              deliveredFor.add(op.updateId);
            }
          }
          assert.deepEqual(
            onboardingStates(root),
            statesBefore,
            `updateId ${op.updateId} is a redelivery - it must not re-enter the state machine or mutate any target's state`
          );
        }
      }
    ),
    { numRuns: 120 }
  );
});
