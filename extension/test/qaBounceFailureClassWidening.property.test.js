const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { isKnownFailureClass, computeQaBounceTally, KNOWN_FAILURE_CLASSES } = require('../out/quality/qaBounce');
const { appendBounceRecordIfNew, readBounceRecords, bouncesDir } = require('../out/metrics/bounceStore');
const { qaBouncesDir } = require('../out/metrics/qaBounceStore');
const { parseArgs } = require('../out/tools/recordBounceArgs');
const { main } = require('../out/tools/record-bounce');

// BL-688: coder-authored property tests for this ticket's two declared
// invariants (coder.prompt's Invariants section - first authorship rests
// with the coder). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from the unit/coverage/mutation
// run per engineering.prompt's property-test separation rule.
//
// Non-vacuity, checked by hand before landing (both properties below):
//   - Invariant 1: renaming 'compile' to 'compiled' in KNOWN_FAILURE_CLASSES
//     (simulating the exact regression this invariant guards - dropping/
//     renaming one of the five pre-existing members instead of purely
//     appending) reproduced the failure the property is built to catch -
//     every generated 'compile' record silently vanished from
//     readBounceRecords - and restoring the original spelling made it pass
//     again.
//   - Invariant 2: making `isKnownFailureClass` lowercase its input before
//     the closed-set check (a plausible "make it more lenient" mistake)
//     exposed a real vacuity bug IN THIS PROPERTY, not just in the
//     production code: `unknownClassArb` originally filtered candidates via
//     `isKnownFailureClass` itself, so once that predicate turned lenient it
//     ALSO silently stopped generating the case-variant inputs that should
//     have exposed it (the property still reported green). Fixed by
//     filtering against `KNOWN_SET` (plain, case-sensitive Set membership on
//     the literal array) instead - an independent ground truth the mutation
//     cannot influence. Re-run against the same lowercase-then-compare
//     mutation after that fix, the property correctly failed
//     (counterexample "Compile"), and reverting the mutation made it pass
//     again.

const ORIGINAL_FIVE_CLASSES = ['compile', 'unit', 'integration', 'acceptance', 'behavior'];
const WIDENED_CLASSES = ['invariant-unencoded', 'spec-gap'];

const oldClassArb = fc.constantFrom(...ORIGINAL_FIVE_CLASSES);
const newClassArb = fc.constantFrom(...WIDENED_CLASSES);
const roleArb = fc.constantFrom('coder', 'cleaner', 'architect', 'hardender', 'documenter');
const typeArb = fc.constantFrom('feature', 'bug', 'defect', 'chore', 'docs', 'enhancement', 'epic');
const byArb = fc.constantFrom('specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA');
const commitArb = fc.stringMatching(/^[0-9a-f]{10}$/);
const ticketArb = fc.integer({ min: 1, max: 999 }).map((n) => `BL-${n}`);
const dayArb = fc.constantFrom('2026-07-01', '2026-07-15', '2026-07-26');

function recordArbOf(classArb) {
  return fc
    .record({
      ticket: ticketArb,
      producingRole: roleArb,
      ticketType: typeArb,
      failureClass: classArb,
      commit: commitArb,
      by: byArb,
      day: dayArb,
    })
    .map(({ day, ...rest }) => ({ ...rest, at: `${day}T09:00:00.000Z` }));
}

const oldRecordArb = recordArbOf(oldClassArb);
const newRecordArb = recordArbOf(newClassArb);

// ── Invariant 1: "the widening is additive only" ────────────────────────
// Concrete risk this guards: an "additive" enum change could regress by
// accidentally reordering/renaming/dropping one of the FIVE PRE-EXISTING
// members instead of purely appending two new ones. That failure mode is
// invisible at the type level and invisible at runtime too - qaBounceStore's
// "malformed/unrecognized line is skipped, never a crash" reader posture
// means an old record using a no-longer-recognized class just vanishes from
// every read and tally, with no error anywhere.

test('property: every one of the five pre-existing classes is still known - the widening never silently drops or renames an original member', () => {
  fc.assert(
    fc.property(oldClassArb, (cls) => {
      assert.equal(isKnownFailureClass(cls), true, `pre-existing class ${cls} must still be known after widening`);
    })
  );
});

test('property: a pre-existing-class record survives readBounceRecords byte-faithfully, regardless of whatever widened-class records sit alongside it in the same store', () => {
  fc.assert(
    fc.property(
      fc.array(oldRecordArb, { minLength: 1, maxLength: 4 }),
      fc.array(newRecordArb, { minLength: 0, maxLength: 4 }),
      (oldRecords, newRecords) => {
        const root = mkTmpDir('sfvc-bl688-additive-');
        const dir = bouncesDir(root);
        fs.mkdirSync(dir, { recursive: true });
        // Simulates a store upgraded in place: pre-existing (old-class) JSONL
        // lines sitting alongside freshly-recorded (new-class) ones in the
        // very same month file.
        const allLines = [...oldRecords, ...newRecords].map((r) => JSON.stringify(r)).join('\n') + '\n';
        fs.writeFileSync(path.join(dir, '2026-07.jsonl'), allLines);

        const readBack = readBounceRecords(root);
        for (const old of oldRecords) {
          assert.ok(
            readBack.some((r) => JSON.stringify(r) === JSON.stringify(old)),
            `pre-existing record dropped or altered by the widening: ${JSON.stringify(old)}`
          );
        }
        assert.equal(
          readBack.length,
          oldRecords.length + newRecords.length,
          'expected every record (old- and new-class alike) to be read back, none silently skipped'
        );
      }
    )
  );
});

