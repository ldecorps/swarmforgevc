'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { isolatedEnv } = require('./helpers/namedTunnelEnvIsolation');
const { fixtureTunnelName } = require('./helpers/fixtureTunnelName');

// BL-871 QA bounce D2 (2026-08-11): invariants 1 and 3 below launch real
// background subprocesses (fake cloudflared/caffeinate scripts that
// themselves fork a `sleep 30 &` and `wait`) via spawnSync, then assert on
// their real liveness/teardown. The property lane's worker-pool cap bounds
// Vitest's own fork count and heap, not the real child-process CPU those
// forks consume - under contention from other forks doing the same, QA
// measured invariant 1's existing 60000ms budget insufficient (it not only
// timed out but did so late, since the synchronous spawnSync calls block
// the event loop that would otherwise report the timeout promptly). Raised
// to comfortably exceed that; invariant 3 shares the identical
// launch/stop-real-background-process shape and the same original 60000ms
// budget, so it carries the same risk even though it was not the one QA's
// particular 3 runs happened to catch.
// BL-932: the value itself now lives in one place, imported here rather
// than hand-copied - see helpers/subprocessHeavyTimeout.js.
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

// BL-787 invariants (property authorship rests with the coder, first pass -
// BL-654). Drives the REAL launch_resident_spy_tunnel.sh /
// setup_bubble_named_tunnel.sh / check_bubble_named_tunnel_dns.sh /
// stop_ancillary_services.sh against real filesystem fixtures with stubbed
// cloudflared/caffeinate binaries (written as static bash source, never with
// fast-check-generated content interpolated into shell source - generated
// log content is written to a data file the fixture `cat`s verbatim, so
// arbitrary characters can never be interpreted as shell). Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAUNCH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'launch_resident_spy_tunnel.sh');
const SETUP = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'setup_bubble_named_tunnel.sh');
const CHECK_DNS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_bubble_named_tunnel_dns.sh');
const STOP = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'stop_ancillary_services.sh');
const OWNERSHIP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'tunnel_ownership_lib.sh');

