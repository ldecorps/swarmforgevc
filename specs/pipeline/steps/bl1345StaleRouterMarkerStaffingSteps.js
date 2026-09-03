'use strict';

// BL-1345: step handlers for the two halves the RC-repair hotfix left - the
// health sweep reading the resident marker on a standing pack, and a recheck
// that called a wrongly-respawned pane healthy.
//
// Both drive the REAL decisions: mono_router_lib's resolve-resident-role (the
// one shared rule the hotfix routed through) composed exactly as
// babysitter_check.bb now composes it, and remote_control_health_lib's
// assigned-role-mismatch. Nothing here restates either.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const MONO_ROUTER_LIB = path.join(SCRIPTS, 'mono_router_lib.bb');
const RC_HEALTH_LIB = path.join(SCRIPTS, 'remote_control_health_lib.bb');
const SWEEP = path.join(SCRIPTS, 'babysitter_check.bb');
const ROLES = ['specifier', 'coder', 'cleaner', 'QA'];
const HOME = 'specifier';

function bb(expression, lib) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${lib}")
(println (json/generate-string ${expression}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  const out = r.stdout.trim().split('\n').pop();
  return JSON.parse(out);
}

function state(ctx) {
  if (!ctx.bl1345) ctx.bl1345 = {};
  return ctx.bl1345;
}

// The sweep's own composition, read from babysitter_check.bb so this cannot
// drift into testing a private copy of the rule.
function sweepResident({ rotationRouter, marker }) {
  const decision = bb(
    `(mono-router-lib/resolve-resident-role
       {:rotation-router? ${rotationRouter ? 'true' : 'false'}
        :recorded-role ${marker === null || marker === undefined ? 'nil' : JSON.stringify(marker)}
        :home-role "${HOME}"})`,
    MONO_ROUTER_LIB,
  );
  const candidate = decision['honour-marker?'] ? decision.role : null;
  return ROLES.includes(candidate) ? candidate : null;
}

const MARKER_STATE = { absent: null, unreadable: '   ', 'naming an unknown role': 'nosuchrole' };

const FEATURE = 'BL-1345 a mis-staffed pane is detected, and the resident marker is not read where it does not apply';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a standing pack is running, with every role in its own pane$/, (ctx) => {
    const st = state(ctx);
    st.rotationRouter = false;
    // The sweep must not merely MENTION the shared decision - it must derive
    // resident-active-role from it. The whole defect was a third consumer
    // that read the raw marker, and a version that computes the decision and
    // then ignores it would satisfy a bare grep while behaving exactly as
    // before (which is what a first pass of this assertion let through).
    const source = require('node:fs').readFileSync(SWEEP, 'utf8');
    assert.match(source, /resolve-resident-role/, 'babysitter_check.bb no longer uses the shared decision');
    const binding = source.slice(source.indexOf('resident-active-role ('));
    assert.ok(binding.length > 0, 'the sweep no longer binds resident-active-role at all');
    assert.doesNotMatch(
      binding.slice(0, binding.indexOf('\n\n')),
      /^resident-active-role \(active-role-marker\)/m,
      'the sweep binds resident-active-role straight from the raw marker again',
    );
    assert.match(
      binding.slice(0, 400),
      /honour-marker\?|resident-decision/,
      'resident-active-role is not derived from the shared decision',
    );
  });

  scoped(/^a rotation-router pack is running$/, (ctx) => {
    state(ctx).rotationRouter = true;
  });

  scoped(/^a leftover resident marker naming a role$/, (ctx) => {
    state(ctx).marker = 'coordinator';
  });

  scoped(/^a resident marker naming a known role$/, (ctx) => {
    state(ctx).marker = 'coder';
  });

  scoped(/^a resident marker that is "?([^"]+)"?$/, (ctx, kind) => {
    const st = state(ctx);
    assert.ok(kind in MARKER_STATE, `unknown marker state: ${kind}`);
    st.marker = MARKER_STATE[kind];
  });

  scoped(/^the health sweep gathers its facts$/, (ctx) => {
    const st = state(ctx);
    st.resident = sweepResident({ rotationRouter: st.rotationRouter, marker: st.marker });
  });

  scoped(/^it reports no resident role for this pack$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.resident, null, `the sweep derived a resident from an unusable marker: ${st.resident}`);
  });

  scoped(/^it reports that role as the resident$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.resident, 'coder', `the router pack lost its resident: ${st.resident}`);
  });

  scoped(/^a pane running a role other than the one its pack assigns it$/, (ctx) => {
    const st = state(ctx);
    st.pane = { pane: 'swarmforge-specifier', assigned: 'SwarmForge-Specifier', observed: 'SwarmForge-Coordinator' };
  });

  scoped(/^a pane running the role its pack assigns it$/, (ctx) => {
    const st = state(ctx);
    st.pane = { pane: 'swarmforge-coder', assigned: 'SwarmForge-Coder', observed: 'SwarmForge-Coder' };
  });

  scoped(/^the health of that pane is rechecked$/, (ctx) => {
    const st = state(ctx);
    st.mismatch = bb(
      `(remote-control-health/assigned-role-mismatch
         {:rotation-router? ${st.rotationRouter ? 'true' : 'false'}
          :pane "${st.pane.pane}"
          :assigned-rc-name "${st.pane.assigned}"
          :observed-rc-name "${st.pane.observed}"})`,
      RC_HEALTH_LIB,
    );
  });

  scoped(/^it is not reported healthy$/, (ctx) => {
    const st = state(ctx);
    assert.notEqual(st.mismatch, null, 'a pane running the wrong role was not flagged');
  });

  scoped(/^the report names the pane, the expected role and the observed one$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.mismatch.pane, st.pane.pane);
    assert.equal(st.mismatch.expected, st.pane.assigned);
    assert.equal(st.mismatch.observed, st.pane.observed);
  });

  scoped(/^it is reported healthy$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.mismatch, null, `a correctly staffed pane was flagged: ${JSON.stringify(st.mismatch)}`);
  });
}

module.exports = { registerSteps };
