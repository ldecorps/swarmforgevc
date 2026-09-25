'use strict';

// BL-1726: step handlers for "The ghost reaper touches only ollama's own
// llama-server". Drives the REAL decision (orphan_janitor_lib.bb's
// reapable-ollama-ghost?) via bl1726_ollama_ghost_reaper_probe.bb - never
// a reimplementation of the ownership-marks logic in JS.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PROBE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl1726_ollama_ghost_reaper_probe.bb');

const FEATURE_NAME = "BL-1726 The ghost reaper touches only ollama's own llama-server";

function reapVerdict(cmdline) {
  const out = execFileSync('bb', [PROBE, 'reap-verdict', cmdline], { encoding: 'utf8' });
  return out.trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(
    /^the janitor classifies an old process whose parent is not a live ollama serve and whose command line is "(.+)"$/,
    (ctx, cmdline) => {
      ctx.verdict = reapVerdict(cmdline);
    }
  );

  scoped(/^it is (reaped|kept)$/, (ctx, expected) => {
    if (ctx.verdict !== expected) {
      throw new Error(`expected verdict "${expected}", got "${ctx.verdict}"`);
    }
  });
}

module.exports = { registerSteps };
