const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-1245 invariants (declared in the ticket YAML):
// 1. "A role can always reopen its own pending slot: no state of the awaiting
//    marker leaves the asking role with no action available."
// 2. "Reopening never destroys the question - its text, its asked_at_ms, and
//    the reason given remain readable afterwards."
// 3. "A preserved record is never read back as live state: the only question
//    the guard treats as pending is one actually raised and not yet resolved."
//
// Authored by the coder per BL-654. Drives the REAL role_ask.bb CLI via
// execFileSync (never a JS reimplementation). Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const ROLE_ASK = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'role_ask.bb');

function runRoleAsk(root, args) {
  try {
    const result = execFileSync('bb', [ROLE_ASK, root, ...args], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    return { status: 0, output: result.trim() };
  } catch (err) {
    return {
      status: err.status,
      output: `${err.stdout || ''}${err.stderr || ''}`.trim(),
    };
  }
}

function parseJson(output) {
  // The CLI may print multiple lines; the last line is always the JSON report.
  const lines = output.split('\n').filter(Boolean);
  const lastLine = lines[lines.length - 1];
  return JSON.parse(lastLine);
}

function setupFixture(root, role) {
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(path.join(opDir, 'role-awaiting'), { recursive: true });
  fs.mkdirSync(path.join(opDir, 'role-awaiting-archive'), { recursive: true });
  return opDir;
}

function writeMarker(opDir, role, question, askedAtMs) {
  const markerPath = path.join(opDir, 'role-awaiting', `${role}.json`);
  fs.writeFileSync(
    markerPath,
    JSON.stringify({ question, asked_at_ms: askedAtMs })
  );
  return markerPath;
}

function readArchive(opDir, role, askedAtMs) {
  const archivePath = path.join(opDir, 'role-awaiting-archive', `${role}-${askedAtMs}.json`);
  if (!fs.existsSync(archivePath)) return null;
  return JSON.parse(fs.readFileSync(archivePath, 'utf8'));
}

function markerExists(opDir, role) {
  const markerPath = path.join(opDir, 'role-awaiting', `${role}.json`);
  return fs.existsSync(markerPath);
}

// Arbitrary generators
const roleArb = fc.constant('specifier'); // The ticket is about the asking role
const questionArb = fc.string({ minLength: 10, maxLength: 200 });
const askedAtMsArb = fc.integer({ min: 1000000000000, max: 9999999999999 });
const reasonArb = fc.string({ minLength: 5, maxLength: 100 });

test('property invariant 1: a role can always reopen its own pending slot', () => {
  fc.assert(
    fc.property(roleArb, questionArb, askedAtMsArb, reasonArb, (role, question, askedAtMs, reason) => {
      const root = mkTmpDir('bl1245-prop-inv1-');
      const opDir = setupFixture(root, role);
      writeMarker(opDir, role, question, askedAtMs);

      // Resolve with a reason
      const resolveResult = runRoleAsk(root, ['--role', role, '--resolve', '--reason', reason]);
      assert.equal(resolveResult.status, 0, `resolve must exit 0: ${resolveResult.output}`);
      const resolveReport = parseJson(resolveResult.output);
      assert.equal(resolveReport.resolved, true, `resolve must succeed: ${resolveResult.output}`);

      // Invariant 1: the slot is now free (no marker)
      assert.equal(markerExists(opDir, role), false, 'marker must be cleared after resolve');

      // A second ask must be accepted (slot is free)
      const askResult = runRoleAsk(root, ['--role', role, '--question', 'new question']);
      assert.equal(askResult.status, 0, `second ask must exit 0: ${askResult.output}`);
      const askReport = parseJson(askResult.output);
      assert.equal(askReport.asked, true, `second ask must succeed: ${askResult.output}`);
    }),
    { numRuns: 50 }
  );
});

test('property invariant 2: reopening never destroys the question', () => {
  fc.assert(
    fc.property(roleArb, questionArb, askedAtMsArb, reasonArb, (role, question, askedAtMs, reason) => {
      const root = mkTmpDir('bl1245-prop-inv2-');
      const opDir = setupFixture(root, role);
      writeMarker(opDir, role, question, askedAtMs);

      // Resolve with a reason
      const resolveResult = runRoleAsk(root, ['--role', role, '--resolve', '--reason', reason]);
      assert.equal(resolveResult.status, 0, `resolve must exit 0: ${resolveResult.output}`);

      // Invariant 2: the preserved record contains the original question, asked_at_ms, and reason
      const archive = readArchive(opDir, role, askedAtMs);
      assert.notEqual(archive, null, 'archive must exist after resolve');
      assert.equal(archive.question, question, 'archive must preserve the question text');
      assert.equal(archive.asked_at_ms, askedAtMs, 'archive must preserve the asked_at_ms');
      assert.equal(archive.reason, reason, 'archive must preserve the reason');
      assert.ok(archive.resolved_at, 'archive must have resolved_at timestamp');
    }),
    { numRuns: 50 }
  );
});

test('property invariant 3: a preserved record is never read back as live state', () => {
  fc.assert(
    fc.property(roleArb, questionArb, askedAtMsArb, reasonArb, (role, question, askedAtMs, reason) => {
      const root = mkTmpDir('bl1245-prop-inv3-');
      const opDir = setupFixture(root, role);
      writeMarker(opDir, role, question, askedAtMs);

      // Resolve with a reason
      const resolveResult = runRoleAsk(root, ['--role', role, '--resolve', '--reason', reason]);
      assert.equal(resolveResult.status, 0, `resolve must exit 0: ${resolveResult.output}`);

      // Invariant 3: the marker is gone, so a second ask is accepted (not refused as already-pending)
      assert.equal(markerExists(opDir, role), false, 'marker must be cleared after resolve');

      const askResult = runRoleAsk(root, ['--role', role, '--question', 'new question']);
      const askReport = parseJson(askResult.output);
      assert.equal(askReport.asked, true, `second ask must succeed (not already-pending): ${askResult.output}`);
      assert.notEqual(askReport.reason, 'already-pending', 'must not report already-pending after resolve');
    }),
    { numRuns: 50 }
  );
});

// Non-vacuity is demonstrated by the structure of the properties themselves:
// - Invariant 1 asserts markerExists() === false after resolve, which would fail if the marker wasn't cleared
// - Invariant 2 asserts the archive contains the original question/timestamp/reason, which would fail if the archive wasn't written
// - Invariant 3 asserts the second ask succeeds (not already-pending), which would fail if the marker wasn't cleared
// Each property would fail if the corresponding invariant was violated by the implementation.
