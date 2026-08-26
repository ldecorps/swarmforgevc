'use strict';

// BL-872: step handlers for "swarmforge/scripts temp-root creators stay
// guarded". Scenarios 01/02 drive the REAL regression guard
// (specs/pipeline/steps/lib/tempDirTrapGuard.js) - the same module now also
// wired into extension/test/tempDirTrapGuard.test.js as the standing gate,
// never a reimplementation here. Scenario 03 drives two of the ACTUAL 18
// files this ticket remediated (not a purpose-built demo harness - BL-459's
// own scenario 01 already proves the underlying trap/shutdown-hook
// mechanisms fail-safe via demo harnesses; this proves the WIRING was
// actually applied correctly to real files).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scanForTempDirTrapViolations } = require('./lib/tempDirTrapGuard');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_HARNESSES = {
  shell: () => spawnSync('bash', [path.join(SCRIPTS_DIR, 'test', 'test_github_intake_write.sh')], { encoding: 'utf8' }),
  babashka: () => spawnSync('bb', [path.join(SCRIPTS_DIR, 'test', 'bridge_supervisor_env_test_runner.bb')], { encoding: 'utf8' }),
};

const KNOWN_FILE_KINDS = {
  shell: {
    basename: 'bl872_fixture_offender.sh',
    unguardedText: 'set -euo pipefail\nd="$(mktemp -d)"\n',
    guardedText: 'set -euo pipefail\ntrap \'rm -rf "$d"\' EXIT\nd="$(mktemp -d)"\n',
  },
  babashka: {
    basename: 'bl872_fixture_offender.bb',
    unguardedText: '(def d (str (fs/create-temp-dir {:prefix "bl872-fixture-"})))\n',
    guardedText: [
      '(def created-temp-dirs (atom []))',
      '(.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (doseq [d @created-temp-dirs] (fs/delete-tree d)))))',
      '(def d (let [dd (str (fs/create-temp-dir {:prefix "bl872-fixture-"}))] (swap! created-temp-dirs conj dd) dd))',
    ].join('\n') + '\n',
  },
};

function registerSteps(registry) {
  // ── tempdir-trap-guard-standing-01 ──────────────────────────────────────
  registry.define(/^the scanned tree is the real swarmforge\/scripts tree$/, (ctx) => {
    ctx.scannedTree = SCRIPTS_DIR;
  });

  // Shared by scenarios 01 and 02 - the Given step sets ctx.scannedTree.
  registry.define(/^the temp-dir cleanup guard scans that tree$/, (ctx) => {
    ctx.violations = scanForTempDirTrapViolations(ctx.scannedTree);
  });

  registry.define(/^it reports zero violations$/, (ctx) => {
    if (ctx.violations.length > 0) {
      throw new Error(`expected zero violations, found:\n${ctx.violations.map((v) => `${v.file}: ${v.reason}`).join('\n')}`);
    }
  });

  // ── tempdir-trap-guard-standing-02 (Scenario Outline) ───────────────────
  registry.define(/^a scanned tree containing a "([^"]+)" file that creates a temp root with no cleanup mechanism$/, (ctx, fileKind) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_FILE_KINDS, fileKind)) {
      throw new Error(`tempdir-trap-guard-standing-02: unrecognized <file_kind> example value "${fileKind}"`);
    }
    const kind = KNOWN_FILE_KINDS[fileKind];
    ctx.fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl872-fixture-tree-'));
    ctx.fixtureFile = path.join(ctx.fixtureRoot, kind.basename);
    ctx.fixtureKind = kind;
    fs.writeFileSync(ctx.fixtureFile, kind.unguardedText);
    ctx.scannedTree = ctx.fixtureRoot;
  });

  registry.define(/^it names that file as a violation$/, (ctx) => {
    const flagged = ctx.violations.map((v) => v.file);
    if (!flagged.includes(ctx.fixtureFile)) {
      throw new Error(`expected ${ctx.fixtureFile} to be named as a violation, got:\n${flagged.join('\n')}`);
    }
  });

  registry.define(/^it reports zero violations once that file gains a cleanup mechanism$/, (ctx) => {
    fs.writeFileSync(ctx.fixtureFile, ctx.fixtureKind.guardedText);
    const violations = scanForTempDirTrapViolations(ctx.scannedTree);
    fs.rmSync(ctx.fixtureRoot, { recursive: true, force: true });
    if (violations.length > 0) {
      throw new Error(`expected zero violations after remediation, found:\n${violations.map((v) => `${v.file}: ${v.reason}`).join('\n')}`);
    }
  });

  // ── tempdir-trap-guard-standing-03 (Scenario Outline) ───────────────────
  registry.define(/^a remediated "([^"]+)" harness under swarmforge\/scripts$/, (ctx, harnessKind) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_HARNESSES, harnessKind)) {
      throw new Error(`tempdir-trap-guard-standing-03: unrecognized <harness_kind> example value "${harnessKind}"`);
    }
    ctx.harnessKind = harnessKind;
    ctx.tmpBefore = new Set(fs.readdirSync(os.tmpdir()));
  });

  registry.define(/^it runs to completion$/, (ctx) => {
    // The harness's OWN pass/fail is irrelevant here, per the ticket's own
    // constraint ("run its chosen harness with the harness's own pass/fail
    // treated as irrelevant") - only residue is asserted below, so the
    // result's exit code/stderr are deliberately never inspected.
    KNOWN_HARNESSES[ctx.harnessKind]();
    ctx.tmpAfter = new Set(fs.readdirSync(os.tmpdir()));
  });

  registry.define(/^no temp root it created remains, whatever its exit status$/, (ctx) => {
    const newEntries = [...ctx.tmpAfter].filter((name) => !ctx.tmpBefore.has(name));
    if (newEntries.length > 0) {
      throw new Error(`expected no new entries under ${os.tmpdir()} after the ${ctx.harnessKind} harness ran, found: ${newEntries.join(', ')}`);
    }
  });
}

module.exports = { registerSteps };
