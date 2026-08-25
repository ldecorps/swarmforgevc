'use strict';

// BL-1142: local Ollama mono vs capped forge — durable decision + gate.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'local Ollama mono-router vs capped forge under CPU';
const REPO = path.join(__dirname, '..', '..', '..');
const GATE = path.join(REPO, 'swarmforge', 'scripts', 'local_ollama_pack_shape_gate.sh');
const HOWTO = path.join(REPO, 'docs', 'how-to', 'BL-1142-local-ollama-mono-vs-forge-cpu.md');
const START = path.join(REPO, 'start-swarm-ollama-qwen.sh');
const PACK = path.join(REPO, 'swarmforge', 'packs', 'ollama-qwen3-mono-router.conf');
const EVIDENCE = path.join(REPO, 'backlog', 'evidence');

function sh(args, opts = {}) {
  return spawnSync(args[0], args.slice(1), {
    encoding: 'utf8',
    cwd: opts.cwd || REPO,
    env: { ...process.env, ...(opts.env || {}) },
  });
}

function ensure(ctx) {
  if (!ctx.bl1142) ctx.bl1142 = { last: null, tmp: null };
  return ctx.bl1142;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the local Ollama launch path and BL-1127 battery evidence exist$/, () => {
    assert.ok(fs.existsSync(START), 'start-swarm-ollama-qwen.sh missing');
    assert.ok(fs.existsSync(PACK), 'ollama-qwen3-mono-router.conf missing');
    assert.ok(fs.existsSync(GATE), 'pack-shape gate missing');
  });

  scoped(/^the mono-vs-forge decision artifact is read$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(fs.existsSync(HOWTO), `how-to missing: ${HOWTO}`);
    st.decision = fs.readFileSync(HOWTO, 'utf8');
    const evidenceFiles = fs.readdirSync(EVIDENCE).filter((f) => f.startsWith('BL-1142-'));
    st.evidenceNames = evidenceFiles.join('\n');
  });

  scoped(/^the decision names mono-router stay with a BL-1127 or headroom evidence cite$/, (ctx) => {
    const text = ensure(ctx).decision;
    assert.match(text, /Decision:\s*mono-router/i);
    assert.match(text, /BL-1127|headroom|available RAM|nproc/i);
  });

  scoped(/^qwen-forge is named as out of scope for the local path$/, (ctx) => {
    assert.match(ensure(ctx).decision, /qwen-forge/i);
    assert.match(ensure(ctx).decision, /out of scope|not .+substitute|must not/i);
  });

  scoped(/^start-swarm-ollama-qwen is inspected for pack shape$/, (ctx) => {
    const st = ensure(ctx);
    const start = fs.readFileSync(START, 'utf8');
    const pack = fs.readFileSync(PACK, 'utf8');
    st.last = sh(['bash', GATE, REPO, 'ollama-qwen3-mono-router']);
    st.start = start;
    st.pack = pack;
  });

  scoped(/^the staffed pack is ollama-qwen3-mono-router classified as mono-router$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.start, /SWARMFORGE_PACK=ollama-qwen3-mono-router/);
    assert.equal(st.last.status, 0, st.last.stderr || st.last.stdout);
    assert.match(`${st.last.stdout}\n${st.last.stderr}`, /mono-router/);
  });

  scoped(/^active_backlog_max_depth is at most the local mono depth cap$/, (ctx) => {
    assert.match(ensure(ctx).pack, /config active_backlog_max_depth 1\b/);
  });

  scoped(/^a standing multi-window local pack body without a depth cap$/, (ctx) => {
    const st = ensure(ctx);
    st.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1142-'));
    const packs = path.join(st.tmp, 'swarmforge', 'packs');
    fs.mkdirSync(packs, { recursive: true });
    fs.writeFileSync(
      path.join(packs, 'local-fake-forge.conf'),
      'window coder a\nwindow specifier b\nwindow cleaner c\n'
    );
  });

  scoped(/^the local pack-shape gate evaluates it$/, (ctx) => {
    const st = ensure(ctx);
    st.last = sh(['bash', GATE, st.tmp, 'local-fake-forge']);
  });

  scoped(/^staffing is refused as uncapped-forge$/, (ctx) => {
    const st = ensure(ctx);
    assert.notEqual(st.last.status, 0);
    assert.match(`${st.last.stdout}\n${st.last.stderr}`, /uncapped-forge|BL-1142/);
    if (st.tmp) fs.rmSync(st.tmp, { recursive: true, force: true });
  });

  scoped(/^the local pack-shape gate is asked to staff qwen-forge$/, (ctx) => {
    const st = ensure(ctx);
    st.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1142-'));
    const packs = path.join(st.tmp, 'swarmforge', 'packs');
    fs.mkdirSync(packs, { recursive: true });
    // Even a mono-shaped body must not staff under the forbidden name.
    fs.writeFileSync(
      path.join(packs, 'qwen-forge.conf'),
      'config active_backlog_max_depth 1\nconfig rotation router\nwindow coder a\n'
    );
    st.last = sh(['bash', GATE, st.tmp, 'qwen-forge']);
    st.cursorForgeBefore = fs.existsSync(path.join(REPO, 'swarmforge', 'packs', 'cursor-forge.conf'))
      ? fs.statSync(path.join(REPO, 'swarmforge', 'packs', 'cursor-forge.conf')).mtimeMs
      : 0;
  });

  scoped(/^staffing is refused naming the forbidden substitute$/, (ctx) => {
    const st = ensure(ctx);
    assert.notEqual(st.last.status, 0);
    assert.match(`${st.last.stdout}\n${st.last.stderr}`, /forbidden|substitute|qwen-forge|BL-1142/);
  });

  scoped(/^cursor-forge is not rewritten by this gate$/, (ctx) => {
    const st = ensure(ctx);
    const p = path.join(REPO, 'swarmforge', 'packs', 'cursor-forge.conf');
    if (fs.existsSync(p) && st.cursorForgeBefore) {
      assert.equal(fs.statSync(p).mtimeMs, st.cursorForgeBefore);
    }
    if (st.tmp) fs.rmSync(st.tmp, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
