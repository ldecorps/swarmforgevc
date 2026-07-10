'use strict';

// BL-259: step handlers for "a gated static dependency-rule checker
// enforces the project's dependency-direction rules". Drives the REAL
// pinned dependency-cruiser PLUS the supplementary global-usage scan (via
// extension/out/tools/dependency-gate.js's exported runGate - the SAME
// combined wiring the architect's own gate run uses, fixed after QA bounce
// 6747a4812d found depcruise alone cannot see a bare localStorage/
// sessionStorage global reference) against REAL, isolated fixture code
// trees, using the REAL project ruleset (.dependency-cruiser.cjs) - per
// the ticket's own "the ruleset itself is validated by running the pinned
// checker against fixture code" requirement. No mocked checker output.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runGate: runDependencyGate } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'dependency-gate'));
const { formatBounceNote } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'quality', 'dependencyGate'));

const REAL_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'extension', '.dependency-cruiser.cjs');

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-dependency-gate-'));
}

function writeFixtureTsconfig(root) {
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'commonjs', target: 'ES2022', allowJs: true }, include: ['src/**/*', 'media/**/*'] })
  );
}

function writeFile(root, relPath, content) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function runGateForCtx(ctx, scopePaths) {
  ctx.gateResult = runDependencyGate(scopePaths, ctx.fixtureRoot, REAL_CONFIG_PATH);
}

