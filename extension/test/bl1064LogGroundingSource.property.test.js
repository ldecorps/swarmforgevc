'use strict';

// BL-1064 property test (coder-authored, one DECLARED invariant).
//
//   Invariant: "Every row whose log literal is written somewhere other than
//   its launcher declares that writer explicitly; the grounding check never
//   falls back to a source that cannot contain the literal."
//
// The invariant has two halves and they need different evidence. The first is
// a claim about the REAL table: no row may depend on a launcher-derived
// source that cannot account for its literals. That half is enumerated over
// the committed rows, because the table is the population - there is nothing
// to sample. The second is a claim about the CHECKER: given a row of any
// shape, it must reach the right verdict and, when it fails, say which of the
// two failures it is. That half is generated.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// The shape that actually caused this defect is a MIXED row - several
// literals, of which the launcher accounts for some but not all. The Front
// Desk row names two logs and its launcher writes exactly one, so the check
// found one grounded literal and one it could never ground. Drawing each
// literal's home independently makes that mixed shape rare: with two literals
// it needs one hit and one miss, and with three it gets rarer still, so a
// uniform generator spends most of its runs on all-grounded or all-missing
// rows where the distinction under test does not arise. Mixed rows are
// therefore CONSTRUCTED - the row is built by choosing how many of its
// literals the launcher gets, so every mixed draw is one by construction -
// and their reach is floored.
//
// Non-vacuity PROVEN at authoring time (2026-08-22), each break restored:
//   - drop the 'Front Desk' override .......................... P1
//   - report a derived failure with the declared message ...... P3
//   - ground on the full literal instead of the basename ...... P2

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseReferenceTable,
  checkLogGrounding,
  logVerificationSources,
  logSourcesAreDeclared,
  extractBacktickSpans,
} = require('../../specs/pipeline/steps/bl643NonPipelineAgentsSteps');

// ── Half one: the real table, enumerated. ─────────────────────────────────

test('property (invariant): no real row relies on a launcher-derived source that cannot ground its literals', () => {
  const { rows } = parseReferenceTable();
  assert.ok(rows.length > 0, 'the reference table parsed to no rows at all');

  let checked = 0;
  for (const row of rows) {
    const spans = extractBacktickSpans(row['Log location']).filter((s) => s.startsWith('.') || s.includes('/'));
    if (spans.length === 0 || row.Agent === 'Expeditor') continue;
    const sources = logVerificationSources(row);
    if (!sources || sources.length === 0) continue;
    checked += 1;

    const combined = sources.map((s) => fs.readFileSync(s, 'utf8')).join('\n');
    const missing = spans.filter((span) => !combined.includes(span.replace(/\/$/, '').split('/').pop()));

    // The invariant, stated directly: a literal its sources cannot account
    // for is only ever acceptable if... it never is. And if the sources were
    // merely DERIVED, the row owed an explicit declaration.
    assert.deepEqual(missing, [],
      `row "${row.Agent}" has log literal(s) its ${logSourcesAreDeclared(row) ? 'declared' : 'launcher-derived'} ` +
      `source(s) cannot contain: ${missing.join(', ')}`);
  }
  assert.ok(checked >= 4,
    `only ${checked} row(s) were actually checked - the enumeration is covering far less than the table holds`);
});

test('property (invariant): every row whose log is written outside its launcher declares that writer', () => {
  const { rows } = parseReferenceTable();
  let declaredRows = 0;
  for (const row of rows) {
    const spans = extractBacktickSpans(row['Log location']).filter((s) => s.startsWith('.') || s.includes('/'));
    if (spans.length === 0 || row.Agent === 'Expeditor') continue;
    if (!logSourcesAreDeclared(row)) continue;
    declaredRows += 1;
    const sources = logVerificationSources(row);
    assert.ok(sources && sources.length > 0, `row "${row.Agent}" declares an override that names no source`);
    for (const src of sources) {
      assert.ok(fs.existsSync(src), `row "${row.Agent}" declares a source that does not exist: ${src}`);
    }
  }
  // Front Desk brought this to four; a floor below that means an override was
  // deleted and this test stopped watching anything.
  assert.ok(declaredRows >= 4,
    `only ${declaredRows} row(s) declare a log-writer override - expected at least 4 (Babysitter, Support, Model Steward, Front Desk)`);
});

// ── Half two: the checker, generated. ─────────────────────────────────────

