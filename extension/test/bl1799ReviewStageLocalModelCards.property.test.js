'use strict';

// BL-1799 declared invariant (coder first authorship — BL-654):
//
// "Each card, composed with BL-1798's loop card, stays within 8192
// characters and names its role's full prompt file as the place to read
// before acting on anything the card does not cover."
//
// Sweeps all four review-stage roles this ticket adds cards for, driving
// the REAL prompt_engine_cli.bb compose command - never a
// reimplementation of the composition logic.
//
// Non-vacuity: a deliberately-too-strict length bound (1000 chars) fails
// for every one of these roles, proving the assertion actually bites.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PROMPT_ENGINE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'prompt_engine_cli.bb');
const BUDGET = 8192;

const REVIEW_STAGE_ROLES = ['cleaner', 'architect', 'hardender', 'documenter'];

function compose(role) {
  return execFileSync('bb', [PROMPT_ENGINE_CLI, 'compose', 'local-model', role, '0', ''], { encoding: 'utf8' });
}

test(
  'BL-1799/BL-654 invariant: every review-stage role card stays within budget and names its own full prompt',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.constantFrom(...REVIEW_STAGE_ROLES), (role) => {
        draws += 1;
        const composed = compose(role);
        assert.ok(
          composed.length <= BUDGET,
          `${role}'s local-model card is ${composed.length} chars, over the ${BUDGET} budget`
        );
        assert.match(
          composed,
          new RegExp(`swarmforge/roles/${role}\\.prompt`),
          `${role}'s card must name its own full prompt file`
        );
        assert.match(composed, /swarmforge\/constitution\.prompt/);

        // Non-vacuity: an artificially strict bound must fail for every role.
        assert.ok(composed.length > 1000, `${role}'s card is suspiciously short (${composed.length} chars)`);
      }),
      { numRuns: 4 }
    );
    assert.equal(draws, 4, `generator reach floor: expected all 4 roles drawn, got ${draws}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
