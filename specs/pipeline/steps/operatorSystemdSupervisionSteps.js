'use strict';

// BL-304: step handlers for "A systemd unit supervises the operator
// runtime so it autostarts, restarts on crash, and survives a reboot
// without ever permanently giving up". Drives the REAL
// generate_systemd_units.sh --unit=operator (a pure text render - no real
// systemctl needed for the unit-content acceptance, per the ticket's own
// framing).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GENERATOR = path.join(REPO_ROOT, 'swarmforge', 'deploy', 'generate_systemd_units.sh');

function generateOperatorUnit() {
  return execFileSync(GENERATOR, ['/home/pi/swarmforgevc', 'pi5', 'pi', '--unit=operator'], { encoding: 'utf8' });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the operator-runtime systemd unit is generated for a host$/, (ctx) => {
    ctx.unit = generateOperatorUnit();
  });

  // ── operator-autostart-01/02/03 ──────────────────────────────────────
  registry.define(/^the generated unit is inspected$/, () => {
    // No-op - the Background already generated ctx.unit; each Then step
    // below inspects it directly.
  });

  registry.define(/^it restarts the runtime whenever the process exits$/, (ctx) => {
    if (!/^Restart=always$/m.test(ctx.unit)) {
      throw new Error(`expected Restart=always, got:\n${ctx.unit}`);
    }
  });

  registry.define(/^a burst of rapid crashes never leaves the runtime permanently stopped$/, (ctx) => {
    if (!/^StartLimitIntervalSec=0$/m.test(ctx.unit)) {
      throw new Error(`expected StartLimitIntervalSec=0 (disables systemd's own start-rate-limit, the exact analogue of the BL-303 sticky-give-up defect), got:\n${ctx.unit}`);
    }
  });

  registry.define(/^it is enabled to bring the runtime up at boot$/, (ctx) => {
    if (!/^WantedBy=multi-user\.target$/m.test(ctx.unit)) {
      throw new Error(`expected WantedBy=multi-user.target, got:\n${ctx.unit}`);
    }
  });

  registry.define(/^it loads the operator's environment file instead of relying on a login shell$/, (ctx) => {
    if (!/^EnvironmentFile=-/m.test(ctx.unit)) {
      throw new Error(`expected an optional EnvironmentFile= line, got:\n${ctx.unit}`);
    }
  });
}

module.exports = { registerSteps };
