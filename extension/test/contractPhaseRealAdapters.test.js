const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { targetCloneDir, createRealContractPhaseAdapters, surveyCliArgs, extractJsonObject } = require('../out/tools/contractPhaseRealAdapters');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-624: contractPhaseRealAdapters.ts is the untested I/O boundary (real
// git/claude/node subprocess calls) - unit tests fake ContractPhaseAdapters
// entirely elsewhere (contractPhaseRelay.test.js,
// onboarderContractPhaseRouter.test.js), never invoking anything in this
// file. What IS worth a real test, without shelling out to anything, is the
// pure path-derivation helper (targetCloneDir - mirrors
// onboarderStateStore.ts's own slugifyTargetRepoUrl determinism guarantees,
// load-bearing for idempotent redelivery: a redelivered "proceed" must
// resolve to the SAME clone directory, not a fresh one) and the factory's
// own wiring (every adapter method the interface requires is actually
// present as a function - catches a renamed/dropped method without needing
// a live git/claude call).

test('BL-624: targetCloneDir is deterministic for the same target and swarm root', () => {
  const a = targetCloneDir('/swarm/root', 'https://github.com/acme/widget');
  const b = targetCloneDir('/swarm/root', 'https://github.com/acme/widget');
  assert.equal(a, b);
});

test('BL-624: targetCloneDir collapses scheme/.git aliases onto the same directory, mirroring slugifyTargetRepoUrl', () => {
  const canonical = targetCloneDir('/swarm/root', 'https://github.com/acme/widget');
  assert.equal(targetCloneDir('/swarm/root', 'https://github.com/acme/widget.git'), canonical);
  assert.equal(targetCloneDir('/swarm/root', 'git@github.com:acme/widget.git'.replace('git@github.com:', 'https://github.com/')), canonical);
});

test('BL-624: targetCloneDir distinguishes different targets and different swarm roots', () => {
  const widget = targetCloneDir('/swarm/root', 'https://github.com/acme/widget');
  const gadget = targetCloneDir('/swarm/root', 'https://github.com/acme/gadget');
  assert.notEqual(widget, gadget);
  const otherRoot = targetCloneDir('/other/root', 'https://github.com/acme/widget');
  assert.notEqual(widget, otherRoot);
});

test('BL-624: targetCloneDir nests under the swarm root\'s own .swarmforge/onboarding-clones, never the target-side .swarmforge', () => {
  const dir = targetCloneDir('/swarm/root', 'https://github.com/acme/widget');
  assert.match(dir, /^\/swarm\/root\/\.swarmforge\/onboarding-clones\//);
});

test('BL-624: createRealContractPhaseAdapters wires every ContractPhaseAdapters method as a function', () => {
  const adapters = createRealContractPhaseAdapters('/swarm/root');
  for (const method of ['cloneTarget', 'surveyRepo', 'proposeContract', 'readCurrentContract', 'negotiateObject', 'negotiateApprove', 'checkGate', 'commitAndPush']) {
    assert.equal(typeof adapters[method], 'function', `expected adapters.${method} to be a function`);
  }
});

// BL-624 architect bounce (backlog/evidence/BL-624-onboarder-survey-untrusted-agent-bounce-20260815.md):
// the survey agent's cwd is a real, untrusted target clone with live push
// credentials, not a disposable scratch fixture (the condition that makes
// claudeCliExecutor.ts's own --dangerously-skip-permissions safe). It must
// never run with permissions blanket-skipped, and must be scoped to
// read-only tools only.
test('BL-624: surveyCliArgs never blanket-skips permissions', () => {
  const args = surveyCliArgs();
  assert.equal(args.includes('--dangerously-skip-permissions'), false);
});

test('BL-624: surveyCliArgs scopes the agent to read-only tools only', () => {
  const args = surveyCliArgs();
  const idx = args.indexOf('--allowedTools');
  assert.notEqual(idx, -1, 'expected --allowedTools to be present');
  const allowed = args[idx + 1].split(',');
  assert.deepEqual(allowed.sort(), ['Glob', 'Grep', 'Read'].sort());
  for (const dangerous of ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch']) {
    assert.equal(allowed.includes(dangerous), false, `expected ${dangerous} to be excluded from allowedTools`);
  }
});

// ── extractJsonObject (pure - the one part of defaultSurveyRepo's parsing
// that owes real coverage; the execFileSync('claude', ...) call above it
// is the genuine untested I/O boundary, this parsing logic is not) ──────

test('BL-624: extractJsonObject parses a clean JSON object directly', () => {
  const result = extractJsonObject('{"languages":["ts"],"layoutSummary":"x"}');
  assert.deepEqual(result, { languages: ['ts'], layoutSummary: 'x' });
});

test('BL-624: extractJsonObject falls back to a regex match for a JSON object wrapped in prose', () => {
  const result = extractJsonObject('Sure, here you go:\n{"languages":["ts"]}\nHope that helps!');
  assert.deepEqual(result, { languages: ['ts'] });
});

test('BL-624: extractJsonObject throws when no JSON object is present at all', () => {
  assert.throws(() => extractJsonObject('no JSON here, sorry'), /no JSON object found/);
});

// ── defaultReadCurrentContract (real fs, no subprocess needed) ──────────

test('BL-624: readCurrentContract returns undefined when the target has never had a contract written', async () => {
  const swarmRoot = mkTmpDir('bl624-read-contract-');
  const adapters = createRealContractPhaseAdapters(swarmRoot);
  const result = await adapters.readCurrentContract('https://github.com/acme/never-surveyed');
  assert.equal(result, undefined);
});

test('BL-624: readCurrentContract returns the parsed contract when one exists on disk at the target clone', async () => {
  const swarmRoot = mkTmpDir('bl624-read-contract-');
  const targetRepoUrl = 'https://github.com/acme/widget';
  const localPath = targetCloneDir(swarmRoot, targetRepoUrl);
  fs.mkdirSync(path.join(localPath, '.swarmforge'), { recursive: true });
  const contract = {
    scope: ['a'],
    outOfScope: ['b'],
    boundaries: ['c'],
    initialBacklogSummary: 'summary',
    agreement: 'proposed',
  };
  fs.writeFileSync(path.join(localPath, '.swarmforge', 'contract.yaml'), yaml.dump(contract), 'utf8');

  const adapters = createRealContractPhaseAdapters(swarmRoot);
  const result = await adapters.readCurrentContract(targetRepoUrl);
  assert.deepEqual(result, contract);
});

test('BL-624: readCurrentContract returns undefined (never throws) when the file on disk is malformed', async () => {
  const swarmRoot = mkTmpDir('bl624-read-contract-');
  const targetRepoUrl = 'https://github.com/acme/widget';
  const localPath = targetCloneDir(swarmRoot, targetRepoUrl);
  fs.mkdirSync(path.join(localPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(localPath, '.swarmforge', 'contract.yaml'), 'scope: [unterminated', 'utf8');

  const adapters = createRealContractPhaseAdapters(swarmRoot);
  const result = await adapters.readCurrentContract(targetRepoUrl);
  assert.equal(result, undefined);
});

// ── defaultCloneTarget's idempotent path (fs.existsSync check only - the
// actual `git clone` execFileSync call on the non-idempotent path remains
// the genuine untested I/O boundary) ─────────────────────────────────────

test('BL-624: cloneTarget is a no-op success when the target clone directory already has a .git (idempotent retry), never re-invoking git', async () => {
  const swarmRoot = mkTmpDir('bl624-clone-target-');
  // A bogus, unreachable URL: if the idempotent early-return did NOT fire,
  // the real `git clone` call below it would fail (or hang) against this
  // URL, so a passing {ok: true} here proves the early return actually ran.
  const targetRepoUrl = 'https://example.invalid/does/not/exist.git';
  const localPath = targetCloneDir(swarmRoot, targetRepoUrl);
  fs.mkdirSync(path.join(localPath, '.git'), { recursive: true });

  const adapters = createRealContractPhaseAdapters(swarmRoot);
  const result = await adapters.cloneTarget(targetRepoUrl);
  assert.deepEqual(result, { ok: true });
});
