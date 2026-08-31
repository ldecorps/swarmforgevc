'use strict';

// BL-1305: step handlers for "An acceptance fixture never launches a real
// agent binary".
//
// The defect: roleLifecycleParkUnneededSteps.js stubs the agent by writing an
// `exit 0` script named `claude` into a temp dir and prepending that dir to
// PATH. The stub was never reached. tmux starts each fixture pane with the
// user shell; that shell sources its own startup file; the startup file
// prepends the directory holding the REAL agent binary ahead of the fixture
// directory. The bare name therefore resolved to the real binary and a real,
// billable agent booted against a throwaway fixture root - 21 of them
// measured alive on 2026-08-30, ~2.6 GB resident.
//
// These scenarios assert the OUTCOME the feature requires - the stub is
// unconditionally what runs - and deliberately name no mechanism (the
// specifier retired the earlier absolute-path mandate on 2026-08-31, see
// backlog/evidence/BL-1305-bounce-20260831.md). They drive the REAL fixture
// helpers from roleLifecycleParkUnneededSteps.js and a REAL tmux pane on an
// isolated per-fixture socket, because a pane shell is the only place the
// defect manifests: a direct spawnSync sources no startup file and the shim
// holds there even when it is broken.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const fixtureReaper = require('./lib/fixtureReaper');
const {
  mkFakeBin,
  fakeEnv,
  stubRanCount,
  AGENT_NAME,
} = require('./roleLifecycleParkUnneededSteps');

// BL-1305 tmux-reaper adoption: every scenario opens a real tmux server on
// an isolated socket (runInPane), and only scenario 03 tears it down inline
// (it must, to make its own assertion meaningful). Scenarios 01 and 02
// leave theirs running with no inline teardown at all, so this afterEach is
// not a backstop for the throw path here - it is the ONLY teardown those
// two scenarios get.
let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    fixtureReaper.reap(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// How long to let a pane command settle before reading what it wrote. The
// pane writes a file and exits; this is a bounded wait, never a bare sleep
// that assumes completion.
const PANE_SETTLE_MS = 5000;
const PANE_POLL_MS = 50;

function realAgentPath() {
  // The host's own agent binary, resolved the way a startup file would leave
  // it - deliberately NOT through the fixture env.
  const found = spawnSync('bash', ['-lc', `command -v ${AGENT_NAME}`], { encoding: 'utf8' });
  return found.stdout.trim();
}

// Runs one command inside a REAL tmux pane on an isolated socket and returns
// what the pane wrote. The pane shell is what re-orders PATH, so a scenario
// that ran the command directly would not exercise the defect at all.
function runInPane(ctx, command) {
  const outFile = path.join(ctx.root, `pane-out-${ctx.paneSeq++}.txt`);
  const sock = path.join(ctx.root, 'p.sock');
  const script = path.join(ctx.root, `pane-cmd-${ctx.paneSeq}.sh`);
  fs.writeFileSync(script, `#!/usr/bin/env zsh\n{ ${command} ; } > '${outFile}' 2>&1\n`);
  fs.chmodSync(script, 0o755);

  spawnSync('tmux', ['-S', sock, 'new-session', '-d', '-s', `bl1305-${ctx.paneSeq}`, script], {
    env: ctx.env,
  });
  ctx.sockets.add(sock);

  const deadline = Date.now() + PANE_SETTLE_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(outFile) && fs.readFileSync(outFile, 'utf8').trim() !== '') break;
    spawnSync('sleep', [String(PANE_POLL_MS / 1000)]);
  }
  return fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim() : '';
}

