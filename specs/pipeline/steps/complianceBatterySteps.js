'use strict';

// BL-231: step handlers for the swarm-compliance-battery feature. Drives
// the REAL compliance_battery.bb CLI (which itself drives the REAL
// swarm_handoff.bb/ready_for_next.bb/done_with_current.bb/
// gherkin_lint_gate.sh/run_acceptance.sh/backlog_depth_lib.bb) against
// scratch git fixtures - no hand-simulated check logic here, only fixture
// construction and CLI invocation, mirroring readyForNextPromotionSteps.js's
// own real-script-driving convention.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BATTERY = path.join(SWARMFORGE_SCRIPTS, 'compliance_battery.bb');
const SWARM_HANDOFF = path.join(SWARMFORGE_SCRIPTS, 'swarm_handoff.bb');
const READY_FOR_NEXT = path.join(SWARMFORGE_SCRIPTS, 'ready_for_next.bb');
const DONE_WITH_CURRENT = path.join(SWARMFORGE_SCRIPTS, 'done_with_current.bb');
const GHERKIN_LINT_GATE = path.join(SWARMFORGE_SCRIPTS, 'gherkin_lint_gate.sh');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');
const REAL_FEATURE_FILE = path.join(REPO_ROOT, 'specs', 'features', 'BL-226-remove-dead-promote-in-ready-for-next.feature');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function battery(args) {
  const out = execFileSync('bb', [BATTERY, ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}

function writeFakeTmux(fixtureRoot) {
  const fakeBin = path.join(fixtureRoot, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const stdoutFile = path.join(fixtureRoot, 'pane-stdout.txt');
  fs.writeFileSync(stdoutFile, '❯ \n');
  const script = [
    '#!/usr/bin/env bash',
    'for arg in "$@"; do',
    '  if [[ "$arg" == "capture-pane" ]]; then',
    `    cat "${stdoutFile}"`,
    '    exit 0',
    '  fi',
    'done',
    'exit 0',
    '',
  ].join('\n');
  const tmuxPath = path.join(fakeBin, 'tmux');
  fs.writeFileSync(tmuxPath, script);
  fs.chmodSync(tmuxPath, 0o755);
  return fakeBin;
}

// Builds a scratch fixture with a specifier (master-resident) and coder
// (dedicated worktree) role. `violation` is null for a fully compliant
// fixture, or one of send-handoff/commit-byline/no-op-rule/no-scheduling
// to simulate exactly that one non-compliant action - everything else
// stays compliant, matching scripted-fail-02's one-violation-at-a-time
// scenario shape.
function buildFixture(violation) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-compliance-battery-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);

  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock + '\n');

  const specifierWt = root;
  const coderWt = path.join(root, '.worktrees', 'coder');
  fs.mkdirSync(path.join(specifierWt, '.swarmforge', 'handoffs', 'specifier', 'outbox', 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(specifierWt, '.swarmforge', 'handoffs', 'specifier', 'sent'), { recursive: true });
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });

  const rolesTsv =
    `specifier\tmaster\t${specifierWt}\tswarmforge-specifier\tSpecifier\tclaude\ttask\toff\n` +
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\toff\n`;
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesTsv);

  const fakeBin = writeFakeTmux(root);
  const baseEnv = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };

  let commitSha = null;

  if (violation === 'send-handoff') {
    fs.writeFileSync(
      path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new', '50_bypass_for_coder.handoff'),
      'id: bypass\nfrom: specifier\nto: coder\npriority: 50\ntype: note\nmessage: direct write\ncreated_at: 2026-07-10T00:00:00Z\n\nbypass\n'
    );
  } else {
    if (violation === 'no-scheduling') {
      fs.writeFileSync(path.join(root, 'scheduler.js'), 'setInterval(function () { poll(); }, 60000);\n');
      git(root, ['add', 'scheduler.js']);
    } else if (violation !== 'no-op-rule') {
      // no-op-rule's whole point is an EMPTY commit - staging a real file
      // here would defeat --allow-empty below (a staged change always
      // commits, regardless of --allow-empty).
      fs.writeFileSync(path.join(root, 'change.txt'), 'a real change\n');
      git(root, ['add', 'change.txt']);
    }
    const message = violation === 'commit-byline' ? 'did a thing, no byline' : 'did a thing\n\nBy coder.';
    if (violation === 'no-op-rule') {
      git(root, ['commit', '-q', '--allow-empty', '-m', message]);
    } else {
      git(root, ['commit', '-q', '-m', message]);
    }
    commitSha = git(root, ['rev-parse', '--short=10', 'HEAD']);

    const draft = path.join(root, 'draft.handoff');
    fs.writeFileSync(draft, `type: git_handoff\nto: coder\npriority: 50\ntask: BL-231-battery-fixture\ncommit: ${commitSha}\n`);
    execFileSync('bb', [SWARM_HANDOFF, draft], {
      cwd: specifierWt,
      env: { ...baseEnv, SWARMFORGE_ROLE: 'specifier', SWARMFORGE_SKIP_DAEMON: '1' },
    });
  }

  if (violation !== 'receive') {
    execFileSync('bb', [READY_FOR_NEXT], { cwd: coderWt, env: { ...baseEnv, SWARMFORGE_ROLE: 'coder' } });
  }
  if (violation !== 'complete' && violation !== 'receive') {
    execFileSync('bb', [DONE_WITH_CURRENT], { cwd: coderWt, env: { ...baseEnv, SWARMFORGE_ROLE: 'coder' } });
  }

  return { root, coderWt, commitSha };
}

function runScriptedCoreBattery(violation) {
  const fixture = buildFixture(violation);
  const entries = [
    battery(['check', 'receive', fixture.coderWt]),
    battery(['check', 'complete', fixture.coderWt]),
    battery(['check', 'send-handoff', fixture.root, 'specifier', 'coder']),
  ];
  if (fixture.commitSha) {
    entries.push(battery(['check', 'commit-byline', fixture.root, fixture.commitSha, 'coder']));
    entries.push(battery(['check', 'no-op-rule', fixture.root, 'specifier', fixture.commitSha]));
    entries.push(battery(['check', 'no-scheduling', fixture.root, fixture.commitSha]));
  }
  return entries;
}

const VIOLATION_TEXT_TO_KEY = {
  'writes inbox/new directly instead of swarm_handoff.sh': 'send-handoff',
  'commits without the role byline': 'commit-byline',
  'forwards a no-functional-change commit': 'no-op-rule',
  'self-schedules a loop or cron': 'no-scheduling',
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^the compliance battery runs a candidate agent through swarm tasks in a scratch worktree using the real helper scripts$/,
    () => {
      for (const script of [BATTERY, SWARM_HANDOFF, READY_FOR_NEXT, DONE_WITH_CURRENT, GHERKIN_LINT_GATE, RUN_ACCEPTANCE]) {
        if (!fs.existsSync(script)) {
          throw new Error(`expected the battery to wrap a real helper script, missing: ${script}`);
        }
      }
    }
  );

  // ── scripted-pass-01 ─────────────────────────────────────────────────
  registry.define(/^a candidate agent that performs all scripted core tasks correctly$/, (ctx) => {
    ctx.violation = null;
  });

  registry.define(/^the battery runs$/, (ctx) => {
    if (ctx.competency) {
      ctx.rubricEntry = battery(['rubric', ctx.competency]);
      return;
    }
    ctx.entries = runScriptedCoreBattery(ctx.violation);
  });

  registry.define(/^every scripted core check is recorded pass on the scorecard$/, (ctx) => {
    const failing = ctx.entries.filter((e) => e.status !== 'pass');
    if (failing.length > 0) {
      throw new Error(`expected every scripted core check to pass, but these did not: ${JSON.stringify(failing)}`);
    }
  });

  // ── scripted-fail-02 ─────────────────────────────────────────────────
  registry.define(/^a candidate agent that "([^"]+)"$/, (ctx, violationText) => {
    const key = VIOLATION_TEXT_TO_KEY[violationText];
    if (!key) {
      throw new Error(`unknown violation text: "${violationText}"`);
    }
    ctx.violation = key;
  });

  registry.define(/^the "([^"]+)" check is recorded fail with the reason on the scorecard$/, (ctx, check) => {
    const found = ctx.entries.find((e) => e.competency === check);
    if (!found) {
      throw new Error(`expected a "${check}" entry on the scorecard, entries were: ${JSON.stringify(ctx.entries)}`);
    }
    if (found.status !== 'fail') {
      throw new Error(`expected "${check}" to be recorded fail, got status: ${found.status}`);
    }
    if (!found.reason) {
      throw new Error(`expected "${check}" to carry a reason for its failure, got: ${JSON.stringify(found)}`);
    }
  });

  // ── human-rubric-03 ──────────────────────────────────────────────────
  registry.define(/^the "([^"]+)" competency, which cannot be judged by script$/, (ctx, competency) => {
    ctx.competency = competency;
  });

  registry.define(/^it is presented to a human with a rubric and the verdict is recorded on the scorecard$/, (ctx) => {
    if (ctx.rubricEntry.status !== 'human-rubric-pending' || !ctx.rubricEntry.rubric) {
      throw new Error(`expected a pending rubric entry carrying a rubric prompt, got: ${JSON.stringify(ctx.rubricEntry)}`);
    }
    // Simulates a human recording their verdict - the SAME CLI subcommand,
    // just with the verdict argument supplied.
    const judged = battery(['rubric', ctx.competency, 'compliant']);
    if (judged.status !== 'human-verdict-compliant' || judged.rubric) {
      throw new Error(`expected the recorded verdict to replace the pending rubric, got: ${JSON.stringify(judged)}`);
    }
  });

  // ── per-role-04 ──────────────────────────────────────────────────────
  registry.define(/^a candidate agent under test as the "([^"]+)"$/, (ctx, role) => {
    ctx.role = role;
    ctx.fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-compliance-battery-role-'));
  });

  registry.define(/^the battery runs that role's gate$/, (ctx) => {
    switch (ctx.role) {
      case 'specifier':
        ctx.gateResult = battery(['gate', 'specifier', REAL_FEATURE_FILE, REPO_ROOT]);
        break;
      case 'coder':
        ctx.gateResult = battery(['gate', 'coder', ctx.fixtureRoot, 'true']);
        break;
      case 'cleaner': {
        git(ctx.fixtureRoot, ['init', '-q']);
        git(ctx.fixtureRoot, ['config', 'user.email', 't@t']);
        git(ctx.fixtureRoot, ['config', 'user.name', 't']);
        fs.writeFileSync(path.join(ctx.fixtureRoot, 'f.txt'), 'refactored shape\n');
        git(ctx.fixtureRoot, ['add', 'f.txt']);
        git(ctx.fixtureRoot, ['commit', '-q', '-m', 'refactor\n\nBy cleaner.']);
        const sha = git(ctx.fixtureRoot, ['rev-parse', '--short=10', 'HEAD']);
        ctx.gateResult = battery(['gate', 'cleaner', ctx.fixtureRoot, 'true', sha]);
        break;
      }
      case 'architect': {
        const noteFile = path.join(ctx.fixtureRoot, 'note.txt');
        fs.writeFileSync(
          noteFile,
          'This change to swarmforge/scripts/compliance_battery_lib.bb introduces a race between the sender writing sent/ and the recipient reading inbox/new.'
        );
        ctx.gateResult = battery(['gate', 'architect', noteFile, REPO_ROOT]);
        break;
      }
      case 'hardener':
        ctx.gateResult = battery(['gate', 'hardener', '2', '1.0', '0']);
        break;
      case 'documenter': {
        git(ctx.fixtureRoot, ['init', '-q']);
        git(ctx.fixtureRoot, ['config', 'user.email', 't@t']);
        git(ctx.fixtureRoot, ['config', 'user.name', 't']);
        fs.mkdirSync(path.join(ctx.fixtureRoot, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(ctx.fixtureRoot, 'docs', 'Feature.md'), 'doc update');
        fs.writeFileSync(path.join(ctx.fixtureRoot, 'code.js'), 'code change');
        git(ctx.fixtureRoot, ['add', 'docs/Feature.md', 'code.js']);
        git(ctx.fixtureRoot, ['commit', '-q', '-m', 'add feature + doc\n\nBy documenter.']);
        const sha = git(ctx.fixtureRoot, ['rev-parse', '--short=10', 'HEAD']);
        ctx.gateResult = battery(['gate', 'documenter', ctx.fixtureRoot, sha]);
        break;
      }
      case 'QA':
        ctx.gateResult = battery(['gate', 'qa', REPO_ROOT, REAL_FEATURE_FILE, 'approve']);
        break;
      case 'coordinator':
        ctx.gateResult = battery(['gate', 'coordinator', '1', '3', 'true']);
        break;
      default:
        throw new Error(`unknown role under test: "${ctx.role}"`);
    }
  });

  registry.define(/^the "([^"]+)" outcome is recorded on the scorecard$/, (ctx, gate) => {
    if (ctx.gateResult.status !== 'pass') {
      throw new Error(`expected the ${gate} outcome to be recorded pass for a correctly-performed gate, got: ${JSON.stringify(ctx.gateResult)}`);
    }
  });

  // ── scorecard-05 ─────────────────────────────────────────────────────
  registry.define(/^the battery has completed for a candidate model$/, (ctx) => {
    ctx.entries = [
      { competency: 'receive', status: 'pass' },
      { competency: 'send-handoff', status: 'pass' },
      { competency: 'startup-reread', status: 'human-verdict-compliant' },
    ];
  });

  registry.define(/^the scorecard is produced$/, (ctx) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-compliance-battery-scorecard-'));
    const entriesFile = path.join(tmpDir, 'entries.json');
    fs.writeFileSync(entriesFile, JSON.stringify(ctx.entries));
    ctx.scorecard = battery(['scorecard', 'reference-model', entriesFile]);
  });

  registry.define(
    /^it lists each competency's pass, fail, or human verdict and an overall "swarm compliant" verdict$/,
    (ctx) => {
      if (ctx.scorecard.entries.length !== ctx.entries.length) {
        throw new Error(`expected the scorecard to list every competency, got: ${JSON.stringify(ctx.scorecard)}`);
      }
      for (const e of ctx.scorecard.entries) {
        if (!['pass', 'fail', 'human-rubric-pending', 'human-verdict-compliant', 'human-verdict-non-compliant'].includes(e.status)) {
          throw new Error(`unexpected status on the scorecard: ${JSON.stringify(e)}`);
        }
      }
      if (ctx.scorecard.overall !== 'swarm-compliant') {
        throw new Error(`expected the overall verdict to be swarm-compliant for this fully-compliant entry set, got: ${ctx.scorecard.overall}`);
      }
    }
  );

  // ── reference-06 ─────────────────────────────────────────────────────
  registry.define(/^the current Claude agent configuration as the reference$/, (ctx) => {
    // ctx.rolesTsv lets a test inject a fixture roles.tsv to exercise the
    // failure branch below without mutating the real, tracked file.
    const rolesTsv =
      ctx.rolesTsv !== undefined
        ? ctx.rolesTsv
        : (() => {
            const rolesTsvPath = path.join(REPO_ROOT, '.swarmforge', 'roles.tsv');
            return fs.existsSync(rolesTsvPath) ? fs.readFileSync(rolesTsvPath, 'utf8') : '';
          })();
    if (!/\tclaude\t/.test(rolesTsv)) {
      throw new Error('expected the live project\'s own roles.tsv to configure at least one role on the "claude" agent brand');
    }
    ctx.violation = null;
  });

  registry.define(/^the scripted battery runs$/, (ctx) => {
    ctx.entries = runScriptedCoreBattery(ctx.violation);
  });

  registry.define(/^every scripted check passes$/, (ctx) => {
    const failing = ctx.entries.filter((e) => e.status !== 'pass');
    if (failing.length > 0) {
      throw new Error(`reference-06: the battery must not flag the known-good reference agent - failing: ${JSON.stringify(failing)}`);
    }
  });
}

module.exports = { registerSteps };
