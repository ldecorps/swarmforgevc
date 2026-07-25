'use strict';

// BL-629: step handlers for "sync refuses to deploy a main tip whose code is
// not QA-approved". Drives the REAL build_freshness_cli.bb against a real
// fixture git repo (mirrors bl610UnresolvableCommitQuarantinedSteps.js's own
// fixture-repo pattern) - the gate decision itself is NOT reimplemented here,
// only the git plumbing to construct main/swarmforge-QA drift, dirty
// working-tree state, and override runs, then the real CLI is shelled out to
// and its exit code / stdout / stderr are asserted against.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'build_freshness_cli.bb');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeFile(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
  return gitOut(root, ['rev-parse', 'HEAD']);
}

// The one shared fixture: an initial commit with a tracked file under the
// deployed code surface AND a tracked bookkeeping file, present on BOTH
// main and swarmforge-QA - every scenario either leaves these alone (empty
// drift), commits a change to one of them (code-drift / bookkeeping-only
// drift), or dirties one of them uncommitted (scenarios 09/10).
function setUpFixtureRepo() {
  const root = mkTmp('aps-bl629-sync-qa-gate-');
  git(root, ['init', '-q']);
  writeFile(root, 'extension/src/placeholder.ts', 'export const placeholder = 1;\n');
  writeFile(root, 'backlog/paused/PLACEHOLDER.yaml', 'id: PLACEHOLDER\n');
  commitAll(root, 'init');
  git(root, ['branch', '-M', 'main']);
  git(root, ['branch', 'swarmforge-QA', 'main']);
  return { root };
}

function addCodeSurfaceCommit(root) {
  writeFile(root, 'extension/src/placeholder.ts', `export const placeholder = ${Date.now()};\n`);
  return commitAll(root, 'code surface change');
}

function addBookkeepingCommit(root) {
  writeFile(root, 'backlog/paused/PLACEHOLDER.yaml', `id: PLACEHOLDER\nnote: bookkeeping ${Date.now()}\n`);
  return commitAll(root, 'bookkeeping change');
}

// A routine PIPELINE.md §5 "QA lands the approved commit on main" step: QA's
// own branch advances with a code-surface commit, that lands on main via an
// ordinary `--no-ff` merge, then ordinary bookkeeping follows. Models the
// architect bounce #1 finding 2 regression - the landing merge introduces
// nothing of its own (it resolves cleanly to the QA side), so it must not
// read as offending drift.
function addQaLandingMerge(root) {
  const wt = mkTmp('aps-bl629-qa-landing-');
  git(root, ['worktree', 'add', '-q', '-b', '__bl629_qa_landing', wt, 'swarmforge-QA']);
  writeFile(wt, 'extension/src/placeholder.ts', `export const placeholder = ${Date.now()};\n`);
  commitAll(wt, 'QA-approved work');
  git(wt, ['branch', '-f', 'swarmforge-QA', 'HEAD']);
  git(root, ['worktree', 'remove', '--force', wt]);
  git(root, ['branch', '-D', '__bl629_qa_landing']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '--no-ff', '-q', '-m', 'Merge QA-approved commit for routine landing', 'swarmforge-QA']);
}

const DRIFT_KNOWN_VALUES = {
  empty: () => {},
  'bookkeeping-only': (ctx) => {
    ctx.bookkeepingSha = addBookkeepingCommit(ctx.root);
  },
  'qa-landing-merge': (ctx) => {
    addQaLandingMerge(ctx.root);
    ctx.bookkeepingSha = addBookkeepingCommit(ctx.root);
  },
};

