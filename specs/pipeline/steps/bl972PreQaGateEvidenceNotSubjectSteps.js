'use strict';

// BL-972: pre-QA ancestry blocks only on path evidence, not subject mentions.
// Drives REAL pre_qa_gate_lib.evaluate over constructed facts — never a
// parallel reimplementation.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FEATURE = 'BL-972 pre-QA gate blocks on dropped-work evidence, not subject mentions';
const TICKET = 'BL-900';
const SHA = 'aaaaaaaaaa';
const PARCEL_PATHS = ['extension/src/swarm/foo.ts', 'specs/features/BL-900-x.feature'];
const BRANCH = 'swarmforge-coder';

function evaluateFacts({ touched, abandoned }) {
  const edn = [
    '{',
    ':type "git_handoff"',
    ':to "QA"',
    `:ticket-id "${TICKET}"`,
    ':cited-commit "cccccccccc"',
    `:parcel-paths [${PARCEL_PATHS.map((p) => `"${p}"`).join(' ')}]`,
    `:role-branch-commits {"${BRANCH}" [{:sha "${SHA}" :message "names ${TICKET} in subject" :paths ["${touched}"]}]}`,
    ':main-reachable-set #{}',
    ':cited-ancestors-set #{}',
    ':wiring-entries []',
    ':file-contents {}',
    abandoned === 'present' ? `:abandoned-commits ["${SHA}"]` : ':abandoned-commits []',
    '}',
  ].join(' ');

  const script = `
(load-file "swarmforge/scripts/pre_qa_gate_lib.bb")
(let [opts ${edn}
      result (pre-qa-gate-lib/evaluate opts)
      finding (first (filter #(= :ancestry (:class %)) (:findings result)))
      warn (first (filter #(re-find #"aaaaaaaaaa" %) (:warnings result)))]
  (cond
    finding (println "block")
    (and (nil? finding) (nil? warn) (= "present" "${abandoned}")) (println "exempt-no-block")
    (and (nil? finding) warn) (println "warning-no-block")
    :else (do (println "UNEXPECTED" (pr-str result)) (System/exit 2))))
`;
  const res = spawnSync('bb', ['-e', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`evaluate failed: ${res.stdout}\n${res.stderr}`);
  }
  return (res.stdout || '').trim().split('\n').pop();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a ticket "BL-900" whose cited parcel commit touches "extension\/src\/swarm\/foo\.ts" and "specs\/features\/BL-900-x\.feature"$/,
    (ctx) => {
      ctx.bl972 = { parcelPaths: PARCEL_PATHS };
    }
  );

  scoped(
    /^a role branch holds a commit "aaaaaaaaaa" that is not an ancestor of the cited commit, main, or origin\/main$/,
    (ctx) => {
      ctx.bl972 = ctx.bl972 || {};
      ctx.bl972.notAncestor = true;
    }
  );

  scoped(/^commit "aaaaaaaaaa" names "BL-900" in its subject line$/, (ctx) => {
    ctx.bl972.namesTicket = true;
  });

  scoped(/^commit "aaaaaaaaaa" touches only "([^"]+)"$/, (ctx, touched) => {
    ctx.bl972.touched = touched;
  });

  scoped(/^the ticket's abandoned_commits listing for "aaaaaaaaaa" is (absent|present)$/, (ctx, state) => {
    ctx.bl972.abandoned = state;
  });

  scoped(/^the pre-QA gate evaluates the forward for "BL-900"$/, (ctx) => {
    ctx.bl972.verdict = evaluateFacts({
      touched: ctx.bl972.touched,
      abandoned: ctx.bl972.abandoned,
    });
  });

  scoped(/^the gate's ancestry verdict for commit "aaaaaaaaaa" is "([^"]+)"$/, (ctx, expected) => {
    assert.equal(ctx.bl972.verdict, expected);
  });
}

module.exports = { registerSteps };
