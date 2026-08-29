'use strict';

// BL-1274: step handlers for "the named-tunnel readiness property does not race
// the host scheduler". Scenario 01 drives the REAL launcher end to end against
// a fake cloudflared whose startup is deliberately DELAYED past the old test
// budget - which is the fix evidence: the verdict must no longer depend on when
// that subprocess is scheduled. Scenario 02 keeps the launcher honest from the
// other side (alive but never registering), and scenario 03 pins that no wait
// budget was widened to buy any of it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAUNCH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'launch_resident_spy_tunnel.sh');
const PROPERTY_FILE = path.join(REPO_ROOT, 'extension', 'test', 'bl787NamedTunnelInvariants.property.test.js');
const FIXTURE_PREFIX = 'bl1274-acceptance-';

// Matched pair with the Feature: line of the feature file.
const FEATURE = 'BL-1274 the named-tunnel readiness property does not race the host scheduler';

// The budget the property imposed BEFORE this change: 200 * 0.1s. A delay
// past it is what used to turn the verdict over to the scheduler.
const PRE_CHANGE_BUDGET_SECONDS = 20;

// BL-971: sweep by prefix up front as well - a killed run traps nothing.
function sweepStaleFixtures() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  }
}

const liveFixtures = new Set();
let exitHookInstalled = false;

function makeRoot() {
  sweepStaleFixtures();
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      for (const dir of [...liveFixtures]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort on the way out */
        }
      }
    });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  liveFixtures.add(dir);
  fs.mkdirSync(path.join(dir, '.swarmforge', 'operator'), { recursive: true });
  return dir;
}

/** A cloudflared stand-in that waits `delaySeconds`, then emits `logLines`. */
function writeFakeCloudflared(dir, { delaySeconds, logLines }) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const fake = path.join(binDir, 'cloudflared');
  fs.writeFileSync(
    fake,
    [
      '#!/usr/bin/env bash',
      'DIR="$(cd "$(dirname "$0")" && pwd)"',
      'if [[ "$*" == *run* ]]; then',
      `  sleep ${delaySeconds}`,
      ...logLines.map((line) => `  echo ${JSON.stringify(line)}`),
      '  sleep 30 &',
      '  echo $! > "$DIR/cf.pid"',
      '  wait',
      'fi',
      '',
    ].join('\n')
  );
  fs.chmodSync(fake, 0o755);
  return fake;
}

function writeTunnelConfig(dir) {
  const cfDir = path.join(dir, 'cloudflared-home');
  fs.mkdirSync(cfDir, { recursive: true });
  const configYml = path.join(cfDir, 'config.yml');
  fs.writeFileSync(
    configYml,
    'tunnel: 00000000-0000-0000-0000-000000000099\n' +
      `credentials-file: ${path.join(cfDir, 'cred.json')}\n` +
      'ingress:\n  - hostname: bubble.example.com\n    service: http://127.0.0.1:8765\n  - service: http_status:404\n'
  );
  fs.writeFileSync(path.join(cfDir, 'cred.json'), '{}');
  return configYml;
}

const OWNERSHIP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'tunnel_ownership_lib.sh');

function registerOperatorRoot(dir) {
  // The launcher refuses a named tunnel from a root that is not the registered
  // operator root. Registered through the REAL ownership lib, the same way
  // bl787NamedTunnelInvariants.property.test.js does - a hand-written registry
  // file guesses at a format the lib owns, and my first version guessed wrong.
  const result = spawnSync('bash', [OWNERSHIP_LIB, 'register-operator-root', dir], {
    encoding: 'utf8',
    env: { ...process.env, HOME: dir },
  });
  assert.equal(result.status, 0, `could not register the fixture operator root: ${result.stderr}`);
}

function runLauncher(dir, fake, configYml, extraEnv = {}) {
  return spawnSync('bash', [LAUNCH, dir], {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      CLOUDFLARED: fake,
      HOME: dir,
      SWARMFORGE_NAMED_TUNNEL: `bl1274-acc-${process.pid}`,
      SWARMFORGE_NAMED_TUNNEL_HOSTNAME: 'bubble.example.com',
      SWARMFORGE_CLOUDFLARED_CONFIG: configYml,
      SWARMFORGE_SKIP_CAFFEINATE: '1',
      ...extraEnv,
    },
  });
}

