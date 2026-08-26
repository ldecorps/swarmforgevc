const assert = require('node:assert/strict');
const fc = require('fast-check');
const { resolveEpicWritePaths } = require('../out/bridge/bridgeServer');

// BL-572, architect property pass. `resolveEpicWritePaths` exists to make the
// tie-run cascade's writes ALL-OR-NOTHING: a cascade can touch 3+ backlog
// YAMLs, and resolving each path inside the write loop left a partially
// rewritten, uncommitted backlog when one file went missing part-way
// (architect bounce #3, secondary finding). That is the on-disk form of
// declared invariant 1 - a partial cascade can leave the mover displaced by
// more or fewer than one position.
//
// epicReorderBridge.test.js pins two examples: all-present, and the MIDDLE
// write missing. Those are the two shapes a human thinks to write. The
// guarantee is quantified over cascade length and over WHICH members are
// missing, so it belongs in a property: the generator below drives arbitrary
// cascade lengths with an arbitrary missing SUBSET, so "resolved nothing"
// is checked at the first, last, several-at-once, and all-missing positions
// too - none of which the examples reach.
//
// Undeclared-property pass (architect.prompt), distinct from the three
// declared `invariants:` encoded in epicReorderSafety.property.test.js.
// Runs ONLY via `npm run test:properties`.

const ID_POOL = [
  'BL-001', 'BL-002', 'BL-003', 'BL-100', 'BL-200', 'BL-300',
  'BL-540', 'BL-572', 'BL-900', 'BL-999',
];

// A cascade is at least the moved pair; the tie-run rewrite extends it.
const writesArb = fc
  .integer({ min: 2, max: ID_POOL.length })
  .chain((count) =>
    fc.tuple(
      fc.shuffledSubarray(ID_POOL, { minLength: count, maxLength: count }),
      fc.array(fc.integer({ min: 0, max: 20 }), { minLength: count, maxLength: count })
    )
  )
  .map(([ids, priorities]) => ids.map((id, i) => ({ id, priority: priorities[i] })));

// An arbitrary subset of the cascade whose write-time path lookup fails -
// the concurrent-modification window a real filesystem race hits only
// non-deterministically.
function missingSetArb(writes) {
  return fc
    .subarray(
      writes.map((w) => w.id),
      { minLength: 0, maxLength: writes.length }
    )
    .map((ids) => new Set(ids));
}

function findFnFor(missing) {
  return (_targetPath, id) => (missing.has(id) ? null : '/fake/backlog/' + id + '.yaml');
}

test('property: resolveEpicWritePaths resolves EVERY path or none - never a partial cascade', () => {
  let anyMissingSeen = 0;
  let allPresentSeen = 0;
  fc.assert(
    fc.property(
      writesArb.chain((writes) => fc.tuple(fc.constant(writes), missingSetArb(writes))),
      ([writes, missing]) => {
        const resolved = resolveEpicWritePaths('/target', writes, findFnFor(missing));

        if (missing.size > 0) {
          anyMissingSeen += 1;
          assert.equal(
            resolved,
            null,
            `a missing member (${[...missing].join(',')}) must resolve NOTHING, not a partial list of ${writes.length} writes`
          );
          return;
        }

        allPresentSeen += 1;
        assert.ok(Array.isArray(resolved), 'every path present must resolve to a list');
        assert.equal(resolved.length, writes.length, 'every write must be resolved, none dropped');
        // Order is load-bearing: the cascade is applied in the order the
        // decision core emitted, so resolution must not permute it.
        resolved.forEach((entry, i) => {
          assert.deepEqual(entry.write, writes[i], `write at position ${i} changed or was reordered`);
          assert.equal(entry.filePath, '/fake/backlog/' + writes[i].id + '.yaml');
        });
      }
    ),
    { numRuns: 400 }
  );
  // Reachability floor: a generator that stopped producing missing members
  // (or stopped producing complete cascades) would leave half this property
  // asserting nothing while still passing.
  assert.ok(anyMissingSeen > 20, `expected many cascades with a missing member: ${anyMissingSeen}`);
  assert.ok(allPresentSeen > 5, `expected some fully-resolvable cascades: ${allPresentSeen}`);
});

test('property: resolveEpicWritePaths never consults a path beyond the first missing member', () => {
  fc.assert(
    fc.property(
      writesArb.chain((writes) =>
        fc.tuple(fc.constant(writes), fc.integer({ min: 0, max: writes.length - 1 }))
      ),
      ([writes, missingIndex]) => {
        const asked = [];
        const missingId = writes[missingIndex].id;
        const resolved = resolveEpicWritePaths('/target', writes, (_t, id) => {
          asked.push(id);
          return id === missingId ? null : '/fake/' + id + '.yaml';
        });

        assert.equal(resolved, null);
        // Aborting at the first failure is what makes the guarantee cheap:
        // it must not keep resolving the rest of the cascade after deciding
        // the whole move is off.
        assert.deepEqual(
          asked,
          writes.slice(0, missingIndex + 1).map((w) => w.id),
          'resolution must stop at the first missing member'
        );
      }
    ),
    { numRuns: 300 }
  );
});
