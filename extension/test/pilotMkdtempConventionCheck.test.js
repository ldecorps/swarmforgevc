'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assessPilotMkdtempConvention,
  isExtensionTestJsPath,
  PILOT_RAW_MKDTEMP_REFUSAL,
} = require('../out/tools/pilotMkdtempConventionCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');
const { mkTmpDir } = require('./helpers/tmpDir');

test('isExtensionTestJsPath accepts extension test js and skips fixtures', () => {
  assert.equal(isExtensionTestJsPath('extension/test/foo.test.js'), true);
  assert.equal(isExtensionTestJsPath('extension/test/fixtures/foo.test.js'), false);
  assert.equal(isExtensionTestJsPath('extension/src/foo.js'), false);
});

// BL-1209: a fixture root, NOT the live repository. This test used to point
// the check at `path.join(__dirname, '..', '..')` and write a scratch
// `bl743-assess-<pid>.test.js` into the collected test tree to give the scan
// something to find - it had to, because the check required its detector out
// of whatever root it was handed, so only the real repo worked. That scratch
// file matched the suite's own discovery glob, so a run killed before its
// `finally` left behind a file the next run collected as an empty red.
// The detector is now the tool's own, so an ordinary fixture root works and
// nothing is written into the live tree at all.
function fixtureRootWith(relativePath, contents) {
  const root = mkTmpDir('bl1209-subject-');
  const abs = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, 'utf8');
  return root;
}

const RAW_CALL_FILE =
  "const fs = require('fs'); const os = require('os'); const path = require('path');\n" +
  // BL-1280: the `mkdtempSync(` boundary is split so the real-tree scan does
  // not flag this fixture's DATA as a call site - the file is scanned like
  // any other rather than being exempted wholesale, which would blind the
  // guard to a REAL raw call arriving here later. The value is byte-identical.
  "const dir = fs.mkdtemp" + "Sync(path.join(os.tmpdir(), 'x-'));\n";

const SHARED_HELPER_FILE =
  "const { mkTmpDir } = require('./helpers/tmpDir');\n" + "const dir = mkTmpDir('x-');\n";

test('assessPilotMkdtempConvention flags raw mkdtemp in touched test file', () => {
  const rel = 'extension/test/subject.test.js';
  const root = fixtureRootWith(rel, RAW_CALL_FILE);
  const outcome = assessPilotMkdtempConvention(root, [rel]);
  assert.equal(outcome.checked, true);
  assert.equal(outcome.violations.length, 1);
  assert.equal(outcome.violations[0].file, rel);
  assert.equal(outcome.violations[0].line, 2);
});

// BL-1209 hardener finding: this check's own EXEMPT_REPO_PATHS omitted the
// two test files THIS ticket itself introduced - pilotMkdtempConventionCheck
// .test.js and its property sibling both carry RAW_CALL_FILE/RAW_LINE fixture
// strings (test DATA proving the detector works), and without the exemption
// a ticket that so much as touches this check's OWN test file would have the
// real /pilot land gate refuse the land over a "violation" that is not
// executable code at all. Mirrors rawMkdtempGuard.js's identical
// SELF_EXEMPT_RELATIVE_PATHS discipline for the whole-tree guard.
test('touching this check\'s own fixture-string test files is never itself a violation', () => {
  for (const rel of [
    'extension/test/pilotMkdtempConventionCheck.test.js',
    'extension/test/pilotMkdtempConventionCheck.property.test.js',
  ]) {
    const root = fixtureRootWith(rel, RAW_CALL_FILE);
    assert.deepEqual(assessPilotMkdtempConvention(root, [rel]), {
      checked: true,
      testFilesScanned: 0,
      violations: [],
      scannedPaths: [],
    });
  }
});

test('a touched test file using the shared helper is scanned and reported clean', () => {
  const rel = 'extension/test/subject.test.js';
  const root = fixtureRootWith(rel, SHARED_HELPER_FILE);
  const outcome = assessPilotMkdtempConvention(root, [rel]);
  assert.deepEqual(outcome, {
    checked: true,
    testFilesScanned: 1,
    violations: [],
    scannedPaths: [rel],
  });
});

