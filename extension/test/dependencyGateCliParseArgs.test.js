const assert = require('node:assert/strict');
const { parseArgs } = require('../out/tools/dependency-gate');

// BL-375: split from dependencyGateCli.test.js (family: dependencyGateCli*)
// so the real-engine files can run concurrently instead of one file
// serialising all 12 tests. This file holds the two PURE, cheap parseArgs
// tests - no dependency-cruiser engine boot, no fixture I/O.

// ── parseArgs (pure) ───────────────────────────────────────────────────

test('parseArgs with no arguments defaults to full-repo scope (src, media)', () => {
  assert.deepEqual(parseArgs([]), { scopePaths: ['src', 'media'] });
});

test('parseArgs with file arguments scopes to exactly those (per-parcel mode)', () => {
  assert.deepEqual(parseArgs(['src/quality/coChange.ts', 'src/tools/co-change-report.ts']), {
    scopePaths: ['src/quality/coChange.ts', 'src/tools/co-change-report.ts'],
  });
});
