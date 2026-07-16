'use strict';

// BL-443: step handlers for "propose-onboarding-contract reliably commits
// the contract into any target repo" - drives the REAL compiled
// targetBootstrap.js module (initializeTargetContract, the exact function
// propose-onboarding-contract.ts calls) against a REAL, isolated git target
// repo. No fake git: the whole point of this ticket is real git behavior
// (an ignore rule, a missing identity, an uncommitted-but-present file), so
// faking it would test nothing.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { initializeTargetContract, buildContractBootstrapFiles } = require(path.join(EXT_DIR, 'out', 'config', 'targetBootstrap'));

const FIXTURE_CONTRACT = {
  scope: ['Build the thing.'],
  outOfScope: ['Rewrite the stack.'],
  boundaries: ['Respect the README.'],
  initialBacklogSummary: '3 tickets queued.',
  agreement: 'proposed',
};

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function configureIdentity(targetRepo) {
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: targetRepo });
}

function trackedPaths(targetRepo) {
  return execFileSync('git', ['ls-files'], { cwd: targetRepo, encoding: 'utf8' });
}

function commitPaths(targetRepo) {
  return execFileSync('git', ['show', '--stat', '--format=', 'HEAD'], { cwd: targetRepo, encoding: 'utf8' });
}

function authorLine(targetRepo) {
  return execFileSync('git', ['log', '-1', '--format=%an <%ae>'], { cwd: targetRepo, encoding: 'utf8' }).trim();
}

async function runPropose(ctx) {
  ctx.result = await initializeTargetContract(ctx.targetRepo, FIXTURE_CONTRACT);
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^a target repo with contract\.yaml and CONTRACT\.md to be scaffolded and committed$/, (ctx) => {
    ctx.targetRepo = mkTmp('bl443-target-');
    execFileSync('git', ['init'], { cwd: ctx.targetRepo });
    // Deliberately no identity configured yet here - scenario 02 depends on
    // that absence, and every other scenario configures it explicitly in
    // its own Given step, so no scenario relies on Background's own choice.
  });

  // ── propose-contract-commit-robustness-01 ─────────────────────────────
  registry.define(/^the target ignores the \.swarmforge\/ path$/, (ctx) => {
    configureIdentity(ctx.targetRepo);
    fs.writeFileSync(path.join(ctx.targetRepo, '.gitignore'), '.swarmforge/\n');
  });
  registry.define(/^propose-onboarding-contract commits the contract$/, async (ctx) => {
    await runPropose(ctx);
  });
  registry.define(/^the exact contract files are force-added past the ignore rule$/, (ctx) => {
    const tracked = trackedPaths(ctx.targetRepo);
    assert.match(tracked, /contract\.yaml/, `expected contract.yaml to be tracked despite the ignore rule, got: ${tracked}`);
    assert.match(tracked, /CONTRACT\.md/, `expected CONTRACT.md to be tracked, got: ${tracked}`);
  });
  registry.define(/^the commit contains contract\.yaml and CONTRACT\.md$/, (ctx) => {
    assert.equal(ctx.result.committed, true, `expected a real commit, got: ${JSON.stringify(ctx.result)}`);
    const stat = commitPaths(ctx.targetRepo);
    assert.match(stat, /contract\.yaml/, `expected the commit to touch contract.yaml, got: ${stat}`);
    assert.match(stat, /CONTRACT\.md/, `expected the commit to touch CONTRACT.md, got: ${stat}`);
  });

  // ── propose-contract-commit-robustness-02 ─────────────────────────────
  registry.define(/^the target repo has no user\.name or user\.email configured$/, () => {
    // Narrative only - the Background above deliberately leaves this repo
    // with no identity configured, and no earlier step in this scenario
    // sets one.
  });
  registry.define(/^the commit is made with an explicit fallback author identity$/, (ctx) => {
    assert.equal(authorLine(ctx.targetRepo), 'SwarmForge <noreply@swarmforge>', 'expected the commit to carry the fallback swarm-committer identity');
  });
  registry.define(/^the commit succeeds$/, (ctx) => {
    assert.equal(ctx.result.committed, true, `expected the commit to succeed despite no configured identity, got: ${JSON.stringify(ctx.result)}`);
  });

  // ── propose-contract-commit-robustness-03 ─────────────────────────────
  registry.define(/^the contract files were written on a prior run but never committed$/, (ctx) => {
    configureIdentity(ctx.targetRepo);
    // Simulates defects 2/3 having aborted mid-commit: the files land on
    // disk exactly as writeFilesAndCommit would leave them, but are never
    // staged or committed.
    for (const file of buildContractBootstrapFiles(FIXTURE_CONTRACT)) {
      const filePath = path.join(ctx.targetRepo, file.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content, 'utf8');
    }
  });
  registry.define(/^propose-onboarding-contract runs again$/, async (ctx) => {
    await runPropose(ctx);
  });
  registry.define(/^it detects the artifacts are present but uncommitted$/, (ctx) => {
    assert.deepEqual(
      ctx.result.created.sort(),
      ['CONTRACT.md', path.join('.swarmforge', 'contract.yaml')].sort(),
      `expected the present-but-uncommitted files to be treated as not-yet-done, got: ${JSON.stringify(ctx.result)}`
    );
  });
  registry.define(/^it commits them$/, (ctx) => {
    assert.equal(ctx.result.committed, true, `expected the artifacts to actually be committed this run, got: ${JSON.stringify(ctx.result)}`);
  });
  registry.define(/^it reports committed as true$/, (ctx) => {
    assert.equal(ctx.result.committed, true);
  });

  // ── propose-contract-commit-robustness-04 ─────────────────────────────
  registry.define(/^the contract files are present and already committed$/, async (ctx) => {
    configureIdentity(ctx.targetRepo);
    await runPropose(ctx);
  });
  registry.define(/^nothing new is written$/, (ctx) => {
    assert.deepEqual(ctx.result.created, [], `expected nothing new to be created on a clean re-run, got: ${JSON.stringify(ctx.result)}`);
  });
  registry.define(/^no empty commit is created$/, (ctx) => {
    assert.equal(ctx.result.committed, false, `expected a clean no-op (no empty commit), got: ${JSON.stringify(ctx.result)}`);
  });
  registry.define(/^it reports the artifacts as already present and committed$/, (ctx) => {
    assert.deepEqual(
      ctx.result.skipped.sort(),
      ['CONTRACT.md', path.join('.swarmforge', 'contract.yaml')].sort(),
      `expected both files to be reported as already present and committed, got: ${JSON.stringify(ctx.result)}`
    );
  });
}

module.exports = { registerSteps };
