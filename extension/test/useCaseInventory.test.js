const assert = require('node:assert/strict');
const { deriveUseCaseInventory, generateUseCaseInventoryMarkdown } = require('../out/onboarding/useCaseInventory');

const FIXTURE_FACTS = {
  languages: ['TypeScript'],
  layoutSummary: 'src/ + test/',
  readmeSummary: 'A CLI tool.',
  seedVision: 'Ship the MVP.',
  initialBacklogSummary: '5 tickets queued.',
  useCaseObservations: [
    { name: 'CSV export', summary: 'Exports the current report as CSV.', locations: ['src/export/csv.ts'] },
    {
      name: 'Scheduled scan',
      summary: 'Runs a scan on a cron schedule.',
      locations: ['src/scheduler.ts', 'src/scan/runner.ts'],
    },
  ],
};

// BL-360 use-case-inventory-01/02: derives from the target's own code
// (locations), not the README alone.
test('deriveUseCaseInventory carries every observed use case through, with its code locations', () => {
  const inventory = deriveUseCaseInventory(FIXTURE_FACTS);

  assert.equal(inventory.entries.length, 2);
  assert.deepEqual(inventory.entries[0], {
    name: 'CSV export',
    summary: 'Exports the current report as CSV.',
    locations: ['src/export/csv.ts'],
  });
  assert.deepEqual(inventory.entries[1].locations, ['src/scheduler.ts', 'src/scan/runner.ts']);
});

// BL-360 use-case-inventory-06: no discernible use cases is a first-class,
// legitimate outcome, never a crash or a fabricated entry.
test('deriveUseCaseInventory returns an empty inventory when the survey found no use cases', () => {
  const inventory = deriveUseCaseInventory({ ...FIXTURE_FACTS, useCaseObservations: [] });

  assert.deepEqual(inventory.entries, []);
});

// ── generateUseCaseInventoryMarkdown ────────────────────────────────────────

test('generateUseCaseInventoryMarkdown names each use case, its summary, and where it lives in the code', () => {
  const markdown = generateUseCaseInventoryMarkdown(deriveUseCaseInventory(FIXTURE_FACTS));

  assert.match(markdown, /## CSV export/);
  assert.match(markdown, /Exports the current report as CSV\./);
  assert.match(markdown, /src\/export\/csv\.ts/);
  assert.match(markdown, /## Scheduled scan/);
  assert.match(markdown, /src\/scheduler\.ts/);
  assert.match(markdown, /src\/scan\/runner\.ts/);
});

// BL-360 use-case-inventory-05: a stable name a later change request can
// cite - proven here as the exact heading text, not a generated/renumbered
// label that could drift between renders of the same entry.
test('generateUseCaseInventoryMarkdown renders a stable, citable name as each entry\'s own heading', () => {
  const markdown = generateUseCaseInventoryMarkdown(deriveUseCaseInventory(FIXTURE_FACTS));

  assert.match(markdown, /^## CSV export$/m);
  assert.match(markdown, /^## Scheduled scan$/m);
});

// BL-360 use-case-inventory-06: the empty case says so plainly - never a
// blank document, never an invented entry.
test('generateUseCaseInventoryMarkdown states plainly when no use cases were found', () => {
  const markdown = generateUseCaseInventoryMarkdown({ entries: [] });

  assert.match(markdown, /No discernible use cases were found/);
  assert.doesNotMatch(markdown, /^## /m);
});
