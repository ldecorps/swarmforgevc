const assert = require('node:assert/strict');
const fc = require('fast-check');

// BL-1005 declared invariant (property authorship rests with the coder,
// first pass - BL-654): "The gate never passes vacuously: for any Onboarder
// section it is given, the handler either extracts at least one build-state
// claim and checks every one against the backlog, or it fails - reporting
// zero claims found is a failure, never a pass."
//
// The checker under test is the real checkBuildStateClaims the acceptance
// step handler drives, with the backlog resolver injected so the property
// quantifies over SECTIONS, not over this repo's one live backlog.
//
// Generator reach is constructive, not hoped-for: sections are BUILT from
// typed blocks (noise prose / marker-less ticket references / marker
// phrases with no id / claim blocks carrying a marker plus fresh ids), so
// the zero-claim state and each claim kind are reached by construction,
// and the reached counts are asserted as floors at the end - a property
// that never actually visited a state proves nothing about it. Broken
// resolutions are likewise derived from the planted truth by flipping one
// claim's state, so every "wrong backlog" case is a violation candidate by
// construction rather than a lucky draw.
const {
  extractBuildStateClaims,
  checkBuildStateClaims,
  CLAIM_TO_BACKLOG_STATE,
} = require('../../specs/pipeline/steps/bl643NonPipelineAgentsSteps');

const KINDS = Object.keys(CLAIM_TO_BACKLOG_STATE); // ['shipped', 'unbuilt']

const NOISE_WORDS = ['the', 'poller', 'topic', 'state', 'machine', 'survives', 'a', 'restart', 'per', 'target'];

const arbNoiseBlock = fc
  .array(fc.constantFrom(...NOISE_WORDS), { minLength: 3, maxLength: 12 })
  .map((ws) => `${ws.join(' ')}.`);

// Ticket ids referenced as context, with no marker phrase: never claims.
const arbContextIdBlock = fc
  .integer({ min: 1, max: 999 })
  .map((n) => `See BL-80${n} for the poller rule already documented.`);

// A marker phrase with no ticket id at all: never a claim either.
const arbMarkerOnlyBlock = fc.constantFrom(
  'Everything above is derived from reading the shipped code.',
  'The section describes what is on `main` today in prose only.',
  'Nothing here is unbuilt.'
);

const SHIPPED_PHRASES = ['are on `main` today', 'is on main', 'landed on the main branch', 'shipped in one parcel'];
const UNBUILT_PHRASES = ['is not built yet', 'are not yet built', 'is unbuilt', 'remains unshipped', 'is not yet shipped'];

// A claim block: one kind, 1..3 FRESH ids (uniqueness across the whole
// section is guaranteed by the running counter, so generated sections
// never trip the extractor's conflicting-claims guard - that guard has
// its own unit tests).
function claimBlock(kind, ids) {
  const phrase = kind === 'shipped' ? SHIPPED_PHRASES[ids.length % SHIPPED_PHRASES.length] : UNBUILT_PHRASES[ids.length % UNBUILT_PHRASES.length];
  return { kind, ids, text: `The phases (${ids.join(', ')}) ${phrase}.` };
}

const arbClaimSpec = fc.record({
  kind: fc.constantFrom(...KINDS),
  idCount: fc.integer({ min: 1, max: 3 }),
});

// A full section spec: interleaved non-claim blocks and claim specs.
const arbSectionSpec = fc.record({
  nonClaims: fc.array(fc.oneof(arbNoiseBlock, arbContextIdBlock, arbMarkerOnlyBlock), { minLength: 0, maxLength: 4 }),
  claims: fc.array(arbClaimSpec, { minLength: 0, maxLength: 3 }),
  seed: fc.integer({ min: 0, max: 1000 }),
});

function buildSection(spec) {
  let nextId = 900000 + spec.seed * 10;
  const claimBlocks = spec.claims.map((c) => {
    const ids = Array.from({ length: c.idCount }, () => `BL-${nextId++}`);
    return claimBlock(c.kind, ids);
  });
  const blocks = [...spec.nonClaims.map((text) => ({ kind: null, ids: [], text })), ...claimBlocks];
  // Deterministic interleave from the seed so claim position varies.
  blocks.sort((a, b) => ((a.text.length + spec.seed) % 7) - ((b.text.length + spec.seed) % 7));
  const planted = claimBlocks.flatMap((b) => b.ids.map((ticketId) => ({ ticketId, claim: b.kind })));
  return { text: blocks.map((b) => b.text).join('\n\n'), planted };
}

