'use strict';

// BL-1356: the ONE place a stamp-off invariant asks its questions.
//
// Six BL-654 stamp-off property tests defend the same real invariant - a green
// suite must never write a decision into backlog/hotfix-ledger.yaml - and each
// encoded it by pinning its row's CURRENT state literal (`state: pending`,
// `state: stamp-open`). A ledger row is not a constant: advancing it through
// stamp-open -> awaiting-human -> certified/waived IS the workflow the ledger
// exists to track. So every one of those tests was written pre-red, and went
// red the moment its row moved, for reasons having nothing to do with the
// invariant. Because the property lane's commit guard refuses any commit
// touching extension/src/ or a property file repo-wide on a non-allowlisted
// red, one row advancing jammed the whole swarm's commit gate - five of the six
// files already carried a standing-allowlist row for it, and the sixth jammed
// four unrelated commits on 2026-09-02.
//
// Human ruling (BL-1356, option 1): keep the invariants on the LIVE ledger and
// assert non-mutation across the run instead of a state literal. So what the
// row said before the run becomes the expected value, whatever it said.
//
// The non-weakening half is the point of the design, not a caveat: a run that
// writes a decision still fails from ANY starting state. Both halves are
// checked - a decision marker this run INTRODUCED is named specifically, and
// then the row and the whole file must be byte-identical across the run.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIVE_LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');

/**
 * One hotfix's row: from its `- commit: <sha>` line to the next entry.
 * A missing row is an error, never an empty string - an invariant that
 * silently watched nothing would pass forever.
 */
function hotfixRow(ledgerText, hotfix) {
  const start = ledgerText.indexOf(`- commit: ${hotfix}`);
  assert.notEqual(start, -1, `no hotfix-ledger row for ${hotfix}`);
  const rest = ledgerText.slice(start);
  const end = rest.indexOf('\n- commit:');
  return end === -1 ? rest : rest.slice(0, end);
}

// The three ways a decision reaches a row. `null` is the undecided value in
// this schema, so "decided" is "present and not null" rather than a list of
// known verdicts - a new verdict word must not slip past by not being listed.
const DECISION_MARKERS = {
  state: /state:\s*(certified|waived)\b/,
  human_decision: /human_decision:\s*(?!null\b)\S+/,
  decided_at: /decided_at:\s*(?!null\b)\S+/,
};

function decisionMarkers(row) {
  return Object.fromEntries(
    Object.entries(DECISION_MARKERS).map(([field, re]) => [field, re.test(row)])
  );
}

/**
 * Run `work`, then assert THIS RUN neither wrote a decision into `hotfix`'s row
 * nor changed it at all.
 *
 * `ledgerPath` is injected only so the helper's own tests can prove it FAILS on
 * a run that writes - pointing a proof of "the gate still bites" at the live
 * ledger would mean writing to it. Every real caller takes the default.
 */
function assertRunWritesNoDecision(hotfix, work = () => {}, { ledgerPath = LIVE_LEDGER } = {}) {
  const beforeLedger = fs.readFileSync(ledgerPath, 'utf8');
  const beforeRow = hotfixRow(beforeLedger, hotfix);
  const before = decisionMarkers(beforeRow);

  work();

  const afterLedger = fs.readFileSync(ledgerPath, 'utf8');
  const afterRow = hotfixRow(afterLedger, hotfix);
  const after = decisionMarkers(afterRow);

  // Named first, so the failure says WHICH decision field this run wrote
  // rather than only that two strings differ.
  for (const field of Object.keys(DECISION_MARKERS)) {
    assert.ok(
      !(after[field] && !before[field]),
      `the run wrote a decision into ${hotfix}'s ${field}, which only a human may do:\n${afterRow}`
    );
  }
  assert.equal(
    afterRow,
    beforeRow,
    `the run changed ${hotfix}'s hotfix-ledger row:\n--- before\n${beforeRow}\n--- after\n${afterRow}`
  );
  assert.equal(afterLedger, beforeLedger, `the run changed ${path.basename(ledgerPath)}`);
  return { beforeRow, afterRow };
}

/**
 * The other assertion every stamp-off file makes: this parcel REVIEWS the
 * hotfix, it does not rewrite it.
 *
 * The pre-BL-1356 encoding compared the WORKING TREE against the hotfix commit's
 * blobs, which is the same defect one door down: a hotfix path legitimately
 * changes as later tickets edit it, so the assertion went red on work that had
 * nothing to do with the stamp-off. `49fca1c741` (BL-1323) established the
 * shape used here - scope the question to THIS PARCEL's own commits, because
 * the invariant is about this parcel and so the range must be too.
 *
 * No commit naming the ticket in range means the parcel has landed and the
 * question is settled elsewhere - not that it edited something.
 */
function assertParcelDoesNotEditReviewedSources(stampTicket, reviewedPaths, { repoRoot = REPO_ROOT } = {}) {
  const commits = execFileSync(
    'git',
    ['log', '--format=%H', '--grep', stampTicket, 'origin/main..HEAD'],
    { cwd: repoRoot, encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean);
  if (commits.length === 0) return { commits, changed: [] };

  const changed = commits
    .flatMap((sha) =>
      execFileSync('git', ['show', '--first-parent', '--name-only', '--format=', sha], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean)
    )
    .filter((v, i, a) => a.indexOf(v) === i);

  for (const reviewed of reviewedPaths) {
    assert.ok(
      !changed.includes(reviewed),
      `the ${stampTicket} stamp-off parcel edits ${reviewed}, which it is meant only to review`
    );
  }
  return { commits, changed };
}

/**
 * A ticket's YAML wherever it currently lives under `backlog/`.
 *
 * BL-1356, the same lesson a third time: a stamp-off that hard-coded
 * `backlog/active/<id>.yaml` broke with ENOENT the moment the ticket completed
 * its own workflow and moved to `backlog/done/M8/`. A ticket's FOLDER is its
 * state, so it moves by design; only the id is stable.
 */
function findTicketYaml(ticketId, { repoRoot = REPO_ROOT } = {}) {
  const backlog = path.join(repoRoot, 'backlog');
  const stack = [backlog];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.startsWith(`${ticketId}-`) && entry.name.endsWith('.yaml')) {
        return full;
      }
    }
  }
  assert.fail(`no ticket yaml for ${ticketId} anywhere under backlog/`);
  return undefined;
}

module.exports = {
  findTicketYaml,
  LIVE_LEDGER,
  hotfixRow,
  decisionMarkers,
  assertRunWritesNoDecision,
  assertParcelDoesNotEditReviewedSources,
};
