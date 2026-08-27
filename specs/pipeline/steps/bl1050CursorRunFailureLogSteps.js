'use strict';

// BL-1050: step handlers for "A Cursor Remote run failure is recorded on this
// host, not only in a Telegram message".
//
// Everything here drives the REAL compiled bridge session
// (extension/out/bridge/cursorBridgeAgentSession.js) against a stubbed SDK
// agent, with the run-log sink APPENDING TO A REAL FILE named cursor-bridge.log
// - the same redirect cursor_bridge_supervisor.bb performs. The assertions then
// grep that file, exactly as the ticket's qa_e2e procedure does. No step
// re-implements the line format, the reset predicate or the thrown message in
// JS; a handler that did would keep passing after the production code it
// describes was deleted.
//
// The Background's claim about the supervisor is CHECKED against
// cursor_bridge_supervisor.bb rather than assumed, so a change that stopped
// redirecting stderr would fail this feature instead of leaving it green while
// the log went dark again.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SUPERVISOR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'cursor_bridge_supervisor.bb');
const SESSION = require(path.join(REPO_ROOT, 'extension', 'out', 'bridge', 'cursorBridgeAgentSession'));
const RUN_LOG = require(path.join(REPO_ROOT, 'extension', 'out', 'bridge', 'cursorBridgeRunLog'));

const RUN_ID = 'run-bl1050';
const AT = '2026-08-22T23:00:00.000Z';

// BL-421 Scenario Outline rule: every Examples: column value is validated
// against an explicit lookup, never passed through - a gherkin-mutator edit
// into an unrecognised value must fail the scenario, not slip into an else
// branch.
const KNOWN_RESET_DECISIONS = { reset: 'reset=yes', 'not-reset': 'reset=no' };
const KNOWN_RUN_STATUSES = { error: 'error', finished: 'success' };

// The credentials scenario 05 puts in the bridge's environment. Fixture values
// that no real key could collide with: the assertions check the variable NAME
// and the absence of the value, and never print a credential (the standing
// ~/.zshenv hazard on this host re-exports REAL keys over fixture ones).
const FIXTURE_ENV = {
  CURSOR_API_KEY: 'bl1050-cursor-key-must-never-reach-a-log',
  TELEGRAM_BOT_TOKEN: 'bl1050-bot-token-must-never-reach-a-log',
};

// The stream MUST yield an event summarizeSdkProgressLine actually renders, or
// onProgress is never invoked and scenario 03's "posting to Telegram fails"
// is inert whatever the Given sets. An `assistant` event renders to undefined;
// a `tool_call` renders, so the post is genuinely attempted.
function stubAgent(status, id, reason) {
  return {
    async send() {
      return {
        async *stream() {
          yield { type: 'tool_call', name: 'shell', status: 'running' };
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'reply text' }] } };
        },
        async wait() {
          return { status, id, error: reason === undefined ? undefined : { message: reason } };
        },
      };
    },
  };
}

