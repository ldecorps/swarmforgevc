'use strict';

// BL-848: step handlers for "a hotfix is not an official swarm deal until it
// is certified, and the human is asked first". Drives the REAL pure
// decision function (hotfix_certification_lib.bb's assemble-report) via
// hotfix_certification_acceptance_runner.bb - the same Babashka-runner
// pattern bl412DiskSpaceEarlyWarningAlertSteps.js already established,
// never a hand-rolled reimplementation of the state machine in JS. The
// live git-scan + operator_runtime.bb wiring is proven separately by
// swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh
// (a shell wiring test, since it drives a real --tick-once subprocess).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'hotfix_certification_acceptance_runner.bb');

// A fixed, known cooldown so scenario 02's "after the resurfacing interval"
// step can advance ctx.now deterministically - the KNOWN_VALUES the
// engineering article's Scenario Outline rule requires, applied here even
// though this constant isn't itself an Examples cell (it stands in for the
// otherwise-unstated resurface interval every scenario in this feature
// shares).
const COOLDOWN_MS = 1000;

// Scenario 04's <ticket state> placeholder -> the stamp-ticket facts it
// stands for. An unrecognized value throws rather than silently falling
// through (a mutated Examples cell must fail loudly here).
const TICKET_STATE_FACTS = new Map([
  ['is still moving through the pipeline', { stampTicketStatus: 'active', stampTicketHumanApproval: null }],
  ['has passed QA but carries no human decision', { stampTicketStatus: 'done', stampTicketHumanApproval: 'pending' }],
]);

// Scenario 05's <decision>/<outcome> placeholders.
const DECISION_FACTS = new Map([
  ['approval', { humanDecision: 'approved', outcome: 'certified' }],
  ['waiver', { humanDecision: 'waived', outcome: 'waived' }],
]);

function knownTicketState(label) {
  if (!TICKET_STATE_FACTS.has(label)) {
    throw new Error(`hotfix-certification: unrecognized ticket state "${label}"`);
  }
  return TICKET_STATE_FACTS.get(label);
}

function knownDecision(label) {
  if (!DECISION_FACTS.has(label)) {
    throw new Error(`hotfix-certification: unrecognized decision "${label}"`);
  }
  return DECISION_FACTS.get(label);
}

