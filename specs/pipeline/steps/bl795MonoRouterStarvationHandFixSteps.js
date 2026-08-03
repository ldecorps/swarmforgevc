'use strict';

// BL-795: pins the 2026-08-03 mono-router self-starvation hand fix (adopted
// under review by the coder). Drives the REAL adopted artifacts rather than
// re-describing the fix in JS:
//   - test_handoffd_rule_proposal_rotate_wiring.sh scenarios A/B/C exercise
//     the real handoffd.bb --print-preferred-rotate-target path
//     (preferred-mono-rotate-role -> role-mail-row) over real mailbox
//     fixtures — scenarios 01-04 below anchor on its PASS markers.
//   - test_chase_sweep.sh scenario 06 exercises the real chase_sweep_lib.bb
//     escalation path over a fake-now-ms fixture — scenario 05 below anchors
//     on its PASS marker.
// Scenario 04 (chase poke redirect) shares scenario 03's fixture and PASS
// marker: chase-rotate-to! is otherwise-impure daemon control flow (live
// tmux pane capture + real mailbox scans) with no standalone CLI entry
// point, so — matching this project's established pattern
// (bl651AgedWorkRotationSteps.js) and the in-code BL-654 rationale in
// handoffd.bb above chase-rotate-to! — the redirect's PRECONDITION (preferred
// != polled role) is what gets proven against the real system; the two-line
// redirect-vs-skip branch itself is read directly off chase-rotate-to!'s
// source rather than re-implemented as a second oracle.

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RULE_PROPOSAL_WIRING = path.join(
  REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_handoffd_rule_proposal_rotate_wiring.sh'
);
const CHASE_SWEEP_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_chase_sweep.sh');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');
const FEATURE = 'Mono-router starvation hand fix, adopted under review';

function ensureState(ctx) {
  if (!ctx.bl795) ctx.bl795 = {};
  return ctx.bl795;
}

