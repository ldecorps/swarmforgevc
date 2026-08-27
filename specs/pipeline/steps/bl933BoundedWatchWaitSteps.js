'use strict';

// BL-933: step handlers for "a unit test waiting on a real fs.watch event
// fails fast and says what never arrived". Scenarios 01 and 03 are pure
// source-text checks against the three real test files (never executed -
// same "read the live file, assert on its literal content" pattern
// bl932SharedHeavyTimeoutSteps.js and bl654InvariantPropertyTestSteps.js
// use). Scenario 02 drives the real, compiled-free
// extension/test/helpers/boundedWatchWait.js helper in-process against a
// promise engineered to never resolve, to prove the bounded wait actually
// fails fast and names what never arrived - not merely that the source text
// mentions the helper.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_TEST = path.join(REPO_ROOT, 'extension', 'test');

const { awaitRealWatchEvent } = require(path.join(EXT_TEST, 'helpers', 'boundedWatchWait'));

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough that would lump a mutated token into a
// silent default.
const KNOWN_TESTS = {
  'bounce file creation is detected': {
    file: path.join(EXT_TEST, 'activateBounceWatcher.test.js'),
    testName: 'startBounceWatcher detects bounce file creation',
  },
  'a bounce-graceful file is detected': {
    file: path.join(EXT_TEST, 'bounceDrain.test.js'),
    testName: 'startGracefulBounceFileWatcher detects a bounce-graceful file and deletes it',
  },
  'real watch events reach the debounce': {
    file: path.join(EXT_TEST, 'bounceWatcher.test.js'),
    testName: 'startBounceWatcher wires real fs.watch events into the debounce',
  },
};

function parseTestToken(token) {
  const entry = KNOWN_TESTS[token];
  if (!entry) {
    throw new Error(`unknown test token: ${token}`);
  }
  return entry;
}

// Extracts just the named test()'s own body text, so a check below applies
// to the one test in scope and never accidentally matches an unrelated test
// in the same file (each of these three files has other tests with their
// own unrelated "await"s).
function extractTestBody(source, testName) {
  const marker = `test('${testName}'`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`test "${testName}" not found in source`);
  }
  const nextTestIdx = source.indexOf('\ntest(', start + marker.length);
  return nextTestIdx === -1 ? source.slice(start) : source.slice(start, nextTestIdx);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────────
  registry.define(/^the three unit tests that await a real fs\.watch event$/, (ctx) => {
    ctx.bl933Known = KNOWN_TESTS;
  });

  // ── Scenario Outline: each wait on a real watch event is bounded ────────
  registry.define(/^the test "([^"]+)"$/, (ctx, token) => {
    ctx.bl933Current = parseTestToken(token);
    const source = fs.readFileSync(ctx.bl933Current.file, 'utf8');
    ctx.bl933Body = extractTestBody(source, ctx.bl933Current.testName);
  });

  registry.define(/^its wait for the real watch event is inspected$/, (ctx) => {
    assert.ok(ctx.bl933Body, 'expected the test body to have been located first');
  });

  registry.define(/^the wait is bounded by an explicit deadline$/, (ctx) => {
    assert.match(
      ctx.bl933Body,
      /awaitRealWatchEvent\(/,
      `expected "${ctx.bl933Current.testName}" to wait via awaitRealWatchEvent, an explicit deadline`
    );
  });

  registry.define(/^no bare unbounded await on that event remains$/, (ctx) => {
    assert.doesNotMatch(
      ctx.bl933Body,
      /await captured;/,
      `expected no bare "await captured;" left in "${ctx.bl933Current.testName}"`
    );
  });

  // ── Scenario: an expired wait says what never arrived ────────────────────
  registry.define(/^a fixture in which the real watch event never arrives$/, (ctx) => {
    ctx.bl933NeverResolves = new Promise(() => {});
    ctx.bl933EventLabel = 'bounce file creation';
    ctx.bl933WatchedPath = '/tmp/bl933-fixture/bounce';
    ctx.bl933TimeoutMs = 200;
  });

  registry.define(/^the bounded wait expires$/, async (ctx) => {
    const startedAt = Date.now();
    try {
      await awaitRealWatchEvent(ctx.bl933NeverResolves, {
        eventLabel: ctx.bl933EventLabel,
        watchedPath: ctx.bl933WatchedPath,
        timeoutMs: ctx.bl933TimeoutMs,
      });
      throw new Error('expected the bounded wait to reject on expiry, but it resolved');
    } catch (err) {
      ctx.bl933Error = err;
      ctx.bl933ElapsedMs = Date.now() - startedAt;
    }
  });

  registry.define(/^the failure names the awaited watch event$/, (ctx) => {
    assert.match(ctx.bl933Error.message, /bounce file creation/, 'expected the failure to name the awaited event');
    assert.match(ctx.bl933Error.message, /\/tmp\/bl933-fixture\/bounce/, 'expected the failure to name the watched path');
  });

  registry.define(/^the failure is raised by the test's own deadline rather than by the lane budget$/, (ctx) => {
    assert.ok(
      ctx.bl933ElapsedMs < 20000,
      `expected the failure well under the 20000ms lane budget, took ${ctx.bl933ElapsedMs}ms`
    );
    assert.ok(
      ctx.bl933ElapsedMs >= ctx.bl933TimeoutMs,
      `expected the failure at or after the configured ${ctx.bl933TimeoutMs}ms deadline, took ${ctx.bl933ElapsedMs}ms`
    );
  });

  // ── Scenario: the watched events stay real ────────────────────────────────
  registry.define(/^the three tests' watcher setup is inspected$/, (ctx) => {
    ctx.bl933AllBodies = Object.values(KNOWN_TESTS).map(({ file, testName }) => {
      const source = fs.readFileSync(file, 'utf8');
      return { testName, body: extractTestBody(source, testName) };
    });
  });

  registry.define(/^each still observes real filesystem events$/, (ctx) => {
    for (const { testName, body } of ctx.bl933AllBodies) {
      assert.match(body, /fs\.writeFileSync\(/, `expected "${testName}" to still write a real file to trigger the watcher`);
    }
  });

  registry.define(/^no fake or stubbed watcher is substituted for the real one$/, (ctx) => {
    for (const { testName, body } of ctx.bl933AllBodies) {
      assert.doesNotMatch(
        body,
        /fakeWatcher|stubWatcher|mockWatcher/i,
        `expected "${testName}" to use the real watcher, not a fake/stub`
      );
    }
  });
}

module.exports = { registerSteps };
