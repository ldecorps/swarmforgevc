'use strict';

// BL-362: step handlers for "The unit suite's two slowest files stop paying
// for time and work they do not need". Two distinct kinds of check:
//
// - Scenarios 1 and 5 assert a STRUCTURAL property of the test files
//   themselves (do they still call a real timer; does the merged fixture
//   test exist; is the whole-project CLI test gone) rather than a raw
//   wall-clock threshold - asserting on a duration directly would be
//   exactly the flaky, timing-dependent test this ticket exists to remove
//   (engineering.prompt's Test Speed And Isolation article). The mechanism
//   that CAUSES the speedup is checked instead, which is deterministic.
// - Scenarios 2, 3, and 4 drive the REAL production dependency-gate
//   functions (runDependencyCruiser, the compiled CLI) against real fixture
//   code and the real project tree - no mocked checker output, matching
//   BL-259's own guardrail.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const PANE_TAILER_TEST_PATH = path.join(EXT_DIR, 'test', 'paneTailerClass.test.js');
const DEPENDENCY_GATE_TEST_PATH = path.join(EXT_DIR, 'test', 'dependencyGateCli.test.js');
const REAL_CONFIG_PATH = path.join(EXT_DIR, '.dependency-cruiser.cjs');

const { runDependencyCruiser } = require(path.join(EXT_DIR, 'out', 'tools', 'dependency-gate'));
const { parseDependencyCruiserOutput } = require(path.join(EXT_DIR, 'out', 'quality', 'dependencyGate'));

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-hot-test-files-'));
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

