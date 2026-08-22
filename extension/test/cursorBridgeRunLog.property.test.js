'use strict';

// BL-1050 property test (coder-authored, TWO declared invariants).
//
//   Invariant 1 (a failure a human is told about is also on disk): every
//   bridge run failure the operator can be told about through Telegram leaves
//   a line in cursor-bridge.log, whether or not the Telegram post itself
//   succeeds - the log path must not be reachable only through the code path
//   that also posts.
//   Invariant 2 (nothing secret, nothing said): lines carry the run id, the
//   error reason and the reset decision; never a prompt, a reply, an API key
//   or a bot token. cursor-bridge.log is world-readable to anything on this
//   host.
//
// WHY PROPERTIES AND NOT MORE FIXTURES. Both quantify over "every failing run
// the bridge could possibly have". The six acceptance scenarios pin six
// shapes; the leak that matters is the seventh - a reason the bridge REWRITES
// before throwing, whose logging someone put in the branch that got skipped,
// or an SDK message that happens to quote the credential it rejected.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// Three states a naive generator would essentially never produce:
//
//   (a) THE REWRITTEN BRANCH. assertCursorRunSucceeded has two throws: quota
//       failures get a hand-written human message, everything else gets the
//       SDK's own text. Logging placed in the second branch only would satisfy
//       every uniform draw except the quota ones. Quota reasons are therefore
//       drawn deliberately, with their own floor - and the property asserts
//       the log line carries the SDK's reason even when the HUMAN sees the
//       rewritten one.
//
//   (b) A REASON THAT QUOTES THE CREDENTIAL. This is the collision shape
//       BL-654 warns about: drawing a reason independently of the environment
//       would embed a real key essentially never. So the reason is DERIVED
//       FROM the secret - the transformation an SDK auth error actually
//       performs, quoting back the credential it rejected - and every such
//       case is a leak candidate by construction. Its near-miss twin (a
//       reason quoting a NON-secret variable's value, which must survive) is
//       generated alongside, because a redactor that blanked every environment
//       value would also pass invariant 2 while making the log useless.
//
//   (c) THE REDACTION LENGTH BOUNDARY. Drawing secret lengths uniformly puts
//       almost every value far above the threshold, so an off-by-one on it
//       (`>` for `>=`) would survive any number of runs. Values exactly AT
//       and exactly ONE BELOW the limit are constructed, and each carries its
//       own floor.
//
// A STATED LIMIT, not a silent one. Redaction has a minimum length
// (MIN_REDACTABLE_SECRET_LENGTH, 8): a two-character value of a
// secret-NAMED variable is not blanked, because doing so would erase ordinary
// words from every reason and make the log less readable than no log at all.
// Invariant 2 is therefore encoded over secrets of at least that length -
// the length every real API key and bot token has - and the boundary itself
// is asserted rather than assumed.

const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  CURSOR_RUN_FAILURE_MARKER,
  formatCursorRunFailureLine,
  logCursorRunFailure,
  redactEnvironmentSecrets,
  secretEnvironmentValues,
} = require('../out/bridge/cursorBridgeRunLog');
const { runCursorAgentPrompt } = require('../out/bridge/cursorBridgeAgentSession');
const { shouldResetCursorAgentSession } = require('../out/tools/telegramCursorBridgeCore');

const RUNS = 300;
const AT = '2026-08-22T23:00:00.000Z';
const MIN_REDACTABLE_SECRET_LENGTH = 8;

// The reason families the bridge treats differently. Quota reasons take the
// REWRITTEN throw; the rest take the SDK's own text. Both must log.
const QUOTA_REASONS = ['resource_exhausted', 'RESOURCE EXHAUSTED now', 'rate limit reached'];
const RESET_REASONS = ['Connection failed repeatedly', 'fetch failed', 'already has active run', '[UNAVAILABLE] service'];
const PLAIN_REASONS = ['boom', 'internal error', 'the model declined', 'unknown error'];

function stubAgent(status, id, reason) {
  return {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'the assistant reply text' }] } };
        },
        async wait() {
          return { status, id, error: reason === undefined ? undefined : { message: reason } };
        },
      };
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Invariant 1 — told a human, therefore also on disk.
// ──────────────────────────────────────────────────────────────────────────

// WEIGHTED so the rewritten branch is common. Drawn uniformly across all
// three families it would still appear, but the floor below is what makes
// "it appeared" a fact rather than a hope.
const failureReason = fc.oneof(
  { arbitrary: fc.constantFrom(...QUOTA_REASONS), weight: 3 },
  { arbitrary: fc.constantFrom(...RESET_REASONS), weight: 3 },
  { arbitrary: fc.constantFrom(...PLAIN_REASONS), weight: 3 }
);

