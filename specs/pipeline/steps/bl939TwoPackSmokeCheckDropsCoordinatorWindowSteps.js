'use strict';

// BL-939: step handlers for "the stabilize-two-pack smoke check stops
// demanding a coordinator window line". Drives the real smoke check
// (swarmforge/scripts/smoke_check_stabilize_two_pack.sh) and the real pack
// parser (swarmforge.sh's parse_config, sourced under zsh - its own
// shebang and the shape the repo's existing coordinator-reservation test,
// test_coordinator_provisioned_infrastructure.sh, already uses) - never a
// reimplementation of either. The <declaration>/<result> Outline columns
// are validated against explicit KNOWN_VALUES, never passed through.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SMOKE_CHECK = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'smoke_check_stabilize_two_pack.sh');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const REAL_PROFILE = path.join(REPO_ROOT, 'swarmforge', 'profiles', 'stabilize-two-pack.conf');

const FEATURE = 'the stabilize-two-pack smoke check stops demanding a coordinator window line';

let cleanupFns = [];
afterEach(() => {
  while (cleanupFns.length) {
    const fn = cleanupFns.pop();
    try {
      fn();
    } catch {
      // best-effort - a cleanup throwing must never mask the scenario's own pass/fail result.
    }
  }
});

function runSmokeCheck(root) {
  try {
    const stdout = execFileSync('/bin/bash', [SMOKE_CHECK, root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function runParseConfig(confPath) {
  try {
    const stdout = execFileSync('zsh', ['-c', `source '${SWARMFORGE_SH}' '${REPO_ROOT}'; parse_config`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SWARMFORGE_CONFIG: confPath },
    });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const DECLARATION_BUILDERS = {
  'coder and cleaner only': () => fs.readFileSync(REAL_PROFILE, 'utf8'),
  'a coordinator window too': () => `${fs.readFileSync(REAL_PROFILE, 'utf8')}\nwindow coordinator claude coordinator\n`,
};

const RESULT_CHECKS = {
  'succeeds and provisions the coordinator itself': (result) => {
    assert.equal(result.exitCode, 0, `expected parse_config to succeed, got exit ${result.exitCode}. output:\n${result.output}`);
  },
  'is rejected as reserved infrastructure': (result) => {
    assert.notEqual(result.exitCode, 0, `expected parse_config to reject, got exit 0. output:\n${result.output}`);
    assert.match(result.output, /coordinator is reserved infrastructure/, `expected the reserved-infrastructure reason, got:\n${result.output}`);
  },
};

function makeFixtureRoot({ profileContent }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl939-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'profiles', 'stabilize-two-pack.conf'), profileContent);
  fs.copyFileSync(path.join(REPO_ROOT, '.vscode', 'launch.json'), path.join(root, '.vscode', 'launch.json'));
  cleanupFns.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function registerSteps(registry) {
  // ── Scenario 01 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the stabilize-two-pack profile as it stands, declaring coder and cleaner$/,
    (ctx) => {
      ctx.profileRoot = REPO_ROOT;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the stabilize-two-pack smoke check runs$/,
    (ctx) => {
      const result = runSmokeCheck(ctx.profileRoot);
      ctx.exitCode = result.exitCode;
      ctx.output = result.output;
    },
    FEATURE
  );

  registry.defineScoped(
    /^it passes$/,
    (ctx) => {
      assert.equal(ctx.exitCode, 0, `expected the smoke check to pass, got exit ${ctx.exitCode}. output:\n${ctx.output}`);
      assert.match(ctx.output, /SMOKE PASS/, `expected an SMOKE PASS line, got:\n${ctx.output}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^it does not report a missing coordinator role$/,
    (ctx) => {
      assert.ok(!/expected \[coordinator/.test(ctx.output), `expected no stale coordinator expectation, got:\n${ctx.output}`);
      assert.ok(!/SMOKE FAIL/.test(ctx.output), `expected no SMOKE FAIL line, got:\n${ctx.output}`);
    },
    FEATURE
  );

  // ── Scenario 02 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^a profile that declares (.+)$/,
    (ctx, token) => {
      const build = DECLARATION_BUILDERS[token];
      if (!build) {
        throw new Error(`unknown declaration token: ${token}`);
      }
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl939-parse-'));
      cleanupFns.push(() => fs.rmSync(root, { recursive: true, force: true }));
      ctx.confPath = path.join(root, 'stabilize-two-pack.conf');
      fs.writeFileSync(ctx.confPath, build());
    },
    FEATURE
  );

  registry.defineScoped(
    /^the pack configuration is parsed$/,
    (ctx) => {
      ctx.parseResult = runParseConfig(ctx.confPath);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the parse (.+)$/,
    (ctx, token) => {
      const check = RESULT_CHECKS[token];
      if (!check) {
        throw new Error(`unknown result token: ${token}`);
      }
      check(ctx.parseResult);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the stabilize-two-pack profile with its cleaner window removed$/,
    (ctx) => {
      const withoutCleaner = fs
        .readFileSync(REAL_PROFILE, 'utf8')
        .split('\n')
        .filter((line) => !line.startsWith('window cleaner'))
        .join('\n');
      ctx.profileRoot = makeFixtureRoot({ profileContent: withoutCleaner });
    },
    FEATURE
  );

  registry.defineScoped(
    /^it fails naming the missing cleaner role$/,
    (ctx) => {
      assert.notEqual(ctx.exitCode, 0, `expected the smoke check to fail, got exit 0. output:\n${ctx.output}`);
      assert.match(ctx.output, /SMOKE FAIL: profile defines roles \[coder\]/, `expected a FAIL naming the missing cleaner role, got:\n${ctx.output}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
