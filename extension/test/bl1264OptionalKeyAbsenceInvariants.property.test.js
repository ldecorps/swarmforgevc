const assert = require('node:assert/strict');
const fc = require('fast-check');
const { computeNeedsApproval } = require('../out/metrics/backlogDashboard');

// BL-1264 declared invariant:
//   "A field declared optional on an interface is absent from the object
//    when it has no value, never present with the value undefined: the two
//    are distinguishable to every strict comparison, and a producer that
//    cannot tell them apart makes its own type a lie."
//
// Runs ONLY via `npm run test:properties`.

// The three states that matter, drawn explicitly. A generator that only
// produced items WITH a context would pass against the defect, since the
// unconditional spread and the conditional one agree whenever there is a
// value - so the no-context state is the one the reach floor guards.
const CONTEXT = () =>
  fc.oneof(
    { arbitrary: fc.constant(undefined), weight: 3 },
    { arbitrary: fc.constant(''), weight: 1 },
    { arbitrary: fc.stringMatching(/^[A-Za-z0-9 .,'-]{1,40}$/), weight: 3 }
  );

const ITEM = () =>
  fc
    .tuple(fc.integer({ min: 1, max: 999 }), CONTEXT(), fc.constantFrom('pending', 'approved', undefined))
    .map(([n, approvalContext, humanApproval]) => {
      const item = { id: `BL-${n}`, title: `t${n}`, status: 'active' };
      if (humanApproval !== undefined) item.humanApproval = humanApproval;
      if (approvalContext !== undefined) item.approvalContext = approvalContext;
      // A ticket whose YAML omits approval_context: reaches the producer
      // with the property genuinely absent, which is the shape under test.
      return { item, approvalContext, humanApproval };
    });

const ITEMS = () => fc.array(ITEM(), { minLength: 0, maxLength: 6 });

function kindsOf(entries) {
  return {
    noContext: entries.some((e) => e.humanApproval === 'pending' && e.approvalContext === undefined),
    withContext: entries.some((e) => e.humanApproval === 'pending' && typeof e.approvalContext === 'string' && e.approvalContext !== ''),
    emptyContext: entries.some((e) => e.humanApproval === 'pending' && e.approvalContext === ''),
    mixed:
      entries.filter((e) => e.humanApproval === 'pending' && e.approvalContext === undefined).length > 0 &&
      entries.filter((e) => e.humanApproval === 'pending' && e.approvalContext !== undefined).length > 0,
  };
}

function assertReach(seen, kinds) {
  for (const kind of kinds) {
    assert.ok(seen[kind] > 0, `generator never reached ${kind}: ${JSON.stringify(seen)}`);
  }
}

test('property (invariant): approvalContext is an own key exactly when the ticket has one', () => {
  const seen = { noContext: 0, withContext: 0, emptyContext: 0, mixed: 0 };
  fc.assert(
    fc.property(ITEMS(), ITEMS(), (activeSpec, pausedSpec) => {
      const all = [...activeSpec, ...pausedSpec];
      for (const [kind, hit] of Object.entries(kindsOf(all))) {
        if (hit) seen[kind] += 1;
      }
      const entries = computeNeedsApproval(
        activeSpec.map((s) => s.item),
        pausedSpec.map((s) => s.item)
      );
      const pending = all.filter((s) => s.humanApproval === 'pending');
      assert.equal(entries.length, pending.length, 'the filter itself changed');
      entries.forEach((entry, i) => {
        const expected = pending[i].approvalContext;
        assert.equal(
          Object.prototype.hasOwnProperty.call(entry, 'approvalContext'),
          expected !== undefined,
          `approvalContext key presence is wrong for ${JSON.stringify(pending[i].item)}: ${JSON.stringify(Object.keys(entry))}`
        );
        if (expected !== undefined) {
          assert.equal(entry.approvalContext, expected, 'a present context was altered');
        }
      });
    }),
    { numRuns: 120 }
  );
  assertReach(seen, ['noContext', 'withContext', 'emptyContext', 'mixed']);
});

test('property (invariant): no entry ever carries an own key valued undefined', () => {
  const seen = { noContext: 0, withContext: 0, emptyContext: 0, mixed: 0 };
  fc.assert(
    fc.property(ITEMS(), ITEMS(), (activeSpec, pausedSpec) => {
      for (const [kind, hit] of Object.entries(kindsOf([...activeSpec, ...pausedSpec]))) {
        if (hit) seen[kind] += 1;
      }
      const entries = computeNeedsApproval(
        activeSpec.map((s) => s.item),
        pausedSpec.map((s) => s.item)
      );
      for (const entry of entries) {
        for (const key of Object.keys(entry)) {
          assert.notEqual(
            entry[key],
            undefined,
            `own key "${key}" is present but valued undefined - the exact shape the optional marker forbids`
          );
        }
      }
    }),
    { numRuns: 120 }
  );
  assertReach(seen, ['noContext', 'withContext', 'emptyContext', 'mixed']);
});

// The reason this defect never reached backlog.json: JSON.stringify drops
// own keys valued undefined. Stated as a property so the "the serialised
// artefact is unaffected" claim is checked rather than asserted in prose.
test('property (invariant): the serialised form is identical either way, which is why no file consumer changed', () => {
  let cases = 0;
  fc.assert(
    fc.property(ITEMS(), (activeSpec) => {
      cases += 1;
      const entries = computeNeedsApproval(activeSpec.map((s) => s.item), []);
      const preFixShape = entries.map((e) => ({ id: e.id, title: e.title, approvalContext: e.approvalContext }));
      assert.equal(JSON.stringify(entries), JSON.stringify(preFixShape));
    }),
    { numRuns: 60 }
  );
  assert.ok(cases > 0);
});
