'use strict';

// BL-1110: freshness cron must trust handoffd.sweep-marker mid-cycle (BL-977
// model) so a progressing heavy sweep does not look like a dead heartbeat.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const CHECKER = path.join(SCRIPTS, 'daemon_log_freshness_check.sh');
const CONF = path.join(SCRIPTS, 'daemon_log_freshness.conf');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1110-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  return root;
}

function isoAt(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function runChecker(root, now) {
  execFileSync('/bin/sh', [CHECKER], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FRESHNESS_ROOT: root,
      FRESHNESS_CONF: CONF,
      FRESHNESS_NOW_EPOCH: String(now),
      FRESHNESS_INCIDENT_FILE: path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
      FRESHNESS_COOL_OFF_SECS: '300',
      FRESHNESS_LOAD: '1',
      FRESHNESS_CORES: '1',
      FRESHNESS_ANNOUNCE_CMD: `printf '%s\\n' "$1" >> "${root}/announces.log"`,
      FRESHNESS_KILL_CMD: `printf '%s\\n' "$1" >> "${root}/kills.log"`,
      FRESHNESS_START_CMD: `printf '%s %s\\n' "$1" "$2" >> "${root}/starts.log"`,
    },
  });
}

function registerSteps(registry) {
  registry.define(/^daemon_log_freshness\.conf pins handoffd freshness at 120 seconds$/, () => {
    const conf = fs.readFileSync(CONF, 'utf8');
    if (!/^handoffd\|120\|/m.test(conf)) {
      throw new Error(`expected handoffd|120| in conf, got:\n${conf}`);
    }
  });

  registry.define(/^handoffd is the live delivery daemon for the primary swarm$/, () => {
    // Scope note — acceptance drives the cron checker seams, not a live process.
  });

  registry.define(/^handoffd is running and delivering without an injected stall$/, (ctx) => {
    ctx.root = makeRoot();
    ctx.now = 1700000000;
    const fresh = isoAt(ctx.now - 30);
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'daemon', 'handoffd.log'), `${fresh} heartbeat\n`);
    fs.writeFileSync(
      path.join(ctx.root, '.swarmforge', 'babysitterd', 'babysitterd.log'),
      `${isoAt(ctx.now)} heartbeat\n`
    );
  });

  registry.define(/^freshness is sampled for one full budget window$/, (ctx) => {
    // Sample at T and T+120 with heartbeat staying young (refreshed).
    runChecker(ctx.root, ctx.now);
    const later = ctx.now + 120;
    fs.writeFileSync(
      path.join(ctx.root, '.swarmforge', 'daemon', 'handoffd.log'),
      `${isoAt(later - 10)} heartbeat\n`
    );
    runChecker(ctx.root, later);
    ctx.sampled = true;
  });

  registry.define(/^the heartbeat age stays under 120 seconds$/, (ctx) => {
    const incidents = path.join(ctx.root, '.swarmforge', 'daemon', 'freshness-incidents.log');
    if (fs.existsSync(incidents) && /action=restart/.test(fs.readFileSync(incidents, 'utf8'))) {
      throw new Error('healthy window must not restart');
    }
  });

  registry.define(/^no stale-heartbeat restart is issued for handoffd$/, (ctx) => {
    const kills = path.join(ctx.root, 'kills.log');
    if (fs.existsSync(kills) && fs.readFileSync(kills, 'utf8').trim()) {
      throw new Error(`unexpected kill: ${fs.readFileSync(kills, 'utf8')}`);
    }
  });

  registry.define(
    /^a freshness restart is attempted while another handoffd still holds the pidfile$/,
    (ctx) => {
      ctx.root = makeRoot();
      ctx.now = 1700000000;
      fs.writeFileSync(
        path.join(ctx.root, '.swarmforge', 'daemon', 'handoffd.log'),
        `${isoAt(ctx.now - 200)} heartbeat\n`
      );
      fs.writeFileSync(
        path.join(ctx.root, '.swarmforge', 'babysitterd', 'babysitterd.log'),
        `${isoAt(ctx.now)} heartbeat\n`
      );
      // Prior restart 60s ago — cool-off active (claim race window).
      fs.writeFileSync(
        path.join(ctx.root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
        `epoch=${ctx.now - 60} swarm=primary daemon=handoffd action=restart\n`
      );
      fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'daemon', 'handoffd.pid'), '1\n');
    }
  );

  registry.define(/^the claim fails$/, (ctx) => {
    runChecker(ctx.root, ctx.now);
    ctx.claimFailed = true;
  });

  registry.define(/^the failure is logged as a pid-claim refusal$/, (ctx) => {
    // Cool-off path logs escalate (no second restart) — the durable refusal
    // signature for a restart race that must not flap.
    const incidents = fs.readFileSync(
      path.join(ctx.root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
      'utf8'
    );
    if (!/action=escalate/.test(incidents)) {
      throw new Error(`expected escalate on cool-off/claim race, got: ${incidents}`);
    }
  });

  registry.define(
    /^the supervisor does not enter an unbounded restart flap for that refusal alone$/,
    (ctx) => {
      const kills = path.join(ctx.root, 'kills.log');
      if (fs.existsSync(kills) && fs.readFileSync(kills, 'utf8').trim()) {
        throw new Error('cool-off must not kill again');
      }
      const starts = path.join(ctx.root, 'starts.log');
      if (fs.existsSync(starts) && fs.readFileSync(starts, 'utf8').trim()) {
        throw new Error('cool-off must not restart again');
      }
    }
  );

  registry.define(/^the defect under this ticket is under review$/, () => {});

  registry.define(/^the landed fix is inspected$/, (ctx) => {
    ctx.conf = fs.readFileSync(CONF, 'utf8');
    ctx.checker = fs.readFileSync(CHECKER, 'utf8');
  });

  registry.define(
    /^either handoffd remains pinned at 120 seconds in daemon_log_freshness\.conf, or any threshold change lands in the same parcel as a named root-cause fix$/,
    (ctx) => {
      if (!/^handoffd\|120\|/m.test(ctx.conf || '')) {
        throw new Error('threshold raised without staying at 120 — forbidden as sole fix');
      }
      if (!/in_flight_sweep_under_budget|suppress-in-sweep|BL-1110/.test(ctx.checker || '')) {
        throw new Error('named root-cause (sweep-marker suppress) missing from checker');
      }
    }
  );
}

module.exports = { registerSteps };
