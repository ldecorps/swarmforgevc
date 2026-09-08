'use strict';

// BL-1474: step handlers for "The replay reports why its commit was
// refused". Drives the REAL land-step-lib/replay! via bb -e (the shared
// `replay` helper from lib/bl1446LandFixture.js - never a
// reimplementation), against a fixture repository with a real refusing
// git hook installed via `core.hooksPath`, fixture-rooted (constraints:
// never the live hooks path).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { git, commit, initRepo, markOriginMainHere, replay, mkTmpDir } = require('./lib/bl1446LandFixture');

const FEATURE = 'BL-1474 The replay reports why its commit was refused';
const TASK_TICKET_ID = 'BL-9001';
const OWN_PATH = 'backlog/active/BL-9001-x.yaml';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

// Fixture hooks live under the fixture root, never the live hooks path
// (constraints) - `core.hooksPath` is ordinary repo config, so it applies
// inside the scratch worktree replay! builds too.
function installRefusingHook(root, stderrText) {
  const hooksDir = path.join(root, 'fixture-hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookBody = ['#!/bin/sh', stderrText ? `printf '%s\\n' "${stderrText}" >&2` : '', 'exit 1', ''].join('\n');
  const hookPath = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(hookPath, hookBody);
  fs.chmodSync(hookPath, 0o755);
  git(root, 'config', 'core.hooksPath', hooksDir);
}

const KNOWN_OUTLINE_ROWS = [
  { index: 'empty', exit: 'non-zero with no stderr', reason: 'nothing to commit' },
  { index: 'non-empty', exit: 'non-zero with stderr', reason: 'the stderr text' },
  { index: 'non-empty', exit: 'non-zero with no stderr', reason: 'commit refused, no text' },
];

function registerSteps(registry) {
  scoped(registry, /^a fixture repository with an origin and a parcel whose replay is being built$/, (ctx) => {
    ctx.root = mkTmpDir('bl1474-fixture-');
    initRepo(ctx.root);
  });

  scoped(
    registry,
    /^the replay's index holds the parcel's paths and a commit-time guard refuses the commit$/,
    (ctx) => {
      markOriginMainHere(ctx.root);
      ctx.commitSha = commit(ctx.root, OWN_PATH, 'id: BL-9001\n', `${TASK_TICKET_ID}: own work`);
      ctx.expectedGuardMessage = 'merge-deletion guard: refusing 40 deleted paths';
      installRefusingHook(ctx.root, ctx.expectedGuardMessage);
    }
  );

  scoped(registry, /^the replay's index holds nothing because every own path equals origin\/main$/, (ctx) => {
    ctx.commitSha = commit(ctx.root, OWN_PATH, 'id: BL-9001\n', `${TASK_TICKET_ID}: already on origin/main`);
    markOriginMainHere(ctx.root);
  });

  scoped(
    registry,
    /^the replay's index is (empty|non-empty) and the commit exits (non-zero with no stderr|non-zero with stderr)$/,
    (ctx, index, exit) => {
      const row = KNOWN_OUTLINE_ROWS.find((r) => r.index === index && r.exit === exit);
      if (!row) {
        throw new Error(`bl1474: unrecognized <index>/<exit> example combination "${index}" / "${exit}"`);
      }
      ctx.expectedReasonKind = row.reason;
      if (index === 'empty') {
        ctx.commitSha = commit(ctx.root, OWN_PATH, 'id: BL-9001\n', `${TASK_TICKET_ID}: already on origin/main`);
        markOriginMainHere(ctx.root);
      } else {
        markOriginMainHere(ctx.root);
        ctx.commitSha = commit(ctx.root, OWN_PATH, 'id: BL-9001\n', `${TASK_TICKET_ID}: own work`);
        ctx.expectedStderr = exit === 'non-zero with stderr' ? 'a guard refused this commit' : null;
        installRefusingHook(ctx.root, ctx.expectedStderr);
      }
    }
  );

  scoped(registry, /^the replay attempts its commit$/, (ctx) => {
    ctx.result = replay(ctx.root, ctx.commitSha, TASK_TICKET_ID, [OWN_PATH], []);
  });

  scoped(registry, /^the escalate reason carries the guard's own message$/, (ctx) => {
    assert.equal(ctx.result.success, false, `expected the commit to be refused: ${JSON.stringify(ctx.result)}`);
    assert.ok(
      ctx.result.reason.includes(ctx.expectedGuardMessage),
      `expected the reason to carry "${ctx.expectedGuardMessage}", got: ${ctx.result.reason}`
    );
  });

  scoped(registry, /^the reason does not say the own-paths are identical to origin\/main$/, (ctx) => {
    assert.ok(
      !ctx.result.reason.includes('own-paths identical to origin/main'),
      `expected no "nothing to commit" text, got: ${ctx.result.reason}`
    );
  });

  scoped(registry, /^the escalate reason says nothing to commit for the parcel$/, (ctx) => {
    assert.equal(ctx.result.success, false, `expected the empty index to be a failure: ${JSON.stringify(ctx.result)}`);
    assert.ok(
      ctx.result.reason.includes('nothing to commit') && ctx.result.reason.includes(TASK_TICKET_ID),
      `expected a "nothing to commit" reason naming ${TASK_TICKET_ID}, got: ${ctx.result.reason}`
    );
  });

  scoped(
    registry,
    /^the escalate reason is (nothing to commit|the stderr text|commit refused, no text)$/,
    (ctx, reasonKind) => {
      assert.equal(
        reasonKind,
        ctx.expectedReasonKind,
        `example table <reason> "${reasonKind}" does not match the Given step's row "${ctx.expectedReasonKind}"`
      );
      assert.equal(ctx.result.success, false, `expected a refused commit: ${JSON.stringify(ctx.result)}`);
      switch (reasonKind) {
        case 'nothing to commit':
          assert.ok(
            ctx.result.reason.includes('nothing to commit'),
            `expected "nothing to commit", got: ${ctx.result.reason}`
          );
          break;
        case 'the stderr text':
          assert.ok(
            ctx.result.reason.includes(ctx.expectedStderr),
            `expected the reason to carry "${ctx.expectedStderr}", got: ${ctx.result.reason}`
          );
          break;
        case 'commit refused, no text':
          assert.ok(
            ctx.result.reason.includes('commit refused') && ctx.result.reason.includes('no text'),
            `expected a no-text refusal, got: ${ctx.result.reason}`
          );
          break;
        default:
          throw new Error(`bl1474: unrecognized <reason> example value "${reasonKind}"`);
      }
    }
  );
}

module.exports = { registerSteps };
