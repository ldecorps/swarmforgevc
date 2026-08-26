'use strict';

// BL-529: step handlers for "Worktree branch and active claim stay aligned
// before each agent turn". Drives the REAL ready_for_next_task.bb against a
// REAL git fixture repo (no mocked git - the auto-checkout and the
// requeue-to-new/ behavior ARE the contract), the same real-fixture
// discipline as the shell wiring test
// swarmforge/scripts/test/test_branch_claim_guard.sh.
//
// All registrations are defineScoped pinned to this feature's exact title
// (BL-425): several step texts here ("the coder begins a turn") are generic
// enough that an unscoped registration could win resolution for an
// unrelated feature.

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const READY_TASK = path.join(SWARMFORGE_SCRIPTS, 'ready_for_next_task.bb');

const FEATURE = 'Worktree branch and active claim stay aligned before each agent turn';

// Every Examples: column value must be load-bearing (engineering.prompt):
// an unknown (e.g. gherkin-mutator-mutated) value fails the step outright
// instead of flowing through a passthrough/else branch.
const KNOWN_BRANCHES = new Set(['swarmforge-coder', 'main', 'BL-529', 'BL-526']);
const KNOWN_CLAIMS = new Set(['BL-529', 'BL-512']);

// Fixture-root hygiene (BL-459's acceptance sibling): every root a
// Background creates is registered for removal at process exit, and each
// new Background removes the previous scenario's root eagerly, so neither a
// passing nor a throwing scenario leaves a repo behind.
const fixtureRoots = [];
function registerFixtureRoot(root) {
  fixtureRoots.push(root);
}
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

// The JS twin of branch_claim_guard_lib.bb's ticket-prefix: the leading
// BL-<digits> id of a branch/task name, or null when not ticket-specific.
function ticketPrefix(name) {
  const match = /^(BL-\d+)\b/.exec(name);
  return match ? match[1] : null;
}

function mkSwarmFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl529-acceptance-'));
  registerFixtureRoot(root);
  // The initial branch is deliberately a name no scenario puts the coder
  // worktree on - git refuses to check out one branch in two worktrees.
  git(root, 'init', '-q', '-b', 'fixture-root');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'one');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'tracked\n');
  // .swarmforge/ is gitignored exactly like the real repo - handoff state a
  // worktree carries is runtime state, never worktree dirtiness.
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  git(root, 'add', 'tracked.txt', '.gitignore');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'two');
  const commit = git(root, 'rev-parse', '--short=10', 'HEAD');

  // The role's standard-branch refs the guard can auto-correct onto.
  git(root, 'branch', 'primary/coder');
  git(root, 'branch', 'swarmforge-coder');

  const wt = path.join(root, '.worktrees', 'coder');
  git(root, 'worktree', 'add', '-q', wt, 'swarmforge-coder');

  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tcoder\t${wt}\tswarmforge-coder\tCoder\tclaude\ttask\n`);
  fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), 'swarm_name\tprimary\nswarm_mode\tautonomous\n');

  const inbox = path.join(wt, '.swarmforge', 'handoffs', 'inbox');
  for (const state of ['new', 'in_process', 'completed']) {
    fs.mkdirSync(path.join(inbox, state), { recursive: true });
  }
  return { root, wt, inbox, commit };
}

function dropClaim(ctx, claimTicket) {
  ctx.claimFile = `00_claim-${claimTicket}.handoff`;
  const content = [
    `id: claim-${claimTicket}`,
    'from: specifier',
    'to: coder',
    'recipient: coder',
    'priority: 00',
    'type: git_handoff',
    `task: ${claimTicket}`,
    `commit: ${ctx.commit}`,
    '',
    `body for claim ${claimTicket}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ctx.inbox, 'in_process', ctx.claimFile), content);
}

function currentBranch(ctx) {
  return git(ctx.wt, 'rev-parse', '--abbrev-ref', 'HEAD');
}

