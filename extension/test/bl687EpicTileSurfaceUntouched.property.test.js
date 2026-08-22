const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startBridge } = require('../out/bridge/bridgeServer');
const { mkTmpDir } = require('./helpers/tmpDir');

const TOKEN = 'bl687-invariant3-token';

// BL-687/BL-654: coder-authored property test for declared invariant 3 -
// "The epic-tile surface is untouched: for every backlog state, the tiles
// listed, their order, and the domination set of the epic-level Make top
// verb (BL-672) are exactly what they were before this ticket." Runs ONLY
// via `npm run test:properties`.
//
// Unlike invariants 1/2 (pure, in-memory), this one is about an HTTP-level
// behavior (the /epic-reorder-state tile list and the /epic-reorder/make-top
// route) that bridgeServer.ts deliberately keeps wired to the UNCHANGED
// readLiveBacklogItems/readPausedEpics readers - so the oracle here is a
// real bridge server against a real git fixture, run TWICE per property case
// (with vs without a generated active/ folder) and diffed. numRuns is kept
// modest given the real subprocess+HTTP cost per run.
//
// Reachability is by CONSTRUCTION: the generated active/done extras always
// include at least one item sharing the target epic's own `epic:` slug and
// at least one whose priority would outrank the epic if it were (wrongly)
// included in the domination set - exactly the shape that would expose a
// leak of the within-epic widened reader into the epic-tile route.

function mkFixtureRoot() {
  const root = mkTmpDir('sfvc-bl687-inv3-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: root });
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const repoScriptsDir = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
  for (const name of fs.readdirSync(repoScriptsDir)) {
    if (name.endsWith('.bb')) {
      fs.copyFileSync(path.join(repoScriptsDir, name), path.join(scriptsDir, name));
    }
  }
  return root;
}

function writeTicket(root, folder, id, extraFields) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [`id: ${id}`, `title: ${id} title`, ...extraFields];
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `${lines.join('\n')}\n`);
}

function commitAll(root, message) {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: root });
}

function readPriority(root, folder, id) {
  const content = fs.readFileSync(path.join(root, 'backlog', folder, `${id}.yaml`), 'utf8');
  const match = content.match(/^priority:\s*(-?\d+)$/m);
  return match ? Number(match[1]) : undefined;
}

