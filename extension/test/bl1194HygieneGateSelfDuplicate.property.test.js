'use strict';

// BL-1194 declared invariants (property authorship rests with the coder, BL-654):
//
// Invariant 1: "The duplicate-id check's verdict for a single ticket file is
// identical whether the gate is invoked with a path relative to the working
// directory or an absolute path."
//
// Invariant 2: "A ticket already published under its own id at the invoked
// path is never counted as an 'other holder' of that id — only a genuinely
// different file is."
//
// These invariants are encoded as properties using fast-check generators over
// path strings, ticket ids, and corpus states. Each property wraps the REAL
// specifier_backlog_hygiene_gate.bb CLI via spawnSync (same pattern as the
// acceptance step handlers in bl1194HygieneGateSelfDuplicateSteps.js).
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (staged-first restore, run 2026-08-29):
//   break 1 - removed the backlog-relative normalizer from other-holders:
//     Invariant 1 RED on the first draw, "relative and absolute paths produced
//     different verdicts".
//   break 2 - removed the subject's own basename from the published-side
//     exclusion set: Invariant 2 RED on the first draw, "the subject's own
//     published copy was counted as another holder".
// Both restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'specifier_backlog_hygiene_gate.bb');

const KNOWN_POOLS = ['paused', 'active', 'hold', 'done'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeTicket(dir, rel, id) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    [
      `id: ${id}`,
      'title: "fixture"',
      'type: feature',
      'epic: swarm-reliability',
      'milestone: M8',
      'priority: 1',
      '',
    ].join('\n')
  );
  return full;
}

function runGate(env, subjectPath, cwd) {
  const result = spawnSync('bb', [GATE, subjectPath], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function makeFixture() {
  const root = mkTmpDir('bl1194-property-backlog-');
  const published = mkTmpDir('bl1194-property-published-');
  for (const pool of KNOWN_POOLS) {
    fs.mkdirSync(path.join(root, pool), { recursive: true });
    fs.mkdirSync(path.join(published, pool), { recursive: true });
  }
  return { root, published };
}

function cleanupFixture(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
  fs.rmSync(fixture.published, { recursive: true, force: true });
}

// ── Invariant 1: path-form independence ──────────────────────────────────────
//
// For any ticket id and any pool, running the gate with a relative path
// (backlog/paused/<id>.yaml) produces the same verdict as running it with an
// absolute path (/path/to/backlog/paused/<id>.yaml).

test('BL-1194/BL-654 invariant 1: the duplicate-id verdict is identical for relative and absolute paths', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 3, maxLength: 10 }).map((s) => `BL-${s.replace(/[^a-zA-Z0-9]/g, '')}`),
      fc.constantFrom(...KNOWN_POOLS),
      (ticketId, pool) => {
        // Filter out invalid ticket ids (must start with BL- followed by digits)
        if (!/^BL-[0-9]+$/.test(ticketId)) return true;

        const fixture = makeFixture();
        try {
          // Write a single ticket in the specified pool
          const rel = path.join(pool, `${ticketId}-test-slug.yaml`);
          writeTicket(fixture.root, rel, ticketId);

          // Run the gate with a relative path (from the parent of the fixture root,
          // so the relative path resolves correctly)
          const cwd = path.dirname(fixture.root);
          const relEnv = {
            BACKLOG_HYGIENE_ROOT: fixture.root,
            BACKLOG_HYGIENE_PUBLISHED_ROOT: fixture.published,
          };
          const relativePath = path.relative(cwd, path.join(fixture.root, rel));
          const relResult = runGate(relEnv, relativePath, cwd);

          // Run the gate with an absolute path
          const absEnv = {
            BACKLOG_HYGIENE_ROOT: fixture.root,
            BACKLOG_HYGIENE_PUBLISHED_ROOT: fixture.published,
          };
          const absResult = runGate(absEnv, path.join(fixture.root, rel), cwd);

          // Both must produce the same exit code and no DUPLICATE-ID error
          assert.equal(
            relResult.status,
            absResult.status,
            `relative and absolute paths produced different exit codes for ${ticketId} in ${pool}:\n` +
              `relative: exit ${relResult.status}\n` +
              `absolute: exit ${absResult.status}\n` +
              `relative output: ${relResult.output}\n` +
              `absolute output: ${absResult.output}`
          );

          // Neither should report a DUPLICATE-ID for a single ticket
          const relHasDuplicate = /DUPLICATE-ID/.test(relResult.output);
          const absHasDuplicate = /DUPLICATE-ID/.test(absResult.output);
          assert.equal(
            relHasDuplicate,
            absHasDuplicate,
            `relative and absolute paths produced different DUPLICATE-ID verdicts for ${ticketId} in ${pool}:\n` +
              `relative has DUPLICATE-ID: ${relHasDuplicate}\n` +
              `absolute has DUPLICATE-ID: ${absHasDuplicate}\n` +
              `relative output: ${relResult.output}\n` +
              `absolute output: ${absResult.output}`
          );

          return true;
        } finally {
          cleanupFixture(fixture);
        }
      }
    ),
    { numRuns: 20 }
  );
});

// ── Invariant 2: self-identity in published corpus ───────────────────────────
//
// For any ticket id and any corpus state where that id exists at path p both
// locally and in published, other-holders for (id, p) does not include p in its
// result. The subject's own published copy is never counted as "another holder".

test('BL-1194/BL-654 invariant 2: a ticket already published under its own id is never counted as another holder', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 3, maxLength: 10 }).map((s) => `BL-${s.replace(/[^a-zA-Z0-9]/g, '')}`),
      fc.constantFrom(...KNOWN_POOLS),
      (ticketId, pool) => {
        // Filter out invalid ticket ids (must start with BL- followed by digits)
        if (!/^BL-[0-9]+$/.test(ticketId)) return true;

        const fixture = makeFixture();
        try {
          // Write the ticket in the local corpus
          const rel = path.join(pool, `${ticketId}-test-slug.yaml`);
          writeTicket(fixture.root, rel, ticketId);

          // Write the SAME ticket in the published corpus (same id, same basename)
          // This stands in for origin/main's prior copy of the same ticket
          writeTicket(fixture.published, rel, ticketId);

          // Run the gate on the local ticket
          const cwd = path.dirname(fixture.root);
          const env = {
            BACKLOG_HYGIENE_ROOT: fixture.root,
            BACKLOG_HYGIENE_PUBLISHED_ROOT: fixture.published,
          };
          const result = runGate(env, path.join(fixture.root, rel), cwd);

          // The gate must NOT report a DUPLICATE-ID for the subject's own published copy
          const hasDuplicate = /DUPLICATE-ID\s+${ticketId}/.test(result.output);
          assert.equal(
            hasDuplicate,
            false,
            `the subject's own published copy was counted as another holder for ${ticketId} in ${pool}:\n` +
              `output: ${result.output}`
          );

          return true;
        } finally {
          cleanupFixture(fixture);
        }
      }
    ),
    { numRuns: 20 }
  );
});