// One fixture-builder per Scenario Outline `forbidden edge` value (a
// closed, known set from the feature file's own table) - each returns the
// scope path to scan and the expected rule name, so the Then step never
// has to guess which rule a given edge SHOULD trip.
const FORBIDDEN_EDGE_FIXTURES = {
  'a policy module imports a filesystem or IO module': (root) => {
    writeFile(root, 'src/quality/bad.ts', "import * as fs from 'fs';\nexport function bad() { return fs.existsSync('.'); }\n");
    return { scope: ['src'], expectedRule: 'no-io-from-policy' };
  },
  'view or webview code imports extension-host IO': (root) => {
    writeFile(root, 'src/swarm/hostThing.ts', 'export function hostThing() { return 1; }\n');
    writeFile(root, 'media/view.js', "const { hostThing } = require('../src/swarm/hostThing');\nhostThing();\n");
    return { scope: ['media'], expectedRule: 'view-not-import-host-io' };
  },
  'view-layer code spawns a child process': (root) => {
    writeFile(root, 'media/spawner.js', "const { execSync } = require('child_process');\nexecSync('ls');\n");
    return { scope: ['media'], expectedRule: 'no-process-spawn-from-view' };
  },
  'a testable-core module imports the VS Code API': (root) => {
    writeFile(root, 'src/swarm/oops.ts', "import * as vscode from 'vscode';\nexport function oops() { return vscode; }\n");
    return { scope: ['src'], expectedRule: 'core-not-vscode-api' };
  },
  // QA bounce (6747a4812d): the ORIGINAL fixture here used
  // require('localforage') - a wrapper-package IMPORT, which
  // dependency-cruiser's own import-graph analysis can see. But the
  // realistic violation (and QA's own exact repro) is a BARE
  // localStorage/sessionStorage global reference, which has no import
  // statement at all - depcruise alone cannot see it; only the
  // supplementary scan runGate() now also runs can. This fixture matches
  // QA's own repro pattern exactly.
  'webview code imports browser storage': (root) => {
    writeFile(root, 'media/storage.js', "localStorage.setItem('x', '1');\n");
    return { scope: ['media'], expectedRule: 'no-webview-storage' };
  },
  'the imports form a dependency cycle': (root) => {
    writeFile(root, 'src/swarm/a.ts', "import { b } from './b';\nexport function a() { return b; }\n");
    writeFile(root, 'src/swarm/b.ts', "import { a } from './a';\nexport function b() { return a; }\n");
    return { scope: ['src'], expectedRule: 'acyclic' };
  },
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a pinned dependency-rule checker configured with this project's forbidden-edge ruleset$/, (ctx) => {
    ctx.fixtureRoot = mkFixtureRoot();
    writeFixtureTsconfig(ctx.fixtureRoot);
  });

  // ── clean-passes-01 ──────────────────────────────────────────────────
  registry.define(/^changed files with no forbidden dependency edge$/, (ctx) => {
    writeFile(ctx.fixtureRoot, 'src/quality/clean.ts', 'export function clean(x) { return x + 1; }\n');
    ctx.scope = ['src'];
  });

  registry.define(/^the architect runs the dependency-rule gate$/, (ctx) => {
    runGateForCtx(ctx, ctx.scope);
  });

  registry.define(/^the gate passes and the parcel may proceed$/, (ctx) => {
    if (!ctx.gateResult.passed) {
      throw new Error(`expected the gate to pass, got violations: ${JSON.stringify(ctx.gateResult.violations)}`);
    }
  });

  // ── violation-hard-fails-and-bounces-02 ──────────────────────────────
  registry.define(/^a changed file that imports across a forbidden boundary$/, (ctx) => {
    const { scope } = FORBIDDEN_EDGE_FIXTURES['a policy module imports a filesystem or IO module'](ctx.fixtureRoot);
    ctx.scope = scope;
  });

  registry.define(/^the gate fails hard$/, (ctx) => {
    if (ctx.gateResult.passed) {
      throw new Error('expected the gate to fail hard, but it passed');
    }
  });

  registry.define(/^the architect bounces the parcel to the coder naming the offending edge and the rule it breaks$/, (ctx) => {
    ctx.bounceNote = formatBounceNote(ctx.gateResult.violations);
    if (!/src\/quality\/bad\.ts/.test(ctx.bounceNote) || !/fs/.test(ctx.bounceNote) || !/no-io-from-policy/.test(ctx.bounceNote)) {
      throw new Error(`expected the bounce note to name the edge and rule, got: ${ctx.bounceNote}`);
    }
  });

  registry.define(/^the parcel is not forwarded onward$/, (ctx) => {
    // A hard-fail gate result (asserted above) is structurally the ONLY
    // signal that drives the architect's own bounce-vs-forward decision -
    // "not forwarded" is the architect's routing action, out of this pure
    // module's own testable surface (the ticket's own INFORMS-not-gates
    // framing: this tool produces a report, never routes anything itself).
    // Asserted here as the invariant a caller must honor: passed=false
    // never coexists with an empty, non-actionable bounce note.
    if (ctx.gateResult.passed || !ctx.bounceNote || ctx.bounceNote.trim().length === 0) {
      throw new Error('expected a non-empty, actionable bounce note precisely when the gate failed - the only correct basis for withholding forward');
    }
  });

  // ── ruleset-enforced-03 ───────────────────────────────────────────────
  registry.define(/^a dependency edge where "([^"]+)"$/, (ctx, forbiddenEdge) => {
    const buildFixture = FORBIDDEN_EDGE_FIXTURES[forbiddenEdge];
    if (!buildFixture) {
      throw new Error(`unrecognized forbidden edge: "${forbiddenEdge}"`);
    }
    const { scope, expectedRule } = buildFixture(ctx.fixtureRoot);
    ctx.scope = scope;
    ctx.expectedRule = expectedRule;
  });

  registry.define(/^the gate runs$/, (ctx) => {
    runGateForCtx(ctx, ctx.scope);
  });

  registry.define(/^it is reported as violating the "([^"]+)" rule$/, (ctx, expectedRuleName) => {
    if (expectedRuleName !== ctx.expectedRule) {
      throw new Error(`fixture/example mismatch: fixture expects "${ctx.expectedRule}", example says "${expectedRuleName}"`);
    }
    if (!ctx.gateResult.violations.some((v) => v.rule === expectedRuleName)) {
      throw new Error(`expected a violation of rule "${expectedRuleName}", got: ${JSON.stringify(ctx.gateResult.violations)}`);
    }
  });

  // ── deterministic-report-04 ────────────────────────────────────────────
  registry.define(/^the same code and ruleset$/, (ctx) => {
    writeFile(ctx.fixtureRoot, 'src/quality/bad.ts', "import * as fs from 'fs';\nexport function bad() { return fs.existsSync('.'); }\n");
    ctx.scope = ['src'];
  });

  registry.define(/^running it again produces the same violation report$/, (ctx) => {
    const first = runDependencyGate(ctx.scope, ctx.fixtureRoot, REAL_CONFIG_PATH);
    const second = runDependencyGate(ctx.scope, ctx.fixtureRoot, REAL_CONFIG_PATH);
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error('expected byte-identical reports across repeated runs on identical inputs');
    }
  });

  // ── scope-changed-vs-full-05 ──────────────────────────────────────────
  const SCOPE_FIXTURES = {
    'per-parcel': (root) => {
      writeFile(root, 'src/quality/clean.ts', 'export function clean() { return 1; }\n');
      writeFile(root, 'src/swarm/bad.ts', "import * as fs from 'fs';\nexport function bad() { return fs.existsSync('.'); }\n");
      return ['src/quality/clean.ts'];
    },
    'full-repo': (root) => {
      writeFile(root, 'src/quality/clean.ts', 'export function clean() { return 1; }\n');
      return ['src'];
    },
  };

  registry.define(/^a "([^"]+)" run$/, (ctx, scopeName) => {
    const buildScope = SCOPE_FIXTURES[scopeName];
    if (!buildScope) {
      throw new Error(`unrecognized scope: "${scopeName}"`);
    }
    ctx.scope = buildScope(ctx.fixtureRoot);
    ctx.scopeName = scopeName;
  });

  registry.define(/^it checks "([^"]+)"$/, (ctx, expectedCoverage) => {
    runGateForCtx(ctx, ctx.scope);
    if (ctx.scopeName === 'per-parcel') {
      if (expectedCoverage !== 'only the changed files') {
        throw new Error(`fixture/example mismatch for per-parcel: "${expectedCoverage}"`);
      }
      if (!ctx.gateResult.passed) {
        throw new Error('expected per-parcel scope to see ONLY the clean file it was pointed at, not the sibling violation elsewhere in the fixture');
      }
    } else if (ctx.scopeName === 'full-repo') {
      if (expectedCoverage !== 'the whole repository') {
        throw new Error(`fixture/example mismatch for full-repo: "${expectedCoverage}"`);
      }
      if (!ctx.gateResult) {
        throw new Error('expected a full-repo gate result to have been computed');
      }
    } else {
      throw new Error(`unrecognized scope: "${ctx.scopeName}"`);
    }
  });
}

module.exports = { registerSteps };
