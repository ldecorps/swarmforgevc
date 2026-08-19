'use strict';

// BL-952: step handlers for "A parcel QA bounced never reads as
// QA-approved". Scenarios 01/04/05 drive the shared verdict predicate
// (swarmforge/scripts/is_qa_ancestor.sh - the ONE definition the handoffd
// publish gate shells per BL-925 invariant 2) and, for scenario 05, the
// second consumer check_pipeline_code_on_main.sh. Scenarios 02/03 drive
// the REAL handoffd daemon against a fixture repo with a real bare remote
// - the exact test_handoffd_push_sweep_wiring.sh recipe - so the refusal
// is the real facts-gatherer + qa-gate-decision chain, never a
// reimplementation.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PREDICATE = path.join(SCRIPTS_DIR, 'is_qa_ancestor.sh');
const HANDOFFD = path.join(SCRIPTS_DIR, 'handoffd.bb');
const CHECK_PIPELINE = path.join(SCRIPTS_DIR, 'check_pipeline_code_on_main.sh');

const FEATURE = 'A parcel QA bounced never reads as QA-approved';

let trackedRoots = [];
let trackedDaemons = [];
afterEach(() => {
  while (trackedDaemons.length) {
    const { root, proc } = trackedDaemons.pop();
    try {
      fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'stop'), '');
    } catch {
      /* root already gone */
    }
    try {
      proc.kill('SIGTERM');
    } catch {
      /* already dead */
    }
  }
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  return root;
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function commitTouching(root, relPath, content, subject) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', subject]);
  return git(root, ['rev-parse', 'HEAD']);
}

function short10(sha) {
  return sha.slice(0, 10);
}

function recordBounce(root, sha) {
  const dir = path.join(root, '.swarmforge', 'bounces');
  fs.mkdirSync(dir, { recursive: true });
  const record = `{"ticket":"BL-9","producingRole":"coder","ticketType":"defect","failureClass":"unit","commit":"${short10(sha)}","by":"QA","at":"2026-08-19T12:00:00.000Z"}\n`;
  fs.appendFileSync(path.join(dir, '2026-08.jsonl'), record);
}

// The Background fixture: a repo whose QA ref holds one BOUNCED parcel
// (merged for review, verdict recorded, never reverted) and one genuinely
// APPROVED parcel, plus an unreviewed commit off the ref.
function mkVerdictFixture() {
  const root = mkTmp('sfvc-bl952-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
  const approved = commitTouching(root, 'extension/src/good.ts', 'approved work\n', 'approved parcel');
  const bounced = commitTouching(root, 'extension/src/bad.ts', 'bounced work\n', 'bounced parcel');
  git(root, ['branch', 'swarmforge-QA']); // both reachable: QA merged both to review them
  const fix = commitTouching(root, 'extension/src/bad.ts', 'fixed work\n', 'bounce fix, not yet re-reviewed');
  git(root, ['checkout', '-q', '-b', 'unreviewed', 'main~2']);
  const unreviewed = commitTouching(root, 'extension/src/other.ts', 'never sent\n', 'never reviewed');
  git(root, ['checkout', '-q', 'main']);
  recordBounce(root, bounced);
  return { root, approved, bounced, fix, unreviewed };
}

// QA bounce (2026-08-19): every subprocess here neutralizes the invoking
// role's own SWARMFORGE_ROLE before spawning - the same posture
// startDaemon() below takes with the Telegram/Resend vars. The scenarios
// simulate a generic caller, and inheriting the runner's role identity
// made scenario 10 flip pass/fail by WHO ran it: under QA's own shell,
// check_pipeline_code_on_main.sh's deliberate role-QA early exit fired
// before the merge-head/bounce logic under test was ever reached.
function neutralizedEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  delete env.SWARMFORGE_ROLE;
  return env;
}

