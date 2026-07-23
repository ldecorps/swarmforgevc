'use strict';

// BL-531: step handlers for "a parcel reaches QA only with durable lineage
// and declared wiring". Drives the REAL swarm_handoff.bb (and its real
// pre_qa_gate_lib.bb / pre_qa_gate_gather_lib.bb / pre_qa_gate_cli.bb call
// chain) against a real fixture git repo with a linked worktree, the same
// pattern corruptHandoffNeverDispatchedSteps.js and
// ticket_close_guard_lib_test_runner.bb's own shell fixture use for
// swarm_handoff.bb end-to-end coverage. SWARMFORGE_MAILBOX_ONLY=1 alone
// (no SWARMFORGE_SKIP_DAEMON) makes exit 0 mean "validated and queued" and
// exit 2 mean "refused by validate" - the daemon itself is never involved.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');
const PRE_QA_GATE_CLI = path.join(SCRIPTS_DIR, 'pre_qa_gate_cli.bb');

const TICKET_ID = 'BL-999';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

// An explicit allowlist, never {...process.env} - never leak this box's own
// broader environment into a spawned bb subprocess.
function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeRoles(ctx) {
  const rows = [
    `coder\tcoder\t${ctx.coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\toff`,
    `QA\tQA\t${ctx.root}\tswarmforge-QA\tQa\tclaude\ttask\toff`,
    `cleaner\tcleaner\t${ctx.root}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\toff`,
    `architect\tarchitect\t${ctx.architectWtPath || path.join(ctx.root, 'architect-wt')}\tswarmforge-architect\tArchitect\tclaude\ttask\toff`,
    `coordinator\tmaster\t${ctx.root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\toff`,
  ];
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
}

function writeTicketYaml(ctx, { requiredWiring, abandonedCommits } = {}) {
  let content = `id: ${TICKET_ID}\ntitle: pre-qa-gate fixture ticket\nstatus: active\n`;
  if (requiredWiring && requiredWiring.length) {
    content += `required_wiring:\n${requiredWiring.map((e) => `  - "${e}"`).join('\n')}\n`;
  }
  if (abandonedCommits && abandonedCommits.length) {
    content += `abandoned_commits:\n${abandonedCommits.map((c) => `  - ${c}`).join('\n')}\n`;
  }
  fs.writeFileSync(ctx.ticketYamlPath, content);
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'update BL-999 ticket yaml']);
}

