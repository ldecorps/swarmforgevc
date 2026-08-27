const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { listOnboarderStates } = require('../out/onboarding/onboarderStateStore');
const { handleOnboarderMessage } = require('../out/tools/telegram-front-desk-bot');

// BL-590 architect bounce #8 (property authorship rests with the coder,
// first pass - BL-654): the ticket's declared invariant is "every durable
// write is idempotent under redelivery of the same Telegram update." Four of
// the six architect send-backs on this ticket (#2/#4/#5/#6) each fixed one
// concrete redelivery counterexample (a stuck head-of-line batch, a stale
// control word, a failed-send retry...) and each fix left another branch
// uncovered - the example tests at telegramFrontDeskBotCli.test.js:1012-1177
// pin exactly those four counterexamples, but an example test can only pin
// the branch someone already thought of. This property pins the invariant
// itself, across every interleaving of redelivered updateIds and send
// failures fast-check can construct, via the real handleOnboarderMessage
// wiring (never a mock of the guard it is proving).
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from the unit/coverage/mutation run per engineering.prompt's
// property-test separation rule.
//
// Generator reach, scoped deliberately narrow to the invariant's own words:
// the guard in handleOnboarderMessage only arms (writeOnboardingStateAndMark
// UpdateProcessed) once an onboarding is in flight - a message that lands
// with NO target in flight at all ('no-active-onboarding') makes no durable
// write and is out of THIS invariant's scope by the ticket's own wording
// (see telegram-front-desk-bot.ts:832-838's own comment: "nothing durable to
// guard"). So every op below is constructed to keep exactly one target
// in flight for the whole run: op 0 is forced to start it, and the
// follow-up message pool is chosen so the state machine can advance at most
// one step (toolchain -> github-access) and then plateaus there forever -
// never reaching prerequisites-ready, which would tip later ops for the same
// target back into the unguarded branch. This is the asserted reachability
// floor: every op after 0 is proven (not assumed) to hit the guarded path,
// by construction of the message pool below rather than by sampling luck.
const TARGET_URL = 'https://github.com/acme/widget';
// Passes ONLY the "toolchain" step's verification (requiredMarkers: git
// version/tmux/babashka/claude) and is missing "successfully authenticated",
// so it always FAILS the "github-access" step it plateaus at - the state can
// advance at most once, by construction, regardless of how many times or in
// what order this text is redelivered or replayed.
const TOOLCHAIN_PASS_TEXT = 'git version 2.40.0\ntmux 3.3\nbabashka v1.3.0\nclaude 1.0.0';
const FAILING_TEXT = 'fatal: repository not found';

function onboardingStates(root) {
  return listOnboarderStates(root);
}

// postFn driven by a generated success/failure stream, so the property
// explores exactly the failed-send-then-redelivery interleavings
// offsetAfterDelivery makes reachable (a stuck head-of-line delivery parks
// the offset while a later, already-durably-written update in the same
// batch stays unconfirmed).
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

// Every one of these, once the forced op 0 below has put the target in
// flight, resolves to a guarded outcome ('started', 'resumed' or
// 'advanced' - never 'no-active-onboarding'): TARGET_URL resumes the
// existing in-flight state (isLikelyRepoUrl short-circuits before the
// active-state check), and the rest are principal replies handled while a
// state is active.
const followUpMessageArb = fc.constantFrom(TARGET_URL, TOOLCHAIN_PASS_TEXT, FAILING_TEXT, 'pause', 'proceed', 'done');
// A small pool so repeats (redeliveries) actually occur - the whole point of
// the property. Deliberately disjoint from op 0's own updateId (0) so a
// "redelivery of the start message" is exercised as an ordinary pool member
// rather than only ever appearing at position 0.
const followUpOpArb = fc.record({ updateId: fc.integer({ min: 1, max: 6 }), text: followUpMessageArb });

test('P: a redelivered updateId re-sends the first-computed message and never re-enters the state machine', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(followUpOpArb, { minLength: 1, maxLength: 14 }),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
      async (followUps, successes) => {
        const root = mkTmpDir('sfvc-onboarder-redelivery-prop-');
        const { postFn, calls } = scriptedPostFn(successes);
        const ops = [{ updateId: 0, text: TARGET_URL }, ...followUps];

        // What was sent for each updateId, and whether it has landed yet.
        const firstBodyFor = new Map();
        const deliveredFor = new Set();

        for (const op of ops) {
          const seenBefore = firstBodyFor.has(op.updateId);
          const statesBefore = onboardingStates(root);
          const callsBefore = calls.length;

          await handleOnboarderMessage(root, 'fake-token', 'fake-chat', 42, op.text, op.updateId, postFn);

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
