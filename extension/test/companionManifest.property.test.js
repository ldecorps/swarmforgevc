'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { listCompanionPackages, readCompanionPackage } = require('../out/bridge/companionManifest');

// BL-866 declared invariants (property authorship rests with the coder
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).

function mkTmp() {
  return mkTmpDir('sfvc-companion-manifest-prop-');
}

function writeTicket(target, id, title) {
  const dir = path.join(target, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: "${title}"\nstatus: todo\n`);
}

function removeTicket(target, id) {
  const filePath = path.join(target, 'backlog', 'active', `${id}.yaml`);
  fs.rmSync(filePath, { force: true });
}

// ─── Invariant 1: "A served package body and the generation it carries
// always agree — a client caching by generation never holds content from a
// different generation." ───
//
// The risk this guards against is a generation that does NOT move when the
// content actually changed (a client would then wrongly treat stale cached
// content as current). Rather than drawing two independent random backlog
// states (most pairs would differ trivially and prove nothing about
// sensitivity), each generated pair is CONSTRUCTED as a before/after: start
// from a random backlog state, then apply one concrete content-changing
// mutation (add a ticket, rename a ticket, or remove a ticket) to derive
// the "after" state. Every generated pair is therefore a collision
// candidate by construction - if the mutation didn't move the generation,
// that's exactly the bug this invariant exists to catch.
const ticketIdArb = fc.integer({ min: 1, max: 999 }).map((n) => `BL-${n}`);
const titleArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/["\n\\]/.test(s));
const seedTicketsArb = fc.uniqueArray(
  fc.tuple(ticketIdArb, titleArb),
  { minLength: 1, maxLength: 5, selector: ([id]) => id }
);
const mutationArb = fc.constantFrom('add', 'rename', 'remove');

test('property (BL-866 invariant 1): a content-changing mutation always moves the generation', () => {
  fc.assert(
    fc.property(seedTicketsArb, mutationArb, ticketIdArb, titleArb, (seedTickets, mutation, extraId, extraTitle) => {
      const target = mkTmp();
      for (const [id, title] of seedTickets) {
        writeTicket(target, id, title);
      }

      const before = readCompanionPackage(target, 'backlog', null);
      assert.equal(before.status, 'ok');

      const seedIds = seedTickets.map(([id]) => id);
      if (mutation === 'add') {
        const freshId = seedIds.includes(extraId) ? `${extraId}-fresh` : extraId;
        writeTicket(target, freshId, extraTitle);
      } else if (mutation === 'rename') {
        const [targetId, currentTitle] = seedTickets[0];
        writeTicket(target, targetId, currentTitle === extraTitle ? `${extraTitle}-changed` : extraTitle);
      } else {
        removeTicket(target, seedTickets[0][0]);
      }

      const after = readCompanionPackage(target, 'backlog', null);
      assert.equal(after.status, 'ok');
      assert.notEqual(after.generation, before.generation, `mutation "${mutation}" left the generation unchanged`);

      // Agreement: re-reading the SAME (unmutated-since) state reproduces
      // the exact same generation the previous response carried - the
      // generation is a pure function of what is about to be served, not
      // of when it is asked.
      const reread = readCompanionPackage(target, 'backlog', null);
      assert.equal(reread.generation, after.generation);
    }),
    { numRuns: 60 }
  );
});

// ─── Invariant 2: "The manifest never advertises a package the bridge
// cannot serve, and a package that became unreadable is refused rather
// than served empty." ───
//
// Generator reach: each of the 5 vision-doc source files (docsTree.ts's
// VISION_DOCS) is independently present or absent, so both extremes (all
// absent -> unreadable, at least one present -> readable) and every mixed
// combination in between are reachable, not just a hand-picked pair.
const VISION_DOC_RELATIVE_PATHS = [
  'docs/reference/Specification.MD',
  'docs/explanation/Milestone Roadmap.MD',
  'docs/tutorials/GettingStarted.md',
  'docs/diagrams/architecture.mmd',
  'docs/diagrams/swarm-flow.mmd',
];
const presenceArb = fc.array(fc.boolean(), { minLength: VISION_DOC_RELATIVE_PATHS.length, maxLength: VISION_DOC_RELATIVE_PATHS.length });

test('property (BL-866 invariant 2): the docs package is listed and servable iff at least one of its sources is actually readable, never served empty otherwise', () => {
  fc.assert(
    fc.property(presenceArb, (presence) => {
      const target = mkTmp();
      // anyPresent is ground truth computed by the TEST from what it wrote
      // to disk - deliberately NOT derived by calling the code under test,
      // so a bug that makes listCompanionPackages and readCompanionPackage
      // agree with EACH OTHER while both being wrong (e.g. neither ever
      // refuses an empty read) is still caught, not hidden by comparing two
      // outputs of the same broken read() to each other.
      let anyPresent = false;
      VISION_DOC_RELATIVE_PATHS.forEach((relativePath, i) => {
        if (presence[i]) {
          anyPresent = true;
          const filePath = path.join(target, relativePath);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, `content ${i}`);
        }
      });

      const listed = listCompanionPackages(target).some((p) => p.name === 'docs');
      const direct = readCompanionPackage(target, 'docs', null);

      assert.equal(listed, anyPresent, 'manifest listing must reflect actual source availability');
      assert.equal(direct.status === 'ok', anyPresent, 'direct servability must reflect actual source availability');
      if (!anyPresent) {
        assert.equal(direct.status, 'unreadable');
        assert.equal('data' in direct, false, 'an unreadable package must never be served as empty content');
      }
    }),
    { numRuns: 60 }
  );
});
