'use strict';

// BL-1970 (stamp-off of the 2026-10-04 edit-hook hotfix 52a004ed93): step
// handlers for "A local-model seat is told at once where its edit broke a
// Babashka file". The hotfix landed the hook and its registration; this
// parcel lands the step handlers the feature's four scenarios need.
//
// Scenarios 01-03 drive the REAL local_model_edit_hook.bb against fixture
// files the scenarios themselves write - the same posture as the hook's own
// shell test (test_bl1970_local_model_edit_hook.sh), which feeds qwen's
// PostToolUse event on stdin and checks the hook's additionalContext.
// Scenario 04 drives the REAL write_local_model_qwen_settings, extracted
// from the live swarmforge.sh and eval'd through zsh (never a
// reimplementation of the writer), then the REAL
// local_model_qwen_provider_cli.bb merge, the same way
// test_bl1970_local_model_edit_hook.sh and BL-1949's own test do it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1970 A local-model seat is told at once where its edit broke a Babashka file';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const HOOK = path.join(SCRIPTS_DIR, 'local_model_edit_hook.bb');
const PROVIDER_CLI = path.join(SCRIPTS_DIR, 'local_model_qwen_provider_cli.bb');

function ensure(ctx) {
  if (!ctx.bl1970) {
    ctx.bl1970 = { root: trackedTmpRoot('bl1970-edit-hook-'), files: {}, last: null };
  }
  return ctx.bl1970;
}

function writeFixtureFile(ctx, name, content) {
  const st = ensure(ctx);
  const p = path.join(st.root, name);
  fs.writeFileSync(p, content);
  st.files[name] = p;
  return p;
}

// The qwen PostToolUse event the hook reads from stdin: the tool name and
// the file_path the tool call edited (the hook's own shell test uses the
// same shape).
function runHook(ctx, toolName, filePath) {
  const st = ensure(ctx);
  const event = JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } });
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('bb', [HOOK], { input: event, encoding: 'utf8' });
  } catch (err) {
    stdout = `${err.stdout || ''}`;
    stderr = `${err.stderr || ''}`;
  }
  st.last = { stdout, stderr };
  return stdout;
}

function hookContext(stdout) {
  const parsed = JSON.parse(stdout);
  const out = parsed.hookSpecificOutput;
  assert.ok(out && out.hookEventName === 'PostToolUse', `expected a PostToolUse hookSpecificOutput, got: ${stdout}`);
  return out.additionalContext;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── background ─────────────────────────────────────────────────────────
  scoped(/^a local-model seat's edit hook and a fixture worktree$/, (ctx) => {
    ensure(ctx);
  });

  // ── scenario 01 ────────────────────────────────────────────────────────
  scoped(/^a Babashka file whose form opened at line 3 column 1 is never closed$/, (ctx) => {
    writeFixtureFile(ctx, 'broken.bb', '(ns fixture)\n\n(defn f [x]\n  (let [y (inc x)]\n    (* y 2))\n');
  });

  scoped(/^the hook runs for the seat's edit of that file$/, (ctx) => {
    const st = ensure(ctx);
    runHook(ctx, 'edit', st.files['broken.bb']);
  });

  scoped(/^the hook's additional context names the file and the reader message "expected \) to match \( at \[3,1\]\"$/, (ctx) => {
    const st = ensure(ctx);
    const context = hookContext(st.last.stdout);
    assert.ok(context.includes(st.files['broken.bb']), `expected the context to name the edited file, got: ${context}`);
    assert.ok(context.includes('expected ) to match ( at [3,1]'), `expected the reader message, got: ${context}`);
  });

  // ── scenario 02 ────────────────────────────────────────────────────────
  scoped(/^a Babashka file that reads cleanly$/, (ctx) => {
    writeFixtureFile(
      ctx,
      'good.bb',
      '#!/usr/bin/env bb\n(ns fixture (:require [clojure.string :as str]))\n(defn g [s] (str/upper-case s))\n(def r #"a(b)c")\n(def k ::str/thing)\n(def t #inst "2026-10-04")\n'
    );
  });

  scoped(/^the hook adds no context$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.last.stdout, '', `expected no output for a readable file, got: ${st.last.stdout}`);
  });

  // ── scenario 03 ────────────────────────────────────────────────────────
  scoped(/^a Markdown file with an unmatched parenthesis$/, (ctx) => {
    writeFixtureFile(ctx, 'notes.md', 'An unmatched ( paren in prose.\n');
  });

  // ── scenario 04 ────────────────────────────────────────────────────────
  scoped(/^the launcher writes a local-model seat's qwen settings$/, (ctx) => {
    const st = ensure(ctx);
    const script = `source '${SWARMFORGE_SH}'; write_local_model_qwen_settings '${st.root}'`;
    execFileSync('zsh', ['-f', '-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    st.settingsPath = path.join(st.root, '.qwen', 'settings.json');
  });

  scoped(/^the settings register the master checkout's edit hook for qwen's edit and write_file tools$/, (ctx) => {
    const st = ensure(ctx);
    const settings = JSON.parse(fs.readFileSync(st.settingsPath, 'utf8'));
    const groups = settings.hooks.PostToolUse.filter((g) => g.matcher === 'edit|write_file');
    assert.equal(groups.length, 1, `expected exactly one PostToolUse group for edit|write_file, got: ${JSON.stringify(settings.hooks.PostToolUse)}`);
    const hooks = groups[0].hooks;
    assert.equal(hooks.length, 1, `expected exactly one hook in the edit|write_file group, got: ${JSON.stringify(hooks)}`);
    assert.equal(hooks[0].type, 'command', `expected a command hook, got: ${JSON.stringify(hooks[0])}`);
    assert.equal(hooks[0].command, `bb '${HOOK}'`, `expected the master checkout's edit hook, got: ${hooks[0].command}`);
  });

  scoped(/^the provider entry merge keeps that registration$/, (ctx) => {
    const st = ensure(ctx);
    // A given --context-length means the CLI asks Ollama nothing (the
    // hook's own shell test uses the same unreachable endpoint).
    execFileSync(
      'bb',
      [
        PROVIDER_CLI,
        'write',
        '--settings-file', st.settingsPath,
        '--model', 'fixture-model:latest',
        '--endpoint-url', 'http://127.0.0.1:9/v1',
        '--context-length', '32768',
        '--base-url', 'http://127.0.0.1:9/v1',
        '--role', 'coder',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const settings = JSON.parse(fs.readFileSync(st.settingsPath, 'utf8'));
    const groups = settings.hooks.PostToolUse.filter((g) => g.matcher === 'edit|write_file');
    assert.equal(groups.length, 1, `expected the edit|write_file group to survive the merge, got: ${JSON.stringify(settings.hooks.PostToolUse)}`);
    assert.equal(groups[0].hooks[0].command, `bb '${HOOK}'`, `expected the edit hook to survive the merge, got: ${JSON.stringify(groups[0].hooks)}`);
  });
}

module.exports = { registerSteps };