const runId = fc.stringMatching(/^run-[a-z0-9]{4}$/);

test('invariant 1: every failure a human can be told about also lands on disk, post or no post', async () => {
  const reached = { quota: 0, reset: 0, plain: 0, postThrew: 0 };

  await fc.assert(
    fc.asyncProperty(runId, failureReason, fc.boolean(), async (id, reason, postThrows) => {
      const lines = [];
      const deps = { sink: (line) => lines.push(line), now: () => AT, env: {} };
      // The "post" is the progress callback the Cursor Remote topic renders.
      // When it throws, the record must already exist: the log path must not
      // be reachable only through the code path that also posts.
      const onProgress = postThrows
        ? () => {
            throw new Error('telegram post failed');
          }
        : () => {};

      let thrown;
      try {
        await runCursorAgentPrompt(stubAgent('error', id, reason), 'a prompt', onProgress, deps);
      } catch (err) {
        thrown = err;
      }

      assert.ok(thrown, 'a failing run must still fail');
      const failureLines = lines.filter((l) => l.includes(CURSOR_RUN_FAILURE_MARKER));
      assert.equal(failureLines.length, 1, `expected exactly one recorded failure, got ${failureLines.length}`);
      assert.ok(failureLines[0].includes(`run=${id}`), 'the record must name the run id the human was told');
      // The SDK's own reason, even when the human sees the rewritten message.
      assert.ok(
        failureLines[0].endsWith(`reason=${reason}`),
        `the record must carry the SDK reason, got: ${failureLines[0]}`
      );
      // The reset decision is the one the recovery path uses, not a copy.
      assert.ok(failureLines[0].includes(shouldResetCursorAgentSession(reason) ? 'reset=yes' : 'reset=no'));

      if (postThrows) reached.postThrew++;
      if (QUOTA_REASONS.includes(reason)) {
        reached.quota++;
        assert.match(thrown.message, /quota exhausted/, 'quota failures keep their rewritten human message');
      } else if (RESET_REASONS.includes(reason)) {
        reached.reset++;
      } else {
        reached.plain++;
      }
      return true;
    }),
    { numRuns: RUNS }
  );

  // Reach floors (a): the rewritten branch, the reset branch, and a failed
  // post all actually occurred - otherwise the assertions above are vacuous.
  assert.ok(reached.quota >= 20, `rewritten-branch failures too rare: ${reached.quota}`);
  assert.ok(reached.reset >= 20, `reset-branch failures too rare: ${reached.reset}`);
  assert.ok(reached.plain >= 20, `plain failures too rare: ${reached.plain}`);
  assert.ok(reached.postThrew >= 50, `failed posts too rare - invariant 1 would be vacuous: ${reached.postThrew}`);
});

