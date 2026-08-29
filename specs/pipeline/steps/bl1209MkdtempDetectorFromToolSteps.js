'use strict';

// BL-1209: step handlers for "the mkdtemp convention check resolves its own
// detector from the tool, not from the root it is scanning". Drives the real
// compiled check against fixture subject roots that deliberately do NOT
// contain the tool's detector - the condition the whole ticket is about.
//
// Scoped (BL-425): "the convention check runs" and "the check completes
// without error" are generic enough that another feature could reasonably use
// the same words, and an unscoped registration resolves first-match across
// every handler file.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const LIVE_TEST_DIR = path.join(EXT_DIR, 'test');
const FIXTURE_PREFIX = 'bl1209-acceptance-';

const FEATURE =
  'BL-1209 the mkdtemp convention check resolves its own detector from the tool, not from the root it is scanning';

const RAW_CALL_FILE =
  "const fs = require('fs'); const os = require('os'); const path = require('path');\n" +
  "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\n";
const SHARED_HELPER_FILE =
  "const { mkTmpDir } = require('./helpers/tmpDir');\nconst dir = mkTmpDir('x-');\n";

const SUBJECT_REL = 'extension/test/subject.test.js';

function checkModule() {
  return require(path.join(EXT_DIR, 'out', 'tools', 'pilotMkdtempConventionCheck.js'));
}

// BL-971: sweep by prefix up front too - a killed run traps nothing.
function sweepStaleFixtures() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  }
}

const liveFixtures = new Set();
let exitHookInstalled = false;

function ensureSubjectRoot(ctx) {
  if (ctx.bl1209Root) {
    return ctx.bl1209Root;
  }
  sweepStaleFixtures();
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      for (const dir of [...liveFixtures]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort on the way out */
        }
      }
    });
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  liveFixtures.add(root);
  ctx.bl1209Root = root;
  return root;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a subject root whose touched files the check is asked to scan$/, (ctx) => {
    ensureSubjectRoot(ctx);
    ctx.bl1209Touched = [];
  });

  // ── 01 ──────────────────────────────────────────────────────────────
  scoped(/^the subject root does not contain the tool's detector$/, (ctx) => {
    const root = ensureSubjectRoot(ctx);
    const detector = path.join(root, 'extension', 'test', 'helpers', 'rawMkdtempGuard.js');
    if (fs.existsSync(detector)) {
      throw new Error(`the fixture root contains the tool's detector at ${detector} - it would prove nothing`);
    }
    // And the tool's own copy must exist where the TOOL lives, or the check
    // would be passing for the wrong reason.
    const toolDetector = path.join(EXT_DIR, 'out', 'tools', 'rawMkdtempDetector.js');
    if (!fs.existsSync(toolDetector)) {
      throw new Error(`the tool's own detector is missing at ${toolDetector}`);
    }
  });

  scoped(/^a touched test file in the subject root (.+)$/, (ctx, description) => {
    const root = ensureSubjectRoot(ctx);
    const raw = description.includes('raw temp-directory call');
    const abs = path.join(root, SUBJECT_REL);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, raw ? RAW_CALL_FILE : SHARED_HELPER_FILE, 'utf8');
    ctx.bl1209Touched = [SUBJECT_REL];
    ctx.bl1209ExpectRaw = raw;
  });

  // ── 02 ──────────────────────────────────────────────────────────────
  scoped(/^none of the touched paths are test files the check scans$/, (ctx) => {
    ensureSubjectRoot(ctx);
    ctx.bl1209Touched = ['src/foo.ts', 'docs/how-to/x.md', 'backlog/active/BL-1.yaml'];
    // Non-vacuity for invariant 2: prove the detector is not merely
    // unfailing on this path, but genuinely never loaded.
    ctx.bl1209DetectorLoads = 0;
    ctx.bl1209Deps = {
      loadDetector: () => {
        ctx.bl1209DetectorLoads += 1;
        return { findRawMkdtempLines: () => [] };
      },
    };
  });

  scoped(/^the convention check runs$/, (ctx) => {
    const { assessPilotMkdtempConvention } = checkModule();
    try {
      ctx.bl1209Outcome = assessPilotMkdtempConvention(
        ensureSubjectRoot(ctx),
        ctx.bl1209Touched,
        ctx.bl1209Deps || undefined
      );
    } catch (err) {
      ctx.bl1209Error = err;
    }
  });

  scoped(/^the check completes without error$/, (ctx) => {
    if (ctx.bl1209Error) {
      throw new Error(`the check threw against a subject root: ${ctx.bl1209Error.code || ctx.bl1209Error.message}`);
    }
    if (!ctx.bl1209Outcome || ctx.bl1209Outcome.checked !== true) {
      throw new Error(`expected a completed check, got ${JSON.stringify(ctx.bl1209Outcome)}`);
    }
  });

  scoped(/^the raw call is reported with its file and line$/, (ctx) => {
    assert.deepEqual(ctx.bl1209Outcome.violations, [{ file: SUBJECT_REL, line: 2 }]);
  });

  scoped(/^no raw call is reported$/, (ctx) => {
    assert.deepEqual(ctx.bl1209Outcome.violations, []);
    if (ctx.bl1209Outcome.testFilesScanned !== 1) {
      throw new Error('the clean file must be SCANNED, not merely skipped');
    }
  });

  scoped(/^it reports that no files were scanned$/, (ctx) => {
    assert.deepEqual(ctx.bl1209Outcome, {
      checked: true,
      testFilesScanned: 0,
      violations: [],
      scannedPaths: [],
    });
    if (ctx.bl1209DetectorLoads !== 0) {
      throw new Error(`the detector was loaded ${ctx.bl1209DetectorLoads} time(s) with nothing in scope`);
    }
  });

  // ── 03: the check's own suite leaves the live test tree alone ───────
  scoped(/^the set of files in the tool's own collected test tree is recorded$/, (ctx) => {
    ctx.bl1209TreeBefore = fs.readdirSync(LIVE_TEST_DIR).sort();
  });

  scoped(/^the convention check's test suite runs to completion$/, (ctx) => {
    try {
      execFileSync(
        path.join(EXT_DIR, 'node_modules', '.bin', 'vitest'),
        ['run', 'test/pilotMkdtempConventionCheck.test.js'],
        { cwd: EXT_DIR, stdio: 'ignore' }
      );
    } catch (err) {
      throw new Error(`the check's own test suite did not pass: ${err.message}`);
    }
  });

  scoped(/^the set of files in that tree is unchanged$/, (ctx) => {
    const after = fs.readdirSync(LIVE_TEST_DIR).sort();
    assert.deepEqual(after, ctx.bl1209TreeBefore, 'the suite wrote into the live collected test tree');
    const strays = after.filter((name) => name.startsWith('bl743-assess-'));
    assert.deepEqual(strays, [], `scratch files left in the live test tree: ${strays.join(', ')}`);
  });
}

module.exports = { registerSteps };