function runSwarmHandoff(ctx, draftContent, { role = 'coder', cwd = ctx.coderWt } = {}) {
  const draftPath = path.join(cwd, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draftContent);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: role, SWARMFORGE_MAILBOX_ONLY: '1' },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function draftFor(kind, ctx) {
  if (kind === 'a git_handoff draft addressed to cleaner') {
    return `type: git_handoff\nto: cleaner\npriority: 50\ntask: ${TICKET_ID}-fix\ncommit: ${ctx.citedCommit}\n`;
  }
  if (kind === 'a note draft addressed to QA') {
    return 'type: note\nto: QA\npriority: 00\nmessage: checking in\n';
  }
  throw new Error(`unrecognized draft kind: "${kind}"`);
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a ticket in backlog\/active\/ whose parcel commit is ready to forward$/, (ctx) => {
    ctx.root = mkTmp('aps-pre-qa-gate-');
    git(ctx.root, ['init', '-q']);
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    git(ctx.root, ['checkout', '-q', '-b', 'main']);
    mkdirp(path.join(ctx.root, 'backlog', 'active'));
    mkdirp(path.join(ctx.root, '.swarmforge'));
    ctx.ticketYamlPath = path.join(ctx.root, 'backlog', 'active', `${TICKET_ID}-fixture.yaml`);
    ctx.coderWt = path.join(ctx.root, 'coder-wt');
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'worktree', 'add', '-q', '-b', 'swarmforge-coder', ctx.coderWt]);
    writeRoles(ctx);
    writeTicketYaml(ctx);
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  });

  // ── ancestry: shared Given across scenarios 01/02/06/07 ─────────────────
  registry.define(/^a commit naming that ticket sits on a pipeline role branch$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.coderWt, 'stray.txt'), 'never forwarded\n');
    git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'stray.txt']);
    git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `${TICKET_ID}: forgot to forward`]);
    ctx.strandedCommit = gitOut(ctx.coderWt, ['rev-parse', '--short=10', 'HEAD']);
    // citedCommit was pinned to main's tip in Background, BEFORE this
    // commit exists on the coder branch at all - already neither
    // main-reachable nor an ancestor of the cited commit.
  });

  registry.define(/^that commit is not reachable from main$/, () => {
    // No-op: the coder branch was never merged into main - see the Given
    // above. Asserted structurally by the Then step's refusal check.
  });

  registry.define(/^that commit is not an ancestor of the commit cited in the draft$/, () => {
    // No-op: ctx.citedCommit (main's tip, pinned in Background) predates
    // the stray commit above, so it cannot be its ancestor.
  });

  // ── BL-531 clean-lineage-allowed-02 ──────────────────────────────────────
  registry.define(/^every commit naming that ticket on a pipeline role branch is an ancestor of the cited commit$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.coderWt, 'fix.txt'), 'the real fix\n');
    git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'fix.txt']);
    git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `${TICKET_ID}: the real fix`]);
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '-q', 'swarmforge-coder', '-m', 'merge coder fix']);
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  });

  registry.define(/^the ticket declares no required wiring$/, () => {
    // No-op: writeTicketYaml (Background) wrote no required_wiring field.
  });

  // ── BL-531 declared-wiring-missing-refused-03 / wiring-judged-04 / malformed-05 ──
  registry.define(/^the ticket declares required wiring for a path and a pattern$/, (ctx) => {
    ctx.wiringPath = 'gate-target.txt';
    ctx.wiringPattern = 'WIRED_HERE';
    writeTicketYaml(ctx, { requiredWiring: [`${ctx.wiringPath}::${ctx.wiringPattern}`] });
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  });

  registry.define(/^at the cited commit (.+)$/, (ctx, wiringState) => {
    if (wiringState === 'the declared path exists but does not contain the pattern') {
      fs.writeFileSync(path.join(ctx.root, ctx.wiringPath), 'not wired yet\n');
      git(ctx.root, ['add', '-A']);
      git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'add unwired target file']);
      ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
    } else if (wiringState === 'the declared path does not exist') {
      // No-op: the file is simply never created at any commit.
    } else {
      throw new Error(`unrecognized wiring state: "${wiringState}"`);
    }
  });

  registry.define(/^the cited commit contains that pattern at that path$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.root, ctx.wiringPath), 'calls WIRED_HERE right here\n');
    git(ctx.root, ['add', '-A']);
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'wire it up']);
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  });

  registry.define(/^the sender's working tree has since deleted that path$/, (ctx) => {
    fs.rmSync(path.join(ctx.root, ctx.wiringPath));
    git(ctx.root, ['add', '-A']);
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'delete wired file on the working tree tip']);
    // ctx.citedCommit deliberately stays pinned to the earlier commit that
    // still contains the file - the gate must read AT the cited commit,
    // never the current working tree.
  });

  registry.define(/^the ticket declares a required wiring entry with no separator between path and pattern$/, (ctx) => {
    writeTicketYaml(ctx, { requiredWiring: ['path-and-pattern-with-no-separator'] });
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  });

  // ── BL-531 acknowledged-abandoned-commit-allowed-06 / gate-scope-07 ─────
  registry.define(/^a commit naming that ticket is stranded off the parcel's lineage$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.coderWt, 'stray.txt'), 'never forwarded\n');
    git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'stray.txt']);
    git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `${TICKET_ID}: forgot to forward`]);
    ctx.strandedCommit = gitOut(ctx.coderWt, ['rev-parse', '--short=10', 'HEAD']);
  });

  registry.define(/^the ticket records that commit under abandoned_commits$/, (ctx) => {
    writeTicketYaml(ctx, { abandonedCommits: [ctx.strandedCommit] });
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  });

  // ── BL-531 empty-diff-or-merge-commit-is-not-a-finding-11 ───────────────
  // Rewrites the stray commit the shared Given above just made into one of
  // the two "carries no dropped work" shapes, so ctx.strandedCommit ends up
  // referring to a commit that must NOT survive as an ancestry finding
  // (condition 5, architect rule_proposal b7dd7276d).
  registry.define(/^that commit (is a merge commit whose diff against its first parent is empty|has a tree identical to the commit cited in the draft)$/, (ctx, prop) => {
    const branch = gitOut(ctx.coderWt, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const strandedParent = gitOut(ctx.coderWt, ['rev-parse', `${ctx.strandedCommit}^`]);
    git(ctx.coderWt, ['reset', '-q', '--hard', strandedParent]);

    if (prop === 'is a merge commit whose diff against its first parent is empty') {
      // A side branch that adds then reverts a file lands back on the exact
      // same tree as strandedParent, so merging it in (even --no-ff, which
      // forces a real merge commit despite being fast-forwardable) produces
      // a merge whose diff against its first parent (strandedParent) is empty.
      git(ctx.coderWt, ['checkout', '-q', '-b', 'bl531-empty-diff-side']);
      fs.writeFileSync(path.join(ctx.coderWt, 'scratch.txt'), 'temp\n');
      git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'scratch.txt']);
      git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'scratch add']);
      fs.rmSync(path.join(ctx.coderWt, 'scratch.txt'));
      git(ctx.coderWt, ['add', '-A']);
      git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'scratch revert']);
      git(ctx.coderWt, ['checkout', '-q', branch]);
      git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '-q', '--no-ff', 'bl531-empty-diff-side', '-m', `${TICKET_ID}: merge side (empty diff against first parent)`]);
    } else if (prop === 'has a tree identical to the commit cited in the draft') {
      // git commit-tree pins the new commit's tree to citedCommit's tree
      // exactly (root and coderWt share one object store, so any commit-ish
      // in the repo is resolvable from either worktree), regardless of
      // coderWt's own file layout - the only reliable way to guarantee tree
      // identity across two branches with different history shapes.
      const newSha = gitOut(ctx.coderWt, [
        '-c', 'user.email=t@t', '-c', 'user.name=t',
        'commit-tree', `${ctx.citedCommit}^{tree}`, '-p', strandedParent,
        '-m', `${TICKET_ID}: tree identical to cited commit`,
      ]);
      git(ctx.coderWt, ['reset', '-q', '--hard', newSha]);
    } else {
      throw new Error(`unrecognized dropped-work property: "${prop}"`);
    }

    ctx.strandedCommit = gitOut(ctx.coderWt, ['rev-parse', '--short=10', 'HEAD']);
  });

  // ── BL-531 infrastructure-error-fails-open-08 ────────────────────────────
  registry.define(/^a pipeline role worktree recorded in roles\.tsv is missing$/, (ctx) => {
    ctx.architectWtPath = path.join(ctx.root, 'no-such-architect-worktree');
    writeRoles(ctx);
    // Re-establish a stranded ticket commit so the ancestry check has
    // something real to evaluate around the missing role - the warning
    // must fire without the missing role's own commits (there are none)
    // being the reason nothing was found.
  });

  // ── BL-531 no-ticket-id-skips-the-gate-09 ────────────────────────────────
  registry.define(/^the draft's task name carries no ticket id$/, (ctx) => {
    ctx.taskNameOverride = 'no-ticket-id-here';
  });

  // ── When ──────────────────────────────────────────────────────────────
  registry.define(/^the sender runs swarm_handoff\.sh on a git_handoff draft addressed to QA$/, (ctx) => {
    const task = ctx.taskNameOverride || `${TICKET_ID}-fix`;
    const draft = `type: git_handoff\nto: QA\npriority: 00\ntask: ${task}\ncommit: ${ctx.citedCommit}\n`;
    ctx.result = runSwarmHandoff(ctx, draft);
  });

  registry.define(/^the sender runs swarm_handoff\.sh on (.+)$/, (ctx, draftKind) => {
    ctx.result = runSwarmHandoff(ctx, draftFor(draftKind, ctx));
  });

  registry.define(/^the sender runs the pre-QA gate script on the ticket and the cited commit$/, (ctx) => {
    const res = spawnSync('bb', [PRE_QA_GATE_CLI, `${TICKET_ID}-fix`, ctx.citedCommit, ctx.root], {
      encoding: 'utf8',
      env: processEnvAllowlist(),
    });
    ctx.result = { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  });

  // ── Then ──────────────────────────────────────────────────────────────
  // error-report (and pre-qa-gate-errors' own PRE_QA_GATE WARNING lines)
  // print to STDERR, matching swarm_handoff.bb's existing convention
  // (validate errors are diagnostics, not the handoff protocol's stdout
  // output) - check the combined output so a future stream choice doesn't
  // silently break these assertions.
  function combinedOutput(result) {
    return `${result.stdout}\n${result.stderr}`;
  }

  registry.define(/^the handoff is refused$/, (ctx) => {
    if (ctx.result.status !== 2) {
      throw new Error(`expected the handoff to be refused (exit 2), got exit ${ctx.result.status}: ${combinedOutput(ctx.result)}`);
    }
    if (!/HANDOFF INVALID/.test(combinedOutput(ctx.result))) {
      throw new Error(`expected a HANDOFF INVALID report, got: ${combinedOutput(ctx.result)}`);
    }
  });

  registry.define(/^the handoff is sent$/, (ctx) => {
    if (ctx.result.status === 2) {
      throw new Error(`expected the handoff to be sent, but it was refused: ${combinedOutput(ctx.result)}`);
    }
    if (/PRE_QA_GATE_FAIL/.test(combinedOutput(ctx.result))) {
      throw new Error(`expected no PRE_QA_GATE_FAIL findings, got: ${combinedOutput(ctx.result)}`);
    }
  });

  registry.define(/^the refusal names the stranded commit and the ancestry failure class$/, (ctx) => {
    const line = `PRE_QA_GATE_FAIL ancestry ${TICKET_ID} ${ctx.strandedCommit}`;
    if (!combinedOutput(ctx.result).includes(line)) {
      throw new Error(`expected the refusal to contain "${line}", got: ${combinedOutput(ctx.result)}`);
    }
  });

  registry.define(/^the refusal names the declared path, the declared pattern, and the wiring failure class$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    const prefix = `PRE_QA_GATE_FAIL wiring ${TICKET_ID}`;
    if (!out.includes(prefix)) {
      throw new Error(`expected a wiring-class refusal, got: ${out}`);
    }
    if (!out.includes(ctx.wiringPath) || !out.includes(ctx.wiringPattern)) {
      throw new Error(`expected the refusal to name path "${ctx.wiringPath}" and pattern "${ctx.wiringPattern}", got: ${out}`);
    }
  });

  registry.define(/^the refusal names the malformed entry and the manifest failure class$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    const prefix = `PRE_QA_GATE_FAIL manifest ${TICKET_ID}`;
    if (!out.includes(prefix)) {
      throw new Error(`expected a manifest-class refusal, got: ${out}`);
    }
    if (!out.includes('path-and-pattern-with-no-separator')) {
      throw new Error(`expected the refusal to name the malformed entry, got: ${out}`);
    }
  });

  registry.define(/^a warning names the check that could not run$/, (ctx) => {
    if (!/PRE_QA_GATE WARNING: role-branch:architect/.test(ctx.result.stderr)) {
      throw new Error(`expected a role-branch warning naming architect, got stderr: ${ctx.result.stderr}`);
    }
  });

  registry.define(/^the script exits (zero|nonzero) and prints a (OK|FAIL) line$/, (ctx, exitLabel, lineLabel) => {
    const wantZero = exitLabel === 'zero';
    if (wantZero && ctx.result.status !== 0) {
      throw new Error(`expected exit 0, got ${ctx.result.status}: ${ctx.result.stdout}\n${ctx.result.stderr}`);
    }
    if (!wantZero && ctx.result.status === 0) {
      throw new Error(`expected a nonzero exit, got 0: ${ctx.result.stdout}`);
    }
    if (lineLabel === 'OK' && !/^OK$/m.test(ctx.result.stdout)) {
      throw new Error(`expected an OK line, got: ${ctx.result.stdout}`);
    }
    if (lineLabel === 'FAIL' && !/PRE_QA_GATE_FAIL/.test(ctx.result.stdout)) {
      throw new Error(`expected a PRE_QA_GATE_FAIL line, got: ${ctx.result.stdout}`);
    }
  });

  // ── BL-531 standalone-self-check-10 ─────────────────────────────────────
  registry.define(/^the parcel (satisfies both checks|has a stranded ticket commit)$/, (ctx, parcelState) => {
    if (parcelState === 'has a stranded ticket commit') {
      fs.writeFileSync(path.join(ctx.coderWt, 'stray.txt'), 'never forwarded\n');
      git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'stray.txt']);
      git(ctx.coderWt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `${TICKET_ID}: forgot to forward`]);
      // ctx.citedCommit stays at main's tip, which predates this commit.
    }
    // "satisfies both checks": no-op - Background's clean fixture already
    // has nothing stranded and no declared wiring.
  });
}

module.exports = { registerSteps };
