'use strict';

// BL-1618: step handlers for "One verification command per role encodes
// the lane set". Drives the REAL verify_lanes.sh against a fixture
// checkout (a full copy of swarmforge/scripts/ so its own load-file
// closure resolves) with a recording fake npm and a recording fake
// run_acceptance.sh prepended onto PATH - the script never learns the
// difference, since it invokes both by bare name (`command -v
// run_acceptance.sh`, and npm always resolves via PATH).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1618 One verification command per role encodes the lane set';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

// BL-1390: proves the fixture root is a genuinely fresh, isolated git init
// (never the live checkout or a shared worktree) before any mutating call.
function proveFixtureIsolated(root) {
  const commonDir = git(root, ['rev-parse', '--git-common-dir']);
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

function installScripts(root) {
  const dest = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(REAL_SCRIPTS_DIR)) {
    const full = path.join(REAL_SCRIPTS_DIR, name);
    if (fs.statSync(full).isFile() && (name.endsWith('.bb') || name.endsWith('.sh'))) {
      fs.copyFileSync(full, path.join(dest, name));
      fs.chmodSync(path.join(dest, name), 0o755);
    }
  }
}

function makeFakeBin(root) {
  const bin = path.join(root, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  const npmLog = path.join(root, 'npm-invocations.log');
  const raLog = path.join(root, 'run-acceptance-invocations.log');
  fs.writeFileSync(
    path.join(bin, 'npm'),
    `#!/usr/bin/env bash\necho "$*" >> "${npmLog}"\nif [[ "$*" == *"$(cat "${root}/.fail-npm-arg" 2>/dev/null || echo __never__)"* ]]; then\n  echo "fake npm: forced failure for: $*" >&2\n  exit 1\nfi\nexit 0\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(bin, 'run_acceptance.sh'),
    `#!/usr/bin/env bash\necho "$*" >> "${raLog}"\nexit 0\n`,
    { mode: 0o755 }
  );
  return { bin, npmLog, raLog };
}

function ensure(ctx) {
  if (!ctx.bl1618) {
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bl1618-'));
    git(root, ['init', '-q', '-b', 'main', '.']);
    proveFixtureIsolated(root);
    git(root, ['config', 'user.email', 't@t']);
    git(root, ['config', 'user.name', 't']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    writeFile(root, 'seed.txt', 'seed\n');
    commit(root, 'seed');
    installScripts(root);
    fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'roles.tsv'),
      [
        `coder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask`,
        `cleaner\tcleaner\t${root}\tswarmforge-cleaner\tCleaner\tclaude\tbatch`,
        `architect\tarchitect\t${root}\tswarmforge-architect\tArchitect\tclaude\ttask`,
        `hardender\thardender\t${root}\tswarmforge-hardender\tHardener\tclaude\tbatch`,
        `documenter\tdocumenter\t${root}\tswarmforge-documenter\tDocumenter\tclaude\ttask`,
        `QA\tQA\t${root}\tswarmforge-QA\tQa\tclaude\ttask`,
      ].join('\n') + '\n'
    );
    fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
    writeFile(
      root,
      'backlog/active/BL-9001-fixture.yaml',
      'id: BL-9001\ntitle: "fixture"\nstatus: todo\nassigned_to: coder\nacceptance: specs/features/BL-9001-fixture.feature\n'
    );
    commit(root, 'ticket + roles.tsv + swarmforge scripts');
    // origin/main: the changed-path fallback base when no in_process
    // parcel names a received commit (this fixture never seeds one - the
    // ticket's own conditional-lane examples all key off "the parcel
    // changed <paths>", which this feature reads via origin/main, the
    // documented fallback).
    git(root, ['update-ref', 'refs/remotes/origin/main', git(root, ['rev-parse', 'HEAD'])]);
    const { bin, npmLog, raLog } = makeFakeBin(root);
    ctx.bl1618 = {
      root,
      bin,
      npmLog,
      raLog,
      verifyLanes: path.join(root, 'swarmforge', 'scripts', 'verify_lanes.sh'),
    };
  }
  return ctx.bl1618;
}

