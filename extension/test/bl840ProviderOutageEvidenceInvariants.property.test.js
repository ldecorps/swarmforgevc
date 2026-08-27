'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-840 invariants (property authorship rests with the coder, first pass -
// BL-654). Drives the REAL Babashka functions via
// bl840_provider_outage_evidence_acceptance_runner.bb (same JSON-bridge
// pattern the ticket's own acceptance step handlers use) - never a
// reimplementation of the throttle/attribution/subtraction logic in JS.
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl840_provider_outage_evidence_acceptance_runner.bb');

function run(subcommand, payload) {
  const out = execFileSync('bb', [RUNNER, subcommand, JSON.stringify(payload)], { encoding: 'utf8' });
  return JSON.parse(out);
}

// ── Invariant 1 ──────────────────────────────────────────────────────────
// "Absent, empty, unreadable or corrupt provider-outage evidence subtracts
// nothing: effective age is exactly BL-650's ledger-only result (here,
// wall clock, since the ledger itself contributes nothing per the
// feature's own Background), and the sweep completes without error."
//
// Generator reach: crosses all three of the ticket's own named evidence
// states (missing/empty/corrupt) with randomized enqueue times up to 12h
// wall age and a randomized role/provider pairing.
const evidenceStateArb = fc.constantFrom('missing', 'empty', 'corrupt');
const wallAgeMinutesArb = fc.integer({ min: 0, max: 720 });
const roleArb = fc.constantFrom('coder', 'cleaner', 'architect');
const providerArb = fc.constantFrom('anthropic', 'openrouter', 'openai');

test(
  'property (invariant 1): unreadable provider-outage evidence subtracts nothing and the sweep never errors',
  () => {
    fc.assert(
      fc.property(evidenceStateArb, wallAgeMinutesArb, roleArb, providerArb, (evidenceState, wallAgeMinutes, role, provider) => {
        const sweepAtMs = Date.parse('2026-08-07T10:00:00Z');
        const enqueuedAtMs = sweepAtMs - wallAgeMinutes * 60 * 1000;
        const result = run('sweep-parcel', {
          role,
          roleProvider: provider,
          enqueuedAt: new Date(enqueuedAtMs).toISOString(),
          sweepAt: new Date(sweepAtMs).toISOString(),
          evidenceState,
        });
        assert.equal(result.sweptWithoutError, true, `expected the sweep to complete without error: ${JSON.stringify(result)}`);
        assert.equal(
          result.effectiveAgeMs,
          result.wallAgeMs,
          `expected effective age to equal wall age when evidence is ${evidenceState}: ${JSON.stringify(result)}`
        );
      }),
      { numRuns: 20 }
    );
  },
  60000
);

// ── Invariant 2 ──────────────────────────────────────────────────────────
// "Evidence growth is bounded by the configured observation interval,
// never by sweep frequency: however many sweeps observe the same standing
// banner, at most one line per role per interval is written."
//
// Generator reach: a random-length (2-15) sequence of strictly increasing
// observation offsets with random gaps (0 to 3x the interval) - so both
// "many rapid sweeps within one interval" (must collapse to one write) and
// "gaps that straddle exactly one interval boundary" (must write again)
// are exercised, not just a uniform sweep cadence. The expected count is
// computed independently in JS with the same greedy algorithm the ticket
// describes, then checked against the REAL Babashka producer's own count.
const minIntervalMsArb = fc.constantFrom(1000, 60000, 300000);

function expectedWriteCount(offsetsMs, minIntervalMs) {
  let count = 0;
  let lastWriteMs = null;
  for (const offsetMs of offsetsMs) {
    if (lastWriteMs === null || offsetMs - lastWriteMs >= minIntervalMs) {
      count += 1;
      lastWriteMs = offsetMs;
    }
  }
  return count;
}