function truthfulResolver(planted, asked) {
  const truth = new Map(planted.map((c) => [c.ticketId, CLAIM_TO_BACKLOG_STATE[c.claim]]));
  return (id) => {
    asked.push(id);
    if (!truth.has(id)) {
      throw new Error(`resolver asked about an id the document never claimed: ${id}`);
    }
    return truth.get(id);
  };
}

test('property: a section yielding zero build-state claims FAILS for both kinds - the resolver could never save it', () => {
  let zeroClaimSectionsSeen = 0;
  fc.assert(
    fc.property(
      fc.record({
        nonClaims: fc.array(fc.oneof(arbNoiseBlock, arbContextIdBlock, arbMarkerOnlyBlock), { minLength: 0, maxLength: 5 }),
      }),
      ({ nonClaims }) => {
        const section = nonClaims.join('\n\n');
        assert.equal(extractBuildStateClaims(section).length, 0, 'generator sanity: non-claim blocks must yield no claims');
        zeroClaimSectionsSeen++;
        for (const kind of KINDS) {
          assert.throws(
            () => checkBuildStateClaims(section, kind, () => CLAIM_TO_BACKLOG_STATE[kind]),
            /zero build-state claims/,
            `kind "${kind}" passed vacuously on a section with no claims`
          );
        }
      }
    ),
    { numRuns: 200 }
  );
  assert.ok(zeroClaimSectionsSeen >= 200, `reachability floor: expected every run to exercise a zero-claim section, saw ${zeroClaimSectionsSeen}`);
});

test('property: every extracted claim of the checked kind is checked against the backlog, and one flipped resolution fails naming its id', () => {
  const reached = { shipped: 0, unbuilt: 0 };
  fc.assert(
    fc.property(arbSectionSpec, fc.integer({ min: 0, max: 1 << 20 }), (spec, flipPick) => {
      const { text, planted } = buildSection(spec);
      if (planted.length === 0) {
        // Zero-claim sections are the first property's subject; here they
        // must still refuse to pass, then this run is done.
        assert.throws(() => checkBuildStateClaims(text, 'shipped', () => 'closed'), /zero build-state claims/);
        return;
      }
      for (const c of planted) {
        reached[c.claim]++;
      }

      // Truthful backlog: both kinds pass, and the checker consulted the
      // resolver for EXACTLY the planted ids of that kind - "checks every
      // one against the backlog", not a sample.
      for (const kind of KINDS) {
        const asked = [];
        checkBuildStateClaims(text, kind, truthfulResolver(planted, asked));
        const expectedIds = planted.filter((c) => c.claim === kind).map((c) => c.ticketId);
        assert.deepEqual(asked.sort(), expectedIds.sort(), `kind "${kind}" did not check exactly the claimed ids`);
      }

      // Flip ONE planted claim's backlog state - a violation candidate by
      // construction. The kind owning it must now fail, naming the id.
      const victim = planted[flipPick % planted.length];
      const flippedState = CLAIM_TO_BACKLOG_STATE[victim.claim] === 'closed' ? 'open' : 'closed';
      const brokenResolver = (id) => (id === victim.ticketId ? flippedState : CLAIM_TO_BACKLOG_STATE[planted.find((c) => c.ticketId === id).claim]);
      assert.throws(
        () => checkBuildStateClaims(text, victim.claim, brokenResolver),
        new RegExp(victim.ticketId),
        `a ${victim.claim} claim whose ticket is ${flippedState} must fail naming ${victim.ticketId}`
      );
    }),
    { numRuns: 300 }
  );
  assert.ok(reached.shipped >= 60, `reachability floor: shipped claims reached only ${reached.shipped} times across 300 runs`);
  assert.ok(reached.unbuilt >= 60, `reachability floor: unbuilt claims reached only ${reached.unbuilt} times across 300 runs`);
});
