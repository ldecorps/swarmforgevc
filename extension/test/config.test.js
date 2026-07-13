const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const {
  buildTargetBootstrapFiles,
  planTargetBootstrapFiles,
  initializeTargetRepo,
  buildContractBootstrapFiles,
  initializeTargetContract,
  buildGeneratedPromptBootstrapFiles,
  initializeTargetPrompts,
  updateTargetContract,
} = require('../out/config/targetBootstrap');
const { resolveTargetPath } = require('../out/config/targetPath');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bootstrap-'));
}

const FIXTURE_CONTRACT = {
  scope: ['Build the thing.'],
  outOfScope: ['Rewrite the stack.'],
  boundaries: ['Respect the README.'],
  initialBacklogSummary: '3 tickets queued.',
  agreement: 'proposed',
};

const FIXTURE_PROMPTS = {
  projectPrompt: '# Project\nA visual front-end for SwarmForge\n',
  engineeringPrompt: '# Tech Stack\nTypeScript, Clojure\n',
};

test('resolveTargetPath prefers configured workspace target', () => {
  const target = resolveTargetPath({
    configuredTargetPath: '  /tmp/target  ',
    workspaceFolders: [{ uri: { fsPath: '/workspace/fallback' } }],
  });

  assert.equal(target, '/tmp/target');
});

test('resolveTargetPath falls back to the first workspace folder', () => {
  const target = resolveTargetPath({
    configuredTargetPath: '',
    workspaceFolders: [
      { uri: { fsPath: '/workspace/one' } },
      { uri: { fsPath: '/workspace/two' } },
    ],
  });

  assert.equal(target, '/workspace/one');
});

test('buildTargetBootstrapFiles returns the two swarm bootstrap prompts', () => {
  const files = buildTargetBootstrapFiles();

  assert.deepEqual(files.map((file) => file.path), [
    'project.prompt',
    'engineering.prompt',
  ]);
  assert.match(files[0].content, /# Project/);
  assert.match(files[0].content, /# Goals for this swarm run/);
  assert.match(files[1].content, /# Tech Stack/);
  assert.match(files[1].content, /# Architecture rules/);
});

test('planTargetBootstrapFiles skips files that already exist', () => {
  const plan = planTargetBootstrapFiles(new Set(['engineering.prompt']));

  assert.deepEqual(plan.filesToCreate.map((file) => file.path), [
    'project.prompt',
  ]);
  assert.deepEqual(plan.alreadyPresent, ['engineering.prompt']);
});

test('planTargetBootstrapFiles creates all files when none exist', () => {
  const plan = planTargetBootstrapFiles(new Set());

  assert.deepEqual(plan.filesToCreate.map((file) => file.path), [
    'project.prompt',
    'engineering.prompt',
  ]);
  assert.deepEqual(plan.alreadyPresent, []);
});

test('planTargetBootstrapFiles skips all files when all exist', () => {
  const plan = planTargetBootstrapFiles(new Set(['project.prompt', 'engineering.prompt']));

  assert.deepEqual(plan.filesToCreate, []);
  assert.deepEqual(plan.alreadyPresent, ['project.prompt', 'engineering.prompt']);
});

test('resolveTargetPath returns undefined when no path and no workspace folders', () => {
  const target = resolveTargetPath({});
  assert.equal(target, undefined);
});

test('resolveTargetPath returns undefined when path is whitespace only', () => {
  const target = resolveTargetPath({ configuredTargetPath: '   ' });
  assert.equal(target, undefined);
});

test('initializeTargetRepo creates both prompt files in a non-git directory', async () => {
  const tmp = mkTmpDir();
  const result = await initializeTargetRepo(tmp);
  assert.deepEqual(result.created.sort(), ['engineering.prompt', 'project.prompt']);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.committed, false);
  assert.ok(fs.existsSync(path.join(tmp, 'project.prompt')));
  assert.ok(fs.existsSync(path.join(tmp, 'engineering.prompt')));
});

test('initializeTargetRepo skips files that already exist', async () => {
  const tmp = mkTmpDir();
  fs.writeFileSync(path.join(tmp, 'project.prompt'), 'existing content');
  const result = await initializeTargetRepo(tmp);
  assert.deepEqual(result.created, ['engineering.prompt']);
  assert.deepEqual(result.skipped, ['project.prompt']);
  assert.equal(fs.readFileSync(path.join(tmp, 'project.prompt'), 'utf8'), 'existing content');
});

test('initializeTargetRepo skips commit when all files already present', async () => {
  const tmp = mkTmpDir();
  fs.writeFileSync(path.join(tmp, 'project.prompt'), 'x');
  fs.writeFileSync(path.join(tmp, 'engineering.prompt'), 'x');
  const result = await initializeTargetRepo(tmp);
  assert.equal(result.committed, false);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.skipped.sort(), ['engineering.prompt', 'project.prompt']);
});

// Same "nothing to create" case, but inside a real git repository - unlike
// the non-git case above, writeFilesAndCommit must skip the `git add`/
// `git commit` calls entirely on an empty file list rather than attempting
// a no-pathspec `git add` (which git itself errors on).
test('initializeTargetRepo skips commit when all files already present, in a git repository', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'project.prompt'), 'x');
  fs.writeFileSync(path.join(tmp, 'engineering.prompt'), 'x');
  const result = await initializeTargetRepo(tmp);
  assert.equal(result.committed, false);
  assert.deepEqual(result.created, []);
});

