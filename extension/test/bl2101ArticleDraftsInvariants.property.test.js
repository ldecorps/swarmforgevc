'use strict';

// BL-2101's two declared invariants, coder-authored (BL-654), property lane
// only.
//
// Invariant 1 - "A draft page request never reads a file outside the
// project's .swarmforge/operator/ and never one whose name is not
// DRAFT-linkedin-*.md."
//
//   Built over the REAL filesystem (a mkTmpDir fixture), never mocked,
//   because the only thing worth proving is what buildArticleDraftPageState
//   actually does with a path. Reach is BY CONSTRUCTION over the attack
//   shapes the ticket names (traversal, an absolute path, a non-draft file
//   that genuinely exists in the operator directory, a well-formed name
//   with no backing file) crossed with fast-check's arbitrary strings for
//   the "neither" case - a uniform draw over random strings would almost
//   never land on an existing path, so it is additional noise around the
//   constructed candidates, not a replacement for them.
//
//   Non-leakage is checked by planting a canary file OUTSIDE the operator
//   directory (both just outside it and outside the project root entirely)
//   and asserting its content never appears in any result, successful or
//   refused.
//
// Invariant 2 - "Every article drafts route is a read-only GET, and the
// JSON feeds answer only a request that carries the bridge token."
//
//   The read-only-GET half is NEW pure logic this ticket adds
//   (articleDraftsRoutesAreReadOnly) and is encoded below the same way
//   operatorDocsReadOnly.property.test.js encodes the sibling feature's
//   identical shape.
//
//   The token-gating half is deliberately NOT restated here
//   (BL-654 "when a declared invariant admits no executable encoding ...
//   record a stated reason"): this ticket introduces no new
//   token-comparison logic. The article-drafts feed routes are wired into
//   bridgeServer's existing isAuthorizedForRead/QUERY_TOKEN_ELIGIBLE_PATHS
//   gate - the SAME pure bridgeAuth functions every other feed route uses,
//   already exercised generically (see bl1116ExtensionWipHotfixStampOff's
//   bridgeAuth coverage) - and the wiring itself is exercised end-to-end,
//   with and without the token, by the deterministic acceptance scenario
//   "BL-2101 article-drafts-page-04". A property test here would restate
//   bridgeAuth's own invariant against code this ticket did not write.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const {
  buildArticleDraftPageState,
} = require('../out/bridge/articleDraftsHtml');
const {
  articleDraftsRoutesAreReadOnly,
  ARTICLE_DRAFTS_READ_ROUTE_PATHS,
} = require('../out/bridge/articleDraftsCore');

const CANARY_OUTSIDE_OPERATOR = 'CANARY-BL2101-OUTSIDE-OPERATOR-DIR';
const CANARY_OUTSIDE_ROOT = 'CANARY-BL2101-OUTSIDE-PROJECT-ROOT';
const REAL_DRAFT_BODY = 'Real draft body line, BL-2101 fixture.';

function pageQuery(file) {
  return '/article-drafts-page?file=' + encodeURIComponent(file);
}

