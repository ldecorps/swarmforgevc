'use strict';

// BL-1501: step handlers for "the two hotfix test runners sweep the temp
// roots they create". Scenario 01 drives the REAL regression guard
// (specs/pipeline/steps/lib/tempDirTrapGuard.js) over the real
// swarmforge/scripts tree, same module the standing unit test
// (extension/test/tempDirTrapGuard.test.js) drives - never a
// reimplementation here. Scenario 02 drives the two ACTUAL hotfix runners
// under a designated Babashka temp root. Scenario 03 reads the guard's
// exempt list from its own source (the guard module does not export
// SELF_EXEMPT_BASENAMES, and this ticket does not touch the guard) and
// proves a planted offender is still caught.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scanForTempDirTrapViolations } = require('./lib/tempDirTrapGuard');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SCRIPTS_TEST_DIR = path.join(SCRIPTS_DIR, 'test');
const GUARD_SOURCE_PATH = path.join(__dirname, 'lib', 'tempDirTrapGuard.js');

// BL-1277: "it reports zero violations" is also registered (unscoped) by
// bl872TempdirTrapGuardStandingSteps.js for its own, different scenario -
// scope this file's copy to its own feature rather than fight for the
// unscoped slot.
const FEATURE = 'BL-1501 The two hotfix test runners sweep the temp roots they create';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_RUNNERS = {
  'landed_ticket_autoclose_test_runner.bb': 'landed_ticket_autoclose_test_runner.bb',
  'wake_dedup_lib_test_runner.bb': 'wake_dedup_lib_test_runner.bb',
};

function registerSteps(registry) {
  // ── hotfix-runners-sweep-their-temp-roots-01 ────────────────────────────
  registry.define(/^the temp-dir-trap guard scans the real swarmforge\/scripts tree$/, (ctx) => {
    ctx.violations = scanForTempDirTrapViolations(SCRIPTS_DIR);
  });

  registry.defineScoped(
    /^it reports zero violations$/,
    (ctx) => {
      if (ctx.violations.length > 0) {
        throw new Error(`expected zero violations, found:\n${ctx.violations.map((v) => `${v.file}: ${v.reason}`).join('\n')}`);
      }
    },
    FEATURE
  );

  registry.define(
    /^the scanned tree still holds landed_ticket_autoclose_test_runner\.bb and wake_dedup_lib_test_runner\.bb, each creating a temp root$/,
    () => {
      for (const name of Object.keys(KNOWN_RUNNERS)) {
        const filePath = path.join(SCRIPTS_TEST_DIR, name);
        if (!fs.existsSync(filePath)) {
          throw new Error(`census pin: ${filePath} no longer exists under the scanned tree`);
        }
        const text = fs.readFileSync(filePath, 'utf8');
        if (!/fs\/create-temp-dir/.test(text)) {
          throw new Error(`census pin: ${filePath} no longer matches the guard's creation trigger (fs/create-temp-dir)`);
        }
      }
    }
  );

  // ── hotfix-runners-sweep-their-temp-roots-02 (Scenario Outline) ─────────
  registry.define(/^an empty directory designated as the Babashka temp root$/, (ctx) => {
    ctx.designatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1501-tmpdir-target-'));
  });

  registry.define(/^(\S+) runs to completion with its temp root pointed at that directory$/, (ctx, runnerName) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_RUNNERS, runnerName)) {
      throw new Error(`hotfix-runners-sweep-their-temp-roots-02: unrecognized <runner> example value "${runnerName}"`);
    }
    const result = spawnSync('bb', [`-Djava.io.tmpdir=${ctx.designatedDir}`, KNOWN_RUNNERS[runnerName]], {
      cwd: SCRIPTS_TEST_DIR,
      encoding: 'utf8',
    });
    ctx.runnerResult = result;
  });

  registry.define(/^the runner exits 0$/, (ctx) => {
    if (ctx.runnerResult.status !== 0) {
      throw new Error(
        `expected exit 0, got ${ctx.runnerResult.status}\nstdout:\n${ctx.runnerResult.stdout}\nstderr:\n${ctx.runnerResult.stderr}`
      );
    }
  });

  registry.define(/^the designated directory is empty afterwards$/, (ctx) => {
    const remaining = fs.readdirSync(ctx.designatedDir);
    fs.rmSync(ctx.designatedDir, { recursive: true, force: true });
    if (remaining.length > 0) {
      throw new Error(`expected ${ctx.designatedDir} empty after the runner exited, found: ${remaining.join(', ')}`);
    }
  });

  // ── hotfix-runners-sweep-their-temp-roots-03 ────────────────────────────
  registry.define(/^the temp-dir-trap guard's file-level exempt list is read$/, (ctx) => {
    const src = fs.readFileSync(GUARD_SOURCE_PATH, 'utf8');
    const match = src.match(/SELF_EXEMPT_BASENAMES\s*=\s*new Set\(\[([^\]]*)\]\)/);
    if (!match) {
      throw new Error(`could not find SELF_EXEMPT_BASENAMES in ${GUARD_SOURCE_PATH}`);
    }
    ctx.exemptBasenames = [...match[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] || m[2]);
  });

  registry.define(/^it names only tmp_cleanup\.sh$/, (ctx) => {
    if (ctx.exemptBasenames.length !== 1 || ctx.exemptBasenames[0] !== 'tmp_cleanup.sh') {
      throw new Error(`expected exactly ["tmp_cleanup.sh"], got ${JSON.stringify(ctx.exemptBasenames)}`);
    }
  });

  registry.define(/^a scratch tree holding one Babashka file that creates a temp root with no cleanup is still reported$/, (ctx) => {
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1501-fixture-tree-'));
    const offender = path.join(scratchRoot, 'bl1501_fixture_offender.bb');
    fs.writeFileSync(offender, '(def d (str (fs/create-temp-dir {:prefix "bl1501-fixture-"})))\n');
    const violations = scanForTempDirTrapViolations(scratchRoot);
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    const flagged = violations.map((v) => v.file);
    if (!flagged.includes(offender)) {
      throw new Error(`expected ${offender} to be named as a violation, got:\n${flagged.join('\n')}`);
    }
  });
}

module.exports = { registerSteps };
