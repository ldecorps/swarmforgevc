'use strict';

// BL-366: step handlers for "Every generated systemd unit can actually
// start, and its crash-burst guard is real". Drives the REAL generator
// (generate_systemd_units.sh) and the REAL systemd-analyze binary against a
// project root that genuinely exists on this host (this repo's own
// checkout) - a fictional path (e.g. /home/pi/...) would fail
// systemd-analyze verify's own ExecStart-file-existence check for reasons
// unrelated to this ticket's defects. Scenario 03 (crash-burst recovery) is
// verified STRUCTURALLY (the guard keys are present and in the section
// systemd actually honors) rather than by live-crash-looping an installed
// unit - that end-to-end proof is QA's own procedure on a real host with
// the units installed (the ticket's own notes).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GENERATOR = path.join(REPO_ROOT, 'swarmforge', 'deploy', 'generate_systemd_units.sh');

const KNOWN_UNITS = new Set(['swarm', 'operator', 'front-desk']);

function resolveBin(name) {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function renderUnit(unitType, projectRoot, outputPath) {
  if (!KNOWN_UNITS.has(unitType)) {
    throw new Error(`unrecognized unit type in Examples table: "${unitType}"`);
  }
  const args = [GENERATOR, projectRoot, 'systemd-units-acceptance', process.env.USER || 'test'];
  if (outputPath) {
    args.push(outputPath);
  }
  args.push(`--unit=${unitType}`);
  return execFileSync('bash', args, { encoding: 'utf8' });
}

function extractSection(unitText, sectionName) {
  const lines = unitText.split('\n');
  const start = lines.findIndex((l) => l.trim() === `[${sectionName}]`);
  if (start === -1) {
    return '';
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\[.+\]$/.test(l.trim()));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

function extractDirective(unitText, key) {
  const match = unitText.split('\n').find((l) => l.startsWith(`${key}=`));
  return match ? match.slice(key.length + 1) : null;
}

function execStartBinary(unitText) {
  const execStart = extractDirective(unitText, 'ExecStart');
  return execStart ? execStart.split(/\s+/)[0] : null;
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^the deploy tooling renders systemd units for the swarm$/, (ctx) => {
    ctx.projectRoot = REPO_ROOT;
    ctx.scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-systemd-units-'));
    ctx.bbBin = resolveBin('bb');
  });

  // ── systemd-units-can-actually-start-01 ─────────────────────────────────
  registry.define(/^the "([^"]+)" unit is rendered$/, (ctx, unitType) => {
    if (!KNOWN_UNITS.has(unitType)) {
      throw new Error(`unrecognized unit in Examples table: "${unitType}"`);
    }
    ctx.unitType = unitType;
    ctx.unitPath = path.join(ctx.scratchRoot, `${unitType}.service`);
    ctx.unitText = renderUnit(unitType, ctx.projectRoot, ctx.unitPath);
  });

  registry.define(/^systemd accepts it as valid$/, (ctx) => {
    if (!fs.existsSync('/usr/bin/systemd-analyze') && !resolveBin('systemd-analyze')) {
      throw new Error('systemd-analyze is not available on this host - cannot verify unit validity');
    }
    const result = spawnSync('systemd-analyze', ['verify', ctx.unitPath], { encoding: 'utf8' });
    ctx.verifyOutput = (result.stdout || '') + (result.stderr || '');
    if (result.status !== 0) {
      throw new Error(`expected systemd-analyze verify to pass for the ${ctx.unitType} unit, got exit ${result.status}: ${ctx.verifyOutput}`);
    }
  });

  registry.define(/^it carries no key that systemd will silently ignore$/, (ctx) => {
    if (/unknown key/i.test(ctx.verifyOutput)) {
      throw new Error(`expected no "Unknown key" warning for the ${ctx.unitType} unit (a decorative guard), got: ${ctx.verifyOutput}`);
    }
  });

  // ── systemd-units-can-actually-start-02 ─────────────────────────────────
  registry.define(/^systemd runs a unit with a minimal PATH that excludes the user's local bin$/, (ctx) => {
    ctx.minimalSystemdPath = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin';
  });

  registry.define(/^the "([^"]+)" unit starts$/, (ctx, unitType) => {
    if (!KNOWN_UNITS.has(unitType)) {
      throw new Error(`unrecognized unit in Examples table: "${unitType}"`);
    }
    ctx.unitType = unitType;
    ctx.unitText = renderUnit(unitType, ctx.projectRoot);
    ctx.execStartBinary = execStartBinary(ctx.unitText);
    ctx.envPath = extractDirective(ctx.unitText, 'Environment=PATH');
  });

  registry.define(/^it finds the interpreter it was told to run$/, (ctx) => {
    // Static check only - NEVER actually spawn ExecStart's binary. For the
    // swarm/front-desk units that binary IS the real launcher script
    // (./swarm, launch_front_desk.sh), which has real side effects (it
    // would attempt an actual swarm/front-desk launch); systemd itself
    // resolves the executable by absolute path + the executable bit alone
    // (execve does no PATH search), so checking exactly that - never a live
    // run - proves the same thing systemd's own resolution proves.
    if (!ctx.execStartBinary || !path.isAbsolute(ctx.execStartBinary)) {
      throw new Error(`expected an absolute ExecStart binary (systemd cannot search PATH), got: ${ctx.execStartBinary}`);
    }
    if (!fs.existsSync(ctx.execStartBinary)) {
      throw new Error(`expected ExecStart's binary to actually exist on this host: ${ctx.execStartBinary}`);
    }
    try {
      fs.accessSync(ctx.execStartBinary, fs.constants.X_OK);
    } catch {
      throw new Error(`expected ExecStart's binary to be executable (systemd's own execve resolution requires this): ${ctx.execStartBinary}`);
    }
  });

  registry.define(/^the scripts it launches find the interpreters they need$/, (ctx) => {
    if (!ctx.envPath) {
      throw new Error(`expected an Environment=PATH= directive naming the interpreter directories for the ${ctx.unitType} unit`);
    }
    if (!ctx.bbBin) {
      throw new Error('this test host has no bb on PATH - cannot verify the interpreter-lookup fix');
    }
    // Reproduces systemd's own minimal-PATH environment exactly, then asks
    // the SAME shell a launched script would use ("command -v") to resolve
    // bb using ONLY the unit's own declared Environment=PATH= - not this
    // test process's own (much richer) PATH.
    const result = spawnSync('bash', ['-lc', 'command -v bb'], { env: { PATH: ctx.envPath } });
    if (result.status !== 0) {
      throw new Error(`expected bb to be resolvable under the ${ctx.unitType} unit's own Environment=PATH= (${ctx.envPath}), but it was not`);
    }
  });

  // ── systemd-units-can-actually-start-03 (structural - see file header for
  //    why the live crash-loop proof is QA's own E2E procedure) ────────────
  registry.define(/^the "([^"]+)" unit is running$/, (ctx, unitType) => {
    if (!KNOWN_UNITS.has(unitType)) {
      throw new Error(`unrecognized unit in Examples table: "${unitType}"`);
    }
    ctx.unitType = unitType;
    ctx.unitText = renderUnit(unitType, ctx.projectRoot);
  });

  registry.define(/^it crashes repeatedly in a short burst$/, (ctx) => {
    ctx.unitSection = extractSection(ctx.unitText, 'Unit');
    ctx.serviceSection = extractSection(ctx.unitText, 'Service');
  });

  registry.define(/^systemd keeps restarting it$/, (ctx) => {
    const restart = extractDirective(ctx.unitText, 'Restart');
    if (restart !== 'always' && restart !== 'on-failure') {
      throw new Error(`expected Restart=always or Restart=on-failure (a policy that retries on a crash) for the ${ctx.unitType} unit, got: ${restart}`);
    }
    if (ctx.unitType === 'swarm' && restart !== 'on-failure') {
      throw new Error(`expected the swarm unit specifically to use Restart=on-failure, not "always" - its oneshot ExecStart exits successfully on every normal launch, and "always" would relaunch it in an infinite loop on success, not only on a genuine crash; got: ${restart}`);
    }
  });

  registry.define(/^it never parks in a failed state it will not leave on its own$/, (ctx) => {
    if (!/^StartLimitIntervalSec=0$/m.test(ctx.unitSection)) {
      throw new Error(`expected StartLimitIntervalSec=0 in [Unit] for the ${ctx.unitType} unit (silently ignored anywhere else), got:\n${ctx.unitText}`);
    }
    if (/^StartLimitIntervalSec=/m.test(ctx.serviceSection)) {
      throw new Error(`expected StartLimitIntervalSec to be absent from [Service] for the ${ctx.unitType} unit (systemd v230+ discards it there with a warning - a decorative guard), got:\n${ctx.unitText}`);
    }
  });
}

module.exports = { registerSteps };