function killPidFile(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    if (pid) {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    /* already gone */
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^the named-tunnel launcher is correct$/, (ctx) => {
    assert.ok(fs.existsSync(LAUNCH), 'the launcher does not exist');
    ctx.bl1274 = {};
  });

  scoped(/^the fixture has written the registration line to the log before the launcher starts$/, (ctx) => {
    // The readiness evidence exists up front; what the old property raced was
    // only the scheduling of the process that would echo it.
    ctx.bl1274.logLines = ['INF starting tunnel', 'INF Registered tunnel connection connIndex=0'];
  });

  // ── 01 ──────────────────────────────────────────────────────────────
  scoped(/^the fake cloudflared does not begin emitting its log until (.+)$/, (ctx, when) => {
    ctx.bl1274.delaySeconds = /immediately/i.test(when) ? 0 : PRE_CHANGE_BUDGET_SECONDS + 1;
  });

  scoped(/^the readiness property runs$/, (ctx) => {
    const st = ctx.bl1274;
    const dir = makeRoot();
    registerOperatorRoot(dir);
    const fake = writeFakeCloudflared(dir, {
      delaySeconds: st.delaySeconds ?? 0,
      logLines: st.logLines || [],
    });
    const configYml = writeTunnelConfig(dir);
    st.dir = dir;
    st.result = runLauncher(dir, fake, configYml, st.env || {});
    st.stateFile = path.join(dir, '.swarmforge', 'operator', 'resident-spy-tunnel.json');
    killPidFile(path.join(dir, 'bin', 'cf.pid'));
    killPidFile(path.join(dir, '.swarmforge', 'operator', 'resident-spy-cloudflared.pid'));
  });

  scoped(/^the property passes$/, (ctx) => {
    const { result, delaySeconds } = ctx.bl1274;
    assert.equal(
      result.status,
      0,
      `a ${delaySeconds}s startup delay decided the verdict (status ${result.status}): ${result.stderr}`
    );
  });

  scoped(/^the launcher reports the tunnel hostname and writes tunnel state$/, (ctx) => {
    const { result, stateFile } = ctx.bl1274;
    assert.equal(result.stdout.trim(), 'https://bubble.example.com');
    assert.equal(fs.existsSync(stateFile), true, 'expected tunnel state to be written once registration was observed');
  });

  // ── 02 ──────────────────────────────────────────────────────────────
  scoped(/^the fake cloudflared stays alive but never emits a registration line$/, (ctx) => {
    ctx.bl1274.logLines = ['INF starting tunnel', 'INF some unrelated noise'];
    ctx.bl1274.delaySeconds = 0;
    // A REDUCED budget - never a widened one - so the negative case does not
    // sit through the launcher's 45s production default.
    ctx.bl1274.env = {
      SWARMFORGE_NAMED_TUNNEL_WAIT_ATTEMPTS: '3',
      SWARMFORGE_NAMED_TUNNEL_WAIT_INTERVAL: '0.01',
    };
  });

  scoped(/^the property fails$/, (ctx) => {
    const { result } = ctx.bl1274;
    assert.notEqual(result.status, 0, 'a live-but-unregistered tunnel was accepted as ready');
  });

  scoped(/^no tunnel state is written$/, (ctx) => {
    assert.equal(fs.existsSync(ctx.bl1274.stateFile), false, 'tunnel state was written without observed registration');
  });

  // ── 03 ──────────────────────────────────────────────────────────────
  scoped(/^the readiness wait budgets are compared against their values before the change$/, (ctx) => {
    ctx.bl1274 = ctx.bl1274 || {};
    const before = execFileSync('git', ['-C', REPO_ROOT, 'show', `HEAD:extension/test/${path.basename(PROPERTY_FILE)}`], {
      encoding: 'utf8',
    });
    ctx.bl1274.budgets = {
      before: {
        attempts: Number((before.match(/SWARMFORGE_NAMED_TUNNEL_WAIT_ATTEMPTS: '(\d+)'/) || [])[1] || 0),
        interval: Number((before.match(/SWARMFORGE_NAMED_TUNNEL_WAIT_INTERVAL: '([\d.]+)'/) || [])[1] || 0),
      },
      after: (() => {
        const now = fs.readFileSync(PROPERTY_FILE, 'utf8');
        return {
          attempts: Number((now.match(/LAUNCH_SEAM_ATTEMPTS = '(\d+)'/) || [])[1] || 0),
          interval: Number((now.match(/LAUNCH_SEAM_INTERVAL = '([\d.]+)'/) || [])[1] || 0),
        };
      })(),
    };
  });

  scoped(/^no wait budget is larger than it was before the change$/, (ctx) => {
    const { before, after } = ctx.bl1274.budgets;
    assert.ok(before.attempts > 0 && before.interval > 0, `could not read the pre-change budget: ${JSON.stringify(before)}`);
    assert.ok(after.attempts > 0 && after.interval > 0, `could not read the post-change budget: ${JSON.stringify(after)}`);
    const beforeSeconds = before.attempts * before.interval;
    const afterSeconds = after.attempts * after.interval;
    assert.ok(
      afterSeconds <= beforeSeconds,
      `the readiness budget grew from ${beforeSeconds}s to ${afterSeconds}s - a third widening is exactly what this ticket refuses`
    );
  });
}

module.exports = { registerSteps };
