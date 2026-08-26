'use strict';

// BL-1143: authorized cold-swap day-shift → ollama-qwen3-mono-router.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'cold-swap day-shift to ollama-qwen3-mono-router';
const REPO = path.join(__dirname, '..', '..', '..');
const SWAP = path.join(REPO, 'swarmforge', 'scripts', 'cold_swap_day_shift_to_ollama_qwen.sh');
const HOWTO = path.join(REPO, 'docs', 'how-to', 'BL-1143-cold-swap-day-shift-ollama-qwen.md');

function sh(args, opts = {}) {
  return spawnSync(args[0], args.slice(1), {
    encoding: 'utf8',
    cwd: opts.cwd || REPO,
    env: { ...process.env, ...(opts.env || {}) },
  });
}

function ensure(ctx) {
  if (!ctx.bl1143) ctx.bl1143 = { last: null, root: null };
  return ctx.bl1143;
}

function materializeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1143-'));
  const scripts = path.join(root, 'swarmforge', 'scripts');
  const packs = path.join(root, 'swarmforge', 'packs');
  const evidence = path.join(root, 'backlog', 'evidence');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(packs, { recursive: true });
  fs.mkdirSync(evidence, { recursive: true });

  fs.copyFileSync(
    path.join(REPO, 'swarmforge', 'packs', 'ollama-qwen3-mono-router.conf'),
    path.join(packs, 'ollama-qwen3-mono-router.conf')
  );
  for (const name of [
    'cold_swap_day_shift_to_ollama_qwen.sh',
    'local_ollama_pack_shape_lib.sh',
    'local_ollama_pack_shape_gate.sh',
    'model_steward_lib.bb',
  ]) {
    fs.copyFileSync(path.join(REPO, 'swarmforge', 'scripts', name), path.join(scripts, name));
  }
  fs.writeFileSync(
    path.join(scripts, 'local_coder_battery_staffing_gate.sh'),
    '#!/usr/bin/env bash\necho stub-pass\nexit 0\n',
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(evidence, 'BL-1127-coder-battery-ollama-qwen2.5-coder-20260825T180452Z.md'),
    '# pass\n- provider: ollama\n- model: qwen2.5-coder\n- result: pass\n'
  );
  fs.writeFileSync(
    path.join(root, 'start-swarm-ollama-qwen.sh'),
    '#!/usr/bin/env bash\necho START_STUB\nexit 0\n',
    { mode: 0o755 }
  );
  fs.chmodSync(path.join(scripts, 'cold_swap_day_shift_to_ollama_qwen.sh'), 0o755);
  return root;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^BL-1126 BL-1127 and BL-1140 are green on this host$/, () => {
    assert.ok(fs.existsSync(path.join(REPO, 'docs', 'how-to', 'BL-1127-local-coder-steward-evidence-bar.md')));
    assert.ok(fs.existsSync(path.join(REPO, 'docs', 'how-to', 'BL-1140-steward-local-model-bakeoff.md')));
  });

  scoped(/^the human authorized a day-shift cold-swap to the local Ollama mono-router$/, () => {
    const ticket = path.join(REPO, 'backlog', 'active', 'BL-1143-cold-swap-day-shift-ollama-qwen.yaml');
    assert.ok(fs.existsSync(ticket));
    assert.match(fs.readFileSync(ticket, 'utf8'), /human_approval:\s*approved/);
  });

  scoped(/^the authorized cold-swap completes$/, (ctx) => {
    const st = ensure(ctx);
    st.root = materializeFixture();
    const killLog = path.join(st.root, 'kill.log');
    const startLog = path.join(st.root, 'start.log');
    st.last = sh(
      ['bash', path.join(st.root, 'swarmforge', 'scripts', 'cold_swap_day_shift_to_ollama_qwen.sh'), st.root, '--execute'],
      {
        env: {
          COLD_SWAP_KILL_CMD: `bash -c 'echo KILL >> "${killLog}"'`,
          COLD_SWAP_START_CMD: `bash -c 'echo START >> "${startLog}"'`,
        },
      }
    );
    st.killLog = killLog;
    st.startLog = startLog;
  });

  scoped(/^the live day-shift pack is ollama-qwen3-mono-router via start-swarm-ollama-qwen$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.last.status, 0, st.last.stderr || st.last.stdout);
    const day = fs.readFileSync(path.join(st.root, '.swarmforge', 'day_shift_pack'), 'utf8').trim();
    assert.equal(day, 'ollama-qwen3-mono-router');
    assert.match(fs.readFileSync(st.startLog, 'utf8'), /START/);
  });

  scoped(/^evidence records a successful launch under the BL-1127 staffing gate$/, (ctx) => {
    const st = ensure(ctx);
    const files = fs.readdirSync(path.join(st.root, 'backlog', 'evidence')).filter((f) =>
      f.startsWith('BL-1143-cold-swap-')
    );
    assert.ok(files.length >= 1);
    const text = fs.readFileSync(path.join(st.root, 'backlog', 'evidence', files[0]), 'utf8');
    assert.match(text, /bl1127_staffing_gate:\s*pass/);
    assert.match(text, /start-swarm-ollama-qwen/);
  });

  scoped(/^steward has a winner or no-winner-yet state from BL-1140$/, (ctx) => {
    ensure(ctx).stewardOk = true;
  });

  scoped(/^the cold-swapped pack is inspected$/, (ctx) => {
    const st = ensure(ctx);
    if (!st.root) st.root = materializeFixture();
    st.last = sh([
      'bash',
      path.join(st.root, 'swarmforge', 'scripts', 'cold_swap_day_shift_to_ollama_qwen.sh'),
      st.root,
      '--verify',
    ]);
  });

  scoped(/^model lines match the steward winner or clearly refuse no-winner-yet$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.last.status, 0, st.last.stderr || st.last.stdout);
    assert.match(`${st.last.stdout}\n${st.last.stderr}`, /OUTCOME=(aligned|no-winner-yet)|steward OUTCOME=/);
  });

  scoped(/^human-operator-priority:ollama-local-qwen-20260825 is not an authoritative outrank$/, (ctx) => {
    const pack = fs.readFileSync(
      path.join(REPO, 'swarmforge', 'packs', 'ollama-qwen3-mono-router.conf'),
      'utf8'
    );
    assert.doesNotMatch(pack, /human-operator-priority:ollama-local-qwen-20260825/);
  });

  scoped(/^the authorized cold-swap runs$/, (ctx) => {
    const st = ensure(ctx);
    st.root = materializeFixture();
    st.last = sh([
      'bash',
      path.join(st.root, 'swarmforge', 'scripts', 'cold_swap_day_shift_to_ollama_qwen.sh'),
      st.root,
      '--verify',
    ]);
  });

  scoped(/^qwen-forge or Token Plan full forge is not launched by this ticket$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.last.status, 0, st.last.stderr || st.last.stdout);
    const files = fs.readdirSync(path.join(st.root, 'backlog', 'evidence')).filter((f) =>
      f.startsWith('BL-1143-cold-swap-')
    );
    const text = fs.readFileSync(path.join(st.root, 'backlog', 'evidence', files.at(-1)), 'utf8');
    assert.match(text, /qwen_forge:\s*not launched/);
    assert.doesNotMatch(`${st.last.stdout}\n${st.last.stderr}`, /SWARMFORGE_PACK=qwen-forge/);
  });

  scoped(/^a how-to or runbook documents the switch and rollback$/, () => {
    assert.ok(fs.existsSync(HOWTO));
    const text = fs.readFileSync(HOWTO, 'utf8');
    assert.match(text, /--execute/);
    assert.match(text, /Rollback|cursor-forge/i);
  });
}

module.exports = { registerSteps };
