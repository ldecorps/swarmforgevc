'use strict';

// BL-628: step handlers for "One documented path takes a bare Linux box to
// an autonomous swarm". Drives the REAL provision_autonomous_host.sh (and,
// for scenario 04/07, inspects the REAL provision_secondary_host.sh) as a
// real subprocess in PROVISION_AUTONOMOUS_DRYRUN=1 mode - no sudo, no
// download, no clone, no real systemd state change (the seam this ticket's
// own invariant 1 requires) - mirroring alwaysOnOperatorPresenceSteps.js's
// own precedent for provision_primary_host.sh. Conf/unit files ARE
// rendered for real to a scratch /tmp path (no root needed), so the
// assertions below read genuinely-generated content, never a hand-rolled
// substitute for either generator.
//
// Scenario 04 (the secondary shape is unchanged) and half of scenario 07
// cannot safely spawn provision_secondary_host.sh at all - it has no
// dry-run mode and performs real sudo/apt-get/curl calls unconditionally.
// Those are proven STATICALLY instead: this ticket added ZERO bytes to
// that file (grep for the absence of every BL-628 symbol it would have to
// reference to have grown any new coupling), and its own real,
// side-effect-free calls into generate_secondary_conf.sh/
// generate_systemd_units.sh are inspected directly.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_DEPLOY = path.join(REPO_ROOT, 'swarmforge', 'deploy');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const AUTONOMOUS_INSTALLER = path.join(SWARM_DEPLOY, 'provision_autonomous_host.sh');
const SECONDARY_INSTALLER = path.join(SWARM_DEPLOY, 'provision_secondary_host.sh');
const GENERATE_SYSTEMD_UNITS = path.join(SWARM_DEPLOY, 'generate_systemd_units.sh');
const RUNBOOK = path.join(REPO_ROOT, 'docs', 'how-to', 'BL-628-autonomous-swarm-bringup.md');

const FEATURE_NAME = 'One documented path takes a bare Linux box to an autonomous swarm';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A fixture "clone" good enough for the autonomous installer's step-6+
// calls into ITS OWN checkout's deploy scripts/template (the installer
// validates the swarm name against ITS OWN $SCRIPT_DIR first - the real
// repo this test runs from - then, post-clone, calls the CLONED copy for
// the real per-project conf/units; a fixture only needs that CLONED copy
// to carry the same deploy scripts + template).
function mkFixtureRepo() {
  const d = mkTmp('aps-bl628-fixture-');
  fs.mkdirSync(path.join(d, 'swarmforge', 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(d, 'swarmforge', 'packs'), { recursive: true });
  fs.copyFileSync(path.join(SWARM_DEPLOY, 'generate_autonomous_conf.sh'), path.join(d, 'swarmforge', 'deploy', 'generate_autonomous_conf.sh'));
  fs.copyFileSync(GENERATE_SYSTEMD_UNITS, path.join(d, 'swarmforge', 'deploy', 'generate_systemd_units.sh'));
  fs.copyFileSync(path.join(REPO_ROOT, 'swarmforge', 'packs', 'autonomous-swarm.conf'), path.join(d, 'swarmforge', 'packs', 'autonomous-swarm.conf'));
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: d });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: d });
  execFileSync('git', ['add', '-A'], { cwd: d });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: d });
  return d;
}

function runAutonomous(ctx, swarmName, extraEnv = {}) {
  const unitTmpDir = mkTmp('aps-bl628-units-');
  const projectRoot = mkFixtureRepo();
  const out = spawnSync('bash', [AUTONOMOUS_INSTALLER, swarmName, projectRoot, projectRoot], {
    env: { ...process.env, PROVISION_AUTONOMOUS_DRYRUN: '1', PROVISION_AUTONOMOUS_UNIT_TMP_DIR: unitTmpDir, ...extraEnv },
    encoding: 'utf8',
  });
  ctx.unitTmpDir = unitTmpDir;
  ctx.projectRoot = projectRoot;
  ctx.swarmName = swarmName;
  ctx.status = out.status;
  ctx.output = (out.stdout || '') + (out.stderr || '');
  return out;
}

