'use strict';

// BL-1816: step handlers for "A local-model seat reads its predecessor's
// knowledge brief first". Drives the REAL prompt_engine_cli.bb compose
// command (the same CLI swarmforge.sh shells out to at launch) over a real
// mkdtemp fixture root passed as --target-root, with --now-ms fixing the
// compose clock — never a reimplementation of the freshness math or the
// pointer text, which live only in prompt_engine_lib.bb.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PROMPT_ENGINE_CLI = path.join(SCRIPTS_DIR, 'prompt_engine_cli.bb');

const FEATURE = "BL-1816 A local-model seat reads its predecessor's knowledge brief first";

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value is validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough.
const KNOWN_AGENTS = new Set(['local-model', 'claude', 'aider']);

const HOUR_MS = 3600000;

function briefRelPath(role) {
  return `.swarmforge/agent-memory/${role}/brief.md`;
}

function payloadRelPath(role) {
  return `.swarmforge/agent-memory/${role}/payload.json`;
}

function writePayload(root, role, capturedIso) {
  const dir = path.join(root, '.swarmforge', 'agent-memory', role);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'payload.json'),
    JSON.stringify({ handoffPack: { capturedAt: capturedIso } })
  );
}

function composeInFixture(root, nowMs, agent, role) {
  return execFileSync(
    'bb',
    [PROMPT_ENGINE_CLI, 'compose', agent, role, '0', '', '--target-root', root, '--now-ms', String(nowMs)],
    { encoding: 'utf8' }
  );
}

function composeNoBrief(agent, role) {
  return execFileSync('bb', [PROMPT_ENGINE_CLI, 'compose', agent, role, '0', ''], { encoding: 'utf8' });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a fixture repository with a knowledge brief kept for the "([^"]+)" role$/, (ctx, role) => {
    ctx.role = role;
    ctx.root = mkProcessTmpDir('bl1816-brief-');
    ctx.nowMs = Date.now();
    const dir = path.join(ctx.root, '.swarmforge', 'agent-memory', role);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'brief.md'), '# fixture knowledge brief\n');
  });

  // ── given: freshness ─────────────────────────────────────────────────────
  scoped(/^the brief was captured (\d+) hours? ago$/, (ctx, hoursAgo) => {
    const capturedMs = ctx.nowMs - Number(hoursAgo) * HOUR_MS;
    writePayload(ctx.root, ctx.role, new Date(capturedMs).toISOString());
  });

  // ── when ──────────────────────────────────────────────────────────────────
  scoped(/^the "([^"]+)" prompt for "([^"]+)" is composed$/, (ctx, agent, role) => {
    if (!KNOWN_AGENTS.has(agent)) {
      throw new Error(`bl1816: unrecognized agent "${agent}"`);
    }
    ctx.agent = agent;
    ctx.composed = composeInFixture(ctx.root, ctx.nowMs, agent, role);
  });

  // ── then ──────────────────────────────────────────────────────────────────
  scoped(
    /^the composed prompt has exactly one line naming the brief file and saying to read it before the first ready_for_next\.sh$/,
    (ctx) => {
      const needle = briefRelPath(ctx.role);
      const matches = ctx.composed
        .split('\n')
        .filter((line) => line.includes(needle) && line.includes('ready_for_next.sh'));
      assert.equal(
        matches.length,
        1,
        `expected exactly one pointer line naming "${needle}" and "ready_for_next.sh", got ${matches.length}: ${JSON.stringify(matches)}`
      );
      // BL-1816 D1 (QA bounce round 2): line.includes(needle) alone still
      // matches an ABSOLUTE path ending in the same relative suffix - it
      // would have passed even before the fix, when the pointer named a
      // bare repo-relative path that resolved to nothing from a worktree
      // seat's own cwd. Extract the exact named path and check the file it
      // names actually exists - the real regression this bounce found.
      const [, namedPath] = /knowledge brief at (.+)\.$/.exec(matches[0]) || [];
      assert.ok(namedPath, `expected to extract a named path from pointer line: ${matches[0]}`);
      assert.ok(path.isAbsolute(namedPath), `expected the named brief path to be absolute, got "${namedPath}"`);
      assert.ok(fs.existsSync(namedPath), `expected the named brief path "${namedPath}" to exist on disk`);
    }
  );

  scoped(/^the composed prompt names no brief file$/, (ctx) => {
    const needle = briefRelPath(ctx.role);
    assert.ok(!ctx.composed.includes(needle), `expected the composed prompt to name no brief file, but it included "${needle}"`);
  });

  scoped(/^the composed prompt is identical to the one composed with no brief kept$/, (ctx) => {
    const withoutBrief = composeNoBrief(ctx.agent, ctx.role);
    assert.equal(
      ctx.composed,
      withoutBrief,
      `expected the ${ctx.agent} composition of "${ctx.role}" to be identical whether or not a brief is kept; lengths were ${ctx.composed.length} vs ${withoutBrief.length}`
    );
  });
}

module.exports = { registerSteps, briefRelPath, payloadRelPath };