// Builds a row on disk: `launcherHits` of its literals appear in the launcher,
// the rest appear only in a separate writer file. `declared` decides whether
// the row's sources name that writer.
function buildRow(root, { id, literals, launcherHits, declared }) {
  const dir = path.join(root, `row-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const launcher = path.join(dir, 'launcher.sh');
  const writer = path.join(dir, 'writer.ts');
  const inLauncher = literals.slice(0, launcherHits);
  const inWriter = literals.slice(launcherHits);
  fs.writeFileSync(launcher, `#!/usr/bin/env bash\n${inLauncher.map((l) => `LOG="$D/${l}"`).join('\n')}\n`);
  fs.writeFileSync(writer, inWriter.map((l) => `const sink = \`\${d}/${l}\`;`).join('\n') + '\n');
  return {
    row: {
      Agent: `Fixture Row ${id}`,
      Launcher: `[\`launcher.sh\`](${launcher})`,
      'Stop path': '— none —',
      'Role prompt': '— none —',
      'Log location': literals.map((l) => `\`.swarmforge/operator/${l}\``).join(' + '),
    },
    sources: declared ? [launcher, writer] : null,
    fullyGrounded: launcherHits === literals.length,
  };
}

test('property: the checker grounds a row exactly when its sources can account for every literal', () => {
  const root = mkTmpDir('bl1064-grounding-');
  const seen = { mixed: 0, allGrounded: 0, noneGrounded: 0, declared: 0, derived: 0 };
  let id = 0;

  fc.assert(
    fc.property(
      // Constructed, not drawn independently: `count` literals of which
      // `hits` are in the launcher. The mixed shape - the one that produced
      // this defect - is reachable on purpose rather than by coincidence.
      fc.integer({ min: 1, max: 3 }).chain((count) =>
        fc.record({
          count: fc.constant(count),
          hits: fc.integer({ min: 0, max: count }),
          declared: fc.boolean(),
        })
      ),
      ({ count, hits, declared }) => {
        id += 1;
        const literals = Array.from({ length: count }, (_, i) => `fixture-${id}-${i}.log`);
        const built = buildRow(root, { id, literals, launcherHits: hits, declared });

        if (hits === count) seen.allGrounded += 1;
        else if (hits === 0) seen.noneGrounded += 1;
        else seen.mixed += 1;
        seen[declared ? 'declared' : 'derived'] += 1;

        // A declared row names the writer too, so every literal grounds.
        // A derived row grounds only when the launcher holds all of them.
        const shouldPass = declared || hits === count;
        if (shouldPass) {
          assert.doesNotThrow(
            () => checkLogGroundingWith(built),
            `row with ${hits}/${count} literals in its launcher and declared=${declared} should have grounded`
          );
        } else {
          assert.throws(
            () => checkLogGroundingWith(built),
            /log literal\(s\) not found/,
            `row with ${hits}/${count} literals in its launcher and no declaration should have failed`
          );
        }
      }
    ),
    { numRuns: 120 }
  );

  for (const [k, floor] of Object.entries({ mixed: 12, allGrounded: 12, noneGrounded: 12, declared: 40, derived: 40 })) {
    assert.ok(seen[k] >= floor, `the generator reached ${k} only ${seen[k]} time(s), floor ${floor}`);
  }
});

test('property: a derived failure says it was derived, and a declared failure does not', () => {
  const root = mkTmpDir('bl1064-message-');
  let derivedFailures = 0;
  let declaredFailures = 0;
  let id = 1000;

  fc.assert(
    fc.property(fc.integer({ min: 1, max: 3 }), fc.boolean(), (count, declaredButWrong) => {
      id += 1;
      const literals = Array.from({ length: count }, (_, i) => `msg-${id}-${i}.log`);
      // Nothing in the launcher, so the row always fails - the question under
      // test is only WHICH failure it reports.
      const built = buildRow(root, { id, literals, launcherHits: 0, declared: false });
      if (declaredButWrong) {
        // A declared source that genuinely cannot contain the literal: real
        // drift, and it must NOT be reported as a missing declaration.
        built.sources = [path.join(root, `row-${id}`, 'launcher.sh')];
      }
      let message = '';
      try {
        checkLogGroundingWith(built);
        assert.fail('the fixture row should not have grounded');
      } catch (e) {
        message = e.message;
      }
      assert.match(message, /log literal\(s\) not found/, 'both failures must name the literals');
      assert.match(message, /Fixture Row/, 'both failures must name the row');
      if (declaredButWrong) {
        declaredFailures += 1;
        assert.doesNotMatch(message, /DERIVED from the Launcher column/,
          'drift against a declared source must not be reported as a missing declaration');
      } else {
        derivedFailures += 1;
        assert.match(message, /DERIVED from the Launcher column/,
          'a launcher-derived failure must say so, or the reader goes and edits correct prose');
        assert.match(message, /do not delete the claim from the table/);
      }
    }),
    { numRuns: 80 }
  );

  assert.ok(derivedFailures >= 20, `derived-failure reach was ${derivedFailures}`);
  assert.ok(declaredFailures >= 20, `declared-failure reach was ${declaredFailures}`);
});

// Runs the REAL checker against a synthesized row. checkLogGrounding resolves
// a row's sources through the module's own override map, which a fixture row
// is not in, so the declared case is exercised by temporarily registering the
// fixture's own sources - the same code path a real declared row takes.
function checkLogGroundingWith(built) {
  const { LOG_VERIFICATION_SOURCE_OVERRIDES } = require('../../specs/pipeline/steps/bl643NonPipelineAgentsSteps');
  if (built.sources === null) {
    delete LOG_VERIFICATION_SOURCE_OVERRIDES[built.row.Agent];
  } else {
    LOG_VERIFICATION_SOURCE_OVERRIDES[built.row.Agent] = built.sources;
  }
  try {
    return checkLogGrounding(built.row);
  } finally {
    delete LOG_VERIFICATION_SOURCE_OVERRIDES[built.row.Agent];
  }
}