test('property: the tally over pre-existing-class records never regresses when widened-class records are mixed into the same read', () => {
  fc.assert(
    fc.property(
      fc.array(oldRecordArb, { minLength: 1, maxLength: 6 }),
      fc.array(newRecordArb, { minLength: 0, maxLength: 6 }),
      (oldRecords, newRecords) => {
        const isolated = computeQaBounceTally(oldRecords);
        const mixed = computeQaBounceTally([...oldRecords, ...newRecords]);
        for (const { role, count } of isolated.byRole) {
          const mixedEntry = mixed.byRole.find((r) => r.role === role);
          assert.ok(mixedEntry && mixedEntry.count >= count, `pre-existing role count for ${role} regressed once widened-class records were mixed in`);
        }
        for (const [type, count] of Object.entries(isolated.byTicketType)) {
          assert.ok((mixed.byTicketType[type] ?? 0) >= count, `pre-existing ticketType count for ${type} regressed once widened-class records were mixed in`);
        }
      }
    )
  );
});

// ── Invariant 2: "the vocabulary stays CLOSED" ───────────────────────────
// Any class outside the widened set - INCLUDING a case variant of a valid
// one - is still a usage error that writes nothing to either durable store.

const knownClassArb = fc.constantFrom(...KNOWN_FAILURE_CLASSES);
// Independent of isKnownFailureClass (the function under test) on purpose:
// filtering candidates through the SUT's own predicate would make the
// generator's reachability depend on that predicate being correct, so a
// regression that makes it wrongly lenient (e.g. case-insensitive) would
// silently stop generating the very case-variant inputs that should expose
// it - exactly the vacuity trap this filter must not fall into. Plain exact
// (case-sensitive) Set membership against the literal known-values array is
// the independent ground truth instead.
const KNOWN_SET = new Set(KNOWN_FAILURE_CLASSES);

// Deliberately includes case variants of every known class (the exact edge
// case invariant 2 names by name: "including a case variant of a valid
// one") alongside arbitrary unrelated strings - both must be rejected.
const unknownClassArb = fc
  .oneof(
    knownClassArb.map((c) => c.toUpperCase()),
    knownClassArb.map((c) => c[0].toUpperCase() + c.slice(1)),
    fc.stringMatching(/^[a-z-]{1,24}$/)
  )
  .filter((c) => !KNOWN_SET.has(c));

function flagArgs(cls) {
  return ['--ticket', 'BL-1', '--role', 'coder', '--type', 'defect', '--class', cls, '--commit', 'abc1234567', '--by', 'architect'];
}

test('property: parseArgs rejects every class outside the closed set, including a case variant of a valid one', () => {
  fc.assert(
    fc.property(unknownClassArb, (cls) => {
      assert.equal(parseArgs(flagArgs(cls)), null, `expected an unknown/case-variant class "${cls}" to be rejected`);
    })
  );
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkRepo() {
  const root = mkTmpDir('sfvc-bl688-closed-');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed roles.tsv']);
  return root;
}

async function runCli(root, args) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const stdoutWrites = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    stdoutWrites.push(chunk);
    return true;
  };
  // The rejected-class path this property always exercises prints its usage
  // to stderr - swallow it here (captured, not discarded silently: nothing
  // in this test asserts on it, so there is nothing useful to inspect) to
  // keep the property's own console output readable across dozens of runs.
  process.stderr.write = () => true;
  try {
    process.exitCode = undefined;
    process.cwd = () => root;
    process.argv = ['node', 'record-bounce.js', ...args];
    await main();
    return { stdout: stdoutWrites.join(''), exitCode: process.exitCode };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.cwd = originalCwd;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('property: an invocation with a class outside the closed set writes to NEITHER durable store, real fs and CLI wiring included', async () => {
  await fc.assert(
    fc.asyncProperty(unknownClassArb, async (cls) => {
      const root = mkRepo();
      const before = appendBounceRecordIfNew(root, {
        ticket: 'BL-9999999',
        producingRole: 'coder',
        ticketType: 'defect',
        failureClass: 'behavior',
        commit: 'seedseed01',
        at: '2026-07-01T00:00:00.000Z',
      });
      assert.equal(before, true, 'fixture seed write must itself succeed');

      const result = await runCli(root, flagArgs(cls));
      assert.equal(result.stdout, '', 'expected no stdout (no {recorded} JSON) for a rejected class');
      assert.equal(result.exitCode, 1, 'expected a non-zero exit for a rejected class');

      // The rejected call must not have touched EITHER store - specifically,
      // it must not have appended a second record next to the seed above.
      const records = readBounceRecords(root);
      assert.equal(records.length, 1, `expected the rejected call to write nothing; store now holds ${JSON.stringify(records)}`);
      assert.equal(fs.existsSync(qaBouncesDir(root)), false, 'the legacy qa_bounces dir must never be created by this CLI');
    }),
    { numRuns: 25 }
  );
});
