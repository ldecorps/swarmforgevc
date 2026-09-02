'use strict';

// BL-1321: BL-848 stamp-off of Cursor hotfix 3d70c0f4ec, "Yield chase rotate
// when preferred role is already seated."
//
// This CONFIRMS OR REFUTES what landed. It reimplements nothing, changes no
// hotfix source line, re-line-ends nothing, removes no landed assert, and
// writes nothing to the ledger (invariants 1 and 2, and the ticket's
// constraints).
//
// Scenario 01 EXECUTES the real `chase-rotate-decision` from the real
// `mono_router_lib.bb`, through lib/bl1321ChaseRotateDecisionCli.bb - a
// source-text assertion cannot tell a wired gate from a dead one, and the
// deadlock under review was a redirect that read correctly and sent the
// resident nowhere.
//
// Scenario 03 states the STALE-MARKER direction rather than assuming the
// marker is sound: the gate deliberately reads the
// .swarmforge/mono-router-active-role marker and never the live resident
// identity, and this repo already has a named staleness hazard for that
// marker (relaunch_resume_cli.bb's "BL-1020 STALE").

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'Swarm stamp-off for the seated-preferred chase-rotate yield';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HOTFIX = '3d70c0f4ec';
const DECISION_CLI = path.join(__dirname, 'lib', 'bl1321ChaseRotateDecisionCli.bb');
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

// The two files commit 3d70c0f4ec converted CRLF -> LF in full. Named
// explicitly so scenario 04 reports a FIXED list rather than whatever the
// diff happens to show.
const RELINE_ENDED = [
  'swarmforge/scripts/mono_router_lib.bb',
  'swarmforge/scripts/test/mono_router_lib_test_runner.bb',
];

function git(...args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
}

// Explicit KNOWN_VALUES for the Outline - an Outline that accepts any
// placeholder text asserts nothing about which case was exercised.
const KNOWN_ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'none'];
const KNOWN_ACTIONABLE = { yes: true, no: false };
const KNOWN_ACTIONS = ['redirect', 'skip-broadcast', 'rotate'];

function roleOrNull(value) {
  assert.ok(KNOWN_ROLES.includes(value), `unknown role "${value}"`);
  return value === 'none' ? null : value;
}