test(
  'property (invariant 2): evidence growth is bounded by the observation interval, not sweep frequency',
  () => {
    fc.assert(
      fc.property(
        minIntervalMsArb,
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 14 }),
        (minIntervalMs, gapMultiples) => {
          // Strictly increasing offsets built from random gap multiples of
          // the interval (0x = a rapid re-sweep, up to 3x = a gap spanning
          // several intervals) - never generated as independent random
          // points, which would rarely land the exact-boundary cases that
          // are this invariant's real risk (BL-654 generator-reach guidance).
          let cursor = 0;
          const offsetsMs = [0];
          for (const mult of gapMultiples) {
            cursor += mult * minIntervalMs + (mult === 0 ? 0 : 1);
            offsetsMs.push(cursor);
          }

          const result = run('throttle-sequence', {
            role: 'coder',
            provider: 'anthropic',
            minIntervalMs,
            offsetsMs,
          });

          const expected = expectedWriteCount(offsetsMs, minIntervalMs);
          assert.equal(
            result.lineCount,
            expected,
            `offsets=${JSON.stringify(offsetsMs)} minInterval=${minIntervalMs}: expected ${expected} lines, got ${result.lineCount}`
          );
        }
      ),
      { numRuns: 20 }
    );
  },
  60000
);

// ── Invariant 3 ──────────────────────────────────────────────────────────
// "An outage is attributed to the PROVIDER, not to the pane it was
// observed on: it applies to every role configured with that provider and
// to no role configured with a different one."
//
// Generator reach: a random number of OTHER roles (0-4), each independently
// assigned either the SAME provider as the observed outage or a genuinely
// different one - proving the read side's provider filter is exact
// membership, not "any role happened to be configured near the observing
// one" or a count/ordering artifact.
const otherRoleCountArb = fc.integer({ min: 0, max: 4 });

test(
  'property (invariant 3): outage attribution follows the provider, never the observing role/pane',
  () => {
    fc.assert(
      fc.property(providerArb, providerArb, otherRoleCountArb, (observedProvider, otherProvider, otherRoleCount) => {
        const sweepAtMs = Date.parse('2026-08-07T10:00:00Z');
        const enqueuedAtMs = sweepAtMs - 60 * 60 * 1000; // 60m wall age
        const baseResult = run('sweep-parcel', {
          role: 'coder',
          roleProvider: observedProvider,
          enqueuedAt: new Date(enqueuedAtMs).toISOString(),
          sweepAt: new Date(sweepAtMs).toISOString(),
          evidenceState: 'holds-outage',
          evidenceProvider: observedProvider,
          evidenceStart: '2026-08-07T09:10:00Z',
          evidenceEnd: '2026-08-07T09:40:00Z',
        });
        // The observing role itself, on the SAME provider the outage was
        // recorded under, must always see the subtraction.
        assert.ok(
          baseResult.effectiveAgeMs < baseResult.wallAgeMs,
          `expected the observing role's own provider to see a subtraction: ${JSON.stringify(baseResult)}`
        );

        for (let i = 0; i < otherRoleCount; i++) {
          const sameProvider = i % 2 === 0;
          const roleProvider = sameProvider ? observedProvider : otherProvider;
          const otherResult = run('sweep-parcel', {
            role: `role-${i}`,
            roleProvider,
            enqueuedAt: new Date(enqueuedAtMs).toISOString(),
            sweepAt: new Date(sweepAtMs).toISOString(),
            evidenceState: 'holds-outage',
            evidenceProvider: observedProvider,
            evidenceStart: '2026-08-07T09:10:00Z',
            evidenceEnd: '2026-08-07T09:40:00Z',
          });
          if (sameProvider) {
            assert.ok(
              otherResult.effectiveAgeMs < otherResult.wallAgeMs,
              `role-${i} shares the observed provider "${observedProvider}" - expected a subtraction: ${JSON.stringify(otherResult)}`
            );
          } else if (otherProvider !== observedProvider) {
            assert.equal(
              otherResult.effectiveAgeMs,
              otherResult.wallAgeMs,
              `role-${i} runs a different provider "${otherProvider}" - expected NO subtraction: ${JSON.stringify(otherResult)}`
            );
          }
        }
      }),
      { numRuns: 15 }
    );
  },
  90000
);
