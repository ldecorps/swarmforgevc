'use strict';

// BL-1380: PROPERTY tests over the three invariants the ticket YAML declares
// (coder-authored first, per BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   P1 a-tap-never-answers-an-unshown-question - for every ticket declaring
//      ruling_options with no ruling on record, tapping Expedite never leaves
//      it at human_approval approved. The half-recorded state - approved, the
//      choice gone and unaskable - is unreachable by this route.
//   P2 a-refusal-changes-nothing-and-says-why - that same refusal leaves the
//      ticket byte-unchanged in backlog/paused/, and its body names the gate
//      AND every option label, never a bare status (BL-1083 invariant 2,
//      BL-572/BL-662).
//   P3 a-ticket-with-nothing-to-choose-is-untouched - a ticket declaring no
//      ruling_options expedites exactly as it does today, including the case
//      where it was never pending approval at all; and one whose choice is
//      already answered expedites with its ruling neither cleared nor
//      rewritten.
//
// Drives the REAL paused-pager HTTP route through startBridge, never the
// classifier alone. That is this ticket's qa_e2e_procedure step 6, and it is
// the defect's own shape: BL-1367's classifier was already correct and already
// present in this very file - what was missing was the route ASKING it. A
// property over the classifier would have been green throughout the defect.
//
// GENERATOR REACH is CONSTRUCTED and asserted, never drawn and hoped for. The
// only shape that may proceed while options are declared is one whose recorded
// ruling MATCHES a declared label, and a ruling drawn independently would
// match essentially never - so it is drawn FROM the generated option list.
// Each of the four shapes gets its own pass and the run fails if one was never
// exercised.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { startBridge } = require('../out/bridge/bridgeServer');
const { copyLiveScriptClosureInto } = require('./helpers/pinnedRepoFixture');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

const TOKEN = 'bl1380-property-token';
const FIXTURE_PREFIX = 'sfvc-bl1380-property-';
const ID = 'BL-9380';

const SHAPES = ['options-no-ruling', 'options-with-ruling', 'no-options-pending', 'no-options-never-pending'];

const optionArb = fc
  .stringMatching(/^[a-z][a-z0-9 ]{2,20}$/)
  .map((s) => s.trim())
  .filter((s) => s.length > 2);

const optionsArb = fc.uniqueArray(optionArb, { minLength: 1, maxLength: 4 });

function controlAuthHeaders() {
  return { authorization: `Bearer ${TOKEN}`, 'x-control-token': TOKEN };
}

// Same fixture the route's own unit tests use: a real seeded repo plus the
// live commit_integrity/promotion_gates closures, because promoteToActive
// fails CLOSED without them and every promotion would refuse for a reason this
// ticket is not about.
function buildTarget() {
  const root = mkTmpDir(FIXTURE_PREFIX);
  copySeededRepoInto(root);
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), [
    'commit_integrity_cli.bb',
    'promotion_gates_cli.bb',
  ]);
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 50\n');
  for (const folder of ['done', 'active', 'paused']) {
    fs.mkdirSync(path.join(root, 'backlog', folder), { recursive: true });
  }
  return root;
}

function ticketYaml(shape, options, ruling) {
  const declaresOptions = shape.startsWith('options');
  return [
    `id: ${ID}`,
    'title: property fixture',
    'status: paused',
    'priority: 4',
    // "never pending approval" is the absent field, which backlog-schema.md
    // defines as no approval needed - not a missing value to be filled in.
    ...(shape === 'no-options-never-pending' ? [] : ['human_approval: pending']),
    ...(shape === 'options-with-ruling' ? [`human_ruling: ${ruling}`] : []),
    ...(declaresOptions ? ['ruling_options:', ...options.map((o) => `  - ${o}`)] : []),
    '',
  ].join('\n');
}

async function expedite(target) {
  const handle = await startBridge(target, path.join(target, 'runs.jsonl'), TOKEN, {});
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
      method: 'POST',
      headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID }),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    handle.stop();
  }
}