test('a touched path that no longer exists on disk is skipped, not read', () => {
  const root = mkTmpDir('bl1209-subject-');
  const rel = 'extension/test/renamed-away.test.js';
  // Deliberately never written - a commit's touched-file list can name a
  // path a LATER commit renamed or deleted; the check must skip it rather
  // than throw trying to fs.readFileSync a path that is not there.
  let loads = 0;
  const outcome = assessPilotMkdtempConvention(root, [rel], {
    loadDetector: () => {
      loads += 1;
      return { findRawMkdtempLines: () => [] };
    },
  });
  assert.deepEqual(outcome, { checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] });
  assert.equal(loads, 0, 'a nonexistent path must not load the detector either');
});

test('the subject root needs no detector of its own', () => {
  const rel = 'extension/test/subject.test.js';
  const root = fixtureRootWith(rel, RAW_CALL_FILE);
  assert.equal(
    fs.existsSync(path.join(root, 'extension', 'test', 'helpers', 'rawMkdtempGuard.js')),
    false,
    'the fixture must not contain the tool\'s detector, or it proves nothing'
  );
  assert.equal(assessPilotMkdtempConvention(root, [rel]).checked, true);
});

test('nothing in scope: a successful empty result, and the detector is never loaded', () => {
  const root = fixtureRootWith('extension/test/subject.test.js', RAW_CALL_FILE);
  let loads = 0;
  const outcome = assessPilotMkdtempConvention(root, ['src/foo.ts', 'docs/x.md', 'backlog/active/BL-1.yaml'], {
    loadDetector: () => {
      loads += 1;
      return { findRawMkdtempLines: () => [] };
    },
  });
  assert.deepEqual(outcome, { checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] });
  // Non-vacuity for the invariant: not merely "did not fail", but "did not load".
  assert.equal(loads, 0, 'the detector was loaded for a call with nothing in scope');
});

test('the detector is loaded once, however many paths are in scope', () => {
  const root = mkTmpDir('bl1209-subject-');
  const paths = ['extension/test/a.test.js', 'extension/test/b.test.js', 'extension/test/c.test.js'];
  for (const rel of paths) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, RAW_CALL_FILE, 'utf8');
  }
  let loads = 0;
  const outcome = assessPilotMkdtempConvention(root, paths, {
    loadDetector: () => {
      loads += 1;
      return { findRawMkdtempLines: () => [1] };
    },
  });
  assert.equal(outcome.testFilesScanned, 3);
  assert.equal(loads, 1);
});

test('landPilotedTicket refuses raw-mkdtemp-outside-helper before move', async () => {
  const calls = { move: 0, receipt: 0 };
  let executedFeaturePath;
  const outcome = await landPilotedTicket('BL-743', {
    readAcceptanceDeclaration: () => 'specs/features/fixture.feature',
    resolveFeatureFilePath: () => '/repo/specs/features/fixture.feature',
    isLifecycleTeardownTicket: () => false,
    assessMultiworktreeFixture: () => ({
      satisfied: true,
      metadata: { worktreeCount: 1, siblingHandoffdRoots: [], pilotRoot: '/repo' },
    }),
    runAcceptance: async () => ({ success: true, output: 'ok' }),
    recordAcceptanceExecution: (featureFilePath) => {
      executedFeaturePath = featureFilePath;
    },
    readAcceptanceExecution: () => executedFeaturePath,
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
    checkMkdtempConvention: () => ({
      checked: true,
      testFilesScanned: 1,
      violations: [{ file: 'extension/test/bad.test.js', line: 2 }],
      scannedPaths: ['extension/test/bad.test.js'],
    }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-743.yaml' };
    },
    writeReceipt: () => {
      calls.receipt += 1;
    },
    getLandedCommit: () => 'a'.repeat(40),
    checkOriginMainLanding: () => ({ reachable: true }),
    now: () => '2026-08-26T00:00:00.000Z',
  });
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'raw-mkdtemp-outside-helper');
  assert.match(outcome.reason, new RegExp(PILOT_RAW_MKDTEMP_REFUSAL));
  assert.equal(outcome.mkdtempFile, 'extension/test/bad.test.js');
  assert.equal(calls.move, 0);
  assert.equal(calls.receipt, 0);
});