function porcelain(ctx) {
  return git(ctx.wt, 'status', '--porcelain');
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(/^a SwarmForge swarm with a pipeline worktree role for "coder"$/, (ctx) => {
    if (ctx.root) {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
    const fixture = mkSwarmFixture();
    ctx.root = fixture.root;
    ctx.wt = fixture.wt;
    ctx.inbox = fixture.inbox;
    ctx.commit = fixture.commit;
    ctx.out = undefined;
    ctx.err = undefined;
    ctx.rc = undefined;
  }, FEATURE);

  registry.defineScoped(/^SWARMFORGE_HOME is set to a fixture swarm root$/, (ctx) => {
    // The fixture swarm root every step operates against; also exported
    // into the guard run's environment so the fixture pointer travels with
    // the process boundary the same way the live swarm's launch env does.
    process.env.SWARMFORGE_HOME = ctx.root;
  }, FEATURE);

  // ── shared Givens (Scenario Outline 01 + scenarios 02/03/04) ─────────
  registry.defineScoped(/^the coder worktree is on branch "([^"]+)"$/, (ctx, branch) => {
    assert.ok(KNOWN_BRANCHES.has(branch), `unknown branch example value: ${branch}`);
    git(ctx.wt, 'checkout', '-q', '-B', branch);
    assert.equal(currentBranch(ctx), branch);
  }, FEATURE);

  registry.defineScoped(/^the coder has an in-process claim for ticket "([^"]+)"$/, (ctx, claimTicket) => {
    assert.ok(KNOWN_CLAIMS.has(claimTicket), `unknown claim example value: ${claimTicket}`);
    dropClaim(ctx, claimTicket);
  }, FEATURE);

  registry.defineScoped(/^the coder worktree has no uncommitted changes$/, (ctx) => {
    assert.equal(porcelain(ctx), '', `expected a pristine worktree, got: ${porcelain(ctx)}`);
  }, FEATURE);

  registry.defineScoped(/^the coder worktree has uncommitted changes$/, (ctx) => {
    fs.appendFileSync(path.join(ctx.wt, 'tracked.txt'), 'in-flight edit\n');
    assert.notEqual(porcelain(ctx), '', 'expected the worktree to report uncommitted changes');
  }, FEATURE);

  // ── When ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^the coder begins a turn$/, (ctx) => {
    // spawnSync, never execFileSync: the guard's diagnostics (an
    // auto-correct notice OR a mismatch refusal) go to stderr on BOTH the
    // exit-0 and the refusal paths, and execFileSync only exposes stderr
    // on a non-zero exit - a passing auto-correct would lose its notice.
    const result = spawnSync('bb', [READY_TASK], {
      cwd: ctx.wt,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'coder', SWARMFORGE_HOME: ctx.root },
    });
    ctx.out = result.stdout || '';
    ctx.err = result.stderr || '';
    ctx.rc = result.status ?? 1;
  }, FEATURE);

  // ── guard-01 ─────────────────────────────────────────────────────────
  registry.defineScoped(/^the guard passes without intervention$/, (ctx) => {
    assert.equal(ctx.rc, 0, `expected the turn to proceed, got rc=${ctx.rc} err=${ctx.err}`);
    assert.equal(ctx.err, '', `a passing guard emits no warning, got: ${ctx.err}`);
  }, FEATURE);

  registry.defineScoped(/^the turn proceeds normally on branch "([^"]+)"$/, (ctx, branch) => {
    assert.ok(KNOWN_BRANCHES.has(branch), `unknown branch example value: ${branch}`);
    assert.match(ctx.out, /^TASK:/m, `expected the claim to print, got: ${ctx.out}`);
    assert.equal(currentBranch(ctx), branch, `the branch must be untouched by a passing guard`);
  }, FEATURE);

  // ── guard-02 ─────────────────────────────────────────────────────────
  registry.defineScoped(/^the guard detects the branch "([^"]+)" conflicts with claim "([^"]+)"$/, (ctx, branch, claimTicket) => {
    assert.ok(KNOWN_BRANCHES.has(branch), `unknown branch example value: ${branch}`);
    assert.ok(KNOWN_CLAIMS.has(claimTicket), `unknown claim example value: ${claimTicket}`);
    // Detection is observable either as an auto-correct notice (clean
    // worktree) or as a mismatch refusal (dirty one) - both name the
    // branch and the claim.
    assert.match(ctx.err, /BRANCH_CLAIM_(GUARD|MISMATCH)/, `expected a guard diagnostic, got: ${ctx.err}`);
    assert.ok(ctx.err.includes(branch), `the diagnostic must name the branch ${branch}: ${ctx.err}`);
    assert.ok(ctx.err.includes(claimTicket), `the diagnostic must name the claim ${claimTicket}: ${ctx.err}`);
  }, FEATURE);

  // ── guard-03 ─────────────────────────────────────────────────────────
  registry.defineScoped(/^the coder worktree is no longer on branch "([^"]+)"$/, (ctx, branch) => {
    assert.ok(KNOWN_BRANCHES.has(branch), `unknown branch example value: ${branch}`);
    assert.notEqual(currentBranch(ctx), branch, `expected the worktree off ${branch}`);
  }, FEATURE);

  registry.defineScoped(/^the turn proceeds on a branch consistent with claim "([^"]+)"$/, (ctx, claimTicket) => {
    assert.ok(KNOWN_CLAIMS.has(claimTicket), `unknown claim example value: ${claimTicket}`);
    assert.equal(ctx.rc, 0, `expected the turn to proceed after correction, rc=${ctx.rc} err=${ctx.err}`);
    assert.match(ctx.out, /^TASK:/m, `expected the claim to print after correction, got: ${ctx.out}`);
    const landed = ticketPrefix(currentBranch(ctx));
    assert.ok(landed === null || landed === claimTicket,
      `the turn proceeded on ${currentBranch(ctx)}, which is not consistent with claim ${claimTicket}`);
  }, FEATURE);

  // ── shared Then (scenarios 03 + 04) ───────────────────────────────────
  registry.defineScoped(/^no productive turn ran on the mismatched branch$/, (ctx) => {
    if (/^TASK:/m.test(ctx.out)) {
      // A task printed at all is only acceptable when the guard corrected
      // the branch BEFORE printing it - the notice is the ordering proof.
      assert.match(ctx.err, /BRANCH_CLAIM_GUARD: auto-corrected/, `a task printed with no prior correction: ${ctx.out}`);
      assert.notEqual(currentBranch(ctx), 'BL-526', 'the mismatched branch must have been corrected');
    } else {
      assert.notEqual(ctx.rc, 0, 'neither a printed task nor a refusal - the turn state is ambiguous');
    }
  }, FEATURE);

  // ── guard-04 ─────────────────────────────────────────────────────────
  registry.defineScoped(/^the in-process task for "([^"]+)" is moved back to new\/$/, (ctx, claimTicket) => {
    assert.ok(KNOWN_CLAIMS.has(claimTicket), `unknown claim example value: ${claimTicket}`);
    assert.ok(fs.existsSync(path.join(ctx.inbox, 'new', ctx.claimFile)),
      `expected ${ctx.claimFile} back in new/`);
    assert.ok(!fs.existsSync(path.join(ctx.inbox, 'in_process', ctx.claimFile)),
      `expected ${ctx.claimFile} gone from in_process/`);
  }, FEATURE);

  registry.defineScoped(/^the turn is refused$/, (ctx) => {
    assert.notEqual(ctx.rc, 0, `expected a non-zero refusal, got rc=${ctx.rc}`);
    assert.doesNotMatch(ctx.out, /^TASK:/m, `no task may print on a refused turn: ${ctx.out}`);
  }, FEATURE);

  registry.defineScoped(/^a warning is logged naming the branch "([^"]+)" and claim "([^"]+)"$/, (ctx, branch, claimTicket) => {
    assert.ok(KNOWN_BRANCHES.has(branch), `unknown branch example value: ${branch}`);
    assert.ok(KNOWN_CLAIMS.has(claimTicket), `unknown claim example value: ${claimTicket}`);
    assert.match(ctx.err, /BRANCH_CLAIM_MISMATCH/, `expected a mismatch warning, got: ${ctx.err}`);
    assert.ok(ctx.err.includes(branch), `the warning must name the branch ${branch}: ${ctx.err}`);
    assert.ok(ctx.err.includes(claimTicket), `the warning must name the claim ${claimTicket}: ${ctx.err}`);
  }, FEATURE);
}

module.exports = { registerSteps };
