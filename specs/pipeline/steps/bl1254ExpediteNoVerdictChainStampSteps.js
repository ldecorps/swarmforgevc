'use strict';

// BL-1254: BL-848 stamp-off of the Cursor expedite no-verdict hotfix chain
// 3f4f69ec1b -> 70c5e0e5b0 -> 5de352ed1d, reviewed as ONE resulting state.
//
// This CONFIRMS OR REFUTES what landed. It reimplements nothing, changes no
// hotfix source line, and writes nothing to the ledger (invariants 1 and 2).
//
// Every scenario EXECUTES the landed decision rather than asserting on its
// source text: the real expedite_lib.bb functions through
// lib/bl1254ExpediteDecisionCli.bb, and — for the refused bounce — the real
// expedite_cli.bb driver over the real fixture repo through
// lib/bl1254RefusedBounceCli.sh. The fault under review was a decision that
// read correctly and was never consulted, which is exactly what a source-text
// assertion cannot tell apart from a wired one.
//
// The Background verifies the reviewed tree IS the landed chain: each of the
// three commits is reachable, still carries its pending certification
// trailer, and the four files they all touched still carry what landed in
// them. It also enforces invariant 3 against the feature file itself — no
// scenario may assert 70c5e0e5b0's same-stage no-verdict bounce, which
// 5de352ed1d replaced.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DECISION_CLI = path.join(__dirname, 'lib', 'bl1254ExpediteDecisionCli.bb');
const REFUSED_BOUNCE_CLI = path.join(__dirname, 'lib', 'bl1254RefusedBounceCli.sh');
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const FEATURE_FILE = path.join(
  REPO_ROOT, 'specs', 'features', 'BL-1254-swarm-stamp-expedite-no-verdict-chain.feature'
);

// The chain, in the order it landed. The third supersedes part of the second,
// so the contract describes the resulting state at the last of them.
const CHAIN = ['3f4f69ec1b', '70c5e0e5b0', '5de352ed1d'];
const RESULTING_STATE = '5de352ed1d';

// The four files all three commits touched. This parcel must have modified
// none of them (invariant 1: a stamp-off that edited what it reviews would be
// certifying its own work).
const HOTFIX_SOURCES = [
  'swarmforge/scripts/expedite_lib.bb',
  'swarmforge/scripts/expedite_cli.bb',
  'swarmforge/scripts/test/expedite_lib_test_runner.bb',
  'swarmforge/scripts/test/test_expedite_cli.sh',
];

// The landed symbols under review. Present at the resulting state, and still
// present in the tree this review runs against.
const REVIEWED_SYMBOLS = [
  'max-missing-verdict-recoveries',
  'should-recover-missing-verdict?',
  'bounce-payload-valid?',
  'stage-user-prompt',
  'finalize-stage-result',
];

const FEATURE =
  'Stamp-off review of the Cursor expedite no-verdict hotfix chain 3f4f69ec1b, 70c5e0e5b0, 5de352ed1d';

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