function runScript(scriptPath) {
  const result = spawnSync('bash', [scriptPath], { encoding: 'utf8' });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} failed:\n${out}`);
  }
  return out;
}

function ensureRuleProposalWiring(ctx) {
  const st = ensureState(ctx);
  if (!st.ruleProposalOut) st.ruleProposalOut = runScript(RULE_PROPOSAL_WIRING);
  return st.ruleProposalOut;
}

function ensureChaseSweep(ctx) {
  const st = ensureState(ctx);
  if (!st.chaseSweepOut) st.chaseSweepOut = runScript(CHASE_SWEEP_TEST);
  return st.chaseSweepOut;
}

function assertPass(out, marker, failMsg) {
  if (!out.includes(marker)) {
    throw new Error(`${failMsg}\n${out}`);
  }
}

function registerSteps(registry) {
  registry.defineScoped(/^a mono-router pack whose home role is coder$/, (ctx) => {
    const st = ensureState(ctx);
    st.pack = 'mono-router';
    st.home = 'coder';
    if (!fs.existsSync(HANDOFFD)) {
      throw new Error(`expected adopted handoffd.bb at ${HANDOFFD}`);
    }
  }, FEATURE);

  // ── Scenario 01: rule_proposal alone makes its role preferred ──────────
  registry.defineScoped(/^a rule_proposal parcel sits in the specifier's new inbox$/, () => {}, FEATURE);

  registry.defineScoped(/^no other role has actionable mail or held work$/, () => {}, FEATURE);

  registry.defineScoped(/^the daemon computes the preferred rotate target$/, (ctx) => {
    ensureRuleProposalWiring(ctx);
  }, FEATURE);

  registry.defineScoped(/^the preferred rotate target is the specifier$/, (ctx) => {
    const out = ensureRuleProposalWiring(ctx);
    assertPass(
      out, 'PASS: A:',
      'expected wiring scenario A (rule_proposal-only mailbox preferred) to pass'
    );
  }, FEATURE);

  // ── Scenario 02: a fresh note alone stays non-actionable ───────────────
  registry.defineScoped(/^a note younger than the ageing threshold sits alone in the specifier's new inbox$/, () => {}, FEATURE);

  registry.defineScoped(/^no role is preferred$/, (ctx) => {
    const out = ensureRuleProposalWiring(ctx);
    assertPass(
      out, 'PASS: B:',
      'expected wiring scenario B (fresh note alone non-actionable) to pass'
    );
  }, FEATURE);

  // ── Scenario 03: a held in_process claim outranks a directed rule_proposal ─
  registry.defineScoped(/^the hardender holds an in_process git_handoff at priority 00$/, () => {}, FEATURE);

  registry.defineScoped(/^a rule_proposal at priority 50 sits in the specifier's new inbox$/, () => {}, FEATURE);

  registry.defineScoped(/^the preferred rotate target is the hardender$/, (ctx) => {
    const out = ensureRuleProposalWiring(ctx);
    assertPass(
      out, 'PASS: C:',
      'expected wiring scenario C (in_process priority-00 beats rule_proposal priority-50) to pass'
    );
  }, FEATURE);

  // ── Scenario 04: a chase poke at a non-preferred role redirects ────────
  // Reuses scenario 01's "a rule_proposal parcel sits in the specifier's new
  // inbox" registration above — same step text, same feature scope.

  registry.defineScoped(/^the chase sweep pokes the specifier$/, (ctx) => {
    // chase-rotate-to! polls `specifier`; its first branch compares
    // preferred-mono-rotate-role against the polled role and redirects when
    // they differ (handoffd.bb chase-rotate-to!). Scenario 03's fixture
    // already proves preferred = hardender != specifier in this exact
    // mailbox state, which is the redirect's precondition.
    ensureRuleProposalWiring(ctx);
  }, FEATURE);

  registry.defineScoped(/^the resident rotate is redirected onto the hardender$/, (ctx) => {
    const out = ensureRuleProposalWiring(ctx);
    assertPass(
      out, 'PASS: C:',
      'expected wiring scenario C to prove preferred = hardender (redirect target) over specifier'
    );
  }, FEATURE);

  registry.defineScoped(/^the poke is not dropped as not-preferred$/, () => {
    // The pre-fix `chase-rotate-skip-not-preferred` code path no longer
    // exists in handoffd.bb (adopted fix removed it in favour of the
    // redirect branch) — grep is a real assertion against the adopted
    // source, not a restatement of the ticket text.
    const src = fs.readFileSync(HANDOFFD, 'utf8');
    if (src.includes('chase-rotate-skip-not-preferred')) {
      throw new Error('handoffd.bb still contains the pre-fix skip-not-preferred path');
    }
    if (!src.includes('chase-rotate-redirect')) {
      throw new Error('handoffd.bb is missing the adopted chase-rotate-redirect path');
    }
  }, FEATURE);

  // ── Scenario 05: chase escalation on stuck in_process work keeps waking ─
  registry.defineScoped(/^a role holds in_process work that has exhausted its chase nudges past the stuck timeout$/, () => {}, FEATURE);

  registry.defineScoped(/^the stuck sweep runs$/, (ctx) => {
    ensureChaseSweep(ctx);
  }, FEATURE);

  registry.defineScoped(/^the escalation is recorded$/, (ctx) => {
    const out = ensureChaseSweep(ctx);
    assertPass(
      out, 'PASS: 06: in_process work exhausted across maxChases escalates and keeps waking',
      'expected chase-sweep scenario 06 (escalation recorded) to pass'
    );
  }, FEATURE);

  registry.defineScoped(/^a wake-up is still applied to the holding role$/, (ctx) => {
    const out = ensureChaseSweep(ctx);
    assertPass(
      out, 'PASS: 06: in_process work exhausted across maxChases escalates and keeps waking',
      'expected chase-sweep scenario 06 (wake-up kept applying) to pass'
    );
  }, FEATURE);

  registry.defineScoped(/^the nudge count advances$/, (ctx) => {
    const out = ensureChaseSweep(ctx);
    assertPass(
      out, 'PASS: 06: in_process work exhausted across maxChases escalates and keeps waking',
      'expected chase-sweep scenario 06 (nudge count advanced) to pass'
    );
  }, FEATURE);
}

module.exports = { registerSteps };
