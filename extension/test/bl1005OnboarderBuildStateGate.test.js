const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1005: agent-class-doc-06 froze a build-state snapshot into the gate
// (literal BL-624/BL-625 + "not built yet"), so the gate went red the day
// the document honestly reported those slices as shipped. The replacement
// DERIVES every build-state claim from the document under test and checks
// it against the backlog, symmetrically: a phase called shipped must cite
// a closed ticket (under backlog/done/, recursively - BL-590 sits flat
// while BL-624/625 sit under done/M8/), a phase called unbuilt must cite
// an open one (active/, paused/ or hold/). These tests specify the three
// exported pieces the step handler composes: claim extraction, backlog
// state resolution, and the checker that enforces the ticket's declared
// invariant (zero extracted claims is a FAILURE, never a vacuous pass).
const {
  extractBuildStateClaims,
  resolveTicketBacklogState,
  checkBuildStateClaims,
  CLAIM_TO_BACKLOG_STATE,
  registerSteps,
} = require('../../specs/pipeline/steps/bl643NonPipelineAgentsSteps');
const { createStepRegistry } = require('../../specs/pipeline/stepRegistry');

// Condensed fixture mirroring the real Onboarder section's claim idioms:
// a shipped-marker paragraph listing ids, marker-less prose citing ids
// (BL-439, BL-269 - context references, NOT claims), "Slice N (BL-x)"
// headings, and a trailing "shipped code" marker with no id at all.
const REAL_SHAPE_SECTION = [
  '## The Onboarder: what shipped',
  '',
  'The Onboarder guides a human through onboarding. All **three slices**',
  '(BL-590, BL-624, BL-625) are on `main` today, closing the full state',
  'machine. Slice 1 first:',
  '',
  '- **A thin poll-loop process** avoiding a second poller (a 409-conflict',
  '  risk BL-439 already documented).',
  '',
  '**Slice 2 (BL-624) — survey through an agreed, gated contract.** The',
  'survey agent runs scoped to read-only tools.',
  '',
  '**Slice 3 (BL-625) — prompts, launch handoff, done, topic reuse.** It',
  'runs the existing BL-269 prompts CLI and marks the target `done`.',
  '',
  'Everything above is derived from reading the shipped code.',
].join('\n');

function claimSet(claims) {
  return claims.map((c) => `${c.claim}:${c.ticketId}`).sort();
}

// ── extractBuildStateClaims ─────────────────────────────────────────────

test('extractBuildStateClaims derives shipped claims from a real-shaped section and ignores marker-less context ids', () => {
  const claims = extractBuildStateClaims(REAL_SHAPE_SECTION);
  assert.deepEqual(claimSet(claims), ['shipped:BL-590', 'shipped:BL-624', 'shipped:BL-625']);
});

test('extractBuildStateClaims captures ids split across a wrapped line inside one marker paragraph', () => {
  const claims = extractBuildStateClaims('Slices (BL-101, BL-102,\nBL-103) are on `main` today.');
  assert.deepEqual(claimSet(claims), ['shipped:BL-101', 'shipped:BL-102', 'shipped:BL-103']);
});

test('extractBuildStateClaims reads an explicit not-built-yet paragraph as unbuilt claims', () => {
  const claims = extractBuildStateClaims('Slices 2 and 3 (BL-624, BL-625) are not built yet.');
  assert.deepEqual(claimSet(claims), ['unbuilt:BL-624', 'unbuilt:BL-625']);
});

test('extractBuildStateClaims treats a "Slice N (BL-x)" heading as a shipped claim even without a marker phrase', () => {
  const claims = extractBuildStateClaims('**Slice 2 (BL-624) — survey.** Uses the BL-439 poller rule.');
  assert.deepEqual(claimSet(claims), ['shipped:BL-624']);
});

test('extractBuildStateClaims lets an explicit unbuilt marker override the slice-heading shipped default in the same block', () => {
  const claims = extractBuildStateClaims('**Slice 4 (BL-1200) — future.** This slice is not built yet.');
  assert.deepEqual(claimSet(claims), ['unbuilt:BL-1200']);
});

test('extractBuildStateClaims reads "not yet shipped" as unbuilt, not as an ambiguous shipped/unbuilt mix', () => {
  // "not yet shipped" contains the word "shipped": a naive shipped-marker
  // test on the raw block would see both markers and throw ambiguous.
  const claims = extractBuildStateClaims('Slice 4 (BL-1200) is not yet shipped.');
  assert.deepEqual(claimSet(claims), ['unbuilt:BL-1200']);
});

test('extractBuildStateClaims refuses to guess when one block carries both markers and ticket ids', () => {
  assert.throws(
    () => extractBuildStateClaims('BL-590 is on `main` but BL-1200 is not built yet.'),
    /ambiguous/,
    'a block mixing shipped and unbuilt markers must fail loudly, not attribute ids by guesswork'
  );
});

test('extractBuildStateClaims refuses a section claiming one id both shipped and unbuilt', () => {
  const section = 'BL-624 is on `main` today.\n\nBL-624 is not built yet.';
  assert.throws(() => extractBuildStateClaims(section), /conflicting.*BL-624/);
});

test('extractBuildStateClaims yields no claim for a marker without ids or ids without a marker', () => {
  assert.deepEqual(extractBuildStateClaims('Everything here is shipped code.'), []);
  assert.deepEqual(extractBuildStateClaims('See BL-439 for the poller rule.'), []);
  assert.deepEqual(extractBuildStateClaims(''), []);
});