function killPaneServers(ctx) {
  for (const sock of ctx.sockets) {
    spawnSync('tmux', ['-S', sock, 'kill-server']);
  }
  ctx.sockets.clear();
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a role-lifecycle fixture root with an agent stub written into it$/, (ctx) => {
    ctx.fakeBin = mkFakeBin();
    ctx.root = mkSocketFixtureRoot('aps-bl1305-');
    ctx.env = fakeEnv(ctx.fakeBin);
    ctx.paneSeq = 0;
    ctx.sockets = new Set();
    ctx.realAgent = realAgentPath();

    // fixtureReaper.reap() finds a fixture's tmux server ONLY via this
    // pointer file (role_lifecycle.sh's own shape) - track() alone does not
    // teach it this fixture's socket (accepted rule_proposal 2026-08-22,
    // BL-1049). Written before track() and before any tmux new-session
    // call, so reap() finds it even if the process dies between here and
    // the first pane. runInPane always resolves the same socket path for a
    // given ctx.root, so one pointer file covers every pane this scenario
    // opens.
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'tmux-socket'), path.join(ctx.root, 'p.sock'));
    fixtureReaper.track(ctx.root);
    trackedRoots.push(ctx.root);
  });

  // ── 01 ───────────────────────────────────────────────────────────────
  registry.define(/^the fixture resolves the agent command in a pane shell$/, (ctx) => {
    ctx.resolved = runInPane(ctx, `command -v ${AGENT_NAME}`);
  });

  registry.define(/^the command resolves to the stub inside the fixture root$/, (ctx) => {
    const expected = path.join(ctx.fakeBin, AGENT_NAME);
    if (ctx.resolved !== expected) {
      throw new Error(`expected the pane to resolve ${AGENT_NAME} to the fixture stub ${expected}, got ${ctx.resolved || '(nothing)'}`);
    }
  });

  registry.define(/^the command does not resolve to the real agent binary$/, (ctx) => {
    // Non-vacuous only if the host actually HAS a real agent binary to lose
    // to; when it does not, there is nothing for this step to distinguish.
    if (ctx.realAgent && ctx.resolved === ctx.realAgent) {
      throw new Error(`the pane resolved ${AGENT_NAME} to the REAL binary at ${ctx.realAgent}`);
    }
  });

  // ── 02 ───────────────────────────────────────────────────────────────
  registry.define(/^the pane shell's startup file prepends a directory holding a different binary of the same agent name$/, (ctx) => {
    // The exact production shape: a startup file that prepends some OTHER
    // directory holding a same-named binary, re-applied on EVERY zsh.
    ctx.rivalBin = mkSocketFixtureRoot('aps-bl1305-rival-');
    const rival = path.join(ctx.rivalBin, AGENT_NAME);
    fs.writeFileSync(rival, `#!/usr/bin/env bash\nprintf 'RIVAL\\n' >> '${path.join(ctx.rivalBin, 'rival-ran.log')}'\nexit 0\n`);
    fs.chmodSync(rival, 0o755);

    // The adversary startup file here is the HOST'S OWN, not a planted one.
    // That is deliberate, and it is the only faithful shape: the fixture's
    // protection works by OWNING $ZDOTDIR, so a planted startup file could
    // only be made to run by handing the adversary ZDOTDIR, which inverts the
    // very mechanism under test and would prove nothing.
    //
    // On this host ~/.zshenv genuinely prepends the directory holding the real
    // agent binary, so it IS the adversary, live, on every zsh the pane
    // starts. That it is genuinely defeated is established by running this
    // feature against a deliberately broken implementation: with the
    // fixture's isolation removed all three scenarios fail. The planted rival
    // below adds a second same-named binary reachable through the inherited
    // PATH, so the Then can name a binary that must not have run WITHOUT
    // risking a real agent launch to prove it.
    ctx.env.PATH = `${ctx.rivalBin}${path.delimiter}${ctx.env.PATH}`;
  });

  registry.define(/^the fixture launches a role agent$/, (ctx) => {
    // The fixture's OWN startup-file isolation must survive a startup file
    // that re-orders PATH against it, so re-assert the fixture env exactly as
    // the fixture builds it, then launch through a pane.
    ctx.env = fakeEnv(ctx.fakeBin);
    if (ctx.rivalBin) ctx.env.PATH = `${ctx.rivalBin}${path.delimiter}${ctx.env.PATH}`;
    runInPane(ctx, `${AGENT_NAME} --model x & sleep 0.5; echo launched`);
  });

  registry.define(/^the fixture stub is what ran$/, (ctx) => {
    const ran = stubRanCount(ctx.fakeBin);
    if (ran < 1) {
      throw new Error('the fixture stub never ran - the scenario would be passing merely because nothing launched');
    }
  });

  registry.define(/^the binary the prepended directory holds did not run$/, (ctx) => {
    const log = path.join(ctx.rivalBin, 'rival-ran.log');
    if (fs.existsSync(log) && fs.readFileSync(log, 'utf8').trim() !== '') {
      throw new Error(`the prepended same-named binary at ${ctx.rivalBin} ran`);
    }
  });

  // ── 03 ───────────────────────────────────────────────────────────────
  registry.define(/^the fixture scenarios have finished$/, (ctx) => {
    // A fixture that launched NOTHING would satisfy the Then below trivially,
    // so this step must actually put the fixture through a launch before
    // finishing. Verified: with the fixture's startup-file isolation removed,
    // this scenario fails - without the launch here it passed either way.
    ctx.env = fakeEnv(ctx.fakeBin);
    runInPane(ctx, `${AGENT_NAME} --model x & sleep 0.5; echo launched`);
    killPaneServers(ctx);
    ctx.finished = true;
  });

  registry.define(/^no process launched from the fixture root is the real agent binary$/, (ctx) => {
    if (!ctx.finished) throw new Error('the fixture was never finished');
    // What the fixture launched must have BEEN the stub. The stub records
    // every invocation, so an empty log after a launch means the thing that
    // ran was something else - which, for a bare agent name resolved in a
    // pane shell, is the real binary. Checking only for SURVIVING processes
    // is not enough: a real agent that launches and exits quickly leaves
    // nothing to find, and the scenario would pass over an empty set (it did,
    // until this check was added - verified against a broken implementation).
    // pgrep over the FULL command line: a real agent launched against a
    // fixture root carries that root in its --settings/--append-system-prompt-
    // file arguments, which is exactly how the 21 orphans were found.
    if (stubRanCount(ctx.fakeBin) < 1) {
      throw new Error(
        `the fixture launched an agent but its stub never ran - what launched from ${ctx.root} was the real agent binary, not the fixture stub`
      );
    }

    const found = spawnSync('pgrep', ['-af', AGENT_NAME], { encoding: 'utf8' });
    const offenders = (found.stdout || '')
      .split('\n')
      .filter((line) => line.includes(ctx.root) || line.includes(ctx.fakeBin));
    if (offenders.length > 0) {
      // Reap before reporting: a failing run must not LEAVE a real, billable
      // agent behind on top of failing - that is the very harm this feature
      // exists to prevent.
      for (const line of offenders) {
        const pid = line.trim().split(/\s+/)[0];
        if (/^\d+$/.test(pid)) spawnSync('kill', ['-9', pid]);
      }
      throw new Error(`real agent processes survived the fixture (reaped):\n${offenders.join('\n')}`);
    }
  });
}

module.exports = { registerSteps };
