'use strict';

// BL-1560: BL-848 stamp-off review of hotfix 1fc9065605, "seats stop
// hunting for ready_for_next.sh at the worktree root."
//
// This CONFIRMS OR REFUTES what landed. It reimplements nothing, changes
// no hotfix source line, and writes nothing to the ledger (invariant + the
// ticket's FIRM constraints). Scenarios 01/02/04 EXECUTE the real
// tool-miss-heal-lib through lib/bl1560ToolMissHealCli.bb - a source-text
// assertion cannot tell a wired heal from a dead one. Scenario 03 executes
// the real composed wrapper over real bash, outside the fixture worktree.
// Scenario 05 runs the real hotfix test runner as a subprocess. Scenario 06
// renders real launch scripts via the real write_role_launch_script.
// Scenario 07 reads (never writes) the hotfix ledger.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1560 Stamp-off review of the seats-stop-hunting-for-ready_for_next hotfix';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HOTFIX = '1fc9065605';
const CLI = path.join(__dirname, 'lib', 'bl1560ToolMissHealCli.bb');
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const TOOL_MISS_HEAL_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'tool_miss_heal_lib.bb');
const TEST_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'tool_miss_heal_lib_test_runner.bb');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const RESUME_NUDGE = './swarmforge/scripts/ready_for_next.sh (it is NOT at the worktree root)';

function git(...args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
}

function runCli(subcommand, argsObj) {
  const out = execFileSync('bb', [CLI, subcommand, JSON.stringify(argsObj)], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

// ── Scenario 01 KNOWN_VALUES ─────────────────────────────────────────────

const KNOWN_OUTPUTS = {
  'the zsh spelling of a missing root-level ready_for_next.sh':
    '(eval):13: no such file or directory: ./ready_for_next.sh',
  'the bash spelling of a missing root-level done_with_current.sh':
    'bash: ./done_with_current.sh: No such file or directory',
  'the bash spelling of a missing root-level notes.txt':
    'bash: ./notes.txt: No such file or directory',
  'the bash spelling of a missing ready_for_next.sh already under swarmforge/scripts':
    'bash: ./swarmforge/scripts/ready_for_next.sh: No such file or directory',
  'a root-level script miss beside an npm package.json ENOENT':
    'no such file or directory: ./x.sh\nnpm error code ENOENT',
  'a root-level script miss beside fatal not a git repository':
    'fatal: not a git repository\nno such file or directory: ./x.sh',
};

const KNOWN_VERDICTS = ['missing-script-path', 'real-failure', 'wrong-surface', 'wrong-cwd', 'missing-root-argv'];

// ── Scenario 02 KNOWN_VALUES ─────────────────────────────────────────────

const KNOWN_COMMANDS = {
  'a root-level ready_for_next.sh piped into tail': './ready_for_next.sh 2>&1 | tail -50',
  'a root-level done_with_current.sh then ready_for_next.sh in one sequence':
    './done_with_current.sh; ./ready_for_next.sh',
  'ready_for_next.sh already under swarmforge/scripts': './swarmforge/scripts/ready_for_next.sh',
  'a command naming no shell script at all': 'cat ./notes.txt',
  'a script name that is the tail of a longer path': 'bash /tmp/x/./y.sh',
};

const PIN = '/w';

function expectedHealed(outcomePhrase) {
  if (outcomePhrase === 'declines') {
    return null;
  }
  if (outcomePhrase === 're-runs the pipeline from the pin with the helper under swarmforge/scripts and the tail kept') {
    return `cd '${PIN}' && (\n./swarmforge/scripts/ready_for_next.sh 2>&1 | tail -50\n)`;
  }
  if (outcomePhrase === 're-runs the sequence from the pin with both helpers under swarmforge/scripts') {
    return `cd '${PIN}' && (\n./swarmforge/scripts/done_with_current.sh; ./swarmforge/scripts/ready_for_next.sh\n)`;
  }
  throw new Error(`unknown outcome phrase: "${outcomePhrase}"`);
}

// ── Scenario 06 fixture ───────────────────────────────────────────────────

const LAUNCH_ROLES = [
  { role: 'coder', agent: 'claude', model: 'sonnet' },
  { role: 'documenter', agent: 'codex', model: 'x' },
  { role: 'architect', agent: 'cursor', model: 'x' },
  { role: 'hardender', agent: 'gemini', model: 'x' },
  { role: 'cleaner', agent: 'local-model', model: 'qwen2.5-coder:7b-instruct' },
];

function mkLaunchFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1560-launch-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const { role } of LAUNCH_ROLES) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  const confLines = ['config active_backlog_max_depth -1'];
  for (const { role, agent, model } of LAUNCH_ROLES) {
    confLines.push(`window ${role} ${agent} ${role} --model ${model}`);
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), confLines.join('\n') + '\n');
  return root;
}

