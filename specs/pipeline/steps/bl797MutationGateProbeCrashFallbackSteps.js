'use strict';

// BL-797: step handlers for "the mutation cooldown gate survives missing
// host probes". Drives the REAL mutation_cooldown_gate.bb CLI under a PATH
// restricted to a throwaway fixture bin dir - never the real host's PATH -
// so presence/absence of nproc/sysctl/uptime is fully controlled and the
// scenarios are deterministic regardless of what this test machine actually
// has installed (same fixture convention bl463MutationCooldownIgnoresOwnParcelSteps.js
// established for shelling the real gate against a real git fixture). Stub
// probe scripts use an absolute `#!/bin/bash` shebang - never
// `#!/usr/bin/env bash` - because under a PATH this narrow, `env` itself
// cannot resolve `bash` by searching a PATH that doesn't contain it.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mutation_cooldown_gate.bb');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-gate-probe-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 5\nconfig mutation_cooldown_days 3\n');
  const file = path.join(root, 'src', 'thing.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'export const thing = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed commit']);
  return { root, file };
}

function writeStubBinary(binDir, name, script) {
  const target = path.join(binDir, name);
  fs.writeFileSync(target, `#!/bin/bash\n${script}\n`);
  fs.chmodSync(target, 0o755);
}

function registerSteps(registry) {
  registry.define(/^a project root with a mutation cooldown conf$/, (ctx) => {
    const { root, file } = makeRepo();
    ctx.root = root;
    ctx.file = file;
  });

  registry.define(/^a controlled PATH of stub host probes$/, (ctx) => {
    ctx.binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-gate-probe-bin-'));
    // `git` (the gate's own `last-committed-ms` shells to it) is always
    // present in the fixture PATH - the point of this scenario set is the
    // nproc/sysctl/uptime probes, not git resolution.
    fs.symlinkSync(execFileSync('bash', ['-lc', 'command -v git'], { encoding: 'utf8' }).trim(), path.join(ctx.binDir, 'git'));
    ctx.gateEnv = {};
  });

  registry.define(/^"([^"]+)" is absent from the PATH$/, () => {
    // No-op: the controlled PATH background step already starts from a bin
    // dir containing only git - a probe is "absent" unless a later step
    // explicitly stubs it in.
  });

  registry.define(/^"([^"]+)" and "([^"]+)" are both absent from the PATH$/, () => {
    // Same as above - both stay absent unless stubbed.
  });

  registry.define(/^a stub "([^"]+)" reporting (\d+) cores$/, (ctx, name, count) => {
    writeStubBinary(ctx.binDir, name, `echo ${count}`);
  });

  registry.define(/^the core probe is forced to (\d+) cores$/, (ctx, count) => {
    ctx.gateEnv.SWARMFORGE_MUTATION_GATE_FORCE_CORES = String(count);
  });

  registry.define(/^the mutation cooldown gate runs$/, (ctx) => {
    const bbBin = execFileSync('bash', ['-lc', 'command -v bb'], { encoding: 'utf8' }).trim();
    try {
      ctx.stdout = execFileSync(bbBin, [GATE, ctx.root, ctx.file], {
        encoding: 'utf8',
        env: { PATH: ctx.binDir, ...ctx.gateEnv },
      });
      ctx.exitCode = 0;
    } catch (err) {
      ctx.stdout = `${err.stdout || ''}${err.stderr || ''}`;
      ctx.exitCode = typeof err.status === 'number' ? err.status : 1;
    }
  });

  registry.define(/^it exits successfully with a gate decision$/, (ctx) => {
    if (ctx.exitCode !== 0) {
      throw new Error(`expected the gate to exit 0 (never crash on a missing probe), got ${ctx.exitCode}:\n${ctx.stdout}`);
    }
    if (!/^DECISION: /m.test(ctx.stdout)) {
      throw new Error(`expected a DECISION line, got:\n${ctx.stdout}`);
    }
  });

  registry.define(/^it reports (\d+) cores$/, (ctx, count) => {
    const re = new RegExp(`cores: ${count}\\b`);
    if (!re.test(ctx.stdout)) {
      throw new Error(`expected "cores: ${count}", got:\n${ctx.stdout}`);
    }
  });

  registry.define(/^it reports an idle load average$/, (ctx) => {
    if (!/load_avg: 0\.00\b/.test(ctx.stdout)) {
      throw new Error(`expected an idle (0.00) load average, got:\n${ctx.stdout}`);
    }
  });
}

module.exports = { registerSteps };
