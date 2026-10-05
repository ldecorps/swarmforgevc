'use strict';

const fs = require('fs');
const path = require('path');

const pilot = require('../../../extension/out/tools/telegramCursorBridgePilot');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'Cursor /pilot prefers quality and first-class bounce-backs';

function mkRoot() {
  const root = trackedTmpRoot('bl699-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function registerSteps(registry) {
  registry.defineScoped(/^the pilot expeditor prompt composer is available$/, (ctx) => {
    ctx.root = mkRoot();
  }, FEATURE);

  registry.defineScoped(/^the offline expeditor prompt is composed for ticket "([^"]+)"$/, (ctx, ticket) => {
    ctx.prompt = pilot.composePilotExpeditorPrompt(ticket);
  }, FEATURE);

  registry.defineScoped(/^the prompt states that output quality is preferred over delivery speed$/, (ctx) => {
    if (!ctx.prompt.includes('Quality over speed') && !ctx.prompt.includes('Output quality beats delivery speed')) {
      throw new Error('expected prompt to prefer quality over speed');
    }
  }, FEATURE);

  registry.defineScoped(/^the prompt states that evidence and gate discipline beat finishing quickly$/, (ctx) => {
    if (!ctx.prompt.includes('prefer correctness, evidence, and gate discipline over') || !ctx.prompt.includes('finishing quickly')) {
      throw new Error('expected prompt to prefer evidence and gate discipline');
    }
  }, FEATURE);

  registry.defineScoped(/^the prompt authorizes returning to an earlier pipeline role when an upstream defect appears$/, (ctx) => {
    if (!ctx.prompt.includes('Bounce-backs are first-class') && !ctx.prompt.includes('return to that earlier pipeline role')) {
      throw new Error('expected prompt to treat bounce-backs as first-class');
    }
  }, FEATURE);

  registry.defineScoped(/^the prompt requires a rationale when bouncing back$/, (ctx) => {
    if (!ctx.prompt.includes('with a clear rationale')) {
      throw new Error('expected prompt to require a rationale when bouncing back');
    }
  }, FEATURE);

  registry.defineScoped(/^the prompt does not treat "already past role N" as a reason to paper over defects$/, (ctx) => {
    if (!ctx.prompt.includes('"already past role N" as a reason to paper over defects')) {
      throw new Error('expected prompt to forbid papering over defects');
    }
  }, FEATURE);

  registry.defineScoped(/^the prompt forbids rushing to a QA stamp over fixing upstream defects$/, (ctx) => {
    if (!ctx.prompt.includes('Do not rush to a') || !ctx.prompt.includes('QA stamp over fixing upstream defects')) {
      throw new Error('expected prompt to forbid rushing QA stamp');
    }
  }, FEATURE);

  registry.defineScoped(/^the prompt still names the offline Cursor-as-expeditor mode$/, (ctx) => {
    if (!ctx.prompt.includes('Mode: Cursor-as-expeditor')) {
      throw new Error('expected prompt to name offline Cursor-as-expeditor mode');
    }
  }, FEATURE);

  registry.defineScoped(/^the prompt still forbids spawning expedite_cli or claude -p stage runners$/, (ctx) => {
    if (!ctx.prompt.includes('Do NOT spawn `expedite_cli.bb`')) {
      throw new Error('expected prompt to forbid spawning expedite_cli');
    }
  }, FEATURE);

  registry.defineScoped(/^the prompt still requires worktree isolation under expedite-BL-699$/, (ctx) => {
    if (!ctx.prompt.includes('`.worktrees/expedite-BL-699`')) {
      throw new Error('expected prompt to require worktree isolation under expedite-BL-699');
    }
  }, FEATURE);

  registry.defineScoped(/^gating \/pilot against an active expedite lock still refuses when the lock is held$/, (ctx) => {
    const lockPath = path.join(ctx.root, '.swarmforge', 'operator', 'expedite-bridge.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ ticket: 'BL-699', pid: 1 }), 'utf8');
    const result = pilot.gatePilotAgainstExpediteLock(ctx.root);
    if (result.ok !== false) {
      throw new Error(`expected gate to refuse when lock is held, got: ${JSON.stringify(result)}`);
    }
    fs.unlinkSync(lockPath);
  }, FEATURE);
}

module.exports = { registerSteps };