// A killed run traps no `finally`, so the previous run's fixtures are swept by
// prefix BEFORE this one starts as well (BL-971). Safe here for the reason it
// is not safe in a production guard (BL-1385): these roots are this test's own.
function sweepFixtures() {
  const parent = os.tmpdir();
  for (const entry of fs.readdirSync(parent)) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(parent, entry), { recursive: true, force: true });
    }
  }
}

function pausedPath(target) {
  return path.join(target, 'backlog', 'paused', `${ID}.yaml`);
}

function activePath(target) {
  return path.join(target, 'backlog', 'active', `${ID}.yaml`);
}

async function runShape(shape, options, rulingIndex, check) {
  const target = buildTarget();
  try {
    // Constructed, not drawn: the recorded ruling for the one shape that may
    // proceed with options declared IS one of the declared labels.
    const ruling = options[rulingIndex % options.length];
    const yaml = ticketYaml(shape, options, ruling);
    fs.writeFileSync(pausedPath(target), yaml);
    const outcome = await expedite(target);
    await check({ target, yaml, options, ruling, outcome });
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

test('BL-1380/BL-654 P1+P2: an unanswered choice is refused, out loud, with nothing written', async () => {
  sweepFixtures();
  let reached = 0;

  await fc.assert(
    fc.asyncProperty(optionsArb, async (options) => {
      await runShape('options-no-ruling', options, 0, ({ target, yaml, outcome }) => {
        reached += 1;
        // P1: never approved by this route. The strongest form - the file, not
        // the response - because the response is what the operator sees and
        // the file is what the next role reads.
        const onDisk = fs.readFileSync(pausedPath(target), 'utf8');
        assert.doesNotMatch(onDisk, /^human_approval: approved$/m);

        // P2: byte-unchanged, still paused, and the refusal says why.
        assert.equal(onDisk, yaml, 'a refusal must leave the file byte-unchanged');
        assert.equal(fs.existsSync(activePath(target)), false, 'a refusal must not move the ticket');
        assert.equal(outcome.status, 409);
        assert.equal(outcome.body.success, false);
        assert.ok(outcome.body.gate, 'the refusal must name the gate');
        assert.deepEqual(outcome.body.options, options, 'the refusal must carry every option label');
        assert.ok(String(outcome.body.detail || '').includes(ID), 'the refusal must not be a bare status');
      });
      return true;
    }),
    { numRuns: 3 }
  );

  assert.ok(reached > 0, 'never exercised the options-no-ruling shape');
});

test('BL-1380/BL-654 P3: a ticket with nothing left to choose expedites exactly as it does today', async () => {
  sweepFixtures();
  const reach = Object.fromEntries(SHAPES.slice(1).map((s) => [s, 0]));

  for (const shape of SHAPES.slice(1)) {
    await fc.assert(
      fc.asyncProperty(optionsArb, fc.nat({ max: 8 }), async (options, rulingIndex) => {
        await runShape(shape, options, rulingIndex, ({ target, ruling, outcome }) => {
          reach[shape] += 1;
          assert.equal(outcome.status, 200, `${shape} was refused: ${JSON.stringify(outcome.body)}`);
          assert.equal(fs.existsSync(activePath(target)), true, `${shape} was not promoted`);
          const promoted = fs.readFileSync(activePath(target), 'utf8');
          assert.match(promoted, /^priority:\s*0$/m);
          if (shape === 'options-with-ruling') {
            // Neither cleared nor rewritten.
            assert.match(promoted, new RegExp(`^human_ruling: ${ruling}$`, 'm'));
          } else {
            // BL-1083 stands: Expedite still SATISFIES the approval gate, and
            // a ticket that never posed a choice gains no ruling from the tap.
            assert.doesNotMatch(promoted, /^human_ruling:/m);
          }
        });
        return true;
      }),
      { numRuns: 3 }
    );
  }

  for (const shape of Object.keys(reach)) assert.ok(reach[shape] > 0, `never exercised the ${shape} shape`);
});