test('initializeTargetRepo commits new files in a git repository', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });
  const result = await initializeTargetRepo(tmp);
  assert.equal(result.committed, true);
  assert.deepEqual(result.created.sort(), ['engineering.prompt', 'project.prompt']);
  const log = execSync('git log --oneline', { cwd: tmp }).toString();
  assert.match(log, /Initialize SwarmForge target prompts/);
});

// A file absent from the working tree (so the fs.access idempotency check
// counts it as "to create") but already committed under git with the exact
// same content it gets rewritten with (e.g. `rm` without `git rm`) restages
// to no net diff from HEAD - `git commit` genuinely has nothing to commit.
// Treated as a quiet non-error, not a crash: `committed: false`, still
// reported as created since it was freshly written to disk.
test('initializeTargetRepo does not throw when re-creating a file whose content is unchanged from HEAD (nothing to commit)', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });
  await initializeTargetRepo(tmp);
  fs.unlinkSync(path.join(tmp, 'engineering.prompt'));
  fs.unlinkSync(path.join(tmp, 'project.prompt'));

  const result = await initializeTargetRepo(tmp);

  assert.equal(result.committed, false);
  assert.deepEqual(result.created.sort(), ['engineering.prompt', 'project.prompt']);
  assert.ok(fs.existsSync(path.join(tmp, 'engineering.prompt')), 'the file must still be restored to disk');
});

// ── BL-262: onboarding contract scaffold (extends the same idempotent seam) ──

test('buildContractBootstrapFiles returns the contract source and its legible view', () => {
  const files = buildContractBootstrapFiles(FIXTURE_CONTRACT);

  assert.deepEqual(
    files.map((file) => file.path),
    [path.join('.swarmforge', 'contract.yaml'), 'CONTRACT.md']
  );
  assert.match(files[0].content, /agreement: proposed/);
  assert.match(files[1].content, /Agreement: proposed/);
});

test('planTargetBootstrapFiles generalizes over an explicit file list (BL-262: not just the two prompts)', () => {
  const contractFiles = buildContractBootstrapFiles(FIXTURE_CONTRACT);

  const plan = planTargetBootstrapFiles(new Set([path.join('.swarmforge', 'contract.yaml')]), contractFiles);

  assert.deepEqual(plan.filesToCreate.map((file) => file.path), ['CONTRACT.md']);
  assert.deepEqual(plan.alreadyPresent, [path.join('.swarmforge', 'contract.yaml')]);
});

test('initializeTargetContract creates both contract files (including the nested .swarmforge/ dir) in a non-git directory', async () => {
  const tmp = mkTmpDir();
  const result = await initializeTargetContract(tmp, FIXTURE_CONTRACT);

  assert.deepEqual(result.created.sort(), ['CONTRACT.md', path.join('.swarmforge', 'contract.yaml')].sort());
  assert.deepEqual(result.skipped, []);
  assert.equal(result.committed, false);
  assert.ok(fs.existsSync(path.join(tmp, '.swarmforge', 'contract.yaml')));
  assert.ok(fs.existsSync(path.join(tmp, 'CONTRACT.md')));
});

test('initializeTargetContract skips a contract file that already exists (idempotent scaffold)', async () => {
  const tmp = mkTmpDir();
  fs.mkdirSync(path.join(tmp, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'contract.yaml'), 'agreement: agreed\n');

  const result = await initializeTargetContract(tmp, FIXTURE_CONTRACT);

  assert.deepEqual(result.created, ['CONTRACT.md']);
  assert.deepEqual(result.skipped, [path.join('.swarmforge', 'contract.yaml')]);
  assert.equal(fs.readFileSync(path.join(tmp, '.swarmforge', 'contract.yaml'), 'utf8'), 'agreement: agreed\n');
});

test('initializeTargetContract commits new contract files in a git repository with a distinct commit message', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });

  const result = await initializeTargetContract(tmp, FIXTURE_CONTRACT);

  assert.equal(result.committed, true);
  const log = execSync('git log --oneline', { cwd: tmp }).toString();
  assert.match(log, /Propose SwarmForge onboarding contract/);
});

test('initializeTargetContract and initializeTargetRepo compose without interfering (both run on the same target)', async () => {
  const tmp = mkTmpDir();

  const promptResult = await initializeTargetRepo(tmp);
  const contractResult = await initializeTargetContract(tmp, FIXTURE_CONTRACT);

  assert.deepEqual(promptResult.created.sort(), ['engineering.prompt', 'project.prompt']);
  assert.deepEqual(contractResult.created.sort(), ['CONTRACT.md', path.join('.swarmforge', 'contract.yaml')].sort());
  assert.ok(fs.existsSync(path.join(tmp, 'project.prompt')));
  assert.ok(fs.existsSync(path.join(tmp, 'CONTRACT.md')));
});