async function withBridge(root, fn) {
  const handle = await startBridge(root, path.join(root, 'runs.jsonl'), TOKEN, {});
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

function controlAuthHeaders() {
  return { authorization: `Bearer ${TOKEN}`, 'x-control-token': TOKEN, 'content-type': 'application/json' };
}

async function fetchTiles(handle) {
  const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder-state?token=${TOKEN}`);
  const body = await res.json();
  return body.items.map((i) => ({ id: i.id, priority: i.priority }));
}

async function postMakeTop(handle, id) {
  const res = await fetch(`http://127.0.0.1:${handle.port}/epic-reorder/make-top`, {
    method: 'POST',
    headers: controlAuthHeaders(),
    body: JSON.stringify({ id }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// A fixed, deterministic paused/hold fixture: one target epic (E1) at a
// modest priority, plus a paused sibling epic and a paused/hold topic - the
// same shape BL-672's own bridge tests use.
function seedBaseFixture(root) {
  writeTicket(root, 'paused', 'E1', ['type: epic', 'priority: 5', 'epic: base-slug']);
  writeTicket(root, 'paused', 'E2', ['type: epic', 'priority: 0']);
  writeTicket(root, 'paused', 'T1', ['type: feature', 'priority: 1', 'epic: base-slug']);
  writeTicket(root, 'hold', 'T2', ['type: feature', 'priority: 2']);
  commitAll(root, 'seed base fixture');
}

const activeExtraArb = fc.record({
  id: fc.constantFrom('X1', 'X2', 'X3'),
  // Priority far below the whole fixture's range - if active/ ever leaked
  // into the domination set, this would outrank E1 and change the tile
  // list's order or the make-top outcome.
  priority: fc.integer({ min: -5, max: -1 }),
  sameEpicSlug: fc.boolean(),
});

const doneExtraArb = fc.record({
  id: fc.constantFrom('D1', 'D2'),
  priority: fc.integer({ min: -5, max: -1 }),
});

test(
  'BL-687 property: invariant 3 - active/done content never changes the epic tile list, its order, or the epic-level make-top outcome',
  async () => {
    let sawSameEpicSlugActiveExtra = false;
    let sawCrossEpicActiveExtra = false;

    // Baseline (no active/done extras) is fixed across every property run -
    // one fixture, one bridge session, computed once - since it never
    // varies with the generated input. Only the treatment side (which DOES
    // vary per run) needs its own fixture+bridge per iteration.
    const baselineRoot = mkFixtureRoot();
    seedBaseFixture(baselineRoot);
    const baseline = await withBridge(baselineRoot, async (handle) => {
      const tiles = await fetchTiles(handle);
      const makeTop = await postMakeTop(handle, 'E1');
      return { tiles, changed: makeTop.body.changed };
    });
    const baselineFinalPriorities = { E1: readPriority(baselineRoot, 'paused', 'E1'), E2: readPriority(baselineRoot, 'paused', 'E2') };
    fs.rmSync(baselineRoot, { recursive: true, force: true });

    await fc.assert(
      fc.asyncProperty(
        fc.array(activeExtraArb, { minLength: 1, maxLength: 2 }),
        fc.array(doneExtraArb, { minLength: 0, maxLength: 2 }),
        async (activeExtras, doneExtras) => {
          const uniqueActive = [...new Map(activeExtras.map((a) => [a.id, a])).values()];
          const uniqueDone = [...new Map(doneExtras.map((d) => [d.id, d])).values()];

          const treatmentRoot = mkFixtureRoot();
          seedBaseFixture(treatmentRoot);
          const activeExtraContentBefore = new Map();
          for (const extra of uniqueActive) {
            const fields = ['type: feature', `priority: ${extra.priority}`];
            if (extra.sameEpicSlug) {
              fields.push('epic: base-slug');
              sawSameEpicSlugActiveExtra = true;
            } else {
              sawCrossEpicActiveExtra = true;
            }
            writeTicket(treatmentRoot, 'active', extra.id, fields);
            activeExtraContentBefore.set(extra.id, fs.readFileSync(path.join(treatmentRoot, 'backlog', 'active', `${extra.id}.yaml`), 'utf8'));
          }
          for (const extra of uniqueDone) {
            writeTicket(treatmentRoot, 'done', extra.id, ['type: feature', `priority: ${extra.priority}`, 'epic: base-slug']);
          }
          commitAll(treatmentRoot, 'seed active/done extras');

          const treatment = await withBridge(treatmentRoot, async (handle) => {
            const tiles = await fetchTiles(handle);
            const makeTop = await postMakeTop(handle, 'E1');
            return { tiles, changed: makeTop.body.changed };
          });
          const treatmentFinalPriorities = { E1: readPriority(treatmentRoot, 'paused', 'E1'), E2: readPriority(treatmentRoot, 'paused', 'E2') };

          assert.deepEqual(treatment.tiles, baseline.tiles, 'expected the epic tile list/order to be unaffected by active/done content');
          assert.equal(treatment.changed, baseline.changed, 'expected the make-top verdict to be unaffected');
          assert.deepEqual(
            treatmentFinalPriorities,
            baselineFinalPriorities,
            'expected the epic-level make-top domination set (BL-672) to be unaffected by active/done content'
          );

          // The decisive, most sensitive oracle: an active/ file's content
          // (not merely its presence/folder) must be byte-IDENTICAL after
          // the epic-tile make-top runs - if active/ ever leaked into the
          // domination set, a displaced item's `priority:` line would be
          // rewritten even while the file stayed in backlog/active/, which
          // the weaker "still exists" check alone would miss entirely.
          for (const extra of uniqueActive) {
            const after = fs.readFileSync(path.join(treatmentRoot, 'backlog', 'active', `${extra.id}.yaml`), 'utf8');
            assert.equal(
              after,
              activeExtraContentBefore.get(extra.id),
              `expected ${extra.id}'s backlog/active/ file to be byte-identical - the epic-tile route must never read OR write active/`
            );
          }

          fs.rmSync(treatmentRoot, { recursive: true, force: true });
        }
      ),
      { numRuns: 6 }
    );

    assert.ok(sawSameEpicSlugActiveExtra, "reachability floor: generator never produced an active extra sharing the target epic's own slug");
    assert.ok(sawCrossEpicActiveExtra, 'reachability floor: generator never produced a cross-epic/epic-less active extra');
  },
  60000
);
