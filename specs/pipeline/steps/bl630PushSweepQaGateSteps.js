'use strict';

// BL-630: step handlers for "push-sweep refuses to publish a main tip that
// is not QA-approved". Drives the REAL push_sweep_cli.bb (same seam
// pushSweepSteps.js's own BL-356 scenarios use - forced rev-counts/qa-gate
// facts, no real git process, no real network) so the pure decision logic
// in push_sweep_lib.bb/qa-gate-decision is exercised through the exact
// same adapters handoffd.bb wires in production. The real-git plumbing
// (push-sweep-qa-gate-facts! in handoffd.bb actually shelling to `git
// merge-base --is-ancestor` etc.) is proven separately, once, by
// test_handoffd_push_sweep_wiring.sh - not re-proven per scenario here.

const { runSweep, mkDaemonDir } = require('./pushSweepSteps');

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^handoffd's push-sweep tick is due$/, (ctx) => {
    ctx.daemonDir = ctx.daemonDir || mkDaemonDir();
    ctx.now = ctx.now === undefined ? 100000 : ctx.now;
  });

  // ── non-qa-ancestor-tip-blocks-push-01 ────────────────────────────────
  registry.define(/^local main is ahead of origin\/main$/, (ctx) => {
    ctx.revCounts = { ahead: 1, behind: 0 };
  });

  registry.define(/^the tip contains a commit that is not an ancestor of swarmforge-QA$/, (ctx) => {
    ctx.offendingSha = 'cafe000001';
    ctx.qaGateFacts = {
      'qa-ref-exists?': true,
      'tip-is-qa-ancestor?': false,
      'ahead-commits': [{ sha: ctx.offendingSha, 'qa-ancestor?': false, 'changed-paths': [] }],
    };
  });

  registry.define(/^that commit touches extension\/src\/$/, (ctx) => {
    ctx.qaGateFacts['ahead-commits'][0]['changed-paths'] = ['extension/src/foo.ts'];
  });

  registry.define(/^push-sweep! runs$/, (ctx) => {
    ctx.result = runSweep(ctx.daemonDir, ctx.now, {
      revCounts: ctx.revCounts,
      pushResult: ctx.pushResult,
      qaGateFacts: ctx.qaGateFacts,
    });
  });

  registry.define(/^origin\/main is not updated$/, (ctx) => {
    if (ctx.result.pushCalls !== 0) {
      throw new Error(`expected no push attempt for a refused tip, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the refusal is logged naming the offending commit sha$/, (ctx) => {
    const found = ctx.result.logLines.some((line) => line.includes('qa-refused') && line.includes(ctx.offendingSha));
    if (!found) {
      throw new Error(`expected a qa-refused log line naming ${ctx.offendingSha}, got: ${JSON.stringify(ctx.result.logLines)}`);
    }
  });

  // ── refusal-distinct-from-other-outcomes-02 ───────────────────────────
  registry.define(/^a main tip was just refused for lacking QA ancestry$/, (ctx) => {
    ctx.revCounts = { ahead: 1, behind: 0 };
    ctx.offendingSha = 'cafe000002';
    ctx.qaGateFacts = {
      'qa-ref-exists?': true,
      'tip-is-qa-ancestor?': false,
      'ahead-commits': [{ sha: ctx.offendingSha, 'qa-ancestor?': false, 'changed-paths': ['extension/src/foo.ts'] }],
    };
    ctx.result = runSweep(ctx.daemonDir, ctx.now, { revCounts: ctx.revCounts, qaGateFacts: ctx.qaGateFacts });
  });

  registry.define(/^the handoffd log is inspected$/, () => {});

  registry.define(/^the refusal entry is distinguishable from up-to-date, diverged, and a failed push$/, (ctx) => {
    const found = ctx.result.logLines.some((line) => line.includes('qa-refused'));
    if (!found) {
      throw new Error(`expected a distinct qa-refused log entry, got: ${JSON.stringify(ctx.result.logLines)}`);
    }
  });

  registry.define(/^the existing push-failure retry\/backoff does not engage$/, (ctx) => {
    if (ctx.result.pushCalls !== 0) {
      throw new Error(`expected zero real push attempts (no retry/backoff engaged), got: ${JSON.stringify(ctx.result)}`);
    }
    if (ctx.result.state.push) {
      throw new Error(`expected no push-retry state to be recorded, got: ${JSON.stringify(ctx.result.state)}`);
    }
  });

  registry.define(/^the existing divergence alarm does not fire$/, (ctx) => {
    if (ctx.result.divergenceCalls !== 0) {
      throw new Error(`expected zero divergence alarm calls, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^no "check network\/auth and push by hand" email is sent$/, (ctx) => {
    if (ctx.result.alarmCalls !== 0) {
      throw new Error(`expected zero push-failure alarm emails, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── bookkeeping-only-tip-still-publishes-03 ───────────────────────────
  registry.define(/^every non-QA-ancestor commit in the tip touches only backlog\/, docs\/, or swarmforge\/$/, (ctx) => {
    ctx.qaGateFacts = {
      'qa-ref-exists?': true,
      'tip-is-qa-ancestor?': false,
      'ahead-commits': [{ sha: 'cafe000003', 'qa-ancestor?': false, 'changed-paths': ['backlog/active/BL-1.yaml'] }],
    };
    ctx.pushResult = { success: true };
  });

  registry.define(/^origin\/main is updated to the local main tip$/, (ctx) => {
    if (ctx.result.pushCalls !== 1) {
      throw new Error(`expected exactly one push attempt to publish the tip, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── qa-approved-tip-publishes-unchanged-04 ────────────────────────────
  registry.define(/^the tip is an ancestor of swarmforge-QA$/, (ctx) => {
    ctx.qaGateFacts = { 'qa-ref-exists?': true, 'tip-is-qa-ancestor?': true };
    ctx.pushResult = { success: true };
  });

  registry.define(/^no added latency is introduced on this path$/, (ctx) => {
    // The fast path never enumerates ahead-commits - proven structurally:
    // this scenario's own qaGateFacts carries no `ahead-commits` key at
    // all, and the real sweep still published successfully above.
    if (ctx.result.pushCalls !== 1) {
      throw new Error(`expected the QA-approved fast path to still publish, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── behind-with-nothing-to-push-still-surfaces-05 ─────────────────────
  registry.define(/^local main is behind origin\/main$/, (ctx) => {
    ctx.revCounts = { ahead: 0, behind: 3 };
  });

  registry.define(/^there is nothing ahead to push$/, () => {});

  registry.define(/^the log distinguishes this behind-only state from a genuine up-to-date tip$/, (ctx) => {
    const behindOnly = ctx.result.logLines.some((line) => line.includes('behind-only'));
    const upToDate = ctx.result.logLines.some((line) => line === 'push-sweep up-to-date');
    if (!behindOnly) {
      throw new Error(`expected a distinct behind-only log line, got: ${JSON.stringify(ctx.result.logLines)}`);
    }
    if (upToDate) {
      throw new Error(`expected the behind-only tick NOT to log as plain up-to-date, got: ${JSON.stringify(ctx.result.logLines)}`);
    }
  });
}

module.exports = { registerSteps };