// ── BL-344: unconditional revision write, reusing writeFilesAndCommit ───────

test('updateTargetContract rewrites both contract files unconditionally, even though they already exist', async () => {
  const tmp = mkTmpDir();
  await initializeTargetContract(tmp, FIXTURE_CONTRACT);
  const revised = { ...FIXTURE_CONTRACT, scope: [...FIXTURE_CONTRACT.scope, 'Per operator request: add logging'] };

  const result = await updateTargetContract(tmp, revised, 'Revise contract');

  assert.equal(result.committed, false, 'no git repo here, so nothing to commit');
  const written = fs.readFileSync(path.join(tmp, '.swarmforge', 'contract.yaml'), 'utf8');
  assert.match(written, /add logging/);
});

test('updateTargetContract commits a real content change in a git repository', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });
  await initializeTargetContract(tmp, FIXTURE_CONTRACT);
  const revised = { ...FIXTURE_CONTRACT, scope: [...FIXTURE_CONTRACT.scope, 'Per operator request: add logging'] };

  const result = await updateTargetContract(tmp, revised, 'Revise contract (round 1)');

  assert.equal(result.committed, true);
  const log = execSync('git log --oneline', { cwd: tmp }).toString();
  assert.match(log, /Revise contract \(round 1\)/);
});

test('updateTargetContract returns committed:false when the content is unchanged from HEAD (nothing to commit)', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });
  await initializeTargetContract(tmp, FIXTURE_CONTRACT);

  const result = await updateTargetContract(tmp, FIXTURE_CONTRACT, 'Revise contract (no-op)');

  assert.equal(result.committed, false);
});

// A real commit failure (e.g. no git identity configured) is a DIFFERENT
// error than "nothing to commit" and must propagate, not be silently
// swallowed by the same catch that tolerates the no-op case above.
test('updateTargetContract propagates a real git commit failure instead of swallowing it', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });

  await assert.rejects(() => updateTargetContract(tmp, FIXTURE_CONTRACT, 'Revise contract'));
});

// ── BL-269: generated target prompts, gated on the contract's agreement ─────

test('buildGeneratedPromptBootstrapFiles returns project.prompt and engineering.prompt', () => {
  const files = buildGeneratedPromptBootstrapFiles(FIXTURE_PROMPTS);

  assert.deepEqual(files.map((file) => file.path), ['project.prompt', 'engineering.prompt']);
  assert.equal(files[0].content, FIXTURE_PROMPTS.projectPrompt);
  assert.equal(files[1].content, FIXTURE_PROMPTS.engineeringPrompt);
});

// BL-269 onboarding-generated-prompts-03 (proposed/pending rows)
test('initializeTargetPrompts withholds the prompts from the target repo when the gate holds (proposed)', async () => {
  const tmp = mkTmpDir();

  const result = await initializeTargetPrompts(tmp, FIXTURE_PROMPTS, { decision: 'hold', reason: 'proposed: not yet agreed' });

  assert.equal(result.withheld, true);
  assert.equal(result.committed, false);
  assert.deepEqual(result.created, []);
  assert.equal(fs.existsSync(path.join(tmp, 'project.prompt')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'engineering.prompt')), false);
});

test('initializeTargetPrompts withholds the prompts from the target repo when the gate holds (pending)', async () => {
  const tmp = mkTmpDir();

  const result = await initializeTargetPrompts(tmp, FIXTURE_PROMPTS, { decision: 'hold', reason: 'pending: not yet agreed' });

  assert.equal(result.withheld, true);
  assert.equal(fs.existsSync(path.join(tmp, 'project.prompt')), false);
});

// BL-269 onboarding-generated-prompts-03 (agreed row)
test('initializeTargetPrompts releases the prompts for commit to the target repo when the gate allows (agreed)', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });

  const result = await initializeTargetPrompts(tmp, FIXTURE_PROMPTS, { decision: 'allow' });

  assert.equal(result.withheld, false);
  assert.equal(result.committed, true);
  assert.deepEqual(result.created.sort(), ['engineering.prompt', 'project.prompt']);
  assert.equal(fs.readFileSync(path.join(tmp, 'project.prompt'), 'utf8'), FIXTURE_PROMPTS.projectPrompt);
  const log = execSync('git log --oneline', { cwd: tmp }).toString();
  assert.match(log, /Commit onboarding-generated target prompts/);
});

test('initializeTargetPrompts is idempotent: re-running after release does not re-write existing content', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });

  await initializeTargetPrompts(tmp, FIXTURE_PROMPTS, { decision: 'allow' });
  const secondResult = await initializeTargetPrompts(tmp, FIXTURE_PROMPTS, { decision: 'allow' });

  assert.deepEqual(secondResult.created, []);
  assert.deepEqual(secondResult.skipped.sort(), ['engineering.prompt', 'project.prompt']);
  assert.equal(secondResult.committed, false);
});
