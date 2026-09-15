'use strict';

// BL-1462/BL-654 invariant 2: "Wherever backlog bookkeeping moves a ticket
// (active, paused, done, done under a milestone) the handler's lookup still
// finds it, because it is the gate library's own search, not a second
// locator."
//
// Generator-reach: every property run plants the target ticket under ALL
// FOUR known locations in the same draw (an asserted floor, never a hoped-
// for sample - a location-choice generator sampled independently could
// legitimately go many runs without ever drawing "done/M8"). What is
// GENERATED per run is the noise around that floor: a random number of
// decoy tickets (other ids) scattered across the other locations, and
// random non-"id:"-prefixed lines padding the target YAML's own content -
// proving the resolver picks the right file by its id: field regardless of
// surrounding clutter, not merely "the only yaml file present".
//
// Non-vacuity (staged break, restored, verified 2026-09-15): commenting out
// the `backlog/done` entry from SEARCH_ORDER in lib/ticketYamlLookup.js
// turned this RED on the "done" and "done/M8" location assertions at the
// first draw. Restored; holds.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { resolveTicketYamlPath } = require('../../specs/pipeline/steps/lib/ticketYamlLookup');
const { mkTmpDir } = require('./helpers/tmpDir');

const KNOWN_LOCATIONS = ['backlog/active', 'backlog/paused', 'backlog/done', 'backlog/done/M8'];

const idArb = fc.integer({ min: 1, max: 99999 }).map((n) => `BL-${n}`);
const paddingLineArb = fc.oneof(
  fc.constant(''),
  fc.constant('# a comment line'),
  fc.string({ minLength: 0, maxLength: 20 }).filter((s) => !s.startsWith('id:')).map((s) => `title: "${s.replace(/\n/g, ' ')}"`)
);

function writeYaml(dir, name, id, padBefore, padAfter) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = [...padBefore, `id: ${id}`, ...padAfter, ''];
  fs.writeFileSync(path.join(dir, name), lines.join('\n'));
}

test('BL-1462: the ticket lookup finds the target ticket under every known backlog location, regardless of decoy clutter', () => {
  fc.assert(
    fc.property(
      idArb,
      fc.array(fc.record({ location: fc.constantFrom(...KNOWN_LOCATIONS), id: idArb }), { maxLength: 6 }),
      fc.array(paddingLineArb, { maxLength: 4 }),
      fc.array(paddingLineArb, { maxLength: 4 }),
      (targetId, decoys, padBefore, padAfter) => {
        const root = mkTmpDir('bl1462-reach-');
        try {
          // Decoys: never the target id itself, so they never accidentally
          // satisfy the lookup and mask a real defect.
          decoys
            .filter((d) => d.id !== targetId)
            .forEach((d, i) => {
              writeYaml(path.join(root, ...d.location.split('/')), `decoy-${i}.yaml`, d.id, [], []);
            });

          // The reachability floor: the target ticket, planted under ALL
          // FOUR known locations in the same draw - one location per
          // sub-run below, never sampled down to one.
          for (const location of KNOWN_LOCATIONS) {
            const testRoot = fs.mkdtempSync(path.join(root, 'loc-'));
            const targetDir = path.join(testRoot, ...location.split('/'));
            writeYaml(targetDir, 'target.yaml', targetId, padBefore, padAfter);
            // Re-plant the same decoys under this sub-root so "found the
            // only file" can't pass by accident.
            decoys
              .filter((d) => d.id !== targetId)
              .forEach((d, i) => {
                writeYaml(path.join(testRoot, ...d.location.split('/')), `decoy-${i}.yaml`, d.id, [], []);
              });

            const found = resolveTicketYamlPath(testRoot, targetId);
            assert.ok(found, `expected to resolve ${targetId} under ${location}, found nothing`);
            assert.equal(
              path.dirname(found),
              targetDir,
              `expected ${targetId} resolved under ${location}, got ${found}`
            );
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 30 }
  );
});
