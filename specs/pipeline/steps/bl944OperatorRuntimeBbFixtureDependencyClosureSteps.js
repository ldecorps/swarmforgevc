'use strict';

// BL-944: step handlers for "The operator_runtime.bb acceptance fixture
// carries every file it loads". Drives the real
// operatorRuntimeBbClosure.js/operatorRuntimeBbFixtureFiles.js and a real
// bb operator_runtime.bb --tick-once subprocess - never a reimplementation
// of the closure walk or the fixture-building mechanism.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { diffClosureAgainstList } = require('./lib/operatorRuntimeBbClosure');
const { OPERATOR_RUNTIME_BB_FILES, OPERATOR_RUNTIME_BB_DECLARED_EXTRAS } = require('./lib/operatorRuntimeBbFixtureFiles');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ENTRY_FILE = 'operator_runtime.bb';

const FEATURE = 'The operator_runtime.bb acceptance fixture carries every file it loads';

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  return root;
}

// Every Examples: <omitted> value is validated against an explicit
// KNOWN_VALUES lookup and throws on anything else (engineering.prompt's
// Scenario Outline rule) - never a bare passthrough. Also doubles as a
// sanity check that the named file is genuinely in the current list (a
// typo here would silently test nothing).
function knownOmitted(token) {
  if (!OPERATOR_RUNTIME_BB_FILES.includes(token)) {
    throw new Error(`unknown or already-absent <omitted> token: ${token}`);
  }
  return token;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the tracked Babashka scripts under swarmforge\/scripts$/,
    (ctx) => {
      ctx.scriptsDir = SCRIPTS_DIR;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the fixture dependency list used by the operator_runtime\.bb step handlers$/,
    (ctx) => {
      ctx.list = OPERATOR_RUNTIME_BB_FILES;
      ctx.declaredExtras = OPERATOR_RUNTIME_BB_DECLARED_EXTRAS;
    },
    FEATURE
  );

  // ── Scenario 01 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the transitive load-file closure of operator_runtime\.bb is computed from source$/,
    (ctx) => {
      ctx.diff = diffClosureAgainstList(ctx.scriptsDir, ENTRY_FILE, ctx.list, ctx.declaredExtras);
    },
    FEATURE
  );

  registry.defineScoped(
    /^every file in that closure is present in the fixture dependency list$/,
    (ctx) => {
      assert.deepEqual(ctx.diff.missing, [], `expected zero missing dependencies, found:\n${ctx.diff.missing.join('\n')}`);
    },
    FEATURE
  );

  // ── Scenario 02 (Outline) ────────────────────────────────────────────────
  registry.defineScoped(
    /^a fixture dependency list from which "([^"]+)" has been removed$/,
    (ctx, token) => {
      const omitted = knownOmitted(token);
      ctx.omitted = omitted;
      ctx.list = OPERATOR_RUNTIME_BB_FILES.filter((f) => f !== omitted);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the closure check runs against that list$/,
    (ctx) => {
      ctx.diff = diffClosureAgainstList(ctx.scriptsDir, ENTRY_FILE, ctx.list, ctx.declaredExtras);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the check fails$/,
    (ctx) => {
      const failed = ctx.diff.missing.length > 0 || ctx.diff.extra.length > 0;
      assert.ok(failed, `expected the closure check to fail, got a clean diff: ${JSON.stringify(ctx.diff)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^it names "([^"]+)" as missing from the list$/,
    (ctx, token) => {
      assert.ok(ctx.diff.missing.includes(token), `expected "${token}" reported missing, got: ${JSON.stringify(ctx.diff.missing)}`);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a fixture dependency list carrying an entry no load-file chain reaches$/,
    (ctx) => {
      ctx.unreachableEntry = 'bl944-not-a-real-dependency.bb';
      ctx.list = [...OPERATOR_RUNTIME_BB_FILES, ctx.unreachableEntry];
    },
    FEATURE
  );

  registry.defineScoped(
    /^that entry is not declared as needed by a non-load-file mechanism$/,
    (ctx) => {
      ctx.declaredExtras = OPERATOR_RUNTIME_BB_DECLARED_EXTRAS.filter((e) => (typeof e === 'string' ? e : e.file) !== ctx.unreachableEntry);
    },
    FEATURE
  );

  registry.defineScoped(
    /^it names that entry as unreachable and undeclared$/,
    (ctx) => {
      assert.ok(ctx.diff.extra.includes(ctx.unreachableEntry), `expected "${ctx.unreachableEntry}" reported as an undeclared extra, got: ${JSON.stringify(ctx.diff.extra)}`);
    },
    FEATURE
  );

  // ── Scenario 04 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a disposable fixture root populated from the fixture dependency list$/,
    (ctx) => {
      const root = mkTmp('sfvc-bl944-');
      const dest = path.join(root, 'swarmforge', 'scripts');
      fs.mkdirSync(dest, { recursive: true });
      fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
      for (const f of OPERATOR_RUNTIME_BB_FILES) {
        fs.copyFileSync(path.join(SCRIPTS_DIR, f), path.join(dest, f));
      }
      ctx.fixtureRoot = root;
    },
    FEATURE
  );

  registry.defineScoped(
    /^bb operator_runtime\.bb is run against that root with --tick-once$/,
    (ctx) => {
      try {
        const stdout = execFileSync(
          'bb',
          [path.join(ctx.fixtureRoot, 'swarmforge', 'scripts', 'operator_runtime.bb'), ctx.fixtureRoot, '--tick-once'],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              OPERATOR_SKIP_LAUNCH: '1',
              SWARMFORGE_SKIP_TUNNEL: '1',
              SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS: '',
            },
            timeout: 15000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );
        ctx.tickResult = { output: stdout };
      } catch (err) {
        ctx.tickResult = { output: `${err.stdout || ''}${err.stderr || ''}` };
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^no FileNotFoundException is raised while loading Babashka sources$/,
    (ctx) => {
      assert.ok(
        !/FileNotFoundException.*\.bb\b/.test(ctx.tickResult.output),
        `expected no .bb-file FileNotFoundException, got:\n${ctx.tickResult.output}`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