describe('BL-2101 invariant 1: never reads outside .swarmforge/operator/, never a non-DRAFT-linkedin name', () => {
  it('refuses every escape shape and never leaks a canary planted outside the operator directory', () => {
    const root = mkTmpDir('bl2101-inv1-');
    const outsideRoot = mkTmpDir('bl2101-inv1-outside-');
    try {
      const operatorDir = path.join(root, '.swarmforge', 'operator');
      fs.mkdirSync(operatorDir, { recursive: true });
      fs.writeFileSync(path.join(operatorDir, 'DRAFT-linkedin-real-draft.md'), `---\n\n${REAL_DRAFT_BODY}\n`);
      fs.writeFileSync(path.join(operatorDir, 'NOTE-linkedin-not-a-draft.md'), 'not a draft, never served');
      // A canary just outside the operator directory, but still inside the
      // project root (the first boundary a path-join bug would cross).
      fs.writeFileSync(path.join(root, '.swarmforge', 'canary.txt'), CANARY_OUTSIDE_OPERATOR);
      // A canary entirely outside the project root (the second boundary).
      fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), CANARY_OUTSIDE_ROOT);

      const CANDIDATES = {
        realDraft: { file: 'DRAFT-linkedin-real-draft.md', expect: 'success' },
        existingNonDraft: { file: 'NOTE-linkedin-not-a-draft.md', expect: 'invalid draft file' },
        missingWellFormedName: { file: 'DRAFT-linkedin-does-not-exist.md', expect: 'draft not found' },
        traversalToSiblingCanary: { file: '../canary.txt', expect: 'invalid draft file' },
        traversalToOutsideRootCanary: {
          file: '../../' + path.relative(path.dirname(path.dirname(outsideRoot)), path.join(outsideRoot, 'secret.txt')),
          expect: 'invalid draft file',
        },
        encodedTraversal: { file: '..%2Fcanary.txt', expect: 'invalid draft file' },
        absolutePath: { file: path.join(outsideRoot, 'secret.txt'), expect: 'invalid draft file' },
        emptyFile: { file: '', expect: 'invalid draft file' },
        backslashTraversal: { file: '..\\canary.txt', expect: 'invalid draft file' },
      };
      const FLOOR = runsPerCell(135, Object.keys(CANDIDATES).length);
      const coverage = {};

      for (const [name, candidate] of Object.entries(CANDIDATES)) {
        fc.assert(
          fc.property(fc.constant(name), (caseName) => {
            coverage[caseName] = (coverage[caseName] || 0) + 1;
            const result = buildArticleDraftPageState(root, pageQuery(candidate.file));
            if (candidate.expect === 'success') {
              assert.ok(!result.error, `${caseName} unexpectedly refused: ${result.error}`);
              assert.match(result.html, /Real draft body line/);
            } else {
              assert.equal(result.error, candidate.expect, `${caseName} refused with the wrong reason`);
            }
            const serialized = JSON.stringify(result);
            assert.ok(!serialized.includes(CANARY_OUTSIDE_OPERATOR), `${caseName} leaked the sibling-of-operator canary`);
            assert.ok(!serialized.includes(CANARY_OUTSIDE_ROOT), `${caseName} leaked the outside-project-root canary`);
            return true;
          }),
          { numRuns: FLOOR }
        );
      }
      assertReachFloor(coverage, Object.keys(CANDIDATES), FLOOR, 'article-drafts page-request candidate');

      // Arbitrary strings, for breadth beyond the constructed candidates
      // above - most never name an existing file at all, which is itself
      // part of what is being proven (an arbitrary string never reads a
      // canary, never crashes, and is always refused with one of the two
      // known reasons unless it happens to be the one real draft name).
      fc.assert(
        fc.property(fc.string(), (file) => {
          const result = buildArticleDraftPageState(root, pageQuery(file));
          const serialized = JSON.stringify(result);
          assert.ok(!serialized.includes(CANARY_OUTSIDE_OPERATOR));
          assert.ok(!serialized.includes(CANARY_OUTSIDE_ROOT));
          if (result.error) {
            assert.ok(result.error === 'invalid draft file' || result.error === 'draft not found');
          } else {
            assert.equal(file, 'DRAFT-linkedin-real-draft.md');
          }
          return true;
        }),
        { numRuns: 200 }
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

describe('BL-2101 invariant 2 (read-only half): article-drafts routes never accept a write method', () => {
  it('holds for every combination of write methods layered onto the real route set', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...WRITE_METHODS), { minLength: 0, maxLength: 4 }),
        fc.array(fc.constantFrom(...WRITE_METHODS), { minLength: 0, maxLength: 4 }),
        fc.array(fc.constantFrom(...WRITE_METHODS), { minLength: 0, maxLength: 4 }),
        (shellWrites, indexWrites, pageWrites) => {
          const methodsByPath = new Map([
            ['/article-drafts', new Set(['GET', ...shellWrites])],
            ['/article-drafts-index', new Set(['GET', ...indexWrites])],
            ['/article-drafts-page', new Set(['GET', ...pageWrites])],
            ['/gate-answer', new Set(['POST'])],
          ]);
          const hasWrite = [...ARTICLE_DRAFTS_READ_ROUTE_PATHS].some((routePath) => {
            const methods = methodsByPath.get(routePath) ?? new Set();
            return [...methods].some((method) => WRITE_METHODS.includes(method));
          });
          assert.equal(articleDraftsRoutesAreReadOnly(methodsByPath), !hasWrite);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
