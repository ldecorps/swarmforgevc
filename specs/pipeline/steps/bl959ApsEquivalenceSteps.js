'use strict';

// BL-959: step handlers for "APS candidate toolchain equivalence verdict".
// Drives the REAL comparator CLI (aps_equivalence_cli.bb, backed by the pure
// aps_equivalence_lib.bb) over a fixture work dir holding a pinned-run and a
// candidate-run result set. Fail-closed is the contract under test: absence
// of a result is never read as equivalence. Fixture dirs are tracked and
// removed in afterEach, never leaked (the 2026-08-18 fixture-leak lesson).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EQUIVALENCE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'aps_equivalence_cli.bb');

const FEATURE_NAME = 'BL-959 APS candidate toolchain equivalence verdict';

// Scenario Outline cells validated against explicit KNOWN_VALUES
// (engineering article's Scenario Outline rule) - a mutated cell fails
// loudly here, never silently passes through.
const KNOWN_CANDIDATE_OUTCOMES = new Map([
  ['a differing outcome', 'divergent'],
  ['no recorded outcome', 'missing'],
]);
const KNOWN_VERDICTS = new Set(['EQUIVALENT', 'DIVERGENT', 'INCOMPLETE']);

const CORPUS = ['specs/features/alpha.feature', 'specs/features/beta.feature', 'specs/features/gamma.feature'];
const GATES = ['lint-parse', 'ir-dry'];

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function slug(entry) {
  // Mirrors nothing: filenames only need to be stable fixture keys here -
  // the CLI reads the authoritative entry from INSIDE each json file.
  return entry.replace(/\//g, '__');
}

function writeOutcome(ctx, side, gate, entry, outcome) {
  const dir = path.join(ctx.work, 'results', side, gate);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug(entry)}.json`), JSON.stringify({ entry, outcome }));
}

function outcomePath(ctx, side, gate, entry) {
  return path.join(ctx.work, 'results', side, gate, `${slug(entry)}.json`);
}

function seedIdentical(ctx) {
  for (const entry of CORPUS) {
    for (const gate of GATES) {
      for (const side of ['pinned', 'candidate']) {
        writeOutcome(ctx, side, gate, entry, { exit: 0, findings: [] });
      }
    }
  }
}

function matrixRows(ctx) {
  return (ctx.result.stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [verdict, entry, gate, ...detail] = line.split('|');
      return { verdict, entry, gate, detail: detail.join('|') };
    });
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a comparison work dir holding a pinned-run result set and a candidate-run result set for the same corpus$/,
    (ctx) => {
      ctx.work = fs.mkdtempSync(path.join(os.tmpdir(), 'bl959-equivalence-'));
      trackedRoots.push(ctx.work);
      seedIdentical(ctx);
    }
  );

  // ── Givens ────────────────────────────────────────────────────────────
  scoped(/^every corpus entry carries the same gate outcome in both result sets$/, (ctx) => {
    seedIdentical(ctx);
  });

  scoped(
    /^the candidate result set records (.+) for the lint gate on exactly one corpus entry$/,
    (ctx, outcomeForm) => {
      if (!KNOWN_CANDIDATE_OUTCOMES.has(outcomeForm)) {
        throw new Error(`BL-959: unrecognized candidate outcome "${outcomeForm}" - not in KNOWN_VALUES`);
      }
      ctx.touchedEntry = CORPUS[1];
      if (KNOWN_CANDIDATE_OUTCOMES.get(outcomeForm) === 'divergent') {
        writeOutcome(ctx, 'candidate', 'lint-parse', ctx.touchedEntry, {
          exit: 1,
          error: 'FAIL: did not parse under the candidate toolchain',
        });
      } else {
        fs.rmSync(outcomePath(ctx, 'candidate', 'lint-parse', ctx.touchedEntry));
      }
    }
  );

  // ── When ─────────────────────────────────────────────────────────────
  scoped(/^the equivalence comparator runs over the work dir$/, (ctx) => {
    ctx.result = spawnSync('bb', [EQUIVALENCE_CLI, 'compare', ctx.work], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
  });

  // ── Thens ─────────────────────────────────────────────────────────────
  scoped(/^the verdict matrix marks every corpus entry EQUIVALENT$/, (ctx) => {
    const rows = matrixRows(ctx);
    assert.equal(
      rows.length,
      CORPUS.length * GATES.length,
      `expected one row per corpus entry x gate, got:\n${ctx.result.stdout}`
    );
    for (const row of rows) {
      assert.equal(row.verdict, 'EQUIVALENT', `non-EQUIVALENT row: ${JSON.stringify(row)}`);
    }
  });

  scoped(/^the verdict matrix marks exactly that corpus entry (\S+) naming the lint gate$/, (ctx, verdict) => {
    if (!KNOWN_VERDICTS.has(verdict)) {
      throw new Error(`BL-959: unrecognized verdict "${verdict}" - not in KNOWN_VALUES`);
    }
    const rows = matrixRows(ctx);
    const flagged = rows.filter((r) => r.verdict !== 'EQUIVALENT');
    assert.equal(flagged.length, 1, `expected exactly one non-EQUIVALENT row, got:\n${ctx.result.stdout}`);
    assert.equal(flagged[0].verdict, verdict, `expected ${verdict}, got: ${JSON.stringify(flagged[0])}`);
    assert.equal(flagged[0].entry, ctx.touchedEntry, `wrong entry flagged: ${JSON.stringify(flagged[0])}`);
    assert.equal(flagged[0].gate, 'lint-parse', `verdict does not name the lint gate: ${JSON.stringify(flagged[0])}`);
  });

  scoped(/^the comparator exits 0$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}:\n${ctx.result.stderr}`);
  });

  scoped(/^the comparator exits non-zero$/, (ctx) => {
    assert.notEqual(ctx.result.status, 0, `expected a non-zero exit, got 0:\n${ctx.result.stdout}`);
  });
}

module.exports = { registerSteps };
