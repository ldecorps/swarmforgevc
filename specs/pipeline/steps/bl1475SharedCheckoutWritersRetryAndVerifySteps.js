'use strict';

// BL-1475: step handlers for "Writers on the shared checkout retry a
// transient index lock and verify durability before alarming". Two
// separate real mechanisms, each driven directly (never reimplemented):
//
//   - the front desk's human-decision commit (commit_integrity_cli.bb /
//     commit_integrity_lib.bb) - driven via a small acceptance-test seam
//     CLI (commit_integrity_1475_scenarios_cli.bb) that injects only the
//     ONE thing needed to simulate "a second writer holds .git/index.lock
//     for an injected duration" (the SAME retry-delay-fn! seam
//     commit-with-integrity! already calls for its own backoff, so no real
//     wait ever happens - BL-1390), mirroring the existing BL-856
//     acceptance seam precedent for this same library. The TS-side wiring
//     of the CLI's JSON (`reason: 'landed-elsewhere'`, `sha`, `stderr`)
//     into the front desk's own Telegram message is unit-tested directly
//     in telegramFrontDeskBotCore.test.js/commitIntegrityRunner.test.js -
//     this suite proves the underlying babashka mechanism end to end
//     against a real git fixture.
//   - the daemon's topic-record commit (gitCommitScopedFile.ts's
//     commitScopedFile, via blTopicStore.ts's commitTopicRecord) - driven
//     directly, in-process, with injected attemptCommit/sleep seams
//     (commitTopicRecord's own BL-1475 pass-through params).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCENARIOS_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'commit_integrity_1475_scenarios_cli.bb');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const { commitTopicRecord, recordPath } = require(path.join(EXT_OUT, 'concierge', 'blTopicStore'));

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

function mkGitRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1475-')));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return dir;
}

// Runs the real commit-with-integrity! (through the acceptance seam CLI)
// and returns both the parsed JSON result and whether the subprocess
// exited non-zero - mirrors the production CLI's own exit-code contract
// (BL-856's own runScenariosCli precedent).
function runScenariosCli(dir, { message, relPath, scenario, heldSeconds }) {
  const args = [SCENARIOS_CLI, dir, '--message', message, '--path', relPath, '--scenario', scenario];
  if (heldSeconds !== undefined) {
    args.push('--held-seconds', String(heldSeconds));
  }
  let stdout;
  let failed = false;
  try {
    stdout = execFileSync('bb', args, { encoding: 'utf8' });
  } catch (err) {
    failed = true;
    stdout = err.stdout;
  }
  return { parsed: JSON.parse(stdout), processFailed: failed };
}

// The daemon's own topic-record path: mirrors the front-desk seam CLI's
// own "held for N simulated seconds" trick, but in-process against
// commitScopedFile's real CommitAttemptFn/SleepFn contract - no real wait
// ever happens (sleep only advances the simulated clock).
function heldThenReleaseAttemptCommit(heldSeconds, elapsed) {
  return (targetPath, filePath, commitMessage) => {
    if (elapsed.ms >= heldSeconds * 1000) {
      git(targetPath, ['add', '--', filePath]);
      try {
        git(targetPath, ['commit', '-q', '-m', commitMessage, '--', filePath]);
        return { committed: true };
      } catch {
        return { committed: false, retryable: false, stderr: 'unexpected real commit failure' };
      }
    }
    return { committed: false, retryable: true, stderr: "fatal: Unable to create '.git/index.lock': File exists." };
  };
}