function askPredicate(root, sha, { env } = {}) {
  const res = spawnSync('bash', [PREDICATE, sha], {
    cwd: root,
    encoding: 'utf8',
    env: neutralizedEnv(env),
  });
  return { exitCode: res.status ?? 99, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// ── the real daemon, for scenarios 02/03 (the wiring-test recipe) ─────────
function mkDaemonFixture() {
  const root = mkTmp('sfvc-bl952-daemon-');
  const remote = mkTmp('sfvc-bl952-remote-');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  git(root, ['init', '-q', '-b', 'main']);
  commitTouching(root, 'seed.txt', 'first\n', 'seed commit');
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-q', 'origin', 'main']);

  const sf = path.join(root, '.swarmforge');
  for (const d of [
    'handoffs/inbox/new',
    'handoffs/coordinator/inbox/new',
    'handoffs/coordinator/inbox/in_process',
    'handoffs/coordinator/inbox/completed',
    'daemon',
  ]) {
    fs.mkdirSync(path.join(sf, d), { recursive: true });
  }
  for (const d of ['docs/briefings', 'backlog/active', 'backlog/paused', 'backlog/done']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(sf, 'tmux-socket'), path.join(root, 'fake.sock'));
  fs.writeFileSync(
    path.join(sf, 'roles.tsv'),
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`
  );
  // Neutralize the unrelated briefing sweep, same as the shell wiring test.
  const dayKey = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(root, 'docs', 'briefings', `${dayKey}.md`), 'Headline: unrelated\n');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(bin, 'tmux'), 0o755);
  return { root, remote, bin };
}

function startDaemon(fixture) {
  const env = { ...process.env };
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.TELEGRAM_CHAT_ID;
  delete env.RESEND_API_KEY;
  env.PATH = `${fixture.bin}:${env.PATH}`;
  env.SWARMFORGE_ALLOW_TMP_DAEMON = '1';
  const proc = spawn('bb', [HANDOFFD, fixture.root], { env, stdio: 'ignore', detached: false });
  trackedDaemons.push({ root: fixture.root, proc });
  return proc;
}

async function waitForLog(fixture, pattern, timeoutMs) {
  const logFile = path.join(fixture.root, '.swarmforge', 'daemon', 'handoffd.log');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.readFileSync(logFile, 'utf8').includes(pattern)) {
        return true;
      }
    } catch {
      /* log not created yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function stopDaemon(fixture) {
  fs.writeFileSync(path.join(fixture.root, '.swarmforge', 'daemon', 'stop'), '');
}

const VERDICT_VALUES = {
  approved: (ctx) => ctx.fixture.approved,
  bounced: (ctx) => ctx.fixture.bounced,
  'bounced then fixed': (ctx) => ctx.fixture.bounced, // the BOUNCED sha itself, with a fix commit alongside
  'never reviewed': (ctx) => ctx.fixture.unreviewed,
};

const CAUSE_BUILDERS = {
  'the commit does not resolve': (ctx) => {
    ctx.sha = 'ffffffffff';
  },
  'the verdict record is missing': (ctx) => {
    // The store that should hold the verdict is obstructed - a file sits
    // where the record directory belongs, so no record can be consulted.
    ctx.sha = ctx.fixture.approved;
    const dir = path.join(ctx.fixture.root, '.swarmforge', 'bounces');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, '');
  },
  'the verdict record is corrupt': (ctx) => {
    ctx.sha = ctx.fixture.approved;
    fs.appendFileSync(
      path.join(ctx.fixture.root, '.swarmforge', 'bounces', '2026-08.jsonl'),
      'this line is not a record\n'
    );
  },
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a repository whose QA ref holds a parcel QA has already bounced$/,
    (ctx) => {
      ctx.fixture = mkVerdictFixture();
    },
    FEATURE
  );

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^a parcel whose QA verdict is (.+)$/,
    (ctx, verdict) => {
      if (!Object.prototype.hasOwnProperty.call(VERDICT_VALUES, verdict)) {
        throw new Error(`unknown <verdict> token: ${verdict}`);
      }
      ctx.sha = VERDICT_VALUES[verdict](ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the publish gate is asked whether that parcel's commit is QA-approved$/,
    (ctx) => {
      ctx.answer = askPredicate(ctx.fixture.root, ctx.sha);
    },
    FEATURE
  );

  registry.defineScoped(
    /^it answers (yes|no)$/,
    (ctx, expected) => {
      if (expected === 'yes') {
        assert.equal(ctx.answer.exitCode, 0, `expected approved (exit 0), got ${ctx.answer.exitCode}:\n${ctx.answer.stderr}`);
      } else {
        assert.equal(ctx.answer.exitCode, 1, `expected a clean no (exit 1), got ${ctx.answer.exitCode}:\n${ctx.answer.stderr}`);
      }
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^a bounced parcel that was never reverted out of the QA ref$/,
    (ctx) => {
      ctx.daemon = mkDaemonFixture();
      ctx.bouncedSha = commitTouching(ctx.daemon.root, 'extension/src/bad.ts', 'bounced work\n', 'bounced parcel');
      git(ctx.daemon.root, ['branch', 'swarmforge-QA']); // reachable: merged for review
      recordBounce(ctx.daemon.root, ctx.bouncedSha);
    },
    FEATURE
  );

  registry.defineScoped(
    /^a second, genuinely approved parcel ready to publish$/,
    (ctx) => {
      ctx.approvedSha = commitTouching(ctx.daemon.root, 'extension/src/good.ts', 'approved work\n', 'approved parcel');
      git(ctx.daemon.root, ['branch', '-f', 'swarmforge-QA']);
    },
    FEATURE
  );

  registry.defineScoped(
    /^every parcel in the range about to be pushed is QA-approved$/,
    (ctx) => {
      ctx.daemon = mkDaemonFixture();
      ctx.approvedSha = commitTouching(ctx.daemon.root, 'extension/src/good.ts', 'approved work\n', 'approved parcel');
      git(ctx.daemon.root, ['branch', 'swarmforge-QA']);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the publish gate runs over the range about to be pushed$/,
    async (ctx) => {
      startDaemon(ctx.daemon);
      if (ctx.bouncedSha) {
        ctx.refused = await waitForLog(ctx.daemon, 'qa-refused bounced-parcel', 40000);
      } else {
        ctx.pushed = await waitForLog(ctx.daemon, 'push-sweep pushed', 40000);
      }
      stopDaemon(ctx.daemon);
    },
    FEATURE
  );

  registry.defineScoped(
    /^it refuses the push$/,
    (ctx) => {
      if (ctx.daemon) {
        assert.ok(ctx.refused, 'expected a qa-refused bounced-parcel log line within 40s');
        assert.equal(
          git(ctx.daemon.remote, ['rev-parse', 'main']),
          git(ctx.daemon.root, ['rev-parse', 'main~2']),
          'expected origin/main to stay at the pre-bounce tip'
        );
      } else {
        // Scenario 04: the gate is the shared predicate itself - a refusal
        // is its fail-closed undeterminable exit.
        assert.ok(ctx.answer.exitCode >= 2, `expected a fail-closed refusal (exit >=2), got ${ctx.answer.exitCode}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^it names the bounced parcel as the reason$/,
    (ctx) => {
      const log = fs.readFileSync(path.join(ctx.daemon.root, '.swarmforge', 'daemon', 'handoffd.log'), 'utf8');
      assert.ok(
        log.includes(`qa-refused bounced-parcel`) && log.includes(short10(ctx.bouncedSha)),
        `expected the refusal to name ${short10(ctx.bouncedSha)}, got log:\n${log}`
      );
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^it allows the push$/,
    (ctx) => {
      assert.ok(ctx.pushed, 'expected a push-sweep pushed log line within 40s');
      assert.equal(
        git(ctx.daemon.remote, ['rev-parse', 'main']),
        ctx.approvedSha,
        'expected origin/main to reach the approved parcel'
      );
    },
    FEATURE
  );

  // ── Scenario 04 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^a parcel whose QA verdict cannot be determined because (.+)$/,
    (ctx, cause) => {
      if (!Object.prototype.hasOwnProperty.call(CAUSE_BUILDERS, cause)) {
        throw new Error(`unknown <cause> token: ${cause}`);
      }
      CAUSE_BUILDERS[cause](ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^it reports the cause rather than a bare refusal$/,
    (ctx) => {
      assert.match(
        ctx.answer.stderr,
        /undeterminable - (commit .* does not resolve|verdict store .*(not a directory|unreadable|corrupt))/,
        `expected the cause on stderr, got:\n${ctx.answer.stderr}`
      );
    },
    FEATURE
  );

  // ── Scenario 05 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^each consumer of the shared approval predicate is asked about it$/,
    (ctx) => {
      // Consumer 1: the shared predicate itself - the exact invocation the
      // handoffd publish gate shells per commit.
      ctx.answer = askPredicate(ctx.fixture.root, ctx.sha);
      // Consumer 2: check_pipeline_code_on_main.sh's merge-head exemption -
      // a bounced merge-head must NOT exempt staged pipeline paths. Stage a
      // pipeline-code file mid-merge-shape with GITHEAD_<bounced-full-sha>
      // set (the exemption's own fallback signal) and confirm the guard
      // still refuses.
      const root = ctx.fixture.root;
      fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
      fs.copyFileSync(PREDICATE, path.join(root, 'swarmforge', 'scripts', 'is_qa_ancestor.sh'));
      fs.chmodSync(path.join(root, 'swarmforge', 'scripts', 'is_qa_ancestor.sh'), 0o755);
      fs.copyFileSync(CHECK_PIPELINE, path.join(root, 'swarmforge', 'scripts', 'check_pipeline_code_on_main.sh'));
      fs.chmodSync(path.join(root, 'swarmforge', 'scripts', 'check_pipeline_code_on_main.sh'), 0o755);
      fs.mkdirSync(path.join(root, 'extension', 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'extension', 'src', 'staged.ts'), 'fresh pipeline edit\n');
      execFileSync('git', ['add', 'extension/src/staged.ts', 'swarmforge'], { cwd: root });
      const guard = spawnSync('bash', ['swarmforge/scripts/check_pipeline_code_on_main.sh'], {
        cwd: root,
        encoding: 'utf8',
        env: neutralizedEnv({ [`GITHEAD_${ctx.sha}`]: 'review-merge' }),
      });
      ctx.guardAnswer = { exitCode: guard.status ?? 99, output: `${guard.stdout || ''}${guard.stderr || ''}` };
    },
    FEATURE
  );

  registry.defineScoped(
    /^every consumer answers that it is not approved$/,
    (ctx) => {
      assert.equal(ctx.answer.exitCode, 1, `predicate consumer: expected not-approved (exit 1), got ${ctx.answer.exitCode}`);
      assert.match(ctx.answer.stderr, /bounced:/, 'predicate consumer: expected the bounce named on stderr');
      assert.notEqual(
        ctx.guardAnswer.exitCode,
        0,
        `check_pipeline consumer: a bounced merge-head must not exempt staged pipeline paths, got exit 0:\n${ctx.guardAnswer.output}`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