function runCli(root, subcommand, extraArgs = []) {
  try {
    const stdout = execFileSync('bb', [CLI, root, subcommand, ...extraArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function overrideLogPath(root) {
  return path.join(root, '.swarmforge', 'build-freshness', 'sync-overrides.jsonl');
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.define(/^a freshness-tracked project repo with a main branch and a QA integration branch$/, (ctx) => {
    Object.assign(ctx, setUpFixtureRepo());
  });

  // ── 01: unapproved code drift + a bookkeeping commit alongside it ────────
  registry.define(/^main carries a commit changing the deployed code surface that is not an ancestor of the QA integration branch$/, (ctx) => {
    ctx.codeSha = addCodeSurfaceCommit(ctx.root);
  });

  registry.define(/^main also carries a bookkeeping-only commit that is not an ancestor of the QA integration branch$/, (ctx) => {
    ctx.bookkeepingSha = addBookkeepingCommit(ctx.root);
  });

  // ── 02/09/10: parameterized drift (shared KNOWN_VALUES step) ─────────────
  registry.define(/^the drift on main since the last QA-landed commit is (empty|bookkeeping-only|qa-landing-merge)$/, (ctx, drift) => {
    const apply = DRIFT_KNOWN_VALUES[drift];
    if (!apply) {
      throw new Error(`BL-629: unknown drift value "${drift}" - not in DRIFT_KNOWN_VALUES`);
    }
    apply(ctx);
  });

  // ── 03: QA branch carries its own review work, main stays deployable ─────
  registry.define(/^the QA integration branch carries review work that is not on main$/, (ctx) => {
    const wt = mkTmp('aps-bl629-qa-review-');
    git(ctx.root, ['worktree', 'add', '-q', '-b', '__bl629_qa_checkout', wt, 'swarmforge-QA']);
    writeFile(wt, 'extension/src/review-only.ts', 'export const reviewOnly = 1;\n');
    commitAll(wt, 'QA review work not on main');
    git(wt, ['branch', '-f', 'swarmforge-QA', 'HEAD']);
    git(ctx.root, ['worktree', 'remove', '--force', wt]);
    git(ctx.root, ['branch', '-D', '__bl629_qa_checkout']);
  });

  // ── 04/05: explicit override ─────────────────────────────────────────────
  registry.define(/^a prior sync ran with the explicit override$/, (ctx) => {
    ctx.priorOverrideResult = runCli(ctx.root, 'sync', ['--override']);
    if (ctx.priorOverrideResult.exitCode !== 0) {
      throw new Error(`expected the prior overridden sync to proceed, got exit ${ctx.priorOverrideResult.exitCode}: ${ctx.priorOverrideResult.stderr}`);
    }
  });

  // ── 06/07: a tracked process stale against main, independent of the gate ─
  registry.define(/^a tracked process is stale against main$/, (ctx) => {
    const initialSha = gitOut(ctx.root, ['rev-parse', 'main']);
    writeFile(
      ctx.root,
      '.swarmforge/operator/front-desk-supervisor.status.json',
      JSON.stringify({ bridge: { pid: 111, build_sha: initialSha } })
    );
  });

  // ── 08: missing QA integration branch ────────────────────────────────────
  registry.define(/^the repo has no QA integration branch$/, (ctx) => {
    git(ctx.root, ['branch', '-D', 'swarmforge-QA']);
  });

  // ── 11: QA and main share no common ancestor (architect bounce #1 finding
  //    4's own live reproduction: `git merge-base` fails, and the fix must
  //    read that as "could not determine", not "no drift") ────────────────
  registry.define(/^the QA integration branch shares no common history with main$/, (ctx) => {
    const wt = mkTmp('aps-bl629-qa-orphan-');
    git(ctx.root, ['worktree', 'add', '-q', '--detach', wt]);
    git(wt, ['checkout', '-q', '--orphan', '__bl629_qa_orphan']);
    writeFile(wt, 'extension/src/placeholder.ts', 'export const placeholder = "orphan";\n');
    writeFile(wt, 'backlog/paused/PLACEHOLDER.yaml', 'id: PLACEHOLDER\n');
    commitAll(wt, 'orphan QA history sharing nothing with main');
    git(wt, ['branch', '-f', 'swarmforge-QA', 'HEAD']);
    git(ctx.root, ['worktree', 'remove', '--force', wt]);
    git(ctx.root, ['branch', '-D', '__bl629_qa_orphan']);
  });

  // ── 09/10: uncommitted working-tree modifications ────────────────────────
  registry.define(/^an uncommitted modification exists under the deployed code surface$/, (ctx) => {
    ctx.dirtyPath = 'extension/src/placeholder.ts';
    writeFile(ctx.root, ctx.dirtyPath, 'export const placeholder = "dirty";\n');
  });

  registry.define(/^an uncommitted modification exists outside the deployed code surface$/, (ctx) => {
    ctx.dirtyPath = 'backlog/paused/PLACEHOLDER.yaml';
    writeFile(ctx.root, ctx.dirtyPath, 'id: PLACEHOLDER\nnote: dirty\n');
  });

  // ── When ──────────────────────────────────────────────────────────────
  registry.define(/^a sync is requested( without the override)?$/, (ctx) => {
    ctx.recompileMarker = path.join(ctx.root, '.recompiled-marker');
    ctx.fakeBin = mkTmp('aps-bl629-fake-npm-');
    writeFile(ctx.fakeBin, 'npm', `#!/usr/bin/env bash\ntouch "${ctx.recompileMarker}"\nexit 0\n`);
    fs.chmodSync(path.join(ctx.fakeBin, 'npm'), 0o755);
    ctx.syncResult = runCliWithFakeNpm(ctx, []);
  });

  registry.define(/^a sync is requested with the explicit override$/, (ctx) => {
    ctx.recompileMarker = path.join(ctx.root, '.recompiled-marker');
    ctx.fakeBin = mkTmp('aps-bl629-fake-npm-');
    writeFile(ctx.fakeBin, 'npm', `#!/usr/bin/env bash\ntouch "${ctx.recompileMarker}"\nexit 0\n`);
    fs.chmodSync(path.join(ctx.fakeBin, 'npm'), 0o755);
    ctx.syncResult = runCliWithFakeNpm(ctx, ['--override']);
  });

  function runCliWithFakeNpm(ctx, extraArgs) {
    try {
      const stdout = execFileSync('bb', [CLI, ctx.root, 'sync', ...extraArgs], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: `${ctx.fakeBin}:${process.env.PATH}` },
      });
      return { exitCode: 0, stdout, stderr: '' };
    } catch (err) {
      return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
    }
  }

  registry.define(/^a report is requested$/, (ctx) => {
    ctx.reportResult = runCli(ctx.root, 'report');
  });

  // ── Then ──────────────────────────────────────────────────────────────
  registry.define(/^the sync is refused with the documented refusal exit status$/, (ctx) => {
    if (ctx.syncResult.exitCode !== 3) {
      throw new Error(`expected the documented refusal exit status (3), got ${ctx.syncResult.exitCode}: ${ctx.syncResult.stderr}`);
    }
  });

  registry.define(/^the refusal names the sha of the code commit$/, (ctx) => {
    if (!ctx.syncResult.stderr.includes(ctx.codeSha)) {
      throw new Error(`expected the refusal to name ${ctx.codeSha}, got: ${ctx.syncResult.stderr}`);
    }
  });

  registry.define(/^the refusal does not name the sha of the bookkeeping commit$/, (ctx) => {
    if (ctx.syncResult.stderr.includes(ctx.bookkeepingSha)) {
      throw new Error(`expected the refusal to NOT name the bookkeeping sha ${ctx.bookkeepingSha}, got: ${ctx.syncResult.stderr}`);
    }
  });

  registry.define(/^no process is restarted and no recompile is run$/, (ctx) => {
    if (fs.existsSync(ctx.recompileMarker)) {
      throw new Error('expected no recompile to have run when the sync is refused');
    }
  });

  registry.define(/^the refusal states the remedy of landing through QA or rerunning with the explicit override$/, (ctx) => {
    const msg = ctx.syncResult.stderr.toLowerCase();
    if (!msg.includes('qa') || !msg.includes('override')) {
      throw new Error(`expected the refusal to state the QA/override remedy, got: ${ctx.syncResult.stderr}`);
    }
  });

  registry.define(/^the sync proceeds without refusal$/, (ctx) => {
    if (ctx.syncResult.exitCode !== 0) {
      throw new Error(`expected the sync to proceed, got exit ${ctx.syncResult.exitCode}: ${ctx.syncResult.stderr}`);
    }
  });

  registry.define(/^a durable override record names the offending sha and when the override ran$/, (ctx) => {
    const logPath = overrideLogPath(ctx.root);
    if (!fs.existsSync(logPath)) {
      throw new Error(`expected a durable override record at ${logPath}`);
    }
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    if (!Array.isArray(last.offending_shas) || !last.offending_shas.includes(ctx.codeSha)) {
      throw new Error(`expected the override record to name ${ctx.codeSha}, got: ${JSON.stringify(last)}`);
    }
    if (!last.at || Number.isNaN(Date.parse(last.at))) {
      throw new Error(`expected the override record to carry a valid timestamp, got: ${JSON.stringify(last)}`);
    }
  });

  registry.define(/^the report states the main tip is not QA-approved$/, (ctx) => {
    const parsed = JSON.parse(ctx.reportResult.stdout);
    if (parsed.qa_approval.approved !== false) {
      throw new Error(`expected qa_approval.approved to be false, got: ${ctx.reportResult.stdout}`);
    }
  });

  registry.define(/^the report names the sha of the code commit$/, (ctx) => {
    const parsed = JSON.parse(ctx.reportResult.stdout);
    if (!parsed.qa_approval.offending_shas.includes(ctx.codeSha)) {
      throw new Error(`expected qa_approval.offending_shas to include ${ctx.codeSha}, got: ${ctx.reportResult.stdout}`);
    }
  });

  registry.define(/^the report exits successfully without refusing$/, (ctx) => {
    if (ctx.reportResult.exitCode !== 0) {
      throw new Error(`expected report to exit 0, got ${ctx.reportResult.exitCode}: ${ctx.reportResult.stderr}`);
    }
  });

  registry.define(/^the report states the main tip is QA-approved$/, (ctx) => {
    const parsed = JSON.parse(ctx.reportResult.stdout);
    if (parsed.qa_approval.approved !== true) {
      throw new Error(`expected qa_approval.approved to be true, got: ${ctx.reportResult.stdout}`);
    }
  });

  registry.define(/^the refusal states the QA approval reference is missing$/, (ctx) => {
    if (!/qa approval reference.*missing/i.test(ctx.syncResult.stderr)) {
      throw new Error(`expected the refusal to state the QA approval reference is missing, got: ${ctx.syncResult.stderr}`);
    }
  });

  registry.define(/^the refusal names the modified path$/, (ctx) => {
    if (!ctx.syncResult.stderr.includes(ctx.dirtyPath)) {
      throw new Error(`expected the refusal to name ${ctx.dirtyPath}, got: ${ctx.syncResult.stderr}`);
    }
  });

  registry.define(/^the refusal states the QA-approval status could not be determined$/, (ctx) => {
    if (!/could not determine/i.test(ctx.syncResult.stderr)) {
      throw new Error(`expected the refusal to state the QA-approval status could not be determined, got: ${ctx.syncResult.stderr}`);
    }
  });
}

module.exports = { registerSteps };