function noRealWaitSleep(elapsed) {
  return (ms) => {
    elapsed.ms += ms;
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^a fixture repository with a shared checkout, a ticket YAML and a topic record, and a second writer that can hold \.git\/index\.lock for an injected duration$/,
    (ctx) => {
      ctx.dir = mkGitRepo();
      ctx.ticketRelPath = 'ticket.yaml';
      fs.writeFileSync(path.join(ctx.dir, ctx.ticketRelPath), 'human_approval: pending\n');
      git(ctx.dir, ['add', '--', ctx.ticketRelPath]);
      git(ctx.dir, ['commit', '-q', '-m', 'seed ticket']);
      // The front desk's OWN attempt below always writes a genuinely new
      // value - never byte-identical to the seed - so a real (non-lock)
      // "nothing to commit" never masquerades as the scenario under test.
      fs.writeFileSync(path.join(ctx.dir, ctx.ticketRelPath), 'human_approval: approved\n');
      // Must match blTopicStore's own TICKET_ID pattern (BL|GH)-\d+ - a
      // non-numeric suffix would classify as 'unbound' and silently skip
      // every commit attempt (BL-695 fail-closed).
      ctx.ticketId = 'BL-1475901';
      ctx.topicRecordPath = recordPath(ctx.dir, ctx.ticketId);
      fs.mkdirSync(path.dirname(ctx.topicRecordPath), { recursive: true });
      fs.writeFileSync(ctx.topicRecordPath, JSON.stringify({ id: ctx.ticketId, messages: [] }));
    }
  );

  // ── scenario 01 ──────────────────────────────────────────────────────
  registry.define(/^the second writer holds the index lock for (\d+) seconds$/, (ctx, held) => {
    ctx.scenario = 'hold-then-release';
    ctx.heldSeconds = Number(held);
  });

  // ── scenario 02 ──────────────────────────────────────────────────────
  registry.define(/^the second writer holds the index lock past the retry bound$/, (ctx) => {
    ctx.scenario = 'hold-past-bound';
  });

  // ── scenario 03 ──────────────────────────────────────────────────────
  registry.define(/^the second writer's own commit captured the flipped ticket YAML before the front desk's attempt$/, (ctx) => {
    ctx.scenario = 'landed-elsewhere';
  });

  // ── scenarios 01/02/03 When ──────────────────────────────────────────
  registry.define(/^the front desk commits an approval flip for the ticket$/, (ctx) => {
    ctx.result = runScenariosCli(ctx.dir, {
      message: 'Approve BL-1475-fixture: record human_approval',
      relPath: ctx.ticketRelPath,
      scenario: ctx.scenario,
      heldSeconds: ctx.heldSeconds,
    });
  });

  // ── scenario 01 Then ─────────────────────────────────────────────────
  registry.define(/^the commit lands within the retry bound and no durability alarm is raised$/, (ctx) => {
    if (ctx.result.processFailed || ctx.result.parsed.success !== true) {
      throw new Error(`expected the commit to land with no alarm, got: ${JSON.stringify(ctx.result)}`);
    }
    const status = git(ctx.dir, ['status', '--porcelain', '--', ctx.ticketRelPath]).trim();
    if (status) {
      throw new Error(`expected the ticket path clean (landed), got status: "${status}"`);
    }
  });

  // ── scenario 02 Then ─────────────────────────────────────────────────
  registry.define(/^the durability alarm is raised carrying git's index-lock message$/, (ctx) => {
    if (!ctx.result.processFailed || ctx.result.parsed.success !== false) {
      throw new Error(`expected a raised alarm (failure), got: ${JSON.stringify(ctx.result)}`);
    }
    if (!ctx.result.parsed.stderr || !ctx.result.parsed.stderr.includes('index.lock')) {
      throw new Error(`expected git's own index.lock message in the result, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── scenario 03 Then ─────────────────────────────────────────────────
  registry.define(/^no durability alarm is raised$/, (ctx) => {
    if (ctx.result.processFailed || ctx.result.parsed.success !== true) {
      throw new Error(`expected no alarm (success), got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the Approvals topic is told the decision landed in that writer's commit, named by sha$/, (ctx) => {
    if (ctx.result.parsed.reason !== 'landed-elsewhere') {
      throw new Error(`expected reason "landed-elsewhere", got: ${JSON.stringify(ctx.result.parsed)}`);
    }
    const sha = ctx.result.parsed.sha;
    if (!sha) {
      throw new Error(`expected a landing sha in the result, got: ${JSON.stringify(ctx.result.parsed)}`);
    }
    const realSha = git(ctx.dir, ['log', '-1', '--format=%H']).trim();
    if (sha !== realSha) {
      throw new Error(`expected the reported sha to name the real HEAD commit (${realSha}), got: ${sha}`);
    }
    // The exact "landed in <sha> by another writer" Telegram message text
    // this fact drives is proven directly against commitApprovalDecision
    // in telegramFrontDeskBotCore.test.js.
  });

  // ── scenario 04 ──────────────────────────────────────────────────────
  registry.define(/^the daemon commits the topic record$/, (ctx) => {
    ctx.reportedFailures = [];
    const reportCommitFailure = (ticketId, filePath, detail) => {
      ctx.reportedFailures.push({ ticketId, filePath, detail });
    };
    if (ctx.scenario === 'hold-then-release') {
      const elapsed = { ms: 0 };
      ctx.committed = commitTopicRecord(
        ctx.dir,
        ctx.topicRecordPath,
        ctx.ticketId,
        reportCommitFailure,
        heldThenReleaseAttemptCommit(ctx.heldSeconds, elapsed),
        noRealWaitSleep(elapsed)
      );
    } else {
      // scenario 05: a real (non-lock) commit hook rejection - real
      // attemptCommit/sleep, no injection, so the real hook's own stderr
      // is what gets captured and reported.
      ctx.committed = commitTopicRecord(ctx.dir, ctx.topicRecordPath, ctx.ticketId, reportCommitFailure);
    }
  });

  // ── scenario 04 Then ─────────────────────────────────────────────────
  registry.define(/^the record is committed within the retry bound and its log carries no not-yet-durable line$/, (ctx) => {
    if (ctx.committed !== true) {
      throw new Error('expected the topic record commit to land within the retry bound');
    }
    if (ctx.reportedFailures.length !== 0) {
      throw new Error(`expected no not-yet-durable report, got: ${JSON.stringify(ctx.reportedFailures)}`);
    }
    const status = git(ctx.dir, ['status', '--porcelain', '--', ctx.topicRecordPath]).trim();
    if (status) {
      throw new Error(`expected the topic record clean (committed), got status: "${status}"`);
    }
  });

  // ── scenario 05 ──────────────────────────────────────────────────────
  registry.define(/^a commit hook in the fixture that refuses with a message$/, (ctx) => {
    ctx.scenario = 'real-hook-failure';
    const hooksDir = path.join(ctx.dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    ctx.hookMessage = 'refusing: BL-1475 fixture policy violation';
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), `#!/bin/sh\necho "${ctx.hookMessage}" >&2\nexit 1\n`);
    fs.chmodSync(path.join(hooksDir, 'pre-commit'), 0o755);
  });

  // ── scenario 05 Then ─────────────────────────────────────────────────
  registry.define(/^the not-yet-durable line carries the hook's message$/, (ctx) => {
    if (ctx.committed !== false) {
      throw new Error('expected the topic record commit to fail (the hook always refuses)');
    }
    if (ctx.reportedFailures.length !== 1) {
      throw new Error(`expected exactly one not-yet-durable report, got: ${JSON.stringify(ctx.reportedFailures)}`);
    }
    const { detail } = ctx.reportedFailures[0];
    if (!detail || !detail.includes(ctx.hookMessage)) {
      throw new Error(`expected the hook's own message in the reported detail, got: ${JSON.stringify(detail)}`);
    }
  });
}

module.exports = { registerSteps };
