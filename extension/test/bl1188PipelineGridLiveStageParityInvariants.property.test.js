const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { capturePipelineGridLive } = require('../out/bridge/pipelineGridLive');

// BL-1188 declared invariants, property-encoded against the REAL
// pipeline_stage_cli.bb subprocess (never mocked - BL-487/BL-814
// precedent). Runs only via `npm run test:properties`.
const REAL_SCRIPTS_DIR = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
const { computeClosure } = require(path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'operatorRuntimeBbClosure.js'));
const REQUIRED_SCRIPT_FILES = [...computeClosure(REAL_SCRIPTS_DIR, 'pipeline_stage_cli.bb')].sort();

const ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

function mkFixtureRoot() {
  const root = mkTmpDir('bl1188-prop-');
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of REQUIRED_SCRIPT_FILES) {
    fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(scriptsDir, name));
  }
  return root;
}

function worktreeFor(root, role) {
  return path.join(root, `${role}-worktree`);
}

function writeRolesTsv(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const rows = ROLES.map((role) => [role, role, worktreeFor(root, role), 'session', role, 'claude']);
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeActiveTicket(root, id) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: "fixture ticket"\nepic: code-quality-gates\ntype: chore\n`);
}

function claimAt(root, ticketId, role) {
  for (const r of ROLES) {
    fs.rmSync(path.join(worktreeFor(root, r), '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true, force: true });
  }
  const dir = path.join(worktreeFor(root, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '00_fixture.handoff'),
    `id: fixture\nfrom: architect\nto: ${role}\nrecipient: ${role}\npriority: 00\ntype: git_handoff\nrole: architect\ncommit: 0000000000\ntask: ${ticketId}-fixture\n\nRe-read your role and constitution.\n`
  );
}

function writeCache(root, ticketId, role) {
  const dir = path.join(root, '.swarmforge', 'board');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ticket-stage-map.json'), JSON.stringify({ [ticketId]: role }));
}

function matrixRow(boardText, ticketId) {
  const displayId = ticketId.replace(/^BL-/, '');
  const row = boardText.split('\n').find((l) => l.startsWith(`${displayId} `));
  assert.ok(row, `expected a rendered matrix row for ${ticketId}`);
  return row;
}

// Invariant 1: capturePipelineGridLive never uses the cache as its SOLE
// source of role-held tickets when a live report is available - proven by
// forcing live and cache to DISAGREE and asserting the render always
// follows live.
test('property (invariant 1): grid render follows the live claim, never the disagreeing cache, for every distinct role pair', () => {
  fc.assert(
    fc.property(
      fc.tuple(fc.constantFrom(...ROLES), fc.constantFrom(...ROLES)).filter(([live, cache]) => live !== cache),
      ([liveRole, cacheRole]) => {
        const root = mkFixtureRoot();
        writeRolesTsv(root);
        writeActiveTicket(root, 'BL-501');
        claimAt(root, 'BL-501', liveRole);
        writeCache(root, 'BL-501', cacheRole);

        const withDisagreeingCache = matrixRow(capturePipelineGridLive(root).boardText, 'BL-501');

        // Non-vacuity oracle: what the render would look like if the cache
        // agreed with live instead - proves this row shape is reachable and
        // that a real difference exists to detect (generator-reach floor).
        writeCache(root, 'BL-501', liveRole);
        const withAgreeingCache = matrixRow(capturePipelineGridLive(root).boardText, 'BL-501');

        assert.equal(withDisagreeingCache, withAgreeingCache, `live claim at ${liveRole} must render identically whether or not the cache (at ${cacheRole}) agrees`);
      }
    ),
    { numRuns: Math.min(20, ROLES.length * (ROLES.length - 1)) }
  );
});

// Invariant 2: on each capture tick the grid recomputes from live state - it
// never reuses a prior snapshot's stage marks. Proven over a random walk of
// 2-4 sequential live moves for one ticket, with the cache held constant and
// wrong throughout (so a memoized/cache-driven implementation would render
// every tick identically).
test('property (invariant 2): each tick reflects only the CURRENT live claim, never a prior tick, over random move sequences', () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...ROLES), { minLength: 2, maxLength: 4 }),
      (walk) => {
        const root = mkFixtureRoot();
        writeRolesTsv(root);
        writeActiveTicket(root, 'BL-502');
        // Cache constant and wrong for the whole walk - a stale/cached read
        // would make every tick below identical to each other.
        const cacheRole = ROLES.find((r) => r !== walk[0]);
        writeCache(root, 'BL-502', cacheRole);

        // Walk the sequence; consecutive DISTINCT roles must render
        // different rows (only two consecutive IDENTICAL roles legitimately
        // repeat a row - that is not a staleness bug).
        let prevRole;
        let prevRow;
        for (const role of walk) {
          claimAt(root, 'BL-502', role);
          const row = matrixRow(capturePipelineGridLive(root).boardText, 'BL-502');
          if (prevRole !== undefined && prevRole !== role) {
            assert.notEqual(row, prevRow, `tick for ${role} must differ from the prior tick's row for ${prevRole}`);
          }
          prevRole = role;
          prevRow = row;
        }
      }
    ),
    { numRuns: 15 }
  );
});

// Non-vacuity: prove the invariant-1 property would actually fail against a
// deliberately broken implementation (cache used as sole source, live
// ignored) - restore immediately after.
test('non-vacuity: invariant 1 property would catch a cache-only implementation', () => {
  const root = mkFixtureRoot();
  writeRolesTsv(root);
  writeActiveTicket(root, 'BL-503');
  claimAt(root, 'BL-503', 'hardender');
  writeCache(root, 'BL-503', 'documenter');
  const { readTicketStageMap, invertTicketStageToRoleHeldTickets } = require('../out/swarm/swarmState');
  const { readBacklogFolders } = require('../out/panel/backlogReader');
  const { computePipelineBoard, renderPipelineBoardGridOnly } = require('../out/concierge/pipelineBoard');

  // Simulates the PRE-BL-1188 cache-only implementation directly.
  const folders = readBacklogFolders(root);
  const ticketMeta = {};
  for (const item of folders.active) {
    ticketMeta[item.id] = { epic: item.epic, type: item.type, title: item.title, filename: item.filename, location: 'active' };
  }
  const roleHeld = invertTicketStageToRoleHeldTickets(readTicketStageMap(root));
  const data = computePipelineBoard(roleHeld, [], ticketMeta, { activeIds: folders.active.map((i) => i.id) });
  const cacheOnlyRow = matrixRow(renderPipelineBoardGridOnly(data), 'BL-503');
  const liveRow = matrixRow(capturePipelineGridLive(root).boardText, 'BL-503');

  assert.notEqual(cacheOnlyRow, liveRow, 'a cache-only implementation must diverge from the fixed live-preferring one for this fixture');
});
