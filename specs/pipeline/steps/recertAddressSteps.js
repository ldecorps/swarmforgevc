'use strict';

// BL-223: step handlers for the real-inbound-recert-address feature.
// Drives the real pwa/app.js (via render-recert-mailto.js, jsdom, mirroring
// extension/test/pwaRecertification.test.js's own pattern) with a provided
// recert-batch.json fixture - no live email, no network, no real timers.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-recert-mailto.js');
const DEFAULT_ADDRESS = 'recert@tolokarooo.resend.app';

function renderMailto(recertEmailTo) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-recert-address-'));
  const fixturePath = path.join(tmpDir, 'recert-batch.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({
      schemaVersion: 1,
      generatedAtIso: '2026-07-09T12:00:00Z',
      recertEmailTo,
      batch: [{ id: 'BL-096/metrics-01', ticketId: 'BL-096', name: 'x', text: 'Scenario: x\n  Given a\n' }],
    })
  );
  const out = execFileSync('node', [RENDER_SCRIPT, fixturePath], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  registry.define(/^the phone app builds a mailto: link for a recertification action$/, () => {
    // Background - nothing to fixture beyond what each scenario's own
    // Given sets up below.
  });

  // ── recert-address-01 ───────────────────────────────────────────────
  registry.define(/^a configured inbound recertification address on a domain we control$/, (ctx) => {
    ctx.configuredAddress = 'recert@inbound.musicalsifu.com';
  });

  registry.define(/^the human taps a recertification send action$/, (ctx) => {
    ctx.mail = renderMailto(ctx.configuredAddress);
  });

  registry.define(/^the composed mailto is addressed to that configured address$/, (ctx) => {
    if (ctx.mail.to !== ctx.configuredAddress) {
      throw new Error(`expected the mailto addressed to ${ctx.configuredAddress}, got: ${ctx.mail.to}`);
    }
  });

  // ── recert-address-02 ───────────────────────────────────────────────
  registry.define(/^the phone app resolves the recertification send address$/, (ctx) => {
    ctx.configuredAddress = ctx.configuredAddress || DEFAULT_ADDRESS;
  });

  registry.define(/^it builds the mailto: link$/, (ctx) => {
    ctx.mail = renderMailto(ctx.configuredAddress);
  });

  registry.define(/^the address is not on the reserved \.invalid TLD$/, (ctx) => {
    if (/\.invalid$/.test(ctx.mail.to)) {
      throw new Error(`expected the address to never be on the reserved .invalid TLD, got: ${ctx.mail.to}`);
    }
  });
}

module.exports = { registerSteps };
