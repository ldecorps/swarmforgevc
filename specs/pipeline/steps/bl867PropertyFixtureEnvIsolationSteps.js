'use strict';

// BL-867: step handlers for "the BL-787 named-tunnel property file is
// isolated from the host environment". Scenarios 01-02 drive the REAL
// `npx vitest run` of bl787NamedTunnelInvariants.property.test.js under a
// simulated contaminated vs. clean host env, proving the run's verdict is
// stable either way. Scenarios 03-04 drive the REAL
// launch_resident_spy_tunnel.sh / setup_bubble_named_tunnel.sh /
// check_bubble_named_tunnel_dns.sh scripts directly through the SAME
// isolatedEnv helper the fixture fix uses, so this feature and the
// property file's own test:properties run are proving one mechanism, never
// two independent reimplementations that could silently drift apart.
// Registered via defineScoped (BL-425 pattern): several step texts here
// are generic enough phrasing that an unscoped registration could collide
// with an unrelated feature's own step of similar wording.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const { isolatedEnv } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'namedTunnelEnvIsolation'));
const LAUNCH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'launch_resident_spy_tunnel.sh');
const SETUP = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'setup_bubble_named_tunnel.sh');
const CHECK_DNS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_bubble_named_tunnel_dns.sh');
const OWNERSHIP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'tunnel_ownership_lib.sh');
const PROPERTY_FILE = 'test/bl787NamedTunnelInvariants.property.test.js';

const FEATURE_NAME = 'BL-867 the BL-787 named-tunnel property file is isolated from the host environment';

