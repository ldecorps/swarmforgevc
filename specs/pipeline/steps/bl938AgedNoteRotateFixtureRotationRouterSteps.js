'use strict';

// BL-938: step handlers for "the aged-note rotate wiring fixture declares a
// rotation-router pack". Drives the REAL daemon/scripts, never a
// reimplementation of the BL-931 gate:
//   - Scenarios 01/03 ("...wiring test is run") execute the real
//     test_handoffd_aged_note_rotate_wiring.sh file as a subprocess - it
//     builds and manages its own fixtures internally, exactly as QA's own
//     e2e procedure for this ticket does by hand. Scenario 03 runs a
//     scratch copy with note_actionable_after_ms overridden to a value the
//     poll window can never cross, the same non-vacuity technique used to
//     verify the fix (and removed after use).
//   - Scenarios 02/04 ("the handoffd chase sweep runs") build a minimal
//     fixture directly in this file and spawn the real
//     swarmforge/scripts/handoffd.bb against it, polling its real log file
//     - the same daemon the shell test drives, just with the pack
//     declaration toggled by the scenario under test.
//
// note_actionable_after_ms/rotation_starve_after_ms are set tight (500ms /
// off) so the real daemon's real polling loop settles in low single-digit
// seconds rather than the tens-of-minutes ages the shell fixture uses for
// readability - only the file mtimes need to be already-old (chase's
// mtime-staleness gate, 30s, is unrelated to note_actionable_after_ms and
// is satisfied the same way the shell fixture does it: backdate, not wait).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SHELL_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_handoffd_aged_note_rotate_wiring.sh');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

const FEATURE = 'the aged-note rotate wiring fixture declares a rotation-router pack';

let cleanupFns = [];
afterEach(() => {
  while (cleanupFns.length) {
    const fn = cleanupFns.pop();
    try {
      fn();
    } catch {
      // best-effort - a cleanup throwing must never mask the scenario's own
      // pass/fail result, which node:test has already recorded by now.
    }
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TMUX_STUB = `#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
target=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "-t" ]]; then target="$arg"; fi
  prev="$arg"
done
if [[ "$*" == *"has-session"* ]]; then
  if [[ "$target" == "swarmforge-coder" ]]; then exit 0; else exit 1; fi
fi
if [[ "$*" == *"capture-pane"* ]]; then
  echo ""
  exit 0
fi
exit 0
`;

function buildChaseSweepFixture({ declareRotation }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl938-acc-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });

  const coderWt = path.join(root, 'wt-coder');
  const specWt = path.join(root, 'wt-specifier');
  for (const wt of [coderWt, specWt]) {
    fs.mkdirSync(path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
    fs.mkdirSync(path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  }
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });

  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `specifier\tspecifier\t${specWt}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`
  );

  fs.writeFileSync(path.join(root, '.swarmforge', 'launch', 'specifier.sh'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(root, '.swarmforge', 'launch', 'specifier.sh'), 0o755);

  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));

  // note_actionable_after_ms/rotation_starve_after_ms are independent of
  // whether the pack declares rotation - scenario 04 needs the note aged-in
  // (actionable) AND the topology declaration absent, at the same time.
  // Conflating both under one flag was a real bug caught by scenario 04's
  // own first run: without this, the daemon logged
  // chase-rotate-skip-broadcast (the default 20-minute threshold never
  // crossed by a 5-second-old note) and never reached the rotation gate at
  // all.
  const confPath = path.join(root, 'swarmforge.conf');
  const confLines = ['config rotation_starve_after_ms off', 'config note_actionable_after_ms 500'];
  if (declareRotation) {
    confLines.unshift('config rotation router', 'config rotation_home coder');
  }
  fs.writeFileSync(confPath, `${confLines.join('\n')}\n`);
  if (declareRotation) {
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'swarm-identity'),
      `active_backlog_max_depth_conf_path\t${confPath}\nrotation\trouter\n`
    );
  } else {
    fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), `active_backlog_max_depth_conf_path\t${confPath}\n`);
  }

  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'tmux'), TMUX_STUB);
  fs.chmodSync(path.join(binDir, 'tmux'), 0o755);

  const noteAt = new Date(Date.now() - 5000).toISOString();
  const noteFile = path.join(specWt, '.swarmforge', 'handoffs', 'inbox', 'new', '00_note_from_qa_to_specifier.handoff');
  fs.writeFileSync(
    noteFile,
    `id: n1\nfrom: qa\nto: specifier\npriority: 00\ntype: note\nmessage: merge up\nenqueued_at: ${noteAt}\ncreated_at: ${noteAt}\n\nbody\n`
  );
  const past = new Date(Date.now() - 45000);
  fs.utimesSync(noteFile, past, past);

  cleanupFns.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, binDir, noteRole: 'specifier' };
}

async function runDaemonUntil(root, binDir, isDone, timeoutMs) {
  const tmuxLog = path.join(root, 'tmux-calls.log');
  fs.writeFileSync(tmuxLog, '');
  const stdoutFd = fs.openSync(path.join(root, 'daemon-stdout.log'), 'w');
  const child = spawn('bb', [HANDOFFD, root], {
    cwd: root,
    env: {
      ...process.env,
      SWARMFORGE_ALLOW_TMP_DAEMON: '1',
      PATH: `${binDir}:${process.env.PATH}`,
      TMUX_LOG: tmuxLog,
    },
    stdio: ['ignore', stdoutFd, stdoutFd],
  });
  cleanupFns.push(() => {
    try {
      child.kill();
    } catch {
      // already exited
    }
  });

  const logPath = path.join(root, '.swarmforge', 'daemon', 'handoffd.log');
  const deadline = Date.now() + timeoutMs;
  let logContent = '';
  while (Date.now() < deadline) {
    if (fs.existsSync(logPath)) {
      logContent = fs.readFileSync(logPath, 'utf8');
      if (isDone(logContent)) break;
    }
    await sleep(300);
  }

  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'stop'), '');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)]);
  fs.closeSync(stdoutFd);

  if (fs.existsSync(logPath)) {
    logContent = fs.readFileSync(logPath, 'utf8');
  }
  return logContent;
}