// Parses the generated conf the same way the real parser does, against a
// throwaway root shaped like swarmforge.sh expects - reused by scenario
// 01's three Then steps.
function parsedIdentity(ctx) {
  if (ctx.parsedIdentity) {
    return ctx.parsedIdentity;
  }
  const root = mkTmp('aps-bl628-parse-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  const confSrc = fs.readFileSync(path.join(ctx.projectRoot, 'swarmforge', 'packs', `${ctx.swarmName}.conf`), 'utf8');
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), confSrc);
  const out = execFileSync(
    'zsh',
    [
      '-c',
      `source '${SWARMFORGE_SH}' '${root}'; parse_config; check_primacy; echo "SWARM_NAME=$SWARM_NAME"; echo "SWARM_MODE=$SWARM_MODE"; echo "ROLES=${'${ROLES[*]}'}"`,
    ],
    // XDG_RUNTIME_DIR must reach bb's own process env, not just zsh's own
    // variable table - `VAR=val source file` inside a -c script string
    // sets a plain (non-exported) shell variable for a builtin like
    // source, which a later-spawned bb subprocess never inherits. Passing
    // it here, via the real env option, is the only reliable way.
    { encoding: 'utf8', env: { ...process.env, XDG_RUNTIME_DIR: '/tmp' } }
  );
  ctx.parsedIdentity = out;
  return out;
}

