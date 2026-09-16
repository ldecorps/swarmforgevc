'use strict';

// BL-1510 architect-owned property pass (undeclared properties on a touched
// pure module - the ticket's own `invariants:` is empty, so this adds
// coverage rather than encoding a declared one; see the architect prompt's
// Property Testing section, seeded by BL-479/benchmarkAggregate.property.test.js).
//
// parseRoleMatrixLine/buildScoringReportRows are a parser and a filter/join
// over a line format - exactly the "parsing/formatting stability" and
// "conservation/counting" shapes the architect prompt names, and the
// existing example-based unit tests only pin a handful of hand-picked
// lines. These run over a broad generated input range instead. Runs ONLY
// via `npm run test:properties` (vitest.properties.config.mjs) - excluded
// from the normal unit/coverage/mutation run.
//
// Non-vacuity PROVEN at authoring time (2026-09-16), each break applied to
// the compiled output under test, run, and restored:
//   parseRoleMatrixLine's evidence group changed from `(.*)$` to a
//   fixed-width `(\S+)$` ................................ round-trip property FAILS
//   buildScoringReportRows changed to `continue` (drop the
//   row) on a role-matrix line whose model contains a digit ... count property FAILS
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { parseRoleMatrixLine, buildScoringReportRows } = require('../out/tools/render-model-scoring-report');

// No spaces, no slashes - the fields the line format fixes as single tokens.
const token = () => fc.stringMatching(/^[A-Za-z0-9._-]+$/, { minLength: 1, maxLength: 24 });
// Evidence is free text with no newlines (the CLI prints one line per
// steward line) and no leading/trailing whitespace, which the regex's
// trailing `(.*)$` group would otherwise swallow or lose on re-join.
const evidenceText = () =>
  fc
    .stringMatching(/^[A-Za-z0-9._\/ -]+$/, { minLength: 1, maxLength: 40 })
    .filter((s) => s.trim() === s && !s.includes('  '));

test('property: parseRoleMatrixLine round-trips any well-formed line (format(parse(line)) === line)', () => {
  fc.assert(
    fc.property(token(), token(), token(), evidenceText(), (provider, model, score, evidence) => {
      const line = `${provider}/${model} ${score} ${evidence}`;
      const parsed = parseRoleMatrixLine(line);
      assert.ok(parsed, `expected a parse for well-formed line ${JSON.stringify(line)}`);
      assert.equal(parsed.provider, provider);
      assert.equal(parsed.model, model);
      assert.equal(parsed.score, score);
      assert.equal(parsed.evidence, evidence);
      const reformatted = `${parsed.provider}/${parsed.model} ${parsed.score} ${parsed.evidence}`;
      assert.equal(reformatted, line);
    })
  );
});

test('property: parseRoleMatrixLine returns null for a line with no provider/model separator', () => {
  fc.assert(
    fc.property(
      fc.stringMatching(/^[A-Za-z0-9._-]+$/, { minLength: 1, maxLength: 24 }),
      token(),
      evidenceText(),
      (modelOnly, score, evidence) => {
        const line = `${modelOnly} ${score} ${evidence}`;
        assert.equal(parseRoleMatrixLine(line), null, `expected no parse for a line with no "/" separator: ${JSON.stringify(line)}`);
      }
    )
  );
});

test('property: buildScoringReportRows produces exactly one row per parseable line, across any role set', () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ role: token(), provider: token(), model: token(), score: token(), evidence: evidenceText() }), {
        minLength: 0,
        maxLength: 20,
      }),
      (entries) => {
        const byRole = new Map();
        for (const e of entries) {
          const line = `${e.provider}/${e.model} ${e.score} ${e.evidence}`;
          byRole.set(e.role, [...(byRole.get(e.role) ?? []), line]);
        }
        const roles = [...byRole.keys()];
        const rows = buildScoringReportRows({
          roles,
          runRoleMatrix: (role) => byRole.get(role) ?? [],
          readRegistry: () => [],
        });
        assert.equal(rows.length, entries.length, 'expected exactly one row per well-formed input line');
      }
    )
  );
});

test('property: buildScoringReportRows silently drops any line parseRoleMatrixLine rejects (never throws, never fabricates a row)', () => {
  fc.assert(
    fc.property(fc.array(fc.string({ minLength: 0, maxLength: 30 }), { minLength: 0, maxLength: 15 }), (garbageLines) => {
      const rows = buildScoringReportRows({
        roles: ['coder'],
        runRoleMatrix: () => garbageLines,
        readRegistry: () => [],
      });
      const expected = garbageLines.filter((l) => parseRoleMatrixLine(l) !== null).length;
      assert.equal(rows.length, expected);
    })
  );
});
