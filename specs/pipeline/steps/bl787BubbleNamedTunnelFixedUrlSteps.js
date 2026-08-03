'use strict';

// BL-787: step handlers for "Bubble reaches the bridge on a fixed
// named-tunnel URL". Drives the REAL launch_resident_spy_tunnel.sh,
// setup_bubble_named_tunnel.sh, and stop_ancillary_services.sh against a
// real filesystem fixture with stubbed cloudflared/caffeinate/dig binaries
// on PATH - no live Cloudflare account, no network. Registered via
// defineScoped (BL-425 pattern): several step texts here ("it exits
// non-zero", generic setup/keepalive phrasing) are plausible enough that an
// unscoped registration could collide with an unrelated feature's own step
// of similar wording; scoping to this exact Feature: title means this
// file's registrations are only ever preferred while THIS feature runs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAUNCH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'launch_resident_spy_tunnel.sh');
const SETUP = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'setup_bubble_named_tunnel.sh');
const STOP = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'stop_ancillary_services.sh');

const FEATURE_NAME = 'Bubble reaches the bridge on a fixed named-tunnel URL';
const TUNNEL_UUID = '22222222-2222-2222-2222-222222222222';
const BRIDGE_PORT = 8765;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

// Static fake cloudflared: dispatches on argv shape so both the launcher
// (`tunnel --url ...` / `tunnel --config ... run ...`) and the setup script
// (`tunnel login` / `tunnel list` / `tunnel create` / `tunnel route dns`)
// are served by one fixture. FAKE_CLOUDFLARED_NEVER_REGISTER suppresses the
// "Registered tunnel connection" line for named-03 without needing a
// second binary.
function writeFakeCloudflared(binDir) {
  const p = path.join(binDir, 'cloudflared');
  fs.writeFileSync(
    p,
    [
      '#!/usr/bin/env bash',
      'DIR="$(cd "$(dirname "$0")" && pwd)"',
      `echo "cloudflared-call: $*" >> "$DIR/cf-calls.log"`,
      'case "$1 $2" in',
      '  "tunnel login") exit 0 ;;',
      `  "tunnel list") echo '[{"name":"swarmforge-bubble","id":"${TUNNEL_UUID}"}]'; exit 0 ;;`,
      `  "tunnel create") echo "Created tunnel swarmforge-bubble with id ${TUNNEL_UUID}"; exit 0 ;;`,
      '  "tunnel route") exit 0 ;;',
      'esac',
      'if [[ "$*" == *run* ]]; then',
      '  if [[ -z "${FAKE_CLOUDFLARED_NEVER_REGISTER:-}" ]]; then',
      '    echo "INF Registered tunnel connection connIndex=0"',
      '  fi',
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
  fs.chmodSync(p, 0o755);
}

function writeFakeCaffeinate(binDir) {
  const p = path.join(binDir, 'caffeinate');
  fs.writeFileSync(
    p,
    ['#!/usr/bin/env bash', 'DIR="$(cd "$(dirname "$0")" && pwd)"', 'sleep 30 &', 'echo $! > "$DIR/caffeinate.pid"', 'wait', ''].join(
      '\n'
    )
  );
  fs.chmodSync(p, 0o755);
}

function writeFakeDig(binDir) {
  const p = path.join(binDir, 'dig');
  fs.writeFileSync(
    p,
    [
      '#!/usr/bin/env bash',
      'if [[ "$*" == *NS* ]]; then',
      '  if [[ -n "${FAKE_DIG_CLOUDFLARE:-}" ]]; then',
      '    echo "ns1.cloudflare.com."',
      '    echo "ns2.cloudflare.com."',
      '  else',
      '    echo "ns15.domaincontrol.com."',
      '    echo "ns16.domaincontrol.com."',
      '  fi',
      'fi',
      'exit 0',
      '',
    ].join('\n')
  );
  fs.chmodSync(p, 0o755);
}

function runLauncher(ctx) {
  ctx.launchResult = spawnSync('bash', [LAUNCH, ctx.root], {
    encoding: 'utf8',
    timeout: 15000,
    env: ctx.env,
  });
}

function stateFile(ctx) {
  return path.join(ctx.opDir, 'resident-spy-tunnel.json');
}

function cfCallsLog(ctx) {
  return path.join(ctx.binDir, 'cf-calls.log');
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a project root whose bridge listens on the configured port$/,
    (ctx) => {
      ctx.root = mkTmp('bl787-aps-root-');
      ctx.opDir = path.join(ctx.root, '.swarmforge', 'operator');
      fs.mkdirSync(ctx.opDir, { recursive: true });
      fs.writeFileSync(path.join(ctx.opDir, 'bridge-token'), 'aps-test-token');
      ctx.binDir = path.join(ctx.root, 'bin');
      fs.mkdirSync(ctx.binDir, { recursive: true });
      ctx.port = BRIDGE_PORT;
      ctx.env = {
        ...process.env,
        HOME: ctx.root,
        PATH: `${ctx.binDir}:${process.env.PATH}`,
        BRIDGE_PORT: String(BRIDGE_PORT),
      };
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^cloudflared and the idle-keepalive binary are stubbed, with no live Cloudflare account$/,
    (ctx) => {
      writeFakeCloudflared(ctx.binDir);
      writeFakeCaffeinate(ctx.binDir);
      writeFakeDig(ctx.binDir);
      ctx.env.CLOUDFLARED = path.join(ctx.binDir, 'cloudflared');
      ctx.env.CAFFEINATE = path.join(ctx.binDir, 'caffeinate');
    },
    FEATURE_NAME
  );

  // ── named-01 ──────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^operator config names a tunnel and the hostname "([^"]+)"$/,
    (ctx, hostname) => {
      const cfHomeDir = path.join(ctx.root, 'cloudflared-home');
      fs.mkdirSync(cfHomeDir, { recursive: true });
      const configYml = path.join(cfHomeDir, 'config.yml');
      fs.writeFileSync(
        configYml,
        `tunnel: ${TUNNEL_UUID}\ncredentials-file: ${path.join(cfHomeDir, 'cred.json')}\ningress:\n  - hostname: ${hostname}\n    service: http://127.0.0.1:${ctx.port}\n  - service: http_status:404\n`
      );
      fs.writeFileSync(path.join(cfHomeDir, 'cred.json'), '{}');
      fs.writeFileSync(
        path.join(ctx.opDir, 'named-tunnel.env'),
        `SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble\nSWARMFORGE_NAMED_TUNNEL_HOSTNAME=${hostname}\nSWARMFORGE_CLOUDFLARED_CONFIG=${configYml}\n`
      );
      ctx.namedHostname = hostname;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the resident-spy tunnel launcher runs$/,
    (ctx) => {
      runLauncher(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it runs cloudflared against that named tunnel$/,
    (ctx) => {
      const log = fs.readFileSync(cfCallsLog(ctx), 'utf8');
      if (!/run swarmforge-bubble/.test(log)) {
        throw new Error(`expected cloudflared to be invoked with "run swarmforge-bubble", got log:\n${log}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it prints "([^"]+)"$/,
    (ctx, expected) => {
      const actual = (ctx.launchResult.stdout || '').trim();
      if (actual !== expected) {
        throw new Error(`expected stdout "${expected}", got "${actual}" (stderr: ${ctx.launchResult.stderr})`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the tunnel state file records mode "([^"]+)"$/,
    (ctx, mode) => {
      const raw = fs.readFileSync(stateFile(ctx), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.mode !== mode) {
        throw new Error(`expected tunnel state mode "${mode}", got ${JSON.stringify(parsed)}`);
      }
      killPidFile(path.join(ctx.binDir, 'cf.pid'));
      killPidFile(path.join(ctx.binDir, 'caffeinate.pid'));
    },
    FEATURE_NAME
  );

  // ── named-02 ──────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^named tunnel mode is requested with no hostname in the environment or operator config$/,
    (ctx) => {
      ctx.env.SWARMFORGE_NAMED_TUNNEL = 'swarmforge-bubble';
      // Deliberately no SWARMFORGE_NAMED_TUNNEL_HOSTNAME and no
      // .swarmforge/operator/named-tunnel.env file.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it exits non-zero naming the named-tunnel setup script$/,
    (ctx) => {
      if (ctx.launchResult.status === 0) {
        throw new Error('expected the launcher to exit non-zero');
      }
      if (!/setup_bubble_named_tunnel\.sh/.test(ctx.launchResult.stderr || '')) {
        throw new Error(`expected stderr to name setup_bubble_named_tunnel.sh, got: ${ctx.launchResult.stderr}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no tunnel state file is written$/,
    (ctx) => {
      if (fs.existsSync(stateFile(ctx))) {
        throw new Error('expected no tunnel state file to exist');
      }
    },
    FEATURE_NAME
  );

  // notify_telegram_if_url_changed runs (in program order) strictly AFTER
  // write_state and strictly BEFORE the launcher's only stdout write
  // (`echo "$URL"`) - so an empty stdout on a failed run structurally proves
  // execution never reached the notify call either, without needing to
  // instrument the notify path itself.
  registry.defineScoped(
    /^no pairing notification is sent$/,
    (ctx) => {
      if ((ctx.launchResult.stdout || '').trim() !== '') {
        throw new Error(`expected empty stdout (proving notify was never reached), got: ${ctx.launchResult.stdout}`);
      }
      killPidFile(path.join(ctx.binDir, 'cf.pid'));
      killPidFile(path.join(ctx.binDir, 'caffeinate.pid'));
    },
    FEATURE_NAME
  );

  // ── named-03 ──────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the named tunnel process stays alive but never registers a connection$/,
    (ctx) => {
      const cfHomeDir = path.join(ctx.root, 'cloudflared-home');
      fs.mkdirSync(cfHomeDir, { recursive: true });
      const configYml = path.join(cfHomeDir, 'config.yml');
      fs.writeFileSync(
        configYml,
        `tunnel: ${TUNNEL_UUID}\ncredentials-file: ${path.join(cfHomeDir, 'cred.json')}\ningress:\n  - hostname: bubble.example.com\n    service: http://127.0.0.1:${ctx.port}\n  - service: http_status:404\n`
      );
      fs.writeFileSync(path.join(cfHomeDir, 'cred.json'), '{}');
      ctx.env.SWARMFORGE_NAMED_TUNNEL = 'swarmforge-bubble';
      ctx.env.SWARMFORGE_NAMED_TUNNEL_HOSTNAME = 'bubble.example.com';
      ctx.env.SWARMFORGE_CLOUDFLARED_CONFIG = configYml;
      ctx.env.FAKE_CLOUDFLARED_NEVER_REGISTER = '1';
      // Test-only wait seam (BL-787) - the real default is 45 real seconds.
      ctx.env.SWARMFORGE_NAMED_TUNNEL_WAIT_ATTEMPTS = '3';
      ctx.env.SWARMFORGE_NAMED_TUNNEL_WAIT_INTERVAL = '0';
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it exits non-zero pointing at the tunnel log$/,
    (ctx) => {
      if (ctx.launchResult.status === 0) {
        throw new Error('expected the launcher to exit non-zero');
      }
      if (!/resident-spy-cloudflared\.log/.test(ctx.launchResult.stderr || '')) {
        throw new Error(`expected stderr to point at the tunnel log, got: ${ctx.launchResult.stderr}`);
      }
    },
    FEATURE_NAME
  );

  // ── quick-01 ──────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^no named tunnel configuration is present$/,
    () => {
      // Natural default for a freshly-built ctx.env: no SWARMFORGE_NAMED_TUNNEL,
      // no named-tunnel.env file. Nothing to arrange.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it starts a quick tunnel$/,
    (ctx) => {
      const log = fs.readFileSync(cfCallsLog(ctx), 'utf8');
      if (!/--url/.test(log)) {
        throw new Error(`expected cloudflared to be invoked with --url (quick tunnel), got log:\n${log}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it prints the ephemeral tunnel URL read from the tunnel log$/,
    (ctx) => {
      const actual = (ctx.launchResult.stdout || '').trim();
      if (actual !== 'https://fake-random.trycloudflare.com') {
        throw new Error(`expected the ephemeral trycloudflare URL, got: "${actual}"`);
      }
    },
    FEATURE_NAME
  );

  // ── keepalive-01 (Scenario Outline) ────────────────────────────────────────
  const KEEPALIVE_SETTINGS = {
    'the keepalive is enabled': 'enabled',
    'the keepalive skip flag is set': 'skip',
  };
  const PIDFILE_STATES = { written: true, absent: false };

  registry.defineScoped(
    /^(the keepalive is enabled|the keepalive skip flag is set)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KEEPALIVE_SETTINGS, raw)) {
        throw new Error(`bl787: unrecognized <keepalive setting> example value "${raw}"`);
      }
      const setting = KEEPALIVE_SETTINGS[raw];
      if (setting === 'skip') {
        ctx.env.SWARMFORGE_SKIP_CAFFEINATE = '1';
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the keepalive pidfile is (written|absent)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(PIDFILE_STATES, raw)) {
        throw new Error(`bl787: unrecognized <pidfile state> example value "${raw}"`);
      }
      const expectWritten = PIDFILE_STATES[raw];
      const exists = fs.existsSync(path.join(ctx.opDir, 'resident-spy-caffeinate.pid'));
      if (exists !== expectWritten) {
        throw new Error(`expected keepalive pidfile present=${expectWritten}, got present=${exists}`);
      }
      killPidFile(path.join(ctx.binDir, 'cf.pid'));
      killPidFile(path.join(ctx.binDir, 'caffeinate.pid'));
    },
    FEATURE_NAME
  );

  // ── keepalive-02 ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the launcher has started a keepalive process and written its pidfile$/,
    (ctx) => {
      const child = spawnSync('bash', ['-c', 'sleep 30 & echo $!'], { encoding: 'utf8' });
      ctx.keepalivePid = Number(child.stdout.trim());
      fs.writeFileSync(path.join(ctx.opDir, 'resident-spy-caffeinate.pid'), String(ctx.keepalivePid));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the ancillary stop path runs$/,
    (ctx) => {
      ctx.stopResult = spawnSync('bash', [STOP, ctx.root], { encoding: 'utf8', timeout: 15000, env: ctx.env });
      if (ctx.stopResult.status !== 0) {
        throw new Error(`expected stop_ancillary_services.sh to exit 0, got ${ctx.stopResult.status}: ${ctx.stopResult.stderr}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the keepalive process is signalled$/,
    (ctx) => {
      if (isAlive(ctx.keepalivePid)) {
        throw new Error(`expected keepalive pid ${ctx.keepalivePid} to be signalled by the stop path`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no live process remains under that pidfile$/,
    (ctx) => {
      const pidFile = path.join(ctx.opDir, 'resident-spy-caffeinate.pid');
      if (fs.existsSync(pidFile)) {
        throw new Error('expected the keepalive pidfile to be removed by the stop path');
      }
    },
    FEATURE_NAME
  );

  // ── setup-01 / setup-02 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the zone nameservers are not Cloudflare-backed$/,
    (ctx) => {
      // FAKE_DIG_CLOUDFLARE unset -> writeFakeDig's default (registrar NS).
      ctx.env.SWARMFORGE_NAMED_TUNNEL_HOSTNAME = 'bubble.testdomain.invalid';
      ctx.env.SWARMFORGE_NAMED_TUNNEL_ZONE = 'testdomain.invalid';
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the zone nameservers are Cloudflare-backed$/,
    (ctx) => {
      ctx.env.FAKE_DIG_CLOUDFLARE = '1';
      ctx.env.SWARMFORGE_NAMED_TUNNEL_HOSTNAME = 'bubble.testdomain.invalid';
      ctx.env.SWARMFORGE_NAMED_TUNNEL_ZONE = 'testdomain.invalid';
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the named tunnel already exists on the account$/,
    (ctx) => {
      const cfHome = path.join(ctx.root, '.cloudflared');
      fs.mkdirSync(cfHome, { recursive: true });
      fs.writeFileSync(path.join(cfHome, 'cert.pem'), '');
      fs.writeFileSync(path.join(cfHome, `${TUNNEL_UUID}.json`), '{}');
      // writeFakeCloudflared's "tunnel list" always reports this same
      // TUNNEL_UUID under name "swarmforge-bubble" - the precondition this
      // step names is already the fixture's default; this step supplies the
      // credentials file setup requires once it resolves that UUID.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the named-tunnel setup script runs without the pending-DNS override$/,
    (ctx) => {
      ctx.setupResults = [spawnSync('bash', [SETUP, ctx.root], { encoding: 'utf8', timeout: 15000, env: ctx.env })];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the named-tunnel setup script runs twice$/,
    (ctx) => {
      ctx.setupResults = [
        spawnSync('bash', [SETUP, ctx.root], { encoding: 'utf8', timeout: 15000, env: ctx.env }),
        spawnSync('bash', [SETUP, ctx.root], { encoding: 'utf8', timeout: 15000, env: ctx.env }),
      ];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it exits non-zero with the nameserver migration checklist$/,
    (ctx) => {
      const result = ctx.setupResults[0];
      if (result.status === 0) {
        throw new Error('expected the setup script to exit non-zero');
      }
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      if (!/Cloudflare-backed/i.test(output)) {
        throw new Error(`expected the nameserver migration checklist in output, got: ${output}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it creates no tunnel and writes no cloudflared config$/,
    (ctx) => {
      const log = fs.existsSync(cfCallsLog(ctx)) ? fs.readFileSync(cfCallsLog(ctx), 'utf8') : '';
      if (/tunnel create/.test(log)) {
        throw new Error(`expected no "tunnel create" call, got log:\n${log}`);
      }
      const configYml = path.join(ctx.root, '.cloudflared', 'config.yml');
      if (fs.existsSync(configYml)) {
        throw new Error('expected no cloudflared config.yml to be written');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a cloudflared ingress config maps the hostname to the bridge port$/,
    (ctx) => {
      const configYml = path.join(ctx.root, '.cloudflared', 'config.yml');
      const content = fs.readFileSync(configYml, 'utf8');
      if (!content.includes('hostname: bubble.testdomain.invalid') || !content.includes(`127.0.0.1:${ctx.port}`)) {
        throw new Error(`expected ingress config to map the hostname to the bridge port, got:\n${content}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the operator named-tunnel env file names that tunnel and hostname$/,
    (ctx) => {
      const envFile = path.join(ctx.opDir, 'named-tunnel.env');
      const content = fs.readFileSync(envFile, 'utf8');
      if (!/SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble/.test(content) || !/SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble\.testdomain\.invalid/.test(content)) {
        throw new Error(`expected the operator env file to name the tunnel and hostname, got:\n${content}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the second run creates no second tunnel$/,
    (ctx) => {
      for (const result of ctx.setupResults) {
        if (result.status !== 0) {
          throw new Error(`expected every setup run to exit 0, got ${result.status}: ${result.stderr}`);
        }
      }
      const log = fs.readFileSync(cfCallsLog(ctx), 'utf8');
      if (/tunnel create/.test(log)) {
        throw new Error(`expected no "tunnel create" call across either run (tunnel already existed), got log:\n${log}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