test('invariant 1: a successful run adds nothing, so the log stays greppable', async () => {
  await fc.assert(
    fc.asyncProperty(runId, async (id) => {
      const lines = [];
      await runCursorAgentPrompt(stubAgent('success', id, undefined), 'a prompt', undefined, {
        sink: (line) => lines.push(line),
        now: () => AT,
        env: {},
      });
      assert.deepEqual(lines, []);
      return true;
    }),
    { numRuns: RUNS }
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Invariant 2 — no secret, no conversation content.
// ──────────────────────────────────────────────────────────────────────────

const secretName = fc.constantFrom('CURSOR_API_KEY', 'TELEGRAM_BOT_TOKEN', 'RESEND_API_KEY', 'DB_PASSWORD', 'APP_SECRET');
const plainName = fc.constantFrom('PATH', 'HOME', 'SWARMFORGE_PACK', 'LANG', 'CURSOR_BRIDGE_MODEL');

// Reach (c): lengths AT the limit and ONE BELOW it are constructed, not hoped
// for, alongside realistic long values.
const secretValue = fc.oneof(
  { arbitrary: fc.constant('x'.repeat(MIN_REDACTABLE_SECRET_LENGTH)), weight: 2 },
  { arbitrary: fc.constant('y'.repeat(MIN_REDACTABLE_SECRET_LENGTH - 1)), weight: 2 },
  { arbitrary: fc.stringMatching(/^[A-Za-z0-9:_-]{20,48}$/), weight: 5 }
);

test('invariant 2: a credential the SDK quotes back never survives into the line', async () => {
  const reached = { atLimit: 0, belowLimit: 0, long: 0, leakAttempts: 0 };

  await fc.assert(
    fc.asyncProperty(
      runId,
      secretName,
      secretValue,
      plainName,
      fc.constantFrom('/usr/bin:/bin', 'auto', 'en_GB'),
      fc.constantFrom('deploy the staging key', 'what is the bot token', 'ship it'),
      async (id, sName, sValue, pName, pValue, prompt) => {
        const env = { [sName]: sValue, [pName]: pValue };
        // COLLISION BY CONSTRUCTION: the reason is DERIVED from the secret -
        // the transformation a real SDK auth error performs, quoting back the
        // credential it rejected - so every generated case is a leak
        // candidate. Its near-miss twin quotes a NON-secret value, which must
        // survive: a redactor that blanked everything would pass this
        // invariant while making the log useless.
        const reason = `auth rejected for ${sValue} while model ${pValue} was selected`;
        reached.leakAttempts++;

        const lines = [];
        try {
          await runCursorAgentPrompt(stubAgent('error', id, reason), prompt, undefined, {
            sink: (line) => lines.push(line),
            now: () => AT,
            env,
          });
        } catch {
          // the failure itself is invariant 1's business
        }
        const line = lines.find((l) => l.includes(CURSOR_RUN_FAILURE_MARKER));
        assert.ok(line, 'the failure must still be recorded');

        // No conversation content, ever - unconditional, because the line is
        // built from three fields and a prompt has no way in.
        assert.ok(!line.includes(prompt), 'the prompt text reached the log');
        assert.ok(!line.includes('the assistant reply text'), 'the reply text reached the log');

        if (sValue.length >= MIN_REDACTABLE_SECRET_LENGTH) {
          assert.ok(!line.includes(sValue), `the ${sName} value reached the log`);
          assert.ok(line.includes('[redacted]'), 'the credential must be visibly redacted, not silently dropped');
          if (sValue.length === MIN_REDACTABLE_SECRET_LENGTH) reached.atLimit++;
          else reached.long++;
        } else {
          // The stated limit, asserted rather than assumed: below the
          // threshold nothing is blanked, so a change to the threshold shows
          // up here instead of silently widening or narrowing redaction.
          reached.belowLimit++;
          assert.ok(line.includes(sValue), 'below the limit the value is deliberately left alone');
        }
        // The near miss: an ordinary variable's value is never blanked.
        assert.ok(line.includes(pValue), `${pName}'s ordinary value must survive redaction`);
        return true;
      }
    ),
    { numRuns: RUNS }
  );

  assert.ok(reached.atLimit >= 20, `exactly-at-the-limit secrets too rare: ${reached.atLimit}`);
  assert.ok(reached.belowLimit >= 20, `one-below-the-limit secrets too rare: ${reached.belowLimit}`);
  assert.ok(reached.long >= 50, `realistic-length secrets too rare: ${reached.long}`);
  assert.ok(reached.leakAttempts >= RUNS, 'every case must be a leak candidate by construction');
});

test('invariant 2: only a secret-NAMED variable is ever redacted, judged by name alone', () => {
  fc.assert(
    fc.property(plainName, fc.stringMatching(/^[A-Za-z0-9:_-]{20,48}$/), (name, value) => {
      assert.deepEqual([...secretEnvironmentValues({ [name]: value })], []);
      assert.equal(redactEnvironmentSecrets(`saw ${value}`, { [name]: value }), `saw ${value}`);
      return true;
    }),
    { numRuns: RUNS }
  );
});

test('invariant 2: the line has room for exactly three fields, whatever is thrown at it', () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), fc.boolean(), (id, reason, reset) => {
      const line = formatCursorRunFailureLine({ at: AT, runId: id, reason, reset });
      assert.equal(line.split('\n').length, 1, 'one event is one greppable line');
      assert.ok(line.startsWith(`${AT} ${CURSOR_RUN_FAILURE_MARKER} run=`));
      assert.match(line, / reset=(yes|no) reason=/);
      return true;
    }),
    { numRuns: RUNS }
  );
});

test('invariant 2: a sink that throws loses the line but never the failure', () => {
  fc.assert(
    fc.property(runId, fc.constantFrom(...PLAIN_REASONS), (id, reason) => {
      const line = logCursorRunFailure(
        { runId: id, reason, reset: false },
        {
          sink: () => {
            throw new Error('log device full');
          },
          now: () => AT,
          env: {},
        }
      );
      assert.ok(line.includes(`run=${id}`));
      return true;
    }),
    { numRuns: RUNS }
  );
});