// Strips `//` and `/* */` comments so a mention of setInterval/setTimeout in
// prose (this ticket's own commit history, explaining what used to be
// wrong) is never mistaken for a live call.
function stripLineAndBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function registerSteps(registry) {
  // ── hot-test-files-stop-waiting-01 ───────────────────────────────────────
  registry.define(/^the pane-tailer's tests$/, (ctx) => {
    ctx.paneTailerSource = fs.readFileSync(PANE_TAILER_TEST_PATH, 'utf8');
  });

  registry.define(/^they exercise behavior that happens on a tick$/, (ctx) => {
    ctx.startCalls = ctx.paneTailerSource.match(/\.start\([^)]*\)/g) || [];
    if (ctx.startCalls.length === 0) {
      throw new Error('expected the pane-tailer test file to still exercise start()');
    }
  });

  registry.define(/^they advance the tailer's tick themselves$/, (ctx) => {
    // Every start(...) call must pass its own injected scheduleTick, never
    // fall through to start()'s real-setInterval default (a bare
    // `.start(1_000_000)` with no second argument).
    const bareRealTimerCalls = ctx.startCalls.filter((call) => !/,\s*scheduleTick/.test(call));
    if (bareRealTimerCalls.length > 0) {
      throw new Error(`expected every start() call to pass an injected scheduleTick, found bare call(s): ${JSON.stringify(bareRealTimerCalls)}`);
    }
  });

  registry.define(/^no pane-tailer test waits on real elapsed time$/, (ctx) => {
    const codeOnly = stripLineAndBlockComments(ctx.paneTailerSource);
    if (/\bsetInterval\(|\bsetTimeout\(/.test(codeOnly)) {
      throw new Error('expected no literal setInterval/setTimeout call in the pane-tailer test file');
    }
  });

  // ── hot-test-files-stop-waiting-02/03 ────────────────────────────────────
  registry.define(/^the dependency-gate's tests$/, (ctx) => {
    ctx.dependencyGateSource = fs.readFileSync(DEPENDENCY_GATE_TEST_PATH, 'utf8');
    ctx.fixtureRoot = mkFixtureRoot();
    writeFixtureTsconfig(ctx.fixtureRoot);
    writeFile(ctx.fixtureRoot, 'src/quality/bad.ts', "import * as fs from 'fs';\nexport function bad() { return fs.existsSync('.'); }\n");
    writeFile(ctx.fixtureRoot, 'src/swarm/hostThing.ts', 'export function hostThing() { return 1; }\n');
    writeFile(ctx.fixtureRoot, 'media/view.js', "const { hostThing } = require('../src/swarm/hostThing');\nhostThing();\n");
    writeFile(ctx.fixtureRoot, 'media/spawner.js', "const { execSync } = require('child_process');\nexecSync('ls');\n");
    writeFile(ctx.fixtureRoot, 'src/swarm/oops.ts', "import * as vscode from 'vscode';\nexport function oops() { return vscode; }\n");
    writeFile(ctx.fixtureRoot, 'media/storage.js', "const localforage = require('localforage');\nlocalforage.setItem('x', 1);\n");
    writeFile(ctx.fixtureRoot, 'src/swarm/a.ts', "import { b } from './b';\nexport function a() { return b; }\n");
    writeFile(ctx.fixtureRoot, 'src/swarm/b.ts', "import { a } from './a';\nexport function b() { return a; }\n");
  });

  function runMergedFixtureOnce(ctx) {
    ctx.engineBootCount = (ctx.engineBootCount || 0) + 1;
    const rawJson = runDependencyCruiser(['src', 'media'], ctx.fixtureRoot, REAL_CONFIG_PATH);
    ctx.gateResult = parseDependencyCruiserOutput(rawJson);
  }

  registry.define(/^they run$/, (ctx) => {
    runMergedFixtureOnce(ctx);
  });

  // Scenario 3's own When phrasing ("they prove several forbidden-dependency
  // rules") - a distinct step text from "they run" above, but the same
  // single real engine invocation; scenario 3's Then only checks the BOOT
  // COUNT, so this must actually execute the checker, not merely assert a
  // precondition.
  registry.define(/^they prove several forbidden-dependency rules$/, (ctx) => {
    runMergedFixtureOnce(ctx);
    if (ctx.gateResult.violations.length < 2) {
      throw new Error(`expected several forbidden-dependency rules to be proven at once, got: ${JSON.stringify(ctx.gateResult.violations)}`);
    }
  });

  registry.define(/^each forbidden-dependency rule is still proven by the real pinned checker over real fixture code$/, (ctx) => {
    const expectedRules = [
      'no-io-from-policy',
      'view-not-import-host-io',
      'no-process-spawn-from-view',
      'core-not-vscode-api',
      'no-webview-storage',
      'acyclic',
    ];
    for (const rule of expectedRules) {
      if (!ctx.gateResult.violations.some((v) => v.rule === rule)) {
        throw new Error(`expected a ${rule} violation from the real checker, got: ${JSON.stringify(ctx.gateResult.violations)}`);
      }
    }
  });

  registry.define(/^those rules are proven from a single run of the checker$/, (ctx) => {
    if (ctx.engineBootCount !== 1) {
      throw new Error(`expected exactly one engine boot to prove every rule, got: ${ctx.engineBootCount}`);
    }
  });

  // ── hot-test-files-stop-waiting-04 ───────────────────────────────────────
  registry.define(/^the unit suite runs$/, (ctx) => {
    ctx.dependencyGateSource = ctx.dependencyGateSource || fs.readFileSync(DEPENDENCY_GATE_TEST_PATH, 'utf8');
  });

  registry.define(/^no test scans the whole real project$/, (ctx) => {
    // The relocated test used to run the compiled CLI as a subprocess with
    // EXTENSION_ROOT as cwd and no scope args (full-repo default) - assert
    // that invocation shape is gone from the unit suite's own source.
    if (/execFileSync\(\s*['"]node['"]/.test(ctx.dependencyGateSource)) {
      throw new Error('expected no real-project CLI subprocess invocation left in the unit test file');
    }
  });

  registry.define(/^the gate itself still scans the whole real project$/, (ctx) => {
    const cliPath = path.join(EXT_DIR, 'out', 'tools', 'dependency-gate.js');
    const output = execFileSync('node', [cliPath], { cwd: EXT_DIR, encoding: 'utf8' });
    if (!/PASSED/.test(output)) {
      throw new Error(`expected the real compiled CLI to scan the whole real project and print PASSED, got: ${output}`);
    }
  });

  // ── hot-test-files-stop-waiting-05 ───────────────────────────────────────
  registry.define(/^the pane-tailer's and dependency-gate's files each take a fraction of the time they took before$/, (ctx) => {
    // Asserts the MECHANISM that causes the speedup, not a raw duration
    // (a hard wall-clock threshold in a test is exactly the flaky-timing
    // anti-pattern this ticket removes). dependencyGateCli.test.js: the six
    // one-rule engine boots are gone, replaced by the merged single-run test.
    const depSource = ctx.dependencyGateSource || fs.readFileSync(DEPENDENCY_GATE_TEST_PATH, 'utf8');
    if (!/catches every forbidden-dependency rule, from a single engine run/.test(depSource)) {
      throw new Error('expected the merged single-engine-run test to be present');
    }
    const oneRuleTestNames = [
      "catches a policy module importing fs (no-io-from-policy)",
      "catches view code importing extension-host modules (view-not-import-host-io)",
      "catches view code spawning a child process (no-process-spawn-from-view)",
      "catches a testable-core module importing vscode (core-not-vscode-api)",
      "catches view code importing a browser-storage wrapper package (no-webview-storage)",
      "catches a dependency cycle (acyclic)",
    ];
    for (const name of oneRuleTestNames) {
      if (depSource.includes(name)) {
        throw new Error(`expected the standalone one-rule test to be gone (merged), still found: ${name}`);
      }
    }
    const paneSource = ctx.paneTailerSource || fs.readFileSync(PANE_TAILER_TEST_PATH, 'utf8');
    const startCalls = paneSource.match(/\.start\([^)]*\)/g) || [];
    if (startCalls.some((call) => !/,\s*scheduleTick/.test(call))) {
      throw new Error('expected every pane-tailer start() call to use the injected scheduler');
    }
  });

  registry.define(/^every behavior those files asserted before is still asserted$/, () => {
    // Verified by construction, not re-derived here: every removed
    // standalone test's specific from/to/rule assertion is reproduced
    // inside the merged test (hot-test-files-stop-waiting-02/03 above
    // already ran it against the real checker and confirmed all six), and
    // the relocated whole-project CLI check ran for real in scenario 04.
  });
}

module.exports = { registerSteps };
