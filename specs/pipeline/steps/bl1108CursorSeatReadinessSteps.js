'use strict';

// BL-1108: step handlers for "a Cursor seat remains observable and recoverable".
// Stamp-off of hotfix f02f6ae5b4 — drives the REAL babysitter marker/sweep
// decisions (via bl1108_cursor_seat_readiness_acceptance_runner.bb), the REAL
// swarm_ensure.bb heal path for a Cursor half-launch, and the REAL launcher's
// Cursor launch-body builder. Never a JS restatement of those contracts.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'bl1108_cursor_seat_readiness_acceptance_runner.bb'
);
const SWARM_ENSURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_ensure.bb');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

const FEATURE_NAME = 'a Cursor seat remains observable and recoverable';

const KNOWN_AGENTS = {
  cursor: { process: 'cursor-agent', processResult: 'present', remoteControlResult: 'off' },
  claude: { process: 'claude --model', processResult: 'present', remoteControlResult: 'healthy' },
};
const KNOWN_PROCESS_RESULTS = new Set(['present', 'absent']);
const KNOWN_RC_RESULTS = new Set(['off', 'healthy', 'degraded']);

const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

const trackedPids = new Set();

function killTracked() {
  for (const pid of [...trackedPids]) {
    try {
      if (pid && pid !== process.pid) process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    trackedPids.delete(pid);
  }
}

process.on('exit', killTracked);

function runBb(subcommand, payload) {
  const out = execFileSync('bb', [RUNNER, subcommand, JSON.stringify(payload || {})], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

function writeExec(filePath, body) {
  fs.writeFileSync(filePath, body);
  fs.chmodSync(filePath, 0o755);
}

function zsh(script, env = {}) {
  return spawnSync('zsh', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, XDG_RUNTIME_DIR: '/tmp', ...env },
    timeout: 120000,
  });
}

function registerSteps(registry) {
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── cursor-seat-readiness-hotfix-01 ───────────────────────────────────
  define(/^a (\S+) role seat with its expected child process (.+)$/, (ctx, agent, processFrag) => {
    const known = KNOWN_AGENTS[agent];
    assert.ok(known, `unknown <agent> "${agent}" — known: ${Object.keys(KNOWN_AGENTS).join(' | ')}`);
    assert.equal(
      processFrag,
      known.process,
      `Examples row for "${agent}" must use process "${known.process}", got "${processFrag}"`
    );
    ctx.agent = agent;
    ctx.processFrag = processFrag;
    ctx.expected = known;
  });

  define(/^the babysitter checks the live seat$/, (ctx) => {
    ctx.health = runBb('live-seat-health', { agent: ctx.agent, process: ctx.processFrag });
  });

  define(/^the process result is (\S+)$/, (ctx, result) => {
    assert.ok(KNOWN_PROCESS_RESULTS.has(result), `unknown process result "${result}"`);
    assert.equal(ctx.expected.processResult, result, 'Examples row does not match Then');
    assert.equal(
      ctx.health.processResult,
      result,
      `process result: ${JSON.stringify(ctx.health)}`
    );
    assert.equal(
      ctx.health.marker,
      ctx.agent === 'cursor' ? 'cursor-agent' : 'claude ',
      `marker must follow the agent token, not assume Claude: ${JSON.stringify(ctx.health)}`
    );
  });

  define(/^the remote-control result is (\S+)$/, (ctx, result) => {
    assert.ok(KNOWN_RC_RESULTS.has(result), `unknown remote-control result "${result}"`);
    assert.equal(ctx.expected.remoteControlResult, result, 'Examples row does not match Then');
    assert.equal(
      ctx.health.remoteControlResult,
      result,
      `remote-control result: ${JSON.stringify(ctx.health)}`
    );
  });

  // ── cursor-seat-readiness-hotfix-02 ───────────────────────────────────
  define(/^a Cursor role pane whose cursor-agent child is absent$/, (ctx) => {
    killTracked();
    const root = mkSocketFixtureRoot('bl1108-ensure-');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
    fs.mkdirSync(path.join(root, '.worktrees', 'coder'), { recursive: true });

    fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${path.join(root, 'fake.sock')}\n`);
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'roles.tsv'),
      `coder\tcoder\t${path.join(root, '.worktrees', 'coder')}\tswarmforge-coder\tCoder\tcursor\ttask\n`
    );

    // Shell-only pane: a real sleep whose argv is NOT cursor-agent.
    // setsid so nothing later waits on this process group.
    const shell = spawnSync(
      'bash',
      ['-c', "setsid sleep 300 </dev/null >/dev/null 2>&1 & echo $!"],
      { encoding: 'utf8' }
    );
    const panePid = Number(shell.stdout.toString().trim());
    assert.ok(panePid > 0, `failed to spawn shell-only pane: ${shell.stderr}`);
    trackedPids.add(panePid);
    fs.writeFileSync(path.join(root, 'pane.pid'), `${panePid}\n`);

    const launchLog = path.join(root, 'launch.log');
    fs.writeFileSync(launchLog, '');
    const launchScript = path.join(root, '.swarmforge', 'launch', 'coder.sh');
    // Heal path: replace the pane pid with a process whose argv contains
    // cursor-agent so the post-repair seat-healthy? re-probe answers true.
    writeExec(
      launchScript,
      '#!/usr/bin/env bash\n' +
        `echo launched >> ${JSON.stringify(launchLog)}\n` +
        `old=$(cat ${JSON.stringify(path.join(root, 'pane.pid'))} 2>/dev/null || true)\n` +
        'if [[ -n "$old" ]]; then kill "$old" 2>/dev/null || true; fi\n' +
        // Detach: babashka process/sh waits on the tmux child's process group;
        // a backgrounded sleep without setsid hangs the ensure repair forever.
        "setsid bash -c 'exec -a cursor-agent sleep 300' </dev/null >/dev/null 2>&1 &\n" +
        `echo $! > ${JSON.stringify(path.join(root, 'pane.pid'))}\n`
    );

    writeExec(
      path.join(bin, 'tmux'),
      '#!/usr/bin/env bash\n' +
        `ROOT=${JSON.stringify(root)}\n` +
        'if [[ "$3" == "has-session" ]]; then exit 0; fi\n' +
        'if [[ "$3" == "list-sessions" ]]; then echo swarmforge-coder; exit 0; fi\n' +
        'if [[ "$3" == "list-panes" ]]; then\n' +
        '  if [[ "$*" == *pane_dead* ]]; then echo 0; exit 0; fi\n' +
        '  if [[ "$*" == *pane_pid* ]]; then cat "$ROOT/pane.pid"; exit 0; fi\n' +
        '  echo 0; exit 0\n' +
        'fi\n' +
        // single_role_repair_lib passes launch-command as one arg: `zsh '…/coder.sh'`
        'if [[ "$3" == "respawn-pane" || "$3" == "new-session" ]]; then\n' +
        '  last="${@: -1}"\n' +
        '  eval "$last"\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 0\n'
    );

    writeExec(path.join(bin, 'fake_ext.sh'), '#!/usr/bin/env bash\nexit 0\n');
    writeExec(
      path.join(bin, 'fake_daemon_start.sh'),
      '#!/usr/bin/env bash\n' +
        `echo ${process.pid} > ${JSON.stringify(path.join(root, '.swarmforge', 'daemon', 'handoffd.pid'))}\n`
    );

    fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'handoffd.pid'), `${process.pid}\n`);
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.pid'),
      `${process.pid}\n`
    );

    ctx.ensureRoot = root;
    ctx.ensureBin = bin;
    ctx.launchLog = launchLog;
    ctx.panePidFile = path.join(root, 'pane.pid');
  });

  define(/^swarm ensure checks that role$/, (ctx) => {
    const env = {
      ...process.env,
      PATH: `${ctx.ensureBin}:${process.env.PATH}`,
      SWARM_ENSURE_EXTENSION_CHECK_CMD: path.join(ctx.ensureBin, 'fake_ext.sh'),
      SWARM_ENSURE_EXTENSION_BOUNCE_CMD: path.join(ctx.ensureBin, 'fake_ext.sh'),
      SWARM_ENSURE_SUPERVISOR_CMD: path.join(ctx.ensureBin, 'fake_daemon_start.sh'),
      SWARMFORGE_SKIP_OPERATOR: '1',
      SWARMFORGE_SKIP_FRONT_DESK: '1',
      SWARMFORGE_SKIP_BABYSITTERD: '1',
      SWARMFORGE_SKIP_CURSOR_BRIDGE: '1',
    };
    const r = spawnSync('bb', [SWARM_ENSURE, ctx.ensureRoot], {
      encoding: 'utf8',
      env,
      timeout: 60000,
    });
    ctx.ensureOut = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    ctx.ensureStatus = r.status;
    // Track any cursor-agent stand-in the launch script left behind.
    try {
      const healed = Number(fs.readFileSync(ctx.panePidFile, 'utf8').trim());
      if (healed > 0) trackedPids.add(healed);
    } catch {
      /* ignore */
    }
  });

  define(/^it runs the role's persisted launch script$/, (ctx) => {
    const log = fs.readFileSync(ctx.launchLog, 'utf8');
    assert.match(log, /launched/, `launch script was not run:\n${ctx.ensureOut}`);
  });

  define(/^it reports the agent repair instead of a healthy seat$/, (ctx) => {
    try {
      assert.match(
        ctx.ensureOut,
        /^agent:coder: FIXED/m,
        `expected agent:coder FIXED (repair), got:\n${ctx.ensureOut}`
      );
      assert.doesNotMatch(
        ctx.ensureOut,
        /^agent:coder: HEALTHY/m,
        `half-launch Cursor seat must not report HEALTHY:\n${ctx.ensureOut}`
      );
      // Non-Claude seats: Claude /rc is OFF, not HEALTHY.
      assert.match(
        ctx.ensureOut,
        /^rc:coder: OFF/m,
        `Cursor seat must report rc: OFF, got:\n${ctx.ensureOut}`
      );
    } finally {
      killTracked();
      if (ctx.ensureRoot) {
        try {
          fs.rmSync(ctx.ensureRoot, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        releaseSocketFixtureRoot(ctx.ensureRoot);
        ctx.ensureRoot = undefined;
      }
    }
  });

  // ── cursor-seat-readiness-hotfix-03 ───────────────────────────────────
  define(/^a Cursor role with a composed prompt bundle$/, (ctx) => {
    // Short /tmp root via shared helper (socketFixtureShortRootGuard): this
    // file also builds control-socket fixtures in scenario-02, so an
    // os.tmpdir() mkdtemp here fails the whole-tree scan. Exit-hook reap is
    // built into mkSocketFixtureRoot (BL-921 sibling).
    const root = mkSocketFixtureRoot('bl1108-launch-');
    fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
    for (const role of ['specifier', 'coder', 'documenter']) {
      fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
    }
    // Distinctive bundle body — must NOT appear inlined into argv.
    const bundleMarker = `BL1108-BUNDLE-MARKER-${Date.now()}-UNIQUE`;
    fs.writeFileSync(
      path.join(root, 'swarmforge', 'swarmforge.conf'),
      'config active_backlog_max_depth -1\nwindow coder cursor coder\n'
    );
    ctx.launchRoot = root;
    ctx.bundleMarker = bundleMarker;
    ctx.role = 'coder';
  });

  define(/^the launcher builds its command$/, (ctx) => {
    const r = zsh(
      `source '${SWARMFORGE_SH}' '${ctx.launchRoot}'\n` +
        `parse_config\n${INDEX_OF_ROLE}\n` +
        `i="$(index_of_role ${ctx.role})"\n` +
        `write_agent_instruction_file "${ctx.role}" "$PROMPTS_DIR/${ctx.role}.md" ` +
        `"\${AGENTS[$i]}" "" "\${STAGES[$i]}"\n` +
        // Overwrite the composed bundle with our distinctive marker AFTER
        // compose so the Then can prove argv does not embed bundle text.
        `printf '%s\\n' '${ctx.bundleMarker}' > "$PROMPTS_DIR/${ctx.role}.md"\n` +
        `write_role_launch_script "$i"`
    );
    assert.equal(r.status, 0, `building the launch command failed:\n${r.stdout}${r.stderr}`);
    ctx.launchText = fs.readFileSync(
      path.join(ctx.launchRoot, '.swarmforge', 'launch', `${ctx.role}.sh`),
      'utf8'
    );
    ctx.promptFile = path.join(ctx.launchRoot, '.swarmforge', 'prompts', `${ctx.role}.md`);
  });

  define(/^the command tells Cursor to read the prompt file$/, (ctx) => {
    assert.match(ctx.launchText, /\bcursor-agent\b/, ctx.launchText);
    assert.match(
      ctx.launchText,
      /Read and obey every instruction in/,
      `Cursor launch must name the prompt-file wake, got:\n${ctx.launchText}`
    );
    assert.match(
      ctx.launchText,
      new RegExp(`prompts/${ctx.role}\\.md`),
      `launch body must cite the prompt file path:\n${ctx.launchText}`
    );
    assert.ok(fs.existsSync(ctx.promptFile), `prompt file missing: ${ctx.promptFile}`);
  });

  define(/^the command does not embed the prompt bundle in its arguments$/, (ctx) => {
    try {
      assert.ok(
        !ctx.launchText.includes(ctx.bundleMarker),
        `launch argv embeds the prompt bundle marker:\n${ctx.launchText}`
      );
      assert.doesNotMatch(
        ctx.launchText,
        /\$\(cat ['"]?\$prompt_file/,
        `launch body still cat-slurps the prompt into argv:\n${ctx.launchText}`
      );
    } finally {
      if (ctx.launchRoot) {
        try {
          fs.rmSync(ctx.launchRoot, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        releaseSocketFixtureRoot(ctx.launchRoot);
        ctx.launchRoot = undefined;
      }
    }
  });
}

module.exports = { registerSteps };
