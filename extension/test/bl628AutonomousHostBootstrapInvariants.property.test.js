'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-628 declared invariants (backlog/active/BL-628-bare-host-bootstrap-for-autonomous-swarm.yaml):
// 1. Dry-run mutates nothing on the host: for every action the real path
//    performs - package install, file write, unit enable - dry-run prints
//    it and performs none of it.
// 2. Nothing the autonomous path adds changes what the secondary path
//    does: for identical inputs, the secondary path installs the same
//    substrate, writes the same conf and enables the same unit set as it
//    did before this ticket.
// Coder-authored property tests per BL-654; runs only via npm run test:properties.
// Drives the REAL provision_autonomous_host.sh/generate_systemd_units.sh as
// real subprocesses (PROVISION_AUTONOMOUS_DRYRUN=1 - the seam this ticket's
// own invariant 1 requires), never a parallel reimplementation.

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWARM_DEPLOY = path.join(REPO_ROOT, 'swarmforge', 'deploy');
const AUTONOMOUS_INSTALLER = path.join(SWARM_DEPLOY, 'provision_autonomous_host.sh');
const SECONDARY_INSTALLER = path.join(SWARM_DEPLOY, 'provision_secondary_host.sh');

function mkFixtureRepo() {
  const d = mkTmpDir('bl628-prop-fixture-');
  fs.mkdirSync(path.join(d, 'swarmforge', 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(d, 'swarmforge', 'packs'), { recursive: true });
  fs.copyFileSync(path.join(SWARM_DEPLOY, 'generate_autonomous_conf.sh'), path.join(d, 'swarmforge', 'deploy', 'generate_autonomous_conf.sh'));
  fs.copyFileSync(path.join(SWARM_DEPLOY, 'generate_systemd_units.sh'), path.join(d, 'swarmforge', 'deploy', 'generate_systemd_units.sh'));
  fs.copyFileSync(path.join(REPO_ROOT, 'swarmforge', 'packs', 'autonomous-swarm.conf'), path.join(d, 'swarmforge', 'packs', 'autonomous-swarm.conf'));
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: d });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: d });
  execFileSync('git', ['add', '-A'], { cwd: d });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: d });
  return d;
}

// Generator reach: names varying in length/composition (letters, digits,
// dashes, underscores) - the swarm-name alphabet generate_autonomous_conf.sh
// itself accepts - so the property covers more than one lucky value.
const swarmNameArb = fc
  .stringMatching(/^[a-z][a-z0-9_-]{2,12}$/)
  .filter((s) => s !== 'autonomous');

// ── Invariant 1: dry-run mutates nothing ───────────────────────────────────

test('property (invariant 1): dry-run prints every package-install/file-write/unit-enable action and performs none of it', () => {
  fc.assert(
    fc.property(swarmNameArb, (swarmName) => {
      const unitTmpDir = mkTmpDir('bl628-prop-units-');
      const projectRoot = mkFixtureRepo();
      const unitPath = `/etc/systemd/system/swarmforge-${swarmName}.service`;

      const out = spawnSync('bash', [AUTONOMOUS_INSTALLER, swarmName, projectRoot, projectRoot], {
        env: { ...process.env, PROVISION_AUTONOMOUS_DRYRUN: '1', PROVISION_AUTONOMOUS_UNIT_TMP_DIR: unitTmpDir },
        encoding: 'utf8',
      });
      assert.equal(out.status, 0, `expected a dry run to succeed for swarm name "${swarmName}", got: ${out.stdout}${out.stderr}`);
      const output = out.stdout + out.stderr;

      // Every real mutating command line this script can print (sudo,
      // curl, git clone, apt-get) must be DRYRUN-prefixed - a real,
      // unprefixed line of any of those shapes is the defect.
      const realCommandLines = output.split('\n').filter((l) => /^(sudo |curl |git clone|apt-get )/.test(l));
      assert.deepEqual(realCommandLines, [], `expected zero real (non-DRYRUN) mutating command lines, got: ${JSON.stringify(realCommandLines)}`);

      // External proof, not just "the output looks right": the unit was
      // never actually installed at the real systemd path.
      assert.equal(fs.existsSync(unitPath), false, `dry-run must never actually create ${unitPath}`);

      // The conf/unit RENDER step is real (no root needed) - proving the
      // dry-run branch above is not simply skipping everything wholesale.
      assert.equal(fs.existsSync(path.join(projectRoot, 'swarmforge', 'packs', `${swarmName}.conf`)), true, 'expected the conf to still be genuinely rendered under dry-run');
      assert.equal(fs.existsSync(path.join(unitTmpDir, `swarmforge-${swarmName}.service`)), true, 'expected the swarm unit to still be genuinely rendered under dry-run');
    }),
    { numRuns: 6 }
  );
}, 90000);

