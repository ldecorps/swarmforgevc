'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./tmpDir');

// BL-847: the sampler now resolves the AGENT process - a descendant of the
// pane's root shell whose OS command name matches DEFAULT_AGENT_COMMAND_NAME
// ('claude') - never the shell pid itself (extension/src/swarm/
// resourceSamplerActivation.ts). Tests that exercise the real OS process
// table (per engineering.prompt's "never target the test's own pid" rule)
// therefore need a real, disposable TWO-level process tree: a shell whose
// genuine child is named "claude" in `ps`, not a single bare process
// standing in directly for the agent the way pre-BL-847 fixtures did.
//
// comm-name portability: on Darwin, `ps -o comm=` reflects argv[0]; Linux's
// /proc/[pid]/comm instead reflects the executed file's own basename,
// ignoring argv[0]. Spawning the child via the bare, PATH-resolved name
// "claude" (never an absolute path) keeps argv[0] short on Darwin AND makes
// the resolved executable file itself named "claude" for Linux - satisfying
// both without a platform branch.

function shellScriptSource(binDir) {
  return [
    "const { spawn } = require('child_process');",
    `spawn('claude', ['-e', 'setTimeout(() => {}, 30000)'], { env: { ...process.env, PATH: ${JSON.stringify(binDir)} + ':' + process.env.PATH } });`,
    'setInterval(() => {}, 60000);',
  ].join('\n');
}

// Polls the real process table (never the test's own pid) until a child of
// shellPid appears, so callers never race the shell's own async spawn of
// its claude standin. Throws on timeout rather than proceeding against a
// tree that never grew the expected child.
function waitForChildPid(shellPid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const table = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
    const hasChild = table
      .split('\n')
      .some((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        return match && Number(match[2]) === shellPid;
      });
    if (hasChild) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for a child of pid ${shellPid} to appear in the process table`);
    }
    execFileSync('sleep', ['0.02']);
  }
}

// Spawns the real two-process tree and blocks (synchronously) until the
// claude standin is actually visible under the shell in `ps`, so callers
// can fake tmux's pane-pid lookup to shellPid immediately afterward with no
// separate wait step of their own.
function spawnFakeAgentTree() {
  const binDir = mkTmpDir('sfvc-fake-agent-bin-');
  const claudeBin = path.join(binDir, 'claude');
  // A symlink to the real node binary - cheap (no multi-MB copy/hash) and,
  // since the child is invoked via the bare PATH-resolved name below rather
  // than this path directly, it is the invoked NAME that determines comm on
  // both platforms, not whether the target file is a symlink.
  fs.symlinkSync(process.execPath, claudeBin);

  const shellScriptPath = path.join(binDir, 'shell.js');
  fs.writeFileSync(shellScriptPath, shellScriptSource(binDir));

  // detached:true makes the shell its own process group leader; the claude
  // child it spawns inherits that same pgid, so tearing down the whole
  // group with one negative-pid signal reaps both (see kill() below).
  const shell = spawn(process.execPath, [shellScriptPath], { detached: true });
  waitForChildPid(shell.pid);

  return {
    shellPid: shell.pid,
    kill() {
      try {
        process.kill(-shell.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    },
  };
}

module.exports = { spawnFakeAgentTree };
