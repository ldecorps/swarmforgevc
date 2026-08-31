'use strict';

// BL-1305: an acceptance fixture must never execute a real agent binary.
//
// The role-lifecycle fixture stubs the agent by writing an `exit 0` script
// named `claude` into a temp dir and prepending that dir to PATH. That alone
// is not enough: zsh sources $ZDOTDIR/.zshenv on EVERY invocation - including
// the non-interactive `zsh -c` inside role_lifecycle.sh and the generated
// `#!/usr/bin/env zsh` launch script - and the host's own ~/.zshenv prepends
// the directory holding the REAL binary AHEAD of whatever the fixture set.
// The bare name then resolved to the real binary and a real, billable agent
// booted against a throwaway fixture root (21 of them, measured 2026-08-30).
// These tests pin the fixture's environment so the stub is what runs.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  mkFakeBin,
  fakeEnv,
  stubRanCount,
} = require('../../specs/pipeline/steps/roleLifecycleParkUnneededSteps');
const { mkTmpDir } = require('./helpers/tmpDir');

const HAS_ZSH = spawnSync('zsh', ['-c', 'exit 0']).status === 0;

// A stand-in for the host's ~/.zshenv: a startup file prepending some OTHER
// directory that holds a same-named binary. This is the exact shape that
// defeated the shim in production, reproduced without touching the real host
// startup file or the real binary.
function mkRivalBinDir() {
  const dir = mkTmpDir('bl1305-rivalbin-');
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, '#!/usr/bin/env bash\necho RIVAL_BINARY_RAN\nexit 0\n');
  fs.chmodSync(bin, 0o755);
  return dir;
}

// The fixture's env, then PATH re-ordered so the rival wins on precedence -
// what the host startup file does behind the fixture's back.
function envWithRivalAhead(fakeBin, rivalBin) {
  const env = fakeEnv(fakeBin);
  env.PATH = `${rivalBin}${path.delimiter}${env.PATH}`;
  return env;
}

function withFixture(run) {
  const fakeBin = mkFakeBin();
  const rivalBin = mkRivalBinDir();
  try {
    run(fakeBin, rivalBin);
  } finally {
    fs.rmSync(fakeBin, { recursive: true, force: true });
    fs.rmSync(rivalBin, { recursive: true, force: true });
  }
}

test('the bare agent name resolves to the fixture stub, not a same-named binary prepended ahead of it', { skip: !HAS_ZSH }, () => {
  withFixture((fakeBin, rivalBin) => {
    const resolved = spawnSync('zsh', ['-c', 'command -v claude'], {
      encoding: 'utf8',
      env: envWithRivalAhead(fakeBin, rivalBin),
    });

    assert.equal(resolved.stdout.trim(), path.join(fakeBin, 'claude'));
  });
});

test('the fixture stub runs and the rival binary does not', { skip: !HAS_ZSH }, () => {
  withFixture((fakeBin, rivalBin) => {
    // The stub stays resident (a real agent would), so bound the call rather
    // than waiting it out - we only need to know WHICH binary started.
    const ran = spawnSync('zsh', ['-c', 'claude --model x'], {
      encoding: 'utf8',
      env: envWithRivalAhead(fakeBin, rivalBin),
      timeout: 3000,
    });

    assert.ok(!ran.stdout.includes('RIVAL_BINARY_RAN'), 'the rival binary must not run');
    // Non-vacuous: the stub actually executed, so this is not passing merely
    // because nothing launched - the ticket's qa_e2e explicitly forbids that.
    assert.equal(stubRanCount(fakeBin), 1);
  });
});

test('the stub still wins in a nested zsh, where the startup file is re-sourced', { skip: !HAS_ZSH }, () => {
  withFixture((fakeBin, rivalBin) => {
    // role_lifecycle.sh -> tmux pane -> generated launch script is a chain of
    // zsh invocations; each one re-sources the startup file.
    const nested = spawnSync('zsh', ['-c', 'zsh -c "command -v claude"'], {
      encoding: 'utf8',
      env: envWithRivalAhead(fakeBin, rivalBin),
    });

    assert.equal(nested.stdout.trim(), path.join(fakeBin, 'claude'));
  });
});