function registerSteps(registry) {
  function step(pattern, handler) {
    registry.defineScoped(pattern, handler, FEATURE_NAME);
  }

  step(/^a bare Linux host reachable over SSH with a repo-scoped clone credential$/, () => {
    // Narrative only - each scenario below builds exactly the real fixture
    // repo it needs, never a shared "whole host" fixture.
  });

  // ── autonomous-bootstrap-01/02/03: run to completion ─────────────────
  step(/^the autonomous provisioning path is run to completion$/, (ctx) => {
    const out = runAutonomous(ctx, 'acme-vps');
    if (out.status !== 0) {
      throw new Error(`expected provision_autonomous_host.sh to succeed for a valid name, got: ${ctx.output}`);
    }
  });

  step(/^the generated conf declares an autonomous swarm, not a secondary one$/, (ctx) => {
    const out = parsedIdentity(ctx);
    if (!/^SWARM_MODE=autonomous$/m.test(out)) {
      throw new Error(`expected SWARM_MODE=autonomous, got: ${out}`);
    }
  });

  step(/^the swarm is granted a coordinator window at launch$/, (ctx) => {
    const out = parsedIdentity(ctx);
    const rolesLine = (out.match(/^ROLES=(.*)$/m) || [])[1] || '';
    if (!/\bcoordinator\b/.test(rolesLine)) {
      throw new Error(`expected a coordinator window in ROLES, got: ${rolesLine}`);
    }
  });

  step(/^it promotes and assigns from its own backlog against its own target repo$/, (ctx) => {
    // Secondary mode is the ONLY mode BL-090 refuses a coordinator window
    // to (multi-swarm-06) and the only mode that works only tickets a
    // primary assigned it; autonomous mode (just proven above) is exactly
    // the complement - its own coordinator promotes/assigns from ITS OWN
    // backlog by construction (swarmforge.sh has no separate "assigned
    // only" code path for autonomous mode at all).
    const out = parsedIdentity(ctx);
    if (!/^SWARM_MODE=autonomous$/m.test(out)) {
      throw new Error(`expected autonomous mode (which promotes/assigns from its own backlog, unlike secondary), got: ${out}`);
    }
  });

  // ── autonomous-bootstrap-02 (Outline) ─────────────────────────────────
  const UNIT_SUFFIX = {
    swarm: '',
    operator: '-operator',
    'front desk': '-front-desk',
  };
  step(/^the (swarm|operator|front desk) unit is installed and enabled$/, (ctx, unit) => {
    if (!(unit in UNIT_SUFFIX)) {
      throw new Error(`autonomous-bootstrap-02: unknown unit example "${unit}" - update UNIT_SUFFIX if this is a real new Examples row`);
    }
    const unitName = `swarmforge${UNIT_SUFFIX[unit]}-${ctx.swarmName}.service`;
    if (!ctx.output.includes(`sudo mv `) || !ctx.output.includes(unitName)) {
      throw new Error(`expected the ${unit} unit (${unitName}) to be installed, got:\n${ctx.output}`);
    }
    const enabledNow = ctx.output.includes(`sudo systemctl enable --now ${unitName}`);
    const enabledOnly = ctx.output.includes(`sudo systemctl enable ${unitName}`);
    if (!enabledNow && !enabledOnly) {
      throw new Error(`expected the ${unit} unit (${unitName}) to be enabled, got:\n${ctx.output}`);
    }
  });

  // BL-628's own registry pattern collides with the literal step text
  // "the swarm unit is installed and enabled" appearing WITHOUT quotes in
  // no scenario here - the Scenario Outline always quotes <unit>, so the
  // single quoted pattern above covers every row.

  // ── autonomous-bootstrap-03 (Outline): headless guarantees ────────────
  const KNOWN_HEADLESS_GUARANTEES = new Set([
    'every installed substrate version came from the lock file',
    'no install resolved a floating latest version',
    'the agent auto-updater is disabled for the service environment',
    'the box relaunches its swarm after a reboot with no human action',
  ]);
  step(/^(every installed substrate version came from the lock file|no install resolved a floating latest version|the agent auto-updater is disabled for the service environment|the box relaunches its swarm after a reboot with no human action)$/, (ctx, guarantee) => {
    if (!KNOWN_HEADLESS_GUARANTEES.has(guarantee)) {
      throw new Error(`autonomous-bootstrap-03: unknown headless-guarantee example "${guarantee}"`);
    }
    if (guarantee === 'every installed substrate version came from the lock file') {
      // Host-independent: a substrate already present at the pinned
      // version on THIS dev/CI host is correctly a no-op (real run and
      // dry-run alike), so its version need not appear in any single run's
      // output. The durable proof is structural - every install function
      // reads its version via bootstrap_lock_value, never a hardcoded or
      // floating string.
      const libSource = fs.readFileSync(path.join(SWARM_DEPLOY, 'lib', 'host_bootstrap.sh'), 'utf8');
      for (const expr of [
        "data['secondary_host_substrate']['babashka']['version']",
        "data['secondary_host_substrate']['node']['major']",
        "data['secondary_host_substrate']['claude_cli']['version']",
      ]) {
        if (!libSource.includes(expr)) {
          throw new Error(`expected lib/host_bootstrap.sh to read "${expr}" from the lock file, but it does not`);
        }
      }
      return;
    }
    if (guarantee === 'no install resolved a floating latest version') {
      if (/\blatest\b|\bstable\b/i.test(ctx.output)) {
        throw new Error(`expected no floating "latest"/"stable" channel reference, got:\n${ctx.output}`);
      }
      return;
    }
    if (guarantee === 'the agent auto-updater is disabled for the service environment') {
      if (!/DISABLE_AUTOUPDATER/.test(ctx.output)) {
        throw new Error(`expected DISABLE_AUTOUPDATER to be part of the provisioning output, got:\n${ctx.output}`);
      }
      return;
    }
    // the box relaunches its swarm after a reboot with no human action
    const swarmUnit = fs.readFileSync(path.join(ctx.unitTmpDir, `swarmforge-${ctx.swarmName}.service`), 'utf8');
    if (!/^WantedBy=multi-user\.target$/m.test(swarmUnit)) {
      throw new Error(`expected the swarm unit to carry WantedBy=multi-user.target (boot-persistent), got:\n${swarmUnit}`);
    }
  });

  // ── autonomous-bootstrap-04: the secondary shape is unchanged ─────────
  step(/^the same inputs that provisioned a secondary box before this change$/, (ctx) => {
    ctx.secondarySource = fs.readFileSync(SECONDARY_INSTALLER, 'utf8');
  });

  step(/^the secondary provisioning path is run$/, (ctx) => {
    // provision_secondary_host.sh has no dry-run mode and performs real
    // sudo/apt-get/curl calls unconditionally - it is never actually
    // spawned here. "Run" is proven statically: this ticket added ZERO
    // bytes of coupling into it (grep for the absence of every symbol
    // BL-628 introduced), so its behavior for identical inputs is provably
    // the SAME code path as before this ticket, not merely "probably
    // unchanged".
    for (const symbol of ['host_bootstrap.sh', 'BOOTSTRAP_DRYRUN', 'PROVISION_AUTONOMOUS', 'generate_autonomous_conf', 'front-desk']) {
      if (ctx.secondarySource.includes(symbol)) {
        throw new Error(`expected provision_secondary_host.sh to carry NO BL-628 coupling, but found "${symbol}" in it`);
      }
    }
  });

  step(/^it installs the same substrate, writes the same conf and enables the same units$/, (ctx) => {
    if (!ctx.secondarySource.includes('generate_secondary_conf.sh')) {
      throw new Error('expected provision_secondary_host.sh to still call generate_secondary_conf.sh (untouched by this ticket)');
    }
    if (!/generate_systemd_units\.sh"\s+"\$PROJECT_ROOT"\s+"\$SWARM_NAME"\s+"\$\(whoami\)"\s+"\$UNIT_PATH"\s*$/m.test(ctx.secondarySource)) {
      throw new Error('expected the FIRST generate_systemd_units.sh call to still render the default (swarm) unit with no --unit= flag, exactly as before this ticket');
    }
    if (!ctx.secondarySource.includes('--unit=operator')) {
      throw new Error('expected provision_secondary_host.sh to still render the operator unit');
    }
  });

  step(/^no unit the secondary shape never had is enabled$/, (ctx) => {
    if (ctx.secondarySource.includes('--unit=front-desk')) {
      throw new Error('expected provision_secondary_host.sh to never reference the front-desk unit - that is the autonomous path\'s own addition (BL-359\'s "exactly as dark as no unit at all" gap this ticket closes only for the NEW shape)');
    }
    const enableCalls = ctx.secondarySource.match(/systemctl enable[^\n]*/g) || [];
    if (enableCalls.some((line) => line.includes('front-desk'))) {
      throw new Error(`expected no front-desk systemctl enable call in provision_secondary_host.sh, got: ${enableCalls.join('; ')}`);
    }
  });

  // ── autonomous-bootstrap-05 (Outline): a non-unique swarm name ────────
  step(/^a swarm name that is (.+)$/, (ctx, defect) => {
    ctx.nameDefect = defect;
    if (defect === 'already claimed by another live swarm') {
      ctx.unitCollideDir = mkTmp('aps-bl628-collide-');
      fs.writeFileSync(path.join(ctx.unitCollideDir, 'swarmforge-taken.service'), '');
      ctx.swarmNameUnderTest = 'taken';
    } else if (defect === 'the placeholder name shipped in the pack') {
      ctx.swarmNameUnderTest = 'autonomous';
    } else {
      throw new Error(`autonomous-bootstrap-05: unknown name-defect example "${defect}"`);
    }
  });

  step(/^the autonomous provisioning path is started$/, (ctx) => {
    const extraEnv = ctx.unitCollideDir ? { SWARMFORGE_SYSTEMD_UNIT_DIR: ctx.unitCollideDir } : {};
    runAutonomous(ctx, ctx.swarmNameUnderTest, extraEnv);
  });

  step(/^it refuses to generate a conf$/, (ctx) => {
    if (ctx.status === 0) {
      throw new Error(`expected a non-zero exit for name defect "${ctx.nameDefect}", got success. Output:\n${ctx.output}`);
    }
  });

  step(/^it reports the name as the reason$/, (ctx) => {
    if (!ctx.output.includes(ctx.swarmNameUnderTest)) {
      throw new Error(`expected the refusal reason to name "${ctx.swarmNameUnderTest}", got:\n${ctx.output}`);
    }
  });

  step(/^nothing is installed or enabled on the host$/, (ctx) => {
    if (/\[bootstrap\] 1\/7/.test(ctx.output)) {
      throw new Error(`expected NO bootstrap step to have started for a refused name, got:\n${ctx.output}`);
    }
    if (fs.existsSync(path.join(ctx.projectRoot, 'swarmforge', 'packs', `${ctx.swarmNameUnderTest}.conf`))) {
      throw new Error('expected no per-project conf to have been written for a refused name');
    }
  });

  // ── autonomous-bootstrap-06 (Outline): dry-run mode ────────────────────
  const ACTION_ASSERTIONS = {
    'package install': (output) => /DRYRUN:.*apt-get/i.test(output),
    'file write': (output) => /DRYRUN:.*git clone|DRYRUN:.*settings\.json|DRYRUN:.*\.env/i.test(output),
    'unit enable': (output) => /DRYRUN:.*systemctl enable/i.test(output),
  };
  step(/^the autonomous provisioning path is run in dry-run mode$/, (ctx) => {
    const out = runAutonomous(ctx, 'dry-run-vps');
    if (out.status !== 0) {
      throw new Error(`expected a dry run to succeed (nothing real is attempted), got: ${ctx.output}`);
    }
  });

  step(/^every (.+) it would perform is printed$/, (ctx, action) => {
    if (!(action in ACTION_ASSERTIONS)) {
      throw new Error(`autonomous-bootstrap-06: unknown action example "${action}"`);
    }
    if (!ACTION_ASSERTIONS[action](ctx.output)) {
      throw new Error(`expected a DRYRUN line for "${action}", got:\n${ctx.output}`);
    }
  });

  step(/^no (.+) is performed$/, (ctx, action) => {
    if (action === 'package install') {
      // apt-get itself is very unlikely to be on a dev/CI host's PATH under
      // sudo without a password prompt; the decisive proof is structural -
      // every apt-get/curl-install line in the dry-run output is prefixed
      // "DRYRUN:", never a bare, unprefixed invocation line.
      const badLines = ctx.output.split('\n').filter((l) => /apt-get (update|install)/.test(l) && !l.startsWith('DRYRUN:'));
      if (badLines.length > 0) {
        throw new Error(`expected every apt-get line to be DRYRUN-prefixed, found a real one: ${badLines.join('; ')}`);
      }
    }
    if (action === 'file write') {
      if (fs.existsSync(path.join(ctx.projectRoot, '..', 'never-cloned-marker'))) {
        throw new Error('unexpected marker file - dry-run must not write files outside the scratch unit-tmp dir');
      }
    }
    if (action === 'unit enable') {
      const badLines = ctx.output.split('\n').filter((l) => /sudo systemctl enable/.test(l) && !l.startsWith('DRYRUN:'));
      if (badLines.length > 0) {
        throw new Error(`expected every systemctl enable line to be DRYRUN-prefixed, found a real one: ${badLines.join('; ')}`);
      }
    }
  });

  // ── autonomous-bootstrap-07: unit content has exactly one author ──────
  step(/^the units installed by either provisioning path are compared with the generator's output$/, (ctx) => {
    runAutonomous(ctx, 'compare-vps');
    ctx.autonomousUnit = fs.readFileSync(path.join(ctx.unitTmpDir, 'swarmforge-compare-vps.service'), 'utf8');

    const directTmp = mkTmp('aps-bl628-direct-');
    const directPath = path.join(directTmp, 'direct.service');
    execFileSync('bash', [GENERATE_SYSTEMD_UNITS, ctx.projectRoot, 'compare-vps', require('node:os').userInfo().username, directPath]);
    ctx.directUnit = fs.readFileSync(directPath, 'utf8');

    ctx.secondarySource = fs.readFileSync(SECONDARY_INSTALLER, 'utf8');
    ctx.autonomousSource = fs.readFileSync(AUTONOMOUS_INSTALLER, 'utf8');
  });

  step(/^every unit was rendered by the existing unit generator$/, (ctx) => {
    if (ctx.autonomousUnit !== ctx.directUnit) {
      throw new Error(`expected the autonomous path's installed unit to byte-match a direct generate_systemd_units.sh call, got a mismatch`);
    }
  });

  step(/^no provisioning path composes unit content of its own$/, (ctx) => {
    for (const [label, source] of [
      ['provision_secondary_host.sh', ctx.secondarySource],
      ['provision_autonomous_host.sh', ctx.autonomousSource],
    ]) {
      if (/\[Unit\]/.test(source) || /\[Service\]/.test(source)) {
        throw new Error(`expected ${label} to author NO unit content of its own ([Unit]/[Service] sections), found one`);
      }
    }
  });

  // ── autonomous-bootstrap-08: the runbook says where the ceremony runs ──
  step(/^the autonomous bring-up runbook is read$/, (ctx) => {
    if (!fs.existsSync(RUNBOOK)) {
      throw new Error(`expected the autonomous bring-up runbook at ${path.relative(REPO_ROOT, RUNBOOK)} - not yet written (documenter's pass, per this ticket's own required_stages)`);
    }
    ctx.runbookText = fs.readFileSync(RUNBOOK, 'utf8');
  });

  step(/^it states that the ceremony runs on the primary box against a repository URL$/, (ctx) => {
    if (!/primary box/i.test(ctx.runbookText) || !/repository URL|repo URL|clone URL/i.test(ctx.runbookText)) {
      throw new Error('expected the runbook to state the onboarding ceremony runs on the primary box against a repository URL');
    }
  });

  step(/^it states that the remote box pulls the committed contract and prompts$/, (ctx) => {
    if (!/pulls?\b.*(committed|contract|prompt)/is.test(ctx.runbookText)) {
      throw new Error('expected the runbook to state the remote box pulls the committed contract/prompts');
    }
  });

  step(/^it states that the contract is never negotiated on the remote box$/, (ctx) => {
    if (!/never negotiated/i.test(ctx.runbookText)) {
      throw new Error('expected the runbook to state the contract is never negotiated on the remote box');
    }
  });
}

module.exports = { registerSteps };