function runCheck(ctx) {
  const scenario = {
    entries: ctx.entries,
    mainCommits: ctx.mainCommits,
    nowMs: ctx.now,
    lastSurfacedMsByCommit: ctx.lastSurfaced,
    resurfaceCooldownMs: COOLDOWN_MS,
  };
  const out = execFileSync('bb', [RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  const result = JSON.parse(out);
  ctx.result = result;
  ctx.lastSurfaced = result.newDedupState;
  // mirror the real sweep's own write-back: newly-detected commits become
  // known ledger entries for any LATER run within the same scenario.
  for (const e of result.newLedgerEntries) {
    ctx.entries.push({ commit: e.commit, stampTicket: null, humanDecision: null });
  }
  return result;
}

function surfacedCommits(result) {
  return new Set(result.dueForSurfacing.map((e) => e.commit));
}

function decidedFor(result, commit) {
  const found = result.decided.find((e) => e.commit === commit);
  if (!found) throw new Error(`hotfix-certification: no decided entry for commit ${commit}`);
  return found;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────────
  registry.define(/^a hotfix certification ledger that records one entry per hotfix commit$/, (ctx) => {
    ctx.entries = [];
    ctx.mainCommits = [];
    ctx.now = 0;
    ctx.lastSurfaced = {};
  });

  registry.define(/^a recurrent check that runs on an already-existing daemon loop$/, () => {
    // documentary only - the daemon-loop wiring itself is proven by the
    // shell wiring test named in this file's header comment.
  });

  // ── hotfix-certification-01 ─────────────────────────────────────────────
  registry.define(/^a functional change lands on main declaring itself a hotfix$/, (ctx) => {
    ctx.commit = 'abc1234567';
    ctx.mainCommits.push({
      commit: ctx.commit,
      subject: 'Land an emergency fix',
      message: 'Land an emergency fix\n\nBy coder.\n\nHotfix-Certification: pending\n',
      functional: true,
      hotfixDeclared: true,
      citedTicketDone: false,
    });
  });

  registry.define(/^the recurrent check runs$/, (ctx) => {
    runCheck(ctx);
  });

  registry.define(/^the ledger holds an entry for that commit$/, (ctx) => {
    if (!ctx.result.newLedgerEntries.some((e) => e.commit === ctx.commit)) {
      throw new Error(`expected a new ledger entry for ${ctx.commit}, got: ${JSON.stringify(ctx.result.newLedgerEntries)}`);
    }
  });

  // Reused by both scenario 01 (a commit freshly detected THIS run - only
  // in newLedgerEntries, hc/new-entry starts it at "pending" by
  // construction) and scenario 04 (an entry already IN the ledger before
  // this run - in :decided instead, since assemble-report's :decided only
  // covers entries already in the ledger at call time).
  registry.define(/^that entry is not certified$/, (ctx) => {
    const newEntry = ctx.result.newLedgerEntries.find((e) => e.commit === ctx.commit);
    const state = newEntry ? newEntry.state : decidedFor(ctx.result, ctx.commit).state;
    if (['certified', 'waived'].includes(state)) {
      throw new Error(`expected ${ctx.commit} not to be certified/waived, got: ${state}`);
    }
  });

  // ── hotfix-certification-02 ─────────────────────────────────────────────
  registry.define(/^a ledger entry that is still open$/, (ctx) => {
    ctx.commit = 'c0000000c2';
    ctx.entries.push({ commit: ctx.commit, stampTicket: null, humanDecision: null });
  });

  registry.define(/^the check has already surfaced that entry on an earlier run$/, (ctx) => {
    const result = runCheck(ctx);
    if (!surfacedCommits(result).has(ctx.commit)) {
      throw new Error(`expected ${ctx.commit} to be surfaced on the first run`);
    }
  });

  registry.define(/^the recurrent check runs again after the resurfacing interval$/, (ctx) => {
    ctx.now += COOLDOWN_MS;
    runCheck(ctx);
  });

  registry.define(/^it surfaces that entry again$/, (ctx) => {
    if (!surfacedCommits(ctx.result).has(ctx.commit)) {
      throw new Error(`expected ${ctx.commit} to be surfaced again, got: ${JSON.stringify(ctx.result.dueForSurfacing)}`);
    }
  });

  registry.define(/^it keeps doing so until the entry is resolved$/, (ctx) => {
    // a third due tick: still open, still surfaces.
    ctx.now += COOLDOWN_MS;
    const third = runCheck(ctx);
    if (!surfacedCommits(third).has(ctx.commit)) {
      throw new Error(`expected ${ctx.commit} to keep surfacing on a third due tick`);
    }
    // resolve it, then a fourth due tick must NOT surface it again.
    ctx.entries = ctx.entries.map((e) => (e.commit === ctx.commit ? { ...e, humanDecision: 'approved' } : e));
    ctx.now += COOLDOWN_MS;
    const fourth = runCheck(ctx);
    if (surfacedCommits(fourth).has(ctx.commit)) {
      throw new Error(`expected ${ctx.commit} to stop surfacing once resolved, got: ${JSON.stringify(fourth.dueForSurfacing)}`);
    }
  });

  // ── hotfix-certification-03 ─────────────────────────────────────────────
  registry.define(/^a ledger entry with no stamp ticket recorded$/, (ctx) => {
    ctx.commit = 'c0000000c3';
    ctx.entries.push({ commit: ctx.commit, stampTicket: null, humanDecision: null });
  });

  registry.define(/^it asks the coordinator to get a stamp ticket minted for that commit$/, (ctx) => {
    if (!ctx.result.mintRequests.some((e) => e.commit === ctx.commit)) {
      throw new Error(`expected a mint-stamp-ticket request for ${ctx.commit}, got: ${JSON.stringify(ctx.result.mintRequests)}`);
    }
  });

  // ── hotfix-certification-04 (Scenario Outline) ──────────────────────────
  // stepRegistry.js resolves first-match-in-definition-order (no
  // specificity ranking), so this generic pattern must NOT also swallow
  // scenario 05/06's own fixed "...has passed QA" Given below - the
  // negative lookahead keeps the two mutually exclusive regardless of
  // registration order.
  registry.define(/^a ledger entry whose stamp ticket (?!has passed QA$)(.+)$/, (ctx, label) => {
    const facts = knownTicketState(label);
    ctx.commit = 'c0000000c4';
    ctx.entries.push({
      commit: ctx.commit,
      stampTicket: 'BL-900',
      humanDecision: null,
      stampTicketStatus: facts.stampTicketStatus,
      stampTicketHumanApproval: facts.stampTicketHumanApproval,
    });
  });

  registry.define(/^it is still surfaced as outstanding$/, (ctx) => {
    if (!surfacedCommits(ctx.result).has(ctx.commit)) {
      throw new Error(`expected ${ctx.commit} to still be surfaced as outstanding`);
    }
  });

  // ── hotfix-certification-05 (Scenario Outline) ──────────────────────────
  registry.define(/^a ledger entry whose stamp ticket has passed QA$/, (ctx) => {
    ctx.commit = 'c0000000c5';
    ctx.pendingEntry = { commit: ctx.commit, stampTicket: 'BL-900', humanDecision: null, stampTicketStatus: 'done', stampTicketHumanApproval: 'approved' };
  });

  registry.define(/^the human has recorded a decision of (.+)$/, (ctx, label) => {
    const { humanDecision, outcome } = knownDecision(label);
    ctx.outcome = outcome;
    ctx.entries.push({ ...ctx.pendingEntry, humanDecision });
  });

  // The <outcome> placeholder ("certified"/"waived") is a DIFFERENT
  // vocabulary from <decision> ("approval"/"waiver") above - it names the
  // ledger's own literal state string directly, not a decision label.
  const KNOWN_OUTCOMES = new Set(['certified', 'waived']);

  registry.define(/^that entry is resolved as (.+)$/, (ctx, outcome) => {
    if (!KNOWN_OUTCOMES.has(outcome)) {
      throw new Error(`hotfix-certification: unrecognized outcome "${outcome}"`);
    }
    const decided = decidedFor(ctx.result, ctx.commit);
    if (decided.state !== outcome) {
      throw new Error(`expected ${ctx.commit} to resolve as ${outcome}, got: ${decided.state}`);
    }
  });

  registry.define(/^it is no longer surfaced as outstanding$/, (ctx) => {
    if (surfacedCommits(ctx.result).has(ctx.commit)) {
      throw new Error(`expected ${ctx.commit} NOT to be surfaced any longer, got: ${JSON.stringify(ctx.result.dueForSurfacing)}`);
    }
  });

  // ── hotfix-certification-06 ──────────────────────────────────────────────
  registry.define(/^the human has recorded no decision$/, (ctx) => {
    ctx.entries.push(ctx.pendingEntry);
  });

  registry.define(/^the check writes no resolved state for that entry$/, (ctx) => {
    const decided = decidedFor(ctx.result, ctx.commit);
    if (['certified', 'waived'].includes(decided.state)) {
      throw new Error(`expected no resolved state for ${ctx.commit}, got: ${decided.state}`);
    }
  });

  registry.define(/^the entry still awaits the human$/, (ctx) => {
    const decided = decidedFor(ctx.result, ctx.commit);
    if (decided.state !== 'awaiting-human') {
      throw new Error(`expected ${ctx.commit} to await the human, got: ${decided.state}`);
    }
  });

  // ── hotfix-certification-07 ──────────────────────────────────────────────
  registry.define(/^a functional change on main that declares no hotfix$/, (ctx) => {
    ctx.commit = 'c0000000c7';
    ctx.mainCommits.push({
      commit: ctx.commit,
      subject: 'Unrelated plain change',
      message: 'Unrelated plain change, no ticket cited.\n',
      functional: true,
      hotfixDeclared: false,
      citedTicketDone: false,
    });
  });

  registry.define(/^no ledger entry and no pipeline record claims that commit$/, () => {
    // already true: ctx.entries has no such commit, and citedTicketDone is
    // false on the mainCommits entry above.
  });

  registry.define(/^it reports that commit as unaccounted for$/, (ctx) => {
    if (!ctx.result.unaccounted.some((c) => c.commit === ctx.commit)) {
      throw new Error(`expected ${ctx.commit} to be reported unaccounted for, got: ${JSON.stringify(ctx.result.unaccounted)}`);
    }
  });

  registry.define(/^it says the report is a review queue, not a certification verdict$/, (ctx) => {
    if (!ctx.result.unaccountedReportLines.some((line) => line.includes(ctx.commit) && line.toLowerCase().includes('review queue'))) {
      throw new Error(`expected the unaccounted report to frame itself as a review queue, got: ${JSON.stringify(ctx.result.unaccountedReportLines)}`);
    }
  });

  // ── hotfix-certification-08 ──────────────────────────────────────────────
  registry.define(/^a functional change on main that a ledger entry already covers$/, (ctx) => {
    ctx.commit = 'c0000000c8';
    ctx.entries.push({ commit: ctx.commit, stampTicket: null, humanDecision: null });
    ctx.mainCommits.push({
      commit: ctx.commit,
      subject: 'Already-known change',
      message: 'Already-known change.\n',
      functional: true,
      hotfixDeclared: false,
      citedTicketDone: false,
    });
  });

  registry.define(/^it does not report that commit as unaccounted for$/, (ctx) => {
    if (ctx.result.unaccounted.some((c) => c.commit === ctx.commit)) {
      throw new Error(`expected ${ctx.commit} NOT to be reported unaccounted for, got: ${JSON.stringify(ctx.result.unaccounted)}`);
    }
  });
}

module.exports = { registerSteps };
