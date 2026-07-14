'use strict';

// BL-374: step handlers for "A tool wrapper resolves every path argument
// against the caller". Drives the REAL run_gherkin_mutation.sh and the
// REAL vendored gherkin-mutator against the same tiny fixture
// gherkinMutation.test.js (BL-113) already uses, from a controlled caller
// cwd - proves the actual property (which directory receives the
// scratch), never a reimplemented stand-in for the vendored tool. Mirrors
// specs/pipeline/test/runGherkinMutationWorkDir.test.js's own fixture
// shape (deliberately duplicated, not shared - this codebase's
// established "small live-glue duplicated across independent test
// surfaces" posture).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_gherkin_mutation.sh');
const FIXTURE_FEATURE = path.join(REPO_ROOT, 'specs', 'pipeline', 'test', 'fixtures', 'mutation-wiring.feature');
const STEPS_MODULE = path.join(REPO_ROOT, 'specs', 'pipeline', 'test', 'fixtures', 'mutationWiringSteps.js');
const VENDOR_DIR = path.join(REPO_ROOT, 'swarmforge', 'vendor', 'aps');

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-wrapper-workdir-fixture-'));
  const featurePath = path.join(dir, 'mutation-wiring.feature');
  fs.copyFileSync(FIXTURE_FEATURE, featurePath);
  return { dir, featurePath };
}

function vendorDirGitStatus() {
  return execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain', '--', 'swarmforge/vendor/aps'], { encoding: 'utf8' });
}

// See runGherkinMutationWorkDir.test.js's own identical helper: every
// relative work-dir named below lands under this exact vendor path
// against the PRE-FIX script, so a prior scenario's leftover pollution
// could make a LATER before/after comparison falsely equal.
function cleanVendorTmpPollution() {
  fs.rmSync(path.join(VENDOR_DIR, 'tmp'), { recursive: true, force: true });
}

const WORK_DIR_FORMS = {
  relative: (ctx) => {
    ctx.callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-wrapper-caller-'));
    ctx.workDirArg = './tmp/gm-relative';
    ctx.expectedWorkDir = path.join(ctx.callerCwd, 'tmp', 'gm-relative');
  },
  absolute: (ctx) => {
    ctx.callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-wrapper-caller-'));
    ctx.expectedWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-wrapper-abs-workdir-'));
    ctx.workDirArg = ctx.expectedWorkDir;
  },
  omitted: (ctx) => {
    ctx.callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-wrapper-caller-'));
    ctx.workDirArg = '';
    ctx.expectedWorkDir = null; // unknown ahead of time - a fresh mktemp -d
  },
};

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^the gherkin-mutation wrapper is run from a worktree$/, () => {
    // Narrative only - each scenario below builds its own caller cwd.
  });

  // ── wrapper-resolves-paths-against-caller-01 ────────────────────────────
  registry.define(/^the caller passes a "?([a-z]+)"? work directory$/, (ctx, form) => {
    const setup = WORK_DIR_FORMS[form];
    if (!setup) {
      throw new Error(`unrecognized work-dir-form in Examples table: "${form}"`);
    }
    cleanVendorTmpPollution();
    const { dir, featurePath } = copyFixture();
    ctx.fixtureDir = dir;
    ctx.featurePath = featurePath;
    setup(ctx);
    const result = spawnSync('bash', [SCRIPT, ctx.featurePath, ctx.workDirArg, STEPS_MODULE, 'soft'], {
      cwd: ctx.callerCwd,
      encoding: 'utf8',
    });
    // gherkin-mutator exits non-zero whenever any mutant survives - this
    // fixture deliberately has one (BL-113's own design) - a parseable
    // report is the success signal, not exit status.
    ctx.report = JSON.parse(result.stdout);
  });

  // Exact-match KNOWN_VALUES lookup (not a substring/prefix check): the
  // engineering rule requires every Examples value to be LOAD-BEARING, and
  // an `.includes()` against only a trailing fragment of each phrase left
  // the leading words free for gherkin-mutator to mutate undetected (e.g.
  // "that path beNeath the caller's..." still matched a check that only
  // looked for "caller's working directory").
  const RESOLVED_LOCATIONS = {
    "that path beneath the caller's working directory": (ctx) => {
      const dir = ctx.expectedWorkDir;
      if (!fs.existsSync(dir)) {
        throw new Error(`expected the mutation scratch directory to exist at ${dir}, beneath the caller's own cwd`);
      }
      if (fs.readdirSync(dir).length === 0) {
        throw new Error(`expected ${dir} to actually contain mutation scratch, not sit empty`);
      }
    },
    'exactly the path the caller named': (ctx) => {
      if (fs.readdirSync(ctx.expectedWorkDir).length === 0) {
        throw new Error(`expected ${ctx.expectedWorkDir} to contain mutation scratch`);
      }
    },
    'a fresh private temporary directory': () => {
      // No specific path is knowable ahead of time for the omitted case -
      // the property that matters is that it never fell back to the
      // vendor dir, checked structurally by the sibling scenario below.
      const afterStatus = vendorDirGitStatus();
      if (afterStatus !== '') {
        throw new Error(`expected an omitted work-dir to never leave scratch under the vendored tool directory, got: ${afterStatus}`);
      }
    },
  };

  registry.define(/^the mutation scratch is written to (.+)$/, (ctx, resolvedLocation) => {
    const assertLocation = RESOLVED_LOCATIONS[resolvedLocation];
    if (!assertLocation) {
      throw new Error(`unrecognized resolved-location in Examples table: "${resolvedLocation}"`);
    }
    assertLocation(ctx);
    fs.rmSync(ctx.fixtureDir, { recursive: true, force: true });
    if (ctx.callerCwd) fs.rmSync(ctx.callerCwd, { recursive: true, force: true });
    cleanVendorTmpPollution();
  });

  // ── wrapper-resolves-paths-against-caller-02 ────────────────────────────
  registry.define(/^the vendored tool directory is tracked by git$/, (ctx) => {
    cleanVendorTmpPollution();
    ctx.vendorBeforeStatus = vendorDirGitStatus();
  });

  registry.define(/^a mutation run completes with a relative work directory$/, (ctx) => {
    const { dir, featurePath } = copyFixture();
    const callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-wrapper-caller-'));
    try {
      const result = spawnSync('bash', [SCRIPT, featurePath, './tmp/gm-clean-check', STEPS_MODULE, 'soft'], {
        cwd: callerCwd,
        encoding: 'utf8',
      });
      ctx.report = JSON.parse(result.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(callerCwd, { recursive: true, force: true });
    }
  });

  registry.define(/^the vendored tool directory contains no new files$/, (ctx) => {
    const after = vendorDirGitStatus();
    if (after !== ctx.vendorBeforeStatus) {
      throw new Error(
        `expected no new files under swarmforge/vendor/aps after a relative-work-dir run; before=[${ctx.vendorBeforeStatus}] after=[${after}]`
      );
    }
    cleanVendorTmpPollution();
  });
}

module.exports = { registerSteps };
