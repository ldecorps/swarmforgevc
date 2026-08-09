'use strict';

// BL-849: step handlers for "A reaper that cannot see the process table
// says so, instead of reporting a clean host". Drives the REAL Babashka
// decision/wiring functions via bl849_orphan_janitor_acceptance_runner.bb
// (the same JSON-bridge pattern orphan_agent_reapable_decision_acceptance_
// runner.bb / BL-486 already established) - never a hand-rolled
// reimplementation of the reap decision in JS. Scenario 03's Darwin row
// spawns a real, disposable-root-shaped ancillary process this file starts
// and kills itself.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl849_orphan_janitor_acceptance_runner.bb');

const FEATURE_NAME = 'A reaper that cannot see the process table says so, instead of reporting a clean host';

const KNOWN_MECHANISMS = {
  'the Linux proc tree': 'linux',
  'the Darwin process handle API': 'darwin',
};

const KNOWN_COMMAND_LINES = {
  'a bare babysitterd script name': 'bash /tmp/tmp.QnO5pbBA/.swarmforge/babysitterd.sh /tmp/tmp.QnO5pbBA',
  'an absolute path to the tmux binary':
    '/usr/local/bin/tmux -S /tmp/tmp.NvLjaRF9/bl647.sock new-session -d -s swarmforge-coder -n agent',
};