test('extractBuildStateClaims dedupes a claim repeated across blocks', () => {
  const claims = extractBuildStateClaims('BL-624 is on `main`.\n\n**Slice 2 (BL-624) — survey.** Done.');
  assert.deepEqual(claimSet(claims), ['shipped:BL-624']);
});

// ── resolveTicketBacklogState ───────────────────────────────────────────

// Fixture roots go through the shared mkTmpDir helper (BL-420): the
// setup-file afterEach sweeps them on both the pass and throw paths, so
// an earlier assertion failure never leaks them (BL-971).
function makeBacklogFixture(files) {
  const root = mkTmpDir('bl1005-backlog-');
  for (const rel of files) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'id: fixture\n');
  }
  return root;
}

test('resolveTicketBacklogState finds closed tickets both flat under done/ and nested in a milestone subdirectory', () => {
  const root = makeBacklogFixture(['done/BL-590-onboarding.yaml', 'done/M8/BL-624-survey.yaml']);
  assert.equal(resolveTicketBacklogState('BL-590', root), 'closed');
  assert.equal(resolveTicketBacklogState('BL-624', root), 'closed');
});

test('resolveTicketBacklogState reports open for active/, paused/ and hold/', () => {
  const root = makeBacklogFixture([
    'active/BL-101-a.yaml',
    'paused/BL-102-b.yaml',
    'hold/BL-103-c.yaml',
  ]);
  assert.equal(resolveTicketBacklogState('BL-101', root), 'open');
  assert.equal(resolveTicketBacklogState('BL-102', root), 'open');
  assert.equal(resolveTicketBacklogState('BL-103', root), 'open');
});

test('resolveTicketBacklogState reports missing for a ticket nowhere in the backlog', () => {
  const root = makeBacklogFixture(['done/BL-590-onboarding.yaml']);
  assert.equal(resolveTicketBacklogState('BL-999999', root), 'missing');
});

test('resolveTicketBacklogState prefers done/ over a stale duplicate left in active/', () => {
  const root = makeBacklogFixture(['done/M8/BL-624-survey.yaml', 'active/BL-624-survey.yaml']);
  assert.equal(resolveTicketBacklogState('BL-624', root), 'closed');
});

test('resolveTicketBacklogState never prefix-matches a longer ticket id', () => {
  const root = makeBacklogFixture(['done/BL-624-survey.yaml']);
  assert.equal(resolveTicketBacklogState('BL-62', root), 'missing');
});

// ── checkBuildStateClaims (the declared invariant lives here) ───────────

test('checkBuildStateClaims fails on zero extracted claims for BOTH kinds - never a vacuous pass', () => {
  for (const kind of Object.keys(CLAIM_TO_BACKLOG_STATE)) {
    assert.throws(
      () => checkBuildStateClaims('Prose naming no ticket at all.', kind, () => 'closed'),
      /zero build-state claims/,
      `kind "${kind}" must fail, not pass, on a section with no claims`
    );
  }
});

test('checkBuildStateClaims passes a shipped claim whose ticket is closed and consults the resolver for it', () => {
  const asked = [];
  const resolver = (id) => {
    asked.push(id);
    return 'closed';
  };
  checkBuildStateClaims('BL-624 is on `main` today.', 'shipped', resolver);
  assert.deepEqual(asked, ['BL-624']);
});

test('checkBuildStateClaims fails a shipped claim citing an open ticket, naming the id', () => {
  assert.throws(
    () => checkBuildStateClaims('BL-1005 is on `main` today.', 'shipped', () => 'open'),
    /BL-1005/
  );
});

test('checkBuildStateClaims fails an unbuilt claim citing a closed ticket, naming the id', () => {
  assert.throws(
    () => checkBuildStateClaims('BL-625 is not built yet.', 'unbuilt', () => 'closed'),
    /BL-625/
  );
});

test('checkBuildStateClaims fails a claim citing a ticket missing from the backlog entirely', () => {
  assert.throws(
    () => checkBuildStateClaims('BL-777777 is on `main` today.', 'shipped', () => 'missing'),
    /BL-777777/
  );
});

test('checkBuildStateClaims passes a kind with no claims of its own when the section has claims of the other kind', () => {
  checkBuildStateClaims('BL-624 is on `main` today.', 'unbuilt', () => {
    throw new Error('resolver must not be consulted for a kind with no claims');
  });
});

// ── step wiring ─────────────────────────────────────────────────────────

function resolvedStep(text) {
  const registry = createStepRegistry();
  registerSteps(registry);
  return registry.resolve(text);
}

test('the old frozen-snapshot step is deleted from the registry', () => {
  assert.ok(!resolvedStep('each unshipped phase is named with the ticket that owns it'));
});

test('the new derived step resolves for both Examples rows and rejects unknown or mismatched values', () => {
  const ctx = { onboarderSection: 'Prose naming no ticket at all.' };
  for (const [claim, state] of Object.entries(CLAIM_TO_BACKLOG_STATE)) {
    const step = resolvedStep(`every phase it names as ${claim} cites a ticket that is ${state}`);
    assert.ok(step, `expected a handler for the ${claim}/${state} row`);
    // Real handler, fixture section: the invariant fires before any backlog IO.
    assert.throws(() => step.handler(ctx, ...step.args), /zero build-state claims/);
  }
  const unknown = resolvedStep('every phase it names as finished cites a ticket that is closed');
  assert.ok(unknown, 'the pattern matches, the handler itself rejects unknown values');
  assert.throws(() => unknown.handler(ctx, ...unknown.args), /unrecognized/);
  const mismatched = resolvedStep('every phase it names as shipped cites a ticket that is open');
  assert.throws(() => mismatched.handler(ctx, ...mismatched.args), /unrecognized/);
});