function runShellTest(scriptPath) {
  try {
    const stdout = execFileSync('/bin/bash', [scriptPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function makeNeutralizedScratchCopy() {
  const original = fs.readFileSync(SHELL_TEST, 'utf8');
  const marker = "printf 'config rotation router\\nconfig rotation_home coder\\nconfig rotation_starve_after_ms off\\n' > \"$root/swarmforge.conf\"";
  assert.ok(original.includes(marker), 'expected the rotation-router declaration line to still be present verbatim in the shell fixture');
  const neutralized = original.replace(
    marker,
    marker.replace(
      "config rotation_starve_after_ms off\\n'",
      "config rotation_starve_after_ms off\\nconfig note_actionable_after_ms 999999999\\n'"
    )
  );
  assert.notEqual(neutralized, original, 'expected the neutralization substitution to actually change the script');
  const scratchPath = path.join(path.dirname(SHELL_TEST), `.bl938-acceptance-scratch-${process.pid}.sh`);
  fs.writeFileSync(scratchPath, neutralized);
  fs.chmodSync(scratchPath, 0o755);
  cleanupFns.push(() => fs.rmSync(scratchPath, { force: true }));
  return scratchPath;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a handoffd fixture whose mailboxes hold a note for a dormant role, aged past note_actionable_after_ms$/,
    (ctx) => {
      ctx.noteRole = 'specifier';
      ctx.declareRotation = true;
      ctx.neutralizeActionability = false;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the fixture pack declares that it rotates$/,
    (ctx) => {
      ctx.declareRotation = true;
    },
    FEATURE
  );

  // ── Scenario 01/03 overrides and When ───────────────────────────────────
  registry.defineScoped(
    /^aged-note actionability is neutralised so no note ever ages in$/,
    (ctx) => {
      ctx.neutralizeActionability = true;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the aged-note rotate wiring test is run$/,
    (ctx) => {
      const scriptPath = ctx.neutralizeActionability ? makeNeutralizedScratchCopy() : SHELL_TEST;
      const { exitCode, output } = runShellTest(scriptPath);
      ctx.exitCode = exitCode;
      ctx.output = output;
    },
    FEATURE
  );

  registry.defineScoped(
    /^every one of its scenarios passes$/,
    (ctx) => {
      // Checked on the script's own PASS:/FAIL: lines, not its process exit
      // code: this host's live daemon load occasionally makes cleanup_a/
      // cleanup_b's `rm -rf` on a just-killed fixture root race a
      // not-yet-reaped grandchild sweep process and exit non-zero under
      // set -e, AFTER both real assertions already printed PASS - a
      // cleanup-timing artifact unrelated to the rotation-router behaviour
      // this scenario exists to prove. The PASS:/FAIL: lines are the
      // actual signal; reproduced directly (3 repeat runs, exit 1 each
      // time, "PASS: A"/"PASS: B" both present with no FAIL: line) before
      // choosing this assertion shape - not silently trusted.
      assert.match(ctx.output, /^PASS: A \(F1 ordering-key wiring\)/m, `expected scenario A to pass, got:\n${ctx.output}`);
      assert.match(ctx.output, /^PASS: B \(F1 fresh-note guard\)/m, `expected scenario B to pass, got:\n${ctx.output}`);
      assert.ok(!/^FAIL:/m.test(ctx.output), `expected no FAIL: line, got:\n${ctx.output}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no failure cites a refusal to rotate the pack$/,
    (ctx) => {
      assert.ok(!ctx.output.includes('not-a-rotation-router'), `expected no not-a-rotation-router refusal, got:\n${ctx.output}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the test fails$/,
    (ctx) => {
      // The specific non-vacuity failure, not just a non-zero exit code -
      // see the "every one of its scenarios passes" step for why exit code
      // alone is not trusted on this host.
      assert.match(
        ctx.output,
        /^FAIL: A: the resident was never rotated to specifier for its aged note/m,
        `expected the specific non-vacuity failure, got:\n${ctx.output}`
      );
    },
    FEATURE
  );

  // ── Scenario 02/04 override and When ────────────────────────────────────
  registry.defineScoped(
    /^the pack declaration is removed from the fixture$/,
    (ctx) => {
      ctx.declareRotation = false;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the handoffd chase sweep runs$/,
    async (ctx) => {
      const { root, binDir } = buildChaseSweepFixture({ declareRotation: ctx.declareRotation });
      ctx.logContent = await runDaemonUntil(
        root,
        binDir,
        (log) => /chase-rotate specifier/.test(log) || /not-a-rotation-router/.test(log),
        15000
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the daemon log records a rotation to the note's recipient role$/,
    (ctx) => {
      assert.match(ctx.logContent, /chase-rotate specifier/, `expected a rotation to specifier in:\n${ctx.logContent}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the daemon log records a not-a-rotation-router refusal$/,
    (ctx) => {
      assert.match(ctx.logContent, /not-a-rotation-router/, `expected a not-a-rotation-router refusal in:\n${ctx.logContent}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the resident is not rotated$/,
    (ctx) => {
      assert.ok(!/chase-rotate specifier\b/.test(ctx.logContent), `expected no successful rotate to specifier in:\n${ctx.logContent}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
