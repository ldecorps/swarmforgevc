'use strict';

// BL-1683's declared invariant (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   "A path renamed on the forwarded side is judged by its content at
//    the new path: the guard reports a drop for it only when a line the
//    received side added uncontested is absent from the new-path blob,
//    never because the old path is gone."
//
// Drives the REAL swarmforge/scripts/merge_drop_guard_lib.bb against real
// git fixtures (commit-tree-built merges, the established convention -
// bl1576MergeDropGuardSteps.js) - never a JavaScript restatement of the
// hunk parsing, the contested-check, or the rename map.
//
// GENERATOR REACH (reached by construction, never by draw). The full
// 2x2 matrix: renamed-vs-unrenamed crossed with clean-vs-dropped. A
// generator that only ever exercised the renamed shapes would prove
// nothing about the guard's PRE-EXISTING behaviour (BL-1576's own
// unrenamed drop must still refuse) surviving this ticket's own change;
// one that only ever exercised "clean" would prove nothing about a real
// drop at a renamed path still being caught.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'merge_drop_guard_lib.bb');
const OLD_PATH = 'backlog/paused/BL-0001-ticket.yaml';
const NEW_PATH = 'backlog/active/BL-0001-ticket.yaml';
const STUB = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

function twentyLines() {
  return Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function head(cwd) {
  return gitOut(cwd, ['rev-parse', 'HEAD']);
}

function commit(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message]);
}

function writeLines(root, relPath, lines) {
  fs.mkdirSync(path.dirname(path.join(root, relPath)), { recursive: true });
  fs.writeFileSync(path.join(root, relPath), `${lines.join('\n')}\n`);
}

function findingsBetween(root, received, forwarded) {
  const out = execFileSync('bb', [LIB, root, received, forwarded], { encoding: 'utf8' }).trim();
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// Builds the shared fixture: a stub base, a `received` branch replacing the
// stub's first line with twenty lines, and a `main` branch (independent of
// received) that either renames the path (promotion shape) or edits it in
// place (BL-1576's own pre-existing shape) while appending one line at the
// stub's LAST line - a base position disjoint from received's own edit, so
// the guard's contested-hunk check never conflates the two (see the step
// handler's own note on this).
function buildFixture(renamed) {
  const root = mkTmpDir('bl1683-property-');
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeLines(root, OLD_PATH, STUB);
  commit(root, 'stub base');
  const baseSha = head(root);

  git(root, ['checkout', '-q', '-b', 'received', baseSha]);
  writeLines(root, OLD_PATH, [...twentyLines(), ...STUB.slice(1)]);
  commit(root, 'BL-0001: add ticket content');
  const receivedSha = head(root);

  git(root, ['checkout', '-q', '-b', 'mainside', baseSha]);
  const activePath = renamed ? NEW_PATH : OLD_PATH;
  if (renamed) {
    fs.mkdirSync(path.dirname(path.join(root, NEW_PATH)), { recursive: true });
    git(root, ['mv', OLD_PATH, NEW_PATH]);
  }
  writeLines(root, activePath, [...STUB, 'line 21']);
  commit(root, renamed ? 'Promote BL-0001: paused -> active' : 'BL-0001: append line 21 in place');
  const senderSha = head(root);

  return { root, baseSha, receivedSha, senderSha, activePath };
}

function buildMerge({ root, senderSha, receivedSha, activePath }, activeLines) {
  git(root, ['checkout', '-q', 'mainside']);
  writeLines(root, activePath, activeLines);
  git(root, ['add', '-A']);
  const treeSha = gitOut(root, ['write-tree']);
  const mergeSha = gitOut(root, ['commit-tree', treeSha, '-p', senderSha, '-p', receivedSha, '-m', 'Merge received into forwarding.']);
  return mergeSha;
}

const SHAPES = [
  { renamed: true, dropped: false, name: 'renamed-clean' },
  { renamed: true, dropped: true, name: 'renamed-dropped' },
  { renamed: false, dropped: false, name: 'unrenamed-clean' },
  { renamed: false, dropped: true, name: 'unrenamed-dropped' },
];

test('BL-1683/BL-654 invariant: a renamed path is judged by its content at the new path - a real drop is still refused, a content-preserving rename is not', () => {
  const RUNS = runsPerCell(3 * SHAPES.length, SHAPES.length);
  const reach = Object.fromEntries(SHAPES.map((s) => [s.name, 0]));

  for (const shape of SHAPES) {
    fc.assert(
      fc.property(fc.constant(shape), ({ renamed, dropped, name }) => {
        reach[name] += 1;
        const fixture = buildFixture(renamed);
        try {
          const lines = dropped
            ? twentyLines().filter((_, i) => ![5, 10, 15].includes(i + 1))
            : twentyLines();
          const mergeSha = buildMerge(fixture, [...lines, ...STUB.slice(1), 'line 21']);
          const findings = findingsBetween(fixture.root, fixture.receivedSha, mergeSha);
          const blocking = findings.filter((f) => !f.excused);

          if (dropped) {
            assert.equal(blocking.length, 1, `expected one blocking finding for ${name}, got: ${JSON.stringify(findings)}`);
            assert.equal(blocking[0].lines, 3, `expected 3 lines lost for ${name}, got: ${JSON.stringify(blocking[0])}`);
            assert.equal(blocking[0].path, fixture.activePath, `expected the finding at ${fixture.activePath} for ${name}, got: ${JSON.stringify(blocking[0])}`);
          } else {
            assert.deepEqual(blocking, [], `expected no blocking finding for ${name}, got: ${JSON.stringify(findings)}`);
          }
          return true;
        } finally {
          fs.rmSync(fixture.root, { recursive: true, force: true });
        }
      }),
      { numRuns: RUNS },
    );
  }

  assertReachFloor(reach, SHAPES.map((s) => s.name), RUNS, 'rename x drop shape');
});