function decide(ctx) {
  const args = JSON.stringify({
    preferred: ctx.bl1321.preferred,
    poked: ctx.bl1321.poked,
    seated: ctx.bl1321.seated,
    actionable: ctx.bl1321.actionable,
  });
  const out = execFileSync('bb', [DECISION_CLI, args], { encoding: 'utf8' }).trim();
  return JSON.parse(out.split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background: the reviewed tree IS the landed hotfix ──────────────────

  scoped(/^the landed sources at commit 3d70c0f4ec$/, (ctx) => {
    ctx.bl1321 = {};
    assert.equal(git('cat-file', '-t', HOTFIX).trim(), 'commit', `${HOTFIX} must be reachable`);
    assert.match(
      git('log', '-1', '--format=%B', HOTFIX),
      /Hotfix-Certification:\s*pending/,
      `${HOTFIX} is not pending certification - a stamp-off has nothing to review`
    );
  });

  // ── Given ───────────────────────────────────────────────────────────────

  scoped(/^a preferred actionable role "([^"]+)"$/, (ctx, preferred) => {
    ctx.bl1321 = ctx.bl1321 ?? {};
    ctx.bl1321.preferred = roleOrNull(preferred);
  });

  scoped(/^a chase poke for role "([^"]+)"$/, (ctx, poked) => {
    ctx.bl1321.poked = roleOrNull(poked);
  });

  scoped(/^a mono-router active-role marker naming "([^"]+)"$/, (ctx, seated) => {
    ctx.bl1321.seated = roleOrNull(seated);
  });

  scoped(/^the poked role's mail is actionable "([^"]+)"$/, (ctx, actionable) => {
    assert.ok(actionable in KNOWN_ACTIONABLE, `unknown actionable value "${actionable}"`);
    ctx.bl1321.actionable = KNOWN_ACTIONABLE[actionable];
  });

  // Scenario 03: the live resident disagrees with the marker. The gate must
  // not consult it - that is the landed design, stated in its own docstring.
  scoped(/^a live resident that is not "([^"]+)"$/, (ctx, notThis) => {
    roleOrNull(notThis);
    ctx.bl1321.liveResidentDiffers = true;
    const source = git('show', `${HOTFIX}:swarmforge/scripts/mono_router_lib.bb`);
    assert.match(
      source,
      /Live-role is intentionally NOT consulted here/,
      'the landed gate must state that it ignores the live resident identity'
    );
  });

  // ── When ────────────────────────────────────────────────────────────────

  scoped(/^the chase rotate gate decides$/, (ctx) => {
    ctx.bl1321.decision = decide(ctx);
  });

  scoped(/^the daemon performs the chase rotate$/, (ctx) => {
    // The gate itself is executed; the daemon's logging around it is read
    // from the landed dispatch below. Driving handoffd's real chase-rotate-to!
    // would require a live socket and tmux, which is the environmentally
    // unsuitable boundary - the evidence file states this limit rather than
    // implying the log line was observed live.
    ctx.bl1321.decision = decide(ctx);
    ctx.bl1321.handoffd = fs.readFileSync(HANDOFFD, 'utf8');
  });

  scoped(/^the review completes with every scenario green$/, (ctx) => {
    ctx.bl1321.reviewGreen = true;
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^the decided action is "([^"]+)"$/, (ctx, action) => {
    assert.ok(KNOWN_ACTIONS.includes(action), `unknown action "${action}"`);
    assert.equal(ctx.bl1321.decision.action, action);
  });

  scoped(/^the decided target is "([^"]+)"$/, (ctx, target) => {
    assert.ok(KNOWN_ROLES.includes(target), `unknown target "${target}"`);
    assert.equal(ctx.bl1321.decision.target, target);
  });

  scoped(/^the daemon logs a seated-preferred yield naming "([^"]+)" and "([^"]+)"$/, (ctx, preferred, poked) => {
    roleOrNull(preferred);
    roleOrNull(poked);
    // The gate really did choose :rotate for this input.
    assert.equal(ctx.bl1321.decision.action, 'rotate');
    // And the landed dispatch logs the yield with exactly (preferred, role),
    // guarded so it fires ONLY when preferred is seated and is not the poke.
    const source = ctx.bl1321.handoffd;
    assert.match(source, /log!\s+"chase-rotate-seated-preferred-yield"\s+preferred\s+role/);
    assert.match(
      source,
      /\(when \(and preferred active\s*\n\s*\(= \(str preferred\) \(str active\)\)\s*\n\s*\(not= \(str preferred\) \(str role\)\)\)/,
      'the yield log must be guarded on preferred==seated AND preferred!=poked'
    );
  });

  scoped(/^the daemon logs no chase rotate redirect for that poke$/, (ctx) => {
    // chase-rotate-redirect is logged only on the :redirect arm, and this
    // input decided :rotate - so no redirect is logged for this poke.
    assert.notEqual(ctx.bl1321.decision.action, 'redirect');
    assert.match(
      ctx.bl1321.handoffd,
      /:redirect\s*\n\s*\(do \(log!\s+"chase-rotate-redirect"/,
      'the redirect log must sit on the :redirect arm only'
    );
  });

  // Invariant 3, and the stale-marker direction the approval_context asks for.
  scoped(/^the review records that a stale marker suppresses the redirect this hotfix preserves$/, (ctx) => {
    assert.equal(ctx.bl1321.liveResidentDiffers, true);
    // The recorded direction, EXECUTED: a marker that wrongly names the
    // preferred role as seated turns a BL-795 redirect into a rotate. That is
    // the cost of reading the marker, and it is the safe direction - the poked
    // actionable role still gets the resident, so mail moves rather than
    // deadlocking. The unsafe direction would be silence.
    assert.equal(ctx.bl1321.decision.action, 'rotate');
    assert.equal(ctx.bl1321.decision.target, ctx.bl1321.poked);

    // Invariant 3 proper: with the marker naming anyone OTHER than preferred,
    // BL-795's redirect still fires. The yield narrows it, never replaces it.
    const stillRedirects = decide({
      bl1321: { preferred: 'QA', poked: 'specifier', seated: 'coder', actionable: true },
    });
    assert.deepEqual(stillRedirects, { action: 'redirect', target: 'QA' });
  });

  // Scenario 04: REPORT the line-ending normalisation; leave it as landed.
  scoped(/^the review records which files commit 3d70c0f4ec re-line-ended$/, (ctx) => {
    const touched = git('show', '--stat', '--format=', HOTFIX);
    for (const file of RELINE_ENDED) {
      assert.ok(touched.includes(path.basename(file)), `${file} must appear in the commit`);
    }
    // The re-line-ending is why the diff reads huge: the real change is small.
    const real = git('diff', '--ignore-cr-at-eol', '--shortstat', `${HOTFIX}^`, HOTFIX);
    assert.match(real, /96 insertions\(\+\), 34 deletions\(-\)/, `real change size moved: ${real}`);
    ctx.bl1321.relineEnded = RELINE_ENDED;
  });

  scoped(/^those files are left as the commit landed them$/, (ctx) => {
    for (const file of ctx.bl1321.relineEnded) {
      // Byte-identical to what the commit landed - this parcel has not
      // re-line-ended them back, nor touched them at all.
      const diff = git('diff', HOTFIX, 'HEAD', '--', file);
      assert.equal(diff.trim(), '', `${file} differs from what ${HOTFIX} landed`);
      // And still LF: no CR at any line end.
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      assert.ok(!content.includes('\r\n'), `${file} has regained CRLF line endings`);
    }
    const dirty = git('status', '--porcelain', '--', ...ctx.bl1321.relineEnded).trim();
    assert.equal(dirty, '', 'this parcel must not modify the re-line-ended files');
  });

  // Invariant 2: green scenarios leave the ledger row exactly as found.
  scoped(/^the hotfix ledger entry for commit 3d70c0f4ec is still awaiting a human decision$/, (ctx) => {
    assert.equal(ctx.bl1321.reviewGreen, true);
    const ledger = fs.readFileSync(LEDGER, 'utf8');
    const entry = ledger.split(/\n(?=\s*-\s)/).find((block) => block.includes(HOTFIX));
    assert.ok(entry, `no hotfix-ledger entry for ${HOTFIX}`);
    assert.match(entry, /state:\s*(pending|awaiting-human|stamp-open)/, `ledger row is no longer awaiting a human: ${entry}`);
    assert.doesNotMatch(entry, /state:\s*(certified|waived)/);
    assert.equal(
      git('status', '--porcelain', '--', 'backlog/hotfix-ledger.yaml').trim(),
      '',
      'a stamp-off must never modify the hotfix ledger'
    );
  });
}

module.exports = { registerSteps };
