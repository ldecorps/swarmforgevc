'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

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

test(
  'property (invariant 1): named-tunnel readiness is observed from the log, never inferred from liveness alone',
  () => {
    fc.assert(
    fc.property(noiseLinesArb, fc.boolean(), fc.nat({ max: 4 }), (noiseLines, registers, insertAt) => {
      const dir = mkTmpDir('bl787-ready-prop-');
      const binDir = path.join(dir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const opDir = path.join(dir, '.swarmforge', 'operator');
      fs.mkdirSync(opDir, { recursive: true });

      const lines = noiseLines.slice();
      const pos = Math.min(insertAt, lines.length);
      if (registers) {
        lines.splice(pos, 0, 'INF Registered tunnel connection connIndex=0');
      }
      const logDataFile = path.join(dir, 'fake-log-lines.txt');
      fs.writeFileSync(logDataFile, lines.length ? lines.join('\n') + '\n' : '');

      const fakeCloudflared = path.join(binDir, 'cloudflared');
      fs.writeFileSync(
        fakeCloudflared,
        [
          '#!/usr/bin/env bash',
          'DIR="$(cd "$(dirname "$0")" && pwd)"',
          'if [[ "$*" == *run* ]]; then',
          `  cat "${logDataFile}" 2>/dev/null`,
          '  sleep 30 &',
          '  echo $! > "$DIR/cf.pid"',
          '  wait',
          'fi',
          '',
        ].join('\n')
      );
      fs.chmodSync(fakeCloudflared, 0o755);

      const cfDir = path.join(dir, 'cloudflared-home');
      fs.mkdirSync(cfDir, { recursive: true });
      const configYml = path.join(cfDir, 'config.yml');
      fs.writeFileSync(
        configYml,
        `tunnel: 00000000-0000-0000-0000-000000000099\ncredentials-file: ${path.join(cfDir, 'cred.json')}\ningress:\n  - hostname: bubble.example.com\n    service: http://127.0.0.1:8765\n  - service: http_status:404\n`
      );
      fs.writeFileSync(path.join(cfDir, 'cred.json'), '{}');

      try {
        const result = spawnSync('bash', [LAUNCH, dir], {
          encoding: 'utf8',
          timeout: 15000,
          env: {
            ...process.env,
            CLOUDFLARED: fakeCloudflared,
            HOME: dir,
            SWARMFORGE_NAMED_TUNNEL: 'swarmforge-bubble',
            SWARMFORGE_NAMED_TUNNEL_HOSTNAME: 'bubble.example.com',
            SWARMFORGE_CLOUDFLARED_CONFIG: configYml,
            SWARMFORGE_SKIP_CAFFEINATE: '1',
            SWARMFORGE_NAMED_TUNNEL_WAIT_ATTEMPTS: '40',
            SWARMFORGE_NAMED_TUNNEL_WAIT_INTERVAL: '0.05',
          },
        });

        const stateFile = path.join(opDir, 'resident-spy-tunnel.json');
        if (registers) {
          assert.equal(result.status, 0, `expected exit 0 when the log shows registration, got ${result.status}: ${result.stderr}`);
          assert.equal(result.stdout.trim(), 'https://bubble.example.com');
          assert.equal(fs.existsSync(stateFile), true, 'expected tunnel state to be written when registration was observed');
        } else {
          assert.notEqual(
            result.status,
            0,
            `expected non-zero exit when the log never shows registration (liveness alone must not count as ready), got 0`
          );
          assert.equal(fs.existsSync(stateFile), false, 'must never write tunnel state without observed registration');
        }
      } finally {
        killPidFile(path.join(opDir, 'resident-spy-cloudflared.pid'));
        killPidFile(path.join(binDir, 'cf.pid'));
      }
    }),
      { numRuns: 10 }
    );
  },
  60000
);

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

      const env = { ...process.env, HOME: dir };
      let bin;
      let args;

      if (script === 'launcher') {
        bin = 'bash';
        args = [LAUNCH, dir];
        env.SWARMFORGE_NAMED_TUNNEL = 'swarmforge-bubble';
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

        const env = {
          ...process.env,
          CLOUDFLARED: fakeCloudflared,
          CAFFEINATE: fakeCaffeinate,
          HOME: dir,
        };
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
          env.SWARMFORGE_NAMED_TUNNEL = 'swarmforge-bubble';
          env.SWARMFORGE_NAMED_TUNNEL_HOSTNAME = 'bubble.example.com';
          env.SWARMFORGE_CLOUDFLARED_CONFIG = configYml;
        }

        try {
          const launchResult = spawnSync('bash', [LAUNCH, dir], { encoding: 'utf8', timeout: 15000, env });
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
            timeout: 15000,
            env: { ...process.env, HOME: dir },
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
  60000
);