const INDEX_OF_ROLE_SNIPPET = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function renderLaunchScript(root, role) {
  // BL-1318: bypass the steward staffing gate for a fixture placeholder
  // --model value. SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS=healthy: the
  // local-model seat's own launch-body rendering checks endpoint health.
  // zsh is required (the render seams source swarmforge.sh under zsh, as
  // every launch test does) - a missing zsh must FAIL this scenario, not
  // pass it vacuously, so no fallback shell is attempted here.
  execFileSync(
    'zsh',
    [
      '-c',
      `source '${SWARMFORGE_SH}' '${root}'\nparse_config\n${INDEX_OF_ROLE_SNIPPET}\nwrite_role_launch_script "$(index_of_role ${role})" >/dev/null\n`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PACK_STAFFING_SKIP_GATE: '1', SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS: 'healthy' },
    }
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ────────────────────────────────────────────────────────

  scoped(/^a captured first attempt whose output is (.+)$/, (ctx, phrase) => {
    assert.ok(phrase in KNOWN_OUTPUTS, `unknown output phrase "${phrase}"`);
    ctx.bl1560 = ctx.bl1560 ?? {};
    ctx.bl1560.output = KNOWN_OUTPUTS[phrase];
  });

  scoped(/^the miss is classified$/, (ctx) => {
    const { verdict } = runCli('classify', { output: ctx.bl1560.output });
    ctx.bl1560.verdict = verdict;
  });

  scoped(/^the verdict is (.+)$/, (ctx, verdict) => {
    assert.ok(KNOWN_VERDICTS.includes(verdict), `unknown verdict "${verdict}"`);
    assert.equal(ctx.bl1560.verdict, verdict);
  });

  // ── Scenario 02 ────────────────────────────────────────────────────────

  scoped(/^the original command is (.+)$/, (ctx, phrase) => {
    assert.ok(phrase in KNOWN_COMMANDS, `unknown command phrase "${phrase}"`);
    ctx.bl1560 = ctx.bl1560 ?? {};
    ctx.bl1560.originalCommand = KNOWN_COMMANDS[phrase];
  });

  scoped(/^the missing-script-path heal is composed for the pinned worktree$/, (ctx) => {
    const { healed } = runCli('heal', {
      missClass: 'missing-script-path',
      command: ctx.bl1560.originalCommand,
      worktree: PIN,
    });
    ctx.bl1560.healed = healed;
  });

  scoped(/^the heal (.+)$/, (ctx, outcomePhrase) => {
    assert.equal(ctx.bl1560.healed, expectedHealed(outcomePhrase));
  });

  // ── Scenario 03 ────────────────────────────────────────────────────────

  scoped(/^a fixture worktree whose ready_for_next\.sh lives only under swarmforge\/scripts and counts its runs$/, (ctx) => {
    ctx.bl1560 = ctx.bl1560 ?? {};
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1560-e2e-'));
    // BL-1390: prove isolation before any mutating git command - a fresh
    // mkdtemp dir, `git init` here can never touch the live checkout.
    execFileSync('git', ['init', '-q', tmp]);
    const commonDir = execFileSync('git', ['-C', tmp, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    assert.ok(
      path.resolve(tmp, commonDir).startsWith(tmp),
      `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
    );
    const scriptsDir = path.join(tmp, 'swarmforge', 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const helper = path.join(scriptsDir, 'ready_for_next.sh');
    const counter = path.join(tmp, 'n');
    fs.writeFileSync(
      helper,
      '#!/usr/bin/env bash\n' +
        `n=$(( $(cat ${counter} 2>/dev/null || echo 0) + 1 )); echo $n > ${counter}\n` +
        'printf \'TASK: fixture|pwd=%s\\n\' "$(pwd)"\n'
    );
    fs.chmodSync(helper, 0o755);
    ctx.bl1560.fixtureRoot = tmp;
    ctx.bl1560.fixtureCounter = counter;
    ctx.bl1560.disposables = ctx.__disposables ?? [];
    ctx.__disposables = ctx.bl1560.disposables;
    ctx.bl1560.disposables.push(async () => fs.rmSync(tmp, { recursive: true, force: true }));
  });

  scoped(/^a shell parked outside that worktree$/, (ctx) => {
    ctx.bl1560.outsideCwd = os.tmpdir();
    assert.ok(!ctx.bl1560.outsideCwd.startsWith(ctx.bl1560.fixtureRoot), 'the parked shell must be outside the fixture');
  });

  scoped(/^the real healing wrapper runs the original root-level ready_for_next\.sh piped into tail$/, (ctx) => {
    const { wrapper } = runCli('wrapper', { command: './ready_for_next.sh 2>&1 | tail -5', worktree: ctx.bl1560.fixtureRoot });
    const result = require('node:child_process').spawnSync('bash', ['-c', wrapper], {
      cwd: ctx.bl1560.outsideCwd,
      encoding: 'utf8',
    });
    ctx.bl1560.e2eResult = result;
  });

  scoped(/^the model sees the helper's own output with exit 0$/, (ctx) => {
    assert.equal(ctx.bl1560.e2eResult.status, 0);
    assert.match(ctx.bl1560.e2eResult.stdout, new RegExp(`TASK: fixture\\|pwd=${ctx.bl1560.fixtureRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  scoped(/^the helper ran exactly once$/, (ctx) => {
    assert.equal(fs.readFileSync(ctx.bl1560.fixtureCounter, 'utf8').trim(), '1');
  });

  scoped(/^no "no such file" text reaches the model$/, (ctx) => {
    assert.ok(!ctx.bl1560.e2eResult.stdout.toLowerCase().includes('no such file'));
  });

  // ── Scenario 04 ────────────────────────────────────────────────────────

  scoped(/^the real healing wrapper is composed for a plain git status$/, (ctx) => {
    ctx.bl1560 = ctx.bl1560 ?? {};
    const { wrapper } = runCli('wrapper', { command: 'git status', worktree: PIN });
    ctx.bl1560.plainWrapper = wrapper;
  });

  scoped(/^its chain opens on a non-zero exit only$/, (ctx) => {
    assert.match(ctx.bl1560.plainWrapper, /if \[ \$__sfh_ec -ne 0 \]; then\n/);
    assert.doesNotMatch(ctx.bl1560.plainWrapper, /if \[ \$__sfh_ec -ne 0 \] \|\| grep/);
  });

  scoped(/^it carries no swarmforge\/scripts repointing clause$/, (ctx) => {
    assert.ok(!ctx.bl1560.plainWrapper.includes('swarmforge/scripts'));
  });

  // ── Scenario 05 ────────────────────────────────────────────────────────

  scoped(/^the tool-miss heal lib test runner runs$/, (ctx) => {
    ctx.bl1560 = ctx.bl1560 ?? {};
    ctx.bl1560.runnerOutput = execFileSync('bb', [TEST_RUNNER], { encoding: 'utf8' });
    ctx.bl1560.runnerSource = fs.readFileSync(TEST_RUNNER, 'utf8');
  });

  scoped(/^it reports all tests pass$/, (ctx) => {
    assert.match(ctx.bl1560.runnerOutput, /ALL TESTS PASS/);
  });

  scoped(/^its source still carries the missing-script-path section and the one-run end-to-end assertion$/, (ctx) => {
    assert.match(ctx.bl1560.runnerSource, /Hotfix 2026-09-14: :missing-script-path/);
    assert.match(ctx.bl1560.runnerSource, /e2e: the helper ran exactly once/);
  });

  // ── Scenario 06 ────────────────────────────────────────────────────────

  scoped(/^a fixture root seating one role on each of claude, codex, cursor, gemini and local-model$/, (ctx) => {
    ctx.bl1560 = ctx.bl1560 ?? {};
    ctx.bl1560.launchRoot = mkLaunchFixtureRoot();
    ctx.bl1560.disposables = ctx.__disposables ?? [];
    ctx.__disposables = ctx.bl1560.disposables;
    const root = ctx.bl1560.launchRoot;
    ctx.bl1560.disposables.push(async () => fs.rmSync(root, { recursive: true, force: true }));
  });

  scoped(/^one of those roles holds a leftover in_process parcel$/, (ctx) => {
    // Mirrors test_resume_on_start.sh's real orphaned-claim fixture: exactly
    // what ready_for_next_task.bb leaves behind when an agent claims a
    // parcel and is killed before finishing it.
    const root = ctx.bl1560.launchRoot;
    const roleWorktree = path.join(root, '.worktrees', 'coder');
    fs.mkdirSync(path.join(roleWorktree, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
    fs.mkdirSync(path.join(roleWorktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
    fs.writeFileSync(
      path.join(roleWorktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', '00_orphaned.handoff'),
      'from: coordinator\nto: coder\npriority: 20\ntype: note\ntask: BL-999\ndequeued_at: 2026-07-12T17:18:24Z\n\nresume this\n'
    );
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'roles.tsv'),
      `coder\tcoder\t${roleWorktree}\tswarmforge-coder\tCoder\tclaude\ttask\n`
    );
    ctx.bl1560.resumeRoleWorktree = roleWorktree;
  });

  scoped(/^the real launch scripts are rendered$/, (ctx) => {
    const root = ctx.bl1560.launchRoot;
    ctx.bl1560.launchScripts = {};
    for (const { role, agent } of LAUNCH_ROLES) {
      renderLaunchScript(root, role);
      const scriptPath = path.join(root, '.swarmforge', 'launch', `${role}.sh`);
      assert.ok(fs.existsSync(scriptPath), `expected ${role}.sh to be generated for agent ${agent}`);
      ctx.bl1560.launchScripts[role] = fs.readFileSync(scriptPath, 'utf8');
    }
  });

  scoped(/^all five launch bodies tell the seat to run \.\/swarmforge\/scripts\/ready_for_next\.sh and that it is not at the worktree root$/, (ctx) => {
    assert.equal(Object.keys(ctx.bl1560.launchScripts).length, 5);
    for (const [role, body] of Object.entries(ctx.bl1560.launchScripts)) {
      assert.ok(body.includes(RESUME_NUDGE), `${role}'s launch body must carry "${RESUME_NUDGE}", got: ${body}`);
    }
  });

  scoped(/^no launch body tells the seat to run the bare ready_for_next\.sh$/, (ctx) => {
    for (const [role, body] of Object.entries(ctx.bl1560.launchScripts)) {
      assert.ok(!body.includes('run ready_for_next.sh.'), `${role}'s launch body must not carry the bare "run ready_for_next.sh.", got: ${body}`);
    }
  });

  scoped(/^the rendered RESUME-ON-START note names \.\/swarmforge\/scripts\/ready_for_next\.sh$/, (ctx) => {
    const coderBody = ctx.bl1560.launchScripts.coder;
    assert.match(coderBody, /RESUME-ON-START/);
    assert.match(coderBody, /Run \.\/swarmforge\/scripts\/ready_for_next\.sh as your very first action/);
  });

  // ── Scenario 07 ────────────────────────────────────────────────────────

  scoped(/^the review parcel completes$/, (ctx) => {
    ctx.bl1560 = ctx.bl1560 ?? {};
    ctx.bl1560.reviewComplete = true;
  });

  scoped(/^the ledger row for the reviewed commit still reads "pending"$/, (ctx) => {
    assert.equal(ctx.bl1560.reviewComplete, true);
    const ledger = fs.readFileSync(LEDGER, 'utf8');
    const entry = ledger.split(/\n(?=-\s*commit:)/).find((block) => block.includes(`commit: ${HOTFIX}`));
    assert.ok(entry, `no hotfix-ledger entry for ${HOTFIX}`);
    assert.match(entry, /state:\s*pending/, `ledger row is no longer pending: ${entry}`);
    assert.match(entry, /human_decision:\s*null/, `ledger row already carries a human decision: ${entry}`);
    assert.equal(
      git('status', '--porcelain', '--', 'backlog/hotfix-ledger.yaml').trim(),
      '',
      'a stamp-off review must never modify the hotfix ledger'
    );
  });
}

module.exports = { registerSteps, KNOWN_OUTPUTS, KNOWN_COMMANDS, TOOL_MISS_HEAL_LIB };