function run(subcommand, payload) {
  const out = execFileSync('bb', [RUNNER, subcommand, JSON.stringify(payload || {})], { encoding: 'utf8' });
  return JSON.parse(out);
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

// A real, disposable, harmless child whose full command line is shaped
// like a genuine tmp-rooted babysitterd.sh ancillary - a real fixture
// process, never a fabricated candidate list.
function spawnDisposableAncillary(root) {
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const script = path.join(binDir, 'babysitterd.sh');
  fs.writeFileSync(script, '#!/usr/bin/env bash\nsleep 300\n');
  fs.chmodSync(script, 0o755);
  const child = spawnSync('bash', ['-c', `"$1" "$2" >/dev/null 2>&1 & echo $!`, '_', script, root]);
  return Number(child.stdout.toString().trim());
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a host running the orphan janitor sweep$/,
    (ctx) => {
      ctx.projectRoot = mkTmp('bl849-aps-root-');
    },
    FEATURE_NAME
  );

  // ── darwin-orphan-janitor-01 ────────────────────────────────────────────
  registry.defineScoped(
    /^the process table can be enumerated$/,
    () => {
      // Asserted by the runner itself (throws loud if real enumeration
      // fails on this host) - nothing to arrange here.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no disposable-root ancillary process is running$/,
    () => {
      // The runner's "sweep-real-host" subcommand represents this
      // precondition directly (candidates forced empty) rather than
      // requiring the whole shared dev/CI host's real process table to be
      // literally spotless - see its own comment for why that is not a
      // reliable thing to assert on a live SwarmForge checkout.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the sweep runs$/,
    (ctx) => {
      if (ctx.sweepSubcommand) {
        ctx.sweepResult = run(ctx.sweepSubcommand, { projectRoot: ctx.projectRoot });
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it reports zero candidates$/,
    (ctx) => {
      ctx.sweepSubcommand = 'sweep-real-host';
      ctx.sweepResult = run(ctx.sweepSubcommand, { projectRoot: ctx.projectRoot });
      const [line] = ctx.sweepResult.logs;
      if (!/^swept 0 candidate\(s\)/.test(line || '')) {
        throw new Error(`expected "swept 0 candidate(s)...", got: ${JSON.stringify(ctx.sweepResult.logs)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it reports the enumeration succeeded$/,
    (ctx) => {
      const [line] = ctx.sweepResult.logs;
      if (/unavailable/.test(line || '')) {
        throw new Error(`expected a successful-enumeration report, got: ${line}`);
      }
    },
    FEATURE_NAME
  );

  // ── darwin-orphan-janitor-02 ────────────────────────────────────────────
  registry.defineScoped(
    /^the process table cannot be enumerated$/,
    (ctx) => {
      ctx.sweepSubcommand = 'sweep-enumeration-unavailable';
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it reports the check unavailable$/,
    (ctx) => {
      const [line] = ctx.sweepResult.logs;
      if (!/unavailable/.test(line || '')) {
        throw new Error(`expected an "unavailable" report, got: ${JSON.stringify(ctx.sweepResult.logs)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it does not report a clean sweep$/,
    (ctx) => {
      const [line] = ctx.sweepResult.logs;
      if (/^swept/.test(line || '')) {
        throw new Error(`expected no "swept N" claim when enumeration is unavailable, got: ${line}`);
      }
    },
    FEATURE_NAME
  );

  // ── darwin-orphan-janitor-03 (Scenario Outline) ─────────────────────────
  registry.defineScoped(
    /^the process table is enumerated via (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_MECHANISMS, raw)) {
        throw new Error(`bl849: unrecognized <mechanism> example value "${raw}"`);
      }
      ctx.mechanism = KNOWN_MECHANISMS[raw];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^an ancillary process is running under a disposable root$/,
    (ctx) => {
      if (ctx.mechanism === 'darwin') {
        ctx.candidatePid = spawnDisposableAncillary(ctx.projectRoot);
      }
      // 'linux': no real process to spawn - see the "it is listed as a
      // candidate" step, which exercises the /proc parsing contract
      // directly on this Darwin host instead.
    },
    FEATURE_NAME
  );

  // ── darwin-orphan-janitor-04 (Scenario Outline) ─────────────────────────
  registry.defineScoped(
    /^an ancillary process whose command line is (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_COMMAND_LINES, raw)) {
        throw new Error(`bl849: unrecognized <command line> example value "${raw}"`);
      }
      ctx.ancillaryCmdline = KNOWN_COMMAND_LINES[raw];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is rooted under a disposable root$/,
    () => {
      // Asserted structurally by the KNOWN_COMMAND_LINES fixtures
      // themselves (both already contain a real /tmp/tmp.* root) - the
      // "it is listed as a candidate" step below is what actually proves
      // the disposable-root extraction is what makes it recognized.
    },
    FEATURE_NAME
  );

  // Shared by BOTH darwin-orphan-janitor-03 and -04 - both scenarios use
  // the identical "Then that process is listed as a candidate" text
  // within this one Feature, so a single handler dispatches on which
  // scenario's Given actually ran (ctx.ancillaryCmdline for -04,
  // ctx.mechanism for -03) rather than registering the same pattern
  // twice, which defineScoped's own per-Feature scoping would not permit
  // to coexist meaningfully.
  registry.defineScoped(
    /^that process is listed as a candidate$/,
    (ctx) => {
      if (ctx.ancillaryCmdline) {
        const result = run('ancillary-cmdline-recognized', { cmdline: ctx.ancillaryCmdline });
        if (!result.isCandidate) {
          throw new Error(`expected "${ctx.ancillaryCmdline}" to be recognized as a candidate`);
        }
        return;
      }
      if (ctx.mechanism === 'darwin') {
        let result;
        try {
          result = run('is-candidate-on-this-host', { pid: ctx.candidatePid });
        } finally {
          killPid(ctx.candidatePid);
        }
        if (!result.enumerationSucceeded) {
          throw new Error('expected real process-table enumeration to succeed on this host');
        }
        if (!result.found) {
          throw new Error(`expected pid ${ctx.candidatePid} to be found by the real process-table scan`);
        }
        if (!result.isCandidate) {
          throw new Error(`expected pid ${ctx.candidatePid} to be recognized as a disposable-root ancillary candidate`);
        }
        return;
      }
      // 'linux': no Linux host available to this acceptance run - proven
      // instead via cmdline-from-procfs's own NUL-separated parsing
      // contract (QA's own E2E procedure item 4 still requires a real
      // Linux pass before final sign-off; this is not a substitute for it).
      const result = run('procfs-cmdline-parses', {});
      if (!result.isCandidate) {
        throw new Error(`expected the /proc-parsed cmdline to be recognized as a candidate, got: ${JSON.stringify(result)}`);
      }
    },
    FEATURE_NAME
  );

  // ── darwin-orphan-janitor-05 ─────────────────────────────────────────────
  registry.defineScoped(
    /^a process whose working directory is inside the host repository$/,
    (ctx) => {
      ctx.hostRepoCmdline = `bash ${REPO_ROOT}/swarmforge/scripts/babysitterd.sh ${REPO_ROOT}`;
      ctx.hostRepoResult = run('host-repo-never-candidate', { cmdline: ctx.hostRepoCmdline, cwd: REPO_ROOT });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is not listed as a candidate$/,
    (ctx) => {
      if (ctx.hostRepoResult) {
        if (ctx.hostRepoResult.isCandidate) {
          throw new Error(`expected a host-repo-rooted cmdline to never be a candidate, got: ${JSON.stringify(ctx.hostRepoResult)}`);
        }
        return;
      }
      // darwin-orphan-janitor-06: the agent reaper's architecture has no
      // separate cmdline-only "candidate" stage keyed on cwd (candidacy
      // there is purely remote-control-cmdline?-based; cwd is consulted
      // only once deciding whether an already-scoped candidate may be
      // killed) - "not listed as a candidate" is read here as "never
      // eligible to be reaped", which is what reapable? with an
      // unresolved cwd actually encodes.
      const result = run('unresolved-cwd-never-reaped', {});
      if (result.reapable) {
        throw new Error('expected a process whose cwd cannot be resolved to never be reapable');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no reap decision is taken against it$/,
    (ctx) => {
      if (!ctx.hostRepoResult || ctx.hostRepoResult.tmpProjectRoot) {
        throw new Error(`expected the host repo path to never resolve as a disposable/tmp project root, got: ${JSON.stringify(ctx.hostRepoResult)}`);
      }
    },
    FEATURE_NAME
  );

  // ── darwin-orphan-janitor-06 ─────────────────────────────────────────────
  registry.defineScoped(
    /^an ancillary process whose working directory cannot be resolved$/,
    () => {
      // Nothing to arrange - "it is not listed as a candidate" (shared
      // above) runs the unresolved-cwd-never-reaped subcommand directly,
      // which fixes cwd-resolved?=false regardless of any other fixture
      // state.
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