// BL-857: named-tunnel mode now refuses any root that is not the
// registered operator root. Every fixture below launches with its own
// isolated HOME (never the real developer $HOME), so registering that
// same dir as ITS operator root exercises the real launcher's intended
// named-tunnel behavior without ever being the sandbox-binds-the-
// production-name case BL-857 forbids.
function registerOperatorRoot(dir) {
  spawnSync('bash', [OWNERSHIP_LIB, 'register-operator-root', dir], { env: { ...process.env, HOME: dir } });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPidFile(file) {
  if (!fs.existsSync(file)) return;
  const pid = Number(fs.readFileSync(file, 'utf8').trim());
  if (Number.isInteger(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

// ── Invariant 1 ──────────────────────────────────────────────────────────
// "The launcher never writes tunnel state and never sends a pairing
// notification for a base URL it has not observed the tunnel actually
// serving - process liveness alone is never treated as edge readiness."
//
// Generator reach: the fake cloudflared always stays alive for the entire
// wait window regardless of `registers` - liveness is IDENTICAL in both
// branches. The only varying signal is whether the log (surrounded by
// random noise, at a random position) ever shows the edge registration
// line. A regression that reintroduces "still alive after the wait window
// -> treat as ready" would pass this when registers=true but incorrectly
// also pass (and wrongly write state) when registers=false; the assertions
// below fail exactly that case.
const FORBIDDEN_LOG_SUBSTRINGS = [
  'Registered tunnel connection',
  'connIndex=',
  'Cannot determine default origin certificate',
  'Unable to find credentials',
  'error parsing config',
];
const noiseLineArb = fc
  .string({ maxLength: 30 })
  .filter((s) => !s.includes('\n') && !FORBIDDEN_LOG_SUBSTRINGS.some((m) => s.includes(m)));
const noiseLinesArb = fc.array(noiseLineArb, { maxLength: 4 });

// BL-1274: this property used to launch the REAL launcher against a fake
// cloudflared and assert it exited 0 - so its verdict depended on the host
// scheduling that subprocess within the launcher's readiness budget. The
// readiness evidence was already on disk before the launcher started; the only
// thing being raced was the scheduler. BL-871 widened the budget 2s -> 20s for
// exactly this red, and it recurred 18 days later, which is the signal that a
// third widening is the wrong remedy class.
//
// The launcher now guards its entry point (BL-1274), so this property SOURCES
// it and calls `wait_named_ready` directly against a log the fixture wrote and
// a pid the fixture owns. The verdict is a pure function of the log content,
// which is invariant 1's own wording, and the budget SHRINKS to 3 * 0.01s
// because nothing is being waited for any more.
//
// What moved, and where it still lives: the end-to-end half - the launcher
// echoing the hostname and writing tunnel state on success, and writing NO
// state when readiness is never observed - is asserted by
// swarmforge/scripts/test/test_launch_resident_spy_named_tunnel.sh (cases
// named-01/02/03), which spawns the real launcher once rather than ten times
// per property run. That coverage is not dropped, it is where it belongs.
const LAUNCH_SEAM_ATTEMPTS = '3';
const LAUNCH_SEAM_INTERVAL = '0.01';

test('property (invariant 1): named-tunnel readiness is observed from the log, never inferred from liveness alone', () => {
  fc.assert(
    fc.property(noiseLinesArb, fc.boolean(), fc.nat({ max: 4 }), (noiseLines, registers, insertAt) => {
      const dir = mkTmpDir('bl787-ready-prop-');
      const opDir = path.join(dir, '.swarmforge', 'operator');
      fs.mkdirSync(opDir, { recursive: true });
      registerOperatorRoot(dir);

      const lines = noiseLines.slice();
      const pos = Math.min(insertAt, lines.length);
      if (registers) {
        lines.splice(pos, 0, 'INF Registered tunnel connection connIndex=0');
      }
      // The log the launcher will read - written by the fixture, in full,
      // before anything is asked. No subprocess stands between this content
      // and the verdict.
      fs.writeFileSync(
        path.join(opDir, 'resident-spy-cloudflared.log'),
        lines.length ? `${lines.join('\n')}\n` : ''
      );

      // A live process the fixture owns: readiness must be decided by the LOG,
      // and this is the liveness that must not be mistaken for it.
      const alive = spawnSync('bash', ['-c', 'sleep 30 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' });
      const alivePid = alive.stdout.trim();
      fs.writeFileSync(path.join(opDir, 'resident-spy-cloudflared.pid'), `${alivePid}\n`);

      try {
        const probe = spawnSync(
          'bash',
          [
            '-c',
            `source ${JSON.stringify(LAUNCH)} ${JSON.stringify(dir)} >/dev/null 2>&1; ` +
              `NAMED_WAIT_ATTEMPTS=${LAUNCH_SEAM_ATTEMPTS} NAMED_WAIT_INTERVAL=${LAUNCH_SEAM_INTERVAL} ` +
              'wait_named_ready',
          ],
          { encoding: 'utf8', timeout: 15000, env: isolatedEnv({ HOME: dir, SWARMFORGE_SKIP_CAFFEINATE: '1' }) }
        );

        if (registers) {
          assert.equal(
            probe.status,
            0,
            `expected readiness when the log shows registration, got ${probe.status}: ${probe.stderr}`
          );
        } else {
          assert.notEqual(
            probe.status,
            0,
            'expected NOT ready when the log never shows registration - a live process alone must never count as ready'
          );
        }
      } finally {
        if (alivePid) {
          try {
            process.kill(Number(alivePid), 'SIGKILL');
          } catch {
            /* already gone */
          }
        }
      }
    }),
    { numRuns: 10 }
  );
});

// ── Invariant 2 ──────────────────────────────────────────────────────────
// "No tracked file supplies an operator-specific hostname, zone, or account
// as a default: named-mode identity comes only from the environment or the
// gitignored operator config, and its absence fails loud."
//
// Generator reach: crosses all three adopted scripts with which identity
// var(s) are missing (hostname / zone / both - zone is meaningless for the
// launcher, which is filtered out) and whether an unrelated operator config
// file is present as noise (launcher only) - proving presence of A file is
// never mistaken for presence of the VALUE. The `musicalsifu` assertion is
// the direct regression check: the removed script defaults literally were
// that domain, so its reappearance anywhere in output means a default crept
// back in.
const scriptCaseArb = fc.constantFrom('launcher', 'setup', 'check');
const missingArb = fc.constantFrom('hostname', 'zone', 'both');

test('property (invariant 2): absent named-tunnel identity fails loud and never falls back to a concrete operator domain', () => {
  fc.assert(
    fc.property(scriptCaseArb, missingArb, fc.boolean(), (script, missing, noiseFlag) => {
      if (script === 'launcher' && missing !== 'hostname') {
        return; // launcher has no zone concept; 'both' degenerates to 'hostname' for it
      }
      const dir = mkTmpDir('bl787-nodefault-prop-');
      const hostnameAbsent = missing === 'hostname' || missing === 'both';
      const zoneAbsent = missing === 'zone' || missing === 'both';

      const env = isolatedEnv({ HOME: dir });
      let bin;
      let args;

      if (script === 'launcher') {
        bin = 'bash';
        args = [LAUNCH, dir];
        env.SWARMFORGE_NAMED_TUNNEL = fixtureTunnelName('bl787-launcher'); // BL-1061
        registerOperatorRoot(dir);
        if (noiseFlag) {
          const opDir = path.join(dir, '.swarmforge', 'operator');
          fs.mkdirSync(opDir, { recursive: true });
          fs.writeFileSync(path.join(opDir, 'named-tunnel.env'), '# present but names no hostname\n');
        }
      } else if (script === 'setup') {
        bin = 'bash';
        args = [SETUP, dir];
        if (!hostnameAbsent) env.SWARMFORGE_NAMED_TUNNEL_HOSTNAME = 'bubble.testdomain.invalid';
        if (!zoneAbsent) env.SWARMFORGE_NAMED_TUNNEL_ZONE = 'testdomain.invalid';
      } else {
        bin = 'bash';
        args = [CHECK_DNS];
        if (!hostnameAbsent) env.SWARMFORGE_NAMED_TUNNEL_HOSTNAME = 'bubble.testdomain.invalid';
        if (!zoneAbsent) env.SWARMFORGE_NAMED_TUNNEL_ZONE = 'testdomain.invalid';
      }

      const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 10000, env });
      const output = `${result.stdout || ''}${result.stderr || ''}`;

      assert.notEqual(result.status, 0, `expected non-zero exit for ${script} missing=${missing}, got 0: ${output}`);
      assert.equal(
        /musicalsifu/i.test(output),
        false,
        `must never reveal an operator-specific default domain for ${script} missing=${missing}: ${output}`
      );

      if (script !== 'launcher') {
        const namesHostnameVar = /SWARMFORGE_NAMED_TUNNEL_HOSTNAME/.test(output);
        const namesZoneVar = /SWARMFORGE_NAMED_TUNNEL_ZONE/.test(output);
        assert.ok(
          (hostnameAbsent && namesHostnameVar) || (zoneAbsent && namesZoneVar),
          `expected the missing env var to be named for ${script} missing=${missing}: ${output}`
        );
      } else {
        assert.match(output, /SWARMFORGE_NAMED_TUNNEL_HOSTNAME/, `expected the launcher to name the missing hostname var: ${output}`);
      }
    }),
    { numRuns: 20 }
  );
});

// ── Invariant 3 ──────────────────────────────────────────────────────────
// "Every background process the launcher starts has a pidfile that the
// ancillary stop path signals."
//
// Generator reach: crosses named/quick mode with keepalive enabled/skipped
// and, rather than hardcoding today's two known pidfile names, SCANS the
// operator dir for every *.pid file the launcher actually produced and
// asserts the real stop script tears down each one - so a future background
// process wired into the launcher without a matching stop_ancillary_services
// entry fails this test the same way the caffeinate pidfile would have
// before this ticket's diff added it.
const modeArb = fc.constantFrom('named', 'quick');
const keepaliveArb = fc.constantFrom('enabled', 'skip');

test(
  'property (invariant 3): every pidfile the launcher writes is torn down by the real stop path',
  () => {
    fc.assert(
      fc.property(modeArb, keepaliveArb, (mode, keepalive) => {
        const dir = mkTmpDir('bl787-pidfile-prop-');
        const binDir = path.join(dir, 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        const opDir = path.join(dir, '.swarmforge', 'operator');
        fs.mkdirSync(opDir, { recursive: true });
        fs.writeFileSync(path.join(opDir, 'bridge-token'), 'test-token');
        registerOperatorRoot(dir);

        const fakeCloudflared = path.join(binDir, 'cloudflared');
        fs.writeFileSync(
          fakeCloudflared,
          [
            '#!/usr/bin/env bash',
            'DIR="$(cd "$(dirname "$0")" && pwd)"',
            'if [[ "$*" == *run* ]]; then',
            '  echo "INF Registered tunnel connection connIndex=0"',
            '  sleep 30 &',
            '  echo $! > "$DIR/cf.pid"',
            '  wait',
            'elif [[ "$*" == *--url* ]]; then',
            '  echo "https://fake-random.trycloudflare.com"',
            '  sleep 30 &',
            '  echo $! > "$DIR/cf.pid"',
            '  wait',
            'fi',
            '',
          ].join('\n')
        );
        fs.chmodSync(fakeCloudflared, 0o755);

        const fakeCaffeinate = path.join(binDir, 'caffeinate');
        fs.writeFileSync(
          fakeCaffeinate,
          ['#!/usr/bin/env bash', 'DIR="$(cd "$(dirname "$0")" && pwd)"', 'sleep 30 &', 'echo $! > "$DIR/caffeinate.pid"', 'wait', ''].join(
            '\n'
          )
        );
        fs.chmodSync(fakeCaffeinate, 0o755);

        const env = isolatedEnv({
          CLOUDFLARED: fakeCloudflared,
          CAFFEINATE: fakeCaffeinate,
          HOME: dir,
        });
        if (keepalive === 'skip') {
          env.SWARMFORGE_SKIP_CAFFEINATE = '1';
        }
        if (mode === 'named') {
          const configYml = path.join(dir, 'config.yml');
          fs.writeFileSync(
            configYml,
            `tunnel: 00000000-0000-0000-0000-000000000042\ncredentials-file: ${path.join(dir, 'cred.json')}\ningress:\n  - hostname: bubble.example.com\n    service: http://127.0.0.1:8765\n  - service: http_status:404\n`
          );
          fs.writeFileSync(path.join(dir, 'cred.json'), '{}');
          env.SWARMFORGE_NAMED_TUNNEL = fixtureTunnelName('bl787-launcher'); // BL-1061
          env.SWARMFORGE_NAMED_TUNNEL_HOSTNAME = 'bubble.example.com';
          env.SWARMFORGE_CLOUDFLARED_CONFIG = configYml;
        }

        try {
          // BL-871 QA bounce D2 follow-up (2026-08-11): same mechanism as
          // invariant 1's fix above - under contention it's this inner
          // spawnSync timeout, not the outer test timeout, that can kill
          // the real launch/stop subprocess. Doubled to match.
          const launchResult = spawnSync('bash', [LAUNCH, dir], { encoding: 'utf8', timeout: 30000, env });
          assert.equal(
            launchResult.status,
            0,
            `expected the launcher to succeed for mode=${mode} keepalive=${keepalive}: ${launchResult.stderr}`
          );

          const pidFiles = fs.readdirSync(opDir).filter((f) => f.endsWith('.pid'));
          assert.ok(pidFiles.length > 0, 'expected at least one pidfile after launch');
          const pids = pidFiles.map((f) => Number(fs.readFileSync(path.join(opDir, f), 'utf8').trim()));
          pids.forEach((pid, i) => {
            assert.ok(isAlive(pid), `expected pid from ${pidFiles[i]} to be alive right after launch`);
          });

          const stopResult = spawnSync('bash', [STOP, dir], {
            encoding: 'utf8',
            timeout: 30000,
            // isolatedEnv here isn't just correctness: stop_ancillary_services.sh's
            // reap_named_tunnel_orphans reads ambient SWARMFORGE_NAMED_TUNNEL to
            // scope a pgrep-based reap (BL-857) - an inherited real operator
            // tunnel name would scope this fixture's teardown to the LIVE
            // production tunnel, not just skew the assertion.
            env: isolatedEnv({ HOME: dir }),
          });
          assert.equal(stopResult.status, 0, `expected stop_ancillary_services.sh to exit 0: ${stopResult.stderr}`);

          pidFiles.forEach((f, i) => {
            assert.equal(isAlive(pids[i]), false, `expected background process behind ${f} to be signalled by the real stop path`);
            assert.equal(fs.existsSync(path.join(opDir, f)), false, `expected pidfile ${f} to be removed by the real stop path`);
          });
        } finally {
          killPidFile(path.join(binDir, 'cf.pid'));
          killPidFile(path.join(binDir, 'caffeinate.pid'));
        }
      }),
      { numRuns: 6 }
    );
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