// The literal identity a real operator host exports (see
// swarmforge/config/named-tunnel.env.example) - same domain invariant 2's
// `musicalsifu` regression check guards against leaking.
const OPERATOR_IDENTITY = Object.freeze({
  SWARMFORGE_NAMED_TUNNEL: 'swarmforge-bubble',
  SWARMFORGE_NAMED_TUNNEL_HOSTNAME: 'bubble.musicalsifu.com',
});

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function runPropertyFile(ctx) {
  const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_FILE], {
    encoding: 'utf8',
    timeout: 180000,
    cwd: EXTENSION_DIR,
    env: ctx.hostEnv,
  });
  ctx.propertyRunResult = result;
  ctx.propertyRunOutput = `${result.stdout || ''}${result.stderr || ''}`;
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the BL-787 named-tunnel property file$/,
    () => {
      /* declarative - PROPERTY_FILE names it for every step below */
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a host environment exporting the operator's live named-tunnel identity$/,
    (ctx) => {
      ctx.hostEnv = { ...process.env, ...OPERATOR_IDENTITY };
    },
    FEATURE_NAME
  );

  // ── property-fixture-env-isolation-02 ────────────────────────────────
  registry.defineScoped(
    /^the named-tunnel identity is removed from the host environment$/,
    (ctx) => {
      const env = { ...ctx.hostEnv };
      delete env.SWARMFORGE_NAMED_TUNNEL;
      delete env.SWARMFORGE_NAMED_TUNNEL_HOSTNAME;
      delete env.SWARMFORGE_NAMED_TUNNEL_ZONE;
      delete env.SWARMFORGE_CLOUDFLARED_CONFIG;
      ctx.hostEnv = env;
    },
    FEATURE_NAME
  );

  // ── property-fixture-env-isolation-01 / -02 ──────────────────────────
  registry.defineScoped(
    /^the property file is run$/,
    (ctx) => {
      runPropertyFile(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the run passes$/,
    (ctx) => {
      if (ctx.propertyRunResult.status !== 0) {
        throw new Error(`expected the property file run to pass, got exit ${ctx.propertyRunResult.status}:\n${ctx.propertyRunOutput}`);
      }
    },
    FEATURE_NAME
  );

  // ── property-fixture-env-isolation-03 (Scenario Outline) ────────────
  const SCRIPTS = {
    'launch_resident_spy_tunnel.sh': LAUNCH,
    'setup_bubble_named_tunnel.sh': SETUP,
    'check_bubble_named_tunnel_dns.sh': CHECK_DNS,
  };

  registry.defineScoped(
    /^the absent-identity case for (launch_resident_spy_tunnel\.sh|setup_bubble_named_tunnel\.sh|check_bubble_named_tunnel_dns\.sh) runs$/,
    (ctx, scriptName) => {
      const bin = SCRIPTS[scriptName];
      const dir = mkTmp('bl867-absent-case-');
      const ambient = ctx.hostEnv || process.env;
      const overrides = { HOME: dir };
      const args = [bin];

      if (scriptName === 'launch_resident_spy_tunnel.sh') {
        overrides.SWARMFORGE_NAMED_TUNNEL = 'swarmforge-bubble';
        // BL-857: named-tunnel mode refuses any root that is not the
        // registered operator root - this isolated HOME registers itself,
        // never the real operator's root.
        spawnSync('bash', [OWNERSHIP_LIB, 'register-operator-root', dir], { env: { ...process.env, HOME: dir } });
        args.push(dir);
      } else {
        overrides.SWARMFORGE_NAMED_TUNNEL_ZONE = 'testdomain.invalid';
        if (scriptName === 'setup_bubble_named_tunnel.sh') {
          args.push(dir);
        }
      }

      const env = isolatedEnv(overrides, ambient);
      ctx.scriptResult = spawnSync('bash', args, { encoding: 'utf8', timeout: 10000, env });
      ctx.scriptOutput = `${ctx.scriptResult.stdout || ''}${ctx.scriptResult.stderr || ''}`;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^(?:launch_resident_spy_tunnel\.sh|setup_bubble_named_tunnel\.sh|check_bubble_named_tunnel_dns\.sh) exits non-zero$/,
    (ctx) => {
      if (ctx.scriptResult.status === 0) {
        throw new Error(`expected non-zero exit, got 0: ${ctx.scriptOutput}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its output names the environment variable it is missing$/,
    (ctx) => {
      if (!/SWARMFORGE_NAMED_TUNNEL_HOSTNAME/.test(ctx.scriptOutput)) {
        throw new Error(`expected output to name the missing SWARMFORGE_NAMED_TUNNEL_HOSTNAME var, got: ${ctx.scriptOutput}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its output never contains the operator's own domain$/,
    (ctx) => {
      if (/musicalsifu/i.test(ctx.scriptOutput)) {
        throw new Error(`expected output to never leak the operator's real domain, got: ${ctx.scriptOutput}`);
      }
    },
    FEATURE_NAME
  );

  // ── property-fixture-env-isolation-04 ────────────────────────────────
  registry.defineScoped(
    /^the quick-tunnel pidfile case runs$/,
    (ctx) => {
      const dir = mkTmp('bl867-quick-case-');
      const binDir = path.join(dir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      spawnSync('bash', [OWNERSHIP_LIB, 'register-operator-root', dir], { env: { ...process.env, HOME: dir } });

      const fakeCloudflared = path.join(binDir, 'cloudflared');
      fs.writeFileSync(
        fakeCloudflared,
        [
          '#!/usr/bin/env bash',
          'DIR="$(cd "$(dirname "$0")" && pwd)"',
          'if [[ "$*" == *--url* ]]; then',
          '  echo "https://fake-random.trycloudflare.com"',
          '  sleep 30 &',
          '  echo $! > "$DIR/cf.pid"',
          '  wait',
          'fi',
          '',
        ].join('\n')
      );
      fs.chmodSync(fakeCloudflared, 0o755);

      const ambient = ctx.hostEnv || process.env;
      const env = isolatedEnv(
        {
          CLOUDFLARED: fakeCloudflared,
          HOME: dir,
          SWARMFORGE_SKIP_CAFFEINATE: '1',
        },
        ambient
      );
      ctx.quickBinDir = binDir;
      ctx.launchResult = spawnSync('bash', [LAUNCH, dir], { encoding: 'utf8', timeout: 15000, env });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the launcher serves a quick-tunnel URL$/,
    (ctx) => {
      const stdout = (ctx.launchResult.stdout || '').trim();
      if (stdout !== 'https://fake-random.trycloudflare.com') {
        throw new Error(`expected the quick-tunnel URL, got: "${stdout}" (stderr: ${ctx.launchResult.stderr})`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it does not serve the exported named hostname$/,
    (ctx) => {
      const stdout = (ctx.launchResult.stdout || '').trim();
      if (stdout.includes(OPERATOR_IDENTITY.SWARMFORGE_NAMED_TUNNEL_HOSTNAME)) {
        throw new Error(`expected the launcher to never serve the operator's named hostname, got: ${stdout}`);
      }
      killPidFile(path.join(ctx.quickBinDir, 'cf.pid'));
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