// One run against a REAL cursor-bridge.log, created and removed inside this
// one call (BL-971): a throw between mkdtemp and the assertions must not leak
// the fixture root. The log's text is read back and kept on ctx, so every Then
// asserts against what actually landed on disk.
async function runAgainstRealLog(ctx, { status, reason, prompt = 'ping', progressSink }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl1050-cursor-bridge-')));
  try {
    const logFile = path.join(root, 'cursor-bridge.log');
    // The supervisor's own first line, so the fixture log starts the way the
    // live one does - with spawn lines and nothing else.
    fs.writeFileSync(logFile, `${AT} supervisor-spawn\n`);
    const deps = {
      sink: (line) => fs.appendFileSync(logFile, `${line}\n`),
      now: () => AT,
      env: ctx.bridgeEnv ?? {},
    };
    ctx.thrown = undefined;
    try {
      await SESSION.runCursorAgentPrompt(stubAgent(status, RUN_ID, reason), prompt, progressSink, deps);
    } catch (err) {
      ctx.thrown = err;
    }
    ctx.logText = fs.readFileSync(logFile, 'utf8');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// The progress callback the Cursor Remote topic renders - i.e. "posting to
// Telegram". When scenario 03 has armed a failing post it THROWS, which is the
// whole point of that scenario: the record must already exist by then, because
// the log write happens where the failure is decided rather than in the code
// path that also posts.
function telegramSink(ctx) {
  ctx.postAttempts = 0;
  if (ctx.telegramFails) {
    return () => {
      ctx.postAttempts++;
      throw new Error('telegram post failed');
    };
  }
  return (line) => {
    ctx.postAttempts++;
    ctx.topicMessages.push(line);
  };
}

function failureLines(ctx) {
  return ctx.logText
    .split('\n')
    .filter((line) => line.includes(RUN_LOG.CURSOR_RUN_FAILURE_MARKER));
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.define(/^a Cursor Remote bridge running under its supervisor$/, (ctx) => {
    ctx.bridgeEnv = {};
    ctx.topicMessages = [];
    assert.equal(
      typeof SESSION.runCursorAgentPrompt,
      'function',
      'the compiled bridge session must expose runCursorAgentPrompt'
    );
  });

  registry.define(/^the supervisor redirects the bridge's output to "([^"]+)"$/, (ctx, logName) => {
    const supervisor = fs.readFileSync(SUPERVISOR, 'utf8');
    assert.match(
      supervisor,
      new RegExp(`bridge-log-file[\\s\\S]*${logName.replace('.', '\\.')}`),
      `${path.basename(SUPERVISOR)} must name ${logName} as the bridge log`
    );
    for (const stream of [':out-file', ':err-file']) {
      assert.ok(
        supervisor.includes(`${stream} (str bridge-log-file)`),
        `${path.basename(SUPERVISOR)} must redirect ${stream} into the bridge log`
      );
    }
    ctx.logName = logName;
  });

  // ── cursor-run-failure-log-01 / 02 / 03 / 04 ────────────────────────────
  registry.define(/^a Cursor run ends with status "([^"]+)" and reason "([^"]+)"$/, async (ctx, status, reason) => {
    const sdkStatus = KNOWN_RUN_STATUSES[status];
    assert.ok(sdkStatus, `unknown run status "${status}" - known: ${Object.keys(KNOWN_RUN_STATUSES).join(', ')}`);
    ctx.reason = reason;
    await runAgainstRealLog(ctx, { status: sdkStatus, reason, progressSink: telegramSink(ctx) });
  });

  registry.define(/^a Cursor run ends with status "([^"]+)"$/, async (ctx, status) => {
    const sdkStatus = KNOWN_RUN_STATUSES[status];
    assert.ok(sdkStatus, `unknown run status "${status}" - known: ${Object.keys(KNOWN_RUN_STATUSES).join(', ')}`);
    await runAgainstRealLog(ctx, { status: sdkStatus, reason: undefined });
  });

  registry.define(/^"([^"]+)" gains a line naming that run id$/, (ctx, logName) => {
    assert.equal(logName, ctx.logName);
    if (ctx.telegramFails) {
      // Scenario 03 only proves anything if the post really was ATTEMPTED and
      // really did throw. Assert both here rather than trusting the Given: a
      // stream that stopped producing a postable event, or a sink that stopped
      // throwing, would silently turn this back into a copy of scenario 01 -
      // which is exactly how it was first written.
      assert.ok(ctx.postAttempts > 0, 'the Telegram post was never attempted, so nothing could fail');
      assert.ok(ctx.thrown, 'the run must still surface a failure to its caller');
      assert.deepEqual(ctx.topicMessages, [], 'a failing post must post nothing');
    }
    const lines = failureLines(ctx);
    assert.equal(lines.length, 1, `expected one failure line in ${logName}, got ${lines.length}`);
    assert.match(lines[0], new RegExp(`run=${RUN_ID}\\b`));
  });

  registry.define(/^that line names the reason "([^"]+)"$/, (ctx, reason) => {
    assert.match(failureLines(ctx)[0], new RegExp(`reason=${reason}$`));
  });

  registry.define(/^"([^"]+)" records the session reset decision as "([^"]+)"$/, (ctx, logName, decision) => {
    const token = KNOWN_RESET_DECISIONS[decision];
    assert.ok(token, `unknown decision "${decision}" - known: ${Object.keys(KNOWN_RESET_DECISIONS).join(', ')}`);
    assert.equal(logName, ctx.logName);
    const lines = failureLines(ctx);
    assert.equal(lines.length, 1, `expected one failure line in ${logName}, got ${lines.length}`);
    assert.ok(
      lines[0].includes(token),
      `expected "${token}" for reason "${ctx.reason}" in: ${lines[0]}`
    );
  });

  registry.define(/^"([^"]+)" gains no failure line$/, (ctx, logName) => {
    assert.equal(logName, ctx.logName);
    assert.deepEqual(failureLines(ctx), [], 'a successful run must add nothing to the log');
    assert.match(ctx.logText, /supervisor-spawn/, 'the fixture log must still hold its spawn line');
  });

  // ── cursor-run-failure-log-03 ───────────────────────────────────────────
  registry.define(/^posting to Telegram fails$/, (ctx) => {
    // ARMS the failing post [telegramSink] then builds. Without this the
    // scenario ran byte-identical steps to scenario 01 and proved nothing
    // beyond it (architect send-back #1, 2026-08-23): a regression that made
    // the log write depend on a successful post would have gone straight
    // through it.
    ctx.topicMessages = [];
    ctx.telegramFails = true;
  });

  // ── cursor-run-failure-log-05 ───────────────────────────────────────────
  registry.define(/^the bridge holds an API key and a bot token in its environment$/, (ctx) => {
    ctx.bridgeEnv = { ...FIXTURE_ENV };
    for (const name of Object.keys(FIXTURE_ENV)) {
      assert.ok(ctx.bridgeEnv[name], `${name} must be set for this scenario to prove anything`);
    }
  });

  registry.define(
    /^a Cursor run carrying the prompt "([^"]+)" ends with status "([^"]+)"$/,
    async (ctx, prompt, status) => {
      const sdkStatus = KNOWN_RUN_STATUSES[status];
      assert.ok(sdkStatus, `unknown run status "${status}"`);
      ctx.prompt = prompt;
      // The SDK's reason carries the API key, which is how a real auth failure
      // leaks one: the reason is the SDK's text, not the bridge's.
      await runAgainstRealLog(ctx, {
        status: sdkStatus,
        reason: `auth rejected for ${FIXTURE_ENV.CURSOR_API_KEY}`,
        prompt,
      });
    }
  );

  registry.define(/^"([^"]+)" names no value from the bridge's environment$/, (ctx, logName) => {
    assert.equal(logName, ctx.logName);
    for (const name of Object.keys(ctx.bridgeEnv)) {
      assert.ok(
        !ctx.logText.includes(ctx.bridgeEnv[name]),
        `${name}'s value reached ${logName}`
      );
    }
    assert.match(failureLines(ctx)[0], /\[redacted\]/, 'the leaked credential must be visibly redacted');
  });

  registry.define(/^"([^"]+)" does not name the prompt text$/, (ctx, logName) => {
    assert.equal(logName, ctx.logName);
    assert.ok(!ctx.logText.includes(ctx.prompt), `the prompt text reached ${logName}`);
  });

  // ── cursor-run-failure-log-06 ───────────────────────────────────────────
  registry.define(/^the Cursor Remote topic is told "([^"]+)" with that run id and that reason$/, (ctx, wording) => {
    assert.ok(ctx.thrown, 'the run must still fail the way the topic reports it');
    const message = ctx.thrown.message;
    assert.match(message, new RegExp(`^${wording}`));
    assert.ok(message.includes(RUN_ID), 'the reported failure must still name the run id');
    assert.ok(message.includes(ctx.reason), 'the reported failure must still name the reason');
  });

  registry.define(/^no log line text reaches the Cursor Remote topic$/, (ctx) => {
    assert.ok(!ctx.thrown.message.includes(RUN_LOG.CURSOR_RUN_FAILURE_MARKER));
    for (const line of ctx.topicMessages) {
      assert.ok(!line.includes(RUN_LOG.CURSOR_RUN_FAILURE_MARKER), `a log line reached the topic: ${line}`);
    }
  });
}

module.exports = { registerSteps };
