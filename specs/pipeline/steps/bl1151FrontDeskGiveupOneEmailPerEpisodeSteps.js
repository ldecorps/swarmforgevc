'use strict';

// BL-1151: front-desk give-up escalation once per unbroken outage episode.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'Front-desk give-up escalation emails once per unbroken outage episode';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const EPISODE_TEST = path.join(SCRIPTS, 'test', 'test_front_desk_giveup_one_email_per_episode.sh');
const OPERATOR_LIB_TEST = path.join(SCRIPTS, 'test', 'operator_lib_test_runner.bb');
const PROPERTY_RUNNER = path.join(SCRIPTS, 'test', 'bl1151_giveup_escalation_alarm_property_runner.bb');

function runScript(script, ctx, key) {
  if (ctx[key]) {
    return ctx[key];
  }
  const result = spawnSync('bash', [script], { encoding: 'utf8', timeout: 120000, cwd: REPO_ROOT });
  ctx[key] = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0) {
    throw new Error(`${script} failed:\n${ctx[key]}`);
  }
  return ctx[key];
}

function runBb(script, ctx, key) {
  if (ctx[key]) {
    return ctx[key];
  }
  const result = spawnSync('bb', [script], { encoding: 'utf8', timeout: 60000, cwd: REPO_ROOT });
  ctx[key] = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0) {
    throw new Error(`${script} failed:\n${ctx[key]}`);
  }
  return ctx[key];
}

function assertPassMarker(out, marker, label) {
  if (!out.includes(marker)) {
    throw new Error(`expected ${label} (${marker}) in:\n${out}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the front-desk supervisor escalates give-up via daemon-alarm email$/, () => {});

  scoped(/^give-up cooldown re-arms the child with a fresh attempt budget$/, () => {});

  scoped(/^the bridge has entered give-up and an escalation email was delivered$/, (ctx) => {
    runScript(EPISODE_TEST, ctx, 'bl1151EpisodeTest');
  });

  scoped(/^the child has not been observably healthy since that give-up$/, () => {});

  scoped(/^give-up cooldown elapses and the child re-arms then burns its attempt budget again$/, () => {});

  scoped(/^no second escalation email is sent for that same unbroken episode$/, (ctx) => {
    assertPassMarker(
      runScript(EPISODE_TEST, ctx, 'bl1151EpisodeTest'),
      'bl-1151-01: no second escalation email in the loop',
      'bl-1151-01 no-second-email'
    );
  });

  scoped(/^a prior give-up episode already emailed once$/, (ctx) => {
    runScript(EPISODE_TEST, ctx, 'bl1151EpisodeTest');
  });

  scoped(/^the child later stays observably healthy for the grace window$/, () => {});

  scoped(/^the child later exhausts its restart budget again$/, () => {});

  scoped(/^a new escalation email may be sent for the new episode$/, (ctx) => {
    assertPassMarker(
      runScript(EPISODE_TEST, ctx, 'bl1151EpisodeTest'),
      'bl-1151-02: a new episode after healthy grace may email again',
      'bl-1151-02 new-episode-email'
    );
  });

  scoped(/^escalation was armed after a delivered give-up email$/, (ctx) => {
    runBb(OPERATOR_LIB_TEST, ctx, 'bl1151OperatorLib');
    runBb(PROPERTY_RUNNER, ctx, 'bl1151Property');
  });

  scoped(/^status leaves gave-up only because of cooldown re-arm \(no healthy grace\)$/, () => {});

  scoped(/^escalation arming stays such that the next give-up of the same episode does not email again$/, (ctx) => {
    assertPassMarker(
      runScript(EPISODE_TEST, ctx, 'bl1151EpisodeTest'),
      'bl-1151-03: re-arm without healthy grace keeps escalation armed',
      'bl-1151-03 re-arm-keeps-armed'
    );
    const prop = runBb(PROPERTY_RUNNER, ctx, 'bl1151Property');
    if (!prop.includes('ALL TESTS PASSED')) {
      throw new Error(`property runner failed:\n${prop}`);
    }
  });
}

module.exports = { registerSteps };