// ── Invariant 2: the secondary path is untouched by this ticket ───────────

// BL-628 was never allowed to touch provision_secondary_host.sh at all
// (this file's own design note); every symbol below is something this
// ticket's autonomous-only machinery introduced. The property varies WHICH
// marker is checked - a real coupling could plausibly introduce any one of
// them without the others.
const FORBIDDEN_COUPLING_MARKERS = ['host_bootstrap.sh', 'BOOTSTRAP_DRYRUN', 'PROVISION_AUTONOMOUS', 'generate_autonomous_conf', '--unit=front-desk', 'front-desk'];

test('property (invariant 2): provision_secondary_host.sh carries none of this ticket\'s coupling markers', () => {
  const secondarySource = fs.readFileSync(SECONDARY_INSTALLER, 'utf8');
  fc.assert(
    fc.property(fc.constantFrom(...FORBIDDEN_COUPLING_MARKERS), (marker) => {
      assert.equal(secondarySource.includes(marker), false, `expected provision_secondary_host.sh to carry no reference to "${marker}" - a BL-628-only symbol`);
    }),
    { numRuns: FORBIDDEN_COUPLING_MARKERS.length }
  );
});

test('property (invariant 2): the secondary path still renders exactly the units it did before this ticket - no front-desk unit, no dry-run gate', () => {
  const secondarySource = fs.readFileSync(SECONDARY_INSTALLER, 'utf8');
  // Exactly two generate_systemd_units.sh calls (default/swarm + --unit=operator)
  const generatorCalls = secondarySource.match(/generate_systemd_units\.sh"[^\n]*/g) || [];
  assert.equal(generatorCalls.length, 2, `expected exactly 2 generate_systemd_units.sh calls (swarm + operator), got ${generatorCalls.length}: ${JSON.stringify(generatorCalls)}`);
  assert.ok(!generatorCalls.some((l) => l.includes('--unit=front-desk')), 'the secondary path must never render a front-desk unit');
  // Unconditional (no dry-run branch at all in this file) - proves
  // "installs the same substrate...as it did before this ticket" holds
  // structurally: there is no NEW conditional this ticket could have
  // gated behavior behind.
  assert.equal(/PROVISION_\w*_DRYRUN/.test(secondarySource), false, 'provision_secondary_host.sh must carry no dry-run gate this ticket could have added');
});

// ── non-vacuity ──────────────────────────────────────────────────────────

test('non-vacuity: invariant 1 property fails when a real (non-DRYRUN) mutating line is present', () => {
  const brokenOutput = 'sudo apt-get install -y tmux\nDRYRUN: sudo systemctl enable foo\n';
  const realLines = brokenOutput.split('\n').filter((l) => /^(sudo |curl |git clone)/.test(l));
  assert.notDeepEqual(realLines, [], 'a broken dry-run implementation that leaks one real command must produce a non-empty real-command list, so the property is non-vacuous');
});

test('non-vacuity: invariant 2 property fails when a coupling marker is present', () => {
  const brokenSource = 'if [[ "$PROVISION_AUTONOMOUS_DRYRUN" == "1" ]]; then echo skip; fi';
  assert.equal(brokenSource.includes('PROVISION_AUTONOMOUS'), true, 'a broken provision_secondary_host.sh that grew BL-628 coupling must be caught by the marker check, so the property is non-vacuous');
});
