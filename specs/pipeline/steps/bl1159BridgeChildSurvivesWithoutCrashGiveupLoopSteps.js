'use strict';

// BL-1159: front-desk bridge child must not crash-loop from miniapp watchdog SIGTERM.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  'the front-desk bridge child stays up after cold start without a crash give-up loop';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ACCEPTANCE_TEST = path.join(
  REPO_ROOT,
  'swarmforge/scripts/test/test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh'
);
const RECOVER_TEST = path.join(REPO_ROOT, 'swarmforge/scripts/test/test_recover_miniapp_bridge.sh');
const STOP_DEFER_TEST = path.join(REPO_ROOT, 'swarmforge/scripts/test/test_start_stop_bridge_headless.sh');

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

function assertPassMarker(out, marker, label) {
  if (!out.includes(marker)) {
    throw new Error(`expected ${label} (${marker}) in:\n${out}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a cold front-desk supervisor start with Telegram configured$/, () => {});
  scoped(/^extension\/out\/BUILD_SHA matches the current git HEAD$/, () => {});

  scoped(/^the supervisor starts the bridge child$/, (ctx) => {
    runScript(RECOVER_TEST, ctx, 'bl1159RecoverTest');
    runScript(STOP_DEFER_TEST, ctx, 'bl1159StopDeferTest');
  });

  scoped(/^ten minutes elapse with no manual re-arm$/, () => {});

  scoped(/^the front-desk status JSON shows bridge status running$/, (ctx) => {
    assertPassMarker(
      runScript(ACCEPTANCE_TEST, ctx, 'bl1159Acceptance'),
      'bl-1159-01: bridge pid survives healthy miniapp watchdog ticks',
      'bl-1159-01 stable pid'
    );
  });

  scoped(/^the bridge pid is unchanged from its post-start value$/, (ctx) => {
    assertPassMarker(
      runScript(ACCEPTANCE_TEST, ctx, 'bl1159Acceptance'),
      'bl-1159-01: bridge pid survives healthy miniapp watchdog ticks',
      'bl-1159-01 unchanged pid'
    );
  });

  scoped(/^the bridge has reached running status after cold start$/, () => {});

  scoped(/^lets-talk is probed every minute for ten minutes$/, () => {});

  scoped(/^every probe to http:\/\/127\.0\.0\.1:8765\/lets-talk succeeds$/, (ctx) => {
    assertPassMarker(
      runScript(ACCEPTANCE_TEST, ctx, 'bl1159Acceptance'),
      'bl-1159-02: every /lets-talk probe succeeds',
      'bl-1159-02 lets-talk'
    );
  });

  scoped(/^the supervisor runs through the ten-minute stable window$/, () => {});

  scoped(
    /^the log contains no repeated crashed bridge entries without an intervening healthy period$/,
    (ctx) => {
      assertPassMarker(
        runScript(ACCEPTANCE_TEST, ctx, 'bl1159Acceptance'),
        'bl-1159-03: bridge child still alive after miniapp recovery tick',
        'bl-1159-03 no crash loop'
      );
    }
  );

  scoped(/^the log contains no gave-up bridge cycle within that window$/, (ctx) => {
    assertPassMarker(
      runScript(ACCEPTANCE_TEST, ctx, 'bl1159Acceptance'),
      'bl-1159-03: down bridge uses recover (rearm) not bounce kill stub',
      'bl-1159-03 no give-up'
    );
  });

  scoped(/^the resident-spy route is probed on the bridge listen port$/, () => {});

  scoped(/^the response status is 200$/, (ctx) => {
    assertPassMarker(
      runScript(ACCEPTANCE_TEST, ctx, 'bl1159Acceptance'),
      'bl-1159-04: resident-spy route returns 200 on bridge port',
      'bl-1159-04 resident-spy'
    );
    assertPassMarker(
      runScript(ACCEPTANCE_TEST, ctx, 'bl1159Acceptance'),
      'ALL CHECKS PASSED',
      'bl-1159 acceptance'
    );
  });
}

module.exports = { registerSteps };