function runVerifyLanes(state, args, env) {
  try {
    const out = execFileSync('bash', [state.verifyLanes, ...args], {
      cwd: state.root,
      encoding: 'utf8',
      env: { PATH: `${state.bin}:${process.env.PATH}`, HOME: process.env.HOME, ...env },
    });
    return { status: 0, output: out };
  } catch (e) {
    return { status: e.status ?? 1, output: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const PATH_CHANGES = {
  'extension/src and extension/test': [
    ['extension/src/foo.ts', 'export const x = 1;\n'],
    ['extension/test/foo.test.js', "test('x', () => {});\n"],
  ],
  'extension/src': [['extension/src/foo.ts', 'export const x = 1;\n']],
  'docs only': [['docs/how-to/fixture.md', '# fixture\n']],
  'one property test file': [['extension/test/bl9001Invariant.property.test.js', "test('p', () => {});\n"]],
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture checkout with a recording fake npm and a recording fake run_acceptance\.sh on PATH$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the parcel's ticket names one acceptance feature file$/, () => {
    // Documented by construction: the fixture ticket's own acceptance:
    // field (written in ensure()) is a single feature path.
  });

  // ── Scenario Outline 01 ───────────────────────────────────────────────
  scoped(/^the parcel changed (extension\/src and extension\/test|extension\/src|docs only|one property test file)$/, (ctx, paths) => {
    const state = ensure(ctx);
    for (const [rel, content] of PATH_CHANGES[paths]) {
      writeFile(state.root, rel, content);
    }
    commit(state.root, `parcel change: ${paths}`);
  });

  scoped(/^verify_lanes\.sh is asked for the plan of role (\S+)$/, (ctx, role) => {
    const state = ensure(ctx);
    state.result = runVerifyLanes(state, [role, '--plan'], {});
  });

  scoped(/^the plan lists exactly (.+)$/, (ctx, lanesCsv) => {
    const state = ensure(ctx);
    assert.equal(state.result.status, 0, `expected a successful plan, got: ${state.result.output}`);
    const expected = lanesCsv.split(',').map((s) => s.trim());
    const actual = state.result.output.split('\n').map((s) => s.trim()).filter(Boolean);
    assert.deepEqual(actual, expected, `expected plan ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the fake npm fails its unit lane$/, (ctx) => {
    const state = ensure(ctx);
    fs.writeFileSync(path.join(state.root, '.fail-npm-arg'), 'test\n');
  });

  scoped(/^verify_lanes\.sh runs for role (\S+)$/, (ctx, role) => {
    const state = ensure(ctx);
    state.result = runVerifyLanes(state, [role], {});
  });

  scoped(/^the recorded invocations are compile then unit and nothing after$/, (ctx) => {
    const state = ensure(ctx);
    const log = fs.existsSync(state.npmLog) ? fs.readFileSync(state.npmLog, 'utf8').trim().split('\n') : [];
    assert.deepEqual(log, ['run compile', 'test'], `expected exactly [run compile, test], got: ${JSON.stringify(log)}`);
    assert.equal(fs.existsSync(state.raLog), false, 'expected run_acceptance.sh to never have been invoked (acceptance-own never reached)');
  });

  scoped(/^the exit status is non-zero and the verdict names the failed lane$/, (ctx) => {
    const state = ensure(ctx);
    assert.notEqual(state.result.status, 0, `expected a non-zero exit, got 0: ${state.result.output}`);
    assert.match(state.result.output, /FAILED at lane 'unit'/, `expected the verdict to name 'unit', got: ${state.result.output}`);
  });

  // ── Scenario Outline 03 ─────────────────────────────────────────────
  scoped(/^SWARMFORGE_ROLE is (\S+)$/, (ctx, seat) => {
    ensure(ctx);
    ctx.bl1618.seat = seat;
  });

  scoped(/^verify_lanes\.sh is asked for the plan with no role argument$/, (ctx) => {
    const state = ensure(ctx);
    state.result = runVerifyLanes(state, ['--plan'], { SWARMFORGE_ROLE: state.seat });
  });

  scoped(/^it prints the documenter plan$/, (ctx) => {
    const state = ensure(ctx);
    assert.equal(state.result.status, 0, `expected success, got: ${state.result.output}`);
    assert.deepEqual(
      state.result.output.split('\n').map((s) => s.trim()).filter(Boolean),
      ['compile', 'acceptance-own']
    );
  });

  scoped(/^it prints the coder plan$/, (ctx) => {
    const state = ensure(ctx);
    assert.equal(state.result.status, 0, `expected success, got: ${state.result.output}`);
    assert.deepEqual(
      state.result.output.split('\n').map((s) => s.trim()).filter(Boolean),
      ['compile', 'unit', 'properties', 'acceptance-own']
    );
  });

  scoped(/^it refuses naming the unknown role and runs no lane at all$/, (ctx) => {
    const state = ensure(ctx);
    assert.notEqual(state.result.status, 0, `expected a refusal, got 0: ${state.result.output}`);
    assert.match(state.result.output, /unknown role 'gardener'/, `expected the refusal to name gardener, got: ${state.result.output}`);
  });
}

module.exports = { registerSteps };