/** One bb start; the landed decision for `query` under `args`. */
function decide(query, args) {
  const out = execFileSync('bb', [DECISION_CLI, query, JSON.stringify(args)], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background: the tree under review IS the landed chain ───────────────

  scoped(/^the landed expedite driver sources at commit 5de352ed1d$/, (ctx) => {
    ctx.bl1254 = {};

    for (const sha of CHAIN) {
      assert.equal(git('cat-file', '-t', sha).trim(), 'commit', `${sha} must be reachable`);
      const message = git('log', '-1', '--format=%B', sha);
      assert.match(
        message,
        /Hotfix-Certification:\s*pending/,
        `${sha} is not pending certification — a stamp-off has nothing to review`
      );
    }

    // Chronological order, which is what makes "the third supersedes the
    // second" true rather than assumed.
    for (let i = 1; i < CHAIN.length; i += 1) {
      const earlier = Number(git('log', '-1', '--format=%ct', CHAIN[i - 1]).trim());
      const later = Number(git('log', '-1', '--format=%ct', CHAIN[i]).trim());
      assert.ok(
        earlier <= later,
        `${CHAIN[i - 1]} must precede ${CHAIN[i]}; the resulting state depends on the order`
      );
    }

    // What landed at the resulting state is still what runs. Only lines the
    // chain did NOT touch may have moved since.
    const lib = fs.readFileSync(path.join(REPO_ROOT, HOTFIX_SOURCES[0]), 'utf8');
    const landedLib = git('show', `${RESULTING_STATE}:${HOTFIX_SOURCES[0]}`);
    for (const symbol of REVIEWED_SYMBOLS) {
      assert.ok(landedLib.includes(symbol), `${RESULTING_STATE} does not define ${symbol}`);
      assert.ok(lib.includes(symbol), `expedite_lib.bb lost ${symbol} since ${RESULTING_STATE}`);
    }

    // Invariant 1, checked rather than asserted in prose.
    const touched = git('status', '--porcelain', '--', ...HOTFIX_SOURCES).trim();
    assert.equal(touched, '', `this stamp-off modified the hotfixes it is reviewing: ${touched}`);

    // Invariant 3, checked against the contract itself: no scenario may assert
    // 70c5e0e5b0's same-stage no-verdict bounce. 5de352ed1d refuses exactly
    // that synthesized bounce, so a scenario asserting it would be red when
    // the code is correct.
    const feature = fs.readFileSync(FEATURE_FILE, 'utf8');
    const supersededClaim =
      /(bounce(s|d)?[^.\n]{0,60}(back to |re-?enters? )the same stage|same stage[^.\n]{0,40}bounce)/i;
    const offending = feature
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .filter((line) => supersededClaim.test(line))
      // The prose header explains what was superseded; only steps and
      // scenario titles make claims the runner checks.
      .filter((line) => /^\s*(Scenario|Given|When|Then|And|But|\|)/.test(line))
      // A step that DENIES the superseded behaviour is the contract holding
      // 5de352ed1d, not asserting what it replaced. Only an affirmative claim
      // is the violation.
      .filter((line) => !/\b(not|never|no longer|refus(e|es|ed|al))\b/i.test(line));
    assert.deepEqual(
      offending,
      [],
      `a scenario asserts the behaviour 5de352ed1d superseded: ${offending.join(' / ')}`
    );
  });

  // ── 01: re-invoke while recoveries remain, then fail closed ─────────────

  scoped(/^an expedite stage has exited without a parseable verdict (\d+) times$/, (ctx, times) => {
    // `attempt` in the driver's loop is 0-based: the Nth miss is decided with
    // attempt = N - 1.
    ctx.bl1254.attempt = Number(times) - 1;
  });

  scoped(/^the driver decides what to do next$/, (ctx) => {
    ctx.bl1254.decision = decide('recover', { attempt: ctx.bl1254.attempt, parsed: null });
  });

  scoped(/^the driver (re-invokes the stage|fails the ticket closed)$/, (ctx, outcome) => {
    const { decision, attempt } = ctx.bl1254;
    assert.equal(decision.max, 2, 'the reviewed bound is two recoveries');
    if (outcome === 're-invokes the stage') {
      assert.equal(decision.recover, true, `miss ${attempt + 1} should still recover`);
    } else {
      assert.equal(decision.recover, false, `miss ${attempt + 1} should stop recovering`);
      // Fails CLOSED, and on the absence itself — never a synthesized bounce,
      // which is the loop 5de352ed1d exists to refuse.
      assert.equal(decision.finalVerdict, 'fail');
      assert.equal(decision.finalReason, 'no-verdict');
    }
  });

  // ── 02: the recovery prompt escalates ───────────────────────────────────

  scoped(/^a stage is being re-invoked after a missing verdict$/, (ctx) => {
    ctx.bl1254.promptInputs = [
      { label: 'base', recovery: false, attempt: 0 },
      { label: 'first recovery', recovery: true, attempt: 1 },
      { label: 'escalated recovery', recovery: true, attempt: 2 },
    ];
  });

  scoped(/^the driver builds the stage prompt$/, (ctx) => {
    ctx.bl1254.prompts = ctx.bl1254.promptInputs.map((input) => ({
      label: input.label,
      text: decide('prompt', { recovery: input.recovery, attempt: input.attempt }).text,
    }));
  });

  scoped(/^the prompt forbids waiting on background or Monitor work$/, (ctx) => {
    for (const { label, text } of ctx.bl1254.prompts) {
      assert.match(
        text,
        /Do not stand by for/i,
        `the ${label} prompt does not forbid standing by`
      );
      assert.match(text, /Monitor/, `the ${label} prompt does not name Monitor`);
      assert.match(text, /background/i, `the ${label} prompt does not name background work`);
    }

    // "Escalates rather than repeating": the second recovery is not the first
    // one sent twice. A stage that ignored the first wording gets a different,
    // stronger one, which is the whole point of a second attempt.
    const [, first, escalated] = ctx.bl1254.prompts;
    assert.notEqual(
      escalated.text,
      first.text,
      'the escalated recovery repeats the first recovery verbatim'
    );
    assert.match(escalated.text, /ESCALATED/, 'the second recovery does not escalate');
  });

  scoped(
    /^the prompt requires writing a pass, bounce or fail verdict as the last action$/,
    (ctx) => {
      // The scenario is about the RE-INVOKE prompt, so the recoveries are what
      // must spell the three verdicts out: a stage that already exited
      // without one is told exactly which words end the run. The base prompt
      // (asserted below) carries the same last-action requirement in its own
      // wording, and is checked so a recovery cannot be the only place the
      // rule is stated.
      for (const { label, text } of ctx.bl1254.prompts.filter((p) => p.label !== 'base')) {
        assert.match(
          text,
          /pass, bounce,? or fail verdict/i,
          `the ${label} prompt does not require a pass/bounce/fail verdict`
        );
        assert.match(text, /NOW/, `the ${label} prompt does not demand the verdict now`);
      }

      const base = ctx.bl1254.prompts.find((p) => p.label === 'base');
      assert.match(
        base.text,
        /verdict[\s\S]{0,160}?LAST action/i,
        'the base prompt does not make the verdict the last action'
      );
    }
  );

  // ── 03: a bounce must carry an actionable reason ────────────────────────

  scoped(
    /^a stage returns a bounce whose reason and class are (an actionable reason|both blank|the synthetic no-verdict tag)$/,
    (ctx, payload) => {
      if (payload === 'an actionable reason') {
        ctx.bl1254.payloads = [{ reason: 'the null guard on the verdict path is missing', class: '' }];
      } else if (payload === 'both blank') {
        // Blank in both the empty and the whitespace-only spelling: a bounce
        // carrying "  " is as reasonless as one carrying "".
        ctx.bl1254.payloads = [
          { reason: '', class: '' },
          { reason: '   ', class: '\t' },
        ];
      } else {
        // The driver's OWN synthetic tag, in every spelling it can reach the
        // gate in: the class, the string reason, the keyword reason, and the
        // casing a hand-written verdict might use.
        ctx.bl1254.payloads = [
          { reason: '', class: 'no-verdict-abandoned' },
          { reason: 'no-verdict', class: '' },
          { reason: 'NO-VERDICT', class: '' },
          { reason: 'no-verdict', class: '', reasonKeyword: true },
        ];
      }
    }
  );

  scoped(/^the driver validates the bounce$/, (ctx) => {
    ctx.bl1254.validations = ctx.bl1254.payloads.map((p) => ({
      payload: p,
      valid: decide('bounce', p).valid,
    }));
  });

  scoped(/^the bounce is (accepted|refused)$/, (ctx, verdict) => {
    const want = verdict === 'accepted';
    for (const { payload, valid } of ctx.bl1254.validations) {
      assert.equal(
        valid,
        want,
        `${JSON.stringify(payload)} should have been ${verdict}, was ${valid ? 'accepted' : 'refused'}`
      );
    }
  });

  // ── 04: a refused bounce does not consume the bounce bound ──────────────
  //
  // The real driver, over the real fixture repo. A refused bounce that still
  // re-entered the stage would be the loop the hotfix exists to break, and
  // only an end-to-end walk can see whether the stage was re-entered.

  scoped(/^a stage returns a bounce the driver refuses as reasonless$/, (ctx) => {
    ctx.bl1254.work = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1254-'));
  });

  scoped(/^the driver records the stage result$/, (ctx) => {
    const out = execFileSync('bash', [REFUSED_BOUNCE_CLI, ctx.bl1254.work], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 300_000,
    });
    ctx.bl1254.run = JSON.parse(out.trim().split('\n').pop());
  });

  scoped(/^the ticket is not re-entered at the same stage on that bounce$/, (ctx) => {
    const { run, work } = ctx.bl1254;
    try {
      assert.equal(run.refused, true, 'the driver did not refuse the reasonless bounce');
      assert.match(run.refusalLine, /bounce must carry an actionable reason or class/);
      assert.equal(run.reEntered, false, 'the refused bounce re-entered the bounce target');
      assert.equal(run.coderRuns, 1, 'the bounce target ran more than once');
      assert.equal(run.cleanerRuns, 1, 'the bouncing stage itself was re-entered');
      // Fails closed rather than looping: a non-zero exit, not a done ticket.
      assert.equal(run.exit, 1, 'a refused bounce must fail the run closed');
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  // ── 05: the ledger stays the human's to decide ──────────────────────────

  scoped(/^the review scenarios above are green$/, (ctx) => {
    ctx.bl1254 = ctx.bl1254 || {};
  });

  scoped(/^the stamp-off completes without a recorded human decision$/, (ctx) => {
    ctx.bl1254.ledger = fs.readFileSync(LEDGER, 'utf8');
    // Invariant 2: this parcel must not have touched the ledger at all.
    const changed = git('status', '--porcelain', '--', 'backlog/hotfix-ledger.yaml').trim();
    assert.equal(changed, '', `this stamp-off modified the ledger: ${changed}`);
  });

  scoped(/^no hotfix ledger row in this chain is certified or waived$/, (ctx) => {
    const rows = ctx.bl1254.ledger.split(/^- commit: /m).slice(1);
    for (const sha of CHAIN) {
      const matching = rows.filter((row) => row.startsWith(sha));
      assert.equal(matching.length, 1, `expected exactly one ledger row for ${sha}`);
      const row = matching[0];
      const state = /\n\s*state:\s*(\S+)/.exec(row);
      const decision = /\n\s*human_decision:\s*(\S+)/.exec(row);
      assert.ok(state, `the ledger row for ${sha} has no state`);
      assert.ok(
        !['certified', 'waived'].includes(state[1]),
        `green scenarios certified ${sha}: state is ${state[1]}`
      );
      assert.equal(
        decision && decision[1],
        'null',
        `a human decision was recorded for ${sha} without a human`
      );
    }
  });
}

module.exports = { registerSteps };
